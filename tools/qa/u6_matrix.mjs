#!/usr/bin/env node
// UI refresh U6: the screenshot matrix. 1280 × 800 / 1440 × 900 / 1920 × 1080 × Display size 100 / 115 / 130 % × eight states
// (at rest · goal card open · Build sheet expanded · Menu sheet with Budget · a dialog · night · storm (a Cat 3 landfall) · hidden HUD) = 72 PNGs,
// `u6-<w>x<h>-<scale>-<state>.png` in tools/qa/out/. Each cell also measures that every base and transient surface sits inside the viewport, that
// no sheet overflows sideways, and that base surfaces (pill / card, FAB, inspect, alert strip, snackbars) overlap neither each other nor the bar (UI_STYLE §4); problems are printed and fail the run. Note: the window caps 130 % to ~114 % at 1280 × 800 (`BSU.ui.uiScaleEffective()`).
//   node tools/qa/u6_matrix.mjs [--prefix u6-] [--out dir] [--size 96|64] [--only 1280x800,1440x900,1920x1080] [--states rest,goal,...]
// One headless Chrome per viewport (the campus is built once per Chrome; the storm runs once and is shot at the three scales while paused).
import { openGame, parseArgs, DEFAULT_OUT, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { prefix: { type: 'str', def: 'u6-' }, out: { type: 'str', def: DEFAULT_OUT }, size: { type: 'num', def: 96 }, only: { type: 'list', def: [] }, states: { type: 'list', def: [] } });
killStrays();
const written = []; let problems = 0;
const ev = (g, js) => g.eval(`(function () { ${js}; return true; })()`);
const bad = (label, msg) => { problems++; console.log(`  ${label}: ${msg}`); };
const shot = async (g, name) => { const p = await g.shot(args.prefix + name); written.push(p); };
async function rest(g) { await ev(g, `BSU.ui.closePopover(); BSU.ui.goalOpen(false); BSU.ui.openPalette(false); BSU.ui.dismissNotifs(); BSU.ui.closeInspect(); while (BSU.ui.closeCard && BSU.ui.cardOpen && BSU.ui.cardOpen()) BSU.ui.closeCard(); if (BSU.ui.buildMenuOpen()) BSU.ui.closeBuildMenu(); BSU.ui.openPanel(null); if (BSU.ui.hudMode() !== 'full') BSU.ui.setHudMode('full'); var h = document.getElementById('hint'); if (h) h.classList.add('hidden')`); await sleep(350); }   // the hint: the 3.5 s "HUD hidden" line would linger into the next cell
/** every visible surface inside the viewport; the Menu / Build sheets and the dialog never overflow sideways */
async function fits(g, label) {
  const r = await g.eval(`(function () {
    var vw = innerWidth, vh = innerHeight, out = [];
    var sels = ['#topbar', '#goal-pill', '#objective-card', '#fab-build', '#snack-lane .snackbar', '.popover', '#menu-sheet', '#palette', '#build-menu', '#cards .card', '#voice-dialog', '.coach-box', '.title-box', '#inspect', '#alert-strip', '#undo-chip', '#hint', '#hud-chip'];
    sels.forEach(function (sel) { document.querySelectorAll(sel).forEach(function (e) {
      var cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.classList.contains('hidden')) return; var p = e; while (p) { if (p.classList && p.classList.contains('hidden')) return; p = p.parentElement; }
      var q = e.getBoundingClientRect(); if (!q.width || !q.height) return;
      if (q.left < -0.5 || q.top < -0.5 || q.right > vw + 0.5 || q.bottom > vh + 0.5) out.push((e.id ? '#' + e.id : sel) + ' [' + Math.round(q.left) + ',' + Math.round(q.top) + ' ' + Math.round(q.right) + ',' + Math.round(q.bottom) + '] outside ' + vw + 'x' + vh);
      if (e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && !/palette-items|bm-cards/.test(e.id)) out.push((e.id ? '#' + e.id : sel) + ' overflows sideways by ' + (e.scrollWidth - e.clientWidth) + 'px');
    }); });
    var body = document.getElementById('sheet-body'); if (body && body.offsetParent !== null && body.scrollWidth > body.clientWidth + 1) out.push('#sheet-body sideways ' + (body.scrollWidth - body.clientWidth) + 'px');
    // UI_STYLE §4: base surfaces never overlap each other or the bar; transient surfaces may cover base ones but never the bar
    function rect(sel) { var e = document.querySelector(sel); if (!e) return null; var cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.classList.contains('hidden')) return null; var p = e; while (p) { if (p.classList && p.classList.contains('hidden')) return null; p = p.parentElement; } var q = e.getBoundingClientRect(); return q.width && q.height ? { sel: sel, l: q.left, t: q.top, r: q.right, b: q.bottom } : null; }
    function hits(a, b) { return a && b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1; }
    var bar = rect('#topbar'), base = ['#goal-pill', '#objective-card', '#fab-build', '#inspect', '#alert-strip', '#snack-lane .snackbar', '#undo-chip', '#hud-chip'].map(rect).filter(Boolean);
    var trans = ['.popover:not(.hidden)', '#menu-sheet', '#palette', '#build-menu', '#cards .card', '#voice-dialog', '.coach-box'].map(rect).filter(Boolean);
    for (var i = 0; i < base.length; i++) { if (hits(base[i], bar)) out.push(base[i].sel + ' overlaps the app bar'); for (var j = i + 1; j < base.length; j++) if (hits(base[i], base[j])) out.push(base[i].sel + ' overlaps ' + base[j].sel); }
    for (var k = 0; k < trans.length; k++) { if (hits(trans[k], bar) && trans[k].sel !== '#cards .card') out.push(trans[k].sel + ' overlaps the app bar'); }
    return out;
  })()`);
  if (r.length) bad(label, r.join('; ')); else console.log(`  ${label}: ok`);
}

const SIZES = [[1280, 800], [1440, 900], [1920, 1080]].filter(([w, h]) => !args.only.length || args.only.includes(w + 'x' + h));
const SCALES = [[1, '100'], [1.15, '115'], [1.3, '130']];
const STATES = ['rest', 'goal', 'build', 'menu-budget', 'dialog', 'night', 'storm', 'hud-hidden'].filter((s) => !args.states.length || args.states.includes(s));
for (const [w, h] of SIZES) {
  const g = await openGame({ width: w, height: h, size: args.size, seed: 42, outDir: args.out, noGuard: true });
  try {
    await g.buildCampus({ target: 30, days: 30, students: 1500, stadium: true });
    await g.noGuard();
    await ev(g, `BSU.session.setSpeed(BSU.state, 0, 'user'); BSU.weather.scriptSky(BSU.state, 1, 0.4)`);
    await g.frameCampus(1, { keepOnMap: false }); await g.waitBake({ timeoutMs: 45000 }); await g.settleCamera(); await rest(g);
    const ids = await g.eval(`(BSU.data.boardCards || []).slice(0, 3).map(function (c) { return c.id; })`);
    for (const [sc, tag] of SCALES) {
      await ev(g, `BSU.ui.setUiScale(${sc})`); await sleep(250); await rest(g);
      const eff = await g.eval(`BSU.ui.uiScaleEffective()`);
      const cell = (st) => `${w}x${h}-${tag}-${st}`;
      console.log(`${w}x${h} @ ${tag} % (effective ${eff})`);
      if (STATES.includes('rest')) { await shot(g, cell('rest')); await fits(g, cell('rest')); }
      if (STATES.includes('goal')) { await ev(g, `BSU.ui.goalOpen(true)`); await sleep(500); await shot(g, cell('goal')); await fits(g, cell('goal')); await rest(g); }
      if (STATES.includes('build')) { await ev(g, `BSU.ui.openBuildMenu(BSU.state, { tab: 'housing' })`); await sleep(400); await ev(g, `BSU.ui.focusCard('dorm')`); await sleep(400); await shot(g, cell('build')); await fits(g, cell('build')); await rest(g); }
      if (STATES.includes('menu-budget')) { await ev(g, `BSU.ui.openPanel('budget')`); await sleep(500); await shot(g, cell('menu-budget')); await fits(g, cell('menu-budget')); await rest(g); }
      if (STATES.includes('dialog')) { await ev(g, `BSU.ui.card(BSU.state, 'board', { cards: ${JSON.stringify(ids)} })`); await sleep(500); await shot(g, cell('dialog')); await fits(g, cell('dialog')); await rest(g); }
      if (STATES.includes('night')) { await ev(g, `BSU.weather.scriptSky(BSU.state, 4, 0.5)`); await sleep(700); await shot(g, cell('night')); await fits(g, cell('night')); await ev(g, `BSU.weather.scriptSky(BSU.state, 1, 0.4)`); await sleep(300); }
      if (STATES.includes('hud-hidden')) { await g.key('h'); await sleep(500); await shot(g, cell('hud-hidden')); await fits(g, cell('hud-hidden')); await g.key('h', { shift: true }); await sleep(300); await rest(g); }
    }
    if (STATES.includes('storm')) {
      // one landfall, paused at its middle, shot at the three scales
      await ev(g, `BSU.ui.setUiScale(1); BSU.session.setSpeed(BSU.state, 1, 'user'); BSU.state.sky.scripted && BSU.weather.releaseSky(BSU.state); BSU.headless.forceHurricane(3)`);
      let got = false;
      await g.run(5200, { slice: 40, frameMs: 25, each: async () => { const r = await g.eval(`(function () { var sp = BSU.state.setPiece; return sp && sp.kind === 'landfall' ? sp.tick : -1; })()`); got = r > 320; return got; } });
      if (!got) bad(`${w}x${h} storm`, 'the landfall set piece never reached its middle');
      else {
        await ev(g, `BSU.render.captureCameraTouch(BSU.state)`); await g.frameCampus(1, { keepOnMap: false }); await g.key('n'); await sleep(700);
        await ev(g, `BSU.session.setSpeed(BSU.state, 0, 'user')`); await sleep(300);
        for (const [sc, tag] of SCALES) { await ev(g, `BSU.ui.setUiScale(${sc})`); await sleep(400); await shot(g, `${w}x${h}-${tag}-storm`); await fits(g, `${w}x${h}-${tag}-storm`); }
      }
    }
    const errs = await g.errorsSince(); if (errs.length) bad(`${w}x${h}`, errs.length + ' error(s): ' + errs[0]);
    for (const n of g.notes.splice(0)) console.log(`  ${w}x${h}: note: ${n}`);
  } finally { await g.close(); }
}
killStrays();
console.log(`\n${written.length} screenshot(s) in ${args.out}${problems ? `; ${problems} problem(s)` : ''}`);
process.exit(problems ? 1 : 0);
