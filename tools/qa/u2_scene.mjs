#!/usr/bin/env node
// UI refresh U2 scene: the at-rest screen and every popover, shot on the real game in headless Chrome (tools/qa/lib.mjs openGame).
//   node tools/qa/u2_scene.mjs [--prefix u2-] [--out dir] [--size 96|64]
// 1440 × 900 at 100 %: at rest, the goal card, the needs popover, the mini budget, Alerts (the campus starved of power), Layers (Flood on),
// Map pinned, the Build sheet via the FAB, two snackbars, the decision snackbar, the Menu popover, the hidden HUD; then at rest, the goal card
// and the sheet at 1280 × 800 / 130 % (the window caps it) and 1920 × 1080 / 100 %. One headless Chrome at a time; strays are killed first.
import { openGame, parseArgs, DEFAULT_OUT, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { prefix: { type: 'str', def: 'u2-' }, out: { type: 'str', def: DEFAULT_OUT }, size: { type: 'num', def: 96 } });
killStrays();
const written = []; let problems = 0;
const ev = (g, js) => g.eval(`(function () { ${js}; return true; })()`);
const shot = async (g, name) => { const p = await g.shot(args.prefix + name); written.push(p); console.log('shot', p); };
const check = async (g, label) => { const errs = await g.bsuErrors(); if (errs.length) { problems++; console.log(`  ${label}: BSU.error ${errs.join(' | ')}`); } };
/** a campus to look at: the dense campus, the camera on it, the sim paused on a clear midday so every frame is the same */
async function setUp(g, scale) {
  await ev(g, `BSU.ui.setUiScale(${scale || 1})`); await sleep(150);   // explicit: the Auto default would pick 115 % at 1440 and 130 % at 1920
  await g.buildCampus({ target: 30, days: 30, students: 1500 });
  await g.noGuard();
  await ev(g, `BSU.session.setSpeed(BSU.state, 0, 'user'); BSU.weather.scriptSky(BSU.state, 1, 0.4)`);
  await g.frameCampus(1, { keepOnMap: false }); await g.waitBake({ timeoutMs: 45000 }); await g.settleCamera();
  await rest(g); await sleep(400);
}
/** back to the at-rest screen: no popover, the pill, no sheet, an empty lane */
async function rest(g) { await ev(g, `BSU.ui.closePopover(); BSU.ui.goalOpen(false); BSU.ui.openPalette(false); BSU.ui.dismissNotifs(); BSU.ui.closeInspect(); if (BSU.ui.buildMenuOpen()) BSU.ui.closeBuildMenu(); if (BSU.state.ui.panel) BSU.ui.openPanel(null)`); await sleep(120); }

// ---- 1440 × 900 at 100 %: the full set ----
{
  const g = await openGame({ width: 1440, height: 900, size: args.size, seed: 42, outDir: args.out, noGuard: true });
  try {
    await setUp(g, 1);
    await shot(g, '1-rest');
    await ev(g, `BSU.ui.goalOpen(true)`); await sleep(400); await shot(g, '2-goal-card'); await rest(g);
    await ev(g, `BSU.ui.openPopover('needs')`); await sleep(400); await shot(g, '3-needs'); await rest(g);
    await ev(g, `BSU.ui.openPopover('budget')`); await sleep(600); await shot(g, '4-budget'); await rest(g);
    // Alerts with at least two issues: every substation goes, so the powered buildings raise unpowered rows (and the Students chip's dot)
    const nIssues = await g.eval(`(function () { var s = BSU.state; s.buildings.filter(function (b) { return b && b.type === 'substation'; }).forEach(function (b) { BSU.buildings.remove(s, b.id, 'demolish'); }); BSU.buildings.recomputeCoverage(s); BSU.issues.invalidate(); BSU.headless.tick(2); return BSU.issues.main(s).length; })()`);
    if (nIssues < 2) { problems++; console.log('  alerts: only ' + nIssues + ' issue(s) after cutting the power'); }
    await ev(g, `BSU.session.setSpeed(BSU.state, 0, 'user')`); await sleep(400);
    await ev(g, `BSU.ui.openPopover('alerts')`); await sleep(500); await shot(g, '5-alerts'); await rest(g);
    await ev(g, `BSU.ui.setOverlay(BSU.state, BSU.OV.FLOOD); BSU.ui.openPopover('layers')`); await sleep(500); await shot(g, '6-layers'); await ev(g, `BSU.ui.setOverlay(BSU.state, BSU.OV.NONE)`); await rest(g);
    await ev(g, `BSU.ui.openPopover('map'); BSU.ui.pinMinimap(true)`); await sleep(500); await shot(g, '7-map-pinned'); await ev(g, `BSU.ui.pinMinimap(false)`); await rest(g);
    if (!(await g.clickEl('#fab-build'))) { problems++; console.log('  the Build FAB is not clickable'); }
    await sleep(500); await shot(g, '8-sheet'); await g.key('Escape'); await rest(g);
    await ev(g, `BSU.ui.notify(BSU.state, { kind: 'info', text: 'Saved', ttl: 20000 }); BSU.ui.notify(BSU.state, { kind: 'wildlife', text: 'Marie spotted on the bank by the Dining Hall.', ttl: 20000, showMe: { tx: 32, ty: 32 } })`); await sleep(500); await shot(g, '9-snackbars'); await rest(g);
    await ev(g, `BSU.ui.notify(BSU.state, { kind: 'wildlife', text: 'Marie spotted on the bank by the Dining Hall.', ttl: 20000 }); BSU.ui.decision(BSU.state, { id: 'u2dec', text: 'Cove levee at 72 % — emergency sandbag crew, $120k? (+1 ft crest through the peak)', ticks: 900, yes: 'Send the crew', no: 'Hold' }); BSU.state.tick += 360`); await sleep(500); await shot(g, '10-decision'); await ev(g, `BSU.ui.answerDecision('u2dec', 'no')`); await rest(g);
    await ev(g, `BSU.ui.openPopover('menu')`); await sleep(400); await shot(g, '11-menu'); await rest(g);
    await g.key('h'); await sleep(400); await shot(g, '12-hidden'); await g.key('h', { shift: true }); await sleep(300);
    if ((await g.eval(`BSU.ui.hudMode()`)) !== 'full') { problems++; console.log('  Shift+H did not restore the HUD'); }
    await check(g, '1440x900');
  } finally { await g.close(); }
}

// ---- 1280 × 800 at 130 % (the window caps it) and 1920 × 1080 at 100 %: at rest, the goal card, the sheet ----
for (const [w, h, sc, tag] of [[1280, 800, 1.3, '1280x800-130'], [1920, 1080, 1, '1920x1080-100']]) {
  const g = await openGame({ width: w, height: h, size: args.size, seed: 42, outDir: args.out, noGuard: true });
  try {
    await setUp(g, sc);
    console.log(tag + ': effective scale ' + (await g.eval(`BSU.ui.uiScaleEffective()`)));
    await shot(g, tag + '-rest');
    await ev(g, `BSU.ui.goalOpen(true)`); await sleep(400); await shot(g, tag + '-goal-card'); await rest(g);
    await ev(g, `BSU.ui.openPalette(true)`); await sleep(500); await shot(g, tag + '-sheet'); await rest(g);
    const bar = await g.eval(`(function () { var t = document.getElementById('topbar'); return { sw: t.scrollWidth, cw: t.clientWidth, cls: t.className }; })()`);
    if (bar.sw > bar.cw + 1) { problems++; console.log(`  ${tag}: the app bar overflows (${bar.sw} > ${bar.cw}, ${bar.cls})`); } else console.log(`${tag}: app bar fits (${bar.sw} of ${bar.cw}${bar.cls ? ', ' + bar.cls : ''})`);
    await check(g, tag);
  } finally { await g.close(); }
}

killStrays();
console.log(`\n${written.length} screenshot(s) in ${args.out}${problems ? `; ${problems} problem(s)` : ''}`);
process.exit(problems ? 1 : 0);
