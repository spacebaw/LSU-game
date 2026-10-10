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
  H.tick(900);
  const fld = BSU.buildings.list(s, 'practice_field')[0];
  if (fld) { BSU.buildings.upgrade(s, fld.id); H.tick(800); }
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
  BSU.session.skipSetPiece(s); H.tick(700);
  H.render();
  ok(!s.setPiece && R.fbInfo().camera === false, 'after the skip the set piece ended and the game camera let go (zoom stays ' + s.ui.camera.zoom + ' because the player touched it)');
  void zoomBefore; void drill;
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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
