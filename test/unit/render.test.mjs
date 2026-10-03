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
BSU.session.newGame({ seed: 42, skipTutorial: true });
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
R.zoomStep(-1); ok(R.camera.zoom === 1, 'zoomStep(-1) → 1'); R.zoomStep(-1); ok(R.camera.zoom === 0.5, 'zoomStep(-1) → 0.5'); R.zoomStep(-1); ok(R.camera.zoom === 0.5, 'zoomStep below 0.5 stays 0.5');
R.setZoom(1.4); ok(R.camera.zoom === 1, 'setZoom snaps 1.4 → 1');
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
let passNames = R.passes().map((p) => p.name);
ok(passNames.includes('tint') && passNames.includes('overlays') && passNames.includes('hud'), 'built-in passes registered: ' + passNames.join(','));
let called = 0; R.registerPass('tint', () => { called++; }, 6); BSU.headless.render();
ok(called === 1 && R.passes().filter((p) => p.name === 'tint').length === 1, 'registerPass replaces a pass by name and it runs once per frame');
ok(R.variantOf({ built: 0.5 }) === BSU.SPR.SCAFFOLD && R.variantOf({ pilings: true }, { phase: BSU.SKY.DUSK, effective: 1 }) === (BSU.SPR.PILINGS | BSU.SPR.NIGHT), 'variantOf table');
s.setPiece = { kind: 'x', cameraTouched: false }; R.panBy(1, 0, true); ok(s.setPiece.cameraTouched === true, 'user pan during a set piece → cameraTouched'); s.setPiece = null;

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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
