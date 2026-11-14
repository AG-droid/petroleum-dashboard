/* PRAHARI POC — bootstrap */
(function () {
  'use strict';
  const intro = document.createElement('div');
  intro.id = 'intro';
  intro.innerHTML = `<svg viewBox="0 0 32 32" class="brand-logo" style="color:#38bdf8"><path d="M16 2 L29 9 V23 L16 30 L3 23 V9 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M16 8 L23 12 V20 L16 24 L9 20 V12 Z" fill="currentColor" opacity=".25"/><circle cx="16" cy="16" r="3" fill="currentColor"/></svg>
    <div class="l1">PRAHARI</div><div class="l2">CONNECTING TO GURUGRAM SALES AREA · ${DB.outlets.length} OUTLETS</div><div class="loadbar"><i></i></div>`;
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
    if (h.get('outlet')) setTimeout(() => UI.selectOutlet(h.get('outlet'), h.get('tab') || undefined), 400);
    else if (h.get('view')) { setTimeout(() => MapView.home(false), 100); setTimeout(() => UI.setView(h.get('view')), 300); }
    else setTimeout(() => MapView.intro(), 300);
  };
  MapView.init(reveal);
  setTimeout(reveal, 8000); // never leave the user on the splash screen
})();
