/* =====================================================================
   PRAHARI for dealers — the map (MapLibre GL; neutral map + satellite)
   Same look and behaviour as the Sales Officer map, centred on the dealer: their outlets,
   the supply points that serve them, their own tank trucks on real roads, a 3 km catchment
   and the competitor outlets around them.
   ===================================================================== */
(function () {
  'use strict';
  const W = window.DW;
  const { depots, competitors, area, PRODUCTS } = DB;
  const MV = { map: null, outletMk: {}, truckMk: {}, depotMk: {}, layers: {}, selected: null, selTruck: null, ready: false, base: 'dark', userBase: null, onBasemap: null };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TRUCK_SVG = '<svg viewBox="0 0 24 24"><path d="M1 6h13v9H1zM14 9h4.5l3.5 3.5V15h-8zM5.5 19a2 2 0 100-4 2 2 0 000 4zM17.5 19a2 2 0 100-4 2 2 0 000 4z"/></svg>';
  const ACTIVE = ['loading', 'in_transit', 'unloading'];
  const myDepots = () => depots.filter((d) => W.ros.some((r) => r.depotId === d.id));
  const trucks = () => W.orders.filter((o) => ACTIVE.includes(o.status) && DUI.inScope(o.roId));

  function bounds() {
    const b = new maplibregl.LngLatBounds();
    DUI.scopeRos().forEach((r) => b.extend([r.lng, r.lat]));
    DUI.scopeRos().forEach((r) => { const d = DB.depotById(r.depotId); b.extend([d.lng, d.lat]); });
    return b;
  }
  /** Space taken by the panels, so the map frames what is still visible (phones stack them). */
  function flyPad() {
    if (innerWidth <= 760) return { left: 20, right: 20, top: 40, bottom: document.getElementById('leftPanel').classList.contains('hidden') ? 40 : document.getElementById('leftPanel').offsetHeight + 20 };
    return { left: 360, right: 440, top: 0, bottom: 0 };
  }
  function padding() {
    if (innerWidth <= 760) { const p = flyPad(); return { top: 60, left: 30, right: 30, bottom: p.bottom + 20 }; }
    const st = document.getElementById('stage');
    const leftOpen = !document.getElementById('leftPanel').classList.contains('hidden');
    const w = (id) => document.getElementById(id).offsetWidth || 0;
    return { top: 90, bottom: 120, left: leftOpen ? w('leftPanel') + 70 : 80, right: st.classList.contains('right-open') ? w('rightPanel') + 70 : 80 };
  }
  /** Where an order's truck is now: at the supply point, on the road, or at the outlet. */
  function truckPos(o) {
    const ro = W.byId(o.roId), d = DB.depotById(o.depotId);
    if (o.status === 'loading' || o.status === 'placed') return { lng: d.lng, lat: d.lat, seg: 0, bearing: 0 };
    if (o.status === 'in_transit') return DB.util.pointAt(ro.route, DUI.progress(o));
    return { lng: ro.lng, lat: ro.lat, seg: ro.route.pts.length - 1, bearing: 0 };
  }
  MV.truckPos = truckPos;

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
      const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
      map.addSource('area-mask', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [world, area.slice().reverse()] } } });
      map.addLayer({ id: 'area-mask', type: 'fill', source: 'area-mask', paint: { 'fill-color': '#000000', 'fill-opacity': 0.28 } });
      map.addLayer({ id: 'area-casing', type: 'line', source: 'area', layout: { 'line-join': 'round' }, paint: { 'line-color': '#000000', 'line-width': 4, 'line-opacity': 0.45, 'line-blur': 1 } });
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', layout: { 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 1.4, 'line-dasharray': [4, 3], 'line-opacity': 0.55 } });
      // A 3 km circle around each outlet: the dealer's own trading area.
      map.addSource('catch', { type: 'geojson', data: catchmentGeo() });
      map.addLayer({ id: 'catch-fill', type: 'fill', source: 'catch', layout: { visibility: 'none' }, paint: { 'fill-color': '#7aa7ff', 'fill-opacity': 0.06 } });
      map.addLayer({ id: 'catch-line', type: 'line', source: 'catch', layout: { visibility: 'none' }, paint: { 'line-color': '#7aa7ff', 'line-opacity': 0.5, 'line-width': 1.2, 'line-dasharray': [2, 2] } });
      map.addSource('corridor', { type: 'geojson', data: corridorGeo() });
      map.addLayer({ id: 'corridor', type: 'line', source: 'corridor', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {
        'line-color': '#7aa7ff', 'line-opacity': 0.13, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, metresToPx(500, 8), 18, metresToPx(500, 18)] } });
      map.addSource('routes', { type: 'geojson', data: routesGeo(), attribution: window.RoadNet && RoadNet.ok ? 'Routes © OpenStreetMap contributors (ODbL)' : undefined });
      map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {
        'line-color': '#ffffff', 'line-width': ['case', ['get', 'sel'], 2.8, 1.8],
        'line-opacity': ['case', ['==', ['get', 'kind'], 'done'], 0.28, ['get', 'sel'], 0.95, 0.65], 'line-dasharray': [2, 2] } });
      map.addSource('comp', { type: 'geojson', data: { type: 'FeatureCollection', features: competitors.map((c) => ({ type: 'Feature', properties: { brand: c.brand, est: c.estDaily, isNew: !!c.isNew }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })) } });
      map.addLayer({ id: 'comp-dot', type: 'circle', source: 'comp', layout: { visibility: 'none' }, paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 6], 'circle-color': ['match', ['get', 'brand'], 'Brand B', '#b48ead', 'Brand C', '#d08770', '#8f959c'],
        'circle-stroke-color': ['case', ['get', 'isNew'], '#ffffff', '#0c0d0f'], 'circle-stroke-width': ['case', ['get', 'isNew'], 2, 1] } });
      map.on('mousemove', 'comp-dot', (e) => {
        const p = e.features[0].properties;
        DUI.tooltip(e.originalEvent, `<b>${esc(p.brand)} outlet</b><div class="tt-row"><span>Competitor</span><span></span></div><div class="tt-row"><span>Estimated sales</span><span>${(+p.est).toFixed(1)} kL/day</span></div>`);
      });
      map.on('mouseleave', 'comp-dot', () => DUI.tooltip(null));
      addMarkers();
      MV.ready = true;
      Object.entries(MV.layers).forEach(([k, v]) => MV.setLayer(k, v));
      onReady && onReady();
    };
    let tileErrors = 0, tileOk = false;
    const notice = (msg) => { const n = document.getElementById('mapNotice'); if (!n) return; n.textContent = msg || ''; n.classList.toggle('hidden', !msg); };
    const BASE = ['dark', 'darkref', 'sat', 'roads', 'labels'];
    map.on('error', (e) => {
      if (!e || !BASE.includes(e.sourceId)) return;
      if (++tileErrors >= 6 && !tileOk) notice('Map images could not load, probably no internet connection. Your outlets, trucks and all the data still work.');
    });
    map.on('sourcedata', (e) => { if (e.tile && BASE.includes(e.sourceId)) { tileOk = true; tileErrors = 0; notice(''); } });
    map.on('style.load', setup);
    map.on('styledata', setup);
    map.on('load', setup);
  };

  function wrap(el) { const w = document.createElement('div'); w.appendChild(el); return w; }
  function addMarkers() {
    W.ros.forEach((ro) => {
      const el = document.createElement('div');
      el.className = 'mk mk-outlet mine ok';
      el.innerHTML = `<div class="mk-label">${esc(ro.name)}</div>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); DUI.selectOutlet(ro.id); });
      el.addEventListener('mousemove', (e) => DUI.tooltip(e, outletTip(ro)));
      el.addEventListener('mouseleave', () => DUI.tooltip(null));
      MV.outletMk[ro.id] = { el, mk: new maplibregl.Marker({ element: wrap(el) }).setLngLat([ro.lng, ro.lat]).addTo(MV.map) };
    });
    myDepots().forEach((d) => {
      const el = document.createElement('div');
      el.className = 'mk mk-depot';
      el.innerHTML = `<div class="mk-label">${esc(d.name)}</div>`;
      el.addEventListener('mousemove', (e) => DUI.tooltip(e, `<b>${esc(d.name)}</b><div class="tt-row"><span>Your supply point for</span><span>${W.ros.filter((r) => r.depotId === d.id).map((r) => esc(r.id)).join(', ')}</span></div><div class="tt-row"><span>Loading hours</span><span>${String(DCFG.depotOpenHour).padStart(2, '0')}:00–${DCFG.depotCloseHour}:00</span></div><div class="tt-row"><span>Order cut-off</span><span>${DCFG.indentCutoffHour}:00</span></div>`));
      el.addEventListener('mouseleave', () => DUI.tooltip(null));
      MV.depotMk[d.id] = { el, mk: new maplibregl.Marker({ element: wrap(el) }).setLngLat([d.lng, d.lat]).addTo(MV.map) };
    });
  }
  function addTruck(o) {
    const el = document.createElement('div');
    el.className = 'mk mk-tanker';
    el.innerHTML = TRUCK_SVG;
    el.addEventListener('click', (e) => { e.stopPropagation(); DUI.selectTruck(o.id); });
    el.addEventListener('mousemove', (e) => DUI.tooltip(e, truckTip(o)));
    el.addEventListener('mouseleave', () => DUI.tooltip(null));
    const p = truckPos(o);
    MV.truckMk[o.id] = { el, mk: new maplibregl.Marker({ element: wrap(el) }).setLngLat([p.lng, p.lat]).addTo(MV.map) };
    if (MV.layers.tankers === false) el.style.display = 'none';
  }
  function outletTip(ro) {
    const m = Eng.metrics(ro), st = DUI.outletStatus(ro);
    const low = Object.values(m.byP).sort((a, b) => a.coverDays - b.coverDays)[0];
    return `<b>${esc(ro.name)}</b>
      <div class="tt-row"><span>RO ${esc(ro.id)} · ${esc(ro.marketClass)}</span><span style="color:${DUI.ST_HEX[st.worst]}">${st.text}</span></div>
      <div class="tt-row"><span>Sold today</span><span>${(m.todayL / 1000).toFixed(1)} kL</span></div>
      <div class="tt-row"><span>Lowest usable stock</span><span>${DUI.fmt.days(low.coverDays)} ${esc(PRODUCTS[low.p].name.toLowerCase())}</span></div>
      <div class="tt-row"><span>To do</span><span>${st.recs.length}</span></div>`;
  }
  function truckTip(o) {
    return `<b>${esc(o.truck.plate)}</b>
      <div class="tt-row"><span>Order</span><span>${esc(o.id)}</span></div>
      <div class="tt-row"><span>Status</span><span>${esc(DUI.STATUS[o.status][0])}</span></div>
      <div class="tt-row"><span>Carrying</span><span>${esc(DUI.lineText(o.lines))}</span></div>
      <div class="tt-row"><span>Going to</span><span>${esc(DUI.rname(o.roId))}</span></div>
      ${o.status === 'in_transit' ? `<div class="tt-row"><span>Arrives</span><span>${esc(DUI.fmt.when(o.arriveTs))}</span></div>` : ''}`;
  }
  function addRoadNetLayer() {
    if (!(window.RoadNet && RoadNet.ok)) return;
    MV.map.addSource('roadnet', { type: 'geojson', data: RoadNet.geojson() });
    MV.map.addLayer({ id: 'roadnet', type: 'line', source: 'roadnet', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {
      'line-color': ['match', ['get', 'cls'], 0, '#7aa7ff', 1, '#7aa7ff', 2, '#9fb6d6', '#5d6773'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['match', ['get', 'cls'], 0, 1.6, 1, 1.6, 2, 1.1, 0.5], 14, ['match', ['get', 'cls'], 0, 4, 1, 4, 2, 3, 1.5]],
      'line-opacity': 0.55 } }, 'corridor');
  }
  function metresToPx(m, zoom) { return m / (156543.03 * Math.cos(28.4 * Math.PI / 180) / Math.pow(2, zoom)); }
  function catchmentGeo() {
    return { type: 'FeatureCollection', features: W.ros.map((ro) => {
      const ring = [];
      for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; ring.push([ro.lng + Math.cos(a) * 3 / (111.32 * Math.cos(ro.lat * Math.PI / 180)), ro.lat + Math.sin(a) * 3 / 110.57]); }
      return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
    }) };
  }
  /** Each truck's line splits at the truck: road ahead (dashed), and road driven for the selected one. */
  function routesGeo() {
    const features = [];
    const line = (props, coords) => { if (coords.length > 1) features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } }); };
    trucks().forEach((o) => {
      const ro = W.byId(o.roId), sel = MV.selTruck === o.id;
      const p = truckPos(o), here = [p.lng, p.lat], pts = ro.route.pts;
      if (o.status === 'loading') { line({ id: o.id, sel, kind: 'ahead' }, pts); return; }
      line({ id: o.id, sel, kind: 'ahead' }, [here].concat(pts.slice((p.seg || 0) + 1)));
      if (sel) line({ id: o.id, sel, kind: 'done' }, pts.slice(0, (p.seg || 0) + 1).concat([here]));
    });
    return { type: 'FeatureCollection', features };
  }
  function corridorGeo() {
    const o = MV.selTruck && W.orderById(MV.selTruck);
    return { type: 'FeatureCollection', features: o && o.status === 'in_transit' ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: W.byId(o.roId).route.pts } }] : [] };
  }

  MV.update = function () {
    if (!MV.ready) return;
    W.ros.forEach((ro) => {
      const r = MV.outletMk[ro.id];
      const cls = 'mk mk-outlet mine ' + DUI.outletStatus(ro).worst + (MV.selected === ro.id ? ' selected' : '');
      if (r.el.className !== cls) r.el.className = cls;
      r.el.parentNode.style.display = DUI.inScope(ro.id) && MV.layers.outlets !== false ? '' : 'none';
    });
    const want = new Set();
    trucks().forEach((o) => {
      want.add(o.id);
      if (!MV.truckMk[o.id]) addTruck(o);
      const r = MV.truckMk[o.id];
      const p = truckPos(o);
      r.mk.setLngLat([p.lng, p.lat]);
      const cls = 'mk mk-tanker' + (o.status !== 'in_transit' ? ' idle' : '') + (MV.selTruck === o.id ? ' sel' : '');
      if (r.el.className !== cls) r.el.className = cls;
    });
    Object.keys(MV.truckMk).forEach((id) => { if (!want.has(id)) { MV.truckMk[id].mk.remove(); delete MV.truckMk[id]; DUI.tooltip(null); } });
    const src = MV.map.getSource('routes');
    if (src) src.setData(routesGeo());
    const cor = MV.map.getSource('corridor');
    const key = MV.selTruck ? MV.selTruck + '|' + (W.orderById(MV.selTruck) || {}).status : null;
    if (cor && cor._for !== key) { cor._for = key; cor.setData(corridorGeo()); }
  };

  MV.setLayer = function (name, on) {
    const map = MV.map, vis = on ? 'visible' : 'none';
    MV.layers[name] = on;
    if (!MV.ready) return; // applied once the map has loaded
    const show = (set) => Object.values(set).forEach((r) => { r.el.style.display = on ? '' : 'none'; });
    if (name === 'outlets') { show(MV.outletMk); MV.update(); }
    if (name === 'tankers') show(MV.truckMk);
    if (name === 'depots') show(MV.depotMk);
    if (name === 'routes') ['routes-line', 'corridor'].forEach((l) => map.setLayoutProperty(l, 'visibility', vis));
    if (name === 'roadnet') {
      if (on && !map.getLayer('roadnet')) addRoadNetLayer();
      if (map.getLayer('roadnet')) map.setLayoutProperty('roadnet', 'visibility', vis);
    }
    if (name === 'area') ['area-mask', 'area-casing', 'area-line'].forEach((l) => map.setLayoutProperty(l, 'visibility', vis));
    if (name === 'competitors') map.setLayoutProperty('comp-dot', 'visibility', vis);
    if (name === 'catchment') ['catch-fill', 'catch-line'].forEach((l) => map.setLayoutProperty(l, 'visibility', vis));
  };
  function applyBase(b) {
    if (!MV.ready || MV.base === b) return;
    MV.base = b;
    ['sat', 'roads', 'labels'].forEach((l) => MV.map.setLayoutProperty(l, 'visibility', b === 'sat' ? 'visible' : 'none'));
    ['dark', 'darkref'].forEach((l) => MV.map.setLayoutProperty(l, 'visibility', b === 'dark' ? 'visible' : 'none'));
    MV.map.setPaintProperty('area-mask', 'fill-opacity', b === 'sat' ? 0.45 : 0.28);
    MV.map.setPaintProperty('area-line', 'line-opacity', b === 'sat' ? 0.9 : 0.55);
    MV.onBasemap && MV.onBasemap(b);
  }
  // A basemap chosen by the user sticks; otherwise the map switches to satellite when zoomed into an outlet.
  MV.setBasemap = function (b) { MV.userBase = b; applyBase(b); };
  MV.toggle3D = function () {
    const on = MV.map.getPitch() < 20;
    MV.map.easeTo({ pitch: on ? 60 : 0, bearing: on ? -20 : 0, duration: 1000 });
    return on;
  };
  MV.home = function (animate) {
    if (!MV.map) return;
    if (!MV.userBase) applyBase('dark');
    MV.map.fitBounds(bounds(), { padding: padding(), pitch: 0, bearing: 0, duration: animate === false ? 0 : 1800, essential: true, maxZoom: 12.5 });
  };
  MV.intro = function () {
    MV.map.fitBounds(bounds(), { padding: padding(), pitch: 0, bearing: 0, duration: 3800, curve: 1.5, essential: true, maxZoom: 12.5 });
  };
  MV.flyToOutlet = function (ro) {
    MV.selected = ro.id; MV.selTruck = null;
    MV.update();
    if (!MV.ready) return;
    if (!MV.userBase) applyBase('sat');
    MV.map.flyTo({ center: [ro.lng, ro.lat], zoom: 16.4, pitch: 50, bearing: -20, duration: 2200, essential: true, padding: flyPad() });
  };
  MV.flyToTruck = function (o) {
    MV.selTruck = o.id; MV.selected = null;
    MV.update();
    if (!MV.ready) return;
    if (!MV.userBase) applyBase('dark');
    const p = truckPos(o);
    MV.map.flyTo({ center: [p.lng, p.lat], zoom: 13, pitch: 0, bearing: 0, duration: 1800, essential: true, padding: flyPad() });
  };
  MV.clearSelection = function () {
    const had = MV.selected;
    MV.selected = null; MV.selTruck = null; MV.update();
    if (had && !MV.userBase) applyBase('dark');
  };
  MV.resize = function () { if (MV.map) MV.map.resize(); };

  window.MapD = MV;
})();
