#!/usr/bin/env node
// UI refresh U4 scene: the Build sheet, collapsed (the quick bar) and expanded, shot on the real game in headless Chrome (tools/qa/lib.mjs openGame).
//   node tools/qa/u4_scene.mjs [--prefix u4-] [--out dir] [--size 96|64]
// 1440 × 900 at 100 %: the collapsed sheet (Essentials), a card focused with the keyboard, the expanded sheet (Housing, a dorm in the detail column), the expanded
// sheet with a search term, the coach ring on the goal's card in the open sheet, "Build it" from the goal card; then collapsed + expanded at 1280 × 800 / 130 %
// (the window caps it to ~114 %: the tightest case: ≥ 4 cards on the quick bar, the detail column scrolls instead of overflowing) and at 1920 × 1080 / 100 %.
// One headless Chrome at a time; strays are killed first.
import { openGame, parseArgs, DEFAULT_OUT, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { prefix: { type: 'str', def: 'u4-' }, out: { type: 'str', def: DEFAULT_OUT }, size: { type: 'num', def: 96 } });
killStrays();
const written = []; let problems = 0;
const ev = (g, js) => g.eval(`(function () { ${js}; return true; })()`);
const shot = async (g, name) => { const p = await g.shot(args.prefix + name); written.push(p); console.log('shot', p); };
const check = async (g, label) => { const errs = await g.bsuErrors(); if (errs.length) { problems++; console.log(`  ${label}: BSU.error ${errs.join(' | ')}`); } };
const bad = (label, msg) => { problems++; console.log(`  ${label}: ${msg}`); };
async function rest(g) { await ev(g, `BSU.ui.closePopover(); BSU.ui.goalOpen(false); BSU.ui.openPalette(false); BSU.ui.dismissNotifs(); BSU.ui.closeInspect(); while (BSU.ui.closeCard && BSU.ui.cardOpen && BSU.ui.cardOpen()) BSU.ui.closeCard(); if (BSU.ui.buildMenuOpen()) BSU.ui.closeBuildMenu(); BSU.ui.openPanel(null); BSU.ui.searchBuildings('')`); await sleep(150); }
async function setUp(g, scale) {
  await ev(g, `BSU.ui.setUiScale(${scale || 1})`); await sleep(150);
  await g.buildCampus({ target: 30, days: 30, students: 1500, stadium: true });
  await g.noGuard();
  await ev(g, `BSU.session.setSpeed(BSU.state, 0, 'user'); BSU.weather.scriptSky(BSU.state, 1, 0.4)`);
  await g.frameCampus(1, { keepOnMap: false }); await g.waitBake({ timeoutMs: 45000 }); await g.settleCamera();
  await rest(g); await sleep(400);
}
/** the collapsed sheet: inside the window, ≥ 4 cards fully visible in the scroller, nothing clipped sideways */
async function fitsCollapsed(g, label) {
  const r = await g.eval(`(function () {
    var p = document.getElementById('palette'), it = document.getElementById('palette-items'); if (!p || p.classList.contains('hidden')) return { err: 'collapsed sheet not visible' };
    var pr = p.getBoundingClientRect(), ir = it.getBoundingClientRect(), n = 0, cut = 0, kids = Array.from(it.children);
    kids.forEach(function (c) { var q = c.getBoundingClientRect(); if (q.left >= ir.left - 1 && q.right <= ir.right + 1) n++; if (q.bottom > pr.bottom + 1 || c.scrollHeight > c.clientHeight + 2) cut++; });
    var tabs = document.getElementById('palette-tabs'); var tr = tabs.getBoundingClientRect(); var last = tabs.lastElementChild ? tabs.lastElementChild.getBoundingClientRect() : tr;
    return { w: Math.round(pr.width), h: Math.round(pr.height), inWin: pr.left >= 0 && pr.right <= innerWidth + .5 && pr.top >= 0 && pr.bottom <= innerHeight + .5, whole: n, total: kids.length, cut: cut, tabsClipped: last.right > tr.right + 1 }
  })()`);
  if (r.err) return bad(label, r.err);
  if (!r.inWin || r.whole < 4 || r.cut || r.tabsClipped) bad(label, `COLLAPSED sheet ${r.w}x${r.h} inWindow=${r.inWin} wholeCards=${r.whole}/${r.total} clipped=${r.cut} tabsClipped=${r.tabsClipped}`);
  else console.log(`  ${label}: ok (sheet ${r.w}x${r.h}, ${r.whole} of ${r.total} cards fully visible)`);
}
/** the expanded sheet: inside the window, the detail column scrolls (never overflows the sheet), the foot is pinned, no sideways overflow */
async function fitsExpanded(g, label) {
  const r = await g.eval(`(function () {
    var m = document.getElementById('build-menu'); if (!m || m.classList.contains('hidden')) return { err: 'expanded sheet not visible' };
    var mr = m.getBoundingClientRect(), d = document.getElementById('bm-detail').getBoundingClientRect(), b = document.getElementById('bm-dbody'), f = document.getElementById('bm-dfoot').getBoundingClientRect(), c = document.getElementById('bm-cards');
    return { w: Math.round(mr.width), h: Math.round(mr.height), frac: +(mr.height / innerHeight).toFixed(2), inWin: mr.left >= 0 && mr.right <= innerWidth + .5 && mr.bottom <= innerHeight + .5 && mr.top >= 0, dOver: d.bottom > mr.bottom + 1 || f.bottom > mr.bottom + 1, footIn: f.top >= d.top, sx: b.scrollWidth - b.clientWidth, cx: c.scrollWidth - c.clientWidth, dScroll: b.scrollHeight - b.clientHeight }
  })()`);
  if (r.err) return bad(label, r.err);
  if (!r.inWin || r.dOver || !r.footIn || r.sx > 1 || r.cx > 1 || r.frac < .7 || r.frac > .9) bad(label, `EXPANDED sheet ${r.w}x${r.h} (${r.frac}) inWindow=${r.inWin} detailOverflow=${r.dOver} footPinned=${r.footIn} sideways=${r.sx}/${r.cx}`);
  else console.log(`  ${label}: ok (sheet ${r.w}x${r.h} = ${r.frac} of the window, detail scrolls ${r.dScroll}px)`);
}

// ---- 1440 × 900 at 100 % ----
{
  const g = await openGame({ width: 1440, height: 900, size: args.size, seed: 42, outDir: args.out, noGuard: true });
  try {
    await setUp(g, 1);
    await shot(g, '0-at-rest');
    // 1. the collapsed sheet on Essentials (opened with the FAB, like a player)
    await g.clickEl('#fab-build'); await sleep(450);
    await ev(g, `BSU.state.ui.paletteTab = 'essentials'`); await sleep(200);
    await shot(g, '1-collapsed-essentials'); await fitsCollapsed(g, '1440 collapsed');
    // 2. a card focused with the keyboard (G opened it that way; arrows move the focus)
    await ev(g, `BSU.ui.openPalette(false)`); await sleep(100); await g.key('g'); await sleep(350); await g.key('ArrowRight'); await sleep(100); await g.key('ArrowRight'); await sleep(250);
    console.log('  focused card: ' + (await g.eval(`BSU.ui.focusedCard()`)) + ', document focus: ' + (await g.eval(`(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id) || (document.activeElement && document.activeElement.tagName)`)));
    await shot(g, '2-collapsed-card-focused');
    // a greyed card and the tab row on another category
    await ev(g, `BSU.ui.openPalette(false)`); await rest(g); await g.clickEl('#fab-build'); await sleep(300);
    // two greyed cards (the unlock rule faked for the shot): a short and a long reason
    await ev(g, `window.__unl = BSU.buildings.unlocked; BSU.buildings.unlocked = function (s, id) { if (id === 'lecture_hall') return { ok: false, reason: 'Reach 400 students' }; if (id === 'dining_hall') return { ok: false, reason: 'Reach 1,200 students and prestige 40' }; return window.__unl.apply(this, arguments); }; BSU.state.ui.paletteTab = 'essentials'; BSU.ui.refreshPalette(BSU.state)`); await sleep(400);
    await shot(g, '2b-collapsed-locked-card'); await fitsCollapsed(g, '1440 collapsed with greyed cards');
    await ev(g, `BSU.ui.openBuildMenu(BSU.state, { tab: 'essentials' })`); await sleep(400); await shot(g, '2c-expanded-locked-card');
    await ev(g, `BSU.buildings.unlocked = window.__unl; BSU.ui.refreshPalette(BSU.state)`); await rest(g);
    // 3. the expanded sheet: Housing, a dorm in the detail column
    await g.key('g', { shift: true }); await sleep(450);
    await g.clickEl('#bm-cats [data-tab="housing"]'); await sleep(300);
    await ev(g, `BSU.ui.focusCard('dorm')`); await sleep(300);
    await shot(g, '3-expanded-housing'); await fitsExpanded(g, '1440 expanded');
    // 4. the expanded sheet with a search term (typed into the field)
    await g.clickEl('#bm-search'); await sleep(100); await g.eval(`(function () { var i = document.getElementById('bm-search'); i.value = 'oak'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`); await sleep(350);
    await shot(g, '4-expanded-search'); await fitsExpanded(g, '1440 expanded search');
    await ev(g, `BSU.ui.searchBuildings('')`); await rest(g);
    // 5. the coach ring on the goal's card inside the open sheet
    await ev(g, `BSU.ui.settings().coachSeen = false; BSU.ui.startCoach(BSU.state, { now: true })`); await sleep(400);
    await g.key('Enter'); await sleep(300); await g.key('Enter'); await sleep(900);
    console.log('  coach step: ' + (await g.eval(`BSU.ui.coachStep()`)) + ', sheet: ' + (await g.eval(`BSU.ui.buildSheetState()`)));
    await shot(g, '5-coach-ring-in-sheet');
    const ring = await g.eval(`(function () { var r = document.querySelector('.coach-ring'), g = BSU.ui._ux.objTarget(BSU.state, BSU.progress.objective(BSU.state)), c = document.querySelector('#bm-cards [data-id="' + g + '"]'); if (!r || !c) return { err: 'ring or card missing (' + g + ')' }; var a = r.getBoundingClientRect(), b = c.getBoundingClientRect(); return { ok: Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)) < 4 && Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 4, id: g }; })()`);
    if (ring.err || !ring.ok) bad('coach', 'the ring is not on the goal card ' + JSON.stringify(ring)); else console.log('  coach: the ring sits on the goal card (' + ring.id + ')');
    await ev(g, `BSU.ui.collapseBuildSheet()`); await sleep(700); await shot(g, '5b-coach-ring-collapsed');
    await g.key('Escape'); await sleep(300); await ev(g, `BSU.ui.settings().coachSeen = true`); await rest(g);
    // 6. Build it from the goal card
    await ev(g, `BSU.ui.goalOpen(true)`); await sleep(500); await shot(g, '6a-goal-card');
    await g.clickEl('#btn-obj-build'); await sleep(900); await shot(g, '6-build-it');
    console.log('  build it: sheet ' + (await g.eval(`BSU.ui.buildSheetState()`)) + ', tab ' + (await g.eval(`BSU.state.ui.paletteTab`)) + ', focused card ' + (await g.eval(`BSU.ui.focusedCard()`)) + ', tool ' + (await g.eval(`(BSU.ui.tool() && BSU.ui.tool().id) || null`)));
    await ev(g, `BSU.ui.selectTool(BSU.state, null)`); await rest(g);
    await check(g, '1440x900');
  } finally { await g.close(); }
}

// ---- 1280 × 800 at 130 % (the window caps it to ~114 %) ----
{
  const g = await openGame({ width: 1280, height: 800, size: args.size, seed: 42, outDir: args.out, noGuard: true });
  try {
    await setUp(g, 1.3);
    console.log('1280x800: effective scale ' + (await g.eval(`BSU.ui.uiScaleEffective()`)));
    await g.clickEl('#fab-build'); await sleep(450); await ev(g, `BSU.state.ui.paletteTab = 'essentials'`); await sleep(250);
    await shot(g, '7-1280-collapsed'); await fitsCollapsed(g, '1280 collapsed');
    await ev(g, `BSU.ui.openBuildMenu(BSU.state, { tab: 'housing' })`); await sleep(400); await ev(g, `BSU.ui.focusCard('dorm')`); await sleep(350);
    await shot(g, '8-1280-expanded'); await fitsExpanded(g, '1280 expanded');
    await ev(g, `BSU.ui.focusCard('mansion') || BSU.ui.focusCard('suites')`); await sleep(300); await shot(g, '8b-1280-expanded-long-detail'); await fitsExpanded(g, '1280 expanded (another card)');
    await check(g, '1280x800');
  } finally { await g.close(); }
}

// ---- 1920 × 1080 at 100 % ----
{
  const g = await openGame({ width: 1920, height: 1080, size: args.size, seed: 42, outDir: args.out, noGuard: true });
  try {
    await setUp(g, 1);
    await g.clickEl('#fab-build'); await sleep(450); await ev(g, `BSU.state.ui.paletteTab = 'essentials'`); await sleep(250);
    await shot(g, '9-1920-collapsed'); await fitsCollapsed(g, '1920 collapsed');
    await ev(g, `BSU.ui.openBuildMenu(BSU.state, { tab: 'housing' })`); await sleep(400); await ev(g, `BSU.ui.focusCard('dorm')`); await sleep(350);
    await shot(g, '10-1920-expanded'); await fitsExpanded(g, '1920 expanded');
    await check(g, '1920x1080');
  } finally { await g.close(); }
}

killStrays();
console.log(`\n${written.length} screenshot(s) in ${args.out}${problems ? `; ${problems} problem(s)` : ''}`);
process.exit(problems ? 1 : 0);
