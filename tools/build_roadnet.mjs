#!/usr/bin/env node
/**
 * Build the dashboard's road network (poc/js/roadnet.js) from OpenStreetMap.
 *
 * Tank trucks can only drive on roads, so the dashboard routes them over a real road graph
 * instead of drawing straight lines. This script turns an Overpass API export of the sales
 * area's truck-usable roads (motorway … tertiary; no residential streets, which is also roughly
 * where a 20 kL tanker may legally go) into a compact graph:
 *
 *   - ways are split at junctions into edges; one-way rules are kept (dual carriageways matter);
 *   - only the largest strongly connected part is kept, so every node can reach every other;
 *   - edge geometry is simplified (≈5 m) and stored as delta-encoded integers (1e-5°, ≈1 m).
 *
 * The output is a plain script (window.ROADNET = …) rather than JSON so the dashboard still
 * works when opened straight from disk (file://), where fetch() of local files is blocked.
 *
 * Road data © OpenStreetMap contributors, available under the Open Database License (ODbL).
 *
 * Usage:
 *   node tools/build_roadnet.mjs                       # download from Overpass, then build
 *   node tools/build_roadnet.mjs overpass-export.json  # build from a saved export
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = `${root}/poc/js/roadnet.js`;
const BBOX = [28.04, 76.54, 28.62, 77.32]; // south, west, north, east: the sales area with margin
const CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']; // index = class id
const QUERY = `[out:json][timeout:180];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary)$"](${BBOX.join(',')});
out geom tags;`;
const Q = 1e5; // coordinate quantisation: 1e-5 degree ≈ 1.1 m
const SIMPLIFY_M = 5;

async function load(path) {
  if (path) return JSON.parse(readFileSync(path, 'utf8'));
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'prahari-poc-roadbuild/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(QUERY),
  });
  if (!res.ok) throw new Error(`Overpass answered ${res.status}; it is often busy, try again in a minute`);
  return res.json();
}

/** Metres between two [lng, lat] points (equirectangular; fine at city scale). */
function metres(a, b) {
  const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320;
}

/** Douglas–Peucker on [lng, lat] points, tolerance in metres. Keeps both ends. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = pts[i], b = pts[j], ab = metres(a, b);
    let worst = -1, wd = 0;
    for (let k = i + 1; k < j; k++) {
      // distance from pts[k] to the chord a–b, via the triangle's area
      const ak = metres(a, pts[k]), bk = metres(b, pts[k]);
      const s = (ab + ak + bk) / 2;
      const d = ab < 1e-6 ? ak : (2 * Math.sqrt(Math.max(0, s * (s - ab) * (s - ak) * (s - bk)))) / ab;
      if (d > wd) { wd = d; worst = k; }
    }
    if (wd > tol) { keep[worst] = 1; stack.push([i, worst], [worst, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

function build(osm) {
  const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry && e.geometry.length > 1);
  const key = (p) => `${Math.round(p.lon * 1e7)},${Math.round(p.lat * 1e7)}`;

  // A point shared by two ways, or the end of a way, is a junction (graph node).
  const uses = new Map();
  for (const w of ways) w.geometry.forEach((p, i) => {
    const k = key(p);
    uses.set(k, (uses.get(k) || 0) + (i === 0 || i === w.geometry.length - 1 ? 2 : 1));
  });

  const nodeId = new Map(), nodes = [];
  const node = (p) => {
    const k = key(p);
    if (!nodeId.has(k)) { nodeId.set(k, nodes.length); nodes.push([p.lon, p.lat]); }
    return nodeId.get(k);
  };
  const names = [], nameId = new Map();
  const name = (s) => {
    if (!s) return -1;
    if (!nameId.has(s)) { nameId.set(s, names.length); names.push(s); }
    return nameId.get(s);
  };

  const edges = [];
  for (const w of ways) {
    const t = w.tags || {};
    const hw = t.highway.replace('_link', '');
    const cls = CLASSES.indexOf(hw);
    // One-way: explicit tag, or implied for motorways and roundabouts.
    let dir = 0;
    if (['yes', 'true', '1'].includes(t.oneway)) dir = 1;
    else if (t.oneway === '-1') dir = -1;
    else if (t.oneway !== 'no' && (hw === 'motorway' || t.junction === 'roundabout')) dir = 1;
    // "NH-48 (Delhi–Jaipur Highway)" reads better than a bare name or ref alone.
    const label = t.ref && t.name ? `${t.name} (${t.ref.split(';')[0]})` : (t.name || t.ref || '');
    const g = dir === -1 ? w.geometry.slice().reverse() : w.geometry;
    let start = 0;
    for (let i = 1; i < g.length; i++) {
      if (i === g.length - 1 || uses.get(key(g[i])) > 1) {
        const pts = g.slice(start, i + 1).map((p) => [p.lon, p.lat]);
        edges.push({ a: node(g[start]), b: node(g[i]), cls, name: name(label), oneway: dir !== 0, pts });
        start = i;
      }
    }
  }

  // Keep the largest strongly connected component (iterative Tarjan).
  const out = nodes.map(() => []);
  edges.forEach((e) => { out[e.a].push(e.b); if (!e.oneway) out[e.b].push(e.a); });
  const index = new Int32Array(nodes.length).fill(-1), low = new Int32Array(nodes.length), onStack = new Uint8Array(nodes.length);
  const comp = new Int32Array(nodes.length).fill(-1), stack = [];
  let counter = 0, compCount = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (index[s] !== -1) continue;
    const work = [[s, 0]];
    index[s] = low[s] = counter++; stack.push(s); onStack[s] = 1;
    while (work.length) {
      const top = work[work.length - 1], v = top[0];
      if (top[1] < out[v].length) {
        const w = out[v][top[1]++];
        if (index[w] === -1) { index[w] = low[w] = counter++; stack.push(w); onStack[w] = 1; work.push([w, 0]); }
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
        if (low[v] === index[v]) {
          let w;
          do { w = stack.pop(); onStack[w] = 0; comp[w] = compCount; } while (w !== v);
          compCount++;
        }
      }
    }
  }
  const sizes = new Int32Array(compCount);
  comp.forEach((c) => sizes[c]++);
  const main = sizes.indexOf(Math.max(...sizes));

  // Re-number the kept nodes and encode.
  const keepId = new Int32Array(nodes.length).fill(-1), outNodes = [];
  nodes.forEach((p, i) => {
    if (comp[i] !== main) return;
    keepId[i] = outNodes.length / 2;
    outNodes.push(Math.round(p[0] * Q), Math.round(p[1] * Q));
  });
  const outEdges = [];
  for (const e of edges) {
    if (comp[e.a] !== main || comp[e.b] !== main) continue;
    const pts = simplify(e.pts, SIMPLIFY_M);
    // Interior points only (the ends are the nodes), as deltas from the previous point.
    const geom = [];
    let px = Math.round(pts[0][0] * Q), py = Math.round(pts[0][1] * Q);
    for (let i = 1; i < pts.length - 1; i++) {
      const x = Math.round(pts[i][0] * Q), y = Math.round(pts[i][1] * Q);
      geom.push(x - px, y - py); px = x; py = y;
    }
    outEdges.push([keepId[e.a], keepId[e.b], e.cls, e.name, e.oneway ? 1 : 0, ...geom]);
  }
  return {
    attribution: '© OpenStreetMap contributors (ODbL)',
    osm_base: (osm.osm3s && osm.osm3s.timestamp_osm_base) || null,
    scale: Q,
    classes: CLASSES,
    names,
    nodes: outNodes,
    edges: outEdges,
    stats: { ways: ways.length, components: compCount, keptNodes: outNodes.length / 2, totalNodes: nodes.length },
  };
}

const net = build(await load(process.argv[2]));
const header = `/* Road network of the Gurugram sales area, generated by tools/build_roadnet.mjs. Do not edit.
   Road data © OpenStreetMap contributors, available under the Open Database License (ODbL):
   https://www.openstreetmap.org/copyright  (OSM snapshot ${net.osm_base}) */\n`;
writeFileSync(OUT, header + 'window.ROADNET = ' + JSON.stringify(net) + ';\n');
console.log(`Wrote ${net.edges.length} edges, ${net.stats.keptNodes} of ${net.stats.totalNodes} nodes (${net.stats.components} components) to ${OUT}`);
