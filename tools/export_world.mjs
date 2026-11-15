#!/usr/bin/env node
/**
 * Export the dashboard's synthetic Gurugram "world" (poc/js/data.js) to JSON.
 *
 * The backend's dummy source-data generator reads this file so that the
 * OMC-style files it produces describe exactly the same 44 outlets, tanks and
 * storylines that the dashboard shows. data.js is seeded, so the export is
 * deterministic apart from dates, which are stored relative to `exported_at`.
 *
 * Usage:  node tools/export_world.mjs [output.json]
 * Default output: backend/src/prahari/samples/world.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || `${root}/backend/src/prahari/samples/world.json`);

// data.js is a browser script that assigns window.DB; give it a minimal window.
const sandbox = { window: {}, Math, Date, console };
vm.createContext(sandbox);
// The road network goes first: data.js snaps outlets and depots onto real roads with it.
for (const f of ['roadnet.js', 'roads.js', 'data.js']) {
  vm.runInContext(readFileSync(`${root}/poc/js/${f}`, 'utf8'), sandbox, { filename: f });
}
const DB = sandbox.window.DB;

const DAY = 86400000;
const now = DB.meta.generatedAt;
const daysFromNow = (ts) => Math.round(((ts - now) / DAY) * 100) / 100;

const world = {
  schema: 1,
  note: 'Synthetic data. Every outlet, dealer, number and plate is fictional.',
  exported_at: new Date(now).toISOString(),
  meta: DB.meta,
  products: Object.values(DB.PRODUCTS).map((p) => ({ key: p.key, name: p.name, price: p.price, density_range: p.dens })),
  depots: DB.depots.map((d) => ({ id: d.id, name: d.name, lng: d.lng, lat: d.lat, capacity_kl: d.capacityKL })),
  area: DB.area,
  stories: Object.fromEntries(Object.entries(DB.stories).map(([k, o]) => [k, o.id])),
  outlets: DB.outlets.map((o) => ({
    code: o.id,
    name: o.name,
    category: o.category,
    market_class: o.marketClass,
    type: o.type,
    ksk: o.ksk,
    locality: o.locality,
    road: o.road,
    address: o.address,
    lng: o.lng,
    lat: o.lat,
    automated: o.automated,
    automation_online: o.raOnline,
    dealer: { name: o.dealer.name, since: o.dealer.since },
    daily_kl: o.prod, // average kL/day by product
    target_month_kl: o.targetMonth,
    tanks: o.tanks.map((t) => ({ tank_no: +t.id.slice(1), product: t.product, capacity_kl: t.cap, stock_kl: t.stock, water_mm: t.water, temp_c: t.temp })),
    nozzles: o.nozzles.map((n) => ({ nozzle_no: +n.id.slice(1), du_no: +n.du.slice(3), product: n.product, totalizer_l: n.totalizer, status: n.status })),
    history: o.hist, // last 30 days, kL by product
    variation_pct: o.variation,
    density_dev: o.densityDev,
    pending_indent: o.pendingIndent || null,
    licences: Object.fromEntries(['peso', 'stamp', 'fire', 'pcc'].map((k) => [k, { due_in_days: daysFromNow(o.compliance[k].due) }])),
    receipts: o.indents.map((i) => ({ days_ago: -daysFromNow(i.date), product: i.product, qty_kl: i.qty, density_diff: i.obsDiff, shortage_l: i.shortL })),
  })),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(world, null, 1) + '\n');
console.log(`Wrote ${world.outlets.length} outlets to ${out}`);
