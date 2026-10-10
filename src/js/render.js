'use strict';
// =============================================================================
// render.js — BSU.render: camera, the 8×8-tile chunk cache, the live water pass, the depth-sorted
// entity pass, the frame pipeline (passes 5–10 are a plain registry that render_fx.js fills), screen
// shake / hit-stop, screen↔world. Owner of `state.ui.camera` (saved) and `state.ui.perfMode`.
// Implements GDD §12.1 (projection, chunks, water), §12.3 (terrain variants, trees), §12.7 (juice),
// §11.7 (camera), §15.3 (perf); ARCHITECTURE §6.2 (camera API), §6.3 (pass order), §6.5 (guardrail).
// Decisions recorded in docs/INTEGRATION_NOTES.md '## render.js'. No DOM at definition time.
// Entry.draw signature is draw(entry, ctx, view, alpha) (the entry is passed first so no per-frame
// closures are allocated); render_fx's lights pass reads `ax, ay, elev, ref, kind` from drawList.
// Built-in fallbacks for the 'tint', 'overlays' and 'hud' passes, `minimap` and `postcard` exist so the
// game is playable before render_fx.js; render_fx replaces them by registering the same pass names.
// =============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.render = BSU.render || {});
  const PR = BSU.params.render, PAL = BSU.params.palette, MAP = BSU.MAP;
  const T = BSU.T, SPR = BSU.SPR, SKY = BSU.SKY, FLAG = BSU.FLAG, SURF = BSU.SURF, OV = BSU.OV;
  const W = MAP.W, HGT = MAP.H, N = MAP.N, TW = 64, TH = 32, PXFT = 6;
  const CW = PR.chunkW || 512, CHH = PR.chunkH || 416, CS = 8, NCH = 64;
  const ZOOMS = [0.5, 1, 2];
  const WATER_FLAGS = FLAG.BAYOU | FLAG.OPEN_WATER;
  const WORLD_X = PR.worldX || [-2016, 2016], WORLD_Y = PR.worldY || [-84, 2040];
  const MARGIN = PR.cameraMargin || 200, LERP = PR.cameraLerp || 0.15;
  const BG = '#0E1230';
  const GOLD = PAL.gold || '#FDD023', GOLD_HI = PAL.goldHi || '#FFE680';
  const WATER_SHALLOW = PR.waterShallow || PAL.shallows || '#6FA895', WATER_DEEP = PR.waterDeep || PAL.waterNight || '#1B3A3A';
  const C = {                                   // local constants the GDD states but params does not carry
    chunkMB: 0.85, chunkIdleFrames: 600, firstBakeMs: 150, spriteGcEvery: 300, cliffMin: 6, cliffMax: 96,
    reedPct: 25, waterCap: 300, waterCapSurge: 700, sparkleEvery: 8, agentAnimDiv: 6, gatorAnimDiv: 8,
    titleDriftX: 0.25, titleDriftY: 0.12, squashScale: 1.15, sinkTiltDeg: 2, bubbleLift: 4,
    mossMin: 6, mossMax: 10, mossSway: 3, overlayAlpha: 0.45, ghostAlpha: 0.45, ghostSpriteAlpha: 0.6,
    shadowAlpha: 0.22, shadowColor: '#0A0718'          // design pass: ground shadows under buildings and trees
  };
  const hash = (BSU.rng && BSU.rng.hash) ? BSU.rng.hash : function (a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
  function nowMs() { try { return performance.now(); } catch (e) { return Date.now(); } }
  function rerr(where, e) { try { BSU.error('render', where, e); } catch (err) { /* under SELFTEST BSU.error throws: let it propagate to the harness */ if (BSU.SELFTEST) throw err; } }
  const S = () => BSU.sprites;                      // the atlas (always loaded before render by manifest order)
  const mod = (name) => BSU[name] || null;

  // ---------------------------------------------------------------------------
  // Private state (closure; rebuilt in reset). D46: nothing on M mirrors sim state.
  // ---------------------------------------------------------------------------
  let root = null, camera = null;
  let followVehicle = null;   // predicate(vehicle, state) → the camera tracks the first matching state.vehicles entry (progress: the lead pirogue)
  let app = null, canvas = null, ctx = null, inited = false;
  let vw = 1280, vh = 720, dpr = 1, lastRectW = -1, lastRectH = -1;
  const comp = { tint: null, lights: null, fog: null };
  const chunks = new Array(NCH);
  const dirtyBits = new Uint8Array(NCH);
  let frameNo = 0, alphaNow = 0, zoomNow = 1, firstFrame = true, bakesThisFrame = 0;
  const view = { vw: 1280, vh: 720, dpr: 1, x0: 0, y0: 0, x1: 63, y1: 63 };
  let shakeUntil = 0, shakePx = 0, hitStopUntilMs = 0;
  const flashes = [];
  let ghostSpec = null, overlayFadeStart = 0;
  const passes = [];                                 // {name, fn, order, builtin}
  const gates = new Map();                           // tile → {closed, t0 (frameNo)}
  const perfRing = new Float32Array(PR.perfFrames || 60); let perfI = 0, perfFilled = false, perfTripped = false;
  let frameMs = 0, drawCalls = 0, agentsDrawn = 0, particlesDrawn = 0, waterDrawn = 0;
  let movedFlag = 0;                                 // 0 none, 1 programmatic, 2 by user (camera:moved once per frame)
  const camEvent = { x: 0, y: 0, zoom: 1, byUser: false };
  const cypStamp = new Uint16Array(N); let cypGen = 0;   // cypress adjacency marks for the knees decoration
  const colorCache = new Map();
  let birdTiles = null, birdTilesFrame = -1000;
  let minimapEl = null, mmBase = null, mmImg = null;
  let nanReported = false;
  const info = { phase: 1, day: 0, month: 1, dom: 1, wind: 0, barrierClosed: false, toppleIds: null, bloom: false, autumn: false, perfMode: false };

  // Draw-list pool (ARCHITECTURE §6.3; preallocated, insertion-sorted)
  const pool = []; let count = 0;
  let keys = new Float64Array(2048), order = new Int32Array(2048);
  const list = [];
  M.drawList = list;
  M.alpha = 0; M.frameNo = 0; M.hoverTile = -1; M.squash = {}; M.titleDrift = false; M._tests = M._tests || []; M.teesEnabled = true;   // tee pass switch (perf A/B)
  M.particleColors = [GOLD, '#FFFFFF', WATER_SHALLOW, '#C9B47C', PAL.danger || '#E0443E', PAL.azalea || '#E75480', PAL.moss || '#9BAA8A', '#9A8A7A', PAL.purpleHi || '#7F5BC5', '#FFB347', '#7FD4FF', PAL.good || '#3FBF7F', '#444444', PAL.cypressAutumn || '#C7692B', GOLD_HI, PAL.waterBlue || '#4FA3D6'];
  if (!M.particles) M.particles = { emit() {}, count() { return 0; }, clear() {}, forEachWorld() {} };   // replaced by render_fx.js
  Object.defineProperty(M, 'hitStopUntil', { get: function () { return hitStopUntilMs; }, enumerable: true, configurable: true });
  Object.defineProperty(M, 'camera', { get: function () { return camera; }, enumerable: true, configurable: true });
  Object.defineProperty(M, 'ctx', { get: function () { return ctx; }, enumerable: true, configurable: true });
  Object.defineProperty(M, 'canvas', { get: function () { return canvas; }, enumerable: true, configurable: true });
  Object.defineProperty(M, 'view', { get: function () { return view; }, enumerable: true, configurable: true });
  Object.defineProperty(M, 'ghostSpec', { get: function () { return ghostSpec; }, enumerable: true, configurable: true });
  Object.defineProperty(M, 'flashes', { get: function () { return flashes; }, enumerable: true, configurable: true });
  Object.defineProperty(M, 'composites', { get: function () { return comp; }, enumerable: true, configurable: true });
  Object.defineProperty(M, 'overlayFadeStart', { get: function () { return overlayFadeStart; }, enumerable: true, configurable: true });

  // ---------------------------------------------------------------------------
  // Pure camera math (shared by the live API and selfTest; `cam` is any {x, y, zoom, …} object)
  // ---------------------------------------------------------------------------
  /** snap a zoom to the nearest allowed step */
  function snapZoom(z) { z = fin(z, 1); let best = 1, bd = Infinity; for (let k = 0; k < ZOOMS.length; k++) { const d = Math.abs(ZOOMS[k] - z); if (d < bd) { bd = d; best = ZOOMS[k]; } } return best; }
  /** clamp x,y into the world extents ± cameraMargin/zoom; repairs non-finite numbers */
  function clampCam(cam) {
    const z = cam.zoom === 0.5 || cam.zoom === 1 || cam.zoom === 2 ? cam.zoom : snapZoom(cam.zoom);
    cam.zoom = z;
    const m = MARGIN / z;
    cam.x = clamp(fin(cam.x, 0), WORLD_X[0] - m, WORLD_X[1] + m);
    cam.y = clamp(fin(cam.y, 0), WORLD_Y[0] - m, WORLD_Y[1] + m);
    if (!Number.isFinite(cam.tx)) cam.tx = cam.x;
    if (!Number.isFinite(cam.ty)) cam.ty = cam.y;
    if (typeof cam.hasTarget !== 'boolean') cam.hasTarget = false;
    if (!Number.isFinite(cam.follow)) cam.follow = -1;
    return cam;
  }
  function panByCam(cam, dx, dy) { cam.x += fin(dx, 0) / cam.zoom; cam.y += fin(dy, 0) / cam.zoom; cam.hasTarget = false; clampCam(cam); }
  function setZoomCam(cam, z, ax, ay, w, h) {
    const zNew = snapZoom(z), zOld = cam.zoom || 1;
    ax = fin(ax, w / 2); ay = fin(ay, h / 2);
    const wx = (ax - w / 2) / zOld + cam.x, wy = (ay - h / 2) / zOld + cam.y;
    cam.zoom = zNew;
    cam.x = wx - (ax - w / 2) / zNew; cam.y = wy - (ay - h / 2) / zNew;
    cam.hasTarget = false;
    clampCam(cam);
  }
  /** world px (zoom-1) of a tile center at elevation */
  function tileWorld(tx, ty, elev) { return { x: (tx - ty) * 32, y: (tx + ty) * 16 - fin(elev, 0) * PXFT }; }
  /** conservative visible tile rect for cam on a w×h view (elevation extremes −4 and 14, pad 1) */
  function visibleRect(cam, w, h, out) {
    const z = cam.zoom || 1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let c = 0; c < 4; c++) {
      const px = (c & 1) ? w : 0, py = (c & 2) ? h : 0;
      const wx = (px - w / 2) / z + cam.x, wy0 = (py - h / 2) / z + cam.y;
      for (let e = 0; e < 2; e++) {
        const wy = wy0 + (e ? 14 : -4) * PXFT;
        const tx = (wx / 32 + wy / 16) / 2, ty = (wy / 16 - wx / 32) / 2;
        if (tx < minX) minX = tx; if (tx > maxX) maxX = tx; if (ty < minY) minY = ty; if (ty > maxY) maxY = ty;
      }
    }
    out.x0 = clamp(Math.floor(minX) - 1, 0, W - 1); out.x1 = clamp(Math.ceil(maxX) + 1, 0, W - 1);
    out.y0 = clamp(Math.floor(minY) - 1, 0, HGT - 1); out.y1 = clamp(Math.ceil(maxY) + 1, 0, HGT - 1);
    return out;
  }
  /** chunk origin in world px (ARCHITECTURE D19) */
  function chunkOrigin(cx, cy) { return { ox: ((cx * CS) - (cy * CS + 7)) * 32 - 32, oy: (cx * CS + cy * CS) * 16 - 16 - 84 }; }
  /** the §6.3 depth-sort key */
  function sortKey(ax, ay, elev, rank) { return 100 * (ax + ay) + 2 * (elev + 4) + 0.25 * rank; }
  M.sortKey = sortKey;
  M.chunkOrigin = chunkOrigin;

  // ---------------------------------------------------------------------------
  // Building variant rule (pass 4; pure, tested) — info = {phase, day, effective, blackout?}
  // ---------------------------------------------------------------------------
  /** BSU.SPR variant bits of a building struct for the given context (ARCHITECTURE D17) */
  M.variantOf = function (b, ci) {
    if (!b) return 0;
    ci = ci || {};
    const built = fin(b.built, 1), hp = fin(b.hp, 1);
    let v = 0;
    if (built < 1) v |= SPR.SCAFFOLD;
    else if (b.ruin) v |= SPR.RUIN;
    else if (hp < 1 && b.tarp) v |= SPR.DAMAGED;
    if (b.pilings) v |= SPR.PILINGS;
    const phase = fin(ci.phase, SKY.DAY);
    const eff = fin(ci.effective, 1);
    if ((phase === SKY.DUSK || phase === SKY.NIGHT) && eff > 0 && !b.blackout && !ci.blackout && built >= 1 && !b.ruin) v |= SPR.NIGHT;
    v |= (clamp(fin(b.tier, 0) | 0, 0, 3) << SPR.TIER_SHIFT);
    const bu = (b.data && Number.isFinite(b.data.boardedUntil)) ? b.data.boardedUntil : fin(b.boardedUntil, -1);
    if (bu >= 0 && bu >= fin(ci.day, 0)) v |= SPR.BOARDED;
    if (ci.frontLeft === true && SPR.FRONT_L) v |= SPR.FRONT_L;   // the door, walk and lamps face the SW edge (a path lies only there)
    return v;
  };
  /** the animation frame that goes with variantOf (scaffold stage, night window pattern, sway/topple, barrier, parking) */
  M.frameOf = function (b, v, ci) {
    ci = ci || {};
    if (v & SPR.SCAFFOLD) return clamp(Math.floor(fin(b.built, 0) * 3), 0, 2);
    if (b.type === 'water_tower') {
      if (ci.toppleIds && ci.toppleIds.indexOf(b.id) >= 0 && fin(b.hp, 1) < 1) return 3;
      if (fin(ci.wind, 0) >= 0.6) return 1 + ((frameNo >> 3) & 1);
      return 0;
    }
    if (b.type === 'surge_barrier') return ci.barrierClosed ? 3 : 0;
    if (b.type === 'parking') return b.flooded ? 1 : 0;
    if (v & SPR.NIGHT) return (b.data && Number.isFinite(b.data.seed)) ? ((b.data.seed | 0) & 3) : (b.id & 3);
    return 0;
  };

  // ---------------------------------------------------------------------------
  // Canvas, viewport, composites
  // ---------------------------------------------------------------------------
  function makeCanvas(w, h) {
    let c = null;
    try { c = document.createElement('canvas'); } catch (e) { c = null; }
    if (!c) c = { width: w, height: h, style: {}, getContext() { return null; } };
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    return c;
  }
  function ctx2d(c, opts) {
    let g = null;
    try { g = c.getContext('2d', opts); } catch (e) { g = null; }
    if (!g) { try { g = c.getContext('2d'); } catch (e) { g = null; } }
    if (!g) g = new Proxy({}, { get: (_, k) => (k === 'canvas' ? c : function () {}), set: () => true });
    try { g.imageSmoothingEnabled = false; } catch (e) { /* stub */ }
    return g;
  }
  /** reads #app's rect; canvas = rect × dpr (≤ 2); never a 0×0 canvas (hidden tab keeps the last size) */
  M.resize = function () {
    if (!canvas) return;
    let w = 0, h = 0;
    try { const r = app ? app.getBoundingClientRect() : null; if (r) { w = r.width; h = r.height; } } catch (e) { w = 0; h = 0; }
    if (!(w > 0 && h > 0)) { try { w = window.innerWidth; h = window.innerHeight; } catch (e) { w = 0; h = 0; } }
    if (!(w > 0 && h > 0)) { w = vw; h = vh; }
    lastRectW = w; lastRectH = h;
    let d = 1; try { d = Math.min(2, fin(window.devicePixelRatio, 1) || 1); } catch (e) { d = 1; }
    dpr = d; vw = Math.max(1, Math.round(w)); vh = Math.max(1, Math.round(h));
    const pw = Math.max(1, Math.round(vw * dpr)), ph = Math.max(1, Math.round(vh * dpr));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    try { canvas.style.width = vw + 'px'; canvas.style.height = vh + 'px'; } catch (e) { /* stub */ }
    try { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false; } catch (e) { /* stub */ }
    const perf = root && root.ui && root.ui.perfMode;
    const lightsDiv = perf ? (perfTripped ? 4 : 2) : 1;
    for (const k in comp) {
      const c = comp[k]; if (!c) continue;
      const div = k === 'lights' ? lightsDiv : 1;
      const cw = Math.max(1, Math.round(pw / div)), ch = Math.max(1, Math.round(ph / div));
      if (c.width !== cw) c.width = cw;
      if (c.height !== ch) c.height = ch;
    }
    view.vw = vw; view.vh = vh; view.dpr = dpr;
  };
  function checkResize() {
    if (!app) return;
    let w = 0, h = 0;
    try { const r = app.getBoundingClientRect(); w = r.width; h = r.height; } catch (e) { return; }
    if (w > 0 && h > 0 && (w !== lastRectW || h !== lastRectH)) M.resize();
  }

  // ---------------------------------------------------------------------------
  // Chunk cache
  // ---------------------------------------------------------------------------
  function allocChunks() {
    for (let k = 0; k < NCH; k++) {
      const cx = k & 7, cy = k >> 3, o = chunkOrigin(cx, cy);
      chunks[k] = { cx: cx, cy: cy, ox: o.ox, oy: o.oy, canvas: null, ctx: null, dirty: 1, lastSeen: -1 };
      dirtyBits[k] = 1;
    }
  }
  function dropChunk(ch) { if (ch.canvas) { try { ch.canvas.width = 1; ch.canvas.height = 1; } catch (e) { /* stub */ } } ch.canvas = null; ch.ctx = null; ch.dirty = 1; dirtyBits[ch.cx + ch.cy * 8] = 1; }
  function liveChunks() { let n = 0; for (let k = 0; k < NCH; k++) if (chunks[k] && chunks[k].canvas) n++; return n; }
  /** mark chunk i (0–63) dirty */
  M.dirtyChunk = function (i) { i = i | 0; if (i >= 0 && i < NCH) { dirtyBits[i] = 1; if (chunks[i]) chunks[i].dirty = 1; } };
  /** mark every chunk dirty */
  M.dirtyAll = function () { for (let k = 0; k < NCH; k++) M.dirtyChunk(k); };
  /** true while chunk i (0–63) waits for a re-bake (tests / debug) */
  M.chunkDirty = function (i) { i = i | 0; return i >= 0 && i < NCH ? dirtyBits[i] === 1 || !chunks[i] || !chunks[i].canvas : false; };
  /** the baked 1× chunk canvas (minimap/postcard) or null */
  M.chunkCanvas = function (cx, cy) { const ch = chunks[(cx | 0) + (cy | 0) * 8]; return ch && ch.canvas ? ch.canvas : null; };
  function onTileChanged(p) {
    if (!p) return;
    const i = Number.isFinite(p.i) ? p.i | 0 : (Number.isFinite(p.tx) ? BSU.idx(p.tx, p.ty) : -1);
    if (i < 0 || i >= N) { if (Number.isFinite(p.chunk)) M.dirtyChunk(p.chunk); return; }
    const tx = i & 63, ty = i >> 6, cx = tx >> 3, cy = ty >> 3;
    M.dirtyChunk(cx + cy * 8);
    teeInvalidateNear(i);
    curvesDirty = true;
    // neighbours' cliff faces / auto-tile masks live in the adjacent chunk when the tile sits on a chunk edge, and a
    // smoothed centreline bends up to ~1.5 tiles from a changed tile (smoothing pass), so one tile in also re-bakes it
    if ((tx & 7) <= 1 && cx > 0) M.dirtyChunk(cx - 1 + cy * 8);
    if ((ty & 7) <= 1 && cy > 0) M.dirtyChunk(cx + (cy - 1) * 8);
    if ((tx & 7) >= 6 && cx < 7) M.dirtyChunk(cx + 1 + cy * 8);
    if ((ty & 7) >= 6 && cy < 7) M.dirtyChunk(cx + (cy + 1) * 8);
  }
  function blit1(g, ref, x, y) { g.drawImage(ref.canvas, ref.sx, ref.sy, ref.sw, ref.sh, x + ref.ox, y + ref.oy, ref.sw, ref.sh); drawCalls++; }
  function sameMask(arr, i, tx, ty, val) {
    let m = 0;
    if (ty > 0 && arr[i - W] === val) m |= 1;
    if (tx < W - 1 && arr[i + 1] === val) m |= 2;
    if (ty < HGT - 1 && arr[i + W] === val) m |= 4;
    if (tx > 0 && arr[i - 1] === val) m |= 8;
    return m;
  }
  function flagMask(fl, i, tx, ty, bit, invert) {
    let m = 0;
    const t = (j) => (((fl[j] & bit) !== 0) !== !!invert);
    if (ty > 0 && t(i - W)) m |= 1;
    if (tx < W - 1 && t(i + 1)) m |= 2;
    if (ty < HGT - 1 && t(i + W)) m |= 4;
    if (tx > 0 && t(i - 1)) m |= 8;
    return m;
  }
  function markCypress(state) {
    cypGen = (cypGen + 1) & 0xFFFF; if (cypGen === 0) { cypStamp.fill(0); cypGen = 1; }
    const veg = state.veg; if (!Array.isArray(veg)) return;
    for (let k = 0; k < veg.length; k++) { const v = veg[k]; if (v && v.type === 'cypress' && Number.isFinite(v.tx) && Number.isFinite(v.ty) && BSU.inBounds(v.tx, v.ty)) cypStamp[BSU.idx(v.tx | 0, v.ty | 0)] = cypGen; }
  }
  function nearCypress(i, tx, ty) {
    if (ty > 0 && cypStamp[i - W] === cypGen) return true;
    if (tx < W - 1 && cypStamp[i + 1] === cypGen) return true;
    if (ty < HGT - 1 && cypStamp[i + W] === cypGen) return true;
    if (tx > 0 && cypStamp[i - 1] === cypGen) return true;
    return false;
  }
  let STEP_COLORS = null;
  function stepColors() {
    if (STEP_COLORS) return STEP_COLORS;
    const sh = S().shade;
    STEP_COLORS = [sh(PAL.waterNight || WATER_DEEP, 0.7), sh(PAL.waterDay || WATER_SHALLOW, 0.6), sh(PAL.mud || '#4A3B2A', 0.85), sh(PAL.wetGround || '#5A6B3A', 0.6), sh(PAL.dryGrass || '#6E8F3C', 0.55), sh(PAL.highGround || '#7FA347', 0.55), sh(PAL.mud || '#4A3B2A', 0.75), sh(PAL.waterDay || '#2E6B5E', 0.6)];
    return STEP_COLORS;
  }
  /** a d-px (1–5) dark band under the tile's lower-left (S) or lower-right (E) edge — the sub-foot terrace step */
  function stepFace(g, cx, cy, d, east, ty8) {
    const half = S().diamondHalf, top = cy - 16;
    g.fillStyle = stepColors()[ty8] || stepColors()[4];
    for (let r = 16; r < 32; r++) { const hf = half(TW, TH, r); if (hf <= 0) continue; g.fillRect(east ? cx + hf - 2 : cx - hf, top + r + 1, 2, d); }
    drawCalls += 16;
  }
  // ---------------------------------------------------------------------------
  // Smoothing pass — paths, roads and boardwalks as continuous centrelines
  // ---------------------------------------------------------------------------
  // Per surface kind the 4-connected tiles form networks: traceNets cuts them into polylines between nodes (dead ends,
  // junctions, isolated tiles) plus closed loops; smoothPoly rounds them (Chaikin ×3: right angles become arcs, diagonal
  // staircases gentle waves; endpoints — the junction centres — never move). The bake strokes the pieces near each tile
  // under the affine iso transform (ground units → chunk px at THAT tile's elevation, so round joins/caps squash right),
  // clipped to the tile's diamond so a raised neighbour drawn later still occludes it. Elevation steps along a polyline
  // get stairs (paths, boardwalks) or a ramp (roads) on the lower tile's side of the shared edge. Walkability, A*, costs
  // and placement are untouched: agents walk tile centres, which a Chaikin corner passes within 0.18 tile of (< w/2).
  const CURVE_W = [0, 0.42, 0.72, 0.5];           // stroke width in tiles by surface kind (PATH, ROAD, BOARDWALK)
  const STUB_W = 0.25, STUB_LEN = 0.58;             // tee / entrance-walk connector: 7 px like the sprite strip, to 0.08 past the footprint edge
  const CLIP_EPS = 0.06, CHAIKIN_ITERS = 3, SEG_PAD = 0.12;
  const EMPTY_DASH = [], DASH_SPECK = [0.03, 0.13], DASH_ROAD = [0.14, 0.14], DASH_PLANK = [0.03, 0.09];
  let curves = null, curvesDirty = true, CC = null;
  function curveColors() {
    if (CC) return CC;
    const sp = S(), sh = sp.shade, X = sp.extra || {};
    const stone = PAL.creamStone || '#F5ECD7';
    CC = {
      pathEdge: sh(PAL.gravel, 0.72), path: PAL.gravel, pathHi: sh(PAL.gravel, 1.08), pathDk: sh(PAL.gravel, 0.8), pathLo: sh(PAL.gravel, 0.9), deckLo: sh(PAL.boardwalk, 0.85),
      curb: sh(PAL.asphalt, 1.3), road: PAL.asphalt, dash: PAL.gold, ramp: sh(PAL.asphalt, 0.85), hatch: sh(PAL.gold, 1.1),
      rail: sh(PAL.boardwalk, 0.45), deck: PAL.boardwalk, gap: sh(PAL.boardwalk, 0.7), post: PAL.bark, postShadow: sh(PAL.waterNight || '#1E3A4A', 0.8),
      stoneTread: sh(stone, 0.82), stoneRiser: sh(stone, 0.52), stoneNose: stone,
      woodTread: PAL.boardwalk, woodRiser: sh(PAL.boardwalk, 0.55), woodNose: sh(PAL.boardwalk, 1.15),
      concrete: X.concrete || '#B8B8BC', steelDark: X.steelDark || '#6A6A70', steelDk2: sh(X.steelDark || '#6A6A70', 0.7), black: X.black || '#1B1B1B',
      purple: PAL.purple, purple2: PAL.purple2, purpleShadow: PAL.purpleShadow,
    };
    return CC;
  }
  const bitCount4 = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
  /** 4-connected networks of surface kinds 1–3 on a w×h grid → [{kind, tiles: [i…], closed}] (polylines between nodes, then loops) */
  function traceNets(surf, w, h) {
    const out = [], n = w * h, deg = new Uint8Array(n), used = new Uint8Array(n), STEP = [-w, 1, w, -1];
    for (let i = 0; i < n; i++) {
      const v = surf[i]; if (v < 1 || v > 3) continue;
      const x = i % w, y = (i / w) | 0; let m = 0;
      if (y > 0 && surf[i - w] === v) m |= 1;
      if (x < w - 1 && surf[i + 1] === v) m |= 2;
      if (y < h - 1 && surf[i + w] === v) m |= 4;
      if (x > 0 && surf[i - 1] === v) m |= 8;
      deg[i] = m;
    }
    function walk(start, dir) {
      const tiles = [start]; let i = start, d = dir;
      for (let guard = 0; guard <= n; guard++) {
        used[i] |= 1 << d;
        const j = i + STEP[d], back = (d + 2) & 3;
        used[j] |= 1 << back;
        if (j === start) return { tiles: tiles, closed: true };
        tiles.push(j);
        const m = deg[j];
        if (bitCount4(m) !== 2) return { tiles: tiles, closed: false };
        let nd = -1; for (let k = 0; k < 4; k++) if (k !== back && (m & (1 << k))) { nd = k; break; }
        if (nd < 0 || (used[j] & (1 << nd))) return { tiles: tiles, closed: false };
        i = j; d = nd;
      }
      return { tiles: tiles, closed: false };
    }
    for (let i = 0; i < n; i++) {
      const v = surf[i]; if (v < 1 || v > 3) continue;
      const m = deg[i], c = bitCount4(m);
      if (c === 2) continue;
      if (c === 0) { out.push({ kind: v, tiles: [i], closed: false }); continue; }
      for (let d = 0; d < 4; d++) if ((m & (1 << d)) && !(used[i] & (1 << d))) { const r = walk(i, d); out.push({ kind: v, tiles: r.tiles, closed: false }); }
    }
    for (let i = 0; i < n; i++) {   // what is left are pure loops (every tile degree 2)
      const v = surf[i]; if (v < 1 || v > 3) continue;
      const m = deg[i]; if (bitCount4(m) !== 2) continue;
      for (let d = 0; d < 4; d++) if ((m & (1 << d)) && !(used[i] & (1 << d))) { const r = walk(i, d); out.push({ kind: v, tiles: r.tiles, closed: r.closed }); break; }
    }
    return out;
  }
  /** Chaikin corner cutting on a flat [x0,y0,x1,y1,…] polyline; open polylines keep both endpoints, closed ones wrap */
  function smoothPoly(pts, closed, iters) {
    let p = pts;
    for (let it = 0; it < iters; it++) {
      const n = p.length >> 1;
      if (n < (closed ? 3 : 3)) return p.slice();
      const q = [], segs = closed ? n : n - 1;
      if (!closed) q.push(p[0], p[1]);
      for (let k = 0; k < segs; k++) {
        const j = (k + 1) % n, ax = p[2 * k], ay = p[2 * k + 1], bx = p[2 * j], by = p[2 * j + 1];
        q.push(ax + (bx - ax) * 0.25, ay + (by - ay) * 0.25, ax + (bx - ax) * 0.75, ay + (by - ay) * 0.75);
      }
      if (!closed) q.push(p[2 * n - 2], p[2 * n - 1]);
      p = q;
    }
    return p;
  }
  /** split a polyline's tile list into runs of equal elevation (px): [{a, b, ep}] index ranges */
  function elevRuns(tiles, epOf) {
    const runs = []; if (!tiles.length) return runs;
    let a = 0, cur = epOf(tiles[0]);
    for (let k = 1; k <= tiles.length; k++) {
      const e = k < tiles.length ? epOf(tiles[k]) : NaN;
      if (e !== cur) { runs.push({ a: a, b: k - 1, ep: cur }); a = k; cur = e; }
    }
    return runs;
  }
  /** the point of the smoothed polyline nearest (x, y), searched over segments from…to: {j, t} = segment index and parameter */
  function nearestOnCurve(pts, closed, x, y, from, to) {
    const n = pts.length >> 1; let bj = 0, bt = 0, bd = Infinity;
    for (let k = from; k <= to; k++) {
      const j = closed ? ((k % n) + n) % n : k; if (j < 0 || j >= (closed ? n : n - 1)) continue;
      const j1 = (j + 1) % n, ax = pts[2 * j], ay = pts[2 * j + 1], dx = pts[2 * j1] - ax, dy = pts[2 * j1 + 1] - ay, L2 = dx * dx + dy * dy;
      const t = L2 > 1e-12 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
      const ex = ax + dx * t - x, ey = ay + dy * t - y, d = ex * ex + ey * ey;
      if (d < bd) { bd = d; bj = j; bt = t; }
    }
    return { j: bj, t: bt };
  }
  /** points (x, y, nx, ny) at ascending arc lengths from the point at parameter t of segment j, walking ±index; past an open end it extends along the last tangent */
  function sampleCurve(pts, closed, j, t, sign, dists, out) {
    const n = pts.length >> 1, j1 = closed ? (j + 1) % n : Math.min(n - 1, j + 1);
    let x0 = pts[2 * j] + (pts[2 * j1] - pts[2 * j]) * t, y0 = pts[2 * j + 1] + (pts[2 * j1 + 1] - pts[2 * j + 1]) * t;
    let i = sign > 0 ? j1 : j, acc = 0, q = 0, tx = 0, ty = 0;
    for (let guard = 0; guard <= n && q < dists.length; guard++) {
      if (i < 0 || i >= n) break;
      const x1 = pts[2 * i], y1 = pts[2 * i + 1], dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
      if (L > 1e-9) {
        tx = dx / L; ty = dy / L;
        while (q < dists.length && dists[q] <= acc + L) { const s = dists[q] - acc; out.push(x0 + tx * s, y0 + ty * s, -ty, tx); q++; }
        acc += L; x0 = x1; y0 = y1;
      }
      i += sign; if (closed) i = (i + n) % n;
    }
    if (tx === 0 && ty === 0) { tx = 1; }
    while (q < dists.length) { const s = dists[q] - acc; out.push(x0 + tx * s, y0 + ty * s, -ty, tx); q++; }
    return out;
  }
  /** tee / entrance-walk connectors: a 7-px stub from the neighbour tile's centre into a finished building's visible edge */
  function addStubs(state, polys) {
    const B = state.buildings, t = state.tiles; if (!Array.isArray(B) || M.teesEnabled === false) return;
    const sp = S(), cat = BSU.data && BSU.data.catalog; if (!cat || typeof sp.teeable !== 'function') return;
    const surf = t.surface;
    for (let k = 0; k < B.length; k++) {
      const b = B[k]; if (!b || fin(b.built, 1) < 1 || b.ruin) continue;
      const row = cat[b.type]; if (!row || !row.pathAdjacency || !sp.teeable(row, b.rot ? 1 : 0)) continue;
      const w = b.w | 0, h = b.h | 0, tx = b.tx | 0, ty = b.ty | 0, fl = frontLeftOf(t, b);
      const add = (side, kk, kind) => {
        const x = side === 0 ? tx + w : tx + w - 1 - kk, y = side === 0 ? ty + h - 1 - kk : ty + h;
        if (x < 0 || y < 0 || x >= W || y >= HGT) return;
        polys.push({ kind: kind, stub: true, tiles: [y * W + x], closed: false, pts: [x, y, side === 0 ? x - STUB_LEN : x, side === 0 ? y : y - STUB_LEN] });
      };
      const tees = M.teesOf(state, b, fl);
      if (tees) for (let q = 0; q < tees.length; q++) add((tees[q] >> 4) & 1, tees[q] & 15, tees[q] >> 6);
      const side = fl ? 1 : 0, n = fl ? w : h;   // the entrance walk's tile(s): the middle of the front face (both tiles of an even face)
      for (let kk = 0; kk < n; kk++) {
        if (Math.abs(32 * kk + 16 - n * 16) >= 24) continue;
        const x = side === 0 ? tx + w : tx + w - 1 - kk, y = side === 0 ? ty + h - 1 - kk : ty + h;
        if (x < 0 || y < 0 || x >= W || y >= HGT) continue;
        const s = surf[y * W + x]; if (s >= 1 && s <= 3) add(side, kk, s);
      }
    }
  }
  /** the whole map's curves: smoothed polylines, per-tile segment ranges (bbox-bucketed) and per-lower-tile elevation steps */
  function buildCurves(state) {
    const t = state.tiles, surf = t.surface, elev = t.elev;
    const polys = traceNets(surf, W, HGT);
    addStubs(state, polys);
    const buckets = new Map(), steps = new Map();
    const epOf = (i) => Math.round(fin(elev[i], 0) * PXFT);
    for (let p = 0; p < polys.length; p++) {
      const P = polys[p], w = P.w = P.stub ? STUB_W : CURVE_W[P.kind];
      if (!P.pts) {
        const raw = []; for (let k = 0; k < P.tiles.length; k++) raw.push(P.tiles[k] & 63, P.tiles[k] >> 6);
        P.pts = P.tiles.length === 1 ? [raw[0] - 0.12, raw[1], raw[0] + 0.12, raw[1]] : smoothPoly(raw, P.closed, CHAIKIN_ITERS);
      }
      const pts = P.pts, n = pts.length >> 1, segs = P.closed ? n : n - 1, pad = w * 0.5 + SEG_PAD;
      for (let k = 0; k < segs; k++) {
        const j = (k + 1) % n, x0 = pts[2 * k], y0 = pts[2 * k + 1], x1 = pts[2 * j], y1 = pts[2 * j + 1];
        const ax = Math.max(0, Math.floor(Math.min(x0, x1) - pad + 0.5)), bx = Math.min(W - 1, Math.floor(Math.max(x0, x1) + pad + 0.5));
        const ay = Math.max(0, Math.floor(Math.min(y0, y1) - pad + 0.5)), by = Math.min(HGT - 1, Math.floor(Math.max(y0, y1) + pad + 0.5));
        for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
          const i = y * W + x; let list = buckets.get(i); if (!list) { list = []; buckets.set(i, list); }
          const last = list[list.length - 1];
          if (last && last.p === p && last.b === k - 1) last.b = k; else list.push({ p: p, a: k, b: k });
        }
      }
      if (P.stub || P.tiles.length < 2) continue;
      const m = P.tiles.length, runs = elevRuns(P.tiles, epOf), nr = runs.length;
      const span = 1 << CHAIKIN_ITERS;
      for (let r = 0; r < (P.closed ? nr : nr - 1); r++) {
        const r2 = (r + 1) % nr; if (runs[r].ep === runs[r2].ep) continue;
        const ka = runs[r].b, kb = runs[r2].a, a = P.tiles[ka], b = P.tiles[kb], ea = runs[r].ep, eb = runs[r2].ep;
        const hi = ea > eb ? a : b, lo = ea > eb ? b : a;
        const xm = ((a & 63) + (b & 63)) * 0.5, ym = ((a >> 6) + (b >> 6)) * 0.5;
        const at = nearestOnCurve(pts, P.closed, xm, ym, ka * span - span, ka * span + 2 * span);
        const st = { p: p, j: at.j, t: at.t, sign: hi === a ? 1 : -1, d: Math.abs(ea - eb), hiEp: Math.max(ea, eb), loEp: Math.min(ea, eb), lo: lo, hi: hi, kind: P.kind, w: w, ux: (lo & 63) - (hi & 63), uy: (lo >> 6) - (hi >> 6) };
        let list = steps.get(lo); if (!list) { list = []; steps.set(lo, list); } list.push(st);
      }
      void m;
    }
    return { polys: polys, buckets: buckets, steps: steps, state: state };
  }
  function ensureCurves(state) {
    if (curves && !curvesDirty && curves.state === state) return curves;
    try { curves = buildCurves(state); } catch (e) { rerr('curves', e); curves = null; }
    curvesDirty = false;
    return curves;
  }
  /** clip to the tile's ground diamond at ep, grown CLIP_EPS toward the S/E neighbours (drawn later: their ground overdraws the
   *  overlap, so the shared edge never shows an anti-aliased conflation seam) and stretched up/down for rails/posts */
  function clipTile(g, ch, tx, ty, ep, up, down) {
    const e = CLIP_EPS, px = (x, y) => (x - y) * 32 - ch.ox, py = (x, y) => (x + y) * 16 - ep - ch.oy;
    const Tx = px(tx - 0.5, ty - 0.5), Ty = py(tx - 0.5, ty - 0.5), Rx = px(tx + 0.5 + e, ty - 0.5), Ry = py(tx + 0.5 + e, ty - 0.5);
    const Bx = px(tx + 0.5 + e, ty + 0.5 + e), By = py(tx + 0.5 + e, ty + 0.5 + e), Lx = px(tx - 0.5, ty + 0.5 + e), Ly = py(tx - 0.5, ty + 0.5 + e);
    g.setTransform(1, 0, 0, 1, 0, 0); g.beginPath();
    g.moveTo(Tx, Ty - up); g.lineTo(Rx, Ry - up); g.lineTo(Rx, Ry + down); g.lineTo(Bx, By + down); g.lineTo(Lx, Ly + down); g.lineTo(Lx, Ly - up); g.closePath(); g.clip();
  }
  /** ground units → chunk px at elevation ep (the brief's affine: round joins and caps squash with the iso view) */
  function groundTransform(g, ch, ep) { g.setTransform(32, 16, -32, 16, -ch.ox, -ep - ch.oy); }
  /** build one path from the tile's ranges that match (stub?, kind); returns the number of subpaths */
  function buildPath(g, cv, list, stub, kind, offset) {
    let n = 0;
    for (let r = 0; r < list.length; r++) {
      const rg = list[r], P = cv.polys[rg.p]; if (!!P.stub !== stub || P.kind !== kind) continue;
      const pts = P.pts, np = pts.length >> 1;
      if (n === 0) g.beginPath();
      for (let k = rg.a; k <= rg.b + 1; k++) {
        const j = P.closed ? k % np : k; let x = pts[2 * j], y = pts[2 * j + 1];
        if (offset) { const nrm = normalAt(pts, np, P.closed, j); x += nrm[0] * offset; y += nrm[1] * offset; }
        if (k === rg.a) g.moveTo(x, y); else g.lineTo(x, y);
      }
      n++;
    }
    return n;
  }
  const NRM = [0, 0];
  function normalAt(pts, np, closed, j) {
    const a = closed ? (j - 1 + np) % np : Math.max(0, j - 1), b = closed ? (j + 1) % np : Math.min(np - 1, j + 1);
    const dx = pts[2 * b] - pts[2 * a], dy = pts[2 * b + 1] - pts[2 * a + 1], L = Math.hypot(dx, dy) || 1;
    NRM[0] = -dy / L; NRM[1] = dx / L; return NRM;
  }
  function strokeLayers(g, C, kind, stub, seed) {
    g.lineJoin = 'round'; g.lineCap = 'round'; g.setLineDash(EMPTY_DASH); g.lineDashOffset = 0;
    const w = stub ? STUB_W : CURVE_W[kind];
    if (kind === SURF.PATH) {
      g.lineWidth = w + 0.07; g.strokeStyle = C.pathEdge; g.stroke();
      g.lineWidth = w; g.strokeStyle = C.path; g.stroke(); drawCalls += 2;
      if (!stub) {
        g.lineWidth = w * 0.45; g.strokeStyle = C.pathHi; g.stroke();
        g.lineCap = 'butt'; g.lineWidth = 0.05; g.setLineDash(DASH_SPECK); g.lineDashOffset = (seed % 7) * 0.023; g.strokeStyle = C.pathDk; g.stroke();
        g.lineDashOffset = (seed % 5) * 0.031 + 0.07; g.strokeStyle = C.pathEdge; g.stroke(); drawCalls += 3;
      }
    } else if (kind === SURF.ROAD) {
      g.lineWidth = w + 0.1; g.strokeStyle = C.curb; g.stroke();
      g.lineWidth = w; g.strokeStyle = C.road; g.stroke(); drawCalls += 2;
      if (!stub) { g.lineCap = 'butt'; g.lineWidth = 0.045; g.setLineDash(DASH_ROAD); g.strokeStyle = C.dash; g.stroke(); drawCalls++; }
    } else {
      g.lineWidth = w + 0.1; g.strokeStyle = C.rail; g.stroke();
      g.lineWidth = w; g.strokeStyle = C.deck; g.stroke(); drawCalls += 2;
      if (!stub) { g.lineCap = 'butt'; g.lineWidth = w - 0.02; g.setLineDash(DASH_PLANK); g.strokeStyle = C.gap; g.stroke(); drawCalls++; }
    }
  }
  /** posts under a boardwalk's viewer-side edge (every other smoothed point ≈ 0.25 tile) */
  function boardwalkPosts(g, C, ch, cv, list, ep) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (let r = 0; r < list.length; r++) {
      const rg = list[r], P = cv.polys[rg.p]; if (P.stub || P.kind !== SURF.BOARDWALK) continue;
      const pts = P.pts, np = pts.length >> 1, off = P.w * 0.5 + 0.03;
      for (let k = rg.a; k <= rg.b + 1; k++) {
        const j = P.closed ? k % np : k; if (j & 1) continue;
        const nrm = normalAt(pts, np, P.closed, j); let nx = nrm[0], ny = nrm[1]; if (nx + ny < 0) { nx = -nx; ny = -ny; }
        const x = pts[2 * j] + nx * off, y = pts[2 * j + 1] + ny * off;
        const sx = Math.round((x - y) * 32 - ch.ox), sy = Math.round((x + y) * 16 - ep - ch.oy);
        g.fillStyle = C.post; g.fillRect(sx - 1, sy, 2, 3); g.fillStyle = C.postShadow; g.fillRect(sx - 2, sy + 3, 4, 1); drawCalls += 2;
      }
    }
  }
  /** a road over water: concrete piers under the deck, purple railings 6 px above it with posts */
  function piers(g, C, wx, wy) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (let s = 0; s < 2; s++) { const x = s ? wx + 20 : wx - 24, y = wy + 12; g.fillStyle = C.concrete; g.fillRect(x, y, 4, 8); g.fillStyle = C.steelDark; g.fillRect(x + 3, y, 1, 8); g.fillRect(x, y + 7, 4, 1); drawCalls += 3; }
  }
  function bridgeRails(g, C, ch, cv, list, ep) {
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = C.purpleShadow;
    for (let r = 0; r < list.length; r++) {
      const rg = list[r], P = cv.polys[rg.p]; if (P.stub || P.kind !== SURF.ROAD) continue;
      const pts = P.pts, np = pts.length >> 1, off = P.w * 0.5 - 0.04;
      for (let k = rg.a; k <= rg.b + 1; k++) {
        const j = P.closed ? k % np : k; if (j & 1) continue;
        const nrm = normalAt(pts, np, P.closed, j);
        for (let s = -1; s <= 1; s += 2) { const x = pts[2 * j] + nrm[0] * off * s, y = pts[2 * j + 1] + nrm[1] * off * s; g.fillRect(Math.round((x - y) * 32 - ch.ox), Math.round((x + y) * 16 - ep - ch.oy) - 5, 1, 5); drawCalls++; }
      }
    }
    groundTransform(g, ch, ep + 6); g.lineJoin = 'round'; g.lineCap = 'butt'; g.setLineDash(EMPTY_DASH); g.lineWidth = 0.07;
    for (let s = -1; s <= 1; s += 2) { if (!buildPath(g, cv, list, false, SURF.ROAD, s * (CURVE_W[2] * 0.5 - 0.04))) continue; g.strokeStyle = s < 0 ? C.purple : C.purple2; g.stroke(); drawCalls++; }
  }
  function culvertPipes(g, C, wx, wy) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (let s = -1; s <= 1; s += 2) { const x = wx + s * 14 - 2, y = wy + 6; g.fillStyle = C.steelDark; g.fillRect(x, y, 4, 4); g.fillStyle = C.black; g.fillRect(x + 1, y + 1, 2, 2); g.fillStyle = C.steelDk2; g.fillRect(x, y + 4, 4, 1); drawCalls += 3; }
  }
  /** the surface pieces that touch tile i, drawn at its elevation (called for every non-fence tile; cheap when none) */
  function drawCurvesAt(g, ch, cv, i, tx, ty, ep, wx, wy, sf, wet, canal) {
    const list = cv.buckets.get(i), steps = cv.steps.get(i);
    if (!list && !steps) return;
    const C = curveColors();
    if (list) {
      const bridge = wet && sf === SURF.ROAD, up = bridge ? 9 : 0, down = sf === SURF.BOARDWALK ? 5 : (bridge ? 14 : 0);
      g.save();
      clipTile(g, ch, tx, ty, ep, up, down);
      if (bridge) piers(g, C, wx, wy);
      if (sf === SURF.BOARDWALK) boardwalkPosts(g, C, ch, cv, list, ep);
      groundTransform(g, ch, ep);
      for (let pass = 0; pass < 2; pass++) for (let kind = 1; kind <= 3; kind++) { if (buildPath(g, cv, list, pass === 0, kind, 0)) strokeLayers(g, C, kind, pass === 0, hash(tx, ty)); }
      if (bridge) bridgeRails(g, C, ch, cv, list, ep);
      if (canal) culvertPipes(g, C, wx, wy);
      g.restore();
    }
    if (steps) for (let k = 0; k < steps.length; k++) drawStep(g, C, ch, cv, steps[k]);
  }
  /** stairs (paths, boardwalks) or a ramp (roads) from the shared edge at the higher level down into the lower tile, along the curve */
  function drawStep(g, C, ch, cv, st) {
    const P = cv.polys[st.p], pts = P.pts, hw = st.w * 0.5, d = st.d;
    const px = (x, y) => (x - y) * 32 - ch.ox, py = (x, y, e) => (x + y) * 16 - e - ch.oy;
    g.setTransform(1, 0, 0, 1, 0, 0); g.setLineDash(EMPTY_DASH); g.lineWidth = 1; g.lineJoin = 'miter'; g.lineCap = 'butt';
    const S = [];
    const quad = (k0, e0, k1, e1, fill) => {   // the curve strip between samples k0 and k1 (indices into S), corners at levels e0/e1
      const x0 = S[k0 * 4], y0 = S[k0 * 4 + 1], nx0 = S[k0 * 4 + 2] * hw, ny0 = S[k0 * 4 + 3] * hw, x1 = S[k1 * 4], y1 = S[k1 * 4 + 1], nx1 = S[k1 * 4 + 2] * hw, ny1 = S[k1 * 4 + 3] * hw;
      g.fillStyle = fill; g.beginPath();
      g.moveTo(px(x0 - nx0, y0 - ny0), py(x0 - nx0, y0 - ny0, e0)); g.lineTo(px(x0 + nx0, y0 + ny0), py(x0 + nx0, y0 + ny0, e0));
      g.lineTo(px(x1 + nx1, y1 + ny1), py(x1 + nx1, y1 + ny1, e1)); g.lineTo(px(x1 - nx1, y1 - ny1), py(x1 - nx1, y1 - ny1, e1));
      g.closePath(); g.fill(); drawCalls++;
    };
    const riser = (k, eTop, eBot, fill) => {     // vertical face across the strip at sample k
      const x = S[k * 4], y = S[k * 4 + 1], nx = S[k * 4 + 2] * hw, ny = S[k * 4 + 3] * hw;
      g.fillStyle = fill; g.beginPath();
      g.moveTo(px(x - nx, y - ny), py(x - nx, y - ny, eTop)); g.lineTo(px(x + nx, y + ny), py(x + nx, y + ny, eTop));
      g.lineTo(px(x + nx, y + ny), py(x + nx, y + ny, eBot)); g.lineTo(px(x - nx, y - ny), py(x - nx, y - ny, eBot));
      g.closePath(); g.fill(); drawCalls++;
    };
    const line = (k, e, color, grow) => {        // 1-px line across the strip at sample k and level e
      const x = S[k * 4], y = S[k * 4 + 1], nx = S[k * 4 + 2] * (hw + (grow || 0)), ny = S[k * 4 + 3] * (hw + (grow || 0));
      g.strokeStyle = color; g.beginPath(); g.moveTo(px(x - nx, y - ny), py(x - nx, y - ny, e)); g.lineTo(px(x + nx, y + ny), py(x + nx, y + ny, e)); g.stroke(); drawCalls++;
    };
    if (d < 3) {   // under half a foot: a short ramp wedge blends the two levels
      sampleCurve(pts, P.closed, st.j, st.t, st.sign, [0, 0.1], S);
      quad(0, st.hiEp, 1, st.loEp, st.kind === SURF.ROAD ? C.ramp : st.kind === SURF.BOARDWALK ? C.deckLo : C.pathLo);
      return;
    }
    if (st.kind === SURF.ROAD) {   // cars take a ramp, not stairs: asphalt slope with its curbs and hatched edge marks
      const L = Math.min(0.5, 0.12 + d * 0.012);
      sampleCurve(pts, P.closed, st.j, st.t, st.sign, [0, L * 0.25, L * 0.5, L * 0.75, L], S);
      quad(0, st.hiEp, 4, st.loEp, C.ramp);
      g.strokeStyle = C.curb; g.beginPath();
      for (let s = -1; s <= 1; s += 2) for (let k = 0; k <= 4; k++) { const e = st.hiEp - (st.hiEp - st.loEp) * k / 4, x = S[k * 4] + S[k * 4 + 2] * hw * s, y = S[k * 4 + 1] + S[k * 4 + 3] * hw * s; if (k === 0) g.moveTo(px(x, y), py(x, y, e)); else g.lineTo(px(x, y), py(x, y, e)); }
      g.stroke(); drawCalls++;
      for (let k = 1; k <= 3; k++) line(k, st.hiEp - (st.hiEp - st.loEp) * k / 4, C.hatch, -0.06);
      return;
    }
    const wood = st.kind === SURF.BOARDWALK, tread = wood ? C.woodTread : C.stoneTread, rise = wood ? C.woodRiser : C.stoneRiser, nose = wood ? C.woodNose : C.stoneNose;
    const nT = d < 5 ? 2 : clamp(Math.round(d / 3), 3, 6), run = Math.min(0.15, 0.6 / nT);   // half-foot shoulders: two shallow steps
    const dists = []; for (let k = 0; k <= nT; k++) dists.push(k * run);
    sampleCurve(pts, P.closed, st.j, st.t, st.sign, dists, S);
    const level = (k) => Math.round(st.hiEp - d * k / nT);
    const toward = (st.ux + st.uy) > 0;   // the lower tile lies toward the viewer: the face is visible, paint top → bottom
    for (let q = 0; q < nT; q++) {
      const k = toward ? q + 1 : nT - q;   // riser k sits at sample k-1 between levels k-1 and k; tread k spans samples k-1..k at level k
      if (toward) { riser(k - 1, level(k - 1), level(k), rise); if (k < nT) { quad(k - 1, level(k), k, level(k), tread); line(k, level(k), nose); } }
      else { if (k < nT) { quad(k - 1, level(k), k, level(k), tread); line(k, level(k), nose); } riser(k - 1, level(k - 1), level(k), rise); }
    }
    // handrail posts at both ends
    g.fillStyle = C.post;
    for (let s = -1; s <= 1; s += 2) for (let k = 0; k <= nT; k += nT) {
      const x = S[k * 4] + S[k * 4 + 2] * (hw + 0.03) * s, y = S[k * 4 + 1] + S[k * 4 + 3] * (hw + 0.03) * s, e = k ? st.loEp : st.hiEp;
      const sx = Math.round(px(x, y)), sy = Math.round(py(x, y, e)); g.fillRect(sx, sy - 6, 1, 6); g.fillRect(sx - 1, sy - 7, 3, 1); drawCalls += 2;
    }
  }
  M.curves = { trace: traceNets, smooth: smoothPoly, runs: elevRuns, build: buildCurves, current: () => curves, invalidate: () => { curvesDirty = true; } };
  /** bake chunk (cx, cy) at 1× into its canvas (ARCHITECTURE §6.3 step 2) */
  function bakeChunk(ch, state) {
    const sp = S();
    if (!ch.canvas) { ch.canvas = makeCanvas(CW, CHH); ch.ctx = ctx2d(ch.canvas); }
    const g = ch.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, CW, CHH);
    const t = state.tiles, elev = t.elev, type = t.type, fl = t.flags, surf = t.surface, crest = t.crest, integ = t.integrity, depth = t.depth;
    markCypress(state);
    const cv = ensureCurves(state);
    const bx = ch.cx * CS, by = ch.cy * CS;
    for (let s = 0; s <= 14; s++) {              // tiles by tx+ty ascending (draw order inside the chunk)
      for (let dx = Math.max(0, s - 7); dx <= Math.min(7, s); dx++) {
        const dy = s - dx, tx = bx + dx, ty = by + dy, i = ty * W + tx;
        const e = fin(elev[i], 0), ty8 = type[i], f = fl[i];
        const ep = Math.round(e * PXFT);                       // whole-pixel elevation: no sub-pixel seams between tiles
        const wx = (tx - ty) * 32 - ch.ox, wy = (tx + ty) * 16 - ep - ch.oy;
        // (a) ground
        let ref = sp.get('tile:' + ty8, sp.tileVariant(tx, ty), 0, 1);
        if (ref) blit1(g, ref, wx, wy);
        // (b) faces toward the S (lower-left edge) and E (lower-right edge) neighbours: ≥ 1 ft → the cliff sprite,
        //     smaller steps → a thin dark terrace band exactly as tall as the pixel step (no background shows through)
        if (ty < HGT - 1) { const d = ep - Math.round(fin(elev[i + W], 0) * PXFT); if (d >= 1) { if (d >= C.cliffMin) { ref = sp.get('cliff', clamp(d, C.cliffMin, C.cliffMax), 0, 1); if (ref) blit1(g, ref, wx, wy); } else stepFace(g, wx, wy, d, false, ty8); } }
        if (tx < W - 1) { const d = ep - Math.round(fin(elev[i + 1], 0) * PXFT); if (d >= 1) { if (d >= C.cliffMin) { ref = sp.get('cliff', clamp(d, C.cliffMin, C.cliffMax), 1, 1); if (ref) blit1(g, ref, wx, wy); } else stepFace(g, wx, wy, d, true, ty8); } }
        // (j) static faint water highlight on water tiles (always baked; pass 3 animates on top at 1×/2×)
        if ((f & WATER_FLAGS) || ty8 === T.OPEN_WATER || ty8 === T.BAYOU) { ref = sp.get('water', 0, 0, 1); if (ref) { g.globalAlpha = 0.35; blit1(g, ref, wx, wy); g.globalAlpha = 1; } }
        // (d) decorations
        if (ty8 === T.MARSH && (hash(tx, ty) % 100) < C.reedPct) { ref = sp.get('reeds', 0, hash(ty, tx) & 1, 1); if (ref) blit1(g, ref, wx + (hash(tx, ty + 9) % 24) - 12, wy + (hash(tx + 3, ty) % 8) - 4); }
        if (ty8 >= T.MARSH && ty8 !== T.POND && nearCypress(i, tx, ty) && (fin(depth[i], 0) > 0.05 || ty8 === T.MARSH)) { ref = sp.get('knees', 0, 0, 1); if (ref) blit1(g, ref, wx + (hash(tx, ty + 17) % 20) - 10, wy + 2); }
        if (f & FLAG.DESIRE_WORN) { ref = sp.get('worn', 0, 0, 1); if (ref) blit1(g, ref, wx, wy); }
        // (f) canal cut (open gate variant baked; pass 3 overlays the live gate frame)
        if (f & FLAG.CANAL) { let v = flagMask(fl, i, tx, ty, FLAG.CANAL, false); if (surf[i] > 0) v |= 16; ref = sp.get('canal', v, 0, 1); if (ref) blit1(g, ref, wx, wy); }
        // (e) surfaces: fences stay auto-tiled stamps; paths / roads / boardwalks are stroked centrelines (smoothing pass),
        //     drawn for every non-fence tile the curves touch (a curve may spill into a neighbour at a corner)
        const sf = surf[i], wet = (f & WATER_FLAGS) !== 0 || ty8 === T.OPEN_WATER || ty8 === T.BAYOU || ty8 === T.POND;
        if (cv && sf !== SURF.FENCE) drawCurvesAt(g, ch, cv, i, tx, ty, ep, wx, wy, sf, wet, (f & FLAG.CANAL) !== 0 && sf > 0);
        else if (sf > 0 && sf <= 4) {
          let v = sameMask(surf, i, tx, ty, sf);
          if (wet) v |= 16;
          if (sf === SURF.FENCE && (hash(tx, ty) % 6) === 0) v |= 32;
          if (f & FLAG.CANAL) v |= 64;
          ref = sp.get('surf:' + sf, v, 0, 1); if (ref) blit1(g, ref, wx, wy);
        }
        // (g) levee berms / floodwall panels
        const cr = crest[i];
        if (cr > 0) {
          let v = sameMask(crest, i, tx, ty, cr);
          if (integ[i] < 50) v |= 16;
          ref = sp.get(cr >= 12 ? 'floodwall' : 'levee', v, 0, 1); if (ref) blit1(g, ref, wx, wy);
          if (t.sandbag && t.sandbag[i] > 0) { ref = sp.get('decal:sandbags', 0, 0, 1); if (ref) blit1(g, ref, wx, wy - 10); }
        }
        // (h) preserve posts, (i) mounds
        if (f & FLAG.PRESERVE) { const v = flagMask(fl, i, tx, ty, FLAG.PRESERVE, true); if (v) { ref = sp.get('preservePost', v, 0, 1); if (ref) blit1(g, ref, wx, wy); } }
        if (f & FLAG.MOUND) { ref = sp.get('mound', 0, 0, 1); if (ref) blit1(g, ref, wx, wy); }
        if (f & FLAG.DEBRIS) { ref = sp.get('decal:debris', 0, hash(tx, ty) & 3, 1); if (ref) blit1(g, ref, wx, wy); }
      }
    }
    ch.dirty = 0; dirtyBits[ch.cx + ch.cy * 8] = 0; ch.lastSeen = frameNo;
  }
  function evictChunks() {
    let mem = 0;
    try { const sp = S(); mem = typeof sp.totalMemoryMB === 'function' ? sp.totalMemoryMB() : sp.memoryMB(); } catch (e) { mem = 0; }
    const compMB = canvas ? (canvas.width * canvas.height * 4 * 3) / 1048576 : 0;
    mem += liveChunks() * C.chunkMB + compMB;
    const budget = PR.canvasBudgetMB || 64;
    while (mem > budget) {
      let victim = null;
      for (let k = 0; k < NCH; k++) { const ch = chunks[k]; if (ch.canvas && frameNo - ch.lastSeen > C.chunkIdleFrames && (!victim || ch.lastSeen < victim.lastSeen)) victim = ch; }
      if (!victim) break;
      dropChunk(victim); mem -= C.chunkMB;
    }
  }

  // ---------------------------------------------------------------------------
  // Projection helpers on the live camera
  // ---------------------------------------------------------------------------
  function elevAt(tx, ty) { return (root && root.tiles) ? fin(root.tiles.elev[ty * W + tx], 0) : 0; }
  /** canvas px of a world point (zoom-1 world px → CSS px) */
  function worldPx(wx, wy) { return { x: (wx - camera.x) * zoomNow + vw / 2, y: (wy - camera.y) * zoomNow + vh / 2 }; }
  /** the tile under a CSS-px point (BSU.screenToWorld with the live camera and terrain elevation) or null */
  M.screenToTile = function (px, py) { if (!camera) return null; return BSU.screenToWorld(fin(px, 0), fin(py, 0), camera, vw, vh, elevAt); };
  /** canvas px of a tile center at its (or the given) elevation */
  M.tileToScreen = function (tx, ty, elevOverride) { const e = Number.isFinite(elevOverride) ? elevOverride : elevAt(clamp(tx | 0, 0, W - 1), clamp(ty | 0, 0, HGT - 1)); return BSU.worldToScreen(tx, ty, e, camera || { x: 0, y: 0, zoom: 1 }, vw, vh); };
  /** diamond center in canvas px at the tile's elevation */
  M.tilePx = function (i) { i = i | 0; return M.tileToScreen(i & 63, i >> 6); };
  /** interpolated foot point of a mover in canvas px */
  M.entityScreen = function (e) {
    if (!e) return { x: 0, y: 0 };
    const a = alphaNow, ax = fin(e.px, e.tx) + (fin(e.tx, 0) - fin(e.px, fin(e.tx, 0))) * a, ay = fin(e.py, e.ty) + (fin(e.ty, 0) - fin(e.py, fin(e.ty, 0))) * a;
    const i = clamp(Math.floor(ax), 0, W - 1) + clamp(Math.floor(ay), 0, HGT - 1) * W;
    return worldPx((ax - ay) * 32, (ax + ay - 1) * 16 - elevAt(i & 63, i >> 6) * PXFT);
  };
  /** world px of a building's south-corner anchor at ground elevation */
  M.anchorOf = function (b) { if (!b) return { x: 0, y: 0 }; const ax = fin(b.tx, 0) + fin(b.w, 1) - 1, ay = fin(b.ty, 0) + fin(b.h, 1) - 1; return tileWorld(ax, ay, elevAt(clamp(ax, 0, W - 1), clamp(ay, 0, HGT - 1))); };
  /** the conservative tile rect covering the viewport (recomputed each frame; agents read it with +4) */
  M.visibleTiles = function () { return { x0: view.x0, y0: view.y0, x1: view.x1, y1: view.y1 }; };

  // ---------------------------------------------------------------------------
  // Camera API (ARCHITECTURE §6.2)
  // ---------------------------------------------------------------------------
  function markMoved(byUser) { movedFlag = Math.max(movedFlag, byUser ? 2 : 1); }
  /** pan by screen px; user pans clear the easing target and the follow and count as a set-piece camera touch */
  M.panBy = function (dx, dy, byUser) {
    if (!camera) return;
    byUser = byUser !== false;
    panByCam(camera, dx, dy);
    if (byUser) { camera.follow = -1; followVehicle = null; if (root && root.setPiece) M.captureCameraTouch(root); if (M.titleDrift) M.titleDrift = false; }
    markMoved(byUser);
  };
  /** pan to world px (zoom-1), eased or snapped */
  M.panTo = function (wx, wy, ease, byUser) {
    if (!camera) return;
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) { rerr('panTo', new Error('non-finite target')); return; }
    const m = MARGIN / camera.zoom;
    wx = clamp(wx, WORLD_X[0] - m, WORLD_X[1] + m); wy = clamp(wy, WORLD_Y[0] - m, WORLD_Y[1] + m);
    if (ease === false) { camera.x = wx; camera.y = wy; camera.hasTarget = false; clampCam(camera); markMoved(!!byUser); }
    else { camera.tx = wx; camera.ty = wy; camera.hasTarget = true; }
  };
  /** pan to a tile center (at its elevation) */
  M.panToTile = function (tx, ty, ease) { const e = (BSU.inBounds(tx | 0, ty | 0)) ? elevAt(tx | 0, ty | 0) : 0; const w = tileWorld(fin(tx, 32), fin(ty, 32), e); M.panTo(w.x, w.y, ease); };
  /** zoom to 0.5/1/2 about a CSS-px anchor (default: the viewport center) */
  M.setZoom = function (z, anchorPx) { if (!camera) return; const ax = anchorPx && Number.isFinite(anchorPx.x) ? anchorPx.x : vw / 2, ay = anchorPx && Number.isFinite(anchorPx.y) ? anchorPx.y : vh / 2; setZoomCam(camera, z, ax, ay, vw, vh); zoomNow = camera.zoom; markMoved(true); if (root && root.setPiece) M.captureCameraTouch(root); };
  /** next zoom step in [0.5, 1, 2] */
  M.zoomStep = function (dir, anchorPx) { if (!camera) return; const k = ZOOMS.indexOf(camera.zoom); const nk = clamp((k < 0 ? 1 : k) + (dir < 0 ? -1 : 1), 0, ZOOMS.length - 1); M.setZoom(ZOOMS[nk], anchorPx); };
  /** follow an agent id each frame (−1 releases; a user pan releases too) */
  M.follow = function (agentId) { if (camera) camera.follow = Number.isFinite(agentId) ? agentId | 0 : -1; };
  /** follow the first state.vehicles entry matching pred(v, state) each frame (null releases; a user pan releases too; releases itself when nothing matches) */
  M.followVehicle = function (pred) { followVehicle = typeof pred === 'function' ? pred : null; };
  /** screen shake for ms (ignored when settings.shake is off) */
  M.shake = function (ms, px) { if (!Number.isFinite(ms)) { rerr('shake', new Error('non-finite ms')); return; } if (root && root.ui && root.ui.settings && root.ui.settings.shake === false) return; shakeUntil = nowMs() + Math.max(0, ms); shakePx = fin(px, PR.shakePx || 6); };
  /** pause ticks for ms (presentation juice; never in headless) */
  M.hitStop = function (ms) { if (!Number.isFinite(ms)) { rerr('hitStop', new Error('non-finite ms')); return; } if (BSU.headlessMode) return; hitStopUntilMs = nowMs() + Math.max(0, ms); };
  /** gold pulse on tiles for ms (any large finite ms; 1e9 = until cleared) */
  M.flashTiles = function (tiles, ms) { if (!Number.isFinite(ms)) { rerr('flashTiles', new Error('non-finite ms')); return; } if (!Array.isArray(tiles)) return; flashes.push({ tiles: tiles.slice(), until: nowMs() + Math.max(0, ms) }); };
  /** clear every Show-me flash */
  M.clearFlashes = function () { flashes.length = 0; };
  /** store the placement ghost spec (drawn in the overlays pass); null clears */
  M.ghost = function (spec) { ghostSpec = spec || null; };
  /** switch the overlay (writes state.ui.overlay; the fade is the overlays pass's) */
  M.setOverlay = function (ov) { if (!root || !root.ui) return; ov = fin(ov, OV.NONE) | 0; if (ov < OV.NONE || ov > OV.ECOLOGY) ov = OV.NONE; if (root.ui.overlay !== ov) { root.ui.overlay = ov; overlayFadeStart = nowMs(); } };
  /** a user touched the camera during a set piece */
  M.captureCameraTouch = function (state) { state = state || root; if (state && state.setPiece) state.setPiece.cameraTouched = true; };
  /** perf counters of the last frame (finite before any frame) */
  M.perf = function () {
    let hydroActive = 0, mem = 0;
    try { const h = mod('hydro'); if (h && typeof h.activeCount === 'function') hydroActive = fin(h.activeCount(), 0); } catch (e) { hydroActive = 0; }
    try { const sp = S(); mem = typeof sp.totalMemoryMB === 'function' ? sp.totalMemoryMB() : sp.memoryMB(); } catch (e) { mem = 0; }
    mem += liveChunks() * C.chunkMB + (canvas ? (canvas.width * canvas.height * 12) / 1048576 : 0) + teeBytes / 1048576;
    let parts = 0; try { parts = M.particles && typeof M.particles.count === 'function' ? fin(M.particles.count(), 0) : 0; } catch (e) { parts = 0; }
    return { frameMs: fin(frameMs, 0), drawCalls: drawCalls | 0, particles: parts, agentsDrawn: agentsDrawn | 0, hydroActive: hydroActive, chunks: liveChunks(), memMB: Math.round(mem * 100) / 100, tees: teeCache.size, water: waterDrawn | 0, frameNo: frameNo, zoom: zoomNow, perfMode: !!(root && root.ui && root.ui.perfMode) };
  };
  /** render_fx / ui register or replace a named pass: order 5 weather, 6 tint, 7 lights, 8 fog, 9 overlays, 10 hud */
  M.registerPass = function (name, fn, order_, builtin) {
    if (typeof fn !== 'function') return;
    for (let k = 0; k < passes.length; k++) if (passes[k].name === name) { passes.splice(k, 1); break; }
    passes.push({ name: String(name), fn: fn, order: fin(order_, 9), builtin: !!builtin });
    passes.sort((a, b) => a.order - b.order);
  };
  /** the registered passes (read-only view) */
  M.passes = function () { return passes.map((p) => ({ name: p.name, order: p.order, builtin: p.builtin })); };
  /** ui hands render the #minimap canvas */
  M.attachMinimap = function (el) { minimapEl = el || null; };

  // ---------------------------------------------------------------------------
  // Draw primitives
  // ---------------------------------------------------------------------------
  function colorFor(a, b, t, q) { const key = a + b + q; let c = colorCache.get(key); if (!c) { c = S().mix(a, b, t); colorCache.set(key, c); } return c; }
  /** translucent 2:1 diamond from fillRect runs (row step 1 at 1×, 2 at 0.5×/2×) */
  function fillDiamond(g, cx, cy, w, h, step) {
    const top = cy - h / 2;
    for (let r = 0; r < h; r += step) {
      const half = (w / 2) * (1 - Math.abs(r + step / 2 - h / 2) / (h / 2));
      if (half > 0.5) { g.fillRect(Math.round(cx - half), Math.round(top + r), Math.round(2 * half), step); drawCalls++; }
    }
  }
  function diamondPath(g, cx, cy, w, h) { g.moveTo(cx, cy - h / 2); g.lineTo(cx + w / 2, cy); g.lineTo(cx, cy + h / 2); g.lineTo(cx - w / 2, cy); g.closePath(); }
  /** drawImage a SpriteRef at anchor (sx, sy) in CSS px, scaled from the ref's zoom to the live zoom */
  function blit(g, ref, sx, sy, zs) {
    g.drawImage(ref.canvas, ref.sx, ref.sy, ref.sw, ref.sh, Math.round(sx + ref.ox * zs), Math.round(sy + ref.oy * zs), ref.sw * zs, ref.sh * zs);
    drawCalls++;
  }
  function getRef(id, variant, frame) { const sp = S(); const r = sp.get(id, variant, frame, zoomNow); return r || null; }
  function zsOf(ref) { return zoomNow / (ref.zoom || 1); }

  // ---------------------------------------------------------------------------
  // Pass 3 — live water
  // ---------------------------------------------------------------------------
  function waterPass(state, g) {
    const t = state.tiles, elev = t.elev, depth = t.depth, type = t.type, fl = t.flags;
    const z = zoomNow, w = TW * z, h = TH * z, step = z === 1 ? 1 : 2;
    const surgeOn = !!(state.hydro && state.hydro.surge);
    const hyd = mod('hydro');
    const cap = surgeOn ? C.waterCapSurge : C.waterCap;
    const phase = info.phase, sparkle = (phase === SKY.DAY || phase === SKY.GOLDEN);
    const lines = z >= 1;
    const surgeColor = S().shade(PAL.waterNight || WATER_DEEP, 0.8), currentColor = S().shade(PAL.waterDay || WATER_SHALLOW, 1.2);
    const camx = camera.x, camy = camera.y, hw = vw / 2, hh = vh / 2;
    waterDrawn = 0;
    g.globalCompositeOperation = 'source-over';
    for (let ty = view.y0; ty <= view.y1 && waterDrawn < cap; ty++) {
      for (let tx = view.x0; tx <= view.x1; tx++) {
        const i = ty * W + tx, ty8 = type[i], f = fl[i];
        let d = fin(depth[i], 0);
        const isWater = (f & WATER_FLAGS) !== 0 || ty8 === T.OPEN_WATER || ty8 === T.BAYOU;
        const show = isWater || ty8 === T.POND || (ty8 === T.MARSH ? d >= (PR.marshLiveDepth || 0.5) : d >= 0.05);
        if (!show) continue;
        if (isWater && d < 0.25) d = 1;
        const surfE = fin(elev[i], 0) + d;
        const sx = ((tx - ty) * 32 - camx) * z + hw, sy = ((tx + ty) * 16 - surfE * PXFT - camy) * z + hh;
        if (sx < -w || sx > vw + w || sy < -h || sy > vh + h) continue;
        waterDrawn++;
        const dn = clamp(d / 4, 0, 1), q = Math.round(dn * 15);
        let col = colorFor(WATER_SHALLOW, WATER_DEEP, q / 15, q);
        let a = 0.55 + 0.3 * clamp(d / 2, 0, 1);
        const reached = surgeOn && hyd && typeof hyd.surgeReached === 'function' && hyd.surgeReached(state, i) === true;
        if (reached) { col = surgeColor; a = 0.85; }
        g.globalAlpha = a; g.fillStyle = col;
        fillDiamond(g, sx, sy, w, h, step);
        if (reached) { g.globalAlpha = 0.8; g.fillStyle = '#5A4A3A'; g.fillRect(Math.round(sx - 10 * z + (hash(tx, ty) % 16) * z), Math.round(sy - 3 * z + (hash(ty, tx) % 6) * z), 3 * z, z); g.fillRect(Math.round(sx + (hash(tx + 1, ty) % 12) * z), Math.round(sy + (hash(ty, tx + 1) % 5) * z), 2 * z, z); drawCalls += 2; }
        if (lines && !reached) {
          // two scrolling 1-px sine highlight lines (8 segments each, clipped to the diamond)
          g.globalAlpha = 0.5; g.fillStyle = WATER_SHALLOW;
          const ph = frameNo * 0.12 + (hash(tx, ty) & 7);
          for (let k = 0; k < 8; k++) {
            const lx = -32 + k * 8 + 4, ly1 = -5 + 2 * Math.sin((k * 8 + ph * 4) / 16 * Math.PI * 2), ly2 = 5 + 2 * Math.sin((k * 8 + 8 + ph * 4) / 16 * Math.PI * 2);
            if (Math.abs(lx) / 32 + Math.abs(ly1) / 16 <= 0.92) { g.fillRect(Math.round(sx + (lx - 4) * z), Math.round(sy + ly1 * z), 8 * z, z); drawCalls++; }
            if (Math.abs(lx) / 32 + Math.abs(ly2) / 16 <= 0.92) { g.fillRect(Math.round(sx + (lx - 4) * z), Math.round(sy + ly2 * z), 8 * z, z); drawCalls++; }
          }
          if (sparkle && ((tx * 7 + ty * 13) & (C.sparkleEvery - 1)) === 0 && ((frameNo >> 4) + tx) % 3 === 0) { g.globalAlpha = 0.5; g.fillStyle = '#FFFFFF'; g.fillRect(Math.round(sx - 16 * z + (hash(tx, ty) % 32) * z), Math.round(sy - 6 * z + (hash(ty, tx) % 12) * z), z, z); drawCalls++; }
          if (f & FLAG.BAYOU) {   // the bayou current line along the direction of the next bayou tile
            const dirE = (tx < W - 1 && (fl[i + 1] & FLAG.BAYOU)) ? 1 : 0, dirS = (ty < HGT - 1 && (fl[i + W] & FLAG.BAYOU)) ? 1 : 0;
            const off = ((frameNo >> 1) + tx * 3) % 24 - 12;
            g.globalAlpha = 0.35; g.fillStyle = currentColor;
            const cxp = sx + (dirE - dirS) * off * z * 1.0, cyp = sy + (dirE + dirS) * off * z * 0.5;
            g.fillRect(Math.round(cxp - 6 * z), Math.round(cyp), 12 * z, z); drawCalls++;
          }
        }
        if (f & FLAG.FLOODGATE) {   // live floodgate frame (0 open → 3 closed; animated over 20 ticks from the gate:* event)
          const gs = gates.get(i); let fr = 0;
          if (gs) { const prog = clamp((frameNo - gs.t0) / 12, 0, 1); fr = gs.closed ? Math.round(prog * 3) : Math.round((1 - prog) * 3); }
          const ref = getRef('gate', 0, fr);
          if (ref) { g.globalAlpha = 1; blit(g, ref, sx, sy, zsOf(ref)); }
        }
      }
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Pass 4 — depth-sorted entities
  // ---------------------------------------------------------------------------
  function grow() { const nk = new Float64Array(keys.length * 2); nk.set(keys); keys = nk; const no = new Int32Array(order.length * 2); no.set(order); order = no; }
  function push(kind, ax, ay, elev, rank, draw) {
    let e = pool[count];
    if (!e) e = pool[count] = { kind: '', ax: 0, ay: 0, elev: 0, rank: 0, key: 0, draw: null, ref: null, sx: 0, sy: 0, id: '', variant: 0, frame: 0, a: 0, b: 0, c: 0, d: 0 };
    e.kind = kind; e.ax = ax; e.ay = ay; e.elev = elev; e.rank = rank; e.draw = draw; e.ref = null; e.id = ''; e.variant = 0; e.frame = 0; e.a = 0; e.b = 0; e.c = 0; e.d = 0;
    e.key = sortKey(ax, ay, elev, rank);
    if (count >= keys.length) grow();
    keys[count] = e.key; order[count] = count; count++;
    return e;
  }
  function sortList() {
    for (let k = 1; k < count; k++) {   // insertion sort of `order` by key (mostly sorted frame to frame)
      const o = order[k], kv = keys[o]; let j = k - 1;
      while (j >= 0 && keys[order[j]] > kv) { order[j + 1] = order[j]; j--; }
      order[j + 1] = o;
    }
    list.length = count;
    for (let k = 0; k < count; k++) list[k] = pool[order[k]];
  }
  function moverScreen(e) { const wx = (e.ax - e.ay) * 32, wy = (e.ax + e.ay - 1) * 16 - e.elev * PXFT; e.sx = (wx - camera.x) * zoomNow + vw / 2; e.sy = (wy - camera.y) * zoomNow + vh / 2; }
  function tileScreen(e) { const wx = (e.ax - e.ay) * 32, wy = (e.ax + e.ay) * 16 - e.elev * PXFT; e.sx = (wx - camera.x) * zoomNow + vw / 2; e.sy = (wy - camera.y) * zoomNow + vh / 2; }
  function surfaceAtTile(t, i) { const ty8 = t.type[i]; const e = fin(t.elev[i], 0); if (ty8 === T.OPEN_WATER || ty8 === T.BAYOU || ty8 === T.POND || (t.flags[i] & WATER_FLAGS)) return e + Math.max(0.5, fin(t.depth[i], 0)); return e + (fin(t.depth[i], 0) >= 0.3 ? fin(t.depth[i], 0) : 0); }
  function inView(tx, ty, pad) { return tx >= view.x0 - pad && tx <= view.x1 + pad && ty >= view.y0 - pad && ty <= view.y1 + pad; }
  function reportNaN(what) { if (!nanReported) { nanReported = true; rerr('entities', new Error('non-finite position on ' + what)); } }

  // -- draw functions (shared per kind; signature draw(e, g, view, alpha)) --
  function drawSprite(e, g) { if (!e.ref) return; blit(g, e.ref, e.sx, e.sy, zsOf(e.ref)); }
  function drawBuilding(e, g) {
    const ref = e.ref, b = e.b; if (!ref) return;
    const zs = zsOf(ref);
    const sq = M.squash && M.squash[b.id];
    const tilt = fin(b.sunk, 0) >= 1.5;
    let scaleY = 1;
    if (Number.isFinite(sq)) { const tt = (nowMs() - sq) / (PR.squashMs || 200); if (tt >= 1) delete M.squash[b.id]; else scaleY = 1 + (C.squashScale - 1) * (1 - tt); }
    if (scaleY !== 1 || tilt) {
      g.save(); g.translate(e.sx, e.sy);
      if (tilt) g.rotate(C.sinkTiltDeg * Math.PI / 180);
      if (scaleY !== 1) g.scale(1, scaleY);
      blit(g, ref, 0, 0, zs); g.restore();
    } else blit(g, ref, e.sx, e.sy, zs);
    // icons above the roof: Sinking!, no access / power / water
    const top = e.sy + ref.oy * zs;
    const nIcons = (e.c & 1) + ((e.c >> 1) & 1) + ((e.c >> 2) & 1);
    let ix = e.sx - (nIcons - 1) * 7 * zoomNow;
    if (fin(b.sunk, 0) >= 1) { const r = getRef('decal:sinking', 0, (frameNo >> 4) & 1); if (r) blit(g, r, e.sx, top - C.bubbleLift * zoomNow, zsOf(r)); }
    if (e.c & 1) { const r = getRef('decal:power', 0, 0); if (r) { g.globalAlpha = 0.75 + 0.25 * Math.sin(frameNo / 8); blit(g, r, ix, top - 2 * zoomNow, zsOf(r)); g.globalAlpha = 1; } ix += 14 * zoomNow; }
    if (e.c & 2) { const r = getRef('decal:water', 0, 0); if (r) { g.globalAlpha = 0.75 + 0.25 * Math.sin(frameNo / 8 + 1); blit(g, r, ix, top - 2 * zoomNow, zsOf(r)); g.globalAlpha = 1; } ix += 14 * zoomNow; }
    if (e.c & 4) { const r = getRef('decal:noAccess', 0, 0); if (r) { g.globalAlpha = 0.75 + 0.25 * Math.sin(frameNo / 8 + 2); blit(g, r, ix, top - 2 * zoomNow, zsOf(r)); g.globalAlpha = 1; } }
  }
  function drawTree(e, g) {
    const ref = e.ref; if (!ref) return;
    const zs = zsOf(ref);
    blit(g, ref, e.sx, e.sy, zs);
    if (e.id === 'oak' && e.variant >= 1 && zoomNow >= 1) {   // Spanish moss: one path per oak, hashed canopy points, wind sway
      const seed = e.a | 0, n = C.mossMin + (hash(seed, 11) % (C.mossMax - C.mossMin + 1));
      const left = e.sx + ref.ox * zs, top = e.sy + ref.oy * zs, sw = ref.sw * zs, sh = ref.sh * zs;
      g.strokeStyle = PAL.moss || '#9BAA8A'; g.lineWidth = zoomNow; g.globalAlpha = 0.9;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const hx = hash(seed, 100 + k), hy = hash(seed, 200 + k);
        const x0 = left + sw * 0.15 + (hx % 1000) / 1000 * sw * 0.7, y0 = top + sh * 0.2 + (hy % 1000) / 1000 * sh * 0.35;
        const len = (6 + (hash(seed, 300 + k) % 9)) * zoomNow;
        const sway = Math.sin(frameNo / 20 + (hx & 15)) * info.wind * C.mossSway * zoomNow;
        g.moveTo(Math.round(x0) + 0.5, Math.round(y0)); g.lineTo(Math.round(x0 + sway) + 0.5, Math.round(y0 + len));
      }
      g.stroke(); g.globalAlpha = 1; drawCalls++;
    }
  }
  function drawAgent(e, g) {
    const ref = e.ref; if (!ref) return;
    blit(g, ref, e.sx, e.sy, zsOf(ref));
    if (e.c) { const r = getRef('bubble', 0, (frameNo >> 3) % 3); if (r) blit(g, r, e.sx, e.sy + ref.oy * zsOf(ref) - C.bubbleLift * zoomNow, zsOf(r)); }
  }
  function drawParticle(e, g) {
    const col = M.particleColors[(e.variant | 0) & 15] || GOLD;
    g.fillStyle = typeof e.id === 'string' && e.id ? e.id : col;
    const sz = Math.max(1, e.a * zoomNow);
    g.fillRect(Math.round(e.sx), Math.round(e.sy), sz, sz); drawCalls++; particlesDrawn++;
  }
  function particleCb(x, y, z, size, colorIdx, type) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const ax = (x / 32 + y / 16) / 2, ay = (y / 16 - x / 32) / 2, zz = fin(z, 0);
    const e = push('particle', ax, ay, zz / PXFT, 3, drawParticle);
    e.a = fin(size, 1); e.variant = typeof colorIdx === 'number' ? colorIdx : 0; e.id = typeof colorIdx === 'string' ? colorIdx : ''; e.d = type;
    e.sx = (x - camera.x) * zoomNow + vw / 2; e.sy = (y - zz - camera.y) * zoomNow + vh / 2;
  }
  function pushMover(kind, m, id, variant, frame, elevFn, state) {
    const ax = fin(m.px, m.tx) + (fin(m.tx, 0) - fin(m.px, fin(m.tx, 0))) * alphaNow, ay = fin(m.py, m.ty) + (fin(m.ty, 0) - fin(m.py, fin(m.ty, 0))) * alphaNow;
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) { reportNaN(kind); return null; }
    const tx = clamp(Math.floor(ax), 0, W - 1), ty = clamp(Math.floor(ay), 0, HGT - 1);
    if (!inView(tx, ty, 2)) return null;
    const i = ty * W + tx;
    const el = elevFn(state.tiles, i);
    const e = push(kind, ax - 0.5, ay - 0.5, el, 2, kind === 'agent' ? drawAgent : drawSprite);
    e.ref = getRef(id, variant, frame); e.id = id; e.variant = variant; e.frame = frame;
    moverScreen(e);
    return e;
  }
  const groundElev = (t, i) => fin(t.elev[i], 0);
  const VEH_ID = { pirogue: 'pirogue', bus: 'bus', fogger: 'fogger', cajunNavy: 'navy', navy: 'navy', crew: 'officer', float: 'float' };
  const WATER_VEH = { pirogue: 1, cajunNavy: 1, navy: 1 };

  function gatherInfo(state) {
    const wx = mod('weather');
    let sky = null; try { sky = wx && typeof wx.sky === 'function' ? wx.sky(state) : null; } catch (e) { sky = null; }
    info.phase = fin(sky ? sky.phase : (state.sky ? state.sky.phase : SKY.DAY), SKY.DAY);
    info.day = fin(state.calendar ? state.calendar.day : 0, 0);
    info.month = fin(state.calendar ? state.calendar.month : 1, 1); info.dom = fin(state.calendar ? state.calendar.dom : 1, 1);
    let wind = 0; try { wind = wx && typeof wx.wind === 'function' ? fin(wx.wind(state).speed, 0) : fin(state.weather && state.weather.wind, 0); } catch (e) { wind = 0; }
    info.wind = clamp(wind, 0, 2);
    info.barrierClosed = !!(state.hydro && state.hydro.barrierClosed);
    const st = state.storms && state.storms.current;
    info.toppleIds = st && st.rolls && Array.isArray(st.rolls.toppleIds) ? st.rolls.toppleIds : null;
    info.autumn = info.month === 11;
    info.bloom = info.month === 3 || (info.month === 4 && info.dom <= 10);
    info.perfMode = !!(state.ui && state.ui.perfMode);
    // design pass: ground shadows follow the sky clock — long and low at dawn/dusk, short at midday, faint moonlight at night;
    // they fall down-left (the sprites are lit from the SE), sliding further out when the sun is low
    const t = clamp(fin(sky ? sky.t : (state.sky ? state.sky.t : 0.5), 0.5), 0, 1);
    let sx = -0.9, sy = 0.42, len = 0.6, al = C.shadowAlpha;
    if (info.phase === SKY.DAWN) { sx = -1; sy = 0.3; len = 1.1 - 0.3 * t; al = 0.14 + 0.08 * t; }
    else if (info.phase === SKY.DAY) { const c = Math.abs(Math.cos(Math.PI * t)); sx = -(0.55 + 0.45 * c); sy = 0.45 - 0.1 * c; len = 0.4 + 0.5 * c; al = C.shadowAlpha; }
    else if (info.phase === SKY.GOLDEN) { sx = -1; sy = 0.35; len = 0.9 + 0.3 * t; al = 0.24; }
    else if (info.phase === SKY.DUSK) { sx = -1; sy = 0.3; len = 1.2; al = 0.16 * (1 - t) + 0.06 * t; }
    else { sx = -0.6; sy = 0.45; len = 0.5; al = 0.07; }
    info.shX = sx * len; info.shY = sy * len; info.shAlpha = al;
  }
  /** entrance side for the sprite: SE (default) unless a path/road/boardwalk touches only the SW edge */
  function frontLeftOf(t, b) {
    const w = b.w | 0, h = b.h | 0, tx = b.tx | 0, ty = b.ty | 0, surf = t.surface;
    const ex = tx + w; if (ex < W) for (let y = ty; y < ty + h; y++) { const s = surf[y * W + ex]; if (s >= 1 && s <= 3) return false; }
    const ey = ty + h; if (ey < HGT) for (let x = tx; x < tx + w; x++) { const s = surf[ey * W + x]; if (s >= 1 && s <= 3) return true; }
    return false;
  }
  // -- tee pass: a path / road / boardwalk running flush along a finished building's visible footprint edges (SE = east
  //    neighbours, SW = south neighbours; the NW/NE aprons sit behind the structure) gets a connector into the wall. Per
  //    building we keep the tee list (recomputed when a tile touching the footprint changes, or the building completes /
  //    is removed) and ONE uncached sprite bake per (variant, frame, zoom, tees) through sprites.bakeWith, so the shared
  //    atlas never multiplies. Codes: (surface << 6) | (side << 4) | k, k counted from the footprint's bottom corner. --
  const teeCache = new Map();   // b.id → { tees: int[] | null, sig, fl, key, ref, used }
  const teeScratch = new Int8Array(16);
  const TEE_MAX = 64, TEE_IDLE = 300, TEE_BAKES_PER_FRAME = 4;
  let teeBakes = 0, teeBytes = 0;
  function teeEdge(surf, side, n, base, step, front, out) {
    if (n <= 0) return;
    const s = teeScratch; let any = 0;
    for (let k = 0; k < n && k < 16; k++) {
      let v = surf[base + k * step]; v = (v >= 1 && v <= 3) ? v : 0;
      if (v && front && Math.abs(32 * k + 16 - n * 16) < 24) v = 0;   // the entrance walk already ties this tile in (both tiles of an even face)
      s[k] = v; any |= v;
    }
    if (!any) return;
    n = Math.min(n, 16);
    for (let a = 0; a < n;) {
      if (!s[a]) { a++; continue; }
      let b = a; while (b + 1 < n && s[b + 1]) b++;
      const L = b - a + 1;
      if (L <= 2) for (let k = a; k <= b; k++) out.push((s[k] << 6) | (side << 4) | k);
      else { out.push((s[a] << 6) | (side << 4) | a); if (L >= 5) { const m = (a + b) >> 1; out.push((s[m] << 6) | (side << 4) | m); } out.push((s[b] << 6) | (side << 4) | b); }   // a long run: the ends (and the middle), not a tee per tile
      a = b + 1;
    }
  }
  /** the tee codes for building b given the live surfaces (frontLeft = the entrance faces SW); null when nothing touches */
  M.teesOf = function (state, b, frontLeft) {
    if (!state || !state.tiles || !b) return null;
    const surf = state.tiles.surface, w = b.w | 0, h = b.h | 0, tx = b.tx | 0, ty = b.ty | 0, out = [];
    if (tx + w < W) teeEdge(surf, 0, h, (ty + h - 1) * W + tx + w, -W, !frontLeft, out);     // SE edge: east neighbours, k up the edge
    if (ty + h < HGT) teeEdge(surf, 1, w, (ty + h) * W + tx + w - 1, -1, !!frontLeft, out);   // SW edge: south neighbours, k along the edge
    return out.length ? out : null;
  };
  function teeRef(state, b, row, id, v, fr) {
    let c = teeCache.get(b.id);
    const fl = !!(v & SPR.FRONT_L);
    if (c === undefined) {
      const sp = S();
      if (typeof sp.teeable !== 'function' || typeof sp.bakeWith !== 'function' || !sp.teeable(row, b.rot ? 1 : 0)) c = null;
      else { const tees = M.teesOf(state, b, fl); c = { tees: tees, sig: tees ? tees.join(',') : '', fl: fl, key: '', ref: null, used: frameNo }; }
      teeCache.set(b.id, c);
    }
    if (!c) return null;
    c.used = frameNo;
    if (c.fl !== fl) { c.fl = fl; c.tees = M.teesOf(state, b, fl); c.sig = c.tees ? c.tees.join(',') : ''; c.key = ''; }
    if (!c.tees) return null;
    const z = zoomNow >= 2 ? 2 : 1;
    const key = v + '|' + fr + '|' + z + '|' + c.sig;
    if (c.key !== key) {
      if (teeBakes >= TEE_BAKES_PER_FRAME) return c.ref;   // over budget this frame: keep the previous bake (or the plain sprite) one more frame
      teeBakes++;
      let ref = null; try { ref = S().bakeWith(id, v, fr, zoomNow, { tees: c.tees }); } catch (e) { rerr('tee:bake', e); ref = null; }
      if (c.ref) teeBytes -= c.ref.bytes | 0;
      c.ref = ref; c.key = key; if (ref) teeBytes += ref.bytes | 0;
    }
    return c.ref;
  }
  function teeDrop(id) { const c = teeCache.get(id); if (c === undefined) return; if (c && c.ref) teeBytes -= c.ref.bytes | 0; teeCache.delete(id); }
  /** a tile changed: every building whose footprint touches it (4- or 8-adjacent) recomputes its tees */
  function teeInvalidateNear(i) {
    if (!root || !root.tiles || !teeCache.size) return;
    const own = root.tiles.owner, tx = i & 63, ty = i >> 6;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy; if (x < 0 || y < 0 || x >= W || y >= HGT) continue;
      const o = own[y * W + x]; if (o >= 0 && teeCache.has(o)) teeDrop(o);
    }
  }
  function teeClear() { teeCache.clear(); teeBytes = 0; }
  /** a building finished or went away: its tee / walk stubs (smoothing pass) live in the chunks around the footprint */
  function dirtyAroundBuilding(p) {
    curvesDirty = true;
    let b = p;
    if (!(Number.isFinite(p.tx) && Number.isFinite(p.w)) && root && Array.isArray(root.buildings)) { b = null; for (let k = 0; k < root.buildings.length; k++) { const q = root.buildings[k]; if (q && q.id === p.id) { b = q; break; } } }
    if (!b) return;
    const x0 = Math.max(0, (b.tx | 0) - 1), y0 = Math.max(0, (b.ty | 0) - 1), x1 = Math.min(W - 1, (b.tx | 0) + (b.w | 0)), y1 = Math.min(HGT - 1, (b.ty | 0) + (b.h | 0));
    for (let cy = y0 >> 3; cy <= y1 >> 3; cy++) for (let cx = x0 >> 3; cx <= x1 >> 3; cx++) M.dirtyChunk(cx + cy * 8);
  }
  function teeSweep() { if (teeCache.size <= TEE_MAX) return; for (const [id, c] of teeCache) if (!c || c.used < frameNo - TEE_IDLE) teeDrop(id); }
  M.teeStats = function () { let n = 0; for (const c of teeCache.values()) if (c && c.tees) n++; return { cached: teeCache.size, withTees: n, mb: Math.round(teeBytes / 10485.76) / 100, bakesThisFrame: teeBakes }; };

  // -- design pass: soft ground shadows (one alpha-blended path for buildings, one for trees), drawn under the sorted entities --
  const shadowGeo = new Map();   // type|rot|pilings → the inset base quad (1× px relative to the anchor tile centre) and the structure height
  function shadowBox(b, v) {
    const key = b.type + (b.rot ? 'r' : '') + ((v & SPR.PILINGS) ? 'p' : '');
    let s = shadowGeo.get(key);
    if (s === undefined) {
      s = null;
      try {
        const sp = S(), row = BSU.data && BSU.data.catalog ? BSU.data.catalog[b.type] : null;
        if (row && row.kind === 'footprint' && typeof sp.buildingBox === 'function') {
          const g = sp.buildingBox(row, v & SPR.PILINGS, 1, b.rot ? 1 : 0);
          const tall = g && (g.wallH + g.roofH * 0.6 + (g.special === 'stadium' ? 22 : g.special === 'water_tower' ? 30 : 0));
          if (g && Number.isFinite(g.bl) && g.bl > 0 && g.br > 0 && tall >= 6) s = { dx: g.ipy - g.ipx, dy: 16 - ((g.ipx + g.ipy) >> 1) - g.lift, bl: g.bl, br: g.br, h: tall + g.lift };
        }
      } catch (e) { s = null; }
      shadowGeo.set(key, s);
    }
    return s;
  }
  function hull(pts) {   // Andrew's monotone chain (8 points at most)
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = []; for (let i = 0; i < pts.length; i++) { const p = pts[i]; while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    const up = []; for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop(); return lo.concat(up);
  }
  function shadowPass(g) {
    if (!(info.shAlpha > 0.1)) return;   // night: a 7 % moon shadow is invisible under the lights pass, so it costs nothing
    const z = zoomNow, ox = fin(info.shX, -0.6), oy = fin(info.shY, 0.3);
    g.fillStyle = C.shadowColor; g.globalAlpha = info.shAlpha; g.beginPath();
    let any = false;
    for (let k = 0; k < count; k++) {
      const e = pool[k]; if (e.kind !== 'building' || !e.b || !e.ref) continue;
      const b = e.b, v = e.variant | 0; if (v & SPR.RUIN) continue;
      const s = shadowBox(b, v); if (!s) continue;
      let H = s.h; if (v & SPR.SCAFFOLD) H *= clamp(fin(b.built, 0), 0.15, 1); if (H < 6) continue;
      const Sx = e.sx + s.dx * z, Sy = e.sy + s.dy * z, bl = s.bl * z, br = s.br * z;
      const dx = ox * H * z, dy = oy * H * z;
      const pts = hull([[Sx - bl, Sy - bl / 2], [Sx, Sy], [Sx + br, Sy - br / 2], [Sx - bl + br, Sy - (bl + br) / 2],
        [Sx - bl + dx, Sy - bl / 2 + dy], [Sx + dx, Sy + dy], [Sx + br + dx, Sy - br / 2 + dy], [Sx - bl + br + dx, Sy - (bl + br) / 2 + dy]]);
      if (pts.length < 3) continue;
      g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); any = true;
    }
    if (any) { g.fill(); drawCalls++; }
    if (!info.perfMode && z >= 1) {   // trees (1×/2× only: at 0.5× the whole map is in view): an ellipse under the canopy, slid toward the shadow side by the tree's height
      g.globalAlpha = info.shAlpha * 0.8; g.beginPath(); any = false;
      for (let k = 0; k < count; k++) {
        const e = pool[k]; if (e.kind !== 'tree' || !e.ref) continue;
        const ref = e.ref, zs = zsOf(ref), sw = ref.sw * zs, sh = ref.sh * zs; if (sw < 8) continue;
        const rx = sw * 0.3, ry = Math.max(1.5, rx * 0.42), H = sh * 0.5;
        const cx = e.sx + ox * H * 0.6, cy = e.sy + oy * H * 0.25 + z;
        g.moveTo(cx + rx, cy); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); any = true;
      }
      if (any) { g.fill(); drawCalls++; }
    }
    g.globalAlpha = 1;
  }
  // ---------------------------------------------------------------------------
  // Football pass F — the field quad, the 22 players, ball, officials, sideline, stands and the
  // game camera (PLAN_FOOTBALL §2.2). Reads BSU.sports.live(state) / drill(state) and the fb*
  // sprites (pass E). Every on-field entity is pushed at the VENUE'S anchor with rank 0.4–60
  // (depth inside the footprint) so it sorts right after the bowl and never under the turf.
  // Nothing is drawn or allocated without a live game or an idle drill.
  // ---------------------------------------------------------------------------
  // Field entities are drawn from the 1x atlas at HALF the camera zoom (18x24 px at 2x): the field is only
  // ~4 tiles long for 120 yd, so a full-size figure would be 8 yd wide and the formation a blob. No fractional
  // zoom exists, and at 1x even half-size players are an ant farm, so every venue is framed at 2x (the whole
  // Stadium bowl fits 1280x800 at 2x). M.fbEnabled = false hides the layer and freezes its camera (perf A/B).
  const FB_YD_U = 120, FB_YD_V = 53.3, FB_ZOOM = { practice_field: 2, stadium: 2 }, FB_SCALE = 0.5;
  M.fbEnabled = true;
  const FB = {                                   // render-local football state (never saved)
    live: null, drill: null, venue: null, game: null, tickSeen: -1, n: 0, playT0: -2, huddleAt: -1,
    px: new Float32Array(22), py: new Float32Array(22), cx: new Float32Array(22), cy: new Float32Array(22), team: new Int8Array(22), face: new Int8Array(22),
    bpx: 50, bpy: 0, bcx: 50, bcy: 0, crewU: 50, gainU: 60, refU: 50, refV: 18,
    warm: 0, warmZoom: 0, crowdUp: 0, waveAt: -1e9, scoreAt: -1e9, keyAt: -1e9, hitAt: -1e9, sigAt: -1e9, bellsAt: -1e9,
    cam: { active: false, zoomBefore: 1, touched: false },
    drawn: 0, players: 0, fans: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, crowdFrame: -1
  };
  /** the painted field's footprint rect {x0, y0, x1, y1, fw, fh} (tiles; X along +tx, Y along +ty) exactly as the stadium / practice-field painters draw it */
  M.fieldQuad = function (b) {
    if (!b) return null;
    const fw = Math.max(1, fin(b.w, 1)), fh = Math.max(1, fin(b.h, 1));
    if (b.type === 'practice_field') return { x0: 0.6, y0: 0.3, x1: fw - 0.6, y1: fh - 0.3, fw: fw, fh: fh };
    if (b.type === 'stadium') return { x0: 1, y0: 1, x1: fw - 1, y1: fh - 1, fw: fw, fh: fh };
    return null;
  };
  /** field yards → continuous tile coords: u −10…110 along the field (end zones included; BSU's goal line u = 0, the engine's `spot`), v 0…53.3 across (0 = the far sideline = the home bench) */
  M.fieldToTile = function (b, u, v, q) {
    q = q || M.fieldQuad(b); if (!q) return null;
    return { tx: fin(b.tx, 0) + q.x0 + (fin(u, 0) + 10) / FB_YD_U * (q.x1 - q.x0), ty: fin(b.ty, 0) + q.y0 + fin(v, 0) / FB_YD_V * (q.y1 - q.y0) };
  };
  /** → world px (zoom 1) of that field point on the venue's ground plane, `up` px above it (the venue's anchor elevation, like the building sprite) */
  M.fieldToWorld = function (b, u, v, up, q) {
    const t = M.fieldToTile(b, u, v, q); if (!t) return null;
    const ax = clamp((fin(b.tx, 0) | 0) + (fin(b.w, 1) | 0) - 1, 0, W - 1), ay = clamp((fin(b.ty, 0) | 0) + (fin(b.h, 1) | 0) - 1, 0, HGT - 1);
    return { x: (t.tx - t.ty) * 32, y: (t.tx + t.ty - 1) * 16 - elevAt(ax, ay) * PXFT - fin(up, 0) };
  };
  /** the building a game is played at: sports.venue (else the game's own venue) → the highest complete stadium tier, or the Practice Field with bleachers; forDrill = any complete practice field */
  M.fieldVenue = function (state, forDrill) {
    state = state || root; if (!state || !Array.isArray(state.buildings)) return null;
    const sp = state.sports, g = sp && sp.game;
    const venue = forDrill ? 'bayou_field' : String((sp && sp.venue) || (g && g.venue) || '');
    const want = venue.indexOf('stadium') === 0 ? 'stadium' : 'practice_field';
    let pick = null;
    for (let k = 0; k < state.buildings.length; k++) {
      const b = state.buildings[k]; if (!b || b.type !== want || !(fin(b.built, 0) >= 1) || b.ruin) continue;
      if ((want === 'stadium' || !forDrill) && !(fin(b.tier, 0) >= 1)) continue;
      if (!pick || fin(b.tier, 0) > fin(pick.tier, 0)) pick = b;
    }
    return pick;
  };
  /** test/debug view of the football layer: what the last frame drew */
  M.fbInfo = function () { return { drawn: FB.drawn, players: FB.players, fans: FB.fans, active: !!FB.live, drill: !!FB.drill, venue: FB.venue ? FB.venue.id : -1, minX: FB.minX, maxX: FB.maxX, minY: FB.minY, maxY: FB.maxY, camera: FB.cam.active, crowdUp: FB.crowdUp }; };
  /** game events forwarded by render_fx (score / play / kickoff / halftime / final) → crowd reactions */
  M.fbNotify = function (kind, p) {
    p = p || {};
    if (kind === 'score') { if (p.side === 'home') { FB.scoreAt = frameNo; FB.waveAt = frameNo; FB.crowdUp = 200; FB.sigAt = frameNo; } else FB.crowdUp = 0; }
    else if (kind === 'play') {
      if (p.key) { FB.crowdUp = Math.max(FB.crowdUp, 90); FB.keyAt = frameNo; }
      if (p.type === 'sack' || p.res === 'fumble') FB.hitAt = frameNo;
      if (p.fourth && p.res === 'downs' && p.poss === 1) { FB.waveAt = frameNo; FB.crowdUp = 150; }
      if (p.res === 'good' && p.poss === 0) FB.sigAt = frameNo;
    }
    else if (kind === 'kickoff') { FB.crowdUp = 120; }
    else if (kind === 'final') { if (p.won) { FB.scoreAt = frameNo; FB.waveAt = frameNo; FB.crowdUp = 400; } }
  };
  function fbGather(state) {
    FB.live = null; FB.drill = null; FB.venue = null;
    if (M.fbEnabled === false) return;
    const sp = mod('sports'); if (!sp || !state.sports || typeof sp.live !== 'function') return;
    let lv = null; try { lv = sp.live(state); } catch (e) { rerr('fb:live', e); lv = null; }
    if (lv && lv.active && Array.isArray(lv.players)) { FB.live = lv; FB.venue = M.fieldVenue(state, false); }
    else {
      let d = lv && lv.drill ? lv.drill : null;
      if (!d && typeof sp.drill === 'function') { try { d = sp.drill(state); } catch (e) { d = null; } }
      if (d && Array.isArray(d.players) && info.phase !== SKY.NIGHT) { FB.drill = d; FB.venue = M.fieldVenue(state, true); }
    }
    if (!FB.venue) { FB.live = null; FB.drill = null; }
    if (!FB.live) { FB.crowdUp = 0; FB.game = null; FB.warm = 0; }
  }
  /** the game camera: frame the venue when a game set piece starts, follow the ball during plays, hand control back on skip / final (never fights a player who touched the camera) */
  function fbCamera(state, cam) {
    if (M.fbEnabled === false) return;   // frozen, not released (perf A/B keeps the same view)
    const spc = state.setPiece, kind = spc ? spc.kind : '';
    const on = !!(spc && (kind === 'game' || kind === 'spring') && FB.live && FB.venue);
    const C = FB.cam;
    if (!on) {
      if (C.active) { C.active = false; if (!C.touched && cam.zoom !== C.zoomBefore) setZoomCam(cam, C.zoomBefore, vw / 2, vh / 2, vw, vh); cam.hasTarget = false; markMoved(false); }
      return;
    }
    const b = FB.venue, q = M.fieldQuad(b); if (!q) return;
    if (!C.active) {
      C.active = true; C.zoomBefore = cam.zoom; C.touched = !!spc.cameraTouched;
      if (!spc.cameraTouched) { const z = FB_ZOOM[b.type] || 1; if (cam.zoom !== z) setZoomCam(cam, z, vw / 2, vh / 2, vw, vh); markMoved(false); }
    }
    if (spc.cameraTouched) { C.touched = true; return; }
    const lv = FB.live, ph = lv.phase;
    let u = 50, v = FB_YD_V / 2;
    if (ph === 'live' || ph === 'snap') { u = clamp(fin(lv.ball && lv.ball.x, 50), -10, 110); v = FB_YD_V / 2 + clamp(fin(lv.ball && lv.ball.y, 0), -26.6, 26.6) * 0.4; }
    else if (ph === 'huddle' || ph === 'decision' || ph === 'pregame') u = clamp(fin(lv.anim ? lv.anim.end : lv.spot, 50), 0, 100);
    const w = M.fieldToWorld(b, u, v, 0, q); if (!w) return;
    cam.tx = w.x; cam.ty = w.y; cam.hasTarget = true;     // eased by the camera LERP below
  }
  // -- entity helpers -----------------------------------------------------------------------
  const fbScr = { x: 0, y: 0 };
  function fbScreen(G, X, Y, up) {   // footprint (X, Y) tiles lifted `up` px → canvas px (into fbScr)
    const tx = G.tx0 + X, ty = G.ty0 + Y;
    const wx = (tx - ty) * 32, wy = (tx + ty - 1) * 16 - G.el * PXFT - (up || 0);
    fbScr.x = (wx - camera.x) * zoomNow + vw / 2; fbScr.y = (wy - camera.y) * zoomNow + vh / 2;
    return fbScr;
  }
  function drawFbSprite(e, g) { if (!e.ref) return; blit(g, e.ref, e.sx, e.sy, zoomNow * FB_SCALE / (e.ref.zoom || 1)); }
  function fbPush(G, kind, id, variant, frame, u, v, up, draw) {   // field yards → one sorted entry at the venue anchor (1x atlas, half the zoom)
    const X = G.q.x0 + (u + 10) * G.kx, Y = G.q.y0 + v * G.ky;
    const e = push(kind, G.ax, G.ay, G.el, 1 + clamp((X + Y) / (G.q.fw + G.q.fh), 0, 1) * 58, draw || drawFbSprite);
    fbScreen(G, X, Y, up); e.sx = fbScr.x; e.sy = fbScr.y;
    e.id = id; e.variant = variant; e.frame = frame; e.ref = id ? (G.sp.get(id, variant, frame, 1) || null) : null;
    FB.drawn++;
    return e;
  }
  function fbGeom(state, b, q) {
    const ax = clamp((b.tx | 0) + (b.w | 0) - 1, 0, W - 1), ay = clamp((b.ty | 0) + (b.h | 0) - 1, 0, HGT - 1);
    return { b: b, q: q, ax: ax, ay: ay, el: fin(state.tiles.elev[ay * W + ax], 0), kx: (q.x1 - q.x0) / FB_YD_U, ky: (q.y1 - q.y0) / FB_YD_V, tx0: fin(b.tx, 0), ty0: fin(b.ty, 0), sp: S() };
  }
  function drawFbLines(e, g) {   // line of scrimmage (blue) and the line to gain (yellow) across the turf, TV style
    const G = e.b; if (!G) return;
    g.save(); g.lineWidth = Math.max(1, Math.round(zoomNow * 1.5));
    for (let k = 0; k < 2; k++) {
      const u = k === 0 ? e.a : e.c; if (!Number.isFinite(u) || u < 0 || u > 100) continue;
      if (k === 1 && e.d === 0) continue;
      const X = G.q.x0 + (u + 10) * G.kx;
      fbScreen(G, X, G.q.y0, 0); const x0 = fbScr.x, y0 = fbScr.y; fbScreen(G, X, G.q.y1, 0);
      g.strokeStyle = k === 0 ? 'rgba(60,120,255,0.8)' : 'rgba(255,230,40,0.85)';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(fbScr.x, fbScr.y); g.stroke(); drawCalls++;
    }
    g.restore();
  }
  function drawFbBall(e, g) { if (!e.ref) return; blit(g, e.ref, e.sx, e.sy, zoomNow * 0.65 / (e.ref.zoom || 1)); }
  // -- the crowd: the shader backdrop (render_fx's R.crowd) under fan sprites on the visible stand treads --
  const FB_ROWS1 = [[0, 0.8875, 3], [2, 0.4375, 8.5]];                                  // tier I far bleachers: [tread, Y, lift]
  function fbStandRows(tier) {
    if (tier <= 1) return { far: FB_ROWS1, farX: [1, 0], end: null, upper: null };
    const dh = tier === 3 ? 3 : 3.8, rows = [[0, 0.91, 3], [2, 0.55, 3 + 2 * dh], [4, 0.19, 3 + 4 * dh]];
    return { far: rows, farX: [0.1, 0.1], end: rows, upper: tier === 3 ? [[1, 0.3, 25.3]] : null };
  }
  function drawFbCrowd(e, g) {
    const G = e.b, state = root; if (!G || !state) return;
    const b = G.b, sp = G.sp, fill = e.a, rain = e.c === 1;
    const z = zoomNow;
    // 1. the shader (render_fx) on the bowl rect (stadium) or the bleachers decal (Bayou Field)
    if (typeof M.crowd === 'function') {
      let rect = null;
      if (b.type === 'stadium') {
        const cat = (BSU.data && BSU.data.catalog) || {}; let box = null;
        try { box = typeof sp.buildingBox === 'function' ? sp.buildingBox(cat[b.type], (clamp(b.tier | 0, 0, 3) << SPR.TIER_SHIFT) >>> 0, z, b.rot) : null; } catch (err) { box = null; }
        const br = box && box.bowlRect; if (br) { const bs = z / (box.zoom || 1); rect = { x: e.sx + br.x * bs, y: e.sy + br.y * bs, w: br.w * bs, h: br.h * bs }; }
      } else { fbScreen(G, G.q.fw / 2, 0.45, 0); rect = { x: fbScr.x - 24 * z, y: fbScr.y - 10 * z, w: 48 * z, h: 9 * z }; }
      if (rect) {
        g.save();
        if (b.type === 'stadium') {   // the bowl ellipse covers the turf: keep the shader off the field quad
          g.beginPath(); g.rect(0, 0, vw, vh);
          const Q = G.q, pts = [[Q.x0, Q.y0], [Q.x1, Q.y0], [Q.x1, Q.y1], [Q.x0, Q.y1]];
          for (let k = 0; k < 4; k++) { fbScreen(G, pts[k][0], pts[k][1], 0); if (k === 0) g.moveTo(fbScr.x, fbScr.y); else g.lineTo(fbScr.x, fbScr.y); }
          g.closePath(); g.clip('evenodd');
        }
        try { M.crowd(g, rect, fill, frameNo, rain); } catch (err) { rerr('fb:crowd', err); }
        g.restore(); g.globalAlpha = 1;
      }
    }
    FB.crowdFrame = frameNo; M.fbCrowdFrame = frameNo;
    // 2. fans on the treads (1× cells: half size at 1×, full at 2×; none at 0.5×)
    if (z < 1 || typeof sp.fbFrame !== 'function') return;
    const zs = z * FB_SCALE, step = 0.22;
    const sweep = frameNo - FB.waveAt < 150 ? (frameNo - FB.waveAt) / 150 : -1;
    const cheer = frameNo - FB.scoreAt < 90, up = FB.crowdUp > 0, opp = e.d | 0;
    let seat = 0;
    const row = function (rowIdx, X0, Y0, X1, Y1, lift, dir, t0, t1) {
      const len = Math.max(0.01, Math.abs(X1 - X0) + Math.abs(Y1 - Y0)), cnt = Math.max(1, Math.floor(len / step));
      for (let k = 0; k < cnt; k++) {
        seat++;
        const h = hash(seat, rowIdx + 11);
        if ((h % 100) >= fill * 100) continue;
        const f = (k + 0.5) / cnt, t = t0 + (t1 - t0) * f;
        const look = ((seat >> 3) % 7 === 3) ? opp : 0;
        let pose = 'seated', fr = 0;
        if (sweep >= 0 && Math.abs(t - sweep) < 0.1) { pose = 'wave'; fr = ((frameNo >> 2) + k) & 1; }
        else if (cheer) { pose = 'wave'; fr = ((frameNo >> 3) + k) & 1; }
        else if (up && ((h >> 7) & 3) !== 0) { pose = 'standing'; fr = ((frameNo >> 3) + k) & 1; }
        const id = 'fbfan:' + pose, v = (look & 63) | (((h >> 2) % 6) << 6) | (((h >> 5) & 7) << 9) | (((h >> 9) & 1) << 12);
        const ref = sp.get(id, v, sp.fbFrame(id, dir, fr), 1); if (!ref || !ref.canvas) continue;
        fbScreen(G, X0 + (X1 - X0) * f, Y0 + (Y1 - Y0) * f, lift);
        g.drawImage(ref.canvas, ref.sx, ref.sy, ref.sw, ref.sh, Math.round(fbScr.x + ref.ox * zs), Math.round(fbScr.y + ref.oy * zs), ref.sw * zs, ref.sh * zs); drawCalls++; FB.fans++;
      }
    };
    const fw = G.q.fw, fh = G.q.fh;
    if (b.type === 'stadium') {
      const SR = fbStandRows(clamp(b.tier | 0, 1, 3));
      if (SR.upper) for (let r = SR.upper.length - 1; r >= 0; r--) { const w = SR.upper[r]; row(30 + r, 0.1, w[1], fw - 0.1, w[1], w[2], 1, 0, 0.6); row(40 + r, w[1], fh - 0.5, w[1], 0.5, w[2], 0, 0.75, 1); }
      for (let r = SR.far.length - 1; r >= 0; r--) { const w = SR.far[r]; row(r, SR.farX[0], w[1], fw - SR.farX[0], w[1], w[2], 1, 0, 0.6); }
      if (SR.end) for (let r = SR.end.length - 1; r >= 0; r--) { const w = SR.end[r]; row(10 + r, w[1], fh - 1, w[1], 1, w[2], 0, 0.75, 1); }
    } else row(0, fw / 2 - 0.72, 0.45, fw / 2 + 0.72, 0.45, 6, 1, 0, 1);
  }
  // -- players, ball, officials, sideline ------------------------------------------------------
  const FB_RUNNING = { carry: 1, block: 1, route: 1, cover: 1, rush: 1, pursue: 1, return: 1, dropback: 1 };
  function fbPlayers(G, state, lv, dr) {
    const sp = G.sp, P = lv ? lv.players : dr.players, n = Math.min(P.length, 22);
    const tick = fin(state.tick, 0);
    const a = lv ? lv.anim : null, t = fin(lv ? lv.frac : dr.frac, 0), ph = lv ? lv.phase : 'drill';
    const type = a ? String(a.type) : '', res = a ? String(a.res) : '', poss = lv ? (a ? a.poss : lv.possession) : 0, dir = poss === 0 ? 1 : -1;
    const liveNow = ph === 'live' || ph === 'snap' || ph === 'drill';
    const t0 = a ? a.t0 : -1;
    if (t0 !== FB.playT0) { FB.playT0 = t0; for (let i = 0; i < 22; i++) FB.face[i] = -1; }
    if (tick !== FB.tickSeen) {
      FB.tickSeen = tick; FB.px.set(FB.cx); FB.py.set(FB.cy); FB.bpx = FB.bcx; FB.bpy = FB.bcy;
      for (let i = 0; i < n; i++) { const p = P[i]; FB.cx[i] = fin(p.x, 50); FB.cy[i] = fin(p.y, 0); if (FB.team[i] !== (p.team | 0) || FB.n !== n) { FB.px[i] = FB.cx[i]; FB.py[i] = FB.cy[i]; } FB.team[i] = p.team | 0; }
      FB.n = n;
      const bl = lv ? lv.ball : dr.ball; FB.bcx = fin(bl && bl.x, 50); FB.bcy = fin(bl && bl.y, 0);
      if (!liveNow || Math.abs(FB.bcx - FB.bpx) > 15) { FB.bpx = FB.bcx; FB.bpy = FB.bcy; }
    }
    if (ph === 'huddle' || ph === 'decision') { if (FB.huddleAt < 0) FB.huddleAt = frameNo; } else FB.huddleAt = -1;
    const huddleAge = FB.huddleAt >= 0 ? frameNo - FB.huddleAt : 0;
    const homeLook = sp.fbLook('home'), awayLook = lv ? sp.fbLook(lv.opp) : homeLook;
    // who has the ball / who is the target / returner / the nearest defender to the carrier
    let carrier = -1, target = -1, qb = -1, returner = -1;
    for (let i = 0; i < n; i++) { const p = P[i]; if (p.state === 'carry' && carrier < 0) carrier = i; if ((p.team | 0) === poss) { if (p.role === 'QB' && qb < 0) qb = i; if (target < 0 && p.role === 'WR') target = i; } else if (p.state === 'return' && returner < 0) returner = i; }
    const isPass = type === 'pass' || type === 'int', isRun = type === 'run' || type === 'two' || type === 'kneel', isKick = type === 'punt' || type === 'fg' || type === 'xp';
    let holder = -1, flight = -1, loose = false;
    if (liveNow && a) {
      if (isRun) holder = t < 0.15 ? qb : (carrier >= 0 ? carrier : qb);
      else if (type === 'sack') holder = qb;
      else if (isPass) {
        if (t < 0.45) holder = qb; else if (t < 0.75) flight = (t - 0.45) / 0.3;
        else if (res === 'inc') loose = true;
        else if (type === 'int') { let best = -1, bd = 1e9; for (let i = 0; i < n; i++) { const p = P[i]; if ((p.team | 0) === poss) continue; const dx = FB.cx[i] - FB.bcx, dy = FB.cy[i] - FB.bcy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } holder = best; }
        else holder = carrier >= 0 ? carrier : target;
      }
      else if (isKick) { if (t >= 0.2 && t < 0.8) flight = (t - 0.2) / 0.6; else if (t >= 0.8) { if (type === 'punt') holder = returner; else loose = true; } }
      else if (type === 'kickoff') { if (t >= 0.1 && t < 0.7) flight = (t - 0.1) / 0.6; else if (t >= 0.7) holder = returner; }
    } else if (ph === 'drill') holder = -1;
    const endNow = lv && a && (liveNow ? t >= 0.9 : ((ph === 'huddle' || ph === 'decision') && huddleAge <= 30));
    const downed = !!endNow && (type === 'punt' ? res !== 'touchback' : (!isKick && !(res === 'td' || res === 'touchback' || res === 'inc' || res === 'safety')));
    const victim = endNow ? (type === 'sack' ? qb : holder) : -1;
    let tackler = -1;
    if (downed && victim >= 0) { let bd = 1e9; for (let i = 0; i < n; i++) { const p = P[i]; if ((p.team | 0) === (P[victim].team | 0)) continue; const dx = FB.cx[i] - FB.cx[victim], dy = FB.cy[i] - FB.cy[victim], d = dx * dx + dy * dy; if (d < bd) { bd = d; tackler = i; } } }
    const faceLos = function (own) { return sp.fbDir((own ? dir : -dir) * G.kx, 0); };
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < n; i++) {
      const p = P[i];
      if (ph === 'halftime') break;
      const x = FB.px[i] + (FB.cx[i] - FB.px[i]) * alphaNow, y = FB.py[i] + (FB.cy[i] - FB.py[i]) * alphaNow;
      const dx = FB.cx[i] - FB.px[i], dy = FB.cy[i] - FB.py[i], moving = dx * dx + dy * dy > 0.0025;
      if (moving) FB.face[i] = sp.fbDir(dx * G.kx, dy * G.ky);
      const own = (p.team | 0) === poss, st = String(p.state);
      let face = FB.face[i] >= 0 ? FB.face[i] : faceLos(own);
      let pose = 'stance', f = 0, carry = holder === i;
      if (ph === 'final') { const won = lv.score && lv.score[0] > lv.score[1]; pose = won === ((p.team | 0) === 0) ? 'celebrate' : 'huddle'; f = (frameNo >> 3) & 1; }
      else if (ph === 'pregame') pose = 'stance';
      else if (!liveNow && !endNow) { pose = 'huddle'; face = sp.fbDir((fin(lv.spot, 50) - x) * G.kx, (0 - y) * G.ky); }
      else {
        if (FB_RUNNING[st]) pose = (moving || liveNow && t < 0.9) ? 'run' : 'stance';
        if (st === 'handoff') { pose = t < 0.3 ? 'run' : 'stance'; if (t >= 0.3 && carrier >= 0) face = sp.fbDir((FB.cx[carrier] - x) * G.kx, (FB.cy[carrier] - y) * G.ky); }
        else if (st === 'dropback') { if (t >= 0.35) { pose = 'throw'; f = 0; face = faceLos(true); } }
        else if (st === 'throw') { if (t < 0.6) { pose = 'throw'; f = 1; } else pose = 'stance'; face = faceLos(true); }
        else if (st === 'sacked') { pose = t < 0.7 ? 'run' : 'tackled'; }
        else if (st === 'kick') { pose = 'throw'; f = t < 0.1 ? 0 : 1; face = faceLos(true); }
        else if (st === 'watch' || st === 'set') pose = 'stance';
        if (isPass && i === target && t >= 0.6 && t < 0.8) { pose = 'catch'; f = (t >= 0.72 && res !== 'inc' && type !== 'int') ? 1 : 0; face = faceLos(false); carry = false; }
        if (type === 'int' && i === holder && t < 0.85) { pose = 'catch'; f = 1; carry = false; }
        if (endNow) {
          if (res === 'td' || (type === 'fg' || type === 'xp') && res === 'good') { if (own) { pose = 'celebrate'; f = ((frameNo >> 3) + i) & 1; carry = false; } else pose = 'stance'; }
          else if (downed && i === victim) { pose = 'tackled'; f = 0; carry = false; }
          else if (downed && i === tackler) { pose = 'tackle'; f = liveNow && t < 0.95 ? 0 : 1; face = sp.fbDir((FB.cx[victim] - x) * G.kx, (FB.cy[victim] - y) * G.ky); }
          else if (!liveNow) { pose = 'huddle'; }
          else if (pose === 'run') pose = 'stance';
        }
      }
      if (pose === 'run') f = ((frameNo + i * 5) >> 2) % 6;
      const look = (p.team | 0) === 0 ? homeLook : awayLook;
      const variant = sp.fbVariant(look, p.pos, 0, carry ? 1 : 0);
      const id = 'fbplayer:' + pose;
      const e = fbPush(G, 'fbplayer', id, variant, sp.fbFrame(id, face, f), x, FB_YD_V / 2 + y, 0, drawFbSprite);
      e.a = i; FB.players++;
      const X = G.q.x0 + (x + 10) * G.kx, Y = G.q.y0 + (FB_YD_V / 2 + y) * G.ky;
      if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
    }
    if (FB.players) { FB.minX = minX; FB.maxX = maxX; FB.minY = minY; FB.maxY = maxY; }
    // the ball: on the ground at the spot, in the carrier's arm (baked), or in flight on a parabola
    if (holder < 0 && ph !== 'halftime' && ph !== 'final' && typeof sp.fbFrame === 'function') {
      let bx, by, bz = 0, spin = 1, axis = 0;
      if (liveNow || ph === 'drill') { bx = FB.bpx + (FB.bcx - FB.bpx) * alphaNow; by = FB.bpy + (FB.bcy - FB.bpy) * alphaNow; }
      else { bx = fin(lv.spot, 50); by = 0; }
      if (flight >= 0) {
        const H = type === 'kickoff' ? 60 : type === 'punt' ? 52 : isKick ? 34 : clamp(10 + Math.abs(fin(a.yds, 0)) * 0.9, 10, 40);
        bz = 4 * H * flight * (1 - flight) + (isKick && type !== 'punt' ? 14 * flight : 0);
        spin = (frameNo >> 1) & 3; axis = dir > 0 ? 7 : 1;
      } else if (loose) spin = 2;
      const e = fbPush(G, 'fbball', 'fbball', axis, spin, bx, FB_YD_V / 2 + by, bz, drawFbBall); e.a = bz;
    }
    if (!lv) return;
    // the referee trails the ball; signals a score
    const losU = a ? fin(a.los, lv.spot) : fin(lv.spot, 50);
    const refTarget = clamp((liveNow ? FB.bcx : losU) - dir * 7, -8, 108);
    FB.refU += (refTarget - FB.refU) * 0.12; FB.refV = FB_YD_V / 2 - 10;
    if (ph !== 'halftime') {
      const sig = frameNo - FB.sigAt < 60;
      const rf = sp.fbDir((FB.bcx - FB.refU) * G.kx, (FB.bcy + FB_YD_V / 2 - FB.refV) * G.ky);
      fbPush(G, 'fbref', 'fbref', 2, sp.fbFrame('fbref', rf, sig ? 1 : 0), FB.refU, FB.refV, 0, drawFbSprite);
    }
    // the chain crew and the down marker on the home sideline (slide to the spot and the line to gain)
    const scrim = ph !== 'halftime' && ph !== 'final' && (a ? (type !== 'kickoff' && type !== 'xp' && type !== 'two') : true);
    if (scrim) {
      const gain = losU + dir * clamp(fin(lv.distance, 10), 0, 99);
      FB.crewU += (losU - FB.crewU) * 0.1; FB.gainU += (gain - FB.gainU) * 0.1;
      if (Math.abs(losU - FB.crewU) > 40) FB.crewU = losU; if (Math.abs(gain - FB.gainU) > 40) FB.gainU = gain;
      fbPush(G, 'fbcrew', 'fbdown', clamp(fin(lv.down, 1) | 0, 1, 4), 0, FB.crewU, 0.7, 0, drawFbSprite);
      fbPush(G, 'fbcrew', 'fbcrew', 3, sp.fbFrame('fbcrew', 1, 0), FB.crewU - 1.1, 0.9, 0, drawFbSprite);
      if (FB.gainU >= 0 && FB.gainU <= 100) {
        fbPush(G, 'fbcrew', 'fbstick', 0, 0, FB.gainU, 0.7, 0, drawFbSprite);
        fbPush(G, 'fbcrew', 'fbcrew', 12, sp.fbFrame('fbcrew', 1, 0), FB.gainU + 1.1, 0.9, 0, drawFbSprite);
      }
      const le = fbPush(G, 'fbline', null, 0, 0, losU, 0, 0, drawFbLines); le.b = G; le.a = losU; le.c = gain; le.d = (gain >= 0 && gain <= 100 && fin(lv.distance, 10) < 99) ? 1 : 0;
      le.key = sortKey(G.ax, G.ay, G.el, 0.5); keys[count - 1] = le.key;   // on the turf, under everyone
    }
    // cheerleaders (routine; jump on a home score), staff with headsets, Roux at the bench, the band at halftime
    const scored = frameNo - FB.scoreAt < 90, keyed = frameNo - FB.keyAt < 40;
    for (let k = 0; k < 6; k++) {
      const f = scored ? (((frameNo >> 3) + k) & 1 ? 3 : 0) : (ph === 'halftime' ? (((frameNo >> 3) + k) & 3) : (((frameNo >> 5) + k) & 3));
      fbPush(G, 'fbcheer', 'fbcheer', (k % 6) | (((k + 1) & 7) << 3), sp.fbFrame('fbcheer', 1, f), 22 + 5 * k, 1.4, 0, drawFbSprite);
    }
    for (let k = 0; k < 3; k++) fbPush(G, 'fbstaff', 'fbstaff', k | ((k + 2) % 6) << 2 | ((k * 3) & 7) << 5, sp.fbFrame('fbstaff', 2, keyed || scored ? ((frameNo >> 3) + k) & 1 : 0), 58 + 3 * k, 1.6, 0, drawFbSprite);
    const rouxF = scored ? 2 : ((frameNo % 240) < 50 ? 1 : 0);
    fbPush(G, 'fbroux', 'fbroux', 0, sp.fbFrame('fbroux', 2, rouxF), 70, 1.7, 0, drawFbSprite);
    if (ph === 'halftime') {
      for (let k = 0; k < 24; k++) {
        const th = Math.PI * 2 * k / 24 + frameNo * 0.012;
        const u = 50 + 22 * Math.sin(th), v = FB_YD_V / 2 + 13 * Math.sin(3 * th);
        const bd = sp.fbDir(22 * Math.cos(th) * G.kx, 39 * Math.cos(3 * th) * G.ky);
        fbPush(G, 'fbband', 'fbband', (k % 3) | (((k * 5) % 6) << 2) | ((k & 7) << 5), sp.fbFrame('fbband', bd, ((frameNo >> 3) + k) & 1), u, v, 0, drawFbSprite);
      }
    }
  }
  /** one (look, role) sheet pair per frame after kickoff so the first plays do not hitch */
  function fbWarmStep(G, lv) {
    const sp = G.sp; if (typeof sp.fbWarm !== 'function') return;
    const z = 1;   // field entities use the 1x atlas at every zoom
    if (FB.warmZoom !== z) { FB.warmZoom = z; FB.warm = 0; }
    if (FB.warm >= 10) return;
    const k = FB.warm++, look = k < 5 ? 'home' : lv.opp, role = k % 5;
    try { sp.fbWarm(look, z, role); } catch (e) { FB.warm = 10; }
  }
  function footballPass(state) {
    FB.drawn = 0; FB.players = 0; FB.fans = 0;
    if (FB.crowdUp > 0) FB.crowdUp--;
    const lv = FB.live, dr = FB.drill, b = FB.venue;
    if ((!lv && !dr) || !b) return;
    const q = M.fieldQuad(b); if (!q) return;
    const G = fbGeom(state, b, q);
    if (!inView(G.ax, G.ay, 8) || !G.sp || typeof G.sp.fbVariant !== 'function') return;
    if (lv) {
      if (FB.game !== state.sports.game) { FB.game = state.sports.game; FB.warm = 0; FB.crewU = fin(lv.spot, 50); FB.gainU = FB.crewU + 10; FB.refU = FB.crewU; }
      fbWarmStep(G, lv);
      if (lv.home) {
        const seats = Math.max(1, fin(mod('sports') && mod('sports').venueSeats ? mod('sports').venueSeats(state) : 0, 0) || 15000);
        const e = push('fbcrowd', G.ax, G.ay, G.el, 0.4, drawFbCrowd); tileScreen(e);
        e.b = G; e.a = clamp(fin(state.sports.game && state.sports.game.attendance, 0) / seats, 0, 1); e.c = fin(state.weather && state.weather.rainRate, 0) > 0.05 ? 1 : 0; e.d = G.sp.fbLook(lv.opp) | 0;
        FB.drawn++;
      }
    }
    fbPlayers(G, state, lv, dr);
  }
  function entityPass(state, g) {
    count = 0; agentsDrawn = 0; particlesDrawn = 0; teeBakes = 0;
    const sp = S(), t = state.tiles, elev = t.elev;
    const bl = mod('buildings'), wl = mod('wildlife'), cat = (BSU.data && BSU.data.catalog) || {};
    // buildings
    const B = state.buildings;
    if (Array.isArray(B)) {
      for (let k = 0; k < B.length; k++) {
        const b = B[k]; if (!b) continue;
        const ax = (b.tx | 0) + (b.w | 0) - 1, ay = (b.ty | 0) + (b.h | 0) - 1;
        if (ax < 0 || ay < 0 || ax >= W || ay >= HGT) continue;
        if (!inView(ax, ay, 6)) continue;
        let eff = 1; try { if (bl && typeof bl.effective === 'function') eff = fin(bl.effective(state, b.id), 1); } catch (err) { eff = 1; }
        const row = cat[b.type];
        const ci = { phase: info.phase, day: info.day, effective: eff, wind: info.wind, barrierClosed: info.barrierClosed, toppleIds: info.toppleIds, frontLeft: !!(row && row.pathAdjacency) && frontLeftOf(t, b) };
        const v = M.variantOf(b, ci), fr = M.frameOf(b, v, ci);
        const e = push('building', ax, ay, fin(elev[ay * W + ax], 0), 0, drawBuilding);
        e.b = b; e.id = b.rot ? b.type + ':r' : b.type; e.variant = v; e.frame = fr;
        let tr = null;
        if (M.teesEnabled !== false && row && row.pathAdjacency && !(v & (SPR.SCAFFOLD | SPR.RUIN))) { try { tr = teeRef(state, b, row, e.id, v, fr); } catch (err) { rerr('tee:ref', err); tr = null; } }
        e.ref = tr || getRef(e.id, v, fr);
        let icons = 0;
        if (fin(b.built, 1) >= 1 && !b.ruin && row) { if (row.needsPower && b.powered === false) icons |= 1; if (row.needsWater && b.watered === false) icons |= 2; if (b.noAccess === true) icons |= 4; }
        e.c = icons;
        tileScreen(e);
        if (b.data && Number.isFinite(b.data.dumpsterTile) && b.data.dumpsterTile >= 0 && b.data.dumpsterTile < N) {
          const di = b.data.dumpsterTile | 0, dx = di & 63, dy = di >> 6;
          if (inView(dx, dy, 1)) { const d = push('decal', dx, dy, fin(elev[di], 0), 2, drawSprite); d.ref = getRef('decal:dumpster', 0, 0); d.id = 'decal:dumpster'; tileScreen(d); }
        }
      }
    }
    // trees
    const veg = state.veg;
    if (Array.isArray(veg)) {
      for (let k = 0; k < veg.length; k++) {
        const v = veg[k]; if (!v || !v.type) continue;
        const tx = v.tx | 0, ty = v.ty | 0;
        if (!BSU.inBounds(tx, ty) || !inView(tx, ty, 4)) continue;
        const stage = clamp(fin(v.stage, 0) | 0, 0, 2);
        const variant = sp.treeVariant(stage, info.autumn && v.type === 'cypress', info.bloom && v.type === 'azalea');
        const e = push('tree', tx, ty, fin(elev[ty * W + tx], 0), 1, drawTree);
        e.id = v.type; e.variant = stage; e.a = hash(tx, ty); e.ref = getRef(v.type, variant, 0);
        tileScreen(e);
      }
    }
    // agents (interpolated; GONE / inside / aboard skipped)
    const A = state.agents;
    if (Array.isArray(A)) {
      const f = zoomNow < 1 ? ((Math.floor(frameNo / C.agentAnimDiv)) & 2) : Math.floor(frameNo / C.agentAnimDiv);
      for (let k = 0; k < A.length; k++) {
        const a = A[k]; if (!a || a.state === 'GONE' || a.inside || a.aboard) continue;
        const anim = typeof a.anim === 'string' ? a.anim : 'idle';
        const id = typeof sp.agentId === 'function' ? sp.agentId(anim) : 'agent';
        const fr = typeof sp.agentFrame === 'function' ? sp.agentFrame(anim, a.dir | 0, f) : ((a.dir | 0) * 4 + (f & 3));
        const e = pushMover('agent', a, id, fin(a.look, 0) | 0, fr, groundElev, state);
        if (e) { e.c = a.state === 'FLEE' ? 1 : 0; e.b = a; agentsDrawn++; }
      }
    }
    // gators (+ Le Grand)
    const G = state.gators;
    if (Array.isArray(G)) {
      for (let k = 0; k < G.length; k++) {
        const ga = G[k]; if (!ga) continue;
        const variant = ga.size === 'legend' || ga.legend ? 2 : (ga.size === 'big' ? 1 : 0);
        const fr = typeof sp.gatorFrame === 'function' ? sp.gatorFrame(ga.state, frameNo >> 3) : 0;
        const e = pushMover('gator', ga, 'gator', variant, fr, surfaceAtTile, state); if (e) e.b = ga;
      }
    }
    const lg = state.wildlife && state.wildlife.leGrand;
    if (lg && Number.isFinite(lg.tx) && Number.isFinite(lg.ty) && !(Array.isArray(G) && G.indexOf(lg) >= 0)) { const e = pushMover('gator', lg, 'gator', 2, typeof sp.gatorFrame === 'function' ? sp.gatorFrame(lg.state || 'SUN', frameNo >> 3) : 0, surfaceAtTile, state); if (e) e.b = lg; }
    // officers
    const O = state.wildlife && state.wildlife.officers;
    if (Array.isArray(O)) {
      for (let k = 0; k < O.length; k++) {
        const o = O[k]; if (!o) continue;
        const wr = o.state === 'WRANGLE';
        pushMover('officer', o, wr ? 'officer:wrangle' : 'officer', 0, wr ? ((frameNo >> 3) & 1) : ((o.dir | 0) * 4 + ((frameNo >> 3) & 3)), groundElev, state);
      }
    }
    // vehicles
    const V = state.vehicles;
    if (Array.isArray(V)) {
      for (let k = 0; k < V.length; k++) {
        const v = V[k]; if (!v) continue;
        const id = VEH_ID[v.kind] || 'pirogue';
        const fr = id === 'officer' ? ((v.dir | 0) * 4 + ((frameNo >> 3) & 3)) : ((frameNo >> 3) & 1);
        pushMover('vehicle', v, id, 0, fr, WATER_VEH[v.kind] ? surfaceAtTile : groundElev, state);
      }
    }
    // Roux, critters, egrets
    try {
      if (wl && typeof wl.roux === 'function') { const r = wl.roux(state); if (r && Number.isFinite(r.tx)) pushMover('roux', r, 'roux', 0, r.state === 'YAWN' ? 2 : ((frameNo >> 3) & 1), groundElev, state); }
      if (wl && typeof wl.critters === 'function') {
        const cr = wl.critters(state);
        for (let k = 0; k < cr.length; k++) { const c = cr[k]; if (!c || !c.kind) continue; const e = pushMover('critter', c, c.kind, 0, fin(c.frame, 0) & 1, c.kind === 'pelican' ? surfaceAtTile : groundElev, state); if (e && c.kind === 'spoonbill') { e.elev += 4; e.key = sortKey(e.ax, e.ay, e.elev, 2); keys[count - 1] = e.key; moverScreen(e); } }
      }
      if (wl && typeof wl.birds === 'function') {
        const bd = wl.birds(state), n = Math.min(24, bd ? (bd.egrets | 0) : 0);
        if (n > 0) {
          if (!birdTiles || frameNo - birdTilesFrame > 120) {
            birdTiles = []; birdTilesFrame = frameNo;
            for (let i = 0; i < N; i++) if (t.type[i] === T.POND || (t.flags[i] & FLAG.PRESERVE)) birdTiles.push(i);
          }
          for (let k = 0; k < n && birdTiles.length; k++) {
            const i = birdTiles[hash(k, 977) % birdTiles.length], tx = i & 63, ty = i >> 6;
            if (!inView(tx, ty, 1)) continue;
            const e = push('bird', tx + (hash(k, 5) % 60) / 100 - 0.3, ty + (hash(k, 9) % 60) / 100 - 0.3, fin(elev[i], 0), 2, drawSprite);
            e.ref = getRef('egret', 0, ((frameNo >> 5) + k) & 1); e.id = 'egret'; tileScreen(e);
          }
        }
      }
    } catch (err) { rerr('entities:wildlife', err); }
    // progress-driven set dressing (parade, bonfires) and game-day tailgate
    try {
      const pg = mod('progress');
      if (pg && typeof pg.parade === 'function') {
        const pd = pg.parade(state);
        if (pd) {
          const groups = [['floats', 'float'], ['band', 'band'], ['krewe', 'krewe']];
          for (let gi = 0; gi < groups.length; gi++) {
            const arr = pd[groups[gi][0]]; if (!Array.isArray(arr)) continue;
            for (let k = 0; k < arr.length; k++) { const p = arr[k]; if (!p || !Number.isFinite(p.tx)) continue; pushMover('parade', p, groups[gi][1], (gi ? (k * 37) : 0) & 255, (frameNo >> 3) & 3, groundElev, state); }
          }
        }
      }
      if (pg && typeof pg.bonfires === 'function') {
        const bf = pg.bonfires(state);
        if (Array.isArray(bf)) for (let k = 0; k < bf.length; k++) { const i = bf[k] | 0; if (i < 0 || i >= N) continue; const tx = i & 63, ty = i >> 6; if (!inView(tx, ty, 1)) continue; const e = push('bonfire', tx, ty, fin(elev[i], 0), 2, drawSprite); e.ref = getRef('bonfire', 0, (frameNo >> 2) % 3); e.id = 'bonfire'; tileScreen(e); }
      }
      const game = state.sports && state.sports.game;
      if (game && bl && typeof bl.list === 'function') {
        const venue = bl.list(state, state.sports.venue || 'stadium')[0] || bl.list(state, 'practice_field')[0];
        if (venue) {
          const edge = BSU.edgeTiles(venue.tx, venue.ty, venue.w, venue.h);
          const kinds = ['tent', 'tent', 'smoker', 'tent', 'cornhole', 'tent', 'tent', 'smoker', 'tent'];
          for (let k = 0; k < kinds.length && edge.length; k++) {
            const i = edge[hash(k, venue.id + 1) % edge.length], tx = i & 63, ty = i >> 6;
            if (!inView(tx, ty, 1)) continue;
            const e = push('tailgate', tx, ty, fin(elev[i], 0), 2, drawSprite); e.ref = getRef(kinds[k], k & 3, (frameNo >> 3) & 1); e.id = kinds[k]; tileScreen(e);
          }
        }
      }
      const wx = mod('weather');
      if (wx && typeof wx.heat === 'function' && bl && typeof bl.list === 'function') {
        const h = wx.heat(state);
        if (h && h.wave) { const u = bl.list(state, 'union')[0]; if (u) { const tx = u.tx + u.w, ty = u.ty + u.h - 1; if (BSU.inBounds(tx, ty) && inView(tx, ty, 1)) { const e = push('snoball', tx, ty, fin(elev[ty * W + tx], 0), 2, drawSprite); e.ref = getRef('snoball', 0, (frameNo >> 4) & 1); e.id = 'snoball'; tileScreen(e); } } }
      }
    } catch (err) { rerr('entities:dressing', err); }
    // football pass F: players, ball, officials, sideline, stands (sorted right after the venue sprite)
    try { footballPass(state); } catch (err) { rerr('entities:football', err); }
    // in-world particles (D50): the only hook through which render_fx's pool reaches the sorted pass
    try { if (M.particles && typeof M.particles.forEachWorld === 'function') M.particles.forEachWorld(particleCb); } catch (err) { rerr('entities:particles', err); }
    // design pass: ground shadows under everything, then sort + draw
    try { shadowPass(g); } catch (err) { rerr('entities:shadows', err); g.globalAlpha = 1; }
    sortList();
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    for (let k = 0; k < count; k++) { const e = list[k]; try { e.draw(e, g, view, alphaNow); } catch (err) { rerr('entities:draw:' + e.kind, err); } }
  }

  // ---------------------------------------------------------------------------
  // Built-in passes (replaced by render_fx.js registering the same names)
  // ---------------------------------------------------------------------------
  const TINT_BY_PHASE = ['dawn', null, 'golden', 'dusk', 'night'];
  function builtinTint(state, g) {
    const ph = info.phase, t = clamp(fin(state.sky && state.sky.t, 0), 0, 1);
    const cur = PR.tint[TINT_BY_PHASE[ph] || 'x'], nxt = PR.tint[TINT_BY_PHASE[(ph + 1) % 5] || 'x'];
    const storm = state.storms && state.storms.current && state.storms.current.phase >= 3;
    const fogA = clamp(fin(state.weather && state.weather.fog, 0), 0, 1);
    g.globalCompositeOperation = 'multiply';
    const blend = (tint, a) => { if (!tint || a <= 0.005) return; g.globalAlpha = a; g.fillStyle = tint.color; g.fillRect(0, 0, vw, vh); drawCalls++; };
    const k = t < 0.8 ? 0 : (t - 0.8) / 0.2;                 // cross-fade toward the next phase's tint in the last 20 %
    blend(cur, cur ? cur.alpha * (1 - k) : 0);
    blend(nxt, nxt ? nxt.alpha * k : 0);
    if (storm) blend(PR.tint.storm, PR.tint.storm.alpha * 0.6);
    g.globalCompositeOperation = 'source-over';
    if (fogA > 0) blend(PR.tint.fog, PR.tint.fog.alpha * fogA);
    g.globalAlpha = 1;
  }
  const OV_COLORS = { flood: PAL.danger || '#E0443E', water: PAL.waterBlue || '#4FA3D6', mosq: '#9BD44A', power: GOLD, bad: PAL.danger || '#E0443E', good: PAL.good || '#3FBF7F', eco: PAL.highGround || '#7FA347', subs: '#B5533C' };
  function tileDiamondScreen(i, out) { const tx = i & 63, ty = i >> 6; const w = BSU.worldToScreen(tx, ty, elevAt(tx, ty), camera, vw, vh); out.x = w.x; out.y = w.y; return out; }
  const tmpPt = { x: 0, y: 0 };
  function builtinOverlays(state, g) {
    const ov = state.ui ? state.ui.overlay | 0 : 0, t = state.tiles;
    const z = zoomNow, w = TW * z, h = TH * z, step = z === 1 ? 1 : 2;
    const fade = clamp((nowMs() - overlayFadeStart) / (PR.overlayFadeMs || 150), 0, 1) || (BSU.headlessMode ? 1 : 0);
    if (ov !== OV.NONE) {
      let risk = null, auras = null;
      try { if (ov === OV.FLOOD) { const hy = mod('hydro'); risk = hy && typeof hy.predictRisk === 'function' ? hy.predictRisk(state) : null; } } catch (e) { risk = null; }
      try { if (ov === OV.COVERAGE) { const bl = mod('buildings'); auras = bl && typeof bl.auras === 'function' ? bl.auras(state) : null; } } catch (e) { auras = null; }
      for (let ty = view.y0; ty <= view.y1; ty++) for (let tx = view.x0; tx <= view.x1; tx++) {
        const i = ty * W + tx; let col = null, a = 0;
        if (ov === OV.FLOOD) { const r = risk ? fin(risk[i], 0) : 0; if (r >= 0.05) { col = OV_COLORS.flood; a = 0.15 + 0.35 * clamp(r / 3, 0, 1); } }
        else if (ov === OV.WATER) { const d = fin(t.depth[i], 0); if (d >= 0.05 && t.type[i] > T.BAYOU) { col = OV_COLORS.water; a = 0.15 + 0.4 * clamp(d / 2, 0, 1); } }
        else if (ov === OV.MOSQUITO) { const m = fin(t.mosq[i], 0); if (m >= 0.1) { col = OV_COLORS.mosq; a = m < 0.3 ? 0.15 : m < 0.5 ? 0.25 : m < 0.7 ? 0.35 : 0.5; } }
        else if (ov === OV.POWER) { const o = t.owner[i]; const b = o >= 0 && state.buildings ? state.buildings[o] : null; if (b) { const ok = b.powered !== false && b.watered !== false; col = ok ? OV_COLORS.good : OV_COLORS.bad; a = 0.4; } }
        else if (ov === OV.COVERAGE) { const d = auras && auras.dining ? fin(auras.dining[i], 0) : 0; if (d > 0) { col = OV_COLORS.power; a = 0.3; } }
        else if (ov === OV.ECOLOGY) { if (t.flags[i] & FLAG.WETLAND_ORIGINAL) { col = OV_COLORS.eco; a = 0.2; } const s = fin(t.subs[i], 0); if (s > 0.2) { col = OV_COLORS.subs; a = 0.2 + 0.3 * clamp(s / 2, 0, 1); } }
        if (!col) continue;
        tileDiamondScreen(i, tmpPt);
        g.globalAlpha = a * fade; g.fillStyle = col; fillDiamond(g, tmpPt.x, tmpPt.y, w, h, step);
      }
    }
    // ghost preview
    const gs = ghostSpec;
    if (gs) {
      if (Array.isArray(gs.tiles)) { g.globalAlpha = C.ghostAlpha; g.fillStyle = gs.color || GOLD; for (let k = 0; k < gs.tiles.length; k++) { const i = gs.tiles[k] | 0; if (i < 0 || i >= N) continue; tileDiamondScreen(i, tmpPt); fillDiamond(g, tmpPt.x, tmpPt.y, w, h, step); } }
      // connector pass: the gravel tie a footprint placement would lay, in the path drag's own ghost style
      if (Array.isArray(gs.connectorTiles)) { g.globalAlpha = C.ghostAlpha; g.fillStyle = gs.color || GOLD; for (let k = 0; k < gs.connectorTiles.length; k++) { const i = gs.connectorTiles[k] | 0; if (i < 0 || i >= N) continue; tileDiamondScreen(i, tmpPt); fillDiamond(g, tmpPt.x, tmpPt.y, w, h, step); } }
      const ring = gs.ringTiles;
      if (ring) {
        const reached = Array.isArray(ring) ? ring : (ring.reached || []), unreached = Array.isArray(ring) ? [] : (ring.unreached || []);
        g.globalAlpha = 0.25; g.fillStyle = OV_COLORS.bad; for (let k = 0; k < reached.length; k++) { tileDiamondScreen(reached[k] | 0, tmpPt); fillDiamond(g, tmpPt.x, tmpPt.y, w, h, step); }
        g.globalAlpha = 0.15; g.fillStyle = OV_COLORS.good; for (let k = 0; k < unreached.length; k++) { tileDiamondScreen(unreached[k] | 0, tmpPt); fillDiamond(g, tmpPt.x, tmpPt.y, w, h, step); }
      }
      if (Number.isFinite(gs.radius) && gs.radius > 0 && Number.isFinite(gs.radiusCenter)) {
        const c = gs.radiusCenter | 0, cx = c & 63, cy = c >> 6, r = gs.radius | 0;
        const x0 = clamp(cx - r, 0, W - 1), y0 = clamp(cy - r, 0, HGT - 1), x1 = clamp(cx + r, 0, W - 1), y1 = clamp(cy + r, 0, HGT - 1);
        const p0 = M.tileToScreen(x0, y0), p1 = M.tileToScreen(x1, y0), p2 = M.tileToScreen(x1, y1), p3 = M.tileToScreen(x0, y1);
        g.globalAlpha = 0.8; g.strokeStyle = gs.color || GOLD; g.lineWidth = 1; g.beginPath();
        g.moveTo(p0.x, p0.y - h / 2); g.lineTo(p1.x + w / 2, p1.y); g.lineTo(p2.x, p2.y + h / 2); g.lineTo(p3.x - w / 2, p3.y); g.closePath(); g.stroke(); drawCalls++;
      }
      if (gs.sprite && gs.sprite.id && Number.isFinite(gs.sprite.tx)) {
        const grow = (BSU.data && BSU.data.catalog) ? BSU.data.catalog[gs.sprite.id] : null;
        const grot = !!gs.sprite.rot && !!(grow && grow.rotatable);
        const ref = getRef(grot ? gs.sprite.id + ':r' : gs.sprite.id, fin(gs.sprite.variant, 0), 0);
        if (ref) {
          // building sprites are anchored on their SE tile (anchorOf); the ghost spec carries the NW tile
          let aw = 1, ah = 1; if (grow && grow.kind === 'footprint') { aw = Math.max(1, grow.w | 0); ah = Math.max(1, grow.h | 0); if (grot) { const tmp = aw; aw = ah; ah = tmp; } }
          const p = M.tileToScreen((gs.sprite.tx | 0) + aw - 1, (gs.sprite.ty | 0) + ah - 1); g.globalAlpha = C.ghostSpriteAlpha; blit(g, ref, p.x, p.y, zsOf(ref));
        }
      }
    }
    // Show-me flashes
    if (flashes.length) {
      const now = nowMs();
      for (let f = flashes.length - 1; f >= 0; f--) if (flashes[f].until <= now) flashes.splice(f, 1);
      g.globalAlpha = 0.5 + 0.3 * Math.sin(frameNo / 6); g.fillStyle = GOLD;
      for (let f = 0; f < flashes.length; f++) { const tl = flashes[f].tiles; for (let k = 0; k < tl.length; k++) { const i = tl[k] | 0; if (i < 0 || i >= N) continue; tileDiamondScreen(i, tmpPt); fillDiamond(g, tmpPt.x, tmpPt.y, w, h, step); } }
    }
    // cursor tile pulse
    const hv = M.hoverTile | 0;
    if (hv >= 0 && hv < N) { tileDiamondScreen(hv, tmpPt); g.globalAlpha = 0.6 + 0.3 * Math.sin(frameNo / 5); g.strokeStyle = GOLD_HI; g.lineWidth = 1; g.beginPath(); diamondPath(g, tmpPt.x, tmpPt.y, w - 2, h - 1); g.stroke(); drawCalls++; }
    g.globalAlpha = 1;
  }
  function builtinHud(state) { if (minimapEl && (frameNo % 6) === 0) M.minimap(state); }
  M.registerPass('tint', builtinTint, 6, true);
  M.registerPass('overlays', builtinOverlays, 9, true);
  M.registerPass('hud', builtinHud, 10, true);

  // ---------------------------------------------------------------------------
  // Minimap (fallback; render_fx may replace M.minimap)
  // ---------------------------------------------------------------------------
  const MM_TYPE = [WATER_DEEP, PAL.waterDay || '#2E6B5E', PAL.reed || '#8A9A4B', PAL.wetGround || '#5A6B3A', PAL.dryGrass || '#6E8F3C', PAL.highGround || '#7FA347', PAL.mud || '#4A3B2A', PAL.waterBlue || '#4FA3D6'];
  /** draws the attached #minimap canvas: terrain by type/depth, buildings gold, the camera rect */
  M.minimap = function (state) {
    const el = minimapEl; if (!el || !state || !state.tiles) return;
    try {
      const g = ctx2d(el); const mw = el.width || 160, mh = el.height || 160;
      if (!mmBase) { mmBase = makeCanvas(W, HGT); }
      const bg = ctx2d(mmBase);
      if (!mmImg) { try { mmImg = bg.createImageData(W, HGT); } catch (e) { mmImg = null; } }
      const sp = S(), t = state.tiles;
      if (mmImg && mmImg.data) {
        const px = mmImg.data;
        for (let i = 0; i < N; i++) {
          let col = MM_TYPE[t.type[i]] || MM_TYPE[0];
          const d = fin(t.depth[i], 0);
          if (t.type[i] > T.BAYOU && d >= 0.3) col = sp.mix(col, WATER_SHALLOW, clamp(d / 2, 0, 1));
          if (t.owner[i] >= 0) col = GOLD;
          else if (t.surface[i] > 0) col = PAL.gravel || '#C9B47C';
          else if (t.crest[i] > 0) col = PAL.creamStone || '#F5ECD7';
          const c = sp.hex(col); px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
        }
        bg.putImageData(mmImg, 0, 0);
      }
      const s = mw / (W * 2);                                         // 64 tiles → the diamond width
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = BG; g.fillRect(0, 0, mw, mh);
      g.imageSmoothingEnabled = false;
      g.setTransform(s, s / 2, -s, s / 2, mw / 2, mh / 2 - (HGT * s) / 2);
      g.drawImage(mmBase, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (camera) {                                                     // camera rect: the 4 screen corners → tile coords → minimap px
        g.strokeStyle = GOLD_HI; g.lineWidth = 1; g.beginPath();
        for (let c = 0; c < 4; c++) {
          const pxs = (c === 1 || c === 2) ? vw : 0, pys = c >= 2 ? vh : 0;
          const wx = (pxs - vw / 2) / zoomNow + camera.x, wy = (pys - vh / 2) / zoomNow + camera.y;
          const tx = (wx / 32 + wy / 16) / 2, ty = (wy / 16 - wx / 32) / 2;
          const mx = mw / 2 + (tx - ty) * s, my = mh / 2 - (HGT * s) / 2 + (tx + ty) * s / 2;
          if (c === 0) g.moveTo(mx, my); else g.lineTo(mx, my);
        }
        g.closePath(); g.stroke();
      }
      if (state.storms && state.storms.current && state.storms.current.phase >= 1 && state.storms.current.phase < 4) {   // the cone, roughly: a gold mark at the forecast landfall side
        g.fillStyle = PAL.danger || '#E0443E'; g.globalAlpha = 0.6 + 0.3 * Math.sin(frameNo / 8); g.fillRect(mw / 2 - 2, mh - 6, 4, 4); g.globalAlpha = 1;
      }
    } catch (e) { rerr('minimap', e); }
  };

  // ---------------------------------------------------------------------------
  // Postcard (fallback; render_fx may replace) and renderInto
  // ---------------------------------------------------------------------------
  /** passes 2–9 into another context of w×h CSS px with the live camera at zoom 1 (postcard) */
  M.renderInto = function (g, w, h, state, camOverride) {
    state = state || root; if (!state || !g) return;
    const saveCtx = ctx, saveVw = vw, saveVh = vh, saveCam = camera, saveZoom = zoomNow;
    const sv = { x0: view.x0, y0: view.y0, x1: view.x1, y1: view.y1, vw: view.vw, vh: view.vh };
    try {
      ctx = g; vw = w; vh = h; view.vw = w; view.vh = h;
      camera = camOverride || saveCam; zoomNow = camera.zoom;
      visibleRect(camera, vw, vh, view);
      g.fillStyle = BG; g.fillRect(0, 0, w, h);
      runWorld(state, g, alphaNow, 16.67, false);
    } finally {
      ctx = saveCtx; vw = saveVw; vh = saveVh; camera = saveCam; zoomNow = saveZoom;
      view.x0 = sv.x0; view.y0 = sv.y0; view.x1 = sv.x1; view.y1 = sv.y1; view.vw = sv.vw; view.vh = sv.vh;
    }
  };
  /** data: URL PNG 1600×1000 of the current view with the wordmark, caption and date */
  M.postcard = function (state, caption) {
    state = state || root; if (!state) return 'data:image/png;base64,';
    const pw = (PR.postcard && PR.postcard[0]) || 1600, ph = (PR.postcard && PR.postcard[1]) || 1000;
    const c = makeCanvas(pw, ph), g = ctx2d(c);
    let url = 'data:image/png;base64,';
    try {
      const cam = { x: camera ? camera.x : 0, y: camera ? camera.y : 0, zoom: 1, tx: 0, ty: 0, hasTarget: false, follow: -1 };
      M.renderInto(g, pw, ph, state, cam);
      g.globalAlpha = 0.55; g.fillStyle = BG; g.fillRect(0, ph - 110, pw, 110); g.globalAlpha = 1;
      g.fillStyle = GOLD; g.font = 'bold 44px Georgia, serif'; g.textBaseline = 'middle'; g.fillText('BAYOU STATE', 48, ph - 62);
      g.fillStyle = PAL.text || '#F4EEE2'; g.font = '24px Georgia, serif';
      const date = BSU.formatDate(fin(state.calendar && state.calendar.day, 0));
      g.fillText((caption ? String(caption) + '  ·  ' : '') + date, 380, ph - 62);
      url = c.toDataURL('image/png');
    } catch (e) { rerr('postcard', e); }
    try { c.width = 1; c.height = 1; } catch (e) { /* stub */ }
    return url;
  };
  /** 48×48 portrait / palette icon helpers for ui (draw the atlas entry centred in the canvas) */
  M.drawPortrait = function (el, frame) { drawCentered(el, 'thibodeaux', 0, frame | 0); };
  M.drawIcon = function (el, id) { drawCentered(el, 'icon:' + id, 0, 0); };
  function drawCentered(el, id, variant, frame) {
    if (!el) return;
    try {
      const g = ctx2d(el), w = el.width || 48, h = el.height || 48;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
      const ref = S().get(id, variant, frame, 1); if (!ref) return;
      const sc = Math.max(1, Math.floor(Math.min(w / ref.sw, h / ref.sh)));
      g.drawImage(ref.canvas, ref.sx, ref.sy, ref.sw, ref.sh, Math.round((w - ref.sw * sc) / 2), Math.round((h - ref.sh * sc) / 2), ref.sw * sc, ref.sh * sc);
    } catch (e) { rerr('drawCentered', e); }
  }

  // ---------------------------------------------------------------------------
  // Frame pipeline
  // ---------------------------------------------------------------------------
  function chunkPass(state, g) {
    const z = zoomNow, cw = CW * z, chh = CHH * z, hw = vw / 2, hh = vh / 2, camx = camera.x, camy = camera.y;
    const t0 = nowMs(); const timeBudget = firstFrame ? C.firstBakeMs : 0;
    const maxBakes = PR.chunkRebakesPerFrame || 2;
    bakesThisFrame = 0;
    for (let s = 0; s <= 14; s++) {
      for (let cx = Math.max(0, s - 7); cx <= Math.min(7, s); cx++) {
        const cy = s - cx, ch = chunks[cx + cy * 8];
        const dx = (ch.ox - camx) * z + hw, dy = (ch.oy - camy) * z + hh;
        if (dx > vw || dy > vh || dx + cw < 0 || dy + chh < 0) continue;
        if (!ch.canvas || ch.dirty || dirtyBits[cx + cy * 8]) {
          const allowed = firstFrame ? (nowMs() - t0 < timeBudget || bakesThisFrame < maxBakes) : bakesThisFrame < maxBakes;
          if (allowed) { try { bakeChunk(ch, state); bakesThisFrame++; } catch (e) { rerr('bake', e); ch.dirty = 0; } }
          if (!ch.canvas) continue;
        }
        ch.lastSeen = frameNo;
        g.drawImage(ch.canvas, 0, 0, CW, CHH, Math.round(dx), Math.round(dy), Math.round(cw), Math.round(chh)); drawCalls++;
      }
    }
    if ((frameNo % 60) === 0) evictChunks();
  }
  /** passes 2–9 on context g (shared by frame and renderInto) */
  function runWorld(state, g, alpha, dtMs, withRegistered) {
    try { chunkPass(state, g); } catch (e) { rerr('chunks', e); }
    try { waterPass(state, g); } catch (e) { rerr('water', e); }
    try { entityPass(state, g); } catch (e) { rerr('entities', e); }
    if (withRegistered === false) return;
    for (let k = 0; k < passes.length; k++) {
      const p = passes[k]; if (p.order > 9) continue;
      try { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; p.fn(state, g, view, alpha, dtMs); } catch (e) { rerr('pass:' + p.name, e); }
    }
    try { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } catch (e) { /* stub */ }
  }
  function setupPass(state, dtMs) {
    checkResize();
    const cam = camera;
    clampCam(cam);
    // follow
    if (followVehicle && Array.isArray(state.vehicles)) {
      let v = null;
      try { for (let k = 0; k < state.vehicles.length; k++) { const q = state.vehicles[k]; if (q && followVehicle(q, state)) { v = q; break; } } } catch (e) { followVehicle = null; rerr('followVehicle', e); }
      if (v) { const vx = fin(v.tx, 0), vy = fin(v.ty, 0); M.panTo((vx - vy) * 32, (vx + vy - 1) * 16 - elevAt(clamp(Math.floor(vx), 0, W - 1), clamp(Math.floor(vy), 0, HGT - 1)) * PXFT, true); }
      else followVehicle = null;
    }
    if (cam.follow >= 0 && Array.isArray(state.agents)) {
      const a = state.agents[cam.follow];
      if (a && a.state !== 'GONE') { const wx = (fin(a.tx, 0) - fin(a.ty, 0)) * 32, wy = (fin(a.tx, 0) + fin(a.ty, 0) - 1) * 16 - elevAt(clamp(Math.floor(a.tx), 0, W - 1), clamp(Math.floor(a.ty), 0, HGT - 1)) * PXFT; M.panTo(wx, wy, true); }
      else cam.follow = -1;
    }
    // football pass F: the game camera (frames the venue, follows the ball, yields to the player)
    try { fbGather(state); fbCamera(state, cam); } catch (e) { rerr('football:camera', e); }
    // easing toward the target
    if (cam.hasTarget) {
      cam.x += (cam.tx - cam.x) * LERP; cam.y += (cam.ty - cam.y) * LERP;
      if (Math.abs(cam.tx - cam.x) < 0.5 && Math.abs(cam.ty - cam.y) < 0.5) { cam.x = cam.tx; cam.y = cam.ty; cam.hasTarget = false; markMoved(false); }
      clampCam(cam);
    } else if (M.titleDrift) {
      cam.x += Math.sin(frameNo / 300) * C.titleDriftX; cam.y += Math.cos(frameNo / 420) * C.titleDriftY; clampCam(cam);
    }
    zoomNow = cam.zoom;
    visibleRect(cam, vw, vh, view);
    if (movedFlag) {
      camEvent.x = cam.x; camEvent.y = cam.y; camEvent.zoom = cam.zoom; camEvent.byUser = movedFlag === 2; movedFlag = 0;
      try { BSU.events.emit('camera:moved', camEvent); } catch (e) { rerr('camera:moved', e); }
    }
    gatherInfo(state);
    void dtMs;
  }
  /** one full frame (ARCHITECTURE §6.3); every pass in its own try/catch; alpha = interpolation toward the next tick */
  M.frame = function (state, alpha, dtMs) {
    if (!inited) return;
    state = state || root; if (!state || !state.ui) return;
    if (state !== root) bind(state);
    const t0 = nowMs();
    frameNo++; M.frameNo = frameNo;
    alphaNow = clamp(fin(alpha, 0), 0, 1); M.alpha = alphaNow;
    dtMs = fin(dtMs, 16.67);
    drawCalls = 0;
    try { setupPass(state, dtMs); } catch (e) { rerr('setup', e); }
    const g = ctx;
    let sx = 0, sy = 0;
    try {
      const now = nowMs();
      if (now < shakeUntil && shakePx > 0 && !(state.ui.settings && state.ui.settings.shake === false)) { sx = Math.round((BSU.rng.fx.float() * 2 - 1) * shakePx); sy = Math.round((BSU.rng.fx.float() * 2 - 1) * shakePx); }
      else if (now >= shakeUntil) shakePx = 0;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.imageSmoothingEnabled = false;
      g.fillStyle = BG; g.fillRect(0, 0, vw, vh);
      g.save(); g.translate(sx, sy);
    } catch (e) { rerr('clear', e); }
    runWorld(state, g, alphaNow, dtMs, true);
    try { g.restore(); } catch (e) { /* stub */ }
    for (let k = 0; k < passes.length; k++) {   // 10: hud-canvas bits
      const p = passes[k]; if (p.order <= 9) continue;
      try { p.fn(state, g, view, alphaNow, dtMs); } catch (e) { rerr('pass:' + p.name, e); }
    }
    firstFrame = false;
    if ((frameNo % C.spriteGcEvery) === 0) { try { const sp = S(); if (typeof sp.gc === 'function') sp.gc(frameNo); if (typeof sp.gcSheets === 'function') sp.gcSheets(frameNo); teeSweep(); } catch (e) { rerr('gc', e); } }
    frameMs = nowMs() - t0;
    guardrail(state);
  };
  function guardrail(state) {
    perfRing[perfI] = frameMs; perfI = (perfI + 1) % perfRing.length; if (perfI === 0) perfFilled = true;
    if (perfTripped || !perfFilled || BSU.headlessMode) return;
    const lim = PR.perfFrameMs || 25;
    for (let k = 0; k < perfRing.length; k++) if (perfRing[k] <= lim) return;
    perfTripped = true;
    if (state.ui) state.ui.perfMode = true;
    try { if (typeof M.onPerfMode === 'function') M.onPerfMode(state); } catch (e) { rerr('onPerfMode', e); }
    try { const ui = mod('ui'); if (ui && typeof ui.hint === 'function') ui.hint(state, 'perfMode', 'Performance mode'); } catch (e) { rerr('perfHint', e); }
    M.resize();
  }

  // ---------------------------------------------------------------------------
  // init / reset
  // ---------------------------------------------------------------------------
  function bind(state) {
    root = state;
    const ui = state.ui || (state.ui = {});
    if (!ui.camera || typeof ui.camera !== 'object') ui.camera = { x: 0, y: 1024, zoom: 1, tx: 0, ty: 0, follow: -1 };
    camera = ui.camera; followVehicle = null;
    camera.hasTarget = false; if (!Number.isFinite(camera.follow)) camera.follow = -1;
    clampCam(camera);
    zoomNow = camera.zoom;
    nanReported = false;
  }
  /** once per page load: the #world canvas, composites, chunk records, subscriptions, resize listener */
  M.init = function (state) {
    if (inited) return;
    inited = true;
    try { app = document.getElementById('app'); } catch (e) { app = null; }
    let existing = null;
    try { if (app && app.children) for (let k = 0; k < app.children.length; k++) { const c = app.children[k]; if (c && c.id === 'world') { existing = c; break; } } } catch (e) { existing = null; }
    canvas = existing || makeCanvas(1280, 720);
    if (!existing) {
      canvas.id = 'world'; try { canvas.className = 'world'; } catch (e) { /* stub */ }
      try { canvas.setAttribute('tabindex', '0'); canvas.tabIndex = 0; } catch (e) { /* stub */ }
      try { const st = canvas.style; st.position = 'absolute'; st.left = '0'; st.top = '0'; st.width = '100%'; st.height = '100%'; st.display = 'block'; st.touchAction = 'none'; st.outline = 'none'; st.imageRendering = 'pixelated'; st.background = BG; } catch (e) { /* stub */ }
      try { if (app) { if (app.firstChild && typeof app.insertBefore === 'function') app.insertBefore(canvas, app.firstChild); else app.appendChild(canvas); } else if (document.body) document.body.appendChild(canvas); } catch (e) { rerr('init:append', e); }
    }
    ctx = ctx2d(canvas, { alpha: false });
    comp.tint = makeCanvas(1, 1); comp.lights = makeCanvas(1, 1); comp.fog = makeCanvas(1, 1);
    allocChunks();
    bind(state || BSU.state || BSU.newState(0));
    M.resize();
    try {
      const ev = BSU.events;
      ev.on('tile:changed', onTileChanged, 'render');
      ev.on('save:loaded', function () { M.dirtyAll(); firstFrame = true; teeClear(); curvesDirty = true; }, 'render');
      ev.on('ui:overlay', function (p) { if (p && Number.isFinite(p.ov)) M.setOverlay(p.ov); else if (p && Number.isFinite(p.overlay)) M.setOverlay(p.overlay); }, 'render');
      ev.on('gate:closed', function (p) { if (p && Number.isFinite(p.i)) gates.set(p.i | 0, { closed: true, t0: frameNo }); }, 'render');
      ev.on('gate:opened', function (p) { if (p && Number.isFinite(p.i)) gates.set(p.i | 0, { closed: false, t0: frameNo }); }, 'render');
      ev.on('building:complete', function (p) { if (p && Number.isFinite(p.id)) { M.squash[p.id] = nowMs(); teeDrop(p.id); dirtyAroundBuilding(p); } }, 'render');
      ev.on('building:removed', function (p) { if (p && Number.isFinite(p.id)) { teeDrop(p.id); dirtyAroundBuilding(p); } }, 'render');
    } catch (e) { rerr('init:events', e); }
    try { if (!BSU.headlessMode && typeof window.addEventListener === 'function') window.addEventListener('resize', function () { try { M.resize(); } catch (e) { rerr('resize', e); } }); } catch (e) { /* stub */ }
    try { if (typeof M._fxInit === 'function') M._fxInit(root); } catch (e) { rerr('_fxInit', e); }
  };
  /** every newGame (fresh) and load: drop the chunk cache, rebind the camera, _fxReset, resize */
  M.reset = function (state, fresh) {
    if (!state) return;
    bind(state);
    for (let k = 0; k < NCH; k++) if (chunks[k]) dropChunk(chunks[k]); else { const o = chunkOrigin(k & 7, k >> 3); chunks[k] = { cx: k & 7, cy: k >> 3, ox: o.ox, oy: o.oy, canvas: null, ctx: null, dirty: 1, lastSeen: -1 }; }
    dirtyBits.fill(1); curvesDirty = true; curves = null;
    flashes.length = 0; ghostSpec = null; gates.clear(); shakeUntil = 0; shakePx = 0; hitStopUntilMs = 0;
    for (const k in M.squash) delete M.squash[k];
    perfRing.fill(0); perfI = 0; perfFilled = false; perfTripped = false;
    birdTiles = null; firstFrame = true; count = 0; list.length = 0; teeClear();
    if (fresh === true && state.plot && state.plot.founders && Number.isFinite(state.plot.founders.tx)) {
      camera.zoom = 1; M.panToTile(state.plot.founders.tx + 1, state.plot.founders.ty + 1, false);
    }
    camera.follow = -1;
    try { if (typeof M._fxReset === 'function') M._fxReset(state); } catch (e) { rerr('_fxReset', e); }
    if (inited) M.resize();
  };

  // ---------------------------------------------------------------------------
  // selfTest (pure math; private camera/state objects; render_fx's _tests run too)
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const A = BSU.assert, notes = [], t0 = Date.now();
    const ok = (c, m) => A(c, 'render: ' + m);
    // 1. sort key
    ok(sortKey(11, 10, 0, 0) > sortKey(10, 10, 0, 0) && sortKey(10, 11, 0, 0) > sortKey(10, 10, 0, 0), 'sort key monotonic along the diagonal');
    ok(sortKey(10, 10, 0, 3) > sortKey(10, 10, 0, 0) && sortKey(10, 10, 0, 3) - sortKey(10, 10, 0, 0) === 0.75, 'particle sorts after a building on the same tile');
    ok(Math.abs((sortKey(10, 10, 1, 0) - sortKey(10, 10, 0, 0)) - 2) < 1e-9, '+1 ft adds 2');
    // 2. camera clamp / zoom anchor
    const cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, hasTarget: false, follow: -1 };
    panByCam(cam, 1e7, 1e7); ok(cam.x === WORLD_X[1] + 200 && cam.y === WORLD_Y[1] + 200, 'panBy clamps to max + 200 at zoom 1 (' + cam.x + ',' + cam.y + ')');
    cam.zoom = 0.5; panByCam(cam, 1e7, 0); ok(cam.x === WORLD_X[1] + 400, 'clamp margin 200/zoom at 0.5× (' + cam.x + ')');
    cam.zoom = 1; cam.x = 100; cam.y = 900;
    const ax = 900, ay = 200, before = BSU.screenToWorld(ax, ay, cam, 1280, 720);
    const wxB = (ax - 640) / cam.zoom + cam.x, wyB = (ay - 360) / cam.zoom + cam.y;
    setZoomCam(cam, 2, ax, ay, 1280, 720);
    const wxA = (ax - 640) / cam.zoom + cam.x, wyA = (ay - 360) / cam.zoom + cam.y;
    ok(cam.zoom === 2 && Math.abs(wxA - wxB) < 1 && Math.abs(wyA - wyB) < 1, 'setZoom(2) keeps the world point under the anchor (' + (wxA - wxB).toFixed(3) + ')');
    void before;
    ok(snapZoom(1.3) === 1 && snapZoom(1.6) === 2 && snapZoom(0.1) === 0.5 && snapZoom(NaN) === 1, 'zoom snaps to 0.5/1/2');
    // 3. screenToTile inverse on 20 random tiles at random elevations (private elev array)
    const pe = new Float32Array(N); const r = BSU.rng.derive ? BSU.rng.derive('render-selftest', 1) : BSU.rng.fx;
    for (let k = 0; k < N; k++) pe[k] = -4 + (hash(k, 3) % 1800) / 100;
    const pcam = { x: 0, y: 1024, zoom: 1 }; const eAt = (tx, ty) => pe[ty * W + tx];
    let inv = 0;
    for (let k = 0; k < 20; k++) {
      const tx = r.int(W), ty = r.int(HGT); pcam.zoom = ZOOMS[r.int(3)]; pcam.x = (tx - ty) * 32 + r.int(100) - 50; pcam.y = (tx + ty) * 16 + r.int(100) - 50;
      // the tile center must be hit by its own tile unless a higher tile in front covers it (the contract's rule) — test with the highest-in-front check
      const s = BSU.worldToScreen(tx, ty, eAt(tx, ty), pcam, 1280, 720);
      const h = BSU.screenToWorld(s.x, s.y, pcam, 1280, 720, eAt);
      if (h && (h.tx === tx && h.ty === ty || (h.tx + h.ty > tx + ty))) inv++;
    }
    ok(inv === 20, 'screenToTile inverse on 20 tiles (' + inv + '/20)');
    // 4. chunk origin formula and containment
    const o00 = chunkOrigin(0, 0), o77 = chunkOrigin(7, 7);
    ok(o00.ox === -256 && o00.oy === -100 && o77.ox === -256 && o77.oy === 1692, 'chunk origins (0,0) → (−256, −100), (7,7) → (−256, 1692)');
    let contained = true;
    for (let cy = 0; cy < 8 && contained; cy++) for (let cx = 0; cx < 8 && contained; cx++) {
      const o = chunkOrigin(cx, cy);
      const corners = [[cx * 8, cy * 8], [cx * 8 + 7, cy * 8], [cx * 8, cy * 8 + 7], [cx * 8 + 7, cy * 8 + 7]];
      for (let c = 0; c < 4; c++) for (let e = 0; e < 2; e++) {
        const d = BSU.tileDiamond(corners[c][0], corners[c][1], e ? 14 : -4);
        if (d.x3 < o.ox || d.x1 > o.ox + CW || d.y0 < o.oy || d.y2 > o.oy + CHH) contained = false;
      }
    }
    ok(contained, 'every corner tile of every chunk projects inside its 512×416 canvas at elev −4 and 14');
    // 5. visibleTiles spans
    const vr = { x0: 0, y0: 0, x1: 0, y1: 0 }; const c32 = { x: 0, y: 1024, zoom: 1 };
    visibleRect(c32, 1280, 720, vr);
    ok(vr.x0 <= 32 && vr.x1 >= 32 && vr.y0 <= 32 && vr.y1 >= 32, 'visibleTiles contains (32,32) at 1×');
    ok((vr.x1 - vr.x0) <= 50 && (vr.y1 - vr.y0) <= 50, 'visibleTiles at 1× spans ≤ 50 tiles (' + (vr.x1 - vr.x0) + '×' + (vr.y1 - vr.y0) + '; the iso bounding rect of a 1280×720 view is ~44, not 30 — see INTEGRATION_NOTES)');
    c32.zoom = 0.5; visibleRect(c32, 1280, 720, vr);
    ok((vr.x1 - vr.x0) >= 40 && (vr.y1 - vr.y0) >= 40, 'visibleTiles at 0.5× spans ≥ 40 tiles');
    // 6. building variant table
    const V = M.variantOf;
    ok(V({ built: 0.5 }) === SPR.SCAFFOLD && M.frameOf({ built: 0.5 }, SPR.SCAFFOLD) === 1, 'built .5 → SCAFFOLD frame 1');
    ok(V({ ruin: true }) === SPR.RUIN, 'ruin → RUIN');
    ok(V({ hp: 0.8, tarp: true }) === SPR.DAMAGED, 'hp .8 + tarp → DAMAGED');
    ok(V({ pilings: true }, { phase: SKY.DUSK, effective: 1 }) === (SPR.PILINGS | SPR.NIGHT), 'pilings at Dusk, effective → PILINGS|NIGHT');
    ok(V({ pilings: true, blackout: true }, { phase: SKY.NIGHT, effective: 1 }) === SPR.PILINGS, 'blackout suppresses NIGHT');
    ok(V({ tier: 2 }) === (2 << SPR.TIER_SHIFT), 'tier 2 → 2 << 5');
    ok(V({ data: { boardedUntil: 10 } }, { day: 5 }) === SPR.BOARDED && V({ data: { boardedUntil: 4 } }, { day: 5 }) === 0, 'BOARDED while boardedUntil ≥ day');
    // 7. perf finite before any frame
    const p = M.perf();
    ok(Number.isFinite(p.frameMs) && Number.isFinite(p.drawCalls) && Number.isFinite(p.memMB) && Number.isFinite(p.chunks) && Number.isFinite(p.hydroActive) && Number.isFinite(p.particles), 'perf() finite');
    // pass registry sanity
    ok(passes.length >= 3 && passes.every((q, i, arr) => i === 0 || arr[i - 1].order <= q.order), 'pass registry ordered');
    // render_fx's tests
    for (let k = 0; k < M._tests.length; k++) { const fn = M._tests[k]; if (typeof fn === 'function') { const res = fn(); if (res && res.notes) notes.push(res.notes); if (res && res.ok === false) A(false, 'render_fx test ' + k + ' failed: ' + (res.notes || '')); } }
    notes.push((Date.now() - t0) + ' ms, ' + passes.length + ' passes');
    return { ok: true, notes: notes.join('; ') };
  };
})();
