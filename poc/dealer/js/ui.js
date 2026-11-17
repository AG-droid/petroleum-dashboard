/* =====================================================================
   PRAHARI for dealers — interface shell
   The same layout as the Sales Officer dashboard: a live map, a left panel with the day's
   numbers and a to-do list that writes itself, an outlet or truck panel on the right, and
   full views as overlays. Panels: panel.js · overlays: views.js · map: map.js.
   ===================================================================== */
(function () {
  'use strict';
  const W = window.DW;
  const { PRODUCTS } = DB;
  const F = Eng.fmt;
  const TZ = 'Asia/Kolkata';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  // Everything that reaches HTML goes through esc(), including synthetic names.
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ic = (d, s) => `<svg class="i" viewBox="0 0 24 24"${s ? ` style="width:${s}px;height:${s}px"` : ''} aria-hidden="true">${d}</svg>`;
  const I = {
    x: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
    rupee: ic('<path d="M7 5h10M7 9h10M9 5c5 0 5 8 0 8H7l7 7"/>', 13),
    check: ic('<path d="m5 12 5 5 9-10"/>', 14),
    clock: ic('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', 13),
    truck: ic('<path d="M2 7h11v9H2zM13 10h4l4 4v2h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>', 14),
    msg: ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', 14),
    shield: ic('<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/>', 14),
    copy: ic('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', 13),
    phone: ic('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 14),
    plus: ic('<path d="M12 5v14M5 12h14"/>', 14),
    print: ic('<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/>', 14),
    download: ic('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 14),
    send: ic('<path d="M4 12 20 4l-6 16-3-7z"/>', 14),
    pin: ic('<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>', 14),
    pay: ic('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>', 14),
    cal: ic('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', 14),
  };
  const SEV_DOT = { critical: 'crit', high: 'crit', medium: 'warn', low: 'off' };
  const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  const PCOLOR = { MS: 'var(--ms)', HSD: 'var(--hsd)', XP: 'var(--xp)' };
  const PHEX = { MS: '#57b583', HSD: '#e0a645', XP: '#a48bf0' };
  const STATUS = {
    awaiting_payment: ['Waiting for payment', 'warn'], placed: ['Released, waiting to load', 'acc'], loading: ['Loading at supply point', 'acc'],
    in_transit: ['On the way', 'acc'], unloading: ['Unloading', 'acc'], awaiting_receipt: ['Confirm receipt', 'warn'],
    received: ['Received', 'ok'], claim_raised: ['Claim raised', 'warn'], cancelled: ['Cancelled', 'off'],
  };
  const ST_TXT = { ok: 'Running normally', warn: 'Needs attention', crit: 'Urgent', off: 'Offline' };
  const ST_HEX = { ok: '#57b583', warn: '#e0a645', crit: '#e5604f', off: '#7c8188' };

  const fmt = {
    hm: F.hm, when: F.when, inr: F.inr, L: F.litres, hrs: F.hrs,
    inrFull: (v) => '₹' + Math.round(v).toLocaleString('en-IN'),
    lakh: (v) => '₹' + (v / 100000).toFixed(1) + ' lakh',
    kl: (L) => (L / 1000).toFixed(L < 10000 ? 2 : 1) + ' KL',
    klv: (L, d) => (L / 1000).toFixed(d == null ? 1 : d),
    date: (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }),
    dmy: (ts) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ }).replace(/\//g, '-'),
    dt: (ts) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }),
    time: (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ }),
    ago: (ts) => { const m = Math.max(0, Math.round((Eng.now - ts) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; },
    days: (d) => d == null ? '—' : d < 1 ? (d * 24).toFixed(1) + ' h' : d.toFixed(1) + ' days',
    pct: (v) => Math.round(v * 100) + '%',
  };
  const pname = (p) => PRODUCTS[p].name;
  const rname = (id) => { const r = W.byId(id); return r ? r.name : ''; };
  const achCls = (a) => (a >= 1 ? 'c-ok' : a >= 0.9 ? '' : a >= 0.8 ? 'c-warn' : 'c-crit');
  const coverCls = (d) => (d < 1 ? 'c-crit' : d < 2 ? 'c-warn' : '');

  const DUI = {
    state: { view: 'ops', lpTab: 'attention', scope: 'all', selected: null, selTruck: null, tab: 'overview', open: new Set(), thread: null, alertFilter: 'All', sort: { key: 'name', dir: 1 } },
    $, $$, esc, I, fmt, pname, rname, PCOLOR, PHEX, STATUS, SEV_DOT, SEV_RANK, ST_TXT, ST_HEX, achCls, coverCls,
  };
  DUI.scopeRos = () => (DUI.state.scope === 'all' ? W.ros : W.ros.filter((r) => r.id === DUI.state.scope));
  DUI.inScope = (roId) => DUI.state.scope === 'all' || !roId || roId === DUI.state.scope;
  DUI.recs = () => Eng.recommendations().filter((r) => DUI.inScope(r.roId));
  DUI.outletStatus = function (ro) {
    const recs = Eng.recommendations(ro.id).filter((r) => r.roId === ro.id);
    const worst = recs.some((r) => r.sev === 'critical') ? 'crit' : recs.some((r) => r.sev === 'high' || r.sev === 'medium') ? 'warn' : 'ok';
    return { recs, worst, text: ST_TXT[worst] };
  };
  /** Tank bar: fill to the reading, hatched up to the dead-stock line (fuel that can't be sold). */
  DUI.tankBar = function (stockL, capL, deadL, col) {
    return `<div class="bar dbar"><i style="width:${Math.min(100, stockL / capL * 100)}%;background:${col}"></i><span class="dead" style="width:${Math.min(100, deadL / capL * 100)}%"></span></div>`;
  };

  // ===================================================================
  // Day at a glance (left panel)
  // ===================================================================
  function stats() {
    const ros = DUI.scopeRos();
    const s = { todayL: 0, expectedL: 0, mtd: 0, mtdT: 0, takings: 0 };
    ros.forEach((ro) => {
      const m = Eng.metrics(ro);
      s.todayL += m.todayL; s.expectedL += m.expectedL; s.takings += m.todayInr;
      ro.products.forEach((p) => { s.mtd += m.mtd[p].L; s.mtdT += m.mtd[p].targetL; });
    });
    s.ach = s.mtd / Math.max(1, s.mtdT);
    const ids = new Set(ros.map((r) => r.id));
    const mine = W.orders.filter((o) => ids.has(o.roId));
    s.moving = mine.filter((o) => ['loading', 'in_transit', 'unloading'].includes(o.status));
    s.next = s.moving.filter((o) => o.status === 'in_transit').sort((a, b) => a.arriveTs - b.arriveTs)[0];
    s.waiting = mine.filter((o) => o.status === 'awaiting_payment').length;
    s.money = Eng.money();
    return s;
  }
  DUI.stats = stats;
  function renderLeft() {
    $('#leftPanel').innerHTML = `
      <div class="p-head">
        <div class="p-title">${esc(W.dealer.name)}</div>
        <div class="p-sub faint">Dealer · ${esc(DB.meta.salesArea)}</div>
        <div class="p-sub" id="lpSub"></div>
      </div>
      <div style="padding:0 18px 16px">
        <div class="stats">
          <div class="stat click" data-goto="analytics"><div class="stat-label">Sold today</div><div class="stat-val" id="stToday"></div><div class="stat-foot" id="stTodayF"></div></div>
          <div class="stat click" data-goto="analytics"><div class="stat-label">This month</div><div class="stat-val" id="stMonth"></div><div class="stat-foot" id="stMonthF"></div></div>
          <div class="stat click" data-goto="account"><div class="stat-label">Balance for orders</div><div class="stat-val" id="stBal"></div><div class="stat-foot" id="stBalF"></div></div>
          <div class="stat click" data-goto="logistics"><div class="stat-label">Your trucks on the road</div><div class="stat-val" id="stTrucks"></div><div class="stat-foot" id="stTrucksF"></div></div>
        </div>
      </div>
      <div class="tabs" id="lpTabs">
        <button class="tab" data-lp="attention">Priorities <span class="count" id="cAtt"></span></button>
        <button class="tab" data-lp="alerts">All alerts <span class="count" id="cAl"></span></button>
        <button class="tab" data-lp="activity">Activity</button>
      </div>
      <div class="p-body" id="lpBody"></div>`;
    $$('#leftPanel [data-goto]').forEach((k) => { k.onclick = () => DUI.setView(k.dataset.goto); });
    $$('#lpTabs .tab').forEach((b) => { b.onclick = () => { DUI.state.lpTab = b.dataset.lp; DUI.updateLeft(); }; });
    DUI.updateLeft();
  }
  let lastSig = '';
  function updateLeft() {
    if (!$('#stToday')) return;
    const s = stats();
    const ros = DUI.scopeRos();
    const nDep = new Set(ros.map((r) => r.depotId)).size;
    const pace = s.todayL / Math.max(1, s.expectedL);
    $('#lpSub').textContent = `${ros.length} outlet${ros.length > 1 ? 's' : ''} · ${nDep} supply point${nDep > 1 ? 's' : ''} · data as on ${fmt.hm(Eng.lastSync('atg'))}`;
    $('#stToday').innerHTML = `${fmt.klv(s.todayL)}<small>kL</small>`;
    $('#stTodayF').innerHTML = `<span class="${achCls(pace)}">${fmt.pct(pace)}</span> of the usual by now`;
    $('#stMonth').innerHTML = `<span class="${achCls(s.ach)}">${fmt.pct(s.ach)}</span>`;
    $('#stMonthF').textContent = 'of monthly target';
    $('#stBal').innerHTML = `${(s.money.available / 100000).toFixed(1)}<small>lakh</small>`;
    $('#stBalF').innerHTML = s.money.pending ? `<span class="c-warn">${fmt.lakh(s.money.pending)} on its way</span>` : s.waiting ? `<span class="c-warn">${s.waiting} order${s.waiting > 1 ? 's' : ''} waiting for payment</span>` : 'available now';
    $('#stTrucks').innerHTML = `${s.moving.length}`;
    $('#stTrucksF').innerHTML = s.next ? `next arrives ${esc(fmt.when(s.next.arriveTs))}` : s.moving.length ? 'loading or unloading' : 'none on the way';
    const recs = DUI.recs();
    const top = recs.filter((r) => r.sev === 'critical' || r.sev === 'high');
    $('#cAtt').textContent = top.length;
    $('#cAl').textContent = recs.length;
    $$('#lpTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.lp === DUI.state.lpTab));
    const tab = DUI.state.lpTab;
    // Redraw the list only when its content changes, never under a pressed pointer.
    const sig = tab + '|' + (tab === 'activity' ? W.activity.length + ':' + (W.activity[0] || {}).ts : recs.map((r) => r.key + r.title + r.why + r.action.label).join() + [...DUI.state.open].join() + DUI.state.alertFilter);
    if (sig === lastSig || pointerDown) return;
    lastSig = sig;
    if (tab === 'attention') renderAttention(top, recs.length);
    else if (tab === 'alerts') renderAlertList(recs);
    else renderActivity();
  }
  DUI.updateLeft = () => { lastSig = ''; updateLeft(); };

  /** A to-do item in the Sales Officer's Priorities form, plus the money at stake and the reason. */
  function attCard(r) {
    const open = DUI.state.open.has(r.key);
    const roTitle = r.roId ? `data-outlet="${esc(r.roId)}" data-tab="${tabFor(r)}"` : '';
    return `<div class="att"><span class="dot ${SEV_DOT[r.sev]}"></span><div>
      <div class="att-title" ${roTitle}>${esc(r.title)}</div>
      <div class="att-desc">${esc(r.why)}</div>
      <div class="att-impact">${I.rupee}<span>${esc(r.impact)}</span></div>
      ${open ? `<div class="att-ev">${r.evidence.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('')}</div>` : ''}
      <div class="att-actions"><button class="btn sm primary" data-act="${esc(r.key)}">${esc(r.action.label)}</button><button class="btn sm ghost" data-why="${esc(r.key)}">${open ? 'Hide' : 'Why?'}</button>
        <span class="att-more"><button class="text-btn" data-snooze="${esc(r.key)}">Snooze</button><button class="text-btn" data-dismiss="${esc(r.key)}">Not relevant</button></span></div></div></div>`;
  }
  DUI.attCard = attCard;
  function tabFor(r) {
    return { Supply: 'supply', Payment: 'supply', Integrity: 'integrity', Equipment: 'integrity', Quality: 'integrity', Compliance: 'compliance', Sales: 'sales' }[r.cat] || 'overview';
  }
  DUI.tabFor = tabFor;
  function renderAttention(items, total) {
    const body = $('#lpBody');
    body.innerHTML = items.length ? items.slice(0, 8).map(attCard).join('') + (total > Math.min(8, items.length) ? `<div style="padding-top:12px"><span class="text-btn" id="seeAll">See all ${total} in alerts</span></div>` : '')
      : '<div class="all-clear">Nothing urgent right now.<br><span class="faint" style="font-size:12px">Prahari keeps watching stock, prices, pumps and deliveries.</span></div>';
    const sa = $('#seeAll', body); if (sa) sa.onclick = () => { DUI.state.lpTab = 'alerts'; DUI.updateLeft(); };
  }
  DUI.alertRow = function (r) {
    return `<div class="alert" ${r.roId ? `data-outlet="${esc(r.roId)}" data-tab="${tabFor(r)}"` : ''}>
      <span class="dot ${SEV_DOT[r.sev]}"></span>
      <div><div class="alert-title">${esc(r.title)}</div><div class="alert-meta">${esc(r.cat)}${r.roId ? ' · ' + esc(rname(r.roId)) : ''}${r.deadline ? ' · by ' + esc(fmt.when(r.deadline)) : ''}</div></div>
      <span class="text-btn" data-act="${esc(r.key)}">Act</span>
    </div>`;
  };
  function renderAlertList(recs) {
    const f = DUI.state.alertFilter;
    const list = recs.filter((r) => f === 'All' || r.cat === f).sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.score - a.score);
    const cats = ['All', 'Supply', 'Payment', 'Integrity', 'Equipment', 'Quality', 'Compliance', 'Sales'];
    $('#lpBody').innerHTML = `<div class="filter-row"><select class="input" id="alFilter">${cats.map((c) => `<option ${c === f ? 'selected' : ''} value="${c}">${c === 'All' ? 'All categories' : c}</option>`).join('')}</select><span class="faint" style="font-size:12px">${list.length} open</span></div>
      ${list.length ? list.map(DUI.alertRow).join('') : '<div class="empty">No alerts in this category</div>'}`;
    $('#alFilter').onchange = (e) => { DUI.state.alertFilter = e.target.value; DUI.updateLeft(); };
  }
  function renderActivity() {
    $('#lpBody').innerHTML = W.activity.filter((a) => DUI.inScope(a.roId)).slice(0, 40).map((a) => `<div class="activity ${a.kind === 'ok' ? 'ok-ev' : ''}" ${a.roId ? `data-outlet="${esc(a.roId)}"` : ''}><time>${esc(fmt.hm(a.ts))}</time><span>${esc(a.text)}</span></div>`).join('') || '<div class="empty">Nothing yet. Your actions, deliveries and payments appear here.</div>';
  }

  // ===================================================================
  // Views and selection
  // ===================================================================
  DUI.setView = function (v) {
    const s = DUI.state;
    s.view = v;
    $$('#rail button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    const ov = $('#overlay');
    ov.className = 'overlay';
    $('#legend').classList.toggle('hidden', v !== 'ops' && v !== 'copilot' && v !== 'messages');
    if (v === 'ops') {
      ov.classList.add('hidden'); ov.innerHTML = '';
      $('#leftPanel').classList.remove('hidden');
      if (!s.selected && !s.selTruck) { $('#rightPanel').classList.add('hidden'); $('#stage').classList.remove('right-open'); }
      DUI.updateLeft();
      return;
    }
    DUI.closePanel();
    $('#leftPanel').classList.toggle('hidden', v !== 'copilot' && v !== 'messages');
    DUI.Views.open(v, ov);
  };
  DUI.selectOutlet = function (id, tab) {
    if (!W.byId(id)) return;
    closePalette(); if (DUI.isModalOpen()) DUI.closeModal();
    if (DUI.state.view !== 'ops') DUI.setView('ops');
    const same = DUI.state.selected === id;
    DUI.state.selected = id; DUI.state.selTruck = null;
    DUI.state.tab = tab || (same ? DUI.state.tab : 'overview');
    DUI.Panel.openOutlet();
    MapD.flyToOutlet(W.byId(id));
  };
  DUI.selectTruck = function (orderId) {
    const o = W.orderById(orderId);
    if (!o) return;
    closePalette(); if (DUI.isModalOpen()) DUI.closeModal();
    if (DUI.state.view !== 'ops') DUI.setView('ops');
    DUI.state.selected = null; DUI.state.selTruck = orderId;
    DUI.Panel.openTruck();
    MapD.flyToTruck(o);
  };
  DUI.closePanel = function () {
    DUI.state.selected = null; DUI.state.selTruck = null;
    $('#rightPanel').classList.add('hidden'); $('#rightPanel').innerHTML = '';
    $('#stage').classList.remove('right-open');
    MapD.clearSelection();
  };
  /** Re-render whatever is on screen after an action changed the data. */
  DUI.refresh = function () {
    DUI.updateLeft();
    if (DUI.state.selected || DUI.state.selTruck) DUI.Panel.redraw();
    if (DUI.state.view !== 'ops') DUI.Views.update(true);
    MapD.update();
  };

  // ===================================================================
  // Search
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
  DUI.openPalette = openPalette;
  function searchPal(q) {
    q = q.toLowerCase().trim();
    const all = [];
    [['ops', 'Map'], ['outlets', 'Outlets'], ['logistics', 'Orders & trucks'], ['account', 'Account & payments'], ['compliance', 'Compliance'], ['analytics', 'Performance'], ['messages', 'Messages with the Sales Officer'], ['copilot', 'Assistant']]
      .forEach(([v, n]) => all.push({ g: 'Go to', t: n, s: '', hay: n.toLowerCase(), go: () => { closePalette(); DUI.setView(v); } }));
    all.push({ g: 'Actions', t: 'New fuel order', s: '', hay: 'new order indent fuel', go: () => { closePalette(); DUI.openOrder(null); } });
    all.push({ g: 'Actions', t: 'Add money (RTGS / NEFT)', s: '', hay: 'pay payment rtgs neft add money utr', go: () => { closePalette(); DUI.openPay({}); } });
    all.push({ g: 'Actions', t: 'Morning brief', s: '', hay: 'morning brief whatsapp', go: () => { closePalette(); DUI.openBrief(); } });
    W.ros.forEach((r) => all.push({ g: 'Outlets', t: r.name, s: `RO ${r.id} · ${r.locality}`, hay: (r.name + ' ' + r.id + ' ' + r.locality + ' ' + r.road).toLowerCase(), go: () => DUI.selectOutlet(r.id) }));
    W.orders.forEach((o) => all.push({ g: 'Orders', t: o.id, s: `${rname(o.roId)} · ${STATUS[o.status][0]}`, hay: (o.id + ' ' + (o.invoice ? o.invoice.no : '') + ' ' + (o.truck ? o.truck.plate : '')).toLowerCase(), go: () => { closePalette(); if (['loading', 'in_transit', 'unloading'].includes(o.status)) DUI.selectTruck(o.id); else DUI.openOrderDetail(o.id); } }));
    W.payments.forEach((p) => all.push({ g: 'Payments', t: `${p.mode} ${fmt.inr(p.amount)}`, s: `UTR ${p.utr}`, hay: (p.utr + ' ' + p.mode).toLowerCase(), go: () => { closePalette(); DUI.setView('account'); } }));
    palItems = (q ? all.filter((x) => x.hay.includes(q)) : all.filter((x) => x.g === 'Go to' || x.g === 'Outlets' || x.g === 'Actions')).slice(0, 40);
    drawPal();
  }
  function drawPal() {
    let lastG = '';
    $('#palResults').innerHTML = palItems.length ? palItems.map((x, i) => { const g = x.g !== lastG ? `<div class="pal-group">${esc(x.g)}</div>` : ''; lastG = x.g; return `${g}<div class="pal-item ${i === palSel ? 'active' : ''}" data-i="${i}"><span>${esc(x.t)}</span><small>${esc(x.s)}</small></div>`; }).join('') : '<div class="empty">No matches</div>';
    $$('#palResults .pal-item').forEach((el) => { el.onclick = () => palItems[+el.dataset.i].go(); });
    const a = $('#palResults .active'); if (a) a.scrollIntoView({ block: 'nearest' });
  }

  DUI.tooltip = function (e, html) {
    const tt = $('#tooltip');
    if (!e) { tt.style.display = 'none'; return; }
    tt.innerHTML = html;
    tt.style.display = 'block';
    tt.style.left = Math.min(window.innerWidth - tt.offsetWidth - 10, e.clientX + 14) + 'px';
    tt.style.top = Math.min(window.innerHeight - tt.offsetHeight - 10, e.clientY + 14) + 'px';
  };

  // ===================================================================
  // Top bar and global clicks
  // ===================================================================
  function scopeMenu() {
    const menu = $('#scopeMenu');
    const items = [{ id: 'all', name: 'All outlets', sub: `${W.ros.length} outlets` }].concat(W.ros.map((r) => ({ id: r.id, name: r.name, sub: `RO ${r.id}` })));
    menu.innerHTML = items.map((x) => `<button role="option" data-scope="${esc(x.id)}" class="${DUI.state.scope === x.id ? 'active' : ''}">${esc(x.name)}<small>${esc(x.sub)}</small></button>`).join('');
    $$('[data-scope]', menu).forEach((b) => { b.onclick = () => { DUI.setScope(b.dataset.scope); menu.classList.add('hidden'); }; });
  }
  DUI.setScope = function (id) {
    DUI.state.scope = id;
    $('#scopeLabel').textContent = id === 'all' ? 'All outlets' : rname(id);
    $('#scopeSub').textContent = id === 'all' ? `· ${W.ros.length} outlets` : `· RO ${id}`;
    scopeMenu();
    MapD.update();
    if (id !== 'all') DUI.selectOutlet(id);
    else { if (DUI.state.view !== 'ops') DUI.setView(DUI.state.view); else { DUI.closePanel(); MapD.home(); } }
    DUI.updateLeft();
  };
  let pointerDown = false;
  DUI.pointerDown = () => pointerDown;
  function onClick(e) {
    if (e.target.closest('#tour')) return;
    // Shared buttons are delegated once at the document, so they survive every redraw.
    const act = e.target.closest('[data-act]');
    if (act) { e.stopPropagation(); const r = Eng.allRules().find((x) => x.key === act.dataset.act); if (r) DUI.runAction(r); return; }
    const why = e.target.closest('[data-why]');
    if (why) { const k = why.dataset.why; if (DUI.state.open.has(k)) DUI.state.open.delete(k); else DUI.state.open.add(k); DUI.refresh(); return; }
    const sn = e.target.closest('[data-snooze]');
    if (sn) { Eng.actions.setRec(sn.dataset.snooze, 'snoozed'); DUI.toast('Snoozed for 2 hours', 'It comes back if it still applies.'); DUI.refresh(); return; }
    const dm = e.target.closest('[data-dismiss]');
    if (dm) { DUI.dismiss(dm.dataset.dismiss); return; }
    const pay = e.target.closest('[data-pay]');
    if (pay) { DUI.openPay({ amount: +pay.dataset.pay || 0, orderId: pay.dataset.payorder || null }); return; }
    const no = e.target.closest('[data-neworder]');
    if (no) { DUI.openOrder(no.dataset.neworder || null); return; }
    // Buttons inside a clickable row are matched before the row itself.
    const rc = e.target.closest('[data-rec]');
    if (rc) { DUI.openReceipt(rc.dataset.rec); return; }
    const tk0 = e.target.closest('[data-truck]');
    if (tk0) { e.preventDefault(); DUI.selectTruck(tk0.dataset.truck); return; }
    const od = e.target.closest('[data-order]');
    if (od) { e.preventDefault(); DUI.openOrderDetail(od.dataset.order); return; }
    const tk = e.target.closest('[data-truck]');
    if (tk) { e.preventDefault(); DUI.selectTruck(tk.dataset.truck); return; }
    const ol = e.target.closest('[data-outlet]');
    if (ol && ol.dataset.outlet) { e.preventDefault(); DUI.selectOutlet(ol.dataset.outlet, ol.dataset.tab); return; }
    const gv = e.target.closest('[data-goview]');
    if (gv) DUI.setView(gv.dataset.goview);
  }
  function onKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') {
      if (!$('#palette').classList.contains('hidden')) return closePalette();
      if (DUI.isModalOpen()) return DUI.closeModal();
      if (DUI.state.view !== 'ops') return DUI.setView('ops');
      if (!$('#rightPanel').classList.contains('hidden')) return DUI.closePanel();
    }
  }
  function clock() {
    const d = new Date(Eng.now);
    const sp = Eng.speed > 1 ? ` <span class="c-acc">${Eng.speed}×</span>` : '';
    $('#clock').innerHTML = `<span class="live-dot"></span>${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })} IST${sp}`;
  }
  DUI.setSpeed = function (s) {
    Eng.setSpeed(s);
    $$('#speedSeg button').forEach((x) => x.classList.toggle('active', +x.dataset.speed === s));
    clock();
  };

  DUI.init = function () {
    $('#avatar').textContent = W.dealer.name.split(' ').map((x) => x[0]).join('').slice(0, 2);
    $('#avatar').title = `${W.dealer.name}, dealer since ${W.dealer.since}`;
    $('#scopeSub').textContent = `· ${W.ros.length} outlets`;
    scopeMenu();
    $('#areaSelect').onclick = (e) => { e.stopPropagation(); $('#scopeMenu').classList.toggle('hidden'); };
    $$('#rail button').forEach((b) => b.addEventListener('click', () => DUI.setView(b.dataset.view)));
    $$('[data-basemap]').forEach((b) => b.addEventListener('click', () => MapD.setBasemap(b.dataset.basemap)));
    MapD.onBasemap = (base) => $$('[data-basemap]').forEach((x) => x.classList.toggle('active', x.dataset.basemap === base));
    $$('[data-layer]').forEach((c) => c.addEventListener('change', () => MapD.setLayer(c.dataset.layer, c.checked)));
    $('#btnLayers').addEventListener('click', (e) => { e.stopPropagation(); $('#layersPop').classList.toggle('hidden'); $('#btnLayers').classList.toggle('active'); });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#layersPop') && !e.target.closest('#btnLayers')) { $('#layersPop').classList.add('hidden'); $('#btnLayers').classList.remove('active'); }
      if (!e.target.closest('#scopeMenu') && !e.target.closest('#areaSelect')) $('#scopeMenu').classList.add('hidden');
    });
    $('#btn3d').addEventListener('click', (e) => e.currentTarget.classList.toggle('active', MapD.toggle3D()));
    $('#btnHome').addEventListener('click', () => { DUI.closePanel(); MapD.home(); });
    $('#searchBtn').addEventListener('click', openPalette);
    $$('#speedSeg button').forEach((b) => { b.onclick = () => { DUI.setSpeed(+b.dataset.speed); DUI.toast(`Demo clock at ${b.dataset.speed}×`, +b.dataset.speed > 1 ? 'Watch orders load, travel and arrive.' : 'Back to real time.'); }; });
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
    document.addEventListener('pointerup', () => { pointerDown = false; }, true);
    document.addEventListener('pointercancel', () => { pointerDown = false; }, true);
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') DUI.closeModal(); });
    $('#palette').addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });
    renderLeft();
    clock();
    Eng.on(() => {
      clock();
      MapD.update();
      if (pointerDown) return;
      const v = DUI.state.view;
      if (v === 'ops' || v === 'copilot' || v === 'messages') updateLeft();
      if ((DUI.state.selected || DUI.state.selTruck) && v === 'ops') DUI.Panel.tick();
      if (v !== 'ops') DUI.Views.update(false);
    });
    window.addEventListener('resize', () => MapD.resize());
  };

  window.DUI = DUI;
})();
