'use strict';
// ============================================================================
// BAYOU STATE — terrain.js (module 2) → BSU.terrain
// Owner (the only writer) of: tiles.elev (generation, subsidence, setElev),
// tiles.subs, tiles.flags bits 0 WETLAND_ORIGINAL, 1 PRESERVE, 6 BAYOU,
// 7 OPEN_WATER, 9 DESIRE_WORN, 10 DEBRIS, 11 MOUND, tiles.surface (through
// setSurface), tiles.type (classify), tiles.walk (rewalk), tiles.wear (daily
// decay only; agents increment), tiles.sandbag / sandbagDay (daily expiry write
// of 0 only), state.plot and state.veg.
// Implements: GDD §3 (all: the river, the natural levee ridge and its short
// crown, the Crevasse Reach, the backswamp basin, the cove, the bayou spline,
// the cypress lake, the cheniers and the Mounds, vegetation, the start plot,
// the guarantees G1–G8 with re-roll and the template fallback, the §3.3
// distribution), GDD §6.5 (subsidence), GDD §7 Pathfinding (the walk table),
// GDD §3.2 (surface runs: streetlamps, parade route; flags bit9/bit10/bit11;
// wear), GDD §6.2 Recovery (debris clearing); ARCHITECTURE §5.1 step 2, §5.2.
//
// Conventions:
//  - i = ty * 64 + tx; chunk = ((ty >> 3) << 3) + (tx >> 3).
//  - `walk` stays 0–4. DEBRIS (flag bit10) is NOT folded into the class: agents
//    read the flag and double the step cost (params.agents.debrisCostMult).
//  - Every emit goes through M._deps.emit (default BSU.events.emit) so selfTest
//    can record instead of broadcasting on the live bus (ARCHITECTURE §10.6).
//  - Every query cache is keyed on the state root plus a dirty generation
//    counter that `touch` and the building events bump (self-healing, D38).
//  - No DOM, no timers, no canvas, no unseeded randomness. Generation draws only from
//    BSU.rng.world (attempt 0) and BSU.rng.derive('reroll', k) (re-rolls).
//  - Listeners of tile:changed must never call terrain.touch synchronously
//    (a recursion would explode); they set dirty flags and act in their tick.
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.terrain = BSU.terrain || {});

  const P = BSU.params;
  const PT = P.terrain, PS = P.subsidence, PH = P.hydro, PA = P.agents, PST = P.storm;
  const T = BSU.T, F = BSU.FLAG, SURF = BSU.SURF, EV = BSU.EV, MAP = BSU.MAP;
  const W = MAP.W, H = MAP.H, N = MAP.N;

  const WATER_FLAGS = F.OPEN_WATER | F.BAYOU;
  const TERRAIN_BITS = F.WETLAND_ORIGINAL | F.PRESERVE | F.BAYOU | F.OPEN_WATER | F.DESIRE_WORN | F.DEBRIS | F.MOUND;
  const TOUCH_KINDS = { elev: 1, surface: 1, crest: 1, flags: 1, type: 1, water: 1, decor: 1 };
  const REWALK_KINDS = { elev: 1, surface: 1, crest: 1, flags: 1, type: 1, water: 1 };   // crest included: a bare levee berm changes the walk class

  // --- Local constants the GDD states but params does not carry (see docs/INTEGRATION_NOTES.md '## terrain.js') ---
  const ELEV_MIN = -4, ELEV_MAX = 14;                      // GDD §3.2 elev range
  const WORN_CLEAR = 20;                                   // DESIRE_WORN hysteresis: clear below 20 (brief §4.3 decision)
  const VEG_GROW_DAYS = {                                  // stage 0→1 and 1→2 at plantedDay + days (brief §2)
    oak: [PT.oakGrowDays / 2, PT.oakGrowDays],
    cypress: [PT.oakGrowDays / 2, PT.oakGrowDays],
    palmetto: [60, 120],
    azalea: [PST.azaleaRegrowDays, PST.azaleaRegrowDays * 2]
  };
  const LAKE_BOWL_FT = 1.5, LAKE_BOWL_RX = 2.5, LAKE_BOWL_RY = 5;   // GDD §3.4 step 3 "bowl toward the lake": an elongated depression (lake radii × 2.5 E–W, × 5 N–S), −0.9 ft at the lake rim
  const BASIN_NOISE_GAIN = 0.44;                           // basin noise = gain × z-score of the 2-octave field (tuned for the §3.3 Marsh/Wet split)
  const BASIN_OCTAVE2 = 0.35;                              // weight of the half-scale octave (lower = rounder Wet blobs, longer Marsh runs for G6)
  const BASIN_NORTH_LIFT = 0.35, BASIN_LIFT_ROWS = 40;     // the backswamp deepens toward the Gulf: +0.35 ft at row 0 tapering to 0 at row 40 (G6 at the §3.3 Wet share)
  const CHENIER_NEAR_ROWS = [10, 22];                      // the expansion chenier (G5) is centred in these rows
  const CHENIER_TRIES = 200;                               // placement attempts per chenier
  const CHENIER_OVERLAP = 0.35;                            // a chenier may overlap earlier ones (incl. their 1-tile margin) by up to 35% of its tiles
  const BAYOU_CTRL = [                                     // the three random control points (§3.4 step 4a): {ty band, tx band}; tx is also capped at bank(ty) − 12
    { y: [26, 32], x: [34, 42] },                          //   hugs the ridge foot south of the cove (leaves the backswamp west of it for cheniers)
    { y: [36, 42], x: [26, 36] },
    { y: [44, 48], x: [18, 26] }                           //   then turns for the lake, entering it from the north-east above row 51 (G6 runs for columns ≥ 17)
  ];
  const CHENIER_PLATEAU = 1.5;                             // chenier profile = rim + (crest − rim)·cos(π/2 · r^1.5): a flatter crown, steeper rim (~10 High / ~35 Dry per chenier, §3.4 step 5)
  const BAYOU_SAMPLES_PER_TILE = 4;                        // spline sampling density
  const CROSSING_TURF = { practice_field: 1, stadium: 1, parking: 1 };   // footprints agents may cross (walk class 2)

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const clamp = BSU.clamp;
  function validI(i) { return typeof i === 'number' && (i | 0) === i && i >= 0 && i < N; }
  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function chunkOf(tx, ty) { return ((ty >> 3) << 3) + (tx >> 3); }
  function hydro() { return M._deps.hydro(); }
  function wildlife() { return M._deps.wildlife(); }
  function buildingsMod() { return M._deps.buildings(); }
  function fail(where, e) { BSU.error('terrain', where, e); }

  /** injectable dependencies (selfTest swaps these; ARCHITECTURE §10.5/§10.6) */
  M._deps = {
    emit: function (name, payload) { BSU.events.emit(name, payload); },
    hydro: function () { return BSU.hydro || null; },
    buildings: function () { return BSU.buildings || null; },
    wildlife: function () { return BSU.wildlife || null; }
  };

  /** true once terrain.gen has filled this state (an ungenerated tree reads as all Open Water and is left alone) */
  function isGenerated(state) {
    const p = state && state.plot;
    return !!(p && ((p.bayou && p.bayou.length) || (p.highway && p.highway.length) || p.template));
  }

  // ---------------------------------------------------------------------------
  // Caches (all keyed on the root + dirty generation; rebuilt lazily)
  // ---------------------------------------------------------------------------
  let dirtyGen = 0;
  let cache = freshCache(null, -1);
  function freshCache(root, gen) {
    return { root: root, gen: gen, reach: null, reachLand: null, high5: 0, lamps: null, parade: null, disturbed: null };
  }
  function invalidate() { dirtyGen++; }
  function ensure(state) {
    if (cache.root !== state || cache.gen !== dirtyGen) cache = freshCache(state, dirtyGen);
    return cache;
  }

  // ---------------------------------------------------------------------------
  // Profile functions (GDD §3.4)
  // ---------------------------------------------------------------------------
  /** bank(ty) = floor(58 + 2·sin(ty/9)) − 1: the last land column beside the river */
  M.bank = function (ty) { return Math.floor(PT.bankBase + PT.bankAmp * Math.sin(ty / PT.bankPeriod)) - 1; };

  /** crown(ty): 1.0 rows 6–13, 0.7 rows 5/14, 0.42 to row 26, linear to 0.25 at row 34 */
  function crown(ty) {
    const cf = PT.crownFactors;
    if (ty >= PT.crownRows[0] && ty <= PT.crownRows[1]) return cf.crown;
    if (ty === PT.shoulderRows[0] || ty === PT.shoulderRows[1]) return cf.shoulder;
    if (ty <= PT.flankEndRow) return cf.flank;
    if (ty >= PT.reachRow) return cf.reachEnd;
    return cf.flank + (cf.reachEnd - cf.flank) * (ty - PT.flankEndRow) / (PT.reachRow - PT.flankEndRow);
  }
  /** base(ty): 2.0 to row 26, linear to 1.0 at row 34 */
  function base(ty) {
    if (ty <= PT.flankEndRow) return PT.baseNorth;
    if (ty >= PT.reachRow) return PT.baseSouth;
    return PT.baseNorth + (PT.baseSouth - PT.baseNorth) * (ty - PT.flankEndRow) / (PT.reachRow - PT.flankEndRow);
  }
  /** the noiseless ridge profile at distance d west of the bank */
  function ridgeProfile(ty, d) {
    return base(ty) + PT.ridgeAmp * crown(ty) * Math.pow(1 - d / PT.ridgeD, PT.ridgeExp);
  }

  /** value noise in [−1, 1] with a permutation table drawn from the stream */
  function makeNoise(R) {
    const perm = new Uint8Array(512), vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = R.float() * 2 - 1; }
    for (let i = 255; i > 0; i--) { const j = R.int(i + 1); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
    return function (x, y) {
      const fx = Math.floor(x), fy = Math.floor(y);
      let u = x - fx, v = y - fy;
      u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
      const ix = fx & 255, iy = fy & 255, iy1 = (fy + 1) & 255;
      const a = vals[perm[ix + perm[iy]]], b = vals[perm[ix + 1 + perm[iy]]];
      const c = vals[perm[ix + perm[iy1]]], d = vals[perm[ix + 1 + perm[iy1]]];
      return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
    };
  }

  /** a deterministic hash-backed draw source for the template map (no seed, no stream) */
  function hashDraws(salt) {
    let n = 0;
    const s = {
      float: function () { return BSU.rng.hash(n++, salt) / 4294967296; },
      int: function (k) { return Math.floor(s.float() * k); },
      range: function (a, b) { return a + s.float() * (b - a); },
      chance: function (p) { return s.float() < p; }
    };
    return s;
  }

  // ---------------------------------------------------------------------------
  // Classification (GDD §3.3)
  // ---------------------------------------------------------------------------
  /** the pure type rule */
  function typeOf(elev, fl) {
    if (fl & F.OPEN_WATER) return T.OPEN_WATER;
    if (fl & F.BAYOU) return T.BAYOU;
    if (fl & F.POND_SINK) return T.POND;
    if (elev < PT.typeBounds.marsh) return (fl & F.DRAINED) ? T.DRAINED : T.MARSH;
    if (elev < PT.typeBounds.wet) return T.WET;
    if (elev < PT.typeBounds.high) return T.DRY;
    return T.HIGH;
  }
  M.typeOf = typeOf;

  /** recompute tiles.type for one tile (emits tile:changed{type} only if it changed) or silently for all */
  M.classify = function (state, i) {
    try {
      const t = state.tiles;
      if (i === undefined || i === null) {
        for (let k = 0; k < N; k++) t.type[k] = typeOf(t.elev[k], t.flags[k]);
        invalidate();
        return;
      }
      if (!validI(i)) return;
      const nt = typeOf(t.elev[i], t.flags[i]);
      if (nt !== t.type[i]) { t.type[i] = nt; M.touch(state, i, 'type'); }
    } catch (e) { fail('classify', e); }
  };

  // ---------------------------------------------------------------------------
  // Walk grid (GDD §7 Pathfinding)
  // ---------------------------------------------------------------------------
  /** the pure walk-class rule for tile i (0 blocked, 1 path, 2 dry, 3 wet, 4 wading); allocation-free */
  M.walkClassOf = function (state, i) {
    try {
      if (!validI(i)) return 0;
      const t = state.tiles;
      const owner = t.owner[i];
      if (owner >= 0) {
        const b = (state.buildings && state.buildings[owner]) || null;
        const type = b ? b.type : (function () { const bm = buildingsMod(); const g = bm && bm.get ? bm.get(state, owner) : null; return g ? g.type : ''; })();
        if (!CROSSING_TURF[type]) return 0;
        return PA.walkClass.dry;
      }
      const fl = t.flags[i], surf = t.surface[i], type = t.type[i], depth = t.depth[i];
      const water = (fl & WATER_FLAGS) !== 0 || type === T.OPEN_WATER || type === T.BAYOU || type === T.POND;
      const th = PH.thresholds;
      if (surf === SURF.PATH || surf === SURF.ROAD || surf === SURF.BOARDWALK || surf === SURF.BRIDGE) {
        if (surf === SURF.BOARDWALK || surf === SURF.BRIDGE || water) {
          // boardwalk / road bridge: passable unless the local surface is more than 2 ft above normal stage;
          // the Pedestrian Bridge deck (bridge pass) is 6 ft up, so it takes a 6-ft head to overtop it
          const hy = hydro();
          let head, stage;
          if (hy && typeof hy.surfaceAt === 'function' && typeof hy.stageAt === 'function') {
            head = hy.surfaceAt(state, i); stage = typeof hy.normalStageAt === 'function' ? hy.normalStageAt(state, i) : hy.stageAt(state, i);   // bridge pass: the surge is not the normal stage
            if (!finite(head)) head = t.elev[i] + depth;
            if (!finite(stage)) stage = 0;
          } else { head = t.elev[i] + depth; stage = 0; }
          const lim = surf === SURF.BRIDGE ? (th.pedBridgeSurge || 6) : (surf === SURF.ROAD ? Math.max(th.bridgeSurge, (P.render.deckFt && P.render.deckFt.road) || 0) : th.bridgeSurge);   // a road bridge's deck is deckFt.road up
          return (head - stage > lim) ? 0 : PA.walkClass.path;
        }
        if (depth >= th.impassable) return 0;
        if (depth >= th.wading) return PA.walkClass.wading;
        return PA.walkClass.path;
      }
      if (water) return 0;
      if (fl & F.CANAL) return 0;                        // bare canal (surface 0 or a fence)
      if (fl & F.MOUND) return PA.walkClass.dry;         // walkable, unbuildable
      if (t.crest[i] > 0 && surf === SURF.NONE) {        // bare levee / floodwall berm
        const over = depth - t.crest[i];
        if (over >= th.impassable) return 0;
        if (over >= th.wading) return PA.walkClass.wading;
        return PA.walkClass.dry;
      }
      if (type === T.MARSH) return 0;                    // bare marsh (a fence on marsh too)
      if (depth >= th.impassable) return 0;
      if (depth >= th.wading) return PA.walkClass.wading;
      if (type === T.WET) return PA.walkClass.wet;
      return PA.walkClass.dry;                           // HIGH, DRY, DRAINED
    } catch (e) { fail('walkClassOf', e); return 0; }
  };

  /** recompute tiles.walk for one tile (O(1), allocation-free) or for every tile */
  M.rewalk = function (state, i) {
    try {
      const t = state.tiles;
      if (i === undefined || i === null) { for (let k = 0; k < N; k++) t.walk[k] = M.walkClassOf(state, k); return; }
      if (!validI(i)) return;
      t.walk[i] = M.walkClassOf(state, i);
    } catch (e) { fail('rewalk', e); }
  };

  // ---------------------------------------------------------------------------
  // The change relay
  // ---------------------------------------------------------------------------
  /** THE only tile-change relay: rewalks the tile (for elev/surface/flags/type/water), invalidates caches, emits tile:changed */
  M.touch = function (state, i, what) {
    try {
      if (!validI(i)) { fail('touch', new Error('bad tile index ' + i)); return; }
      if (!TOUCH_KINDS[what]) { fail('touch', new Error('bad what "' + what + '"')); return; }
      if (REWALK_KINDS[what]) state.tiles.walk[i] = M.walkClassOf(state, i);
      dirtyGen++;
      const tx = i & 63, ty = i >> 6;
      M._deps.emit(EV.TILE_CHANGED, { i: i, tx: tx, ty: ty, what: what, chunk: chunkOf(tx, ty) });
    } catch (e) { fail('touch', e); }
  };

  /** write tiles.surface (validated 0–4) then touch(i, 'surface') */
  M.setSurface = function (state, i, surf) {
    try {
      if (!validI(i)) return;
      if (!(surf === SURF.NONE || surf === SURF.PATH || surf === SURF.ROAD || surf === SURF.BOARDWALK || surf === SURF.FENCE || surf === SURF.BRIDGE)) { fail('setSurface', new Error('bad surface ' + surf)); return; }
      state.tiles.surface[i] = surf;
      M.touch(state, i, 'surface');
    } catch (e) { fail('setSurface', e); }
  };

  /** write elev (clamped −4…14), reclassify, rewalk, touch(i, 'elev') */
  M.setElev = function (state, i, ft) {
    try {
      if (!validI(i)) return;
      if (!finite(ft)) { fail('setElev', new Error('non-finite elev')); return; }
      const t = state.tiles;
      t.elev[i] = clamp(ft, ELEV_MIN, ELEV_MAX);
      t.type[i] = typeOf(t.elev[i], t.flags[i]);
      M.touch(state, i, 'elev');
    } catch (e) { fail('setElev', e); }
  };

  /** set/clear a terrain-owned flag bit (0, 1, 6, 7, 9, 10, 11); other owners write their bits and call touch(i, 'flags') */
  M.setFlag = function (state, i, bit, on) {
    try {
      if (!validI(i)) return;
      if (!(bit & TERRAIN_BITS) || (bit & (bit - 1)) !== 0) { fail('setFlag', new Error('not a terrain-owned bit: ' + bit)); return; }
      const t = state.tiles;
      const before = t.flags[i];
      const after = on ? (before | bit) : (before & ~bit);
      if (after === before) return;
      t.flags[i] = after;
      if (bit & (F.BAYOU | F.OPEN_WATER)) t.type[i] = typeOf(t.elev[i], after);
      M.touch(state, i, 'flags');
    } catch (e) { fail('setFlag', e); }
  };

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  /** TileInfo for the inspect panel */
  M.tileAt = function (state, tx, ty) {
    try {
      if (!BSU.inBounds(tx | 0, ty | 0)) return null;
      tx |= 0; ty |= 0;
      const i = ty * W + tx, t = state.tiles;
      let drains = 'ground';
      const hy = hydro();
      if (hy && typeof hy.drainsTo === 'function') { try { const d = hy.drainsTo(state, i); if (typeof d === 'string') drains = d; } catch (e) { /* keep default */ } }
      return {
        i: i, tx: tx, ty: ty, type: t.type[i], elev: t.elev[i], depth: t.depth[i], sat: t.sat[i], stand: t.stand[i], mosq: t.mosq[i],
        subs: t.subs[i], crest: t.crest[i], integrity: t.integrity[i], sandbag: t.sandbag[i], surface: t.surface[i], owner: t.owner[i],
        flags: t.flags[i], walk: t.walk[i], drainsTo: drains
      };
    } catch (e) { fail('tileAt', e); return null; }
  };
  /** not OPEN_WATER / BAYOU / POND */
  M.isLand = function (state, i) {
    if (!validI(i)) return false;
    const ty = state.tiles.type[i];
    return ty !== T.OPEN_WATER && ty !== T.BAYOU && ty !== T.POND;
  };
  /** flags has OPEN_WATER or BAYOU */
  M.isWater = function (state, i) { return validI(i) && (state.tiles.flags[i] & WATER_FLAGS) !== 0; };

  /** BFS from the plot rectangle over land that is not Water/Bayou/Marsh/Pond; fills cache.reach (Dry/High reached), reachLand (every reached tile), high5 */
  function buildReach(state) {
    const c = ensure(state);
    if (c.reach) return c;
    const t = state.tiles, type = t.type, elev = t.elev, flags = t.flags;
    const reach = new Uint8Array(N), land = new Uint8Array(N), queue = new Int32Array(N);
    let head = 0, tail = 0, high5 = 0;
    const r = state.plot.rect;
    const passable = function (k) { const ty = type[k]; return ty !== T.OPEN_WATER && ty !== T.BAYOU && ty !== T.MARSH && ty !== T.POND; };
    for (let ty = r.y0; ty <= r.y1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) {
      if (!BSU.inBounds(tx, ty)) continue;
      const k = ty * W + tx;
      if (!land[k] && passable(k)) { land[k] = 1; queue[tail++] = k; }
    }
    while (head < tail) {
      const k = queue[head++];
      if (elev[k] >= PT.typeBounds.wet && !(flags[k] & F.MOUND)) { reach[k] = 1; if (elev[k] >= PT.crownElev) high5++; }
      const tx = k & 63, ty = k >> 6;
      if (ty > 0) { const n = k - W; if (!land[n] && passable(n)) { land[n] = 1; queue[tail++] = n; } }
      if (tx < W - 1) { const n = k + 1; if (!land[n] && passable(n)) { land[n] = 1; queue[tail++] = n; } }
      if (ty < H - 1) { const n = k + W; if (!land[n] && passable(n)) { land[n] = 1; queue[tail++] = n; } }
      if (tx > 0) { const n = k - 1; if (!land[n] && passable(n)) { land[n] = 1; queue[tail++] = n; } }
    }
    c.reach = reach; c.reachLand = land; c.high5 = high5;
    return c;
  }
  /** 1 = Dry/High tile reachable from the plot without crossing Water/Bayou/Marsh (G7); cached until touch */
  M.reachableDryHigh = function (state) {
    try { return buildReach(state).reach; } catch (e) { fail('reachableDryHigh', e); return new Uint8Array(N); }
  };
  /** count of reachable tiles ≥ 5.0 ft (G1b, "Ridge full") */
  M.reachableHigh5 = function (state) {
    try { return buildReach(state).high5; } catch (e) { fail('reachableHigh5', e); return 0; }
  };

  /** a tile that a footprint may occupy (for ridgeFull): free of owner, drag surfaces, crest, canal, preserve, mound and the reserved Founders' 3×3 */
  function siteFree(state, k, fx0, fy0) {
    const t = state.tiles;
    if (t.owner[k] >= 0 || t.surface[k] !== 0 || t.crest[k] > 0) return false;
    if (t.flags[k] & (F.CANAL | F.PRESERVE | F.MOUND | F.POND_SINK)) return false;
    const tx = k & 63, ty = k >> 6;
    if (tx >= fx0 && tx < fx0 + 3 && ty >= fy0 && ty < fy0 + 3 && t.owner[k] < 0) return false;   // reserved Founders' footprint
    return true;
  }
  /** §3.6 "Ridge full": null while a ≥ 5-ft flat w×h remains reachable; else the flattest fallback site */
  M.ridgeFull = function (state, w, h) {
    try {
      w = w | 0; h = h | 0;
      if (w < 1 || h < 1 || w > W || h > H) return null;
      const c = buildReach(state);
      const reach = c.reach, land = c.reachLand, elev = state.tiles.elev;
      const fx0 = state.plot.founders.tx, fy0 = state.plot.founders.ty;
      const foundersPlaced = state.buildings && state.buildings.some(function (b) { return b && b.type === 'founders_hall'; });
      const rx = foundersPlaced ? -99 : fx0, ry = foundersPlaced ? -99 : fy0;
      let best = null, bestSpan = Infinity, bestMin = -Infinity, bestElev = 0;
      let wetBest = null, wetSpan = Infinity, wetMin = -Infinity;
      for (let ty = 0; ty + h <= H; ty++) for (let tx = 0; tx + w <= W; tx++) {
        let lo = Infinity, hi = -Infinity, ok5 = true, ok35 = true, okLand = true;
        for (let dy = 0; dy < h && okLand; dy++) for (let dx = 0; dx < w; dx++) {
          const k = (ty + dy) * W + tx + dx;
          if (!land[k] || !siteFree(state, k, rx, ry)) { okLand = false; break; }
          if (!reach[k]) ok35 = false;
          const e = elev[k];
          if (e < PT.crownElev) ok5 = false;
          if (e < lo) lo = e; if (e > hi) hi = e;
        }
        if (!okLand) continue;
        const span = hi - lo;
        if (ok5 && span <= P.build.slopeFt) return null;                         // a legal ≥ 5-ft site still exists
        if (ok35) { if (span < bestSpan || (span === bestSpan && lo > bestMin)) { bestSpan = span; bestMin = lo; best = { tx: tx, ty: ty }; bestElev = lo; } }
        else if (lo >= PT.typeBounds.marsh) { if (span < wetSpan || (span === wetSpan && lo > wetMin)) { wetSpan = span; wetMin = lo; wetBest = { tx: tx, ty: ty }; } }
      }
      if (best) return { tx: best.tx, ty: best.ty, elev: Math.round(bestElev * 10) / 10, floodsAt: bestElev >= PT.typeBounds.wet ? 'Cat 2' : 'rain' };
      if (wetBest) return { tx: wetBest.tx, ty: wetBest.ty, elev: Math.round(wetMin * 10) / 10, floodsAt: 'rain' };
      return null;
    } catch (e) { fail('ridgeFull', e); return null; }
  };

  /** every 4th road tile / 6th path tile along each 4-connected run, counted in BFS order from the run's lowest index; cached */
  M.streetlamps = function (state) {
    try {
      const c = ensure(state);
      if (c.lamps) return c.lamps;
      const surface = state.tiles.surface;
      const seen = new Uint8Array(N), queue = new Int32Array(N), lamps = [];
      for (let i = 0; i < N; i++) {
        const s = surface[i];
        if (seen[i] || (s !== SURF.ROAD && s !== SURF.PATH)) continue;
        const every = s === SURF.ROAD ? P.render.lampEveryRoad : P.render.lampEveryPath;
        let head = 0, tail = 0, k = 0;
        seen[i] = 1; queue[tail++] = i;
        while (head < tail) {
          const cur = queue[head++];
          if (k % every === 0) lamps.push(cur);
          k++;
          const tx = cur & 63, ty = cur >> 6;
          if (ty > 0 && !seen[cur - W] && surface[cur - W] === s) { seen[cur - W] = 1; queue[tail++] = cur - W; }
          if (tx < W - 1 && !seen[cur + 1] && surface[cur + 1] === s) { seen[cur + 1] = 1; queue[tail++] = cur + 1; }
          if (ty < H - 1 && !seen[cur + W] && surface[cur + W] === s) { seen[cur + W] = 1; queue[tail++] = cur + W; }
          if (tx > 0 && !seen[cur - 1] && surface[cur - 1] === s) { seen[cur - 1] = 1; queue[tail++] = cur - 1; }
        }
      }
      c.lamps = lamps;
      return lamps;
    } catch (e) { fail('streetlamps', e); return []; }
  };

  /** BFS inside a same-surface component from `start`; returns {far, dist, parent} */
  function bfsRun(surface, s, start, dist, parent, queue) {
    dist.fill(-1);
    let head = 0, tail = 0, far = start;
    dist[start] = 0; parent[start] = -1; queue[tail++] = start;
    while (head < tail) {
      const cur = queue[head++];
      if (dist[cur] > dist[far] || (dist[cur] === dist[far] && cur < far)) far = cur;
      const tx = cur & 63, ty = cur >> 6;
      const tryN = function (n) { if (dist[n] < 0 && surface[n] === s) { dist[n] = dist[cur] + 1; parent[n] = cur; queue[tail++] = n; } };
      if (ty > 0) tryN(cur - W);
      if (tx < W - 1) tryN(cur + 1);
      if (ty < H - 1) tryN(cur + W);
      if (tx > 0) tryN(cur - 1);
    }
    return far;
  }
  /** the longest 4-connected road run (≥ 4 tiles) as its diameter path, else the longest path run, else [] */
  M.paradeRoute = function (state) {
    try {
      const c = ensure(state);
      if (c.parade) return c.parade;
      const surface = state.tiles.surface;
      const seen = new Uint8Array(N), queue = new Int32Array(N);
      const dist = new Int32Array(N), parent = new Int32Array(N);
      const comps = { 2: { start: -1, size: 0 }, 1: { start: -1, size: 0 } };
      for (let i = 0; i < N; i++) {
        const s = surface[i];
        if (seen[i] || (s !== SURF.ROAD && s !== SURF.PATH)) continue;
        let head = 0, tail = 0;
        seen[i] = 1; queue[tail++] = i;
        while (head < tail) {
          const cur = queue[head++];
          const tx = cur & 63, ty = cur >> 6;
          if (ty > 0 && !seen[cur - W] && surface[cur - W] === s) { seen[cur - W] = 1; queue[tail++] = cur - W; }
          if (tx < W - 1 && !seen[cur + 1] && surface[cur + 1] === s) { seen[cur + 1] = 1; queue[tail++] = cur + 1; }
          if (ty < H - 1 && !seen[cur + W] && surface[cur + W] === s) { seen[cur + W] = 1; queue[tail++] = cur + W; }
          if (tx > 0 && !seen[cur - 1] && surface[cur - 1] === s) { seen[cur - 1] = 1; queue[tail++] = cur - 1; }
        }
        if (tail > comps[s].size) { comps[s].size = tail; comps[s].start = i; }
      }
      let pick = null;
      if (comps[2].size >= 4) pick = { s: SURF.ROAD, start: comps[2].start };
      else if (comps[1].size >= 1) pick = { s: SURF.PATH, start: comps[1].start };
      let route = [];
      if (pick) {
        const a = bfsRun(surface, pick.s, pick.start, dist, parent, queue);   // farthest from an arbitrary tile
        const b = bfsRun(surface, pick.s, a, dist, parent, queue);            // farthest from a: the diameter
        for (let k = b; k !== -1; k = parent[k]) route.push(k);
        route.reverse();
      }
      c.parade = route;
      return route;
    } catch (e) { fail('paradeRoute', e); return []; }
  };

  /** Marsh within Chebyshev 2 of any footprint tile or surface 1–3 tile (wildlife's mosquito nursery rule); cached mask */
  M.isDisturbedMarsh = function (state, i) {
    try {
      if (!validI(i)) return false;
      const c = ensure(state);
      if (!c.disturbed) {
        const t = state.tiles, mask = new Uint8Array(N), rad = P.wildlife.mosq.disturbRadius;
        for (let k = 0; k < N; k++) {
          const s = t.surface[k];
          if (t.owner[k] < 0 && !(s === SURF.PATH || s === SURF.ROAD || s === SURF.BOARDWALK || s === SURF.BRIDGE)) continue;
          const tx = k & 63, ty = k >> 6;
          for (let dy = -rad; dy <= rad; dy++) { const y = ty + dy; if (y < 0 || y >= H) continue; for (let dx = -rad; dx <= rad; dx++) { const x = tx + dx; if (x >= 0 && x < W) mask[y * W + x] = 1; } }
        }
        c.disturbed = mask;
      }
      return c.disturbed[i] === 1 && state.tiles.type[i] === T.MARSH;
    } catch (e) { fail('isDisturbedMarsh', e); return false; }
  };

  // ---------------------------------------------------------------------------
  // landRoute: the G3 search over land tiles of any type (bare Marsh included).
  // Dijkstra with cost 64 per step minus 1 per cove tile: the shortest route in
  // steps, tie-broken toward the cove (so the tutorial path gets wet).
  // ---------------------------------------------------------------------------
  const RT_COST = new Int32Array(N), RT_PARENT = new Int32Array(N), RT_HEAP = new Int32Array(N + 1), RT_POS = new Int32Array(N);
  /** shortest route (4-connected, over land, footprints excluded except the endpoints) from tile a to tile b; null if none */
  M.landRoute = function (state, a, b) {
    try {
      if (!validI(a) || !validI(b)) return null;
      const t = state.tiles, type = t.type, owner = t.owner;
      const coveMask = new Uint8Array(N);
      const cove = state.plot.cove || [];
      for (let k = 0; k < cove.length; k++) if (validI(cove[k])) coveMask[cove[k]] = 1;
      const passable = function (k) {
        const ty = type[k];
        if (ty === T.OPEN_WATER || ty === T.BAYOU || ty === T.POND) return false;
        return owner[k] < 0 || k === a || k === b;
      };
      if (!passable(a) || !passable(b)) return null;
      const cost = RT_COST, parent = RT_PARENT, heap = RT_HEAP, pos = RT_POS;
      cost.fill(0x3fffffff); parent.fill(-1); pos.fill(-1);
      let size = 0;
      const less = function (x, y) { return cost[x] < cost[y] || (cost[x] === cost[y] && x < y); };
      const up = function (j) { while (j > 1) { const p = j >> 1; if (less(heap[j], heap[p])) { const tmp = heap[j]; heap[j] = heap[p]; heap[p] = tmp; pos[heap[j]] = j; pos[heap[p]] = p; j = p; } else break; } };
      const down = function (j) { for (;;) { let l = j * 2, r = l + 1, m = j; if (l <= size && less(heap[l], heap[m])) m = l; if (r <= size && less(heap[r], heap[m])) m = r; if (m === j) break; const tmp = heap[j]; heap[j] = heap[m]; heap[m] = tmp; pos[heap[j]] = j; pos[heap[m]] = m; j = m; } };
      const push = function (k) { heap[++size] = k; pos[k] = size; up(size); };
      const pop = function () { const top = heap[1]; heap[1] = heap[size--]; if (size) { pos[heap[1]] = 1; down(1); } pos[top] = -1; return top; };
      cost[a] = 0; push(a);
      let found = false;
      while (size) {
        const cur = pop();
        if (cur === b) { found = true; break; }
        const tx = cur & 63, ty = cur >> 6, cc = cost[cur];
        const relax = function (n) {
          if (!passable(n)) return;
          const nc = cc + 64 - coveMask[n];
          if (nc < cost[n]) { cost[n] = nc; parent[n] = cur; if (pos[n] < 0) push(n); else up(pos[n]); }
        };
        if (ty > 0) relax(cur - W);
        if (tx < W - 1) relax(cur + 1);
        if (ty < H - 1) relax(cur + W);
        if (tx > 0) relax(cur - 1);
      }
      if (!found) return null;
      const route = [];
      for (let k = b; k !== -1; k = parent[k]) route.push(k);
      route.reverse();
      return route;
    } catch (e) { fail('landRoute', e); return null; }
  };

  // ---------------------------------------------------------------------------
  // Vegetation entities
  // ---------------------------------------------------------------------------
  const VEG_TYPES = { oak: 1, cypress: 1, palmetto: 1, azalea: 1 };
  /** buildings calls this for the Live Oak / Bald Cypress / Azalea rows; returns the Veg struct */
  M.plantVeg = function (state, type, tx, ty) {
    try {
      if (!VEG_TYPES[type] || !BSU.inBounds(tx | 0, ty | 0)) { fail('plantVeg', new Error('bad veg ' + type + ' at ' + tx + ',' + ty)); return null; }
      tx |= 0; ty |= 0;
      const v = { type: type, tx: tx, ty: ty, stage: 0, plantedDay: state.calendar.day, planted: true };
      state.veg.push(v);
      M.touch(state, ty * W + tx, 'decor');
      return v;
    } catch (e) { fail('plantVeg', e); return null; }
  };
  /** remove every veg entity on the tile; true if any was removed */
  M.removeVeg = function (state, tx, ty) {
    try {
      if (!BSU.inBounds(tx | 0, ty | 0)) return false;
      tx |= 0; ty |= 0;
      let removed = false;
      for (let k = state.veg.length - 1; k >= 0; k--) { const v = state.veg[k]; if (v && v.tx === tx && v.ty === ty) { state.veg.splice(k, 1); removed = true; } }
      if (removed) M.touch(state, ty * W + tx, 'decor');
      return removed;
    } catch (e) { fail('removeVeg', e); return false; }
  };

  // ---------------------------------------------------------------------------
  // Tier 2: Marsh Restoration support and the Second Campus stub
  // ---------------------------------------------------------------------------
  /** Marsh Restoration completes on tile i (hydro calls this): elev ≤ 1.0, DRAINED cleared through hydro.markRestored, WETLAND_ORIGINAL set, reclassified */
  M.restoreToMarsh = function (state, i) {
    try {
      if (!validI(i)) return false;
      const t = state.tiles;
      if (t.flags[i] & (WATER_FLAGS | F.POND_SINK)) return false;
      if (t.elev[i] > PT.typeBounds.marsh - 0.5) t.elev[i] = PT.typeBounds.marsh - 0.5;   // 1.0 ft: marsh with a margin below the 1.5 bound
      const hy = hydro();
      if (t.flags[i] & F.DRAINED) {
        if (hy && typeof hy.markRestored === 'function') { try { hy.markRestored(state, i); } catch (e) { fail('markRestored', e); } }
        if (t.flags[i] & F.DRAINED) t.flags[i] &= ~F.DRAINED;   // hydro owns bit 3; if it did not clear it the restoration would be a no-op, so clear it here and say so
      }
      t.flags[i] = (t.flags[i] | F.WETLAND_ORIGINAL) & ~F.RESTORING;
      t.type[i] = typeOf(t.elev[i], t.flags[i]);
      M.touch(state, i, 'elev');
      return true;
    } catch (e) { fail('restoreToMarsh', e); return false; }
  };
  /** the Second Campus: a second Highway 1 stub entering from the west edge (7 road tiles on the first land row nearest the map's middle); returns the tiles */
  M.addWestStub = function (state) {
    try {
      const p = state.plot;
      if (p.westHighway && p.westHighway.length) return p.westHighway;
      const n = PT.highwayTiles;
      let best = -1, bestD = Infinity;
      for (let ty = 0; ty < H; ty++) {
        let okRow = true;
        for (let tx = 0; tx < n; tx++) { const i = ty * W + tx; if (!M.isLand(state, i) || state.tiles.owner[i] >= 0 || (state.tiles.flags[i] & F.CANAL)) { okRow = false; break; } }
        const d = Math.abs(ty - H / 2);
        if (okRow && d < bestD) { bestD = d; best = ty; }
      }
      if (best < 0) return [];
      const tiles = [];
      for (let tx = 0; tx < n; tx++) { const i = best * W + tx; tiles.push(i); M.setSurface(state, i, SURF.ROAD); }
      p.westHighway = tiles;   // lazily-initialized saved plot key (ARCH §2 rule for frozen contract.js)
      return tiles;
    } catch (e) { fail('addWestStub', e); return []; }
  };

  // ---------------------------------------------------------------------------
  // Subsidence (GDD §6.5)
  // ---------------------------------------------------------------------------
  /** masks of the pump dewatering radius and the cypress halo (built once per yearly pass or per query) */
  function subsidenceMasks(state) {
    const pump = new Uint8Array(N), cyp = new Uint8Array(N);
    const bs = state.buildings || [];
    const rad = PS.pumpRadius;
    for (let b = 0; b < bs.length; b++) {
      const bd = bs[b];
      if (!bd || bd.type !== 'pump' || bd.ruin || bd.powered === false || bd.built < 1) continue;
      for (let ty = bd.ty - rad; ty < bd.ty + bd.h + rad; ty++) { if (ty < 0 || ty >= H) continue; for (let tx = bd.tx - rad; tx < bd.tx + bd.w + rad; tx++) { if (tx >= 0 && tx < W) pump[ty * W + tx] = 1; } }
    }
    const cr = PS.cypressRadius;
    for (let k = 0; k < state.veg.length; k++) {
      const v = state.veg[k];
      if (!v || v.type !== 'cypress') continue;
      for (let dy = -cr; dy <= cr; dy++) { const y = v.ty + dy; if (y < 0 || y >= H) continue; for (let dx = -cr; dx <= cr; dx++) { const x = v.tx + dx; if (x >= 0 && x < W) cyp[y * W + x] = 1; } }
    }
    return { pump: pump, cyp: cyp };
  }
  /** the §6.5 rate for one tile given the masks */
  function rateWith(state, i, under, pilings, masks) {
    const t = state.tiles, type = t.type[i], fl = t.flags[i];
    if (fl & (F.PRESERVE | F.MOUND | WATER_FLAGS)) return 0;
    if (type === T.OPEN_WATER || type === T.BAYOU || type === T.POND) return 0;
    if (pilings) return 0;
    if (t.crest[i] > 0) {
      if (t.crest[i] >= 12) return 0;                                    // floodwall
      return (type === T.WET || type === T.MARSH || type === T.DRAINED) ? PS.levee : 0;
    }
    let rate;
    if (type === T.DRAINED) rate = under ? PS.drainedBuilt : PS.drainedBare;
    else if (type === T.WET || type === T.MARSH) rate = under ? PS.wetBuilt : PS.wetBare;
    else if (type === T.DRY) rate = PS.dry;
    else rate = PS.high;
    if (rate <= 0) return 0;
    if (masks.pump[i]) rate += PS.pumpAdd;
    if (masks.cyp[i]) rate *= PS.cypressMult;
    return rate;
  }
  /** the §6.5 ft/yr rate for one tile (inspect panel, the ghost's sink line) */
  M.subsidenceRate = function (state, i, underBuilding) {
    try {
      if (!validI(i)) return 0;
      const owner = state.tiles.owner[i];
      const b = owner >= 0 && state.buildings ? state.buildings[owner] : null;
      const pilings = !!(b && b.pilings);
      return rateWith(state, i, !!underBuilding || owner >= 0, pilings, subsidenceMasks(state));
    } catch (e) { fail('subsidenceRate', e); return 0; }
  };
  /** the Jan 1 step: subs += rate, elev −= rate, reclassify, touch, buildings.applySubsidence once per building */
  M.applySubsidenceYear = function (state) {
    try {
      const t = state.tiles, masks = subsidenceMasks(state);
      const perBuilding = {};
      for (let i = 0; i < N; i++) {
        const owner = t.owner[i];
        const b = owner >= 0 && state.buildings ? state.buildings[owner] : null;
        const rate = rateWith(state, i, owner >= 0, !!(b && b.pilings), masks);
        if (rate <= 0) continue;
        t.subs[i] += rate;
        t.elev[i] = clamp(t.elev[i] - rate, ELEV_MIN, ELEV_MAX);
        t.type[i] = typeOf(t.elev[i], t.flags[i]);
        if (owner >= 0 && b) { const prev = perBuilding[owner] || 0; if (rate > prev) perBuilding[owner] = rate; }
        M.touch(state, i, 'elev');
      }
      const bm = buildingsMod();
      if (bm && typeof bm.applySubsidence === 'function') {
        const ids = Object.keys(perBuilding).map(Number).sort(function (a, b) { return a - b; });
        for (let k = 0; k < ids.length; k++) { try { bm.applySubsidence(state, ids[k], perBuilding[ids[k]]); } catch (e) { fail('applySubsidence', e); } }
      }
    } catch (e) { fail('applySubsidenceYear', e); }
  };

  // ---------------------------------------------------------------------------
  // Daily work (§5.1 step 2)
  // ---------------------------------------------------------------------------
  function daily(state) {
    const t = state.tiles, day = state.calendar.day;
    const hy = hydro();
    // sandbag expiry
    for (let i = 0; i < N; i++) {
      if (t.sandbag[i] > 0 && day >= t.sandbagDay[i]) {
        t.sandbag[i] = 0; t.sandbagDay[i] = 0;
        if (hy && typeof hy.markLeveeChange === 'function') { try { hy.markLeveeChange(state, i); } catch (e) { fail('markLeveeChange', e); } }
      }
    }
    // storm debris: 5 days after landfall, or instantly within 14 of a Wildlife Post
    const last = state.storms ? state.storms.lastLandfallDay : -1;
    const clearAll = last >= 0 && day >= last + PST.debrisDays;
    const wl = wildlife();
    const traps = (wl && typeof wl.nutriaTraps === 'function') ? wl.nutriaTraps : null;
    for (let i = 0; i < N; i++) {
      if (!(t.flags[i] & F.DEBRIS)) continue;
      let clear = clearAll;
      if (!clear && traps) { try { clear = !!traps(state, i); } catch (e) { fail('nutriaTraps', e); } }
      if (clear) { t.flags[i] &= ~F.DEBRIS; M.touch(state, i, 'flags'); }
    }
    // desire lines: evaluate the worn flag against today's wear, then decay
    for (let i = 0; i < N; i++) {
      const w = t.wear[i], worn = (t.flags[i] & F.DESIRE_WORN) !== 0;
      if (!worn && w >= PA.wearThreshold) { t.flags[i] |= F.DESIRE_WORN; M.touch(state, i, 'decor'); }
      else if (worn && w < WORN_CLEAR) { t.flags[i] &= ~F.DESIRE_WORN; M.touch(state, i, 'decor'); }
      if (w > 0) t.wear[i] = w > PA.wearDecay ? w - PA.wearDecay : 0;
    }
    // vegetation growth
    for (let k = 0; k < state.veg.length; k++) {
      const v = state.veg[k];
      if (!v || v.stage >= 2) continue;
      const days = VEG_GROW_DAYS[v.type] || VEG_GROW_DAYS.oak;
      const age = day - (finite(v.plantedDay) ? v.plantedDay : 0);
      const stage = age >= days[1] ? 2 : age >= days[0] ? 1 : 0;
      if (stage > v.stage) { v.stage = stage; if (BSU.inBounds(v.tx, v.ty)) M.touch(state, v.ty * W + v.tx, 'decor'); }
    }
  }

  /** §5.1 step 2: daily work on flags.newDay; the subsidence step on Jan 1 of Year 2+ */
  M.tick = function (state, flags) {
    try {
      if (!state || !flags || !isGenerated(state)) return;
      if (flags.newDay) daily(state);
      if (flags.newYear && state.calendar.year >= 2) M.applySubsidenceYear(state);
    } catch (e) { fail('tick', e); }
  };

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  let inited = false;
  function onBuildingEvent() { invalidate(); }
  /** once per page load: subscribe (owner 'terrain') to building:placed/removed for the cache invalidation */
  M.init = function () {
    try {
      if (inited) return;
      inited = true;
      BSU.events.on(EV.BUILDING_PLACED, onBuildingEvent, 'terrain');
      BSU.events.on(EV.BUILDING_REMOVED, onBuildingEvent, 'terrain');
    } catch (e) { fail('init', e); }
  };
  /** every newGame/load: drop every cache; heal type/walk of a generated tree (never draws rng.sim) */
  M.reset = function (state) {
    try {
      invalidate();
      cache = freshCache(null, -1);
      if (!state || !isGenerated(state)) return;
      const t = state.tiles;
      for (let k = 0; k < N; k++) t.type[k] = typeOf(t.elev[k], t.flags[k]);
      M.rewalk(state);
    } catch (e) { fail('reset', e); }
  };

  // ---------------------------------------------------------------------------
  // Generation (GDD §3.4)
  // ---------------------------------------------------------------------------
  /** the hand-authored fallback map: the same steps with fixed control points, a fixed relief field and no random noise */
  M.template = function () {
    return {
      bayouX0: 30,
      controls: [[38, 29], [28, 38], [20, 46]],
      cheniers: [                                        // all in the backswamp north of the lake apron (the first is the G5 expansion chenier)
        { cx: 32, cy: 14, a: 7, b: 4, angle: 0.30, crest: 7.5 },
        { cx: 22, cy: 27, a: 6.5, b: 3.8, angle: -0.35, crest: 7.2 },
        { cx: 12, cy: 20, a: 6, b: 3.5, angle: 0.20, crest: 7.0 },
        { cx: 9, cy: 29, a: 6, b: 3.2, angle: 0.0, crest: 7.3 },
        { cx: 33, cy: 24, a: 5, b: 3, angle: 0.0, crest: 7.0 },
        { cx: 20, cy: 6, a: 6, b: 3.6, angle: -0.45, crest: 7.1 },
        { cx: 8, cy: 8, a: 5.5, b: 3.2, angle: 0.10, crest: 6.8 }
      ],
      /** deterministic relief for the backswamp in place of noise (a few crossed sinusoids) */
      basin: function (x, y) {
        return 0.42 * Math.sin(x * 0.61 + 0.4) * Math.sin(y * 0.53 + 1.1) + 0.30 * Math.cos((x - y) * 0.37 + 0.7) + 0.16 * Math.sin((x + 2 * y) * 0.23);
      }
    };
  };

  /** clear everything terrain owns before an attempt */
  function clearTerrain(state) {
    const t = state.tiles;
    t.elev.fill(0); t.flags.fill(0); t.surface.fill(0); t.type.fill(0); t.walk.fill(0); t.subs.fill(0);
    t.wear.fill(0); t.sandbag.fill(0); t.sandbagDay.fill(0);
    state.veg.length = 0;
    const p = state.plot;
    p.highway = []; p.oaks = []; p.cove = []; p.mouth = []; p.landing = -1; p.landingShoulder = -1;
    p.mounds = []; p.cheniers = []; p.bayou = []; p.lake = []; p.template = false;
  }

  /** rasterize one ellipse (rotated by `angle`) into [{i, r}] with r the normalized radius ≤ 1 */
  function ellipseTiles(cx, cy, a, b, angle, out) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const reach = Math.ceil(Math.max(a, b)) + 1;
    out.length = 0;
    for (let ty = Math.max(0, Math.floor(cy - reach)); ty <= Math.min(H - 1, Math.ceil(cy + reach)); ty++) {
      for (let tx = Math.max(0, Math.floor(cx - reach)); tx <= Math.min(W - 1, Math.ceil(cx + reach)); tx++) {
        const dx = tx - cx, dy = ty - cy;
        const u = (dx * ca + dy * sa) / a, v = (-dx * sa + dy * ca) / b;
        const r2 = u * u + v * v;
        if (r2 <= 1) out.push({ i: ty * W + tx, r: Math.sqrt(r2) });
      }
    }
    return out;
  }

  /**
   * One generation attempt. `R` is the draw source (a BSU.rng Stream, or the
   * template's hash draws), `tpl` the template description or null. Returns
   * {ok, why} — `ok` false means "re-roll" (G8 pre-carve check, chenier fit,
   * or a failed guarantee).
   */
  function attempt(state, R, tpl) {
    const t = state.tiles, elev = t.elev, flags = t.flags, plot = state.plot;
    clearTerrain(state);
    const bankRow = new Int32Array(H);
    for (let ty = 0; ty < H; ty++) bankRow[ty] = M.bank(ty);
    const bank0 = M.bank(PT.bank0Row);
    const rect = { x0: bank0 + PT.plotRect.dx0, y0: PT.plotRect.y0, x1: bank0 + PT.plotRect.dx1, y1: PT.plotRect.y1 };
    const inRect = function (tx, ty) { return tx >= rect.x0 && tx <= rect.x1 && ty >= rect.y0 && ty <= rect.y1; };

    // --- noise fields ---
    const lake = PT.lake, lakeTiles = [];
    let ridgeNoise, basinNoise;
    if (tpl) {
      ridgeNoise = function () { return 0; };
      basinNoise = tpl.basin;
    } else {
      const n1 = makeNoise(R), n2a = makeNoise(R), n2b = makeNoise(R);
      const s1 = PT.noiseScale, s2 = PT.basinScale, s3 = PT.basinScale / 2;
      ridgeNoise = function (x, y) { return n1(x / s1, y / s1); };
      basinNoise = function (x, y) { return n2a(x / s2, y / s2) + BASIN_OCTAVE2 * n2b(x / s3 + 7.3, y / s3 + 3.1); };
    }
    // The raw basin field is z-normalized over the backswamp (d > 22, north of the south belt, not the lake) so the
    // Marsh/Wet split does not drift with the per-seed mean of a field that spans only ~3 lattice cells (§3.3 distribution).
    const basinRaw = new Float32Array(N);
    {
      let sum = 0, sum2 = 0, cnt = 0;
      for (let ty = 0; ty < H; ty++) {
        const bank = bankRow[ty];
        for (let tx = 0; tx < W; tx++) {
          if (tx > bank || bank - tx <= PT.ridgeD) continue;
          const v = basinNoise(tx, ty);
          basinRaw[ty * W + tx] = finite(v) ? v : 0;
          const lx = (tx - lake.cx) / lake.rx, ly = (ty - lake.cy) / lake.ry;
          if (ty < PT.southBeltRow && lx * lx + ly * ly > 1) { sum += basinRaw[ty * W + tx]; sum2 += basinRaw[ty * W + tx] * basinRaw[ty * W + tx]; cnt++; }
        }
      }
      const mean = cnt ? sum / cnt : 0, sd = cnt ? Math.sqrt(Math.max(1e-9, sum2 / cnt - mean * mean)) : 1;
      for (let k = 0; k < N; k++) basinRaw[k] = BASIN_NOISE_GAIN * (basinRaw[k] - mean) / sd;
    }

    // --- steps 1–3: river, ridge, basin, lake ---
    for (let ty = 0; ty < H; ty++) {
      const bank = bankRow[ty];
      for (let tx = 0; tx < W; tx++) {
        const i = ty * W + tx;
        if (tx > bank) { elev[i] = PT.riverElev; flags[i] = F.OPEN_WATER; continue; }
        const d = bank - tx;
        let e;
        if (d <= PT.ridgeD) {
          e = ridgeProfile(ty, d) + (inRect(tx, ty) ? PT.noiseAmpPlot : PT.noiseAmp) * ridgeNoise(tx, ty);
        } else {
          e = clamp(PT.basinBase + PT.basinAmp * basinRaw[i] + (ty < BASIN_LIFT_ROWS ? BASIN_NORTH_LIFT * (1 - ty / BASIN_LIFT_ROWS) : 0), 0, PT.basinClamp);
          if (ty >= PT.southBeltRow) e = Math.max(0, e - PT.southBeltBias);
          const lx = (tx - lake.cx) / lake.rx, ly = (ty - lake.cy) / lake.ry;
          const lr2 = lx * lx + ly * ly;
          if (lr2 <= 1) { elev[i] = lake.elev; flags[i] = F.OPEN_WATER; lakeTiles.push(i); continue; }
          const bx = (tx - lake.cx) / (lake.rx * LAKE_BOWL_RX), byy = (ty - lake.cy) / (lake.ry * LAKE_BOWL_RY);
          const br = Math.sqrt(bx * bx + byy * byy);
          if (br < 1) e = Math.max(0, e - LAKE_BOWL_FT * (1 - br));
        }
        elev[i] = finite(e) ? clamp(e, ELEV_MIN, ELEV_MAX) : 0;
      }
    }

    // --- step 3b: the cove ---
    const cove = PT.cove;
    const ccx = bankRow[cove.ty] + cove.dx, ccy = cove.ty;
    const coveTiles = [], protectedMask = new Uint8Array(N);
    const scratch = [];
    ellipseTiles(ccx, ccy, cove.rx, cove.ry, 0, scratch);
    for (let k = 0; k < scratch.length; k++) { const e = scratch[k]; elev[e.i] = cove.floor + cove.rimAdd * e.r * e.r; coveTiles.push(e.i); protectedMask[e.i] = 1; }
    coveTiles.sort(function (a, b) { return a - b; });
    const ringTiles = [];
    for (let k = 0; k < coveTiles.length; k++) {
      const nb = BSU.nbr8(coveTiles[k]);
      for (let q = 0; q < nb.length; q++) { const n = nb[q]; if (!protectedMask[n] && !(flags[n] & F.OPEN_WATER)) { protectedMask[n] = 2; ringTiles.push(n); } }
    }
    ringTiles.sort(function (a, b) { return a - b; });
    for (let k = 0; k < ringTiles.length; k++) { const n = ringTiles[k]; if (elev[n] < cove.rimMin) elev[n] = cove.rimMin; }
    // the mouth: the ring tile nearest (cx−2, cy+2) and its two nearest ring neighbours
    const mx = ccx + cove.mouthDx, my = ccy + cove.mouthDy;
    const dist2 = function (i) { const dx = (i & 63) - mx, dy = (i >> 6) - my; return dx * dx + dy * dy; };
    let mid = -1, midD = Infinity;
    for (let k = 0; k < ringTiles.length; k++) { const d = dist2(ringTiles[k]); if (d < midD) { midD = d; mid = ringTiles[k]; } }
    const lips = [];
    if (mid >= 0) {
      const nb = BSU.nbr8(mid).filter(function (n) { return protectedMask[n] === 2; });
      nb.sort(function (a, b) { return (dist2(a) - dist2(b)) || (a - b); });
      for (let k = 0; k < nb.length && lips.length < 2; k++) lips.push(nb[k]);
    }
    const mouth = lips.length === 2 ? [Math.min(lips[0], lips[1]), mid, Math.max(lips[0], lips[1])] : (mid >= 0 ? [mid] : []);
    for (let k = 0; k < mouth.length; k++) elev[mouth[k]] = cove.mouthElev;
    if (mouth.length !== 3) return { ok: false, why: 'mouth' };

    // --- step 4: the bayou spline ---
    const by = PT.bayou;
    const mouthX = mouth[1] & 63, mouthY = mouth[1] >> 6;
    const x0 = tpl ? tpl.bayouX0 : by.x0 + R.int(2 * by.spread + 1) - by.spread;
    const ctl = [[x0, 0], [mouthX + cove.mouthDx, mouthY + cove.mouthDy]];
    if (tpl) { for (let k = 0; k < tpl.controls.length; k++) ctl.push([tpl.controls[k][0], tpl.controls[k][1]]); }
    else {
      for (let k = 0; k < by.controlPoints; k++) {
        const band = BAYOU_CTRL[Math.min(k, BAYOU_CTRL.length - 1)];
        const cy = band.y[0] + R.int(band.y[1] - band.y[0] + 1);
        const maxX = Math.min(band.x[1], M.bank(cy) - by.controlMaxD);
        const minX = Math.min(band.x[0], maxX);
        ctl.push([minX + R.int(maxX - minX + 1), cy]);
      }
    }
    ctl.push([lake.cx, lake.cy]);
    // Catmull-Rom sampling, carved as a disk of radius width/2 around each sample
    const bayouOrder = [], bayouMask = new Uint8Array(N);
    const radius = by.width / 2, r2max = radius * radius + 1e-9;
    const inLake = function (x, y) { const lx = (x - lake.cx) / lake.rx, ly = (y - lake.cy) / lake.ry; return lx * lx + ly * ly <= 1; };
    let g8ok = true;
    for (let seg = 0; seg + 1 < ctl.length && g8ok; seg++) {
      const p0 = ctl[Math.max(0, seg - 1)], p1 = ctl[seg], p2 = ctl[seg + 1], p3 = ctl[Math.min(ctl.length - 1, seg + 2)];
      const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(8, Math.ceil(chord * BAYOU_SAMPLES_PER_TILE));
      for (let s = 0; s <= steps; s++) {
        const u = s / steps, u2 = u * u, u3 = u2 * u;
        const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3);
        const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
        if (inLake(x, y)) { seg = ctl.length; break; }
        for (let ty = Math.max(0, Math.floor(y - radius)); ty <= Math.min(H - 1, Math.ceil(y + radius)); ty++) {
          for (let tx = Math.max(0, Math.floor(x - radius)); tx <= Math.min(W - 1, Math.ceil(x + radius)); tx++) {
            const dx = tx - x, dy = ty - y;
            if (dx * dx + dy * dy > r2max) continue;
            const i = ty * W + tx;
            if (bayouMask[i] || protectedMask[i] || (flags[i] & F.OPEN_WATER)) continue;
            if (elev[i] >= by.maxElev) { g8ok = false; break; }
            bayouMask[i] = 1; bayouOrder.push(i);
            elev[i] = by.elev; flags[i] = F.BAYOU;
          }
          if (!g8ok) break;
        }
        if (!g8ok) break;
      }
    }
    if (!g8ok) return { ok: false, why: 'G8:carve' };
    if (bayouOrder.length < 40) return { ok: false, why: 'bayou:short' };
    // 1-tile Marsh shoulders at 0.5 ft
    const shoulderMask = new Uint8Array(N);
    for (let k = 0; k < bayouOrder.length; k++) {
      const nb = BSU.nbr8(bayouOrder[k]);
      for (let q = 0; q < nb.length; q++) { const n = nb[q]; if (!bayouMask[n] && !protectedMask[n] && !(flags[n] & F.OPEN_WATER)) { shoulderMask[n] = 1; elev[n] = by.shoulderElev; } }
    }
    const bayouX = new Int32Array(H).fill(-1);
    for (let k = 0; k < bayouOrder.length; k++) { const i = bayouOrder[k], tx = i & 63, ty = i >> 6; if (bayouX[ty] < 0 || tx < bayouX[ty]) bayouX[ty] = tx; }
    // landing and its shoulder
    let landing = -1, landD = Infinity;
    for (let k = 0; k < bayouOrder.length; k++) { const i = bayouOrder[k]; const d = BSU.chebyshev(i & 63, i >> 6, mouthX, mouthY); if (d < landD) { landD = d; landing = i; } }
    let landingShoulder = -1, lsD = Infinity;
    if (landing >= 0) {
      const nb = BSU.nbr8(landing);
      for (let pass = 0; pass < 2 && landingShoulder < 0; pass++) {
        for (let q = 0; q < nb.length; q++) {
          const n = nb[q];
          if (bayouMask[n] || (flags[n] & F.OPEN_WATER)) continue;
          if (pass === 0 && !shoulderMask[n]) continue;
          const d = BSU.chebyshev(n & 63, n >> 6, mouthX, mouthY);
          if (d < lsD || (d === lsD && n < landingShoulder)) { lsD = d; landingShoulder = n; }
        }
      }
    }
    if (landing < 0 || landingShoulder < 0) return { ok: false, why: 'landing' };

    // --- step 5: cheniers ---
    const ch = PT.chenierAxes, angMax = ch.angle * Math.PI / 180;
    const occupied = new Uint8Array(N);
    const cheniers = [];
    const apronX = lake.cx + lake.rx + 1, apronY = lake.cy - lake.ry * LAKE_BOWL_RY;
    // a candidate ellipse must sit ≥ bayouGap west of the bayou, off the lake apron, off water/shoulders/the cove, and may
    // overlap earlier cheniers (they merge into ridge complexes) by at most CHENIER_OVERLAP of its tiles
    const chenierOk = function (tiles) {
      let overlap = 0;
      for (let k = 0; k < tiles.length; k++) {
        const i = tiles[k].i, tx = i & 63, ty = i >> 6;
        if (bayouX[ty] < 0 || tx > bayouX[ty] - ch.bayouGap) return false;
        if (tx <= apronX && ty >= apronY) return false;   // the lake's marsh apron (the bowl rows west of the lake) stays chenier-free (G6)
        if (bayouMask[i] || shoulderMask[i] || protectedMask[i] || (flags[i] & F.OPEN_WATER)) return false;
        if (occupied[i]) overlap++;
      }
      return overlap <= CHENIER_OVERLAP * tiles.length;
    };
    const applyChenier = function (cx, cy, a, b, angle, crest, tiles) {
      const list = [];
      for (let k = 0; k < tiles.length; k++) {
        const e = tiles[k], profile = ch.rim + (crest - ch.rim) * Math.cos(Math.PI / 2 * Math.pow(e.r, CHENIER_PLATEAU));
        if (profile > elev[e.i]) elev[e.i] = profile;
        list.push(e.i);
        const nb = BSU.nbr8(e.i);
        occupied[e.i] = 1;
        for (let q = 0; q < nb.length; q++) occupied[nb[q]] = 1;
      }
      list.sort(function (p, q) { return p - q; });
      cheniers.push({ cx: cx, cy: cy, tiles: list, crest: crest, angle: angle, a: a, b: b });
    };
    if (tpl) {
      for (let k = 0; k < tpl.cheniers.length; k++) {
        const c = tpl.cheniers[k];
        ellipseTiles(c.cx, c.cy, c.a, c.b, c.angle, scratch);
        if (chenierOk(scratch)) applyChenier(c.cx, c.cy, c.a, c.b, c.angle, c.crest, scratch);
      }
    } else {
      const want = PT.chenierCount[0] + R.int(PT.chenierCount[1] - PT.chenierCount[0] + 1);
      // the expansion chenier (G5): the largest, centred near the plot, as far east as the bayou allows
      {
        const a = ch.ax[1], b = ch.ay[1], crest = ch.crest[1];
        const angle = (R.float() * 2 - 1) * angMax;
        const cy = CHENIER_NEAR_ROWS[0] + R.int(CHENIER_NEAR_ROWS[1] - CHENIER_NEAR_ROWS[0] + 1);
        for (let cx = 44; cx >= 8; cx--) {
          ellipseTiles(cx, cy, a, b, angle, scratch);
          if (chenierOk(scratch)) { applyChenier(cx, cy, a, b, angle, crest, scratch); break; }
        }
      }
      // the widest centre column an ellipse of half-width `a` can take in rows y0..y1 and still sit ≥ gap west of the bayou
      const maxCenterX = function (y0, y1, a) {
        let mx = W;
        for (let ty = Math.max(0, y0); ty <= Math.min(H - 1, y1); ty++) { if (bayouX[ty] < 0) return -1; const lim = bayouX[ty] - ch.bayouGap - a; if (lim < mx) mx = lim; }
        return Math.floor(mx);
      };
      let lastBayouRow = 0;
      for (let ty = 0; ty < H; ty++) if (bayouX[ty] >= 0) lastBayouRow = ty;
      const placeRandom = function () {
        for (let tries = 0; tries < CHENIER_TRIES; tries++) {
          // axes drawn within [ax], [ay] with a skew toward the large end (sqrt of a uniform draw)
          const a = ch.ax[0] + (ch.ax[1] - ch.ax[0]) * Math.sqrt(R.float()), b = ch.ay[0] + (ch.ay[1] - ch.ay[0]) * Math.sqrt(R.float());
          const angle = (R.float() * 2 - 1) * angMax, crest = R.range(ch.crest[0], ch.crest[1]);
          const reach = Math.ceil(Math.max(a, b));
          const cy = reach + R.int(Math.max(1, lastBayouRow - 2 * reach + 1));
          const minX = (cy + reach >= apronY ? apronX + 1 : 0) + reach, maxX = maxCenterX(cy - reach, cy + reach, reach);
          if (maxX < minX) continue;
          const cx = minX + R.int(maxX - minX + 1);
          ellipseTiles(cx, cy, a, b, angle, scratch);
          if (chenierOk(scratch)) { applyChenier(cx, cy, a, b, angle, crest, scratch); return true; }
        }
        return false;
      };
      while (cheniers.length < want) { if (!placeRandom()) break; }
      // top up to the maximum count while the chenier or map-wide Dry/High totals are short of G7 (with a noise margin)
      const chenierDryHigh = function () { let n = 0; for (let k = 0; k < cheniers.length; k++) { const tl = cheniers[k].tiles; for (let q = 0; q < tl.length; q++) if (elev[tl[q]] >= PT.typeBounds.wet) n++; } return n; };
      const mapDryHigh = function () { let n = 0; for (let k = 0; k < N; k++) if (elev[k] >= PT.typeBounds.wet && !(flags[k] & WATER_FLAGS)) n++; return n; };
      while (cheniers.length < PT.chenierCount[1] && (chenierDryHigh() < PT.g7Chenier + 20 || mapDryHigh() < PT.g7MapWide + 30)) { if (!placeRandom()) break; }
    }
    if (cheniers.length < PT.chenierCount[0]) return { ok: false, why: 'cheniers:' + cheniers.length };
    // the Mounds on the largest chenier
    let big = 0;
    for (let k = 1; k < cheniers.length; k++) if (cheniers[k].tiles.length > cheniers[big].tiles.length) big = k;
    const bc = cheniers[big];
    const gap = PT.moundGap[0] + (tpl ? 1 : R.int(PT.moundGap[1] - PT.moundGap[0] + 1));
    const ux = Math.cos(bc.angle), uy = Math.sin(bc.angle);
    const mounds = [];
    for (let s = -1; s <= 1; s += 2) {
      const mtx = Math.round(bc.cx + s * (gap / 2) * ux), mty = Math.round(bc.cy + s * (gap / 2) * uy);
      const mi = BSU.inBounds(mtx, mty) ? mty * W + mtx : -1;
      if (mi < 0 || bc.tiles.indexOf(mi) < 0 || mounds.indexOf(mi) >= 0) return { ok: false, why: 'mounds' };
      mounds.push(mi);
    }
    for (let k = 0; k < mounds.length; k++) { elev[mounds[k]] = bc.crest + PT.moundLift; flags[mounds[k]] |= F.MOUND; }
    plot.cheniers = cheniers.map(function (c) { return { cx: c.cx, cy: c.cy, tiles: c.tiles }; });

    // --- plot bookkeeping needed by the guarantees ---
    plot.bank0 = bank0;
    plot.rect = rect;
    plot.founders = { tx: bank0 + PT.founders.dx, ty: PT.founders.ty };
    plot.cove = coveTiles;
    plot.mouth = mouth;
    plot.landing = landing;
    plot.landingShoulder = landingShoulder;
    plot.mounds = mounds;
    plot.bayou = bayouOrder;
    plot.lake = lakeTiles;
    plot.template = !!tpl;

    // --- step 7: Highway 1 stub and the oaks (surfaces before the G1b reachability and the veg exclusions) ---
    const hwx = bank0 + PT.founders.dx + 2;
    plot.highway = [];
    for (let ty = 0; ty < PT.highwayTiles; ty++) { const i = ty * W + hwx; t.surface[i] = SURF.ROAD; plot.highway.push(i); }
    plot.oaks = [];
    for (let k = 0; k < PT.oaks.length; k++) {
      const otx = bank0 + PT.oaks[k][0], oty = PT.oaks[k][1];
      plot.oaks.push(oty * W + otx);
      state.veg.push({ type: 'oak', tx: otx, ty: oty, stage: 2, plantedDay: 0, planted: false });
    }

    // --- G1b: lower stray ≥ 5-ft tiles until the reachable count fits the window ---
    for (let k = 0; k < N; k++) t.type[k] = typeOf(elev[k], flags[k]);
    invalidate();
    let rc = buildReach(state);
    if (rc.high5 > PT.g1b[1]) {
      for (let k = 0; k < N; k++) { const ty = k >> 6; if (rc.reach[k] && elev[k] >= PT.crownElev && (ty < PT.shoulderRows[0] || ty > PT.shoulderRows[1])) elev[k] = PT.crownElev - 0.1; }
      invalidate(); rc = buildReach(state);
      if (rc.high5 > PT.g1b[1]) {
        for (let k = 0; k < N; k++) {
          const tx = k & 63, ty = k >> 6;
          if (rc.reach[k] && elev[k] >= PT.crownElev && (ty === PT.shoulderRows[0] || ty === PT.shoulderRows[1]) && (bankRow[ty] - tx) >= 9) elev[k] = PT.crownElev - 0.1;
        }
        invalidate(); rc = buildReach(state);
      }
    }

    // --- classification, wetland flag, initial water, walk grid ---
    for (let k = 0; k < N; k++) { const ty = typeOf(elev[k], flags[k]); t.type[k] = ty; if (ty === T.MARSH) flags[k] |= F.WETLAND_ORIGINAL; }
    seedInitial(state);
    M.rewalk(state);
    invalidate();

    // --- step 6: vegetation entities ---
    const exclude = new Uint8Array(N);
    for (let ty = rect.y0; ty <= rect.y1; ty++) for (let tx = rect.x0; tx <= rect.x1; tx++) exclude[ty * W + tx] = 1;
    for (let k = 0; k < plot.highway.length; k++) exclude[plot.highway[k]] = 1;
    for (let k = 0; k < coveTiles.length; k++) exclude[coveTiles[k]] = 1;
    for (let k = 0; k < mouth.length; k++) exclude[mouth[k]] = 1;
    for (let k = 0; k < mounds.length; k++) exclude[mounds[k]] = 1;
    exclude[landingShoulder] = 1;
    const V = tpl ? hashDraws(0x7E6) : R;
    const veg = PT.veg;
    for (let i = 0; i < N; i++) {
      if (exclude[i]) continue;
      const ty = t.type[i];
      if (ty === T.OPEN_WATER || ty === T.BAYOU) continue;
      const tx = i & 63, row = i >> 6;
      if (ty === T.DRY || ty === T.HIGH) { if (V.chance(veg.oak)) state.veg.push({ type: 'oak', tx: tx, ty: row, stage: 2, plantedDay: 0, planted: false }); continue; }
      let edge = false;
      if (ty !== T.MARSH && ty !== T.WET) { const nb = BSU.nbr8(i); for (let q = 0; q < nb.length; q++) if (flags[nb[q]] & WATER_FLAGS) { edge = true; break; } }
      if (ty === T.MARSH || ty === T.WET || edge) { if (V.chance(veg.cypress)) { state.veg.push({ type: 'cypress', tx: tx, ty: row, stage: 2, plantedDay: 0, planted: false }); continue; } }
      if (ty === T.WET && V.chance(veg.palmetto)) state.veg.push({ type: 'palmetto', tx: tx, ty: row, stage: 2, plantedDay: 0, planted: false });
    }

    const g = M.guarantees(state);
    return { ok: g.ok, why: g.failed.join(',') };
  }

  /** internal: one generation attempt (exported for the unit test's failure tallies; not part of the module API) */
  M._attempt = attempt;

  /** §3.3 initial depth/sat/stand through hydro.seedInitial when it exists, else the same rule locally */
  function seedInitial(state) {
    const hy = hydro();
    if (hy && typeof hy.seedInitial === 'function') { try { hy.seedInitial(state); return; } catch (e) { fail('seedInitial', e); } }
    localSeedInitial(state);
  }
  /** the §3.3 initial state without hydro (marsh 0.15–0.40 ft from a tile hash, sat 0.9; water depth = 0 − elev; land sat 0.5) */
  function localSeedInitial(state) {
    const t = state.tiles, ini = PH.initial;
    for (let i = 0; i < N; i++) {
      const ty = t.type[i];
      t.stand[i] = 0;
      if (ty === T.MARSH) { t.depth[i] = ini.marshDepthMin + ini.marshDepthNoise * (BSU.rng.hash(i, 0x3A5) / 4294967296); t.sat[i] = ini.marshSat; }
      else if (ty === T.OPEN_WATER || ty === T.BAYOU) { t.depth[i] = Math.max(0, 0 - t.elev[i]); t.sat[i] = 1; }
      else { t.depth[i] = 0; t.sat[i] = ini.landSat; }
    }
  }

  /** fill the map from `seed`: attempt 0 on rng.world, then up to maxRerolls derived re-rolls, then the template */
  M.gen = function (state, seed) {
    try {
      if (!state || !state.tiles) { fail('gen', new Error('no state')); return; }
      seed = finite(seed) ? (seed >>> 0) : 0;
      BSU.rng.world.state = seed;
      let ok = false, why = '';
      for (let k = 0; k <= PT.maxRerolls && !ok; k++) {
        const R = k === 0 ? BSU.rng.world : BSU.rng.derive('reroll', k);
        const r = attempt(state, R, null);
        ok = r.ok; why = r.why;
      }
      if (!ok) {
        const r = attempt(state, null, M.template());
        state.plot.template = true;
        if (!r.ok) fail('gen', new Error('template map failed guarantees: ' + r.why + ' (last random failure: ' + why + ')'));
      }
      invalidate();
    } catch (e) { fail('gen', e); }
  };

  // ---------------------------------------------------------------------------
  // Guarantees G1–G8 and the distribution (GDD §3.5, §3.3)
  // ---------------------------------------------------------------------------
  const CHUNK_SCRATCH = new Uint8Array(N), Q_SCRATCH = new Int32Array(N), D_SCRATCH = new Int32Array(N);
  /** G1–G8 + distribution on the current state; {ok, failed: string[]} (pure over state) */
  M.guarantees = function (state) {
    const failed = [];
    try {
      const t = state.tiles, elev = t.elev, type = t.type, flags = t.flags, plot = state.plot;
      const r = plot.rect;
      const isDH = function (k) { return (type[k] === T.DRY || type[k] === T.HIGH) && !(flags[k] & F.MOUND); };
      // G1
      let g1 = true;
      for (let ty = r.y0; ty <= r.y1 && g1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) { const k = ty * W + tx; if (!BSU.inBounds(tx, ty) || elev[k] < PT.crownElev || !isDH(k)) { g1 = false; break; } }
      for (let ty = r.y0; ty + 2 <= r.y1 && g1; ty++) for (let tx = r.x0; tx + 2 <= r.x1; tx++) {
        let lo = Infinity, hi = -Infinity;
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) { const e = elev[(ty + dy) * W + tx + dx]; if (e < lo) lo = e; if (e > hi) hi = e; }
        if (hi - lo > PT.g1Window) { g1 = false; break; }
      }
      if (!g1) failed.push('G1');
      // G1b + G7 reachable
      const rc = buildReach(state);
      if (rc.high5 < PT.g1b[0] || rc.high5 > PT.g1b[1]) failed.push('G1b:' + rc.high5);
      let reachDH = 0;
      for (let k = 0; k < N; k++) if (rc.reach[k]) reachDH++;
      if (reachDH < PT.g7[0] || reachDH > PT.g7[1]) failed.push('G7:reach:' + reachDH);
      // G2
      const cove = plot.cove || [], mouth = plot.mouth || [];
      const coveMask = CHUNK_SCRATCH; coveMask.fill(0);
      let g2 = cove.length >= PT.g2Tiles[0] && cove.length <= PT.g2Tiles[1] && mouth.length === 3;
      for (let k = 0; k < cove.length && g2; k++) { const i = cove[k]; if (!validI(i)) { g2 = false; break; } coveMask[i] = 1; if (elev[i] < PT.cove.floor - 1e-4 || elev[i] > PT.cove.floor + PT.cove.rimAdd + 1e-4) g2 = false; }
      if (g2 && cove.length) {   // contiguity
        let head = 0, tail = 0; Q_SCRATCH[tail++] = cove[0]; coveMask[cove[0]] = 2;
        while (head < tail) { const nb = BSU.nbr4(Q_SCRATCH[head++]); for (let q = 0; q < nb.length; q++) if (coveMask[nb[q]] === 1) { coveMask[nb[q]] = 2; Q_SCRATCH[tail++] = nb[q]; } }
        if (tail !== cove.length) g2 = false;
      }
      let rimHigh = false;
      if (g2) {
        const mouthSet = {};
        for (let k = 0; k < mouth.length; k++) { mouthSet[mouth[k]] = 1; if (!validI(mouth[k]) || Math.abs(elev[mouth[k]] - PT.cove.mouthElev) > 1e-3) g2 = false; }
        for (let k = 0; k < cove.length && g2; k++) {
          const nb = BSU.nbr8(cove[k]);
          for (let q = 0; q < nb.length; q++) { const n = nb[q]; if (coveMask[n]) continue; if (elev[n] >= PT.crownElev) rimHigh = true; if (!mouthSet[n] && elev[n] < PT.cove.rimMin - 1e-4 && !(flags[n] & WATER_FLAGS)) { g2 = false; break; } }
        }
      }
      if (!g2) failed.push('G2');
      else if (!rimHigh) failed.push('G2:rim');
      // G3
      const front = plot.founders ? BSU.idx(plot.founders.tx + 1, plot.founders.ty + 3) : -1;
      const route = (front >= 0 && plot.landingShoulder >= 0) ? M.landRoute(state, front, plot.landingShoulder) : null;
      if (!route) failed.push('G3:none');
      else {
        let crossings = 0;
        for (let k = 0; k < route.length; k++) if (coveMask[route[k]]) crossings++;
        if (route.length - 1 > PT.g3Route || crossings < PT.g3CoveTiles) failed.push('G3:' + (route.length - 1) + '/' + crossings);
      }
      // G4
      let g4 = false;
      if (cove.length) {
        let low = cove[0];
        for (let k = 1; k < cove.length; k++) if (elev[cove[k]] < elev[low]) low = cove[k];
        const dist = D_SCRATCH; dist.fill(-1);
        let head = 0, tail = 0; dist[low] = 0; Q_SCRATCH[tail++] = low;
        while (head < tail && !g4) {
          const cur = Q_SCRATCH[head++];
          const nb = BSU.nbr4(cur);
          for (let q = 0; q < nb.length; q++) {
            const n = nb[q];
            if (type[n] === T.BAYOU) { g4 = dist[cur] <= PT.g4Dist; if (g4) break; continue; }
            if (dist[n] >= 0 || dist[cur] + 1 > PT.g4Dist) continue;
            if (type[n] === T.OPEN_WATER || type[n] === T.POND || elev[n] > PT.typeBounds.wet) continue;
            dist[n] = dist[cur] + 1; Q_SCRATCH[tail++] = n;
          }
        }
      }
      if (!g4) failed.push('G4');
      // G5 + chenier totals: label Dry/High components (excluding mounds)
      const comp = D_SCRATCH; comp.fill(-1);
      const compSize = [];
      for (let i = 0; i < N; i++) {
        if (comp[i] >= 0 || !isDH(i)) continue;
        const id = compSize.length; let size = 0, head = 0, tail = 0;
        comp[i] = id; Q_SCRATCH[tail++] = i;
        while (head < tail) { const cur = Q_SCRATCH[head++]; size++; const nb = BSU.nbr4(cur); for (let q = 0; q < nb.length; q++) { const n = nb[q]; if (comp[n] < 0 && isDH(n)) { comp[n] = id; Q_SCRATCH[tail++] = n; } } }
        compSize.push(size);
      }
      let g5 = false, chenierDH = 0;
      const chs = plot.cheniers || [];
      for (let c = 0; c < chs.length; c++) {
        const tiles = chs[c].tiles || [];
        let near = false, best = 0, reachable = false;
        const seenComp = {};
        for (let k = 0; k < tiles.length; k++) {
          const i = tiles[k];
          if (!validI(i)) continue;
          if (isDH(i)) chenierDH++;
          if (rc.reach[i]) reachable = true;
          const tx = i & 63, ty = i >> 6;
          if (!near) { const dx = tx < r.x0 ? r.x0 - tx : tx > r.x1 ? tx - r.x1 : 0, dy = ty < r.y0 ? r.y0 - ty : ty > r.y1 ? ty - r.y1 : 0; if (Math.max(dx, dy) <= PT.g5Radius) near = true; }
          const id = comp[i];
          if (id >= 0 && !seenComp[id]) { seenComp[id] = 1; if (compSize[id] > best) best = compSize[id]; }
        }
        if (near && !reachable && best >= PT.g5Tiles) g5 = true;
      }
      if (!g5) failed.push('G5');
      // G6
      let cols = 0, good = 0;
      for (let tx = 0; tx <= plot.bank0 - PT.g6ColOffset && tx < W; tx++) {
        cols++;
        let run = 0, best = 0;
        for (let ty = PT.g6Row; ty < H; ty++) { if (type[ty * W + tx] === T.MARSH) { run++; if (run > best) best = run; } else run = 0; }
        if (best >= PT.g6Run) good++;
      }
      if (cols === 0 || good < PT.g6Share * cols) failed.push('G6:' + good + '/' + cols);
      // G7 totals + distribution
      const counts = new Int32Array(8);
      for (let k = 0; k < N; k++) counts[type[k]]++;
      const dh = counts[T.DRY] + counts[T.HIGH] - (plot.mounds ? plot.mounds.length : 0);
      if (dh < PT.g7MapWide) failed.push('G7:dh:' + dh);
      if (chenierDH < PT.g7Chenier) failed.push('G7:chenier:' + chenierDH);
      if (counts[T.MARSH] < PT.g7Marsh) failed.push('G7:marsh:' + counts[T.MARSH]);
      // G8
      const bay = plot.bayou || [];
      let g8 = bay.length > 0 && plot.landing >= 0 && mouth.length === 3;
      for (let k = 0; k < bay.length && g8; k++) { const i = bay[k]; if (!validI(i) || !(flags[i] & F.BAYOU) || elev[i] >= PT.crownElev) g8 = false; }
      if (g8 && BSU.chebyshev(plot.landing & 63, plot.landing >> 6, mouth[1] & 63, mouth[1] >> 6) > 2) g8 = false;
      if (!g8) failed.push('G8');
      // distribution
      const dist = PT.distribution, tol = dist.tol;
      const share = function (n) { return n / N; };
      const check = function (name, n, target) { if (Math.abs(share(n) - target) > tol + 1e-9) failed.push('dist:' + name + ':' + (share(n) * 100).toFixed(1)); };
      check('water', counts[T.OPEN_WATER], dist.water);
      check('bayou', counts[T.BAYOU], dist.bayou);
      check('marsh', counts[T.MARSH] + counts[T.DRAINED], dist.marsh);
      check('wet', counts[T.WET], dist.wet);
      check('dry', counts[T.DRY], dist.dry);
      check('high', counts[T.HIGH], dist.high);
    } catch (e) { failed.push('threw:' + (e && e.message)); }
    return { ok: failed.length === 0, failed: failed };
  };

  // ---------------------------------------------------------------------------
  // selfTest (ARCHITECTURE §10.6, brief §6)
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const deps = M._deps;
    const saved = { emit: deps.emit, hydro: deps.hydro, buildings: deps.buildings, wildlife: deps.wildlife };
    const recorded = [];
    const stubHydro = {
      seedInitial: function (s) { localSeedInitial(s); },
      surfaceAt: function (s, i) { return s.tiles.elev[i] + s.tiles.depth[i]; },
      stageAt: function () { return 0; },
      drainsTo: function () { return 'ground'; },
      markLeveeChange: function () {}
    };
    const applied = [];
    const stubBuildings = { get: function (s, id) { return s.buildings[id] || null; }, list: function () { return []; }, applySubsidence: function (s, id, ft) { applied.push([id, ft]); } };
    const stubWildlife = { nutriaTraps: function () { return false; } };
    try {
      deps.emit = function (name, payload) { recorded.push({ name: name, payload: payload }); };
      deps.hydro = function () { return stubHydro; };
      deps.buildings = function () { return stubBuildings; };
      deps.wildlife = function () { return stubWildlife; };
      const A = BSU.assert;
      const t0 = Date.now();

      // 1. generation on seeds 1–3 passes the guarantees and the distribution
      const states = {};
      let anyRandom = false;
      for (let seed = 1; seed <= 3; seed++) {
        const s = BSU.newState(seed);
        const tg = Date.now();
        M.gen(s, seed);
        const g = M.guarantees(s);
        A(g.ok && g.failed.length === 0, 'seed ' + seed + ' guarantees: ' + g.failed.join(','));
        if (!s.plot.template) anyRandom = true;
        states[seed] = s;
        notes.push('seed ' + seed + (s.plot.template ? ' (template)' : '') + ' ' + (Date.now() - tg) + ' ms');
        if (seed === 2 && Date.now() - t0 > 120) { notes.push('seed 3 skipped (time)'); break; }
      }
      A(anyRandom, 'at least one seed generated without the template');
      // 2. determinism
      {
        const s2 = BSU.newState(2);
        M.gen(s2, 2);
        const a = states[2].tiles.elev, b = s2.tiles.elev;
        let same = true;
        for (let k = 0; k < N; k++) if (a[k] !== b[k]) { same = false; break; }
        A(same, 'gen is deterministic for seed 2');
      }
      // 3. classify table
      {
        A(typeOf(-0.5, 0) === T.MARSH && typeOf(1.49, 0) === T.MARSH && typeOf(1.5, 0) === T.WET && typeOf(3.49, 0) === T.WET, 'classify marsh/wet bounds');
        A(typeOf(3.5, 0) === T.DRY && typeOf(6.5, 0) === T.HIGH && typeOf(1.0, F.POND_SINK) === T.POND && typeOf(1.0, F.DRAINED) === T.DRAINED, 'classify dry/high/pond/drained');
        A(typeOf(-3, F.OPEN_WATER) === T.OPEN_WATER && typeOf(-1, F.BAYOU) === T.BAYOU, 'classify water flags');
      }
      // 4. walk classes on synthetic tiles
      {
        const s = BSU.newState(9);
        const tt = s.tiles;
        const set = function (i, o) { tt.elev[i] = o.elev; tt.flags[i] = o.flags || 0; tt.surface[i] = o.surface || 0; tt.depth[i] = o.depth || 0; tt.crest[i] = o.crest || 0; tt.owner[i] = o.owner === undefined ? -1 : o.owner; tt.type[i] = typeOf(tt.elev[i], tt.flags[i]); return M.walkClassOf(s, i); };
        A(set(0, { elev: 4, surface: 1 }) === 1, 'path on dry land → 1');
        A(set(1, { elev: 4, surface: 1, depth: 0.35 }) === 4, 'path with depth 0.35 → 4');
        A(set(2, { elev: 4, surface: 1, depth: 0.6 }) === 0, 'path with depth 0.6 → 0');
        A(set(3, { elev: 1.0 }) === 0, 'bare marsh → 0');
        A(set(4, { elev: 1.0, surface: 1 }) === 1, 'marsh + path → 1');
        A(set(5, { elev: 1.0, flags: F.CANAL }) === 0, 'bare canal → 0');
        A(set(6, { elev: 1.0, flags: F.CANAL, surface: 2 }) === 1, 'canal + road (culvert) → 1');
        A(set(7, { elev: -1, flags: F.BAYOU, surface: 3, depth: 1 }) === 1, 'boardwalk over bayou at stage 0 → 1');
        A(set(8, { elev: -1, flags: F.BAYOU, surface: 3, depth: 3.5 }) === 0, 'boardwalk 2.5 ft above stage → 0');
        A(set(9, { elev: 2, crest: 6 }) === 2, 'bare levee → 2');
        A(set(10, { elev: 2, surface: 4 }) === 3, 'fence on wet → 3');
        A(set(11, { elev: 4, owner: 0 }) === 0, 'owner ≥ 0 → 0');
        A(set(12, { elev: 4, flags: F.MOUND }) === 2, 'mound → 2');
        A(set(13, { elev: 5 }) === 2 && set(14, { elev: 5, depth: 0.4 }) === 4, 'dry → 2, wading → 4');
        s.buildings[1] = { id: 1, type: 'parking', tx: 0, ty: 0, w: 1, h: 1 };
        A(set(15, { elev: 4, owner: 1 }) === 2, 'parking footprint → 2');
      }
      // 5. touch emits one tile:changed with the chunk
      {
        const s = BSU.newState(9);
        const cases = [[0, 0, 0], [63, 63, 63], [8, 0, 1], [0, 8, 8]];
        for (let k = 0; k < cases.length; k++) {
          const c = cases[k]; recorded.length = 0;
          M.touch(s, BSU.idx(c[0], c[1]), 'decor');
          A(recorded.length === 1 && recorded[0].name === EV.TILE_CHANGED && recorded[0].payload.chunk === c[2] && recorded[0].payload.tx === c[0] && recorded[0].payload.ty === c[1], 'touch chunk (' + c[0] + ',' + c[1] + ') → ' + c[2]);
        }
      }
      // 6. subsidence
      {
        const s = BSU.newState(9);
        const tt = s.tiles;
        const iD = BSU.idx(20, 20), iH = BSU.idx(30, 30), iP = BSU.idx(40, 40);
        tt.elev[iD] = 1.0; tt.flags[iD] = F.DRAINED; tt.owner[iD] = 0;
        s.buildings[0] = { id: 0, type: 'dorm', tx: 20, ty: 20, w: 1, h: 1, pilings: false, built: 1 };
        tt.elev[iH] = 7.0;
        tt.elev[iP] = 2.0; tt.flags[iP] = F.PRESERVE;
        for (let k = 0; k < N; k++) tt.type[k] = typeOf(tt.elev[k], tt.flags[k]);
        s.plot.bayou = [1];   // mark as generated for tick()
        applied.length = 0;
        M.applySubsidenceYear(s);
        A(Math.abs(tt.elev[iD] - (1.0 - PS.drainedBuilt)) < 1e-6 && Math.abs(tt.subs[iD] - PS.drainedBuilt) < 1e-6, 'drained tile under a building sinks 0.35');
        A(tt.elev[iH] === 7.0 && tt.subs[iH] === 0, 'high tile unchanged');
        A(tt.elev[iP] === 2.0 && tt.subs[iP] === 0, 'preserve tile unchanged');
        A(applied.length === 1 && applied[0][0] === 0 && Math.abs(applied[0][1] - PS.drainedBuilt) < 1e-6, 'buildings.applySubsidence called once');
        A(M.subsidenceRate(s, BSU.idx(1, 1), false) === PS.wetBare, 'bare marsh rate = wet bare');
      }
      // 7. streetlamps
      {
        const s = BSU.newState(9);
        for (let x = 10; x < 22; x++) s.tiles.surface[BSU.idx(x, 30)] = SURF.ROAD;
        let lamps = M.streetlamps(s);
        A(lamps.length === 3 && lamps[0] === BSU.idx(10, 30) && lamps[1] === BSU.idx(14, 30) && lamps[2] === BSU.idx(18, 30), 'road lamps at 0,4,8');
        const s2 = BSU.newState(9);
        for (let x = 10; x < 23; x++) s2.tiles.surface[BSU.idx(x, 30)] = SURF.PATH;
        lamps = M.streetlamps(s2);
        A(lamps.length === 3 && lamps[0] === BSU.idx(10, 30) && lamps[1] === BSU.idx(16, 30) && lamps[2] === BSU.idx(22, 30), 'path lamps at 0,6,12');
      }
      // 8. parade route
      {
        const s = BSU.newState(9);
        for (let y = 5; y <= 10; y++) s.tiles.surface[BSU.idx(5, y)] = SURF.ROAD;
        for (let x = 6; x <= 9; x++) s.tiles.surface[BSU.idx(x, 10)] = SURF.ROAD;
        const route = M.paradeRoute(s);
        let ordered = route.length === 10;
        for (let k = 1; k < route.length && ordered; k++) { const a = route[k - 1], b = route[k]; if (Math.abs((a & 63) - (b & 63)) + Math.abs((a >> 6) - (b >> 6)) !== 1) ordered = false; }
        A(ordered && ((route[0] === BSU.idx(5, 5) && route[9] === BSU.idx(9, 10)) || (route[9] === BSU.idx(5, 5) && route[0] === BSU.idx(9, 10))), 'L-shaped road → 10 tiles in path order');
        const s2 = BSU.newState(9);
        for (let x = 20; x < 25; x++) s2.tiles.surface[BSU.idx(x, 3)] = SURF.PATH;
        A(M.paradeRoute(s2).length === 5, 'no roads → the 5-tile path');
        A(M.paradeRoute(BSU.newState(9)).length === 0, 'neither → []');
      }
      // 9. ridgeFull on seed 1
      {
        const s = states[1];
        A(M.ridgeFull(s, 3, 2) === null, 'ridgeFull null while ≥ 5-ft sites remain');
        const reach = M.reachableDryHigh(s);
        s.buildings[0] = { id: 0, type: 'dorm', tx: 0, ty: 0, w: 1, h: 1 };
        for (let k = 0; k < N; k++) if (reach[k] && s.tiles.elev[k] >= PT.crownElev) s.tiles.owner[k] = 0;
        invalidate();
        const rf = M.ridgeFull(s, 3, 2);
        A(rf !== null && (rf.floodsAt === 'Cat 2' || rf.floodsAt === 'rain') && BSU.inBounds(rf.tx, rf.ty), 'ridgeFull returns a fallback site once the crown is full');
        for (let k = 0; k < N; k++) if (s.tiles.owner[k] === 0) s.tiles.owner[k] = -1;
        s.buildings.length = 0;
        invalidate();
      }
      // 10. plot bookkeeping
      {
        const s = states[1];
        A(M.bank(PT.bank0Row) === s.plot.bank0 && BSU.bankAt(PT.bank0Row) === s.plot.bank0, 'bank(7) === plot.bank0');
        A(s.plot.highway.length === PT.highwayTiles && s.plot.mouth.length === 3 && s.plot.mounds.length === 2 && s.plot.oaks.length === 2, 'highway 7, mouth 3, mounds 2, oaks 2');
        A(s.plot.founders.tx === s.plot.bank0 + PT.founders.dx && s.plot.founders.ty === PT.founders.ty, 'founders origin');
        A(s.plot.landing >= 0 && s.plot.landingShoulder >= 0 && s.tiles.type[s.plot.landing] === T.BAYOU && s.tiles.type[s.plot.landingShoulder] === T.MARSH, 'landing on the bayou, shoulder on marsh');
        A(s.veg.length > 50 && s.veg.every(function (v) { return v.stage === 2 && v.planted === false; }), 'generated veg at stage 2');
        // daily work: wear hysteresis and veg growth through tick
        s.calendar.day = 1;
        const iw = s.plot.landingShoulder;
        s.tiles.wear[iw] = 45;
        const v = M.plantVeg(s, 'azalea', 1, 1);
        v.plantedDay = 0;
        s.calendar.day = 40;
        M.tick(s, { newDay: true, newMonth: false, newYear: false, day: 40 });
        A((s.tiles.flags[iw] & F.DESIRE_WORN) !== 0 && s.tiles.wear[iw] === 45 - PA.wearDecay, 'wear ≥ 40 sets DESIRE_WORN, then decays by params.agents.wearDecay');
        A(v.stage === 1, 'azalea grows to stage 1 after 30 days');
        A(M.removeVeg(s, 1, 1) === true && !s.veg.some(function (x) { return x.tx === 1 && x.ty === 1; }), 'removeVeg removes the planted azalea');
        let finiteAll = true;
        for (let k = 0; k < N && finiteAll; k++) if (!Number.isFinite(s.tiles.elev[k]) || !Number.isFinite(s.tiles.depth[k])) finiteAll = false;
        A(finiteAll, 'no NaN in elev/depth');
      }
      notes.push('total ' + (Date.now() - t0) + ' ms');
      return { ok: true, notes: notes.join('; ') };
    } catch (e) {
      return { ok: false, notes: (e && e.message) + ' | ' + notes.join('; ') };
    } finally {
      deps.emit = saved.emit; deps.hydro = saved.hydro; deps.buildings = saved.buildings; deps.wildlife = saved.wildlife;
      invalidate();
    }
  };
})();
