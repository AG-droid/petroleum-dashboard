/* =====================================================================
   PRAHARI for dealers — Present mode
   The Sales Officer dashboard's guided walkthrough (same engine), telling the dealer's story:
   full-screen story cards, a gliding spotlight, captions, and a demo cursor
   that clicks real buttons. → / Space next · ← back · A auto-play · Esc exit
   ===================================================================== */
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(sel, t = 4000) {
    const end = Date.now() + t;
    while (Date.now() < end) {
      const e = typeof sel === 'function' ? sel() : $(sel);
      if (e) return e;
      await sleep(80);
    }
    return null;
  }

  const T = { i: -1, on: false, auto: false, busy: false, timer: null, token: 0 };
  let root, scrim, hero, spot, card, cursor;

  // ---------- story data ----------
  const W = window.DW;
  const HW = W.ros[0], CITY = W.ros[1];
  const waiting = () => W.orders.find((o) => o.roId === HW.id && o.status !== 'received' && o.status !== 'cancelled' && o.status !== 'awaiting_receipt' && o.status !== 'claim_raised');
  const shortOrder = () => W.orders.find((o) => o.roId === CITY.id && (o.status === 'awaiting_receipt' || o.status === 'claim_raised'));
  const dryText = () => { const pm = Eng.metrics(HW).byP.HSD; return Eng.fmt.when(pm.dryTs); };

  // ---------- helpers that put the dashboard into a known state ----------
  function lpTab(tab) { const b = $(`#lpTabs [data-lp="${tab}"]`); if (b) b.click(); }
  function home(fly = true) {
    if (DUI.isModalOpen()) DUI.closeModal();
    if (DUI.state.view !== 'ops') DUI.setView('ops');
    if (!$('#rightPanel').classList.contains('hidden')) DUI.closePanel();
    lpTab('attention');
    if (fly) MapD.home();
  }
  async function openOutlet(ro, tab) {
    if (DUI.isModalOpen()) DUI.closeModal();
    const already = DUI.state.selected === ro.id && DUI.state.view === 'ops';
    if (!already) DUI.selectOutlet(ro.id, tab);
    else if (DUI.state.tab !== tab) { const b = $(`#odTabs [data-tab-k="${tab}"]`); if (b) b.click(); }
    await waitFor('#odBody');
    const body = $('#odBody'); if (body) body.scrollTop = 0;
  }
  /** Bring the diesel order to the road (the demo clock jumps ahead). */
  function toTheRoad() {
    const o = waiting();
    if (!o) return null;
    if (o.status === 'awaiting_payment' && Eng.stillToPay(o) > 0) Eng.actions.recordPayment(Eng.stillToPay(o), 'RTGS', Eng.actions.demoUtr('RTGS'));
    let guard = 0;
    while (o.status !== 'in_transit' && ['awaiting_payment', 'placed', 'loading'].includes(o.status) && guard++ < 400) Eng.advance(5 * 60000);
    // Halfway along the road so the map shows the truck moving.
    if (o.status === 'in_transit') { const half = o.dispatchTs + (o.arriveTs - o.dispatchTs) * 0.45; if (Eng.now < half) Eng.advance(half - Eng.now); }
    DUI.refresh();
    return o;
  }
  const mapRect = () => {
    const st = $('#stage').getBoundingClientRect();
    const lp = $('#leftPanel');
    const left = lp && !lp.classList.contains('hidden') ? lp.getBoundingClientRect().right + 14 : st.left + 14;
    const rp = $('#rightPanel');
    const right = rp && !rp.classList.contains('hidden') ? rp.getBoundingClientRect().left - 14 : st.right - 14;
    return { x: left, y: st.top + 64, w: right - left, h: st.height - 120 };
  };
  const section = (title) => () => Array.from(document.querySelectorAll('#odBody .section')).find((s) => (s.querySelector('h4') || {}).textContent === title);

  // ---------- the story ----------
  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const STEPS = [
    { kind: 'hero', setup: () => { home(false); MapD.intro(); }, html: () => `
        <div class="h-item h-brand"><div class="brand-mark"><svg viewBox="0 0 16 16"><path d="M8 1.5 14 5v6l-6 3.5L2 11V5z" fill="none" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.8" fill="#111"/></svg></div>Prahari <span class="role-tag" style="margin-left:6px">Dealer</span></div>
        <h1 class="h-item">Your petrol pumps,<br>on one live screen</h1>
        <p class="h-item h-lead">Stock, sales, orders, trucks, payments and compliance for ${W.ros.length} outlets, with Prahari telling you what to do next.</p>
        <div class="h-item h-start"><button class="btn primary" data-tour="next">Start the tour</button><span class="faint">or press →</span></div>` },
    { kind: 'hero', setup: () => home(false), html: () => `
        <div class="h-item h-kicker">Today</div>
        <h2 class="h-item">Running a pump means hunting for answers in many places</h2>
        <div class="h-item h-icons">
          <div>${icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 13h8M8 16h5"/>')}<b>Portal reports</b><span>Numbers, but what to do?</span></div>
          <div>${icon('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>')}<b>Calls</b><span>Sales Officer, depot, driver</span></div>
          <div>${icon('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>')}<b>RTGS and UTRs</b><span>Has the money landed?</span></div>
          <div>${icon('<path d="M2 7h11v9H2zM13 10h4l4 4v2h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>')}<b>Tanker guesswork</b><span>When will it arrive?</span></div>
          <div>${icon('<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>')}<b>Licence dates</b><span>Kept in memory</span></div>
        </div>
        <p class="h-item h-lead">Prahari reads all of it and puts the answer, and the button to act, in front of you.</p>` },
    { setup: () => home(), target: mapRect, title: 'Your outlets, live',
      text: 'Each of your outlets is on the map, coloured by how it is doing. Your tank trucks appear as they load and drive to you, on the real roads. Supply points are the white squares.' },
    { setup: () => home(false), target: '#leftPanel .stats', title: 'The day at a glance',
      text: 'Fuel sold today against the usual by this hour, the month against target, the balance you can order with, and your trucks on the road.' },
    { setup: () => home(false), target: '#lpBody', title: 'A to-do list that writes itself',
      text: 'Prahari reads the tank gauges, pumps, prices, orders and payments and lists what to do, most money at stake first. Every item says why, what it costs, and has the fix as a button.' },
    { setup: () => home(false), click: () => $(`.att-title[data-outlet="${HW.id}"]`), wait: 2400, ensure: async () => { if (DUI.state.selected !== HW.id) await openOutlet(HW, 'supply'); },
      target: '.od-summary', title: 'Open the outlet',
      text: () => `One click flies to the pump and opens its page. The top line says what matters: diesel runs dry <b>${dryText()}</b>, and today's order is waiting for payment.`,
      back: async () => openOutlet(HW, 'supply') },
    { setup: () => openOutlet(HW, 'overview'), target: section('Tanks'), title: 'Usable stock, not just stock',
      text: 'The hatched part of each tank is dead stock: fuel below the suction pipe that can never be sold. Prahari forecasts the run-dry time on what you can actually sell, hour by hour, instead of dividing stock by today\'s sales so far.' },
    { setup: () => openOutlet(HW, 'overview'), click: () => $('#odHead [data-act^="pay-order"]'), wait: 1800,
      ensure: async () => { if (!DUI.isModalOpen()) { const o = waiting(); if (o && Eng.stillToPay(o) > 0) DUI.openPay({ amount: Eng.stillToPay(o), orderId: o.id }); await sleep(300); } },
      back: async () => { await openOutlet(HW, 'overview'); DUI.openPay({ amount: 1091350, orderId: (waiting() || {}).id }); await sleep(300); },
      target: '.modal-box', title: 'Pay from your bank, record the UTR',
      text: 'The amount is already filled in. Pay by RTGS or NEFT from your own bank to your collection account, then enter the UTR. Prahari never moves money or asks for bank logins; it matches the credit and releases the order.' },
    { setup: async () => { if (DUI.isModalOpen()) DUI.closeModal(); const o = toTheRoad(); if (o) { DUI.selectTruck(o.id); await waitFor('#tkClose'); } },
      target: '#rightPanel .od-summary', title: 'Watch your truck come to you',
      text: 'Once the money lands, the order goes to the supply point, loads and leaves with an invoice. The truck drives the real road to your outlet with an arrival time; the dashed line is the road still ahead.' },
    { setup: () => openOutlet(CITY, 'overview'), click: () => $('#odHead [data-act^="rsp:"]'), wait: 1600,
      ensure: async () => { const ok = $('#okPrice'); if (ok) { await cursorClick(() => $('#okPrice')); await sleep(300); } else if (Math.abs(CITY.prices.XP ? CITY.prices.XP.pump - CITY.prices.XP.rsp : 0) > 0.005) Eng.actions.updatePrice(CITY.id, 'XP'); if (DUI.isModalOpen()) DUI.closeModal(); DUI.refresh(); },
      target: section('Price board'), title: 'Wrong price on the pump, caught',
      text: () => `At ${CITY.name} the premium petrol pump still charged the old price after the 06:00 revision, and two presets too. That is an inspection finding and money lost every litre. Fixed and recorded with the time.` },
    { setup: () => openOutlet(CITY, 'supply'), click: () => $('#odBody [data-rec]'), wait: 1600,
      ensure: async () => { const c = $('#rClaim'); if (c) { await cursorClick(() => $('#rClaim')); await sleep(300); } else { const o = shortOrder(); if (o && o.status === 'awaiting_receipt') Eng.actions.recordReceipt(o.id, true); } if (DUI.isModalOpen()) DUI.closeModal(); DUI.refresh(); },
      target: section('Recent deliveries'), title: 'Short deliveries become claims',
      text: 'Yesterday\'s petrol load measured 85 L less than invoiced, well past the allowed transit loss. Prahari compares every invoice with the tank gauge and raises the claim, which comes back as a credit note.' },
    { setup: () => openOutlet(HW, 'integrity'), target: '#odBody', title: 'The checks the oil company runs, first',
      text: 'Nozzles that have not sold since opening, a nozzle flowing slower than the rest, a controller reset in the night that needs an action-taken report, water in a tank, and the day\'s stock reconciliation.' },
    { setup: () => DUI.setView('logistics'), target: '#overlay .summary-row', title: 'Every order, every truck',
      text: 'Suggested orders packed into whole truck compartments and limited by tank space, the supply pipeline with run-dry times with and without orders, and every order\'s next step.' },
    { setup: () => DUI.setView('account'), target: '#overlay .summary-row', title: 'Your account, reconciled',
      text: 'Balance, money held for released orders, payments on their way, a running ledger of invoices, payments and credit notes, and invoices you can download.' },
    { setup: () => DUI.setView('compliance'), target: '#overlay .summary-row', title: 'Never miss a renewal',
      text: 'Stamping, explosives licence, fire NOC and pollution consent for every outlet, booked from here, plus inspection observations to close with proof.' },
    { setup: () => DUI.setView('copilot'), run: async (tok) => {
        const input = await waitFor('#cpIn'); if (!input) return;
        input.value = '';
        await cursorTo(input); if (tok !== T.token) return;
        for (const ch of 'What should I do first?') { if (tok !== T.token) return; input.value += ch; await sleep(55); }
        await cursorClick(() => $('#cpGo'), tok);
        await sleep(1400);
      }, target: '#cpMsgs', title: 'Just ask',
      text: 'Ask in plain words: when will diesel run out, how much do I need to pay, where is my truck. The answers come from the live data, with the buttons to act.' },
    { kind: 'hero', setup: () => home(), html: () => `
        <div class="h-item h-kicker">What happens next</div>
        <h2 class="h-item">Start with one outlet, then grow</h2>
        <div class="h-item h-steps">
          <div class="done"><span>Today</span><b>Working demo</b><p>Built and ready, as you have just seen.</p></div>
          <div><span>Next</span><b>Pilot at one outlet</b><p>Real exports from the oil company's portal, used every day.</p></div>
          <div><span>After that</span><b>More dealers</b><p>And, with the oil company, the same data the Sales Officer sees.</p></div>
        </div>` },
    { kind: 'hero', setup: () => {}, html: () => `
        <h1 class="h-item">Thank you</h1>
        <p class="h-item h-lead">Prahari for dealers: your petrol pumps, on one live screen.</p>
        <div class="h-item h-start"><button class="btn primary" data-tour="exit">Explore the dashboard</button><button class="btn ghost" data-tour="restart">Watch again</button></div>` },
  ];

  const N = STEPS.length;

  // ---------- spotlight, card, cursor ----------
  function rectOf(x) {
    if (!x) return null;
    if (x.getBoundingClientRect) { const r = x.getBoundingClientRect(); return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; }
    return x;
  }
  async function resolve(t) {
    if (!t) return null;
    const el = await waitFor(typeof t === 'function' ? t : () => $(t), 3000);
    return rectOf(el);
  }
  function spotTo(r) {
    if (!r) { spot.classList.add('hidden'); return; }
    const p = 8;
    spot.classList.remove('hidden');
    Object.assign(spot.style, { left: r.x - p + 'px', top: r.y - p + 'px', width: r.w + p * 2 + 'px', height: r.h + p * 2 + 'px' });
  }
  function placeCard(r) {
    const W = 380, H = card.offsetHeight || 240, M = 24, vw = innerWidth, vh = innerHeight;
    let x, y;
    if (!r) { x = M + 64; y = vh - H - M; }
    else if (vw - (r.x + r.w) >= W + M * 2) { x = r.x + r.w + M; y = r.y; }
    else if (r.x >= W + M * 2) { x = r.x - W - M; y = r.y; }
    else if (vh - (r.y + r.h) >= H + M * 2) { x = r.x; y = r.y + r.h + M; }
    else if (r.y >= H + M * 2) { x = r.x; y = r.y - H - M; }
    else { x = vw - W - M; y = vh - H - M; }
    x = Math.max(M, Math.min(vw - W - M, x));
    y = Math.max(64, Math.min(vh - H - M, y));
    card.style.left = x + 'px'; card.style.top = y + 'px';
  }
  function showCard(s, r) {
    const idx = STEPS.indexOf(s);
    card.innerHTML = `
      <div class="tc-progress"><i style="width:${((idx + 1) / N) * 100}%"></i></div>
      <div class="tc-step">${idx + 1} of ${N}</div>
      <h3>${s.title}</h3>
      <p>${typeof s.text === 'function' ? s.text() : s.text}</p>
      <div class="tc-ctrl">
        <button class="btn sm ghost" data-tour="prev" ${idx === 0 ? 'disabled' : ''}>Back</button>
        <button class="btn sm primary" data-tour="next">Next</button>
        <button class="tc-auto ${T.auto ? 'on' : ''}" data-tour="auto" title="Auto-play (A)">${T.auto ? 'Auto-play on' : 'Auto-play'}</button>
        <button class="tc-exit" data-tour="exit" title="Exit (Esc)">Exit</button>
      </div>
      ${T.auto ? `<div class="tc-timer"><i style="animation-duration:${s.dur || 7000}ms"></i></div>` : ''}`;
    card.classList.remove('hidden', 'tc-in');
    void card.offsetWidth;
    card.classList.add('tc-in');
    placeCard(r);
  }
  function hideCard() { card.classList.add('hidden'); }
  function cursorPos(x, y) { cursor.classList.remove('hidden'); cursor.style.transform = `translate(${x}px, ${y}px)`; }
  async function cursorTo(el) {
    const r = rectOf(typeof el === 'function' ? el() : el);
    if (!r) return;
    cursorPos(r.x + Math.min(r.w * 0.5, 60), r.y + r.h * 0.55);
    await sleep(950);
  }
  async function cursorClick(get, tok) {
    const first = await waitFor(get, 1200);
    if (!first || (tok !== undefined && tok !== T.token)) return false;
    await cursorTo(first);
    if (tok !== undefined && tok !== T.token) return false; // the presenter moved on while the cursor travelled
    const el = get() || first; // elements may re-render while the cursor travels
    if (!el.isConnected) return false;
    cursor.classList.add('click');
    setTimeout(() => cursor.classList.remove('click'), 450);
    await sleep(180);
    el.click();
    return true;
  }

  // ---------- navigation ----------
  async function go(i, dir) {
    if (i < 0 || i >= N) return;
    const tok = ++T.token;
    clearTimeout(T.timer);
    T.i = i;
    const s = STEPS[i];
    hideCard();
    try {
      if (s.kind === 'hero') {
        spotTo(null); cursor.classList.add('hidden');
        if (s.setup) await s.setup();
        if (tok !== T.token) return;
        scrim.classList.remove('hidden');
        hero.innerHTML = `<div class="h-wrap">${s.html()}</div>`;
        hero.classList.remove('hidden', 'h-in'); void hero.offsetWidth; hero.classList.add('h-in');
      } else {
        hero.classList.add('hidden'); scrim.classList.add('hidden');
        if (dir < 0 && s.back) await s.back(); else if (s.setup) await s.setup();
        if (tok !== T.token) return;
        await sleep(dir === 0 ? 300 : 450);
        const forward = dir > 0;
        if (forward && (s.pre || s.click || s.run)) {
          const clickEl = s.click ? await waitFor(s.click, 1200) : null;
          if (tok !== T.token) return;
          const first = s.pre ? await resolve(s.pre) : clickEl ? rectOf(clickEl) : await resolve(s.target);
          if (tok !== T.token) return;
          spotTo(first); showCard(s, first);
          if (s.pre) await sleep(2200);
          if (tok !== T.token) return;
          let acted = false;
          if (clickEl) {
            const cr = rectOf(s.click() || clickEl);
            if (cr) { spotTo(cr); await sleep(300); if (tok !== T.token) return; acted = await cursorClick(s.click, tok); }
          }
          if (s.run) { await s.run(tok); acted = true; }
          if (tok !== T.token) return;
          await sleep(acted ? (s.wait || 1200) : 200);
          // If a click didn't take (e.g. the list re-rendered under the cursor), finish the action directly
          if (s.ensure && tok === T.token) await s.ensure();
        } else cursor.classList.add('hidden');
        if (tok !== T.token) return;
        const r = await resolve(s.target);
        if (tok !== T.token) return;
        T.r = r;
        spotTo(r);
        showCard(s, r);
        setTimeout(() => { if (tok === T.token) placeCard(r); }, 60);
      }
    } catch (e) { console.error('tour step failed', e); }
    // Keep arrow keys working: don't leave focus in a text box (e.g. the assistant input)
    const ae = document.activeElement;
    if (tok === T.token && ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) ae.blur();
    if (T.auto && tok === T.token && i < N - 1) T.timer = setTimeout(() => go(T.i + 1, 1), s.kind === 'hero' ? 6500 : (s.dur || 7000));
  }
  const next = () => go(Math.min(N - 1, T.i + 1), 1);
  const prev = () => go(Math.max(0, T.i - 1), -1);
  function toggleAuto() {
    T.auto = !T.auto;
    clearTimeout(T.timer);
    if (T.auto) next();
    else if (STEPS[T.i] && STEPS[T.i].kind !== 'hero') showCard(STEPS[T.i], T.r);
  }

  function onKey(e) {
    if (!T.on) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.key !== 'Escape') return;
    const k = e.key;
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Enter') { e.preventDefault(); e.stopPropagation(); next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); e.stopPropagation(); prev(); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); exit(); }
    else if (k.toLowerCase() === 'a') { e.preventDefault(); toggleAuto(); }
  }
  function onClick(e) {
    const b = e.target.closest('[data-tour]');
    if (!b) return;
    e.stopPropagation();
    const a = b.dataset.tour;
    if (a === 'next') next();
    if (a === 'prev') prev();
    if (a === 'auto') toggleAuto();
    if (a === 'exit') exit();
    if (a === 'restart') restart();
  }

  function build() {
    root = document.createElement('div');
    root.id = 'tour';
    root.innerHTML = `<div class="tour-scrim hidden"></div><div class="tour-spot hidden"></div><div class="tour-hero hidden"></div><div class="tour-card hidden"></div>
      <div class="tour-cursor hidden"><svg viewBox="0 0 24 24"><path d="M4 2l16 9-7 1.6L10.5 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><span></span></div>`;
    document.body.appendChild(root);
    scrim = $('.tour-scrim', root); spot = $('.tour-spot', root); hero = $('.tour-hero', root); card = $('.tour-card', root); cursor = $('.tour-cursor', root);
    cursorPos(innerWidth * 0.5, innerHeight * 0.75); cursor.classList.add('hidden');
    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', () => { if (T.on && STEPS[T.i] && STEPS[T.i].kind !== 'hero') go(T.i, 0); });
  }

  function start(auto, at = 0) {
    if (!root) build();
    T.on = true; T.auto = !!auto;
    document.body.classList.add('touring');
    go(Math.max(0, Math.min(N - 1, at || 0)), 1);
  }
  function exit() {
    T.on = false; T.token++; clearTimeout(T.timer);
    document.body.classList.remove('touring');
    if (root) { root.remove(); root = null; document.removeEventListener('keydown', onKey, true); }
    history.replaceState(null, '', location.pathname);
  }
  // A fresh page load gives every story its starting state again
  function restart() { location.hash = 'tour'; location.reload(); }

  window.Tour = { start, exit, restart };
})();
