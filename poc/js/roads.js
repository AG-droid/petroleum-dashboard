/* =====================================================================
   PRAHARI POC: road routing
   Finds the way a tank truck would actually drive between two points
   over the real road network (window.ROADNET, built from OpenStreetMap
   by tools/build_roadnet.mjs). Shortest *time* path (A*) with truck
   speeds by road class, honouring one-way roads.
   If the network is missing, RoadNet.ok is false and callers fall back
   to their old straight-line routes.
   ===================================================================== */
(function () {
  'use strict';

  const NET = window.ROADNET;
  const RoadNet = { ok: false };
  window.RoadNet = RoadNet;
  if (!NET || !NET.nodes || !NET.edges) return;

  // Typical loaded-tanker speeds (km/h) by road class, including city traffic.
  const SPEED_KMH = [45, 38, 30, 24, 20]; // motorway, trunk, primary, secondary, tertiary
  const MAX_MS = SPEED_KMH[0] / 3.6;
  const CELL = 0.005; // spatial index cell, degrees (≈500 m)

  function metres(a, b) {
    const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
    return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320;
  }

  // ---------- Decode ----------
  const S = NET.scale;
  const nodes = [];
  for (let i = 0; i < NET.nodes.length; i += 2) nodes.push([NET.nodes[i] / S, NET.nodes[i + 1] / S]);
  const edges = NET.edges.map((e) => {
    const pts = [nodes[e[0]]];
    let x = NET.nodes[e[0] * 2], y = NET.nodes[e[0] * 2 + 1];
    for (let i = 5; i < e.length; i += 2) { x += e[i]; y += e[i + 1]; pts.push([x / S, y / S]); }
    pts.push(nodes[e[1]]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]));
    const len = cum[cum.length - 1];
    return { a: e[0], b: e[1], cls: e[2], name: e[3] >= 0 ? NET.names[e[3]] : '', oneway: e[4] === 1, pts, cum, len, sec: len / (SPEED_KMH[e[2]] / 3.6) };
  });

  // Adjacency: for each node, the edges leaving it (and which way they are driven).
  const adj = nodes.map(() => []);
  edges.forEach((e, i) => {
    adj[e.a].push({ to: e.b, edge: i, fwd: true, sec: e.sec });
    if (!e.oneway) adj[e.b].push({ to: e.a, edge: i, fwd: false, sec: e.sec });
  });

  // Spatial index of segments, for snapping a point to the nearest road.
  const grid = new Map();
  const cellKey = (x, y) => x * 100000 + y;
  edges.forEach((e, ei) => {
    for (let s = 0; s < e.pts.length - 1; s++) {
      const a = e.pts[s], b = e.pts[s + 1];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const y0 = Math.floor(Math.min(a[1], b[1]) / CELL), y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = cellKey(x, y);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(ei, s);
      }
    }
  });

  /**
   * Nearest point on the road network to [lng, lat].
   * opts.classes: allowed road classes (0 motorway … 4 tertiary); default all.
   * opts.name: a RegExp the road's name must match (e.g. /NH48/), to pick a specific road.
   * Returns { pt, edge, seg, along (metres from the edge's start), dist (metres) } or null.
   */
  function snap(ll, opts) {
    return candidates(ll, opts, 0)[0] || null;
  }
  /**
   * Every road within `slack` metres of the nearest one (one hit per edge), nearest first.
   * Routing starts from all of them, so a point between the two carriageways of a divided highway
   * can join whichever direction is going the right way instead of driving to a U-turn.
   */
  function candidates(ll, opts, slack) {
    const allowed = opts && opts.classes, named = opts && opts.name;
    const hits = new Map();
    const cx = Math.floor(ll[0] / CELL), cy = Math.floor(ll[1] / CELL);
    const k = Math.cos(ll[1] * Math.PI / 180);
    let best = null; // distance (m) to the nearest hit so far
    const maxRing = named ? 40 : 12; // a named road may be a few km from a rough anchor point
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let x = cx - ring; x <= cx + ring; x++) for (let y = cy - ring; y <= cy + ring; y++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) continue; // only the new ring
        const list = grid.get(cellKey(x, y));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 2) {
          const e = edges[list[i]], s = list[i + 1];
          if ((allowed && !allowed.includes(e.cls)) || (named && !named.test(e.name))) continue;
          const a = e.pts[s], b = e.pts[s + 1];
          const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
          const L2 = dx * dx + dy * dy;
          const f = L2 ? Math.max(0, Math.min(1, (((ll[0] - a[0]) * k) * dx + (ll[1] - a[1]) * dy) / L2)) : 0;
          const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
          const d = metres(ll, p);
          const prev = hits.get(list[i]);
          if (!prev || d < prev.dist) hits.set(list[i], { pt: p, edge: list[i], seg: s, along: e.cum[s] + f * (e.cum[s + 1] - e.cum[s]), dist: d });
          if (!best || d < best) best = d;
        }
      }
      // Hits are only certain once every cell closer than (nearest + slack) has been checked.
      if (best != null && best + slack < ring * CELL * 111320 * k) break;
    }
    if (best == null) return [];
    return [...hits.values()].filter((h) => h.dist <= best + slack).sort((a, b) => a.dist - b.dist).slice(0, 6);
  }

  /** Points of edge e between two distances along it, in the direction from `from` to `to`. */
  function slice(e, from, to) {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const out = [pointAlong(e, lo)];
    for (let i = 1; i < e.pts.length - 1; i++) if (e.cum[i] > lo && e.cum[i] < hi) out.push(e.pts[i]);
    out.push(pointAlong(e, hi));
    return from <= to ? out : out.reverse();
  }
  function pointAlong(e, d) {
    for (let i = 1; i < e.pts.length; i++) {
      if (d <= e.cum[i] || i === e.pts.length - 1) {
        const seg = e.cum[i] - e.cum[i - 1] || 1;
        const f = Math.max(0, Math.min(1, (d - e.cum[i - 1]) / seg));
        const a = e.pts[i - 1], b = e.pts[i];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      }
    }
    return e.pts[0];
  }

  // ---------- A* (binary heap) ----------
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
  };
  Heap.prototype.pop = function () {
    const k = this.k, v = this.v, top = v[0], last = k.length - 1;
    k[0] = k[last]; v[0] = v[last]; k.pop(); v.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < k.length && k[l] < k[m]) m = l;
      if (r < k.length && k[r] < k[m]) m = r;
      if (m === i) break;
      [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
    }
    return top;
  };

  /**
   * Fastest route between two snapped points. Returns { pts, km, min, via } or null.
   * `via` lists the main named roads used, longest stretch first.
   */
  function routeSnapped(As, Bs) {
    const secOf = (e, m) => m / (SPEED_KMH[e.cls] / 3.6);
    const target = Bs[0].pt;
    const n = nodes.length;
    const g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), prevStep = new Array(n);
    const h = (i) => metres(nodes[i], target) / MAX_MS;
    const heap = new Heap();
    // Getting from the point to a road candidate costs a little, so the nearest road wins ties.
    const access = (c) => c.dist / 3;
    let best = Infinity, bestEnd = null, direct = null;
    // Same road segment, in a drivable direction: no search needed.
    As.forEach((A) => Bs.forEach((B) => {
      const e = edges[A.edge];
      if (A.edge !== B.edge || (A.along > B.along && e.oneway)) return;
      const c = access(A) + access(B) + secOf(e, Math.abs(B.along - A.along));
      if (c < best) { best = c; direct = { e, from: A.along, to: B.along }; }
    }));
    // Leave each start edge forwards (to its end node) or, if two-way, backwards (to its start node).
    const starts = [];
    As.forEach((A) => {
      const e = edges[A.edge];
      starts.push({ node: e.b, sec: access(A) + secOf(e, e.len - A.along), e, from: A.along, to: e.len });
      if (!e.oneway) starts.push({ node: e.a, sec: access(A) + secOf(e, A.along), e, from: A.along, to: 0 });
    });
    starts.forEach((s) => { if (s.sec < g[s.node]) { g[s.node] = s.sec; prev[s.node] = -2; prevStep[s.node] = s; heap.push(s.sec + h(s.node), s.node); } });
    // Arrive on each target edge from its start node or, if two-way, from its end node.
    const ends = [];
    Bs.forEach((B) => {
      const e = edges[B.edge];
      ends.push({ node: e.a, sec: access(B) + secOf(e, B.along), e, from: 0, to: B.along });
      if (!e.oneway) ends.push({ node: e.b, sec: access(B) + secOf(e, e.len - B.along), e, from: e.len, to: B.along });
    });
    const done = new Uint8Array(n);
    while (heap.k.length) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (g[u] + h(u) >= best) break;
      ends.forEach((t) => { if (t.node === u && g[u] + t.sec < best) { best = g[u] + t.sec; bestEnd = t; } });
      for (const s of adj[u]) {
        const c = g[u] + s.sec;
        if (c < g[s.to]) { g[s.to] = c; prev[s.to] = u; prevStep[s.to] = s; heap.push(c + h(s.to), s.to); }
      }
    }
    if (!bestEnd) return direct ? finish([direct]) : null;
    const legs = [{ e: bestEnd.e, from: bestEnd.from, to: bestEnd.to }];
    let u = bestEnd.node;
    while (prev[u] !== -2) {
      const s = prevStep[u], e = edges[s.edge];
      legs.push({ e, from: s.fwd ? 0 : e.len, to: s.fwd ? e.len : 0 });
      u = prev[u];
    }
    const s0 = prevStep[u];
    legs.push({ e: s0.e, from: s0.from, to: s0.to });
    return finish(legs.reverse());
  }

  function finish(legs) {
    const pts = [];
    const byName = new Map();
    let m = 0, sec = 0;
    legs.forEach((l) => {
      const part = slice(l.e, l.from, l.to);
      if (pts.length) part.shift();
      pts.push(...part);
      const d = Math.abs(l.to - l.from);
      m += d; sec += d / (SPEED_KMH[l.e.cls] / 3.6);
      if (l.e.name && l.e.cls <= 3) byName.set(l.e.name, (byName.get(l.e.name) || 0) + d);
    });
    const via = [...byName.entries()].filter(([, d]) => d > 800).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return { pts, km: m / 1000, min: sec / 60, via };
  }

  const SLACK_M = 60; // wide enough to catch both carriageways of a divided highway
  const snapCache = new Map();
  function snapCached(ll) {
    const key = ll[0].toFixed(6) + ',' + ll[1].toFixed(6);
    if (!snapCache.has(key)) snapCache.set(key, candidates(ll, null, SLACK_M));
    return snapCache.get(key);
  }

  /** Fastest drivable route between two [lng, lat] points (each joined to the nearby roads). */
  function route(from, to) {
    const A = snapCached(from), B = snapCached(to);
    return A.length && B.length ? routeSnapped(A, B) : null;
  }

  /**
   * One route through several points in order, used to trace a highway between its towns.
   * With opts.name (a RegExp), each point is first moved onto that road, so the trace follows
   * the road itself rather than detouring through side streets to reach a rough point.
   */
  function through(list, opts) {
    let out = null;
    const at = list.map((ll) => {
      const c = opts && opts.name ? candidates(ll, opts, 0)[0] : null;
      return c ? c.pt : ll;
    });
    for (let i = 1; i < at.length; i++) {
      const r = route(at[i - 1], at[i]);
      if (!r) return null;
      if (!out) out = { pts: r.pts.slice(), km: r.km, min: r.min };
      else { out.pts.push(...r.pts.slice(1)); out.km += r.km; out.min += r.min; }
    }
    return out;
  }

  /**
   * A side road leading away from a route: where a truck that leaves its planned path would go.
   * Starts at `at` (a point on the route) and ends at a junction roughly `km` away, chosen
   * deterministically (the candidate furthest from the planned route).
   */
  function detour(routePts, at, km) {
    const target = km * 1000;
    const minRouteDist = (p) => {
      let d = Infinity;
      for (let i = 0; i < routePts.length; i += 3) d = Math.min(d, metres(p, routePts[i]));
      return d;
    };
    let best = null, bestScore = -Infinity;
    nodes.forEach((p, i) => {
      const d = metres(p, at);
      if (d < target * 0.6 || d > target * 1.4) return;
      const off = minRouteDist(p);
      const score = off - Math.abs(d - target) * 0.5;
      if (off > target * 0.5 && score > bestScore) { bestScore = score; best = i; }
    });
    if (best == null) return null;
    const r = route(at, nodes[best]);
    return r && { pts: r.pts, km: r.km, offKm: minRouteDist(nodes[best]) / 1000 };
  }

  Object.assign(RoadNet, {
    ok: true,
    attribution: NET.attribution,
    classes: NET.classes,
    snap: (ll, opts) => { const s = snap(ll, opts); return s && { lng: s.pt[0], lat: s.pt[1], dist: s.dist, road: edges[s.edge].name, cls: edges[s.edge].cls }; },
    route,
    through,
    detour,
    /** GeoJSON of the network, for a map layer of truck roads. */
    geojson() {
      return { type: 'FeatureCollection', features: edges.map((e) => ({ type: 'Feature', properties: { cls: e.cls, name: e.name }, geometry: { type: 'LineString', coordinates: e.pts } })) };
    },
  });
})();
