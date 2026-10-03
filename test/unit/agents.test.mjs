// Unit test for src/js/agents.js: loads contract.js (+ any earlier manifest modules that exist)
// and agents.js through makeWindow() from test/domstub.mjs with vm.runInContext, runs
// BSU.agents.selfTest() and the scenario checks from docs/briefs/agents.md §9 "Done means".
// Usage: node test/unit/agents.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

// --- load ------------------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'agents.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src), "starts with 'use strict'");

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
const upTo = manifest.slice(0, manifest.indexOf('agents.js'));
for (const f of upTo) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { console.log('skip:', f, '(does not load yet: ' + (e && e.message) + ')'); }
}
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'agents.js' }); } catch (e) { threw = e; }
ok(!threw, 'agents.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(performance.now() - t0 < 50, 'definition time < 50 ms');
const BSU = win.BSU;
const M = BSU.agents;
ok(M && typeof M === 'object', 'BSU.agents exists');
for (const fn of ['init', 'reset', 'tick', 'selfTest', 'list', 'sample', 'classAttendance', 'count', 'evacuate', 'shelter', 'spawnArrival', 'regenerate', 'route', 'routeSync', 'invalidateRoutes', 'follow', 'inspect', 'vehicles', 'startFogger', 'launchCajunNavy', 'gameDayBuses', 'crewSprites', 'nearest', 'resetDaySamples'])
  ok(typeof M[fn] === 'function', 'BSU.agents.' + fn + ' is a function');
ok(Object.keys(M).every(k => typeof M[k] === 'function' || k === '_deps' || k === '_debug'), 'no state on the module object (D46)');

// --- selfTest --------------------------------------------------------------
const errorsBefore = BSU.errors.size;
BSU.SELFTEST = true;
let st;
const t1 = performance.now();
try { st = M.selfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t1;
ok(st && st.ok === true, 'selfTest().ok === true — ' + (st && st.notes));
ok(stMs < 200, `selfTest ran in ${stMs.toFixed(1)} ms < 200 ms`);
ok(BSU.errors.size === errorsBefore, 'BSU.errors did not grow during selfTest');

// --- scenario harness (the brief's §7 isolation script; stubs are injected through M._deps so the
// test drives agents in isolation even when the real dependency modules are already written) ----
vm.runInContext(`
  (function () {
    const N = 4096;
    const life = new Float32Array(N), green = new Float32Array(N), shade = new Float32Array(N), heat = new Float32Array(N).fill(1);
    const dorm = { id: 0, type: 'dorm', tx: 20, ty: 20, w: 3, h: 2, built: 1, ruin: false, flooded: false, tier: 0 };
    const hall = { id: 1, type: 'lecture_hall', tx: 30, ty: 20, w: 3, h: 2, built: 1, ruin: false, flooded: false, tier: 0 };
    const B = [dorm, hall];
    window.__stubs = { life, green, gators: [] };
    const D = BSU.agents._deps;
    D.buildings = { list(s, t) { return B.filter(b => !t || b.type === t); }, get(s, id) { return B[id] || null; }, footprint(s, id) { const b = B[id]; return b ? BSU.footprintTiles(b.tx, b.ty, b.w, b.h) : []; }, effective() { return 1; }, auras() { return { life, green, shade, heat, dining: new Uint8Array(N) }; }, shelterAssignments() { return {}; }, at() { return null; } };
    D.wildlife = { gators() { return window.__stubs.gators; }, onCampus() { return []; }, mosqAt() { return 0; }, gatorGridPassable() { return true; } };
    D.weather = { sky(s) { const c = s.tick % 300; const b = [25, 155, 175, 200, 300]; let p = 0; while (c >= b[p]) p++; return { phase: p, t: 0, phaseTick: 0, scripted: false }; }, raining() { return false; }, rainAt() { return 0; }, heat() { return { index: 80, advisory: false, wave: false }; }, date(s) { const d = BSU.dayParts(s.calendar.day); return { day: d.day, month: d.month, semester: d.semester }; }, storm() { return null; } };
    D.hydro = { depthAt() { return 0; } };
    D.sports = { season(s) { return s.sports; } };
    D.progress = { timer() { return null; }, timers() { return []; } };
    D.sprites = { agentLook(n) { return n & 511; } };
    D.terrain = { paradeRoute() { return []; } };
    D.render = { visibleTiles() { return { x0: 0, y0: 0, x1: 63, y1: 63 }; }, particles: { emit() {} } };
  })();
`, ctx);

const s = BSU.newState(4);
s.tiles.walk.fill(2); s.tiles.type.fill(BSU.T.DRY);
for (const b of [[20, 20], [30, 20]]) for (const i of BSU.footprintTiles(b[0], b[1], 3, 2)) { s.tiles.walk[i] = 0; }
for (let x = 20; x <= 33; x++) { s.tiles.walk[22 * 64 + x] = 1; s.tiles.surface[22 * 64 + x] = 1; }
s.economy.students = 500; s.plot.founders = { tx: 40, ty: 7 }; s.calendar.day = 10;
BSU.state = s;
M.init(s); M.reset(s, true);
ok(s.agents.length === 60 && M.count(s) === 60, `regenerate builds count(state) = 60 agents (got ${s.agents.length})`);
ok(s.agents[0].name.length > 3 && s.agents[0].home === 0 && s.agents[0].cls === 1, `agent 0: ${s.agents[0].name}, home ${s.agents[0].home}, class ${s.agents[0].cls}`);

// tick 3000 ticks (10 sky cycles, 30 calendar days) tracking bounds, the A* budget and states
let outOfBounds = 0, nan = 0, walkedToHall = 0, wentHome = 0, maxSearches = 0;
const origRoute = M.route;
for (let t = 0; t < 3000; t++) {
  const flags = { newDay: t % 100 === 0 && t > 0, newMonth: false, newYear: false, day: Math.floor(t / 100) };
  M.tick(s, flags);
  for (const a of s.agents) {
    if (!(a.tx >= 0 && a.tx <= 64 && a.ty >= 0 && a.ty <= 64)) outOfBounds++;
    if (!Number.isFinite(a.tx) || !Number.isFinite(a.ty) || !Number.isFinite(a.mood) || !Number.isFinite(a.energy)) nan++;
    if (a.state !== 'GONE' && a.goal === 'class' && a.inside) walkedToHall++;
    if (a.state !== 'GONE' && a.goal === 'home' && a.inside) wentHome++;
  }
  s.tick++;
}
ok(outOfBounds === 0, 'no agent ever leaves the map bounds');
ok(nan === 0, 'no NaN in agent positions or stats');
ok(walkedToHall > 0, `agents reached the lecture hall during Day (${walkedToHall} agent-ticks inside class)`);
ok(wentHome > 0, `agents went home at Night (${wentHome} agent-ticks inside the dorm)`);
const ca = M.classAttendance(s);
ok(ca >= 0.5 && ca <= 1, `classAttendance ${ca} between 0.5 and 1`);
const sm = M.sample(s);
ok(sm.n > 0, `sample().n is non-zero (${sm.n})`);
ok(s.agents.every(a => a.state !== 'GONE'), 'all 60 agents present after 30 days (spring semester)');

// A* budget per tick: 40 distinct requests in one tick → 8 computed now, the rest queued and answered later
{
  const s2 = BSU.newState(9); s2.tiles.walk.fill(2); s2.tick = 5000;
  M.reset(s2, true);
  let now = 0, later = 0;
  for (let k = 0; k < 40; k++) if (M.route(s2, BSU.idx(1, 1), BSU.idx(40, 5 + k), 'walk')) now++;
  ok(now === 8, `at most 8 new A* searches per tick (${now} answered immediately)`);
  ok(M._debug.queueSize() === 32, `the remaining 32 are queued (${M._debug.queueSize()})`);
  for (let t = 0; t < 4; t++) { s2.tick++; M.tick(s2, { newDay: false }); }
  for (let k = 0; k < 40; k++) if (M.route(s2, BSU.idx(1, 1), BSU.idx(40, 5 + k), 'walk')) later++;
  ok(later === 40, `all 40 routes answered after 4 more ticks (${later})`);
}

// determinism: two fresh states with the same seed and ticks produce identical agent positions
{
  const mk = () => { const q = BSU.newState(21); q.tiles.walk.fill(2); q.tiles.type.fill(BSU.T.DRY); for (let x = 20; x <= 33; x++) { q.tiles.walk[22 * 64 + x] = 1; q.tiles.surface[22 * 64 + x] = 1; } q.economy.students = 300; q.plot.founders = { tx: 40, ty: 7 }; q.calendar.day = 10; return q; };
  const sig = q => q.agents.map(a => a.name + ':' + a.tx.toFixed(3) + ',' + a.ty.toFixed(3) + ':' + a.state).join('|');
  const a1 = mk(); BSU.rng.sim.state = a1.rng.sim; BSU.state = a1; M.reset(a1, true); for (let t = 0; t < 400; t++) { M.tick(a1, { newDay: t % 100 === 0 && t > 0 }); a1.tick++; }
  const a2 = mk(); BSU.rng.sim.state = a2.rng.sim; BSU.state = a2; M.reset(a2, true); for (let t = 0; t < 400; t++) { M.tick(a2, { newDay: t % 100 === 0 && t > 0 }); a2.tick++; }
  ok(sig(a1) === sig(a2), 'two runs with the same seed produce identical agents after 400 ticks');
}

// shelter / release / evacuation on the live bus (storm:passed listener)
{
  BSU.state = s;
  M.reset(s, true);
  M.shelter(s, { 0: 100, 1: 100 });
  ok(s.agents.every(a => a.goal === 'shelter'), 'shelter assigns every present agent when capacity allows');
  BSU.events.emit('storm:passed', { name: 'X', cat: 1 });
  M.tick(s, { newDay: false }); s.tick++;
  ok(s.agents.every(a => a.goal !== 'shelter' && a.state !== 'SHELTER'), 'storm:passed releases the shelters');
}

// inspect and nearest
{
  const r = M.inspect(s, 0);
  ok(r.name === s.agents[0].name && typeof r.activity === 'string' && r.quote.length > 0, `inspect: ${r.name} — ${r.activity} — "${r.quote}"`);
  const a = s.agents.find(x => !x.inside && x.state !== 'GONE');
  ok(!a || M.nearest(s, a.tx, a.ty, 1) !== null, 'nearest finds an agent under the cursor');
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
