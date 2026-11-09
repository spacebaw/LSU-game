#!/usr/bin/env node
// UI refresh U5 scene: the title card (alone, with How to play / Settings open in the Menu sheet), every coach step, the icons on the at-rest screen,
// the Build sheet (collapsed / expanded), the Alerts and Layers popovers, the Menu list, the inspect card and pill; shot on the real game in headless Chrome.
//   node tools/qa/u5_scene.mjs [--prefix u5-] [--out dir] [--size 96|64]
// 1440 × 900 at 100 %: the full set; then title, title + sheet and coach step 3 at 1280 × 800 / 130 % (the window caps it to ~114 %) and 1920 × 1080 / 100 %.
// Checks as it goes: the coach card never overlaps its own target; the title card and the sheet do not overlap while the sheet is open; no BSU.error.
// One headless Chrome at a time; strays are killed first.
import { openGame, parseArgs, DEFAULT_OUT, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { prefix: { type: 'str', def: 'u5-' }, out: { type: 'str', def: DEFAULT_OUT }, size: { type: 'num', def: 96 } });
killStrays();
const written = []; let problems = 0;
const ev = (g, js) => g.eval(`(function () { ${js}; return true; })()`);
const shot = async (g, name) => { const p = await g.shot(args.prefix + name); written.push(p); console.log('shot', p); };
const check = async (g, label) => { const errs = await g.bsuErrors(); if (errs.length) { problems++; console.log(`  ${label}: BSU.error ${errs.join(' | ')}`); } };
const bad = (label, msg) => { problems++; console.log(`  ${label}: ${msg}`); };
async function rest(g) { await ev(g, `BSU.ui.closePopover(); BSU.ui.goalOpen(false); BSU.ui.openPalette(false); BSU.ui.dismissNotifs(); BSU.ui.closeInspect(); while (BSU.ui.closeCard && BSU.ui.cardOpen && BSU.ui.cardOpen()) BSU.ui.closeCard(); if (BSU.ui.buildMenuOpen()) BSU.ui.closeBuildMenu(); BSU.ui.openPanel(null)`); await sleep(400); }
async function setUp(g, scale) {
  await ev(g, `BSU.ui.setUiScale(${scale || 1})`); await sleep(150);
  await g.buildCampus({ target: 30, days: 30, students: 1500, stadium: true });
  await g.noGuard();
  await ev(g, `BSU.session.setSpeed(BSU.state, 0, 'user'); BSU.weather.scriptSky(BSU.state, 1, 0.4)`);
  await g.frameCampus(1, { keepOnMap: false }); await g.waitBake({ timeoutMs: 45000 }); await g.settleCamera();
  await rest(g); await sleep(400);
}
/** the title card and the sheet must not overlap while the sheet is open (the card steps aside), and the card must come back when it closes */
async function titleVsSheet(g, label) {
  const r = await g.eval(`(function () { var b = document.querySelector('.title-box').getBoundingClientRect(), s = document.getElementById('menu-sheet').getBoundingClientRect(); return { box: [Math.round(b.left), Math.round(b.right)], sheet: [Math.round(s.left), Math.round(s.right)], op: getComputedStyle(document.querySelector('.title-box')).opacity, overlap: b.right > s.left + 1 && b.left < s.right - 1 }; })()`);
  if (r.overlap) bad(label, `the title card ${r.box} overlaps the sheet ${r.sheet} (opacity ${r.op})`); else console.log(`  ${label}: card ${r.box} clear of sheet ${r.sheet} (card opacity ${r.op})`);
}
/** the coach card's box against the ring (its target): no overlap */
async function coachClear(g, label) {
  const r = await g.eval(`(function () { var b = document.getElementById('coach-box').getBoundingClientRect(), t = document.querySelector('.coach-ring'); if (!t || t.classList.contains('hidden')) return { none: true, pos: document.getElementById('coach-box').dataset.pos }; var q = t.getBoundingClientRect(); var ox = Math.min(b.right, q.right) - Math.max(b.left, q.left), oy = Math.min(b.bottom, q.bottom) - Math.max(b.top, q.top); return { overlap: ox > 1 && oy > 1, pos: document.getElementById('coach-box').dataset.pos, inWin: b.left >= 0 && b.top >= 0 && b.right <= innerWidth + .5 && b.bottom <= innerHeight + .5, box: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], ring: [Math.round(q.left), Math.round(q.top), Math.round(q.right), Math.round(q.bottom)] }; })()`);
  if (r.none) { console.log(`  ${label}: no target (box ${r.pos})`); return; }
  if (r.overlap || !r.inWin) bad(label, `coach box ${r.box} (${r.pos}) vs ring ${r.ring}: overlap=${r.overlap} inWindow=${r.inWin}`); else console.log(`  ${label}: box ${r.pos}, clear of its target`);
}
async function tour(g, prefix, only) {
  await ev(g, `BSU.ui.settings().coachSeen = false; BSU.ui.startCoach(BSU.state, { now: true })`); await sleep(900);
  const n = await g.eval(`BSU.data.coach.length`);
  for (let k = 0; k < n; k++) {
    const st = await g.eval(`BSU.ui.coachStep()`); if (st !== k) { bad(prefix, `expected coach step ${k}, at ${st}`); break; }
    await sleep(900);
    if (!only || only.includes(k)) { await shot(g, `${prefix}${k + 1}-of-${n}`); await coachClear(g, `${prefix}step ${k + 1}`); }
    await g.key('Enter'); await sleep(500);
  }
  await rest(g); await ev(g, `BSU.ui.settings().coachSeen = true`);
}

// ---- 1440 × 900 at 100 % ----
{
  const g = await openGame({ width: 1440, height: 900, size: args.size, seed: 42, outDir: args.out, noGuard: true });
  try {
    await setUp(g, 1);
    // title: the card over the dimmed map, then the Menu sheet over it with How to play and with Settings
    await g.title(true); await sleep(900); await shot(g, '1-title');
    await g.clickEl('#btn-title-howto'); await sleep(700); await shot(g, '2-title-howto'); await titleVsSheet(g, '1440 title + How to play');
    await g.key('Escape'); await sleep(500);
    const back = await g.eval(`(function () { var o = +getComputedStyle(document.querySelector('.title-box')).opacity; return o; })()`);
    if (back < 0.99) bad('1440 title', `the title card did not come back after the sheet closed (opacity ${back})`);
    await g.clickEl('#btn-title-settings'); await sleep(700); await shot(g, '3-title-settings'); await titleVsSheet(g, '1440 title + Settings');
    await g.key('Escape'); await sleep(400);
    await g.title(false); await sleep(400); await rest(g);
    // the coach: every step
    await tour(g, '4-coach-');
    // at rest (the app bar, the goal pill, the FAB with their icons)
    await shot(g, '5-rest-icons');
    // the Build sheet collapsed, then expanded (icons in the cards and the detail NEEDS)
    await g.clickEl('#fab-build'); await sleep(500); await ev(g, `BSU.state.ui.paletteTab = 'essentials'`); await sleep(250); await shot(g, '6-build-collapsed');
    await ev(g, `BSU.ui.openBuildMenu(BSU.state, { tab: 'housing' })`); await sleep(450); await ev(g, `BSU.ui.focusCard('dorm')`); await sleep(400); await shot(g, '7-build-expanded');
    await ev(g, `BSU.ui.openBuildMenu(BSU.state, { tab: 'essentials' })`); await sleep(300); await ev(g, `BSU.ui.focusCard('substation') || BSU.ui.focusCard('water_tower')`); await sleep(400); await shot(g, '7b-build-expanded-needs');
    await rest(g);
    // Alerts (cut the power so there are rows) and Layers
    const nIssues = await g.eval(`(function () { var s = BSU.state; s.buildings.filter(function (b) { return b && b.type === 'substation'; }).forEach(function (b) { BSU.buildings.remove(s, b.id, 'demolish'); }); BSU.buildings.recomputeCoverage && BSU.buildings.recomputeCoverage(s); BSU.issues.invalidate(); return BSU.issues.list(s).length; })()`);
    console.log('  issues after cutting the power: ' + nIssues);
    await ev(g, `BSU.session.setSpeed(BSU.state, 0, 'user')`); await sleep(400);
    await ev(g, `BSU.ui.openPopover('alerts')`); await sleep(600); await shot(g, '8-alerts'); await rest(g);
    await ev(g, `BSU.ui.setOverlay(BSU.state, BSU.OV.FLOOD); BSU.ui.openPopover('layers')`); await sleep(500); await shot(g, '9-layers'); await ev(g, `BSU.ui.setOverlay(BSU.state, BSU.OV.NONE)`); await rest(g);
    // the Menu list
    await ev(g, `BSU.ui.openSheet(true)`); await sleep(600); await shot(g, '10-menu-list'); await rest(g);
    // the inspect card and pill
    await ev(g, `var b = BSU.state.buildings.filter(function (x) { return x && x.type === 'dorm'; })[0]; BSU.ui.inspect(BSU.state, { kind: 'building', id: b.id })`); await sleep(600); await shot(g, '11-inspect-card');
    await ev(g, `BSU.ui.collapseInspect(true)`); await sleep(500); await shot(g, '12-inspect-pill'); await ev(g, `BSU.ui.collapseInspect(false)`); await rest(g);
    // a few snackbars and the alert strip for the kind icons
    await ev(g, `BSU.ui.notify(BSU.state, { kind: 'danger', text: 'Tiger Hall has no power.', ttl: 20000 }); BSU.ui.notify(BSU.state, { kind: 'water', text: 'Roux Hall is flooded.', ttl: 20000 })`); await sleep(600); await shot(g, '13-snackbar-kinds'); await rest(g);
    await check(g, '1440x900');
  } finally { await g.close(); }
}

// ---- 1280 × 800 at 130 % (the window caps it) and 1920 × 1080 at 100 %: title, title + sheet, coach step 3 ----
for (const [w, h, sc, tag] of [[1280, 800, 1.3, '1280x800-130'], [1920, 1080, 1, '1920x1080-100']]) {
  const g = await openGame({ width: w, height: h, size: args.size, seed: 42, outDir: args.out, noGuard: true });
  try {
    await setUp(g, sc);
    console.log(tag + ': effective scale ' + (await g.eval(`BSU.ui.uiScaleEffective()`)));
    await g.title(true); await sleep(900); await shot(g, `${tag}-title`);
    await g.clickEl('#btn-title-howto'); await sleep(700); await shot(g, `${tag}-title-howto`); await titleVsSheet(g, tag + ' title + How to play');
    await g.key('Escape'); await sleep(400); await g.title(false); await sleep(300); await rest(g);
    await tour(g, `${tag}-coach-`, [2]);
    await check(g, tag);
  } finally { await g.close(); }
}

killStrays();
console.log(`\n${written.length} screenshot(s) in ${args.out}${problems ? `; ${problems} problem(s)` : ''}`);
process.exit(problems ? 1 : 0);
