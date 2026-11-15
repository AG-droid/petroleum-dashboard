/* =====================================================================
   PRAHARI — backend connector
   When the dashboard is served together with the Prahari backend (make up),
   this replaces the in-browser simulation of stock, sales, deliveries,
   indents, licences, automation status and the stock/supply/quality/
   compliance alerts with data from the API, and turns action buttons into
   real requests. Without a backend (or with #demo in the URL) it does
   nothing and the dashboard runs as a self-contained demo.
   Trucks, cameras and individual sales remain simulated in the browser.
   ===================================================================== */
(function () {
  'use strict';
  const BASE = '/api/v1';
  const POLL_MS = 10000;
  // Alert rules the backend owns; the in-browser engine leaves these alone when connected.
  const OWNED = ['dry:', 'low:', 'var:', 'den:', 'lic:', 'ra:'];
  const LIC_KEY = { PESO: 'peso', LM_STAMPING: 'stamp', FIRE_NOC: 'fire', PCB_CONSENT: 'pcc' };
  const SEV = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' };

  const Api = { connected: false, lastSync: null, error: null };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function call(path, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 8000);
    try {
      const res = await fetch(BASE + path, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Prahari-User': 'Sales Officer (demo)' },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  // ---------- mapping API data onto the dashboard's outlet objects ----------
  const ms = (iso) => (iso ? Date.parse(iso) : null);
  const dayMs = (d) => new Date(d + 'T00:00:00').getTime();

  function applyTanks(o, tanks) {
    let live = false;
    tanks.forEach((t) => {
      const local = o.tanks.find((x) => x.id === 'T' + t.tank_no);
      const litres = t.estimated_l != null ? t.estimated_l : t.volume_l;
      if (!local || litres == null) return;
      local.stock = litres / 1000;
      if (t.water_mm != null) local.water = t.water_mm;
      if (t.temp_c != null) local.temp = t.temp_c;
      local.source = t.source; local.asOf = ms(t.as_of); local.projected = !!t.projected;
      live = true;
    });
    o._serverStock = live;
  }

  function applyToday(o, todayL) {
    // Live sales come from pump totalisers (automated outlets only); others keep the in-browser estimate.
    if (!todayL) { o._serverToday = false; return; }
    Object.keys(o.prod).forEach((p) => { o.today[p] = todayL[p] || 0; });
    o._serverToday = true;
  }

  function applyAutomation(o, online) {
    if (online === true || online === false) o.raOnline = online;
  }

  function applyDetail(o, d) {
    applyTanks(o, d.tanks);
    applyToday(o, d.today_l);
    applyAutomation(o, d.automation_online);
    if (d.history && d.history.length) {
      o.hist = d.history.map((h) => {
        const row = { date: h.date, total: h.total || 0 };
        Object.keys(o.prod).forEach((p) => { row[p] = h[p] || 0; });
        return row;
      });
    }
    if (d.variation_pct != null) o.variation = d.variation_pct;
    // Deliveries: one row per invoice (a delivery can go into several tanks).
    const byInv = new Map();
    d.receipts.forEach((r) => {
      const prev = byInv.get(r.invoice_no);
      if (prev) { prev.qty = Math.round((prev.qty + r.invoice_qty_kl) * 10) / 10; prev.shortL += r.shortage_l; return; }
      byInv.set(r.invoice_no, {
        id: r.invoice_no, receiptId: r.id, date: ms(r.received_at), product: r.product_code, qty: r.invoice_qty_kl,
        invDens: r.invoice_density_15, obsDiff: r.density_diff, shortL: r.shortage_l, held: r.quality_hold,
        status: r.quality_hold ? 'Tank held, sample sent for testing' : Math.abs(r.density_diff) > 3 ? 'Delivered — under review' : 'Delivered',
      });
    });
    if (byInv.size) o.indents = [...byInv.values()];
    const failed = o.indents.find((i) => !i.held && Math.abs(i.obsDiff) > 3);
    o.densityDev = failed ? failed.obsDiff : 0;
    o._denReceiptId = failed ? failed.receiptId : null;
    const held = d.indents.find((i) => i.status === 'On hold');
    o.pendingIndent = held ? { product: held.product_code, qty: held.qty_kl, reason: held.hold_reason || 'On hold', indentNo: held.indent_no } : null;
    o.serverIndents = d.indents;
    d.licences.forEach((l) => {
      const k = LIC_KEY[l.licence_type];
      if (k && o.compliance[k]) { o.compliance[k].due = dayMs(l.valid_upto); o.compliance[k].number = l.licence_no; }
    });
  }

  // Server keys carry detail the dashboard groups by outlet: dry:990104:HSD → dry:990104,
  // den:990109:INV123 → den:990109, lic:PESO:990131 → lic:peso:990131.
  function clientKey(a) {
    const parts = a.key.split(':');
    if (a.rule === 'lic') return `lic:${LIC_KEY[parts[1]] || parts[1]}:${parts[2]}`;
    return parts.slice(0, 2).join(':');
  }

  function applyAlerts(list) {
    const mapped = list.filter((a) => a.outlet_code).map((a) => ({
      id: 'S-' + a.id, serverId: a.id, server: true, key: clientKey(a), sev: SEV[a.severity] || 'medium', cat: a.category,
      outletId: a.outlet_code, title: esc(a.title), detail: esc(a.detail), ts: ms(a.opened_at),
      status: a.status === 'acknowledged' ? 'ack' : 'open', fresh: false,
      product: a.data && a.data.product, receiptId: a.data && a.data.receipt_id,
    }));
    const sig = mapped.map((a) => a.id + a.status + a.title + a.detail).join('|');
    if (sig === Api._alertSig) return;
    Api._alertSig = sig;
    Sim.alerts = Sim.alerts.filter((a) => !a.server).concat(mapped).sort((a, b) => b.ts - a.ts);
    Sim.alertsVersion++;
  }

  // ---------- sync ----------
  async function loadSnapshot() {
    const snap = await call('/ui/snapshot', { timeout: 6000 });
    snap.outlets.forEach((d) => { const o = DB.byId(d.code); if (o) applyDetail(o, d); });
    applyAlerts(snap.alerts);
    Api.lastSync = Date.now();
    return snap;
  }

  async function poll() {
    try {
      const live = await call('/ui/live');
      live.outlets.forEach((d) => {
        const o = DB.byId(d.code); if (!o) return;
        applyTanks(o, d.tanks); applyToday(o, d.today_l); applyAutomation(o, d.automation_online);
      });
      applyAlerts(live.alerts);
      Api.lastSync = Date.now(); Api.error = null;
    } catch (e) {
      Api.error = e.message;
    }
    updateBadge();
  }

  async function refresh() {
    try { await loadSnapshot(); } catch (e) { Api.error = e.message; }
    updateBadge();
    if (window.UI && UI.refresh) UI.refresh();
  }

  function updateBadge() {
    const tag = document.querySelector('.demo-tag');
    if (!tag) return;
    if (!Api.connected) { tag.textContent = 'Demo data'; tag.title = 'Everything shown is generated sample data, simulated in the browser'; return; }
    tag.textContent = Api.error ? 'Server: reconnecting' : 'Server · demo data';
    tag.classList.toggle('warn', !!Api.error);
    tag.title = Api.error
      ? `Lost contact with the Prahari server (${Api.error}). Showing the last data received.`
      : 'Stock, sales, deliveries, licences and alerts come from the Prahari backend. The data itself is synthetic. Trucks and cameras are simulated in the browser.';
  }

  // ---------- actions become API requests ----------
  function wrapActions() {
    const A = Sim.actions;
    const orig = { priorityDispatch: A.priorityDispatch, holdTank: A.holdTank, ack: A.ack };
    const dropAlert = (key) => { Sim.alerts = Sim.alerts.filter((a) => a.key !== key); Sim.alertsVersion++; Api._alertSig = null; };
    const serverAlert = (key) => Sim.alerts.find((a) => a.server && a.key === key);
    A.priorityDispatch = (o) => {
      const dry = serverAlert('dry:' + o.id);
      const truck = orig.priorityDispatch(o); // the truck shown on the map is still simulated
      dropAlert('dry:' + o.id); // optimistic; the server confirms on refresh
      const body = { note: 'Raised from the dashboard' };
      if (dry && dry.product) body.product = dry.product; // the product this alert is about
      call(`/outlets/${encodeURIComponent(o.id)}/priority-indent`, { method: 'POST', body })
        .then(refresh).catch((e) => UI.toast && UI.toast('Request failed', e.message));
      return truck;
    };
    A.holdTank = (o) => {
      const den = serverAlert('den:' + o.id);
      const id = (den && den.receiptId) || o._denReceiptId;
      orig.holdTank(o);
      dropAlert('den:' + o.id);
      if (id) call(`/receipts/${id}/quality-hold`, { method: 'POST' }).then(refresh).catch((e) => UI.toast && UI.toast('Request failed', e.message));
    };
    A.ack = (id) => {
      const a = Sim.alerts.find((x) => x.id === id);
      orig.ack(id);
      if (a && a.server) call(`/alerts/${a.serverId}/acknowledge`, { method: 'POST' }).catch(() => {});
    };
  }

  // Where a tank's number came from, for the outlet page.
  Api.tankNote = function (o) {
    if (!Api.connected) return 'simulated tank gauges';
    const t = o.tanks.find((x) => x.source);
    if (!t) return 'no recent reading';
    if (t.source === 'automation' && !t.projected) return 'live from tank gauges';
    const at = t.asOf ? new Date(t.asOf).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: DB.util.TZ }) : '';
    const what = t.source === 'automation' ? 'gauge reading (gauge quiet since)' : 'manual dip';
    return `estimated from the ${at} ${what}, less sales, plus deliveries`;
  };

  /** Try to reach the backend; resolves true when connected. Never throws. */
  Api.connect = async function () {
    if (/(^|[#&])demo\b/.test(location.hash) || location.protocol === 'file:') { updateBadge(); return false; }
    try {
      await loadSnapshot();
    } catch (e) {
      updateBadge();
      return false; // no backend: stay in self-contained demo mode
    }
    Api.connected = true;
    Sim.serverOwned = (key) => OWNED.some((p) => key.startsWith(p));
    wrapActions();
    updateBadge();
    setInterval(poll, POLL_MS);
    return true;
  };
  Api.refresh = refresh;

  window.Api = Api;
})();
