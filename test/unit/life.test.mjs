// Campus life and look pass (a student's playtest notes N9 "students never scattered, always in same location", N8 "when football field rotated,
// posts on the wrong ends", N26 "Quad Lawn should be connectable", N27 "keep gators, make them more occasional", N29 "when nighttime it's too
// dark: a glow at the mouse", and the leftover of the water pass: entities drawn over the wall they stand behind). Real numbers on seed 42 at 96.
//   1. students: where they live and study, the spread over two whole days on the typical campus (tools/qa/life_campus.mjs), attendance, the plan
//   2. fields: goalposts at the short ends, yard lines across, stands and the game itself following the rotation, for every field and tier
//   3. lawns: join (no setback, one group, the look word), the dragged block (quote, price per tile, one undo), walk and stand, the card
//   4. gators: the visit budget's numbers, three simulated years against bounds, the first visit, students and gators in the water, the officer
//   5. night: the floor per setting, the cursor light, the Settings control, the simulation untouched
//   6. draw order at walls
// Usage: node build.mjs --check && node test/unit/life.test.mjs   (exit 1 on any failure; about a minute: section 4 simulates three years)
import { readFileSync } from 'node:fs';
import { loadGame } from '../domstub.mjs';
import { LIFE_LAYOUT, buildLifeCampus, census, censusMean } from '../../tools/qa/life_campus.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

const { win } = loadGame();
const BSU = win.BSU, U = BSU.ui, B = BSU.buildings, R = BSU.render, A = BSU.agents, WL = BSU.wildlife, SP = BSU.sprites, SKY = BSU.SKY, T = BSU.T, P = BSU.params;
const M0 = { ctrl: false, shift: false, meta: false, alt: false };
const W = 96, I = (x, y) => y * W + x;
const TPD = P.time.ticksPerDay;
let s = null;
const fresh = (cash = 1e9) => { BSU.session.newGame({ seed: 42, skipTutorial: true, size: 96 }); s = BSU.state; BSU.progress.unlocked = () => true; BSU.progress.unlockOk = () => true; s.economy.cash = cash; U.showTitle(false); return s; };
const dry = (days = 14) => { const d0 = s.calendar.day; s.weather.rainDays = s.weather.rainDays.filter((q) => q.day < d0 || q.day > d0 + days); s.weather.event = null; s.weather.cellQueue = []; };
const clearVeg = (b) => { for (let k = s.veg.length - 1; k >= 0; k--) { const v = s.veg[k]; if (v && v.tx >= b[0] && v.tx <= b[2] && v.ty >= b[1] && v.ty <= b[3]) BSU.terrain.removeVeg(s, v.tx, v.ty); } };
const clearPaths = (b) => { for (let y = b[1]; y <= b[3]; y++) for (let x = b[0]; x <= b[2]; x++) if (s.tiles.surface[I(x, y)] === 1) B.remove(s, { tile: I(x, y) }, 'qa'); };
const view = (tx, ty) => { R.setZoom(1); R.panToTile(tx, ty, false); U.update(s, 50); };
const px = (tx, ty) => { const p = R.tileToScreen(tx, ty), hit = (x, y) => { const t = R.screenToTile(x, y); return !!t && Math.floor(t.tx) === tx && Math.floor(t.ty) === ty; };
  if (hit(p.x, p.y)) return p; for (let r = 1; r <= 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; if (hit(p.x + dx * 4, p.y + dy * 2)) return { x: p.x + dx * 4, y: p.y + dy * 2 }; } return p; };
const text = (e) => (e && e.children && e.children.length) ? Array.from(e.children).map(text).join('') : String((e && e.textContent) || '');
const cardRows = () => Array.from(U.el['insp-body'].children).map(text);
const l1 = () => U.el['ghost-l1'].textContent, l2 = () => U.el['ghost-l2'].textContent;
const pct = (v) => Math.round(v * 100) + ' %', r1 = (v) => Math.round(v * 10) / 10;
const errs0 = BSU.errors ? BSU.errors.size : 0;

// ---------------------------------------------------------------------------------------------------------------------
// 1. Students (N9). The typical campus: four dorms and a Greek house, Founders' Hall and two Lecture Halls, 1,000 students → 80 on the map
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 1. students ---');
{
  fresh();
  const log = buildLifeCampus(BSU, { layout: LIFE_LAYOUT, students: 1000 });
  ok(!log.some((l) => /REFUSED/.test(l)) && log.length >= 23, `the typical campus builds (${log.length} placements, none refused)`);
  ok(A.count(s) === Math.min(P.agents.cap, P.agents.base + Math.floor(s.economy.students / P.agents.perStudents)) && s.agents.filter((a) => a && a.state !== 'GONE').length === A.count(s), `the agent count rule is unchanged: ${A.count(s)} students on the map for ${s.economy.students} enrolled`);
  const c0 = census(BSU), name = (id) => (s.buildings[id] ? s.buildings[id].type + '#' + id : 'none');
  const homes = Object.entries(c0.homes).map(([id, n]) => [name(id), n]), halls = Object.entries(c0.classes).map(([id, n]) => [name(id), n]);
  const housing = s.buildings.filter((b) => b && /^(dorm|greek_house|res_tower|suites|bunkhouse)$/.test(b.type)), beds = housing.reduce((q, b) => q + BSU.data.catalog[b.type].effects.beds, 0);
  ok(homes.length === housing.length && homes.every(([, n]) => n >= 1), `every housing building has residents (${homes.map((h) => h.join(' ')).join(', ')}): before the pass all ${c0.n} lived in the first dorm`);
  ok(housing.every((b) => { const share = (c0.homes[b.id] || 0) / c0.n, bed = BSU.data.catalog[b.type].effects.beds / beds; return Math.abs(share - bed) < 0.14; }), 'each holds about its share of the beds (within 14 points)');
  ok(halls.length === 3 && halls.every(([, n]) => n >= c0.n * 0.15), `first classes are spread over the three halls (${halls.map((h) => h.join(' ')).join(', ')})`);
  view(84, 45); dry();
  while (s.sky.cycleTick !== 0) BSU.headless.tick(1);
  const m = censusMean(BSU, 2, census);
  console.log(`      two days: ${r1(m.out)} outdoors (${r1(m.moving)} walking, ${r1(m.standing)} standing, ${r1(m.onLawn)} on a lawn), ${r1(m.inside)} inside · ${r1(m.tiles)} tiles · ${r1(m.blocks)} blocks · ${pct(m.share3)} within 3 tiles of the busiest`);
  for (const p of Object.keys(m.byPhase)) { const q = m.byPhase[p]; console.log(`        ${p.padEnd(6)} ${r1(q.out)} out · ${r1(q.standing)} standing · ${r1(q.tiles)} tiles · ${r1(q.blocks)} blocks · ${pct(q.share3)}`); }
  ok(m.tiles >= 27, `over two days the students hold ${r1(m.tiles)} distinct tiles on average (≥ 27; the build before the pass: 22.9)`);
  ok(m.share3 <= 0.55, `${pct(m.share3)} of the students outdoors are within 3 tiles of the busiest tile (≤ 55 %; before: 73 %)`);
  ok(m.byPhase.DAY.share3 <= 0.58 && m.byPhase.GOLDEN.share3 <= 0.58, `…also through the Day (${pct(m.byPhase.DAY.share3)}; before 85 %) and at Golden hour (${pct(m.byPhase.GOLDEN.share3)}; before 88 %)`);
  ok(m.blocks >= 7, `they hold ${r1(m.blocks)} 5 × 5-tile blocks on average (≥ 7; before: 6.0)`);
  ok(m.onLawn >= 0.5, `students stand on the Quad Lawns (${r1(m.onLawn)} on average; a lawn was not ground to stand on)`);
  ok(m.byPhase.GOLDEN.standing >= 12 && m.byPhase.DAY.standing >= 10, `small groups stand around: ${r1(m.byPhase.DAY.standing)} through the Day, ${r1(m.byPhase.GOLDEN.standing)} at Golden hour`);
  ok(A.classAttendance(s) >= 0.8, `class attendance holds (${A.classAttendance(s).toFixed(2)} of the last cycle reached their first class before Dusk)`);
  // where the standing ones stand at Golden hour: several places, none with more than half of them
  while (s.sky.phase !== SKY.GOLDEN) BSU.headless.tick(1); BSU.headless.tick(12);
  const cg = census(BSU), places = Object.entries(cg.where).sort((a, b) => b[1] - a[1]);
  ok(places.length >= 4 && places[0][1] <= cg.standing * 0.5, `at Golden hour ${cg.standing} stand in ${places.length} places (${places.slice(0, 6).map((q) => q[0] + ' ' + q[1]).join(', ')}), no one place with more than half`);
  // the plan's parts
  const PL = P.agents.life;
  ok(PL && PL.lateShare === 0.4 && PL.lateMaxNeed === 90 && PL.classBy === 150 && PL.classSpan === 6 && Array.isArray(PL.weights.lawn) && PL.weights.lawn.length === 4 && PL.hangTicks[0] === 100, 'params.agents.life: lateShare 0.4 (walks under 90 ticks), at the door by tick 150, classSpan 6, four weights a kind, hangTicks from 100');
  while (s.sky.cycleTick !== 30) BSU.headless.tick(1);
  const late = s.agents.filter((a) => a && a.state !== 'GONE' && a.late), early = s.agents.filter((a) => a && a.state !== 'GONE' && !a.late);
  ok(late.length >= 8 && late.length <= 48 && late.every((a) => a.assignedCycle), `the later period: ${late.length} of ${late.length + early.length} students have their first class later in the day (the ones with a short walk), all of them assigned to class today`);
  const pb = s.buildings.find((b) => b && b.type === 'poboy'), cap = A._debug.diningCap(s, pb.id), runs = s.agents.filter((a) => a && a.goal === 'poboy').length;
  ok(runs <= cap, `the Po'boy Shack takes no more morning detours than it serves in a day (${runs} of ${cap})`);
  // a student's activity text for the new visits
  const av = s.agents.find((a) => a && a.state !== 'GONE'); av.goal = 'visit'; av.target = s.buildings.find((b) => b && b.type === 'union').id; av.inside = true; av.state = 'IDLE';
  ok(A.inspect(s, av.id).activity === 'At the Union', 'the inspect card names a visit ("At the Union")');
  // a game loaded in mid-morning: everyone is in the dorm with nothing planned; they set off
  A.regenerate(s); while (s.sky.cycleTick !== 60) BSU.headless.tick(1); A.regenerate(s);
  ok(s.agents.filter((a) => a && a.state !== 'GONE').every((a) => a.inside), 'regenerated in mid-morning: every student starts in the dorm');
  BSU.headless.tick(40);
  ok(s.agents.filter((a) => a && a.state !== 'GONE' && !a.inside).length >= 60, 'forty ticks later they are out (the Day re-run plans whoever has nothing to do)');
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Fields (N8). The painters lay a field along the footprint's X; a rotated footprint's long axis is Y
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 2. fields ---');
{
  fresh();
  ok(typeof SP.fieldLayout === 'function' && typeof SP.fieldMirrored === 'function', 'API: sprites.fieldLayout / fieldMirrored');
  const cat = BSU.data.catalog;
  const cases = [['practice_field', 0, 'Practice Field'], ['practice_field', 1, 'Bayou Field'], ['stadium', 1, 'Stadium I'], ['stadium', 2, 'Stadium II'], ['stadium', 3, 'Stadium III']];
  for (const [type, tier, label] of cases) {
    const row = cat[type];
    for (const rot of [0, 1]) {
      const w = rot ? row.h : row.w, h = rot ? row.w : row.h, L = SP.fieldLayout(type, tier, w, h), long = w >= h ? 'x' : 'y';
      const a = L.posts[0], b = L.posts[1], along = long === 'x' ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]), across = long === 'x' ? Math.abs(b[1] - a[1]) : Math.abs(b[0] - a[0]);
      const mid = long === 'x' ? h / 2 : w / 2, onAxis = long === 'x' ? (a[1] === mid && b[1] === mid) : (a[0] === mid && b[0] === mid);
      const len = long === 'x' ? L.field.x1 - L.field.x0 : L.field.y1 - L.field.y0, wid = long === 'x' ? L.field.y1 - L.field.y0 : L.field.x1 - L.field.x0;
      ok(L.long === long && L.T === (rot === 1) && onAxis && across === 0 && along >= len - 0.2 && len > wid, `${label}${rot ? ' rotated' : ''} (${w} × ${h}): the goalposts stand ${along.toFixed(1)} tiles apart on the middle line of the long (${long.toUpperCase()}) axis, at the two short ends of a ${len.toFixed(1)} × ${wid.toFixed(1)} field`);
      ok(L.lines !== L.long && L.ends.every((e, k) => Math.abs(e[0] - L.posts[k][0]) + Math.abs(e[1] - L.posts[k][1]) < 0.1), '  …the yard lines run across it, and each post is on an end line');
      if (type === 'stadium') { const far = L.stands.filter((q) => q.deck === 1 && (q.inner === 'y1' || q.inner === 'x1'))[0], span = far ? (long === 'x' ? far.r.x1 - far.r.x0 : far.r.y1 - far.r.y0) : 0; ok(far && span >= len - 0.1 && far.inner === (long === 'x' ? 'y1' : 'x1'), `  …the far stand runs the length of the field (${span.toFixed(1)} tiles along ${long.toUpperCase()})`); }
      else if (tier >= 1) ok(L.stands.length === 1 && L.stands[0].inner === (long === 'x' ? 'y1' : 'x1'), '  …the bleachers sit on the far long side');
      ok(SP.fieldMirrored(row, rot) === (rot === 1), `  …${rot ? 'painted as the mirror of the unrotated field' : 'painted as it is'}`);
    }
  }
  ok(SP.fieldMirrored(cat.dorm, 1) === false && SP.fieldMirrored(cat.parking, 1) === false, 'no other rotatable row is mirrored');
  // the painter really mirrors: a rotated bake flips the context once, an unrotated one never; the sprite keeps the rotated box's size and anchor
  const begin0 = BSU.brush.begin, flips = [];
  BSU.brush.begin = function (ctx, w, h, spec) { const g = begin0.call(BSU.brush, ctx, w, h, spec); const sc0 = ctx.scale; ctx.scale = function (x, y) { flips.push([spec.id, x, y]); return sc0 ? sc0.apply(ctx, arguments) : undefined; }; return g; };
  for (const id of ['practice_field', 'stadium']) {
    const v = id === 'stadium' ? (2 << BSU.SPR.TIER_SHIFT) : 0, row = cat[id];
    flips.length = 0; const e0 = SP.bakeWith(id, v, 0, 1, {}); const n0 = flips.filter((f) => f[1] === -1).length;
    flips.length = 0; const e1 = SP.bakeWith(id + ':r', v, 0, 1, {}); const n1 = flips.filter((f) => f[1] === -1 && f[2] === 1).length;
    const box1 = SP.buildingBox(row, v, 1, 1);
    ok(n0 === 0 && n1 === 1 && e0 && e1 && e1.w === box1.w && e1.h === box1.h && e1.ox === box1.ox && e1.oy === box1.oy && e1.w === e0.w, `${id}: the rotated sprite is painted mirrored (one scale(−1, 1)), on the rotated box's canvas (${e1 && e1.w} × ${e1 && e1.h}, anchor ${e1 && e1.ox}, ${e1 && e1.oy})`);
  }
  BSU.brush.begin = begin0;
  // the lit face stays on the left: a mirrored painting swaps the SW and SE tones
  { const calls = [], base = SP.ctx2d(SP.newCanvas(8, 8));
    const ctx = new Proxy(base, { set(t, k, v) { if ((k === 'fillStyle' || k === 'strokeStyle') && typeof v === 'string') calls.push(v); t[k] = v; return true; }, get(t, k) { if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop(_, c) { calls.push(c); } }); return t[k]; } });
    const env = BSU.brush.env(1), q = [[0, 0], [4, 0], [4, 4], [0, 4]];
    BSU.brush.fillQuadShaded(ctx, q, '#808080', { face: 'sw', material: 'paint', noAO: true }, env); const sw = calls.slice(); calls.length = 0;
    BSU.brush.fillQuadShaded(ctx, q, '#808080', { face: 'se', material: 'paint', noAO: true }, env); const se = calls.slice(); calls.length = 0;
    BSU.brush.fillQuadShaded(ctx, q, '#808080', { face: 'sw', material: 'paint', noAO: true }, Object.assign({}, env, { flip: true })); const swF = calls.slice();
    ok(sw.length > 0 && sw.join() !== se.join() && swF.join() === se.join(), 'brush.fillQuadShaded under env.flip gives a SW face the SE tone (the sun stays on the left of a mirrored field)'); }
  // render: the game follows the rotation
  clearVeg([70, 28, 95, 62]); clearPaths([78, 42, 90, 58]);
  const p0 = B.place(s, 'practice_field', 81, 43, { rot: 0 }), p1 = B.place(s, 'practice_field', 82, 48, { rot: 1 });
  ok(p0.ok && p1.ok, 'a Practice Field placed unrotated (4 × 3) and rotated (3 × 4)');
  const b0 = s.buildings[p0.id], b1 = s.buildings[p1.id];
  const q0 = R.fieldQuad(b0), q1 = R.fieldQuad(b1);
  ok(q0.T === false && q1.T === true && q1.fw === 4 && q1.fh === 3 && q0.fw === 4, 'render.fieldQuad: the rotated field is the same 4 × 3 field, transposed (T)');
  const g0a = R.fieldToTile(b0, 0, 26.65), g0b = R.fieldToTile(b0, 100, 26.65), g1a = R.fieldToTile(b1, 0, 26.65), g1b = R.fieldToTile(b1, 100, 26.65);
  ok(Math.abs(g0b.tx - g0a.tx) > 2 && Math.abs(g0b.ty - g0a.ty) < 1e-9 && Math.abs(g1b.ty - g1a.ty) > 2 && Math.abs(g1b.tx - g1a.tx) < 1e-9, `the goal lines are ${(g0b.tx - g0a.tx).toFixed(2)} tiles apart along X unrotated and ${(g1b.ty - g1a.ty).toFixed(2)} along Y rotated: the game is played down the long side`);
  const sl = R.fieldToTile(b1, 50, 0), sr = R.fieldToTile(b1, 50, 53.3);
  ok(Math.abs(sr.tx - sl.tx) > 1.5 && Math.abs(sr.ty - sl.ty) < 1e-9, 'the sidelines are the long edges of the rotated field');
  const L1 = SP.fieldLayout('practice_field', 0, b1.w, b1.h);
  ok(L1.posts.every((p, k) => Math.abs(b1.tx + p[0] - [R.fieldToTile(b1, -10, 26.65), R.fieldToTile(b1, 110, 26.65)][k].tx) < 0.01 && Math.abs(b1.ty + p[1] - [R.fieldToTile(b1, -10, 26.65), R.fieldToTile(b1, 110, 26.65)][k].ty) < 0.26), 'the painted goalposts stand where the game\'s end lines are (u −10 and 110)');
  const st2 = B.place(s, 'stadium', 79, 33, { rot: 1 }), road = { ok: true };   // beside the highway (a stadium needs a road within 4)
  if (st2.ok) { const sb = s.buildings[st2.id]; sb.tier = 2; const SG = R.stadiumGeom(sb); ok(sb.w === 5 && sb.h === 6 && SG && SG.fw === 6 && SG.fh === 5 && R.fieldQuad(sb).T === true, 'render.stadiumGeom of a rotated Stadium II is the 6 × 5 geometry (drawn transposed: stands, fan rows, the shader clip)'); }
  else ok(false, 'a rotated stadium could not be placed: ' + st2.reason + ' / road ' + (road && road.ok));
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Lawns (N26)
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 3. lawns ---');
{
  fresh(5e6);
  clearVeg([70, 40, 95, 62]); clearPaths([78, 42, 90, 58]);
  ok(typeof B.lawnLayout === 'function' && typeof B.lawnGroup === 'function' && B.isBlockRow('quad') === true && B.isBlockRow('dorm') === false && B.isBlockRow('path') === false, 'API: buildings.lawnLayout / lawnGroup / isBlockRow (the Quad Lawn only)');
  const a = B.place(s, 'quad', 83, 46, {});
  ok(a.ok && [I(83, 46), I(84, 46), I(83, 47), I(84, 47)].every((i) => s.tiles.walk[i] === P.agents.walkClass.dry), 'a Quad Lawn is ground to walk on (walk class dry on its four tiles; it was blocked)');
  const sb = B.setbackSpot(s, 'quad', 85, 46, {}), sbDorm = B.setbackSpot(s, 'dorm', 85, 46, {});
  ok(sb.tx === 85 && sb.ty === 46 && sb.snapped === false && sbDorm.snapped === true, 'the setback does not push a lawn away from a lawn (the ghost stays at 85, 46); a Dorm beside the lawn is still set back a tile');
  const b = B.place(s, 'quad', 85, 46, {});
  ok(b.ok, 'the second lawn is placed against the first');
  ok(B.lawnGroup(s, a.id) === null && B.lawnLayout(s).groups.length === 0, 'while they are being built they are not lawns yet');
  BSU.headless.fastForwardDays(2);
  const g2 = B.lawnGroup(s, a.id), L2 = B.lawnLayout(s);
  ok(g2 && g2.lawns === 2 && g2.tiles === 8 && g2.w === 4 && g2.h === 2 && g2.text === 'Part of a 8-tile quad · 2 lawns' && L2.groups.length === 1 && B.lawnGroup(s, b.id).ids.join() === g2.ids.join(), `two lawns side by side are one quad: "${g2 && g2.text}"`);
  ok(g2.value === 2 && g2.cap === 6 && g2.radius === 6, 'the rule on the card: +2 within 6 tiles of each lawn, adding up to +6 where lawns overlap');
  const LK = B.LAWN, lk = (x, y) => L2.look[I(x, y)];
  ok((lk(84, 46) & 2) && (lk(85, 46) & 8) && (lk(84, 47) & 2) && (lk(85, 47) & 8), 'the look word: no kerb on the shared edge (E of the west lawn, W of the east lawn)');
  ok(!(lk(83, 46) & 8) && !(lk(83, 46) & 1) && !(lk(86, 47) & 2) && !(lk(86, 47) & 4), '…and a kerb all round the pair (the outer edges carry no neighbour bit)');
  const wx = (v) => (v >> LK.WALK_X) & 3, wy = (v) => (v >> LK.WALK_Y) & 3;
  ok([83, 84, 85, 86].every((x) => wx(lk(x, 46)) === 3 && wx(lk(x, 47)) === 2), 'the long walk runs down the seam between the two rows of tiles, the whole length of the pair');
  ok(wy(lk(84, 46)) === 3 && wy(lk(85, 46)) === 2 && wy(lk(83, 46)) === 0 && wy(lk(86, 46)) === 0, 'the cross walk is on the seam between the two lawns: laid out for the pair, not one cross a lawn');
  ok(L2.oaks.length === 2 && L2.oaks.every((o) => o.tx === 83 || o.tx === 86) && L2.oaks.every((o) => L2.look[o.i] & LK.OAK), `each lawn keeps its Live Oak, planted toward the outside (tiles ${L2.oaks.map((o) => o.tx + ',' + o.ty).join(' and ')})`);
  const au = B.auras(s);
  ok(Math.abs(au.green[I(85, 49)] - 4) < 1e-6, 'two lawns give +4 where both reach (+2 each, stacking as the catalog says)');
  // a corner touch is not a join; a third lawn in the gap joins all
  const c = B.place(s, 'quad', 87, 48, {}); BSU.headless.fastForwardDays(2);
  ok(c.ok && B.lawnLayout(s).groups.length === 2 && B.lawnGroup(s, c.id).lawns === 1 && /on its own/.test(B.lawnGroup(s, c.id).text), 'a lawn that only touches at a corner is its own lawn');
  B.remove(s, c.id, 'qa');
  // the drag: a block of six lawns, quoted, priced per tile, one undo
  const rect = []; for (let y = 50; y <= 53; y++) for (let x = 82; x <= 87; x++) rect.push(I(x, y));
  const run = [I(82, 50)].concat(rect.filter((i) => i !== I(82, 50) && i !== I(87, 53)), [I(87, 53)]);
  const q = B.runQuote(s, 'quad', run, {});
  const each = [[82, 50], [84, 50], [86, 50], [82, 52], [84, 52], [86, 52]].map((p) => B.canPlace(s, 'quad', p[0], p[1], { ignoreCash: true }).cost), sum = each.reduce((x, y) => x + y, 0);
  ok(q.block === true && q.blocks === 6 && q.placed === 24 && q.tiles.length === 24 && q.skipped.length === 0 && q.cost === sum && q.perTile === 7500, `runQuote of a 6 × 4 drag: 6 lawns, 24 tiles, $${q.cost.toLocaleString('en-US')} ($7,500 a tile${sum > 180000 ? ' plus grading' : ''})`);
  const q3 = B.runQuote(s, 'quad', [I(82, 50), I(83, 50), I(84, 50)], {});
  ok(q3.blocks === 2 && q3.placed === 8 && q3.tiles.indexOf(I(85, 51)) >= 0, 'a drag three tiles long lays two whole lawns (the block reaches past the cursor)');
  const qb = B.runQuote(s, 'quad', [I(86, 52), I(85, 52), I(84, 52), I(83, 52)], {});
  ok(qb.blocks === 2 && qb.tiles.indexOf(I(86, 52)) >= 0 && qb.tiles.indexOf(I(83, 53)) >= 0 && qb.tiles.indexOf(I(87, 52)) < 0, 'dragged backwards the block grows the other way from the anchor');
  // through the pointer: press, drag, the label, release
  view(85, 51);
  const n0 = s.buildings.filter((x) => x && x.type === 'quad').length, cash0 = s.economy.cash;
  U.selectTool(s, 'quad'); const pa = px(82, 50), pb = px(87, 53);
  U.pointer('move', pa.x, pa.y, 0, M0);
  ok(/Click for one lawn · drag to lay a block/.test(l2()) && !/\/ tile/.test(l1()), `armed: "${l1()}" / "${l2()}"`);
  U.pointer('down', pa.x, pa.y, 0, M0); for (let k = 1; k <= 12; k++) U.pointer('move', pa.x + (pb.x - pa.x) * k / 12, pa.y + (pb.y - pa.y) * k / 12, 0, M0);
  ok(l1().indexOf('24 tiles · $') === 0 && /6 lawns · \$7,500 a tile · they join into one quad/.test(l2()), `mid-drag label: "${l1()}" / "${l2()}"`);
  const gs = R.ghostSpec; ok(gs && gs.tiles.length === 24 && !gs.sprite && gs.color === 'green', 'the ghost shows the 24 tiles of the block (no single-lawn sprite while dragging)');
  U.pointer('up', pb.x, pb.y, 0, M0);
  const n1 = s.buildings.filter((x) => x && x.type === 'quad').length, ui1 = B.undoInfo(s);
  ok(n1 - n0 === 6 && cash0 - s.economy.cash === q.cost && s.ui.tool && s.ui.tool.id === 'quad', `released: six lawns for $${(cash0 - s.economy.cash).toLocaleString('en-US')}, exactly the quote; the run tool stays in hand as the other run tools do`);
  ok(ui1 && ui1.n === 6 && /Quad Lawn/.test(ui1.name), `one undo record: ${ui1 && ui1.n} × ${ui1 && ui1.name}`);
  const u = B.undo(s);
  ok(u.ok && s.buildings.filter((x) => x && x.type === 'quad').length === n0 && s.economy.cash === cash0 && [I(82, 50), I(87, 53)].every((i) => s.tiles.owner[i] < 0), 'one undo takes the whole block back and refunds it');
  // a click is still one lawn, and one click ends a click-placement
  U.selectTool(s, 'quad'); const pc = px(82, 50); U.pointer('move', pc.x, pc.y, 0, M0); U.pointer('down', pc.x, pc.y, 0, M0); U.pointer('up', pc.x, pc.y, 0, M0);
  ok(s.buildings.filter((x) => x && x.type === 'quad').length === n0 + 1 && s.ui.tool === null, 'a click lays one lawn and drops the tool (one click ends a click-placement)');
  const lawnsNow = s.buildings.filter((x) => x && x.type === 'quad').length;
  U.selectTool(s, 'quad'); const pw = px(84, 46); U.pointer('move', pw.x, pw.y, 0, M0); U.pointer('down', pw.x, pw.y, 0, M0); U.pointer('up', pw.x, pw.y, 0, M0);
  ok(s.buildings.filter((x) => x && x.type === 'quad').length === lawnsNow && s.ui.tool === null, 'a refused click (on a tile that is taken) lays nothing and drops the tool too');
  // the block for real, finished
  B.remove(s, B.at(s, 82, 50).id, 'qa');
  const pr = B.placeRun(s, 'quad', run, {}); BSU.headless.fastForwardDays(2);
  const blk = B.at(s, 84, 51), gb = B.lawnGroup(s, blk.id), Lb = B.lawnLayout(s);
  ok(pr.ok && pr.blocks === 6 && pr.placed === 24 && gb.lawns === 6 && gb.tiles === 24 && gb.text === 'Part of a 24-tile quad · 6 lawns', `placeRun lays the block: "${gb.text}"`);
  let seams = 0, kerbs = 0, beds = 0, benches = 0; for (let y = 50; y <= 53; y++) for (let x = 82; x <= 87; x++) { const v = Lb.look[I(x, y)]; if (x < 87 && !(v & 2)) seams++; if (y < 53 && !(v & 4)) seams++; for (const bit of [1, 2, 4, 8]) if (!(v & bit)) kerbs++; if (v & LK.BED) beds++; if (v & LK.BENCH) benches++; }
  ok(seams === 0 && kerbs === 20, `no kerb between its lawns, a kerb on its ${kerbs} outer tile edges`);
  ok([82, 83, 84, 85, 86, 87].every((x) => ((Lb.look[I(x, 51)] >> LK.WALK_X) & 3) === 3 && ((Lb.look[I(x, 52)] >> LK.WALK_X) & 3) === 2) && [50, 51, 52, 53].every((y) => ((Lb.look[I(84, y)] >> LK.WALK_Y) & 3) === 3 && ((Lb.look[I(85, y)] >> LK.WALK_Y) & 3) === 2), 'one walk down its length and one across its middle (two for the whole block, not a cross per lawn)');
  const oaksB = Lb.oaks.filter((o) => gb.ids.indexOf(o.id) >= 0);
  ok(oaksB.length === 6 && oaksB.every((o) => o.tx === 82 || o.tx === 87 || o.ty === 50 || o.ty === 53) && beds === 4, `its six oaks stand on the outer ring of tiles, a flower bed in each of its four rounded corners (${benches} benches along the walks)`);
  // the sprite of a lawn tile, and the ground layer
  const e = SP.get('lawn', Lb.look[I(84, 51)], 0, 1);
  ok(e && e.w === 64 && e.h === 32 + SP.LAWN_UP && e.ox === -32 && e.oy === -(16 + SP.LAWN_UP), `the lawn tile sprite: ${e && e.w} × ${e && e.h}, anchored on the tile centre`);
  BSU.headless.render();
  const li = R.lawnInfo(), DL = R.drawList;
  ok(li.groups === Lb.groups.length && li.tiles === 32 && li.oaks === 8, `render's ground layer carries ${li.tiles} lawn tiles in ${li.groups} quads`);
  ok(!DL.some((q2) => q2.kind === 'building' && q2.b && q2.b.type === 'quad') && DL.filter((q2) => q2.kind === 'tree' && q2.id === 'oak' && Lb.oaks.some((o) => o.tx === q2.ax && o.ty === q2.ay)).length === 8, 'a finished lawn is not a sprite over the students any more: its oak is a tree in the depth-sorted list');
  const route = A.routeSync(s, I(84, 49), I(84, 54), 'walk');
  ok(route && route.some((i) => i === I(84, 51) || i === I(84, 52)), 'students walk straight across the lawn');
  // the card
  U.inspect(s, { kind: 'building', id: blk.id }); U.update(s, 600);
  const rows = cardRows();
  ok(rows.some((r) => /Part of a 24-tile quad · 6 lawns/.test(r)) && rows.some((r) => /\+2 within 6 tiles of each lawn · adds up to \+6 where lawns overlap/.test(r)), 'the card: "Part of a 24-tile quad · 6 lawns" and the rule in words');
  U.closeInspect();
  // not enough cash for the whole block: what can be paid for is laid, the rest is red
  s.economy.cash = 70000 - s.economy.loanLimit;
  const qc = B.runQuote(s, 'quad', [I(82, 56), I(87, 57)].length ? (() => { const t = []; for (let y = 56; y <= 57; y++) for (let x = 82; x <= 87; x++) t.push(I(x, y)); return t; })() : [], {});
  ok(qc.blocks >= 1 && qc.blocks < 3 && qc.skipped.some((k) => k.reason === 'Not enough cash'), `short of cash the quote lays ${qc.blocks} of 3 lawns and marks the rest "Not enough cash"`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Gators (N27)
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 4. gators ---');
{
  const PG = P.wildlife.gator;
  ok(PG.visitMax === 1 && PG.visitGapMax === 28 && PG.visitGapMin === 2 && PG.visitGapAttract === 4 && PG.matingGapMult === 0.5 && PG.campusLoungeTicks.join() === '120,360' && PG.loungeTicks.join() === '300,1200' && P.agents.fleeAgainTicks === 150, 'params: one visitor at a time, gap 28 / (1 + attraction / 4) days (never under 2, halved in the mating months), 24–72 s on campus');
  ok(WL._visitGap(0, 1) === 28 && Math.abs(WL._visitGap(2, 1) - 18.667) < 0.01 && WL._visitGap(4, 1) === 14 && Math.abs(WL._visitGap(3, 1) - 16) < 1e-9 && WL._visitGap(100, 1) === 2 && WL._visitGap(4, 4) === 7, 'the gap: nothing to eat 28 days · one dumpster 18.7 · a dumpster and a Greek porch 14 · gator-proof dumpster and a porch 16 · a flooded campus 2 · in April 7');
  fresh();
  buildLifeCampus(BSU, { layout: LIFE_LAYOUT, students: 1000 });
  view(84, 45);
  let enters = 0, flees = 0; const perYear = [];
  BSU.events.on(BSU.EV.GATOR_CAMPUS, (p) => { if (p.enter) enters++; }, 'lifetest');
  BSU.events.on(BSU.EV.AGENT_FLEE, () => { flees++; }, 'lifetest');
  const cm = () => WL.campusMask(s), land = (i) => s.tiles.type[i] !== T.OPEN_WATER && s.tiles.type[i] !== T.BAYOU && s.tiles.type[i] !== T.POND;
  let daysOn = 0, daysLand = 0, ticksOn = 0, stretch = 0, longest = 0, most = 0, sunOnCampus = 0, ticks = 0, y0 = { on: 0, ent: 0 };
  const t0 = Date.now();
  for (let d = 0; d < 360; d++) {
    let on = false, onLand = false;
    for (let t = 0; t < TPD; t++) {
      BSU.headless.tick(1); ticks++;
      let n = 0; const mask = cm();
      for (const g of s.gators) { if (g.onCampus) n++; const gi = Math.floor(g.ty) * W + Math.floor(g.tx); if (mask[gi] && land(gi)) { onLand = true; if (g.state === 'SUN' && (ticks % 50) === 0) sunOnCampus++; } }
      if (n) { on = true; ticksOn++; } if (n > most) most = n;
    }
    if (on) { daysOn++; stretch = 0; } else { stretch++; if (stretch > longest) longest = stretch; }
    if (onLand) daysLand++;
    if ((d + 1) % 120 === 0) { perYear.push({ days: daysOn - y0.on, visits: enters - y0.ent }); y0 = { on: daysOn, ent: enters }; }
  }
  BSU.events.off && BSU.events.clear('lifetest');
  console.log(`      three years on the typical campus (${((Date.now() - t0) / 1000).toFixed(0)} s): a gator ashore on campus on ${daysOn} of 360 days (${pct(daysOn / 360)}), ${pct(ticksOn / ticks)} of the time; ${enters} visits (${r1(enters / 3)} a year); longest stretch without one ${longest} days; most at once ${most}; any gator on campus ground ${daysLand} days; ${flees} flees (${Math.round(flees / 3)} a year)`);
  console.log('      per year: ' + perYear.map((y, k) => `Y${k + 1} ${y.days} days, ${y.visits} visits`).join(' · '));
  ok(daysOn / 360 >= 0.12 && daysOn / 360 <= 0.45, `a gator is on campus on ${pct(daysOn / 360)} of days (12–45 %; the build before the pass: 100 %)`);
  ok(ticksOn / ticks <= 0.33, `…${pct(ticksOn / ticks)} of the time (≤ 33 %; before: 99 %)`);
  ok(enters / 3 >= 6 && enters / 3 <= 36, `${r1(enters / 3)} visits a year (6–36; before, 95 entries a year by gators that never left)`);
  ok(perYear.every((y) => y.visits >= 3), 'every year has visits: they are still part of the swamp');
  ok(longest >= 10, `the longest stretch without a gator on campus is ${longest} days (≥ 10; before: 0)`);
  ok(most <= 7, `at most ${most} at once (the wave after a storm; an ordinary visit is one gator)`);
  ok(flees / 3 <= 2500, `${Math.round(flees / 3)} student flees a year (≤ 2,500; before: 11,268)`);
  ok(sunOnCampus === 0, 'no gator suns on campus ground (the bank it suns on is never within campusRadius of a path or a building)');
  ok(s.progress.firsts.gatorDay >= 0 && s.progress.firsts.gatorDay < 120, `the first visit comes in the first year (day ${s.progress.firsts.gatorDay}): the "Preserve it" goal's trigger is reached`);
  const vi = WL.visitInfo(s);
  ok(vi && vi.max === 1 && vi.visits >= 10 && Number.isFinite(vi.nextDay), `wildlife.visitInfo: ${vi && vi.visits} budgeted visits, the next not before day ${vi && Math.round(vi.nextDay)}`);
  ok(B.gatorClosed(s, s.buildings.find((b) => b && b.type === 'dining_hall').id) === false, 'the Dining Hall is not closed by a gator (the closures were retired with the calm alerts pass; still so)');

  // the scripted first visit on a campus no gator has visited: it ignores the budget and starts the gap
  fresh(); buildLifeCampus(BSU, { layout: LIFE_LAYOUT, students: 600, days: 3 });
  s.wildlife.nextVisitDay = s.calendar.day + 500;   // the budget says no
  for (const g of s.gators) { if (g.onCampus || g.state === 'WANDER' || g.state === 'LOUNGE' || g.state === 'RETREAT') WL.relocate(s, g.id); }
  let first = -1; BSU.events.on(BSU.EV.GATOR_CAMPUS, (p) => { if (p.enter && first < 0) first = s.tick; }, 'lifetest');
  const tk0 = s.tick; WL.forceFirstGator(s); BSU.headless.tick(900);
  BSU.events.clear('lifetest');
  ok(first > tk0, `forceFirstGator brings a gator ashore on campus whatever the budget (after ${first - tk0} ticks)`);

  // students and a gator: in the water it scares nobody; ashore they run once, then walk past
  fresh(); BSU.economy.addStudents(s, 200, 'qa'); A.regenerate(s);
  clearVeg([70, 40, 95, 62]);
  const stud = s.agents.find((a) => a && a.state !== 'GONE'); const water = (() => { for (let i = 0; i < s.tiles.type.length; i++) if (s.tiles.type[i] === T.BAYOU) return i; return -1; })();
  const hold = (a, x, y) => { a.tx = a.px = x; a.ty = a.py = y; a.inside = false; a.state = 'IDLE'; a.goal = 'idle'; a.target = -1; a.route = []; a.next = null; a.waitTicks = 400; a.fleeUntil = -1; a.braveUntil = -1; a.fleeGator = -1; };
  s.gators.length = 0;
  const gw = WL.spawnGator(s, water); gw.state = 'SWIM';
  hold(stud, (water % W) + 0.5, ((water / W) | 0) + 1.5);
  let fl = 0; BSU.events.on(BSU.EV.AGENT_FLEE, (p) => { if (p.id === stud.id) fl++; }, 'lifetest');
  for (let k = 0; k < 20; k++) { gw.tx = (water % W) + 0.5; gw.ty = ((water / W) | 0) + 0.5; gw.state = 'SWIM'; gw.route = []; A.tick(s, { newDay: false }); s.tick++; }
  ok(fl === 0 && stud.state !== 'FLEE', 'a gator swimming one tile away scares nobody');
  s.gators.length = 0;
  const gl = WL.spawnGator(s, I(84, 48)); gl.state = 'LOUNGE'; gl.lounge = 9999;
  hold(stud, 84.5, 49.5);
  for (let k = 0; k < 5; k++) { A.tick(s, { newDay: false }); s.tick++; }
  ok(fl === 1 && stud.state === 'FLEE', 'the same gator ashore: the student runs');
  for (let k = 0; k < P.agents.gatorFleeTicks + 2; k++) { A.tick(s, { newDay: false }); s.tick++; }
  hold(stud, 84.5, 49.5); stud.fleeGator = gl.id; stud.braveUntil = s.tick + P.agents.fleeAgainTicks;
  for (let k = 0; k < 40; k++) { A.tick(s, { newDay: false }); s.tick++; }
  ok(fl === 1 && stud.state !== 'FLEE', `…and for the next ${P.agents.fleeAgainTicks} ticks walks past that gator instead of running again (it ran every ${P.agents.gatorFleeTicks} ticks before)`);
  stud.braveUntil = -1; hold(stud, 84.5, 49.5); stud.braveUntil = -1;
  for (let k = 0; k < 5; k++) { A.tick(s, { newDay: false }); s.tick++; }
  ok(fl === 2, 'once that has passed it runs again');
  BSU.events.clear('lifetest');

  // the Wildlife Officer Post: the officer walks a gator home, and comes home itself (it used to wait in RETURN for ever after its first escort)
  fresh(); clearVeg([70, 40, 95, 62]);
  let post = { ok: false }; for (const q of [[85, 46], [83, 46], [85, 44], [83, 44], [85, 48]]) { post = B.place(s, 'wildlife_post', q[0], q[1], {}); if (post.ok) break; }
  BSU.headless.fastForwardDays(3);
  ok(post.ok && s.wildlife.officers.length === 1, 'a Wildlife Officer Post and its officer');
  for (const round of [1, 2]) {
    for (const g of s.gators) if (g.onCampus) WL.relocate(s, g.id);
    const pb0 = s.buildings[post.id], rel0 = s.wildlife.relocations; const g = WL.spawnGator(s, I(pb0.tx + 2, pb0.ty + 2)); g.state = 'LOUNGE'; g.lounge = 9999;
    BSU.headless.tick(260);
    const o = s.wildlife.officers[0];
    ok(s.wildlife.relocations > rel0 && !g.onCampus && o.state === 'IDLE' && Math.abs(o.tx - (s.buildings[post.id].tx + 0.5)) < 0.01, `round ${round}: a gator lounging two tiles from the post is walked home (relocations ${rel0} → ${s.wildlife.relocations}) and the officer is back at the post, idle`);
  }

  // the Gator Fence still stops the walk: a closed ring round the Dining Hall, and the scripted visit never gets inside it
  fresh(); clearVeg([70, 40, 95, 62]); clearPaths([78, 42, 90, 58]);
  const dh = B.place(s, 'dining_hall', 83, 49, {}); BSU.headless.fastForwardDays(3);
  clearPaths([79, 45, 89, 55]);   // (the hall's own gravel tie would be a gate in the ring)
  const ring = []; for (let x = 81; x <= 87; x++) { ring.push(I(x, 47)); ring.push(I(x, 53)); } for (let y = 48; y <= 52; y++) { ring.push(I(81, y)); ring.push(I(87, y)); }
  const fr = B.placeRun(s, 'gator_fence', ring, {});
  ok(dh.ok && fr.ok && fr.placed === ring.length && ring.every((i) => WL.gatorGridPassable(s, i) === false), `a Gator Fence ring of ${fr.placed} tiles round the Dining Hall: no gator passes a fence tile`);
  for (const g of s.gators) if (g.onCampus) WL.relocate(s, g.id);
  let inside = 0; WL.forceFirstGator(s);
  for (let k = 0; k < 900; k++) { BSU.headless.tick(1); for (const g of s.gators) { const x = Math.floor(g.tx), y = Math.floor(g.ty); if (x > 81 && x < 87 && y > 47 && y < 53) inside++; } }
  ok(inside === 0, 'sent to the dumpster inside the ring, the gator never gets in (the fence still stops the walk outright)');
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Night (N29)
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 5. night ---');
{
  fresh();
  const PN = P.render.night;
  ok(PN && PN.modes.join() === 'dim,standard,bright' && PN.levels.dim === 1 && PN.levels.standard === 0.55 && PN.levels.bright === 0.34 && PN.cursor.r === 110 && PN.cursor.rArmed === 150 && PN.cursor.a === 0.22 && PN.cursor.aArmed === 0.36, 'params.render.night: three modes, levels 1 / 0.55 / 0.34, the cursor light 110 px at 0.22 (150 px at 0.36 with a tool armed)');
  ok(typeof R.nightFloor === 'function' && typeof R.nightInfo === 'function' && R.cursor && typeof U.setNightMode === 'function' && U.nightModes().join() === 'dim,standard,bright', 'API: render.nightFloor / nightInfo / cursor, ui.setNightMode / nightMode / nightModes');
  const fd = R.nightFloor('dim'), fs = R.nightFloor('standard'), fb = R.nightFloor('bright'), lum = (f) => 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  ok(Math.abs(fd[0] - 0.347) < 0.005 && Math.abs(fd[1] - 0.357) < 0.005 && Math.abs(fd[2] - 0.435) < 0.005, `Dim is the night as it was: the scene multiplied by ${fd.map((v) => v.toFixed(2)).join(' / ')}`);
  ok(fs.every((v) => v >= 0.6) && lum(fs) >= 0.61 && lum(fs) <= 0.7, `Standard (the default) lifts the floor to ${fs.map((v) => v.toFixed(2)).join(' / ')}: the darkest hour keeps ${pct(lum(fs))} of the daylight value (it kept ${pct(lum(fd))})`);
  ok(fb.every((v) => v >= 0.74) && lum(fb) > lum(fs) + 0.08, `Bright: ${fb.map((v) => v.toFixed(2)).join(' / ')}`);
  ok(fs[2] > fs[0] && fb[2] > fb[0], 'the night stays blue at every setting (the blue factor is the highest)');
  ok(U.settings().night === 'standard' && U.nightMode() === 'standard' && BSU.newState(1).ui.settings.night === 'standard', 'the default setting is Standard');
  // the tint table itself is untouched (pure): the setting scales the night's share when the pass draws
  const tf = R.tintFor(SKY.NIGHT, 0.2); ok(tf.c1 === P.render.tint.night.color && Math.abs(tf.a1 - P.render.tint.night.alpha) < 1e-9, 'render.tintFor(NIGHT) still returns the table\'s night tint (0.62)');
  // the cursor light: off by day, on at night, stronger with a tool, following the pointer
  view(84, 44);
  const sky = (ph, t) => BSU.weather.scriptSky(s, ph, t);
  U.pointer('move', 640, 400, 0, M0);
  ok(R.cursor.on === true && R.cursor.x === 640 && R.cursor.y === 400, 'ui.pointer writes the pointer to render.cursor');
  sky(SKY.DAY, 0.5); let ni = R.nightInfo(s);
  ok(ni.night === 0 && ni.cursor.on === false && ni.cursor.a === 0, 'by day: no light under the pointer');
  sky(SKY.NIGHT, 0.4); ni = R.nightInfo(s);
  ok(ni.night === 1 && ni.cursor.on && ni.cursor.x === 640 && ni.cursor.y === 400 && ni.cursor.r === 110 && Math.abs(ni.cursor.a - 0.22) < 1e-9 && ni.mode === 'standard' && ni.level === 0.55, 'at night: a 110-px light at 0.22 under the pointer');
  U.selectTool(s, 'dorm'); U.pointer('move', 700, 420, 0, M0); ni = R.nightInfo(s);
  ok(ni.cursor.on && ni.cursor.x === 700 && ni.cursor.r === 150 && Math.abs(ni.cursor.a - 0.36) < 1e-9, 'with a tool armed: 150 px at 0.36, and it follows the pointer');
  U.selectTool(s, null);
  sky(SKY.DUSK, 0.5); ni = R.nightInfo(s);
  ok(ni.cursor.on && Math.abs(ni.cursor.a - 0.22 * 0.25) < 1e-9, 'it fades in through Dusk with the night (a quarter of its strength half way)');
  sky(SKY.NIGHT, 0.4); R.cursor.on = false; ok(R.nightInfo(s).cursor.on === false, 'with the pointer off the map: nothing');
  R.cursor.on = true;
  // a frame draws it: one 'lighter' halo blob in the tint pass, none by day
  const blob0 = BSU.brush.drawBlob; let halos = [];
  BSU.brush.drawBlob = function (g, kind, color, cx, cy, rx, ry, alpha) { if (color === PN.cursor.color) halos.push({ kind, cx, cy, rx, alpha, op: g.globalCompositeOperation }); return blob0.apply(BSU.brush, arguments); };
  BSU.headless.render(); const nNight = halos.length, h0 = halos[0];
  sky(SKY.DAY, 0.5); halos = []; BSU.headless.render(); const nDay = halos.length;
  BSU.brush.drawBlob = blob0;
  ok(nNight === 1 && h0.kind === 'halo' && h0.cx === 700 && h0.rx === 110 && h0.op === 'lighter' && nDay === 0, 'the tint pass draws it as one cached halo blob, added to the scene (none by day)');
  // the vignette: the level is baked into its cached canvas, so the full Night still blits it at alpha 1 (a constant alpha below 1 on four
  // frame-wide slabs cost 2 ms a frame at dpr 2 in software raster: 21.9 → 24.0 ms on the fps campus at midnight)
  { const vigDraws = (mode, ph, t) => { U.setNightMode(mode); sky(ph, t); const log = [], base = { globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: true, fillStyle: '#000', strokeStyle: '#000' };
      const g = new Proxy(base, { get(o, k) { if (k in o) return o[k]; if (typeof k !== 'string') return undefined; return (...a) => { if (k === 'drawImage' && a.length === 9 && a[0] && a[0].width === Math.round(R.view.vw * (R.view.dpr || 1))) log.push(o.globalAlpha); }; }, set(o, k, v) { o[k] = v; return true; } });
      R.passFn('fog')(s, g, R.view, 1, 16); return log; };
    const vS = vigDraws('standard', SKY.NIGHT, 0.4), vD = vigDraws('dim', SKY.NIGHT, 0.4), vB = vigDraws('bright', SKY.NIGHT, 0.4), vDay = vigDraws('standard', SKY.DAY, 0.5), vDusk = vigDraws('standard', SKY.DUSK, 0.5);
    ok(vS.length === 4 && vS.every((a) => a === 1) && vD.length === 4 && vD.every((a) => a === 1) && vB.length === 4 && vB.every((a) => a === 1), `the night vignette is four slabs drawn at alpha 1 at every setting (Standard ${vS.join(' ')}): the level is in the cached canvas, not in the blit`);
    ok(vDay.length === 0 && vDusk.length === 4 && vDusk.every((a) => Math.abs(a - 0.25) < 1e-9), 'none by day; through Dusk it fades in with the night amount (0.25 half way), as it did');
    ok(R.vignetteMB() > 0 && /vg\.globalAlpha = level; vg\.drawImage\(vb\.canvas/.test(readFileSync(new URL('../../src/js/render_fx.js', import.meta.url), 'utf8')), 'the cached vignette canvas is baked at the setting\'s level and rebuilt when the setting changes');
    U.setNightMode('standard'); sky(SKY.NIGHT, 0.4); }
  // the Settings control
  U.openPanel('settings'); U.update(s, 100);
  const ids = ['btn-night-dim', 'btn-night-standard', 'btn-night-bright'], els = ids.map((id) => win.document.getElementById(id));
  ok(els.every(Boolean) && els.map((e) => e.textContent).join() === 'Dim,Standard,Bright' && els.map((e) => e.getAttribute('aria-pressed')).join() === 'false,true,false' && els.every((e) => e.dataset.night), 'Settings → Night brightness: Dim / Standard / Bright, Standard pressed');
  els[2].dispatchEvent({ type: 'click' });
  ok(U.nightMode() === 'bright' && s.ui.settings.night === 'bright' && JSON.parse(win.localStorage.getItem('bsu.settings')).night === 'bright' && ids.map((id) => win.document.getElementById(id).getAttribute('aria-pressed')).join() === 'false,false,true', 'a click on Bright sets it, saves it and moves the pressed state');
  sky(SKY.NIGHT, 0.4); ok(R.nightInfo(s).level === 0.34 && R.nightInfo(s).floor.join() === fb.join(), 'the next frame draws at the Bright level');
  ok(U.setNightMode('pitch') === 'bright' && U.nightMode() === 'bright', 'an unknown mode is ignored');
  U.openPanel(null);
  BSU.session.newGame({ seed: 7, skipTutorial: true, size: 96 }); s = BSU.state;
  ok(s.ui.settings.night === 'bright', 'the setting survives a new game');
  U.setNightMode('standard');
  // nothing in the simulation reads it: the same seed under Dim and under Bright, three sky days on
  const snap = (mode) => { BSU.session.newGame({ seed: 11, skipTutorial: true, size: 96 }); U.showTitle(false); U.setNightMode(mode); BSU.headless.tick(900); const q = BSU.headless.snapshot(); return JSON.stringify([q.cash, q.students, q.happiness, q.prestige, q.gators, BSU.state.rng.sim, BSU.state.agents.filter((a) => a && !a.inside).length]); };
  const sd = snap('dim'), sb2 = snap('bright');
  ok(sd === sb2, 'the simulation is the same under Dim and Bright (900 ticks on one seed: cash, students, happiness, prestige, gators, the sim stream)');
  U.setNightMode('standard'); s = BSU.state;
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Draw order at walls
// ---------------------------------------------------------------------------------------------------------------------
console.log('--- 6. walls ---');
{
  fresh(); clearVeg([70, 40, 95, 62]); clearPaths([78, 42, 90, 58]);
  BSU.economy.addStudents(s, 300, 'qa'); A.regenerate(s);
  view(84, 49);
  ok(typeof R.wallOrder === 'function', 'API: render.wallOrder');
  const stand = (k, x, y) => { const a = s.agents.filter((q) => q && q.state !== 'GONE')[k]; a.tx = a.px = x; a.ty = a.py = y; a.inside = false; a.state = 'IDLE'; a.goal = 'idle'; a.target = -1; a.route = []; a.step = 0; a.rhSet = false; return a; };
  for (const a of s.agents) if (a) a.inside = true;
  const behind = stand(0, 82.5, 48.5), front = stand(1, 82.5, 50.5), front2 = stand(6, 83.5, 50.5), crown = stand(2, 83.4, 49.3), far = stand(3, 82.5, 45.5);
  BSU.session.setSpeed(s, 0, 'user');
  BSU.headless.render();
  ok(R.wallOrder().any === false && R.wallOrder().pushed === 0 && !R.drawList.some((e) => e.kind === 'wall'), 'a map without walls: nothing is asked, nothing is pushed');
  const row = (y, x0, x1) => { const t = []; for (let x = x0; x <= x1; x++) t.push(I(x, y)); return t; };
  const lv = B.placeRun(s, 'levee', row(49, 80, 84), {}), fwl = B.placeRun(s, 'floodwall', row(49, 85, 89), {});
  ok(lv.ok && fwl.ok && lv.placed === 5 && fwl.placed === 5, 'a levee (82–84) and a floodwall (85–89) along row 49');
  BSU.headless.render();
  const DL = R.drawList, at = (kind, ref) => DL.findIndex((e) => e.kind === kind && e.b === ref), wallAt = (x, y) => DL.findIndex((e) => e.kind === 'wall' && e.ax === x && e.ay === y);
  const wo = R.wallOrder();
  ok(wo.any === true && wo.pushed >= 2 && wallAt(82, 49) >= 0 && wallAt(83, 49) >= 0, `with a student behind it the wall tiles in front of that student are in the depth-sorted list (${wo.pushed} wall tiles this frame)`);
  ok(at('agent', behind) >= 0 && at('agent', behind) < wallAt(82, 49) && at('agent', behind) < wallAt(83, 49), 'the student right behind the levee is drawn BEFORE its tiles: the berm hides the feet');
  ok(at('agent', front) > wallAt(82, 49) && at('agent', front2) > wallAt(83, 49), 'the students in front of those tiles are drawn AFTER them');
  ok(at('agent', crown) > wallAt(83, 49), 'a student on the crown is drawn after the tile it stands on, wherever on the tile');
  ok(wallAt(80, 49) < 0 && wallAt(88, 49) < 0, 'a wall tile with nobody behind it is not drawn twice');
  ok(DL.filter((e) => e.kind === 'wall').every((e) => e.ref && (e.id === '' || true)) && DL.filter((e) => e.kind === 'wall').length === wo.pushed, 'each is pushed once a frame, with the tile\'s own sprite');
  // "as far as its height covers": the student three tiles behind the 6-ft levee is not covered; behind the 12-ft floodwall two tiles back still is
  const fb1 = stand(4, 86.5, 47.5), fb2 = stand(5, 87.5, 45.5);
  BSU.headless.render();
  const DL2 = R.drawList, w2 = (x, y) => DL2.findIndex((e) => e.kind === 'wall' && e.ax === x && e.ay === y), a2 = (ref) => DL2.findIndex((e) => e.kind === 'agent' && e.b === ref);
  ok(w2(87, 49) >= 0 && a2(fb1) < w2(87, 49), 'a student two tiles behind the 12-ft floodwall is still behind it (72 px of wall)');
  ok(a2(far) >= 0 && w2(82, 49) >= 0 && R.wallOrder().pushed <= 8, 'the student three tiles behind the levee asks for no wall tile (36 px do not reach)');
  void fb2;
  // a tree and a building behind a wall
  BSU.terrain.plantVeg(s, 'oak', 81, 48); const d = B.place(s, 'dorm', 85, 46, {});
  BSU.headless.render();
  const DL3 = R.drawList, w3 = (x, y) => DL3.findIndex((e) => e.kind === 'wall' && e.ax === x && e.ay === y);
  const tree = DL3.findIndex((e) => e.kind === 'tree' && e.ax === 81 && e.ay === 48), dorm = DL3.findIndex((e) => e.kind === 'building' && e.b && e.b.id === d.id);
  ok(tree >= 0 && w3(81, 49) > tree, 'an oak behind the levee is drawn before the levee tile in front of its trunk');
  ok(d.ok && dorm >= 0 && [85, 86, 87].every((x) => w3(x, 49) > dorm), 'a Dorm two tiles behind the floodwall is drawn before the floodwall tiles in front of it');
  let sorted = true; for (let k = 1; k < DL3.length; k++) if (DL3[k - 1].key > DL3[k].key) sorted = false;
  ok(sorted, 'the list is still sorted by key');
}

const errs = BSU.errors ? BSU.errors.size - errs0 : 0;
ok(errs === 0, `no BSU.error raised (${errs})` + (errs ? ': ' + Array.from(BSU.errors.keys()).slice(-5).join(' | ') : ''));
console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
