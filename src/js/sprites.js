'use strict';
// ============================================================================
// BAYOU STATE — sprites.js (module 10; base of the procedural art stack)
// Owner: nothing in state (the atlas is derived, seed-independent, never saved).
// Implements: ARCHITECTURE.md §6.1 (atlas API, anchors, id list), §10.5/§10.6;
// docs/briefs/sprites.md (all Tier 1 + Tier 2 #9 zoom-2 atlas); GDD §12.1–§12.4,
// §3.2 (surface auto-tiling), §4.8 rows 25–27/31/35 visuals, §4.9 trees, §3.4 step 5.
//
// What lives here: the sprite cache + painter registry (`get`, `registerPainter`,
// `frames`, `size`, `memoryMB`, `gc`), the palette and colour helpers, the pixel
// helpers every painter reuses, and the terrain-side painters: ground tiles,
// cliff faces, reeds/knees/worn/mound, surfaces (path/road/boardwalk/fence with
// bridge/sign/culvert bits), levee/floodwall/canal/preservePost, water highlights,
// every decal, every light sprite, and the vegetation (oak/cypress/palmetto/azalea).
// sprites_buildings.js registers `building`/`ruin`/`thibodeaux`/`icon`;
// sprites_entities.js registers agents, gators, vehicles, birds, gates… Both may
// re-register a family (last registration wins) — e.g. the entities file may take
// over `oak`/`cypress`/`palmetto`/`azalea`; the ones here are complete either way.
//
// ---------------------------------------------------------------------------
// CONVENTIONS FOR THE SPLIT FILES (sprites_buildings.js / sprites_entities.js)
// ---------------------------------------------------------------------------
// * registerPainter(family, fn): fn(ctx, spec) → {w, h, ox, oy}. spec =
//   {id, family, sub, variant, frame, zoom, row, rot, seed, frames}. `ctx` is a
//   fresh 2D context on an unsized canvas: the painter MUST call
//   BSU.sprites.begin(ctx, w, h) first (it sizes the canvas ≥ 1×1 in device px
//   — i.e. w*zoom × h*zoom — and turns smoothing off), then draw, then return the
//   geometry IN 1× UNITS (the core multiplies ox/oy/w/h by zoom). A painter may
//   set spec.frames = n on its first call to declare a frame count (stored per id,
//   and per id|variant when it depends on the variant, e.g. NIGHT = 4 frames).
//   A painter may also return {canvas, sx, sy, sw, sh} (device px) to hand back a
//   sub-rect of a sheet it caches itself (the per-look agent sheets).
// * Integer pixel art only: fillRect / px / hline / diamond runs. Never arc(),
//   lineTo() with fractional coordinates, fillText (OS fonts differ), gradients
//   (only the `light` family), getImageData, or rng.fx (determinism: use
//   BSU.sprites.hash(seed, salt) for any jitter so a re-bake is pixel-identical).
// * Scaling: `const P = BSU.sprites.pen(ctx, spec.zoom)` returns a pen whose
//   every call takes 1× coordinates and paints S×S blocks. Write painters at 1×
//   with P.rect/P.px/P.hline/P.vline/P.line/P.dither/P.diamond/P.ellipse/P.glyph/
//   P.text; the same code produces the 2× atlas (Tier 2 #9, enabled: ZOOM2 = true).
// * Shading conventions used by every painter in this file (copy them):
//     - three tones per material: light = shade(c, 1.15), mid = c, dark = shade(c, .78)
//     - the light comes from the upper-left: top edges/top-left faces get `light`,
//       lower-right faces/undersides get `dark`; a 1-px outline is shade(c, .55)
//     - organic edges are dithered (P.dither with density .5 on the last 1–2 px)
//     - soil/grass gets 6–12% speckle noise (hash-seeded), never flat fills
//     - ground contact: a 1-px shade(c,.6) shadow row under anything standing on a tile
// * Anchors (ARCH §6.1 / D17): ox, oy = offset from the anchor point to the
//   sprite's top-left at that zoom. tiles/surf/levee/floodwall/canal/water/worn/
//   preservePost: the tile's diamond CENTER (ox −32, oy −16 − extra rows above);
//   cliff: the tile center of the tile whose S/E edge it hangs under (ox −32 south
//   face / 0 east face, oy 0); reeds/knees/mound: the tuft base at the tile center;
//   decals with data anchor 'ground': bottom-centre (ox −w/2, oy −h + 4), 'roof'/
//   'side': the decal centre; lights: centre; trees: trunk base (ox −w/2, oy −h + 4).
// * Colours: every hex comes from BSU.params.palette (BSU.sprites.palette) or from
//   the small set of brief-named extras in X below; catalog rows carry their own
//   paint hexes. shade() FLOORS channel × k (so shade('#FDD023', .5) === '#7E6811');
//   mix() ROUNDS (so mix('#000000', '#FFFFFF', .5) === '#808080').
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.sprites = BSU.sprites || {});
  const MAP = BSU.MAP;
  const T = BSU.T;
  const PAL = BSU.params.palette;
  const PR = BSU.params.render;
  const TW = MAP.TILE_W, TH = MAP.TILE_H;      // 64 × 32
  const PX_PER_FT = MAP.PX_PER_FT;             // 6
  const hash = BSU.rng.hash;
  const strHash = BSU.strHash;

  M.palette = PAL;
  M.CANVAS_LIMIT_MB = 8;        // atlas budget (render enforces the 64 MB total)
  M.ZOOM2 = true;               // Tier 2 #9: build 2× entries on demand (one-line switch)
  M.GC_FRAMES = 600;            // lazily built entries unused this many frames may be dropped
  M.TILE_W = TW; M.TILE_H = TH; M.PX_PER_FT = PX_PER_FT;

  // Hexes named by the brief/GDD that are not in the palette table (concrete, steel,
  // tarp blue, skin/hair/shirt tables, …). Keep them here so nothing is hard-coded inline.
  const X = Object.freeze({
    concrete: '#B8B8BC', steel: '#8A8A8E', steelDark: '#6A6A70', steelShadow: '#5A5A60', chain: '#8A8A8E',
    tarp: '#3B6FD6', tarpCrease: '#2B4F9E', plywood: '#B08D5E', scaffold: '#8A7A5A', debris: '#5A4A3A',
    black: '#1B1B1B', white: '#FFFFFF', offWhite: '#E8E8E8', glass: '#A0D0FF', dumpster: '#4A6A4A',
    flame: '#FFCB6B', ember: '#E07020', palmetto: '#5E8A3A', azaleaLeaf: '#2E5A2A', firefly: '#D8FF9A',
    lampGlow: '#FFE0A0', tigerOrange: '#E07020', green: '#2E8B57', nail: '#3A3040', sandbag: '#C9B47C',
    skins: ['#F1C27D', '#E0AC69', '#C68642', '#8D5524', '#5C3A1E', '#FFDBAC'],
    hairs: ['#1B1B1B', '#3A2A1E', '#6B4423', '#B0723C', '#E6C27A', '#A8A8A8', '#5E2CA5', '#C7692B'],
    shirts: ['#461D7C', '#FDD023', '#E8E8E8']
  });
  M.extra = X;

  // ---------------------------------------------------------------------------
  // Colour helpers (pure)
  // ---------------------------------------------------------------------------
  const hexCache = new Map();
  /** '#rrggbb' → [r, g, b] (also accepts '#rgb'); invalid → [0,0,0] */
  function hex(h) {
    let v = hexCache.get(h);
    if (v) return v;
    let s = String(h || '');
    if (s[0] === '#') s = s.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    const n = parseInt(s.slice(0, 6), 16);
    v = Number.isFinite(n) && s.length >= 6 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
    hexCache.set(h, v);
    return v;
  }
  const c255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v) | 0;
  const h2 = (v) => ((v < 16 ? '0' : '') + v.toString(16)).toUpperCase();
  /** [r,g,b] → '#rrggbb' (clamped, integer) */
  function rgb(r, g, b) { return '#' + h2(c255(r)) + h2(c255(g)) + h2(c255(b)); }
  /** multiply each channel by k (floor), clamp */
  function shade(h, k) {
    const c = hex(h); k = Number.isFinite(k) ? k : 1;
    return rgb(Math.floor(c[0] * k + 1e-9), Math.floor(c[1] * k + 1e-9), Math.floor(c[2] * k + 1e-9));
  }
  /** linear blend a→b by t (round) */
  function mix(a, b, t) {
    const A = hex(a), B = hex(b); t = Number.isFinite(t) ? (t < 0 ? 0 : t > 1 ? 1 : t) : 0;
    return rgb(Math.round(A[0] + (B[0] - A[0]) * t), Math.round(A[1] + (B[1] - A[1]) * t), Math.round(A[2] + (B[2] - A[2]) * t));
  }
  /** 'rgba(r,g,b,a)' string for the light gradients */
  function rgba(h, a) { const c = hex(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (Number.isFinite(a) ? a : 1) + ')'; }
  /** hash(tx, ty) % 3 — the ground tile variant (stable per tile) */
  function tileVariant(tx, ty) { return hash(tx | 0, ty | 0) % 3; }
  const light = (c) => shade(c, 1.15), dark = (c) => shade(c, 0.78), outline = (c) => shade(c, 0.55);
  M.hex = hex; M.rgb = rgb; M.shade = shade; M.mix = mix; M.rgba = rgba; M.hash = hash; M.tileVariant = tileVariant;
  M.light = light; M.dark = dark; M.outline = outline;

  // ---------------------------------------------------------------------------
  // Canvas / pixel helpers
  // ---------------------------------------------------------------------------
  /** a no-op 2D context (used only when no document exists at all) */
  function noopCtx(canvas) {
    return new Proxy({ canvas: canvas }, { get(t, k) { return k in t ? t[k] : () => {}; }, set(t, k, v) { t[k] = v; return true; } });
  }
  /** document.createElement('canvas') sized w×h (≥ 1×1); headless: the stub element */
  function newCanvas(w, h) {
    w = Math.max(1, Math.floor(Number.isFinite(w) ? w : 1)); h = Math.max(1, Math.floor(Number.isFinite(h) ? h : 1));
    let c = null;
    try { if (typeof document !== 'undefined' && document && document.createElement) c = document.createElement('canvas'); } catch (e) { c = null; }
    if (!c) c = { width: w, height: h, getContext() { return this._ctx || (this._ctx = noopCtx(this)); } };
    c.width = w; c.height = h;
    return c;
  }
  /** the 2D context of a canvas with smoothing off (never throws; falls back to a no-op ctx) */
  function ctx2d(canvas) {
    let g = null;
    try { g = canvas.getContext('2d'); } catch (e) { g = null; }
    if (!g) g = noopCtx(canvas);
    try { g.imageSmoothingEnabled = false; } catch (e) { /* stub */ }
    return g;
  }
  /** size the painter's canvas (device px), clear it, smoothing off; returns {w, h} in 1× units */
  function begin(ctx, w, h, zoom) {
    const S = (zoom === 2) ? 2 : 1;
    w = Math.max(1, Math.round(Number.isFinite(w) ? w : 1)); h = Math.max(1, Math.round(Number.isFinite(h) ? h : 1));
    const c = ctx && ctx.canvas;
    if (c) { c.width = w * S; c.height = h * S; }
    try { ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; } catch (e) { /* stub */ }
    return { w: w, h: h, S: S };
  }
  /** one pixel (1×1 fillRect) */
  function px(ctx, x, y, color) { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); }
  /** half-width of row r of a w×h diamond (the brief's formula) */
  function diamondHalf(w, h, r) { const hh = h / 2; return Math.round((w / 2) * (1 - Math.abs(r - hh) / hh)); }
  /** the 2:1 diamond centred at (cx, cy), from horizontal fillRect runs; optional 1-px darker edge */
  function diamond(ctx, cx, cy, w, h, fill, stroke) {
    w = w | 0; h = h | 0; if (w <= 0 || h <= 0) return;
    const top = cy - (h >> 1);
    ctx.fillStyle = fill;
    for (let r = 0; r < h; r++) { const half = diamondHalf(w, h, r); if (half > 0) ctx.fillRect(cx - half, top + r, 2 * half, 1); }
    if (stroke) {
      ctx.fillStyle = stroke;
      for (let r = 0; r < h; r++) { const half = diamondHalf(w, h, r); if (half > 0) { ctx.fillRect(cx - half, top + r, 1, 1); ctx.fillRect(cx + half - 1, top + r, 1, 1); } }
    }
  }
  /** 1-px hash dither: fill (x,y,w,h) with c1 (skipped when c1 is null) then c2 pixels at `density`; area capped */
  function dither(ctx, x, y, w, h, c1, c2, seed, density) {
    w = w | 0; h = h | 0; if (w <= 0 || h <= 0) return;
    if (w * h > 16384) { w = Math.min(w, 128); h = Math.min(h, 128); }
    density = Number.isFinite(density) ? density : 0.5;
    if (c1) { ctx.fillStyle = c1; ctx.fillRect(x, y, w, h); }
    if (!c2 || density <= 0) return;
    const th = Math.round(density * 1000); seed = seed | 0;
    ctx.fillStyle = c2;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (hash(seed, i + j * 4099) % 1000 < th) ctx.fillRect(x + i, y + j, 1, 1);
  }
  M.newCanvas = newCanvas; M.ctx2d = ctx2d; M.begin = begin; M.px = px; M.diamond = diamond; M.dither = dither; M.diamondHalf = diamondHalf;

  // ---------------------------------------------------------------------------
  // 3×5 pixel glyph font (no fillText anywhere in sprites): A–Z 0–9 and a few marks.
  // Greek Β/Σ/Υ map onto B / a sigma shape / Y. Each glyph = 5 rows of 3 bits.
  // ---------------------------------------------------------------------------
  const FONT = {
    A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
    G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
    M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5],
    S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
    Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [6, 1, 2, 4, 7], '3': [7, 1, 3, 1, 7],
    '4': [5, 5, 7, 1, 1], '5': [7, 4, 6, 1, 6], '6': [3, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 6],
    '!': [2, 2, 2, 0, 2], '-': [0, 0, 7, 0, 0], '.': [0, 0, 0, 0, 2], ' ': [0, 0, 0, 0, 0], 'Σ': [7, 4, 2, 4, 7], 'Β': [6, 5, 6, 5, 6], 'Υ': [5, 5, 2, 2, 2],
    '/': [1, 1, 2, 4, 4], '+': [0, 2, 7, 2, 0], '×': [0, 5, 2, 5, 0]
  };
  M.FONT = FONT;

  /**
   * A scaled pen: every method takes 1× coordinates and paints S×S device blocks.
   * pen(ctx, zoom) → {S, rect, px, hline, vline, line, dither, diamond, ellipse, ellipseTest, glyph, text}
   */
  function pen(ctx, zoom) {
    const S = (zoom === 2) ? 2 : 1;
    const p = {
      S: S, ctx: ctx,
      rect(x, y, w, h, c) { if (w <= 0 || h <= 0) return; ctx.fillStyle = c; ctx.fillRect(Math.round(x) * S, Math.round(y) * S, Math.round(w) * S, Math.round(h) * S); },
      px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x) * S, Math.round(y) * S, S, S); },
      hline(x, y, w, c) { p.rect(x, y, w, 1, c); },
      vline(x, y, h, c) { p.rect(x, y, 1, h, c); },
      /** Bresenham line of pixels */
      line(x0, y0, x1, y1, c) {
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, n = 0;
        ctx.fillStyle = c;
        for (;;) {
          ctx.fillRect(x0 * S, y0 * S, S, S);
          if ((x0 === x1 && y0 === y1) || ++n > 4096) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; x0 += sx; }
          if (e2 <= dx) { err += dx; y0 += sy; }
        }
      },
      /** hash dither in 1× pixels (c1 null = overlay only) */
      dither(x, y, w, h, c1, c2, seed, density) {
        w = Math.round(w); h = Math.round(h); x = Math.round(x); y = Math.round(y); if (w <= 0 || h <= 0) return;
        if (w * h > 16384) { w = Math.min(w, 128); h = Math.min(h, 128); }
        density = Number.isFinite(density) ? density : 0.5; seed = seed | 0;
        if (c1) p.rect(x, y, w, h, c1);
        if (!c2 || density <= 0) return;
        const th = Math.round(density * 1000);
        ctx.fillStyle = c2;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (hash(seed, i + j * 4099) % 1000 < th) ctx.fillRect((x + i) * S, (y + j) * S, S, S);
      },
      /** 2:1 diamond centred at (cx, cy) */
      diamond(cx, cy, w, h, fill, stroke) {
        w = Math.round(w); h = Math.round(h); if (w <= 0 || h <= 0) return;
        const top = cy - (h >> 1);
        for (let r = 0; r < h; r++) { const half = diamondHalf(w, h, r); if (half > 0) p.rect(cx - half, top + r, 2 * half, 1, fill); }
        if (stroke) for (let r = 0; r < h; r++) { const half = diamondHalf(w, h, r); if (half > 0) { p.px(cx - half, top + r, stroke); p.px(cx + half - 1, top + r, stroke); } }
      },
      /** filled ellipse from horizontal runs (rx, ry in px) */
      ellipse(cx, cy, rx, ry, c) {
        rx = Math.max(0.5, rx); ry = Math.max(0.5, ry);
        for (let dy = -Math.floor(ry); dy <= Math.floor(ry); dy++) {
          const k = 1 - (dy * dy) / (ry * ry); if (k < 0) continue;
          const half = Math.round(Math.sqrt(k) * rx); if (half <= 0) continue;
          p.rect(cx - half, cy + dy, 2 * half, 1, c);
        }
      },
      /** 1 − normalized squared distance to the ellipse centre (>0 inside) */
      ellipseTest(x, y, cx, cy, rx, ry) { const dx = (x - cx) / rx, dy = (y - cy) / ry; return 1 - dx * dx - dy * dy; },
      /** one 3×5 glyph; returns the advance (4) */
      glyph(ch, x, y, c) {
        const g = FONT[ch] || FONT[String(ch).toUpperCase()] || FONT['.'];
        for (let r = 0; r < 5; r++) for (let b = 0; b < 3; b++) if (g[r] & (4 >> b)) p.px(x + b, y + r, c);
        return 4;
      },
      /** a run of glyphs; returns the total advance */
      text(str, x, y, c) { let a = 0; for (const ch of String(str)) a += p.glyph(ch, x + a, y, c); return a; }
    };
    return p;
  }
  M.pen = pen;
  M.glyph = function (ctx, ch, x, y, color, zoom) { return pen(ctx, zoom).glyph(ch, x, y, color); };

  // ---------------------------------------------------------------------------
  // Cache core: painter registry, family resolution, get/size/frames/memory/gc
  // ---------------------------------------------------------------------------
  const painters = Object.create(null);        // family → fn(ctx, spec)
  const cache = new Map();                     // 'id|variant|frame|zoom' → entry | null
  const frameCounts = Object.create(null);     // 'id' or 'id|variant' → n (declared by painters)
  const erroredIds = new Set();                // ids that already produced one BSU.error
  let frameNo = 0;                             // render advances it through gc(frameNo)
  let baking = false;                          // true inside init (entries baked there are not "lazy")
  M._tests = M._tests || [];                   // split files push selfTest functions here

  // Default frame totals per family / id (ARCH §6.1, the entities brief's table, the decal table).
  // Painters may override through spec.frames; data.decals frames win for decals.
  const FRAMES = {
    tile: 1, cliff: 2, reeds: 2, knees: 1, worn: 1, mound: 1, surf: 1, levee: 1, floodwall: 1, canal: 1, preservePost: 1, water: 1,
    light: 1, oak: 1, cypress: 1, palmetto: 1, azalea: 1, building: 1, ruin: 1, thibodeaux: 2, icon: 1, bubble: 3,
    agent: 16, 'agent:walk': 16, 'agent:idle': 8, 'agent:flee': 8, 'agent:splash': 8, 'agent:slap': 8, 'agent:cheer': 8, 'agent:sit': 4,
    'agent:wave': 8, 'agent:tube': 8, 'agent:umbrella': 16, 'agent:cap': 4, 'agent:beads': 8, 'agent:foam': 16,
    gator: 6, roux: 3, officer: 16, 'officer:wrangle': 2, fogger: 2, bus: 2, pirogue: 2, navy: 2, float: 2, band: 4, krewe: 4,
    tent: 1, smoker: 2, cornhole: 2, snoball: 2, bonfire: 3, egret: 2, spoonbill: 2, pelican: 2, armadillo: 2, nutria: 2,
    gate: 4, barrierGate: 4, nest: 1
  };
  M.FRAMES = FRAMES;

  /** register (or replace) the painter of a family; plain-object write, allowed at definition time */
  M.registerPainter = function (family, fn) {
    if (typeof family !== 'string' || !family || typeof fn !== 'function') { BSU.error('sprites', 'registerPainter', new Error('bad painter for ' + family)); return; }
    painters[family] = fn;
    for (const k of [...cache.keys()]) { const f = resolve(k.slice(0, k.indexOf('|'))); if (f && f.family === family) cache.delete(k); }
  };
  M.hasPainter = (family) => !!painters[family];

  /** id → {family, sub, row, rot} per the brief's rule; null for a non-string */
  function resolve(id) {
    if (typeof id !== 'string' || !id) return null;
    const data = BSU.data;
    const cat = data && data.catalog;
    const c = id.indexOf(':');
    // an id with its own registered family wins over the catalog lookup (levee/floodwall/canal/cypress/azalea are
    // both catalog rows and terrain/tree families; their building look is `icon:<id>` in sprites_buildings.js)
    if (c < 0) return (!painters[id] && cat && cat[id]) ? { family: 'building', sub: '', row: cat[id], rot: 0 } : { family: id, sub: '', row: (cat && cat[id]) || null, rot: 0 };
    const fam = id.slice(0, c), sub = id.slice(c + 1);
    if (cat && cat[fam] && sub === 'r') return { family: 'building', sub: 'r', row: cat[fam], rot: 1 };   // rotated footprint
    return { family: fam, sub: sub, row: (cat && cat[fam]) || null, rot: 0 };
  }
  M.resolve = resolve;

  /** frame count of an id (optionally variant-specific); ≥ 1 */
  M.frames = function (id, variant) {
    if (typeof id !== 'string') return 1;
    if (variant !== undefined && frameCounts[id + '|' + (variant | 0)]) return frameCounts[id + '|' + (variant | 0)];
    if (frameCounts[id]) return frameCounts[id];
    const r = resolve(id); if (!r) return 1;
    if (r.family === 'decal' && BSU.data && BSU.data.decals && BSU.data.decals[r.sub]) return Math.max(1, BSU.data.decals[r.sub].frames | 0);
    if (r.family === 'decal' && EXTRA_DECALS[r.sub]) return EXTRA_DECALS[r.sub].frames || 1;
    if (r.family === 'building') return frameCounts[r.row.id] || 1;
    if (FRAMES[id] !== undefined) return FRAMES[id];
    if (FRAMES[r.family + ':' + r.sub] !== undefined) return FRAMES[r.family + ':' + r.sub];
    if (FRAMES[r.family] !== undefined) return FRAMES[r.family];
    return 1;
  };
  /** painters (or tests) may declare frame counts explicitly */
  M.setFrames = function (id, n, variant) { if (typeof id === 'string' && n > 0) frameCounts[variant === undefined ? id : id + '|' + (variant | 0)] = n | 0; };

  /**
   * The atlas lookup. Returns {canvas, sx, sy, sw, sh, ox, oy} (device px at that zoom) or null.
   * Never throws: unknown family → null + one BSU.error per id; a painter that throws → the
   * key is cached as null (fails once, not every frame). zoom 0.5 → the 1× entry; 2 → 2× if ZOOM2.
   */
  M.get = function (id, variant, frame, zoom) {
    try {
      const r = resolve(id);
      if (!r) return null;
      variant = Number.isFinite(variant) ? Math.max(0, variant | 0) : 0;
      frame = Number.isFinite(frame) ? (frame | 0) : 0;
      const z = (zoom === 2 && M.ZOOM2) ? 2 : 1;
      const n = M.frames(id, variant);
      frame = n > 0 ? ((frame % n) + n) % n : 0;
      const key = id + '|' + variant + '|' + frame + '|' + z;
      let e = cache.get(key);
      if (e !== undefined) { if (e) e.used = frameNo; return e; }
      const fn = painters[r.family];
      if (!fn) {
        cache.set(key, null);
        if (!erroredIds.has(id) && !M._quiet) { erroredIds.add(id); try { BSU.error('sprites', 'get', new Error('unknown sprite family for id "' + id + '"')); } catch (err) { /* under SELFTEST BSU.error throws; get never does */ } }
        return null;
      }
      e = bake(r, id, variant, frame, z, key, fn);
      cache.set(key, e);
      return e;
    } catch (err) {
      try { BSU.error('sprites', 'get', err); } catch (e2) { /* never throw */ }
      return null;
    }
  };
  M.getCached = M.get;

  /** run a painter once for (id, variant, frame, zoom) and build the cache entry */
  function bake(r, id, variant, frame, z, key, fn) {
    const canvas = newCanvas(1, 1);
    const ctx = ctx2d(canvas);
    const spec = { id: id, family: r.family, sub: r.sub, variant: variant, frame: frame, zoom: z, row: r.row, rot: r.rot, seed: hash(strHash(id), variant), frames: 0 };
    let g;
    try { g = fn(ctx, spec); }
    catch (err) { try { BSU.error('sprites', 'paint:' + id, err); } catch (e2) { /* selfTest: rethrown by BSU.error only under SELFTEST... swallowed here */ } return null; }
    if (spec.frames > 0) M.setFrames(id, spec.frames, spec.framesPerVariant ? variant : undefined);
    if (!g || !Number.isFinite(g.w) || !Number.isFinite(g.h)) return null;
    const w = Math.max(1, Math.round(g.w)), h = Math.max(1, Math.round(g.h));
    const ox = Number.isFinite(g.ox) ? g.ox : -(w >> 1), oy = Number.isFinite(g.oy) ? g.oy : -(h >> 1);
    const cv = g.canvas || canvas;
    const e = {
      canvas: cv,
      sx: Number.isFinite(g.sx) ? g.sx : 0, sy: Number.isFinite(g.sy) ? g.sy : 0,
      sw: Number.isFinite(g.sw) ? g.sw : w * z, sh: Number.isFinite(g.sh) ? g.sh : h * z,
      ox: Math.round(ox * z), oy: Math.round(oy * z),
      w: w * z, h: h * z, zoom: z, id: id, variant: variant, frame: frame,
      own: !g.canvas, bytes: (g.canvas ? 0 : (cv.width | 0) * (cv.height | 0) * 4), lazy: !baking, used: frameNo
    };
    if (cv !== canvas) { try { canvas.width = 1; canvas.height = 1; } catch (err) { /* stub */ } }
    return e;
  }

  /** {w, h} of a sprite at that zoom without drawing it (paints on a miss); {w:0,h:0} when unknown */
  M.size = function (id, variant, zoom) { const e = M.get(id, variant, 0, zoom); return e ? { w: e.sw, h: e.sh } : { w: 0, h: 0 }; };

  /** live atlas canvas bytes / 2^20 (own canvases only; shared sheets count once through their owner) */
  M.memoryMB = function () { let b = 0; for (const e of cache.values()) if (e && e.own) b += e.bytes; return b / 1048576; };
  /** number of cached entries (nulls included) — for tests/debug */
  M.count = function () { return cache.size; };

  /** render calls gc(frameNo) every ~300 frames: above the budget, drop lazily built entries unused for GC_FRAMES */
  M.gc = function (frame) {
    frameNo = Number.isFinite(frame) ? (frame | 0) : frameNo + 1;
    if (M.memoryMB() <= M.CANVAS_LIMIT_MB) return 0;
    let dropped = 0;
    for (const [k, e] of cache) {
      if (!e || !e.lazy || frameNo - e.used < M.GC_FRAMES) continue;
      try { if (e.own) { e.canvas.width = 1; e.canvas.height = 1; } } catch (err) { /* stub */ }
      cache.delete(k); dropped++;
      if (M.memoryMB() <= M.CANVAS_LIMIT_MB) break;
    }
    return dropped;
  };
  /** drop every cached entry (tests / debug); painters stay registered */
  M.clear = function () { for (const e of cache.values()) { try { if (e && e.own) { e.canvas.width = 1; e.canvas.height = 1; } } catch (err) { /* stub */ } } cache.clear(); erroredIds.clear(); };

  // ---------------------------------------------------------------------------
  // Shared geometry for tile-anchored painters
  // ---------------------------------------------------------------------------
  /** a canvas that holds one diamond with `above` rows over it and `below` rows under it; returns cx, cy and the geometry */
  function tileCanvas(ctx, zoom, above, below) {
    above = above | 0; below = below | 0;
    const g = begin(ctx, TW, TH + above + below, zoom);
    return { w: g.w, h: g.h, ox: -(TW >> 1), oy: -(TH >> 1) - above, cx: TW >> 1, cy: (TH >> 1) + above, S: g.S };
  }
  /** row-wise inside test for the diamond centred at (cx, cy) */
  function inDiamond(x, y, cx, cy) { const r = y - (cy - (TH >> 1)); if (r < 0 || r >= TH) return false; const half = diamondHalf(TW, TH, r); return x >= cx - half && x < cx + half; }
  /** normalized distance 0 (centre) … 1 (edge) inside the diamond */
  function diamondDist(x, y, cx, cy) { return Math.abs(x + 0.5 - cx) / (TW / 2) + Math.abs(y + 0.5 - cy) / (TH / 2); }
  M.inDiamond = inDiamond; M.diamondDist = diamondDist;

  // Run directions in screen space per column step k (0..16) from the tile centre to the edge midpoints:
  // N (ty−1) is up-right, E (tx+1) down-right, S (ty+1) down-left, W (tx−1) up-left.
  const DIRS = [{ bit: 1, dx: 1, dy: -1 }, { bit: 2, dx: 1, dy: 1 }, { bit: 4, dx: -1, dy: 1 }, { bit: 8, dx: -1, dy: -1 }];
  M.DIRS = DIRS;
  const popcount4 = (m) => ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1));

  /**
   * Paint a run strip of vertical thickness t along every direction in `mask` (an isolated tile
   * draws N+S stubs of `stub` columns). colorFn(k, j, d, edge) → colour or null for column k
   * (0 at the centre … 16 at the edge), row j (0 top … t−1 bottom), direction d, edge = j is 0 or t−1.
   * The centre is a small diamond of the same thickness so runs join smoothly.
   */
  function strip(P, cx, cy, mask, t, colorFn, stub, yoff) {
    yoff = yoff | 0;
    const half = t >> 1;
    let dirs = DIRS.filter(d => mask & d.bit);
    let len = 16;
    if (!dirs.length) { dirs = [DIRS[0], DIRS[2]]; len = Number.isFinite(stub) ? stub : 8; }
    // centre diamond
    for (let j = 0; j < t; j++) {
      const hw = Math.max(1, Math.round(t * (1 - Math.abs(j + 0.5 - half) / half)));
      for (let x = -hw; x < hw; x++) { const c = colorFn(0, j, null, j === 0 || j === t - 1); if (c) P.px(cx + x, cy + yoff - half + j, c); }
    }
    for (const d of dirs) {
      for (let k = 1; k <= len; k++) {
        const x = cx + d.dx * k, y = cy + yoff + d.dy * (k >> 1) - half;
        for (let j = 0; j < t; j++) { const c = colorFn(k, j, d, j === 0 || j === t - 1); if (c) P.px(x, y + j, c); }
      }
    }
  }
  M.strip = strip;

  // ---------------------------------------------------------------------------
  // Ground tiles — family `tile`, id tile:<T>, variant 0–2 (hash), 64×32, ox −32 oy −16
  // ---------------------------------------------------------------------------
  const TILE_BRIGHT = [1.0, 0.96, 1.04];   // ±4% per variant
  function tileStyle(t, k) {
    const sh = (c) => shade(c, k);
    switch (t) {
      case T.OPEN_WATER: return { base: sh(PAL.waterDay), speck: sh(shade(PAL.waterDay, 1.08)), speckD: 0.06, dark: sh(shade(PAL.waterDay, 0.92)), darkD: 0.04, water: true };
      case T.BAYOU: return { base: sh(shade(PAL.waterDay, 0.9)), speck: sh(shade(PAL.waterDay, 1.0)), speckD: 0.05, dark: sh(shade(PAL.waterDay, 0.8)), darkD: 0.04, current: true, water: true };
      case T.MARSH: return { base: sh(mix(PAL.waterNight, PAL.mud, 0.5)), speck: sh(shade(PAL.reed, 0.8)), speckD: 0.35, dark: sh(shade(PAL.waterNight, 0.9)), darkD: 0.08, reeds: true, water: true, clumpy: true };
      case T.WET: return { base: sh(PAL.wetGround), speck: sh(PAL.mud), speckD: 0.15, dark: sh(shade(PAL.wetGround, 0.85)), darkD: 0.05, light: sh(shade(PAL.wetGround, 1.12)), lightD: 0.05, puddles: true };
      case T.DRY: return { base: sh(PAL.dryGrass), speck: sh(shade(PAL.dryGrass, 1.18)), speckD: 0.10, dark: sh(shade(PAL.dryGrass, 0.86)), darkD: 0.08, grass: true };
      case T.HIGH: return { base: sh(PAL.highGround), speck: sh(shade(PAL.highGround, 1.18)), speckD: 0.12, dark: sh(shade(PAL.highGround, 0.86)), darkD: 0.06, grass: true };
      case T.DRAINED: return { base: sh(mix(PAL.wetGround, PAL.mud, 0.4)), speck: sh(PAL.mud), speckD: 0.10, dark: sh(shade(PAL.mud, 0.8)), darkD: 0.04, cracks: true };
      case T.POND: return { base: sh(PAL.waterNight), speck: sh(shade(PAL.waterNight, 1.25)), speckD: 0.05, dark: sh(shade(PAL.waterNight, 0.85)), darkD: 0.05, water: true };
      default: return { base: sh(PAL.mud), speck: sh(shade(PAL.mud, 1.15)), speckD: 0.08, dark: sh(shade(PAL.mud, 0.85)), darkD: 0.05 };
    }
  }
  M.registerPainter('tile', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, 0, 0);
    const t = Math.max(0, Math.min(7, parseInt(spec.sub, 10) || 0));
    const v = spec.variant % 3;
    const st = tileStyle(t, TILE_BRIGHT[v]);
    const seed = hash(t * 7 + v, 0x51);
    const cx = g.cx, cy = g.cy, top = cy - 16;
    // base diamond
    P.diamond(cx, cy, TW, TH, st.base);
    // speckle / dither inside the diamond only
    for (let r = 1; r < TH; r++) {
      const half = diamondHalf(TW, TH, r);
      for (let x = cx - half; x < cx + half; x++) {
        const n = hash(seed, x + r * 131) % 1000;
        let dens = st.speckD * 1000;
        if (st.clumpy) { const c = hash(seed, (x >> 3) + (r >> 2) * 37) % 100; dens = c < 30 ? dens * 0.25 : c < 70 ? dens : dens * 1.6; }
        if (n < dens) P.px(x, top + r, (st.clumpy && (n % 5 === 0)) ? shade(PAL.reed, 1.05) : st.speck);
        else if (n > 1000 - st.darkD * 1000) P.px(x, top + r, st.dark);
        else if (st.light && n > 500 && n < 500 + st.lightD * 1000) P.px(x, top + r, st.light);
      }
    }
    // grass ticks (2-px verticals) on Dry/High
    if (st.grass) for (let i = 0; i < 14; i++) { const x = cx - 26 + (hash(seed, 900 + i) % 52), y = top + 4 + (hash(seed, 950 + i) % 24); if (inDiamond(x, y, cx, cy) && inDiamond(x, y + 1, cx, cy)) { P.px(x, y, st.speck); P.px(x, y + 1, shade(st.base, 0.9)); } }
    // marsh: reed clumps over the dark water + a couple of water glints
    if (st.reeds) for (let i = 0; i < 6; i++) {
      const x = cx - 24 + (hash(seed, 700 + i) % 48), y = top + 6 + (hash(seed, 750 + i) % 20);
      for (let k = 0; k < 3; k++) { const xx = x + k - 1, yy = y - (k === 1 ? 3 : 2); if (inDiamond(xx, yy, cx, cy) && inDiamond(xx, y, cx, cy)) P.vline(xx, yy, y - yy + 1, k === 1 ? shade(PAL.reed, 1.1) : shade(PAL.reed, 0.85)); }
      const gx = cx - 20 + (hash(seed, 800 + i) % 40), gy = top + 8 + (hash(seed, 850 + i) % 16);
      if (inDiamond(gx + 1, gy, cx, cy)) P.hline(gx, gy, 2, shade(PAL.shallows, 0.8));
    }
    // wet ground: 2 small puddle glints
    if (st.puddles) for (let i = 0; i < 3; i++) { const x = cx - 18 + (hash(seed, 600 + i) % 36), y = top + 8 + (hash(seed, 650 + i) % 16); if (inDiamond(x, y, cx, cy) && inDiamond(x + 3, y, cx, cy)) { P.hline(x, y, 4, mix(PAL.wetGround, PAL.shallows, 0.45)); P.hline(x + 1, y + 1, 2, mix(PAL.wetGround, PAL.shallows, 0.25)); } }
    // drained marsh: cracked 1-px lines
    if (st.cracks) for (let i = 0; i < 4; i++) {
      let x = cx - 16 + (hash(seed, 500 + i) % 32), y = top + 6 + (hash(seed, 550 + i) % 20);
      for (let k = 0; k < 9; k++) { if (inDiamond(x, y, cx, cy)) P.px(x, y, shade(PAL.mud, 0.62)); x += (hash(seed, 570 + i * 16 + k) % 3) - 1 + (i & 1 ? 1 : -1); y += (hash(seed, 580 + i * 16 + k) % 2); }
    }
    // bayou: 1-px lighter current line along the channel direction (the bayou runs roughly N–S: up-right/down-left)
    if (st.current) for (let k = -14; k <= 14; k++) { const x = cx + k, y = cy - (k >> 1) + ((hash(seed, 400 + k) % 3) - 1); if (inDiamond(x, y, cx, cy)) P.px(x, y, shade(PAL.waterDay, 1.22)); }
    // edge: a 1-px lighter NW/NE rim (light from the upper left) and a darker SW/SE rim so tiles read as facets
    if (!st.water) for (let r = 1; r < TH; r++) { const half = diamondHalf(TW, TH, r); if (half <= 0) continue; if (r < 16) { P.px(cx - half, top + r, shade(st.base, 1.08)); } else { P.px(cx + half - 1, top + r, shade(st.base, 0.9)); } }
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });

  // ---------------------------------------------------------------------------
  // cliff — variant = face height in px (6…96), frame 0 = south face (under the SW edge), 1 = east face (SE edge)
  // canvas 32 × (16 + h); anchor = the tile centre (ox −32 south / 0 east, oy 0)
  // ---------------------------------------------------------------------------
  M.registerPainter('cliff', function (ctx, spec) {
    const hgt = Math.max(6, Math.min(96, spec.variant || 6));
    const east = (spec.frame % 2) === 1;
    const P = pen(ctx, spec.zoom);
    const g = begin(ctx, 32, 16 + hgt, spec.zoom);
    const seed = hash(hgt, east ? 3 : 5);
    const base = east ? shade(PAL.mud, 0.95) : shade(PAL.mud, 0.8);       // the east face catches a little more light
    for (let c = 0; c < 32; c++) {
      const topY = east ? 16 - (c >> 1) - 1 : (c >> 1);   // the edge slope (2:1)
      const t0 = Math.max(0, topY);
      for (let y = 0; y < hgt; y++) {
        const yy = t0 + y; if (yy >= g.h) break;
        let col = base;
        const n = hash(seed, c + y * 97) % 100;
        if (y === 0) col = shade(PAL.highGround, 0.7);                              // grass lip
        else if (y === 1) col = shade(PAL.mud, 1.25);                                // lit rim
        else if ((y + (c >> 3)) % 4 === 0) col = (n < 50) ? shade(PAL.bark, 1.1) : shade(base, 0.85);   // strata every 4 px
        else if (n < 8) col = shade(base, 1.15);
        else if (n > 92) col = shade(base, 0.8);
        if (y >= hgt - 2) col = shade(base, 0.62);                                  // darker bottom
        P.px(c, yy, col);
      }
    }
    // a few small root/stone nubs
    for (let i = 0; i < 4; i++) { const c = 2 + (hash(seed, 300 + i) % 28), y = 4 + (hash(seed, 350 + i) % Math.max(1, hgt - 8)); const top = (east ? 16 - (c >> 1) - 1 : (c >> 1)) + y; P.hline(c, top, 2, shade(PAL.bark, 0.8)); P.px(c, top - 1, shade(PAL.bark, 1.3)); }
    return { w: g.w, h: g.h, ox: east ? 0 : -32, oy: 0 };
  });

  // ---------------------------------------------------------------------------
  // reeds (12×14, variants 0–2, 2 sway frames), knees (12×5), worn (64×32 overlay), mound (24×14)
  // ---------------------------------------------------------------------------
  M.registerPainter('reeds', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = begin(ctx, 12, 14, spec.zoom);
    const v = spec.variant % 3, f = spec.frame % 2, seed = hash(0x2ee, v);
    const n = 5 + (hash(seed, 1) % 3);
    for (let i = 0; i < n; i++) {
      const x0 = 2 + (hash(seed, 10 + i) % 8), len = 7 + (hash(seed, 20 + i) % 7);
      const lean = ((hash(seed, 30 + i) % 3) - 1) + f;   // frame 1 leans one more px to the right
      const col = (i & 1) ? PAL.reed : shade(PAL.reed, 0.8);
      for (let k = 0; k < len; k++) { const y = 13 - k, x = x0 + Math.round(lean * k / len); if (x >= 0 && x < 12 && y >= 0) P.px(x, y, k === len - 1 ? shade(PAL.reed, 1.2) : col); }
    }
    // seed heads on two stalks
    for (let i = 0; i < 2; i++) { const x = 3 + (hash(seed, 40 + i) % 6), y = 1 + (hash(seed, 50 + i) % 3); P.vline(x + f, y, 2, shade(PAL.gravel, 0.8)); }
    return { w: g.w, h: g.h, ox: -6, oy: -13 };
  });
  M.registerPainter('knees', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = begin(ctx, 12, 5, spec.zoom);
    const v = spec.variant % 3, seed = hash(0x4ee, v);
    const n = 2 + (hash(seed, 1) % 3);
    for (let i = 0; i < n; i++) { const x = (hash(seed, 10 + i) % 10), h = 2 + (hash(seed, 20 + i) % 3); P.rect(x, 5 - h, 2, h, PAL.bark); P.px(x, 5 - h, shade(PAL.bark, 1.5)); P.px(x + 1, 4, shade(PAL.bark, 0.7)); }
    return { w: g.w, h: g.h, ox: -6, oy: -4 };
  });
  M.registerPainter('worn', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, 0, 0);
    const v = spec.variant % 3, seed = hash(0x0e0, v);
    for (let r = 1; r < TH; r++) { const half = diamondHalf(TW, TH, r); for (let x = g.cx - half; x < g.cx + half; x++) { const d = diamondDist(x, g.cy - 16 + r, g.cx, g.cy); const dens = 0.4 * Math.max(0, 1 - d * d); const n = hash(seed, x + r * 131) % 1000; if (n < dens * 1000) P.px(x, g.cy - 16 + r, (n & 1) ? PAL.gravel : shade(PAL.gravel, 0.85)); } }
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });
  M.registerPainter('mound', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = begin(ctx, 24, 14, spec.zoom);
    const seed = hash(0x0d, spec.variant);
    for (let y = 0; y < 14; y++) {
      const k = 1 - ((13 - y) / 13) * ((13 - y) / 13); const half = Math.round(Math.sqrt(Math.max(0, k)) * 12); if (half <= 0) continue;
      for (let x = 12 - half; x < 12 + half; x++) {
        const edge = (x === 12 - half || x === 12 + half - 1);
        let col = PAL.highGround; const n = hash(seed, x + y * 31) % 100;
        if (x < 10 && y < 9) col = shade(PAL.highGround, 1.12); else if (x > 14 && y > 5) col = shade(PAL.highGround, 0.86);
        if (n < 10) col = shade(col, 1.12); else if (n > 92) col = shade(col, 0.88);
        P.px(x, y, edge ? PAL.bark : col);
      }
    }
    P.hline(1, 13, 22, PAL.bark);
    // worn gravel top
    P.ellipse(12, 3, 5, 2, PAL.gravel); P.ellipse(12, 3, 3, 1, shade(PAL.gravel, 1.1)); P.hline(9, 5, 7, shade(PAL.gravel, 0.8));
    return { w: g.w, h: g.h, ox: -12, oy: -20 };
  });

  // ---------------------------------------------------------------------------
  // Surfaces — family `surf`, id surf:<1..4>, variant = 4-neighbour mask (N1 E2 S4 W8) | 16 bridge | 32 sign | 64 culvert
  // canvas 64×48, ox −32, oy −24 (8 rows above for signs/railings, 8 below for piers/posts)
  // ---------------------------------------------------------------------------
  const SURF_ABOVE = 8, SURF_BELOW = 8;
  function culvertPipes(P, cx, cy) {
    // two 4-px dark pipe openings at the diamond's lower edges (S and E edge midpoints)
    for (const sx of [-1, 1]) { const x = cx + sx * 14 - 2, y = cy + 6; P.rect(x, y, 4, 4, X.steelDark); P.rect(x + 1, y + 1, 2, 2, X.black); P.hline(x, y + 4, 4, shade(X.steelDark, 0.7)); }
  }
  function bridgeUnder(P, cx, cy, mask, t) {
    // concrete piers under the S/E edges of the run, 4×8 with a darker side
    const dirs = DIRS.filter(d => (mask & d.bit) && d.dy > 0);
    for (const d of (dirs.length ? dirs : [DIRS[1], DIRS[2]])) { const x = cx + d.dx * 11 - 2, y = cy + 5 + (t >> 1); P.rect(x, y, 4, 8, X.concrete); P.vline(x + 3, y, 8, shade(X.concrete, 0.7)); P.hline(x, y + 7, 4, shade(X.concrete, 0.6)); }
  }
  function fenceSign(P, cx, cy) {
    P.vline(cx, cy - 16, 12, PAL.bark);
    P.rect(cx - 5, cy - 19, 10, 6, PAL.gold); P.rect(cx - 5, cy - 19, 10, 1, PAL.goldHi); P.rect(cx - 5, cy - 14, 10, 1, PAL.goldShadow);
    // "GATOR X-ING" is 11 glyphs: too wide for a 10-px plate, so the sign carries a gator silhouette + a cross mark (pixel marks, no text)
    P.hline(cx - 3, cy - 16, 6, X.black); P.px(cx - 4, cy - 17, X.black); P.px(cx + 2, cy - 17, X.black); P.px(cx + 3, cy - 15, X.black);
  }
  M.registerPainter('surf', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, SURF_ABOVE, SURF_BELOW);
    const kind = Math.max(1, Math.min(4, parseInt(spec.sub, 10) || 1));
    const v = spec.variant, mask = v & 15, bridge = !!(v & 16), sign = !!(v & 32), culvert = !!(v & 64);
    const cx = g.cx, cy = g.cy, seed = hash(kind * 131 + v, 0x5f);
    if (kind === BSU.SURF.PATH) {
      const t = 10;
      strip(P, cx, cy, mask, t, (k, j, d, edge) => {
        const n = hash(seed, k + j * 17 + (d ? d.bit * 100 : 0)) % 100;
        if (edge) return (n < 55) ? shade(PAL.gravel, 0.8) : PAL.gravel;
        return n < 12 ? shade(PAL.gravel, 1.08) : n > 90 ? shade(PAL.gravel, 0.9) : PAL.gravel;
      });
    } else if (kind === BSU.SURF.ROAD) {
      const t = 14;
      if (bridge) bridgeUnder(P, cx, cy, mask, t);
      strip(P, cx, cy, mask, t, (k, j, d, edge) => {
        if (edge) return shade(PAL.asphalt, 1.3);                       // curbs
        if (j === (t >> 1) && k > 0 && (k % 6) < 2) return PAL.gold;    // centre dashes 2×1 every 6 px
        const n = hash(seed, k + j * 17 + (d ? d.bit * 100 : 0)) % 100;
        return n < 6 ? shade(PAL.asphalt, 1.12) : n > 95 ? shade(PAL.asphalt, 0.88) : PAL.asphalt;
      });
      if (bridge) {
        // purple 2-px railings along both edges of the run, 6 px above the deck, 1-px posts every 8 px
        const dirs = DIRS.filter(d => mask & d.bit); const list = dirs.length ? dirs : [DIRS[0], DIRS[2]];
        for (const d of list) for (let k = 0; k <= 16; k++) { const x = cx + d.dx * k, yTop = cy + d.dy * (k >> 1) - (t >> 1); P.rect(x, yTop - 6, 1, 2, PAL.purple); P.rect(x, yTop + t - 7, 1, 2, PAL.purple2); if (k % 8 === 0) { P.vline(x, yTop - 4, 4, PAL.purpleShadow); P.vline(x, yTop + t - 5, 4, PAL.purpleShadow); } }
      }
    } else if (kind === BSU.SURF.BOARDWALK) {
      const t = 12;
      // posts under the lower boundary of the run every 8 px + 1-px shadow
      const dirs = DIRS.filter(d => mask & d.bit); const list = dirs.length ? dirs : [DIRS[0], DIRS[2]];
      for (const d of list) for (let k = 2; k <= 16; k += 7) { const x = cx + d.dx * k, y = cy + d.dy * (k >> 1) + (t >> 1); P.rect(x, y, 2, 3, PAL.bark); P.hline(x - 1, y + 3, 4, shade(PAL.waterNight, 0.8)); }
      strip(P, cx, cy, mask, t, (k, j, d, edge) => {
        if (k % 3 === 2) return shade(PAL.boardwalk, 0.7);              // 1-px gaps between 2-px planks (across the run)
        if (edge) return shade(PAL.boardwalk, 0.8);
        const n = hash(seed, k + j * 17 + (d ? d.bit * 100 : 0)) % 100;
        return n < 10 ? shade(PAL.boardwalk, 1.12) : PAL.boardwalk;
      });
    } else {
      // gator fence: posts every 8 px along the run, chain-link dither between, drawn at the tile's centre line
      const t = 1;
      const dirs = DIRS.filter(d => mask & d.bit); const list = dirs.length ? dirs : [DIRS[0], DIRS[2]];
      const len = dirs.length ? 16 : 8;
      const post = (x, y) => { P.vline(x, y - 8, 8, shade(PAL.gold, 0.8)); P.px(x, y - 8, PAL.goldHi); P.px(x, y, PAL.goldShadow); };
      for (const d of list) for (let k = 1; k <= len; k++) { const x = cx + d.dx * k, y = cy + d.dy * (k >> 1); for (let j = 1; j <= 6; j++) if (((k + j) & 1) || (hash(seed, k * 7 + j + d.bit * 50) % 3 === 0)) P.px(x, y - j, (j === 6) ? shade(X.chain, 1.3) : ((k + j) & 1) ? X.chain : shade(X.chain, 0.7)); P.px(x, y, shade(PAL.dryGrass, 0.7)); if (k % 8 === 0) post(x, y); }
      post(cx, cy);
      if (sign) fenceSign(P, cx, cy);
      void t;
    }
    if (culvert) culvertPipes(P, cx, cy);
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });

  // ---------------------------------------------------------------------------
  // levee — variant = mask | 16 cracked crown; a grassy berm rising 12 px over the diamond with a gravel crown path
  // canvas 64×48, ox −32, oy −28 (12 rows above the diamond, 4 below for the toe)
  // ---------------------------------------------------------------------------
  M.registerPainter('levee', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const RISE = 12, TOE = 4;
    const g = tileCanvas(ctx, spec.zoom, RISE, TOE);
    const v = spec.variant, mask = v & 15, cracked = !!(v & 16);
    const cx = g.cx, cy = g.cy, seed = hash(0x1e, v);
    const t = 22;                       // full berm footprint thickness (crown + front slope)
    const crownT = 10;                  // the flat crown band
    strip(P, cx, cy, mask, t, (k, j, d, edge) => {
      const n = hash(seed, k + j * 17 + (d ? d.bit * 100 : 0)) % 100;
      if (j === 0) return shade(PAL.dryGrass, 1.25);                                          // lit back edge of the crown
      if (j < crownT) {
        if (j >= 3 && j <= 5) { if (cracked && n < 22) return shade(PAL.bark, 0.8); return n < 20 ? shade(PAL.gravel, 0.85) : PAL.gravel; }   // 6-px-wide gravel crown path
        return n < 10 ? shade(PAL.dryGrass, 1.12) : n > 92 ? shade(PAL.dryGrass, 0.9) : PAL.dryGrass;
      }
      if (j === crownT) return shade(PAL.dryGrass, 0.7);                                       // the crown's front lip
      if (j >= t - TOE) return n < 30 ? shade(PAL.dryGrass, 0.68) : shade(PAL.dryGrass, 0.75);  // darker toe band
      return n < 8 ? shade(PAL.dryGrass, 0.95) : shade(PAL.dryGrass, 0.85);                    // front slope
    }, 8, -(RISE - (t >> 1)) + 2);
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });

  // ---------------------------------------------------------------------------
  // floodwall — variant = mask; gray T-wall panels 18 px high with joints every 8 px, purple 1-ft gauge stripes + gold ticks
  // canvas 64×56, ox −32, oy −36
  // ---------------------------------------------------------------------------
  M.registerPainter('floodwall', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const RISE = 18 + 2, g = tileCanvas(ctx, spec.zoom, RISE, 2);
    const mask = spec.variant & 15;
    const cx = g.cx, cy = g.cy, seed = hash(0xf1, spec.variant);
    const cap = 4, face = 18, t = cap + face + 2;    // cap + face + footing
    strip(P, cx, cy, mask, t, (k, j, d, edge) => {
      const n = hash(seed, k + j * 17 + (d ? d.bit * 100 : 0)) % 100;
      if (j === 0) return shade(X.steel, 1.35);                                   // lit top edge
      if (j < cap) return shade(X.steel, 1.15);                                   // the cap (top of the T)
      if (j === cap) return shade(X.steel, 0.7);                                  // cap underside
      const fy = j - cap - 1;                                                     // 0..face-1 down the visible face
      if (j >= t - 2) return j === t - 1 ? shade(X.steel, 0.5) : shade(X.concrete, 0.85);   // footing
      if (k > 0 && k % 8 === 0) return shade(X.steel, 0.8);                       // panel joints
      const fromBase = face - 1 - fy;
      if (fromBase > 0 && fromBase % PX_PER_FT === 0) return (k % 8 === 1) ? PAL.gold : PAL.purple;   // 1-ft gauge stripes, gold tick beside each joint
      return n < 6 ? shade(X.steel, 1.08) : n > 94 ? shade(X.steel, 0.92) : X.steel;
    }, 8, -(RISE - (t >> 1)) + 1);
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });

  // ---------------------------------------------------------------------------
  // canal — variant = mask | 16 culvert | 32 gate present | 64 gate closed; a 24-px cut with concrete lips and a dark bed
  // canvas 64×32, ox −32, oy −16
  // ---------------------------------------------------------------------------
  M.registerPainter('canal', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, 0, 0);
    const v = spec.variant, mask = v & 15, culvert = !!(v & 16), gate = !!(v & 32), closed = !!(v & 64);
    const cx = g.cx, cy = g.cy, seed = hash(0xca, v);
    const t = 12;
    strip(P, cx, cy, mask, t, (k, j, d, edge) => {
      if (edge) return X.concrete;                                                // 1-px concrete lips
      if (j === 1) return shade(PAL.waterNight, 0.7);                              // the near bank's shadow on the water
      const n = hash(seed, k + j * 17 + (d ? d.bit * 100 : 0)) % 100;
      if (j === (t >> 1) && n < 45) return shade(PAL.waterNight, 1.3);            // reflective mid line
      return n < 8 ? shade(PAL.waterNight, 1.12) : PAL.waterNight;
    }, 8);
    if (culvert || popcount4(mask) >= 3) culvertPipes(P, cx, cy);
    if (gate) {
      const gy = closed ? cy - 5 : cy - 11;    // raised 6 px above the bed when open
      P.vline(cx - 7, cy - 12, 14, PAL.goldShadow); P.vline(cx + 6, cy - 12, 14, PAL.goldShadow);   // guide posts
      P.rect(cx - 6, gy, 12, 10, PAL.purple); P.rect(cx - 6, gy, 12, 1, PAL.purpleHi); P.vline(cx - 6, gy, 10, PAL.purpleHi); P.rect(cx - 6, gy + 9, 12, 1, PAL.purpleShadow);
      P.rect(cx - 4, gy + 3, 8, 1, PAL.purpleShadow); P.rect(cx - 4, gy + 6, 8, 1, PAL.purpleShadow);
      if (closed) P.rect(cx - 6, gy, 12, 1, PAL.gold);
    }
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });

  // ---------------------------------------------------------------------------
  // preservePost — variant = mask of NON-preserve neighbours (the boundary edges): gold 2×5 posts along each boundary edge
  // ---------------------------------------------------------------------------
  M.registerPainter('preservePost', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, 4, 0);
    const mask = spec.variant & 15, cx = g.cx, cy = g.cy;
    for (const d of DIRS) {
      if (!(mask & d.bit)) continue;
      // the edge from the top/bottom vertex toward the left/right vertex, 2 px inside
      for (const f of [0.25, 0.5, 0.75]) {
        const ex = cx + d.dx * Math.round(32 * f) - d.dx * 3, ey = cy + d.dy * (16 - Math.round(16 * f)) - d.dy * 2;
        P.rect(ex, ey - 4, 2, 5, PAL.gold); P.px(ex, ey - 4, PAL.goldHi); P.hline(ex, ey + 1, 2, PAL.goldShadow);
      }
    }
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });

  // ---------------------------------------------------------------------------
  // water — variant 0: the static highlight for the 0.5× baked layer; variant 1: the surge tint with debris flecks
  // ---------------------------------------------------------------------------
  M.registerPainter('water', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, 0, 0);
    const cx = g.cx, cy = g.cy, seed = hash(0x0a7, spec.variant);
    if ((spec.variant & 1) === 0) {
      for (let x = cx - 32; x < cx + 32; x++) {
        const y1 = cy - 5 + Math.round(2 * Math.sin((x * Math.PI * 2) / 16)), y2 = cy + 5 + Math.round(2 * Math.sin(((x + 8) * Math.PI * 2) / 16));
        if (inDiamond(x, y1, cx, cy)) P.px(x, y1, PAL.shallows);
        if (inDiamond(x, y2, cx, cy)) P.px(x, y2, shade(PAL.shallows, 0.9));
      }
      for (let i = 0; i < 3; i++) { const x = cx - 20 + (hash(seed, 10 + i) % 40), y = cy - 8 + (hash(seed, 20 + i) % 16); if (inDiamond(x, y, cx, cy)) { P.px(x, y, X.white); P.px(x + 1, y, PAL.goldHi); } }
    } else {
      P.diamond(cx, cy, TW, TH, shade(PAL.waterNight, 0.8));
      for (let i = 0; i < 4; i++) { const x = cx - 20 + (hash(seed, 30 + i) % 40), y = cy - 8 + (hash(seed, 40 + i) % 16); if (inDiamond(x, y, cx, cy) && inDiamond(x + 2, y, cx, cy)) { P.hline(x, y, 3, X.debris); P.px(x + 1, y - 1, shade(X.debris, 1.3)); } }
      for (let x = cx - 28; x < cx + 28; x += 2) { const y = cy + Math.round(1.5 * Math.sin((x * Math.PI * 2) / 20)); if (inDiamond(x, y, cx, cy)) P.px(x, y, shade(PAL.waterNight, 1.15)); }
    }
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });

  // ---------------------------------------------------------------------------
  // Decals — family `decal`, id decal:<name>; size/frames from data.decals, plus the brief's extras below.
  // Each painter: fn(P, w, h, f, seed) draws into the w×h canvas (1× units). Anchor: 'ground' → bottom-centre
  // (ox −w/2, oy −h + 4), 'roof'/'side' → centre.
  // ---------------------------------------------------------------------------
  const EXTRA_DECALS = {
    sinking: { w: 12, h: 12, anchor: 'roof', frames: 1 }, noAccess: { w: 12, h: 12, anchor: 'roof', frames: 1 },
    power: { w: 12, h: 12, anchor: 'roof', frames: 1 }, water: { w: 12, h: 12, anchor: 'roof', frames: 1 },
    sandbags: { w: 16, h: 6, anchor: 'ground', frames: 1 },
    debris: { w: 32, h: 14, anchor: 'ground', frames: 4 }   // storm debris on DEBRIS-flagged tiles (render chunk bake, frame = tile hash & 3)
  };
  M.EXTRA_DECALS = EXTRA_DECALS;
  const gray3 = (P, x, y, w, h, c) => { P.rect(x, y, w, h, c); P.hline(x, y, w, light(c)); P.vline(x, y, h, light(c)); P.hline(x, y + h - 1, w, dark(c)); P.vline(x + w - 1, y, h, dark(c)); };   // a bevelled box
  const box = gray3;
  const DECALS = {
    clock(P, w, h) { P.ellipse(5, 5, 5, 5, PAL.goldShadow); P.ellipse(5, 5, 4, 4, PAL.gold); P.ellipse(4, 4, 2, 2, PAL.goldHi); P.rect(5, 2, 1, 3, X.black); P.rect(5, 5, 3, 1, X.black); P.px(5, 5, X.black); },
    columns(P, w, h) { P.hline(0, h - 2, w, X.offWhite); P.hline(0, h - 1, w, shade(X.offWhite, 0.7)); for (let i = 0; i < 4; i++) { const x = 3 + i * 11; P.rect(x, 2, 2, h - 4, X.white); P.vline(x + 1, 2, h - 4, shade(X.white, 0.8)); P.hline(x - 1, 1, 4, X.white); P.hline(x - 1, h - 3, 4, shade(X.white, 0.85)); } P.hline(0, 0, w, PAL.creamStone); },
    arcade(P, w, h) { P.rect(0, 0, w, h, shade(PAL.tanStucco, 0.7)); for (let i = 0; i < 4; i++) { const x = 2 + i * 12; P.rect(x, 4, 8, h - 4, shade(PAL.tanStucco, 0.45)); P.hline(x + 1, 3, 6, shade(PAL.tanStucco, 0.45)); P.hline(x + 2, 2, 4, shade(PAL.tanStucco, 0.45)); P.rect(x - 2, 0, 2, h, PAL.creamStone); P.vline(x - 1, 0, h, shade(PAL.creamStone, 0.85)); } P.rect(w - 2, 0, 2, h, PAL.creamStone); },
    awning(P, w, h) { for (let x = 0; x < w; x++) P.rect(x, 1, 1, h - 2, ((x >> 1) & 1) ? PAL.purple : PAL.gold); P.hline(0, 0, w, PAL.purpleHi); P.hline(0, h - 1, w, PAL.purpleShadow); for (let x = 1; x < w; x += 4) P.px(x, h - 1, PAL.gold); },
    sign(P, w, h) { P.vline(6, 4, 4, PAL.bark); P.rect(0, 0, w, 5, PAL.gold); P.hline(0, 0, w, PAL.goldHi); P.hline(0, 4, w, PAL.goldShadow); P.hline(2, 2, 3, PAL.purple); P.hline(6, 2, 2, PAL.purple); P.hline(9, 2, 3, PAL.purple); },
    vents(P, w, h, f) { for (let i = 0; i < 3; i++) { const x = i * 4, lift = (f && i === 1) ? 1 : 0; box(P, x, 1 - lift, 3, 4, X.steel); P.px(x + 1, 0 - lift + 1, X.steelDark); } },
    tank(P, w, h) { P.rect(1, 2, w - 2, h - 5, X.concrete); P.vline(1, 2, h - 5, shade(X.concrete, 1.15)); P.rect(w - 3, 2, 2, h - 5, shade(X.concrete, 0.7)); P.ellipse(6, 2, 5, 1.5, shade(X.concrete, 1.2)); P.hline(2, 6, w - 4, PAL.purple); P.rect(3, h - 3, 2, 3, X.steelDark); P.rect(w - 5, h - 3, 2, 3, X.steelDark); },
    masts(P, w, h, f) { P.rect(2, 4, 2, h - 4, X.steel); P.vline(2, 4, h - 4, light(X.steel)); P.rect(0, 0, 6, 3, f ? PAL.goldHi : X.steelDark); if (f) { P.hline(0, 0, 6, X.white); } P.hline(0, 3, 6, X.steelShadow); },
    stilts(P, w, h) { for (let x = 0; x < w; x += 12) { P.rect(x + 1, 2, 3, 10, PAL.bark); P.vline(x + 1, 2, 10, light(PAL.bark)); P.vline(x + 3, 2, 10, dark(PAL.bark)); P.hline(x + 1, 0, 3, shade(PAL.bark, 0.6)); } },
    scaffold(P, w, h) { for (let x = 0; x < w; x += 8) P.vline(x, 0, h, X.scaffold); for (let y = 0; y < h; y += 8) P.hline(0, y, w, X.scaffold); for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) P.line(x, y + 7, x + 7, y, shade(X.scaffold, 0.8)); P.hline(0, h - 1, w, shade(X.scaffold, 0.7)); },
    tarp(P, w, h, f, seed) { P.rect(0, 0, w, h, X.tarp); P.hline(0, 0, w, shade(X.tarp, 1.25)); P.vline(0, 0, h, shade(X.tarp, 1.15)); P.hline(0, h - 1, w, X.tarpCrease); for (let i = 0; i < 4; i++) { const x = 3 + i * 6; P.line(x, 1, x + 3, h - 2, X.tarpCrease); } for (let x = 1; x < w; x += 5) P.px(x, h - 2, X.black); },
    boilpot(P, w, h) { P.rect(2, h - 3, 6, 1, X.ember); P.rect(1, h - 2, 8, 1, X.flame); P.px(3, h - 4, X.flame); P.px(6, h - 4, X.ember); P.rect(1, 2, 8, 5, X.black); P.rect(0, 2, w, 1, shade(X.black, 2.2)); P.hline(2, 1, 6, shade(X.black, 1.8)); P.vline(0, 3, 2, X.steel); P.vline(9, 3, 2, X.steel); P.hline(3, 0, 4, X.steel); },
    dumpster(P, w, h) { P.rect(1, 2, w - 2, h - 3, X.dumpster); P.vline(1, 2, h - 3, light(X.dumpster)); P.vline(w - 2, 2, h - 3, dark(X.dumpster)); P.hline(0, 1, w, PAL.gold); P.hline(0, 0, w, PAL.goldHi); P.rect(2, h - 1, 2, 1, X.black); P.rect(w - 4, h - 1, 2, 1, X.black); },
    cars(P, w, h, f) { const c = [PAL.purple, PAL.gold, X.offWhite][f % 3]; P.rect(1, 1, 6, 3, c); P.rect(2, 0, 4, 1, shade(c, 0.85)); P.hline(2, 1, 4, X.glass); P.px(0, 2, shade(c, 0.7)); P.px(7, 2, shade(c, 0.7)); P.px(1, 4, X.black); P.px(6, 4, X.black); },
    pool(P, w, h, f, seed) { P.ellipse(20, 10, 20, 10, X.concrete); P.ellipse(20, 10, 18, 8, PAL.waterBlue); P.ellipse(20, 10, 16, 6, shade(PAL.waterBlue, 1.08)); P.hline(4, 10, 32, PAL.gold); for (let i = 0; i < 8; i++) { const x = 6 + (hash(seed + f, i) % 28), y = 5 + (hash(seed + f, 20 + i) % 10); P.hline(x, y, 2, shade(PAL.waterBlue, 1.35)); } },
    dome(P, w, h) { P.ellipse(12, 13, 12, 12, PAL.goldShadow); P.ellipse(12, 13, 11, 11, PAL.gold); P.ellipse(9, 11, 5, 5, PAL.goldHi); P.rect(0, 13, w, 1, PAL.goldShadow); P.px(12, 0, PAL.goldHi); P.vline(12, 1, 2, PAL.gold); },
    dish(P, w, h, f) { P.rect(5, 6, 2, 4, X.steelDark); if (f) { P.ellipse(6, 4, 5, 3, X.steel); P.ellipse(6, 4, 3, 1.5, light(X.steel)); P.px(6, 1, X.black); } else { P.ellipse(5, 4, 3, 4, X.steel); P.ellipse(5, 4, 1.5, 2.5, light(X.steel)); P.px(9, 3, X.black); } },
    pipes(P, w, h) { P.rect(0, 0, w, h, X.steel); P.hline(0, 2, w, PAL.gold); P.hline(0, 1, w, PAL.goldHi); P.hline(0, 3, w, PAL.goldShadow); P.rect(6, 3, 2, 5, PAL.gold); P.rect(20, 3, 2, 5, PAL.gold); P.hline(6, 3, 2, PAL.goldShadow); P.hline(20, 3, 2, PAL.goldShadow); P.rect(12, 5, 8, 2, PAL.gold); P.hline(12, 6, 8, PAL.goldShadow); },
    impeller(P, w, h, f) { P.ellipse(6, 6, 6, 6, X.steelDark); P.ellipse(6, 6, 5, 5, X.steel); if (f) { P.line(2, 2, 10, 10, PAL.gold); P.line(2, 10, 10, 2, PAL.gold); } else { P.hline(1, 6, 11, PAL.gold); P.vline(6, 1, 11, PAL.gold); } P.px(6, 6, X.black); },
    fountain(P, w, h, f) { P.ellipse(8, 9, 8, 3, X.concrete); P.ellipse(8, 9, 6, 2, PAL.waterBlue); P.rect(7, 4, 2, 5, X.concrete); for (let i = -2; i <= 2; i++) { const y = 3 - Math.abs(i) + (f === 1 ? 1 : f === 2 ? -1 : 0); P.px(8 + i * 2, y < 0 ? 0 : y, X.white); P.px(8 + i, 1 + (f % 2), shade(PAL.waterBlue, 1.5)); } },
    reeds(P, w, h, f, seed) { for (let i = 0; i < 6; i++) { const x = 1 + (hash(seed, i) % 10), len = 5 + (hash(seed, 10 + i) % 5); for (let k = 0; k < len; k++) P.px(x + (k > 3 ? f : 0), h - 1 - k, (i & 1) ? PAL.reed : shade(PAL.reed, 0.8)); P.px(x + f, h - 1 - len, shade(PAL.reed, 1.2)); } },
    flag(P, w, h, f) { P.vline(0, 0, h, X.steel); P.px(0, 0, PAL.gold); const wave = [0, 1, 0][f % 3]; for (let x = 1; x < 8; x++) { const dy = (x > 4 ? wave : 0); P.rect(x, 1 + dy, 1, 5, PAL.purple); } P.rect(2, 3, 2, 1, PAL.gold); P.px(3, 2, PAL.gold); P.px(3, 4, PAL.gold); P.hline(1, 1, 3, PAL.purpleHi); },
    banner(P, w, h) { P.rect(0, 0, w, h - 2, PAL.purple); P.hline(0, 0, w, PAL.purpleHi); for (let x = 0; x < w; x += 4) { P.px(x, h - 2, PAL.purple); P.px(x + 1, h - 2, PAL.purple); P.px(x, h - 1, PAL.purpleShadow); } P.hline(3, 3, 6, PAL.gold); P.hline(11, 3, 6, PAL.gold); P.hline(19, 3, 6, PAL.gold); },
    lights(P, w, h, f) { P.hline(0, 0, w, X.black); P.rect(1, 1, 2, 2, f ? PAL.goldHi : PAL.goldShadow); P.px(1, 1, f ? X.white : PAL.gold); },
    letters(P, w, h) { P.text('CAULDRON', 0, 1, PAL.gold); for (let x = 0; x < w; x++) for (let y = 1; y < 6; y++) { /* drop shadow */ } P.hline(0, 7, w, PAL.goldShadow); },
    gourds(P, w, h) { P.vline(5, 0, h, PAL.bark); for (let i = 0; i < 6; i++) { const x = [0, 4, 8, 1, 6, 3][i], y = [2, 1, 3, 7, 6, 10][i]; P.rect(x, y, 3, 3, X.offWhite); P.px(x, y, X.white); P.px(x + 1, y + 3, shade(X.offWhite, 0.7)); P.px(x + 1, y - 1, PAL.bark); } },
    truck(P, w, h) { P.rect(0, 2, 10, 4, PAL.purple); P.rect(10, 3, 5, 3, PAL.purple2); P.rect(11, 1, 4, 3, PAL.purple); P.rect(12, 2, 2, 1, X.glass); P.hline(0, 2, 10, PAL.purpleHi); P.rect(2, 6, 2, 2, X.black); P.rect(11, 6, 2, 2, X.black); P.hline(0, 4, 10, PAL.gold); },
    airboat(P, w, h) { P.rect(0, 6, 12, 3, X.steel); P.hline(0, 6, 12, light(X.steel)); P.hline(0, 8, 12, dark(X.steel)); P.rect(4, 3, 3, 3, PAL.purple); P.ellipse(12, 4, 3, 4, X.steelDark); P.ellipse(12, 4, 2, 3, X.steelShadow); P.px(12, 4, X.black); P.vline(12, 1, 7, X.steel); P.hline(9, 4, 7, X.steel); P.hline(0, 9, 14, shade(PAL.waterNight, 1.2)); },
    bleachers(P, w, h) { for (const x0 of [0, 32]) { for (let r = 0; r < 4; r++) { P.rect(x0 + r, 6 + r * 2, 16 - r * 2, 2, r & 1 ? shade(X.concrete, 0.9) : X.concrete); } P.hline(x0, 6, 16, light(X.concrete)); P.rect(x0, 13, 16, 1, X.steelDark); } P.rect(18, 8, 2, 6, X.steel); P.rect(28, 8, 2, 6, X.steel); P.rect(19, 4, 10, 6, X.black); P.hline(20, 5, 3, PAL.gold); P.hline(25, 5, 3, PAL.gold); P.hline(20, 8, 8, X.ember); P.rect(12, 0, 24, 3, PAL.gold); P.hline(12, 0, 24, PAL.goldHi); for (let x = 14; x < 34; x += 3) P.px(x, 1, PAL.purple); },
    goalposts(P, w, h) { P.rect(3, 6, 2, h - 6, PAL.gold); P.vline(3, 6, h - 6, PAL.goldHi); P.hline(0, 5, 8, PAL.gold); P.vline(0, 0, 6, PAL.gold); P.vline(7, 0, 6, PAL.gold); P.px(0, 0, PAL.goldHi); P.px(7, 0, PAL.goldHi); P.hline(2, h - 1, 4, shade(PAL.dryGrass, 0.6)); },
    beacon(P, w, h, f) { P.rect(1, 3, 2, 3, X.steelDark); P.rect(0, 0, 4, 3, f ? PAL.danger : shade(PAL.danger, 0.45)); if (f) P.px(1, 0, mix(PAL.danger, X.white, 0.6)); },
    plywood(P, w, h) { P.rect(0, 0, w, h, X.plywood); P.hline(0, 0, w, light(X.plywood)); P.vline(0, 0, h, light(X.plywood)); P.hline(0, h - 1, w, dark(X.plywood)); P.vline(w - 1, 0, h, dark(X.plywood)); P.hline(2, 5, w - 4, shade(X.plywood, 0.85)); P.px(2, 2, X.nail); P.px(w - 3, 2, X.nail); P.px(2, h - 3, X.nail); P.px(w - 3, h - 3, X.nail); },
    burrow(P, w, h) { P.ellipse(3, 2, 3, 2, PAL.mud); P.ellipse(3, 2, 2, 1, X.black); P.hline(1, 0, 4, shade(PAL.mud, 1.2)); P.px(0, 3, shade(PAL.mud, 0.8)); P.px(5, 3, shade(PAL.mud, 0.8)); },
    nest(P, w, h) { P.ellipse(4, 3, 4, 3, PAL.bark); P.ellipse(4, 3, 3, 2, shade(PAL.bark, 1.4)); P.ellipse(4, 3, 2, 1, shade(PAL.bark, 0.7)); P.px(1, 1, shade(PAL.bark, 1.6)); P.px(6, 4, shade(PAL.bark, 1.6)); P.px(4, 3, X.offWhite); },
    lookout(P, w, h) { for (const x of [1, 9]) { P.rect(x, 8, 2, h - 8, PAL.bark); P.vline(x, 8, h - 8, light(PAL.bark)); } P.line(2, 12, 10, 20, dark(PAL.bark)); P.line(10, 12, 2, 20, dark(PAL.bark)); P.rect(0, 6, w, 2, PAL.bark); P.hline(0, 6, w, light(PAL.bark)); P.rect(0, 2, w, 1, PAL.gold); P.vline(0, 2, 4, PAL.gold); P.vline(w - 1, 2, 4, PAL.gold); P.hline(1, 0, w - 2, shade(PAL.bark, 0.8)); P.rect(2, 1, w - 4, 1, dark(PAL.bark)); P.hline(3, 4, 6, X.black); },
    couch(P, w, h) { P.rect(0, 2, w, 3, PAL.purple); P.rect(1, 0, w - 2, 2, PAL.purple2); P.hline(1, 0, w - 2, PAL.purpleHi); P.px(0, 5, X.black); P.px(w - 1, 5, X.black); P.hline(0, 5, w, PAL.purpleShadow); P.px(4, 3, PAL.purpleShadow); },
    crane(P, w, h, f) { P.rect(2, 12, 4, 4, X.steelDark); P.vline(3, 2, 10, PAL.gold); P.vline(4, 2, 10, PAL.goldShadow); const ends = [[16, 2], [14, 8], [8, 1], [2, 6]][f % 4]; P.line(4, 4, 4 + ends[0] - 4, ends[1], PAL.gold); P.px(4 + ends[0] - 4, ends[1] + 1, X.black); P.px(3, 1, PAL.goldHi); },
    jumbotron(P, w, h, f) { P.rect(0, 0, w, h - 2, X.black); P.rect(0, h - 2, w, 2, X.steelDark); P.hline(0, 0, w, X.steel); P.vline(0, 0, h - 2, X.steel); const ox = 8, oy = 3, blink = (f === 3); P.rect(ox, oy, 8, 6, X.tigerOrange); P.rect(ox + 1, oy - 1, 2, 1, X.tigerOrange); P.rect(ox + 5, oy - 1, 2, 1, X.tigerOrange); P.px(ox + 2, oy + 2, blink ? X.black : X.white); P.px(ox + 5, oy + 2, blink ? X.black : X.white); P.hline(ox + 3, oy + 4, 2, X.black); P.vline(ox + 4, oy, 6, shade(X.tigerOrange, 0.5)); P.vline(ox + 1, oy + 1, 3, shade(X.tigerOrange, 0.5)); P.vline(ox + 6, oy + 1, 3, shade(X.tigerOrange, 0.5)); if (f === 1) P.hline(2, 12, 20, PAL.gold); if (f === 2) P.hline(2, 12, 20, PAL.purpleHi); },
    // extras named by the brief (icons drawn as pixels, never emoji)
    sinking(P, w, h) { P.ellipse(6, 6, 6, 6, PAL.purpleShadow); P.ellipse(6, 6, 5, 5, PAL.purple); P.rect(5, 2, 2, 5, PAL.gold); P.rect(5, 8, 2, 2, PAL.gold); P.px(5, 2, PAL.goldHi); },
    noAccess(P, w, h) { P.ellipse(6, 6, 6, 6, shade(PAL.danger, 0.7)); P.ellipse(6, 6, 5, 5, PAL.danger); P.line(2, 9, 9, 2, X.white); P.line(3, 9, 10, 2, X.white); },
    power(P, w, h) { P.ellipse(6, 6, 6, 6, shade(PAL.danger, 0.7)); P.ellipse(6, 6, 5, 5, PAL.danger); P.line(7, 1, 4, 6, X.white); P.hline(4, 6, 4, X.white); P.line(7, 6, 4, 11, X.white); },
    water(P, w, h) { P.ellipse(6, 6, 6, 6, shade(PAL.danger, 0.7)); P.ellipse(6, 6, 5, 5, PAL.danger); P.ellipse(6, 7, 2.5, 2.5, X.white); P.rect(5, 2, 2, 4, X.white); P.px(4, 4, X.white); P.px(7, 4, X.white); },
    debris(P, w, h, f, seed) { const sd = seed + f * 977; const o = hash(sd, 1) % 6;   // a broken brown cluster: boards, a snapped branch, splinters, a torn tarp scrap
      P.rect(3 + o, h - 5, 12, 2, X.plywood); P.hline(3 + o, h - 5, 12, light(X.plywood)); P.hline(3 + o, h - 4, 12, dark(X.plywood)); P.px(5 + o, h - 5, X.nail);
      P.line(14 - (o >> 1), h - 3, 26 - (o >> 1), h - 8, X.debris); P.line(15 - (o >> 1), h - 3, 27 - (o >> 1), h - 8, shade(X.debris, 0.7));
      P.rect(20 + (o & 3), h - 10, 3, 8, PAL.bark); P.vline(20 + (o & 3), h - 10, 8, light(PAL.bark)); P.px(19 + (o & 3), h - 7, PAL.bark); P.px(23 + (o & 3), h - 9, PAL.bark);
      if (f & 1) { P.rect(1, h - 8, 6, 4, X.tarp); P.hline(1, h - 8, 6, shade(X.tarp, 1.25)); P.px(6, h - 6, X.tarpCrease); }
      for (let i = 0; i < 7; i++) { const x = 1 + (hash(sd, 10 + i) % (w - 2)), y = h - 2 - (hash(sd, 20 + i) % 6); P.px(x, y, (i & 1) ? X.debris : shade(X.plywood, 0.8)); }
      P.hline(2, h - 1, w - 4, shade(X.debris, 0.6)); },
    sandbags(P, w, h, f, seed) { for (let i = 0; i < 4; i++) { const x = i * 4, y = (i & 1) ? 0 : 1; P.rect(x, y + 1, 4, 4, X.sandbag); P.hline(x, y + 1, 4, light(X.sandbag)); P.hline(x, y + 4, 4, dark(X.sandbag)); P.px(x, y + 1, PAL.bark); P.px(x + 3, y + 4, PAL.bark); P.px(x + 1 + (hash(seed, i) & 1), y + 3, shade(X.sandbag, 0.85)); } P.hline(0, 5, w, shade(PAL.bark, 0.8)); }
  };
  M.decalPainters = DECALS;
  /** the decal table entry for a name (data.decals first, then the extras) or null */
  function decalInfo(name) { const d = BSU.data && BSU.data.decals; return (d && d[name]) || EXTRA_DECALS[name] || null; }
  M.decalInfo = decalInfo;
  M.registerPainter('decal', function (ctx, spec) {
    const info = decalInfo(spec.sub), fn = DECALS[spec.sub];
    if (!info || !fn) throw new Error('unknown decal "' + spec.sub + '"');
    const P = pen(ctx, spec.zoom);
    const g = begin(ctx, info.w, info.h, spec.zoom);
    spec.frames = Math.max(1, info.frames | 0);
    fn(P, g.w, g.h, spec.frame % spec.frames, hash(spec.seed, 0xdec));
    const ground = info.anchor === 'ground';
    return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: ground ? -g.h + 4 : -(g.h >> 1) };
  });

  // ---------------------------------------------------------------------------
  // Lights — family `light`, id light:<kind>: cached radial-gradient canvases for the additive pass (the one
  // place a gradient is allowed). Anchor = centre. `mast` is a 48×96 downward cone (render rotates it).
  // ---------------------------------------------------------------------------
  const LIGHTS = {
    lamp: { w: 24, h: 24, color: X.lampGlow, a: 0.95 }, window: { w: 8, h: 8, color: PAL.windowGlow, a: 0.9 },
    beacon: { w: 32, h: 32, color: PAL.gold, a: 0.8 }, blink: { w: 8, h: 8, color: PAL.danger, a: 1 }, arc: { w: 12, h: 12, color: PAL.waterBlue, a: 1 },
    glow: { w: 16, h: 16, color: PAL.gold, a: 0.85 }, pot: { w: 12, h: 12, color: X.ember, a: 0.9 }, fire: { w: 24, h: 24, color: X.ember, a: 0.95 },
    firefly: { w: 4, h: 4, color: X.firefly, a: 1 }, eye: { w: 3, h: 3, color: PAL.danger, a: 1 }, mast: { w: 48, h: 96, color: X.white, a: 0.9, cone: true }
  };
  M.LIGHTS = LIGHTS;
  M.registerPainter('light', function (ctx, spec) {
    const L = LIGHTS[spec.sub];
    if (!L) throw new Error('unknown light "' + spec.sub + '"');
    const g = begin(ctx, L.w, L.h, spec.zoom), S = g.S;
    const W = g.w * S, H = g.h * S;
    try {
      if (L.cone) {
        // a cone from a 4-px throat at the top to the full width at the bottom, fading out along its length
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, rgba(L.color, L.a)); grad.addColorStop(0.4, rgba(L.color, L.a * 0.45)); grad.addColorStop(1, rgba(L.color, 0));
        ctx.fillStyle = grad;
        for (let y = 0; y < g.h; y++) { const half = Math.round(2 + (g.w / 2 - 2) * (y / (g.h - 1))); ctx.fillRect((g.w / 2 - half) * S, y * S, 2 * half * S, S); }
      } else {
        const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba(L.color, L.a)); grad.addColorStop(0.3, rgba(L.color, L.a * 0.55)); grad.addColorStop(0.7, rgba(L.color, L.a * 0.15)); grad.addColorStop(1, rgba(L.color, 0));
        ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
        if (g.w <= 4) { ctx.fillStyle = rgba(L.color, 1); ctx.fillRect(Math.floor(cx - S / 2), Math.floor(cy - S / 2), S, S); }
      }
    } catch (e) { /* stub contexts have no gradients: sizes still count */ }
    return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -(g.h >> 1) };
  });

  // ---------------------------------------------------------------------------
  // Vegetation — oak (variant = stage 0–2), cypress (stage | autumn<<2), palmetto (stage), azalea (stage | bloom<<3).
  // Anchor = the trunk base at the tile centre: ox −w/2, oy −h + 4.
  // ---------------------------------------------------------------------------
  /** stage | (autumn ? 4 : 0) | (bloom ? 8 : 0) */
  M.treeVariant = function (stage, autumn, bloom) { return (Math.max(0, Math.min(2, stage | 0))) | (autumn ? 4 : 0) | (bloom ? 8 : 0); };

  /** a lit, dithered canopy made of ellipse blobs; returns the list of bottom-edge points (for moss) */
  function canopy(P, blobs, w, h, base, seed, opts) {
    opts = opts || {};
    const hi = shade(base, opts.hi || 1.18), mid = base, lo = shade(base, opts.lo || 0.78), rim = shade(base, 0.55);
    const bottoms = [];
    for (let y = 0; y < h; y++) {
      let lastIn = false;
      for (let x = 0; x < w; x++) {
        let best = -1, bi = -1;
        for (let i = 0; i < blobs.length; i++) { const b = blobs[i]; const v = P.ellipseTest(x + 0.5, y + 0.5, b[0], b[1], b[2], b[3]); if (v > best) { best = v; bi = i; } }
        const n = hash(seed, x + y * 257) % 100;
        let inside = best > 0;
        if (inside && best < 0.10 && (n & 1)) inside = false;         // dithered outer edge
        if (!inside) { if (lastIn && n < 55) P.px(x, y, rim); lastIn = false; continue; }
        const b = blobs[bi];
        const lit = ((b[0] - x) / b[2]) * 0.35 + ((b[1] - y) / b[3]) * 0.75;   // light from the upper-left
        let col = lit > 0.42 ? hi : lit > -0.15 ? mid : lo;
        if (n < 7) col = shade(col, 1.12); else if (n > 93) col = shade(col, 0.86);   // leaf texture
        if (best < 0.22 && n > 40) col = shade(col, 0.9);                             // darker rim
        P.px(x, y, col);
        lastIn = true;
        if (y + 1 < h) { let below = false; for (const bb of blobs) if (P.ellipseTest(x + 0.5, y + 1.5, bb[0], bb[1], bb[2], bb[3]) > 0) { below = true; break; } if (!below) bottoms.push([x, y]); }
      }
    }
    return bottoms;
  }
  function trunk(P, x, top, w, h, flare) {
    P.rect(x, top, w, h, PAL.bark);
    P.vline(x, top, h, shade(PAL.bark, 1.35)); P.vline(x + w - 1, top, h, shade(PAL.bark, 0.65));
    if (w > 3) P.vline(x + 1, top, h, shade(PAL.bark, 1.12));
    for (let y = top + 2; y < top + h; y += 3) P.px(x + 1 + (y % w), y, shade(PAL.bark, 0.85));
    if (flare) { P.rect(x - 1, top + h - 2, w + 2, 2, PAL.bark); P.rect(x - 2, top + h - 1, w + 4, 1, shade(PAL.bark, 0.8)); P.px(x - 1, top + h - 2, shade(PAL.bark, 1.3)); }
  }
  function shadowEllipse(P, cx, cy, rx, ry, c) { P.ellipse(cx, cy, rx, ry, c); }
  function mossStrands(P, bottoms, n, seed, minLen, maxLen, h) {
    if (!bottoms.length) return;
    for (let i = 0; i < n; i++) {
      const b = bottoms[hash(seed, 700 + i) % bottoms.length];
      const len = minLen + (hash(seed, 800 + i) % (maxLen - minLen + 1));
      let x = b[0];
      for (let k = 1; k <= len; k++) {
        const y = b[1] + k; if (y >= h) break;
        if (k % 4 === 0) x += ((hash(seed, 900 + i * 31 + k) % 3) - 1);
        P.px(x, y, (k & 1) ? PAL.moss : shade(PAL.moss, 0.82));
      }
      P.px(x, Math.min(h - 1, b[1] + len + 1), shade(PAL.moss, 1.1));
    }
  }
  M.canopy = canopy; M.trunk = trunk; M.mossStrands = mossStrands;

  M.registerPainter('oak', function (ctx, spec) {
    const stage = Math.max(0, Math.min(2, spec.variant & 3));
    const P = pen(ctx, spec.zoom), seed = hash(0x0ac, spec.variant);
    let g;
    if (stage === 0) {
      g = begin(ctx, 8, 14, spec.zoom);
      shadowEllipse(P, 4, 12, 3, 1, shade(PAL.dryGrass, 0.6));
      trunk(P, 3, 6, 2, 6, false);
      canopy(P, [[4, 3.5, 3.5, 3.2]], 8, 8, PAL.oakCanopy, seed);
    } else if (stage === 1) {
      g = begin(ctx, 40, 36, spec.zoom);
      shadowEllipse(P, 20, 33, 12, 3, shade(PAL.dryGrass, 0.62));
      trunk(P, 18, 22, 4, 12, true);
      const bottoms = canopy(P, [[20, 13, 17, 9.5], [11, 17, 11, 7], [29, 17, 11, 7], [20, 8, 10, 6]], 40, 30, PAL.oakCanopy, seed);
      mossStrands(P, bottoms.filter(b => b[1] > 16), 4, seed, 4, 8, 36);
    } else {
      g = begin(ctx, 96, 56, spec.zoom);
      shadowEllipse(P, 48, 53, 30, 3, shade(PAL.dryGrass, 0.62));
      trunk(P, 45, 34, 6, 18, true);
      // two limbs
      P.line(46, 36, 34, 28, PAL.bark); P.line(50, 36, 62, 27, PAL.bark); P.line(47, 35, 35, 28, shade(PAL.bark, 1.3));
      const bottoms = canopy(P, [[48, 21, 30, 14], [24, 26, 18, 10.5], [72, 26, 18, 10.5], [36, 12, 17, 8.5], [60, 12, 17, 8.5], [48, 8, 12, 6]], 96, 44, PAL.oakCanopy, seed);
      mossStrands(P, bottoms.filter(b => b[1] > 22 && Math.abs(b[0] - 48) > 6), 9, seed, 6, 12, 56);
    }
    return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
  });

  M.registerPainter('cypress', function (ctx, spec) {
    const stage = Math.max(0, Math.min(2, spec.variant & 3)), autumn = !!(spec.variant & 4);
    const P = pen(ctx, spec.zoom), seed = hash(0xc7, spec.variant);
    const base = autumn ? PAL.cypressAutumn : PAL.cypress;
    const sizes = [[6, 16, 1, 3], [16, 48, 3, 10], [24, 80, 6, 16]][stage];   // w, h, trunk w, trunk h
    const g = begin(ctx, sizes[0], sizes[1], spec.zoom);
    const w = g.w, h = g.h, tw = sizes[2], th = sizes[3], cx = w >> 1;
    const folTop = 1, folBot = h - th - 2;
    shadowEllipse(P, cx, h - 3, (w >> 1) - 1, 2, shade(PAL.wetGround, 0.6));
    trunk(P, cx - (tw >> 1), h - th - 4, tw, th, stage > 0);
    // knees at the water line (2–4 bark nubs)
    if (stage > 0) { const n = 2 + (hash(seed, 1) % 3); for (let i = 0; i < n; i++) { const x = (i & 1 ? cx + (tw >> 1) + 1 : cx - (tw >> 1) - 3) + (i >> 1) * (i & 1 ? 2 : -2), kh = 2 + (hash(seed, 10 + i) % 2); if (x < 0 || x > w - 2) continue; P.rect(x, h - 4 - kh, 2, kh + 1, PAL.bark); P.px(x, h - 4 - kh, shade(PAL.bark, 1.5)); } }
    // conical feathery foliage: half-width grows down the cone, tiers every 7 rows with jagged lower edges, dithered outer 2 px
    const hi = shade(base, 1.2), lo = shade(base, 0.75), dk = shade(base, 0.55);
    const tier = stage === 2 ? 7 : stage === 1 ? 5 : 3;
    for (let y = folTop; y <= folBot; y++) {
      const t = (y - folTop) / Math.max(1, folBot - folTop);
      let hw = 0.6 + ((w >> 1) - 1) * t;
      const ph = (y - folTop) % tier;
      hw += ph >= tier - 2 ? 1.0 : ph === 0 ? -0.8 : 0;      // tier ends flare out, tier starts tuck in
      const hwI = Math.round(hw);
      for (let x = cx - hwI; x <= cx + hwI; x++) {
        if (x < 0 || x >= w) continue;
        const d = Math.abs(x - cx) / Math.max(1, hw);
        const n = hash(seed, x + y * 131) % 100;
        if (d > 0.72 && (n % 3 === 0)) continue;                          // feathery edge
        if (d > 0.9 && (n & 1)) continue;
        let col = d < 0.35 ? (x < cx ? hi : base) : (x < cx ? base : lo);
        if (ph === tier - 1 && n < 60) col = dk;                          // the shaded underside of each tier
        if (n < 6) col = shade(col, 1.15); else if (n > 94) col = shade(col, 0.85);
        if (stage > 0 && Math.abs(x - cx) < 1 && (y % tier) === 3) col = PAL.bark;   // the trunk glimpsed between tiers
        P.px(x, y, col);
      }
    }
    P.px(cx, folTop, hi); P.px(cx, folTop - 1 < 0 ? 0 : folTop - 1, base);
    return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
  });

  M.registerPainter('palmetto', function (ctx, spec) {
    const stage = Math.max(0, Math.min(2, spec.variant & 3));
    const P = pen(ctx, spec.zoom), seed = hash(0x9a1, spec.variant);
    const sz = [[12, 10], [18, 15], [24, 20]][stage];
    const g = begin(ctx, sz[0], sz[1], spec.zoom);
    const w = g.w, h = g.h, cx = w >> 1, cy = h - 3;
    shadowEllipse(P, cx, h - 2, (w >> 1) - 1, 1.5, shade(PAL.wetGround, 0.6));
    // a dark leafy base clump so the fan has a silhouette, then two fans of rays (back darker/shorter, front lit)
    P.ellipse(cx, cy - 1, Math.max(2, (w >> 2)), Math.max(1.5, h / 6), shade(X.palmetto, 0.6));
    P.rect(cx - 1, h - 5, 2, 3, PAL.bark);
    const fans = [[shade(X.palmetto, 0.7), 0.85, 0.3], [X.palmetto, 1.0, 0]];
    for (const [col, lenK, off] of fans) {
      const n = 8 + stage * 3;
      for (let i = 0; i < n; i++) {
        const a = Math.PI + 0.2 + off + (Math.PI - 0.4) * (i / (n - 1)) + ((hash(seed, i + (off ? 100 : 0)) % 7) - 3) * 0.02;
        const len = (h - 3) * lenK * (0.72 + 0.28 * Math.sin((i / (n - 1)) * Math.PI)) * (0.9 + (hash(seed, 50 + i) % 20) / 100);
        const ex = cx + Math.cos(a) * len * 1.2, ey = cy + Math.sin(a) * len * 0.8;
        P.line(cx, cy, ex, ey, col);
        if (stage > 0) P.line(cx, cy - 1, Math.round(cx + Math.cos(a) * len * 0.55 * 1.2), Math.round(cy - 1 + Math.sin(a) * len * 0.55 * 0.8), shade(col, 0.85));   // 2-px-thick blade near the crown
        P.px(Math.round(ex), Math.round(ey), shade(col, 1.3));
        if (len > 6) P.px(Math.round(cx + Math.cos(a) * len * 0.5 * 1.2), Math.round(cy + Math.sin(a) * len * 0.5 * 0.8), shade(col, 1.15));
      }
    }
    return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
  });

  M.registerPainter('azalea', function (ctx, spec) {
    const stage = Math.max(0, Math.min(2, spec.variant & 3)), bloom = !!(spec.variant & 8);
    const P = pen(ctx, spec.zoom), seed = hash(0xa2, spec.variant);
    const sz = stage === 0 ? [10, 6] : [16, 10];
    const g = begin(ctx, sz[0], sz[1], spec.zoom);
    const w = g.w, h = g.h, cx = w >> 1, ry = h - 2, rx = (w >> 1) - 0.5;
    shadowEllipse(P, cx, h - 1, rx, 1, shade(PAL.dryGrass, 0.62));
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) {
      const v = P.ellipseTest(x + 0.5, y + 0.5, cx, h - 1.5, rx, ry);
      const n = hash(seed, x + y * 131) % 100;
      if (v <= 0 || (v < 0.12 && (n & 1))) continue;
      const lit = ((cx - x) / rx) * 0.3 + ((h - 1.5 - y) / ry) * 0.7;
      let col = lit > 0.4 ? shade(X.azaleaLeaf, 1.4) : lit > 0.05 ? shade(X.azaleaLeaf, 1.12) : shade(X.azaleaLeaf, 0.75);
      if (stage === 2 && n < 10) col = shade(col, 1.15);
      if (bloom && stage > 0 && y < h - 3 && n < 60) col = (n < 20) ? shade(PAL.azalea, 1.2) : PAL.azalea;
      if (bloom && stage === 0 && n < 25) col = PAL.azalea;
      P.px(x, y, col);
    }
    if (stage === 0) { for (let i = 0; i < 3; i++) P.vline(2 + i * 3, 1, 3, PAL.bark); }   // shredded: bare twigs
    return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
  });

  // ---------------------------------------------------------------------------
  // Agent look packing (GDD §7): skin (0–5) | hair (0–7) << 3 | shirt (0–2) << 6 ; shirt 55/25/20 purple/gold/white
  // ---------------------------------------------------------------------------
  M.agentLook = function (seed) {
    seed = Number.isFinite(seed) ? (seed | 0) : 0;
    const skin = hash(seed, 1) % 6, hair = hash(seed, 2) % 8, roll = hash(seed, 3) % 100;
    const shirt = roll < 55 ? 0 : roll < 80 ? 1 : 2;
    return skin | (hair << 3) | (shirt << 6);
  };
  M.lookColors = function (look) { look = look | 0; return { skin: X.skins[look & 7] || X.skins[0], hair: X.hairs[(look >> 3) & 7], shirt: X.shirts[(look >> 6) & 3] || X.shirts[0] }; };

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  const CLIFF_PREBAKE = [6, 12, 18, 24, 36, 48];
  /** pre-bake the 1× atlas (≤ 400 ms); everything else builds lazily on the first get */
  M.init = function (state) {
    baking = true;
    try {
      const SPR = BSU.SPR, data = BSU.data;
      for (let t = 0; t < 8; t++) for (let v = 0; v < 3; v++) M.get('tile:' + t, v, 0, 1);
      for (const h of CLIFF_PREBAKE) { M.get('cliff', h, 0, 1); M.get('cliff', h, 1, 1); }
      for (let s = 1; s <= 4; s++) for (let m = 0; m < 16; m++) M.get('surf:' + s, m, 0, 1);
      for (let m = 0; m < 16; m++) { M.get('levee', m, 0, 1); M.get('floodwall', m, 0, 1); M.get('canal', m, 0, 1); M.get('preservePost', m, 0, 1); }
      M.get('water', 0, 0, 1); M.get('water', 1, 0, 1);
      for (let v = 0; v < 3; v++) { M.get('reeds', v, 0, 1); M.get('reeds', v, 1, 1); M.get('knees', v, 0, 1); M.get('worn', v, 0, 1); }
      M.get('mound', 0, 0, 1);
      const names = Object.keys(Object.assign({}, (data && data.decals) || {}, EXTRA_DECALS));
      for (const n of names) M.get('decal:' + n, 0, 0, 1);
      for (const k of Object.keys(LIGHTS)) M.get('light:' + k, 0, 0, 1);
      for (let s = 0; s < 3; s++) { M.get('oak', s, 0, 1); M.get('cypress', s, 0, 1); M.get('cypress', s | 4, 0, 1); M.get('palmetto', s, 0, 1); M.get('azalea', s, 0, 1); M.get('azalea', s | 8, 0, 1); }
      if (painters.building && data && data.catalogList) {
        const variants = [0, SPR.NIGHT, SPR.DAMAGED, SPR.PILINGS, SPR.SCAFFOLD, SPR.RUIN];
        for (const row of data.catalogList) {
          for (const v of variants) M.get(row.id, v, 0, 1);
          if (row.tiers && row.tiers.length) for (const v of variants) M.get(row.id, v | (1 << SPR.TIER_SHIFT), 0, 1);
        }
      }
      if (painters.agent) { const look0 = M.agentLook(0); for (let f = 0; f < 16; f++) M.get('agent', look0, f, 1); for (let f = 0; f < 8; f++) M.get('agent:idle', look0, f, 1); }
      if (painters.gator) for (let v = 0; v < 3; v++) for (let f = 0; f < 6; f++) M.get('gator', v, f, 1);
      for (const id of ['roux', 'officer', 'pirogue', 'bus', 'thibodeaux']) if (painters[id]) M.get(id, 0, 0, 1);
    } catch (e) { BSU.error('sprites', 'init', e); }
    finally { baking = false; }
  };
  /** the atlas is seed-independent: reset keeps every entry (no-op) */
  M.reset = function (state, fresh) { void state; void fresh; };

  /** pure (headless: stub canvases, sizes only); asserts the brief's invariants + every registered split-file test */
  M.selfTest = function () {
    const notes = [];
    const fail = (m) => { notes.push('FAIL ' + m); BSU.assert(false, 'sprites: ' + m); };
    const check = (c, m) => { if (!c) fail(m); };
    const t0 = Date.now();
    try {
      const SPR = BSU.SPR, data = BSU.data;
      const need = (id, v, f, msg) => { const e = M.get(id, v, f || 0, 1); check(e && e.sw > 0 && e.sh > 0, msg || (id + ' v' + v)); return e; };
      // 5. colour helpers
      check(shade('#FDD023', 0.5) === '#7E6811', 'shade rounding: ' + shade('#FDD023', 0.5));
      check(mix('#000000', '#FFFFFF', 0.5) === '#808080', 'mix rounding: ' + mix('#000000', '#FFFFFF', 0.5));
      check(shade(PAL.gold, 1) === PAL.gold.toUpperCase() && rgb(255, 0, 16) === '#FF0010', 'hex/rgb round trip');
      // 4. tileVariant + hash
      check(M.hash === BSU.rng.hash, 'hash is BSU.rng.hash');
      for (let i = 0; i < 50; i++) { const v = tileVariant(i * 7, i * 3); check(v >= 0 && v <= 2 && v === tileVariant(i * 7, i * 3), 'tileVariant stable/in range'); }
      // 3. agentLook packing and distribution
      let sh = [0, 0, 0];
      for (let s = 0; s < 1000; s++) { const l = M.agentLook(s); const skin = l & 7, hair = (l >> 3) & 7, shirt = l >> 6; check(skin < 6 && hair < 8 && shirt < 3, 'agentLook fields'); sh[shirt]++; }
      check(Math.abs(sh[0] - 550) <= 50 && Math.abs(sh[1] - 250) <= 50 && Math.abs(sh[2] - 200) <= 50, 'shirt distribution 55/25/20 ±5 (got ' + sh.join('/') + ')');
      // 6. every terrain-side id resolves with the documented sizes
      for (let t = 0; t < 8; t++) for (let v = 0; v < 3; v++) { const e = need('tile:' + t, v); check(e && e.sw === 64 && e.sh === 32 && e.ox === -32 && e.oy === -16, 'tile size/anchor'); }
      check(need('cliff', 6).sh === 22 && need('cliff', 96).sh === 112 && need('cliff', 24, 1).ox === 0 && need('cliff', 24, 0).ox === -32, 'cliff sizes/anchors');
      for (let s = 1; s <= 4; s++) for (let m = 0; m < 16; m++) need('surf:' + s, m);
      need('surf:2', 16 | 5); need('surf:4', 32 | 3); need('surf:1', 64 | 10);
      for (let m = 0; m < 16; m++) { need('levee', m); need('levee', m | 16); need('floodwall', m); need('canal', m); need('canal', m | 32); need('canal', m | 32 | 64); need('preservePost', m); }
      check(need('water', 0).sw === 64 && need('water', 1).sh === 32, 'water');
      for (let v = 0; v < 3; v++) { need('reeds', v, 1); need('knees', v); check(need('worn', v).sw === 64, 'worn'); }
      const md = need('mound', 0); check(md.sw === 24 && md.sh === 14 && md.ox === -12 && md.oy === -20, 'mound 24×14 anchored (−12, −20)');
      const decalNames = Object.keys(Object.assign({}, (data && data.decals) || {}, EXTRA_DECALS));
      for (const n of decalNames) { const info = decalInfo(n); const e = need('decal:' + n, 0); check(e && e.sw === info.w && e.sh === info.h, 'decal ' + n + ' is ' + info.w + '×' + info.h); check(M.frames('decal:' + n) === Math.max(1, info.frames | 0), 'decal frames ' + n); }
      for (const k of Object.keys(LIGHTS)) { const e = need('light:' + k, 0); check(e.ox === -(LIGHTS[k].w >> 1) && e.oy === -(LIGHTS[k].h >> 1), 'light anchor ' + k); }
      // trees (entities brief sizes)
      const oak2 = need('oak', 2); check(oak2.sw === 96 && oak2.sh === 56 && oak2.oy === -52 && oak2.ox === -48, 'oak stage 2 96×56, oy −52');
      check(need('oak', 0).sw === 8 && need('oak', 1).sw === 40, 'oak stages 0/1');
      const cy2 = need('cypress', 2); check(cy2.sw === 24 && cy2.sh === 80 && need('cypress', 2 | 4).sh === 80 && need('cypress', 0).sh === 16, 'cypress sizes');
      check(need('palmetto', 2).sw === 24 && need('azalea', 2 | 8).sw === 16 && need('azalea', 0).sw === 10, 'palmetto/azalea sizes');
      check(M.treeVariant(2, true, false) === 6 && M.treeVariant(1, false, true) === 9, 'treeVariant packing');
      // 7. frame totals and wrapping
      check(M.frames('agent') === 16 && M.frames('agent:idle') === 8 && M.frames('gator') === 6 && M.frames('reeds') === 2 && M.frames('decal:crane') === 4, 'frame table');
      const r1 = M.get('reeds', 0, 3, 1), r2 = M.get('reeds', 0, 1, 1); check(r1 === r2, 'frame wraps modulo frames(id)');
      check(M.get('tile:3', -5, 0, 1) === M.get('tile:3', 0, 0, 1), 'negative variant clamps to 0');
      // 9. unknown ids: null, never a throw
      M._quiet = true;   // the probe below must not log an error (test/browser.mjs fails on console.error)
      try { check(M.get('nope:thing', 0, 0, 1) === null && M.get(null) === null && M.get(undefined, NaN, Infinity, 'x') === null, 'unknown/garbage ids → null'); } finally { M._quiet = false; }
      // zoom rules
      const z1 = M.get('tile:4', 0, 0, 0.5), z2 = M.get('tile:4', 0, 0, 2);
      check(z1 === M.get('tile:4', 0, 0, 1), 'zoom 0.5 → the 1× entry');
      check(z2 && z2.sw === (M.ZOOM2 ? 128 : 64) && z2.ox === (M.ZOOM2 ? -64 : -32), '2× entry doubles size and anchor');
      // 8. memory budget (headless: computed from sizes)
      check(M.memoryMB() <= M.CANVAS_LIMIT_MB, 'memoryMB ' + M.memoryMB().toFixed(2) + ' ≤ ' + M.CANVAS_LIMIT_MB);
      // 1./2. building checks only once sprites_buildings.js is loaded
      if (painters.building && data && data.catalogList) {
        const variants = [0, SPR.NIGHT, SPR.DAMAGED, SPR.PILINGS, SPR.SCAFFOLD, SPR.RUIN];
        for (const row of data.catalogList) for (const v of variants) need(row.id, v, 0, 'building ' + row.id + ' v' + v);
        for (let t = 1; t <= 3; t++) need('stadium', t << SPR.TIER_SHIFT, 0, 'stadium tier ' + t);
        need('practice_field', 1 << SPR.TIER_SHIFT, 0, 'practice_field tier 1'); need('dorm', SPR.BOARDED, 0, 'dorm BOARDED');
        const d = M.get('dorm', 0, 0, 1); check(d && d.sw === 5 * 32 + 4 && d.ox === -(3 * 32) - 2 && d.oy + d.sh >= 16, '3×2 building geometry');
        if (painters.agent) check(M.get('agent', 0, 17, 1) === M.get('agent', 0, 1, 1), 'agent frame 17 wraps to 1');
      } else notes.push('building/entity painters not loaded: their checks skipped');
      for (const fn of M._tests) { try { const r = fn(); if (r && r.ok === false) fail('split test: ' + (r.notes || '')); } catch (e) { fail('split test threw: ' + (e && e.message)); } }
    } catch (e) { notes.push('threw: ' + (e && e.message)); return { ok: false, notes: notes.join('; ') }; }
    notes.push(cache.size + ' entries, ' + M.memoryMB().toFixed(2) + ' MB, ' + (Date.now() - t0) + ' ms');
    return { ok: !notes.some(n => n.startsWith('FAIL')), notes: notes.join('; ') };
  };
})();
