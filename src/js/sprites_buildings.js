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
    coastal_institute: 10, rookery: 40, tiger_habitat: 30, surge_barrier: 20, greek_house: 6, wildlife_post: 6, marsh_restoration: 4,
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
  const OWN_GROUND = { stadium: 1, practice_field: 1, quad: 1, pond: 1, parking: 1, rookery: 1, tiger_habitat: 1 };
  const NO_TEE = { bunkhouse: 1, suites: 1 };         // P7: their porch / courtyard front has no wall to land a path connector on
  const NO_FOUNDATION = { suites: 1 };              // P7: the L of wings paints its own contact shadows
  const OWN_STATES = { tiger_habitat: 1 };   // habitat pass: specials that dress DAMAGED / BOARDED / FLOODED themselves (the generic window / roof / wall passes would draw nothing sensible)
  M.APRON = APRON;
  const APRON_ROW = Object.freeze({   // P7: the economy tier stands in a sandy gravel yard (no hedge); the premium tier keeps the housing lawn and hedges
    bunkhouse: { base: '#B3A27C', alt: '#9C8B67', hi: '#CDBE98', pattern: 'gravel' }
  });
  function apronOf(row) { return APRON_ROW[(row && row.id) || ''] || APRON[(row && row.tab) || ''] || APRON.life; }
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
    if (!site && !OWN_GROUND[g.special] && !NO_FOUNDATION[g.special] && (g.wallH > 0 || g.special)) drawFoundation(P, g, A.base);
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
    if (g.stiltBoxes) { for (const b of g.stiltBoxes) drawStilts(P, Object.assign({}, b, { stiltBoxes: null })); return; }
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
    if (g.stiltBoxes) { for (const b of g.stiltBoxes) drawStiltsBack(P, Object.assign({}, b, { stiltBoxes: null })); return; }
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
    if (OWN_GROUND[specialOf(row)] || NO_TEE[specialOf(row)]) return false;
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
      const colsF = opts.cols ? Math.max(1, opts.cols[face] | 0) : cols;   // P7: per-face column counts (opts.cols = [SW, SE]) for the long / short faces of the housing rows
      const faceW = (fx1 - fx0) - 4, x0 = fx0 + 2;
      const cw = Math.max(1, faceW / colsF);
      const left = face === 0;
      const sill = left ? T[3] : T[1], lintel = left ? T[2] : T[1], glassDay = left ? G[2] : G[1], glassHi = left ? G[3] : G[2];
      const shut = left ? acc[2] : acc[1], shutHi = left ? acc[3] : acc[2];
      const wallC = left ? C.left : C.right;
      for (let r = 0; r < rows; r++) {
        for (let kk = 0; kk < colsF; kk++) {
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
    if (!faces) hIn = 0;   // qa pass 3: a stand seen from behind starts at the turf, so its first tread never covers the near sideline (it hid the near 3 px of the field and the WR at the wall's foot)
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
    P.text('BSU', x + 8, y + 2, PAL.gold);   // qa pass 3: the baked board idles on the crest, not a frozen "0-0" beside a live 7–0 score bug
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
  // ---------------------------------------------------------------------------
  // Tiger Habitat (habitat pass) — a small zoo exhibit on the 3×3 footprint instead of a grey slab.
  // LOCAL coordinates: X = depth (0 = the back rock … 3 = the front edge), Y = along the front (0 … 3). The front is the SE edge
  // (world X = fw); under SPR.FRONT_L the painter is transposed (local X → world Y), so one layout serves both entrances and
  // `pt` / `inv` are the only places that know. Layout (tiles): the visitor plaza is the front row X ∈ [2, 3] (brick, two benches, two
  // lamps, the viewing spots); the viewing wall stands at X ≈ 2 (stone, purple iron railing, a glass panel at Y ∈ [0.8, 2.2]); behind
  // it the enclosure floor lies 3 px below the plaza: grass, a pool with a waterfall off the back rock, a den with a stone arch and the
  // ROUX sign, boulders, a climbing log, a shade oak and palmettos; the keeper's gate is in the near side wall (Y = 3). The layout is
  // shared with render (Roux's route) and agents (the viewing spots) through M.HABITAT / M.habitatWorld: one source of truth.
  // `layer` 1 = only what stands in FRONT of Roux (the near side wall, the viewing wall with its railing and the glass, the gate
  // piers): render draws it again after the tiger (sprite id `habfront`) so he walks behind the glass.
  // ---------------------------------------------------------------------------
  const HAB = Object.freeze({
    FLOOR_Z: -3, WALL_Z: 6, FX0: 0.14, FX1: 1.92, FY0: 0.14, FY1: 2.86, WALL_X: 2.08, GLASS: Object.freeze([0.8, 2.2]),
    POOL: Object.freeze([[0.4, 1.0, 0.28], [0.76, 1.4, 0.42], [0.98, 1.88, 0.3]]),      // metaballs [x, y, r] (tiles)
    TREE: Object.freeze([0.5, 0.5]), NAP: Object.freeze([1.06, 0.72]), SWIM: Object.freeze([[0.78, 1.12], [0.98, 2.04]]),
    ROUX: Object.freeze({ x0: 0.5, x1: 1.6, y0: 0.45, y1: 2.55 }),                       // where he may walk (the glass stop is x = 1.55)
    SPOT_X: Object.freeze([2.25, 2.75]), SPOT_Y: Object.freeze([0.75, 1.25, 1.75, 2.25])  // the plaza's standing cells (the 0.5-tile occupancy grid)
  });
  M.HABITAT = HAB;
  /** local (X, Y) → world tile coordinates (tile units, tile corner = integer) of a habitat whose origin tile is (tx, ty) */
  M.habitatWorld = function (tx, ty, frontLeft, X, Y) { return frontLeft ? [tx + Y, ty + X] : [tx + X, ty + Y]; };
  /** the pool's metaball field at local (X, Y): > 0 inside the water */
  function habPool(lx, ly) { let f = -9; for (let i = 0; i < HAB.POOL.length; i++) { const c = HAB.POOL[i], dx = lx - c[0], dy = ly - c[1], v = 1 - (dx * dx + dy * dy) / (c[2] * c[2]); if (v > f) f = v; } return f; }
  M.habitatPool = habPool;
  let habBoxMemo = null;
  /** a point of the exhibit (local X, Y at height z px) as a 1× pixel offset from the building sprite's anchor — for the lights pass (render_fx lights the plaza lamps with it) */
  M.habitatPoint = function (frontLeft, X, Y, z) {
    const g = habBoxMemo || (habBoxMemo = M.buildingBox(BSU.data.catalog.tiger_habitat, 0, 1, 0)), p = frontLeft ? fpPt(g, Y, X, z) : fpPt(g, X, Y, z);
    return [p[0] - g.ax, p[1] - g.ay];
  };
  let hbX = 0, hbY = 0;
  const toneAt = M.toneAt;

  function habitatPaint(ctx, P, g, row, variant, frame, layer) {
    const T = !!g.frontLeft, night = !!(variant & SPR.NIGHT), flood = !!(variant & FLOODED_BIT), dmg = !!(variant & SPR.DAMAGED), board = !!(variant & SPR.BOARDED);
    const seed = g.seed | 0, FZ = HAB.FLOOR_Z, WZ = HAB.WALL_Z, front = layer === 1, fr = (frame | 0) & 3;
    const site = layer === 2 ? (((frame | 0) % 3) + 3) % 3 : -1;           // construction stage 0..2 (layer 2: over the graded-dirt site that drawGrounds painted), else -1
    const litX = T, litY = !T;                                              // which local face (+X, +Y) is the SW (lit) one
    const pt = (lx, ly, z) => (T ? fpPt(g, ly, lx, z) : fpPt(g, lx, ly, z));
    const inv = (px, py, z) => {                                            // screen pixel on the plane z → local (X, Y) in hbX, hbY
      const d = (px - g.ax) / 32 - (g.fh - g.fw), s = (py - g.ay - 16 + z + g.lift) / 16 + g.fw + g.fh, wx = (s + d) / 2, wy = (s - d) / 2;
      if (T) { hbX = wy; hbY = wx; } else { hbX = wx; hbY = wy; }
    };
    const region = (x0, y0, x1, y1, z, fn) => {                             // every pixel of the local rect on the plane z → fn(px, py, lx, ly)
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (const c of [pt(x0, y0, z), pt(x1, y0, z), pt(x1, y1, z), pt(x0, y1, z)]) { if (c[0] < a0) a0 = c[0]; if (c[0] > a1) a1 = c[0]; if (c[1] < b0) b0 = c[1]; if (c[1] > b1) b1 = c[1]; }
      for (let py = b0; py <= b1; py++) for (let px = a0; px <= a1; px++) { inv(px, py, z); if (hbX >= x0 && hbX < x1 && hbY >= y0 && hbY < y1) fn(px, py, hbX, hbY); }
    };
    const face = (axis, c, a0, a1, za, zb, fn) => {                         // a vertical face on the line (X = c | Y = c), a0 → a1 along the other axis, from za up to zb
      const pa = axis === 'X' ? pt(c, a0, 0) : pt(a0, c, 0), pb = axis === 'X' ? pt(c, a1, 0) : pt(a1, c, 0), dx = pb[0] - pa[0]; if (!dx) return;
      const lo = Math.min(pa[0], pb[0]), hi = Math.max(pa[0], pb[0]);
      for (let x = lo; x < hi; x++) {
        const s = (x - pa[0]) / dx, yb = Math.round(pa[1] + (pb[1] - pa[1]) * s), top = typeof zb === 'function' ? zb(s, x) : zb;
        for (let z = za; z < top; z++) { const col = fn(x, yb - z - 1, s, z, z === top - 1); if (col) P.px(x, yb - z - 1, col); }
      }
    };
    const poly = (pts, color) => fillPoly(P, pts.map((p) => pt(p[0], p[1], p[2] || 0)), color);
    const seg = (a, b, color) => { const p = pt(a[0], a[1], a[2] || 0), q = pt(b[0], b[1], b[2] || 0); P.line(p[0], p[1], q[0], q[1], color); };
    const box = (x0, y0, x1, y1, z0, z1, top, cx, cy) => {                  // cx: colour of the +X face, cy: of the +Y face
      poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], cx); poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], cy); poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], top);
    };
    const clampT = (t) => (t < 0 ? 0 : t > 4 ? 4 : t);
    const GRS = M.ramp('grass'), GHI = M.ramp('highGrass'), DIRT = M.ramp('dirt'), SAND = M.ramp('sand'), WS = M.ramp('waterShallow'), WD = M.ramp('waterDeep'), BARK = M.ramp('bark'), MOSS = M.ramp('moss'),
      OAK = M.ramp('oakLeaf'), STONE = rampOf('#9C978E'), ROCK = rampOf('#8A7D70'), LIME = MAT.trim, IRON = MAT.iron, GLASS = MAT.glass, BRICK = rampOf(XB.brick), WOOD = MAT.wood, PU = MAT.purple, GO = MAT.gold;
    const FOAM = '#F1FBF6';
    const stoneAt = (lit, sd) => (px, py, s, z, top) => {
      const course = Math.floor((z + 9) / 3), ex = (px + ((course * 5 + sd) % 7)) % 7, n = noiseAt(px, py, seed + sd);
      let t = lit ? 2 : 1; if (n > 0.66) t++; else if (n < 0.2) t--;
      if (((z + 9) % 3) === 0) t--; else if (ex === 0) t--;
      if (top) t = lit ? 4 : 3;
      return STONE[clampT(t)];
    };

    // ---- 1. the plaza: brick paving, limestone curbs, the viewing wall's cast shadow ----------------------------------------
    if (!front) {
      region(HAB.WALL_X - 0.14, 0, 3.0, 3.0, 0, (px, py, lx, ly) => {
        const gx = Math.floor(lx * 32), gy = Math.floor(ly * 32), course = gx >> 2, off = (course & 1) * 4;
        let col;
        if ((gx & 3) === 3 || ((gy + off) & 7) === 7) col = mix(BRICK[3], SAND[2], 0.5);                        // mortar
        else { const hb = hash(seed + 3, course * 53 + ((gy + off) >> 3)) % 5; col = BRICK[hb === 0 ? 3 : hb === 1 ? 1 : 2]; }
        if (lx > 2.9 || ly < 0.07 || ly > 2.93) col = ((gx + gy) & 1) ? LIME[3] : LIME[2];                    // the limestone curb on the outer edges
        else if (lx < 2.36) { const k = (2.36 - lx) / 0.36; if (hash(seed, px * 7 + py) % 100 < k * 72) col = shade(col, 0.72); }
        if (site >= 0) { if (site === 0) return; if (site === 1 || ly < 1.5) col = SAND[toneAt(0.35 + noiseAt(px, py, seed + 4) * 0.35, px, py, [0.2, 0.4, 0.62, 0.84], 0.12)]; }   // construction: a compacted sand bed, bricks laid from the far end
        if (night) for (let q = 0; q < 2; q++) { const d = Math.hypot(lx - 2.9, ly - (q ? 2.8 : 0.2)); if (d < 0.85) { const k = 1 - d / 0.85; col = mix(col, PAL.windowGlow, Math.min(0.85, k * k * 0.95 + 0.12 * k)); } }   // the lamps' pools of light, clipped to the paving
        P.px(px, py, col);
      });
    }

    // ---- 2. the enclosure floor: grass, worn dirt, shore sand, the pool ---------------------------------------------------
    const tufts = [];
    if (!front) region(0, 0, HAB.WALL_X, 3.0, FZ, (px, py, lx, ly) => {
      if (lx < HAB.FX0 || ly < HAB.FY0 || ly > HAB.FY1 + 0.14 || lx > HAB.FX1 + 0.16) return;
      const f = habPool(lx, ly), n = noiseAt(px, py, seed + 11);
      let col;
      if (site === 0) return;
      if (site >= 1) { col = DIRT[toneAt(0.18 + n * 0.4, px, py, [0.2, 0.4, 0.6, 0.85], 0.12)]; if (f > 0) col = site === 1 ? '#2E4C66' : mix(WS[1], WD[2], 0.45); else if (lx < HAB.FX0 + 0.3 || ly < HAB.FY0 + 0.15) col = shade(col, 0.8); P.px(px, py, col); return; }   // the dug pit; the pool lined, then filling
      if (f > 0) {                                                                                           // the pool: shallow → deep, edge sheen, tree reflection, glints
        const t = toneAt(1 - Math.min(1, f * 1.7), px, py, [0.2, 0.45, 0.7, 0.88], 0.14);                  // 0 = deep … 4 = rim
        col = [WD[2], mix(WD[2], WS[1], 0.4), mix(WS[1], WD[2], 0.3), WS[1], WS[2]][4 - t];
        if (f < 0.07) col = ((px + py) & 1) ? WS[3] : WS[2];
        if (ly < 1.3 && lx < 1.1 && n > 0.5 && f > 0.12) col = mix(col, OAK[1], 0.6);                        // the oak's reflection
        if (hash(seed + fr, py * 9 + (px >> 2)) % (night ? 9 : 15) === 0 && f > 0.15) col = night ? '#DDE8FF' : WS[3];     // glints
      } else if (f > -0.15) col = SAND[toneAt(0.5 + (n - 0.5) * 0.5, px, py, [0.2, 0.4, 0.62, 0.84], 0.12)];  // the shore
      else {
        let t = toneAt(n, px, py, M.TH_GROUND, 0.1);
        const dx = lx - HAB.FX0, dy = ly - HAB.FY0;
        if (dx < 0.34 && hash(seed + 1, px * 5 + py) % 100 < (0.34 - dx) / 0.34 * 80) t -= 1;               // the back rock's cast shadow (+X)
        if (dy < 0.16) t -= 1;
        const worn = (Math.abs(lx - 1.42) < 0.16 && ly > 0.5 && ly < 2.6) || (lx < 0.6 && ly > 2.0 && ly < 2.78);
        const nap = (lx - HAB.NAP[0]) * (lx - HAB.NAP[0]) + (ly - HAB.NAP[1]) * (ly - HAB.NAP[1]) < 0.09;
        if (worn && n > 0.34) col = DIRT[toneAt(n * 0.8 + 0.1, px, py, [0.2, 0.4, 0.6, 0.85], 0.12)];
        else { col = (nap ? GHI : GRS)[clampT(t)]; if (t >= 3 && hash(seed + 2, px * 11 + py * 3) % 19 === 0) tufts.push(px, py); }
      }
      P.px(px, py, col);
    });
    for (let i = 0; i < tufts.length; i += 2) { const x = tufts[i], y = tufts[i + 1], fl = hash(seed + 3, x * 5 + y) % 9; P.px(x, y, GHI[3]); P.px(x - 1, y - 1, GRS[3]); P.px(x + 1, y - 1, GHI[4]); if (fl === 0) P.px(x, y - 1, PAL.azalea); else if (fl === 1) P.px(x, y - 1, '#FFF6C8'); }

    // ---- 3. the back rock (waterfall, den, sign) and the far side wall -----------------------------------------------------
    const RX = HAB.FX0, rockTop = (s, x) => 16 + (hash(seed + 5, x >> 2) % 4) + ((s > 0.62 && s < 0.9) ? 2 : 0);
    if (!front && (site < 0 || site === 2)) {
      face('X', RX, 0, 3.0, FZ, rockTop, (px, py, s, z, top) => {
        const rw = Math.floor((z + 20) / 6), off = hash(seed, rw) & 7, cl = Math.floor((px + off) / 9), hb = hash(seed + 7, rw * 37 + cl);
        let t = litX ? 2 : 1; t += (hb % 5 === 0) ? 1 : ((hb % 7 === 0) ? -1 : 0);
        const ey = (z + 20) % 6, ex = (px + off) % 9; if (ey === 0 || ex === 0) t -= 1; else if (ey === 5 && ex < 5) t += 1;
        if (top) t = 4;
        return (z > 8 && noiseAt(px, py, seed + 9) > 0.64) ? MOSS[clampT(t - 1)] : ROCK[clampT(t)];          // moss and lichen high up
      });
      { const ra = pt(RX, 0, 0), rb = pt(RX, 3.0, 0);                                                         // grass and ferns on the crest
        for (let x = Math.min(ra[0], rb[0]); x < Math.max(ra[0], rb[0]); x++) {
          if (hash(seed + 22, x) % 3 !== 0) continue; const s = (x - ra[0]) / (rb[0] - ra[0]), yb = Math.round(ra[1] + (rb[1] - ra[1]) * s), top = rockTop(s, x);
          P.px(x, yb - top, GHI[3]); P.px(x, yb - top - 1, (hash(seed + 23, x) & 1) ? GRS[2] : GHI[4]);
        } }
      face('Y', HAB.FY0, HAB.FX0, HAB.FX1 + 0.1, FZ, WZ, (px, py, s, z, top) => {                             // the far side wall: stone, moss, a coping
        let col = stoneAt(litY, 3)(px, py, s, z, top);
        if (!top && z < FZ + 5 && noiseAt(px, py, seed + 14) > 0.55) col = MOSS[litY ? 2 : 1];
        if (!top && hash(seed + 15, px) % 7 === 0 && z > 0) col = GRS[litY ? 2 : 1];                          // vine strands
        return col;
      });
      poly([[HAB.FX0, 0.06, WZ], [HAB.WALL_X, 0.06, WZ], [HAB.WALL_X, HAB.FY0, WZ], [HAB.FX0, HAB.FY0, WZ]], STONE[4]);
      seg([HAB.FX0, 0.06, WZ], [HAB.WALL_X, 0.06, WZ], LIME[4]);
      // the waterfall: a spout in the rock, streaks down into the pool, foam at its foot
      if (site < 0) {
      const wy0 = 0.86, wy1 = 1.14, spoutZ = 13;
      face('X', RX + 0.01, wy0, wy1, FZ, spoutZ, (px, py, s, z, top) => {
        const k = hash(seed + 31, px * 3 + (z >> 2)) % 7;
        let col = k < 2 ? FOAM : (k < 4 ? WS[4] : (k < 6 ? WS[3] : WS[2]));
        if (s < 0.1 || s > 0.9) col = WS[1];
        if (z < FZ + 3) col = (hash(seed + 32, px + py * 3) % 3 === 0) ? FOAM : WS[3];
        return col;
      });
      { const sp = pt(RX + 0.01, (wy0 + wy1) / 2, spoutZ); P.hline(sp[0] - 5, sp[1] - 1, 10, ROCK[3]); P.hline(sp[0] - 4, sp[1] - 2, 8, ROCK[4]);
        const fp = pt(RX + 0.18, (wy0 + wy1) / 2, FZ); for (let i = 0; i < 10; i++) P.px(fp[0] - 6 + (hash(seed + 33, i) % 13), fp[1] + (hash(seed + 34, i) % 3) - 1, i & 1 ? FOAM : WS[4]); }
      }
      // the den: a limestone arch in the rock, a dark room, a sill
      const dy0 = 2.17, dy1 = 2.63, archTop = (s) => 9 + Math.round(Math.sqrt(Math.max(0, 1 - (2 * s - 1) * (2 * s - 1))) * 4);
      face('X', RX + 0.01, dy0 - 0.07, dy1 + 0.07, FZ, (s) => archTop(s) + 3, (px, py, s, z, top) => LIME[top ? 4 : (litX ? 3 : 2)]);
      face('X', RX + 0.012, dy0, dy1, FZ, archTop, (px, py, s, z, top) => {
        const u = Math.max(0, 1 - z / 9);
        if (z < FZ + 1) return LIME[2];
        return night ? mix('#2A1A22', '#FFB45A', 0.12 + 0.34 * u) : mix('#1B1424', '#3A2A30', u * 0.6);
      });
      // the sign: a purple board with a gold border and gold letters, sheared along the face, mounted above the arch
      if (site < 0) { const ys = 2.08, ye = 2.72, zs = 17, zt = 25, A = pt(RX + 0.015, ys, zt), B = pt(RX + 0.015, ye, zt), C = pt(RX + 0.015, ye, zs), D = pt(RX + 0.015, ys, zs);
        const lft = Math.min(A[0], B[0]), rgt = Math.max(A[0], B[0]);
        fillPoly(P, [A, B, C, D], PAL.gold2);
        fillPoly(P, [[A[0] + (A[0] < B[0] ? 1 : -1), A[1] + 1], [B[0] + (B[0] < A[0] ? 1 : -1), B[1] + 1], [C[0] + (C[0] < D[0] ? 1 : -1), C[1] - 1], [D[0] + (D[0] < C[0] ? 1 : -1), D[1] - 1]], PAL.purple);
        for (let i = 0; i < 4; i++) { const ch = 'ROUX'[i], gx = lft + 3 + i * 4, gt = Math.round((A[0] < B[0] ? A[1] + (gx - A[0]) * (B[1] - A[1]) / (B[0] - A[0]) : B[1] + (gx - B[0]) * (A[1] - B[1]) / (A[0] - B[0])) + 2); P.glyph(ch, gx, gt, night ? PAL.goldHi : PAL.gold); }
        void rgt; }
    }

    // ---- 4. the floor decor, back to front ---------------------------------------------------------------------------------
    const dropShadow = (cx, cy, rx, ry) => P.ellipse(cx + 2, cy, rx + 1, Math.max(1, ry), shade(GRS[1], 0.78));
    const boulder = (lx, ly, rx, ry, sd, mossy) => {
      const c = pt(lx, ly, FZ), cx = c[0], cy = c[1] - ry + 1;
      dropShadow(cx, c[1], rx, Math.max(1, ry >> 1));
      for (let dy = -ry; dy <= ry; dy++) {
        const half = Math.round(Math.sqrt(1 - (dy * dy) / (ry * ry + 0.01)) * rx) + (hash(seed + sd, dy + 40) % 2);
        for (let dx = -half; dx < half; dx++) {
          const lit = (-dx / rx) * 0.55 + (-dy / ry) * 0.7, n = noiseAt(cx + dx, cy + dy, seed + sd), v = 0.5 + lit * 0.4 + (n - 0.5) * 0.4;
          let t = toneAt(v, cx + dx, cy + dy, [0.18, 0.4, 0.62, 0.82], 0.12);
          if (dy === ry || dx === half - 1 || (dy === ry - 1 && dx > 0)) t = 0;
          let col = ROCK[t]; if (mossy && dy < -ry * 0.25 && n > 0.58 && t > 0) col = MOSS[clampT(t - 1)];
          P.px(cx + dx, cy + dy, col);
        }
      }
    };
    const sprite = (id, v, lx, ly, dy) => { const p = pt(lx, ly, FZ); blitSprite(ctx, g.zoom, M.get(id, v, 0, g.zoom), p[0], p[1] + (dy || 0)); };
    const logPiece = (a, b, z0, z1) => {                                    // a trunk lying from local a to b, lifted z0 → z1 px (a rock under its high end)
      const pa = pt(a[0], a[1], FZ + z0), pb = pt(b[0], b[1], FZ + z1), dx = pb[0] - pa[0]; if (!dx) return;
      const lo = Math.min(pa[0], pb[0]), hi = Math.max(pa[0], pb[0]);
      for (let x = lo; x <= hi; x++) {
        const s = (x - pa[0]) / dx, yc = Math.round(pa[1] + (pb[1] - pa[1]) * s) - 3;
        for (let k = 0; k < 5; k++) P.px(x, yc + k, BARK[[3, 3, 2, 1, 0][k]]);
        if (hash(seed + 41, x) % 4 === 0) P.px(x, yc + 1, BARK[4]);
      }
      const ea = pa, eb = pb; for (const e of [ea, eb]) { P.ellipse(e[0], e[1] - 1, 2, 3, '#B58B5A'); P.px(e[0], e[1] - 1, '#8A6540'); }
      const m = pt((a[0] + b[0]) / 2 + 0.03, (a[1] + b[1]) / 2, FZ + (z0 + z1) / 2); P.line(m[0], m[1] - 3, m[0] + 3, m[1] - 8, BARK[2]); P.line(m[0] + 1, m[1] - 3, m[0] + 4, m[1] - 8, BARK[1]); P.px(m[0] + 3, m[1] - 9, OAK[3]); P.px(m[0] + 4, m[1] - 9, OAK[2]);
    };
    // trunk of the shade oak (the canopy is drawn after everything on the floor)
    const tp = pt(HAB.TREE[0], HAB.TREE[1], FZ);
    if (!front && site < 0) {
    dropShadow(tp[0] + 4, tp[1], 12, 3); M.trunk(P, tp[0] - 2, tp[1] - 17, 5, 17, 2, 5);
    boulder(0.3, 0.8, 5, 3, 51, true);
    sprite('shrub', 1, 0.34, 0.62, 2);
    boulder(1.02, 0.95, 7, 4, 52, true);
    boulder(0.3, 1.52, 6, 4, 53, true);
    boulder(0.62, 2.02, 5, 3, 54, false);
    sprite('palmetto', M.treeVariant(1, false, false, 1), 0.34, 1.78, 2);
    logPiece([1.46, 1.58], [1.46, 2.42], 0, 4); boulder(1.46, 2.5, 4, 3, 55, false);
    boulder(1.18, 2.32, 3, 2, 56, false);
    sprite('azalea', M.treeVariant(2, false, true, 1), 0.52, 2.62, 2);
    sprite('azalea', M.treeVariant(2, false, true, 2), 1.55, 0.5, 2);
    sprite('palmetto', M.treeVariant(1, false, false, 1), 1.74, 0.36, 2);
    sprite('shrub', 2, 1.42, 0.2, 2);
    }

    // ---- 5. flood water over the enclosure (drawn before the canopy so the oak still stands above it) --------------------------------
    if (flood && !front && site < 0) {                                                                     // the pool has spilled: floodwater over the whole floor, the old pool a deeper swirl in it
      const FW = rampOf('#7C9A92');
      region(HAB.FX0, HAB.FY0, HAB.FX1, HAB.FY1, FZ + 5, (px, py, lx, ly) => {
        const n = noiseAt(px, py, seed + 61), f = habPool(lx, ly);
        let t = toneAt(0.3 + n * 0.45, px, py, [0.15, 0.4, 0.62, 0.8], 0.1);
        if (hash(seed + 65, (py >> 1) * 7 + (px >> 3)) % 11 === 0 && (py & 1)) t = 4;                       // ripple streaks
        let col = FW[clampT(t)];
        if (f > 0.05) col = mix(col, WD[2], Math.min(0.55, f * 0.9));                                       // the pool is still the deep part
        else if (f > -0.1 && hash(seed + 63, px * 3 + py) % 3 === 0) col = FOAM;                            // foam where it brimmed over
        P.px(px, py, col);
      });
      for (let i = 0; i < 12; i++) { const p = pt(0.3 + (hash(seed + 66, i) % 150) / 100, 0.3 + (hash(seed + 67, i) % 250) / 100, FZ + 5); P.px(p[0], p[1], i & 1 ? OAK[3] : BARK[2]); P.px(p[0] + 1, p[1], OAK[1]); }   // leaves and twigs adrift
      for (let i = 0; i < 6; i++) { const p = pt(0.5 + (hash(seed + 68, i) % 120) / 100, 0.5 + (hash(seed + 69, i) % 220) / 100, FZ + 5); P.hline(p[0] - 1, p[1], 3, FW[4]); }
      { const fp = pt(RX + 0.18, 1.0, FZ + 5); for (let i = 0; i < 16; i++) P.px(fp[0] - 9 + (hash(seed + 70, i) % 19), fp[1] + (hash(seed + 71, i) % 5) - 2, i & 1 ? FOAM : WS[4]); }   // the falls keep pouring
    }

    // ---- 6. the oak canopy --------------------------------------------------------------------------------------------------------
    if (!front && site < 0) {
      const CW = 58, CH = 30, ox = tp[0] - 29, oy = tp[1] - 17 - 25, Q = offsetPen(P, ox, oy);
      const bottoms = M.canopy(Q, [[29, 14, 24, 10], [13, 18, 13, 8], [45, 18, 13, 8], [28, 7, 15, 6]], CW, CH, OAK, seed ^ 0x77, { cell: 4 });
      M.mossStrands(Q, bottoms, 6, seed, 3, 8, CH);
    }

    // ---- 7. what stands in front of Roux: the near side wall (+ keeper's gate), the viewing wall (+ glass), railings, piers ----------
    const WX = HAB.WALL_X, G0 = HAB.GLASS[0], G1 = HAB.GLASS[1], FW2 = rampOf('#7C9A92');
    const limeBox = (x0, y0, x1, y1, z1) => box(x0, y0, x1, y1, 0, z1, LIME[4], STONE[litX ? 3 : 1], STONE[litY ? 3 : 1]);
    const rail = (axis, c, a0, a1, skip) => {                               // purple iron posts every 0.25 tile with gold finials and two rails; damage removes posts and rail runs
      const n = Math.max(1, Math.round((a1 - a0) / 0.25)); let prev = null;
      for (let k = 0; k <= n; k++) {
        const a = a0 + (a1 - a0) * k / n; if (skip && skip(a)) { prev = null; continue; }
        const q = axis === 'Y' ? [c, a] : [a, c], gone = dmg && (hash(seed + 71, k + (axis === 'Y' ? 0 : 40)) % 5 === 0), p = pt(q[0], q[1], WZ);
        if (!gone) { P.vline(p[0], p[1] - 6, 7, PU[2]); P.px(p[0], p[1] - 7, (k & 1) ? GO[3] : PU[4]); if (night && (k & 3) === 0) { P.px(p[0], p[1] - 8, '#FFE0A0'); P.px(p[0] - 1, p[1] - 8, '#B58B3A'); P.px(p[0] + 1, p[1] - 8, '#B58B3A'); } }
        if (prev && !gone && !(dmg && hash(seed + 72, k) % 6 === 0)) { seg([prev[0], prev[1], WZ + 6], [q[0], q[1], WZ + 6], PU[3]); seg([prev[0], prev[1], WZ + 3], [q[0], q[1], WZ + 3], PU[1]); }
        prev = gone ? null : q;
      }
    };
    const built = site < 0, walls = site < 0 || site === 2;                 // construction stage 2 has the walls up but no railing, glass or gate yet
    // the near side wall (Y = 3, its outer face is the SW one in SE-front) with the keeper's gate
    if (walls) { face('Y', 3.0, 0, WX, 0, WZ, stoneAt(litY, 1));
      poly([[0, 2.9, WZ], [WX, 2.9, WZ], [WX, 3.0, WZ], [0, 3.0, WZ]], STONE[4]); seg([0, 3.0, WZ], [WX, 3.0, WZ], LIME[4]); }
    if (built) {
      rail('X', 2.93, 0.06, 1.9, (a) => a > 0.86 && a < 1.5);
      face('Y', 3.0, 0.97, 1.4, 0, 10, (px, py, s, z) => ((z === 9 || z === 0 || z === 5 || (px & 1) === 0) ? IRON[litY ? 3 : 2] : '#1B1424'));
      { const lk = pt(1.19, 3.0, 4); P.px(lk[0], lk[1] - 1, GO[3]); P.px(lk[0] + 1, lk[1] - 1, GO[1]); P.px(lk[0], lk[1], GO[1]); }
      limeBox(0.91, 2.88, 0.99, 3.0, 12); limeBox(1.38, 2.88, 1.46, 3.0, 12);
    }
    // the viewing wall (X = 2.08 outer face; its +X face is the shadow one in SE-front), railing, glass panel
    if (walls) { face('X', WX, 0, 3.0, 0, WZ, stoneAt(litX, 2));
      poly([[1.98, 0, WZ], [WX, 0, WZ], [WX, 3.0, WZ], [1.98, 3.0, WZ]], STONE[4]); seg([WX, 0, WZ], [WX, 3.0, WZ], LIME[4]); }
    if (built) rail('Y', 2.0, 0.22, 2.78, (a) => a > G0 - 0.12 && a < G1 + 0.12);
    if (built) { const gz0 = WZ + 1, gz1 = WZ + 12, panes = [[G0, 1.5], [1.5, G1]];
      for (let i = 0; i < 2; i++) {
        face('X', 2.0, panes[i][0], panes[i][1], gz0, gz1, (px, py, s, z, top) => {
          if (board) return (top || z === gz0 || ((z - gz0) % 4) === 3) ? shade(X.plywood, 0.8) : (((px + z) % 9) === 0 ? shade(X.plywood, 0.9) : X.plywood);
          const q = (px + z + i * 5 + 40) % 15;
          if (q < 2) return '#EAF8FF';                                                                       // long diagonal sheens, two to a pane
          if (q === 2) return '#B9DDF0';
          if (night && z < gz0 + 5 && ((px + z) & 1) === 0 && hash(seed, px) % 3 === 0) return '#FFD27A';  // lamp reflections
          return (z === gz0 || top) ? GLASS[3] : ((((px >> 1) + z) & 3) === 0 ? GLASS[2] : null);
        });
      }
      for (const y of [G0, 1.5, G1]) { const p = pt(2.0, y, WZ); P.vline(p[0], p[1] - 12, 13, IRON[3]); P.vline(p[0] + 1, p[1] - 12, 13, IRON[1]); P.px(p[0], p[1] - 13, GO[3]); P.px(p[0] + 1, p[1] - 13, GO[1]); }
      seg([2.0, G0, gz1], [2.0, G1, gz1], IRON[3]); seg([2.0, G0, gz1 - 1], [2.0, G1, gz1 - 1], IRON[1]);
      if (board) for (const y of [0.95, 1.35, 1.75, 2.1]) { const p = pt(2.0, y, WZ + 6); P.px(p[0], p[1], X.nail); }
      if (dmg && !board) for (const [dy, dz] of [[-0.3, 4], [0.25, 5], [0.35, -2], [-0.2, -4], [0.05, 5], [-0.4, -1]]) seg([2.0, 1.2, WZ + 7], [2.0, 1.2 + dy, WZ + 7 + dz], '#EAF8FF'); }
    if (flood) {                                                                                             // the pool has spilled: water pours over the wall's notch and runs down its face
      const pa = pt(WX, 0.42, WZ), pb = pt(WX, 0.84, WZ), lo = Math.min(pa[0], pb[0]), hi = Math.max(pa[0], pb[0]);
      for (let x = lo; x < hi; x++) { const s = (x - pa[0]) / (pb[0] - pa[0]), yb = Math.round(pa[1] + (pb[1] - pa[1]) * s); for (let z = 0; z < WZ + 1; z++) { const k = hash(seed + 91, x * 3 + (z >> 1)) % 6; P.px(x, yb - z - 1, k < 2 ? FOAM : (k < 4 ? WS[4] : WS[3])); } }
      face('X', WX, 0, 3.0, 0, 3, (px, py, s, z) => (hash(seed + 92, px) % 5 < 3 ? mix(STONE[1], '#4A3B2A', 0.55) : null));   // the mud line
    }
    if (walls) { limeBox(1.94, 0, 2.14, 0.14, 11); limeBox(1.94, 2.86, 2.14, 3.0, 11); }
    if (night && built) for (const [lx, ly] of [[2.0, 0.1], [2.0, 2.9]]) { const p = pt(lx, ly, 12); P.px(p[0], p[1], '#FFE0A0'); P.px(p[0] - 1, p[1], '#B58B3A'); P.px(p[0] + 1, p[1], '#B58B3A'); P.px(p[0], p[1] - 1, '#B58B3A'); }

    // ---- 7b. the building site (layer 2): survey lines and stakes → footings and the lined pit → walls up in scaffolding -------------
    if (site >= 0) {
      const ORG = '#E07020', LINE = '#F4EFE0', ST = MAT.steel, CO = MAT.concrete;
      if (site === 0) {
        for (const [a, b] of [[[HAB.FX0, HAB.FY0], [HAB.FX1, HAB.FY0]], [[HAB.FX1, HAB.FY0], [HAB.FX1, HAB.FY1]], [[HAB.FX1, HAB.FY1], [HAB.FX0, HAB.FY1]], [[HAB.FX0, HAB.FY1], [HAB.FX0, HAB.FY0]], [[2.0, 0.1], [2.0, 2.9]], [[2.9, 0.1], [2.9, 2.9]]]) seg(a, b, LINE);
        for (const [lx, ly] of [[HAB.FX0, HAB.FY0], [HAB.FX1, HAB.FY0], [HAB.FX1, HAB.FY1], [HAB.FX0, HAB.FY1], [2.0, 0.1], [2.0, 2.9], [2.9, 0.1], [2.9, 2.9], [1.0, 1.5]]) { const p = pt(lx, ly, 0); P.vline(p[0], p[1] - 5, 5, WOOD[2]); P.px(p[0], p[1] - 6, ORG); P.px(p[0] + 1, p[1] - 5, ORG); }
        { const p = pt(2.5, 0.5, 0); P.rect(p[0] - 5, p[1] - 3, 10, 3, ROCK[2]); P.hline(p[0] - 4, p[1] - 4, 7, ROCK[3]); P.rect(p[0] + 6, p[1] - 2, 4, 2, ROCK[1]); P.rect(p[0] - 9, p[1] - 1, 4, 2, ROCK[1]); }
      } else if (site === 1) {
        for (const [a, b] of [[[HAB.FX0, HAB.FY0], [HAB.FX1 + 0.14, HAB.FY0]], [[HAB.FX1, HAB.FY0], [HAB.FX1, HAB.FY1]], [[HAB.FX0, HAB.FY1], [HAB.FX1 + 0.14, HAB.FY1]]]) { seg([a[0], a[1], FZ], [b[0], b[1], FZ], CO[3]); seg([a[0], a[1] + 0.03, FZ], [b[0], b[1] + 0.03, FZ], CO[1]); }
        face('X', RX, 0, 3.0, FZ, FZ + 4, (px, py, s, z) => DIRT[(z & 1) ? 1 : 2]); face('Y', HAB.FY0, HAB.FX0, HAB.FX1, FZ, FZ + 4, (px, py, s, z) => DIRT[litY ? ((z & 1) ? 2 : 3) : 1]);   // the pit's walls
        for (let i = 0; i < 9; i++) { const p = pt(1.94 + (i & 1) * 0.1, 0.2 + i * 0.32, FZ + 1); P.vline(p[0], p[1] - 5, 5, ST[1]); P.px(p[0], p[1] - 6, ORG); }   // rebar along the wall footing
        { const p = pt(2.5, 2.4, 0); P.rect(p[0] - 5, p[1] - 4, 10, 4, rampOf(XB.brick)[2]); P.hline(p[0] - 5, p[1] - 4, 10, rampOf(XB.brick)[3]); P.rect(p[0] - 11, p[1] - 1, 5, 2, WOOD[2]); }   // a pallet of brick
      } else {
        for (const y of [0.1, 0.9, 1.7, 2.5]) { const a = pt(2.12, y, 0), t = a[1] - 15; P.vline(a[0], t, 16, ST[2]); P.vline(a[0] + 1, t, 16, ST[1]); P.hline(a[0] - 1, t - 1, 3, ST[4]); }
        for (const z of [6, 11]) seg([2.12, 0.1, z], [2.12, 2.5, z], ST[3]);
        for (const [a, b] of [[[2.12, 0.1, 0], [2.12, 0.9, 11]], [[2.12, 0.9, 0], [2.12, 1.7, 11]], [[2.12, 1.7, 0], [2.12, 2.5, 11]]]) seg(a, b, ST[1]);
        for (let i = 0; i < 4; i++) { const p = pt(2.12, 0.5 + i * 0.6, 11); P.hline(p[0] - 3, p[1], 7, WOOD[3]); P.hline(p[0] - 3, p[1] + 1, 7, WOOD[1]); }   // the work deck
        { const p = pt(2.7, 1.5, 0); P.rect(p[0] - 6, p[1] - 3, 12, 3, WOOD[2]); P.hline(p[0] - 6, p[1] - 3, 12, WOOD[3]); P.rect(p[0] - 5, p[1] - 6, 10, 3, rampOf(XB.brick)[2]); P.hline(p[0] - 5, p[1] - 6, 10, rampOf(XB.brick)[3]); }   // lumber and a pallet of brick
      }
    }

    // ---- 8. plaza furniture: two benches facing the enclosure, two lamps; damage and flood dress the plaza too ---------------------
    if (!front && site < 0) {
      if (flood) {                                                                                           // the spill spreads over the paving
        region(2.0, 0, 3.0, 3.0, 0, (px, py, lx, ly) => {
          const d = Math.hypot((lx - 2.0) * 1.0, (ly - 0.65) * 0.62), n = noiseAt(px, py, seed + 63), f = 1.12 - d * 0.78 + (n - 0.5) * 0.5;
          if (f < 0.3) return;
          const t = toneAt(n, px, py, [0.15, 0.4, 0.7, 0.9], 0.12), edge = f < 0.38;
          P.px(px, py, edge ? FW2[4] : FW2[clampT(t)]);
          if (!edge && hash(seed + 64, px * 5 + (py >> 1)) % 53 === 0 && (py & 1)) P.hline(px, py, 2, FW2[4]);
        });
      }
      const bench = (y0, y1) => {
        for (const yy of [y0 + 0.03, y1 - 0.09]) box(2.42, yy, 2.58, yy + 0.06, 0, 3, IRON[2], IRON[1], IRON[2]);
        box(2.4, y0, 2.6, y1, 3, 5, WOOD[3], WOOD[litX ? 2 : 1], WOOD[litY ? 2 : 1]);
        box(2.6, y0, 2.66, y1, 5, 10, WOOD[3], WOOD[litX ? 2 : 1], WOOD[litY ? 2 : 1]);
        for (let i = 1; i < 4; i++) { const p = pt(2.66, y0 + (y1 - y0) * i / 4, 7); P.px(p[0], p[1], WOOD[0]); }
      };
      bench(0.12, 0.54); bench(2.46, 2.88);
      for (const ly of [0.2, 2.8]) { const p = pt(2.9, ly, 0); lampPost(P, p[0], p[1], night, BRICK[2]); }
      if (dmg) {                                                                                             // a fallen limb across the plaza edge and leaf litter
        seg([2.2, 2.4, 0], [2.85, 1.95, 0], BARK[2]); seg([2.2, 2.42, 1], [2.85, 1.97, 1], BARK[3]); seg([2.5, 2.2, 1], [2.58, 2.0, 5], BARK[2]);
        for (let i = 0; i < 9; i++) { const p = pt(2.2 + (hash(seed + 95, i) % 70) / 100, 1.7 + (hash(seed + 96, i) % 70) / 100, 0); P.px(p[0], p[1], OAK[(i & 1) ? 3 : 2]); P.px(p[0] + 1, p[1], OAK[1]); }
      }
    }
    // the same limb's twin on the enclosure floor, and torn leaves under the tree
    if (dmg && !front) { seg([1.0, 0.95, 0], [1.5, 0.9, 1], BARK[1]); for (let i = 0; i < 8; i++) { const p = pt(0.8 + (hash(seed + 97, i) % 60) / 100, 0.6 + (hash(seed + 98, i) % 60) / 100, FZ); P.px(p[0], p[1], OAK[(i & 1) ? 3 : 2]); } }
  }

  // ---------------------------------------------------------------------------
  // Housing tiers (PLAN_V2 P7): the Bayou Bunkhouse (economy) and Magnolia Suites (premium). Both paint sub-boxes inside the
  // footprint. subBox() re-derives buildingBox's box fields (bl/br/bw/bh/bk/bx/by/bcx/bcy/bgcy) for a rectangle
  // [X0,X1]×[Y0,Y1] in footprint px (X runs down-right, Y runs down-left, origin = the back corner; the SW face is the
  // Y = Y1 side, the SE face the X = X1 side), so drawBox / drawWindows / the roof library work on any rectangle unchanged.
  // ---------------------------------------------------------------------------
  function subBox(g, X0, X1, Y0, Y1, floors, roofH) {
    const bl = X1 - X0, br = Y1 - Y0, bw = bl + br, bh = bw >> 1, bk = (bl - br) >> 1;
    const p = fpPt(g, X1 / 32, Y1 / 32, 0), byv = p[1] + g.lift, bx = p[0];
    const s = Object.assign({}, g);
    s.X0 = X0; s.X1 = X1; s.Y0 = Y0; s.Y1 = Y1; s.root = g.root || g;   // root = the whole-footprint geometry facePt measures from
    s.bl = bl; s.br = br; s.bw = bw; s.bh = bh; s.bk = bk; s.bx = bx; s.by = byv - g.lift;
    s.bcx = bx - bk; s.bcy = byv - (bh >> 1) - g.lift; s.bgcy = byv - (bh >> 1);
    s.floors = floors; s.wallH = floors * FLOOR_PX; s.roofH = roofH;
    s.fw = bl / 32; s.fh = br / 32;   // the roof library reads only their ratio (ridge direction)
    s.windowCells = []; s.roofGeom = null;
    return s;
  }
  /** screen point on a sub-box's face (0 = SW, 1 = SE) at parameter t along it, `up` px above the ground and `out` px out from the wall */
  function facePt(b, face, t, up, out) {
    const o = out || 0;
    return fpPt(b.root, (face === 0 ? b.X0 + t * (b.X1 - b.X0) : b.X1 + o) / 32, (face === 0 ? b.Y1 + o : b.Y0 + t * (b.Y1 - b.Y0)) / 32, up || 0);
  }
  /** a row of vertical 1-px balusters / posts along the segment c0 → c1 (screen points), every `step` px, `h` tall rising from the segment */
  function pickets(P, c0, c1, step, h, color) {
    const xa = Math.min(c0[0], c1[0]), xb = Math.max(c0[0], c1[0]), dx = c1[0] - c0[0];
    for (let x = xa; x <= xb; x += step) { const y = dx ? c0[1] + (c1[1] - c0[1]) * (x - c0[0]) / dx : c0[1]; P.vline(x, Math.round(y) - h, h, color); }
  }
  /** window cells of several boxes, merged on the main g (BOARDED / DAMAGED read g.windowCells) */
  function mergeCells(g, boxes) { g.windowCells = []; for (const b of boxes) for (const c of (b.windowCells || [])) g.windowCells.push(c); }
  /** a car on the ground at (x, y) = the centre of its footprint: body, cabin, windscreen, wheels; headlights at night */
  function drawCar(P, x, y, color, night) {
    const B = rampOf(color);
    P.rect(x - 4, y - 3, 9, 3, B[2]); P.hline(x - 4, y - 3, 9, B[3]); P.hline(x - 4, y - 1, 9, B[1]);
    P.rect(x - 2, y - 5, 5, 2, B[3]); P.hline(x - 1, y - 5, 3, B[4]); P.hline(x - 2, y - 4, 5, X.glass); P.px(x + 3, y - 4, B[1]);
    P.px(x - 3, y, X.black); P.px(x - 2, y, X.black); P.px(x + 2, y, X.black); P.px(x + 3, y, X.black);
    P.px(x - 4, y - 2, night ? PAL.windowGlow : X.offWhite); P.px(x + 4, y - 2, night ? PAL.windowGlow : PAL.danger);
    if (night) { P.px(x - 5, y - 2, mix(PAL.windowGlow, '#3A3A40', 0.5)); P.px(x - 6, y - 1, mix(PAL.windowGlow, '#3A3A40', 0.7)); }
  }
  /** a southern magnolia standing at ground point (x, y): bark trunk, dark glossy canopy in layers, cream blossoms */
  function drawMagnolia(P, x, y, seed, night) {
    const G = MAT.green, Bk = rampOf(PAL.bark);
    P.ellipse(x + 1, y + 1, 11, 4, mix(XB.lawn, '#2B2550', 0.35));   // cool ground shadow
    P.rect(x - 1, y - 8, 3, 8, Bk[2]); P.vline(x - 1, y - 8, 8, Bk[3]); P.vline(x + 1, y - 8, 8, Bk[1]); P.hline(x - 2, y - 1, 5, Bk[1]);
    P.ellipse(x, y - 14, 12, 8, G[0]); P.ellipse(x, y - 15, 11, 7, G[1]); P.ellipse(x - 1, y - 17, 9, 6, G[2]); P.ellipse(x - 3, y - 19, 5, 3, G[3]);
    for (let i = 0; i < 14; i++) { const a = hash(seed, i * 3) % 360 * Math.PI / 180, r = 3 + hash(seed, i * 3 + 1) % 8; P.px(Math.round(x + Math.cos(a) * r * 1.2), Math.round(y - 16 + Math.sin(a) * r * 0.7), i & 1 ? G[3] : G[1]); }
    const BL = night ? '#E8E0C4' : '#FFF8E6';
    for (let i = 0; i < 6; i++) { const bx = x - 8 + (hash(seed, 40 + i) % 17), by = y - 22 + (hash(seed, 50 + i) % 11); P.rect(bx, by, 2, 2, BL); P.px(bx, by, X.white); P.px(bx + 1, by + 1, '#E9C95A'); }
  }

  // The Bayou Bunkhouse: two long tin-roofed rows under one M-shaped roof, plank siding, a breezeway (dogtrot opening) through the long face,
  // a shared porch with a tin awning along it, a sandy yard with a clothesline.
  function bunkRoofs(P, g, color) {
    const X0 = g.ipx, X1 = g.fw * 32 - g.ipx, Y0 = g.ipy, Y1 = g.fh * 32 - g.ipy, longX = g.fw >= g.fh;
    const D = longX ? Y1 - Y0 : X1 - X0, back = ((D >> 1) + 3) & ~3, RH = 11;
    const rowA = longX ? subBox(g, X0, X1, Y0, Y0 + back, 1, RH) : subBox(g, X0, X0 + back, Y0, Y1, 1, RH);   // the back row
    const rowB = longX ? subBox(g, X0, X1, Y0 + back, Y1, 1, RH) : subBox(g, X0 + back, X1, Y0, Y1, 1, RH);   // the front row
    ROOF.gable(P, rowA, color); ROOF.gable(P, rowB, color);
    g.roofGeom = rowB.roofGeom;
    // rust: a few weathered patches on the long planes
    const R = '#8A5A3A';
    for (const rb of [rowA, rowB]) {
      const pl = frontPlane(rb.roofGeom); if (!pl) continue;
      for (let i = 0; i < 7; i++) { const c = planePt(pl, 0.06 + (hash(g.seed, i * 7 + rb.Y0) % 88) / 100, 0.12 + (hash(g.seed, i * 11 + 3) % 70) / 100); P.rect(Math.round(c[0]), Math.round(c[1]), 2, 1, i & 1 ? R : mix(R, '#B8B8BC', 0.4)); }
    }
    return { rowA: rowA, rowB: rowB, X0: X0, X1: X1, Y0: Y0, Y1: Y1, longX: longX };
  }
  /** the dogtrot opening: a 12-px gap in the wall of the long face, dark inside, daylight showing through from the yard behind */
  function breezeway(P, g, face, night) {
    const len = face === 0 ? g.bl : g.br, w = 12, xs = face === 0 ? g.bcx + (g.bk | 0) - g.bl + ((len - w) >> 1) : g.bcx + (g.bk | 0) + ((len - w) >> 1), C = g.colors;
    const wall = face === 0 ? C.left : C.right, dark = mix(wall, '#1B1730', 0.78), mid = mix(wall, '#1B1730', 0.55);
    for (let i = 0; i < w; i++) {
      const x = xs + i, yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x, g.bk | 0), edge = i === 0 || i === w - 1;
      P.rect(x, yb - 9, 1, 10, edge ? shade(C.RL[1], 0.8) : dark);
      if (!edge) {
        P.px(x, yb - 9, shade(dark, 0.7));
        if (i > 3 && i < w - 4) { for (let r = 3; r <= 6; r++) P.px(x, yb - r, night ? mix(GLOWS[0], dark, 0.5) : mix('#C9D6A4', mid, 0.25 + (6 - r) * 0.1)); P.px(x, yb - 1, night ? mix(GLOWS[2], dark, 0.5) : mix('#9CB070', dark, 0.4)); }   // daylight from the yard behind, a small hazy patch
        else for (let r = 2; r <= 6; r++) P.px(x, yb - r, mid);
      }
    }
    for (let i = 0; i < w; i++) { const x = xs + i, yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x, g.bk | 0); P.px(x, yb - 10, face === 0 ? C.trim[3] : C.trim[2]); }
    // the cypress door frame posts and a sill step
    for (const i of [0, w - 1]) { const x = xs + i, yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x, g.bk | 0); P.vline(x, yb - 10, 11, face === 0 ? MAT.wood[3] : MAT.wood[2]); }
    for (let i = 1; i < w - 1; i++) { const x = xs + i, yb = baseY(g.bcx, g.bcy, g.bw, g.bh, x, g.bk | 0); P.px(x, yb + 1, MAT.concrete[2]); }
    return { x0: xs, x1: xs + w };
  }
  /** the shared porch along the long face: a plank deck 6 px deep, cypress posts every 12 px under a level tin awning 4 px deep (it stays above the windows) */
  function bunkPorch(P, g, face, night) {
    const W = MAT.wood, T = MAT.tin, D = 6, A = 4, H = 13, len = face === 0 ? g.bl : g.br, left = face === 0;
    fillPoly(P, [facePt(g, face, 0, 0, 0), facePt(g, face, 1, 0, 0), facePt(g, face, 1, 0, D), facePt(g, face, 0, 0, D)], left ? W[3] : W[2]);
    for (let s = 2; s < D; s += 2) { const a = facePt(g, face, 0, 0, s), b = facePt(g, face, 1, 0, s); P.line(a[0], a[1], b[0], b[1], left ? W[2] : W[1]); }
    { const a = facePt(g, face, 0, 0, D), b = facePt(g, face, 1, 0, D); P.line(a[0], a[1] + 1, b[0], b[1] + 1, W[0]); }
    // posts at the awning's outer edge (drawn first: the awning is above them)
    for (let i = 4; i <= len - 3; i += 12) {
      const a = facePt(g, face, i / len, 0, A), b = facePt(g, face, i / len, H, A);
      P.vline(a[0], b[1], a[1] - b[1] + 1, left ? W[4] : W[3]); P.px(a[0], a[1] + 1, W[0]);
    }
    fillPoly(P, [facePt(g, face, 0, H, 0), facePt(g, face, 1, H, 0), facePt(g, face, 1, H, A), facePt(g, face, 0, H, A)], left ? T[3] : T[2]);
    for (let i = 8; i < len; i += 8) { const a = facePt(g, face, i / len, H, 0), b = facePt(g, face, i / len, H, A); P.line(a[0], a[1], b[0], b[1], left ? T[2] : T[1]); }
    { const a = facePt(g, face, 0, H, A), b = facePt(g, face, 1, H, A); P.line(a[0], a[1], b[0], b[1], T[4]); P.line(a[0], a[1] + 1, b[0], b[1] + 1, T[0]); }
    if (night) { for (let i = 10; i < len; i += 24) { const a = facePt(g, face, i / len, 8, A); P.px(a[0], a[1], GLOWS[0]); P.px(a[0], a[1] + 1, mix(GLOWS[0], W[2], 0.5)); } }   // porch bulbs
  }
  /** a clothesline in the yard beside the short end: two posts, a sagging line and four garments */
  function drawClothesline(P, g, longX, night) {
    const face = longX ? 1 : 0, o = 8;
    const pt = (t, up) => facePt(g, face, t, up, o);
    const a = pt(0.04, 0), b = pt(0.38, 0), ta = pt(0.04, 11), tb = pt(0.38, 11), W = MAT.wood;
    P.vline(a[0], ta[1], 11, W[3]); P.vline(b[0], tb[1], 11, W[3]); P.px(a[0], a[1], W[0]); P.px(b[0], b[1], W[0]);
    P.hline(ta[0] - 1, ta[1], 3, W[4]); P.hline(tb[0] - 1, tb[1], 3, W[4]);
    const xs = Math.min(ta[0], tb[0]), xe = Math.max(ta[0], tb[0]);
    const lineY = (x) => { const t = (x - ta[0]) / (tb[0] - ta[0] || 1); return Math.round(ta[1] + (tb[1] - ta[1]) * t + Math.sin(t * Math.PI) * 2); };
    for (let x = xs; x <= xe; x++) P.px(x, lineY(x), '#D8D8E0');
    const cols = [X.white, PAL.gold, PAL.purple2, '#6FA8D8', X.offWhite, '#E07A5A'];
    for (let i = 0; i < 4; i++) {
      const x = xs + 3 + Math.round((xe - xs - 9) * i / 3), y = lineY(x), c = cols[(hash(g.seed, i * 5) % cols.length)], tall = 2 + (hash(g.seed, i) % 3);
      P.rect(x, y + 1, 4, tall + 1, c); P.px(x, y + 1, shade(c, 1.15)); P.px(x + 3, y + tall + 1, shade(c, 0.75));
    }
  }

  // Magnolia Suites: an L of brick wings with two-level iron galleries around a brick courtyard (a magnolia in a lawn bed, hedges
  // from the margins), and a small asphalt parking apron with six cars on the back-right edge of the footprint.
  /** a two-level gallery on one face of a wing, between t0 and t1: ivory slabs, iron rails with balusters, slender iron posts to the ground */
  /** the two wings of the L (footprint px): the back wing along X, the left wing along Y in front of it */
  function suiteWings(g) { return [subBox(g, 12, 64, 12, 38, 3, 12), subBox(g, 12, 36, 38, 84, 3, 12)]; }
  function suiteGallery(P, b, face, t0, t1, night) {
    const T = (b.colors || faceColors(b.paint)).trim, I = MAT.iron, left = face === 0, d = 4, levels = b.floors - 1;
    for (let l = 1; l <= levels; l++) {
      const h = l * FLOOR_PX;
      const a0 = facePt(b, face, t0, h, 0), a1 = facePt(b, face, t1, h, 0), c0 = facePt(b, face, t0, h, d), c1 = facePt(b, face, t1, h, d);
      fillPoly(P, [a0, a1, c1, c0], left ? T[2] : T[1]);
      P.line(c0[0], c0[1], c1[0], c1[1], left ? T[4] : T[2]); P.line(c0[0], c0[1] + 1, c1[0], c1[1] + 1, left ? T[1] : T[0]);
      const r0 = [c0[0], c0[1] - 4], r1 = [c1[0], c1[1] - 4];
      P.line(r0[0], r0[1], r1[0], r1[1], left ? I[3] : I[2]);
      pickets(P, c0, c1, 3, 3, left ? I[2] : I[1]);
      if (night && l === 1) { const m = facePt(b, face, (t0 + t1) / 2, h + 8, d); P.px(m[0], m[1], GLOWS[0]); }
    }
    // posts: every 12 px from the ground to the top rail
    const top = levels * FLOOR_PX + 4, g0 = facePt(b, face, t0, 0, d), g1 = facePt(b, face, t1, 0, d), dx = g1[0] - g0[0], xa = Math.min(g0[0], g1[0]), xb = Math.max(g0[0], g1[0]);
    for (let x = xa + 2; x <= xb - 1; x += 12) { const y = dx ? g0[1] + (g1[1] - g0[1]) * (x - g0[0]) / dx : g0[1]; P.vline(x, Math.round(y) - top, top + 1, left ? I[3] : I[2]); P.px(x, Math.round(y), I[0]); }
  }
  /** the wing's windows: tall shuttered cells per face (cols = [SW face, SE face]); returns the cells */
  function wingWindows(P, w, row, cols, night, frame) {
    const r = { n: row.n, paint: Object.assign({}, row.paint, { windows: { cols: Math.max(cols[0], cols[1]), rows: 3 } }) };
    return drawWindows(P, w, r, { night: night, frame: frame, cols: cols, noDoor: true });
  }
  function suitesGround(P, g, night) {
    const q = (X, Y) => [X / 32, Y / 32];
    const L = (a, b, c) => fpLine(P, g, q(a[0], a[1]), q(b[0], b[1]), c);
    // parking apron (back-right corner of the footprint): asphalt, kerbs, bay lines
    const PX0 = 66, PX1 = 92, PY0 = 8, PY1 = 38, asph = '#3A3A40';
    fpPoly(P, g, [q(PX0, PY0), q(PX1, PY0), q(PX1, PY1), q(PX0, PY1)], asph);
    L([PX0, PY1], [PX1, PY1], shade(asph, 0.62)); L([PX1, PY1], [PX1, PY0], shade(asph, 0.62));
    L([PX0, PY0], [PX0, PY1], shade(asph, 1.45)); L([PX0, PY0], [PX1, PY0], shade(asph, 1.3));
    for (const Y of [18, 28]) L([PX0 + 1, Y], [PX1 - 1, Y], shade(asph, 1.6));
    L([79, PY0 + 1], [79, PY1 - 1], shade(asph, 1.25));
    // the courtyard: sandstone pavers in a running bond, a brick edge on the open sides, a round lawn bed for the magnolia
    const CX0 = 36, CX1 = 86, CY0 = 38, CY1 = 90, pave = '#CDB894', joint = mix(pave, '#6B5A44', 0.22), brk = XB.brick;
    fpPoly(P, g, [q(CX0, CY0), q(CX1, CY0), q(CX1, CY1), q(CX0, CY1)], pave);
    for (let v = CX0 + 6; v < CX1; v += 6) L([v, CY0 + 1], [v, CY1 - 1], joint);
    for (let v = CY0 + 6, r = 0; v < CY1; v += 6, r++) L([CX0 + 1 + (r & 1) * 3, v], [CX1 - 1, v], joint);
    L([CX0, CY1], [CX1, CY1], brk); L([CX1, CY1], [CX1, CY0], brk); L([CX0, CY1 - 1], [CX1 - 1, CY1 - 1], shade(brk, 1.25)); L([CX1 - 1, CY1 - 1], [CX1 - 1, CY0], shade(brk, 1.25));
    const bc = fpPt(g, 58 / 32, 64 / 32, 0);
    P.ellipse(bc[0], bc[1] + 1, 14, 7, shade(brk, 1.05)); P.ellipse(bc[0], bc[1], 13, 6, shade(XB.lawn, 0.8)); P.ellipse(bc[0], bc[1] - 1, 12, 5, XB.lawn); P.ellipse(bc[0] - 2, bc[1] - 2, 7, 2, XB.lawnStripe);
    void night;
  }

  const SPECIAL = {
    tiger_habitat(ctx, P, g, row, variant, frame) { habitatPaint(ctx, P, g, row, variant, frame, 0); },
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
    },
    bunkhouse(ctx, P, g, row, variant, frame) {
      const paint = row.paint || {}, night = !!(variant & SPR.NIGHT), longX = g.fw >= g.fh, face = longX ? 0 : 1;
      g.colors = drawBox(P, g, paint, { seed: g.seed });
      const box = subBox(g, g.ipx, g.fw * 32 - g.ipx, g.ipy, g.fh * 32 - g.ipy, 1, g.roofH);
      box.colors = g.colors;
      drawWindows(P, g, row, { night: night, frame: frame, cols: longX ? [5, 2] : [2, 5] });
      const cells = g.windowCells;
      const entranceIsLong = (g.frontLeft ? 0 : 1) === face;
      if (!entranceIsLong) drawDoor(P, g, PAL.purple, false, night);   // the short end carries the door; on the long face the breezeway is the entrance
      const bz = breezeway(P, box, face, night);
      g.windowCells = cells.filter((c) => c.face !== face || c.x + c.w < bz.x0 - 1 || c.x > bz.x1 + 1);
      if (entranceIsLong) { g.doorX = (bz.x0 + bz.x1) >> 1; g.doorY = baseY(g.bcx, g.bcy, g.bw, g.bh, g.doorX, g.bk | 0); }
      bunkPorch(P, box, face, night);
      bunkRoofs(P, g, paint.roofColor || '#9AA3AC');
      drawKnownDecals(ctx, P, g, row, variant, frame);
      if (!(variant & SPR.PILINGS)) drawClothesline(P, box, longX, night);   // no yard on stilts
    },
    suites(ctx, P, g, row, variant, frame) {
      const paint = row.paint || {}, night = !!(variant & SPR.NIGHT), roofColor = paint.roofColor || '#4C5566';
      g.colors = faceColors(paint);
      const stilts = !!(variant & SPR.PILINGS);
      if (!stilts) suitesGround(P, g, night);   // on stilts the courtyard, apron and tree give way to water
      const wings = suiteWings(g), back = wings[0], left = wings[1];
      back.colors = g.colors; left.colors = g.colors;
      // back wing (along X), then the left wing (along Y) in front of it
      drawBox(P, back, paint, { seed: g.seed, colors: g.colors });
      wingWindows(P, back, row, [5, 3], night, frame);
      suiteGallery(P, back, 0, 0.46, 1, night); suiteGallery(P, back, 1, 0, 1, night);
      ROOF.hip(P, back, roofColor);
      drawBox(P, left, paint, { seed: g.seed + 5, colors: g.colors });
      wingWindows(P, left, row, [2, 4], night, frame);
      suiteGallery(P, left, 0, 0, 1, night); suiteGallery(P, left, 1, 0, 1, night);
      // the front door on the courtyard face of the left wing: green leaf, ivory surround, a fanlight
      { const t = 0.5, p = facePt(left, 1, t, 0, 0), x = p[0] - 2, yb = baseY(left.bcx, left.bcy, left.bw, left.bh, p[0], left.bk | 0), D = rampOf(paint.accent || '#2E5C2A'), T = g.colors.trim;
        P.rect(x, yb - 6, 5, 7, D[2]); P.vline(x + 2, yb - 6, 7, D[1]); P.hline(x - 1, yb - 8, 7, T[3]); P.vline(x - 1, yb - 8, 9, T[2]); P.vline(x + 5, yb - 8, 9, T[1]);
        P.hline(x, yb - 7, 5, night ? GLOWS[0] : MAT.glass[3]); P.px(x + 3, yb - 3, PAL.gold); }
      ROOF.hip(P, left, roofColor);
      g.roofGeom = left.roofGeom;
      mergeCells(g, [back, left]);
      // the entrance anchor for the margin walk: the centre of the inset box's entrance face (the walk crosses the courtyard paving)
      { const fcx = g.frontLeft ? g.bcx + (g.bk | 0) - (g.bl >> 1) : g.bcx + (g.bk | 0) + (g.br >> 1); g.doorX = fcx; g.doorY = baseY(g.bcx, g.bcy, g.bw, g.bh, fcx, g.bk | 0); }
      // parking: five cars in a six-bay apron, a light pole at its kerb
      const CARS = stilts ? [] : [['#C9CDD2', 72, 13], ['#2B2B33', 85, 13], ['#B03A3A', 72, 23], ['#E8E8E8', 85, 23], ['#3D6FA8', 85, 33], ['#8A6A3A', 72, 33]];
      for (let i = 0; i < CARS.length; i++) { if (i === 5 && (g.seed & 1)) continue; const p = fpPt(g, CARS[i][1] / 32, CARS[i][2] / 32, 0); drawCar(P, p[0], p[1], CARS[i][0], night); }
      if (!stilts) {
        { const p = fpPt(g, 66 / 32, 38 / 32, 0); lampPost(P, p[0], p[1], night, '#3A3A40'); }
        { const p = fpPt(g, 46 / 32, 78 / 32, 0); lampPost(P, p[0], p[1], night, '#CDB894'); }
        { const p = fpPt(g, 58 / 32, 64 / 32, 0); drawMagnolia(P, p[0], p[1], g.seed, night); }
      }
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
    if (g.special === 'suites') g.stiltBoxes = suiteWings(g);   // P7: stilts go under the wings, not the courtyard
    if (variant & SPR.PILINGS) drawPilingsGround(P, g, g.seed); else drawGrounds(P, g, row, variant, g.seed);
    if ((variant & SPR.PILINGS) && !(variant & SPR.SCAFFOLD)) drawStiltsBack(P, g);
    if (variant & SPR.SCAFFOLD) {
      if (g.special === 'tiger_habitat') habitatPaint(ctx, P, g, row, variant, frame, 2); else drawScaffoldStage(P, g, row, frame);   // habitat pass: its own three construction stages
    } else {
      const fn = SPECIAL[g.special];
      if (fn) fn(ctx, P, g, row, variant, frame); else drawStandardBox(ctx, P, g, row, variant, frame);
    }
    if ((variant & SPR.PILINGS) && !(variant & SPR.SCAFFOLD)) drawStilts(P, g);
    try { drawMargins(P, g, row, variant, frame); } catch (e) { BSU.error('sprites', 'margins:' + row.id, e); }
    if (OWN_STATES[g.special] && !(variant & SPR.SCAFFOLD)) return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };   // habitat pass: the special painted its own damage / boards / flood
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
  // `icon:<catalogId>` — art pass B6, the catalog icon (build-menu cards, quick-bar, inspector head, ghost fallback).
  // One composition for all 44 rows in a 64-unit frame, painted natively at zoom 1 (64×64) and zoom 2 (128×128, what the
  // UI uses: render.drawIcon downsizes it with smoothing to the element's device pixels). Variant bit 1 = the locked look
  // (greyscale + dim + a padlock). Every icon shares the camera (the game's 2:1 iso, SW face lit, entrance on it) and the
  // ground plane: a slab plate under the footprint (footprint rows) or a ground swatch (drag, paint and plant rows).
  //   · footprint rows  — the row's own sprite (FRONT_L: door/sign/arcade on the lit SW face) on a purple slab the size of
  //     its footprint + a margin; pilings stand on a water slab; stadium shows tier I.
  //   · drag rows       — a three-tile run (mask E+W: its SW side faces the viewer) of the very stamps the map's decks and
  //     paths are tuned against (`surf:1..5`, levee, floodwall, canal; the surge barrier is a gate between two wall tiles),
  //     on grass / marsh / water.
  //   · plant rows      — the mature tree (stage 2, silhouette 0; azalea in bloom) on a lawn disc.
  //   · preserve        — a 2×2 marsh patch with its gold boundary posts.
  // Scale: the true size would make a po'boy vanish beside the stadium, so the drawn extent follows extent^ICON_EXP
  // (0.22) between ICON_MIN and ICON_BOX, with plants and runs given their own target; the slab keeps the real tile
  // grid (a 1×1 row stands on one tile of slab, a dorm on 3×2), which is the scale badge. Sprites are blitted with
  // smoothing (they are scaled by a fraction); the frame, slab and padlock are integer pixel art on the pen.
  // ---------------------------------------------------------------------------
  const ICON_BOX = 60, ICON_MIN = 42, ICON_REF = 400, ICON_EXP = 0.22;
  const ICON_RUN = {
    path: { stamps: ['surf:1'], ground: 'grass' }, road: { stamps: ['surf:2'], ground: 'grass' },
    boardwalk: { deck: 'boardwalk', ground: 'marsh' }, bridge: { deck: 'bridge', ground: 'water' },
    gator_fence: { stamps: ['surf:4'], ground: 'grass' }, levee: { stamps: ['levee'], ground: 'grass' },
    floodwall: { stamps: ['floodwall'], ground: 'grass' }, canal: { stamps: ['canal'], ground: 'grass' },
    surge_barrier: { stamps: ['floodwall', 'surge_barrier', 'floodwall'], ground: 'grass' }
  };
  // slab tones: top [base, light, shadow], lit SW face, shadow SE face, lit rim
  const ICON_GROUND = {
    slab: { top: ['#4C3C73', '#5A4A83', '#42345F'], left: '#33264F', right: '#241A3A', rim: '#7C69AC' },
    grass: { top: ['#6E8F3C', '#8EAC50', '#4B5E32'], left: '#7A5A38', right: '#523D2F', rim: '#B1C866' },
    marsh: { top: ['#5A6B3A', '#7A884E', '#3E4830'], left: '#4C4530', right: '#36312A', rim: '#9EA664' },
    water: { top: ['#5A8A82', '#7FBBA3', '#44686A'], left: '#34595B', right: '#1F3A3E', rim: '#C4EBCB' }
  };
  const ICON_BG = ['#3E2F63', '#35285A', '#2C2150', '#241A45', '#1D1438'];     // frame backdrop, lit upper-left → shadow lower-right
  const ICON_RIM = ['#9A8038', '#7C6830', '#61522C'];                              // 1-px gold-tinted rim (upper-left lit → lower-right)
  const ICON_R = 8;                                                                // frame corner radius
  let iconRows = null;                                                             // frame inset per row (rounded corners)
  function iconFrameRows() {
    if (iconRows) return iconRows;
    iconRows = new Array(ICON);
    for (let y = 0; y < ICON; y++) {
      const d = y < ICON_R ? ICON_R - y - 0.5 : y >= ICON - ICON_R ? y - (ICON - ICON_R) + 0.5 : -1;
      iconRows[y] = d < 0 ? 0 : ICON_R - Math.round(Math.sqrt(Math.max(0, ICON_R * ICON_R - d * d)));
    }
    return iconRows;
  }
  function iconInside(x, y) { if (x < 0 || y < 0 || x >= ICON || y >= ICON) return false; const k = iconFrameRows()[y]; return x >= k && x < ICON - k; }
  /** the rounded backdrop: a Bayer-dithered 5-tone gradient lit from the upper left (frame rows are 1× px; the pen scales) */
  function iconBackdrop(P) {
    const rows = iconFrameRows();
    for (let y = 0; y < ICON; y++) {
      let x = rows[y], run = x, cur = -1;
      const end = ICON - rows[y];
      for (; x <= end; x++) {
        let k = -2;
        if (x < end) { const t = (y * 0.74 + x * 0.26) / 63; k = Math.max(0, Math.min(4, Math.floor(t * 4 + 0.5 + M.bayer(x, y) * 0.6))); }
        if (k !== cur) { if (cur >= 0 && x > run) P.rect(run, y, x - run, 1, ICON_BG[cur]); cur = k; run = x; }
      }
    }
  }
  function iconRim(P, locked) {
    for (let y = 0; y < ICON; y++) for (let x = 0; x < ICON; x++) {
      if (!iconInside(x, y)) continue;
      if (iconInside(x - 1, y) && iconInside(x + 1, y) && iconInside(x, y - 1) && iconInside(x, y + 1)) continue;
      const t = (x + y) / 126;
      P.px(x, y, locked ? (t < 0.5 ? '#6B6280' : '#4A4260') : ICON_RIM[t < 0.34 ? 0 : t < 0.66 ? 1 : 2]);
    }
  }
  /** convex polygon (float vertices, 1× px) → flat [y, x0, x1, …] integer row spans */
  function iconSpans(pts, dy) {
    let y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    const out = [];
    for (let y = Math.round(y0 + dy); y < Math.round(y1 + dy); y++) {
      const yc = y + 0.5 - dy; let l = Infinity, r = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) { const x = a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]); if (x < l) l = x; if (x > r) r = x; }
      }
      if (r > l) out.push(y, Math.round(l), Math.round(r));
    }
    return out;
  }
  /** a slab: the polygon's top face with a th-px thick side (SW face lit, SE face shadow), a lit rim on the upper-left edges and a speckled top */
  function iconSlab(P, pts, th, G, seed) {
    let bx = 0, by = -Infinity;
    for (const p of pts) if (p[1] > by) { by = p[1]; bx = p[0]; }
    const side = iconSpans(pts, th), cut = Math.round(bx);
    for (let i = 0; i < side.length; i += 3) {
      const y = side[i], a = side[i + 1], b = side[i + 2];
      if (a < cut) P.rect(a, y, Math.min(b, cut) - a, 1, G.left);
      if (b > cut) P.rect(Math.max(a, cut), y, b - Math.max(a, cut), 1, G.right);
    }
    const top = iconSpans(pts, 0);
    for (let i = 0; i < top.length; i += 3) {
      const y = top[i], a = top[i + 1], b = top[i + 2];
      P.rect(a, y, b - a, 1, G.top[0]);
      for (let x = a; x < b; x++) { const h = hash(seed, x * 131 + y * 7) % 100; if (h < 7) P.px(x, y, G.top[1]); else if (h > 95) P.px(x, y, G.top[2]); }
    }
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0] / pts.length; cy += p[1] / pts.length; }
    for (let i = 0; i < pts.length; i++) {   // lit rim along the upper edges: the upper-left one bright, the upper-right one in the base tone
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] + b[1]) / 2 >= cy - 0.5) continue;
      P.line(a[0], a[1], b[0], b[1], (a[0] + b[0]) / 2 < cx ? G.rim : G.top[1]);
    }
  }
  /** the footprint badge ("1×1") for rows drawn much larger than their true size: a dark chip with gold 3×5 digits, lower left */
  function iconBadge(P, str, x, y) {
    const w = str.length * 4 + 2;
    P.rect(x + 1, y, w - 2, 9, '#1A1230'); P.rect(x, y + 1, w, 7, '#1A1230');
    P.hline(x + 1, y, w - 2, '#6E5A2C'); P.hline(x + 1, y + 8, w - 2, '#6E5A2C'); P.vline(x, y + 1, 7, '#6E5A2C'); P.vline(x + w - 1, y + 1, 7, '#6E5A2C');
    P.text(str, x + 2, y + 2, '#FDD023');
  }
  function iconPadlock(P, x, y) {
    const g = ['..###..', '.#...#.', '.#...#.', '#######', '#######', '###.###', '#######', '#######'];
    for (let r = 0; r < g.length; r++) for (let c = 0; c < 7; c++) {
      if (g[r][c] !== '#') continue;
      P.px(x + c, y + r, r < 3 ? '#D8D2E8' : (r === 3 ? '#FFE680' : (r === 5 && c === 3 ? '#2B1246' : (c === 0 || r === 7 ? '#B58500' : '#F5B700'))));
    }
  }

  /** the boardwalk and the Pedestrian Bridge as the map draws them, three tiles on the plate (u along the run, v across it, tile units):
   *  stilts / piers, the deck slab with its lit SW side, plank courses or expansion joints, then the rails (cypress rail with posts; purple
   *  truss with gold caps and braces). Heights are logical px above the plate. */
  function iconDeck(P, kind, s, ox, oy) {
    const br = kind === 'bridge', hw = 0.36, rise = br ? 5 : 4, dth = 2, U = 1.5;
    const pt = (u, v, h) => { const w = uv(u, v); return [w[0] * s + ox, w[1] * s + oy - (h || 0)]; };
    const fill = (pts, c) => { const sp = iconSpans(pts, 0); for (let i = 0; i < sp.length; i += 3) P.rect(sp[i + 1], sp[i], sp[i + 2] - sp[i + 1], 1, c); };
    const quad = (u0, u1, v0, v1, h) => [pt(u0, v0, h), pt(u1, v0, h), pt(u1, v1, h), pt(u0, v1, h)];
    const seg = (u0, v0, h0, u1, v1, h1, c) => { const a = pt(u0, v0, h0), b = pt(u1, v1, h1); P.line(a[0], a[1], b[0], b[1], c); };
    const post = (u, v, h0, h1, c) => { const a = pt(u, v, h0), b = pt(u, v, h1); P.vline(a[0], Math.round(b[1]), Math.max(1, Math.round(a[1] - b[1]) + 1), c); };
    // shadow on the plate, then the supports under the near (SW) edge and the far one
    fill(quad(-U, U, -hw + 0.1, hw + 0.1, 0).map((p) => [p[0] + 1.5, p[1] + 0.5]), br ? '#2C4D4D' : '#3A3322');
    for (let u = -U + 0.25; u < U; u += br ? 1 : 0.5) {
      if (br) { const a = pt(u, hw - 0.04, rise - dth), b = pt(u, hw - 0.04, 0); P.rect(Math.round(a[0]) - 1, Math.round(a[1]), 3, Math.max(1, Math.round(b[1] - a[1]) + 1), '#8E8E94'); P.vline(Math.round(a[0]) - 1, Math.round(a[1]), Math.max(1, Math.round(b[1] - a[1]) + 1), '#B8B8BC'); }
      else post(u, hw - 0.04, rise - dth, 0, '#2A201F');
    }
    // deck: side, top, courses
    fill(quad(-U, U, -hw, hw, rise - dth), br ? '#6E6E76' : '#523D2F');
    fill(quad(-U, U, -hw, hw, rise), br ? '#B8B8BC' : '#9B6A48');
    if (br) {
      seg(-U, -hw, rise, U, -hw, rise, '#8E8E94'); seg(-U, hw, rise, U, hw, rise, '#8E8E94');
      for (let u = -U + 0.5; u < U; u += 0.5) seg(u, -hw, rise, u, hw, rise, '#9A9AA2');
      seg(-U, 0, rise, U, 0, rise, '#E6E6EA');
    } else {
      for (let u = -U + 0.12, k = 0; u < U; u += 0.12, k++) seg(u, -hw + 0.02, rise, u, hw - 0.02, rise, k % 3 === 2 ? '#C58D62' : '#7C5236');
      seg(-U, -hw, rise, U, -hw, rise, '#5A3A28'); seg(-U, hw, rise, U, hw, rise, '#5A3A28');
    }
    // rails: far one first (it sits behind the deck surface), the near one over it
    for (const side of [-1, 1]) {
      const v = side * hw, rh = br ? 5 : 3;
      for (let u = -U; u <= U + 0.01; u += br ? 0.25 : 0.5) {
        if (br) { post(u, v, rise, rise + rh, '#5E2CA5'); if (Math.round((u + U) / 0.25) % 4 === 0) { const a = pt(u, v, rise + rh); P.px(a[0], a[1] - 1, '#FDD023'); } }
        else post(u, v, rise, rise + rh, side > 0 ? '#5A4531' : '#3A2A1E');
      }
      if (br) { seg(-U, v, rise + rh, U, v, rise + rh, side > 0 ? '#7F5BC5' : '#461D7C'); seg(-U, v, rise + 1, U, v, rise + 1, '#461D7C'); }
      else seg(-U, v, rise + rh, U, v, rise + rh, side > 0 ? '#7F674A' : '#3A2A1E');
    }
  }

  // --- the plan: what stands on what, in world px (1× atlas px; origin = the centre of the ground plate) ---------------
  const ICON_PLANS = new Map();
  const uv = (u, v) => [32 * (u - v), 16 * (u + v)];
  function itemBox(box, it) {
    let g = it.geo;
    if (!g) { const r = M.get(it.id, it.v, 0, 1); if (!r) return false; g = { ox: r.ox, oy: r.oy, w: r.sw, h: r.sh }; }
    const x0 = it.ax + g.ox, y0 = it.ay + g.oy, x1 = x0 + g.w, y1 = y0 + g.h;
    if (x0 < box.x0) box.x0 = x0; if (y0 < box.y0) box.y0 = y0; if (x1 > box.x1) box.x1 = x1; if (y1 > box.y1) box.y1 = y1;
    return true;
  }
  /** the sprite an icon item stands for: an atlas entry, or (footprint rows) the building painted for this icon alone with the entrance on the lit
   *  SW face — `tmp` canvases are freed right after the blit so the atlas never holds the extra variant */
  function iconSource(it, z) {
    if (!it.bld) return M.get(it.id, it.v, 0, z);
    const c = M.newCanvas(1, 1), g = M.ctx2d(c), geo = M.paintBuilding(g, it.bld, it.v, 0, z, hash(strHash(it.id), it.v), 0);
    return { canvas: c, sx: 0, sy: 0, sw: c.width, sh: c.height, ox: geo.ox * z, oy: geo.oy * z, tmp: true };
  }
  function polyBox(box, pts, th) { for (const p of pts) { if (p[0] < box.x0) box.x0 = p[0]; if (p[1] < box.y0) box.y0 = p[1]; if (p[0] > box.x1) box.x1 = p[0]; if (p[1] + th > box.y1) box.y1 = p[1] + th; } }
  function diamondPts(hw, hh) { return [[-hw, 0], [0, -hh], [hw, 0], [0, hh]]; }
  function buildIconPlan(id) {
    const cat = BSU.data && BSU.data.catalog, row = cat ? cat[id] : null;
    const pl = { id: id, items: [], poly: null, ground: 'slab', T: 0, run: false, th: 4 };
    if (ICON_RUN[id]) {
      const R = ICON_RUN[id]; pl.run = true; pl.ground = R.ground; pl.T = ICON_BOX; pl.deck = R.deck || '';
      const n = !R.stamps ? 0 : R.stamps.length === 1 ? 3 : R.stamps.length;
      for (let i = 0; i < n; i++) { const sid = R.stamps.length === 1 ? R.stamps[0] : R.stamps[i]; pl.items.push({ id: sid, v: sid === 'surge_barrier' ? 0 : 10, ax: (i - (n - 1) / 2) * 32, ay: (i - (n - 1) / 2) * 16 }); }
      const m = n || 3;
      pl.poly = [uv(-m / 2 - 0.08, -0.58), uv(m / 2 + 0.08, -0.58), uv(m / 2 + 0.08, 0.58), uv(-m / 2 - 0.08, 0.58)];
    } else if (id === 'preserve') {
      pl.ground = 'marsh'; pl.T = 58;
      pl.poly = [uv(-0.6, -0.6), uv(0.6, -0.6), uv(0.6, 0.6), uv(-0.6, 0.6)];
      pl.items.push({ id: 'preservePost', v: 9, ax: 0, ay: 0 });
      for (const r of [[-7, -1, 0], [6, 1, 1], [-1, 7, 2]]) pl.items.push({ id: 'reeds', v: r[2], ax: r[0], ay: r[1] });
      pl.items.push({ id: 'preservePost', v: 6, ax: 0, ay: 0 });
    } else if (id === 'live_oak' || id === 'cypress' || id === 'azalea') {
      pl.ground = 'grass';
      if (id === 'live_oak') { pl.items.push({ id: 'oak', v: M.treeVariant(2, false, false, 0), ax: 0, ay: 0 }); pl.poly = diamondPts(56, 28); pl.T = ICON_BOX; }
      else if (id === 'cypress') { pl.items.push({ id: 'cypress', v: M.treeVariant(2, false, false, 0), ax: 0, ay: 0 }); pl.poly = diamondPts(34, 17); pl.T = 58; }
      else { for (const p of [[-11, -2, 0], [11, -1, 1], [0, 7, 2]]) pl.items.push({ id: 'azalea', v: M.treeVariant(2, false, true, p[2]), ax: p[0], ay: p[1] }); pl.poly = diamondPts(32, 16); pl.T = 50; }
    } else if (row && row.kind === 'footprint' || id === 'pilings') {
      const rid = id === 'pilings' ? 'dorm' : id, rr = cat[rid] || row;
      const v = id === 'pilings' ? SPR.PILINGS | SPR.FRONT_L : id === 'stadium' ? (1 << SPR.TIER_SHIFT) | SPR.FRONT_L : SPR.FRONT_L;
      const bb = M.buildingBox(rr, v, 1, 0);
      pl.items.push({ id: rid, v: v, ax: bb.ax - bb.gcx, ay: bb.ay - bb.gcy, bld: rr, geo: { ox: bb.ox, oy: bb.oy, w: bb.w, h: bb.h } });
      pl.poly = diamondPts(bb.gw / 2 + 6, bb.gh / 2 + 3);
      pl.foot = bb.fw + '×' + bb.fh;
      pl.ground = id === 'pilings' ? 'water' : 'slab';
    } else {   // anything else the catalog may grow: its own sprite on a slab
      pl.items.push({ id: id, v: 0, ax: 0, ay: 0 }); pl.poly = diamondPts(40, 20);
    }
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    polyBox(box, pl.poly, pl.th);
    pl.items = pl.items.filter((it) => itemBox(box, it));
    pl.box = box; pl.ext = Math.max(box.x1 - box.x0, box.y1 - box.y0);
    return pl;
  }
  function iconPlan(id) { let pl = ICON_PLANS.get(id); if (pl === undefined) { pl = buildIconPlan(id); ICON_PLANS.set(id, pl); } return pl; }
  M.iconPlan = iconPlan;

  /** the scale (logical px per world px) and offset of a plan's world origin in the 64-px frame */
  function iconFit(pl) {
    const bw = pl.box.x1 - pl.box.x0, bh = pl.box.y1 - pl.box.y0;
    const T = pl.T || Math.max(ICON_MIN, Math.min(ICON_BOX, ICON_BOX * Math.pow(pl.ext / ICON_REF, ICON_EXP)));
    const s = Math.min(T / pl.ext, ICON_BOX / bw, ICON_BOX / bh);
    return { s: s, T: T, ox: ICON / 2 - (pl.box.x0 + bw / 2) * s, oy: ICON / 2 - 1 - (pl.box.y0 + bh / 2) * s, w: bw * s, h: bh * s, badge: !!pl.foot && s >= 2.6 * ICON_BOX / ICON_REF };
  }
  M.iconFit = function (id) { const pl = iconPlan(id); return pl ? iconFit(pl) : null; };

  /** the backdrop and the two rims are the same for every icon: painted once per zoom on a scratch canvas, then blitted */
  const ICON_TPL = {};
  function iconTemplate(kind, zoom) {
    const k = kind + zoom; let c = ICON_TPL[k];
    if (!c) {
      c = M.newCanvas(ICON * zoom, ICON * zoom); const P = pen(M.ctx2d(c), zoom);
      if (kind === 'bg') iconBackdrop(P); else iconRim(P, kind === 'rimLocked');
      ICON_TPL[k] = c;
    }
    return c;
  }
  function paintIcon(ctx, spec) {
    const id = spec.sub, locked = (spec.variant & 1) === 1;
    const dims = begin(ctx, ICON, ICON, spec.zoom), S = dims.S, P = pen(ctx, spec.zoom);
    try { ctx.drawImage(iconTemplate('bg', S), 0, 0); } catch (e) { /* headless stub */ }
    const pl = iconPlan(id);
    if (pl) {
      const f = iconFit(pl), s = f.s, ox = f.ox, oy = f.oy;
      const pts = pl.poly.map((p) => [p[0] * s + ox, p[1] * s + oy]);
      iconSlab(P, pts, Math.max(2, Math.round(pl.th * s * 1.4)), ICON_GROUND[pl.ground] || ICON_GROUND.slab, hash(strHash(id), 0x1c0));
      if (pl.deck) iconDeck(P, pl.deck, s, ox, oy);
      const src2 = s * S > 0.75;
      try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; } catch (e) { /* stub */ }
      for (const it of pl.items) {
        const z = src2 ? 2 : 1, r = iconSource(it, z); if (!r || !r.canvas) continue;
        const dx = (it.ax * s + ox) * S + (r.ox / z) * s * S, dy = (it.ay * s + oy) * S + (r.oy / z) * s * S;
        try { ctx.drawImage(r.canvas, r.sx, r.sy, r.sw, r.sh, dx, dy, (r.sw / z) * s * S, (r.sh / z) * s * S); } catch (e) { /* headless stub */ }
        if (r.tmp) { try { r.canvas.width = 1; r.canvas.height = 1; } catch (e) { /* stub */ } }
      }
      try { ctx.imageSmoothingEnabled = false; } catch (e) { /* stub */ }
      if (f.badge) iconBadge(P, pl.foot, 4, 5);
    }
    if (locked) {
      const rows = iconFrameRows();
      try {
        ctx.globalCompositeOperation = 'saturation'; for (let y = 0; y < ICON; y++) P.rect(rows[y], y, ICON - 2 * rows[y], 1, '#808080');
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.1;
        for (let y = 0; y < ICON; y++) P.rect(rows[y], y, ICON - 2 * rows[y], 1, '#1A1230');
        ctx.globalAlpha = 1;
      } catch (e) { /* stub */ }
    }
    try { ctx.drawImage(iconTemplate(locked ? 'rimLocked' : 'rim', S), 0, 0); } catch (e) { /* headless stub */ }
    if (locked) iconPadlock(P, 51, 5);
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
  /** habitat pass: `habfront` = the Tiger Habitat's foreground (near side wall, viewing wall, railing, glass) on a canvas laid out exactly like the building's, drawn by render AFTER Roux so he walks behind the glass */
  M.registerPainter('habfront', function (ctx, spec) {
    const row = BSU.data && BSU.data.catalog && BSU.data.catalog.tiger_habitat, v = spec.variant | 0;
    if (!row) { begin(ctx, 1, 1, spec.zoom); return { w: 1, h: 1, ox: 0, oy: 0 }; }
    const g = M.buildingBox(row, v, spec.zoom, 0);
    g.paint = row.paint || {};
    g.seed = hash(strHash(row.id), (hash(strHash(row.id), v) ^ v) >>> 0);   // the building sprite's own seed, so the two layers match pixel for pixel
    g.tone = (v & SPR.DAMAGED) ? 0.8 : 1; g.frontLeft = !!(v & SPR.FRONT_L);
    const y0 = Math.max(0, g.ay - 56);   // the foreground walls and glass lie on the two lower edges: drop the empty top of the canvas (≈ 45 % of the atlas memory of this layer)
    begin(ctx, g.w, g.h - y0, spec.zoom);
    habitatPaint(ctx, offsetPen(tonePen(pen(ctx, g.zoom), g.tone), 0, -y0), g, row, v, 0, 1);
    return { w: g.w, h: g.h - y0, ox: g.ox, oy: g.oy + y0 };
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
