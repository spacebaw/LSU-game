// Unit test for src/js/sprites_buildings_hd.js (H2a buildings pass): loads the manifest up to sprites_buildings_hd.js through
// makeWindow() from test/domstub.mjs with vm.runInContext; asserts the source rules (brush calls only, registerHD), that the 14 rows
// of tab utilities / academic / housing are HD and every other catalog row still bakes through the pen (pixel-doubled at master 2),
// every converted row × variant combo × master bakes without throwing or raising BSU.error, anchors / canvases equal the pen
// painter's (buildingBox and a direct paintBuilding bake), the frame rules (NIGHT 4, SCAFFOLD 3, water_tower 4), the bldlight
// companion's geometry and its lit cells, the lod branches, rotation, tees, and the render getRef / tee master rule.
// Usage: node test/unit/buildings_hd.test.mjs   (exit 1 on any failure)
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
const src = readFileSync(join(root, 'src', 'js', 'sprites_buildings_hd.js'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
ok(!/Math\.random/.test(code) && !/rng\.fx/.test(code), 'no Math.random / rng.fx');
ok(!/createLinearGradient|createRadialGradient|createPattern/.test(code), 'no hand-written gradients or patterns (brush calls only, ART_STYLE §3)');
ok(!/fillText|strokeText/.test(code), 'no text (fonts are not deterministic)');
ok(/registerHD\('building'/.test(code) && /registerHD\('bldlight'/.test(code) && !/registerPainter\(/.test(code), 'registers building + bldlight through registerHD only');
ok(!/<\/script/i.test(src), 'no "</script" in source');
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
ok(manifest.indexOf('sprites_buildings_hd.js') === manifest.indexOf('sprites_buildings.js') + 1, 'manifest: sprites_buildings_hd.js loads right after sprites_buildings.js (it re-registers the building family)');

// --- load -------------------------------------------------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
for (const f of manifest.slice(0, manifest.indexOf('sprites_buildings_hd.js') + 1)) vm.runInContext(readFileSync(join(root, 'src', 'js', f), 'utf8'), ctx, { filename: f });
const BSU = win.BSU, S = BSU.sprites, B = BSU.brush, SPR = BSU.SPR, cat = BSU.data.catalog;
const errs = () => (BSU.errors ? BSU.errors.size : 0);
ok(S.isHD('dorm') && S.isHD('founders_hall:r') && S.isHD('bldlight:dorm') && S.hdFamilies().includes('building'), 'building and bldlight are HD families');
const ROWS = S.hdBuildingRows();
const WANT = Object.keys(cat).filter((id) => ['utilities', 'academic', 'housing'].includes(cat[id].tab) && cat[id].kind === 'footprint');
eq(ROWS.length, 14, '14 converted rows');
ok(WANT.every((id) => ROWS.includes(id)) && ROWS.every((id) => WANT.includes(id)), 'the converted rows are exactly the footprint rows of tabs utilities / academic / housing: ' + ROWS.join(','));
ok(S.isHDBuilding('dorm') && S.isHDBuilding('dorm:r') && !S.isHDBuilding('union') && !S.isHDBuilding('tile:4'), 'isHDBuilding(id) by base id');
ok(Object.isFrozen(S.HD_ROWS), 'HD_ROWS is frozen data');

// --- every converted row × variant combo × master bakes with the pen's geometry ---
const FL = SPR.FLOODED || 512;
const COMBOS = [0, SPR.NIGHT, SPR.DAMAGED, SPR.PILINGS, SPR.SCAFFOLD, SPR.RUIN, SPR.BOARDED, SPR.FRONT_L, SPR.NIGHT | SPR.PILINGS | SPR.BOARDED, FL, FL | SPR.NIGHT | SPR.DAMAGED, SPR.DAMAGED | SPR.FRONT_L];
const e0 = errs();
let baked = 0, bad = [];
const t0 = performance.now();
let hdMB = 0;
for (const id of ROWS) {
  const row = cat[id];
  S.clear();   // 644 master-2 bakes would trip the 96 MB HD atlas cap (hdFallback → master 1 for every HD family); the game bakes lazily
  for (const v of COMBOS) for (const z of [1, 2]) {
    const nf = (v & SPR.SCAFFOLD) ? 3 : (v & SPR.NIGHT) ? 4 : 1;
    for (let f = 0; f < nf; f++) {
      const e = S.get(id, v, f, z); baked++;
      if (!e) { bad.push(id + ' v' + v + ' f' + f + ' z' + z + ' null'); continue; }
      const gb = S.buildingBox(row, v, 1, 0);
      if (e.w !== gb.w * z || e.h !== gb.h * z || e.ox !== gb.ox * z || e.oy !== gb.oy * z) bad.push(id + ' v' + v + ' z' + z + ' geometry ' + JSON.stringify([e.w, e.h, e.ox, e.oy]) + ' vs ' + JSON.stringify([gb.w * z, gb.h * z, gb.ox * z, gb.oy * z]));
      if (!e.hd) bad.push(id + ' v' + v + ' z' + z + ' not hd');
    }
  }
  hdMB = Math.max(hdMB, S.hdMemoryMB());
}
const bakeMs = performance.now() - t0;
ok(S.hdFallback === false, 'the HD atlas cap did not trip during one row\'s combos (hdMemoryMB peak ' + hdMB.toFixed(1) + ')');
ok(bad.length === 0, `every converted row × ${COMBOS.length} variant combos × masters 1 + 2 bakes with buildingBox's canvas and anchor (${baked} bakes, ${bakeMs.toFixed(0)} ms)` + (bad.length ? ': ' + bad.slice(0, 6).join(' | ') : ''));
eq(errs(), e0, 'no BSU.error during the bakes');
// the pen painter's geometry for the same (row, variant) — the HD composer must not have moved anything
let geoBad = [];
for (const id of ROWS) for (const v of [0, SPR.PILINGS, SPR.FRONT_L]) {
  const c = S.newCanvas(1, 1), g = S.ctx2d(c); const pen = S.paintBuilding(g, cat[id], v, 0, 1, 7, 0); const hd = S.get(id, v, 0, 1);
  if (!hd || pen.w !== hd.w || pen.h !== hd.h || pen.ox !== hd.ox || pen.oy !== hd.oy) geoBad.push(id + ' v' + v);
}
ok(geoBad.length === 0, 'anchors and canvases equal the pixel painter\'s for every converted row (base, PILINGS, FRONT_L)' + (geoBad.length ? ': ' + geoBad.join(',') : ''));
// rotation
{ const r = S.get('dorm:r', 0, 0, 1), gb = S.buildingBox(cat.dorm, 0, 1, 1); ok(r && r.w === gb.w && r.ox === gb.ox && gb.fw === 2 && gb.fh === 3, 'dorm:r bakes with the swapped footprint'); }
{ const r = S.get('bunkhouse:r', SPR.NIGHT, 1, 2); ok(r && r.hd && r.zoom === 2, 'bunkhouse:r NIGHT at master 2'); }
// frames
S.get('dorm', SPR.NIGHT, 0, 1); eq(S.frames('dorm', SPR.NIGHT), 4, 'NIGHT: 4 frames');
S.get('dorm', SPR.SCAFFOLD, 0, 1); eq(S.frames('dorm', SPR.SCAFFOLD), 3, 'SCAFFOLD: 3 frames');
S.get('water_tower', 0, 0, 1); eq(S.frames('water_tower'), 4, 'water_tower: 4 frames (sway / topple)');
S.get('founders_hall', 0, 0, 1); eq(S.frames('founders_hall'), 1, 'founders_hall: 1 frame');
S.get('water_tower', 0, 3, 2); ok(true, 'water_tower toppled frame at master 2');

// --- pending rows still bake through the pen (pixel-doubled at master 2) --------
const PENDING = Object.keys(cat).filter((id) => !ROWS.includes(id) && cat[id].kind === 'footprint');
let penBad = [];
S.clear();
for (const id of PENDING) { const a = S.get(id, 0, 0, 1), b = S.get(id, 0, 0, 2); if (!a || !b || b.w !== a.w * 2 || b.h !== a.h * 2 || b.ox !== a.ox * 2 || a.hd || b.hd) penBad.push(id); }
ok(penBad.length === 0, `every pending footprint row (${PENDING.length}: ${PENDING.slice(0, 5).join(',')}…) bakes through the pen (hd false) at master 1 and pixel-doubles at master 2` + (penBad.length ? ': ' + penBad.join(',') : ''));
ok(S.get('union', SPR.NIGHT, 0, 1) && S.frames('union', SPR.NIGHT) === 4 && S.get('stadium', 0, 0, 1) && S.get('tiger_habitat', SPR.DAMAGED, 0, 1), 'union NIGHT (4 frames), stadium, tiger_habitat DAMAGED still bake (pen)');
ok(S.get('icon:dorm', 0, 0, 1) && S.get('icon:dorm', 0, 0, 1).sw === 64, 'icon:dorm stays the pen icon (64×64)');

// --- the bldlight companion --------------------------------------------------
let lightBad = [];
for (const id of ROWS) {
  for (const v of [0, SPR.NIGHT, SPR.NIGHT | SPR.FRONT_L, SPR.NIGHT | SPR.PILINGS]) {
    const l = S.get('bldlight:' + id, v, 1, 1), d = S.get(id, v | SPR.NIGHT, 1, 1);
    if (!l || !d || l.w !== d.w || l.h !== d.h || l.ox !== d.ox || l.oy !== d.oy || !l.hd) lightBad.push(id + ' v' + v);
  }
}
ok(lightBad.length === 0, 'bldlight:<id> has the day / night sprite\'s canvas and anchor for every converted row (base, NIGHT, FRONT_L, PILINGS)' + (lightBad.length ? ': ' + lightBad.join(',') : ''));
S.get('bldlight:dorm', SPR.NIGHT, 0, 1); eq(S.frames('bldlight:dorm', SPR.NIGHT), 4, 'bldlight: 4 night frames');
{ const r = S.get('bldlight:dorm:r', SPR.NIGHT, 0, 1), gb = S.buildingBox(cat.dorm, SPR.NIGHT, 1, 1); ok(r && r.w === gb.w && r.ox === gb.ox, 'bldlight:dorm:r uses the rotated footprint'); }
{ const cells = S.hdBuildingCells('dorm', SPR.NIGHT, 0, 0); ok(cells && cells.cells.length > 10 && cells.cells.some((c) => c.lit) && cells.cells.some((c) => !c.lit), 'hdBuildingCells(dorm, NIGHT): a window grid with lit and dark cells');
  const day = S.hdBuildingCells('dorm', 0, 0, 0); ok(day && day.cells.length === cells.cells.length && day.cells.every((c) => !c.lit), 'the day layout has the same cells, none lit');
  const f1 = S.hdBuildingCells('dorm', SPR.NIGHT, 1, 0); ok(f1.cells.some((c, i) => c.lit !== cells.cells[i].lit), 'night frames differ in their lit pattern');
  const again = S.hdBuildingCells('dorm', SPR.NIGHT, 0, 0); ok(JSON.stringify(again.cells.map((c) => [c.lit, c.quad])) === JSON.stringify(cells.cells.map((c) => [c.lit, c.quad])), 'the layout is deterministic');
  const g = cells.g, inside = cells.cells.every((c) => c.quad.every((p) => p[0] >= 0 && p[0] <= g.w && p[1] >= 0 && p[1] <= g.h)); ok(inside, 'every window quad lies inside the sprite canvas'); }
{ const w = S.hdBuildingCells('suites', SPR.NIGHT, 0, 0), bk = S.hdBuildingCells('bunkhouse', SPR.NIGHT, 0, 0), t = S.hdBuildingCells('water_tower', SPR.NIGHT, 0, 0); ok(w.cells.length > 10 && bk.cells.length >= 5 && t.cells.length === 0, 'suites (two wings) and bunkhouse (breezeway gap) lay out cells; the water tower has none'); }
// the companion draws lights only where the day sprite has lit cells: spy on brush.light
{ const calls = []; const orig = B.light; B.light = function (c, s, e) { calls.push(s); return orig.call(B, c, s, e); };
  S.unregisterPainter('bldlight'); // force a re-bake path: re-run the module registration by reloading the file
  vm.runInContext(src, ctx, { filename: 'sprites_buildings_hd.js' });
  S.get('bldlight:founders_hall', SPR.NIGHT, 2, 1);
  const quads = calls.filter((s) => s.quad), lit = S.hdBuildingCells('founders_hall', SPR.NIGHT, 2, 0).cells.filter((c) => c.lit);
  ok(quads.length >= lit.length && quads.length <= lit.length + 1 && calls.some((s) => s.r) && calls.some((s) => s.pool), `the companion lights ${lit.length} lit cells (+ the transom) with brush.light quads, plus lamp blooms and pools`);
  B.light = orig; }

// --- lod branches: master 2 (lod 0) draws the courses / mullions / grain that master 1 skips ----
{ const count = (fn, id, v, z) => { let n = 0; const o = B[fn]; B[fn] = function () { n++; return o.apply(B, arguments); }; S.unregisterPainter('building'); vm.runInContext(src, ctx, { filename: 'sprites_buildings_hd.js' }); S.get(id, v, 0, z); B[fn] = o; return n; };
  const s1 = count('stroke', 'dorm', 0, 1), s2 = count('stroke', 'dorm', 0, 2);
  ok(s2 > s1 * 1.5, `lod 0 (master 2) strokes the brick courses, mullions and joints that lod 1 skips (strokes: master 1 ${s1}, master 2 ${s2})`);
  const g1 = count('microGrain', 'founders_hall', 0, 1), g2 = count('microGrain', 'founders_hall', 0, 2);
  ok(g2 >= g1, `microGrain is a brush-side lod switch (calls master 1 ${g1}, master 2 ${g2})`);
  const r1 = count('roofPlane', 'founders_hall', 0, 1), r2 = count('roofPlane', 'founders_hall', 0, 2); ok(r1 === 4 && r2 === 4, 'the hip roof is four roofPlane calls at both masters');
  const c1 = count('column', 'founders_hall', 0, 1); ok(c1 >= 6, `Founders' Hall stands its 6 portico columns on brush.column (+ lamps): ${c1}`);
  const f1 = count('fillQuadShaded', 'engineering', 0, 2); ok(f1 > 20, `engineering: walls, parapet, windows and gear through fillQuadShaded (${f1})`); }

// --- states through the composer -------------------------------------------
{ const count = (fn, id, v, f) => { let n = 0; const o = B[fn]; B[fn] = function () { n++; return o.apply(B, arguments); }; S.unregisterPainter('building'); vm.runInContext(src, ctx, { filename: 'sprites_buildings_hd.js' }); S.get(id, v, f, 2); B[fn] = o; return n; };
  ok(count('column', 'library', SPR.SCAFFOLD, 1) > 10 && count('column', 'library', SPR.SCAFFOLD, 0) < 10, 'SCAFFOLD frame 1 raises the scaffold standards (+ crane) that frame 0 (slab) lacks');
  ok(count('glow', 'dorm', SPR.NIGHT, 0) > 5 && count('glow', 'dorm', 0, 0) === 0, 'NIGHT lights panes with brush.glow; the day sprite has none');
  ok(count('column', 'dorm', SPR.PILINGS, 0) > count('column', 'dorm', 0, 0) + 6, 'PILINGS stands the box on bark stilts (brush.column)');
  ok(count('edgeFade', 'dorm', FL, 0) > count('edgeFade', 'dorm', 0, 0), 'FLOODED adds the waterline and wet-apron fades');
  ok(count('orb', 'dorm', SPR.RUIN, 0) > 15, 'RUIN is a rubble mound of orbs'); }
// tees through bakeWith
{ const code = S.teeCode(0, 1, BSU.SURF.PATH), code2 = S.teeCode(1, 0, BSU.SURF.BOARDWALK);
  const e = S.bakeWith('dorm', 0, 0, 2, { tees: [code, code2] }); ok(e && e.hd && e.w === S.buildingBox(cat.dorm, 0, 1, 0).w * 2, 'bakeWith(tees) composes the connectors at master 2 on the same canvas');
  ok(S.teeable(cat.dorm, 0) === true && S.teeable(cat.bunkhouse, 0) === false, 'teeable rules are the pen\'s (unchanged)'); }
// the atlas cap: an HD building at master 2 counts toward hdMemoryMB; a pen-delegated row does not
ok(hdMB > 0.5, 'master-2 building entries count toward the HD atlas bytes (peak ' + hdMB.toFixed(1) + ' MB for one row\'s combos)');
{ S.clear(); S.get('union', 0, 0, 2); const penMB = S.hdMemoryMB(); S.get('dorm', 0, 0, 2); ok(penMB === 0 && S.hdMemoryMB() > 0, 'a pen-delegated row at master 2 adds no HD bytes; an HD row does (' + S.hdMemoryMB().toFixed(2) + ' MB)'); }

// --- render: getRef asks HD families at hdMaster -----------------------------
const rsrc = readFileSync(join(root, 'src', 'js', 'render.js'), 'utf8');
ok(/function getRef\(id, variant, frame\) \{[^\n]*sp\.isHD\(id\)\) \? hdMaster : atlasZoom/.test(rsrc), 'render.getRef fetches HD families at hdMaster (zoom 1 on a Retina lands the master-2 building at 1 art px = 1 device px)');
ok(/const z = \(hdOn && S\(\)\.isHD\(id\)\) \? hdMaster : \(atlasZoom >= 2 \? 2 : 1\);/.test(rsrc), 'render.teeRef bakes tee sprites at the same master as getRef');

// --- selfTest hook -----------------------------------------------------------
{ S.clear(); const r = S.selfTest(); ok(r && r.ok, 'sprites.selfTest (incl. the H2a _tests entry) ok: ' + (r && r.notes ? String(r.notes).slice(0, 160) : '')); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
