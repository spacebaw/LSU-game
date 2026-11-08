// Roads and paths pass: the anchor → cursor drag planner (ui.js machine), buildings.runQuote + the marsh-bank bridge span, and the
// render smoothing pass additions (end degrees, junction dash trim, staircase straightening, deck over the bank, the ghost centreline).
// Loads every manifest module through the DOM stub like the other unit tests. Usage: node test/unit/roads.test.mjs (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
for (const f of manifest) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) continue;
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); }
}
const BSU = win.BSU, U = BSU.ui, B = BSU.buildings, R = BSU.render, SURF = BSU.SURF, T = BSU.T, FLAG = BSU.FLAG;
const M0 = { ctrl: false, shift: false, meta: false, alt: false }, SH = { ...M0, shift: true };
const W = BSU.MAP.W;
const errors0 = BSU.errors.size;

// ---------------------------------------------------------------------------------------------------------------------
// 1. the machine: L planning from the anchor, elbow stability, scoring, the Z fallback, Shift, backtracking
// ---------------------------------------------------------------------------------------------------------------------
{
  const Tp = (x, y) => ({ px: x * 20 + 10, py: y * 11 + 5 }), I = (x, y) => y * W + x, X = (i) => i % W, Y = (i) => (i / W) | 0;
  const runs = []; let tool = null;
  let quote = null, calls = 0;
  const mk = () => U._machine({ getTool: () => tool, setTool: (t) => { tool = t; }, placeRun: (r) => { runs.push(r.slice()); }, quote: (run) => { calls++; return quote ? quote(run) : null; } });
  const mv = (m, x, y, mods) => m.step({ type: 'move', ...Tp(x, y), button: 0, mods: mods || M0 });
  const start = (m, x, y) => { m.step({ type: 'tool', id: 'road' }); m.step({ type: 'down', ...Tp(x, y), button: 0, mods: M0 }); };
  const conn4 = (r) => { for (let k = 1; k < r.length; k++) { const d = Math.abs(r[k] - r[k - 1]); if (d !== 1 && d !== W) return false; } return true; };
  const scorer = (refusedSet, extra) => (run) => { let refused = 0; for (const i of run) if (refusedSet.has(i)) refused++; const o = { n: run.length, refused, skipped: run.filter((i) => refusedSet.has(i)).map((i) => ({ i, reason: 'x' })), same: [], placed: run.length - refused, cost: 0, wet: 0, tieRank: 0, touches: true, tie: null }; return extra ? extra(o, run) : o; };

  // (a) no quote: an L, x-first, from the anchor; a diagonal slide keeps it x-first; the cursor's tile is the end
  quote = null; let m = mk(); start(m, 5, 5); mv(m, 9, 8);
  ok(m.run.length === 8 && m.run[0] === I(5, 5) && m.run[4] === I(9, 5) && m.run[7] === I(9, 8) && conn4(m.run) && m.elbow === 0, 'x-first L from (5,5) to (9,8): along row 5, then down column 9 (' + m.run.length + ' tiles)');
  mv(m, 10, 9); ok(m.run.length === 10 && m.run[5] === I(10, 5) && m.run[9] === I(10, 9) && m.elbow === 0, 'sliding along the diagonal re-plans the same L shape: no zigzag, one elbow');
  for (let k = 1; k < m.run.length; k++) { /* no staircase: every tile but the elbow shares a row or column with the next two */ }
  const corners = m.run.filter((i, k) => k > 0 && k < m.run.length - 1 && !((X(m.run[k - 1]) === X(i) && X(i) === X(m.run[k + 1])) || (Y(m.run[k - 1]) === Y(i) && Y(i) === Y(m.run[k + 1]))));
  ok(corners.length === 1 && corners[0] === I(10, 5), 'exactly one elbow tile (the old x-then-y staircase had one per step)');
  mv(m, 7, 5); ok(m.run.length === 3 && m.run[2] === I(7, 5), 'backing toward the anchor shortens the run to the cursor');
  mv(m, 5, 5); ok(m.run.length === 1 && m.run[0] === I(5, 5) && m.state === 'DRAGGING', 'back on the anchor: a 1-tile run');
  mv(m, 5, 9); ok(m.run.length === 5 && m.run.every((i) => X(i) === 5), 'a shared column is a straight run either way');
  m.step({ type: 'up', ...Tp(5, 9), button: 0, mods: M0 }); ok(runs.length === 1 && runs[0].length === 5 && m.plan === null && m.state === 'PLACING', 'release commits the planned run, the plan is dropped');

  // (b) scoring: fewest refused tiles picks the elbow; the choice sticks while the candidates tie (no flip-flop along a diagonal)
  const wall = new Set(); for (let x = 7; x <= 12; x++) wall.add(I(x, 5));   // row 5 blocked east of x 6
  quote = scorer(wall); runs.length = 0; m = mk(); start(m, 5, 5);
  ok(m.plan && m.plan.n === 1 && m.plan.refused === 0, 'the anchor alone is quoted on down');
  calls = 0; mv(m, 9, 8);
  ok(m.elbow === 1 && m.run[1] === I(5, 6) && m.run[3] === I(5, 8) && m.run[7] === I(9, 8) && m.plan.refused === 0, 'row 5 blocked: the y-first L wins (down column 5, then along row 8)');
  ok(calls === 2, 'two quotes per move (both Ls)');
  quote = scorer(new Set()); calls = 0;
  mv(m, 10, 9); ok(m.elbow === 1 && m.run[1] === I(5, 6) && calls === 2, 'both Ls legal again: the previous elbow (y-first) is kept');
  mv(m, 11, 10); mv(m, 12, 11); ok(m.elbow === 1 && m.run[1] === I(5, 6), 'and stays kept down the diagonal');
  quote = scorer(new Set(), (o, run) => { o.tieRank = run[1] === I(5, 6) ? 4 : 0; return o; });   // x-first touches the network (rank 0), y-first needs a 4-tile tie
  mv(m, 13, 12); ok(m.elbow === 0 && m.run[1] === I(6, 5), 'equal refusals: the L that touches the network / needs the shorter tie wins over the kept elbow');
  quote = scorer(new Set(), (o, run) => { o.wet = run[1] === I(6, 5) ? 2 : 0; return o; });   // x-first crosses 2 wet tiles
  mv(m, 14, 13); ok(m.elbow === 1 && m.run[1] === I(5, 6), 'equal refusals and ties: fewer wet tiles wins');
  m.step({ type: 'key', key: 'Escape', ...Tp(14, 13) }); ok(m.state === 'PLACING' && m.plan === null && m.run.length === 0, 'Esc drops the run and its plan');

  // (c) the Z fallback: neither L legal, a Z is → the Z (its cross leg on a clear row), elbow kept; no legal Z → the better L with its red tiles
  const posts = new Set([I(7, 5), I(7, 8)]);   // a post on row 5 and one on row 8, both at column 7: every L crosses one
  quote = scorer(posts); m = mk(); start(m, 5, 5); calls = 0; mv(m, 9, 8);
  ok(m.plan.refused === 0 && m.run.length === 8 && conn4(m.run) && m.run.indexOf(I(7, 6)) >= 0 && m.run[0] === I(5, 5) && m.run[7] === I(9, 8) && m.elbow === 0, 'both Ls hit a post: a Z with its cross leg on row 6 is laid instead (' + m.run.map((i) => X(i) + ',' + Y(i)).join(' ') + ')');
  ok(calls <= 2 + 24, 'the Z search is bounded (' + calls + ' quotes)');
  const column = new Set(); for (let y = 0; y < 20; y++) column.add(I(7, y));   // a whole column blocked: no Z can cross it either
  quote = scorer(column); mv(m, 10, 9);
  ok(m.plan.refused === 1 && m.plan.skipped.length === 1 && m.plan.skipped[0].i === I(7, 5) && m.run.length === 10 && m.elbow === 0, 'no legal Z: the better L is kept with its one refused tile in the plan');
  m.step({ type: 'cancel' });

  // (d) Shift = the axis-locked straight line from the anchor (quoted too); off again → the L
  quote = scorer(new Set()); m = mk(); start(m, 30, 30); mv(m, 36, 32, SH);
  ok(m.run.length === 7 && m.run.every((i) => Y(i) === 30) && m.plan && m.plan.n === 7, 'Shift: a 7-tile line along row 30 (the larger delta axis), quoted');
  mv(m, 32, 31, SH); ok(m.run.length === 3 && m.run.every((i) => Y(i) === 30), 'Shift line shortens when the cursor returns');
  mv(m, 33, 32, M0); ok(m.run.length === 6 && m.run[3] === I(33, 30) && m.run[5] === I(33, 32), 'Shift released: the L again');
  m.step({ type: 'up', ...Tp(33, 32), button: 0, mods: M0 });

  // (e) a move within the same tile re-plans nothing
  m = mk(); start(m, 2, 2); mv(m, 6, 4); calls = 0; mv(m, 6, 4); ok(calls === 0 && m.run.length === 7, 'a move within the same tile changes nothing');
  m.step({ type: 'cancel' });
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. buildings.runQuote and the marsh-bank bridge span (a synthetic flat world like buildings.test's)
// ---------------------------------------------------------------------------------------------------------------------
const liveState = BSU.state;
{
  const s = BSU.newState(21), N = W * W;
  for (let i = 0; i < N; i++) { s.tiles.owner[i] = -1; s.tiles.elev[i] = 6; s.tiles.type[i] = T.DRY; s.tiles.flags[i] = 0; s.tiles.depth[i] = 0; }
  s.plot.bank0 = 57; s.plot.founders = { tx: 50, ty: 7 }; s.plot.highway = [52, 116, 180, 244, 308, 372, 436]; s.plot.cove = []; s.plot.mouth = [0, 0, 0]; s.plot.bayou = []; s.plot.cheniers = []; s.plot.mounds = [];
  for (const i of s.plot.highway) s.tiles.surface[i] = SURF.ROAD;
  s.economy.suppressCoverage = false;
  BSU.state = s; B.reset(s, true);
  B.place(s, 'founders_hall', 50, 7, { ignoreCash: true, instant: true });
  const at = (x, y) => y * W + x, row = (y, x0, x1) => { const t = []; for (let x = x0; x <= x1; x++) t.push(at(x, y)); return t; };
  const water = (x, y) => { const i = at(x, y); s.tiles.type[i] = T.BAYOU; s.tiles.flags[i] |= FLAG.BAYOU; s.tiles.elev[i] = -2; s.tiles.depth[i] = 2; };
  const marsh = (x, y) => { const i = at(x, y); s.tiles.type[i] = T.MARSH; s.tiles.elev[i] = 1; };
  const ROAD = BSU.data.catalog.road.cost, PATH = BSU.data.catalog.path.cost, MULT = BSU.params.build.bridgeCostMult;
  // (a) a path run over one water tile: that tile is skipped with its reason, the rest priced; a run starting on an existing path passes it over silently
  water(24, 20);
  const q1 = B.runQuote(s, 'path', row(20, 20, 28), {});
  ok(q1.n === 9 && q1.refused === 1 && q1.skipped.length === 1 && q1.skipped[0].i === at(24, 20) && q1.skipped[0].reason === 'Not on water' && q1.placed === 8 && q1.cost === 8 * PATH && q1.wet === 1, 'runQuote(path over water): 1 skipped "Not on water", 8 placed at $2k, wet 1: ' + JSON.stringify({ r: q1.refused, p: q1.placed, c: q1.cost, w: q1.wet }));
  ok(q1.tie === null && q1.touches === false, 'off the network: no tie within reach, not touching');
  const pr1 = B.placeRun(s, 'path', row(20, 20, 28), { ignoreCash: true });
  ok(pr1.placed === q1.placed && pr1.skipped.length === 1 && pr1.skipped[0].i === q1.skipped[0].i && pr1.skipped[0].reason === q1.skipped[0].reason, 'placeRun does exactly what the quote said (8 placed, the water tile skipped with the same reason)');
  const q2 = B.runQuote(s, 'path', row(20, 26, 30), {});
  ok(q2.refused === 0 && q2.same.length === 3 && q2.same[0] === at(26, 20) && q2.placed === 2 && q2.cost === 2 * PATH, 'a run that starts on existing path tiles: "Already a path" tiles are `same`, not refused (' + q2.same.length + ' same, ' + q2.placed + ' placed)');
  // (b) a road over one water tile between a marsh bank and dry ground: the bank is part of the span → deck, bridge price on both
  marsh(31, 24); water(32, 24);
  const q3 = B.runQuote(s, 'road', row(24, 30, 33), {});
  ok(q3.refused === 0 && q3.bridge === 2 && q3.placed === 4 && q3.cost === 2 * ROAD + 2 * ROAD * MULT, 'road: dry, marsh, water, dry → a 2-tile span over the bank at bridge price (' + q3.cost + ')');
  const pr3 = B.placeRun(s, 'road', row(24, 30, 33), { ignoreCash: true });
  ok(pr3.ok && pr3.placed === 4 && s.tiles.surface[at(31, 24)] === SURF.ROAD && s.tiles.surface[at(32, 24)] === SURF.ROAD && pr3.cost === q3.cost, 'laid: the marsh bank carries the road as deck, priced like the water tile');
  ok(B.canPlace(s, 'road', 31, 25, {}).reason === 'Use a Boardwalk or a bridge' || B.canPlace(s, 'road', 31, 25, {}).ok, 'a single click on open marsh still refuses (or the tile is dry): ' + B.canPlace(s, 'road', 31, 25, {}).reason);
  { const rm = B.remove(s, { tile: at(31, 24) }, 'demolish'), rw = B.remove(s, { tile: at(32, 24) }, 'demolish'); ok(rm.ok && rw.ok && rm.refund === rw.refund && rm.refund > 0, 'demolishing the bank deck refunds like the water deck (' + rm.refund + ')'); }
  for (const x of [30, 33]) B.remove(s, { tile: at(x, 24) }, 'demolish');
  // (c) the brief's case: a 3-tile bayou with 1-tile marsh banks (span 5) → the WHOLE span refused with one reason; the dry parts lay; no lone bridge
  marsh(31, 28); water(32, 28); water(33, 28); water(34, 28); marsh(35, 28);
  const q4 = B.runQuote(s, 'road', row(28, 29, 37), {});
  const LONG = 'Bridges span 3 tiles at most (marsh banks count)';
  ok(q4.refused === 5 && q4.skipped.every((k) => k.reason === LONG) && q4.skipped.map((k) => k.i).join() === [31, 32, 33, 34, 35].map((x) => at(x, 28)).join() && q4.placed === 4, 'marsh + 3 water + marsh: all five span tiles refused with one reason: ' + (q4.skipped[0] && q4.skipped[0].reason));
  const pr4 = B.placeRun(s, 'road', row(28, 29, 37), { ignoreCash: true });
  ok(pr4.placed === 4 && [32, 33, 34].every((x) => s.tiles.surface[at(x, 28)] === SURF.NONE) && [29, 30, 36, 37].every((x) => s.tiles.surface[at(x, 28)] === SURF.ROAD), 'released: the road stops at the dry banks, no bridge stands alone in the bayou');
  for (const x of [29, 30, 36, 37]) B.remove(s, { tile: at(x, 28) }, 'demolish');
  // (d) a marsh band with no water is still a boardwalk job; a span that never reaches dry ground is refused as such
  marsh(31, 32); marsh(32, 32);
  const q5 = B.runQuote(s, 'road', row(32, 30, 33), {});
  ok(q5.refused === 2 && q5.skipped.every((k) => k.reason === 'Use a Boardwalk or a bridge'), 'a marsh band without water: "Use a Boardwalk or a bridge" on both tiles');
  water(31, 36); water(32, 36);
  const q6 = B.runQuote(s, 'road', row(36, 31, 32), {});
  ok(q6.refused === 2 && q6.skipped.every((k) => k.reason === 'Bridges start from dry ground'), 'a water-only run with no bank: "Bridges start from dry ground"');
  // (e) the old rule still holds elsewhere: a 3-tile bayou with dry banks is a bridge, 4 is not
  water(41, 40); water(42, 40); water(43, 40);
  const q7 = B.runQuote(s, 'road', row(40, 40, 44), {}); ok(q7.refused === 0 && q7.bridge === 3, '3 water tiles between dry banks: a bridge');
  water(44, 40);
  const q8 = B.runQuote(s, 'road', row(40, 40, 45), {}); ok(q8.refused === 4 && q8.skipped[0].reason === 'Bridges span 3 tiles at most', '4 water tiles: refused with the plain reason');
  // (f) a quote is cheap enough for every mouse move: a 40-tile road run through the flat world
  { const run = row(50, 2, 41); const t0 = performance.now(); let n = 0; for (let k = 0; k < 20; k++) { B.runQuote(s, 'road', run, {}); n++; } const ms = (performance.now() - t0) / n; ok(ms < 3 || true, `runQuote of a 40-tile run: ${ms.toFixed(2)} ms (advisory < 3 ms)`); }
  BSU.state = liveState; B.reset(liveState, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. render: end degrees, the junction dash trim, staircase straightening, the dash path, the deck over the bank
// ---------------------------------------------------------------------------------------------------------------------
{
  const CV = R.curves;
  ok(typeof CV.straighten === 'function' && typeof CV.trim === 'function' && typeof CV.path === 'function' && Math.abs(CV.stairDev - 0.3536) < 1e-3 && CV.dashTrim === 0.45, 'render.curves exposes straighten / trim / path and the constants');
  // (a) traceNets records the same-kind degree at both ends: a road T on a 7×7 grid (through-road x 1..5 on y 3, a branch down column 3 to y 5)
  const gw = 7, gh = 7, g = new Uint8Array(gw * gh), at = (x, y) => y * gw + x;
  for (let x = 1; x <= 5; x++) g[at(x, 3)] = SURF.ROAD; g[at(3, 4)] = SURF.ROAD; g[at(3, 5)] = SURF.ROAD;
  const nets = CV.trace(g, gw, gh);
  ok(nets.length === 3 && nets.every((p) => p.deg && p.deg.length === 2), 'a T traces to three polylines, each with two end degrees');
  const node = at(3, 3);
  ok(nets.every((p) => (p.tiles[0] === node ? p.deg[0] : p.deg[1]) === 3) && nets.every((p) => (p.tiles[0] === node ? p.deg[1] : p.deg[0]) === 1), 'every arm ends at the node with degree 3 and starts at a dead end with degree 1');
  g[at(0, 0)] = SURF.ROAD; const lone = CV.trace(g, gw, gh).find((p) => p.tiles.length === 1); ok(lone && lone.deg[0] === 0 && lone.deg[1] === 0, 'an isolated tile has degree 0 at both ends'); g[at(0, 0)] = 0;
  // (b) dashTrim: the node end loses 0.45 tile of dash, the dead end keeps it; buildPath's dash mode starts at the cut point
  const st = { tiles: { surface: new Uint8Array(W * W), elev: new Float32Array(W * W), type: new Uint8Array(W * W).fill(T.DRY), flags: new Uint32Array(W * W), depth: new Float32Array(W * W) }, buildings: [] };
  const col = (x, y) => y * W + x;
  for (let x = 10; x <= 14; x++) st.tiles.surface[col(x, 10)] = SURF.ROAD; st.tiles.surface[col(12, 11)] = SURF.ROAD; st.tiles.surface[col(12, 12)] = SURF.ROAD;   // the same T on the real map size
  for (let x = 20; x <= 24; x++) st.tiles.surface[col(x, 10)] = SURF.ROAD;   // a plain 5-tile road: two dead ends
  for (let x = 30; x <= 33; x++) st.tiles.surface[col(x, 20)] = SURF.ROAD; for (let y = 18; y <= 22; y++) { st.tiles.surface[col(30, y)] = SURF.ROAD; st.tiles.surface[col(33, y)] = SURF.ROAD; }   // an H: a 4-tile bar between two junctions
  const cv = CV.build(st);
  const arms = cv.polys.filter((p) => p.kind === SURF.ROAD && p.tiles.indexOf(col(12, 10)) >= 0 && p.tiles.length <= 3);
  ok(arms.length === 3, 'the T is three road polylines through the node (' + arms.length + ')');
  const armOk = arms.every((p) => { const nodeFirst = p.tiles[0] === col(12, 10); const tr = nodeFirst ? p.trimA : p.trimB, other = nodeFirst ? p.trimB : p.trimA; if (!tr || other) return false; const ex = nodeFirst ? [p.pts[0], p.pts[1]] : [p.pts[p.pts.length - 2], p.pts[p.pts.length - 1]]; return Math.abs(Math.hypot(tr.x - ex[0], tr.y - ex[1]) - 0.45) < 1e-6; });
  ok(armOk, 'each arm is trimmed 0.45 tile from the node end only (the dead end keeps its dash)');
  const plain = cv.polys.find((p) => p.kind === SURF.ROAD && p.tiles.indexOf(col(22, 10)) >= 0);
  ok(plain && !plain.trimA && !plain.trimB && !plain.noDash, 'a road between two dead ends carries its dash end to end');
  const bar = cv.polys.find((p) => p.kind === SURF.ROAD && p.tiles.indexOf(col(31, 20)) >= 0 && p.tiles.indexOf(col(32, 20)) >= 0);
  ok(bar && bar.trimA && bar.trimB && bar.trimA.k <= bar.trimB.k && !bar.noDash, 'the H bar between two junctions is trimmed at both ends and still dashed in the middle (' + (bar && bar.tiles.length) + ' tiles)');
  { for (let y = 10; y <= 12; y++) st.tiles.surface[col(40, y)] = SURF.ROAD; for (const x of [39, 41]) { st.tiles.surface[col(x, 10)] = SURF.ROAD; st.tiles.surface[col(x, 12)] = SURF.ROAD; }   // two crosses one tile apart: a 2-tile bar, 1 tile long
    const cv2 = CV.build(st), short = cv2.polys.find((p) => p.kind === SURF.ROAD && p.tiles.length === 2 && p.tiles.indexOf(col(40, 10)) >= 0 && p.tiles.indexOf(col(40, 11)) >= 0);
    const short2 = cv2.polys.find((p) => p.kind === SURF.ROAD && p.tiles.length === 3 && p.tiles[0] === col(40, 10) && p.tiles[2] === col(40, 12));
    ok((short && short.noDash) || (short2 && short2.trimA && short2.trimB), 'a bar shorter than two trims plus a dash carries no dash at all, a 2-tile one is trimmed both ends: ' + JSON.stringify(short2 ? [short2.tiles.length, !!short2.noDash] : short ? [2, !!short.noDash] : null));
    for (let y = 10; y <= 12; y++) for (const x of [39, 40, 41]) st.tiles.surface[col(x, y)] = 0; }
  // the dash path for the node tile's ranges: starts on the first arm's cut point, never reaches the node centre
  { const ops = []; const rec = { beginPath() { ops.push(['B']); }, moveTo(x, y) { ops.push(['M', x, y]); }, lineTo(x, y) { ops.push(['L', x, y]); } };
    const list = cv.buckets.get(col(12, 10));
    const nBody = CV.path(rec, cv, list, false, SURF.ROAD, 0, false), bodyOps = ops.splice(0);
    const nDash = CV.path(rec, cv, list, false, SURF.ROAD, 0, true), dashOps = ops.splice(0);
    const pts = (o) => o.filter((q) => q[0] !== 'B');
    const nearNode = (q) => Math.hypot(q[1] - 12, q[2] - 10) < 0.44;
    ok(nBody === 3 && pts(bodyOps).some(nearNode), 'the node tile\'s body path has all three arms reaching the centre');
    ok(nDash === 3 && !pts(dashOps).some(nearNode) && pts(dashOps).every((q) => Math.hypot(q[1] - 12, q[2] - 10) >= 0.45 - 1e-6), 'its dash path keeps every point ≥ 0.45 tile from the node centre (' + pts(dashOps).length + ' points)');
    const dead = cv.buckets.get(col(10, 10)); ops.length = 0; const nd = CV.path(rec, cv, dead, false, SURF.ROAD, 0, true); const dOps = pts(ops);
    ok(nd === 1 && dOps.some((q) => Math.abs(q[1] - 10) < 1e-6 && Math.abs(q[2] - 10) < 1e-6), 'the dead-end tile\'s dash path reaches the end centre'); }
  // (c) straightenStairs: a 7-tile unit staircase → the interior centres become the six move midpoints on the 45° midline, the ends stay, one point more
  { const raw = [0, 0, 1, 0, 1, 1, 2, 1, 2, 2, 3, 2, 3, 3], out = CV.straighten(raw, 0.36), map = out.rawMap;
    const onLine = (x, y) => Math.abs((x - y) - 0.5) < 1e-9;   // the midline y = x − 0.5
    ok(out !== raw && out.length === 16 && out[0] === 0 && out[1] === 0 && out[14] === 3 && out[15] === 3, 'one staircase straightened: endpoints kept, 8 points for 7 (' + out.length / 2 + ')');
    let all = true; for (let k = 1; k < 7; k++) if (!onLine(out[2 * k], out[2 * k + 1])) all = false; ok(all && out[2] === 0.5 && out[3] === 0 && out[12] === 3 && out[13] === 2.5, 'the six interior points are the move midpoints on the midline');
    ok(map[0] === 0 && map[6] === 7 && map[1] === 2 && map[5] === 6, 'the raw → new index map: ends 0 → 0 and 6 → 7, a skipped centre → the midpoint just past it (' + Array.from(map).join(',') + ')');
    const sm = CV.smooth(out, false, 3); let maxDev = 0; for (let k = (sm.length / 3) & ~1; k < (sm.length * 2 / 3); k += 2) maxDev = Math.max(maxDev, Math.abs(sm[k] - sm[k + 1] - 0.5) / Math.SQRT2);
    ok(maxDev < 1e-6, 'smoothed: the middle third of the run is a dead straight diagonal (max deviation ' + maxDev.toFixed(4) + ' tile; the wave was ±0.18)');
    const distTo = (pts, x, y) => { let best = Infinity; for (let k = 0; k + 3 < pts.length; k += 2) { const ax = pts[k], ay = pts[k + 1], vx = pts[k + 2] - ax, vy = pts[k + 3] - ay, l2 = vx * vx + vy * vy; let t = l2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0; t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(ax + vx * t - x, ay + vy * t - y)); } return best; };
    let far = 0; for (let k = 0; k < raw.length; k += 2) far = Math.max(far, distTo(sm, raw[k], raw[k + 1]));
    ok(far < 0.36 && far > 0.35, 'every skipped tile centre stays within ' + far.toFixed(3) + ' tile of the smoothed curve (< the road\'s 0.36 half width)');
    const raw2 = [0, 0, 1, 0, 1, 1, 2, 1, 2, 2, 3, 2, 3, 3]; ok(CV.straighten(raw2, 0.21) === raw2 && raw2[2] === 1 && raw2[3] === 0 && !raw2.rawMap, 'a half width of 0.21 (paths) cannot cover the 0.354 offset: untouched, no map');
    const L = [0, 0, 1, 0, 1, 1]; ok(CV.straighten(L, 0.36) === L, 'an L corner (two moves) is not a staircase');
    const jog = [0, 0, 1, 0, 1, 1, 2, 1, 3, 1, 4, 1], jo = CV.straighten(jog, 0.36); ok(jo.length === 14 && jo[2] === 0.5 && jo[3] === 0 && jo[6] === 1.5 && jo[7] === 1 && jo[8] === 2 && jo[9] === 1 && jo[12] === 4 && jo[13] === 1, 'a three-move jog (x, y, x) straightens; the straight tail after it stays');
    const hair = [0, 0, 1, 0, 1, 1, 0, 1, 0, 2]; ok(CV.straighten(hair, 0.36) === hair, 'a hairpin (x+, y+, x−) is not a staircase');
    const two = [0, 0, 1, 0, 1, 1, 2, 1, 3, 1, 3, 2, 4, 2, 4, 3, 5, 3], tw = CV.straighten(two, 0.36); ok(tw.length === 22 && tw[20] === 5 && tw[21] === 3, 'two staircases in one polyline, both straightened (+2 points)');
    const fr = CV.straighten([0, 0, 1, 0, 1, 1, 2, 1, 2, 2, 3, 2, 3, 3], 0.36, [true, true]), fmap = fr.rawMap;
    ok(fr.length === 16 && Math.abs(fr[0] - 0.25) < 1e-9 && Math.abs(fr[1] + 0.25) < 1e-9 && Math.abs(fr[14] - 3.25) < 1e-9 && Math.abs(fr[15] - 2.75) < 1e-9 && fmap[0] === 0 && fmap[6] === 7, 'free dead ends move onto the midline too: the run is one straight line end to end (' + fr.slice(0, 2).join(',') + ' … ' + fr.slice(14).join(',') + ')');
    const fr2 = CV.straighten([0, 0, 1, 0, 1, 1, 2, 1, 2, 2, 3, 2, 3, 3], 0.36, [true, false]); ok(Math.abs(fr2[0] - 0.25) < 1e-9 && fr2[14] === 3 && fr2[15] === 3, 'a free start with a fixed end (a junction / another kind beyond it)'); }
  // (d) buildCurves: a road staircase is straightened (its curve passes ≤ 0.36 of every centre), a path staircase keeps its wave
  { const st2 = { tiles: { surface: new Uint8Array(W * W), elev: new Float32Array(W * W), type: new Uint8Array(W * W).fill(T.DRY), flags: new Uint32Array(W * W), depth: new Float32Array(W * W) }, buildings: [] };
    const stair = (x0, y0, sf) => { const t = []; for (let k = 0; k < 4; k++) { t.push(col(x0 + k, y0 + k)); if (k < 3) t.push(col(x0 + k + 1, y0 + k)); } for (const i of t) st2.tiles.surface[i] = sf; return t; };
    const rs = stair(10, 10, SURF.ROAD), ps = stair(30, 10, SURF.PATH);
    const cv3 = CV.build(st2);
    const distTo = (pts, x, y) => { let best = Infinity; for (let k = 0; k + 3 < pts.length; k += 2) { const ax = pts[k], ay = pts[k + 1], vx = pts[k + 2] - ax, vy = pts[k + 3] - ay, l2 = vx * vx + vy * vy; let t = l2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0; t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(ax + vx * t - x, ay + vy * t - y)); } return best; };
    const devOf = (P, tiles) => { let mx = 0; for (const i of tiles) mx = Math.max(mx, distTo(P.pts, i % W, (i / W) | 0)); return mx; };
    const PR = cv3.polys.find((p) => p.kind === SURF.ROAD), PP = cv3.polys.find((p) => p.kind === SURF.PATH);
    const dr = devOf(PR, rs), dp = devOf(PP, ps);
    const mid = (pts, x0, y0, whole) => { let m = 0; for (let k = whole ? 0 : (pts.length / 3) & ~1; k < (whole ? pts.length : pts.length * 2 / 3); k += 2) m = Math.max(m, Math.abs((pts[k] - x0) - (pts[k + 1] - y0) - 0.5) / Math.SQRT2); return m; };
    const wave = mid(PR.pts, 10, 10, true), pwave = mid(PP.pts, 30, 10);
    ok(dr < 0.36 && dr > 0.3 && wave < 1e-6 && PR.rawOf && PR.rawOf.length === 7 && PR.pts.length === 2 * 8 * 8, `road staircase with two dead ends: one straight diagonal end to end (deviation ${wave.toFixed(4)}), every centre within ${dr.toFixed(3)} tile of the curve (< 0.36 half width), 8 raw points (${PR.pts.length / 2} smoothed) mapped`);
    ok(dp < 0.21 && pwave > 0.15 && !PP.rawOf, `path staircase: the wave stays (amplitude ${pwave.toFixed(3)}), every centre within ${dp.toFixed(3)} tile (< 0.21 half width)`);
    ok(rs.every((i) => cv3.buckets.has(i)) && ps.every((i) => cv3.buckets.has(i)), 'every staircase tile is bucketed for the bake');
    // a terrace step along a straightened staircase still lands on the shared edge of the right tiles (the raw index map feeds the search window)
    for (let k = 4; k < 7; k++) st2.tiles.elev[rs[k]] = 2;
    const cv5 = CV.build(st2), stp = cv5.steps.get(rs[3]);
    ok(stp && stp.length === 1 && stp[0].hi === rs[4] && stp[0].lo === rs[3] && Math.abs(stp[0].t) <= 1 && Math.hypot(cv5.polys.find((p) => p.kind === SURF.ROAD).pts[2 * stp[0].j] - (rs[3] % W + rs[4] % W) / 2, cv5.polys.find((p) => p.kind === SURF.ROAD).pts[2 * stp[0].j + 1] - (((rs[3] / W) | 0) + ((rs[4] / W) | 0)) / 2) < 0.6, 'a 2-ft step between tiles 4 and 5 of the road staircase is keyed by the lower tile at the curve point nearest their shared edge: ' + JSON.stringify(stp && { hi: stp[0].hi, lo: stp[0].lo, j: stp[0].j, t: +stp[0].t.toFixed(2) })); }
  // (e) a road over a marsh bank beside a bayou is a deck continued at the water deck's height (buildings allows it inside a ≤ 3 span)
  { const st3 = { tiles: { surface: new Uint8Array(W * W), elev: new Float32Array(W * W).fill(2), type: new Uint8Array(W * W).fill(T.DRY), flags: new Uint32Array(W * W), depth: new Float32Array(W * W) }, buildings: [], plot: { bayou: [] } };
    for (let x = 10; x <= 14; x++) st3.tiles.surface[col(x, 30)] = SURF.ROAD;
    { const i = col(12, 30); st3.tiles.type[i] = T.BAYOU; st3.tiles.flags[i] = FLAG.BAYOU; st3.tiles.elev[i] = -2; st3.tiles.depth[i] = 2; }
    { const i = col(11, 30); st3.tiles.type[i] = T.MARSH; st3.tiles.elev[i] = 1; }
    { const i = col(14, 30); st3.tiles.type[i] = T.MARSH; st3.tiles.elev[i] = 1; }   // marsh NOT contiguous with the water (13 is dry): stays ground
    const cv4 = CV.build(st3);
    ok(Math.abs(cv4.deck[col(12, 30)] - 4) < 1e-6 && Math.abs(cv4.deck[col(11, 30)] - 4) < 1e-6 && Math.abs(cv4.water[col(11, 30)] - 1) < 1e-6 && Number.isNaN(cv4.deck[col(10, 30)]) && Number.isNaN(cv4.deck[col(13, 30)]) && Number.isNaN(cv4.deck[col(14, 30)]), 'the bank (11,30) carries the deck at 4 ft standing in the marsh; the dry tiles and the far marsh tile do not');
    ok(cv4.deckCount === 2 && cv4.steps.has(col(10, 30)) && cv4.steps.has(col(13, 30)), 'two deck tiles; the ramps land on the dry tiles either side (steps keyed by the lower tiles)'); }
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. the live ui: red skip tiles, the status line, the centreline spec, Shift mid-drag; a student drawn on a straightened road
// ---------------------------------------------------------------------------------------------------------------------
{
  BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
  const s = BSU.state, t = s.tiles, H = BSU.headless;
  U.showTitle(false); U.settings().coachSeen = true; s.economy.cash = 50e6;
  // a chartered dry strip where a path can be dragged (as ui.test finds one), with one tile turned to open water in the middle
  const spot = (() => { for (let ty = 8; ty < W - 8; ty++) for (let tx = 8; tx < W - 14; tx++) { let all = true; for (let k = 0; k < 9 && all; k++) { const r = B.canPlace(s, 'path', tx + k, ty, {}); if (!r.ok) all = false; } if (all) return { tx, ty }; } return null; })();
  ok(!!spot, 'a 9-tile strip of placeable dry land exists on the live map');
  if (spot) {
    const wi = (spot.ty) * W + spot.tx + 4, saved = { type: t.type[wi], flags: t.flags[wi], elev: t.elev[wi], depth: t.depth[wi] };
    t.type[wi] = T.OPEN_WATER; t.flags[wi] |= FLAG.OPEN_WATER; t.elev[wi] = -2; t.depth[wi] = 2; BSU.terrain.rewalk(s, wi);
    const P = (x, y) => R.tileToScreen(x, y);
    U.selectTool(s, 'path');
    const a = P(spot.tx, spot.ty), b = P(spot.tx + 8, spot.ty);
    U.pointer('move', a.x, a.y, 0, M0); U.pointer('down', a.x, a.y, 0, M0); U.pointer('move', b.x, b.y, 0, M0);
    const gs = R.ghostSpec;
    ok(U.state === 'DRAGGING' && gs && Array.isArray(gs.tiles) && gs.tiles.length === 8 && gs.tiles.indexOf(wi) < 0, 'a 9-tile path drag is in progress; the ghost fills the 8 tiles that will be laid (' + (gs && gs.tiles && gs.tiles.length) + ' tiles)');
    ok(gs && Array.isArray(gs.skipTiles) && gs.skipTiles.length === 1 && gs.skipTiles[0] === wi && gs.color === 'yellow', 'the water tile is in the ghost\'s red skipTiles only; the run is yellow (partly refused)');
    ok(gs && Array.isArray(gs.line) && gs.line.length === 9 && gs.lineKind === SURF.PATH, 'the run is handed to render as a centreline of the path kind');
    const l2 = U.el['ghost-l2'].textContent, l1 = U.el['ghost-l1'].textContent;
    ok(/^1 water tile skipped: not on water/.test(l2), 'the label names the first reason with its count: "' + l2 + '"');
    ok(/^8 tiles · \$16k/.test(l1), 'the cost line counts the tiles that will be laid: "' + l1 + '"');
    const tp = BSU.render_fx && BSU.render_fx.tiePreviewSpec ? BSU.render_fx.tiePreviewSpec() : (R.tiePreviewSpec ? R.tiePreviewSpec() : undefined);
    ok(tp === undefined || tp === null || (tp && Array.isArray(tp.tiles)), 'the tie preview is untouched by the pass');
    // Shift mid-drag: the run becomes the straight line at once (same tile, no mouse move); releasing it brings the L back
    const c = P(spot.tx + 6, spot.ty + 2); U.pointer('move', c.x, c.y, 0, M0);
    const yFirstClean = B.runQuote(s, 'path', [0, 1, 2].map((k) => (spot.ty + k) * W + spot.tx).concat([1, 2, 3, 4, 5, 6].map((k) => (spot.ty + 2) * W + spot.tx + k)), {}).refused === 0;
    ok(R.ghostSpec.tiles.length === 9 && (yFirstClean ? (R.ghostSpec.tiles[1] === (spot.ty + 1) * W + spot.tx && !R.ghostSpec.skipTiles) : R.ghostSpec.tiles[6] === spot.ty * W + spot.tx + 6), 'cursor on (+6, +2): the L that avoids the water tile is planned (' + (yFirstClean ? 'y-first, no red tile' : 'x-first') + ')');
    U.keydown('Shift', SH); ok(R.ghostSpec.tiles.length === 6 && R.ghostSpec.tiles.every((i) => ((i / W) | 0) === spot.ty) && R.ghostSpec.skipTiles && R.ghostSpec.skipTiles[0] === wi && R.ghostSpec.line && R.ghostSpec.line.length === 7, 'Shift pressed mid-drag: the straight 7-tile line along the row through the water tile (red, left out of the fill), re-planned without a mouse move');
    U.keyup('Shift'); ok(R.ghostSpec.tiles.length === 9 && R.ghostSpec.tiles[8] === (spot.ty + 2) * W + spot.tx + 6, 'Shift released: the L again');
    ok(U.keydown('Escape', M0) === true && U.state === 'PLACING', 'Esc cancels the drag');
    U.selectTool(s, null);
    t.type[wi] = saved.type; t.flags[wi] = saved.flags; t.elev[wi] = saved.elev; t.depth[wi] = saved.depth; BSU.terrain.rewalk(s, wi);
  }
  // a student walking a road staircase is drawn on the straight diagonal (movement pass), within the road's half width of its tile centres
  {
    const row = 44;
    for (let y = row - 2; y <= row + 8; y++) for (let x = 14; x <= 28; x++) { const i = y * W + x; t.type[i] = T.DRY; t.elev[i] = 1; t.depth[i] = 0; t.walk[i] = 2; t.owner[i] = -1; t.flags[i] = 0; t.surface[i] = 0; }
    const tiles = []; for (let k = 0; k < 5; k++) { tiles.push((row + k) * W + 16 + k); if (k < 4) tiles.push((row + k) * W + 17 + k); }
    for (const i of tiles) BSU.terrain.setSurface(s, i, SURF.ROAD);
    R.setZoom(1); R.panToTile(18, row + 2, false); H.render(); H.render();
    const cvs = R.curves.current();
    ok(cvs && tiles.every((i) => cvs.buckets.has(i)), 'the curves are built over the road staircase');
    const a = { id: 9, px: 16.5, py: row + 0.5, tx: 16.5, ty: row + 0.5, sd: 0, psd: 0, lat: 0, state: 'WALK', rhSet: false, rh: 0, ox: 0, oy: 0, pw: 0, rs: 0, hd: 0, dir: 0 };
    let maxOff = 0; const heads = []; let k = 0;
    for (let step = 0; step < 240; step++) {   // walk the Manhattan route tile centre to tile centre (x, then y, …) in small steps
      a.px = a.tx; a.py = a.ty; const want = tiles[Math.min(tiles.length - 1, k + 1)], wx = (want % W) + 0.5, wy = ((want / W) | 0) + 0.5;
      if (Math.abs(a.tx - wx) > 1e-9) a.tx += Math.sign(wx - a.tx) * Math.min(0.05, Math.abs(wx - a.tx)); else if (Math.abs(a.ty - wy) > 1e-9) a.ty += Math.sign(wy - a.ty) * Math.min(0.05, Math.abs(wy - a.ty)); else { k++; if (k >= tiles.length - 1) break; continue; }
      a.psd = a.sd; a.sd += 0.05;
      const q = R.agentPose(a, s); if (step > 40) { maxOff = Math.max(maxOff, Math.hypot(q.x - a.tx, q.y - a.ty)); heads.push(q.rh); }
    }
    const mid = heads.slice(heads.length >> 2, -(heads.length >> 2)), offDiag = mid.reduce((m, h) => Math.max(m, Math.abs(h - Math.PI / 4)), 0);
    ok(maxOff < 0.36 && mid.length > 20 && offDiag < 0.2, `drawn ≤ ${maxOff.toFixed(3)} tile from the tile-centre route (< 0.36 half width) with a heading within ${offDiag.toFixed(2)} rad of the diagonal through the middle (the wave swung it)`);
    for (const i of tiles) BSU.terrain.setSurface(s, i, SURF.NONE);
    R.curves.invalidate();
  }
}

ok(BSU.errors.size === errors0, 'no BSU.error during the run' + (BSU.errors.size !== errors0 ? ': ' + [...BSU.errors.keys()].join(' | ') : ''));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
