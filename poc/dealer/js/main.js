/* PRAHARI for dealers — bootstrap and deep links
   #view=orders · #outlet=990104&tab=sales · #speed=60 (start the demo clock faster) */
(function () {
  'use strict';
  const intro = document.createElement('div');
  intro.id = 'intro';
  intro.innerHTML = `<div class="brand-mark"><svg viewBox="0 0 16 16"><path d="M8 1.5 14 5v6l-6 3.5L2 11V5z" fill="none" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.8" fill="#111"/></svg></div>
    <div class="l2">Loading your outlets</div><div class="loadbar"><i></i></div>`;
  document.body.appendChild(intro);
  try {
    DUI.init();
    const h = new URLSearchParams(location.hash.slice(1));
    const speed = +h.get('speed');
    if ([1, 10, 60, 300].includes(speed)) document.querySelector(`#speedSeg [data-speed="${speed}"]`).click();
    if (h.get('outlet') && DW.byId(h.get('outlet'))) DUI.go('outlet', { ro: h.get('outlet'), tab: h.get('tab') || 'stock' });
    else DUI.go(h.get('view') || 'today');
    Eng.start();
  } catch (e) {
    console.error(e);
    intro.querySelector('.l2').innerHTML = '<span style="color:#ff4d5e">Startup error: ' + String(e.message).replace(/[<>&]/g, '') + '</span>';
    intro.querySelector('.loadbar').style.display = 'none';
    return;
  }
  setTimeout(() => { intro.classList.add('fade'); setTimeout(() => intro.remove(), 900); }, 350);
})();
