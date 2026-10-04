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
    mossMin: 6, mossMax: 10, mossSway: 3, overlayAlpha: 0.45, ghostAlpha: 0.45, ghostSpriteAlpha: 0.6
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
  M.alpha = 0; M.frameNo = 0; M.hoverTile = -1; M.squash = {}; M.titleDrift = false; M._tests = M._tests || [];
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
    // neighbours' cliff faces / auto-tile masks live in the adjacent chunk when the tile sits on a chunk edge
    if ((tx & 7) === 0 && cx > 0) M.dirtyChunk(cx - 1 + cy * 8);
    if ((ty & 7) === 0 && cy > 0) M.dirtyChunk(cx + (cy - 1) * 8);
    if ((tx & 7) === 7 && cx < 7) M.dirtyChunk(cx + 1 + cy * 8);
    if ((ty & 7) === 7 && cy < 7) M.dirtyChunk(cx + (cy + 1) * 8);
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
        // (e) surfaces: path/road/boardwalk/fence auto-tiled
        const sf = surf[i];
        if (sf > 0 && sf <= 4) {
          let v = sameMask(surf, i, tx, ty, sf);
          if ((f & WATER_FLAGS) || ty8 === T.OPEN_WATER || ty8 === T.BAYOU || ty8 === T.POND) v |= 16;
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
    mem += liveChunks() * C.chunkMB + (canvas ? (canvas.width * canvas.height * 12) / 1048576 : 0);
    let parts = 0; try { parts = M.particles && typeof M.particles.count === 'function' ? fin(M.particles.count(), 0) : 0; } catch (e) { parts = 0; }
    return { frameMs: fin(frameMs, 0), drawCalls: drawCalls | 0, particles: parts, agentsDrawn: agentsDrawn | 0, hydroActive: hydroActive, chunks: liveChunks(), memMB: Math.round(mem * 100) / 100, water: waterDrawn | 0, frameNo: frameNo, zoom: zoomNow, perfMode: !!(root && root.ui && root.ui.perfMode) };
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
  }
  function entityPass(state, g) {
    count = 0; agentsDrawn = 0; particlesDrawn = 0;
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
        const ci = { phase: info.phase, day: info.day, effective: eff, wind: info.wind, barrierClosed: info.barrierClosed, toppleIds: info.toppleIds };
        const v = M.variantOf(b, ci), fr = M.frameOf(b, v, ci);
        const e = push('building', ax, ay, fin(elev[ay * W + ax], 0), 0, drawBuilding);
        e.b = b; e.id = b.rot ? b.type + ':r' : b.type; e.variant = v; e.frame = fr;
        e.ref = getRef(e.id, v, fr);
        const row = cat[b.type];
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
    // in-world particles (D50): the only hook through which render_fx's pool reaches the sorted pass
    try { if (M.particles && typeof M.particles.forEachWorld === 'function') M.particles.forEachWorld(particleCb); } catch (err) { rerr('entities:particles', err); }
    // sort + draw
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
        const ref = getRef(gs.sprite.id, fin(gs.sprite.variant, 0), 0);
        if (ref) { const p = M.tileToScreen(gs.sprite.tx | 0, gs.sprite.ty | 0); g.globalAlpha = C.ghostSpriteAlpha; blit(g, ref, p.x, p.y, zsOf(ref)); }
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
    if ((frameNo % C.spriteGcEvery) === 0) { try { const sp = S(); if (typeof sp.gc === 'function') sp.gc(frameNo); if (typeof sp.gcSheets === 'function') sp.gcSheets(frameNo); } catch (e) { rerr('gc', e); } }
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
      ev.on('save:loaded', function () { M.dirtyAll(); firstFrame = true; }, 'render');
      ev.on('ui:overlay', function (p) { if (p && Number.isFinite(p.ov)) M.setOverlay(p.ov); else if (p && Number.isFinite(p.overlay)) M.setOverlay(p.overlay); }, 'render');
      ev.on('gate:closed', function (p) { if (p && Number.isFinite(p.i)) gates.set(p.i | 0, { closed: true, t0: frameNo }); }, 'render');
      ev.on('gate:opened', function (p) { if (p && Number.isFinite(p.i)) gates.set(p.i | 0, { closed: false, t0: frameNo }); }, 'render');
      ev.on('building:complete', function (p) { if (p && Number.isFinite(p.id)) M.squash[p.id] = nowMs(); }, 'render');
    } catch (e) { rerr('init:events', e); }
    try { if (!BSU.headlessMode && typeof window.addEventListener === 'function') window.addEventListener('resize', function () { try { M.resize(); } catch (e) { rerr('resize', e); } }); } catch (e) { /* stub */ }
    try { if (typeof M._fxInit === 'function') M._fxInit(root); } catch (e) { rerr('_fxInit', e); }
  };
  /** every newGame (fresh) and load: drop the chunk cache, rebind the camera, _fxReset, resize */
  M.reset = function (state, fresh) {
    if (!state) return;
    bind(state);
    for (let k = 0; k < NCH; k++) if (chunks[k]) dropChunk(chunks[k]); else { const o = chunkOrigin(k & 7, k >> 3); chunks[k] = { cx: k & 7, cy: k >> 3, ox: o.ox, oy: o.oy, canvas: null, ctx: null, dirty: 1, lastSeen: -1 }; }
    dirtyBits.fill(1);
    flashes.length = 0; ghostSpec = null; gates.clear(); shakeUntil = 0; shakePx = 0; hitStopUntilMs = 0;
    for (const k in M.squash) delete M.squash[k];
    perfRing.fill(0); perfI = 0; perfFilled = false; perfTripped = false;
    birdTiles = null; firstFrame = true; count = 0; list.length = 0;
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
