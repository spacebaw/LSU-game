// Unit test for src/js/wildlife.js: loads contract.js, data.js and any earlier manifest modules that
// exist through makeWindow() from test/domstub.mjs with vm.runInContext, stubs the sim modules that
// are not written yet, runs BSU.wildlife.selfTest() and the scenario checks from
// docs/briefs/wildlife.md §9 "Done means". Usage: node test/unit/wildlife.test.mjs (exit 1 on failure).
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

// --- source hygiene --------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'wildlife.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src), "file starts with 'use strict'");
ok(!/\b(setTimeout|setInterval|requestAnimationFrame|AudioContext|document\.)/.test(src), 'no timers / DOM / audio references');

// --- load ------------------------------------------------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
const upTo = manifest.slice(0, manifest.indexOf('wildlife.js'));
for (const f of upTo) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f });
}
// Stubs for the modules wildlife reads (only when the real module is absent), per the brief §7.
vm.runInContext(`
  BSU.terrain = BSU.terrain || { isDisturbedMarsh(){ return false; }, paradeRoute(){ return []; }, touch(){} };
  BSU.hydro = BSU.hydro || { isMud(){ return false; }, networks(){ return []; } };
  BSU.buildings = BSU.buildings || { list(s,t){ return (s.buildings||[]).filter(b => b && (!t || b.type === t)); }, get(s,id){ return (s.buildings||[])[id] || null; },
    footprint(s,id){ const b = (s.buildings||[])[id]; return b ? BSU.footprintTiles(b.tx,b.ty,b.w,b.h) : []; }, count(s,t){ return this.list(s,t).length; }, has(s,t){ return this.list(s,t).length > 0; },
    effective(){ return 1; }, dumpsterTile(){ return -1; }, stats(){ return { oaks:0, cypress:0, stockedPonds:0, posts:0 }; }, onIntegrityChanged(){ BSU.__integrityCalls = (BSU.__integrityCalls||0) + 1; } };
  BSU.agents = BSU.agents || { list(){ return []; } };
  BSU.weather = BSU.weather || { heat(){ return { index: 80, advisory: false, wave: false }; }, storm(s){ return s.storms.current; } };
  BSU.progress = BSU.progress || { timers(){ return []; }, timer(){ return null; }, ticker(s, line){ BSU.__ticker = (BSU.__ticker||[]).concat([line]); } };
  BSU.economy = BSU.economy || { bump(s, stat, d){ BSU.__bumps = (BSU.__bumps||[]).concat([[stat, d]]); } };
`, ctx);
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'wildlife.js' }); } catch (e) { threw = e; }
ok(!threw, 'wildlife.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(performance.now() - t0 < 50, 'definition time < 50 ms');
const BSU = win.BSU;
const M = BSU.wildlife;
ok(M && typeof M === 'object', 'BSU.wildlife exists');
for (const k of ['init', 'reset', 'tick', 'selfTest', 'gators', 'mosqAt', 'mosqIndex', 'ecology', 'ecologyTerms', 'onCampus', 'campusMask', 'spawnGator', 'forceFirstGator', 'relocate', 'sickToday', 'fireflyTarget', 'birds', 'nutriaTraps', 'gatorGridPassable', 'forceMosquito', 'forceEcology', 'gatorPenalty', 'photographLeGrand', 'officers', 'wetlandLost', 'applyEcologyOnce', 'critters', 'roux'])
  ok(typeof M[k] === 'function', 'BSU.wildlife.' + k + ' is a function');
ok(!('relocations' in M) && !('leGrand' in M) && !('sick' in M) && !('beadsDay' in M), 'no state mirrored on the module object (D46)');

// --- selfTest --------------------------------------------------------------
BSU.SELFTEST = true;
let st;
const t1 = performance.now();
try { st = M.selfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t1;
ok(st && st.ok === true, 'selfTest().ok === true — ' + (st && st.notes));
ok(stMs < 200, `selfTest ran in ${stMs.toFixed(1)} ms < 200 ms`);
ok((BSU.errors ? BSU.errors.size : 0) === 0, 'BSU.errors is empty after selfTest');

// --- scenario helpers (the brief §7 isolation map) ---------------------------
const N = 4096, W = 64, T = BSU.T, FLAG = BSU.FLAG, SKY = BSU.SKY;
function synthetic(seed) {
  const s = BSU.newState(seed);
  for (let i = 0; i < N; i++) { s.tiles.type[i] = T.MARSH; s.tiles.elev[i] = 1; s.tiles.flags[i] = FLAG.WETLAND_ORIGINAL; s.tiles.depth[i] = 0.25; s.tiles.walk[i] = 3; }
  for (let y = 0; y < 64; y++) { const i = y * 64 + 32; s.tiles.type[i] = T.BAYOU; s.tiles.flags[i] = FLAG.BAYOU; s.tiles.elev[i] = -1; s.tiles.depth[i] = 1; s.tiles.walk[i] = 0; }
  for (let y = 10; y < 15; y++) for (let x = 10; x < 15; x++) { const i = y * 64 + x; s.tiles.type[i] = T.DRY; s.tiles.elev[i] = 4; s.tiles.flags[i] = 0; s.tiles.depth[i] = 0; s.tiles.stand[i] = 3; s.tiles.walk[i] = 2; }
  s.economy.students = 500;
  return s;
}
function building(s, type, tx, ty, w, h) {
  const id = s.buildings.length;
  const b = { id, type, tx, ty, w, h, rot: 0, name: type, hp: 1, built: 1, builtDay: 0, pilings: false, sunk: 0, powered: true, watered: true, provider: { power: -1, water: -1 }, flooded: false, floodedSince: -1, closedUntil: -1, blackout: false, tier: 0, upgradeDoneDay: -1, ruin: false, tarp: false,
    data: { fuelDays: 0, stockedDay: -1, active: true, policies: { gatorProofDumpsters: false, nutriaBounty: false }, boardedUntil: -1, regradeUntil: -1, dumpsterTile: -1, seed: id } };
  s.buildings.push(b);
  for (const i of BSU.footprintTiles(tx, ty, w, h)) { s.tiles.owner[i] = id; s.tiles.walk[i] = 0; }
  BSU.events.emit(BSU.EV.BUILDING_PLACED, { id, type, tx, ty, w, h, cost: 0, pilings: false });
  return b;
}
// the 300-tick sky cycle of BSU.SKY_TICKS, driven by the test in place of weather.tick
function skyAt(tick) { let c = tick % 300, p = 0; while (c >= BSU.SKY_TICKS[p]) { c -= BSU.SKY_TICKS[p]; p++; } return p; }
function run(s, ticks, onTick) {
  for (let k = 0; k < ticks; k++) {
    s.sky.phase = skyAt(s.tick);
    const newDay = s.tick > 0 && s.tick % 100 === 0;
    if (newDay) { s.calendar.day++; Object.assign(s.calendar, BSU.dayParts(s.calendar.day)); }
    const flags = { newDay, newMonth: newDay && s.calendar.dom === 1, newYear: newDay && s.calendar.day % 120 === 0, day: s.calendar.day };
    if (onTick) onTick(s, flags);
    M.tick(s, flags);
    s.rng.sim = BSU.rng.sim.state;
    s.tick++;
  }
}
function scanNumbers(obj, path = 'state', seen = new Set(), depth = 0) {
  if (obj == null || depth > 12) return null;
  if (typeof obj === 'number') return Number.isFinite(obj) ? null : path;
  if (typeof obj !== 'object') return null;
  if (seen.has(obj)) return null; seen.add(obj);
  if (ArrayBuffer.isView(obj)) { for (let i = 0; i < obj.length; i++) if (!Number.isFinite(obj[i])) return `${path}[${i}]`; return null; }
  if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) { const r = scanNumbers(obj[i], `${path}[${i}]`, seen, depth + 1); if (r) return r; } return null; }
  for (const k of Object.keys(obj)) { const r = scanNumbers(obj[k], `${path}.${k}`, seen, depth + 1); if (r) return r; }
  return null;
}
const events = [];
for (const name of ['gator:spawn', 'gator:campus', 'gator:incident', 'gator:relocated', 'mosquito:warning', 'ecology:changed', 'levee:burrow']) BSU.events.on(name, (p) => events.push({ name, p }), 'test');

// --- scenario 1: fresh game spawns ≥ 6 gators at dens; ecology from a synthetic marsh map -------
const s = synthetic(11);
BSU.rng.sim.state = s.rng.sim;
M.init(s);
M.reset(s, true);
ok(s.gators.length >= 6, `fresh reset spawned ${s.gators.length} gators (≥ 6)`);
ok(events.filter(e => e.name === 'gator:spawn').length === s.gators.length, 'one gator:spawn per gator on the live bus');
ok(s.gators.every(g => s.tiles.type[Math.floor(g.ty) * W + Math.floor(g.tx)] === T.BAYOU), 'every gator starts at a den (Bayou)');
ok(s.wildlife.wetlandOriginal === 4096 - 64 - 25, 'wetlandOriginal counted the original marsh');
ok(Math.abs(s.wildlife.ecology - 70) < 1e-6, `ecology 70 on an untouched marsh map (${s.wildlife.ecology})`);
ok(s.wildlife.leGrandDay >= BSU.dateToDay('Apr 1', 1) && s.wildlife.leGrandDay <= BSU.dateToDay('Apr 10', 1), 'Le Grand day drawn in April');
ok(typeof s.wildlife.sick === 'number' && s.wildlife.beadsDay === -1 && typeof s.wildlife.burrowLog === 'object', 'lazily initialized keys present');

// --- scenario 2: 3,000 ticks — gators move between SUN/SWIM/WANDER, mosquitoes rise on the block ----
const seenStates = new Set();
run(s, 3000, (st) => { for (const g of st.gators) seenStates.add(g.state); });
ok(seenStates.has('SUN') && seenStates.has('SWIM') && seenStates.has('WANDER'), 'gators visited SUN, SWIM and WANDER over 3,000 ticks (' + [...seenStates].join(',') + ')');
ok(s.gators.every(g => Number.isFinite(g.tx) && Number.isFinite(g.ty) && g.tx >= 0 && g.tx < 64 && g.ty >= 0 && g.ty < 64), 'gator positions finite and in bounds');
const blockV = s.tiles.mosq[12 * 64 + 12], marshV = s.tiles.mosq[40 * 64 + 5];
ok(blockV > 0.5, `mosquitoes rose on the standing-water block (${blockV.toFixed(3)} > .5)`);
ok(marshV < 0.05, `undisturbed marsh stays ~.02 or below (${marshV.toFixed(3)})`);
ok(s.tiles.mosq[20 * 64 + 32] === 0, 'water tiles hold 0');
ok(!scanNumbers(s), 'no NaN/Infinity in the state after 3,000 ticks: ' + scanNumbers(s));
ok(s.wildlife.mosqIndex === 0, 'mosqIndex is 0 with no agents (no warning can fire)');
ok(!events.some(e => e.name === 'mosquito:warning'), 'no mosquito:warning without agents');

// --- scenario 3: forceFirstGator walks to the Dining Hall dumpster and logs a campus incident -------
const s3 = synthetic(12);
BSU.rng.sim.state = s3.rng.sim;
M.reset(s3, true);
building(s3, 'dining_hall', 36, 20, 3, 2);
events.length = 0;
M.forceFirstGator(s3);
const walker = s3.gators.find(g => g.state === 'WANDER');
ok(!!walker && walker.target === BSU.idx(39, 21), 'forceFirstGator picked the dumpster tile (39,21) as the target');
let arrivedTick = -1;
run(s3, 1500, (st) => { if (arrivedTick < 0 && walker.state === 'LOUNGE') arrivedTick = st.tick; });
ok(arrivedTick > 0, `the gator reached the dumpster and lounged (tick ${arrivedTick})`);
ok(events.some(e => e.name === 'gator:campus' && e.p.id === walker.id && e.p.enter === true), 'gator:campus{enter:true} emitted');
ok(events.some(e => e.name === 'gator:incident' && e.p.id === walker.id && e.p.kind === 'dumpster'), 'gator:incident{kind:"dumpster"} emitted');
ok(M.onCampus(s3).length >= 1 || walker.state !== 'LOUNGE', 'onCampus() lists the lounging gator');
ok(M.gatorPenalty(s3) >= 3, 'gatorPenalty ≥ 3 after one incident');

// --- scenario 4: storm:watch sends every gator to the water; storm:passed schedules the wave ------
const s4 = synthetic(13);
BSU.rng.sim.state = s4.rng.sim;
M.reset(s4, true);
building(s4, 'dining_hall', 36, 20, 3, 2);
run(s4, 600);
BSU.events.emit(BSU.EV.STORM_WATCH, { name: 'Test', cat: 2, forecastCat: 2, nearMiss: false, landfallDay: 10, point: 4000 });
run(s4, 1200);
ok(s4.gators.every(g => s4.tiles.type[Math.floor(g.ty) * W + Math.floor(g.tx)] === T.BAYOU && (g.state === 'SUN' || g.state === 'RETREAT')), 'after storm:watch every gator is in the water at its den');
const before = s4.gators.length;
s4.storms.lastLandfallDay = s4.calendar.day;
for (let i = 0; i < N; i++) if (s4.tiles.type[i] !== T.BAYOU) s4.tiles.depth[i] = 0.6;   // the surge left the campus flooded
BSU.events.emit(BSU.EV.STORM_PASSED, { name: 'Test', cat: 2, forecastCat: 2, nearMiss: false, landfallDay: s4.calendar.day, point: 4000 });
run(s4, 400);
ok(s4.gators.length >= before + 3 && s4.gators.length <= before + 8, `post-storm wave spawned ${s4.gators.length - before} extra gators (3–8)`);
ok(!scanNumbers(s4), 'no NaN/Infinity after the storm scenario');

// --- scenario 5: nutria burrow a levee near marsh; traps within 14 of a post; ecology terms --------
const s5 = synthetic(14);
BSU.rng.sim.state = s5.rng.sim;
M.reset(s5, true);
for (let x = 20; x < 30; x++) { const i = 30 * 64 + x; s5.tiles.crest[i] = 6; s5.tiles.integrity[i] = 100; }
s5.wildlife.nutria = 0;
events.length = 0;
BSU.__integrityCalls = 0;
M.tick(s5, { newDay: true, newMonth: true, newYear: false, day: s5.calendar.day });
for (let k = 0; k < 20 && !events.some(e => e.name === 'levee:burrow'); k++) M.tick(s5, { newDay: true, newMonth: true, newYear: false, day: s5.calendar.day });
const burrows = events.filter(e => e.name === 'levee:burrow');
ok(burrows.length > 0, `nutria burrowed within 20 monthly steps (${burrows.length} events)`);
ok(burrows.every(e => s5.tiles.crest[e.p.i] === 6 && e.p.integrity < 100 && s5.wildlife.burrowLog[e.p.i] && s5.wildlife.burrowLog[e.p.i].n >= 1), 'burrows hit earthen levee tiles, lowered integrity and were logged');
ok(BSU.__integrityCalls === burrows.length, 'buildings.onIntegrityChanged called once per burrow');
ok(s5.wildlife.nutria === 4 + Math.floor((4096 - 64 - 25) / 60), `nutria population ${s5.wildlife.nutria} = 4 + floor(marsh/60)`);
building(s5, 'wildlife_post', 25, 35, 1, 1);
ok(M.nutriaTraps(s5, BSU.idx(30, 30)) && !M.nutriaTraps(s5, BSU.idx(60, 60)), 'nutriaTraps within 14 of the post');
const terms = M.ecologyTerms(s5);
ok(terms.leveeMarsh < 0 && terms.wetlandLost === 10 && terms.posts === 3, `ecology terms: 10 levee tiles on marsh lost (${terms.wetlandLost}), −0.2/tile, +3 post`);

// --- scenario 6: save/load identity — reset(false) keeps gators, draws nothing, keeps the snapshot -----
const s6 = synthetic(15);
BSU.rng.sim.state = s6.rng.sim;
M.reset(s6, true);
run(s6, 700);
const doc = BSU.deepClone({ gators: s6.gators, wildlife: s6.wildlife, mosq: s6.tiles.mosq });
delete doc.wildlife.campusMask;
const s6b = synthetic(15);
s6b.tick = s6.tick; Object.assign(s6b.calendar, s6.calendar);
s6b.gators = BSU.deepClone(doc.gators); s6b.wildlife = BSU.deepClone(doc.wildlife); s6b.tiles.mosq.set(doc.mosq);
const rngBefore = BSU.rng.sim.state;
events.length = 0;
M.reset(s6b, false);
ok(BSU.rng.sim.state === rngBefore, 'reset(load) does not draw rng.sim');
ok(events.length === 0, 'reset(load) emits nothing');
ok(s6b.gators.length === s6.gators.length && s6b.wildlife.ecology === s6.wildlife.ecology && s6b.wildlife.wetlandOriginal === s6.wildlife.wetlandOriginal, 'gators, ecology and wetlandOriginal survive the load');
ok(s6b.wildlife.campusMask instanceof Uint8Array && s6b.wildlife.campusMask.length === 4096, 'campusMask rebuilt on load');
ok(s6b.gators.every(g => Array.isArray(g.route) && g.route.length === 0 && g.px === g.tx && g.py === g.ty), 'routes emptied and px/py reset on load');

// --- scenario 7: determinism — two runs with the same seed produce identical gators ----------------
function runSeed(seed, ticks) { const st = synthetic(seed); BSU.rng.sim.state = st.rng.sim; M.reset(st, true); run(st, ticks); return JSON.stringify(st.gators.map(g => [g.id, g.name, g.state, +g.tx.toFixed(4), +g.ty.toFixed(4), g.den])); }
ok(runSeed(21, 900) === runSeed(21, 900), 'two runs with the same seed give identical gators');
ok(runSeed(21, 900) !== runSeed(22, 900), 'a different seed gives different gators');

// --- scenario 8: Le Grand appears at the cypress lake in April for 3 days; photographed once a year -----
const s8 = synthetic(16);
s8.plot.lake = [];
for (let y = 52; y < 56; y++) for (let x = 6; x < 14; x++) { const i = y * 64 + x; s8.tiles.type[i] = T.OPEN_WATER; s8.tiles.flags[i] = FLAG.OPEN_WATER; s8.tiles.elev[i] = -2; s8.tiles.depth[i] = 2; s8.plot.lake.push(i); }
BSU.rng.sim.state = s8.rng.sim;
M.reset(s8, true);
s8.calendar.day = BSU.dateToDay('Mar 10', 1); Object.assign(s8.calendar, BSU.dayParts(s8.calendar.day)); s8.tick = s8.calendar.day * 100;
BSU.__bumps = [];
let appearedDay = -1, goneDay = -1, lakeOnly = true;
run(s8, 3200, (st) => {
  const lg = st.wildlife.leGrand;
  if (lg && appearedDay < 0) { appearedDay = st.calendar.day; M.photographLeGrand(st); M.photographLeGrand(st); }
  if (lg && !st.plot.lake.includes(Math.floor(lg.ty) * 64 + Math.floor(lg.tx))) lakeOnly = false;
  if (!lg && appearedDay >= 0 && goneDay < 0) goneDay = st.calendar.day;
});
ok(appearedDay === s8.wildlife.leGrandDay || (appearedDay >= BSU.dateToDay('Apr 1', 1) && appearedDay <= BSU.dateToDay('Apr 10', 1)), `Le Grand appeared on day ${appearedDay} (Apr 1–10)`);
ok(goneDay > 0 && goneDay - appearedDay === 3 && s8.wildlife.leGrand === null && s8.wildlife.leGrandDay === -1, `Le Grand left after 3 days (day ${goneDay}) and leGrandDay reset to −1`);
ok(lakeOnly, 'Le Grand never left the cypress lake tiles');
ok(BSU.__bumps.length === 1 && BSU.__bumps[0][0] === 'prestige' && BSU.__bumps[0][1] === 1, 'photographLeGrand bumped prestige +1 exactly once');
ok((BSU.__ticker || []).includes(4), 'ticker line 4 requested for Le Grand');

// --- scenario 9: robustness — bad inputs never throw ------------------------------------------
let robust = true;
try {
  M.tick(null); M.tick({}); M.tick(s, undefined);
  M.mosqAt(s, -1, 999); M.mosqAt(null, 0, 0); M.gatorGridPassable(s, NaN); M.forceMosquito(s, 5, Infinity); M.forceEcology(s, NaN);
  M.spawnGator(s, 1e9); M.relocate(s, 123456); M.photographLeGrand(s); M.nutriaTraps(s, -5); M.applyEcologyOnce(s, NaN); M.critters(s); M.roux(s); M.birds(null); M.onCampus(s);
} catch (e) { robust = false; console.error(e); }
ok(robust, 'public functions never throw on bad input');
ok(!scanNumbers(s), 'state still finite after the bad-input calls');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
