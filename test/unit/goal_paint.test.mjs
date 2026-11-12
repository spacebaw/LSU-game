// Unit test for the goal pass (Josh's playtest note on "Preserve it"): (1) a 'paint' row (Wetland Preserve) is a run tool in the input
// machine: a drag fills the rectangle from the anchor to the cursor (Shift = a straight line, each side capped at 12), a single click
// paints one tile, and the tool stays armed either way; the 'drag' rows still plan their L; (2) a click-placement keeps its tool while
// cb.keepArmed() says the goal still counts placements of it; (3) data.guide marks the counted goals (repeat), Objective 16 counts every
// preserved tile (not only the rows south of the founders' plot), progress.goalProgress evaluates a goal now, and Show me lands on a
// tile the Preserve can be painted on; (4) ui._ux.goalKeepsTool on a live game: Objective 6 keeps the Live Oak armed, nothing else.
// Usage: node build.mjs --check && node test/unit/goal_paint.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { win } = loadGame();
const BSU = win.BSU, U = BSU.ui, PR = BSU.progress, B = BSU.buildings;
BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
const s = BSU.state, W = 64, N = W * W;
const M0 = { ctrl: false, shift: false, meta: false, alt: false }, SH = { ctrl: false, shift: true, meta: false, alt: false };

// --- (1) the machine: paint = a filled rectangle, armed afterwards --------------------------------------------------------------
console.log('--- (1) paint drag ---');
{
  const T = (x, y) => ({ px: x * 20 + 10, py: y * 11 + 5 }), I = (x, y) => y * W + x;
  const runs = []; let tool = null, keep = false, placed = 0;
  const mk = () => U._machine({ getTool: () => tool, setTool: t => { tool = t; }, placeRun: r => { runs.push(r.slice()); }, place: () => { placed++; return true; }, keepArmed: () => keep });
  const down = (m, x, y) => m.step({ type: 'down', ...T(x, y), button: 0, mods: M0 });
  const move = (m, x, y, mods) => m.step({ type: 'move', ...T(x, y), button: 0, mods: mods || M0 });
  const up = (m, x, y) => m.step({ type: 'up', ...T(x, y), button: 0, mods: M0 });

  let m = mk(); m.step({ type: 'tool', id: 'preserve' });
  eq(m.state, 'PLACING', 'arming the Preserve enters PLACING');
  down(m, 5, 5); eq(m.state, 'DRAGGING', 'a press with the Preserve starts a run (it is a run tool now)');
  move(m, 8, 7);
  eq(m.run.length, 12, 'anchor (5,5) → cursor (8,7) fills the 4 × 3 rectangle');
  ok(m.run[0] === I(5, 5) && m.run[11] === I(8, 7) && m.run.includes(I(6, 6)) && m.run.includes(I(8, 5)) && m.run.includes(I(5, 7)), 'the rectangle starts at the anchor, ends at the cursor and holds its interior and corners');
  eq(new Set(m.run).size, 12, 'no tile twice');
  move(m, 6, 5); eq(m.run.length, 2, 'dragging back shrinks the rectangle');
  move(m, 8, 7); up(m, 8, 7);
  ok(runs.length === 1 && runs[0].length === 12, 'release hands the 12 tiles to placeRun');
  ok(m.state === 'PLACING' && tool && tool.id === 'preserve', 'the Preserve stays armed after the drag');

  down(m, 10, 10); up(m, 10, 10);
  ok(runs.length === 2 && runs[1].length === 1 && runs[1][0] === I(10, 10), 'a single click paints one tile through placeRun');
  ok(tool && tool.id === 'preserve' && placed === 0, 'and keeps the tool (the old click-place that disarmed it is not used)');

  down(m, 20, 20); move(m, 18, 19);
  ok(m.run.length === 6 && m.run[0] === I(20, 20) && m.run[5] === I(18, 19), 'up and to the left: a 3 × 2 rectangle from the anchor');
  up(m, 18, 19);

  down(m, 2, 2); move(m, 40, 30);
  eq(m.run.length, 144, 'a huge drag is capped at 12 × 12');
  ok(m.run.every(i => (i % W) <= 13 && ((i / W) | 0) <= 13), 'the cap keeps the rectangle within 12 tiles of the anchor on each axis');
  move(m, 8, 4, SH);
  ok(m.run.length > 1 && (m.run.every(i => ((i / W) | 0) === 2) || m.run.every(i => (i % W) === 2)), 'Shift = an axis-locked straight line, as for every run tool');
  m.step({ type: 'key', key: 'Escape', mods: M0 }); up(m, 8, 4);

  tool = null; m = mk(); m.step({ type: 'tool', id: 'path' }); down(m, 5, 5); move(m, 8, 7);
  eq(m.run.length, 6, 'a path still plans its L (3 across + 2 down + the anchor), not a rectangle');
  up(m, 8, 7);

  // --- (2) click placements and cb.keepArmed
  console.log('--- (2) keepArmed ---');
  tool = null; placed = 0; m = mk(); m.step({ type: 'tool', id: 'live_oak' });
  down(m, 5, 5); up(m, 5, 5);
  ok(placed === 1 && tool === null, 'a footprint click disarms the tool when keepArmed says no (as before)');
  keep = true; m.step({ type: 'tool', id: 'live_oak' }); down(m, 6, 5); up(m, 6, 5);
  ok(placed === 2 && tool && tool.id === 'live_oak' && m.state === 'PLACING', 'keepArmed → the tool stays armed after the placement');
  keep = false; down(m, 7, 5); up(m, 7, 5);
  ok(placed === 3 && tool === null, 'the count is met (keepArmed false again) → the next placement disarms');
  const m2 = U._machine({ getTool: () => tool, setTool: t => { tool = t; }, place: () => true });
  m2.step({ type: 'tool', id: 'live_oak' }); m2.step({ type: 'down', ...T(5, 5), button: 0, mods: M0 }); m2.step({ type: 'up', ...T(5, 5), button: 0, mods: M0 });
  ok(tool === null, 'a machine without a keepArmed callback behaves as before');
}

// --- (3) data + progress ---------------------------------------------------------------------------------------------------------
console.log('--- (3) Objective 16 counts every preserved tile ---');
{
  const guide = BSU.data.guide, objs = BSU.data.objectives || {};
  ok(guide['6'].repeat === true && guide['16'].repeat === true, 'guide 6 (Live Oaks) and 16 (Preserve) are counted goals (repeat)');
  ok(!guide['8'].repeat && !guide['3'].repeat && !guide['22'].repeat, 'the student / composite goals are not');
  const text16 = [String((objs['16'] || {}).text || '')];
  ok(U._machine().mc.cb.isArea('preserve') === true && U._machine().mc.cb.isDrag('preserve') === true && U._machine().mc.cb.isArea('path') === false, 'Wetland Preserve is an area (paint) run row; a path is a run row but not an area');
  ok(text16 && !/south/i.test(text16[0]) && /drag/i.test(text16[0]), 'the goal text drops "south of campus" and says to drag: ' + (text16 && text16[0]));
  void objs;

  ok(typeof PR.goalProgress === 'function', 'progress.goalProgress exists');
  const g0 = PR.goalProgress(s, '16');
  ok(g0 && g0.goal === 20 && g0.progress === 0, 'goalProgress(16) = 0 / 20 on a fresh campus');
  eq(PR.goalProgress(s, 'no-such-goal'), null, 'an unknown id → null');
  const rect = s.plot.rect, fl = s.tiles.flags, PRES = BSU.FLAG.PRESERVE;
  // a tile on row 0 is north of everything: the old rule (rows south of the plot only) never counted it
  ok(rect.y1 > 0, 'the founders\' plot is not on row 0');
  fl[3] |= PRES;
  eq(PR.goalProgress(s, '16').progress, 1, 'a preserved tile north of the plot counts');
  fl[N - 2] |= PRES;
  eq(PR.goalProgress(s, '16').progress, 2, 'and so does one south of it');
  fl[3] &= ~PRES; fl[N - 2] &= ~PRES;
  eq(PR.goalProgress(s, '16').progress, 0, 'clearing them clears the count');

  // real placements through placeRun, wherever the Preserve is legal
  const legal = [];
  for (let i = 0; i < N && legal.length < 30; i++) { const r = B.canPlace(s, 'preserve', i % W, (i / W) | 0, { ignoreCash: true }); if (r && r.ok) legal.push(i); }
  ok(legal.length > 0, 'the map has marsh the Preserve can be painted on (' + legal.length + ' found)');
  if (legal.length) {
    const t = PR.showMe(s, '16');
    const r = t ? B.canPlace(s, 'preserve', t.tx, t.ty, { ignoreCash: true }) : null;
    ok(r && r.ok, 'Show me for Objective 16 lands on a tile the Preserve can be painted on');
    const before = PR.goalProgress(s, '16').progress;
    const out = B.placeRun(s, 'preserve', legal.slice(0, 25), {});
    ok(out && out.placed > 0, 'placeRun paints the run (' + (out && out.placed) + ' tiles)');
    eq(PR.goalProgress(s, '16').progress, Math.min(20, before + out.placed), 'every painted tile counts, capped at the goal');
  }
}

// --- (4) the live rule: ui._ux.goalKeepsTool ---------------------------------------------------------------------------------------
console.log('--- (4) goalKeepsTool ---');
{
  BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
  const g = BSU.state; U.showTitle(false);
  for (let k = 0; k < 4; k++) BSU.sim && typeof BSU.sim.tick === 'function' ? BSU.sim.tick(g) : PR.tick(g);
  const o = PR.objective(g);
  ok(o && o.id === '6', 'after skipTutorial the active goal is Objective 6 (' + (o && o.id) + ')');
  const K = U._ux.goalKeepsTool;
  ok(typeof K === 'function', 'ui._ux.goalKeepsTool is exposed for tests');
  g.ui.tool = null; eq(K(g), false, 'no tool → false');
  g.ui.tool = { id: 'live_oak', rot: 0 }; eq(K(g), true, 'Objective 6 active, 0 / 5 oaks, Live Oak armed → keep it');
  g.ui.tool = { id: 'dorm', rot: 0 }; eq(K(g), false, 'another tool → false');
  g.ui.tool = { id: 'live_oak', rot: 0 };
  const real = PR.goalProgress; PR.goalProgress = () => ({ progress: 5, goal: 5 });
  eq(K(g), false, 'the count is met → false');
  PR.goalProgress = () => ({ progress: 4, goal: 5 });
  eq(K(g), true, '4 / 5 → still armed');
  PR.goalProgress = real;
  PR.complete(g, '6'); for (let k = 0; k < 4; k++) BSU.sim && typeof BSU.sim.tick === 'function' ? BSU.sim.tick(g) : PR.tick(g);
  const o7 = PR.objective(g), tgt = o7 ? U._ux.objTarget(g, o7) : null;
  ok(o7 && o7.id !== '6' && !(BSU.data.guide[o7.id] || {}).repeat, 'the next goal (' + (o7 && o7.id) + ') is not a counted one');
  if (tgt) { g.ui.tool = { id: tgt, rot: 0 }; eq(K(g), false, 'a goal without repeat never keeps its tool (' + tgt + ')'); }
  g.ui.tool = null;
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
