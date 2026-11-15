#!/usr/bin/env node
/**
 * Checks for the dashboard's road routing (poc/js/roads.js over poc/js/roadnet.js).
 *
 * The dashboard has no JS test framework (no build step by design), so this is a plain Node script
 * that loads the browser scripts in a sandbox and asserts the properties the map relies on.
 * Run with `node tools/check_roads.mjs` (part of `make check`). Exits non-zero on failure.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const js = resolve(dirname(fileURLToPath(import.meta.url)), '../poc/js');
function load(files) {
  const sandbox = { window: {}, Math, Date, console };
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(readFileSync(`${js}/${f}`, 'utf8'), sandbox, { filename: f });
  return sandbox.window;
}

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed++;
}

const metres = (a, b) => Math.hypot((b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), b[1] - a[1]) * 111320;
const withRoads = load(['roadnet.js', 'roads.js', 'data.js']);
const { RoadNet, ROADNET, DB } = withRoads;
check('road network loads', RoadNet.ok);

// One-way roads: no route may drive a one-way edge backwards. Collect one-way vertex pairs (a→b).
// `allowed` holds every drivable step; two one-way edges can join the same junctions in opposite
// directions (parallel carriageways), so a step is wrong only if no edge allows it.
const S = ROADNET.scale, oneway = new Set(), allowed = new Set();
const key = (p, q) => `${p[0].toFixed(5)},${p[1].toFixed(5)}>${q[0].toFixed(5)},${q[1].toFixed(5)}`;
for (const e of ROADNET.edges) {
  const pts = [[ROADNET.nodes[e[0] * 2] / S, ROADNET.nodes[e[0] * 2 + 1] / S]];
  let x = ROADNET.nodes[e[0] * 2], y = ROADNET.nodes[e[0] * 2 + 1];
  for (let i = 5; i < e.length; i += 2) { x += e[i]; y += e[i + 1]; pts.push([x / S, y / S]); }
  pts.push([ROADNET.nodes[e[1] * 2] / S, ROADNET.nodes[e[1] * 2 + 1] / S]);
  for (let i = 1; i < pts.length; i++) {
    allowed.add(key(pts[i - 1], pts[i]));
    if (e[4]) oneway.add(key(pts[i - 1], pts[i]));
    else allowed.add(key(pts[i], pts[i - 1]));
  }
}
let wrongWay = 0, nulls = 0;
const rnd = DB.util.mulberry32(7);
for (let i = 0; i < 150; i++) {
  const a = [76.6 + rnd() * 0.6, 28.15 + rnd() * 0.4], b = [76.6 + rnd() * 0.6, 28.15 + rnd() * 0.4];
  const r = RoadNet.route(a, b);
  if (!r) { nulls++; continue; }
  for (let j = 1; j < r.pts.length; j++) {
    const back = key(r.pts[j], r.pts[j - 1]);
    if (oneway.has(back) && !allowed.has(key(r.pts[j - 1], r.pts[j]))) wrongWay++;
  }
}
check('routes never drive a one-way road backwards', wrongWay === 0, `${wrongWay} wrong-way steps`);
check('routes exist between points inside the area', nulls === 0, `${nulls} of 150 missing`);
check('a point far outside the network has no route', RoadNet.route([80, 20], [77.05, 28.45]) === null);

// The demo world: every truck has a road route, outlets sit on roads.
check('every truck has a road route', DB.tankers.every((t) => t.route.min > 0 && t.route.pts.length > 3));
const offRoad = DB.outlets.filter((o) => RoadNet.snap([o.lng, o.lat]).dist > 5);
check('outlets are on a road', offRoad.length === 0, offRoad.map((o) => o.id).join(', '));

// The off-route storyline: the detour leaves the planned route and ends about a kilometre away.
const halted = DB.tankers.find((t) => t.status === 'Halted');
const d = halted && halted.detour;
const toRoute = (p) => Math.min(...halted.route.pts.map((q) => metres(p, q)));
check('halted truck has a detour', !!d);
if (d) {
  check('detour starts where it leaves the planned route', toRoute(d.pts[1]) > 20, `${toRoute(d.pts[1]).toFixed(0)} m`);
  check('detour ends 0.5–2.5 km off route', d.offKm > 0.5 && d.offKm < 2.5, `${d.offKm.toFixed(2)} km`);
}

// Without the network the dashboard falls back to straight lines and keeps the same world.
const plain = load(['data.js']);
check('works without the road network', plain.DB.tankers.length === DB.tankers.length && !plain.RoadNet);
check('same outlets and storylines without it',
  JSON.stringify(plain.DB.outlets.map((o) => o.id + o.name)) === JSON.stringify(DB.outlets.map((o) => o.id + o.name))
  && JSON.stringify(Object.keys(plain.DB.stories).map((k) => plain.DB.stories[k].id)) === JSON.stringify(Object.keys(DB.stories).map((k) => DB.stories[k].id)));

if (failed) { console.error(`${failed} road check(s) failed`); process.exit(1); }
console.log('road checks passed');
