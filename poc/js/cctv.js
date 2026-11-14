/* =====================================================================
   PRAHARI POC — simulated CCTV feeds
   Procedurally drawn camera scenes (forecourt, entry/ANPR, decantation
   bay, cash room) with AI-vision bounding boxes. No real video is used.
   ===================================================================== */
(function () {
  'use strict';
  const feeds = new Set();
  const FPS_MS = 66;

  // Pre-rendered noise frames + scanlines
  function makeNoise(w, h, a) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); const img = x.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = a; }
    x.putImageData(img, 0, 0); return c;
  }
  const NOISE = [0, 1, 2, 3].map(() => makeNoise(240, 135, 255));
  const SCAN = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 3; const x = c.getContext('2d'); x.fillStyle = 'rgba(0,0,0,0.1)'; x.fillRect(0, 2, 4, 1); return c; })();

  const CAR_COLORS = ['#c3c7cc', '#e2e2e2', '#596272', '#7d3434', '#2e3d5a', '#b9a36d', '#3c4a3c', '#f0f0f0', '#222428', '#8e9399'];
  const PLATES = () => `${['HR26', 'HR55', 'DL3C', 'HR38', 'HR29', 'UP16'][Math.floor(Math.random() * 6)]} ${['DK', 'AB', 'CZ', 'BT', 'AQ'][Math.floor(Math.random() * 5)]} ${Math.floor(1000 + Math.random() * 9000)}`;

  function rr(rng, a, b) { return a + rng() * (b - a); }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  class Feed {
    constructor(canvas, opts) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); this.o = opts;
      this.rng = DB.util.mulberry32(opts.seed || 7);
      this.veh = []; this.t = 0; this.spawnIn = 0; this.last = 0; this.ai = opts.ai !== false;
      this.slots = { 0: [null, null], 1: [null, null] };
      this.cycle = rr(this.rng, 0, 60);
      this.resize();
      feeds.add(this);
      // warm up so the scene isn't empty
      for (let i = 0; i < 260; i++) this.update(0.1);
    }
    resize() {
      const w = this.c.clientWidth || 320, h = this.c.clientHeight || 180;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (this.w === w && this.h === h) return;
      this.w = w; this.h = h;
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    night() { const hr = new Date().getHours(); return hr < 6 || hr >= 19; }

    // ---------- simulation ----------
    update(dt) {
      this.t += dt;
      const s = this.o.scene;
      if (s === 'forecourt') this.updForecourt(dt);
      else if (s === 'entry') this.updEntry(dt);
      else if (s === 'decant') this.cycle = (this.cycle + dt) % 70;
      else if (s === 'cash') this.cycle = (this.cycle + dt) % 40;
    }
    newVehicle(lane) {
      const x = this.rng();
      const type = x < 0.38 ? 'bike' : x < 0.5 ? 'auto' : x < 0.88 ? 'car' : 'truck';
      const dims = { bike: [0.05, 0.03], auto: [0.07, 0.045], car: [0.11, 0.06], truck: [0.2, 0.075] }[type];
      return { type, w: dims[0], h: dims[1], x: -0.15, lane, v: 0.14, color: CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)], state: 'in', target: null, wait: 0, conf: rr(this.rng, 0.86, 0.99), plate: PLATES() };
    }
    updForecourt(dt) {
      const LANES = [0.44, 0.74], ISL = [0.36, 0.66];
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) {
        const lane = this.rng() < 0.5 ? 0 : 1;
        const inLane = this.veh.filter((v) => v.lane === lane && v.x < 0.1);
        if (!inLane.length && this.veh.length < 9) this.veh.push(this.newVehicle(lane));
        this.spawnIn = rr(this.rng, 1.5, 4.5);
      }
      for (const v of this.veh) {
        const sl = this.slots[v.lane];
        if (v.state === 'in' && v.target == null) {
          if (!sl[1] && !sl[0]) { sl[1] = v; v.target = 1; }
          else if (!sl[0] && (!sl[1] || sl[1].state !== 'fuel' || true)) { if (!sl[0]) { sl[0] = v; v.target = 0; } }
        }
        let goal = v.state === 'out' ? 1.4 : v.target != null ? ISL[v.target] : 0.2;
        const ahead = this.veh.filter((u) => u !== v && u.lane === v.lane && u.x > v.x).sort((a, b) => a.x - b.x)[0];
        if (ahead) goal = Math.min(goal, ahead.x - ahead.w / 2 - v.w / 2 - 0.02);
        const d = goal - v.x;
        const vmax = v.state === 'out' ? 0.22 : 0.16;
        v.v = Math.max(0, Math.min(vmax, d * 1.6));
        v.x += v.v * dt;
        if (v.state === 'in' && v.target != null && Math.abs(v.x - ISL[v.target]) < 0.006) { v.state = 'fuel'; v.wait = rr(this.rng, 4, v.type === 'truck' ? 16 : 10); }
        if (v.state === 'fuel') { v.wait -= dt; if (v.wait <= 0) { v.state = 'out'; sl[v.target] = null; } }
      }
      this.veh = this.veh.filter((v) => v.x < 1.3);
      this.lanesY = LANES; this.isl = ISL;
    }
    updEntry(dt) {
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) {
        const dir = this.rng() < 0.5 ? 1 : -1;
        const v = this.newVehicle(dir > 0 ? 0 : 1);
        v.dir = dir; v.x = dir > 0 ? -0.15 : 1.15; v.v = rr(this.rng, 0.16, 0.3);
        if (!this.veh.some((u) => u.dir === dir && Math.abs(u.x - v.x) < 0.3)) this.veh.push(v);
        this.spawnIn = rr(this.rng, 0.8, 2.6);
      }
      for (const v of this.veh) v.x += v.v * v.dir * dt;
      this.veh = this.veh.filter((v) => v.x > -0.3 && v.x < 1.3);
    }

    // ---------- drawing ----------
    draw() {
      this.resize();
      const { ctx, w, h } = this;
      const online = this.o.online !== false;
      if (!online) return this.drawOffline();
      const s = this.o.scene;
      if (s === 'forecourt') this.drawForecourt();
      else if (s === 'entry') this.drawEntry();
      else if (s === 'decant') this.drawDecant();
      else this.drawCash();
      if (this.night()) { ctx.fillStyle = 'rgba(0,10,30,0.35)'; ctx.fillRect(0, 0, w, h); }
      this.post();
    }
    ground(top, bot) {
      const { ctx, w, h } = this;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, top); g.addColorStop(1, bot);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    vehicle(v, x, y, flip) {
      const { ctx, w, h } = this;
      const vw = v.w * w, vh = v.h * h * 1.6;
      ctx.save(); ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx, -vw / 2 + 2, -vh / 2 + 3, vw, vh, 3); ctx.fill();
      if (v.type === 'bike') {
        ctx.fillStyle = '#1b1d20'; roundRect(ctx, -vw / 2, -vh / 6, vw, vh / 3, 2); ctx.fill();
        ctx.fillStyle = v.color; ctx.beginPath(); ctx.arc(0, -vh / 8, vh / 4, 0, 7); ctx.fill();
      } else if (v.type === 'auto') {
        ctx.fillStyle = '#2f6b2f'; roundRect(ctx, -vw / 2, -vh / 2, vw, vh, 4); ctx.fill();
        ctx.fillStyle = '#e8c54a'; roundRect(ctx, -vw / 2 + 2, -vh / 2 + 2, vw * 0.7, vh - 4, 3); ctx.fill();
      } else if (v.type === 'truck') {
        ctx.fillStyle = '#d9d4c7'; roundRect(ctx, -vw / 2, -vh / 2, vw * 0.72, vh, 2); ctx.fill();
        ctx.fillStyle = v.color; roundRect(ctx, vw * 0.24, -vh / 2 + 1, vw * 0.26, vh - 2, 3); ctx.fill();
        ctx.fillStyle = '#9fb3c8'; ctx.fillRect(vw * 0.42, -vh / 2 + 3, 3, vh - 6);
      } else {
        ctx.fillStyle = v.color; roundRect(ctx, -vw / 2, -vh / 2, vw, vh, 5); ctx.fill();
        ctx.fillStyle = 'rgba(20,30,40,0.75)'; roundRect(ctx, vw * 0.08, -vh / 2 + 3, vw * 0.22, vh - 6, 3); ctx.fill();
        ctx.fillStyle = 'rgba(20,30,40,0.55)'; roundRect(ctx, -vw * 0.36, -vh / 2 + 4, vw * 0.14, vh - 8, 2); ctx.fill();
      }
      ctx.restore();
      return { x: x - vw / 2, y: y - vh / 2, w: vw, h: vh };
    }
    box(b, label, color) {
      if (!this.ai) return;
      const { ctx } = this;
      color = 'rgba(255,255,255,0.9)';
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
      ctx.font = '500 9px Inter, sans-serif';
      const tw = ctx.measureText(label).width + 6;
      ctx.fillStyle = color; ctx.fillRect(b.x - 3, b.y - 15, tw, 12);
      ctx.fillStyle = '#05080c'; ctx.fillText(label, b.x, b.y - 6);
    }
    person(x, y, color) {
      const { ctx } = this;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 9, 6, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = color || '#c0392b'; roundRect(ctx, x - 5, y - 2, 10, 11, 3); ctx.fill();
      ctx.fillStyle = '#d2a679'; ctx.beginPath(); ctx.arc(x, y - 6, 4, 0, 7); ctx.fill();
      return { x: x - 6, y: y - 11, w: 12, h: 22 };
    }
    drawForecourt() {
      const { ctx, w, h } = this;
      this.ground('#4b4f53', '#2b2e31');
      // lane markings
      ctx.strokeStyle = 'rgba(230,230,210,0.25)'; ctx.setLineDash([14, 12]); ctx.lineWidth = 2;
      [0.29, 0.59, 0.89].forEach((y) => { ctx.beginPath(); ctx.moveTo(0, y * h); ctx.lineTo(w, y * h); ctx.stroke(); });
      ctx.setLineDash([]);
      // canopy shadow & columns
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(w * 0.14, h * 0.24); ctx.lineTo(w * 0.86, h * 0.24); ctx.lineTo(w * 0.9, h * 0.94); ctx.lineTo(w * 0.1, h * 0.94); ctx.closePath(); ctx.fill();
      // islands
      (this.isl || [0.36, 0.66]).forEach((ix) => {
        ctx.fillStyle = '#6d7276'; roundRect(ctx, ix * w - w * 0.06, h * 0.555, w * 0.12, h * 0.07, 4); ctx.fill();
        ctx.fillStyle = '#e9edf0'; ctx.fillRect(ix * w - w * 0.025, h * 0.565, w * 0.05, h * 0.05);
        ctx.fillStyle = '#0d8a4f'; ctx.fillRect(ix * w - w * 0.025, h * 0.565, w * 0.05, h * 0.012);
        ctx.fillStyle = '#9aa1a6'; ctx.fillRect(ix * w - w * 0.075, h * 0.3, 6, h * 0.04); ctx.fillRect(ix * w + w * 0.07, h * 0.3, 6, h * 0.04);
      });
      // vehicles
      const boxes = [];
      for (const v of this.veh) {
        const y = (this.lanesY || [0.44, 0.74])[v.lane] * h;
        const b = this.vehicle(v, v.x * w, y, false);
        boxes.push([b, v]);
      }
      // attendants near fuelling vehicles
      const people = [];
      for (const v of this.veh) if (v.state === 'fuel') {
        const y = (this.lanesY || [0.44, 0.74])[v.lane] * h;
        people.push(this.person(v.x * w + v.w * w * 0.2, y + (v.lane === 0 ? h * 0.08 : -h * 0.09), '#1d4ed8'));
      }
      boxes.forEach(([b, v]) => this.box(b, `${v.type === 'bike' ? '2W' : v.type.toUpperCase()} ${v.conf.toFixed(2)}`));
      people.forEach((b) => this.box(b, 'STAFF', '#8fd3ac'));
      if (this.ai && this.w >= 300) {
        const q = Math.max(0, this.veh.filter((v) => v.state === 'in' && v.v < 0.02).length);
        ctx.font = '600 10px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(5,8,12,0.7)'; ctx.fillRect(w - 128, h - 24, 120, 16);
        ctx.fillStyle = q >= 3 ? '#efc77d' : '#8fd3ac';
        ctx.fillText(`QUEUE ${q} · VEH ${this.veh.length}`, w - 122, h - 12);
      }
    }
    drawEntry() {
      const { ctx, w, h } = this;
      this.ground('#3a5a3a', '#26402a');
      ctx.fillStyle = '#3f4347'; ctx.fillRect(0, h * 0.3, w, h * 0.46);
      ctx.strokeStyle = 'rgba(240,240,220,0.5)'; ctx.setLineDash([18, 14]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, h * 0.53); ctx.lineTo(w, h * 0.53); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, h * 0.3, w, 2); ctx.fillRect(0, h * 0.76 - 2, w, 2);
      ctx.fillStyle = '#55595d'; ctx.fillRect(w * 0.42, h * 0.76, w * 0.16, h * 0.24);
      ctx.font = '600 9px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText('ENTRY', w * 0.455, h * 0.9);
      for (const v of this.veh) {
        const y = (v.dir > 0 ? 0.64 : 0.42) * h;
        const b = this.vehicle(v, v.x * w, y, v.dir < 0);
        if (v.x > 0.15 && v.x < 0.85) this.box(b, v.type === 'bike' ? `2W ${v.conf.toFixed(2)}` : v.plate, v.type === 'bike' ? 'rgba(255,255,255,0.9)' : '#efc77d');
      }
      if (this.ai && this.w >= 300) { ctx.font = '600 10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(5,8,12,0.7)'; ctx.fillRect(w - 104, h - 24, 96, 16); ctx.fillStyle = '#efc77d'; ctx.fillText('ANPR ACTIVE', w - 98, h - 12); }
    }
    drawDecant() {
      const { ctx, w, h } = this;
      this.ground('#55595c', '#34373a');
      ctx.strokeStyle = '#d4b106'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
      ctx.strokeRect(w * 0.08, h * 0.2, w * 0.62, h * 0.42); ctx.setLineDash([]);
      // fill points
      const fps = [['MS', 0.3], ['HSD', 0.45], ['HSD', 0.6]];
      fps.forEach(([p, x]) => {
        ctx.fillStyle = '#1f2326'; ctx.beginPath(); ctx.arc(x * w, h * 0.78, h * 0.05, 0, 7); ctx.fill();
        ctx.strokeStyle = p === 'MS' ? '#8fd3ac' : '#efc77d'; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = '600 9px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(p, x * w - 9, h * 0.92);
      });
      // tanker cycle: 0-25 absent, 25-32 arriving, 32-60 parked, 60-70 leaving
      const c = this.cycle;
      let tx = null;
      if (c >= 25 && c < 32) tx = -0.4 + ((c - 25) / 7) * 0.79;
      else if (c >= 32 && c < 60) tx = 0.39;
      else if (c >= 60) tx = 0.39 + ((c - 60) / 10) * 0.9;
      if (tx != null) {
        const tw = w * 0.56, th = h * 0.3, x = tx * w, y = h * 0.41;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx, x - tw / 2 + 3, y - th / 2 + 4, tw, th, 6); ctx.fill();
        ctx.fillStyle = '#e9e5da'; roundRect(ctx, x - tw / 2, y - th / 2, tw * 0.78, th, th / 2.2); ctx.fill();
        ctx.fillStyle = '#c0392b'; ctx.fillRect(x - tw / 2 + tw * 0.05, y - 3, tw * 0.68, 6);
        ctx.fillStyle = '#2d4a7a'; roundRect(ctx, x + tw * 0.3, y - th / 2 + 2, tw * 0.2, th - 4, 6); ctx.fill();
        this.box({ x: x - tw / 2, y: y - th / 2, w: tw, h: th }, 'TANK TRUCK 0.97', '#efc77d');
        if (c >= 34 && c < 58) {
          ctx.strokeStyle = '#111'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(x - tw * 0.1, y + th / 2); ctx.quadraticCurveTo(x - tw * 0.05, h * 0.72, 0.45 * w, h * 0.78); ctx.stroke();
          const pb = this.person(w * 0.52 + Math.sin(this.t) * 6, h * 0.66, '#1d4ed8');
          this.box(pb, 'PERSON', '#8fd3ac');
        }
      }
      // cones
      [[0.76, 0.3], [0.76, 0.52]].forEach(([x, y]) => { ctx.fillStyle = '#ff6a00'; ctx.beginPath(); ctx.moveTo(x * w, y * h - 9); ctx.lineTo(x * w + 6, y * h + 6); ctx.lineTo(x * w - 6, y * h + 6); ctx.closePath(); ctx.fill(); });
      if (this.ai && this.w >= 300) { ctx.font = '600 10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(5,8,12,0.7)'; ctx.fillRect(w - 150, h - 24, 142, 16); ctx.fillStyle = tx != null && c >= 32 && c < 60 ? '#efc77d' : '#8fd3ac'; ctx.fillText(tx != null && c >= 32 && c < 60 ? 'DECANTATION ACTIVE' : 'BAY CLEAR', w - 144, h - 12); }
    }
    drawCash() {
      const { ctx, w, h } = this;
      this.ground('#6b6455', '#4a4438');
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += w / 10) { ctx.beginPath(); ctx.moveTo(x, h * 0.3); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = h * 0.3; y < h; y += h / 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.fillStyle = '#d8d2c2'; ctx.fillRect(0, 0, w, h * 0.3);
      // lube shelf
      const cols = ['#c0392b', '#f1c40f', '#2980b9', '#27ae60', '#e67e22'];
      for (let i = 0; i < 14; i++) { ctx.fillStyle = cols[i % cols.length]; ctx.fillRect(w * 0.05 + i * w * 0.028, h * 0.1, w * 0.02, h * 0.1); }
      ctx.fillStyle = '#5b4636'; ctx.fillRect(w * 0.04, h * 0.2, w * 0.42, 4);
      // counter
      ctx.fillStyle = '#3d4b5c'; roundRect(ctx, w * 0.5, h * 0.42, w * 0.42, h * 0.18, 4); ctx.fill();
      ctx.fillStyle = '#1b2430'; ctx.fillRect(w * 0.62, h * 0.44, w * 0.08, h * 0.06);
      const cb = this.person(w * 0.72, h * 0.34, '#1d4ed8');
      this.box(cb, 'STAFF', '#8fd3ac');
      const c = this.cycle;
      if (c > 8 && c < 30) {
        const px = c < 13 ? w * (0.1 + (c - 8) / 5 * 0.55) : c > 25 ? w * (0.65 - (c - 25) / 5 * 0.6) : w * 0.65;
        const pb = this.person(px, h * 0.74, '#7f8c8d');
        this.box(pb, 'PERSON 0.95');
      }
      if (this.ai && this.w >= 300) { ctx.font = '600 10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(5,8,12,0.7)'; ctx.fillRect(w - 118, h - 24, 110, 16); ctx.fillStyle = '#8fd3ac'; ctx.fillText('CASH DRAWER OK', w - 112, h - 12); }
    }
    drawOffline() {
      const { ctx, w, h } = this;
      ctx.drawImage(NOISE[Math.floor(Math.random() * 4)], 0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff4d5e'; ctx.font = `600 ${Math.max(12, w / 22)}px JetBrains Mono, monospace`; ctx.textAlign = 'center';
      ctx.fillText('NO SIGNAL', w / 2, h / 2);
      ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = '#8fa3b3';
      ctx.fillText('Camera offline · last frame 42 min ago', w / 2, h / 2 + 18);
      ctx.textAlign = 'left';
      this.overlayText();
    }
    post() {
      const { ctx, w, h } = this;
      ctx.globalAlpha = 0.04; ctx.drawImage(NOISE[Math.floor(this.t * 15) % 4], 0, 0, w, h); ctx.globalAlpha = 1;
      ctx.fillStyle = ctx.createPattern(SCAN, 'repeat'); ctx.fillRect(0, 0, w, h);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      this.overlayText();
    }
    overlayText() {
      const { ctx, w, h } = this;
      const small = w < 260;
      ctx.font = `600 ${small ? 9 : 10.5}px JetBrains Mono, monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(6, 6, Math.min(w - 12, ctx.measureText(this.o.label).width + 12), small ? 14 : 30);
      ctx.fillStyle = '#ffffff'; ctx.fillText(this.o.label.toUpperCase(), 12, small ? 16 : 18);
      if (!small) { ctx.font = '9.5px JetBrains Mono, monospace'; ctx.fillStyle = '#b7c4cf'; ctx.fillText(this.o.sub || '', 12, 31); }
      const d = new Date();
      const ts = (w < 340 ? '' : d.toLocaleDateString('en-GB') + ' ') + d.toLocaleTimeString('en-GB');
      ctx.font = `${small ? 9 : 10.5}px JetBrains Mono, monospace`; ctx.textAlign = 'right'; ctx.fillStyle = '#ffffff';
      ctx.fillText(ts, w - 10, small ? 16 : 18);
      ctx.textAlign = 'left';
      if (this.o.online !== false && Math.floor(Date.now() / 700) % 2 === 0) { ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(14, h - 13, 4, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#fff'; ctx.font = '600 9.5px JetBrains Mono, monospace'; ctx.fillText(this.o.online !== false ? 'REC' + (this.ai ? '  ·  AI' : '') : 'OFFLINE', 23, h - 10);
    }
    destroy() { feeds.delete(this); }
  }

  function loop(ts) {
    for (const f of feeds) {
      if (!f.c.isConnected) { feeds.delete(f); continue; }
      if (f.c.offsetParent === null) continue;
      if (ts - f.last < FPS_MS) continue;
      const dt = Math.min(0.2, (ts - (f.last || ts)) / 1000) || 0.066;
      f.last = ts;
      f.update(dt);
      f.draw();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.CCTV = {
    attach(canvas, opts) { return new Feed(canvas, opts); },
    setAI(on) { feeds.forEach((f) => { f.ai = on; }); },
    count() { return feeds.size; },
  };
})();
