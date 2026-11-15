/* =====================================================================
   PRAHARI for dealers — account (balance, payments, ledger, invoices) and messages
   ===================================================================== */
(function () {
  'use strict';
  const C = window.DCFG;
  const W = window.DW;
  const { PRODUCTS } = DB;
  const { $, $$, esc, I, fmt, pname } = DUI;

  // ---------- Account ----------
  /** Invoice lines in the oil company's invoice-register layout (one row per product line). */
  function invoiceRows() {
    return W.orders.filter((o) => o.invoice && DUI.inScope(o.roId)).sort((a, b) => b.invoice.ts - a.invoice.ts).flatMap((o) => {
      const ro = W.byId(o.roId);
      return o.lines.map((l) => ({ ro, o, l, qtyL: l.kl * 1000 }));
    });
  }
  function downloadCsv() {
    const head = ['RO Code', 'RO Name', 'Class of Market', 'Product', 'Invoice No', 'Invoice Date', 'Quantity (Ltrs)'];
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = invoiceRows().map((r) => [r.ro.id, `${r.ro.id} ${r.ro.name.toUpperCase()}`, r.ro.marketClass, r.l.product, r.o.invoice.no, fmt.dmy(r.o.invoice.ts), r.qtyL].map(q).join(','));
    const blob = new Blob([[head.map(q).join(',')].concat(rows).join('\r\n') + '\r\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prahari-demo-invoices-${fmt.dmy(Eng.now)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  DUI.view('account', {
    render() {
      const money = Eng.money();
      let bal = 0;
      const ledger = W.ledger.slice().sort((a, b) => a.ts - b.ts).map((e) => { bal += e.credit - e.debit; return Object.assign({ bal }, e); }).reverse();
      const k = C.collection;
      return `<div class="page">
        <div class="page-head"><div class="grow"><h1 class="page-title">Account</h1><div class="page-sub">${esc(W.dealer.name)} · dealer account ${esc(W.dealer.code)} · prepaid balance with the oil company</div></div>${DUI.asOf()}<button class="btn primary sm" data-pay="0">${I.plus} Add money</button></div>
        <div class="summary-row"><div><div class="l">Balance</div><div class="v">${esc(fmt.inrFull(money.balance))}</div></div><div><div class="l">Held for released orders</div><div class="v">${esc(fmt.inrFull(money.blocked))}</div></div><div><div class="l">Available for orders</div><div class="v ${money.available < 0 ? 'c-crit' : ''}">${esc(fmt.inrFull(money.available))}</div></div><div><div class="l">Waiting for credit</div><div class="v ${money.pending ? 'c-warn' : ''}">${esc(fmt.inrFull(money.pending))}</div></div></div>
        <div class="grid-2 acct-grid">
          <div class="card"><div class="card-title">Your collection account</div><div class="card-sub">Pay by RTGS or NEFT from your bank, then record the UTR</div>
            <div class="copy"><span>Name</span><b style="font-family:var(--sans)">${esc(k.name)}</b></div><div class="copy"><span>Account</span><b>${esc(k.account)}</b></div><div class="copy"><span>IFSC</span><b>${esc(k.ifsc)}</b></div><div class="copy"><span>Bank</span><b style="font-family:var(--sans)">${esc(k.bank)}</b></div>
            <div class="safe-note">${I.shield}<span>Prahari never holds or moves money. (Demo account details.)</span></div></div>
          <div class="card"><div class="card-title">Payments</div><div class="card-sub">Recorded by you, matched when the bank credit arrives</div>
            <div class="table-scroll"><table class="t compact"><thead><tr><th>Sent</th><th>Mode</th><th>UTR</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>${W.payments.map((p) => `<tr><td>${esc(fmt.dt(p.ts))}</td><td>${esc(p.mode)}</td><td class="mono">${esc(p.utr)}</td><td class="r">${esc(fmt.inrFull(p.amount))}</td><td><span class="status ${p.status === 'credited' ? 'ok' : 'warn'}">${p.status === 'credited' ? 'Credited ' + esc(fmt.hm(p.creditedTs)) : 'Waiting for credit'}</span></td></tr>`).join('')}</tbody></table></div></div>
        </div>
        <div class="card flush mt"><div class="card-head"><h3>Ledger</h3><span class="aside">Invoices, payments and credit notes with a running balance</span></div>
          <div class="card-body table-scroll"><table class="t"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Outlet</th><th>Details</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>
          ${ledger.filter((e) => DUI.inScope(e.roId)).map((e) => `<tr><td>${esc(fmt.dmy(e.ts))}</td><td>${esc(e.type)}</td><td class="mono">${esc(e.ref)}</td><td>${e.roId ? esc(e.roId) : '—'}</td><td class="faint">${esc(e.note)}</td><td class="r">${e.debit ? esc(fmt.inrFull(e.debit)) : ''}</td><td class="r c-ok">${e.credit ? esc(fmt.inrFull(e.credit)) : ''}</td><td class="r">${esc(fmt.inrFull(e.bal))}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card flush mt"><div class="card-head"><h3>Invoices</h3><button class="btn sm" id="csvBtn">${I.download} Download CSV</button></div>
          <div class="card-body table-scroll"><table class="t"><thead><tr><th>RO code</th><th>Outlet</th><th>Class of market</th><th>Product</th><th>Invoice no</th><th>Invoice date</th><th class="r">Quantity (L)</th></tr></thead><tbody>
          ${invoiceRows().map((r) => `<tr class="row" data-order="${esc(r.o.id)}"><td>${esc(r.ro.id)}</td><td class="l">${esc(r.ro.name)}</td><td>${esc(r.ro.marketClass)}</td><td>${esc(r.l.product)}</td><td class="mono">${esc(r.o.invoice.no)}</td><td>${esc(fmt.dmy(r.o.invoice.ts))}</td><td class="r">${r.qtyL.toLocaleString('en-IN')}</td></tr>`).join('')}</tbody></table></div></div>
      </div>`;
    },
    mount(v) { $('#csvBtn', v).onclick = downloadCsv; },
  });

  // ---------- Messages with the Sales Officer ----------
  function threadList() {
    const ts = W.threads.filter((t) => DUI.inScope(t.roId));
    return ts.map((t) => { const last = t.msgs[t.msgs.length - 1]; return `<button class="thread ${DUI.state.thread === t.id ? 'active' : ''}" data-th="${esc(t.id)}"><b>${t.unread ? '<i class="dot"></i>' : ''}${esc(t.subject)}</b><small>${esc(t.cat)}${t.roId ? ' · ' + esc(t.roId) : ''} · ${esc(fmt.ago(last.ts))} · ${esc(last.text)}</small></button>`; }).join('') || '<div class="empty">No messages yet.</div>';
  }
  function convo(t) {
    if (!t) return '<div class="empty" style="margin:auto">Choose a conversation, or start a new request.</div>';
    return `<div class="convo-head"><b>${esc(t.subject)}</b><div class="faint" style="font-size:12px">${esc(t.cat)}${t.roId ? ' · ' + esc(DUI.rname(t.roId)) : ''} · with ${esc(W.officer)} · ${esc(t.status)}</div></div>
      <div class="bubbles" id="bubbles">${t.msgs.map((m) => `<div class="bubble ${m.from === 'dealer' ? 'me' : ''}">${esc(m.text)}<small>${esc(m.who)} · ${esc(fmt.dt(m.ts))}</small></div>`).join('')}
      ${t.msgs[t.msgs.length - 1].from === 'dealer' ? '<div class="faint typing" style="font-size:12px">Sent. The Sales Officer usually replies within the hour.</div>' : ''}</div>
      <div class="composer"><textarea class="input" id="reply" rows="2" placeholder="Reply to the Sales Officer"></textarea><button class="btn primary" id="sendBtn">${I.send} Send</button></div>`;
  }
  // root: the element whose buttons need handlers; v: the view, which draw() always needs.
  function bindMsgs(root, v) {
    v = v || root;
    $$('[data-th]', root).forEach((b) => { b.onclick = () => { DUI.state.thread = b.dataset.th; const t = W.threads.find((x) => x.id === b.dataset.th); if (t) t.unread = false; draw(v, true); }; });
    const send = $('#sendBtn', root);
    if (send) send.onclick = () => { const r = Eng.actions.sendMessage(DUI.state.thread, $('#reply', v).value); if (r.error) { DUI.toast(r.error); return; } draw(v, true); };
    const nb = $('#newReq', root);
    if (nb) nb.onclick = () => DUI.openCompose({});
    const bub = $('#bubbles', root);
    if (bub) bub.scrollTop = bub.scrollHeight;
  }
  let lastKey = '';
  function draw(v, force) {
    const t = W.threads.find((x) => x.id === DUI.state.thread);
    const key = W.threads.map((x) => x.id + x.msgs.length + (x.unread ? 1 : 0)).join('|') + DUI.state.thread + DUI.state.scope;
    if (!force && key === lastKey) { const l = $('.threads', v); if (l && !l.matches(':hover')) { l.innerHTML = threadList(); bindMsgs(l, v); } return; }
    lastKey = key;
    const draft = $('#reply', v) ? $('#reply', v).value : '';
    $('.threads', v).innerHTML = threadList();
    $('.convo', v).innerHTML = convo(t);
    if (draft && $('#reply', v) && !force) $('#reply', v).value = draft;
    bindMsgs(v);
  }
  DUI.view('messages', {
    render() {
      if (!DUI.state.thread && W.threads[0]) DUI.state.thread = W.threads[0].id;
      const t = W.threads.find((x) => x.id === DUI.state.thread);
      if (t) t.unread = false;
      return `<div class="page"><div class="page-head"><div class="grow"><h1 class="page-title">Messages</h1><div class="page-sub">Requests, complaints and claims with ${esc(W.officer)}. Everything is timestamped for the record.</div></div><button class="btn primary sm" id="newReq">${I.plus} New request</button></div>
        <div class="msg-wrap"><div class="threads">${threadList()}</div><div class="convo">${convo(t)}</div></div></div>`;
    },
    mount(v) { lastKey = ''; bindMsgs(v); draw(v, true); },
    update(v) {
      const t = W.threads.find((x) => x.id === DUI.state.thread);
      if (t && t.unread) t.unread = false;
      draw(v, false);
    },
  });

  // ---------- New request ----------
  DUI.openCompose = function (pre) {
    const p = pre || {};
    const cats = ['Supply', 'Payment', 'Service', 'Compliance', 'Claim', 'Other'];
    const box = DUI.modal(`${DUI.modalHead('Message the Sales Officer', W.officer)}
      <div class="modal-body">
        <div class="form-row"><span>About</span><select class="input" id="cCat">${cats.map((c) => `<option${c === (p.cat || 'Other') ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="form-row"><span>Outlet</span><select class="input" id="cRo"><option value="">All outlets</option>${W.ros.map((r) => `<option value="${esc(r.id)}"${r.id === p.roId ? ' selected' : ''}>${esc(r.name)} · ${esc(r.id)}</option>`).join('')}</select></div>
        <div class="form-row"><span>Subject</span><input class="input" id="cSub" value="${esc(p.subject || '')}"></div>
        <div class="form-row" style="align-items:start"><span>Message</span><textarea class="input" id="cText" rows="4">${esc(p.text || '')}</textarea></div>
        <div class="form-err" id="cErr"></div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="cGo">${I.send} Send</button></div>`);
    $('#cGo', box).onclick = () => {
      const subject = $('#cSub', box).value.trim();
      if (!subject) { $('#cErr', box).textContent = 'Add a subject.'; return; }
      const r = Eng.actions.sendMessage(null, $('#cText', box).value, { cat: $('#cCat', box).value, subject, roId: $('#cRo', box).value || null });
      if (r.error) { $('#cErr', box).textContent = r.error; return; }
      DUI.closeModal();
      DUI.toast('Sent to the Sales Officer', subject, 'ok');
      DUI.go('messages', { thread: r.thread.id });
    };
  };
})();
