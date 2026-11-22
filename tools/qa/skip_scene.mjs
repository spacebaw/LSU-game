// Skip pass scene (Josh: "the skip button in the lower right never seems to work"). Clicks the real #btn-skip during each kind of set
// piece and checks the set piece ends at once: a full game before and after kickoff, a paused game, a parade, a near miss, a Spring Game.
// Usage: node tools/qa/skip_scene.mjs [--strict] [--index tools/qa/out/index-before.html]   (one headless Chrome; --strict exits 1 on a problem)
import { openGame, parseArgs, DEFAULT_OUT, killStrays, resolveIndex } from './lib.mjs';
const args = parseArgs(process.argv.slice(2), { size: { type: 'num', def: 96 }, out: { type: 'str', def: DEFAULT_OUT }, index: { type: 'str', def: '' }, strict: { type: 'bool', def: false } });
killStrays();
let problems = 0; const bad = (m) => { problems++; console.log('  PROBLEM: ' + m); };
const g = await openGame({ width: 1440, height: 900, size: args.size, seed: 42, outDir: args.out, noGuard: true, index: resolveIndex(args.index) });
const st = () => g.eval(`(function () { var s = BSU.state, sp = s.setPiece, b = document.getElementById('btn-skip'), r = b.getBoundingClientRect(), vis = !b.classList.contains('hidden') && r.width > 0, top = vis ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null; return { kind: sp ? sp.kind : null, tick: sp ? sp.tick : -1, len: sp ? sp.len : -1, vis: vis, hit: top ? (top.id || top.tagName) : null, speed: s.ui.speed }; })()`);
// a real click at the button's centre, on whatever element is on top there; no sim ticks are run for the caller
const clickSkip = () => g.eval(`(function () { var b = document.getElementById('btn-skip'), r = b.getBoundingClientRect(); if (b.classList.contains('hidden') || !r.width) return null; var x = r.left + r.width / 2, y = r.top + r.height / 2, t = document.elementFromPoint(x, y); if (!t) return null; ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (n) { t.dispatchEvent(new MouseEvent(n, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); }); return t.id || t.tagName; })()`);
const toTick = async (want) => { let s = await st(), n = 0; while (s.kind && s.tick < want && n++ < 600) { await g.tick(Math.min(5, want - s.tick)); s = await st(); } return s; };
const end = () => g.eval(`(BSU.state.setPiece && BSU.session.endSetPiece(BSU.state), BSU.session.setSpeed(BSU.state, 1, 'user'), true)`);
const start = (k, len) => g.eval(`(function () { try { return BSU.session.startSetPiece(BSU.state, '${k}', { len: ${len}, skippable: true }); } catch (e) { return 'ERR ' + e.message; } })()`);
async function expectSkips(name) {
  const before = await st(), hit = await clickSkip(), after = await st();
  console.log('  ' + name + ': tick ' + before.tick + ' / ' + before.len + ' · button ' + (before.vis ? 'shown' : 'hidden') + ' · click on ' + JSON.stringify(hit) + ' -> ' + (after.kind ? 'STILL ' + after.kind + ' at tick ' + after.tick : 'ended'));
  if (!before.vis) bad(name + ': the Skip button is not shown'); else if (hit !== 'btn-skip') bad(name + ': something covers the Skip button (' + hit + ')'); else if (after.kind) bad(name + ': one click on Skip did not end the set piece');
}
try {
  await g.buildCampus({ target: 20, days: 30, students: 2500, stadium: true });
  await g.eval(`(function () { var p = BSU.state.progress; p.setPiecesSeen = p.setPiecesSeen || {}; ['game', 'spring', 'landfall', 'parade', 'graduation', 'nearMiss', 'montage'].forEach(function (k) { p.setPiecesSeen[k] = true; }); return true; })()`);
  const kick = await g.eval(`BSU.params.sports.kickoffTick`), skipAt = await g.eval(`BSU.params.time.skipAfterTick`);
  console.log('full game (Skip may show from tick ' + skipAt + '; kickoff at ' + kick + ')');
  const r = await g.eval(`(function () { try { return BSU.sports.playHome(BSU.state); } catch (e) { return { ok: false, reason: e.message }; } })()`);
  if (!r || !r.ok) bad('no home game could be started: ' + (r && r.reason));
  else {
    let s = await toTick(skipAt + 10);
    if (s.kind !== 'game') bad('expected a full game, got ' + s.kind);
    else {
      // before kickoff the owner refuses a skip, so the button must not be offered (it used to show and do nothing)
      if (s.tick < kick) { const hit = await clickSkip(), a = await st(); console.log('  before kickoff: tick ' + s.tick + ' · button ' + (s.vis ? 'shown' : 'hidden') + (s.vis ? ' · click -> ' + (a.kind ? 'STILL ' + a.kind : 'ended') : '')); if (s.vis && a.kind) bad('before kickoff the Skip button is shown and does nothing'); }
      if ((await st()).kind) { await toTick(kick + 5); await expectSkips('after kickoff'); }
    }
  }
  await end();
  console.log('paused');
  console.log('  start parade ->', await start('parade', 250)); await toTick(skipAt + 5);
  await g.eval(`(BSU.session.setSpeed(BSU.state, 0, 'user'), true)`);
  await expectSkips('parade while paused (speed ' + (await st()).speed + ')');
  await end();
  for (const [k, len] of [['nearMiss', 300], ['spring', 300], ['graduation', 220]]) { console.log(k); console.log('  start ->', await start(k, len)); await toTick(skipAt + 2); await expectSkips(k); await end(); }
  const errs = await g.bsuErrors(); if (errs && errs.length) bad('BSU errors: ' + JSON.stringify(errs).slice(0, 300));
} finally { await g.close(); }
killStrays();
console.log(problems ? problems + ' problem(s)' : 'ALL OK');
process.exit(problems && args.strict ? 1 : 0);
