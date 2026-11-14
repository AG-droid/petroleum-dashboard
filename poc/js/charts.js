/* =====================================================================
   PRAHARI POC — tiny canvas chart helpers (no external dependency)
   ===================================================================== */
(function () {
  'use strict';
  const C = {
    grid: 'rgba(120,160,190,0.10)', axis: 'rgba(120,160,190,0.35)', text: '#5d7080', text2: '#8fa3b3', accent: '#38bdf8',
  };
  function setup(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
    const h = canvas.clientHeight || 150;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px JetBrains Mono, monospace';
    return { ctx, w, h };
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  // Line chart: series [{data:[], color, label, dash, fill}]
  function line(canvas, opt) {
    const { ctx, w, h } = setup(canvas);
    const pad = { l: 36, r: 10, t: 12, b: 20 };
    const all = opt.series.flatMap((s) => s.data);
    const max = niceMax(Math.max(...all) * 1.08);
    const min = opt.min != null ? opt.min : 0;
    const n = opt.labels.length;
    const X = (i) => pad.l + (i / Math.max(1, n - 1)) * (w - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.fillStyle = C.text; ctx.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const v = min + (max - min) * k / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(opt.yFmt ? opt.yFmt(v) : Math.round(v), pad.l - 6, y + 3);
    }
    ctx.textAlign = 'center';
    const step = Math.ceil(n / 6);
    opt.labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) ctx.fillText(l, X(i), h - 5); });
    opt.series.forEach((s) => {
      ctx.beginPath();
      s.data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.8; ctx.setLineDash(s.dash || []); ctx.stroke(); ctx.setLineDash([]);
      if (s.fill) {
        ctx.lineTo(X(s.data.length - 1), Y(min)); ctx.lineTo(X(0), Y(min)); ctx.closePath();
        const g = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
        g.addColorStop(0, s.color + '40'); g.addColorStop(1, s.color + '00');
        ctx.fillStyle = g; ctx.fill();
      }
    });
    if (opt.legend !== false) {
      let x = pad.l + 4;
      ctx.textAlign = 'left';
      opt.series.forEach((s) => {
        if (!s.label) return;
        ctx.fillStyle = s.color; ctx.fillRect(x, 4, 10, 2);
        ctx.fillStyle = C.text2; ctx.fillText(s.label, x + 14, 8);
        x += ctx.measureText(s.label).width + 30;
      });
    }
  }

  // Bar chart (vertical or horizontal). items [{label, value, color, target}]
  function bars(canvas, opt) {
    const { ctx, w, h } = setup(canvas);
    const items = opt.items;
    const max = opt.max || niceMax(Math.max(...items.map((i) => Math.max(i.value, i.target || 0))) * 1.05);
    if (opt.horizontal) {
      const lw = opt.labelWidth || 120;
      const pad = { l: lw, r: 46, t: 4, b: 4 };
      const bh = (h - pad.t - pad.b) / items.length;
      items.forEach((it, i) => {
        const y = pad.t + i * bh;
        const bw = (it.value / max) * (w - pad.l - pad.r);
        ctx.fillStyle = C.text2; ctx.textAlign = 'right'; ctx.font = '11px Inter, sans-serif';
        ctx.fillText(it.label.length > 20 ? it.label.slice(0, 19) + '…' : it.label, pad.l - 8, y + bh / 2 + 4);
        ctx.fillStyle = 'rgba(120,160,190,0.08)'; ctx.fillRect(pad.l, y + bh * 0.2, w - pad.l - pad.r, bh * 0.6);
        ctx.fillStyle = it.color || C.accent; ctx.fillRect(pad.l, y + bh * 0.2, bw, bh * 0.6);
        if (it.target) { const tx = pad.l + (it.target / max) * (w - pad.l - pad.r); ctx.fillStyle = '#d7e2ea'; ctx.fillRect(tx - 1, y + bh * 0.1, 2, bh * 0.8); }
        ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = C.text2;
        ctx.fillText(opt.fmt ? opt.fmt(it.value) : it.value.toFixed(1), pad.l + bw + 6, y + bh / 2 + 3);
      });
    } else {
      const pad = { l: 34, r: 8, t: 10, b: 20 };
      const bw = (w - pad.l - pad.r) / items.length;
      ctx.strokeStyle = C.grid; ctx.fillStyle = C.text; ctx.textAlign = 'right';
      for (let k = 0; k <= 4; k++) {
        const v = max * k / 4, y = pad.t + (1 - v / max) * (h - pad.t - pad.b);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillText(opt.yFmt ? opt.yFmt(v) : Math.round(v), pad.l - 5, y + 3);
      }
      ctx.textAlign = 'center';
      items.forEach((it, i) => {
        const x = pad.l + i * bw;
        const bh = (it.value / max) * (h - pad.t - pad.b);
        ctx.fillStyle = it.color || C.accent;
        ctx.fillRect(x + bw * 0.18, h - pad.b - bh, bw * 0.64, bh);
        ctx.fillStyle = C.text;
        if (items.length <= 14 || i % 2 === 0) ctx.fillText(it.label, x + bw / 2, h - 5);
      });
    }
  }

  function donut(canvas, opt) {
    const { ctx, w, h } = setup(canvas);
    const total = opt.items.reduce((a, b) => a + b.value, 0) || 1;
    const R = Math.min(h / 2 - 6, w * 0.22), cx = R + 10, cy = h / 2;
    let a0 = -Math.PI / 2;
    opt.items.forEach((it) => {
      const a1 = a0 + (it.value / total) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.arc(cx, cy, R * 0.62, a1, a0, true); ctx.closePath();
      ctx.fillStyle = it.color; ctx.fill();
      a0 = a1;
    });
    ctx.fillStyle = '#d7e2ea'; ctx.textAlign = 'center'; ctx.font = '600 15px JetBrains Mono, monospace';
    ctx.fillText(opt.center || '', cx, cy + 3);
    ctx.font = '10px Inter, sans-serif'; ctx.fillStyle = C.text;
    ctx.fillText(opt.centerSub || '', cx, cy + 17);
    let y = cy - (opt.items.length * 20) / 2 + 10;
    ctx.textAlign = 'left';
    opt.items.forEach((it) => {
      ctx.fillStyle = it.color; ctx.fillRect(cx + R + 18, y - 8, 9, 9);
      ctx.fillStyle = C.text2; ctx.font = '11.5px Inter, sans-serif'; ctx.fillText(it.label, cx + R + 34, y);
      ctx.fillStyle = '#d7e2ea'; ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillText(((it.value / total) * 100).toFixed(1) + '%', cx + R + 34 + Math.max(110, ctx.measureText(it.label).width + 14), y);
      y += 20;
    });
  }

  window.Charts = { line, bars, donut };
})();
