/* =====================================================================
   PRAHARI for dealers — simulation, forecasts and recommendations
   A simulated clock (1× to 300×) drives sales, tank levels, orders, payments and replies.
   On top of that state, explainable rules turn the data into a ranked list of "do this now"
   recommendations, each with its reason, the money at stake and a one-tap action.

   No DOM access here, so the logic can be checked in Node (tools/check_dealer.mjs).
   ===================================================================== */
(function () {
  'use strict';
  const C = window.DCFG;
  const W = window.DW;
  const { PRODUCTS } = DB;
  const U = W.util;
  const { MIN, HOUR, DAY } = U;
  const rand = Math.random;

  const Eng = {
    now: W.startTs, speed: 1, listeners: [], jobs: [], version: 0,
    on(fn) { this.listeners.push(fn); },
  };
  const pname = (p) => PRODUCTS[p].name;
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

  // ---------- Activity log: every action leaves a record ----------
  function log(text, roId, kind) {
    W.activity.unshift({ ts: Eng.now, text, roId: roId || null, kind: kind || 'info' });
    if (W.activity.length > 80) W.activity.length = 80;
  }
  Eng.log = log;
  function later(delayMin, fn) { Eng.jobs.push({ at: Eng.now + delayMin * MIN, fn }); }

  // ---------- Money ----------
  function ledgerBalance() { return sum(W.ledger, (e) => e.credit - e.debit); }
  /** Value of released orders not yet invoiced: the oil company holds this much of the balance. */
  function blocked() { return sum(W.orders.filter((o) => o.status === 'placed' || o.status === 'loading'), (o) => o.value); }
  function available() { return ledgerBalance() - blocked(); }
  function pendingPayments() { return sum(W.payments.filter((p) => p.status === 'pending'), (p) => p.amount); }
  /** When the last pending payment should be credited (null if none). */
  function pendingCreditTs() {
    const ps = W.payments.filter((p) => p.status === 'pending');
    return ps.length ? Math.max(...ps.map((p) => p.ts + C.paymentCreditMin * MIN)) : null;
  }
  /** Money still to send for an order, counting payments already sent but not yet credited. */
  function stillToPay(o) { return Math.max(0, o.value - available() - pendingPayments()); }
  /** When a waiting order can be released: now, when pending money lands, or after a new payment. */
  function releaseTsFor(o) {
    if (available() >= o.value) return Eng.now;
    if (stillToPay(o) <= 0) return Math.max(Eng.now, pendingCreditTs());
    return Eng.now + C.paymentCreditMin * MIN;
  }
  Eng.money = () => ({ balance: ledgerBalance(), blocked: blocked(), available: available(), pending: pendingPayments(), creditTs: pendingCreditTs() });
  Eng.stillToPay = stillToPay;
  Eng.releaseTsFor = releaseTsFor;

  // ---------- Supply plan: when would a truck arrive if released at a given time? ----------
  function nextLoadingSlot(ts) {
    const h = U.istHour(ts);
    const day = U.istMidnight(ts);
    if (h < C.depotOpenHour) return day + C.depotOpenHour * HOUR;
    if (h >= C.depotCloseHour) return day + DAY + C.depotOpenHour * HOUR;
    return ts;
  }
  function plan(ro, releaseTs) {
    // Orders released after the cut-off load the next morning.
    let start = releaseTs + C.depotQueueMin * MIN;
    if (U.istHour(releaseTs) >= C.indentCutoffHour) start = Math.max(start, U.istMidnight(releaseTs) + DAY + C.depotOpenHour * HOUR);
    start = nextLoadingSlot(start);
    const dispatch = start + C.loadingMin * MIN;
    const arrive = dispatch + ro.routeMin * MIN;
    return { releaseTs, loadStartTs: start, dispatchTs: dispatch, arriveTs: arrive, usableTs: arrive + C.unloadingMin * MIN };
  }
  Eng.plan = plan;

  // ---------- Stock, forecasts ----------
  const tanksOf = (ro, p) => ro.tanks.filter((t) => t.product === p);
  const usableOf = (t, field) => Math.max(0, t[field || 'readL'] - t.deadL);
  const OPEN = ['awaiting_payment', 'placed', 'loading', 'in_transit', 'unloading'];
  /** Deliveries still to come for a product: [{ts, L, order}]. Unpaid orders use their earliest possible arrival. */
  function incoming(ro, p) {
    const out = [];
    W.orders.filter((o) => o.roId === ro.id && OPEN.includes(o.status)).forEach((o) => {
      const line = o.lines.find((l) => l.product === p);
      if (!line) return;
      const ts = o.status === 'awaiting_payment' ? plan(ro, releaseTsFor(o)).usableTs : (o.usableTs || o.arriveTs + C.unloadingMin * MIN);
      out.push({ ts, L: line.kl * 1000, order: o });
    });
    return out.sort((a, b) => a.ts - b.ts);
  }
  /**
   * When usable stock reaches zero, walking forward through the hourly sales curve.
   * Unlike a simple "stock ÷ today's sales so far" (which overstates cover early in the day),
   * this uses the last week's average day and the time of day, and excludes dead stock.
   */
  function forecastDry(ro, p, usableL, deliveries) {
    const step = C.forecastStepMin * MIN;
    let L = usableL, t = Eng.now;
    const end = Eng.now + C.lookaheadHours * HOUR;
    const dels = (deliveries || []).slice();
    if (L <= 0) return t;
    while (t < end) {
      const next = t + step;
      while (dels.length && dels[0].ts <= next) L += dels.shift().L;
      L -= U.expectedBetween(ro.avgDailyL[p], t, next);
      if (L <= 0) return next;
      t = next;
    }
    return null;
  }
  Eng.forecastDry = forecastDry;

  function productMetrics(ro, p) {
    const tanks = tanksOf(ro, p);
    const stockL = sum(tanks, (t) => t.readL);
    const deadL = sum(tanks, (t) => t.deadL);
    const usableL = sum(tanks, (t) => usableOf(t));
    const capL = sum(tanks, (t) => t.capL);
    const todayL = sum(ro.nozzles.filter((n) => n.product === p), (n) => n.todayL);
    const expectedL = U.expectedBetween(ro.avgDailyL[p], ro.book.openTs, Eng.now);
    const inc = incoming(ro, p);
    const dryTs = forecastDry(ro, p, usableL, []);
    const dryWithOrdersTs = forecastDry(ro, p, usableL, inc);
    // Counting only trucks already released or on the road (not orders still waiting for money).
    const dryMovingTs = forecastDry(ro, p, usableL, inc.filter((d) => d.order.status !== 'awaiting_payment'));
    const hoursOpen = (Eng.now - ro.book.openTs) / HOUR;
    return {
      p, stockL, deadL, usableL, capL, ullageL: capL - stockL, todayL, expectedL,
      pace: expectedL > 50 ? todayL / expectedL : 1,
      coverDays: usableL / Math.max(1, ro.avgDailyL[p]),
      // The "stock ÷ today's sales so far" figure many reports show, kept for comparison.
      simpleCoverDays: hoursOpen > 0.5 && todayL > 0 ? usableL / todayL : null,
      dryTs, dryWithOrdersTs, dryMovingTs, incoming: inc,
      pendingL: sum(inc.filter((d) => d.order.status === 'awaiting_payment' || d.order.status === 'placed'), (d) => d.L),
      onWheelsL: sum(inc.filter((d) => d.order.status === 'loading' || d.order.status === 'in_transit' || d.order.status === 'unloading'), (d) => d.L),
      rsp: ro.prices[p].rsp, pump: ro.prices[p].pump,
      atgOk: tanks.every((t) => t.atgOk && Eng.now - t.readTs < C.atgStaleMin * MIN),
    };
  }
  function metrics(ro) {
    const m = { byP: {} };
    ro.products.forEach((p) => { m.byP[p] = productMetrics(ro, p); });
    const list = Object.values(m.byP);
    m.todayL = sum(list, (x) => x.todayL);
    m.todayInr = ro.agg.inr;
    m.expectedL = sum(list, (x) => x.expectedL);
    m.soonest = list.filter((x) => x.dryWithOrdersTs).sort((a, b) => a.dryWithOrdersTs - b.dryWithOrdersTs)[0] || null;
    // Month to date against target
    // Month to date follows the business day (06:00 to 06:00), not the calendar date.
    const bd = new Date(ro.book.openTs + U.IST_OFF);
    const dom = bd.getUTCDate();
    const month = bd.toISOString().slice(0, 7);
    m.mtd = {};
    ro.products.forEach((p) => {
      const prior = sum(ro.hist.filter((h) => h.date.slice(0, 7) === month), (h) => h[p]);
      const done = prior + m.byP[p].todayL;
      const frac = (Eng.now - ro.book.openTs) / DAY;
      const target = ro.targetMonthL[p] / 30 * (dom - 1 + Math.min(1, frac));
      m.mtd[p] = { L: done, targetL: target, ratio: target > 0 ? done / target : 1 };
    });
    return m;
  }
  Eng.metrics = metrics;

  // ---------- Suggested order ----------
  /**
   * What to order for an outlet now: enough to reach the target cover at arrival, limited by the
   * tank space left at arrival, packed into whole compartments of one truck. Returns null when
   * nothing is needed.
   */
  function suggest(ro, opts) {
    const p0 = plan(ro, Eng.now + ((opts && opts.paymentNeeded) ? C.paymentCreditMin * MIN : 0));
    const needs = ro.products.map((p) => {
      const pm = productMetrics(ro, p);
      const tanks = tanksOf(ro, p);
      const sold = U.expectedBetween(ro.avgDailyL[p], Eng.now, p0.usableTs);
      const coming = sum(pm.incoming.filter((d) => d.ts <= p0.usableTs + DAY), (d) => d.L);
      const atArrival = Math.max(sum(tanks, (t) => t.deadL), pm.stockL - sold) + coming;
      const room = pm.capL * (1 - C.ullageReserveFraction) - atArrival;
      const want = C.targetCoverDays * ro.avgDailyL[p] + pm.deadL - atArrival;
      return { p, room: Math.max(0, room), want: Math.max(0, want), urgency: pm.dryWithOrdersTs || Infinity, pm };
    }).sort((a, b) => a.urgency - b.urgency);
    let best = null;
    C.trucks.forEach((tk) => {
      const comps = tk.compartments.slice();
      const lines = {};
      const left = Object.fromEntries(needs.map((n) => [n.p, { room: n.room, want: n.want }]));
      // Fill compartments one at a time with the most urgent product that still wants and fits.
      for (let i = 0; i < comps.length; i++) {
        const size = comps[i] * 1000;
        const n = needs.find((x) => left[x.p].want > size * 0.25 && left[x.p].room >= size);
        if (!n) continue;
        lines[n.p] = (lines[n.p] || 0) + comps[i];
        left[n.p].want -= size; left[n.p].room -= size;
      }
      // A truck pays the same freight full or not: top up spare compartments with whichever
      // product still has room for a whole compartment (most room first).
      if (Object.keys(lines).length) {
        for (let i = Object.values(lines).reduce((a, b) => a + b, 0) / comps[0]; i < comps.length; i++) {
          const size = comps[i] * 1000;
          const n = needs.filter((x) => left[x.p].room >= size).sort((a, b) => left[b.p].room - left[a.p].room)[0];
          if (!n) break;
          lines[n.p] = (lines[n.p] || 0) + comps[i];
          left[n.p].room -= size;
        }
      }
      const kl = Object.values(lines).reduce((a, b) => a + b, 0);
      // Prefer the truck that carries the most useful fuel; a part-empty truck is allowed but scored lower.
      const score = kl - (tk.kl - kl) * 0.6;
      if (kl > 0 && (!best || score > best.score)) best = { score, truckKL: tk.kl, lines: Object.entries(lines).map(([product, k]) => ({ product, kl: k })), emptyKL: tk.kl - kl };
    });
    if (!best) return null;
    const notes = [];
    needs.forEach((n) => {
      const got = (best.lines.find((l) => l.product === n.p) || { kl: 0 }).kl * 1000;
      if (n.want > got + 1000 && n.room < n.want) notes.push(`${pname(n.p)}: tank space at arrival limits the order to ${Math.floor(n.room / 1000)} KL.`);
    });
    if (best.emptyKL) notes.push(`${best.emptyKL} KL of the ${best.truckKL} KL truck would travel empty.`);
    return { truckKL: best.truckKL, lines: best.lines, value: Math.round(U.valueOf(best.lines)), plan: p0, notes };
  }
  Eng.suggest = suggest;

  // ---------- Simulation ----------
  function drain(ro, p, L) {
    const tanks = tanksOf(ro, p).filter((t) => t.stockL > t.deadL + 1).sort((a, b) => (b.stockL - b.deadL) - (a.stockL - a.deadL));
    if (!tanks.length) return false;
    const t = tanks[0];
    t.stockL = Math.max(t.deadL, t.stockL - L * (1 + ro.book.bias));
    return true;
  }
  function stepSales(from, to) {
    W.ros.forEach((ro) => {
      ro.products.forEach((p) => {
        ro.pendingL[p] += U.expectedBetween(ro.avgDailyL[p], from, to) * (0.75 + rand() * 0.5);
        const nozzles = ro.nozzles.filter((n) => n.product === p && !n.silent);
        ro._next = ro._next || {};
        while (nozzles.length) {
          const size = ro._next[p] || (ro._next[p] = U.saleSize(p, rand));
          if (ro.pendingL[p] < size) break;
          ro.pendingL[p] -= size; ro._next[p] = 0;
          if (!drain(ro, p, size)) { ro.lostL = (ro.lostL || 0) + size; nozzles.forEach((n) => { n.status = 'Dry'; }); continue; }
          const n = nozzles[Math.floor(rand() * nozzles.length)];
          const ts = from + rand() * (to - from);
          U.recordSale(ro, n, size, ts, rand);
          n.status = 'Dispensing'; n.until = Eng.now + (size / n.flowLpm) * MIN;
          ro.hourly[U.istHour(ts)][p] += size;
        }
        ro.nozzles.forEach((n) => { if (n.status === 'Dispensing' && n.until < Eng.now) n.status = 'Idle'; if (n.status === 'Dry' && sum(tanksOf(ro, n.product), (t) => t.stockL - t.deadL) > 50) n.status = 'Idle'; });
      });
    });
  }
  /** At 06:00 the business day closes: yesterday joins the history and the stock book reopens. */
  function rollover(ts) {
    W.ros.forEach((ro) => {
      const row = { date: new Date(ro.book.openTs + U.IST_OFF).toISOString().slice(0, 10), total: 0 };
      ro.products.forEach((p) => { row[p] = sum(ro.nozzles.filter((n) => n.product === p), (n) => n.todayL); row.total += row[p]; });
      ro.hist.push(row); if (ro.hist.length > 30) ro.hist.shift();
      ro.nozzles.forEach((n) => { n.todayL = 0; });
      ro.agg = U.emptyAgg();
      ro.hourly = Array.from({ length: 24 }, () => Object.fromEntries(ro.products.map((p) => [p, 0])));
      ro.book.openTs = ts;
      ro.tanks.forEach((t) => { if (t.atgOk) { t.readL = t.stockL; t.readTs = ts; } });
      ro.products.forEach((p) => { ro.book.openL[p] = sum(tanksOf(ro, p), (t) => t.readL); ro.book.receiptL[p] = 0; ro.book.nozzleAtReadL[p] = 0; });
    });
    log('New business day: yesterday\'s sales moved to history and the stock book reopened at the morning dip');
  }
  function syncSources(prev) {
    const crossed = (min) => Math.floor((prev - W.startTs) / (min * MIN)) !== Math.floor((Eng.now - W.startTs) / (min * MIN));
    if (crossed(C.refresh.atg)) W.ros.forEach((ro) => { ro.tanks.forEach((t) => { if (t.atgOk) { t.readL = t.stockL; t.readTs = Eng.now; } }); snapNozzles(ro); });
  }
  /** Nozzle sales at the moment of the last tank-gauge reading, so the stock book compares like with like. */
  function snapNozzles(ro) { ro.products.forEach((p) => { ro.book.nozzleAtReadL[p] = sum(ro.nozzles.filter((n) => n.product === p), (n) => n.todayL); }); }
  Eng.lastSync = (src) => W.startTs + Math.floor((Eng.now - W.startTs) / (C.refresh[src] * MIN)) * C.refresh[src] * MIN;

  function decant(ro, o) {
    const got = {};
    o.lines.forEach((l) => {
      // A small natural transit loss; the tank gauge measures what actually went in.
      let L = l.kl * 1000 - Math.round(rand() * l.kl * 1000 * C.transitLossFraction * 0.8);
      got[l.product] = L;
      tanksOf(ro, l.product).sort((a, b) => a.stockL / a.capL - b.stockL / b.capL).forEach((t) => {
        const put = Math.min(L, t.capL - t.stockL); t.stockL += put; t.readL = t.stockL; t.readTs = Eng.now; L -= put;
      });
      if (L > 1) got[l.product] -= L; // no room left: the rest stays in the truck
      ro.book.receiptL[l.product] += got[l.product];
    });
    // Decanting refreshes every reading of those tanks; keep the stock book consistent with it.
    ro.tanks.forEach((t) => { t.readL = t.stockL; t.readTs = Eng.now; });
    snapNozzles(ro);
    o.atgReceivedL = got;
    o.densityObs = Object.fromEntries(o.lines.map((l) => [l.product, +((rand() - 0.5) * 1.6).toFixed(1)]));
  }
  function stepOrders() {
    W.orders.forEach((o) => {
      const ro = W.byId(o.roId);
      if (o.status === 'awaiting_payment' && available() >= o.value) release(o);
      else if (o.status === 'placed' && Eng.now >= o.loadStartTs) {
        o.status = 'loading'; o.truck = U.truck();
        log(`Truck ${o.truck.plate} loading ${o.truckKL} KL for ${ro.name} (${o.id})`, ro.id);
      } else if (o.status === 'loading' && Eng.now >= o.loadStartTs + C.loadingMin * MIN) {
        o.status = 'in_transit'; o.dispatchTs = Eng.now; o.arriveTs = Eng.now + ro.routeMin * MIN; o.usableTs = o.arriveTs + C.unloadingMin * MIN;
        o.invoice = { no: U.invoiceNo(), ts: Eng.now };
        W.ledger.push({ ts: Eng.now, type: 'Invoice', ref: o.invoice.no, roId: ro.id, debit: o.value, credit: 0, note: o.lines.map((l) => `${l.product} ${l.kl} KL`).join(' + ') });
        log(`Invoice ${o.invoice.no} raised and truck ${o.truck.plate} dispatched to ${ro.name}`, ro.id, 'ok');
      } else if (o.status === 'in_transit' && Eng.now >= o.arriveTs) {
        o.status = 'unloading';
        log(`Truck ${o.truck.plate} arrived at ${ro.name}; unloading started`, ro.id);
      } else if (o.status === 'unloading' && Eng.now >= o.arriveTs + C.unloadingMin * MIN) {
        decant(ro, o);
        o.status = 'awaiting_receipt'; o.unloadedTs = Eng.now;
        log(`${o.id} unloaded at ${ro.name}. Confirm the receipt.`, ro.id, 'ok');
      }
    });
  }
  function release(o) {
    const ro = W.byId(o.roId);
    Object.assign(o, plan(ro, Eng.now));
    o.status = 'placed';
    log(`${o.id} released to the supply point; loading from ${fmtHM(o.loadStartTs)}`, ro.id, 'ok');
  }
  function stepPayments() {
    W.payments.forEach((p) => {
      if (p.status === 'pending' && Eng.now >= p.ts + C.paymentCreditMin * MIN) {
        p.status = 'credited'; p.creditedTs = Eng.now;
        W.ledger.push({ ts: Eng.now, type: 'Payment', ref: p.utr, roId: null, debit: 0, credit: p.amount, note: p.mode + ' received' });
        log(`${p.mode} of ${inr(p.amount)} credited (UTR ${p.utr})`, null, 'ok');
      }
    });
  }
  const REPLIES = {
    Supply: 'Noted. I have asked the supply point to load your truck first in the queue and will follow up on the dispatch.',
    Payment: 'I have checked with the accounts team; the credit will reflect within the hour. Your order will release automatically.',
    Service: 'A service engineer has been booked and will visit today. Please keep the dispenser key ready.',
    Compliance: 'Thank you. I have updated the compliance record. Keep the original receipt for the next inspection.',
    Claim: 'Claim received. The supply point will verify the dip chart and seal numbers; the credit note follows once verified.',
    Other: 'Noted, I will get back to you shortly.',
  };
  function stepMessages() {
    W.threads.forEach((th) => {
      const last = th.msgs[th.msgs.length - 1];
      if (last.from === 'dealer' && Eng.now >= last.ts + C.soReplyMin * MIN) {
        th.msgs.push({ from: 'so', who: W.officer, ts: Eng.now, text: REPLIES[th.cat] || REPLIES.Other });
        th.unread = true;
        log(`Sales Officer replied: ${th.subject}`, th.roId, 'msg');
      }
    });
  }
  function stepJobs() {
    const due = Eng.jobs.filter((j) => j.at <= Eng.now);
    Eng.jobs = Eng.jobs.filter((j) => j.at > Eng.now);
    due.forEach((j) => j.fn());
  }

  Eng.advance = function (simMs) {
    let left = simMs;
    while (left > 0) {
      const dt = Math.min(left, 60000);
      const prev = Eng.now;
      Eng.now += dt;
      const boundary = W.ros[0].book.openTs + DAY;
      if (Eng.now >= boundary) rollover(boundary);
      stepSales(prev, Eng.now);
      syncSources(prev);
      stepOrders(); stepPayments(); stepMessages(); stepJobs();
      left -= dt;
    }
    Eng.version++;
  };
  Eng.notify = () => Eng.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  // ---------- Formatting used in rule text (kept here so Node checks see the same words) ----------
  const TZ = 'Asia/Kolkata';
  function fmtHM(ts) { return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }); }
  function when(ts) {
    if (ts == null) return 'not within 3 days';
    const d = U.istMidnight(ts) - U.istMidnight(Eng.now);
    const day = d === 0 ? 'today' : d === DAY ? 'tomorrow' : d === -DAY ? 'yesterday' : new Date(ts).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
    return `${day} ${fmtHM(ts)}`;
  }
  function inr(v) {
    if (Math.abs(v) >= 100000) return '₹' + (v / 100000).toFixed(2) + ' lakh';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
  function litres(L) { return Math.round(L).toLocaleString('en-IN') + ' L'; }
  function hrs(ms) { const h = ms / HOUR; return h < 1 ? Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? h.toFixed(h < 10 ? 1 : 0) + ' h' : (h / 24).toFixed(1) + ' days'; }
  Eng.fmt = { hm: fmtHM, when, inr, litres, hrs };

  // ---------- Recommendations ----------
  const SEV_W = { critical: 1000, high: 600, medium: 300, low: 100 };
  function score(rec) {
    let s = SEV_W[rec.sev];
    if (rec.deadline) { const h = (rec.deadline - Eng.now) / HOUR; s += h < 6 ? 300 : h < 24 ? 150 : 0; }
    s += Math.log10((rec.inr || 0) + 1) * 30;
    return s;
  }
  function rules() {
    const out = [];
    const add = (r) => out.push(r);
    const money = Eng.money();
    W.ros.forEach((ro) => {
      const m = metrics(ro);
      // A new order needs a payment first unless the balance already covers the suggested load.
      const sug = suggest(ro);
      const fresh = plan(ro, Eng.now + (!sug || money.available < sug.value ? C.paymentCreditMin * MIN : 0));
      ro.products.forEach((p) => {
        const pm = m.byP[p];
        const P = pname(p);
        const rate = ro.avgDailyL[p] * DB.HOURLY[U.istHour(Eng.now)];
        const evidence = [
          ['Usable stock', `${litres(pm.usableL)} (dead stock ${litres(pm.deadL)} excluded)`],
          ['Selling now', `about ${litres(rate)} an hour`],
          ['Runs dry', when(pm.dryTs)],
        ];
        const salesAtRisk = (fromTs, toTs) => U.expectedBetween(ro.avgDailyL[p], fromTs, toTs) * ro.prices[p].rsp;
        const waiting = pm.incoming.find((d) => d.order.status === 'awaiting_payment');
        const moving = pm.incoming.find((d) => d.order.status !== 'awaiting_payment');
        // Decisions use the run-dry time counting trucks already released or on the road, so a
        // delivery that is too small to last still leaves a recommendation.
        const D = pm.dryMovingTs;
        if (!D) return;
        evidence[2] = ['Runs dry', when(D) + (moving ? ` (after ${moving.order.id} arrives)` : '')];
        const lateTruck = moving && moving.ts > pm.dryTs;
        if (lateTruck) {
          add({
            key: `late:${moving.order.id}:${p}`, sev: 'high', cat: 'Supply', roId: ro.id, deadline: pm.dryTs,
            title: `Your truck reaches ${ro.name} after ${P.toLowerCase()} runs out`,
            why: `${P} runs dry ${when(pm.dryTs)}; ${moving.order.id} is expected ${when(moving.ts)}.`,
            impact: `About ${hrs(moving.ts - pm.dryTs)} without ${P.toLowerCase()}: ${inr(salesAtRisk(pm.dryTs, moving.ts))} of sales at risk.`,
            inr: salesAtRisk(pm.dryTs, moving.ts),
            action: { kind: 'escalate', label: 'Ask the Sales Officer to prioritise', cat: 'Supply', subject: `Prioritise ${moving.order.id} for ${ro.name}`,
              text: `${P} at ${ro.name} (${ro.id}) runs dry ${when(pm.dryTs)} but ${moving.order.id} is expected ${when(moving.ts)}. Please prioritise loading.` },
            evidence: evidence.concat([['Truck expected', when(moving.ts)]]),
          });
        }
        if (waiting) {
          const o = waiting.order;
          const short = stillToPay(o);
          const arrive = plan(ro, releaseTsFor(o)).usableTs;
          if (short > 0 && D - Eng.now < C.lookaheadHours * HOUR) {
            const late = arrive > D;
            add({
              key: `pay-order:${o.id}`, sev: D - Eng.now < 24 * HOUR ? 'critical' : 'high', cat: 'Supply', roId: ro.id, deadline: D,
              title: `Pay ${inr(short)} to release your ${P.toLowerCase()} order for ${ro.name}`,
              why: `${P} runs dry ${when(D)}. Order ${o.id} (${o.lines.map((l) => `${l.product} ${l.kl} KL`).join(' + ')}) is waiting for payment: available ${inr(money.available)}${money.pending ? `, ${inr(money.pending)} on its way` : ''}, order ${inr(o.value)}.`,
              impact: late ? `Even paid now it arrives ${when(arrive)}: about ${hrs(arrive - D)} dry. ${inr(salesAtRisk(D, arrive))} of sales at risk.` : `Paid now, the truck arrives ${when(arrive)}, ${hrs(D - arrive)} before the tank runs dry.`,
              inr: salesAtRisk(D, Math.max(arrive, D + 6 * HOUR)),
              action: { kind: 'pay', label: `Pay ${inr(short)}`, amount: short, orderId: o.id },
              evidence: evidence.concat([['Order value', inr(o.value)], ['Available balance', inr(money.available)]]),
            });
          } else if (short <= 0 && arrive > D && !lateTruck) {
            // Paid (or paying) but it still lands too late: the only lever left is the Sales Officer.
            add({
              key: `paid-late:${o.id}:${p}`, sev: 'high', cat: 'Supply', roId: ro.id, deadline: D,
              title: `${o.id} arrives after ${P.toLowerCase()} runs out at ${ro.name}`,
              why: `Payment is ${money.pending ? 'on its way' : 'in'}; the order releases ${when(releaseTsFor(o))} and arrives ${when(arrive)}, but ${P.toLowerCase()} runs dry ${when(D)}.`,
              impact: `About ${hrs(arrive - D)} dry: ${inr(salesAtRisk(D, arrive))} of sales at risk.`,
              inr: salesAtRisk(D, arrive),
              action: { kind: 'escalate', label: 'Ask the Sales Officer to prioritise', cat: 'Supply', subject: `Prioritise ${o.id} for ${ro.name}`,
                text: `${P} at ${ro.name} (${ro.id}) runs dry ${when(D)}. ${o.id} is paid and arrives ${when(arrive)}. Please prioritise loading.` },
              evidence,
            });
          }
          return;
        }
        if (lateTruck) return;
        // When must a new order go in to arrive with a safety margin?
        const orderBy = D - C.safetyHours * HOUR - (fresh.usableTs - Eng.now);
        if (orderBy - Eng.now < 12 * HOUR) {
          const late = fresh.usableTs > D;
          const open = W.orders.find((o) => o.roId === ro.id && (o.status === 'awaiting_payment' || o.status === 'placed'));
          add({
            key: `order:${ro.id}:${p}`, sev: late || D - Eng.now < 12 * HOUR ? 'critical' : 'high', cat: 'Supply', roId: ro.id, deadline: D,
            title: `Order ${P.toLowerCase()} for ${ro.name} ${orderBy <= Eng.now ? 'now' : 'by ' + when(orderBy)}`,
            why: `${P} runs dry ${when(D)}${moving ? ` even after ${moving.order.id} arrives` : ' and nothing is on order'}. An order placed now arrives ${when(fresh.usableTs)}.`,
            impact: late ? `${inr(salesAtRisk(D, fresh.usableTs))} of sales at risk even if ordered now.` : `Ordering later than ${when(Math.max(Eng.now, orderBy))} risks running dry; about ${inr(salesAtRisk(D, D + 6 * HOUR))} of sales in the first 6 hours dry.`,
            inr: salesAtRisk(D, D + 6 * HOUR),
            action: { kind: 'order', label: open ? `Add ${P.toLowerCase()} to ${open.id}` : 'Review suggested order', roId: ro.id },
            evidence,
          });
        }
      });

      // Price on the pump differs from today's notified retail price, or presets still use the old one.
      ro.products.forEach((p) => {
        const pr = ro.prices[p];
        const presets = ro.nozzles.filter((n) => n.product === p && !n.presetOk).map((n) => n.id);
        if (Math.abs(pr.pump - pr.rsp) < 0.005 && !presets.length) return;
        const perDay = Math.abs(pr.rsp - pr.pump) * ro.avgDailyL[p];
        add({
          key: `rsp:${ro.id}:${p}`, sev: 'critical', cat: 'Integrity', roId: ro.id,
          title: `${pname(p)} at ${ro.name} is selling at ₹${pr.pump.toFixed(2)}; today's price is ₹${pr.rsp.toFixed(2)}`,
          why: `The pump was not updated at the ${fmtHM(ro.priceRevisedTs)} price revision.${presets.length ? ` Presets on ${presets.join(', ')} still use the old price.` : ''} Selling at any other price is an irregularity on inspection.`,
          impact: `${pr.pump < pr.rsp ? 'Losing' : 'Overcharging customers by'} about ${inr(perDay)} a day, plus a penalty risk.`,
          inr: perDay * 5,
          action: { kind: 'price', label: 'I\'ve updated the pump', roId: ro.id, product: p },
          evidence: [['Pump price', '₹' + pr.pump.toFixed(2)], ['Notified price', '₹' + pr.rsp.toFixed(2)], ['Litres sold today at the wrong price', litres(m.byP[p].todayL)]],
        });
      });

      // A nozzle has sold nothing since opening while the others on the same product sell.
      const hoursOpen = (Eng.now - ro.book.openTs) / HOUR;
      ro.nozzles.forEach((n) => {
        if (n.todayL > 0 || hoursOpen < C.nilSellingHours || n.ticket) return;
        const peers = ro.nozzles.filter((x) => x.product === n.product && x !== n);
        const avg = peers.length ? sum(peers, (x) => x.todayL) / peers.length : 0;
        if (avg < C.nilPeerMinL) return;
        const perDay = (ro.avgDailyL[n.product] / (peers.length + 1)) * C.dealerMarginPerL[n.product];
        add({
          key: `nil:${ro.id}:${n.id}`, sev: 'high', cat: 'Equipment', roId: ro.id,
          title: `Nozzle ${n.id} at ${ro.name} has sold nothing since ${fmtHM(ro.book.openTs)}`,
          why: `The other ${peers.length} ${pname(n.product).toLowerCase()} nozzles sold ${litres(avg)} each. A silent nozzle means longer queues and customers driving on.`,
          impact: `Its share of sales is worth about ${inr(perDay)} a day in dealer margin.`,
          inr: perDay * 3,
          action: { kind: 'ticket', label: 'Raise a service complaint', roId: ro.id, nozzle: n.id, fix: 'nozzle', subject: `Nozzle ${n.id} (${n.du}) not dispensing at ${ro.name}`, text: `Nozzle ${n.id} on ${n.du} has recorded no sale since ${fmtHM(ro.book.openTs)}. Please send an engineer.` },
          evidence: [['Nozzle', `${n.id} on ${n.du} (${pname(n.product)})`], ['Sold today', '0 L'], ['Other nozzles, average', litres(avg)]],
        });
      });

      // Flow-rate variance: a nozzle dispensing much slower than its peers.
      ro.nozzles.forEach((n) => {
        if (n.ticket) return;
        const peers = ro.nozzles.filter((x) => x.product === n.product && x !== n);
        if (!peers.length) return;
        const avg = sum(peers, (x) => x.flowLpm) / peers.length;
        const gap = (avg - n.flowLpm) / avg * 100;
        if (gap < C.flowVariancePct) return;
        add({
          key: `flow:${ro.id}:${n.id}`, sev: 'medium', cat: 'Integrity', roId: ro.id,
          title: `Nozzle ${n.id} at ${ro.name} dispenses ${Math.round(gap)}% slower than the others`,
          why: `${n.flowLpm.toFixed(1)} L/min against ${avg.toFixed(1)} L/min on the other ${pname(n.product).toLowerCase()} nozzles. Flow-rate variance needs a calibration check and an action-taken report.`,
          impact: 'Slow nozzles lengthen queues; a meter fault can also mean short or excess delivery to customers.',
          inr: 1500,
          action: { kind: 'ticket', label: 'Book calibration', roId: ro.id, nozzle: n.id, fix: 'flow', subject: `Calibration for nozzle ${n.id} at ${ro.name}`, text: `Nozzle ${n.id} (${n.du}) flows at ${n.flowLpm.toFixed(1)} L/min against ${avg.toFixed(1)} on its peers. Please calibrate.` },
          evidence: [['This nozzle', n.flowLpm.toFixed(1) + ' L/min'], ['Others, average', avg.toFixed(1) + ' L/min']],
        });
      });

      // Critical dispenser events need an explanation (action-taken report).
      ro.logs.filter((l) => l.critical && !l.atr).forEach((l) => add({
        key: `log:${l.id}`, sev: 'high', cat: 'Integrity', roId: ro.id,
        title: `${l.type} on ${l.du} at ${ro.name}: explain it in an action-taken report`,
        why: `${l.text} Logged ${when(l.ts)}.`,
        impact: 'Unexplained critical events are flagged to the oil company and can trigger an inspection.',
        inr: 5000,
        action: { kind: 'atr', label: 'Write action-taken report', roId: ro.id, logId: l.id },
        evidence: [['Event', l.type], ['Dispenser', l.du], ['When', when(l.ts)]],
      }));

      // Water at the bottom of a tank.
      ro.tanks.forEach((t) => {
        if (t.waterMm <= C.waterMaxMm || t.draining) return;
        add({
          key: `water:${ro.id}:${t.id}`, sev: 'medium', cat: 'Quality', roId: ro.id,
          title: `Water in ${pname(t.product).toLowerCase()} tank ${t.id} at ${ro.name}: ${t.waterMm} mm`,
          why: `Above the ${C.waterMaxMm} mm limit. Water reaching the suction contaminates fuel sold to customers.`,
          impact: 'Quality complaints and a failed sample cost far more than draining it now.',
          inr: 4000,
          action: { kind: 'ticket', label: 'Book water draining', roId: ro.id, tank: t.id, fix: 'water', subject: `Water draining for tank ${t.id} at ${ro.name}`, text: `Tank ${t.id} (${pname(t.product)}) shows ${t.waterMm} mm of water. Please arrange draining.` },
          evidence: [['Water level', t.waterMm + ' mm'], ['Limit', C.waterMaxMm + ' mm']],
        });
      });

      // Tank gauge not reporting: cover figures may be wrong.
      ro.tanks.forEach((t) => {
        if (t.atgOk && Eng.now - t.readTs < C.atgStaleMin * MIN) return;
        add({
          key: `atg:${ro.id}:${t.id}`, sev: 'medium', cat: 'Equipment', roId: ro.id,
          title: `Tank gauge ${t.id} at ${ro.name} not reporting for ${hrs(Eng.now - t.readTs)}`,
          why: 'Stock, cover and run-dry times for this tank are based on its last reading.',
          impact: 'Orders may be planned on wrong numbers.', inr: 2000,
          action: { kind: 'ticket', label: 'Raise a service complaint', roId: ro.id, tank: t.id, fix: 'atg', subject: `Tank gauge ${t.id} offline at ${ro.name}`, text: `The automatic tank gauge on ${t.id} has not reported since ${when(t.readTs)}.` },
          evidence: [['Last reading', when(t.readTs)]],
        });
      });

      // Compliance renewals.
      ro.compliance.forEach((c) => {
        const days = Math.ceil((c.due - Eng.now) / DAY);
        if (days > C.complianceWarnDays || c.booked) return;
        add({
          key: `lic:${ro.id}:${c.key}`, sev: days <= C.complianceUrgentDays ? 'high' : 'medium', cat: 'Compliance', roId: ro.id, deadline: c.due,
          title: days < 0 ? `${c.label} at ${ro.name} expired ${-days} day${days === -1 ? '' : 's'} ago` : `${c.label} at ${ro.name} expires in ${days} day${days === 1 ? '' : 's'}`,
          why: `Due ${new Date(c.due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })}. Book it now; slots with the authority fill up.`,
          impact: 'Operating with an expired certificate can stop sales from the affected dispensers.',
          inr: days <= C.complianceUrgentDays ? 20000 : 5000,
          action: { kind: 'renewal', label: 'Book the renewal', roId: ro.id, key: c.key },
          evidence: [['Expires', when(c.due)]],
        });
      });
      ro.observations.forEach((ob, i) => {
        if (ob.status !== 'Open') return;
        add({
          key: `obs:${ro.id}:${i}`, sev: 'medium', cat: 'Compliance', roId: ro.id,
          title: `Close the inspection observation at ${ro.name}`,
          why: `${ob.text}. Open since ${when(ob.ts)}.`,
          impact: 'Open observations count against the outlet at the next inspection.', inr: 3000,
          action: { kind: 'observation', label: 'Mark fixed and send proof', roId: ro.id, index: i },
          evidence: [['Raised', when(ob.ts)]],
        });
      });

      // Month-to-date behind target: show where the gap is.
      ro.products.forEach((p) => {
        const t = m.mtd[p];
        if (t.ratio >= C.targetWarnRatio || t.targetL < 1000) return;
        // Weakest complete hour of today's business day (the current hour is still filling up).
        const nowH = U.istHour(Eng.now);
        const elapsed = Math.floor((Eng.now - ro.book.openTs) / HOUR);
        const hoursDone = Array.from({ length: elapsed }, (_, k) => (C.openingHour + k) % 24).filter((h) => h !== nowH);
        const worst = hoursDone.map((i) => ({ i, got: ro.hourly[i][p], exp: ro.avgDailyL[p] * DB.HOURLY[i] }))
          .filter((h) => h.exp >= 50).sort((a, b) => (a.got - a.exp) - (b.got - b.exp))[0];
        add({
          key: `target:${ro.id}:${p}`, sev: 'low', cat: 'Sales', roId: ro.id,
          title: `${pname(p)} at ${ro.name} is ${Math.round((1 - t.ratio) * 100)}% behind this month's target`,
          why: `${litres(t.L)} sold against ${litres(t.targetL)} expected by now.${worst ? ` Today's weakest hour so far: ${String(worst.i).padStart(2, '0')}:00, ${litres(Math.max(0, worst.exp - worst.got))} below the usual.` : ''}`,
          impact: `Closing the gap is worth about ${inr((t.targetL - t.L) * C.dealerMarginPerL[p])} in margin.`,
          inr: (t.targetL - t.L) * C.dealerMarginPerL[p] * 0.2,
          action: { kind: 'view', label: 'See sales by hour', roId: ro.id, tab: 'sales' },
          evidence: [['Month to date', litres(t.L)], ['Target to date', litres(t.targetL)]],
        });
      });
    });

    // Deliveries waiting for the dealer's receipt (and shortage claims).
    W.orders.filter((o) => o.status === 'awaiting_receipt').forEach((o) => {
      const ro = W.byId(o.roId);
      const short = o.lines.map((l) => ({ p: l.product, inv: l.kl * 1000, got: o.atgReceivedL[l.product] })).map((x) => Object.assign(x, { short: x.inv - x.got, allowed: x.inv * C.transitLossFraction }));
      const claimable = short.filter((x) => x.short > x.allowed);
      const closes = o.unloadedTs + C.claimWindowHours * HOUR;
      if (claimable.length) {
        const val = sum(claimable, (x) => x.short * U.purchasePrice(x.p));
        add({
          key: `claim:${o.id}`, sev: 'high', cat: 'Supply', roId: ro.id, deadline: closes,
          title: `Raise a claim: ${claimable.map((x) => `${litres(x.short)} ${pname(x.p).toLowerCase()}`).join(', ')} short on ${o.id}`,
          why: `The tank gauge measured ${claimable.map((x) => `${litres(x.got)} of ${litres(x.inv)} invoiced`).join('; ')} (allowed loss ${claimable.map((x) => litres(x.allowed)).join(', ')}). Delivered ${when(o.unloadedTs)}.`,
          impact: `${inr(val)} recoverable. The claim window closes ${when(closes)}.`,
          inr: val,
          action: { kind: 'receipt', label: 'Review and raise claim', orderId: o.id },
          evidence: [['Invoice', o.invoice ? o.invoice.no : '—'], ['Truck', o.truck ? o.truck.plate : '—']],
        });
      } else {
        add({
          key: `receipt:${o.id}`, sev: 'medium', cat: 'Supply', roId: ro.id, deadline: closes,
          title: `Confirm the receipt of ${o.id} at ${ro.name}`,
          why: `Unloaded ${when(o.unloadedTs)}; the gauge readings are within tolerance.`,
          impact: 'Confirming closes the order and records the dips and density check for audits.', inr: 500,
          action: { kind: 'receipt', label: 'Record receipt', orderId: o.id },
          evidence: [],
        });
      }
    });

    // Payments not credited for a long time.
    W.payments.filter((p) => p.status === 'pending' && Eng.now - p.ts > C.paymentLateMin * MIN).forEach((p) => add({
      key: `paylate:${p.id}`, sev: 'medium', cat: 'Payment', roId: null,
      title: `Your ${p.mode} of ${inr(p.amount)} hasn't been credited after ${hrs(Eng.now - p.ts)}`,
      why: `UTR ${p.utr}. Credits normally show within ${C.paymentCreditMin} minutes.`,
      impact: 'Orders waiting for this money stay on hold.', inr: p.amount * 0.01,
      action: { kind: 'escalate', label: 'Ask the Sales Officer', cat: 'Payment', subject: `Payment ${p.utr} not credited`, text: `${p.mode} of ${inr(p.amount)} sent ${when(p.ts)} (UTR ${p.utr}) is not yet credited.` },
      evidence: [['UTR', p.utr]],
    }));

    out.forEach((rec) => { rec.score = score(rec); });
    return out.sort((a, b) => b.score - a.score);
  }
  /** The ranked recommendations the dealer still needs to see (not done, dismissed or snoozed). */
  // Rules are evaluated once per clock step and state change, not once per caller.
  let memo = { at: null, out: [] };
  function rulesNow() {
    const at = Eng.now + ':' + Eng.version;
    if (memo.at !== at) memo = { at, out: rules() };
    return memo.out;
  }
  const businessDay = () => W.ros[0].book.openTs;
  Eng.recommendations = function (roId) {
    const all = rulesNow();
    // "Done" and "Not relevant" apply to this occurrence only: they lapse when the condition
    // clears (so it can come back later) or when the business day rolls over.
    const live = new Set(all.map((r) => r.key));
    Object.keys(W.recState).forEach((k) => { if (!live.has(k)) delete W.recState[k]; });
    return all.filter((r) => {
      if (roId && r.roId && r.roId !== roId) return false;
      const st = W.recState[r.key];
      if (!st) return true;
      if (st.state === 'snoozed') return Eng.now >= st.until;
      return st.day !== businessDay();
    });
  };
  Eng.allRules = rulesNow;

  // ---------- Actions (each one leaves a record in the activity log) ----------
  function newThread(cat, subject, text, roId) {
    const th = { id: 'MSG-' + (W.threads.length + 1), subject, roId: roId || null, cat, status: 'Open', msgs: [{ from: 'dealer', who: W.dealer.name, ts: Eng.now, text }] };
    W.threads.unshift(th);
    return th;
  }
  Eng.validateOrder = function (roId, lines, truckKL, replaceId) {
    const ro = W.byId(roId);
    const tk = C.trucks.find((t) => t.kl === truckKL);
    if (!ro || !tk) return 'Choose an outlet and a truck size.';
    const total = sum(lines, (l) => l.kl);
    if (!lines.length || total <= 0) return 'Add at least one compartment.';
    if (total > tk.kl) return `That is ${total} KL; the truck carries ${tk.kl} KL.`;
    const comp = tk.compartments[0];
    if (lines.some((l) => l.kl % comp !== 0)) return `Each product must fill whole ${comp} KL compartments.`;
    if (lines.some((l) => !ro.products.includes(l.product))) return 'This outlet has no tank for one of those products.';
    for (const l of lines) {
      const pm = productMetrics(ro, l.product);
      if (l.kl * 1000 > pm.capL * (1 - C.ullageReserveFraction) - pm.deadL) return `${pname(l.product)}: ${l.kl} KL will not fit in the tanks even when nearly empty.`;
    }
    if (W.orders.some((o) => o.roId === roId && o.id !== replaceId && (o.status === 'awaiting_payment' || o.status === 'placed'))) return 'This outlet already has an order waiting to load. Change that one instead.';
    return null;
  };
  Eng.actions = {
    /** Place an order; with replaceId, the outlet's waiting order is cancelled and replaced. */
    placeOrder(roId, lines, truckKL, replaceId) {
      const err = Eng.validateOrder(roId, lines, truckKL, replaceId);
      if (err) return { error: err };
      const ro = W.byId(roId);
      if (replaceId) {
        const old = W.orderById(replaceId);
        if (!old || old.roId !== roId || (old.status !== 'awaiting_payment' && old.status !== 'placed')) return { error: 'That order has already started loading and cannot be changed.' };
        old.status = 'cancelled';
        log(`Order ${old.id} replaced by a changed order`, roId);
      }
      const clean = lines.filter((l) => l.kl > 0);
      const o = { id: U.orderNo(Eng.now), roId, lines: clean, truckKL, value: Math.round(U.valueOf(clean)), status: 'awaiting_payment', createdTs: Eng.now, depotId: ro.depotId, invoice: null, truck: null, receipt: null };
      W.orders.unshift(o);
      log(`Order ${o.id} placed for ${ro.name}: ${clean.map((l) => `${l.product} ${l.kl} KL`).join(' + ')} (${inr(o.value)})`, roId, 'ok');
      if (available() >= o.value) release(o);
      Eng.version++;
      return { order: o };
    },
    cancelOrder(id) {
      const o = W.orderById(id);
      if (!o || (o.status !== 'awaiting_payment' && o.status !== 'placed')) return { error: 'Only orders that have not started loading can be cancelled.' };
      o.status = 'cancelled';
      log(`Order ${o.id} cancelled`, o.roId);
      Eng.version++;
      return { order: o };
    },
    validatePayment(amount, mode, utr) {
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return 'Enter the amount you sent (up to ₹100 crore).';
      if (mode === 'RTGS' && amount < C.rtgsMinInr) return `RTGS is for ${inr(C.rtgsMinInr)} and above. Use NEFT for smaller amounts.`;
      if (!C.utrPatterns[mode]) return 'Choose RTGS or NEFT.';
      const u = String(utr || '').trim().toUpperCase();
      if (!C.utrPatterns[mode].test(u)) return mode === 'RTGS' ? 'An RTGS UTR has 22 characters: 4 letters, R, then 17 letters or digits.' : 'A NEFT UTR has 16 characters, starting with 4 letters.';
      if (W.payments.some((p) => p.utr === u)) return 'This UTR has already been recorded.';
      return null;
    },
    recordPayment(amount, mode, utr) {
      const err = Eng.actions.validatePayment(amount, mode, utr);
      if (err) return { error: err };
      const p = { id: 'PAY-' + Math.floor(100000 + rand() * 899999), mode, amount: Math.round(amount), utr: String(utr).trim().toUpperCase(), ts: Eng.now, status: 'pending', creditedTs: null };
      W.payments.unshift(p);
      log(`${mode} of ${inr(p.amount)} recorded (UTR ${p.utr}); waiting for credit`, null, 'ok');
      Eng.version++;
      return { payment: p };
    },
    demoUtr(mode) {
      const d = new Date(Eng.now + U.IST_OFF).toISOString().slice(0, 10).replace(/-/g, '');
      const rnd = (n) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('');
      return mode === 'RTGS' ? 'DEMOR5' + d + rnd(8) : 'DEMO' + d.slice(2) + rnd(6);
    },
    recordReceipt(id, claim) {
      const o = W.orderById(id);
      if (!o || o.status !== 'awaiting_receipt') return { error: 'This delivery is not waiting for a receipt.' };
      const ro = W.byId(o.roId);
      o.receipt = { ts: Eng.now, lines: o.lines.map((l) => ({ product: l.product, invoiceL: l.kl * 1000, receivedL: o.atgReceivedL[l.product], densityDiff: o.densityObs[l.product] })), claim: null };
      if (claim) {
        const items = o.receipt.lines.filter((x) => x.invoiceL - x.receivedL > x.invoiceL * C.transitLossFraction);
        const value = Math.round(sum(items, (x) => (x.invoiceL - x.receivedL) * U.purchasePrice(x.product)));
        o.receipt.claim = { ts: Eng.now, value, status: 'Raised', items: items.map((x) => ({ product: x.product, shortL: x.invoiceL - x.receivedL })) };
        o.status = 'claim_raised';
        newThread('Claim', `Short-receipt claim on ${o.id}`, `Claim for ${items.map((x) => `${litres(x.invoiceL - x.receivedL)} ${pname(x.product).toLowerCase()}`).join(', ')} on invoice ${o.invoice.no} (${inr(value)}). Tank gauge readings and seal numbers attached.`, ro.id);
        log(`Short-receipt claim raised on ${o.id} for ${inr(value)}`, ro.id, 'ok');
        later(C.soReplyMin * 6, () => {
          o.receipt.claim.status = 'Accepted'; o.status = 'received';
          W.ledger.push({ ts: Eng.now, type: 'Credit note', ref: 'CN-' + Math.floor(100000 + rand() * 899999), roId: ro.id, debit: 0, credit: value, note: `Short-receipt claim on ${o.id} accepted` });
          log(`Claim on ${o.id} accepted: credit note for ${inr(value)}`, ro.id, 'ok');
        });
      } else {
        o.status = 'received';
        log(`Receipt of ${o.id} confirmed at ${ro.name}`, ro.id, 'ok');
      }
      Eng.version++;
      return { order: o };
    },
    updatePrice(roId, p) {
      const ro = W.byId(roId);
      ro.prices[p].pump = ro.prices[p].rsp;
      ro.nozzles.filter((n) => n.product === p).forEach((n) => { n.presetOk = true; });
      log(`${pname(p)} price and presets at ${ro.name} set to ₹${ro.prices[p].rsp.toFixed(2)}`, roId, 'ok');
      Eng.version++;
    },
    raiseTicket(a) {
      const ro = W.byId(a.roId);
      newThread('Service', a.subject, a.text, a.roId);
      const n = a.nozzle && ro.nozzles.find((x) => x.id === a.nozzle);
      const t = a.tank && ro.tanks.find((x) => x.id === a.tank);
      if (n) n.ticket = true;
      if (t && a.fix === 'water') t.draining = true;
      log(`Service complaint raised: ${a.subject}`, a.roId, 'ok');
      // The engineer visits later in the simulation and fixes the fault.
      later(C.soReplyMin * 8, () => {
        if (a.fix === 'nozzle' && n) { n.silent = false; n.ticket = false; log(`Engineer repaired nozzle ${n.id} at ${ro.name}`, ro.id, 'ok'); }
        if (a.fix === 'flow' && n) {
          const peers = ro.nozzles.filter((x) => x.product === n.product && x !== n);
          n.flowLpm = +(sum(peers, (x) => x.flowLpm) / peers.length).toFixed(1); n.ticket = false;
          log(`Nozzle ${n.id} at ${ro.name} calibrated`, ro.id, 'ok');
        }
        if (a.fix === 'water' && t) { t.waterMm = 3; t.draining = false; log(`Water drained from tank ${t.id} at ${ro.name}`, ro.id, 'ok'); }
        if (a.fix === 'atg' && t) { t.atgOk = true; t.readL = t.stockL; t.readTs = Eng.now; log(`Tank gauge ${t.id} at ${ro.name} back online`, ro.id, 'ok'); }
      });
      Eng.version++;
    },
    writeAtr(roId, logId, text) {
      const ro = W.byId(roId);
      const l = ro.logs.find((x) => x.id === logId);
      if (!l) return { error: 'Event not found.' };
      if (!String(text || '').trim()) return { error: 'Describe what happened and what you did.' };
      l.atr = { ts: Eng.now, text: String(text).trim(), by: W.dealer.name };
      log(`Action-taken report filed for ${l.type} on ${l.du} at ${ro.name}`, roId, 'ok');
      Eng.version++;
      return { log: l };
    },
    bookRenewal(roId, key, dateTs) {
      const ro = W.byId(roId);
      const c = ro.compliance.find((x) => x.key === key);
      c.booked = { ts: Eng.now, for: dateTs };
      newThread('Compliance', `${c.label} booked at ${ro.name}`, `${c.label} renewal booked for ${new Date(dateTs).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ })}. I will share the certificate once issued.`, roId);
      log(`${c.label} renewal booked at ${ro.name}`, roId, 'ok');
      Eng.version++;
    },
    closeObservation(roId, index, note) {
      const ro = W.byId(roId);
      const ob = ro.observations[index];
      ob.status = 'Closed'; ob.proof = { ts: Eng.now, note: note || 'Fixed; photo sent' };
      newThread('Compliance', `Observation closed at ${ro.name}`, `${ob.text}: fixed. ${note || ''}`.trim(), roId);
      log(`Inspection observation closed at ${ro.name}`, roId, 'ok');
      Eng.version++;
    },
    sendMessage(threadId, text, meta) {
      if (!String(text || '').trim()) return { error: 'Write a message first.' };
      let th = threadId && W.threads.find((x) => x.id === threadId);
      if (th) th.msgs.push({ from: 'dealer', who: W.dealer.name, ts: Eng.now, text: String(text).trim() });
      else th = newThread(meta.cat || 'Other', meta.subject || 'Request', String(text).trim(), meta.roId);
      th.status = 'Open';
      log(`Message to the Sales Officer: ${th.subject}`, th.roId, 'msg');
      Eng.version++;
      return { thread: th };
    },
    setRec(key, state, reason) {
      W.recState[key] = { state, reason: reason || null, ts: Eng.now, day: businessDay(), until: state === 'snoozed' ? Eng.now + 2 * HOUR : null };
      log(state === 'snoozed' ? 'Recommendation snoozed for 2 hours' : state === 'dismissed' ? `Recommendation marked not relevant${reason ? ': ' + reason : ''}` : 'Recommendation marked done', null);
      Eng.version++;
    },
  };

  // ---------- Clock ----------
  let timer = null, lastReal = 0;
  Eng.start = function () {
    if (timer) return;
    lastReal = Date.now();
    timer = setInterval(() => {
      const t = Date.now();
      // A throttled background tab must not trigger hours of catch-up in one tick.
      Eng.advance(Math.min(t - lastReal, 5000) * Eng.speed);
      lastReal = t;
      Eng.notify();
    }, 1000);
  };
  Eng.setSpeed = (s) => { Eng.speed = s; };

  window.Eng = Eng;
})();
