'use strict';
// ============================================================================
// BAYOU STATE — hydro.js (module 3; BSU.hydro)
// Owner of: tiles.depth, tiles.sat, tiles.stand; tiles.flags bits CANAL (2),
// DRAINED (3), FLOODGATE (4), POND_SINK (5), RESTORING (12), JAMMED (13);
// the state.hydro branch (riverStage, bayouStage, surge, barrierClosed,
// pondCap, heldStage, spillwayOffset + the unsaved caches networks/risk/active);
// tiles.integrity ONLY for overtopping (-10/day), surge contact (-5 x cat,
// once per storm/window) and breach (0); Building.flooded/floodedSince (D6).
// Implements: GDD §3.3 (initial state), §6.1 (all of 6.1.1–6.1.11), §6.2
// (surge front, surge heights, floodgates during a storm), §4.11 (Floodgate),
// §6.9 (stages, seepage helpers, Bonnet Roux Spillway), §0.1 (dtDay table);
// ARCHITECTURE.md §2.3, §5.1 step 3, §5.3, D6, D14, D37, D38, D46, D47, D48.
//
// The water is one cellular automaton over tiles.depth in feet, stepped at
// 4 Hz over an active set, with ONE head function used on both sides of every
// exchange (§6.1.4):  H(t) = elev + crest·integrityFactor + sandbag/10 + depth.
// Two Jacobi passes per step write demanded outflows into a back buffer from
// the current depth and apply them after the pass, so the order of tiles never
// matters. Open Water / Bayou tiles are boundaries reset to their stage after
// every pass (infinite sinks in normal play, infinite sources under surge).
//
// Decisions recorded in this file (see docs/INTEGRATION_NOTES.md '## hydro.js'):
//  - Marsh floor: an undisturbed original Marsh tile (WETLAND_ORIGINAL, not
//    DRAINED, no canal within 2) only drains the part of its depth above the
//    generated floor 0.15 ft, so the baked marsh look stays stable and the
//    5-day drained flip needs a canal or a pump (brief §4 "Standing-water
//    drain").
//  - Stability clamp: a demanded flow is never more than half the head
//    difference (the amount that equalizes both surfaces). With k = 0.35 the
//    GDD flow (diff/2 × k = 0.175·diff) is always below it; with the canal ×8
//    (1.4·diff) the raw formula over-corrects and oscillates, so the clamp is
//    what makes the ×8 conductance mean "equalizes as fast as a Jacobi pass
//    allows" instead of "rings".
//  - Overtopping EVENT source: a 4-neighbor j overtops levee tile i when the
//    surface of j is ≥ i's full static crest top (crest counted in full and
//    scaled by integrity, the open-gate rule ignored) and j is water or a
//    non-levee tile with depth > 0. Water standing on a neighbouring levee
//    crown (rain) never counts: two crowns are the same wall (ARCH §12.2 step
//    4 "the crest is in H on both sides").
//  - Rain footprint uses Chebyshev distance from the cell center (brief).
//  - Floodgate stage: the largest live stage (surge included) of any water
//    tile touching the gate's network; a landlocked network uses
//    max(riverStage, bayouStage) so a gate can still close in high water.
//  - Surge contact is reset per storm at surgeControl('begin') and per Spring
//    High Water window when setStages brings both stages back to 0.
//  - The prediction (F overlay) runs the same step code in a "quiet" mode on
//    scratch depth/sat buffers: no events, no integrity writes, no rewalk, a
//    scratch copy of pondCap and gate state, every tile active, no surge.
// Zero DOM / timer / audio access at definition time. No unseeded randomness.
// Hydro draws no rng stream at all (Marsh noise is a hash of the seed and the tile).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.hydro = BSU.hydro || {});
  const P = BSU.params.hydro;
  const PS = BSU.params.storm;
  const PW = BSU.params.weather;
  const T = BSU.T, F = BSU.FLAG, EV = BSU.EV;
  const W = 64, N = 4096;
  const UNREACH = 65535;

  // Constants the GDD names that params does not carry (noted in INTEGRATION_NOTES.md).
  const MARSH_FLOOR = P.initial.marshDepthMin;      // 0.15 ft: the generated marsh floor (GDD §3.3)
  const RESTORE_DAYS = BSU.params.build.restorationDays;   // 30 (GDD §0.3 row 42)
  const RELAX_KINDS = { game: 1, parade: 1, graduation: 1, montage: 1 };   // dtDay 0 → flow-only relaxation (GDD §0.1)
  const K1 = P.k / 2;                     // flow = (ΔH − loss)/2 × k
  const K8 = P.k * P.kCanal / 2;          // canal / culvert conductance
  const WATER_MASK = F.OPEN_WATER | F.BAYOU;
  const CLASS_BOUNDS = [P.thresholds.puddle, P.thresholds.wading, P.thresholds.flood, P.thresholds.impassable];   // 0.05 / 0.3 / 0.5 / 0.6

  // Injectable dependencies (§10.6, D49). null → the live BSU module at call time.
  M._deps = { emit: function (n, p) { BSU.events.emit(n, p); }, buildings: null, terrain: null, weather: null };
  const NOOP_B = { list: function () { return []; }, get: function () { return null; }, footprint: function () { return []; }, effective: function () { return 1; }, onIntegrityChanged: function () {}, dirtyRing: function () {}, has: function () { return false; } };
  const NOOP_T = { touch: function () {}, rewalk: function () {}, classify: function () {} };
  function buildingsApi() { return M._deps.buildings || BSU.buildings || NOOP_B; }
  function terrainApi() { return M._deps.terrain || BSU.terrain || NOOP_T; }
  function weatherApi() { return M._deps.weather || BSU.weather || null; }
  function emit(name, payload) { M._deps.emit(name, payload); }
  function fin(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

  // ---------------------------------------------------------------------------
  // The per-root context (D38): every closure array lives here and is rebuilt
  // whenever the root object changes (gen before reset, load, selfTest).
  // ---------------------------------------------------------------------------
  let C = null;

  function newCtx(state) {
    return {
      root: state,
      D: state.tiles.depth, S: state.tiles.sat,   // the arrays the step reads/writes (swapped for the prediction)
      quiet: false,
      back: new Float32Array(N),
      crestTop: new Float32Array(N),   // live head base: elev + crestEff + sandbag/10 (crest 0 on an open/jammed gate)
      crestEff: new Float32Array(N),   // crest × integrityFactor, 0 while an open gate
      overHead: new Float32Array(N),   // static crest top for the overtopping event (gate rule ignored)
      lossEff: new Float32Array(N),    // per-step head loss (ecology-scaled)
      lossTable: new Float32Array(N),  // 0 / 0.08 / 0.12 (+0.02 cypress)
      absorbFrac: new Float32Array(N),
      drainRate: new Float32Array(N),
      kMul: new Uint8Array(N),
      water: new Uint8Array(N),        // 1 OPEN_WATER, 2 BAYOU (boundary tiles)
      land: new Uint8Array(N),         // 1 = CA land (incl. POND)
      floorMarsh: new Uint8Array(N),   // 1 = undisturbed original marsh keeps its 0.15 floor
      cypressMask: new Uint8Array(N),
      canalNear: new Uint8Array(N),    // canal within Chebyshev 2
      pumpNear: new Uint8Array(N),     // powered pump within 8 (daily)
      blocked: new Uint8Array(N),      // 1 = closed floodgate / closed barrier tile (k = 0 across it)
      gateClosed: new Uint8Array(N),
      touched: new Uint8Array(N),
      active: new Uint8Array(N),
      nextActive: new Uint8Array(N),
      activeList: new Uint16Array(N),
      activeN: 0,
      depthClass: new Uint8Array(N),
      overtoppedToday: new Uint8Array(N),
      stormOvertopped: new Uint8Array(N),
      surgeContacted: new Uint8Array(N),
      dryDays: new Uint8Array(N),
      wetDays: new Uint8Array(N),
      restoreDays: new Uint8Array(N),
      mudDay: new Uint16Array(N),
      front: new Uint16Array(N),
      bfsQueue: new Uint16Array(N),
      bayouIndex: new Int16Array(N),
      tileNet: new Int16Array(N),
      tileDirty: new Uint8Array(N),
      anyTileDirty: false,
      cypressDirty: true,
      networksDirty: true,
      barrierDirty: true,
      networks: [],
      barrier: { id: -1, tiles: [], bayouTiles: [], index: -1 },
      pumpToday: {},
      pondScratch: null,               // pondCap copy used by the quiet prediction
      riskDepth: new Float32Array(N),
      riskSat: new Float32Array(N),
      riskOvertop: new Uint8Array(N),
      stormLog: { held: [], overtopped: [], breached: [] },
      lastDay: -1,
      stepCount: 0,
      lastLeak: 0, lastMoved: 0,
      pumped: 0, pondTaken: 0,
      forcedRain: null,
      surgeLastStage: 0, surgeReceding: false, surgeRecedeTick: 0, surgePeaked: false, surgeMaxReached: 0,
      riverAdj: { radius: -1, tiles: [] },
      pondNearScratch: new Uint16Array(256),
      pondTakenScratch: new Float32Array(256),
      fScratch: new Float32Array(4), nbScratch: new Uint16Array(4),
      passResult: { moved: 0, bndIn: 0, bndOut: 0 }
    };
  }

  /** Rebuild every table from the tree; cheap enough to run on any root change. */
  function rebuildAll(state) {
    const ctx = newCtx(state);
    C = ctx;
    lazyInit(state);
    const tiles = state.tiles;
    // bayou order (upstream = smaller index)
    ctx.bayouIndex.fill(-1);
    const bay = (state.plot && Array.isArray(state.plot.bayou)) ? state.plot.bayou : [];
    for (let k = 0; k < bay.length; k++) { const i = bay[k] | 0; if (i >= 0 && i < N) ctx.bayouIndex[i] = k; }
    rebuildCypress(state);
    refreshTables(state);        // water/land masks first: the network walk needs them
    rebuildNetworks(state);      // canalNear + networks, then every per-tile table again
    rebuildBarrier(state);
    // active set from depth + boundaries
    for (let i = 0; i < N; i++) {
      if (ctx.water[i] || tiles.depth[i] > P.activeDepth) mark5(ctx.nextActive, i);
      ctx.depthClass[i] = classOf(tiles.depth[i]);
    }
    swapActive(ctx);
    state.hydro.active = ctx.active;
    state.hydro.networks = ctx.networks;
    state.hydro.risk = null;
    // surge front from the saved entry (a pure function of entry, D47)
    ctx.front.fill(UNREACH);
    const sg = state.hydro.surge;
    if (sg && Array.isArray(sg.entry)) {
      bfsFront(ctx, sg.entry);
      ctx.surgeLastStage = fin(sg.stage, 0);
      ctx.surgePeaked = fin(sg.stage, 0) >= fin(sg.target, 0);
      ctx.surgeMaxReached = fin(sg.reached, 0) | 0;
    }
    ctx.lastDay = state.calendar ? fin(state.calendar.day, 0) : 0;
    evaluateGates(state, ctx, true);
    return ctx;
  }

  /** Lazily-initialized saved keys (contract.js is frozen; D48). */
  function lazyInit(state) {
    const h = state.hydro;
    if (typeof h.heldStage !== 'number' || !isFinite(h.heldStage)) h.heldStage = 0;
    if (typeof h.spillwayOffset !== 'number' || !isFinite(h.spillwayOffset)) h.spillwayOffset = 0;
    if (!h.pondCap || typeof h.pondCap !== 'object') h.pondCap = {};
    if (typeof h.riverStage !== 'number' || !isFinite(h.riverStage)) h.riverStage = 0;
    if (typeof h.bayouStage !== 'number' || !isFinite(h.bayouStage)) h.bayouStage = 0;
    if (typeof h.barrierClosed !== 'boolean') h.barrierClosed = !!h.barrierClosed;
  }

  function ensure(state) {
    if (!state || !state.tiles || !state.hydro) throw new Error('hydro: bad state');
    if (!C || C.root !== state) rebuildAll(state);
    return C;
  }

  function classOf(d) {
    if (d < CLASS_BOUNDS[0]) return 0;
    if (d < CLASS_BOUNDS[1]) return 1;
    if (d < CLASS_BOUNDS[2]) return 2;
    if (d < CLASS_BOUNDS[3]) return 3;
    return 4;
  }

  function mark5(mask, i) {
    mask[i] = 1;
    const tx = i & 63, ty = i >> 6;
    if (ty > 0) mask[i - W] = 1;
    if (tx < W - 1) mask[i + 1] = 1;
    if (ty < W - 1) mask[i + W] = 1;
    if (tx > 0) mask[i - 1] = 1;
  }

  /** add a tile (+ its 4 neighbors) to the current active set and its list */
  function activate(ctx, i) {
    if (ctx.activeN >= N) return;
    mark5(ctx.active, i);
    let n = 0; const act = ctx.active, list = ctx.activeList;
    for (let k = 0; k < N; k++) if (act[k]) list[n++] = k;
    ctx.activeN = n;
  }

  function swapActive(ctx) {
    const a = ctx.active; ctx.active = ctx.nextActive; ctx.nextActive = a;
    ctx.nextActive.fill(0);
    let n = 0; const act = ctx.active, list = ctx.activeList;
    for (let i = 0; i < N; i++) if (act[i]) list[n++] = i;
    ctx.activeN = n;
  }

  /** Per-tile constant tables (absorb, drain, loss, kMul, water/land masks); O(1). */
  function tileTables(state, i) {
    const ctx = C, tiles = state.tiles;
    const fl = tiles.flags[i], ty = tiles.type[i];
    const isWater = (fl & WATER_MASK) !== 0 || ty === T.OPEN_WATER || ty === T.BAYOU;
    ctx.water[i] = isWater ? ((fl & F.OPEN_WATER) || ty === T.OPEN_WATER ? 1 : 2) : 0;
    ctx.land[i] = isWater ? 0 : 1;
    const canal = (fl & F.CANAL) !== 0;
    const paved = tiles.owner[i] >= 0 || (tiles.surface[i] >= 1 && tiles.surface[i] <= 3);
    const levee = tiles.crest[i] > 0;
    const preserve = (fl & F.PRESERVE) !== 0;
    const drained = (fl & F.DRAINED) !== 0;
    const marsh = ty === T.MARSH && !drained;
    let absorb, drain;
    // class by type (POND is Wet class)
    if (drained || ty === T.DRAINED) { absorb = P.absorb.drained; drain = P.drain.drained; }
    else if (marsh) { absorb = P.absorb.marsh; drain = P.drain.marsh; }
    else if (ty === T.HIGH) { absorb = P.absorb.high; drain = P.drain.high; }
    else if (ty === T.DRY) { absorb = P.absorb.dry; drain = P.drain.dry; }
    else { absorb = P.absorb.wet; drain = P.drain.wet; }   // WET, POND, anything else
    // precedence: canal 0 > paved > preserve > levee > type
    if (levee) { absorb = P.absorb.levee; drain = P.drain.levee; }
    if (preserve && marsh) { absorb = P.absorb.preserve; }
    if (paved) { absorb = P.absorb.paved; drain = P.drain.paved; }
    if (canal) { absorb = P.absorb.canal; drain = 0; }
    if (isWater) { absorb = 0; drain = 0; }
    ctx.absorbFrac[i] = absorb;
    ctx.drainRate[i] = drain;
    ctx.kMul[i] = canal ? P.kCanal : 1;
    let loss = 0;
    if (marsh && !isWater) loss = preserve ? P.loss.preserve : P.loss.marsh;
    if (ctx.cypressMask[i]) loss += P.loss.cypress;
    ctx.lossTable[i] = loss;
    ctx.floorMarsh[i] = (marsh && (fl & F.WETLAND_ORIGINAL) && !drained && !ctx.canalNear[i] && !isWater) ? 1 : 0;
  }

  function refreshTables(state) { for (let i = 0; i < N; i++) tileTables(state, i); }

  function rebuildCypress(state) {
    const ctx = C; ctx.cypressMask.fill(0);
    const veg = Array.isArray(state.veg) ? state.veg : [];
    for (let k = 0; k < veg.length; k++) {
      const v = veg[k];
      if (!v || v.type !== 'cypress') continue;
      const tx = v.tx | 0, ty = v.ty | 0;
      if (!BSU.inBounds(tx, ty)) continue;
      mark5(ctx.cypressMask, ty * W + tx);
    }
    ctx.cypressDirty = false;
  }

  // ---------------------------------------------------------------------------
  // Canal networks (§6.1.5): 4-connected components of CANAL tiles.
  // ---------------------------------------------------------------------------
  function rebuildNetworks(state) {
    const ctx = C, tiles = state.tiles, flags = tiles.flags;
    ctx.tileNet.fill(-1);
    ctx.canalNear.fill(0);
    const nets = [];
    const q = ctx.bfsQueue;
    for (let s = 0; s < N; s++) {
      if (!(flags[s] & F.CANAL) || ctx.tileNet[s] >= 0) continue;
      const id = nets.length;
      const net = { id: id, tiles: [], drainsToWater: false, drainsTo: '', waterAdj: [], pumps: [], gates: [], stage: 0 };
      let head = 0, tail = 0;
      q[tail++] = s; ctx.tileNet[s] = id;
      while (head < tail) {
        const i = q[head++];
        net.tiles.push(i);
        if (flags[i] & F.FLOODGATE) net.gates.push(i);
        const tx = i & 63, ty = i >> 6;
        for (let d = 0; d < 4; d++) {
          let j;
          if (d === 0) { if (ty === 0) continue; j = i - W; }
          else if (d === 1) { if (tx === W - 1) continue; j = i + 1; }
          else if (d === 2) { if (ty === W - 1) continue; j = i + W; }
          else { if (tx === 0) continue; j = i - 1; }
          if (ctx.water[j]) {
            net.drainsToWater = true;
            if (ctx.water[j] === 2) net.drainsTo = 'Bayou'; else if (!net.drainsTo) net.drainsTo = 'River';
            if (net.waterAdj.indexOf(j) < 0) net.waterAdj.push(j);
            continue;
          }
          if ((flags[j] & F.CANAL) && ctx.tileNet[j] < 0) { ctx.tileNet[j] = id; q[tail++] = j; }
        }
      }
      // canalNear: Chebyshev 2 of every canal tile
      for (let k = 0; k < net.tiles.length; k++) {
        const i = net.tiles[k], tx = i & 63, ty = i >> 6;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = tx + dx, y = ty + dy;
          if (x >= 0 && y >= 0 && x < W && y < W) ctx.canalNear[y * W + x] = 1;
        }
      }
      nets.push(net);
    }
    // pumps: footprint 4-adjacent to a network tile (a pump touching only water has no network)
    let pumps = [];
    try { pumps = buildingsApi().list(state, 'pump') || []; } catch (e) { pumps = []; }
    for (let k = 0; k < pumps.length; k++) {
      const b = pumps[k];
      if (!b) continue;
      const edge = BSU.edgeTiles(b.tx | 0, b.ty | 0, b.w | 0, b.h | 0);
      for (let e = 0; e < edge.length; e++) {
        const id = ctx.tileNet[edge[e]];
        if (id >= 0 && nets[id].pumps.indexOf(b.id) < 0) nets[id].pumps.push(b.id);
      }
    }
    ctx.networks = nets;
    ctx.networksDirty = false;
    if (state.hydro) state.hydro.networks = nets;
    refreshTables(state);
    return nets;
  }

  function rebuildBarrier(state) {
    const ctx = C;
    const bar = { id: -1, tiles: [], bayouTiles: [], index: -1 };
    try {
      const B = buildingsApi();
      const list = B.list(state, 'surge_barrier') || [];
      const b = list.length ? list[0] : null;
      if (b) {
        bar.id = b.id;
        const fp = B.footprint(state, b.id) || BSU.footprintTiles(b.tx | 0, b.ty | 0, b.w | 0, b.h | 0) || [];
        for (let k = 0; k < fp.length; k++) {
          const i = fp[k] | 0;
          if (i < 0 || i >= N) continue;
          bar.tiles.push(i);
          const bi = ctx.bayouIndex[i];
          if (ctx.water[i] === 2) bar.bayouTiles.push(i);
          if (bi >= 0 && (bar.index < 0 || bi < bar.index)) bar.index = bi;
        }
      }
    } catch (e) { /* buildings absent: no barrier */ }
    ctx.barrier = bar;
    ctx.barrierDirty = false;
    if (bar.id < 0 && state.hydro.barrierClosed) state.hydro.barrierClosed = false;
  }

  function isHeldUpstream(state, ctx, i) {
    return state.hydro.barrierClosed && ctx.barrier.index >= 0 && ctx.bayouIndex[i] >= 0 && ctx.bayouIndex[i] < ctx.barrier.index;
  }

  /** Base boundary stage of water tile i: river (spillway-adjusted) or bayou (barrier-held upstream). No surge. */
  function baseStage(state, ctx, i) {
    const h = state.hydro;
    if (ctx.water[i] === 1) {
      let st = h.riverStage;
      if (h.spillwayOffset > 0 && (i >> 6) < PW.spillway.northRow) st = Math.max(0, st - h.spillwayOffset);
      return st;
    }
    if (isHeldUpstream(state, ctx, i)) return h.heldStage;
    return h.bayouStage;
  }

  /** Live boundary stage: base + the surge stage on tiles the front has reached (not on held-upstream tiles). */
  function liveStage(state, ctx, i, noSurge) {
    let st = baseStage(state, ctx, i);
    const sg = state.hydro.surge;
    if (!noSurge && sg && ctx.front[i] <= (sg.reached | 0) && !(ctx.water[i] === 2 && isHeldUpstream(state, ctx, i))) {
      if (sg.stage > st) st = sg.stage;
    }
    return st;
  }

  function integrityFactor(v) { return v >= P.integrityHalf ? 1 : (v > 0 ? 0.5 : 0); }

  /** crestTop / crestEff / overHead for every tile (once per step). */
  function computeHeads(state, ctx) {
    const tiles = state.tiles, elev = tiles.elev, crest = tiles.crest, integ = tiles.integrity, sb = tiles.sandbag, flags = tiles.flags;
    const ct = ctx.crestTop, ce = ctx.crestEff, oh = ctx.overHead, gc = ctx.gateClosed;
    for (let i = 0; i < N; i++) {
      const c = crest[i];
      if (c === 0) { ct[i] = elev[i] + sb[i] * 0.1; ce[i] = 0; oh[i] = 0; continue; }
      const full = c * integrityFactor(integ[i]);
      const fl = flags[i];
      const openGate = ((fl & F.FLOODGATE) && !gc[i]) || (fl & F.JAMMED);
      ce[i] = openGate ? 0 : full;
      ct[i] = elev[i] + ce[i] + sb[i] * 0.1;
      oh[i] = elev[i] + full + sb[i] * 0.1;
    }
  }

  /** Floodgate + barrier open/close (§4.11, §0.3 row 41). Emits gate:* on transitions unless quiet. */
  function evaluateGates(state, ctx, silent) {
    const h = state.hydro, flags = state.tiles.flags;
    if (ctx.networksDirty) rebuildNetworks(state);
    if (ctx.barrierDirty) rebuildBarrier(state);
    ctx.blocked.fill(0);
    const fallback = Math.max(h.riverStage, h.bayouStage);
    const nets = ctx.networks;
    for (let n = 0; n < nets.length; n++) {
      const net = nets[n];
      let st = 0;
      if (net.waterAdj.length) { for (let k = 0; k < net.waterAdj.length; k++) { const s = liveStage(state, ctx, net.waterAdj[k], ctx.quiet); if (s > st) st = s; } }
      else st = fallback;
      net.stage = st;
      for (let g = 0; g < net.gates.length; g++) {
        const i = net.gates[g];
        if (!(flags[i] & F.FLOODGATE)) continue;
        const jammed = (flags[i] & F.JAMMED) !== 0;
        const closed = !jammed && st > P.gateCloseStage ? 1 : 0;
        if (closed !== ctx.gateClosed[i]) {
          ctx.gateClosed[i] = closed;
          if (!silent && !ctx.quiet) emit(closed ? EV.GATE_CLOSED : EV.GATE_OPENED, { i: i });
        }
        if (closed) ctx.blocked[i] = 1;
      }
    }
    // barrier
    const bar = ctx.barrier;
    if (bar.id >= 0 && bar.tiles.length) {
      let st = 0;
      const src = bar.bayouTiles.length ? bar.bayouTiles : bar.tiles;
      for (let k = 0; k < src.length; k++) {
        const i = src[k];
        let s = h.bayouStage;
        const sg = h.surge;
        if (!ctx.quiet && sg && ctx.front[i] <= (sg.reached | 0) && sg.stage > s) s = sg.stage;
        if (s > st) st = s;
      }
      const closed = st > P.barrierCloseStage;
      if (closed !== !!h.barrierClosed) {
        h.barrierClosed = closed;
        if (closed) h.heldStage = h.bayouStage;
        if (!silent && !ctx.quiet) {
          emit(closed ? EV.GATE_CLOSED : EV.GATE_OPENED, { i: bar.tiles[0] });
          try { buildingsApi().dirtyRing(state); } catch (e) { /* no buildings */ }
        }
      }
      if (h.barrierClosed) for (let k = 0; k < bar.tiles.length; k++) ctx.blocked[bar.tiles[k]] = 1;
    }
  }

  /** BFS distances (4-connected, over every tile) from the entry tiles into ctx.front. Pure in `entry`. */
  function bfsFront(ctx, entry) {
    const fr = ctx.front, q = ctx.bfsQueue;
    fr.fill(UNREACH);
    let head = 0, tail = 0;
    for (let k = 0; k < entry.length; k++) {
      const i = entry[k] | 0;
      if (i < 0 || i >= N || fr[i] === 0) continue;
      fr[i] = 0; q[tail++] = i;
    }
    while (head < tail) {
      const i = q[head++], d = fr[i] + 1, tx = i & 63, ty = i >> 6;
      if (ty > 0 && fr[i - W] === UNREACH) { fr[i - W] = d; q[tail++] = i - W; }
      if (tx < W - 1 && fr[i + 1] === UNREACH) { fr[i + 1] = d; q[tail++] = i + 1; }
      if (ty < W - 1 && fr[i + W] === UNREACH) { fr[i + W] = d; q[tail++] = i + W; }
      if (tx > 0 && fr[i - 1] === UNREACH) { fr[i - 1] = d; q[tail++] = i - 1; }
    }
  }

  /** Advance / retract the surge front by tick count (called every tick while a surge exists). */
  function advanceFront(state, ctx) {
    const sg = state.hydro.surge;
    if (!sg) return;
    const tick = state.tick | 0;
    if (!ctx.surgeReceding) {
      const per = Math.max(1, PS.frontTicksPerTile | 0);
      const target = Math.max(0, Math.floor((tick - (sg.t0 | 0)) / per));
      let r = sg.reached | 0;
      while (r < target) {
        r++;
        sg.reached = r;
        if (r > ctx.surgeMaxReached) ctx.surgeMaxReached = r;
        const fr = ctx.front;
        let any = false;
        for (let i = 0; i < N; i++) if (fr[i] === r) { any = true; emit(EV.SURGE_FRONT, { i: i }); }
        if (!any && r > 130) break;   // past the farthest tile: nothing left to activate
      }
    } else {
      const per = Math.max(1, PS.recedeTicksPerTile | 0);
      if (tick - ctx.surgeRecedeTick >= per) {
        ctx.surgeRecedeTick = tick;
        if (sg.reached > 0) sg.reached = (sg.reached | 0) - 1;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Integrity writes (the only three cases, §5.3) — never in quiet mode.
  // ---------------------------------------------------------------------------
  function integrityHit(state, ctx, i, amount) {
    if (ctx.quiet) return;
    const integ = state.tiles.integrity;
    const old = integ[i];
    if (old === 0 || amount <= 0) return;
    const nv = Math.max(0, old - amount);
    integ[i] = nv;
    if (nv === 0) {
      if (ctx.stormLog.breached.indexOf(i) < 0) ctx.stormLog.breached.push(i);
      emit(EV.LEVEE_BREACH, { i: i, tx: i & 63, ty: i >> 6 });
    }
    try { buildingsApi().onIntegrityChanged(state, i); } catch (e) { BSU.error('hydro', 'onIntegrityChanged', e); }
  }

  // ---------------------------------------------------------------------------
  // The step. rain = {r, cx, cy, radius, mapWide} | null. opts: {relaxOnly, quiet}.
  // Returns nothing; updates ctx.lastLeak / lastMoved (T5).
  // ---------------------------------------------------------------------------
  function step(state, dt, rain, opts) {
    const ctx = ensure(state);
    const relaxOnly = !!(opts && opts.relaxOnly) || !(dt > 0);
    const quiet = ctx.quiet;
    const tiles = state.tiles, elev = tiles.elev;
    const D = ctx.D, S = ctx.S;
    dt = fin(dt, 0); if (dt < 0) dt = 0;
    if (ctx.cypressDirty) { rebuildCypress(state); refreshTables(state); }
    if (ctx.networksDirty) rebuildNetworks(state);
    if (ctx.barrierDirty) rebuildBarrier(state);
    if (ctx.anyTileDirty) { const td = ctx.tileDirty; for (let i = 0; i < N; i++) if (td[i]) { tileTables(state, i); td[i] = 0; } ctx.anyTileDirty = false; }

    // ecology halves the marsh/preserve loss below 30 (§6.8)
    const eco = (state.wildlife && typeof state.wildlife.ecology === 'number') ? state.wildlife.ecology : 100;
    const lossMul = eco < BSU.params.wildlife.ecology.lowThreshold ? BSU.params.wildlife.ecology.lowHeadLossMult : 1;
    { const lt = ctx.lossTable, le = ctx.lossEff; for (let i = 0; i < N; i++) le[i] = lt[i] * lossMul; }

    const water = ctx.water, land = ctx.land;
    let before = 0;
    for (let i = 0; i < N; i++) if (land[i]) before += D[i];
    let intake = 0, ground = 0, pumped = 0, pondTaken = 0, bndIn = 0, bndOut = 0, moved = 0;
    const raining = !!rain && !relaxOnly;

    // ---- 1. rain intake (§6.1.2) ----
    if (raining) intake += applyRain(state, ctx, rain);
    if (!relaxOnly && ctx.forcedRain && ctx.forcedRain.stepsLeft > 0 && !quiet) {
      intake += applyRain(state, ctx, ctx.forcedRain);
      if (--ctx.forcedRain.stepsLeft <= 0) ctx.forcedRain = null;
    }

    // ---- 2. gates / barrier, heads ----
    evaluateGates(state, ctx, false);
    computeHeads(state, ctx);

    // ---- 3. overtopping event + surge contact (once per step) ----
    if (!quiet) overtopScan(state, ctx);

    // ---- 4. two Jacobi passes ----
    const passes = P.jacobiPasses | 0;
    for (let p = 0; p < passes; p++) {
      const r = flowPass(state, ctx);
      moved += r.moved; bndIn += r.bndIn; bndOut += r.bndOut;
      // apply the back buffer (givers and receivers alike), then the boundary reset
      const back = ctx.back;
      for (let i = 0; i < N; i++) { const b = back[i]; if (b !== 0) { let nd = D[i] + b; if (nd < 0) nd = 0; D[i] = nd; back[i] = 0; } }
      for (let i = 0; i < N; i++) if (water[i]) { const st = liveStage(state, ctx, i, quiet); let nd = st - elev[i]; if (nd < 0) nd = 0; D[i] = nd; }
    }

    // ---- 5. pumps and pond sinks (§6.1.5, §6.1.3) ----
    if (!relaxOnly) { pumped = runPumps(state, ctx, dt); pondTaken = runPonds(state, ctx, dt); }

    // ---- 6a. active set for the next step ----
    if (!quiet) {
      const na = ctx.nextActive, tch = ctx.touched, thr = P.activeDepth;
      if (raining) na.fill(1);
      else {
        for (let i = 0; i < N; i++) if (water[i] || tch[i] || D[i] > thr) mark5(na, i);
      }
      tch.fill(0);
      swapActive(ctx);
      state.hydro.active = ctx.active;
    } else {
      ctx.touched.fill(0);
    }

    // ---- 6. drain / evaporation / saturation decay (§6.1.3, §6.1.2) — after runoff, over the new active set ----
    if (!relaxOnly) {
      const month = state.calendar ? (state.calendar.month | 0) : 1;
      const evap = (month >= P.evapSummerMonths[0] && month <= P.evapSummerMonths[1]) ? P.evapSummer : P.evap;
      const hot = state.weather && fin(state.weather.heat, 0) > P.satHotIndex;
      const satDec = (hot ? P.satDecayHot : P.satDecay) * dt;
      const list = ctx.activeList, n = ctx.activeN, dr = ctx.drainRate, cy = ctx.cypressMask, fm = ctx.floorMarsh;
      for (let a = 0; a < n; a++) {
        const i = list[a];
        if (!land[i]) continue;
        const d = D[i];
        if (d > 0) {
          const rate = (dr[i] + evap + (cy[i] ? P.cypressDrain : 0)) * dt;
          const floor = fm[i] ? MARSH_FLOOR : 0;
          let nd = d - rate;
          if (nd < floor) nd = floor;
          if (nd > d) nd = d;
          ground += d - nd;
          D[i] = nd;
        } else if (S[i] > 0) {
          const s = S[i] - satDec; S[i] = s < 0 ? 0 : s;
        }
      }
    }

    if (!quiet) classCrossings(state, ctx);   // walk / chunk re-bake on depth-class crossings

    // ---- 7. conservation (T5) ----
    let after = 0;
    for (let i = 0; i < N; i++) if (land[i]) after += D[i];
    const leak = Math.abs(after - before - intake + ground + pumped + pondTaken - bndIn + bndOut);
    ctx.lastLeak = leak; ctx.lastMoved = moved + intake + ground + pumped + pondTaken + bndIn + bndOut;
    ctx.pumped += pumped; ctx.pondTaken += pondTaken;
    ctx.stepCount++;
  }

  /** Rain intake over the footprint; returns the net depth added (Σ r − absorbed). */
  function applyRain(state, ctx, rain) {
    const r = fin(rain.r, 0);
    if (r <= 0) return 0;
    const D = ctx.D, S = ctx.S, land = ctx.land, af = ctx.absorbFrac, fill = P.satFill;
    let net = 0;
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = W - 1;
    if (!rain.mapWide) {
      const rad = Math.max(0, fin(rain.radius, 0) | 0), cx = fin(rain.cx, 32) | 0, cy = fin(rain.cy, 32) | 0;
      x0 = Math.max(0, cx - rad); x1 = Math.min(W - 1, cx + rad); y0 = Math.max(0, cy - rad); y1 = Math.min(W - 1, cy + rad);
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (!land[i]) continue;
        const s = S[i];
        const absorbed = r * af[i] * (1 - s);
        const add = r - absorbed;
        D[i] += add; net += add;
        let ns = s + absorbed / fill; if (ns > 1) ns = 1; S[i] = ns;
      }
    }
    return net;
  }

  /** One Jacobi pass over the active list: demanded outflows into ctx.back. */
  function flowPass(state, ctx) {
    const D = ctx.D, back = ctx.back, ct = ctx.crestTop, ce = ctx.crestEff, le = ctx.lossEff, km = ctx.kMul, bl = ctx.blocked, elev = state.tiles.elev, water = ctx.water, tch = ctx.touched;
    const list = ctx.activeList, n = ctx.activeN;
    let moved = 0, bndIn = 0, bndOut = 0;
    const f = ctx.fScratch, nb = ctx.nbScratch;
    for (let a = 0; a < n; a++) {
      const i = list[a];
      const di = D[i];
      if (di <= 0 || bl[i]) continue;
      const Hi = ct[i] + di;
      const tx = i & 63, ty = i >> 6;
      let sum = 0, cnt = 0;
      for (let d = 0; d < 4; d++) {
        let j;
        if (d === 0) { if (ty === 0) continue; j = i - W; }
        else if (d === 1) { if (tx === W - 1) continue; j = i + 1; }
        else if (d === 2) { if (ty === W - 1) continue; j = i + W; }
        else { if (tx === 0) continue; j = i - 1; }
        if (bl[j]) continue;
        const L = le[j];
        let Hj, test;
        if (ce[j] > 0 && Hi >= ct[j]) { Hj = elev[j] + D[j]; test = Hi >= Hj + L; }
        else { Hj = ct[j] + D[j]; test = Hi > Hj + L; }
        if (!test) continue;
        const diff = Hi - Hj - L;
        if (diff <= 0) continue;
        let fl = diff * ((km[i] === P.kCanal || km[j] === P.kCanal) ? K8 : K1);
        const half = diff * 0.5; if (fl > half) fl = half;    // stability clamp (file header)
        const cap = di * P.maxGiveFrac; if (fl > cap) fl = cap;
        f[cnt] = fl; nb[cnt] = j; cnt++; sum += fl;
      }
      if (sum <= 0) continue;
      const cap = di * P.maxGiveFrac;
      const sc = sum > cap ? cap / sum : 1;
      const give = sum * sc;
      back[i] -= give; tch[i] = 1;
      const wi = water[i];
      for (let c = 0; c < cnt; c++) {
        const j = nb[c], fl = f[c] * sc;
        back[j] += fl; tch[j] = 1;
        if (wi && !water[j]) bndIn += fl; else if (!wi && water[j]) bndOut += fl;
      }
      moved += give;
    }
    const r = ctx.passResult; r.moved = moved; r.bndIn = bndIn; r.bndOut = bndOut;
    return r;
  }

  /** Overtopping event (once per tile per day) and surge contact (once per storm/window). */
  function overtopScan(state, ctx) {
    const tiles = state.tiles, crest = tiles.crest, D = ctx.D, ct = ctx.crestTop, oh = ctx.overHead, water = ctx.water, ot = ctx.overtoppedToday;
    const surge = !!state.hydro.surge;
    const cat = (state.storms && state.storms.current && state.storms.current.cat > 0) ? state.storms.current.cat : 1;
    const contactDmg = P.surgeContactDmgPerCat * cat;
    for (let i = 0; i < N; i++) {
      if (crest[i] === 0) continue;
      const tx = i & 63, ty = i >> 6;
      const head = oh[i];
      let over = ot[i] === 1, contact = false;
      for (let d = 0; d < 4; d++) {
        let j;
        if (d === 0) { if (ty === 0) continue; j = i - W; }
        else if (d === 1) { if (tx === W - 1) continue; j = i + 1; }
        else if (d === 2) { if (ty === W - 1) continue; j = i + W; }
        else { if (tx === 0) continue; j = i - 1; }
        if (water[j]) {
          if (!over && ct[j] + D[j] >= head) over = true;
          if (!contact && !ctx.surgeContacted[i] && liveStage(state, ctx, j, false) > P.surgeContactStage) contact = true;
        } else if (!over && crest[j] === 0 && D[j] > 0 && ct[j] + D[j] >= head) over = true;
      }
      if (over && ot[i] === 0) {
        ot[i] = 1;
        emit(EV.LEVEE_OVERTOP, { i: i, tx: tx, ty: ty });
        if (surge && !ctx.stormOvertopped[i]) { ctx.stormOvertopped[i] = 1; ctx.stormLog.overtopped.push(i); }
      }
      if (contact) {
        ctx.surgeContacted[i] = 1;
        integrityHit(state, ctx, i, contactDmg);
      }
    }
  }

  /** Pumps: 15 tile-ft/day (×2 pre-drain) from each pump's network, deepest tile first. Returns tile-ft removed. */
  function runPumps(state, ctx, dt) {
    const nets = ctx.networks, D = ctx.D;
    if (!nets.length) return 0;
    const B = buildingsApi();
    const pre = (state.storms && state.storms.current && state.storms.current.preDrain) ? P.preDrainMult : 1;
    let total = 0;
    for (let n = 0; n < nets.length; n++) {
      const net = nets[n];
      if (!net.pumps.length || !net.tiles.length) continue;
      for (let k = 0; k < net.pumps.length; k++) {
        const id = net.pumps[k];
        let eff = 0;
        try { eff = B.effective(state, id); } catch (e) { eff = 0; }
        if (eff !== 1) continue;
        let remaining = P.pumpTileFtPerDay * dt * pre, removed = 0;
        let guard = net.tiles.length * 2 + 2;
        while (remaining > 1e-9 && guard-- > 0) {
          let best = -1, bd = 0;
          for (let t = 0; t < net.tiles.length; t++) { const i = net.tiles[t]; if (D[i] > bd) { bd = D[i]; best = i; } }
          if (best < 0) break;
          const take = bd < remaining ? bd : remaining;
          D[best] = bd - take; remaining -= take; removed += take;
        }
        if (removed > 0 && !ctx.quiet) ctx.pumpToday[id] = (ctx.pumpToday[id] || 0) + removed;
        total += removed;
      }
    }
    return total;
  }

  /** Retention ponds (§6.1.3): a 20-tile-ft sink within Chebyshev 5 of the pond's NW tile. Returns tile-ft taken. */
  function runPonds(state, ctx, dt) {
    const caps = ctx.quiet ? ctx.pondScratch : state.hydro.pondCap;
    if (!caps) return 0;
    const keys = Object.keys(caps);
    if (!keys.length) return 0;
    const B = buildingsApi(), D = ctx.D, land = ctx.land;
    const near = ctx.pondNearScratch, taken = ctx.pondTakenScratch, perTile = P.pond.perTileStep, rad = P.pond.radius | 0;
    let total = 0;
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      let cap = fin(caps[key], 0);
      let b = null;
      try { b = B.get(state, key | 0); } catch (e) { b = null; }
      if (!b || b.type !== 'pond') { if (!ctx.quiet) delete caps[key]; continue; }
      let take = P.pond.rate * dt * 40; if (take > cap) take = cap;
      if (take > 1e-9) {
        // candidates: tiles with water within the radius, sorted deepest first
        const cx = b.tx | 0, cy = b.ty | 0;
        let m = 0;
        for (let y = Math.max(0, cy - rad); y <= Math.min(W - 1, cy + rad); y++) for (let x = Math.max(0, cx - rad); x <= Math.min(W - 1, cx + rad); x++) {
          const i = y * W + x;
          if (land[i] && D[i] > 0 && m < near.length) { near[m] = i; taken[m] = D[i]; m++; }
        }
        // insertion sort by depth desc (≤ 121 entries)
        for (let a = 1; a < m; a++) { const vi = near[a], vd = taken[a]; let c = a - 1; while (c >= 0 && taken[c] < vd) { near[c + 1] = near[c]; taken[c + 1] = taken[c]; c--; } near[c + 1] = vi; taken[c + 1] = vd; }
        let spent = 0;
        for (let a = 0; a < m && take - spent > 1e-9; a++) {
          const i = near[a];
          let t = D[i] < perTile ? D[i] : perTile;
          if (t > take - spent) t = take - spent;
          D[i] -= t; spent += t;
        }
        cap -= spent; total += spent;
      }
      cap += P.pond.recover * dt;
      if (cap > P.pond.cap) cap = P.pond.cap;
      if (cap < 0) cap = 0;
      caps[key] = cap;
    }
    return total;
  }

  /** rewalk on 0.3 / 0.6 crossings, terrain.touch(i,'water') when a Marsh tile crosses 0.5 (§6.1.1). */
  function classCrossings(state, ctx) {
    const D = ctx.D, dc = ctx.depthClass, land = ctx.land, type = state.tiles.type, list = ctx.activeList, n = ctx.activeN;
    const Tn = terrainApi();
    for (let a = 0; a < n; a++) {
      const i = list[a];
      const c = classOf(D[i]);
      const o = dc[i];
      if (c === o) continue;
      dc[i] = c;
      if (!land[i]) continue;
      const lo = c < o ? c : o, hi = c < o ? o : c;
      try {
        if (lo <= 1 && hi >= 2 || lo <= 3 && hi >= 4) { if (typeof Tn.rewalk === 'function') Tn.rewalk(state, i); }
        if (type[i] === T.MARSH && lo <= 2 && hi >= 3) { if (typeof Tn.touch === 'function') Tn.touch(state, i, 'water'); }
      } catch (e) { BSU.error('hydro', 'classCrossings', e); }
    }
  }

  // ---------------------------------------------------------------------------
  // Daily work (flags.newDay), in the brief's order.
  // ---------------------------------------------------------------------------
  function daily(state) {
    const ctx = ensure(state);
    if (ctx.networksDirty) rebuildNetworks(state);   // canalNear must be current for the marsh rules
    if (ctx.anyTileDirty) { const td = ctx.tileDirty; for (let i = 0; i < N; i++) if (td[i]) { tileTables(state, i); td[i] = 0; } ctx.anyTileDirty = false; }
    const tiles = state.tiles, D = tiles.depth, stand = tiles.stand, flags = tiles.flags, type = tiles.type, land = ctx.land;
    const day = state.calendar ? (fin(state.calendar.day, 0) | 0) : 0;
    const Tn = terrainApi(), B = buildingsApi();
    // 1. stand
    for (let i = 0; i < N; i++) {
      if (!land[i]) continue;
      if (D[i] >= P.thresholds.puddle) { if (stand[i] < 255) stand[i]++; } else stand[i] = 0;
    }
    // 2. overtopping integrity hits
    const ot = ctx.overtoppedToday;
    for (let i = 0; i < N; i++) if (ot[i]) { ot[i] = 0; integrityHit(state, ctx, i, P.overtopDmg); }
    // pumps: today's running log restarts
    ctx.pumpToday = {};
    // powered pumps within 8 (for the drained-marsh rules)
    const pn = ctx.pumpNear; pn.fill(0);
    try {
      const pumps = B.list(state, 'pump') || [];
      for (let k = 0; k < pumps.length; k++) {
        const b = pumps[k];
        if (!b) continue;
        let eff = 0; try { eff = B.effective(state, b.id); } catch (e) { eff = 0; }
        if (eff !== 1) continue;
        const r = P.pumpRadius | 0;
        for (let y = Math.max(0, (b.ty | 0) - r); y <= Math.min(W - 1, (b.ty | 0) + (b.h | 0) - 1 + r); y++)
          for (let x = Math.max(0, (b.tx | 0) - r); x <= Math.min(W - 1, (b.tx | 0) + (b.w | 0) - 1 + r); x++) pn[y * W + x] = 1;
      }
    } catch (e) { /* no buildings */ }
    // 3. building flood transitions (D6)
    const list = Array.isArray(state.buildings) ? state.buildings : [];
    for (let id = 0; id < list.length; id++) {
      const b = list[id];
      if (!b) continue;
      const d = footprintDepthOf(state, ctx, b);
      const thr = b.pilings ? P.thresholds.floodPilings : P.thresholds.flood;
      if (!b.flooded && d >= thr) { b.flooded = true; b.floodedSince = day; emit(EV.BUILDING_FLOODED, { id: b.id, type: b.type, depth: d }); }
      else if (b.flooded && d < thr) { b.flooded = false; b.floodedSince = -1; emit(EV.BUILDING_DRIED, { id: b.id, type: b.type, depth: d }); }
    }
    // 4. drained marsh flip (§6.1.7), 5. reversion (Tier 2), 6. restoration progress (Tier 2)
    const MD = P.marshDrain;
    const dry = ctx.dryDays, wet = ctx.wetDays, rs = ctx.restoreDays, cn = ctx.canalNear;
    for (let i = 0; i < N; i++) {
      if (!land[i]) continue;
      const fl = flags[i];
      if (fl & F.RESTORING) {
        if (rs[i] < 255) rs[i]++;
        if (rs[i] >= RESTORE_DAYS) {
          rs[i] = 0;
          try { if (typeof Tn.restoreToMarsh === 'function') Tn.restoreToMarsh(state, i); else { M.markRestored(state, i); if (typeof Tn.classify === 'function') Tn.classify(state, i); } }
          catch (e) { BSU.error('hydro', 'restore', e); }
        }
        continue;
      }
      if (fl & F.DRAINED) {
        if (D[i] >= MD.revertDepth) { if (wet[i] < 255) wet[i]++; } else wet[i] = 0;
        if (wet[i] >= MD.revertDays && !cn[i] && !pn[i]) {
          wet[i] = 0;
          flags[i] &= ~F.DRAINED;
          ctx.tileDirty[i] = 1; ctx.anyTileDirty = true;
          try { if (typeof Tn.classify === 'function') Tn.classify(state, i); if (typeof Tn.touch === 'function') Tn.touch(state, i, 'flags'); } catch (e) { BSU.error('hydro', 'revert', e); }
          emit(EV.MARSH_REVERTED, { i: i });
        }
        continue;
      }
      if (type[i] !== T.MARSH || (fl & (F.PRESERVE | F.MOUND))) { dry[i] = 0; continue; }
      if (D[i] < MD.drainDepth) { if (dry[i] < 255) dry[i]++; } else dry[i] = 0;
      if (dry[i] >= MD.daysToDrain && (cn[i] || pn[i])) {
        dry[i] = 0;
        flags[i] |= F.DRAINED;
        ctx.mudDay[i] = Math.min(65535, day + MD.mudDays);
        ctx.tileDirty[i] = 1; ctx.anyTileDirty = true;
        try { if (typeof Tn.classify === 'function') Tn.classify(state, i); if (typeof Tn.touch === 'function') Tn.touch(state, i, 'flags'); } catch (e) { BSU.error('hydro', 'drain', e); }
        emit(EV.MARSH_DRAINED, { i: i });
      }
    }
    // 7. risk cache expiry
    const rk = state.hydro.risk;
    if (rk && rk.validUntilDay <= day) state.hydro.risk = null;
  }

  function footprintDepthOf(state, ctx, b) {
    let fp = null;
    try { fp = buildingsApi().footprint(state, b.id); } catch (e) { fp = null; }
    if (!fp || !fp.length) fp = BSU.footprintTiles(b.tx | 0, b.ty | 0, b.w | 0, b.h | 0);
    if (!fp) return 0;
    const D = state.tiles.depth;
    let m = 0;
    for (let k = 0; k < fp.length; k++) { const i = fp[k] | 0; if (i >= 0 && i < N && D[i] > m) m = D[i]; }
    return m;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  let inited = false;
  /** Subscribe (owner 'hydro'): listeners only set dirty flags. */
  M.init = function (state) {
    if (inited) return;
    inited = true;
    const on = function (name, fn) { BSU.events.on(name, function (p) { try { fn(p || {}); } catch (e) { BSU.error('hydro', name, e); } }, 'hydro'); };
    on(EV.TILE_CHANGED, function (p) {
      if (!C) return;
      const what = p.what;
      if (what === 'flags' || what === 'surface' || what === 'elev' || what === 'crest') { C.networksDirty = true; C.barrierDirty = true; }
      if (what === 'decor') C.cypressDirty = true;
      const i = p.i | 0;
      if (i >= 0 && i < N) { C.tileDirty[i] = 1; C.anyTileDirty = true; }
      if (C.root && C.root.hydro && C.root.hydro.risk) C.root.hydro.risk.dirty = true;
    });
    const onBuilding = function (p) {
      if (!C) return;
      C.networksDirty = true; C.barrierDirty = true;
      const fp = BSU.footprintTiles(p.tx | 0, p.ty | 0, p.w | 0, p.h | 0);
      if (fp) for (let k = 0; k < fp.length; k++) C.tileDirty[fp[k]] = 1;
      C.anyTileDirty = true;
      if (C.root && C.root.hydro && C.root.hydro.risk) C.root.hydro.risk.dirty = true;
    };
    on(EV.BUILDING_PLACED, onBuilding);
    on(EV.BUILDING_REMOVED, onBuilding);
    on(EV.BUILDING_COMPLETE, function () { if (C) { C.networksDirty = true; C.barrierDirty = true; } });
    on(EV.POWER_BLACKOUT, function () {});   // pumps are read live through buildings.effective
    on(EV.POWER_RESTORED, function () {});
    void state;
  };

  /** Rebuild every cache from the tree (both fresh cases identical: hydro draws no rng). */
  M.reset = function (state, fresh) {
    try { void fresh; rebuildAll(state); }
    catch (e) { BSU.error('hydro', 'reset', e); }
  };

  /** §5.1 step 3. flags = weather's {newDay, …}; undefined → detect the day change locally. */
  M.tick = function (state, flags) {
    try {
      const ctx = ensure(state);
      const day = state.calendar ? (fin(state.calendar.day, 0) | 0) : 0;
      let newDay;
      if (flags && typeof flags.newDay === 'boolean') newDay = flags.newDay;
      else newDay = ctx.lastDay >= 0 && day !== ctx.lastDay;
      ctx.lastDay = day;
      if (newDay) daily(state);
      if (state.hydro.surge) advanceFront(state, ctx);
      const dt = fin(state.weather ? state.weather.dtDay : 0, 0);
      if (dt > 0) {
        let rain = null;
        const Wx = weatherApi();
        if (Wx && typeof Wx.consumeRainStep === 'function') { try { rain = Wx.consumeRainStep(state); } catch (e) { BSU.error('hydro', 'consumeRainStep', e); rain = null; } }
        step(state, dt, rain, null);
      } else if (state.setPiece && RELAX_KINDS[state.setPiece.kind]) {
        const m = (state.tick | 0) % 10;
        if (P.stepsPerBlock.indexOf(m) >= 0) step(state, 0, null, { relaxOnly: true });
      }
    } catch (e) { BSU.error('hydro', 'tick', e); }
  };

  // ---------------------------------------------------------------------------
  // Initial state (GDD §3.3), called by terrain.gen before any reset.
  // ---------------------------------------------------------------------------
  function marshNoise(seed, tx, ty) {
    // value noise at scale 4 from a seed+tile hash, bilinear, 0..1
    const sc = 4;
    const gx = Math.floor(tx / sc), gy = Math.floor(ty / sc);
    const fx = tx / sc - gx, fy = ty / sc - gy;
    const h = function (x, y) { return (BSU.rng.hash(seed ^ 0x48594452, x * 131 + y) >>> 8) / 16777216; };
    const a = h(gx, gy), b = h(gx + 1, gy), c = h(gx, gy + 1), d = h(gx + 1, gy + 1);
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
  }
  M.seedInitial = function (state) {
    try {
      if (!state || !state.tiles) return;
      const tiles = state.tiles, h = state.hydro;
      h.riverStage = 0; h.bayouStage = 0; h.surge = null; h.barrierClosed = false; h.pondCap = {}; h.heldStage = 0; h.spillwayOffset = 0;
      h.networks = null; h.risk = null; h.active = null;
      const seed = fin(state.seed, 0) >>> 0;
      for (let i = 0; i < N; i++) {
        const fl = tiles.flags[i], ty = tiles.type[i];
        tiles.stand[i] = 0;
        if ((fl & WATER_MASK) || ty === T.OPEN_WATER || ty === T.BAYOU) {
          let d = 0 - tiles.elev[i]; if (d < 0) d = 0;
          tiles.depth[i] = d; tiles.sat[i] = 1;
        } else if (ty === T.MARSH && !(fl & F.DRAINED)) {
          tiles.depth[i] = P.initial.marshDepthMin + P.initial.marshDepthNoise * marshNoise(seed, i & 63, i >> 6);
          tiles.sat[i] = P.initial.marshSat;
        } else {
          tiles.depth[i] = 0; tiles.sat[i] = P.initial.landSat;
        }
      }
      rebuildAll(state);
    } catch (e) { BSU.error('hydro', 'seedInitial', e); }
  };

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  M.depthAt = function (state, tx, ty) {
    try { if (!state || !BSU.inBounds(tx | 0, ty | 0)) return 0; return fin(state.tiles.depth[(ty | 0) * W + (tx | 0)], 0); } catch (e) { return 0; }
  };
  /** live H(i) = crestTop + depth (§6.1.4) */
  M.surfaceAt = function (state, i) {
    try {
      const ctx = ensure(state); i |= 0; if (i < 0 || i >= N) return 0;
      const t = state.tiles, fl = t.flags[i];
      let ce = t.crest[i] * integrityFactor(t.integrity[i]);
      if (((fl & F.FLOODGATE) && !ctx.gateClosed[i]) || (fl & F.JAMMED)) ce = 0;
      return t.elev[i] + ce + t.sandbag[i] * 0.1 + t.depth[i];
    } catch (e) { return 0; }
  };
  /** boundary stage of a water tile (river/bayou/barrier-held, surge included); 0 on land */
  M.stageAt = function (state, i) {
    try { const ctx = ensure(state); i |= 0; if (i < 0 || i >= N || !ctx.water[i]) return 0; return liveStage(state, ctx, i, false); } catch (e) { return 0; }
  };
  M.floodedBuildings = function (state) {
    const out = [];
    try { const list = Array.isArray(state.buildings) ? state.buildings : []; for (let k = 0; k < list.length; k++) if (list[k] && list[k].flooded) out.push(list[k].id); } catch (e) { /* */ }
    return out;
  };
  M.floodedTiles = function (state) {
    try { const ctx = ensure(state), D = state.tiles.depth; let n = 0; for (let i = 0; i < N; i++) if (ctx.land[i] && D[i] >= P.thresholds.flood) n++; return n; } catch (e) { return 0; }
  };
  M.footprintDepth = function (state, id) {
    try { const b = buildingsApi().get(state, id) || (Array.isArray(state.buildings) ? state.buildings[id | 0] : null); if (!b) return 0; return footprintDepthOf(state, ensure(state), b); } catch (e) { return 0; }
  };
  M.networks = function (state) {
    try { const ctx = ensure(state); if (ctx.networksDirty) rebuildNetworks(state); return ctx.networks; } catch (e) { return []; }
  };
  M.networkAt = function (state, i) {
    try { const ctx = ensure(state); if (ctx.networksDirty) rebuildNetworks(state); i |= 0; if (i < 0 || i >= N) return null; const id = ctx.tileNet[i]; return id >= 0 ? ctx.networks[id] : null; } catch (e) { return null; }
  };
  M.surgeReached = function (state, i) {
    try { const ctx = ensure(state); const sg = state.hydro.surge; i |= 0; return !!sg && i >= 0 && i < N && ctx.front[i] <= (sg.reached | 0); } catch (e) { return false; }
  };
  M.surgeFrontDistance = function (state, i) {
    try { const ctx = ensure(state); i |= 0; if (!state.hydro.surge || i < 0 || i >= N) return UNREACH; return ctx.front[i]; } catch (e) { return UNREACH; }
  };
  M.stormLog = function (state) {
    try { const ctx = ensure(state); return { held: ctx.stormLog.held.slice(), overtopped: ctx.stormLog.overtopped.slice(), breached: ctx.stormLog.breached.slice() }; } catch (e) { return { held: [], overtopped: [], breached: [] }; }
  };
  M.stepCount = function () { return C ? C.stepCount : 0; };
  M.activeCount = function () { return C ? C.activeN : 0; };
  /** true while the pump has removed water today (economy: +$3k while running) */
  M.pumpRunning = function (state, id) { try { const ctx = ensure(state); return (ctx.pumpToday[id] || 0) > 0; } catch (e) { return false; } };
  /** drained-marsh mud stage (wildlife: +0.3 mosquito once) */
  M.isMud = function (state, i) { try { const ctx = ensure(state); i |= 0; const day = state.calendar ? (fin(state.calendar.day, 0) | 0) : 0; return i >= 0 && i < N && (state.tiles.flags[i] & F.DRAINED) !== 0 && ctx.mudDay[i] > day; } catch (e) { return false; } };
  /** cumulative pump / pond removals since reset (tests, debug) */
  M.sinkStats = function (state) { try { const ctx = ensure(state); return { pumped: ctx.pumped, pondTaken: ctx.pondTaken }; } catch (e) { return { pumped: 0, pondTaken: 0 }; } };
  M.conservationCheck = function (state) {
    try { const ctx = ensure(state), D = state.tiles.depth; let total = 0; for (let i = 0; i < N; i++) if (ctx.land[i]) total += D[i]; return { total: total, leak: ctx.lastLeak, moved: ctx.lastMoved }; } catch (e) { return { total: 0, leak: 0, moved: 0 }; }
  };
  M.drainsTo = function (state, i) {
    try {
      const ctx = ensure(state); i |= 0; if (i < 0 || i >= N) return 'ground';
      if (ctx.networksDirty) rebuildNetworks(state);
      const t = state.tiles;
      if (t.flags[i] & F.CANAL) {
        const net = ctx.networks[ctx.tileNet[i]];
        if (net) {
          if (net.drainsToWater) return 'Canal → ' + (net.drainsTo || 'Bayou');
          if (net.pumps.length) {
            let n = 1;
            try { const pumps = buildingsApi().list(state, 'pump') || []; const k = pumps.findIndex(function (b) { return b && b.id === net.pumps[0]; }); if (k >= 0) n = k + 1; } catch (e) { /* */ }
            return 'Pump ' + n + ' → Bayou';
          }
          return 'nowhere (standing)';
        }
      }
      const caps = state.hydro.pondCap || {};
      const keys = Object.keys(caps), tx = i & 63, ty = i >> 6;
      for (let k = 0; k < keys.length; k++) {
        let b = null; try { b = buildingsApi().get(state, keys[k] | 0); } catch (e) { b = null; }
        if (b && BSU.chebyshev(tx, ty, b.tx | 0, b.ty | 0) <= P.pond.radius) return 'Pond';
      }
      return 'ground';
    } catch (e) { return 'ground'; }
  };
  /** land tiles within `radius` (Chebyshev) of a river tile (OPEN_WATER minus the cypress lake); cached per root+radius */
  M.riverAdjacent = function (state, radius) {
    try {
      const ctx = ensure(state); radius = Math.max(0, fin(radius, P.seepageRadius) | 0);
      if (ctx.riverAdj.radius === radius) return ctx.riverAdj.tiles;
      const lake = new Uint8Array(N);
      const lk = (state.plot && Array.isArray(state.plot.lake)) ? state.plot.lake : [];
      for (let k = 0; k < lk.length; k++) { const i = lk[k] | 0; if (i >= 0 && i < N) lake[i] = 1; }
      const mask = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (ctx.water[i] !== 1 || lake[i]) continue;
        const tx = i & 63, ty = i >> 6;
        for (let y = Math.max(0, ty - radius); y <= Math.min(W - 1, ty + radius); y++) for (let x = Math.max(0, tx - radius); x <= Math.min(W - 1, tx + radius); x++) mask[y * W + x] = 1;
      }
      const out = [];
      for (let i = 0; i < N; i++) if (mask[i] && ctx.land[i]) out.push(i);
      ctx.riverAdj = { radius: radius, tiles: out };
      return out;
    } catch (e) { return []; }
  };

  // ---------------------------------------------------------------------------
  // Mutators called by other modules
  // ---------------------------------------------------------------------------
  M.markCanal = function (state, i, on) {
    try {
      const ctx = ensure(state); i |= 0; if (i < 0 || i >= N) return;
      const t = state.tiles;
      if (on) { t.flags[i] |= F.CANAL; if (t.crest[i] > 0) t.flags[i] |= F.FLOODGATE; }
      else { t.flags[i] &= ~(F.CANAL | F.FLOODGATE); ctx.gateClosed[i] = 0; }
      ctx.networksDirty = true; ctx.tileDirty[i] = 1; ctx.anyTileDirty = true;
      if (state.hydro.risk) state.hydro.risk.dirty = true;
      activate(ctx, i);
      const Tn = terrainApi(); if (typeof Tn.touch === 'function') Tn.touch(state, i, 'flags');
    } catch (e) { BSU.error('hydro', 'markCanal', e); }
  };
  M.markPond = function (state, tiles, id, on) {
    try {
      const ctx = ensure(state);
      const t = state.tiles, list = Array.isArray(tiles) ? tiles : [];
      for (let k = 0; k < list.length; k++) {
        const i = list[k] | 0; if (i < 0 || i >= N) continue;
        if (on) t.flags[i] |= F.POND_SINK; else t.flags[i] &= ~F.POND_SINK;
        ctx.tileDirty[i] = 1;
      }
      ctx.anyTileDirty = true;
      if (on) state.hydro.pondCap[String(id | 0)] = P.pond.cap; else delete state.hydro.pondCap[String(id | 0)];
      if (state.hydro.risk) state.hydro.risk.dirty = true;
      const Tn = terrainApi();
      for (let k = 0; k < list.length; k++) { const i = list[k] | 0; if (i >= 0 && i < N && typeof Tn.touch === 'function') Tn.touch(state, i, 'flags'); }
    } catch (e) { BSU.error('hydro', 'markPond', e); }
  };
  M.markLeveeChange = function (state, i) {
    try {
      const ctx = ensure(state); i |= 0; if (i < 0 || i >= N) return;
      const t = state.tiles;
      if (t.flags[i] & F.CANAL) { if (t.crest[i] > 0) t.flags[i] |= F.FLOODGATE; else { t.flags[i] &= ~F.FLOODGATE; ctx.gateClosed[i] = 0; } }
      else if (t.flags[i] & F.FLOODGATE) { t.flags[i] &= ~F.FLOODGATE; ctx.gateClosed[i] = 0; }
      ctx.networksDirty = true; ctx.tileDirty[i] = 1; ctx.anyTileDirty = true;
      if (state.hydro.risk) state.hydro.risk.dirty = true;
      try { buildingsApi().dirtyRing(state); } catch (e) { /* */ }
      const Tn = terrainApi(); if (typeof Tn.touch === 'function') Tn.touch(state, i, 'crest');
    } catch (e) { BSU.error('hydro', 'markLeveeChange', e); }
  };
  M.setJammed = function (state, i, on) {
    try {
      const ctx = ensure(state); i |= 0; if (i < 0 || i >= N) return;
      if (on) state.tiles.flags[i] |= F.JAMMED; else state.tiles.flags[i] &= ~F.JAMMED;
      ctx.tileDirty[i] = 1; ctx.anyTileDirty = true;
      try { buildingsApi().dirtyRing(state); } catch (e) { /* */ }
      const Tn = terrainApi(); if (typeof Tn.touch === 'function') Tn.touch(state, i, 'flags');
    } catch (e) { BSU.error('hydro', 'setJammed', e); }
  };
  M.markRestoring = function (state, tiles, on) {
    try {
      const ctx = ensure(state), t = state.tiles, list = Array.isArray(tiles) ? tiles : [], Tn = terrainApi();
      for (let k = 0; k < list.length; k++) {
        const i = list[k] | 0; if (i < 0 || i >= N) continue;
        if (on) t.flags[i] |= F.RESTORING; else t.flags[i] &= ~F.RESTORING;
        ctx.restoreDays[i] = 0;
        if (typeof Tn.touch === 'function') Tn.touch(state, i, 'flags');
      }
    } catch (e) { BSU.error('hydro', 'markRestoring', e); }
  };
  M.markRestored = function (state, i) {
    try {
      const ctx = ensure(state); i |= 0; if (i < 0 || i >= N) return;
      const t = state.tiles;
      if (!(t.flags[i] & (F.DRAINED | F.RESTORING))) return;
      t.flags[i] &= ~(F.DRAINED | F.RESTORING);
      t.stand[i] = 0; ctx.dryDays[i] = 0; ctx.wetDays[i] = 0; ctx.restoreDays[i] = 0; ctx.mudDay[i] = 0;
      ctx.tileDirty[i] = 1; ctx.anyTileDirty = true;
      const Tn = terrainApi(); if (typeof Tn.touch === 'function') Tn.touch(state, i, 'flags');
      emit(EV.MARSH_RESTORED, { i: i });
    } catch (e) { BSU.error('hydro', 'markRestored', e); }
  };
  M.setStages = function (state, river, bayou) {
    try {
      const ctx = ensure(state), h = state.hydro;
      river = fin(river, 0); bayou = fin(bayou, 0);
      if (river < 0) river = 0; if (bayou < 0) bayou = 0;
      h.riverStage = river; h.bayouStage = bayou;
      if (river === 0 && bayou === 0) { h.spillwayOffset = 0; if (!h.surge) ctx.surgeContacted.fill(0); }
      if (h.risk) h.risk.dirty = true;
      evaluateGates(state, ctx, false);
    } catch (e) { BSU.error('hydro', 'setStages', e); }
  };
  M.forceSat = function (state, tiles, sat) {
    try {
      ensure(state); sat = BSU.clamp(fin(sat, 0), 0, 1);
      const S = state.tiles.sat, list = Array.isArray(tiles) ? tiles : [];
      for (let k = 0; k < list.length; k++) { const i = list[k] | 0; if (i >= 0 && i < N && S[i] < sat) S[i] = sat; }
      if (state.hydro.risk) state.hydro.risk.dirty = true;
    } catch (e) { BSU.error('hydro', 'forceSat', e); }
  };
  /** debug: an immediate cell {cx, cy, inches, radius, steps} applied on the next hydro steps */
  M.forceRain = function (state, o) {
    try {
      const ctx = ensure(state); o = o || {};
      const steps = Math.max(1, fin(o.steps, P.rain.cellSteps) | 0);
      const inches = fin(o.inches, 2);
      const radius = fin(o.radius, P.rain.cellRadius) | 0;
      ctx.forcedRain = { r: inches / P.inchesPerFoot / steps, cx: fin(o.cx, 32) | 0, cy: fin(o.cy, 32) | 0, radius: radius, mapWide: radius >= W, stepsLeft: steps };
      ctx.active.fill(1); ctx.activeN = N; for (let i = 0; i < N; i++) ctx.activeList[i] = i;
    } catch (e) { BSU.error('hydro', 'forceRain', e); }
  };
  /** Bonnet Roux Spillway (§6.9, Tier 2): −1 ft felt north of ty 40 for the window; +1.0 ft on Marsh/Wet south of ty 44 once */
  M.spillway = function (state) {
    try {
      const ctx = ensure(state), h = state.hydro, sp = PW.spillway;
      h.spillwayOffset = sp.dropFt;
      const D = state.tiles.depth, type = state.tiles.type;
      let n = 0;
      for (let i = 0; i < N; i++) {
        if ((i >> 6) <= sp.southRow || !ctx.land[i]) continue;
        const ty = type[i];
        if (ty === T.MARSH || ty === T.WET) { D[i] += 1.0; mark5(ctx.active, i); n++; }
      }
      let c = 0; for (let i = 0; i < N; i++) if (ctx.active[i]) ctx.activeList[c++] = i; ctx.activeN = c;
      if (h.risk) h.risk.dirty = true;
      return { ok: true, tiles: n };
    } catch (e) { BSU.error('hydro', 'spillway', e); return { ok: false, tiles: 0 }; }
  };

  // ---------------------------------------------------------------------------
  // Surge (§6.2, D47)
  // ---------------------------------------------------------------------------
  M.surgeControl = function (state, cmd, arg) {
    try {
      const ctx = ensure(state), h = state.hydro;
      if (cmd === 'begin') {
        const a = arg || {};
        const entry = Array.isArray(a.entry) ? a.entry.map(function (x) { return x | 0; }).filter(function (x) { return x >= 0 && x < N; }) : [];
        h.surge = { stage: fin(a.stage, 0), target: fin(a.target, 0), entry: entry, dir: a.dir === 'E' ? 'E' : 'S', reached: 0, t0: state.tick | 0 };
        bfsFront(ctx, entry);
        ctx.surgeLastStage = h.surge.stage; ctx.surgeReceding = false; ctx.surgePeaked = h.surge.stage >= h.surge.target && h.surge.target > 0; ctx.surgeMaxReached = 0;
        ctx.stormLog = { held: [], overtopped: [], breached: [] };
        ctx.surgeContacted.fill(0); ctx.stormOvertopped.fill(0);
        emit(EV.SURGE_START, { stage: h.surge.stage });
        if (h.risk) h.risk.dirty = true;
      } else if (cmd === 'stage') {
        if (!h.surge) return;
        const ft = Math.max(0, fin(arg, 0));
        if (ft < ctx.surgeLastStage - 1e-9 && !ctx.surgeReceding) { ctx.surgeReceding = true; ctx.surgeRecedeTick = state.tick | 0; }
        ctx.surgeLastStage = ft;
        h.surge.stage = ft;
        if (!ctx.surgePeaked && ft >= h.surge.target) { ctx.surgePeaked = true; emit(EV.SURGE_PEAK, { stage: ft }); }
        // boundary tiles the front reached take the new stage now (the next pass resets them anyway)
        const D = state.tiles.depth, elev = state.tiles.elev, water = ctx.water;
        for (let i = 0; i < N; i++) if (water[i]) { let nd = liveStage(state, ctx, i, false) - elev[i]; if (nd < 0) nd = 0; D[i] = nd; }
      } else if (cmd === 'end') {
        if (!h.surge) return;
        // held: contacted or front-adjacent levee tiles that were neither overtopped nor breached
        const crest = state.tiles.crest, fr = ctx.front, maxR = ctx.surgeMaxReached;
        const held = [];
        for (let i = 0; i < N; i++) {
          if (crest[i] === 0) continue;
          let near = ctx.surgeContacted[i] === 1;
          if (!near) { const nb = BSU.nbr4(i); for (let k = 0; k < nb.length && !near; k++) if (fr[nb[k]] <= maxR) near = true; }
          if (near && !ctx.stormOvertopped[i] && ctx.stormLog.breached.indexOf(i) < 0) held.push(i);
        }
        ctx.stormLog.held = held;
        h.surge = null;
        ctx.front.fill(UNREACH);
        ctx.surgeReceding = false; ctx.surgePeaked = false; ctx.surgeMaxReached = 0;
        const D = state.tiles.depth, elev = state.tiles.elev, water = ctx.water;
        for (let i = 0; i < N; i++) if (water[i]) { let nd = liveStage(state, ctx, i, false) - elev[i]; if (nd < 0) nd = 0; D[i] = nd; }
        evaluateGates(state, ctx, false);
        emit(EV.SURGE_END, { stage: 0 });
        if (h.risk) h.risk.dirty = true;
      }
    } catch (e) { BSU.error('hydro', 'surgeControl', e); }
  };

  // ---------------------------------------------------------------------------
  // Prediction (§6.1.8): the same step code on scratch buffers, quiet.
  // ---------------------------------------------------------------------------
  M.predictRisk = function (state) {
    try {
      const ctx = ensure(state), h = state.hydro;
      const day = state.calendar ? (fin(state.calendar.day, 0) | 0) : 0;
      const rk = h.risk;
      if (rk && !rk.dirty && rk.validUntilDay > day && rk.depth && rk.depth.length === N) return rk.depth;
      const RD = ctx.riskDepth, RS = ctx.riskSat;
      RD.set(state.tiles.depth); RS.set(state.tiles.sat);
      // scratch copies of everything the step mutates besides depth/sat
      const savedGate = ctx.gateClosed.slice(), savedBlocked = ctx.blocked.slice(), savedBarrier = h.barrierClosed, savedHeld = h.heldStage;
      const savedPumped = ctx.pumped, savedPond = ctx.pondTaken, savedSteps = ctx.stepCount, savedLeak = ctx.lastLeak, savedMoved = ctx.lastMoved;
      const savedList = ctx.activeList.slice(), savedN = ctx.activeN;
      const pondCopy = {}; const keys = Object.keys(h.pondCap || {}); for (let k = 0; k < keys.length; k++) pondCopy[keys[k]] = h.pondCap[keys[k]];
      ctx.pondScratch = pondCopy;
      ctx.D = RD; ctx.S = RS; ctx.quiet = true;
      for (let i = 0; i < N; i++) ctx.activeList[i] = i; ctx.activeN = N;
      const steps = Math.max(1, P.riskSteps | 0);
      const rain = { r: P.riskInches / P.inchesPerFoot / steps, cx: 32, cy: 32, radius: W, mapWide: true };
      try { for (let s = 0; s < steps; s++) step(state, P.dtDayNormal, rain, null); }
      finally {
        ctx.D = state.tiles.depth; ctx.S = state.tiles.sat; ctx.quiet = false; ctx.pondScratch = null;
        ctx.gateClosed.set(savedGate); ctx.blocked.set(savedBlocked); h.barrierClosed = savedBarrier; h.heldStage = savedHeld;
        ctx.pumped = savedPumped; ctx.pondTaken = savedPond; ctx.stepCount = savedSteps; ctx.lastLeak = savedLeak; ctx.lastMoved = savedMoved;
        ctx.activeList.set(savedList); ctx.activeN = savedN;
      }
      const out = new Float32Array(N);
      for (let i = 0; i < N; i++) out[i] = ctx.land[i] ? RD[i] : 0;
      h.risk = { depth: out, validUntilDay: day + P.riskCacheDays, dirty: false };
      return out;
    } catch (e) { BSU.error('hydro', 'predictRisk', e); return new Float32Array(N); }
  };
  M.riskAt = function (state, i) { try { i |= 0; if (i < 0 || i >= N) return 0; return fin(M.predictRisk(state)[i], 0); } catch (e) { return 0; } };

  // test hooks
  M._step = function (state, dt, rain, opts) { try { step(state, dt, rain, opts); } catch (e) { BSU.error('hydro', '_step', e); } };
  M._daily = function (state) { try { daily(state); } catch (e) { BSU.error('hydro', '_daily', e); } };

  // ---------------------------------------------------------------------------
  // selfTest (§10.6, brief §6): private states, stubbed deps, recorded emits.
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const saved = C;
    const savedDeps = M._deps;
    const rec = [];
    const A = function (cond, msg) { BSU.assert(cond, msg); if (!cond) throw new Error(msg); };
    const count = function (name) { let n = 0; for (let k = 0; k < rec.length; k++) if (rec[k].name === name) n++; return n; };
    const stubB = function (list) {
      list = list || [];
      return {
        list: function (s, type) { return list.filter(function (b) { return b && (!type || b.type === type); }); },
        get: function (s, id) { return list.find(function (b) { return b && b.id === id; }) || null; },
        footprint: function (s, id) { const b = list.find(function (x) { return x && x.id === id; }); return b ? BSU.footprintTiles(b.tx, b.ty, b.w, b.h) : []; },
        effective: function () { return 1; },
        onIntegrityChanged: function () {}, dirtyRing: function () {}, has: function () { return false; }
      };
    };
    const stubT = { touch: function () {}, rewalk: function () {}, classify: function (s, i) { if (i === undefined) return; const fl = s.tiles.flags[i]; if (fl & F.DRAINED) s.tiles.type[i] = T.DRAINED; else if (s.tiles.elev[i] < 1.5 && !(fl & WATER_MASK)) s.tiles.type[i] = T.MARSH; } };
    const dt = P.dtDayNormal;
    /** flat 4-ft Dry land, a 2-wide bayou at x = 10–11, a 3×3 basin at 1.6 with a 2.2 lip inside a shallow bowl */
    function synth(seed) {
      const s = BSU.newState(seed);
      const t = s.tiles;
      for (let i = 0; i < N; i++) { t.elev[i] = 4; t.type[i] = T.DRY; }
      for (let y = 0; y < W; y++) for (let x = 10; x <= 11; x++) { const i = y * W + x; t.elev[i] = -1; t.flags[i] |= F.BAYOU; t.type[i] = T.BAYOU; }
      // a gentle bowl (4.0 → 2.6 ft over 6 tiles, Wet below 3.5) around the 2.2 lip and the 1.6 floor
      for (let y = 24; y <= 38; y++) for (let x = 24; x <= 38; x++) { const d = BSU.chebyshev(x, y, 31, 31); if (d <= 7) { const i = y * W + x; t.elev[i] = Math.min(4, 2.6 + (d - 2) * 0.28); t.type[i] = t.elev[i] < 3.5 ? T.WET : T.DRY; } }
      for (let y = 29; y <= 33; y++) for (let x = 29; x <= 33; x++) { const i = y * W + x; t.elev[i] = 2.2; t.type[i] = T.WET; }
      for (let y = 30; y <= 32; y++) for (let x = 30; x <= 32; x++) { const i = y * W + x; t.elev[i] = 1.6; }
      s.calendar.month = 1; s.weather.dtDay = dt; s.wildlife.ecology = 60;
      M.seedInitial(s);
      return s;
    }
    const noNaN = function (s, tag) { const D = s.tiles.depth, S = s.tiles.sat; for (let i = 0; i < N; i++) { A(isFinite(D[i]) && D[i] >= 0, tag + ': depth finite ≥ 0 at ' + i); A(isFinite(S[i]) && S[i] >= 0 && S[i] <= 1, tag + ': sat in [0,1] at ' + i); } };
    const t0 = Date.now();
    try {
      M._deps = { emit: function (name, payload) { rec.push({ name: name, p: payload }); }, buildings: stubB([]), terrain: stubT, weather: { consumeRainStep: function () { return null; } } };

      // 1. T5 conservation: 40 steps of a 2-inch map-wide rain, then 160 dry steps
      {
        const s = synth(1234);
        const rain = { r: P.riskInches / P.inchesPerFoot / P.rain.mapWideSteps, mapWide: true };
        let worst = 0;
        for (let k = 0; k < 200; k++) {
          step(s, dt, k < 40 ? rain : null, null);
          const c = M.conservationCheck(s);
          A(isFinite(c.leak) && c.leak <= P.conservationTol * c.moved + 1e-6, 'T5 leak ' + c.leak + ' vs moved ' + c.moved + ' at step ' + k);
          if (c.moved > 0 && c.leak / c.moved > worst) worst = c.leak / c.moved;
          if (k === 39) { const center = s.tiles.depth[31 * W + 31]; A(center > 0.1, 'basin fills after 2 in (' + center.toFixed(3) + ')'); notes.push('basin ' + center.toFixed(2) + ' ft after 2 in'); }
        }
        noNaN(s, 'T5');
        A(s.tiles.depth[5 * W + 40] < 0.01, 'flat 4-ft land dry after a day');
        notes.push('T5 worst leak ' + (worst * 100).toFixed(4) + '%');
      }

      // 2. T6 levee shedding + the crest in H on both sides
      {
        const s = synth(2);
        const y = 20, L = y * W + 21, Aa = y * W + 20, Bb = y * W + 22;
        s.tiles.elev[Aa] = 3.0; s.tiles.type[Aa] = T.WET;
        s.tiles.crest[L] = 6; s.tiles.integrity[L] = 100; s.tiles.depth[L] = 0.3;
        M.reset(s, true);
        step(s, dt, null, null);
        A(s.tiles.depth[Aa] > 0 && s.tiles.depth[Bb] > 0 && s.tiles.depth[Aa] > s.tiles.depth[Bb], 'T6: crown water sheds to both sides, more to the 3.0 side');
        let n = 1;
        while (n < 80 && s.tiles.depth[L] >= 0.01) { step(s, dt, null, null); n++; }
        A(s.tiles.depth[L] < 0.01, 'T6: crown dry within 2 days (' + n + ' steps)');
        const Pp = 25 * W + 25, L2 = 25 * W + 26;
        s.tiles.depth[Pp] = 0.4; s.tiles.crest[L2] = 6; s.tiles.integrity[L2] = 100;
        M.reset(s, true);
        for (let k = 0; k < 40; k++) { step(s, dt, null, null); A(s.tiles.depth[L2] === 0, 'T6: a 0.4-ft puddle never enters a levee tile'); }
        A(count(EV.LEVEE_OVERTOP) === 0, 'T6: no overtop event from puddles');
      }

      // 3. Overtopping: stage 8 water beside a levee on a 2-ft tile (crest 8); sandbags to 9.5 hold
      {
        const s = synth(3);
        const y = 40, Wt = y * W + 40, L = y * W + 41, Bb = y * W + 42;
        s.tiles.elev[Wt] = -4; s.tiles.flags[Wt] |= F.OPEN_WATER; s.tiles.type[Wt] = T.OPEN_WATER;
        for (const j of [Wt - W, Wt + W, Wt - 1]) s.tiles.elev[j] = 20;   // walls: the crown can hold 6 ft (H 14)
        s.tiles.elev[L] = 2; s.tiles.crest[L] = 6; s.tiles.integrity[L] = 100; s.tiles.type[L] = T.WET;
        s.tiles.elev[Bb] = 2; s.tiles.type[Bb] = T.WET;
        for (const j of [Bb - W, Bb + W, Bb + 1, L - W, L + W]) s.tiles.elev[j] = 20;
        M.seedInitial(s); M.setStages(s, 8, 0);
        rec.length = 0;
        for (let k = 0; k < 20; k++) step(s, dt, null, null);
        A(s.tiles.depth[L] > 0, 'overtop: water on the crown');
        A(s.tiles.depth[Bb] > 0.1, 'overtop: land behind the levee > 0.1 (' + s.tiles.depth[Bb].toFixed(3) + ')');
        A(count(EV.LEVEE_OVERTOP) === 1, 'levee:overtop fired once (' + count(EV.LEVEE_OVERTOP) + ')');
        A(s.tiles.integrity[L] === 95, 'surge contact −5 once (' + s.tiles.integrity[L] + ')');
        M._daily(s);
        A(s.tiles.integrity[L] === 85, 'overtop −10 at the day roll');
        s.tiles.sandbag[L] = 15; s.tiles.depth[L] = 0; s.tiles.depth[Bb] = 0; M.markLeveeChange(s, L);
        rec.length = 0;
        for (let k = 0; k < 20; k++) step(s, dt, null, null);
        A(s.tiles.depth[L] === 0 && s.tiles.depth[Bb] === 0, 'sandbagged crest 9.5 holds stage 8');
        A(count(EV.LEVEE_OVERTOP) === 0, 'no overtop with sandbags');
      }

      // 4. Floodgate (T7 live half): a canal through a levee conducts at stage 0, closes at 1.5
      {
        const s = synth(4);
        const y = 31;
        for (let x = 12; x <= 29; x++) { const i = y * W + x; s.tiles.elev[i] = 0.5; s.tiles.type[i] = T.WET; }
        const G = y * W + 20; s.tiles.crest[G] = 6; s.tiles.integrity[G] = 100;
        M.seedInitial(s);
        for (let x = 12; x <= 29; x++) M.markCanal(s, y * W + x, true);
        A((s.tiles.flags[G] & F.FLOODGATE) !== 0, 'canal on a levee tile is a floodgate');
        for (let yy = 30; yy <= 32; yy++) for (let x = 30; x <= 32; x++) s.tiles.depth[yy * W + x] = 1.0;
        M.reset(s, true);
        const basinSum = function () { let t = 0; for (let yy = 30; yy <= 32; yy++) for (let x = 30; x <= 32; x++) t += s.tiles.depth[yy * W + x]; return t; };
        const b0 = basinSum();
        rec.length = 0;
        for (let k = 0; k < 40; k++) step(s, dt, null, null);
        const b1 = basinSum();
        A(b1 < b0 - 3, 'gate open: basin drained through the canal (' + b0.toFixed(2) + ' → ' + b1.toFixed(2) + ')');
        A(count(EV.GATE_CLOSED) === 0, 'no gate:closed at stage 0');
        const nets = M.networks(s);
        A(nets.length === 1 && nets[0].drainsToWater && nets[0].gates.length === 1, 'one network draining to the bayou with one gate (got ' + JSON.stringify(nets.map(function (n) { return [n.tiles.length, n.drainsToWater, n.gates.length]; })) + ')');
        A(M.drainsTo(s, y * W + 15) === 'Canal → Bayou', 'drainsTo canal→bayou');
        M.setStages(s, 0, 1.5);
        step(s, dt, null, null);
        A(count(EV.GATE_CLOSED) === 1, 'gate:closed within one step of the stage crossing 1 ft');
        // everything on the basin side of the gate (floor + canal tiles 21–29) is conserved while the gate is closed
        const sideSum = function () { let t = basinSum(); for (let x = 21; x <= 29; x++) t += s.tiles.depth[y * W + x]; return t; };
        const b2 = sideSum();
        for (let k = 0; k < 40; k++) step(s, 0, null, { relaxOnly: true });
        A(Math.abs(sideSum() - b2) < 1e-5, 'closed gate: no flow across it (' + b2.toFixed(4) + ' vs ' + sideSum().toFixed(4) + ')');
        A(s.tiles.depth[y * W + 19] > 0.5, 'bayou side of the gate fills toward the stage (' + s.tiles.depth[y * W + 19].toFixed(3) + ')');
        M.setStages(s, 0, 0); step(s, dt, null, null);
        A(count(EV.GATE_OPENED) === 1, 'gate reopens at stage ≤ 1');
      }

      // 5. Pump: 15 tile-ft/day from a 10-tile landlocked network
      {
        const s = synth(5);
        const y = 45;
        for (let x = 40; x <= 49; x++) { const i = y * W + x; s.tiles.elev[i] = 0.5; s.tiles.type[i] = T.WET; }
        M.seedInitial(s);
        for (let x = 40; x <= 49; x++) M.markCanal(s, y * W + x, true);
        for (let x = 40; x <= 49; x++) s.tiles.depth[y * W + x] = 2.0;
        const pump = { id: 0, type: 'pump', tx: 40, ty: 46, w: 2, h: 2 };
        M._deps.buildings = stubB([pump]);
        M.reset(s, true);
        const nets = M.networks(s);
        A(nets.length === 1 && nets[0].pumps.length === 1 && !nets[0].drainsToWater, 'pump attached to the network');
        A(M.drainsTo(s, y * W + 44) === 'Pump 1 → Bayou', 'drainsTo pump');
        for (let k = 0; k < 40; k++) step(s, dt, null, null);
        const pumped = M.sinkStats(s).pumped;
        A(Math.abs(pumped - P.pumpTileFtPerDay) <= 0.05 * P.pumpTileFtPerDay, 'pump removed ' + pumped.toFixed(2) + ' tile-ft in a day');
        A(M.pumpRunning(s, 0), 'pumpRunning true today');
        M._deps.buildings.effective = function () { return 0; };
        const before = M.sinkStats(s).pumped;
        for (let k = 0; k < 40; k++) step(s, dt, null, null);
        A(M.sinkStats(s).pumped === before, 'unpowered pump removes nothing');
        M._deps.buildings = stubB([]);
      }

      // 6. Pond sink: 20 tile-ft, ≤ 0.1 per tile per step, recovers 2/day
      {
        const s = synth(6);
        const pond = { id: 3, type: 'pond', tx: 50, ty: 50, w: 2, h: 2 };
        M._deps.buildings = stubB([pond]);
        const pt = BSU.footprintTiles(50, 50, 2, 2);
        for (const i of pt) { s.tiles.elev[i] = 1; s.tiles.type[i] = T.POND; }
        for (let x = 51; x <= 55; x++) { const i = 54 * W + x; s.tiles.elev[i] = 3.0; s.tiles.type[i] = T.WET; }   // Chebyshev ≤ 5 of the NW tile, not touching the pond
        M.seedInitial(s);
        M.markPond(s, pt, 3, true);
        for (let x = 51; x <= 55; x++) s.tiles.depth[54 * W + x] = 0.4;
        M.reset(s, true);
        A(s.hydro.pondCap['3'] === P.pond.cap, 'pondCap 20');
        A(M.drainsTo(s, 54 * W + 53) === 'Pond', 'drainsTo Pond');
        step(s, dt, null, null);
        for (let x = 51; x <= 55; x++) { const d = s.tiles.depth[54 * W + x]; A(d <= 0.3 + 1e-6 && d >= 0.3 - 0.02, 'pond took ≤ 0.1 from tile ' + x + ' (' + d.toFixed(3) + ')'); }
        const cap = s.hydro.pondCap['3'];
        A(cap > 19.5 && cap < 19.6, 'capacity 20 − 0.5 + 2·dt (' + cap.toFixed(3) + ')');
        s.hydro.pondCap['3'] = 10;
        for (let x = 51; x <= 55; x++) s.tiles.depth[54 * W + x] = 0;
        for (let k = 0; k < 40; k++) step(s, dt, null, null);
        A(Math.abs(s.hydro.pondCap['3'] - 12) < 1e-3, 'capacity recovers 2/day (' + s.hydro.pondCap['3'].toFixed(3) + ')');
        M._deps.buildings = stubB([]);
      }

      // 7. Building flood transitions
      {
        const s = synth(7);
        const b = { id: 0, type: 'dorm', tx: 20, ty: 50, w: 2, h: 1, pilings: false, flooded: false, floodedSince: -1 };
        s.buildings = [b];
        M._deps.buildings = stubB([b]);
        for (const i of BSU.footprintTiles(20, 50, 2, 1)) { s.tiles.elev[i] = 3; s.tiles.type[i] = T.WET; }
        M.seedInitial(s);
        s.tiles.depth[50 * W + 21] = 0.6;
        rec.length = 0; s.calendar.day = 3;
        M._daily(s);
        A(b.flooded === true && b.floodedSince === 3 && count(EV.BUILDING_FLOODED) === 1, 'building:flooded at 0.6 ft');
        A(M.floodedBuildings(s).length === 1 && M.footprintDepth(s, 0) === s.tiles.depth[50 * W + 21], 'floodedBuildings / footprintDepth');
        s.tiles.depth[50 * W + 21] = 0.2; s.calendar.day = 4;
        M._daily(s);
        A(b.flooded === false && count(EV.BUILDING_DRIED) === 1, 'building:dried below 0.5');
        b.pilings = true; s.tiles.depth[50 * W + 21] = 0.6; rec.length = 0;
        M._daily(s);
        A(b.flooded === false && count(EV.BUILDING_FLOODED) === 0, 'pilings: not flooded at 0.6');
        s.tiles.depth[50 * W + 21] = 3.2;
        M._daily(s);
        A(b.flooded === true, 'pilings: flooded at 3.2');
        M._deps.buildings = stubB([]);
      }

      // 8. Drained flip after 5 dry days with a canal within 2; a Preserve tile never flips
      {
        const s = synth(8);
        const Mt = 55 * W + 25, Ct = 55 * W + 27, Pt = 58 * W + 25, Cp = 58 * W + 27;
        for (const i of [Mt, Pt]) { s.tiles.elev[i] = 1.0; s.tiles.type[i] = T.MARSH; s.tiles.flags[i] |= F.WETLAND_ORIGINAL; }
        s.tiles.flags[Pt] |= F.PRESERVE;
        for (const i of [Ct, Cp]) { s.tiles.elev[i] = 0.5; s.tiles.type[i] = T.WET; }
        M.seedInitial(s);
        M.markCanal(s, Ct, true); M.markCanal(s, Cp, true);
        s.tiles.depth[Mt] = 0; s.tiles.depth[Pt] = 0;
        rec.length = 0;
        for (let d = 1; d <= 5; d++) { s.calendar.day = d; A((s.tiles.flags[Mt] & F.DRAINED) === 0 || d > 4, 'not drained before day 5'); M._daily(s); }
        A((s.tiles.flags[Mt] & F.DRAINED) !== 0 && count(EV.MARSH_DRAINED) === 1, 'marsh:drained after 5 daily steps');
        A(s.tiles.type[Mt] === T.DRAINED, 'terrain classified the tile DRAINED');
        A(M.isMud(s, Mt) === true, 'mud stage for 15 days');
        s.calendar.day = 21; A(M.isMud(s, Mt) === false, 'mud stage over after 15 days');
        A((s.tiles.flags[Pt] & F.DRAINED) === 0, 'Preserve marsh never flips');
        // Tier 2 reversion: remove the canal, hold ≥ 0.5 ft for 20 days
        M.markCanal(s, Ct, false);
        s.tiles.depth[Mt] = 0.7;
        for (let d = 22; d <= 41; d++) { s.calendar.day = d; M._daily(s); s.tiles.depth[Mt] = 0.7; }
        A((s.tiles.flags[Mt] & F.DRAINED) === 0 && count(EV.MARSH_REVERTED) === 1, 'marsh:reverted after 20 wet days without a canal');
        // Tier 2 restoration: 30 days
        s.tiles.flags[Mt] |= F.DRAINED; M.markRestoring(s, [Mt], true);
        for (let d = 42; d <= 71; d++) { s.calendar.day = d; M._daily(s); }
        A((s.tiles.flags[Mt] & (F.DRAINED | F.RESTORING)) === 0 && count(EV.MARSH_RESTORED) === 1, 'marsh:restored after 30 days');
      }

      // 9. Surge front
      {
        const s = synth(9);
        s.weather.dtDay = P.dtDayLandfall;
        const entry = []; for (let x = 28; x <= 35; x++) entry.push(63 * W + x);
        rec.length = 0;
        M.surgeControl(s, 'begin', { stage: 0, target: 5, entry: entry, dir: 'S' });
        for (let t = 1; t <= 200; t++) { s.tick++; M.tick(s, { newDay: false }); M.surgeControl(s, 'stage', 5 * t / 200); }
        A(count(EV.SURGE_START) === 1 && count(EV.SURGE_PEAK) === 1, 'surge:start and surge:peak recorded');
        const r = s.hydro.surge.reached;
        A(r >= 38 && r <= 40, 'reached ≈ ticks/5 (' + r + ')');
        A(count(EV.SURGE_FRONT) > 100, 'surge:front per activated tile (' + count(EV.SURGE_FRONT) + ')');
        A(Object.keys(s.hydro.surge).sort().join() === 'dir,entry,reached,stage,t0,target', 'surge keys exactly {stage,target,entry,dir,reached,t0}');
        const bt = 63 * W + 10;   // bayou tile 18 steps from the entry
        A(M.surgeReached(s, bt) && Math.abs(s.tiles.depth[bt] - 6) < 1e-5, 'reached bayou tile at depth 5 − (−1)');
        const far = 0 * W + 10;
        A(!M.surgeReached(s, far) && Math.abs(s.tiles.depth[far] - 1) < 1e-5, 'unreached bayou tile still at stage 0');
        A(s.tiles.depth[63 * W + 12] > 0.5, 'land beside the reached bayou floods through the CA (entry tiles are land: never sources) (' + s.tiles.depth[63 * W + 12].toFixed(2) + ')');
        const clone = BSU.deepClone(s);
        M.reset(clone, false);
        const cloneFront = new Uint16Array(N);
        for (let i = 0; i < N; i++) cloneFront[i] = M.surgeFrontDistance(clone, i);   // one root at a time (a root switch rebuilds the context)
        let sameFront = true;
        for (let i = 0; i < N; i++) if (cloneFront[i] !== M.surgeFrontDistance(s, i)) sameFront = false;
        A(sameFront, 'front rebuilt from entry on load');
        M.surgeControl(s, 'stage', 2.5); s.tick++; M.tick(s, { newDay: false });
        A(s.hydro.surge.reached === r - 1 || s.hydro.surge.reached === r, 'front retracts while receding');
        M.surgeControl(s, 'end');
        A(s.hydro.surge === null && count(EV.SURGE_END) === 1 && Math.abs(s.tiles.depth[bt] - 1) < 1e-5, 'end: surge null, stages back to 0');
        A(M.surgeFrontDistance(s, bt) === UNREACH && M.surgeReached(s, bt) === false, 'no surge → unreachable');
        noNaN(s, 'surge');
      }

      // 10. predictRisk
      {
        const s = synth(10);
        const r1 = M.predictRisk(s);
        A(r1.length === N && r1[31 * W + 31] > 0.2, 'risk > 0.2 at the basin center (' + r1[31 * W + 31].toFixed(3) + ')');
        A(r1[5 * W + 40] < 0.01, 'risk ≈ 0 on 4-ft land');
        A(M.predictRisk(s) === r1, 'cached object identity');
        A(s.tiles.depth[31 * W + 31] === 0, 'prediction leaves the live depth alone');
        A(M.riskAt(s, 31 * W + 31) === r1[31 * W + 31], 'riskAt');
      }

      // 11. drainsTo strings for a lone canal and a plain tile
      {
        const s = synth(11);
        M.markCanal(s, 50 * W + 50, true);
        A(M.drainsTo(s, 50 * W + 50) === 'nowhere (standing)', 'lone canal: nowhere (standing)');
        A(M.drainsTo(s, 10 * W + 50) === 'ground', 'plain tile: ground');
        A(M.riverAdjacent(s, 6).length === 0, 'no river tiles on the synthetic map');
      }
      notes.push('selfTest ' + (Date.now() - t0) + ' ms');
    } catch (e) {
      M._deps = savedDeps; C = saved;
      return { ok: false, notes: (e && e.message) || String(e) };
    } finally {
      M._deps = savedDeps; C = saved;
    }
    return { ok: true, notes: notes.join('; ') };
  };
})();
