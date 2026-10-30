// Unit test for src/js/sprites_vegetation_hd.js (H3 vegetation pass): loads the manifest up to sprites_terrain.js through makeWindow() from
// test/domstub.mjs with vm.runInContext, snapshots the PEN painters' cells / anchors / frame counts for oak, cypress, palmetto, azalea and
// shrub (every stage, silhouette, season and water bit), then loads sprites_vegetation_hd.js over them and asserts: the source rules (brush
// calls only, registerHD only, manifest position), every family bakes at master 1 and 2 on the stub canvas without throwing or raising BSU.error
// with the pen's cell, trunk-base anchor and frame count, the variant bits are honoured (autumn rust, azalea bloom, the water base, silhouettes,
// the H3 jitter bits 7–8), the lod branches (master 2 draws the clumps, flecks, moss strands and individual blossoms that master 1 drops;
// the bloom survives as soft masses), brush.tree draws the cached cells, treeVariant's packing, render's fetch rule (HD at hdMaster, the jitter
// bits passed), the atlas bytes, determinism, and the selfTest.
// Usage: node test/unit/vegetation_hd.test.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const BUSY = loadavg()[0] > 3;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// --- source rules -----------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'sprites_vegetation_hd.js'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
ok(!/Math\.random/.test(code) && !/rng\.fx/.test(code), 'no Math.random / rng.fx');
ok(!/createLinearGradient|createRadialGradient|createPattern/.test(code), 'no hand-written gradients or patterns (brush calls only, ART_STYLE §3)');
ok(!/fillText|strokeText/.test(code), 'no text');
ok(/M\.registerHD\(fam, PAINT\[fam\]\)/.test(code) && !/registerPainter\(/.test(code), 'registers every family through registerHD only');
ok(!/<\/script/i.test(src), 'no "</script" in source');
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
const mi = manifest.indexOf('sprites_vegetation_hd.js');
ok(mi > manifest.indexOf('sprites.js') && mi > manifest.indexOf('brush.js') && mi === manifest.indexOf('sprites_terrain.js') + 1 && mi < manifest.indexOf('sprites_buildings_hd.js'), 'manifest: sprites_vegetation_hd.js loads after sprites.js, brush.js and sprites_terrain.js (so it re-registers the pen vegetation painters) and before the building painters that call brush.tree');
const renderSrc = readFileSync(join(root, 'src', 'js', 'render.js'), 'utf8');
ok(/function getRef\(id, variant, frame\) \{ const sp = S\(\); const r = sp\.get\(id, variant, frame, \(hdOn && sp\.isHD\(id\)\) \? hdMaster : atlasZoom\)/.test(renderSrc), 'render.getRef asks an HD family at hdMaster (the tree entities fetch through it, so nothing in render changed for the master)');
ok(/e\.ref = getRef\(v\.type, variant, 0\)/.test(renderSrc) && /sp\.treeVariant\(stage, info\.autumn && v\.type === 'cypress', info\.bloom && v\.type === 'azalea', hv & 3, wet, \(hv >> 2\) & 3\)/.test(renderSrc), 'render: a tree entity fetches getRef(type, variant, 0) with the silhouette (hv & 3) and the H3 jitter ((hv >> 2) & 3)');
ok(/hdMaster = !hdOn \? /.test(renderSrc) && /tref\(id, variant, frame\)/.test(renderSrc) && /tref\('shrub', hs & 3, 0, 1\)/.test(renderSrc), 'render: the marsh-edge shrub is a chunk-baked tref (HD families at the chunk master)');

// --- load the pen first, snapshot its geometry -------------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const upTo = manifest.indexOf('sprites_terrain.js');
for (const f of manifest.slice(0, upTo + 1)) vm.runInContext(readFileSync(join(root, 'src', 'js', f), 'utf8'), ctx, { filename: f });
const BSU = win.BSU, S = BSU.sprites, B = BSU.brush;
const errs = () => (BSU.errors ? BSU.errors.size : 0);
const tv = S.treeVariant;
const IDS = [];
for (let st = 0; st < 3; st++) for (let sil = 0; sil < 4; sil++) {
  IDS.push(['oak', tv(st, false, false, sil)]);
  for (const au of [false, true]) for (const wa of [false, true]) IDS.push(['cypress', tv(st, au, false, sil, wa)]);
  for (const bl of [false, true]) IDS.push(['azalea', tv(st, false, bl, sil)]);
  if (sil < 2) IDS.push(['palmetto', tv(st, false, false, sil)]);
}
for (let v = 0; v < 4; v++) IDS.push(['shrub', v]);
const penGeo = {};
for (const [id, v] of IDS) for (const z of [1, 2]) { const e = S.get(id, v, 0, z); penGeo[id + '|' + v + '|' + z] = e ? { sw: e.sw, sh: e.sh, ox: e.ox, oy: e.oy, n: S.frames(id, v) } : null; }
ok(Object.values(penGeo).every((g) => g && g.sw > 0), 'the pen bakes every vegetation id (' + Object.keys(penGeo).length + ' entries snapshotted)');
ok(!S.isHD('oak') && !S.isHD('cypress') && !S.isHD('palmetto') && !S.isHD('azalea') && !S.isHD('shrub') && typeof S.hdVegetationFamilies !== 'function', 'before the HD module the vegetation families are pen painters');
ok(tv(2, true, false) === 6 && tv(1, false, true) === 9 && tv(2, false, false, 3, true) === (2 | 48 | 64) && tv(2, false, false, 3, true, 3) === (2 | 48 | 64 | 384) && tv(0, false, false, 0, false, 5) === 128 && S.TREE_JIT_SHIFT === 7, 'treeVariant keeps its packing and adds the jitter in bits 7–8 (a 6th argument, masked to 2 bits)');
S.clear();

// --- load the HD module over the pen ---------------------------------------
const e0 = errs();
let threw = null; const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'sprites_vegetation_hd.js' }); } catch (e) { threw = e; }
const loadMs = performance.now() - t0;
ok(!threw, 'sprites_vegetation_hd.js loads over the pen without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(loadMs < 60 || BUSY, `definition time ${loadMs.toFixed(1)} ms < 60 ms` + (BUSY ? ' (advisory: loadavg > 3)' : ''));
const FAM = S.hdVegetationFamilies();
ok(FAM.length === 5 && FAM.join() === 'oak,cypress,palmetto,azalea,shrub' && FAM.every((f) => S.isHD(f)), '5 vegetation families are HD-registered: ' + FAM.join(','));
ok(S.isHD('oak:x') === true && !S.isHD('gate') && !S.isHD('agent') && !S.isHD('reeds:0') === false, 'oak / cypress / palmetto / azalea / shrub are HD; the terrain and character families are not this module\'s');
ok(Object.isFrozen(S.hdVegetationCells) && S.hdVegetationCells.oak.length === 3 && S.hdVegetationCells.oak[2].join() === '96,56' && S.hdVegetationCells.cypress[2].join() === '24,80', 'public: hdVegetationCells (frozen) carries the pen cells');

// --- every family × variant × master bakes with the pen's geometry ------------
let bad = [], baked = 0;
for (const [id, v] of IDS) for (const z of [1, 2]) {
  const e = S.get(id, v, 0, z), g = penGeo[id + '|' + v + '|' + z]; baked++;
  if (!e) { bad.push(id + ' v' + v + ' z' + z + ' null'); continue; }
  if (!e.hd) bad.push(id + ' v' + v + ' z' + z + ' not hd');
  if (!g || e.sw !== g.sw || e.sh !== g.sh || e.ox !== g.ox || e.oy !== g.oy) bad.push(id + ' v' + v + ' z' + z + ' geometry ' + JSON.stringify([e.sw, e.sh, e.ox, e.oy]) + ' vs pen ' + JSON.stringify(g && [g.sw, g.sh, g.ox, g.oy]));
  if (g && S.frames(id, v) !== g.n) bad.push(id + ' frames ' + S.frames(id, v) + ' vs pen ' + g.n);
}
ok(bad.length === 0, baked + ' bakes: every family × stage × silhouette × season × water bit × master 1 + 2 keeps the pen\'s cell, trunk-base anchor and frame count' + (bad.length ? ' — ' + bad.slice(0, 6).join('; ') : ''));
eq(errs(), e0, 'no BSU.error while baking every vegetation variant');
let badJ = [];
for (const id of ['oak', 'cypress', 'azalea', 'palmetto']) for (let st = 0; st < 3; st++) for (let jit = 0; jit < 4; jit++) for (const z of [1, 2]) {
  const e = S.get(id, tv(st, false, false, 1, false, jit), 0, z), g = penGeo[id + '|' + tv(st, false, false, 1) + '|' + z];
  if (!e || !g || e.sw !== g.sw || e.sh !== g.sh || e.oy !== g.oy) badJ.push(id + ' st' + st + ' j' + jit + ' z' + z);
}
ok(badJ.length === 0, 'the jitter bits (7–8) change the layout, never the cell: ' + (badJ.slice(0, 4).join('; ') || '96 more bakes'));
eq(S.frames('oak'), 1, 'oak frames stay 1'); eq(S.frames('cypress'), 1, 'cypress frames stay 1'); eq(S.frames('palmetto'), 1, 'palmetto frames stay 1'); eq(S.frames('azalea'), 1, 'azalea frames stay 1'); eq(S.frames('shrub'), 1, 'shrub frames stay 1');
const sh2 = S.get('shrub', 2, 0, 2); ok(sh2 && sh2.sw === 44 && sh2.sh === 24 && sh2.ox === -22 && sh2.oy === -20, 'shrub: 22×12 at ox −11 oy −10 (master 2: 44×24 at (−22, −20))');
const ok2 = S.get('oak', tv(2, false, false, 0), 0, 2); ok(ok2 && ok2.sw === 192 && ok2.sh === 112 && ok2.ox === -96 && ok2.oy === -104 && ok2.own === true, 'oak stage 2 at master 2: 192×112 on its own canvas, anchored at the trunk base (−96, −104)');

// --- recorded brush calls: seasons, bits, lod, jitter ------------------------
const REC = [];
const wrap = (name) => { const orig = B[name]; B[name] = function () { REC.push([name, Array.from(arguments).slice(1)]); return orig.apply(this, arguments); }; return orig; };
const origs = {}; for (const n of ['capsule', 'orb', 'stroke', 'softEllipse', 'shadow']) origs[n] = wrap(n);
const bakeRec = (id, v, z) => { REC.length = 0; S.clear(); S.get(id, v, 0, z); return REC.slice(); };
const kinds = (rec, name) => rec.filter((r) => r[0] === name);
const rgb = (c) => (Array.isArray(c) ? c : [0, 0, 0]);
const meanRG = (rec) => { let r = 0, g = 0, n = 0; for (const x of kinds(rec, 'softEllipse')) { const c = rgb(x[1][4]); if (c[0] || c[1]) { r += c[0]; g += c[1]; n++; } } return n ? [r / n, g / n] : [0, 0]; };
const sum = bakeRec('cypress', tv(2, false, false, 0), 2), aut = bakeRec('cypress', tv(2, true, false, 0), 2);
const rgS = meanRG(sum), rgA = meanRG(aut);
ok(sum.length > 60 && aut.length > 60, 'a mature cypress is ' + sum.length + ' brush calls at master 2');
ok(rgS[1] > rgS[0] && rgA[0] > rgA[1], 'cypress: summer sprays are green (g > r), the autumn bit swaps the leaf to the rust ramp (r > g): summer ' + rgS.map((x) => x.toFixed(0)).join('/') + ', autumn ' + rgA.map((x) => x.toFixed(0)).join('/'));
const bl0 = bakeRec('azalea', tv(2, false, false, 1), 2), bl1 = bakeRec('azalea', tv(2, false, true, 1), 2);
const bloomOrbs = (rec) => kinds(rec, 'orb').filter((r) => r[1][4] === 'azaleaBloom').length;
ok(bloomOrbs(bl0) === 0 && bloomOrbs(bl1) >= 20, 'azalea: the bloom bit draws petal orbs in the azaleaBloom ramp (' + bloomOrbs(bl1) + '), the plain shrub none');
const bl1lod = bakeRec('azalea', tv(2, false, true, 1), 1);
ok(bloomOrbs(bl1lod) >= 3 && bloomOrbs(bl1lod) < bloomOrbs(bl1) / 3, 'azalea lod 1: the bloom survives as a few soft masses (' + bloomOrbs(bl1lod) + ') instead of petal clusters (' + bloomOrbs(bl1) + ')');
const a0 = bakeRec('azalea', tv(0, false, true, 0), 2); ok(bloomOrbs(a0) >= 1 && bloomOrbs(a0) <= 3, 'a shredded azalea (stage 0) carries a bloom or two');
const oak2 = bakeRec('oak', tv(2, false, false, 0), 2), oak1 = bakeRec('oak', tv(2, false, false, 0), 1);
const mossStrokes = (rec) => kinds(rec, 'stroke').filter((r) => r[1][2] === 'moss').length;
ok(mossStrokes(oak2) >= 30 && mossStrokes(oak1) === 0, 'live oak: moss strands (' + mossStrokes(oak2) + ' strokes) at master 2 / lod 0 only; none at master 1 (0.5×)');
ok(oak2.length > oak1.length * 8 && oak1.length < 40, 'live oak lod 1 is a single soft silhouette: ' + oak1.length + ' brush calls vs ' + oak2.length + ' at lod 0 (clumps, mounds, dabs, flecks, dapples, moss)');
ok(kinds(oak1, 'orb').length >= 7 && kinds(oak1, 'capsule').length >= 5, 'oak lod 1 keeps the cluster orbs and the trunk / limb capsules');
const toneSet = new Set(kinds(oak2, 'orb').slice(0, 12).map((r) => JSON.stringify(r[1][4])));
ok(toneSet.size >= 3, 'live oak canopy uses 3–4 leaf tones (' + toneSet.size + ' bases among the clusters)');
ok(kinds(oak2, 'capsule').length >= 7, 'oak: the tapered trunk, its two surface roots and the limbs are capsules (' + kinds(oak2, 'capsule').length + ')');
ok(kinds(oak2, 'shadow').length === 1, 'oak: one soft contact shadow');
const wet = bakeRec('cypress', tv(2, false, false, 0, true), 2), dry = bakeRec('cypress', tv(2, false, false, 0, false), 2);
ok(kinds(wet, 'shadow').length === 0 && kinds(dry, 'shadow').length === 1, 'cypress in water: a waterline ring and a reflection instead of the ground shadow; dry: the shadow');
ok(kinds(bakeRec('cypress', tv(1, false, false, 0), 2), 'capsule').length >= kinds(bakeRec('cypress', tv(0, false, false, 0), 2), 'capsule').length && kinds(bakeRec('cypress', tv(2, false, false, 0), 2), 'capsule').length > kinds(bakeRec('cypress', tv(0, false, false, 0), 2), 'capsule').length, 'cypress: the trunk, the buttress and the knees (stage ≥ 1) are capsules');
const cyp1 = bakeRec('cypress', tv(2, false, false, 0), 1);
ok(sum.length > cyp1.length * 1.5 && kinds(cyp1, 'stroke').length < kinds(sum, 'stroke').length, 'cypress lod 1 drops the drooping branchlets and the new growth (' + cyp1.length + ' calls vs ' + sum.length + ')');
const key = (rec) => rec.map((r) => r[0] + ':' + r[1].slice(0, 3).map((x) => (typeof x === 'number' ? x.toFixed(2) : String(x))).join(',')).join('|');
const j0 = key(bakeRec('oak', tv(2, false, false, 0, false, 0), 2)), j1 = key(bakeRec('oak', tv(2, false, false, 0, false, 1), 2)), j3 = key(bakeRec('oak', tv(2, false, false, 0, false, 3), 2));
ok(j0 !== j1 && j1 !== j3 && j0 !== j3, 'oak: jitter 0 / 1 / 3 are three different layouts (no stamp)');
const c0 = key(bakeRec('cypress', tv(2, false, false, 1, false, 0), 2)), c1 = key(bakeRec('cypress', tv(2, false, false, 1, false, 1), 2)), c2 = key(bakeRec('cypress', tv(2, false, false, 1, false, 2), 2)), c3 = key(bakeRec('cypress', tv(2, false, false, 1, false, 3), 2));
ok(new Set([c0, c1, c2, c3]).size === 4, 'cypress: the four jitter values × the four silhouettes keep a stand from repeating (4 distinct layouts per silhouette)');
const sil0 = key(bakeRec('oak', tv(2, false, false, 0), 2)), sil3 = key(bakeRec('oak', tv(2, false, false, 3), 2)); ok(sil0 !== sil3, 'oak silhouettes 0 and 3 differ');
ok(key(bakeRec('oak', tv(2, false, false, 2, false, 2), 2)) === key(bakeRec('oak', tv(2, false, false, 2, false, 2), 2)) && key(bakeRec('cypress', tv(2, true, false, 3, true, 1), 2)) === key(bakeRec('cypress', tv(2, true, false, 3, true, 1), 2)), 'deterministic: the same variant records the same brush calls twice');
const pal2 = bakeRec('palmetto', tv(2, false, false, 0), 2), pal1 = bakeRec('palmetto', tv(2, false, false, 0), 1);
ok(kinds(pal2, 'capsule').length >= 40 && kinds(pal2, 'stroke').length > kinds(pal1, 'stroke').length, 'palmetto: petioles and 7 tapered ray capsules per frond (' + kinds(pal2, 'capsule').length + '), the lit ray threads only at lod 0');
ok(kinds(bakeRec('palmetto', tv(2, false, false, 0), 2), 'capsule').length > kinds(bakeRec('palmetto', tv(0, false, false, 0), 2), 'capsule').length, 'palmetto: more fronds at higher stages');
const sr2 = bakeRec('shrub', 1, 2), sr1 = bakeRec('shrub', 1, 1);
ok(mossStrokes(sr2) >= 10 && mossStrokes(sr1) === 0 && sr2.length > sr1.length, 'shrub: a mound draped with moss at lod 0, the plain mound at lod 1 (' + sr2.length + ' vs ' + sr1.length + ' calls)');
for (const n of Object.keys(origs)) B[n] = origs[n];

// --- brush.tree draws the cached cells ----------------------------------------
const calls = []; const stubCtx = { drawImage() { calls.push(Array.from(arguments)); }, save() {}, restore() {}, translate() {}, scale() {} };
B.tree(stubCtx, 100, 200, 'liveOak', { seed: 5, stage: 1 }, B.env(2));
const oakCell = S.get('oak', tv(2, false, false, 1, false, 1), 0, 2);
ok(calls.length === 1 && calls[0][0] === oakCell.canvas && Math.abs(calls[0][7] - 192 / 2) < 0.01 && Math.abs(calls[0][6] - (200 + oakCell.oy / 2)) < 0.01 && Math.abs(calls[0][5] - (100 + oakCell.ox / 2)) < 0.01, 'brush.tree(liveOak, stage 1) draws the cached stage-2 oak cell 1:1 with its trunk base at (x, y) (silhouette = seed & 3, jitter = seed >> 2)');
calls.length = 0; B.tree(stubCtx, 0, 0, 'cypress', { seed: 2, inWater: true, stage: 2 }, B.env(1));
const cypCell = S.get('cypress', tv(2, false, false, 2, true, 0), 0, 1);
ok(calls.length === 1 && calls[0][0] === cypCell.canvas && cypCell.own, 'brush.tree(cypress, inWater) draws the cypress cell with the water bit (master 1 under a master-1 env)');
ok(typeof B.tree === 'function' && B.tree.length === 6, 'brush.tree keeps its signature');

// --- atlas bytes at master 2 ----------------------------------------------------
S.clear();
const bytes = {};
const bakeSet = (id, list) => { let b = 0; for (const v of list) { const e = S.get(id, v, 0, 2); if (e && e.own) b += e.bytes; } return b; };
const stage2 = [0, 1, 2, 3].map((s) => tv(2, false, false, s));
bytes.oak = bakeSet('oak', [].concat(stage2, [tv(1, false, false, 0)], [tv(0, false, false, 0)]));
bytes.cypress = bakeSet('cypress', [].concat(stage2, [0, 1, 2, 3].map((s) => tv(2, true, false, s)), [tv(2, false, false, 0, true)], [tv(1, false, false, 0), tv(0, false, false, 0)]));
bytes.palmetto = bakeSet('palmetto', [tv(0, false, false, 0), tv(1, false, false, 0), tv(2, false, false, 0), tv(2, false, false, 1)]);
bytes.azalea = bakeSet('azalea', [tv(0, false, false, 0), tv(1, false, false, 0), tv(2, false, false, 0), tv(2, false, true, 0), tv(2, false, true, 1)]);
bytes.shrub = bakeSet('shrub', [0, 1, 2, 3]);
const total = Object.values(bytes).reduce((a, b) => a + b, 0);
ok(total > 0 && Math.abs(S.hdMemoryMB() - total / 1048576) < 0.001, 'master-2 atlas bytes are accounted in hdMemoryMB: ' + Object.entries(bytes).map(([k, v]) => k + ' ' + (v / 1024).toFixed(0) + ' KB').join(', ') + ' (' + (total / 1048576).toFixed(2) + ' MB)');
ok(total < 4 * 1048576, 'one of each silhouette / season costs under 4 MB at master 2');
ok(S.get('oak', tv(2, false, false, 0), 0, 1).sw === 96, 'master 1 stays 1 art px per px');

// --- the self-tests ---------------------------------------------------------
S.clear();
BSU.SELFTEST = true;
let r = null; try { r = S.vegetationHDSelfTest(); } catch (e) { r = { ok: false, notes: String(e && e.stack || e) }; }
ok(r && r.ok, 'vegetationHDSelfTest ok: ' + (r && r.notes));
BSU.SELFTEST = false;
eq(errs(), e0, 'no BSU.error through the whole file');
S.clear(); const tb = performance.now(); for (let k = 0; k < 8; k++) { S.get('oak', tv(2, false, false, k & 3, false, k >> 2), 0, 2); S.get('cypress', tv(2, false, false, k & 3, false, k >> 2), 0, 2); } const bakeMs = (performance.now() - tb) / 16;
ok(bakeMs < 25 || BUSY, `a mature oak / cypress bakes at master 2 in ${bakeMs.toFixed(2)} ms in the stub` + (BUSY ? ' (advisory: loadavg > 3)' : ''));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
