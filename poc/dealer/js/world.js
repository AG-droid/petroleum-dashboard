/* =====================================================================
   PRAHARI for dealers — the demo dealer's world
   Builds one dealer account (two retail outlets) on top of the Sales Officer dashboard's
   synthetic world (../js/data.js), so the same outlets, tanks, depots and roads appear in both
   apps. Everything is fictional and generated from fixed seeds.

   Units: litres (L) inside the dealer app, matching the tank gauge and invoice figures dealers
   see; kilolitres (KL) only for order quantities and truck sizes.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.DCFG;
  const { PRODUCTS, HOURLY, util } = DB;
  const rng = util.mulberry32(990104);
  const r = (a, b) => a + rng() * (b - a);
  const ri = (a, b) => Math.floor(r(a, b + 1));
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const MIN = 60000, HOUR = 3600000, DAY = util.DAY;
  const NOW = Date.now();

  // ---------- Indian time helpers (the outlets are in India whatever the viewer's zone) ----------
  const IST_OFF = 330 * MIN;
  const istHour = (ts) => Math.floor((((ts + IST_OFF) % DAY) + DAY) % DAY / HOUR);
  const istMidnight = (ts) => Math.floor((ts + IST_OFF) / DAY) * DAY - IST_OFF;
  /** Start of the business day (the morning dip at 06:00 IST) that contains ts. */
  function businessDayStart(ts) {
    let s = istMidnight(ts) + C.openingHour * HOUR;
    if (ts < s) s -= DAY;
    return s;
  }
  /** Litres expected between two instants for a product selling dailyL a day (hourly curve). */
  function expectedBetween(dailyL, from, to) {
    let L = 0, t = from;
    while (t < to) {
      const next = Math.min(to, Math.floor((t + IST_OFF) / HOUR) * HOUR - IST_OFF + HOUR);
      L += dailyL * HOURLY[istHour(t)] * (next - t) / HOUR;
      t = next;
    }
    return L;
  }

  // ---------- A sale, as the pump records it ----------
  function saleSize(p, rand) {
    if (p === 'HSD') return rand() < 0.35 ? 70 + rand() * 150 : 15 + rand() * 30;
    if (p === 'MS') { const x = rand(); return x < 0.45 ? 1.5 + rand() * 3.5 : x < 0.55 ? 4 + rand() * 6 : 8 + rand() * 27; }
    return 10 + rand() * 25;
  }
  function payMode(rand) { const x = rand(); return x < 0.55 ? 'UPI' : x < 0.82 ? 'Cash' : x < 0.94 ? 'Card' : 'Fleet card'; }
  function vehicleClass(L) { return C.vehicleClasses.find((v) => L <= v.maxL).label; }
  function ticketSlab(inr) { return C.ticketSlabsInr.findIndex((s) => inr <= s); }
  function emptyAgg() {
    return { count: 0, L: 0, inr: 0, slabs: C.ticketSlabsInr.map(() => 0), vehicles: Object.fromEntries(C.vehicleClasses.map((v) => [v.label, 0])), modes: { UPI: 0, Cash: 0, Card: 0, 'Fleet card': 0 } };
  }
  function recordSale(ro, nozzle, L, ts, rand) {
    const p = nozzle.product;
    const inr = Math.round(L * ro.prices[p].pump);
    const tx = { ts, nozzle: nozzle.id, du: nozzle.du, product: p, L, inr, mode: payMode(rand), vehicle: vehicleClass(L) };
    nozzle.todayL += L; nozzle.totalizerL += L; nozzle.lastSale = tx;
    const a = ro.agg;
    a.count++; a.L += L; a.inr += inr; a.slabs[ticketSlab(inr)]++; a.vehicles[tx.vehicle]++; a.modes[tx.mode]++;
    ro.txns.unshift(tx);
    if (ro.txns.length > 40) ro.txns.length = 40;
    return tx;
  }

  // ---------- The dealer ----------
  const S = DB.stories;
  const base = [S.dryout, S.stamp]; // 990104 highway (diesel low) and 990118 city (stamping due)
  const dealer = {
    name: S.dryout.dealer.name,
    phone: S.dryout.dealer.phone,
    since: S.dryout.dealer.since,
    code: 'DLR-' + S.dryout.id, // fictional dealer account number
  };

  // ---------- Outlets ----------
  const opening = businessDayStart(NOW);
  const ros = base.map((o) => {
    const depot = util.nearestDepot(o);
    const route = util.buildRoute(depot, o);
    const products = Object.keys(o.prod);
    const avgDailyL = {};
    products.forEach((p) => { avgDailyL[p] = o.hist.slice(-1 - C.forecastDays, -1).reduce((a, h) => a + h[p], 0) / C.forecastDays * 1000; });
    const share = (p) => o.prod[p] / o.daily;
    const ro = {
      id: o.id, name: o.name, marketClass: o.marketClass, category: o.category, type: o.type,
      locality: o.locality, road: o.road, lng: o.lng, lat: o.lat,
      depotId: depot.id, route, routeMin: route.min || route.km / 32 * 60,
      products, avgDailyL,
      hist: o.hist.slice(0, -1).map((h) => ({ date: h.date, total: h.total * 1000, ...Object.fromEntries(products.map((p) => [p, h[p] * 1000])) })),
      targetMonthL: Object.fromEntries(products.map((p) => [p, o.targetMonth * share(p) * 1000])),
      prices: Object.fromEntries(products.map((p) => [p, { rsp: PRODUCTS[p].price, pump: PRODUCTS[p].price }])),
      priceRevisedTs: opening,
      tanks: o.tanks.map((t) => ({
        id: t.id, product: t.product, capL: t.cap * 1000, stockL: t.stock * 1000,
        deadL: Math.round(t.cap * 1000 * C.deadStockFraction / 100) * 100,
        waterMm: t.water, tempC: +t.temp.toFixed(1), atgOk: true, readL: t.stock * 1000, readTs: NOW,
      })),
      nozzles: o.nozzles.map((n) => ({
        id: n.id, du: n.du, product: n.product, totalizerL: n.totalizer, todayL: 0, lastSale: null,
        flowLpm: +(n.product === 'HSD' ? r(37, 40) : r(35, 38)).toFixed(1), presetOk: true, status: 'Idle',
        // Synthetic fault states for the storyline below; the simulation never clears them by itself.
        silent: false,
      })),
      compliance: ['peso', 'stamp', 'fire', 'pcc'].map((k) => ({ key: k, label: o.compliance[k].label, due: o.compliance[k].due, booked: null })),
      observations: o.compliance.irregularities.map((x) => ({ ts: x.date, text: x.text, status: x.status, proof: null })),
      inspections: o.compliance.inspections.map((x) => ({ ts: x.date, by: x.by, type: x.type, result: x.result })),
      logs: [],
      txns: [], agg: emptyAgg(),
      hourly: Array.from({ length: 24 }, () => Object.fromEntries(products.map((p) => [p, 0]))),
      book: { openTs: opening, openL: {}, receiptL: Object.fromEntries(products.map((p) => [p, 0])), nozzleAtReadL: {}, bias: o.variation / 100 },
      pendingL: Object.fromEntries(products.map((p) => [p, 0])), // litres sold but not yet split into sales
    };
    // Sales so far today (since 06:00), generated sale by sale so every report adds up.
    products.forEach((p) => {
      const nozzles = ro.nozzles.filter((n) => n.product === p);
      let t = opening;
      while (t < NOW) {
        const next = Math.min(NOW, t + 10 * MIN);
        let L = expectedBetween(avgDailyL[p], t, next) * r(0.8, 1.2);
        while (L > 0) {
          const size = Math.min(L, saleSize(p, rng));
          recordSale(ro, pick(nozzles), size, t + rng() * (next - t), rng);
          ro.hourly[istHour(t)][p] += size;
          L -= size;
        }
        t = next;
      }
    });
    ro.txns.sort((a, b) => b.ts - a.ts);
    return ro;
  });
  const [hw, city] = ros;

  // ---------- Storyline: what the dealer should find this morning ----------
  // 990104 — a diesel nozzle has sold nothing since opening: its litres went to the others.
  const nil = hw.nozzles.find((n) => n.id === 'N5');
  const peers = hw.nozzles.filter((n) => n.product === nil.product && n !== nil);
  peers.forEach((n) => { n.todayL += nil.todayL / peers.length; n.totalizerL += nil.todayL / peers.length; });
  nil.totalizerL -= nil.todayL; nil.todayL = 0; nil.lastSale = null; nil.silent = true;
  hw.txns.forEach((tx) => { if (tx.nozzle === nil.id) tx.nozzle = peers[0].id; });
  // 990104 — one diesel nozzle dispenses noticeably slower than the rest (flow-rate variance).
  const slow = hw.nozzles.find((n) => n.id === 'N9');
  slow.flowLpm = 31.2;
  // 990104 — a dispenser controller was reset in the night, outside any maintenance window.
  hw.logs.push({ id: 'LOG-' + ri(10000, 99999), ts: NOW - 5.3 * HOUR, du: 'DU-4', type: 'Controller reset', critical: true,
    text: 'Dispenser controller reset with no open maintenance ticket. Totalizers must be checked against the last reading.', atr: null });
  hw.logs.push({ id: 'LOG-' + ri(10000, 99999), ts: NOW - 9.1 * HOUR, du: 'DU-2', type: 'Power failure', critical: false,
    text: 'Mains power lost for 7 minutes; dispensers restarted normally.', atr: null });
  // 990118 — the premium petrol pump price was not updated at today's 06:00 price revision.
  const prem = city.products.includes('XP') ? 'XP' : 'MS';
  city.prices[prem].pump = +(city.prices[prem].rsp - 0.5).toFixed(2);
  city.nozzles.filter((n) => n.product === prem).forEach((n) => { n.presetOk = false; });
  // 990118 — water building up at the bottom of the diesel tank.
  const wet = city.tanks.find((t) => t.product === 'HSD');
  if (wet) wet.waterMm = 31;
  city.logs.push({ id: 'LOG-' + ri(10000, 99999), ts: NOW - 26 * HOUR, du: 'DU-1', type: 'Nozzle calibration', critical: false,
    text: 'Routine 5-litre measure check passed on N1 and N2.', atr: null });

  // ---------- Prices ----------
  const purchasePrice = (p) => PRODUCTS[p].price - C.dealerMarginPerL[p];

  // ---------- Orders, invoices, payments, ledger ----------
  let seq = 1;
  const orderNo = (ts) => { const d = new Date(ts + IST_OFF); return 'ORD-' + String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(seq++).padStart(4, '0'); };
  const invoiceNo = () => '70' + String(ri(10000000, 99999999)); // 10 digits, as on oil-company invoices
  const TRANSPORTERS = ['Aravali Roadlines', 'Haryana Petro Carriers', 'NCR Tankers'];
  const DRIVERS = ['Balwinder Singh', 'Sukhdev Yadav', 'Ramkishan Saini', 'Jagdish Malik', 'Satbir Dahiya'];
  function truck() { return { plate: pick(['HR55', 'HR38', 'HR26']) + ' ' + pick(['AK', 'BG', 'CF']) + ' ' + ri(1000, 9999), driver: pick(DRIVERS), transporter: pick(TRANSPORTERS), phone: 'demo number ' + ri(1000, 9999) }; }
  const valueOf = (lines) => lines.reduce((a, l) => a + l.kl * 1000 * purchasePrice(l.product), 0);

  const orders = [];
  const ledger = []; // { ts, type, ref, roId, debit, credit, note }
  const payments = [];
  function deliveredOrder(ro, ts, lines, truckKL, extra) {
    const o = Object.assign({
      id: orderNo(ts), roId: ro.id, lines, truckKL, value: Math.round(valueOf(lines)), status: 'received',
      createdTs: ts - 9 * HOUR, releasedTs: ts - 8 * HOUR, loadStartTs: ts - 3 * HOUR, dispatchTs: ts - 2 * HOUR, arriveTs: ts - 0.5 * HOUR, unloadedTs: ts,
      invoice: { no: invoiceNo(), ts: ts - 2 * HOUR }, truck: truck(), depotId: ro.depotId, receipt: null,
    }, extra || {});
    orders.push(o);
    ledger.push({ ts: o.invoice.ts, type: 'Invoice', ref: o.invoice.no, roId: ro.id, debit: o.value, credit: 0, note: lines.map((l) => `${l.product} ${l.kl} KL`).join(' + ') });
    return o;
  }
  // History: regular deliveries over the last 3 weeks.
  [[hw, 19, [{ product: 'HSD', kl: 15 }, { product: 'MS', kl: 5 }], 20], [city, 17, [{ product: 'MS', kl: 8 }, { product: 'HSD', kl: 4 }], 12],
    [hw, 14, [{ product: 'HSD', kl: 20 }], 20], [hw, 10, [{ product: 'HSD', kl: 15 }, { product: 'MS', kl: 5 }], 20],
    [city, 9, [{ product: 'HSD', kl: 8 }, { product: prem, kl: 4 }], 12], [hw, 6, [{ product: 'HSD', kl: 20 }], 20],
    [hw, 3, [{ product: 'HSD', kl: 15 }, { product: 'MS', kl: 5 }], 20]].forEach(([ro, daysAgo, lines, kl]) => {
    const o = deliveredOrder(ro, NOW - daysAgo * DAY - ri(2, 8) * HOUR, lines, kl);
    o.receipt = { ts: o.unloadedTs + 40 * MIN, lines: lines.map((l) => ({ product: l.product, invoiceL: l.kl * 1000, receivedL: l.kl * 1000 - ri(0, Math.floor(l.kl * 1000 * C.transitLossFraction * 0.8)), densityDiff: +r(-1.2, 1.2).toFixed(1) })), claim: null };
  });
  // 990118 — yesterday's petrol load: the tank gauge shows 85 L less than invoiced, receipt not confirmed.
  const shortOrder = deliveredOrder(city, NOW - 20 * HOUR, [{ product: 'MS', kl: 12 }], 12, { status: 'awaiting_receipt' });
  shortOrder.atgReceivedL = { MS: 12000 - 85 };
  shortOrder.densityObs = { MS: +(r(-0.8, 0.8)).toFixed(1) };
  // 990104 — today's diesel order is waiting for payment (the Sales Officer sees it as "on hold").
  const waiting = {
    id: orderNo(NOW - 2.5 * HOUR), roId: hw.id, lines: [{ product: 'HSD', kl: 15 }, { product: 'MS', kl: 5 }], truckKL: 20,
    status: 'awaiting_payment', createdTs: NOW - 2.5 * HOUR, depotId: hw.depotId, invoice: null, truck: null, receipt: null,
  };
  waiting.value = Math.round(valueOf(waiting.lines));
  orders.push(waiting);

  // Payments made by RTGS over the month (all credited).
  [[24, 1850000], [16, 1500000], [11, 1650000], [7, 1400000], [4, 1750000]].forEach(([d, amt]) => {
    const ts = NOW - d * DAY - ri(1, 5) * HOUR;
    const p = { id: 'PAY-' + ri(100000, 999999), mode: 'RTGS', amount: amt, utr: 'DEMOR5' + new Date(ts + IST_OFF).toISOString().slice(0, 10).replace(/-/g, '') + String(ri(10000000, 99999999)), ts, status: 'credited', creditedTs: ts + 25 * MIN };
    payments.push(p);
    ledger.push({ ts: p.creditedTs, type: 'Payment', ref: p.utr, roId: null, debit: 0, credit: amt, note: 'RTGS received' });
  });
  // A small credit note for an old, accepted shortage claim.
  ledger.push({ ts: NOW - 12 * DAY, type: 'Credit note', ref: 'CN-' + ri(100000, 999999), roId: city.id, debit: 0, credit: 5420, note: 'Short-receipt claim accepted (58 L)' });
  // Opening balance chosen so today's balance is ₹6.42 lakh: short of the waiting order.
  const targetBalance = 642350;
  const net = ledger.reduce((a, e) => a + e.credit - e.debit, 0);
  ledger.push({ ts: NOW - 28 * DAY, type: 'Opening balance', ref: '—', roId: null, debit: 0, credit: targetBalance - net, note: 'Brought forward' });
  ledger.sort((a, b) => a.ts - b.ts);
  orders.sort((a, b) => b.createdTs - a.createdTs);
  payments.sort((a, b) => b.ts - a.ts);

  // Receipts booked today feed the stock book.
  orders.forEach((o) => { if (o.unloadedTs >= opening) { const ro = ros.find((x) => x.id === o.roId); o.lines.forEach((l) => { ro.book.receiptL[l.product] += l.kl * 1000; }); } });
  // Opening (06:00) stock per product, back-calculated so tank sales = opening + receipts − closing.
  ros.forEach((ro) => ro.products.forEach((p) => {
    const sold = ro.nozzles.filter((n) => n.product === p).reduce((a, n) => a + n.todayL, 0);
    const now = ro.tanks.filter((t) => t.product === p).reduce((a, t) => a + t.stockL, 0);
    ro.book.openL[p] = now + sold * (1 + ro.book.bias) - ro.book.receiptL[p];
    ro.book.nozzleAtReadL[p] = sold; // tanks were read just now
  }));

  // ---------- Messages with the Sales Officer ----------
  const officer = 'Sales Officer, Gurugram';
  const threads = [
    { id: 'MSG-1', subject: 'Price revision from 06:00', roId: null, cat: 'Notice', status: 'Closed', msgs: [
      { from: 'so', who: officer, ts: opening - 20 * MIN, text: `Retail prices change from 06:00: petrol ₹${PRODUCTS.MS.price.toFixed(2)}, diesel ₹${PRODUCTS.HSD.price.toFixed(2)}, premium petrol ₹${PRODUCTS.XP.price.toFixed(2)} per litre. Update every dispenser and preset before the first sale.` },
    ] },
    { id: 'MSG-2', subject: 'Stamping renewal at ' + city.name, roId: city.id, cat: 'Compliance', status: 'Open', msgs: [
      { from: 'so', who: officer, ts: NOW - 4 * DAY, text: 'The Legal Metrology stamping of the dispensers is due soon. Please book the inspector and share the receipt.' },
    ] },
  ];

  window.DW = {
    dealer, ros, orders, ledger, payments, threads, officer,
    byId: (id) => ros.find((x) => x.id === id),
    orderById: (id) => orders.find((x) => x.id === id),
    activity: [], recState: {},
    startTs: NOW,
    util: { istHour, istMidnight, businessDayStart, expectedBetween, saleSize, payMode, recordSale, emptyAgg, purchasePrice, valueOf, orderNo, invoiceNo, truck, IST_OFF, MIN, HOUR, DAY },
  };
})();
