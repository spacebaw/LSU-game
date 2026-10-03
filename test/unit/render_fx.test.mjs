// Unit test for src/js/render_fx.js: loads every existing manifest module through makeWindow() from
// test/domstub.mjs (session.js boots the game), then checks the registered passes, the particle pool
// (API, caps, screen vs world, perf cap), the tint table for every sky phase, and that frames at night
// in rain, under lightning/pulse/income events and through a forced landfall never throw or BSU.error.
// Usage: node test/unit/render_fx.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

// --- source rules -----------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'render_fx.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
ok(!/setTimeout|setInterval|requestAnimationFrame/.test(src.replace(/\/\/.*$/gm, '')), 'no timers / rAF');
ok(!/new OffscreenCanvas/.test(src), 'no OffscreenCanvas');

// --- load every existing module in manifest order ----------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
let defMs = 0;
for (const f of manifest) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  const t0 = performance.now();
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); }
  if (f === 'render_fx.js') defMs = performance.now() - t0;
}
ok(defMs < 30, `render_fx.js definition time ${defMs.toFixed(1)} ms < 30 ms`);
const BSU = win.BSU, R = BSU.render, SKY = BSU.SKY;

// --- passes -------------------------------------------------------------------
const passes_ = R.passes();
const byName = Object.fromEntries(passes_.map((p) => [p.name, p]));
ok(byName.weather && byName.weather.order === 5 && !byName.weather.builtin, "'weather' registered at 5");
ok(byName.tint && byName.tint.order === 6 && !byName.tint.builtin, "'tint' replaced render's fallback at 6");
ok(byName.lights && byName.lights.order === 7, "'lights' registered at 7");
ok(byName.fog && byName.fog.order === 8, "'fog' registered at 8");
ok(byName.overlays && byName.hud, "render's built-in 'overlays' and 'hud' kept");
ok(byName.storm && byName.storm.order > 8 && byName.storm.order <= 9 && byName.fxhud && byName.fxhud.order > 10, "'storm' (world) and 'fxhud' (screen) extras");
for (const fn of ['_fxInit', '_fxReset', 'onPerfMode', 'cone', 'crowd', 'mosqBand', 'tintFor', 'rainLineCount', 'lightsCount']) ok(typeof R[fn] === 'function', 'render_fx exposes ' + fn);
ok(Array.isArray(R.lightsList), 'lightsList array');

// --- particle pool --------------------------------------------------------------
const P = R.particles;
ok(P && ['emit', 'count', 'clear', 'forEachWorld'].every((k) => typeof P[k] === 'function'), 'particles API');
P.clear(); ok(P.count() === 0, 'clear → 0');
P.emit('dust', 100, 100, 10); ok(P.count() === 10, 'emit 10 dust → count 10');
let seen = 0, finite = true; P.forEachWorld((x, y, z, size, col, type) => { seen++; if (![x, y, z, size].every(Number.isFinite) || type !== 'dust') finite = false; });
ok(seen === 10 && finite, 'forEachWorld visits 10 finite world particles with the type name');
P.emit('confetti', 50, 50, 3, { screen: true }); seen = 0; P.forEachWorld(() => seen++);
ok(P.count() === 13 && seen === 10, 'screen particles counted but not visited');
P.emit('sparks', 0, 0, 3000); ok(P.count() <= BSU.params.render.particlesMax, `cap respected (${P.count()} ≤ ${BSU.params.render.particlesMax})`);
P.emit('nope', 0, 0, 5); P.emit('dust', NaN, 0, 5); ok(P.count() <= BSU.params.render.particlesMax, 'unknown type / NaN position ignored');
P.clear();

// --- tint for each sky phase --------------------------------------------------------
let tintOk = true;
for (const ph of [SKY.DAWN, SKY.DAY, SKY.GOLDEN, SKY.DUSK, SKY.NIGHT]) for (const t of [0, 0.5, 0.8, 1]) { const o = R.tintFor(ph, t); if (!Number.isFinite(o.a1) || !Number.isFinite(o.a2) || o.a1 < 0 || o.a2 < 0 || o.a1 > 1 || o.a2 > 1) tintOk = false; }
ok(tintOk, 'tintFor returns finite 0–1 alphas for every phase × t');
const tn = R.tintFor(SKY.NIGHT, 0.5); ok(tn.c1 === '#0E1230' && Math.abs(tn.a1 - 0.62) < 1e-9, 'night tint #0E1230 at .62');
const td = R.tintFor(SKY.DAY, 0.5); ok(td.a1 === 0 && td.a2 === 0, 'day has no tint');
ok(R.rainLineCount(0, 1, false) === 0 && R.rainLineCount(0.5, 1, false) === 750 && R.rainLineCount(1, 0.5, false) <= 400 && R.rainLineCount(1, 1, true) <= 600, 'rain line counts (0 / 750 / ≤400 at 0.5× / ≤600 in perfMode)');
ok(R.mosqBand(0.1) === 0 && R.mosqBand(0.2) === 1 && R.mosqBand(0.5) === 2 && R.mosqBand(0.7) === 3 && R.mosqBand(0.9) === 4, 'mosquito bands');

// --- frames: night + rain + fog + events never throw ---------------------------------
BSU.session.newGame({ seed: 42, skipTutorial: true });
const s = BSU.state, H = BSU.headless, WX = BSU.weather;
const errs0 = BSU.errors.size;
let threw = null;
try {
  WX.scriptSky(s, SKY.NIGHT, 0.5);
  s.weather.rainRate = 0.8; s.weather.wind = 0.6; s.weather.windAngle = 1.2; s.weather.fog = 0.4; s.wildlife.fireflies = 200;
  for (let k = 0; k < 6; k++) H.render();
} catch (e) { threw = e; }
ok(!threw && BSU.errors.size === errs0, 'six night frames in rain + fog: no throw, no BSU.error' + (threw ? ': ' + threw.stack : ''));
ok(R.lightsCount() > 0 && R.lightsCount() <= BSU.params.render.lightsMax, `lights gathered at night (${R.lightsCount()} ≤ ${BSU.params.render.lightsMax})`);
let sorted = true; for (let k = 1; k < R.lightsCount(); k++) if (R.lightsList[k - 1].d > R.lightsList[k].d) sorted = false;
ok(sorted, 'lights sorted nearest-to-camera first');
ok(P.count() > 0, `per-frame emitters populated the pool at night in rain (${P.count()} particles)`);
threw = null;
try {
  const f = s.plot.founders;
  BSU.events.emit('weather:lightning', { tx: f.tx, ty: f.ty });
  BSU.events.emit('storm:pulse', {});
  BSU.events.emit('econ:income', { key: 'tuition', amount: 600000, i: f.ty * 64 + f.tx });
  BSU.events.emit('game:score', { side: 'home' });
  BSU.events.emit('milestone:earned', { id: 'firstBell' });
  BSU.events.emit('levee:overtop', { i: f.ty * 64 + f.tx });
  for (let k = 0; k < 4; k++) H.render();
  for (const ph of [SKY.DAWN, SKY.DAY, SKY.GOLDEN, SKY.DUSK]) { WX.scriptSky(s, ph, 0.9); H.render(); }
  s.weather.heat = 101; WX.scriptSky(s, SKY.DAY, 0.5); H.render();
  WX.releaseSky(s);
} catch (e) { threw = e; }
ok(!threw && BSU.errors.size === errs0, 'event FX (lightning, pulse, income, score, milestone, overtop) + every phase: no throw, no BSU.error' + (threw ? ': ' + threw.stack : ''));
threw = null;
try {
  H.forceHurricane(3);
  let reached = false;
  for (let k = 0; k < 400 && !reached; k++) { H.tick(10); H.render(); if (s.setPiece && s.setPiece.kind === 'landfall' && s.setPiece.tick >= 300) reached = true; }
  ok(reached, 'reached the landfall set piece');
  for (let k = 0; k < 5; k++) { H.tick(20); H.render(); }
  H.tick(3000); H.render();
} catch (e) { threw = e; }
ok(!threw && BSU.errors.size === errs0, 'frames through a Cat 3 landfall and after: no throw, no BSU.error' + (threw ? ': ' + threw.stack : ''));
// perf guardrail reaction
P.clear(); R.onPerfMode(s); P.emit('dust', 0, 0, 3000);
ok(P.count() <= BSU.params.render.particlesLow, `onPerfMode caps the pool at particlesLow (${P.count()} ≤ ${BSU.params.render.particlesLow})`);
R._fxReset(s); ok(P.count() === 0, '_fxReset clears the pool');
// selfTest hook
BSU.SELFTEST = true; let st; try { st = R.selfTest(); } finally { BSU.SELFTEST = false; }
ok(st && st.ok && /render_fx/.test(st.notes || ''), 'render.selfTest runs the render_fx tests: ' + (st && st.notes));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
