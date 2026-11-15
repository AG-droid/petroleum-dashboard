/* =====================================================================
   PRAHARI for dealers — full views (overlays over the map), as in the Sales Officer dashboard:
   Outlets · Orders & trucks · Account & payments · Compliance · Performance · Messages · Assistant
   ===================================================================== */
(function () {
  'use strict';
  const C = window.DCFG;
  const W = window.DW;
  const { PRODUCTS, HOURLY } = DB;
  const { $, $$, esc, I, fmt, pname, PCOLOR, STATUS, ST_TXT, achCls, coverCls } = DUI;
  const V = { cur: null, sig: '' };

  function head(title, sub, extra) {
    return `<div class="ov-head"><div class="grow"><div class="p-title">${esc(title)}</div>${sub ? `<div class="p-sub">${sub}</div>` : ''}</div>${extra || ''}<button class="icon-btn" data-close title="Close">${I.x}</button></div>`;
  }
  const summaryRow = (items) => `<div class="summary-row">${items.map(([l, v, c]) => `<div><div class="l">${esc(l)}</div><div class="v ${c || ''}">${v}</div></div>`).join('')}</div>`;
  const asOf = () => `<span class="asof" title="Tank gauges every ${C.refresh.atg} min · pump sales every ${C.refresh.sales} min · invoices every ${C.refresh.invoices / 60} h">Data as on ${esc(fmt.dt(Eng.lastSync('atg')))}</span>`;

  // ---------- Outlets: every product side by side ----------
  function outlets() {
    const rows = [];
    DUI.scopeRos().forEach((r) => {
      const m = Eng.metrics(r);
      const st = DUI.outletStatus(r);
      const crit = r.logs.filter((l) => l.critical && !l.atr).length;
      const first = r.txns.length ? r.txns.reduce((a, t) => Math.min(a, t.ts), Infinity) : null;
      r.products.forEach((p, i) => {
        const pm = m.byP[p];
        const mis = Math.abs(pm.pump - pm.rsp) > 0.005;
        const preset = r.nozzles.some((n) => n.product === p && !n.presetOk);
        rows.push(`<tr class="row" data-outlet="${esc(r.id)}">
          <td class="l">${i === 0 ? `${esc(r.name)}<span class="sub-id">RO ${esc(r.id)} · ${esc(r.marketClass)}</span>` : ''}</td>
          <td>${i === 0 ? `<span class="status ${st.worst}">${st.text}</span>` : ''}</td>
          <td><span class="pname"><i style="background:${PCOLOR[p]}"></i>${esc(pname(p))}</span></td>
          <td class="r">${fmt.klv(r.targetMonthL[p] / 30, 1)}</td><td class="r">${fmt.klv(pm.todayL, 2)}</td>
          <td class="r">${fmt.klv(pm.usableL, 1)}<span class="sub-id">+ ${fmt.klv(pm.deadL, 1)} dead</span></td>
          <td class="r">${pm.pendingL ? fmt.klv(pm.pendingL, 0) : '—'}</td><td class="r">${pm.onWheelsL ? fmt.klv(pm.onWheelsL, 0) : '—'}</td>
          <td class="r ${coverCls(pm.coverDays)}">${fmt.days(pm.coverDays)}</td>
          <td>${mis ? `<span class="tag crit">₹${pm.pump.toFixed(2)}</span>` : '<span class="tag ok">OK</span>'}${preset ? ' <span class="tag warn">Preset</span>' : ''}</td>
          <td class="r">${i === 0 ? (crit ? `<span class="tag crit">${crit}</span>` : '0') : ''}</td>
          <td>${i === 0 && first ? esc(fmt.hm(first)) + ' / ' + esc(fmt.hm(r.txns[0].ts)) : ''}</td></tr>`);
      });
    });
    return {
      cls: 'w-half',
      html: head('Your outlets', `${DUI.scopeRos().length} retail outlets · ${esc(DB.meta.salesArea)}`, asOf()) + `<div class="ov-body">
        <div class="table-scroll"><table class="t"><thead><tr><th>Outlet</th><th>Status</th><th>Fuel</th><th class="r">Target/day kL</th><th class="r">Sold today kL</th><th class="r">Usable stock kL</th><th class="r">Ordered</th><th class="r">On the road</th><th class="r">Cover</th><th>Price</th><th class="r">Critical logs</th><th>First / last sale</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
        <div class="faint" style="font-size:12px;margin-top:10px">Usable stock excludes dead stock (fuel below the suction pipe). Cover uses your last ${C.forecastDays} days' sales and the time of day.</div></div>`,
    };
  }

  // ---------- Orders & trucks ----------
  function logistics() {
    const ros = DUI.scopeRos(), ids = new Set(ros.map((r) => r.id));
    const list = W.orders.filter((o) => ids.has(o.roId));
    const n = (s) => list.filter((o) => s.includes(o.status)).length;
    const week = list.filter((o) => o.unloadedTs && Eng.now - o.unloadedTs < 7 * 86400000).length;
    const money = Eng.money();
    const sugg = [];
    const pipe = [];
    ros.forEach((r) => {
      const m = Eng.metrics(r);
      r.products.forEach((p, i) => {
        const pm = m.byP[p];
        pipe.push(`<tr class="row" data-outlet="${esc(r.id)}" data-tab="supply"><td class="l">${i === 0 ? esc(r.name) : ''}</td><td>${esc(pname(p))}</td><td class="r">${fmt.klv(pm.usableL, 1)}</td><td class="r">${pm.pendingL ? fmt.klv(pm.pendingL, 0) : '—'}</td><td class="r">${pm.onWheelsL ? fmt.klv(pm.onWheelsL, 0) : '—'}</td><td class="r ${pm.dryTs && pm.dryTs - Eng.now < 86400000 ? 'c-crit' : ''}">${esc(fmt.when(pm.dryTs))}</td><td class="r ${pm.dryWithOrdersTs && pm.dryWithOrdersTs - Eng.now < 86400000 ? 'c-crit' : ''}">${pm.incoming.length ? esc(fmt.when(pm.dryWithOrdersTs)) : '—'}</td></tr>`);
      });
      const open = W.orders.some((o) => o.roId === r.id && (o.status === 'awaiting_payment' || o.status === 'placed'));
      const s = !open && Eng.suggest(r);
      if (s && m.soonest && m.soonest.dryWithOrdersTs - Eng.now < 4 * 86400000) {
        sugg.push(`<div class="card"><div class="card-title">Suggested for ${esc(r.name)}</div><div class="card-sub">${esc(DUI.lineText(s.lines))} on a ${s.truckKL} KL truck · ${esc(fmt.inr(s.value))}</div>
          <div class="muted" style="font-size:12.5px">${esc(pname(m.soonest.p))} runs dry ${esc(fmt.when(m.soonest.dryWithOrdersTs))}. Ordered now it arrives ${esc(fmt.when(s.plan.usableTs))}.</div>
          <div style="margin-top:10px"><button class="btn sm primary" data-neworder="${esc(r.id)}">${I.truck}Review and order</button></div></div>`);
      }
    });
    return {
      cls: 'w-half',
      html: head('Orders & trucks', `Available balance ${esc(fmt.inrFull(money.available))}${money.pending ? ` · ${esc(fmt.inrFull(money.pending))} on its way` : ''}`, `<button class="btn sm" data-pay="0">${I.plus}Add money</button><button class="btn sm primary" data-neworder="">${I.truck}New order</button>`) + `<div class="ov-body">
        ${summaryRow([['Waiting for payment', n(['awaiting_payment']), n(['awaiting_payment']) ? 'c-warn' : ''], ['Released', n(['placed'])], ['Loading', n(['loading'])], ['On the road', n(['in_transit', 'unloading'])], ['To confirm', n(['awaiting_receipt']), n(['awaiting_receipt']) ? 'c-warn' : ''], ['Delivered this week', week]])}
        ${sugg.length ? `<div class="grid-2" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-bottom:6px">${sugg.join('')}</div>` : ''}
        <div class="block-title">Supply pipeline</div>
        <table class="t"><thead><tr><th>Outlet</th><th>Fuel</th><th class="r">Usable kL</th><th class="r">Ordered</th><th class="r">On the road</th><th class="r">Runs dry</th><th class="r">With orders</th></tr></thead><tbody>${pipe.join('')}</tbody></table>
        <div class="block-title">Orders</div>
        <table class="t"><thead><tr><th>Order</th><th>Outlet</th><th>Load</th><th class="r">Value</th><th>Status</th><th>Next</th><th></th></tr></thead><tbody>
        ${list.map((o) => `<tr class="row" data-order="${esc(o.id)}"><td class="l mono">${esc(o.id)}</td><td>${esc(DUI.rname(o.roId))}</td><td>${esc(DUI.lineText(o.lines))}</td><td class="r">${esc(fmt.inr(o.value))}</td><td><span class="status ${STATUS[o.status][1]}">${esc(STATUS[o.status][0])}</span></td><td class="faint">${esc(DUI.nextStep(o))}</td><td class="r">${['loading', 'in_transit', 'unloading'].includes(o.status) ? `<span class="text-btn" data-truck="${esc(o.id)}">Track</span>` : ''}</td></tr>`).join('')}</tbody></table>
        <div class="block-title">Supply points</div>
        <div class="grid-2" style="grid-template-columns:1fr 1fr">${[...new Set(ros.map((r) => r.depotId))].map((id) => { const d = DB.depotById(id); return `<div class="card"><div class="card-title">${esc(d.name)}</div><div class="card-sub">Serves ${ros.filter((r) => r.depotId === id).map((r) => esc(r.name)).join(', ')}</div><div class="kv" style="grid-template-columns:120px 1fr"><span>Loading hours</span><div>${String(C.depotOpenHour).padStart(2, '0')}:00–${C.depotCloseHour}:00</div><span>Order cut-off</span><div>${C.indentCutoffHour}:00 for same-day loading</div><span>Drive time</span><div>${ros.filter((r) => r.depotId === id).map((r) => Math.round(r.routeMin) + ' min').join(', ')}</div></div></div>`; }).join('')}</div>
      </div>`,
    };
  }

  // ---------- Account & payments ----------
  function account() {
    const money = Eng.money();
    let bal = 0;
    const ledger = W.ledger.slice().sort((a, b) => a.ts - b.ts).map((e) => { bal += e.credit - e.debit; return Object.assign({ bal }, e); }).reverse();
    const k = C.collection;
    return {
      cls: 'w-half',
      html: head('Account & payments', `${esc(W.dealer.name)} · dealer account ${esc(W.dealer.code)} · prepaid balance with the oil company`, `<button class="btn sm primary" data-pay="0">${I.plus}Add money</button>`) + `<div class="ov-body">
        ${summaryRow([['Balance', esc(fmt.inrFull(money.balance))], ['Held for released orders', esc(fmt.inrFull(money.blocked))], ['Available for orders', esc(fmt.inrFull(money.available)), money.available < 0 ? 'c-crit' : ''], ['On its way', esc(fmt.inrFull(money.pending)), money.pending ? 'c-warn' : '']])}
        <div class="grid-2 acct-grid">
          <div class="card"><div class="card-title">Your collection account</div><div class="card-sub">Pay by RTGS or NEFT from your bank, then record the UTR</div>
            <div class="copy"><span>Name</span><b style="font-family:var(--sans);text-align:right">${esc(k.name)}</b></div><div class="copy"><span>Account</span><b>${esc(k.account)}</b></div><div class="copy"><span>IFSC</span><b>${esc(k.ifsc)}</b></div><div class="copy"><span>Bank</span><b style="font-family:var(--sans)">${esc(k.bank)}</b></div>
            <div class="safe-note">${I.shield}<span>Prahari never holds or moves money. (Demo account details.)</span></div></div>
          <div class="card"><div class="card-title">Payments</div><div class="card-sub">Recorded by you, matched when the bank credit arrives</div>
            <table class="t compact"><thead><tr><th>Sent</th><th>Mode</th><th>UTR</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>${W.payments.map((p) => `<tr><td>${esc(fmt.dt(p.ts))}</td><td>${esc(p.mode)}</td><td class="mono">${esc(p.utr)}</td><td class="r">${esc(fmt.inrFull(p.amount))}</td><td><span class="status ${p.status === 'credited' ? 'ok' : 'warn'}">${p.status === 'credited' ? 'Credited' : 'On its way'}</span></td></tr>`).join('')}</tbody></table></div>
        </div>
        <div class="block-title">Ledger</div>
        <table class="t"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Outlet</th><th>Details</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>
        ${ledger.filter((e) => DUI.inScope(e.roId)).map((e) => `<tr><td>${esc(fmt.dmy(e.ts))}</td><td class="l">${esc(e.type)}</td><td class="mono">${esc(e.ref)}</td><td>${e.roId ? esc(e.roId) : '—'}</td><td class="faint">${esc(e.note)}</td><td class="r">${e.debit ? esc(fmt.inrFull(e.debit)) : ''}</td><td class="r c-ok">${e.credit ? esc(fmt.inrFull(e.credit)) : ''}</td><td class="r">${esc(fmt.inrFull(e.bal))}</td></tr>`).join('')}</tbody></table>
        <div class="block-title" style="display:flex;justify-content:space-between;align-items:center">Invoices<button class="btn sm" id="csvBtn">${I.download}Download CSV</button></div>
        <table class="t"><thead><tr><th>RO code</th><th>Outlet</th><th>Class of market</th><th>Product</th><th>Invoice no</th><th>Invoice date</th><th class="r">Quantity (L)</th></tr></thead><tbody>
        ${DUI.invoiceRows().map((x) => `<tr class="row" data-order="${esc(x.o.id)}"><td>${esc(x.ro.id)}</td><td class="l">${esc(x.ro.name)}</td><td>${esc(x.ro.marketClass)}</td><td>${esc(x.l.product)}</td><td class="mono">${esc(x.o.invoice.no)}</td><td>${esc(fmt.dmy(x.o.invoice.ts))}</td><td class="r">${x.qtyL.toLocaleString('en-IN')}</td></tr>`).join('')}</tbody></table>
      </div>`,
      bind: (ov) => { $('#csvBtn', ov).onclick = DUI.downloadCsv; },
    };
  }

  // ---------- Compliance ----------
  function compliance() {
    const items = [];
    DUI.scopeRos().forEach((r) => r.compliance.forEach((c) => items.push({ r, c, d: Math.ceil((c.due - Eng.now) / 86400000) })));
    items.sort((a, b) => a.d - b.d);
    const obs = [];
    DUI.scopeRos().forEach((r) => r.observations.forEach((o, i) => obs.push({ r, o, i })));
    const insp = [];
    DUI.scopeRos().forEach((r) => r.inspections.forEach((x) => insp.push({ r, x })));
    insp.sort((a, b) => b.x.ts - a.x.ts);
    const soon = items.filter((x) => x.d <= C.complianceWarnDays && !x.c.booked).length;
    return {
      cls: 'w-half',
      html: head('Compliance', 'Licences, stamping and certificates for your outlets, with inspection follow-ups') + `<div class="ov-body">
        ${summaryRow([['Due within 30 days', soon, soon ? 'c-warn' : ''], ['Renewals booked', items.filter((x) => x.c.booked).length], ['Open observations', obs.filter((x) => x.o.status === 'Open').length, obs.some((x) => x.o.status === 'Open') ? 'c-warn' : ''], ['Last inspection', insp[0] ? esc(fmt.date(insp[0].x.ts)) : '—']])}
        <div class="block-title">Licences and certificates</div>
        <table class="t"><thead><tr><th>Outlet</th><th>Item</th><th>Expires</th><th class="r">Time left</th><th></th></tr></thead><tbody>${items.map((x) => `<tr><td class="l">${esc(x.r.name)}</td><td>${esc(x.c.label)}</td><td>${esc(fmt.date(x.c.due))}</td><td class="r"><span class="tag ${x.d <= C.complianceUrgentDays ? 'crit' : x.d <= C.complianceWarnDays ? 'warn' : 'ok'}">${x.d} days</span></td><td class="r">${x.c.booked ? `<span class="faint">Booked ${esc(fmt.date(x.c.booked.for))}</span>` : x.d <= C.complianceWarnDays ? `<span class="text-btn" data-renew="${esc(x.r.id)}|${esc(x.c.key)}">Book renewal</span>` : ''}</td></tr>`).join('')}</tbody></table>
        <div class="block-title">Inspection observations</div>
        ${obs.length ? obs.map((x) => `<div class="row-item"><div><b>${esc(x.o.text)}</b><small>${esc(x.r.name)} · raised ${esc(fmt.date(x.o.ts))}</small></div>${x.o.status === 'Open' ? `<button class="btn sm" data-obs="${esc(x.r.id)}|${x.i}">${I.check}Mark fixed</button>` : '<span class="tag ok">Closed</span>'}</div>`).join('') : '<div class="faint">None open.</div>'}
        <div class="block-title">Inspection history</div>
        <table class="t compact"><tbody>${insp.slice(0, 10).map((y) => `<tr><td>${esc(fmt.date(y.x.ts))}</td><td class="l">${esc(y.r.name)}</td><td>${esc(y.x.type)}</td><td>${esc(y.x.by)}</td><td class="r"><span class="status ${y.x.result === 'Satisfactory' ? 'ok' : 'warn'}">${esc(y.x.result)}</span></td></tr>`).join('')}</tbody></table>
      </div>`,
      bind: (ov) => {
        $$('[data-renew]', ov).forEach((b) => { b.onclick = () => { const [ro, key] = b.dataset.renew.split('|'); DUI.runAction({ roId: ro, action: { kind: 'renewal', roId: ro, key } }); }; });
        $$('[data-obs]', ov).forEach((b) => { b.onclick = () => { const [ro, i] = b.dataset.obs.split('|'); DUI.runAction({ roId: ro, action: { kind: 'observation', roId: ro, index: +i } }); }; });
      },
    };
  }

  // ---------- Performance ----------
  function analytics() {
    const ros = DUI.scopeRos();
    const s = DUI.stats();
    const ach = ros.map((r) => { const m = Eng.metrics(r); return { r, a: r.products.reduce((x, p) => x + m.mtd[p].L, 0) / Math.max(1, r.products.reduce((x, p) => x + m.mtd[p].targetL, 0)) }; });
    return {
      cls: 'w-full',
      html: head('Performance', 'Sales against target, by outlet, fuel and hour; how customers pay') + `<div class="ov-body">
        ${summaryRow([['Sold today', fmt.klv(s.todayL) + ' kL'], ['Takings today', esc(fmt.lakh(s.takings))], ['Month to date', fmt.klv(s.mtd, 0) + ' kL'], ['Against target', fmt.pct(s.ach), achCls(s.ach)], ['Sales today', ros.reduce((a, r) => a + r.agg.count, 0).toLocaleString('en-IN')]])}
        <div class="grid-2"><div class="card"><div class="card-title">Daily sales, last 30 days</div><div class="card-sub">kL a day, all your outlets, with the daily target</div><canvas class="chart tall" id="anDaily"></canvas></div>
          <div class="card"><div class="card-title">Month to date against target</div><div class="card-sub">by outlet</div><canvas class="chart" id="anAch" style="height:${Math.max(110, ros.length * 46)}px"></canvas>
          <div class="card-title" style="margin-top:14px">By fuel, last 30 days</div><canvas class="chart short" id="anMix"></canvas></div></div>
        <div class="grid-3 mt"><div class="card"><div class="card-title">Today by hour</div><div class="card-sub">litres, all outlets · dashed: usual</div><canvas class="chart" id="anHour"></canvas></div>
          <div class="card"><div class="card-title">How customers paid today</div><div class="card-sub">share of sales</div><canvas class="chart" id="anPay"></canvas></div>
          <div class="card"><div class="card-title">Vehicles today</div><div class="card-sub">estimated from litres per sale</div><canvas class="chart" id="anVeh"></canvas></div></div>
        ${ach.some((x) => x.a < C.targetWarnRatio) ? `<div class="callout warn mt">${ach.filter((x) => x.a < C.targetWarnRatio).map((x) => `${esc(x.r.name)} is ${Math.round((1 - x.a) * 100)}% behind this month's target.`).join(' ')} Open the outlet's Sales tab to see which hours and fuels.</div>` : ''}
      </div>`,
      draw: () => {
        const days = ros[0].hist.slice(-30).map((h) => h.date);
        const tot = days.map((d) => ros.reduce((a, r) => a + ((r.hist.find((h) => h.date === d) || { total: 0 }).total), 0) / 1000);
        const tgt = ros.reduce((a, r) => a + r.products.reduce((x, p) => x + r.targetMonthL[p] / 30, 0), 0) / 1000;
        Charts.line($('#anDaily'), { labels: days.map((d) => String(+d.slice(8))), series: [{ data: tot, color: '#7aa7ff', label: 'Sold', fill: true }, { data: days.map(() => tgt), color: '#6e737a', label: 'Target', dash: [3, 4], width: 1.2 }], yFmt: (v) => v.toFixed(0) });
        Charts.bars($('#anAch'), { horizontal: true, labelWidth: 150, max: 1.2, items: ach.map((x) => ({ label: x.r.name, value: x.a, target: 1, color: x.a >= 1 ? '#57b583' : x.a >= 0.9 ? '#7aa7ff' : '#e0a645' })), fmt: (v) => Math.round(v * 100) + '%' });
        const mix = {}; ros.forEach((r) => r.products.forEach((p) => { mix[p] = (mix[p] || 0) + r.hist.slice(-30).reduce((a, h) => a + h[p], 0) / 1000; }));
        Charts.bars($('#anMix'), { horizontal: true, labelWidth: 110, items: Object.entries(mix).map(([p, v]) => ({ label: pname(p), value: v, color: PRODUCTS[p].color })), fmt: (v) => v.toFixed(0) + ' kL' });
        const hours = Array.from({ length: 24 }, (_, k) => (C.openingHour + k) % 24);
        const upto = hours.indexOf(W.util.istHour(Eng.now));
        Charts.line($('#anHour'), { labels: hours.map((h) => String(h).padStart(2, '0')), series: [{ data: hours.map((h) => ros.reduce((a, r) => a + r.products.reduce((x, p) => x + r.avgDailyL[p] * HOURLY[h], 0), 0)), color: '#6e737a', dash: [4, 4] }, { data: hours.slice(0, Math.max(1, upto)).map((h) => ros.reduce((a, r) => a + r.products.reduce((x, p) => x + r.hourly[h][p], 0), 0)), color: '#ecedee', fill: true }], legend: false, yFmt: (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) });
        const modes = {}; ros.forEach((r) => Object.entries(r.agg.modes).forEach(([k, n]) => { modes[k] = (modes[k] || 0) + n; }));
        Charts.donut($('#anPay'), { items: Object.entries(modes).filter(([, n]) => n).map(([k, n], i) => ({ label: k, value: n, color: ['#7aa7ff', '#57b583', '#e0a645', '#a48bf0'][i % 4] })), center: String(Object.values(modes).reduce((a, b) => a + b, 0)), centerSub: 'sales' });
        const veh = {}; ros.forEach((r) => Object.entries(r.agg.vehicles).forEach(([k, n]) => { veh[k] = (veh[k] || 0) + n; }));
        Charts.bars($('#anVeh'), { horizontal: true, labelWidth: 96, items: Object.entries(veh).map(([k, n]) => ({ label: k, value: n, color: '#a48bf0' })), fmt: (x) => String(Math.round(x)) });
      },
      live: false,
    };
  }

  // ---------- Messages with the Sales Officer (drawer, like the Assistant) ----------
  function messages() {
    if (!DUI.state.thread && W.threads[0]) DUI.state.thread = W.threads[0].id;
    const t = W.threads.find((x) => x.id === DUI.state.thread);
    if (t) t.unread = false;
    return {
      cls: 'w-drawer',
      html: head('Sales Officer', `${esc(W.officer)} · requests, complaints and claims`, `<button class="btn sm" id="newReq">${I.plus}New</button>`) + `
        <div class="threads-strip">${W.threads.filter((x) => DUI.inScope(x.roId)).map((x) => `<button class="chip ${x.id === DUI.state.thread ? 'active' : ''}" data-th="${esc(x.id)}">${x.unread ? '● ' : ''}${esc(x.subject.length > 34 ? x.subject.slice(0, 33) + '…' : x.subject)}</button>`).join('')}</div>
        <div class="ov-body cp-msgs" id="bubbles">${t ? `<div class="faint" style="font-size:12px;margin-bottom:8px">${esc(t.cat)}${t.roId ? ' · ' + esc(DUI.rname(t.roId)) : ''} · ${esc(t.status)}</div>` + t.msgs.map((m) => `<div class="msg ${m.from === 'dealer' ? 'user' : 'bot'}">${esc(m.text)}<small>${esc(m.who)} · ${esc(fmt.dt(m.ts))}</small></div>`).join('') + (t.msgs[t.msgs.length - 1].from === 'dealer' ? '<div class="faint" style="font-size:12px;margin-top:6px">Sent. The Sales Officer usually replies within the hour.</div>' : '') : '<div class="empty">No messages yet.</div>'}</div>
        <div class="cp-input"><textarea class="input" id="reply" rows="2" placeholder="Reply to the Sales Officer"></textarea><button class="btn primary" id="sendBtn">${I.send}</button></div>`,
      bind: (ov) => {
        $$('[data-th]', ov).forEach((b) => { b.onclick = () => { DUI.state.thread = b.dataset.th; render(true); }; });
        $('#newReq', ov).onclick = () => DUI.openCompose({});
        $('#sendBtn', ov).onclick = () => { const r = Eng.actions.sendMessage(DUI.state.thread, $('#reply', ov).value); if (r.error) { DUI.toast(r.error); return; } render(true); };
        const b = $('#bubbles', ov); if (b) b.scrollTop = b.scrollHeight;
      },
      sig: () => W.threads.map((x) => x.id + x.msgs.length).join() + DUI.state.thread,
    };
  }

  // ---------- Assistant: plain questions, answers computed from the live data ----------
  const chat = [{ from: 'bot', html: `Ask me about your outlets in plain words. For example: <i>when will diesel run out?</i>, <i>what should I do first?</i>, <i>how much do I need to pay?</i>, <i>where is my truck?</i>` }];
  const SUGG = ['What should I do first?', 'When will diesel run out?', 'How much do I need to pay?', 'Where is my truck?', 'How are sales today?', 'Any price problems?'];
  function answer(q) {
    const s = q.toLowerCase();
    const recs = DUI.recs();
    const link = (r) => `<a class="link" data-outlet="${esc(r.id)}">${esc(r.name)}</a>`;
    if (/first|do now|urgent|todo|to do|priorit/.test(s)) {
      return recs.length ? `Here's what matters most right now:<ol>${recs.slice(0, 4).map((r) => `<li><b>${esc(r.title)}</b><br><span class="faint">${esc(r.impact)}</span> <span class="text-btn" data-act="${esc(r.key)}">${esc(r.action.label)}</span></li>`).join('')}</ol>` : 'Nothing urgent. All outlets are running normally.';
    }
    const prod = /premium|xp/.test(s) ? 'XP' : /diesel|hsd/.test(s) ? 'HSD' : /petrol|ms\b/.test(s) ? 'MS' : null;
    if (/run out|dry|stock|cover|last/.test(s)) {
      const rows = [];
      DUI.scopeRos().forEach((r) => { const m = Eng.metrics(r); r.products.filter((p) => !prod || p === prod).forEach((p) => { const pm = m.byP[p]; rows.push(`<li>${link(r)} · ${esc(pname(p))}: ${fmt.klv(pm.usableL)} kL usable, runs dry <b>${esc(fmt.when(pm.dryTs))}</b>${pm.incoming.length ? `; with orders on the way ${esc(fmt.when(pm.dryWithOrdersTs))}` : ''}.</li>`); }); });
      return rows.length ? `Using usable stock (dead stock excluded) and your usual sales by hour:<ul>${rows.join('')}</ul>` : 'That fuel is not sold at your outlets.';
    }
    if (/pay|balance|money|owe|rtgs|neft/.test(s)) {
      const mny = Eng.money();
      const w = W.orders.filter((o) => o.status === 'awaiting_payment' && DUI.inScope(o.roId));
      const need = w.reduce((a, o) => a + Eng.stillToPay(o), 0);
      return `Available balance <b>${esc(fmt.inrFull(mny.available))}</b>${mny.pending ? `, with ${esc(fmt.inrFull(mny.pending))} on its way` : ''}. ${w.length ? `${w.length} order${w.length > 1 ? 's are' : ' is'} waiting for payment: ${w.map((o) => esc(o.id)).join(', ')}. ${need > 0 ? `Send <b>${esc(fmt.inrFull(need))}</b> to release ${w.length > 1 ? 'them' : 'it'}. <span class="text-btn" data-pay="${Math.ceil(need)}">Pay now</span>` : 'The money on its way covers it; it releases when credited.'}` : 'No order is waiting for payment.'}`;
    }
    if (/truck|tanker|deliver|arriv|where/.test(s)) {
      const mv = W.orders.filter((o) => ['placed', 'loading', 'in_transit', 'unloading'].includes(o.status) && DUI.inScope(o.roId));
      return mv.length ? `<ul>${mv.map((o) => `<li><b>${esc(o.id)}</b> for ${esc(DUI.rname(o.roId))}: ${esc(STATUS[o.status][0].toLowerCase())}, ${esc(DUI.nextStep(o).toLowerCase())}.${['loading', 'in_transit', 'unloading'].includes(o.status) ? ` <span class="text-btn" data-truck="${esc(o.id)}">Show on map</span>` : ''}</li>`).join('')}</ul>` : 'No truck is on its way to your outlets right now.';
    }
    if (/sale|sold|today|takings|target/.test(s)) {
      const st = DUI.stats();
      return `Today: <b>${fmt.klv(st.todayL)} kL</b> sold (${fmt.pct(st.todayL / Math.max(1, st.expectedL))} of the usual by now), takings <b>${esc(fmt.lakh(st.takings))}</b>. This month: ${fmt.pct(st.ach)} of target.<ul>${DUI.scopeRos().map((r) => { const m = Eng.metrics(r); return `<li>${link(r)}: ${fmt.klv(m.todayL)} kL today</li>`; }).join('')}</ul>`;
    }
    if (/price|rsp|preset/.test(s)) {
      const bad = recs.filter((r) => r.key.startsWith('rsp:'));
      return bad.length ? bad.map((r) => `<b>${esc(r.title)}</b>. <span class="text-btn" data-act="${esc(r.key)}">${esc(r.action.label)}</span>`).join('<br>') : 'Every pump and preset matches today\'s notified price.';
    }
    if (/licen|stamp|certif|complian|renew|inspect/.test(s)) {
      const items = [];
      DUI.scopeRos().forEach((r) => r.compliance.forEach((c) => items.push({ r, c, d: Math.ceil((c.due - Eng.now) / 86400000) })));
      items.sort((a, b) => a.d - b.d);
      return `Next renewals:<ul>${items.slice(0, 4).map((x) => `<li>${link(x.r)}: ${esc(x.c.label)} in <b>${x.d} days</b>${x.c.booked ? ' (booked)' : ''}</li>`).join('')}</ul>`;
    }
    return `I can answer questions about stock and run-dry times, payments and balance, trucks, today's sales, prices and renewals. Try: ${SUGG.slice(0, 3).map((x) => `<span class="text-btn" data-q="${esc(x)}">${esc(x)}</span>`).join(' · ')}`;
  }
  function copilot() {
    return {
      cls: 'w-drawer',
      html: head('Assistant', 'Answers come from your live data') + `
        <div class="ov-body cp-msgs" id="cpMsgs">${chat.map((m) => `<div class="msg ${m.from === 'me' ? 'user' : 'bot'}">${m.html}</div>`).join('')}</div>
        <div class="cp-sugg">${SUGG.map((x) => `<button class="chip" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <div class="cp-input"><input class="input" id="cpIn" placeholder="Ask about your outlets" autocomplete="off"><button class="btn primary" id="cpGo">${I.send}</button></div>`,
      bind: (ov) => {
        const ask = (q) => { if (!q.trim()) return; chat.push({ from: 'me', html: esc(q) }); chat.push({ from: 'bot', html: answer(q) }); render(true); };
        $('#cpGo', ov).onclick = () => ask($('#cpIn', ov).value);
        $('#cpIn', ov).onkeydown = (e) => { if (e.key === 'Enter') ask(e.target.value); };
        $$('[data-q]', ov).forEach((b) => { b.onclick = () => ask(b.dataset.q); });
        const m = $('#cpMsgs', ov); m.scrollTop = m.scrollHeight;
      },
      sig: () => String(chat.length),
    };
  }

  const DEFS = { outlets, logistics, account, compliance, analytics, messages, copilot };
  function render(force) {
    const ov = $('#overlay');
    const def = DEFS[V.cur];
    if (!def || ov.classList.contains('hidden')) return;
    const d = def();
    const sig = d.sig ? d.sig() : d.html;
    if (!force && sig === V.sig) return;
    // Don't redraw under the reader's cursor or while they type.
    const ae = document.activeElement;
    if (!force && ae && ov.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
    const body = $('.ov-body', ov), y = body ? body.scrollTop : 0;
    V.sig = sig;
    ov.className = 'overlay ' + d.cls;
    ov.innerHTML = d.html;
    $('[data-close]', ov).onclick = () => DUI.setView('ops');
    if (d.bind) d.bind(ov);
    if (d.draw) requestAnimationFrame(d.draw);
    const nb = $('.ov-body', ov); if (nb && !V.reset) nb.scrollTop = y; // keep the reader's place after an action
    V.reset = false;
    if (V.cur === 'messages' || V.cur === 'copilot') { const m = $('#bubbles, #cpMsgs', ov); if (m) m.scrollTop = m.scrollHeight; }
  }
  DUI.Views = {
    open(v, ov) { V.cur = v; V.sig = ''; V.reset = true; ov.classList.remove('hidden'); render(true); },
    update(force) {
      if (!force && V.cur === 'analytics' && Date.now() - (V.lastDraw || 0) < 20000) return; // charts: every 20 s of real time
      V.lastDraw = Date.now();
      if (!force && DUI.pointerDown()) return;
      // Hovering with a mouse pauses live redraws; touch screens keep :hover after a tap, so not there.
      if (!force && !matchMedia('(hover: none)').matches && $('#overlay').matches(':hover') && V.cur !== 'messages') return;
      render(force);
    },
  };
})();
