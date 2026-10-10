// Unit test for src/js/sprites_buildings.js: loads contract.js, data.js, sprites.js, then
// sprites_buildings.js through makeWindow() from test/domstub.mjs with vm.runInContext; asserts
// every catalog id returns a non-null sprite for the base variant at zoom 1 and 2, plus the core
// sprites.selfTest() (which now runs sprites_buildings.js's registered _tests too).
// Usage: node test/unit/sprites_buildings.test.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
const BUSY = loadavg()[0] > 3;   // wall-clock budgets are advisory when the machine is loaded (reported, not failed)
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
const src = readFileSync(join(root, 'src', 'js', 'sprites_buildings.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');   // comments stripped
ok(!/Math\.random/.test(code), 'no Math.random in actual code (the header prose names the rule)');
ok(!/rng\.fx/.test(code), 'painters never touch rng.fx');
ok(!/fillText|strokeText|\.arc\(|lineTo\(/.test(code), 'no fillText / arc / lineTo (integer pixel art only)');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");

// --- load: contract.js, data.js, sprites.js, then sprites_buildings.js ------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
for (const f of ['contract.js', 'data.js', 'sprites.js']) {
  vm.runInContext(readFileSync(join(root, 'src', 'js', f), 'utf8'), ctx, { filename: f });
}
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'sprites_buildings.js' }); } catch (e) { threw = e; }
const loadMs = performance.now() - t0;
ok(!threw, 'sprites_buildings.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(loadMs < 50, `definition time ${loadMs.toFixed(1)} ms < 50 ms`);

const BSU = win.BSU;
const S = BSU.sprites;
const SPR = BSU.SPR;
ok(S.hasPainter('building') && S.hasPainter('ruin') && S.hasPainter('thibodeaux') && S.hasPainter('icon'), 'registers building/ruin/thibodeaux/icon painters');
for (const fn of ['paintBuilding', 'buildingBox', 'roofs', 'placeDecal', 'tonePen', 'offsetPen'])
  ok(typeof S[fn] === 'function' || typeof S[fn] === 'object', 'public surface ' + fn);

// --- init + the core selfTest (now exercises every building painter) -------
const t1 = performance.now();
S.init(BSU.newState(1));
const initMs = performance.now() - t1;
ok(BUSY || initMs < 600, `init ran in ${initMs.toFixed(1)} ms < 600 ms (${S.count()} entries)${BUSY ? ' [machine busy: budget advisory]' : ''}`);   // design pass: aprons + margins bake ~17 % more; art pass B3: materials, features and the state overlays bake 1.14× (best-of-5 169 → 193 ms for 33 footprint rows × 6 variants); ~490 → ~520 ms idle, load-sensitive

BSU.SELFTEST = true;
let st;
const t2 = performance.now();
try { st = S.selfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t2;
// sprites.js's own selfTest bundles a `memoryMB() <= CANVAS_LIMIT_MB` check. sprites_buildings.js raises that
// ceiling from 8 to 40 MB once loaded (sprites.test.mjs never loads this file and still sees 8, unaffected) —
// the terrain-only atlas was comfortably under 8 MB, but ~215 building canvases pre-baked at load, sized exactly
// per ARCHITECTURE §4.1's formulas (a 12-floor res_tower, a 6x5 stadium…), genuinely need more; render's real
// ceiling (ARCHITECTURE.md §6.3) is 64 MB total, so 40 still leaves headroom for sprites_entities.js's sheets.
ok(st && st.ok === true, 'sprites.selfTest().ok === true — ' + (st && st.notes));
ok(BUSY || stMs < 320, `selfTest ran in ${stMs.toFixed(1)} ms < 320 ms${BUSY ? ' [machine busy: budget advisory]' : ''}`);   // B3: the registered self-test paints 10 variant combos per row (was 8: + FLOODED, FLOODED|NIGHT|DAMAGED)
// Also run every M._tests entry directly (belt-and-suspenders: this is the unconditional check of this
// file's own pushed self-test, independent of whatever else sprites.js's bundled selfTest asserts).
for (const fn of S._tests) {
  let r; try { r = fn(); } catch (e) { r = { ok: false, notes: 'threw: ' + (e && e.message) }; }
  ok(r && r.ok !== false, 'registered M._tests entry — ' + (r && r.notes));
}

// --- every one of the 43 catalog ids: non-null at the base variant, zoom 1 and 2 -----
const errBefore = BSU.errors.size;
const missing = [];
for (const row of BSU.data.catalogList) {
  const e1 = S.get(row.id, 0, 0, 1);
  const e2 = S.get(row.id, 0, 0, 2);
  if (!e1) missing.push(row.id + ' @zoom1');
  if (!e2) missing.push(row.id + ' @zoom2');
}
eq(missing.join(','), '', `every catalog id (${BSU.data.catalogList.length}) resolves at zoom 1 and 2`);
eq(BSU.errors.size, errBefore, 'resolving every catalog id did not raise BSU.error');

// --- geometry / variant spot checks (brief docs/briefs/sprites_buildings.md §6) -----
const cat = BSU.data.catalog;
const d = S.buildingBox(cat.dorm, 0, 1);
ok(d.fw === 3 && d.fh === 2 && d.floors === 4 && d.wallH === 56 && d.roofH === 12, 'dorm geometry: fw/fh/floors/wallH/roofH');
eq(d.w, 5 * 32 + 4, 'dorm canvas width');
eq(d.ox, -98, 'dorm ox');
eq(d.oy + d.h, 18, 'dorm oy + h === 18 (bottom vertex + pad)');
const dp = S.buildingBox(cat.dorm, SPR.PILINGS, 1);
eq(dp.lift, 10, 'PILINGS lift === 10');
eq(dp.h, d.h + 10, 'PILINGS canvas is 10 px taller');
const dr = S.buildingBox(cat.dorm, 0, 1, 1);
ok(dr.fw === 2 && dr.fh === 3, 'dorm:r rotation swaps the footprint');
eq(dr.ox, -66, 'dorm:r ox');

eq(S.frames('dorm', SPR.NIGHT), 4, 'NIGHT has 4 frames');
S.get('dorm', SPR.SCAFFOLD, 0, 1);
eq(S.frames('dorm', SPR.SCAFFOLD), 3, 'SCAFFOLD has 3 frames');
S.get('water_tower', 0, 0, 1);
eq(S.frames('water_tower'), 4, 'water_tower has 4 frames');
S.get('surge_barrier', 0, 0, 1);
eq(S.frames('surge_barrier'), 4, 'surge_barrier has 4 frames');
eq(S.frames('founders_hall'), 1, 'other buildings default to 1 frame');

const tb = S.get('thibodeaux', 0, 0, 1);
ok(tb && tb.sw === 48 && tb.sh === 48, 'thibodeaux is 48x48');
eq(S.frames('thibodeaux'), 2, 'thibodeaux has 2 frames (neutral/speaking)');
const icon = S.get('icon:dorm', 0, 0, 1);
ok(icon && icon.sw === 64 && icon.sh === 64, 'icon:dorm is 64x64');
const bowlT3 = S.buildingBox(cat.stadium, 3 << SPR.TIER_SHIFT, 1).bowlRect;
const bowlT0 = S.buildingBox(cat.stadium, 0, 1).bowlRect;
ok(bowlT3 !== null, 'stadium tier 3 has a non-null bowlRect');
eq(bowlT0, null, 'stadium tier 0 (unbuilt) has a null bowlRect');

// --- design pass: setback geometry (the structure is the footprint quad inset per axis) -----
{
  const g = S.buildingBox(cat.dorm, 0, 1);               // 3×2: 12 px per side along the 3-tile axis, 10 px along the 2-tile axis
  ok(g.ipx === 12 && g.ipy === 10 && g.bl === 72 && g.br === 44 && g.bw === 116 && g.bk === 14, 'dorm inset quad: faces 72/44 px, skew 14 (' + JSON.stringify([g.ipx, g.ipy, g.bl, g.br, g.bw, g.bk]) + ')');
  ok(g.bx === g.ax - 2 && g.by === g.ay + 5 && g.bcx === g.bx - g.bk, 'dorm quad bottom corner 2 px left of the anchor, 11 rows above the footprint bottom');
  const p = S.buildingBox(cat.poboy, 0, 1);
  ok(p.ipx === 6 && p.bl === 20 && p.br === 20 && p.bk === 0 && p.bw === 40, '1×1 rows use the smaller 6-px inset (0.19 tile)');
  const r = S.buildingBox(cat.dorm, 0, 1, 1);
  ok(r.bl === 44 && r.br === 72 && r.bk === -14, 'rotation swaps the face widths and negates the skew');
  ok(S.APRON && S.APRON.academic.pattern === 'brick' && S.APRON.housing.hedge === true && S.APRON.utilities.fence === true && S.APRON.dining.umbrellas === true, 'apron styles per category');
  ok(S.get('dorm', SPR.FRONT_L, 0, 1) && S.get('dorm', SPR.FRONT_L | SPR.NIGHT, 2, 1), 'FRONT_L (entrance on the SW face) renders, day and night');
  // tee pass: per-building path connectors come through bakeWith (never a cached variant); teeable gates the rows
  const tees = [S.teeCode(0, 0, 1), S.teeCode(1, 2, 2), S.teeCode(1, 0, 3)];
  const tb = S.bakeWith('dorm', 0, 0, 1, { tees: tees }), tbn = S.bakeWith('dorm', SPR.NIGHT | SPR.PILINGS, 1, 2, { tees: tees });
  ok(tb && tb.own && tb.w === S.get('dorm', 0, 0, 1).w && tb.h === S.get('dorm', 0, 0, 1).h && tbn && tbn.zoom === 2, 'bakeWith(tees) renders day and night/pilings at the shared sprite size');
  ok(S.teeable(cat.dorm, 0) && S.teeable(cat.substation, 0) && !S.teeable(cat.quad, 0) && !S.teeable(cat.parking, 0) && !S.teeable(cat.water_tower, 0) && !S.teeable(cat.live_oak, 0) && !S.teeable(null, 0), 'teeable: footprint rows with a wall and their own apron only');
  ok(S.teeCode(1, 2, 2) === 146 && S.bakeWith('dorm', 0, 0, 1, { tees: [S.teeCode(0, 15, 1), S.teeCode(1, 9, 1)] }), 'tee codes pack (surf << 6 | side << 4 | k); out-of-range tiles are ignored, not drawn');
}

// --- art pass B3: materials, features, the FLOODED state -----
{
  eq(SPR.FLOODED, 512, 'SPR.FLOODED is bit 512 (contract.js)');
  const lum = (h) => { const c = S.hex(h); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
  for (const name of ['trim', 'iron', 'glass', 'tile', 'concrete', 'block', 'wood', 'sandbag']) {
    const r = S.materials[name];
    ok(Array.isArray(r) && r.length === 5 && lum(r[0]) < lum(r[1]) && lum(r[1]) < lum(r[2]) && lum(r[2]) < lum(r[3]) && lum(r[3]) < lum(r[4]), 'material ramp ' + name + ' has 5 tones of rising luminance');
  }
  const wr = S.rampOf('#B87A5A');
  ok(wr === S.rampOf('#b87a5a') && wr[2].toUpperCase() === '#B87A5A', 'rampOf memoises per colour and keeps the base at tone 2');
  ok(Array.isArray(S.FEATURES) && S.FEATURES.indexOf('cupola:gold') >= 0 && S.FEATURES.indexOf('gallery') >= 0, 'sprites.FEATURES lists the feature vocabulary');
  const unknown = [];
  for (const row of BSU.data.catalogList) for (const f of (row.paint.features || [])) if (S.FEATURES.indexOf(f) < 0 && !/^sign:[A-Z]{2,7}$/.test(f)) unknown.push(row.id + ':' + f);
  eq(unknown.join(','), '', 'every data.js paint.features entry is a known feature (or sign:TEXT)');
  ok(cat.founders_hall.paint.features.indexOf('cupola:gold') >= 0 && cat.dorm.paint.material === 'brick' && cat.engineering.paint.material === 'metal' && cat.bell_tower.paint.material === 'stone', 'hero descriptors: Founders cupola, brick dorm, metal engineering, stone bell tower');
  const n = (x, y, seed) => S.noiseAt(x, y, seed);
  ok(n(3, 4, 7) >= 0 && n(3, 4, 7) < 1 && n(3, 4, 7) === n(3 + 64, 4 + 64, 7) && Math.abs(n(10, 10, 1) - n(11, 10, 1)) < 0.35, 'noiseAt: [0, 1), 64-periodic, smooth between neighbours');
  const g = S.buildingBox(cat.dorm, 0, 1), g2 = S.buildingBox(cat.dorm, SPR.FLOODED | SPR.NIGHT, 1);
  ok(g.w === g2.w && g.h === g2.h && g.ox === g2.ox && g.oy === g2.oy && g.bl === g2.bl && g.bk === g2.bk, 'FLOODED/NIGHT never change the sprite geometry');
  for (const id of ['founders_hall', 'dorm', 'stadium', 'water_tower', 'quad']) ok(S.get(id, SPR.FLOODED, 0, 1) && S.get(id, SPR.FLOODED | SPR.DAMAGED | SPR.NIGHT, 1, 2), id + ' renders FLOODED (and FLOODED|DAMAGED|NIGHT at 2×)');
  const sb = S.get('stadium', (2 << SPR.TIER_SHIFT) | SPR.NIGHT, 0, 1);
  ok(sb && sb.w === S.get('stadium', 2 << SPR.TIER_SHIFT, 0, 1).w, 'stadium tier II night (lit masts with glare) shares the day size');
}

// --- any combination of variant bits renders (e.g. NIGHT|PILINGS|BOARDED) -----
const combos = [0, SPR.NIGHT, SPR.DAMAGED, SPR.PILINGS, SPR.SCAFFOLD, SPR.RUIN, SPR.BOARDED, SPR.NIGHT | SPR.PILINGS | SPR.BOARDED, SPR.DAMAGED | SPR.PILINGS, SPR.FLOODED, SPR.FLOODED | SPR.PILINGS | SPR.NIGHT];
const bad = [];
for (const row of BSU.data.catalogList) for (const v of combos) { if (!S.get(row.id, v, 0, 1)) bad.push(row.id + ' v' + v); }
eq(bad.join(','), '', 'every row x every variant combo renders');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
