/* =====================================================================
   PRAHARI POC — map layer (MapLibre GL, satellite + dark basemaps)
   ===================================================================== */
(function () {
  'use strict';
  const { outlets, depots, tankers, competitors, area, PRODUCTS } = DB;
  const MV = { map: null, outletMk: {}, tankerMk: {}, depotMk: {}, layers: {}, selected: null, selTanker: null, is3D: false, ready: false };
  const TRUCK_SVG = '<svg viewBox="0 0 24 24"><path d="M1 6h13v9H1z M14 9h4.5l3.5 3.5V15h-8z M5.5 19a2 2 0 100-4 2 2 0 000 4z M17.5 19a2 2 0 100-4 2 2 0 000 4z"/></svg>';

  function bounds() {
    const b = new maplibregl.LngLatBounds();
    outlets.forEach((o) => b.extend([o.lng, o.lat]));
    depots.forEach((d) => b.extend([d.lng, d.lat]));
    return b;
  }
  function padding() {
    const right = document.getElementById('stage').classList.contains('right-open') ? 480 : 230;
    return { top: 50, bottom: 50, left: 400, right };
  }

  MV.init = function (onReady) {
    const style = {
      version: 8,
      sources: {
        sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
        roads: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
        labels: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
        dark: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16, attribution: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors' },
        darkref: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16 },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#05080c' } },
        { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -0.3, 'raster-brightness-max': 0.82, 'raster-contrast': 0.08 } },
        { id: 'roads', type: 'raster', source: 'roads', paint: { 'raster-opacity': 0.45 } },
        { id: 'labels', type: 'raster', source: 'labels', maxzoom: 15, paint: { 'raster-opacity': 0.9 } },
        { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
        { id: 'darkref', type: 'raster', source: 'darkref', layout: { visibility: 'none' } },
      ],
    };
    const map = new maplibregl.Map({
      container: 'map', style, center: [78.9, 22.5], zoom: 3.6, pitch: 0, bearing: 0,
      attributionControl: { compact: true }, maxPitch: 75, antialias: true,
    });
    MV.map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    let setupDone = false;
    const setup = () => {
      if (setupDone || !(map.style && map.style._loaded)) return;
      setupDone = true;
      // sales area polygon
      map.addSource('area', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [area] } } });
      map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.045 } });
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#38bdf8', 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } });
      // routes
      map.addSource('routes', { type: 'geojson', data: routesGeo() });
      map.addLayer({ id: 'routes-glow', type: 'line', source: 'routes', paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'sel'], 8, 4], 'line-opacity': 0.18, 'line-blur': 3 } });
      map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'sel'], 2.6, 1.3], 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 } });
      // competitors
      map.addSource('comp', { type: 'geojson', data: { type: 'FeatureCollection', features: competitors.map((c) => ({ type: 'Feature', properties: { brand: c.brand, est: c.estDaily, isNew: !!c.isNew }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })) } });
      map.addLayer({ id: 'comp-dot', type: 'circle', source: 'comp', layout: { visibility: 'none' }, paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 7], 'circle-color': ['match', ['get', 'brand'], 'Brand B', '#e879f9', 'Brand C', '#fb923c', '#94a3b8'],
        'circle-stroke-color': ['case', ['get', 'isNew'], '#ffffff', '#05080c'], 'circle-stroke-width': ['case', ['get', 'isNew'], 2.5, 1], 'circle-opacity': 0.9 } });
      // heat
      map.addSource('heat', { type: 'geojson', data: heatGeo() });
      map.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', layout: { visibility: 'none' }, paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'w'], 0, 0, 25, 1], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 13, 2],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 22, 13, 60], 'heatmap-opacity': 0.75,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, '#0e7490', 0.45, '#22d3ee', 0.7, '#facc15', 1, '#ef4444'] } });
      // 3D columns
      map.addSource('cols', { type: 'geojson', data: columnsGeo() });
      map.addLayer({ id: 'cols', type: 'fill-extrusion', source: 'cols', layout: { visibility: 'none' }, paint: {
        'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.85 } });

      map.on('mousemove', 'comp-dot', (e) => {
        const p = e.features[0].properties;
        UI.tooltip(e.originalEvent, `<b>${p.brand}${p.isNew === true || p.isNew === 'true' ? ' · NEW' : ''}</b><div class="tt-row"><span>Competitor outlet</span><span></span></div><div class="tt-row"><span>Est. volume</span><span>${(+p.est).toFixed(1)} kL/day</span></div>`);
      });
      map.on('mouseleave', 'comp-dot', () => UI.tooltip(null));

      addMarkers();
      map.on('zoom', () => { document.getElementById('map').classList.toggle('show-labels', map.getZoom() >= 11.3); });
      map.on('move', hud);
      hud();
      MV.ready = true;
      onReady && onReady();
    };
    map.on('style.load', setup);
    map.on('styledata', setup);
    map.on('load', setup);
  };

  function hud() {
    const c = MV.map.getCenter();
    document.getElementById('hud').textContent = `${c.lat.toFixed(4)}°N  ${c.lng.toFixed(4)}°E   Z ${MV.map.getZoom().toFixed(1)}   PITCH ${Math.round(MV.map.getPitch())}°   BRG ${Math.round(MV.map.getBearing())}°`;
  }

  // MapLibre positions the outer element; our styled element lives inside it
  function wrap(el) { const w = document.createElement('div'); w.appendChild(el); return w; }

  function addMarkers() {
    outlets.forEach((o) => {
      const el = document.createElement('div');
      el.className = 'mk mk-outlet ' + ((o.m && o.m.status) || 'ok');
      el.innerHTML = `<div class="ringo"></div><div class="core"></div><div class="mk-label">${o.name}</div>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); UI.selectOutlet(o.id); });
      el.addEventListener('mousemove', (e) => UI.tooltip(e, outletTip(o)));
      el.addEventListener('mouseleave', () => UI.tooltip(null));
      MV.outletMk[o.id] = { el, mk: new maplibregl.Marker({ element: wrap(el) }).setLngLat([o.lng, o.lat]).addTo(MV.map) };
    });
    depots.forEach((d) => {
      const el = document.createElement('div');
      el.className = 'mk mk-depot';
      el.innerHTML = `<div class="dia"></div><div class="mk-label">${d.short}</div>`;
      el.addEventListener('mousemove', (e) => UI.tooltip(e, `<b>${d.name}</b><div class="tt-row"><span>Supply point</span><span>${d.id}</span></div><div class="tt-row"><span>Storage</span><span>${(d.capacityKL / 1000).toFixed(0)}k kL</span></div><div class="tt-row"><span>Trucks loading</span><span>${tankers.filter((t) => t.depotId === d.id && t.status === 'Loading').length}</span></div>`));
      el.addEventListener('mouseleave', () => UI.tooltip(null));
      MV.depotMk[d.id] = { el, mk: new maplibregl.Marker({ element: wrap(el) }).setLngLat([d.lng, d.lat]).addTo(MV.map) };
    });
    tankers.forEach(addTanker);
  }
  function addTanker(t) {
    const el = document.createElement('div');
    el.className = 'mk mk-tanker';
    el.innerHTML = `<div class="tb">${TRUCK_SVG}</div>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); UI.selectTanker(t.id); });
    el.addEventListener('mousemove', (e) => UI.tooltip(e, tankerTip(t)));
    el.addEventListener('mouseleave', () => UI.tooltip(null));
    const p = Sim.tankerPos(t);
    MV.tankerMk[t.id] = { el, mk: new maplibregl.Marker({ element: wrap(el) }).setLngLat([p.lng, p.lat]).addTo(MV.map) };
  }

  function outletTip(o) {
    const m = o.m;
    const st = { ok: 'Healthy', warn: 'Attention', crit: 'Critical', off: 'Offline' }[m.status];
    return `<b>${o.name}</b><div class="tt-row"><span>${o.id} · ${o.locality}</span><span class="c-${m.status}">${st}</span></div>
      <div class="tt-row"><span>Today</span><span>${(m.todayL / 1000).toFixed(2)} kL</span></div>
      <div class="tt-row"><span>MTD vs target</span><span>${Math.round(m.ach * 100)}%</span></div>
      <div class="tt-row"><span>Min. stock cover</span><span>${m.minDays.toFixed(1)} d (${PRODUCTS[m.minP].code})</span></div>
      <div class="tt-row"><span>Health score</span><span>${m.score}</span></div>`;
  }
  function tankerTip(t) {
    const o = DB.byId(t.outletId);
    const eta = Sim.etaMin(t);
    return `<b>${t.plate}</b><div class="tt-row"><span>${t.transporter}</span><span>${t.cap} kL</span></div>
      <div class="tt-row"><span>Status</span><span>${t.status}</span></div>
      <div class="tt-row"><span>To</span><span>${o.name.length > 22 ? o.name.slice(0, 21) + '…' : o.name}</span></div>
      <div class="tt-row"><span>Load</span><span>${t.comps.map((c) => c.kl + ' ' + PRODUCTS[c.product].code).join(' + ')}</span></div>
      ${eta ? `<div class="tt-row"><span>ETA</span><span>${eta} min</span></div>` : ''}`;
  }

  function routesGeo() {
    return { type: 'FeatureCollection', features: tankers.filter((t) => ['In transit', 'Halted', 'Loading', 'Returning'].includes(t.status)).map((t) => ({
      type: 'Feature', properties: { id: t.id, sel: MV.selTanker === t.id, color: t.status === 'Halted' ? '#ff4d5e' : t.status === 'Returning' ? '#5d7080' : '#38bdf8' },
      geometry: { type: 'LineString', coordinates: t.route.pts },
    })) };
  }
  function heatGeo() {
    return { type: 'FeatureCollection', features: outlets.map((o) => ({ type: 'Feature', properties: { w: o.daily }, geometry: { type: 'Point', coordinates: [o.lng, o.lat] } })) };
  }
  function columnsGeo() {
    const col = { ok: '#3ddc97', warn: '#f5b942', crit: '#ff4d5e', off: '#7b8794' };
    return { type: 'FeatureCollection', features: outlets.map((o) => {
      const s = 0.0016, sx = s / Math.cos(o.lat * Math.PI / 180);
      const ring = [[o.lng - sx, o.lat - s], [o.lng + sx, o.lat - s], [o.lng + sx, o.lat + s], [o.lng - sx, o.lat + s], [o.lng - sx, o.lat - s]];
      return { type: 'Feature', properties: { h: o.daily * 260, color: col[(o.m && o.m.status) || 'ok'] }, geometry: { type: 'Polygon', coordinates: [ring] } };
    }) };
  }

  MV.update = function () {
    if (!MV.ready) return;
    outlets.forEach((o) => {
      const r = MV.outletMk[o.id];
      const cls = 'mk mk-outlet ' + o.m.status + (MV.selected === o.id ? ' selected' : '');
      if (r.el.className !== cls) r.el.className = cls;
    });
    tankers.forEach((t) => {
      if (!MV.tankerMk[t.id]) addTanker(t);
      const r = MV.tankerMk[t.id];
      const p = Sim.tankerPos(t);
      r.mk.setLngLat([p.lng, p.lat]);
      const cls = 'mk mk-tanker' + (t.status === 'Halted' ? ' halt' : '') + (t.status === 'Loading' || t.status === 'Unloading' ? ' idle' : '') + (MV.selTanker === t.id ? ' sel' : '');
      if (r.el.className !== cls) r.el.className = cls;
    });
    const src = MV.map.getSource('routes');
    if (src) src.setData(routesGeo());
    if (Sim.t % 5 === 0) { const c = MV.map.getSource('cols'); if (c) c.setData(columnsGeo()); }
  };

  MV.setLayer = function (name, on) {
    const map = MV.map, vis = on ? 'visible' : 'none';
    MV.layers[name] = on;
    if (name === 'outlets') Object.values(MV.outletMk).forEach((r) => { r.el.style.display = on ? '' : 'none'; });
    if (name === 'tankers') Object.values(MV.tankerMk).forEach((r) => { r.el.style.display = on ? '' : 'none'; });
    if (name === 'depots') Object.values(MV.depotMk).forEach((r) => { r.el.style.display = on ? '' : 'none'; });
    if (name === 'routes') { map.setLayoutProperty('routes-line', 'visibility', vis); map.setLayoutProperty('routes-glow', 'visibility', vis); }
    if (name === 'area') { map.setLayoutProperty('area-fill', 'visibility', vis); map.setLayoutProperty('area-line', 'visibility', vis); }
    if (name === 'competitors') map.setLayoutProperty('comp-dot', 'visibility', vis);
    if (name === 'heat') map.setLayoutProperty('heat', 'visibility', vis);
    if (name === 'columns') {
      map.setLayoutProperty('cols', 'visibility', vis);
      if (on && map.getPitch() < 30) map.easeTo({ pitch: 55, bearing: -18, duration: 1200 });
    }
  };
  MV.setBasemap = function (b) {
    ['sat', 'roads', 'labels'].forEach((l) => MV.map.setLayoutProperty(l, 'visibility', b === 'sat' ? 'visible' : 'none'));
    ['dark', 'darkref'].forEach((l) => MV.map.setLayoutProperty(l, 'visibility', b === 'dark' ? 'visible' : 'none'));
  };
  MV.toggle3D = function () {
    MV.is3D = MV.map.getPitch() < 20;
    MV.map.easeTo({ pitch: MV.is3D ? 60 : 0, bearing: MV.is3D ? -20 : 0, duration: 1000 });
    return MV.is3D;
  };
  MV.home = function (animate) {
    MV.map.fitBounds(bounds(), { padding: padding(), pitch: 30, bearing: -8, duration: animate === false ? 0 : 2200, essential: true });
  };
  MV.intro = function () {
    MV.map.fitBounds(bounds(), { padding: padding(), pitch: 30, bearing: -8, duration: 4200, curve: 1.6, essential: true });
  };
  MV.flyToOutlet = function (o) {
    MV.selected = o.id;
    MV.selTanker = null;
    MV.update();
    MV.map.flyTo({ center: [o.lng, o.lat], zoom: 16.6, pitch: 58, bearing: -25, duration: 2400, essential: true, padding: { left: 380, right: 470, top: 0, bottom: 0 } });
  };
  MV.flyToTanker = function (t) {
    MV.selTanker = t.id;
    MV.update();
    const p = Sim.tankerPos(t);
    MV.map.flyTo({ center: [p.lng, p.lat], zoom: 13.2, pitch: 45, bearing: -10, duration: 2000, essential: true, padding: { left: 380, right: 470, top: 0, bottom: 0 } });
  };
  MV.clearSelection = function () { MV.selected = null; MV.selTanker = null; MV.update(); };
  MV.resize = function () { MV.map && MV.map.resize(); };

  window.MapView = MV;
})();
