/* =====================================================================
   PRAHARI POC — live simulation + alert engine
   Runs a 1-second tick: sales accrue, tanks drain, tank trucks move,
   deliveries land, rules raise/resolve alerts, random field events occur.
   ===================================================================== */
(function () {
  'use strict';
  const { PRODUCTS, HOURLY, outlets, tankers, util } = DB;
  const rnd = Math.random;
  const rr = (a, b) => a + rnd() * (b - a);
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  const Sim = {
    t: 0, alerts: [], alertsVersion: 0, events: [], aiEvents: [], listeners: [],
    raLastSync: Date.now() - (3 * 3600 + 12 * 60) * 1000,
    on(fn) { this.listeners.push(fn); },
  };
  let alertSeq = 1;
  const ACTIVE = ['Loading', 'In transit', 'Halted'];

  // ---------- Derived metrics ----------
  function cover(o, p) {
    const stock = o.tanks.filter((t) => t.product === p).reduce((a, t) => a + t.stock, 0);
    return { stock, days: stock / Math.max(0.05, o.prod[p]) };
  }
  function enRouteTanker(o) { return tankers.find((t) => t.outletId === o.id && ACTIVE.includes(t.status)); }
  function etaMin(t) {
    if (t.status === 'Loading') return Math.round(t.route.km / 32 * 60 + 25);
    if (t.status === 'Halted') return null;
    return Math.max(1, Math.round((1 - t.progress) * t.route.km / 32 * 60));
  }
  function daysTo(ts) { return Math.ceil((ts - Date.now()) / util.DAY); }

  function compute(o) {
    const c = {};
    let minDays = Infinity, minP = null;
    Object.keys(o.prod).forEach((p) => { c[p] = cover(o, p); if (c[p].days < minDays) { minDays = c[p].days; minP = p; } });
    const frac = util.dayFractionElapsed();
    const todayL = Object.values(o.today).reduce((a, b) => a + b, 0);
    const targetDailyL = o.targetMonth / 30 * 1000;
    const dom = util.istNow().getDate();
    const prior = o.hist.slice(-dom, -1).reduce((a, h) => a + h.total, 0);
    const mtdKL = prior + todayL / 1000;
    const mtdTarget = o.targetMonth / 30 * (dom - 1 + frac);
    const last7 = o.hist.slice(-8, -1).reduce((a, h) => a + h.total, 0) / 7;
    const prev7 = o.hist.slice(-15, -8).reduce((a, h) => a + h.total, 0) / 7;
    const camsOff = o.cameras.filter((x) => !x.online).length;
    const faults = o.nozzles.filter((n) => n.status === 'Fault').length;
    const lic = ['peso', 'stamp', 'fire', 'pcc'].map((k) => ({ k, label: o.compliance[k].label, due: o.compliance[k].due, days: daysTo(o.compliance[k].due) }));
    const licSoon = lic.filter((l) => l.days <= 30);
    const tk = enRouteTanker(o);
    let score = 100;
    if (minDays < 1) score -= 35; else if (minDays < 2) score -= 14;
    if (o.variation > 0.5) score -= 20;
    if (o.densityDev > 3) score -= 18;
    if (!o.raOnline) score -= 25;
    score -= camsOff * 5 + faults * 5 + licSoon.length * 8;
    const ach = mtdKL / Math.max(0.01, mtdTarget);
    if (ach < 0.9) score -= 8;
    if (o.credit.overdueDays > 30) score -= 5;
    if (o.compliance.irregularities.some((i) => i.status === 'Open')) score -= 8;
    score = Math.max(5, Math.min(100, Math.round(score)));
    const trend = prev7 ? last7 / prev7 - 1 : 0;
    let status = 'ok';
    if (!o.raOnline) status = 'off';
    else if ((minDays < 1 && !tk) || o.variation > 0.8 || o.densityDev > 3.5) status = 'crit';
    else if (minDays < 2 || o.variation > 0.5 || o.densityDev > 3 || licSoon.length || camsOff || faults || ach < 0.85 || trend < -0.12 || o.compliance.irregularities.some((i) => i.status === 'Open')) status = 'warn';
    o.m = { cover: c, minDays, minP, todayL, targetDailyL, expectedL: targetDailyL * frac, mtdKL, mtdTarget, ach, last7, prev7, trend, camsOff, faults, lic, licSoon, tanker: tk, score, status };
    return o.m;
  }

  // ---------- Alerts ----------
  function upsert(key, data) {
    let a = Sim.alerts.find((x) => x.key === key && x.status !== 'resolved');
    if (a) { Object.assign(a, { title: data.title, detail: data.detail }); return a; }
    a = Object.assign({ id: 'AL-' + (alertSeq++), key, ts: Date.now(), status: 'open', fresh: true }, data);
    Sim.alerts.unshift(a);
    Sim.alertsVersion++;
    if (Sim.t > 3 && (a.sev === 'critical' || a.sev === 'high')) pushEvent('alert', a.title, a.outletId);
    return a;
  }
  function resolve(key) {
    const a = Sim.alerts.find((x) => x.key === key && x.status !== 'resolved');
    if (a) { a.status = 'resolved'; Sim.alertsVersion++; Sim.alerts = Sim.alerts.filter((x) => x !== a); pushEvent('ok', `Resolved: ${a.title}`, a.outletId); }
  }
  function rule(cond, key, data) {
    if (Sim.serverOwned && Sim.serverOwned(key)) return; // the backend raises and resolves these
    if (cond) upsert(key, data); else resolve(key);
  }

  function evaluate() {
    outlets.forEach((o) => {
      const m = o.m;
      const P = PRODUCTS[m.minP];
      const tk = m.tanker;
      rule(m.minDays < 1.5 && !tk && o.raOnline, 'dry:' + o.id, {
        sev: 'critical', cat: 'Supply', outletId: o.id,
        title: `Dry-out risk: ${P.name} at ${o.name}`,
        detail: `${m.minDays.toFixed(1)} days of ${P.name.toLowerCase()} left (${m.cover[m.minP].stock.toFixed(1)} kL). No tanker scheduled${o.pendingIndent ? '. Order on hold: ' + o.pendingIndent.reason.toLowerCase() : ''}.`,
      });
      rule(m.minDays < 1.5 && !!tk, 'low:' + o.id, {
        sev: 'low', cat: 'Supply', outletId: o.id, tankerId: tk && tk.id,
        title: `Low ${P.name.toLowerCase()} at ${o.name}, truck on the way`,
        detail: tk ? `${tk.plate} · ${tk.status}${etaMin(tk) ? ' · ETA ' + etaMin(tk) + ' min' : ''} · ${m.minDays.toFixed(1)} days left` : '',
      });
      rule(o.variation > 0.5, 'var:' + o.id, {
        sev: 'high', cat: 'Stock', outletId: o.id,
        title: `Stock variation ${o.variation.toFixed(2)}% at ${o.name}`,
        detail: 'Book vs physical stock above the permissible limit (0.50% in this demo) for 3 days. Check for leakage, pilferage or meter error.',
      });
      rule(o.densityDev > 3, 'den:' + o.id, {
        sev: 'high', cat: 'Quality', outletId: o.id,
        title: `Density mismatch on diesel receipt at ${o.name}`,
        detail: `Observed vs invoice density: +${o.densityDev.toFixed(1)} kg/m³ (tolerance ±3.0). Recommend sample collection and holding the tank.`,
      });
      rule(!o.raOnline, 'ra:' + o.id, {
        sev: 'high', cat: 'Equipment', outletId: o.id,
        title: `Automation offline at ${o.name}`,
        detail: `No data from forecourt controller since ${new Date(Sim.raLastSync).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: util.TZ })}. Tank and sales figures are stale.`,
      });
      rule(m.camsOff > 0, 'cam:' + o.id, {
        sev: 'medium', cat: 'Security', outletId: o.id,
        title: `${m.camsOff} CCTV camera${m.camsOff > 1 ? 's' : ''} offline at ${o.name}`,
        detail: o.cameras.filter((c) => !c.online).map((c) => c.label).join(', '),
      });
      rule(m.faults > 0, 'noz:' + o.id, {
        sev: 'medium', cat: 'Equipment', outletId: o.id,
        title: `Dispenser fault at ${o.name}`,
        detail: o.nozzles.filter((n) => n.status === 'Fault').map((n) => `${n.id} (${n.du}, ${PRODUCTS[n.product].code})`).join(', ') + ' out of service.',
      });
      m.lic.forEach((l) => rule(l.days <= 30, 'lic:' + l.k + ':' + o.id, {
        sev: l.days <= 10 ? 'high' : 'medium', cat: 'Compliance', outletId: o.id,
        title: `${l.label} due in ${l.days} days at ${o.name}`,
        detail: `Due ${new Date(l.due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: util.TZ })}. Dealer to submit renewal documents.`,
      }));
      o.compliance.irregularities.forEach((ir, i) => rule(ir.status === 'Open', 'irr:' + i + ':' + o.id, {
        sev: 'medium', cat: 'Compliance', outletId: o.id,
        title: `Open irregularity at ${o.name}`, detail: ir.text,
      }));
      rule(m.trend < -0.12, 'dec:' + o.id, {
        sev: 'medium', cat: 'Commercial', outletId: o.id,
        title: `Volume down ${Math.round(-m.trend * 100)}% week-on-week at ${o.name}`,
        detail: o.competitorNote || 'Investigate local competition, pricing perception and service levels.',
      });
      rule(o.credit.overdueDays > 30, 'cr:' + o.id, {
        sev: 'low', cat: 'Commercial', outletId: o.id,
        title: `Dealer payment overdue by ${o.credit.overdueDays} days at ${o.name}`,
        detail: `Outstanding ₹${(o.credit.outstanding / 100000).toFixed(1)} lakh of ₹${(o.credit.limit / 100000).toFixed(0)} lakh limit.`,
      });
    });
    tankers.forEach((t) => {
      const o = DB.byId(t.outletId);
      rule(t.status === 'Halted', 'halt:' + t.id, {
        sev: 'critical', cat: 'Security', outletId: o.id, tankerId: t.id,
        title: `Truck ${t.plate} stopped off route for ${Math.round(t.haltSec / 60)} min`,
        detail: `${(Math.hypot(t.offset ? t.offset[0] : 0, t.offset ? t.offset[1] : 0) * 105).toFixed(1)} km off planned route to ${o.name}. Seals ${t.seals.join(', ')} unverified. Driver ${t.driver}.`,
      });
    });
    // expire transient alerts
    const now = Date.now();
    const before = Sim.alerts.length;
    Sim.alerts = Sim.alerts.filter((a) => !a.expires || a.expires > now);
    if (Sim.alerts.length !== before) Sim.alertsVersion++;
  }

  // ---------- Events ----------
  function pushEvent(type, text, outletId) {
    if (type === 'txn') return; // individual sales are shown per outlet, not in the area activity feed
    Sim.events.unshift({ ts: Date.now(), type, text, outletId });
    if (Sim.events.length > 60) Sim.events.length = 60;
  }
  function genTxn(o) {
    const usable = o.nozzles.filter((n) => n.status !== 'Fault');
    if (!usable.length) return null;
    const n = pick(usable);
    const p = n.product;
    let L, veh;
    if (p === 'HSD') { if (rnd() < 0.35) { L = rr(70, 220); veh = 'Truck'; } else { L = rr(15, 45); veh = rnd() < 0.5 ? 'SUV' : 'Car'; } }
    else if (p === 'MS') { const x = rnd(); if (x < 0.45) { L = rr(1.5, 5); veh = '2-Wheeler'; } else if (x < 0.55) { L = rr(4, 10); veh = 'Auto'; } else { L = rr(8, 35); veh = 'Car'; } }
    else { L = rr(10, 35); veh = 'Car'; }
    const x = rnd();
    const mode = x < 0.55 ? 'UPI' : x < 0.82 ? 'Cash' : x < 0.94 ? 'Card' : 'Fleet';
    const amt = Math.round(L * PRODUCTS[p].price);
    n.totalizer += L;
    n.status = 'Dispensing'; n.until = Date.now() + rr(3000, 8000); n.last = { L, amt, ts: Date.now() };
    return { ts: Date.now(), nozzle: n.id, du: n.du, product: p, L, amt, mode, veh };
  }
  Sim.genTxn = genTxn;

  const AI_TEXT = [
    ['ANPR', (o) => `${pick(['HR26', 'HR55', 'DL3C', 'HR38', 'UP16'])} ${pick(['DK', 'AB', 'CZ', 'BT'])} ${Math.floor(1000 + rnd() * 9000)} entered (fleet card customer)`],
    ['QUEUE', () => `Queue of ${Math.floor(5 + rnd() * 5)} vehicles at Forecourt A`],
    ['TANKER', () => 'Tank truck in the unloading bay; unloading started'],
    ['PPE', () => 'Unloading in progress without safety cones'],
    ['COUNT', () => `Footfall last hour: ${Math.floor(60 + rnd() * 140)} vehicles`],
    ['LOITER', () => 'Person loitering near air/water point for 6 min'],
  ];

  function randomEvents() {
    const online = outlets.filter((o) => o.raOnline);
    if (Sim.t % 6 === 0) {
      const o = pick(online);
      const cam = o.cameras.find((c) => c.online) || o.cameras[0];
      const [tag, fn] = pick(AI_TEXT);
      const e = { ts: Date.now(), outletId: o.id, camId: cam.id, tag, text: fn(o) };
      Sim.aiEvents.unshift(e);
      if (Sim.aiEvents.length > 250) Sim.aiEvents.length = 250;
      if (tag === 'PPE' && rnd() < 0.5) upsert('ppe:' + o.id + ':' + Sim.t, { sev: 'medium', cat: 'Security', outletId: o.id, title: `Unsafe unloading at ${o.name}`, detail: e.text, expires: Date.now() + 120000 });
      if (tag === 'QUEUE' && rnd() < 0.35) upsert('q:' + o.id + ':' + Sim.t, { sev: 'low', cat: 'Security', outletId: o.id, title: `Long queue at ${o.name}`, detail: e.text + '. Consider opening more nozzles.', expires: Date.now() + 120000 });
    }
    if (Sim.t % 23 === 0 && Sim.t > 0) {
      const storyIds = new Set(Object.values(DB.stories).map((q) => q.id));
      const brokenNow = outlets.filter((q) => q.cameras.some((c) => !c.online) || q.nozzles.some((n) => n.status === 'Fault')).length;
      const room = brokenNow < Sim.baseBroken; // random faults never push the area above where it started
      let x = rnd();
      if (!room && x < 0.5) x = 0.5 + rnd() * 0.3; // turn a new fault into a repair
      const calm = online.filter((q) => !storyIds.has(q.id));
      const o = pick(calm.length ? calm : online);
      if (x < 0.25) {
        const c = o.cameras.find((c) => c.online);
        if (c) { c.online = false; pushEvent('alert', `CCTV ${c.label} went offline at ${o.name}`, o.id); }
      } else if (x < 0.4) {
        const n = o.nozzles.find((n) => n.status !== 'Fault');
        if (n) { n.status = 'Fault'; pushEvent('alert', `Nozzle ${n.id} out of service at ${o.name}`, o.id); }
      } else if (x < 0.85) {
        // repairs (story outlets keep their scripted state)
        const broken = outlets.filter((q) => q.raOnline && !storyIds.has(q.id) && (q.cameras.some((c) => !c.online) || q.nozzles.some((n) => n.status === 'Fault')));
        if (!broken.length) return;
        const q = pick(broken);
        const c = q.cameras.find((c) => !c.online);
        const n = q.nozzles.find((n) => n.status === 'Fault');
        if (c) { c.online = true; pushEvent('ok', `CCTV ${c.label} back online at ${q.name}`, q.id); }
        else if (n) { n.status = 'Idle'; pushEvent('ok', `Nozzle ${n.id} repaired at ${q.name}`, q.id); }
      } else {
        const txt = pick(['Complaint: short delivery claim', 'Complaint: air machine not working', 'Complaint: card payment declined', 'Complaint: washroom not clean']);
        o.complaints.unshift({ date: Date.now(), text: txt.replace('Complaint: ', ''), status: 'Open' });
        upsert('cmp:' + o.id + ':' + Sim.t, { sev: 'medium', cat: 'Commercial', outletId: o.id, title: `${txt} at ${o.name}`, detail: 'Logged via customer helpline. Dealer to respond within 24 hours.', expires: Date.now() + 300000 });
      }
    }
  }

  // ---------- Tankers ----------
  function chooseNextDestination(t) {
    const busy = new Set(tankers.filter((x) => x !== t && ACTIVE.concat(['Unloading']).includes(x.status)).map((x) => x.outletId));
    const cands = outlets.filter((o) => o.raOnline && !o.pendingIndent && !busy.has(o.id) && o.m);
    cands.sort((a, b) => a.m.minDays - b.m.minDays);
    return cands[Math.floor(rnd() * Math.min(5, cands.length))] || outlets[0];
  }
  function assign(t, o) {
    const depot = DB.depotById(t.depotId);
    t.outletId = o.id;
    t.route = util.buildRoute(depot, o);
    t.progress = 0;
    const p = o.m ? o.m.minP : 'HSD';
    t.comps = t.cap === 12 ? [{ product: p === 'XP' ? 'MS' : p, kl: 12 }] : [{ product: 'HSD', kl: t.cap === 24 ? 12 : 8 }, { product: 'MS', kl: 12 }];
    t.invoice = 'INV-' + Math.floor(7000000 + rnd() * 999999);
    t.seals = ['S' + Math.floor(100000 + rnd() * 899999), 'S' + Math.floor(100000 + rnd() * 899999)];
    t.dispatchedAt = Date.now();
  }
  Sim.assign = assign;
  function deliver(t) {
    const o = DB.byId(t.outletId);
    t.comps.forEach((c) => {
      const tanks = o.tanks.filter((x) => x.product === c.product);
      if (!tanks.length) return;
      let left = c.kl;
      tanks.sort((a, b) => a.stock / a.cap - b.stock / b.cap).forEach((tk) => { const room = tk.cap - tk.stock; const put = Math.min(room, left); tk.stock += put; left -= put; });
      o.indents.unshift({ id: 'IND-' + Math.floor(400000 + rnd() * 99999), date: Date.now(), product: c.product, qty: c.kl, status: 'Delivered', invDens: rr(PRODUCTS[c.product].dens[0], PRODUCTS[c.product].dens[1]), obsDiff: rr(-1.2, 1.2), shortL: 0 });
    });
    pushEvent('ok', `${t.plate} delivered ${t.comps.map((c) => c.kl + ' kL ' + PRODUCTS[c.product].name.toLowerCase()).join(' and ')} to ${o.name}`, o.id);
  }
  function stepTankers() {
    tankers.forEach((t) => {
      if (t.status === 'In transit') {
        t.progress += t.speed;
        if (t.progress >= 1) { t.progress = 1; t.status = 'Unloading'; t.timer = 25; pushEvent('info', `${t.plate} arrived at ${DB.byId(t.outletId).name}; unloading started`, t.outletId); }
      } else if (t.status === 'Unloading') {
        if (--t.timer <= 0) { deliver(t); t.status = 'Returning'; }
      } else if (t.status === 'Returning') {
        t.progress -= t.speed * 1.4;
        if (t.progress <= 0) { t.progress = 0; t.status = 'Loading'; t.timer = 20; const o = chooseNextDestination(t); assign(t, o); }
      } else if (t.status === 'Loading') {
        if (--t.timer <= 0) { t.status = 'In transit'; pushEvent('info', `${t.plate} left ${DB.depotById(t.depotId).name} for ${DB.byId(t.outletId).name}`, t.outletId); }
      } else if (t.status === 'Halted') {
        t.haltSec += 1;
      }
    });
  }
  function tankerPos(t) {
    const p = util.pointAt(t.route, t.progress);
    if (t.status === 'Loading') { const d = DB.depotById(t.depotId); return { lng: d.lng, lat: d.lat, bearing: 0 }; }
    if (t.offset) { p.lng += t.offset[0]; p.lat += t.offset[1]; }
    if (t.status === 'Returning') p.bearing += 180;
    return p;
  }
  Sim.tankerPos = tankerPos;
  Sim.etaMin = etaMin;
  Sim.compute = compute;
  Sim.daysTo = daysTo;

  // ---------- Main tick ----------
  function step() {
    Sim.t++;
    const h = util.istNow().getHours();
    const perSec = HOURLY[h] / 3600;
    outlets.forEach((o) => {
      if (!o.raOnline) return;
      Object.keys(o.prod).forEach((p) => {
        const L = o.prod[p] * 1000 * perSec * rr(0.6, 1.4);
        if (!o._serverToday) o.today[p] += L; // with a backend, live sales come from pump totalisers
        if (o._serverStock) return; // ...and stock from tank readings
        const tanks = o.tanks.filter((t) => t.product === p && t.stock > 0.05);
        if (tanks.length) { const tk = tanks.sort((a, b) => b.stock - a.stock)[0]; tk.stock = Math.max(0, tk.stock - L / 1000); }
      });
      o.nozzles.forEach((n) => { if (n.status === 'Dispensing' && n.until < Date.now()) n.status = 'Idle'; });
    });
    // live transactions for the focused outlet + area ticker
    const focus = Sim.focusId && DB.byId(Sim.focusId);
    if (focus && focus.raOnline && rnd() < 0.55) { const tx = genTxn(focus); if (tx) { focus.txns.unshift(tx); if (focus.txns.length > 30) focus.txns.length = 30; } }
    if (rnd() < 0.7) {
      const o = pick(outlets.filter((q) => q.raOnline));
      const tx = genTxn(o);
      if (tx) pushEvent('txn', `${o.id} · ${tx.nozzle} · ${PRODUCTS[tx.product].code} ${tx.L.toFixed(1)} L · ₹${tx.amt.toLocaleString('en-IN')} · ${tx.mode}`, o.id);
    }
    stepTankers();
    outlets.forEach(compute);
    if (Sim.t % 2 === 0 || Sim.t < 3) evaluate();
    randomEvents();
    Sim.alerts.forEach((a) => { if (a.fresh && Date.now() - a.ts > 2500) a.fresh = false; });
    Sim.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }

  // ---------- Actions invoked from the UI ----------
  Sim.actions = {
    ack(id) { const a = Sim.alerts.find((x) => x.id === id); if (a) { a.status = 'ack'; Sim.alertsVersion++; } },
    priorityDispatch(o) {
      const existing = enRouteTanker(o);
      if (existing) return existing; // already covered; don't send a second truck
      o.pendingIndent = null;
      // A spare truck from the nearest depot's transporter pool. Trucks already on the road keep their jobs.
      const t = DB.makeTanker(o, 'Loading');
      assign(t, o);
      t.status = 'Loading'; t.timer = 8;
      pushEvent('info', `Truck ${t.plate} assigned to ${o.name} (priority)`, o.id);
      compute(o); evaluate(); Sim.alertsVersion++;
      return t;
    },
    contactDriver(t) {
      t.status = 'In transit'; t.offset = null; t.haltSec = 0;
      pushEvent('ok', `Driver of ${t.plate} contacted; back on planned route`, t.outletId);
      evaluate();
    },
    resetRA(o) { o.raOnline = true; pushEvent('ok', `Automation link restored at ${o.name}`, o.id); evaluate(); },
    holdTank(o) {
      o.densityDev = 0;
      const ind = o.indents.find((i) => /under review/i.test(i.status)) || o.indents.find((i) => i.product === 'HSD' && Math.abs(i.obsDiff) > 3) || o.indents.find((i) => i.product === 'HSD');
      if (ind) ind.status = 'Tank held, sample sent for testing';
      pushEvent('info', `Diesel tank held and sample sent for testing at ${o.name}`, o.id); evaluate(); },
    resolveIrregularity(o, i) { o.compliance.irregularities[i].status = 'Closed'; evaluate(); },
  };

  Sim.start = function () {
    Sim.baseBroken = outlets.filter((q) => q.cameras.some((c) => !c.online) || q.nozzles.some((n) => n.status === 'Fault')).length;
    outlets.forEach(compute);
    evaluate();
    // Demo alerts get plausible "opened" times; alerts from the backend keep their real ones.
    Sim.alerts.forEach((a) => { a.fresh = false; if (!a.server) a.ts = Date.now() - Math.floor(rnd() * 3 * 3600 * 1000); });
    Sim.alerts.sort((a, b) => b.ts - a.ts);
    // seed a few events
    for (let i = 0; i < 6; i++) { const o = pick(outlets); const [tag, fn] = pick(AI_TEXT); Sim.aiEvents.push({ ts: Date.now() - i * 95000, outletId: o.id, camId: o.cameras[0].id, tag, text: fn(o) }); }
    // a little recent history for every outlet (shown on its Cameras tab)
    Sim.history = [];
    outlets.forEach((o) => { for (let i = 0; i < 3; i++) { const [tag, fn] = pick(AI_TEXT.filter((x) => x[0] !== 'PPE')); Sim.history.push({ ts: Date.now() - (8 + i * 17 + rnd() * 10) * 60000, outletId: o.id, camId: o.cameras[0].id, tag, text: fn(o) }); } });
    Sim.aiEvents = Sim.aiEvents.concat(Sim.history);
    Sim.aiEvents.sort((a, b) => b.ts - a.ts);
    setInterval(step, 1000);
  };

  window.Sim = Sim;
})();
