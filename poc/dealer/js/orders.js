/* =====================================================================
   PRAHARI for dealers — orders, payment, receipt and truck tracking
   Ordering stays in the oil company's system in a real deployment; here the whole loop is
   simulated: suggested order → payment by RTGS/NEFT (UTR recorded, never money moved) →
   release → loading → on the road → unloading → receipt check and shortage claim.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.DCFG;
  const W = window.DW;
  const { PRODUCTS } = DB;
  const { $, $$, esc, I, fmt, pname, PCOLOR, STATUS } = DUI;
  const U = W.util;
  const HOUR = 3600000, MIN = 60000;
  const ACTIVE = ['loading', 'in_transit', 'unloading'];
  const lineText = (lines) => lines.map((l) => `${pname(l.product)} ${l.kl} KL`).join(' + ');

  /** Tank space a product will have when a truck arriving at ts unloads. */
  function spaceAt(ro, p, ts) {
    const pm = Eng.metrics(ro).byP[p];
    const sold = U.expectedBetween(ro.avgDailyL[p], Eng.now, ts);
    const coming = pm.incoming.filter((d) => d.ts <= ts).reduce((a, d) => a + d.L, 0);
    const at = Math.max(pm.deadL, pm.stockL - sold) + coming;
    return Math.max(0, pm.capL * (1 - C.ullageReserveFraction) - at);
  }
  function progress(o) {
    if (o.status === 'in_transit') return Math.max(0, Math.min(1, (Eng.now - o.dispatchTs) / (o.arriveTs - o.dispatchTs)));
    if (o.status === 'unloading' || o.status === 'awaiting_receipt' || o.status === 'received' || o.status === 'claim_raised') return 1;
    return 0;
  }
  function nextStep(o) {
    return ({
      awaiting_payment: Eng.stillToPay(o) > 0 ? `Pay ${fmt.inr(Eng.stillToPay(o))} to release` : `Payment on its way; releases ${fmt.when(Eng.releaseTsFor(o))}`,
      placed: `Loads ${fmt.when(o.loadStartTs)}`,
      loading: `Leaves the supply point about ${fmt.hm(o.loadStartTs + C.loadingMin * MIN)}`,
      in_transit: `Arrives ${fmt.when(o.arriveTs)}`,
      unloading: `Unloading, done about ${fmt.hm(o.arriveTs + C.unloadingMin * MIN)}`,
      awaiting_receipt: 'Check the gauge readings and confirm',
      claim_raised: 'Claim being verified',
      received: o.receipt ? `Received ${fmt.when(o.receipt.ts)}` : 'Received',
      cancelled: 'Cancelled',
    })[o.status];
  }

  // ---------- New order ----------
  DUI.openOrder = function (roId) {
    const ros = DUI.scopeRos();
    const st = { roId: roId || (W.ros.find((r) => Eng.suggest(r) && !W.orders.some((o) => o.roId === r.id && (o.status === 'awaiting_payment' || o.status === 'placed'))) || ros[0]).id };
    function reset() {
      const ro = W.byId(st.roId);
      // An outlet with an order still waiting to load gets that order to change, not a second one.
      st.replace = W.orders.find((o) => o.roId === ro.id && (o.status === 'awaiting_payment' || o.status === 'placed')) || null;
      const s = Eng.suggest(ro);
      st.lines = Object.fromEntries(ro.products.map((p) => [p, 0]));
      if (st.replace) {
        st.truckKL = st.replace.truckKL;
        st.replace.lines.forEach((l) => { st.lines[l.product] = l.kl; });
      } else {
        st.truckKL = s ? s.truckKL : C.trucks[0].kl;
        if (s) s.lines.forEach((l) => { st.lines[l.product] = l.kl; });
      }
      st.sugg = s;
    }
    reset();
    const box = DUI.modal('<div></div>', 'mid');
    function draw() {
      const ro = W.byId(st.roId);
      const tk = C.trucks.find((t) => t.kl === st.truckKL);
      const comp = tk.compartments[0];
      const lines = Object.entries(st.lines).filter(([, kl]) => kl > 0).map(([product, kl]) => ({ product, kl }));
      const value = Math.round(U.valueOf(lines));
      const money = Eng.money();
      const held = st.replace && st.replace.status === 'placed' ? st.replace.value : 0; // released money comes back on replace
      const short = Math.max(0, value - money.available - held - money.pending);
      const p0 = Eng.plan(ro, Eng.now + (short > 0 ? C.paymentCreditMin * MIN : value > money.available + held ? Math.max(0, money.creditTs - Eng.now) : 0));
      const total = lines.reduce((a, l) => a + l.kl, 0);
      const err = lines.length ? Eng.validateOrder(st.roId, lines, st.truckKL, st.replace && st.replace.id) : null;
      const m = Eng.metrics(ro);
      box.innerHTML = `${DUI.modalHead(st.replace ? `Change order ${st.replace.id}` : 'New fuel order', st.replace ? 'It has not started loading, so it can still be changed' : 'Starts from Prahari\'s suggestion; change anything')}
        <div class="modal-body">
          <div class="form-row"><span>Outlet</span><select class="input" id="oRo">${W.ros.map((r) => `<option value="${esc(r.id)}"${r.id === st.roId ? ' selected' : ''}>${esc(r.name)} · ${esc(r.id)}</option>`).join('')}</select></div>
          <div class="form-row"><span>Truck</span><div class="seg" id="oTk">${C.trucks.map((t) => `<button data-kl="${t.kl}" class="${t.kl === st.truckKL ? 'active' : ''}">${t.kl} KL · ${t.compartments.length} × ${t.compartments[0]} KL</button>`).join('')}</div></div>
          <div class="table-scroll"><table class="t" style="margin-top:6px"><thead><tr><th>Product</th><th class="r">Usable now</th><th class="r">Runs dry</th><th class="r">Space when it arrives</th><th class="r">Suggested</th><th class="r">Order</th></tr></thead><tbody>
          ${ro.products.map((p) => { const pm = m.byP[p]; const sg = st.sugg && st.sugg.lines.find((l) => l.product === p); return `<tr><td class="l"><span class="pname"><i style="background:${PCOLOR[p]}"></i>${esc(pname(p))}</span></td><td class="r">${esc(fmt.L(pm.usableL))}</td><td class="r ${pm.dryTs && pm.dryTs - Eng.now < 86400000 ? 'c-crit' : ''}">${esc(fmt.when(pm.dryTs))}</td><td class="r">${esc(fmt.L(spaceAt(ro, p, p0.usableTs)))}</td><td class="r">${sg ? sg.kl + ' KL' : '—'}</td>
            <td class="r"><span class="qty"><button data-dec="${p}" aria-label="Less ${esc(pname(p))}">−</button><b>${st.lines[p]} KL</b><button data-inc="${p}" aria-label="More ${esc(pname(p))}">+</button></span></td></tr>`; }).join('')}
          </tbody></table></div>
          <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:12.5px"><span class="muted">Loaded ${total} of ${tk.kl} KL · ${Math.round(total / comp)} of ${tk.compartments.length} compartments</span><span>Estimated invoice <b>${esc(fmt.inrFull(value))}</b></span></div>
          <div class="progress"><i style="width:${Math.min(100, total / tk.kl * 100)}%;background:${total > tk.kl ? 'var(--crit)' : 'var(--text-2)'}"></i></div>
          ${st.sugg && st.sugg.notes.length ? `<div class="faint" style="font-size:12px">${st.sugg.notes.map(esc).join(' ')}</div>` : ''}
          <div class="info-box mt"><b>If you order now</b><div class="kv" style="grid-template-columns:150px 1fr"><span>${short > 0 ? 'Payment credited' : 'Released'}</span><b style="font-weight:500">${esc(fmt.when(p0.releaseTs))}</b><span>Loading starts</span><b style="font-weight:500">${esc(fmt.when(p0.loadStartTs))}</b><span>Arrives</span><b style="font-weight:500">${esc(fmt.when(p0.arriveTs))}</b><span>Supply point</span><b style="font-weight:500">${esc(DB.depotById(ro.depotId).name)} · ${Math.round(ro.routeMin)} min drive</b></div></div>
          ${short > 0 && lines.length ? `<div class="callout warn mt">Available balance is ${esc(fmt.inrFull(money.available))}, so you need to pay <b>${esc(fmt.inrFull(short))}</b>. The order waits and releases by itself when the payment is credited.</div>` : ''}
          <div class="form-err" id="oErr">${err ? esc(err) : ''}</div>
        </div>
        <div class="modal-foot"><span class="grow">Prices are today's notified price minus dealer margin; the invoice has the final figure.</span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="oGo" ${err || !lines.length ? 'disabled style="opacity:.5"' : ''}>${st.replace ? 'Save changes' : short > 0 ? `Place order and pay ${esc(fmt.inr(short))}` : 'Place order'}</button></div>`;
      $$('[data-close]', box).forEach((b) => { b.onclick = DUI.closeModal; });
      $('#oRo', box).onchange = (e) => { st.roId = e.target.value; reset(); draw(); };
      $$('#oTk button', box).forEach((b) => { b.onclick = () => { st.truckKL = +b.dataset.kl; const c = C.trucks.find((t) => t.kl === st.truckKL).compartments[0]; Object.keys(st.lines).forEach((p) => { st.lines[p] = Math.floor(st.lines[p] / c) * c; }); draw(); }; });
      $$('[data-inc]', box).forEach((b) => { b.onclick = () => { st.lines[b.dataset.inc] += comp; draw(); }; });
      $$('[data-dec]', box).forEach((b) => { b.onclick = () => { st.lines[b.dataset.dec] = Math.max(0, st.lines[b.dataset.dec] - comp); draw(); }; });
      $('#oGo', box).onclick = () => {
        const res = Eng.actions.placeOrder(st.roId, lines, st.truckKL, st.replace && st.replace.id);
        if (res.error) { $('#oErr', box).textContent = res.error; return; }
        DUI.closeModal();
        DUI.toast(`Order ${res.order.id} placed`, res.order.status === 'placed' ? `Released: loading ${fmt.when(res.order.loadStartTs)}` : 'Waiting for payment', 'ok');
        if (res.order.status === 'awaiting_payment' && Eng.stillToPay(res.order) > 0) DUI.openPay({ amount: Eng.stillToPay(res.order), orderId: res.order.id });
        else DUI.refresh();
      };
    }
    draw();
  };

  // ---------- Pay ----------
  DUI.openPay = function (opts) {
    const amount = Math.max(0, Math.ceil((opts && opts.amount) || 0));
    const order = opts && opts.orderId && W.orderById(opts.orderId);
    const st = { mode: amount && amount < C.rtgsMinInr ? 'NEFT' : 'RTGS' };
    const k = C.collection;
    const box = DUI.modal(`${DUI.modalHead('Add money to your account', order ? `Releases ${order.id} for ${DUI.rname(order.roId)} once credited` : 'Pay from your own bank, then record the payment here')}
      <div class="modal-body">
        <div class="grid-2 pay-grid">
          <div><div class="card-title" style="margin-bottom:6px">1. Send from your bank</div>
            <div class="info-box"><div class="copy"><span>Name</span><b style="font-family:var(--sans);text-align:right">${esc(k.name)}</b></div><div class="copy"><span>Account</span><b>${esc(k.account)} <button class="icon-btn" data-copy="${esc(k.account.replace(/ /g, ''))}" aria-label="Copy account number">${I.copy}</button></b></div><div class="copy"><span>IFSC</span><b>${esc(k.ifsc)} <button class="icon-btn" data-copy="${esc(k.ifsc)}" aria-label="Copy IFSC">${I.copy}</button></b></div><div class="copy"><span>Bank</span><b style="font-family:var(--sans)">${esc(k.bank)}</b></div></div>
            <div class="faint" style="font-size:11.5px;margin-top:6px">Your own collection account: payments to it are matched to you automatically. (Demo details, not a real account.)</div></div>
          <div><div class="card-title" style="margin-bottom:6px">2. Record what you sent</div>
            <div class="form-row" style="grid-template-columns:90px 1fr"><span>Mode</span><div class="seg" id="pMode"><button data-m="RTGS" class="${st.mode === 'RTGS' ? 'active' : ''}">RTGS</button><button data-m="NEFT" class="${st.mode === 'NEFT' ? 'active' : ''}">NEFT</button></div></div>
            <div class="form-row" style="grid-template-columns:90px 1fr"><span>Amount ₹</span><input class="input num" id="pAmt" inputmode="numeric" value="${amount || ''}" placeholder="e.g. 1100000"></div>
            <div class="form-row" style="grid-template-columns:90px 1fr"><span>UTR</span><input class="input mono" id="pUtr" maxlength="22" autocomplete="off" spellcheck="false" placeholder="From your bank's confirmation"></div>
            <button class="text-btn" id="pDemo">Fill a demo UTR</button>
            <div class="form-err" id="pErr"></div></div>
        </div>
        <div class="safe-note">${I.shield}<span>Prahari never moves money and never asks for bank logins or card details. You pay from your bank's app or branch; Prahari matches the credit and releases your order.</span></div>
      </div>
      <div class="modal-foot"><span class="grow" id="pHint">${st.mode === 'RTGS' ? `RTGS: ${fmt.inr(C.rtgsMinInr)} minimum` : 'NEFT: no minimum'} · credit usually shows within ${C.paymentCreditMin} min</span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="pGo">Record payment</button></div>`);
    const setMode = (m) => { st.mode = m; $$('#pMode button', box).forEach((b) => b.classList.toggle('active', b.dataset.m === m)); $('#pUtr', box).maxLength = m === 'RTGS' ? 22 : 16; $('#pHint', box).textContent = `${m === 'RTGS' ? `RTGS: ${fmt.inr(C.rtgsMinInr)} minimum` : 'NEFT: no minimum'} · credit usually shows within ${C.paymentCreditMin} min`; };
    $$('#pMode button', box).forEach((b) => { b.onclick = () => setMode(b.dataset.m); });
    $('#pDemo', box).onclick = () => { $('#pUtr', box).value = Eng.actions.demoUtr(st.mode); };
    $$('[data-copy]', box).forEach((b) => { b.onclick = () => { try { navigator.clipboard.writeText(b.dataset.copy); DUI.toast('Copied', b.dataset.copy); } catch (e) { /* clipboard blocked */ } }; });
    $('#pGo', box).onclick = () => {
      const amt = +String($('#pAmt', box).value).replace(/[,\s₹]/g, '');
      const res = Eng.actions.recordPayment(amt, st.mode, $('#pUtr', box).value);
      if (res.error) { $('#pErr', box).textContent = res.error; return; }
      DUI.closeModal();
      DUI.toast(`${st.mode} of ${fmt.inr(amt)} recorded`, `Waiting for credit (usually ${C.paymentCreditMin} min). Speed up the demo clock to see it land.`, 'ok');
      DUI.refresh();
    };
  };

  // ---------- Receipt ----------
  DUI.openReceipt = function (id) {
    const o = W.orderById(id);
    if (!o || o.status !== 'awaiting_receipt') { DUI.toast('Nothing to confirm', 'This delivery is already closed.'); return; }
    const ro = W.byId(o.roId);
    const rows = o.lines.map((l) => {
      const inv = l.kl * 1000, got = o.atgReceivedL[l.product], short = inv - got, allowed = inv * C.transitLossFraction;
      const dd = o.densityObs[l.product];
      return { p: l.product, inv, got, short, allowed, dd, claim: short > allowed, dBad: Math.abs(dd) > C.densityToleranceKgM3 };
    });
    const claimable = rows.filter((r) => r.claim);
    const value = claimable.reduce((a, r) => a + r.short * U.purchasePrice(r.p), 0);
    const box = DUI.modal(`${DUI.modalHead(`Receipt of ${o.id}`, `${ro.name} · invoice ${o.invoice ? o.invoice.no : '—'} · truck ${o.truck ? o.truck.plate : '—'}`)}
      <div class="modal-body"><table class="t"><thead><tr><th>Product</th><th class="r">Invoiced</th><th class="r">Gauge measured</th><th class="r">Short</th><th class="r">Allowed</th><th class="r">Density vs invoice</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="l">${esc(pname(r.p))}</td><td class="r">${esc(fmt.L(r.inv))}</td><td class="r">${esc(fmt.L(r.got))}</td><td class="r ${r.claim ? 'c-crit' : ''}">${esc(fmt.L(r.short))}</td><td class="r">${esc(fmt.L(r.allowed))}</td><td class="r ${r.dBad ? 'c-crit' : ''}">${r.dd >= 0 ? '+' : ''}${r.dd} kg/m³</td></tr>`).join('')}
      </tbody></table>
      <label style="display:flex;gap:8px;align-items:center;margin-top:14px;font-size:12.5px"><input type="checkbox" id="rSeal" checked> Seals were intact on arrival and the dip before unloading matched the gauge</label>
      ${claimable.length ? `<div class="callout crit mt">The gauge shows more loss than the ${(C.transitLossFraction * 100).toFixed(2)}% allowed. You can claim <b>${esc(fmt.inrFull(value))}</b>; the claim goes to the Sales Officer with these readings. Window closes ${esc(fmt.when(o.unloadedTs + C.claimWindowHours * HOUR))}.</div>` : '<div class="callout mt">All readings are within tolerance.</div>'}
      ${rows.some((r) => r.dBad) ? `<div class="callout warn">Density differs by more than ±${C.densityToleranceKgM3} kg/m³: keep the tank closed and ask for a sample test.</div>` : ''}</div>
      <div class="modal-foot"><button class="btn ghost" data-close>Later</button>${claimable.length ? `<button class="btn" id="rOk">Confirm without claim</button><button class="btn primary" id="rClaim">Raise claim for ${esc(fmt.inr(value))}</button>` : '<button class="btn primary" id="rOk">Confirm receipt</button>'}</div>`);
    const done = (claim) => {
      const res = Eng.actions.recordReceipt(id, claim);
      if (res.error) { DUI.toast(res.error); return; }
      DUI.closeModal();
      DUI.toast(claim ? `Claim raised for ${fmt.inr(value)}` : 'Receipt confirmed', claim ? 'The Sales Officer will verify it; the credit note lands in your ledger.' : `${o.id} closed`, 'ok');
      DUI.refresh();
    };
    $('#rOk', box).onclick = () => done(false);
    if ($('#rClaim', box)) $('#rClaim', box).onclick = () => done(true);
  };

  // ---------- Order detail ----------
  DUI.openOrderDetail = function (id) {
    const o = W.orderById(id);
    if (!o) return;
    const ro = W.byId(o.roId);
    const order = ['awaiting_payment', 'placed', 'loading', 'in_transit', 'unloading', 'awaiting_receipt', 'received'];
    const at = o.status === 'claim_raised' ? 5 : order.indexOf(o.status);
    const steps = [['Placed', o.createdTs], ['Released', o.releasedTs], ['Loading', o.loadStartTs], ['On the way', o.dispatchTs], ['Unloaded', o.unloadedTs], ['Received', o.receipt && o.receipt.ts]];
    const idx = Math.max(0, at === 0 ? 0 : at === 1 ? 1 : at === 2 ? 2 : at === 3 || at === 4 ? 3 : at === 5 ? 4 : 5);
    const box = DUI.modal(`${DUI.modalHead(o.id, `${ro.name} · ${lineText(o.lines)} · ${o.truckKL} KL truck`)}
      <div class="modal-body">${o.status === 'cancelled' ? '<div class="callout">This order was cancelled.</div>' : `<div class="steps">${steps.map(([l, ts], i) => `<div class="step ${i < idx || (i === idx && o.status === 'received') ? 'done' : i === idx ? 'now' : ''}">${l}<small>${ts && i <= idx ? esc(fmt.dt(ts)) : '&nbsp;'}</small></div>`).join('')}</div>`}
        <div class="kv mt" style="grid-template-columns:150px 1fr"><span>Status</span><b style="font-weight:500"><span class="status ${STATUS[o.status][1]}">${esc(STATUS[o.status][0])}</span> · ${esc(nextStep(o))}</b>
          <span>Value</span><b style="font-weight:500">${esc(fmt.inrFull(o.value))}</b>
          <span>Supply point</span><b style="font-weight:500">${esc(DB.depotById(o.depotId).name)}</b>
          ${o.invoice ? `<span>Invoice</span><b style="font-weight:500" class="mono">${esc(o.invoice.no)} · ${esc(fmt.dmy(o.invoice.ts))}</b>` : ''}
          ${o.truck ? `<span>Truck</span><b style="font-weight:500">${esc(o.truck.plate)} · ${esc(o.truck.transporter)}</b><span>Driver</span><b style="font-weight:500">${esc(o.truck.driver)} · ${esc(o.truck.phone)}</b>` : ''}
          ${o.receipt && o.receipt.claim ? `<span>Claim</span><b style="font-weight:500">${esc(fmt.inrFull(o.receipt.claim.value))} · ${esc(o.receipt.claim.status)}</b>` : ''}</div></div>
      <div class="modal-foot">${o.status === 'awaiting_payment' || o.status === 'placed' ? '<button class="btn danger" id="dCancel">Cancel order</button>' : ''}<span class="grow"></span>
        ${o.status === 'awaiting_payment' && Eng.stillToPay(o) > 0 ? `<button class="btn primary" id="dPay">Pay ${esc(fmt.inr(Eng.stillToPay(o)))}</button>` : ''}
        ${ACTIVE.includes(o.status) ? '<button class="btn primary" id="dTrack">Track truck</button>' : ''}
        ${o.status === 'awaiting_receipt' ? '<button class="btn primary" id="dRec">Record receipt</button>' : ''}
        <button class="btn ghost" data-close>Close</button></div>`);
    const b = (sel, fn) => { const el = $(sel, box); if (el) el.onclick = fn; };
    b('#dPay', () => DUI.openPay({ amount: Eng.stillToPay(o), orderId: o.id }));
    b('#dTrack', () => { DUI.closeModal(); DUI.selectTruck(o.id); });
    b('#dRec', () => DUI.openReceipt(o.id));
    b('#dCancel', () => { const res = Eng.actions.cancelOrder(o.id); DUI.closeModal(); DUI.toast(res.error || `Order ${o.id} cancelled`); DUI.refresh(); });
  };

  DUI.nextStep = nextStep;
  DUI.progress = progress;
  DUI.lineText = lineText;
})();
