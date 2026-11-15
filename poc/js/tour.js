/* =====================================================================
   PRAHARI — Present mode
   A guided, product-demo style walkthrough that drives the live dashboard:
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
  const S = DB.stories;
  const RSS = S.dryout, DEN = S.density, DEC = S.decline;
  const HALT_ID = (DB.tankers.find((t) => t.status === 'Halted') || DB.tankers[0]).id;
  const HALTED = () => DB.tankerById(HALT_ID);
  const dur = (d) => UI.fmt.dur(d);

  // ---------- helpers that put the dashboard into a known state ----------
  function lpTab(tab) { const b = $(`#lpTabs [data-lp="${tab}"]`); if (b) b.click(); }
  function home(fly = true) {
    if (UI.state.view !== 'ops') UI.setView('ops');
    if (!$('#rightPanel').classList.contains('hidden')) UI.closeOutlet();
    lpTab('attention');
    if (fly) MapView.home();
  }
  function competitors(on) {
    const c = $('[data-layer="competitors"]');
    if (c && c.checked !== on) { c.checked = on; MapView.setLayer('competitors', on); }
  }
  async function openOutlet(o, tab) {
    const already = UI.state.selected === o.id && UI.state.view === 'ops';
    if (!already) UI.selectOutlet(o.id, tab);
    else if (UI.state.tab !== tab) { const b = $(`#odTabs [data-tab="${tab}"]`); if (b) b.click(); }
    await waitFor('#odBody');
    const body = $('#odBody'); if (body) body.scrollTop = 0;
  }
  const mapRect = () => {
    const st = $('#stage').getBoundingClientRect();
    const lp = $('#leftPanel');
    const left = lp && !lp.classList.contains('hidden') ? lp.getBoundingClientRect().right + 14 : st.left + 14;
    const rp = $('#rightPanel');
    const right = rp && !rp.classList.contains('hidden') ? rp.getBoundingClientRect().left - 14 : st.right - 14;
    return { x: left, y: st.top + 64, w: right - left, h: st.height - 120 };
  };

  // ---------- the story ----------
  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const STEPS = [
    { kind: 'hero', setup: () => { home(false); MapView.intro(); }, html: () => `
        <div class="h-item h-brand"><div class="brand-mark"><svg viewBox="0 0 16 16"><path d="M8 1.5 14 5v6l-6 3.5L2 11V5z" fill="none" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.8" fill="#111"/></svg></div>Prahari</div>
        <h1 class="h-item">One screen for every<br>petrol pump in your area</h1>
        <p class="h-item h-lead">A live look at the Gurugram Retail Sales Area: ${DB.outlets.length} outlets, ${DB.depots.length} supply depots and ${DB.tankers.length} tankers, all on one map.</p>
        <div class="h-item h-start"><button class="btn primary" data-tour="next">Start the tour</button><span class="faint">or press →</span></div>` },
    { kind: 'hero', setup: () => home(false), html: () => `
        <div class="h-item h-kicker">Today</div>
        <h2 class="h-item">Running a petrol pump means juggling information from everywhere</h2>
        <div class="h-item h-icons">
          <div>${icon('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>')}<b>Paper registers</b><span>Dips, density, cash</span></div>
          <div>${icon('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>')}<b>Calls &amp; WhatsApp</b><span>Chasing everyone</span></div>
          <div>${icon('<path d="M2 7h11v9H2zM13 10h4l4 4v2h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>')}<b>Tanker guesswork</b><span>When will it arrive?</span></div>
          <div>${icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>')}<b>Separate portals</b><span>Orders, statements</span></div>
          <div>${icon('<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>')}<b>Licence files</b><span>Dates in memory</span></div>
        </div>
        <p class="h-item h-lead">Prahari brings all of it onto one live screen, and tells you what needs attention.</p>` },
    { setup: () => home(), target: mapRect, title: 'Your whole area, live',
      text: 'Every dot is a petrol pump, coloured by how it is doing: <b class="c-ok">green</b> is fine, <b class="c-warn">amber</b> needs a look, <b class="c-crit">red</b> is urgent. The white tiles are tankers moving in real time.' },
    { setup: () => home(false), target: '#leftPanel .stats', title: 'The day at a glance',
      text: 'Fuel sold today, progress against this month\'s target, outlets that need attention and tankers on the road. It updates every second.' },
    { setup: () => home(false), target: '#lpBody', title: 'A to-do list that writes itself',
      text: 'Prahari reads everything and lists what to do first, most urgent at the top, in plain language. Each item comes with the fix as a button.' },
    { setup: () => home(false), click: () => $(`.att-title[data-outlet="${RSS.id}"]`), wait: 2600, ensure: async () => { if (UI.state.selected !== RSS.id) await openOutlet(RSS, 'overview'); }, target: '.od-summary', title: 'Open any outlet',
      text: () => `One click flies the map down to the pump in 3D satellite view and opens its page. The first line says what matters: <b>diesel runs out in ${dur(RSS.m.minDays)}</b>${RSS.pendingIndent ? ', and the order is stuck on payment' : ''}.`,
      back: async () => openOutlet(RSS, 'overview') },
    { setup: () => openOutlet(RSS, 'overview'), target: '#ovTanks', title: 'Live tank levels',
      text: 'Read straight from the tank gauges: how much fuel is in each tank, and how many days it will last at today\'s rate of sales.' },
    { setup: async () => { await openOutlet(RSS, 'overview'); const e = await waitFor('#ovTx'); if (e) e.closest('.section').scrollIntoView({ block: 'center' }); await sleep(250); },
      target: () => { const e = $('#ovTx'); return e && e.closest('.section'); }, title: 'Every pump, every sale',
      text: 'Each sale appears as it happens: which pump, how many litres, the amount and how the customer paid. Nozzles that are out of service show up straight away.' },
    { setup: () => openOutlet(RSS, 'overview'), click: () => $('#odHead [data-oact="dispatch"]'), wait: 1600, ensure: async () => { if (Sim.alerts.some((a) => a.key === 'dry:' + RSS.id)) { Sim.actions.priorityDispatch(RSS); await sleep(150); } }, target: '.od-summary', title: 'Fix it in one tap',
      text: 'Press <b>Send a truck now</b> and a tanker is assigned from the nearest depot, and the dealer is asked to clear the payment. The urgent alert clears by itself.' },
    { setup: () => home(false), click: () => $(`.att-title[data-tanker="${HALTED().id}"]`), wait: 2000, ensure: async () => { if (!$('#tkCall')) { UI.selectTanker(HALTED().id); await waitFor('#tkCall'); } }, target: '#rightPanel .od-summary', title: 'Catch fuel theft on the road',
      text: () => { const t = HALTED(); const min = t.status === 'Halted' ? Math.round(t.haltSec / 60) : 0; return `This tanker ${min ? `has been stopped off its route for ${min} minutes` : 'stopped off its route'} with its seals unchecked, the classic pattern of pilferage. Prahari spots it from the tanker\'s GPS automatically.`; },
      back: async () => { home(false); UI.selectTanker(HALTED().id); await waitFor('#tkCall'); } },
    { setup: async () => { if (!$('#tkCall')) { home(false); UI.selectTanker(HALTED().id); await waitFor('#tkCall'); } }, click: () => $('#tkCall'), wait: 1400, ensure: async () => { const t = HALTED(); if (t.status === 'Halted') { Sim.actions.contactDriver(t); UI.selectTanker(t.id); await sleep(200); } }, target: '#rightPanel .od-summary', title: 'Act straight away',
      text: 'Call the driver right from the screen. The tanker goes back on its route, and the incident is logged for the transporter.' },
    { setup: () => openOutlet(DEN, 'supply'), pre: () => { const t = $('#odBody table'); return t && t.closest('.section'); }, click: () => $('#odHead [data-oact="hold"]'), wait: 1400, ensure: async () => { if (DEN.densityDev > 3) { Sim.actions.holdTank(DEN); await openOutlet(DEN, 'supply'); } },
      target: () => { const t = $('#odBody table'); return t && t.closest('.section'); }, title: 'Stop bad fuel before it is sold',
      text: 'The last diesel delivery to Krishna Filling Station failed the density check. Prahari flags it, and one tap holds the tank and sends a sample for testing.' },
    { setup: () => { competitors(false); UI.setView('surveillance'); }, target: '#svGrid', title: 'Cameras that watch for you',
      text: 'The CCTV most outlets already have, analysed automatically: queues building up, number plates of fleet customers, unloading without safety cones, and cameras that go offline.' },
    { setup: async () => { competitors(true); await openOutlet(DEC, 'sales'); setTimeout(() => { if (UI.state.selected === DEC.id) MapView.map.easeTo({ zoom: 14.2, pitch: 40, duration: 1600 }); }, 2400); },
      target: '#odBody .stats', title: 'See the competition coming',
      text: 'Sales at Maa Fuel Point are down about 20% on last week. The map shows why: a new competitor outlet opened just up the highway (the dot with the white ring).' },
    { setup: () => { competitors(false); UI.setView('logistics'); }, target: () => { const t = $('#lgTk'); return t && t.closest('table'); }, title: 'Every tanker, every delivery',
      text: 'Where each tanker is, what it is carrying and when it will arrive, plus the outlets running lowest on fuel, each with a button to send one.' },
    { setup: () => UI.setView('analytics'), target: '#overlay .grid-2', title: 'How the area is performing',
      text: 'Sales against target day by day, the outlets falling behind, the fuel mix, and an estimate of market share against competitor outlets.' },
    { setup: () => UI.setView('compliance'), target: '#overlay .summary-row', title: 'Never miss a renewal',
      text: 'PESO licences, meter stamping, fire certificates and pollution consent, with days left and a one-click reminder to the dealer. Plus an inspection plan that shows who has not been visited lately.' },
    { setup: () => UI.setView('copilot'), run: async (tok) => {
        const input = await waitFor('#cpIn'); if (!input) return;
        input.value = '';
        await cursorTo(input); if (tok !== T.token) return;
        for (const ch of 'Which outlets may run dry?') { if (tok !== T.token) return; input.value += ch; await sleep(55); }
        await cursorClick(() => $('#cpGo'), tok);
        await sleep(1600);
      }, target: '#cpMsgs', title: 'Just ask',
      text: 'The assistant answers questions about the area in plain language, with links straight to the outlets it mentions.' },
    { kind: 'hero', setup: () => { competitors(false); home(); }, html: () => `
        <div class="h-item h-kicker">What happens next</div>
        <h2 class="h-item">Start small, prove it, then grow</h2>
        <div class="h-item h-steps">
          <div class="done"><span>Today</span><b>Working demo</b><p>Built and ready, as you have just seen.</p></div>
          <div><span>Next 2–3 months</span><b>Small pilot</b><p>One Sales Officer and a few friendly outlets, using real data.</p></div>
          <div><span>After that</span><b>Bigger rollout</b><p>A whole division with the oil company's support, then every outlet.</p></div>
        </div>` },
    { kind: 'hero', setup: () => {}, html: () => `
        <div class="h-item h-kicker">How you can help</div>
        <h2 class="h-item">Your experience turns this demo into something real</h2>
        <div class="h-item h-asks">
          <div><i>1</i><b>Introduce us to a Sales Officer</b><span>Someone open to a small pilot in their area</span></div>
          <div><i>2</i><b>Show us how your outlet runs</b><span>The registers, reports and calls behind a normal day</span></div>
          <div><i>3</i><b>Try the early version</b><span>Use it at your pump and tell us what is missing</span></div>
        </div>` },
    { kind: 'hero', setup: () => {}, html: () => `
        <h1 class="h-item">Thank you</h1>
        <p class="h-item h-lead">Prahari: one screen for every petrol pump in your area.</p>
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
