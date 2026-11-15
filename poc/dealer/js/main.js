/* PRAHARI for dealers — bootstrap and deep links
   #outlet=990104&tab=supply · #view=logistics · #truck=<order id> · #speed=60 · #tour (#tour&auto, #tour&step=5) */
(function () {
  'use strict';
  const intro = document.createElement('div');
  intro.id = 'intro';
  intro.innerHTML = `<div class="brand-mark"><svg viewBox="0 0 16 16"><path d="M8 1.5 14 5v6l-6 3.5L2 11V5z" fill="none" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.8" fill="#111"/></svg></div>
    <div class="l2">Loading your outlets</div><div class="loadbar"><i></i></div>`;
  document.body.appendChild(intro);
  function fail(msg) {
    intro.querySelector('.l2').innerHTML = `<span style="color:#ff4d5e">${String(msg).replace(/[<>&]/g, '')}</span>`;
    intro.querySelector('.loadbar').style.display = 'none';
  }
  if (typeof maplibregl === 'undefined') { fail('Map library failed to load. Check your internet connection and reload.'); return; }
  try {
    DUI.init();
    Eng.start();
  } catch (e) { console.error(e); fail('Startup error: ' + e.message); return; }

  let done = false;
  const reveal = () => {
    if (done) return; done = true;
    intro.classList.add('fade');
    setTimeout(() => intro.remove(), 900);
    MapD.update();
    const h = new URLSearchParams(location.hash.slice(1));
    const speed = +h.get('speed');
    if ([1, 10, 60, 300].includes(speed)) DUI.setSpeed(speed);
    if (h.get('base') === 'sat' || h.get('base') === 'dark') MapD.setBasemap(h.get('base'));
    if (h.has('tour')) setTimeout(() => Tour.start(h.has('auto'), +(h.get('step') || 0)), 500);
    else if (h.get('outlet') && DW.byId(h.get('outlet'))) setTimeout(() => DUI.selectOutlet(h.get('outlet'), h.get('tab') || undefined), 400);
    else if (h.get('truck') && DW.orderById(h.get('truck'))) setTimeout(() => DUI.selectTruck(h.get('truck')), 400);
    else if (h.get('view')) { setTimeout(() => MapD.home(false), 100); setTimeout(() => DUI.setView(h.get('view')), 300); }
    else setTimeout(() => MapD.intro(), 300);
  };
  document.getElementById('presentBtn').addEventListener('click', () => Tour.restart());
  MapD.init(reveal);
  setTimeout(reveal, 8000); // never leave the user on the splash screen
})();
