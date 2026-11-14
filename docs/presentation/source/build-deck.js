/* Builds the Prahari pitch deck (dark theme, Morph transitions, clickable overview). */
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const Fi = require('react-icons/fi');
const JSZip = require('jszip');
const { applyTheme } = require('/Users/AG/.claude/skills/synced/66554700-0d35-4a5e-bb66-235fd6770cac_906c3021-788c-4e84-8c79-31f906d380a2/pptx/scripts/apply_theme.js');

const SHOTS = '/Users/AG/Petroleum_Dashboard/docs/screenshots';
const OUTDIR = '/Users/AG/Petroleum_Dashboard/docs/presentation';
const OUT = path.join(OUTDIR, 'Prahari - Pitch Deck.pptx');
const IMG = path.join(__dirname, 'img');
fs.mkdirSync(IMG, { recursive: true });
fs.mkdirSync(OUTDIR, { recursive: true });

// ---------- palette ----------
const K = {
  bg: '0E1013', panel: '171A1F', panel2: '1E2228', line: '2C3138',
  text: 'F2F2F0', muted: 'A3A8AE', faint: '6E737A',
  accent: 'F59E2B', green: '57B583', red: 'E5604F', amber: 'E0A645', blue: '7AA7FF',
};
const THEME = {
  name: 'Prahari Dark', headFontFace: 'Calibri', bodyFontFace: 'Calibri',
  colors: { dk1: K.bg, lt1: K.text, dk2: K.panel, lt2: K.muted, accent1: K.accent, accent2: K.green, accent3: K.red, accent4: K.blue, accent5: K.amber, accent6: K.faint, hlink: K.accent, folHlink: K.amber },
};

// ---------- helpers ----------
async function icon(Comp, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: '#' + color, size, strokeWidth: 1.8 }));
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}
async function crop(file, out, left, top, width, height) {
  const p = path.join(IMG, out);
  await sharp(path.join(SHOTS, file)).extract({ left, top, width, height }).png().toFile(p);
  return p;
}
const shadow = () => ({ type: 'outer', color: '000000', opacity: 0.45, blur: 18, offset: 6, angle: 90 });

async function main() {
  // Screenshot crops (source images are 1600 × 900)
  const img = {
    home: path.join(SHOTS, '01-ops-map.png'),
    outletPanel: await crop('02-outlet-overview.png', 'outlet-panel.png', 1168, 64, 420, 822),
    cctv: await crop('05-cctv-wall.png', 'cctv.png', 88, 140, 1172, 660),
    perf: path.join(SHOTS, '07-analytics.png'),
    priorities: await crop('01-ops-map.png', 'priorities.png', 68, 64, 340, 822),
  };
  const ic = {
    file: await icon(Fi.FiFileText, K.accent), phone: await icon(Fi.FiPhoneCall, K.accent), truck: await icon(Fi.FiTruck, K.accent),
    cash: await icon(Fi.FiCreditCard, K.accent), shield: await icon(Fi.FiShield, K.accent), grid: await icon(Fi.FiLayers, K.accent),
    db: await icon(Fi.FiDatabase, K.accent), eye: await icon(Fi.FiEye, K.accent), zap: await icon(Fi.FiZap, K.accent),
    droplet: await icon(Fi.FiDroplet, K.red), nav: await icon(Fi.FiNavigation, K.red), flask: await icon(Fi.FiAlertTriangle, K.red),
    scale: await icon(Fi.FiActivity, K.amber), cal: await icon(Fi.FiCalendar, K.amber), trend: await icon(Fi.FiTrendingDown, K.amber),
    users: await icon(Fi.FiUsers, K.accent), store: await icon(Fi.FiHome, K.accent), brief: await icon(Fi.FiBriefcase, K.accent),
    check: await icon(Fi.FiCheck, K.bg), cam: await icon(Fi.FiCamera, K.accent), hash: await icon(Fi.FiHash, K.accent), hard: await icon(Fi.FiAlertOctagon, K.accent),
    arrow: await icon(Fi.FiChevronRight, K.faint),
  };

  const CLEAR = 'image/png;base64,' + (await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()).toString('base64');
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE'; // 13.333 × 7.5
  pres.title = 'Prahari: one screen for every petrol pump in your area';
  pres.subject = 'Proposal for dealers and Sales Officers';
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };

  const footer = { x: 12.2, y: 7.0, w: 0.8, h: 0.3, color: K.faint, fontSize: 10, align: 'right' };
  pres.defineSlideMaster({
    title: 'DARK_TITLE', background: { color: K.bg },
    objects: [{ placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 0.5, w: 11.9, h: 0.9, fontSize: 34, bold: true, color: K.text, align: 'left', valign: 'middle', margin: 0 }, text: '' } }],
    slideNumber: footer,
  });
  pres.defineSlideMaster({ title: 'DARK_BLANK', background: { color: K.bg }, slideNumber: footer });

  // Shared building blocks -----------------------------------------------
  // The orb is the deck's motif. Same name on every slide, so Morph glides it between positions.
  const orb = (s, x, y, d, t = 90) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: K.accent, transparency: Math.min(96, t + 3) }, line: { color: K.accent, transparency: 75, width: 1 }, objectName: '!!orb' });
  };
  const ring = (s, x, y, d) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: K.bg, transparency: 100 }, line: { color: K.accent, transparency: 55, width: 1.25 }, objectName: '!!ring' });
  };
  const sub = (s, text, y = 1.42) => s.addText(text, { x: 0.7, y, w: 11.5, h: 0.5, fontSize: 17, color: K.muted, margin: 0, isTextBox: true });
  const backLink = (s) => s.addText([{ text: 'Overview', options: { hyperlink: { slide: 2, tooltip: 'Back to the overview' } } }], { x: 0.7, y: 7.0, w: 1.5, h: 0.3, fontSize: 10, color: K.faint, margin: 0, isTextBox: true });
  const framed = (s, file, x, y, w, h, name) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12, rectRadius: 0.1, fill: { color: K.panel }, line: { color: K.line, width: 0.75 }, shadow: shadow(), objectName: name ? name + '-frame' : undefined });
    s.addImage({ path: file, x, y, w, h, objectName: name });
  };
  const iconDisc = (s, data, x, y, d = 0.62, fill = K.panel2) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: K.line, width: 0.75 } });
    s.addImage({ data, x: x + d * 0.24, y: y + d * 0.24, w: d * 0.52, h: d * 0.52 });
  };
  const card = (s, x, y, w, h) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: K.panel }, line: { color: K.line, width: 0.75 } });

  // =====================================================================
  // 1. Title
  // =====================================================================
  pres.addSection({ title: 'Opening' });
  let s = pres.addSlide({ masterName: 'DARK_BLANK', sectionTitle: 'Opening' });
  orb(s, 7.4, -1.6, 7.6, 88);
  ring(s, 10.6, 4.4, 3.4);
  framed(s, img.home, 6.55, 1.75, 6.1, 3.43, '!!shot');
  s.addText('Prahari', { x: 0.7, y: 1.6, w: 5.6, h: 1.1, fontSize: 60, bold: true, color: K.text, margin: 0, isTextBox: true });
  s.addText('One screen for every petrol pump in your area', { x: 0.7, y: 2.75, w: 5.5, h: 1.3, fontSize: 26, color: K.text, margin: 0, isTextBox: true, valign: 'top' });
  s.addText('A proposal for dealers and Sales Officers, starting with the Gurugram Sales Area', { x: 0.7, y: 4.25, w: 5.2, h: 0.8, fontSize: 15, color: K.muted, margin: 0, isTextBox: true, valign: 'top' });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 5.55, w: 2.35, h: 0.46, rectRadius: 0.23, fill: { color: K.accent }, line: { color: K.accent } });
  s.addText('Working demo ready', { x: 0.7, y: 5.55, w: 2.35, h: 0.46, fontSize: 13, bold: true, color: K.bg, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
  s.addNotes('Thank you for your time. Prahari means "sentinel" or "guard". The idea is simple: one screen that shows everything happening across all the petrol pumps in an area, the stock, the tankers, the sales, the cameras and the paperwork, and tells you what needs attention. Everything you will see today is a working demo running on sample data for the Gurugram area.');

  // =====================================================================
  // 2. Overview (clickable)
  // =====================================================================
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'Opening' });
  orb(s, -1.8, 4.2, 5.2, 92);
  ring(s, 11.2, -0.9, 2.6);
  s.addText('What we will cover', { placeholder: 'title' });
  sub(s, 'Click any card to jump straight to that part');
  const tiles = [
    ['01', 'Running a pump today', 'Where time and money slip away', 3],
    ['02', 'Meet Prahari', 'What it is and how it works', 5],
    ['03', 'What it catches', 'Problems spotted before they hurt', 9],
    ['04', 'The road ahead', 'The plan, and how you can help', 12],
  ];
  tiles.forEach(([n, t, d, target], i) => {
    const x = 0.7 + i * 3.05, y = 2.55, w = 2.8, h = 3.3;
    card(s, x, y, w, h);
    s.addText(n, { x: x + 0.3, y: y + 0.3, w: 1.5, h: 0.8, fontSize: 40, bold: true, color: K.accent, margin: 0, isTextBox: true });
    s.addText(t, { x: x + 0.3, y: y + 1.45, w: w - 0.6, h: 0.8, fontSize: 20, bold: true, color: K.text, margin: 0, valign: 'top', isTextBox: true });
    s.addText(d, { x: x + 0.3, y: y + 2.25, w: w - 0.6, h: 0.6, fontSize: 14, color: K.muted, margin: 0, valign: 'top', isTextBox: true });
    // Transparent clickable overlay across the whole card
    s.addImage({ data: CLEAR, x, y, w, h, hyperlink: { slide: target, tooltip: 'Go to: ' + t }, altText: 'Go to ' + t });
  });
  s.addNotes('Here is what we will cover. Each card is clickable, so if you want to jump straight to something, just click it. Every slide also has a small "Overview" link at the bottom left to come back here.');

  // =====================================================================
  // 3. Running a pump today
  // =====================================================================
  pres.addSection({ title: 'The challenge' });
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'The challenge' });
  orb(s, 10.9, -1.2, 3.2, 90);
  ring(s, 12.2, 5.9, 1.6);
  s.addText('Running a petrol pump means juggling a lot', { placeholder: 'title' });
  sub(s, 'The information exists, but it lives in six different places');
  const juggle = [
    [ic.file, 'Paper registers', 'Dips, density, shift sales and cash, written by hand'],
    [ic.phone, 'Calls and WhatsApp', 'Chasing the Sales Officer, transporter and staff'],
    [ic.truck, 'Waiting on tankers', 'No clear view of when the next load will arrive'],
    [ic.cash, 'Cash, UPI and cards', 'Matching every shift\'s money against the meters'],
    [ic.shield, 'Licences and inspections', 'Renewal dates kept in files and memory'],
    [ic.grid, 'Separate portals', 'Orders in one app, statements in another'],
  ];
  juggle.forEach(([data, t, d], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 0.7 + col * 4.05, y = 2.35 + row * 2.25, w = 3.8, h = 2.0;
    card(s, x, y, w, h);
    iconDisc(s, data, x + 0.3, y + 0.3);
    s.addText(t, { x: x + 0.3, y: y + 1.05, w: w - 0.6, h: 0.4, fontSize: 17, bold: true, color: K.text, margin: 0, isTextBox: true });
    s.addText(d, { x: x + 0.3, y: y + 1.42, w: w - 0.6, h: 0.5, fontSize: 13, color: K.muted, margin: 0, valign: 'top', isTextBox: true });
  });
  backLink(s);
  s.addNotes('You know this better than me. On a normal day the information you need is spread across paper registers, phone calls and WhatsApp, the company portal, bank and UPI statements, and files for licences. Nothing connects them, so people spend hours stitching it together and problems are noticed late.');

  // =====================================================================
  // 4. Small slips get expensive
  // =====================================================================
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'The challenge' });
  orb(s, -2.4, -2.0, 6.0, 91);
  ring(s, 10.4, 4.7, 3.0);
  s.addText('Small slips get expensive', { placeholder: 'title' });
  sub(s, 'Margins are thin and every tanker is paid for in advance');
  const stats = [
    ['₹3–4', 'roughly what a dealer earns on a litre of petrol'],
    ['12–24 kL', 'of fuel paid for upfront in every tanker load'],
    ['40–100', 'outlets watched over by a single Sales Officer'],
  ];
  stats.forEach(([big, label], i) => {
    const x = 0.7 + i * 4.05;
    card(s, x, 2.4, 3.8, 2.6);
    s.addText(big, { x: x + 0.35, y: 2.7, w: 3.2, h: 1.1, fontSize: 54, bold: true, color: K.accent, margin: 0, isTextBox: true });
    s.addText(label, { x: x + 0.35, y: 3.9, w: 3.1, h: 0.9, fontSize: 16, color: K.text, margin: 0, valign: 'top', isTextBox: true });
  });
  s.addText('So one dry tank, one short delivery or one missed renewal can wipe out days of earnings, and nobody sees it coming.', { x: 0.7, y: 5.45, w: 11.9, h: 0.8, fontSize: 19, color: K.text, italic: true, margin: 0, isTextBox: true });
  s.addText('Approximate industry figures', { x: 0.7, y: 6.35, w: 6, h: 0.3, fontSize: 10, color: K.faint, margin: 0, isTextBox: true });
  backLink(s);
  s.addNotes('A few numbers to frame it. The dealer margin is only a few rupees a litre. Every tanker is paid for before it leaves the depot. And one Sales Officer looks after dozens of outlets. So small problems like a dry tank, a short delivery or a lapsed licence cost real money, and today they are usually discovered after the fact. These are approximate industry figures, please correct me with your own.');

  // =====================================================================
  // 5. Meet Prahari
  // =====================================================================
  pres.addSection({ title: 'Meet Prahari' });
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'Meet Prahari' });
  orb(s, 3.2, 0.6, 7.0, 93);
  ring(s, 11.6, 5.6, 2.2);
  s.addText('Meet Prahari', { placeholder: 'title' });
  sub(s, 'Everything happening across your outlets, on one live map');
  framed(s, img.home, 2.45, 2.1, 8.44, 4.75, '!!shot');
  backLink(s);
  s.addNotes('This is Prahari. It is a live map of the whole sales area. Every dot is a petrol pump, coloured by how it is doing. The small white tiles are tankers moving in real time. On the left you see the day\'s numbers and a short list of what needs attention first. This is a good moment to switch to the live demo if you have the laptop open.');

  // =====================================================================
  // 6. How it works
  // =====================================================================
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'Meet Prahari' });
  orb(s, 10.2, 3.9, 4.4, 91);
  ring(s, -0.8, -0.9, 2.4);
  s.addText('How it works, in three steps', { placeholder: 'title' });
  sub(s, 'No new habits. It starts with the information you already have');
  const steps = [
    [ic.db, '1', 'Collect', 'Reads what already exists: tank gauges, pump meters, tanker GPS and your daily registers'],
    [ic.eye, '2', 'Understand', 'Spots problems on its own and explains each one in a single plain sentence'],
    [ic.zap, '3', 'Act', 'One tap to send a tanker, call the dealer or book an inspection visit'],
  ];
  steps.forEach(([data, n, t, d], i) => {
    const x = 0.7 + i * 4.2, y = 2.55, w = 3.6, h = 3.6;
    card(s, x, y, w, h);
    iconDisc(s, data, x + 0.35, y + 0.4, 0.9);
    s.addText(n, { x: x + w - 1.0, y: y + 0.35, w: 0.7, h: 0.6, fontSize: 28, bold: true, color: K.faint, align: 'right', margin: 0, isTextBox: true });
    s.addText(t, { x: x + 0.35, y: y + 1.6, w: w - 0.7, h: 0.5, fontSize: 24, bold: true, color: K.text, margin: 0, isTextBox: true });
    s.addText(d, { x: x + 0.35, y: y + 2.2, w: w - 0.7, h: 1.2, fontSize: 15, color: K.muted, margin: 0, valign: 'top', isTextBox: true });
    if (i < 2) s.addImage({ data: ic.arrow, x: x + w + 0.08, y: y + h / 2 - 0.22, w: 0.44, h: 0.44 });
  });
  backLink(s);
  s.addNotes('How does it work? Three steps. First it collects information that already exists, from the tank gauges and pumps, the tanker tracking and the registers you keep. Second, it understands it: it spots problems on its own and writes them in plain language, for example "diesel runs out in 13 hours". Third, you act with one tap, such as send a tanker or call the dealer.');

  // =====================================================================
  // 7. Whole area at a glance
  // =====================================================================
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'Meet Prahari' });
  orb(s, 7.8, 4.6, 3.6, 91);
  ring(s, 12.0, -0.6, 1.8);
  s.addText('Your whole area, at a glance', { placeholder: 'title' });
  sub(s, 'Colours tell you where to look first');
  framed(s, img.home, 0.76, 2.2, 7.4, 4.16, '!!shot');
  const legend = [
    [K.green, 'Running normally', 'Nothing to do'],
    [K.amber, 'Needs attention', 'Worth a look today'],
    [K.red, 'Urgent', 'Act now, with one-tap actions'],
    ['FFFFFF', 'Tankers, live', 'Where every load is right now'],
  ];
  legend.forEach(([c, t, d], i) => {
    const y = 2.3 + i * 1.02;
    s.addShape(pres.shapes.OVAL, { x: 8.75, y: y + 0.08, w: 0.32, h: 0.32, fill: { color: c }, line: { color: K.bg, width: 1.5 } });
    s.addText(t, { x: 9.3, y, w: 3.4, h: 0.4, fontSize: 18, bold: true, color: K.text, margin: 0, isTextBox: true });
    s.addText(d, { x: 9.3, y: y + 0.42, w: 3.4, h: 0.4, fontSize: 14, color: K.muted, margin: 0, isTextBox: true });
  });
  backLink(s);
  s.addNotes('The colours keep it simple. Green means running normally, amber means worth a look today, red means act now. The white tiles are tankers. A Sales Officer can open this in the morning and know in ten seconds where to focus, instead of making twenty phone calls.');

  // =====================================================================
  // 8. Every outlet in one sentence
  // =====================================================================
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'Meet Prahari' });
  orb(s, 7.2, -1.4, 4.2, 91);
  ring(s, -0.7, 5.6, 2.2);
  s.addText('Every outlet, explained in one sentence', { placeholder: 'title' });
  sub(s, 'Click any pump on the map and it tells you what matters');
  card(s, 0.7, 2.35, 7.6, 1.9);
  s.addText('“Diesel runs out in about 13 hours. The order is on hold until the dealer\'s payment clears.”', { x: 1.05, y: 2.55, w: 6.9, h: 1.5, fontSize: 22, italic: true, color: K.text, margin: 0, valign: 'middle', isTextBox: true });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 4.55, w: 2.65, h: 0.5, rectRadius: 0.25, fill: { color: K.text }, line: { color: K.text } });
  s.addText('Send a truck now', { x: 0.7, y: 4.55, w: 2.65, h: 0.5, fontSize: 14, bold: true, color: K.bg, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
  s.addText('The fix is one tap away', { x: 3.55, y: 4.55, w: 4, h: 0.5, fontSize: 14, color: K.muted, valign: 'middle', margin: 0, isTextBox: true });
  s.addText([
    { text: 'Tanks, and how many days of fuel are left', options: { bullet: true, breakLine: true } },
    { text: 'Live sales and which pumps are working', options: { bullet: true, breakLine: true } },
    { text: 'Deliveries, quality checks and licences', options: { bullet: true, breakLine: true } },
    { text: 'The dealer\'s account and visit notes', options: { bullet: true } },
  ], { x: 0.7, y: 5.3, w: 7.4, h: 1.5, fontSize: 15, color: K.text, paraSpaceAfter: 6, margin: 0, isTextBox: true });
  framed(s, img.outletPanel, 9.6, 1.55, 2.66, 5.2, '!!panel');
  backLink(s);
  s.addNotes('When you click a pump, Prahari explains its situation in one sentence, like this one. No reports to read. Underneath are the details: tank levels, live sales, pumps, deliveries, licences and the dealer\'s account. And the fix is a button right there, in this case "Send a truck now".');

  // =====================================================================
  // 9. What it catches
  // =====================================================================
  pres.addSection({ title: 'What it catches' });
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'What it catches' });
  orb(s, 11.3, 4.6, 3.6, 91);
  ring(s, 6.2, -1.3, 2.2);
  s.addText('Problems it catches before they hurt', { placeholder: 'title' });
  sub(s, 'Prahari watches every outlet around the clock and raises a flag early');
  const catches = [
    [ic.droplet, 'About to run dry', 'Warns hours ahead, and checks a tanker is on its way'],
    [ic.nav, 'Tanker stops off route', 'Flags unplanned halts, the classic sign of fuel theft'],
    [ic.flask, 'Bad fuel delivered', 'Catches a failed density check before it is sold'],
    [ic.scale, 'Stock not matching sales', 'Spots leaks, pilferage or meter problems'],
    [ic.cal, 'Licence about to expire', 'Reminds weeks before, not after an inspection'],
    [ic.trend, 'Sales falling', 'Notices a drop, for example after a new competitor opens'],
  ];
  catches.forEach(([data, t, d], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 0.7 + col * 4.05, y = 2.35 + row * 2.25, w = 3.8, h = 2.0;
    card(s, x, y, w, h);
    iconDisc(s, data, x + 0.3, y + 0.3);
    s.addText(t, { x: x + 0.3, y: y + 1.05, w: w - 0.6, h: 0.4, fontSize: 17, bold: true, color: K.text, margin: 0, isTextBox: true });
    s.addText(d, { x: x + 0.3, y: y + 1.42, w: w - 0.6, h: 0.5, fontSize: 13, color: K.muted, margin: 0, valign: 'top', isTextBox: true });
  });
  backLink(s);
  s.addNotes('These are the six problems it catches early. Running dry. A tanker stopping where it should not, which is how pilferage usually happens. A delivery that fails the density check. Stock that does not match sales. A licence about to expire. And sales dropping, for example when a new competitor opens nearby. Red ones are urgent, amber ones need a look.');

  // =====================================================================
  // 10. Cameras
  // =====================================================================
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'What it catches' });
  orb(s, 10.9, 5.3, 3.2, 92);
  ring(s, 0.2, 6.1, 1.6);
  s.addText('Eyes on every forecourt', { placeholder: 'title' });
  sub(s, 'The cameras you already have, made smart');
  framed(s, img.cctv, 0.76, 2.2, 7.6, 4.28, '!!shot');
  const camf = [
    [ic.cam, 'Counts queues', 'Tells you when to open more pumps'],
    [ic.hash, 'Reads number plates', 'Recognises fleet and regular customers'],
    [ic.hard, 'Checks unloading safety', 'Flags unloading without safety cones'],
  ];
  camf.forEach(([data, t, d], i) => {
    const y = 2.3 + i * 1.4;
    iconDisc(s, data, 8.85, y, 0.7);
    s.addText(t, { x: 9.75, y: y - 0.02, w: 3.0, h: 0.4, fontSize: 18, bold: true, color: K.text, margin: 0, isTextBox: true });
    s.addText(d, { x: 9.75, y: y + 0.38, w: 3.0, h: 0.6, fontSize: 14, color: K.muted, margin: 0, valign: 'top', isTextBox: true });
  });
  s.addText('Shown with sample camera feeds', { x: 0.76, y: 6.6, w: 5, h: 0.3, fontSize: 10, color: K.faint, margin: 0, isTextBox: true });
  backLink(s);
  s.addNotes('Most outlets already have CCTV, but nobody watches it. Prahari can look at those feeds for you: count queues so you know when to open more pumps, read number plates of fleet customers, and check that tanker unloading is done safely. The feeds here are simulated for the demo.');

  // =====================================================================
  // 11. What's in it for everyone
  // =====================================================================
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'What it catches' });
  orb(s, 4.6, 4.9, 4.2, 92);
  ring(s, 11.5, -0.7, 2.0);
  s.addText('What is in it for everyone', { placeholder: 'title' });
  sub(s, 'Everyone sees the same picture, so problems are fixed sooner');
  const wins = [
    [ic.store, 'For the dealer', ['Fewer dry tanks and lost sales', 'Faster shift and cash checks', 'Licence reminders in good time', 'Proof when a delivery is disputed']],
    [ic.users, 'For the Sales Officer', ['The whole area on one screen', 'Early warnings, not surprises', 'Less chasing on the phone', 'Visits planned where they matter']],
    [ic.brief, 'For the oil company', ['More fuel sold, fewer dry-outs', 'Less pilferage on the road', 'Better quality and compliance', 'Clear data for decisions']],
  ];
  wins.forEach(([data, t, items], i) => {
    const x = 0.7 + i * 4.05, y = 2.35, w = 3.8, h = 4.3;
    card(s, x, y, w, h);
    iconDisc(s, data, x + 0.35, y + 0.35, 0.75);
    s.addText(t, { x: x + 0.35, y: y + 1.3, w: w - 0.7, h: 0.5, fontSize: 21, bold: true, color: K.text, margin: 0, isTextBox: true });
    s.addText(items.map((it, k) => ({ text: it, options: { bullet: true, breakLine: k < items.length - 1 } })), { x: x + 0.35, y: y + 1.95, w: w - 0.6, h: 2.1, fontSize: 15, color: K.muted, paraSpaceAfter: 8, margin: 0, valign: 'top', isTextBox: true });
  });
  backLink(s);
  s.addNotes('Who benefits? The dealer gets fewer dry tanks, faster cash checks and reminders before licences lapse. The Sales Officer gets the whole area on one screen and fewer phone calls. And the oil company sells more fuel and loses less of it. Because everyone sees the same picture, problems get fixed sooner and arguments are fewer.');

  // =====================================================================
  // 12. The road ahead
  // =====================================================================
  pres.addSection({ title: 'The road ahead' });
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'The road ahead' });
  orb(s, 0.5, 3.25, 1.0, 82);
  ring(s, 11.7, -0.9, 2.2);
  s.addText('The road ahead', { placeholder: 'title' });
  sub(s, 'Start small with one Sales Officer, prove it works, then grow');
  s.addShape(pres.shapes.LINE, { x: 1.0, y: 3.75, w: 9.3, h: 0, line: { color: K.line, width: 2 } });
  const miles = [
    ['Today', 'Working demo', 'Built and ready to show', true],
    ['Next 2–3 months', 'Small pilot', 'One Sales Officer and a few friendly outlets, using real data', false],
    ['In 6–9 months', 'Bigger pilot', 'A whole division, with the oil company\'s support', false],
    ['After that', 'Every outlet', 'Across the region, and later the country', false],
  ];
  miles.forEach(([when, t, d, done], i) => {
    const cx = 1.0 + i * 3.1;
    s.addShape(pres.shapes.OVAL, { x: cx - 0.22, y: 3.53, w: 0.44, h: 0.44, fill: { color: done ? K.accent : K.panel2 }, line: { color: done ? K.accent : K.faint, width: 1.5 } });
    if (done) s.addImage({ data: ic.check, x: cx - 0.13, y: 3.62, w: 0.26, h: 0.26 });
    s.addText(when, { x: cx - 0.22, y: 2.6, w: 2.6, h: 0.4, fontSize: 14, bold: true, color: done ? K.accent : K.muted, margin: 0, isTextBox: true });
    s.addText(t, { x: cx - 0.22, y: 4.35, w: 2.6, h: 0.5, fontSize: 21, bold: true, color: K.text, margin: 0, isTextBox: true });
    s.addText(d, { x: cx - 0.22, y: 4.9, w: 2.6, h: 1.2, fontSize: 14, color: K.muted, margin: 0, valign: 'top', isTextBox: true });
  });
  backLink(s);
  s.addNotes('Here is the plan. Today we have a working demo. Next, a small pilot with one Sales Officer and a few friendly outlets using real data, to prove it saves time and prevents dry-outs. If that works, a bigger pilot across a division with the oil company\'s support. And after that, every outlet in the region.');

  // =====================================================================
  // 13. How you can help
  // =====================================================================
  s = pres.addSlide({ masterName: 'DARK_TITLE', sectionTitle: 'The road ahead' });
  orb(s, 9.4, 1.6, 4.6, 88);
  ring(s, 8.6, 5.3, 1.8);
  s.addText('How you can help', { placeholder: 'title' });
  sub(s, 'Your experience is what turns this from a demo into something real');
  const asks = [
    ['1', 'Introduce us to a Sales Officer', 'Someone open to trying a pilot in their area'],
    ['2', 'Show us how your outlet runs', 'The registers, reports and calls behind a normal day'],
    ['3', 'Try the early version', 'Use it at your pump and tell us what is missing'],
  ];
  asks.forEach(([n, t, d], i) => {
    const y = 2.4 + i * 1.45;
    s.addShape(pres.shapes.OVAL, { x: 0.7, y, w: 0.8, h: 0.8, fill: { color: K.accent }, line: { color: K.accent } });
    s.addText(n, { x: 0.7, y, w: 0.8, h: 0.8, fontSize: 26, bold: true, color: K.bg, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    s.addText(t, { x: 1.8, y: y + 0.0, w: 6.6, h: 0.45, fontSize: 22, bold: true, color: K.text, margin: 0, isTextBox: true });
    s.addText(d, { x: 1.8, y: y + 0.45, w: 6.6, h: 0.4, fontSize: 15, color: K.muted, margin: 0, isTextBox: true });
  });
  framed(s, img.priorities, 10.5, 1.55, 2.15, 5.2, '!!panel');
  backLink(s);
  s.addNotes('This is where your help matters most. First, an introduction to a Sales Officer who would be open to a small pilot. Second, a closer look at how your outlet runs day to day, the registers and reports, so we build the right thing. Third, trying an early version at your pump and telling us honestly what is missing.');

  // =====================================================================
  // 14. Thank you
  // =====================================================================
  s = pres.addSlide({ masterName: 'DARK_BLANK', sectionTitle: 'The road ahead' });
  orb(s, 3.67, -0.9, 6.0, 88);
  ring(s, 5.67, 4.6, 2.0);
  s.addText('Thank you', { x: 0.7, y: 2.4, w: 11.93, h: 1.2, fontSize: 60, bold: true, color: K.text, align: 'center', margin: 0, isTextBox: true });
  s.addText('Prahari: one screen for every petrol pump in your area', { x: 0.7, y: 3.65, w: 11.93, h: 0.6, fontSize: 20, color: K.muted, align: 'center', margin: 0, isTextBox: true });
  s.addText([{ text: 'Back to the overview', options: { hyperlink: { slide: 2, tooltip: 'Back to the overview' } } }], { x: 5.17, y: 6.2, w: 3.0, h: 0.4, fontSize: 13, color: K.accent, align: 'center', margin: 0, isTextBox: true });
  s.addNotes('Thank you. Happy to show anything again in the live demo, or answer questions.');

  const target = process.env.OUTFILE || OUT;
  await pres.writeFile({ fileName: target });
  if (process.env.STAGE !== "raw") await applyTheme(target, THEME);
  if (!process.env.STAGE || process.env.STAGE === "morph") await addMorph(target);
  console.log('Wrote', process.env.OUTFILE || OUT);
}

// Morph transition on every slide (fade fallback for older PowerPoint versions)
async function addMorph(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const T = '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
    + '<mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159">'
    + '<p:transition spd="slow" p14:dur="1600"><p159:morph option="byObject"/></p:transition></mc:Choice>'
    + '<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>';
  for (const n of names) {
    let x = await zip.file(n).async('string');
    if (!x.includes('xmlns:p14=')) x = x.replace('<p:sld ', '<p:sld xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" ');
    x = x.includes('<p:timing') ? x.replace('<p:timing', T + '<p:timing') : x.replace('</p:sld>', T + '</p:sld>');
    zip.file(n, x);
  }
  // Rebuild the archive with files only (no folder entries), keeping [Content_Types].xml first
  const out = new JSZip();
  const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0));
  for (const n of files) out.file(n, await zip.file(n).async('nodebuffer'), { createFolders: false });
  fs.writeFileSync(file, await out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

main().catch((e) => { console.error(e); process.exit(1); });
