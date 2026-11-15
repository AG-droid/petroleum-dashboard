/* =====================================================================
   PRAHARI for dealers — the right-hand panel: one outlet, or one of your trucks
   Same structure as the Sales Officer's outlet panel: a header that says what matters with the
   fix as a button, four key numbers, then tabs.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.DCFG;
  const W = window.DW;
  const { PRODUCTS, HOURLY } = DB;
  const { $, $$, esc, I, fmt, pname, PHEX, STATUS, SEV_DOT, achCls, coverCls } = DUI;
  const U = W.util;
  const TABS = [['overview', 'Overview'], ['sales', 'Sales'], ['supply', 'Supply'], ['integrity', 'Integrity'], ['compliance', 'Compliance']];
  const P = { headSig: '', bodySig: '' };

  const ro = () => W.byId(DUI.state.selected);
  function stage(open) { $('#stage').classList.toggle('right-open', open); $('#rightPanel').classList.toggle('hidden', !open); }

  // ---------- Outlet ----------
  function openOutlet() {
    stage(true);
    $('#rightPanel').innerHTML = `<div class="od-head" id="odHead"></div>
      <div class="kstats">
        <div class="kstat"><div class="l">Sold today</div><div class="v" id="ksToday"></div></div>
        <div class="kstat"><div class="l">Lowest stock</div><div class="v" id="ksStock"></div></div>
        <div class="kstat"><div class="l">This month</div><div class="v" id="ksMonth"></div></div>
        <div class="kstat"><div class="l">Takings</div><div class="v" id="ksTake"></div></div>
      </div>
      <div class="tabs" id="odTabs">${TABS.map(([k, l]) => `<button class="tab ${DUI.state.tab === k ? 'active' : ''}" data-tab-k="${k}">${l}<span class="count hidden" data-tc="${k}"></span></button>`).join('')}</div>
      <div class="p-body" id="odBody" style="padding-top:14px"></div>`;
    $$('#odTabs .tab').forEach((b) => { b.onclick = () => { DUI.state.tab = b.dataset.tabK; $$('#odTabs .tab').forEach((x) => x.classList.toggle('active', x === b)); renderTab(true); }; });
    P.headSig = ''; P.bodySig = '';
    head(); kstats(); renderTab(true);
  }
  function head() {
    const r = ro(); if (!r || !$('#odHead')) return;
    const st = DUI.outletStatus(r);
    const top = st.recs[0];
    const sig = (top ? top.key + top.title + top.action.label : 'ok') + st.recs.length;
    if (sig === P.headSig) return;
    P.headSig = sig;
    $('#odHead').innerHTML = `
      <button class="icon-btn od-close" id="odClose" title="Close">${I.x}</button>
      <div class="od-name">${esc(r.name)}</div>
      <div class="od-meta">${esc(r.locality)}, ${esc(r.road)} · ${esc(r.marketClass)} · RO <span class="mono">${esc(r.id)}</span></div>
      <div class="od-summary"><span class="dot ${top ? SEV_DOT[top.sev] : 'ok'}"></span><span>${top ? esc(top.title) + (st.recs.length > 1 ? ` <span class="faint">+${st.recs.length - 1} more</span>` : '') : 'Running normally. Nothing needs you here right now.'}</span></div>
      <div class="od-actions">${top ? `<button class="btn primary" data-act="${esc(top.key)}">${esc(top.action.label)}</button>` : ''}<button class="btn ${top ? '' : 'primary'}" data-neworder="${esc(r.id)}">${I.truck}Order fuel</button><button class="btn" id="odMsg">${I.msg}Sales Officer</button></div>`;
    $('#odClose').onclick = DUI.closePanel;
    $('#odMsg').onclick = () => DUI.openCompose({ roId: r.id, cat: 'Other', subject: `${r.name} (${r.id})`, text: '' });
    // Tab badges: how many to-dos each tab holds.
    const per = {}; st.recs.forEach((x) => { const t = DUI.tabFor(x); per[t] = (per[t] || 0) + 1; });
    $$('[data-tc]').forEach((el) => { const n = per[el.dataset.tc]; el.textContent = n || ''; el.classList.toggle('hidden', !n); });
  }
  function kstats() {
    const r = ro(); if (!r || !$('#ksToday')) return;
    const m = Eng.metrics(r);
    const low = Object.values(m.byP).sort((a, b) => a.coverDays - b.coverDays)[0];
    const ach = r.products.reduce((a, p) => a + m.mtd[p].L, 0) / Math.max(1, r.products.reduce((a, p) => a + m.mtd[p].targetL, 0));
    $('#ksToday').innerHTML = `${fmt.klv(m.todayL)} <span class="faint" style="font-size:12px;font-weight:400">kL</span>`;
    $('#ksStock').innerHTML = `<span class="${coverCls(low.coverDays)}" title="${esc(pname(low.p))}, usable stock">${fmt.days(low.coverDays)}</span>`;
    $('#ksMonth').innerHTML = `<span class="${achCls(ach)}">${fmt.pct(ach)}</span>`;
    $('#ksTake').innerHTML = `${(m.todayInr / 100000).toFixed(1)} <span class="faint" style="font-size:12px;font-weight:400">lakh</span>`;
  }
  function renderTab(force) {
    const r = ro(), body = $('#odBody');
    if (!r || !body) return;
    const t = DUI.state.tab;
    const html = { overview, sales, supply, integrity, compliance }[t](r);
    if (!force && html === P.bodySig) return;
    const y = body.scrollTop;
    P.bodySig = html;
    body.innerHTML = html;
    body.scrollTop = force ? 0 : y;
    bindBody(r, body);
    if (t === 'sales') requestAnimationFrame(() => drawSales(r));
  }
  function bindBody(r, body) {
    $$('[data-atr]', body).forEach((b) => { b.onclick = () => DUI.openAtr(r.id, b.dataset.atr); });
    $$('[data-renew]', body).forEach((b) => { b.onclick = () => DUI.runAction({ roId: r.id, action: { kind: 'renewal', roId: r.id, key: b.dataset.renew } }); });
    $$('[data-obs]', body).forEach((b) => { b.onclick = () => DUI.runAction({ roId: r.id, action: { kind: 'observation', roId: r.id, index: +b.dataset.obs } }); });
  }

  // ---------- Overview ----------
  function tankRow(r, t) {
    const m = Eng.metrics(r).byP[t.product];
    const days = r.avgDailyL[t.product] > 0 ? (m.usableL / r.avgDailyL[t.product]) : 0;
    const col = days < 1 ? 'var(--crit)' : days < 2 ? 'var(--warn)' : 'var(--text-2)';
    const stale = !t.atgOk || Eng.now - t.readTs > C.atgStaleMin * 60000;
    return `<div class="tankrow"><div class="name">${esc(pname(t.product))}<span>Tank ${esc(t.id.slice(1))}</span></div>
      <div class="right"><span class="${coverCls(days)}">${fmt.days(days)}</span> <span class="faint">usable</span></div>
      ${DUI.tankBar(t.readL, t.capL, t.deadL, col)}
      <div class="sub">${fmt.klv(t.readL)} of ${fmt.klv(t.capL, 0)} kL · ${fmt.klv(t.deadL)} kL can't be sold · water <span class="${t.waterMm > C.waterMaxMm ? 'c-warn' : ''}">${t.waterMm} mm</span> · ${t.tempC}°C${stale ? ' · <span class="c-warn">gauge silent</span>' : ` · read ${fmt.hm(t.readTs)}`}</div></div>`;
  }
  function overview(r) {
    const m = Eng.metrics(r);
    const active = r.nozzles.filter((n) => n.status === 'Dispensing').length;
    const silent = r.nozzles.filter((n) => n.todayL === 0 && (Eng.now - r.book.openTs) / 3600000 >= C.nilSellingHours).length;
    const prices = r.products.map((p) => { const pr = r.prices[p]; const bad = Math.abs(pr.pump - pr.rsp) > 0.005; return `<div class="row-item"><div><b>${esc(pname(p))}</b><small>Notified ₹${pr.rsp.toFixed(2)} from ${esc(fmt.hm(r.priceRevisedTs))}</small></div><span class="${bad ? 'tag crit' : 'tag ok'}">${bad ? 'Pump ₹' + pr.pump.toFixed(2) : 'Pump matches'}</span></div>`; }).join('');
    const recs = DUI.outletStatus(r).recs;
    return `
      <div class="section"><div class="sh"><h4>Tanks</h4><span class="aside">tank gauge every ${C.refresh.atg} min · hatched = dead stock</span></div>${r.tanks.map((t) => tankRow(r, t)).join('')}</div>
      <div class="section"><div class="sh"><h4>Pumps</h4><span class="aside">${active} in use${silent ? ` · <span class="c-crit">${silent} not selling</span>` : ''}</span></div>
        <div class="nozzles">${r.nozzles.map((n) => { const nil = n.todayL === 0 && (Eng.now - r.book.openTs) / 3600000 >= C.nilSellingHours; return `<div class="noz ${n.status === 'Dispensing' ? 'disp' : nil || n.status === 'Dry' ? 'fault' : ''}" title="${esc(n.du)} · ${n.flowLpm} L/min · meter ${Math.round(n.totalizerL).toLocaleString('en-IN')} L"><b>${esc(n.id)}</b>${esc(pname(n.product))}<br>${n.status === 'Dry' ? '<span class="c-crit">Dry</span>' : nil ? '<span class="c-crit">No sale today</span>' : n.status === 'Dispensing' ? '<span class="c-ok">Fuelling</span>' : fmt.klv(n.todayL, 2) + ' kL today'}</div>`; }).join('')}</div></div>
      <div class="section"><div class="sh"><h4>Price board</h4><span class="aside">today's price vs the pump</span></div>${prices}</div>
      <div class="section"><div class="sh"><h4>Recent sales</h4><span class="aside">${esc(fmt.inr(m.todayInr))} today</span></div>
        ${r.txns.length ? `<table class="t compact"><thead><tr><th>Time</th><th>Pump</th><th>Fuel</th><th class="r">Litres</th><th class="r">Amount</th><th>Paid by</th></tr></thead><tbody>${r.txns.slice(0, 6).map((x) => `<tr><td>${esc(fmt.hm(x.ts))}</td><td>${esc(x.nozzle)}</td><td class="l">${esc(pname(x.product))}</td><td class="r">${x.L.toFixed(1)}</td><td class="r l">${esc(fmt.inrFull(x.inr))}</td><td>${esc(x.mode)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Waiting for the next sale…</div>'}</div>
      <div class="section"><div class="sh"><h4>To do here</h4><span class="aside">${recs.length ? recs.length + ' open' : ''}</span></div>${recs.length ? recs.map(DUI.alertRow).join('') : '<div class="empty" style="text-align:left;padding:4px 0">Nothing open.</div>'}</div>`;
  }

  // ---------- Sales ----------
  const slabLabels = () => C.ticketSlabsInr.map((s, i) => (i === 0 ? '≤ ₹100' : s === Infinity ? `> ₹${C.ticketSlabsInr[i - 1].toLocaleString('en-IN')}` : `₹${C.ticketSlabsInr[i - 1].toLocaleString('en-IN')}–${s.toLocaleString('en-IN')}`));
  function sales(r) {
    const m = Eng.metrics(r);
    const mtd = r.products.reduce((a, p) => a + m.mtd[p].L, 0), mtdT = r.products.reduce((a, p) => a + m.mtd[p].targetL, 0);
    const vs = m.expectedL > 50 ? m.todayL / m.expectedL - 1 : 0;
    const near = DB.competitors.filter((c) => DB.util.haversineKm([c.lng, c.lat], [r.lng, r.lat]) < 3);
    const daily = r.products.reduce((a, p) => a + r.avgDailyL[p], 0) / 1000;
    const share = daily / (daily + near.reduce((a, c) => a + c.estDaily, 0));
    return `
      <div class="stats">
        <div class="stat"><div class="stat-label">Sold this month</div><div class="stat-val">${fmt.klv(mtd, 0)}<small>kL</small></div><div class="stat-foot">target so far ${fmt.klv(mtdT, 0)} kL</div></div>
        <div class="stat"><div class="stat-label">Against target</div><div class="stat-val ${achCls(mtd / Math.max(1, mtdT))}">${fmt.pct(mtd / Math.max(1, mtdT))}</div><div class="stat-foot">${r.products.map((p) => `${PRODUCTS[p].name.split(' ')[0]} ${fmt.pct(m.mtd[p].ratio)}`).join(' · ')}</div></div>
        <div class="stat"><div class="stat-label">Today vs usual</div><div class="stat-val ${vs < -0.08 ? 'c-warn' : ''}">${vs >= 0 ? '+' : ''}${(vs * 100).toFixed(1)}%</div><div class="stat-foot">${r.agg.count} sales · avg ${r.agg.count ? (r.agg.L / r.agg.count).toFixed(1) : 0} L</div></div>
        <div class="stat"><div class="stat-label">Local market share</div><div class="stat-val">${fmt.pct(share)}</div><div class="stat-foot">${near.length} competitor${near.length === 1 ? '' : 's'} within 3 km</div></div>
      </div>
      <div class="section"><div class="sh"><h4>Daily sales, last 30 days</h4><span class="aside">kL</span></div><canvas class="chart" id="chSales"></canvas></div>
      <div class="section"><div class="sh"><h4>Today by hour</h4><span class="aside">litres · dashed: your ${C.forecastDays}-day average</span></div><canvas class="chart short" id="chHour"></canvas></div>
      <div class="section"><div class="sh"><h4>Bill size today</h4><span class="aside">number of sales</span></div><canvas class="chart" id="chSlab" style="height:190px"></canvas></div>
      <div class="section"><div class="sh"><h4>Vehicles today</h4><span class="aside">estimated from litres per sale</span></div><canvas class="chart short" id="chVeh"></canvas></div>
      <div class="section"><div class="sh"><h4>How customers paid</h4></div><canvas class="chart short" id="chPay"></canvas></div>
      <span hidden>${r.agg.count}</span>`;
  }
  function drawSales(r) {
    if (!$('#chSales')) return;
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const hist = r.hist.slice(-30);
    const target = r.products.reduce((a, p) => a + r.targetMonthL[p] / 30, 0) / 1000;
    Charts.line($('#chSales'), { labels: hist.map((h) => +h.date.slice(8) + ' ' + MON[+h.date.slice(5, 7) - 1]), series: [{ data: hist.map((h) => h.total / 1000), color: '#7aa7ff', label: 'Sold', fill: true }, { data: hist.map(() => target), color: '#6e737a', label: 'Target', dash: [3, 4], width: 1.2 }], yFmt: (v) => v.toFixed(0) });
    const hours = Array.from({ length: 24 }, (_, k) => (C.openingHour + k) % 24);
    const upto = hours.indexOf(U.istHour(Eng.now));
    Charts.line($('#chHour'), { labels: hours.map((h) => String(h).padStart(2, '0')), series: [
      { data: hours.map((h) => r.products.reduce((s, p) => s + r.avgDailyL[p] * HOURLY[h], 0)), color: '#6e737a', dash: [4, 4], label: 'Usual' },
      { data: hours.slice(0, Math.max(1, upto)).map((h) => r.products.reduce((s, p) => s + r.hourly[h][p], 0)), color: '#ecedee', label: 'Today', fill: true }], yFmt: (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) });
    const sl = slabLabels();
    Charts.bars($('#chSlab'), { horizontal: true, labelWidth: 100, items: r.agg.slabs.map((n, i) => ({ label: sl[i], value: n, color: '#7aa7ff' })), fmt: (x) => String(Math.round(x)) });
    Charts.bars($('#chVeh'), { horizontal: true, labelWidth: 100, items: Object.entries(r.agg.vehicles).map(([k, n]) => ({ label: k, value: n, color: '#a48bf0' })), fmt: (x) => String(Math.round(x)) });
    const modes = Object.entries(r.agg.modes).filter(([, n]) => n > 0);
    Charts.donut($('#chPay'), { items: modes.map(([k, n], i) => ({ label: k, value: n, color: ['#7aa7ff', '#57b583', '#e0a645', '#a48bf0'][i % 4] })), center: String(r.agg.count), centerSub: 'sales' });
  }

  // ---------- Supply ----------
  function deliveryBox(r) {
    const o = W.orders.find((x) => x.roId === r.id && ['loading', 'in_transit', 'unloading'].includes(x.status));
    if (o) {
      return `<div class="info-box"><div style="display:flex;justify-content:space-between;align-items:center"><b>${esc(o.truck.plate)}</b><span class="status acc">${esc(STATUS[o.status][0])}</span></div>
        <div class="progress"><i style="width:${o.status === 'loading' ? 3 : DUI.progress(o) * 100}%"></i></div>
        <div class="kv"><span>Order</span><div>${esc(o.id)} · ${esc(DUI.lineText(o.lines))}</div><span>From</span><div>${esc(DB.depotById(o.depotId).name)}</div><span>Next</span><div>${esc(DUI.nextStep(o))}</div><span>Driver</span><div>${esc(o.truck.driver)} · ${esc(o.truck.transporter)}</div>${o.invoice ? `<span>Invoice</span><div class="mono">${esc(o.invoice.no)}</div>` : ''}</div>
        <div style="margin-top:12px;display:flex;gap:6px"><button class="btn sm ghost" data-truck="${esc(o.id)}">${I.pin}Track on map</button><button class="btn sm ghost" data-order="${esc(o.id)}">Order details</button></div></div>`;
    }
    const w = W.orders.find((x) => x.roId === r.id && (x.status === 'awaiting_payment' || x.status === 'placed'));
    if (w) {
      const still = Eng.stillToPay(w);
      return `<div class="info-box"><div style="display:flex;justify-content:space-between;align-items:center"><b>${esc(w.id)}</b><span class="status ${STATUS[w.status][1]}">${esc(STATUS[w.status][0])}</span></div>
        <div class="muted" style="margin-top:4px">${esc(DUI.lineText(w.lines))} on a ${w.truckKL} KL truck · ${esc(fmt.inr(w.value))}</div><div class="muted">${esc(DUI.nextStep(w))}</div>
        <div style="margin-top:12px;display:flex;gap:6px">${w.status === 'awaiting_payment' && still > 0 ? `<button class="btn sm primary" data-pay="${Math.ceil(still)}" data-payorder="${esc(w.id)}">${I.pay}Pay ${esc(fmt.inr(still))}</button>` : ''}<button class="btn sm ghost" data-order="${esc(w.id)}">Order details</button></div></div>`;
    }
    const s = Eng.suggest(r);
    return `<div class="info-box"><b>No delivery on the way</b><div class="muted" style="margin-top:3px">${s ? `Suggested: ${esc(DUI.lineText(s.lines))} on a ${s.truckKL} KL truck (${esc(fmt.inr(s.value))}), arriving ${esc(fmt.when(s.plan.usableTs))} if ordered now.` : 'Stock is fine for the next few days.'}</div>
      <div style="margin-top:12px"><button class="btn sm ${s ? 'primary' : ''}" data-neworder="${esc(r.id)}">${I.truck}${s ? 'Review and order' : 'Order fuel'}</button></div></div>`;
  }
  function supply(r) {
    const m = Eng.metrics(r);
    const cover = r.products.map((p) => {
      const pm = m.byP[p];
      const col = pm.coverDays < 1 ? 'var(--crit)' : pm.coverDays < 2 ? 'var(--warn)' : 'var(--text-2)';
      return `<div class="tankrow"><div class="name">${esc(pname(p))}</div><div class="right"><span class="${coverCls(pm.coverDays)}">${fmt.days(pm.coverDays)}</span> <span class="faint">· ${fmt.klv(pm.usableL)} kL usable</span></div>
        <div class="bar"><i style="width:${Math.min(100, pm.coverDays / 5 * 100)}%;background:${col}"></i></div>
        <div class="sub">Runs dry ${esc(fmt.when(pm.dryTs))}${pm.incoming.length ? ` · with orders ${esc(fmt.when(pm.dryWithOrdersTs))}` : ''}${pm.simpleCoverDays != null && pm.simpleCoverDays > pm.coverDays * 1.3 ? ` · <span title="usable stock ÷ today's sales so far, as many reports compute it">simple method says ${fmt.days(pm.simpleCoverDays)}</span>` : ''}</div></div>`;
    }).join('');
    const book = r.products.map((p) => {
      const open = r.book.openL[p], rec = r.book.receiptL[p], close = m.byP[p].stockL, noz = r.book.nozzleAtReadL[p];
      const tank = open + rec - close, diff = tank - noz, pct = noz > 0 ? diff / noz * 100 : 0;
      const bad = Math.abs(pct) > C.variationPct && noz > 500;
      return `<tr><td class="l">${esc(pname(p))}</td><td class="r">${fmt.klv(open, 2)}</td><td class="r">${rec ? fmt.klv(rec, 2) : '—'}</td><td class="r">${fmt.klv(close, 2)}</td><td class="r">${fmt.klv(tank, 2)}</td><td class="r">${fmt.klv(noz, 2)}</td><td class="r ${bad ? 'c-crit' : ''}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</td></tr>`;
    }).join('');
    const orders = W.orders.filter((o) => o.roId === r.id && o.invoice).slice(0, 6);
    return `
      <div class="section"><div class="sh"><h4>Next delivery</h4></div>${deliveryBox(r)}</div>
      <div class="section"><div class="sh"><h4>Stock left</h4><span class="aside">usable stock at the usual pace</span></div>${cover}</div>
      <div class="section"><div class="sh"><h4>Recent deliveries</h4></div>
        <table class="t compact"><thead><tr><th>Date</th><th>Fuel</th><th class="r">kL</th><th class="r">Short</th><th>Status</th></tr></thead><tbody>${orders.flatMap((o) => o.lines.map((l, i) => {
          const got = o.receipt ? o.receipt.lines.find((x) => x.product === l.product).receivedL : o.atgReceivedL ? o.atgReceivedL[l.product] : null;
          const short = got == null ? null : l.kl * 1000 - got;
          const bad = short != null && short > l.kl * 1000 * C.transitLossFraction;
          return `<tr ${i === 0 ? `class="row" data-order="${esc(o.id)}"` : ''}><td>${i === 0 ? esc(fmt.dmy(o.invoice.ts)) : ''}</td><td class="l">${esc(pname(l.product))}</td><td class="r">${l.kl}</td><td class="r ${bad ? 'c-crit' : ''}">${short == null ? '—' : Math.round(short) + ' L'}</td><td>${i === 0 ? (o.status === 'awaiting_receipt' ? `<button class="btn sm" data-rec="${esc(o.id)}">Confirm</button>` : `<span class="status ${STATUS[o.status][1]}">${esc(STATUS[o.status][0])}</span>`) : ''}</td></tr>`;
        })).join('')}</tbody></table></div>
      <div class="section"><div class="sh"><h4>Stock book today</h4><span class="aside">kL · allowed ±${C.variationPct}%</span></div>
        <table class="t compact"><thead><tr><th>Fuel</th><th class="r">Opening</th><th class="r">In</th><th class="r">Reading</th><th class="r">Tank sale</th><th class="r">Nozzles</th><th class="r">Gap</th></tr></thead><tbody>${book}</tbody></table>
        <div class="faint" style="font-size:11.5px;margin-top:6px">Tank sale = opening dip (${esc(fmt.hm(r.book.openTs))}) + receipts − latest gauge reading, against what the nozzles had sold by then. A gap above the limit for days points to a leak, a meter fault or pilferage.</div></div>`;
  }

  // ---------- Integrity ----------
  function integrity(r) {
    const m = Eng.metrics(r);
    const checks = [];
    r.products.forEach((p) => {
      const pr = r.prices[p];
      const bad = Math.abs(pr.pump - pr.rsp) > 0.005;
      const presets = r.nozzles.filter((n) => n.product === p && !n.presetOk).map((n) => n.id);
      checks.push([bad || presets.length ? 'crit' : 'ok', `Price and presets: ${pname(p)}`, bad ? `Pump ₹${pr.pump.toFixed(2)}, notified ₹${pr.rsp.toFixed(2)}${presets.length ? '; old presets on ' + presets.join(', ') : ''}` : presets.length ? `Old presets on ${presets.join(', ')}` : `₹${pr.rsp.toFixed(2)} everywhere`]);
    });
    const hoursOpen = (Eng.now - r.book.openTs) / 3600000;
    const nil = r.nozzles.filter((n) => n.todayL === 0 && hoursOpen >= C.nilSellingHours);
    checks.push([nil.length ? 'crit' : 'ok', 'Nozzles not selling', nil.length ? nil.map((n) => `${n.id} (${n.du})`).join(', ') + ` since ${fmt.hm(r.book.openTs)}` : 'Every nozzle has sold today']);
    const slow = r.nozzles.filter((n) => { const peers = r.nozzles.filter((x) => x.product === n.product && x !== n); if (!peers.length) return false; const a = peers.reduce((s, x) => s + x.flowLpm, 0) / peers.length; return (a - n.flowLpm) / a * 100 >= C.flowVariancePct; });
    checks.push([slow.length ? 'warn' : 'ok', 'Flow-rate variance', slow.length ? slow.map((n) => `${n.id} ${n.flowLpm} L/min`).join(', ') : `All within ${C.flowVariancePct}% of their peers`]);
    const wet = r.tanks.filter((t) => t.waterMm > C.waterMaxMm);
    checks.push([wet.length ? 'warn' : 'ok', 'Water in tanks', wet.length ? wet.map((t) => `${t.id} ${t.waterMm} mm`).join(', ') : `All below ${C.waterMaxMm} mm`]);
    const stale = r.tanks.filter((t) => !t.atgOk || Eng.now - t.readTs > C.atgStaleMin * 60000);
    checks.push([stale.length ? 'warn' : 'ok', 'Tank gauges', stale.length ? stale.map((t) => t.id).join(', ') + ' not reporting' : 'All reporting']);
    const worst = Math.max(0, ...r.products.map((p) => { const noz = r.book.nozzleAtReadL[p]; const tank = r.book.openL[p] + r.book.receiptL[p] - m.byP[p].stockL; return noz > 500 ? Math.abs(tank - noz) / noz * 100 : 0; }));
    checks.push([worst > C.variationPct ? 'crit' : 'ok', 'Stock reconciliation', `Largest gap ${worst.toFixed(2)}% (allowed ${C.variationPct}%)`]);
    const logs = r.logs.slice().sort((a, b) => b.ts - a.ts);
    return `
      <div class="sh"><h4>Checks right now</h4><span class="aside">the same checks the oil company runs</span></div>
      ${checks.map(([s, l, d]) => `<div class="row-item"><div><b>${esc(l)}</b><small>${esc(d)}</small></div><span class="status ${s}">${s === 'ok' ? 'OK' : s === 'warn' ? 'Check' : 'Act now'}</span></div>`).join('')}
      <div class="section"><div class="sh"><h4>Dispenser events</h4><span class="aside">critical ones need an action-taken report</span></div>
      ${logs.length ? logs.map((l) => `<div class="row-item" style="align-items:flex-start"><div><b>${esc(l.type)} · ${esc(l.du)}</b><small>${esc(fmt.when(l.ts))} · ${esc(l.text)}</small>${l.atr ? `<small style="color:var(--text-2);margin-top:4px">Report filed ${esc(fmt.when(l.atr.ts))}: ${esc(l.atr.text)}</small>` : ''}</div>${l.critical ? (l.atr ? '<span class="tag ok">Report filed</span>' : `<button class="btn sm primary" data-atr="${esc(l.id)}">Write report</button>`) : '<span class="tag">Info</span>'}</div>`).join('') : '<div class="faint" style="padding:4px 0">No events.</div>'}</div>`;
  }

  // ---------- Compliance ----------
  function compliance(r) {
    const items = r.compliance.slice().sort((a, b) => a.due - b.due);
    return `
      <div class="sh"><h4>Licences &amp; certificates</h4><span class="aside">reminders ${C.complianceWarnDays} days ahead</span></div>
      ${items.map((c) => { const d = Math.ceil((c.due - Eng.now) / 86400000); return `<div class="row-item"><div><b>${esc(c.label)}</b><small>${d < 0 ? 'Expired' : 'Valid until'} ${esc(fmt.date(c.due))}${c.booked ? ' · renewal booked for ' + esc(fmt.date(c.booked.for)) : ''}</small></div>${!c.booked && d <= C.complianceWarnDays ? `<button class="btn sm ${d <= C.complianceUrgentDays ? 'primary' : ''}" data-renew="${esc(c.key)}">Book · ${d} days</button>` : `<span class="tag ${d <= C.complianceUrgentDays ? 'crit' : d <= C.complianceWarnDays ? 'warn' : 'ok'}">${d} days left</span>`}</div>`; }).join('')}
      <div class="section"><div class="sh"><h4>Inspection observations</h4></div>
      ${r.observations.length ? r.observations.map((o, i) => `<div class="row-item"><div><b>${esc(o.text)}</b><small>Raised ${esc(fmt.date(o.ts))}${o.proof ? ' · closed ' + esc(fmt.date(o.proof.ts)) : ''}</small></div>${o.status === 'Open' ? `<button class="btn sm" data-obs="${i}">${I.check}Mark fixed</button>` : '<span class="tag ok">Closed</span>'}</div>`).join('') : '<div class="faint" style="padding:4px 0">None.</div>'}</div>
      <div class="section"><div class="sh"><h4>Inspection history</h4></div>
      <table class="t compact"><tbody>${r.inspections.map((x) => `<tr><td>${esc(fmt.date(x.ts))}</td><td class="l">${esc(x.type)}</td><td>${esc(x.by)}</td><td class="r"><span class="status ${x.result === 'Satisfactory' ? 'ok' : 'warn'}">${esc(x.result)}</span></td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------- Truck ----------
  function openTruck() {
    stage(true);
    P.headSig = ''; P.bodySig = '';
    drawTruck(true);
  }
  function drawTruck(force) {
    const o = W.orderById(DUI.state.selTruck);
    if (!o) return;
    const r = W.byId(o.roId), d = DB.depotById(o.depotId);
    const moving = ['loading', 'in_transit', 'unloading'].includes(o.status);
    const html = `<div class="od-head"><button class="icon-btn od-close" id="tkClose">${I.x}</button>
      <div class="od-name">${esc(o.truck ? o.truck.plate : o.id)}</div><div class="od-meta">Tank truck · ${o.truckKL} KL${o.truck ? ' · ' + esc(o.truck.transporter) : ''} · order <span class="mono">${esc(o.id)}</span></div>
      <div class="od-summary"><span class="dot ${moving ? 'ok' : o.status === 'awaiting_receipt' ? 'warn' : 'off'}"></span><span>${esc(STATUS[o.status][0])}. ${esc(DUI.nextStep(o))}.</span></div>
      <div class="od-actions">${o.truck ? `<button class="btn primary" id="tkCall">${I.phone}Call driver</button>` : ''}<button class="btn" data-outlet="${esc(r.id)}" data-tab="supply">Destination outlet</button><button class="btn" data-order="${esc(o.id)}">Order details</button>${o.status === 'awaiting_receipt' ? `<button class="btn primary" data-rec="${esc(o.id)}">Confirm receipt</button>` : ''}</div></div>
      <div class="p-body" style="border-top:1px solid var(--border);padding-top:16px">
        <div class="kv"><span>Route</span><div>${esc(d.name)} → ${esc(r.name)}</div><span>Distance</span><div>${r.route.km.toFixed(1)} km · about ${Math.round(r.routeMin)} min driving</div>${r.route.via && r.route.via.length ? `<span>Via</span><div>${esc(r.route.via.slice(0, 2).join(', '))}</div>` : ''}
          <span>Carrying</span><div>${esc(DUI.lineText(o.lines))}</div>${o.truck ? `<span>Driver</span><div>${esc(o.truck.driver)}</div>` : ''}${o.invoice ? `<span>Invoice</span><div class="mono">${esc(o.invoice.no)}</div>` : ''}<span>Value</span><div>${esc(fmt.inrFull(o.value))}</div></div>
        <div class="progress" style="margin-top:16px"><i style="width:${DUI.progress(o) * 100}%"></i></div>
        <div class="section"><div class="sh"><h4>Trip log</h4></div>
          ${[['Order placed', o.createdTs], ['Released to the supply point', o.releasedTs], ['Loading started', o.status !== 'placed' ? o.loadStartTs : null], ['Left the supply point, invoice raised', o.dispatchTs], ['Arrived at the outlet', ['unloading', 'awaiting_receipt', 'received', 'claim_raised'].includes(o.status) ? o.arriveTs : null], ['Unloaded', o.unloadedTs]].filter(([, ts]) => ts && ts <= Eng.now).map(([t, ts]) => `<div class="note"><small>${esc(fmt.dt(ts))}</small>${esc(t)}</div>`).join('')}
          ${o.status === 'in_transit' ? `<div class="note"><small>now</small>On the planned route, ${Math.round(DUI.progress(o) * 100)}% of the way</div>` : ''}</div></div>`;
    if (!force && html === P.bodySig) return;
    P.bodySig = html;
    $('#rightPanel').innerHTML = html;
    $('#tkClose').onclick = DUI.closePanel;
    const call = $('#tkCall'); if (call) call.onclick = () => DUI.toast(`Calling ${o.truck.driver}`, `${o.truck.plate} · demo, no call is made`);
  }

  DUI.Panel = {
    openOutlet, openTruck,
    redraw() { if (DUI.state.selected) { P.headSig = ''; head(); kstats(); renderTab(false); } else if (DUI.state.selTruck) drawTruck(true); },
    tick() {
      if (DUI.state.selected) {
        head(); kstats();
        // Keep keyboard focus and charts steady: no redraw while focus is in the panel body;
        // the Sales tab's charts redraw at most every 10 seconds of real time.
        const a = document.activeElement;
        if (a && $('#odBody') && $('#odBody').contains(a)) return;
        if (DUI.state.tab === 'sales' && Date.now() - (P.lastSales || 0) < 10000) return;
        P.lastSales = Date.now();
        renderTab(false);
      }
      else if (DUI.state.selTruck) drawTruck(false);
    },
  };
})();
