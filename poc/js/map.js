/* =====================================================================
   PRAHARI — map layer (MapLibre GL; neutral map + satellite)
   ===================================================================== */
(function () {
  'use strict';
  const { outlets, depots, tankers, competitors, area, PRODUCTS } = DB;
  const MV = { map: null, outletMk: {}, tankerMk: {}, depotMk: {}, layers: {}, selected: null, selTanker: null, ready: false, base: 'dark', userBase: null, onBasemap: null };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TRUCK_SVG = '<svg viewBox="0 0 24 24"><path d="M1 6h13v9H1zM14 9h4.5l3.5 3.5V15h-8zM5.5 19a2 2 0 100-4 2 2 0 000 4zM17.5 19a2 2 0 100-4 2 2 0 000 4z"/></svg>';
  const STATUS_HEX = { ok: '#57b583', warn: '#e0a645', crit: '#e5604f', off: '#7c8188' };
  const STATUS_TXT = { ok: 'Running normally', warn: 'Needs attention', crit: 'Urgent', off: 'Offline' };

  function bounds() {
    const b = new maplibregl.LngLatBounds();
    outlets.forEach((o) => b.extend([o.lng, o.lat]));
    depots.forEach((d) => b.extend([d.lng, d.lat]));
    return b;
  }
  function padding() {
    const st = document.getElementById('stage');
    const leftOpen = !document.getElementById('leftPanel').classList.contains('hidden');
    const w = (id) => document.getElementById(id).offsetWidth || 0;
    return { top: 70, bottom: 60, left: leftOpen ? w('leftPanel') + 40 : 60, right: st.classList.contains('right-open') ? w('rightPanel') + 40 : 60 };
  }

  MV.init = function (onReady) {
    const esri = (p) => `https://server.arcgisonline.com/ArcGIS/rest/services/${p}/MapServer/tile/{z}/{y}/{x}`;
    const style = {
      version: 8,
      sources: {
        dark: { type: 'raster', tiles: [esri('Canvas/World_Dark_Gray_Base')], tileSize: 256, maxzoom: 16, attribution: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors' },
        darkref: { type: 'raster', tiles: [esri('Canvas/World_Dark_Gray_Reference')], tileSize: 256, maxzoom: 16 },
        sat: { type: 'raster', tiles: [esri('World_Imagery')], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
        roads: { type: 'raster', tiles: [esri('Reference/World_Transportation')], tileSize: 256, maxzoom: 19 },
        labels: { type: 'raster', tiles: [esri('Reference/World_Boundaries_and_Places')], tileSize: 256, maxzoom: 19 },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0c0d0f' } },
        { id: 'dark', type: 'raster', source: 'dark', paint: { 'raster-saturation': -1, 'raster-brightness-min': 0.02, 'raster-brightness-max': 0.92, 'raster-contrast': 0.05 } },
        { id: 'darkref', type: 'raster', source: 'darkref', paint: { 'raster-opacity': 0.75 } },
        { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.35, 'raster-brightness-max': 0.85 } },
        { id: 'roads', type: 'raster', source: 'roads', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.35 } },
        { id: 'labels', type: 'raster', source: 'labels', maxzoom: 15, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } },
      ],
    };
    const map = new maplibregl.Map({ container: 'map', style, center: [78.9, 22.5], zoom: 3.6, attributionControl: { compact: true }, maxPitch: 75, antialias: true });
    MV.map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    let setupDone = false;
    const setup = () => {
      if (setupDone || !(map.style && map.style._loaded)) return;
      setupDone = true;
      map.addSource('area', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [area] } } });
      // Dim everything outside the sales area (world polygon with the area cut out as a hole)
      const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
      map.addSource('area-mask', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [world, area.slice().reverse()] } } });
      map.addLayer({ id: 'area-mask', type: 'fill', source: 'area-mask', paint: { 'fill-color': '#000000', 'fill-opacity': 0.28 } });
      map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.02 } });
      // Dark casing under a light line keeps the edge readable on imagery
      map.addLayer({ id: 'area-casing', type: 'line', source: 'area', layout: { 'line-join': 'round' }, paint: { 'line-color': '#000000', 'line-width': 4, 'line-opacity': 0.45, 'line-blur': 1 } });
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', layout: { 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 1.4, 'line-dasharray': [4, 3], 'line-opacity': 0.55 } });
      // The roads trucks can use (OpenStreetMap, motorway to tertiary), off by default.
      if (window.RoadNet && RoadNet.ok) {
        map.addSource('roadnet', { type: 'geojson', data: RoadNet.geojson(), attribution: 'Routing data © OpenStreetMap contributors (ODbL)' });
        map.addLayer({ id: 'roadnet', type: 'line', source: 'roadnet', layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' }, paint: {
          'line-color': ['match', ['get', 'cls'], 0, '#7aa7ff', 1, '#7aa7ff', 2, '#9fb6d6', '#5d6773'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['match', ['get', 'cls'], 0, 1.6, 1, 1.6, 2, 1.1, 0.5], 14, ['match', ['get', 'cls'], 0, 4, 1, 4, 2, 3, 1.5]],
          'line-opacity': 0.55 } });
      }
      // Geofence corridor around the selected truck's planned route: ±250 m on the ground at any zoom.
      map.addSource('corridor', { type: 'geojson', data: corridorGeo() });
      map.addLayer({ id: 'corridor', type: 'line', source: 'corridor', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {
        'line-color': '#7aa7ff', 'line-opacity': 0.13, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, metresToPx(500, 8), 18, metresToPx(500, 18)] } });
      map.addSource('routes', { type: 'geojson', data: routesGeo() });
      map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', filter: ['!=', ['get', 'kind'], 'detour'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {
        'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'sel'], 2.6, 1.3],
        'line-opacity': ['case', ['==', ['get', 'kind'], 'done'], 0.28, ['get', 'sel'], 0.95, 0.5], 'line-dasharray': [2, 2] } });
      // Where an off-route truck actually went: solid red along the real side road.
      map.addLayer({ id: 'routes-detour', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'detour'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {
        'line-color': '#e5604f', 'line-width': ['case', ['get', 'sel'], 3.2, 2.2], 'line-opacity': 0.9 } });
      map.addSource('comp', { type: 'geojson', data: { type: 'FeatureCollection', features: competitors.map((c) => ({ type: 'Feature', properties: { brand: c.brand, est: c.estDaily, isNew: !!c.isNew }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })) } });
      map.addLayer({ id: 'comp-dot', type: 'circle', source: 'comp', layout: { visibility: 'none' }, paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 6], 'circle-color': ['match', ['get', 'brand'], 'Brand B', '#b48ead', 'Brand C', '#d08770', '#8f959c'],
        'circle-stroke-color': ['case', ['get', 'isNew'], '#ffffff', '#0c0d0f'], 'circle-stroke-width': ['case', ['get', 'isNew'], 2, 1] } });
      map.addSource('heat', { type: 'geojson', data: { type: 'FeatureCollection', features: outlets.map((o) => ({ type: 'Feature', properties: { w: o.daily }, geometry: { type: 'Point', coordinates: [o.lng, o.lat] } })) } });
      map.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', layout: { visibility: 'none' }, paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'w'], 0, 0, 25, 1], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 13, 2],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 22, 13, 60], 'heatmap-opacity': 0.7,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.25, '#2b4a6f', 0.5, '#7aa7ff', 0.75, '#e0a645', 1, '#e5604f'] } });
      map.addSource('cols', { type: 'geojson', data: columnsGeo() });
      map.addLayer({ id: 'cols', type: 'fill-extrusion', source: 'cols', layout: { visibility: 'none' }, paint: {
        'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.85 } });

      map.on('mousemove', 'comp-dot', (e) => {
        const p = e.features[0].properties;
        const isNew = p.isNew === true || p.isNew === 'true';
        UI.tooltip(e.originalEvent, `<b>${p.brand} outlet${isNew ? ' (new)' : ''}</b><div class="tt-row"><span>Competitor</span><span></span></div><div class="tt-row"><span>Estimated sales</span><span>${(+p.est).toFixed(1)} kL/day</span></div>`);
      });
      map.on('mouseleave', 'comp-dot', () => UI.tooltip(null));

      addMarkers();
      map.on('zoom', () => { document.getElementById('map').classList.toggle('show-labels', map.getZoom() >= 11.5); });
      MV.ready = true;
      onReady && onReady();
    };
    // If map images can't be fetched (no internet, blocked), say so instead of showing dots on black
    let tileErrors = 0, tileOk = false;
    const notice = (msg) => { const n = document.getElementById('mapNotice'); if (!n) return; n.textContent = msg || ''; n.classList.toggle('hidden', !msg); };
    const BASE = ['dark', 'darkref', 'sat', 'roads', 'labels'];
    map.on('error', (e) => {
      if (!e || !BASE.includes(e.sourceId)) { if (e && e.error) console.warn('map:', e.error.message || e.error); return; }
      if (++tileErrors >= 6 && !tileOk) notice('Map images could not load, probably no internet connection. Outlets, trucks and all the data still work.');
    });
    map.on('sourcedata', (e) => { if (e.tile && BASE.includes(e.sourceId)) { tileOk = true; tileErrors = 0; notice(''); } });
    map.on('style.load', setup);
    map.on('styledata', setup);
    map.on('load', setup);
  };

  // MapLibre positions the outer element; our styled element lives inside it
  function wrap(el) { const w = document.createElement('div'); w.appendChild(el); return w; }

  function addMarkers() {
    outlets.forEach((o) => {
      const el = document.createElement('div');
      el.className = 'mk mk-outlet ' + ((o.m && o.m.status) || 'ok');
      el.innerHTML = `<div class="mk-label">${o.name}</div>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); UI.selectOutlet(o.id); });
      el.addEventListener('mousemove', (e) => UI.tooltip(e, outletTip(o)));
      el.addEventListener('mouseleave', () => UI.tooltip(null));
      MV.outletMk[o.id] = { el, mk: new maplibregl.Marker({ element: wrap(el) }).setLngLat([o.lng, o.lat]).addTo(MV.map) };
    });
    depots.forEach((d) => {
      const el = document.createElement('div');
      el.className = 'mk mk-depot';
      el.innerHTML = `<div class="mk-label">${d.name}</div>`;
      el.addEventListener('mousemove', (e) => UI.tooltip(e, `<b>${d.name}</b><div class="tt-row"><span>Supply point</span><span>${d.id}</span></div><div class="tt-row"><span>Storage</span><span>${(d.capacityKL / 1000).toFixed(0)}k kL</span></div><div class="tt-row"><span>Trucks loading</span><span>${tankers.filter((t) => t.depotId === d.id && t.status === 'Loading').length}</span></div>`));
      el.addEventListener('mouseleave', () => UI.tooltip(null));
      MV.depotMk[d.id] = { el, mk: new maplibregl.Marker({ element: wrap(el) }).setLngLat([d.lng, d.lat]).addTo(MV.map) };
    });
    tankers.forEach(addTanker);
  }
  function addTanker(t) {
    const el = document.createElement('div');
    el.className = 'mk mk-tanker';
    el.innerHTML = TRUCK_SVG;
    el.addEventListener('click', (e) => { e.stopPropagation(); UI.selectTanker(t.id); });
    el.addEventListener('mousemove', (e) => UI.tooltip(e, tankerTip(t)));
    el.addEventListener('mouseleave', () => UI.tooltip(null));
    const p = Sim.tankerPos(t);
    MV.tankerMk[t.id] = { el, mk: new maplibregl.Marker({ element: wrap(el) }).setLngLat([p.lng, p.lat]).addTo(MV.map) };
    if (MV.layers.tankers === false) el.style.display = 'none';
  }

  function outletTip(o) {
    const m = o.m;
    return `<b>${o.name}</b>
      <div class="tt-row"><span>${o.locality}</span><span style="color:${STATUS_HEX[m.status]}">${STATUS_TXT[m.status]}</span></div>
      <div class="tt-row"><span>Sold today</span><span>${(m.todayL / 1000).toFixed(1)} kL</span></div>
      <div class="tt-row"><span>Month vs target</span><span>${Math.round(m.ach * 100)}%</span></div>
      <div class="tt-row"><span>Lowest stock</span><span>${m.minDays.toFixed(1)} days ${PRODUCTS[m.minP].name.toLowerCase()}</span></div>`;
  }
  function tankerTip(t) {
    const o = DB.byId(t.outletId);
    const eta = Sim.etaMin(t);
    return `<b>${t.plate}</b>
      <div class="tt-row"><span>Status</span><span>${t.status}</span></div>
      <div class="tt-row"><span>Going to</span><span>${o.name.length > 22 ? o.name.slice(0, 21) + '…' : o.name}</span></div>
      <div class="tt-row"><span>Carrying</span><span>${t.comps.map((c) => c.kl + ' kL ' + PRODUCTS[c.product].name.toLowerCase()).join(', ')}</span></div>
      ${eta ? `<div class="tt-row"><span>Arrives in</span><span>${eta} min</span></div>` : ''}
      ${t.route.via && t.route.via[0] ? `<div class="tt-row"><span>Via</span><span>${esc(t.route.via[0].length > 26 ? t.route.via[0].slice(0, 25) + '…' : t.route.via[0])}</span></div>` : ''}`;
  }

  // Pixels a ground distance covers at a zoom level, at the sales area's latitude (for MapLibre's
  // exponential zoom interpolation, which then keeps the width true on the ground in between).
  function metresToPx(m, zoom) { return m / (156543.03 * Math.cos(28.4 * Math.PI / 180) / Math.pow(2, zoom)); }

  /**
   * Each truck's line splits at the truck: the road still ahead (dashed), and, for the selected
   * truck, the part already driven (faint). A truck heading back to its depot shows the way back.
   */
  function routesGeo() {
    const features = [];
    const line = (props, coords) => { if (coords.length > 1) features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } }); };
    tankers.filter((t) => ['In transit', 'Halted', 'Returning'].includes(t.status)).forEach((t) => {
      const sel = MV.selTanker === t.id;
      const at = DB.util.pointAt(t.route, t.progress), here = [at.lng, at.lat], pts = t.route.pts;
      const driven = pts.slice(0, at.seg + 1).concat([here]), ahead = [here].concat(pts.slice(at.seg + 1));
      const color = t.status === 'Halted' ? '#e5604f' : t.status === 'Returning' ? '#6e737a' : '#ffffff';
      if (t.status === 'Returning') line({ id: t.id, sel, color, kind: 'ahead' }, driven.slice().reverse());
      else {
        line({ id: t.id, sel, color, kind: 'ahead' }, ahead);
        if (sel) line({ id: t.id, sel, color: '#ffffff', kind: 'done' }, driven);
      }
      if (t.detour) line({ id: t.id, sel, color: '#e5604f', kind: 'detour' }, t.detour.pts);
    });
    return { type: 'FeatureCollection', features };
  }
  function corridorGeo() {
    const t = MV.selTanker && tankers.find((x) => x.id === MV.selTanker);
    return { type: 'FeatureCollection', features: t && t.status !== 'Loading' ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t.route.pts } }] : [] };
  }
  function columnsGeo() {
    return { type: 'FeatureCollection', features: outlets.map((o) => {
      const s = 0.0016, sx = s / Math.cos(o.lat * Math.PI / 180);
      const ring = [[o.lng - sx, o.lat - s], [o.lng + sx, o.lat - s], [o.lng + sx, o.lat + s], [o.lng - sx, o.lat + s], [o.lng - sx, o.lat - s]];
      return { type: 'Feature', properties: { h: o.daily * 260, color: STATUS_HEX[(o.m && o.m.status) || 'ok'] }, geometry: { type: 'Polygon', coordinates: [ring] } };
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
    const cor = MV.map.getSource('corridor');
    // Redraw only when the selection or that truck's route (a new trip) changes.
    const selT = MV.selTanker && tankers.find((x) => x.id === MV.selTanker);
    const corKey = selT ? selT.route : null;
    if (cor && cor._for !== corKey) { cor._for = corKey; cor.setData(corridorGeo()); }
    if (Sim.t % 5 === 0) { const c = MV.map.getSource('cols'); if (c) c.setData(columnsGeo()); }
  };

  MV.setLayer = function (name, on) {
    const map = MV.map, vis = on ? 'visible' : 'none';
    MV.layers[name] = on;
    const show = (set) => Object.values(set).forEach((r) => { r.el.style.display = on ? '' : 'none'; });
    if (name === 'outlets') show(MV.outletMk);
    if (name === 'tankers') show(MV.tankerMk);
    if (name === 'depots') show(MV.depotMk);
    if (name === 'routes') ['routes-line', 'routes-detour', 'corridor'].forEach((l) => map.setLayoutProperty(l, 'visibility', vis));
    if (name === 'roadnet' && map.getLayer('roadnet')) map.setLayoutProperty('roadnet', 'visibility', vis);
    if (name === 'area') ['area-mask', 'area-fill', 'area-casing', 'area-line'].forEach((l) => map.setLayoutProperty(l, 'visibility', vis));
    if (name === 'competitors') map.setLayoutProperty('comp-dot', 'visibility', vis);
    if (name === 'heat') map.setLayoutProperty('heat', 'visibility', vis);
    if (name === 'columns') {
      map.setLayoutProperty('cols', 'visibility', vis);
      if (on && map.getPitch() < 30) map.easeTo({ pitch: 55, bearing: -18, duration: 1200 });
    }
  };
  function applyBase(b) {
    if (!MV.ready || MV.base === b) return;
    MV.base = b;
    ['sat', 'roads', 'labels'].forEach((l) => MV.map.setLayoutProperty(l, 'visibility', b === 'sat' ? 'visible' : 'none'));
    ['dark', 'darkref'].forEach((l) => MV.map.setLayoutProperty(l, 'visibility', b === 'dark' ? 'visible' : 'none'));
    // Satellite imagery is busier, so shade the outside more strongly and brighten the edge
    MV.map.setPaintProperty('area-mask', 'fill-opacity', b === 'sat' ? 0.45 : 0.28);
    MV.map.setPaintProperty('area-line', 'line-opacity', b === 'sat' ? 0.9 : 0.55);
    MV.map.setPaintProperty('area-line', 'line-width', b === 'sat' ? 1.8 : 1.4);
    MV.onBasemap && MV.onBasemap(b);
  }
  // A basemap chosen by the user sticks; otherwise the map switches to satellite when zoomed into an outlet
  MV.setBasemap = function (b) { MV.userBase = b; applyBase(b); };
  MV.toggle3D = function () {
    const on = MV.map.getPitch() < 20;
    MV.map.easeTo({ pitch: on ? 60 : 0, bearing: on ? -20 : 0, duration: 1000 });
    return on;
  };
  MV.home = function (animate) {
    if (!MV.userBase) applyBase('dark');
    MV.map.fitBounds(bounds(), { padding: padding(), pitch: 0, bearing: 0, duration: animate === false ? 0 : 1800, essential: true });
  };
  MV.intro = function () {
    MV.map.fitBounds(bounds(), { padding: padding(), pitch: 0, bearing: 0, duration: 3800, curve: 1.5, essential: true });
  };
  MV.flyToOutlet = function (o) {
    MV.selected = o.id; MV.selTanker = null;
    MV.update();
    if (!MV.userBase) applyBase('sat');
    MV.map.flyTo({ center: [o.lng, o.lat], zoom: 16.4, pitch: 50, bearing: -20, duration: 2200, essential: true, padding: { left: 360, right: 440, top: 0, bottom: 0 } });
  };
  MV.flyToTanker = function (t) {
    MV.selTanker = t.id;
    MV.update();
    const p = Sim.tankerPos(t);
    MV.map.flyTo({ center: [p.lng, p.lat], zoom: 13, pitch: 0, bearing: 0, duration: 1800, essential: true, padding: { left: 360, right: 440, top: 0, bottom: 0 } });
  };
  MV.clearSelection = function () {
    const had = MV.selected;
    MV.selected = null; MV.selTanker = null; MV.update();
    if (had && !MV.userBase) applyBase('dark');
  };
  MV.resize = function () { MV.map && MV.map.resize(); };

  window.MapView = MV;
})();
