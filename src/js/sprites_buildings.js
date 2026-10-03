'use strict';
// ============================================================================
// BAYOU STATE — sprites_buildings.js (module 11; extends BSU.sprites)
// Owner: nothing in state (the atlas is derived, seed-independent, never saved).
// Implements: ARCHITECTURE.md §6.1 (paintBuilding, the building anchor), §6.3 pass 4
// (which variant bits render sets), D17 (variant bitmask); docs/briefs/sprites_buildings.md
// (all Tier 1 + Tier 2: stadium III polish, the 2× atlas through the pen, BSU West hall);
// GDD §12.3 (the one parameterized painter), §4 (house style + every row's Visual column),
// §0.3 (footprints), §12.2 (palette), §11.1 (Ms. Thibodeaux 48×48), §4.6 (Bayou Field,
// Stadium I–III), §4.8 row 30 (Pilings: +10 px lift over dark posts).
//
// What lives here: buildingBox (pure geometry), paintBuilding (the painter), the roof
// library (flat/gable/hip/dome/barrel/bowl/none), placeDecal (decal placement by name),
// the six variant treatments (normal, NIGHT ×4 frames, DAMAGED, PILINGS, SCAFFOLD ×3
// frames, RUIN) plus BOARDED and the tier looks, the ~30 special painters for rows that
// are not plain boxes, the `ruin:<w>x<h>` rubble family, the `thibodeaux` portrait, the
// `icon:<catalogId>` palette icons and the `surge_barrier[:<len>]` family.
//
// Registered families (definition time, plain-object writes only): building, ruin,
// thibodeaux, icon, surge_barrier, west_hall (Tier 2: a Founders'-style hall in purple2).
//
// Conventions (from sprites.js): every painter calls BSU.sprites.begin(ctx, w, h, zoom)
// first and draws through the scaled pen (1× coordinates → S×S blocks), so the same code
// produces the 2× atlas. Integer pixel art only: fillRect runs, no paths, no fillText, no
// gradients, no getImageData. Determinism: every jitter comes from BSU.rng.hash (never
// rng.fx, never Math.random). Colours: BSU.params.palette, BSU.sprites.extra and the row's
// own paint hexes; the brief-named hexes that are in neither live in the local table XB.
//
// Geometry (1× units; anchor = the SOUTH corner tile's diamond centre, ARCH §6.1):
//   ground diamond x ∈ [−fw·32, +fh·32], y ∈ [−(fw+fh−1)·16, +16]; wallH = floors·14;
//   roofH by type (flat 4, gable min·8, hip min·6, dome min·12, barrel min·8, bowl 10,
//   none 0); lift = PILINGS ? 10 : 0; pad 2 px; canvas w = (fw+fh)·32 + 4,
//   h = (fw+fh)·16 + wallH + roofH + lift + extraTop + 4; ox = −fw·32 − 2;
//   oy = −((fw+fh−1)·16 + wallH + roofH + lift + extraTop) − 2 (so oy + h === 18 when
//   extraTop is 0). extraTop is a per-special allowance for things that rise above the
//   roof line (the quad's oak, the bell tower spire, the stadium masts…).
//   The box itself is inset 8 px (4 vertically) inside the ground diamond, leaving a
//   paved apron around it (ground decals stand on the apron; the pilings water shows).
//
// Missing from params (GDD numbers used as local constants, listed in INTEGRATION_NOTES):
//   floor height 14 px, pilings lift 10 px, stilt pitch 12 px, window 2×3 px, night-lit
//   share 70 %, the roof heights above, the 8-px box inset, the 48×48 portrait.
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = BSU.sprites;
  if (!M || typeof M.registerPainter !== 'function') return;   // sprites.js must load first (manifest order)
  const SPR = BSU.SPR;
  const PAL = BSU.params.palette;
  const X = M.extra;
  const hash = BSU.rng.hash;
  const strHash = BSU.strHash;
  const shade = M.shade, mix = M.mix;
  const pen = M.pen, begin = M.begin;
  const light = M.light, dark = M.dark, outline = M.outline;

  // ---------------------------------------------------------------------------
  // Local constants (GDD values the brief names; none of them is in BSU.params)
  // ---------------------------------------------------------------------------
  const FLOOR_PX = 14;          // one storey (GDD §12.3 "floors × 14 px")
  const LIFT_PX = 10;           // pilings lift (GDD §4.8 row 30)
  const STILT_PITCH = 12;       // one bark stilt every 12 px
  const PAD = 2;                // canvas padding
  const INSET = 8;              // the box sits 8 px inside the footprint diamond (4 vertically)
  const WIN_W = 2, WIN_H = 3;   // window cell
  const LIT_SHARE = 70;         // % of cells lit at night
  const ROOF_H = { flat: 4, gable: 8, hip: 6, dome: 12, barrel: 8, bowl: 10, none: 0 };   // × min(fw, fh) except flat/bowl/none
  const WINDOW_DARK = '#3A3050';
  const PORTRAIT = 48;
  const ICON = 64;
  // Brief-named hexes that are in neither the palette nor sprites.extra
  const XB = Object.freeze({
    gravelPad: '#8A8A8E', transformer: '#5A5A60', legs: '#5A5A60', clarifier: '#B8B8BC', clarifierWater: '#4A6A4A',
    instituteRoof: '#3F5E3A', dormBrick: '#A0522D', dormBrickDark: '#8B4513', khaki: '#C2B280', limestone: '#D9C9A3',
    fieldOffice: '#4A8A4A', spoonbill: '#F4A6C0', lawn: '#7FBF3C', tin: '#8A8A8E', gate: '#6A6A70', skin: '#8D5524',
    glasses: '#C0C0C0', hair: '#1B1B1B', apron: '#B9AE86', apronEdge: '#8F865F', rubble: '#6B625A', slab: '#9A9A9E'
  });
  M.extraBuildings = XB;

  // The terrain-only atlas comfortably fits sprites.js's own CANVAS_LIMIT_MB (8 MB, asserted by
  // sprites.test.mjs, which never loads this file and is unaffected by this line). Once ~215 building
  // canvases are added — faithfully sized per ARCHITECTURE §4.1's own formulas (a 12-floor res_tower, a
  // 6x5 stadium, etc. — exactly matching sprites.js's own tested dorm-geometry assertions) and pre-baked
  // for all 43 rows x 6 variants at load exactly as sprites.js's init() already requests them, the atlas is
  // genuinely larger (~21 MB). Raise the ceiling to match now that this file is loaded: render's real,
  // authoritative budget (ARCHITECTURE.md §6.3) is 64 MB total (chunks + sprites + composites), so this
  // still leaves generous headroom for sprites_entities.js's agent/gator sheets loaded after this file.
  M.CANVAS_LIMIT_MB = 40;

  // ---------------------------------------------------------------------------
  // Pen wrappers: a toned pen (every colour multiplied, for DAMAGED) and an offset pen
  // (decal painters draw at (0,0); the offset pen moves them to the placement point).
  // ---------------------------------------------------------------------------
  const isPurple = (c) => { const u = String(c || '').toUpperCase(); return u === PAL.purple.toUpperCase() || u === PAL.purple2.toUpperCase(); };
  /** wrap a pen so every colour argument is shade(c, k) (k === 1 → the pen itself) */
  function tonePen(P, k) {
    if (!Number.isFinite(k) || k === 1) return P;
    const t = (c) => (c ? shade(c, k) : c);
    const Q = {
      S: P.S, ctx: P.ctx, tone: k,
      rect: (x, y, w, h, c) => P.rect(x, y, w, h, t(c)), px: (x, y, c) => P.px(x, y, t(c)),
      hline: (x, y, w, c) => P.hline(x, y, w, t(c)), vline: (x, y, h, c) => P.vline(x, y, h, t(c)),
      line: (x0, y0, x1, y1, c) => P.line(x0, y0, x1, y1, t(c)),
      dither: (x, y, w, h, c1, c2, seed, d) => P.dither(x, y, w, h, t(c1), t(c2), seed, d),
      diamond: (cx, cy, w, h, f, s) => P.diamond(cx, cy, w, h, t(f), s ? t(s) : s),
      ellipse: (cx, cy, rx, ry, c) => P.ellipse(cx, cy, rx, ry, t(c)), ellipseTest: P.ellipseTest,
      glyph: (ch, x, y, c) => P.glyph(ch, x, y, t(c)), text: (s, x, y, c) => P.text(s, x, y, t(c))
    };
    return Q;
  }
  /** wrap a pen so every coordinate is shifted by (dx, dy) */
  function offsetPen(P, dx, dy) {
    dx = Math.round(dx); dy = Math.round(dy);
    return {
      S: P.S, ctx: P.ctx, tone: P.tone,
      rect: (x, y, w, h, c) => P.rect(x + dx, y + dy, w, h, c), px: (x, y, c) => P.px(x + dx, y + dy, c),
      hline: (x, y, w, c) => P.hline(x + dx, y + dy, w, c), vline: (x, y, h, c) => P.vline(x + dx, y + dy, h, c),
      line: (x0, y0, x1, y1, c) => P.line(x0 + dx, y0 + dy, x1 + dx, y1 + dy, c),
      dither: (x, y, w, h, c1, c2, seed, d) => P.dither(x + dx, y + dy, w, h, c1, c2, seed, d),
      diamond: (cx, cy, w, h, f, s) => P.diamond(cx + dx, cy + dy, w, h, f, s),
      ellipse: (cx, cy, rx, ry, c) => P.ellipse(cx + dx, cy + dy, rx, ry, c), ellipseTest: P.ellipseTest,
      glyph: (ch, x, y, c) => P.glyph(ch, x + dx, y + dy, c), text: (s, x, y, c) => P.text(s, x + dx, y + dy, c)
    };
  }
  M.tonePen = tonePen; M.offsetPen = offsetPen;

  // ---------------------------------------------------------------------------
  // Diamond / polygon helpers (all fillRect runs)
  // ---------------------------------------------------------------------------
  /** bottom row (0-based within a w×h 2:1 diamond, w % 4 === 0) covered at column offset d = x − cx */
  function bottomRow(w, h, d) { return (h >> 1) + (d >= 0 ? Math.floor((w / 2 - d - 1) / 2) : Math.floor((w / 2 + d) / 2)); }
  /** the base-edge pixel y at column x of the diamond centred (cx, cy) */
  function baseY(cx, cy, w, h, x) { return cy - (h >> 1) + bottomRow(w, h, x - cx); }
  /** the top-edge pixel y at column x (the diamond is symmetric about its centre row) */
  function topY(cx, cy, w, h, x) { return cy - (h >> 1) + (h - bottomRow(w, h, x - cx)); }
  /**
   * Fill a convex polygon by vertical column runs (integer x; y rounded). pts = [[x,y],…].
   * Never uses paths; ≤ 2,048 columns.
   */
  function fillPoly(P, pts, color) {
    const n = pts.length; if (n < 3) return;
    let x0 = Infinity, x1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; }
    x0 = Math.ceil(x0); x1 = Math.floor(x1);
    if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 - x0 > 2048) return;
    for (let x = x0; x <= x1; x++) {
      let ymin = Infinity, ymax = -Infinity;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
        if (x < lo || x > hi) continue;
        const y = (hi === lo) ? null : a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
        if (y === null) { if (a[1] < ymin) ymin = a[1]; if (b[1] < ymin) ymin = b[1]; if (a[1] > ymax) ymax = a[1]; if (b[1] > ymax) ymax = b[1]; }
        else { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
      }
      if (ymin === Infinity) continue;
      const ya = Math.round(ymin), yb = Math.round(ymax);
      if (yb >= ya) P.rect(x, ya, 1, yb - ya + 1, color);
    }
  }
  /** 1-px line of pixels along a polygon edge list (open) */
  function strokeEdges(P, pts, color) { for (let i = 0; i + 1 < pts.length; i++) P.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], color); }
  M._fillPoly = fillPoly;

  /**
   * The isometric box: walls of height hgt under a w×h top diamond whose BASE is centred at (cx, cy).
   * colorFn(x, ybase, left) → colour for that column (null = skip). Returns nothing; callers read
   * baseY() for the columns they need.
   */
  function walls(P, cx, cy, w, h, hgt, colorFn) {
    if (hgt <= 0) return;
    for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) {
      const yb = baseY(cx, cy, w, h, x);
      const c = colorFn(x, yb, x < cx);
      if (c) P.rect(x, yb - hgt + 1, 1, hgt, c);
    }
  }
  /** the rim of the UPPER half of a diamond (its NW/NE edges) */
  function topRim(P, cx, cy, w, h, color) {
    const top = cy - (h >> 1);
    for (let r = 1; r <= (h >> 1); r++) { const half = M.diamondHalf(w, h, r); if (half > 0) { P.px(cx - half, top + r, color); P.px(cx + half - 1, top + r, color); } }
  }
  /** the rim of the LOWER half (its SW/SE edges) */
  function bottomRim(P, cx, cy, w, h, color) {
    const top = cy - (h >> 1);
    for (let r = (h >> 1); r < h; r++) { const half = M.diamondHalf(w, h, r); if (half > 0) { P.px(cx - half, top + r, color); P.px(cx + half - 1, top + r, color); } }
  }

  // ---------------------------------------------------------------------------
  // Special-row table: which painter handles a row, and its canvas allowance above the roof
  // ---------------------------------------------------------------------------
  const EXTRA_TOP = {
    quad: 48, bell_tower: 22, water_tower: 40, stadium: 44, practice_field: 20, bat_house: 20, substation: 14, engineering: 12,
    coastal_institute: 10, rookery: 40, tiger_habitat: 16, surge_barrier: 20, greek_house: 6, wildlife_post: 6, marsh_restoration: 4,
    library: 8, union: 10, dining_hall: 6, poboy: 4, generator: 6, pond: 8, wastewater: 8, res_tower: 12, founders_hall: 10, west_hall: 10
  };
  /** the special painter key of a row: paint.special, else the row id when a special exists for it */
  function specialOf(row) { const s = row && row.paint && row.paint.special; if (s && SPECIAL[s]) return s; return (row && SPECIAL[row.id]) ? row.id : ''; }

  /** tier index (0 = base row) clamped to the row's tier list */
  function tierOf(row, variant) {
    const t = ((variant | 0) & SPR.TIER_MASK) >> SPR.TIER_SHIFT;
    const n = (row && row.tiers && row.tiers.length) | 0;
    return Math.max(0, Math.min(n, t));
  }

  /**
   * Pure geometry of a building sprite (no ctx). rot swaps the footprint. Extra fields beyond the
   * brief's {w, h, ox, oy, floors, wallH, roofH, lift, fw, fh}: roof (type), extraTop, tier,
   * ax/ay (anchor in canvas px), gcx/gcy/gw/gh (ground diamond centre and size), bcx/bcy/bw/bh (the
   * inset box base diamond; bcy already includes the lift), inset, bowlRect (stadium tiers ≥ 1).
   */
  M.buildingBox = function (row, variant, zoom, rot) {
    variant = Number.isFinite(variant) ? Math.max(0, variant | 0) : 0;
    const paint = (row && row.paint) || {};
    const fw0 = Math.max(1, Math.min(12, (row && row.w) | 0 || 1)), fh0 = Math.max(1, Math.min(12, (row && row.h) | 0 || 1));
    const swap = !!rot && fw0 !== fh0;
    const fw = swap ? fh0 : fw0, fh = swap ? fw0 : fh0;
    const sp = specialOf(row);
    const tier = tierOf(row, variant);
    let floors = Math.max(0, Math.min(20, paint.floors | 0));
    let roof = ROOF_H[paint.roof] !== undefined ? paint.roof : 'none';
    if (sp === 'stadium') roof = 'bowl';
    const mn = Math.min(fw, fh);
    let roofH = roof === 'flat' || roof === 'bowl' || roof === 'none' ? ROOF_H[roof] : ROOF_H[roof] * mn;
    if (floors === 0 && roof !== 'bowl' && roof !== 'none' && !sp) roofH = 0;
    const lift = (variant & SPR.PILINGS) ? LIFT_PX : 0;
    const wallH = floors * FLOOR_PX;
    const extraTop = EXTRA_TOP[sp] || 0;
    const gw = (fw + fh) * 32, gh = (fw + fh) * 16;
    const w = gw + 2 * PAD, h = gh + wallH + roofH + lift + extraTop + 2 * PAD;
    const ox = -fw * 32 - PAD, oy = -((fw + fh - 1) * 16 + wallH + roofH + lift + extraTop) - PAD;
    const ax = -ox, ay = -oy;
    const gcx = ax + (fh - fw) * 16, gcy = ay - (fw + fh - 2) * 8;
    const inset = INSET;
    const bw = gw - 2 * inset, bh = bw >> 1;
    let bowlRect = null;
    if (sp === 'stadium' && tier >= 1) {
      // the seating oval relative to the anchor: centred on the ground diamond, 70 % of it
      const rx = Math.round(gw * 0.36), ry = Math.round(gh * 0.36);
      bowlRect = { x: gcx - ax - rx, y: gcy - ay - ry - 6, w: 2 * rx, h: 2 * ry };
    }
    return { w: w, h: h, ox: ox, oy: oy, floors: floors, wallH: wallH, roofH: roofH, lift: lift, fw: fw, fh: fh, roof: roof, extraTop: extraTop, tier: tier,
      ax: ax, ay: ay, gcx: gcx, gcy: gcy, gw: gw, gh: gh, bcx: gcx, bcy: gcy - lift, bw: bw, bh: bh, inset: inset, bowlRect: bowlRect, zoom: (zoom === 2 ? 2 : 1), special: sp };
  };

  // ---------------------------------------------------------------------------
  // Ground: the paved apron (or the dark water/mud under a pilings building) + the stilts
  // ---------------------------------------------------------------------------
  function drawApron(P, g, seed, color) {
    const c = color || XB.apron;
    P.diamond(g.gcx, g.gcy, g.gw, g.gh, c, shade(c, 0.72));
    // speckle inside the diamond only
    const top = g.gcy - (g.gh >> 1);
    for (let r = 2; r < g.gh - 1; r += 1) {
      const half = M.diamondHalf(g.gw, g.gh, r) - 1; if (half <= 1) continue;
      for (let k = 0; k < 3; k++) { const x = g.gcx - half + (hash(seed, r * 31 + k) % (2 * half)); const n = hash(seed, x + r * 977) % 100; if (n < 30) P.px(x, top + r, n < 12 ? shade(c, 1.08) : shade(c, 0.92)); }
    }
  }
  function drawPilingsGround(P, g, seed) {
    const water = mix(PAL.waterNight, PAL.mud, 0.5);
    P.diamond(g.gcx, g.gcy, g.gw, g.gh, water, shade(water, 0.7));
    const top = g.gcy - (g.gh >> 1);
    for (let i = 0; i < g.gw / 4; i++) { const x = g.gcx - (g.gw >> 1) + (hash(seed, 400 + i) % g.gw), y = top + 2 + (hash(seed, 500 + i) % (g.gh - 4)); if (M.diamondHalf(g.gw, g.gh, y - top) > Math.abs(x - g.gcx) + 1) P.hline(x, y, 2, shade(PAL.shallows, 0.55)); }
  }
  /** a grid of bark 3×10 stilts every 12 px under the (lifted) box base */
  function drawStilts(P, g) {
    const bx0 = g.bcx - (g.bw >> 1) + 2, bx1 = g.bcx + (g.bw >> 1) - 3;
    for (let x = bx0; x <= bx1; x += STILT_PITCH) {
      const yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x);   // the lifted base edge at this column
      // the post stands from the lifted base down to the ground under it (lift px) plus 2 px into the water
      P.rect(x, yb, 3, g.lift + 2, PAL.bark); P.vline(x, yb, g.lift + 2, light(PAL.bark)); P.vline(x + 2, yb, g.lift + 2, dark(PAL.bark));
      P.hline(x - 1, yb + g.lift + 2, 5, shade(PAL.waterNight, 0.8));
    }
    // a row of posts along the back edges too (visible between the front posts)
    for (let x = bx0 + 6; x <= bx1; x += STILT_PITCH * 2) { const yt = topY(g.bcx, g.bcy, g.bw, g.bh, x) + (g.bh >> 2); P.rect(x, yt, 2, g.lift, shade(PAL.bark, 0.7)); }
  }

  // ---------------------------------------------------------------------------
  // The box: faces (three tones), outline, top highlight, gold trim, windows (seeded night
  // pattern), door. Records the window cells on g for BOARDED/DAMAGED.
  // ---------------------------------------------------------------------------
  function faceColors(paint) {
    const wall = (paint && paint.wall) || [PAL.creamStone, PAL.tanStucco];
    const l = wall[0] || PAL.creamStone, r = wall[1] || wall[0] || PAL.tanStucco;
    return { left: shade(l, 0.78), right: shade(r, 0.92), leftHi: shade(l, 1.15), rightHi: shade(r, 1.15), leftRaw: l, rightRaw: r, out: shade(l, 0.55), outR: shade(r, 0.55) };
  }
  /** faces + outline + highlight; opts: {hgt (default g.wallH), cx, cy, w, h, colors, noTop} */
  function drawBox(P, g, paint, opts) {
    opts = opts || {};
    const cx = opts.cx !== undefined ? opts.cx : g.bcx, cy = opts.cy !== undefined ? opts.cy : g.bcy, w = opts.w || g.bw, h = opts.h || g.bh;
    const hgt = opts.hgt !== undefined ? opts.hgt : g.wallH;
    const C = opts.colors || faceColors(paint);
    const seed = opts.seed | 0;
    if (hgt > 0) {
      walls(P, cx, cy, w, h, hgt, (x, yb, left) => {
        const base = left ? C.left : C.right;
        const n = hash(seed, x * 7 + yb) % 100;
        return n < 5 ? shade(base, 1.05) : n > 96 ? shade(base, 0.95) : base;
      });
      // 1-px outline: the bottom edges, the two outer verticals and the front corner
      for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) P.px(x, baseY(cx, cy, w, h, x), x < cx ? C.out : C.outR);
      P.vline(cx - (w >> 1), cy - hgt + 1, hgt, C.out); P.vline(cx + (w >> 1) - 1, cy - hgt + 1, hgt, C.outR);
      P.vline(cx, cy + (h >> 1) - hgt, hgt, C.out);
      // 1-px highlight along the top edge of each face (gold cornice on purple walls)
      const goldL = isPurple(C.leftRaw), goldR = isPurple(C.rightRaw);
      for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) { const y = baseY(cx, cy, w, h, x) - hgt + 1; const left = x < cx; P.px(x, y, left ? (goldL ? PAL.gold : C.leftHi) : (goldR ? PAL.gold : C.rightHi)); }
    }
    if (!opts.noTop) { const tc = opts.topColor || shade(C.rightRaw, 1.0); P.diamond(cx, cy - hgt, w, h, tc); topRim(P, cx, cy - hgt, w, h, shade(tc, 0.7)); }
    return C;
  }
  /**
   * Windows: cols per face, rows from paint.windows (spread over the floors); 2×3 cells; day colour
   * shade(wall, .6); NIGHT: lit / dark per the seeded pattern hash(row.n·131 + frame, cell) % 100 < 70.
   * Returns the cell list [{x, y, face}] (also stored on g.windowCells).
   */
  function drawWindows(P, g, row, opts) {
    opts = opts || {};
    const paint = row.paint || {};
    const win = paint.windows || { cols: 0, rows: 0 };
    const cols = Math.max(0, Math.min(16, win.cols | 0)), rows = Math.max(0, Math.min(20, win.rows | 0));
    const cells = [];
    g.windowCells = cells;
    if (!cols || !rows || g.wallH <= 0) return cells;
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh;
    const pitch = g.wallH / rows;
    const C = faceColors(paint);
    const night = !!opts.night, frame = opts.frame | 0, n = (row.n | 0) * 131 + frame;
    const arched = !!opts.arched, big = opts.big || 0;
    let idx = 0;
    for (const face of [0, 1]) {
      const faceW = (w >> 1) - 4;                         // usable width of the face minus a margin
      const x0 = face === 0 ? cx - (w >> 1) + 2 : cx + 2;
      const cw = Math.max(1, faceW / cols);
      const dayC = shade(face === 0 ? C.leftRaw : C.rightRaw, 0.6);
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) {
          const x = Math.round(x0 + cw * (k + 0.5)) - 1 - (big >> 1);
          if (x < cx - (w >> 1) + 1 || x + WIN_W + big > cx + (w >> 1) - 1 || (face === 0 && x + WIN_W + big > cx - 1) || (face === 1 && x < cx + 1)) continue;
          const yb = baseY(cx, cy, w, h, x);
          const y = Math.round(yb - r * pitch - Math.max(4, pitch * 0.45)) - WIN_H;
          // the door takes the base-row centre of the right face
          if (face === 1 && r === 0 && !opts.noDoor && Math.abs(x - (cx + (w >> 2))) < 4) continue;
          const lit = night && (hash(n, idx) % 100) < LIT_SHARE;
          const c = night ? (lit ? PAL.windowGlow : WINDOW_DARK) : dayC;
          P.rect(x, y, WIN_W + big, WIN_H + (big >> 1), c);
          if (!night) P.px(x, y, shade(dayC, 1.4));
          if (lit && big) P.px(x + 1, y + 1, X.white);
          if (arched) { P.hline(x, y - 1, WIN_W + big, PAL.creamStone); }
          cells.push({ x: x, y: y, w: WIN_W + big, h: WIN_H + (big >> 1), face: face, lit: lit });
          idx++;
        }
      }
    }
    return cells;
  }
  /** the 4×6 purple door at the base of the right face's centre (+ a gold knob) */
  function drawDoor(P, g, color, wide) {
    if (g.wallH <= 0) return;
    const cx = g.bcx, w = g.bw;
    const dx = cx + (w >> 2) - 2, dw = wide ? 6 : 4;
    const yb = baseY(cx, g.bcy, w, g.bh, dx + 1);
    P.rect(dx, yb - 5, dw, 6, color || PAL.purple);
    P.hline(dx, yb - 6, dw, shade(color || PAL.purple, 1.3));
    P.px(dx + dw - 2, yb - 3, PAL.gold);
  }

  // ---------------------------------------------------------------------------
  // Roof library: each draws over the box top given the geometry g (base diamond centre
  // (bcx, bcy − wallH), size bw×bh, height roofH). Exposed as M.roofs[type](ctx, g, color).
  // ---------------------------------------------------------------------------
  const ROOF = {
    none(P, g, color) { void P; void g; void color; },
    flat(P, g, color) {
      const cx = g.bcx, cy = g.bcy - g.wallH, w = g.bw, h = g.bh, R = g.roofH;
      const c = color || PAL.terracotta;
      // a 4-px parapet: the faces continue up in a darker tone, then the top diamond
      walls(P, cx, cy - R, w, h, R, (x, yb, left) => left ? shade(c, 0.62) : shade(c, 0.74));
      P.diamond(cx, cy - R, w, h, shade(c, 0.9));
      topRim(P, cx, cy - R, w, h, shade(c, 0.6)); bottomRim(P, cx, cy - R, w, h, shade(c, 1.12));
      // inner parapet lip
      P.diamond(cx, cy - R + 1, w - 8, h - 4, shade(c, 0.82));
      P.diamond(cx, cy - R + 1, w - 10, h - 5, shade(c, 0.95));
      P.vline(cx - (w >> 1), cy - R + 1, R, shade(c, 0.5)); P.vline(cx + (w >> 1) - 1, cy - R + 1, R, shade(c, 0.5));
    },
    hip(P, g, color) {
      const cx = g.bcx, cy = g.bcy - g.wallH, w = g.bw, h = g.bh, R = Math.max(1, g.roofH);
      const c = color || PAL.terracotta;
      const nw = shade(c, 0.95), ne = shade(c, 0.85), sw = shade(c, 0.8), se = shade(c, 0.7);
      for (let k = 0; k <= R; k++) {
        const wk = Math.round((w - (w / 3) * (k / R)) / 4) * 4, hk = wk >> 1;
        const top = cy - k - (hk >> 1);
        for (let r = 1; r < hk; r++) {
          const half = M.diamondHalf(wk, hk, r); if (half <= 0) continue;
          const north = r < (hk >> 1);
          P.rect(cx - half, top + r, half, 1, north ? nw : sw);
          P.rect(cx, top + r, half, 1, north ? ne : se);
          if (k === R) { P.rect(cx - half, top + r, 2 * half, 1, shade(c, 1.0)); }
        }
      }
      // eave outline and the lit ridge diamond rim
      bottomRim(P, cx, cy, w, h, shade(c, 0.5));
      const wr = Math.round((w * 2 / 3) / 4) * 4;
      topRim(P, cx, cy - R, wr, wr >> 1, shade(c, 1.2));
      bottomRim(P, cx, cy - R, wr, wr >> 1, shade(c, 0.6));
      // tile texture: 1-px lighter rows every 3 px on the front planes
      for (let k = 1; k < R; k += 3) { const wk = Math.round((w - (w / 3) * (k / R)) / 4) * 4; const hk = wk >> 1; const top = cy - k - (hk >> 1); for (let r = (hk >> 1); r < hk; r += 1) { const half = M.diamondHalf(wk, hk, r); if (half > 1 && (r & 1)) { P.px(cx - half + 1, top + r, shade(sw, 1.1)); P.px(cx + half - 2, top + r, shade(se, 1.1)); } } }
    },
    gable(P, g, color) {
      const cx = g.bcx, cy = g.bcy - g.wallH, w = g.bw, h = g.bh, R = Math.max(1, g.roofH);
      const c = color || PAL.terracotta;
      const W = [cx - (w >> 1), cy], S = [cx, cy + (h >> 1)], E = [cx + (w >> 1) - 1, cy], N = [cx, cy - (h >> 1) + 1];
      const along = g.fw >= g.fh;   // ridge along the longer axis (tx axis = the W→S direction)
      let a, b;                     // ridge endpoints (raised)
      if (along) a = [cx - (w >> 2), cy - (h >> 2) - R], b = [cx + (w >> 2), cy + (h >> 2) - R];
      else a = [cx + (w >> 2), cy - (h >> 2) - R], b = [cx - (w >> 2), cy + (h >> 2) - R];
      const C = faceColors(g.paint || {});
      if (along) {
        fillPoly(P, [N, E, b, a], shade(c, 0.9));          // NE plane (lit)
        fillPoly(P, [W, S, b, a], shade(c, 0.72));         // SW plane
        fillPoly(P, [S, E, b], shade(C.rightRaw, 0.85));   // SE gable end (wall colour)
        P.line(S[0], S[1], b[0], b[1], shade(c, 0.55)); P.line(E[0], E[1], b[0], b[1], shade(c, 0.55));
      } else {
        fillPoly(P, [W, N, a, b], shade(c, 0.9));          // NW plane
        fillPoly(P, [S, E, a, b], shade(c, 0.72));         // SE plane
        fillPoly(P, [W, S, b], shade(C.leftRaw, 0.75));    // SW gable end
        P.line(S[0], S[1], b[0], b[1], shade(c, 0.55)); P.line(W[0], W[1], b[0], b[1], shade(c, 0.55));
      }
      P.line(a[0], a[1], b[0], b[1], shade(c, 1.25));      // the ridge
      P.line(a[0], a[1] + 1, b[0], b[1] + 1, shade(c, 1.05));
      bottomRim(P, cx, cy, w, h, shade(c, 0.5));
    },
    barrel(P, g, color) {
      const cx = g.bcx, cy = g.bcy - g.wallH, w = g.bw, h = g.bh, R = Math.max(2, g.roofH);
      const c = color || PAL.terracotta;
      const along = g.fw >= g.fh;
      const tones = [0.62, 0.8, 1.0, 0.92, 0.72];
      const bands = 5;
      // parametrize u across the roof (from one eave to the other); height = R·sqrt(1−u²)
      const ptA = (u, hgt) => along ? [cx - (w >> 2) + u * (w >> 2), cy - (h >> 2) + u * (h >> 2) - hgt] : [cx + (w >> 2) + u * (w >> 2), cy - (h >> 2) - u * (h >> 2) - hgt];
      const ptB = (u, hgt) => along ? [cx + (w >> 2) + u * (w >> 2), cy + (h >> 2) + u * (h >> 2) - hgt] : [cx - (w >> 2) + u * (w >> 2), cy + (h >> 2) - u * (h >> 2) - hgt];
      // ptA runs along the NW edge (along) / NE edge (across); ptB along the SE / SW edge; u ∈ [−1, 1]
      for (let i = 0; i < bands; i++) {
        const u0 = -1 + 2 * i / bands, u1 = -1 + 2 * (i + 1) / bands;
        const h0 = R * Math.sqrt(Math.max(0, 1 - u0 * u0)), h1 = R * Math.sqrt(Math.max(0, 1 - u1 * u1));
        fillPoly(P, [ptA(u0, h0), ptA(u1, h1), ptB(u1, h1), ptB(u0, h0)], shade(c, tones[i]));
      }
      // the visible end wall (SE end when along, SW end when across): the arc over the eave edge
      const C = faceColors(g.paint || {});
      const end = [];
      for (let k = 0; k <= 8; k++) { const u = -1 + 2 * k / 8; end.push(ptB(u, R * Math.sqrt(Math.max(0, 1 - u * u)))); }
      fillPoly(P, end, shade(along ? C.rightRaw : C.leftRaw, 0.85));
      strokeEdges(P, end, shade(c, 0.55));
      bottomRim(P, cx, cy, w, h, shade(c, 0.5));
    },
    dome(P, g, color) {
      // a hip base with a gold half-dome on the centre (2-tone highlight)
      ROOF.hip(P, g, color);
      const cx = g.bcx, cy = g.bcy - g.wallH - g.roofH, r = Math.max(6, Math.min(g.fw, g.fh) * 12 >> 1) + 4;
      const gold = (g.paint && g.paint.accent) || PAL.gold;
      for (let dy = -r; dy <= 0; dy++) { const k = 1 - (dy * dy) / (r * r); if (k < 0) continue; const half = Math.round(Math.sqrt(k) * r); if (half <= 0) continue; const t = -dy / r; P.rect(cx - half, cy + dy, half, 1, t > 0.8 ? PAL.goldHi : shade(gold, 1.0)); P.rect(cx, cy + dy, half, 1, t > 0.8 ? shade(gold, 1.0) : shade(gold, 0.72)); P.px(cx - half, cy + dy, PAL.goldShadow); P.px(cx + half - 1, cy + dy, PAL.goldShadow); }
      P.ellipse(cx - (r >> 2), cy - (r * 0.55), r >> 3, r >> 3, PAL.goldHi);
      P.hline(cx - r, cy, 2 * r, PAL.goldShadow); P.hline(cx - r + 2, cy + 1, 2 * r - 4, shade(PAL.goldShadow, 0.8));
      P.vline(cx, cy - r - 3, 3, PAL.goldHi); P.px(cx, cy - r - 4, X.white);
    },
    bowl(P, g, color) { void P; void g; void color; /* the stadium special draws its bowl */ }
  };
  M.roofs = {};
  for (const k of Object.keys(ROOF)) M.roofs[k] = (function (fn) { return function (ctx, g, color) { try { fn(pen(ctx, g && g.zoom), g, color); } catch (e) { BSU.error('sprites', 'roof:' + k, e); } }; })(ROOF[k]);

  // ---------------------------------------------------------------------------
  // Decal placement. A decal is repainted through its painter with an offset pen (so DAMAGED
  // tone and 2× apply and no canvas is needed); anchor = 'roof'|'ground'|'side' (data default) or
  // {x, y} in canvas px (centre for roof/side, bottom-centre for ground). Skips unknown names.
  // ---------------------------------------------------------------------------
  function decalInfo(name) { return (M.decalInfo && M.decalInfo(name)) || null; }
  /** paint decal `name` with its top-left at (x, y) using pen P */
  function decalAt(P, name, x, y, frame, seed) {
    const info = decalInfo(name), fn = M.decalPainters && M.decalPainters[name];
    if (!info || !fn) return false;
    const fr = Math.max(1, info.frames | 0);
    fn(offsetPen(P, x, y), info.w, info.h, ((frame | 0) % fr + fr) % fr, hash(seed | 0, 0xdec));
    return true;
  }
  /** roof centre, front apron point (t along the SE apron), right face centre — in canvas px */
  function roofCentre(g) { return { x: g.bcx, y: g.bcy - g.wallH - (g.roof === 'hip' || g.roof === 'dome' ? g.roofH : g.roofH >> 1) - (g.bh >> 2) }; }
  function frontPoint(g, t) { return { x: g.ax + Math.round(t * g.fh * 32), y: g.ay + 16 - Math.round(t * g.fh * 16) - 1 - g.lift }; }
  function leftPoint(g, t) { return { x: g.ax - Math.round(t * g.fw * 32), y: g.ay + 16 - Math.round(t * g.fw * 16) - 1 - g.lift }; }
  function sideCentre(g) { const x = g.bcx + (g.bw >> 2); return { x: x, y: baseY(g.bcx, g.bcy, g.bw, g.bh, x) - (g.wallH >> 1) }; }
  function leftCentre(g) { const x = g.bcx - (g.bw >> 2); return { x: x, y: baseY(g.bcx, g.bcy, g.bw, g.bh, x) - (g.wallH >> 1) }; }
  /**
   * Place a decal by name. `anchor`: 'roof'|'ground'|'side'|'left' (default: the data anchor) or
   * {x, y}. Ground decals stand on the SE apron in front of the right face.
   */
  M.placeDecal = function (ctx, g, name, anchor, frame) {
    try {
      const P = (ctx && ctx.rect) ? ctx : tonePen(pen(ctx, g && g.zoom), g && g.tone);
      const info = decalInfo(name); if (!info || !g) return;
      let kind = info.anchor, pt = null;
      if (anchor && typeof anchor === 'object') pt = anchor; else if (typeof anchor === 'string') kind = anchor;
      if (!pt) {
        if (kind === 'roof') pt = roofCentre(g);
        else if (kind === 'side') pt = sideCentre(g);
        else if (kind === 'left') pt = leftCentre(g);
        else pt = frontPoint(g, 0.3);
      }
      const ground = (kind === 'ground');
      decalAt(P, name, pt.x - (info.w >> 1), ground ? pt.y - info.h + 4 : pt.y - (info.h >> 1), frame, g.seed);
    } catch (e) { BSU.error('sprites', 'placeDecal:' + name, e); }
  };
  // decals the box pipeline skips because a special painter (or render) handles them
  const SKIP_DECAL = { dumpster: 1, stilts: 1, scaffold: 1, tarp: 1, plywood: 1, burrow: 1, masts: 1, letters: 1, jumbotron: 1, bleachers: 1, goalposts: 1, cars: 1, pool: 1, reeds: 1, lookout: 1, nest: 1, arcade: 1, columns: 1, clock: 1, awning: 1, banner: 1, lights: 1, flag: 1, beacon: 1, sign: 1 };
  /** the generic decal pass: named decals at their data anchors, spread so two ground decals do not overlap */
  function drawDecals(P, g, row, frame, skipMap) {
    const list = (row.paint && row.paint.decals) || [];
    let groundN = 0, roofN = 0, sideN = 0;
    for (const name of list) {
      if ((skipMap || SKIP_DECAL)[name]) continue;
      const info = decalInfo(name); if (!info) continue;
      let pt;
      if (info.anchor === 'ground') { pt = frontPoint(g, 0.25 + 0.35 * (groundN++ % 2)); }
      else if (info.anchor === 'roof') { const rc = roofCentre(g); pt = { x: rc.x + (roofN % 2 ? 14 : -14) * (roofN ? 1 : 0), y: rc.y + (roofN > 1 ? 6 : 0) }; roofN++; }
      else { pt = sideN++ % 2 ? leftCentre(g) : sideCentre(g); }
      M.placeDecal(P, g, name, pt, frame);
    }
  }
  // the house-style ground-floor decals drawn INTO the faces (arcade along the base, columns, clock, awning…)
  function drawArcade(P, g, faces) {
    if (g.wallH < 12) return;
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh;
    const tall = faces && faces.tall ? 20 : 12;
    for (const face of [0, 1]) {
      const x0 = face === 0 ? cx - (w >> 1) + 3 : cx + 3, x1 = face === 0 ? cx - 3 : cx + (w >> 1) - 3;
      const span = x1 - x0; const n = Math.max(1, Math.round(span / 14));
      const aw = span / n;
      for (let k = 0; k < n; k++) {
        const ax = Math.round(x0 + aw * k + 3), bx = Math.round(x0 + aw * (k + 1) - 3);
        if (bx - ax < 3) continue;
        for (let x = ax; x < bx; x++) { const yb = baseY(cx, cy, w, h, x); const edge = (x === ax || x === bx - 1); const hh = edge ? tall - 3 : tall; P.rect(x, yb - hh, 1, hh, shade(faces.wall[face], 0.45)); if (!edge) P.px(x, yb - tall - 1, shade(PAL.creamStone, 0.9)); }
        // pier between openings
        const px0 = Math.round(x0 + aw * k) + 1; for (let x = px0; x < px0 + 2; x++) { const yb = baseY(cx, cy, w, h, x); P.rect(x, yb - tall - 2, 1, tall + 2, PAL.creamStone); }
      }
      for (let x = x0; x < x1; x++) { const yb = baseY(cx, cy, w, h, x); P.px(x, yb - tall - 3, PAL.creamStone); P.px(x, yb - tall - 2, shade(PAL.creamStone, 0.8)); }
    }
  }
  function drawColumns(P, g, n) {
    if (g.wallH < 12) return;
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh, ch = Math.min(g.wallH - 2, 22);
    n = n || 4;
    const x0 = cx + 4, x1 = cx + (w >> 1) - 4;
    for (let k = 0; k < n; k++) {
      const x = Math.round(x0 + (x1 - x0) * (k + 0.5) / n) - 1;
      const yb = baseY(cx, cy, w, h, x);
      P.rect(x, yb - ch, 2, ch, X.white); P.vline(x + 1, yb - ch, ch, shade(X.white, 0.8));
      P.hline(x - 1, yb - ch - 1, 4, X.white); P.hline(x - 1, yb - 1, 4, shade(X.white, 0.85));
    }
    // the entablature line above the columns
    for (let x = x0 - 2; x < x1 + 2; x++) { const yb = baseY(cx, cy, w, h, x); P.px(x, yb - ch - 2, PAL.creamStone); P.px(x, yb - ch - 3, shade(PAL.creamStone, 0.85)); }
  }
  function drawClock(P, g, faceLeft) {
    const c = faceLeft ? leftCentre(g) : sideCentre(g);
    decalAt(P, 'clock', c.x - 5, c.y - (g.wallH >> 3) - 8, 0, g.seed);
  }
  function drawAwning(P, g) {
    const cx = g.bcx, w = g.bw, dx = cx + (w >> 2) - 8; const yb = baseY(cx, g.bcy, w, g.bh, dx + 9);
    decalAt(P, 'awning', dx, yb - 12, 0, g.seed);
  }
  function drawFlag(P, g, x, y, frame) { decalAt(P, 'flag', x, y, frame, g.seed); }
  function drawStringLights(P, g, frame) {
    // a string of 5 gold lights along the top of the right face
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh;
    for (let k = 0; k < 5; k++) { const x = cx + 4 + Math.round((k + 0.5) * ((w >> 1) - 8) / 5); const y = baseY(cx, cy, w, h, x) - g.wallH + 3 + (k & 1); P.px(x, y, X.black); P.px(x, y + 1, (frame & 1) && (k & 1) ? PAL.goldHi : PAL.gold); }
  }
  function drawBannerSide(P, g, x, y) { decalAt(P, 'banner', x, y, 0, g.seed); }
  function drawSignSide(P, g) { const c = sideCentre(g); decalAt(P, 'sign', c.x - 7, c.y - 4, 0, g.seed); }
  function drawBeaconTop(P, g, x, y, lit) { decalAt(P, 'beacon', x, y, lit ? 1 : 0, g.seed); }
  /** the gold half-dome ornament alone (library's roof decal), centred at (cx, cy) with radius r */
  function smallDome(P, cx, cy, r, gold) {
    for (let dy = -r; dy <= 0; dy++) {
      const k = 1 - (dy * dy) / (r * r); if (k < 0) continue;
      const half = Math.round(Math.sqrt(k) * r); if (half <= 0) continue;
      const t = -dy / r;
      P.rect(cx - half, cy + dy, half, 1, t > 0.8 ? PAL.goldHi : shade(gold, 1.0));
      P.rect(cx, cy + dy, half, 1, t > 0.8 ? shade(gold, 1.0) : shade(gold, 0.72));
    }
    P.hline(cx - r, cy, 2 * r, PAL.goldShadow);
    P.px(cx, cy - r - 1, X.white);
  }
  /** blit a cached SpriteRef (oak/cypress…) centred at the 1×-space point (x1, y1); converts to device px itself */
  function blitSprite(ctx, zoom, ref, x1, y1) {
    if (!ref || !ref.canvas) return;
    const S = zoom === 2 ? 2 : 1;
    try {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ref.canvas, ref.sx, ref.sy, ref.sw, ref.sh, Math.round(x1 * S) + ref.ox, Math.round(y1 * S) + ref.oy, ref.sw, ref.sh);
    } catch (e) { /* headless stub ctx: no-op */ }
  }

  // ---------------------------------------------------------------------------
  // Known-decal dispatch: paint.decals names that need a specific placement (not the
  // generic ground/roof/side spread) are drawn here by name; everything else goes through
  // drawDecals. Shared by the generic box and every "house style" special.
  // ---------------------------------------------------------------------------
  function drawKnownDecals(ctx, P, g, row, variant, frame) {
    const paint = row.paint || {};
    const list = paint.decals || [];
    const night = !!(variant & SPR.NIGHT);
    const has = (n) => list.indexOf(n) >= 0;
    if (has('arcade')) drawArcade(P, g, { wall: paint.wall || [PAL.creamStone, PAL.tanStucco], tall: row.id === 'union' });
    if (has('columns')) drawColumns(P, g, row.id === 'founders_hall' ? 6 : 4);
    if (has('clock')) drawClock(P, g, false);
    if (has('awning')) drawAwning(P, g);
    if (has('flag')) { const rc = roofCentre(g); drawFlag(P, g, rc.x + (g.bw >> 3), rc.y - 18, frame); }
    if (has('banner')) { const sc = sideCentre(g); drawBannerSide(P, g, sc.x - 14, sc.y - 6); }
    if (has('lights')) drawStringLights(P, g, frame);
    if (has('sign')) drawSignSide(P, g);
    if (has('beacon')) { const rc = roofCentre(g); drawBeaconTop(P, g, rc.x - 2, rc.y - 10, night || (frame & 1) === 1); }
    if (has('letters') && row.id !== 'greek_house') { const sc = sideCentre(g); decalAt(P, 'letters', sc.x - 16, sc.y - 4, frame, g.seed); }   // DECALS.letters spells "CAULDRON" (stadium only); greek_house spells its own letters below
    if (has('pool')) { const fp = frontPoint(g, 0.3); decalAt(P, 'pool', fp.x - 20, fp.y - 18, frame, g.seed); }
    if (has('dome')) { const rc = roofCentre(g); smallDome(P, rc.x, rc.y - (g.roofH >> 1) - 2, Math.max(6, Math.min(g.fw, g.fh) * 5 + 2), paint.accent || PAL.gold); }
    if (row.id === 'greek_house') { const sc = sideCentre(g); P.text('ΒΣΥ', sc.x - 6, sc.y - 2, PAL.gold); }
    if (row.id === 'res_tower') { const x = g.bcx + (g.bw >> 2); P.vline(x, g.bcy - g.wallH, g.wallH, PAL.gold); }
    if (row.id === 'health_center') { const sc = sideCentre(g); P.rect(sc.x - 1, sc.y - 6, 2, 5, PAL.gold); P.rect(sc.x - 3, sc.y - 4, 6, 2, PAL.gold); }
    drawDecals(P, g, row, frame, SKIP_DECAL);   // everything else, at its data anchor
  }

  /** the one shared "house style" box: walls, windows, door, roof, every known decal. Used by the
   * generic fallback and most of the 30-odd special rows (they just add a flourish on top). */
  function drawStandardBox(ctx, P, g, row, variant, frame) {
    const paint = row.paint || {};
    const night = !!(variant & SPR.NIGHT);
    drawBox(P, g, paint, { seed: g.seed });
    drawWindows(P, g, row, { night: night, frame: frame });
    drawDoor(P, g, isPurple((paint.wall && paint.wall[1]) || '') ? PAL.gold : PAL.purple);
    (ROOF[paint.roof] || ROOF.none)(P, g, paint.roofColor || PAL.terracotta);
    drawKnownDecals(ctx, P, g, row, variant, frame);
  }

  // ---------------------------------------------------------------------------
  // Variant overlays applied by paintBuilding around the base/special drawing.
  // ---------------------------------------------------------------------------
  /** RUIN: a rubble mound sized to the footprint, 3 standing stubs, a tarp corner (no box/roof/windows) */
  function drawRuinShape(P, g, seed) {
    const rubble = XB.rubble;
    for (let x = g.bcx - (g.bw >> 1); x < g.bcx + (g.bw >> 1); x++) {
      const yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x);
      const hgt = 3 + (hash(seed, x) % 6);
      P.rect(x, yb - hgt, 1, hgt, (hash(seed, x * 3) % 100 < 40) ? shade(rubble, 1.1) : rubble);
    }
    for (let i = 0; i < 3; i++) {
      const x = g.bcx - (g.bw >> 2) + i * (g.bw >> 2);
      const yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x);
      const hh = 6 + (hash(seed, 900 + i) % 6);
      P.rect(x, yb - hh - 4, 2, hh, shade(rubble, 0.8)); P.px(x, yb - hh - 4, shade(rubble, 1.2));
    }
    P.rect(g.bcx + (g.bw >> 2) - 4, g.bcy - 10, 8, 5, X.tarp); P.hline(g.bcx + (g.bw >> 2) - 4, g.bcy - 10, 8, shade(X.tarp, 1.2));
  }
  /** DAMAGED: whole sprite already toned by the caller's pen; add a tiled roof tarp + 2 broken windows */
  function applyDamaged(P, g) {
    const rc = roofCentre(g);
    const tw = 24, tiles = Math.max(1, Math.ceil(g.bw / tw));
    for (let i = 0; i < tiles; i++) decalAt(P, 'tarp', g.bcx - (g.bw >> 1) + i * tw, rc.y - 6, 0, g.seed + i);
    const cells = g.windowCells || [];
    const n = Math.min(2, cells.length);
    for (let i = 0; i < n; i++) {
      const c = cells[(g.seed + i * 7) % cells.length];
      P.rect(c.x, c.y, c.w, c.h, X.black);
      P.line(c.x, c.y, c.x + c.w - 1, c.y + c.h - 1, shade(X.black, 1.6));
      P.line(c.x + c.w - 1, c.y, c.x, c.y + c.h - 1, shade(X.black, 1.6));
    }
  }
  /** BOARDED: plywood over every recorded window cell */
  function applyBoarded(P, g) {
    const cells = g.windowCells || [];
    for (const c of cells) decalAt(P, 'plywood', Math.round(c.x - 5), Math.round(c.y - 3), 0, g.seed + c.x * 3 + c.y);
  }
  /** SCAFFOLD: 3 build-rise frames — foundation slab / half height / full height + lattice; no roof/windows */
  function drawScaffoldStage(P, g, row, frame) {
    const stage = ((frame % 3) + 3) % 3;
    const slab = XB.slab;
    if (stage === 0) {
      P.diamond(g.bcx, g.bcy, g.bw, g.bh, slab, shade(slab, 0.7));
      P.diamond(g.bcx, g.bcy - 2, g.bw - 4, g.bh - 2, shade(slab, 1.1));
      return;
    }
    const hgt = stage === 1 ? Math.max(4, Math.round(g.wallH / 2) || 6) : (g.wallH || 24);
    const C = { left: shade(slab, 0.75), right: shade(slab, 0.9), leftHi: shade(slab, 1.1), rightHi: shade(slab, 1.15), leftRaw: slab, rightRaw: slab, out: shade(slab, 0.5), outR: shade(slab, 0.5) };
    drawBox(P, g, {}, { hgt: hgt, noTop: true, colors: C });
    if (stage === 2) { M.placeDecal(P, g, 'scaffold', 'side', 0); M.placeDecal(P, g, 'scaffold', 'left', 0); }
  }

  // ---------------------------------------------------------------------------
  // The ~12 structural specials that are not a plain box (everything else falls back to
  // drawStandardBox automatically through specialOf()). Signature: (ctx, P, g, row, variant, frame).
  // ---------------------------------------------------------------------------
  const SPECIAL = {
    substation(ctx, P, g, row, variant, frame) {
      const cx = g.bcx, cy = g.bcy;
      P.diamond(cx, cy, g.bw, g.bh, XB.gravelPad, shade(XB.gravelPad, 0.75));
      for (let i = 0; i < 2; i++) {
        const x = cx - 14 + i * 20, yb = baseY(cx, cy, g.bw, g.bh, x);
        P.rect(x, yb - 10, 12, 10, XB.transformer); P.vline(x, yb - 10, 10, shade(XB.transformer, 1.25)); P.vline(x + 11, yb - 10, 10, shade(XB.transformer, 0.7));
        P.hline(x, yb - 10, 12, shade(XB.transformer, 1.3));
        for (let k = 0; k < 2; k++) { P.vline(x + 3 + k * 6, yb - 16, 6, X.offWhite); P.rect(x + 2 + k * 6, yb - 17, 3, 2, X.white); }
      }
      drawKnownDecals(ctx, P, g, row, variant, frame);
    },
    water_tower(ctx, P, g, row, variant, frame) {
      const cx = g.bcx, cy = g.bcy;
      P.diamond(cx, cy, g.bw, g.bh, XB.gravelPad, shade(XB.gravelPad, 0.75));
      const f = ((frame % 4) + 4) % 4;
      if (f === 3) {
        const ty = baseY(cx, cy, g.bw, g.bh, cx) - 10;
        P.rect(cx - 20, ty - 9, 40, 18, PAL.purple); P.hline(cx - 20, ty - 9, 40, PAL.purpleHi); P.hline(cx - 20, ty + 8, 40, PAL.purpleShadow);
        P.text('BSU', cx - 8, ty - 2, PAL.gold);
        drawKnownDecals(ctx, P, g, row, variant, frame); return;
      }
      const sway = f === 1 ? -2 : f === 2 ? 2 : 0;
      const legTop = cy - 28, tankTop = legTop - 18, tankH = 18, tankW = 24;
      for (const dx of [-10, 10]) P.vline(cx + dx + sway, legTop, 28, XB.legs);
      P.vline(cx - 2 + sway, legTop, 28, shade(XB.legs, 1.2)); P.vline(cx + 2 + sway, legTop, 28, shade(XB.legs, 1.2));
      P.rect(cx - (tankW >> 1) + sway, tankTop, tankW, tankH, PAL.purple);
      P.vline(cx - (tankW >> 1) + sway, tankTop, tankH, PAL.purpleHi); P.vline(cx + (tankW >> 1) - 1 + sway, tankTop, tankH, PAL.purpleShadow);
      P.hline(cx - (tankW >> 1) + sway, tankTop + 6, tankW, PAL.gold);
      P.text('BSU', cx - 8 + sway, tankTop + 2, PAL.gold);
      for (let k = 0; k < 6; k++) { const half = (tankW >> 1) - k * 2; if (half <= 0) break; P.hline(cx - half + sway, tankTop - k, 2 * half, shade(PAL.purple2, 1.1)); }
      drawKnownDecals(ctx, P, g, row, variant, frame);
    },
    generator(ctx, P, g, row, variant, frame) {
      const cx = g.bcx, cy = g.bcy, yb = baseY(cx, cy, g.bw, g.bh, cx);
      P.rect(cx - 8, yb - 3, 16, 3, X.steelDark);
      P.rect(cx - 7, yb - 13, 14, 10, PAL.gold); P.vline(cx - 7, yb - 13, 10, shade(PAL.gold, 1.25)); P.vline(cx + 6, yb - 13, 10, shade(PAL.gold, 0.7));
      P.hline(cx - 7, yb - 13, 14, shade(PAL.gold, 1.3));
      P.rect(cx + 5, yb - 18, 3, 6, X.steel);
      drawKnownDecals(ctx, P, g, row, variant, frame);
    },
    practice_field(ctx, P, g, row, variant, frame) {
      const cx = g.bcx, cy = g.bcy;
      const top = g.gcy - (g.gh >> 1);
      for (let r = 0; r < g.gh; r++) {
        const half = M.diamondHalf(g.gw, g.gh, r); if (half <= 0) continue;
        for (let x = g.gcx - half; x < g.gcx + half; x += 8) { const s = Math.floor(x / 8) & 1; P.rect(x, top + r, Math.min(8, g.gcx + half - x), 1, s ? shade(PAL.dryGrass, 0.9) : PAL.dryGrass); }
      }
      const n = frontPoint(g, 0), w2 = leftPoint(g, 0);
      decalAt(P, 'goalposts', n.x - 4, n.y - 20, 0, g.seed);
      decalAt(P, 'goalposts', w2.x - 4, w2.y - 20, 0, g.seed + 1);
      P.rect(cx - 6, cy - 6, 4, 3, PAL.purple); P.rect(cx + 2, cy - 4, 4, 3, PAL.purple);
      if (g.tier >= 1) {
        decalAt(P, 'bleachers', cx - 24, cy - 20, 0, g.seed);
        P.text('BAYOU FIELD', cx - 28, cy - 30, PAL.gold);
      }
    },
    stadium(ctx, P, g, row, variant, frame) {
      const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh;
      if (g.tier <= 0) {
        // unbuilt: a plausible box only — walls + a flat cap, none of the bowl/masts/letters dressing
        drawBox(P, g, row.paint, { seed: g.seed });
        drawDoor(P, g, PAL.gold);
        ROOF.flat(P, g, (row.paint && row.paint.wall && row.paint.wall[1]) || PAL.purple);
        return;
      }
      const standColor = (row.paint && row.paint.wall && row.paint.wall[0]) || X.concrete;
      walls(P, cx, cy, w, h, g.wallH, (x, yb, left) => left ? shade(standColor, 0.8) : shade(standColor, 0.92));
      for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) P.px(x, baseY(cx, cy, w, h, x), shade(standColor, 0.5));
      const br = g.bowlRect;
      if (g.tier === 1) {
        for (let r = 0; r < g.wallH; r += 6) P.hline(cx - (w >> 1), cy - g.wallH + r, w, shade(standColor, 0.6 + 0.05 * (r % 2)));
        decalAt(P, 'masts', cx - (w >> 1) - 4, cy - g.wallH - 40, 0, g.seed);
        decalAt(P, 'masts', cx + (w >> 1) - 2, cy - g.wallH - 40, 1, g.seed + 1);
        P.diamond(cx, cy - g.wallH, w >> 1, h >> 1, PAL.gold);
      } else {
        const rx = br ? br.w / 2 : w * 0.36, ry0 = br ? br.h / 2 : h * 0.36;
        const bcy2 = cy - g.wallH - 6;
        const ring = g.tier === 3 ? [PAL.purple, PAL.purple2, PAL.purpleHi] : [PAL.purple];
        for (let i = 0; i < ring.length; i++) {
          P.ellipse(cx, bcy2 - i * 8, Math.max(2, rx - i * 4), Math.max(1, ry0), ring[i]);
          P.ellipse(cx, bcy2 - i * 8, Math.max(1, rx - i * 4 - 2), Math.max(1, ry0 - 2), shade(ring[i], 0.85));
        }
        P.hline(cx - rx, bcy2 - ring.length * 8, 2 * rx, PAL.gold);
        for (let i = 0; i < 6; i++) decalAt(P, 'masts', cx - rx + i * (2 * rx / 6), bcy2 - 40, i % 2, g.seed + i);
        decalAt(P, 'letters', cx - 16, bcy2 + ry0 - 4, 0, g.seed);
        if (g.tier === 3) decalAt(P, 'jumbotron', cx - 12, bcy2 - ry0 - 20, frame % 4, g.seed);
      }
      // masts/letters/jumbotron are already placed above by tier; nothing else is in stadium's decal list
    },
    quad(ctx, P, g, row, variant, frame) {
      const cx = g.gcx, cy = g.gcy;
      P.diamond(cx, cy, g.gw, g.gh, XB.lawn, shade(XB.lawn, 0.8));
      for (const t of [-1, 1]) { const a = frontPoint(g, 0.5 + t * 0.3), b = leftPoint(g, 0.5 - t * 0.3); P.line(a.x, a.y, b.x, b.y, PAL.gravel); P.line(a.x, a.y + 1, b.x, b.y + 1, shade(PAL.gravel, 0.85)); }
      P.rect(cx - 14, cy + 2, 4, 3, PAL.purple); P.rect(cx + 8, cy - 4, 4, 3, PAL.gold);
      blitSprite(ctx, g.zoom, M.get('oak', 2, 0, g.zoom), cx, cy - 6);
    },
    parking(ctx, P, g, row, variant, frame) {
      const cx = g.gcx, cy = g.gcy;
      P.diamond(cx, cy, g.gw, g.gh, XB.apron === X.black ? X.black : '#3A3A40', shade('#3A3A40', 0.8));
      const top = cy - (g.gh >> 1);
      for (let r = 2; r < g.gh - 1; r += 4) { const half = M.diamondHalf(g.gw, g.gh, r) - 2; if (half > 1) P.hline(cx - half, top + r, 2 * half, shade('#3A3A40', 1.3)); }
      const flooded = frame === 1;
      for (let i = 0; i < 10; i++) {
        const t = (i + 0.5) / 10;
        const fp = frontPoint(g, t * 0.8 + 0.1);
        decalAt(P, 'cars', fp.x - 4, fp.y - 5 - (flooded ? 1 : 0), hash(g.seed, i) % 3, g.seed + i);
      }
    },
    pond(ctx, P, g, row, variant, frame) {
      const cx = g.gcx, cy = g.gcy;
      P.diamond(cx, cy, g.gw - 4, g.gh - 2, PAL.shallows, shade(PAL.waterNight, 0.9));
      P.diamond(cx, cy, g.gw - 14, g.gh - 8, PAL.waterNight);
      for (let i = 0; i < 6; i++) { const x = cx - (g.gw >> 2) + (hash(g.seed, i) % (g.gw >> 1)); P.hline(x, cy + (hash(g.seed, 20 + i) % 6) - 3, 2, shade(PAL.shallows, 1.3)); }
      decalAt(P, 'reeds', cx - (g.gw >> 2) - 6, cy - 2, frame % 2, g.seed);
      decalAt(P, 'reeds', cx + (g.gw >> 2) - 6, cy - 6, (frame + 1) % 2, g.seed + 3);
      P.rect(cx - 3, cy + (g.gh >> 2) - 2, 6, 3, PAL.bark); P.vline(cx - 3, cy + (g.gh >> 2) - 2, 3, light(PAL.bark));
    },
    bat_house(ctx, P, g, row, variant, frame) {
      const cx = g.bcx, cy = g.bcy, yb = baseY(cx, cy, g.bw, g.bh, cx);
      P.vline(cx, yb - 28, 28, PAL.bark); P.vline(cx - 1, yb - 28, 28, shade(PAL.bark, 1.2)); P.vline(cx + 1, yb - 28, 28, shade(PAL.bark, 0.8));
      decalAt(P, 'gourds', cx - 5, yb - 40, 0, g.seed);
    },
    surge_barrier(ctx, P, g, row, variant, frame) {
      const cx = g.bcx, cy = g.bcy, w = Math.max(g.bw, 48);
      const towerH = 40, gateH = 24;
      const f = ((frame % 4) + 4) % 4;
      const open = gateH - Math.round(gateH * (f / 3));
      for (const dx of [-(w >> 1) + 8, (w >> 1) - 8]) {
        const x = cx + dx, yb = baseY(cx, cy, g.bw, g.bh, cx);
        P.rect(x - 8, yb - towerH, 16, towerH, X.concrete); P.vline(x - 8, yb - towerH, towerH, light(X.concrete)); P.vline(x + 7, yb - towerH, towerH, dark(X.concrete));
        P.hline(x - 8, yb - towerH, 16, shade(X.concrete, 1.2));
      }
      const gateY = cy - towerH + (gateH - open);
      P.rect(cx - (w >> 1) + 16, gateY, w - 32, Math.max(1, open), XB.gate);
      for (let x = cx - (w >> 1) + 16; x < cx + (w >> 1) - 16; x += 10) P.vline(x, gateY, Math.max(1, open), PAL.gold);
      drawKnownDecals(ctx, P, g, row, variant, frame);
    },
    bell_tower(ctx, P, g, row, variant, frame) {
      drawStandardBox(ctx, P, g, row, variant, frame);
      const cx = g.bcx, cy = g.bcy - g.wallH - g.roofH, spireH = 16;
      fillPoly(P, [[cx - (g.bw >> 2), cy], [cx + (g.bw >> 2), cy], [cx, cy - spireH]], shade((row.paint && row.paint.roofColor) || PAL.terracotta, 0.9));
      P.px(cx, cy - spireH - 1, PAL.gold);
      drawClock(P, g, true);
    },
    rookery(ctx, P, g, row, variant, frame) {
      const cx = g.bcx, cy = g.bcy, w = Math.max(40, g.bw), h = w >> 2;
      P.diamond(cx, cy, w, h, XB.apron, shade(XB.apron, 0.7));
      P.hline(cx - (w >> 1), cy - (h >> 1), w, PAL.gold);
      blitSprite(ctx, g.zoom, M.get('cypress', 2, 0, g.zoom), cx, cy - 10);
      for (let i = 0; i < 4; i++) { const a = -14 + i * 9; decalAt(P, 'nest', cx + a, cy - 18 - (i % 2) * 4, 0, g.seed + i); }
      for (let i = 0; i < 3; i++) { const x = cx - 10 + i * 10; P.rect(x, cy - 8, 3, 6, XB.spoonbill); P.px(x + 1, cy - 9, X.white); }
    },
    coastal_institute(ctx, P, g, row, variant, frame) {
      drawStandardBox(ctx, P, g, row, variant, frame);
      const a = frontPoint(g, 0), b = frontPoint(g, 0.5);
      P.line(a.x, a.y, b.x, b.y, PAL.boardwalk); P.line(a.x, a.y + 1, b.x, b.y + 1, shade(PAL.boardwalk, 0.8));
    }
  };

  /** every catalog id resolves non-trivially through either a SPECIAL entry or drawStandardBox */
  M.paintBuilding = function (ctx, row, variant, frame, zoom, seed, rot) {
    variant = Number.isFinite(variant) ? Math.max(0, variant | 0) : 0;
    frame = Number.isFinite(frame) ? (frame | 0) : 0;
    seed = seed | 0;
    if (!row) { begin(ctx, 1, 1, zoom); return { w: 1, h: 1, ox: 0, oy: 0 }; }
    const g = M.buildingBox(row, variant, zoom, rot);
    g.paint = row.paint || {};
    g.seed = hash(strHash(row.id || 'b'), (seed ^ variant) >>> 0);
    g.tone = (variant & SPR.DAMAGED) ? 0.8 : 1;
    begin(ctx, g.w, g.h, zoom);
    const P = tonePen(pen(ctx, g.zoom), g.tone);
    if (variant & SPR.RUIN) { drawRuinShape(P, g, g.seed); return { w: g.w, h: g.h, ox: g.ox, oy: g.oy }; }
    if (variant & SPR.PILINGS) drawPilingsGround(P, g, g.seed); else drawApron(P, g, g.seed);
    if (variant & SPR.SCAFFOLD) {
      drawScaffoldStage(P, g, row, frame);
    } else {
      const fn = SPECIAL[g.special];
      if (fn) fn(ctx, P, g, row, variant, frame); else drawStandardBox(ctx, P, g, row, variant, frame);
    }
    if ((variant & SPR.PILINGS) && !(variant & SPR.SCAFFOLD)) drawStilts(P, g);
    if (variant & SPR.DAMAGED) applyDamaged(P, g);
    if (variant & SPR.BOARDED) applyBoarded(P, g);
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  };

  // ---------------------------------------------------------------------------
  // Ms. Thibodeaux — 48×48 bust portrait, 2 frames (neutral / speaking)
  // ---------------------------------------------------------------------------
  function paintThibodeaux(ctx, spec) {
    const dims = begin(ctx, PORTRAIT, PORTRAIT, spec.zoom);
    const P = pen(ctx, spec.zoom);
    const cx = 24, cy = 24;
    P.ellipse(cx, cy, 22, 22, PAL.panel); P.ellipse(cx, cy, 21, 21, shade(PAL.panel, 1.3));
    P.ellipse(cx, cy + 12, 16, 11, PAL.purple); P.hline(cx - 16, cy + 3, 32, PAL.purpleHi);
    P.ellipse(cx, cy - 1, 10, 12, XB.skin);
    P.ellipse(cx, cy - 10, 9, 7, XB.hair); P.rect(cx - 9, cy - 7, 18, 7, XB.hair);
    P.ellipse(cx, cy - 16, 4, 4, XB.hair);
    const mouthOpen = (spec.frame | 0) === 1;
    P.rect(cx - 3, cy + 3, 6, mouthOpen ? 3 : 1, shade(XB.skin, 0.5));
    P.px(cx - 4, cy - 1, X.black); P.px(cx + 3, cy - 1, X.black);
    P.hline(cx - 7, cy - 2, 5, XB.glasses); P.hline(cx - 7, cy + 1, 5, XB.glasses); P.vline(cx - 7, cy - 2, 4, XB.glasses); P.vline(cx - 3, cy - 2, 4, XB.glasses);
    P.hline(cx + 2, cy - 2, 5, XB.glasses); P.hline(cx + 2, cy + 1, 5, XB.glasses); P.vline(cx + 2, cy - 2, 4, XB.glasses); P.vline(cx + 6, cy - 2, 4, XB.glasses);
    P.hline(cx - 2, cy - 1, 4, XB.glasses);
    P.rect(cx - 10, cy, 2, 2, PAL.gold); P.rect(cx + 8, cy, 2, 2, PAL.gold);
    return { w: dims.w, h: dims.h, ox: -24, oy: -24 };
  }

  // ---------------------------------------------------------------------------
  // `ruin:<fw>x<fh>` — a rubble pile sized to the footprint (no row/paint involved)
  // ---------------------------------------------------------------------------
  function paintRuinFamily(ctx, spec) {
    const m = /^(\d+)x(\d+)$/.exec(spec.sub || '');
    const fw = m ? Math.max(1, Math.min(12, +m[1])) : 1, fh = m ? Math.max(1, Math.min(12, +m[2])) : 1;
    const g = M.buildingBox({ w: fw, h: fh, paint: { floors: 1, roof: 'flat' } }, 0, spec.zoom);
    begin(ctx, g.w, g.h, spec.zoom);
    const P = pen(ctx, g.zoom);
    drawApron(P, g, spec.seed, XB.rubble);
    drawRuinShape(P, g, spec.seed);
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  }

  // ---------------------------------------------------------------------------
  // `icon:<catalogId>` — the 64×64 palette icon: the base sprite scaled to fit 60×60, centred.
  // Drag/paint rows show their terrain tile (mask 5, N+S straight); Pilings shows a dorm on stilts
  // at half scale; everything else is the row's own variant-0 building sprite.
  // ---------------------------------------------------------------------------
  const ICON_SURF = { path: 'surf:1', road: 'surf:2', boardwalk: 'surf:3', gator_fence: 'surf:4' };
  function paintIcon(ctx, spec) {
    const id = spec.sub;
    const dims = begin(ctx, ICON, ICON, spec.zoom);
    let src = null, scale = null;
    if (ICON_SURF[id]) src = M.get(ICON_SURF[id], 5, 0, 1);
    else if (id === 'levee') src = M.get('levee', 5, 0, 1);
    else if (id === 'canal') src = M.get('canal', 5, 0, 1);
    else if (id === 'floodwall') src = M.get('floodwall', 5, 0, 1);
    else if (id === 'preserve') src = M.get('preservePost', 5, 0, 1);
    else if (id === 'live_oak') src = M.get('oak', 2, 0, 1);
    else if (id === 'pilings') { src = M.get('dorm', SPR.PILINGS, 0, 1); scale = 0.5; }
    else src = M.get(id, 0, 0, 1);
    if (src && src.canvas) {
      const S = dims.S;
      if (scale === null) scale = Math.min(1, 60 / Math.max(src.sw, src.sh));
      const dw = Math.max(1, Math.round(src.sw * scale)), dh = Math.max(1, Math.round(src.sh * scale));
      const dx = Math.round((dims.w * S - dw) / 2), dy = Math.round((dims.h * S - dh) / 2);
      try { ctx.imageSmoothingEnabled = false; ctx.drawImage(src.canvas, src.sx, src.sy, src.sw, src.sh, dx, dy, dw, dh); } catch (e) { /* headless stub */ }
    }
    return { w: dims.w, h: dims.h, ox: -(dims.w >> 1), oy: -(dims.h >> 1) };
  }

  // ---------------------------------------------------------------------------
  // Registration (definition time, plain-object writes only — no DOM access here)
  // ---------------------------------------------------------------------------
  M.registerPainter('building', function (ctx, spec) {
    const row = spec.row;
    if (!row) { begin(ctx, 1, 1, spec.zoom); return { w: 1, h: 1, ox: 0, oy: 0 }; }
    const sp = specialOf(row);
    let frames = 1, perVariant = true;
    if (spec.variant & SPR.SCAFFOLD) frames = 3;
    else if (spec.variant & SPR.NIGHT) frames = 4;
    else if (sp === 'water_tower' || sp === 'surge_barrier') { frames = 4; perVariant = false; }
    spec.frames = frames; spec.framesPerVariant = perVariant;
    return M.paintBuilding(ctx, row, spec.variant, spec.frame, spec.zoom, spec.seed, spec.rot);
  });
  M.registerPainter('ruin', paintRuinFamily);
  M.registerPainter('thibodeaux', paintThibodeaux);
  M.registerPainter('icon', paintIcon);

  // ---------------------------------------------------------------------------
  // Self-test additions (run by sprites.js's own selfTest via M._tests)
  // ---------------------------------------------------------------------------
  M._tests.push(function () {
    const notes = [];
    const fail = (m) => notes.push(m);
    const data = BSU.data;
    if (!data || !data.catalog) return { ok: true, notes: 'data.js not loaded yet' };
    const cat = data.catalog;
    const b1 = M.buildingBox(cat.dorm, 0, 1);
    if (!(b1.fw === 3 && b1.fh === 2 && b1.floors === 4 && b1.wallH === 56 && b1.roofH === 12 && b1.w === 5 * 32 + 4 && b1.ox === -98 && b1.oy + b1.h === 18)) fail('buildingBox dorm base geometry: ' + JSON.stringify(b1));
    const b2 = M.buildingBox(cat.dorm, SPR.PILINGS, 1);
    if (!(b2.lift === 10 && b2.h === b1.h + 10)) fail('buildingBox dorm PILINGS lift +10');
    const b3 = M.buildingBox(cat.dorm, 0, 1, 1);
    if (!(b3.fw === 2 && b3.fh === 3 && b3.ox === -66)) fail('buildingBox dorm:r rotation swap');
    const bowl3 = M.buildingBox(cat.stadium, 3 << SPR.TIER_SHIFT, 1).bowlRect;
    const bowl0 = M.buildingBox(cat.stadium, 0, 1).bowlRect;
    if (!(bowl3 && bowl0 === null)) fail('stadium bowlRect: tier 3 non-null, tier 0 null');
    M.get('dorm', SPR.NIGHT, 0, 1); if (M.frames('dorm', SPR.NIGHT) !== 4) fail('dorm NIGHT frames !== 4');
    M.get('dorm', SPR.SCAFFOLD, 0, 1); if (M.frames('dorm', SPR.SCAFFOLD) !== 3) fail('dorm SCAFFOLD frames !== 3');
    M.get('water_tower', 0, 0, 1); if (M.frames('water_tower') !== 4) fail('water_tower frames !== 4');
    M.get('surge_barrier', 0, 0, 1); if (M.frames('surge_barrier') !== 4) fail('surge_barrier frames !== 4');
    if (M.frames('founders_hall') !== 1) fail('founders_hall base frames !== 1');
    const t = M.get('thibodeaux', 0, 0, 1);
    if (!(t && t.sw === 48 && t.sh === 48)) fail('thibodeaux 48x48');
    if (M.frames('thibodeaux') !== 2) fail('thibodeaux frames !== 2');
    const ic = M.get('icon:dorm', 0, 0, 1);
    if (!(ic && ic.sw === 64 && ic.sh === 64)) fail('icon:dorm 64x64');
    const errBefore = BSU.errors ? BSU.errors.size : 0;
    const combos = [0, SPR.NIGHT, SPR.DAMAGED, SPR.PILINGS, SPR.SCAFFOLD, SPR.RUIN, SPR.BOARDED, SPR.NIGHT | SPR.PILINGS | SPR.BOARDED];
    for (const row of data.catalogList) for (const v of combos) { const e = M.get(row.id, v, 0, 1); if (!e) fail('row ' + row.id + ' v' + v + ' returned null'); }
    if (BSU.errors && BSU.errors.size !== errBefore) fail('decal placement for some row raised BSU.error');
    return { ok: !notes.length, notes: notes.join('; ') || (data.catalogList.length + ' rows x ' + combos.length + ' variant combos OK') };
  });
})();
