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
// issue spotlight pass: beacons (7.5, above lights) and spotlight (9.5, above overlays, below hud) + caps
ok(passes_.some((p) => p.name === 'beacons' && p.order === 7.5) && passes_.some((p) => p.name === 'spotlight' && p.order === 9.5), 'beacons@7.5 and spotlight@9.5 registered');
ok(typeof R.issueStats === 'function' && R.issueStats().max === 40 && R.issueStats().arrowsMax === 12 && typeof R.drawIssueGlyph === 'function', 'issueStats caps: ≤ 40 beacons, ≤ 12 arrows; drawIssueGlyph exported');
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
BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
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
// H2b: an HD building glows through its `bldlight:` companion (kind 'bld', the baked companion ref at the day sprite's master and anchor); the pen's centre blob is gone for HD rows.
// A fresh campus has one unfinished hall, so place a few rows, complete them (built = 1) and let the power / sky settle before the night frame.
{
  const SP = BSU.sprites; s.economy.cash = 5e7;
  for (const id of ['substation', 'wastewater', 'dorm', 'dining_hall']) { const sp = H.findSpot(id); if (sp) H.place(id, sp.x, sp.y); }
  for (const b of s.buildings) if (b) b.built = 1;
  H.tick(40); WX.scriptSky(s, SKY.NIGHT, 0.5); H.tick(40); for (let k = 0; k < 3; k++) H.render();
  const L = R.lightsList.slice(0, R.lightsCount()), blds = L.filter((l) => l.kind === 'bld'), wins = L.filter((l) => l.kind === 'window' && !l.refl);
  const hdTypes = (s.buildings || []).filter((b) => b && SP.isHDBuilding(b.type)).length;
  ok((R.drawList || []).some((e) => e && e.kind === 'building' && (e.variant & BSU.SPR.NIGHT)), 'the night frame draws buildings with the NIGHT variant');
  ok(/pushLight\('bld'/.test(src) && /L\.kind === 'bld'/.test(src), "render_fx pushes kind 'bld' and draws it from its companion ref");
  ok(blds.length > 0, `HD buildings in view at night push 'bld' lights (${blds.length}; ${hdTypes} HD buildings on the campus)`);
  ok(blds.every((l) => l.ref && l.ref.canvas && l.ref.hd && (l.ref.zoom === 1 || l.ref.zoom === 2) && Number.isFinite(l.ref.ox)), 'every bld entry carries a baked HD companion ref (canvas, master, anchor)');
  ok(blds.every((l) => Number.isFinite(l.cx) && Number.isFinite(l.cy) && l.cy < l.y), 'bld entries keep the window centre (cx, cy) for the puddle reflections');
  let aligned = 0, unmatched = 0;
  for (const l of blds) { const e = (R.drawList || []).find((d) => d && d.kind === 'building' && d.sx === l.x && d.sy === l.y && d.ref); if (!e) { unmatched++; continue; } if (l.ref.w === e.ref.w && l.ref.h === e.ref.h && l.ref.ox === e.ref.ox && l.ref.oy === e.ref.oy && l.ref.zoom === e.ref.zoom) aligned++; }
  ok(unmatched === 0 && aligned === blds.length, `every bld companion sits at its building's draw-list anchor with the day sprite's canvas, anchor and master (${aligned}/${blds.length})`);
  ok(wins.length === 0, `no centre light:window blob remains (every building row is HD now; ${wins.length} left)`);
  ok(BSU.errors.size === errs0, 'no BSU.error from the companion fetch');
}
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
// --- art pass B5: AO, splashes, puddles, steam, shimmer, fireworks, fog -----------------------
{
  ok(byName.fireworks && byName.fireworks.order > 8 && byName.fireworks.order < 8.5 && !byName.fireworks.builtin, "'fireworks' pass registered between fog (8) and storm (8.5)");
  ok(typeof R.groundFx === 'function' && typeof R.entityFx === 'function' && typeof R.fxStats === 'function' && typeof R._fxPuddleWet === 'function', 'B5 hooks exposed: groundFx / entityFx / fxStats / _fxPuddleWet');
  ok(R.fxOpts && ['ao', 'puddles', 'splashes', 'steam', 'shimmer', 'fireworks', 'fog', 'haze', 'reflect'].every((k) => R.fxOpts[k] === true), 'fxOpts: every B5 part is on by default');
  // fog strength through the day: strongest at dawn, burned off by 40 % of Day, back at dusk, steady at night
  const mf = R.mistFor;
  ok(mf(SKY.DAWN, 0) === 1 && Math.abs(mf(SKY.DAWN, 1) - 0.55) < 1e-9 && Math.abs(mf(SKY.DAY, 0) - 0.55) < 1e-9 && mf(SKY.DAY, 0.4) === 0 && mf(SKY.DAY, 0.9) === 0, 'mistFor: dawn 1 → .55, Day .55 → 0 by 40 %');
  ok(mf(SKY.GOLDEN, 0.5) === 0 && Math.abs(mf(SKY.DUSK, 1) - 0.6) < 1e-9 && mf(SKY.DUSK, 0) === 0 && mf(SKY.NIGHT, 0.5) === 0.6, 'mistFor: golden 0, dusk ramps to .6, night .6');
  let mono = true; for (let t = 0.05; t <= 1; t += 0.05) { if (mf(SKY.DAWN, t) > mf(SKY.DAWN, t - 0.05) + 1e-12 || mf(SKY.DAY, t) > mf(SKY.DAY, t - 0.05) + 1e-12) mono = false; }
  ok(mono && [0, 1, 2, 3, 4].every((ph) => [0, 0.3, 1, NaN].every((t) => Number.isFinite(mf(ph, t)))), 'mistFor thins monotonically through dawn and morning, always finite');
  // wetness setter clamps
  ok(R._fxPuddleWet(2) === 1 && R._fxPuddleWet(-1) === 0 && R._fxPuddleWet(0.5) === 0.5 && R._fxPuddleWet(NaN) === 0.5, '_fxPuddleWet clamps to 0–1 and ignores NaN');
  // puddles fill in rain and dry after
  R._fxReset(s); WX.scriptSky(s, SKY.DAY, 0.5); s.weather.rainRate = 0.8; s.weather.event = { kind: 'frontal', rate: 0.8 };
  for (let k = 0; k < 120; k++) H.render();
  const wetRain = R.fxStats().wet; ok(wetRain > 0.05 && wetRain <= 1, `wetness grows in rain (${wetRain.toFixed(3)})`);
  ok(R.fxStats().splashes >= 0 && R.fxStats().splashes <= 160, `splash pool within its cap (${R.fxStats().splashes} ≤ 160)`);
  s.weather.rainRate = 0; s.weather.event = null; for (let k = 0; k < 120; k++) H.render();
  ok(R.fxStats().wet < wetRain, 'puddles shrink after the rain stops');
  // contact AO (H5): the three round-capped strokes are baked once per geometry / zoom into a strip and blitted 1:1 per building (alpha = the sun / night amount); perf mode draws none
  const rec = { n: {}, blits: [] }; const g = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { rec.n[k] = (rec.n[k] || 0) + 1; if (k === 'drawImage') rec.blits.push({ a: t.globalAlpha, w: a[3], h: a[4] }); }), set: (t, k, v) => { t[k] = v; return true; } });
  const lib = s.buildings.find((b) => b && b.type === 'founders_hall'); ok(!!lib, "the Founders' Hall exists"); lib.built = 1;
  const ent = { kind: 'building', b: lib, variant: 0, sx: 400, sy: 300 };
  R._fxPuddleWet(0); H.render();
  const run = (sha, perf) => { rec.n = {}; rec.blits = []; R.groundFx(s, g, [], 0, { shAlpha: sha, perfMode: perf }); const f0 = rec.blits.length; rec.n = {}; R.entityFx(ent, g); return { blits: rec.blits.length - f0, st: rec.blits.slice(f0), fills: rec.n.fill || 0, strokes: rec.n.stroke || 0 }; };
  const day = run(0.22, false), night = run(0.07, false), perf = run(0.22, true), day2 = run(0.22, false);
  ok(day.blits === 1 && night.blits === 1 && day.fills === 0 && day.strokes === 0, `AO: one baked-strip blit per building, no fill / stroke at draw time (${day.blits} / ${night.blits} blits, ${day.strokes} strokes)`);
  ok(perf.blits === 0, 'perf mode draws no AO');
  ok(day.st[0].a > 0 && day.st[0].a <= 1 && night.st[0].a > 0 && night.st[0].a < day.st[0].a + 1e-9 && day.st[0].w > 20 && day.st[0].h > 8 && day2.st[0].w === day.st[0].w, `AO strip is a soft, fixed-size sprite scaled in alpha only (day ${day.st[0].a.toFixed(2)}, night ${night.st[0].a.toFixed(2)}, ${day.st[0].w.toFixed(0)} × ${day.st[0].h.toFixed(0)} px)`);
  const before = BSU.errors.size; R.entityFx({ kind: 'building', b: null, variant: 0, sx: 0, sy: 0 }, g); R.entityFx({ kind: 'building', b: lib, variant: BSU.SPR.RUIN, sx: 0, sy: 0 }, g);
  ok(BSU.errors.size === before, 'entityFx tolerates a missing building and ruins');
  // perf mode: no puddles, no AO, splash cap halves
  s.ui.perfMode = true; s.weather.rainRate = 0.8; R._fxPuddleWet(1); for (let k = 0; k < 10; k++) H.render();
  ok(R.fxStats().puddles === 0 && R.fxStats().aoOn === false, 'perfMode disables the puddles and the AO first');
  ok(R.fxStats().splashes <= 60, `perfMode caps the splashes at 60 (${R.fxStats().splashes})`);
  s.ui.perfMode = false; s.weather.rainRate = 0;
  // firework shells: capped at 8, expire after ~3 s of frames
  R._fxReset(s); for (let k = 0; k < 12; k++) R.addShell(1000, 700, 0, 120, 1);
  ok(R.fxStats().shells === 8, `firework shells capped at 8 (${R.fxStats().shells})`);
  for (let k = 0; k < 40; k++) H.render(); ok(R.fxStats().shells === 8, 'shells still burning after ~0.7 s');
  for (let k = 0; k < 200; k++) H.render(); ok(R.fxStats().shells === 0, 'every shell expired after ~4 s');
  // the milestone and score events queue shells / confetti without throwing
  const e0 = BSU.errors.size; R._fxReset(s); BSU.events.emit('milestone:earned', { id: 'firstBell' }); for (let k = 0; k < 80; k++) H.render(); BSU.events.emit('game:score', { side: 'home' }); for (let k = 0; k < 5; k++) H.render();
  ok(BSU.errors.size === e0 && R.fxStats().shells >= 1, `milestone view shells + home-score shell (${R.fxStats().shells} burning), no BSU.error`);
  R._fxReset(s);
}
// perf guardrail reaction
P.clear(); R.onPerfMode(s); P.emit('dust', 0, 0, 3000);
ok(P.count() <= BSU.params.render.particlesLow, `onPerfMode caps the pool at particlesLow (${P.count()} ≤ ${BSU.params.render.particlesLow})`);
R._fxReset(s); ok(P.count() === 0, '_fxReset clears the pool');
// calm alerts pass: the beacons pass draws the registry's capped, severity-gated list; the label of an in-progress row says so
try {
  const I = BSU.issues;
  ok(/I\.beacons\(|issBeaconList/.test(readFileSync(join(root, 'src', 'js', 'render_fx.js'), 'utf8')) && typeof I.beacons === 'function', 'the beacons / spotlight passes read issues.beacons');
  const sb = BSU.newState(5); sb.tick = 10; sb.economy.suppressCoverage = false; sb.economy.suspendCapPenalties = false; sb.economy.students = 0; sb.buildings = [];
  sb.plot = sb.plot || {}; sb.plot.founders = { tx: 30, ty: 30 }; sb.plot.highway = [];
  const row = BSU.data.catalog.dorm;
  for (let k = 0; k < 9; k++) sb.buildings[k] = { id: k, type: 'dorm', tx: 4 + k * 6, ty: 4, w: row.w, h: row.h, rot: 0, name: 'B' + k, hp: 1, built: 1, builtDay: 0, pilings: false, sunk: 0, powered: false, watered: true, provider: { power: -1, water: -1 }, flooded: false, floodedSince: -1, closedUntil: -1, blackout: false, tier: 0, upgradeDoneDay: -1, ruin: false, tarp: false };
  I.invalidate(); const lst = I.list(sb);
  ok(lst.filter((it) => it.kind === 'unpowered').length === 9 && lst.filter((it) => it.kind === 'unlinkedPath').length === 9, 'nine unpowered dorms + nine unlinked suggestions');
  const bl = I.beacons(sb, 4, 4); ok(bl.length === 6 && bl.every((it) => it.kind === 'unpowered'), 'issues.beacons: six, no suggestions');
  // a stub context that counts the discs the beacon pass draws (one arc per beacon foot + one per disc)
  let arcs = 0, texts = []; const gs = new Proxy({}, { get: (t, k) => { if (k === 'arc') return () => { arcs++; }; if (k === 'fillText') return (s2) => { texts.push(String(s2)); }; if (k === 'measureText') return () => ({ width: 10 }); if (k === 'createLinearGradient') return () => ({ addColorStop() {} }); return () => {}; }, set: () => true });
  const view = { vw: 1280, vh: 800 }; sb.ui.camera = sb.ui.camera || {}; sb.ui.camera.x = 0; sb.ui.camera.y = 0; sb.ui.camera.zoom = 0.5;
  const drawn = R._issueDraw.beacons(sb, gs, view, bl, null, performance.now());
  ok(drawn >= 1 && drawn <= 6 && arcs > 0, 'the beacon pass draws from the capped list, never more than beaconMax (' + drawn + ' on screen of ' + bl.length + ')');
  // the floating label of an in-progress row reads "In progress: …", not the fix
  sb.buildings[9] = Object.assign({}, sb.buildings[0], { id: 9, type: 'substation', tx: 4, ty: 9, w: BSU.data.catalog.substation.w, h: BSU.data.catalog.substation.h, built: 0.5, powered: true });
  I.invalidate(); const ip = I.list(sb).find((it) => it.kind === 'unpowered' && it.progress);
  ok(!!ip, 'a substation under construction puts a dorm in progress');
  if (ip) { I.select(ip.id); texts = []; sb.ui.camera.x = 0; sb.ui.camera.y = 0; sb.ui.camera.zoom = 1; const sel = I.selected(sb); const camTx = ((sel.anchor.tx | 0)); void camTx;
    R.panToTile ? R.panToTile(sel.anchor.tx, sel.anchor.ty, false) : null; const drew = R._issueDraw.label(sb, gs, view, sel);
    ok(drew === false || (texts.some((t) => /In progress:/.test(t)) && !texts.some((t) => /place a Substation/.test(t))), 'the label says "In progress: …" (' + (drew ? texts.filter((t) => /progress|Substation/.test(t)).join(' | ') : 'off-screen, no label') + ')'); I.select(null); }
  I.reset(sb);
} catch (e) { ok(false, 'calm alerts render_fx: ' + (e.stack || e)); }
// selfTest hook
// paths pass (Track P): the 'network' pass at 9.2 draws the sheen / amber dash / Campus hub badge while ui.networkView() and the dashed tie preview
try {
  const U = BSU.ui, B = BSU.buildings;
  ok(R.passes().some((p) => p.name === 'network' && p.order === 9.2 && !p.builtin), 'network@9.2 registered (after overlays 9, before spotlight 9.5)');
  ok(typeof R.tiePreview === 'function' && typeof R.tiePreviewSpec === 'function' && typeof R.networkStats === 'function' && R._network && typeof R._network.pass === 'function', 'tiePreview / networkStats / _network API');
  BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
  const sn = BSU.state; U.showTitle(false); U.settings().coachSeen = true;
  BSU.headless.tick(3); BSU.headless.render();
  let fills = 0, strokes = 0, texts = [], dashes = 0;
  const gs = new Proxy({}, { get: (t, k) => { if (k === 'fill') return () => { fills++; }; if (k === 'stroke') return () => { strokes++; }; if (k === 'setLineDash') return (d) => { if (d && d.length) dashes++; }; if (k === 'fillText') return (s2) => { texts.push(String(s2)); }; if (k === 'measureText') return () => ({ width: 60 }); if (k === 'createLinearGradient') return () => ({ addColorStop() {} }); return () => {}; }, set: () => true });
  const view = Object.assign({}, R.view);
  const f = sn.plot.founders; R.panToTile(f.tx, f.ty, false); BSU.headless.render();
  sn.ui.tool = null;
  R._network.pass(sn, gs, view); let ns = R.networkStats();
  ok(ns.sheen === 0 && ns.dashed === 0 && ns.badge === false && ns.tie === 0 && fills === 0, 'at rest (no N, no drag tool): nothing drawn');
  U.selectTool(sn, 'path');
  ok(U.networkView() === true, 'the path tool armed: ui.networkView()');
  R._network.pass(sn, gs, view); ns = R.networkStats();
  const conn = B.connectedMask(sn); let connectedInView = 0; for (let ty = Math.max(0, view.y0 | 0); ty <= Math.min(63, view.y1 | 0); ty++) for (let tx = Math.max(0, view.x0 | 0); tx <= Math.min(63, view.x1 | 0); tx++) { const i = ty * 64 + tx; if (conn[i] && sn.tiles.surface[i] > 0) connectedInView++; }
  ok(ns.sheen === connectedInView && ns.sheen > 0 && fills >= 1, 'the sheen covers every connected surface in view (' + ns.sheen + ')');
  ok(ns.badge === true && texts.indexOf('Campus hub') >= 0, 'the Campus hub badge over Founders\' Hall');
  // an unconnected run in view → the amber dash
  let lane = null; for (let ty = (view.y0 | 0) + 2; ty < (view.y1 | 0) - 2 && !lane; ty++) for (let tx = (view.x0 | 0) + 2; tx < (view.x1 | 0) - 2; tx++) { if (!BSU.inBounds(tx, ty)) continue; const i = ty * 64 + tx; if (sn.tiles.owner[i] === -1 && sn.tiles.surface[i] === 0 && !conn[i] && !BSU.nbr4(i).some((n) => conn[n]) && B.canPlace(sn, 'path', tx, ty, { ignoreCash: true }).ok) { lane = i; break; } }
  if (lane != null) {
    BSU.terrain.setSurface(sn, lane, BSU.SURF.PATH); B.tick(sn, {});
    fills = 0; strokes = 0; dashes = 0; R._network.pass(sn, gs, view); ns = R.networkStats();
    ok(ns.dashed >= 1 && dashes >= 1 && strokes >= 1, 'an unconnected path tile in view: the amber dash (' + ns.dashed + ')');
    BSU.terrain.setSurface(sn, lane, BSU.SURF.NONE); B.tick(sn, {});
  } else ok(true, 'no free tile for the amber-dash check (skipped)');
  // the tie preview draws its diamonds and the dashed centre line regardless of the network view
  U.selectTool(sn, null);
  R.tiePreview({ tiles: [f.ty * 64 + f.tx + 4, f.ty * 64 + f.tx + 5, (f.ty + 1) * 64 + f.tx + 5], surfaces: ['path', 'boardwalk', 'path'], snap: false, water: 1 });
  fills = 0; strokes = 0; dashes = 0; R._network.pass(sn, gs, view); ns = R.networkStats();
  ok(ns.tie === 3 && ns.sheen === 0 && fills >= 1 && strokes >= 3 && dashes >= 3, 'a 3-tile tie preview: diamonds, the plank dash and the dashed centre line (' + strokes + ' strokes)');
  R.tiePreview(null); ok(R.tiePreviewSpec() === null, 'tiePreview(null) clears it');
  R.tiePreview({ tiles: [] }); ok(R.tiePreviewSpec() === null, 'an empty tie clears it');
  // a whole frame through render with N held and a tie preview never throws or BSU.error
  const errs0 = (BSU.errors || []).length; U.keydown('n', { ctrl: false, shift: false, meta: false, alt: false }); R.tiePreview({ tiles: [f.ty * 64 + f.tx + 4], surfaces: ['path'], snap: true, water: 0 });
  BSU.headless.render(); BSU.headless.render(); U.keyup('n'); R.tiePreview(null); U.openPanel(null);
  ok((BSU.errors || []).length === errs0, 'frames with the network view + tie preview: no BSU.error');
} catch (e) { ok(false, 'paths pass render_fx: ' + (e.stack || e)); }

BSU.SELFTEST = true; let st; try { st = R.selfTest(); } finally { BSU.SELFTEST = false; }
ok(st && st.ok && /render_fx/.test(st.notes || ''), 'render.selfTest runs the render_fx tests: ' + (st && st.notes));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
