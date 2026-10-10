// Unit test for src/js/hydro.js: loads contract.js and every earlier manifest module that exists
// (skipping missing ones) through makeWindow() + node:vm, stubs the modules hydro calls, runs
// BSU.hydro.selfTest() and the scenario checks from docs/briefs/hydro.md §9 "Done means".
// Usage: node test/unit/hydro.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg } from 'node:os';
const BUSY = loadavg()[0] > 3;   // timing budgets are advisory when the machine is loaded
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

// --- load ------------------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'hydro.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src), "starts with 'use strict'");

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
for (const f of manifest.slice(0, manifest.indexOf('hydro.js'))) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f });
}
// stubs for the modules hydro talks to (only when the real ones are absent)
vm.runInContext(`
  BSU.terrain = BSU.terrain || { touch(s,i,w){ BSU.events.emit(BSU.EV.TILE_CHANGED,{i,tx:i&63,ty:i>>6,what:w,chunk:0}); }, rewalk(){}, classify(s,i){ if (i === undefined) return; if (s.tiles.flags[i] & BSU.FLAG.DRAINED) s.tiles.type[i] = BSU.T.DRAINED; }, setElev(s,i,v){ s.tiles.elev[i]=v; } };
  BSU.buildings = BSU.buildings || { list(){ return []; }, get(){ return null; }, footprint(){ return []; }, effective(){ return 1; }, onIntegrityChanged(){}, dirtyRing(){}, has(){ return false; } };
  BSU.weather = BSU.weather || { consumeRainStep(){ return null; } };
  BSU.wildlife = BSU.wildlife || {};
`, ctx);
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'hydro.js' }); } catch (e) { threw = e; }
ok(!threw, 'hydro.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(performance.now() - t0 < 50, 'definition time < 50 ms');
const BSU = win.BSU, H = BSU.hydro, T = BSU.T, F = BSU.FLAG, W = 64, N = 4096;
for (const k of ['init', 'reset', 'tick', 'selfTest', 'seedInitial', 'depthAt', 'surfaceAt', 'stageAt', 'floodedBuildings', 'floodedTiles', 'predictRisk', 'riskAt', 'footprintDepth', 'markCanal', 'markPond', 'markLeveeChange', 'setJammed', 'networks', 'networkAt', 'surgeControl', 'surgeReached', 'surgeFrontDistance', 'forceRain', 'forceSat', 'setStages', 'conservationCheck', 'drainsTo', 'markRestored', 'markRestoring', 'stormLog', 'stepCount', 'activeCount', 'pumpRunning', 'isMud', 'riverAdjacent', 'spillway', '_step', '_daily'])
  ok(typeof H[k] === 'function', 'BSU.hydro.' + k + ' is a function');
ok(!('barrierClosed' in H) && !('surge' in H), 'no state mirrored on the module object (D46)');

// --- selfTest --------------------------------------------------------------
H.init(BSU.newState(1));
BSU.SELFTEST = true;
const t1 = performance.now();
let st;
try { st = H.selfTest(); } catch (e) { st = { ok: false, notes: 'threw ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t1;
ok(st && st.ok === true, 'selfTest().ok === true — ' + (st && st.notes));
ok(BUSY || stMs < 400, `selfTest ran in ${stMs.toFixed(0)} ms${BUSY ? ' [machine busy: budget advisory]' : ''}`);
ok(BSU.errors.size === 0, 'no BSU.error during selfTest');

// --- scenario helpers --------------------------------------------------------
function synth(seed) {
  const s = BSU.newState(seed), t = s.tiles;
  for (let i = 0; i < N; i++) { t.elev[i] = 4; t.type[i] = T.DRY; }
  for (let y = 0; y < W; y++) for (let x = 10; x <= 11; x++) { const i = y * W + x; t.elev[i] = -1; t.flags[i] |= F.BAYOU; t.type[i] = T.BAYOU; }
  for (let y = 24; y <= 38; y++) for (let x = 24; x <= 38; x++) { const d = BSU.chebyshev(x, y, 31, 31); if (d <= 7) { const i = y * W + x; t.elev[i] = Math.min(4, 2.6 + (d - 2) * 0.28); t.type[i] = t.elev[i] < 3.5 ? T.WET : T.DRY; } }
  for (let y = 29; y <= 33; y++) for (let x = 29; x <= 33; x++) { const i = y * W + x; t.elev[i] = 2.2; t.type[i] = T.WET; }
  for (let y = 30; y <= 32; y++) for (let x = 30; x <= 32; x++) t.elev[y * W + x] = 1.6;
  s.calendar.month = 6; s.weather.dtDay = 1 / 40; s.wildlife.ecology = 60;
  H.seedInitial(s); H.reset(s, true);
  return s;
}
const dt = 1 / 40;
const finite = (s) => { for (let i = 0; i < N; i++) if (!Number.isFinite(s.tiles.depth[i]) || s.tiles.depth[i] < 0 || !Number.isFinite(s.tiles.sat[i])) return false; return true; };

// --- scenario 1: the isolation script — basin fills after a 2-inch rain, leak < 1% -------------
{
  const s = synth(7);
  let worst = 0;
  for (let k = 0; k < 40; k++) { H._step(s, dt, { r: 0.167 / 40, mapWide: true }); const c = H.conservationCheck(s); if (c.moved > 0) worst = Math.max(worst, c.leak / c.moved); }
  const center = s.tiles.depth[31 * W + 31];
  ok(center > 0.1 && center < 1.0, `basin center ${center.toFixed(3)} ft after 2 in on sat 0.5`);
  ok(worst < 0.01, `worst conservation leak ${(worst * 100).toFixed(4)}% < 1%`);
  ok(finite(s), 'no NaN after the rain');
  ok(H.activeCount() === N, 'every tile active while raining');
  for (let k = 0; k < 160; k++) H._step(s, dt, null);
  ok(H.activeCount() < N / 2, `active set shrinks in dry weather (${H.activeCount()})`);
  ok(H.stepCount() === 200, 'stepCount counts steps since reset');
}

// --- scenario 2: T2 — 5-ft crown never exceeds 0.1 ft from any rain; floods only at Cat 3 surge --
{
  const s = synth(8);
  for (let y = 5; y <= 8; y++) for (let x = 50; x <= 55; x++) { s.tiles.elev[y * W + x] = 5.5; s.tiles.type[y * W + x] = T.DRY; }
  H.reset(s, true);
  let maxCrown = 0;
  for (let k = 0; k < 360; k++) { H._step(s, 1 / 360, { r: 16 / 12 / 360, mapWide: true }); maxCrown = Math.max(maxCrown, s.tiles.depth[6 * W + 52]); }
  ok(maxCrown < 0.1, `crown depth ≤ ${maxCrown.toFixed(3)} under a 16-inch hurricane rain`);
  // Cat 2 surge (5 ft) via the bayou: the 5.5-ft crown stays dry; Cat 3 (8 ft) floods it
  const entry = []; for (let x = 8; x <= 15; x++) entry.push(63 * W + x);
  const run = (stage) => {
    const s2 = synth(9);
    for (let y = 5; y <= 8; y++) for (let x = 12; x <= 17; x++) { s2.tiles.elev[y * W + x] = 5.5; }
    H.reset(s2, true);
    s2.weather.dtDay = 1 / 360;
    H.surgeControl(s2, 'begin', { stage: 0, target: stage, entry, dir: 'S' });
    for (let t = 1; t <= 600; t++) { s2.tick++; H.tick(s2, { newDay: false }); H.surgeControl(s2, 'stage', stage * Math.min(1, t / 200)); }
    const d = s2.tiles.depth[6 * W + 14];
    H.surgeControl(s2, 'end');
    return d;
  };
  const d5 = run(5), d8 = run(8);
  ok(d5 < 0.05, `5.5-ft crown dry under a 5-ft surge (${d5.toFixed(3)})`);
  ok(d8 > 0.5, `5.5-ft crown floods under an 8-ft surge (${d8.toFixed(3)})`);
}

// --- scenario 3: T3-style — crest 8 overtopped by an 8-ft stage; 9.5 with sandbags holds --------
{
  const build = (sandbag) => {
    const s = synth(10);
    const y = 45, Wt = y * W + 40, L = y * W + 41, B = y * W + 42;
    s.tiles.elev[Wt] = -4; s.tiles.flags[Wt] |= F.OPEN_WATER; s.tiles.type[Wt] = T.OPEN_WATER;
    for (const j of [Wt - W, Wt + W, Wt - 1, L - W, L + W, B - W, B + W, B + 1]) s.tiles.elev[j] = 12;
    s.tiles.elev[L] = 2; s.tiles.crest[L] = 6; s.tiles.integrity[L] = 100; s.tiles.sandbag[L] = sandbag;
    s.tiles.elev[B] = 2; s.tiles.type[B] = T.WET;
    H.seedInitial(s); H.reset(s, true); H.setStages(s, 8, 0);
    for (let k = 0; k < 40; k++) H._step(s, dt, null);
    return s.tiles.depth[B];
  };
  const noBags = build(0), bags = build(15);
  ok(noBags > 0.5, `Cat-3 stage 8 overtops an earthen levee on a 2-ft tile (behind: ${noBags.toFixed(2)} ft)`);
  ok(bags === 0, `sandbags (+1.5 ft) hold: behind ${bags}`);
}

// --- scenario 4: T7 live half — gate conducts at stage 0, closes within one step above 1 ft -----
{
  const s = synth(11);
  const y = 31;
  for (let x = 12; x <= 29; x++) { const i = y * W + x; s.tiles.elev[i] = 0.5; s.tiles.type[i] = T.WET; }
  const G = y * W + 20; s.tiles.crest[G] = 6; s.tiles.integrity[G] = 100;
  H.seedInitial(s); H.reset(s, true);
  for (let x = 12; x <= 29; x++) H.markCanal(s, y * W + x, true);
  for (let yy = 30; yy <= 32; yy++) for (let x = 30; x <= 32; x++) s.tiles.depth[yy * W + x] = 1.0;
  const sum = () => { let t = 0; for (let yy = 30; yy <= 32; yy++) for (let x = 30; x <= 32; x++) t += s.tiles.depth[yy * W + x]; return t; };
  const events = []; const off = BSU.events.on(BSU.EV.GATE_CLOSED, (p) => events.push(p), 'test');
  const b0 = sum();
  for (let k = 0; k < 200; k++) H._step(s, dt, null);
  ok(sum() < 0.05, `basin (9 tile-ft) drained by the tutorial canal in ${200 / 40} days (${b0.toFixed(1)} → ${sum().toFixed(3)})`);
  ok(H.networkAt(s, G) && H.networkAt(s, G).gates[0] === G, 'networkAt finds the gate');
  H.setStages(s, 0, 1.5); H._step(s, dt, null);
  ok(events.length === 1 && events[0].i === G, 'gate:closed on the live bus within one step');
  const d21 = s.tiles.depth[y * W + 21];
  for (let k = 0; k < 40; k++) H._step(s, 0, null, { relaxOnly: true });
  ok(H.surfaceAt(s, G) >= 6.5 && s.tiles.depth[y * W + 19] > 0.5 && Math.abs(s.tiles.depth[y * W + 21] - d21) < 1e-6, `closed gate re-enters the head (${H.surfaceAt(s, G).toFixed(2)}); bayou side fills (${s.tiles.depth[y * W + 19].toFixed(2)}), basin side untouched`);
  BSU.events.off(BSU.EV.GATE_CLOSED, off);
}

// --- scenario 5: hurricane-scale surge + rain, then save/load identity of the front --------------
{
  const s = synth(12);
  s.weather.dtDay = 1 / 360;
  const entry = []; for (let x = 20; x <= 27; x++) entry.push(63 * W + x);
  H.surgeControl(s, 'begin', { stage: 0, target: 8, entry, dir: 'S' });
  for (let t = 1; t <= 900; t++) {
    s.tick++;
    const rain = t <= 360 ? { r: 10 / 12 / 360, mapWide: true } : null;
    H._deps.weather = { consumeRainStep() { return rain; } };
    H.tick(s, { newDay: false });
    if (t <= 200) H.surgeControl(s, 'stage', 8 * t / 200);
    else if (t >= 500) H.surgeControl(s, 'stage', 8 * Math.max(0, 1 - (t - 500) / 250));
    if (t === 400) {
      const clone = BSU.deepClone(s);
      H.reset(clone, false);
      let same = true; for (let i = 0; i < N; i++) if (H.surgeFrontDistance(clone, i) !== H.surgeFrontDistance(s, i)) same = false;
      ok(same, 'front identical after a mid-landfall save/load');
      ok(H.floodedTiles(s) > 50, `floodedTiles rises during the set piece (${H.floodedTiles(s)})`);
      H.reset(s, false);   // back to the live root
    }
  }
  H._deps.weather = null;
  H.surgeControl(s, 'end');
  ok(s.hydro.surge === null && finite(s), 'no NaN after a Cat 3 landfall; surge cleared');
  const log = H.stormLog(s);
  ok(Array.isArray(log.held) && Array.isArray(log.overtopped) && Array.isArray(log.breached), 'stormLog shape');
  const after = H.floodedTiles(s);
  s.weather.dtDay = 1 / 40;
  for (let d = 0; d < 20; d++) { s.calendar.day++; H.tick(s, { newDay: true }); for (let k = 0; k < 40; k++) H._step(s, dt, null); }
  ok(H.floodedTiles(s) < after, `flooded tiles fall over the following weeks (${after} → ${H.floodedTiles(s)})`);
}

// --- scenario 6: robustness — bad inputs never throw, no state on the module ---------------------
{
  const s = synth(13);
  let threw2 = false;
  try {
    H.depthAt(s, -1, 999); H.surfaceAt(s, 1e9); H.stageAt(s, -5); H.drainsTo(s, NaN); H.riskAt(s, 'x');
    H.markCanal(s, 99999, true); H.markPond(s, null, 1, true); H.setStages(s, NaN, Infinity); H.forceSat(s, [1, 2, -3], 5);
    H.surgeControl(s, 'stage', 3); H.surgeControl(s, 'end'); H.surgeControl(s, 'begin', {}); H.surgeControl(s, 'end');
    H.forceRain(s, { inches: 1, steps: 0, radius: -1 }); H._step(s, NaN, null); H._step(s, dt, { r: NaN }); H.tick(s); H.spillway(s);
  } catch (e) { threw2 = e; }
  ok(!threw2, 'no exception escapes on bad inputs' + (threw2 ? ': ' + threw2.stack : ''));
  ok(finite(s), 'still no NaN after bad inputs');
  ok(typeof s.hydro.heldStage === 'number' && typeof s.hydro.spillwayOffset === 'number', 'lazily initialized saved keys present');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
