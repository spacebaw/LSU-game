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

// --- stadium scale pass: the tier geometry render reads, the canvas growing with the tiers, the field kept clear ---
{
  const G0 = S.stadiumGeom(0), G1 = S.stadiumGeom(1), G2 = S.stadiumGeom(2), G3 = S.stadiumGeom(3);
  ok(typeof S.stadiumGeom === 'function' && G1 && G2 && G3, 'sprites.stadiumGeom(tier) exists');
  ok(G1.farRim === 28 && G2.farRim === 66 && G3.farRim === 112, 'far rims I 28 / II 66 / III 112 px (2× / 3× / 5× the old 14 / 22 / 22): ' + [G1.farRim, G2.farRim, G3.farRim].join('/'));
  ok(G2.endRim === 60 && G3.endRim === 88 && G1.nearRim === 14 && G2.nearRim === 24 && G3.nearRim === 26, 'left end II 60 / III 88; near rims 14 / 24 / 26');
  for (const G of [G1, G2, G3]) {
    ok(G.field.x0 === 1 && G.field.y0 === 1 && G.field.x1 === 5 && G.field.y1 === 4, 'tier ' + G.tier + ' field {1,1,fw-1,fh-1} (render.fieldQuad)');
    // a stand seen from behind lifts its back wall h px, covering the ground h/32 tiles toward the field: must stop at the field edge
    for (const st of G.stands) {
      if (st.inner === 'y0') ok(st.r.y1 - st.hOut / 32 >= G.field.y1 - 1e-9, 'tier ' + G.tier + ' near stand (' + st.hOut + ' px) stays off the near sideline');
      if (st.inner === 'x0') ok(st.r.x1 - st.hOut / 32 >= G.field.x1 - 1e-9, 'tier ' + G.tier + ' right end (' + st.hOut + ' px) stays off the right end line');
      ok(st.hOut > st.hIn && st.steps >= 3, 'tier ' + G.tier + ' ' + st.inner + ' deck ' + st.deck + ' rises ' + st.hIn + '→' + st.hOut);
    }
    ok(G.clip.length === G.stands.length && G.clip.every(q => q.length === 4), 'tier ' + G.tier + ' one 4-point shader clip quad per stand');
    ok(G.fanRows.length > 0 && G.fanRows.every(r => r.lift <= G.farRim && r.lift >= 0), 'tier ' + G.tier + ' fan rows sit between the turf and the far rim (' + G.fanRows.length + ' rows)');
    // no mast base inside the field quad and none on the near rim east of the field's left tip (it would cross the field on screen)
    for (const m of G.masts) {
      const inField = m[0] > G.field.x0 && m[0] < G.field.x1 && m[1] > G.field.y0 && m[1] < G.field.y1;
      ok(!inField, 'tier ' + G.tier + ' mast at (' + m[0] + ', ' + m[1] + ') is off the field');
      if (m[1] >= G.field.y1) ok(m[0] <= 1.0 + 1e-9, 'tier ' + G.tier + ' near-side mast (' + m[0] + ') stands at the near-left corner, not in front of the field');
      if (m[0] >= G.field.x1) ok(m[1] <= 1.2 + 1e-9, 'tier ' + G.tier + ' right-side mast (' + m[1] + ') stands past the far-right tip, not in front of the field');
    }
  }
  ok(G1.masts.length === 4 && G2.masts.length === 6 && G3.masts.length === 6, 'masts 4 / 6 / 6');
  ok(G1.pressBox && !G2.pressBox && G2.board && G2.board.kind === 'score' && G3.board && G3.board.kind === 'jumbo' && G3.crown && G3.boxes, 'I press box; II scoreboard; III jumbotron, crown and luxury boxes');
  ok(G0.cranes.length === 2 && G0.stands.length === 0, 'the site (tier 0) has two cranes and no stands');
  ok(G2.fanRows.length > G1.fanRows.length && G3.fanRows.length > G2.fanRows.length, 'more fan rows per tier: ' + [G1.fanRows.length, G2.fanRows.length, G3.fanRows.length].join('/'));
  ok(G3.fanRows.some(r => r.lift >= 84), 'tier III seats fans on the third deck');
  // canvases: the sprite grows with the tier (every tier shared one height before), 2× is exactly double, night shares the day size
  const h = [0, 1, 2, 3].map(t => S.get('stadium', t << SPR.TIER_SHIFT, 0, 1).sh), h2 = S.get('stadium', 3 << SPR.TIER_SHIFT, 0, 2).sh;
  ok(h[1] < h[2] && h[2] < h[3] && h[3] >= h[1] + 100, 'stadium canvas height grows I→II→III: ' + h.join('/'));
  ok(h2 === 2 * h[3], 'tier III 2× canvas is double the 1× height');
  ok(S.get('stadium', (3 << SPR.TIER_SHIFT) | SPR.NIGHT, 0, 1).sh === h[3], 'tier III night shares the day size');
  // every painted top (mast heads, the board, the crown) fits inside the canvas allowance above the far corner
  for (const G of [G1, G2, G3]) {
    const box = S.buildingBox(cat.stadium, G.tier << SPR.TIER_SHIFT, 1);
    const y = (X, Y, up) => box.ay + 16 + (X + Y - box.fw - box.fh) * 16 - up;
    let top = Infinity;
    for (const m of G.masts) top = Math.min(top, y(m[0], m[1], m[2] + m[3]) - 8);
    if (G.board) top = Math.min(top, y(G.board.X, G.board.Y, G.board.z) - 16 - G.board.h - 4);
    ok(top >= 0, 'tier ' + G.tier + ' highest painted point (' + top.toFixed(0) + ') is inside the canvas (extraTop ' + box.extraTop + ')');
    ok(box.bowlRect && box.bowlRect.y <= y(0.3, 0.1, G.farRim) - box.ay, 'tier ' + G.tier + ' bowlRect reaches the far rim');
  }
}

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

// --- art pass B6: catalog icons ---------------------------------------------
{
  const ids = BSU.data.catalogList.map((r) => r.id);
  // memory: an icon is the only atlas entry a footprint row adds (the FRONT_L building is painted on a scratch canvas and freed)
  const n0 = S.count(); S.get('icon:greek_house', 0, 0, 2);
  eq(S.count() - n0, 1, 'a footprint icon adds exactly one atlas entry');
  const bad = [], badLock = [];
  for (const id of ids) {
    const a = S.get('icon:' + id, 0, 0, 1), b = S.get('icon:' + id, 0, 0, 2), c = S.get('icon:' + id, 1, 0, 2);
    if (!(a && a.sw === 64 && a.sh === 64 && b && b.sw === 128 && b.sh === 128 && b.ox === -64 && b.oy === -64)) bad.push(id);
    if (!(c && c.sw === 128 && c.sh === 128)) badLock.push(id);
  }
  eq(ids.length, 46, 'the catalog has 46 rows (every one needs an icon)');
  eq(bad.join(','), '', 'every catalog row has a 64x64 icon and a 128x128 master (anchor at the centre)');
  eq(badLock.join(','), '', 'every catalog row has a locked 128x128 icon variant');
  // plans: what each kind of row shows
  const P = (id) => S.iconPlan(id);
  eq(P('path').items.length, 3, 'a drag row shows a three-tile run (3 stamps)');
  eq(P('path').items[0].v, 10, 'runs use the E+W mask (the lit SW side faces the viewer)');
  eq(P('boardwalk').deck, 'boardwalk', 'the boardwalk icon is drawn as a deck');
  eq(P('bridge').deck, 'bridge', 'the Pedestrian Bridge icon is drawn as a deck');
  ok(P('bridge').ground === 'water' && P('boardwalk').ground === 'marsh' && P('levee').ground === 'grass', 'drag rows stand on their own ground (water / marsh / grass)');
  eq(P('surge_barrier').items.map((i) => i.id).join(','), 'floodwall,surge_barrier,floodwall', 'the surge barrier is a gate between two wall tiles');
  eq(P('pilings').ground, 'water', 'pilings stand on a water slab');
  ok(P('pilings').items[0].v & SPR.PILINGS, 'pilings show the pilings variant');
  ok(P('dorm').items[0].v & SPR.FRONT_L, 'footprint rows face the entrance to the lit SW side (FRONT_L)');
  eq(P('stadium').items[0].v >> SPR.TIER_SHIFT & 3, 1, 'the stadium shows tier I');
  eq(P('live_oak').items[0].v, S.treeVariant(2, false, false, 0), 'the live oak icon is the mature full-crown tree');
  eq(P('cypress').items[0].v & 3, 2, 'the cypress icon is the mature tree (not the sapling)');
  ok(P('azalea').items.length >= 3 && (P('azalea').items[0].v & 8) && (P('azalea').items[0].v & 3) === 2, 'azaleas show three mature blooming bushes');
  ok(P('preserve').items.some((i) => i.id === 'preservePost') && P('preserve').ground === 'marsh', 'preserve is a marsh patch with its gold boundary posts');
  eq(P('poboy').foot, '1×1', 'footprint rows carry their size for the badge');
  eq(P('dorm').foot, '3×2', 'dorm is 3x2');
  // scale: ordered by size, small rows never vanish, only the exaggerated 1x1 rows wear the badge
  const ext = (id) => { const f = S.iconFit(id); return f.w; };
  ok(ext('poboy') >= 38, 'a po\'boy shack keeps a minimum drawn size (' + ext('poboy').toFixed(1) + ' px of 64)');
  ok(ext('poboy') < ext('dorm') && ext('dorm') < ext('library') && ext('library') <= ext('stadium') + 0.01, 'drawn width follows true size: poboy < dorm < library <= stadium');
  const badged = ids.filter((id) => S.iconFit(id).badge);
  ok(badged.length >= 3 && badged.every((id) => P(id).foot === '1×1'), 'the footprint badge appears only on 1x1 rows (' + badged.join(',') + ')');
  const over = ids.filter((id) => { const f = S.iconFit(id); return f.w > 60.01 || f.h > 60.01; });
  eq(over.join(','), '', 'every icon fits the 64-px frame');
  ok(S.get('icon:dorm', 0, 0, 2) === S.get('icon:dorm', 0, 0, 2), 'icons are cached once');
}

// --- habitat pass: the Tiger Habitat is a bespoke exhibit painter (sunken enclosure, pool, den, glass, plaza) ------------------
{
  const row = BSU.data.catalog.tiger_habitat, H = S.HABITAT, FL = SPR.FRONT_L, FLD = SPR.FLOODED;
  ok(H && Object.isFrozen(H) && typeof S.habitatWorld === 'function' && typeof S.habitatPool === 'function' && S.hasPainter('habfront'), 'the habitat layout (HABITAT, habitatWorld, habitatPool) and the habfront foreground painter are registered');
  const g = S.buildingBox(row, 0, 1, 0);
  ok(g.fw === 3 && g.fh === 3 && g.w === 196 && g.ox === -98 && g.extraTop === 30 && g.wallH === 0 && g.h === 130, `footprint and canvas size unchanged (3×3, ${g.w}×${g.h} px, ox ${g.ox}); it is low and wall-less, so no building shadow / AO box (wallH ${g.wallH}) and the oak's headroom is the old wall + extraTop (${g.extraTop})`);
  ok(row.paint.special === 'tiger_habitat' && row.w === 3 && row.h === 3 && row.effects.landmark === 8 && row.effects.happiness.radius === 15 && row.effects.gatorAvoidRadius === 10, 'the catalog row is untouched: special, 3×3, landmark +8, +5 happiness radius 15, gators avoid 10');
  // layout: plaza cells in front of the wall, the floor behind it, the pool where Roux swims and not where he naps
  ok(H.SPOT_X.every((x) => x > 2.08 && x < 3) && H.SPOT_Y.every((y) => y > 0.5 && y < 2.5), 'the viewing cells lie on the plaza (depth 2.08–3), inside the glass span');
  ok(H.ROUX.x1 < H.WALL_X - 0.3 && H.ROUX.x0 > H.FX0 && H.ROUX.y0 > H.FY0 && H.ROUX.y1 < H.FY1, 'Roux\'s bounds stay inside the enclosure floor, clear of the viewing wall');
  ok(S.habitatPool(H.SWIM[0][0], H.SWIM[0][1]) > 0 && S.habitatPool(H.SWIM[1][0], H.SWIM[1][1]) > 0 && S.habitatPool(H.NAP[0], H.NAP[1]) < -0.2, 'the swim legs start and end in the pool; the nap spot is dry, in the oak\'s shade');
  ok(S.habitatPool(2.5, 1.5) < 0 && S.habitatPool(0.8, 1.4) > 0.5, 'the pool field is positive in the pool and negative on the plaza');
  const w0 = S.habitatWorld(40, 30, false, 1.5, 0.5), w1 = S.habitatWorld(40, 30, true, 1.5, 0.5);
  ok(w0[0] === 41.5 && w0[1] === 30.5 && w1[0] === 40.5 && w1[1] === 31.5, 'habitatWorld maps local (depth, along) to world tiles and transposes under FRONT_L');
  // bakes: every state, both entrances, 1× and 2×
  const states = [0, SPR.NIGHT, SPR.DAMAGED, SPR.BOARDED, FLD, FLD | SPR.NIGHT, SPR.DAMAGED | SPR.NIGHT, SPR.PILINGS, SPR.RUIN];
  let bad = [];
  for (const v of states) for (const f of [0, FL]) for (const z of [1, 2]) { const e = S.get('tiger_habitat', v | f, 0, z); if (!e || e.sw !== g.w * z || e.sh !== g.h * z + (v & SPR.PILINGS ? 10 * z : 0)) bad.push(v + '|' + f + '|' + z); }
  eq(bad.join(' '), '', 'the habitat bakes in 9 states × 2 entrances × 2 zooms with the box size (night, damaged, boarded, flooded, pilings, ruin)');
  for (const f of [0, 1, 2]) ok(!!S.get('tiger_habitat', SPR.SCAFFOLD, f, 1), `construction stage ${f} goes through the scaffold pipeline`);
  eq(S.frames('tiger_habitat', SPR.NIGHT), 4, 'night still has the four building frames');
  // the foreground layer: same anchor and bottom as the building, much smaller canvas, per state
  for (const v of [0, FL, SPR.NIGHT | FL, FLD | FL, SPR.DAMAGED, SPR.BOARDED]) {
    const b = S.get('tiger_habitat', v, 0, 1), f = S.get('habfront', v, 0, 1);
    ok(b && f && f.ox === b.ox && f.sw === b.sw && f.oy + f.sh === b.oy + b.sh && f.sh < b.sh * 0.65, `habfront (variant ${v}) shares the building's anchor, width and bottom edge and is ${f ? f.sh : '?'} px tall against ${b ? b.sh : '?'}`);
  }
  // drawing: recorded fillRect streams (the DOM stub keeps no pixels): the states and entrances differ, nothing is painted outside the canvas
  const rec = (v) => {
    const c = S.newCanvas(1, 1), gx = S.ctx2d(c), calls = []; gx.fillRect = (x, y, w, h) => { calls.push([x, y, w, h, gx.fillStyle]); }; gx.drawImage = () => { calls.push(['img']); };
    S.paintBuilding(gx, row, v, 0, 1, 7, 0); return { calls, w: c.width, h: c.height };
  };
  const day = rec(0), dayL = rec(FL), night = rec(SPR.NIGHT), flood = rec(FLD), dmg = rec(SPR.DAMAGED), brd = rec(SPR.BOARDED);
  const sig = (r) => r.calls.map((q) => q.join(',')).join(';');
  ok(day.calls.length > 8000 && day.calls.length < 60000, `a day bake is ${day.calls.length} fillRects (a few thousand pixels of art; bounded)`);
  ok(sig(day) !== sig(dayL) && sig(day) !== sig(night) && sig(day) !== sig(flood) && sig(day) !== sig(dmg) && sig(day) !== sig(brd) && sig(night) !== sig(flood), 'entrance, night, flooded, damaged and boarded each paint differently');
  const outside = (r) => r.calls.filter((q) => q[0] !== 'img' && (q[0] < 0 || q[1] < 0 || q[0] + q[2] > r.w || q[1] + q[3] > r.h)).length;
  eq(outside(day) + outside(dayL) + outside(night) + outside(flood) + outside(dmg), 0, 'nothing is painted outside the sprite canvas');
  const nightColors = new Set(night.calls.map((q) => q[4])), dayColors = new Set(day.calls.map((q) => q[4]));
  ok([...nightColors].some((c) => /^#FFF1A8$|^#FFE680$/i.test(c)) && ![...dayColors].some((c) => /^#FFF1A8$/i.test(c)), 'night adds the warm lamp light; day has none');
  ok([...flood.calls.map((q) => q[4])].filter((c) => /^#7C9A92$/i.test(c)).length > 100, 'the flooded exhibit is full of floodwater (the pool has spilled)');
  // the icon is generated from the painter: the habitat's own sprite (FRONT_L) on the slab
  const pl = S.iconPlan('tiger_habitat');
  ok(pl.items.length === 1 && pl.items[0].id === 'tiger_habitat' && (pl.items[0].v & FL) && pl.foot === '3×3', 'the palette icon is the habitat painter\'s own sprite with the entrance on the lit side');
  ok(!!S.get('icon:tiger_habitat', 0, 0, 2) && !!S.get('icon:tiger_habitat', 1, 0, 2), 'the icon bakes unlocked and locked');
}

// --- P7 housing tiers: the Bayou Bunkhouse (economy) and Magnolia Suites (premium) painters ------------------------------
{
  const bk = BSU.data.catalog.bunkhouse, su = BSU.data.catalog.suites, e0 = BSU.errors.size;
  const bb = S.buildingBox(bk, 0, 1), sb = S.buildingBox(su, 0, 1);
  ok(bb.special === 'bunkhouse' && sb.special === 'suites', 'both rows resolve to their own painters');
  ok(bb.fw === 3 && bb.fh === 2 && bb.floors === 1 && bb.w === 5 * 32 + 4 && sb.fw === 3 && sb.fh === 3 && sb.floors === 3 && sb.w === 6 * 32 + 4, 'sizes: the Bunkhouse is one low storey on 3×2, the Suites three storeys on 3×3');
  eq(bb.oy + bb.h, 18, 'bunkhouse oy + h === 18'); eq(sb.oy + sb.h, 18, 'suites oy + h === 18');
  const V = [0, SPR.FRONT_L, SPR.NIGHT, SPR.NIGHT | SPR.FRONT_L, SPR.DAMAGED | SPR.FRONT_L, SPR.FLOODED | SPR.FRONT_L, SPR.BOARDED, SPR.PILINGS | SPR.FRONT_L, SPR.SCAFFOLD, SPR.SCAFFOLD | SPR.FRONT_L, SPR.RUIN, SPR.DAMAGED | SPR.NIGHT | SPR.PILINGS];
  const bad2 = [];
  for (const id of ['bunkhouse', 'suites', 'bunkhouse:r']) for (const v of V) for (const z of [1, 2]) for (const fr of [0, 1, 2]) {
    const e = S.get(id, v, fr, z); if (!e || !(e.sw > 0) || !(e.sh > 0)) bad2.push(id + ' v' + v + ' z' + z + ' f' + fr);
  }
  eq(bad2.join(','), '', 'both painters (and the rotated Bunkhouse) render every state at 1× and 2×');
  ok(S.get('bunkhouse:r', 0, 0, 1).w === S.get('bunkhouse', 0, 0, 1).w, 'rotating the Bunkhouse keeps the canvas size (3×2 ↔ 2×3)');
  ok(S.get('suites', SPR.PILINGS, 0, 1).h === S.get('suites', 0, 0, 1).h + 10, 'the Suites on pilings are 10 px taller');
  ok(S.teeable(BSU.data.catalog.dorm, 0) === true && S.teeable(bk, 0) === false && S.teeable(su, 0) === false, 'the two housing rows take no path-tee connectors (porch / courtyard fronts); the dorm still does');
  ok(S.APRON.housing.pattern === 'lawn', 'the housing tab keeps its lawn apron (the Bunkhouse stands in a gravel yard of its own)');
  ok(!!S.get('icon:bunkhouse', 0, 0, 2) && !!S.get('icon:suites', 1, 0, 2), 'icons bake from the painters (unlocked and locked)');
  ok(bk.paint.material === 'wood' && bk.paint.roof === 'gable' && bk.paint.special === 'bunkhouse' && su.paint.material === 'brick' && su.paint.roof === 'hip' && su.paint.special === 'suites' && su.paint.features.indexOf('gallery:both') >= 0, 'paint descriptors: tin gable + plank siding; brick hip + galleries');
  eq(BSU.errors.size, e0, 'painting the housing rows raised no BSU.error');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
