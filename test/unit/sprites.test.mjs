// Unit test for src/js/sprites.js: loads contract.js (+ every earlier manifest module that exists),
// then sprites.js, through makeWindow() from test/domstub.mjs with vm.runInContext; runs
// BSU.sprites.selfTest() and the scenario checks from docs/briefs/sprites.md §9 "Done means".
// Usage: node test/unit/sprites.test.mjs   (exit 1 on any failure)
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
const src = readFileSync(join(root, 'src', 'js', 'sprites.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');   // comments stripped
ok(!/rng\.fx/.test(code), 'painters never touch rng.fx');
ok(!/fillText|strokeText|\.arc\(|lineTo\(/.test(code), 'no fillText / arc / lineTo (integer pixel art only)');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");

// --- load (contract + any existing manifest modules before sprites.js, skipping missing ones) ---
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
for (const f of manifest.slice(0, manifest.indexOf('sprites.js'))) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  // sprites.js depends only on contract.js + data.js; a sibling module that is broken or mid-write is skipped
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { if (f === 'contract.js' || f === 'data.js') throw e; console.log('skip:', f, '(failed to load: ' + (e && e.message) + ')'); }
}
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'sprites.js' }); } catch (e) { threw = e; }
const loadMs = performance.now() - t0;
ok(!threw, 'sprites.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(loadMs < 50, `definition time ${loadMs.toFixed(1)} ms < 50 ms`);
const BSU = win.BSU;
const S = BSU.sprites;
ok(S && typeof S.init === 'function' && typeof S.reset === 'function' && typeof S.selfTest === 'function' && !('tick' in S), 'module shape: init/reset/selfTest, no tick');
ok(S.palette === BSU.params.palette, 'sprites.palette is BSU.params.palette');
for (const fn of ['get', 'registerPainter', 'agentLook', 'memoryMB', 'frames', 'size', 'hex', 'rgb', 'shade', 'mix', 'hash', 'tileVariant', 'diamond', 'dither', 'px', 'newCanvas', 'gc', 'getCached', 'pen', 'begin', 'treeVariant', 'glyph'])
  ok(typeof S[fn] === 'function', 'public function ' + fn);
eq(S.CANVAS_LIMIT_MB, 8, 'CANVAS_LIMIT_MB');
ok(Array.isArray(S._tests), '_tests hook array for the split files');

// --- init timing + selfTest ---------------------------------------------------
const t1 = performance.now();
S.init(BSU.newState(1));
const initMs = performance.now() - t1;
ok(initMs < 400, `init ran in ${initMs.toFixed(1)} ms < 400 ms (${S.count()} entries)`);
ok(S.count() > 250, `init pre-baked ${S.count()} entries (> 250)`);

const errorsBefore = BSU.errors.size;
BSU.SELFTEST = true;
let st;
const t2 = performance.now();
try { st = S.selfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t2;
ok(st && st.ok === true, 'selfTest().ok === true — ' + (st && st.notes));
ok(stMs < 200, `selfTest ran in ${stMs.toFixed(1)} ms < 200 ms`);
eq(BSU.errors.size, errorsBefore, 'selfTest did not grow BSU.errors');

// --- scenario 1: every terrain-side id resolves with the documented geometry ----
const g = (id, v, f, z) => S.get(id, v, f, z);
for (let t = 0; t < 8; t++) for (let v = 0; v < 3; v++) { const e = g('tile:' + t, v, 0, 1); if (!(e && e.sw === 64 && e.sh === 32 && e.ox === -32 && e.oy === -16)) ok(false, `tile:${t} v${v} 64×32 @(−32,−16)`); }
ok(true, 'tile:0..7 × 3 variants are 64×32 anchored at the diamond centre');
const surfShapes = [];
for (let s = 1; s <= 4; s++) for (let m = 0; m < 16; m++) { const e = g('surf:' + s, m, 0, 1); surfShapes.push(!!(e && e.sw === 64 && e.sh === 48 && e.oy === -24)); }
ok(surfShapes.every(Boolean), 'surf:1..4 × 16 masks are 64×48 anchored (−32, −24)');
ok(g('surf:2', 21, 0, 1) && g('surf:4', 35, 0, 1) && g('surf:1', 74, 0, 1) && g('surf:3', 16 | 15, 0, 1), 'bridge / sign / culvert variant bits resolve');
ok(g('levee', 5, 0, 1).sh === 48 && g('levee', 5 | 16, 0, 1).oy === -28, 'levee 64×48 rising 12 px (oy −28), cracked variant');
ok(g('floodwall', 10, 0, 1).sh === 54 && g('floodwall', 10, 0, 1).oy === -36, 'floodwall rises 18 px (oy −36)');
ok(g('canal', 5, 0, 1).sh === 32 && g('canal', 5 | 32, 0, 1) && g('canal', 5 | 32 | 64, 0, 1) && g('canal', 15 | 16, 0, 1), 'canal masks, gate open/closed, culvert');
ok([6, 12, 18, 24, 36, 48, 96].every(h => { const s = g('cliff', h, 0, 1), e = g('cliff', h, 1, 1); return s && e && s.sw === 32 && s.sh === h + 16 && s.ox === -32 && e.ox === 0; }), 'cliff faces 32×(h+16), south ox −32 / east ox 0');
ok(g('water', 0, 0, 1).sw === 64 && g('water', 1, 0, 1).sw === 64, 'water highlight + surge tint');
ok(g('mound', 0, 0, 1).ox === -12 && g('mound', 0, 0, 1).oy === -20, 'mound anchor (−12, −20)');

// --- scenario 2: decals + lights match the data tables ------------------------
const D = BSU.data;
if (D && D.decals) {
  const bad = Object.keys(D.decals).filter(n => { const e = g('decal:' + n, 0, 0, 1); return !(e && e.sw === D.decals[n].w && e.sh === D.decals[n].h); });
  eq(bad.join(','), '', `every data.decals name resolves at its data size (${Object.keys(D.decals).length} decals)`);
  ok(Object.keys(D.decals).every(n => S.frames('decal:' + n) === Math.max(1, D.decals[n].frames)), 'decal frame counts come from data');
  const cr = D.decals.crane.frames; ok(g('decal:crane', 0, cr + 1, 1) === g('decal:crane', 0, 1, 1), 'decal frames wrap');
} else console.log('skip: data.js absent — decal table checks');
for (const n of ['sinking', 'noAccess', 'power', 'water', 'sandbags']) ok(g('decal:' + n, 0, 0, 1) && g('decal:' + n, 0, 0, 1).sw === S.EXTRA_DECALS[n].w, 'extra decal ' + n);
for (const k of ['lamp', 'window', 'mast', 'beacon', 'blink', 'arc', 'glow', 'pot', 'fire', 'firefly', 'eye']) { const e = g('light:' + k, 0, 0, 1); if (!(e && e.sw === S.LIGHTS[k].w && e.sh === S.LIGHTS[k].h && e.ox === -(S.LIGHTS[k].w >> 1))) ok(false, 'light ' + k); }
ok(true, 'every light kind resolves at its size, anchored at the centre');
eq(g('light:mast', 0, 0, 1).sh, 96, 'mast cone is 48×96');

// --- scenario 3: vegetation sizes / anchors (entities-brief table) ----------
eq(g('oak', 2, 0, 1).sw, 96, 'oak stage 2 width 96'); eq(g('oak', 2, 0, 1).oy, -52, 'oak stage 2 oy −52');
eq(g('cypress', 2, 0, 1).sh, 80, 'cypress stage 2 height 80'); eq(g('cypress', S.treeVariant(2, true, false), 0, 1).sh, 80, 'autumn cypress');
eq(g('palmetto', 2, 0, 1).sw, 24, 'palmetto 24 wide'); eq(g('azalea', S.treeVariant(1, false, true), 0, 1).sh, 10, 'azalea bloom 16×10'); eq(g('azalea', 0, 0, 1).sw, 10, 'azalea stage 0 (shredded) 10×6');

// --- scenario 4: helpers, packing, determinism -----------------------------
eq(S.shade('#FDD023', 0.5), '#7E6811', 'shade rounding rule');
eq(S.mix('#000000', '#FFFFFF', 0.5), '#808080', 'mix rounding rule');
eq(S.hex('#FDD023').join(','), '253,208,35', 'hex → rgb');
ok(S.hash === BSU.rng.hash, 'hash === BSU.rng.hash');
ok([0, 1, 2].includes(S.tileVariant(12, 40)) && S.tileVariant(12, 40) === S.tileVariant(12, 40), 'tileVariant ∈ {0,1,2}, stable');
const looks = Array.from({ length: 100 }, (_, i) => S.agentLook(i));
ok(looks.every(l => (l & 7) < 6 && ((l >> 3) & 7) < 8 && (l >> 6) < 3), 'agentLook packs skin<6, hair<8, shirt<3');
ok(looks.join() === Array.from({ length: 100 }, (_, i) => S.agentLook(i)).join(), 'agentLook deterministic');
ok(S.get('tile:2', 1, 0, 1) === S.get('tile:2', 1, 0, 1), 'cache hit returns the same SpriteRef object');
eq(S.get('reeds', 0, 5, 1), S.get('reeds', 0, 1, 1), 'frame 5 of a 2-frame sprite wraps to 1');

// --- scenario 5: robustness — never throws, unknown → null once -------------
let thrown = false;
try { S.get('nope:thing'); S.get(''); S.get(42); S.get({}); S.get('tile:9', Infinity, NaN, -3); S.get('decal:doesNotExist'); S.size('nonsense'); S.frames(null); S.gc(NaN); } catch (e) { thrown = true; }
ok(!thrown, 'get/size/frames/gc never throw on garbage input');
eq(S.get('nope:thing'), null, "get('nope:thing') → null");
eq(S.get('decal:doesNotExist'), null, 'unknown decal → null (painter threw once, cached)');
ok(BSU.errors.size > errorsBefore, 'unknown ids reported through BSU.error (once per id)');
const errsNow = BSU.errors.size; S.get('nope:thing'); S.get('nope:thing'); eq(BSU.errors.size, errsNow, 'repeat unknown id does not add a new error signature');
eq(S.size('nonsense').w, 0, 'size() of an unknown id is {0,0}');

// --- scenario 6: zoom, memory, gc ------------------------------------------
const one = S.get('tile:4', 0, 0, 1);
ok(S.get('tile:4', 0, 0, 0.5) === one, 'zoom 0.5 returns the 1× entry');
const two = S.get('tile:4', 0, 0, 2);
ok(two && two.sw === 128 && two.sh === 64 && two.ox === -64 && two.oy === -32, '2× entry is 128×64 anchored (−64, −32)');
ok(S.memoryMB() > 0 && S.memoryMB() <= 8, `memoryMB ${S.memoryMB().toFixed(2)} within the 8 MB budget after init + a 2× entry`);
ok(S.gc(1000) === 0, 'gc below the budget drops nothing');
const before = S.count();
S.registerPainter('unittest', (c, spec) => { S.begin(c, 4, 4, spec.zoom); return { w: 4, h: 4, ox: -2, oy: -2 }; });
ok(S.get('unittest', 0, 0, 1) && S.get('unittest', 0, 0, 1).sw === 4 && S.count() === before + 1, 'registerPainter at runtime + lazy entry');
S.registerPainter('unittest', (c, spec) => { S.begin(c, 6, 6, spec.zoom); return { w: 6, h: 6, ox: -3, oy: -3 }; });
eq(S.get('unittest', 0, 0, 1).sw, 6, 're-registering a family invalidates its cached entries (last registration wins)');
S.registerPainter('boom', () => { throw new Error('painter exploded'); });
eq(S.get('boom', 0, 0, 1), null, 'a painter that throws yields null');
eq(S.get('boom', 0, 0, 1), null, '…and is cached as null (fails once, not every frame)');

// --- scenario 7: reset keeps the atlas ------------------------------------
const n0 = S.count(); S.reset(BSU.newState(2), true); S.reset(BSU.newState(3), false);
eq(S.count(), n0, 'reset(fresh true/false) keeps every atlas entry');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
