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
  const FLOODED_BIT = SPR.FLOODED || 512;   // art pass B3 (contract.js SPR.FLOODED)
  /** apron per side along an axis of n tiles, in horizontal px (32 = one tile): 1×1 rows ~0.19 tile, 2-tile axes 0.31, longer 0.375 (design-pass setbacks) */
  function insetPx(n) { return n <= 1 ? 6 : n === 2 ? 10 : 12; }
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
    glasses: '#C0C0C0', hair: '#1B1B1B', apron: '#B9AE86', apronEdge: '#8F865F', rubble: '#6B625A', slab: '#9A9A9E',
    // design pass: apron materials
    brick: '#A8604A', brickDark: '#8C4A38', brickLight: '#C27A5C', hedge: '#3F6B2E', hedgeHi: '#5E9140', lampPost: '#2A2A32', lampHead: '#D8D8E0',
    paveLight: '#D8D2C2', paveDark: '#B9B2A1', lawnStripe: '#74AD36', terrace: '#E3D7BE', walk: '#D5CBAE', walkEdge: '#A89D7E', siteDirt: '#8B6B4A', fenceSteel: '#9A9AA0'
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
  /** rows above the 4-px bottom row at column offset d from the bottom corner (2 px per row on each side) */
  function rise(d) { return d >= 0 ? d >> 1 : (-d - 1) >> 1; }
  /** bottom-row index (0-based within a w×h quad) at column offset d from the CENTRE; k = skew (the bottom corner sits k px right of centre) */
  function bottomRow(w, h, d, k) { return h - 1 - rise(d - (k | 0)); }
  /**
   * The base-edge pixel y at column x of the quad centred (cx, cy): a 2:1 diamond when k = 0, else the iso
   * parallelogram of a fw×fh footprint — left (SW) face w/2 + k px wide, right (SE) face w/2 − k (design pass).
   */
  function baseY(cx, cy, w, h, x, k) { return cy - (h >> 1) + bottomRow(w, h, x - cx, k); }
  /** the top-edge pixel y at column x (the quad is 180° symmetric about its centre) */
  function topY(cx, cy, w, h, x, k) { return 2 * cy - 1 - baseY(cx, cy, w, h, 2 * cx - 1 - x, k); }
  /** fill the quad centred (cx, cy) with skew k, column by column; optional 1-px edge colour */
  function fillQuad(P, cx, cy, w, h, k, fill, stroke) {
    for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) {
      const yt = topY(cx, cy, w, h, x, k), yb = baseY(cx, cy, w, h, x, k);
      if (yb >= yt) P.rect(x, yt, 1, yb - yt + 1, fill);
      if (stroke) { P.px(x, yt, stroke); P.px(x, yb, stroke); }
    }
  }
  /** the four corners of the box's base quad lifted 'up' px: W (left), S (bottom), E (right), N (top) */
  function quadCorners(g, up) {
    const cx = g.bcx, cy = g.bcy - (up || 0), w = g.bw, h = g.bh, k = g.bk | 0;
    return { W: [cx - (w >> 1), cy - (k >> 1)], S: [cx + k, cy + (h >> 1)], E: [cx + (w >> 1) - 1, cy + (k >> 1)], N: [cx - k, cy - (h >> 1) + 1] };
  }
  const midPt = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const lerpPt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
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
  function walls(P, cx, cy, w, h, hgt, colorFn, k) {
    if (hgt <= 0) return;
    const split = cx + (k | 0);
    for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) {
      const yb = baseY(cx, cy, w, h, x, k);
      const c = colorFn(x, yb, x < split);
      if (c) P.rect(x, yb - hgt + 1, 1, hgt, c);
    }
  }
  /** the rim of the UPPER half of a quad (its NW/NE edges) */
  function topRim(P, cx, cy, w, h, color, k) { for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) P.px(x, topY(cx, cy, w, h, x, k), color); }
  /** the rim of the LOWER half (its SW/SE edges) */
  function bottomRim(P, cx, cy, w, h, color, k) { for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) P.px(x, baseY(cx, cy, w, h, x, k), color); }

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
   * inset box base quad; bcy already includes the lift), inset, bowlRect (stadium tiers ≥ 1).
   * Design pass: the box is the footprint parallelogram inset ipx/ipy px per side along each axis
   * (insetPx), so bl/br are the SW/SE face widths, bk the skew of the bottom corner (bx, by) from the
   * centre column; bgcy is the box quad's centre row at ground level (before the pilings lift).
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
    const ipx = insetPx(fw), ipy = insetPx(fh);
    const bl = fw * 32 - 2 * ipx, br = fh * 32 - 2 * ipy;            // SW / SE face widths (px); multiples of 4
    const bw = bl + br, bh = bw >> 1, bk = (bl - br) >> 1;            // bounding size and the bottom-corner skew (even)
    const bx = ax + (ipy - ipx), byv = ay + 16 - ((ipx + ipy) >> 1); // the inset quad's bottom corner (its bottom row is byv − 1)
    const inset = Math.min(ipx, ipy);
    let bowlRect = null;
    if (sp === 'stadium' && tier >= 1) {
      // the seating oval relative to the anchor: centred on the ground diamond, 70 % of it
      const rx = Math.round(gw * 0.36), ry = Math.round(gh * 0.36);
      bowlRect = { x: gcx - ax - rx, y: gcy - ay - ry - 6, w: 2 * rx, h: 2 * ry };
    }
    return { w: w, h: h, ox: ox, oy: oy, floors: floors, wallH: wallH, roofH: roofH, lift: lift, fw: fw, fh: fh, roof: roof, extraTop: extraTop, tier: tier,
      ax: ax, ay: ay, gcx: gcx, gcy: gcy, gw: gw, gh: gh, bcx: bx - bk, bcy: byv - (bh >> 1) - lift, bgcy: byv - (bh >> 1), bw: bw, bh: bh, bk: bk, bl: bl, br: br, bx: bx, by: byv - lift,
      ipx: ipx, ipy: ipy, inset: inset, bowlRect: bowlRect, zoom: (zoom === 2 ? 2 : 1), special: sp };
  };

  // ---------------------------------------------------------------------------
  // Ground (design pass): the designed apron on the TRUE footprint quad. Styles by catalog tab —
  // academic brick paving · housing lawn + hedge · utilities gravel + chain fence · dining terrace +
  // umbrellas · life/grounds light paving · sports/swamp lawn. The structure sits inset (buildingBox
  // ipx/ipy); the margin carries a foundation shadow, side hedges, the entrance walk and two lamp
  // posts (lit under NIGHT) on the SE face — or the SW face under FRONT_L. Pilings rows stand in
  // water on stilts with a plank walk. Rows with their own ground (stadium, fields, quad, pond,
  // parking, rookery) get a plain lawn quad with a curb only.
  // ---------------------------------------------------------------------------
  const APRON = Object.freeze({
    academic: { base: XB.brick, alt: XB.brickDark, hi: XB.brickLight, pattern: 'brick', hedge: true },
    housing: { base: XB.lawn, alt: XB.lawnStripe, hi: XB.lawnStripe, pattern: 'lawn', hedge: true },
    utilities: { base: XB.gravelPad, alt: '#7C7C80', hi: '#9C9CA0', pattern: 'gravel', fence: true },
    dining: { base: XB.terrace, alt: XB.paveDark, hi: XB.paveLight, pattern: 'terrace', umbrellas: true },
    life: { base: XB.paveLight, alt: XB.paveDark, hi: '#E4DED0', pattern: 'pave', hedge: true },
    grounds: { base: XB.lawn, alt: XB.lawnStripe, hi: XB.lawnStripe, pattern: 'lawn' },
    sports: { base: XB.lawn, alt: XB.lawnStripe, hi: XB.lawnStripe, pattern: 'lawn' },
    swamp: { base: XB.lawn, alt: XB.lawnStripe, hi: XB.lawnStripe, pattern: 'lawn', hedge: true },
    site: { base: XB.siteDirt, alt: '#6E5236', hi: '#A08560', pattern: 'gravel' }
  });
  const OWN_GROUND = { stadium: 1, practice_field: 1, quad: 1, pond: 1, parking: 1, rookery: 1 };
  M.APRON = APRON;
  function apronOf(row) { return APRON[(row && row.tab) || ''] || APRON.life; }
  /** the footprint quad's corners in canvas px (ground level): T back, R right, B bottom (= anchor tile's bottom), L left */
  function quadOf(g) {
    return { T: [g.ax + (g.fh - g.fw) * 32, g.ay + 16 - (g.fw + g.fh) * 16], R: [g.ax + g.fh * 32, g.ay + 16 - g.fh * 16], B: [g.ax, g.ay + 16], L: [g.ax - g.fw * 32, g.ay + 16 - g.fw * 16] };
  }
  /** the [xl, xr) span of the footprint quad on pixel row y (null outside) */
  function quadSpan(q, y) {
    if (y < q.T[1] || y >= q.B[1]) return null;
    const xl = y < q.L[1] ? q.T[0] - 2 * (y - q.T[1]) : q.L[0] + 2 * (y - q.L[1]);
    const xr = y < q.R[1] ? q.T[0] + 2 * (y - q.T[1]) : q.R[0] - 2 * (y - q.R[1]);
    return xr > xl ? [xl, xr] : null;
  }
  /** fill the footprint quad with the apron material: base, pattern, curb on the SW/SE edges, highlight on the NW/NE edges */
  function drawApronQuad(P, g, A, seed) {
    const q = quadOf(g), base = A.base, curb = shade(base, 0.62), hi = shade(base, 1.1), hi2 = shade(base, 1.12);
    const yT = q.T[1], yB = q.B[1], pat = OWN_GROUND[g.special] ? 'plain' : A.pattern;   // rows that paint their own ground only need the base
    for (let y = yT; y < yB; y++) {
      const sp = quadSpan(q, y); if (!sp) continue;
      const xl = sp[0], xr = sp[1], w = xr - xl, ry = y - yT;
      P.rect(xl, y, w, 1, base);
      if (pat === 'brick') {
        if ((ry % 3) === 2) P.rect(xl, y, w, 1, A.alt);
        else if ((ry % 6) === 0) { const off = (((ry / 6) | 0) & 1) ? 4 : 0; for (let x = xl + (((off - xl) % 8) + 8) % 8; x < xr; x += 8) P.px(x, y, A.alt); P.dither(xl, y, w, 1, null, A.hi, seed + y, 0.1); }
      } else if (pat === 'gravel') {
        if ((ry & 1) === 0) P.dither(xl, y, w, 1, null, A.alt, seed + y, 0.18); else if ((ry % 4) === 1) P.dither(xl, y, w, 1, null, A.hi, seed + y * 3, 0.08);
      } else if (pat === 'lawn') {
        if ((ry % 4) === 0) P.dither(xl, y, w, 1, null, hi2, seed + y * 7, 0.08);
      } else if (pat !== 'plain') {   // pave / terrace: big pavers in screen space
        const ps = pat === 'terrace' ? 8 : 6, ph = ps >> 1;
        if ((ry % ph) === 0) P.rect(xl, y, w, 1, A.alt);
        else { const off = (((ry / ph) | 0) & 1) ? (ps >> 1) : 0; for (let x = xl + (((off - xl) % ps) + ps) % ps; x < xr; x += ps) P.px(x, y, A.alt); }
      }
    }
    // lawn: mowing stripes as half-tile bands along the Y axis (band quads, not pixels)
    if (pat === 'lawn') for (let s = 1; s < g.fw * 2; s += 2) fpPoly(P, g, [[s / 2, 0], [(s + 1) / 2, 0], [(s + 1) / 2, g.fh], [s / 2, g.fh]], A.alt);
    // curbs on the SW/SE edges (2 px: the iso edge runs 2:1) and a highlight along the back edges
    for (let y = yT; y < yB; y++) {
      const sp = quadSpan(q, y); if (!sp) continue;
      const xl = sp[0], xr = sp[1];
      if (y >= q.L[1]) P.rect(xl, y, 2, 1, curb); else P.px(xl, y, hi);
      if (y >= q.R[1]) P.rect(xr - 2, y, 2, 1, curb); else P.px(xr - 1, y, hi);
    }
  }
  /** the dark foundation line where the box meets the ground (2 rows in front of the SW/SE faces) */
  function drawFoundation(P, g, base) {
    const k = g.bk | 0, cool = M.COOL_TINT || '#2B2550', c1 = mix(base, cool, 0.42), c2 = mix(base, cool, 0.2);   // B3: the apron contact shadow (cool, 2 rows, darker at the wall)
    for (let x = g.bcx - (g.bw >> 1); x < g.bcx + (g.bw >> 1); x++) { const y = baseY(g.bcx, g.bgcy, g.bw, g.bh, x, k) + 1; P.rect(x, y, 1, 2, c2); P.px(x, y, c1); }
  }
  function drawGrounds(P, g, row, variant, seed) {
    const site = !!(variant & SPR.SCAFFOLD);
    const A = site ? APRON.site : apronOf(row);
    drawApronQuad(P, g, A, seed);
    if (!site && !OWN_GROUND[g.special] && (g.wallH > 0 || g.special)) drawFoundation(P, g, A.base);
    g.apron = A;
  }
  /** pilings: the footprint quad is water/marsh (the stilts and a plank walk come after the box) */
  function drawPilingsGround(P, g, seed) {
    const water = mix(PAL.waterNight, PAL.mud, 0.5);
    const q = quadOf(g);
    for (let y = q.T[1]; y < q.B[1]; y++) {
      const sp = quadSpan(q, y); if (!sp) continue;
      P.rect(sp[0], y, sp[1] - sp[0], 1, water);
      if (((y + seed) % 5) === 0) { const x = sp[0] + (hash(seed, y) % Math.max(1, sp[1] - sp[0] - 3)); P.hline(x, y, 3, shade(PAL.shallows, 0.55)); }
      if (y >= q.L[1]) { P.px(sp[0], y, shade(water, 0.7)); } if (y >= q.R[1]) { P.px(sp[1] - 1, y, shade(water, 0.7)); }
    }
    g.apron = { base: water, pattern: 'water' };
  }
  /** a grid of bark 3×10 stilts every 12 px under the (lifted) box base */
  function drawStilts(P, g) {
    const k = g.bk | 0, bx0 = g.bcx - (g.bw >> 1) + 2, bx1 = g.bcx + (g.bw >> 1) - 3;
    for (let x = bx0; x <= bx1; x += STILT_PITCH) {
      const yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x, k);   // the lifted base edge at this column
      // the post stands from the lifted base down to the ground under it (lift px) plus 2 px into the water
      const B = rampOf(PAL.bark);
      P.rect(x, yb, 3, g.lift + 2, B[2]); P.vline(x, yb, g.lift + 2, B[3]); P.vline(x + 2, yb, g.lift + 2, B[0]);
      P.hline(x - 1, yb + g.lift + 2, 5, mix(PAL.waterNight, PAL.shallows, 0.35)); P.px(x - 2, yb + g.lift + 2, mix(PAL.waterNight, PAL.shallows, 0.6)); P.px(x + 4, yb + g.lift + 1, mix(PAL.waterNight, PAL.shallows, 0.6));
      if (x + STILT_PITCH <= bx1) { const yn = baseY(g.bcx, g.bcy, g.bw, g.bh, x + STILT_PITCH, k); P.line(x + 3, yb + g.lift - 1, x + STILT_PITCH - 1, yn + 1, B[1]); }   // cross-brace to the next post
    }
  }
  /** the back-row posts, painted BEFORE the box so the walls hide all but what shows between the front posts (after the box they overdrew the SW wall base) */
  function drawStiltsBack(P, g) {
    const k = g.bk | 0, bx0 = g.bcx - (g.bw >> 1) + 2, bx1 = g.bcx + (g.bw >> 1) - 3;
    for (let x = bx0 + 6; x <= bx1; x += STILT_PITCH * 2) { const yt = topY(g.bcx, g.bcy, g.bw, g.bh, x, k) + (g.bh >> 2); P.rect(x, yt, 2, g.lift, shade(PAL.bark, 0.7)); }
  }
  /** a clipped low hedge along an iso edge from (x0, y0) running 'len' px in direction dir (+1 = down-right, −1 = down-left); columns where skip(x) is true are left open */
  function hedgeRun(P, x0, y0, len, dir, skip, seed) {
    const top = XB.hedgeHi, body = XB.hedge, foot = shade(XB.hedge, 0.55);
    for (let i = 0; i < len; i++) {
      const x = x0 + dir * i, y = y0 + (i >> 1);
      if (skip(x)) continue;
      P.rect(x, y - 3, 1, 4, body);
      if (i & 1) P.px(x, y - 3, top); else P.px(x, y, foot);
      if ((hash(seed, x * 5) % 7) === 0) P.px(x, y - 4, top);
    }
  }
  /** a lamp post standing at ground point (x, y): 9-px post, head lit at night with a halo and a pool of light on the apron */
  function lampPost(P, x, y, night, base) {
    if (night) { const pool = mix(base || XB.apron, PAL.windowGlow, 0.45); P.ellipse(x, y, 6, 2, pool); P.ellipse(x, y, 3, 1, mix(pool, PAL.windowGlow, 0.4)); }
    P.vline(x, y - 10, 10, XB.lampPost); P.px(x, y, shade(XB.lampPost, 0.6));
    P.rect(x - 1, y - 12, 3, 2, night ? PAL.goldHi : XB.lampHead); P.px(x, y - 13, XB.lampPost);
    if (night) { P.px(x - 2, y - 12, PAL.windowGlow); P.px(x + 2, y - 12, PAL.windowGlow); P.px(x, y - 14, PAL.windowGlow); P.px(x - 1, y - 10, mix(PAL.windowGlow, XB.lampPost, 0.5)); P.px(x + 1, y - 10, mix(PAL.windowGlow, XB.lampPost, 0.5)); }
  }
  /** a café umbrella (gold/purple canopy on a pole) with a chair pixel */
  function umbrella(P, x, y, seed) {
    const c = (hash(seed, x) & 1) ? PAL.gold : PAL.purple2;
    P.vline(x, y - 7, 7, XB.lampPost); P.rect(x - 4, y - 8, 9, 1, c); P.rect(x - 3, y - 9, 7, 1, shade(c, 1.15)); P.rect(x - 1, y - 10, 3, 1, shade(c, 1.15));
    P.px(x - 3, y - 1, XB.paveDark); P.px(x + 3, y - 1, XB.paveDark);
  }
  /**
   * The margin furniture, drawn AFTER the structure (it stands in front of the SW/SE faces): the entrance walk
   * from the door to the footprint edge with two lamp posts, side hedges / chain fence / umbrellas by style.
   */
  function drawMargins(P, g, row, variant, frame) {
    void frame;
    const A = g.apron || apronOf(row);
    if (OWN_GROUND[g.special] || (variant & SPR.SCAFFOLD)) return;
    const night = !!(variant & SPR.NIGHT), pil = !!(variant & SPR.PILINGS);
    const k = g.bk | 0, q = quadOf(g);
    const frontLeft = !!g.frontLeft;
    const hasDoor = g.wallH > 0 && !!row.pathAdjacency && Number.isFinite(g.doorX);
    const margin = Math.min(g.ipx, g.ipy);
    // furniture gaps: [x0, x1) column ranges per side (0 = SE edge, 1 = SW edge) that hedges / fence / umbrellas skip
    const skips = [[], []];
    const skipped = (side, x, pad) => { const L = skips[side]; for (let i = 0; i < L.length; i++) if (x >= L[i][0] - pad && x < L[i][1] + pad) return true; return false; };
    // the walk: from the door's base straight out to the footprint edge (perpendicular to the face)
    if (hasDoor) {
      const dir = frontLeft ? -1 : 1, len = (frontLeft ? g.ipy : g.ipx) + 2;
      const wx = g.doorX, wy = g.doorY + 1 + g.lift;
      const c = pil ? PAL.boardwalk : XB.walk, e = pil ? shade(PAL.boardwalk, 0.7) : XB.walkEdge;
      for (let s = 0; s <= len; s++) { const x = wx + dir * s, y = wy + (s >> 1); P.rect(x - 3, y, 7, 1, c); P.px(x - 3, y, e); P.px(x + 3, y, e); if (pil && (s & 3) === 1) P.rect(x - 2, y, 5, 1, shade(PAL.boardwalk, 0.85)); }
      skips[frontLeft ? 1 : 0].push([Math.min(wx - 6, wx + dir * len - 6), Math.max(wx + 7, wx + dir * len + 7)]);
      if (pil) {   // gangway rails: bark posts every 3 px and a top rail on both sides of the planks
        const B = rampOf(PAL.bark);
        for (let s = 0; s <= len; s += 3) { const x = wx + dir * s, y = wy + (s >> 1); P.rect(x - 4, y - 3, 1, 3, B[2]); P.rect(x + 4, y - 3, 1, 3, B[2]); }
        P.line(wx - 4, wy - 3, wx + dir * len - 4, wy + (len >> 1) - 3, B[3]); P.line(wx + 4, wy - 3, wx + dir * len + 4, wy + (len >> 1) - 3, B[3]);
      } else {
        const T = (g.colors || faceColors(row.paint || {})).trim;
        if (hasFeature(g, 'steps')) { P.rect(wx - 4, wy, 9, 1, T[3]); P.rect(wx - 5, wy + 1, 11, 1, T[2]); P.px(wx - 5, wy + 1, T[1]); P.px(wx + 5, wy + 1, T[1]); P.px(wx - 4, wy, T[4]); }   // entrance steps
        if (hasFeature(g, 'planters') && margin >= 10) { const CL = MAT.clay, GR = MAT.green; for (const sgn of [-1, 1]) { const x = wx + sgn * 7 * dir, y = wy - sgn * 3; P.rect(x - 1, y - 2, 3, 2, CL[2]); P.px(x - 1, y - 2, CL[3]); P.px(x + 1, y - 1, CL[1]); P.hline(x - 2, y - 4, 5, GR[2]); P.hline(x - 1, y - 5, 3, GR[2]); P.px(x, y - 6, GR[3]); P.px(x - 2, y - 4, GR[1]); P.px(x - 1, y - 5, PAL.azalea); P.px(x + 1, y - 4, PAL.azalea); } }
      }
      // two lamps flanking the walk's outer end, 2 px inside the footprint edge
      const ex = wx + dir * (len - 2), ey = wy + ((len - 2) >> 1);
      lampPost(P, ex - 7 * dir, ey + 4, night, A.base); lampPost(P, ex + 7 * dir, ey - 3, night, A.base);
    }
    // tee pass: connectors from the footprint edge into the wall wherever a path/road/boardwalk runs flush (render decides where)
    if (g.tees && g.wallH > 0) for (let i = 0; i < g.tees.length; i++) { const r = teeStrip(P, g, row, g.tees[i], night, pil); if (r) skips[r[0]].push([r[1], r[2]]); }
    if (pil) return;
    void margin;
    // side treatments along the SW edge (L → B, dir +1) and the SE edge (B → R, dir −1), 5 px inside the curb
    if (A.hedge && margin >= 10 && g.wallH > 0) {
      const inset = 5;
      const l0x = q.L[0] + 2 * inset + 4, l0y = q.L[1] - inset + 2, lLen = Math.max(0, g.fw * 32 - 4 * inset - 8);
      hedgeRun(P, l0x, l0y, lLen, 1, (x) => skipped(1, x, 0), g.seed);
      const r0x = q.R[0] - 2 * inset - 5, r0y = q.R[1] - inset + 2, rLen = Math.max(0, g.fh * 32 - 4 * inset - 8);
      hedgeRun(P, r0x, r0y, rLen, -1, (x) => skipped(0, x, 0), g.seed + 9);
    }
    if (A.fence) {
      // chain fence along the SW and SE edges: 2-px steel posts every 12 px, a 1-px chain at mid height, a gap at the walk and at every tee
      const post = (x, y) => { P.rect(x, y - 6, 2, 6, XB.fenceSteel); P.px(x, y - 6, shade(XB.fenceSteel, 1.25)); P.hline(x - 1, y, 4, shade(XB.fenceSteel, 0.5)); };
      const run = (x0, y0, len, dir, side) => { for (let i = 0; i <= len; i += 1) { const x = x0 + dir * i, y = y0 + (i >> 1); if (skipped(side, x, 2)) continue; if ((i % 12) === 0) post(x, y); else if ((i & 1) === 0) P.px(x, y - 3, shade(XB.fenceSteel, 0.8)); } };
      run(q.L[0] + 6, q.L[1] + 1, g.fw * 32 - 10, 1, 1); run(q.R[0] - 7, q.R[1] + 1, g.fh * 32 - 10, -1, 0);
    }
    if (A.umbrellas && margin >= 10) {
      const n = Math.max(1, Math.min(3, g.fw + g.fh - 2));
      const NUDGE = [0, 12, -12, 20, -20];   // slide an umbrella along its edge rather than lose it to a tee's gap
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n; const sw = (i & 1) === 0, side = sw ? 1 : 0; const p = sw ? lerpPt(q.L, q.B, 0.15 + 0.7 * t) : lerpPt(q.B, q.R, 0.15 + 0.7 * t);
        const x0 = Math.round(p[0] + (sw ? 8 : -8)), y0 = Math.round(p[1] - 5), lo = (sw ? q.L[0] : q.B[0]) + 12, hi = (sw ? q.B[0] : q.R[0]) - 12;
        for (let j = 0; j < NUDGE.length; j++) {
          const x = x0 + NUDGE[j], y = y0 + (sw ? (NUDGE[j] >> 1) : -(NUDGE[j] >> 1));
          if (x < lo || x > hi || skipped(side, x, 5) || skipped(side, x + 4, 5) || skipped(side, x - 4, 5)) continue;
          umbrella(P, x, y, g.seed + i); break;
        }
      }
    }
  }
  /**
   * Tee pass. One connector for a footprint-edge tile whose outward neighbour is a path / road / boardwalk: a 7-px strip in the
   * neighbour's material from the wall base across the apron to 2 px past the footprint edge, centred on that tile, plus a
   * doorway (lit at night) where it meets the wall. Code = (surface << 6) | (side << 4) | k with side 0 = SE edge (east
   * neighbours), 1 = SW edge (south neighbours) and k the tile index counted from the footprint's bottom corner (the anchor
   * tile). Pilings rows get a plank gangway whatever the surface. Returns [side, x0, x1) — the column range the hedge / fence /
   * umbrellas must leave clear — or null. Geometry mirrors the entrance walk (drawMargins), so the two never differ in depth.
   */
  function teeStrip(P, g, row, code, night, pil) {
    const side = (code >> 4) & 1, k = code & 15, surf = (code >> 6) & 3;
    const n = side === 0 ? g.fh : g.fw;
    if (k >= n || k >= 16) return null;
    const kk = g.bk | 0, dir = side === 0 ? 1 : -1, ip = side === 0 ? g.ipx : g.ipy, len = ip + 2;
    const xw = side === 0 ? g.bx + 32 * k + 16 - g.ipy : g.bx - 32 * k - 16 + g.ipx;   // the landing column on the wall
    const yb = baseY(g.bcx, g.bgcy, g.bw, g.bh, xw, kk);                                 // the ground-level wall base row there
    const planks = pil || surf === BSU.SURF.BOARDWALK, road = !planks && surf === BSU.SURF.ROAD;
    const c = planks ? PAL.boardwalk : road ? PAL.asphalt : PAL.gravel;
    const e = planks ? shade(PAL.boardwalk, 0.7) : road ? shade(PAL.asphalt, 1.3) : shade(PAL.gravel, 0.8);
    for (let s = 0; s <= len; s++) {
      const x = xw + dir * s, y = yb + 1 + (s >> 1);
      P.rect(x - 3, y, 7, 1, c); P.px(x - 3, y, e); P.px(x + 3, y, e);
      if (planks && (s & 3) === 1) P.rect(x - 2, y, 5, 1, shade(PAL.boardwalk, 0.85));
      else if (!planks && !road && (s & 3) === 2) P.px(x + ((s >> 2) & 1) - 1, y, shade(PAL.gravel, 1.08));
      if (road && s >= len - 2) { P.px(x - 4, y, e); P.px(x + 4, y, e); }                 // the curb cut: a dropped kerb where it meets the road
    }
    if (planks) { const x = xw + dir * (len - 1), y = yb + 1 + ((len - 1) >> 1); P.rect(x - 5, y - 3, 1, 4, PAL.bark); P.rect(x + 5, y - 3, 1, 4, PAL.bark); }   // gangway posts
    // the doorway: a dark 3×5 opening with a light lintel at the lifted wall base; a lit transom at night
    const C = faceColors(g.paint), fc = side === 0 ? C.right : C.left, yd = yb - g.lift;
    P.rect(xw - 1, yd - 4, 3, 5, shade(fc, 0.45));
    P.hline(xw - 2, yd - 5, 5, shade(fc, 1.2));
    if (night) { P.hline(xw - 1, yd - 4, 3, PAL.windowGlow); P.px(xw, yd + 1, mix(PAL.windowGlow, c, 0.5)); P.px(xw + 1, yd + 1, mix(PAL.windowGlow, c, 0.5)); }
    else P.px(xw + 1, yd - 1, PAL.gold);
    const x0 = Math.min(xw, xw + dir * len) - 6, x1 = Math.max(xw, xw + dir * len) + 7;
    return [side, x0, x1];
  }
  /** tee pass: can this row take path connectors (render asks once per building)? footprint, path-adjacency rows with a wall and their own apron */
  M.teeable = function (row, rot) {
    if (!row || row.kind !== 'footprint' || !row.pathAdjacency) return false;
    if (OWN_GROUND[specialOf(row)]) return false;
    try { return M.buildingBox(row, 0, 1, rot).wallH > 0; } catch (e) { return false; }
  };
  M.teeCode = function (side, k, surf) { return ((surf & 3) << 6) | ((side & 1) << 4) | (k & 15); };

  // ---------------------------------------------------------------------------
  // The box: faces (three tones), outline, top highlight, gold trim, windows (seeded night
  // pattern), door. Records the window cells on g for BOARDED/DAMAGED.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Art pass B3 — "Louisiana Collegiate". Every surface takes its tones from a 5-tone ramp
  // (ART_STYLE §2: 0 deep, 1 shadow, 2 base, 3 light, 4 highlight; cool shadows, warm lights):
  // wall ramps from paint.wall, trim (limestone; gold on purple walls), roof tile, iron, glass,
  // concrete block, wood, sandbag. Light from the upper-left: the SW face is lit (tone 2 with
  // islands of 3), the SE face in shadow (tone 1 with threads of 0); roof planes NW 3 / SW 2 /
  // NE 2− / SE 1. Row features come from paint.features (data.js): see FEATURES below.
  // ---------------------------------------------------------------------------
  const RAMP_CACHE = new Map();
  /** the 5-tone ramp of a hex colour (memoised; unknown → cream stone) */
  function rampOf(hex) {
    hex = String(hex || PAL.creamStone).toUpperCase();
    let r = RAMP_CACHE.get(hex);
    if (!r) { r = M.makeRamp(hex); RAMP_CACHE.set(hex, r); }
    return r;
  }
  const MAT = Object.freeze({
    trim: rampOf(XB.limestone), iron: rampOf('#3C3B46'), glass: rampOf('#5B7E9C'), tile: rampOf(PAL.terracotta),
    concrete: rampOf('#A9A6A0'), block: rampOf('#9A9A9E'), wood: rampOf('#8B6B4A'), sheathing: rampOf('#6B4A2A'),
    sandbag: rampOf('#C9B47C'), tin: rampOf('#8A8A8E'), steel: rampOf('#8A8A8E'), stain: rampOf('#4A3B2A'),
    purple: rampOf(PAL.purple), gold: rampOf(PAL.gold2), green: rampOf('#3F6B2E'), clay: rampOf('#9A6A44'), crane: rampOf('#E0A020')
  });
  M.materials = MAT; M.rampOf = rampOf;
  // a 64×64 tile of periodic 2:1 value noise (8×4 px cells), built once; painters sample it by (x, y) + seed offset so
  // the bake pays an array read per sample instead of four hashes (ART_STYLE §3 noise; B3 perf)
  const NOISE_N = 64, NOISE = new Float32Array(NOISE_N * NOISE_N);
  for (let y = 0; y < NOISE_N; y++) for (let x = 0; x < NOISE_N; x++) NOISE[y * NOISE_N + x] = M.pnoise ? M.pnoise(0xB3, x, y, 8, 4, NOISE_N, NOISE_N) : 0.5;
  function noiseAt(x, y, seed) { return NOISE[(((y + (seed >> 6)) & 63) << 6) | ((x + seed) & 63)]; }
  M.noiseAt = noiseAt;
  /** sparse speckles of `color` inside the quad centred (cx, cy) (B3: replaces whole-rect dithers that spilled outside the quad) */
  function quadSpeckle(P, cx, cy, w, h, k, color, seed, th) {
    for (let x = cx - (w >> 1); x < cx + (w >> 1); x += 2) { const yt = topY(cx, cy, w, h, x, k), yb = baseY(cx, cy, w, h, x, k); for (let y = yt + 1; y < yb; y += 2) if (noiseAt(x, y, seed) > th) P.px(x, y, color); }
  }
  /** warm interior glows (ART_STYLE §4 `#FFD27A`), varied per window so a night facade is not a uniform grid */
  const GLOWS = Object.freeze(['#FFD27A', '#FFE9A8', '#F2B860', '#FFDC8E']);
  const WHITE = X.white;
  /** FEATURES a row may list in paint.features (sprites_buildings reads them; data.js writes them) */
  const FEATURES = Object.freeze(['pediment', 'cupola', 'cupola:gold', 'banner:roux', 'steps', 'planters', 'arched', 'mullions', 'gutters', 'gallery', 'gallery:both',
    'awnings', 'shutters', 'hvac', 'vents', 'tank', 'stack', 'flagpole', 'porch', 'belfry', 'dormers', 'cornice', 'sign:TEXT']);
  M.FEATURES = FEATURES;
  function hasFeature(g, name) { const f = g.features; if (!f) return false; for (let i = 0; i < f.length; i++) if (f[i] === name) return true; return false; }
  function featureArg(g, prefix) { const f = g.features; if (!f) return null; for (let i = 0; i < f.length; i++) if (f[i].indexOf(prefix) === 0) return f[i].slice(prefix.length); return null; }
  /** HSV-ish saturation of a hex colour (tin roofs are the grey ones) */
  function satOf(hex) {
    const s = String(hex || '').replace('#', ''); if (s.length < 6) return 1;
    const r = parseInt(s.slice(0, 2), 16), gg = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); return mx ? (mx - mn) / mx : 0;
  }
  function faceColors(paint) {
    const wall = (paint && paint.wall) || [PAL.creamStone, PAL.tanStucco];
    const l = wall[0] || PAL.creamStone, r = wall[1] || l;
    const RL = rampOf(l), RR = rampOf(r);
    const same = String(l).toUpperCase() === String(r).toUpperCase();
    const purple = isPurple(l) || isPurple(r);
    const trim = rampOf((paint && paint.trim) || (purple ? PAL.gold2 : XB.limestone));
    return {
      left: RL[2], right: same ? RR[1] : mix(RR[2], RR[1], 0.55), leftHi: RL[3], rightHi: same ? RR[2] : mix(RR[3], RR[2], 0.5),
      leftLo: RL[1], rightLo: RR[0], leftRaw: l, rightRaw: r, out: RL[0], outR: RR[0], RL: RL, RR: RR, trim: trim,
      goldL: isPurple(l), goldR: isPurple(r), material: (paint && paint.material) || 'stucco'
    };
  }
  /** a 1-px line `up` px above the base edge across the whole quad: cL on the SW face, cR on the SE face */
  function faceLine(P, cx, cy, w, h, k, up, cL, cR) {
    const split = cx + (k | 0), x0 = cx - (w >> 1), x1 = cx + (w >> 1) - 1;
    if (split - 1 >= x0 && cL) P.line(x0, baseY(cx, cy, w, h, x0, k) - up, split - 1, baseY(cx, cy, w, h, split - 1, k) - up, cL);
    if (x1 >= split && cR) P.line(split, baseY(cx, cy, w, h, split, k) - up, x1, baseY(cx, cy, w, h, x1, k) - up, cR);
  }
  /**
   * Material texture over the two faces (after the base tone): stucco = coherent noise islands of tone 3 and
   * threads of tone 1 (2:1 blobs, 3-px runs so the bake stays cheap); brick = mortar courses every 3 px with
   * staggered head joints; stone = 5-px courses; metal = panel seams; wood = battens; glass = spandrel bands + mullion grid.
   */
  function wallTexture(P, cx, cy, w, h, hgt, k, C, mat, seed) {
    const split = cx + (k | 0), x0 = cx - (w >> 1), x1 = cx + (w >> 1);
    if (mat === 'glass') {
      for (let x = x0; x < x1; x++) { const yb = baseY(cx, cy, w, h, x, k), left = x < split; const R = MAT.glass; P.rect(x, yb - hgt + 1, 1, hgt, left ? R[2] : R[1]); if (((x - (left ? x0 : split)) % 6) === 0) P.rect(x, yb - hgt + 1, 1, hgt, MAT.iron[left ? 2 : 1]); if ((hash(seed, x * 17) % 9) === 0) P.px(x, yb - hgt + 2 + (hash(seed, x * 5) % Math.max(1, hgt - 3)), R[3]); }
      for (let r = 1; r * FLOOR_PX < hgt; r++) { faceLine(P, cx, cy, w, h, k, r * FLOOR_PX - 1, MAT.iron[2], MAT.iron[1]); faceLine(P, cx, cy, w, h, k, r * FLOOR_PX - 2, MAT.glass[3], MAT.glass[2]); }
      return;
    }
    if (mat === 'brick' || mat === 'stone') {
      const course = mat === 'brick' ? 3 : 5, joint = mat === 'brick' ? 6 : 10;
      for (let up = course; up < hgt - 1; up += course) {
        faceLine(P, cx, cy, w, h, k, up, C.RL[1], C.RR[0]);
        const off = ((up / course) & 1) ? (joint >> 1) : 0;
        for (let x = x0 + off; x < x1; x += joint) { const yb = baseY(cx, cy, w, h, x, k); const left = x < split; P.px(x, yb - up + 1, left ? C.RL[1] : C.RR[0]); if (mat === 'brick' && (hash(seed, x * 7 + up) % 5) === 0) P.px(x + 1, yb - up + 1, left ? C.RL[3] : C.RR[2]); }
      }
      return;
    }
    if (mat === 'metal') {
      for (let up = 7; up < hgt - 1; up += 7) faceLine(P, cx, cy, w, h, k, up, C.RL[1], C.RR[0]);
      for (let x = x0 + 5; x < x1; x += 12) { if (Math.abs(x - split) < 2) continue; const yb = baseY(cx, cy, w, h, x, k); P.rect(x, yb - hgt + 2, 1, hgt - 2, x < split ? C.RL[1] : C.RR[0]); }
      return;
    }
    if (mat === 'wood') {
      for (let x = x0 + 2; x < x1; x += 4) { if (Math.abs(x - split) < 2) continue; const yb = baseY(cx, cy, w, h, x, k); P.rect(x, yb - hgt + 2, 1, hgt - 2, x < split ? C.RL[1] : C.RR[0]); if ((hash(seed, x * 3) % 4) === 0) P.px(x + 1, yb - 2 - (hash(seed, x) % Math.max(1, hgt - 4)), x < split ? C.RL[3] : C.RR[2]); }
      return;
    }
    // stucco: coherent islands (tone 3 on the lit face, tone 2 on the shadow face) and threads (tone 1 / 0)
    const hiL = mix(C.left, C.leftHi, 0.5), loL = mix(C.left, C.leftLo, 0.45), hiR = mix(C.right, C.rightHi, 0.5), loR = mix(C.right, C.rightLo, 0.45);
    for (let x = x0; x < x1; x++) {
      const yb = baseY(cx, cy, w, h, x, k), left = x < split, yt = yb - hgt + 2;
      for (let y = yt + (x & 1); y < yb - 1; y += 3) {
        const n = noiseAt(x, y, seed);
        if (n > 0.74) P.rect(x, y, 1, Math.min(2, yb - 1 - y), left ? hiL : hiR);
        else if (n < 0.13) P.rect(x, y, 1, Math.min(2, yb - 1 - y), left ? loL : loR);
      }
    }
  }
  /**
   * The box: faces with material texture, belt courses at every floor line, a 2-row cornice under the eave,
   * a plinth row at the base, the 1-px outline (tone 0: bottom edge, outer verticals, front corner) and the top.
   * opts: {hgt (default g.wallH), cx, cy, w, h, colors, noTop, k, seed, raw (no courses), material, floors, topColor}
   */
  function drawBox(P, g, paint, opts) {
    opts = opts || {};
    const cx = opts.cx !== undefined ? opts.cx : g.bcx, cy = opts.cy !== undefined ? opts.cy : g.bcy, w = opts.w || g.bw, h = opts.h || g.bh;
    const hgt = opts.hgt !== undefined ? opts.hgt : g.wallH;
    const C = opts.colors || faceColors(paint);
    const seed = opts.seed | 0;
    const k = opts.k !== undefined ? (opts.k | 0) : ((opts.cx === undefined && opts.w === undefined) ? (g.bk | 0) : 0);
    const split = cx + k;
    const mat = opts.material || C.material || 'stucco';
    const floors = opts.floors !== undefined ? opts.floors : (g.floors | 0);
    if (hgt > 0) {
      walls(P, cx, cy, w, h, hgt, (x, yb, left) => (left ? C.left : C.right), k);
      wallTexture(P, cx, cy, w, h, hgt, k, C, mat, seed);
      if (!opts.raw) {
        const T = C.trim;
        if (mat !== 'glass') for (let r = 1; r < floors && r * FLOOR_PX < hgt - 3; r++) faceLine(P, cx, cy, w, h, k, r * FLOOR_PX - 1, T[3], T[1]);   // belt courses
        if (hgt >= 10 && mat !== 'glass' && !hasFeature(g, 'nocornice')) { faceLine(P, cx, cy, w, h, k, hgt - 1, T[4], T[2]); faceLine(P, cx, cy, w, h, k, hgt - 2, T[3], T[1]); }   // cornice
        if (hgt >= 8) faceLine(P, cx, cy, w, h, k, 1, mat === 'stucco' ? T[2] : C.RL[1], mat === 'stucco' ? T[1] : C.RR[0]);   // plinth
      }
      // 1-px outline: the bottom edges, the two outer verticals and the front corner (tone 0 of the face's ramp)
      for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) P.px(x, baseY(cx, cy, w, h, x, k), x < split ? C.out : C.outR);
      const xl = cx - (w >> 1), xr = cx + (w >> 1) - 1;
      P.vline(xl, baseY(cx, cy, w, h, xl, k) - hgt + 1, hgt, C.out); P.vline(xr, baseY(cx, cy, w, h, xr, k) - hgt + 1, hgt, C.outR);
      P.vline(split, cy + (h >> 1) - hgt, hgt, C.out);
      // the lit top edge of the SW face (gold cornice on purple walls)
      for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) { const y = baseY(cx, cy, w, h, x, k) - hgt + 1; const left = x < split; P.px(x, y, left ? (C.goldL ? PAL.gold : (opts.raw ? C.leftHi : C.trim[4])) : (C.goldR ? PAL.gold2 : (opts.raw ? C.rightHi : C.trim[2]))); }
    }
    if (!opts.noTop) { const tc = opts.topColor || C.RR[2]; fillQuad(P, cx, cy - hgt, w, h, k, tc); topRim(P, cx, cy - hgt, w, h, rampOf(tc)[1], k); }
    return C;
  }
  /**
   * Windows: cols per face, rows from paint.windows (one per floor when rows === floors); 3×4 glass cells with a
   * limestone sill and lintel, an optional mullion cross ('mullions'), round-headed ('arched'), louvered shutters in the
   * accent colour ('shutters'). NIGHT: lit / dark per the seeded pattern hash(row.n·131 + frame, cell) % 100 < 70, lit
   * cells take one of four warm glows and a few show a half-drawn curtain. Returns the cell list (also g.windowCells).
   */
  function drawWindows(P, g, row, opts) {
    opts = opts || {};
    const paint = row.paint || {};
    const win = paint.windows || { cols: 0, rows: 0 };
    const cols = Math.max(0, Math.min(16, win.cols | 0)), rows = Math.max(0, Math.min(20, win.rows | 0));
    const cells = [];
    g.windowCells = cells;
    if (!cols || !rows || g.wallH <= 0) return cells;
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh, k = g.bk | 0, split = cx + k;
    const pitch = g.wallH / rows;
    const C = faceColors(paint), T = C.trim, G = MAT.glass;
    const night = !!opts.night, frame = opts.frame | 0, n = (row.n | 0) * 131 + frame;
    const arched = !!opts.arched || hasFeature(g, 'arched'), big = opts.big || 0;
    const mullions = hasFeature(g, 'mullions') || big > 0, shutters = hasFeature(g, 'shutters'), opening = !!opts.opening;
    const acc = rampOf(paint.accent || PAL.purple);
    const doorFace = g.frontLeft ? 0 : 1;
    const W = WIN_W + big, H = WIN_H + (big >> 1);
    let idx = 0;
    for (const face of [0, 1]) {
      const fx0 = face === 0 ? cx - (w >> 1) : split, fx1 = face === 0 ? split : cx + (w >> 1);
      const faceW = (fx1 - fx0) - 4, x0 = fx0 + 2;
      const cw = Math.max(1, faceW / cols);
      const left = face === 0;
      const sill = left ? T[3] : T[1], lintel = left ? T[2] : T[1], glassDay = left ? G[2] : G[1], glassHi = left ? G[3] : G[2];
      const shut = left ? acc[2] : acc[1], shutHi = left ? acc[3] : acc[2];
      const wallC = left ? C.left : C.right;
      for (let r = 0; r < rows; r++) {
        for (let kk = 0; kk < cols; kk++) {
          const x = Math.round(x0 + cw * (kk + 0.5)) - 1 - (W >> 1) + 1;
          if (x < fx0 + 2 || x + W > fx1 - 2) continue;
          const yb = baseY(cx, cy, w, h, x, k);
          const y = Math.round(yb - r * pitch - 4) - H;
          if (y < yb - g.wallH + 3) continue;
          if (face === doorFace && r === 0 && !opts.noDoor && Math.abs(x + (W >> 1) - (fx0 + fx1) / 2) < 5) continue;
          const lit = night && (hash(n, idx) % 100) < LIT_SHARE;
          const glow = GLOWS[hash(n, idx * 7 + 3) % GLOWS.length];
          const c = opening ? MAT.block[0] : night ? (lit ? glow : WINDOW_DARK) : glassDay;
          if (opening) P.rect(x - 1, y - 1, W + 2, H + 2, c); else P.rect(x, y, W, H, c);
          if (!opening) {
            if (!night) { P.px(x, y, glassHi); if (W >= 3) P.px(x + 1, y, mix(glassHi, glassDay, 0.5)); }
            else if (lit && (hash(n, idx * 11) % 4) === 0) P.rect(x, y + (H >> 1), W, H - (H >> 1), mix(glow, WINDOW_DARK, 0.55));   // curtain
            else if (!lit) P.px(x, y, mix(WINDOW_DARK, glassHi, 0.35));
            if (mullions && W >= 3) { P.vline(x + (W >> 1), y, H, night ? MAT.iron[1] : (left ? T[3] : T[2])); if (H >= 4) P.hline(x, y + (H >> 1), W, night ? MAT.iron[1] : (left ? T[3] : T[2])); }
            P.hline(x - 1, y + H, W + 2, sill);
            if (arched) { P.hline(x, y - 1, W, lintel); P.px(x, y, wallC); P.px(x + W - 1, y, wallC); P.px(x + (W >> 1), y - 2, left ? T[4] : T[2]); }
            else P.hline(x - 1, y - 1, W + 2, lintel);
            if (shutters && cw >= W + 4) { P.rect(x - 2, y, 1, H, shut); P.rect(x + W + 1, y, 1, H, shut); P.px(x - 2, y + 1, shutHi); P.px(x + W + 1, y + 1, shutHi); if (H > 3) { P.px(x - 2, y + 3, shutHi); P.px(x + W + 1, y + 3, shutHi); } }
          } else { P.hline(x, y - 1, W, C.RL[1]); }
          cells.push({ x: x, y: y, w: W, h: H, face: face, lit: lit, r: r });
          idx++;
        }
      }
    }
    return cells;
  }
  /** the door at the base of the entrance face's centre: panel in `color` (purple; gold on purple walls), a limestone frame, a transom (lit at night); records g.doorX/doorY */
  function drawDoor(P, g, color, wide, night) {
    if (g.wallH <= 0) return;
    const cx = g.bcx, w = g.bw, k = g.bk | 0;
    const fc = g.frontLeft ? cx + k - (g.bl >> 1) : cx + k + (g.br >> 1);
    const dw = wide ? 6 : 4, dx = fc - (dw >> 1);
    const yb = baseY(cx, g.bcy, w, g.bh, dx + 1, k);
    g.doorX = fc; g.doorY = yb;
    const C = g.colors || faceColors(g.paint || {}), T = C.trim, left = !!g.frontLeft;
    const col = color || PAL.purple, R = rampOf(col);
    P.rect(dx, yb - 5, dw, 6, R[2]);
    P.rect(dx + (dw >> 1), yb - 5, dw >> 1, 6, R[1]);
    P.vline(dx - 1, yb - 7, 8, left ? T[3] : T[2]); P.vline(dx + dw, yb - 7, 8, left ? T[2] : T[1]);
    P.hline(dx - 1, yb - 7, dw + 2, left ? T[4] : T[3]);
    P.hline(dx, yb - 6, dw, night ? GLOWS[0] : MAT.glass[2]);   // transom
    P.px(dx + dw - 2, yb - 3, PAL.gold);
    if (night) { P.px(dx + 1, yb - 1, mix(R[2], GLOWS[0], 0.35)); P.px(dx + dw - 2, yb - 1, mix(R[1], GLOWS[0], 0.35)); }
  }

  // ---------------------------------------------------------------------------
  // Roof library: each draws over the box top given the geometry g; tones from the roof colour's ramp
  // (NW 3 · SW 2 · NE 2− · SE 1), tile courses parallel to the eaves, ridge cap in tone 4 over tone 0,
  // hips in tone 0, the eave in tone 0. Grey roof colours are tin (standing seams instead of courses).
  // Records g.roofGeom = {kind, along, W, S, E, N, a, b, R} for dormers, the cupola and the damage overlay.
  // Exposed as M.roofs[type](ctx, g, color).
  // ---------------------------------------------------------------------------
  function roofRamp(color) { return rampOf(color || PAL.terracotta); }
  /** tile courses on the plane whose eave runs e0→e1 and whose ridge/apex runs r0→r1 (every `step` px up the slope) */
  function courses(P, e0, e1, r0, r1, color, step, tin) {
    const len = Math.hypot(r0[0] - e0[0], r0[1] - e0[1]);
    if (tin) {   // standing seams: lines from the eave to the ridge every 6 px along the eave
      const n = Math.max(2, Math.round(Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) / 6));
      for (let i = 1; i < n; i++) { const t = i / n; const p0 = lerpPt(e0, e1, t), p1 = lerpPt(r0, r1, t); P.line(p0[0], p0[1], p1[0], p1[1], color); }
      return;
    }
    const n = Math.max(1, Math.round(len / step));
    for (let i = 1; i < n; i++) { const t = i / n; const p0 = lerpPt(e0, r0, t), p1 = lerpPt(e1, r1, t); P.line(p0[0], p0[1], p1[0], p1[1], color); }
  }
  const ROOF = {
    none(P, g, color) { void P; void g; void color; },
    flat(P, g, color) {
      const cx = g.bcx, cy = g.bcy - g.wallH, w = g.bw, h = g.bh, R = g.roofH, k = g.bk | 0;
      const T = roofRamp(color || PAL.terracotta), C = g.colors || faceColors(g.paint || {});
      // the parapet: the faces continue up in the wall's own tones, capped by a limestone coping
      walls(P, cx, cy - R, w, h, R, (x, yb, left) => left ? C.leftLo : C.rightLo, k);
      fillQuad(P, cx, cy - R, w, h, k, T[2]);
      topRim(P, cx, cy - R, w, h, T[1], k); bottomRim(P, cx, cy - R, w, h, C.trim[3], k);
      fillQuad(P, cx, cy - R + 1, w - 8, h - 4, k, T[1]);
      fillQuad(P, cx, cy - R + 2, w - 12, h - 6, k, T[2]);
      quadSpeckle(P, cx, cy - R + 2, w - 12, h - 6, k, T[3], g.seed + 78, 0.74); quadSpeckle(P, cx, cy - R + 2, w - 12, h - 6, k, T[1], g.seed + 91, 0.8);   // gravel ballast
      const xl = cx - (w >> 1), xr = cx + (w >> 1) - 1;
      P.vline(xl, baseY(cx, cy, w, h, xl, k) - R + 1, R, C.out); P.vline(xr, baseY(cx, cy, w, h, xr, k) - R + 1, R, C.outR);
      bottomRim(P, cx, cy, w, h, C.out, k);
      g.roofGeom = { kind: 'flat', R: T, top: cy - R, w: w - 12, h: h - 6, k: k };
    },
    hip(P, g, color) {
      const Rh = Math.max(1, g.roofH), T = roofRamp(color), k = g.bk | 0, tin = satOf(color || PAL.terracotta) < 0.12;
      const q = quadCorners(g, g.wallH), W = q.W, S = q.S, E = q.E, N = q.N;
      const along = g.fw >= g.fh;
      const m0 = along ? midPt(W, N) : midPt(N, E), m1 = along ? midPt(S, E) : midPt(W, S);
      const a = lerpPt(m0, m1, 0.3), b = lerpPt(m0, m1, 0.7); a[1] -= Rh; b[1] -= Rh;
      const nw = T[3], ne = mix(T[2], T[1], 0.5), sw = T[2], se = T[1];
      if (along) { fillPoly(P, [W, N, a], nw); fillPoly(P, [N, E, b, a], ne); fillPoly(P, [W, S, b, a], sw); fillPoly(P, [S, E, b], se); }
      else { fillPoly(P, [N, E, a], ne); fillPoly(P, [W, N, a, b], nw); fillPoly(P, [S, E, a, b], se); fillPoly(P, [W, S, b], sw); }
      // tile courses: the long front plane, the long back plane and the two hip ends
      if (along) { courses(P, W, S, a, b, T[1], 3, tin); courses(P, N, E, a, b, T[2], 3, tin); courses(P, S, E, b, b, T[0], 3, tin); courses(P, W, N, a, a, T[2], 3, tin); }
      else { courses(P, S, E, b, a, T[0], 3, tin); courses(P, W, N, b, a, T[2], 3, tin); courses(P, W, S, b, b, T[1], 3, tin); courses(P, N, E, a, a, T[1], 3, tin); }
      const hipC = T[0];
      if (along) { P.line(W[0], W[1], a[0], a[1], hipC); P.line(N[0], N[1], a[0], a[1], hipC); P.line(S[0], S[1], b[0], b[1], hipC); P.line(E[0], E[1], b[0], b[1], hipC); }
      else { P.line(N[0], N[1], a[0], a[1], hipC); P.line(E[0], E[1], a[0], a[1], hipC); P.line(W[0], W[1], b[0], b[1], hipC); P.line(S[0], S[1], b[0], b[1], hipC); }
      P.line(a[0], a[1] + 1, b[0], b[1] + 1, T[0]); P.line(a[0], a[1], b[0], b[1], T[4]);   // ridge cap
      bottomRim(P, g.bcx, g.bcy - g.wallH, g.bw, g.bh, T[0], k);
      g.roofGeom = { kind: 'hip', along: along, W: W, S: S, E: E, N: N, a: a, b: b, R: T, tin: tin };
    },
    gable(P, g, color) {
      const cx = g.bcx, cy = g.bcy - g.wallH, w = g.bw, h = g.bh, Rh = Math.max(1, g.roofH), k = g.bk | 0;
      const T = roofRamp(color), tin = satOf(color || PAL.terracotta) < 0.12;
      const q = quadCorners(g, g.wallH), W = q.W, S = q.S, E = q.E, N = q.N;
      const along = g.fw >= g.fh;
      const a = along ? midPt(W, N) : midPt(N, E), b = along ? midPt(S, E) : midPt(W, S);
      a[1] -= Rh; b[1] -= Rh;
      const C = g.colors || faceColors(g.paint || {});
      if (along) {
        fillPoly(P, [N, E, b, a], mix(T[2], T[1], 0.5)); fillPoly(P, [W, S, b, a], T[2]);
        fillPoly(P, [S, E, b], C.right);
        courses(P, W, S, a, b, T[1], 3, tin); courses(P, N, E, a, b, T[1], 3, tin);
        P.line(S[0], S[1], b[0], b[1], T[0]); P.line(E[0], E[1], b[0], b[1], T[0]); P.line(W[0], W[1], a[0], a[1], T[0]);
        const v = midPt(midPt(S, E), b); P.rect(v[0] - 1, v[1] - 1, 2, 2, C.RR[0]);   // gable vent
      } else {
        fillPoly(P, [W, N, a, b], T[3]); fillPoly(P, [S, E, a, b], T[1]);
        fillPoly(P, [W, S, b], C.left);
        courses(P, S, E, b, a, T[0], 3, tin); courses(P, W, N, b, a, T[2], 3, tin);
        P.line(S[0], S[1], b[0], b[1], T[0]); P.line(W[0], W[1], b[0], b[1], T[0]); P.line(E[0], E[1], a[0], a[1], T[0]);
        const v = midPt(midPt(W, S), b); P.rect(v[0] - 1, v[1] - 1, 2, 2, C.RL[1]);
      }
      P.line(a[0], a[1] + 1, b[0], b[1] + 1, T[0]); P.line(a[0], a[1], b[0], b[1], T[4]);
      bottomRim(P, cx, cy, w, h, T[0], k);
      g.roofGeom = { kind: 'gable', along: along, W: W, S: S, E: E, N: N, a: a, b: b, R: T, tin: tin };
    },
    barrel(P, g, color) {
      const cx = g.bcx, cy = g.bcy - g.wallH, w = g.bw, h = g.bh, Rh = Math.max(2, g.roofH), k = g.bk | 0;
      const T = roofRamp(color);
      const along = g.fw >= g.fh;
      const tones = [T[2], T[3], T[3], T[2], T[1]];
      const bands = 5;
      const q = quadCorners(g, g.wallH);
      const ptA = (u, hgt) => { const p = along ? lerpPt(q.W, q.N, (u + 1) / 2) : lerpPt(q.N, q.E, (u + 1) / 2); return [p[0], p[1] - hgt]; };
      const ptB = (u, hgt) => { const p = along ? lerpPt(q.S, q.E, (u + 1) / 2) : lerpPt(q.W, q.S, (u + 1) / 2); return [p[0], p[1] - hgt]; };
      for (let i = 0; i < bands; i++) {
        const u0 = -1 + 2 * i / bands, u1 = -1 + 2 * (i + 1) / bands;
        const h0 = Rh * Math.sqrt(Math.max(0, 1 - u0 * u0)), h1 = Rh * Math.sqrt(Math.max(0, 1 - u1 * u1));
        fillPoly(P, [ptA(u0, h0), ptA(u1, h1), ptB(u1, h1), ptB(u0, h0)], tones[i]);
        if (i) { const s0 = ptA(u0, h0), s1 = ptB(u0, h0); P.line(s0[0], s0[1], s1[0], s1[1], i < 3 ? T[1] : T[0]); }
      }
      const C = g.colors || faceColors(g.paint || {});
      const end = [];
      for (let kk = 0; kk <= 8; kk++) { const u = -1 + 2 * kk / 8; end.push(ptB(u, Rh * Math.sqrt(Math.max(0, 1 - u * u)))); }
      fillPoly(P, end, along ? C.right : C.left);
      // a fan window in the end wall
      const em = ptB(0, Rh * 0.45); P.rect(em[0] - 3, em[1] - 1, 7, 3, MAT.glass[1]); P.hline(em[0] - 2, em[1] - 2, 5, MAT.glass[2]); P.px(em[0], em[1] - 3, C.trim[3]);
      strokeEdges(P, end, T[0]);
      bottomRim(P, cx, cy, w, h, T[0], k);
      g.roofGeom = { kind: 'barrel', along: along, W: q.W, S: q.S, E: q.E, N: q.N, a: ptA(0, Rh), b: ptB(0, Rh), R: T };
    },
    dome(P, g, color) {
      ROOF.hip(P, g, color);
      const cx = g.bcx, cy = g.bcy - g.wallH - g.roofH, r = Math.max(6, Math.min(g.fw, g.fh) * 12 >> 1) + 4;
      const gold = (g.paint && g.paint.accent) || PAL.gold;
      for (let dy = -r; dy <= 0; dy++) { const kq = 1 - (dy * dy) / (r * r); if (kq < 0) continue; const half = Math.round(Math.sqrt(kq) * r); if (half <= 0) continue; const t = -dy / r; P.rect(cx - half, cy + dy, half, 1, t > 0.8 ? PAL.goldHi : shade(gold, 1.0)); P.rect(cx, cy + dy, half, 1, t > 0.8 ? shade(gold, 1.0) : shade(gold, 0.72)); P.px(cx - half, cy + dy, PAL.goldShadow); P.px(cx + half - 1, cy + dy, PAL.goldShadow); }
      P.ellipse(cx - (r >> 2), cy - (r * 0.55), r >> 3, r >> 3, PAL.goldHi);
      P.hline(cx - r, cy, 2 * r, PAL.goldShadow); P.hline(cx - r + 2, cy + 1, 2 * r - 4, shade(PAL.goldShadow, 0.8));
      P.vline(cx, cy - r - 3, 3, PAL.goldHi); P.px(cx, cy - r - 4, WHITE);
    },
    bowl(P, g, color) { void P; void g; void color; /* the stadium special draws its bowl */ }
  };
  M.roofs = {};
  for (const kname of Object.keys(ROOF)) M.roofs[kname] = (function (fn) { return function (ctx, g, color) { try { fn(pen(ctx, g && g.zoom), g, color); } catch (e) { BSU.error('sprites', 'roof:' + kname, e); } }; })(ROOF[kname]);

  // ---------------------------------------------------------------------------
  // Roof furniture (B3): the long front plane of a hip/gable roof (for dormers and the tarp), the ridge
  // (cupola, vents), rooftop equipment (HVAC, water tank, stack) on flat tops or the ridge.
  // ---------------------------------------------------------------------------
  /** the front long plane of the recorded roof: eave e0→e1 and the matching ridge r0→r1 (null for flat/none) */
  function frontPlane(rg) {
    if (!rg || (rg.kind !== 'hip' && rg.kind !== 'gable')) return null;
    return rg.along ? { e0: rg.W, e1: rg.S, r0: rg.a, r1: rg.b, face: 0 } : { e0: rg.S, e1: rg.E, r0: rg.b, r1: rg.a, face: 1 };
  }
  function planePt(pl, t, s) { return lerpPt(lerpPt(pl.e0, pl.e1, t), lerpPt(pl.r0, pl.r1, t), s); }
  function drawDormers(P, g, night, frame) {
    const pl = frontPlane(g.roofGeom); if (!pl) return;
    const C = g.colors, T = g.roofGeom.R, n = (g.row.n | 0) * 131 + frame;
    const len = Math.hypot(pl.e1[0] - pl.e0[0], pl.e1[1] - pl.e0[1]);
    const count = len > 110 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1), p = planePt(pl, t, 0.42), x = Math.round(p[0]), y = Math.round(p[1]);
      const wall = pl.face === 0 ? C.left : C.right;
      P.rect(x - 2, y - 3, 5, 4, wall); P.vline(x - 2, y - 3, 4, pl.face === 0 ? C.leftHi : C.rightHi); P.vline(x + 2, y - 3, 4, pl.face === 0 ? C.leftLo : C.rightLo);
      const lit = night && (hash(n, 500 + i) % 100) < LIT_SHARE;
      P.rect(x - 1, y - 2, 3, 2, night ? (lit ? GLOWS[(i + 1) % GLOWS.length] : WINDOW_DARK) : MAT.glass[1]); if (!night) P.px(x - 1, y - 2, MAT.glass[3]);
      P.hline(x - 3, y - 4, 7, T[3]); P.hline(x - 2, y - 5, 5, T[4]); P.hline(x - 1, y - 6, 3, T[4]);
      P.px(x - 3, y - 4, T[0]); P.px(x + 3, y - 4, T[0]); P.px(x - 2, y - 5, T[1]); P.px(x + 2, y - 5, T[0]);
      P.hline(x - 2, y + 1, 5, T[0]);
    }
  }
  /** cupola on the ridge centre: a louvered box with a pyramid (or gold dome: 'cupola:gold') and a gold finial */
  function drawCupola(P, g, gold, night) {
    const rg = g.roofGeom; if (!rg || !rg.a) return;
    const m = midPt(rg.a, rg.b), x = Math.round(m[0]), y = Math.round(m[1]) - 1, C = g.colors, T = rg.R;
    const bw = gold ? 10 : 8, bh = gold ? 7 : 6, hw = bw >> 1;
    P.rect(x - hw, y - bh, bw, bh, C.left); P.rect(x + 1, y - bh, hw - 1, bh, C.right);
    P.vline(x - hw, y - bh, bh, C.leftHi); P.vline(x + hw - 1, y - bh, bh, C.rightLo); P.hline(x - hw, y, bw, C.out);
    for (const dx of (gold ? [-3, 0, 3] : [-2, 1])) { const lit = night && (dx !== 0); P.rect(x + dx, y - bh + 2, 1, bh - 3, lit ? GLOWS[1] : MAT.iron[1]); P.px(x + dx, y - bh + 2, lit ? GLOWS[0] : MAT.iron[2]); }
    P.hline(x - hw - 1, y - bh - 1, bw + 2, C.trim[4]);
    if (gold) {
      smallDome(P, x, y - bh - 2, hw, PAL.gold);
      P.vline(x, y - bh - hw - 5, 3, PAL.goldHi); P.hline(x - 1, y - bh - hw - 4, 3, PAL.gold); P.px(x, y - bh - hw - 6, WHITE);
    } else {
      for (let i = 0; i < hw; i++) { const ww = bw - 2 * i; P.hline(x - (ww >> 1), y - bh - 2 - i, ww, i & 1 ? T[2] : T[3]); P.px(x - (ww >> 1), y - bh - 2 - i, T[1]); P.px(x - (ww >> 1) + ww - 1, y - bh - 2 - i, T[0]); }
      P.vline(x, y - bh - 2 - hw - 2, 2, PAL.gold); P.px(x, y - bh - 2 - hw - 3, PAL.goldHi);
    }
  }
  /** a point on top of the roof for equipment: flat → on the top quad at (u, v) ∈ [0,1]²; hip/gable → along the ridge at u */
  function roofTop(g, u, v) {
    const rg = g.roofGeom;
    if (!rg) return { x: g.bcx, y: g.bcy - g.wallH - (g.bh >> 2) };
    if (rg.kind === 'flat') { const k = rg.k | 0; const W = [g.bcx - (rg.w >> 1), rg.top - (k >> 1)], S = [g.bcx + k, rg.top + (rg.h >> 1)], E = [g.bcx + (rg.w >> 1) - 1, rg.top + (k >> 1)], N = [g.bcx - k, rg.top - (rg.h >> 1) + 1]; const p = lerpPt(lerpPt(N, E, u), lerpPt(W, S, u), v); return { x: Math.round(p[0]), y: Math.round(p[1]) }; }
    const p = lerpPt(rg.a, rg.b, u); return { x: Math.round(p[0]), y: Math.round(p[1]) + 1 };
  }
  /** a point on the base quad at (u, v) ∈ [0,1]² (u along N→E / W→S, v across) */
  function roofTopFlatPt(g, u, v) { const q = quadCorners(g, 0); const p = lerpPt(lerpPt(q.N, q.E, u), lerpPt(q.W, q.S, u), v); return { x: Math.round(p[0]), y: Math.round(p[1]) }; }
  function drawHvac(P, x, y) {
    const S = MAT.steel;
    P.rect(x - 4, y - 5, 9, 5, S[2]); P.rect(x + 1, y - 5, 4, 5, S[1]); P.hline(x - 4, y - 6, 9, S[3]); P.vline(x + 4, y - 5, 5, S[0]); P.hline(x - 4, y, 9, S[0]);
    P.rect(x - 2, y - 4, 2, 2, S[0]); P.px(x - 2, y - 4, MAT.iron[2]); P.px(x + 2, y - 3, S[3]);
  }
  function drawVent(P, x, y) { const S = MAT.tin; P.rect(x, y - 4, 2, 4, S[2]); P.vline(x + 1, y - 4, 4, S[1]); P.hline(x - 1, y - 5, 4, S[3]); P.px(x + 2, y - 5, S[0]); }
  function drawStack(P, x, y) { const B = rampOf(XB.brick); P.rect(x, y - 10, 3, 10, B[2]); P.vline(x + 2, y - 10, 10, B[1]); P.hline(x - 1, y - 11, 5, B[0]); P.px(x + 1, y - 12, MAT.iron[1]); }
  function drawTank(P, x, y) {
    const S = MAT.steel, I = MAT.iron;
    P.rect(x - 4, y - 2, 2, 3, I[1]); P.rect(x + 2, y - 2, 2, 3, I[1]); P.hline(x - 5, y - 3, 10, I[2]);
    P.rect(x - 4, y - 10, 8, 7, S[2]); P.rect(x - 4, y - 10, 2, 7, S[3]); P.rect(x + 2, y - 10, 2, 7, S[1]); P.vline(x + 3, y - 10, 7, S[0]);
    P.hline(x - 4, y - 11, 8, S[3]); P.hline(x - 3, y - 12, 6, S[3]); P.hline(x - 1, y - 13, 2, S[4]);
    P.hline(x - 4, y - 7, 8, S[1]); P.hline(x - 4, y - 4, 8, S[0]);
  }
  function drawRoofGear(P, g) {
    const flat = g.roofGeom && g.roofGeom.kind === 'flat';
    if (hasFeature(g, 'hvac')) { const p = flat ? roofTop(g, 0.3, 0.35) : roofTop(g, 0.2); drawHvac(P, p.x, p.y); if (flat && g.fw + g.fh >= 7) { const q = roofTop(g, 0.7, 0.3); drawHvac(P, q.x, q.y); } }
    if (hasFeature(g, 'tank')) { const p = flat ? roofTop(g, 0.65, 0.65) : roofTop(g, 0.78); drawTank(P, p.x, p.y); }
    if (hasFeature(g, 'stack')) { const p = flat ? roofTop(g, 0.2, 0.75) : roofTop(g, 0.9); drawStack(P, p.x, p.y); }
    if (hasFeature(g, 'vents')) { for (const u of [0.35, 0.55]) { const p = flat ? roofTop(g, u, 0.6) : roofTop(g, u); drawVent(P, p.x + (flat ? 0 : 3), p.y - (flat ? 0 : 1)); } }
  }
  /** a downspout at the front corner and the gutter line under the eave */
  function drawGutters(P, g) {
    const x = g.bcx + (g.bk | 0) + 1, yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x, g.bk | 0);
    P.vline(x, yb - g.wallH + 2, g.wallH - 3, MAT.iron[2]); P.px(x, yb - 1, MAT.iron[1]); P.px(x + 1, yb - 1, MAT.iron[1]);
  }

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
  // ground points along the SE footprint edge (B → R) / the SW edge (B → L), pulled onto the apron by 45 % of the margin
  function frontPoint(g, t) { const m = (g.ipx || 0) * 0.45; return { x: Math.round(g.ax + t * g.fh * 32 - m), y: Math.round(g.ay + 16 - t * g.fh * 16 - 1 - g.lift - m / 2) }; }
  function leftPoint(g, t) { const m = (g.ipy || 0) * 0.45; return { x: Math.round(g.ax - t * g.fw * 32 + m), y: Math.round(g.ay + 16 - t * g.fw * 16 - 1 - g.lift - m / 2) }; }
  function sideCentre(g) { const k = g.bk | 0, x = g.bcx + k + (g.br >> 1); return { x: x, y: baseY(g.bcx, g.bcy, g.bw, g.bh, x, k) - (g.wallH >> 1) }; }
  function leftCentre(g) { const k = g.bk | 0, x = g.bcx + k - (g.bl >> 1); return { x: x, y: baseY(g.bcx, g.bcy, g.bw, g.bh, x, k) - (g.wallH >> 1) }; }
  /** the entrance face's centre and the other visible face's centre */
  function entranceCentre(g) { return g.frontLeft ? leftCentre(g) : sideCentre(g); }
  function otherCentre(g) { return g.frontLeft ? sideCentre(g) : leftCentre(g); }
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
  /** names drawn by hand below (so the generic pass skips them) */
  const SKIP_DECAL = { dumpster: 1, stilts: 1, scaffold: 1, tarp: 1, plywood: 1, burrow: 1, masts: 1, letters: 1, jumbotron: 1, bleachers: 1, goalposts: 1, cars: 1, pool: 1, reeds: 1, lookout: 1, nest: 1, arcade: 1, columns: 1, clock: 1, awning: 1, banner: 1, lights: 1, flag: 1, beacon: 1, sign: 1, tank: 1, vents: 1 };
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
  function drawArcade(P, g, faces, night) {
    if (g.wallH < 12) return;
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh, k = g.bk | 0, split = cx + k;
    const tall = faces && faces.tall ? 20 : 12, C = g.colors || faceColors(g.paint || {}), T = C.trim;
    for (const face of [0, 1]) {
      const x0 = face === 0 ? cx - (w >> 1) + 3 : split + 3, x1 = face === 0 ? split - 3 : cx + (w >> 1) - 3;
      const span = x1 - x0; const n = Math.max(1, Math.round(span / 14));
      const aw = span / n, left = face === 0;
      const pier = left ? T[3] : T[2], pierHi = left ? T[4] : T[3], dark = left ? C.RL[0] : C.RR[0], inner = left ? mix(C.RL[1], C.RL[0], 0.5) : C.RR[0];
      for (let kk = 0; kk < n; kk++) {
        const ax = Math.round(x0 + aw * kk + 3), bx = Math.round(x0 + aw * (kk + 1) - 3);
        if (bx - ax < 3) continue;
        for (let x = ax; x < bx; x++) { const yb = baseY(cx, cy, w, h, x, k); const edge = (x === ax || x === bx - 1); const hh = edge ? tall - 2 : tall; P.rect(x, yb - hh, 1, hh, edge ? dark : inner); if (!edge) P.px(x, yb - tall - 1, dark); }
        const mx = (ax + bx) >> 1, ym = baseY(cx, cy, w, h, mx, k);
        P.px(mx, ym - tall - 2, pierHi);   // keystone
        if (night) { P.hline(ax + 1, ym - tall + 1, bx - ax - 2, mix(GLOWS[0], inner, 0.5)); P.px(mx, ym - 2, mix(GLOWS[0], inner, 0.3)); }
        else P.hline(ax + 1, ym - 2, bx - ax - 2, mix(inner, pier, 0.25));   // the lit floor of the opening
        const px0 = Math.round(x0 + aw * kk) + 1; for (let x = px0; x < px0 + 2; x++) { const yb = baseY(cx, cy, w, h, x, k); P.rect(x, yb - tall - 2, 1, tall + 2, x === px0 ? pierHi : pier); }
      }
      for (let x = x0; x < x1; x++) { const yb = baseY(cx, cy, w, h, x, k); P.px(x, yb - tall - 3, pierHi); P.px(x, yb - tall - 2, pier); }
    }
  }
  /** columns on the entrance face: limestone shafts with capital and base, an entablature; returns {x0, x1, ch} for a pediment */
  function drawColumns(P, g, n) {
    if (g.wallH < 12) return null;
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh, ch = Math.min(g.wallH - 2, 22), k = g.bk | 0, T = (g.colors || faceColors(g.paint || {})).trim;
    n = n || 4;
    const left = !!g.frontLeft;
    const x0 = left ? cx - (w >> 1) + 4 : cx + k + 4, x1 = left ? cx + k - 4 : cx + (w >> 1) - 4;
    const shaft = left ? T[4] : T[3], shade2 = left ? T[3] : T[2], cap = left ? T[4] : T[3];
    const C = g.colors || faceColors(g.paint || {}), recess = left ? mix(C.left, C.leftLo, 0.5) : mix(C.right, C.rightLo, 0.55);
    // the portico: a recessed band behind the columns so the shafts stand off the wall (windows and the door are repainted over it by the caller order: the door comes before, so keep its columns clear)
    for (let x = x0 - 2; x < x1 + 2; x++) { const yb = baseY(cx, cy, w, h, x, k); if (Number.isFinite(g.doorX) && Math.abs(x - g.doorX) < 5) { P.rect(x, yb - ch, 1, ch - 8, recess); continue; } P.rect(x, yb - ch, 1, ch, recess); }
    for (let kk = 0; kk < n; kk++) {
      const x = Math.round(x0 + (x1 - x0) * (kk + 0.5) / n) - 1;
      const yb = baseY(cx, cy, w, h, x, k);
      P.rect(x, yb - ch, 3, ch, shaft); P.vline(x + 2, yb - ch, ch, shade2); P.vline(x, yb - ch, ch, WHITE);
      P.hline(x - 1, yb - ch - 1, 5, cap); P.hline(x - 1, yb - 1, 5, shade2); P.px(x + 3, yb - 1, T[1]);
    }
    for (let x = x0 - 2; x < x1 + 2; x++) { const yb = baseY(cx, cy, w, h, x, k); P.px(x, yb - ch - 2, shade2); P.px(x, yb - ch - 3, cap); P.px(x, yb - ch - 4, left ? T[3] : T[2]); }
    return { x0: x0 - 2, x1: x1 + 2, ch: ch + 4 };
  }
  /** a pediment over the column run on the entrance face; a gold seal (or the clock) in the tympanum */
  function drawPediment(P, g, cols, withClock) {
    if (!cols) return;
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh, k = g.bk | 0, T = g.colors.trim, left = !!g.frontLeft;
    const x0 = cols.x0, x1 = cols.x1, xm = (x0 + x1) >> 1, up = cols.ch, rise = Math.max(5, Math.round((x1 - x0) / 7));
    const p0 = [x0, baseY(cx, cy, w, h, x0, k) - up], p1 = [x1, baseY(cx, cy, w, h, x1, k) - up], pm = [xm, baseY(cx, cy, w, h, xm, k) - up - rise];
    fillPoly(P, [p0, p1, pm], left ? T[3] : T[2]);
    P.line(p0[0], p0[1], pm[0], pm[1], T[4]); P.line(pm[0], pm[1], p1[0], p1[1], T[1]); P.line(p0[0], p0[1], p1[0], p1[1], T[1]);
    P.px(pm[0], pm[1] - 1, PAL.gold);
    const sy = pm[1] + Math.max(2, (rise >> 1)) + 1;
    if (withClock) decalAt(P, 'clock', xm - 5, sy - 5, 0, g.seed);
    else { P.rect(xm - 1, sy - 1, 3, 3, PAL.gold); P.px(xm, sy, PAL.purple); P.px(xm - 2, sy, PAL.goldShadow); P.px(xm + 2, sy, PAL.goldShadow); }
  }
  /** a gallery at the first floor line: a slab, iron railing, slender iron posts to the ground (New Orleans style) */
  function drawGallery(P, g, both) {
    if (g.floors < 2) return;
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh, k = g.bk | 0, split = cx + k, T = g.colors.trim, I = MAT.iron;
    const faces = both ? [0, 1] : [g.frontLeft ? 0 : 1];
    for (const face of faces) {
      const x0 = face === 0 ? cx - (w >> 1) + 1 : split, x1 = face === 0 ? split : cx + (w >> 1) - 1;
      const left = face === 0;
      P.line(x0, baseY(cx, cy, w, h, x0, k) - FLOOR_PX, x1, baseY(cx, cy, w, h, x1, k) - FLOOR_PX, left ? T[3] : T[2]);
      P.line(x0, baseY(cx, cy, w, h, x0, k) - FLOOR_PX + 1, x1, baseY(cx, cy, w, h, x1, k) - FLOOR_PX + 1, left ? T[1] : T[0]);
      P.line(x0, baseY(cx, cy, w, h, x0, k) - FLOOR_PX - 3, x1, baseY(cx, cy, w, h, x1, k) - FLOOR_PX - 3, left ? I[3] : I[2]);
      for (let x = x0 + 1; x < x1; x += 3) { const yb = baseY(cx, cy, w, h, x, k); P.rect(x, yb - FLOOR_PX - 2, 1, 2, left ? I[2] : I[1]); }
      const cells = g.windowCells || [];
      const doorX = g.doorX;
      for (let x = x0 + 6; x < x1 - 3; x += 12) {
        let clash = false;
        for (let i = 0; i < cells.length; i++) { const c = cells[i]; if (c.face === face && c.r === 0 && x >= c.x - 2 && x <= c.x + c.w + 1) { clash = true; break; } }
        if (clash || (Number.isFinite(doorX) && Math.abs(x - doorX) < 6)) continue;
        const yb = baseY(cx, cy, w, h, x, k); P.rect(x, yb - FLOOR_PX + 2, 1, FLOOR_PX - 2, left ? I[2] : I[1]);
      }
    }
  }
  /** striped awnings in the accent colour over the ground-floor windows of the entrance face (and the door) */
  function drawAwnings(P, g) {
    const acc = rampOf((g.paint && g.paint.accent) || PAL.gold), cells = g.windowCells || [], face = g.frontLeft ? 0 : 1;
    const stripe = (x, y, wdt, phase) => { for (let i = 0; i < wdt; i++) P.px(x + i, y, ((i + phase) & 1) ? X.offWhite : acc[2]); };
    const one = (x, y, wdt) => { stripe(x - 1, y - 2, wdt + 2, 0); stripe(x - 2, y - 1, wdt + 4, 1); P.px(x - 2, y - 1, acc[1]); P.px(x + wdt + 1, y - 1, acc[1]); P.hline(x - 1, y, wdt + 2, acc[0]); };
    for (let i = 0; i < cells.length; i++) { const c = cells[i]; if (c.face !== face || c.r !== 0) continue; one(c.x, c.y - 1, c.w); }
    if (Number.isFinite(g.doorX)) { const dw = 6; one(g.doorX - (dw >> 1) - 1, g.doorY - 8, dw + 2); }
  }
  /** a sign board over the far face's centre (gold letters on purple) */
  function drawSign(P, g, text, night) {
    if (!text || g.wallH < 12) return;
    const c = otherCentre(g), wdt = text.length * 4 + 3, x = c.x - (wdt >> 1), yb = baseY(g.bcx, g.bcy, g.bw, g.bh, c.x, g.bk | 0);
    const y = yb - g.wallH + 3;
    P.rect(x, y, wdt, 7, PAL.purple); P.hline(x, y, wdt, PAL.purple2); P.vline(x + wdt - 1, y, 7, PAL.purpleShadow); P.hline(x, y + 6, wdt, PAL.purpleShadow);
    P.text(text, x + 2, y + 1, night ? PAL.goldHi : PAL.gold);
    if (night) { P.px(x - 1, y + 3, GLOWS[1]); P.px(x + wdt, y + 3, GLOWS[1]); }
  }
  /** the Roux banner pair flanking the entrance: purple field, gold border, a gold R over a tiger-orange stripe */
  function drawRouxBanners(P, g) {
    if (!Number.isFinite(g.doorX) || g.wallH < 24) return;
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh, k = g.bk | 0;
    for (const dx of [-11, 11]) {
      const x = g.doorX + dx - 2, yb = baseY(cx, cy, w, h, x + 2, k), y = yb - g.wallH + 5;
      P.rect(x, y, 5, 11, PAL.purple); P.vline(x, y, 11, PAL.gold2); P.vline(x + 4, y, 11, PAL.goldShadow); P.hline(x, y, 5, PAL.gold);
      P.hline(x, y + 11, 5, PAL.gold2); P.px(x, y + 12, PAL.gold); P.px(x + 4, y + 12, PAL.gold);
      P.text('R', x + 1, y + 2, PAL.gold); P.hline(x + 1, y + 8, 3, X.tigerOrange); P.px(x + 2, y + 9, X.tigerOrange);
    }
  }
  /** a flagpole on the apron corner with a purple and gold flag */
  function drawFlagpole(P, g, frame) {
    const p = g.frontLeft ? frontPoint(g, 0.82) : leftPoint(g, 0.82), T = MAT.trim;
    P.vline(p.x, p.y - 24, 24, T[3]); P.vline(p.x + 1, p.y - 24, 24, T[1]); P.px(p.x, p.y - 25, PAL.goldHi); P.hline(p.x - 1, p.y, 4, T[1]);
    const wave = frame & 1;
    P.rect(p.x + 2, p.y - 23, 6, 2, PAL.purple); P.rect(p.x + 2, p.y - 21, 6 - wave, 2, PAL.gold); P.px(p.x + 7, p.y - 23 + wave, PAL.purple2);
  }
  function drawClock(P, g, faceLeft) {
    const c = faceLeft ? leftCentre(g) : sideCentre(g);
    decalAt(P, 'clock', c.x - 5, c.y - (g.wallH >> 3) - 8, 0, g.seed);
  }
  function drawFlag(P, g, x, y, frame) { decalAt(P, 'flag', x, y, frame, g.seed); }
  function drawStringLights(P, g, frame) {
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh, k = g.bk | 0;
    for (let kk = 0; kk < 5; kk++) { const x = cx + k + 4 + Math.round((kk + 0.5) * (g.br - 8) / 5); const y = baseY(cx, cy, w, h, x, k) - g.wallH + 3 + (kk & 1); P.px(x, y, X.black); P.px(x, y + 1, (frame & 1) && (kk & 1) ? PAL.goldHi : PAL.gold); }
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
    P.px(cx, cy - r - 1, WHITE);
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
  // generic ground/roof/side spread) are drawn here by name, then the B3 features; everything
  // else goes through drawDecals. Shared by the generic box and every "house style" special.
  // ---------------------------------------------------------------------------
  function drawKnownDecals(ctx, P, g, row, variant, frame) {
    const paint = row.paint || {};
    const list = paint.decals || [];
    const night = !!(variant & SPR.NIGHT);
    const has = (n) => list.indexOf(n) >= 0;
    if (!g.colors) g.colors = faceColors(paint);
    if (has('arcade')) drawArcade(P, g, { wall: paint.wall || [PAL.creamStone, PAL.tanStucco], tall: row.id === 'union' }, night);
    let cols = null;
    if (has('columns')) cols = drawColumns(P, g, row.id === 'founders_hall' ? 6 : 4);
    if (hasFeature(g, 'pediment')) drawPediment(P, g, cols, has('clock'));
    else if (has('clock')) drawClock(P, g, false);
    if (hasFeature(g, 'gallery') || hasFeature(g, 'gallery:both')) drawGallery(P, g, hasFeature(g, 'gallery:both'));
    if (has('awning') || hasFeature(g, 'awnings')) drawAwnings(P, g);
    if (hasFeature(g, 'banner:roux')) drawRouxBanners(P, g);
    else if (has('banner')) { const sc = sideCentre(g); drawBannerSide(P, g, sc.x - 14, sc.y - 6); }
    if (hasFeature(g, 'dormers')) drawDormers(P, g, night, frame);
    if (hasFeature(g, 'cupola') || hasFeature(g, 'cupola:gold')) drawCupola(P, g, hasFeature(g, 'cupola:gold'), night);
    drawRoofGear(P, g);
    if (hasFeature(g, 'gutters')) drawGutters(P, g);
    const signText = featureArg(g, 'sign:');
    if (signText) drawSign(P, g, signText, night);
    if (has('flag')) { const rg = g.roofGeom; const p = rg && rg.b ? lerpPt(rg.a, rg.b, 0.9) : null; const rc = roofCentre(g); drawFlag(P, g, p ? Math.round(p[0]) : rc.x + (g.bw >> 3), p ? Math.round(p[1]) - 16 : rc.y - 18, frame); }
    if (hasFeature(g, 'flagpole')) drawFlagpole(P, g, frame);
    if (has('lights')) drawStringLights(P, g, frame);
    if (has('sign')) drawSignSide(P, g);
    if (has('beacon')) { const rc = roofCentre(g); drawBeaconTop(P, g, rc.x - 2, rc.y - 10, night || (frame & 1) === 1); }
    if (has('letters') && row.id !== 'greek_house') { const sc = sideCentre(g); decalAt(P, 'letters', sc.x - 16, sc.y - 4, frame, g.seed); }   // DECALS.letters spells "CAULDRON" (stadium only); greek_house spells its own letters below
    if (has('pool')) { const fp = frontPoint(g, 0.3); decalAt(P, 'pool', fp.x - 20, fp.y - 18, frame, g.seed); }
    if (has('dome')) { const rc = roofCentre(g); smallDome(P, rc.x, rc.y - (g.roofH >> 1) - 2, Math.max(6, Math.min(g.fw, g.fh) * 5 + 2), paint.accent || PAL.gold); }
    if (row.id === 'greek_house') { const sc = otherCentre(g); P.rect(sc.x - 8, sc.y - 4, 15, 7, PAL.purple); P.text('ΒΣΥ', sc.x - 6, sc.y - 3, PAL.gold); }
    if (row.id === 'res_tower') { const x = g.bcx + (g.bw >> 2); P.vline(x, g.bcy - g.wallH, g.wallH, PAL.gold); P.vline(x + 1, g.bcy - g.wallH, g.wallH, PAL.goldShadow); }
    if (row.id === 'health_center') { const sc = sideCentre(g); P.rect(sc.x - 1, sc.y - 7, 3, 7, PAL.danger); P.rect(sc.x - 3, sc.y - 5, 7, 3, PAL.danger); P.px(sc.x, sc.y - 4, X.white); }
    drawDecals(P, g, row, frame, SKIP_DECAL);   // everything else, at its data anchor
  }

  /** the one shared "house style" box: walls, windows, door, roof, every known decal and feature. Used by the
   * generic fallback and most of the 30-odd special rows (they just add a flourish on top). */
  function drawStandardBox(ctx, P, g, row, variant, frame) {
    const paint = row.paint || {};
    const night = !!(variant & SPR.NIGHT);
    g.colors = drawBox(P, g, paint, { seed: g.seed });
    drawWindows(P, g, row, { night: night, frame: frame });
    const wide = g.floors >= 2 || g.fw + g.fh >= 5;
    drawDoor(P, g, isPurple((paint.wall && paint.wall[1]) || '') ? PAL.gold : PAL.purple, wide, night);
    (ROOF[paint.roof] || ROOF.none)(P, g, paint.roofColor || PAL.terracotta);
    drawKnownDecals(ctx, P, g, row, variant, frame);
  }

  // ---------------------------------------------------------------------------
  // Variant overlays applied by paintBuilding around the base/special drawing.
  // ---------------------------------------------------------------------------
  /** RUIN: a rubble mound sized to the footprint, 3 standing stubs, a tarp corner (no box/roof/windows) */
  function drawRuinShape(P, g, seed) {
    const rubble = XB.rubble, k = g.bk | 0, R = rampOf(rubble);
    for (let x = g.bcx - (g.bw >> 1); x < g.bcx + (g.bw >> 1); x++) {
      const yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x, k);
      const hgt = 3 + (hash(seed, x) % 6);
      const n = hash(seed, x * 3) % 100;
      P.rect(x, yb - hgt, 1, hgt, n < 30 ? R[3] : n > 88 ? R[1] : R[2]);
      P.px(x, yb - hgt, n < 50 ? R[3] : R[2]);
    }
    for (let i = 0; i < 3; i++) {
      const x = g.bcx - (g.bw >> 2) + i * (g.bw >> 2);
      const yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x, k);
      const hh = 6 + (hash(seed, 900 + i) % 6);
      P.rect(x, yb - hh - 4, 2, hh, R[1]); P.px(x, yb - hh - 4, R[3]); P.vline(x + 1, yb - hh - 4, hh, R[0]);
    }
    P.rect(g.bcx + (g.bw >> 2) - 4, g.bcy - 10, 8, 5, X.tarp); P.hline(g.bcx + (g.bw >> 2) - 4, g.bcy - 10, 8, shade(X.tarp, 1.2)); P.px(g.bcx + (g.bw >> 2) - 1, g.bcy - 8, X.tarpCrease);
  }
  /** a plywood board over a window cell (two nails, a lighter plank line) */
  function boardCell(P, c, seed) {
    const W = rampOf(X.plywood);
    P.rect(c.x - 1, c.y - 1, c.w + 2, c.h + 2, W[2]); P.hline(c.x - 1, c.y - 1, c.w + 2, W[3]); P.vline(c.x + c.w, c.y - 1, c.h + 2, W[1]);
    P.hline(c.x - 1, c.y + (c.h >> 1), c.w + 2, (hash(seed, c.x) & 1) ? W[1] : W[3]);
    P.px(c.x, c.y, X.nail); P.px(c.x + c.w - 1, c.y + c.h, X.nail);
  }
  /** DAMAGED: whole sprite already toned by the caller's pen; torn roof tiles down to the sheathing, loose tiles, a tarp
   * lashed over one corner of the roof, boarded and cracked windows, a crack in the wall, debris on the apron */
  function applyDamaged(P, g) {
    const rg = g.roofGeom, seed = g.seed | 0, SH = MAT.sheathing;
    const pl = frontPlane(rg);
    if (pl) {
      const T = rg.R;
      // torn patches: three spots on the front plane, bare sheathing with a few missing-tile holes and loose tiles below
      for (let i = 0; i < 3; i++) {
        const t = 0.18 + 0.3 * i + (hash(seed, i) % 10) / 100, s = 0.25 + (hash(seed, 7 + i) % 45) / 100;
        const c = planePt(pl, t, s), x = Math.round(c[0]), y = Math.round(c[1]), rw = 5 + (hash(seed, 20 + i) % 6), rh = 2 + (hash(seed, 30 + i) % 3);
        for (let dx = 0; dx < rw; dx++) { const yy = y + (dx >> 1) * (pl.face === 0 ? 1 : -1) - (rw >> 2); P.rect(x + dx, yy, 1, rh, (hash(seed, dx * 3 + i) % 4) === 0 ? SH[1] : SH[2]); if ((hash(seed, dx + i * 9) % 5) === 0) P.px(x + dx, yy + rh, T[0]); }
        P.px(x + (hash(seed, 40 + i) % rw), y + rh + 2, T[3]); P.px(x + (hash(seed, 50 + i) % rw) + 1, y + rh + 4, T[1]);
      }
      // a tarp over one end of the plane, lashed with sandbags
      const t0 = (hash(seed, 99) & 1) ? 0.66 : 0.06, t1 = t0 + 0.28;
      const q = [planePt(pl, t0, 0.04), planePt(pl, t1, 0.04), planePt(pl, t1, 0.72), planePt(pl, t0, 0.72)];
      fillPoly(P, q, X.tarp);
      P.line(q[0][0], q[0][1], q[3][0], q[3][1], X.tarpCrease); P.line(q[1][0], q[1][1], q[2][0], q[2][1], shade(X.tarp, 1.25)); P.line(q[2][0], q[2][1], q[3][0], q[3][1], X.tarpCrease);
      const cm = planePt(pl, (t0 + t1) / 2, 0.5); P.line(cm[0] - 4, cm[1] + 2, cm[0] + 4, cm[1] - 2, X.tarpCrease);
      for (const tt of [t0 + 0.08, t1 - 0.08]) { const p = planePt(pl, tt, 0.06); P.rect(Math.round(p[0]) - 1, Math.round(p[1]) - 1, 3, 2, MAT.sandbag[2]); P.px(Math.round(p[0]) - 1, Math.round(p[1]) - 1, MAT.sandbag[3]); }
    } else if (rg && rg.kind === 'flat') {
      const p = roofTop(g, 0.4, 0.4); P.rect(p.x - 6, p.y - 2, 12, 4, SH[2]); P.hline(p.x - 5, p.y, 6, SH[1]); P.rect(p.x - 2, p.y - 1, 3, 2, rg.R[0]);
      const t = roofTop(g, 0.75, 0.7); P.rect(t.x - 9, t.y - 4, 16, 6, X.tarp); P.hline(t.x - 9, t.y - 4, 16, shade(X.tarp, 1.25)); P.line(t.x - 8, t.y + 1, t.x + 6, t.y - 3, X.tarpCrease);
    } else if (g.wallH > 0) { const rc = roofCentre(g); decalAt(P, 'tarp', g.bcx - 12, rc.y - 6, 0, seed); }
    const cells = g.windowCells || [];
    const nb = Math.min(cells.length, Math.max(1, Math.round(cells.length * 0.3)));
    const at = (i) => cells[(((i % cells.length) + cells.length) % cells.length)];
    for (let i = 0; i < nb; i++) boardCell(P, at(seed + i * 7), seed + i);
    const nc = Math.min(2, cells.length);
    for (let i = 0; i < nc; i++) {
      const c = at(seed + 3 + i * 5);
      P.rect(c.x, c.y, c.w, c.h, X.black);
      P.line(c.x, c.y, c.x + c.w - 1, c.y + c.h - 1, shade(X.black, 1.8));
      P.px(c.x + c.w - 1, c.y, mix(X.black, X.white, 0.3));
    }
    if (g.wallH >= 14 && g.colors) {   // a crack from the base of the SE face
      const x = g.bcx + (g.bk | 0) + (g.br >> 1) - 7, yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x, g.bk | 0), c = g.colors.RR[0];
      P.line(x, yb - 1, x + 2, yb - 5, c); P.line(x + 2, yb - 5, x + 1, yb - 8, c); P.line(x + 1, yb - 8, x + 3, yb - 11, c);
    }
    for (let i = 0; i < 4; i++) { const p = frontPoint(g, 0.15 + 0.2 * i); P.rect(p.x - (hash(seed, i) % 6), p.y - 1 + (i & 1), 3, 1, i & 1 ? (rg ? rg.R[2] : SH[2]) : SH[1]); }
  }
  /** BOARDED: plywood over every recorded window cell */
  function applyBoarded(P, g) {
    const cells = g.windowCells || [];
    for (const c of cells) boardCell(P, c, g.seed + c.x * 3 + c.y);
  }
  /** FLOODED: a waterline stain up the walls (mud, a mineral line on top), sandbags stacked along the base, a wet apron */
  function applyFlooded(P, g) {
    if (g.wallH <= 0 || !g.colors) return;
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh, k = g.bk | 0, split = cx + k, ST = MAT.stain, SB = MAT.sandbag, seed = g.seed | 0;
    const band = Math.min(6, g.wallH - 4);
    for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) {
      const yb = baseY(cx, cy, w, h, x, k), left = x < split;
      for (let i = 1; i <= band; i++) { const d = i / band; if ((hash(seed, x * 13 + i) % 100) < 95 - d * 70) P.px(x, yb - i, i < 3 ? ST[left ? 1 : 0] : mix(ST[2], left ? g.colors.left : g.colors.right, 0.45)); }
      if ((hash(seed, x * 7) % 3) !== 0) P.px(x, yb - band - 1, MAT.sandbag[3]);   // the mineral line
    }
    // sandbags: two courses along both faces, skipping the door
    for (let x = cx - (w >> 1) + 2; x < cx + (w >> 1) - 3; x += 4) {
      if (Number.isFinite(g.doorX) && Math.abs(x + 1 - g.doorX) < 6) continue;
      const yb = baseY(cx, cy, w, h, x, k), left = x < split;
      P.rect(x, yb, 3, 2, left ? SB[1] : SB[0]); P.hline(x, yb, 2, left ? SB[2] : SB[1]); P.px(x, yb, left ? SB[3] : SB[2]);
      if ((hash(seed, x) % 4) === 0) { P.rect(x + 1, yb - 2, 3, 2, left ? SB[1] : SB[0]); P.px(x + 1, yb - 2, left ? SB[3] : SB[2]); }
    }
    // the apron is wet: a cool dither over the lower half of the footprint quad
    const q = quadOf(g), wet = mix(g.apron ? g.apron.base : XB.apron, PAL.waterNight, 0.5);
    for (let y = Math.max(q.L[1], q.R[1]); y < q.B[1]; y += 1) { const sp = quadSpan(q, y); if (!sp) continue; for (let x = sp[0] + (y & 1); x < sp[1]; x += 2) if (noiseAt(x, y, seed) > 0.5) P.px(x, y, wet); }
  }
  /** steel scaffolding over a face: standards every 8 px, ledgers every 7 px, planks and diagonal braces */
  function scaffoldFace(P, g, face, hgt) {
    const cx = g.bcx, cy = g.bcy, w = g.bw, h = g.bh, k = g.bk | 0, split = cx + k, S = MAT.steel, W = rampOf(X.plywood);
    const x0 = face === 0 ? cx - (w >> 1) - 1 : split + 1, x1 = face === 0 ? split - 1 : cx + (w >> 1) + 1;
    const top = hgt + 5;
    for (let up = 7; up < top; up += 7) { P.line(x0, baseY(cx, cy, w, h, x0, k) - up, x1, baseY(cx, cy, w, h, x1, k) - up, S[1]); P.line(x0, baseY(cx, cy, w, h, x0, k) - up - 1, x1, baseY(cx, cy, w, h, x1, k) - up - 1, W[2]); }
    for (let x = x0; x <= x1; x += 8) { const yb = baseY(cx, cy, w, h, x, k); P.rect(x, yb - top, 1, top + 1, S[2]); P.px(x, yb - top, S[3]); if (x + 8 <= x1 && ((x - x0) / 8 & 1)) P.line(x, yb - 7, x + 7, yb - 14, S[1]); }
  }
  /** a tower crane behind the box for rows ≥ 3×3 (drawn before the walls so the mast is occluded by them) */
  function drawCrane(P, g, hgt) {
    const q = quadCorners(g, 0), N = q.N, CR = MAT.crane, I = MAT.iron;
    const x = Math.round(N[0]) + 4, base = Math.round(N[1]) + 6, top = base - hgt - 34;
    P.rect(x, top, 3, hgt + 34, CR[2]); P.vline(x + 2, top, hgt + 34, CR[1]); for (let y = top; y < base; y += 4) P.px(x + 1, y, CR[0]);
    P.rect(x - 2, top - 1, 7, 3, CR[3]); P.rect(x + 3, top + 2, 3, 3, I[2]); P.px(x + 4, top + 3, MAT.glass[2]);   // slewing unit and cab
    P.hline(x + 1, top - 3, 44, CR[2]); P.hline(x + 1, top - 2, 44, CR[1]); for (let dx = 4; dx < 44; dx += 4) P.px(x + 1 + dx, top - 4, CR[3]);   // jib
    P.hline(x - 12, top - 3, 13, CR[2]); P.rect(x - 12, top - 2, 5, 2, I[1]);   // counter-jib and ballast
    P.line(x + 1, top - 10, x + 36, top - 4, I[2]); P.line(x + 1, top - 10, x - 10, top - 4, I[2]); P.vline(x + 1, top - 11, 2, CR[3]);   // pendants
    const hx = x + 30, hy = top - 2 + 8 + (hgt >> 2); P.vline(hx, top - 1, hy - top, I[2]); P.rect(hx - 1, hy, 3, 2, I[1]); P.px(hx, hy + 2, CR[3]);   // hoist and hook block
  }
  /** materials on the apron: a pallet of bricks and a stack of lumber */
  function drawPallets(P, g) {
    const B = rampOf(XB.brick), W = MAT.wood;
    const p = frontPoint(g, 0.6); P.rect(p.x - 4, p.y - 4, 8, 4, B[2]); P.hline(p.x - 4, p.y - 4, 8, B[3]); P.vline(p.x + 3, p.y - 4, 4, B[1]); P.hline(p.x - 5, p.y, 10, W[1]); P.px(p.x - 1, p.y - 2, B[1]); P.px(p.x + 1, p.y - 3, B[1]);
    const l = leftPoint(g, 0.6); P.rect(l.x - 4, l.y - 3, 9, 3, W[2]); P.hline(l.x - 4, l.y - 3, 9, W[3]); P.hline(l.x - 4, l.y - 1, 9, W[1]); P.vline(l.x + 4, l.y - 3, 3, W[0]);
  }
  /** SCAFFOLD: 3 build-rise frames — slab, footings and pallets / half-height block walls in scaffolding (+ a crane on rows ≥ 3×3) / full height with window openings, roof framing and the crane */
  function drawScaffoldStage(P, g, row, frame) {
    const stage = ((frame % 3) + 3) % 3;
    if (g.special === 'stadium') { stadiumSite(P, g, stage); return; }   // a graded field behind construction fencing, not a slab
    const CON = MAT.concrete, k = g.bk | 0;
    if (stage === 0) {
      fillQuad(P, g.bcx, g.bcy, g.bw, g.bh, k, CON[2], CON[0]);
      fillQuad(P, g.bcx, g.bcy - 1, g.bw - 8, g.bh - 4, k, CON[3]);
      quadSpeckle(P, g.bcx, g.bcy - 1, g.bw - 8, g.bh - 4, k, CON[1], g.seed, 0.78);
      for (let x = g.bcx - (g.bw >> 1) + 6; x < g.bcx + (g.bw >> 1) - 4; x += 12) { const yt = topY(g.bcx, g.bcy, g.bw, g.bh, x, k) + 3; P.rect(x, yt, 2, 2, MAT.iron[1]); P.px(x, yt - 1, MAT.crane[2]); }   // rebar dowels
      drawPallets(P, g);
      return;
    }
    if (g.wallH <= 0) {   // wall-less rows (lawns, lots, ponds, pads): the graded slab stays, fencing goes up, then the sand piles and stakes
      fillQuad(P, g.bcx, g.bcy, g.bw, g.bh, k, CON[2], CON[0]);
      fillQuad(P, g.bcx, g.bcy - 1, g.bw - 8, g.bh - 4, k, stage === 2 ? MAT.wood[2] : CON[3]);
      for (let x = g.bcx - (g.bw >> 1); x < g.bcx + (g.bw >> 1); x += 8) { const yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x, k); P.rect(x, yb - 7, 1, 8, MAT.steel[2]); P.px(x, yb - 7, MAT.steel[3]); }
      faceLine(P, g.bcx, g.bcy, g.bw, g.bh, k, 5, MAT.steel[1], MAT.steel[0]); faceLine(P, g.bcx, g.bcy, g.bw, g.bh, k, 2, MAT.steel[1], MAT.steel[0]);
      if (stage === 2) { for (let i = 0; i < 3; i++) { const p = roofTopFlatPt(g, 0.25 + 0.25 * i, 0.3 + 0.2 * (i & 1)); P.ellipse(p.x, p.y, 4, 2, MAT.sandbag[2]); P.ellipse(p.x, p.y - 1, 2, 1, MAT.sandbag[3]); } }
      drawPallets(P, g);
      return;
    }
    const full = stage === 2;
    const hgt = full ? (g.wallH || 24) : Math.max(6, Math.round(g.wallH / 2) || 6);
    const big = g.fw >= 3 && g.fh >= 3;
    if (big) drawCrane(P, g, hgt);
    const BL = MAT.block;
    const C = { left: BL[2], right: BL[1], leftHi: BL[3], rightHi: BL[2], leftLo: BL[1], rightLo: BL[0], leftRaw: BL[2], rightRaw: BL[2], out: BL[0], outR: BL[0], RL: BL, RR: BL, trim: BL, material: 'stone' };
    g.colors = C;
    if (!full) {   // open to the sky: the slab floor and the inner faces of the two back walls, then the front walls over them
      const q0 = quadCorners(g, 0), qh = quadCorners(g, hgt);
      fillQuad(P, g.bcx, g.bcy, g.bw, g.bh, k, CON[3]);
      fillPoly(P, [q0.W, q0.N, qh.N, qh.W], BL[1]); fillPoly(P, [q0.N, q0.E, qh.E, qh.N], BL[2]);
      P.line(qh.W[0], qh.W[1], qh.N[0], qh.N[1], BL[3]); P.line(qh.N[0], qh.N[1], qh.E[0], qh.E[1], BL[3]); P.line(q0.W[0], q0.W[1], q0.N[0], q0.N[1], BL[0]); P.line(q0.N[0], q0.N[1], q0.E[0], q0.E[1], BL[0]);
    }
    drawBox(P, g, {}, { hgt: hgt, noTop: !full, colors: C, raw: true, material: 'stone', topColor: MAT.wood[2] });
    if (full) {
      drawWindows(P, g, row, { opening: true });
      // roof framing: rafters over the top in raw lumber
      const q = quadCorners(g, hgt), W = MAT.wood;
      const along = g.fw >= g.fh, m0 = along ? midPt(q.W, q.N) : midPt(q.N, q.E), m1 = along ? midPt(q.S, q.E) : midPt(q.W, q.S);
      const a = lerpPt(m0, m1, 0.3), b = lerpPt(m0, m1, 0.7); a[1] -= Math.max(2, g.roofH >> 1); b[1] -= Math.max(2, g.roofH >> 1);
      if (g.roofH > 0) { P.line(a[0], a[1], b[0], b[1], W[3]); for (const c of [q.W, q.S, q.E, q.N]) { const r = (c === q.W || c === q.N) === along ? a : b; P.line(c[0], c[1], r[0], r[1], W[1]); } for (let i = 1; i < 4; i++) { const t = i / 4; const e0 = along ? lerpPt(q.W, q.S, t) : lerpPt(q.S, q.E, t), r0 = along ? lerpPt(a, b, t) : lerpPt(b, a, t); P.line(e0[0], e0[1], r0[0], r0[1], W[2]); } }
    } else {
      for (let x = g.bcx - (g.bw >> 1) + 3; x < g.bcx + (g.bw >> 1) - 3; x += 7) { const y = baseY(g.bcx, g.bcy, g.bw, g.bh, x, k) - hgt; P.rect(x, y - 3, 1, 3, MAT.iron[2]); }   // rebar stubs
    }
    scaffoldFace(P, g, 0, hgt); scaffoldFace(P, g, 1, hgt);
    drawPallets(P, g);
  }

  // ---------------------------------------------------------------------------
  // Stadium helpers: the footprint quad in iso (X along the long axis, Y across, in tiles; `up` px
  // above the ground), filled stands, the field, the construction site. Shared by SPECIAL.stadium
  // and the stadium's SCAFFOLD stages.
  // ---------------------------------------------------------------------------
  const TURF = rampOf('#3F8F3B'), CONC = rampOf('#B0ADA6'), PU = rampOf(PAL.purple);
  const STAD = Object.freeze({ turf: TURF[2], turfDark: mix(TURF[2], TURF[1], 0.45), dirt: rampOf('#8B6B4A')[2], dirtDark: rampOf('#8B6B4A')[1], sand: rampOf('#C2B280')[2], riser: PU[1] });
  /** canvas px of footprint point (X, Y) lifted `up` px; (0, 0) is the ground quad's top corner, (fw, fh) its bottom */
  function fpPt(g, X, Y, up) { return [Math.round(g.ax + (g.fh - g.fw + X - Y) * 32), Math.round(g.ay + 16 + (X + Y - g.fw - g.fh) * 16 - (up || 0) - g.lift)]; }
  function fpPoly(P, g, pts, color) { fillPoly(P, pts.map(function (p) { return fpPt(g, p[0], p[1], p[2]); }), color); }
  function fpLine(P, g, a, b, color) { const p = fpPt(g, a[0], a[1], a[2]), q = fpPt(g, b[0], b[1], b[2]); P.line(p[0], p[1], q[0], q[1], color); }
  /**
   * A tiered stand over the footprint rect r = {x0, x1, y0, y1}; `inner` names the field-side edge
   * ('y1' | 'y0' | 'x1' | 'x0'); lifts hIn at the field edge, hOut at the back. When the field edge faces
   * the camera (inner is a max edge) the treads and their risers show; otherwise the back wall and the
   * rim do. Treads alternate purple/purple2 with gold trim; the +X / +Y end faces are always drawn.
   */
  function stadiumStand(P, g, r, inner, hIn, hOut, steps) {
    const alongX = inner[0] === 'y', faces = inner[1] === '1';
    const span = alongX ? r.y1 - r.y0 : r.x1 - r.x0, d = span / steps, dh = (hOut - hIn) / steps;
    const innerC = faces ? (alongX ? r.y1 : r.x1) : (alongX ? r.y0 : r.x0), outerC = faces ? (alongX ? r.y0 : r.x0) : (alongX ? r.y1 : r.x1);
    const dir = faces ? -1 : 1;
    const quad = function (a, b, la, lb) { return alongX ? [[r.x0, a, la], [r.x1, a, la], [r.x1, b, lb], [r.x0, b, lb]] : [[a, r.y0, la], [a, r.y1, la], [b, r.y1, lb], [b, r.y0, lb]]; };
    const liftAt = function (c) { return hIn + (hOut - hIn) * Math.abs(c - innerC) / span; };
    // end faces toward the camera (+X face for stands along X, +Y face for stands along Y)
    // end faces: the +X face looks SE (shadow), the +Y face looks SW (lit) — concrete below the seat line
    if (alongX) fpPoly(P, g, [[r.x1, r.y0, liftAt(r.y0)], [r.x1, r.y1, liftAt(r.y1)], [r.x1, r.y1, 0], [r.x1, r.y0, 0]], CONC[1]);
    else fpPoly(P, g, [[r.x0, r.y1, liftAt(r.x0)], [r.x1, r.y1, liftAt(r.x1)], [r.x1, r.y1, 0], [r.x0, r.y1, 0]], CONC[2]);
    if (!faces) {
      // seen from behind: treads inner → outer (the higher, nearer ones overdraw), then the back wall + rim
      for (let j = 0; j < steps; j++) { const a = innerC + dir * j * d, b = innerC + dir * (j + 1) * d, l = hIn + j * dh; fpPoly(P, g, quad(a, b, l, l), (j & 1) ? PAL.purple2 : PAL.purple); }
      fpPoly(P, g, quad(outerC, outerC, 0, hOut), alongX ? CONC[2] : CONC[1]);   // the back wall: concrete, lit when it looks SW (+Y), shadow when it looks SE (+X)
      if (alongX) fpLine(P, g, [r.x0, outerC, hOut * 0.5], [r.x1, outerC, hOut * 0.5], alongX ? CONC[3] : CONC[2]); else fpLine(P, g, [outerC, r.y0, hOut * 0.5], [outerC, r.y1, hOut * 0.5], CONC[2]);   // the concourse band
      // concourse slits on the wall
      const n = Math.max(2, Math.round(span * 0 + (alongX ? (r.x1 - r.x0) : (r.y1 - r.y0)) * 2));
      for (let k = 1; k < n; k++) { const t = k / n; const p = alongX ? fpPt(g, r.x0 + (r.x1 - r.x0) * t, outerC, hOut * 0.45) : fpPt(g, outerC, r.y0 + (r.y1 - r.y0) * t, hOut * 0.45); P.rect(p[0], p[1], 1, 3, CONC[0]); }
      if (alongX) fpLine(P, g, [r.x0, outerC, hOut], [r.x1, outerC, hOut], PAL.gold); else fpLine(P, g, [outerC, r.y0, hOut], [outerC, r.y1, hOut], PAL.gold);
    } else {
      // facing the camera: outer (high) → inner (low), each tread with its riser toward the field
      for (let j = steps - 1; j >= 0; j--) {
        const a = innerC + dir * j * d, b = innerC + dir * (j + 1) * d, l = hIn + j * dh;
        fpPoly(P, g, quad(a, b, l, l), (j & 1) ? PAL.purple2 : PAL.purple);
        fpPoly(P, g, quad(a, a, l, Math.max(0, l - dh)), STAD.riser);
        if (j === steps - 1) { if (alongX) fpLine(P, g, [r.x0, b, l], [r.x1, b, l], PAL.gold); else fpLine(P, g, [b, r.y0, l], [b, r.y1, l], PAL.gold); }
      }
      if (alongX) fpLine(P, g, [r.x0, innerC, hIn], [r.x1, innerC, hIn], PAL.goldShadow); else fpLine(P, g, [innerC, r.y0, hIn], [innerC, r.y1, hIn], PAL.goldShadow);
    }
  }
  /** the playing field: turf stripes, gold end zones, white yard lines, the BSU midfield mark (bare = turf only) */
  function stadiumField(P, g, f, bare) {
    const n = 8, ez = (f.x1 - f.x0) * 0.1;
    for (let k = 0; k < n; k++) { const a = f.x0 + (f.x1 - f.x0) * k / n, b = f.x0 + (f.x1 - f.x0) * (k + 1) / n; fpPoly(P, g, [[a, f.y0, 0], [b, f.y0, 0], [b, f.y1, 0], [a, f.y1, 0]], (k & 1) ? STAD.turfDark : STAD.turf); }
    if (bare) return;
    fpPoly(P, g, [[f.x0, f.y0, 0], [f.x0 + ez, f.y0, 0], [f.x0 + ez, f.y1, 0], [f.x0, f.y1, 0]], PAL.gold);
    fpPoly(P, g, [[f.x1 - ez, f.y0, 0], [f.x1, f.y0, 0], [f.x1, f.y1, 0], [f.x1 - ez, f.y1, 0]], PAL.gold);
    for (let k = 0; k <= 10; k++) { const x = f.x0 + ez + (f.x1 - f.x0 - 2 * ez) * k / 10; fpLine(P, g, [x, f.y0, 0], [x, f.y1, 0], X.white); }
    fpLine(P, g, [f.x0, f.y0, 0], [f.x1, f.y0, 0], X.white); fpLine(P, g, [f.x0, f.y1, 0], [f.x1, f.y1, 0], X.white);
    const m = fpPt(g, (f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, 0); P.ellipse(m[0], m[1], 8, 4, PAL.purple); P.text('BSU', m[0] - 5, m[1] - 2, PAL.gold);
  }
  /** tier II scoreboard: 28×12, BSU · score · a gold clock bar */
  function stadiumScoreboard(P, x, y, night, frame) {
    P.rect(x, y, 28, 12, X.black); P.hline(x, y, 28, PAL.gold); P.hline(x, y + 11, 28, PAL.goldShadow); P.vline(x, y, 12, PAL.gold); P.vline(x + 27, y, 12, PAL.goldShadow);
    P.text('BSU', x + 2, y + 2, PAL.gold); P.text('0-0', x + 15, y + 2, night ? X.white : X.offWhite);
    P.hline(x + 2, y + 8, 24, shade(PAL.goldShadow, 0.7)); P.hline(x + 2, y + 8, 6 + ((frame | 0) % 4) * 4, night ? PAL.goldHi : PAL.gold);
  }
  /** the construction site (SCAFFOLD frames 0–2 and tier 0): graded dirt, fencing, then footings and turf, then the steel frames */
  function stadiumSite(P, g, stage) {
    const fw = g.fw, fh = g.fh, seed = g.seed | 0;
    const inset = 0.12;
    fpPoly(P, g, [[inset, inset, 0], [fw - inset, inset, 0], [fw - inset, fh - inset, 0], [inset, fh - inset, 0]], STAD.dirt);
    for (let k = 1; k < fh * 2; k++) fpLine(P, g, [inset + 0.2, k / 2, 0], [fw - inset - 0.2, k / 2, 0], STAD.dirtDark);   // dozer tracks
    for (let k = 0; k < 6; k++) { const p = fpPt(g, 0.5 + (hash(seed, 11 + k) % 100) / 100 * (fw - 1), 0.5 + (hash(seed, 31 + k) % 100) / 100 * (fh - 1), 0); P.ellipse(p[0], p[1] - 1, 4, 2, STAD.sand); P.ellipse(p[0], p[1] - 2, 2, 1, shade(STAD.sand, 1.15)); }
    const field = { x0: 1.0, x1: fw - 1.0, y0: 1.0, y1: fh - 1.0 };
    if (stage >= 1) {
      stadiumField(P, g, field, stage < 2);
      // footings for the stands along both long sides
      for (let k = 0; k < 8; k++) { const X = 1.1 + (fw - 2.2) * k / 7; for (const Y of [0.5, fh - 0.5]) { const p = fpPt(g, X, Y, 0); P.rect(p[0] - 1, p[1] - 3, 3, 3, X.concrete); P.hline(p[0] - 1, p[1] - 1, 3, shade(X.concrete, 0.7)); } }
    }
    if (stage >= 2) {
      // steel bleacher frames (the stand profiles) and two unlit masts
      for (const Y of [0.5, fh - 0.5]) { fpLine(P, g, [1.0, Y, 12], [fw - 1.0, Y, 12], X.steel); fpLine(P, g, [1.0, Y, 6], [fw - 1.0, Y, 6], X.steelDark); for (let k = 0; k < 8; k++) { const X = 1.0 + (fw - 2) * k / 7; fpLine(P, g, [X, Y, 0], [X, Y, 12], X.steelDark); } }
      for (const X of [1.0, fw - 1.0]) { const p = fpPt(g, X, 0.1, 0); decalAt(P, 'masts', p[0] - 3, p[1] - 40, 0, seed + (X | 0)); }
    }
    // construction fencing on the footprint boundary: posts every half tile, two rails, the orange gate
    const fence = function (a, b, front) {
      const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2);
      for (let k = 0; k <= n; k++) { const t = k / n; const p = fpPt(g, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0); P.rect(p[0], p[1] - 7, 1, 7, X.steelDark); P.px(p[0], p[1] - 7, X.chain); }
      fpLine(P, g, [a[0], a[1], 6], [b[0], b[1], 6], X.chain); fpLine(P, g, [a[0], a[1], 3], [b[0], b[1], 3], shade(X.chain, 0.75));
      if (front) { const m = fpPt(g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0); P.rect(m[0] - 3, m[1] - 6, 6, 4, X.tigerOrange); P.hline(m[0] - 3, m[1] - 5, 6, X.white); }
    };
    const e = 0.05;
    fence([e, e], [fw - e, e], false); fence([e, e], [e, fh - e], false);
    fence([fw - e, e], [fw - e, fh - e], false); fence([e, fh - e], [fw - e, fh - e], true);
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
      const ST = MAT.steel;
      for (const dx of [-10, 10]) { P.vline(cx + dx + sway, legTop, 28, ST[1]); P.vline(cx + dx + sway + (dx < 0 ? -1 : 1), legTop, 28, ST[0]); }
      P.vline(cx - 2 + sway, legTop, 28, ST[2]); P.vline(cx + 2 + sway, legTop, 28, ST[1]);
      P.line(cx - 10 + sway, legTop + 6, cx + 10 + sway, legTop + 20, ST[1]); P.line(cx + 10 + sway, legTop + 6, cx - 10 + sway, legTop + 20, ST[1]); P.hline(cx - 10 + sway, legTop + 13, 21, ST[2]);   // cross-bracing
      P.rect(cx - (tankW >> 1) + sway, tankTop, tankW, tankH, PU[2]); P.rect(cx - (tankW >> 1) + sway, tankTop, 5, tankH, PU[3]); P.rect(cx + (tankW >> 1) - 6 + sway, tankTop, 6, tankH, PU[1]);
      P.vline(cx - (tankW >> 1) + sway, tankTop, tankH, PAL.purpleHi); P.vline(cx + (tankW >> 1) - 1 + sway, tankTop, tankH, PAL.purpleShadow); P.hline(cx - (tankW >> 1) + sway, tankTop + tankH - 1, tankW, PU[0]);
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
      void ctx; void row; void variant; void frame;
      const fw = g.fw, fh = g.fh;
      // turf in half-tile stripes across the true footprint quad, a white boundary, goalposts at both ends
      for (let s = 0; s < fw * 2; s++) fpPoly(P, g, [[s / 2, 0], [(s + 1) / 2, 0], [(s + 1) / 2, fh], [s / 2, fh]], (s & 1) ? mix(TURF[2], TURF[1], 0.4) : TURF[2]);
      const m = 0.3;
      fpLine(P, g, [m, m], [fw - m, m], X.white); fpLine(P, g, [m, fh - m], [fw - m, fh - m], X.white); fpLine(P, g, [m, m], [m, fh - m], X.white); fpLine(P, g, [fw - m, m], [fw - m, fh - m], X.white);
      fpLine(P, g, [fw / 2, m], [fw / 2, fh - m], shade(X.white, 0.9));
      const n = fpPt(g, fw - 0.6, fh / 2, 0), w2 = fpPt(g, 0.6, fh / 2, 0);
      decalAt(P, 'goalposts', w2[0] - 4, w2[1] - 20, 0, g.seed + 1);
      decalAt(P, 'goalposts', n[0] - 4, n[1] - 20, 0, g.seed);
      const b1 = fpPt(g, fw * 0.4, fh * 0.55, 0), b2 = fpPt(g, fw * 0.6, fh * 0.45, 0);
      P.rect(b1[0] - 2, b1[1] - 3, 4, 3, PAL.purple); P.rect(b2[0] - 2, b2[1] - 3, 4, 3, PAL.purple);
      if (g.tier >= 1) {
        const bp = fpPt(g, fw / 2, 0.45, 0);
        decalAt(P, 'bleachers', bp[0] - 24, bp[1] - 14, 0, g.seed);
        P.text('BAYOU FIELD', bp[0] - 28, bp[1] - 24, PAL.gold);
      }
    },
    stadium(ctx, P, g, row, variant, frame) {
      // Drawn on the true iso footprint quad (fpPt) back to front: tier I = two long-side bleachers
      // and four corner masts; II = the full bowl, six masts, a scoreboard and CAULDRON on the near
      // wall; III = an upper deck, the jumbotron and the gold crown. Tier 0 is the graded site.
      void ctx; void row;
      const night = !!(variant & SPR.NIGHT);
      const fw = g.fw, fh = g.fh;
      if (g.tier <= 0) { stadiumSite(P, g, 2); return; }
      const field = { x0: 1.0, x1: fw - 1.0, y0: 1.0, y1: fh - 1.0 };
      const lit = night ? 1 : 0;
      const mast = function (X, Y, up) { const p = fpPt(g, X, Y, up); decalAt(P, 'masts', p[0] - 3, p[1] - 40, lit, g.seed + ((X * 7 + Y * 3) | 0)); if (night) { P.rect(p[0] - 1, p[1] - 42, 6, 2, WHITE); P.px(p[0] - 3, p[1] - 41, PAL.goldHi); P.px(p[0] + 6, p[1] - 41, PAL.goldHi); P.px(p[0] + 2, p[1] - 44, PAL.goldHi); P.px(p[0] + 1, p[1] - 45, GLOWS[1]); P.hline(p[0], p[1] - 39, 4, GLOWS[1]); P.px(p[0] + 2, p[1] - 38, GLOWS[0]); } };   // B3: white-hot heads with glare at night
      if (g.tier === 1) {
        const hIn = 3, hOut = 14, steps = 4;
        stadiumField(P, g, field, false);
        // far bleachers (field edge faces the camera: treads + risers), then the near ones (back wall + rim)
        stadiumStand(P, g, { x0: 1.0, x1: fw - 1.0, y0: 0.1, y1: 1.0 }, 'y1', hIn, hOut, steps);
        mast(1.0, 0.1, hOut); mast(fw - 1.0, 0.1, hOut);
        stadiumStand(P, g, { x0: 1.0, x1: fw - 1.0, y0: fh - 1.0, y1: fh - 0.1 }, 'y0', hIn, hOut, steps);
        mast(1.0, fh - 0.1, hOut); mast(fw - 1.0, fh - 0.1, hOut);
        // ticket booth at the near-left corner
        const tb = fpPt(g, 0.5, fh - 0.5, 0); P.rect(tb[0] - 4, tb[1] - 9, 8, 7, PAL.purple); P.rect(tb[0] - 5, tb[1] - 11, 10, 2, PAL.gold); P.rect(tb[0] - 1, tb[1] - 6, 2, 4, PAL.goldHi);
        return;
      }
      const upper = g.tier === 3;
      const hIn = 3, hOut = upper ? 18 : 22, steps = 5;
      const hTop = upper ? 36 : hOut;
      stadiumField(P, g, field, false);
      // the bowl, back to front: far side, left end, right end, near side (each stand covers its corners)
      stadiumStand(P, g, { x0: 0.1, x1: fw - 0.1, y0: 0.1, y1: 1.0 }, 'y1', hIn, hOut, steps);
      stadiumStand(P, g, { x0: 0.1, x1: 1.0, y0: 1.0, y1: fh - 1.0 }, 'x1', hIn, hOut, steps);
      stadiumStand(P, g, { x0: fw - 1.0, x1: fw - 0.1, y0: 1.0, y1: fh - 1.0 }, 'x0', hIn, hOut, steps);
      stadiumStand(P, g, { x0: 0.1, x1: fw - 0.1, y0: fh - 1.0, y1: fh - 0.1 }, 'y0', hIn, hOut, steps);
      // concrete entry ramps up to the concourse at both near corners
      for (const side of [0, 1]) { const xa = side ? fw - 0.2 : 0.2, xb = side ? fw - 1.3 : 1.3; fpPoly(P, g, [[xa, fh - 0.05, 0], [xb, fh - 0.05, 0], [xb, fh - 0.05, hOut * 0.5]], CONC[3]); fpLine(P, g, [xa, fh - 0.05, 0], [xb, fh - 0.05, hOut * 0.5], CONC[1]); fpPoly(P, g, [[xb, fh - 0.05, 0], [xb, fh - 0.35, 0], [xb, fh - 0.35, hOut * 0.5], [xb, fh - 0.05, hOut * 0.5]], CONC[1]); }
      if (upper) {
        // upper deck: the outer 45 % of every stand, lifted over the lower bowl's rim
        const uIn = hOut + 2, uOut = hTop, us = 3;
        stadiumStand(P, g, { x0: 0.1, x1: fw - 0.1, y0: 0.1, y1: 0.5 }, 'y1', uIn, uOut, us);
        stadiumStand(P, g, { x0: 0.1, x1: 0.5, y0: 0.5, y1: fh - 0.5 }, 'x1', uIn, uOut, us);
        stadiumStand(P, g, { x0: fw - 0.5, x1: fw - 0.1, y0: 0.5, y1: fh - 0.5 }, 'x0', uIn, uOut, us);
        stadiumStand(P, g, { x0: 0.1, x1: fw - 0.1, y0: fh - 0.5, y1: fh - 0.1 }, 'y0', uIn, uOut, us);
        // the gold crown: lights along the outer rim (brighter at night, chasing with the frame)
        const rim = [[0.1, 0.1], [fw - 0.1, 0.1], [fw - 0.1, fh - 0.1], [0.1, fh - 0.1], [0.1, 0.1]];
        for (let e = 0; e < 4; e++) {
          const a = rim[e], b = rim[e + 1], n = 14;
          for (let k = 0; k <= n; k++) { const p = fpPt(g, a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, hTop + 1); const on = !night || ((k + frame) % 3) !== 0; P.px(p[0], p[1], on ? PAL.goldHi : PAL.gold); if (night && on) P.px(p[0], p[1] - 1, X.white); }
        }
      }
      // six masts on the rims (the far three stand behind the bowl's top edge)
      for (const X of [0.3, fw / 2, fw - 0.3]) mast(X, 0.1, hTop);
      for (const X of [0.3, fw / 2, fw - 0.3]) mast(X, fh - 0.1, hTop);
      // CAULDRON on the near wall, the scoreboard (II) / jumbotron (III) over the far end
      const lc = fpPt(g, fw / 2, fh - 0.1, hTop / 2); decalAt(P, 'letters', lc[0] - 16, lc[1] - 4, 0, g.seed);
      const sb = fpPt(g, 0.5, fh / 2, hTop);
      P.rect(sb[0] - 1, sb[1] - 12, 2, 12, X.steel); P.vline(sb[0], sb[1] - 12, 12, X.steelDark);
      if (upper) decalAt(P, 'jumbotron', sb[0] - 12, sb[1] - 28, frame % 4, g.seed);
      else stadiumScoreboard(P, sb[0] - 14, sb[1] - 24, night, frame);
    },
    quad(ctx, P, g, row, variant, frame) {
      void row; void variant; void frame;
      const fw = g.fw, fh = g.fh;
      fpPoly(P, g, [[0, 0], [fw, 0], [fw, fh], [0, fh]], XB.lawn);
      fpLine(P, g, [0, fh], [fw, fh], shade(XB.lawn, 0.7)); fpLine(P, g, [fw, fh], [fw, 0], shade(XB.lawn, 0.7));
      // two gravel paths crossing the lawn, benches, the live oak in the middle
      fpLine(P, g, [fw * 0.5, 0.1], [fw * 0.5, fh - 0.1], PAL.gravel); fpLine(P, g, [0.1, fh * 0.5], [fw - 0.1, fh * 0.5], PAL.gravel);
      const c = fpPt(g, fw / 2, fh / 2, 0), b1 = fpPt(g, fw * 0.3, fh * 0.75, 0), b2 = fpPt(g, fw * 0.75, fh * 0.3, 0);
      P.rect(b1[0] - 2, b1[1] - 3, 4, 3, PAL.purple); P.rect(b2[0] - 2, b2[1] - 3, 4, 3, PAL.gold);
      blitSprite(ctx, g.zoom, M.get('oak', 2, 0, g.zoom), c[0], c[1] - 6);
    },
    parking(ctx, P, g, row, variant, frame) {
      void ctx; void row; void variant;
      const fw = g.fw, fh = g.fh, asphalt = '#3A3A40';
      fpPoly(P, g, [[0, 0], [fw, 0], [fw, fh], [0, fh]], asphalt);
      fpLine(P, g, [0, fh], [fw, fh], shade(asphalt, 0.7)); fpLine(P, g, [fw, fh], [fw, 0], shade(asphalt, 0.7));
      // bay stripes every half tile along X, a lane down the middle
      for (let s = 1; s < fw * 2; s++) fpLine(P, g, [s / 2, 0.15], [s / 2, fh * 0.42], shade(asphalt, 1.5));
      for (let s = 1; s < fw * 2; s++) fpLine(P, g, [s / 2, fh * 0.58], [s / 2, fh - 0.15], shade(asphalt, 1.5));
      const flooded = frame === 1;
      const n = fw * 2;
      for (let i = 0; i < n; i++) {
        const p = fpPt(g, (i + 0.5) / 2, (i & 1) ? fh * 0.28 : fh * 0.75, 0);
        if ((hash(g.seed, i) % 5) === 0) continue;   // an empty bay here and there
        decalAt(P, 'cars', p[0] - 4, p[1] - 5 - (flooded ? 1 : 0), hash(g.seed, i) % 3, g.seed + i);
      }
    },
    pond(ctx, P, g, row, variant, frame) {
      void ctx; void row; void variant;
      const fw = g.fw, fh = g.fh, m = 0.12, m2 = 0.4;
      fpPoly(P, g, [[m, m], [fw - m, m], [fw - m, fh - m], [m, fh - m]], PAL.shallows);
      fpPoly(P, g, [[m2, m2], [fw - m2, m2], [fw - m2, fh - m2], [m2, fh - m2]], PAL.waterNight);
      fpLine(P, g, [m, fh - m], [fw - m, fh - m], shade(PAL.waterNight, 0.9)); fpLine(P, g, [fw - m, fh - m], [fw - m, m], shade(PAL.waterNight, 0.9));
      const c = fpPt(g, fw / 2, fh / 2, 0);
      for (let i = 0; i < 6; i++) { const x = c[0] - (g.gw >> 2) + (hash(g.seed, i) % (g.gw >> 1)); P.hline(x, c[1] + (hash(g.seed, 20 + i) % 6) - 3, 2, shade(PAL.shallows, 1.3)); }
      const r1 = fpPt(g, 0.5, fh - 0.4, 0), r2 = fpPt(g, fw - 0.4, 0.5, 0), pier = fpPt(g, fw * 0.5, fh - 0.2, 0);
      decalAt(P, 'reeds', r1[0] - 6, r1[1] - 8, frame % 2, g.seed);
      decalAt(P, 'reeds', r2[0] - 6, r2[1] - 8, (frame + 1) % 2, g.seed + 3);
      P.rect(pier[0] - 3, pier[1] - 4, 6, 3, PAL.bark); P.vline(pier[0] - 3, pier[1] - 4, 3, light(PAL.bark));
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
      const night = !!(variant & SPR.NIGHT), C = g.colors, T = C.trim;
      // belfry: the top-floor windows become arched openings with a bell inside (lit at night)
      const cells = g.windowCells || [];
      for (const c of cells) { if (c.r !== 5) continue; const left = c.face === 0; P.rect(c.x - 1, c.y - 3, c.w + 2, c.h + 4, left ? C.RL[0] : C.RR[0]); P.px(c.x - 1, c.y - 3, left ? C.left : C.right); P.px(c.x + c.w, c.y - 3, left ? C.left : C.right); P.hline(c.x - 2, c.y + c.h + 1, c.w + 4, left ? T[3] : T[2]); P.rect(c.x, c.y - 1, c.w, 2, night ? PAL.goldHi : PAL.gold2); P.px(c.x + (c.w >> 1), c.y + 1, PAL.goldShadow); P.px(c.x + (c.w >> 1), c.y - 2, MAT.iron[1]); }
      const cx = g.bcx, cy = g.bcy - g.wallH - g.roofH, spireH = 16, R = rampOf((row.paint && row.paint.roofColor) || PAL.terracotta);
      fillPoly(P, [[cx - (g.bw >> 2), cy], [cx, cy + 1], [cx, cy - spireH]], R[3]); fillPoly(P, [[cx, cy + 1], [cx + (g.bw >> 2), cy], [cx, cy - spireH]], R[1]);
      P.line(cx - (g.bw >> 2), cy, cx, cy - spireH, R[4]); P.line(cx + (g.bw >> 2), cy, cx, cy - spireH, R[0]);
      P.vline(cx, cy - spireH - 3, 3, PAL.gold); P.px(cx, cy - spireH - 4, PAL.goldHi); P.hline(cx - 1, cy - spireH - 2, 3, PAL.gold2);
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
    wastewater(ctx, P, g, row, variant, frame) {
      drawStandardBox(ctx, P, g, row, variant, frame);
      // a round clarifier on the apron: concrete ring, teal water, the rotating skimmer arm
      const p = frontPoint(g, 0.55), CO = MAT.concrete, W = M.ramp('waterShallow');
      P.ellipse(p.x, p.y - 2, 10, 5, CO[2]); P.ellipse(p.x, p.y - 3, 10, 5, CO[3]); P.ellipse(p.x, p.y - 3, 8, 4, W[1]); P.ellipse(p.x - 2, p.y - 4, 4, 2, W[2]);
      const a = ((frame | 0) & 1) ? 1 : -1; P.line(p.x - 7 * a, p.y - 3 - 2, p.x + 7 * a, p.y - 3 + 2, CO[4]); P.px(p.x, p.y - 4, MAT.iron[2]);
    },
    coastal_institute(ctx, P, g, row, variant, frame) {
      drawStandardBox(ctx, P, g, row, variant, frame);
      const a = frontPoint(g, 0), b = frontPoint(g, 0.5);
      P.line(a.x, a.y, b.x, b.y, PAL.boardwalk); P.line(a.x, a.y + 1, b.x, b.y + 1, shade(PAL.boardwalk, 0.8));
    }
  };

  /** every catalog id resolves non-trivially through either a SPECIAL entry or drawStandardBox */
  M.paintBuilding = function (ctx, row, variant, frame, zoom, seed, rot, tees) {
    variant = Number.isFinite(variant) ? Math.max(0, variant | 0) : 0;
    frame = Number.isFinite(frame) ? (frame | 0) : 0;
    seed = seed | 0;
    if (!row) { begin(ctx, 1, 1, zoom); return { w: 1, h: 1, ox: 0, oy: 0 }; }
    const g = M.buildingBox(row, variant, zoom, rot);
    g.paint = row.paint || {};
    g.seed = hash(strHash(row.id || 'b'), (seed ^ variant) >>> 0);
    g.tone = (variant & SPR.DAMAGED) ? 0.8 : 1;
    g.frontLeft = !!(variant & SPR.FRONT_L);
    g.tees = (Array.isArray(tees) && tees.length) ? tees : null;   // tee pass: per-building path connectors (render.bakeWith), never part of a cached variant
    g.features = (row.paint && Array.isArray(row.paint.features)) ? row.paint.features : [];   // art pass B3: per-row features (data.js paint.features)
    g.row = row;
    begin(ctx, g.w, g.h, zoom);
    const P = tonePen(pen(ctx, g.zoom), g.tone);
    if (variant & SPR.RUIN) { drawGrounds(P, g, row, SPR.SCAFFOLD, g.seed); drawRuinShape(P, g, g.seed); return { w: g.w, h: g.h, ox: g.ox, oy: g.oy }; }
    if (variant & SPR.PILINGS) drawPilingsGround(P, g, g.seed); else drawGrounds(P, g, row, variant, g.seed);
    if ((variant & SPR.PILINGS) && !(variant & SPR.SCAFFOLD)) drawStiltsBack(P, g);
    if (variant & SPR.SCAFFOLD) {
      drawScaffoldStage(P, g, row, frame);
    } else {
      const fn = SPECIAL[g.special];
      if (fn) fn(ctx, P, g, row, variant, frame); else drawStandardBox(ctx, P, g, row, variant, frame);
    }
    if ((variant & SPR.PILINGS) && !(variant & SPR.SCAFFOLD)) drawStilts(P, g);
    try { drawMargins(P, g, row, variant, frame); } catch (e) { BSU.error('sprites', 'margins:' + row.id, e); }
    if (variant & SPR.DAMAGED) applyDamaged(P, g);
    if (variant & SPR.BOARDED) applyBoarded(P, g);
    if (variant & FLOODED_BIT) { try { applyFlooded(P, g); } catch (e) { BSU.error('sprites', 'flooded:' + row.id, e); } }
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
    drawApronQuad(P, g, { base: XB.rubble, alt: shade(XB.rubble, 0.85), hi: shade(XB.rubble, 1.1), pattern: 'gravel' }, spec.seed);
    drawRuinShape(P, g, spec.seed);
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  }

  // ---------------------------------------------------------------------------
  // `icon:<catalogId>` — the 64×64 palette icon: the base sprite scaled to fit 60×60, centred.
  // Drag/paint rows show their terrain tile (mask 5, N+S straight); Pilings shows a dorm on stilts
  // at half scale; everything else is the row's own variant-0 building sprite.
  // ---------------------------------------------------------------------------
  const ICON_SURF = { path: 'surf:1', road: 'surf:2', boardwalk: 'surf:3', gator_fence: 'surf:4', bridge: 'surf:5' };
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
    else if (id === 'stadium') src = M.get('stadium', 1 << SPR.TIER_SHIFT, 0, 1);   // tier 0 is the construction site; the palette shows tier I
    else src = M.get(id, 0, 0, 1);
    if (src && src.canvas) {
      const S = dims.S;
      // crop a footprint building to its structure (the apron margin would shrink the thumbnail)
      let sx = src.sx, sy = src.sy, sw = src.sw, sh = src.sh;
      const row = BSU.data && BSU.data.catalog ? BSU.data.catalog[id] : null;
      if (row && row.kind === 'footprint' && !OWN_GROUND[specialOf(row)] && id !== 'stadium') {
        const g = M.buildingBox(row, 0, 1, 0);
        const x0 = Math.max(0, g.bcx - (g.bw >> 1) - 6), x1 = Math.min(src.sw, g.bcx + (g.bw >> 1) + 6), y1 = Math.min(src.sh, g.by + 8);
        if (x1 - x0 >= 16 && y1 >= 16) { sx += x0; sw = x1 - x0; sh = y1; }
      }
      if (scale === null) scale = Math.min(1, 60 / Math.max(sw, sh));
      const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
      const dx = Math.round((dims.w * S - dw) / 2), dy = Math.round((dims.h * S - dh) / 2);
      try { ctx.imageSmoothingEnabled = false; ctx.drawImage(src.canvas, sx, sy, sw, sh, dx, dy, dw, dh); } catch (e) { /* headless stub */ }
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
    return M.paintBuilding(ctx, row, spec.variant, spec.frame, spec.zoom, spec.seed, spec.rot, spec.tees);
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
    const combos = [0, SPR.NIGHT, SPR.DAMAGED, SPR.PILINGS, SPR.SCAFFOLD, SPR.RUIN, SPR.BOARDED, SPR.NIGHT | SPR.PILINGS | SPR.BOARDED, FLOODED_BIT, FLOODED_BIT | SPR.NIGHT | SPR.DAMAGED];
    for (const row of data.catalogList) for (const v of combos) { const e = M.get(row.id, v, 0, 1); if (!e) fail('row ' + row.id + ' v' + v + ' returned null'); }
    for (const row of data.catalogList) for (const f of ((row.paint && row.paint.features) || [])) { const known = FEATURES.indexOf(f) >= 0 || (f.indexOf('sign:') === 0 && f.length > 5 && f.length <= 12); if (!known) fail('row ' + row.id + ' unknown feature ' + f); }
    if (BSU.errors && BSU.errors.size !== errBefore) fail('decal placement for some row raised BSU.error');
    return { ok: !notes.length, notes: notes.join('; ') || (data.catalogList.length + ' rows x ' + combos.length + ' variant combos OK') };
  });
})();
