#!/usr/bin/env node
// UI refresh U3 scene: the Menu side sheet (list + every panel inside it), the inspect card and pill, the Board and voice dialogs,
// shot on the real game in headless Chrome (tools/qa/lib.mjs openGame).
//   node tools/qa/u3_scene.mjs [--prefix u3-] [--out dir] [--size 96|64]
// 1440 × 900 at 100 %: the Menu list; Budget, Season, Storm, Land Office, Almanac, Milestones, Log, Settings, How to play, About inside the sheet;
// the inspect card and its pill; the Board dialog and the student-voice dialog; then every panel again at 1280 × 800 / 130 % (the window caps it:
// the tightest case) where each panel must scroll inside the sheet, never overflow it. One headless Chrome at a time; strays are killed first.
import { openGame, parseArgs, DEFAULT_OUT, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { prefix: { type: 'str', def: 'u3-' }, out: { type: 'str', def: DEFAULT_OUT }, size: { type: 'num', def: 96 } });
killStrays();
const written = []; let problems = 0;
const ev = (g, js) => g.eval(`(function () { ${js}; return true; })()`);
const shot = async (g, name) => { const p = await g.shot(args.prefix + name); written.push(p); console.log('shot', p); };
const check = async (g, label) => { const errs = await g.bsuErrors(); if (errs.length) { problems++; console.log(`  ${label}: BSU.error ${errs.join(' | ')}`); } };
const PANELS = [['budget', 'Budget'], ['season', 'Season'], ['storm', 'Storm'], ['land', 'Land Office'], ['almanac', 'Almanac'], ['milestones', 'Milestones'], ['log', 'Log'], ['settings', 'Settings'], ['howto', 'How to play'], ['about', 'About']];
async function setUp(g, scale) {
  await ev(g, `BSU.ui.setUiScale(${scale || 1})`); await sleep(150);
  await g.buildCampus({ target: 30, days: 30, students: 1500, stadium: true });   // a team, so the Season tabs have tables to fit
  await g.noGuard();
  await ev(g, `BSU.session.setSpeed(BSU.state, 0, 'user'); BSU.weather.scriptSky(BSU.state, 1, 0.4)`);
  await g.frameCampus(1, { keepOnMap: false }); await g.waitBake({ timeoutMs: 45000 }); await g.settleCamera();
  await rest(g); await sleep(400);
}
async function rest(g) { await ev(g, `BSU.ui.closePopover(); BSU.ui.goalOpen(false); BSU.ui.openPalette(false); BSU.ui.dismissNotifs(); BSU.ui.closeInspect(); while (BSU.ui.closeCard && BSU.ui.cardOpen && BSU.ui.cardOpen()) BSU.ui.closeCard(); if (BSU.ui.buildMenuOpen()) BSU.ui.closeBuildMenu(); BSU.ui.openPanel(null)`); await sleep(120); }
/** the sheet must be inside the window and every panel descendant inside the sheet body (the body scrolls vertically, never sideways) */
async function fits(g, label) {
  const r = await g.eval(`(function () {
    var sh = document.getElementById('menu-sheet'), body = document.getElementById('sheet-body'); if (!sh || sh.classList.contains('hidden')) return { err: 'sheet not visible' };
    var sr = sh.getBoundingClientRect(), br = body.getBoundingClientRect(), bad = [];
    var host = document.querySelector('#sheet-body .panel:not(.hidden)') || document.getElementById('sheet-list');
    var all = host.querySelectorAll('*'); for (var i = 0; i < all.length; i++) { var e = all[i], rc = e.getBoundingClientRect(); if (rc.width > 0 && rc.right > br.right + 1.5 && getComputedStyle(e).position !== 'fixed') { if (bad.length < 4) bad.push((e.id || e.className || e.tagName) + ' +' + Math.round(rc.right - br.right)); } }
    return { w: Math.round(sr.width), h: Math.round(sr.height), inWin: sr.left >= 0 && sr.right <= innerWidth + 0.5 && sr.top >= 0 && sr.bottom <= innerHeight + 0.5, sx: body.scrollWidth - body.clientWidth, sy: body.scrollHeight - body.clientHeight, bad: bad };
  })()`);
  if (r.err) { problems++; console.log(`  ${label}: ${r.err}`); return; }
  const bad = !r.inWin || r.sx > 1 || r.bad.length;
  if (bad) { problems++; console.log(`  ${label}: OVERFLOW sheet ${r.w}x${r.h} inWindow=${r.inWin} sideways=${r.sx} wide=[${r.bad.join(', ')}]`); } else console.log(`  ${label}: ok (sheet ${r.w}x${r.h}, scrolls ${r.sy}px)`);
}
async function panels(g, tag) {
  for (const [name, label] of PANELS) {
    await ev(g, `BSU.ui.openPanel('${name}')`); await sleep(450);
    await shot(g, `${tag}-${name}`); await fits(g, `${tag} ${label}`);
    // the same panel again at the bottom of its scroll: nothing cut off
    const sy = await g.eval(`(function () { var b = document.getElementById('sheet-body'); b.scrollTop = b.scrollHeight; return b.scrollTop; })()`);
    if (sy > 40) { await sleep(150); await shot(g, `${tag}-${name}-end`); }
    if (name === 'season') {   // every Season tab inside the sheet
      for (const tab of ['staff', 'roster', 'recruiting', 'schedule', 'records']) {
        await g.eval(`(function () { var b = document.querySelector('#sea-tabs [data-tab="${tab}"]'); if (b) b.click(); document.getElementById('sheet-body').scrollTop = 0; return !!b; })()`); await sleep(350);
        await shot(g, `${tag}-season-${tab}`); await fits(g, `${tag} Season/${tab}`);
      }
      await g.eval(`(function () { var b = document.querySelector('#sea-tabs [data-tab="overview"]'); if (b) b.click(); return true; })()`);
    }
  }
  await rest(g);
}

// ---- 1440 × 900 at 100 % ----
{
  const g = await openGame({ width: 1440, height: 900, size: args.size, seed: 42, outDir: args.out, noGuard: true });
  try {
    await setUp(g, 1);
    await ev(g, `BSU.ui.openSheet(true)`); await sleep(400); await shot(g, '1-menu-list'); await fits(g, 'menu list'); await rest(g);
    await panels(g, '2-1440');
    // the inspect card (a dorm) and its pill
    await ev(g, `var b = BSU.state.buildings.filter(function (x) { return x && x.type === 'dorm'; })[0]; BSU.ui.inspect(BSU.state, { kind: 'building', id: b.id })`); await sleep(600); await shot(g, '3-inspect-card');
    await ev(g, `BSU.ui.collapseInspect(true)`); await sleep(400); await shot(g, '4-inspect-pill');
    await ev(g, `BSU.ui.collapseInspect(false); BSU.ui.openPanel('storm')`); await sleep(500); await shot(g, '4b-inspect-and-sheet'); await rest(g);
    // dialogs: the Board's proposal and a student voice
    const ids = await g.eval(`(BSU.data.boardCards || []).slice(0, 3).map(function (c) { return c.id; })`);
    await ev(g, `BSU.ui.card(BSU.state, 'board', { cards: ${JSON.stringify(ids)} })`); await sleep(500); await shot(g, '5-dialog-board'); await rest(g);
    await ev(g, `BSU.ui.card(BSU.state, 'voice', { id: 'u3voice', student: 'Marcus Boudreaux', major: 'Coastal Engineering', text: 'A boardwalk to the Dining Hall would keep our shoes dry. Could the university build one?', payoff: 'Accept: +40 applicants a year' })`); await sleep(500); await shot(g, '6-dialog-voice');
    await ev(g, `BSU.ui.card(BSU.state, 'newsflash', { name: 'Boudin', cat: 3, forecastCat: 3, landfallDay: 200 })`); await sleep(100);
    await rest(g);
    await check(g, '1440x900');
  } finally { await g.close(); }
}

// ---- 1280 × 800 at 130 % (the window caps it to ~114 %): every panel inside the sheet ----
{
  const g = await openGame({ width: 1280, height: 800, size: args.size, seed: 42, outDir: args.out, noGuard: true });
  try {
    await setUp(g, 1.3);
    console.log('1280x800: effective scale ' + (await g.eval(`BSU.ui.uiScaleEffective()`)));
    await ev(g, `BSU.ui.openSheet(true)`); await sleep(400); await shot(g, '7-1280-menu-list'); await fits(g, '1280 menu list'); await rest(g);
    await panels(g, '8-1280');
    await ev(g, `var b = BSU.state.buildings.filter(function (x) { return x && x.type === 'dorm'; })[0]; BSU.ui.inspect(BSU.state, { kind: 'building', id: b.id })`); await sleep(600); await shot(g, '9-1280-inspect');
    await check(g, '1280x800');
  } finally { await g.close(); }
}

killStrays();
console.log(`\n${written.length} screenshot(s) in ${args.out}${problems ? `; ${problems} problem(s)` : ''}`);
process.exit(problems ? 1 : 0);
