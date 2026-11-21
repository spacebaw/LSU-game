// Crossings pass, rule 8 (Josh: "the roads get built, and then sometimes the trees are still in the middle of the road. Make sure that
// when a path or a road is built, any shrubberies, bush, trees, any nature is cleared"). A path, road, boardwalk or Pedestrian Bridge tile
// clears every plant (state.veg entry, natural or planted) standing on it — a run tile, a bridge landing, an auto-tie tile, a building's
// own tie — on the same undo record (Ctrl+Z puts each entry back exactly, at its old index); the quote carries `clears`; the Wetland
// Preserve and fences clear nothing (water pass: a levee and a canal clear their tile now, test/unit/water.test.mjs); old saves are not swept; goal 6 still counts the oaks beside a path.
// Usage: node build.mjs --check && node test/unit/clearing.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

const { win } = loadGame();
const BSU = win.BSU, U = BSU.ui, B = BSU.buildings, R = BSU.render, SURF = BSU.SURF, T = BSU.T, FLAG = BSU.FLAG;
const M0 = { ctrl: false, shift: false, meta: false, alt: false };
const unlock0 = { u: BSU.progress.unlocked, o: BSU.progress.unlockOk };
BSU.progress.unlocked = () => true; BSU.progress.unlockOk = () => true;   // QA scaffolding

console.log('--- buildings: a surface clears its tile ---');
BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
const live64 = BSU.state;
{
  const W = BSU.MAP.W, H = BSU.MAP.H, N = W * H, at = (x, y) => y * W + x;
  const row = (y, x0, x1) => { const t = []; for (let x = x0; x <= x1; x++) t.push(at(x, y)); return t; };
  const s = BSU.newState(21);
  for (let i = 0; i < N; i++) { s.tiles.owner[i] = -1; s.tiles.elev[i] = 6; s.tiles.type[i] = T.DRY; s.tiles.flags[i] = 0; s.tiles.depth[i] = 0; }
  s.plot.bank0 = 57; s.plot.founders = { tx: 50, ty: 7 }; s.plot.highway = [0, 1, 2, 3, 4, 5, 6].map((y) => at(52, y)); s.plot.cove = []; s.plot.mouth = [0, 0, 0]; s.plot.bayou = []; s.plot.cheniers = []; s.plot.mounds = [];
  for (const i of s.plot.highway) s.tiles.surface[i] = SURF.ROAD;
  s.economy.suppressCoverage = false; s.veg.length = 0;
  BSU.state = s; B.reset(s, true);
  B.place(s, 'founders_hall', 50, 7, { ignoreCash: true, instant: true });
  B.placeRun(s, 'path', row(8, 40, 49), { ignoreCash: true, noTie: true });   // the campus path, west of the hall
  const plant = (type, x, y, extra) => { const v = Object.assign({ type: type, tx: x, ty: y, stage: 2, plantedDay: 0, planted: false }, extra || {}); s.veg.push(v); return v; };
  const on = (x, y) => s.veg.filter((v) => v.tx === x && v.ty === y);
  const snap = () => JSON.stringify(s.veg);
  const water = (x, y) => { const i = at(x, y); s.tiles.type[i] = T.BAYOU; s.tiles.flags[i] |= FLAG.BAYOU; s.tiles.elev[i] = -2; s.tiles.depth[i] = 2; };
  const marsh = (x, y) => { const i = at(x, y); s.tiles.type[i] = T.MARSH; s.tiles.elev[i] = 1; };

  // a path run over an oak, a cypress and a palmetto; an oak and a planted azalea on the tiles beside it
  plant('oak', 20, 30); plant('cypress', 22, 30, { stage: 1 }); plant('palmetto', 24, 30); plant('oak', 21, 29); plant('azalea', 23, 31, { planted: true, plantedDay: 12, stage: 1 });
  const v0 = snap(), run = row(30, 18, 26);
  const q = B.runQuote(s, 'path', run, {});
  ok(q.clears === 3 && q.clearsRun === 3 && q.placed === 9, 'runQuote(path): clears 3 (the plants on the run\'s tiles, not the two beside it)');
  s.economy.cash = 1000000;
  const pr = B.placeRun(s, 'path', run, { noTie: true });
  ok(pr.ok && pr.placed === 9 && on(20, 30).length === 0 && on(22, 30).length === 0 && on(24, 30).length === 0 && s.veg.length === 2, 'the path run removes the oak, the cypress and the palmetto on its tiles');
  ok(on(21, 29).length === 1 && on(23, 31).length === 1, 'and nothing on the neighbouring tiles');
  ok(1000000 - s.economy.cash === pr.cost && pr.cost === 9 * BSU.data.catalog.path.cost, 'clearing costs nothing extra ($' + pr.cost + ' for 9 tiles)');
  ok(B.undo(s).ok && snap() === v0, 'undo restores each entry exactly: type, tile, stage, plantedDay, planted — and the array order');
  ok(s.economy.cash === 1000000 && run.every((i) => s.tiles.surface[i] === SURF.NONE), '(the run and the cash are back too)');

  // a road run; two plants on one tile
  plant('azalea', 22, 30, { planted: true, plantedDay: 3, stage: 0 });
  const v1 = snap(), qr = B.runQuote(s, 'road', run, {});
  ok(qr.clears === 4, 'runQuote(road): clears 4 (two plants share a tile)');
  ok(B.placeRun(s, 'road', run, { ignoreCash: true, noTie: true }).placed === 9 && on(22, 30).length === 0 && s.veg.length === 2 && run.every((i) => s.tiles.surface[i] === SURF.ROAD), 'the road run clears all four');
  ok(B.undo(s).ok && snap() === v1, 'undo puts all four back in place and in order');

  // a single click (a 1-tile run through place) and a planted Live Oak
  const oakSpot = [28, 34];
  const po = B.place(s, 'live_oak', oakSpot[0], oakSpot[1], { ignoreCash: true });
  ok(po.ok && on(28, 34).length === 1 && on(28, 34)[0].planted === true && on(28, 34)[0].type === 'oak', 'a Live Oak is planted (a veg entry, planted: true)');
  const v2 = snap();
  ok(B.place(s, 'path', 28, 34, { ignoreCash: true }).ok && on(28, 34).length === 0, 'a path tile on it removes it (planted or natural: every plant goes)');
  ok(B.undo(s).ok && snap() === v2 && on(28, 34)[0].planted === true, 'undo brings the planted oak back with its planted flag, stage and plantedDay');

  // a tie tile: a path run 3 tiles south of the campus path, a tree on the tie's middle tile
  plant('oak', 44, 10);
  const v3 = snap(), runT = row(12, 42, 46), qt = B.runQuote(s, 'path', runT, {});
  ok(qt.tie && qt.tie.tiles.length === 3 && qt.clearsRun === 0 && qt.clears === (qt.tie.tiles.indexOf(at(44, 10)) >= 0 ? 1 : 0), 'the quote counts the plant on the tie (clears ' + qt.clears + ', the run\'s own tiles ' + qt.clearsRun + ')');
  const tieHits = qt.tie.tiles.indexOf(at(44, 10)) >= 0;
  if (!tieHits) { s.veg.pop(); const mid = qt.tie.tiles[1]; plant('oak', mid % W, (mid / W) | 0); }
  const v3b = snap(), mid = B.runQuote(s, 'path', runT, {}).tie.tiles[1];
  ok(B.runQuote(s, 'path', runT, {}).clears === 1, 'a tree on the tie\'s middle tile: clears 1');
  const prt = B.placeRun(s, 'path', runT, { ignoreCash: true });
  ok(prt.ok && prt.tie && prt.tie.tiles.length === 3 && on(mid % W, (mid / W) | 0).length === 0 && s.tiles.surface[mid] === SURF.PATH, 'the auto-tie tile clears its tree');
  ok(B.undo(s).ok && snap() === v3b, 'undo restores it with the run and the tie');
  void v3;

  // a building's own tie
  { const dq = (() => { for (let y = 10; y <= 14; y++) for (let x = 36; x <= 46; x++) { const r = B.canPlace(s, 'dorm', x, y, { ignoreCash: true }); if (r.ok && r.connector && r.connector.tiles.length >= 1) return { x, y, tiles: r.connector.tiles }; } return null; })();
    ok(!!dq, 'a Dorm site whose placement lays a tie');
    if (dq) { const t = dq.tiles[0]; s.veg.length = 0; plant('palmetto', t % W, (t / W) | 0); const vb = snap();
      const pd = B.place(s, 'dorm', dq.x, dq.y, { ignoreCash: true });
      ok(pd.ok && s.veg.length === 0 && s.tiles.surface[t] === SURF.PATH, 'a building\'s tie clears the plant on its tile too');
      ok(B.undo(s).ok && snap() === vb, 'and undoing the building restores it'); } }

  // a crossing: the landing of a Pedestrian Bridge and a boardwalk
  s.veg.length = 0;
  for (let x = 30; x <= 32; x++) water(x, 40); marsh(33, 40); marsh(29, 40);
  plant('cypress', 33, 40); plant('cypress', 29, 40); plant('oak', 34, 40);
  const v4 = snap(), runP = [33, 32, 31, 30, 29].map((x) => at(x, 40));
  ok(B.runQuote(s, 'bridge', runP, {}).clears === 2, 'runQuote(bridge): the cypress on each landing counts (clears 2)');
  ok(B.placeRun(s, 'bridge', runP, { ignoreCash: true, noTie: true }).placed === 5 && on(33, 40).length === 0 && on(29, 40).length === 0 && on(34, 40).length === 1, 'the landings\' gravel clears them; the oak beside the landing stays');
  ok(B.undo(s).ok && snap() === v4, 'undo restores both');
  ok(B.placeRun(s, 'boardwalk', runP, { ignoreCash: true, noTie: true }).placed === 5 && on(33, 40).length === 0 && on(29, 40).length === 0, 'a boardwalk clears its tiles the same way');
  ok(B.undo(s).ok && snap() === v4, 'undone');

  // what does NOT clear: the Wetland Preserve (a paint row), a levee, a canal, a fence
  s.veg.length = 0; marsh(20, 44); marsh(21, 44); plant('cypress', 20, 44); plant('cypress', 21, 44); plant('oak', 20, 46); plant('oak', 20, 48); plant('oak', 20, 50);
  const v5 = snap();
  ok(B.runQuote(s, 'preserve', [at(20, 44), at(21, 44)], {}).clears === 0 && B.placeRun(s, 'preserve', [at(20, 44), at(21, 44)], { ignoreCash: true }).placed === 2 && snap() === v5, 'the Wetland Preserve paints the marsh and leaves its cypress standing');
  ok(B.placeRun(s, 'gator_fence', row(50, 19, 21), { ignoreCash: true }).placed === 3 && snap() === v5 && B.runQuote(s, 'gator_fence', row(52, 19, 21), {}).clears === 0, 'a Gator Fence clears nothing, and its quote carries clears 0');
  // water pass (N5): a levee is a berm built on the tile and a canal is dug through it: both clear their tile, with the same exact undo
  ok(B.runQuote(s, 'levee', row(46, 19, 21), {}).clears === 1 && B.placeRun(s, 'levee', row(46, 19, 21), { ignoreCash: true }).placed === 3 && !s.veg.some((v) => v.tx === 20 && v.ty === 46) && B.undo(s).ok && snap() === v5, 'a levee run clears the oak on its tile (quote: clears 1); undo puts it back');
  ok(B.runQuote(s, 'canal', row(48, 19, 21), {}).clears === 1 && B.placeRun(s, 'canal', row(48, 19, 21), { ignoreCash: true, noTie: true }).placed === 3 && !s.veg.some((v) => v.tx === 20 && v.ty === 48) && B.undo(s).ok && snap() === v5, 'a canal run clears the oak on its tile (quote: clears 1); undo puts it back');

  // old saves: a plant already standing on a path is left alone (no sweep)
  s.veg.length = 0; B.placeRun(s, 'path', row(56, 20, 24), { ignoreCash: true, noTie: true }); plant('oak', 22, 56);
  B.tick(s, {}); B.reset(s, false);
  ok(on(22, 56).length === 1, 'a plant already on a path (an old save) stays: only new placements clear');
  ok(B.runQuote(s, 'path', row(56, 20, 24), {}).clears === 0, 'and a run over tiles that are already path quotes nothing to clear');
  BSU.state = live64; B.reset(live64, true);
}

console.log('--- live: goal 6 and the drag label ---');
{
  BSU.session.newGame({ seed: 42, skipTutorial: true, size: 96 });
  const s = BSU.state, W = 96, I = (x, y) => y * W + x; U.showTitle(false); U.update(s, 50); s.economy.cash = 1e7;
  const P = BSU.progress, g6 = () => P.goalProgress(s, '6').progress;
  // goal 6 (5 Live Oaks along a path): an oak beside a path counts, before and after more path is laid beside it
  const n0 = g6();
  let spot = null;
  for (let i = 0; i < W * W && !spot; i++) { if (s.tiles.surface[i] !== SURF.PATH) continue; for (const n of BSU.nbr4(i)) { const x = n % W, y = (n / W) | 0; if (s.tiles.surface[n] === SURF.NONE && !s.veg.some((v) => v.tx === x && v.ty === y) && B.canPlace(s, 'live_oak', x, y, { ignoreCash: true }).ok && B.canPlace(s, 'path', x, y, { ignoreCash: true }).ok) { spot = { x, y, i: n }; break; } } }
  ok(!!spot, 'a free tile beside the founders\' path takes a Live Oak');
  ok(B.place(s, 'live_oak', spot.x, spot.y, { ignoreCash: true }).ok && g6() === n0 + 1, 'goal 6 counts the planted oak beside the path (' + n0 + ' → ' + g6() + ')');
  const side = BSU.nbr4(spot.i).find((n) => s.tiles.surface[n] === SURF.NONE && B.canPlace(s, 'path', n % W, (n / W) | 0, { ignoreCash: true }).ok);
  ok(side !== undefined && B.place(s, 'path', side % W, (side / W) | 0, { ignoreCash: true }).ok && g6() === n0 + 1 && s.veg.some((v) => v.tx === spot.x && v.ty === spot.y && v.planted), 'a path laid BESIDE the oak leaves it standing and counted');
  ok(B.place(s, 'path', spot.x, spot.y, { ignoreCash: true }).ok && g6() === n0 && !s.veg.some((v) => v.tx === spot.x && v.ty === spot.y), 'a path laid ON the oak clears it (the count follows the entry)');
  ok(B.undo(s).ok && g6() === n0 + 1, 'undo: the oak and its count are back');

  // the drag label: "· clears N trees" (singular "1 tree"), through ui.pointer on the live map
  let ghost = null; const g0 = R.ghost; R.ghost = function (spec) { if (spec) ghost = spec; return g0.apply(R, arguments); };
  const l1 = () => U.el['ghost-l1'].textContent;
  const px = (tx, ty) => { const p = R.tileToScreen(tx, ty), hit = (x, y) => { const t = R.screenToTile(x, y); return !!t && Math.floor(t.tx) === tx && Math.floor(t.ty) === ty; };
    if (hit(p.x, p.y)) return p; for (let r = 1; r <= 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; if (hit(p.x + dx * 4, p.y + dy * 2)) return { x: p.x + dx * 4, y: p.y + dy * 2 }; } return p; };
  const hold = (tool, from, to) => { U.selectTool(s, tool); const a = px(from[0], from[1]), b = px(to[0], to[1]); U.pointer('move', a.x, a.y, 0, M0); U.pointer('down', a.x, a.y, 0, M0); for (let k = 1; k <= 12; k++) U.pointer('move', a.x + (b.x - a.x) * k / 12, a.y + (b.y - a.y) * k / 12, 0, M0); return b; };
  R.setZoom(1); R.panToTile(77, 35, false);
  const onRow = s.veg.filter((v) => v.ty === 34 && v.tx >= 69 && v.tx <= 84).length;
  ok(onRow === 4, 'site F (row 34, x 69–84): four plants stand on the run (' + onRow + ')');
  const veg0 = s.veg.length;
  let b = hold('road', [84, 34], [69, 34]);
  ok(l1() === '16 tiles · $160k · clears 4 trees', 'the drag label says what the road will clear: "' + l1() + '"');
  U.pointer('up', b.x, b.y, 0, M0);
  ok(s.veg.length === veg0 - 4 && !s.veg.some((v) => v.ty === 34 && v.tx >= 69 && v.tx <= 84) && [69, 76, 84].every((x) => s.tiles.surface[I(x, 34)] === SURF.ROAD), 'released: the road is laid and no plant stands on it');
  ok(U.keydown('z', { ...M0, ctrl: true }) === true && s.veg.length === veg0 && s.veg.filter((v) => v.ty === 34 && v.tx >= 69 && v.tx <= 84).length === 4, 'Ctrl+Z: the road is gone and the four plants are back');
  const first = s.veg.filter((v) => v.ty === 34 && v.tx >= 69 && v.tx <= 84).map((v) => v.tx).sort((p, q) => q - p)[0];
  b = hold('road', [84, 34], [first, 34]);
  ok(/ · clears 1 tree$/.test(l1()), 'one plant on the run: singular ("' + l1() + '")');
  U.keydown('Escape', M0); U.selectTool(s, null); R.ghost = g0; void ghost;
  const errs = [...BSU.errors.keys()];
  ok(errs.length === 0, 'no BSU.error' + (errs.length ? ': ' + errs.join(' | ').slice(0, 300) : ''));
}
BSU.progress.unlocked = unlock0.u; BSU.progress.unlockOk = unlock0.o;

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
