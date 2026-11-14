/* PRAHARI POC — bootstrap */
(function () {
  'use strict';
  const intro = document.createElement('div');
  intro.id = 'intro';
  intro.innerHTML = `<div class="brand-mark"><svg viewBox="0 0 16 16"><path d="M8 1.5 14 5v6l-6 3.5L2 11V5z" fill="none" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.8" fill="#111"/></svg></div>
    <div class="l2">Loading Gurugram Sales Area</div><div class="loadbar"><i></i></div>`;
  document.body.appendChild(intro);

  function fail(msg) {
    intro.querySelector('.l2').innerHTML = `<span style="color:#ff4d5e">${msg}</span>`;
    intro.querySelector('.loadbar').style.display = 'none';
  }
  if (typeof maplibregl === 'undefined') { fail('Map library failed to load — check your internet connection and reload.'); return; }

  try {
    Sim.start();
    UI.init();
  } catch (e) { console.error(e); fail('Startup error: ' + e.message); return; }

  let done = false;
  const reveal = () => {
    if (done) return; done = true;
    intro.classList.add('fade');
    setTimeout(() => intro.remove(), 900);
    MapView.update();
    // Deep links for demos: #outlet=GGN-104&tab=cameras  or  #view=surveillance
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('base') === 'sat' || h.get('base') === 'dark') MapView.setBasemap(h.get('base'));
    // Present mode: #tour  ·  #tour&auto (plays by itself)  ·  #tour&step=5 (jump to a step)
    if (h.has('tour')) setTimeout(() => Tour.start(h.has('auto'), +(h.get('step') || 0)), 500);
    else if (h.get('outlet')) setTimeout(() => UI.selectOutlet(h.get('outlet'), h.get('tab') || undefined), 400);
    else if (h.get('view')) { setTimeout(() => MapView.home(false), 100); setTimeout(() => UI.setView(h.get('view')), 300); }
    else setTimeout(() => MapView.intro(), 300);
  };
  document.getElementById('presentBtn').addEventListener('click', () => Tour.restart());
  MapView.init(reveal);
  setTimeout(reveal, 8000); // never leave the user on the splash screen
})();
