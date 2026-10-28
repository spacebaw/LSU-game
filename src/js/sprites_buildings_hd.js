'use strict';
// ============================================================================
// BAYOU STATE — sprites_buildings_hd.js (H2a buildings pass): the HD building composer, style C "soft rendered diorama".
// Owner: nothing in state (the atlas is derived, seed-independent, never saved).
// Implements: docs/PLAN_HD_ART.md §4 row "H2 buildings" (part 1 of 2); docs/ART_STYLE.md §1–§3, "## Brush API",
// "## Style C palette" (building knots); the B3 "Louisiana Collegiate" language (PLAN_FIDELITY B3) re-expressed through
// BSU.brush: walls are fillQuadShaded planes (SW lit, SE shadow) in the row's wall base, roofs are roofPlane hips / gables /
// flat parapets with tile courses or tin seams, porticos and galleries are brush columns, windows a mullioned grid of glass
// planes (brush.glow panes at night), decals are planes / orbs / strokes; nothing hand-picks a colour or writes a gradient.
// Registered through BSU.sprites.registerHD('building', …) OVER the pen painter of sprites_buildings.js (manifest order:
// this file loads after it), so sprites.get(<catalogId>, variant, frame, zoom) serves every row through this painter:
// the rows in HD_ROWS (tab utilities / academic / housing, 14 rows) are composed here at master 1 (zoom 0.5 / 1, lod 1)
// and master 2 (zoom 2 / Retina, lod 0); every other row (dining, life, swamp, grounds, sports, the Tiger Habitat — part 2)
// is delegated to sprites.paintBuilding (the pen), which pixel-doubles at master 2 exactly as before H2.
// Geometry: sprites.buildingBox (unchanged) gives the canvas, the anchor and the inset box; the composer works in footprint
// px through fp(g, X, Y, up) (= the pen's fpPt), so footprints, anchors, heights-in-tiles and render's shadow boxes are the
// pen's. Variant bits (contract SPR): NIGHT (4 frames, seeded lit pattern hash(row.n·131 + frame, cell) % 100 < 70),
// DAMAGED, PILINGS (+10 px lift on bark stilts over water), SCAFFOLD (3 frames: slab / half-height block walls in scaffolding
// (+ crane ≥ 3×3) / full height with openings and rafters), RUIN, BOARDED, FRONT_L (door, walk and lamps on the SW face),
// FLOODED (waterline, sandbags, wet apron); tees (render.bakeWith) are gravel / asphalt / plank connectors into the wall.
// Companion family `bldlight:<catalogId>[:r]` (same canvas, anchor and variant bits as the building; frame = the NIGHT
// pattern): only the lit window panes, the door transom and the lamp heads as brush.light quads / blooms, additive, for the
// lights pass — baked on demand, not fetched by render until H5 / part 2 wires it (render_fx today draws light:window).
// Per-row data (HD_ROWS, documented in docs/INTEGRATION_NOTES.md "## H2a buildings pass"): { ground, body, windows, columns,
// props, stripe, plaque } — everything else comes from the catalog row's paint (wall, roof, roofColor, floors, windows,
// material, trim, accent, features, decals), so part 2 adds a row with a data line, not a painter.
// Public (BSU.sprites): hdBuildingRows(), isHDBuilding(id), hdBuildingCells(id, variant, frame, rot), HD_ROWS (frozen).
// Conventions: brush calls only (no createLinearGradient / createRadialGradient / createPattern, no fillText, no
// Math.random, no rng.fx); every jitter from BSU.rng.hash / brush.rng(seed); deterministic in (id, variant, frame, master).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = BSU.sprites;
  const B = BSU.brush;
  if (!M || !B || typeof M.registerHD !== 'function' || typeof M.buildingBox !== 'function' || typeof M.paintBuilding !== 'function') return;
  const SPR = BSU.SPR;
  const PAL = BSU.params.palette;
  const X = M.extra || {};
  const hash = BSU.rng.hash;
  const strHash = BSU.strHash;
  const tone = B.tone, css = B.css;

  // ---------------------------------------------------------------------------
  // Constants (the pen painter's GDD values, mirrored so the two painters never differ in geometry)
  // ---------------------------------------------------------------------------
  const FLOOR_PX = 14, FLOODED_BIT = SPR.FLOODED || 512, LIT_SHARE = 70;
  const WIN_W = 3.2, WIN_H = 4.4;
  /** style C building palette (docs/ART_STYLE.md "## Style C palette", building rows) — ramp names, palette keys or hexes; never tones */
  const C = Object.freeze({
    limestone: '#D9C9A3', brick: '#A8604A', lawn: '#7FBF3C', lawnStripe: '#74AD36', gravelPad: '#8A8A8E', sandYard: '#B3A27C', paveLight: '#D8D2C2',
    walk: '#D5CBAE', siteDirt: '#8B6B4A', hedge: '#3F6B2E', lampPost: '#2A2A32', lampHead: '#D8D8E0', fence: '#9A9AA0', steel: '#8A8A8E', iron: '#4A4C55',
    tin: '#9AA3AC', block: '#9A9A9E', concrete: '#B0ADA6', wood: '#8B7355', sheathing: '#B59A6A', plywood: X.plywood || '#B08D5E', tarp: X.tarp || '#3B6FD6',
    tarpCrease: X.tarpCrease || '#2B4F9E', sandbag: X.sandbag || '#C9B47C', rubble: '#6B625A', windowDark: '#3A3050', glass: X.glass || '#A0D0FF', glow: '#FFD27A',
    crane: '#D9B33A', transformer: '#5A5A60', offWhite: X.offWhite || '#E8E8E8', white: '#FFFFFF', tigerOrange: X.tigerOrange || '#E07020', clay: '#9A6A44', green: '#2E8B57',
    stain: '#5A4A3A', asphalt: PAL.asphalt || '#3A3A40', gravel: PAL.gravel || '#C9B47C', boardwalk: PAL.boardwalk || '#8B7355', bark: PAL.bark || '#3A2A1E',
    water: PAL.waterNight || '#1B3A3A', shallows: PAL.shallows || '#6FA895', purple: PAL.purple, purple2: PAL.purple2 || '#5E2CA5', gold: PAL.gold, gold2: PAL.gold2 || '#F5B700',
    azalea: PAL.azalea || '#E75480', cool: M.COOL_TINT || '#2B2550', spec: '#FFFBEA'
  });
  const GLOWS = Object.freeze(['#FFD27A', '#FFE9A8', '#F2B860', '#FFDC8E']);
  const isPurple = (c) => { const u = String(c || '').toUpperCase(); return u === String(PAL.purple).toUpperCase() || u === String(PAL.purple2 || '').toUpperCase(); };
  const satOf = (hex) => { const s = String(hex || '').replace('#', ''); if (s.length < 6) return 1; const r = parseInt(s.slice(0, 2), 16), gg = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16); const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); return mx ? (mx - mn) / mx : 0; };

  // ---------------------------------------------------------------------------
  // Per-row data. Every converted row is one line; the keys are optional (defaults from the catalog paint and the tab):
  //   ground   'brick' | 'lawn' | 'gravel' | 'sand' | 'pave' | 'courtyard'      apron material (default by tab: academic brick, housing lawn, utilities gravel, else pave)
  //   body     'box' (default: one inset box from paint) | 'bunk' | 'wings' | 'substation' | 'tower' | 'generator'   a named composition
  //   windows  { cols: [sw, se], rows }                                          per-face column counts (default paint.windows.cols on both faces)
  //   columns  n                                                                 portico columns on the entrance face (the pediment comes from features)
  //   props    [{ kind, roof: [u, v] | at: [X, Y] (footprint px) | margin: [side, t] }]   kinds: clarifier, dish, dock, crane, couch, cars, magnolia
  //   stripe   hex                                                               a vertical accent stripe up the SE face (res_tower's gold)
  //   plaque   true                                                              a purple plaque with gold marks on the far face (the Greek letters)
  // Features (paint.features) read: pediment, cupola[:gold], banner:roux, steps, planters, arched, mullions, gutters, gallery[:both], awnings,
  // shutters, sign:TEXT, flagpole, hvac, tank, vents, stack, dormers. Decals (paint.decals) read: columns, clock, flag, awning, arcade, dome,
  // banner, lights, beacon, pipes, crane, dish, couch, letters, tank, vents. Not drawn in HD (part 2 decides): airboat, truck, stilts (the
  // pilings variant draws the stilts), lookout, reeds, fountain, pool, boilpot, dumpster.
  // ---------------------------------------------------------------------------
  const HD_ROWS = Object.freeze({
    founders_hall: { ground: 'brick', columns: 6 },
    lecture_hall: { ground: 'brick' },
    library: { ground: 'brick' },
    engineering: { ground: 'brick', props: [{ kind: 'crane', roof: [0.72, 0.3] }] },
    coastal_institute: { ground: 'brick', props: [{ kind: 'dish', roof: [0.84] }, { kind: 'dock', margin: [0, 0.3] }] },
    dorm: { ground: 'lawn', props: [{ kind: 'couch', margin: [1, 0.25] }] },
    res_tower: { ground: 'lawn', stripe: PAL.gold },
    greek_house: { ground: 'lawn', columns: 4, plaque: true },
    bunkhouse: { ground: 'sand', body: 'bunk' },
    suites: { ground: 'courtyard', body: 'wings', props: [{ kind: 'cars' }, { kind: 'magnolia' }] },
    substation: { ground: 'gravel', body: 'substation' },
    water_tower: { ground: 'gravel', body: 'tower' },
    generator: { ground: 'gravel', body: 'generator' },
    wastewater: { ground: 'gravel', props: [{ kind: 'clarifier', margin: [0, 0.55] }] }
  });
  const GROUND_BY_TAB = { academic: 'brick', housing: 'lawn', utilities: 'gravel' };
  M.HD_ROWS = HD_ROWS;
  M.hdBuildingRows = function () { return Object.keys(HD_ROWS); };
  M.isHDBuilding = function (id) { return typeof id === 'string' && HD_ROWS[id.indexOf(':') >= 0 ? id.slice(0, id.indexOf(':')) : id] !== undefined; };

  // ---------------------------------------------------------------------------
  // Geometry in footprint px: X runs along the fw axis (down-right on screen), Y along fh (down-left); `up` px above the box
  // base (lifted under PILINGS); ground = true for points on the ground under a lifted box.
  // ---------------------------------------------------------------------------
  function fp(g, X, Y, up, ground) { return [g.ax + (g.fh - g.fw) * 32 + X - Y, g.ay + 16 + (X + Y) / 2 - (g.fw + g.fh) * 16 - (up || 0) - (ground ? 0 : g.lift)]; }
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const mid = (a, b) => lerp(a, b, 0.5);
  const hasF = (g, n) => g.features.indexOf(n) >= 0;
  const hasD = (g, n) => g.decals.indexOf(n) >= 0;
  const featureArg = (g, prefix) => { for (let i = 0; i < g.features.length; i++) if (g.features[i].indexOf(prefix) === 0) return g.features[i].slice(prefix.length); return null; };
  /** an inset box: X0..X1 × Y0..Y1 footprint px, `floors` storeys, roof kind / rise / colour; faces 0 = SW (lit), 1 = SE (shadow) */
  function mkBox(g, X0, X1, Y0, Y1, floors, roof, roofH, roofColor) {
    return { g: g, X0: X0, X1: X1, Y0: Y0, Y1: Y1, floors: floors, wallH: floors * FLOOR_PX, roof: roof, roofH: roofH, roofColor: roofColor, cells: [], doorFace: g.frontLeft ? 0 : 1, planes: null, ridge: null };
  }
  /** the whole inset box of the footprint (sprites.buildingBox's ipx / ipy) */
  function mainBox(g) { const p = g.paint; return mkBox(g, g.ipx, g.fw * 32 - g.ipx, g.ipy, g.fh * 32 - g.ipy, g.floors, g.roof, g.roofH, p.roofColor || PAL.terracotta); }
  /** a point on face f of box b: u ∈ [0, 1] from the LEFT end on screen (SW: W → S corner, SE: S → E corner), `up` px above the base, `out` px outward */
  function facePt(b, f, u, up, out, ground) {
    const g = b.g, o = out || 0;
    return f === 0 ? fp(g, b.X0 + u * (b.X1 - b.X0), b.Y1 + o, up, ground) : fp(g, b.X1 + o, b.Y1 - u * (b.Y1 - b.Y0), up, ground);
  }
  /** px length of face f (its screen width) */
  function faceLen(b, f) { return f === 0 ? b.X1 - b.X0 : b.Y1 - b.Y0; }
  /** a wall-plane quad between u0..u1 and heights h0..h1 on face f (bottom-left, bottom-right, top-right, top-left) */
  function faceQuad(b, f, u0, u1, h0, h1, out) { return [facePt(b, f, u0, h0, out), facePt(b, f, u1, h0, out), facePt(b, f, u1, h1, out), facePt(b, f, u0, h1, out)]; }
  /** the box top's four corners at height h: N (back), E (right), S (bottom), W (left) */
  function topCorners(b, h, grow) { const g = b.g, o = grow || 0; return { N: fp(g, b.X0 - o, b.Y0 - o, h), E: fp(g, b.X1 + o, b.Y0 - o, h), S: fp(g, b.X1 + o, b.Y1 + o, h), W: fp(g, b.X0 - o, b.Y1 + o, h) }; }
  function topQuad(b, h, grow) { const q = topCorners(b, h, grow); return [q.N, q.E, q.S, q.W]; }
  /** the footprint's ground quad (T, R, B, L) */
  function groundQuad(g) { return [fp(g, 0, 0, 0, true), fp(g, g.fw * 32, 0, 0, true), fp(g, g.fw * 32, g.fh * 32, 0, true), fp(g, 0, g.fh * 32, 0, true)]; }
  /** a point in the margin strip outside face `side` (0 = SE margin, 1 = SW margin) at t along it (0 at the bottom corner end for SE, at the left end for SW) */
  function marginPt(g, side, t, ground) {
    const ipx = g.ipx, ipy = g.ipy;
    return side === 0 ? fp(g, g.fw * 32 - ipx * 0.5, (1 - t) * g.fh * 32, 0, ground) : fp(g, t * g.fw * 32, g.fh * 32 - ipy * 0.5, 0, ground);
  }
  /** a toned line */
  function line(ctx, a, b, w, color, t, alpha) { B.stroke(ctx, [a, b], w, color, t, alpha == null ? 1 : alpha, { cap: 'round' }); }
  /** a filled polygon in one tone (flat, no bevel: trim bands, sills, plaques) */
  function flat(ctx, pts, color, t, alpha) { B.poly(ctx, pts); ctx.fillStyle = tone(color, t, alpha == null ? 1 : alpha); ctx.fill(); }
  /** lines parallel to the base of face f every `step` px up to h: cb(u-independent quad endpoints a, b, up) */
  function faceLines(b, f, h, step, from, cb) { for (let up = from; up < h; up += step) cb(facePt(b, f, 0, up), facePt(b, f, 1, up), up); }
  /** a small iso box standing on the ground point of its footprint centre (X, Y) with half-sizes hx, hy (footprint px) and height h: three shaded faces */
  function miniBox(ctx, g, X, Y, hx, hy, h, color, material, env, up, opts) {
    opts = opts || {};
    const u = up || 0, b = mkBox(g, X - hx, X + hx, Y - hy, Y + hy, 0, 'none', 0, color);
    const q = topQuad(b, u + h);
    B.fillQuadShaded(ctx, faceQuad(b, 0, 0, 1, u, u + h), color, { face: 'sw', material: material, noAO: opts.noAO }, env);
    B.fillQuadShaded(ctx, faceQuad(b, 1, 0, 1, u, u + h), color, { face: 'se', material: material, noAO: opts.noAO }, env);
    B.fillQuadShaded(ctx, q, opts.top || color, { face: 'top', material: material, t: opts.topT || 0 }, env);
    return b;
  }

  // ---------------------------------------------------------------------------
  // Ground: the apron on the true footprint quad (material by tab / row), the curb on the SW / SE edges, the back-edge highlight,
  // the foundation AO in front of the walls; pilings rows stand in water; construction sites are graded dirt.
  // ---------------------------------------------------------------------------
  const APRON = {
    brick: { base: C.brick, t: 0.05, pattern: 'brick', hedge: true },
    lawn: { base: C.lawn, t: 0, pattern: 'lawn', hedge: true },
    gravel: { base: C.gravelPad, t: 0.05, pattern: 'gravel', fence: true },
    sand: { base: C.sandYard, t: 0.05, pattern: 'gravel' },
    pave: { base: C.paveLight, t: 0, pattern: 'pave', hedge: true },
    courtyard: { base: C.lawn, t: 0, pattern: 'lawn', hedge: true },
    site: { base: C.siteDirt, t: -0.05, pattern: 'dirt' }
  };
  function apronOf(g) { const D = g.D || {}; return APRON[D.ground] || APRON[GROUND_BY_TAB[g.row.tab]] || APRON.pave; }
  function drawApron(ctx, g, A, env) {
    const q = groundQuad(g), lod0 = env.lod === 0, seed = g.seed;
    B.fillQuadShaded(ctx, q, A.base, { face: 'top', material: A.pattern === 'lawn' ? 'wood' : 'stone', t: A.t, noAO: true }, env);
    if (A.pattern !== 'lawn') B.macroGrain(ctx, q, 0.3, env);
    ctx.save(); B.poly(ctx, q); ctx.clip();
    if (A.pattern === 'lawn') {
      for (let s = 1; s < g.fw * 2; s += 2) flat(ctx, [fp(g, s * 16, 0, 0, true), fp(g, (s + 1) * 16, 0, 0, true), fp(g, (s + 1) * 16, g.fh * 32, 0, true), fp(g, s * 16, g.fh * 32, 0, true)], C.lawnStripe, 0, 0.55);   // mowing stripes
      if (lod0) for (let i = 0; i < g.fw * g.fh * 3; i++) { const X = (hash(seed, i * 3) % (g.fw * 32)), Y = (hash(seed, i * 3 + 1) % (g.fh * 32)); const p = fp(g, X, Y, 0, true); B.orb(ctx, p[0], p[1], 1.6, 0.9, C.lawn, 0.25, { noRim: true }); }
    } else if (A.pattern === 'brick' && lod0) {
      for (let Y = 6; Y < g.fh * 32; Y += 6) line(ctx, fp(g, 0, Y, 0, true), fp(g, g.fw * 32, Y, 0, true), 0.7, C.brick, -0.45, 0.4);
      for (let X = 6; X < g.fw * 32; X += 6) line(ctx, fp(g, X, 0, 0, true), fp(g, X, g.fh * 32, 0, true), 0.7, C.brick, -0.45, 0.25);
    } else if (A.pattern === 'pave' && lod0) {
      for (let Y = 8; Y < g.fh * 32; Y += 8) line(ctx, fp(g, 0, Y, 0, true), fp(g, g.fw * 32, Y, 0, true), 0.7, C.paveLight, -0.4, 0.4);
      for (let X = 8; X < g.fw * 32; X += 8) line(ctx, fp(g, X, 0, 0, true), fp(g, X, g.fh * 32, 0, true), 0.7, C.paveLight, -0.4, 0.4);
    } else if (A.pattern === 'gravel' || A.pattern === 'dirt') {
      const n = lod0 ? g.fw * g.fh * 6 : g.fw * g.fh * 2;
      for (let i = 0; i < n; i++) { const X = (hash(seed, i * 5) % (g.fw * 32)), Y = (hash(seed, i * 5 + 2) % (g.fh * 32)); const p = fp(g, X, Y, 0, true); B.orb(ctx, p[0], p[1], 1.1, 0.7, A.base, (i & 1) ? 0.45 : -0.35, { noRim: true }); }
    }
    ctx.restore();
    // curbs on the SW / SE edges, a light rim on the back edges
    line(ctx, q[3], q[2], 1.6, A.base, -0.6, 0.8); line(ctx, q[2], q[1], 1.6, A.base, -0.6, 0.8);
    line(ctx, q[0], q[1], 0.9, A.base, 0.5, 0.7); line(ctx, q[3], q[0], 0.9, A.base, 0.5, 0.7);
  }
  /** the cool contact band in front of the SW / SE faces of box b (the apron side of the wall base) */
  function foundation(ctx, b, env) {
    const g = b.g, ip = Math.max(2, Math.min(g.ipx, g.ipy));
    for (const f of [0, 1]) { const q = [facePt(b, f, 0, 0, 0, true), facePt(b, f, 1, 0, 0, true), facePt(b, f, 1, 0, ip, true), facePt(b, f, 0, 0, ip, true)]; B.edgeFade(ctx, q, q[0], q[1], Math.min(4, ip), C.cool, -0.2, 0.45); }
    void env;
  }
  /** PILINGS: the footprint is water (flat, a few ripples) */
  function drawWaterGround(ctx, g, env) {
    const q = groundQuad(g);
    B.fillQuadShaded(ctx, q, C.water, { face: 'top', material: 'paint', t: -0.15, noAO: true }, env);
    B.macroGrain(ctx, q, 0.3, env);
    ctx.save(); B.poly(ctx, q); ctx.clip();
    const n = env.lod === 0 ? g.fw * g.fh * 4 : g.fw * g.fh * 2;
    for (let i = 0; i < n; i++) { const X = hash(g.seed, 70 + i * 3) % (g.fw * 32), Y = hash(g.seed, 71 + i * 3) % (g.fh * 32); const p = fp(g, X, Y, 0, true); line(ctx, [p[0] - 3, p[1]], [p[0] + 3, p[1]], 0.8, env.night ? '#C9D8FF' : C.shallows, 0.4, 0.5); }
    ctx.restore();
    line(ctx, q[3], q[2], 1, C.water, -0.5, 0.7); line(ctx, q[2], q[1], 1, C.water, -0.5, 0.7);
  }
  /** bark stilts under the lifted box every 12 px: back row first (hidden by the walls), the front row with cross braces after */
  function stilts(ctx, b, back, env) {
    const g = b.g, lift = g.lift; if (!(lift > 0)) return;
    for (const f of [0, 1]) {
      const len = faceLen(b, f);
      if (back) { for (let s = 6; s < len; s += 24) { const p = facePt(b, f, s / len, 0, -(f === 0 ? b.Y1 - b.Y0 : b.X1 - b.X0) * 0.5); B.column(ctx, p[0], p[1] + lift, lift, 1, C.bark, env); } continue; }
      let prev = null;
      for (let s = 2; s <= len - 3; s += 12) {
        const p = facePt(b, f, s / len, 0, 0); const foot = [p[0], p[1] + lift + 2];
        B.column(ctx, p[0], foot[1], lift + 2, 1.4, C.bark, env);
        line(ctx, [foot[0] - 3, foot[1]], [foot[0] + 3, foot[1]], 0.9, C.shallows, 0.3, 0.6);   // the ripple at the waterline
        if (prev) line(ctx, [prev[0] + 1.4, prev[1] - 1], [foot[0] - 1.4, foot[1] - lift + 1], 0.9, C.bark, -0.2, 0.9);   // cross brace
        prev = foot;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The box: walls (material courses at lod 0), belt courses, cornice, plinth, windows, door, roof.
  // ---------------------------------------------------------------------------
  function wallMaterial(mat) { return mat === 'brick' ? 'stucco' : (mat === 'stone' || mat === 'stucco' || mat === 'wood' || mat === 'metal' || mat === 'glass') ? mat : 'stucco'; }
  /** the two faces of box b (hgt px, default its wallH) in colour `color` (default the row's wall base); o = {material, raw (no courses), t} */
  function drawWalls(ctx, b, env, o) {
    o = o || {}; const g = b.g, h = o.hgt != null ? o.hgt : b.wallH; if (h <= 0) return;
    const color = o.color || g.wallBase, mat = o.material || g.material, bm = wallMaterial(mat), lod0 = env.lod === 0, trim = g.trim, t = o.t || 0;
    for (const f of [0, 1]) {
      const q = faceQuad(b, f, 0, 1, 0, h);
      B.fillQuadShaded(ctx, q, color, { face: f === 0 ? 'sw' : 'se', material: bm, t: t }, env);
      const ft = (f === 0 ? -0.1 : -0.48) + t;
      ctx.save(); B.poly(ctx, q); ctx.clip();
      if (lod0 && !o.raw) {
        if (mat === 'brick') { faceLines(b, f, h - 1, 3, 3, (a, c, up) => { line(ctx, a, c, 0.6, color, ft - 0.55, 0.3); const off = ((up / 3) & 1) ? 3 : 0; const len = faceLen(b, f); for (let s = off; s < len; s += 6) { const p = facePt(b, f, s / len, up); line(ctx, [p[0], p[1]], [p[0], p[1] + 1.2], 0.6, color, ft - 0.55, 0.3); } }); }
        else if (mat === 'stone') faceLines(b, f, h - 1, 5, 5, (a, c) => line(ctx, a, c, 0.7, color, ft - 0.5, 0.35));
        else if (mat === 'metal') { faceLines(b, f, h - 1, 7, 7, (a, c) => line(ctx, a, c, 0.7, color, ft - 0.45, 0.4)); const len = faceLen(b, f); for (let s = 5; s < len; s += 12) line(ctx, facePt(b, f, s / len, 2), facePt(b, f, s / len, h - 2), 0.7, color, ft - 0.45, 0.4); }
        else if (mat === 'wood') { const len = faceLen(b, f); for (let s = 2; s < len; s += 4) line(ctx, facePt(b, f, s / len, 1.5), facePt(b, f, s / len, h - 1.5), 0.6, color, ft - 0.4, 0.35); }
        else if (mat === 'glass') { const len = faceLen(b, f); for (let s = 6; s < len; s += 6) line(ctx, facePt(b, f, s / len, 1), facePt(b, f, s / len, h - 1), 0.8, C.iron, 0, 0.6); }
      }
      if (!o.raw) {
        if (mat !== 'glass') for (let r = 1; r < b.floors && r * FLOOR_PX < h - 3; r++) line(ctx, facePt(b, f, 0, r * FLOOR_PX - 1), facePt(b, f, 1, r * FLOOR_PX - 1), 1, trim, f === 0 ? 0.5 : -0.4, 0.75);   // belt courses
        if (h >= 10 && mat !== 'glass') { line(ctx, facePt(b, f, 0, h - 1.2), facePt(b, f, 1, h - 1.2), 1.4, trim, f === 0 ? 0.9 : 0, 0.9); line(ctx, facePt(b, f, 0, h - 2.6), facePt(b, f, 1, h - 2.6), 1, trim, f === 0 ? 0.4 : -0.5, 0.8); }   // cornice
        if (h >= 8) line(ctx, facePt(b, f, 0, 1), facePt(b, f, 1, 1), 1, mat === 'stucco' ? trim : color, f === 0 ? -0.1 : -0.6, 0.7);   // plinth
      }
      ctx.restore();
    }
    // the front corner: a cool rim where the lit and shadow faces meet
    line(ctx, facePt(b, 0, 1, 0), facePt(b, 0, 1, h), 0.9, '#B8C8FF', 0, 0.35);
  }
  /** the window grid of box b (both faces): cells {face, u0, u1, h0, h1, r, lit, quad}; the entrance face's centre at r 0 stays clear for the door */
  function layoutWindows(b, cols, rows, night, frame, noDoor) {
    const g = b.g, cells = []; b.cells = cells;
    const h = b.wallH; if (!rows || h <= 0) return cells;
    const pitch = h / rows, H = Math.min(WIN_H, Math.max(2.4, pitch - 4)), n = (g.row.n | 0) * 131 + frame;
    let idx = 0;
    for (const f of [0, 1]) {
      const nc = cols[f] | 0; if (!nc) continue;
      const len = faceLen(b, f), usable = len - 4, cw = usable / nc, W = Math.min(WIN_W, cw - 1.2);
      for (let r = 0; r < rows; r++) for (let k = 0; k < nc; k++) {
        const c = 2 + cw * (k + 0.5), h0 = r * pitch + 4, h1 = h0 + H;
        if (h1 > h - 3) continue;
        if (f === b.doorFace && r === 0 && !noDoor && Math.abs(c - len / 2) < 5) continue;
        const lit = night && (hash(n, idx) % 100) < LIT_SHARE;
        cells.push({ face: f, u0: (c - W / 2) / len, u1: (c + W / 2) / len, h0: h0, h1: h1, r: r, lit: lit, idx: idx, quad: faceQuad(b, f, (c - W / 2) / len, (c + W / 2) / len, h0, h1) });
        idx++;
      }
    }
    return cells;
  }
  /** draw the laid-out cells: glass by day, glow / dark at night, sill + lintel, mullion cross (lod 0), arched heads, shutters; opening = construction holes */
  function drawWindows(ctx, b, env, o) {
    o = o || {}; const g = b.g, trim = g.trim, lod0 = env.lod === 0, night = !!o.night;
    const arched = hasF(g, 'arched'), mullions = hasF(g, 'mullions'), shutters = hasF(g, 'shutters'), acc = g.paint.accent || PAL.purple, n = (g.row.n | 0) * 131 + (o.frame | 0);
    for (const c of b.cells) {
      const q = c.quad, face = c.face === 0 ? 'sw' : 'se', ft = c.face === 0 ? 0.3 : -0.3;
      if (o.opening) { flat(ctx, faceQuad(b, c.face, c.u0 - 0.004, c.u1 + 0.004, c.h0 - 0.8, c.h1 + 0.8), C.block, -0.95); line(ctx, q[3], q[2], 0.8, C.block, -0.4, 0.8); continue; }
      if (night) {
        if (c.lit) { B.glow(ctx, q, GLOWS[hash(n, c.idx * 7 + 3) % GLOWS.length], env); if ((hash(n, c.idx * 11) % 4) === 0) flat(ctx, faceQuad(b, c.face, c.u0, c.u1, c.h0, (c.h0 + c.h1) / 2), C.windowDark, 0.2, 0.55); }   // curtain
        else B.plane(ctx, q, C.windowDark, -0.2, { vert: true, amp: 0.15, rim: 0.15 });
      } else B.fillQuadShaded(ctx, q, C.glass, { face: face, material: 'glass' }, env);
      if (lod0 && mullions && !o.opening) { const um = (c.u0 + c.u1) / 2, hm = (c.h0 + c.h1) / 2; line(ctx, facePt(b, c.face, um, c.h0), facePt(b, c.face, um, c.h1), 0.6, night ? C.iron : trim, night ? 0 : ft, 0.9); line(ctx, facePt(b, c.face, c.u0, hm), facePt(b, c.face, c.u1, hm), 0.6, night ? C.iron : trim, night ? 0 : ft, 0.9); }
      line(ctx, facePt(b, c.face, c.u0 - 0.004, c.h0 - 0.4), facePt(b, c.face, c.u1 + 0.004, c.h0 - 0.4), 1, trim, ft, 0.95);   // sill
      if (arched) { const a = facePt(b, c.face, (c.u0 + c.u1) / 2, c.h1), w = Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1]) / 2; ctx.fillStyle = tone(trim, ft, 0.9); ctx.beginPath(); ctx.ellipse(a[0], a[1], w + 0.6, 1.6, Math.atan2(q[2][1] - q[3][1], q[2][0] - q[3][0]), Math.PI, 0); ctx.fill(); }
      else line(ctx, facePt(b, c.face, c.u0 - 0.004, c.h1 + 0.4), facePt(b, c.face, c.u1 + 0.004, c.h1 + 0.4), 1, trim, ft - 0.2, 0.95);   // lintel
      if (shutters) { const len = faceLen(b, c.face); B.plane(ctx, faceQuad(b, c.face, c.u0 - 2.4 / len, c.u0 - 0.6 / len, c.h0, c.h1), acc, ft - 0.2, { vert: true, amp: 0.18, rim: 0.1 }); B.plane(ctx, faceQuad(b, c.face, c.u1 + 0.6 / len, c.u1 + 2.4 / len, c.h0, c.h1), acc, ft - 0.2, { vert: true, amp: 0.18, rim: 0.1 }); }
    }
  }
  /** the door at the base of the entrance face's centre (or at u): panel, limestone surround, transom (lit at night); records g.doorPt (ground) and g.doorFace */
  function drawDoor(ctx, b, env, o) {
    o = o || {}; const g = b.g; if (b.wallH <= 0) return;
    const f = o.face != null ? o.face : b.doorFace, u = o.u != null ? o.u : 0.5, len = faceLen(b, f), dw = o.wide ? 6 : 4, hw = dw / 2 / len, dh = o.h || 7;
    const col = o.color || (isPurple(g.paint.wall && g.paint.wall[1]) ? C.gold : C.purple), trim = g.trim, ft = f === 0 ? 0.2 : -0.35, night = !!o.night;
    B.plane(ctx, faceQuad(b, f, u - hw - 0.8 / len, u + hw + 0.8 / len, 0, dh + 1.2), trim, ft, { vert: true, amp: 0.12, rim: 0.2 });   // surround
    B.fillQuadShaded(ctx, faceQuad(b, f, u - hw, u + hw, 0, dh - 1.6), col, { face: f === 0 ? 'sw' : 'se', material: 'wood' }, env);
    line(ctx, facePt(b, f, u, 0.5), facePt(b, f, u, dh - 2), 0.6, col, -0.6, 0.8);   // the leaf split
    const tq = faceQuad(b, f, u - hw, u + hw, dh - 1.4, dh + 0.2);
    if (night) B.glow(ctx, tq, GLOWS[0], env); else B.fillQuadShaded(ctx, tq, C.glass, { face: f === 0 ? 'sw' : 'se', material: 'glass' }, env);
    const kp = facePt(b, f, u + hw * 0.5, 3); B.orb(ctx, kp[0], kp[1], 0.6, 0.6, C.gold, 0.2, { noRim: true });
    g.doorPt = facePt(b, f, u, 0, 0, true); g.doorFace = f; g.doorU = u; g.doorBox = b;
  }
  /** roofs: hip / gable (ridge along the longer axis, a 3-px eave overhang, tile courses or tin seams, ridge cap), flat (parapet + gravel top + coping), none */
  function drawRoof(ctx, b, env, o) {
    o = o || {}; const g = b.g, kind = b.roof, h = b.wallH, color = b.roofColor || PAL.terracotta, lod0 = env.lod === 0;
    if (kind === 'none' || (b.roofH <= 0 && kind !== 'flat')) return;
    if (kind === 'flat') {
      const R = Math.max(2, b.roofH), q = topCorners(b, h + R), wall = g.wallBase;
      B.fillQuadShaded(ctx, faceQuad(b, 0, 0, 1, h, h + R), wall, { face: 'sw', material: wallMaterial(g.material), t: -0.12, noAO: true }, env);
      B.fillQuadShaded(ctx, faceQuad(b, 1, 0, 1, h, h + R), wall, { face: 'se', material: wallMaterial(g.material), t: -0.12, noAO: true }, env);
      B.fillQuadShaded(ctx, [q.N, q.E, q.S, q.W], color, { face: 'top', material: 'stone', t: -0.1 }, env);
      const inner = topQuad(b, h + R - 0.6, -4); B.plane(ctx, inner, color, -0.25, { amp: 0.1, rim: 0.12 });
      if (lod0) for (let i = 0; i < 10 + (b.X1 - b.X0) / 4; i++) { const X = b.X0 + 5 + hash(g.seed, 300 + i * 3) % Math.max(1, (b.X1 - b.X0 - 10)), Y = b.Y0 + 5 + hash(g.seed, 301 + i * 3) % Math.max(1, (b.Y1 - b.Y0 - 10)); const p = fp(g, X, Y, h + R - 0.6); B.orb(ctx, p[0], p[1], 1, 0.6, color, (i & 1) ? 0.4 : -0.35, { noRim: true }); }
      line(ctx, q.W, q.S, 1.2, g.trim, 0.5, 0.9); line(ctx, q.S, q.E, 1.2, g.trim, -0.1, 0.9); line(ctx, q.N, q.E, 0.9, g.trim, 0.6, 0.8); line(ctx, q.W, q.N, 0.9, g.trim, 0.6, 0.8);   // coping
      b.planes = { front: null, kind: 'flat', top: h + R - 0.6 };
      return;
    }
    const Rh = Math.max(1, b.roofH), ov = o.overhang != null ? o.overhang : 3, tin = satOf(color) < 0.12;
    const q = topCorners(b, h, ov), W = q.W, S = q.S, E = q.E, N = q.N;
    const along = (b.X1 - b.X0) >= (b.Y1 - b.Y0);
    const m0 = along ? mid(W, N) : mid(N, E), m1 = along ? mid(S, E) : mid(W, S);
    const span = kind === 'gable' ? [0, 1] : [0.3, 0.7];
    const a = lerp(m0, m1, span[0]), c = lerp(m0, m1, span[1]); a[1] -= Rh; c[1] -= Rh;
    // the eave fascia under the overhang, then the planes back to front
    for (const f of [0, 1]) B.fillQuadShaded(ctx, faceQuad(b, f, -ov / faceLen(b, f), 1 + ov / faceLen(b, f), h - 1.6, h + 0.4, ov), g.trim, { face: f === 0 ? 'sw' : 'se', material: 'wood', noAO: true }, env);
    const planes = along
      ? { nw: [W, N, a], ne: [N, E, c, a], sw: [W, S, c, a], se: [S, E, c] }
      : { ne: [N, E, a], nw: [W, N, a, c], se: [S, E, a, c], sw: [W, S, c] };
    const ends = along ? ['nw', 'se'] : ['ne', 'sw'];
    if (kind === 'gable') {
      // gable ends are wall: the left end (nw / ne) and the front end (se / sw) in the wall base
      const endL = planes[ends[0]], endF = planes[ends[1]];
      B.fillQuadShaded(ctx, endL, g.wallBase, { face: along ? 'sw' : 'se', material: wallMaterial(g.material), noAO: true, t: along ? 0 : -0.1 }, env);
      B.fillQuadShaded(ctx, endF, g.wallBase, { face: along ? 'se' : 'sw', material: wallMaterial(g.material), noAO: true, t: along ? -0.05 : 0 }, env);
      const v = mid(mid(endF[0], endF[1]), endF[2]); flat(ctx, [[v[0] - 1.2, v[1] + 1], [v[0] + 1.2, v[1] + 1], [v[0] + 1.2, v[1] - 1.2], [v[0] - 1.2, v[1] - 1.2]], g.wallBase, -0.85, 0.9);   // gable vent
    } else { B.roofPlane(ctx, planes[ends[0]], color, { facing: ends[0], noShadow: true }, env); }
    for (const key of along ? ['ne', 'sw'] : ['nw', 'se']) B.roofPlane(ctx, planes[key], color, { facing: key, noShadow: true }, env);
    if (kind !== 'gable') B.roofPlane(ctx, planes[ends[1]], color, { facing: ends[1], noShadow: true }, env);
    if (tin && lod0) for (const key of (along ? ['ne', 'sw'] : ['nw', 'se'])) { const pl = planes[key]; const n = Math.max(2, Math.round(Math.hypot(pl[1][0] - pl[0][0], pl[1][1] - pl[0][1]) / 6)); for (let i = 1; i < n; i++) { const t = i / n; line(ctx, lerp(pl[0], pl[1], t), lerp(pl[3], pl[2], t), 0.7, color, 0.5, 0.35); } }
    line(ctx, a, c, 2, color, 0.6, 0.9);   // ridge cap
    // the eave shadow on the walls (clipped to the faces, not the brush's unclipped multiply)
    for (const f of [0, 1]) { const fq = faceQuad(b, f, 0, 1, 0, h); B.edgeFade(ctx, fq, fq[3], fq[2], 9, C.cool, -0.6, 0.4); }
    const front = along ? planes.sw : planes.se, hips = along ? [[W, a], [N, a], [S, c], [E, c]] : [[N, a], [E, a], [W, c], [S, c]];
    if (kind === 'hip') for (const hp of hips) line(ctx, hp[0], hp[1], 1, color, -0.7, 0.45);
    b.planes = { front: front, kind: kind, along: along, a: a, c: c, planes: planes };
    b.ridge = [a, c];
  }
  /** a point on top of the roof for equipment: flat → (u, v) on the top quad; hip / gable → along the ridge at u */
  function roofTop(b, u, v) {
    const g = b.g;
    if (!b.planes || b.planes.kind === 'flat') { const h = b.wallH + (b.planes ? Math.max(2, b.roofH) - 0.6 : 0); return fp(g, b.X0 + (b.X1 - b.X0) * (u == null ? 0.5 : u), b.Y0 + (b.Y1 - b.Y0) * (v == null ? 0.5 : v), h); }
    const p = lerp(b.ridge[0], b.ridge[1], u == null ? 0.5 : u); return [p[0], p[1] + 1];
  }

  // ---------------------------------------------------------------------------
  // Features and props
  // ---------------------------------------------------------------------------
  /** portico: a recessed band, n limestone columns standing 2 px off the entrance face, an entablature; returns {u0, u1, ch} for the pediment */
  function drawColumns(ctx, b, n, env) {
    const g = b.g; if (b.wallH < 12) return null;
    const f = b.doorFace, len = faceLen(b, f), ch = Math.min(b.wallH - 2, 22), u0 = 4 / len, u1 = 1 - 4 / len, trim = g.trim;
    const band = faceQuad(b, f, u0 - 2 / len, u1 + 2 / len, 0, ch); B.plane(ctx, band, g.wallBase, (f === 0 ? -0.1 : -0.48) - 0.32, { vert: true, amp: 0.1, rim: 0.1 });
    if (Number.isFinite(g.doorU) && g.doorBox === b) { /* the door was drawn before: repaint it over the band */ drawDoor(ctx, b, env, { night: g.night, wide: g.doorWide, face: f }); }
    for (let k = 0; k < n; k++) { const p = facePt(b, f, u0 + (u1 - u0) * (k + 0.5) / n, 0, 2); B.column(ctx, p[0], p[1] + 1, ch + 1, 1.7, '#F3EBD8', env); }
    const e = faceQuad(b, f, u0 - 2 / len, u1 + 2 / len, ch, ch + 3.5, 2); B.fillQuadShaded(ctx, e, trim, { face: f === 0 ? 'sw' : 'se', material: 'stone', noAO: true }, env);
    return { u0: u0 - 2 / len, u1: u1 + 2 / len, ch: ch + 3.5 };
  }
  /** a ground-floor arcade on both faces: a recessed band with limestone piers every 14 px, round arch heads (keystone), the lit floor of each bay */
  function drawArcade(ctx, b, tall, night, env) {
    const g = b.g; if (b.wallH < 12) return;
    const H = tall ? 20 : 12, trim = g.trim;
    for (const f of [0, 1]) {
      const len = faceLen(b, f), x0 = 3, x1 = len - 3, n = Math.max(1, Math.round((x1 - x0) / 14)), aw = (x1 - x0) / n, ft = f === 0 ? -0.1 : -0.48;
      B.plane(ctx, faceQuad(b, f, x0 / len, x1 / len, 0, H + 2), g.wallBase, ft - 0.55, { vert: true, amp: 0.1, rim: 0.05 });   // the dark depth of the walkway
      for (let k = 0; k < n; k++) {
        const ax = x0 + aw * k + 3, bx = x0 + aw * (k + 1) - 3; if (bx - ax < 3) continue;
        const u0 = ax / len, u1 = bx / len, um = (ax + bx) / 2 / len;
        const a = facePt(b, f, um, H - 1), w = (bx - ax) / 2, ang = Math.atan2(facePt(b, f, u1, H - 1)[1] - facePt(b, f, u0, H - 1)[1], facePt(b, f, u1, H - 1)[0] - facePt(b, f, u0, H - 1)[0]);
        ctx.fillStyle = tone(g.wallBase, ft - 0.75, 1); ctx.beginPath(); ctx.ellipse(a[0], a[1], w, 2.4, ang, Math.PI, 0); ctx.fill();   // the arch head over the bay
        line(ctx, facePt(b, f, u0 + 0.5 / len, 1.5), facePt(b, f, u1 - 0.5 / len, 1.5), 1, night ? GLOWS[0] : trim, night ? 0.4 : 0.2, night ? 0.8 : 0.5);   // the lit floor
        const p = facePt(b, f, (x0 + aw * k + 1) / len, 0, 1.2); B.column(ctx, p[0], p[1], H + 2, 1.1, trim, env);   // pier
        B.orb(ctx, a[0], a[1] - 2.8, 0.7, 0.7, trim, 0.5, { noRim: true });   // keystone
      }
      const p = facePt(b, f, (x1 - 1) / len, 0, 1.2); B.column(ctx, p[0], p[1], H + 2, 1.1, trim, env);
      line(ctx, facePt(b, f, x0 / len, H + 2.6, 1.2), facePt(b, f, x1 / len, H + 2.6, 1.2), 1.2, trim, f === 0 ? 0.6 : -0.1, 0.9);   // the string course over the arcade
    }
  }
  /** a pediment over the column run: a limestone triangle with a gold seal (or the clock) */
  function drawPediment(ctx, b, cols, withClock, env) {
    if (!cols) return; const g = b.g, f = b.doorFace, len = faceLen(b, f), rise = Math.max(5, (cols.u1 - cols.u0) * len / 7);
    const p0 = facePt(b, f, cols.u0, cols.ch, 2), p1 = facePt(b, f, cols.u1, cols.ch, 2), pm = facePt(b, f, (cols.u0 + cols.u1) / 2, cols.ch + rise, 2);
    B.plane(ctx, [p0, p1, pm], g.trim, f === 0 ? 0.15 : -0.3, { amp: 0.12, rim: 0.3 });
    const sy = pm[1] + Math.max(2, rise / 2) + 1;
    if (withClock) { B.orb(ctx, pm[0], sy, 3, 3, C.white, 0.3, { spec: 0.4 }); line(ctx, [pm[0], sy], [pm[0] + 1.6, sy - 1.4], 0.7, C.iron, 0, 1); line(ctx, [pm[0], sy], [pm[0] - 0.4, sy - 2.2], 0.7, C.iron, 0, 1); }
    else B.decal(ctx, { x: pm[0], y: sy + 1.8, w: 3.6, h: 3.6, color: C.gold, trim: C.purple, shape: 'disc', face: f === 0 ? 'sw' : 'se' }, env);
    B.orb(ctx, pm[0], pm[1] - 0.8, 0.8, 0.8, C.gold, 0.3, { noRim: true });
  }
  /** a gallery at the first-floor line: slab, iron rail (balusters at lod 0), slender posts to the ground between the windows */
  function drawGallery(ctx, b, both, env, levels) {
    const g = b.g; if (b.floors < 2) return;
    const faces = both ? [0, 1] : [b.doorFace], lod0 = env.lod === 0, nl = levels || 1, d = 3;
    for (const f of faces) {
      const len = faceLen(b, f);
      for (let l = 1; l <= nl; l++) {
        const h = l * FLOOR_PX;
        B.fillQuadShaded(ctx, [facePt(b, f, 0, h, 0), facePt(b, f, 1, h, 0), facePt(b, f, 1, h, d), facePt(b, f, 0, h, d)], g.trim, { face: 'top', material: 'stone', noAO: true, t: f === 0 ? 0.1 : -0.25 }, env);
        line(ctx, facePt(b, f, 0, h - 1, d), facePt(b, f, 1, h - 1, d), 1, g.trim, f === 0 ? -0.3 : -0.7, 0.8);
        line(ctx, facePt(b, f, 0, h + 3.5, d), facePt(b, f, 1, h + 3.5, d), 0.9, C.iron, 0.3, 0.95);   // the rail
        if (lod0) for (let s = 2; s < len; s += 2.5) line(ctx, facePt(b, f, s / len, h, d), facePt(b, f, s / len, h + 3.5, d), 0.55, C.iron, 0, 0.8);
      }
      const top = nl * FLOOR_PX + 3.5;
      for (let s = 6; s < len - 3; s += 12) {
        const u = s / len; let clash = false;
        for (const c of b.cells) if (c.face === f && c.r === 0 && u >= c.u0 - 2 / len && u <= c.u1 + 1.5 / len) { clash = true; break; }
        if (clash || (g.doorBox === b && g.doorFace === f && Math.abs(u - g.doorU) < 6 / len)) continue;
        const p = facePt(b, f, u, 0, d); B.column(ctx, p[0], p[1], top, 0.7, C.iron, env);
      }
    }
  }
  /** striped awnings in the accent colour over the entrance face's ground-floor windows and the door */
  function drawAwnings(ctx, b, env) {
    const g = b.g, f = b.doorFace, len = faceLen(b, f), acc = g.paint.accent || C.gold, lod0 = env.lod === 0;
    const one = (u0, u1, h) => { const q = [facePt(b, f, u0 - 1 / len, h, 0), facePt(b, f, u1 + 1 / len, h, 0), facePt(b, f, u1 + 2 / len, h - 2.2, 3), facePt(b, f, u0 - 2 / len, h - 2.2, 3)]; B.fillQuadShaded(ctx, q, acc, { face: f === 0 ? 'sw' : 'se', material: 'cloth', noAO: true }, env); if (lod0) { const n = Math.max(2, Math.round((u1 - u0) * len / 2)); for (let i = 1; i < n; i += 2) { const t = i / n; line(ctx, lerp(q[0], q[1], t), lerp(q[3], q[2], t), 0.9, C.offWhite, 0.3, 0.8); } } line(ctx, q[3], q[2], 0.8, acc, -0.6, 0.8); };
    for (const c of b.cells) if (c.face === f && c.r === 0) one(c.u0, c.u1, c.h1 + 1.2);
    if (g.doorBox === b && g.doorFace === f) one(g.doorU - 3.5 / len, g.doorU + 3.5 / len, 8.5);
  }
  /** a purple sign board with gold edge and gold marks on the far face's centre (no text: fonts are not deterministic) */
  function drawSign(ctx, b, text, night, env) {
    const g = b.g; if (!text || b.wallH < 12) return; const f = 1 - b.doorFace, len = faceLen(b, f), w = Math.min(len - 6, text.length * 4 + 3), h = 6;
    const u0 = 0.5 - w / 2 / len, u1 = 0.5 + w / 2 / len, top = b.wallH - 3;
    B.fillQuadShaded(ctx, faceQuad(b, f, u0, u1, top - h, top, 0.6), C.purple, { face: f === 0 ? 'sw' : 'se', material: 'paint', noAO: true }, env);
    line(ctx, facePt(b, f, u0, top, 0.6), facePt(b, f, u1, top, 0.6), 0.8, C.gold, night ? 0.6 : 0.1, 0.9);
    for (let i = 0; i < text.length; i++) { const u = u0 + (u1 - u0) * (i + 0.5) / text.length; line(ctx, facePt(b, f, u, top - h + 1.6, 0.7), facePt(b, f, u, top - 1.6, 0.7), 1.3, C.gold, night ? 0.7 : 0.2, 0.95); }
  }
  /** the Roux banner pair flanking the door: purple cloth, gold border, a gold diamond over a tiger-orange stripe */
  function drawRouxBanners(ctx, b, env) {
    const g = b.g; if (!(g.doorBox === b) || b.wallH < 24) return; const f = g.doorFace, len = faceLen(b, f), top = b.wallH - 5;
    for (const dx of [-11, 11]) {
      const u0 = g.doorU + (dx - 2.5) / len, u1 = g.doorU + (dx + 2.5) / len;
      B.fillQuadShaded(ctx, faceQuad(b, f, u0, u1, top - 11, top, 0.5), C.purple, { face: f === 0 ? 'sw' : 'se', material: 'cloth', noAO: true }, env);
      line(ctx, facePt(b, f, u0, top - 11, 0.6), facePt(b, f, u0, top, 0.6), 0.7, C.gold, 0.2, 0.9); line(ctx, facePt(b, f, u1, top - 11, 0.6), facePt(b, f, u1, top, 0.6), 0.7, C.gold, -0.2, 0.9); line(ctx, facePt(b, f, u0, top, 0.6), facePt(b, f, u1, top, 0.6), 0.7, C.gold, 0.3, 0.9);
      const m = facePt(b, f, (u0 + u1) / 2, top - 4.5, 0.8); B.decal(ctx, { x: m[0], y: m[1] + 1.4, w: 2.6, h: 2.8, color: C.gold, trim: null, shape: 'diamond', face: f === 0 ? 'sw' : 'se' }, env);
      line(ctx, facePt(b, f, u0 + 0.6 / len, top - 8.5, 0.8), facePt(b, f, u1 - 0.6 / len, top - 8.5, 0.8), 1.2, C.tigerOrange, 0, 0.95);
    }
  }
  /** a louvered cupola on the ridge centre: box, louvers (lit at night), pyramid cap or a gold dome with a finial */
  function drawCupola(ctx, b, gold, night, env) {
    if (!b.ridge) return; const g = b.g, m = mid(b.ridge[0], b.ridge[1]), x = m[0], y = m[1] - 1, bw = gold ? 10 : 8, bh = gold ? 7 : 6, hw = bw / 2;
    B.fillQuadShaded(ctx, [[x - hw, y - bh], [x, y - bh + hw / 2], [x, y + hw / 2 - 1], [x - hw, y - 1]], g.wallBase, { face: 'sw', material: 'stucco', noAO: true }, env);
    B.fillQuadShaded(ctx, [[x, y - bh + hw / 2], [x + hw, y - bh], [x + hw, y - 1], [x, y + hw / 2 - 1]], g.wallBase, { face: 'se', material: 'stucco', noAO: true }, env);
    for (const dx of (gold ? [-3.2, 0, 3.2] : [-2, 1.5])) { const lit = night && dx !== 0; line(ctx, [x + dx, y - bh + 2.2 + Math.abs(dx) * 0.25], [x + dx, y - 1.4 + Math.abs(dx) * 0.25], 1, lit ? GLOWS[1] : C.iron, lit ? 0.5 : -0.1, 0.95); }
    const cap = [[x - hw - 1, y - bh - 0.6], [x, y - bh + hw / 2 - 0.6], [x + hw + 1, y - bh - 0.6]];
    line(ctx, cap[0], cap[1], 1, g.trim, 0.8, 0.9); line(ctx, cap[1], cap[2], 1, g.trim, 0.2, 0.9);
    if (gold) { B.orb(ctx, x, y - bh - hw * 0.35, hw * 0.9, hw * 0.55, C.gold, 0.1, { spec: 0.5 }); line(ctx, [x, y - bh - hw * 0.9], [x, y - bh - hw * 0.9 - 3], 1, C.gold, 0.5, 1); B.orb(ctx, x, y - bh - hw * 0.9 - 3.4, 0.9, 0.9, C.white, 0.5, { noRim: true }); }
    else { B.plane(ctx, [[x - hw, y - bh - 0.5], [x + hw, y - bh - 0.5], [x, y - bh - hw * 0.9]], b.roofColor, 0.3, { amp: 0.2, rim: 0.3 }); line(ctx, [x, y - bh - hw * 0.9], [x, y - bh - hw * 0.9 - 2.5], 1, C.gold, 0.3, 1); }
  }
  /** two gabled dormers on the front roof plane with a lit pane at night */
  function drawDormers(ctx, b, night, env) {
    const pl = b.planes && b.planes.front; if (!pl || pl.length < 4) return;
    const g = b.g;
    for (const t of [0.3, 0.7]) {
      const e = lerp(pl[0], pl[1], t), r = lerp(pl[3], pl[2], t), base = lerp(e, r, 0.3), top = lerp(e, r, 0.62);
      const x = base[0], y0 = base[1], y1 = top[1], w = 3.2;
      B.fillQuadShaded(ctx, [[x - w, y0], [x + w, y0], [x + w, y1], [x - w, y1]], g.wallBase, { face: b.planes.along ? 'sw' : 'se', material: 'stucco', noAO: true }, env);
      const pane = [[x - 1.3, y0 - 1], [x + 1.3, y0 - 1], [x + 1.3, y1 + 1], [x - 1.3, y1 + 1]];
      if (night) B.glow(ctx, pane, GLOWS[0], env); else B.fillQuadShaded(ctx, pane, C.glass, { face: 'sw', material: 'glass' }, env);
      B.plane(ctx, [[x - w - 0.8, y1], [x + w + 0.8, y1], [x, y1 - w * 0.9]], b.roofColor, 0.25, { amp: 0.2, rim: 0.3 });
    }
  }
  /** roof equipment: hvac box, water tank on legs, vents, a brick stack — on the ridge (hip / gable) or the top quad (flat) */
  function drawRoofGear(ctx, b, env) {
    const g = b.g, isFlat = !b.planes || b.planes.kind === 'flat';
    const hvac = (p) => { const x = p[0], y = p[1]; B.fillQuadShaded(ctx, [[x - 4.5, y - 2.2], [x, y], [x, y - 5], [x - 4.5, y - 7.2]], C.steel, { face: 'sw', material: 'metal', noAO: true }, env); B.fillQuadShaded(ctx, [[x, y], [x + 4.5, y - 2.2], [x + 4.5, y - 7.2], [x, y - 5]], C.steel, { face: 'se', material: 'metal', noAO: true }, env); B.fillQuadShaded(ctx, [[x - 4.5, y - 7.2], [x, y - 9.4], [x + 4.5, y - 7.2], [x, y - 5]], C.steel, { face: 'top', material: 'metal', noAO: true }, env); B.orb(ctx, x, y - 7.2, 1.6, 0.9, C.iron, -0.2, { noRim: true }); };
    const tank = (p) => { const x = p[0], y = p[1]; for (const dx of [-3.2, 3.2]) B.column(ctx, x + dx, y + 0.5, 3.5, 0.8, C.iron, env); B.column(ctx, x, y - 3, 7, 4, C.steel, env); B.orb(ctx, x, y - 10.2, 4, 1.8, C.steel, 0.15, { spec: 0.4 }); };
    const vent = (p) => { B.column(ctx, p[0], p[1], 4, 1, C.tin, env); B.orb(ctx, p[0], p[1] - 4.3, 1.6, 0.8, C.tin, 0.1, { noRim: true }); };
    const stack = (p) => { B.column(ctx, p[0], p[1], 10, 1.5, C.brick, env); B.orb(ctx, p[0], p[1] - 10.3, 2.1, 0.9, C.brick, -0.3, { noRim: true }); };
    if (hasF(g, 'hvac')) { hvac(isFlat ? roofTop(b, 0.3, 0.35) : roofTop(b, 0.2)); if (isFlat && g.fw + g.fh >= 7) hvac(roofTop(b, 0.7, 0.3)); }
    if (hasF(g, 'tank') || (hasD(g, 'tank') && !hasF(g, 'tank'))) tank(isFlat ? roofTop(b, 0.65, 0.65) : roofTop(b, 0.78));
    if (hasF(g, 'stack')) stack(isFlat ? roofTop(b, 0.2, 0.75) : roofTop(b, 0.9));
    if (hasF(g, 'vents') || hasD(g, 'vents')) for (const u of [0.35, 0.55]) { const p = isFlat ? roofTop(b, u, 0.6) : roofTop(b, u); vent([p[0] + (isFlat ? 0 : 3), p[1] - (isFlat ? 0 : 1)]); }
  }
  /** a downspout at the front corner */
  function drawGutters(ctx, b) { const p0 = facePt(b, 0, 1, b.wallH - 2, 0.8), p1 = facePt(b, 0, 1, 1, 0.8); line(ctx, p0, p1, 1, C.iron, 0.2, 0.9); line(ctx, p1, [p1[0] + 1.5, p1[1] + 0.8], 1, C.iron, 0.1, 0.9); }
  /** a flagpole on the apron corner with a purple-and-gold flag (wave by frame) */
  function drawFlagpole(ctx, g, frame, env) {
    const p = g.frontLeft ? marginPt(g, 0, 0.82, true) : marginPt(g, 1, 0.82, true), wave = frame & 1;
    B.column(ctx, p[0], p[1], 24, 0.7, C.limestone, env); B.orb(ctx, p[0], p[1] - 24.6, 0.9, 0.9, C.gold, 0.4, { noRim: true });
    B.fillQuadShaded(ctx, [[p[0] + 1, p[1] - 23], [p[0] + 7, p[1] - 23 + wave], [p[0] + 7, p[1] - 21 + wave], [p[0] + 1, p[1] - 21]], C.purple, { face: 'sw', material: 'cloth', noAO: true }, env);
    B.fillQuadShaded(ctx, [[p[0] + 1, p[1] - 21], [p[0] + 7 - wave, p[1] - 21 + wave], [p[0] + 7 - wave, p[1] - 19 + wave], [p[0] + 1, p[1] - 19]], C.gold, { face: 'sw', material: 'cloth', noAO: true }, env);
  }
  /** string lights along the SE face's eave (gold bulbs, lit at night) */
  function drawStringLights(ctx, b, night, env) { const len = faceLen(b, 1); for (let k = 0; k < 5; k++) { const p = facePt(b, 1, (4 + (k + 0.5) * (len - 8) / 5) / len, b.wallH - 3 - (k & 1), 0.6); B.orb(ctx, p[0], p[1], 0.8, 0.8, night ? GLOWS[0] : C.gold, night ? 0.6 : 0.2, { noRim: true }); } void env; }
  /** a beacon on a short post at the roof centre (red, lit) */
  function drawBeacon(ctx, p, lit, env) { B.column(ctx, p[0], p[1], 4, 0.6, C.iron, env); B.orb(ctx, p[0], p[1] - 4.8, 1.4, 1.4, lit ? '#FF5A4A' : '#8A2A2A', lit ? 0.5 : -0.1, { spec: lit ? 0.6 : 0.2 }); }
  /** grey pipes along the base of the SE face */
  function drawPipes(ctx, b, env) { const len = faceLen(b, 1); for (const h of [2.5, 5]) line(ctx, facePt(b, 1, 0.1, h, 1.2), facePt(b, 1, 0.9, h, 1.2), 1.4, C.steel, 0.2, 0.95); for (const u of [0.25, 0.75]) B.column(ctx, facePt(b, 1, u, 0, 1.2)[0], facePt(b, 1, u, 0, 1.2)[1] + 0.5, 6, 0.9, C.steel, env); void len; }
  /** props placed by HD_ROWS: clarifier (concrete ring + teal water + skimmer), dish, dock planks, a rooftop crane gantry, a couch on the lawn, cars, a magnolia */
  function drawProp(ctx, g, b, pr, frame, night, env) {
    const at = pr.roof ? roofTop(b, pr.roof[0], pr.roof[1]) : pr.margin ? marginPt(g, pr.margin[0], pr.margin[1], true) : pr.at ? fp(g, pr.at[0], pr.at[1], 0, true) : null;
    switch (pr.kind) {
      case 'clarifier': { const x = at[0], y = at[1] - 2; B.orb(ctx, x, y, 10, 5, C.concrete, 0.1, { noRim: true }); B.puddle(ctx, x, y - 0.4, 8, 4, env, { t: -0.15, spec: 0.35, rim: 0.3 }); const a = (frame & 1) ? 1 : -1; line(ctx, [x - 7 * a, y - 2], [x + 7 * a, y + 2], 1, C.concrete, 0.6, 0.9); B.orb(ctx, x, y - 0.6, 1, 1, C.iron, 0, { noRim: true }); break; }
      case 'dish': { const x = at[0], y = at[1]; B.column(ctx, x, y, 5, 0.6, C.iron, env); B.orb(ctx, x - 1.5, y - 7, 3.4, 2.6, C.offWhite, 0.2, { spec: 0.5 }); line(ctx, [x - 1.5, y - 7], [x + 1.5, y - 9], 0.7, C.iron, 0, 1); break; }
      case 'dock': { const p0 = marginPt(g, 0, 0.02, true), p1 = marginPt(g, 0, 0.5, true); line(ctx, p0, p1, 3.2, C.boardwalk, 0, 1); line(ctx, p0, p1, 1.2, C.boardwalk, 0.35, 0.6); const n = env.lod === 0 ? 8 : 4; for (let i = 1; i < n; i++) { const p = lerp(p0, p1, i / n); line(ctx, [p[0] - 1.6, p[1] + 0.8], [p[0] + 1.6, p[1] - 0.8], 0.6, C.boardwalk, -0.7, 0.6); } break; }
      case 'crane': { const x = at[0], y = at[1]; B.column(ctx, x, y, 14, 1.1, C.crane, env); line(ctx, [x, y - 14], [x + 14, y - 11], 1.3, C.crane, 0.1, 1); line(ctx, [x, y - 14], [x - 5, y - 13], 1.3, C.crane, -0.2, 1); line(ctx, [x, y - 16], [x + 11, y - 11.6], 0.6, C.iron, 0.2, 0.9); line(ctx, [x + 10, y - 11.8], [x + 10, y - 6], 0.6, C.iron, 0.2, 0.9); B.orb(ctx, x + 10, y - 5.4, 1, 1, C.iron, 0.1, { noRim: true }); break; }
      case 'couch': { const x = at[0], y = at[1]; B.fillQuadShaded(ctx, [[x - 4, y - 1], [x + 4, y - 1], [x + 4, y - 3.6], [x - 4, y - 3.6]], C.purple, { face: 'sw', material: 'cloth', noAO: true }, env); B.fillQuadShaded(ctx, [[x - 4, y - 3.6], [x + 4, y - 3.6], [x + 4, y - 5.6], [x - 4, y - 5.6]], C.purple2, { face: 'top', material: 'cloth', noAO: true }, env); break; }
      case 'cars': { if (g.lift > 0) break; const CARS = [['#C9CDD2', 72, 13], ['#2B2B33', 85, 13], ['#B03A3A', 72, 23], ['#E8E8E8', 85, 23], ['#3D6FA8', 85, 33], ['#8A6A3A', 72, 33]]; for (let i = 0; i < CARS.length; i++) { if (i === 5 && (g.seed & 1)) continue; const p = fp(g, CARS[i][1], CARS[i][2], 0, true); const x = p[0], y = p[1]; B.shadow(ctx, { x: x + 1, y: y + 0.5, rx: 5.5, ry: 2, a: 0.3 }, env); B.fillQuadShaded(ctx, [[x - 4.5, y], [x + 4.5, y], [x + 4.5, y - 3], [x - 4.5, y - 3]], CARS[i][0], { face: 'sw', material: 'paint', noAO: true }, env); B.orb(ctx, x, y - 4, 2.6, 1.6, CARS[i][0], 0.1, { spec: 0.5 }); B.orb(ctx, x - 4.4, y - 1.6, 0.6, 0.6, night ? GLOWS[0] : C.offWhite, 0.5, { noRim: true }); B.orb(ctx, x + 4.4, y - 1.6, 0.6, 0.6, '#E0443E', 0.2, { noRim: true }); } break; }
      case 'magnolia': {   // a southern magnolia in a round lawn bed: trunk, three glossy dark-green crowns, cream blossoms
        if (g.lift > 0) break; const p = fp(g, 58, 64, 0, true), x = p[0], y = p[1];
        B.orb(ctx, x, y + 1, 13, 6, C.lawn, -0.15, { noRim: true }); B.shadow(ctx, { x: x + 2, y: y + 1, rx: 10, ry: 4, a: 0.35 }, env);
        B.column(ctx, x, y, 8, 1.3, C.bark, env);
        B.orb(ctx, x + 1, y - 13, 11, 7.5, '#2E5A2A', -0.1, { spec: 0.25 }); B.orb(ctx, x - 4, y - 17, 7, 5, '#2E5A2A', 0.15, { spec: 0.35 }); B.orb(ctx, x + 5, y - 18, 5.5, 4, '#2E5A2A', 0.25, { spec: 0.35 });
        if (env.lod === 0) for (let i = 0; i < 6; i++) { const bx = x - 8 + (hash(g.seed, 40 + i) % 17), by = y - 21 + (hash(g.seed, 50 + i) % 11); B.orb(ctx, bx, by, 1.1, 1.1, '#FFF8E6', 0.4, { noRim: true }); }
        break; }
      default: break;
    }
  }

  // ---------------------------------------------------------------------------
  // Margins: the entrance walk, steps, planters, two lamps, hedges / chain fence, tees (after the structure: they stand in front of the walls)
  // ---------------------------------------------------------------------------
  function lampPost(ctx, p, night, base, env) {
    if (night) { B.softEllipse(ctx, p[0], p[1], 7, 3, C.glow, 0.35, 0.2); }
    B.column(ctx, p[0], p[1], 10, 0.8, C.lampPost, env);
    const head = [[p[0] - 1.5, p[1] - 10], [p[0] + 1.5, p[1] - 10], [p[0] + 1.5, p[1] - 12.6], [p[0] - 1.5, p[1] - 12.6]];
    if (night) B.glow(ctx, head, GLOWS[0], env); else B.fillQuadShaded(ctx, head, C.lampHead, { face: 'sw', material: 'glass', noAO: true }, env);
    B.orb(ctx, p[0], p[1] - 13.2, 1.2, 0.7, C.lampPost, 0.1, { noRim: true });
    void base;
  }
  /** a strip of surface material from the wall base of box b (face f, centred at u, half-width hw px) out across the apron to `len` px; a doorway at the wall when `door` */
  function strip(ctx, b, f, u, hw, len, material, env, o) {
    o = o || {}; const g = b.g, L = faceLen(b, f), d = hw / L;
    const q = [facePt(b, f, u - d, 0, 0, true), facePt(b, f, u + d, 0, 0, true), facePt(b, f, u + d, 0, len, true), facePt(b, f, u - d, 0, len, true)];
    const col = material === 'boardwalk' ? C.boardwalk : material === 'road' ? C.asphalt : material === 'gravel' ? C.gravel : C.walk;
    B.fillQuadShaded(ctx, q, col, { face: 'top', material: material === 'boardwalk' ? 'wood' : 'stone', t: 0.05, noAO: true }, env);
    line(ctx, q[0], q[3], 0.8, col, -0.55, 0.8); line(ctx, q[1], q[2], 0.8, col, -0.55, 0.8);
    if (material === 'boardwalk') { const n = Math.max(2, Math.round(len / 3)); for (let i = 1; i < n; i++) line(ctx, lerp(q[0], q[3], i / n), lerp(q[1], q[2], i / n), 0.6, col, -0.6, 0.6); for (const s of [-1, 1]) { const a = facePt(b, f, u + s * (d + 1.2 / L), 0, 1, true), c = facePt(b, f, u + s * (d + 1.2 / L), 0, len - 1, true); B.column(ctx, a[0], a[1], 3, 0.5, C.bark, env); B.column(ctx, c[0], c[1], 3, 0.5, C.bark, env); line(ctx, [a[0], a[1] - 3], [c[0], c[1] - 3], 0.6, C.bark, 0.2, 0.9); } }
    else if (material === 'gravel' && env.lod === 0) { const n = Math.round(len / 3); for (let i = 0; i < n; i++) { const p = lerp(lerp(q[0], q[1], (hash(g.seed, 500 + i) % 100) / 100), lerp(q[3], q[2], (hash(g.seed, 500 + i) % 100) / 100), (i + 0.5) / n); B.orb(ctx, p[0], p[1], 0.8, 0.5, col, 0.6, { noRim: true }); } }
    if (o.door) {   // a dark 3×5 doorway with a lintel; a lit transom at night
      const dq = faceQuad(b, f, u - 1.5 / L, u + 1.5 / L, 0, 5); flat(ctx, dq, g.wallBase, -0.9); line(ctx, facePt(b, f, u - 2 / L, 5.4), facePt(b, f, u + 2 / L, 5.4), 1, g.wallBase, 0.4, 0.9);
      if (o.night) B.glow(ctx, faceQuad(b, f, u - 1.5 / L, u + 1.5 / L, 3.6, 5), GLOWS[0], env);
    }
    return [u - (hw + 3) / L, u + (hw + 3) / L];
  }
  function drawMargins(ctx, g, b, variant, env) {
    const A = g.apron, night = g.night, pil = !!(variant & SPR.PILINGS), lod0 = env.lod === 0;
    const margin = Math.min(g.ipx, g.ipy), skips = [[], []];
    const skipped = (f, u, pad) => { for (const s of skips[f]) if (u >= s[0] - pad && u < s[1] + pad) return true; return false; };
    const hasDoor = b && b.wallH > 0 && !!g.row.pathAdjacency && g.doorBox && Number.isFinite(g.doorU);
    if (hasDoor) {
      const f = g.doorFace, L = faceLen(g.doorBox, f), len = (f === 0 ? g.ipy : g.ipx) + 2, u = g.doorU, db = g.doorBox;
      skips[f].push(strip(ctx, db, f, u, 3.5, len, pil ? 'boardwalk' : 'walk', env));
      if (!pil) {
        if (hasF(g, 'steps')) { B.fillQuadShaded(ctx, [facePt(db, f, u - 4.5 / L, 0, 0, true), facePt(db, f, u + 4.5 / L, 0, 0, true), facePt(db, f, u + 4.5 / L, 0, 1.2, true), facePt(db, f, u - 4.5 / L, 0, 1.2, true)], g.trim, { face: 'top', material: 'stone', t: 0.35, noAO: true }, env); B.fillQuadShaded(ctx, [facePt(db, f, u - 5.5 / L, 0, 1.2, true), facePt(db, f, u + 5.5 / L, 0, 1.2, true), facePt(db, f, u + 5.5 / L, 0, 2.6, true), facePt(db, f, u - 5.5 / L, 0, 2.6, true)], g.trim, { face: 'top', material: 'stone', t: 0.1, noAO: true }, env); }
        if (hasF(g, 'planters') && margin >= 10) for (const s of [-1, 1]) { const p = facePt(db, f, u + s * 7 / L, 0, 2.5, true); B.orb(ctx, p[0], p[1] - 1, 1.9, 1.3, C.clay, 0.1, { spec: 0.3 }); B.orb(ctx, p[0], p[1] - 3.6, 2.4, 1.8, C.green, 0.1, { spec: 0.3 }); if (lod0) { B.orb(ctx, p[0] - 1, p[1] - 4.2, 0.6, 0.6, C.azalea, 0.3, { noRim: true }); B.orb(ctx, p[0] + 1.1, p[1] - 3.3, 0.6, 0.6, C.azalea, 0.3, { noRim: true }); } }
      }
      for (const s of [-1, 1]) lampPost(ctx, facePt(db, f, u + s * 7 / L, 0, len - 2, true), night, A.base, env);
    }
    if (g.tees && b && b.wallH > 0) for (let i = 0; i < g.tees.length; i++) { const r = teeStrip(ctx, g, b, g.tees[i] | 0, night, pil, env); if (r) skips[r[0]].push([r[1], r[2]]); }
    if (pil || !b) return;
    const gb = mkBox(g, 0, g.fw * 32, 0, g.fh * 32, 0, 'none', 0);   // the footprint edges
    const toFace = (f, u) => { const L0 = faceLen(b, f); return f === 0 ? ((u * g.fw * 32) - b.X0) / L0 : (g.fh * 32 - u * g.fh * 32 - (g.fh * 32 - b.Y1)) / L0; };   // footprint u → the box face's u (for the skips)
    if (A.hedge && margin >= 10 && b.wallH > 0) {
      for (const f of [0, 1]) { const L = faceLen(gb, f); for (let s = 10; s < L - 8; s += 3) { const u = s / L; if (skipped(f, toFace(f, u), 0.5 / L)) continue; const p = facePt(gb, f, u, 0, -5.5, true); B.orb(ctx, p[0], p[1] - 1.6, 2.1, 1.7, C.hedge, ((s / 3) & 1) ? 0.15 : -0.05, { spec: 0.15 }); } }
    }
    if (A.fence) {
      for (const f of [0, 1]) { const L = faceLen(gb, f); for (let s = 6; s <= L - 6; s += 1) { const u = s / L; if (skipped(f, toFace(f, u), 2 / L)) continue; const p = facePt(gb, f, u, 0, -1.5, true); if ((s % 12) === 6) B.column(ctx, p[0], p[1], 6, 0.7, C.fence, env); else if ((s & 1) === 0 && lod0) B.orb(ctx, p[0], p[1] - 3.2, 0.5, 0.5, C.fence, -0.2, { noRim: true }); } const a = facePt(gb, f, 6 / L, 3.2, -1.5, true), c = facePt(gb, f, 1 - 6 / L, 3.2, -1.5, true); line(ctx, a, c, 0.5, C.fence, 0.2, 0.7); }
    }
  }
  /** tee pass: one connector per footprint-edge tile whose outward neighbour is a path / road / boardwalk; code = (surface << 6) | (side << 4) | k (sprites_buildings.teeCode) */
  function teeStrip(ctx, g, b, code, night, pil, env) {
    const side = (code >> 4) & 1, k = code & 15, surf = (code >> 6) & 3, n = side === 0 ? g.fh : g.fw;
    if (k >= n || k >= 16) return null;
    const f = side === 0 ? 1 : 0, L = faceLen(b, f);
    const u = side === 0 ? (b.Y1 - (g.fh * 32 - 32 * k - 16)) / L : ((g.fw * 32 - 32 * k - 16) - b.X0) / L;
    if (u < 0 || u > 1) return null;
    const planks = pil || surf === BSU.SURF.BOARDWALK, road = !planks && surf === BSU.SURF.ROAD;
    const r = strip(ctx, b, f, u, 3.5, (side === 0 ? g.ipx : g.ipy) + 2, planks ? 'boardwalk' : road ? 'road' : 'gravel', env, { door: true, night: night });
    return [f, r[0], r[1]];
  }

  // ---------------------------------------------------------------------------
  // Named bodies (the specials) — each returns the box that carries the door / windows for the margins and the states
  // ---------------------------------------------------------------------------
  function standardBody(ctx, g, frame, env, o) {
    o = o || {}; const b = o.box || mainBox(g), D = g.D, night = g.night, win = g.paint.windows || { cols: 0, rows: 0 };
    const cols = (D.windows && D.windows.cols) || [win.cols | 0, win.cols | 0], rows = (D.windows && D.windows.rows) || (win.rows | 0);
    drawWalls(ctx, b, env);
    layoutWindows(b, cols, rows, night, frame);
    drawWindows(ctx, b, env, { night: night, frame: frame });
    const wide = b.floors >= 2 || g.fw + g.fh >= 5; g.doorWide = wide;
    drawDoor(ctx, b, env, { wide: wide, night: night });
    drawRoof(ctx, b, env);
    if (hasD(g, 'arcade')) drawArcade(ctx, b, g.row.id === 'union', night, env);
    if (hasD(g, 'dome') && b.ridge) {   // the library's gold dome on a drum at the roof centre
      const m = mid(b.ridge[0], b.ridge[1]), r = Math.max(6, Math.min(g.fw, g.fh) * 5 + 2), col = g.paint.accent || C.gold;
      B.column(ctx, m[0], m[1] + 2, 6, r * 0.8, g.wallBase, env); B.orb(ctx, m[0], m[1] - 4 - r * 0.45, r, r * 0.72, col, 0.05, { spec: 0.55 }); line(ctx, [m[0], m[1] - 4 - r * 1.15], [m[0], m[1] - 4 - r * 1.15 - 3], 1.2, col, 0.5, 1); B.orb(ctx, m[0], m[1] - 7.6 - r * 1.15, 1, 1, C.white, 0.5, { noRim: true });
    }
    let cols2 = null;
    if (D.columns || hasD(g, 'columns')) cols2 = drawColumns(ctx, b, D.columns || 4, env);
    if (hasF(g, 'pediment')) drawPediment(ctx, b, cols2, hasD(g, 'clock'), env);
    else if (hasD(g, 'clock')) { const p = facePt(b, 1, 0.5, b.wallH * 0.62, 0.8); B.orb(ctx, p[0], p[1], 3, 3, C.white, 0.3, { spec: 0.4 }); line(ctx, [p[0], p[1]], [p[0] + 1.6, p[1] - 1.2], 0.7, C.iron, 0, 1); }
    if (hasF(g, 'gallery') || hasF(g, 'gallery:both')) drawGallery(ctx, b, hasF(g, 'gallery:both'), env);
    if (hasD(g, 'awning') || hasF(g, 'awnings')) drawAwnings(ctx, b, env);
    if (hasF(g, 'banner:roux')) drawRouxBanners(ctx, b, env);
    if (hasF(g, 'dormers')) drawDormers(ctx, b, night, env);
    if (hasF(g, 'cupola') || hasF(g, 'cupola:gold')) drawCupola(ctx, b, hasF(g, 'cupola:gold'), night, env);
    drawRoofGear(ctx, b, env);
    if (hasF(g, 'gutters')) drawGutters(ctx, b);
    const sign = featureArg(g, 'sign:'); if (sign) drawSign(ctx, b, sign, night, env);
    if (hasD(g, 'flag') && b.ridge) { const p = lerp(b.ridge[0], b.ridge[1], 0.9); B.column(ctx, p[0], p[1], 10, 0.6, C.limestone, env); B.fillQuadShaded(ctx, [[p[0] + 0.6, p[1] - 10], [p[0] + 5.5, p[1] - 10 + (frame & 1)], [p[0] + 5.5, p[1] - 7.5 + (frame & 1)], [p[0] + 0.6, p[1] - 7.5]], C.purple, { face: 'sw', material: 'cloth', noAO: true }, env); }
    if (hasF(g, 'flagpole')) drawFlagpole(ctx, g, frame, env);
    if (hasD(g, 'lights')) drawStringLights(ctx, b, night, env);
    if (hasD(g, 'beacon')) drawBeacon(ctx, roofTop(b, 0.5, 0.5), night || (frame & 1) === 1, env);
    if (hasD(g, 'pipes')) drawPipes(ctx, b, env);
    if (D.stripe) { const p0 = facePt(b, 1, 0.5, 0, 0.5), p1 = facePt(b, 1, 0.5, b.wallH, 0.5); line(ctx, p0, p1, 2.2, D.stripe, 0.1, 1); line(ctx, [p0[0] + 1, p0[1] - 0.5], [p1[0] + 1, p1[1] - 0.5], 0.8, D.stripe, -0.6, 0.8); }
    if (D.plaque) { const f = 1 - b.doorFace, L = faceLen(b, f), top = b.wallH * 0.55; B.fillQuadShaded(ctx, faceQuad(b, f, 0.5 - 7 / L, 0.5 + 7 / L, top - 6, top, 0.6), C.purple, { face: f === 0 ? 'sw' : 'se', material: 'paint', noAO: true }, env); for (const d of [-4, 0, 4]) line(ctx, facePt(b, f, 0.5 + d / L, top - 4.6, 0.8), facePt(b, f, 0.5 + d / L, top - 1.4, 0.8), 1.4, C.gold, 0.2, 0.95); }
    for (const pr of (D.props || [])) drawProp(ctx, g, b, pr, frame, night, env);
    return b;
  }
  /** the Bayou Bunkhouse: a plank box under an M of two tin gables, a breezeway through the long face, a porch with a tin awning, a clothesline in the yard */
  function bunkBody(ctx, g, frame, env) {
    const b = mainBox(g), night = g.night, longX = g.fw >= g.fh, f = longX ? 0 : 1;
    drawWalls(ctx, b, env);
    layoutWindows(b, longX ? [5, 2] : [2, 5], 1, night, frame, true);
    const bz0 = 0.5 - 6 / faceLen(b, f), bz1 = 0.5 + 6 / faceLen(b, f);
    b.cells = b.cells.filter((c) => c.face !== f || c.u1 < bz0 - 0.01 || c.u0 > bz1 + 0.01);
    drawWindows(ctx, b, env, { night: night, frame: frame });
    const entranceIsLong = b.doorFace === f;
    if (!entranceIsLong) drawDoor(ctx, b, env, { night: night, color: C.purple });
    // breezeway: a 12-px opening through the long face, dark inside with the yard's daylight showing through
    { const q = faceQuad(b, f, bz0, bz1, 0, 10); flat(ctx, q, g.wallBase, -0.95); B.edgeFade(ctx, q, q[0], q[1], 7, night ? GLOWS[0] : '#C9D6A4', 0.2, 0.55); for (const u of [bz0, bz1]) B.column(ctx, facePt(b, f, u, 0, 0.4)[0], facePt(b, f, u, 0, 0.4)[1], 10.5, 0.7, C.wood, env); line(ctx, facePt(b, f, bz0, 10.4), facePt(b, f, bz1, 10.4), 1, g.trim, f === 0 ? 0.5 : -0.2, 0.9); }
    if (entranceIsLong) { g.doorPt = facePt(b, f, 0.5, 0, 0, true); g.doorFace = f; g.doorU = 0.5; g.doorBox = b; }
    // porch: a plank deck 6 px out along the long face, posts every 12 px under a level tin awning at 13 px
    { const L = faceLen(b, f), D = 6, A = 4, H = 13; B.fillQuadShaded(ctx, [facePt(b, f, 0, 0, 0), facePt(b, f, 1, 0, 0), facePt(b, f, 1, 0, D), facePt(b, f, 0, 0, D)], C.wood, { face: 'top', material: 'wood', t: 0.15, noAO: true }, env); if (env.lod === 0) for (let s = 2; s < D; s += 2) line(ctx, facePt(b, f, 0, 0, s), facePt(b, f, 1, 0, s), 0.6, C.wood, -0.5, 0.6); line(ctx, facePt(b, f, 0, 0, D), facePt(b, f, 1, 0, D), 0.9, C.wood, -0.8, 0.8);
      for (let s = 4; s <= L - 3; s += 12) { const p = facePt(b, f, s / L, 0, A); B.column(ctx, p[0], p[1], H, 0.8, C.wood, env); }
      B.fillQuadShaded(ctx, [facePt(b, f, 0, H, 0), facePt(b, f, 1, H, 0), facePt(b, f, 1, H, A), facePt(b, f, 0, H, A)], C.tin, { face: 'top', material: 'metal', t: 0.1, noAO: true }, env);
      line(ctx, facePt(b, f, 0, H, A), facePt(b, f, 1, H, A), 1, C.tin, 0.7, 0.9); line(ctx, facePt(b, f, 0, H - 0.8, A), facePt(b, f, 1, H - 0.8, A), 0.8, C.tin, -0.8, 0.8);
      if (night) for (let s = 10; s < L; s += 24) { const p = facePt(b, f, s / L, 8, A); B.orb(ctx, p[0], p[1], 0.9, 0.9, GLOWS[0], 0.6, { noRim: true }); } }
    // two gable rows under one M roof
    { const D = longX ? (b.Y1 - b.Y0) : (b.X1 - b.X0), back = Math.round(D / 2), color = g.paint.roofColor || C.tin;
      const rowA = longX ? mkBox(g, b.X0, b.X1, b.Y0, b.Y0 + back, 1, 'gable', 11, color) : mkBox(g, b.X0, b.X0 + back, b.Y0, b.Y1, 1, 'gable', 11, color);
      const rowB = longX ? mkBox(g, b.X0, b.X1, b.Y0 + back, b.Y1, 1, 'gable', 11, color) : mkBox(g, b.X0 + back, b.X1, b.Y0, b.Y1, 1, 'gable', 11, color);
      drawRoof(ctx, rowA, env, { overhang: 2 }); drawRoof(ctx, rowB, env, { overhang: 2 });
      b.planes = rowB.planes; b.ridge = rowB.ridge;
      if (env.lod === 0) for (const rb of [rowA, rowB]) { const pl = rb.planes.front; for (let i = 0; i < 6; i++) { const t = 0.08 + (hash(g.seed, i * 7 + rb.Y0) % 84) / 100, s = 0.15 + (hash(g.seed, i * 11 + 3) % 70) / 100; const p = lerp(lerp(pl[0], pl[1], t), lerp(pl[3], pl[2], t), s); B.orb(ctx, p[0], p[1], 1.3, 0.7, '#8A5A3A', (i & 1) ? 0.1 : -0.2, { noRim: true }); } } }
    drawRoofGear(ctx, b, env);
    if (hasF(g, 'gutters')) drawGutters(ctx, b);
    if (!(g.lift > 0)) {   // the clothesline beside the short end
      const fc = longX ? 1 : 0, pt = (t, up) => facePt(b, fc, t, up, 8, true);
      const a = pt(0.06, 0), c = pt(0.4, 0); B.column(ctx, a[0], a[1], 11, 0.7, C.wood, env); B.column(ctx, c[0], c[1], 11, 0.7, C.wood, env);
      const ta = [a[0], a[1] - 11], tc = [c[0], c[1] - 11]; B.stroke(ctx, [ta, mid(ta, tc).map((v, i) => v + (i ? 2 : 0)), tc], 0.6, C.offWhite, 0.3, 0.9, { smooth: true });
      const cols = [C.white, C.gold, C.purple2, '#6FA8D8', C.offWhite, '#E07A5A'];
      for (let i = 0; i < 4; i++) { const p = lerp(ta, tc, 0.15 + 0.23 * i); const col = cols[hash(g.seed, i * 5) % cols.length], tall = 2.5 + (hash(g.seed, i) % 3); B.fillQuadShaded(ctx, [[p[0] - 1.8, p[1] + 1.5], [p[0] + 1.8, p[1] + 1.5], [p[0] + 1.8, p[1] + 1.5 + tall], [p[0] - 1.8, p[1] + 1.5 + tall]], col, { face: 'sw', material: 'cloth', noAO: true }, env); }
    }
    return b;
  }
  /** Magnolia Suites: an L of brick wings with two-level iron galleries round a paved courtyard, a parking apron with cars */
  function wingsBody(ctx, g, frame, env) {
    const night = g.night, roofColor = g.paint.roofColor || '#4C5566';
    if (!(g.lift > 0)) {   // courtyard pavers, parking asphalt, the lawn bed
      const q = (X0, X1, Y0, Y1) => [fp(g, X0, Y0, 0, true), fp(g, X1, Y0, 0, true), fp(g, X1, Y1, 0, true), fp(g, X0, Y1, 0, true)];
      const park = q(66, 92, 8, 38); B.fillQuadShaded(ctx, park, C.asphalt, { face: 'top', material: 'stone', t: 0, noAO: true }, env); line(ctx, park[3], park[2], 1, C.asphalt, -0.6, 0.9); line(ctx, park[2], park[1], 1, C.asphalt, -0.6, 0.9); line(ctx, park[0], park[3], 0.8, C.asphalt, 0.5, 0.8);
      for (const Y of [18, 28]) line(ctx, fp(g, 67, Y, 0, true), fp(g, 91, Y, 0, true), 0.6, C.asphalt, 0.7, 0.8); line(ctx, fp(g, 79, 9, 0, true), fp(g, 79, 37, 0, true), 0.6, C.asphalt, 0.5, 0.7);
      const cy = q(36, 86, 38, 90); B.fillQuadShaded(ctx, cy, '#CDB894', { face: 'top', material: 'stone', t: 0.05, noAO: true }, env);
      if (env.lod === 0) { for (let v = 42; v < 86; v += 6) line(ctx, fp(g, v, 39, 0, true), fp(g, v, 89, 0, true), 0.6, '#CDB894', -0.4, 0.4); for (let v = 44; v < 90; v += 6) line(ctx, fp(g, 37, v, 0, true), fp(g, 85, v, 0, true), 0.6, '#CDB894', -0.4, 0.4); }
      line(ctx, cy[3], cy[2], 1.4, C.brick, 0, 0.95); line(ctx, cy[2], cy[1], 1.4, C.brick, -0.2, 0.95);
    }
    const back = mkBox(g, 12, 64, 12, 38, 3, 'hip', 12, roofColor), left = mkBox(g, 12, 36, 38, 84, 3, 'hip', 12, roofColor);
    const wing = (w, cols, gal) => {
      drawWalls(ctx, w, env);
      layoutWindows(w, cols, 3, night, frame, true);
      drawWindows(ctx, w, env, { night: night, frame: frame });
      for (const gg of gal) drawGallery(ctx, w, gg === 2, env, 2);
    };
    wing(back, [5, 3], [2]);
    drawRoof(ctx, back, env);
    wing(left, [2, 4], [2]);
    // the front door on the courtyard face of the left wing: a green leaf, ivory surround, a fanlight
    drawDoor(ctx, left, env, { face: 1, u: 0.5, night: night, color: g.paint.accent || '#2E5C2A', h: 8 });
    drawRoof(ctx, left, env);
    g.doorFace = g.frontLeft ? 0 : 1; g.doorU = 0.5; g.doorBox = mainBox(g); g.doorPt = facePt(g.doorBox, g.doorFace, 0.5, 0, 0, true);
    const b = g.doorBox; b.wallH = 3 * FLOOR_PX; b.floors = 3; b.cells = back.cells.concat(left.cells); b.planes = left.planes; b.ridge = left.ridge; b.roofColor = roofColor; b.roof = 'hip';
    for (const pr of (g.D.props || [])) drawProp(ctx, g, b, pr, frame, night, env);
    if (hasF(g, 'gutters')) { drawGutters(ctx, back); drawGutters(ctx, left); }
    return b;
  }
  /** the substation: a gravel pad with two transformers (insulators, a white cap), pipes, the beacon */
  function substationBody(ctx, g, frame, env) {
    const b = mainBox(g), night = g.night;
    B.fillQuadShaded(ctx, topQuad(b, 0), C.gravelPad, { face: 'top', material: 'stone', t: -0.05, noAO: true }, env);
    const Xc = (b.X0 + b.X1) / 2, Yc = (b.Y0 + b.Y1) / 2;
    for (const o of [[-9, 7], [9, -7]]) {
      const tb = miniBox(ctx, g, Xc + o[0], Yc + o[1], 4.5, 4.5, 10, C.transformer, 'metal', env);
      for (const u of [0.3, 0.7]) { const p = facePt(tb, 0, u, 10, -4.5); B.column(ctx, p[0], p[1], 6, 0.6, C.offWhite, env); B.orb(ctx, p[0], p[1] - 6.4, 1.1, 0.7, C.white, 0.3, { noRim: true }); }
      const sp = facePt(tb, 0, 0.5, 5, 0.4); B.decal(ctx, { x: sp[0], y: sp[1] + 1.2, w: 3, h: 2.4, color: C.gold, trim: null, shape: 'rect', face: 'sw' }, env);
    }
    for (let i = 0; i < 2; i++) line(ctx, facePt(b, 1, 0.1, 3 + i * 2.5, 1), facePt(b, 1, 0.9, 3 + i * 2.5, 1), 1.2, C.steel, 0.2, 0.95);
    b.wallH = 0; b.planes = { kind: 'flat', top: 0 };
    drawBeacon(ctx, fp(g, Xc, Yc, 2), night || (frame & 1) === 1, env);
    return b;
  }
  /** the water tower: four steel legs with cross braces, a purple tank with a gold band and the BSU diamond, a dome, the beacon; frames 1 / 2 sway ±2 px, frame 3 toppled */
  function towerBody(ctx, g, frame, env) {
    const b = mainBox(g), night = g.night, f = ((frame % 4) + 4) % 4;
    B.fillQuadShaded(ctx, topQuad(b, 0), C.gravelPad, { face: 'top', material: 'stone', t: -0.05, noAO: true }, env);
    const Xc = (b.X0 + b.X1) / 2, Yc = (b.Y0 + b.Y1) / 2, c = fp(g, Xc, Yc, 0);
    b.wallH = 0; b.planes = { kind: 'flat', top: 0 };
    if (f === 3) {   // toppled: the tank on its side across the pad, leg stubs
      const x = c[0], y = c[1] - 6;
      for (const dx of [-14, -4, 6, 14]) line(ctx, [x + dx, y + 8], [x + dx + 3, y + 2], 1.4, C.steel, -0.2, 0.9);
      B.fillQuadShaded(ctx, [[x - 20, y - 8], [x + 20, y - 8], [x + 20, y + 8], [x - 20, y + 8]], C.purple, { face: 'sw', material: 'metal', noAO: true }, env);
      B.orb(ctx, x - 20, y, 5, 8, C.purple2, 0.1, { spec: 0.3 }); line(ctx, [x - 12, y - 8], [x - 12, y + 8], 2, C.gold, 0.2, 0.95);
      B.decal(ctx, { x: x + 4, y: y + 3.5, w: 6, h: 6, color: C.gold, trim: C.purple, shape: 'diamond', face: 'sw' }, env);
      return b;
    }
    const sway = f === 1 ? -2 : f === 2 ? 2 : 0, s = 9;   // a narrow trestle: four legs 9 footprint px off the centre, cross-braced on the two visible sides
    const legs = [[Xc - s, Yc - s], [Xc + s, Yc - s], [Xc - s, Yc + s], [Xc + s, Yc + s]].map((p) => fp(g, p[0], p[1], 0));
    const legH = 30, sx = sway * 0.6;
    const leg = (p) => { B.column(ctx, p[0] + sx, p[1], legH, 1.2, C.steel, env); };
    const brace = (p, q) => { line(ctx, [p[0] + sx, p[1] - legH * 0.8], [q[0] + sx, q[1] - legH * 0.2], 0.8, C.steel, -0.2, 0.9); line(ctx, [q[0] + sx, q[1] - legH * 0.8], [p[0] + sx, p[1] - legH * 0.2], 0.8, C.steel, -0.2, 0.9); line(ctx, [p[0] + sx, p[1] - legH * 0.5], [q[0] + sx, q[1] - legH * 0.5], 0.9, C.steel, 0.1, 0.9); };
    leg(legs[0]); leg(legs[1]);
    brace(legs[2], legs[0]); brace(legs[1], legs[3]);   // the SW and SE sides of the trestle
    brace(legs[2], legs[3]);
    leg(legs[2]); leg(legs[3]);
    const x = c[0] + sway, tankH = 20, r = 14, top = c[1] - legH - tankH + 4;
    B.column(ctx, x, top + tankH, tankH, r, C.purple, env);
    line(ctx, [x - r, top + 8], [x + r, top + 8], 2.2, C.gold, 0.2, 0.95);
    B.decal(ctx, { x: x - 3, y: top + 17, w: 6, h: 6, color: C.gold, trim: C.purple, shape: 'diamond', face: 'sw' }, env);
    B.orb(ctx, x, top, r, 6, C.purple2, 0.1, { spec: 0.45 });
    drawBeacon(ctx, [x, top - 5.5], night || (frame & 1) === 1, env);
    return b;
  }
  /** the generator: a gold metal cabinet on a dark skid, an exhaust stack, two vents, a purple plate */
  function generatorBody(ctx, g, frame, env) {
    const b = mainBox(g), Xc = (b.X0 + b.X1) / 2, Yc = (b.Y0 + b.Y1) / 2;
    B.fillQuadShaded(ctx, topQuad(b, 0), C.gravelPad, { face: 'top', material: 'stone', t: -0.05, noAO: true }, env);
    miniBox(ctx, g, Xc, Yc, 9, 7, 2.5, '#6A6A70', 'metal', env, 0, { noAO: true });
    const cab = miniBox(ctx, g, Xc, Yc, 8, 6, 10, C.gold, 'metal', env, 2.5);
    const sp = facePt(cab, 0, 0.5, 7, 0.4); B.decal(ctx, { x: sp[0], y: sp[1] + 1.6, w: 5, h: 3.2, color: C.purple, trim: C.gold, shape: 'rect', face: 'sw' }, env);
    const st = fp(g, Xc + 5, Yc - 4, 12.5); B.column(ctx, st[0], st[1], 6, 1.3, C.steel, env); B.orb(ctx, st[0], st[1] - 6.3, 1.7, 0.8, C.iron, -0.2, { noRim: true });
    for (const o of [[-3, 1], [1, 3]]) { const p = fp(g, Xc + o[0], Yc + o[1], 12.5); B.column(ctx, p[0], p[1], 2.5, 0.8, C.tin, env); }
    b.wallH = 0; b.planes = { kind: 'flat', top: 0 };
    void frame;
    return b;
  }
  const BODIES = { box: standardBody, bunk: bunkBody, wings: wingsBody, substation: substationBody, tower: towerBody, generator: generatorBody };

  // ---------------------------------------------------------------------------
  // Construction (3 frames), ruin, damage, boards, flood
  // ---------------------------------------------------------------------------
  function pallets(ctx, g, env) {
    const p = marginPt(g, 0, 0.6, true); miniBox(ctx, g, g.fw * 32 - g.ipx * 0.5, g.fh * 32 * 0.4, 4, 2.5, 4, C.brick, 'stone', env, 0, { noAO: true }); line(ctx, [p[0] - 5, p[1] + 0.5], [p[0] + 5, p[1] + 0.5], 1, C.wood, -0.3, 0.9);
    const l = marginPt(g, 1, 0.6, true); B.fillQuadShaded(ctx, [[l[0] - 4.5, l[1]], [l[0] + 4.5, l[1]], [l[0] + 4.5, l[1] - 3], [l[0] - 4.5, l[1] - 3]], C.wood, { face: 'sw', material: 'wood', noAO: true }, env); line(ctx, [l[0] - 4.5, l[1] - 1.5], [l[0] + 4.5, l[1] - 1.5], 0.6, C.wood, -0.6, 0.7);
  }
  function crane(ctx, b, hgt, env) {
    const q = topCorners(b, 0), x = q.N[0] + 4, base = q.N[1] + 6, top = base - hgt - 34;
    B.column(ctx, x, base, hgt + 34, 1.4, C.crane, env);
    B.fillQuadShaded(ctx, [[x - 3, top - 1], [x + 3, top - 1], [x + 3, top + 2], [x - 3, top + 2]], C.crane, { face: 'sw', material: 'metal', noAO: true }, env);
    B.fillQuadShaded(ctx, [[x + 3, top + 2], [x + 6, top + 2], [x + 6, top + 5], [x + 3, top + 5]], C.iron, { face: 'se', material: 'glass', noAO: true }, env);   // cab
    line(ctx, [x + 1, top - 2.5], [x + 44, top - 2.5], 2, C.crane, 0, 1); for (let dx = 4; dx < 44; dx += 4) line(ctx, [x + 1 + dx, top - 4], [x + 1 + dx + 2, top - 2.5], 0.6, C.crane, 0.5, 0.9);   // jib
    line(ctx, [x - 12, top - 2.5], [x + 1, top - 2.5], 2, C.crane, 0, 1); B.fillQuadShaded(ctx, [[x - 12, top - 2], [x - 7, top - 2], [x - 7, top + 1], [x - 12, top + 1]], C.iron, { face: 'sw', material: 'metal', noAO: true }, env);   // counter-jib + ballast
    line(ctx, [x + 1, top - 10], [x + 36, top - 4], 0.6, C.iron, 0.2, 0.9); line(ctx, [x + 1, top - 10], [x - 10, top - 4], 0.6, C.iron, 0.2, 0.9);   // pendants
    const hx = x + 30, hy = top + 6 + hgt / 4; line(ctx, [hx, top - 1.5], [hx, hy], 0.6, C.iron, 0, 0.9); B.orb(ctx, hx, hy + 1, 1.3, 1.3, C.iron, 0, { noRim: true });
  }
  function scaffoldFace(ctx, b, f, hgt, env) {
    const L = faceLen(b, f), top = hgt + 5, lod0 = env.lod === 0;
    for (let up = 7; up < top; up += 7) { line(ctx, facePt(b, f, -1 / L, up, 1.5), facePt(b, f, 1 + 1 / L, up, 1.5), 0.8, C.steel, -0.2, 0.9); line(ctx, facePt(b, f, -1 / L, up + 1, 1.5), facePt(b, f, 1 + 1 / L, up + 1, 1.5), 1.2, C.plywood, 0, 0.9); }
    for (let s = 0; s <= L; s += 8) { const p = facePt(b, f, s / L, 0, 1.5); B.column(ctx, p[0], p[1], top, 0.6, C.steel, env); if (lod0 && s + 8 <= L && ((s / 8) & 1)) line(ctx, facePt(b, f, s / L, 7, 1.5), facePt(b, f, (s + 7) / L, 14, 1.5), 0.6, C.steel, -0.3, 0.8); }
  }
  function scaffoldStage(ctx, g, frame, env) {
    const stage = ((frame % 3) + 3) % 3, b = mainBox(g), lod0 = env.lod === 0;
    const slab = () => { B.fillQuadShaded(ctx, topQuad(b, 0), C.concrete, { face: 'top', material: 'stone', t: 0.1, noAO: true }, env); B.plane(ctx, topQuad(b, 0.4, -4), C.concrete, 0.25, { amp: 0.08, rim: 0.15 }); if (lod0) for (let i = 0; i < 12; i++) { const p = fp(g, b.X0 + 4 + hash(g.seed, 600 + i) % Math.max(1, b.X1 - b.X0 - 8), b.Y0 + 4 + hash(g.seed, 650 + i) % Math.max(1, b.Y1 - b.Y0 - 8), 0.4); B.orb(ctx, p[0], p[1], 0.8, 0.5, C.concrete, -0.3, { noRim: true }); } };
    if (stage === 0) { slab(); const L = faceLen(b, 1); for (let s = 6; s < L; s += 12) { const p = facePt(b, 1, s / L, 0.4, -(b.X1 - b.X0) * 0.5); B.column(ctx, p[0], p[1], 2.2, 0.5, C.crane, env); } pallets(ctx, g, env); return b; }
    if (b.wallH <= 0) {   // wall-less rows: the slab stays, fencing goes up, then sand piles and stakes
      slab(); for (const f of [0, 1]) { const L = faceLen(b, f); for (let s = 0; s <= L; s += 8) { const p = facePt(b, f, s / L, 0, 0); B.column(ctx, p[0], p[1], 7, 0.6, C.steel, env); } line(ctx, facePt(b, f, 0, 5), facePt(b, f, 1, 5), 0.6, C.steel, 0, 0.8); line(ctx, facePt(b, f, 0, 2), facePt(b, f, 1, 2), 0.6, C.steel, 0, 0.8); }
      if (stage === 2) for (let i = 0; i < 3; i++) { const p = fp(g, b.X0 + (b.X1 - b.X0) * (0.25 + 0.25 * i), b.Y0 + (b.Y1 - b.Y0) * (0.3 + 0.2 * (i & 1)), 0.4); B.orb(ctx, p[0], p[1], 4, 2, C.sandbag, 0.2, { noRim: true }); }
      pallets(ctx, g, env); return b;
    }
    const full = stage === 2, hgt = full ? (b.wallH || 24) : Math.max(6, Math.round(b.wallH / 2) || 6), big = g.fw >= 3 && g.fh >= 3;
    if (big) crane(ctx, b, hgt, env);
    if (!full) {   // open to the sky: the slab floor and the inner faces of the two back walls, then the front walls
      B.fillQuadShaded(ctx, topQuad(b, 0), C.concrete, { face: 'top', material: 'stone', t: 0.2, noAO: true }, env);
      const q0 = topCorners(b, 0), qh = topCorners(b, hgt);
      B.fillQuadShaded(ctx, [q0.W, q0.N, qh.N, qh.W], C.block, { face: 'se', material: 'stone', noAO: true, t: 0.1 }, env); B.fillQuadShaded(ctx, [q0.N, q0.E, qh.E, qh.N], C.block, { face: 'sw', material: 'stone', noAO: true, t: -0.1 }, env);
    }
    drawWalls(ctx, b, env, { hgt: hgt, color: C.block, material: 'stone', raw: true });
    if (full) {
      B.fillQuadShaded(ctx, topQuad(b, hgt), C.wood, { face: 'top', material: 'wood', t: 0.1, noAO: true }, env);
      const win = g.paint.windows || { cols: 0, rows: 0 }, D = g.D; layoutWindows(b, (D.windows && D.windows.cols) || [win.cols | 0, win.cols | 0], (D.windows && D.windows.rows) || (win.rows | 0), false, 0);
      drawWindows(ctx, b, env, { opening: true });
      if (b.roofH > 0) {   // roof framing: ridge and rafters in raw lumber
        const q = topCorners(b, hgt), along = (b.X1 - b.X0) >= (b.Y1 - b.Y0), m0 = along ? mid(q.W, q.N) : mid(q.N, q.E), m1 = along ? mid(q.S, q.E) : mid(q.W, q.S);
        const a = lerp(m0, m1, 0.3), c = lerp(m0, m1, 0.7), rise = Math.max(2, b.roofH / 2); a[1] -= rise; c[1] -= rise;
        line(ctx, a, c, 1.2, C.wood, 0.5, 1); for (const cn of [q.W, q.S, q.E, q.N]) line(ctx, cn, ((cn === q.W || cn === q.N) === along) ? a : c, 0.9, C.wood, -0.1, 1);
        for (let i = 1; i < 4; i++) { const t = i / 4; line(ctx, along ? lerp(q.W, q.S, t) : lerp(q.S, q.E, t), along ? lerp(a, c, t) : lerp(c, a, t), 0.8, C.wood, 0.2, 0.9); }
      }
    } else { const L = faceLen(b, 0); for (let s = 3; s < L; s += 7) { const p = facePt(b, 0, s / L, hgt, 0); line(ctx, p, [p[0], p[1] - 3], 0.8, C.iron, 0.2, 0.9); } }
    scaffoldFace(ctx, b, 0, hgt, env); scaffoldFace(ctx, b, 1, hgt, env);
    pallets(ctx, g, env);
    return b;
  }
  /** RUIN: a rubble mound sized to the footprint, three standing stubs, a tarp corner */
  function ruinShape(ctx, g, env) {
    const b = mainBox(g), seed = g.seed, q = topQuad(b, 0);
    B.fillQuadShaded(ctx, q, C.rubble, { face: 'top', material: 'stone', t: -0.15, noAO: true }, env);
    const n = env.lod === 0 ? 40 : 20;
    for (let i = 0; i < n; i++) { const p = fp(g, b.X0 + hash(seed, i * 3) % Math.max(1, b.X1 - b.X0), b.Y0 + hash(seed, i * 3 + 1) % Math.max(1, b.Y1 - b.Y0), 1 + (hash(seed, i) % 5)); B.orb(ctx, p[0], p[1], 2 + (hash(seed, i * 7) % 3), 1.2 + (hash(seed, i * 5) % 2), C.rubble, (hash(seed, i * 11) % 3 - 1) * 0.3, { spec: 0.1 }); }
    for (let i = 0; i < 3; i++) { const p = facePt(b, 0, 0.2 + 0.3 * i, 0, 0); B.column(ctx, p[0], p[1] - 2, 6 + hash(seed, 900 + i) % 6, 1.2, C.rubble, env); }
    const t = fp(g, b.X1 - 10, b.Y0 + 8, 5); B.fillQuadShaded(ctx, [[t[0] - 5, t[1]], [t[0] + 5, t[1]], [t[0] + 4, t[1] - 4], [t[0] - 4, t[1] - 4]], C.tarp, { face: 'top', material: 'cloth', noAO: true }, env);
    return b;
  }
  /** a plywood board over a window cell */
  function boardCell(ctx, b, c, env) { const L = faceLen(b, c.face); const q = faceQuad(b, c.face, c.u0 - 1 / L, c.u1 + 1 / L, c.h0 - 1, c.h1 + 1, 0.3); B.fillQuadShaded(ctx, q, C.plywood, { face: c.face === 0 ? 'sw' : 'se', material: 'wood', noAO: true }, env); B.orb(ctx, q[3][0] + 0.8, q[3][1] + 0.8, 0.45, 0.45, C.iron, -0.5, { noRim: true }); B.orb(ctx, q[1][0] - 0.8, q[1][1] - 0.8, 0.45, 0.45, C.iron, -0.5, { noRim: true }); }
  /** DAMAGED: a cool overlay on everything, torn roof patches, a tarp, boarded and cracked windows, a wall crack, debris */
  function applyDamaged(ctx, g, b, env) {
    ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = css(C.cool, 0.2); ctx.fillRect(0, 0, g.w, g.h); ctx.restore();
    if (!b) return;
    const seed = g.seed, pl = b.planes && b.planes.front;
    if (pl && pl.length >= 3) {
      const at = (t, s) => { const e = lerp(pl[0], pl[1], t), r = pl.length === 4 ? lerp(pl[3], pl[2], t) : pl[2]; return lerp(e, r, s); };
      for (let i = 0; i < 3; i++) { const t = 0.18 + 0.3 * i + (hash(seed, i) % 10) / 100, s = 0.25 + (hash(seed, 7 + i) % 45) / 100, w = 0.08 + (hash(seed, 20 + i) % 6) / 100; B.plane(ctx, [at(t - w, s - 0.08), at(t + w, s - 0.08), at(t + w, s + 0.1), at(t - w, s + 0.1)], C.sheathing, -0.3, { amp: 0.12, rim: 0.1 }); B.orb(ctx, at(t, s + 0.14)[0], at(t, s + 0.14)[1], 1, 0.6, b.roofColor, 0.4, { noRim: true }); }
      const t0 = (hash(seed, 99) & 1) ? 0.66 : 0.06, t1 = t0 + 0.28, q = [at(t0, 0.04), at(t1, 0.04), at(t1, 0.72), at(t0, 0.72)];
      B.fillQuadShaded(ctx, q, C.tarp, { face: 'top', material: 'cloth', noAO: true }, env); line(ctx, lerp(q[0], q[1], 0.3), lerp(q[3], q[2], 0.5), 0.8, C.tarpCrease, 0, 0.9); line(ctx, q[2], q[3], 0.8, C.tarpCrease, 0, 0.8);
      for (const tt of [t0 + 0.08, t1 - 0.08]) { const p = at(tt, 0.06); B.orb(ctx, p[0], p[1], 1.6, 1, C.sandbag, 0, { noRim: true }); }
    } else if (b.planes && b.planes.kind === 'flat') { const p = roofTop(b, 0.4, 0.4); B.plane(ctx, [[p[0] - 6, p[1] - 2], [p[0] + 6, p[1] - 2], [p[0] + 6, p[1] + 2], [p[0] - 6, p[1] + 2]], C.sheathing, -0.3, { amp: 0.1 }); const t = roofTop(b, 0.75, 0.7); B.fillQuadShaded(ctx, [[t[0] - 9, t[1] - 4], [t[0] + 7, t[1] - 4], [t[0] + 7, t[1] + 2], [t[0] - 9, t[1] + 2]], C.tarp, { face: 'top', material: 'cloth', noAO: true }, env); }
    const cells = b.cells || [], nb = Math.min(cells.length, Math.max(1, Math.round(cells.length * 0.3))), at2 = (i) => cells[((i % cells.length) + cells.length) % cells.length];
    for (let i = 0; i < nb && cells.length; i++) boardCell(ctx, b, at2(seed + i * 7), env);
    for (let i = 0; i < Math.min(2, cells.length); i++) { const c = at2(seed + 3 + i * 5); flat(ctx, c.quad, '#1B1B1B', 0, 1); line(ctx, c.quad[0], c.quad[2], 0.6, C.white, 0, 0.7); }
    if (b.wallH >= 14) { const L = faceLen(b, 1), u = 0.5 - 7 / L; B.stroke(ctx, [facePt(b, 1, u, 1), facePt(b, 1, u + 2 / L, 5), facePt(b, 1, u + 1 / L, 8), facePt(b, 1, u + 3 / L, 11)], 0.8, g.wallBase, -0.95, 0.9, {}); }
    for (let i = 0; i < 4; i++) { const p = marginPt(g, 0, 0.15 + 0.2 * i, true); B.orb(ctx, p[0] - (hash(seed, i) % 6), p[1], 1.6, 0.8, i & 1 ? b.roofColor : C.sheathing, 0, { noRim: true }); }
  }
  function applyBoarded(ctx, b, env) { if (b) for (const c of b.cells) boardCell(ctx, b, c, env); }
  /** FLOODED: a waterline stain up both faces, a mineral line, sandbags along the base, a wet apron */
  function applyFlooded(ctx, g, b, env) {
    if (!b || b.wallH <= 0) return;
    const band = Math.min(6, b.wallH - 4);
    for (const f of [0, 1]) {
      const q = faceQuad(b, f, 0, 1, 0, band + 1); B.edgeFade(ctx, q, q[0], q[1], band + 1, C.stain, -0.3, 0.75);
      line(ctx, facePt(b, f, 0, band + 1), facePt(b, f, 1, band + 1), 0.8, C.sandbag, 0.5, 0.6);
      const L = faceLen(b, f);
      for (let s = 2; s < L - 3; s += 4) { const u = (s + 1.5) / L; if (g.doorBox === b && g.doorFace === f && Math.abs(u - g.doorU) < 6 / L) continue; const p = facePt(b, f, u, 0, 1.2, true); B.orb(ctx, p[0], p[1] - 0.6, 2, 1.1, C.sandbag, f === 0 ? 0.05 : -0.35, { noRim: true }); if ((hash(g.seed, s) % 4) === 0) B.orb(ctx, p[0] + 1, p[1] - 2.4, 2, 1.1, C.sandbag, f === 0 ? 0.15 : -0.25, { noRim: true }); }
    }
    const q = groundQuad(g); B.edgeFade(ctx, q, q[3], q[2], 12, C.water, -0.2, 0.4); B.edgeFade(ctx, q, q[2], q[1], 12, C.water, -0.2, 0.4);
  }

  // ---------------------------------------------------------------------------
  // The painter
  // ---------------------------------------------------------------------------
  function geometry(row, variant, frame, rot, seed, tees, env) {
    const g = M.buildingBox(row, variant, 1, rot);
    g.row = row; g.paint = row.paint || {}; g.D = HD_ROWS[row.id] || {};
    g.seed = hash(strHash(row.id || 'b'), (seed ^ variant) >>> 0);
    g.frontLeft = !!(variant & SPR.FRONT_L); g.night = !!(variant & SPR.NIGHT);
    g.features = Array.isArray(g.paint.features) ? g.paint.features : []; g.decals = Array.isArray(g.paint.decals) ? g.paint.decals : [];
    g.tees = (Array.isArray(tees) && tees.length) ? tees : null;
    const wall = g.paint.wall || [PAL.creamStone, PAL.tanStucco];
    g.wallBase = wall[0] || PAL.creamStone; g.material = g.paint.material || 'stucco';
    g.trim = g.paint.trim || ((isPurple(wall[0]) || isPurple(wall[1])) ? C.gold2 : C.limestone);
    g.doorBox = null; g.doorU = NaN; g.doorFace = -1; g.doorPt = null;
    g.env = env; void frame;
    return g;
  }
  /** compose one HD building (the whole sprite) on a context sized by brush.begin */
  function composeHD(ctx, g, variant, frame, env) {
    const scaffold = !!(variant & SPR.SCAFFOLD), pil = !!(variant & SPR.PILINGS);
    if (variant & SPR.RUIN) { g.apron = APRON.site; drawApron(ctx, g, APRON.site, env); ruinShape(ctx, g, env); return; }
    g.apron = scaffold ? APRON.site : apronOf(g);
    if (pil) drawWaterGround(ctx, g, env); else drawApron(ctx, g, g.apron, env);
    const main = mainBox(g);
    if (!pil && !scaffold && g.D.body !== 'wings' && (g.floors > 0 || g.D.body)) foundation(ctx, main, env);
    if (pil && !scaffold) stilts(ctx, main, true, env);
    let b = null;
    if (scaffold) b = scaffoldStage(ctx, g, frame, env);
    else b = (BODIES[g.D.body] || standardBody)(ctx, g, frame, env);
    if (pil && !scaffold) stilts(ctx, main, false, env);
    if (!scaffold) { try { drawMargins(ctx, g, b, variant, env); } catch (e) { BSU.error('sprites', 'hd margins:' + g.row.id, e); } }
    if (variant & SPR.DAMAGED) applyDamaged(ctx, g, b, env);
    if (variant & SPR.BOARDED) applyBoarded(ctx, b, env);
    if (variant & FLOODED_BIT) { try { applyFlooded(ctx, g, b, env); } catch (e) { BSU.error('sprites', 'hd flooded:' + g.row.id, e); } }
  }
  function frameCount(row, variant) {
    if (variant & SPR.SCAFFOLD) return [3, true];
    if (variant & SPR.NIGHT) return [4, true];
    const sp = (row.paint && row.paint.special) || row.id;
    if (sp === 'water_tower' || sp === 'surge_barrier') return [4, false];
    return [1, true];
  }
  M.registerHD('building', function (ctx, spec) {
    const row = spec.row;
    if (!row) { B.begin(ctx, 1, 1, spec); return { w: 1, h: 1, ox: 0, oy: 0 }; }
    const fc = frameCount(row, spec.variant); spec.frames = fc[0]; spec.framesPerVariant = fc[1];
    if (!HD_ROWS[row.id]) {   // part 2 rows: the pen painter at master 1, pixel-doubled at master 2 (exactly as before H2)
      try { ctx.setTransform(1, 0, 0, 1, 0, 0); } catch (e) { /* stub */ }
      const r = M.paintBuilding(ctx, row, spec.variant, spec.frame, spec.master, spec.seed, spec.rot, spec.tees);
      if (r) r.pen = true;   // sprites.bake: a pen entry (not HD bytes, not an HD look)
      return r;
    }
    const variant = Number.isFinite(spec.variant) ? Math.max(0, spec.variant | 0) : 0, frame = Number.isFinite(spec.frame) ? (spec.frame | 0) : 0;
    const g0 = M.buildingBox(row, variant, 1, spec.rot);
    const G = B.begin(ctx, g0.w, g0.h, spec);
    const env = Object.assign({}, G.env, { night: !!(variant & SPR.NIGHT) });
    const g = geometry(row, variant, frame, spec.rot, spec.seed | 0, spec.tees, env);
    composeHD(ctx, g, variant, frame, env);
    return { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
  });
  /** the lit cells (and door / lamps) of a converted row for a variant / frame, without drawing: what the companion lights */
  M.hdBuildingCells = function (id, variant, frame, rot) {
    const cat = BSU.data && BSU.data.catalog, base = typeof id === 'string' && id.indexOf(':') >= 0 ? id.slice(0, id.indexOf(':')) : id, row = cat && cat[base];
    if (!row || !HD_ROWS[base]) return null;
    variant = Number.isFinite(variant) ? Math.max(0, variant | 0) : 0; frame = Number.isFinite(frame) ? (frame | 0) : 0;
    const env = B.env(1, { night: !!(variant & SPR.NIGHT) }), g = geometry(row, variant, frame, rot ? 1 : 0, hash(strHash(id), variant), null, env);
    const b = mainBox(g), D = g.D, win = g.paint.windows || { cols: 0, rows: 0 };
    if (D.body === 'wings') { const back = mkBox(g, 12, 64, 12, 38, 3, 'hip', 12), left = mkBox(g, 12, 36, 38, 84, 3, 'hip', 12); layoutWindows(back, [5, 3], 3, g.night, frame, true); layoutWindows(left, [2, 4], 3, g.night, frame, true); return { g: g, cells: back.cells.concat(left.cells) }; }
    if (D.body === 'bunk') { const longX = g.fw >= g.fh, f = longX ? 0 : 1; layoutWindows(b, longX ? [5, 2] : [2, 5], 1, g.night, frame, true); const bz0 = 0.5 - 6 / faceLen(b, f), bz1 = 0.5 + 6 / faceLen(b, f); return { g: g, cells: b.cells.filter((c) => c.face !== f || c.u1 < bz0 - 0.01 || c.u0 > bz1 + 0.01) }; }
    if (D.body && D.body !== 'box') return { g: g, cells: [] };
    layoutWindows(b, (D.windows && D.windows.cols) || [win.cols | 0, win.cols | 0], (D.windows && D.windows.rows) || (win.rows | 0), g.night, frame);
    return { g: g, cells: b.cells };
  };
  // the companion: `bldlight:<id>[:r]` — the same canvas and anchor as the building (variant bits identical, frame = the NIGHT pattern)
  M.registerHD('bldlight', function (ctx, spec) {
    const sub = spec.sub || '', rot = /:r$/.test(sub) ? 1 : 0, id = rot ? sub.slice(0, -2) : sub;
    const cat = BSU.data && BSU.data.catalog, row = cat && cat[id];
    if (!row || !HD_ROWS[id]) { B.begin(ctx, 1, 1, spec); return { w: 1, h: 1, ox: 0, oy: 0 }; }
    const variant = (Number.isFinite(spec.variant) ? Math.max(0, spec.variant | 0) : 0) | SPR.NIGHT, frame = Number.isFinite(spec.frame) ? (spec.frame | 0) : 0;
    spec.frames = 4; spec.framesPerVariant = true;
    const g0 = M.buildingBox(row, variant, 1, rot);
    const G = B.begin(ctx, g0.w, g0.h, spec), env = Object.assign({}, G.env, { night: true });
    const lc = M.hdBuildingCells(id, variant, frame, rot);
    if (lc && !(variant & (SPR.SCAFFOLD | SPR.RUIN))) {
      for (const c of lc.cells) if (c.lit) B.light(ctx, { quad: c.quad, color: C.glow, a: 0.9, halo: 5 }, env);
      const g = lc.g, b = mainBox(g);
      if (b.wallH > 0 && g.row.pathAdjacency && g.D.body !== 'wings') { const f = g.frontLeft ? 0 : 1, L = faceLen(b, f), hw = ((b.floors >= 2 || g.fw + g.fh >= 5) ? 3 : 2) / L; B.light(ctx, { quad: faceQuad(b, f, 0.5 - hw, 0.5 + hw, 5.6, 7.2), color: C.glow, a: 0.7, halo: 4 }, env); for (const s of [-1, 1]) { const p = facePt(b, f, 0.5 + s * 7 / L, 0, (f === 0 ? g.ipy : g.ipx), true); B.light(ctx, { x: p[0], y: p[1] - 11.3, r: 4, color: C.glow, a: 0.8 }, env); B.light(ctx, { x: p[0], y: p[1], rx: 8, ry: 3.5, pool: true, color: C.glow, a: 0.45 }, env); } }
    }
    return { w: g0.w, h: g0.h, ox: g0.ox, oy: g0.oy };
  });

  // ---------------------------------------------------------------------------
  // Self-test (sprites.selfTest runs M._tests): every converted row bakes at both masters with the pen's geometry
  // ---------------------------------------------------------------------------
  if (Array.isArray(M._tests)) M._tests.push(function () {
    const notes = [], cat = BSU.data && BSU.data.catalog;
    if (!cat) return { ok: true, notes: 'data.js not loaded yet' };
    for (const id of Object.keys(HD_ROWS)) {
      const row = cat[id]; if (!row) { notes.push('HD row ' + id + ' is not in the catalog'); continue; }
      for (const z of [1, 2]) { const e = M.get(id, 0, 0, z), gb = M.buildingBox(row, 0, 1, 0); if (!e) { notes.push(id + ' null at master ' + z); continue; } if (e.w !== gb.w * z || e.h !== gb.h * z || e.ox !== gb.ox * z || e.oy !== gb.oy * z) notes.push(id + ' geometry differs from buildingBox at master ' + z); if (!e.hd) notes.push(id + ' is not an HD entry'); }
      const l = M.get('bldlight:' + id, SPR.NIGHT, 0, 1), e1 = M.get(id, SPR.NIGHT, 0, 1); if (!l || !e1 || l.w !== e1.w || l.h !== e1.h || l.ox !== e1.ox || l.oy !== e1.oy) notes.push(id + ' light companion geometry');
    }
    return { ok: !notes.length, notes: notes.join('; ') || (Object.keys(HD_ROWS).length + ' HD rows at masters 1 + 2, companions aligned') };
  });
})();
