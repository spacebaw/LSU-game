// Unit test for src/js/sprites.js: loads contract.js (+ every earlier manifest module that exists),
// then sprites.js, through makeWindow() from test/domstub.mjs with vm.runInContext; runs
// BSU.sprites.selfTest() and the scenario checks from docs/briefs/sprites.md §9 "Done means".
// Usage: node test/unit/sprites.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import { loadavg } from 'node:os';
const BUSY = loadavg()[0] > 3;   // timing budgets are advisory when the machine is loaded
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
ok(BUSY || initMs < 400, `init ran in ${initMs.toFixed(1)} ms < 400 ms (${S.count()} entries)${BUSY ? ' [machine busy: budget advisory]' : ''}`);
ok(S.count() > 250, `init pre-baked ${S.count()} entries (> 250)`);

const errorsBefore = BSU.errors.size;
BSU.SELFTEST = true;
let st;
const t2 = performance.now();
try { st = S.selfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t2;
ok(st && st.ok === true, 'selfTest().ok === true — ' + (st && st.notes));
ok(BUSY || stMs < 200, `selfTest ran in ${stMs.toFixed(1)} ms < 200 ms${BUSY ? ' [machine busy: budget advisory]' : ''}`);
eq(BSU.errors.size, errorsBefore, 'selfTest did not grow BSU.errors');

// --- scenario 1: every terrain-side id resolves with the documented geometry ----
const g = (id, v, f, z) => S.get(id, v, f, z);
for (let t = 0; t < 8; t++) for (let v = 0; v < 8; v++) { const e = g('tile:' + t, v, 0, 1); if (!(e && e.sw === 64 && e.sh === 32 && e.ox === -32 && e.oy === -16)) ok(false, `tile:${t} v${v} 64×32 @(−32,−16)`); }
ok(true, 'tile:0..7 × 8 variants are 64×32 anchored at the diamond centre');
ok(g('tile:0', 8, 0, 1) && g('tile:0', 8, 0, 1) !== g('tile:0', 0, 0, 1) && g('tile:0', 8, 0, 1).sw === 64, 'shallow-bed bit 8 is its own 64×32 entry');
// art pass B1: ramps, decorations, shores
for (const n of ['grass', 'highGrass', 'dirt', 'clay', 'limestone', 'bark', 'marshMud', 'waterDeep', 'waterShallow', 'sand', 'mud', 'wet', 'reed', 'oakLeaf', 'cypressLeaf', 'cypressRust', 'palmLeaf', 'azaleaLeaf', 'azaleaBloom', 'moss']) { const r = S.ramp(n); const lum = (h) => { const c = S.hex(h); return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114; }; if (!(Array.isArray(r) && r.length === 5 && lum(r[0]) < lum(r[1]) && lum(r[1]) < lum(r[2]) && lum(r[2]) < lum(r[3]) && lum(r[3]) < lum(r[4]))) ok(false, `ramp ${n}: 5 tones, luminance rising`); }
ok(true, 'material ramps (13 terrain + 7 vegetation): 5 tones each, luminance strictly rising deep → highlight');
ok(S.ramp('nope') === S.ramp('grass') && S.ramp('grass')[2] === BSU.params.palette.dryGrass, 'ramp(): unknown → grass, base tone at index 2 is the palette colour');
ok(typeof S.vnoise === 'function' && [0, 3.3, 7, 12.5].every((x) => { const v = S.vnoise(5, x, x * 2, 8); return v >= 0 && v < 1; }) && S.vnoise(5, 3, 4, 8) === S.vnoise(5, 3, 4, 8), 'vnoise in [0,1), deterministic');
ok(Math.abs(S.vnoise(9, 4.5, 2, 8) - (S.vnoise(9, 4.4, 2, 8) + S.vnoise(9, 4.6, 2, 8)) / 2) < 0.05, 'vnoise is smooth (no lattice jumps)');
ok(g('tuft', 0, 0, 1).sw === 8 && g('tuft:high', 3, 0, 1).sh === 6 && g('tuft', 1, 0, 1).oy === -5, 'tuft 8×6 anchored at its base');
ok(['clover', 'dirt', 'lime'].every((k) => g('patch:' + k, 2, 0, 1) && g('patch:' + k, 2, 0, 1).sw === 16 && g('patch:' + k, 2, 0, 1).ox === -8), 'patch:clover/dirt/lime 16×8 centred');
ok([1, 2, 4, 8, 15].every((m) => g('shore:sand', m, 0, 1).sw === 64 && g('shore:mud', m, 0, 1).oy === -16 && g('shore:ripple', m, 0, 1).sh === 32), 'shore:sand/mud/ripple 64×32 at the tile anchor for every mask');
ok(g('tone:warm', 0, 0, 1).sw === 64 && g('tone:cool', 0, 0, 1).sw === 64 && g('tone:warm', 0, 0, 2).sw === 128, 'tone diamonds at 1× and 2×');
ok(g('worn', 4, 0, 1) && g('worn', 4, 0, 1) !== g('worn', 0, 0, 1), 'worn variant bit 4 (dirt tones for path-side wear) is a separate entry');
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
for (const n of ['sinking', 'noAccess', 'power', 'water', 'sandbags', 'debris']) ok(g('decal:' + n, 0, 0, 1) && g('decal:' + n, 0, 0, 1).sw === S.EXTRA_DECALS[n].w, 'extra decal ' + n);
for (const k of ['lamp', 'window', 'mast', 'beacon', 'blink', 'arc', 'glow', 'pot', 'fire', 'firefly', 'eye']) { const e = g('light:' + k, 0, 0, 1); if (!(e && e.sw === S.LIGHTS[k].w && e.sh === S.LIGHTS[k].h && e.ox === -(S.LIGHTS[k].w >> 1))) ok(false, 'light ' + k); }
ok(true, 'every light kind resolves at its size, anchored at the centre');
eq(g('light:mast', 0, 0, 1).sh, 96, 'mast cone is 48×96');

// --- scenario 3: vegetation sizes / anchors (entities-brief table) ----------
eq(g('oak', 2, 0, 1).sw, 96, 'oak stage 2 width 96'); eq(g('oak', 2, 0, 1).oy, -52, 'oak stage 2 oy −52');
eq(g('cypress', 2, 0, 1).sh, 80, 'cypress stage 2 height 80'); eq(g('cypress', S.treeVariant(2, true, false), 0, 1).sh, 80, 'autumn cypress');
eq(g('palmetto', 2, 0, 1).sw, 24, 'palmetto 24 wide'); eq(g('azalea', S.treeVariant(1, false, true), 0, 1).sh, 10, 'azalea bloom 16×10'); eq(g('azalea', 0, 0, 1).sw, 10, 'azalea stage 0 (shredded) 10×6');
// art pass B2: silhouette variants (bits 4–5), the cypress water bit (64), the knees tile overlay keyed by position, understory shrubs
eq(S.treeVariant(2, false, false, 3), 2 | 48, 'treeVariant packs the silhouette in bits 4–5'); eq(S.treeVariant(1, true, false, 1, true), 1 | 4 | 16 | 64, 'treeVariant packs autumn, silhouette and water'); eq(S.treeVariant(0, false, false, 7), 48, 'silhouette wraps to 0–3');
for (const stage of [0, 1, 2]) {
  const refs = [0, 1, 2, 3].map((sil) => g('oak', S.treeVariant(stage, false, false, sil), 0, 1));
  const same = refs.every((r) => r && r.sw === refs[0].sw && r.sh === refs[0].sh && r.ox === refs[0].ox && r.oy === refs[0].oy);
  const distinct = new Set(refs.map((r) => r && r.canvas)).size === 4 || new Set(refs.map((r) => r && (r.sx + ',' + r.sy))).size === 4;
  ok(same && distinct, `oak stage ${stage}: four silhouettes, one size and anchor (${refs[0] && refs[0].sw}×${refs[0] && refs[0].sh})`);
}
for (let sil = 0; sil < 4; sil++) { const r = g('cypress', S.treeVariant(2, false, false, sil, true), 0, 1); ok(r && r.sw === 24 && r.sh === 80 && r.oy === -76, `cypress silhouette ${sil} on water keeps 24×80, oy −76`); }
ok(g('cypress', S.treeVariant(2, true, false, 3), 0, 1) !== g('cypress', S.treeVariant(2, false, false, 3), 0, 1), 'November rust is its own cypress entry');
ok(g('palmetto', S.treeVariant(2, false, false, 1), 0, 1) !== g('palmetto', 2, 0, 1) && g('palmetto', S.treeVariant(2, false, false, 1), 0, 1).sw === 24, 'palmetto: two silhouettes, same size');
ok(g('azalea', S.treeVariant(2, false, true, 1), 0, 1).sh === 10 && g('azalea', S.treeVariant(2, false, true, 1), 0, 1).ox === -8, 'azalea bloom silhouette 1 keeps 16×10 anchored at the base');
{ const k0 = g('knees', 0, 0, 1), k9 = g('knees', 9, 0, 1), k63 = g('knees', 63, 0, 1); ok(k0 && k0.sw === 64 && k0.sh === 32 && k0.ox === -32 && k0.oy === -16, 'knees are a 64×32 tile overlay at (−32, −16)'); ok(k0 !== k9 && k9 !== k63, 'knees: position-bit variants are separate entries'); eq(S.frames('knees'), 1, 'knees 1 frame'); }
{ const r = g('shrub', 3, 0, 1); ok(r && r.sw === 22 && r.sh === 12 && r.ox === -11 && r.oy === -10, 'shrub 22×12 anchored at its base'); ok(g('shrub', 0, 0, 1) !== g('shrub', 1, 0, 1), 'shrub variants are separate entries'); eq(S.frames('shrub'), 1, 'shrub 1 frame'); }
ok(g('oak', 2, 0, 2) && g('oak', 2, 0, 2).sw === 192 && g('oak', 2, 0, 2).sh === 112 && g('oak', S.treeVariant(2, false, false, 2), 0, 2).sw === 192, 'oak 2× entries are pixel-doubles (192×112) for every silhouette');

// --- scenario 4: helpers, packing, determinism -----------------------------
eq(S.shade('#FDD023', 0.5), '#7E6811', 'shade rounding rule');
eq(S.mix('#000000', '#FFFFFF', 0.5), '#808080', 'mix rounding rule');
eq(S.hex('#FDD023').join(','), '253,208,35', 'hex → rgb');
ok(S.hash === BSU.rng.hash, 'hash === BSU.rng.hash');
ok(S.tileVariant(12, 40) >= 0 && S.tileVariant(12, 40) < 8 && S.tileVariant(12, 40) === S.tileVariant(12, 40) && new Set(Array.from({ length: 64 }, (_, k) => S.tileVariant(k & 7, k >> 3))).size >= 6, 'tileVariant ∈ 0..7, stable, spread');
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
