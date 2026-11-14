// Crossings pass (Josh: "smoother snap-to connections for bridges or anything that goes over bodies of water with nearby paths or roads ...
// make that snap-to connection automatic"). A crossing (a road bridge, a Pedestrian Bridge, a boardwalk over water or marsh) ties BOTH banks,
// a Pedestrian Bridge's landings are real gravel, the planner scores both banks and ends the run on the tile that lines up with the path
// already on the far bank, the ghost shows both ties and names each bank, and a refused span leaves no orphan stub.
//   1. buildings on a flat synthetic world: params, the two-bank ties, Alt (noTie), land only, unchartered land, cost and undo
//   2. Pedestrian Bridge landings (laid, off the run, refused)   3. no orphan stubs, the boardwalk's rule
//   4. buildings.crossSnap and the machine's end snap (stability along a slide)   5. the both-banks score
//   6. the live game on seed 42 at 96 through ui.pointer: the scene's cases (a)–(e), the ghost spec, the labels, Alt, Shift, one Ctrl+Z,
//      connectivity (buildings.connectedMask) and one agent route across (agents.routeSync) after each
// Usage: node build.mjs --check && node test/unit/crossings.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

const { win } = loadGame();
const BSU = win.BSU, U = BSU.ui, B = BSU.buildings, R = BSU.render, SURF = BSU.SURF, T = BSU.T, FLAG = BSU.FLAG, PB = BSU.params.build;
const M0 = { ctrl: false, shift: false, meta: false, alt: false }, SH = { ...M0, shift: true }, MA = { ...M0, alt: true };
const unlock0 = { u: BSU.progress.unlocked, o: BSU.progress.unlockOk };
const unlockAll = () => { BSU.progress.unlocked = () => true; BSU.progress.unlockOk = () => true; };   // QA scaffolding (the Pedestrian Bridge needs 800 students in play)
const access = (v) => v === SURF.PATH || v === SURF.ROAD || v === SURF.BOARDWALK || v === SURF.BRIDGE;

// ---------------------------------------------------------------------------------------------------------------------
// 1–5. a flat synthetic world (64 × 64, dry at 6 ft): Founders' Hall at (50, 7), a campus path down column 40 to (40, 20),
//      a 3-tile channel on columns 30–32 from row 12 to the bottom edge
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- buildings: the two-bank ties ---');
BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
const live64 = BSU.state;
{
  const W = BSU.MAP.W, H = BSU.MAP.H, N = W * H, at = (x, y) => y * W + x, xy = (i) => [i % W, (i / W) | 0];
  const row = (y, x0, x1) => { const t = [], st = x1 >= x0 ? 1 : -1; for (let x = x0; x !== x1 + st; x += st) t.push(at(x, y)); return t; };
  const col = (x, y0, y1) => { const t = [], st = y1 >= y0 ? 1 : -1; for (let y = y0; y !== y1 + st; y += st) t.push(at(x, y)); return t; };
  const s = BSU.newState(21);
  for (let i = 0; i < N; i++) { s.tiles.owner[i] = -1; s.tiles.elev[i] = 6; s.tiles.type[i] = T.DRY; s.tiles.flags[i] = 0; s.tiles.depth[i] = 0; }
  s.plot.bank0 = 57; s.plot.founders = { tx: 50, ty: 7 }; s.plot.highway = [0, 1, 2, 3, 4, 5, 6].map((y) => at(52, y)); s.plot.cove = []; s.plot.mouth = [0, 0, 0]; s.plot.bayou = []; s.plot.cheniers = []; s.plot.mounds = [];
  for (const i of s.plot.highway) s.tiles.surface[i] = SURF.ROAD;
  s.economy.suppressCoverage = false;
  BSU.state = s; B.reset(s, true); unlockAll();
  B.place(s, 'founders_hall', 50, 7, { ignoreCash: true, instant: true });
  const water = (x, y) => { const i = at(x, y); s.tiles.type[i] = T.BAYOU; s.tiles.flags[i] |= FLAG.BAYOU; s.tiles.elev[i] = -2; s.tiles.depth[i] = 2; };
  const marsh = (x, y) => { const i = at(x, y); s.tiles.type[i] = T.MARSH; s.tiles.elev[i] = 1; };
  const gravel = (tiles) => B.placeRun(s, 'path', tiles, { ignoreCash: true, noTie: true }).placed;
  const surfAt = (x, y) => s.tiles.surface[at(x, y)];
  const wipe = (tiles) => { for (const i of tiles) if (s.tiles.surface[i] !== SURF.NONE) B.remove(s, { tile: i }, 'undo'); };
  const joined = (a, b) => { const seen = new Set([a]), q = [a]; while (q.length) { const c = q.pop(); if (c === b) return true; for (const n of BSU.nbr4(c)) if (!seen.has(n) && access(s.tiles.surface[n])) { seen.add(n); q.push(n); } } return false; };
  for (let y = 12; y < H; y++) for (let x = 30; x <= 32; x++) water(x, y);
  const ROAD = BSU.data.catalog.road.cost, PATH = BSU.data.catalog.path.cost, WALK = BSU.data.catalog.boardwalk.cost, PED = BSU.data.catalog.bridge.cost, MULT = PB.bridgeCostMult;
  ok(gravel(row(8, 49, 40)) === 10 && gravel(col(40, 9, 20)) === 12 && B.connectedMask(s)[at(40, 20)] === 1, 'the campus path reaches (40, 20)');
  ok(PB.crossTieMax === 6 && PB.bridgeBankMax === 2 && PB.autoTieMax === 12 && PB.tieSnap === 2, 'params.build: crossTieMax 6, bridgeBankMax 2 (autoTieMax 12, tieSnap 2 unchanged)');
  ok(typeof B.crossSnap === 'function', 'API: buildings.crossSnap');

  // (a) a road crossing 4 tiles short of the campus path on the near bank, 4 short of an unconnected path on the far bank
  ok(gravel(col(22, 18, 22)) === 5 && B.connectedMask(s)[at(22, 20)] === 0, 'the far-bank path (column 22, rows 18–22) is not connected to campus');
  const run1 = row(20, 36, 26);
  const q1 = B.runQuote(s, 'road', run1, {});
  ok(q1.refused === 0 && q1.placed === 11 && q1.bridge === 3 && q1.cost === 8 * ROAD + 3 * ROAD * MULT && q1.tie === null && !!q1.cross, 'runQuote: 11 tiles, a 3-tile deck, the run is a crossing (cross set, the single `tie` null)');
  const c1 = q1.cross, s0 = c1.shores[0], s1 = c1.shores[1];
  ok(s0.end === 0 && s0.net === true && s0.tie && s0.tie.tiles.map(xy).join(' ') === '37,20 38,20 39,20', 'the near bank ties to the campus network: ' + (s0.tie && s0.tie.tiles.map(xy).join(' ')));
  ok(s1.end === 1 && s1.net === false && s1.tie && s1.tie.tiles.map(xy).join(' ') === '25,20 24,20 23,20', 'the far bank ties to the unconnected path: ' + (s1.tie && s1.tie.tiles.map(xy).join(' ')));
  ok(c1.ties.length === 2 && c1.ties[0].net === true && c1.ties[0].end === 0 && c1.ties[1].end === 1 && c1.cost === 6 * PATH && c1.n === 6 && c1.ties.every((t) => t.snap === false && t.water === 0 && t.surfaces.every((v) => v === 'path')), 'two ties, the campus tie first, gravel at the path price: $' + c1.cost);
  // the same run dragged the other way: the campus tie still goes to the bank nearer the network
  const q1r = B.runQuote(s, 'road', run1.slice().reverse(), {});
  ok(q1r.cross.shores[0].end === 0 && q1r.cross.shores[0].net === false && q1r.cross.shores[0].tie.tiles.length === 3 && q1r.cross.shores[1].net === true && q1r.cross.ties[0].end === 1 && q1r.cross.ties[0].net === true, 'dragged from the far side: bank 0 is now the far path, the campus tie is on bank 1 and still listed first');
  // Alt (noTie): the run alone
  s.economy.cash = 4000000;
  const prAlt = B.placeRun(s, 'road', run1, { noTie: true });
  ok(prAlt.ok && prAlt.placed === 11 && !prAlt.tie && !prAlt.ties && prAlt.cost === q1.cost && surfAt(37, 20) === SURF.NONE && surfAt(25, 20) === SURF.NONE && B.connectedMask(s)[at(36, 20)] === 0, 'noTie (Alt): the run is laid, no tie on either bank, nothing connected');
  ok(B.undo(s).ok && run1.every((i) => s.tiles.surface[i] === SURF.NONE) && s.economy.cash === 4000000, 'undone');
  // the release: one purchase, one undo record
  const pr1 = B.placeRun(s, 'road', run1, {});
  ok(pr1.ok && pr1.placed === 11 && pr1.ties && pr1.ties.length === 2 && pr1.tie === pr1.ties[0] && pr1.cost === q1.cost + c1.cost && 4000000 - s.economy.cash === pr1.cost, 'placeRun lays the run and both ties in one purchase: $' + pr1.cost);
  ok(run1.every((i) => s.tiles.surface[i] === SURF.ROAD) && [37, 38, 39, 25, 24, 23].every((x) => surfAt(x, 20) === SURF.PATH), 'the road and six gravel tie tiles are on the map');
  ok(B.connectedMask(s)[at(22, 18)] === 1 && B.connectedMask(s)[at(22, 22)] === 1 && joined(at(22, 22), at(40, 8)), 'the far-bank path is on the campus network now');
  const ui1 = B.undoInfo(s);
  ok(ui1 && ui1.n === 11 && ui1.connector === 6 && ui1.refund === pr1.cost, 'one undo record: 11 × Campus Road + 6 path tiles, refund $' + (ui1 && ui1.refund));
  ok(B.undo(s).ok && run1.every((i) => s.tiles.surface[i] === SURF.NONE) && [37, 38, 39, 25, 24, 23].every((x) => surfAt(x, 20) === SURF.NONE) && s.economy.cash === 4000000 && B.connectedMask(s)[at(22, 20)] === 0, 'one undo takes the run and both ties back and refunds everything');

  // (b) a bank that already touches a surface needs no tie; a far path that IS connected snaps on in the run's own material
  const q2 = B.runQuote(s, 'road', row(20, 39, 23), {});
  ok(q2.cross && q2.cross.ties.length === 0 && q2.cross.shores[0].touch && q2.cross.shores[0].net && q2.cross.shores[1].touch && !q2.cross.shores[1].net && q2.touches === true, 'a run that starts beside the campus path and ends beside the far path: both banks touch, no tie');
  B.placeRun(s, 'road', run1, { ignoreCash: true });   // the crossing of (a) stands: the far path is campus now
  const q3 = B.runQuote(s, 'road', row(22, 36, 26), {});
  ok(q3.cross && q3.cross.ties.length === 2 && q3.cross.ties.every((t) => t.tiles.length === 1 && t.snap === true && t.surfaces[0] === 'road' && t.cost === ROAD) && q3.cross.ties[0].net && q3.cross.ties[0].end === 0, 'a second crossing two rows south: each bank snaps on with one road tile (the first bank carries the campus tie on a draw)');
  wipe(run1.concat(row(20, 37, 39), row(20, 23, 25)));
  ok(B.connectedMask(s)[at(22, 20)] === 0 && surfAt(36, 20) === SURF.NONE, '(the crossing is cleared again)');

  // (c) nothing in reach: nothing is laid on that bank, and the quote says how far it looked
  const run4 = row(44, 36, 26), q4 = B.runQuote(s, 'road', run4, {});
  ok(q4.cross && q4.cross.ties.length === 0 && q4.cross.shores.every((sh) => !sh.touch && !sh.net && sh.tie === null && sh.reach === 6) && q4.touches === false, 'far from everything: no tie on either bank, reach 6 reported for both');
  const pr4 = B.placeRun(s, 'road', run4, { ignoreCash: true });
  ok(pr4.ok && pr4.placed === 11 && !pr4.ties && pr4.cost === q4.cost, 'released: the crossing alone'); wipe(run4);
  // the campus tie reaches autoTieMax (12), the other bank crossTieMax (6)
  gravel([at(18, 30)]);   // a stray path tile that needs a 7-tile tie from the far bank end (26, 30)
  const q5 = B.runQuote(s, 'road', row(30, 36, 26), {});
  ok(q5.cross.shores[1].tie === null && q5.cross.shores[1].reach === 6, 'a path a 7-tile tie away from the far bank is out of reach (crossTieMax 6)');
  gravel([at(19, 30)]);
  const q5b = B.runQuote(s, 'road', row(30, 36, 26), {});
  ok(q5b.cross.shores[1].tie && q5b.cross.shores[1].tie.tiles.length === 6 && q5b.cross.shores[1].net === false, 'one tile closer: a 6-tile tie (any surface counts, connected to campus or not)');
  { const near = B.runQuote(s, 'road', row(28, 36, 26), {}).cross.shores[0]; ok(near.net && near.tie && near.tie.tiles.length === 11, 'the campus tie still reaches as far as every drag end does (11 tiles here, autoTieMax 12): ' + (near.tie && near.tie.tiles.length)); }
  wipe([at(18, 30), at(19, 30)]);

  // (d) a tie stays on its own bank: never over open water, never across unchartered land
  gravel([at(33, 48)]);   // a path tile on the near bank only
  const q6 = B.runQuote(s, 'road', row(50, 33, 29), {});
  ok(q6.cross.shores[0].tie && q6.cross.shores[0].tie.tiles.length === 1 && q6.cross.shores[0].tie.tiles[0] === at(33, 49) && q6.cross.shores[1].tie === null, 'the far bank does not reach back over the water for the near bank\'s path (5 tiles as planks): no tie');
  ok([q1, q3, q5b, q6].every((q) => q.cross.ties.every((t) => t.water === 0 && t.tiles.every((i) => s.tiles.type[i] !== T.BAYOU))), 'no tie tile of any quote is on water');
  wipe([at(33, 48)]);
  { const L = BSU.land, m0 = L.mask, r0 = L.refusal, mask = new Uint8Array(N).fill(1); for (let y = 12; y <= 28; y++) mask[at(24, y)] = 0;   // a strip of state land between the far bank and its path
    L.mask = () => mask; L.refusal = (st, tiles) => { for (const i of tiles) if (mask[i] !== 1) return { id: 1, reason: 'Charter this section at the Land Office', i: i, tx: i % W, ty: (i / W) | 0, forSale: true }; return null; };
    const qc = B.runQuote(s, 'road', run1, {});
    ok(qc.cross.shores[1].tie === null && qc.cross.shores[0].tie && qc.cross.shores[0].tie.tiles.length === 3, 'state land between the far bank and its path: no tie across it (the near bank still ties)');
    L.mask = m0; L.refusal = r0;
    ok(B.runQuote(s, 'road', run1, {}).cross.shores[1].tie.tiles.length === 3, 'chartered again: the 3-tile tie is back');
  }

  // -------------------------------------------------------------------------------------------------------------------
  console.log('--- buildings: Pedestrian Bridge landings ---');
  marsh(33, 36); marsh(29, 36);
  gravel([at(35, 37)]); gravel([at(26, 36), at(25, 36)]);   // a path two tiles from each landing, far from campus
  const runP = row(36, 33, 29), qp = B.runQuote(s, 'bridge', runP, {});
  ok(qp.refused === 0 && qp.placed === 5 && qp.landings === 2 && qp.landingCost === 2 * PATH && qp.cost === 3 * PED + 2 * PATH && qp.extra.length === 0, 'bank to bank: 3 deck tiles + 2 gravel landings, both priced in the quote ($' + qp.cost + ')');
  ok(qp.cross && qp.cross.ties.length === 2 && qp.cross.ties.every((t) => t.tiles.length === 2 && t.snap && t.surfaces.every((v) => v === 'path')) && qp.cross.cost === 4 * PATH, 'each landing ties on (2 tiles each, gravel: a bridge deck never goes on land)');
  s.economy.cash = 4000000;
  const prP = B.placeRun(s, 'bridge', runP, {});
  ok(prP.ok && prP.placed === 5 && prP.ties.length === 2 && prP.cost === qp.cost + qp.cross.cost && 4000000 - s.economy.cash === prP.cost, 'released: $' + prP.cost + ' in one purchase');
  ok([32, 31, 30].every((x) => surfAt(x, 36) === SURF.BRIDGE) && surfAt(33, 36) === SURF.PATH && surfAt(29, 36) === SURF.PATH && joined(at(35, 37), at(25, 36)), 'the deck on the water, gravel on both landings, and the two bank paths are one route');
  ok(B.undo(s).ok && runP.every((i) => s.tiles.surface[i] === SURF.NONE) && surfAt(34, 36) === SURF.NONE && surfAt(28, 36) === SURF.NONE && s.economy.cash === 4000000, 'one undo: deck, landings and ties gone, cash back');
  // a run that starts and ends on the water: the land it steps off onto gets the gravel
  const runW = row(36, 32, 30), qw = B.runQuote(s, 'bridge', runW, {});
  ok(qw.placed === 5 && qw.landings === 2 && qw.extra.join() === [at(33, 36), at(29, 36)].join() && qw.cost === 3 * PED + 2 * PATH && qw.cross && qw.cross.ties.length === 2, 'a drag over the three water tiles only: the landings just off the run are added (extra) and tie on');
  const prW = B.placeRun(s, 'bridge', runW, { ignoreCash: true });
  ok(prW.placed === 5 && surfAt(33, 36) === SURF.PATH && surfAt(29, 36) === SURF.PATH && joined(at(35, 37), at(25, 36)), 'released: the same bridge as the bank-to-bank drag');
  B.undo(s);
  { const q1t = B.runQuote(s, 'bridge', [at(32, 36)], {}); ok(q1t.placed === 2 && q1t.extra.length === 1 && q1t.extra[0] === at(33, 36), 'a one-tile bridge beside the bank: one landing, counted once'); }
  // an approach: every bare land tile of a bridge run is gravel; an existing surface is passed over
  const qa = B.runQuote(s, 'bridge', row(36, 35, 26), {});
  ok(qa.refused === 0 && qa.landings === 6 && qa.placed === 9 && qa.cost === 3 * PED + 6 * PATH && qa.same.length === 0 && qa.cross.ties.length === 0 && qa.cross.shores.every((sh) => sh.touch), 'a drag from beside one path onto the other: 3 deck + 6 gravel (the path tile at its end passed over), both banks connected, no tie');
  // refused landings: one clear reason on the span, nothing laid
  s.tiles.flags[at(33, 36)] |= FLAG.MOUND;
  const WHY = 'The bridge landing cannot take a path (the Mounds)';
  const qm = B.runQuote(s, 'bridge', row(36, 34, 28), {});
  ok(qm.placed === 0 && qm.refused === 7 && qm.skipped.slice(0, 5).every((k) => k.reason === WHY) && qm.cross === null, 'a mound on the near landing: the approach, the landing and the span are refused with one reason: ' + qm.skipped[0].reason);
  const prM = B.placeRun(s, 'bridge', row(36, 34, 28), { ignoreCash: true });
  ok(!prM.ok && prM.placed === 0 && prM.skipped[0].reason === WHY && row(36, 34, 28).every((i) => s.tiles.surface[i] === SURF.NONE), 'released: nothing is laid, not even the approach gravel');
  const qmw = B.runQuote(s, 'bridge', runW, {});
  ok(qmw.placed === 0 && qmw.skipped.every((k) => k.reason === WHY) && qmw.extra.length === 0, 'the same mound under a drag that starts on the water: refused with the same reason');
  s.tiles.flags[at(33, 36)] &= ~FLAG.MOUND;
  s.tiles.owner[at(29, 36)] = 0;
  const qo = B.runQuote(s, 'bridge', runP, {});
  ok(qo.placed === 0 && qo.skipped.length === 5 && qo.skipped.every((k) => k.reason === 'The bridge landing cannot take a path (occupied)'), 'an occupied far landing: every tile of the run refused with that one reason (' + qo.skipped[1].reason + ')');
  s.tiles.owner[at(29, 36)] = -1;
  { const L = BSU.land, m0 = L.mask, r0 = L.refusal, mask = new Uint8Array(N).fill(1); mask[at(29, 36)] = 0;
    L.mask = () => mask; L.refusal = (st, tiles) => { for (const i of tiles) if (mask[i] !== 1) return { id: 1, reason: 'Charter this section at the Land Office', i: i, tx: i % W, ty: (i / W) | 0, forSale: true }; return null; };
    const qu = B.runQuote(s, 'bridge', runP, {});
    ok(qu.placed === 0 && qu.skipped.some((k) => /^Charter this section/.test(k.reason)) && qu.skipped.filter((k) => /^Charter this section/.test(k.reason)).length >= 4, 'a landing on state land: the span is refused with the Land Office reason');
    L.mask = m0; L.refusal = r0;
  }
  ok(B.runQuote(s, 'bridge', row(36, 40, 36), {}).skipped.every((k) => k.reason === 'Bridges go over water') && B.runQuote(s, 'bridge', row(36, 40, 36), {}).placed === 0, 'a bridge run that never reaches water: refused, no stray gravel');
  ok(B.canPlace(s, 'bridge', 34, 36, {}).reason === 'Bridges go over water' && B.canPlace(s, 'bridge', 31, 36, {}).reason === 'Both ends must reach land', 'the single-tile reasons are unchanged');
  wipe([at(35, 37), at(26, 36), at(25, 36)]);

  // -------------------------------------------------------------------------------------------------------------------
  console.log('--- buildings: no orphan stubs ---');
  for (let x = 26; x <= 29; x++) water(x, 54);   // row 54: 7 water tiles (26–32)
  const runL = row(54, 35, 23), ql = B.runQuote(s, 'road', runL, {});
  ok(ql.placed === 3 && ql.refused === 10 && ql.cut === 3 && ql.skipped.slice(0, 7).every((k) => k.reason === 'Bridges span 3 water tiles at most (this reach is 7)') && ql.skipped.slice(7).every((k) => /^Not laid: /.test(k.reason)), 'a 7-tile reach: the span refused with the cap and the reach, the three tiles past it not laid (' + ql.skipped[0].reason + ')');
  const prL = B.placeRun(s, 'road', runL, { ignoreCash: true, noTie: true });
  ok(prL.placed === 3 && [35, 34, 33].every((x) => surfAt(x, 54) === SURF.ROAD) && [23, 24, 25].every((x) => surfAt(x, 54) === SURF.NONE), 'released: the near side up to the bank, nothing on the far bank');
  ok(prL.skipped.length === ql.skipped.length && prL.skipped.every((k, n) => k.i === ql.skipped[n].i && k.reason === ql.skipped[n].reason), 'placeRun skipped exactly what the quote listed');
  wipe([at(35, 54), at(34, 54), at(33, 54)]);
  { const qt = B.runQuote(s, 'road', runL, {}); ok(qt.cross === null && qt.tie === null && qt.touches === false, 'a refused crossing is no crossing: no bank ties are quoted (the laid part ties like any road end)'); }
  // a boardwalk is laid up to the first wet tile that takes nothing; a wet tile that already carries a path is a junction, not a block
  marsh(33, 58); marsh(29, 58);
  const runB = row(58, 34, 28);
  const qb = B.runQuote(s, 'boardwalk', runB, {});
  ok(qb.refused === 0 && qb.placed === 7 && qb.cost === 7 * WALK && !!qb.cross, 'a boardwalk over marsh · 3 water · marsh: 7 tiles, a crossing');
  s.tiles.owner[at(31, 58)] = 0;
  const qbb = B.runQuote(s, 'boardwalk', runB, {});
  ok(qbb.placed === 3 && qbb.refused === 4 && qbb.skipped[0].i === at(31, 58) && qbb.skipped[0].reason === 'Occupied' && qbb.cut === 3 && qbb.skipped.slice(1).every((k) => /^Not laid: /.test(k.reason)), 'a blocked water tile: laid up to it (3 tiles), nothing past it');
  s.tiles.owner[at(31, 58)] = -1;
  gravel([at(33, 58)]);
  const qbj = B.runQuote(s, 'boardwalk', runB, {});
  ok(qbj.placed === 6 && qbj.refused === 1 && qbj.cut === 0 && qbj.skipped[0].reason === 'Occupied', 'a path already on the marsh bank: that tile is passed (a junction), both sides are laid');
  wipe([at(33, 58)]);
  // cash: a crossing is bought whole
  s.economy.cash = -1e12;
  const prC = B.placeRun(s, 'road', run1, {});
  ok(!prC.ok && prC.placed === 0 && /cash/i.test(prC.skipped[0].reason) && run1.every((i) => s.tiles.surface[i] === SURF.NONE), 'no money for the whole crossing: nothing is laid (never half a bridge)');
  s.economy.cash = 4000000;

  // -------------------------------------------------------------------------------------------------------------------
  console.log('--- buildings.crossSnap ---');
  gravel(row(54, 14, 18)); gravel(col(21, 57, 60));   // path A ends at (18, 54) heading east (in line: (19, 54)); path B ends at (21, 57) heading north (in line: (21, 56))
  const FROM = at(36, 55), snap = (x, y, prev, id) => xy(B.crossSnap(s, id || 'road', FROM, at(x, y), prev === undefined ? -1 : prev)).join();
  ok(snap(19, 55) === '19,54', 'one tile from the tile in line with path A\'s end: the run ends there');
  ok(snap(21, 55) === '21,56', 'one tile from the tile in line with path B\'s end: there');
  ok(snap(20, 55) === '19,54' && snap(20, 55, at(21, 56)) === '21,56' && snap(20, 55, at(19, 54)) === '19,54', 'equally near both: the first found, or the previous choice while it is as good (no flip-flop)');
  { let prev = -1; const seq = []; for (const x of [22, 21, 20, 19]) { const t = B.crossSnap(s, 'road', FROM, at(x, 55), prev); seq.push(xy(t).join()); prev = t; } ok(seq.join(' ') === '21,56 21,56 21,56 19,54', 'sliding west along row 55: B, B, B (kept on the tie), then A: ' + seq.join(' ')); }
  { let prev = -1; const seq = []; for (const x of [19, 20, 21]) { const t = B.crossSnap(s, 'road', FROM, at(x, 55), prev); seq.push(xy(t).join()); prev = t; } ok(seq.join(' ') === '19,54 19,54 21,56', 'sliding back east: A, A (kept), then B: ' + seq.join(' ')); }
  ok(snap(18, 52) === '18,53', 'only a side tile of the end in reach: the run ends beside it');
  ok(snap(19, 53) === '19,54' && snap(24, 52) === '24,52' && snap(19, 54) === '19,54', 'the tile in line beats a side tile; nothing within tieSnap → the cursor\'s own tile; already beside a surface → itself');
  ok(snap(31, 54) === '31,54' && snap(19, 55, -1, 'path') === '19,55' && snap(19, 55, -1, 'levee') === '19,55', 'over water, or with a tool that is no crossing tool: no snap');
  ok(snap(18, 54, -1, 'bridge') === '18,54' && snap(18, 54, -1, 'road') === '18,54' && snap(18, 54, -1, 'boardwalk') === '19,54', 'the cursor ON the path\'s end: a bridge passes over it, a road replaces it, a boardwalk steps back to the free tile beside it');
  ok(snap(19, 55, -1, 'boardwalk') === '19,54' && snap(19, 55, -1, 'bridge') === '19,54', 'the boardwalk and the Pedestrian Bridge snap the same way');
  wipe(row(54, 14, 18).concat(col(21, 57, 60)));

  // -------------------------------------------------------------------------------------------------------------------
  console.log('--- the planner: both banks in the score ---');
  wipe(col(22, 18, 22));   // (the far path of the first block is no longer needed)
  gravel(col(27, 26, 28));   // a far-bank path that is one tile from row 24's bank tiles and three from row 20's
  s.ui.tool = { id: 'road', rot: 0, shift: false };
  const A0 = at(39, 20), C0 = at(25, 24);
  const xFirst = row(20, 39, 25).concat(col(25, 21, 24)), yFirst = col(39, 20, 24).concat(row(24, 38, 25));
  const qx = U._ux.quoteRun(s, xFirst), qy = U._ux.quoteRun(s, yFirst);
  ok(qx.cross.shores[0].touch && qy.cross.shores[0].touch && qx.cross.shores[1].tie.tiles.length === 3 && qy.cross.shores[1].tie.tiles.length === 1, 'both Ls start beside the campus path; the x-first L needs a 3-tile far tie, the y-first L a 1-tile one');
  ok(qx.tieRank === 3 && qy.tieRank === 1 && qx.refused === qy.refused && qx.wet === qy.wet, 'tieRank is the sum over both banks (3 and 1); refusals and wet tiles are equal');
  { const q198 = U._ux.quoteRun(s, run4); ok(q198.tieRank === 198, 'a crossing with nothing in reach on either bank ranks 99 + 99'); }
  { let tool = null; const m = U._machine({ getTool: () => tool, setTool: (t) => { tool = t; }, quote: (run) => U._ux.quoteRun(s, run) });
    const P = (i) => ({ px: (i % W) * 20 + 10, py: ((i / W) | 0) * 11 + 5 });
    m.step({ type: 'tool', id: 'road' }); m.step({ type: 'down', ...P(A0), button: 0, mods: M0 }); m.step({ type: 'move', ...P(C0), button: 0, mods: M0 });
    ok(m.elbow === 1 && m.run.join() === yFirst.join() && m.plan.tieRank === 1, 'the machine picks the y-first L (the default elbow is x-first: the far bank decided)');
    m.step({ type: 'cancel' }); }
  s.ui.tool = null; wipe(col(27, 26, 28));

  // -------------------------------------------------------------------------------------------------------------------
  console.log('--- the machine: the end snap ---');
  {
    const I = at, P = (x, y) => ({ px: x * 20 + 10, py: y * 11 + 5 }); let tool = null, target = -1, calls = 0, bad = new Set();
    const quote = (run) => { let refused = 0; for (const i of run) if (bad.has(i)) refused++; return { n: run.length, refused: refused, skipped: [], same: [], placed: run.length - refused, cost: 0, wet: 0, tieRank: 0, touches: true, tie: null, cross: {} }; };
    const mk = (withQuote) => U._machine({ getTool: () => tool, setTool: (t) => { tool = t; }, quote: withQuote === false ? null : quote, snapEnd: (a, j, prev, plan) => { calls++; return target >= 0 ? target : j; } });
    const go = (m, ax, ay) => { m.step({ type: 'tool', id: 'road' }); m.step({ type: 'down', ...P(ax, ay), button: 0, mods: M0 }); };
    const mv = (m, x, y, mods) => m.step({ type: 'move', ...P(x, y), button: 0, mods: mods || M0 });
    let m = mk(); go(m, 30, 10); target = I(22, 12); mv(m, 22, 10);
    ok(m.run.length === 11 && m.run[8] === I(22, 10) && m.run[9] === I(22, 11) && m.run[10] === I(22, 12) && m.snapEnd === I(22, 12) && m.plan.n === 11, 'the run keeps its line and steps on to the snap tile: row 10, then (22, 11), (22, 12)');
    target = I(21, 11); mv(m, 22, 10); mv(m, 23, 10); mv(m, 22, 10);
    ok(m.run.length === 11 && m.run[9] === I(21, 10) && m.run[10] === I(21, 11) && m.snapEnd === I(21, 11), 'a diagonal step: along the row first when both ways quote the same');
    bad = new Set([I(21, 10)]); mv(m, 23, 10); mv(m, 22, 10);
    ok(m.run[9] === I(22, 11) && m.run[10] === I(21, 11) && m.plan.refused === 0, 'a refused tile on one way: the other way');
    bad = new Set([I(21, 10), I(22, 11)]); mv(m, 23, 10); mv(m, 22, 10);
    ok(m.run.length === 9 && m.run[8] === I(22, 10) && m.snapEnd === -1, 'both ways refused: the plain run stays (a snap never trades a legal run for a refused one)');
    bad = new Set(); target = I(23, 10); mv(m, 24, 9);
    ok(m.run.length === 8 && m.run.every((i) => ((i / W) | 0) === 10) && m.run[7] === I(23, 10) && m.snapEnd === I(23, 10), 'an L whose last leg overshoots: cut back to the tile nearest the snap tile, then on to it (one straight run along row 10)');
    target = -1; mv(m, 24, 8); ok(m.snapEnd === -1 && m.run[m.run.length - 1] === I(24, 8), 'no snap answer: the run ends on the cursor again');
    calls = 0; target = I(22, 12); mv(m, 22, 10, SH);
    ok(calls === 0 && m.run.length === 9 && m.run.every((i) => ((i / W) | 0) === 10) && m.snapEnd === -1, 'Shift: the straight line, the snap is not consulted');
    m.step({ type: 'up', ...P(22, 10), button: 0, mods: M0 }); ok(m.snapEnd === -1, 'release resets it');
    m = mk(false); go(m, 30, 10); calls = 0; mv(m, 22, 10); ok(calls === 0 && m.run.length === 9, 'no quote, no snap (the pure machine tests of the roads pass are unaffected)');
    m.step({ type: 'cancel' });
  }
  BSU.state = live64; B.reset(live64, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. the live game on seed 42 at 96: the scene's drags through ui.pointer (tools/qa/crossings_scene.mjs does the same in Chrome)
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- live: one drag connects both banks ---');
{
  const W = 96, I = (x, y) => y * W + x, xy = (i) => (i % W) + ',' + ((i / W) | 0);
  const row = (y, x0, x1) => { const t = [], st = x1 >= x0 ? 1 : -1; for (let x = x0; x !== x1 + st; x += st) t.push(I(x, y)); return t; };
  const col = (x, y0, y1) => { const t = [], st = y1 >= y0 ? 1 : -1; for (let y = y0; y !== y1 + st; y += st) t.push(I(x, y)); return t; };
  let ghost = null; const g0 = R.ghost; R.ghost = function (spec) { if (spec) ghost = spec; return g0.apply(R, arguments); };
  const l1 = () => U.el['ghost-l1'].textContent, l2 = () => U.el['ghost-l2'].textContent;
  let s = null, cash0 = 0, before = null;
  const fresh = (centre, clear, paths) => {
    BSU.session.newGame({ seed: 42, skipTutorial: true, size: 96 }); s = BSU.state; unlockAll(); U.showTitle(false); U.update(s, 50);
    for (let k = s.veg.length - 1; k >= 0; k--) { const v = s.veg[k]; if (v && v.tx >= clear[0] && v.tx <= clear[2] && v.ty >= clear[1] && v.ty <= clear[3]) BSU.terrain.removeVeg(s, v.tx, v.ty); }
    for (const p of paths) B.placeRun(s, 'path', p, { ignoreCash: true, noTie: true });
    s.economy.cash = 1e7; R.setZoom(1); R.panToTile(centre[0], centre[1], false); cash0 = s.economy.cash; before = Array.from(s.tiles.surface);
  };
  const px = (tx, ty) => { const p = R.tileToScreen(tx, ty), hit = (x, y) => { const t = R.screenToTile(x, y); return !!t && Math.floor(t.tx) === tx && Math.floor(t.ty) === ty; };
    if (hit(p.x, p.y)) return p; for (let r = 1; r <= 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; if (hit(p.x + dx * 4, p.y + dy * 2)) return { x: p.x + dx * 4, y: p.y + dy * 2 }; } return p; };
  const hold = (tool, from, to, mods) => { mods = mods || M0; U.selectTool(s, tool); const a = px(from[0], from[1]), b = px(to[0], to[1]); U.pointer('move', a.x, a.y, 0, mods); U.pointer('down', a.x, a.y, 0, mods); for (let k = 1; k <= 12; k++) U.pointer('move', a.x + (b.x - a.x) * k / 12, a.y + (b.y - a.y) * k / 12, 0, mods); return b; };
  const release = (b, mods) => { U.pointer('up', b.x, b.y, 0, mods || M0); };
  const laid = () => { const out = []; for (let i = 0; i < s.tiles.surface.length; i++) if (s.tiles.surface[i] !== before[i] && s.tiles.surface[i] !== 0) out.push(i); return out; };
  const walks = (far, near) => { const r = BSU.agents.routeSync(s, far, near, 'walk'); return !!r && r.length > 1 && r.every((i) => access(s.tiles.surface[i])); };
  const ties = () => { const tp = R.tiePreviewSpec(); return tp ? (Array.isArray(tp.ties) ? tp.ties.map((t) => t.tiles.length) : [tp.tiles.length]) : []; };
  const A = { centre: [76, 49], clear: [64, 44, 84, 53], far: [row(50, 69, 72)], farEnd: I(72, 50), near: I(80, 48) };
  const seen = (line) => line.map((i) => { const t = BSU.state.tiles; if (t.flags[i] & (FLAG.BAYOU | FLAG.OPEN_WATER)) return 'w'; if (t.type[i] === T.MARSH) return 'm'; return t.surface[i] ? 's' : 'd'; }).join('');

  // (a) Pedestrian Bridge, bank to bank
  fresh(A.centre, A.clear, A.far);
  ok(seen(row(48, 73, 80)) === 'dmwwwmds' && B.connectedMask(s)[A.near] === 1 && B.connectedMask(s)[A.farEnd] === 0, 'site A (row 48): dry · marsh · 3 water · marsh · dry · the campus path; the far path is not connected');
  let b = hold('bridge', [78, 48], [74, 48]);
  ok(U.state === 'DRAGGING' && ghost.tiles.map(xy).join(' ') === '78,48 77,48 76,48 75,48 74,48' && !ghost.skipTiles && ghost.color === 'green', '(a) the ghost: the five run tiles, green, nothing red');
  ok(l1() === 'Bridge 3 tiles + 2 path · $139k + $8,000 ties (both banks)', '(a) the label quotes the deck, the landings and both ties: "' + l1() + '"');
  ok(/^Near bank: snaps on \(1 tile\) · Far bank: ties in \(3 tiles\)/.test(l2()), '(a) the status names each bank: "' + l2() + '"');
  { const tp = R.tiePreviewSpec(); ok(tp && Array.isArray(tp.ties) && tp.ties.length === 2 && ties().join() === '1,3' && tp.tiles.length === 4 && tp.ties[0].end === 0 && tp.ties[1].end === 1, '(a) the ghost draws both ties (1 tile on the near bank, 3 on the far bank)'); }
  release(b);
  ok(laid().length === 9 && cash0 - s.economy.cash === 147000 && s.ui.tool && s.ui.tool.id === 'bridge', '(a) one release: 9 tiles for $147k, the tool stays armed for the next drag');
  ok(s.tiles.surface[I(78, 48)] === SURF.PATH && s.tiles.surface[I(74, 48)] === SURF.PATH && [75, 76, 77].every((x) => s.tiles.surface[I(x, 48)] === SURF.BRIDGE), '(a) the landings are gravel, the deck is on the water');
  ok(B.connectedMask(s)[A.farEnd] === 1 && walks(A.farEnd, A.near), '(a) the far-bank path is on the campus network and an agent walks from it to campus on surfaces only');
  { // they look joined: the deck's dead end (and its round cap) is not drawn on the bank at ground level, the landing's gravel not on the bed under the water
    const cv = R.curves.build(s), hid = R.curves.spillHidden;
    ok(typeof hid === 'function' && cv.deck[I(75, 48)] === cv.deck[I(75, 48)] && cv.deck[I(74, 48)] !== cv.deck[I(74, 48)], 'render: the bridge tiles are decks, the landing is ground');
    ok(hid(cv, 74, 48, SURF.BRIDGE, false) === true && hid(cv, 78, 48, SURF.BRIDGE, false) === true, 'render: the landing tiles do not draw the bridge\'s spilled end (no floating round cap on the bank)');
    ok(hid(cv, 75, 48, SURF.PATH, true) === true, 'render: a deck tile draws no ground-level spill (no gravel on the bed under the bridge)');
    ok(hid(cv, 80, 47, SURF.BRIDGE, false) === false && hid(cv, 79, 48, SURF.BRIDGE, false) === false, 'render: tiles with no bridge beside them are unaffected');
    const deckSteps = (i) => (cv.steps.get(i) || []).filter((st) => st.kind === SURF.BRIDGE && st.deck === true).length;
    ok(deckSteps(I(74, 48)) === 1 && deckSteps(I(78, 48)) === 1, 'render: each landing carries the bridge\'s steps down from the deck');
  }
  ok(U.keydown('z', { ...M0, ctrl: true }) === true && laid().length === 0 && s.economy.cash === cash0 && B.connectedMask(s)[A.farEnd] === 0, '(a) one Ctrl+Z takes the bridge, the landings and both ties back and refunds $147k');
  // (a′) Alt: no ties at all, no snapping
  b = hold('bridge', [78, 48], [74, 48], MA);
  ok(R.tiePreviewSpec() === null && l1() === 'Bridge 3 tiles + 2 path · $139k' && /^No tie \(Alt held\)/.test(l2()), '(a′) Alt held: no tie preview, "' + l1() + '" / "' + l2() + '"');
  release(b, MA);
  ok(laid().length === 5 && cash0 - s.economy.cash === 139000 && B.connectedMask(s)[A.farEnd] === 0, '(a′) released with Alt: the bridge and its landings only');
  U.keydown('z', { ...M0, ctrl: true }); U.selectTool(s, null);

  // (b) Pedestrian Bridge from the near path's end to the far path's end
  fresh(A.centre, A.clear, A.far);
  b = hold('bridge', [80, 48], [72, 50]);
  ok(l1() === 'Bridge 3 tiles + 4 path · $143k' && /^Near bank: connected · Far bank: connected/.test(l2()) && R.tiePreviewSpec() === null, '(b) path end to path end: "' + l1() + '" / "' + l2() + '", no tie needed');
  release(b);
  ok(laid().length === 7 && cash0 - s.economy.cash === 143000 && B.connectedMask(s)[A.farEnd] === 1 && walks(A.farEnd, A.near), '(b) what the label said is what was charged ($143k); connected, walkable');
  U.selectTool(s, null);

  // (c) Campus Road from beside the near path's end: the deck carries over both marsh banks, the end lines up with the far path
  fresh(A.centre, A.clear, A.far);
  b = hold('road', [79, 48], [73, 48]);
  ok(ghost.tiles.map(xy).join(' ') === '79,48 78,48 77,48 76,48 75,48 74,48 73,48 73,49 73,50', '(c) the run keeps row 48 and ends on the tile in line with the far path\'s end (73, 50): ' + ghost.tiles.map(xy).join(' '));
  ok(l1() === '9 tiles · $240k' && /^Near bank: connected · Far bank: connected/.test(l2()), '(c) "' + l1() + '" / "' + l2() + '"');
  release(b);
  ok(laid().length === 9 && laid().every((i) => s.tiles.surface[i] === SURF.ROAD) && cash0 - s.economy.cash === 240000 && B.connectedMask(s)[A.farEnd] === 1 && walks(A.farEnd, A.near), '(c) a 5-tile deck (3 water + both banks) and four road tiles, $240k; connected, walkable');
  { const cv = R.curves.build(s); ok(R.curves.spillHidden(cv, 72, 50, SURF.ROAD, false) === false && R.curves.spillHidden(cv, 73, 50, SURF.PATH, false) === false && [74, 75, 76, 77, 78].every((x) => cv.deck[I(x, 48)] === cv.deck[I(x, 48)]), 'render: the road meets the far path at ground level (a flush join, drawn as before); the deck carries over both marsh banks'); }
  U.keydown('z', { ...M0, ctrl: true });
  b = hold('road', [79, 48], [73, 48]);
  U.keydown('Alt', M0);
  ok(ghost.tiles.length === 7 && ghost.tiles[6] === I(73, 48) && R.tiePreviewSpec() === null, '(c) Alt pressed mid-drag: the end snap lets go at once (the run ends on the cursor), no mouse move needed');
  U.keyup('Alt');
  ok(ghost.tiles.length === 9 && ghost.tiles[8] === I(73, 50), '(c) Alt released: the snap is back');
  U.keydown('Escape', M0);
  b = hold('road', [79, 48], [73, 48], SH);
  ok(ghost.tiles.map(xy).join(' ') === '79,48 78,48 77,48 76,48 75,48 74,48 73,48' && /Far bank: snaps on \(2 tiles\)/.test(l2()), '(c′) Shift: the straight line, no end snap (the far bank ties instead): "' + l2() + '"');
  U.keydown('Escape', M0);
  b = hold('road', [79, 48], [73, 48], MA);
  ok(ghost.tiles.map(xy).join(' ') === '79,48 78,48 77,48 76,48 75,48 74,48 73,48' && R.tiePreviewSpec() === null && /^No tie \(Alt held\)/.test(l2()), '(c″) Alt: the run ends on the cursor, no ties');
  U.keydown('Escape', M0); U.selectTool(s, null);

  // (d) Boardwalk across a marsh-fringed reach
  fresh([78, 53], [66, 47, 87, 58], [col(83, 48, 52), row(54, 70, 73)]);
  ok(seen(row(53, 75, 81)) === 'dmmwwmd' && B.connectedMask(s)[I(83, 52)] === 1 && B.connectedMask(s)[I(73, 54)] === 0, 'site D (row 53): dry · 2 marsh · 2 water · marsh · dry');
  b = hold('boardwalk', [81, 53], [75, 53]);
  ok(/^9 tiles · \$126k \+ \$28k snap \(near bank\)$/.test(l1()) && /^Near bank: snaps on \(2 tiles\) · Far bank: connected/.test(l2()) && ties().join() === '2', '(d) "' + l1() + '" / "' + l2() + '"');
  release(b);
  ok(laid().length === 11 && cash0 - s.economy.cash === 154000 && B.connectedMask(s)[I(73, 54)] === 1 && walks(I(73, 54), I(83, 52)), '(d) both ends joined: the far-bank path is on the network and walkable to campus');
  ok(s.tiles.walk[I(81, 53)] > 0 && s.tiles.walk[I(75, 53)] > 0, '(d) the boardwalk tiles on the dry banks are walkable (they were impassable on ground more than 2 ft above the stage)');
  U.selectTool(s, null);

  // (e) Campus Road over a reach of 4 water tiles
  fresh([73, 43], [64, 34, 84, 51], [row(38, 83, 74), row(49, 68, 70)]);
  ok(seen(col(72, 38, 47)) === 'dmmwwwwmmd', 'site E (column 72): dry · 2 marsh · 4 water · 2 marsh · dry');
  b = hold('road', [72, 38], [72, 47]);
  ok(ghost.skipTiles && ghost.skipTiles.length === 9 && ghost.tiles.length === 1 && ghost.color === 'yellow', '(e) the span and the far bank tile are red before release (' + (ghost.skipTiles && ghost.skipTiles.length) + ' tiles), the near tile stays');
  ok(/^1 tile · \$10k \+ \$10k snap$/.test(l1()) && /^8 tiles skipped: bridges span 3 water tiles at most \(this reach is 4\) · nothing is laid past it/.test(l2()), '(e) "' + l1() + '" / "' + l2() + '"');
  release(b);
  ok(laid().map(xy).sort().join(' ') === '72,38 73,38' && s.tiles.surface[I(72, 47)] === SURF.NONE && B.connectedMask(s)[I(72, 38)] === 1, '(e) released: the near tile and its snap onto the campus path; no stub on the far bank');
  U.selectTool(s, null);

  // the bank is where a bridge drag starts: the hover on land is a hint, not a refusal
  fresh(A.centre, A.clear, A.far);
  U.selectTool(s, 'bridge'); { const p = px(78, 48); U.pointer('move', p.x, p.y, 0, M0); }
  ok(U.el['ghost-label'].dataset.color === 'yellow' && /\/ tile$/.test(l1()) && /drag across the water/.test(l2()), 'the Pedestrian Bridge hovering the bank: "' + l1() + '" / "' + l2() + '"');
  U.selectTool(s, null);
  R.ghost = g0;
  const errs = [...BSU.errors.keys()];
  ok(errs.length === 0, 'no BSU.error' + (errs.length ? ': ' + errs.join(' | ').slice(0, 300) : ''));
}
BSU.progress.unlocked = unlock0.u; BSU.progress.unlockOk = unlock0.o;

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
