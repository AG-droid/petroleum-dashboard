/* =====================================================================
   PRAHARI POC — synthetic data generator
   Gurugram Sales Area. Every outlet, dealer, number and plate here is
   fictional and generated from a fixed seed (same data on every load).
   ===================================================================== */
(function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(20261114);
  const r = (a, b) => a + rng() * (b - a);
  const ri = (a, b) => Math.floor(r(a, b + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const chance = (p) => rng() < p;
  const DAY = 86400000;
  const NOW = Date.now();

  // ---------- Geography helpers ----------
  function haversineKm(a, b) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toR, dLng = (b[0] - a[0]) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function pathInfo(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm(pts[i - 1], pts[i]));
    return { pts, cum, km: cum[cum.length - 1] };
  }
  function pointAt(info, t) {
    t = Math.max(0, Math.min(1, t));
    const d = t * info.km;
    const { pts, cum } = info;
    for (let i = 1; i < pts.length; i++) {
      if (d <= cum[i] || i === pts.length - 1) {
        const seg = cum[i] - cum[i - 1] || 1e-9;
        const f = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
        const a = pts[i - 1], b = pts[i];
        return { lng: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, seg: i - 1,
          bearing: Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI };
      }
    }
    return { lng: pts[0][0], lat: pts[0][1], seg: 0, bearing: 0 };
  }

  // ---------- Roads of the Gurugram sales area (approximate) ----------
  const ROADS = [
    { id: 'nh48', name: 'NH-48 (Delhi–Jaipur)', kind: 'Highway', n: 12,
      pts: [[77.100, 28.508], [77.072, 28.472], [77.040, 28.449], [77.012, 28.426], [76.980, 28.400], [76.937, 28.357], [76.870, 28.310], [76.800, 28.212], [76.700, 28.140], [76.590, 28.082]],
      places: ['Sirhaul', 'IFFCO Chowk', 'Rajiv Chowk', 'Hero Honda Chowk', 'Kherki Daula', 'Manesar', 'Bilaspur Chowk', 'Dharuhera', 'Kapriwas', 'Bawal'] },
    { id: 'sohna', name: 'Sohna Road (NH-248A)', kind: 'Urban', n: 6,
      pts: [[77.040, 28.449], [77.041, 28.415], [77.044, 28.384], [77.050, 28.345], [77.060, 28.292], [77.066, 28.250]],
      places: ['Subhash Chowk', 'Badshahpur', 'Vatika Chowk', 'Bhondsi', 'Raisina', 'Sohna'] },
    { id: 'fbd', name: 'Gurugram–Faridabad Road', kind: 'Urban', n: 4,
      pts: [[77.080, 28.468], [77.102, 28.452], [77.140, 28.432], [77.200, 28.420], [77.255, 28.410]],
      places: ['Sikanderpur', 'Gwal Pahari', 'Bandhwari', 'Mangar'] },
    { id: 'pataudi', name: 'Pataudi Road', kind: 'Rural', n: 5,
      pts: [[77.000, 28.463], [76.960, 28.448], [76.920, 28.430], [76.860, 28.390], [76.810, 28.345], [76.780, 28.322]],
      places: ['Basai', 'Garhi Harsaru', 'Sultanpur', 'Jamalpur', 'Pataudi'] },
    { id: 'dwarka', name: 'Dwarka Expressway', kind: 'Urban', n: 4,
      pts: [[77.008, 28.468], [77.018, 28.498], [77.028, 28.528], [77.040, 28.556]],
      places: ['Sector 37D', 'Sector 99', 'Sector 106', 'Bajghera'] },
  ];
  ROADS.forEach((rd) => { rd.info = pathInfo(rd.pts); });
  const CITY_CENTER = [77.045, 28.458];
  const CITY_PLACES = ['DLF Phase 2', 'Sector 14', 'Sector 29', 'Udyog Vihar', 'Palam Vihar', 'South City', 'Sector 56', 'Sushant Lok', 'Sector 45', 'New Railway Road', 'Sector 10A', 'Sector 31', 'MG Road'];

  const PRODUCTS = {
    MS:  { key: 'MS',  code: 'MS',   name: 'Petrol',         price: 94.98,  color: '#3ddc97', dens: [735, 760] },
    HSD: { key: 'HSD', code: 'HSD',  name: 'Diesel',         price: 87.82,  color: '#f5b942', dens: [825, 845] },
    XP:  { key: 'XP',  code: 'XP95', name: 'Premium Petrol', price: 103.10, color: '#a78bfa', dens: [740, 760] },
  };

  const PREF = ['Shree', 'Jai', 'Om', 'Maa', 'Balaji', 'Krishna', 'Highway', 'Aravali', 'Cyber', 'Gurukul', 'Shiv', 'Hanuman', 'Laxmi', 'Royal', 'National', 'Durga', 'Sai', 'Ganpati', 'Kanha', 'Haryana', 'Millennium', 'Sunrise', 'Kesar', 'Shyam'];
  const SUFF = ['Fuels', 'Filling Station', 'Petroleum', 'Auto Fuels', 'Service Station', 'Fuel Point', 'Fuel Centre'];
  const FIRST = ['Rajesh', 'Suresh', 'Mahendra', 'Anil', 'Vikram', 'Pooja', 'Sunita', 'Ramesh', 'Deepak', 'Manoj', 'Kavita', 'Arjun', 'Naresh', 'Gaurav', 'Priya', 'Harish', 'Sanjay', 'Meena', 'Rakesh', 'Ajay', 'Neha', 'Sandeep', 'Rohit', 'Jyoti'];
  const LAST = ['Yadav', 'Sharma', 'Gupta', 'Chauhan', 'Singh', 'Aggarwal', 'Jain', 'Rao', 'Dahiya', 'Malik', 'Kataria', 'Bansal', 'Saini', 'Arora'];
  const usedNames = new Set();
  function outletName(ksk) {
    let n, guard = 0;
    do { n = pick(PREF) + ' ' + (ksk ? 'Kisan Seva Kendra' : pick(SUFF)); guard++; } while (usedNames.has(n) && guard < 50);
    usedNames.add(n);
    return n;
  }

  // Share of a day's sales in each hour (normalised below)
  const HOURLY_RAW = [0.012, 0.008, 0.006, 0.006, 0.009, 0.02, 0.036, 0.056, 0.066, 0.062, 0.057, 0.054, 0.052, 0.05, 0.05, 0.053, 0.059, 0.066, 0.068, 0.06, 0.048, 0.038, 0.03, 0.02];
  const hs = HOURLY_RAW.reduce((a, b) => a + b, 0);
  const HOURLY = HOURLY_RAW.map((v) => v / hs);
  function dayFractionElapsed(date) {
    const d = date || new Date();
    const h = d.getHours(), m = d.getMinutes() + d.getSeconds() / 60;
    let f = 0;
    for (let i = 0; i < h; i++) f += HOURLY[i];
    return f + HOURLY[h] * (m / 60);
  }

  // ---------- Outlets ----------
  const outlets = [];
  let seq = 101;
  function makeOutlet(lng, lat, category, roadIdx, roadT, locality, roadName) {
    const ksk = category === 'Rural' && chance(0.4);
    const id = 'GGN-' + (seq++);
    const daily = category === 'Highway' ? r(9, 22) : category === 'Urban' ? r(5, 13) : r(2, 5);
    const hsdShare = category === 'Highway' ? r(0.6, 0.75) : category === 'Urban' ? r(0.3, 0.45) : r(0.55, 0.7);
    const hasXP = category === 'Urban' ? chance(0.65) : category === 'Highway' ? chance(0.35) : false;
    const xpShare = hasXP ? r(0.05, 0.11) : 0;
    const prod = { MS: daily * (1 - hsdShare - xpShare), HSD: daily * hsdShare };
    if (hasXP) prod.XP = daily * xpShare;

    // Size tanks for ~5 days of sales (standard sizes 10–35 kL)
    const tanks = [];
    let tn = 1;
    const SIZES = [10, 15, 20, 25, 30, 35];
    Object.keys(prod).forEach((p) => {
      const need = Math.max(8, prod[p] * 5);
      const n = need > 35 ? 2 : 1;
      const cap = SIZES.find((s) => s >= need / n) || 35;
      for (let k = 0; k < n; k++) tanks.push({ id: 'T' + (tn++), product: p, cap });
    });
    tanks.forEach((t) => {
      t.stock = t.cap * r(0.45, 0.92);
      t.water = ri(0, 18);
      t.temp = r(24, 31);
    });

    let nz = category === 'Highway' ? ri(8, 16) : category === 'Urban' ? ri(6, 12) : ri(4, 6);
    nz -= nz % 2;
    const prodKeys = Object.keys(prod);
    const nozzles = [];
    for (let k = 1; k <= nz; k++) {
      const p = category === 'Highway' && k % 3 !== 1 ? 'HSD' : prodKeys[(k - 1) % prodKeys.length];
      nozzles.push({ id: 'N' + k, du: 'DU-' + Math.ceil(k / 2), product: p, status: 'Idle', totalizer: ri(400000, 2600000), last: null });
    }
    if (chance(0.1)) nozzles[ri(0, nozzles.length - 1)].status = 'Fault';

    const camDefs = [
      { scene: 'forecourt', label: 'Forecourt A' },
      { scene: 'entry', label: 'Entry / Exit (ANPR)' },
      { scene: 'decant', label: 'Decantation Bay' },
      { scene: 'cash', label: 'Sales Room / Cash' },
    ];
    const ncam = category === 'Rural' ? 2 : category === 'Urban' ? ri(3, 4) : 4;
    const order = ncam === 2 ? [0, 2] : ncam === 3 ? [0, 2, 3] : [0, 1, 2, 3];
    const cameras = order.map((ix, j) => ({ id: id + '-C' + (j + 1), scene: camDefs[ix].scene, label: camDefs[ix].label, online: chance(0.975), seed: ri(1, 1e6) }));

    const hist = [];
    const trend = r(-0.04, 0.07);
    for (let d = 29; d >= 0; d--) {
      const date = new Date(NOW - d * DAY);
      const dow = date.getDay();
      const weekly = dow === 0 ? -0.08 : dow === 6 ? 0.04 : 0;
      const tf = 1 + trend * ((29 - d) / 29 - 0.5);
      const row = { date: date.toISOString().slice(0, 10), total: 0 };
      prodKeys.forEach((p) => { row[p] = Math.max(0, prod[p] * (1 + weekly + r(-0.09, 0.09)) * tf); row.total += row[p]; });
      hist.push(row);
    }
    const targetMonth = daily * 30 * r(1.0, 1.12);

    const frac = dayFractionElapsed();
    const today = {};
    prodKeys.forEach((p) => { today[p] = prod[p] * 1000 * frac * r(0.9, 1.08); });

    const dealerName = pick(FIRST) + ' ' + pick(LAST);
    const insp = [];
    let back = ri(4, 70);
    for (let k = 0; k < 4; k++) {
      insp.push({ date: NOW - back * DAY, by: pick(['Sales Officer', 'Sales Officer', 'Quality Control Cell', 'Legal Metrology']),
        type: pick(['Routine inspection', 'Quality sample', '5-litre measure check', 'Surprise inspection']),
        result: pick(['Satisfactory', 'Satisfactory', 'Satisfactory', 'Minor observation']) });
      back += ri(25, 70);
    }

    const creditLimit = ri(5, 40) * 100000;
    const o = {
      id, name: outletName(ksk), category, ksk, lng, lat, roadIdx, roadT, locality,
      road: roadName || 'City', address: locality + ', ' + (roadName || 'Gurugram'),
      type: category === 'Rural' ? (chance(0.7) ? 'DODO' : 'CODO') : pick(['DODO', 'DODO', 'CODO', 'CODO', 'COCO']),
      automated: chance(0.86), raOnline: true,
      dealer: { name: dealerName, phone: '+91 90000 ' + String(ri(10000, 99999)), since: ri(1994, 2022), email: dealerName.toLowerCase().replace(/ /g, '.') + '@example.in' },
      prod, daily, tanks, nozzles, cameras, hist, targetMonth, today,
      variation: r(0.05, 0.42), densityDev: r(0, 1.6),
      compliance: {
        peso: { label: 'PESO storage licence', due: NOW + ri(25, 700) * DAY },
        stamp: { label: 'Legal Metrology stamping', due: NOW + ri(16, 365) * DAY },
        fire: { label: 'Fire NOC', due: NOW + ri(30, 500) * DAY },
        pcc: { label: 'Pollution control consent', due: NOW + ri(40, 900) * DAY },
        lastInspection: insp[0].date, inspections: insp, irregularities: [],
      },
      credit: { limit: creditLimit, outstanding: Math.round(creditLimit * r(0.1, 0.85)), overdueDays: chance(0.18) ? ri(8, 45) : 0 },
      notes: [], txns: [], competitorNote: null,
      complaints: chance(0.25) ? [{ date: NOW - ri(1, 20) * DAY, text: pick(['Short delivery claim by customer', 'Air machine not working', 'Washroom not clean', 'Card payment declined repeatedly']), status: pick(['Open', 'Resolved']) }] : [],
    };
    // Indent / delivery history
    o.indents = [];
    let ib = ri(0, 2);
    for (let k = 0; k < 6; k++) {
      const p = pick(prodKeys.filter((x) => x !== 'XP').concat(prodKeys));
      o.indents.push({ id: 'IND-' + ri(400000, 499999), date: NOW - ib * DAY, product: p, qty: pick([12, 12, 20, 24]), status: 'Delivered',
        invDens: r(PRODUCTS[p].dens[0], PRODUCTS[p].dens[1]), obsDiff: r(-1.6, 1.6), shortL: chance(0.15) ? ri(10, 60) : 0 });
      ib += ri(1, 4);
    }
    outlets.push(o);
    return o;
  }

  ROADS.forEach((rd, idx) => {
    for (let i = 0; i < rd.n; i++) {
      let t = (i + 0.5) / rd.n + r(-0.035, 0.035);
      t = Math.max(0.03, Math.min(0.98, t));
      const p = pointAt(rd.info, t);
      const lng = p.lng + r(-0.0025, 0.0025), lat = p.lat + r(-0.0025, 0.0025);
      const place = rd.places[Math.min(rd.places.length - 1, Math.floor(t * rd.places.length))];
      makeOutlet(lng, lat, rd.kind, idx, t, place, rd.name);
    }
  });
  for (let i = 0; i < 13; i++) {
    const ang = r(0, Math.PI * 2), rad = r(0.008, 0.038);
    makeOutlet(CITY_CENTER[0] + Math.cos(ang) * rad * 1.15, CITY_CENTER[1] + Math.sin(ang) * rad, 'Urban', null, null, CITY_PLACES[i % CITY_PLACES.length], null);
  }

  // ---------- Scripted storylines (make the demo tell a story) ----------
  function minTank(o, product) { return o.tanks.filter((t) => t.product === product); }
  const S = {};
  // 1. Highway outlet about to run dry on diesel, no truck scheduled
  S.dryout = outlets[3];
  minTank(S.dryout, 'HSD').forEach((t) => { t.stock = S.dryout.prod.HSD * 0.55 / minTank(S.dryout, 'HSD').length; });
  S.dryout.credit.overdueDays = 0;
  S.dryout.pendingIndent = { product: 'HSD', qty: 20, reason: 'Payment not received' };
  // 2. Low petrol but a tanker is already on the way
  S.covered = outlets[13];
  minTank(S.covered, 'MS').forEach((t) => { t.stock = S.covered.prod.MS * 0.8; });
  // 3. Stock variation above permissible
  S.variation = outlets[20];
  S.variation.variation = 0.91;
  // 4. Density mismatch on last diesel receipt
  S.density = outlets[8];
  S.density.densityDev = 4.2;
  S.density.indents[0] = Object.assign(S.density.indents[0], { product: 'HSD', obsDiff: 4.2, date: NOW - 0.2 * DAY, status: 'Delivered — under review' });
  // 5. PESO licence expiring
  S.licence = outlets[30];
  S.licence.compliance.peso.due = NOW + 9 * DAY;
  // 6. Automation offline + cameras offline
  S.offline = outlets[26];
  S.offline.automated = true; S.offline.raOnline = false;
  S.offline.cameras.forEach((c, i) => { c.online = i > 1; });
  // 7. Volume decline — competitor opened nearby
  S.decline = outlets[1];
  S.decline.hist.forEach((h, i) => { const f = i < 22 ? 1.0 : 0.8; Object.keys(S.decline.prod).forEach((p) => { h[p] *= f; }); h.total = Object.keys(S.decline.prod).reduce((a, p) => a + h[p], 0); });
  S.decline.competitorNote = 'New private-brand outlet opened 1.2 km ahead on NH-48 (8 days ago)';
  // 8. Stamping due soon + an open irregularity
  S.stamp = outlets[17];
  S.stamp.compliance.stamp.due = NOW + 6 * DAY;
  S.stamp.compliance.irregularities.push({ date: NOW - 11 * DAY, text: 'Fire extinguisher refill overdue (2 units)', status: 'Open' });
  // 9. Credit overdue
  outlets[35].credit.overdueDays = 38;

  // ---------- Depots / terminals ----------
  const depots = [
    { id: 'DEP-BJW', name: 'Bijwasan Terminal', short: 'BIJWASAN TML', lng: 77.052, lat: 28.548, capacityKL: 98000 },
    { id: 'DEP-RWR', name: 'Rewari Depot', short: 'REWARI DEPOT', lng: 76.628, lat: 28.178, capacityKL: 42000 },
  ];
  function nearestDepot(o) {
    let best = depots[0], bd = Infinity;
    depots.forEach((d) => { const k = haversineKm([d.lng, d.lat], [o.lng, o.lat]); if (k < bd) { bd = k; best = d; } });
    return best;
  }
  function buildRoute(depot, o) {
    const start = [depot.lng, depot.lat], end = [o.lng, o.lat];
    let pts;
    if (o.roadIdx == null) {
      const mid = [(start[0] + end[0]) / 2 + 0.008, (start[1] + end[1]) / 2 - 0.004];
      pts = [start, mid, end];
    } else {
      const rd = ROADS[o.roadIdx];
      const seg = pointAt(rd.info, o.roadT).seg;
      let k = 0, bd = Infinity;
      rd.pts.forEach((p, i) => { const d = haversineKm(p, start); if (d < bd) { bd = d; k = i; } });
      const mids = [];
      if (k <= seg) for (let i = k; i <= seg; i++) mids.push(rd.pts[i]);
      else for (let i = k; i > seg; i--) mids.push(rd.pts[i]);
      pts = [start].concat(mids, [end]);
    }
    return pathInfo(pts);
  }

  // ---------- Tank trucks ----------
  const TRANSPORTERS = ['Aravali Roadlines', 'Haryana Petro Carriers', 'Mewat Transport Co.', 'Shree Ganesh Logistics', 'NCR Tankers'];
  const DRIVERS = ['Balwinder', 'Sukhdev', 'Ramkishan', 'Jagdish', 'Mukesh', 'Satbir', 'Omprakash', 'Raju', 'Dinesh', 'Kuldeep'];
  const tankers = [];
  const destPool = outlets.filter((o) => o !== S.dryout && o !== S.offline);
  function makeTanker(dest, status) {
    const depot = nearestDepot(dest);
    const cap = pick([12, 20, 20, 24]);
    const needs = Object.keys(dest.prod);
    const comps = [];
    if (cap === 12) comps.push({ product: needs.includes('HSD') && chance(0.6) ? 'HSD' : 'MS', kl: 12 });
    else { comps.push({ product: 'HSD', kl: cap === 24 ? 12 : 8 }); comps.push({ product: 'MS', kl: cap === 24 ? 12 : 12 }); }
    const route = buildRoute(depot, dest);
    const t = {
      id: 'TT-' + ri(1000, 9999), plate: pick(['HR55', 'HR55', 'HR38', 'HR47', 'HR26']) + ' ' + pick(['AK', 'BG', 'AT', 'CF', 'AE']) + ' ' + ri(1000, 9999),
      transporter: pick(TRANSPORTERS), driver: pick(DRIVERS) + ' ' + pick(LAST), cap, comps, depotId: depot.id, outletId: dest.id,
      route, status, progress: 0, speed: 1 / r(260, 520), timer: 0, haltSec: 0, seals: ['S' + ri(100000, 999999), 'S' + ri(100000, 999999)],
      invoice: 'INV-' + ri(7000000, 7999999), offset: null, dispatchedAt: NOW - ri(10, 90) * 60000,
    };
    tankers.push(t);
    return t;
  }
  // The covered outlet's tanker
  const tc = makeTanker(S.covered, 'In transit'); tc.progress = 0.55; tc.comps = [{ product: 'MS', kl: 12 }, { product: 'HSD', kl: 8 }];
  // Halted, off-route tanker (security story)
  const th = makeTanker(outlets[6], 'Halted'); th.progress = 0.42; th.haltSec = 47 * 60; th.offset = [0.0085, -0.006];
  for (let i = 0; i < 9; i++) { const t = makeTanker(pick(destPool), 'In transit'); t.progress = r(0.05, 0.9); }
  for (let i = 0; i < 2; i++) { const t = makeTanker(pick(destPool), 'Loading'); t.timer = ri(8, 30); }
  const tu = makeTanker(pick(destPool), 'Unloading'); tu.progress = 1; tu.timer = 25;

  // ---------- Competitor outlets ----------
  const competitors = [];
  ROADS.forEach((rd, idx) => {
    const n = Math.max(2, Math.round(rd.n * 0.55));
    for (let i = 0; i < n; i++) {
      const p = pointAt(rd.info, r(0.05, 0.97));
      competitors.push({ id: 'CMP-' + idx + i, brand: pick(['Brand B', 'Brand C', 'Private P']), lng: p.lng + r(-0.003, 0.003), lat: p.lat + r(-0.003, 0.003), estDaily: rd.kind === 'Highway' ? r(7, 18) : rd.kind === 'Urban' ? r(4, 11) : r(2, 4) });
    }
  });
  for (let i = 0; i < 7; i++) {
    const ang = r(0, Math.PI * 2), rad = r(0.01, 0.04);
    competitors.push({ id: 'CMP-c' + i, brand: pick(['Brand B', 'Brand C', 'Private P']), lng: CITY_CENTER[0] + Math.cos(ang) * rad, lat: CITY_CENTER[1] + Math.sin(ang) * rad, estDaily: r(4, 11) });
  }
  // the competitor near the declining outlet
  competitors.push({ id: 'CMP-new', brand: 'Private P', lng: S.decline.lng - 0.008, lat: S.decline.lat - 0.007, estDaily: 9.5, isNew: true });

  // ---------- Sales area boundary: padded convex hull ----------
  function hull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const pt of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); }
    for (let i = p.length - 1; i >= 0; i--) { const pt = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }
  const allPts = outlets.map((o) => [o.lng, o.lat]).concat(depots.map((d) => [d.lng, d.lat]));
  const h = hull(allPts);
  const cx = h.reduce((a, p) => a + p[0], 0) / h.length, cy = h.reduce((a, p) => a + p[1], 0) / h.length;
  const area = h.map((p) => [cx + (p[0] - cx) * 1.12 + Math.sign(p[0] - cx) * 0.01, cy + (p[1] - cy) * 1.12 + Math.sign(p[1] - cy) * 0.01]);
  area.push(area[0]);

  window.DB = {
    meta: { salesArea: 'Gurugram Sales Area', division: 'Gurugram Division', state: 'Haryana State Office', officer: 'Sales Officer, Gurugram SA', generatedAt: NOW },
    PRODUCTS, ROADS, HOURLY, outlets, depots, tankers, competitors, area, stories: S,
    util: { haversineKm, pathInfo, pointAt, buildRoute, nearestDepot, dayFractionElapsed, mulberry32, DAY },
    byId: (id) => outlets.find((o) => o.id === id),
    depotById: (id) => depots.find((d) => d.id === id),
    tankerById: (id) => tankers.find((t) => t.id === id),
    makeTanker,
  };
})();
