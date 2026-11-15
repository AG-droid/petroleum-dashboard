/* =====================================================================
   PRAHARI — interface: area panel, outlet detail, views, assistant, search
   ===================================================================== */
(function () {
  'use strict';
  const { outlets, tankers, depots, competitors, PRODUCTS, HOURLY } = DB;
  const TZ = DB.util.TZ; // the sales area is in India: show every time in IST
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  // Escape text from outside sources (OpenStreetMap road names, the API) before it goes into HTML.
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  const ST_TXT = { ok: 'Running normally', warn: 'Needs attention', crit: 'Urgent', off: 'Offline' };
  const ST_HEX = { ok: '#57b583', warn: '#e0a645', crit: '#e5604f', off: '#7c8188' };
  const SEV_DOT = { critical: 'crit', high: 'crit', medium: 'warn', low: 'off' };

  const ic = (d, s) => `<svg class="i" viewBox="0 0 24 24"${s ? ` style="width:${s}px;height:${s}px"` : ''}>${d}</svg>`;
  const I = {
    x: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
    phone: ic('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 14),
    truck: ic('<path d="M2 7h11v9H2zM13 10h4l4 4v2h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>', 14),
    cal: ic('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', 14),
    flask: ic('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>', 14),
    plug: ic('<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/>', 14),
    pin: ic('<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>', 14),
    check: ic('<path d="m5 12 5 5 9-10"/>', 14),
    msg: ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', 14),
    mail: ic('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', 14),
    cam: ic('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>', 14),
    send: ic('<path d="M4 12 20 4l-6 16-3-7z"/>', 14),
  };

  const fmt = {
    kl: (v, d = 1) => (+v).toFixed(d),
    inr: (v) => '₹' + Math.round(v).toLocaleString('en-IN'),
    lakh: (v) => '₹' + (v / 100000).toFixed(1) + ' lakh',
    pct: (v) => Math.round(v * 100) + '%',
    time: (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ }),
    hm: (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }),
    date: (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }),
    ago(ts) {
      const s = (Date.now() - ts) / 1000;
      if (s < 45) return 'just now';
      if (s < 3600) return Math.round(s / 60) + ' min ago';
      if (s < 86400) return Math.round(s / 3600) + ' h ago';
      return Math.round(s / 86400) + ' d ago';
    },
    dur(days) { const h = days * 24; return h < 1.5 ? 'less than 2 hours' : h < 36 ? `about ${Math.round(h)} hours` : `about ${days.toFixed(1)} days`; },
  };
  const achCls = (a) => (a < 0.85 ? 'c-crit' : a < 0.95 ? 'c-warn' : '');
  const coverCls = (d) => (d < 1 ? 'c-crit' : d < 2 ? 'c-warn' : '');
  const daysTag = (d) => (d <= 10 ? 'crit' : d <= 30 ? 'warn' : '');
  const oLink = (o) => `<span class="link" data-outlet="${o.id}">${o.name}</span>`;
  const pname = (p) => PRODUCTS[p].name;

  const UI = {
    state: { view: 'ops', selected: null, tab: 'overview', lpTab: 'attention', alertFilter: 'All', planned: new Set(),
      lastAlertVer: -1, sort: { key: 'score', dir: 1 }, outletQuery: '', outletCat: 'All', survOutlet: 'All', ai: true, cpMsgs: [], headSig: '' },
  };
  UI.fmt = fmt;

  // ===================================================================
  // Plain-English summary of an outlet's most important issue
  // ===================================================================
  function summary(o) {
    const m = o.m, P = pname(m.minP);
    if (!o.raOnline) return { s: 'off', t: 'The automation link is down, so stock and sales figures are not updating.' };
    if (m.minDays < 1.5 && !m.tanker) return { s: 'crit', t: `${P} runs out in ${fmt.dur(m.minDays)}. ${o.pendingIndent ? 'The order is on hold until the dealer\'s payment clears.' : 'No truck is scheduled.'}` };
    if (o.densityDev > 3) return { s: 'crit', t: `The last diesel delivery failed the density check (+${o.densityDev.toFixed(1)} kg/m³ against the invoice).` };
    if (o.variation > 0.5) return { s: 'warn', t: `Stock doesn't match sales: ${o.variation.toFixed(2)}% unexplained loss over the last 3 days.` };
    if (m.minDays < 1.5 && m.tanker) return { s: 'warn', t: `${P} is low (${fmt.dur(m.minDays)} left), but a truck ${m.tanker.status === 'Loading' ? 'is loading for it' : 'arrives in ' + (Sim.etaMin(m.tanker) || '—') + ' min'}.` };
    const lic = m.lic.filter((l) => l.days <= 30).sort((a, b) => a.days - b.days)[0];
    if (lic) return { s: 'warn', t: `${lic.label} expires in ${lic.days} days.` };
    if (m.trend < -0.12) return { s: 'warn', t: `Sales are down ${Math.round(-m.trend * 100)}% on last week.${o.competitorNote ? ' A new competitor opened nearby.' : ''}` };
    const irr = o.compliance.irregularities.find((i) => i.status === 'Open');
    if (irr) return { s: 'warn', t: `Open inspection finding: ${irr.text.toLowerCase()}.` };
    if (m.faults) return { s: 'warn', t: `${m.faults} pump nozzle${m.faults > 1 ? 's are' : ' is'} out of service.` };
    if (m.camsOff) return { s: 'warn', t: `${m.camsOff} camera${m.camsOff > 1 ? 's are' : ' is'} offline.` };
    if (m.ach < 0.85) return { s: 'warn', t: `Behind this month's sales target (${fmt.pct(m.ach)} so far).` };
    return { s: 'ok', t: 'Everything is running normally.' };
  }
  UI.summary = summary;

  // ===================================================================
  // Init
  // ===================================================================
  UI.init = function () {
    $$('#rail button').forEach((b) => b.addEventListener('click', () => UI.setView(b.dataset.view)));
    $$('[data-basemap]').forEach((b) => b.addEventListener('click', () => MapView.setBasemap(b.dataset.basemap)));
    MapView.onBasemap = (base) => $$('[data-basemap]').forEach((x) => x.classList.toggle('active', x.dataset.basemap === base));
    $$('[data-layer]').forEach((c) => c.addEventListener('change', () => MapView.setLayer(c.dataset.layer, c.checked)));
    $('#btnLayers').addEventListener('click', (e) => { e.stopPropagation(); $('#layersPop').classList.toggle('hidden'); $('#btnLayers').classList.toggle('active'); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#layersPop') && !e.target.closest('#btnLayers')) { $('#layersPop').classList.add('hidden'); $('#btnLayers').classList.remove('active'); } });
    $('#btn3d').addEventListener('click', (e) => e.currentTarget.classList.toggle('active', MapView.toggle3D()));
    $('#btnHome').addEventListener('click', () => { UI.closeOutlet(); MapView.home(); });
    $('#searchBtn').addEventListener('click', openPalette);
    $('#areaSelect').addEventListener('click', () => toast('Only the Gurugram Sales Area is loaded in this demo', 'Other sales areas would appear here'));
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', (e) => {
      const ol = e.target.closest('[data-outlet]');
      if (ol) { e.preventDefault(); UI.selectOutlet(ol.dataset.outlet, ol.dataset.tab); return; }
      const tk = e.target.closest('[data-tanker]');
      if (tk) { e.preventDefault(); UI.selectTanker(tk.dataset.tanker); }
    });
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    $('#palette').addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });
    renderLeft();
    Sim.on(onTick);
    clock(); setInterval(clock, 1000);
    window.addEventListener('resize', () => MapView.resize());
  };

  function clock() {
    const d = new Date();
    $('#clock').innerHTML = `<span class="live-dot"></span>${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })} IST`;
  }
  function onKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') {
      if (!$('#palette').classList.contains('hidden')) return closePalette();
      if (!$('#modal').classList.contains('hidden')) return closeModal();
      if (UI.state.view !== 'ops') return UI.setView('ops');
      if (!$('#rightPanel').classList.contains('hidden')) return UI.closeOutlet();
    }
  }
  function onTick() {
    MapView.update();
    const v = UI.state.view;
    if (v === 'ops' || v === 'copilot') updateLeft();
    if (UI.state.selected && v === 'ops') updateOutlet();
    if (v === 'logistics') updateLogistics();
    if (v === 'outlets' && Sim.t % 3 === 0) updateOutletsTable();
    if (v === 'surveillance' && Sim.t % 2 === 0) updateSurvEvents();
  }

  // ===================================================================
  // Area metrics
  // ===================================================================
  function areaStats() {
    const s = { todayKL: 0, expectedKL: 0, mtd: 0, mtdT: 0, n: outlets.length, ok: 0, warn: 0, crit: 0, off: 0, lic30: 0, score: 0 };
    outlets.forEach((o) => {
      const m = o.m;
      s.todayKL += m.todayL / 1000; s.expectedKL += m.expectedL / 1000; s.mtd += m.mtdKL; s.mtdT += m.mtdTarget;
      s[m.status]++; s.lic30 += m.licSoon.length; s.score += m.score;
    });
    s.score = Math.round(s.score / s.n);
    s.ach = s.mtd / s.mtdT;
    s.transit = tankers.filter((t) => t.status === 'In transit').length;
    s.loading = tankers.filter((t) => t.status === 'Loading').length;
    s.unloading = tankers.filter((t) => t.status === 'Unloading').length;
    s.halted = tankers.filter((t) => t.status === 'Halted').length;
    s.returning = tankers.filter((t) => t.status === 'Returning').length;
    return s;
  }
  UI.areaStats = areaStats;

  // ===================================================================
  // Left panel
  // ===================================================================
  function renderLeft() {
    $('#leftPanel').innerHTML = `
      <div class="p-head">
        <div class="p-title">Gurugram Sales Area</div>
        <div class="p-sub" id="lpSub"></div>
      </div>
      <div style="padding:0 18px 16px">
        <div class="stats">
          <div class="stat"><div class="stat-label">Sold today</div><div class="stat-val" id="stToday"></div><div class="stat-foot" id="stTodayF"></div></div>
          <div class="stat click" data-goto="analytics"><div class="stat-label">This month</div><div class="stat-val" id="stMonth"></div><div class="stat-foot" id="stMonthF"></div></div>
          <div class="stat click" data-goto="outlets"><div class="stat-label">Outlets needing attention</div><div class="stat-val" id="stAtt"></div><div class="stat-foot" id="stAttF"></div></div>
          <div class="stat click" data-goto="logistics"><div class="stat-label">Trucks on the road</div><div class="stat-val" id="stTrucks"></div><div class="stat-foot" id="stTrucksF"></div></div>
        </div>
      </div>
      <div class="tabs" id="lpTabs">
        <button class="tab" data-lp="attention">Priorities <span class="count" id="cAtt"></span></button>
        <button class="tab" data-lp="alerts">All alerts <span class="count" id="cAl"></span></button>
        <button class="tab" data-lp="activity">Activity</button>
      </div>
      <div class="p-body" id="lpBody"></div>`;
    $$('#leftPanel [data-goto]').forEach((k) => { k.onclick = () => UI.setView(k.dataset.goto); });
    $$('#lpTabs .tab').forEach((b) => { b.onclick = () => { UI.state.lpTab = b.dataset.lp; UI.state.lastAlertVer = -1; updateLeft(); }; });
    UI.state.lastAlertVer = -1;
    updateLeft();
  }

  function attentionItems() {
    const open = Sim.alerts.filter((a) => a.status === 'open');
    const seen = new Set(), items = [];
    open.slice().sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.ts - a.ts).forEach((a) => {
      if (a.sev === 'low' || a.sev === 'medium') return;
      const key = a.key.startsWith('halt:') ? a.tankerId : a.outletId;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(a);
    });
    return items;
  }

  function updateLeft() {
    if (!$('#stToday')) return;
    const s = areaStats();
    const pct = s.todayKL / Math.max(0.01, s.expectedKL);
    const att = s.warn + s.crit + s.off;
    $('#lpSub').textContent = `${outlets.length} outlets · ${depots.length} supply points · ${tankers.length} trucks`;
    $('#stToday').innerHTML = `${fmt.kl(s.todayKL, 0)}<small>kL</small>`;
    $('#stTodayF').innerHTML = `<span class="${achCls(pct)}">${fmt.pct(pct)}</span> of plan so far`;
    $('#stMonth').innerHTML = `<span class="${achCls(s.ach)}">${fmt.pct(s.ach)}</span>`;
    $('#stMonthF').textContent = 'of monthly target';
    $('#stAtt').innerHTML = `${att}<small>of ${s.n}</small>`;
    $('#stAttF').innerHTML = s.crit + s.off ? `<span class="c-crit">${s.crit} urgent</span>${s.off ? ` · ${s.off} offline` : ''}` : 'none urgent';
    $('#stTrucks').innerHTML = `${s.transit}`;
    $('#stTrucksF').innerHTML = s.halted ? `<span class="c-crit">${s.halted} stopped off route</span>` : 'all on schedule';
    const items = attentionItems();
    const openAlerts = Sim.alerts.filter((a) => a.status !== 'resolved');
    $('#cAtt').textContent = items.length;
    $('#cAl').textContent = openAlerts.length;
    $$('#lpTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.lp === UI.state.lpTab));
    const tab = UI.state.lpTab;
    if (tab === 'activity') { renderActivity(); return; }
    if (UI.state.lastAlertVer !== Sim.alertsVersion || Sim.t % 15 === 0) {
      UI.state.lastAlertVer = Sim.alertsVersion;
      if (tab === 'attention') renderAttention(items); else renderAlertList();
    }
  }

  function attentionCard(a) {
    const o = DB.byId(a.outletId);
    let title, desc, acts = [];
    if (a.key.startsWith('halt:')) {
      const t = DB.tankerById(a.tankerId);
      title = `Truck ${t.plate} stopped off route`;
      desc = `Stopped for ${Math.round(t.haltSec / 60)} min on the way to ${o.name}. Seals not yet verified.`;
      acts = [`<button class="btn sm primary" data-act="driver" data-id="${t.id}">${I.phone}Contact driver</button>`, `<button class="btn sm ghost" data-tanker="${t.id}">Track</button>`];
    } else {
      const sm = summary(o);
      title = o.name;
      desc = a.expires || sm.s === 'ok' ? a.detail : sm.t;
      if (a.key.startsWith('dry:')) acts.push(`<button class="btn sm primary" data-act="dispatch" data-id="${o.id}">${I.truck}Send a truck now</button>`);
      if (a.key.startsWith('den:')) acts.push(`<button class="btn sm primary" data-act="hold" data-id="${o.id}">${I.flask}Hold tank &amp; test</button>`);
      if (a.key.startsWith('ra:')) acts.push(`<button class="btn sm primary" data-act="ra" data-id="${o.id}">${I.plug}Reconnect</button>`);
      acts.push(`<button class="btn sm ghost" data-outlet="${o.id}">Open outlet</button>`);
    }
    return `<div class="att"><span class="dot ${SEV_DOT[a.sev]}"></span><div>
      <div class="att-title" ${a.key.startsWith('halt:') ? `data-tanker="${a.tankerId}"` : `data-outlet="${o.id}"`}>${title}</div>
      <div class="att-desc">${desc}</div>
      <div class="att-actions">${acts.join('')}</div></div></div>`;
  }
  function renderAttention(items) {
    const body = $('#lpBody');
    body.innerHTML = items.length ? items.slice(0, 8).map(attentionCard).join('') + (items.length > 8 ? `<div style="padding-top:12px"><span class="text-btn" id="seeAll">See all ${items.length} in alerts</span></div>` : '')
      : '<div class="all-clear">No urgent issues right now.</div>';
    bindActs(body);
    const sa = $('#seeAll'); if (sa) sa.onclick = () => { UI.state.lpTab = 'alerts'; UI.state.lastAlertVer = -1; updateLeft(); };
  }
  // Re-render panels after data changed outside the 1-second tick (e.g. a backend refresh).
  UI.refresh = function () {
    UI.state.lastAlertVer = -1; UI.state.headSig = '';
    updateLeft();
    if (UI.state.selected) { renderOutletHead(DB.byId(UI.state.selected)); renderTab(); }
  };
  function bindActs(root) {
    $$('[data-act]', root).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); doAction(b.dataset.act, b.dataset.id); }; });
  }
  function doAction(act, id) {
    if (act === 'driver') { const t = DB.tankerById(id); Sim.actions.contactDriver(t); toast(`Driver of ${t.plate} contacted`, 'Truck is back on its planned route. Incident logged.', 'ok'); }
    if (act === 'dispatch') { const o = DB.byId(id); const t = Sim.actions.priorityDispatch(o); toast(`Truck ${t.plate} assigned to ${o.name}`, `Loading at ${DB.depotById(t.depotId).name}. Dealer asked to clear payment.`, 'ok'); }
    if (act === 'hold') { const o = DB.byId(id); Sim.actions.holdTank(o); toast('Tank held and sample requested', `${o.name}: quality team notified`, 'ok'); }
    if (act === 'ra' && window.Api && Api.connected) { const o = DB.byId(id); toast('Restart requested', `${o.name}: the dealer has been asked to restart the automation controller. The status updates when data arrives.`, 'ok'); return; }
    if (act === 'ra') { const o = DB.byId(id); toast('Reconnecting…', `Trying the backup 4G link at ${o.name}`); setTimeout(() => { Sim.actions.resetRA(o); toast('Automation link restored', o.name, 'ok'); }, 2000); }
    UI.state.lastAlertVer = -1; UI.state.headSig = '';
    setTimeout(() => { updateLeft(); if (UI.state.selected) { renderOutletHead(DB.byId(UI.state.selected)); if (UI.state.tab === 'supply') renderTab(); } }, 60);
  }

  function alertRow(a) {
    const o = DB.byId(a.outletId);
    return `<div class="alert ${a.fresh ? 'new' : ''} ${a.status === 'ack' ? 'acked' : ''}" data-alert="${a.id}">
      <span class="dot ${SEV_DOT[a.sev]}"></span>
      <div><div class="alert-title">${a.title}</div><div class="alert-meta">${a.cat} · ${o ? o.locality : ''} · ${fmt.ago(a.ts)}</div></div>
      ${a.status === 'open' ? `<span class="text-btn" data-ack="${a.id}">Acknowledge</span>` : '<span class="faint" style="font-size:12px">Acknowledged</span>'}
    </div>`;
  }
  function bindAlerts(root) {
    $$('[data-ack]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); Sim.actions.ack(b.dataset.ack); toast('Alert acknowledged', 'Assigned to you'); UI.state.lastAlertVer = -1; updateLeft(); if (UI.state.selected) renderOutletAlerts(); }));
    $$('[data-alert]', root).forEach((el) => el.addEventListener('click', () => {
      const a = Sim.alerts.find((x) => x.id === el.dataset.alert);
      if (!a) return;
      if (a.key.startsWith('halt:')) UI.selectTanker(a.tankerId);
      else UI.selectOutlet(a.outletId, a.key.startsWith('cam:') ? 'cameras' : a.cat === 'Compliance' ? 'compliance' : a.cat === 'Supply' || a.cat === 'Quality' ? 'supply' : 'overview');
    }));
  }
  function renderAlertList() {
    const f = UI.state.alertFilter;
    const list = Sim.alerts.filter((a) => a.status !== 'resolved').filter((a) => f === 'All' || a.cat === f)
      .sort((a, b) => (a.status === 'ack') - (b.status === 'ack') || SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.ts - a.ts);
    const cats = ['All', 'Supply', 'Stock', 'Quality', 'Security', 'Compliance', 'Equipment', 'Commercial'];
    $('#lpBody').innerHTML = `<div class="filter-row"><select class="input" id="alFilter">${cats.map((c) => `<option ${c === f ? 'selected' : ''} value="${c}">${c === 'All' ? 'All categories' : c}</option>`).join('')}</select><span class="faint" style="font-size:12px">${list.length} open</span></div>
      ${list.length ? list.slice(0, 60).map(alertRow).join('') : '<div class="empty">No alerts in this category</div>'}`;
    $('#alFilter').onchange = (e) => { UI.state.alertFilter = e.target.value; renderAlertList(); };
    bindAlerts($('#lpBody'));
  }
  function renderActivity() {
    const body = $('#lpBody');
    const top = Sim.events[0] ? Sim.events[0].ts : 0;
    if (body.dataset.top == top && body.dataset.kind === 'act') return;
    body.dataset.top = top; body.dataset.kind = 'act';
    body.innerHTML = Sim.events.slice(0, 40).map((e) => `<div class="activity ${e.type === 'alert' ? 'alert-ev' : e.type === 'ok' ? 'ok-ev' : ''}" ${e.outletId ? `data-outlet="${e.outletId}"` : ''}><time>${fmt.hm(e.ts)}</time><span>${e.text}</span></div>`).join('') || '<div class="empty">No activity yet</div>';
  }

  // ===================================================================
  // Outlet detail (right panel)
  // ===================================================================
  UI.selectOutlet = function (id, tab) {
    const o = DB.byId(id);
    if (!o) return;
    closePalette(); closeModal();
    if (UI.state.view !== 'ops') UI.setView('ops');
    const same = UI.state.selected === id;
    UI.state.selected = id;
    UI.state.tab = tab || (same ? UI.state.tab : 'overview');
    Sim.focusId = id;
    $('#stage').classList.add('right-open');
    $('#rightPanel').classList.remove('hidden');
    renderOutlet();
    MapView.flyToOutlet(o);
  };
  UI.closeOutlet = function () {
    UI.state.selected = null; Sim.focusId = null;
    $('#rightPanel').classList.add('hidden');
    $('#rightPanel').innerHTML = '';
    $('#stage').classList.remove('right-open');
    MapView.clearSelection();
  };
  UI.selectTanker = function (id) {
    const t = DB.tankerById(id);
    if (!t) return;
    closePalette();
    if (UI.state.view !== 'ops' && UI.state.view !== 'logistics') UI.setView('ops');
    if (UI.state.view === 'ops') openTankerPanel(t);
    MapView.flyToTanker(t);
  };

  function primaryAction(o) {
    if (Sim.alerts.some((x) => x.key === 'dry:' + o.id)) return `<button class="btn primary" data-oact="dispatch">${I.truck}Send a truck now</button>`;
    if (o.densityDev > 3) return `<button class="btn primary" data-oact="hold">${I.flask}Hold tank &amp; test</button>`;
    if (!o.raOnline) return `<button class="btn primary" data-oact="ra">${I.plug}Reconnect automation</button>`;
    return '';
  }
  function renderOutletHead(o) {
    const sm = summary(o);
    const pa = primaryAction(o);
    const sig = sm.t + pa + UI.state.planned.has(o.id);
    if (sig === UI.state.headSig && $('#odHead').childElementCount) return;
    UI.state.headSig = sig;
    $('#odHead').innerHTML = `
      <button class="icon-btn od-close" id="odClose" title="Close">${I.x}</button>
      <div class="od-name">${o.name}</div>
      <div class="od-meta">${o.locality}, ${o.road} · ${o.category} · <span class="mono">${o.id}</span></div>
      <div class="od-summary"><span class="dot ${sm.s}"></span><span>${sm.t}</span></div>
      <div class="od-actions">${pa}<button class="btn ${pa ? '' : 'primary'}" data-oact="call">${I.phone}Call dealer</button><button class="btn" data-oact="inspect">${I.cal}${UI.state.planned.has(o.id) ? 'Visit scheduled' : 'Schedule visit'}</button></div>`;
    $('#odClose').onclick = UI.closeOutlet;
    $$('#odHead [data-oact]').forEach((b) => { b.onclick = () => outletAction(o, b.dataset.oact); });
  }
  function outletAction(o, act) {
    if (act === 'dispatch' || act === 'hold' || act === 'ra') return doAction(act, o.id);
    if (act === 'call') toast(`Calling ${o.dealer.name}`, `${o.dealer.phone} · the call will be logged`);
    if (act === 'inspect') { UI.state.planned.add(o.id); toast('Visit scheduled', `${o.name} added to this week's field plan`, 'ok'); }
    UI.state.headSig = '';
    renderOutletHead(o);
  }
  function renderOutlet() {
    const o = DB.byId(UI.state.selected);
    $('#rightPanel').innerHTML = `<div class="od-head" id="odHead"></div>
      <div class="kstats">
        <div class="kstat"><div class="l">Sold today</div><div class="v" id="ksToday"></div></div>
        <div class="kstat"><div class="l">Lowest stock</div><div class="v" id="ksStock"></div></div>
        <div class="kstat"><div class="l">This month</div><div class="v" id="ksMonth"></div></div>
        <div class="kstat"><div class="l">Health</div><div class="v" id="ksHealth"></div></div>
      </div>
      <div class="tabs" id="odTabs">${['overview', 'sales', 'supply', 'cameras', 'compliance', 'dealer'].map((t) => `<button class="tab ${UI.state.tab === t ? 'active' : ''}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      <div class="p-body" id="odBody" style="padding-top:14px"></div>`;
    $$('#odTabs .tab').forEach((b) => { b.onclick = () => { UI.state.tab = b.dataset.tab; $$('#odTabs .tab').forEach((x) => x.classList.toggle('active', x === b)); renderTab(); }; });
    UI.state.headSig = '';
    renderOutletHead(o);
    updateKstats(o);
    renderTab();
  }
  function updateKstats(o) {
    const m = o.m;
    $('#ksToday').innerHTML = `${fmt.kl(m.todayL / 1000)} <span class="faint" style="font-size:12px;font-weight:400">kL</span>`;
    $('#ksStock').innerHTML = `<span class="${coverCls(m.minDays)}">${fmt.kl(m.minDays)} d</span>`;
    $('#ksMonth').innerHTML = `<span class="${achCls(m.ach)}">${fmt.pct(m.ach)}</span>`;
    $('#ksHealth').innerHTML = `${m.score}<span class="faint" style="font-size:12px;font-weight:400">/100</span>`;
  }
  function updateOutlet() {
    const o = DB.byId(UI.state.selected);
    if (!o || !$('#odHead')) return;
    renderOutletHead(o);
    updateKstats(o);
    if (UI.state.tab === 'overview') updateOverview(o);
    if (UI.state.tab === 'supply' && Sim.t % 2 === 0) updateSupplyLive(o);
  }
  function renderTab() {
    const o = DB.byId(UI.state.selected);
    const body = $('#odBody');
    if (!o || !body) return;
    body.scrollTop = 0;
    ({ overview: renderOverview, sales: renderSales, supply: renderSupply, cameras: renderCameras, compliance: renderCompliance, dealer: renderDealer })[UI.state.tab](o, body);
  }

  // ---------- Overview ----------
  function tankRow(o, t) {
    const per = o.prod[t.product] / o.tanks.filter((x) => x.product === t.product).length;
    const d = t.stock / per, pct = t.stock / t.cap;
    const col = d < 1 ? 'var(--crit)' : d < 2 ? 'var(--warn)' : 'var(--text-2)';
    return `<div class="tankrow"><div class="name">${pname(t.product)}<span>Tank ${t.id.slice(1)}</span></div>
      <div class="right"><span class="${coverCls(d)}">${fmt.kl(d)} days</span> <span class="faint">left</span></div>
      <div class="bar"><i style="width:${pct * 100}%;background:${col}"></i></div>
      <div class="sub">${fmt.kl(t.stock)} of ${t.cap} kL · water ${t.water} mm · ${fmt.kl(t.temp)}°C</div></div>`;
  }
  function renderOverview(o, body) {
    const cam = o.cameras[0];
    body.innerHTML = `
      ${o.competitorNote ? `<div class="callout warn">${o.competitorNote}.</div>` : ''}
      ${!o.raOnline ? `<div class="callout crit">Figures below are from the last sync at ${fmt.hm(Sim.raLastSync)}.</div>` : ''}
      <div class="section"><div class="sh"><h4>Tanks</h4><span class="aside">${window.Api ? Api.tankNote(o) : 'simulated tank gauges'}</span></div><div id="ovTanks"></div></div>
      <div class="section"><div class="sh"><h4>Pumps</h4><span class="aside" id="ovNozA"></span></div><div class="nozzles" id="ovNoz"></div></div>
      <div class="section"><div class="sh"><h4>Recent sales</h4><span class="aside" id="ovTodayA"></span></div><div id="ovTx"></div></div>
      <div class="section"><div class="sh"><h4>Camera</h4><span class="aside text-btn" id="ovAllCams">All ${o.cameras.length} cameras</span></div>
        <div class="cam-preview" id="ovCam"><canvas></canvas></div></div>
      <div class="section"><div class="sh"><h4>Alerts</h4><span class="aside" id="ovAlertCount"></span></div><div id="ovAlerts"></div></div>`;
    CCTV.attach($('#ovCam canvas'), { scene: cam.scene, seed: cam.seed, label: cam.label, sub: o.name, online: cam.online, ai: UI.state.ai });
    $('#ovCam').onclick = () => openCamModal(o, cam);
    $('#ovAllCams').onclick = () => { UI.state.tab = 'cameras'; $$('#odTabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'cameras')); renderTab(); };
    updateOverview(o);
    renderOutletAlerts();
  }
  let lastOutletAlertVer = -1;
  function renderOutletAlerts() {
    const el = $('#ovAlerts');
    if (!el) return;
    const list = Sim.alerts.filter((a) => a.outletId === UI.state.selected && a.status !== 'resolved').sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
    $('#ovAlertCount').textContent = list.length ? `${list.length} open` : '';
    el.innerHTML = list.length ? list.map(alertRow).join('') : '<div class="empty" style="text-align:left;padding:4px 0">No open alerts.</div>';
    bindAlerts(el);
  }
  function updateOverview(o) {
    if (!$('#ovTanks')) return;
    $('#ovTanks').innerHTML = o.tanks.map((t) => tankRow(o, t)).join('');
    const active = o.nozzles.filter((n) => n.status === 'Dispensing').length, faults = o.nozzles.filter((n) => n.status === 'Fault').length;
    $('#ovNozA').innerHTML = `${active} in use${faults ? ` · <span class="c-crit">${faults} out of service</span>` : ''}`;
    $('#ovNoz').innerHTML = o.nozzles.map((n) => `<div class="noz ${n.status === 'Dispensing' ? 'disp' : n.status === 'Fault' ? 'fault' : ''}" title="${n.du} · meter ${Math.round(n.totalizer).toLocaleString('en-IN')} L"><b>${n.id}</b>${PRODUCTS[n.product].name}<br>${n.status === 'Fault' ? '<span class="c-crit">Out of service</span>' : n.status === 'Dispensing' ? '<span class="c-ok">Fuelling</span>' : n.last ? fmt.kl(n.last.L) + ' L' : 'Idle'}</div>`).join('');
    $('#ovTodayA').innerHTML = `${fmt.inr(Object.keys(o.prod).reduce((a, p) => a + o.today[p] * PRODUCTS[p].price, 0))} today`;
    const tx = o.txns.slice(0, 6);
    $('#ovTx').innerHTML = !o.raOnline ? '<div class="empty">No live feed while automation is offline</div>' : tx.length ? `<table class="t compact"><thead><tr><th>Time</th><th>Pump</th><th>Fuel</th><th class="r">Litres</th><th class="r">Amount</th><th>Paid by</th></tr></thead><tbody>${tx.map((x, i) => `<tr class="${i === 0 && Date.now() - x.ts < 1100 ? 'txn-in' : ''}"><td>${fmt.time(x.ts)}</td><td>${x.nozzle}</td><td class="l">${pname(x.product)}</td><td class="r">${fmt.kl(x.L, 1)}</td><td class="r l">${fmt.inr(x.amt)}</td><td>${x.mode}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Waiting for the next sale…</div>';
    if (lastOutletAlertVer !== Sim.alertsVersion) { lastOutletAlertVer = Sim.alertsVersion; renderOutletAlerts(); }
  }

  // ---------- Sales ----------
  function hourly(o) {
    if (!o._hourly) { const rng = DB.util.mulberry32(o.id.length * 977 + Math.round(o.lat * 1e4)); o._hourly = HOURLY.map((w) => o.daily * 1000 * w * (0.85 + rng() * 0.3)); }
    return o._hourly;
  }
  function renderSales(o, body) {
    const m = o.m;
    const near = competitors.filter((c) => DB.util.haversineKm([c.lng, c.lat], [o.lng, o.lat]) < 3);
    const share = o.daily / (o.daily + near.reduce((a, c) => a + c.estDaily, 0));
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="stat-label">Sold this month</div><div class="stat-val">${fmt.kl(m.mtdKL, 0)}<small>kL</small></div><div class="stat-foot">target so far ${fmt.kl(m.mtdTarget, 0)} kL</div></div>
        <div class="stat"><div class="stat-label">Against target</div><div class="stat-val ${achCls(m.ach)}">${fmt.pct(m.ach)}</div><div class="stat-foot">month target ${fmt.kl(o.targetMonth, 0)} kL</div></div>
        <div class="stat"><div class="stat-label">vs last week</div><div class="stat-val ${m.trend < -0.05 ? 'c-crit' : ''}">${m.trend >= 0 ? '+' : ''}${(m.trend * 100).toFixed(1)}%</div><div class="stat-foot">${fmt.kl(m.last7)} vs ${fmt.kl(m.prev7)} kL a day</div></div>
        <div class="stat"><div class="stat-label">Local market share</div><div class="stat-val">${fmt.pct(share)}</div><div class="stat-foot">${near.length} competitor${near.length === 1 ? '' : 's'} within 3 km</div></div>
      </div>
      <div class="section"><div class="sh"><h4>Daily sales, last 30 days</h4><span class="aside">kL</span></div><canvas class="chart" id="chSales"></canvas></div>
      <div class="section"><div class="sh"><h4>By fuel, last 30 days</h4></div><canvas class="chart short" id="chMix"></canvas></div>
      <div class="section"><div class="sh"><h4>Today by hour</h4><span class="aside">litres</span></div><canvas class="chart short" id="chHour"></canvas></div>`;
    requestAnimationFrame(() => {
      const labels = o.hist.map((h) => +h.date.slice(8) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+h.date.slice(5, 7) - 1]);
      Charts.line($('#chSales'), { labels, series: [{ data: o.hist.map((h) => h.total), color: '#7aa7ff', label: 'Sold', fill: true }, { data: o.hist.map(() => o.targetMonth / 30), color: '#6e737a', label: 'Target', dash: [3, 4], width: 1.2 }], yFmt: (v) => v.toFixed(0) });
      Charts.bars($('#chMix'), { horizontal: true, labelWidth: 110, items: Object.keys(o.prod).map((p) => ({ label: pname(p), value: o.hist.reduce((a, h) => a + h[p], 0), color: PRODUCTS[p].color })), fmt: (v) => v.toFixed(0) + ' kL' });
      const hr = DB.util.istNow().getHours();
      Charts.bars($('#chHour'), { items: hourly(o).map((v, i) => ({ label: String(i), value: i <= hr ? v : 0, color: i === hr ? '#ecedee' : '#4a4f57' })), yFmt: (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) });
    });
  }

  // ---------- Supply ----------
  function deliveryBox(o) {
    const t = o.m.tanker;
    if (t) {
      const eta = Sim.etaMin(t);
      return `<div class="info-box"><div style="display:flex;justify-content:space-between;align-items:center"><b>${t.plate}</b><span class="status ${t.status === 'Halted' ? 'crit' : 'acc'}">${t.status}${eta && t.status !== 'Halted' ? ` · arrives in ${eta} min` : ''}</span></div>
        <div class="progress"><i style="width:${t.status === 'Loading' ? 3 : t.progress * 100}%"></i></div>
        <div class="kv"><span>From</span><div>${DB.depotById(t.depotId).name}</div><span>Carrying</span><div>${t.comps.map((c) => `${c.kl} kL ${pname(c.product).toLowerCase()}`).join(', ')}</div><span>Driver</span><div>${t.driver} · ${t.transporter}</div><span>Invoice · seals</span><div class="mono">${t.invoice} · ${t.seals.join(', ')}</div></div>
        <div style="margin-top:12px"><button class="btn sm ghost" data-tanker="${t.id}">${I.pin}Track on map</button></div></div>`;
    }
    return `<div class="info-box"><b>No delivery scheduled</b><div class="muted" style="margin-top:3px">${o.pendingIndent ? `An order for ${o.pendingIndent.qty} kL of ${pname(o.pendingIndent.product).toLowerCase()} is on hold: ${o.pendingIndent.reason.toLowerCase()}.` : 'The dealer\'s next order is expected soon.'}</div>
      ${o.m.minDays < 2 ? `<div style="margin-top:12px"><button class="btn sm primary" data-sact="dispatch">${I.truck}Send a truck now</button></div>` : ''}</div>`;
  }
  function renderSupply(o, body) {
    if (!o._var) { const rng = DB.util.mulberry32(o.id.length * 31 + Math.round(o.lng * 1e3)); o._var = Array.from({ length: 7 }, (_, i) => Math.max(0.02, o.variation * (0.7 + rng() * 0.5) * (0.85 + i * 0.03))); o._var[6] = o.variation; }
    body.innerHTML = `
      <div class="section"><div class="sh"><h4>Next delivery</h4></div><div id="supDel"></div></div>
      <div class="section"><div class="sh"><h4>Stock left</h4><span class="aside">at current sales rate</span></div><div id="supCover"></div></div>
      <div class="section"><div class="sh"><h4>Recent deliveries</h4></div>
      <table class="t compact"><thead><tr><th>Date</th><th>Fuel</th><th class="r">kL</th><th class="r">Density check</th><th>Status</th></tr></thead>
      <tbody>${o.indents.slice(0, 7).map((i) => `<tr><td>${fmt.date(i.date)}</td><td class="l">${pname(i.product)}</td><td class="r">${i.qty}</td><td class="r ${Math.abs(i.obsDiff) > 3 ? 'c-crit' : ''}">${Math.abs(i.obsDiff) > 3 ? 'Failed ' : 'Passed '}<span class="faint">${i.obsDiff >= 0 ? '+' : ''}${i.obsDiff.toFixed(1)}</span></td><td>${i.status}${i.shortL ? ` <span class="c-warn">· ${i.shortL} L short</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="section"><div class="sh"><h4>Unexplained stock loss, last 7 days</h4><span class="aside">% of sales</span></div><canvas class="chart short" id="chVar"></canvas>
      <div class="faint" style="font-size:11.5px;margin-top:4px">Dashed line: 0.5% limit used in this demo.</div></div>`;
    updateSupplyLive(o);
    requestAnimationFrame(() => {
      const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.now() - (6 - i) * 86400000); return d.getDate() + '/' + (d.getMonth() + 1); });
      Charts.line($('#chVar'), { labels: days, legend: false, series: [{ data: o._var, color: o.variation > 0.5 ? '#e5604f' : '#7aa7ff', fill: true }, { data: days.map(() => 0.5), color: '#6e737a', dash: [3, 4], width: 1.2 }], yFmt: (v) => v.toFixed(2) });
    });
  }
  function updateSupplyLive(o) {
    if (!$('#supCover')) return;
    $('#supCover').innerHTML = Object.keys(o.prod).map((p) => {
      const c = o.m.cover[p];
      const col = c.days < 1 ? 'var(--crit)' : c.days < 2 ? 'var(--warn)' : 'var(--text-2)';
      return `<div class="tankrow"><div class="name">${pname(p)}</div><div class="right"><span class="${coverCls(c.days)}">${fmt.kl(c.days)} days</span> <span class="faint">· ${fmt.kl(c.stock)} kL</span></div><div class="bar"><i style="width:${Math.min(100, c.days / 5 * 100)}%;background:${col}"></i></div></div>`;
    }).join('');
    $('#supDel').innerHTML = deliveryBox(o);
    $$('#supDel [data-sact]').forEach((b) => { b.onclick = () => doAction('dispatch', o.id); });
  }

  // ---------- Cameras ----------
  function renderCameras(o, body) {
    const on = o.cameras.filter((c) => c.online).length;
    const evs = Sim.aiEvents.filter((e) => e.outletId === o.id).slice(0, 6);
    body.innerHTML = `
      <div class="sh"><h4>${on} of ${o.cameras.length} cameras online</h4><span class="aside text-btn" id="aiToggle">${UI.state.ai ? 'Hide' : 'Show'} detections</span></div>
      <div class="cam-grid">${o.cameras.map((c, i) => `<div><div class="cam" data-cam="${i}"><canvas></canvas></div><div class="cam-cap"><span>${c.label}</span><span class="status ${c.online ? 'ok' : 'crit'}">${c.online ? 'Live' : 'Offline'}</span></div></div>`).join('')}</div>
      <div class="section"><div class="sh"><h4>Recent detections</h4></div>
      ${evs.map((e) => `<div class="ev" style="cursor:default"><span class="tag">${tagName(e.tag)}</span><span class="ev-t">${e.text}</span><small>${fmt.ago(e.ts)}</small></div>`).join('') || '<div class="empty">Nothing detected in the last hour</div>'}</div>`;
    $$('.cam', body).forEach((el) => {
      const c = o.cameras[+el.dataset.cam];
      CCTV.attach($('canvas', el), { scene: c.scene, seed: c.seed, label: c.label, sub: o.name, online: c.online, ai: UI.state.ai });
      el.onclick = () => openCamModal(o, c);
    });
    $('#aiToggle').onclick = () => { UI.state.ai = !UI.state.ai; CCTV.setAI(UI.state.ai); renderCameras(o, body); };
  }
  const tagName = (t) => ({ ANPR: 'Number plate', QUEUE: 'Queue', TANKER: 'Tanker', PPE: 'Safety', COUNT: 'Footfall', LOITER: 'Loitering' })[t] || t;
  function openCamModal(o, c) {
    const evs = Sim.aiEvents.filter((e) => e.outletId === o.id).slice(0, 5);
    openModal(`
      <div class="modal-head"><div class="grow"><b>${c.label}</b> <span class="faint">· ${o.name}</span></div>
        <span class="status ${c.online ? 'ok' : 'crit'}">${c.online ? 'Live' : 'Offline'}</span>
        <button class="btn sm" id="mSnap">Save snapshot</button><button class="btn sm" id="mTalk">Speak to site</button><button class="btn sm ghost" data-outlet="${o.id}">Open outlet</button>
        <button class="icon-btn" id="mClose">${I.x}</button></div>
      <div class="modal-body" style="display:grid;grid-template-columns:1fr 250px;gap:18px">
        <div class="cam-big"><canvas id="mCam"></canvas></div>
        <div><div class="sh"><h4>Camera</h4></div>
          <div class="kv" style="grid-template-columns:80px 1fr"><span>ID</span><div class="mono">${c.id}</div><span>Stream</span><div>1080p · 15 fps</div><span>Detects</span><div>${c.scene === 'entry' ? 'Number plates, vehicle count' : c.scene === 'decant' ? 'Tankers, safety gear, intrusion' : c.scene === 'cash' ? 'People, cash drawer' : 'Vehicles, queues, staff'}</div><span>Recording</span><div>30 days on site</div></div>
          <div class="section"><div class="sh"><h4>Detections</h4></div>${evs.map((e) => `<div class="ev" style="cursor:default"><span class="tag">${tagName(e.tag)}</span>${e.text}<small>${fmt.ago(e.ts)}</small></div>`).join('') || '<div class="empty">None</div>'}</div>
        </div>
      </div>`);
    requestAnimationFrame(() => CCTV.attach($('#mCam'), { scene: c.scene, seed: c.seed, label: c.label, sub: o.name, online: c.online, ai: UI.state.ai }));
    $('#mClose').onclick = closeModal;
    $('#mSnap').onclick = () => toast('Snapshot saved', `${c.label}, ${fmt.time(Date.now())} · attached to ${o.name}`, 'ok');
    $('#mTalk').onclick = () => toast('Site speaker on', `You can now speak to ${c.label.toLowerCase()}`);
  }

  // ---------- Compliance ----------
  function renderCompliance(o, body) {
    const c = o.compliance;
    body.innerHTML = `
      <div class="sh"><h4>Licences &amp; certificates</h4></div>
      ${o.m.lic.map((l) => `<div class="row-item"><div><b>${l.label}</b><small>Valid until ${fmt.date(l.due)}</small></div><span class="tag ${daysTag(l.days)}">${l.days} days left</span></div>`).join('')}
      <div class="section"><div class="sh"><h4>Open findings</h4></div>
      ${c.irregularities.length ? c.irregularities.map((ir, i) => `<div class="row-item"><div><b>${ir.text}</b><small>Raised ${fmt.date(ir.date)}</small></div>${ir.status === 'Open' ? `<button class="btn sm" data-irr="${i}">${I.check}Mark resolved</button>` : '<span class="tag ok">Resolved</span>'}</div>`).join('') : '<div class="faint" style="padding:4px 0">None.</div>'}</div>
      <div class="section"><div class="sh"><h4>Inspection history</h4></div>
      <table class="t compact"><tbody>${c.inspections.map((i) => `<tr><td>${fmt.date(i.date)}</td><td class="l">${i.type}</td><td>${i.by}</td><td class="r"><span class="status ${i.result === 'Satisfactory' ? 'ok' : 'warn'}">${i.result}</span></td></tr>`).join('')}</tbody></table></div>
      <div class="section"><div class="sh"><h4>Customer complaints</h4></div>
      ${o.complaints.length ? o.complaints.slice(0, 5).map((x) => `<div class="row-item"><div><b>${x.text}</b><small>${fmt.date(x.date)}</small></div><span class="tag ${x.status === 'Open' ? 'warn' : 'ok'}">${x.status}</span></div>`).join('') : '<div class="faint" style="padding:4px 0">No complaints in the last 30 days.</div>'}</div>
      <div style="margin-top:18px;display:flex;gap:8px"><button class="btn primary" id="cpSched">${I.cal}${UI.state.planned.has(o.id) ? 'Visit scheduled' : 'Schedule visit'}</button><button class="btn" id="cpRemind">Remind dealer of renewals</button></div>`;
    $$('[data-irr]', body).forEach((b) => { b.onclick = () => { Sim.actions.resolveIrregularity(o, +b.dataset.irr); toast('Finding marked resolved'); renderCompliance(o, body); }; });
    $('#cpSched').onclick = () => { UI.state.planned.add(o.id); toast('Visit scheduled', o.name, 'ok'); renderCompliance(o, body); };
    $('#cpRemind').onclick = () => toast('Reminder sent', `${o.dealer.name} by SMS and WhatsApp`, 'ok');
  }

  // ---------- Dealer ----------
  function renderDealer(o, body) {
    const d = o.dealer, cr = o.credit;
    body.innerHTML = `
      <div class="sh"><h4>Dealer</h4></div>
      <div class="kv"><span>Name</span><div>${d.name}</div><span>Phone</span><div>${d.phone}</div><span>Email</span><div>${d.email}</div><span>Dealer since</span><div>${d.since} (${new Date().getFullYear() - d.since} years)</div><span>Outlet type</span><div>${o.type} · ${o.category}</div><span>Address</span><div>${o.address}</div></div>
      <div style="display:flex;gap:6px;margin-top:14px"><button class="btn primary" data-dact="call">${I.phone}Call</button><button class="btn" data-dact="wa">${I.msg}WhatsApp</button><button class="btn" data-dact="mail">${I.mail}Email</button></div>
      <div class="section"><div class="sh"><h4>Account</h4></div>
      <div class="kv"><span>Credit limit</span><div>${fmt.lakh(cr.limit)}</div><span>Outstanding</span><div>${fmt.lakh(cr.outstanding)} <span class="faint">(${fmt.pct(cr.outstanding / cr.limit)} used)</span></div><span>Overdue</span><div class="${cr.overdueDays > 30 ? 'c-crit' : cr.overdueDays ? 'c-warn' : ''}">${cr.overdueDays ? cr.overdueDays + ' days' : 'Nothing overdue'}</div><span>Order on hold</span><div>${o.pendingIndent ? `${o.pendingIndent.qty} kL ${pname(o.pendingIndent.product).toLowerCase()}: ${o.pendingIndent.reason.toLowerCase()}` : 'None'}</div></div></div>
      <div class="section"><div class="sh"><h4>Notes</h4></div>
      <div id="notes">${o.notes.map((n) => `<div class="note"><small>${fmt.date(n.ts)}, ${fmt.hm(n.ts)}</small>${n.text}</div>`).join('') || '<div class="faint" style="padding:2px 0 10px">No notes yet.</div>'}</div>
      <textarea class="input" id="noteIn" rows="2" placeholder="Add a note from a visit or call"></textarea>
      <div style="margin-top:8px"><button class="btn" id="noteAdd">Save note</button></div></div>`;
    $$('[data-dact]', body).forEach((b) => { b.onclick = () => toast({ call: `Calling ${d.name}`, wa: `Opening WhatsApp chat with ${d.name}`, mail: `New email to ${d.name}` }[b.dataset.dact], 'Logged against ' + o.name); });
    $('#noteAdd').onclick = () => { const v = $('#noteIn').value.trim(); if (!v) return; o.notes.unshift({ ts: Date.now(), text: v.replace(/</g, '&lt;') }); toast('Note saved', o.name, 'ok'); renderDealer(o, body); };
  }

  // ---------- Truck panel ----------
  function openTankerPanel(t) {
    UI.state.selected = null; Sim.focusId = null;
    $('#stage').classList.add('right-open');
    const rp = $('#rightPanel');
    rp.classList.remove('hidden');
    const draw = () => {
      const o = DB.byId(t.outletId), eta = Sim.etaMin(t), halted = t.status === 'Halted';
      rp.innerHTML = `<div class="od-head"><button class="icon-btn od-close" id="tkClose">${I.x}</button>
        <div class="od-name">${t.plate}</div><div class="od-meta">Tank truck · ${t.cap} kL · ${t.transporter}</div>
        <div class="od-summary"><span class="dot ${halted ? 'crit' : 'ok'}"></span><span>${halted ? `Stopped for ${Math.round(t.haltSec / 60)} min, ${Sim.offRouteKm(t).toFixed(1)} km off its planned route. Seals not yet verified.` : `${t.status}${eta ? `, arriving at ${o.name} in about ${eta} min` : ''}.`}</span></div>
        <div class="od-actions">${halted ? `<button class="btn primary" id="tkCall">${I.phone}Contact driver</button>` : `<button class="btn primary" id="tkCall">${I.phone}Call driver</button>`}<button class="btn" data-outlet="${o.id}" data-tab="supply">Destination outlet</button></div></div>
        <div class="p-body" style="border-top:1px solid var(--border);padding-top:16px">
          <div class="kv"><span>Route</span><div>${DB.depotById(t.depotId).name} → ${o.name}</div><span>Distance</span><div>${fmt.kl(t.route.km)} km${t.route.min ? ` · about ${Math.round(t.route.min)} min driving` : ''}</div>${t.route.via && t.route.via.length ? `<span>Via</span><div>${esc(t.route.via.slice(0, 2).join(', '))}</div>` : ''}<span>Progress</span><div>${Math.round(t.progress * 100)}%</div><span>Carrying</span><div>${t.comps.map((c) => `${c.kl} kL ${pname(c.product).toLowerCase()}`).join(', ')}</div><span>Driver</span><div>${t.driver}</div><span>Invoice</span><div class="mono">${t.invoice}</div><span>Seals</span><div class="mono">${t.seals.join(', ')}</div><span>Left depot</span><div>${fmt.hm(t.dispatchedAt)}</div></div>
          <div class="progress" style="margin-top:16px"><i style="width:${t.progress * 100}%;${halted ? 'background:var(--crit)' : ''}"></i></div>
          <div class="section"><div class="sh"><h4>Trip log</h4></div>
            <div class="note"><small>${fmt.hm(t.dispatchedAt)}</small>Left ${DB.depotById(t.depotId).name}; seals checked at the gantry</div>
            ${halted ? `<div class="note"><small>${fmt.hm(Date.now() - t.haltSec * 1000)}</small><span class="c-crit">Left the planned route and stopped; engine running</span></div>` : `<div class="note"><small>${fmt.hm(Date.now() - 6 * 60000)}</small>On planned route, average 34 km/h</div>`}
          </div></div>`;
      $('#tkClose').onclick = UI.closeOutlet;
      $('#tkCall').onclick = () => { if (halted) { Sim.actions.contactDriver(t); toast(`Driver of ${t.plate} contacted`, 'Truck is back on its planned route. Incident logged.', 'ok'); draw(); UI.state.lastAlertVer = -1; } else toast(`Calling ${t.driver}`, t.plate); };
    };
    draw();
  }

  // ===================================================================
  // Views
  // ===================================================================
  UI.setView = function (v) {
    UI.state.view = v;
    $$('#rail button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    const ov = $('#overlay');
    ov.className = 'overlay';
    $('#legend').classList.toggle('hidden', v !== 'ops' && v !== 'copilot');
    if (v === 'ops') {
      ov.classList.add('hidden'); ov.innerHTML = '';
      $('#leftPanel').classList.remove('hidden');
      if (!UI.state.selected) { $('#rightPanel').classList.add('hidden'); $('#stage').classList.remove('right-open'); }
      UI.state.lastAlertVer = -1; updateLeft();
      return;
    }
    $('#rightPanel').classList.add('hidden'); $('#rightPanel').innerHTML = '';
    $('#stage').classList.remove('right-open');
    UI.state.selected = null; Sim.focusId = null; MapView.clearSelection();
    $('#leftPanel').classList.toggle('hidden', v !== 'copilot');
    if (v === 'outlets') { ov.classList.add('w-half'); renderOutletsView(ov); }
    if (v === 'logistics') { ov.classList.add('w-half'); renderLogistics(ov); }
    if (v === 'surveillance') { ov.classList.add('w-full'); renderSurveillance(ov); }
    if (v === 'compliance') { ov.classList.add('w-half'); renderComplianceView(ov); }
    if (v === 'analytics') { ov.classList.add('w-full'); renderAnalytics(ov); }
    if (v === 'copilot') { ov.classList.add('w-drawer'); renderCopilot(ov); }
  };
  function head(title, sub, extra) {
    return `<div class="ov-head"><div class="grow"><div class="p-title">${title}</div>${sub ? `<div class="p-sub">${sub}</div>` : ''}</div>${extra || ''}<button class="icon-btn" data-close title="Close">${I.x}</button></div>`;
  }
  function bindClose(ov) { $('[data-close]', ov).onclick = () => UI.setView('ops'); }
  const summaryRow = (items) => `<div class="summary-row">${items.map(([l, v, c]) => `<div><div class="l">${l}</div><div class="v ${c || ''}">${v}</div></div>`).join('')}</div>`;

  // ---------- Outlets ----------
  const COLS = [
    { k: 'name', l: 'Outlet', v: (o) => o.name },
    { k: 'status', l: 'Status', v: (o) => ({ crit: 0, off: 1, warn: 2, ok: 3 }[o.m.status]) },
    { k: 'category', l: 'Type', v: (o) => o.category },
    { k: 'today', l: 'Sold today', r: true, v: (o) => o.m.todayL },
    { k: 'ach', l: 'Month vs target', r: true, v: (o) => o.m.ach },
    { k: 'cover', l: 'Lowest stock', r: true, v: (o) => o.m.minDays },
    { k: 'score', l: 'Health', r: true, v: (o) => o.m.score },
    { k: 'insp', l: 'Last visit', r: true, v: (o) => -o.compliance.lastInspection },
  ];
  function renderOutletsView(ov) {
    ov.innerHTML = head('Outlets', `${outlets.length} retail outlets in the Gurugram Sales Area`) + `
      <div class="ov-body" style="display:flex;flex-direction:column;padding-bottom:0">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
          <input class="input" id="olQ" placeholder="Filter by name, place or dealer" style="width:260px" value="${UI.state.outletQuery}">
          <div class="chips" id="olCat">${['All', 'Highway', 'Urban', 'Rural'].map((c) => `<button class="chip ${UI.state.outletCat === c ? 'active' : ''}" data-c="${c}">${c}</button>`).join('')}</div>
          <span class="faint" id="olCount" style="margin-left:auto;font-size:12px"></span>
        </div>
        <div style="flex:1;overflow:auto;margin:0 -20px;padding:0 20px 20px"><table class="t" id="olTable"><thead><tr>${COLS.map((c) => `<th class="sortable ${c.r ? 'r' : ''}" data-k="${c.k}">${c.l}${UI.state.sort.key === c.k ? (UI.state.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
      </div>`;
    bindClose(ov);
    $('#olQ').oninput = (e) => { UI.state.outletQuery = e.target.value; updateOutletsTable(); };
    $$('#olCat .chip').forEach((b) => { b.onclick = () => { UI.state.outletCat = b.dataset.c; $$('#olCat .chip').forEach((x) => x.classList.toggle('active', x === b)); updateOutletsTable(); }; });
    $$('#olTable th').forEach((th) => { th.onclick = () => { const s = UI.state.sort; if (s.key === th.dataset.k) s.dir *= -1; else { s.key = th.dataset.k; s.dir = 1; } renderOutletsView(ov); }; });
    updateOutletsTable();
  }
  function updateOutletsTable() {
    const tb = $('#olTable tbody');
    if (!tb) return;
    const q = UI.state.outletQuery.toLowerCase();
    const col = COLS.find((c) => c.k === UI.state.sort.key);
    const rows = outlets.filter((o) => (UI.state.outletCat === 'All' || o.category === UI.state.outletCat) && (!q || (o.name + o.id + o.locality + o.dealer.name + o.road).toLowerCase().includes(q)))
      .sort((a, b) => { const x = col.v(a), y = col.v(b); return (x > y ? 1 : x < y ? -1 : 0) * UI.state.sort.dir; });
    $('#olCount').textContent = `${rows.length} shown`;
    tb.innerHTML = rows.map((o) => {
      const m = o.m, days = Math.floor((Date.now() - o.compliance.lastInspection) / 86400000);
      return `<tr class="row" data-outlet="${o.id}"><td class="l">${o.name}<span class="sub-id">${o.locality}</span></td><td><span class="status ${m.status}">${ST_TXT[m.status]}</span></td><td>${o.category}</td>
        <td class="r">${fmt.kl(m.todayL / 1000)} kL</td><td class="r ${achCls(m.ach)}">${fmt.pct(m.ach)}</td><td class="r ${coverCls(m.minDays)}">${fmt.kl(m.minDays)} days</td>
        <td class="r"><div class="minibar" style="justify-content:flex-end"><div class="b"><i style="width:${m.score}%;background:${ST_HEX[m.status]}"></i></div><span style="width:22px">${m.score}</span></div></td>
        <td class="r ${days > 45 ? 'c-warn' : ''}">${days} days ago</td></tr>`;
    }).join('');
  }

  // ---------- Supply & trucks ----------
  function renderLogistics(ov) {
    ov.innerHTML = head('Supply & trucks', 'Where every tank truck is, and which outlets need fuel next') + `
      <div class="ov-body"><div id="lgSum"></div>
        <div class="block-title">Tank trucks</div>
        <table class="t"><thead><tr><th>Truck</th><th>Going to</th><th>Carrying</th><th>Status</th><th>Progress</th><th class="r">Arrives in</th><th></th></tr></thead><tbody id="lgTk"></tbody></table>
        <div class="block-title">Outlets running lowest on fuel</div>
        <table class="t"><thead><tr><th>Outlet</th><th>Fuel</th><th class="r">Stock left</th><th>Delivery</th><th></th></tr></thead><tbody id="lgWatch"></tbody></table>
        <div class="block-title">Supply points</div>
        <div class="grid-2" style="grid-template-columns:1fr 1fr">${depots.map((d) => `<div class="card"><div class="card-title">${d.name}</div><div class="card-sub">Storage ${(d.capacityKL / 1000).toFixed(0)},000 kL</div><div class="kv" style="grid-template-columns:120px 1fr"><span>Trucks assigned</span><div>${tankers.filter((t) => t.depotId === d.id).length}</div><span>Loading bays</span><div><span class="status ok">Operational</span></div><span>Average loading</span><div>38 min</div></div></div>`).join('')}</div>
      </div>`;
    bindClose(ov);
    updateLogistics();
  }
  function updateLogistics() {
    if (!$('#lgTk')) return;
    const s = areaStats();
    const delivered = outlets.reduce((a, o) => a + o.indents.filter((i) => new Date(i.date).toDateString() === new Date().toDateString()).length, 0);
    $('#lgSum').innerHTML = summaryRow([['On the road', s.transit], ['Loading', s.loading], ['Unloading', s.unloading], ['Returning', s.returning], ['Stopped off route', s.halted, s.halted ? 'c-crit' : ''], ['Delivered today', delivered]]);
    const order = { Halted: 0, 'In transit': 1, Unloading: 2, Loading: 3, Returning: 4 };
    $('#lgTk').innerHTML = tankers.slice().sort((a, b) => order[a.status] - order[b.status]).map((t) => {
      const o = DB.byId(t.outletId), eta = Sim.etaMin(t), halted = t.status === 'Halted';
      return `<tr class="row" data-tanker="${t.id}"><td class="l">${t.plate}<span class="sub-id">${t.transporter}</span></td><td class="l">${o.name}<span class="sub-id">from ${DB.depotById(t.depotId).name}</span></td>
        <td>${t.comps.map((c) => `${c.kl} kL ${pname(c.product).toLowerCase()}`).join(', ')}</td>
        <td><span class="status ${halted ? 'crit' : t.status === 'In transit' ? 'acc' : t.status === 'Returning' ? 'off' : 'warn'}">${halted ? 'Stopped' : t.status}</span></td>
        <td><div class="minibar"><div class="b"><i style="width:${t.progress * 100}%;background:${halted ? 'var(--crit)' : 'var(--text-2)'}"></i></div>${Math.round(t.progress * 100)}%</div></td>
        <td class="r">${t.status === 'In transit' || t.status === 'Loading' ? eta + ' min' : halted ? `<span class="c-crit">${Math.round(t.haltSec / 60)} min stopped</span>` : '—'}</td>
        <td class="r">${halted ? `<button class="btn sm primary" data-call="${t.id}">Contact driver</button>` : ''}</td></tr>`;
    }).join('');
    $$('[data-call]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); doAction('driver', b.dataset.call); }; });
    const watch = outlets.filter((o) => o.raOnline).slice().sort((a, b) => a.m.minDays - b.m.minDays).slice(0, 8);
    $('#lgWatch').innerHTML = watch.map((o) => {
      const t = o.m.tanker, p = o.m.minP;
      return `<tr class="row" data-outlet="${o.id}" data-tab="supply"><td class="l">${o.name}<span class="sub-id">${o.locality}</span></td><td>${pname(p)}</td><td class="r ${coverCls(o.m.minDays)}">${fmt.kl(o.m.minDays)} days</td>
        <td>${t ? `${t.plate} · ${t.status.toLowerCase()}${Sim.etaMin(t) && t.status !== 'Halted' ? `, ${Sim.etaMin(t)} min` : ''}` : o.pendingIndent ? '<span class="c-crit">Order on hold</span>' : '<span class="faint">Not scheduled</span>'}</td>
        <td class="r">${!t && o.m.minDays < 2 ? `<button class="btn sm primary" data-disp="${o.id}">Send a truck</button>` : ''}</td></tr>`;
    }).join('');
    $$('[data-disp]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); doAction('dispatch', b.dataset.disp); setTimeout(updateLogistics, 80); }; });
  }

  // ---------- Cameras wall ----------
  function renderSurveillance(ov) {
    const total = outlets.reduce((a, o) => a + o.cameras.length, 0);
    const on = outlets.reduce((a, o) => a + o.cameras.filter((c) => c.online).length, 0);
    ov.innerHTML = head('Cameras', `${on} of ${total} cameras online across ${outlets.length} outlets`,
      `<select class="input" id="svOutlet"><option value="All">Outlets needing attention</option>${outlets.map((o) => `<option value="${o.id}" ${UI.state.survOutlet === o.id ? 'selected' : ''}>${o.name}</option>`).join('')}</select><button class="btn ghost" id="svAI">${UI.state.ai ? 'Hide' : 'Show'} detections</button>`) + `
      <div class="ov-body"><div class="surv-wrap"><div class="surv-grid" id="svGrid"></div><div class="surv-side"><div class="sh"><h4>Detections</h4><span class="aside">AI vision</span></div><div id="svEv"></div></div></div></div>`;
    bindClose(ov);
    $('#svOutlet').onchange = (e) => { UI.state.survOutlet = e.target.value; renderSurveillance(ov); };
    $('#svAI').onclick = () => { UI.state.ai = !UI.state.ai; CCTV.setAI(UI.state.ai); renderSurveillance(ov); };
    let cams;
    if (UI.state.survOutlet === 'All') cams = outlets.slice().sort((a, b) => a.m.score - b.m.score).slice(0, 9).map((o, i) => ({ o, c: o.cameras[i % o.cameras.length] }));
    else { const o = DB.byId(UI.state.survOutlet); cams = o.cameras.map((c) => ({ o, c })); }
    $('#svGrid').style.gridTemplateColumns = cams.length <= 4 ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)';
    $('#svGrid').innerHTML = cams.map((x, i) => `<div><div class="cam" data-i="${i}"><canvas></canvas></div><div class="cam-cap"><span>${x.o.name} · ${x.c.label}</span><span class="status ${x.c.online ? 'ok' : 'crit'}">${x.c.online ? 'Live' : 'Offline'}</span></div></div>`).join('');
    $$('#svGrid .cam').forEach((el) => {
      const { o, c } = cams[+el.dataset.i];
      CCTV.attach($('canvas', el), { scene: c.scene, seed: c.seed, label: c.label, sub: o.name, online: c.online, ai: UI.state.ai });
      el.onclick = () => openCamModal(o, c);
    });
    updateSurvEvents();
  }
  function updateSurvEvents() {
    const el = $('#svEv');
    if (!el) return;
    el.innerHTML = Sim.aiEvents.slice(0, 25).map((e) => { const o = DB.byId(e.outletId); return `<div class="ev" data-outlet="${o.id}" data-tab="cameras"><span class="tag">${tagName(e.tag)}</span><span class="ev-t">${e.text}</span><small>${o.name} · ${fmt.ago(e.ts)}</small></div>`; }).join('');
  }

  // ---------- Compliance ----------
  function renderComplianceView(ov) {
    const items = outlets.flatMap((o) => o.m.lic.map((l) => ({ o, l }))).filter((x) => x.l.days <= 120).sort((a, b) => a.l.days - b.l.days);
    const irr = outlets.flatMap((o) => o.compliance.irregularities.filter((i) => i.status === 'Open').map((i) => ({ o, i })));
    const insp = outlets.slice().sort((a, b) => a.compliance.lastInspection - b.compliance.lastInspection);
    const overdue = insp.filter((o) => Date.now() - o.compliance.lastInspection > 45 * 86400000).length;
    ov.innerHTML = head('Compliance', 'Licence renewals, open findings and your inspection plan') + `
      <div class="ov-body">
        ${summaryRow([['Due this week', items.filter((x) => x.l.days <= 7).length, 'c-crit'], ['Due this month', items.filter((x) => x.l.days <= 30).length, 'c-warn'], ['Open findings', irr.length], ['Not visited in 45+ days', overdue], ['Visits planned', UI.state.planned.size]])}
        <div class="block-title">Upcoming renewals</div>
        <table class="t"><thead><tr><th>Outlet</th><th>Item</th><th>Due</th><th class="r">Time left</th><th></th></tr></thead><tbody>${items.slice(0, 15).map((x) => `<tr class="row" data-outlet="${x.o.id}" data-tab="compliance"><td class="l">${x.o.name}</td><td>${x.l.label}</td><td>${fmt.date(x.l.due)}</td><td class="r"><span class="tag ${daysTag(x.l.days)}">${x.l.days} days</span></td><td class="r"><span class="text-btn" data-remind="${x.o.id}">Remind dealer</span></td></tr>`).join('')}</tbody></table>
        ${irr.length ? `<div class="block-title">Open findings</div><table class="t"><tbody>${irr.map((x) => `<tr class="row" data-outlet="${x.o.id}" data-tab="compliance"><td class="l">${x.o.name}</td><td>${x.i.text}</td><td class="r">${fmt.date(x.i.date)}</td></tr>`).join('')}</tbody></table>` : ''}
        <div class="block-title">Inspection plan: longest since last visit</div>
        <table class="t"><thead><tr><th>Outlet</th><th>Place</th><th>Last visit</th><th class="r">Days since</th><th>Result</th><th></th></tr></thead><tbody>${insp.slice(0, 12).map((o) => { const d = Math.floor((Date.now() - o.compliance.lastInspection) / 86400000); return `<tr class="row" data-outlet="${o.id}" data-tab="compliance"><td class="l">${o.name}</td><td>${o.locality}</td><td>${fmt.date(o.compliance.lastInspection)}</td><td class="r ${d > 45 ? 'c-warn' : ''}">${d}</td><td>${o.compliance.inspections[0].result}</td><td class="r">${UI.state.planned.has(o.id) ? '<span class="tag ok">Scheduled</span>' : `<button class="btn sm" data-plan="${o.id}">Schedule</button>`}</td></tr>`; }).join('')}</tbody></table>
      </div>`;
    bindClose(ov);
    $$('[data-remind]', ov).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); toast('Reminder sent', `${DB.byId(b.dataset.remind).dealer.name} by SMS and WhatsApp`, 'ok'); }; });
    $$('[data-plan]', ov).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); UI.state.planned.add(b.dataset.plan); toast('Visit scheduled', DB.byId(b.dataset.plan).name, 'ok'); renderComplianceView(ov); }; });
  }

  // ---------- Performance ----------
  function renderAnalytics(ov) {
    const s = areaStats();
    const n = outlets[0].hist.length;
    const daily = Array.from({ length: n }, (_, i) => outlets.reduce((a, o) => a + o.hist[i].total, 0));
    const tgt = outlets.reduce((a, o) => a + o.targetMonth / 30, 0);
    const labels = outlets[0].hist.map((h) => +h.date.slice(8) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+h.date.slice(5, 7) - 1]);
    const mix = ['MS', 'HSD', 'XP'].map((p) => ({ label: pname(p), value: outlets.reduce((a, o) => a + o.hist.reduce((b, h) => b + (h[p] || 0), 0), 0), color: PRODUCTS[p].color }));
    const ours = outlets.reduce((a, o) => a + o.daily, 0);
    const brands = ['Brand B', 'Brand C', 'Private P'].map((b, i) => ({ label: b, value: competitors.filter((c) => c.brand === b).reduce((a, c) => a + c.estDaily, 0), color: ['#b48ead', '#d08770', '#5c6168'][i] }));
    const share = ours / (ours + brands.reduce((a, b) => a + b.value, 0));
    const cats = ['Highway', 'Urban', 'Rural'].map((c) => { const os = outlets.filter((o) => o.category === c); return { label: c, value: os.reduce((a, o) => a + o.m.mtdKL, 0) / os.reduce((a, o) => a + o.m.mtdTarget, 0) * 100, color: '#7aa7ff' }; });
    const bottom = outlets.slice().sort((a, b) => a.m.ach - b.m.ach).slice(0, 10);
    ov.innerHTML = head('Performance', 'Sales, targets and market position over the last 30 days') + `
      <div class="ov-body">
        ${summaryRow([['Sold this month', fmt.kl(s.mtd, 0) + ' kL'], ['Against target', fmt.pct(s.ach), achCls(s.ach)], ['Average per day', fmt.kl(daily.reduce((a, b) => a + b, 0) / n, 0) + ' kL'], ['Market share (est.)', fmt.pct(share)], ['Outlets behind target', outlets.filter((o) => o.m.ach < 0.85).length]])}
        <div class="grid-2">
          <div class="card"><div class="card-title">Daily sales across the area</div><div class="card-sub">kL per day against the daily target</div><canvas class="chart tall" id="anDaily"></canvas></div>
          <div class="card"><div class="card-title">Furthest behind target</div><div class="card-sub">This month, % of target (marker at 100%)</div><canvas class="chart tall" id="anBottom"></canvas></div>
        </div>
        <div class="grid-3 mt">
          <div class="card"><div class="card-title">Sales by fuel</div><div class="card-sub">Last 30 days</div><canvas class="chart" id="anMix"></canvas></div>
          <div class="card"><div class="card-title">Market share</div><div class="card-sub">Estimated, against competitor outlets</div><canvas class="chart" id="anShare"></canvas></div>
          <div class="card"><div class="card-title">By outlet type</div><div class="card-sub">This month, % of target</div><canvas class="chart" id="anCat"></canvas></div>
        </div>
      </div>`;
    bindClose(ov);
    requestAnimationFrame(() => {
      Charts.line($('#anDaily'), { labels, series: [{ data: daily, color: '#7aa7ff', label: 'Sold', fill: true }, { data: daily.map(() => tgt), color: '#6e737a', label: 'Target', dash: [3, 4], width: 1.2 }], yFmt: (v) => v.toFixed(0) });
      Charts.bars($('#anBottom'), { horizontal: true, labelWidth: 170, max: 120, items: bottom.map((o) => ({ label: o.name, value: o.m.ach * 100, target: 100, color: o.m.ach < 0.85 ? '#e5604f' : o.m.ach < 0.95 ? '#e0a645' : '#57b583' })), fmt: (v) => v.toFixed(0) + '%' });
      const tot = mix.reduce((a, b) => a + b.value, 0);
      Charts.donut($('#anMix'), { items: mix, center: (tot / 1000).toFixed(1) + 'k', centerSub: 'kL' });
      Charts.donut($('#anShare'), { items: [{ label: 'Our outlets', value: ours, color: '#7aa7ff' }].concat(brands), center: fmt.pct(share), centerSub: 'ours' });
      Charts.bars($('#anCat'), { items: cats, max: 120, yFmt: (v) => v.toFixed(0) + '%' });
    });
  }

  // ---------- Assistant ----------
  function renderCopilot(ov) {
    ov.innerHTML = head('Assistant', 'Ask about your area in plain language') + `
      <div class="cp-msgs" id="cpMsgs"></div>
      <div class="cp-sugg" id="cpSugg">${['Summarise my area', 'Which outlets may run dry?', 'Who is behind target?', 'Where are my trucks?', 'What renewals are due?', 'Any security issues?'].map((s) => `<button class="chip">${s}</button>`).join('')}</div>
      <div class="cp-input"><input class="input" id="cpIn" placeholder="Ask a question, e.g. how is ${outlets[5].name} doing?"><button class="btn primary" id="cpGo">${I.send}</button></div>`;
    bindClose(ov);
    if (!UI.state.cpMsgs.length) UI.state.cpMsgs.push({ who: 'bot', html: 'Good ' + (DB.util.istNow().getHours() < 12 ? 'morning' : DB.util.istNow().getHours() < 17 ? 'afternoon' : 'evening') + '. ' + answer('summary') });
    drawMsgs();
    const ask = (q) => {
      if (!q.trim()) return;
      UI.state.cpMsgs.push({ who: 'user', html: q.replace(/</g, '&lt;') });
      UI.state.cpMsgs.push({ who: 'bot', typing: true });
      drawMsgs();
      setTimeout(() => { UI.state.cpMsgs.pop(); UI.state.cpMsgs.push({ who: 'bot', html: answer(q) }); drawMsgs(); }, 600 + Math.random() * 500);
    };
    $$('#cpSugg .chip').forEach((b) => { b.onclick = () => ask(b.textContent); });
    $('#cpGo').onclick = () => { ask($('#cpIn').value); $('#cpIn').value = ''; };
    $('#cpIn').onkeydown = (e) => { if (e.key === 'Enter') { ask(e.target.value); e.target.value = ''; } };
    setTimeout(() => $('#cpIn') && $('#cpIn').focus(), 100);
  }
  function drawMsgs() {
    const el = $('#cpMsgs');
    if (!el) return;
    el.innerHTML = UI.state.cpMsgs.map((m) => m.typing ? '<div class="msg bot typing"><span></span><span></span><span></span></div>' : `<div class="msg ${m.who}">${m.html}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }
  function answer(q) {
    const s = areaStats(), ql = q.toLowerCase();
    const named = outlets.find((o) => ql.includes(o.name.toLowerCase()) || ql.includes(o.id.toLowerCase()));
    if (named) {
      const o = named, m = o.m, sm = summary(o);
      return `${oLink(o)} in ${o.locality}: ${sm.t}
        <ul><li>Sold <b>${fmt.kl(m.todayL / 1000)} kL</b> today and is at <b>${fmt.pct(m.ach)}</b> of this month's target.</li>
        <li>Lowest stock is ${pname(m.minP).toLowerCase()} with <b>${fmt.kl(m.minDays)} days</b> left${m.tanker ? `; truck ${m.tanker.plate} is ${m.tanker.status.toLowerCase()}` : ''}.</li>
        <li>Health score ${m.score}/100. Dealer ${o.dealer.name}${o.credit.overdueDays ? `, payment ${o.credit.overdueDays} days overdue` : ''}.</li></ul>`;
    }
    if (ql === 'summary' || /summar|brief|overview|right now|today|status|how are/.test(ql)) {
      const items = attentionItems().slice(0, 3);
      return `Here's where things stand at ${fmt.hm(Date.now())}:
        <ul><li><b>${fmt.kl(s.todayKL, 0)} kL</b> sold today, ${fmt.pct(s.todayKL / s.expectedKL)} of plan so far. The month is at <b>${fmt.pct(s.ach)}</b> of target.</li>
        <li><b>${s.ok}</b> of ${s.n} outlets are running normally; ${s.crit} urgent, ${s.warn} need attention${s.off ? `, ${s.off} offline` : ''}.</li>
        <li><b>${s.transit}</b> trucks on the road${s.halted ? `, <span class="c-crit">${s.halted} stopped off route</span>` : ''}.</li></ul>
        ${items.length ? 'The most important things right now: ' + items.map((a) => a.key.startsWith('halt:') ? `<span class="link" data-tanker="${a.tankerId}">truck ${DB.tankerById(a.tankerId).plate}</span>` : oLink(DB.byId(a.outletId))).join(', ') + '.' : ''}`;
    }
    if (/dry|run out|stock|replenish|fuel left/.test(ql)) {
      const list = outlets.filter((o) => o.m.minDays < 2.5 && o.raOnline).sort((a, b) => a.m.minDays - b.m.minDays);
      if (!list.length) return 'No outlet has less than 2.5 days of fuel left.';
      return `${list.length} outlet${list.length > 1 ? 's have' : ' has'} less than 2.5 days of fuel left:<ul>${list.slice(0, 6).map((o) => `<li>${oLink(o)}: ${pname(o.m.minP).toLowerCase()}, <b>${fmt.kl(o.m.minDays)} days</b>. ${o.m.tanker ? `Truck ${o.m.tanker.plate} is ${o.m.tanker.status.toLowerCase()}.` : o.pendingIndent ? '<span class="c-crit">Order on hold for payment.</span>' : 'Nothing scheduled yet.'}</li>`).join('')}</ul>`;
    }
    if (/target|behind|achiev|perform|worst|best/.test(ql)) {
      const sorted = outlets.slice().sort((a, b) => a.m.ach - b.m.ach);
      return `The area is at <b>${fmt.pct(s.ach)}</b> of this month's target. Furthest behind:<ul>${sorted.slice(0, 5).map((o) => `<li>${oLink(o)}: <b>${fmt.pct(o.m.ach)}</b>${o.m.trend < -0.1 ? `, sales down ${Math.round(-o.m.trend * 100)}% on last week` : ''}</li>`).join('')}</ul>Doing best: ${sorted.slice(-3).reverse().map((o) => `${oLink(o)} (${fmt.pct(o.m.ach)})`).join(', ')}.`;
    }
    if (/tanker|truck|deliver|logist|supply/.test(ql)) {
      const halted = tankers.filter((t) => t.status === 'Halted');
      const moving = tankers.filter((t) => t.status === 'In transit').sort((a, b) => Sim.etaMin(a) - Sim.etaMin(b));
      return `${s.transit} trucks are on the road, ${s.loading} loading and ${s.unloading} unloading.${halted.length ? ` <span class="c-crit">${halted.map((t) => `<span class="link" data-tanker="${t.id}">${t.plate}</span> has stopped off route for ${Math.round(t.haltSec / 60)} min`).join('; ')}.</span>` : ''} Next arrivals:<ul>${moving.slice(0, 4).map((t) => `<li><span class="link" data-tanker="${t.id}">${t.plate}</span> to ${oLink(DB.byId(t.outletId))} in <b>${Sim.etaMin(t)} min</b></li>`).join('')}</ul>`;
    }
    if (/complian|licen|stamp|renew|noc|inspect|due/.test(ql)) {
      const items = outlets.flatMap((o) => o.m.lic.filter((l) => l.days <= 30).map((l) => ({ o, l }))).sort((a, b) => a.l.days - b.l.days);
      return `${items.length} renewal${items.length === 1 ? '' : 's'} due in the next 30 days:<ul>${items.slice(0, 6).map((x) => `<li>${x.l.label} at ${oLink(x.o)} in <b>${x.l.days} days</b></li>`).join('')}</ul>`;
    }
    if (/secur|cctv|camera|theft/.test(ql)) {
      const off = outlets.filter((o) => o.m.camsOff);
      const halted = tankers.filter((t) => t.status === 'Halted');
      return `<ul>${halted.length ? `<li><span class="c-crit">${halted.length} truck stopped off route</span>: ${halted.map((t) => `<span class="link" data-tanker="${t.id}">${t.plate}</span>`).join(', ')}. This is the classic sign of fuel theft, so check it first.</li>` : ''}<li>Cameras offline at ${off.slice(0, 4).map((o) => oLink(o)).join(', ') || 'no outlets'}.</li><li>Latest detection: ${Sim.aiEvents[0].text.toLowerCase()} at ${oLink(DB.byId(Sim.aiEvents[0].outletId))}.</li></ul>`;
    }
    if (/compet|market|share|rival/.test(ql)) {
      const d = DB.stories.decline;
      return `Our estimated share of fuel sold in the area is <b>${fmt.pct(outlets.reduce((a, o) => a + o.daily, 0) / (outlets.reduce((a, o) => a + o.daily, 0) + competitors.reduce((a, c) => a + c.estDaily, 0)))}</b>. The clearest impact is at ${oLink(d)}, where sales are down ${Math.round(-d.m.trend * 100)}% since a new competitor opened nearby. Turn on <b>Competitor outlets</b> under Layers to see it.`;
    }
    return 'I can help with a summary of the area, outlets that may run dry, targets, trucks, renewals, security, or any outlet by name.';
  }

  // ===================================================================
  // Search, modal, toasts, tooltip
  // ===================================================================
  let palSel = 0, palItems = [];
  function openPalette() {
    $('#palette').classList.remove('hidden');
    $('#palInput').value = '';
    palSel = 0; searchPal('');
    $('#palInput').focus();
    $('#palInput').oninput = (e) => { palSel = 0; searchPal(e.target.value); };
    $('#palInput').onkeydown = (e) => {
      if (e.key === 'ArrowDown') { palSel = Math.min(palItems.length - 1, palSel + 1); drawPal(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); drawPal(); e.preventDefault(); }
      if (e.key === 'Enter' && palItems[palSel]) palItems[palSel].go();
    };
  }
  function closePalette() { $('#palette').classList.add('hidden'); }
  function searchPal(q) {
    q = q.toLowerCase().trim();
    const all = [];
    [['ops', 'Map'], ['outlets', 'Outlets'], ['logistics', 'Supply & trucks'], ['surveillance', 'Cameras'], ['compliance', 'Compliance'], ['analytics', 'Performance'], ['copilot', 'Assistant']].forEach(([v, n]) => all.push({ g: 'Go to', t: n, s: '', hay: n.toLowerCase(), go: () => { closePalette(); UI.setView(v); } }));
    outlets.forEach((o) => all.push({ g: 'Outlets', t: o.name, s: o.locality, hay: (o.name + ' ' + o.id + ' ' + o.locality + ' ' + o.dealer.name + ' ' + o.road).toLowerCase(), go: () => UI.selectOutlet(o.id) }));
    tankers.forEach((t) => all.push({ g: 'Trucks', t: t.plate, s: `${t.status} · ${DB.byId(t.outletId).name}`, hay: (t.plate + ' ' + t.transporter + ' ' + t.driver).toLowerCase(), go: () => UI.selectTanker(t.id) }));
    depots.forEach((d) => all.push({ g: 'Supply points', t: d.name, s: '', hay: d.name.toLowerCase(), go: () => { closePalette(); MapView.map.flyTo({ center: [d.lng, d.lat], zoom: 13.5, duration: 1800 }); } }));
    palItems = (q ? all.filter((x) => x.hay.includes(q)) : all.filter((x) => x.g === 'Go to').concat(all.filter((x) => x.g === 'Outlets').slice(0, 6))).slice(0, 40);
    drawPal();
  }
  function drawPal() {
    let lastG = '';
    $('#palResults').innerHTML = palItems.length ? palItems.map((x, i) => { const g = x.g !== lastG ? `<div class="pal-group">${x.g}</div>` : ''; lastG = x.g; return `${g}<div class="pal-item ${i === palSel ? 'active' : ''}" data-i="${i}"><span>${x.t}</span><small>${x.s}</small></div>`; }).join('') : '<div class="empty">No matches</div>';
    $$('#palResults .pal-item').forEach((el) => { el.onclick = () => palItems[+el.dataset.i].go(); });
    const a = $('#palResults .active'); if (a) a.scrollIntoView({ block: 'nearest' });
  }
  function openModal(html) { $('#modal .modal-box').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal .modal-box').innerHTML = ''; }

  function toast(msg, sub, kind) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${kind === 'ok' ? '<span class="dot ok"></span>' : ''}<div>${msg}${sub ? `<small>${sub}</small>` : ''}</div>`;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3400);
  }
  UI.toast = toast;
  UI.tooltip = function (e, html) {
    const tt = $('#tooltip');
    if (!e) { tt.style.display = 'none'; return; }
    tt.innerHTML = html;
    tt.style.display = 'block';
    tt.style.left = Math.min(window.innerWidth - tt.offsetWidth - 10, e.clientX + 14) + 'px';
    tt.style.top = Math.min(window.innerHeight - tt.offsetHeight - 10, e.clientY + 14) + 'px';
  };

  window.UI = UI;
})();
