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
  DUI.invoiceRows = invoiceRows;
  DUI.downloadCsv = downloadCsv;

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
      DUI.state.thread = r.thread.id; DUI.setView('messages');
    };
  };
})();
