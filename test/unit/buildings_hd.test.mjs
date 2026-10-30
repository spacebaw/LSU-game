// Unit test for src/js/sprites_buildings_hd.js (H2a + H2b buildings passes): loads the manifest up to sprites_buildings_hd.js through
// makeWindow() from test/domstub.mjs with vm.runInContext; asserts the source rules (brush calls only, registerHD), that every footprint
// row but the three vegetation rows is HD (H2b: 32 rows) and live_oak / cypress / azalea still bake through the pen (pixel-doubled at master 2),
// every converted row × variant combo × master bakes without throwing or raising BSU.error, anchors / canvases equal the pen
// painter's (buildingBox and a direct paintBuilding bake), the frame rules (NIGHT 4, SCAFFOLD 3, water_tower 4), the bldlight
// companion's geometry and its lit cells, the lod branches, rotation, tees, and the render getRef / tee master rule; H2b: the stadium's
// four tiers over sprites.stadiumGeom with the field rectangle render.fieldQuad expects, the practice field's tiers, `habfront` HD with the
// pen's canvas rule, the rec centre's own box (pool deck), the own-ground bodies, and the companion hooks (mast heads, the den).
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
ok(/registerHD\('building'/.test(code) && /registerHD\('bldlight'/.test(code) && /registerHD\('habfront'/.test(code) && !/registerPainter\(/.test(code), 'registers building + bldlight + habfront through registerHD only');
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
ok(S.isHD('dorm') && S.isHD('founders_hall:r') && S.isHD('bldlight:dorm') && S.isHD('habfront') && S.hdFamilies().includes('building'), 'building, bldlight and habfront are HD families');
const ROWS = S.hdBuildingRows();
const VEG = ['live_oak', 'cypress', 'azalea'];   // veg entities in play (buildings.place plants them): the pen until H3
const WANT = Object.keys(cat).filter((id) => cat[id].kind === 'footprint' && !VEG.includes(id));
eq(ROWS.length, 32, '32 converted rows (every footprint row but the three vegetation rows)');
ok(WANT.every((id) => ROWS.includes(id)) && ROWS.every((id) => WANT.includes(id)), 'the converted rows are exactly the footprint rows of B_ORDER minus the vegetation rows: ' + ROWS.join(','));
ok(BSU.B_ORDER.every((id) => cat[id].kind !== 'footprint' || VEG.includes(id) || S.isHDBuilding(id)), 'every building row of B_ORDER is HD');
ok(S.isHDBuilding('dorm') && S.isHDBuilding('dorm:r') && S.isHDBuilding('union') && S.isHDBuilding('stadium:r') && !S.isHDBuilding('live_oak') && !S.isHDBuilding('tile:4'), 'isHDBuilding(id) by base id');
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
for (const id of PENDING) { const a = S.get(id, 0, 0, 1), b = S.get(id, 0, 0, 2), tree = id === 'cypress' || id === 'azalea'; if (!a || !b || b.w !== a.w * 2 || b.h !== a.h * 2 || b.ox !== a.ox * 2 || (tree ? !(a.hd && b.hd) : (a.hd || b.hd))) penBad.push(id); }   // H3: the cypress / azalea ids are also the TREE families, which sprites_vegetation_hd.js (loaded before this file) bakes HD; live_oak has no tree family of its own (the oak is 'oak') and stays the pen
ok(PENDING.length === 3 && penBad.length === 0, `the vegetation rows (${PENDING.join(',')}): live_oak bakes through the pen (hd false) at master 1 and pixel-doubles at master 2; cypress / azalea resolve to their H3 tree families (hd true at both masters)` + (penBad.length ? ': ' + penBad.join(',') : ''));
ok(S.get('union', SPR.NIGHT, 0, 1).hd && S.frames('union', SPR.NIGHT) === 4 && S.get('stadium', 0, 0, 1).hd && S.get('tiger_habitat', SPR.DAMAGED, 0, 1).hd, 'union NIGHT (4 frames), stadium, tiger_habitat DAMAGED bake HD');
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
{ S.clear(); S.get('live_oak', 0, 0, 2); const penMB = S.hdMemoryMB(); S.get('dorm', 0, 0, 2); ok(penMB === 0 && S.hdMemoryMB() > 0, 'a pen-delegated row at master 2 adds no HD bytes; an HD row does (' + S.hdMemoryMB().toFixed(2) + ' MB)'); }

// --- render: getRef asks HD families at hdMaster -----------------------------
const rsrc = readFileSync(join(root, 'src', 'js', 'render.js'), 'utf8');
ok(/function getRef\(id, variant, frame\) \{[^\n]*sp\.isHD\(id\)\) \? hdMaster : atlasZoom/.test(rsrc), 'render.getRef fetches HD families at hdMaster (zoom 1 on a Retina lands the master-2 building at 1 art px = 1 device px)');
ok(/const z = \(hdOn && S\(\)\.isHD\(id\)\) \? hdMaster : \(atlasZoom >= 2 \? 2 : 1\);/.test(rsrc), 'render.teeRef bakes tee sprites at the same master as getRef');


// --- H2b: tiers, the stadium's field rectangle, habfront, the rec centre's box, own-ground bodies, companion hooks ----
{
  const TS = SPR.TIER_SHIFT, fpOf = (g, X, Y, up) => [g.ax + (g.fh - g.fw) * 32 + X * 32 - Y * 32, g.ay + 16 + (X * 32 + Y * 32) / 2 - (g.fw + g.fh) * 16 - (up || 0) - g.lift];
  let tierBad = [];
  for (const [id, tiers] of [['stadium', [1, 2, 3]], ['practice_field', [1]]]) for (const tier of tiers) { S.clear(); for (const v0 of [0, SPR.NIGHT, SPR.SCAFFOLD, SPR.DAMAGED, SPR.FRONT_L]) for (const z of [1, 2]) { const v = (v0 | (tier << TS)) >>> 0, nf = (v & SPR.SCAFFOLD) ? 3 : (v & SPR.NIGHT) ? 4 : 1; for (let f = 0; f < nf; f++) { const e = S.get(id, v, f, z), gb = S.buildingBox(cat[id], v, 1, 0); if (!e || !e.hd || e.w !== gb.w * z || e.h !== gb.h * z || e.oy !== gb.oy * z) tierBad.push(id + ' t' + tier + ' v' + v0 + ' z' + z); } } }
  ok(tierBad.length === 0, 'stadium tiers I–III and Bayou Field bake HD at both masters with buildingBox\'s canvas (the tier-dependent extraTop)' + (tierBad.length ? ': ' + tierBad.slice(0, 5).join(' | ') : ''));
  { const g1 = S.buildingBox(cat.stadium, 1 << TS, 1, 0), g3 = S.buildingBox(cat.stadium, 3 << TS, 1, 0); ok(g3.h > g1.h + 100 && g3.bowlRect && g1.bowlRect, 'the stadium canvas grows with the tier (render\'s bowlRect stays buildingBox\'s)'); }
  // the field rectangle: stadiumGeom's field is what render.fieldQuad expects, and the HD stadium paints its first turf stripe on exactly that rect
  const SG = S.stadiumGeom(1, cat.stadium.w, cat.stadium.h), f = SG.field;
  ok(f.x0 === 1 && f.y0 === 1 && f.x1 === cat.stadium.w - 1 && f.y1 === cat.stadium.h - 1 && /x0: 1, y0: 1, x1: fw - 1, y1: fh - 1/.test(rsrc), 'stadiumGeom.field = render.fieldQuad(stadium) = (1, 1)–(fw − 1, fh − 1): unchanged');
  ok(/x0: 0\.6, y0: 0\.3, x1: fw - 0\.6, y1: fh - 0\.3/.test(rsrc) && /x0: 0\.6, y0: 0\.3, x1: fw - 0\.6, y1: fh - 0\.3/.test(code), 'the practice field paints its boundary on render.fieldQuad(practice_field)\'s rect (0.6 / 0.3 in)');
  { const quads = []; const o = B.fillQuadShaded; B.fillQuadShaded = function (c, pts) { quads.push(pts.map((p) => p.slice())); return o.apply(B, arguments); }; S.unregisterPainter('building'); vm.runInContext(src, ctx, { filename: 'sprites_buildings_hd.js' }); S.clear(); S.get('stadium', (1 << TS) >>> 0, 0, 1); B.fillQuadShaded = o;
    const g = S.buildingBox(cat.stadium, 1 << TS, 1, 0), a = f.x0, c = f.x0 + (f.x1 - f.x0) / 8, want = [fpOf(g, a, f.y0), fpOf(g, c, f.y0), fpOf(g, c, f.y1), fpOf(g, a, f.y1)];
    const near = (q) => q.length === 4 && q.every((p, i) => Math.abs(p[0] - want[i][0]) < 1e-6 && Math.abs(p[1] - want[i][1]) < 1e-6);
    ok(quads.some(near), 'the HD stadium\'s first turf stripe is painted on stadiumGeom.field in the pen\'s fpPt geometry (the football overlay lands on the turf)');
    const stands = quads.filter((q) => q.length === 4).length; ok(stands > 40, `tier I stands, press box and treads are fillQuadShaded planes (${quads.length} quads)`); }
  { const calls = []; const o = B.light; B.light = function (c, sp) { calls.push(sp); return o.apply(B, arguments); }; S.unregisterPainter('bldlight'); vm.runInContext(src, ctx, { filename: 'sprites_buildings_hd.js' }); S.clear(); S.get('bldlight:stadium', ((2 << TS) | SPR.NIGHT) >>> 0, 0, 1); B.light = o;
    const g = S.buildingBox(cat.stadium, 2 << TS, 1, 0), G2 = S.stadiumGeom(2, g.fw, g.fh), heads = G2.masts.map((m) => fpOf(g, m[0], m[1], m[2] + m[3]));
    const hit = heads.filter((h) => calls.some((sp) => sp.r && Math.abs(sp.x - h[0]) < 1e-6 && Math.abs(sp.y - (h[1] + 2)) < 1e-6)).length;
    ok(hit === heads.length && heads.length === 6, `the stadium companion blooms every mast head of stadiumGeom (${hit}/${heads.length}) — where render_fx aims its game-night cones`);
    ok(calls.some((sp) => sp.quad), 'and lights the scoreboard / luxury boxes as quads'); }
  // habfront: HD, laid out like the building with its empty top dropped (y0 = ay − 56), both masters, both entrances
  let hfBad = [];
  for (const v of [0, SPR.NIGHT, SPR.FRONT_L, SPR.DAMAGED, SPR.BOARDED, FL, SPR.NIGHT | SPR.FRONT_L | FL]) for (const z of [1, 2]) { const h = S.get('habfront', v, 0, z), gb = S.buildingBox(cat.tiger_habitat, v, 1, 0), y0 = Math.max(0, gb.ay - 56); if (!h || !h.hd || h.w !== gb.w * z || h.h !== (gb.h - y0) * z || h.ox !== gb.ox * z || h.oy !== (gb.oy + y0) * z) hfBad.push('v' + v + ' z' + z); }
  ok(hfBad.length === 0, 'habfront bakes HD with the pen\'s canvas rule (building width, height − (ay − 56), anchor shifted) at masters 1 + 2' + (hfBad.length ? ': ' + hfBad.join(',') : ''));
  ok(S.get('habfront', SPR.SCAFFOLD, 0, 1) && S.get('tiger_habitat', SPR.SCAFFOLD, 2, 2).hd && S.get('tiger_habitat', SPR.RUIN, 0, 1).hd, 'the habitat\'s three construction stages and ruin bake');
  { const cnt = (fn, id, v) => { let n = 0; const o = B[fn]; B[fn] = function () { n++; return o.apply(B, arguments); }; S.unregisterPainter('building'); vm.runInContext(src, ctx, { filename: 'sprites_buildings_hd.js' }); S.clear(); S.get(id, v, 0, 2); B[fn] = o; return n; };
    ok(cnt('tree', 'quad', 0) === 1 && cnt('tree', 'rookery', 0) === 1 && cnt('tree', 'tiger_habitat', 0) === 1, 'the quad\'s live oak, the rookery\'s cypress and the habitat\'s shade oak are brush.tree');
    ok(cnt('path', 'quad', 0) === 2, 'the quad\'s two gravel paths are brush.path');
    ok(cnt('blade', 'pond', 0) >= 10 && cnt('puddle', 'pond', 0) >= 1, 'the pond: reed blades round a puddle');
    ok(cnt('glow', 'stadium', ((2 << TS) | SPR.NIGHT) >>> 0) > 10 && cnt('glow', 'stadium', (2 << TS) >>> 0) === 0, 'the Cauldron at night glows (slits, boxes, mast banks); by day nothing glows');
    ok(cnt('column', 'bat_house', 0) >= 1 && cnt('orb', 'bat_house', 0) >= 12, 'the bat house: a pole with six gourds'); }
  // the rec centre's own box (HD_ROWS.box / boxL): the window cells sit on the shortened box, and FRONT_L swaps it
  { const a = S.hdBuildingCells('rec_center', SPR.NIGHT, 0, 0), b2 = S.hdBuildingCells('rec_center', SPR.NIGHT | SPR.FRONT_L, 0, 0);
    ok(a && a.cells.length >= 4 && b2 && b2.cells.length >= 4, 'rec_center lays out window cells on its own box');
    const xs = a.cells.map((c) => c.quad[0][0]), xs2 = b2.cells.map((c) => c.quad[0][0]);
    ok(Math.min(...xs) !== Math.min(...xs2) || Math.max(...xs) !== Math.max(...xs2), 'under FRONT_L the box moves (boxL) so the pool deck faces the other way'); }
  // own-ground rows: no margins (no lamps), the body paints the ground; margins / hedges / fence skipped
  { const cnt = (fn, id, v) => { let n = 0; const o = B[fn]; B[fn] = function () { n++; return o.apply(B, arguments); }; S.unregisterPainter('building'); vm.runInContext(src, ctx, { filename: 'sprites_buildings_hd.js' }); S.clear(); S.get(id, v, 0, 1); B[fn] = o; return n; };
    ok(cnt('column', 'quad', 0) === 0 && cnt('column', 'pond', 0) === 2, 'quad / pond: no entrance lamps (own ground); the pond\'s only columns are its pier posts'); }
  // tees still reach the converted rows that take them; the own-ground rows take none (the pen\'s rule)
  ok(S.teeable(cat.union, 0) === true && S.teeable(cat.dining_hall, 0) === true, 'teeable: union / dining hall take connectors');
  // every converted row has its light companion (asserted above for ROWS); the decals re-expressed as props are in HD_ROWS
  { const P = S.HD_ROWS; const kinds = (id) => (P[id].props || []).map((p) => p.kind);
    ok(kinds('dining_hall').includes('boilpot') && kinds('dining_hall').includes('dumpster') && kinds('union').includes('fountain') && kinds('rec_center').includes('pool') && kinds('abatement').includes('truck') && kinds('wildlife_post').includes('airboat') && kinds('marsh_restoration').includes('lookout'), 'boilpot, dumpster, fountain, pool, truck, airboat and lookout are placed as props'); }
}

// --- H7: the stadium's own DAMAGED / FLOODED / BOARDED states, the Tiger Habitat's single pool, the surge barrier icon --------------------------
try {
  const TS = SPR.TIER_SHIFT;
  const cnt = (fn, id, v, z) => { let n = 0; const o = B[fn]; B[fn] = function () { n++; return o.apply(B, arguments); }; S.unregisterPainter('building'); vm.runInContext(src, ctx, { filename: 'sprites_buildings_hd.js' }); S.clear(); S.get(id, v, 0, z || 2); B[fn] = o; return n; };
  const T2 = (2 << TS) >>> 0, T3 = (3 << TS) >>> 0, T1 = (1 << TS) >>> 0, FLD = SPR.FLOODED || 512;
  ok(/const OWN_STATES = \{ habitat: 1, stadium: 1 \}/.test(src), 'the stadium dresses its own states (OWN_STATES)');
  ok(cnt('puddle', 'stadium', T2 | FLD) > cnt('puddle', 'stadium', T2) && cnt('puddle', 'stadium', T2 | FLD, 1) >= 0, 'FLOODED: the bowl gets its own water (rings on the turf), not the generic wet-apron edges (puddle calls ' + cnt('puddle', 'stadium', T2 | FLD) + ' vs ' + cnt('puddle', 'stadium', T2) + ')');
  ok(cnt('edgeFade', 'stadium', T2 | FLD) > cnt('edgeFade', 'stadium', T2) + 3, 'FLOODED: the waterline stain, the lapped first treads and the wet apron are edge fades');
  ok(cnt('orb', 'stadium', T2 | SPR.DAMAGED) >= cnt('orb', 'stadium', T2) + 12 && cnt('fillQuadShaded', 'stadium', T2 | SPR.DAMAGED) > cnt('fillQuadShaded', 'stadium', T2), 'DAMAGED: a tarp over a torn stand section with its sandbags, seat bits on the turf, a crack and a bent mast: more orbs and quads than the sound stadium');
  ok(cnt('glow', 'stadium', (T3 | SPR.NIGHT | SPR.BOARDED) >>> 0) < cnt('glow', 'stadium', (T3 | SPR.NIGHT) >>> 0), 'BOARDED: the luxury boxes are plywood, so they no longer glow at night');
  ok(cnt('glow', 'stadium', (T1 | SPR.NIGHT | SPR.BOARDED) >>> 0) < cnt('glow', 'stadium', (T1 | SPR.NIGHT) >>> 0), 'BOARDED: the tier I press box and ticket booth windows are boarded too');
  let bad = [];
  for (const t of [T1, T2, T3]) for (const v0 of [SPR.DAMAGED, FLD, SPR.BOARDED, SPR.DAMAGED | FLD | SPR.BOARDED, SPR.NIGHT | FLD, SPR.NIGHT | SPR.DAMAGED]) for (const z of [1, 2]) { S.clear(); const e = S.get('stadium', (t | v0 | SPR.FRONT_L) >>> 0, 0, z), g = S.buildingBox(cat.stadium, (t | v0 | SPR.FRONT_L) >>> 0, 1, 0); if (!e || !e.hd || e.sw !== g.w * z || e.sh !== g.h * z) bad.push(t + '/' + v0 + '@' + z); }
  ok(bad.length === 0, 'every stadium state × tier bakes HD at both masters with the sprite\'s own canvas size' + (bad.length ? ': ' + bad.slice(0, 5).join(', ') : ''));
  ok(/const poolBlob = \(k, bridge\) =>/.test(src) && /poolBlob\(0\.68, 0\.95\)/.test(src) && !/for \(const c of H\.POOL\) ell\(/.test(src), 'the habitat pool is ONE blob: every layer (sand, shallows, deep, the pit, the flood swirl) walks the metaballs plus the discs between them, so the deep water has no gap');
  for (const v0 of [0, SPR.NIGHT, SPR.DAMAGED, FLD, SPR.FRONT_L, SPR.SCAFFOLD]) for (const z of [1, 2]) { S.clear(); ok(S.get('tiger_habitat', v0, v0 === SPR.SCAFFOLD ? 1 : 0, z).hd, 'tiger_habitat bakes with the one-blob pool (' + v0 + ' @' + z + ')'); }
} catch (e) { ok(false, 'H7 buildings_hd: ' + (e.stack || e)); }

// --- selfTest hook -----------------------------------------------------------
{ S.clear(); const r = S.selfTest(); ok(r && r.ok, 'sprites.selfTest (incl. the H2a _tests entry) ok: ' + (r && r.notes ? String(r.notes).slice(0, 160) : '')); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
