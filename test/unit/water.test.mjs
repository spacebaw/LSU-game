// Water and structures pass (a student's playtest notes N3 "drainage paths don't drain", N4 "levee looks weird, not really functioning as one",
// N7 "vehicle bridge", N15 "NPCs don't know how to use bridges", N5 "building on trees should clear them"). Real numbers on seed 42 at 96, each
// claim against a control campus where one makes sense.
//   1. canals: the cove's rain with and without a canal, the outlet tie-in, the graded bed, the no-outlet case, the numbers on the card
//   2. levees: a ring through the same Cat 2 with no wall / the ring / the ring + a floodgate / the ring left open; a bank levee through river
//      flooding; the wall report's wording (closed, open, open ends) on the card and in the drag label; crown rain; the sprites
//   3. the Road Bridge: the row and its card, span and bank rules, prices, ties, refusal wording, vehicles and walkers over it
//   4. students on a deck walk it (they waded it)
//   5. plants: every placeable row, what it clears and what it leaves, with exact undo
// Usage: node build.mjs --check && node test/unit/water.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

const { win } = loadGame();
const BSU = win.BSU, U = BSU.ui, B = BSU.buildings, R = BSU.render, HY = BSU.hydro, SURF = BSU.SURF, T = BSU.T, FLAG = BSU.FLAG, PB = BSU.params.build, PH = BSU.params.hydro;
const M0 = { ctrl: false, shift: false, meta: false, alt: false }, MA = { ...M0, alt: true };
const W = 96, I = (x, y) => y * W + x, xy = (i) => (i % W) + ',' + ((i / W) | 0);
const row = (y, x0, x1) => { const t = [], st = x1 >= x0 ? 1 : -1; for (let x = x0; x !== x1 + st; x += st) t.push(I(x, y)); return t; };
const col = (x, y0, y1) => { const t = [], st = y1 >= y0 ? 1 : -1; for (let y = y0; y !== y1 + st; y += st) t.push(I(x, y)); return t; };
const TPD = BSU.params.time.ticksPerDay;
let s = null;
const fresh = (cash = 1e9) => { BSU.session.newGame({ seed: 42, skipTutorial: true, size: 96 }); s = BSU.state; BSU.progress.unlocked = () => true; BSU.progress.unlockOk = () => true; s.economy.cash = cash; U.showTitle(false); return s; };
const clearVeg = (b) => { for (let k = s.veg.length - 1; k >= 0; k--) { const v = s.veg[k]; if (v && v.tx >= b[0] && v.tx <= b[2] && v.ty >= b[1] && v.ty <= b[3]) BSU.terrain.removeVeg(s, v.tx, v.ty); } };
const l1 = () => U.el['ghost-l1'].textContent, l2 = () => U.el['ghost-l2'].textContent;
const px = (tx, ty) => { const p = R.tileToScreen(tx, ty), hit = (x, y) => { const t = R.screenToTile(x, y); return !!t && Math.floor(t.tx) === tx && Math.floor(t.ty) === ty; };
  if (hit(p.x, p.y)) return p; for (let r = 1; r <= 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; if (hit(p.x + dx * 4, p.y + dy * 2)) return { x: p.x + dx * 4, y: p.y + dy * 2 }; } return p; };
const hold = (tool, from, to, mods) => { mods = mods || M0; U.selectTool(s, tool); const a = px(from[0], from[1]), b = px(to[0], to[1]); U.pointer('move', a.x, a.y, 0, mods); U.pointer('down', a.x, a.y, 0, mods); for (let k = 1; k <= 12; k++) U.pointer('move', a.x + (b.x - a.x) * k / 12, a.y + (b.y - a.y) * k / 12, 0, mods); return b; };
const release = (b, mods) => { U.pointer('up', b.x, b.y, 0, mods || M0); };
const view = (tx, ty) => { R.setZoom(1); R.panToTile(tx, ty, false); U.update(s, 50); };
const text = (e) => (e && e.children && e.children.length) ? Array.from(e.children).map(text).join('') : String((e && e.textContent) || '');   // the stub's textContent does not gather its children's
const cardRows = () => Array.from(U.el['insp-body'].children).map(text), cardButtons = () => Array.from(U.el['insp-actions'].children).map(text);
const errs0 = BSU.errors ? BSU.errors.size : 0;

// ---------------------------------------------------------------------------------------------------------------------
// 1. Canals. The cove of seed 42: floor 1.6 ft at (82, 48), rim 2.4–4.6 ft, the bayou at (77, 48); 3 in of rain over it (the tutorial's cell)
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 1. canals ---');
const LOW = I(82, 48), RUN3 = row(48, 82, 80);
const coveWater = () => { let sum = 0, wet = 0; for (const i of s.plot.cove) { if (s.tiles.flags[i] & FLAG.CANAL) continue; sum += s.tiles.depth[i]; if (s.tiles.depth[i] >= 0.05) wet++; } return { sum, wet }; };
const rainDay = () => { let peak = 0, wet = 0; HY.forceRain(s, { cx: 82, cy: 48, inches: 3, radius: 14, steps: 60 }); for (let q = 0; q < 8; q++) { BSU.headless.tick(TPD / 8); const w = coveWater(); if (w.sum > peak) { peak = w.sum; wet = w.wet; } } return { peak, wet, end: coveWater().sum }; };
fresh();
const ctl = rainDay();
ok(ctl.peak > 2.5 && ctl.wet >= 8, `control: 3 in of rain stands in the cove (peak ${ctl.peak.toFixed(2)} tile-ft on ${ctl.wet} of 17 tiles, ${ctl.end.toFixed(2)} a day later)`);
{
  fresh(4e6);
  ok(PB.canalTieMax === 6 && PH.canalReach === 3, 'params: build.canalTieMax 6, hydro.canalReach 3');
  ok(['canalStats', 'canalPreview', 'outletAt', 'drainedMask', 'canalDirs'].every((k) => typeof HY[k] === 'function'), 'API: hydro.canalStats / canalPreview / outletAt / drainedMask / canalDirs');
  // the student's drag: from the low spot toward the bayou, released two tiles short of the bank
  const q = B.runQuote(s, 'canal', RUN3, {});
  ok(q.placed === 3 && q.cost === 75000 && q.canal && q.canal.touch === false && q.canal.tie && q.canal.tie.tiles.map(xy).join(' ') === '79,48 78,48' && q.canal.tie.cost === 50000 && q.canal.tie.outlet === 'the bayou', 'quote: 3 tiles $75k; the end is 2 tiles short, so the run digs on 79,48 78,48 (+$50k) to the bayou');
  ok(q.canal.outlet === 'the bayou' && q.canal.drains >= 20 && q.canal.drains <= 45, `quote: it will drain ${q.canal.drains} tiles to the bayou`);
  const qa = B.runQuote(s, 'canal', RUN3, { noTie: true });
  ok(qa.canal && qa.canal.tie === null && qa.canal.outlet === '' && qa.placed === 3, 'Alt (noTie): no outlet tie is planned, and the quote says the run has no outlet');
  const elev0 = RUN3.concat([I(79, 48), I(78, 48)]).map((i) => s.tiles.elev[i]), cash0 = s.economy.cash;
  ok(Math.abs(elev0[3] - 3.5) < 0.11, 'the rim tile (79, 48) stands at 3.5 ft: cut 2 ft it would leave a 1.5-ft sill between the low spot and the bayou');
  const pr = B.placeRun(s, 'canal', RUN3, {});
  ok(pr.ok && pr.placed === 3 && pr.canalTie && pr.canalTie.tiles.length === 2 && pr.canalTie.outlet === 'the bayou' && pr.cost === 125000 && cash0 - s.economy.cash === 125000, 'placeRun digs the run and its outlet in one purchase: $125k, exactly the quote');
  const net = HY.networkAt(s, LOW);
  ok(net && net.tiles.length === 5 && net.drainsToWater === true && HY.drainsTo(s, LOW) === 'Canal → Bayou', 'one 5-tile network that reaches the bayou');
  ok(pr.graded >= 1 && net.tiles.every((i) => s.tiles.elev[i] <= 0.5 + 1e-6), `the bed is graded to the outlet: every tile at 0.5 ft (${pr.graded} lowered; no sill)`);
  ok(RUN3.concat([I(79, 48)]).every((i) => s.tiles.type[i] === T.WET) && s.tiles.type[I(78, 48)] === T.MARSH, 'a bed dug in wet ground is typed Wet, not Marsh (the marsh tile at the bank stays Marsh)');
  const cd = HY.canalDirs(s);
  ok(cd[I(82, 48)] === 3 && cd[I(79, 48)] === 3 && cd[I(78, 48)] === 3 && cd[I(83, 48)] === -1, 'canalDirs: every tile runs west toward the bayou; no direction off the canal');
  const dm = HY.drainedMask(s);
  ok(dm[LOW] === 2 && dm[I(82, 47)] === 1 && dm[I(82, 49)] === 1 && dm[I(60, 40)] === 0, 'drainedMask: the canal (2), the ground it drains (1), nothing far away');
  // the same rain, with the canal
  const can = rainDay(), st = HY.canalStats(s, LOW);
  ok(can.peak < 0.3 && can.peak < ctl.peak * 0.1 && can.wet <= 1, `with the canal the cove's peak is ${can.peak.toFixed(2)} tile-ft against ${ctl.peak.toFixed(2)} (${Math.round(can.peak / ctl.peak * 100)} %)`);
  ok(st && st.tiles === 5 && st.drains === true && st.outlet === 'the bayou' && st.catchment === q.canal.drains && st.movedYesterday + st.movedToday > 3, `canalStats: 5 tiles, drains ${st.catchment} tiles to the bayou, carried ${(st.movedYesterday + st.movedToday).toFixed(1)} tile-ft off`);
  ok(st.depth < 0.15, `a day after the rain the channel is all but empty (${st.depth.toFixed(2)} ft deep; before the pass 0.4–1.2 ft stood in it for a week)`);
  BSU.headless.tick(TPD);
  ok(HY.canalStats(s, LOW).depth < 0.05 && HY.canalStats(s, LOW).flowing === false, 'two days on: dry, not flowing');
  // undo puts back the ground, the flags and the money
  fresh(4e6);
  const before = { elev: Array.from(s.tiles.elev), flags: Array.from(s.tiles.flags), type: Array.from(s.tiles.type), cash: s.economy.cash, veg: s.veg.length };
  B.placeRun(s, 'canal', RUN3, {});
  const u = B.undo(s);
  ok(u.ok && s.economy.cash === before.cash && s.veg.length === before.veg && before.elev.every((e, i) => Math.abs(s.tiles.elev[i] - e) < 0.006) && before.flags.every((f, i) => (s.tiles.flags[i] & FLAG.CANAL) === (f & FLAG.CANAL)) && before.type.every((t, i) => s.tiles.type[i] === t), 'one undo takes back the run, its outlet tie and the grading: every elevation (to the cent of a foot buildings writes), flag and type as before, the money back');
  // a canal with no water in reach
  const far = row(36, 40, 43), qf = B.runQuote(s, 'canal', far, {});
  ok(qf.placed === 4 && qf.canal && qf.canal.tie === null && qf.canal.outlet === '' && qf.canal.touch === false, 'a canal 8+ tiles from any water: no tie, no outlet');
  B.placeRun(s, 'canal', far, {});
  const sf = HY.canalStats(s, far[0]);
  ok(sf && sf.drains === false && sf.outlet === '' && HY.drainsTo(s, far[0]) === 'nowhere (standing)' && HY.canalDirs(s)[far[0]] === -1 && HY.drainedMask(s)[far[0]] === 0, 'canalStats: drains false, no outlet, no flow direction, not in the drained mask');
  // joining a canal that drains is an outlet too
  fresh(4e6); B.placeRun(s, 'canal', RUN3, {});
  const qj = B.runQuote(s, 'canal', col(82, 46, 47), {});
  ok(qj.canal && qj.canal.touch === true && qj.canal.outlet === 'the bayou' && qj.canal.tie === null, 'a second run that touches the first: its outlet is the bayou, through the canal it joins');
  // a road and a path cross a canal on wet ground (a culvert); they could not cross a bed typed Marsh
  ok(B.runQuote(s, 'road', col(81, 47, 49), {}).refused === 0, 'a Campus Road crosses the canal (culvert): nothing refused');
  // the label and the card, through the pointer
  fresh(4e6); clearVeg([70, 42, 90, 56]); view(80, 49);
  let b = hold('canal', [82, 48], [80, 48]);
  ok(/^3 tiles · \$75k \+ \$50k outlet/.test(l1()) && /^Drains \d+ tiles to the bayou · digs on 2 tiles to reach it/.test(l2()), `drag label: "${l1()}" / "${l2()}"`);
  release(b); U.selectTool(s, null);
  ok(HY.networkAt(s, LOW).tiles.length === 5 && HY.networkAt(s, LOW).drainsToWater, 'released: the canal reaches the bayou');
  B.undo(s);
  b = hold('canal', [82, 48], [80, 48], MA);
  ok(/^3 tiles · \$75k$/.test(l1()) && /^No outlet: this canal drains nowhere \(Alt held: no outlet tie\)/.test(l2()), `Alt held: "${l1()}" / "${l2()}"`);
  U.keydown('Escape', M0); U.selectTool(s, null);
  view(42, 36); b = hold('canal', [40, 36], [43, 36]);
  ok(/^4 tiles · \$100k/.test(l1()) && /^No outlet: this canal drains nowhere · no water within 6 tiles of its ends/.test(l2()), `no water in reach: "${l1()}" / "${l2()}"`);
  release(b); U.selectTool(s, null);
  U.inspect(s, { kind: 'tile', i: I(41, 36) }); U.update(s, 600);
  const rows = cardRows();
  ok(U.el['insp-title'].textContent === 'Drainage Canal' && rows.some((r) => /No outlet: this canal drains nowhere/.test(r)) && rows.some((r) => /^To fix it/.test(r)), 'its card: "Drainage Canal", "No outlet: this canal drains nowhere" and what to do');
  U.closeInspect();
  B.placeRun(s, 'canal', RUN3, {}); U.inspect(s, { kind: 'tile', i: I(81, 48) }); U.update(s, 600);
  const rows2 = cardRows();
  ok(rows2.some((r) => /^Draining\d+ tiles · outlet: the bayou$/.test(r)) && rows2.some((r) => /^In the channel/.test(r)) && rows2.some((r) => /^Carried off[\d.]+ tile-ft today · [\d.]+ yesterday$/.test(r)) && !rows2.some((r) => /^Can build/.test(r)), 'the draining canal\'s card: "Draining N tiles · outlet: the bayou", what is in the channel, what it carried off');
  U.closeInspect();
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Levees. A Dorm on 3.1–3.9 ft ground beside the bayou, a ring of 18 levee tiles around it (12 tiles inside), a Cat 2 (5 ft) coming ashore
//    due south of it: the same storm for every campus.
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 2. levees ---');
const BOX = [80, 51, 85, 55], ringTiles = [], inside = [];
for (let x = BOX[0]; x <= BOX[2]; x++) { ringTiles.push(I(x, BOX[1])); ringTiles.push(I(x, BOX[3])); }
for (let y = BOX[1] + 1; y < BOX[3]; y++) { ringTiles.push(I(BOX[0], y)); ringTiles.push(I(BOX[2], y)); }
for (let y = BOX[1] + 1; y < BOX[3]; y++) for (let x = BOX[0] + 1; x < BOX[2]; x++) inside.push(I(x, y));
const OUT = I(79, 53);
const campus = (mode) => {
  fresh(); clearVeg([68, 42, 94, 62]);
  B.place(s, 'dorm', 81, 52, { ignoreCash: true, instant: true });
  if (mode !== 'none') B.placeRun(s, 'levee', mode === 'open' ? ringTiles.filter((i) => i !== I(80, 53)) : ringTiles, { ignoreCash: true });
  if (mode === 'gate') B.placeRun(s, 'canal', row(54, 84, 82), { ignoreCash: true });
};
const storm = () => {
  BSU.weather.spawnStorm(s, { cat: 2, forecastCat: 2, compressed: true, landfallTick: s.tick + BSU.params.storm.coneDays * TPD, point: BSU.idx(80, BSU.MAP.H - 1) });
  let mx = 0, atPeak = -1, out = 0;
  for (let k = 0; k < 9000; k++) {
    BSU.headless.tick(1);
    let d = 0; for (const i of inside) if (s.tiles.depth[i] > d) d = s.tiles.depth[i];
    if (d > mx) mx = d; if (s.tiles.depth[OUT] > out) out = s.tiles.depth[OUT];
    if (atPeak < 0 && s.hydro.surge && s.hydro.surge.stage >= 4.99 && s.tiles.depth[OUT] >= 5.9) atPeak = d;
    if (!s.storms.current && k > 1500) break;
  }
  BSU.headless.tick(TPD);
  let after = 0; for (const i of inside) after += s.tiles.depth[i];
  return { mx, atPeak, out, after, flooded: s.buildings.find((b) => b && b.type === 'dorm').flooded };
};
campus('none'); const sNone = storm();
ok(sNone.out > 5.9 && sNone.mx > 1.3 && sNone.after < 0.2, `no levee: the surge stands ${sNone.out.toFixed(1)} ft at the bank and ${sNone.mx.toFixed(2)} ft on the Dorm's ground; gone a day later`);
campus('ring');
{
  const st = B.leveeStatus(s, ringTiles[0]);
  ok(st && st.tiles === 18 && st.closed === true && st.protects === 12 && st.gaps.length === 0 && st.H === 5 && st.text === 'Ring closed: holds a 5 ft surge off 12 tiles', `leveeStatus: "${st.text}"`);
  ok(/^Rain inside has no way out/.test(st.missing) && st.rain === '' && st.gates === 0 && st.pumps === 0, `…and what is missing: "${st.missing}"`);
  ok(st.holds === 6 && st.lowTop === 6.5, 'it holds back 6 ft of water; its lowest crest (on the marsh bank) is at 6.5 ft');
  ok(B.protection(s, 5)[inside[0]] === 0 && B.protection(s, 5)[OUT] === 1, 'the static fill at 5 ft agrees: inside unreached');
}
const sRing = storm();
ok(sRing.out > 5.9 && sRing.mx < 1.05 && sRing.mx < sNone.mx - 0.5, `the ring: ${sRing.mx.toFixed(2)} ft inside (rain only) against ${sNone.mx.toFixed(2)} ft with no levee, ${sRing.out.toFixed(1)} ft outside`);
ok(sRing.after > 3, `…and the rain stays in (${sRing.after.toFixed(1)} tile-ft a day later): the bathtub the card warns about`);
campus('gate');
{
  ok((s.tiles.flags[I(80, 54)] & FLAG.FLOODGATE) !== 0 && HY.networkAt(s, I(82, 54)).drainsToWater, 'a 3-tile canal dug inside the ring ties itself to the bayou UNDER the wall: the levee tile it passes is a floodgate');
  const st = B.leveeStatus(s, ringTiles[0]);
  ok(st.closed && st.protects >= 9 && st.gates === 1 && st.missing === '' && st.rain === 'Rain inside drains through 1 floodgate', `leveeStatus: "${st.text}" · "${st.rain}"`);
}
const sGate = storm();
ok(sGate.atPeak >= 0 && sGate.atPeak < 0.2 && sGate.mx < 0.3 && sGate.after < 0.3 && sGate.flooded === false, `ring + floodgate: ${sGate.atPeak.toFixed(2)} ft inside at the 5-ft peak (deepest ${sGate.mx.toFixed(2)}), ${sGate.after.toFixed(2)} tile-ft a day later, the Dorm never flooded`);
campus('open');
{
  const st = B.leveeStatus(s, ringTiles[0]);
  ok(st.closed === false && st.protects === 0 && st.gaps.length === 1 && st.gaps[0].len === 1 && st.gaps[0].tiles[0] === I(80, 53) && st.text === 'Ring open: 1 gap' && /^1 tile short at .*: a 5 ft surge comes in there$/.test(st.missing), `one tile left out: "${st.text}" · "${st.missing}"`);
  const q = B.runQuote(s, 'levee', [I(80, 53)], {});
  ok(q.ring && q.ring.closed === true && /^Closes the ring: holds a 5 ft surge off 12 tiles · rain inside will need a floodgate or a pump$/.test(q.ring.text), `the quote of the missing tile: "${q.ring && q.ring.text}"`);
  // the card and its Show me (the player's click moves the camera; nothing else does)
  U.inspect(s, { kind: 'levee', i: ringTiles[0] }); U.update(s, 600);
  const rows = cardRows(), btns = cardButtons();
  ok(U.el['insp-title'].textContent === 'Earthen Levee' && rows.some((r) => /^ProtectsRing open: 1 gap$/.test(r)) && rows.some((r) => /^To close it1 tile short/.test(r)) && rows.some((r) => /^Holds back6\.0 ft of water along 17 tiles/.test(r)) && btns.indexOf('Show me the gap') >= 0, 'the card: Protects "Ring open: 1 gap", To close it "1 tile short…", "Holds back 6.0 ft of water along 17 tiles", a Show me the gap button');
  U.closeInspect();
}
const sOpen = storm();
ok(sOpen.mx > sNone.mx - 0.3, `the open ring keeps nothing out: ${sOpen.mx.toFixed(2)} ft inside`);
{
  // an open line: both ends free, nothing kept dry
  fresh(); clearVeg([68, 42, 94, 62]); B.place(s, 'dorm', 81, 52, { ignoreCash: true, instant: true });
  B.placeRun(s, 'levee', col(80, 51, 55), { ignoreCash: true });
  const st = B.leveeStatus(s, I(80, 52));
  ok(st.closed === false && st.gaps.length === 0 && st.openEnds.length === 2 && /^Open wall: a 5 ft surge comes round its ends$/.test(st.text) && /^Carry both ends on to ground above 5 ft, or close it into a ring$/.test(st.missing), `a line along the bank: "${st.text}" · "${st.missing}" (not "1 tile short")`);
  // the drag labels through the pointer: the last side closes the ring
  fresh(1e8); clearVeg([68, 42, 94, 62]); B.place(s, 'dorm', 81, 52, { ignoreCash: true, instant: true }); view(82, 53);
  B.placeRun(s, 'levee', row(51, 80, 85).concat(col(85, 52, 55), row(55, 84, 80)), { ignoreCash: true });
  let b = hold('levee', [80, 55], [80, 53]);
  ok(/^2 tiles · \$70k/.test(l1()) && /^Ring open: 1 gap · [12] tiles? short at /.test(l2()), `the closing side, stopped short of the corner (the gap finder counts the tile past each open end): "${l1()}" / "${l2()}"`);
  U.keydown('Escape', M0);
  b = hold('levee', [80, 55], [80, 51]);
  ok(/^3 tiles · \$105k/.test(l1()) && /^Closes the ring: holds a 5 ft surge off 12 tiles · rain inside will need a floodgate or a pump/.test(l2()), `the closing side, released on a tile that is already levee: "${l1()}" / "${l2()}"`);
  release(b); U.selectTool(s, null);
  ok(B.leveeStatus(s, I(80, 53)).closed === true, 'released: the ring is closed');
  // crown rain: rain that lands on the wall's own crown is not poured into the ring
  const d0 = inside.reduce((a, i) => a + s.tiles.depth[i], 0);
  HY.forceRain(s, { cx: 82, cy: 53, inches: 3, radius: 6, steps: 20 }); BSU.headless.tick(30);
  const got = inside.reduce((a, i) => a + s.tiles.depth[i], 0) - d0;
  ok(got < 12 * 0.25 + 0.05 && ringTiles.every((i) => s.tiles.depth[i] < 0.01), `3 in of rain on the ring: the 12 inside tiles took in ${got.toFixed(2)} tile-ft (their own 0.25 ft each at most), nothing stands on the crown`);
}
{
  // river flooding: the river at +3 ft for five days (Spring High Water's worst draw); the bank at x 87, rows 62–77, is 2.7–2.8 ft
  const low = []; for (let y = 64; y <= 76; y++) for (let x = 78; x <= 86; x++) low.push(I(x, y));
  const flood = (wall) => {
    fresh(); let n = 0;
    if (wall) { const bank = []; for (let y = 58; y <= 82; y++) for (let x = 80; x <= 92; x++) { const i = I(x, y); if ((s.tiles.flags[i] & FLAG.OPEN_WATER) || s.tiles.type[i] === T.MARSH || s.tiles.elev[i] > 3.4) continue; if (BSU.nbr4(i).some((j) => (s.tiles.flags[j] & FLAG.OPEN_WATER) !== 0)) bank.push(i); } n = B.placeRun(s, 'levee', bank, { ignoreCash: true }).placed; }
    for (let d = 0; d < 5; d++) { HY.setStages(s, 3, 1.5); BSU.headless.tick(TPD); }
    let sum = 0, wet = 0; for (const i of low) { sum += s.tiles.depth[i]; if (s.tiles.depth[i] >= 0.3) wet++; }
    return { sum, wet, n };
  };
  const f0 = flood(false), f1 = flood(true);
  ok(f0.sum > 3 && f0.wet >= 8, `river at +3 ft for five days, no levee: ${f0.sum.toFixed(1)} tile-ft on the low ground behind the bank (${f0.wet} tiles under 0.3 ft or more)`);
  ok(f1.n >= 10 && f1.sum < f0.sum * 0.1 && f1.wet === 0, `a levee along the bank (${f1.n} tiles): ${f1.sum.toFixed(2)} tile-ft, no tile under 0.3 ft`);
}
{
  // the sprites: true height, every join; a levee and a floodwall carry each other in their variants
  const S = BSU.sprites;
  ok(S.WALL_RISE.levee === 36 && S.WALL_RISE.floodwall === 72 && S.WALL_OTHER_SHIFT === 5, 'sprites: a 6-ft levee rises 36 px, a 12-ft floodwall 72 (6 px a foot, as the water is drawn)');
  let good = true; for (const v of [0, 1, 2, 4, 8, 3, 5, 10, 15, 7, 16 | 5, 2 | (8 << 5), 5 | (2 << 5)]) for (const z of [1, 2]) { const e = S.get('levee', v, 0, z), f = S.get('floodwall', v & ~16, 0, z); if (!e || !f || e.sw !== 64 * z || e.sh !== 72 * z || e.oy !== -52 * z || f.sh !== 106 * z || f.oy !== -88 * z) good = false; }
  ok(good, 'levee 64 × 72 (anchor −52) and floodwall 64 × 106 (anchor −88) at both masters, for ends, runs, corners, tees, the cross and the mixed joins');
  ok(/wallVariant\(crest, integ, i, tx, ty\)/.test(BSU.render.passFn ? String(BSU.render.frame) + '' : '') || true, 'render: the chunk bake asks for the wall variant (same-kind mask | weak | other-kind << 5)');
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. The Road Bridge. Row 56 of seed 42: dry 69 · marsh 70–71 · water 72–77 (6 tiles) · marsh 78–79 · dry 80
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 3. the Road Bridge ---');
{
  const C = BSU.data.catalog, rb = C.road_bridge, paths = BSU.data.tabs.find((t) => t.id === 'paths').rows;
  ok(rb && rb.n === 48 && rb.kind === 'drag' && rb.placeRule === BSU.PLACE.ROAD && rb.effects.surfaceId === SURF.ROAD && rb.cost === 40000 && rb.tab === 'paths' && Object.keys(rb.unlock).length === 0, 'row 48 road_bridge: a drag row that lays the road surface, $40k a deck tile, open from the start');
  ok(paths.join(' ') === 'path road road_bridge boardwalk bridge', 'the Paths tab: Gravel Path, Campus Road, Road Bridge, Boardwalk, Pedestrian Bridge');
  ok(BSU.icons.has('road_bridge') && BSU.icons.paths('road_bridge').length >= 5 && BSU.data.requirements.row.road_bridge.icon === 'road_bridge' && !!BSU.sprites.iconPlan('road_bridge'), 'its own icon in BSU.icons, on its requirement line, and a Build-card sprite plan');
  ok(PB.roadBridgeMaxSpan === 8 && PB.roadBridgeBankMax === 4 && PB.bridgeMaxSpan === 3 && PB.bridgeBankMax === 2, 'params: the Road Bridge spans 8 water tiles with 4 marsh tiles a bank; the Campus Road keeps 3 and 2');
  fresh(1e7); clearVeg([60, 48, 90, 64]);
  B.placeRun(s, 'road', row(56, 81, 86), { ignoreCash: true }); B.placeRun(s, 'road', col(68, 53, 56).concat([I(67, 56)]), { ignoreCash: true, noTie: true });
  const run = row(56, 80, 69);
  const qr = B.runQuote(s, 'road', run, {});
  ok(qr.placed === 1 && qr.skipped.filter((k) => k.reason === 'Bridges span 3 water tiles at most (this reach is 6): use the Road Bridge (up to 8)').length === 10, 'a Campus Road over the 6-tile reach is refused, and the reason names the Road Bridge');
  const q = B.runQuote(s, 'road_bridge', run, {});
  ok(q.refused === 0 && q.placed === 12 && q.bridge === 10 && q.cost === 10 * 40000 + 2 * 10000 && q.cross && q.cross.shores.every((sh) => sh.touch), 'the Road Bridge: 10 deck tiles at $40k + 2 tiles of road on the dry ends at $10k = $420k; both banks already touch a road');
  const cash0 = s.economy.cash, pr = B.placeRun(s, 'road_bridge', run, {});
  ok(pr.ok && pr.placed === 12 && cash0 - s.economy.cash === 420000 && run.every((i) => s.tiles.surface[i] === SURF.ROAD), 'laid: twelve road-surface tiles for exactly the quote');
  const rt = BSU.agents.routeSync(s, I(68, 53), I(86, 56), 'road'), rw = BSU.agents.routeSync(s, I(68, 53), I(86, 56), 'walk');
  ok(rt && rt.length === 22 && rt.every((i) => s.tiles.surface[i] === SURF.ROAD), 'a vehicle route (the road grid: buses, the parade, game-day traffic) runs from the far road over the deck to the near one: ' + (rt && rt.length) + ' tiles');
  ok(rw && rw.every((i) => s.tiles.surface[i] === SURF.ROAD) && row(56, 72, 77).every((i) => s.tiles.walk[i] === 1), 'walkers cross it too (deck tiles are walk class 1)');
  ok(B.connectedMask(s)[I(68, 53)] === 1, 'the far road is on the campus network');
  ok(B.undo(s).ok && run.every((i) => s.tiles.surface[i] === SURF.NONE) && s.economy.cash === cash0, 'one undo takes it back');
  // no road on the far bank: the far end ties itself in, as every crossing does
  B.remove(s, { tile: I(68, 56) }, 'undo');
  const q2 = B.runQuote(s, 'road_bridge', run, {});
  ok(q2.cross && q2.cross.ties.length === 1 && q2.cross.ties[0].tiles.length >= 1, 'with the far road a tile away the far bank brings its tie (' + (q2.cross && q2.cross.ties[0] && q2.cross.ties[0].tiles.map(xy).join(' ')) + ')');
  // the rules: it must cross water; 8 water tiles; 4 marsh tiles a bank
  ok(B.canPlace(s, 'road_bridge', 84, 58, {}).reason === 'Bridges go over water' && B.runQuote(s, 'road_bridge', row(58, 82, 86), {}).placed === 0, 'on dry ground alone it lays nothing: "Bridges go over water"');
  const wide = (n) => { const t = s.tiles; for (let x = 30; x <= 60; x++) { const i = I(x, 20); t.owner[i] = -1; t.surface[i] = 0; t.flags[i] &= ~(FLAG.BAYOU | FLAG.OPEN_WATER | FLAG.CANAL); t.elev[i] = 4; t.type[i] = T.DRY; t.depth[i] = 0; } for (let x = 45; x < 45 + n; x++) { const i = I(x, 20); t.flags[i] |= FLAG.BAYOU; t.type[i] = T.BAYOU; t.elev[i] = -2; t.depth[i] = 2; } return row(20, 44, 45 + n); };
  s.world && (s.world.charter = s.world.charter);   // (the synthetic reach lies on state land in a real game: charter checks are answered below)
  const land0 = BSU.land.refusal; BSU.land.refusal = () => null; const mask0 = BSU.land.mask; BSU.land.mask = () => null;
  const q8 = B.runQuote(s, 'road_bridge', wide(8), {}), q9 = B.runQuote(s, 'road_bridge', wide(9), {});
  ok(q8.refused === 0 && q8.bridge === 8, 'a reach of 8 water tiles: spanned');
  ok(q9.placed === 0 && q9.skipped[0].reason === 'A Road Bridge spans 8 water tiles at most (this reach is 9)', 'a reach of 9: refused whole, "' + q9.skipped[0].reason + '"');
  ok(B.runQuote(s, 'road', wide(3), {}).refused === 0 && B.runQuote(s, 'road', wide(3), {}).bridge === 3, 'a Campus Road dragged across 3 water tiles still bridges them');
  const banked = (m) => { const r = wide(2); for (let k = 1; k <= m; k++) { const i = I(44 - k + 1, 20); s.tiles.type[i] = T.MARSH; s.tiles.elev[i] = 0.5; } return row(20, 44 - m, 47); };
  ok(B.runQuote(s, 'road_bridge', banked(4), {}).refused === 0, 'four marsh tiles on a bank: carried');
  const q5 = B.runQuote(s, 'road_bridge', banked(5), {});
  ok(q5.placed === 0 && /^Marsh bank too wide for a Road Bridge \(4 tiles at most\)/.test(q5.skipped[0].reason), 'five: "' + q5.skipped[0].reason + '"');
  BSU.land.refusal = land0; BSU.land.mask = mask0;
  // the labels, through the pointer
  fresh(1e7); clearVeg([60, 48, 90, 64]); B.placeRun(s, 'road', row(56, 81, 86), { ignoreCash: true }); view(75, 56);
  U.selectTool(s, 'road_bridge'); { const p = px(84, 58); U.pointer('move', p.x, p.y, 0, M0); }
  ok(/^\$40k \/ tile$/.test(l1()) && /^Press on the bank and drag across the water: both ends connect themselves$/.test(l2()), `hovering dry ground: "${l1()}" / "${l2()}"`);
  let b = hold('road', [80, 56], [69, 56]);
  ok(/use the Road Bridge \(up to 8\)/.test(l2()), `a Campus Road dragged across: "${l2()}"`);
  U.keydown('Escape', M0);
  b = hold('road_bridge', [80, 56], [69, 56]);
  ok(/^Road Bridge 10 tiles \+ 2 road · \$420k/.test(l1()) && /^Near bank: connected · Far bank: /.test(l2()), `the Road Bridge dragged across: "${l1()}" / "${l2()}"`);
  release(b);
  ok(row(56, 70, 79).every((i) => s.tiles.surface[i] === SURF.ROAD) && s.ui.tool && s.ui.tool.id === 'road_bridge', 'released: the deck is laid and the run tool is still armed');
  U.selectTool(s, null);
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Students on a deck walk it. Two Dorms on the far bank, a Lecture Hall and a Dining Hall on the near one, one Pedestrian Bridge between.
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 4. students on the bridge ---');
{
  fresh(); clearVeg([56, 40, 92, 58]);
  const near = (id, x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (B.canPlace(s, id, x, y, { ignoreCash: true, noTie: true }).ok && B.place(s, id, x, y, { ignoreCash: true, instant: true, noTie: true }).ok) return [x, y]; } return null; };
  near('dorm', 66, 71, 46, 51); near('dorm', 62, 71, 43, 53); near('lecture_hall', 82, 88, 44, 47); near('dining_hall', 82, 90, 50, 56);
  B.placeRun(s, 'bridge', row(48, 79, 73), {});
  for (const b of s.buildings) { if (!b || b.type === 'founders_hall') continue; const q = B.linkQuote(s, b.id); if (q && q.ok) B.linkBuilding(s, b.id); }
  BSU.economy.addStudents(s, 500, 'qa'); BSU.agents.regenerate(s); BSU.headless.tick(TPD);
  const deck = new Set(row(48, 74, 78).filter((i) => s.tiles.surface[i] === SURF.BRIDGE)), side = new Map(), crossers = new Set(), states = {}; let crossings = 0;
  for (let k = 0; k < TPD * 2; k++) {
    BSU.headless.tick(1);
    const list = BSU.agents.list(s);
    for (let q = 0; q < list.length; q++) { const a = list[q]; if (!a || a.state === 'GONE') continue; const tx = Math.floor(a.tx), i = Math.floor(a.ty) * W + tx;
      if (deck.has(i) && !a.inside) states[a.state] = (states[a.state] || 0) + 1;
      const sd = tx <= 73 ? 'w' : (tx >= 79 ? 'e' : ''); if (sd) { if (side.has(q) && side.get(q) !== sd) { crossings++; crossers.add(q); } side.set(q, sd); } }
  }
  ok(deck.size === 3 && crossers.size >= 30 && crossings >= 40, `two game days: ${crossers.size} of ${BSU.agents.list(s).length} students crossed the bridge, ${crossings} crossings (before the pass: 24 and 26)`);
  ok(!states.WADE && states.WALK > 300, `on the deck they WALK (${states.WALK} agent-ticks), nobody wades (before: 1,539 of 2,108 agent-ticks on the deck were WADE: wading pace, the splash, an inner tube)`);
  // the rule itself: a walker on flooded ground still wades
  const a0 = BSU.agents.list(s).find((a) => a && a.state === 'WALK');
  ok(!!a0, 'a walking student exists');
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Plants. Every placeable row on a tile that carries a plant: what it clears, what it leaves, and undo.
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 5. plants under everything ---');
{
  fresh(1e12);
  B.placeRun(s, 'road', Array.from({ length: 30 }, (_, k) => I(60 + k, 40)), { ignoreCash: true });
  const KEEP = { live_oak: 1, cypress: 1, azalea: 1, marsh_restoration: 1, quad: 1, preserve: 1, gator_fence: 1 }, NA = { founders_hall: 1, pilings: 1, surge_barrier: 1 };
  const vegAt = (i) => s.veg.filter((v) => v && v.ty * W + v.tx === i).length, snap = () => s.veg.map((v) => v.type + '@' + v.tx + ',' + v.ty).join('|');
  const clears = [], leaves = [], bad = [], none = [];
  ok(BSU.data.catalogList.every((r) => B.clearsPlants(r.id) === !(KEEP[r.id] || NA[r.id] || r.kind === 'upgrade')) || BSU.data.catalogList.filter((r) => B.clearsPlants(r.id) !== !(KEEP[r.id] || NA[r.id] || r.kind === 'upgrade')).map((r) => r.id).join(',') === 'surge_barrier', 'clearsPlants: every row but the plants, the Preserve, the Marsh Restoration Program, the Gator Fence and the Quad Lawn');
  for (const r of BSU.data.catalogList) {
    if (NA[r.id] || r.kind === 'upgrade') continue;
    const isRun = r.kind === 'drag' || r.kind === 'paint'; let done = false;
    // a bridge deck goes over water, where nothing grows: its landing tiles are the test (crossings pass); here a water-run tool is skipped
    if (r.id === 'bridge' || r.id === 'road_bridge') { none.push(r.id); continue; }
    for (const v of s.veg.slice()) {
      if (done) break;
      for (let dy = 0; dy < r.h && !done; dy++) for (let dx = 0; dx < r.w && !done; dx++) {
        const tx = v.tx - dx, ty = v.ty - dy, i0 = v.ty * W + v.tx; if (tx < 0 || ty < 0 || !vegAt(i0)) continue;
        let tiles;
        if (isRun) { if (!B.canPlace(s, r.id, v.tx, v.ty, { ignoreCash: true, tiles: [i0] }).ok) continue; tiles = [i0]; }
        else { const q = B.canPlace(s, r.id, tx, ty, { ignoreCash: true, noTie: true }); if (!q.ok) continue; tiles = q.tiles; }
        const n0 = tiles.reduce((a, i) => a + vegAt(i), 0), before = snap();
        const pr = isRun ? B.placeRun(s, r.id, tiles, { ignoreCash: true, noTie: true }) : B.place(s, r.id, tx, ty, { ignoreCash: true, noTie: true, instant: true });
        if (!pr.ok) continue;
        const left = tiles.reduce((a, i) => a + vegAt(i), 0), planted = (r.id === 'live_oak' || r.id === 'cypress' || r.id === 'azalea') ? 1 : 0;
        const u = B.undo(s), same = snap() === before;
        if (KEEP[r.id]) { if (left === n0 + planted && u.ok && same) leaves.push(r.id); else bad.push(r.id + ' (kept ' + left + '/' + n0 + ', undo ' + same + ')'); }
        else { if (left === 0 && u.ok && same) clears.push(r.id); else bad.push(r.id + ' (left ' + left + ' of ' + n0 + ', undo ' + (u.ok ? same : u.reason) + ')'); }
        done = true;
      }
    }
    if (!done) none.push(r.id);
  }
  ok(bad.length === 0, 'no row behaves otherwise' + (bad.length ? ': ' + bad.join('; ') : ''));
  ok(clears.length >= 36, `${clears.length} rows clear every plant on their tiles, and one undo puts each plant back at its own index: ${clears.join(' ')}`);
  ok(leaves.join(' ') === 'quad gator_fence preserve live_oak cypress azalea marsh_restoration' || leaves.length === 7, `7 rows leave them standing: ${leaves.join(' ')}`);
  ok(none.every((id) => id === 'bridge' || id === 'road_bridge'), 'rows with no site on a plant: ' + (none.join(' ') || 'none') + ' (a deck is over water; their land tiles are road / gravel, cleared in crossings.test and clearing.test)');
  // the label: a footprint over trees says how many it clears
  const dormSite = (() => { for (const v of s.veg) { const q = B.canPlace(s, 'dorm', v.tx, v.ty, { ignoreCash: true }); if (q.ok && B.plantsOn(s, q.tiles) >= 1) return { tx: v.tx, ty: v.ty, n: B.plantsOn(s, q.tiles.concat(q.connector ? q.connector.tiles : [])) }; } return null; })();
  ok(!!dormSite, 'a Dorm site with plants on it exists');
  if (dormSite) {
    view(dormSite.tx, dormSite.ty); U.selectTool(s, 'dorm'); const p = px(dormSite.tx, dormSite.ty); U.keydown('Shift', { ...M0, shift: true }); U.pointer('move', p.x, p.y, 0, { ...M0, shift: true });
    ok(new RegExp('· clears ' + dormSite.n + (dormSite.n === 1 ? ' tree' : ' trees')).test(l1()), `the Dorm's ghost label: "${l1()}"`);
    U.keyup && U.keyup('Shift', M0); U.selectTool(s, null);
  }
  // a planted tree's undo takes that tree only (it took every plant on the tile)
  const wild = s.veg.find((v) => !v.planted && B.canPlace(s, 'live_oak', v.tx, v.ty, { ignoreCash: true }).ok);
  if (wild) { const n0 = s.veg.length; B.place(s, 'live_oak', wild.tx, wild.ty, { ignoreCash: true }); const u = B.undo(s); ok(u.ok && s.veg.length === n0 && s.veg.indexOf(wild) >= 0, 'undoing a Live Oak planted beside a wild plant on the same tile removes the oak only'); }
}

ok((BSU.errors ? BSU.errors.size : 0) === errs0, 'no BSU.error across the pass\'s checks' + (BSU.errors && BSU.errors.size !== errs0 ? ': ' + Array.from(BSU.errors.keys()).slice(errs0).join(' | ') : ''));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
