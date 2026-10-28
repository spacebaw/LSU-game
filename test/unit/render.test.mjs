// Unit test for src/js/render.js: loads every existing manifest module (in order) through makeWindow()
// from test/domstub.mjs with vm.runInContext (session.js boots the game at the end of its file), then
// checks init (canvas#world under #app), frame on an ungenerated state and on a new game, camera math
// round trips, chunk invalidation on tile:changed, the pass registry, and selfTest.
// Usage: node test/unit/render.test.mjs   (exit 1 on any failure)
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
const src = readFileSync(join(root, 'src', 'js', 'render.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
ok(!/OffscreanCanvas|new OffscreenCanvas/.test(src), 'no OffscreenCanvas');
ok(!/setTimeout|setInterval/.test(src.replace(/\/\/.*$/gm, '')), 'no timers for game logic');

// --- load every existing module in manifest order ----------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
let loadMs = 0;
for (const f of manifest) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  const t0 = performance.now();
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); }
  if (f === 'render.js') loadMs = performance.now() - t0;
}
ok(loadMs < 50, `render.js definition time ${loadMs.toFixed(1)} ms < 50 ms`);
const BSU = win.BSU;
const R = BSU.render;
ok(R && typeof R.init === 'function' && typeof R.reset === 'function' && typeof R.frame === 'function' && typeof R.selfTest === 'function' && !('tick' in R), 'module shape: init/reset/frame/selfTest, no tick');
for (const fn of ['resize', 'panBy', 'panTo', 'panToTile', 'setZoom', 'zoomStep', 'follow', 'screenToTile', 'tileToScreen', 'visibleTiles', 'shake', 'hitStop', 'flashTiles', 'ghost', 'dirtyChunk', 'dirtyAll', 'postcard', 'minimap', 'setOverlay', 'perf', 'captureCameraTouch', 'registerPass', 'chunkCanvas', 'anchorOf', 'entityScreen', 'tilePx', 'variantOf', 'renderInto', 'attachMinimap', 'drawPortrait', 'drawIcon'])
  ok(typeof R[fn] === 'function', 'public function ' + fn);
ok(Array.isArray(R.drawList) && Array.isArray(R._tests) && typeof R.hitStopUntil === 'number' && R.hoverTile === -1 && typeof R.squash === 'object' && R.particles && typeof R.particles.forEachWorld === 'function', 'hook surface: drawList, _tests, hitStopUntil, hoverTile, squash, particles stub');

// --- init happened at boot (session.boot → render.init) -----------------------
const app = win.document.getElementById('app');
const world = app.children.find((c) => c.id === 'world');
ok(!!world, 'init created canvas#world under #app');
ok(world && world.getAttribute('tabindex') === '0' && world.style.touchAction === 'none', '#world has tabindex=0 and touch-action none');
ok(R.ctx && R.canvas === world, 'render.ctx / render.canvas are the #world context and element');
ok(R.view.vw === 1280 && R.view.vh === 720 && R.view.dpr === 1, `view is the stub's 1280×720 at dpr 1 (${R.view.vw}×${R.view.vh})`);
const p0 = R.perf();
ok(Number.isFinite(p0.frameMs) && Number.isFinite(p0.memMB) && Number.isFinite(p0.chunks), 'perf() finite before any game');

// --- frame on the boot dummy (ungenerated) state must not throw ------------------
const errorsBefore = BSU.errors.size;
let threw = null;
try { R.frame(BSU.state, 0, 16.67); } catch (e) { threw = e; }
ok(!threw && BSU.errors.size === errorsBefore, 'frame on an ungenerated state: no throw, no BSU.error' + (threw ? ': ' + threw.stack : ''));

// --- new game, frames, chunks ---------------------------------------------------
BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 });
const s = BSU.state;
ok(R.camera === s.ui.camera, 'camera is the live state.ui.camera reference after newGame');
ok(R.camera.hasTarget === false && R.camera.follow === -1 && Number.isFinite(R.camera.x) && Number.isFinite(R.camera.y) && R.camera.zoom === 1, 'camera reset on newGame (finite, zoom 1, no target)');
const fx = BSU.plot = s.plot;
const want = R.tileToScreen(fx.founders.tx + 1, fx.founders.ty + 1);
ok(Math.abs(want.x - 640) < 1 && Math.abs(want.y - 360) < 1, `fresh game centers the camera on Founders' (${want.x.toFixed(1)}, ${want.y.toFixed(1)})`);
for (let k = 0; k < 5; k++) BSU.headless.render();
ok(BSU.errors.size === errorsBefore, 'five headless frames produced no BSU.error');
const p1 = R.perf();
ok(p1.chunks > 0 && p1.chunks <= 64, `visible chunks baked (${p1.chunks})`);
ok(p1.agentsDrawn > 0 && R.drawList.length > p1.agentsDrawn, `draw list has agents (${p1.agentsDrawn}) and more entries (${R.drawList.length})`);
let sorted = true; for (let k = 1; k < R.drawList.length; k++) if (R.drawList[k - 1].key > R.drawList[k].key) sorted = false;
ok(sorted, 'draw list is sorted by key');
const hall = R.drawList.find((e) => e.kind === 'building');
ok(hall && hall.b && hall.b.type === 'founders_hall' && hall.ax === hall.b.tx + hall.b.w - 1 && hall.ay === hall.b.ty + hall.b.h - 1, "Founders' Hall anchored at its south corner tile");

// --- chunk invalidation on tile:changed -------------------------------------------
const chunkOf = (tx, ty) => (tx >> 3) + (ty >> 3) * 8;
const ftx = fx.founders.tx, fty = fx.founders.ty, ci = chunkOf(ftx, fty);
ok(!R.chunkDirty(ci), `chunk ${ci} under Founders' is baked (clean)`);
BSU.events.emit('tile:changed', { i: BSU.idx(ftx, fty), tx: ftx, ty: fty, what: 'elev', chunk: ci });
ok(R.chunkDirty(ci), 'tile:changed marks its chunk dirty');
BSU.headless.render();
ok(!R.chunkDirty(ci), 'the next frame re-bakes it');
// an edge tile also dirties the neighbouring chunk
R.dirtyAll(); for (let k = 0; k < 3; k++) BSU.headless.render();
const ex = 8, ey = 8;
const beforeN = R.chunkDirty(chunkOf(ex, ey - 1)), beforeW = R.chunkDirty(chunkOf(ex - 1, ey));
BSU.events.emit('tile:changed', { i: BSU.idx(ex, ey), tx: ex, ty: ey, what: 'elev', chunk: chunkOf(ex, ey) });
ok(R.chunkDirty(chunkOf(ex, ey)) && (R.chunkDirty(chunkOf(ex, ey - 1)) || beforeN) && (R.chunkDirty(chunkOf(ex - 1, ey)) || beforeW), 'a chunk-edge tile dirties the N and W neighbour chunks too');

// --- tee pass: path connectors into a finished building's visible edges ------------
{
  const T = BSU.terrain, SURF = BSU.SURF;
  const sp = BSU.headless.findSpot('dorm'); const pr = sp ? BSU.headless.place('dorm', sp.x, sp.y) : { ok: false };
  const d = pr.ok ? s.buildings.find((x) => x && x.id === pr.id) : null;
  ok(!!d, 'tee test: a dorm placed at ' + JSON.stringify(sp));
  if (d) {
    ok(R.teesOf(s, d, false) === null, 'no path touching the dorm → teesOf is null');
    for (let y = d.ty; y < d.ty + d.h; y++) T.setSurface(s, BSU.idx(d.tx + d.w, y), SURF.PATH);        // a path flush along the SE edge (the default front: its two tiles are the walk's)
    for (let x = d.tx; x < d.tx + d.w; x++) T.setSurface(s, BSU.idx(x, d.ty + d.h), SURF.PATH);        // and along the SW edge (3 tiles → tees at both ends)
    T.setSurface(s, BSU.idx(d.tx + d.w + 2, d.ty + d.h + 2), SURF.ROAD);                              // a road two tiles away must not count
    const tees = R.teesOf(s, d, false);
    ok(Array.isArray(tees) && tees.length === 2 && tees.every((c) => ((c >> 4) & 1) === 1 && ((c >> 6) & 3) === SURF.PATH) && (tees[0] & 15) === 0 && (tees[1] & 15) === 2, 'SW path of 3 → tees at k = 0 and 2 only, SE front excluded by the walk, far road ignored: ' + JSON.stringify(tees));
    const teesL = R.teesOf(s, d, true);
    ok(Array.isArray(teesL) && teesL.length === 4 && teesL.filter((c) => ((c >> 4) & 1) === 0).length === 2, 'with the entrance on the SW face the SE pair becomes tees instead: ' + JSON.stringify(teesL));
    BSU.headless.tick(400); R.panToTile(d.tx, d.ty, false); for (let k = 0; k < 2; k++) BSU.headless.render();
    const st = R.teeStats();
    ok(d.built >= 1 && st.withTees >= 1 && st.mb > 0, 'a finished dorm with tees gets one cached tee sprite (' + JSON.stringify(st) + ')');
    T.setSurface(s, BSU.idx(d.tx, d.ty + d.h), SURF.NONE);
    ok(R.teeStats().withTees < st.withTees, 'tile:changed next to the footprint drops its cached tees');
    BSU.headless.render();
    const t2 = R.teesOf(s, d, false);
    ok(R.teeStats().withTees === st.withTees && Array.isArray(t2) && t2.length === 2 && (t2[0] & 15) === 0 && (t2[1] & 15) === 1, 'the next frame recomputes: the remaining SW pair (k = 0, 1) both get tees: ' + JSON.stringify(t2));
    ok(R.perf().tees >= 1 && R.variantOf(d, {}) === R.variantOf(d, {}), 'perf() reports the tee cache; variantOf is untouched by tees');
  }
}

// --- habitat pass: Roux lives in his exhibit (bounds, naps, swims, comes to the glass), the foreground layer and the plaza's sort key ----------
{
  BSU.economy.post(s, 'misc', 30000000); BSU.economy.bump(s, 'prestige', 20, 'debug'); BSU.economy.addStudents(s, 1200, 'debug');
  for (let x = 46; x <= 52; x++) BSU.headless.place('path', x, 13);
  for (let y = 10; y <= 13; y++) BSU.headless.place('path', 52, y);
  const pr = BSU.headless.place('tiger_habitat', 47, 10);
  ok(pr && pr.ok, 'habitat test: a Tiger Habitat placed beside a path (' + (pr && (pr.reason || pr.id)) + ')');
  if (pr && pr.ok) {
    BSU.headless.fastForwardDays(8);
    const hb = s.buildings.find((x) => x && x.id === pr.id), H = BSU.sprites.HABITAT;
    ok(hb && hb.built >= 1, 'the habitat finishes building');
    R.panToTile(hb.tx + 2, hb.ty + 2.5, false);
    const eb2 = BSU.errors.size; let modes = new Set(), outside = 0, glassSeen = false, swam = false, maxFront = 0, order = true;
    for (let k = 0; k < 4200; k++) {                                                                  // 70 s of frames at 60 fps
      R.frame(s, 0, 16.67);
      const st = R.habitatRoux(hb.id);
      if (st) { modes.add(st.mode); if (st.x < H.ROUX.x0 - 0.12 || st.x > H.ROUX.x1 + 0.08 || st.y < H.ROUX.y0 - 0.12 || st.y > H.ROUX.y1 + 0.08) outside++; if (BSU.sprites.habitatPool(st.x, st.y) > 0.04) swam = true; if (st.glass) glassSeen = true; }
      if (k === 60) {
        const L = R.drawList, b = L.find((e) => e.kind === 'building' && e.b === hb), rx = L.find((e) => e.kind === 'roux' && e.ax === b.ax && e.ay === b.ay), ff = L.find((e) => e.kind === 'habfront');
        ok(b && rx && ff && ff.ax === b.ax && ff.ay === b.ay && b.key < rx.key && rx.key < ff.key, 'the draw order at the habitat: building < Roux < foreground layer (habfront) at the same anchor tile');
        ok(ff && ff.ref && ff.ref.sh < b.ref.sh && ff.ref.ox === b.ref.ox, 'habfront is the cropped foreground canvas of the building');
        ok(typeof R.habitatRoux === 'function' && R.habitatRoux(hb.id) && R.habitatRoux(999) === null, 'habitatRoux(id) exposes the state for tools');
      }
    }
    ok(outside === 0, `Roux never leaves the enclosure bounds in 70 s of frames (${outside} samples outside)`);
    ok(modes.has('LIE') && modes.has('WALK') && modes.has('REST'), `Roux naps, paces and rests (${[...modes].sort().join(', ')})`);
    ok(swam, 'Roux swims through the pool (the lower body under the waterline) during the minute');
    ok(BSU.errors.size === eb2, 'no BSU.error while Roux lives in the exhibit');
    // students at the glass pull him to the wall; a student on the plaza stands in front of the foreground layer
    const viewer = s.agents.find((a) => a && a.state !== 'GONE');
    viewer.inside = false; viewer.state = 'IDLE'; viewer.goal = 'idle'; viewer.target = -1; viewer.route = []; viewer.waitTicks = 9999;
    for (const w of [BSU.sprites.habitatWorld(hb.tx, hb.ty, false, 2.5, 1.5), BSU.sprites.habitatWorld(hb.tx, hb.ty, true, 2.5, 1.5)]) {   // a plaza cell for either entrance
      viewer.tx = w[0]; viewer.ty = w[1]; viewer.px = w[0]; viewer.py = w[1]; viewer.lastTile = Math.floor(w[1]) * 64 + Math.floor(w[0]);
      R.frame(s, 0, 16.67);
      const L = R.drawList, ff = L.find((e) => e.kind === 'habfront'), ent = L.find((e) => e.kind === 'agent' && e.b === viewer);
      ok(s.tiles.owner[viewer.lastTile] === hb.id && ent && ff && ent.key > ff.key, 'a student standing on a plaza tile sorts after the foreground layer (in front of the glass): ' + (ent ? ent.key.toFixed(2) : '?') + ' > ' + (ff ? ff.key.toFixed(2) : '?'));
    }
    // flooded: the enclosure is empty (the pool has spilled and Roux is out), no ripple, the foreground still draws
    hb.flooded = true; R.frame(s, 0, 16.67);
    ok(!R.drawList.some((e) => e.kind === 'roux' && e.ax === hb.tx + hb.w - 1 && e.ay === hb.ty + hb.h - 1) && !R.drawList.some((e) => e.kind === 'ripple') && R.drawList.some((e) => e.kind === 'habfront'), 'a flooded habitat shows no Roux and no ripple; the foreground layer still draws');
    hb.flooded = false;
  }
}

// --- camera math round trips --------------------------------------------------------
let roundTrips = 0;
for (let k = 0; k < 30; k++) {
  const tx = 10 + (k * 7) % 44, ty = 10 + (k * 11) % 44;
  R.panToTile(tx, ty, false);
  const sc = R.tileToScreen(tx, ty);
  const hit = R.screenToTile(sc.x, sc.y);
  if (hit && (hit.tx === tx && hit.ty === ty || hit.tx + hit.ty > tx + ty)) roundTrips++;
}
ok(roundTrips === 30, `screenToTile(tileToScreen(t)) hits t (or a tile in front) for 30 tiles (${roundTrips})`);
R.panTo(0, 1024, false);
R.panBy(1e6, 1e6, false);
ok(R.camera.x === 2016 + 200 && R.camera.y === 2040 + 200, `panBy clamps to the world extents + 200 (${R.camera.x}, ${R.camera.y})`);
R.panTo(0, 1024, false);
const anchor = { x: 900, y: 200 }, wBefore = { x: (anchor.x - 640) / 1 + R.camera.x, y: (anchor.y - 360) / 1 + R.camera.y };
R.setZoom(2, anchor);
const wAfter = { x: (anchor.x - 640) / 2 + R.camera.x, y: (anchor.y - 360) / 2 + R.camera.y };
ok(R.camera.zoom === 2 && Math.abs(wAfter.x - wBefore.x) < 1 && Math.abs(wAfter.y - wBefore.y) < 1, 'setZoom(2) keeps the world point under the anchor');
R.zoomStep(-1); ok(R.camera.zoom === 1.75, 'zoomStep(-1) → 1.75'); for (let k = 0; k < 20; k++) R.zoomStep(-1); ok(R.camera.zoom === 0.5, 'zoomStep below 0.5 stays 0.5'); for (let k = 0; k < 20; k++) R.zoomStep(1); ok(R.camera.zoom === 2.5, 'zoomStep above 2.5 stays 2.5'); R.setZoom(2);
R.setZoom(1.4); ok(R.camera.zoom === 1.5, 'setZoom snaps 1.4 → 1.5 (the nearest step)'); R.setZoom(1);
BSU.headless.render();
const vt = R.visibleTiles();
ok(vt.x0 >= 0 && vt.y0 >= 0 && vt.x1 <= 63 && vt.y1 <= 63 && vt.x1 >= vt.x0 && vt.y1 >= vt.y0, `visibleTiles is a clamped rect (${vt.x0},${vt.y0})–(${vt.x1},${vt.y1})`);
R.panTo(100, 1100, true);
ok(R.camera.hasTarget === true, 'panTo with ease sets a target');
for (let k = 0; k < 120; k++) BSU.headless.render();
ok(R.camera.hasTarget === false && Math.abs(R.camera.x - 100) < 0.01 && Math.abs(R.camera.y - 1100) < 0.01, `eased pan settles on the target (${R.camera.x.toFixed(2)}, ${R.camera.y.toFixed(2)})`);
let moved = 0; BSU.events.on('camera:moved', () => moved++, 'test');
R.panBy(10, 0, true); R.panBy(10, 0, true); BSU.headless.render();
ok(moved === 1, 'camera:moved emitted at most once per frame for two user pans');
ok(R.camera.follow === -1, 'user pan releases follow');

// --- juice / misc API ---------------------------------------------------------------
R.flashTiles([BSU.idx(ftx, fty)], 1e9); ok(R.flashes.length === 1, 'flashTiles accepts a large finite ms');
const eb = BSU.errors.size; R.flashTiles([1], Infinity); ok(BSU.errors.size === eb + 1 && R.flashes.length === 1, 'flashTiles rejects Infinity with one BSU.error');
R.hitStop(60); ok(R.hitStopUntil === 0, 'hitStop is a no-op in headless');
R.setOverlay(BSU.OV.FLOOD); ok(s.ui.overlay === BSU.OV.FLOOD, 'setOverlay writes state.ui.overlay');
BSU.headless.render(); R.setOverlay(BSU.OV.NONE);
R.ghost({ tiles: [BSU.idx(ftx + 5, fty + 5)], color: '#3FBF7F', radius: 3, radiusCenter: BSU.idx(ftx + 5, fty + 5), sprite: { id: 'dorm', variant: 0, tx: ftx + 5, ty: fty + 5 } });
BSU.headless.render(); R.ghost(null);
ok(R.ghostSpec === null, 'ghost(null) clears');
const pc = R.postcard(s, 'Test'); ok(typeof pc === 'string' && pc.indexOf('data:image/png') === 0, 'postcard returns a data: URL');
const mm = win.document.createElement('canvas'); mm.width = 160; mm.height = 160; R.attachMinimap(mm); R.minimap(s);
ok(true, 'minimap draws into an attached canvas without throwing');
// art pass B6: drawIcon sizes the element to its device pixels (96 while it has no layout yet), locks follow the argument and the element is re-drawn on change
{
  const ic = win.document.createElement('canvas'); ic.width = 64; ic.height = 64;
  Object.defineProperty(ic, 'clientWidth', { value: 0, configurable: true });
  R.drawIcon(ic, 'dorm');
  ok(ic.width === 96 && ic.height === 96, 'drawIcon: an element with no layout gets a 96-px canvas (got ' + ic.width + ')');
  Object.defineProperty(ic, 'clientWidth', { value: 48, configurable: true }); R.drawIcon(ic, 'dorm');
  ok(ic.width === 48, 'drawIcon: a laid-out 48-px element gets 48 device px at dpr 1 (got ' + ic.width + ')');
  Object.defineProperty(ic, 'clientWidth', { value: 64, configurable: true }); R.drawIcon(ic, 'poboy', true);
  ok(ic.width === 64 && ic._icK === true && ic._icShown === 'poboy', 'drawIcon: a 64-px element, locked look on request');
  const eb2 = BSU.errors.size; R.drawIcon(null, 'dorm'); R.drawIcon({ width: 10, height: 10 }, 'dorm');
  ok(BSU.errors.size === eb2, 'drawIcon tolerates a missing element and a bare object');
}
let passNames = R.passes().map((p) => p.name);
ok(passNames.includes('tint') && passNames.includes('overlays') && passNames.includes('hud'), 'built-in passes registered: ' + passNames.join(','));
let called = 0; R.registerPass('tint', () => { called++; }, 6); BSU.headless.render();
ok(called === 1 && R.passes().filter((p) => p.name === 'tint').length === 1, 'registerPass replaces a pass by name and it runs once per frame');
ok(R.variantOf({ built: 0.5 }) === BSU.SPR.SCAFFOLD && R.variantOf({ pilings: true }, { phase: BSU.SKY.DUSK, effective: 1 }) === (BSU.SPR.PILINGS | BSU.SPR.NIGHT), 'variantOf table');
s.setPiece = { kind: 'x', cameraTouched: false }; R.panBy(1, 0, true); ok(s.setPiece.cameraTouched === true, 'user pan during a set piece → cameraTouched'); s.setPiece = null;

// --- smoothing pass: continuous surface centrelines ----------------------------------------
{
  const CV = R.curves;
  ok(CV && typeof CV.trace === 'function' && typeof CV.smooth === 'function' && typeof CV.runs === 'function' && typeof CV.build === 'function', 'render.curves exposes trace/smooth/runs/build');
  // (a) tracing on a 6×6 grid: an L with a side branch (one junction, three dead ends), a kind-2 loop next to it, an isolated kind-3 tile
  const gw = 6, gh = 6, g = new Uint8Array(gw * gh), at = (x, y) => y * gw + x;
  for (let y = 1; y <= 4; y++) g[at(1, y)] = 1; for (let x = 2; x <= 4; x++) g[at(4, x) * 0 + at(x, 4)] = 1; g[at(3, 3)] = 1; g[at(3, 2)] = 1;
  g[at(0, 0)] = 3;                                                   // isolated
  g[at(5, 0)] = 2; g[at(5, 1)] = 2; g[at(4, 0)] = 2; g[at(4, 1)] = 2; // 2×2 ring of road = a loop, touching the kind-1 L only diagonally
  const nets = CV.trace(g, gw, gh);
  const k1 = nets.filter((p) => p.kind === 1), k2 = nets.filter((p) => p.kind === 2), k3 = nets.filter((p) => p.kind === 3);
  ok(k1.length === 3 && k1.every((p) => !p.closed), `L + branch traces to 3 open polylines (${k1.length})`);
  const ends = k1.map((p) => [p.tiles[0], p.tiles[p.tiles.length - 1]]);
  ok(ends.filter((e) => e[0] === at(3, 4) || e[1] === at(3, 4)).length === 3, 'the junction (3,4) ends all three polylines');
  ok(k1.map((p) => p.tiles.length).sort((a, b) => a - b).join(',') === '2,3,6', 'polyline lengths 6 (dead end → corner → junction), 2 and 3: ' + k1.map((p) => p.tiles.length).join(','));
  ok(new Set(k1.flatMap((p) => p.tiles)).size === 9, 'the three polylines cover the 9 kind-1 tiles');
  ok(k2.length === 1 && k2[0].closed === true && k2[0].tiles.length === 4, `the road ring is one closed polyline of 4 tiles (${k2.length}, closed=${k2[0] && k2[0].closed}, ${k2[0] && k2[0].tiles.length})`);
  ok(k3.length === 1 && k3[0].tiles.length === 1, 'an isolated tile is a 1-tile polyline');
  // (b) smoothing: endpoints (junction centres) never move, the corner is cut into an arc, closed polylines wrap
  const sm = CV.smooth([0, 0, 0, 1, 1, 1], false, 3);   // tile centres are 1 apart: an L through three tiles
  ok(sm[0] === 0 && sm[1] === 0 && sm[sm.length - 2] === 1 && sm[sm.length - 1] === 1, 'smoothing keeps both endpoints exactly');
  let dmin = Infinity; for (let k = 0; k < sm.length; k += 2) dmin = Math.min(dmin, Math.hypot(sm[k] - 0, sm[k + 1] - 1));
  ok(dmin > 0.15 && dmin < 0.26 && sm.length > 20, `the corner becomes an arc passing ${dmin.toFixed(3)} tile inside the corner centre (${sm.length / 2} points)`);
  const sq = CV.smooth([0, 0, 2, 0, 2, 2, 0, 2], true, 2);
  ok(sq.length === 32 && sq.every((v) => v >= 0 && v <= 2), 'a closed square smooths to 16 points inside its hull');
  // (c) elevation runs
  const runs = CV.runs([5, 6, 7, 8, 9], (i) => [0, 0, 6, 6, 12][i - 5]);
  ok(runs.length === 3 && runs[0].a === 0 && runs[0].b === 1 && runs[0].ep === 0 && runs[1].a === 2 && runs[1].b === 3 && runs[1].ep === 6 && runs[2].a === 4 && runs[2].b === 4 && runs[2].ep === 12, 'elevRuns splits [0,0,6,6,12] into three runs: ' + JSON.stringify(runs));
  // (d) a built map: a path down a 2-ft terrace step gets one stairs record on the lower tile, oriented hi → lo
  const st = { tiles: { surface: new Uint8Array(4096), elev: new Float32Array(4096) }, buildings: [] };
  for (let y = 10; y <= 13; y++) { st.tiles.surface[y * 64 + 10] = 1; st.tiles.elev[y * 64 + 10] = y <= 11 ? 2 : 0; }
  const cv = CV.build(st);
  const stepTiles = [...cv.steps.keys()], step = cv.steps.get(12 * 64 + 10);
  ok(cv.polys.length === 1 && stepTiles.length === 1 && stepTiles[0] === 12 * 64 + 10, `one polyline, one step keyed by the lower tile (${stepTiles.join(',')})`);
  ok(step && step.length === 1 && step[0].d === 12 && step[0].hiEp === 12 && step[0].loEp === 0 && step[0].ux === 0 && step[0].uy === 1 && step[0].kind === 1, 'the step is 12 px, hi (10,11) → lo (10,12) southward: ' + JSON.stringify(step && step[0]));
  ok([10, 11, 12, 13].every((y) => cv.buckets.has(y * 64 + 10)) && !cv.buckets.has(14 * 64 + 10) && !cv.buckets.has(12 * 64 + 12), 'segment buckets cover the path tiles and not tiles two away');
  const flat = CV.build({ tiles: { surface: new Uint8Array(4096), elev: new Float32Array(4096) }, buildings: [] });
  ok(flat.polys.length === 0 && flat.buckets.size === 0 && flat.steps.size === 0, 'an empty map builds empty curves');
}

// --- bridge pass: decks over water, the run split at the shoreline, the bridge meeting its paths ----------
{
  const CV = R.curves, col = (x, y) => y * 64 + x;
  const st = { tiles: { surface: new Uint8Array(4096), elev: new Float32Array(4096), type: new Uint8Array(4096).fill(BSU.T.DRY), flags: new Uint32Array(4096), depth: new Float32Array(4096) }, buildings: [], plot: { bayou: [] } };
  // a boardwalk from marsh (20,10) over three bayou tiles (bed −2 ft) to marsh (20,14); a Pedestrian Bridge (22,11..13) between path tiles; a road span (24,11..13) between road tiles
  for (let y = 10; y <= 14; y++) { const wet = y >= 11 && y <= 13; for (const x of [20, 22, 24]) { const k = col(x, y); st.tiles.type[k] = wet ? BSU.T.BAYOU : BSU.T.MARSH; st.tiles.flags[k] = wet ? BSU.FLAG.BAYOU : 0; st.tiles.elev[k] = wet ? -2 : 0.5; st.tiles.depth[k] = wet ? 2 : 0; } st.tiles.surface[col(20, y)] = BSU.SURF.BOARDWALK; st.tiles.surface[col(22, y)] = wet ? BSU.SURF.BRIDGE : BSU.SURF.PATH; st.tiles.surface[col(24, y)] = BSU.SURF.ROAD; }
  const cv = CV.build(st);
  ok(Math.abs(cv.deck[col(20, 12)] - 1.5) < 1e-6 && Number.isNaN(cv.deck[col(20, 10)]) && Math.abs(cv.water[col(20, 12)]) < 1e-6, 'boardwalk deck = max(bed −2, stage 0) + 1.5 ft over water; the marsh tile is no deck');
  ok(Math.abs(cv.deck[col(24, 12)] - 4) < 1e-6, 'a road over water is a deck 4 ft up');
  ok(cv.deck[col(22, 12)] > 6 && cv.deck[col(22, 12)] < 7.01 && cv.deck[col(22, 11)] < cv.deck[col(22, 12)] && Math.abs(cv.deck[col(22, 11)] - cv.deck[col(22, 13)]) < 1e-6, 'bridge deck 6 ft + a gentle symmetric arch, highest mid-span');
  ok(cv.deckCount === 9 && CV.clearance[BSU.SURF.BRIDGE] === 6 && CV.clearance[BSU.SURF.BOARDWALK] === 1.5, 'nine deck tiles; clearances 6 / 1.5 ft');
  const stepN = cv.steps.get(col(20, 10)), stepS = cv.steps.get(col(20, 14));
  ok(stepN && stepN.length === 1 && stepN[0].hi === col(20, 11) && stepN[0].lo === col(20, 10) && stepN[0].kind === BSU.SURF.BOARDWALK && stepN[0].deck === true && stepN[0].hiEp === 9 && stepN[0].loEp === 3, 'north shoreline: the run splits there — a step from the deck (9 px) down to the marsh (3 px): ' + JSON.stringify(stepN && stepN[0]));
  ok(stepS && stepS.length === 1 && stepS[0].hi === col(20, 13) && stepS[0].lo === col(20, 14), 'south shoreline step too');
  ok(!cv.steps.has(col(20, 11)) && !cv.steps.has(col(20, 12)) && !cv.steps.has(col(20, 13)), 'no steps inside the deck run (the water tiles are one run at deck elevation)');
  const brP = cv.polys.find((p) => p.kind === BSU.SURF.BRIDGE);
  ok(brP && brP.tiles.length === 3 && brP.ext && brP.ext[0] && brP.ext[0].j === col(22, 10) && brP.ext[1] && brP.ext[1].j === col(22, 14) && brP.pts[0] === 22 && brP.pts[1] === 10.5 && brP.pts[brP.pts.length - 1] === 13.5, 'the bridge polyline runs edge to edge (y 10.5 → 13.5) into the path tiles, no gap');
  const rampN = cv.steps.get(col(22, 10)), rampS = cv.steps.get(col(22, 14));
  ok(rampN && rampN.length === 1 && rampN[0].kind === BSU.SURF.BRIDGE && rampN[0].hi === col(22, 11) && rampN[0].sign === -1 && rampN[0].t === 0 && rampN[0].hiEp === Math.round(cv.deck[col(22, 11)] * 6), 'a ramp record on the north path tile, walking back past the bridge start');
  ok(rampS && rampS.length === 1 && rampS[0].sign === 1 && rampS[0].t === 1, 'and one on the south path tile, walking on past its end');
  ok(cv.lamps.length === 3 && cv.lampAt.has(col(20, 12)) && cv.lampAt.has(col(22, 12)) && cv.lampAt.has(col(24, 12)) && cv.lamps.every((L) => L.ft > 3), 'one lamp per 3-tile deck run on its second deck tile, at deck height');
  ok(Number.isNaN(CV.deckOf(-1)) && typeof CV.decksDrawn() === 'number' && CV.overtopped(0) === false, 'deckOf / decksDrawn / overtopped are exposed');
}

// --- movement pass: students drawn on the smoothed curve, lateral offset to the right of the heading, heading and stride eased ----------
{
  const H = BSU.headless, st = BSU.state, W = 64, t = st.tiles;
  // a straight path row (y = row, x 20..30) then a turn south (x = 30, y row..row+6) on a patch of flat dry ground carved in the south of the map
  const row = 40;
  for (let y = row - 3; y <= row + 9; y++) for (let x = 16; x <= 34; x++) { const i = y * W + x; t.type[i] = BSU.T.DRY; t.elev[i] = 1; t.depth[i] = 0; t.walk[i] = 2; t.owner[i] = -1; t.flags[i] = 0; t.surface[i] = 0; }
  ok(t.walk[row * W + 25] === 2, 'a flat patch carved for the movement pose test');
  if (row > 0) {
    for (let x = 20; x <= 30; x++) BSU.terrain.setSurface(st, row * W + x, BSU.SURF.PATH);
    for (let y = row + 1; y <= row + 6; y++) BSU.terrain.setSurface(st, y * W + 30, BSU.SURF.PATH);
    R.setZoom(1); R.panToTile(26, row + 1, false); H.render(); H.render();
    const cvs = R.curves.current();
    ok(cvs && cvs.buckets.has(row * W + 25), 'the curves are built over the L (bucketed tiles)');
    const mkA = (x, y, lat) => ({ id: 3, px: x, py: y, tx: x, ty: y, sd: 0, psd: 0, lat: lat, state: 'WALK', rhSet: false, rh: 0, ox: 0, oy: 0, pw: 0, rs: 0, hd: 0, dir: 0 });
    // (a) walking east along the straight run: drawn to the right of the heading (+y side) by lat × the path scale, on the curve's line
    const a = mkA(24.5, row + 0.5, 0.3); let P = null;
    for (let k = 0; k < 60; k++) { a.px = a.tx; a.tx += 0.04; a.psd = a.sd; a.sd += 0.04; P = R.agentPose(a, st); }
    const want = 0.3 * BSU.agents.latScale(BSU.SURF.PATH);
    ok(Math.abs(P.y - (row + 0.5 + want)) < 0.02 && Math.abs(P.rh) < 0.01, `walking east: drawn ${(P.y - row - 0.5).toFixed(3)} tile to the right of the centre line (want ${want.toFixed(3)}), heading ${P.rh.toFixed(2)}`);
    // (b) standing: the offset eases back to nothing and the position is the sim's
    for (let k = 0; k < 60; k++) { a.px = a.tx; P = R.agentPose(a, st); }
    ok(Math.abs(P.y - a.ty) < 0.01 && Math.abs(P.x - a.tx) < 0.01, 'standing: drawn exactly where it stands');
    // (c) the corner: walk the Manhattan route (east, then south) in small steps; the drawn position stays within a quarter tile of the sim's
    //     route and the heading turns through the diagonal in steps no bigger than the turn rate allows, never flipping
    const b = mkA(27.5, row + 0.5, -0.25); const heads = []; let maxOff = 0, maxJump = 0, last = null;
    const dt = 1 / 60, w = (Math.PI / 2) / BSU.params.agents.move.turnSecs;
    for (let k = 0; k < 120; k++) {
      b.px = b.tx; b.py = b.ty;
      if (b.tx < 30.5 - 1e-9) b.tx = Math.min(30.5, b.tx + 0.036); else b.ty += 0.036;
      b.psd = b.sd; b.sd += 0.036;
      const q = R.agentPose(b, st); heads.push(q.rh);
      maxOff = Math.max(maxOff, Math.hypot(q.x - b.tx, q.y - b.ty));
      if (last) maxJump = Math.max(maxJump, Math.hypot(q.x - last.x, q.y - last.y)); last = q;
    }
    let maxTurn = 0; for (let k = 1; k < heads.length; k++) maxTurn = Math.max(maxTurn, Math.abs(heads[k] - heads[k - 1]));
    const mid = heads.filter((h) => h > 0.2 && h < Math.PI / 2 - 0.2).length;
    ok(maxOff < 0.45 && maxJump < 0.06 && maxTurn <= w * dt * 1.01 && mid >= 5 && Math.abs(heads[heads.length - 1] - Math.PI / 2) < 0.05, `corner: drawn ≤ ${maxOff.toFixed(2)} tile from the route, largest frame jump ${maxJump.toFixed(3)} tile, largest turn ${maxTurn.toFixed(3)} rad/frame (≤ ${(w * dt).toFixed(3)}), ${mid} frames between the facings, ends south`);
    { const rs = R.agentPose(b, st).rs; ok(Math.abs(b.sd - 120 * 0.036) < 1e-6 && rs >= b.psd - 1e-9 && rs <= b.sd + 1e-9, 'the stride (distance walked) is interpolated between the last two ticks for the walk cycle'); }
    // (d) the sprite's walk frame follows the distance walked, not the clock (no moonwalking): same distance → same frame at any tick; moving on → the frame moves on
    const Sp = BSU.sprites, f1 = Sp.agentFrame('walk', 0, 0, b, 1, 100), f2 = Sp.agentFrame('walk', 0, 0, b, 1, 4000);
    const b2 = Object.assign({}, b, { rs: b.rs + BSU.params.agents.move.strideTiles / 8 * 2 }), f3 = Sp.agentFrame('walk', 0, 0, b2, 1, 100);
    ok(f1 === f2 && ((f3 % 8) - (f1 % 8) + 8) % 8 === 2 && (f1 >> 3) === (f3 >> 3), `walk frame ${f1} at any tick; two eighths of a stride on: frame ${f3}`);
    R.curves.invalidate();
  }
}

// --- football pass F: field mapping, venue pick, players on the field, camera ----------------
{
  const H = BSU.headless;
  // (a) nothing drawn without a live game or a drill (seed 42 has no practice field)
  H.render();
  let fi = R.fbInfo();
  ok(fi.drawn === 0 && fi.players === 0 && !fi.active && !fi.drill, 'football layer draws nothing without a game or a drill');
  // (b) the field quad per venue, as the painters draw it
  const st = { type: 'stadium', tx: 20, ty: 20, w: 6, h: 5, tier: 1, built: 1, id: 7 }, pf = { type: 'practice_field', tx: 30, ty: 30, w: 4, h: 3, tier: 1, built: 1, id: 8 };
  const qs = R.fieldQuad(st), qp = R.fieldQuad(pf);
  ok(qs && qs.x0 === 1 && qs.y0 === 1 && qs.x1 === 5 && qs.y1 === 4, 'stadium field quad {1,1,fw-1,fh-1}: ' + JSON.stringify(qs));
  ok(qp && Math.abs(qp.x0 - 0.6) < 1e-9 && Math.abs(qp.y0 - 0.3) < 1e-9 && Math.abs(qp.x1 - 3.4) < 1e-9 && Math.abs(qp.y1 - 2.7) < 1e-9, 'practice field quad {0.6,0.3,fw-0.6,fh-0.3}: ' + JSON.stringify(qp));
  ok(R.fieldQuad({ type: 'dorm', w: 2, h: 2 }) === null && R.fieldQuad(null) === null, 'no field quad for other buildings');
  // stadium scale pass: the painter's geometry (sprites_buildings.stadiumGeom) is what the crowd rows, the shader clip and the camera lift read; its field is the mapped quad
  for (const tier of [1, 2, 3]) {
    const SG = R.stadiumGeom({ type: 'stadium', w: 6, h: 5, tier: tier });
    if (!SG) { ok(true, 'stadiumGeom unavailable (sprites_buildings not loaded): skipped'); continue; }
    ok(SG.field.x0 === qs.x0 && SG.field.y0 === qs.y0 && SG.field.x1 === qs.x1 && SG.field.y1 === qs.y1, 'tier ' + tier + ' stadiumGeom.field === render.fieldQuad');
    ok(Array.isArray(SG.fanRows) && SG.fanRows.length >= 4 && SG.fanRows.every(w => Number.isFinite(w.X0 + w.Y0 + w.X1 + w.Y1 + w.lift) && (w.dir === 0 || w.dir === 1)), 'tier ' + tier + ' fan rows are well-formed');
    ok(SG.clip.length >= 2 && SG.farRim >= 28 && SG.nearRim <= 28, 'tier ' + tier + ' clip quads, far rim ' + SG.farRim + ' ≥ 28, near rim ' + SG.nearRim + ' ≤ 28');
  }
  ok(R.stadiumGeom(null) === null && R.stadiumGeom({ type: 'stadium', w: 6, h: 5, tier: 1 }) !== undefined, 'stadiumGeom(null) is null');
  // (c) corners: u -10 / 110 (the end lines) and v 0 / 53.3 (the sidelines) land on the quad corners, in footprint units along +tx / +ty
  for (const [b, q] of [[st, qs], [pf, qp]]) {
    const c00 = R.fieldToTile(b, -10, 0), c11 = R.fieldToTile(b, 110, 53.3), c10 = R.fieldToTile(b, 110, 0), mid = R.fieldToTile(b, 50, 53.3 / 2);
    ok(Math.abs(c00.tx - (b.tx + q.x0)) < 1e-9 && Math.abs(c00.ty - (b.ty + q.y0)) < 1e-9, b.type + ': far end line / far sideline corner = (tx+x0, ty+y0)');
    ok(Math.abs(c11.tx - (b.tx + q.x1)) < 1e-9 && Math.abs(c11.ty - (b.ty + q.y1)) < 1e-9, b.type + ': near corner = (tx+x1, ty+y1)');
    ok(c10.tx > c00.tx && Math.abs(c10.ty - c00.ty) < 1e-9, b.type + ': u runs along +tx (the long axis the yard lines cross)');
    ok(Math.abs(mid.tx - (b.tx + (q.x0 + q.x1) / 2)) < 1e-9 && Math.abs(mid.ty - (b.ty + (q.y0 + q.y1) / 2)) < 1e-9, b.type + ': midfield maps to the quad centre (the BSU logo)');
    const g0 = R.fieldToTile(b, 0, 0), g1 = R.fieldToTile(b, 100, 0);
    ok(Math.abs((g0.tx - c00.tx) - (q.x1 - q.x0) / 12) < 1e-9 && Math.abs((c10.tx - g1.tx) - (q.x1 - q.x0) / 12) < 1e-9, b.type + ': goal lines sit one end-zone (1/12 of the span) in from the end lines');
    const w = R.fieldToWorld(b, -10, 0, 0), w2 = R.fieldToWorld(b, -10, 0, 10);
    ok(w && Math.abs(w.x - (c00.tx - c00.ty) * 32) < 1e-9 && Math.abs(w2.y - (w.y - 10)) < 1e-9, b.type + ': fieldToWorld is the iso projection; up lifts by px');
  }
  // (d) the venue pick follows sports.venue (highest complete stadium tier; Bayou Field = the practice field with bleachers)
  const fake = { buildings: [{ type: 'practice_field', tx: 1, ty: 1, w: 4, h: 3, tier: 1, built: 1, id: 0 }, { type: 'stadium', tx: 10, ty: 10, w: 6, h: 5, tier: 1, built: 1, id: 1 }, { type: 'stadium', tx: 20, ty: 20, w: 6, h: 5, tier: 2, built: 1, id: 2 }, { type: 'stadium', tx: 30, ty: 30, w: 6, h: 5, tier: 3, built: 0.5, id: 3 }], sports: { venue: 'stadium2', game: null } };
  ok(R.fieldVenue(fake, false).id === 2, 'venue pick: the highest complete stadium tier for a stadium venue');
  fake.sports.venue = 'bayou_field';
  ok(R.fieldVenue(fake, false).id === 0 && R.fieldVenue(fake, true).id === 0, 'venue pick: the practice field for bayou_field / the drill');
  // (e) a real home game at Bayou Field: 22 players drawn inside the field quad, the camera frames the venue at 2x and yields to the player
  s.economy.cash = 60e6; s.economy.students = 700;
  const spot = H.findSpot('practice_field');
  const placed = spot ? H.place('practice_field', spot.x, spot.y) : null;
  ok(placed && placed.ok !== false, 'practice field placed for the game test: ' + JSON.stringify(placed));
  const TPD = BSU.params.time.ticksPerDay;   // time pass: construction is calendar days, so wait in days of ticks (9 and 8 days)
  H.tick(9 * TPD);
  const fld = BSU.buildings.list(s, 'practice_field')[0];
  if (fld) { BSU.buildings.upgrade(s, fld.id); H.tick(8 * TPD); }
  const venue = BSU.sports.season(s).venue;
  ok(venue === 'bayou_field', 'Bayou Field is the venue after the upgrade: ' + venue);
  R.panToTile(fld ? fld.tx : 32, fld ? fld.ty : 32, false);
  const drill = R.fbInfo(); H.render(); const dr = R.fbInfo();
  ok(dr.drill ? dr.players === 11 && dr.drawn >= 12 : true, 'the idle practice drill draws 11 players and the ball when sports exposes it (' + dr.players + ')');
  const zoomBefore = s.ui.camera.zoom;
  const ph = BSU.sports.playHome(s);
  ok(ph && ph.ok, 'playHome starts a watched game: ' + JSON.stringify(ph));
  H.tick(260);
  const lv = BSU.sports.live(s);
  ok(lv && lv.active && Array.isArray(lv.players) && lv.players.length === 22, 'sports.live is active with 22 players at tick 260: ' + (lv && lv.phase));
  H.render(); H.render();
  fi = R.fbInfo();
  ok(fi.active && fi.players === 22 && fi.drawn >= 22 + 1 + 6 + 3 + 1, 'football layer draws 22 players + ball/officials/sideline/crowd (' + fi.drawn + ' entries, ' + fi.players + ' players)');
  ok(fi.letterbox === false && fi.cut === false && fi.wide === false, 'montage pass: no HIGHLIGHTS letterbox, cut or wide shot during a watched game');
  const qf = R.fieldQuad(fld);
  ok(fi.minX >= qf.x0 - 0.01 && fi.maxX <= qf.x1 + 0.01 && fi.minY >= qf.y0 - 0.01 && fi.maxY <= qf.y1 + 0.01, 'every drawn player maps inside the painted field quad: X ' + fi.minX.toFixed(2) + '-' + fi.maxX.toFixed(2) + ' in [' + qf.x0 + ',' + qf.x1 + '], Y ' + fi.minY.toFixed(2) + '-' + fi.maxY.toFixed(2) + ' in [' + qf.y0 + ',' + qf.y1 + ']');
  ok(s.setPiece && s.setPiece.kind === 'game' && fi.camera && s.ui.camera.zoom === 2 && s.setPiece.cameraTouched === false, 'the game camera took over at 2x for Bayou Field without touching cameraTouched (zoom ' + s.ui.camera.zoom + ')');
  const fbEntries = R.drawList.filter((e) => e && (e.kind === 'fbplayer' || e.kind === 'fbball' || e.kind === 'fbcrowd' || e.kind === 'fbcheer'));
  const venueEntry = R.drawList.find((e) => e && e.kind === 'building' && e.b === fld);
  ok(venueEntry && fbEntries.length > 0 && fbEntries.every((e) => e.key > venueEntry.key) && R.drawList.indexOf(venueEntry) < R.drawList.indexOf(fbEntries[0]), 'football entries sort after the venue sprite (never under the turf)');
  const kinds = {}; for (const e of R.drawList) if (e && e.kind && e.kind.slice(0, 2) === 'fb') kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  ok(kinds.fbplayer === 22 && kinds.fbref === 1 && kinds.fbcheer === 6 && kinds.fbstaff === 3 && kinds.fbroux === 1 && kinds.fbcrowd === 1 && (kinds.fbline || 0) <= 1 && (kinds.fbball || 0) <= 1, 'one entry per on-field thing: ' + JSON.stringify(kinds));
  const lineE = R.drawList.find((e) => e && e.kind === 'fbline');
  ok(!lineE || (Number.isFinite(lineE.a) && lineE.a >= 0 && lineE.a <= 100 && lineE.key < fbEntries[0].key + 1e9 && lineE.key > venueEntry.key), 'the scrimmage line sits on the turf at the engine spot: ' + (lineE && lineE.a));
  const pl0 = R.drawList.filter((e) => e && e.kind === 'fbplayer');
  ok(pl0.every((e) => e.ref && e.ref.zoom === 1 && /^fbplayer:/.test(e.id)), 'players blit from the 1x atlas with a pose id');
  R.panBy(40, 0, true); H.render();
  ok(s.setPiece.cameraTouched === true && R.fbInfo().camera === true && !s.ui.camera.hasTarget, 'a user pan sets cameraTouched and the game camera stops following');
  BSU.session.skipSetPiece(s); { let g = 0; while (s.setPiece && g++ < 300) H.tick(10); }   // the watched game's length depends on the rng-driven play count
  H.render();
  ok(!s.setPiece && R.fbInfo().camera === false, 'after the skip the set piece ended and the game camera let go (zoom stays ' + s.ui.camera.zoom + ' because the player touched it)');
  void zoomBefore; void drill;
}

// --- montage pass: the auto-sim reel's camera (a hard cut to each highlight's line of scrimmage, the ball through the play, the wide bowl on the final beat) and the HIGHLIGHTS letterbox (montage only) ----
{
  const H = BSU.headless;
  H.render();
  ok(R.fbInfo().letterbox === false && R.fbInfo().camera === false, 'no letterbox and no game camera between games');
  BSU.sports.setAutoSim(s, true);
  const zoom0 = s.ui.camera.zoom;
  const ph = BSU.sports.playHome(s);
  ok(ph && ph.ok && s.setPiece && s.setPiece.kind === 'montage' && s.setPiece.len === 100, 'auto-sim after a seen game: playHome starts a 100-tick montage: ' + JSON.stringify(ph));
  H.tick(1);   // tick 0 resolves the game and cuts the reel
  const reel = BSU.sports.montage(s);
  ok(reel && reel.total >= 4 && reel.total <= 6, 'the reel has 4–6 picks (' + (reel && reel.total) + ')');
  let frames = 0, lb = 0, cutOk = 0, cutBad = 0, liveOk = 0, liveBad = 0, wideEarly = 0, finalOk = 0, zoom2 = 0, crowd = 0, snapOk = 0, snapBad = 0;
  const seenCut = new Set();
  while (s.setPiece) {
    H.render(); frames++;
    const fi = R.fbInfo(), lv = BSU.sports.live(s), cam = s.ui.camera;
    if (fi.letterbox) lb++;
    if (cam.zoom === 2) zoom2++;
    if (R.drawList.some((e) => e && e.kind === 'fbcrowd')) crowd++;
    if (lv.phase === 'final') { if (fi.wide && cam.zoom === 1 && fi.camU === 50 && !fi.cut) finalOk++; }
    else {
      if (fi.wide) wideEarly++;
      if (lv.cut && lv.anim) {
        if (fi.cut && Math.abs(fi.camU - Math.max(0, Math.min(100, lv.anim.los))) < 1e-6) cutOk++; else cutBad++;
        if (!seenCut.has(lv.anim.n)) { seenCut.add(lv.anim.n); if (cam.x === cam.tx && cam.y === cam.ty) snapOk++; else snapBad++; }   // the first frame of a cut lands the camera (no ease)
      } else if (lv.phase === 'live') { if (!fi.cut && Math.abs(fi.camU - Math.max(-10, Math.min(110, lv.ball.x))) < 1e-6) liveOk++; else liveBad++; }
    }
    H.tick(1);
  }
  H.render();
  ok(frames === 99 && lb === 99 && R.fbInfo().letterbox === false, 'the HIGHLIGHTS letterbox is drawn on every montage frame (' + lb + ' of ' + frames + ') and gone after it');
  ok(cutOk >= reel.total * 3 && cutBad === 0, 'on every cut tick the camera targets the highlight\'s line of scrimmage (' + cutOk + ' ticks, ' + cutBad + ' off)');
  ok(snapOk === reel.total && snapBad === 0, 'each cut lands the camera on its first frame — a hard cut, not an ease (' + snapOk + ' of ' + reel.total + ')');
  ok(liveOk >= reel.total * 5 && liveBad === 0, 'through each play the camera follows the ball (' + liveOk + ' ticks, ' + liveBad + ' off)');
  ok(finalOk >= 9 && wideEarly === 0, 'the final beat frames the bowl at 1x on the field centre for its frames (' + finalOk + ' ≥ 9) and never before (' + wideEarly + ')');
  ok(zoom2 >= 80 && s.setPiece === null && s.ui.camera.zoom === zoom0 && R.fbInfo().camera === false, 'the reel runs at the 2x game zoom (' + zoom2 + ' ticks) and the zoom is handed back after the set piece (' + s.ui.camera.zoom + ' = ' + zoom0 + ')');
  ok(crowd >= 90 && s.setPiece === null && !s.sports.game && s.sports.schedule.some((e) => e.played && e.home), 'the crowd entry is drawn on every montage frame (' + crowd + ') and the game is recorded');
  BSU.sports.setAutoSim(s, false);
}

// --- selfTest under the harness flag ---------------------------------------------------
BSU.SELFTEST = true; let r; try { r = R.selfTest(); } catch (e) { r = { ok: false, notes: e.stack }; } finally { BSU.SELFTEST = false; }
ok(r && r.ok, 'selfTest ok: ' + (r && r.notes));

// --- reset (load path) and finiteness --------------------------------------------------
R.reset(s, false); BSU.headless.render();
ok(R.camera === s.ui.camera && R.perf().chunks > 0, 'reset(state, false) rebinds and re-bakes');
const camJson = JSON.stringify(s.ui.camera);
ok(!/NaN|Infinity/.test(camJson), 'saved camera has no NaN/Infinity: ' + camJson);
ok(BSU.errors.size === eb + 1, `no unexpected BSU.error during the run (${BSU.errors.size - eb - 1} extra)`);
if (BSU.errors.size !== eb + 1) console.error([...BSU.errors.keys()].join('\n'));

// --- hud + zoom pass: nine zoom steps, zoom at the cursor, master selection + smoothing per step, no bake per step ------------
try {
  const sZ = BSU.state; const camZ = sZ.ui.camera; const errZ = BSU.errors.size;
  const stepsP = BSU.params.ui.zoomSteps;
  ok(Array.isArray(stepsP) && stepsP.join(',') === '0.5,0.65,0.8,1,1.25,1.5,1.75,2,2.5' && R.zoomSteps().join(',') === stepsP.join(','), 'params.ui.zoomSteps = 0.5 … 2.5 (nine steps) and render.zoomSteps() mirrors it');
  ok(BSU.params.render.zooms.join(',') === '0.5,1,2', 'the three master zooms are unchanged');
  ok(!/chunks\s*\[\s*z|chunksByZoom|chunkSets|new Array\(NCH\)\s*,\s*new Array\(NCH\)/.test(src) && (src.match(/new Array\(NCH\)/g) || []).length === 1, 'one chunk table (no chunk set per zoom)');
  const masters = { 0.5: [0.5, false], 0.65: [1, true], 0.8: [1, true], 1: [1, false], 1.25: [2, true], 1.5: [2, true], 1.75: [2, true], 2: [2, false], 2.5: [2, true] };
  let mOk = true; for (const z of stepsP) { const i = R.zoomInfo(z); if (i.zoom !== z || i.master !== masters[z][0] || i.smooth !== masters[z][1] || Math.abs(i.scale - z / masters[z][0]) > 1e-9) { mOk = false; console.error('zoomInfo', z, i); } }
  ok(mOk, 'zoomInfo: master 2 for 1.25–2.5, 1 for 0.65–1, 0.5 at 0.5; smoothing on exactly when the scale ≠ 1');
  ok(R.zoomInfo(1.3).zoom === 1.25 && R.zoomInfo(1.6).zoom === 1.5 && R.zoomInfo(0.6).zoom === 0.65, 'zoomInfo snaps an off-table zoom to the nearest step');
  // wheel at the cursor: for every step from 1× (and back), the world point under the anchor moves < 0.5 px
  R.panTo(0, 1024, false); const vwZ = R.view.vw, vhZ = R.view.vh, axZ = 900, ayZ = 200;
  const underZ = () => ({ x: (axZ - vwZ / 2) / camZ.zoom + camZ.x, y: (ayZ - vhZ / 2) / camZ.zoom + camZ.y });
  let aOk = true, worst = 0;
  for (const z of stepsP) { R.setZoom(1); R.panTo(0, 1024, false); const b = underZ(); R.setZoom(z, { x: axZ, y: ayZ }); const a = underZ(); const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * camZ.zoom; worst = Math.max(worst, d); if (camZ.zoom !== z || d >= 0.5) { aOk = false; console.error('anchor drift at', z, d); } }
  ok(aOk, 'setZoom(step, anchor) keeps the world point under the anchor for every step (worst ' + worst.toFixed(3) + ' px)');
  R.setZoom(1.25, { x: axZ, y: ayZ }); const b2 = underZ(); R.zoomStep(1, { x: axZ, y: ayZ }); const a2 = underZ();
  ok(camZ.zoom === 1.5 && Math.abs(a2.x - b2.x) * 1.5 < 0.5 && Math.abs(a2.y - b2.y) * 1.5 < 0.5, 'zoomStep(+1, anchor) 1.25 → 1.5 keeps the cursor point too');
  { const ts = R.tileToScreen(32, 32), ws = BSU.worldToScreen(32, 32, sZ.tiles.elev[32 * 64 + 32], camZ, R.view.vw, R.view.vh); ok(camZ.zoom === 1.5 && Math.abs(ts.x - ws.x) < 1e-6 && Math.abs(ts.y - ws.y) < 1e-6, 'tileToScreen at 1.5× equals the contract projection with the live camera (' + ts.x + ',' + ts.y + ' vs ' + ws.x + ',' + ws.y + ')'); }
  // no extra caches: the widest step of each master family is rendered first (1.25 for the 2× family, 0.65 for the 1× family; 40 frames so every
  // animation frame is baked), then the master itself and the narrower steps (their viewports are subsets) — the atlas must gain no key and the
  // chunk table must not grow: nothing is baked per step
  const sp = BSU.sprites; R.panToTile(sZ.plot.founders.tx + 1, sZ.plot.founders.ty + 1, false);
  // entity animation frames (agent:* idle / walk cycles run to 144 frames) are baked lazily whenever an agent reaches a frame the warm-up never
  // showed; they are not a per-step cache, so the no-new-key check counts every key EXCEPT those (calm alerts pass: the gator term no longer dents
  // happiness, which moved the seed-42 students' idle phases enough for two agent:idle frames to land in the 2× window)
  let entityNew = 0; const spGet0 = sp.get; sp.get = function (id) { const n0 = sp.count(); const r = spGet0.apply(sp, arguments); if (sp.count() > n0 && /^agent:/.test(String(id))) entityNew++; return r; };
  const warm = (z, n) => { R.setZoom(z); for (let k = 0; k < n; k++) BSU.headless.render(); return { keys: sp.count() - entityNew, mem: sp.memoryMB(), chunks: R.perf().chunks, p: R.perf() }; };
  const w125 = warm(1.25, 40); let perfOk = true, keysOk = true, chunksOk = true;
  // (H1: the atlas can shrink here — sprites.gc drops idle lazy entries above CANVAS_LIMIT_MB now that the HD tile variants put it over — so the check is "no new key", not equality)
  for (const z of [2, 1.5, 1.75, 2.5]) { const w = warm(z, 6); if (w.p.zoom !== z || w.p.atlasZoom !== 2 || w.p.smooth !== (z !== 2)) { perfOk = false; console.error('perf at', z, w.p.zoom, w.p.atlasZoom, w.p.smooth); } if (w.keys > w125.keys) { keysOk = false; console.error('atlas grew at', z, w125.keys, '→', w.keys); } if (w.chunks > w125.chunks) { chunksOk = false; console.error('chunks grew at', z, w125.chunks, '→', w.chunks); } }
  const w065 = warm(0.65, 40);
  for (const z of [0.8, 1]) { const w = warm(z, 6); if (w.p.zoom !== z || w.p.atlasZoom !== 1 || w.p.smooth !== (z !== 1)) { perfOk = false; console.error('perf at', z, w.p.zoom, w.p.atlasZoom, w.p.smooth); } if (w.keys > w065.keys) { keysOk = false; console.error('atlas grew at', z, w065.keys, '→', w.keys); } if (w.chunks > w065.chunks) { chunksOk = false; console.error('chunks grew at', z, w065.chunks, '→', w.chunks); } }
  ok(perfOk, 'perf() reports the exact zoom, its master (2 for 1.25–2.5, 1 for 0.65–1) and smoothing on exactly at the non-master steps');
  sp.get = spGet0;
  ok(keysOk, 'the atlas gained no key (entity animation frames aside) at 2 / 1.5 / 1.75 / 2.5 after 1.25, nor at 0.8 / 1 after 0.65 (' + w125.keys + ' / ' + w065.keys + ' keys, ' + entityNew + ' entity frames)');
  ok(chunksOk && R.perf().chunks <= 64, 'the chunk table never grew past the widest step of its family and stays within the single 64-slot table (' + w125.chunks + ' at 1.25, ' + w065.chunks + ' at 0.65)');
  const w05 = warm(0.5, 3); ok(w05.p.atlasZoom === 0.5 && w05.p.smooth === false, 'at 0.5× the master is 0.5 and nothing is smoothed beyond the art-pass downsample');
  // the football camera snaps to the venue zoom from an intermediate step and hands the step back
  R.setZoom(1.25); BSU.headless.render();
  ok(camZ.zoom === 1.25 && R.zoomInfo().zoom === 1.25, 'an intermediate step is a legal saved camera zoom');
  R.setZoom(1); BSU.headless.render();
  ok(BSU.errors.size === errZ, 'no BSU.error across the zoom-step checks');
} catch (e) { ok(false, 'hud + zoom render: ' + (e.stack || e)); }

// --- H0 pipeline pass: hd registration → chunk master, progressive bake order, byte caps + fallback -----------------
try {
  const sp = BSU.sprites, sH = BSU.state, errH = BSU.errors.size;
  for (const fn of ['debugHD', 'hdInfo', 'chunkMasters', 'hdMasterOf', 'bakeStatReset']) ok(typeof R[fn] === 'function', 'H0 public function ' + fn);
  ok(R.passes().some((p) => p.name === 'hddebug' && p.order === 4.5), 'the hddebug pass is registered at 4.5 (after entities, before weather)');
  // H1: the terrain families ship as HD, so the shipped game already has hdOn; the chunk table is reset (reset(state, false)) so the
  // zoom-step tour above leaves no master-2 canvases behind and the progressive-bake order is observable from a clean master-1 start
  R.reset(sH, false); R.bakeStatReset(); R.panToTile(sH.plot.founders.tx + 1, sH.plot.founders.ty + 1, false); R.setZoom(1); for (let k = 0; k < 3; k++) BSU.headless.render();
  const i0 = R.hdInfo(), p0 = R.perf(), TERR = sp.hdTerrainFamilies();
  ok(i0.on === true && i0.terrain === true && i0.chunkMaster === 1 && i0.hdChunks === 0 && TERR.every((f) => i0.families.includes(f)) && i0.families.every((f) => TERR.includes(f) || f === 'building' || f === 'bldlight' || f === 'habfront') && p0.hd === true && p0.chunkMaster === 1 && Number.isFinite(p0.chunkMB) && Number.isFinite(p0.atlasMB) && Number.isFinite(p0.hdAtlasMB) && p0.hdChunks === 0, 'shipped game (H1): the terrain families are the HD families, chunk master 1 at zoom 1 dpr 1, perf() reports hd flags and real chunk / atlas MB');
  ok(Math.abs(p0.chunkMB - p0.chunks * (512 * 416 * 4) / 1048576) < 0.01 && R.chunkMasters().filter((m) => m === 1).length === p0.chunks && R.chunkMasters().length === 64, 'every live chunk is one 512×416 master-1 canvas (chunkMasters)');
  ok(R.debugHD(true) === true && R.hdInfo().on === true && R.hdInfo().families.includes('debug') && R.hdInfo().families.every((f) => TERR.includes(f) || f === 'debug' || f === 'building' || f === 'bldlight' || f === 'habfront') && sp.isHD('debug:hdtest') === true, 'debugHD(true) registers the debug family as HD beside the terrain families');
  for (let k = 0; k < 3; k++) BSU.headless.render();
  const i1 = R.hdInfo();
  ok(i1.master === 1 && i1.chunkMaster === 1 && i1.hdChunks === 0 && i1.dpr === 1, 'at zoom 1 dpr 1 the HD master is 1: chunks stay master 1 even with HD families (master 2 needs zoom × dpr ≥ 1.5)');
  ok(sp.get('debug:hdtest', 0, 0, 1) && sp.get('debug:hdtest', 0, 0, 1).zoom === 1 && sp.get('debug:hdtest', 0, 0, 1).sw === 64, 'the debug cube bakes through the brush at master 1 (64×72 art px)');
  const td = i1.debugTile; const tt = sH.tiles;
  ok(td >= 0 && tt.owner[td] < 0 && tt.surface[td] === 0 && tt.type[td] > BSU.T.MARSH, 'the chunk-stamped cube sits on a free land tile near the view centre');
  // zoom 2: HD master 2 → chunk master 2; progressive: the visible chunks are master 1 already, one upgrade per frame, nearest the view centre first
  R.setZoom(2); const i2 = R.hdInfo();
  ok(i2.master === 2 && i2.chunkMaster === 2 && i2.hdChunks === 0, 'setZoom(2) with an HD family: hd master 2, chunk master 2, nothing re-baked yet');
  let order = [], prevHd = 0, perFrameOk = true, dirtyOk = true;
  for (let k = 0; k < 40; k++) { BSU.headless.render(); const inf = R.hdInfo(); if (inf.hdChunks > prevHd + 1) perFrameOk = false; if (inf.hdChunks > prevHd) order.push(inf.lastUpgrade); prevHd = inf.hdChunks; for (let c = 0; c < 64; c++) if (R.chunkDirty(c) && R.chunkMasters()[c] > 0) dirtyOk = false; }
  const i3 = R.hdInfo();
  ok(perFrameOk && order.length >= 3, `progressive: hdChunks grows by at most one per frame (${order.length} upgrades in 40 frames)`);
  let centreChunk = -1, bestD = Infinity;   // the chunk whose bounding-box centre is nearest the view centre (what the bake ranks by)
  for (let k = 0; k < 64; k++) { const o = R.chunkOrigin(k & 7, k >> 3); const ex = (o.ox + 256 - R.camera.x) * 2, ey = (o.oy + 208 - R.camera.y) * 2; const d = ex * ex + ey * ey; if (d < bestD) { bestD = d; centreChunk = k; } }
  ok(order[0] === centreChunk, `the first upgrade is the chunk nearest the view centre (chunk ${order[0]}, nearest ${centreChunk}: visible ring first)`);
  ok(i3.hdChunks >= 1 && i3.hdChunks <= i3.chunks && R.chunkMasters().every((m) => m === 0 || m === 1 || m === 2) && i3.chunks <= 64, 'chunk masters are 0 / 1 / 2 only: one canvas per chunk, no second table');
  ok(Math.abs(i3.chunkMB - R.chunkMasters().reduce((a, m) => a + (m ? (m === 2 ? 1024 * 832 * 4 : 512 * 416 * 4) : 0), 0) / 1048576) < 0.01, 'chunkMB counts every canvas at its own master (1024×832 = 3.4 MB at 2)');
  ok(i3.bake.n2 >= i3.hdChunks && i3.bake.n2 > 0 && Number.isFinite(i3.bake.ms2), 'hdInfo().bake counts the master-2 bakes (≥ the live master-2 chunks: a dirtied HD chunk re-bakes at 2)');
  ok(sp.get('debug:hdtest', 0, 0, 2).zoom === 2 && sp.get('debug:hdtest', 0, 0, 2).sw === 128, 'the cube is fetched at master 2 at zoom 2 (128 device px wide)');
  // byte cap: a 1 MB chunk cap evicts off-screen chunks and then latches the fallback (chunk master 1); restoring the cap lifts it
  const hdp = BSU.params.art.hd, saveChunk = hdp.chromeChunkMB; hdp.chromeChunkMB = 1;
  for (let k = 0; k < 4; k++) BSU.headless.render();
  const i4 = R.hdInfo();
  ok(i4.fallback === true && i4.chunkMaster === 1 && R.perf().hdFallback === true, 'over the HD chunk cap with only visible chunks left: fallback latched, chunk master back to 1');
  for (let k = 0; k < 30; k++) BSU.headless.render();
  const i5 = R.hdInfo();
  ok(i5.hdChunks === 0 && i5.chunks > 0, 'under the fallback the master-2 chunks are re-baked at master 1 (one or two per frame) and the view stays drawn');
  hdp.chromeChunkMB = saveChunk;
  for (let k = 0; k < 70; k++) BSU.headless.render();
  const i6 = R.hdInfo();
  ok(i6.fallback === false && i6.chunkMaster === 2 && i6.hdChunks >= 1, 'restoring the cap clears the fallback at the next cap check and the upgrades resume');
  // zoom back to 1: master 1 wanted; the master-2 canvases are kept (drawn scaled) — the table never grows past 64 and keeps one canvas per chunk
  R.setZoom(1); for (let k = 0; k < 5; k++) BSU.headless.render();
  const i7 = R.hdInfo();
  ok(i7.chunkMaster === 1 && i7.chunks <= 64 && R.chunkMasters().filter((m) => m > 0).length === i7.chunks, 'zoom 1 again: chunk master 1, the live chunks are still one canvas each');
  ok(R.debugHD(false) === false && R.hdInfo().on === true && R.hdInfo().families.every((f) => TERR.includes(f) || f === 'building' || f === 'bldlight' || f === 'habfront') && !R.hdInfo().families.includes('debug') && sp.isHD('debug:hdtest') === false && R.hdInfo().chunkMaster === 1, 'debugHD(false) unregisters the debug family: the terrain families stay HD, chunk master 1 at zoom 1');
  for (let k = 0; k < 3; k++) BSU.headless.render();
  ok(BSU.errors.size === errH, 'no BSU.error across the H0 checks');
} catch (e) { ok(false, 'H0 render: ' + (e.stack || e)); }

// --- H1 terrain + water pass: HD tile variants in the bake, cliff steps, brush paths / decks at the chunk master, the live water tint ---
try {
  const sp = BSU.sprites, B = BSU.brush, sT = BSU.state, errT = BSU.errors.size, t = sT.tiles;
  R.reset(sT, false); R.panToTile(sT.plot.founders.tx + 1, sT.plot.founders.ty + 1, false); R.setZoom(1); for (let k = 0; k < 3; k++) BSU.headless.render();
  ok(R.hdInfo().terrain === true && sp.isPinned('tile') && sp.isPinned('cliff') && !sp.isPinned('shore'), 'hdInfo().terrain: the tile family is HD; tile + cliff variants are pinned against gc, the rest are lazy');
  // the bake fetches HD tile variants with the block position bits (every type) and the depth bits for water
  const seen = new Set(); const get0 = sp.get;
  sp.get = function (id, v, f, z) { if (typeof id === 'string' && id.startsWith('tile:')) seen.add(id + '|' + v + '|' + z); return get0.apply(this, arguments); };
  try { R.dirtyAll(); for (let k = 0; k < 12; k++) BSU.headless.render(); } finally { sp.get = get0; }
  const keys = [...seen]; let posOk = keys.length > 0, hashOk = true, deepSeen = false, shallowSeen = false, master1 = true;
  for (const k of keys) { const [id, v, z] = k.split('|'); const vv = +v; if ((vv & 7) !== 0) hashOk = false; if (id === 'tile:0' || id === 'tile:1') { if (vv & 1024) deepSeen = true; if (vv & 8) shallowSeen = true; } if (+z !== 1) master1 = false; if (((vv >> 4) & 63) === 0 && keys.length > 64) { /* position 0 is legal */ } }
  const posSet = new Set(keys.map((k) => (+k.split('|')[1] >> 4) & 63));
  ok(posOk && hashOk && posSet.size >= 32 && master1, `the master-1 bake fetches tile variants with position bits only (no hash variant; ${posSet.size} block positions seen, ${keys.length} keys)`);
  ok(deepSeen || shallowSeen, 'water tiles carry the depth bits (8 shallow < 1.5 ft, 1024 deep ≥ 3 ft)');
  // a 1–5 px elevation step is a cliff sprite (the HD terrace band), never the pen-era stepFace fillRects
  const cl = sp.get('cliff', 3, 0, 1), cl2 = sp.get('cliff', 3, 1, 2);
  ok(cl && cl.hd === true && cl.sw === 32 && cl.sh === 19 && cl.ox === -32 && cl2 && cl2.zoom === 2 && cl2.sh === 38 && cl2.ox === 0, 'cliff variants 1–5 bake as HD terrace steps at both masters with the pen anchors (south ox −32, east ox 0)');
  // zoom 2: the chunk (and its deck layer) bake at master 2; the paths are stroked through brush.strokePath in ground units (unit 32)
  let strokes = 0, units = new Set(), mats = new Set(), lods = new Set(); const sp0 = B.strokePath;
  B.strokePath = function (ctx, w, env, o) { strokes++; units.add(o && o.unit); mats.add(o && o.material); lods.add(env && env.lod); return sp0.apply(this, arguments); };
  let deckM2 = false, hadPath = false;
  try {
    R.setZoom(2); for (let k = 0; k < 60; k++) BSU.headless.render();
    const inf = R.hdInfo(); deckM2 = inf.deckMasters.length === 0 || inf.deckMasters.some((m) => m === 2);
    for (let i = 0; i < t.surface.length; i++) if (t.surface[i] === BSU.SURF.PATH) { hadPath = true; break; }
  } finally { B.strokePath = sp0; }
  ok(!hadPath || (strokes > 0 && units.has(32) && mats.has('gravel') && lods.has(0)), `the HD chunk bake strokes the paths through brush.strokePath (unit 32, ${strokes} calls, materials ${[...mats].join('/')}, lod ${[...lods].join('/')})`);
  ok(R.hdInfo().hdChunks > 0 && deckM2, 'master-2 chunks: a deck layer baked with them is a master-2 canvas (hdInfo().deckMasters)');
  // the live water pass fills a water tile at the light HD tint (C.hdWaterLiveA) and flood water over land at the full depth tint
  let aWater = -1, aLand = -1; const g = R.ctx, fr0 = g.fillRect, water0 = t.type.indexOf(BSU.T.OPEN_WATER);
  R.setZoom(1); R.panToTile(water0 % 64, (water0 / 64) | 0, false); BSU.headless.render();
  const dep = t.depth, land0 = (() => { for (let i = 0; i < t.type.length; i++) if (t.type[i] >= BSU.T.WET && !(t.flags[i] & (BSU.FLAG.OPEN_WATER | BSU.FLAG.BAYOU))) return i; return -1; })();
  const saved = dep[land0]; dep[land0] = 1.2;   // a flooded land tile for one frame
  g.fillRect = function () { const a = g.globalAlpha; if (a > 0.1 && a < 0.3 && aWater < 0) aWater = a; if (a > 0.5 && a < 0.9 && aLand < 0) aLand = a; return fr0.apply(this, arguments); };
  try { R.panToTile(land0 % 64, (land0 / 64) | 0, false); BSU.headless.render(); } finally { g.fillRect = fr0; dep[land0] = saved; }
  ok(aWater > 0.15 && aWater < 0.25, `a baked water tile gets the light live tint (alpha ${aWater.toFixed(2)})`);
  ok(aLand > 0.5, `flood water over land keeps the depth tint (alpha ${aLand.toFixed(2)})`);
  R.panToTile(sT.plot.founders.tx + 1, sT.plot.founders.ty + 1, false); for (let k = 0; k < 3; k++) BSU.headless.render();
  const tileHD = sp.isHD('tile:4'); sp.pinFamily('tile', false); const unp = sp.isPinned('tile'); sp.pinFamily('tile', true);
  ok(tileHD && unp === false && sp.isPinned('tile'), 'pinFamily toggles the gc pin');
  ok(R.hdInfo().terrain === true && BSU.errors.size === errT, 'no BSU.error across the H1 checks');
} catch (e) { ok(false, 'H1 render: ' + (e.stack || e)); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
