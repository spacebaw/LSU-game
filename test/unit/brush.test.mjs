// Unit test for src/js/brush.js (H0 pipeline pass): loads contract.js + every earlier manifest module through makeWindow()
// from test/domstub.mjs, then brush.js; checks the source rules (no filter / shadowBlur / Math.random), the module shape,
// the continuous ramp (knots equal the 5-tone ramps, luminance monotone in t for every material), the seam-stroke width per
// master, env, and that every primitive draws on the stub canvas at master 1 and 2 without throwing. Then selfTest.
// Usage: node test/unit/brush.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// --- source rules -----------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'brush.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
ok(!/ctx\.filter|\.shadowBlur|shadowColor/.test(code), 'no ctx.filter / shadowBlur (Safari < 18 / slow)');
ok(!/rng\.fx/.test(code), 'the brush never touches rng.fx');
ok(!/fillText|strokeText/.test(code), 'no text drawing in the brush');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
ok(manifest.indexOf('brush.js') === manifest.indexOf('sprites.js') + 1 && manifest.indexOf('brush.js') < manifest.indexOf('render.js'), 'manifest: brush.js right after sprites.js, before render.js');

// --- load -------------------------------------------------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
for (const f of manifest.slice(0, manifest.indexOf('brush.js') + 1)) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { if (f === 'contract.js' || f === 'data.js' || f === 'sprites.js' || f === 'brush.js') { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); } console.log('skip:', f, '(failed to load: ' + (e && e.message) + ')'); }
}
const BSU = win.BSU, B = BSU.brush, S = BSU.sprites;
ok(B && typeof B.selfTest === 'function', 'BSU.brush exists with selfTest');
for (const fn of ['tone', 'toneArr', 'css', 'mix', 'sat', 'ramp', 'env', 'rng', 'vnoise', 'fbm', 'pnoise', 'poly', 'bbox', 'centroid', 'diamond', 'smoothPath', 'seamWidth', 'seamStroke', 'plane', 'orb', 'softEllipse', 'microGrain', 'fillQuadShaded', 'roofPlane', 'column', 'groundTile', 'waterTile', 'path', 'tree', 'figure', 'shadow', 'light', 'glow', 'decal', 'cube', 'begin'])
  ok(typeof B[fn] === 'function', 'primitive ' + fn);
ok(BSU.params.art && BSU.params.art.hd && BSU.params.art.hd.chromeAtlasMB === 96 && BSU.params.art.hd.chromeChunkMB === 120 && BSU.params.art.hd.safariAtlasMB === 64 && BSU.params.art.hd.safariChunkMB === 80 && BSU.params.art.hd.bakeSliceMs === 4, 'params.art.hd carries the caps and the bake slice');

// --- the continuous ramp ------------------------------------------------------
const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
let knotsOk = true, monoOk = true, nMat = 0;
for (const name in S.RAMP_BASES) {
  nMat++; const base = S.RAMP_BASES[name], R = S.ramp(name);
  [-1, -0.5, 0, 0.5, 1].forEach((t, i) => { const got = B.toneArr(base, t), want = S.hex(R[i]); if (Math.abs(got[0] - want[0]) > 2 || Math.abs(got[1] - want[1]) > 2 || Math.abs(got[2] - want[2]) > 2) { knotsOk = false; console.error('knot', name, t, got, want); } });
  let prev = -1; for (let t = -1; t <= 1.0001; t += 1 / 32) { const l = lum(B.toneArr(base, t)); if (l < prev - 1) { monoOk = false; console.error('mono', name, t, l, prev); } prev = l; }
}
ok(knotsOk && nMat >= 20, `tone(c, t) at t = −1, −.5, 0, .5, 1 equals ramp tones 0–4 (≤ 2/255; ${nMat} materials)`);
ok(monoOk, 'luminance of tone(c, t) is monotone in t for every material within one level (a channel pinned at 255 may dip a hair under the warm tint, as the 5-tone ramp does)');
ok(B.toneArr('#808080', 0).join() === '128,128,128', 'tone(c, 0) is the base colour');
const dk = B.toneArr('#6E8F3C', -1), hi = B.toneArr('#6E8F3C', 1);
ok(dk[2] / Math.max(1, dk[0]) > 60 / 110 && hi[0] > hi[2], 'shadows lean cool (blue up), highlights lean warm (red up)');
ok(/^rgba\(\d+,\d+,\d+,(1|0?\.\d+)\)$/.test(B.tone('#6E8F3C', 0.3)) && /,0\.5\)$/.test(B.tone('#6E8F3C', 0.3, 0.5)), 'tone() returns rgba() strings with the alpha');
ok(B.ramp('grass') === S.RAMP_BASES.grass && B.ramp('#123456') === '#123456' && B.ramp('purple') === BSU.params.palette.purple, 'ramp(name) resolves materials, palette keys and hexes');

// --- env + seams ------------------------------------------------------------------
const e1 = B.env(1), e2 = B.env(2, { night: true, dpr: 2, originX: 512, originY: 416 });
ok(e1.master === 1 && e1.lod === 1 && e1.night === false && e1.dpr === 1 && e2.master === 2 && e2.lod === 0 && e2.night === true && e2.dpr === 2 && e2.originX === 512, 'env(master, o): master, lod (0 at 2, 1 at 1), night, dpr, origin');
ok(B.env(3).master === 1 && B.env(2, { lod: 1 }).lod === 1, 'env: an unknown master falls to 1; lod may be forced');
ok(Math.abs(B.seamWidth(e1) - 0.9) < 1e-9 && Math.abs(B.seamWidth(e2) - 0.45) < 1e-9 && Math.abs(B.seamWidth() - 0.9) < 1e-9, 'seam stroke: 0.9 art px at master 1, 0.45 at master 2 (0.9 device px either way)');
{ const c = S.newCanvas(4, 4), g = S.ctx2d(c); g.lineWidth = 5; B.seamStroke(g, B.diamond(32, 16), '#fff', e2); ok(Math.abs(g.lineWidth - 0.45) < 1e-9 && g.strokeStyle === '#fff' && g.lineJoin === 'round', 'seamStroke sets lineWidth = seamWidth(env), the tile\'s own fill, round joins'); }

// --- every primitive draws at master 1 and 2 ------------------------------------------
let drew = 0, threw = null;
for (const m of [1, 2]) {
  try {
    const c = S.newCanvas(1, 1), g = S.ctx2d(c), spec = { master: m, env: B.env(m) }, env = spec.env;
    const bg = B.begin(g, 100, 80, spec);
    ok(bg.w === 100 && bg.h === 80 && bg.S === m && c.width === 100 * m && c.height === 80 * m && bg.env === env, `begin() sizes the canvas ${100 * m}×${80 * m} at master ${m} and hands back the env`);
    B.groundTile(g, { cx: 50, cy: 40, kind: 'grass', seed: 1, dropS: 1, dropE: 0.5 }, env); B.groundTile(g, { cx: 50, cy: 40, kind: 'high', seed: 1 }, env); B.groundTile(g, { cx: 50, cy: 40, kind: 'marsh', seed: 2, pool: true }, env); B.groundTile(g, { cx: 50, cy: 40, kind: 'wet', seed: 2 }, env); B.groundTile(g, { cx: 50, cy: 40, kind: 'dirt', seed: 3 }, env);
    B.waterTile(g, { cx: 50, cy: 40, seed: 3, shore: { n: true, e: true, s: false, w: false }, dropS: 1 }, env); B.waterTile(g, { cx: 50, cy: 40, seed: 4, deep: true }, env);
    for (const mat of ['stucco', 'stone', 'wood', 'cloth', 'paint', 'metal', 'glass', 'glow']) for (const face of ['top', 'sw', 'se']) B.fillQuadShaded(g, [[10, 10], [60, 10], [60, 50], [10, 50]], '#F5ECD7', { face, material: mat }, env);
    for (const facing of ['nw', 'ne', 'sw', 'se']) { B.roofPlane(g, [[10, 60], [70, 60], [50, 30], [30, 30]], '#B5533C', { facing }, env); B.roofPlane(g, [[10, 60], [70, 60], [40, 30]], '#B5533C', { facing }, env); }
    B.column(g, 40, 70, 30, 3, '#F5ECD7', env);
    B.path(g, [[0, 70], [40, 60], [100, 75]], 12, env); B.path(g, [[0, 70], [100, 75]], 8, env, { material: 'asphalt' }); B.path(g, [[0, 70], [50, 60], [100, 75]], 8, env, { material: 'boardwalk' });
    B.tree(g, 50, 70, 'liveOak', { seed: 4 }, env); B.tree(g, 50, 70, 'cypress', { seed: 5, inWater: true, autumn: true }, env); B.tree(g, 50, 70, 'cypress', { seed: 6, stage: 0 }, env);
    for (const facing of ['sw', 'se', 'ne', 'nw']) B.figure(g, 50, 70, { facing, walk: 0.3, shirt: 'purple', seed: 6 }, env); B.figure(g, 50, 70, { facing: 'sw', walk: null, shirt: '#E8E8E8', trim: '#461D7C' }, env);
    B.shadow(g, { x: 50, y: 70, rx: 10, ry: 4, a: 0.3 }, env); B.shadow(g, { poly: [[0, 0], [10, 0], [10, 10]], soft: 4, a: 0.3 }, env);
    B.light(g, { x: 20, y: 20, r: 8, color: '#FFE2A0', a: 0.9, firefly: true }, env); B.light(g, { quad: [[10, 10], [20, 10], [20, 20], [10, 20]], color: '#FFD27A', halo: 10 }, env); B.light(g, { x: 20, y: 20, rx: 20, ry: 8, pool: true, color: '#FFD98A', a: 0.5 }, env);
    B.glow(g, [[10, 10], [20, 10], [20, 20], [10, 20]], null, env);
    B.decal(g, { x: 30, y: 30, w: 10, h: 6, shape: 'rect' }, env); B.decal(g, { x: 30, y: 30, w: 10, h: 10, shape: 'disc' }, env); B.decal(g, { x: 30, y: 30, w: 10, h: 10, shape: 'diamond', trim: null }, env);
    B.cube(g, 50, 60, 20, '#461D7C', env); B.orb(g, 10, 10, 5, 4, '#3B5A2A', 0.1, { spec: 0.3 }); B.softEllipse(g, 10, 10, 5, 4, '#000', 0.3); B.plane(g, [[0, 0], [10, 0], [10, 10]], '#F5ECD7', 0, { spec: 0.2 }); B.microGrain(g, [[0, 0], [10, 0], [10, 10]], 0.3, env);
    drew++;
  } catch (e) { threw = e; }
}
ok(drew === 2 && !threw, 'every primitive drew at master 1 and 2 on the stub canvas without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
ok(Math.abs(B.vnoise(1, 10.5, 20.5, 8) - S.vnoise(1, 10.5, 20.5, 8)) < 1e-12 && B.fbm(1, 10, 20, 16, 3) >= 0 && B.fbm(1, 10, 20, 16, 3) <= 1 && Math.abs(B.pnoise(2, 5, 7, 4, 64) - B.pnoise(2, 5 + 64, 7 - 128, 4, 64)) < 1e-12, 'vnoise is the atlas noise; fbm in [0, 1]; pnoise is periodic');
{ const r1 = B.rng(7), r2 = B.rng(7); let same = true; for (let i = 0; i < 20; i++) { const a = r1(), b = r2(); if (a !== b || a < 0 || a >= 1) same = false; } ok(same, 'rng(seed) is a deterministic [0, 1) stream'); }

// --- selfTest ---------------------------------------------------------------------
BSU.SELFTEST = true; let st = null;
try { st = B.selfTest(); } catch (e) { st = { ok: false, notes: String(e && e.stack || e) }; }
BSU.SELFTEST = false;
ok(st && st.ok === true, 'selfTest ok: ' + (st && st.notes));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
