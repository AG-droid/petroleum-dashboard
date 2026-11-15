/* =====================================================================
   PRAHARI for dealers — interface shell, shared helpers and the Today view
   Views register themselves with DUI.view(name, {render, mount, update}). The active view
   re-renders on every simulation tick unless it provides its own update() (map, chat).
   ===================================================================== */
(function () {
  'use strict';
  const C = window.DCFG;
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
    alert: ic('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/>', 14),
    rupee: ic('<path d="M7 5h10M7 9h10M9 5c5 0 5 8 0 8H7l7 7"/>', 14),
    check: ic('<path d="m5 12 5 5 9-10"/>', 14),
    clock: ic('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', 14),
    info: ic('<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8v.5"/>', 14),
    truck: ic('<path d="M2 7h11v9H2zM13 10h4l4 4v2h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>', 14),
    msg: ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', 14),
    shield: ic('<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/>', 14),
    copy: ic('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', 13),
    back: ic('<path d="m15 6-6 6 6 6"/>', 14),
    phone: ic('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 14),
    plus: ic('<path d="M12 5v14M5 12h14"/>', 14),
    print: ic('<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/>', 14),
    download: ic('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 14),
    send: ic('<path d="M4 12 20 4l-6 16-3-7z"/>', 14),
  };
  const SEV_DOT = { critical: 'crit', high: 'crit', medium: 'warn', low: 'off' };
  const PCOLOR = { MS: 'var(--ms)', HSD: 'var(--hsd)', XP: 'var(--xp)' };
  const PHEX = { MS: '#57b583', HSD: '#e0a645', XP: '#a48bf0' };
  const STATUS = {
    awaiting_payment: ['Waiting for payment', 'warn'], placed: ['Released, waiting to load', 'acc'], loading: ['Loading at supply point', 'acc'],
    in_transit: ['On the way', 'acc'], unloading: ['Unloading', 'acc'], awaiting_receipt: ['Confirm receipt', 'warn'],
    received: ['Received', 'ok'], claim_raised: ['Claim raised', 'warn'], cancelled: ['Cancelled', 'off'],
  };

  const fmt = {
    hm: F.hm, when: F.when, inr: F.inr, L: F.litres, hrs: F.hrs,
    inrFull: (v) => '₹' + Math.round(v).toLocaleString('en-IN'),
    kl: (L) => (L / 1000).toFixed(L < 10000 ? 2 : 1) + ' KL',
    date: (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }),
    dmy: (ts) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ }).replace(/\//g, '-'),
    dt: (ts) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }),
    ago: (ts) => { const m = Math.max(0, Math.round((Eng.now - ts) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; },
    days: (d) => d == null ? '—' : d < 1 ? (d * 24).toFixed(1) + ' h' : d.toFixed(1) + ' days',
    pct: (v) => Math.round(v * 100) + '%',
  };
  const pname = (p) => PRODUCTS[p].name;
  const rname = (id) => { const r = W.byId(id); return r ? r.name : ''; };

  const DUI = {
    state: { view: 'today', scope: 'all', ro: null, tab: 'stock', open: new Set(), seen: new Set(), thread: null, selTruck: null },
    views: {}, $, $$, esc, I, fmt, pname, rname, PCOLOR, PHEX, STATUS, SEV_DOT,
    view(name, def) { this.views[name] = def; },
  };

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

  // ---------- Navigation ----------
  DUI.go = function (view, opts) {
    const s = DUI.state;
    const prev = s.view;
    const def = DUI.views[view] || DUI.views.today;
    if (DUI.views[prev] && DUI.views[prev].unmount) DUI.views[prev].unmount();
    s.view = DUI.views[view] ? view : 'today';
    Object.assign(s, opts || {});
    $$('#rail button').forEach((b) => b.classList.toggle('active', b.dataset.view === (s.view === 'outlet' ? 'outlets' : s.view)));
    const v = $('#view');
    v.scrollTop = 0;
    v.innerHTML = lastHtml = def.render();
    if (def.mount) def.mount(v);
    bindCommon(v);
    const h = s.view === 'outlet' ? `outlet=${s.ro}&tab=${s.tab}` : `view=${s.view}`;
    if (location.hash.slice(1) !== h) history.replaceState(null, '', '#' + h);
  };
  DUI.refresh = function () {
    const def = DUI.views[DUI.state.view];
    if (!def) return;
    const v = $('#view');
    if (pointerDown) return;
    if (def.update) { def.update(v); return; }
    // Keep the reader's place: re-render in place and restore the scroll position.
    // Skip identical output; never swap the DOM under a pressed pointer (it would eat the click).
    const html = def.render();
    if (html === lastHtml) return;
    const y = v.scrollTop;
    v.innerHTML = html;
    lastHtml = html;
    if (def.mount) def.mount(v);
    bindCommon(v);
    v.scrollTop = y;
  };
  let lastHtml = '', pointerDown = false;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', () => { pointerDown = false; }, true);
  document.addEventListener('pointercancel', () => { pointerDown = false; }, true);

  // ---------- Recommendation card ----------
  const CAT_TAG = { Supply: '', Payment: '', Integrity: 'crit', Equipment: '', Quality: 'warn', Compliance: '', Sales: '' };
  DUI.recCard = function (r, i, compact) {
    const open = DUI.state.open.has(r.key);
    const roTag = r.roId ? `<span class="tag">${esc(rname(r.roId))} · ${esc(r.roId)}</span>` : '';
    const sideEffect = ['pay', 'order', 'price', 'ticket', 'atr', 'receipt', 'renewal', 'observation'].includes(r.action.kind);
    const isNew = !DUI.state.seen.has(r.key);
    DUI.state.seen.add(r.key);
    return `<article class="rec ${r.sev}${compact ? ' compact' : ''}${isNew ? ' new' : ''}" data-key="${esc(r.key)}">
      <div class="sev"></div>
      <div>
        <div class="rec-top">${i != null ? `<span class="rec-n">${i + 1}</span>` : ''}<span class="tag ${CAT_TAG[r.cat] || ''}">${esc(r.cat)}</span>${roTag}${r.deadline ? `<span class="tag">${I.clock} ${esc(fmt.when(r.deadline))}</span>` : ''}</div>
        <div class="rec-title">${esc(r.title)}</div>
        <div class="rec-why">${esc(r.why)}</div>
        <div class="rec-impact">${I.rupee}<span>${esc(r.impact)}</span></div>
        ${open ? `<div class="rec-ev"><div class="faint" style="font-size:11.5px;margin-bottom:6px">The numbers behind this</div><div class="kv">${r.evidence.map(([k, v]) => `<span>${esc(k)}</span><b style="font-weight:500">${esc(v)}</b>`).join('')}</div></div>` : ''}
        <div class="rec-actions">
          <button class="btn primary sm" data-act="${esc(r.key)}">${esc(r.action.label)}</button>
          <button class="btn ghost sm" data-why="${esc(r.key)}">${open ? 'Hide numbers' : 'Show me why'}</button>
          <span class="spacer"></span>
          ${sideEffect ? '' : `<button class="text-btn" data-done="${esc(r.key)}">Done</button>`}
          <button class="text-btn" data-snooze="${esc(r.key)}">Snooze 2 h</button>
          <button class="text-btn" data-dismiss="${esc(r.key)}">Not relevant</button>
        </div>
      </div>
    </article>`;
  };
  /** Run a recommendation's action: opens the right form, pre-filled. */
  DUI.runAction = function (r) {
    const a = r.action;
    if (a.kind === 'pay') DUI.openPay({ amount: a.amount, orderId: a.orderId });
    else if (a.kind === 'order') DUI.openOrder(a.roId);
    else if (a.kind === 'receipt') DUI.openReceipt(a.orderId);
    else if (a.kind === 'escalate') DUI.openCompose({ cat: a.cat, subject: a.subject, text: a.text, roId: r.roId });
    else if (a.kind === 'view') DUI.go('outlet', { ro: a.roId, tab: a.tab || 'stock' });
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

  // ---------- Shared bits for views ----------
  // Shared buttons are handled by one delegated listener on #view (see DUI.init), so they keep
  // working however often the view re-renders. Views only bind their own, view-specific controls.
  const SHARED = '[data-act],[data-why],[data-done],[data-snooze],[data-dismiss],[data-ro],[data-go],[data-order],[data-pay],[data-neworder]';
  function onViewClick(e) {
    const el = e.target.closest(SHARED);
    if (!el || !$('#view').contains(el)) return;
    const d = el.dataset;
    const find = (k) => Eng.allRules().find((x) => x.key === k);
    if (d.act != null) { const r = find(d.act); if (r) DUI.runAction(r); }
    else if (d.why != null) { DUI.state.open.has(d.why) ? DUI.state.open.delete(d.why) : DUI.state.open.add(d.why); DUI.refresh(); }
    else if (d.done != null) { Eng.actions.setRec(d.done, 'done'); DUI.toast('Marked done', 'It comes back if the problem returns.'); DUI.refresh(); }
    else if (d.snooze != null) { Eng.actions.setRec(d.snooze, 'snoozed'); DUI.toast('Snoozed for 2 hours', 'It comes back if it still applies.'); DUI.refresh(); }
    else if (d.dismiss != null) dismiss(d.dismiss);
    else if (d.order != null) DUI.openOrderDetail(d.order);
    else if (d.pay != null) DUI.openPay({ amount: +d.pay || 0 });
    else if (d.neworder != null) DUI.openOrder(d.neworder || null);
    else if (d.go != null) DUI.go(d.go);
    else if (d.ro != null) DUI.go('outlet', { ro: d.ro, tab: d.tab || 'stock' });
  }
  function bindCommon() { /* kept for views that call it; shared buttons are delegated */ }
  DUI.bindCommon = bindCommon;
  function dismiss(key) {
    const box = DUI.modal(`${DUI.modalHead('Not relevant?', 'Your reason helps tune these suggestions')}
      <div class="modal-body"><div class="chips" id="rsn">${['Already handled outside Prahari', 'The data is wrong', 'Not important for my outlet', 'Other'].map((t, i) => `<button class="chip${i === 0 ? ' active' : ''}">${esc(t)}</button>`).join('')}</div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rsnGo">Hide it</button></div>`);
    $$('#rsn .chip', box).forEach((c) => { c.onclick = () => { $$('#rsn .chip', box).forEach((x) => x.classList.remove('active')); c.classList.add('active'); }; });
    $('#rsnGo', box).onclick = () => { Eng.actions.setRec(key, 'dismissed', $('#rsn .chip.active', box).textContent); DUI.closeModal(); DUI.refresh(); };
  }

  DUI.scopeRos = () => (DUI.state.scope === 'all' ? W.ros : W.ros.filter((r) => r.id === DUI.state.scope));
  DUI.inScope = (roId) => DUI.state.scope === 'all' || !roId || roId === DUI.state.scope;
  DUI.asOf = () => `<span class="asof" title="Tank gauges every ${C.refresh.atg} min · pump sales every ${C.refresh.sales} min · invoices every ${C.refresh.invoices / 60} h">Data as on ${esc(fmt.dt(Eng.lastSync('atg')))}</span>`;

  /** Coloured cover bar: usable stock against capacity, dead stock hatched. */
  DUI.coverBar = function (pm) {
    const w = Math.min(100, pm.stockL / pm.capL * 100), d = Math.min(100, pm.deadL / pm.capL * 100);
    const col = pm.coverDays < 1 ? 'var(--crit)' : pm.coverDays < 2 ? 'var(--warn)' : PCOLOR[pm.p];
    return `<div class="cover" title="${esc(fmt.L(pm.stockL))} in tank, ${esc(fmt.L(pm.deadL))} dead stock"><i style="width:${w}%;background:${col}"></i><span class="dead" style="width:${d}%"></span></div>`;
  };
  DUI.outletStatus = function (ro) {
    const recs = Eng.recommendations(ro.id).filter((r) => r.roId === ro.id);
    const worst = recs.some((r) => r.sev === 'critical') ? 'crit' : recs.some((r) => r.sev === 'high' || r.sev === 'medium') ? 'warn' : 'ok';
    return { recs, worst, text: { crit: 'Urgent', warn: 'Needs attention', ok: 'Running normally' }[worst] };
  };
  DUI.roCard = function (ro) {
    const m = Eng.metrics(ro);
    const st = DUI.outletStatus(ro);
    const vs = m.expectedL > 50 ? m.todayL / m.expectedL - 1 : 0;
    return `<div class="ro-card" data-ro="${esc(ro.id)}" role="link" tabindex="0">
      <div class="ro-card-head"><div><div class="ro-name">${esc(ro.name)}</div><div class="ro-meta">${esc(ro.id)} · ${esc(ro.marketClass)} · ${esc(ro.locality)}</div></div><span class="status ${st.worst}">${st.text}</span></div>
      <div class="prod-rows">${ro.products.map((p) => { const pm = m.byP[p]; return `<div class="prod-row"><span class="pn"><i style="background:${PCOLOR[p]}"></i>${esc(pname(p))}</span>${DUI.coverBar(pm)}<span class="r">${fmt.days(pm.coverDays)}${pm.dryTs && pm.dryTs - Eng.now < 36 * 3600000 ? ` · <span class="c-crit">dry ${esc(fmt.when(pm.dryTs))}</span>` : ''}</span></div>`; }).join('')}</div>
      <div class="ro-foot"><span>Today <b>${esc(fmt.kl(m.todayL))}</b></span><span>vs usual <b class="${vs < -0.08 ? 'c-warn' : vs > 0.03 ? 'c-ok' : ''}">${vs >= 0 ? '+' : ''}${Math.round(vs * 100)}%</b></span><span>Takings <b>${esc(fmt.inr(m.todayInr))}</b></span><span>To do <b>${st.recs.length}</b></span></div>
    </div>`;
  };

  // ---------- Things in motion (orders, payments, claims, tickets) ----------
  DUI.inProgress = function () {
    const rows = [];
    W.orders.filter((o) => DUI.inScope(o.roId) && ['placed', 'loading', 'in_transit', 'unloading'].includes(o.status)).forEach((o) => {
      const eta = o.status === 'placed' ? `loads ${fmt.when(o.loadStartTs)}` : o.status === 'loading' ? 'loading now' : o.status === 'unloading' ? 'unloading now' : `arrives ${fmt.when(o.arriveTs)}`;
      rows.push(`<div class="row-item" data-order="${esc(o.id)}" style="cursor:pointer"><div><b>${esc(o.id)} · ${esc(rname(o.roId))}</b><small>${esc(o.lines.map((l) => `${pname(l.product)} ${l.kl} KL`).join(' + '))}${o.truck ? ' · ' + esc(o.truck.plate) : ''}</small></div><span class="status ${STATUS[o.status][1]}">${esc(STATUS[o.status][0])}, ${esc(eta)}</span></div>`);
    });
    W.payments.filter((p) => p.status === 'pending').forEach((p) => rows.push(`<div class="row-item"><div><b>${esc(p.mode)} ${esc(fmt.inr(p.amount))}</b><small>UTR ${esc(p.utr)} · sent ${esc(fmt.ago(p.ts))}</small></div><span class="status warn">Waiting for credit</span></div>`));
    W.orders.filter((o) => DUI.inScope(o.roId) && o.status === 'claim_raised').forEach((o) => rows.push(`<div class="row-item" data-order="${esc(o.id)}" style="cursor:pointer"><div><b>Claim on ${esc(o.id)}</b><small>${esc(fmt.inr(o.receipt.claim.value))} · raised ${esc(fmt.ago(o.receipt.claim.ts))}</small></div><span class="status warn">Being verified</span></div>`));
    W.threads.filter((t) => t.status === 'Open' && t.cat === 'Service' && DUI.inScope(t.roId)).forEach((t) => rows.push(`<div class="row-item" data-thread="${esc(t.id)}" style="cursor:pointer"><div><b>${esc(t.subject)}</b><small>Service complaint · ${esc(fmt.ago(t.msgs[0].ts))}</small></div><span class="status acc">Engineer booked</span></div>`));
    return rows;
  };

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
      <p class="faint" style="font-size:12px;text-align:center;margin-top:12px">Demo preview. Sending needs a WhatsApp Business account; the in-app version is the Today page.</p></div>`);
  };

  // ---------- Today ----------
  DUI.view('today', {
    render() {
      const b = DUI.briefText();
      const recs = b.recs;
      const crit = recs.filter((r) => r.sev === 'critical').length;
      const money = Eng.money();
      const prog = DUI.inProgress();
      const top = recs.slice(0, 3).map((r) => r.title.charAt(0).toLowerCase() + r.title.slice(1));
      const lead = recs.length
        ? `<b>${recs.length} thing${recs.length > 1 ? 's' : ''} need${recs.length > 1 ? '' : 's'} you</b>${crit ? `, ${crit} urgent` : ''}. Start with: ${esc(top[0])}.`
        : '<b>Nothing needs you right now.</b> Prahari keeps watching stock, prices, pumps and deliveries.';
      return `<div class="page">
        <div class="page-head"><div class="grow"><h1 class="page-title">${esc(b.greet)}</h1>
          <div class="page-sub">${esc(new Date(Eng.now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }))} · ${esc(W.dealer.name)}, dealer · ${DUI.scopeRos().length} outlet${DUI.scopeRos().length > 1 ? 's' : ''}</div></div>
          ${DUI.asOf()}<button class="btn ghost sm" id="briefBtn">${I.msg} Morning brief</button></div>
        <p class="lead" style="margin:-4px 0 18px">${lead}</p>
        <div class="cols">
          <section class="stack" aria-label="Do this now">
            <div class="sh"><h4>Do this now</h4><span class="aside">Ranked by money at stake and urgency</span></div>
            <div class="recs">${recs.length ? recs.map((r, i) => DUI.recCard(r, i)).join('') : `<div class="done-note">${I.check} All clear. New items appear here the moment the data shows something you can act on.</div>`}</div>
            ${prog.length ? `<div class="card flush" style="margin-top:18px"><div class="card-head"><h3>In progress</h3><span class="aside">Orders, payments, claims and complaints moving</span></div><div class="card-body">${prog.join('')}</div></div>` : ''}
          </section>
          <aside class="stack" aria-label="Outlets and account">
            ${DUI.scopeRos().map(DUI.roCard).join('')}
            <div class="card"><div class="card-title">Account with the oil company</div><div class="card-sub">Prepaid balance used for fuel orders</div>
              <div class="kv"><span>Balance</span><b>${esc(fmt.inrFull(money.balance))}</b><span>Held for released orders</span><b>${esc(fmt.inrFull(money.blocked))}</b><span>Available</span><b class="${money.available < 0 ? 'c-crit' : ''}">${esc(fmt.inrFull(money.available))}</b>${money.pending ? `<span>Waiting for credit</span><b class="c-warn">${esc(fmt.inrFull(money.pending))}</b>` : ''}</div>
              <div style="display:flex;gap:6px;margin-top:12px"><button class="btn sm" data-pay="0">${I.plus} Add money</button><button class="btn ghost sm" data-go="account">Ledger</button></div></div>
            <div class="card"><div class="card-title">Recent activity</div><div class="card-sub">Everything you and Prahari did, with times</div>
              ${W.activity.slice(0, 7).map((a) => `<div class="activity ${a.kind === 'ok' ? 'ok-ev' : ''}"><time>${esc(fmt.hm(a.ts))}</time><span>${esc(a.text)}</span></div>`).join('') || '<div class="empty">Nothing yet today.</div>'}</div>
          </aside>
        </div></div>`;
    },
    mount(v) {
      $('#briefBtn', v).onclick = DUI.openBrief;
      $$('[data-thread]', v).forEach((el) => { el.onclick = () => DUI.go('messages', { thread: el.dataset.thread }); });
    },
  });

  // ---------- Outlets: cards plus a side-by-side health table ----------
  DUI.view('outlets', {
    render() {
      const ros = DUI.scopeRos();
      const rows = [];
      ros.forEach((ro) => {
        const m = Eng.metrics(ro);
        const crit = ro.logs.filter((l) => l.critical && !l.atr).length;
        const first = ro.txns.length ? ro.txns.reduce((a, t) => Math.min(a, t.ts), Infinity) : null;
        ro.products.forEach((p, i) => {
          const pm = m.byP[p];
          const mis = Math.abs(pm.pump - pm.rsp) > 0.005;
          const preset = ro.nozzles.some((n) => n.product === p && !n.presetOk);
          rows.push(`<tr class="row" data-ro="${esc(ro.id)}">
            <td class="l">${i === 0 ? `<b style="font-weight:600">${esc(ro.name)}</b><span class="sub-id">${esc(ro.id)} · ${esc(ro.marketClass)}</span>` : ''}</td>
            <td><span class="pname"><i style="background:${PCOLOR[p]}"></i>${esc(pname(p))}</span></td>
            <td class="r">${esc(fmt.L(ro.targetMonthL[p] / 30))}</td>
            <td class="r">${esc(fmt.L(pm.todayL))}</td>
            <td class="r">${esc(fmt.L(pm.usableL))}<span class="sub-id">+ ${esc(fmt.L(pm.deadL))} dead</span></td>
            <td class="r">${pm.pendingL ? esc(fmt.L(pm.pendingL)) : '—'}</td>
            <td class="r">${pm.onWheelsL ? esc(fmt.L(pm.onWheelsL)) : '—'}</td>
            <td class="r ${pm.coverDays < 1 ? 'c-crit' : pm.coverDays < 2 ? 'c-warn' : ''}">${fmt.days(pm.coverDays)}</td>
            <td>${mis ? `<span class="tag crit">₹${pm.pump.toFixed(2)} vs ₹${pm.rsp.toFixed(2)}</span>` : '<span class="tag ok">OK</span>'}${preset ? ' <span class="tag warn">Preset</span>' : ''}</td>
            <td class="r">${i === 0 ? (crit ? `<span class="tag crit">${crit}</span>` : '0') : ''}</td>
            <td>${i === 0 && first ? esc(fmt.hm(first)) + ' / ' + esc(fmt.hm(ro.txns[0].ts)) : ''}</td></tr>`);
        });
      });
      return `<div class="page">
        <div class="page-head"><div class="grow"><h1 class="page-title">Your outlets</h1><div class="page-sub">Gurugram Retail Sales Area · Gurugram Divisional Office · Haryana State Office</div></div>${DUI.asOf()}</div>
        <div class="grid-2" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">${ros.map(DUI.roCard).join('')}</div>
        <div class="card flush mt"><div class="card-head"><h3>Side by side</h3><span class="aside">Stock is usable stock (dead stock excluded); cover uses the last ${C.forecastDays} days' sales</span></div>
          <div class="card-body table-scroll"><table class="t"><thead><tr><th>Outlet</th><th>Product</th><th class="r">Target / day</th><th class="r">Sold today</th><th class="r">Usable stock</th><th class="r">Ordered</th><th class="r">On the way</th><th class="r">Cover</th><th>Price check</th><th class="r">Critical logs</th><th>First / last sale</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></div>
      </div>`;
    },
  });

  // ---------- Top bar ----------
  function topbar() {
    $('#avatar').textContent = W.dealer.name.split(' ').map((x) => x[0]).join('').slice(0, 2);
    $('#avatar').title = `${W.dealer.name}, dealer since ${W.dealer.since}`;
    const menu = $('#scopeMenu');
    const items = [{ id: 'all', name: 'All outlets', sub: `${W.ros.length} outlets` }].concat(W.ros.map((r) => ({ id: r.id, name: r.name, sub: r.id })));
    menu.innerHTML = items.map((x) => `<button role="option" data-scope="${esc(x.id)}">${esc(x.name)}<small>${esc(x.sub)}</small></button>`).join('');
    const btn = $('#scopeBtn');
    btn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); btn.setAttribute('aria-expanded', String(!menu.classList.contains('hidden'))); };
    $$('[data-scope]', menu).forEach((b) => { b.onclick = () => { DUI.setScope(b.dataset.scope); menu.classList.add('hidden'); }; });
    $('#freshBtn').onclick = (e) => { e.stopPropagation(); $('#freshPop').classList.toggle('hidden'); renderFresh(); };
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#scopeMenu')) menu.classList.add('hidden');
      if (!e.target.closest('#freshPop')) $('#freshPop').classList.add('hidden');
    });
    $$('#speedSeg button').forEach((b) => { b.onclick = () => { Eng.setSpeed(+b.dataset.speed); $$('#speedSeg button').forEach((x) => x.classList.toggle('active', x === b)); DUI.toast(`Demo clock at ${b.dataset.speed}×`, +b.dataset.speed > 1 ? 'Watch orders load, travel and arrive.' : 'Back to real time.'); }; });
    $$('#rail button').forEach((b) => { b.onclick = () => DUI.go(b.dataset.view); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && DUI.isModalOpen()) DUI.closeModal(); });
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') DUI.closeModal(); });
  }
  DUI.setScope = function (id) {
    DUI.state.scope = id;
    $('#scopeLabel').textContent = id === 'all' ? 'All outlets' : rname(id);
    $$('[data-scope]').forEach((b) => b.classList.toggle('active', b.dataset.scope === id));
    if (DUI.state.view === 'outlet' && id !== 'all') DUI.state.ro = id;
    if (DUI.state.view === 'track' || DUI.state.view === 'outlet') DUI.go(DUI.state.view);
    else DUI.refresh();
  };
  function renderFresh() {
    const src = [['Tank gauges', 'atg'], ['Pump sales', 'sales'], ['Orders and trucks', 'orders'], ['Invoices', 'invoices']];
    $('#freshPop').innerHTML = `<b style="font-size:12.5px">Where the numbers come from</b><div class="faint" style="font-size:12px;margin-top:2px">Each source reaches Prahari on its own schedule.</div>
      <table><tbody>${src.map(([l, k]) => `<tr><td>${l}<div class="faint" style="font-size:11px">every ${C.refresh[k] >= 60 ? C.refresh[k] / 60 + ' h' : C.refresh[k] + ' min'}</div></td><td>${esc(fmt.ago(Eng.lastSync(k)))}</td></tr>`).join('')}</tbody></table>`;
  }
  function tickTop() {
    const d = new Date(Eng.now);
    $('#clock').textContent = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }) + ' · ' + d.toLocaleTimeString('en-GB', { timeZone: TZ });
    $('#freshLabel').textContent = 'Tanks ' + fmt.ago(Eng.lastSync('atg'));
    if (!$('#freshPop').classList.contains('hidden')) renderFresh();
    const n = Eng.recommendations().filter((r) => DUI.inScope(r.roId) && (r.sev === 'critical' || r.sev === 'high')).length;
    const unread = W.threads.filter((t) => t.unread).length;
    setBadge('today', n); setBadge('messages', unread);
    setBadge('track', W.orders.filter((o) => ['loading', 'in_transit', 'unloading'].includes(o.status)).length, true);
  }
  function setBadge(view, n, quiet) {
    const b = $(`#rail button[data-view="${view}"]`);
    let el = $('.badge', b);
    if (!n) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('span'); el.className = 'badge'; b.appendChild(el); }
    el.textContent = n;
    el.style.background = quiet ? 'var(--accent)' : '';
  }

  DUI.init = function () {
    $('#view').addEventListener('click', onViewClick);
    $('#view').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.ro-card')) onViewClick(e); });
    topbar();
    tickTop();
    Eng.on(() => {
      tickTop();
      // Don't redraw under an open form or a focused text box.
      if (DUI.isModalOpen()) return;
      const a = document.activeElement;
      if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.tagName === 'SELECT') && $('#view').contains(a)) return;
      DUI.refresh();
    });
  };

  window.DUI = DUI;
})();
