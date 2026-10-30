// Unit test for src/js/sprites_terrain.js (H1 terrain + water pass): loads the manifest through sprites_terrain.js in the DOM stub
// (test/domstub.mjs) and checks: the source rules, that every terrain / water family is HD-registered over its pen painter, that every
// family bakes at master 1 and 2 with the pen painters' canvas sizes and anchors, the tile variant contract (position bits, depth bits),
// the seam stroke on every tiled diamond, the lod branches (fewer sites / no grain at master 1), world anchoring (two block positions
// differ, the same position repeats), the gc pin on tile / cliff, brush.strokePath's layers, and the split selfTest.
// Usage: node test/unit/terrain_hd.test.mjs   (exit 1 on any failure)
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
const src = readFileSync(join(root, 'src', 'js', 'sprites_terrain.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
ok(!/rng\.fx/.test(code), 'painters never touch rng.fx');
ok(!/createLinearGradient|createRadialGradient|ctx\.filter|shadowBlur|fillText|strokeText/.test(code), 'no hand-written gradients, filters or text: every gradient is a brush call (ART_STYLE §3)');
ok(!/registerPainter\(/.test(code) && (code.match(/registerHD\(/g) || []).length >= 14, 'every family goes through registerHD (14+)');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
ok(manifest.indexOf('sprites_terrain.js') === manifest.indexOf('brush.js') + 1 && manifest.indexOf('sprites_terrain.js') < manifest.indexOf('sprites_buildings.js'), 'manifest: sprites_terrain.js right after brush.js, before sprites_buildings.js');

// --- load -------------------------------------------------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
for (const f of manifest.slice(0, manifest.indexOf('sprites_terrain.js') + 1)) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { if (['contract.js', 'data.js', 'sprites.js', 'brush.js', 'sprites_terrain.js'].includes(f)) { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); } console.log('skip:', f, '(failed to load: ' + (e && e.message) + ')'); }
}
const BSU = win.BSU, S = BSU.sprites, B = BSU.brush, T = BSU.T;
const FAM = S.hdTerrainFamilies();
ok(Array.isArray(FAM) && FAM.length === 14 && ['tile', 'cliff', 'tuft', 'patch', 'shore', 'tone', 'reeds', 'knees', 'worn', 'mound', 'levee', 'floodwall', 'canal', 'water'].every((f) => FAM.includes(f)), 'hdTerrainFamilies(): the 14 terrain / water families');
ok(FAM.every((f) => S.hdFamilies().includes(f)) && S.hdFamilies().every((f) => FAM.includes(f) || f === 'building' || f === 'bldlight' || f === 'habfront' || (S.hdEntityFamilies && S.hdEntityFamilies().includes(f)) || (S.hdVegetationFamilies && S.hdVegetationFamilies().includes(f))), 'every terrain family is HD-registered (the only other HD families are H2\'s building / bldlight / habfront, H4\'s character families and H3\'s vegetation families)');
ok(!S.isHD('surf:4') && !S.isHD('preservePost') && !S.isHD('decal:sandbags') && !S.isHD('light:lamp'), 'the fence stamp, preserve posts, decals and lights keep their pen painters');
ok(S.isPinned('tile') && S.isPinned('cliff') && !S.isPinned('shore') && !S.isPinned('water'), 'tile + cliff are pinned against gc (fetched only by chunk bakes), the rest are lazy');
ok(S.TILE_SHALLOW === 8 && S.TILE_DEEP === 1024 && S.TILE_POS_SHIFT === 4, 'tile variant contract: 8 shallow, 1024 deep, position << 4');

// --- every family bakes at both masters with the pen geometry --------------------
const GEO = [
  ['tile:0', 0, 0, 64, 32, -32, -16], ['tile:0', 8 | (5 << 4), 0, 64, 32, -32, -16], ['tile:0', 1024 | (63 << 4), 0, 64, 32, -32, -16], ['tile:1', 8, 0, 64, 32, -32, -16], ['tile:2', 17 << 4, 0, 64, 32, -32, -16],
  ['tile:3', 0, 0, 64, 32, -32, -16], ['tile:4', 9 << 4, 0, 64, 32, -32, -16], ['tile:5', 0, 0, 64, 32, -32, -16], ['tile:6', 0, 0, 64, 32, -32, -16], ['tile:7', 0, 0, 64, 32, -32, -16],
  ['cliff', 1, 0, 32, 17, -32, 0], ['cliff', 5, 1, 32, 21, 0, 0], ['cliff', 12, 0, 32, 28, -32, 0], ['cliff', 40, 1, 32, 56, 0, 0], ['cliff', 96, 0, 32, 112, -32, 0],
  ['tuft', 1, 0, 8, 6, -4, -5], ['tuft:high', 3, 0, 8, 6, -4, -5], ['patch:clover', 0, 0, 16, 8, -8, -4], ['patch:dirt', 1, 0, 16, 8, -8, -4], ['patch:lime', 2, 0, 16, 8, -8, -4],
  ['shore:sand', 5, 0, 64, 32, -32, -16], ['shore:mud', 10, 0, 64, 32, -32, -16], ['shore:ripple', 15, 0, 64, 32, -32, -16], ['shore:beach', 0, 0, 64, 32, -32, -16],
  ['tone:warm', 0, 0, 64, 32, -32, -16], ['tone:cool', 0, 0, 64, 32, -32, -16], ['reeds', 1, 1, 12, 14, -6, -13], ['knees', 9, 0, 64, 32, -32, -16], ['knees', 63, 0, 64, 32, -32, -16],
  ['worn', 4, 0, 64, 32, -32, -16], ['worn', 1, 0, 64, 32, -32, -16], ['mound', 0, 0, 24, 14, -12, -20],
  ['levee', 0, 0, 64, 48, -32, -28], ['levee', 16 | 3, 0, 64, 48, -32, -28], ['levee', 15, 0, 64, 48, -32, -28], ['floodwall', 10, 0, 64, 54, -32, -36], ['floodwall', 0, 0, 64, 54, -32, -36],
  ['canal', 32 | 64 | 5, 0, 64, 32, -32, -16], ['canal', 16, 0, 64, 32, -32, -16], ['canal', 15, 0, 64, 32, -32, -16], ['water', 0, 0, 64, 32, -32, -16], ['water', 1, 0, 64, 32, -32, -16],
];
let geoOk = true, hdOk = true, errs0 = BSU.errors.size, nBaked = 0;
for (const [id, v, f, w, h, ox, oy] of GEO) for (const z of [1, 2]) {
  const e = S.get(id, v, f, z);
  if (!e) { geoOk = false; console.error('no entry', id, v, f, z); continue; }
  nBaked++;
  if (!(e.hd === true && e.zoom === z)) { hdOk = false; console.error('not hd', id, v, z, e.hd, e.zoom); }
  if (!(e.sw === w * z && e.sh === h * z && e.ox === ox * z && e.oy === oy * z)) { geoOk = false; console.error('geometry', id, v, f, z, [e.sw, e.sh, e.ox, e.oy], 'want', [w * z, h * z, ox * z, oy * z]); }
}
ok(geoOk, `every family bakes at master 1 and 2 with the pen painters' canvas sizes and anchors (${nBaked} entries)`);
ok(hdOk, 'every entry is an HD entry at its master (spec.master = zoom)');
ok(BSU.errors.size === errs0, 'no BSU.error while baking (painters never throw on the stub canvas)');

// --- seams, lod branches, world anchoring (spies on the brush) ---------------------
function spy(fnName, run) {
  const orig = B[fnName]; let n = 0, last = null;
  B[fnName] = function () { n++; last = arguments; return orig.apply(this, arguments); };
  try { run(); } finally { B[fnName] = orig; }
  return { n, last };
}
S.clear();
const envOf = (z) => B.env(z);
let seam1 = 0, seam2 = 0, widths = new Set();
{ const o = B.seamStroke; B.seamStroke = function (c, pts, style, env) { if (env.master === 2) seam2++; else seam1++; widths.add(B.seamWidth(env)); return o.apply(this, arguments); };
  try { for (const id of ['tile:0', 'tile:2', 'tile:4', 'tile:5', 'tile:6', 'tile:7', 'tone:warm', 'shore:beach', 'water']) { S.get(id, id === 'water' ? 1 : 0, 0, 1); S.get(id, id === 'water' ? 1 : 0, 0, 2); } } finally { B.seamStroke = o; } }
ok(seam1 >= 9 && seam2 >= 9 && widths.has(0.9) && widths.has(0.45) && widths.size === 2, `every tiled diamond is stroked with its own fill at brush.seamWidth (0.9 art px at master 1, 0.45 at master 2; ${seam1} / ${seam2} strokes)`);
S.clear();
const orbs1 = spy('orb', () => S.get('tile:4', 9 << 4, 0, 1)).n, orbs2 = spy('orb', () => S.get('tile:4', 9 << 4, 0, 2)).n;
const grain1 = spy('microGrain', () => S.get('tile:4', 5 << 4, 0, 1)), grain2 = spy('microGrain', () => S.get('tile:4', 5 << 4, 0, 2));
ok(orbs2 > orbs1 && orbs1 >= 0, `lod 1 (master 1) plants fewer tufts than lod 0 (${orbs1} vs ${orbs2} orbs on one grass tile)`);
ok(grain1.n === grain2.n && grain1.n >= 1, 'microGrain is called at both masters (it skips itself at lod 1)');
const glint1 = spy('softEllipse', () => S.get('tile:0', 3 << 4, 0, 1)).n, glint2 = spy('softEllipse', () => S.get('tile:0', 3 << 4, 0, 2)).n;
ok(glint2 > glint1, `water glints / rings are fewer at master 1 (${glint1} vs ${glint2} soft ellipses)`);
// world anchoring: posEnv puts the context origin at the block's screen offset; sites differ between positions and repeat for the same one
const e1 = B.posEnv(envOf(2), 0, 32, 16), e2 = B.posEnv(envOf(2), 9, 32, 16), e3 = B.posEnv(envOf(2), 0, 32, 16);
ok(e1.periodic === true && e1.originX === 256 - 32 && e1.originY === -16 && e2.originX === ((9 & 7) - (9 >> 3)) * 32 + 256 - 32 && e2.originY === ((9 & 7) + (9 >> 3)) * 16 - 16 && e1.originX === e3.originX, 'posEnv: origin = the block offset of (tx & 7, ty & 7) minus the diamond centre, periodic');
const sitesAt = (env) => { const out = []; B.sites(env, 11, 32, 16, 48, 24, 18, (x, y) => out.push(Math.round(x * 10) / 10 + ',' + Math.round(y * 10) / 10)); return out.join(';'); };
ok(sitesAt(e1) === sitesAt(e3) && sitesAt(e1) !== sitesAt(e2) && sitesAt(e1).length > 0, 'sites: deterministic per block position, different between positions');
// the same world site seen from two neighbouring tiles lands at the same world px (a patch cut by the edge is finished by the neighbour)
{ const a = B.posEnv(envOf(2), 1, 32, 16), b = B.posEnv(envOf(2), 2, 32, 16); const wa = new Set(), wb = new Set();
  B.sites(a, 11, 32, 16, 48, 24, 18, (x, y) => wa.add(Math.round((x + a.originX) * 10) + ',' + Math.round((y + a.originY) * 10)));
  B.sites(b, 11, 32, 16, 48, 24, 18, (x, y) => wb.add(Math.round((x + b.originX) * 10) + ',' + Math.round((y + b.originY) * 10)));
  let shared = 0; for (const k of wa) if (wb.has(k)) shared++;
  ok(shared > 0, `neighbouring block positions share their edge sites in world px (${shared} shared of ${wa.size} / ${wb.size})`); }
ok(Math.abs(B.field(e1, 7, 10, 10, 16) - B.field(B.posEnv(envOf(2), 0, 32, 16), 7, 10, 10, 16)) < 1e-12 && B.field(e1, 7, 10, 10, 16) >= 0 && B.field(e1, 7, 10, 10, 16) < 1, 'field(): periodic world noise in [0, 1) under a posEnv');
ok(Math.abs(B.marshField(e1, 0, 0) - B.marshField(e1, 256, 128)) < 1e-9, 'marshField is 256×128-periodic (the knees overlay and the marsh tile share it)');
// the tile variant's hash bits are ignored: the same position bakes the same art whatever bits 0–2 say (spy on the sites seed path)
{ const a = spy('sites', () => S.get('tile:4', (9 << 4) | 3, 0, 2)), b = spy('sites', () => S.get('tile:4', (9 << 4) | 5, 0, 2)); ok(a.n === b.n && a.n > 0, 'bits 0–2 of a tile variant do not change the HD painter (position bits only)'); }

// --- brush.strokePath: layers per material, unit scaling, lod ------------------------
{
  const c = S.newCanvas(8, 8), g = S.ctx2d(c); let strokes = 0, dashes = 0, maxW = 0; const st = g.stroke, sd = g.setLineDash;
  const count = (material, unit, env) => { strokes = 0; dashes = 0; maxW = 0; g.stroke = function () { strokes++; if (g.lineWidth > maxW) maxW = g.lineWidth; }; g.setLineDash = function (d) { if (d && d.length) dashes++; }; g.beginPath(); g.moveTo(0, 0); g.lineTo(10, 10); B.strokePath(g, 0.42, env, { material: material, unit: unit, seed: 3 }); return { strokes, dashes, maxW }; };
  const gr = count('gravel', 32, envOf(2)), gr1 = count('gravel', 32, envOf(1)), as = count('asphalt', 32, envOf(2)), bw = count('boardwalk', 32, envOf(2)), co = count('concrete', 32, envOf(2)), stub = (() => { g.beginPath(); g.moveTo(0, 0); g.lineTo(1, 1); strokes = 0; B.strokePath(g, 0.25, envOf(2), { material: 'gravel', unit: 32, stub: true }); return strokes; })();
  g.stroke = st; g.setLineDash = sd;
  ok(gr.strokes >= 6 && gr.dashes >= 1 && gr1.strokes < gr.strokes && gr1.dashes === 0, `gravel: edge AO, body, crown, highlight + specks at lod 0 (${gr.strokes} strokes), no specks at lod 1 (${gr1.strokes})`);
  ok(as.strokes >= 5 && as.dashes >= 1 && bw.strokes >= 6 && bw.dashes >= 2 && co.strokes >= 6 && co.dashes >= 1, `asphalt (${as.strokes}), boardwalk (${bw.strokes}) and concrete (${co.strokes}) have their curb / plank / joint layers`);
  ok(stub === 2 && Math.abs(gr.maxW - (0.42 + 2.4 / 32)) < 1e-9, 'a stub is edge + body only; the edge AO is w + 2.4 px / unit');
}
ok(typeof B.macroGrain === 'function' && typeof B.edgeFade === 'function' && typeof B.blade === 'function' && typeof B.puddle === 'function' && typeof B.stroke === 'function' && typeof B.diamondGrown === 'function', 'H1 brush calls: macroGrain, edgeFade, blade, puddle, stroke, diamondGrown');
ok(B.diamondGrown(32, 16, 0.7)[1][0] === 32 + 32 + 1.4 && B.diamondGrown(32, 16, 0.7)[0][1] === 16 - 16 - 0.7, 'diamondGrown pushes every edge outward');
ok(/^rgba\(/.test(B.tone('dirt', 0)) && B.tone('dirt', 0) !== B.tone('#000000', 0) && B.tone('grass', 0) === B.tone(S.RAMP_BASES.grass, 0), 'tone() resolves ramp names (dirt is not black)');

// --- split selfTest and gc pin --------------------------------------------------------
const r = S.selfTest();
ok(r.ok === true, 'sprites.selfTest (with the H1 split test) ok: ' + String(r.notes).slice(0, 120));
S.clear(); S.get('tile:4', 5 << 4, 0, 2); S.get('shore:sand', 1, 0, 2);
const before = S.count(); S.CANVAS_LIMIT_MB = 0; const dropped = S.gc(100000); S.CANVAS_LIMIT_MB = 8;
ok(S.get('tile:4', 5 << 4, 0, 2) && dropped >= 1 && S.count() <= before, `gc over the limit drops the lazy shore entry but keeps the pinned tile (${dropped} dropped)`);
ok(BSU.errors.size === errs0, 'no BSU.error across the H1 checks');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
