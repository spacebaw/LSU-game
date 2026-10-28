'use strict';
// ============================================================================
// BAYOU STATE — sprites_buildings_hd.js (H2a + H2b buildings passes): the HD building composer, style C "soft rendered diorama".
// Owner: nothing in state (the atlas is derived, seed-independent, never saved).
// Implements: docs/PLAN_HD_ART.md §4 row "H2 buildings" (parts 1 and 2); docs/ART_STYLE.md §1–§3, "## Brush API",
// "## Style C palette" (building knots); the B3 "Louisiana Collegiate" language (PLAN_FIDELITY B3) re-expressed through
// BSU.brush: walls are fillQuadShaded planes (SW lit, SE shadow) in the row's wall base, roofs are roofPlane hips / gables /
// flat parapets with tile courses or tin seams, porticos and galleries are brush columns, windows a mullioned grid of glass
// planes (brush.glow panes at night), decals are planes / orbs / strokes; nothing hand-picks a colour or writes a gradient.
// Registered through BSU.sprites.registerHD('building', …) OVER the pen painter of sprites_buildings.js (manifest order:
// this file loads after it), so sprites.get(<catalogId>, variant, frame, zoom) serves every row through this painter:
// the rows in HD_ROWS (every footprint row except the three vegetation rows, 32 rows) are composed here at master 1
// (zoom 0.5 / 1, lod 1) and master 2 (zoom 2 / Retina, lod 0); live_oak / cypress / azalea are delegated to
// sprites.paintBuilding (the pen): buildings.place turns them into veg entities, so their catalog sprite has no consumer in
// play and their art is H3's (vegetation). `habfront` (the Tiger Habitat's foreground layer) is re-registered HD beside it.
// H2b (part 2) adds the own-ground bodies (quad, parking, pond, rookery, bat house, the practice field, the stadium in its
// four tiers over sprites.stadiumGeom so render's football overlay — field rectangle, fan rows, shader clip, mast heads —
// keeps lining up, the Tiger Habitat over sprites.HABITAT so Roux's route and the plaza lamps keep lining up), the barrel
// roof, the belfry + spire, the terrace apron with umbrellas, and the decals H2a left out (boil pot, dumpster, fountain,
// pool, truck, airboat, lookout) as brush props.
// Geometry: sprites.buildingBox (unchanged) gives the canvas, the anchor and the inset box; the composer works in footprint
// px through fp(g, X, Y, up) (= the pen's fpPt), so footprints, anchors, heights-in-tiles and render's shadow boxes are the
// pen's. Variant bits (contract SPR): NIGHT (4 frames, seeded lit pattern hash(row.n·131 + frame, cell) % 100 < 70),
// DAMAGED, PILINGS (+10 px lift on bark stilts over water), SCAFFOLD (3 frames: slab / half-height block walls in scaffolding
// (+ crane ≥ 3×3) / full height with openings and rafters), RUIN, BOARDED, FRONT_L (door, walk and lamps on the SW face),
// FLOODED (waterline, sandbags, wet apron); tees (render.bakeWith) are gravel / asphalt / plank connectors into the wall.
// Companion family `bldlight:<catalogId>[:r]` (same canvas, anchor and variant bits as the building; frame = the NIGHT
// pattern): only the lit window panes, the door transom and the lamp heads as brush.light quads / blooms, additive, for the
// lights pass — fetched by render_fx.gatherLights (H2b) for every HD building at night in place of the light:window blob.
// Per-row data (HD_ROWS, documented in docs/INTEGRATION_NOTES.md "## H2a buildings pass" / "## H2b buildings pass"):
// { ground, body, box, boxL, windows, columns, props, stripe, plaque, spire, cross, impeller } — everything else comes from
// the catalog row's paint (wall, roof, roofColor, floors, windows, material, trim, accent, features, decals).
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
    azalea: PAL.azalea || '#E75480', cool: M.COOL_TINT || '#2B2550', spec: '#FFFBEA',
    // H2b: the own-ground rows, the terrace, the exhibit
    turf: '#3F8F3B', terrace: (M.extraBuildings && M.extraBuildings.terrace) || '#E3D7BE', rock: '#8A7D70', habStone: '#9C978E', spoonbill: (M.extraBuildings && M.extraBuildings.spoonbill) || '#F2A3B3',
    waterBlue: PAL.waterBlue || '#4FA3D6', danger: PAL.danger || '#E0443E', ember: X.ember || '#E07020', flame: X.flame || '#FFB347', dumpster: X.dumpster || '#2E8B57',
    reed: PAL.reed || '#8A9A4B', mud: PAL.mud || '#4A3B2A', black: X.black || '#1B1B1B', chain: X.chain || '#9A9AA0', palmetto: X.palmetto || '#4E7A3A', flood: '#7C9A92', den: '#FFB45A'
  });
  const GLOWS = Object.freeze(['#FFD27A', '#FFE9A8', '#F2B860', '#FFDC8E']);
  const isPurple = (c) => { const u = String(c || '').toUpperCase(); return u === String(PAL.purple).toUpperCase() || u === String(PAL.purple2 || '').toUpperCase(); };
  const satOf = (hex) => { const s = String(hex || '').replace('#', ''); if (s.length < 6) return 1; const r = parseInt(s.slice(0, 2), 16), gg = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16); const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); return mx ? (mx - mn) / mx : 0; };

  // ---------------------------------------------------------------------------
  // Per-row data. Every converted row is one line; the keys are optional (defaults from the catalog paint and the tab):
  //   ground   'brick' | 'lawn' | 'lawnPlain' | 'gravel' | 'sand' | 'pave' | 'terrace' | 'courtyard'   apron material (default by tab: academic brick,
  //            housing / swamp lawn + hedge, utilities gravel + fence, dining terrace + umbrellas, grounds / sports plain lawn, else pave)
  //   body     'box' (default: one inset box from paint) | 'bunk' | 'wings' | 'substation' | 'tower' | 'generator' (H2a) |
  //            'quad' | 'parking' | 'pond' | 'rookery' | 'batpole' | 'field' | 'stadium' | 'habitat' (H2b: own ground, no margins)
  //   box      [X0, X1, Y0, Y1] footprint px: the inset box when it is not the whole inset (rec_center leaves a pool deck); boxL = the same under FRONT_L
  //   windows  { cols: [sw, se], rows }                                          per-face column counts (default paint.windows.cols on both faces)
  //   columns  n                                                                 portico columns on the entrance face (the pediment comes from features)
  //   props    [{ kind, roof: [u, v] | at: [X, Y] (footprint px; atL under FRONT_L) | margin: [side, t] }]
  //            kinds: clarifier, dish, dock, crane, couch, cars, magnolia (H2a); boilpot, dumpster, fountain, pool, truck, airboat, lookout (H2b)
  //   stripe   hex                                                               a vertical accent stripe up the SE face (res_tower's gold)
  //   plaque   true                                                              a purple plaque with gold marks on the far face (the Greek letters)
  //   spire    true                                                              a pyramid spire with a gold finial on the ridge (the bell tower; the beacon moves to its tip)
  //   cross    true                                                              a white disc with a red cross over the door (the health centre)
  //   impeller true                                                              a steel pump wheel with gold spokes on the far face (the pump house)
  // Features (paint.features) read: pediment, cupola[:gold], banner:roux, steps, planters, arched, mullions, gutters, gallery[:both], awnings,
  // shutters, sign:TEXT, flagpole, hvac, tank, vents, stack, dormers, belfry. Decals (paint.decals) read: columns, clock, flag, awning, arcade,
  // dome, banner, lights, beacon, pipes, crane, dish, couch, letters, tank, vents, sign. Decals placed through props (above) rather than read:
  // boilpot, dumpster, fountain, pool, truck, airboat, lookout; `stilts` is the PILINGS variant, `reeds` / `nest` / `gourds` / `cars` /
  // `goalposts` / `bleachers` / `masts` / `jumbotron` / `impeller` are drawn by their bodies.
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
    wastewater: { ground: 'gravel', props: [{ kind: 'clarifier', margin: [0, 0.55] }] },
    // H2b — dining / life / swamp / grounds / sports
    dining_hall: { ground: 'terrace', props: [{ kind: 'boilpot', margin: [0, 0.27] }, { kind: 'dumpster', margin: [1, 0.1] }] },
    poboy: { ground: 'terrace', props: [{ kind: 'boilpot', margin: [0, 0.28] }] },
    union: { ground: 'pave', props: [{ kind: 'fountain', margin: [0, 0.22] }] },
    rec_center: { ground: 'pave', box: [12, 84, 12, 58], boxL: [12, 58, 12, 84], props: [{ kind: 'pool' }] },
    health_center: { ground: 'pave', cross: true },
    quad: { body: 'quad' },
    parking: { body: 'parking' },
    pump: { ground: 'lawn', impeller: true },
    pond: { body: 'pond' },
    abatement: { ground: 'lawn', props: [{ kind: 'truck', at: [24, 29], atL: [29, 24] }] },
    bat_house: { body: 'batpole' },
    wildlife_post: { ground: 'lawn', props: [{ kind: 'truck', at: [24, 29], atL: [29, 24] }, { kind: 'airboat', at: [8, 29], atL: [29, 8] }] },
    bell_tower: { ground: 'pave', spire: true },
    tiger_habitat: { body: 'habitat' },
    marsh_restoration: { ground: 'lawn', props: [{ kind: 'lookout', at: [3, 3], back: true }, { kind: 'airboat', at: [8, 29], atL: [29, 8] }] },
    rookery: { body: 'rookery' },
    practice_field: { body: 'field' },
    stadium: { body: 'stadium' }
  });
  const GROUND_BY_TAB = { academic: 'brick', housing: 'lawn', utilities: 'gravel', dining: 'terrace', life: 'pave', swamp: 'lawn', grounds: 'lawnPlain', sports: 'lawnPlain' };
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
  /** the whole inset box of the footprint (sprites.buildingBox's ipx / ipy), or the row's own box (HD_ROWS.box / boxL under FRONT_L, footprint px) */
  function mainBox(g) {
    const p = g.paint, D = g.D || {}, bx = (g.frontLeft && D.boxL) || D.box;
    if (bx) return mkBox(g, bx[0], bx[1], bx[2], bx[3], g.floors, g.roof, g.roofH, p.roofColor || PAL.terracotta);
    return mkBox(g, g.ipx, g.fw * 32 - g.ipx, g.ipy, g.fh * 32 - g.ipy, g.floors, g.roof, g.roofH, p.roofColor || PAL.terracotta);
  }
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
    terrace: { base: C.terrace, t: 0, pattern: 'pave', umbrellas: true },   // H2b: the dining terrace (pavers + café umbrellas)
    lawnPlain: { base: C.lawn, t: 0, pattern: 'lawn' },                      // H2b: grounds / sports / the own-ground rows (no hedge)
    site: { base: C.siteDirt, t: -0.05, pattern: 'dirt' }
  };
  function apronOf(g) { const D = g.D || {}; return APRON[D.ground] || APRON[GROUND_BY_TAB[g.row.tab]] || APRON.pave; }
  /** the apron on the footprint quad; o.lifted = at the lifted level (an own-ground body on pilings) */
  function drawApron(ctx, g, A, env, o) {
    const gnd = !(o && o.lifted), gp = (X, Y) => fp(g, X, Y, 0, gnd);
    const q = [gp(0, 0), gp(g.fw * 32, 0), gp(g.fw * 32, g.fh * 32), gp(0, g.fh * 32)], lod0 = env.lod === 0, seed = g.seed;
    B.fillQuadShaded(ctx, q, A.base, { face: 'top', material: A.pattern === 'lawn' ? 'wood' : 'stone', t: A.t, noAO: true }, env);
    if (A.pattern !== 'lawn') B.macroGrain(ctx, q, 0.3, env);
    ctx.save(); B.poly(ctx, q); ctx.clip();
    if (A.pattern === 'lawn') {
      for (let s = 1; s < g.fw * 2; s += 2) flat(ctx, [gp(s * 16, 0), gp((s + 1) * 16, 0), gp((s + 1) * 16, g.fh * 32), gp(s * 16, g.fh * 32)], C.lawnStripe, 0, 0.55);   // mowing stripes
      if (lod0) for (let i = 0; i < g.fw * g.fh * 3; i++) { const X = (hash(seed, i * 3) % (g.fw * 32)), Y = (hash(seed, i * 3 + 1) % (g.fh * 32)); const p = gp(X, Y); B.orb(ctx, p[0], p[1], 1.6, 0.9, C.lawn, 0.25, { noRim: true }); }
    } else if (A.pattern === 'brick' && lod0) {
      for (let Y = 6; Y < g.fh * 32; Y += 6) line(ctx, gp(0, Y), gp(g.fw * 32, Y), 0.7, C.brick, -0.45, 0.4);
      for (let X = 6; X < g.fw * 32; X += 6) line(ctx, gp(X, 0), gp(X, g.fh * 32), 0.7, C.brick, -0.45, 0.25);
    } else if (A.pattern === 'pave' && lod0) {
      for (let Y = 8; Y < g.fh * 32; Y += 8) line(ctx, gp(0, Y), gp(g.fw * 32, Y), 0.7, A.base, -0.4, 0.4);
      for (let X = 8; X < g.fw * 32; X += 8) line(ctx, gp(X, 0), gp(X, g.fh * 32), 0.7, A.base, -0.4, 0.4);
    } else if (A.pattern === 'gravel' || A.pattern === 'dirt') {
      const n = lod0 ? g.fw * g.fh * 6 : g.fw * g.fh * 2;
      for (let i = 0; i < n; i++) { const X = (hash(seed, i * 5) % (g.fw * 32)), Y = (hash(seed, i * 5 + 2) % (g.fh * 32)); const p = gp(X, Y); B.orb(ctx, p[0], p[1], 1.1, 0.7, A.base, (i & 1) ? 0.45 : -0.35, { noRim: true }); }
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
    if (kind === 'barrel') {   // H2b: a barrel vault along the longer axis in five bevelled bands, the near end wall with a fan window
      const Rh = Math.max(2, b.roofH), q = topCorners(b, h, 0), along = (b.X1 - b.X0) >= (b.Y1 - b.Y0), bands = 5, T = [-0.05, 0.22, 0.32, 0.06, -0.3];
      const ptA = (u, hgt) => { const p = along ? lerp(q.W, q.N, (u + 1) / 2) : lerp(q.N, q.E, (u + 1) / 2); return [p[0], p[1] - hgt]; };
      const ptB = (u, hgt) => { const p = along ? lerp(q.S, q.E, (u + 1) / 2) : lerp(q.W, q.S, (u + 1) / 2); return [p[0], p[1] - hgt]; };
      const hAt = (u) => Rh * Math.sqrt(Math.max(0, 1 - u * u));
      for (let i = 0; i < bands; i++) {
        const u0 = -1 + 2 * i / bands, u1 = -1 + 2 * (i + 1) / bands;
        B.plane(ctx, [ptA(u0, hAt(u0)), ptA(u1, hAt(u1)), ptB(u1, hAt(u1)), ptB(u0, hAt(u0))], color, T[i], { amp: 0.08, rim: i === 1 ? 0.15 : 0 });
        if (i) line(ctx, ptA(u0, hAt(u0)), ptB(u0, hAt(u0)), 0.7, color, i < 3 ? -0.45 : -0.6, 0.55);
      }
      if (lod0) for (let i = 1; i < 6; i++) { const t = i / 6; line(ctx, lerp(ptA(-1, 0), ptB(-1, 0), t), lerp(ptA(1, 0), ptB(1, 0), t), 0.5, color, 0.35, 0.3); }   // ribs across the vault
      const end = []; for (let k = 0; k <= 8; k++) { const u = -1 + 2 * k / 8; end.push(ptB(u, hAt(u))); }
      B.fillQuadShaded(ctx, end, g.wallBase, { face: along ? 'se' : 'sw', material: wallMaterial(g.material), noAO: true }, env);   // the near end wall under the arch
      const em = ptB(0, Rh * 0.45); const fan = [[em[0] - 3.2, em[1] + 1.4], [em[0] + 3.2, em[1] + 1.4], [em[0] + 2.4, em[1] - 1.8], [em[0] - 2.4, em[1] - 1.8]];
      if (g.night) B.glow(ctx, fan, GLOWS[0], env); else B.fillQuadShaded(ctx, fan, C.glass, { face: along ? 'se' : 'sw', material: 'glass' }, env);
      B.stroke(ctx, end, 0.9, color, -0.6, 0.8, {});
      line(ctx, ptA(0, Rh), ptB(0, Rh), 1.2, color, 0.6, 0.6);   // the crown's specular
      for (const f of [0, 1]) { const fq = faceQuad(b, f, 0, 1, 0, h); B.edgeFade(ctx, fq, fq[3], fq[2], 7, C.cool, -0.6, 0.35); }
      b.planes = { front: null, kind: 'barrel', along: along }; b.ridge = [ptA(0, Rh), ptB(0, Rh)];
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
    const g = b.g; if (!text || b.wallH < 12) return; const f = 1 - b.doorFace, len = faceLen(b, f), w = Math.min(len - 6, text.length * 4 + 3), h = b.wallH < 20 ? 4 : 6;
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
  /** a small car: body, cabin, head / tail lights (the suites' apron, the parking lot) */
  function car(ctx, x, y, color, night, env) {
    B.shadow(ctx, { x: x + 1, y: y + 0.5, rx: 5.5, ry: 2, a: 0.3 }, env);
    B.fillQuadShaded(ctx, [[x - 4.5, y], [x + 4.5, y], [x + 4.5, y - 3], [x - 4.5, y - 3]], color, { face: 'sw', material: 'paint', noAO: true }, env);
    B.orb(ctx, x, y - 4, 2.6, 1.6, color, 0.1, { spec: 0.5 });
    B.orb(ctx, x - 4.4, y - 1.6, 0.6, 0.6, night ? GLOWS[0] : C.offWhite, 0.5, { noRim: true }); B.orb(ctx, x + 4.4, y - 1.6, 0.6, 0.6, '#E0443E', 0.2, { noRim: true });
  }
  /** props placed by HD_ROWS: clarifier (concrete ring + teal water + skimmer), dish, dock planks, a rooftop crane gantry, a couch on the lawn, cars, a magnolia;
   *  H2b: boilpot (burner, black pot, steam), dumpster, fountain (basin, pedestal, jets by frame), pool (the deck strip the row's box leaves free),
   *  truck (purple pickup), airboat (in its slip), lookout (a bark tower behind the shack: `back` props draw before the walls) */
  function drawProp(ctx, g, b, pr, frame, night, env) {
    const atXY = (g.frontLeft && pr.atL) || pr.at, lod0 = env.lod === 0;
    const at = pr.roof ? roofTop(b, pr.roof[0], pr.roof[1]) : pr.margin ? marginPt(g, pr.margin[0], pr.margin[1], true) : atXY ? fp(g, atXY[0], atXY[1], 0, true) : null;
    switch (pr.kind) {
      case 'boilpot': {   // a crawfish boil: an iron burner ring on three legs, the flame, a black pot with a steel rim and handles, steam
        const x = at[0], y = at[1];
        B.shadow(ctx, { x: x + 1, y: y + 0.4, rx: 5, ry: 2, a: 0.3 }, env);
        for (const dx of [-3.2, 0, 3.2]) line(ctx, [x + dx, y], [x + dx * 0.8, y - 3.5], 0.8, C.iron, -0.1, 0.95);
        B.orb(ctx, x, y - 3.4, 4.6, 1.6, C.iron, -0.3, { noRim: true });
        B.orb(ctx, x, y - 2.2, 2.6, 1.2, C.ember, 0.2, { noRim: true }); B.orb(ctx, x - 0.6, y - 2.8, 1.4, 1.5, C.flame, 0.4, { noRim: true }); B.orb(ctx, x + 1, y - 2.6, 0.9, 1.1, C.flame, 0.6, { noRim: true });
        B.column(ctx, x, y - 3.8, 6.5, 4.2, C.black, env); B.orb(ctx, x, y - 10.3, 4.2, 1.6, C.black, 0.25, { spec: 0.25 });
        line(ctx, [x - 4.2, y - 9.6], [x + 4.2, y - 9.6], 0.8, C.steel, 0.3, 0.9); line(ctx, [x - 5.4, y - 8.4], [x - 4.2, y - 8.4], 0.9, C.steel, 0.1, 0.9); line(ctx, [x + 4.2, y - 8.4], [x + 5.4, y - 8.4], 0.9, C.steel, 0.1, 0.9);
        if (lod0) for (let i = 0; i < 3; i++) B.softEllipse(ctx, x - 1 + i * 1.2, y - 13 - i * 2.4, 2.2 + i * 0.6, 1.6 + i * 0.4, C.white, 0.22 - i * 0.05, 0.2);
        break; }
      case 'dumpster': {   // a green metal dumpster with a gold lid band on casters
        const x = at[0], y = at[1];
        B.shadow(ctx, { x: x + 1.5, y: y + 0.5, rx: 7, ry: 2.5, a: 0.3 }, env);
        B.fillQuadShaded(ctx, [[x - 6, y - 0.5], [x + 6, y - 0.5], [x + 6, y - 6], [x - 6, y - 6]], C.dumpster, { face: 'sw', material: 'metal', noAO: true }, env);
        B.fillQuadShaded(ctx, [[x - 6, y - 6], [x + 6, y - 6], [x + 7, y - 8.2], [x - 5, y - 8.2]], C.dumpster, { face: 'top', material: 'metal', t: 0.1, noAO: true }, env);
        line(ctx, [x - 6, y - 6.2], [x + 6, y - 6.2], 1, C.gold, 0.2, 0.9); line(ctx, [x - 5, y - 8.4], [x + 7, y - 8.4], 0.8, C.gold, 0.5, 0.9);
        for (const dx of [-4, 4]) B.orb(ctx, x + dx, y, 0.9, 0.7, C.black, 0, { noRim: true });
        B.decal(ctx, { x: x - 1, y: y - 1.6, w: 3, h: 2.2, color: C.gold, trim: null, shape: 'rect', face: 'sw' }, env);
        break; }
      case 'fountain': {   // a concrete basin with a pedestal bowl and five jets (phase by frame), splash rings at lod 0
        const x = at[0], y = at[1] - 1, ph = ((frame | 0) % 3 + 3) % 3;
        B.shadow(ctx, { x: x + 1, y: y + 1, rx: 10, ry: 4, a: 0.25 }, env);
        B.orb(ctx, x, y, 9.5, 4.2, C.concrete, 0.05, { noRim: true, spec: 0.1 });
        B.puddle(ctx, x, y - 0.4, 7.8, 3.3, env, { t: 0.05, spec: 0.35, rim: 0.25 });
        B.column(ctx, x, y - 1, 5, 1.1, C.concrete, env); B.orb(ctx, x, y - 6.4, 2.4, 1, C.concrete, 0.2, { noRim: true });
        for (let i = -2; i <= 2; i++) { const h = 3.5 - Math.abs(i) * 0.9 + (ph === 1 ? 0.8 : ph === 2 ? -0.6 : 0); B.stroke(ctx, [[x, y - 6.8], [x + i * 1.6, y - 6.8 - h], [x + i * 3.2, y - 4 + Math.abs(i) * 0.4]], 0.8, C.white, 0.2, 0.75, { smooth: true }); }
        if (lod0) for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + ph; B.orb(ctx, x + Math.cos(a) * 5, y - 0.6 + Math.sin(a) * 2, 0.6, 0.4, C.white, 0.5, { noRim: true }); }
        break; }
      case 'pool': {   // the deck strip the row's box leaves free (HD_ROWS.box): paving, concrete coping, blue water with a lane rope, a ladder, two loungers; lit from below at night
        if (g.lift > 0) break; const L = g.frontLeft;
        const X0 = L ? b.X1 + 2 : b.X0 + 4, X1 = L ? g.fw * 32 - g.ipx - 2 : b.X1 - 4, Y0 = L ? b.Y0 + 4 : b.Y1 + 2, Y1 = L ? b.Y1 - 4 : g.fh * 32 - g.ipy - 2;
        const q = (x0, x1, y0, y1, up) => [fp(g, x0, y0, up, true), fp(g, x1, y0, up, true), fp(g, x1, y1, up, true), fp(g, x0, y1, up, true)];
        const dq = q(X0, X1, Y0, Y1, 0); B.fillQuadShaded(ctx, dq, C.paveLight, { face: 'top', material: 'stone', t: 0.12, noAO: true }, env);
        B.fillQuadShaded(ctx, q(X0 + 4, X1 - 4, Y0 + 4, Y1 - 4, 0.3), C.concrete, { face: 'top', material: 'stone', t: 0.3, noAO: true }, env);
        const wq = q(X0 + 6, X1 - 6, Y0 + 6, Y1 - 6, -0.5); B.fillQuadShaded(ctx, wq, C.waterBlue, { face: 'top', material: 'paint', t: night ? -0.05 : 0.12, noAO: true }, env);
        B.edgeFade(ctx, wq, wq[0], wq[1], 3, C.waterBlue, 0.5, 0.5); B.edgeFade(ctx, wq, wq[3], wq[0], 3, C.waterBlue, 0.5, 0.4);
        const rope = L ? [mid(wq[0], wq[1]), mid(wq[3], wq[2])] : [mid(wq[0], wq[3]), mid(wq[1], wq[2])]; line(ctx, rope[0], rope[1], 0.8, C.gold, 0.2, 0.8);
        if (lod0) for (let i = 0; i < 8; i++) { const p = lerp(lerp(wq[0], wq[1], (hash(g.seed, 40 + i) % 100) / 100), lerp(wq[3], wq[2], (hash(g.seed, 40 + i) % 100) / 100), (hash(g.seed, 60 + i) % 100) / 100); line(ctx, [p[0] - 1.2, p[1]], [p[0] + 1.2, p[1]], 0.6, C.white, 0.2, 0.55); }
        if (night) for (let i = 0; i < 3; i++) { const p = lerp(rope[0], rope[1], 0.2 + 0.3 * i); B.softEllipse(ctx, p[0], p[1] - 1, 4, 2, GLOWS[1], 0.35, 0.2); }
        const lp = L ? wq[0] : wq[1]; line(ctx, [lp[0] - 1.5, lp[1] - 4], [lp[0] - 1.5, lp[1] + 0.5], 0.7, C.steel, 0.3, 0.9); line(ctx, [lp[0] + 0.5, lp[1] - 4], [lp[0] + 0.5, lp[1] + 0.5], 0.7, C.steel, 0.3, 0.9); line(ctx, [lp[0] - 1.5, lp[1] - 2], [lp[0] + 0.5, lp[1] - 2], 0.6, C.steel, 0.5, 0.9);
        const eA = L ? [1, 2] : [2, 3];
        for (const t of [0.3, 0.62]) { const p = lerp(lerp(wq[eA[0]], wq[eA[1]], t), lerp(dq[eA[0]], dq[eA[1]], t), 0.55); B.fillQuadShaded(ctx, [[p[0] - 3.5, p[1]], [p[0] + 3.5, p[1]], [p[0] + 3.5, p[1] - 1.6], [p[0] - 3.5, p[1] - 1.6]], (t < 0.5) ? C.purple : C.gold, { face: 'top', material: 'cloth', noAO: true }, env); }
        break; }
      case 'truck': {   // a purple pickup with a gold stripe, parked nose toward the entrance side
        const x = at[0], y = at[1], L = g.frontLeft, s = L ? -1 : 1, fc = L ? 'se' : 'sw';
        B.shadow(ctx, { x: x + 1, y: y + 0.5, rx: 8, ry: 2.4, a: 0.3 }, env);
        B.fillQuadShaded(ctx, [[x - 7.5 * s, y - 0.8], [x + 2.5 * s, y - 0.8], [x + 2.5 * s, y - 4.6], [x - 7.5 * s, y - 4.6]], C.purple, { face: fc, material: 'paint', noAO: true }, env);
        B.fillQuadShaded(ctx, [[x + 2.5 * s, y - 0.8], [x + 7.5 * s, y - 0.8], [x + 7.5 * s, y - 4], [x + 2.5 * s, y - 4]], C.purple2, { face: fc, material: 'paint', noAO: true }, env);
        B.fillQuadShaded(ctx, [[x + 2.5 * s, y - 4], [x + 7 * s, y - 4], [x + 6.2 * s, y - 7.2], [x + 2.5 * s, y - 7.2]], C.purple, { face: fc, material: 'paint', noAO: true }, env);
        B.fillQuadShaded(ctx, [[x + 3.2 * s, y - 4.4], [x + 6.2 * s, y - 4.4], [x + 5.6 * s, y - 6.6], [x + 3.2 * s, y - 6.6]], C.glass, { face: 'sw', material: 'glass', noAO: true }, env);
        line(ctx, [x - 7.5 * s, y - 2.8], [x + 7.5 * s, y - 2.8], 1, C.gold, 0.2, 0.95);
        for (const dx of [-5, 5]) B.orb(ctx, x + dx * s, y - 0.4, 1.3, 1.3, C.black, 0.1, { spec: 0.2 });
        B.orb(ctx, x + 7.6 * s, y - 2, 0.6, 0.6, night ? GLOWS[0] : C.offWhite, 0.5, { noRim: true });
        break; }
      case 'airboat': {   // a flat steel hull in its slip, a purple seat, the fan in its cage on a mast
        const x = at[0], y = at[1], L = g.frontLeft, s = L ? -1 : 1, fc = L ? 'se' : 'sw';
        B.puddle(ctx, x, y + 0.6, 9, 2.6, env, { t: -0.2, spec: 0.3, rim: 0.2 });
        B.fillQuadShaded(ctx, [[x - 7 * s, y - 0.6], [x + 6 * s, y - 0.6], [x + 7 * s, y - 3.2], [x - 7 * s, y - 3.2]], C.steel, { face: fc, material: 'metal', noAO: true }, env);
        line(ctx, [x - 7 * s, y - 3.2], [x + 7 * s, y - 3.2], 0.8, C.steel, 0.5, 0.9);
        B.fillQuadShaded(ctx, [[x - 1 * s, y - 3.2], [x + 2.5 * s, y - 3.2], [x + 2.5 * s, y - 6], [x - 1 * s, y - 6]], C.purple, { face: 'sw', material: 'paint', noAO: true }, env);
        B.column(ctx, x - 5.5 * s, y - 3.2, 6.5, 0.5, C.steel, env);
        B.orb(ctx, x - 5.5 * s, y - 7.2, 3.2, 3.6, C.iron, -0.1, { spec: 0.15 }); B.orb(ctx, x - 5.5 * s, y - 7.2, 2.4, 2.8, C.steel, 0.1, { noRim: true });
        line(ctx, [x - 5.5 * s, y - 10.6], [x - 5.5 * s, y - 3.8], 0.6, C.iron, -0.3, 0.9); line(ctx, [x - 8.6 * s, y - 7.2], [x - 2.4 * s, y - 7.2], 0.6, C.iron, -0.3, 0.9);
        B.orb(ctx, x - 5.5 * s, y - 7.2, 0.7, 0.7, C.black, 0, { noRim: true });
        break; }
      case 'lookout': {   // a bark lookout tower: two visible legs with cross braces, a plank deck, a gold rail, a tin roof
        const x = at[0], y = at[1], H = 22;
        for (const dx of [-4.5, 4.5]) B.column(ctx, x + dx, y, H - 7, 0.8, C.bark, env);
        line(ctx, [x - 4.5, y - 3], [x + 4.5, y - 11], 0.7, C.bark, -0.4, 0.9); line(ctx, [x + 4.5, y - 3], [x - 4.5, y - 11], 0.7, C.bark, -0.4, 0.9);
        B.fillQuadShaded(ctx, [[x - 6, y - H + 7], [x + 6, y - H + 7], [x + 6, y - H + 5], [x - 6, y - H + 5]], C.wood, { face: 'sw', material: 'wood', noAO: true }, env);
        for (const dx of [-5.4, 5.4]) line(ctx, [x + dx, y - H + 5], [x + dx, y - H + 1], 0.7, C.bark, 0.1, 0.9);
        line(ctx, [x - 5.6, y - H + 1.5], [x + 5.6, y - H + 1.5], 0.9, C.gold, 0.2, 0.95);
        B.plane(ctx, [[x - 7, y - H], [x + 7, y - H], [x + 5, y - H - 2.5], [x - 5, y - H - 2.5]], C.tin, 0.2, { amp: 0.2, rim: 0.3 });
        break; }
      case 'clarifier': { const x = at[0], y = at[1] - 2; B.orb(ctx, x, y, 10, 5, C.concrete, 0.1, { noRim: true }); B.puddle(ctx, x, y - 0.4, 8, 4, env, { t: -0.15, spec: 0.35, rim: 0.3 }); const a = (frame & 1) ? 1 : -1; line(ctx, [x - 7 * a, y - 2], [x + 7 * a, y + 2], 1, C.concrete, 0.6, 0.9); B.orb(ctx, x, y - 0.6, 1, 1, C.iron, 0, { noRim: true }); break; }
      case 'dish': { const x = at[0], y = at[1]; B.column(ctx, x, y, 5, 0.6, C.iron, env); B.orb(ctx, x - 1.5, y - 7, 3.4, 2.6, C.offWhite, 0.2, { spec: 0.5 }); line(ctx, [x - 1.5, y - 7], [x + 1.5, y - 9], 0.7, C.iron, 0, 1); break; }
      case 'dock': { const p0 = marginPt(g, 0, 0.02, true), p1 = marginPt(g, 0, 0.5, true); line(ctx, p0, p1, 3.2, C.boardwalk, 0, 1); line(ctx, p0, p1, 1.2, C.boardwalk, 0.35, 0.6); const n = env.lod === 0 ? 8 : 4; for (let i = 1; i < n; i++) { const p = lerp(p0, p1, i / n); line(ctx, [p[0] - 1.6, p[1] + 0.8], [p[0] + 1.6, p[1] - 0.8], 0.6, C.boardwalk, -0.7, 0.6); } break; }
      case 'crane': { const x = at[0], y = at[1]; B.column(ctx, x, y, 14, 1.1, C.crane, env); line(ctx, [x, y - 14], [x + 14, y - 11], 1.3, C.crane, 0.1, 1); line(ctx, [x, y - 14], [x - 5, y - 13], 1.3, C.crane, -0.2, 1); line(ctx, [x, y - 16], [x + 11, y - 11.6], 0.6, C.iron, 0.2, 0.9); line(ctx, [x + 10, y - 11.8], [x + 10, y - 6], 0.6, C.iron, 0.2, 0.9); B.orb(ctx, x + 10, y - 5.4, 1, 1, C.iron, 0.1, { noRim: true }); break; }
      case 'couch': { const x = at[0], y = at[1]; B.fillQuadShaded(ctx, [[x - 4, y - 1], [x + 4, y - 1], [x + 4, y - 3.6], [x - 4, y - 3.6]], C.purple, { face: 'sw', material: 'cloth', noAO: true }, env); B.fillQuadShaded(ctx, [[x - 4, y - 3.6], [x + 4, y - 3.6], [x + 4, y - 5.6], [x - 4, y - 5.6]], C.purple2, { face: 'top', material: 'cloth', noAO: true }, env); break; }
      case 'cars': { if (g.lift > 0) break; const CARS = [['#C9CDD2', 72, 13], ['#2B2B33', 85, 13], ['#B03A3A', 72, 23], ['#E8E8E8', 85, 23], ['#3D6FA8', 85, 33], ['#8A6A3A', 72, 33]]; for (let i = 0; i < CARS.length; i++) { if (i === 5 && (g.seed & 1)) continue; const p = fp(g, CARS[i][1], CARS[i][2], 0, true); car(ctx, p[0], p[1], CARS[i][0], night, env); } break; }
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
    if (A.umbrellas && margin >= 10) {   // H2b: café umbrellas along the SW and SE margins, nudged clear of the walk and the tees
      const n = Math.max(1, Math.min(3, g.fw + g.fh - 2)), NUDGE = [0, 0.12, -0.12, 0.2, -0.2];
      for (let i = 0; i < n; i++) {
        const sw = (i & 1) === 0, side = sw ? 1 : 0, f = sw ? 0 : 1, t0 = 0.15 + 0.7 * (i + 0.5) / n, L = faceLen(gb, f);
        for (let j = 0; j < NUDGE.length; j++) { const t = t0 + NUDGE[j]; if (t < 0.1 || t > 0.9 || skipped(f, toFace(f, t), 5 / L)) continue; umbrella(ctx, marginPt(g, side, t, true), g.seed + i, env); break; }
      }
    }
  }
  /** a café umbrella (gold or purple canopy on a dark pole) with two chairs */
  function umbrella(ctx, p, seed, env) {
    const col = (hash(seed, 7) & 1) ? C.gold : C.purple2, x = p[0], y = p[1];
    B.shadow(ctx, { x: x + 1.5, y: y + 0.4, rx: 5, ry: 2, a: 0.25 }, env);
    B.orb(ctx, x - 4, y - 1.2, 1.3, 0.8, C.paveLight, -0.5, { noRim: true }); B.orb(ctx, x + 4, y - 1.2, 1.3, 0.8, C.paveLight, -0.5, { noRim: true });
    B.column(ctx, x, y, 9, 0.45, C.lampPost, env);
    B.orb(ctx, x, y - 8.6, 5.6, 1.4, col, -0.1, { noRim: true });
    B.plane(ctx, [[x - 5.5, y - 8.5], [x + 5.5, y - 8.5], [x, y - 11.5]], col, 0.25, { amp: 0.25, rim: 0.2 });
    B.orb(ctx, x, y - 11.6, 0.5, 0.5, C.gold, 0.4, { noRim: true });
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
    for (const pr of (D.props || [])) if (pr.back) drawProp(ctx, g, b, pr, frame, night, env);   // what stands behind the walls (the lookout tower)
    drawWalls(ctx, b, env);
    layoutWindows(b, cols, rows, night, frame);
    drawWindows(ctx, b, env, { night: night, frame: frame });
    if (hasF(g, 'belfry')) drawBelfry(ctx, b, night, env);
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
    const sign = featureArg(g, 'sign:'); if (sign) drawSign(ctx, b, sign, night, env); else if (hasD(g, 'sign')) drawSign(ctx, b, 'XXX', night, env);   // the side sign board: gold marks, no text
    if (hasD(g, 'banner') && !hasF(g, 'banner:roux')) drawSideBanner(ctx, b, env);
    if (D.impeller) drawImpeller(ctx, b, frame, env);
    if (D.cross) drawCross(ctx, b, env);
    const tip = (D.spire && b.ridge) ? drawSpire(ctx, b, env) : null;
    if (hasD(g, 'flag') && b.ridge) { const p = lerp(b.ridge[0], b.ridge[1], 0.9); B.column(ctx, p[0], p[1], 10, 0.6, C.limestone, env); B.fillQuadShaded(ctx, [[p[0] + 0.6, p[1] - 10], [p[0] + 5.5, p[1] - 10 + (frame & 1)], [p[0] + 5.5, p[1] - 7.5 + (frame & 1)], [p[0] + 0.6, p[1] - 7.5]], C.purple, { face: 'sw', material: 'cloth', noAO: true }, env); }
    if (hasF(g, 'flagpole')) drawFlagpole(ctx, g, frame, env);
    if (hasD(g, 'lights')) drawStringLights(ctx, b, night, env);
    if (hasD(g, 'beacon')) drawBeacon(ctx, tip || roofTop(b, 0.5, 0.5), night || (frame & 1) === 1, env);
    if (hasD(g, 'pipes')) drawPipes(ctx, b, env);
    if (D.stripe) { const p0 = facePt(b, 1, 0.5, 0, 0.5), p1 = facePt(b, 1, 0.5, b.wallH, 0.5); line(ctx, p0, p1, 2.2, D.stripe, 0.1, 1); line(ctx, [p0[0] + 1, p0[1] - 0.5], [p1[0] + 1, p1[1] - 0.5], 0.8, D.stripe, -0.6, 0.8); }
    if (D.plaque) { const f = 1 - b.doorFace, L = faceLen(b, f), top = b.wallH * 0.55; B.fillQuadShaded(ctx, faceQuad(b, f, 0.5 - 7 / L, 0.5 + 7 / L, top - 6, top, 0.6), C.purple, { face: f === 0 ? 'sw' : 'se', material: 'paint', noAO: true }, env); for (const d of [-4, 0, 4]) line(ctx, facePt(b, f, 0.5 + d / L, top - 4.6, 0.8), facePt(b, f, 0.5 + d / L, top - 1.4, 0.8), 1.4, C.gold, 0.2, 0.95); }
    for (const pr of (D.props || [])) if (!pr.back) drawProp(ctx, g, b, pr, frame, night, env);
    return b;
  }
  /** H2b: a purple banner hung on the far face (the union's): gold border, gold diamond */
  function drawSideBanner(ctx, b, env) {
    const f = 1 - b.doorFace, L = faceLen(b, f), top = b.wallH - 3, w = Math.min(14, L * 0.3), u0 = 0.5 - w / 2 / L, u1 = 0.5 + w / 2 / L, hb = Math.min(10, b.wallH * 0.4);
    B.fillQuadShaded(ctx, faceQuad(b, f, u0, u1, top - hb, top, 0.5), C.purple, { face: f === 0 ? 'sw' : 'se', material: 'cloth', noAO: true }, env);
    B.stroke(ctx, faceQuad(b, f, u0, u1, top - hb, top, 0.6), 0.7, C.gold, 0.2, 0.9, { close: true });
    const m = facePt(b, f, 0.5, top - hb / 2, 0.8); B.decal(ctx, { x: m[0], y: m[1] + 1.6, w: 3.2, h: 3.4, color: C.gold, trim: null, shape: 'diamond', face: f === 0 ? 'sw' : 'se' }, env);
  }
  /** H2b: the pump wheel on the far face — a steel disc in an iron rim, gold spokes (a quarter turn by frame), a dark hub */
  function drawImpeller(ctx, b, frame, env) {
    const f = 1 - b.doorFace, p = facePt(b, f, 0.76, Math.max(5, b.wallH * 0.5), 0.9), r = Math.min(4.5, b.wallH * 0.32), a = (frame & 1) ? Math.PI / 4 : 0;
    B.orb(ctx, p[0], p[1], r + 0.5, r + 0.5, C.iron, -0.2, { noRim: true }); B.orb(ctx, p[0], p[1], r - 0.4, r - 0.4, C.steel, 0.1, { spec: 0.3 });
    for (let k = 0; k < 2; k++) { const t = a + k * Math.PI / 2; line(ctx, [p[0] - Math.cos(t) * (r - 0.8), p[1] - Math.sin(t) * (r - 0.8)], [p[0] + Math.cos(t) * (r - 0.8), p[1] + Math.sin(t) * (r - 0.8)], 1, C.gold, 0.2, 0.95); }
    B.orb(ctx, p[0], p[1], 0.9, 0.9, C.black, 0, { noRim: true }); void env;
  }
  /** H2b: the health centre's cross — a white disc with a red cross above the door */
  function drawCross(ctx, b, env) {
    const p = facePt(b, b.doorFace, 0.5, b.wallH - 3.6, 0.8);
    B.orb(ctx, p[0], p[1], 3, 3, C.white, 0.3, { spec: 0.2 }); line(ctx, [p[0], p[1] - 1.9], [p[0], p[1] + 1.9], 1.4, C.danger, 0, 1); line(ctx, [p[0] - 1.9, p[1]], [p[0] + 1.9, p[1]], 1.4, C.danger, 0, 1); void env;
  }
  /** H2b: the belfry — the top row's windows become arched openings with a gold bell on an iron pin (brighter at night) */
  function drawBelfry(ctx, b, night, env) {
    const g = b.g, trim = g.trim; let top = -1; for (const c of b.cells) if (c.r > top) top = c.r; if (top < 0) return;
    for (const c of b.cells) {
      if (c.r !== top) continue; const L = faceLen(b, c.face), ft = c.face === 0 ? 0.2 : -0.3;
      const q = faceQuad(b, c.face, c.u0 - 0.8 / L, c.u1 + 0.8 / L, c.h0 - 1.5, c.h1 + 1.5), a = facePt(b, c.face, (c.u0 + c.u1) / 2, c.h1 + 1.5);
      const w = Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1]) / 2, ang = Math.atan2(q[2][1] - q[3][1], q[2][0] - q[3][0]);
      ctx.fillStyle = tone(trim, ft, 0.9); ctx.beginPath(); ctx.ellipse(a[0], a[1], w + 1.2, 2.6, ang, Math.PI, 0); ctx.fill();   // the arch head
      ctx.fillStyle = tone(g.wallBase, -0.9); ctx.beginPath(); ctx.ellipse(a[0], a[1], w, 2, ang, Math.PI, 0); ctx.fill();
      flat(ctx, q, g.wallBase, -0.9);
      line(ctx, facePt(b, c.face, c.u0 - 1.2 / L, c.h0 - 1.8), facePt(b, c.face, c.u1 + 1.2 / L, c.h0 - 1.8), 1, trim, ft, 0.95);   // the sill
      const m = facePt(b, c.face, (c.u0 + c.u1) / 2, (c.h0 + c.h1) / 2 + 0.6); line(ctx, [m[0], m[1] - 2.6], [m[0], m[1] - 1.2], 0.6, C.iron, 0, 1);
      B.orb(ctx, m[0], m[1] + 0.2, 1.5, 1.6, C.gold, night ? 0.5 : 0.1, { spec: 0.5 }); B.orb(ctx, m[0], m[1] + 1.6, 0.5, 0.5, C.gold, -0.5, { noRim: true });
    }
    void env;
  }
  /** H2b: a pyramid spire on the ridge centre with a gold finial; returns its tip (the beacon stands there) */
  function drawSpire(ctx, b, env) {
    const m = mid(b.ridge[0], b.ridge[1]), x = m[0], y = m[1], hw = Math.max(6, Math.min(b.X1 - b.X0, b.Y1 - b.Y0) * 0.22), H = 16;
    B.plane(ctx, [[x - hw, y - 1], [x, y + hw * 0.5], [x, y - H]], b.roofColor, 0.15, { amp: 0.2, rim: 0.2 });
    B.plane(ctx, [[x, y + hw * 0.5], [x + hw, y - 1], [x, y - H]], b.roofColor, -0.35, { amp: 0.2, rim: 0.1 });
    line(ctx, [x, y + hw * 0.5], [x, y - H], 0.8, b.roofColor, 0.5, 0.6);
    B.column(ctx, x, y - H + 0.5, 3.5, 0.6, C.gold, env); B.orb(ctx, x, y - H - 3.4, 0.9, 0.9, C.gold, 0.5, { spec: 0.5 });
    return [x, y - H - 4];
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
  // ---------------------------------------------------------------------------
  // H2b bodies: rows with their own ground (no apron margins, no foundation): the quad, the parking lot, the pond, the rookery,
  // the bat house, the practice field, the stadium (sprites.stadiumGeom per tier, so render's football overlay — the field
  // rectangle, the fan rows, the shader clip, the mast heads — lands on the painted structure) and the Tiger Habitat
  // (sprites.HABITAT: the pool, the den, the glass and the plaza where Roux's route and the lights pass expect them).
  // ---------------------------------------------------------------------------
  const OWN_GROUND = { quad: 1, parking: 1, pond: 1, rookery: 1, batpole: 1, field: 1, stadium: 1, habitat: 1 };
  const OWN_STATES = { habitat: 1 };   // dresses DAMAGED / BOARDED / FLOODED itself (the pen's OWN_STATES)
  const RX = 45.25, RY = 22.63;        // the screen half-axes of a 1-tile ground circle
  /** footprint TILE coordinates (the pen's fpPt): (X, Y) tiles, `up` px — the stadium / field / habitat language */
  function fT(g, X, Y, up) { return fp(g, X * 32, Y * 32, up || 0); }
  function quadT(g, pts) { return pts.map((p) => fT(g, p[0], p[1], p[2] || 0)); }
  /** the footprint quad at the body's level (lifted under PILINGS) */
  function bodyQuad(g) { return [fp(g, 0, 0, 0), fp(g, g.fw * 32, 0, 0), fp(g, g.fw * 32, g.fh * 32, 0), fp(g, 0, g.fh * 32, 0)]; }
  /** a wall-less body box for the states: a flat top at 0, no cells */
  function flatBody(g) { const b = mainBox(g); b.wallH = 0; b.floors = 0; b.planes = { kind: 'flat', top: 0 }; b.cells = []; return b; }
  /** a park bench (footprint px): a wood seat on two iron legs with a slatted back */
  function bench(ctx, g, X, Y, color, env) {
    const p = fp(g, X, Y, 0), x = p[0], y = p[1];
    B.shadow(ctx, { x: x + 1, y: y + 0.3, rx: 4.5, ry: 1.4, a: 0.25 }, env);
    for (const dx of [-3, 3]) line(ctx, [x + dx, y], [x + dx, y - 2.2], 0.8, C.iron, 0, 0.95);
    B.fillQuadShaded(ctx, [[x - 4, y - 2], [x + 4, y - 2], [x + 4, y - 3.4], [x - 4, y - 3.4]], color, { face: 'top', material: 'wood', noAO: true }, env);
    B.fillQuadShaded(ctx, [[x - 4, y - 3.4], [x + 4, y - 3.4], [x + 4, y - 5.6], [x - 4, y - 5.6]], color, { face: 'sw', material: 'wood', t: -0.1, noAO: true }, env);
  }
  /** a gold goalpost standing on p */
  function goalpost(ctx, p, env) {
    const x = p[0], y = p[1];
    B.column(ctx, x, y, 10, 0.7, C.gold, env);
    line(ctx, [x - 4, y - 10], [x + 4, y - 10], 1, C.gold, 0.2, 1); line(ctx, [x - 4, y - 10], [x - 4, y - 16], 1, C.gold, 0.3, 1); line(ctx, [x + 4, y - 10], [x + 4, y - 16], 1, C.gold, 0.3, 1);
    B.orb(ctx, x - 4, y - 16.3, 0.5, 0.5, C.gold, 0.6, { noRim: true }); B.orb(ctx, x + 4, y - 16.3, 0.5, 0.5, C.gold, 0.6, { noRim: true });
  }
  /**
   * A tiered stand over the footprint rect r = {x0, x1, y0, y1} (tiles); `inner` names the field-side edge ('y1' | 'y0' | 'x1' | 'x0'),
   * lifts hIn at the field edge and hOut at the back (sprites_buildings.stadiumStand's geometry, so render's fan rows and shader clip
   * land on the treads). Facing the camera: purple treads with risers, a gold rim; seen from behind: the concrete back wall with the
   * concourse band, vomitory slits (lit at night) and the gold rim.
   */
  function stand(ctx, g, r, inner, hIn, hOut, steps, night, env) {
    const alongX = inner[0] === 'y', faces = inner[1] === '1', lod0 = env.lod === 0;
    if (!faces) hIn = 0;
    const span = alongX ? r.y1 - r.y0 : r.x1 - r.x0, d = span / steps, dh = (hOut - hIn) / steps;
    const innerC = faces ? (alongX ? r.y1 : r.x1) : (alongX ? r.y0 : r.x0), outerC = faces ? (alongX ? r.y0 : r.x0) : (alongX ? r.y1 : r.x1), dir = faces ? -1 : 1;
    const quad = (a, c, la, lb) => quadT(g, alongX ? [[r.x0, a, la], [r.x1, a, la], [r.x1, c, lb], [r.x0, c, lb]] : [[a, r.y0, la], [a, r.y1, la], [c, r.y1, lb], [c, r.y0, lb]]);
    const liftAt = (c) => hIn + (hOut - hIn) * Math.abs(c - innerC) / span;
    const tread = (q, j) => { B.fillQuadShaded(ctx, q, C.purple, { face: 'top', material: 'paint', t: (j & 1) ? 0.12 : -0.08, noAO: true }, env); if (lod0) line(ctx, q[0], q[1], 0.6, C.purple, 0.45, 0.6); };
    // the end face toward the camera: +X (shadow) for a stand along X, +Y (lit) for one along Y — concrete below the seat line
    if (alongX) B.fillQuadShaded(ctx, quadT(g, [[r.x1, r.y0, 0], [r.x1, r.y1, 0], [r.x1, r.y1, liftAt(r.y1)], [r.x1, r.y0, liftAt(r.y0)]]), C.concrete, { face: 'se', material: 'stone', noAO: true }, env);
    else B.fillQuadShaded(ctx, quadT(g, [[r.x0, r.y1, 0], [r.x1, r.y1, 0], [r.x1, r.y1, liftAt(r.x1)], [r.x0, r.y1, liftAt(r.x0)]]), C.concrete, { face: 'sw', material: 'stone', noAO: true }, env);
    if (faces && hIn > 8) { const ec = alongX ? r.x1 : r.y1; for (let lv = 14; lv < hOut - 4; lv += 14) { const a = alongX ? fT(g, ec, r.y0, Math.min(lv, liftAt(r.y0))) : fT(g, r.x0, ec, Math.min(lv, liftAt(r.x0))), c = alongX ? fT(g, ec, r.y1, Math.min(lv, liftAt(r.y1))) : fT(g, r.x1, ec, Math.min(lv, liftAt(r.x1))); line(ctx, a, c, 0.8, C.concrete, alongX ? -0.6 : -0.4, 0.8); } }   // an upper deck's floor lines
    if (!faces) {
      for (let j = 0; j < steps; j++) { const a = innerC + dir * j * d, c = innerC + dir * (j + 1) * d, l = hIn + j * dh; tread(quad(a, c, l, l), j); }
      B.fillQuadShaded(ctx, quad(outerC, outerC, 0, hOut), C.concrete, { face: alongX ? 'sw' : 'se', material: 'stone', noAO: true }, env);   // the back wall
      const at = (zz) => alongX ? [fT(g, r.x0, outerC, zz), fT(g, r.x1, outerC, zz)] : [fT(g, outerC, r.y0, zz), fT(g, outerC, r.y1, zz)];
      const cb = at(hOut * 0.5); line(ctx, cb[0], cb[1], 1.2, C.concrete, alongX ? 0.3 : -0.1, 0.9);   // the concourse band
      const n = Math.max(2, Math.round((alongX ? r.x1 - r.x0 : r.y1 - r.y0) * 2));
      for (let k = 1; k < n; k++) { const t = k / n, p = alongX ? fT(g, r.x0 + (r.x1 - r.x0) * t, outerC, hOut * 0.45) : fT(g, outerC, r.y0 + (r.y1 - r.y0) * t, hOut * 0.45); const sq = [[p[0] - 0.6, p[1]], [p[0] + 0.6, p[1]], [p[0] + 0.6, p[1] + 3], [p[0] - 0.6, p[1] + 3]]; if (night) B.glow(ctx, sq, GLOWS[1], env); else flat(ctx, sq, C.concrete, -0.7, 0.9); }   // vomitory slits
      const rim = at(hOut); line(ctx, rim[0], rim[1], 1.2, C.gold, 0.2, 0.95);
    } else {
      for (let j = steps - 1; j >= 0; j--) {
        const a = innerC + dir * j * d, c = innerC + dir * (j + 1) * d, l = hIn + j * dh;
        tread(quad(a, c, l, l), j);
        B.fillQuadShaded(ctx, quad(a, a, l, Math.max(0, l - dh)), C.purple, { face: alongX ? 'sw' : 'se', material: 'paint', t: -0.25, noAO: true }, env);   // the riser toward the field
        if (j === steps - 1) { const e = alongX ? [fT(g, r.x0, c, l), fT(g, r.x1, c, l)] : [fT(g, c, r.y0, l), fT(g, c, r.y1, l)]; line(ctx, e[0], e[1], 1.2, C.gold, 0.2, 0.95); }
      }
      const e = alongX ? [fT(g, r.x0, innerC, hIn), fT(g, r.x1, innerC, hIn)] : [fT(g, innerC, r.y0, hIn), fT(g, innerC, r.y1, hIn)]; line(ctx, e[0], e[1], 1, C.gold, -0.5, 0.9);
    }
  }
  /** a light mast: a braced steel pole `h` px tall from footprint (X, Y) lifted `base`, a bank of lamps on top (white-hot with a halo at night) */
  function mast(ctx, g, X, Y, base, h, night, big, env) {
    const p = fT(g, X, Y, base), x = p[0], top = p[1] - h, lod0 = env.lod === 0;
    B.column(ctx, x, p[1], h - 3, big ? 1.6 : 1.3, C.steel, env);
    if (lod0) for (let y = top + 8; y < p[1] - 6; y += 8) { line(ctx, [x - 2, y + 2], [x + 2, y - 2], 0.5, C.steel, -0.3, 0.8); line(ctx, [x - 2, y - 2], [x + 2, y + 2], 0.5, C.steel, -0.3, 0.8); }
    B.orb(ctx, x, p[1], 2.6, 1.2, C.steel, -0.3, { noRim: true });
    const bw = big ? 12 : 8, bh = big ? 5 : 4, bank = [[x - bw / 2, top + bh], [x + bw / 2, top + bh], [x + bw / 2, top], [x - bw / 2, top]];
    if (night) { B.softEllipse(ctx, x, top + bh / 2, bw * 1.6, bh * 2.2, GLOWS[1], 0.35, 0.15); B.glow(ctx, bank, C.white, env); for (let k = 1; k < bw - 1; k += 2) B.orb(ctx, x - bw / 2 + k + 0.5, top + 1.2, 0.6, 0.6, GLOWS[0], 0.6, { noRim: true }); }
    else { B.fillQuadShaded(ctx, bank, C.steel, { face: 'sw', material: 'metal', t: 0.1, noAO: true }, env); for (let k = 1; k < bw - 1; k += 2) B.orb(ctx, x - bw / 2 + k + 0.5, top + 1.2, 0.6, 0.6, C.lampHead, 0.2, { noRim: true }); }
    line(ctx, [x - bw / 2, top + bh], [x + bw / 2, top + bh], 0.8, C.steel, 0.4, 0.9);
  }
  /** the playing field on rect f (tiles): turf stripes, gold end zones, white yard lines (hash marks at lod 0), the purple midfield mark with a gold diamond; bare = turf only */
  function stadiumField(ctx, g, f, bare, env) {
    const n = 8, ez = (f.x1 - f.x0) * 0.1, lod0 = env.lod === 0;
    for (let k = 0; k < n; k++) { const a = f.x0 + (f.x1 - f.x0) * k / n, c = f.x0 + (f.x1 - f.x0) * (k + 1) / n; B.fillQuadShaded(ctx, quadT(g, [[a, f.y0], [c, f.y0], [c, f.y1], [a, f.y1]]), C.turf, { face: 'top', material: 'wood', t: (k & 1) ? -0.18 : 0.04, noAO: true }, env); }
    if (bare) return;
    for (const z of [[f.x0, f.x0 + ez], [f.x1 - ez, f.x1]]) B.fillQuadShaded(ctx, quadT(g, [[z[0], f.y0], [z[1], f.y0], [z[1], f.y1], [z[0], f.y1]]), C.gold, { face: 'top', material: 'paint', t: 0.05, noAO: true }, env);
    const wl = (a, c, w, al) => line(ctx, fT(g, a[0], a[1], 0.2), fT(g, c[0], c[1], 0.2), w, C.white, 0, al);
    for (let k = 0; k <= 10; k++) { const x = f.x0 + ez + (f.x1 - f.x0 - 2 * ez) * k / 10; wl([x, f.y0], [x, f.y1], 0.8, k % 5 === 0 ? 0.95 : 0.75); }
    wl([f.x0, f.y0], [f.x1, f.y0], 0.9, 0.95); wl([f.x0, f.y1], [f.x1, f.y1], 0.9, 0.95);
    if (lod0) for (let k = 1; k < 50; k++) { if (k % 5 === 0) continue; const x = f.x0 + ez + (f.x1 - f.x0 - 2 * ez) * k / 50; for (const v of [0.3, 0.7]) { const p = fT(g, x, f.y0 + (f.y1 - f.y0) * v, 0.2); line(ctx, [p[0], p[1] - 0.6], [p[0], p[1] + 0.6], 0.5, C.white, 0, 0.5); } }
    const m = fT(g, (f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, 0.3); ctx.fillStyle = tone(C.purple, 0.05); ctx.beginPath(); ctx.ellipse(m[0], m[1], 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    B.decal(ctx, { x: m[0], y: m[1] + 2.2, w: 6, h: 4.4, color: C.gold, trim: null, shape: 'diamond', face: 'sw' }, env);
  }
  /** a band between two decks: a sloped concrete concourse ledge with vomitory slits, or the tier III luxury boxes (a glass band, lit at night) */
  function stadiumBand(ctx, g, bd, night, env) {
    const ax = bd.along === 'x';
    const q = quadT(g, ax ? [[bd.r.x0, bd.cIn, bd.zIn], [bd.r.x1, bd.cIn, bd.zIn], [bd.r.x1, bd.cOut, bd.zOut], [bd.r.x0, bd.cOut, bd.zOut]] : [[bd.cIn, bd.r.y0, bd.zIn], [bd.cIn, bd.r.y1, bd.zIn], [bd.cOut, bd.r.y1, bd.zOut], [bd.cOut, bd.r.y0, bd.zOut]]);
    const len = ax ? bd.r.x1 - bd.r.x0 : bd.r.y1 - bd.r.y0, zm = (bd.zIn + bd.zOut) / 2, cm = (bd.cIn + bd.cOut) / 2;
    const edge = ax ? [fT(g, bd.r.x0, bd.cOut, bd.zOut), fT(g, bd.r.x1, bd.cOut, bd.zOut)] : [fT(g, bd.cOut, bd.r.y0, bd.zOut), fT(g, bd.cOut, bd.r.y1, bd.zOut)];
    if (bd.kind === 'boxes') {
      B.fillQuadShaded(ctx, q, C.concrete, { face: ax ? 'sw' : 'se', material: 'stone', t: -0.15, noAO: true }, env);
      const n = Math.max(3, Math.round(len * 3.2));
      for (let k = 0; k < n; k++) {
        const t0 = (k + 0.12) / n, t1 = (k + 0.88) / n;
        const pane = quadT(g, ax ? [[bd.r.x0 + len * t0, cm, zm - 4], [bd.r.x0 + len * t1, cm, zm - 4], [bd.r.x0 + len * t1, cm, zm + 3], [bd.r.x0 + len * t0, cm, zm + 3]] : [[cm, bd.r.y0 + len * t0, zm - 4], [cm, bd.r.y0 + len * t1, zm - 4], [cm, bd.r.y0 + len * t1, zm + 3], [cm, bd.r.y0 + len * t0, zm + 3]]);
        if (night && (hash(g.seed | 0, 200 + k) % 5) !== 0) B.glow(ctx, pane, GLOWS[k % 4], env); else B.fillQuadShaded(ctx, pane, C.glass, { face: ax ? 'sw' : 'se', material: 'glass', noAO: true }, env);
      }
      line(ctx, edge[0], edge[1], 1, C.concrete, 0.5, 0.9);
      return;
    }
    B.fillQuadShaded(ctx, q, C.concrete, { face: 'top', material: 'stone', t: 0.15, noAO: true }, env);
    const n = Math.max(2, Math.round(len * 2));
    for (let k = 1; k < n; k++) { const p = ax ? fT(g, bd.r.x0 + len * k / n, cm, zm) : fT(g, cm, bd.r.y0 + len * k / n, zm); const sq = [[p[0] - 0.6, p[1] - 1], [p[0] + 0.6, p[1] - 1], [p[0] + 0.6, p[1] + 2], [p[0] - 0.6, p[1] + 2]]; if (night) B.glow(ctx, sq, GLOWS[2], env); else flat(ctx, sq, C.concrete, -0.6, 0.9); }
    line(ctx, edge[0], edge[1], 1, C.concrete, 0.7, 0.9);
  }
  /** tier II scoreboard (x, y = top-left): a black panel in a gold frame, BSU marks, a gold clock bar that sweeps with the frame */
  function scoreboard(ctx, x, y, w, h, night, frame, env) {
    const q = [[x, y + h], [x + w, y + h], [x + w, y], [x, y]];
    B.fillQuadShaded(ctx, q, C.black, { face: 'sw', material: 'paint', t: 0.1, noAO: true }, env);
    B.stroke(ctx, q, 1, C.gold, 0.1, 0.95, { close: true });
    for (let i = 0; i < 3; i++) line(ctx, [x + w / 2 - 4 + i * 4, y + 3], [x + w / 2 - 4 + i * 4, y + 8], 1.6, C.gold, night ? 0.5 : 0.2, 0.95);
    const by = y + h - 4, f = ((frame | 0) % 4 + 4) % 4; line(ctx, [x + 2, by], [x + w - 2, by], 1, C.gold, -0.7, 0.9); line(ctx, [x + 2, by], [x + 8 + f * ((w - 10) / 4), by], 1, C.gold, night ? 0.6 : 0.2, 0.95);
    if (h >= 16) for (let k = 0; k < 4; k++) B.orb(ctx, x + 3 + k * 3, y + 2, 0.6, 0.6, (k === (f & 3)) ? C.gold : C.purple, k === (f & 3) ? 0.6 : 0, { noRim: true });
  }
  /** tier III jumbotron: a black screen in a steel frame, the tiger crest (blinks on frame 3), BSU marks, a gold ticker that cycles with the frame, a lamp strip */
  function jumbotron(ctx, x, y, w, h, night, frame, env) {
    B.fillQuadShaded(ctx, [[x - 1.5, y + h + 2], [x + w + 1.5, y + h + 2], [x + w + 1.5, y - 1.5], [x - 1.5, y - 1.5]], C.steel, { face: 'sw', material: 'metal', noAO: true }, env);
    flat(ctx, [[x, y + h], [x + w, y + h], [x + w, y], [x, y]], C.black, 0.05);
    const ox = x + w / 2, oy = y + 7, f = ((frame | 0) % 4 + 4) % 4, blink = f === 3;
    B.orb(ctx, ox, oy, 5.5, 4.5, C.tigerOrange, 0.1, { spec: 0.3 }); B.orb(ctx, ox - 3.6, oy - 3.6, 1.3, 1.3, C.tigerOrange, 0.1, { noRim: true }); B.orb(ctx, ox + 3.6, oy - 3.6, 1.3, 1.3, C.tigerOrange, 0.1, { noRim: true });
    B.orb(ctx, ox - 2, oy - 0.6, 0.8, 0.8, blink ? C.black : C.white, 0, { noRim: true }); B.orb(ctx, ox + 2, oy - 0.6, 0.8, 0.8, blink ? C.black : C.white, 0, { noRim: true }); line(ctx, [ox - 1, oy + 1.6], [ox + 1, oy + 1.6], 0.9, C.black, 0, 1);
    line(ctx, [ox - 1.5, oy - 3.5], [ox - 1.5, oy + 0.5], 0.6, C.tigerOrange, -0.6, 0.9); line(ctx, [ox + 1.5, oy - 3.5], [ox + 1.5, oy + 0.5], 0.6, C.tigerOrange, -0.6, 0.9);
    for (let i = 0; i < 3; i++) line(ctx, [x + 4 + i * 4, y + 3], [x + 4 + i * 4, y + 8], 1.6, C.gold, night ? 0.5 : 0.2, 0.95);
    const tw = w - 6; line(ctx, [x + 3, y + h - 5], [x + 3 + tw, y + h - 5], 1.2, C.purple2, 0, 0.95); line(ctx, [x + 3 + tw * f / 4, y + h - 5], [x + 3 + tw * (f + 1) / 4, y + h - 5], 1.2, f === 2 ? C.purple : C.gold, f === 1 ? 0.6 : f === 2 ? 0.5 : 0.1, 0.95);
    line(ctx, [x + 3, y + h - 3], [x + 3 + tw, y + h - 3], 1, C.gold, night ? 0.6 : 0.1, 0.95);
    for (let k = 2; k < w - 2; k += 6) B.orb(ctx, x + k, y + h + 1, 0.6, 0.6, night ? GLOWS[1] : C.steel, night ? 0.6 : 0.3, { noRim: true });
  }
  /** the construction site (SCAFFOLD frames 0–2 and tier 0): graded dirt in the lawn verge, dozer tracks, sand piles; (1) the bare turf, footings, two tower cranes; (2) the steel stand frames, unlit masts; fencing with an orange gate */
  function stadiumSite(ctx, g, stage, env) {
    const b = flatBody(g), fw = g.fw, fh = g.fh, seed = g.seed | 0, G = M.stadiumGeom(0, fw, fh), G1 = M.stadiumGeom(1, fw, fh), inset = 0.12, lod0 = env.lod === 0;
    drawApron(ctx, g, APRON.lawnPlain, env, { lifted: g.lift > 0 });
    const dq = quadT(g, [[inset, inset], [fw - inset, inset], [fw - inset, fh - inset], [inset, fh - inset]]);
    B.fillQuadShaded(ctx, dq, C.siteDirt, { face: 'top', material: 'stone', t: 0, noAO: true }, env); B.macroGrain(ctx, dq, 0.4, env);
    for (let k = 1; k < fh * 2; k++) line(ctx, fT(g, inset + 0.2, k / 2), fT(g, fw - inset - 0.2, k / 2), 0.8, C.siteDirt, -0.4, 0.5);
    for (let k = 0; k < 6; k++) { const p = fT(g, 0.5 + (hash(seed, 11 + k) % 100) / 100 * (fw - 1), 0.5 + (hash(seed, 31 + k) % 100) / 100 * (fh - 1), 0); B.orb(ctx, p[0], p[1] - 1, 4.5, 2.2, C.sandbag, 0.2, { noRim: true }); }
    if (stage >= 1) {
      stadiumField(ctx, g, G.field, stage < 2, env);
      for (let k = 0; k < 8; k++) { const X = 1.1 + (fw - 2.2) * k / 7; for (const Y of [0.5, fh - 0.5]) { const p = fT(g, X, Y, 0); flat(ctx, [[p[0] - 1.5, p[1]], [p[0] + 1.5, p[1]], [p[0] + 1.5, p[1] - 3], [p[0] - 1.5, p[1] - 3]], C.concrete, 0.1); line(ctx, [p[0] - 1.5, p[1]], [p[0] + 1.5, p[1]], 0.7, C.concrete, -0.6, 0.8); } }
      for (let k = 0; k < G.cranes.length; k++) { const p = fT(g, G.cranes[k][0], G.cranes[k][1], 0); craneAt(ctx, p[0], p[1], 64 + 14 * stage, env); }
    }
    if (stage >= 2) {
      for (const sd of [[0.5, G1.farRim], [fh - 0.5, G1.nearRim]]) { const Y = sd[0], Hh = sd[1]; line(ctx, fT(g, 1.0, Y, Hh), fT(g, fw - 1.0, Y, Hh), 1, C.steel, 0.2, 0.95); line(ctx, fT(g, 1.0, Y, Hh * 0.5), fT(g, fw - 1.0, Y, Hh * 0.5), 0.8, C.steel, -0.3, 0.9); for (let k = 0; k < 8; k++) { const X = 1.0 + (fw - 2) * k / 7; line(ctx, fT(g, X, Y, 0), fT(g, X, Y, Hh), 0.9, C.steel, -0.3, 0.95); } }
      for (const m of G.masts) mast(ctx, g, m[0], m[1], m[2], m[3], false, false, env);
    }
    const fence = (a, c, frontEdge) => {
      const n = Math.round(Math.hypot(c[0] - a[0], c[1] - a[1]) * 2);
      for (let k = 0; k <= n; k++) { const t = k / n, p = fT(g, a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, 0); B.column(ctx, p[0], p[1], 7, 0.5, C.steel, env); }
      line(ctx, fT(g, a[0], a[1], 6), fT(g, c[0], c[1], 6), 0.6, C.chain, 0.1, 0.8); line(ctx, fT(g, a[0], a[1], 3), fT(g, c[0], c[1], 3), 0.6, C.chain, -0.2, 0.7);
      if (frontEdge) { const m = fT(g, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, 0); B.fillQuadShaded(ctx, [[m[0] - 3, m[1] - 2], [m[0] + 3, m[1] - 2], [m[0] + 3, m[1] - 6], [m[0] - 3, m[1] - 6]], C.tigerOrange, { face: 'sw', material: 'paint', noAO: true }, env); line(ctx, [m[0] - 3, m[1] - 5], [m[0] + 3, m[1] - 5], 0.8, C.white, 0, 0.9); }
    };
    const e = 0.05;
    fence([e, e], [fw - e, e], false); fence([e, e], [e, fh - e], false); fence([fw - e, e], [fw - e, fh - e], false); fence([e, fh - e], [fw - e, fh - e], true);
    void lod0;
    return b;
  }
  /** the stadium over sprites.stadiumGeom(tier): the field, the stands back to front (bands between decks), the press box (I), the masts, the board (II / III), ramps or the ticket booth, the gold crown (III), CAULDRON on the near wall; tier 0 is the site */
  function stadiumBody(ctx, g, frame, env) {
    const b = flatBody(g), fw = g.fw, fh = g.fh, night = g.night, tier = g.tier | 0;
    if (tier <= 0) return stadiumSite(ctx, g, 2, env);
    drawApron(ctx, g, APRON.lawnPlain, env, { lifted: g.lift > 0 });
    const G = M.stadiumGeom(tier, fw, fh);
    stadiumField(ctx, g, G.field, false, env);
    const farBands = G.bands.filter((d) => d.along === 'x'), endBands = G.bands.filter((d) => d.along === 'y');
    const decks = (inner, bands) => { const ds = G.stands.filter((s) => s.inner === inner).sort((p, q) => p.deck - q.deck); for (let k = 0; k < ds.length; k++) { if (k > 0 && bands[k - 1]) stadiumBand(ctx, g, bands[k - 1], night, env); const s = ds[k]; stand(ctx, g, s.r, s.inner, s.hIn, s.hOut, s.steps, night, env); } };
    decks('y1', farBands);
    if (G.pressBox) {   // tier I press box on the far bleachers' top treads: concrete with a window band (lit at night), a gold line, BSU marks
      const pb = G.pressBox, z0 = pb.z - 6, z1 = pb.z + pb.h;
      B.fillQuadShaded(ctx, quadT(g, [[pb.x0, pb.y1, z0], [pb.x1, pb.y1, z0], [pb.x1, pb.y1, z1], [pb.x0, pb.y1, z1]]), C.concrete, { face: 'sw', material: 'stone', noAO: true }, env);
      B.fillQuadShaded(ctx, quadT(g, [[pb.x1, pb.y0, z0], [pb.x1, pb.y1, z0], [pb.x1, pb.y1, z1], [pb.x1, pb.y0, z1]]), C.concrete, { face: 'se', material: 'stone', noAO: true }, env);
      B.fillQuadShaded(ctx, quadT(g, [[pb.x0, pb.y0, z1], [pb.x1, pb.y0, z1], [pb.x1, pb.y1, z1], [pb.x0, pb.y1, z1]]), C.concrete, { face: 'top', material: 'stone', noAO: true }, env);
      const n = Math.max(2, Math.round((pb.x1 - pb.x0) * 3));
      for (let k = 0; k < n; k++) { const a = pb.x0 + (pb.x1 - pb.x0) * (k + 0.15) / n, c = pb.x0 + (pb.x1 - pb.x0) * (k + 0.85) / n, pane = quadT(g, [[a, pb.y1, pb.z + 3], [c, pb.y1, pb.z + 3], [c, pb.y1, pb.z + 9], [a, pb.y1, pb.z + 9]]); if (night) B.glow(ctx, pane, GLOWS[k % 4], env); else B.fillQuadShaded(ctx, pane, C.glass, { face: 'sw', material: 'glass', noAO: true }, env); }
      line(ctx, fT(g, pb.x0, pb.y1, z1), fT(g, pb.x1, pb.y1, z1), 1, C.gold, 0.2, 0.95);
      const lp = fT(g, (pb.x0 + pb.x1) / 2, pb.y1, pb.z + 1); for (let i = 0; i < 3; i++) line(ctx, [lp[0] - 4 + i * 4, lp[1] - 7], [lp[0] - 4 + i * 4, lp[1] - 3.5], 1.4, C.gold, 0.2, 0.95);
    }
    for (const m of G.masts) if (m[1] < 1) mast(ctx, g, m[0], m[1], m[2], m[3], night, tier === 3, env);   // the far masts stand behind the left end's decks
    decks('x1', endBands);
    if (G.board) {   // over the far (−X) end on two steel legs from the end stand's rim
      const bd = G.board, sb = fT(g, bd.X, bd.Y, bd.z), legH = bd.kind === 'jumbo' ? 16 : 12;
      for (const dx of [-7, 7]) B.column(ctx, sb[0] + dx, sb[1], legH, 0.9, C.steel, env);
      if (bd.kind === 'jumbo') jumbotron(ctx, sb[0] - bd.w / 2, sb[1] - legH - bd.h - 2, bd.w, bd.h, night, frame, env); else scoreboard(ctx, sb[0] - bd.w / 2, sb[1] - legH - bd.h, bd.w, bd.h, night, frame, env);
    }
    decks('x0', []); decks('y0', []);
    if (tier >= 2) {   // concrete entry ramps up to the near concourse at both near corners
      const hr = G.nearRim * 0.6;
      for (const side of [0, 1]) { const xa = side ? fw - 0.2 : 0.2, xb = side ? fw - 1.3 : 1.3; B.plane(ctx, quadT(g, [[xa, fh - 0.05, 0], [xb, fh - 0.05, 0], [xb, fh - 0.05, hr]]), C.concrete, -0.05, { vert: true, amp: 0.12, rim: 0.15 }); line(ctx, fT(g, xa, fh - 0.05, 0), fT(g, xb, fh - 0.05, hr), 0.8, C.concrete, -0.5, 0.8); B.fillQuadShaded(ctx, quadT(g, [[xb, fh - 0.05, 0], [xb, fh - 0.35, 0], [xb, fh - 0.35, hr], [xb, fh - 0.05, hr]]), C.concrete, { face: 'se', material: 'stone', noAO: true }, env); }
    } else {   // tier I ticket booth at the near-left corner
      const tb = miniBox(ctx, g, 0.5 * 32, (fh - 0.5) * 32, 4, 3, 7, C.purple, 'paint', env, 0); const tq = topQuad(tb, 7); line(ctx, tq[3], tq[2], 1, C.gold, 0.3, 0.95); line(ctx, tq[2], tq[1], 1, C.gold, 0, 0.95);
      const wq = faceQuad(tb, 1, 0.3, 0.7, 2.5, 5.5); if (night) B.glow(ctx, wq, GLOWS[0], env); else B.fillQuadShaded(ctx, wq, C.glass, { face: 'se', material: 'glass', noAO: true }, env);
    }
    if (G.crown) {   // the gold crown: lamps along every rim at its own height, chasing with the frame at night
      const rims = [[[0.1, 0.1], [fw - 0.1, 0.1], G.farRim], [[0.1, 0.1], [0.1, fh - 0.1], G.endRim], [[fw - 0.1, 1.0], [fw - 0.1, fh - 0.1], G.nearRim], [[1.0, fh - 0.1], [fw - 1.0, fh - 0.1], G.nearRim]];
      for (let e = 0; e < rims.length; e++) {
        const a = rims[e][0], c = rims[e][1], hh = rims[e][2] + 1, n = Math.max(4, Math.round(Math.hypot(c[0] - a[0], c[1] - a[1]) * 3));
        for (let k = 0; k <= n; k++) { const p = fT(g, a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n, hh), on = !night || ((k + frame) % 3) !== 0; B.orb(ctx, p[0], p[1], 0.9, 0.9, C.gold, on ? 0.55 : 0, { noRim: true }); if (night && on) B.orb(ctx, p[0], p[1] - 0.8, 0.5, 0.5, C.white, 0.5, { noRim: true }); }
      }
    }
    for (const m of G.masts) if (m[1] >= 1) mast(ctx, g, m[0], m[1], m[2], m[3], night, tier === 3, env);   // the near masts in front of the low stands
    if (tier >= 2) {   // CAULDRON on the near wall: a purple panel with eight gold marks (no text)
      const z = G.nearRim / 2, pq = quadT(g, [[fw / 2 - 0.55, fh - 0.1, z - 4], [fw / 2 + 0.55, fh - 0.1, z - 4], [fw / 2 + 0.55, fh - 0.1, z + 4], [fw / 2 - 0.55, fh - 0.1, z + 4]]);
      B.fillQuadShaded(ctx, pq, C.purple, { face: 'sw', material: 'paint', noAO: true }, env);
      for (let i = 0; i < 8; i++) { const X = fw / 2 - 0.55 + 1.1 * (i + 0.5) / 8; line(ctx, fT(g, X, fh - 0.1, z - 2.4), fT(g, X, fh - 0.1, z + 2.4), 1.4, C.gold, night ? 0.6 : 0.2, 0.95); }
    }
    return b;
  }
  /** the quad: a plain lawn with two gravel paths crossing at a live oak, two benches */
  function quadBody(ctx, g, frame, env) {
    const b = flatBody(g), fw = g.fw, fh = g.fh;
    drawApron(ctx, g, APRON.lawnPlain, env, { lifted: g.lift > 0 });
    B.path(ctx, [fT(g, fw / 2, 0.08), fT(g, fw / 2, fh - 0.08)], 6, env, { material: 'gravel' });
    B.path(ctx, [fT(g, 0.08, fh / 2), fT(g, fw - 0.08, fh / 2)], 6, env, { material: 'gravel' });
    bench(ctx, g, fw * 32 * 0.3, fh * 32 * 0.75, C.purple, env); bench(ctx, g, fw * 32 * 0.75, fh * 32 * 0.3, C.gold, env);
    const c = fT(g, fw / 2, fh / 2, 0); B.tree(ctx, c[0], c[1] - 2, 'liveOak', { seed: g.seed, stage: 1 }, env);
    void frame;
    return b;
  }
  /** the parking lot: asphalt with bay stripes and a centre lane, cars in the bays (an empty one here and there), a light pole */
  function parkingBody(ctx, g, frame, env) {
    const b = flatBody(g), fw = g.fw, fh = g.fh, night = g.night, q = bodyQuad(g), lod0 = env.lod === 0;
    B.fillQuadShaded(ctx, q, C.asphalt, { face: 'top', material: 'stone', t: 0, noAO: true }, env); B.macroGrain(ctx, q, 0.3, env);
    ctx.save(); B.poly(ctx, q); ctx.clip();
    for (let s = 1; s < fw * 2; s++) { line(ctx, fT(g, s / 2, 0.15), fT(g, s / 2, fh * 0.42), 0.8, C.asphalt, 0.75, 0.85); line(ctx, fT(g, s / 2, fh * 0.58), fT(g, s / 2, fh - 0.15), 0.8, C.asphalt, 0.75, 0.85); }
    line(ctx, fT(g, 0.15, fh * 0.42), fT(g, fw - 0.15, fh * 0.42), 0.7, C.asphalt, 0.6, 0.7); line(ctx, fT(g, 0.15, fh * 0.58), fT(g, fw - 0.15, fh * 0.58), 0.7, C.asphalt, 0.6, 0.7);
    if (lod0) for (let i = 0; i < fw * fh * 3; i++) { const p = fp(g, hash(g.seed, 90 + i) % (fw * 32), hash(g.seed, 91 + i) % (fh * 32), 0); B.orb(ctx, p[0], p[1], 1.3, 0.7, C.asphalt, (i & 1) ? -0.35 : 0.3, { noRim: true }); }
    ctx.restore();
    line(ctx, q[3], q[2], 1.6, C.asphalt, -0.6, 0.8); line(ctx, q[2], q[1], 1.6, C.asphalt, -0.6, 0.8); line(ctx, q[0], q[1], 0.9, C.asphalt, 0.5, 0.6); line(ctx, q[3], q[0], 0.9, C.asphalt, 0.5, 0.6);
    const COLS = ['#C9CDD2', '#2B2B33', '#B03A3A', '#E8E8E8', '#3D6FA8', '#8A6A3A', C.purple, C.gold];
    for (let i = 0; i < fw * 2; i++) { if ((hash(g.seed, i) % 5) === 0) continue; const p = fT(g, (i + 0.5) / 2, (i & 1) ? fh * 0.28 : fh * 0.75, 0); car(ctx, p[0], p[1] + 1, COLS[hash(g.seed, i) % COLS.length], night, env); }
    lampPost(ctx, fT(g, fw - 0.2, fh * 0.5, 0), night, C.asphalt, env);
    void frame;
    return b;
  }
  /** the pond: a lawn bank, a mud rim, shallows and a deep teal centre, lily pads and algae, reed clumps at two corners, a plank pier */
  function pondBody(ctx, g, frame, env) {
    const b = flatBody(g), fw = g.fw, fh = g.fh, night = g.night, lod0 = env.lod === 0, m = 0.12, m2 = 0.4, c = fT(g, fw / 2, fh / 2, 0);
    drawApron(ctx, g, APRON.lawnPlain, env, { lifted: g.lift > 0 });
    const outer = quadT(g, [[m, m], [fw - m, m], [fw - m, fh - m], [m, fh - m]]), rim = quadT(g, [[m - 0.06, m - 0.06], [fw - m + 0.06, m - 0.06], [fw - m + 0.06, fh - m + 0.06], [m - 0.06, fh - m + 0.06]]);
    B.fillQuadShaded(ctx, rim, C.mud, { face: 'top', material: 'stone', t: -0.1, noAO: true }, env);
    B.fillQuadShaded(ctx, outer, C.shallows, { face: 'top', material: 'paint', t: 0.1, noAO: true }, env);
    for (let e = 0; e < 4; e++) B.edgeFade(ctx, outer, outer[e], outer[(e + 1) % 4], 4, C.sandYard, 0.3, 0.45);
    B.puddle(ctx, c[0], c[1], (fw - 2 * m2) * 32 * 0.62, (fh - 2 * m2) * 16 * 0.62, env, { t: -0.35, spec: 0.3, rim: 0.2 });
    ctx.save(); B.poly(ctx, outer); ctx.clip();
    if (lod0) for (let i = 0; i < 4; i++) { const p = fp(g, (m2 + 0.2) * 32 + hash(g.seed, 70 + i) % ((fw - 2 * m2 - 0.4) * 32), (m2 + 0.2) * 32 + hash(g.seed, 80 + i) % ((fh - 2 * m2 - 0.4) * 32), 0); B.orb(ctx, p[0], p[1], 4, 1.6, C.reed, -0.3, { noRim: true }); }   // algae
    for (let i = 0; i < (lod0 ? 7 : 4); i++) { const p = fp(g, (m2 + 0.1) * 32 + hash(g.seed, 20 + i) % ((fw - 2 * m2 - 0.2) * 32), (m2 + 0.1) * 32 + hash(g.seed, 30 + i) % ((fh - 2 * m2 - 0.2) * 32), 0); B.orb(ctx, p[0], p[1], 1.7, 0.9, C.green, 0.15, { noRim: true }); B.orb(ctx, p[0] + 0.9, p[1] - 0.3, 0.5, 0.4, C.water, 0, { noRim: true }); }   // lily pads
    for (let i = 0; i < (lod0 ? 8 : 4); i++) { const p = fp(g, hash(g.seed + frame, 40 + i) % (fw * 32), hash(g.seed + frame, 50 + i) % (fh * 32), 0); line(ctx, [p[0] - 2, p[1]], [p[0] + 2, p[1]], 0.6, night ? '#C9D8FF' : C.spec, 0, 0.5); }   // glints
    ctx.restore();
    line(ctx, outer[3], outer[2], 0.9, C.water, -0.5, 0.7); line(ctx, outer[2], outer[1], 0.9, C.water, -0.5, 0.7);
    for (const r of [[0.5, fh - 0.4, 3], [fw - 0.4, 0.5, 9]]) { const p = fT(g, r[0], r[1], 0); for (let k = 0; k < 6; k++) { const o = hash(g.seed, r[2] + k) % 7 - 3; B.blade(ctx, p[0] + o * 1.6, p[1] + (k & 1), 5 + hash(g.seed, r[2] + 10 + k) % 5, (k & 1 ? 1 : -1) * (1 + (frame & 1) * 0.6), C.reed, 0.1, 1.3); } }   // reed clumps
    { const p = fT(g, fw * 0.5, fh - 0.2, 0); for (const dx of [-2.5, 2.5]) B.column(ctx, p[0] + dx, p[1] + 1, 3.5, 0.6, C.bark, env); B.fillQuadShaded(ctx, [[p[0] - 4, p[1] - 2], [p[0] + 4, p[1] - 2], [p[0] + 4, p[1] - 4.2], [p[0] - 4, p[1] - 4.2]], C.boardwalk, { face: 'top', material: 'wood', t: 0.1, noAO: true }, env); }   // the pier
    return b;
  }
  /** the bat house: a bark pole with a cross-arm and six gourds hanging from it on the lawn */
  function batpoleBody(ctx, g, frame, env) {
    const b = flatBody(g); drawApron(ctx, g, APRON.lawnPlain, env, { lifted: g.lift > 0 });
    const c = fp(g, g.fw * 16, g.fh * 16, 0), x = c[0], yb = c[1], GX = [0, 4, 8, 1, 6, 3], GY = [2, 1, 3, 7, 6, 10];
    B.shadow(ctx, { x: x + 2, y: yb + 0.5, rx: 4, ry: 1.6, a: 0.3 }, env);
    B.column(ctx, x, yb, 36, 1.1, C.bark, env);
    line(ctx, [x - 6, yb - 35], [x + 6, yb - 35], 1, C.bark, 0.1, 1);
    for (let i = 0; i < 6; i++) { const gx = x - 5 + GX[i] + 1.5, gy = yb - 34 + GY[i] + 2.5; line(ctx, [gx, gy - 2.4], [gx + (gx < x ? 0.6 : -0.6), yb - 35], 0.5, C.bark, -0.3, 0.9); B.orb(ctx, gx, gy, 1.7, 2, C.offWhite, 0.2, { spec: 0.35 }); B.orb(ctx, gx + 0.3, gy + 0.6, 0.5, 0.5, C.black, 0, { noRim: true }); }
    void frame;
    return b;
  }
  /** the rookery: a backwater round a mud island with reeds, a cypress (scaled to the canvas) with four nests, three spoonbills */
  function rookeryBody(ctx, g, frame, env) {
    const b = flatBody(g), c = fp(g, g.fw * 16, g.fh * 16, 0), x = c[0], y = c[1], lod0 = env.lod === 0, rr = B.rng(g.seed + 3);
    drawApron(ctx, g, APRON.lawnPlain, env, { lifted: g.lift > 0 });
    B.puddle(ctx, x, y, 30, 15, env, { t: -0.1, spec: 0.25, rim: 0.2 });
    B.orb(ctx, x - 2, y - 1, 21, 10, C.mud, -0.05, { noRim: true, spec: 0.05 });
    B.orb(ctx, x - 4, y - 3, 14, 6, C.lawn, -0.15, { noRim: true });
    for (let i = 0; i < (lod0 ? 14 : 7); i++) { const a = rr() * Math.PI * 2, d = 0.8 + rr() * 0.25; B.blade(ctx, x + Math.cos(a) * 22 * d, y + Math.sin(a) * 11 * d, 4 + rr() * 4, (rr() - 0.5) * 2.5, C.reed, 0.1, 1.2); }
    ctx.save(); ctx.translate(x, y - 2); ctx.scale(0.7, 0.7); B.tree(ctx, 0, 0, 'cypress', { seed: g.seed, inWater: true, stage: 2 }, env); ctx.restore();
    const NX = [-9, -3, 4, 9], NY = [-19, -27, -22, -30];
    for (let i = 0; i < 4; i++) { const nx = x + NX[i], ny = y - 2 + NY[i]; B.orb(ctx, nx, ny, 2.6, 1.5, C.bark, 0.2, { noRim: true }); B.orb(ctx, nx, ny - 0.5, 1.6, 0.9, C.bark, -0.45, { noRim: true }); B.orb(ctx, nx + 0.3, ny - 0.6, 0.55, 0.55, C.offWhite, 0.3, { noRim: true }); }
    for (let i = 0; i < 3; i++) { const sx = x - 10 + i * 10, sy = y - 4 + (i & 1) * 3; line(ctx, [sx, sy], [sx, sy - 4], 0.5, C.iron, 0, 0.9); B.orb(ctx, sx, sy - 5.2, 2.2, 1.4, C.spoonbill, 0.2, { spec: 0.3 }); line(ctx, [sx + 1.4, sy - 6], [sx + 2.6, sy - 8.6], 0.7, C.spoonbill, 0.1, 0.95); B.orb(ctx, sx + 2.8, sy - 9, 0.8, 0.8, C.white, 0.2, { noRim: true }); line(ctx, [sx + 3.2, sy - 8.8], [sx + 5.2, sy - 8], 0.6, C.iron, -0.2, 0.95); }
    void frame;
    return b;
  }
  /** the practice field: turf stripes, the boundary at render.fieldQuad's rect (0.6 / 0.3 in), the midfield line, goalposts, benches; tier I (Bayou Field) adds the bleachers at (fw / 2, 0.45) where render seats its crowd, the announcer's booth and the gold banner */
  function fieldBody(ctx, g, frame, env) {
    const b = flatBody(g), fw = g.fw, fh = g.fh, night = g.night, lod0 = env.lod === 0;
    for (let s = 0; s < fw * 2; s++) B.fillQuadShaded(ctx, quadT(g, [[s / 2, 0], [(s + 1) / 2, 0], [(s + 1) / 2, fh], [s / 2, fh]]), C.turf, { face: 'top', material: 'wood', t: (s & 1) ? -0.16 : 0.04, noAO: true }, env);
    const q = bodyQuad(g); B.macroGrain(ctx, q, 0.25, env);
    line(ctx, q[3], q[2], 1.4, C.turf, -0.6, 0.8); line(ctx, q[2], q[1], 1.4, C.turf, -0.6, 0.8);
    const F = { x0: 0.6, y0: 0.3, x1: fw - 0.6, y1: fh - 0.3 };
    const wl = (a, c, w, t, al) => line(ctx, fT(g, a[0], a[1], 0.2), fT(g, c[0], c[1], 0.2), w, C.white, t, al);
    wl([F.x0, F.y0], [F.x1, F.y0], 0.9, 0, 0.9); wl([F.x0, F.y1], [F.x1, F.y1], 0.9, 0, 0.9); wl([F.x0, F.y0], [F.x0, F.y1], 0.9, 0, 0.9); wl([F.x1, F.y0], [F.x1, F.y1], 0.9, 0, 0.9);
    wl([fw / 2, F.y0], [fw / 2, F.y1], 0.8, -0.1, 0.8);
    if (lod0) for (let k = 1; k < 10; k++) { if (k === 5) continue; const x = F.x0 + (F.x1 - F.x0) * k / 10; wl([x, F.y0 + 0.05], [x, F.y1 - 0.05], 0.6, -0.1, 0.45); }
    goalpost(ctx, fT(g, F.x0, fh / 2, 0), env); goalpost(ctx, fT(g, F.x1, fh / 2, 0), env);
    bench(ctx, g, fw * 32 * 0.4, fh * 32 * 0.55, C.purple, env); bench(ctx, g, fw * 32 * 0.6, fh * 32 * 0.45, C.purple, env);
    if ((g.tier | 0) >= 1) {
      stand(ctx, g, { x0: fw / 2 - 0.75, x1: fw / 2 + 0.75, y0: 0.2, y1: 0.7 }, 'y1', 0, 8, 4, night, env);
      const bt = miniBox(ctx, g, fw * 16, 0.26 * 32, 5, 2.5, 5, C.black, 'paint', env, 8);
      const wq = faceQuad(bt, 0, 0.15, 0.85, 9.5, 12); if (night) B.glow(ctx, wq, GLOWS[0], env); else B.fillQuadShaded(ctx, wq, C.glass, { face: 'sw', material: 'glass', noAO: true }, env);
      const tq = topQuad(bt, 13); B.fillQuadShaded(ctx, [tq[3], tq[2], [tq[2][0], tq[2][1] - 3.5], [tq[3][0], tq[3][1] - 3.5]], C.gold, { face: 'sw', material: 'cloth', noAO: true }, env);   // the banner
      if (lod0) for (let k = 1; k < 6; k++) { const p = lerp(tq[3], tq[2], k / 6); B.orb(ctx, p[0], p[1] - 1.8, 0.6, 0.6, C.purple, 0, { noRim: true }); }
    }
    void frame;
    return b;
  }
  /**
   * The Tiger Habitat (sprites.HABITAT): local X = depth (0 = the back rock … 3 = the front edge), Y along the front; under FRONT_L
   * the layout is transposed (local X → world Y) in `pt`, as the pen does. layer 0 = the whole exhibit; 1 = only what stands in
   * front of Roux (`habfront`: the near side wall + gate, the viewing wall + railing + glass, the piers); 2 = construction stage
   * `site` (0 survey, 1 footings + the lined pit, 2 walls up in scaffolding). Flood / damage / boards are dressed here (OWN_STATES).
   */
  function habitatBody(ctx, g, frame, env, layer, site) {
    const H = M.HABITAT, T = !!g.frontLeft, night = g.night, v = g.variant | 0, flood = !!(v & FLOODED_BIT), dmg = !!(v & SPR.DAMAGED), board = !!(v & SPR.BOARDED);
    const FZ = H.FLOOR_Z, WZ = H.WALL_Z, WX = H.WALL_X, G0 = H.GLASS[0], G1 = H.GLASS[1], RX0 = H.FX0;
    const front = layer === 1; site = layer === 2 ? site : -1; const built = site < 0, walls = site < 0 || site === 2, lod0 = env.lod === 0, seed = g.seed | 0;
    const fx = T ? 'sw' : 'se', fy = T ? 'se' : 'sw';   // the +X face is the lit one under FRONT_L (local X runs along world Y there)
    const pt = (lx, ly, z) => (T ? fp(g, ly * 32, lx * 32, z || 0) : fp(g, lx * 32, ly * 32, z || 0));
    const Q = (pts) => pts.map((p) => pt(p[0], p[1], p[2] || 0));
    const faceX = (c, a0, a1, za, zb) => Q([[c, a0, za], [c, a1, za], [c, a1, zb], [c, a0, zb]]);
    const faceY = (c, a0, a1, za, zb) => Q([[a0, c, za], [a1, c, za], [a1, c, zb], [a0, c, zb]]);
    const rectZ = (x0, y0, x1, y1, z) => Q([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]);
    const seg = (a, c, w, color, t, al) => line(ctx, pt(a[0], a[1], a[2] || 0), pt(c[0], c[1], c[2] || 0), w, color, t, al);
    const ell = (lx, ly, z, rx, ry, color, t, al) => { const p = pt(lx, ly, z); ctx.fillStyle = tone(color, t, al == null ? 1 : al); ctx.beginPath(); ctx.ellipse(p[0], p[1], rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
    const arch = (lx, y0, y1, z, ry, color, t) => { const e0 = pt(lx, y0, z), e1 = pt(lx, y1, z); ctx.fillStyle = tone(color, t); ctx.beginPath(); ctx.ellipse((e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2, Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) / 2, ry, Math.atan2(e1[1] - e0[1], e1[0] - e0[0]), Math.PI, 0); ctx.fill(); };
    const lbox = (x0, y0, x1, y1, z0, z1, color, mat) => { B.fillQuadShaded(ctx, faceX(x1, y0, y1, z0, z1), color, { face: fx, material: mat || 'stone', noAO: true }, env); B.fillQuadShaded(ctx, faceY(y1, x0, x1, z0, z1), color, { face: fy, material: mat || 'stone', noAO: true }, env); B.fillQuadShaded(ctx, rectZ(x0, y0, x1, y1, z1), color, { face: 'top', material: mat || 'stone', t: 0.1, noAO: true }, env); };
    const b = flatBody(g);
    // ---- 1. the plaza: brick paving (a sand bed on site 1), limestone curbs, the viewing wall's cast shadow, the lamps' pools at night
    if (!front && site !== 0) {
      const pz = rectZ(WX - 0.14, 0, 3, 3, 0), sand = site === 1;
      B.fillQuadShaded(ctx, pz, sand ? C.sandYard : C.brick, { face: 'top', material: 'stone', t: 0.05, noAO: true }, env); B.macroGrain(ctx, pz, 0.3, env);
      if (lod0 && !sand) { ctx.save(); B.poly(ctx, pz); ctx.clip(); for (let y = 0.19; y < 3; y += 0.19) seg([WX - 0.14, y], [3, y], 0.7, C.brick, -0.45, 0.4); for (let x = WX; x < 3; x += 0.19) seg([x, 0], [x, 3], 0.7, C.brick, -0.45, 0.25); ctx.restore(); }
      if (!sand) for (const e of [[[2.9, 0], [3, 0], [3, 3], [2.9, 3]], [[WX - 0.14, 0], [3, 0], [3, 0.07], [WX - 0.14, 0.07]], [[WX - 0.14, 2.93], [3, 2.93], [3, 3], [WX - 0.14, 3]]]) B.fillQuadShaded(ctx, Q(e), C.limestone, { face: 'top', material: 'stone', t: 0.15, noAO: true }, env);
      if (walls) B.edgeFade(ctx, pz, pz[0], pz[3], 11, C.cool, -0.2, 0.5);
      if (night && built) { ctx.save(); B.poly(ctx, pz); ctx.clip(); for (const ly of [0.2, 2.8]) { const p = pt(2.9, ly, 0); B.softEllipse(ctx, p[0], p[1], 10, 4.5, C.glow, 0.35, 0.2); } ctx.restore(); }
    }
    // ---- 2. the enclosure floor 3 px below the plaza: grass, the worn tracks, the nap spot, the pool (three metaballs: sand, shallows, deep); the dug pit on site 1 / 2
    if (!front && site !== 0) {
      const fl = rectZ(RX0, H.FY0, H.FX1 + 0.16, H.FY1 + 0.14, FZ);
      if (site >= 1) {
        B.fillQuadShaded(ctx, fl, C.siteDirt, { face: 'top', material: 'stone', t: -0.1, noAO: true }, env); B.macroGrain(ctx, fl, 0.4, env);
        for (const c of H.POOL) ell(c[0], c[1], FZ, c[2] * RX, c[2] * RY, site === 1 ? '#2E4C66' : C.water, site === 1 ? 0 : 0.15, 1);
      } else {
        B.fillQuadShaded(ctx, fl, '#6E8F3C', { face: 'top', material: 'wood', t: 0, noAO: true }, env); B.macroGrain(ctx, fl, 0.45, env);
        ctx.save(); B.poly(ctx, fl); ctx.clip();
        if (lod0) for (let i = 0; i < 22; i++) { const p = pt(RX0 + (hash(seed, 100 + i) % 100) / 100 * (H.FX1 - RX0), H.FY0 + (hash(seed, 130 + i) % 100) / 100 * (H.FY1 - H.FY0), FZ); B.orb(ctx, p[0], p[1], 1.6, 0.9, '#6E8F3C', 0.3, { noRim: true }); }
        B.fillQuadShaded(ctx, rectZ(1.26, 0.5, 1.58, 2.6, FZ), C.siteDirt, { face: 'top', material: 'stone', t: 0.1, noAO: true }, env);
        B.fillQuadShaded(ctx, rectZ(RX0, 2.0, 0.6, 2.78, FZ), C.siteDirt, { face: 'top', material: 'stone', t: 0.05, noAO: true }, env);
        { const p = pt(H.NAP[0], H.NAP[1], FZ); B.softEllipse(ctx, p[0], p[1], 10, 5, '#7FA347', 0.6, 0.3); }
        B.edgeFade(ctx, fl, fl[0], fl[3], 10, C.cool, -0.2, 0.45); B.edgeFade(ctx, fl, fl[0], fl[1], 5, C.cool, -0.2, 0.35);
        for (const c of H.POOL) ell(c[0], c[1], FZ, c[2] * RX * 1.16, c[2] * RY * 1.16, C.sandYard, 0.15);
        for (const c of H.POOL) ell(c[0], c[1], FZ, c[2] * RX, c[2] * RY, C.shallows, 0.1);
        for (const c of H.POOL) ell(c[0], c[1], FZ, c[2] * RX * 0.68, c[2] * RY * 0.68, C.water, 0.3);
        ell(0.6, 1.1, FZ, 9, 4, '#2E5A2A', -0.2, 0.35);
        for (let i = 0; i < (lod0 ? 9 : 4); i++) { const c = H.POOL[i % 3], a = (hash(seed + frame, 40 + i) % 100) / 100 * Math.PI * 2, d = (hash(seed, 60 + i) % 70) / 100, p = pt(c[0] + Math.cos(a) * c[2] * d, c[1] + Math.sin(a) * c[2] * d, FZ); line(ctx, [p[0] - 1.6, p[1]], [p[0] + 1.6, p[1]], 0.6, night ? '#C9D8FF' : C.spec, 0, 0.55); }
        ctx.restore();
      }
    }
    // ---- 3. the back rock (crest, strata, moss, the waterfall, the den with the ROUX sign) and the far side wall
    if (!front && walls) {
      const crest = []; for (let k = 0; k <= 14; k++) { const s = k / 14; crest.push([s * 3, 16 + (hash(seed + 5, k) % 4) + ((s > 0.62 && s < 0.9) ? 2 : 0)]); }
      const rock = Q([[RX0, 0, FZ], [RX0, 3, FZ]].concat(crest.slice().reverse().map((c) => [RX0, c[0], c[1]])));
      B.plane(ctx, rock, C.rock, T ? -0.1 : -0.42, { vert: true, amp: 0.22, rim: 0.2 });
      ctx.save(); B.poly(ctx, rock); ctx.clip();
      if (lod0) for (let z = FZ + 5; z < 18; z += 5) seg([RX0, 0, z], [RX0, 3, z + ((z / 5) & 1)], 0.7, C.rock, -0.55, 0.45);
      for (let i = 0; i < (lod0 ? 10 : 5); i++) { const p = pt(RX0, (hash(seed + 9, i) % 100) / 100 * 3, 9 + (hash(seed + 9, 20 + i) % 9)); B.orb(ctx, p[0], p[1], 2.2, 1.3, '#7A8B4E', 0.1, { noRim: true }); }
      ctx.restore();
      B.edgeFade(ctx, rock, rock[0], rock[1], 4, C.cool, -0.3, 0.35);
      for (let k = 0; k < crest.length; k += 2) { const p = pt(RX0, crest[k][0], crest[k][1]); B.blade(ctx, p[0], p[1] + 0.5, 2.5 + (k & 3), (k & 1) ? 1 : -1, '#7FA347', 0.1, 1); }
      B.fillQuadShaded(ctx, faceY(H.FY0, RX0, H.FX1 + 0.1, FZ, WZ), C.habStone, { face: fy, material: 'stone', noAO: true }, env);
      if (lod0) for (let i = 0; i < 6; i++) { const p = pt(RX0 + (hash(seed + 14, i) % 100) / 100 * (H.FX1 - RX0), H.FY0, FZ + 1 + (hash(seed + 14, 10 + i) % 4)); B.orb(ctx, p[0], p[1], 1.8, 1, '#7A8B4E', 0, { noRim: true }); }
      B.fillQuadShaded(ctx, rectZ(RX0, 0.06, WX, H.FY0, WZ), C.habStone, { face: 'top', material: 'stone', t: 0.45, noAO: true }, env); seg([RX0, 0.06, WZ], [WX, 0.06, WZ], 0.9, C.limestone, 0.5, 0.9);
      if (built) {
        const wy0 = 0.86, wy1 = 1.14, spoutZ = 13;
        B.plane(ctx, faceX(RX0 + 0.01, wy0, wy1, FZ, spoutZ), C.shallows, 0.45, { vert: true, amp: 0.3, rim: 0 });
        for (let i = 0; i < 4; i++) { const ly = wy0 + 0.05 + (wy1 - wy0 - 0.1) * i / 3; seg([RX0 + 0.015, ly, spoutZ - 1], [RX0 + 0.015, ly + 0.02, FZ + 1], 0.8, C.white, 0, 0.55); }
        { const sp = pt(RX0 + 0.01, (wy0 + wy1) / 2, spoutZ); B.orb(ctx, sp[0], sp[1] - 0.6, 5, 1.6, C.rock, 0.2, { noRim: true }); }
        { const fo = pt(RX0 + 0.18, (wy0 + wy1) / 2, FZ); for (let i = 0; i < (lod0 ? 10 : 5); i++) B.orb(ctx, fo[0] - 6 + (hash(seed + 33, i) % 13), fo[1] + (hash(seed + 34, i) % 3) - 1, 1.1, 0.7, C.white, 0.3, { noRim: true }); }
      }
      const dy0 = 2.17, dy1 = 2.63;
      B.fillQuadShaded(ctx, faceX(RX0 + 0.01, dy0 - 0.07, dy1 + 0.07, FZ, 12), C.limestone, { face: fx, material: 'stone', noAO: true }, env);
      arch(RX0 + 0.01, dy0 - 0.07, dy1 + 0.07, 12, 3.2, C.limestone, T ? 0.2 : -0.3);
      const den = faceX(RX0 + 0.012, dy0, dy1, FZ, 9); flat(ctx, den, '#1B1424', 0, 1); arch(RX0 + 0.012, dy0, dy1, 9, 2.6, '#1B1424', 0);
      if (night) B.edgeFade(ctx, den, den[0], den[1], 7, C.den, 0.1, 0.45); else B.edgeFade(ctx, den, den[0], den[1], 5, '#3A2A30', 0, 0.4);
      if (built) { const sg = faceX(RX0 + 0.015, 2.08, 2.72, 17, 25); B.fillQuadShaded(ctx, sg, C.purple, { face: fx, material: 'paint', noAO: true }, env); B.stroke(ctx, sg, 0.8, C.gold, 0.2, 0.95, { close: true }); for (let i = 0; i < 4; i++) { const ly = 2.14 + 0.52 * (i + 0.5) / 4; seg([RX0 + 0.02, ly, 18.6], [RX0 + 0.02, ly, 23.4], 1.4, C.gold, night ? 0.6 : 0.2, 0.95); } }
    }
    // ---- 4. the shade oak, then the floor decor back to front: boulders (mossy), shrubs, palmettos, the climbing log, azaleas
    if (!front && built) {
      const tp = pt(H.TREE[0], H.TREE[1], FZ); B.tree(ctx, tp[0], tp[1], 'liveOak', { seed: seed, stage: 0 }, env);
      const boulder = (lx, ly, rx, ry, sd, mossy) => { const c = pt(lx, ly, FZ); B.shadow(ctx, { x: c[0] + 1.5, y: c[1] + 0.3, rx: rx + 1, ry: Math.max(1, ry * 0.5), a: 0.3 }, env); B.orb(ctx, c[0], c[1] - ry * 0.7, rx, ry, C.rock, 0.05 + (hash(seed, sd) % 3) * 0.08, { spec: 0.2 }); if (mossy) B.orb(ctx, c[0] - rx * 0.3, c[1] - ry * 1.2, rx * 0.5, ry * 0.4, '#7A8B4E', 0.1, { noRim: true }); };
      const shrub = (lx, ly) => { const c = pt(lx, ly, FZ); B.shadow(ctx, { x: c[0] + 1, y: c[1] + 0.4, rx: 4.5, ry: 1.8, a: 0.25 }, env); B.orb(ctx, c[0], c[1] - 2.4, 4.2, 3, C.hedge, 0.05, { spec: 0.2 }); B.orb(ctx, c[0] - 1.6, c[1] - 3.8, 2.4, 1.8, C.hedge, 0.25, { noRim: true }); };
      const palmetto = (lx, ly, sd) => { const c = pt(lx, ly, FZ); B.shadow(ctx, { x: c[0] + 1, y: c[1] + 0.3, rx: 5, ry: 1.6, a: 0.25 }, env); for (let i = 0; i < 7; i++) { const a = -0.9 + 1.8 * i / 6; B.blade(ctx, c[0], c[1] - 1, 7 + (hash(seed + sd, i) % 3), Math.sin(a) * 7, C.palmetto, 0.1 + (i & 1) * 0.15, 1.6); } };
      const azalea = (lx, ly, sd) => { const c = pt(lx, ly, FZ); B.shadow(ctx, { x: c[0] + 1, y: c[1] + 0.3, rx: 4.5, ry: 1.6, a: 0.25 }, env); B.orb(ctx, c[0], c[1] - 2.6, 4.5, 3.2, '#3F5E3A', 0.1, { spec: 0.15 }); for (let i = 0; i < (lod0 ? 7 : 4); i++) B.orb(ctx, c[0] - 3 + (hash(seed + sd, i) % 7), c[1] - 4.8 + (hash(seed + sd, 10 + i) % 4), 0.8, 0.8, C.azalea, 0.3, { noRim: true }); };
      boulder(0.3, 0.8, 5, 3, 51, true); shrub(0.34, 0.62); boulder(1.02, 0.95, 7, 4, 52, true); boulder(0.3, 1.52, 6, 4, 53, true); boulder(0.62, 2.02, 5, 3, 54, false);
      palmetto(0.34, 1.78, 2);
      { const a = pt(1.46, 1.58, FZ), c = pt(1.46, 2.42, FZ + 4); B.stroke(ctx, [a, c], 4.5, C.bark, -0.1, 1, { cap: 'round' }); B.stroke(ctx, [[a[0], a[1] - 1.2], [c[0], c[1] - 1.2]], 1.5, C.bark, 0.45, 0.9, { cap: 'round' }); B.orb(ctx, c[0], c[1], 1.6, 2.2, '#B58B5A', 0.1, { noRim: true }); boulder(1.46, 2.5, 4, 3, 55, false); }
      boulder(1.18, 2.32, 3, 2, 56, false);
      azalea(0.52, 2.62, 3); azalea(1.55, 0.5, 4); palmetto(1.74, 0.36, 5); shrub(1.42, 0.2);
    }
    // ---- 5. floodwater over the floor (the old pool a deeper swirl in it), leaves adrift
    if (flood && !front && built) {
      const fq = rectZ(RX0, H.FY0, H.FX1, H.FY1, FZ + 5); flat(ctx, fq, C.flood, 0, 0.82); B.macroGrain(ctx, fq, 0.35, env);
      ctx.save(); B.poly(ctx, fq); ctx.clip();
      for (const c of H.POOL) ell(c[0], c[1], FZ + 5, c[2] * RX * 0.8, c[2] * RY * 0.8, C.water, 0.1, 0.5);
      for (let i = 0; i < 10; i++) { const p = pt(0.3 + (hash(seed + 66, i) % 150) / 100, 0.3 + (hash(seed + 67, i) % 250) / 100, FZ + 5); line(ctx, [p[0] - 2, p[1]], [p[0] + 2, p[1]], 0.6, C.flood, 0.5, 0.6); }
      for (let i = 0; i < 8; i++) { const p = pt(0.5 + (hash(seed + 68, i) % 120) / 100, 0.5 + (hash(seed + 69, i) % 220) / 100, FZ + 5); B.orb(ctx, p[0], p[1], 1.2, 0.6, (i & 1) ? '#3F5E3A' : C.bark, 0.2, { noRim: true }); }
      ctx.restore();
    }
    // ---- 6. the building site (layer 2): survey lines and stakes → footings, the pit's walls, rebar → the viewing wall in scaffolding, the work deck
    if (site >= 0) {
      if (site === 0) {
        for (const e of [[[RX0, H.FY0], [H.FX1, H.FY0]], [[H.FX1, H.FY0], [H.FX1, H.FY1]], [[H.FX1, H.FY1], [RX0, H.FY1]], [[RX0, H.FY1], [RX0, H.FY0]], [[2.0, 0.1], [2.0, 2.9]], [[2.9, 0.1], [2.9, 2.9]]]) seg(e[0], e[1], 0.6, C.white, 0, 0.8);
        for (const s of [[RX0, H.FY0], [H.FX1, H.FY0], [H.FX1, H.FY1], [RX0, H.FY1], [2.0, 0.1], [2.0, 2.9], [2.9, 0.1], [2.9, 2.9], [1.0, 1.5]]) { const p = pt(s[0], s[1], 0); B.column(ctx, p[0], p[1], 5, 0.5, C.wood, env); B.orb(ctx, p[0], p[1] - 5.4, 0.7, 0.7, C.tigerOrange, 0.3, { noRim: true }); }
        { const p = pt(2.5, 0.5, 0); for (let i = 0; i < 4; i++) B.orb(ctx, p[0] - 6 + i * 4, p[1] - 1.5 - (i & 1), 3, 1.8, C.rock, (i & 1) ? 0.1 : -0.15, { spec: 0.15 }); }
      } else if (site === 1) {
        for (const e of [[[RX0, H.FY0], [H.FX1 + 0.14, H.FY0]], [[H.FX1, H.FY0], [H.FX1, H.FY1]], [[RX0, H.FY1], [H.FX1 + 0.14, H.FY1]]]) seg([e[0][0], e[0][1], FZ], [e[1][0], e[1][1], FZ], 1.2, C.concrete, 0.3, 0.9);
        B.fillQuadShaded(ctx, faceX(RX0, 0, 3.0, FZ, FZ + 4), C.siteDirt, { face: fx, material: 'stone', noAO: true }, env); B.fillQuadShaded(ctx, faceY(H.FY0, RX0, H.FX1, FZ, FZ + 4), C.siteDirt, { face: fy, material: 'stone', noAO: true }, env);
        for (let i = 0; i < 9; i++) { const p = pt(1.94 + (i & 1) * 0.1, 0.2 + i * 0.32, FZ + 1); B.column(ctx, p[0], p[1], 5, 0.4, C.steel, env); B.orb(ctx, p[0], p[1] - 5.3, 0.6, 0.6, C.tigerOrange, 0.3, { noRim: true }); }
        miniBox(ctx, g, (T ? 2.4 : 2.5) * 32, (T ? 2.5 : 2.4) * 32, 5, 2.5, 4, C.brick, 'stone', env, 0, { noAO: true });
      } else {
        for (const y of [0.1, 0.9, 1.7, 2.5]) { const p = pt(2.12, y, 0); B.column(ctx, p[0], p[1], 16, 0.6, C.steel, env); }
        for (const z of [6, 11]) seg([2.12, 0.1, z], [2.12, 2.5, z], 0.7, C.steel, 0.2, 0.9);
        for (const e of [[[2.12, 0.1, 0], [2.12, 0.9, 11]], [[2.12, 0.9, 0], [2.12, 1.7, 11]], [[2.12, 1.7, 0], [2.12, 2.5, 11]]]) seg(e[0], e[1], 0.5, C.steel, -0.3, 0.8);
        for (let i = 0; i < 4; i++) { const p = pt(2.12, 0.5 + i * 0.6, 11); line(ctx, [p[0] - 3, p[1]], [p[0] + 3, p[1]], 1.4, C.plywood, 0, 0.95); }
        miniBox(ctx, g, (T ? 1.5 : 2.7) * 32, (T ? 2.7 : 1.5) * 32, 6, 1.5, 3, C.wood, 'wood', env, 0, { noAO: true }); miniBox(ctx, g, (T ? 1.5 : 2.7) * 32, (T ? 2.7 : 1.5) * 32, 5, 1.5, 3, C.brick, 'stone', env, 3, { noAO: true });
      }
    }
    // ---- 7. what stands in front of Roux (both layers): the near side wall + keeper's gate, the viewing wall + railing + glass, the piers
    const rail = (axis, c, a0, a1, skip, salt) => {
      const n = Math.max(1, Math.round((a1 - a0) / 0.25)); let prev = null;
      for (let k = 0; k <= n; k++) {
        const a = a0 + (a1 - a0) * k / n; if (skip && skip(a)) { prev = null; continue; }
        const q = axis === 'Y' ? [c, a] : [a, c], gone = dmg && (hash(seed + 71, k + salt) % 5 === 0), p = pt(q[0], q[1], WZ);
        if (!gone) { B.column(ctx, p[0], p[1], 7, 0.5, C.purple, env); B.orb(ctx, p[0], p[1] - 7.4, 0.7, 0.7, (k & 1) ? C.gold : C.purple2, 0.4, { noRim: true }); if (night && (k & 3) === 0) B.orb(ctx, p[0], p[1] - 8.2, 0.8, 0.8, GLOWS[0], 0.6, { noRim: true }); }
        if (prev && !gone && !(dmg && hash(seed + 72, k + salt) % 6 === 0)) { seg([prev[0], prev[1], WZ + 6], [q[0], q[1], WZ + 6], 0.8, C.purple, 0.3, 0.95); seg([prev[0], prev[1], WZ + 3], [q[0], q[1], WZ + 3], 0.7, C.purple, -0.2, 0.9); }
        prev = gone ? null : q;
      }
    };
    if (walls) {
      B.fillQuadShaded(ctx, faceY(3.0, 0, WX, 0, WZ), C.habStone, { face: fy, material: 'stone', noAO: true }, env);
      B.fillQuadShaded(ctx, rectZ(0, 2.9, WX, 3.0, WZ), C.habStone, { face: 'top', material: 'stone', t: 0.45, noAO: true }, env); seg([0, 3.0, WZ], [WX, 3.0, WZ], 0.9, C.limestone, 0.5, 0.9);
    }
    if (built) {
      rail('X', 2.93, 0.06, 1.9, (a) => a > 0.86 && a < 1.5, 0);
      flat(ctx, faceY(3.0, 0.97, 1.4, 0, 10), '#1B1424', 0, 1);
      for (let i = 0; i <= 5; i++) seg([0.97 + 0.43 * i / 5, 3.0, 0], [0.97 + 0.43 * i / 5, 3.0, 10], 0.7, C.iron, T ? -0.1 : 0.1, 0.95);
      for (const z of [0.5, 5, 9.5]) seg([0.97, 3.0, z], [1.4, 3.0, z], 0.7, C.iron, 0.2, 0.95);
      { const lk = pt(1.19, 3.0, 4); B.orb(ctx, lk[0], lk[1], 0.7, 0.7, C.gold, 0.3, { noRim: true }); }
      lbox(0.91, 2.88, 0.99, 3.0, 0, 12, C.limestone); lbox(1.38, 2.88, 1.46, 3.0, 0, 12, C.limestone);
    }
    if (walls) {
      B.fillQuadShaded(ctx, faceX(WX, 0, 3.0, 0, WZ), C.habStone, { face: fx, material: 'stone', noAO: true }, env);
      B.fillQuadShaded(ctx, rectZ(1.98, 0, WX, 3.0, WZ), C.habStone, { face: 'top', material: 'stone', t: 0.45, noAO: true }, env); seg([WX, 0, WZ], [WX, 3.0, WZ], 0.9, C.limestone, 0.5, 0.9);
    }
    if (built) {
      rail('Y', 2.0, 0.22, 2.78, (a) => a > G0 - 0.12 && a < G1 + 0.12, 40);
      const gz0 = WZ + 1, gz1 = WZ + 12, panes = [[G0, 1.5], [1.5, G1]];
      for (let i = 0; i < 2; i++) {
        const pq = faceX(2.0, panes[i][0], panes[i][1], gz0, gz1);
        if (board) { B.fillQuadShaded(ctx, pq, C.plywood, { face: fx, material: 'wood', noAO: true }, env); for (const y of [panes[i][0] + 0.1, panes[i][1] - 0.1]) { const p = pt(2.0, y, WZ + 6); B.orb(ctx, p[0], p[1], 0.45, 0.45, C.iron, -0.5, { noRim: true }); } continue; }
        flat(ctx, pq, '#CFE8FF', 0.2, 0.22);
        for (const s of [0.25, 0.6]) line(ctx, lerp(pq[0], pq[1], s), lerp(pq[3], pq[2], Math.min(1, s + 0.25)), 1.2, C.white, 0, 0.45);
        if (night) for (let k = 0; k < 3; k++) { const p = pt(2.0, panes[i][0] + (panes[i][1] - panes[i][0]) * (k + 0.5) / 3, gz0 + 2); B.orb(ctx, p[0], p[1], 0.7, 0.7, GLOWS[0], 0.5, { noRim: true }); }
        if (dmg) for (const d of [[-0.3, 4], [0.25, 5], [0.35, -2], [-0.2, -4]]) seg([2.0, 1.2, WZ + 7], [2.0, 1.2 + d[0], WZ + 7 + d[1]], 0.6, C.white, 0, 0.7);
      }
      for (const y of [G0, 1.5, G1]) { const p = pt(2.0, y, WZ); B.column(ctx, p[0], p[1], 13, 0.6, C.iron, env); B.orb(ctx, p[0], p[1] - 13.3, 0.7, 0.7, C.gold, 0.3, { noRim: true }); }
      seg([2.0, G0, gz1], [2.0, G1, gz1], 0.9, C.iron, 0.3, 0.95);
    }
    if (flood && walls) {   // the pool has spilled: water pours over the wall's notch and runs down its face; a mud line at its foot
      B.plane(ctx, faceX(WX, 0.42, 0.84, 0, WZ + 1), C.shallows, 0.4, { vert: true, amp: 0.3, rim: 0 }); for (let i = 0; i < 4; i++) seg([WX + 0.005, 0.46 + 0.09 * i, WZ], [WX + 0.005, 0.47 + 0.09 * i, 0.5], 0.7, C.white, 0, 0.5);
      const foot = faceX(WX, 0, 3.0, 0, 3); B.edgeFade(ctx, foot, foot[0], foot[1], 3, C.stain, -0.3, 0.6);
    }
    if (walls) { lbox(1.94, 0, 2.14, 0.14, 0, 11, C.limestone); lbox(1.94, 2.86, 2.14, 3.0, 0, 11, C.limestone); }
    if (night && built) for (const ly of [0.1, 2.9]) { const p = pt(2.0, ly, 12); B.softEllipse(ctx, p[0], p[1], 4, 3, C.glow, 0.35, 0.2); B.orb(ctx, p[0], p[1], 1, 1, GLOWS[0], 0.6, { noRim: true }); }
    // ---- 8. plaza furniture (layer 0): the spill, two benches facing the glass, two lamps; a fallen limb and leaf litter when damaged
    if (!front && built) {
      if (flood) { const p = pt(2.0, 0.65, 0); B.softEllipse(ctx, p[0] + 6, p[1] + 2, 22, 9, C.flood, 0.75, 0.6); for (let i = 0; i < 5; i++) line(ctx, [p[0] - 2 + i * 4, p[1] + 1 + (i & 1) * 3], [p[0] + 1 + i * 4, p[1] + 1 + (i & 1) * 3], 0.6, C.flood, 0.5, 0.6); }
      const benchL = (y0, y1) => { for (const yy of [y0 + 0.03, y1 - 0.09]) lbox(2.42, yy, 2.58, yy + 0.06, 0, 3, C.iron, 'metal'); lbox(2.4, y0, 2.6, y1, 3, 5, C.wood, 'wood'); lbox(2.6, y0, 2.66, y1, 5, 10, C.wood, 'wood'); };
      benchL(0.12, 0.54); benchL(2.46, 2.88);
      for (const ly of [0.2, 2.8]) lampPost(ctx, pt(2.9, ly, 0), night, C.brick, env);
      if (dmg) { seg([2.2, 2.4, 0], [2.85, 1.95, 0], 2.2, C.bark, -0.1, 1); seg([2.5, 2.2, 1], [2.58, 2.0, 5], 1.2, C.bark, 0, 1); for (let i = 0; i < 9; i++) { const p = pt(2.2 + (hash(seed + 95, i) % 70) / 100, 1.7 + (hash(seed + 96, i) % 70) / 100, 0); B.orb(ctx, p[0], p[1], 1, 0.5, '#3F5E3A', (i & 1) ? 0.2 : -0.1, { noRim: true }); } }
    }
    if (dmg && !front && built) seg([1.0, 0.95, 0], [1.5, 0.9, 1], 1.6, C.bark, -0.2, 1);
    return b;
  }
  const BODIES = { box: standardBody, bunk: bunkBody, wings: wingsBody, substation: substationBody, tower: towerBody, generator: generatorBody,
    quad: quadBody, parking: parkingBody, pond: pondBody, rookery: rookeryBody, batpole: batpoleBody, field: fieldBody, stadium: stadiumBody, habitat: (ctx, g, frame, env) => habitatBody(ctx, g, frame, env, 0, -1) };

  // ---------------------------------------------------------------------------
  // Construction (3 frames), ruin, damage, boards, flood
  // ---------------------------------------------------------------------------
  function pallets(ctx, g, env) {
    const p = marginPt(g, 0, 0.6, true); miniBox(ctx, g, g.fw * 32 - g.ipx * 0.5, g.fh * 32 * 0.4, 4, 2.5, 4, C.brick, 'stone', env, 0, { noAO: true }); line(ctx, [p[0] - 5, p[1] + 0.5], [p[0] + 5, p[1] + 0.5], 1, C.wood, -0.3, 0.9);
    const l = marginPt(g, 1, 0.6, true); B.fillQuadShaded(ctx, [[l[0] - 4.5, l[1]], [l[0] + 4.5, l[1]], [l[0] + 4.5, l[1] - 3], [l[0] - 4.5, l[1] - 3]], C.wood, { face: 'sw', material: 'wood', noAO: true }, env); line(ctx, [l[0] - 4.5, l[1] - 1.5], [l[0] + 4.5, l[1] - 1.5], 0.6, C.wood, -0.6, 0.7);
  }
  function crane(ctx, b, hgt, env) { const q = topCorners(b, 0); craneAt(ctx, q.N[0] + 4, q.N[1] + 6, hgt + 34, env); }
  /** a tower crane standing on (x, base) with a mast H px tall: cab, jib with pendants, counter-jib with ballast, the hook */
  function craneAt(ctx, x, base, H, env) {
    const top = base - H, hgt = H - 34;
    B.column(ctx, x, base, H, 1.4, C.crane, env);
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
  function tintDamaged(ctx, g) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = css(C.cool, 0.2); ctx.fillRect(0, 0, g.w, g.h); ctx.restore(); }
  function applyDamaged(ctx, g, b, env) {
    tintDamaged(ctx, g);
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
    g.env = env; g.variant = variant; void frame;
    return g;
  }
  /** compose one HD building (the whole sprite) on a context sized by brush.begin */
  function composeHD(ctx, g, variant, frame, env) {
    const scaffold = !!(variant & SPR.SCAFFOLD), pil = !!(variant & SPR.PILINGS), body = g.D.body, own = !!OWN_GROUND[body], stage = ((frame % 3) + 3) % 3;
    if (variant & SPR.RUIN) { g.apron = APRON.site; drawApron(ctx, g, APRON.site, env); ruinShape(ctx, g, env); return; }
    g.apron = scaffold ? APRON.site : apronOf(g);
    if (pil) drawWaterGround(ctx, g, env); else if (!own || scaffold) drawApron(ctx, g, g.apron, env);   // own-ground bodies paint their ground (over the graded site while building)
    const main = mainBox(g);
    if (!pil && !scaffold && !own && body !== 'wings' && (g.floors > 0 || body)) foundation(ctx, main, env);
    if (pil && !scaffold) stilts(ctx, main, true, env);
    let b = null;
    if (scaffold) b = body === 'stadium' ? stadiumSite(ctx, g, stage, env) : body === 'habitat' ? habitatBody(ctx, g, frame, env, 2, stage) : scaffoldStage(ctx, g, frame, env);
    else b = (BODIES[body] || standardBody)(ctx, g, frame, env);
    if (pil && !scaffold) stilts(ctx, main, false, env);
    if (!scaffold && !own) { try { drawMargins(ctx, g, b, variant, env); } catch (e) { BSU.error('sprites', 'hd margins:' + g.row.id, e); } }
    const ownStates = !!OWN_STATES[body] && !scaffold;
    if (variant & SPR.DAMAGED) { if (ownStates) tintDamaged(ctx, g); else applyDamaged(ctx, g, b, env); }
    if ((variant & SPR.BOARDED) && !ownStates) applyBoarded(ctx, b, env);
    if ((variant & FLOODED_BIT) && !ownStates) { try { applyFlooded(ctx, g, b, env); } catch (e) { BSU.error('sprites', 'hd flooded:' + g.row.id, e); } }
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
    if (!HD_ROWS[row.id]) {   // the vegetation rows (live_oak / cypress / azalea, veg entities in play — H3): the pen painter at master 1, pixel-doubled at master 2
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
  /** H2b: what the own-ground bodies add to their light companion (the window cells carry the rest) */
  const BODY_LIGHTS = {
    stadium(ctx, g, env) {   // the mast heads, the press box band, the board, the luxury boxes
      const tier = g.tier | 0; if (tier <= 0) return; const G = M.stadiumGeom(tier, g.fw, g.fh);
      for (const m of G.masts) { const p = fT(g, m[0], m[1], m[2] + m[3]); B.light(ctx, { x: p[0], y: p[1] + 2, r: tier === 3 ? 7 : 5, color: GLOWS[1], a: 0.85 }, env); }
      if (G.pressBox) { const pb = G.pressBox; B.light(ctx, { quad: quadT(g, [[pb.x0, pb.y1, pb.z + 3], [pb.x1, pb.y1, pb.z + 3], [pb.x1, pb.y1, pb.z + 9], [pb.x0, pb.y1, pb.z + 9]]), color: C.glow, a: 0.6, halo: 4 }, env); }
      if (G.board) { const bd = G.board, sb = fT(g, bd.X, bd.Y, bd.z), legH = bd.kind === 'jumbo' ? 16 : 12, top = sb[1] - legH - bd.h - (bd.kind === 'jumbo' ? 2 : 0); B.light(ctx, { quad: [[sb[0] - bd.w / 2, top + bd.h], [sb[0] + bd.w / 2, top + bd.h], [sb[0] + bd.w / 2, top], [sb[0] - bd.w / 2, top]], color: C.gold, a: 0.35, halo: 5 }, env); }
      if (G.boxes) { const bd = G.boxes, cm = (bd.cIn + bd.cOut) / 2, zm = (bd.zIn + bd.zOut) / 2; B.light(ctx, { quad: quadT(g, [[bd.r.x0, cm, zm - 4], [bd.r.x1, cm, zm - 4], [bd.r.x1, cm, zm + 3], [bd.r.x0, cm, zm + 3]]), color: C.glow, a: 0.4, halo: 3 }, env); }
    },
    habitat(ctx, g, env) {   // the den's warm glow and the two pier lamps (render_fx pushes the plaza lamps through sprites.habitatPoint)
      const H = M.HABITAT, T = !!g.frontLeft, pt = (lx, ly, z) => (T ? fp(g, ly * 32, lx * 32, z) : fp(g, lx * 32, ly * 32, z));
      B.light(ctx, { quad: [pt(H.FX0 + 0.012, 2.17, H.FLOOR_Z), pt(H.FX0 + 0.012, 2.63, H.FLOOR_Z), pt(H.FX0 + 0.012, 2.63, 9), pt(H.FX0 + 0.012, 2.17, 9)], color: C.den, a: 0.5, halo: 4 }, env);
      for (const ly of [0.1, 2.9]) { const p = pt(2.0, ly, 12); B.light(ctx, { x: p[0], y: p[1], r: 3, color: C.glow, a: 0.6 }, env); }
    },
    parking(ctx, g, env) { const p = fT(g, g.fw - 0.2, g.fh * 0.5, 0); B.light(ctx, { x: p[0], y: p[1] - 11.3, r: 4, color: C.glow, a: 0.8 }, env); B.light(ctx, { x: p[0], y: p[1], rx: 8, ry: 3.5, pool: true, color: C.glow, a: 0.45 }, env); },
    field(ctx, g, env) { if ((g.tier | 0) >= 1) { const p = fT(g, g.fw / 2, 0.26, 13); B.light(ctx, { x: p[0], y: p[1] - 2, r: 3, color: C.glow, a: 0.5 }, env); } }
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
      if (b.wallH > 0 && g.row.pathAdjacency && g.D.body !== 'wings' && !OWN_GROUND[g.D.body]) { const f = g.frontLeft ? 0 : 1, L = faceLen(b, f), hw = ((b.floors >= 2 || g.fw + g.fh >= 5) ? 3 : 2) / L; B.light(ctx, { quad: faceQuad(b, f, 0.5 - hw, 0.5 + hw, 5.6, 7.2), color: C.glow, a: 0.7, halo: 4 }, env); for (const s of [-1, 1]) { const p = facePt(b, f, 0.5 + s * 7 / L, 0, (f === 0 ? g.ipy : g.ipx), true); B.light(ctx, { x: p[0], y: p[1] - 11.3, r: 4, color: C.glow, a: 0.8 }, env); B.light(ctx, { x: p[0], y: p[1], rx: 8, ry: 3.5, pool: true, color: C.glow, a: 0.45 }, env); } }
      const hook = BODY_LIGHTS[g.D.body]; if (hook) hook(ctx, g, env, frame);
    }
    return { w: g0.w, h: g0.h, ox: g0.ox, oy: g0.oy };
  });
  // H2b: `habfront` — the Tiger Habitat's foreground (the near side wall, the viewing wall, railing, glass, piers) on a canvas laid out like
  // the building's with its empty top dropped (the pen's rule: y0 = ay − 56), drawn by render AFTER Roux so he walks behind the glass
  M.registerHD('habfront', function (ctx, spec) {
    const row = BSU.data && BSU.data.catalog && BSU.data.catalog.tiger_habitat, v = Number.isFinite(spec.variant) ? Math.max(0, spec.variant | 0) : 0;
    if (!row || !HD_ROWS.tiger_habitat) { B.begin(ctx, 1, 1, spec); return { w: 1, h: 1, ox: 0, oy: 0 }; }
    spec.frames = 1; spec.framesPerVariant = true;
    const g0 = M.buildingBox(row, v, 1, 0), y0 = Math.max(0, g0.ay - 56);
    const G = B.begin(ctx, g0.w, g0.h - y0, spec), env = Object.assign({}, G.env, { night: !!(v & SPR.NIGHT) });
    const g = geometry(row, v, 0, 0, hash(strHash(row.id), v), null, env);   // the building sprite's own seed, so the two layers match
    ctx.translate(0, -y0);
    habitatBody(ctx, g, 0, env, 1, -1);
    return { w: g0.w, h: g0.h - y0, ox: g0.ox, oy: g0.oy + y0 };
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
