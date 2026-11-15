/* =====================================================================
   PRAHARI for dealers — one outlet: stock and pumps, sales, stock book, integrity, compliance
   ===================================================================== */
(function () {
  'use strict';
  const C = window.DCFG;
  const W = window.DW;
  const { PRODUCTS, HOURLY } = DB;
  const { $, $$, esc, I, fmt, pname, PCOLOR, PHEX } = DUI;
  const U = W.util;
  const TABS = [['stock', 'Stock & pumps'], ['sales', 'Sales'], ['book', 'Stock book'], ['integrity', 'Integrity'], ['compliance', 'Compliance']];

  function header(ro, m) {
    const st = DUI.outletStatus(ro);
    const top = st.recs[0];
    const vs = m.expectedL > 50 ? m.todayL / m.expectedL - 1 : 0;
    const soon = m.soonest;
    return `<button class="back" data-go="outlets">${I.back} All outlets</button>
      <div class="page-head" style="margin-bottom:12px"><div class="grow">
        <h1 class="page-title">${esc(ro.name)}</h1>
        <div class="page-sub">RO ${esc(ro.id)} · ${esc(ro.marketClass)} · ${esc(ro.type)} · ${esc(ro.locality)}, ${esc(ro.road)}</div>
        <div class="page-sub" title="Sales hierarchy">${esc(DB.meta.salesArea)} · ${esc(DB.meta.division)} · ${esc(DB.meta.state)}</div></div>
        ${DUI.asOf()}
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn primary sm" data-neworder="${esc(ro.id)}">${I.truck} Order fuel</button><button class="btn sm" id="msgSO">${I.msg} Message Sales Officer</button></div></div>
      ${top ? `<div class="od-summary" style="margin-bottom:14px"><i class="dot ${DUI.SEV_DOT[top.sev]}"></i><div><b style="font-weight:600">${esc(top.title)}</b><div class="muted" style="margin-top:2px">${esc(top.why)}</div><div style="margin-top:8px"><button class="btn primary sm" data-act="${esc(top.key)}">${esc(top.action.label)}</button>${st.recs.length > 1 ? ` <span class="faint" style="font-size:12px;margin-left:6px">+${st.recs.length - 1} more on the Today page</span>` : ''}</div></div></div>` : `<div class="od-summary" style="margin-bottom:14px"><i class="dot ok"></i><div>Nothing needs you at this outlet right now.</div></div>`}
      <div class="card flush"><div class="kstats">
        <div class="kstat"><div class="l">Sold today</div><div class="v">${esc(fmt.kl(m.todayL))}</div></div>
        <div class="kstat"><div class="l">Against the usual by now</div><div class="v ${vs < -0.08 ? 'c-warn' : vs > 0.03 ? 'c-ok' : ''}">${vs >= 0 ? '+' : ''}${Math.round(vs * 100)}%</div></div>
        <div class="kstat"><div class="l">Takings today</div><div class="v">${esc(fmt.inr(m.todayInr))}</div></div>
        <div class="kstat"><div class="l">Runs dry first (counting orders)</div><div class="v ${soon && soon.dryWithOrdersTs - Eng.now < 86400000 ? 'c-crit' : ''}">${soon ? esc(pname(soon.p)) + ', ' + esc(fmt.when(soon.dryWithOrdersTs)) : 'Not within 3 days'}</div></div>
      </div></div>
      <div class="tabs" style="padding:0;margin-top:14px" role="tablist">${TABS.map(([k, l]) => `<button class="tab ${DUI.state.tab === k ? 'active' : ''}" role="tab" data-tab-k="${k}">${l}</button>`).join('')}</div>`;
  }

  // ---------- Stock & pumps ----------
  function stockTab(ro, m) {
    const prodCards = ro.products.map((p) => {
      const pm = m.byP[p];
      return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="card-title"><span class="pname"><i style="background:${PCOLOR[p]}"></i>${esc(pname(p))}</span></div><span class="faint" style="font-size:12px">₹${pm.rsp.toFixed(2)}/L</span></div>
        <div style="margin:10px 0 8px">${DUI.coverBar(pm)}</div>
        <div class="kv" style="grid-template-columns:1fr auto;gap:5px 10px">
          <span>Usable stock</span><b style="font-weight:600">${esc(fmt.L(pm.usableL))}</b>
          <span>Dead stock (can't be sold)</span><b style="font-weight:500">${esc(fmt.L(pm.deadL))}</b>
          <span>Tank space (ullage)</span><b style="font-weight:500">${esc(fmt.L(pm.ullageL))}</b>
          <span>Cover at the usual pace</span><b style="font-weight:600" class="${pm.coverDays < 1 ? 'c-crit' : pm.coverDays < 2 ? 'c-warn' : ''}">${fmt.days(pm.coverDays)}</b>
          <span>Runs dry</span><b style="font-weight:500">${esc(fmt.when(pm.dryTs))}</b>
          ${pm.incoming.length ? `<span>With orders on the way</span><b style="font-weight:500">${esc(fmt.when(pm.dryWithOrdersTs))}</b>` : ''}
        </div>
        ${pm.simpleCoverDays != null ? `<div class="faint" style="font-size:11.5px;margin-top:8px" title="Usable stock divided by today's sales so far, as many reports compute it">Simple method (÷ today's sales so far): ${fmt.days(pm.simpleCoverDays)}. ${pm.simpleCoverDays > pm.coverDays * 1.3 ? 'Overstated: today is not over yet.' : ''}</div>` : ''}
      </div>`;
    }).join('');
    const tanks = ro.tanks.map((t) => {
      const pct = t.readL / t.capL;
      const dead = t.deadL / t.capL;
      const water = Math.min(0.15, t.waterMm / 2000);
      const stale = !t.atgOk || Eng.now - t.readTs > C.atgStaleMin * 60000;
      return `<div class="tank"><div class="tank-vis" title="${Math.round(pct * 100)}% full"><div class="fill" style="height:${pct * 100}%;background:${PHEX[t.product]}cc"></div><div class="deadl" style="height:${dead * 100}%"></div>${t.waterMm ? `<div class="water" style="height:${water * 100}%"></div>` : ''}</div>
        <div><h5>${esc(t.id)} · ${esc(t.product)}<span class="tag ${stale ? 'warn' : 'ok'}" style="font-weight:500">${stale ? 'Not reporting' : 'Reporting'}</span></h5>
        <div class="kv"><span>Stock</span><b>${esc(fmt.L(t.readL))}</b><span>Capacity</span><b>${esc(fmt.L(t.capL))}</b><span>Dead stock</span><b>${esc(fmt.L(t.deadL))}</b><span>Ullage</span><b>${esc(fmt.L(t.capL - t.readL))}</b><span>Water</span><b class="${t.waterMm > C.waterMaxMm ? 'c-warn' : ''}">${t.waterMm} mm</b><span>Temperature</span><b>${t.tempC} °C</b><span>Last reading</span><b>${esc(fmt.hm(t.readTs))}</b></div></div></div>`;
    }).join('');
    const nozzles = ro.nozzles.map((n) => {
      const peers = ro.nozzles.filter((x) => x.product === n.product && x !== n);
      const avgFlow = peers.length ? peers.reduce((a, x) => a + x.flowLpm, 0) / peers.length : n.flowLpm;
      const slow = (avgFlow - n.flowLpm) / avgFlow * 100 >= C.flowVariancePct;
      const nil = n.todayL === 0 && (Eng.now - ro.book.openTs) / 3600000 >= C.nilSellingHours;
      const cls = n.status === 'Dispensing' ? 'disp' : nil || n.status === 'Dry' ? 'fault' : '';
      return `<div class="noz ${cls}" title="${esc(n.du)} · ${esc(pname(n.product))} · ${n.flowLpm} L/min${n.lastSale ? ' · last sale ' + fmt.hm(n.lastSale.ts) : ''}"><b>${esc(n.id)}</b>${esc(n.product)} · ${esc(n.du)}<div style="color:var(--text);margin-top:3px;font-variant-numeric:tabular-nums">${esc(fmt.L(n.todayL))}</div><div style="${slow ? 'color:var(--warn)' : ''}">${n.flowLpm} L/min</div>${!n.presetOk ? '<div style="color:var(--warn)">Preset old</div>' : ''}${n.status === 'Dry' ? '<div style="color:var(--crit)">Dry</div>' : ''}</div>`;
    }).join('');
    const prices = ro.products.map((p) => { const pr = ro.prices[p]; const bad = Math.abs(pr.pump - pr.rsp) > 0.005; return `<tr><td class="l">${esc(pname(p))}</td><td class="r">₹${pr.rsp.toFixed(2)}</td><td class="r ${bad ? 'c-crit' : ''}">₹${pr.pump.toFixed(2)}</td><td>${bad ? '<span class="tag crit">Mismatch</span>' : '<span class="tag ok">Matches</span>'}</td></tr>`; }).join('');
    return `<div class="grid-3" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:14px">${prodCards}</div>
      <div class="sh mt" style="margin-top:20px"><h4>Tanks</h4><span class="aside">Automatic tank gauge, every ${C.refresh.atg} min · hatched line = dead stock</span></div><div class="tanks">${tanks}</div>
      <div class="grid-2 mt" style="margin-top:20px"><div class="card"><div class="card-title">Nozzles</div><div class="card-sub">Litres sold today and flow rate. Red: no sale since opening, or dry.</div><div class="nozzles" style="grid-template-columns:repeat(auto-fill,minmax(92px,1fr))">${nozzles}</div></div>
      <div class="card"><div class="card-title">Price board</div><div class="card-sub">Today's notified retail price against what the pump charges (revised ${esc(fmt.when(ro.priceRevisedTs))})</div><table class="t compact"><thead><tr><th>Product</th><th class="r">Notified</th><th class="r">Pump</th><th></th></tr></thead><tbody>${prices}</tbody></table>
        <div class="card-title" style="margin-top:16px">Latest sales</div><table class="t compact"><tbody>${ro.txns.slice(0, 6).map((t) => `<tr><td>${esc(fmt.hm(t.ts))}</td><td>${esc(t.nozzle)}</td><td>${esc(t.product)}</td><td class="r">${t.L.toFixed(1)} L</td><td class="r">${esc(fmt.inrFull(t.inr))}</td><td>${esc(t.mode)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  // ---------- Sales ----------
  function salesTab(ro, m) {
    const a = ro.agg;
    const mtd = ro.products.map((p) => { const t = m.mtd[p]; return `<tr><td class="l"><span class="pname"><i style="background:${PCOLOR[p]}"></i>${esc(pname(p))}</span></td><td class="r">${esc(fmt.kl(t.L))}</td><td class="r">${esc(fmt.kl(t.targetL))}</td><td class="r ${t.ratio < C.targetWarnRatio ? 'c-warn' : 'c-ok'}">${fmt.pct(t.ratio)}</td></tr>`; }).join('');
    return `<div class="grid-2" style="margin-top:14px"><div class="card"><div class="card-title">Today by hour</div><div class="card-sub">Litres sold each hour against your ${C.forecastDays}-day average (dashed)</div><canvas class="chart tall" id="chHour"></canvas></div>
      <div class="card"><div class="card-title">Month to date</div><div class="card-sub">Against this month's target</div><table class="t compact"><thead><tr><th>Product</th><th class="r">Sold</th><th class="r">Target by now</th><th class="r">Achieved</th></tr></thead><tbody>${mtd}</tbody></table>
        <div class="kv" style="margin-top:14px;grid-template-columns:1fr auto"><span>Sales today</span><b>${a.count.toLocaleString('en-IN')}</b><span>Average sale</span><b>${a.count ? (a.L / a.count).toFixed(1) + ' L · ' + fmt.inrFull(a.inr / a.count) : '—'}</b></div></div></div>
      <div class="card mt"><div class="card-title">Last 30 days</div><div class="card-sub">Litres a day, all products, with the daily target</div><canvas class="chart" id="ch30"></canvas></div>
      <div class="grid-3 mt"><div class="card"><div class="card-title">Bill size</div><div class="card-sub">Number of sales by amount today</div><canvas class="chart" id="chSlab" style="height:200px"></canvas></div>
        <div class="card"><div class="card-title">Vehicles</div><div class="card-sub">Estimated from litres per sale (2/3-wheeler ≤ 5 L, car ≤ 40 L, SUV/LCV ≤ 65 L)</div><canvas class="chart" id="chVeh" style="height:200px"></canvas></div>
        <div class="card"><div class="card-title">How customers paid</div><div class="card-sub">Share of today's sales</div><canvas class="chart" id="chPay" style="height:200px"></canvas></div></div>`;
  }
  const slabLabels = () => C.ticketSlabsInr.map((s, i) => (i === 0 ? '≤ ₹100' : s === Infinity ? `> ₹${C.ticketSlabsInr[i - 1].toLocaleString('en-IN')}` : `₹${C.ticketSlabsInr[i - 1].toLocaleString('en-IN')}–${s.toLocaleString('en-IN')}`));
  function drawSales(ro, v) {
    if (!$('#chHour', v)) return;
    const hours = Array.from({ length: 24 }, (_, k) => (C.openingHour + k) % 24);
    const nowH = U.istHour(Eng.now);
    const upto = hours.indexOf(nowH);
    const got = hours.map((h, k) => (k <= upto ? ro.products.reduce((s, p) => s + ro.hourly[h][p], 0) : null));
    const avg = hours.map((h) => ro.products.reduce((s, p) => s + ro.avgDailyL[p] * HOURLY[h], 0));
    const labels = hours.map((h) => String(h).padStart(2, '0'));
    Charts.line($('#chHour', v), { labels, series: [{ data: avg, color: '#6e737a', dash: [4, 4], label: `${C.forecastDays}-day average` }, { data: got.slice(0, Math.max(1, upto)), color: '#7aa7ff', label: 'Today', fill: true }], yFmt: (x) => Math.round(x) });
    const hist = ro.hist.slice(-30);
    const target = ro.products.reduce((s, p) => s + ro.targetMonthL[p] / 30, 0);
    Charts.bars($('#ch30', v), { items: hist.map((h) => ({ label: h.date.slice(8), value: h.total / 1000, color: h.total < target * 0.9 ? '#e0a645' : '#57b583' })), yFmt: (x) => x.toFixed(0) + ' KL' });
    const labelsSlab = slabLabels();
    Charts.bars($('#chSlab', v), { horizontal: true, labelWidth: 96, items: ro.agg.slabs.map((n, i) => ({ label: labelsSlab[i], value: n, color: '#7aa7ff' })), fmt: (x) => String(Math.round(x)) });
    Charts.bars($('#chVeh', v), { horizontal: true, labelWidth: 96, items: Object.entries(ro.agg.vehicles).map(([k, n]) => ({ label: k, value: n, color: '#a48bf0' })), fmt: (x) => String(Math.round(x)) });
    const modes = Object.entries(ro.agg.modes).filter(([, n]) => n > 0);
    Charts.donut($('#chPay', v), { items: modes.map(([k, n], i) => ({ label: k, value: n, color: ['#7aa7ff', '#57b583', '#e0a645', '#a48bf0'][i % 4] })), center: String(ro.agg.count), centerSub: 'sales' });
  }

  // ---------- Stock book (daily reckoner) ----------
  function bookTab(ro, m) {
    const rows = ro.products.map((p) => {
      // Compare like with like: the gauge reading and the nozzle sales at that same moment.
      const open = ro.book.openL[p], rec = ro.book.receiptL[p], close = m.byP[p].stockL;
      const tankSales = open + rec - close;
      const noz = ro.book.nozzleAtReadL[p];
      const diff = tankSales - noz;
      const pct = noz > 0 ? diff / noz * 100 : 0;
      const bad = Math.abs(pct) > C.variationPct && noz > 500;
      return `<tr><td class="l"><span class="pname"><i style="background:${PCOLOR[p]}"></i>${esc(pname(p))}</span></td><td class="r">${esc(fmt.L(open))}</td><td class="r">${rec ? esc(fmt.L(rec)) : '—'}</td><td class="r">${esc(fmt.L(close))}</td><td class="r">${esc(fmt.L(tankSales))}</td><td class="r">${esc(fmt.L(noz))}</td><td class="r ${bad ? 'c-crit' : ''}">${diff >= 0 ? '+' : ''}${esc(fmt.L(diff))}</td><td class="r ${bad ? 'c-crit' : ''}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</td></tr>`;
    }).join('');
    return `<div class="card mt"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap"><div><div class="card-title">Stock book for the day from ${esc(fmt.dt(ro.book.openTs))}</div>
      <div class="card-sub">Tank sales = opening stock + receipts − the latest gauge reading (${esc(fmt.hm(Math.max(...ro.tanks.map((t) => t.readTs))))}). It should match what the nozzles had recorded by then; the gap is the variation (allowed ±${C.variationPct}%).</div></div>
      <button class="btn sm no-print" onclick="window.print()">${I.print} Print daily report</button></div>
      <div class="table-scroll"><table class="t"><thead><tr><th>Product</th><th class="r">Opening (06:00 dip)</th><th class="r">Receipts</th><th class="r">Last reading</th><th class="r">Tank sales</th><th class="r">Nozzle sales then</th><th class="r">Variation</th><th class="r">%</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="faint" style="font-size:12px;margin-top:10px">A receipt not yet booked makes tank sales look negative; a variation above the limit for several days points to a leak, a meter fault or pilferage.</div></div>
      <div class="card mt"><div class="card-title">Recent deliveries</div><div class="card-sub">Invoices from the oil company and what the tank gauge measured</div>
      <div class="table-scroll"><table class="t"><thead><tr><th>Order</th><th>Invoice</th><th>Date</th><th>Product</th><th class="r">Invoiced</th><th class="r">Received</th><th class="r">Short</th><th>Status</th></tr></thead><tbody>${W.orders.filter((o) => o.roId === ro.id && o.invoice).slice(0, 8).flatMap((o) => o.lines.map((l, i) => {
        const got = o.receipt ? o.receipt.lines.find((x) => x.product === l.product).receivedL : o.atgReceivedL ? o.atgReceivedL[l.product] : null;
        const short = got == null ? null : l.kl * 1000 - got;
        return `<tr class="row" data-order="${esc(o.id)}"><td class="l">${i === 0 ? esc(o.id) : ''}</td><td class="mono">${i === 0 ? esc(o.invoice.no) : ''}</td><td>${i === 0 ? esc(fmt.dmy(o.invoice.ts)) : ''}</td><td>${esc(pname(l.product))}</td><td class="r">${esc(fmt.L(l.kl * 1000))}</td><td class="r">${got == null ? '—' : esc(fmt.L(got))}</td><td class="r ${short != null && short > l.kl * 1000 * C.transitLossFraction ? 'c-crit' : ''}">${short == null ? '—' : esc(fmt.L(short))}</td><td>${i === 0 ? `<span class="status ${DUI.STATUS[o.status][1]}">${esc(DUI.STATUS[o.status][0])}</span>` : ''}</td></tr>`;
      })).join('')}</tbody></table></div></div>`;
  }

  // ---------- Integrity ----------
  function integrityTab(ro, m) {
    const checks = [];
    ro.products.forEach((p) => {
      const pr = ro.prices[p];
      const bad = Math.abs(pr.pump - pr.rsp) > 0.005;
      checks.push([bad ? 'crit' : 'ok', `Price: ${pname(p)}`, bad ? `Pump ₹${pr.pump.toFixed(2)}, notified ₹${pr.rsp.toFixed(2)}` : `₹${pr.rsp.toFixed(2)} on the pump`]);
      const presets = ro.nozzles.filter((n) => n.product === p && !n.presetOk).map((n) => n.id);
      checks.push([presets.length ? 'warn' : 'ok', `Presets: ${pname(p)}`, presets.length ? `Old price on ${presets.join(', ')}` : 'All presets use today\'s price']);
    });
    const hoursOpen = (Eng.now - ro.book.openTs) / 3600000;
    const nil = ro.nozzles.filter((n) => n.todayL === 0 && hoursOpen >= C.nilSellingHours);
    checks.push([nil.length ? 'crit' : 'ok', 'Nozzles not selling', nil.length ? nil.map((n) => `${n.id} (${n.du})`).join(', ') + ` since ${fmt.hm(ro.book.openTs)}` : 'Every nozzle has sold today']);
    const nilTanks = ro.tanks.filter((t) => ro.nozzles.filter((n) => n.product === t.product).every((n) => n.todayL === 0) && hoursOpen >= C.nilSellingHours);
    checks.push([nilTanks.length ? 'crit' : 'ok', 'Tanks not selling', nilTanks.length ? nilTanks.map((t) => t.id).join(', ') : 'Every tank is selling']);
    const slow = ro.nozzles.filter((n) => { const peers = ro.nozzles.filter((x) => x.product === n.product && x !== n); if (!peers.length) return false; const a = peers.reduce((s, x) => s + x.flowLpm, 0) / peers.length; return (a - n.flowLpm) / a * 100 >= C.flowVariancePct; });
    checks.push([slow.length ? 'warn' : 'ok', 'Flow-rate variance', slow.length ? slow.map((n) => `${n.id} ${n.flowLpm} L/min`).join(', ') : `All within ${C.flowVariancePct}% of their peers`]);
    const wet = ro.tanks.filter((t) => t.waterMm > C.waterMaxMm);
    checks.push([wet.length ? 'warn' : 'ok', 'Water in tanks', wet.length ? wet.map((t) => `${t.id} ${t.waterMm} mm`).join(', ') : `All below ${C.waterMaxMm} mm`]);
    const stale = ro.tanks.filter((t) => !t.atgOk || Eng.now - t.readTs > C.atgStaleMin * 60000);
    checks.push([stale.length ? 'warn' : 'ok', 'Tank gauges reporting', stale.length ? stale.map((t) => t.id).join(', ') + ' silent' : 'All reporting']);
    const book = ro.products.map((p) => { const tankSales = ro.book.openL[p] + ro.book.receiptL[p] - m.byP[p].stockL; const noz = ro.book.nozzleAtReadL[p]; return noz > 500 ? Math.abs(tankSales - noz) / noz * 100 : 0; });
    const worst = Math.max(...book);
    checks.push([worst > C.variationPct ? 'crit' : 'ok', 'Stock reconciliation today', `Largest variation ${worst.toFixed(2)}% (allowed ${C.variationPct}%)`]);
    const logs = ro.logs.slice().sort((a, b) => b.ts - a.ts);
    return `<div class="grid-2" style="margin-top:14px"><div class="card"><div class="card-title">Checks right now</div><div class="card-sub">The same checks the oil company runs on your automation data</div>
      ${checks.map(([s, l, d]) => `<div class="row-item"><div><b>${esc(l)}</b><small>${esc(d)}</small></div><span class="status ${s}">${s === 'ok' ? 'OK' : s === 'warn' ? 'Check' : 'Act now'}</span></div>`).join('')}</div>
      <div class="card"><div class="card-title">Dispenser events</div><div class="card-sub">Critical events need an action-taken report (ATR)</div>
      ${logs.length ? logs.map((l) => `<div class="row-item" style="align-items:flex-start"><div><b>${esc(l.type)} · ${esc(l.du)}</b><small>${esc(fmt.when(l.ts))} · ${esc(l.text)}</small>${l.atr ? `<small style="color:var(--text-2);margin-top:4px">ATR ${esc(fmt.when(l.atr.ts))}: ${esc(l.atr.text)}</small>` : ''}</div>${l.critical ? (l.atr ? '<span class="tag ok">ATR filed</span>' : `<button class="btn sm" data-atr="${esc(l.id)}">Write ATR</button>`) : '<span class="tag">Info</span>'}</div>`).join('') : '<div class="empty">No events.</div>'}</div></div>`;
  }

  // ---------- Compliance ----------
  function complianceTab(ro) {
    const items = ro.compliance.slice().sort((a, b) => a.due - b.due);
    return `<div class="grid-2" style="margin-top:14px"><div class="card"><div class="card-title">Certificates and licences</div><div class="card-sub">Prahari reminds you ${C.complianceWarnDays} days ahead</div>
      <table class="t"><thead><tr><th>Item</th><th>Expires</th><th class="r">Days left</th><th></th></tr></thead><tbody>${items.map((c) => { const d = Math.ceil((c.due - Eng.now) / 86400000); return `<tr><td class="l">${esc(c.label)}</td><td>${esc(fmt.date(c.due))}</td><td class="r"><span class="tag ${d <= C.complianceUrgentDays ? 'crit' : d <= C.complianceWarnDays ? 'warn' : 'ok'}">${d}</span></td><td class="r">${c.booked ? `<span class="tag ok">Booked ${esc(fmt.date(c.booked.for))}</span>` : d <= C.complianceWarnDays ? `<button class="btn sm" data-renew="${esc(c.key)}">Book</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="card"><div class="card-title">Inspection observations</div><div class="card-sub">Open items count against the outlet at the next inspection</div>
      ${ro.observations.length ? ro.observations.map((o, i) => `<div class="row-item"><div><b>${esc(o.text)}</b><small>Raised ${esc(fmt.date(o.ts))}${o.proof ? ' · closed ' + esc(fmt.date(o.proof.ts)) + ': ' + esc(o.proof.note) : ''}</small></div>${o.status === 'Open' ? `<button class="btn sm" data-obs="${i}">Mark fixed</button>` : '<span class="tag ok">Closed</span>'}</div>`).join('') : '<div class="empty">No observations.</div>'}
      <div class="card-title" style="margin-top:16px">Recent inspections</div>
      ${ro.inspections.map((x) => `<div class="row-item"><div><b>${esc(x.type)}</b><small>${esc(fmt.date(x.ts))} · ${esc(x.by)}</small></div><span class="tag ${x.result === 'Satisfactory' ? 'ok' : 'warn'}">${esc(x.result)}</span></div>`).join('')}</div></div>`;
  }

  DUI.view('outlet', {
    render() {
      const ro = W.byId(DUI.state.ro) || W.ros[0];
      DUI.state.ro = ro.id;
      const m = Eng.metrics(ro);
      const body = { stock: stockTab, sales: salesTab, book: bookTab, integrity: integrityTab, compliance: complianceTab }[DUI.state.tab] || stockTab;
      return `<div class="page">${header(ro, m)}${body(ro, m)}</div>`;
    },
    mount(v) {
      const ro = W.byId(DUI.state.ro);
      $$('[data-tab-k]', v).forEach((b) => { b.onclick = () => { DUI.state.tab = b.dataset.tabK; DUI.go('outlet'); }; });
      const msg = $('#msgSO', v);
      if (msg) msg.onclick = () => DUI.openCompose({ roId: ro.id, cat: 'Other', subject: `${ro.name} (${ro.id})`, text: '' });
      $$('[data-atr]', v).forEach((b) => { b.onclick = () => DUI.openAtr(ro.id, b.dataset.atr); });
      $$('[data-renew]', v).forEach((b) => { b.onclick = () => DUI.runAction({ roId: ro.id, action: { kind: 'renewal', roId: ro.id, key: b.dataset.renew } }); });
      $$('[data-obs]', v).forEach((b) => { b.onclick = () => DUI.runAction({ roId: ro.id, action: { kind: 'observation', roId: ro.id, index: +b.dataset.obs } }); });
      if (DUI.state.tab === 'sales') requestAnimationFrame(() => drawSales(ro, v));
    },
  });
})();
