// Unit test for src/js/contract.js alone: loads it through makeWindow() from domstub.mjs
// with vm.runInContext and asserts the frozen surface of ARCHITECTURE.md §3.
// Usage: node test/contract.test.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from './domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// --- load ------------------------------------------------------------------
const src = readFileSync(join(here, '..', 'src', 'js', 'contract.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
const win = makeWindow();
const ctx = vm.createContext(win);
let threw = null;
try { vm.runInContext(src, ctx, { filename: 'contract.js' }); } catch (e) { threw = e; }
ok(!threw, 'contract.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
const BSU = win.BSU;
ok(BSU && typeof BSU === 'object', 'window.BSU exists');
eq(BSU.headlessMode, true, 'BSU.headlessMode is true under the stub');

// --- enums -----------------------------------------------------------------
for (const k of ['T', 'SURF', 'FLAG', 'SKY', 'OV', 'STORM', 'STORM_PHASE', 'OBJ', 'PLACE', 'SPR', 'B', 'EV', 'MAP']) {
  ok(BSU[k] && typeof BSU[k] === 'object' && Object.isFrozen(BSU[k]), `BSU.${k} present and frozen`);
}
eq(BSU.T.POND, 7, 'T.POND = 7');
eq(BSU.SURF.FENCE, 4, 'SURF.FENCE = 4');
eq(BSU.FLAG.JAMMED, 1 << 13, 'FLAG.JAMMED = bit 13');
eq(BSU.SKY_TICKS.reduce((a, b) => a + b, 0), 300, 'SKY_TICKS sum to 300');
eq(BSU.OV.ECOLOGY, 6, 'OV.ECOLOGY = 6');
eq(BSU.STORM.PASSED, 7, 'STORM.PASSED = 7');
eq(BSU.STORM_PHASE.CLEARING, 5, 'STORM_PHASE.CLEARING = 5');
eq(BSU.PLACE.UPGRADE, 15, 'PLACE.UPGRADE = 15');
eq(BSU.SPR.TIER_MASK, 3 << 5, 'SPR.TIER_MASK');
eq(BSU.B_ORDER.length, 43, '43 catalog ids in B_ORDER');
eq(Object.keys(BSU.B).length, 43, '43 keys in BSU.B');
eq(BSU.B.dorm, 'dorm', 'BSU.B.dorm === "dorm"');
eq(BSU.B_ORDER[7], 'founders_hall', 'row 8 is founders_hall');
eq(BSU.B_ORDER[42], 'rookery', 'row 43 is rookery');
eq(BSU.SAVE_VERSION, 1, 'SAVE_VERSION = 1');
eq(BSU.MAP.N, 4096, 'MAP.N = 4096');
eq(BSU.MILESTONES.length, 26, '26 milestone ids');
eq(BSU.OBJECTIVE_IDS.length, 25, '25 objective ids');
ok(Array.isArray(BSU.SAVE_SKIP) && BSU.SAVE_SKIP.includes('agents'), 'SAVE_SKIP lists agents');
eq(BSU.EV.TILE_CHANGED, 'tile:changed', 'EV.TILE_CHANGED');
eq(BSU.EV.AGENT_DESIRE_LINE, 'agent:desireLine', 'EV.AGENT_DESIRE_LINE');
eq(BSU.EV.ERROR, 'error', 'EV.ERROR');
eq(new Set(BSU.EV_LIST).size, BSU.EV_LIST.length, 'event names unique');
ok(BSU.EV_LIST.length >= 100, `event registry has ${BSU.EV_LIST.length} names (≥ 100)`);

// --- params ----------------------------------------------------------------
let leaves = 0, numeric = 0, badLeaf = null;
(function walk(o, path) {
  for (const k of Object.keys(o)) {
    const v = o[k], p = path + '.' + k;
    if (v && typeof v === 'object' && !Array.isArray(v)) { walk(v, p); continue; }
    leaves++;
    if (typeof v === 'number') { if (!Number.isFinite(v)) badLeaf = badLeaf || p; numeric++; continue; }
    if (typeof v === 'boolean' || typeof v === 'string') continue;
    if (Array.isArray(v)) {
      const allNum = v.every(x => typeof x === 'number' && Number.isFinite(x));
      const allStr = v.every(x => typeof x === 'string');
      const numPairs = v.every(x => Array.isArray(x) && x.every(y => typeof y === 'number' && Number.isFinite(y)));
      if (!(allNum || allStr || numPairs)) badLeaf = badLeaf || p;
      if (allNum) numeric += v.length;
      continue;
    }
    badLeaf = badLeaf || p;
  }
})(BSU.params, 'params');
ok(leaves >= 150, `params has ${leaves} leaves (≥ 150)`);
ok(numeric >= 150, `params has ${numeric} numeric values (≥ 150)`);
ok(!badLeaf, 'every params leaf is a finite number, boolean, string or homogeneous array' + (badLeaf ? ' — bad: ' + badLeaf : ''));
for (const g of ['time', 'terrain', 'hydro', 'storm', 'wildlife', 'subsidence', 'heat', 'weather', 'econ', 'sports', 'agents', 'build', 'render', 'audio', 'palette', 'progress']) {
  ok(BSU.params[g] && typeof BSU.params[g] === 'object', `params.${g} group present`);
}
eq(BSU.params.time.ticksPerDay, 100, 'time.ticksPerDay = 100');
eq(BSU.params.econ.startCash, 4000000, 'econ.startCash');
eq(BSU.params.storm.surge[3], 8, 'storm.surge[Cat 3] = 8 ft');
eq(BSU.params.hydro.k, 0.35, 'hydro.k');
eq(BSU.params.palette.purple, '#461D7C', 'palette.purple');
ok(Object.keys(BSU.params.econ.timers).length === 22 && BSU.HAPPINESS_TIMERS.every(id => id in BSU.params.econ.timers), 'all 22 §5.6 timers have params');
// PLAN_FOOTBALL pass A: params.sports.engine groundwork (consumed by the pass B/C engine)
{
  const E = BSU.params.sports.engine, sum = o => Object.values(o).reduce((a, b) => a + b, 0), near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(E && E.positions.join() === 'QB,RB,WR,OL,DL,LB,DB,K', 'sports.engine.positions lists the eight rated starters');
  ok(['offRun', 'offPass', 'defRun', 'defPass'].every(k => near(sum(E.composite[k]), 1) && Object.keys(E.composite[k]).every(p => E.positions.includes(p))), 'sports.engine.composite weights sum to 1 over real positions');
  ok(['ground', 'balanced', 'air'].every(k => near(E.playbook[k].runShare + E.playbook[k].passShare, 1)) && E.playbook.ground.runShare > E.playbook.balanced.runShare && E.playbook.balanced.runShare > E.playbook.air.runShare, 'sports.engine.playbook run/pass shares sum to 1 and order ground > balanced > air');
  ok(['conservative', 'normal', 'aggressive'].every(k => E.aggression[k]) && E.aggression.aggressive.goDist > E.aggression.normal.goDist && E.aggression.normal.goDist > E.aggression.conservative.goDist, 'sports.engine.aggression levels ordered');
  ok(E.homeField.day.length === 4 && E.homeField.night.length === 4 && E.homeField.oppPenalty.length === 4 && E.homeField.night[2] === BSU.params.sports.homeNight && E.homeField.day[0] === BSU.params.sports.homeDay && E.homeField.oppPenalty[3] === BSU.params.sports.stadium3Opp, 'sports.engine.homeField tiers mirror homeDay/homeNight/stadium3Opp');
  ok(E.spring.unlockStudents === 200 && E.spring.offsetDays === 3 && E.spring.ticks === 300 && BSU.SET_PIECES.spring === E.spring.ticks, 'spring game: unlock 200 students, +3 days, SET_PIECES.spring 300');
  // pass C: the catalog row and objective 15 mirror the spring unlock; the spring tick table fits the 300-tick set piece
  ok(BSU.params.progress.goals.students15 === E.spring.unlockStudents && (!BSU.data || (BSU.data.catalog.practice_field.unlock.students === E.spring.unlockStudents && BSU.data.catalog.practice_field.tiers[0].unlock.students === 400)), 'objective 15 unlocks at 200 students (= spring.unlockStudents; the catalog row mirrors it when data.js is loaded)');
  ok(E.spring.kickoffTick + 2 * E.spring.halfTicks < E.spring.exitTick && E.spring.exitTick <= E.spring.ticks && E.spring.slots % 4 === 0 && (E.spring.slots / 2) * E.spring.slotTicks <= E.spring.halfTicks && BSU.dateToDay(E.spring.date, 2) >= 0, 'spring tick table: kickoff → two halves → final → exit inside 300 ticks; the later-year date parses');
  ok(BSU.EV_LIST.indexOf('game:spring') >= 0 && BSU.EV.GAME_SPRING === 'game:spring' && BSU.newState(1).progress.setPiecesSeen.spring === false && BSU.newState(1).sports.springDay === -1 && BSU.newState(1).sports.prospects === null, 'game:spring registered; newState carries setPiecesSeen.spring, sports.springDay/prospects');
  ok(E.recruit.boardSizes.length === 3 && E.recruit.qualityBase > 0 && E.recruit.costRound > 0 && E.records.seasonsMax >= E.records.seasonsKept, 'recruit quality/cost params and the records.seasons cap');
  ok(E.highlights.slots === 24 && E.highlights.firstSlotTick + E.highlights.slots * E.highlights.slotTicks <= BSU.params.sports.finalTick, 'highlights slots fit between kickoff and the final whistle');
  ok(E.recruit.boardSizes.length === 3 && E.recruit.boardCoachingTiers.length === 2 && E.recruit.costMin < E.recruit.costMax && E.tickets.tiers.join() === Object.keys(BSU.params.sports.tickets).join() && E.bowl.minWins === BSU.params.sports.bowlWins, 'recruit board, ticket tiers and bowl eligibility mirror the existing params');
  ok(E.clock.quarterSec === 900 && E.clock.quarters === 4 && E.montage.montageTicks === 60, 'clock quarters 15:00 x 4; montage 60 ticks');
}

// --- newState --------------------------------------------------------------
const st = BSU.newState(42);
eq(st.seed, 42, 'newState(42).seed');
eq(st.v, 1, 'state.v = 1');
const tileSpec = {
  elev: win.Float32Array, depth: win.Float32Array, sat: win.Float32Array, stand: win.Uint8Array, mosq: win.Float32Array, subs: win.Float32Array,
  crest: win.Uint8Array, integrity: win.Uint8Array, sandbag: win.Uint8Array, sandbagDay: win.Uint16Array, wear: win.Uint8Array,
  flags: win.Uint16Array, surface: win.Uint8Array, owner: win.Int16Array, type: win.Uint8Array, walk: win.Uint8Array
};
for (const [k, Ctor] of Object.entries(tileSpec)) {
  const a = st.tiles[k];
  ok(a instanceof Ctor && a.length === 4096, `tiles.${k} is ${Ctor.name}[4096]`);
}
eq(Object.keys(st.tiles).length, 16, 'exactly 16 tile arrays');
eq(st.tiles.owner[4095], -1, 'tiles.owner initialised to −1');
for (const k of ['calendar', 'sky', 'weather', 'storms', 'tiles', 'plot', 'veg', 'buildings', 'runNames', 'hydro', 'agents', 'vehicles', 'gators', 'wildlife', 'economy', 'ledger', 'sports', 'progress', 'ticker', 'ui', 'rng', 'saveMeta']) {
  ok(k in st, `state.${k} present`);
}
eq(st.economy.cash, 4000000, 'economy.cash = $4M');
eq(st.economy.prestige, 10, 'economy.prestige = 10');
eq(st.economy.happiness, 60, 'economy.happiness = 60');
eq(st.economy.tuition, 6500, 'economy.tuition = 6500');
eq(st.rng.sim, (42 ^ 0x9E3779B9) >>> 0, 'state.rng.sim = seed ^ 0x9E3779B9');
eq(st.calendar.season, 'winter', 'Jan 1 is winter');
eq(st.calendar.semester, 'break', 'Jan 1 is break');
eq(st.plot.bank0, 58, 'plot.bank0 = bank(7) = 58');
eq(st.plot.founders.tx, 51, 'plot.founders.tx = bank0 − 7');
eq(Object.keys(st.progress.milestones).length, 26, 'progress.milestones pre-keyed');
eq(Object.keys(st.progress.objectives).length, 25, 'progress.objectives pre-keyed');
ok(st.hydro.networks === null && st.wildlife.campusMask === null, 'non-saved caches start null');
// plain data: JSON-able apart from typed arrays
let jsonOk = true;
try { JSON.stringify(st, (k, v) => (v && v.buffer instanceof ArrayBuffer) ? '<typed>' : v); } catch (e) { jsonOk = false; }
ok(jsonOk, 'state tree is JSON-able (typed arrays aside)');
ok(BSU.newState(42) !== st, 'newState allocates a fresh tree each call');
ok(BSU.newState(42).tiles.elev !== st.tiles.elev, 'newState allocates fresh typed arrays');

// --- rng -------------------------------------------------------------------
const a = BSU.rng.make(7), b = BSU.rng.make(7);
let same = true;
for (let i = 0; i < 100; i++) if (a.next() !== b.next()) same = false;
ok(same, 'rng.make(seed) is deterministic');
const c = BSU.rng.make(7);
const saved = c.state; const v1 = c.float(); c.state = saved;
eq(c.float(), v1, 'rng state save/restore');
const d = BSU.rng.make(123);
let inRange = true;
for (let i = 0; i < 1000; i++) { const f = d.float(); if (f < 0 || f >= 1) inRange = false; const n = d.int(10); if (n < 0 || n > 9) inRange = false; }
ok(inRange, 'rng.float ∈ [0,1), rng.int(n) ∈ [0,n)');
ok(typeof d.gauss() === 'number' && d.chance(1) === true && d.chance(0) === false && d.pick([5]) === 5, 'rng gauss/chance/pick');
ok(BSU.rng.make(1).next() !== BSU.rng.make(2).next(), 'different seeds differ');
ok(BSU.rng.hash(1, 2) !== BSU.rng.hash(2, 1) && BSU.rng.hash(1, 2) === BSU.rng.hash(1, 2), 'rng.hash mixes and is stable');
ok(typeof BSU.rng.derive('agents', 3).next === 'function', 'rng.derive returns a stream');
ok(BSU.rng.world && BSU.rng.sim && BSU.rng.fx, 'named streams world/sim/fx exist');

// --- events ----------------------------------------------------------------
const E = BSU.events;
const got = [];
const h1 = E.on('tile:changed', (p) => got.push('a' + p.i), 'test');
E.on('tile:changed', () => { throw new Error('boom'); }, 'test');
E.on('tile:changed', (p) => got.push('c' + p.i), 'test');
const errs = [];
E.on('error', (p) => errs.push(p), 'test');
const origErr = console.error; let logged = 0; console.error = () => { logged++; };
E.emit('tile:changed', { i: 1 });
E.emit('tile:changed', { i: 2 });
console.error = origErr;
eq(got.join(','), 'a1,c1,a2,c2', 'listeners run in order and a throwing listener does not break the others');
eq(errs.length, 2, 'error event emitted per listener failure');
eq(errs[0].first, true, 'first failure flagged first:true');
eq(errs[1].first, false, 'repeat failure flagged first:false');
eq(logged, 1, 'console.error once per signature');
E.off('tile:changed', h1);
E.emit('tile:changed', { i: 3 });
eq(got.join(','), 'a1,c1,a2,c2,c3', 'off removes a listener');
let onceN = 0;
E.once('calendar:day', () => onceN++, 'test');
E.emit('calendar:day', { day: 1 }); E.emit('calendar:day', { day: 2 });
eq(onceN, 1, 'once fires once');
E.clear('test');
E.emit('tile:changed', { i: 4 });
eq(got.length, 5, 'clear(owner) removes every listener of that owner');
const origWarn = console.warn; let warned = 0; console.warn = () => { warned++; };
E.emit('not:registered', {}); E.emit('not:registered', {});
console.warn = origWarn;
eq(warned, 1, 'unregistered event warns once at runtime');
BSU.SELFTEST = true;
let selfThrew = false;
try { E.emit('not:registered', {}); } catch (e) { selfThrew = true; }
BSU.SELFTEST = false;
ok(selfThrew, 'unregistered event throws under BSU.SELFTEST');

// --- helpers ---------------------------------------------------------------
eq(BSU.idx(3, 5), 323, 'idx');
eq(BSU.tx(323), 3, 'tx'); eq(BSU.ty(323), 5, 'ty');
ok(BSU.inBounds(0, 0) && BSU.inBounds(63, 63) && !BSU.inBounds(64, 0) && !BSU.inBounds(0, -1), 'inBounds');
eq(BSU.nbr4(BSU.idx(10, 10)).join(','), [BSU.idx(10, 9), BSU.idx(11, 10), BSU.idx(10, 11), BSU.idx(9, 10)].join(','), 'nbr4 order N,E,S,W');
eq(BSU.nbr4(0).length, 2, 'nbr4 corner has 2');
eq(BSU.nbr8(0).length, 3, 'nbr8 corner has 3');
eq(BSU.nbr8(BSU.idx(10, 10)).length, 8, 'nbr8 interior has 8');
eq(BSU.chebyshev(0, 0, 3, -5), 5, 'chebyshev'); eq(BSU.manhattan(0, 0, 3, -5), 8, 'manhattan');
eq(BSU.footprintTiles(1, 1, 2, 2).join(','), [65, 66, 129, 130].join(','), 'footprintTiles row-major');
eq(BSU.footprintTiles(63, 63, 2, 1), null, 'footprintTiles out of bounds → null');
eq(BSU.edgeTiles(1, 1, 2, 2).length, 8, 'edgeTiles ring of 2×2 = 8');
eq(BSU.edgeTiles(0, 0, 2, 2).length, 4, 'edgeTiles clipped at the corner');
eq(BSU.clamp(5, 0, 3), 3, 'clamp'); eq(BSU.lerp(0, 10, 0.25), 2.5, 'lerp'); eq(BSU.smoothstep(0.5), 0.5, 'smoothstep');
eq(BSU.formatMoney(4120000), '$4.12M', 'formatMoney 4.12M');
eq(BSU.formatMoney(340000), '$340k', 'formatMoney 340k');
eq(BSU.formatMoney(2000), '$2,000', 'formatMoney 2,000');
eq(BSU.formatMoney(-1400000), '−$1.4M', 'formatMoney −1.4M');
eq(BSU.formatMoney(32000000), '$32M', 'formatMoney 32M');
eq(BSU.formatMoney(0), '$0', 'formatMoney 0');
eq(BSU.formatDate(0), 'Jan 1, Y1', 'formatDate day 0');
eq(BSU.formatDate(122), 'Jan 3, Y2', 'formatDate day 122');
eq(BSU.dateToDay('Aug 5', 1), 74, 'dateToDay Aug 5 Y1');
eq(BSU.dateToDay('Sep 8', 1), 87, 'dateToDay Sep 8 Y1');
eq(BSU.dateToDay('Jan 1', 2), 120, 'dateToDay Jan 1 Y2');
ok(Number.isNaN(BSU.dateToDay('Foo 3', 1)), 'dateToDay rejects garbage');
eq(BSU.monthName(12), 'Dec', 'monthName');
eq(BSU.dayParts(74).semester, 'fall', 'Aug 5 is fall semester');
eq(BSU.dayParts(44).semester, 'spring', 'May 5 is spring semester');
eq(BSU.dayParts(45).semester, 'summer', 'May 6 is summer');
eq(BSU.dayParts(110).semester, 'break', 'Dec 11 is break');
eq(BSU.dayParts(90).season, 'fall', 'Oct is fall');
eq(BSU.strHash('a'), BSU.strHash('a'), 'strHash stable'); ok(BSU.strHash('a') !== BSU.strHash('b'), 'strHash differs');

// iso projection round trip
const cam = { x: 700, y: 500, zoom: 1 };
const elevAt = (tx, ty) => ((tx * 7 + ty * 13) % 5) * 0.3;
let rt = 0;
const r = BSU.rng.make(5);
for (let k = 0; k < 200; k++) {
  const tx = r.int(64), ty = r.int(64);
  cam.zoom = [0.5, 1, 2][r.int(3)];
  cam.x = r.range(-2000, 2000); cam.y = r.range(-80, 2000);
  const s = BSU.worldToScreen(tx, ty, elevAt(tx, ty), cam, 1280, 800);
  const w = BSU.screenToWorld(s.x, s.y, cam, 1280, 800, elevAt);
  if (w && w.tx === tx && w.ty === ty) rt++;
}
eq(rt, 200, 'worldToScreen → screenToWorld round-trips 200 random tiles at 3 zooms');
const s0 = BSU.worldToScreen(0, 0, 0, { x: 0, y: 0, zoom: 1 }, 1280, 800);
ok(s0.x === 640 && s0.y === 400, 'tile (0,0) at cam origin is the viewport center');
const s1 = BSU.worldToScreen(1, 0, 2, { x: 0, y: 0, zoom: 1 }, 1280, 800);
ok(s1.x === 672 && s1.y === 400 + 16 - 12, 'projection: +32 px per tx, +16 px per (tx+ty), −6 px per ft');
const dm = BSU.tileDiamond(0, 0, 0);
ok(dm.y0 === -16 && dm.x1 === 32 && dm.y2 === 16 && dm.x3 === -32, 'tileDiamond corners');
ok(BSU.screenToWorld(-99999, -99999, { x: 0, y: 0, zoom: 1 }, 1280, 800, elevAt) === null, 'screenToWorld off-map → null');

// base64 round trip of a Float32Array (bit exact) and other ctors
const f = new win.Float32Array([0.5, -1.25, 3.75, 1e-7, 12345.678, NaN === NaN ? 0 : 99, -0]);
const enc = BSU.b64.encode(f);
ok(typeof enc === 'string' && /^[A-Za-z0-9+/=]+$/.test(enc), 'b64.encode returns base64');
const dec = BSU.b64.decode(enc, win.Float32Array);
ok(dec instanceof win.Float32Array && dec.length === f.length, 'b64.decode returns Float32Array of the same length');
let bitExact = true;
{ const A = new Uint8Array(f.buffer), B = new Uint8Array(dec.buffer, dec.byteOffset, dec.byteLength); for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) bitExact = false; }
ok(bitExact, 'b64 Float32Array round-trip is bit exact');
for (const [Ctor, len] of [[win.Uint8Array, 5], [win.Uint16Array, 7], [win.Int16Array, 3], [win.Float32Array, 4096]]) {
  const src = new Ctor(len); for (let i = 0; i < len; i++) src[i] = (i * 37 - 40) % 100;
  const back = BSU.b64.decode(BSU.b64.encode(src), Ctor);
  ok(back.length === len && back.every((v, i) => v === src[i]), `b64 round-trips ${Ctor.name}[${len}]`);
}
{
  const sub = new win.Float32Array([9, 8, 7, 6]).subarray(1, 3);
  const back = BSU.b64.decode(BSU.b64.encode(sub), win.Float32Array);
  ok(back.length === 2 && back[0] === 8 && back[1] === 7, 'b64 honours byteOffset of subarrays');
}

// deepClone
const clone = BSU.deepClone(st);
ok(clone !== st && clone.tiles.elev !== st.tiles.elev && clone.tiles.elev instanceof win.Float32Array && clone.economy.cash === 4000000, 'deepClone copies typed arrays and values');

// error policy
const e0 = BSU.errors.size;
const oe = console.error; console.error = () => {};
BSU.error('mod', 'where', new Error('x')); BSU.error('mod', 'where', new Error('x'));
console.error = oe;
eq(BSU.errors.get('mod|where|x'), 2, 'BSU.error counts per signature');
ok(BSU.errors.size === e0 + 1, 'one new signature');
BSU.SELFTEST = true; let at = false; try { BSU.assert(false, 'nope'); } catch (e) { at = true; } BSU.SELFTEST = false;
ok(at, 'assert throws under SELFTEST');

// catalog row schema
ok(BSU.catalogRowSchema && Object.isFrozen(BSU.catalogRowSchema) && BSU.catalogRowSchema.row && BSU.catalogRowSchema.effects, 'catalogRowSchema present');
const effects = {};
for (const k of Object.keys(BSU.catalogRowSchema.effects)) {
  const t = BSU.catalogRowSchema.effects[k];
  effects[k] = t === 'number' || t === 'int' ? 0 : t === 'boolean' ? false : t === 'string' ? '' : t.startsWith('array') ? [] : null;
}
effects.happiness = { value: 0, radius: 0 }; effects.noise = { value: 0, radius: 0 };
effects.power = { radius: 0, capacity: 0 }; effects.water = { radius: 0, capacity: 0 };
effects.mosquito = { mult: 0, radius: 0, stacksTo: 0 }; effects.heat = { mult: 0, radius: 0 }; effects.windShield = { mult: 0, radius: 0 };
effects.research = { kind: '', base: 0 }; effects.illness = { mosquito: 0, heat: 0, radius: 0 };
const row = {
  id: 'dorm', n: 13, name: 'Freshman Dorm', tab: 'housing', essentials: true, kind: 'footprint', w: 3, h: 2, rotatable: true,
  cost: 700000, upkeep: 9000, wr: 3, needsPower: true, needsWater: true, pathAdjacency: true, roadWithin: 0, placeRule: BSU.PLACE.LAND,
  allowMarsh: true, alwaysPilings: false, buildDays: 2, unlock: {}, pip: '', effects, tiers: [],
  paint: { wall: ['#F5ECD7', '#E8D9B5'], roof: 'hip', roofColor: '#B5533C', floors: 4, windows: { cols: 6, rows: 4 }, decals: ['arcade'], accent: '#461D7C', lift: 0, special: '' },
  namePool: 'halls', why: 'why', blurb: 'A sample building.', desc: 'desc', demolishable: true, shelterOwn: true
};
const vr = BSU.validateCatalogRow(row);
ok(vr.ok, 'a well-formed catalog row validates' + (vr.ok ? '' : ': ' + vr.errors.join('; ')));
ok(!BSU.validateCatalogRow({ ...row, n: 12 }).ok, 'wrong row number rejected');
ok(!BSU.validateCatalogRow({ ...row, tab: 'nope' }).ok, 'bad enum rejected');
ok(!BSU.validateCatalogRow({ ...row, extra: 1 }).ok, 'unexpected key rejected');
ok(!BSU.validateCatalogRow({ ...row, effects: { ...effects, seats: 'x' } }).ok, 'bad nested type rejected');

// module selfTest
const stRes = BSU.contract.selfTest();
ok(stRes && stRes.ok === true, 'BSU.contract.selfTest() passes' + (stRes && stRes.ok ? ' — ' + stRes.notes : ': ' + (stRes && stRes.notes)));

// no DOM touched at load: the stub's #app must still be the only element in body
eq(win.document.body.children.length, 1, 'contract.js created no DOM nodes');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
