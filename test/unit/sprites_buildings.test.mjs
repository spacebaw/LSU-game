// Unit test for src/js/sprites_buildings.js: loads contract.js, data.js, sprites.js, then
// sprites_buildings.js through makeWindow() from test/domstub.mjs with vm.runInContext; asserts
// every catalog id returns a non-null sprite for the base variant at zoom 1 and 2, plus the core
// sprites.selfTest() (which now runs sprites_buildings.js's registered _tests too).
// Usage: node test/unit/sprites_buildings.test.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
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
ok(initMs < 400, `init ran in ${initMs.toFixed(1)} ms < 400 ms (${S.count()} entries)`);

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
ok(stMs < 200, `selfTest ran in ${stMs.toFixed(1)} ms < 200 ms`);
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

// --- any combination of variant bits renders (e.g. NIGHT|PILINGS|BOARDED) -----
const combos = [0, SPR.NIGHT, SPR.DAMAGED, SPR.PILINGS, SPR.SCAFFOLD, SPR.RUIN, SPR.BOARDED, SPR.NIGHT | SPR.PILINGS | SPR.BOARDED, SPR.DAMAGED | SPR.PILINGS];
const bad = [];
for (const row of BSU.data.catalogList) for (const v of combos) { if (!S.get(row.id, v, 0, 1)) bad.push(row.id + ' v' + v); }
eq(bad.join(','), '', 'every row x every variant combo renders');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
