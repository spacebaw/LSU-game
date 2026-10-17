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
    D.weather = { sky(s) { const c = (s.__lock !== undefined ? s.__lock : s.tick) % 300; const b = [25, 155, 175, 200, 300]; let p = 0; while (c >= b[p]) p++; return { phase: p, t: 0, phaseTick: 0, scripted: false }; }, raining() { return false; }, rainAt() { return 0; }, heat() { return { index: 80, advisory: false, wave: false }; }, date(s) { const d = BSU.dayParts(s.calendar.day); return { day: d.day, month: d.month, semester: d.semester }; }, storm() { return null; } };
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

// --- movement pass: speed, eased starts and stops, turning, dwell, spacing ---------------------------------------------
{
  const PMv = BSU.params.agents.move, TPS = BSU.params.time.baseTps;
  const mk = (seed, n) => { const q = BSU.newState(seed); q.tiles.walk.fill(2); q.tiles.type.fill(BSU.T.DRY); for (let x = 4; x <= 44; x++) { q.tiles.walk[22 * 64 + x] = 1; q.tiles.surface[22 * 64 + x] = 1; } q.economy.students = n; q.plot.founders = { tx: 40, ty: 7 }; q.calendar.day = 10; q.tick = 40; q.__lock = 40; BSU.state = q; BSU.rng.sim.state = q.rng.sim; M.init(q); M.reset(q, true); return q; };
  const put = (a, x, y) => { a.inside = false; a.aboard = false; a.tx = x; a.ty = y; a.px = x; a.py = y; a.lastTile = Math.floor(y) * 64 + Math.floor(x); a.next = null; a.waitTicks = 0; a.prop = 'none'; };
  const walk = (a, tile) => { a.state = 'WALK'; a.goal = 'tile'; a.target = tile; a.route = []; a.routeIdx = 0; a.spd = 0; a.step = 0; };

  // 1. speed: one student alone on a path covers 1.0–1.2 tiles per real second at 1× (it was 2.0 before the pass)
  {
    const q = mk(31, 120); M.tick(q, { newDay: false }), q.tick++;          // let the Day schedule run once, then take the agent over
    const a = q.agents[0]; put(a, 5.5, 22.5); walk(a, 22 * 64 + 42);
    const steps = [];
    for (let t = 0; t < 40; t++) { const x0 = a.tx; M.tick(q, { newDay: false }), q.tick++; steps.push(a.tx - x0); }
    const cruise = steps.slice(8, 36), mean = cruise.reduce((p, c) => p + c, 0) / cruise.length * TPS;
    ok(mean >= 1.0 && mean <= 1.2, `a student on a path walks ${mean.toFixed(2)} tiles per real second at 1× (1.0–1.2; was 2.0)`);
    ok(steps[0] > 0 && steps[0] < 0.6 * cruise[0] && steps[1] > steps[0] && steps[3] > steps[1] && steps[3] <= cruise[0] * 1.05, `eased start: steps ${steps.slice(0, 5).map(v => v.toFixed(3)).join(', ')} ramp to ${cruise[0].toFixed(3)}`);
    const g = BSU.params.agents.speed;
    ok(Math.abs(M.stepSpeed(2) / M.stepSpeed(1) - g.dry / g.path) < 1e-9 && g.path * TPS / 10 <= 1.2 && g.path * TPS / 10 >= 1.0 && g.dry < g.path && g.wet < g.dry && g.wading < g.wet, 'grass, wet ground and wading are proportionally slower than the path');
    const vs = BSU.params.agents.vehicleSpeed;
    ok(vs.bus >= 5 * 0.75 && vs.officer >= 3 * 0.75 && vs.fogger >= 3 * 0.75 && vs.pirogue >= 5 * 0.75 && vs.bus <= 5, 'vehicles slow by at most 25 %');
  }

  // 2. turning: a 90° turn takes about turnSecs of real frames, in steps no bigger than the rate allows, through the diagonal
  {
    const w = (Math.PI / 2) / PMv.turnSecs, dtF = 1 / 60; let ang = 0, frames = 0, maxStep = 0, hitDiag = false;
    while (Math.abs(ang - Math.PI / 2) > 1e-9 && frames < 200) { const nx = M.turnStep(ang, Math.PI / 2, w * dtF); maxStep = Math.max(maxStep, Math.abs(nx - ang)); ang = nx; frames++; if (Math.abs(ang - Math.PI / 4) < w * dtF) hitDiag = true; }
    ok(frames >= 15 && frames <= 21 && maxStep <= w * dtF + 1e-9 && hitDiag, `a 90° turn takes ${frames} frames (${(frames / 60).toFixed(2)} s at 60 fps), no step over ${(w * dtF).toFixed(3)} rad, through 45°`);
    ok(M.turnStep(3.0, -3.0, 0.1) > 3.0 && M.turnStep(-3.0, 3.0, 0.1) < -3.0 && M.turnStep(0, Math.PI, 5) === Math.PI && M.turnStep(NaN, 1, 1) === 1 && M.turnStep(1, NaN, 1) === 1, 'turnStep takes the short way round the circle and survives bad input');
    // 180° flips are not instant either
    let a2 = 0, f2 = 0; while (Math.abs(a2 - Math.PI) > 1e-9 && f2 < 400) { a2 = M.turnStep(a2, Math.PI, w * dtF); f2++; }
    ok(f2 >= 2 * frames - 3, `a 180° turn takes about twice as long (${f2} frames)`);
  }

  // 3. lateral offsets: stable per agent, within ±latMax, spread across the width, the same after a regenerate
  {
    const q = mk(32, 1000);
    const lat1 = q.agents.map(a => a.lat); M.reset(q, true); const lat2 = q.agents.map(a => a.lat);
    const mx = Math.max(...lat1), mn = Math.min(...lat1);
    ok(lat1.every(v => Math.abs(v) <= PMv.latMax + 1e-9) && mx - mn > 1.5 * PMv.latMax && lat1.every((v, i) => v === lat2[i]), `lateral offsets span ${mn.toFixed(2)}..${mx.toFixed(2)} (±${PMv.latMax}) and are stable across a regenerate`);
    ok(M.latScale(1) < 1 && M.latScale(0) === 1 && M.latScale(2) === 1, 'the offset is scaled down on a path (0.42 tile wide) and not on open ground or a road');
  }

  // 4. dwell and spots: 40 students sent to one idle tile spread over a 0.5-tile grid (no shared spot, ≥ 0.42 apart), then stand 8–25 s
  {
    const q = mk(33, 1500); M.tick(q, { newDay: false }), q.tick++;
    const tgt = 30 * 64 + 30, A = q.agents.filter(a => a.state !== 'GONE').slice(0, 40);
    A.forEach((a, k) => { put(a, 24.5 + (k % 8), 24.5 + ((k / 8) | 0)); walk(a, tgt); a.goal = 'idle'; });
    const firstWait = new Map(); let best = null, bestN = 0;
    const standing = a => (a.state === 'IDLE' || a.state === 'SIT') && !a.approach && !a.inside;
    for (let t = 0; t < 400; t++) {
      M.tick(q, { newDay: false }), q.tick++;
      let n = 0;
      for (const a of A) if (standing(a) && Math.hypot(a.tx - 30.5, a.ty - 30.5) < 4.5) { n++; if (a.waitTicks > 0 && !firstWait.has(a.id)) firstWait.set(a.id, a.waitTicks); }
      if (n > bestN) { bestN = n; best = A.filter(a => standing(a) && Math.hypot(a.tx - 30.5, a.ty - 30.5) < 4.5).map(a => [a.tx, a.ty]); }
    }
    ok(bestN >= 36, `at the peak ${bestN} of the 40 stand around the target`);
    const cells = new Set(best.map(p => Math.floor(p[0] * 2) + ',' + Math.floor(p[1] * 2)));
    let minD = 9; for (let i = 0; i < best.length; i++) for (let j = i + 1; j < best.length; j++) minD = Math.min(minD, Math.hypot(best[i][0] - best[j][0], best[i][1] - best[j][1]));
    ok(cells.size === best.length && minD >= 0.4, `no two idle students share a spot: ${cells.size} distinct cells for ${best.length} students, nearest pair ${minD.toFixed(2)} tiles (≥ 0.4)`);
    const waits = [...firstWait.values()];
    ok(waits.length >= 36 && waits.every(v => v >= PMv.dwellTicks[0] - 2 && v <= PMv.dwellTicks[1]) && new Set(waits).size >= 12, `dwell at the spot: ${Math.min(...waits)}–${Math.max(...waits)} ticks (${(Math.min(...waits) / TPS).toFixed(0)}–${(Math.max(...waits) / TPS).toFixed(0)} s at 1×), ${new Set(waits).size} distinct values`);
  }
  {   // a dweller stands still through the first part of the dwell and uses the idle pose
    const q = mk(36, 1500); M.tick(q, { newDay: false }), q.tick++;
    const a = q.agents[3]; put(a, 28.5, 30.5); walk(a, 30 * 64 + 30); a.goal = 'idle';
    let k = 0; while (k++ < 200 && !((a.state === 'IDLE' || a.state === 'SIT') && !a.approach && a.waitTicks > 0)) M.tick(q, { newDay: false }), q.tick++;
    const x0 = a.tx, y0 = a.ty, w0 = a.waitTicks; for (let t = 0; t < 30; t++) M.tick(q, { newDay: false }), q.tick++;
    ok(a.tx === x0 && a.ty === y0 && a.waitTicks === w0 - 30 && (a.anim === 'idle' || a.anim === 'sit'), `a dweller stands still while its dwell runs (${w0} ticks, pose ${a.anim})`);
    let sat = 0; for (let n = 0; n < 40; n++) { const z = mk(40 + n, 1500); M.tick(z, { newDay: false }), z.tick++; const b = z.agents[2]; put(b, 20.5, 26.5); b.goal = 'idle'; b.state = 'WALK'; b.target = 26 * 64 + 20; b.route = []; b.routeIdx = 0; for (let t = 0; t < 30; t++) M.tick(z, { newDay: false }), z.tick++; if (b.state === 'SIT' && b.anim === 'sit') sat++; }
    ok(sat >= 5 && sat <= 22, `about ${PMv.sitShare * 100} % of idle dwellers on bare ground sit (${sat} of 40 sat)`);
  }

  // 5. local avoidance (on open ground, where the whole ±0.3 offset applies): a student 0.3 tile behind a standing one in the same lane eases down 30 %; one a lane over does not
  {
    const q = mk(34, 120); M.tick(q, { newDay: false }), q.tick++;
    const [f, l, o] = q.agents;
    put(l, 20.5, 24.5); l.lat = 0; l.state = 'IDLE'; l.goal = 'idle'; l.target = -1; l.step = 0;
    const tile = 24 * 64 + 40;
    put(f, 20.2, 24.5); f.lat = 0; walk(f, tile); f.route = M.routeSync(q, 24 * 64 + 20, tile, 'walk'); f.routeIdx = 1; f.dir = 0; f.spd = 1; f.step = 0.13;
    put(o, 20.2, 24.5); o.lat = 0.3; walk(o, tile); o.route = f.route; o.routeIdx = 1; o.dir = 0; o.spd = 1; o.step = 0.13;
    M.tick(q, { newDay: false }), q.tick++;
    ok(Math.abs(f.spd - PMv.yieldMult) < 0.06 && o.spd > 0.9, `same lane behind a standing student: speed ×${f.spd.toFixed(2)} (want ${PMv.yieldMult}); a lane over: ×${o.spd.toFixed(2)}`);
  }

  // 6. cost: 300 agents on the open stub map stay cheap
  {
    const q = mk(35, 20000); const n = q.agents.length;
    for (let t = 0; t < 120; t++) { M.tick(q, { newDay: t % 200 === 0 && t > 0 }); q.tick++; }
    const t0 = performance.now(); const T = 300; for (let t = 0; t < T; t++) { M.tick(q, { newDay: false }), q.tick++; q.tick++; }
    const ms = (performance.now() - t0) / T;
    ok(n === 300 && ms < 2, `${n} agents: ${ms.toFixed(2)} ms per tick (< 2)`);
  }
}

// --- habitat pass: the Tiger Habitat is an idle destination with a viewing plaza (12 cells, never the enclosure) ------------------
{
  const D = M._deps, prevB = D.buildings;
  const hab = { id: 2, type: 'tiger_habitat', tx: 40, ty: 30, w: 3, h: 3, built: 1, ruin: false, flooded: false, tier: 0, hp: 1 };
  const quad = { id: 3, type: 'quad', tx: 10, ty: 40, w: 2, h: 2, built: 1, ruin: false, flooded: false, tier: 0, hp: 1 };
  D.buildings = Object.assign({}, prevB, {
    list(q, t) { return prevB.list(q, t).concat([hab, quad]).filter(b => !t || b.type === t); },
    get(q, id) { return id === 2 ? hab : id === 3 ? quad : prevB.get(q, id); },
    footprint(q, id) { return id === 2 ? BSU.footprintTiles(40, 30, 3, 3) : id === 3 ? BSU.footprintTiles(10, 40, 2, 2) : prevB.footprint(q, id); }
  });
  const mkH = (side, n, seed) => {
    const q = BSU.newState(seed); q.tiles.walk.fill(2); q.tiles.type.fill(BSU.T.DRY);
    for (const i of BSU.footprintTiles(40, 30, 3, 3)) { q.tiles.walk[i] = 0; q.tiles.owner[i] = 2; }
    for (const i of BSU.footprintTiles(10, 40, 2, 2)) { q.tiles.walk[i] = 0; q.tiles.owner[i] = 3; }
    if (side === 'SE') for (let y = 28; y <= 34; y++) { q.tiles.walk[y * 64 + 43] = 1; q.tiles.surface[y * 64 + 43] = 1; }   // a path along the east edge: the front is the SE edge
    else for (let x = 38; x <= 45; x++) { q.tiles.walk[33 * 64 + x] = 1; q.tiles.surface[33 * 64 + x] = 1; }                // along the south edge: the front is the SW edge (FRONT_L)
    q.economy.students = n; q.plot.founders = { tx: 40, ty: 7 }; q.calendar.day = 10; q.tick = 40; q.__lock = 40; BSU.state = q; BSU.rng.sim.state = q.rng.sim; M.init(q); M.reset(q, true); return q;
  };
  const put = (a, x, y) => { a.inside = false; a.aboard = false; a.tx = x; a.ty = y; a.px = x; a.py = y; a.lastTile = Math.floor(y) * 64 + Math.floor(x); a.next = null; a.waitTicks = 0; a.prop = 'none'; a.approach = false; };
  const toDoor = (a, door) => { a.state = 'WALK'; a.goal = 'idle'; a.target = door; a.route = []; a.routeIdx = 0; a.spd = 0; a.step = 0; };
  // the local exhibit depth of a world position (the sprite's transpose): X = depth 0 back … 3 front; < 2 is the enclosure
  const depthOf = (fl, x, y) => (fl ? y - 30 : x - 40);
  for (const side of ['SE', 'SW']) {
    const q = mkH(side, 1500, side === 'SE' ? 61 : 62); M.tick(q, { newDay: false }), q.tick++;
    const info = M._debug.habitat(q, 2), fl = info.fl;
    ok(fl === (side === 'SW') && info.door === (fl ? 33 * 64 + 41 : 31 * 64 + 43), `${side}-front habitat: front rule ${fl ? 'SW' : 'SE'}, door tile ${info.door & 63},${info.door >> 6} (the path tile just outside the plaza's middle)`);
    const nSpots = info.spots.length / 3, rows = [0, 0, 0]; for (let k = 0; k < nSpots; k++) rows[info.spots[k * 3 + 2]]++;
    ok(nSpots === 12 && rows.join() === '4,4,4' && nSpots <= info.max, `${side}: twelve standing cells (two rows of four on the plaza, four on the path tiles outside)`);
    let inEnclosure = 0; for (let k = 0; k < nSpots; k++) if (depthOf(fl, info.spots[k * 3], info.spots[k * 3 + 1]) < 2) inEnclosure++;
    ok(inEnclosure === 0, `${side}: no standing cell lies on an enclosure tile (depth < 2)`);
    // 40 students sent to the door at once: the cap holds, nobody ever steps onto the enclosure, dwell is 10–30 s, the poses show up
    const A = q.agents.filter(a => a.state !== 'GONE').slice(0, 40), ids = new Set(A.map(a => a.id));
    A.forEach((a, k) => { put(a, 20.5 + (k % 8) * 0.9, 25.5 + ((k / 8) | 0)); toDoor(a, info.door); });
    let maxViewers = 0, trespass = 0, sharedCell = 0, badSpot = 0; const firstWait = new Map(), poses = new Set(); let left = 0;
    for (let t = 0; t < 700; t++) {
      M.tick(q, { newDay: false }), q.tick++;
      const cells = new Set(); let v = 0;
      for (const a of q.agents) {
        if (a.state === 'GONE' || a.inside) continue;
        const d = depthOf(fl, a.tx, a.ty), onTiles = fl ? (a.tx >= 40 && a.tx < 43 && a.ty >= 30 && a.ty < 33) : (a.tx >= 40 && a.tx < 43 && a.ty >= 30 && a.ty < 33);
        if (onTiles && d < 2) trespass++;
        if (a.view === 2) {
          v++;
          if (!a.approach && a.state === 'IDLE') {
            const key = Math.floor(a.tx * 2) + ',' + Math.floor(a.ty * 2); if (cells.has(key)) sharedCell++; cells.add(key);
            if (d < 2.2) badSpot++;
            if (a.waitTicks > 0 && !firstWait.has(a.id)) firstWait.set(a.id, a.waitTicks);
            poses.add(a.anim);
          }
        } else if (ids.has(a.id) && a.view === -1 && a.goal === 'idle' && a.target !== info.door && t > 150) left++;
      }
      maxViewers = Math.max(maxViewers, v);
    }
    ok(trespass === 0, `${side}: no student is ever on an enclosure tile (over 700 ticks)`);
    ok(maxViewers >= 8 && maxViewers <= 12, `${side}: ${maxViewers} students at the glass at the peak (cap 12)`);
    ok(sharedCell === 0 && badSpot === 0, `${side}: no two viewers share a cell and every viewer stands on the plaza or outside it`);
    const waits = [...firstWait.values()];
    ok(waits.length >= 8 && waits.every(v => v >= 50 - 2 && v <= 150) && new Set(waits).size >= 5, `${side}: viewers dwell 10–30 s (${Math.min(...waits)}–${Math.max(...waits)} ticks, ${waits.length} measured)`);
    ok(poses.has('idle') && (poses.has('selfie') || poses.has('binoculars')), `${side}: viewers show idle / selfie / binoculars poses (${[...poses].sort().join(', ')})`);
    ok(left >= 1, `${side}: viewers move on after the dwell`);
    const vw = M.habitatViewers(q, 2); ok(vw && vw.n >= 0 && vw.x.length >= 12 && vw.total >= vw.n, `${side}: habitatViewers lists the glass (n ${vw && vw.n}, total ${vw && vw.total})`);
  }
  // the weight scales with the happiness effect: value × radius / 225 (one in three) of the idle picks; a full habitat draws nobody
  {
    const q = mkH('SW', 600, 63); M.tick(q, { newDay: false }), q.tick++;
    q.veg = []; for (let k = 0; k < 6; k++) q.veg.push({ type: 'oak', stage: 2, tx: 8 + k * 3, ty: 50 });
    M.reset(q, true);
    const hp = BSU.data.catalog.tiger_habitat.effects.happiness;
    ok(Math.abs(M._debug.habShare() - Math.min(0.4, Math.max(0.05, hp.value * hp.radius / 225))) < 1e-9 && Math.abs(M._debug.habShare() - 1 / 3) < 0.01, `the habitat's share of idle strolls = value ${hp.value} × radius ${hp.radius} / 225 = ${M._debug.habShare().toFixed(3)}`);
    const door = M._debug.habitat(q, 2).door, picks = M._debug.idleTargets(q, 1500), share = picks.filter(t => t === door).length / picks.length;
    ok(share > 0.25 && share < 0.42, `${(share * 100).toFixed(1)} % of 1500 idle picks are the habitat (about a third)`);
    // twelve students committed: nobody else is sent
    const A = q.agents.filter(a => a.state !== 'GONE').slice(0, 12);
    A.forEach((a, k) => { put(a, 41.5, 36.5 + (k % 3) * 0.1); toDoor(a, door); });
    M.tick(q, { newDay: false }), q.tick++;
    const picks2 = M._debug.idleTargets(q, 400), n2 = picks2.filter(t => t === door).length;
    ok(n2 === 0, `with 12 students at or on their way to the glass the habitat draws none of 400 picks (${n2})`);
    // flooded or ruined: closed
    hab.flooded = true; M.tick(q, { newDay: false }), q.tick++;
    ok(M._debug.idleTargets(q, 300).filter(t => t === door).length === 0, 'a flooded habitat is not an idle destination');
    hab.flooded = false;
  }
  D.buildings = prevB;
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
