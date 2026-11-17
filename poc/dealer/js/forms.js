/* =====================================================================
   PRAHARI for dealers — toasts, modal and the forms behind recommendation actions
   (price confirmation, service complaint, action-taken report, renewal, observation,
   "not relevant" reason, morning brief). Orders, payment and receipts are in orders.js.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.DCFG;
  const W = window.DW;
  const { $, $$, esc, I, fmt, pname, rname } = DUI;
  // ---------- Toasts and modal (same components as the Sales Officer dashboard) ----------
  DUI.toast = function (title, sub, kind) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<div style="display:flex;gap:9px"><i class="dot ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : kind === 'crit' ? 'crit' : 'off'}"></i><div>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, 4200);
  };
  let lastFocus = null;
  DUI.modal = function (html, size) {
    const m = $('#modal'), box = $('.modal-box', m);
    lastFocus = document.activeElement;
    box.className = 'modal-box ' + (size || 'narrow');
    box.innerHTML = html;
    m.classList.remove('hidden');
    const first = box.querySelector('input, select, textarea, button.primary');
    if (first) setTimeout(() => first.focus(), 30);
    $$('[data-close]', box).forEach((b) => { b.onclick = DUI.closeModal; });
    return box;
  };
  DUI.closeModal = function () {
    $('#modal').classList.add('hidden');
    $('.modal-box', $('#modal')).innerHTML = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };
  DUI.modalHead = (title, sub) => `<div class="modal-head"><div class="grow"><div style="font-weight:600;font-size:14.5px">${esc(title)}</div>${sub ? `<div class="faint" style="font-size:12px;margin-top:1px">${esc(sub)}</div>` : ''}</div><button class="icon-btn" data-close aria-label="Close">${I.x}</button></div>`;
  DUI.isModalOpen = () => !$('#modal').classList.contains('hidden');


  DUI.runAction = function (r) {
    const a = r.action;
    if (a.kind === 'pay') DUI.openPay({ amount: a.amount, orderId: a.orderId });
    else if (a.kind === 'order') DUI.openOrder(a.roId);
    else if (a.kind === 'receipt') DUI.openReceipt(a.orderId);
    else if (a.kind === 'escalate') DUI.openCompose({ cat: a.cat, subject: a.subject, text: a.text, roId: r.roId });
    else if (a.kind === 'view') DUI.selectOutlet(a.roId, a.tab || 'overview');
    else if (a.kind === 'price') confirmPrice(a);
    else if (a.kind === 'ticket') confirmTicket(a);
    else if (a.kind === 'atr') DUI.openAtr(a.roId, a.logId);
    else if (a.kind === 'renewal') openRenewal(a);
    else if (a.kind === 'observation') openObservation(a);
  };
  function confirmPrice(a) {
    const ro = W.byId(a.roId), pr = ro.prices[a.product];
    const box = DUI.modal(`${DUI.modalHead('Confirm the price update', `${ro.name} · ${pname(a.product)}`)}
      <div class="modal-body"><p class="lead" style="margin-top:0">Set <b>${esc(pname(a.product))}</b> to <b>₹${pr.rsp.toFixed(2)}</b> on every dispenser and preset at ${esc(ro.name)}, then confirm here.</p>
      <div class="callout">The pump's automation reports the new price at its next sync; Prahari records your confirmation now with the time, for the inspection record.</div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>Not yet</button><button class="btn primary" id="okPrice">${I.check} The pump now shows ₹${pr.rsp.toFixed(2)}</button></div>`);
    $('#okPrice', box).onclick = () => { Eng.actions.updatePrice(a.roId, a.product); DUI.closeModal(); DUI.toast('Price update recorded', `${ro.name}: ${pname(a.product)} ₹${pr.rsp.toFixed(2)}`, 'ok'); DUI.refresh(); };
  }
  function confirmTicket(a) {
    const box = DUI.modal(`${DUI.modalHead('Raise a service complaint', rname(a.roId))}
      <div class="modal-body"><div class="form-row"><span>Subject</span><input class="input" id="tkSub" value="${esc(a.subject)}"></div>
      <div class="form-row" style="align-items:start"><span>Details</span><textarea class="input" id="tkText" rows="3">${esc(a.text)}</textarea></div>
      <div class="faint" style="font-size:12px">Goes to the Sales Officer and the service desk. You'll see replies under Messages.</div><div class="form-err" id="tkErr"></div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="tkGo">${I.send} Raise complaint</button></div>`);
    $('#tkGo', box).onclick = () => {
      const subject = $('#tkSub', box).value.trim(), text = $('#tkText', box).value.trim();
      if (!subject || !text) { $('#tkErr', box).textContent = 'Add a subject and details.'; return; }
      Eng.actions.raiseTicket(Object.assign({}, a, { subject, text }));
      DUI.closeModal(); DUI.toast('Complaint raised', subject, 'ok'); DUI.refresh();
    };
  }
  DUI.openAtr = function (roId, logId) {
    const ro = W.byId(roId), l = ro.logs.find((x) => x.id === logId);
    const box = DUI.modal(`${DUI.modalHead('Action-taken report', `${ro.name} · ${l.du} · ${l.type}`)}
      <div class="modal-body"><div class="callout warn">${esc(l.text)} <span class="faint">Logged ${esc(fmt.when(l.ts))}.</span></div>
      <div class="form-row" style="align-items:start"><span>What happened and what you did</span><textarea class="input" id="atrText" rows="4" placeholder="e.g. Power surge at 02:10 tripped the controller. Restarted by the night manager; totalizers checked against the 22:00 reading, no difference."></textarea></div>
      <div class="form-err" id="atrErr"></div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="atrGo">File report</button></div>`);
    $('#atrGo', box).onclick = () => {
      const res = Eng.actions.writeAtr(roId, logId, $('#atrText', box).value);
      if (res.error) { $('#atrErr', box).textContent = res.error; return; }
      DUI.closeModal(); DUI.toast('Action-taken report filed', `${l.type} on ${l.du}`, 'ok'); DUI.refresh();
    };
  };
  function openRenewal(a) {
    const ro = W.byId(a.roId), c = ro.compliance.find((x) => x.key === a.key);
    const min = new Date(Eng.now + 86400000 + 19800000).toISOString().slice(0, 10);
    const max = new Date(Math.max(c.due, Eng.now + 86400000) + 19800000).toISOString().slice(0, 10);
    const box = DUI.modal(`${DUI.modalHead('Book the renewal', `${ro.name} · ${c.label}`)}
      <div class="modal-body"><div class="form-row"><span>${c.due < Eng.now ? 'Expired' : 'Expires'}</span><b>${esc(fmt.date(c.due))}</b></div>
      <div class="form-row"><span>Inspection date</span><input class="input" type="date" id="rnDate" min="${min}" max="${max}" value="${min}"></div>
      <div class="faint" style="font-size:12px">Prahari tells the Sales Officer and reminds you the day before.</div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rnGo">Book</button></div>`);
    $('#rnGo', box).onclick = () => {
      const v = $('#rnDate', box).value;
      const ts = v ? Date.parse(v + 'T10:00:00+05:30') : Eng.now + 86400000;
      Eng.actions.bookRenewal(a.roId, a.key, ts);
      DUI.closeModal(); DUI.toast('Renewal booked', `${c.label} · ${fmt.date(ts)}`, 'ok'); DUI.refresh();
    };
  }
  function openObservation(a) {
    const ro = W.byId(a.roId), ob = ro.observations[a.index];
    const box = DUI.modal(`${DUI.modalHead('Close the observation', ro.name)}
      <div class="modal-body"><div class="callout">${esc(ob.text)}</div>
      <div class="form-row" style="align-items:start"><span>What was done</span><textarea class="input" id="obNote" rows="3" placeholder="e.g. Both extinguishers refilled on 14 Nov; refill tags photographed."></textarea></div>
      <div class="form-row"><span>Photo or receipt</span><input class="input" type="file" accept="image/*,.pdf" id="obFile"></div>
      <div class="faint" style="font-size:12px">Demo: the file stays in your browser and is not uploaded.</div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="obGo">${I.check} Mark fixed</button></div>`);
    $('#obGo', box).onclick = () => {
      const f = $('#obFile', box).files[0];
      Eng.actions.closeObservation(a.roId, a.index, ($('#obNote', box).value.trim() + (f ? ` Attached: ${f.name}.` : '')).trim());
      DUI.closeModal(); DUI.toast('Observation closed', ro.name, 'ok'); DUI.refresh();
    };
  }


  function dismiss(key) {
    const box = DUI.modal(`${DUI.modalHead('Not relevant?', 'Your reason helps tune these suggestions')}
      <div class="modal-body"><div class="chips" id="rsn">${['Already handled outside Prahari', 'The data is wrong', 'Not important for my outlet', 'Other'].map((t, i) => `<button class="chip${i === 0 ? ' active' : ''}">${esc(t)}</button>`).join('')}</div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rsnGo">Hide it</button></div>`);
    $$('#rsn .chip', box).forEach((c) => { c.onclick = () => { $$('#rsn .chip', box).forEach((x) => x.classList.remove('active')); c.classList.add('active'); }; });
    $('#rsnGo', box).onclick = () => { Eng.actions.setRec(key, 'dismissed', $('#rsn .chip.active', box).textContent); DUI.closeModal(); DUI.refresh(); };
  }

  DUI.dismiss = dismiss;

  // ---------- Morning brief ----------
  DUI.briefText = function () {
    const recs = Eng.recommendations().filter((r) => DUI.inScope(r.roId));
    const h = W.util.istHour(Eng.now);
    const greet = h < 4 ? 'Hello' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const first = W.dealer.name.split(' ')[0];
    const yday = W.ros.reduce((a, ro) => a + (ro.hist[ro.hist.length - 1] || { total: 0 }).total, 0);
    const avg = W.ros.reduce((a, ro) => a + ro.hist.slice(-7).reduce((s, x) => s + x.total, 0) / 7, 0);
    return { greet: `${greet}, ${first}`, recs, yday, vs: avg ? yday / avg - 1 : 0 };
  };
  DUI.openBrief = function () {
    const b = DUI.briefText();
    const top = b.recs.slice(0, 3);
    const msg = `*Prahari · ${b.greet}*\n\nYesterday: ${fmt.kl(b.yday)} across your ${W.ros.length} outlets (${b.vs >= 0 ? '+' : ''}${Math.round(b.vs * 100)}% vs your weekly average).\n\n${top.length ? `${top.length} thing${top.length > 1 ? 's' : ''} to do first:\n${top.map((r, i) => `${i + 1}. ${r.title}`).join('\n')}` : 'Nothing urgent today.'}\n\nOpen Prahari to act on them.`;
    DUI.modal(`${DUI.modalHead('Morning brief', 'Preview of the daily message (sent at 07:00 by WhatsApp or app notification)')}
      <div class="modal-body"><div class="brief-phone"><div class="brief-bubble">${esc(msg).replace(/\*(.+?)\*/g, '<b>$1</b>')}<small>07:00</small></div></div>
      <p class="faint" style="font-size:12px;text-align:center;margin-top:12px">Demo preview. Sending needs a WhatsApp Business account; the in-app version is the Priorities list.</p></div>`);
  };

})();
