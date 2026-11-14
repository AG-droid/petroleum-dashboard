/* =====================================================================
   PRAHARI POC — interface: panels, views, outlet 360, copilot, search
   ===================================================================== */
(function () {
  'use strict';
  const { outlets, tankers, depots, competitors, PRODUCTS, HOURLY } = DB;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  const ST_LABEL = { ok: 'Healthy', warn: 'Attention', crit: 'Critical', off: 'Offline' };
  const ST_COLOR = { ok: '#3ddc97', warn: '#f5b942', crit: '#ff4d5e', off: '#7b8794' };

  const fmt = {
    kl: (v, d = 1) => (+v).toFixed(d),
    inr: (v) => '₹' + Math.round(v).toLocaleString('en-IN'),
    lakh: (v) => '₹' + (v / 100000).toFixed(1) + ' L',
    pct: (v) => Math.round(v * 100) + '%',
    time: (ts) => new Date(ts).toLocaleTimeString('en-GB'),
    hm: (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    date: (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    ago(ts) {
      const s = (Date.now() - ts) / 1000;
      if (s < 45) return 'just now';
      if (s < 3600) return Math.round(s / 60) + ' min ago';
      if (s < 86400) return Math.round(s / 3600) + ' h ago';
      return Math.round(s / 86400) + ' d ago';
    },
  };
  const coverCls = (d) => (d < 1 ? 'c-crit' : d < 2 ? 'c-warn' : 'c-ok');
  const achCls = (a) => (a < 0.85 ? 'c-crit' : a < 0.95 ? 'c-warn' : 'c-ok');
  const daysCls = (d) => (d <= 10 ? 'crit' : d <= 30 ? 'warn' : d <= 90 ? 'acc' : 'ok');
  const oLink = (o) => `<span class="link" data-outlet="${o.id}">${o.name}</span>`;

  const UI = {
    state: { view: 'ops', selected: null, tab: 'overview', alertFilter: 'All', planned: new Set(), lastAlertVer: -1, lastEvTs: 0,
      sort: { key: 'score', dir: 1 }, outletQuery: '', outletCat: 'All', survOutlet: 'All', ai: true, cpMsgs: [], headSig: '' },
  };
  UI.fmt = fmt;

  // ===================================================================
  // Init
  // ===================================================================
  UI.init = function () {
    $$('#rail button').forEach((b) => b.addEventListener('click', () => UI.setView(b.dataset.view)));
    $$('[data-basemap]').forEach((b) => b.addEventListener('click', () => { $$('[data-basemap]').forEach((x) => x.classList.toggle('active', x === b)); MapView.setBasemap(b.dataset.basemap); }));
    $$('[data-layer]').forEach((c) => c.addEventListener('change', () => MapView.setLayer(c.dataset.layer, c.checked)));
    $('#btn3d').addEventListener('click', (e) => e.currentTarget.classList.toggle('active', MapView.toggle3D()));
    $('#btnHome').addEventListener('click', () => { UI.closeOutlet(); MapView.home(); });
    $('#searchBtn').addEventListener('click', openPalette);
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
    window.addEventListener('resize', () => { MapView.resize(); });
  };

  function clock() {
    const d = new Date();
    $('#clock').textContent = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-GB') + ' IST';
  }
  function onKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') {
      if (!$('#palette').classList.contains('hidden')) return closePalette();
      if (!$('#modal').classList.contains('hidden')) return closeModal();
      if (UI.state.view !== 'ops') return UI.setView('ops');
      if (UI.state.selected) return UI.closeOutlet();
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
    updateTicker();
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
    const open = Sim.alerts.filter((a) => a.status !== 'resolved');
    s.dry = open.filter((a) => a.key.startsWith('dry:')).length;
    s.low = open.filter((a) => a.key.startsWith('low:')).length;
    s.transit = tankers.filter((t) => t.status === 'In transit').length;
    s.loading = tankers.filter((t) => t.status === 'Loading').length;
    s.unloading = tankers.filter((t) => t.status === 'Unloading').length;
    s.halted = tankers.filter((t) => t.status === 'Halted').length;
    s.returning = tankers.filter((t) => t.status === 'Returning').length;
    s.critAlerts = open.filter((a) => a.sev === 'critical' && a.status === 'open').length;
    return s;
  }
  UI.areaStats = areaStats;

  // ===================================================================
  // Left panel (operations)
  // ===================================================================
  function renderLeft() {
    $('#leftPanel').innerHTML = `
      <div class="p-head">
        <div class="p-kicker">SALES AREA · LIVE OPERATIONAL PICTURE</div>
        <div class="p-title">Gurugram Sales Area</div>
        <div class="p-sub">${outlets.length} retail outlets · ${depots.length} supply points · ${tankers.length} tank trucks</div>
      </div>
      <div class="p-body">
        <div class="sec-title">AREA STATUS</div>
        <div class="kpis" id="kpis"></div>
        <div id="statusbar"></div>
        <div class="sec-title">PRIORITY ACTIONS</div>
        <div class="brief" id="brief"></div>
        <div class="sec-title">ALERTS <span class="count" id="alertCount"></span></div>
        <div class="chips" id="alertChips"></div>
        <div id="alertList"></div>
      </div>`;
    const cats = ['All', 'Critical', 'Supply', 'Stock', 'Quality', 'Security', 'Compliance', 'Equipment', 'Commercial'];
    $('#alertChips').innerHTML = cats.map((c) => `<button class="chip ${c === UI.state.alertFilter ? 'active' : ''}" data-f="${c}">${c}</button>`).join('');
    $$('#alertChips .chip').forEach((b) => b.addEventListener('click', () => {
      UI.state.alertFilter = b.dataset.f; UI.state.lastAlertVer = -1;
      $$('#alertChips .chip').forEach((x) => x.classList.toggle('active', x === b));
      updateLeft();
    }));
    UI.state.lastAlertVer = -1;
    updateLeft();
  }

  function updateLeft() {
    if (!$('#kpis')) return;
    const s = areaStats();
    const pctToday = s.todayKL / Math.max(0.01, s.expectedKL);
    $('#kpis').innerHTML = `
      <div class="kpi"><div class="kpi-label">Today's sales</div><div class="kpi-val">${fmt.kl(s.todayKL)}<small>kL</small></div><div class="kpi-foot"><span class="${achCls(pctToday)}">${fmt.pct(pctToday)}</span> of plan by now</div><div class="bar"><i style="width:${Math.min(100, pctToday * 100)}%"></i></div></div>
      <div class="kpi click" data-goto="analytics"><div class="kpi-label">MTD vs target</div><div class="kpi-val ${achCls(s.ach)}">${fmt.pct(s.ach)}</div><div class="kpi-foot">${fmt.kl(s.mtd, 0)} / ${fmt.kl(s.mtdT, 0)} kL</div><div class="bar"><i style="width:${Math.min(100, s.ach * 100)}%"></i></div></div>
      <div class="kpi click" data-goto="outlets"><div class="kpi-label">Network health</div><div class="kpi-val">${s.ok}<small>/ ${s.n} healthy</small></div><div class="kpi-foot"><span class="c-crit">${s.crit} crit</span> · <span class="c-warn">${s.warn} attn</span> · <span class="c-off">${s.off} offline</span></div></div>
      <div class="kpi click" data-goto="logistics"><div class="kpi-label">Dry-out risks</div><div class="kpi-val ${s.dry ? 'c-crit' : 'c-ok'}">${s.dry}</div><div class="kpi-foot">${s.low} low-stock outlet${s.low === 1 ? '' : 's'} covered by tankers</div></div>
      <div class="kpi click" data-goto="logistics"><div class="kpi-label">Tank trucks</div><div class="kpi-val">${s.transit}<small>moving</small></div><div class="kpi-foot">${s.loading} loading · ${s.unloading} unloading · <span class="${s.halted ? 'c-crit' : ''}">${s.halted} halted</span></div></div>
      <div class="kpi click" data-goto="compliance"><div class="kpi-label">Compliance due ≤30d</div><div class="kpi-val ${s.lic30 ? 'c-warn' : 'c-ok'}">${s.lic30}</div><div class="kpi-foot">licences, stampings, NOCs</div></div>`;
    $$('#kpis [data-goto]').forEach((k) => { k.onclick = () => UI.setView(k.dataset.goto); });
    $('#statusbar').innerHTML = `<div class="statusbar">${['ok', 'warn', 'crit', 'off'].map((k) => `<i style="width:${s[k] / s.n * 100}%;background:${ST_COLOR[k]}"></i>`).join('')}</div>
      <div class="statuslegend"><span>Avg health score <b class="mono">${s.score}</b></span><span class="mono c-mute">${new Date().toLocaleTimeString('en-GB')}</span></div>`;
    if (UI.state.lastAlertVer !== Sim.alertsVersion || Sim.t % 15 === 0) {
      UI.state.lastAlertVer = Sim.alertsVersion;
      renderBrief();
      renderAlerts();
    }
  }

  function renderBrief() {
    const items = [];
    const open = Sim.alerts.filter((a) => a.status === 'open');
    const crit = open.filter((a) => a.sev === 'critical').slice(0, 3);
    crit.forEach((a) => {
      const o = DB.byId(a.outletId);
      if (a.key.startsWith('dry:')) items.push(`<b>Prevent a dry-out</b> at ${oLink(o)} — ${o.m.minDays.toFixed(1)} days of ${PRODUCTS[o.m.minP].name.toLowerCase()} left${o.pendingIndent ? ', indent held for payment' : ''}.`);
      else if (a.key.startsWith('halt:')) items.push(`<b>Verify tank truck</b> <span class="link" data-tanker="${a.tankerId}">${DB.tankerById(a.tankerId).plate}</span> — stopped off-route for ${Math.round(DB.tankerById(a.tankerId).haltSec / 60)} min.`);
      else items.push(`<b>${a.title}</b>`);
    });
    const dens = outlets.find((o) => o.densityDev > 3);
    if (dens && items.length < 4) items.push(`<b>Quality check</b> at ${oLink(dens)} — diesel receipt density off by +${dens.densityDev.toFixed(1)} kg/m³.`);
    const lag = outlets.filter((o) => o.m.ach < 0.85).sort((a, b) => a.m.ach - b.m.ach);
    if (lag.length && items.length < 5) items.push(`<b>${lag.length} outlet${lag.length > 1 ? 's' : ''} below 85% of MTD target</b> — lowest ${oLink(lag[0])} at ${fmt.pct(lag[0].m.ach)}.`);
    const lic = outlets.flatMap((o) => o.m.lic.filter((l) => l.days <= 10).map((l) => ({ o, l })));
    if (lic.length && items.length < 5) items.push(`<b>Renewal due</b> — ${lic[0].l.label} at ${oLink(lic[0].o)} in ${lic[0].l.days} days.`);
    if (!items.length) items.push('No priority actions. Network operating normally.');
    $('#brief').innerHTML = items.slice(0, 5).map((t, i) => `<div class="brief-item"><span class="n">0${i + 1}</span><div>${t}</div></div>`).join('');
  }

  function filteredAlerts() {
    const f = UI.state.alertFilter;
    return Sim.alerts.filter((a) => a.status !== 'resolved')
      .filter((a) => f === 'All' || (f === 'Critical' ? a.sev === 'critical' : a.cat === f))
      .sort((a, b) => (a.status === 'ack') - (b.status === 'ack') || SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.ts - a.ts);
  }
  function alertHTML(a) {
    const o = DB.byId(a.outletId);
    return `<div class="alert ${a.fresh ? 'new' : ''} ${a.status === 'ack' ? 'acked' : ''}" data-alert="${a.id}">
      <div class="sev ${a.sev}"></div>
      <div><div class="alert-title">${a.title}</div><div class="alert-meta"><span class="cat">${a.cat.toUpperCase()}</span><span>${o ? o.id : ''}</span><span>${fmt.ago(a.ts)}</span></div></div>
      <div class="alert-actions">${a.status === 'open' ? `<button class="mini-btn" data-ack="${a.id}">Ack</button>` : '<span class="mini-btn c-mute">Acked</span>'}</div>
    </div>`;
  }
  function bindAlerts(root) {
    $$('[data-ack]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); Sim.actions.ack(b.dataset.ack); toast('Alert acknowledged', 'Assigned to you · logged in audit trail', 'ok'); UI.state.lastAlertVer = -1; updateLeft(); if (UI.state.selected) renderOutletAlerts(); }));
    $$('[data-alert]', root).forEach((el) => el.addEventListener('click', () => {
      const a = Sim.alerts.find((x) => x.id === el.dataset.alert);
      if (!a) return;
      if (a.tankerId && a.key.startsWith('halt:')) UI.selectTanker(a.tankerId);
      else UI.selectOutlet(a.outletId, a.cat === 'Security' && a.key.startsWith('cam:') ? 'cameras' : a.cat === 'Compliance' ? 'compliance' : a.cat === 'Supply' || a.cat === 'Quality' ? 'supply' : 'overview');
    }));
  }
  function renderAlerts() {
    const list = filteredAlerts();
    $('#alertCount').textContent = `${list.length} open`;
    $('#alertList').innerHTML = list.length ? list.slice(0, 60).map(alertHTML).join('') : '<div class="empty">No alerts in this category</div>';
    bindAlerts($('#alertList'));
  }

  // ===================================================================
  // Outlet 360 (right panel)
  // ===================================================================
  UI.selectOutlet = function (id, tab) {
    const o = DB.byId(id);
    if (!o) return;
    closePalette(); closeModal();
    if (UI.state.view !== 'ops') UI.setView('ops', true);
    const same = UI.state.selected === id;
    UI.state.selected = id;
    UI.state.tab = tab || (same ? UI.state.tab : 'overview');
    Sim.focusId = id;
    $('#stage').classList.add('right-open');
    $('#rightPanel').classList.remove('hidden');
    UI.state.headSig = '';
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

  function scoreRing(score, status) {
    const r = 23, c = 2 * Math.PI * r;
    return `<div class="ring"><svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="${r}" fill="none" stroke="rgba(120,160,190,.15)" stroke-width="4"/><circle cx="27" cy="27" r="${r}" fill="none" stroke="${ST_COLOR[status]}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${c * score / 100} ${c}"/></svg><b>${score}</b><small>HEALTH</small></div>`;
  }
  function outletActions(o) {
    const a = [];
    if (Sim.alerts.some((x) => x.key === 'dry:' + o.id)) a.push('<button class="btn danger" data-act="dispatch">⚡ Priority dispatch</button>');
    if (o.densityDev > 3) a.push('<button class="btn danger" data-act="hold">Hold tank &amp; sample</button>');
    if (!o.raOnline) a.push('<button class="btn danger" data-act="ra">Ping automation</button>');
    a.push('<button class="btn primary" data-act="call">☎ Call dealer</button>');
    a.push('<button class="btn" data-act="inspect">Schedule inspection</button>');
    a.push('<button class="btn" data-act="cams">◉ Cameras</button>');
    return a.join('');
  }
  function renderOutletHead(o) {
    const m = o.m;
    const sig = m.status + m.score + outletActions(o);
    if (sig === UI.state.headSig && $('#odHead')) return;
    UI.state.headSig = sig;
    $('#odHead').innerHTML = `
      <button class="od-close" id="odClose" title="Close (Esc)">✕</button>
      <div class="od-top">
        ${scoreRing(m.score, m.status)}
        <div style="min-width:0">
          <div class="od-name">${o.name}</div>
          <div class="od-meta">${o.id} · ${o.type} · ${o.category}${o.ksk ? ' (KSK)' : ''} · ${o.nozzles.length} nozzles<br>${o.locality}, ${o.road}</div>
          <div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap"><span class="pill ${m.status}">${ST_LABEL[m.status]}</span><span class="pill acc">${o.automated ? (o.raOnline ? 'Automated · live' : 'Automation offline') : 'Manual outlet'}</span><span class="pill ok" style="color:var(--text-2);border-color:var(--line-2);background:none">Dealer: ${o.dealer.name}</span></div>
        </div>
      </div>
      <div class="od-actions">${outletActions(o)}</div>
      <div class="tabs">${['overview', 'sales', 'supply', 'cameras', 'compliance', 'dealer'].map((t) => `<button class="tab ${UI.state.tab === t ? 'active' : ''}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>`;
    $('#odClose').onclick = UI.closeOutlet;
    $$('#odHead [data-tab]').forEach((b) => { b.onclick = () => { UI.state.tab = b.dataset.tab; $$('#odHead [data-tab]').forEach((x) => x.classList.toggle('active', x === b)); renderTab(); }; });
    $$('#odHead [data-act]').forEach((b) => { b.onclick = () => outletAction(o, b.dataset.act); });
  }
  function outletAction(o, act) {
    if (act === 'dispatch') { const t = Sim.actions.priorityDispatch(o); toast(`Priority dispatch raised for ${o.name}`, `${t.plate} assigned from ${DB.depotById(t.depotId).name} · dealer notified to clear payment`, 'ok'); }
    if (act === 'hold') { Sim.actions.holdTank(o); toast('Tank held, sample requested', 'Quality Control Cell notified · dealer instructed to stop sales from tank', 'ok'); }
    if (act === 'ra') { toast('Pinging forecourt controller…', 'Attempting link via 4G backup'); setTimeout(() => { Sim.actions.resetRA(o); toast('Automation link restored', o.name, 'ok'); }, 2200); }
    if (act === 'call') toast(`Calling ${o.dealer.name}…`, `${o.dealer.phone} · call will be logged against ${o.id}`);
    if (act === 'inspect') { UI.state.planned.add(o.id); toast('Inspection scheduled', `${o.name} · added to this week's field plan`, 'ok'); }
    if (act === 'cams') { UI.state.tab = 'cameras'; UI.state.headSig = ''; renderOutletHead(o); renderTab(); }
    UI.state.headSig = '';
    setTimeout(() => { if (UI.state.selected === o.id) { renderOutletHead(o); renderTab(); } }, 50);
  }

  function renderOutlet() {
    const o = DB.byId(UI.state.selected);
    $('#rightPanel').innerHTML = '<div class="od-head" id="odHead"></div><div class="p-body" id="odBody"></div>';
    UI.state.headSig = '';
    renderOutletHead(o);
    renderTab();
  }
  function updateOutlet() {
    const o = DB.byId(UI.state.selected);
    if (!o || !$('#odHead')) return;
    renderOutletHead(o);
    if (UI.state.tab === 'overview') updateOverview(o);
    if (UI.state.tab === 'supply' && Sim.t % 2 === 0) updateSupplyLive(o);
  }

  function renderTab() {
    const o = DB.byId(UI.state.selected);
    const body = $('#odBody');
    if (!o || !body) return;
    body.scrollTop = 0;
    const t = UI.state.tab;
    if (t === 'overview') renderOverview(o, body);
    if (t === 'sales') renderSales(o, body);
    if (t === 'supply') renderSupply(o, body);
    if (t === 'cameras') renderCameras(o, body);
    if (t === 'compliance') renderCompliance(o, body);
    if (t === 'dealer') renderDealer(o, body);
  }

  // ---------- Overview ----------
  function tankSVG(t) {
    const pct = Math.max(0, Math.min(1, t.stock / t.cap));
    const fh = 76 * pct, col = PRODUCTS[t.product].color;
    const wh = Math.min(5, t.water / 18 * 5);
    return `<svg viewBox="0 0 30 84"><rect x="1" y="1" width="28" height="82" rx="6" fill="#070b10" stroke="rgba(120,160,190,.35)"/>
      <rect x="4" y="${4 + 76 - fh}" width="22" height="${fh}" rx="3" fill="${col}" opacity=".85"/>
      <rect x="4" y="${80 - wh}" width="22" height="${wh}" fill="#38bdf8" opacity=".9"/>
      ${[0.25, 0.5, 0.75].map((p) => `<line x1="1" x2="7" y1="${4 + 76 * (1 - p)}" y2="${4 + 76 * (1 - p)}" stroke="rgba(255,255,255,.3)"/>`).join('')}</svg>`;
  }
  function renderOverview(o, body) {
    const cam = o.cameras[0];
    body.innerHTML = `
      ${!o.raOnline ? '<div class="brief" style="border-color:rgba(255,77,94,.4);background:rgba(255,77,94,.07);margin-bottom:10px"><div class="brief-item"><span class="n c-crit">!</span><div><b>Automation offline.</b> Figures below are from the last sync at ' + fmt.hm(Sim.raLastSync) + '. Use <b>Ping automation</b> or call the dealer.</div></div></div>' : ''}
      ${o.competitorNote ? '<div class="brief" style="border-color:rgba(245,185,66,.4);background:rgba(245,185,66,.06);margin-bottom:10px"><div class="brief-item"><span class="n c-warn">!</span><div><b>Market signal:</b> ' + o.competitorNote + '</div></div></div>' : ''}
      <div class="sec-title">TODAY · LIVE</div>
      <div class="today" id="ovToday"></div>
      <div class="sec-title">TANKS · ATG</div>
      <div class="tanks" id="ovTanks" style="display:grid;grid-template-columns:1fr 1fr"></div>
      <div class="sec-title">DISPENSERS · NOZZLE STATUS</div>
      <div class="nozzles" id="ovNoz"></div>
      <div class="sec-title">LIVE TRANSACTIONS</div>
      <div id="ovTx"></div>
      <div class="sec-title">CAMERA · ${cam.label.toUpperCase()}</div>
      <div class="cam-preview" id="ovCam"><canvas></canvas></div>
      <div class="sec-title">OPEN ALERTS <span class="count" id="ovAlertCount"></span></div>
      <div id="ovAlerts"></div>`;
    CCTV.attach($('#ovCam canvas'), { scene: cam.scene, seed: cam.seed, label: cam.label, sub: o.name, online: cam.online, ai: UI.state.ai });
    $('#ovCam').onclick = () => openCamModal(o, cam);
    updateOverview(o);
    renderOutletAlerts();
  }
  function renderOutletAlerts() {
    const el = $('#ovAlerts');
    if (!el) return;
    const list = Sim.alerts.filter((a) => a.outletId === UI.state.selected && a.status !== 'resolved').sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
    $('#ovAlertCount').textContent = list.length;
    el.innerHTML = list.length ? list.map(alertHTML).join('') : '<div class="empty">No open alerts for this outlet</div>';
    bindAlerts(el);
  }
  let lastOutletAlertVer = -1;
  function updateOverview(o) {
    const m = o.m;
    if (!$('#ovToday')) return;
    const pct = m.todayL / Math.max(1, m.expectedL);
    $('#ovToday').innerHTML = `
      <div class="today-row"><div class="today-big">${fmt.kl(m.todayL / 1000, 2)}<small> kL sold today</small></div><div class="mono ${achCls(pct)}">${fmt.pct(pct)} <span class="c-mute" style="font-size:11px">of plan by now</span></div></div>
      <div class="prog"><i style="width:${Math.min(100, pct * 100)}%"></i></div>
      <div class="prod-chips">${Object.keys(o.prod).map((p) => `<div class="prod-chip" style="border-color:${PRODUCTS[p].color}"><span>${PRODUCTS[p].name}</span><b>${fmt.kl(o.today[p] / 1000, 2)} kL</b><span>${fmt.inr(o.today[p] * PRODUCTS[p].price)}</span></div>`).join('')}</div>`;
    $('#ovTanks').innerHTML = o.tanks.map((t) => {
      const d = t.stock / (o.prod[t.product] / o.tanks.filter((x) => x.product === t.product).length);
      return `<div class="tank">${tankSVG(t)}<div class="tank-info"><b>${t.id} · ${PRODUCTS[t.product].code}</b><br>${fmt.kl(t.stock)} / ${t.cap} kL · ${fmt.pct(t.stock / t.cap)}<br><span class="cover ${coverCls(d)}">${fmt.kl(d)} d</span> cover<br>Ullage ${fmt.kl(t.cap - t.stock)} kL<br>Water ${t.water} mm · ${fmt.kl(t.temp)}°C</div></div>`;
    }).join('');
    $('#ovNoz').innerHTML = o.nozzles.map((n) => `<div class="noz ${n.status === 'Dispensing' ? 'disp' : n.status === 'Fault' ? 'fault' : ''}" title="${n.du} · totaliser ${Math.round(n.totalizer).toLocaleString('en-IN')} L"><b>${n.id}</b>${PRODUCTS[n.product].code}<br>${n.status === 'Fault' ? '<span class="c-crit">FAULT</span>' : n.status === 'Dispensing' ? '<span class="c-ok">ACTIVE</span>' : n.last ? fmt.kl(n.last.L) + ' L' : 'idle'}</div>`).join('');
    const tx = o.txns.slice(0, 8);
    $('#ovTx').innerHTML = !o.raOnline ? '<div class="empty">No live feed — automation offline</div>' : tx.length ? `<table class="t"><thead><tr><th>Time</th><th>Nozzle</th><th>Product</th><th class="num">Litres</th><th class="num">Amount</th><th>Mode</th><th>Vehicle</th></tr></thead><tbody>${tx.map((x, i) => `<tr class="${i === 0 && Date.now() - x.ts < 1100 ? 'txn-in' : ''}"><td class="mono">${fmt.time(x.ts)}</td><td>${x.nozzle}</td><td style="color:${PRODUCTS[x.product].color}">${PRODUCTS[x.product].code}</td><td class="num">${fmt.kl(x.L, 2)}</td><td class="num">${fmt.inr(x.amt)}</td><td>${x.mode}</td><td>${x.veh}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Waiting for transactions…</div>';
    if (lastOutletAlertVer !== Sim.alertsVersion) { lastOutletAlertVer = Sim.alertsVersion; renderOutletAlerts(); }
  }

  // ---------- Sales ----------
  function hourly(o) {
    if (!o._hourly) { const rng = DB.util.mulberry32(o.id.length * 977 + o.lat * 1e4); o._hourly = HOURLY.map((w) => o.daily * 1000 * w * (0.85 + rng() * 0.3)); }
    return o._hourly;
  }
  function renderSales(o, body) {
    const m = o.m;
    const near = competitors.filter((c) => DB.util.haversineKm([c.lng, c.lat], [o.lng, o.lat]) < 3);
    const share = o.daily / (o.daily + near.reduce((a, c) => a + c.estDaily, 0));
    body.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="kpi-label">MTD volume</div><div class="kpi-val">${fmt.kl(m.mtdKL, 0)}<small>kL</small></div><div class="kpi-foot">target ${fmt.kl(m.mtdTarget, 0)} kL</div></div>
        <div class="kpi"><div class="kpi-label">MTD achievement</div><div class="kpi-val ${achCls(m.ach)}">${fmt.pct(m.ach)}</div><div class="kpi-foot">month target ${fmt.kl(o.targetMonth, 0)} kL</div></div>
        <div class="kpi"><div class="kpi-label">7-day trend</div><div class="kpi-val ${m.trend < -0.05 ? 'c-crit' : m.trend > 0.02 ? 'c-ok' : ''}">${m.trend >= 0 ? '+' : ''}${(m.trend * 100).toFixed(1)}%</div><div class="kpi-foot">${fmt.kl(m.last7)} vs ${fmt.kl(m.prev7)} kL/day</div></div>
        <div class="kpi"><div class="kpi-label">Est. local share (3 km)</div><div class="kpi-val">${fmt.pct(share)}</div><div class="kpi-foot">${near.length} competitor outlet${near.length === 1 ? '' : 's'} nearby</div></div>
      </div>
      <div class="sec-title">DAILY SALES · LAST 30 DAYS (kL)</div>
      <canvas class="chart" id="chSales"></canvas>
      <div class="sec-title">PRODUCT MIX · 30 DAYS</div>
      <canvas class="chart short" id="chMix"></canvas>
      <div class="sec-title">HOURLY PROFILE · TODAY (LITRES)</div>
      <canvas class="chart short" id="chHour"></canvas>`;
    requestAnimationFrame(() => {
      const labels = o.hist.map((h) => h.date.slice(8) + '/' + h.date.slice(5, 7));
      const series = [{ data: o.hist.map((h) => h.total), color: '#38bdf8', label: 'Actual', fill: true },
        { data: o.hist.map(() => o.targetMonth / 30), color: '#d7e2ea', label: 'Daily target', dash: [4, 4], width: 1.2 }];
      Charts.line($('#chSales'), { labels, series, yFmt: (v) => v.toFixed(0) });
      Charts.bars($('#chMix'), { horizontal: true, labelWidth: 110, items: Object.keys(o.prod).map((p) => ({ label: PRODUCTS[p].name, value: o.hist.reduce((a, h) => a + h[p], 0), color: PRODUCTS[p].color })), fmt: (v) => v.toFixed(0) + ' kL' });
      const hr = new Date().getHours();
      Charts.bars($('#chHour'), { items: hourly(o).map((v, i) => ({ label: String(i).padStart(2, '0'), value: i <= hr ? v : 0, color: i === hr ? '#7dd3fc' : '#38bdf8' })), yFmt: (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) });
    });
  }

  // ---------- Supply ----------
  function deliveryCard(o) {
    const t = o.m.tanker;
    if (t) {
      const eta = Sim.etaMin(t);
      return `<div class="card"><div class="card-title">${t.plate} <span class="pill ${t.status === 'Halted' ? 'crit' : 'acc'}" style="margin-left:6px">${t.status}</span></div>
        <div class="card-sub">${t.transporter} · driver ${t.driver}</div>
        <div class="kv"><span>From</span><div>${DB.depotById(t.depotId).name}</div><span>Load</span><div>${t.comps.map((c) => c.kl + ' kL ' + PRODUCTS[c.product].code).join(' + ')}</div><span>ETA</span><div class="mono">${eta ? eta + ' min' : '—'}</div><span>Invoice / seals</span><div class="mono" style="font-size:11px">${t.invoice} · ${t.seals.join(', ')}</div></div>
        <div class="prog"><i style="width:${t.status === 'Loading' ? 3 : t.progress * 100}%"></i></div>
        <button class="btn" data-tanker="${t.id}">Track on map</button></div>`;
    }
    return `<div class="card" style="border-color:rgba(255,77,94,.35)"><div class="card-title c-crit">No tanker scheduled</div>
      <div class="card-sub">${o.pendingIndent ? `Indent for ${o.pendingIndent.qty} kL ${PRODUCTS[o.pendingIndent.product].code} on hold — ${o.pendingIndent.reason.toLowerCase()}.` : 'Next indent expected from dealer.'}</div>
      ${o.m.minDays < 2 ? '<button class="btn danger" data-act2="dispatch">⚡ Request priority dispatch</button>' : ''}</div>`;
  }
  function renderSupply(o, body) {
    if (!o._var) { const rng = DB.util.mulberry32(o.id.length * 31 + o.lng * 1e3); o._var = Array.from({ length: 7 }, (_, i) => Math.max(0.02, o.variation * (0.7 + rng() * 0.5) * (i === 6 ? 1 : 0.85 + i * 0.03))); o._var[6] = o.variation; }
    body.innerHTML = `
      <div class="sec-title">NEXT DELIVERY</div><div id="supDel">${deliveryCard(o)}</div>
      <div class="sec-title">STOCK COVER BY PRODUCT</div><div id="supCover"></div>
      <div class="sec-title">INDENTS &amp; RECEIPTS</div>
      <table class="t"><thead><tr><th>Date</th><th>Indent</th><th>Product</th><th class="num">kL</th><th class="num">Δ density</th><th class="num">Short</th><th>Status</th></tr></thead>
      <tbody>${o.indents.slice(0, 8).map((i) => `<tr><td>${fmt.date(i.date)}</td><td class="mono">${i.id}</td><td style="color:${PRODUCTS[i.product].color}">${PRODUCTS[i.product].code}</td><td class="num">${i.qty}</td><td class="num ${Math.abs(i.obsDiff) > 3 ? 'c-crit' : ''}">${i.obsDiff >= 0 ? '+' : ''}${i.obsDiff.toFixed(1)}</td><td class="num ${i.shortL ? 'c-warn' : ''}">${i.shortL ? i.shortL + ' L' : '—'}</td><td>${i.status}</td></tr>`).join('')}</tbody></table>
      <div class="sec-title">STOCK VARIATION · LAST 7 DAYS (% OF SALES)</div>
      <canvas class="chart short" id="chVar"></canvas>
      <div class="p-sub">Dashed line = permissible limit used in this demo (0.50%). Real limits come from OMC guidelines.</div>`;
    bindSupply(o);
    updateSupplyLive(o);
    requestAnimationFrame(() => {
      const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.now() - (6 - i) * 86400000); return d.getDate() + '/' + (d.getMonth() + 1); });
      Charts.line($('#chVar'), { labels: days, series: [{ data: o._var, color: o.variation > 0.5 ? '#ff4d5e' : '#38bdf8', label: 'Variation %', fill: true }, { data: days.map(() => 0.5), color: '#f5b942', label: 'Limit', dash: [4, 4], width: 1.2 }], yFmt: (v) => v.toFixed(2) });
    });
  }
  function bindSupply(o) { $$('#supDel [data-act2]').forEach((b) => { b.onclick = () => { outletAction(o, 'dispatch'); setTimeout(() => updateSupplyLive(o, true), 100); }; }); }
  function updateSupplyLive(o, force) {
    if (!$('#supCover')) return;
    $('#supCover').innerHTML = Object.keys(o.prod).map((p) => {
      const c = o.m.cover[p];
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="width:110px;color:${PRODUCTS[p].color}">${PRODUCTS[p].name}</span><div class="prog" style="flex:1;margin:0"><i style="width:${Math.min(100, c.days / 5 * 100)}%;background:${c.days < 1 ? '#ff4d5e' : c.days < 2 ? '#f5b942' : '#3ddc97'}"></i></div><span class="mono ${coverCls(c.days)}" style="width:110px;text-align:right">${fmt.kl(c.days)} d · ${fmt.kl(c.stock)} kL</span></div>`;
    }).join('');
    $('#supDel').innerHTML = deliveryCard(o);
    bindSupply(o);
  }

  // ---------- Cameras ----------
  function renderCameras(o, body) {
    const on = o.cameras.filter((c) => c.online).length;
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span class="pill ${on === o.cameras.length ? 'ok' : 'warn'}">${on}/${o.cameras.length} online</span><span class="p-sub" style="margin:0">Simulated feeds · AI vision overlay</span><span style="flex:1"></span><button class="chip ${UI.state.ai ? 'active' : ''}" id="aiToggle">AI overlay ${UI.state.ai ? 'ON' : 'OFF'}</button></div>
      <div class="cam-grid">${o.cameras.map((c, i) => `<div class="cam" data-cam="${i}"><canvas></canvas></div>`).join('')}</div>
      <div class="sec-title">RECENT AI DETECTIONS</div>
      <div>${(Sim.aiEvents.filter((e) => e.outletId === o.id).slice(0, 6).map((e) => `<div class="ev"><span class="tag">${e.tag}</span><div>${e.text}<small>${fmt.ago(e.ts)}</small></div></div>`).join('')) || '<div class="empty">No detections in the last hour</div>'}</div>`;
    $$('.cam', body).forEach((el) => {
      const c = o.cameras[+el.dataset.cam];
      CCTV.attach($('canvas', el), { scene: c.scene, seed: c.seed, label: c.label, sub: o.name, online: c.online, ai: UI.state.ai });
      el.onclick = () => openCamModal(o, c);
    });
    $('#aiToggle').onclick = () => { UI.state.ai = !UI.state.ai; CCTV.setAI(UI.state.ai); renderCameras(o, body); };
  }
  function openCamModal(o, c) {
    const evs = Sim.aiEvents.filter((e) => e.outletId === o.id).slice(0, 5);
    openModal(`
      <div class="modal-head"><span class="pill ${c.online ? 'ok' : 'crit'}">${c.online ? 'LIVE' : 'OFFLINE'}</span><b>${c.label}</b><span class="c-mute">· ${o.name} (${o.id})</span><span class="grow"></span><button class="btn" id="mSnap">Snapshot</button><button class="btn" id="mTalk">🔊 Talk-down</button><button class="btn" data-outlet="${o.id}">Open outlet</button><button class="od-close" style="position:static" id="mClose">✕</button></div>
      <div class="modal-body" style="display:grid;grid-template-columns:1fr 260px;gap:14px">
        <div class="cam-big"><canvas id="mCam"></canvas></div>
        <div><div class="sec-title" style="margin-top:0">CAMERA</div>
          <div class="kv" style="grid-template-columns:90px 1fr"><span>ID</span><div class="mono">${c.id}</div><span>Stream</span><div>1080p · H.265 · 15 fps</div><span>Analytics</span><div>${c.scene === 'entry' ? 'ANPR, vehicle count' : c.scene === 'decant' ? 'Tanker, PPE, intrusion' : c.scene === 'cash' ? 'Person, cash drawer' : 'Vehicle, queue, staff'}</div><span>Retention</span><div>30 days · NVR on site</div></div>
          <div class="sec-title">AI EVENTS</div>${evs.map((e) => `<div class="ev"><span class="tag">${e.tag}</span><div>${e.text}<small>${fmt.ago(e.ts)}</small></div></div>`).join('') || '<div class="empty">None</div>'}
        </div>
      </div>`);
    requestAnimationFrame(() => CCTV.attach($('#mCam'), { scene: c.scene, seed: c.seed, label: c.label, sub: o.name, online: c.online, ai: UI.state.ai }));
    $('#mClose').onclick = closeModal;
    $('#mSnap').onclick = () => toast('Snapshot saved', `${c.id} · ${fmt.time(Date.now())} · attached to outlet record`, 'ok');
    $('#mTalk').onclick = () => toast('Talk-down speaker activated', `Live audio channel open to ${c.label}`);
  }

  // ---------- Compliance ----------
  function renderCompliance(o, body) {
    const c = o.compliance;
    body.innerHTML = `
      <div class="sec-title">LICENCES &amp; CERTIFICATES</div>
      ${o.m.lic.map((l) => `<div class="lic"><div><b>${l.label}</b><small>Valid till ${fmt.date(l.due)}</small></div><span class="pill ${daysCls(l.days)}">${l.days} days</span></div>`).join('')}
      <div class="sec-title">OPEN IRREGULARITIES</div>
      ${c.irregularities.length ? c.irregularities.map((ir, i) => `<div class="lic"><div><b>${ir.text}</b><small>Raised ${fmt.date(ir.date)}</small></div>${ir.status === 'Open' ? `<button class="btn" data-irr="${i}">Mark closed</button>` : '<span class="pill ok">Closed</span>'}</div>`).join('') : '<div class="empty">None</div>'}
      <div class="sec-title">INSPECTION HISTORY</div>
      <table class="t"><thead><tr><th>Date</th><th>Type</th><th>By</th><th>Result</th></tr></thead><tbody>${c.inspections.map((i) => `<tr><td>${fmt.date(i.date)}</td><td class="l">${i.type}</td><td>${i.by}</td><td class="${i.result === 'Satisfactory' ? 'c-ok' : 'c-warn'}">${i.result}</td></tr>`).join('')}</tbody></table>
      <div class="sec-title">CUSTOMER COMPLAINTS</div>
      ${o.complaints.length ? o.complaints.slice(0, 5).map((x) => `<div class="lic"><div><b>${x.text}</b><small>${fmt.date(x.date)}</small></div><span class="pill ${x.status === 'Open' ? 'warn' : 'ok'}">${x.status}</span></div>`).join('') : '<div class="empty">No complaints in the last 30 days</div>'}
      <div style="margin-top:12px;display:flex;gap:8px"><button class="btn primary" id="cpSched">${UI.state.planned.has(o.id) ? '✓ Inspection scheduled' : 'Schedule inspection'}</button><button class="btn" id="cpRemind">Remind dealer of renewals</button></div>`;
    $$('[data-irr]', body).forEach((b) => { b.onclick = () => { Sim.actions.resolveIrregularity(o, +b.dataset.irr); toast('Irregularity closed', 'Closure note recorded'); renderCompliance(o, body); }; });
    $('#cpSched').onclick = () => { UI.state.planned.add(o.id); toast('Inspection scheduled', o.name, 'ok'); renderCompliance(o, body); };
    $('#cpRemind').onclick = () => toast('Reminder sent to dealer', `${o.dealer.name} via SMS + WhatsApp`, 'ok');
  }

  // ---------- Dealer ----------
  function renderDealer(o, body) {
    const d = o.dealer, cr = o.credit;
    body.innerHTML = `
      <div class="sec-title">DEALER PROFILE</div>
      <div class="kv"><span>Dealer</span><div>${d.name}</div><span>Phone</span><div class="mono">${d.phone}</div><span>Email</span><div>${d.email}</div><span>Dealer since</span><div>${d.since} (${new Date().getFullYear() - d.since} yrs)</div><span>Outlet type</span><div>${o.type} · ${o.category}</div><span>Address</span><div>${o.address}</div></div>
      <div style="display:flex;gap:6px;margin-top:10px"><button class="btn primary" data-dact="call">☎ Call</button><button class="btn" data-dact="wa">WhatsApp</button><button class="btn" data-dact="mail">Email</button></div>
      <div class="sec-title">CREDIT &amp; ACCOUNT</div>
      <div class="kv"><span>Credit limit</span><div class="mono">${fmt.lakh(cr.limit)}</div><span>Outstanding</span><div class="mono">${fmt.lakh(cr.outstanding)} (${fmt.pct(cr.outstanding / cr.limit)})</div><span>Overdue</span><div class="mono ${cr.overdueDays > 30 ? 'c-crit' : cr.overdueDays ? 'c-warn' : 'c-ok'}">${cr.overdueDays ? cr.overdueDays + ' days' : 'None'}</div><span>Pending indent</span><div>${o.pendingIndent ? `${o.pendingIndent.qty} kL ${PRODUCTS[o.pendingIndent.product].code} — ${o.pendingIndent.reason}` : 'None'}</div></div>
      <div class="prog"><i style="width:${cr.outstanding / cr.limit * 100}%"></i></div>
      <div class="sec-title">FIELD NOTES</div>
      <div id="notes">${o.notes.map((n) => `<div class="note"><small>${fmt.date(n.ts)} ${fmt.hm(n.ts)} · Sales Officer</small>${n.text}</div>`).join('') || '<div class="empty">No notes yet</div>'}</div>
      <textarea class="input" id="noteIn" rows="2" placeholder="Add a note from your visit or call…"></textarea>
      <div style="margin-top:6px"><button class="btn primary" id="noteAdd">Add note</button></div>`;
    $$('[data-dact]', body).forEach((b) => { b.onclick = () => toast({ call: `Calling ${d.name}…`, wa: `WhatsApp opened for ${d.name}`, mail: `Email draft to ${d.email}` }[b.dataset.dact], 'Logged against ' + o.id); });
    $('#noteAdd').onclick = () => { const v = $('#noteIn').value.trim(); if (!v) return; o.notes.unshift({ ts: Date.now(), text: v.replace(/</g, '&lt;') }); toast('Note saved', o.name, 'ok'); renderDealer(o, body); };
  }

  // ---------- Tanker panel ----------
  function openTankerPanel(t) {
    UI.state.selected = null; Sim.focusId = null;
    $('#stage').classList.add('right-open');
    const rp = $('#rightPanel');
    rp.classList.remove('hidden');
    const draw = () => {
      const o = DB.byId(t.outletId), eta = Sim.etaMin(t);
      rp.innerHTML = `<div class="od-head" style="padding-bottom:14px"><button class="od-close" id="tkClose">✕</button>
        <div class="p-kicker">TANK TRUCK</div><div class="od-name" style="margin-top:4px">${t.plate}</div>
        <div class="od-meta">${t.transporter} · ${t.cap} kL · driver ${t.driver}</div>
        <div style="margin-top:8px"><span class="pill ${t.status === 'Halted' ? 'crit' : 'acc'}">${t.status}</span></div>
        <div class="od-actions" style="margin-bottom:0">${t.status === 'Halted' ? '<button class="btn danger" id="tkCall">☎ Contact driver &amp; resume</button>' : '<button class="btn primary" id="tkCall">☎ Call driver</button>'}<button class="btn" data-outlet="${o.id}" data-tab="supply">Destination outlet</button></div></div>
        <div class="p-body">
          <div class="kv"><span>Route</span><div>${DB.depotById(t.depotId).name} → ${o.name}</div><span>Distance</span><div class="mono">${fmt.kl(t.route.km)} km</div><span>Progress</span><div class="mono">${Math.round(t.progress * 100)}%</div><span>ETA</span><div class="mono">${eta ? eta + ' min' : '—'}</div><span>Load</span><div>${t.comps.map((c) => c.kl + ' kL ' + PRODUCTS[c.product].code).join(' + ')}</div><span>Invoice</span><div class="mono">${t.invoice}</div><span>Seals</span><div class="mono">${t.seals.join(', ')}</div><span>Dispatched</span><div>${fmt.hm(t.dispatchedAt)}</div>${t.status === 'Halted' ? `<span>Halted for</span><div class="mono c-crit">${Math.round(t.haltSec / 60)} min · off route</div>` : ''}</div>
          <div class="prog" style="margin-top:12px"><i style="width:${t.progress * 100}%"></i></div>
          <div class="sec-title">VTS EVENT LOG</div>
          <div class="note"><small>${fmt.hm(t.dispatchedAt)}</small>Exited ${DB.depotById(t.depotId).name} geofence · seals verified at gantry</div>
          ${t.status === 'Halted' ? `<div class="note" style="border-color:rgba(255,77,94,.4)"><small>${fmt.hm(Date.now() - t.haltSec * 1000)}</small>Deviated from planned route · ignition ON, speed 0 km/h</div>` : `<div class="note"><small>${fmt.hm(Date.now() - 6 * 60000)}</small>On planned route · avg speed 34 km/h</div>`}
        </div>`;
      $('#tkClose').onclick = () => { UI.closeOutlet(); };
      $('#tkCall').onclick = () => { if (t.status === 'Halted') { Sim.actions.contactDriver(t); toast('Driver contacted', `${t.plate} resuming on planned route · incident logged`, 'ok'); draw(); } else toast(`Calling ${t.driver}…`, t.plate); };
    };
    draw();
  }

  // ===================================================================
  // Views (overlays)
  // ===================================================================
  UI.setView = function (v, silent) {
    UI.state.view = v;
    $$('#rail button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    const ov = $('#overlay');
    ov.className = 'overlay';
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
  function head(kicker, title, sub, extra) {
    return `<div class="ov-head"><div class="grow"><div class="p-kicker">${kicker}</div><div class="p-title">${title}</div>${sub ? `<div class="p-sub">${sub}</div>` : ''}</div>${extra || ''}<button class="od-close" style="position:static" data-close>✕</button></div>`;
  }
  function bindClose(ov) { $('[data-close]', ov).onclick = () => UI.setView('ops'); }

  // ---------- Outlets registry ----------
  const COLS = [
    { k: 'status', l: 'Status', v: (o) => ({ crit: 0, off: 1, warn: 2, ok: 3 }[o.m.status]) },
    { k: 'name', l: 'Outlet', v: (o) => o.name },
    { k: 'locality', l: 'Locality', v: (o) => o.locality },
    { k: 'category', l: 'Category', v: (o) => o.category },
    { k: 'today', l: 'Today kL', num: true, v: (o) => o.m.todayL },
    { k: 'ach', l: 'MTD ach.', num: true, v: (o) => o.m.ach },
    { k: 'cover', l: 'Min cover', num: true, v: (o) => o.m.minDays },
    { k: 'score', l: 'Health', num: true, v: (o) => o.m.score },
    { k: 'alerts', l: 'Alerts', num: true, v: (o) => Sim.alerts.filter((a) => a.outletId === o.id && a.status !== 'resolved').length },
    { k: 'cctv', l: 'CCTV', num: true, v: (o) => o.cameras.filter((c) => c.online).length / o.cameras.length },
    { k: 'insp', l: 'Last insp.', num: true, v: (o) => o.compliance.lastInspection },
  ];
  function renderOutletsView(ov) {
    ov.innerHTML = head('REGISTRY', 'Retail outlets', `${outlets.length} outlets in Gurugram Sales Area · click a row to open the outlet`) + `
      <div class="ov-body" style="display:flex;flex-direction:column;padding-bottom:0">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <input class="input" id="olQ" placeholder="Filter by name, code, locality, dealer…" style="width:280px" value="${UI.state.outletQuery}">
          <div class="chips" style="margin:0" id="olCat">${['All', 'Highway', 'Urban', 'Rural'].map((c) => `<button class="chip ${UI.state.outletCat === c ? 'active' : ''}" data-c="${c}">${c}</button>`).join('')}</div>
          <span class="p-sub" id="olCount" style="margin:0 0 0 auto"></span>
        </div>
        <div style="flex:1;overflow:auto;margin:0 -18px;padding:0 18px 18px"><table class="t" id="olTable"><thead><tr>${COLS.map((c) => `<th class="sortable ${c.num ? 'num' : ''}" data-k="${c.k}">${c.l}${UI.state.sort.key === c.k ? (UI.state.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
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
      const m = o.m, al = COLS[8].v(o);
      const daysSince = Math.floor((Date.now() - o.compliance.lastInspection) / 86400000);
      return `<tr class="row" data-outlet="${o.id}"><td><span class="pill ${m.status}">${ST_LABEL[m.status]}</span></td><td class="l"><b style="font-weight:500">${o.name}</b><br><span class="c-mute mono" style="font-size:10.5px">${o.id}</span></td><td>${o.locality}</td><td>${o.category}</td>
        <td class="num">${fmt.kl(m.todayL / 1000, 2)}</td><td class="num ${achCls(m.ach)}">${fmt.pct(m.ach)}</td><td class="num ${coverCls(m.minDays)}">${fmt.kl(m.minDays)} d</td>
        <td class="num"><div class="bar-cell" style="justify-content:flex-end"><div class="b"><i style="width:${m.score}%;background:${ST_COLOR[m.status]}"></i></div>${m.score}</div></td>
        <td class="num ${al ? 'c-warn' : 'c-mute'}">${al}</td><td class="num ${m.camsOff ? 'c-crit' : ''}">${o.cameras.length - m.camsOff}/${o.cameras.length}</td><td class="num ${daysSince > 45 ? 'c-warn' : ''}">${daysSince} d ago</td></tr>`;
    }).join('');
  }

  // ---------- Logistics ----------
  function renderLogistics(ov) {
    ov.innerHTML = head('SUPPLY CHAIN', 'Supply & logistics', 'Terminals, tank trucks in motion and outlets needing replenishment · click a truck to track it') + `
      <div class="ov-body"><div class="tiles" id="lgTiles"></div>
        <div class="sec-title" style="margin-top:0">TANK TRUCKS</div>
        <table class="t"><thead><tr><th>Truck</th><th>Route</th><th>Load</th><th>Status</th><th>Progress</th><th class="num">ETA</th><th></th></tr></thead><tbody id="lgTk"></tbody></table>
        <div class="sec-title">REPLENISHMENT WATCHLIST · LOWEST STOCK COVER</div>
        <table class="t"><thead><tr><th>Outlet</th><th>Product</th><th class="num">Cover</th><th class="num">Stock</th><th>Supply status</th><th></th></tr></thead><tbody id="lgWatch"></tbody></table>
        <div class="sec-title">SUPPLY POINTS</div>
        <div class="grid-2" style="grid-template-columns:1fr 1fr">${depots.map((d) => `<div class="card"><div class="card-title">${d.name}</div><div class="card-sub">${d.id} · storage ${(d.capacityKL / 1000).toFixed(0)}k kL</div><div class="kv" style="grid-template-columns:120px 1fr"><span>Trucks assigned</span><div class="mono">${tankers.filter((t) => t.depotId === d.id).length}</div><span>Gantry status</span><div class="c-ok">Operational</div><span>Avg loading time</span><div class="mono">38 min</div></div></div>`).join('')}</div>
      </div>`;
    bindClose(ov);
    updateLogistics();
  }
  function updateLogistics() {
    if (!$('#lgTk')) return;
    const s = areaStats();
    const deliveredToday = outlets.reduce((a, o) => a + o.indents.filter((i) => new Date(i.date).toDateString() === new Date().toDateString()).length, 0);
    $('#lgTiles').innerHTML = [
      ['In transit', s.transit, ''], ['Loading', s.loading, ''], ['Unloading', s.unloading, ''], ['Returning', s.returning, ''], ['Halted', s.halted, s.halted ? 'c-crit' : 'c-ok'], ['Receipts today', deliveredToday, ''],
    ].map(([l, v, c]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-val ${c}">${v}</div></div>`).join('');
    const order = { Halted: 0, 'In transit': 1, Unloading: 2, Loading: 3, Returning: 4 };
    $('#lgTk').innerHTML = tankers.slice().sort((a, b) => order[a.status] - order[b.status]).map((t) => {
      const o = DB.byId(t.outletId), eta = Sim.etaMin(t);
      return `<tr class="row" data-tanker="${t.id}"><td class="l mono">${t.plate}<br><span class="c-mute" style="font-family:var(--sans);font-size:10.5px">${t.transporter}</span></td><td>${DB.depotById(t.depotId).short} → <span class="c-acc">${o.name.length > 24 ? o.name.slice(0, 23) + '…' : o.name}</span></td>
        <td>${t.comps.map((c) => `<span style="color:${PRODUCTS[c.product].color}">${c.kl} ${PRODUCTS[c.product].code}</span>`).join(' + ')}</td>
        <td><span class="pill ${t.status === 'Halted' ? 'crit' : t.status === 'In transit' ? 'acc' : t.status === 'Returning' ? 'off' : 'warn'}">${t.status}</span></td>
        <td><div class="bar-cell"><div class="b"><i style="width:${t.progress * 100}%;background:${t.status === 'Halted' ? '#ff4d5e' : '#38bdf8'}"></i></div><span class="mono">${Math.round(t.progress * 100)}%</span></div></td>
        <td class="num">${t.status === 'In transit' || t.status === 'Loading' ? eta + ' min' : t.status === 'Halted' ? '<span class="c-crit">' + Math.round(t.haltSec / 60) + ' min halt</span>' : '—'}</td>
        <td>${t.status === 'Halted' ? `<button class="mini-btn" data-call="${t.id}" style="color:#ff8b96">Contact driver</button>` : ''}</td></tr>`;
    }).join('');
    $$('[data-call]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); const t = DB.tankerById(b.dataset.call); Sim.actions.contactDriver(t); toast('Driver contacted', `${t.plate} resuming on planned route`, 'ok'); }; });
    const watch = outlets.filter((o) => o.raOnline).slice().sort((a, b) => a.m.minDays - b.m.minDays).slice(0, 10);
    $('#lgWatch').innerHTML = watch.map((o) => {
      const t = o.m.tanker, p = o.m.minP;
      return `<tr class="row" data-outlet="${o.id}" data-tab="supply"><td class="l">${o.name}<br><span class="c-mute mono" style="font-size:10.5px">${o.id}</span></td><td style="color:${PRODUCTS[p].color}">${PRODUCTS[p].name}</td><td class="num ${coverCls(o.m.minDays)}">${fmt.kl(o.m.minDays)} d</td><td class="num">${fmt.kl(o.m.cover[p].stock)} kL</td>
        <td>${t ? `<span class="c-acc">${t.plate}</span> · ${t.status}${Sim.etaMin(t) ? ' · ' + Sim.etaMin(t) + ' min' : ''}` : o.pendingIndent ? '<span class="c-crit">Indent on hold</span>' : '<span class="c-mute">Not scheduled</span>'}</td>
        <td>${!t && o.m.minDays < 2 ? `<button class="mini-btn" data-disp="${o.id}" style="color:#ff8b96">Priority dispatch</button>` : ''}</td></tr>`;
    }).join('');
    $$('[data-disp]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); const o = DB.byId(b.dataset.disp); const t = Sim.actions.priorityDispatch(o); toast(`Priority dispatch raised for ${o.name}`, `${t.plate} assigned`, 'ok'); updateLogistics(); }; });
  }

  // ---------- Surveillance ----------
  function renderSurveillance(ov) {
    const total = outlets.reduce((a, o) => a + o.cameras.length, 0);
    const on = outlets.reduce((a, o) => a + o.cameras.filter((c) => c.online).length, 0);
    ov.innerHTML = head('SURVEILLANCE', 'CCTV & AI vision', `${total} cameras across ${outlets.length} outlets · <span class="c-ok">${on} online</span> · <span class="c-crit">${total - on} offline</span> · simulated feeds`,
      `<select class="input" id="svOutlet" style="width:260px"><option value="All">Area wall (priority outlets)</option>${outlets.map((o) => `<option value="${o.id}" ${UI.state.survOutlet === o.id ? 'selected' : ''}>${o.name} (${o.id})</option>`).join('')}</select><button class="chip ${UI.state.ai ? 'active' : ''}" id="svAI">AI overlay ${UI.state.ai ? 'ON' : 'OFF'}</button>`) + `
      <div class="ov-body"><div class="surv-wrap"><div class="surv-grid" id="svGrid"></div><div class="surv-side"><div class="sec-title" style="margin-top:0">AI VISION EVENTS</div><div id="svEv"></div></div></div></div>`;
    bindClose(ov);
    $('#svOutlet').onchange = (e) => { UI.state.survOutlet = e.target.value; renderSurveillance(ov); };
    $('#svAI').onclick = () => { UI.state.ai = !UI.state.ai; CCTV.setAI(UI.state.ai); renderSurveillance(ov); };
    let cams;
    if (UI.state.survOutlet === 'All') {
      const pri = outlets.slice().sort((a, b) => a.m.score - b.m.score);
      cams = pri.slice(0, 12).map((o, i) => ({ o, c: o.cameras[i % o.cameras.length] }));
    } else {
      const o = DB.byId(UI.state.survOutlet);
      cams = o.cameras.map((c) => ({ o, c }));
    }
    $('#svGrid').style.gridTemplateColumns = cams.length <= 4 ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)';
    $('#svGrid').innerHTML = cams.map((x, i) => `<div class="cam" data-i="${i}"><canvas></canvas></div>`).join('');
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
    el.innerHTML = Sim.aiEvents.slice(0, 25).map((e) => { const o = DB.byId(e.outletId); return `<div class="ev" data-outlet="${o.id}" data-tab="cameras"><span class="tag">${e.tag}</span><div>${e.text}<small>${o.name} · ${fmt.ago(e.ts)}</small></div></div>`; }).join('');
  }

  // ---------- Compliance view ----------
  function renderComplianceView(ov) {
    const items = outlets.flatMap((o) => o.m.lic.map((l) => ({ o, l }))).filter((x) => x.l.days <= 120).sort((a, b) => a.l.days - b.l.days);
    const irr = outlets.flatMap((o) => o.compliance.irregularities.filter((i) => i.status === 'Open').map((i) => ({ o, i })));
    const insp = outlets.slice().sort((a, b) => a.compliance.lastInspection - b.compliance.lastInspection);
    const overdue = insp.filter((o) => Date.now() - o.compliance.lastInspection > 45 * 86400000).length;
    ov.innerHTML = head('COMPLIANCE', 'Compliance & inspections', 'Statutory renewals, open irregularities and the inspection plan for the area') + `
      <div class="ov-body">
        <div class="tiles">${[
          ['Due ≤ 7 days', items.filter((x) => x.l.days <= 7).length, 'c-crit'], ['Due ≤ 30 days', items.filter((x) => x.l.days <= 30).length, 'c-warn'], ['Due ≤ 120 days', items.length, ''],
          ['Open irregularities', irr.length, irr.length ? 'c-warn' : 'c-ok'], ['Inspection > 45 days', overdue, overdue ? 'c-warn' : 'c-ok'], ['Planned this week', UI.state.planned.size, 'c-acc'],
        ].map(([l, v, c]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-val ${c}">${v}</div></div>`).join('')}</div>
        <div class="sec-title" style="margin-top:0">UPCOMING RENEWALS &amp; DUE DATES</div>
        <table class="t"><thead><tr><th>Outlet</th><th>Item</th><th>Due date</th><th class="num">Days left</th><th></th></tr></thead><tbody>${items.slice(0, 18).map((x) => `<tr class="row" data-outlet="${x.o.id}" data-tab="compliance"><td class="l">${x.o.name}</td><td>${x.l.label}</td><td>${fmt.date(x.l.due)}</td><td class="num"><span class="pill ${daysCls(x.l.days)}">${x.l.days} d</span></td><td><button class="mini-btn" data-remind="${x.o.id}">Remind dealer</button></td></tr>`).join('')}</tbody></table>
        ${irr.length ? `<div class="sec-title">OPEN IRREGULARITIES</div><table class="t"><tbody>${irr.map((x) => `<tr class="row" data-outlet="${x.o.id}" data-tab="compliance"><td class="l">${x.o.name}</td><td>${x.i.text}</td><td>${fmt.date(x.i.date)}</td></tr>`).join('')}</tbody></table>` : ''}
        <div class="sec-title">INSPECTION PLANNER · LONGEST SINCE LAST VISIT</div>
        <table class="t"><thead><tr><th>Outlet</th><th>Locality</th><th>Last inspection</th><th class="num">Days since</th><th>Last result</th><th></th></tr></thead><tbody>${insp.slice(0, 14).map((o) => { const d = Math.floor((Date.now() - o.compliance.lastInspection) / 86400000); return `<tr class="row" data-outlet="${o.id}" data-tab="compliance"><td class="l">${o.name}</td><td>${o.locality}</td><td>${fmt.date(o.compliance.lastInspection)}</td><td class="num ${d > 45 ? 'c-warn' : ''}">${d}</td><td>${o.compliance.inspections[0].result}</td><td>${UI.state.planned.has(o.id) ? '<span class="pill ok">Scheduled</span>' : `<button class="mini-btn" data-plan="${o.id}">Schedule</button>`}</td></tr>`; }).join('')}</tbody></table>
      </div>`;
    bindClose(ov);
    $$('[data-remind]', ov).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); const o = DB.byId(b.dataset.remind); toast('Reminder sent', `${o.dealer.name} · SMS + WhatsApp`, 'ok'); }; });
    $$('[data-plan]', ov).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); UI.state.planned.add(b.dataset.plan); toast('Inspection scheduled', DB.byId(b.dataset.plan).name, 'ok'); renderComplianceView(ov); }; });
  }

  // ---------- Analytics ----------
  function renderAnalytics(ov) {
    const s = areaStats();
    const n = outlets[0].hist.length;
    const daily = Array.from({ length: n }, (_, i) => outlets.reduce((a, o) => a + o.hist[i].total, 0));
    const tgt = outlets.reduce((a, o) => a + o.targetMonth / 30, 0);
    const labels = outlets[0].hist.map((h) => h.date.slice(8) + '/' + h.date.slice(5, 7));
    const mix = ['MS', 'HSD', 'XP'].map((p) => ({ label: PRODUCTS[p].name, value: outlets.reduce((a, o) => a + o.hist.reduce((b, h) => b + (h[p] || 0), 0), 0), color: PRODUCTS[p].color }));
    const ours = outlets.reduce((a, o) => a + o.daily, 0);
    const brands = ['Brand B', 'Brand C', 'Private P'].map((b, i) => ({ label: b, value: competitors.filter((c) => c.brand === b).reduce((a, c) => a + c.estDaily, 0), color: ['#e879f9', '#fb923c', '#94a3b8'][i] }));
    const share = ours / (ours + brands.reduce((a, b) => a + b.value, 0));
    const cats = ['Highway', 'Urban', 'Rural'].map((c) => { const os = outlets.filter((o) => o.category === c); return { label: c, value: os.reduce((a, o) => a + o.m.mtdKL, 0) / os.reduce((a, o) => a + o.m.mtdTarget, 0) * 100, color: '#38bdf8' }; });
    const bottom = outlets.slice().sort((a, b) => a.m.ach - b.m.ach).slice(0, 12);
    ov.innerHTML = head('ANALYTICS', 'Sales area performance', 'Volume, targets, product mix and competitive position · last 30 days') + `
      <div class="ov-body">
        <div class="tiles">${[
          ['MTD volume', fmt.kl(s.mtd, 0) + ' kL', ''], ['MTD achievement', fmt.pct(s.ach), achCls(s.ach)], ['Avg daily (30d)', fmt.kl(daily.reduce((a, b) => a + b, 0) / n, 0) + ' kL', ''],
          ['Est. area market share', fmt.pct(share), 'c-acc'], ['Avg health score', s.score, ''], ['Outlets < 85% target', outlets.filter((o) => o.m.ach < 0.85).length, 'c-warn'],
        ].map(([l, v, c]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-val ${c}">${v}</div></div>`).join('')}</div>
        <div class="grid-2">
          <div class="card"><div class="card-title">Area daily sales vs target</div><div class="card-sub">All outlets, kL per day</div><canvas class="chart tall" id="anDaily"></canvas></div>
          <div class="card"><div class="card-title">Bottom 12 outlets · MTD achievement</div><div class="card-sub">White marker = 100% of target · click names in Outlets view</div><canvas class="chart tall" id="anBottom"></canvas></div>
        </div>
        <div class="grid-3 mt">
          <div class="card"><div class="card-title">Product mix</div><div class="card-sub">30-day volume</div><canvas class="chart" id="anMix"></canvas></div>
          <div class="card"><div class="card-title">Estimated market share</div><div class="card-sub">Our network vs competitor outlets in the area</div><canvas class="chart" id="anShare"></canvas></div>
          <div class="card"><div class="card-title">Achievement by outlet category</div><div class="card-sub">MTD % of target</div><canvas class="chart" id="anCat"></canvas></div>
        </div>
      </div>`;
    bindClose(ov);
    requestAnimationFrame(() => {
      Charts.line($('#anDaily'), { labels, series: [{ data: daily, color: '#38bdf8', label: 'Actual', fill: true }, { data: daily.map(() => tgt), color: '#d7e2ea', label: 'Target', dash: [4, 4], width: 1.2 }], yFmt: (v) => v.toFixed(0) });
      Charts.bars($('#anBottom'), { horizontal: true, labelWidth: 170, max: 120, items: bottom.map((o) => ({ label: o.name, value: o.m.ach * 100, target: 100, color: o.m.ach < 0.85 ? '#ff4d5e' : o.m.ach < 0.95 ? '#f5b942' : '#3ddc97' })), fmt: (v) => v.toFixed(0) + '%' });
      const tot = mix.reduce((a, b) => a + b.value, 0);
      Charts.donut($('#anMix'), { items: mix, center: (tot / 1000).toFixed(1) + 'k', centerSub: 'kL' });
      Charts.donut($('#anShare'), { items: [{ label: 'Our network', value: ours, color: '#38bdf8' }].concat(brands), center: fmt.pct(share), centerSub: 'our share' });
      Charts.bars($('#anCat'), { items: cats, max: 120, yFmt: (v) => v.toFixed(0) + '%' });
    });
  }

  // ---------- Copilot ----------
  function renderCopilot(ov) {
    ov.innerHTML = head('COPILOT · PROTOTYPE', 'Ask about your area', 'Answers are computed from the live data in this dashboard') + `
      <div class="cp-msgs" id="cpMsgs"></div>
      <div class="cp-sugg" id="cpSugg">${['Summarise my area right now', 'Which outlets may dry out?', 'Who is behind target this month?', 'Where are my tankers?', 'What compliance is due this month?', 'Any security issues?', 'How is competition affecting us?'].map((s) => `<button class="chip">${s}</button>`).join('')}</div>
      <div class="cp-input"><input class="input" id="cpIn" placeholder="Ask a question… e.g. 'tell me about ${outlets[5].name}'"><button class="btn primary" id="cpGo">Ask</button></div>`;
    bindClose(ov);
    if (!UI.state.cpMsgs.length) UI.state.cpMsgs.push({ who: 'bot', html: 'Good ' + (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening') + '. ' + answer('summary') });
    drawMsgs();
    const ask = (q) => {
      if (!q.trim()) return;
      UI.state.cpMsgs.push({ who: 'user', html: q.replace(/</g, '&lt;') });
      UI.state.cpMsgs.push({ who: 'bot', typing: true });
      drawMsgs();
      setTimeout(() => { UI.state.cpMsgs.pop(); UI.state.cpMsgs.push({ who: 'bot', html: answer(q) }); drawMsgs(); }, 650 + Math.random() * 500);
    };
    $$('#cpSugg .chip').forEach((b) => { b.onclick = () => ask(b.textContent); });
    $('#cpGo').onclick = () => { ask($('#cpIn').value); $('#cpIn').value = ''; };
    $('#cpIn').onkeydown = (e) => { if (e.key === 'Enter') { ask(e.target.value); e.target.value = ''; } };
    setTimeout(() => $('#cpIn') && $('#cpIn').focus(), 100);
  }
  function drawMsgs() {
    const el = $('#cpMsgs');
    if (!el) return;
    el.innerHTML = UI.state.cpMsgs.map((m) => m.typing ? '<div class="msg bot typing"><span></span><span></span><span></span></div>' : `<div class="msg ${m.who}">${m.who === 'bot' ? '<div class="who">PRAHARI</div>' : ''}${m.html}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }
  function answer(q) {
    const s = areaStats();
    const ql = q.toLowerCase();
    const named = outlets.find((o) => ql.includes(o.name.toLowerCase()) || ql.includes(o.id.toLowerCase()));
    if (named) {
      const o = named, m = o.m;
      const al = Sim.alerts.filter((a) => a.outletId === o.id && a.status !== 'resolved');
      return `<b>${oLink(o)}</b> (${o.id}, ${o.category}, ${o.locality}) is <span class="c-${m.status}">${ST_LABEL[m.status].toLowerCase()}</span> with a health score of <b>${m.score}</b>.
        <ul><li>Today: <b>${fmt.kl(m.todayL / 1000, 2)} kL</b> sold (${fmt.pct(m.todayL / Math.max(1, m.expectedL))} of plan so far). MTD at <b>${fmt.pct(m.ach)}</b> of target.</li>
        <li>Lowest stock: ${PRODUCTS[m.minP].name.toLowerCase()} with <b>${fmt.kl(m.minDays)} days</b> of cover${m.tanker ? `, tanker ${m.tanker.plate} ${m.tanker.status.toLowerCase()}` : ''}.</li>
        <li>${al.length ? `${al.length} open alert${al.length > 1 ? 's' : ''}: ${al.slice(0, 3).map((a) => a.title.split(' at ')[0].split(' — ')[0]).join('; ')}.` : 'No open alerts.'}</li>
        <li>Dealer ${o.dealer.name}, credit outstanding ${fmt.lakh(o.credit.outstanding)}${o.credit.overdueDays ? `, <span class="c-warn">${o.credit.overdueDays} days overdue</span>` : ''}.</li></ul>`;
    }
    if (ql === 'summary' || /summar|brief|overview|right now|today|status/.test(ql)) {
      const crit = Sim.alerts.filter((a) => a.sev === 'critical' && a.status !== 'resolved');
      return `Here's your area at ${fmt.hm(Date.now())}:
        <ul><li><b>${fmt.kl(s.todayKL)} kL</b> sold today, ${fmt.pct(s.todayKL / s.expectedKL)} of plan so far. Month-to-date at <b class="${achCls(s.ach)}">${fmt.pct(s.ach)}</b> of target.</li>
        <li><b>${s.ok}</b> of ${s.n} outlets healthy; <span class="c-crit">${s.crit} critical</span>, <span class="c-warn">${s.warn} need attention</span>, ${s.off} offline.</li>
        <li><b>${s.transit}</b> tank trucks moving, ${s.loading} loading${s.halted ? `, <span class="c-crit">${s.halted} halted off-route</span>` : ''}.</li>
        ${crit.length ? `<li>Critical: ${crit.slice(0, 3).map((a) => a.tankerId && a.key.startsWith('halt:') ? `<span class="link" data-tanker="${a.tankerId}">${a.title}</span>` : `<span class="link" data-outlet="${a.outletId}">${a.title}</span>`).join('; ')}.</li>` : ''}</ul>
        Ask me about dry-outs, targets, tankers, compliance or any outlet by name.`;
    }
    if (/dry|run out|stock|replenish|cover/.test(ql)) {
      const list = outlets.filter((o) => o.m.minDays < 2.5 && o.raOnline).sort((a, b) => a.m.minDays - b.m.minDays);
      if (!list.length) return 'No outlet is below 2.5 days of stock cover right now.';
      return `${list.length} outlet${list.length > 1 ? 's are' : ' is'} under 2.5 days of cover:<ul>${list.slice(0, 7).map((o) => `<li>${oLink(o)} — ${PRODUCTS[o.m.minP].name.toLowerCase()} <b class="${coverCls(o.m.minDays)}">${fmt.kl(o.m.minDays)} d</b>; ${o.m.tanker ? `tanker <span class="link" data-tanker="${o.m.tanker.id}">${o.m.tanker.plate}</span> ${o.m.tanker.status.toLowerCase()}${Sim.etaMin(o.m.tanker) ? ', ETA ' + Sim.etaMin(o.m.tanker) + ' min' : ''}` : o.pendingIndent ? '<span class="c-crit">indent on hold (' + o.pendingIndent.reason.toLowerCase() + ')</span>' : '<span class="c-warn">nothing scheduled</span>'}</li>`).join('')}</ul>${list.some((o) => !o.m.tanker && o.m.minDays < 1.5) ? 'I recommend a priority dispatch for the outlets with nothing scheduled — open the outlet and use <b>Priority dispatch</b>.' : ''}`;
    }
    if (/target|behind|achiev|perform|lag|worst|best/.test(ql)) {
      const sorted = outlets.slice().sort((a, b) => a.m.ach - b.m.ach);
      return `Area MTD achievement is <b class="${achCls(s.ach)}">${fmt.pct(s.ach)}</b>. Furthest behind:<ul>${sorted.slice(0, 5).map((o) => `<li>${oLink(o)} — <b class="${achCls(o.m.ach)}">${fmt.pct(o.m.ach)}</b>${o.m.trend < -0.1 ? `, volume down ${Math.round(-o.m.trend * 100)}% week-on-week` : ''}${o.competitorNote ? ' (new competitor nearby)' : ''}</li>`).join('')}</ul>Top performers: ${sorted.slice(-3).reverse().map((o) => `${oLink(o)} (${fmt.pct(o.m.ach)})`).join(', ')}.`;
    }
    if (/tanker|truck|deliver|logist|supply|transit/.test(ql)) {
      const halted = tankers.filter((t) => t.status === 'Halted');
      const moving = tankers.filter((t) => t.status === 'In transit').sort((a, b) => Sim.etaMin(a) - Sim.etaMin(b));
      return `${s.transit} trucks in transit, ${s.loading} loading, ${s.unloading} unloading, ${s.returning} returning.${halted.length ? ` <span class="c-crit">${halted.map((t) => `<span class="link" data-tanker="${t.id}">${t.plate}</span> has been halted off-route for ${Math.round(t.haltSec / 60)} min`).join('; ')}.</span>` : ''}<ul>${moving.slice(0, 5).map((t) => `<li><span class="link" data-tanker="${t.id}">${t.plate}</span> → ${oLink(DB.byId(t.outletId))}, ETA <b>${Sim.etaMin(t)} min</b> (${t.comps.map((c) => c.kl + ' kL ' + PRODUCTS[c.product].code).join(' + ')})</li>`).join('')}</ul>`;
    }
    if (/complian|licen|stamp|renew|noc|inspect|due/.test(ql)) {
      const items = outlets.flatMap((o) => o.m.lic.filter((l) => l.days <= 30).map((l) => ({ o, l }))).sort((a, b) => a.l.days - b.l.days);
      const insp = outlets.filter((o) => Date.now() - o.compliance.lastInspection > 45 * 86400000);
      return `${items.length} renewal${items.length === 1 ? '' : 's'} due in the next 30 days:<ul>${items.slice(0, 6).map((x) => `<li>${x.l.label} — ${oLink(x.o)} in <b class="${x.l.days <= 10 ? 'c-crit' : 'c-warn'}">${x.l.days} days</b></li>`).join('')}</ul>${insp.length} outlet${insp.length === 1 ? ' has' : 's have'} not been inspected in 45+ days. Open the <b>Comply</b> view to schedule visits.`;
    }
    if (/secur|cctv|camera|theft|ai|vision/.test(ql)) {
      const off = outlets.filter((o) => o.m.camsOff);
      const halted = tankers.filter((t) => t.status === 'Halted');
      return `<ul><li>${off.length} outlet${off.length === 1 ? '' : 's'} with cameras offline: ${off.slice(0, 5).map((o) => `${oLink(o)} (${o.m.camsOff})`).join(', ') || 'none'}.</li>${halted.length ? `<li class="c-crit">${halted.length} tank truck halted off-route — possible pilferage risk: ${halted.map((t) => `<span class="link" data-tanker="${t.id}">${t.plate}</span>`).join(', ')}.</li>` : ''}<li>Latest AI detections: ${Sim.aiEvents.slice(0, 3).map((e) => `${e.text} at ${oLink(DB.byId(e.outletId))}`).join('; ')}.</li></ul>`;
    }
    if (/compet|market|share|rival/.test(ql)) {
      const d = DB.stories.decline;
      return `Estimated network share in the area is <b>${fmt.pct(outlets.reduce((a, o) => a + o.daily, 0) / (outlets.reduce((a, o) => a + o.daily, 0) + competitors.reduce((a, c) => a + c.estDaily, 0)))}</b>. The clearest competitive hit is ${oLink(d)}: volume down <b class="c-crit">${Math.round(-d.m.trend * 100)}%</b> week-on-week after a ${d.competitorNote.toLowerCase()}. Turn on the <b>Competitor outlets</b> map layer to see the new site (white ring).`;
    }
    return 'I can answer questions about <b>today\'s summary</b>, <b>dry-out risk</b>, <b>targets</b>, <b>tankers</b>, <b>compliance</b>, <b>security</b>, <b>competition</b>, or any outlet by name or code (e.g. "tell me about ' + outlets[2].name + '").';
  }

  // ===================================================================
  // Ticker, palette, modal, toasts, tooltip
  // ===================================================================
  function updateTicker() {
    const track = $('#tickerTrack');
    const fresh = Sim.events.filter((e) => e.ts > UI.state.lastEvTs).reverse();
    if (!fresh.length) return;
    UI.state.lastEvTs = fresh[fresh.length - 1].ts;
    fresh.forEach((e) => {
      const el = document.createElement('span');
      el.className = 'tk-item';
      el.innerHTML = `<span class="t">${fmt.time(e.ts)}</span><span class="${e.type === 'alert' ? 'c-crit' : e.type === 'ok' ? 'c-ok' : e.type === 'info' ? 'c-acc' : ''}">${e.text}</span>`;
      if (e.outletId) { el.style.cursor = 'pointer'; el.dataset.outlet = e.outletId; }
      track.prepend(el);
    });
    while (track.children.length > 14) track.lastChild.remove();
  }

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
    outlets.forEach((o) => all.push({ k: 'OUTLET', t: o.name, s: `${o.id} · ${o.locality} · ${o.dealer.name}`, hay: (o.name + ' ' + o.id + ' ' + o.locality + ' ' + o.dealer.name + ' ' + o.road).toLowerCase(), go: () => UI.selectOutlet(o.id) }));
    tankers.forEach((t) => all.push({ k: 'TANKER', t: t.plate, s: `${t.status} · → ${DB.byId(t.outletId).name}`, hay: (t.plate + ' ' + t.transporter + ' ' + t.driver).toLowerCase(), go: () => UI.selectTanker(t.id) }));
    depots.forEach((d) => all.push({ k: 'DEPOT', t: d.name, s: d.id, hay: d.name.toLowerCase(), go: () => { closePalette(); MapView.map.flyTo({ center: [d.lng, d.lat], zoom: 14, pitch: 50, duration: 2000 }); } }));
    [['ops', 'Operations map'], ['outlets', 'Outlet registry'], ['logistics', 'Supply & logistics'], ['surveillance', 'CCTV & AI vision'], ['compliance', 'Compliance & inspections'], ['analytics', 'Analytics'], ['copilot', 'Copilot']].forEach(([v, n]) => all.push({ k: 'VIEW', t: n, s: 'Go to view', hay: n.toLowerCase() + ' ' + v, go: () => { closePalette(); UI.setView(v); } }));
    palItems = (q ? all.filter((x) => x.hay.includes(q) || x.t.toLowerCase().includes(q)) : all.filter((x) => x.k === 'VIEW').concat(all.filter((x) => x.k === 'OUTLET').slice(0, 8))).slice(0, 40);
    drawPal();
  }
  function drawPal() {
    $('#palResults').innerHTML = palItems.length ? palItems.map((x, i) => `<div class="pal-item ${i === palSel ? 'active' : ''}" data-i="${i}"><span class="k">${x.k}</span><span>${x.t}</span><small>${x.s}</small></div>`).join('') : '<div class="empty">No matches</div>';
    $$('#palResults .pal-item').forEach((el) => { el.onclick = () => palItems[+el.dataset.i].go(); });
    const a = $('#palResults .active'); if (a) a.scrollIntoView({ block: 'nearest' });
  }

  function openModal(html) { $('#modal .modal-box').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal .modal-box').innerHTML = ''; }

  function toast(msg, sub, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = msg + (sub ? `<small>${sub}</small>` : '');
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3600);
  }
  UI.toast = toast;

  UI.tooltip = function (e, html) {
    const tt = $('#tooltip');
    if (!e) { tt.style.display = 'none'; return; }
    tt.innerHTML = html;
    tt.style.display = 'block';
    const x = Math.min(window.innerWidth - tt.offsetWidth - 10, e.clientX + 14);
    const y = Math.min(window.innerHeight - tt.offsetHeight - 10, e.clientY + 14);
    tt.style.left = x + 'px'; tt.style.top = y + 'px';
  };

  window.UI = UI;
})();
