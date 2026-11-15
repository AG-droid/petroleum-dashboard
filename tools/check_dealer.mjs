#!/usr/bin/env node
/**
 * Checks for the dealer app's logic (poc/dealer/js: config, world, engine).
 *
 * Like check_roads.mjs, this loads the browser scripts in a Node sandbox (no build step, no test
 * framework) and asserts the behaviour the screens rely on: usable-stock forecasts, suggested
 * orders, payment validation, the order lifecycle, receipts and claims, and that the storyline
 * produces its recommendations. It runs the whole suite at several times of day (IST), because
 * forecasts and cut-offs depend on the hour. Exits non-zero on failure.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const poc = resolve(dirname(fileURLToPath(import.meta.url)), '../poc');
const FILES = ['js/roadnet.js', 'js/roads.js', 'js/data.js', 'dealer/js/config.js', 'dealer/js/world.js', 'dealer/js/engine.js'];
const SRC = FILES.map((f) => [f, readFileSync(`${poc}/${f}`, 'utf8')]);
const HOUR = 3600000, MIN = 60000;

/** Load the app with the clock frozen at a given IST hour today. */
function load(istHour) {
  const real = Date.now();
  const istMidnight = Math.floor((real + 330 * MIN) / 86400000) * 86400000 - 330 * MIN;
  const start = istMidnight + istHour * HOUR + 7 * MIN;
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [start + (Date.now() - real)])); }
    static now() { return start + (Date.now() - real); }
  }
  const sandbox = { window: {}, Math, Date: FakeDate, console, Intl, setInterval: () => 0 };
  vm.createContext(sandbox);
  for (const [f, s] of SRC) {
    vm.runInContext(s, sandbox, { filename: f });
    Object.assign(sandbox, sandbox.window); // later scripts see earlier globals, as in a browser
  }
  return sandbox.window;
}

let failed = 0, passed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; return; }
  console.log(`FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  failed++;
}

for (const hour of [1, 10, 19]) {
  const at = `@${String(hour).padStart(2, '0')}:07 IST`;
  const { DW, Eng, DCFG: C, DB } = load(hour);
  const [hw, city] = DW.ros;

  // ---------- World ----------
  check(`${at} two demo outlets with demo RO codes`, DW.ros.length === 2 && DW.ros.every((r) => /^9901\d\d$/.test(r.id)), DW.ros.map((r) => r.id).join(','));
  check(`${at} one dealer owns both outlets (same as the Sales Officer view)`, DB.stories.dryout.dealer === DB.stories.stamp.dealer && DW.dealer.name === DB.stories.stamp.dealer.name);
  check(`${at} stock book adds up at start`, DW.ros.every((ro) => ro.products.every((p) => Number.isFinite(ro.book.openL[p]) && ro.book.openL[p] > 0)));

  // ---------- Usable stock and forecasts ----------
  const m = Eng.metrics(hw);
  const d = m.byP.HSD;
  check(`${at} usable stock excludes dead stock`, Math.abs(d.usableL - (d.stockL - d.deadL)) < 1, `${d.usableL} vs ${d.stockL}-${d.deadL}`);
  const withDead = Eng.forecastDry(hw, 'HSD', d.stockL, []);
  check(`${at} counting dead stock would forecast a later run-dry`, d.dryTs && withDead > d.dryTs);
  check(`${at} more stock never runs dry sooner`, Eng.forecastDry(hw, 'HSD', d.usableL + 5000, []) > d.dryTs);
  check(`${at} a delivery postpones the run-dry`, (Eng.forecastDry(hw, 'HSD', d.usableL, [{ ts: Eng.now + HOUR, L: 20000 }]) || Infinity) > d.dryTs);
  check(`${at} cover days use the forecast, not today's partial sales`, Math.abs(d.coverDays - d.usableL / hw.avgDailyL.HSD) < 1e-9);
  check(`${at} no NaN in metrics`, DW.ros.every((ro) => Object.values(Eng.metrics(ro).byP).every((x) => [x.usableL, x.coverDays, x.ullageL].every(Number.isFinite))));

  // ---------- Supply plan ----------
  const p = Eng.plan(city, Eng.now);
  const loadH = Math.floor((((p.loadStartTs + 330 * MIN) % 86400000) + 86400000) % 86400000 / HOUR);
  check(`${at} loading happens inside the depot's hours`, loadH >= C.depotOpenHour && loadH < C.depotCloseHour, `loads at ${loadH}:00`);
  check(`${at} plan steps are in order`, p.releaseTs <= p.loadStartTs && p.loadStartTs < p.dispatchTs && p.dispatchTs < p.arriveTs && p.arriveTs < p.usableTs);

  // ---------- Suggested order ----------
  DW.ros.forEach((ro) => {
    const s = Eng.suggest(ro);
    if (!s) return;
    const tk = C.trucks.find((t) => t.kl === s.truckKL);
    const total = s.lines.reduce((a, l) => a + l.kl, 0);
    check(`${at} ${ro.id} suggestion fits the truck`, total <= tk.kl && total > 0, `${total}/${tk.kl}`);
    check(`${at} ${ro.id} suggestion fills whole compartments`, s.lines.every((l) => l.kl % tk.compartments[0] === 0));
    check(`${at} ${ro.id} suggestion fits the tanks`, s.lines.every((l) => { const pm = Eng.metrics(ro).byP[l.product]; return l.kl * 1000 <= pm.capL - pm.deadL; }));
    check(`${at} ${ro.id} suggestion passes order validation`, !Eng.validateOrder(ro.id, s.lines, s.truckKL) || /already has an order/.test(Eng.validateOrder(ro.id, s.lines, s.truckKL)));
  });
  check(`${at} order over the truck size is rejected`, /truck carries/.test(Eng.validateOrder(city.id, [{ product: 'MS', kl: 16 }], 12)));
  check(`${at} part compartments are rejected`, /whole/.test(Eng.validateOrder(city.id, [{ product: 'MS', kl: 6 }], 12)));
  check(`${at} unknown product for the outlet is rejected`, !!Eng.validateOrder(hw.id, [{ product: 'XP', kl: 4 }], 12));

  // ---------- Storyline recommendations ----------
  const keys = Eng.recommendations().map((r) => r.key.split(':')[0]);
  for (const k of ['pay-order', 'rsp', 'nil', 'claim', 'log', 'flow', 'water', 'lic', 'obs']) check(`${at} storyline raises "${k}"`, keys.includes(k), keys.join(' '));
  const recs = Eng.recommendations();
  check(`${at} recommendations are ranked`, recs.every((r, i) => i === 0 || recs[i - 1].score >= r.score));
  check(`${at} every recommendation has a reason, an impact and an action`, recs.every((r) => r.title && r.why && r.impact && r.action && r.action.label));
  check(`${at} the urgent payment comes first`, recs[0].key.startsWith('pay-order') || recs[0].sev === 'critical', recs[0].key);

  // ---------- Payments ----------
  const A = Eng.actions;
  check(`${at} RTGS below ₹2 lakh is rejected`, /RTGS is for/.test(A.validatePayment(150000, 'RTGS', A.demoUtr('RTGS'))));
  check(`${at} malformed UTR is rejected`, !!A.validatePayment(500000, 'RTGS', 'HELLO'));
  check(`${at} NEFT UTR shape is enforced`, !!A.validatePayment(50000, 'NEFT', A.demoUtr('RTGS')) && !A.validatePayment(50000, 'NEFT', A.demoUtr('NEFT')));
  const waiting = DW.orders.find((o) => o.status === 'awaiting_payment');
  const short = waiting.value - Eng.money().available;
  const utr = A.demoUtr('RTGS');
  check(`${at} payment is recorded as pending`, A.recordPayment(short, 'RTGS', utr).payment.status === 'pending');
  check(`${at} the same UTR cannot be recorded twice`, /already/.test(A.validatePayment(short, 'RTGS', utr)));
  check(`${at} money is not available before the credit`, waiting.status === 'awaiting_payment');
  check(`${at} a recorded payment stops the "pay" card (no double payment)`, !Eng.recommendations().some((r) => r.key === `pay-order:${waiting.id}`));
  check(`${at} nothing more to pay once the payment is on its way`, Eng.stillToPay(waiting) === 0);
  check(`${at} absurd amounts are rejected`, [Infinity, NaN, 1e12, -5].every((x) => !!A.validatePayment(x, 'NEFT', A.demoUtr('NEFT'))));
  Eng.advance((C.paymentCreditMin + 1) * MIN);
  check(`${at} credit releases the waiting order`, waiting.status !== 'awaiting_payment', waiting.status);
  check(`${at} release time is recorded`, waiting.releasedTs >= waiting.createdTs && waiting.releasedTs <= waiting.loadStartTs);
  check(`${at} released order holds its value`, Eng.money().blocked >= waiting.value || waiting.invoice);

  // ---------- Lifecycle to receipt ----------
  const before = hw.tanks.filter((t) => t.product === 'HSD').reduce((a, t) => a + t.stockL, 0);
  const invoices = DW.ledger.filter((e) => e.type === 'Invoice').length;
  let guard = 0;
  while (waiting.status !== 'awaiting_receipt' && guard++ < 48 * 6) Eng.advance(10 * MIN);
  check(`${at} order reaches the outlet and waits for receipt`, waiting.status === 'awaiting_receipt', waiting.status);
  check(`${at} loading raised an invoice`, DW.ledger.filter((e) => e.type === 'Invoice').length === invoices + 1 && /^70\d{8}$/.test(waiting.invoice.no));
  const after = hw.tanks.filter((t) => t.product === 'HSD').reduce((a, t) => a + t.stockL, 0);
  check(`${at} unloading filled the diesel tanks`, after > before, `${Math.round(before)} → ${Math.round(after)}`);
  check(`${at} tanks never exceed capacity`, DW.ros.every((ro) => ro.tanks.every((t) => t.stockL <= t.capL + 1e-6 && t.stockL >= t.deadL - 1e-6)));
  check(`${at} a normal delivery is within the allowed loss`, waiting.lines.every((l) => l.kl * 1000 - waiting.atgReceivedL[l.product] <= l.kl * 1000 * C.transitLossFraction));
  check(`${at} receipt can be confirmed`, A.recordReceipt(waiting.id, false).order.status === 'received');

  // ---------- Claims ----------
  const shortOrder = DW.orders.find((o) => o.status === 'awaiting_receipt');
  if (shortOrder) {
    const credits = DW.ledger.filter((e) => e.type === 'Credit note').length;
    const r = A.recordReceipt(shortOrder.id, true);
    check(`${at} short delivery raises a claim`, r.order.status === 'claim_raised' && r.order.receipt.claim.value > 0);
    Eng.advance(C.soReplyMin * 7 * MIN);
    check(`${at} accepted claim posts a credit note`, DW.ledger.filter((e) => e.type === 'Credit note').length === credits + 1);
  } else check(`${at} storyline short delivery exists`, false);

  // ---------- Stock book between gauge readings ----------
  for (let i = 0; i < 4; i++) {
    Eng.advance(2 * MIN);
    const worst = Math.max(...DW.ros.flatMap((ro) => ro.products.map((p) => {
      const noz = ro.book.nozzleAtReadL[p];
      if (noz < 500) return 0;
      const tank = ro.book.openL[p] + ro.book.receiptL[p] - ro.tanks.filter((t) => t.product === p).reduce((a, t) => a + t.readL, 0);
      return Math.abs((tank - noz) / noz * 100 - ro.book.bias * 100);
    })));
    check(`${at} stock book stays at the true variation between readings`, worst < 0.1, `${worst.toFixed(3)}%`);
  }

  // ---------- Dismissals apply to one occurrence ----------
  const anyRec = Eng.recommendations().find((r) => r.key.startsWith('water:') || r.key.startsWith('obs:'));
  if (anyRec) {
    A.setRec(anyRec.key, 'dismissed', 'test');
    check(`${at} a dismissed card is hidden today`, !Eng.recommendations().some((r) => r.key === anyRec.key));
    DW.recState[anyRec.key].day -= 86400000; // as if dismissed on an earlier business day
    check(`${at} a dismissed card returns on a new business day`, Eng.recommendations().some((r) => r.key === anyRec.key));
  }

  // ---------- Actions clear their recommendations ----------
  const prem = city.products.includes('XP') ? 'XP' : 'MS';
  A.updatePrice(city.id, prem);
  check(`${at} updating the price clears the mismatch`, !Eng.recommendations().some((r) => r.key === `rsp:${city.id}:${prem}`));
  const log = hw.logs.find((l) => l.critical);
  check(`${at} an empty ATR is refused`, !!A.writeAtr(hw.id, log.id, '  ').error);
  A.writeAtr(hw.id, log.id, 'Power surge; totalizers checked, no difference.');
  check(`${at} filing an ATR clears the event`, !Eng.recommendations().some((r) => r.key === `log:${log.id}`));
  A.raiseTicket({ roId: hw.id, nozzle: 'N5', fix: 'nozzle', subject: 'N5 not dispensing', text: 'Please check.' });
  check(`${at} a raised complaint hides the nil-selling card`, !Eng.recommendations().some((r) => r.key === `nil:${hw.id}:N5`));
  Eng.advance(C.soReplyMin * 9 * MIN);
  check(`${at} the engineer visit repairs the nozzle`, !hw.nozzles.find((n) => n.id === 'N5').silent);
  check(`${at} the Sales Officer replies to requests`, DW.threads.some((t) => t.msgs.some((x) => x.from === 'so') && t.cat === 'Service'));
  A.setRec('target:x', 'snoozed');
  check(`${at} snooze is recorded with an expiry`, DW.recState['target:x'].until > Eng.now);

  // ---------- A truck too small to last still leaves a recommendation ----------
  {
    const { DW: W2, Eng: E2 } = load(hour);
    const h2 = W2.ros[0];
    const w2 = W2.orders.find((o) => o.status === 'awaiting_payment');
    w2.status = 'cancelled';
    // A 4 KL diesel truck already on the road, arriving within the hour.
    W2.orders.unshift({ id: 'ORD-TEST-1', roId: h2.id, lines: [{ product: 'HSD', kl: 4 }], truckKL: 12, value: 1, status: 'in_transit', createdTs: E2.now, dispatchTs: E2.now, arriveTs: E2.now + 30 * MIN, usableTs: E2.now + 60 * MIN, depotId: h2.depotId, invoice: { no: '7000000000', ts: E2.now }, truck: { plate: 'TEST' }, receipt: null });
    const pm = E2.metrics(h2).byP.HSD;
    const keys2 = E2.recommendations().map((r) => r.key);
    check(`${at} small delivery: forecast still runs dry`, pm.dryMovingTs != null);
    check(`${at} small delivery: an order card still appears`, keys2.some((k) => k === `order:${h2.id}:HSD` || k.startsWith('late:')), keys2.join(' '));
  }

  // ---------- Changing a waiting order ----------
  {
    const { DW: W3, Eng: E3 } = load(hour);
    const h3 = W3.ros[0];
    const w3 = W3.orders.find((o) => o.status === 'awaiting_payment');
    const res = E3.actions.placeOrder(h3.id, [{ product: 'HSD', kl: 20 }], 20, w3.id);
    check(`${at} a waiting order can be replaced`, !res.error && w3.status === 'cancelled' && res.order.status === 'awaiting_payment', res.error);
  }

  // ---------- A new order end to end, then a day rollover ----------
  const sug = Eng.suggest(city);
  if (sug) {
    const res = A.placeOrder(city.id, sug.lines, sug.truckKL);
    check(`${at} a suggested order can be placed`, !res.error, res.error);
    check(`${at} a second waiting order for the same outlet is refused`, !!A.placeOrder(city.id, sug.lines, sug.truckKL).error);
  }
  const histLen = hw.hist.length, open = hw.book.openTs;
  Eng.advance(30 * HOUR);
  check(`${at} the business day rolls over`, hw.book.openTs > open && hw.hist.length >= Math.min(30, histLen));
  check(`${at} still no NaN after a day and a half`, DW.ros.every((ro) => Object.values(Eng.metrics(ro).byP).every((x) => [x.usableL, x.coverDays, x.todayL].every(Number.isFinite))));
  check(`${at} money adds up`, Number.isFinite(Eng.money().available));
}

console.log(`dealer checks: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
