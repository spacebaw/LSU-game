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
  /** hash(tx, ty) % 8 — the ground tile variant (stable per tile; art pass B1: 8 noise windows per type) */
  function tileVariant(tx, ty) { return hash(tx | 0, ty | 0) % 8; }
  const light = (c) => shade(c, 1.15), dark = (c) => shade(c, 0.78), outline = (c) => shade(c, 0.55);
  M.hex = hex; M.rgb = rgb; M.shade = shade; M.mix = mix; M.rgba = rgba; M.hash = hash; M.tileVariant = tileVariant;
  M.light = light; M.dark = dark; M.outline = outline;

  // ---------------------------------------------------------------------------
  // Art pass B1 — material ramps and noise (docs/ART_STYLE.md). Five tones per material, index 0 deep shadow,
  // 1 shadow, 2 base, 3 light, 4 highlight; shadows lean cool (COOL), highlights warm (WARM). Every terrain painter
  // picks its colours from M.ramp(name) so later passes (vegetation, buildings) share the same tones.
  // ---------------------------------------------------------------------------
  const COOL = '#2B2550', WARM = '#FFE0A0';
  function makeRamp(base) {
    return Object.freeze([mix(shade(base, 0.52), COOL, 0.30), mix(shade(base, 0.74), COOL, 0.16), base, mix(shade(base, 1.16), WARM, 0.12), mix(shade(base, 1.34), WARM, 0.28)]);
  }
  const RAMP_BASES = Object.freeze({
    grass: PAL.dryGrass, highGrass: PAL.highGround, wet: PAL.wetGround, dirt: '#7A5A38', clay: '#9A6A44', limestone: '#B9AE93',
    bark: PAL.bark, marshMud: '#4C4530', waterDeep: PAL.waterNight, waterShallow: PAL.shallows, sand: '#D9C9A1', reed: PAL.reed, mud: PAL.mud,
    // art pass B2: vegetation ramps (base = the palette colour where one exists)
    oakLeaf: PAL.oakCanopy, cypressLeaf: PAL.cypress, cypressRust: PAL.cypressAutumn, palmLeaf: X.palmetto, azaleaLeaf: X.azaleaLeaf, azaleaBloom: PAL.azalea, moss: PAL.moss
  });
  const RAMPS = {}; for (const k in RAMP_BASES) RAMPS[k] = makeRamp(RAMP_BASES[k]);
  M.RAMPS = RAMPS; M.RAMP_BASES = RAMP_BASES; M.COOL_TINT = COOL; M.WARM_TINT = WARM;
  /** the 5-tone ramp of a material name (unknown → grass) */
  M.ramp = function (name) { return RAMPS[name] || RAMPS.grass; };
  M.makeRamp = makeRamp;
  /** smooth value noise in [0, 1): lattice `cell` px, bilinear with smoothstep, hash-seeded (deterministic, no state) */
  function vnoise(seed, x, y, cell) {
    cell = cell > 0 ? cell : 8;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    let fx = x / cell - gx, fy = y / cell - gy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = (hash(seed + gx * 7919, gy * 104729 + 17) & 1023) / 1024, b = (hash(seed + (gx + 1) * 7919, gy * 104729 + 17) & 1023) / 1024;
    const c = (hash(seed + gx * 7919, (gy + 1) * 104729 + 17) & 1023) / 1024, d = (hash(seed + (gx + 1) * 7919, (gy + 1) * 104729 + 17) & 1023) / 1024;
    const top = a + (b - a) * fx, bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  }
  M.vnoise = vnoise;
  /** periodic value noise: the lattice wraps every perX × perY px, so tiles that sample one field by their map position meet
   *  seamlessly (cells cx_ × cy_ px must divide the periods) */
  function pnoise(seed, x, y, cx_, cy_, perX, perY) {
    const nx = Math.max(1, Math.round(perX / cx_)), ny = Math.max(1, Math.round(perY / cy_));
    const gx = Math.floor(x / cx_), gy = Math.floor(y / cy_);
    let fx = x / cx_ - gx, fy = y / cy_ - gy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const w = (i, j) => { i = ((i % nx) + nx) % nx; j = ((j % ny) + ny) % ny; return (hash(seed + i * 7919, j * 104729 + 17) & 1023) / 1024; };
    const a = w(gx, gy), b = w(gx + 1, gy), c = w(gx, gy + 1), d = w(gx + 1, gy + 1);
    const top = a + (b - a) * fx, bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  }
  M.pnoise = pnoise;
  // 4×4 ordered dither: an offset in (−0.5, 0.5) per pixel so tone thresholds blend instead of banding
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (BAYER4[(x & 3) + ((y & 3) << 2)] + 0.5) / 16 - 0.5;
  /** ramp index 0–4 for noise value n at pixel (x, y): thresholds th[0..3], dither amplitude amp */
  function toneAt(n, x, y, th, amp) { const v = n + bayer(x, y) * amp; let k = 0; while (k < 4 && v >= th[k]) k++; return k; }
  const TH_GROUND = [0.14, 0.36, 0.70, 0.90], TH_FLAT = [0.06, 0.28, 0.80, 0.96];
  M.toneAt = toneAt; M.bayer = bayer; M.TH_GROUND = TH_GROUND;

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
    tile: 1, cliff: 2, reeds: 2, knees: 1, worn: 1, mound: 1, shrub: 1, surf: 1, levee: 1, floodwall: 1, canal: 1, preservePost: 1, water: 1,
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
  function bake(r, id, variant, frame, z, key, fn, extra) {
    const canvas = newCanvas(1, 1);
    const ctx = ctx2d(canvas);
    const spec = { id: id, family: r.family, sub: r.sub, variant: variant, frame: frame, zoom: z, row: r.row, rot: r.rot, seed: hash(strHash(id), variant), frames: 0 };
    if (extra) for (const k in extra) if (spec[k] === undefined) spec[k] = extra[k];   // tee pass: per-building fields (e.g. tees) the painter may read
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

  /** tee pass: paint (id, variant, frame, zoom) ONCE, outside the cache, with extra spec fields the painter may read
   *  (render keeps per-building tee sprites itself, so a building's path connectors never multiply the shared variants).
   *  Returns an entry shaped like get()'s (own canvas, not counted by memoryMB — the owner counts it) or null. */
  M.bakeWith = function (id, variant, frame, zoom, extra) {
    try {
      const r = resolve(id); if (!r) return null;
      const fn = painters[r.family]; if (!fn) return null;
      variant = Number.isFinite(variant) ? Math.max(0, variant | 0) : 0;
      frame = Number.isFinite(frame) ? (frame | 0) : 0;
      const z = (zoom === 2 && M.ZOOM2) ? 2 : 1;
      const n = M.frames(id, variant); frame = n > 0 ? ((frame % n) + n) % n : 0;
      return bake(r, id, variant, frame, z, '', fn, extra && typeof extra === 'object' ? extra : null);
    } catch (err) { try { BSU.error('sprites', 'bakeWith', err); } catch (e2) { /* never throw */ } return null; }
  };

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
  // Art pass B1: 8 noise-driven variants per type (variant & 7), bit 8 = shallow bed (water types, from the chunk bake).
  // Every variant samples a different window of one noise field and shares the same mean tone; the outer 15 % of the
  // diamond is pulled toward the base tone so two neighbours meet on the same colour and the tile grid disappears.
  // No facet rims: height reads from the faces, the terrace bands and the bake's slope tint (render.js groundTone).
  function tileLook(t) {
    switch (t) {
      case T.OPEN_WATER: return { ramp: RAMPS.waterDeep, th: TH_FLAT, bed: 1 };
      case T.BAYOU: return { ramp: RAMPS.waterDeep, th: TH_FLAT, bed: 2 };
      case T.MARSH: return { ramp: RAMPS.marshMud, th: TH_GROUND, marsh: true };
      case T.WET: return { ramp: RAMPS.wet, th: TH_GROUND, wet: true };
      case T.DRY: return { ramp: RAMPS.grass, th: TH_GROUND, grass: true };
      case T.HIGH: return { ramp: RAMPS.highGrass, th: TH_GROUND, grass: true, high: true };
      case T.DRAINED: return { ramp: RAMPS.dirt, th: TH_GROUND, drained: true };
      case T.POND: return { ramp: RAMPS.waterDeep, th: TH_FLAT, bed: 3 };
      default: return { ramp: RAMPS.mud, th: TH_GROUND };
    }
  }
  const MARSH_GRASS = [RAMPS.marshMud[1], RAMPS.marshMud[2], mix(RAMPS.marshMud[2], PAL.reed, 0.5), PAL.reed, RAMPS.reed[3]];
  const MARSH_WATER = mix(PAL.waterNight, RAMPS.marshMud[1], 0.4), MARSH_SHEEN = mix(MARSH_WATER, PAL.shallows, 0.45);
  const DRAINED_RAMP = [RAMPS.dirt[0], RAMPS.dirt[1], mix(RAMPS.dirt[2], RAMPS.sand[2], 0.3), mix(RAMPS.dirt[3], RAMPS.sand[3], 0.4), RAMPS.sand[3]];
  // beds stay in the teal family: the live water pass covers them at 55–85 % alpha, so a brown bed only greys the water
  const BED_SAND = [shade(PAL.waterDay, 0.7), shade(PAL.waterDay, 0.88), mix(PAL.waterDay, RAMPS.sand[2], 0.3), mix(PAL.shallows, RAMPS.sand[3], 0.35), mix(PAL.shallows, RAMPS.sand[4], 0.4)];
  const BED_MUD = [shade(PAL.waterDay, 0.6), shade(PAL.waterDay, 0.8), PAL.waterDay, mix(PAL.waterDay, RAMPS.marshMud[3], 0.2), shade(PAL.waterDay, 1.12)];
  M.registerPainter('tile', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, 0, 0);
    const t = Math.max(0, Math.min(7, parseInt(spec.sub, 10) || 0));
    const v = spec.variant & 7, shallow = (spec.variant & 8) !== 0;
    const L = tileLook(t);
    let R = L.ramp;
    if (L.bed) R = L.bed === 2 ? BED_MUD : (shallow ? BED_SAND : RAMPS.waterDeep);
    else if (L.drained) R = DRAINED_RAMP;
    const seed = hash(t * 131 + 7, 0x51);                       // one field per type; variants sample different windows
    const cx = g.cx, cy = g.cy, top = cy - 16;
    const ox = (v & 3) * 64 + 3, oy = (v >> 2) * 40 + 5;
    const pv = (spec.variant >> 4) & 63, X0 = ((pv & 7) - (pv >> 3)) * 32 + 256, Y0 = ((pv & 7) + (pv >> 3)) * 16;   // marsh: map position → one periodic field (8×8 tiles)
    const wet = L.marsh || L.wet;
    for (let r = 0; r < TH; r++) {
      const half = diamondHalf(TW, TH, r); if (half <= 0) continue;
      const y = top + r;
      for (let x = cx - half; x < cx + half; x++) {
        const nx = x - cx + ox, ny = (r + oy) * 2;             // iso: stretch the field 2:1
        let n;
        if (L.marsh) n = 0.55 * pnoise(seed, X0 + x - cx, Y0 + r - 16, 16, 8, 256, 128) + 0.30 * pnoise(seed + 7, X0 + x - cx, Y0 + r - 16, 8, 4, 256, 128) + 0.15 * ((hash(seed, x + r * 131 + pv * 2048) & 255) / 256);
        else {
          n = 0.55 * vnoise(seed, nx, ny, 13) + 0.30 * vnoise(seed + 7, nx, ny, 5) + 0.15 * ((hash(seed, x + r * 131 + v * 2048) & 255) / 256);
          const ed = diamondDist(x, y, cx, cy);
          if (ed > 0.84) n += (0.5 - n) * Math.min(1, (ed - 0.84) * 8);   // edge pull → seamless neighbours
        }
        let col;
        if (L.marsh) {
          if (n < 0.40) col = (((r + (hash(seed, 3) % 6)) % 6) === 0 && (x & 1) === 0) ? MARSH_SHEEN : MARSH_WATER;   // standing water with a sheen
          else if (n < 0.45) col = RAMPS.marshMud[0];                                                                   // mud edge around the pools
          else col = MARSH_GRASS[toneAt((n - 0.45) / 0.55, x, r, TH_GROUND, 0.1)];
        } else if (L.bed) {
          col = R[toneAt(n, x, r, L.th, 0.08)];
          if (shallow && L.bed !== 2 && ((r + Math.round(2 * Math.sin((x - cx) / 7))) % 6) === 0) col = R[3];         // sand ripples on a shallow bed
          if (L.bed === 3 && n > 0.86) col = RAMPS.reed[1];                                                             // pond algae
        } else {
          col = R[toneAt(n, x, r, L.th, 0.1)];
          if (L.high && (hash(seed, 9000 + x + r * 97) % 100) < 5) col = mix(col, RAMPS.sand[3], 0.6);                  // sandier crown
          if (L.wet && n < 0.18) col = RAMPS.mud[1];                                                                     // dark mud mottling
        }
        P.px(x, y, col);
      }
    }
    const inside = (x, y, m) => diamondDist(x, y, cx, cy) <= m;
    if (L.grass || L.wet) {
      // grass tufts: a small V in the light tones with a shadow pixel under it
      const nt = L.wet ? 4 : 8 + (hash(seed, v) % 5);
      for (let i = 0; i < nt; i++) {
        const x = cx - 26 + (hash(seed, 900 + i + v * 64) % 52), y = top + 4 + (hash(seed, 950 + i + v * 64) % 24);
        if (!inside(x, y, 0.8)) continue;
        P.px(x, y, R[3]); P.px(x - 1, y - 1, R[4]); P.px(x + 1, y - 1, R[3]); P.px(x, y + 1, R[1]);
      }
    }
    if (L.grass && (v === 1 || v === 4 || v === 6)) {   // a clover patch (bluer green, dotted)
      const x = cx - 10 + (hash(seed, 60 + v) % 20), y = cy - 4 + (hash(seed, 70 + v) % 8), cl = mix(R[1], '#2F6E4E', 0.45);
      P.ellipse(x, y, 6, 3, cl);
      for (let i = 0; i < 8; i++) { const dx = (hash(seed, 80 + i + v) % 11) - 5, dy = (hash(seed, 90 + i + v) % 5) - 2; P.px(x + dx, y + dy, (i & 1) ? R[3] : mix(cl, R[3], 0.5)); }
    }
    if (L.grass && (v === 2 || v === 5)) {   // a bare dirt patch with a dithered rim
      const x = cx - 10 + (hash(seed, 100 + v) % 20), y = cy - 3 + (hash(seed, 110 + v) % 6), D = L.high ? RAMPS.sand : RAMPS.dirt;
      const d2 = mix(D[2], R[2], 0.45), d3 = mix(D[3], R[3], 0.45), d1 = mix(D[1], R[1], 0.45);
      P.ellipse(x, y, 6, 2.5, d2); P.ellipse(x - 1, y - 1, 3, 1, d3);
      for (let i = 0; i < 12; i++) { const dx = (hash(seed, 120 + i + v) % 17) - 8, dy = (hash(seed, 140 + i + v) % 7) - 3; if (Math.abs(dx) / 7 + Math.abs(dy) / 3.5 > 0.8) P.px(x + dx, y + dy, (i & 1) ? d1 : mix(d2, R[2], 0.5)); }
    }
    if (L.high && (v === 3 || v === 7)) {   // a limestone outcrop on the ridge crown
      const x = cx - 8 + (hash(seed, 150 + v) % 16), y = cy - 2 + (hash(seed, 160 + v) % 4), Lm = RAMPS.limestone;
      P.ellipse(x, y + 1, 7, 2.5, Lm[0]); P.ellipse(x, y, 7, 2.5, Lm[2]); P.ellipse(x - 2, y - 1, 3, 1, Lm[3]); P.hline(x - 5, y - 2, 6, Lm[4]); P.px(x + 3, y, Lm[1]); P.hline(x - 6, y + 3, 12, Lm[0]);
    }
    if (L.wet) for (let i = 0; i < 3; i++) {   // puddles: a shallow-water ellipse with a sky highlight line
      const x = cx - 16 + (hash(seed, 600 + i + v * 8) % 32), y = top + 9 + (hash(seed, 650 + i + v * 8) % 14);
      if (!inside(x, y, 0.75)) continue;
      P.ellipse(x, y, 4, 2, mix(R[1], PAL.shallows, 0.45)); P.hline(x - 2, y - 1, 3, mix(R[3], PAL.shallows, 0.6)); P.px(x + 3, y + 1, R[0]);
    }
    if (L.marsh) {
      // reed clumps, lily pads on the pools, glints
      for (let i = 0; i < 2; i++) {
        const x = cx - 22 + (hash(seed, 700 + i + pv * 16) % 44), y = top + 7 + (hash(seed, 750 + i + pv * 16) % 18);
        if (!inside(x, y, 0.8)) continue;
        for (let k = -1; k <= 1; k++) { const hgt = 3 + (hash(seed, 760 + i * 3 + k + pv) % 3); P.vline(x + k, y - hgt, hgt, k === 0 ? RAMPS.reed[3] : RAMPS.reed[1]); if (k === 0) P.px(x, y - hgt - 1, RAMPS.reed[4]); }
        P.hline(x - 1, y, 3, RAMPS.marshMud[0]);
      }
      for (let i = 0; i < 5; i++) {
        const x = cx - 20 + (hash(seed, 800 + i + pv * 16) % 40), y = top + 8 + (hash(seed, 850 + i + pv * 16) % 16);
        if (!inside(x, y, 0.8)) continue;
        const n = 0.55 * pnoise(seed, X0 + x - cx, Y0 + y - top - 16, 16, 8, 256, 128) + 0.30 * pnoise(seed + 7, X0 + x - cx, Y0 + y - top - 16, 8, 4, 256, 128);
        if (n < 0.34) { P.hline(x - 1, y, 3, RAMPS.reed[2]); P.hline(x - 1, y + 1, 3, RAMPS.reed[1]); P.px(x + 1, y, RAMPS.reed[3]); }   // lily pad with a notch
        else if (i < 2) P.hline(x, y, 2, mix(MARSH_SHEEN, '#FFFFFF', 0.4));
      }
    }
    if (L.drained) {
      for (let i = 0; i < 4; i++) {   // cracks
        let x = cx - 16 + (hash(seed, 500 + i + v * 8) % 32), y = top + 6 + (hash(seed, 550 + i + v * 8) % 20);
        for (let k = 0; k < 9; k++) { if (inDiamond(x, y, cx, cy)) P.px(x, y, DRAINED_RAMP[0]); x += (hash(seed, 570 + i * 16 + k) % 3) - 1 + (i & 1 ? 1 : -1); y += (hash(seed, 580 + i * 16 + k) % 2); }
      }
      const px0 = cx - 8 + (hash(seed, 170 + v) % 16), py0 = cy - 2 + (hash(seed, 180 + v) % 4);   // a drying puddle remnant
      P.ellipse(px0, py0, 6, 2.5, DRAINED_RAMP[1]); P.ellipse(px0, py0, 3, 1.2, RAMPS.mud[1]);
      for (let i = 0; i < 5; i++) { const x = cx - 20 + (hash(seed, 190 + i + v * 8) % 40), y = top + 8 + (hash(seed, 200 + i + v * 8) % 16); if (inside(x, y, 0.8)) P.vline(x, y - 2, 3, (i & 1) ? RAMPS.sand[1] : RAMPS.dirt[3]); }   // dead reed stubs
    }
    if (L.bed === 2 || (L.bed === 1 && !shallow)) for (let k = -14; k <= 14; k++) {   // a faint current streak on the bayou / deep bed
      const x = cx + k, y = cy - (k >> 1) + ((hash(seed, 400 + k + v) % 3) - 1); if (inDiamond(x, y, cx, cy)) P.px(x, y, R[3]);
    }
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });

  // ---------------------------------------------------------------------------
  // cliff — variant = face height in px (6…96), frame 0 = south face (under the SW edge), 1 = east face (SE edge)
  // canvas 32 × (16 + h); anchor = the tile centre (ox −32 south / 0 east, oy 0)
  // Art pass B1: soil strata (topsoil, clay, limestone on tall faces), roots, stones, a grass overhang; the south face
  // is one tone lighter than the east (key light from the upper-left: south-facing lit, east-facing in shadow).
  // ---------------------------------------------------------------------------
  M.registerPainter('cliff', function (ctx, spec) {
    const hgt = Math.max(6, Math.min(96, spec.variant || 6));
    const east = (spec.frame % 2) === 1;
    const P = pen(ctx, spec.zoom);
    const g = begin(ctx, 32, 16 + hgt, spec.zoom);
    const seed = hash(hgt, east ? 3 : 5);
    const k = east ? -1 : 0;
    const soil = RAMPS.dirt, clay = RAMPS.clay, lime = RAMPS.limestone, grass = RAMPS.grass, bark = RAMPS.bark;
    const tone = (ramp, i) => ramp[Math.max(0, Math.min(4, i + k))];
    const topOf = (c) => Math.max(0, east ? 16 - (c >> 1) - 1 : (c >> 1));
    for (let c = 0; c < 32; c++) {
      const t0 = topOf(c);
      for (let y = 0; y < hgt; y++) {
        const yy = t0 + y; if (yy >= g.h) break;
        const n = (hash(seed, c + y * 97) & 255) / 256;
        const wob = Math.round(vnoise(seed + 11, c * 2, y, 9) * 3);
        let col;
        if (y === 0) col = grass[0];                                              // the shadow line under the lip
        else if (y < 3 + ((hash(seed, c) & 1))) col = tone(soil, n < 0.3 ? 1 : 2);   // topsoil with a ragged bottom
        else {
          const d = y + wob, cyc = d % 22;
          const limeLayer = hgt >= 24 && cyc >= 14 && cyc < 20;                    // a limestone seam in the clay of tall faces
          const ramp = hgt < 12 ? soil : (limeLayer ? lime : clay);                   // a short terrace is all topsoil
          let i = n < 0.12 ? 1 : n > 0.9 ? 3 : 2;
          if (cyc === 0 || (hgt >= 24 && cyc === 14)) i = 0;                        // the layer boundary
          if (limeLayer && (hash(seed, c * 3 + d * 7) % 19) === 0) i = 0;          // pits in the limestone
          col = tone(ramp, i);
        }
        if (y >= hgt - 2) col = tone(soil, 0);                                     // the foot in deep shadow
        P.px(c, yy, col);
      }
    }
    for (let c = 0; c < 32 && hgt >= 10; c++) {   // grass overhang: ragged 1–3 px fringe hanging over the lip
      if ((hash(seed, 600 + c) % 4) === 0) continue;
      const t0 = topOf(c), len = 1 + (hash(seed, 500 + c) % 3);
      for (let y = 0; y < len; y++) P.px(c, t0 + y, y === 0 ? grass[3] : grass[2]);
    }
    const nr = 2 + (hash(seed, 700) % 3);   // roots wandering down from the topsoil
    for (let i = 0; i < nr; i++) {
      let c = 3 + (hash(seed, 710 + i) % 26);
      const len = 4 + (hash(seed, 720 + i) % Math.max(1, Math.min(14, hgt - 6))), t0 = topOf(c);
      for (let y = 3; y < 3 + len; y++) { if ((hash(seed, 730 + i * 31 + y) % 3) === 0) c += (hash(seed, 740 + i + y) & 1) ? 1 : -1; c = Math.max(0, Math.min(31, c)); P.px(c, t0 + y, y === 3 + len - 1 ? bark[2] : bark[1]); }
    }
    for (let i = 0; i < 3; i++) {   // stones: a lit top, a shadowed underside
      const c = 2 + (hash(seed, 300 + i) % 27), y = 5 + (hash(seed, 350 + i) % Math.max(1, hgt - 9)), t0 = topOf(c);
      P.hline(c, t0 + y, 3, tone(lime, 2)); P.px(c, t0 + y - 1, lime[4]); P.hline(c, t0 + y + 1, 3, lime[0]);
    }
    return { w: g.w, h: g.h, ox: east ? 0 : -32, oy: 0 };
  });

  // ---------------------------------------------------------------------------
  // Art pass B1 ground decorations (chunk bake): tuft (8×6, variants 0–3, sub 'high' for the crown), patch:<clover|dirt|lime>
  // (16×8, variants 0–3), shore:<sand|mud> (land side, variant = mask of WATER neighbours N1 E2 S4 W8) and shore:ripple
  // (water side, mask of LAND neighbours), tone:<warm|cool> (a 64×32 diamond the bake draws at a small alpha).
  // ---------------------------------------------------------------------------
  M.registerPainter('tuft', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = begin(ctx, 8, 6, spec.zoom);
    const v = spec.variant & 3, seed = hash(0x7f7, v), R = spec.sub === 'high' ? RAMPS.highGrass : RAMPS.grass;
    const n = 3 + (hash(seed, 1) % 3);
    for (let i = 0; i < n; i++) {
      const x = 1 + (hash(seed, 10 + i) % 6), h = 2 + (hash(seed, 20 + i) % 3), lean = (hash(seed, 30 + i) % 3) - 1;
      for (let k = 0; k < h; k++) P.px(Math.max(0, Math.min(7, x + (k >= h - 1 ? lean : 0))), 5 - k, k === h - 1 ? R[4] : R[3]);
    }
    P.hline(1, 5, 6, R[1]);
    return { w: g.w, h: g.h, ox: -4, oy: -5 };
  });
  M.registerPainter('patch', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = begin(ctx, 16, 8, spec.zoom);
    const v = spec.variant & 3, kind = spec.sub || 'dirt', seed = hash(0x9a7 + v, strHash(kind));
    if (kind === 'clover') {
      const cl = mix(RAMPS.grass[1], '#2F6E4E', 0.45);
      P.ellipse(8, 4, 7, 3, cl);
      for (let i = 0; i < 10; i++) { const x = 2 + (hash(seed, 10 + i) % 12), y = 2 + (hash(seed, 20 + i) % 5); P.px(x, y, (i & 1) ? RAMPS.grass[3] : mix(cl, RAMPS.grass[3], 0.5)); }
      P.px(4 + (hash(seed, 40) % 8), 3, '#F2EEDC');
    } else if (kind === 'lime') {
      const Lm = RAMPS.limestone;
      P.ellipse(8, 5, 7, 2.5, Lm[0]); P.ellipse(8, 4, 7, 2.5, Lm[2]); P.ellipse(6, 3, 3, 1, Lm[3]); P.hline(3, 2, 6, Lm[4]); P.px(11, 4, Lm[1]); P.px(12, 5, Lm[1]);
      for (let x = 1; x < 15; x++) P.px(x, 7, Lm[0]);
    } else {
      const G = RAMPS.grass, D = [mix(RAMPS.dirt[0], G[0], 0.4), mix(RAMPS.dirt[1], G[1], 0.4), mix(RAMPS.dirt[2], G[2], 0.4), mix(RAMPS.dirt[3], G[3], 0.4), mix(RAMPS.dirt[4], G[4], 0.4)];   // dirt softened toward the grass it sits on
      P.ellipse(8, 4, 7, 3, D[2]); P.ellipse(7, 3, 4, 1.5, D[3]);
      for (let i = 0; i < 12; i++) { const x = (hash(seed, 50 + i) % 16), y = (hash(seed, 60 + i) % 8); if (Math.abs(x - 8) / 7 + Math.abs(y - 4) / 3 > 0.75) P.px(x, y, (i & 1) ? D[1] : D[2]); }
      P.px(5, 5, D[0]); P.px(10, 3, D[4]);
    }
    return { w: g.w, h: g.h, ox: -8, oy: -4 };
  });
  M.registerPainter('shore', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, 0, 0);
    const kind = spec.sub || 'sand', mask = spec.variant & 15, cx = g.cx, cy = g.cy, top = cy - 16, seed = hash(0x5e0 + mask, strHash(kind));
    const sand = RAMPS.sand, mud = RAMPS.mud, ws = RAMPS.waterShallow, lime = RAMPS.limestone;
    const bw = kind === 'sand' ? 0.36 : kind === 'mud' ? 0.24 : kind === 'beach' ? 3 : 0.26;
    for (let r = 0; r < TH; r++) {
      const half = diamondHalf(TW, TH, r);
      for (let x = cx - half; x < cx + half; x++) {
        const dx = (x + 0.5 - cx) / 32, dy = (r + 0.5 - 16) / 16;
        let d = 2;   // distance from the nearest masked edge (0 at the edge, 2 at the far edge)
        if (mask & 1) d = Math.min(d, 1 - (dx - dy));
        if (mask & 2) d = Math.min(d, 1 - (dx + dy));
        if (mask & 4) d = Math.min(d, 1 + (dx - dy));
        if (mask & 8) d = Math.min(d, 1 + (dx + dy));
        if (d >= bw) continue;
        const n = (hash(seed, x + r * 131) & 255) / 256, y = top + r;
        if (kind === 'beach') {   // the cove floor: shell sand with a damp lower half and scattered shells
          const nn = 0.6 * vnoise(seed, x - cx + 7, r * 2, 11) + 0.4 * n;
          let col = sand[toneAt(nn, x, r, TH_GROUND, 0.1)];
          if (r > 20 && nn < 0.5) col = sand[1];
          if (n > 0.975) col = lime[4]; else if (n > 0.96) col = lime[1];
          P.px(x, y, col); continue;
        }
        if (kind === 'ripple') {
          if (d >= 0.07 && d < 0.11 && n < 0.6) P.px(x, y, ws[3]);
          else if (d >= 0.19 && d < 0.23 && n < 0.35) P.px(x, y, ws[2]);
          continue;
        }
        if (d > bw - 0.12 && n < (d - (bw - 0.12)) / 0.12) continue;   // dithered inner edge into the grass
        if (kind === 'sand') {
          let col = d < 0.05 ? sand[1] : sand[toneAt(n, x, r, TH_GROUND, 0.1)];
          if (n > 0.965) { col = lime[4]; }                                    // shell flecks
          else if (n > 0.95) col = lime[1];
          P.px(x, y, col);
        } else {
          let col = mud[toneAt(n, x, r, TH_GROUND, 0.1) >> 1];                    // tones 0–2 only: a wet, dark bank
          if (d < 0.08 && ((x + r) & 1) === 0) col = mix(mud[3], ws[2], 0.5);     // wet sheen at the waterline
          if (d < 0.03) col = mud[0];
          P.px(x, y, col);
        }
      }
    }
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });
  M.registerPainter('tone', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, 0, 0);
    P.diamond(g.cx, g.cy, TW, TH, spec.sub === 'cool' ? COOL : WARM);
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });

  // ---------------------------------------------------------------------------
  // reeds (12×14, variants 0–2, 2 sway frames), knees (64×32 tile overlay, variant = position bits), worn (64×32 overlay), mound (24×14)
  // ---------------------------------------------------------------------------
  M.registerPainter('reeds', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = begin(ctx, 12, 14, spec.zoom);
    const v = spec.variant % 3, f = spec.frame % 2, seed = hash(0x2ee, v), R = RAMPS.reed;
    const n = 5 + (hash(seed, 1) % 3);
    for (let i = 0; i < n; i++) {
      const x0 = 2 + (hash(seed, 10 + i) % 8), len = 7 + (hash(seed, 20 + i) % 7);
      const lean = ((hash(seed, 30 + i) % 3) - 1) + f;   // frame 1 leans one more px to the right
      const col = (i & 1) ? R[2] : R[1];
      for (let k = 0; k < len; k++) { const y = 13 - k, x = x0 + Math.round(lean * k / len); if (x >= 0 && x < 12 && y >= 0) P.px(x, y, k === len - 1 ? R[4] : (k > len - 4 ? R[3] : col)); }
    }
    { const x = 3 + (hash(seed, 40) % 6), y = 1 + (hash(seed, 50) % 3); P.vline(x + f, y, 3, RAMPS.sand[1]); P.px(x + f, y, RAMPS.reed[4]); }   // one seed head
    P.hline(2, 13, 8, RAMPS.marshMud[0]);   // the clump's shadow at the waterline
    return { w: g.w, h: g.h, ox: -6, oy: -13 };
  });
  // art pass B2: knees are a tile overlay (64×32 at the tile centre) whose variant is the tile's position bits (tx & 7 | (ty & 7) << 3):
  // it samples the marsh painter's periodic field, so the knees cluster on the mud rim of the standing-water pools and cross tile edges
  M.registerPainter('knees', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, 0, 0);
    const pv = spec.variant & 63, seed = hash(pv, 0x4ee), B = RAMPS.bark;
    const fseed = hash(((BSU.T && BSU.T.MARSH) || 2) * 131 + 7, 0x51), X0 = ((pv & 7) - (pv >> 3)) * 32 + 256, Y0 = ((pv & 7) + (pv >> 3)) * 16;
    const cx = g.cx, cy = g.cy, top = cy - 16;
    const cand = [];
    for (let r = 4; r < TH - 3; r += 2) {
      const half = diamondHalf(TW, TH, r) - 3;
      for (let x = cx - half; x < cx + half; x += 3) {
        const n = 0.55 * pnoise(fseed, X0 + x - cx, Y0 + r - 16, 16, 8, 256, 128) + 0.30 * pnoise(fseed + 7, X0 + x - cx, Y0 + r - 16, 8, 4, 256, 128) + 0.075;
        if (n > 0.37 && n < 0.49) cand.push([x, top + r]);                       // the pool's mud rim (the tile painter floods n < 0.40, muds < 0.45)
      }
    }
    const knees = [];
    if (cand.length) {
      const c0 = cand[hash(seed, 1) % cand.length]; knees.push(c0);
      for (let i = 0; i < cand.length && knees.length < 6; i++) { const c = cand[(i * 7 + hash(seed, 2)) % cand.length]; if (Math.abs(c[0] - c0[0]) <= 14 && Math.abs(c[1] - c0[1]) <= 7 && !knees.some(k => Math.abs(k[0] - c[0]) < 3 && Math.abs(k[1] - c[1]) < 2)) knees.push(c); }
    } else { const n = 2 + (hash(seed, 3) % 2); for (let i = 0; i < n; i++) knees.push([cx - 8 + (hash(seed, 10 + i) % 16), cy + (hash(seed, 20 + i) % 6) - 2]); }
    knees.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < knees.length; i++) {
      const x = knees[i][0], y = knees[i][1], kh = 3 + (hash(seed, 30 + i) % 3);
      P.px(x, y - kh, B[4]); P.px(x + 1, y - kh, B[3]); for (let yy = y - kh + 1; yy < y; yy++) { P.px(x, yy, B[2]); P.px(x + 1, yy, B[1]); } P.hline(x, y, 2, B[0]);
    }
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });
  M.registerPainter('worn', function (ctx, spec) {
    const P = pen(ctx, spec.zoom);
    const g = tileCanvas(ctx, spec.zoom, 0, 0);
    const v = spec.variant % 3, dirt = (spec.variant & 4) !== 0, seed = hash(0x0e0, v + (dirt ? 8 : 0));   // art pass B1: bit 4 = dirt tones (wear beside paths) instead of gravel
    const c1 = dirt ? RAMPS.dirt[2] : PAL.gravel, c2 = dirt ? RAMPS.dirt[1] : shade(PAL.gravel, 0.85);
    for (let r = 1; r < TH; r++) { const half = diamondHalf(TW, TH, r); for (let x = g.cx - half; x < g.cx + half; x++) { const d = diamondDist(x, g.cy - 16 + r, g.cx, g.cy); const dens = (dirt ? 0.3 : 0.4) * Math.max(0, 1 - d * d); const n = hash(seed, x + r * 131) % 1000; if (n < dens * 1000) P.px(x, g.cy - 16 + r, (n & 1) ? c1 : c2); } }
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
    const kind = Math.max(1, Math.min(5, parseInt(spec.sub, 10) || 1));   // 5 = Pedestrian Bridge (bridge pass): palette icon + ghost only; the map strokes decks
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
    } else if (kind === BSU.SURF.BRIDGE) {
      // Pedestrian Bridge (bridge pass): concrete piers, a pale stone deck with a darker kerb, purple truss rails with gold caps
      const t = 14;
      bridgeUnder(P, cx, cy, mask, t);
      strip(P, cx, cy, mask, t, (k, j, d, edge) => {
        if (edge) return shade(X.concrete, 0.72);
        if (j === 1 || j === t - 2) return shade(X.concrete, 1.1);
        const n = hash(seed, k + j * 17 + (d ? d.bit * 100 : 0)) % 100;
        return (k % 5 === 4) ? shade(X.concrete, 0.9) : n < 8 ? shade(X.concrete, 1.06) : X.concrete;   // expansion joints every 5 px
      });
      const dirs = DIRS.filter(d => mask & d.bit); const list = dirs.length ? dirs : [DIRS[0], DIRS[2]];
      for (const d of list) for (let k = 0; k <= 16; k++) {
        const x = cx + d.dx * k, yTop = cy + d.dy * (k >> 1) - (t >> 1);
        P.rect(x, yTop - 7, 1, 2, PAL.purple); P.rect(x, yTop + t - 8, 1, 2, PAL.purple2);
        if ((k & 1) === 0) { P.px(x, yTop - 4, PAL.purpleShadow); P.px(x, yTop + t - 5, PAL.purpleShadow); }   // truss diagonals read as a dotted lower chord
        if (k % 8 === 0) { P.vline(x, yTop - 6, 6, PAL.purpleShadow); P.vline(x, yTop + t - 7, 6, PAL.purpleShadow); P.px(x, yTop - 8, PAL.gold); P.px(x, yTop + t - 9, PAL.gold); }
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
        if (inDiamond(x, y1, cx, cy) && ((x >> 2) & 1)) P.px(x, y1, RAMPS.waterShallow[3]);
        if (inDiamond(x, y2, cx, cy) && ((x >> 2) & 1) === 0) P.px(x, y2, RAMPS.waterShallow[2]);
      }
      for (let i = 0; i < 3; i++) { const x = cx - 20 + (hash(seed, 10 + i) % 40), y = cy - 8 + (hash(seed, 20 + i) % 16); if (inDiamond(x, y, cx, cy)) { P.px(x, y, RAMPS.waterShallow[4]); P.px(x + 1, y, RAMPS.waterShallow[3]); } }
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
    firefly: { w: 4, h: 4, color: X.firefly, a: 1 }, eye: { w: 3, h: 3, color: PAL.danger, a: 1 }, mast: { w: 48, h: 96, color: X.white, a: 0.9, cone: true },
    canal: { w: 32, h: 32, color: X.glass, a: 0.85 }   // render_fx stretches it 2:1 over a dug canal tile at night
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
  // Vegetation (art pass B2, docs/ART_STYLE.md §9) — oak / cypress / palmetto / azalea from 5-tone ramps.
  // variant = stage 0–2 | autumn 4 (cypress) | bloom 8 (azalea) | silhouette (0–3) << 4 | water 64 (cypress on a wet tile).
  // Anchor = the trunk base at the tile centre: ox −w/2, oy −h + 4. Light from the upper-left; tone-0 outline on the
  // shadow side and the bottom of every silhouette, tone 3/4 on the lit top edge; dappled undersides in tones 0–1.
  // ---------------------------------------------------------------------------
  /** stage | (autumn ? 4 : 0) | (bloom ? 8 : 0) | (sil & 3) << 4 | (water ? 64 : 0) */
  M.treeVariant = function (stage, autumn, bloom, sil, water) { return (Math.max(0, Math.min(2, stage | 0))) | (autumn ? 4 : 0) | (bloom ? 8 : 0) | (((sil | 0) & 3) << 4) | (water ? 64 : 0); };
  M.TREE_SIL_SHIFT = 4; M.TREE_WATER = 64;
  const TH_LEAF = [0.12, 0.34, 0.68, 0.90];

  /** a lit, dithered canopy of ellipse blobs [cx, cy, rx, ry] from a 5-tone ramp R; returns the bottom-edge points (for moss)
   *  with `.inside` (a Uint8Array w×h mask, for limbs drawn between the clusters) */
  function canopy(P, blobs, w, h, R, seed, opts) {
    opts = opts || {};
    if (!Array.isArray(R)) R = makeRamp(R);                 // legacy callers passed a base hex
    const inside = new Uint8Array(w * h), bestV = new Float32Array(w * h), bestI = new Int8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let best = -1, bi = -1;
      for (let i = 0; i < blobs.length; i++) { const b = blobs[i]; const v = P.ellipseTest(x + 0.5, y + 0.5, b[0], b[1], b[2], b[3]); if (v > best) { best = v; bi = i; } }
      const n = hash(seed, x + y * 257) % 100;
      let inn = best > 0;
      if (inn && best < 0.07 && (n & 1)) inn = false;                       // ragged leaf edge
      if (inn && best < 0.14 && n < 18) inn = false;
      const k = y * w + x; inside[k] = inn ? 1 : 0; bestV[k] = best; bestI[k] = bi;
    }
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : inside[y * w + x];
    const bottoms = []; bottoms.inside = inside; bottoms.w = w; bottoms.h = h;
    const cell = opts.cell || 5, under0 = opts.under === undefined ? 0.62 : opts.under;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (!inside[k]) {
        if (opts.outline !== false && (at(x - 1, y) || at(x, y - 1)) && (hash(seed, 5000 + x + y * 257) % 100) < 85) P.px(x, y, R[0]);   // outline: shadow side + bottom
        continue;
      }
      const b = blobs[bestI[k]];
      const lit = ((b[0] - x) / b[2]) * 0.38 + ((b[1] - y) / b[3]) * 0.72;                     // + toward the upper-left of each cluster
      const tex = 0.6 * vnoise(seed, x, y * 2, cell) + 0.4 * ((hash(seed, 31 + x + y * 131) & 255) / 256);
      let v = 0.55 + lit * 0.4 + (tex - 0.5) * 0.45;
      const under = (y - b[1]) / b[3]; if (under > 0.3) v -= (under - 0.3) * 0.6;                // the cluster's own underside
      if (y > h * under0) v -= (y / h - under0) * 0.7;                                            // the canopy's dappled underside
      if (y > h * under0 && tex > 0.8) v += 0.25;                                                // sun holes in the underside
      const edgeTop = !at(x, y - 1) || !at(x - 1, y), edgeBot = !at(x, y + 1) || !at(x + 1, y);
      if (edgeTop && lit > 0.05) v += 0.3;
      let t = toneAt(v, x, y, TH_LEAF, 0.12);
      if (tex > 0.92 && v > 0.35) t = Math.min(4, t + 1);                                        // sun flecks
      if (edgeBot && !edgeTop && t > 1) t = 1;                                                    // the shaded lower rim
      P.px(x, y, R[t]);
      if (!at(x, y + 1)) bottoms.push([x, y]);
    }
    return bottoms;
  }
  /** a bark-ramp trunk: lit left column, tone-0 right outline, flecks; `flare` px of buttress spread over the bottom `flareH` rows */
  function trunk(P, x, top, w, h, flare, flareH) {
    const R = RAMPS.bark; flare = flare === true ? 2 : (flare | 0); flareH = flareH || Math.min(h, 4);
    for (let y = top; y < top + h; y++) {
      const fy = y - (top + h - flareH), ex = (flare && fy >= 0) ? Math.round(flare * (fy + 1) / flareH) : 0;
      const x0 = x - ex, x1 = x + w - 1 + ex, span = Math.max(1, x1 - x0);
      for (let xx = x0; xx <= x1; xx++) {
        const f = (xx - x0) / span;
        let t = f < 0.2 ? 3 : f < 0.5 ? 2 : f < 0.86 ? 1 : 0;
        if (span >= 4 && xx === x0 && (y & 3) === 1) t = 4;                                       // sheen on the lit edge
        if (ex > 0 && span >= 5 && ((xx - x0 + fy) % 3) === 1 && f > 0.1 && f < 0.9) t = Math.max(0, t - 1);   // buttress flutes
        if (t > 0 && t < 3 && (hash(0xba2, xx * 7 + y * 97) % 100) < 12) t -= 1;                 // bark flecks
        if (y === top + h - 1) t = 0;                                                             // bottom outline
        P.px(xx, y, R[t]);
      }
    }
  }
  /** a limb `thick` px deep from (x0,y0) to (x1,y1): tone 3 on top, 2 inside, 0 beneath; `mask(x, y)` true = covered by foliage */
  function limb(P, x0, y0, x1, y1, thick, mask) {
    const R = RAMPS.bark;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, n = 0;
    for (;;) {
      for (let k = 0; k < thick; k++) { const y = y0 + k; if (!mask || !mask(x0, y)) P.px(x0, y, R[k === 0 ? 3 : (k === thick - 1 ? 0 : 2)]); }
      if ((x0 === x1 && y0 === y1) || ++n > 512) break;
      const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function shadowEllipse(P, cx, cy, rx, ry, c) { P.ellipse(cx, cy, rx, ry, c); }
  /** Spanish moss from the canopy's bottom points in three length classes (short / mid / long), two tones plus a lit tip */
  function mossStrands(P, bottoms, n, seed, minLen, maxLen, h) {
    if (!bottoms.length) return;
    const R = RAMPS.moss, span = Math.max(1, maxLen - minLen);
    for (let i = 0; i < n; i++) {
      const b = bottoms[hash(seed, 700 + i) % bottoms.length];
      const cls = hash(seed, 750 + i) % 3;                                        // 0 short, 1 mid, 2 long
      const len = minLen + Math.round(span * (cls * 0.4 + (hash(seed, 800 + i) % 100) / 400));
      let x = b[0];
      for (let k = 1; k <= len; k++) {
        const y = b[1] + k; if (y >= h) break;
        if (k % 4 === 0) x += ((hash(seed, 900 + i * 31 + k) % 3) - 1);
        P.px(x, y, R[(k & 1) ? 1 : 2]);
        if (cls === 2 && (k % 3) === 1 && x > 0) P.px(x - 1, y, R[2]);           // long strands hang in two threads
      }
      P.px(x, Math.min(h - 1, b[1] + len + 1), R[3]);
    }
  }
  M.canopy = canopy; M.trunk = trunk; M.mossStrands = mossStrands; M.limb = limb;

  M.registerPainter('oak', function (ctx, spec) {
    const stage = Math.max(0, Math.min(2, spec.variant & 3)), sil = (spec.variant >> 4) & 3;
    const P = pen(ctx, spec.zoom), seed = hash(0x0ac, stage * 4 + sil), R = RAMPS.oakLeaf;
    const j = (k, m) => (hash(seed, 40 + k) % (2 * m + 1)) - m;                   // per-variant jitter ±m
    let g;
    if (stage === 0) {
      g = begin(ctx, 8, 14, spec.zoom);
      shadowEllipse(P, 4, 12, 3, 1, RAMPS.grass[1]);
      trunk(P, 3, 7, 2, 4, 0);
      canopy(P, [[4 + (sil & 1), 4 + (sil >> 1), 3.5, 3.4]], 8, 9, R, seed, { under: 0.7 });
    } else if (stage === 1) {
      g = begin(ctx, 40, 36, spec.zoom);
      shadowEllipse(P, 20, 33, 12, 3, RAMPS.grass[1]);
      const lx = 8 + j(0, 2), rx = 32 + j(1, 2), ly = 18 + j(2, 1), ry = 18 + j(3, 1);
      const blobs = [[20 + j(4, 1), 12, 15, 8], [lx, ly, 9, 6], [rx, ry, 9, 6], [20 + j(5, 2), 6, 9, 5]];
      if (sil === 3) { blobs[1][2] = 7; blobs[2][2] = 7; blobs[0][3] = 9.5; }       // narrow, tall
      const bottoms = canopy(P, blobs, 40, 30, R, seed, { under: 0.6 });
      const mask = (x, y) => (x >= 0 && y >= 0 && x < 40 && y < 30) ? bottoms.inside[y * 40 + x] : 0;
      trunk(P, 18, 22, 4, 10, 2, 4);
      limb(P, 19, 24, lx, ly + 3, 2, mask); limb(P, 21, 24, rx, ry + 3, 2, mask);
      mossStrands(P, bottoms.filter(b => b[1] > 14 && Math.abs(b[0] - 20) > 3), 4 + (sil & 1), seed, 3, 9, 36);
    } else {
      g = begin(ctx, 96, 56, spec.zoom);
      shadowEllipse(P, 48, 53, 30, 3, RAMPS.grass[1]);
      // four silhouettes: 0 full symmetric (the quad's oak and the icon), 1 left-heavy, 2 right-heavy, 3 two crowns with the limbs showing
      const lx = (sil === 1 ? 16 : sil === 2 ? 24 : 19) + j(0, 2), rx = (sil === 2 ? 80 : sil === 1 ? 72 : 77) + j(1, 2);
      const ly = (sil === 1 ? 29 : 26) + j(2, 1), ry = (sil === 2 ? 29 : 26) + j(3, 1);
      const blobs = [[48 + j(4, 2), 19 + j(5, 1), 27, 12], [lx, ly, sil === 1 ? 17 : 14, sil === 1 ? 9.5 : 8.5], [rx, ry, sil === 2 ? 17 : 14, sil === 2 ? 9.5 : 8.5],
        [34 + j(6, 2), 11, 15, 7.5], [62 + j(7, 2), 10, 15, 7.5], [48 + j(8, 3), 6, 11, 5.5]];
      if (sil === 3) { blobs[0] = [40, 17, 19, 11]; blobs.push([64, 16, 17, 10]); blobs[5] = [42, 6, 10, 5.5]; blobs[4] = [66, 9, 12, 6.5]; }
      else blobs.push([48 + j(9, 4), 27, 11, 4.5]);                                   // a hanging lower cluster (the limbs show either side)
      const bottoms = canopy(P, blobs, 96, 44, R, seed, { under: 0.64, cell: 6 });
      const mask = (x, y) => (x >= 0 && y >= 0 && x < 96 && y < 44) ? bottoms.inside[y * 96 + x] : 0;
      trunk(P, 45, 34, 6, 18, 4, 6);
      limb(P, 46, 36, lx + 2, ly + 4, 2, mask); limb(P, 50, 36, rx - 2, ry + 4, 2, mask);
      limb(P, 47, 35, 36 + j(10, 3), 22, 2, mask); limb(P, 49, 35, 60 + j(11, 3), 21, 2, mask);
      if (sil === 1) limb(P, 46, 37, 10, 33, 2, mask); else if (sil === 2) limb(P, 50, 37, 86, 32, 2, mask);
      mossStrands(P, bottoms.filter(b => b[1] > 20 && Math.abs(b[0] - 48) > 5), 9 + (sil & 1) * 2, seed, 4, 14, 56);
    }
    return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
  });

  M.registerPainter('cypress', function (ctx, spec) {
    const stage = Math.max(0, Math.min(2, spec.variant & 3)), autumn = !!(spec.variant & 4), sil = (spec.variant >> 4) & 3, water = !!(spec.variant & 64);
    const P = pen(ctx, spec.zoom), seed = hash(0xc7, stage * 4 + sil);
    const R = autumn ? RAMPS.cypressRust : RAMPS.cypressLeaf, B = RAMPS.bark;
    const sizes = [[6, 16, 2, 4, 0, 2], [16, 48, 4, 11, 2, 4], [24, 80, 6, 24, 4, 8]][stage];   // w, h, trunk w, trunk h, flare, flare rows
    const g = begin(ctx, sizes[0], sizes[1], spec.zoom);
    const w = g.w, h = g.h, tw = sizes[2], th = sizes[3], cx = w >> 1, base = h - 4;
    const folTop = 1, folBot = base - th + (stage === 2 ? 6 : stage === 1 ? 3 : 1);
    if (water) {   // reflection-friendly base: a tone-0 waterline ring and a dithered trunk reflection under the anchor
      const half = (tw >> 1) + sizes[4] + 1;
      P.hline(cx - half, base, 2 * half, B[0]);
      for (let y = base + 1; y < h; y++) for (let x = cx - half + 1; x < cx + half - 1; x++) if (((x + y) & 1) === 0) P.px(x, y, mix(B[1], RAMPS.waterDeep[1], 0.55));
      P.px(cx - half - 1, base, RAMPS.waterShallow[4]); P.px(cx + half, base + 1, RAMPS.waterShallow[3]);
    } else shadowEllipse(P, cx, h - 3, (w >> 1) - 1, 2, RAMPS.wet[0]);
    trunk(P, cx - (tw >> 1), base - th, tw, th, sizes[4], sizes[5]);
    if (stage > 0) {   // knees at the base, outside the buttress
      const n = 2 + (hash(seed, 1) % 3);
      for (let i = 0; i < n; i++) {
        const x = (i & 1) ? cx + (tw >> 1) + sizes[4] + 1 + (i >> 1) * 2 : cx - (tw >> 1) - sizes[4] - 3 - (i >> 1) * 2, kh = 2 + (hash(seed, 10 + i) % 3);
        if (x < 0 || x > w - 2) continue;
        P.px(x, base - kh, B[3]); P.px(x + 1, base - kh, B[2]); for (let y = base - kh + 1; y < base; y++) { P.px(x, y, B[2]); P.px(x + 1, y, B[1]); } P.hline(x, base, 2, B[0]);
      }
    }
    // tapered crown: a spindle of feathered sprays (widest at 65 % of the height, each spray's reach from the seed; sil 3 = the
    // flat-topped old cypress), tone 3 on the lit left, 2 in the middle, 1 at the shadow rim, a ragged tone-0 underside per spray
    const tier = stage === 2 ? 6 : stage === 1 ? 5 : 3, phase = hash(seed, 2) % tier, lean = stage > 0 ? ((hash(seed, 3) % 3) - 1) : 0;
    const flat = sil === 3 && stage === 2;
    for (let y = folTop; y <= folBot; y++) {
      const t = (y - folTop) / Math.max(1, folBot - folTop);
      const ti = Math.floor((y - folTop + phase) / tier), ph = (y - folTop + phase) % tier;
      const env = flat ? Math.min(1, 0.45 + t) : (t < 0.65 ? Math.pow(t / 0.65, 0.8) : 1 - (t - 0.65) * 0.45);
      const tierK = stage === 0 ? 1 : 0.8 + (hash(seed, 60 + ti) % 40) / 100;
      let hw = 0.6 + ((w >> 1) - 1) * env * tierK;
      hw += ph >= tier - 2 ? 1.0 : ph === 0 ? -1.2 : ph === 1 ? -0.4 : 0;               // each spray widens downward; a tuck between sprays
      const tipX = cx + Math.round(lean * (1 - t));
      const hwI = Math.round(hw);
      for (let x = tipX - hwI; x <= tipX + hwI; x++) {
        if (x < 0 || x >= w) continue;
        const f = (x - tipX) / Math.max(1, hw), af = Math.abs(f), n = hash(seed, x + y * 131) % 100;
        if (af > 0.65 && (n % 3 === 0)) continue;                                      // feathery edge
        if (af > 0.85 && (n & 1)) continue;
        const tex = vnoise(seed, x * 2, y, 4);
        let tn = f < -0.25 ? 3 : f < 0.4 ? 2 : 1;
        if (tex > 0.68 && tn < 3) tn++; else if (tex < 0.3 && tn > 1) tn--;
        if (ph === tier - 1) { tn = (n < 55) ? 0 : 1; if (af > 0.5 && n < 30 && y + 1 <= folBot + 1) P.px(x, y + 1, R[0]); }   // ragged underside with drips
        else if (ph <= 1 && f < 0.2) tn = Math.min(4, tn + 1);                          // the lit top of each spray
        if (f > 0.85) tn = Math.min(tn, 1);                                              // shadow-side rim
        if (stage > 0 && Math.abs(x - tipX) < 1 && ph === 0 && y > folTop + 3) tn = -1;  // the trunk between sprays
        P.px(x, y, tn < 0 ? B[1] : R[tn]);
      }
    }
    P.px(cx + lean, folTop, R[4]); if (folTop > 0) P.px(cx + lean, folTop - 1, R[3]);
    return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
  });

  M.registerPainter('palmetto', function (ctx, spec) {
    const stage = Math.max(0, Math.min(2, spec.variant & 3)), sil = (spec.variant >> 4) & 1;
    const P = pen(ctx, spec.zoom), seed = hash(0x9a1, stage * 2 + sil), R = RAMPS.palmLeaf, B = RAMPS.bark;
    const sz = [[12, 10], [18, 15], [24, 20]][stage];
    const g = begin(ctx, sz[0], sz[1], spec.zoom);
    const w = g.w, h = g.h, cx = w >> 1, cy = h - 4;
    shadowEllipse(P, cx, h - 2, (w >> 1) - 1, 1.5, RAMPS.wet[0]);
    P.ellipse(cx, cy, Math.max(2, w >> 2), Math.max(1.5, h / 7), R[0]);                 // the dark base clump
    P.rect(cx - 1, h - 5, 2, 3, B[2]); P.px(cx - 1, h - 5, B[3]); P.hline(cx - 1, h - 3, 2, B[0]);
    // fan fronds: each a petiole to a hand, then 5–7 rays; back fronds (upper, shorter) in the shadow tone, front fronds lit on the left
    const n = 4 + stage * 2, spread = sil ? 0.75 : 1.0;                                  // variant 1 = upright, variant 0 = spreading
    const fr = (len, col, tip, a, k) => {
      const L = len * (0.85 + (hash(seed, 50 + k) % 30) / 100);
      const hx = cx + Math.cos(a) * L * 0.55 * 1.2, hy = cy + Math.sin(a) * L * 0.55 * 0.8;
      P.line(cx, cy, hx, hy, col);
      const rays = 5 + (stage > 0 ? 2 : 0);
      for (let r = 0; r < rays; r++) {
        const ra = a + (r / (rays - 1) - 0.5) * 1.1, rl = L * 0.5 * (0.7 + 0.3 * Math.sin((r / (rays - 1)) * Math.PI));
        const ex = hx + Math.cos(ra) * rl * 1.2, ey = hy + Math.sin(ra) * rl * 0.8;
        P.line(hx, hy, ex, ey, col); P.px(Math.round(ex), Math.round(ey), tip);
      }
    };
    for (let i = 0; i < n; i++) { const a = -Math.PI * 0.5 + (i / (n - 1) - 0.5) * Math.PI * 0.9 * spread + ((hash(seed, i) % 7) - 3) * 0.03; fr((h - 4) * 0.8, R[1], R[2], a, i); }           // back row (up)
    for (let i = 0; i < n; i++) { const a = Math.PI + 0.25 + (Math.PI - 0.5) * (i / (n - 1)) * spread + (1 - spread) * 1.2 + ((hash(seed, 20 + i) % 7) - 3) * 0.03; const lit = Math.cos(a) < 0; fr(h - 4, lit ? R[3] : R[2], lit ? R[4] : R[1], a, 20 + i); }   // front row
    P.px(cx, cy - 1, R[4]);
    return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
  });

  M.registerPainter('azalea', function (ctx, spec) {
    const stage = Math.max(0, Math.min(2, spec.variant & 3)), bloom = !!(spec.variant & 8), sil = (spec.variant >> 4) & 3;
    const P = pen(ctx, spec.zoom), seed = hash(0xa2, stage * 4 + sil), R = RAMPS.azaleaLeaf, F = RAMPS.azaleaBloom, B = RAMPS.bark;
    const sz = stage === 0 ? [10, 6] : [16, 10];
    const g = begin(ctx, sz[0], sz[1], spec.zoom);
    const w = g.w, h = g.h, cx = w >> 1;
    shadowEllipse(P, cx, h - 1, (w >> 1) - 0.5, 1, RAMPS.grass[1]);
    if (stage === 0) {   // shredded: bare twigs, a few leaves, a bloom or two
      for (let i = 0; i < 3; i++) { const x = 2 + i * 3 + (sil & 1); P.vline(x, 1 + (i & 1), 3, B[2]); P.px(x, 1 + (i & 1), B[3]); P.px(x + 1, 3, R[2]); if (bloom && (hash(seed, i) & 1)) P.px(x - 1, 2, F[2]); }
      return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
    }
    const blobs = [[cx - 3 + (sil & 1), 5.5, 5.5, 3.8], [cx + 3 - (sil >> 1), 5.5, 5.5, 3.8], [cx + ((sil & 1) ? 1 : -1), 3.5 + (stage === 2 ? -0.5 : 0), 4.5, 3]];
    const bottoms = canopy(P, blobs, w, h - 1, R, seed, { under: 0.7, cell: 3 });
    if (bloom) {   // blossom clusters: a tone-2 plus with a warm petal highlight on its upper-left and a deep centre
      const k = 5 + stage * 2;
      for (let i = 0; i < k; i++) {
        const x = 2 + (hash(seed, 100 + i) % (w - 4)), y = 1 + (hash(seed, 130 + i) % (h - 5));
        if (!bottoms.inside[y * w + x]) continue;
        P.px(x, y, F[2]); P.px(x - 1, y, F[2]); P.px(x + 1, y, F[1]); P.px(x, y - 1, F[3]); P.px(x, y + 1, F[1]); P.px(x - 1, y - 1, F[4]);
      }
    }
    return { w: g.w, h: g.h, ox: -(g.w >> 1), oy: -g.h + 4 };
  });

  /** understory shrub for marsh edges (22×12, variants 0–3): a low leafy mound draped with Spanish moss; anchored at its base */
  M.registerPainter('shrub', function (ctx, spec) {
    const P = pen(ctx, spec.zoom), v = spec.variant & 3, seed = hash(0x5b, v), R = RAMPS.azaleaLeaf;
    const g = begin(ctx, 22, 12, spec.zoom);
    P.hline(4, 11, 14, RAMPS.marshMud[0]);
    const blobs = [[8 + (v & 1) * 2, 7, 6.5, 4], [14 - (v >> 1), 7, 6, 3.8], [11 + ((v & 1) ? -2 : 2), 4.5, 5, 3.2]];
    const bottoms = canopy(P, blobs, 22, 11, R, seed, { under: 0.7, cell: 3 });
    mossStrands(P, bottoms.filter(b => b[1] < 9), 3 + (v & 1), seed, 2, 5, 11);
    for (let i = 0; i < 2 + (v & 1); i++) { const x = 3 + (hash(seed, 20 + i) % 16), y = 1 + (hash(seed, 30 + i) % 3); P.px(x, y, RAMPS.moss[3]); P.px(x, y + 1, RAMPS.moss[2]); P.px(x + ((i & 1) ? 1 : -1), y + 2, RAMPS.moss[2]); }   // moss hung over the top
    return { w: g.w, h: g.h, ox: -11, oy: -10 };
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
      for (let t = 0; t < 8; t++) for (let v = 0; v < 8; v++) M.get('tile:' + t, v, 0, 1);
      for (let t = 0; t < 8; t += 7) for (let v = 0; v < 8; v++) M.get('tile:' + t, v | 8, 0, 1);
      for (let v = 0; v < 4; v++) { M.get('tuft', v, 0, 1); M.get('tuft:high', v, 0, 1); M.get('patch:clover', v, 0, 1); M.get('patch:dirt', v, 0, 1); M.get('patch:lime', v, 0, 1); }
      M.get('tone:warm', 0, 0, 1); M.get('tone:cool', 0, 0, 1);
      for (const h of CLIFF_PREBAKE) { M.get('cliff', h, 0, 1); M.get('cliff', h, 1, 1); }
      for (let s = 1; s <= 5; s++) for (let m = 0; m < 16; m++) M.get('surf:' + s, m, 0, 1);
      for (let m = 0; m < 16; m++) { M.get('levee', m, 0, 1); M.get('floodwall', m, 0, 1); M.get('canal', m, 0, 1); M.get('preservePost', m, 0, 1); }
      M.get('water', 0, 0, 1); M.get('water', 1, 0, 1);
      for (let v = 0; v < 3; v++) { M.get('reeds', v, 0, 1); M.get('reeds', v, 1, 1); M.get('knees', v, 0, 1); M.get('worn', v, 0, 1); }
      M.get('mound', 0, 0, 1);
      for (let v = 0; v < 4; v++) M.get('shrub', v, 0, 1);
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
      for (let i = 0; i < 50; i++) { const v = tileVariant(i * 7, i * 3); check(v >= 0 && v <= 7 && v === tileVariant(i * 7, i * 3), 'tileVariant stable/in range'); }
      // 3. agentLook packing and distribution
      let sh = [0, 0, 0];
      for (let s = 0; s < 1000; s++) { const l = M.agentLook(s); const skin = l & 7, hair = (l >> 3) & 7, shirt = (l >> 6) & 3; check(skin < 6 && hair < 8 && shirt < 3, 'agentLook fields (art pass B4: bits 9+ carry outfit, hair style, carry, hat, build)'); sh[shirt]++; }
      check(Math.abs(sh[0] - 550) <= 50 && Math.abs(sh[1] - 250) <= 50 && Math.abs(sh[2] - 200) <= 50, 'shirt distribution 55/25/20 ±5 (got ' + sh.join('/') + ')');
      // 6. every terrain-side id resolves with the documented sizes
      for (let t = 0; t < 8; t++) for (let v = 0; v < 8; v++) { const e = need('tile:' + t, v); check(e && e.sw === 64 && e.sh === 32 && e.ox === -32 && e.oy === -16, 'tile size/anchor'); }
      for (let m = 1; m < 16; m += 5) { const a = need('shore:sand', m), b = need('shore:mud', m), c = need('shore:ripple', m); check(a && b && c && a.sw === 64 && c.oy === -16, 'shore sprites 64×32 at the tile anchor'); }
      check(need('tuft', 0).sh === 6 && need('patch:lime', 1).sw === 16 && need('tone:cool', 0).sw === 64, 'tuft / patch / tone sizes');
      check(Object.keys(RAMPS).length >= 12 && RAMPS.grass.length === 5 && RAMPS.grass[2] === PAL.dryGrass, 'material ramps: 5 tones, base at index 2');
      check(need('cliff', 6).sh === 22 && need('cliff', 96).sh === 112 && need('cliff', 24, 1).ox === 0 && need('cliff', 24, 0).ox === -32, 'cliff sizes/anchors');
      for (let s = 1; s <= 5; s++) for (let m = 0; m < 16; m++) need('surf:' + s, m);
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
      check(M.treeVariant(2, true, false) === 6 && M.treeVariant(1, false, true) === 9 && M.treeVariant(2, false, false, 3, true) === (2 | 48 | 64), 'treeVariant packing (stage | autumn 4 | bloom 8 | sil << 4 | water 64)');
      for (let v = 0; v < 4; v++) { const r = need('shrub', v); check(r.sw === 22 && r.sh === 12, 'shrub ' + v); const o = need('oak', 2 | (v << 4)); check(o.sw === 96 && o.sh === 56, 'oak silhouette ' + v); }
      check(need('knees', 63).sw === 64 && need('knees', 63).sh === 32, 'knees tile overlay');
      // 7. frame totals and wrapping
      check((painters.agent ? M.frames('agent') === 64 && M.frames('agent:idle') === 24 && M.frames('gator') === 80 : M.frames('agent') === 16 && M.frames('agent:idle') === 8 && M.frames('gator') === 6) && M.frames('reeds') === 2 && M.frames('decal:crane') === 4, 'frame table (art pass B4: 8 facings × n for agents and gators once sprites_entities is loaded)');
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
        if (painters.agent) check(M.get('agent', 0, M.frames('agent') + 1, 1) === M.get('agent', 0, 1, 1), 'agent frame total + 1 wraps to 1');
      } else notes.push('building/entity painters not loaded: their checks skipped');
      for (const fn of M._tests) { try { const r = fn(); if (r && r.ok === false) fail('split test: ' + (r.notes || '')); } catch (e) { fail('split test threw: ' + (e && e.message)); } }
    } catch (e) { notes.push('threw: ' + (e && e.message)); return { ok: false, notes: notes.join('; ') }; }
    notes.push(cache.size + ' entries, ' + M.memoryMB().toFixed(2) + ' MB, ' + (Date.now() - t0) + ' ms');
    return { ok: !notes.some(n => n.startsWith('FAIL')), notes: notes.join('; ') };
  };
})();
