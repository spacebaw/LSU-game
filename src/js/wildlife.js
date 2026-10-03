'use strict';
// ============================================================================
// BAYOU STATE — wildlife.js (module 5) → BSU.wildlife
// Owner of: state.gators[], state.wildlife.* (campusMask unsaved), tiles.mosq,
//           tiles.integrity for nutria burrows only (−15, then buildings.onIntegrityChanged).
// Implements: GDD §6.3 (gators: dens, state machine, attractors, campus set, incidents,
//             officers, Le Grand), §6.4 (mosquito field, index, warnings, illness), §6.7
//             (nutria burrows, birds, fireflies, critters), §6.8 (ecology score), §6.2 Recovery
//             (post-storm gator wave, mosquito bloom), §6.6 (heat illness half), §0.3 rows
//             29, 31–35, 37, 40 (the effects wildlife applies). ARCHITECTURE §5.5 API.
// Determinism: every draw goes through BSU.rng.sim in gator-index order; presentation-only
//             positions (critters) are hashes of state, never random.
// Zero DOM / timer / audio access at definition time; loads in Node through test/domstub.mjs.
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.wildlife = BSU.wildlife || {});
  const P = BSU.params.wildlife;
  const PG = P.gator, PM = P.mosq, PN = P.nutria, PE = P.ecology;
  const T = BSU.T, FLAG = BSU.FLAG, SURF = BSU.SURF, SKY = BSU.SKY, STORM = BSU.STORM;
  const N = BSU.MAP.N, W = BSU.MAP.W, H = BSU.MAP.H;
  const R = BSU.rng.sim;                 // the sim stream (never replaced, §3.3)

  // Local constants for values the GDD names but BSU.params does not carry (noted in INTEGRATION_NOTES.md).
  const LEGRAND_SWIM_TICKS = 200;        // Le Grand picks a new lake tile every 20 s (GDD §6.3: "SUN/SWIM between lake tiles")
  const ROUTE_GIVEUP_TICKS = 30;         // a wander whose route is still queued after 30 ticks is cancelled (brief §4)
  const FLOOD_SAMPLE_MAX = 40;           // ≤ 40 flooded tiles sampled per attractor list (brief §4)
  const ROUX_SPEED = 1.2;                // tiles/s, Roux Is Loose (Tier 2; GDD §0.3 row 40)
  const BEADS_WINDOWS = [['Oct 8', 'Oct 10'], ['Feb 6', 'Feb 8']];   // gators wear beads (GDD §6.3 "Halloween: gators wear beads"; brief decision)
  const GATOR_TURF = { practice_field: 1, stadium: 1, parking: 1 };  // footprints gators may cross (GDD §6.3)
  const FALLBACK_NAMES = ['Big Al', 'Beignet', 'Marie', 'Chomp Chomp', "Ol' Frontenac", 'Tabasco', 'Professor Snaps', 'Étouffée', 'Tante Lou', 'Boudreaux Jr.', 'Mudbug', 'Sazerac', 'Gumbo', 'Praline'];

  // ---------------------------------------------------------------------------
  // Injectable dependencies (§10.5/§10.6): selfTest swaps these for stubs and an emit recorder.
  // A null entry means "use BSU.<name> at call time" (later modules are resolved lazily, §1).
  // ---------------------------------------------------------------------------
  M._deps = {
    emit: function (name, payload) { return BSU.events.emit(name, payload); },
    terrain: null, hydro: null, buildings: null, agents: null, weather: null, progress: null, economy: null, data: null
  };
  function dep(name) { return M._deps[name] || BSU[name] || null; }
  function emit(name, payload) { M._deps.emit(name, payload); }
  function fn(obj, key) { return (obj && typeof obj[key] === 'function') ? obj[key] : null; }

  /** Wrap a public function so no exception escapes (§10.1); under BSU.SELFTEST BSU.error rethrows. */
  function safe(where, f, fallback) {
    return function () {
      try { return f.apply(null, arguments); }
      catch (e) { BSU.error('wildlife', where, e); return (typeof fallback === 'function') ? fallback() : fallback; }
    };
  }
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const clamp = BSU.clamp;

  // ---------------------------------------------------------------------------
  // Private caches (rebuilt in reset; every query self-heals on cacheRoot !== state, D38)
  // ---------------------------------------------------------------------------
  let cacheRoot = null;                  // the state tree the caches below describe
  let campusDirty = true;  let campus = new Uint8Array(N);   // allocated per root (state.wildlife.campusMask points at it)
  let densDirty = true;    let dens = [];  let waterTiles = 0;  let marshTiles = 0;
  let gridDirty = true;    const passable = new Uint8Array(N);  const habitat = new Uint8Array(N);
  let officersDirty = true;
  let trapDirty = true;    const trapMask = new Uint8Array(N);  let trapRoot = null, trapDay = -1;   // nutriaTraps cache (per root, per day, per building event)
  const mudApplied = new Uint8Array(N);  // mud source applied once per mud episode (brief §4)
  const sinkMul = new Float32Array(N);   // multiplicative mosquito sinks, rebuilt daily
  const srcBuf = new Float32Array(N);    // mosquito sources scratch
  const dblBuf = new Float64Array(N);    // diffusion scratch (double precision: conservation check)
  const u8Buf = new Uint8Array(N);       // generic scratch mask
  const disturbedBuf = new Uint8Array(N);
  let prevPhase = -1;                    // last sky phase seen by tick (Dawn/Dusk/Day transitions)
  let retreatFlag = false;               // storm:watch → true, storm:passed → false
  let wavePending = null;                // {point, nearMiss} set by the storm:passed listener; consumed in tick
  let trashUntilDay = -1;                // Mardi Gras trash tiles are attractors while day ≤ this
  let gameDay = -1;                      // game:kickoff → today
  let nextGatorId = 0;
  let roux = null;                       // Tier 2 "Roux Is Loose" transient {tx, ty, state, home, target, tickerDone}
  const priv = new Map();                // gator id → {wait, wanderRoute} (never saved)

  function privOf(g) { let p = priv.get(g.id); if (!p) { p = { wait: 0, wanderRoute: null, wanderFrom: -1 }; priv.set(g.id, p); } return p; }

  // BFS scratch (own router used when BSU.agents is absent or for water-only swims)
  const bfsParent = new Int32Array(N);
  const bfsSeen = new Int32Array(N);
  const bfsQueue = new Int32Array(N);
  let bfsGen = 0;

  // ---------------------------------------------------------------------------
  // Small helpers over state
  // ---------------------------------------------------------------------------
  function isWaterType(t) { return t === T.OPEN_WATER || t === T.BAYOU; }
  function isLandTile(state, i) { const t = state.tiles.type[i]; return t !== T.OPEN_WATER && t !== T.BAYOU && t !== T.POND; }
  function tileOf(x, y) { return (Math.floor(y) * W) + Math.floor(x); }
  function gatorTile(g) {
    const tx = clamp(Math.floor(g.tx), 0, W - 1), ty = clamp(Math.floor(g.ty), 0, H - 1);
    return ty * W + tx;
  }
  function today(state) { return (state.calendar && isNum(state.calendar.day)) ? state.calendar.day : 0; }
  function yearOf(state) { return BSU.dayParts(today(state)).year; }
  function dayOf(state, str, yearOffset) { const d = BSU.dateToDay(str, yearOf(state) + (yearOffset || 0)); return isNum(d) ? d : -1; }
  function skyPhase(state) { return (state.sky && isNum(state.sky.phase)) ? state.sky.phase : SKY.DAWN; }
  function names() { const D = dep('data'); return (D && Array.isArray(D.gatorNames) && D.gatorNames.length) ? D.gatorNames : FALLBACK_NAMES; }
  function roman(n) { return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || ('x' + n); }

  /** Every non-null building (optionally of one catalog id); falls back to state.buildings when BSU.buildings is absent. */
  function listBuildings(state, type) {
    const B = dep('buildings');
    if (fn(B, 'list')) { const l = B.list(state, type); if (Array.isArray(l)) return l; }
    const out = [];
    const arr = state.buildings || [];
    for (let i = 0; i < arr.length; i++) { const b = arr[i]; if (b && (!type || b.type === type)) out.push(b); }
    return out;
  }
  function isComplete(b) { return !!b && b.built >= 1 && !b.ruin; }
  function footprintOf(b) { return BSU.footprintTiles(b.tx, b.ty, b.w, b.h) || []; }
  function effectiveOf(state, b) { const B = dep('buildings'); const f = fn(B, 'effective'); if (!f) return 1; const v = f(state, b.id); return isNum(v) ? v : 1; }
  function dumpsterOf(state, b) {
    const B = dep('buildings'); const f = fn(B, 'dumpsterTile');
    if (f) { const i = f(state, b.id); if (isNum(i) && i >= 0 && i < N) return i; }
    if (b.data && isNum(b.data.dumpsterTile) && b.data.dumpsterTile >= 0) return b.data.dumpsterTile;
    const tx = b.tx + b.w, ty = b.ty + b.h - 1;
    return BSU.inBounds(tx, ty) ? BSU.idx(tx, ty) : -1;
  }
  function hasBuilding(state, type) { const l = listBuildings(state, type); for (let i = 0; i < l.length; i++) if (isComplete(l[i])) return true; return false; }
  function currentStorm(state) { const Wx = dep('weather'); const f = fn(Wx, 'storm'); if (f) { const s = f(state); if (s !== undefined) return s; } return (state.storms && state.storms.current) || null; }
  function heatInfo(state) {
    const Wx = dep('weather'); const f = fn(Wx, 'heat');
    if (f) { const h = f(state); if (h && isNum(h.index)) return h; }
    const index = (state.weather && isNum(state.weather.heat)) ? state.weather.heat : 80;
    return { index: index, advisory: index >= BSU.params.heat.advisory, wave: false };
  }
  function agentList(state) { const A = dep('agents'); const f = fn(A, 'list'); const l = f ? f(state) : state.agents; return Array.isArray(l) ? l : []; }
  function gameDayNow(state) { return !!(state.sports && state.sports.game) || gameDay === today(state); }

  /** Lazily initialized saved keys (contract.js is frozen; §2.6, D46). */
  function ensureKeys(state) {
    const wl = state.wildlife;
    if (!isNum(wl.sick)) wl.sick = 0;
    if (!isNum(wl.beadsDay)) wl.beadsDay = -1;
    if (!wl.burrowLog || typeof wl.burrowLog !== 'object') wl.burrowLog = {};
    if (!isNum(wl.leGrandPhotoYear)) wl.leGrandPhotoYear = 0;     // year Le Grand was last photographed (0 = never)
    if (!isNum(wl.waveLeft)) wl.waveLeft = 0;                    // post-storm gator wave: gators still to spawn
    if (!isNum(wl.waveUntilDay)) wl.waveUntilDay = -1;           // last day of the wave
    if (!isNum(wl.waveEntry)) wl.waveEntry = -1;                 // landfall point tile (fallback spawn area)
    if (!wl.ecologyTerms || typeof wl.ecologyTerms !== 'object') wl.ecologyTerms = {};
    if (!isNum(wl.ecologyTerms.once)) wl.ecologyTerms.once = 0;
    if (!wl.birds || typeof wl.birds !== 'object') wl.birds = { egrets: 0, spoonbills: false, pelicans: 0 };
    if (!Array.isArray(wl.officers)) wl.officers = [];
    if (!Array.isArray(wl.incidents)) wl.incidents = [];
    if (!Array.isArray(state.gators)) state.gators = [];
  }

  // ---------------------------------------------------------------------------
  // Caches: campus mask, dens, gator grid
  // ---------------------------------------------------------------------------
  function heal(state) {
    if (cacheRoot !== state) {
      cacheRoot = state;
      campus = new Uint8Array(N);
      campusDirty = densDirty = gridDirty = officersDirty = true;
      priv.clear();
    }
  }
  function invalidateAll() { campusDirty = densDirty = gridDirty = officersDirty = trapDirty = true; }
  M._invalidate = invalidateAll;

  /** campus[i] = 1 within Chebyshev 3 of any footprint tile or path/road tile (GDD §6.3 Threat, C31). */
  function rebuildCampus(state) {
    campus.fill(0);
    const owner = state.tiles.owner, surface = state.tiles.surface, r = PG.campusRadius;
    for (let i = 0; i < N; i++) {
      if (owner[i] < 0 && surface[i] !== SURF.PATH && surface[i] !== SURF.ROAD) continue;
      const tx = i & 63, ty = i >> 6;
      const x0 = Math.max(0, tx - r), x1 = Math.min(W - 1, tx + r), y0 = Math.max(0, ty - r), y1 = Math.min(H - 1, ty + r);
      for (let y = y0; y <= y1; y++) { const row = y * W; for (let x = x0; x <= x1; x++) campus[row + x] = 1; }
    }
    state.wildlife.campusMask = campus;
    campusDirty = false;
  }
  function campusOf(state) { heal(state); if (campusDirty) rebuildCampus(state); return campus; }

  /** Dens: water tiles with ≥ 2 four-adjacent Marsh tiles; fallback any Bayou tile, then any water tile. */
  function rebuildDens(state) {
    const type = state.tiles.type;
    dens = []; waterTiles = 0; marshTiles = 0;
    const bayou = [], water = [];
    for (let i = 0; i < N; i++) {
      const t = type[i];
      if (t === T.MARSH) { marshTiles++; continue; }
      if (!isWaterType(t)) continue;
      waterTiles++;
      if (t === T.BAYOU) bayou.push(i); else water.push(i);
      let marsh = 0;
      const nb = BSU.nbr4(i);
      for (let k = 0; k < nb.length; k++) if (type[nb[k]] === T.MARSH) marsh++;
      if (marsh >= PG.denMarshAdj) dens.push(i);
    }
    if (!dens.length) dens = bayou.length ? bayou : water;
    densDirty = false;
  }
  function densOf(state) { heal(state); if (densDirty) rebuildDens(state); return dens; }

  /** Gator grid (GDD §6.3): blocked = fence tiles, footprints (except turf rows), Tiger Habitat radius 10. */
  function rebuildGrid(state) {
    habitat.fill(0);
    const habs = listBuildings(state, 'tiger_habitat');
    for (let k = 0; k < habs.length; k++) {
      const b = habs[k];
      if (!isComplete(b)) continue;
      const row = (dep('data') && dep('data').catalog) ? dep('data').catalog.tiger_habitat : null;
      const rad = (row && row.effects && row.effects.gatorAvoidRadius > 0) ? row.effects.gatorAvoidRadius : PG.habitatRadius;
      const x0 = Math.max(0, b.tx - rad), x1 = Math.min(W - 1, b.tx + b.w - 1 + rad);
      const y0 = Math.max(0, b.ty - rad), y1 = Math.min(H - 1, b.ty + b.h - 1 + rad);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) habitat[y * W + x] = 1;
    }
    const owner = state.tiles.owner, surface = state.tiles.surface, blds = state.buildings || [];
    for (let i = 0; i < N; i++) {
      let ok = 1;
      if (surface[i] === SURF.FENCE || habitat[i]) ok = 0;
      else if (owner[i] >= 0) { const b = blds[owner[i]]; if (!b || !GATOR_TURF[b.type]) ok = 0; }
      passable[i] = ok;
    }
    gridDirty = false;
  }
  function gridOf(state) { heal(state); if (gridDirty) rebuildGrid(state); return passable; }

  // ---------------------------------------------------------------------------
  // Own router: 4-connected BFS with a passability predicate (fallback when agents.route is absent,
  // and for water-only swims). Returns number[] of tiles from `from` (exclusive) to `to` (inclusive), or null.
  // ---------------------------------------------------------------------------
  function bfsRoute(fromI, toI, pass, box) {
    if (fromI < 0 || toI < 0 || fromI >= N || toI >= N) return null;
    if (fromI === toI) return [];
    if (!pass(toI)) return null;
    bfsGen++;
    let head = 0, tail = 0;
    bfsQueue[tail++] = fromI; bfsSeen[fromI] = bfsGen; bfsParent[fromI] = -1;
    let found = false;
    while (head < tail) {
      const cur = bfsQueue[head++];
      const tx = cur & 63, ty = cur >> 6;
      // N, E, S, W
      for (let d = 0; d < 4; d++) {
        let nx = tx, ny = ty;
        if (d === 0) ny--; else if (d === 1) nx++; else if (d === 2) ny++; else nx--;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (box && (nx < box.x0 || nx > box.x1 || ny < box.y0 || ny > box.y1)) continue;
        const j = ny * W + nx;
        if (bfsSeen[j] === bfsGen) continue;
        if (j !== toI && !pass(j)) continue;
        bfsSeen[j] = bfsGen; bfsParent[j] = cur; bfsQueue[tail++] = j;
        if (j === toI) { found = true; break; }
      }
      if (found) break;
    }
    if (!found) return null;
    const out = [];
    for (let j = toI; j !== fromI && j >= 0; j = bfsParent[j]) out.push(j);
    out.reverse();
    return out;
  }

  /** Route on the gator grid: agents.route(…, 'gator', gator) when available (null = queued), else own BFS. */
  function routeGator(state, fromI, toI, g) {
    const grid = gridOf(state);
    const A = dep('agents'); const f = fn(A, 'route');
    if (f) {
      const r = f(state, fromI, toI, 'gator', g);
      if (r === null || r === undefined) return null;
      if (Array.isArray(r)) return (r.length && r[0] === fromI) ? r.slice(1) : r;
      return null;
    }
    return bfsRoute(fromI, toI, (i) => grid[i] === 1) || undefined;   // undefined = definitely unreachable
  }
  /** Water-only route (swims stay in the water), bounded to a window around the den. */
  function routeWater(state, fromI, toI, box) {
    const type = state.tiles.type;
    return bfsRoute(fromI, toI, (i) => isWaterType(type[i]), box);
  }
  /** Officer route on the walk grid: agents.route(…, 'walk') when available, else own BFS on tiles.walk > 0, else null. */
  function routeWalk(state, fromI, toI) {
    const A = dep('agents'); const f = fn(A, 'route');
    if (f) {
      const r = f(state, fromI, toI, 'walk');
      if (r === null || r === undefined) return null;
      if (Array.isArray(r)) return (r.length && r[0] === fromI) ? r.slice(1) : r;
      return null;
    }
    const walk = state.tiles.walk;
    return bfsRoute(fromI, toI, (i) => walk[i] > 0) || undefined;
  }

  // ---------------------------------------------------------------------------
  // Gators: population, spawning, targets
  // ---------------------------------------------------------------------------
  /** target = min(cap, base + floor(water/40) + floor(students/1000)) — always ≥ base (GDD §6.3). */
  function gatorTarget(water, students) {
    const w = isNum(water) ? Math.max(0, water) : 0, s = isNum(students) ? Math.max(0, students) : 0;
    return Math.min(PG.cap, PG.base + Math.floor(w / PG.perWaterTiles) + Math.floor(s / PG.perStudents));
  }
  M._gatorTarget = gatorTarget;

  function nearestDen(state, i) {
    const d = densOf(state);
    if (!d.length) return i;
    const tx = i & 63, ty = i >> 6;
    let best = d[0], bestD = 1e9;
    for (let k = 0; k < d.length; k++) { const dd = BSU.chebyshev(tx, ty, d[k] & 63, d[k] >> 6); if (dd < bestD) { bestD = dd; best = d[k]; } }
    return best;
  }
  /** Land tiles 8-adjacent to a den (the "bank"); passable ones first. */
  function bankTiles(state, den) {
    const out = [], grid = gridOf(state), nb = BSU.nbr8(den);
    for (let k = 0; k < nb.length; k++) if (isLandTile(state, nb[k]) && grid[nb[k]]) out.push(nb[k]);
    return out;
  }
  function gatorName(state, id) {
    const pool = names();
    const cycle = Math.floor(id / pool.length);
    let name = pool[id % pool.length] + (cycle > 0 ? ' ' + roman(cycle + 1) : '');
    if (name.indexOf('Praline') === 0 && state.storms && Array.isArray(state.storms.log) && state.storms.log.some(s => s && s.name === 'Praline')) name = 'Mudbug II';
    return name;
  }
  function makeGator(state, i, name, size) {
    const g = {
      id: nextGatorId++, name: name || gatorName(state, nextGatorId - 1),
      tx: (i & 63) + 0.5, ty: (i >> 6) + 0.5, px: 0, py: 0, dir: 0,
      state: 'SUN', size: size || (R.chance(PG.bigShare) ? 'big' : 'juvenile'),
      den: nearestDen(state, i), target: -1, route: [], ri: 0, lounge: 0,
      onCampus: false, lastIncidentDay: -1, tag: 0
    };
    g.px = g.tx; g.py = g.ty;
    return g;
  }
  /** Debug / wave / initial spawn: places a gator at tile i (WANDER when i is land, else SUN); emits gator:spawn. */
  function spawnGator(state, i, name) {
    ensureKeys(state);
    if (!isNum(i) || i < 0 || i >= N) { const d = densOf(state); i = d.length ? d[0] : 0; }
    i = Math.floor(i);
    const g = makeGator(state, i, name);
    if (isLandTile(state, i)) { g.state = 'WANDER'; g.target = i; g.route = []; }
    state.gators.push(g);
    emit(BSU.EV.GATOR_SPAWN, { id: g.id, name: g.name, den: g.den });
    return g;
  }
  function spawnAtRandomDen(state) {
    const d = densOf(state);
    const i = d.length ? R.pick(d) : (state.plot && isNum(state.plot.landing) && state.plot.landing >= 0 ? state.plot.landing : 0);
    return spawnGator(state, i);
  }
  /** Daily top-up toward the population target (never culls: no death). */
  function topUp(state) {
    densOf(state);
    const target = gatorTarget(waterTiles, state.economy ? state.economy.students : 0);
    let guard = 0;
    while (state.gators.length < target && guard++ < PG.cap) spawnAtRandomDen(state);
  }

  /** Attractor tiles within attractRadius of the den, with weights (GDD §6.3). */
  function attractors(state, g) {
    const out = [];   // {i, w}
    const den = g.den, dx = den & 63, dy = den >> 6, rad = PG.attractRadius, day = today(state);
    const grid = gridOf(state);
    const within = (i) => BSU.chebyshev(dx, dy, i & 63, i >> 6) <= rad;
    const push = (i, w) => { if (isNum(i) && i >= 0 && i < N && within(i)) out.push({ i: i, w: w }); };
    const game = gameDayNow(state), advisory = !!heatInfo(state).advisory;
    const blds = listBuildings(state);
    for (let k = 0; k < blds.length; k++) {
      const b = blds[k];
      if (!isComplete(b)) continue;
      if (b.type === 'dining_hall') {
        const proof = !!(b.data && b.data.policies && b.data.policies.gatorProofDumpsters);
        push(dumpsterOf(state, b), proof ? PG.weights.dumpsterProof : PG.weights.dumpster);
      } else if (b.type === 'greek_house') {
        if (BSU.inBounds(b.tx, b.ty + b.h)) push(BSU.idx(b.tx, b.ty + b.h), PG.weights.porch);   // the porch: the tile just south of the footprint (decision)
      } else if (b.type === 'parking' && game) {
        const fp = footprintOf(b); for (let q = 0; q < fp.length; q++) push(fp[q], PG.weights.parkingGameDay);
      } else if (b.type === 'rec_center' && advisory) {
        // the pool: the footprint's center tile is blocked to gators, so the target is the nearest passable edge tile (decision)
        const edge = BSU.edgeTiles(b.tx, b.ty, b.w, b.h);
        let best = -1, bestD = 1e9;
        const cx = b.tx + Math.floor(b.w / 2), cy = b.ty + Math.floor(b.h / 2);
        for (let q = 0; q < edge.length; q++) { if (!grid[edge[q]]) continue; const d = BSU.chebyshev(dx, dy, edge[q] & 63, edge[q] >> 6); if (d < bestD) { bestD = d; best = edge[q]; } }
        if (best >= 0) push(best, PG.weights.pool); else push(BSU.idx(cx, cy), PG.weights.pool);
      }
    }
    if (day <= trashUntilDay) {
      const Tr = dep('terrain'); const f = fn(Tr, 'paradeRoute');
      const route = f ? f(state) : [];
      if (Array.isArray(route)) for (let q = 0; q < route.length; q++) push(route[q], PG.weights.trash);
    }
    // flooded land tiles (depth ≥ .3) in the 25×25 window, ≤ 40 sampled by stride
    const depth = state.tiles.depth;
    const x0 = Math.max(0, dx - rad), x1 = Math.min(W - 1, dx + rad), y0 = Math.max(0, dy - rad), y1 = Math.min(H - 1, dy + rad);
    let flooded = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (depth[i] >= PG.floodedDepth && isLandTile(state, i) && grid[i]) {
        flooded++;
        if (out.length < 400 && (flooded <= FLOOD_SAMPLE_MAX || (flooded % 7) === 0)) push(i, PG.weights.flooded);
      }
    }
    return out;
  }
  /** p = wanderP × (1 + attraction) × matingMult in Apr–May, clamped to 1 (GDD §6.3). */
  function wanderP(attraction, month) {
    const mating = month >= PG.matingMonths[0] && month <= PG.matingMonths[1];
    return Math.min(1, PG.wanderP * (1 + Math.max(0, attraction)) * (mating ? PG.matingMult : 1));
  }
  M._wanderP = wanderP;

  function preserveTilesNear(state, den) {
    const flags = state.tiles.flags, grid = gridOf(state), out = [];
    const dx = den & 63, dy = den >> 6, rad = PG.preserveRadius;
    const x0 = Math.max(0, dx - rad), x1 = Math.min(W - 1, dx + rad), y0 = Math.max(0, dy - rad), y1 = Math.min(H - 1, dy + rad);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if ((flags[i] & FLAG.PRESERVE) && grid[i]) out.push(i); }
    return out;
  }
  /** The Dawn/Dusk wander roll for one gator (draws rng.sim). */
  function wanderRoll(state, g) {
    const list = attractors(state, g);
    let attraction = 0;
    for (let k = 0; k < list.length; k++) attraction += list[k].w;
    if (!R.chance(wanderP(attraction, BSU.dayParts(today(state)).month))) return false;
    let target = -1;
    const pres = preserveTilesNear(state, g.den);
    if (pres.length && R.chance(PG.preserveShare)) target = R.pick(pres);
    else if (list.length) {
      let r = R.float() * attraction, chosen = list[list.length - 1].i;
      for (let k = 0; k < list.length; k++) { r -= list[k].w; if (r <= 0) { chosen = list[k].i; break; } }
      target = chosen;
    } else {
      const bank = bankTiles(state, g.den);
      if (bank.length) target = R.pick(bank);
    }
    if (target < 0) return false;
    startWander(state, g, target);
    return true;
  }
  function startWander(state, g, target) {
    g.state = 'WANDER'; g.target = target; g.route = []; g.ri = 0;
    const p = privOf(g); p.wait = 0; p.wanderRoute = null; p.wanderFrom = -1;
  }
  function goSun(state, g, atBank) {
    g.state = 'SUN'; g.target = -1; g.route = []; g.ri = 0; g.lounge = 0;
    if (atBank) { const bank = bankTiles(state, g.den); if (bank.length) { const b = R.pick(bank); g.tx = (b & 63) + 0.5; g.ty = (b >> 6) + 0.5; } }
  }
  function startSwim(state, g) {
    const den = g.den, dx = den & 63, dy = den >> 6, rad = PG.attractRadius;
    const box = { x0: Math.max(0, dx - rad), x1: Math.min(W - 1, dx + rad), y0: Math.max(0, dy - rad), y1: Math.min(H - 1, dy + rad) };
    const type = state.tiles.type, cand = [];
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) { const i = y * W + x; if (isWaterType(type[i])) cand.push(i); }
    if (!cand.length) { goSun(state, g, false); return; }
    const to = R.pick(cand);
    let from = gatorTile(g);
    if (!isWaterType(type[from])) { from = den; g.tx = dx + 0.5; g.ty = dy + 0.5; }
    const r = routeWater(state, from, to, box);
    if (!r) { goSun(state, g, false); return; }
    g.state = 'SWIM'; g.target = to; g.route = r; g.ri = 0;
  }
  function stormRetreat(state) {
    if (retreatFlag) return true;
    const s = currentStorm(state);
    return !!(s && isNum(s.phase) && s.phase >= STORM.WATCH && s.phase <= STORM.LANDFALL);
  }
  function startRetreat(state, g) {
    g.state = 'RETREAT'; g.target = g.den; g.lounge = 0; g.ri = 0;
    const p = privOf(g), grid = gridOf(state);
    let route = null;
    if (p.wanderRoute && p.wanderRoute.length >= 2 && p.wanderFrom === g.den) {
      // the same route reversed (re-planned below if a tile on it became blocked, or if the wander did not start at the den)
      const rev = p.wanderRoute.slice(0, -1).reverse(); rev.push(g.den);
      let okRoute = true;
      for (let k = 0; k < rev.length - 1; k++) if (!grid[rev[k]]) { okRoute = false; break; }
      if (okRoute) route = rev;
    }
    g.route = route || []; p.wait = 0;
  }

  /** Advance a mover along its route; returns true when the route is exhausted. Sets px/py, dir. */
  function followRoute(state, g, tilesPerTick) {
    const route = g.route;
    if (!route || !route.length) return true;
    let budget = tilesPerTick;
    let guard = 0;
    while (budget > 0 && g.ri < route.length && guard++ < 8) {
      const node = route[g.ri];
      if (!isNum(node) || node < 0 || node >= N) { g.ri = route.length; break; }
      const cx = (node & 63) + 0.5, cy = (node >> 6) + 0.5;
      const dx = cx - g.tx, dy = cy - g.ty;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= budget || dist < 1e-6) { g.tx = cx; g.ty = cy; budget -= dist; g.ri++; if (dist > 1e-6) setDir(g, dx, dy); }
      else { g.tx += dx / dist * budget; g.ty += dy / dist * budget; setDir(g, dx, dy); budget = 0; }
    }
    if (!isNum(g.tx) || !isNum(g.ty)) { g.tx = (g.den & 63) + 0.5; g.ty = (g.den >> 6) + 0.5; }
    return g.ri >= route.length;
  }
  /** 0 = +tx (up-right), 1 = +ty (down-right), 2 = −tx, 3 = −ty (shared convention with agents/sprites). */
  function setDir(g, dx, dy) { g.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3); }
  function speedAt(state, g) {
    const i = gatorTile(g), t = state.tiles.type[i];
    const water = isWaterType(t) || t === T.POND || state.tiles.depth[i] >= BSU.params.hydro.thresholds.wading;
    return (water ? PG.swimSpeed : PG.walkSpeed) / BSU.params.time.tps;
  }

  /** One gator, one tick (10 Hz). */
  function stepGator(state, g, retreating, day) {
    g.px = g.tx; g.py = g.ty;
    if (g.tag > 0) g.tag--;
    const p = privOf(g);
    if (retreating && (g.state === 'WANDER' || g.state === 'LOUNGE')) { p.wanderRoute = p.wanderRoute || g.route; startRetreat(state, g); }
    if (retreating && g.state === 'SWIM') { g.state = 'RETREAT'; g.target = g.den; g.route = []; g.ri = 0; }
    switch (g.state) {
      case 'SUN': {
        // on a storm watch every gator waits it out IN the water at its den (GDD §6.2 T−3); the bank is adjacent, so a one-tile slide
        if (retreating && gatorTile(g) !== g.den && isNum(g.den) && g.den >= 0 && g.den < N) { g.tx = (g.den & 63) + 0.5; g.ty = (g.den >> 6) + 0.5; }
        break;
      }
      case 'WRANGLED': break;
      case 'SWIM': {
        if (followRoute(state, g, speedAt(state, g))) { if (R.chance(0.5)) startSwim(state, g); else goSun(state, g, false); }
        break;
      }
      case 'WANDER': {
        if (!g.route.length) {
          const from = gatorTile(g);
          if (g.target === from) { g.state = 'LOUNGE'; g.lounge = Math.floor(R.range(PG.loungeTicks[0], PG.loungeTicks[1])); p.wanderRoute = [from]; break; }
          const r = routeGator(state, from, g.target, g);
          if (r === undefined) { goSun(state, g, false); break; }          // unreachable: wander cancelled (GDD §6.3)
          if (r === null) { if (++p.wait > ROUTE_GIVEUP_TICKS) goSun(state, g, false); break; }
          if (!r.length) { g.state = 'LOUNGE'; g.lounge = Math.floor(R.range(PG.loungeTicks[0], PG.loungeTicks[1])); p.wanderRoute = [from]; break; }
          g.route = r; g.ri = 0; p.wanderRoute = r; p.wanderFrom = from; p.wait = 0;
        }
        if (followRoute(state, g, speedAt(state, g))) { g.state = 'LOUNGE'; g.lounge = Math.floor(R.range(PG.loungeTicks[0], PG.loungeTicks[1])); }
        break;
      }
      case 'LOUNGE': {
        if (--g.lounge <= 0) { g.lounge = 0; startRetreat(state, g); }
        break;
      }
      case 'RETREAT': {
        if (!g.route.length) {
          const from = gatorTile(g);
          if (from === g.den) { goSun(state, g, false); break; }
          const r = routeGator(state, from, g.den, g);
          if (r === undefined) { g.tx = (g.den & 63) + 0.5; g.ty = (g.den >> 6) + 0.5; goSun(state, g, false); break; }   // stranded: slips back into the water
          if (r === null) { if (++p.wait > ROUTE_GIVEUP_TICKS * 4) { g.tx = (g.den & 63) + 0.5; g.ty = (g.den >> 6) + 0.5; goSun(state, g, false); } break; }
          if (!r.length) { goSun(state, g, false); break; }
          g.route = r; g.ri = 0; p.wait = 0;
        }
        if (followRoute(state, g, speedAt(state, g))) goSun(state, g, false);
        break;
      }
      default: goSun(state, g, false);
    }
    // campus membership, tag, incident (one per gator per day)
    const i = gatorTile(g);
    const on = campusOf(state)[i] === 1;
    if (on !== g.onCampus) {
      g.onCampus = on; g.tag = PG.tagTicks;
      emit(BSU.EV.GATOR_CAMPUS, { id: g.id, name: g.name, i: i, enter: on, target: g.target });
    }
    if (on && g.lastIncidentDay !== day) {
      g.lastIncidentDay = day;
      const wl = state.wildlife;
      wl.incidents.push({ day: day, gatorId: g.id, tile: i });
      emit(BSU.EV.GATOR_INCIDENT, { id: g.id, name: g.name, i: i, kind: incidentKind(state, i) });
    }
  }
  /** 'pool' | 'field' | 'dumpster' | 'building' | 'tile' (brief §4; pool = within 1 of a Rec Center, decision). */
  function incidentKind(state, i) {
    const tx = i & 63, ty = i >> 6, owner = state.tiles.owner, blds = state.buildings || [];
    const o = owner[i];
    if (o >= 0 && blds[o] && (blds[o].type === 'practice_field' || blds[o].type === 'stadium') && gameDayNow(state)) return 'field';
    let nearBuilding = false, pool = false;
    for (let y = Math.max(0, ty - 2); y <= Math.min(H - 1, ty + 2); y++) for (let x = Math.max(0, tx - 2); x <= Math.min(W - 1, tx + 2); x++) {
      const oo = owner[y * W + x];
      if (oo < 0) continue;
      nearBuilding = true;
      if (blds[oo] && blds[oo].type === 'rec_center' && BSU.chebyshev(tx, ty, x, y) <= 1) pool = true;
    }
    if (pool) return 'pool';
    const dining = listBuildings(state, 'dining_hall');
    for (let k = 0; k < dining.length; k++) if (dumpsterOf(state, dining[k]) === i) return 'dumpster';
    return nearBuilding ? 'building' : 'tile';
  }

  /** Sky-phase transitions: DAY → SUN/SWIM split; DAWN/DUSK → wander rolls (gators in index order). */
  function onPhaseChange(state, phase) {
    const retreating = stormRetreat(state);
    const gs = state.gators;
    if (phase === SKY.DAY) {
      for (let k = 0; k < gs.length; k++) {
        const g = gs[k];
        if (g.state !== 'SUN' && g.state !== 'SWIM') continue;
        if (retreating) { if (g.state === 'SWIM') { g.state = 'RETREAT'; g.route = []; g.ri = 0; } continue; }
        if (R.chance(PG.sunShare)) goSun(state, g, true); else startSwim(state, g);
      }
    } else if (phase === SKY.DAWN || phase === SKY.DUSK) {
      if (retreating) return;
      for (let k = 0; k < gs.length; k++) { const g = gs[k]; if (g.state === 'SUN' || g.state === 'SWIM') wanderRoll(state, g); }
    }
  }

  // ---------------------------------------------------------------------------
  // Officers (§0.3 row 34)
  // ---------------------------------------------------------------------------
  function reconcileOfficers(state) {
    const wl = state.wildlife, posts = listBuildings(state, 'wildlife_post');
    const alive = {};
    for (let k = 0; k < posts.length; k++) if (isComplete(posts[k])) alive[posts[k].id] = posts[k];
    for (let k = wl.officers.length - 1; k >= 0; k--) {
      const o = wl.officers[k];
      if (!o || !alive[o.post]) { releaseWrangled(state, o); wl.officers.splice(k, 1); continue; }
      if (!isNum(o.tx) || !isNum(o.ty)) { o.tx = alive[o.post].tx + 0.5; o.ty = alive[o.post].ty + 0.5; }
      if (!isNum(o.cooldown)) o.cooldown = 0;
      if (!Array.isArray(o.route)) o.route = [];
      if (!isNum(o.ri)) o.ri = 0;
      if (!isNum(o.wrangle)) o.wrangle = 0;
      delete alive[o.post];
    }
    for (const id in alive) {
      const b = alive[id];
      wl.officers.push({ post: b.id, tx: b.tx + 0.5, ty: b.ty + 0.5, px: b.tx + 0.5, py: b.ty + 0.5, state: 'IDLE', target: -1, cooldown: 0, route: [], ri: 0, wrangle: 0, dir: 1 });
    }
    officersDirty = false;
  }
  function releaseWrangled(state, o) {
    if (!o || o.target < 0) return;
    const g = findGator(state, o.target);
    if (g && g.state === 'WRANGLED') goSun(state, g, false);
  }
  function findGator(state, id) { const gs = state.gators; for (let k = 0; k < gs.length; k++) if (gs[k].id === id) return gs[k]; return null; }
  function postOf(state, o) { const b = (state.buildings || [])[o.post]; return b || null; }

  function stepOfficer(state, o) {
    o.px = o.tx; o.py = o.ty;
    if (o.cooldown > 0) o.cooldown--;
    const post = postOf(state, o);
    if (!post) return;
    const postTile = BSU.idx(post.tx, post.ty);
    const speed = PG.officerSpeed / BSU.params.time.tps;
    switch (o.state) {
      case 'IDLE': {
        if (o.cooldown > 0) break;
        const cm = campusOf(state), gs = state.gators;
        let best = null, bestD = 1e9;
        for (let k = 0; k < gs.length; k++) {
          const g = gs[k];
          if (g.state === 'WRANGLED') continue;
          const i = gatorTile(g);
          if (!cm[i]) continue;
          const d = BSU.chebyshev(post.tx, post.ty, i & 63, i >> 6);
          if (d <= PG.officerRadius && d < bestD) { bestD = d; best = g; }
        }
        if (best) { o.state = 'WALK'; o.target = best.id; o.route = []; o.ri = 0; }
        break;
      }
      case 'WALK': {
        const g = findGator(state, o.target);
        if (!g || g.state === 'WRANGLED' || !campusOf(state)[gatorTile(g)]) { o.state = 'RETURN'; o.target = -1; o.route = []; o.ri = 0; break; }
        const gi = gatorTile(g), oi = tileOf(o.tx, o.ty);
        if (BSU.chebyshev(oi & 63, oi >> 6, gi & 63, gi >> 6) <= 1) {
          o.state = 'WRANGLE'; o.wrangle = PG.wrangleTicks; g.state = 'WRANGLED'; g.route = []; g.ri = 0; break;
        }
        if (!o.route.length || o.route[o.route.length - 1] !== gi) {
          const r = routeWalk(state, oi, gi);
          if (r === null) break;                                                     // queued: retry next tick
          if (r === undefined || !r.length) { moveStraight(o, gi, speed); break; }   // no walk route: cut across (fallback)
          o.route = r; o.ri = 0;
        }
        followRoute(state, o, speed);
        break;
      }
      case 'WRANGLE': {
        if (--o.wrangle > 0) break;
        o.wrangle = 0;
        relocate(state, o.target, true);
        o.state = 'RETURN'; o.target = -1; o.route = []; o.ri = 0; o.cooldown = PG.relocateCooldown;
        break;
      }
      case 'RETURN': {
        const oi = tileOf(o.tx, o.ty);
        if (oi === postTile) { o.tx = post.tx + 0.5; o.ty = post.ty + 0.5; o.state = 'IDLE'; o.route = []; o.ri = 0; break; }
        if (!o.route.length || o.route[o.route.length - 1] !== postTile) {
          const r = routeWalk(state, oi, postTile);
          if (r === null) break;
          if (r === undefined || !r.length) { moveStraight(o, postTile, speed); if (tileOf(o.tx, o.ty) === postTile) { o.state = 'IDLE'; } break; }
          o.route = r; o.ri = 0;
        }
        if (followRoute(state, o, speed)) { o.state = 'IDLE'; o.route = []; o.ri = 0; }
        break;
      }
      default: o.state = 'IDLE';
    }
  }
  function moveStraight(o, toI, speed) {
    const cx = (toI & 63) + 0.5, cy = (toI >> 6) + 0.5, dx = cx - o.tx, dy = cy - o.ty, d = Math.sqrt(dx * dx + dy * dy);
    if (d <= speed || d < 1e-6) { o.tx = cx; o.ty = cy; } else { o.tx += dx / d * speed; o.ty += dy / d * speed; }
    setDir(o, dx, dy);
  }
  /** Gator → nearest den or preserve tile, SUN; relocations++; gator:relocated. */
  function relocate(state, gatorId, byPost) {
    const g = findGator(state, gatorId);
    if (!g) return;
    const i = gatorTile(g), tx = i & 63, ty = i >> 6;
    let best = nearestDen(state, i), bestD = BSU.chebyshev(tx, ty, best & 63, best >> 6);
    const flags = state.tiles.flags, grid = gridOf(state);
    for (let j = 0; j < N; j++) if ((flags[j] & FLAG.PRESERVE) && grid[j]) { const d = BSU.chebyshev(tx, ty, j & 63, j >> 6); if (d < bestD) { bestD = d; best = j; } }
    g.tx = (best & 63) + 0.5; g.ty = (best >> 6) + 0.5; g.px = g.tx; g.py = g.ty;
    g.den = nearestDen(state, best);
    goSun(state, g, false);
    state.wildlife.relocations = (isNum(state.wildlife.relocations) ? state.wildlife.relocations : 0) + 1;
    emit(BSU.EV.GATOR_RELOCATED, { id: g.id, name: g.name, byPost: !!byPost });
  }

  // ---------------------------------------------------------------------------
  // Le Grand (GDD §6.3)
  // ---------------------------------------------------------------------------
  function lakeTiles(state) {
    const lake = (state.plot && Array.isArray(state.plot.lake)) ? state.plot.lake.filter(i => isNum(i) && i >= 0 && i < N && isWaterType(state.tiles.type[i])) : [];
    return lake.length ? lake : densOf(state);
  }
  function drawLeGrandDay(state) {
    const apr1 = dayOf(state, 'Apr 1');
    state.wildlife.leGrandDay = apr1 >= 0 ? apr1 + R.int(10) : -1;
  }
  function leGrandTick(state, day, newDay) {
    const wl = state.wildlife;
    if (wl.leGrand) {
      const g = wl.leGrand;
      if (newDay && wl.leGrandDay >= 0 && day >= wl.leGrandDay + PG.leGrandDays) { wl.leGrand = null; wl.leGrandDay = -1; return; }
      g.px = g.tx; g.py = g.ty;
      if (g.tag > 0) g.tag--;
      if (g.state === 'SWIM') {
        if (followRoute(state, g, PG.swimSpeed / BSU.params.time.tps)) { g.state = 'SUN'; g.lounge = LEGRAND_SWIM_TICKS; }
      } else {
        if (--g.lounge <= 0) {
          const lake = lakeTiles(state);
          const to = lake.length ? R.pick(lake) : -1;
          const from = gatorTile(g);
          const r = to >= 0 ? routeWater(state, from, to, null) : null;
          if (r && r.length) { g.state = 'SWIM'; g.target = to; g.route = r; g.ri = 0; } else g.lounge = LEGRAND_SWIM_TICKS;
        }
      }
      return;
    }
    if (newDay && wl.leGrandDay >= 0 && day >= wl.leGrandDay && day < wl.leGrandDay + PG.leGrandDays) {
      const lake = lakeTiles(state);
      const at = lake.length ? R.pick(lake) : (densOf(state)[0] || 0);
      const g = makeGator(state, at, 'Le Grand', 'legend');
      g.id = -1; g.den = at; g.lounge = LEGRAND_SWIM_TICKS; g.tag = PG.tagTicks;
      wl.leGrand = g;
      const Pr = dep('progress'); const tk = fn(Pr, 'ticker');
      if (tk) tk(state, 4, {}, 'wildlife', at);
    }
  }

  // ---------------------------------------------------------------------------
  // Mosquito field (GDD §6.4)
  // ---------------------------------------------------------------------------
  function disturbedMask(state) {
    const Tr = dep('terrain'); const f = fn(Tr, 'isDisturbedMarsh');
    const type = state.tiles.type;
    if (f) { for (let i = 0; i < N; i++) disturbedBuf[i] = (type[i] === T.MARSH && f(state, i)) ? 1 : 0; return disturbedBuf; }
    // own rule (terrain brief): Marsh within Chebyshev 2 of any footprint tile or path/road/boardwalk tile
    u8Buf.fill(0);
    const owner = state.tiles.owner, surface = state.tiles.surface, r = PM.disturbRadius;
    for (let i = 0; i < N; i++) {
      if (owner[i] < 0 && (surface[i] < SURF.PATH || surface[i] > SURF.BOARDWALK)) continue;
      const tx = i & 63, ty = i >> 6;
      for (let y = Math.max(0, ty - r); y <= Math.min(H - 1, ty + r); y++) for (let x = Math.max(0, tx - r); x <= Math.min(W - 1, tx + r); x++) u8Buf[y * W + x] = 1;
    }
    for (let i = 0; i < N; i++) disturbedBuf[i] = (type[i] === T.MARSH && u8Buf[i]) ? 1 : 0;
    return disturbedBuf;
  }
  function stormDayNow(state, day) {
    const s = currentStorm(state);
    if (!s || !isNum(s.phase)) return false;
    if (s.phase === STORM.BANDS || s.phase === STORM.LANDFALL) return true;
    if (s.phase === STORM.RECOVERY) { const ld = state.storms ? state.storms.lastLandfallDay : -1; return isNum(ld) && ld >= 0 && day <= ld + 1; }
    return false;
  }
  function bloomNow(state, day) {
    const ld = state.storms ? state.storms.lastLandfallDay : -1;
    return isNum(ld) && ld >= 0 && day >= ld + BSU.params.storm.mosqBloomDay && day < ld + BSU.params.storm.mosqBloomDay + 7;
  }
  /** Sources per tile into srcBuf (already multiplied by the storm / low-ecology / bloom factors). */
  function buildSources(state, day) {
    srcBuf.fill(0);
    const type = state.tiles.type, stand = state.tiles.stand;
    const disturbed = disturbedMask(state);
    // flooded-building footprints
    u8Buf.fill(0);
    const blds = listBuildings(state);
    for (let k = 0; k < blds.length; k++) { const b = blds[k]; if (b.flooded) { const fp = footprintOf(b); for (let q = 0; q < fp.length; q++) u8Buf[fp[q]] = 1; } }
    const Hy = dep('hydro'); const isMud = fn(Hy, 'isMud');
    for (let i = 0; i < N; i++) {
      const t = type[i];
      if (isWaterType(t)) continue;
      let s = 0;
      if (t === T.MARSH) s = disturbed[i] ? PM.marshDisturbed : PM.marsh;
      else if (stand[i] >= PM.standDays) s = u8Buf[i] ? PM.standFlooded : PM.stand;
      if (isMud && isMud(state, i)) { if (!mudApplied[i]) { s += PM.mud; mudApplied[i] = 1; } }
      else mudApplied[i] = 0;
      srcBuf[i] = s;
    }
    const nets = fn(Hy, 'networks') ? Hy.networks(state) : null;
    if (Array.isArray(nets)) for (let k = 0; k < nets.length; k++) {
      const n = nets[k];
      if (!n || n.drainsToWater || (n.pumps && n.pumps.length)) continue;
      if (Array.isArray(n.tiles)) for (let q = 0; q < n.tiles.length; q++) { const i = n.tiles[q]; if (i >= 0 && i < N) srcBuf[i] += PM.canalUnconnected; }
    }
    const ponds = listBuildings(state, 'pond');
    for (let k = 0; k < ponds.length; k++) {
      const b = ponds[k];
      const sd = (b.data && isNum(b.data.stockedDay)) ? b.data.stockedDay : -1;
      if (sd >= 0 && day >= sd) continue;
      const fp = footprintOf(b); for (let q = 0; q < fp.length; q++) srcBuf[fp[q]] += PM.pondUnstocked;
    }
    let mult = 1;
    if (stormDayNow(state, day)) mult *= PM.stormMult;
    if (state.wildlife.ecology < PE.lowThreshold) mult *= PM.lowEcoMult;
    if (bloomNow(state, day)) mult *= 2;
    if (mult !== 1) for (let i = 0; i < N; i++) srcBuf[i] *= mult;
  }
  /** Multiplicative sinks per tile (stocked ponds, bat houses, preserve cypress, active abatement). */
  function buildSinks(state, day) {
    sinkMul.fill(1);
    u8Buf.fill(0);   // bat-house count per tile
    const blds = listBuildings(state);
    for (let k = 0; k < blds.length; k++) {
      const b = blds[k];
      if (!isComplete(b)) continue;
      if (b.type === 'pond') {
        const sd = (b.data && isNum(b.data.stockedDay)) ? b.data.stockedDay : -1;
        if (sd >= 0 && day >= sd) mulWindow(b.tx, b.ty, PM.pondRadius, 1 - PM.pondSink);
      } else if (b.type === 'bat_house') {
        const r = PM.batRadius;
        for (let y = Math.max(0, b.ty - r); y <= Math.min(H - 1, b.ty + r); y++) for (let x = Math.max(0, b.tx - r); x <= Math.min(W - 1, b.tx + r); x++) u8Buf[y * W + x]++;
      } else if (b.type === 'abatement') {
        const active = !(b.data && b.data.active === false);
        if (active && effectiveOf(state, b) > 0) mulWindow(b.tx, b.ty, PM.fogRadius, 1 - PM.fogSink);
      }
    }
    const batMin = 1 - PM.batStack, batOne = 1 - PM.batSink;
    for (let i = 0; i < N; i++) if (u8Buf[i]) sinkMul[i] *= Math.max(batMin, Math.pow(batOne, u8Buf[i]));
    const veg = state.veg || [], flags = state.tiles.flags;
    for (let k = 0; k < veg.length; k++) {
      const v = veg[k];
      if (!v || v.type !== 'cypress' || !BSU.inBounds(v.tx, v.ty)) continue;
      const i = BSU.idx(v.tx, v.ty);
      if (flags[i] & FLAG.PRESERVE) sinkMul[i] *= (1 - PM.preserveCypress);
    }
  }
  function mulWindow(tx, ty, r, m) {
    for (let y = Math.max(0, ty - r); y <= Math.min(H - 1, ty + r); y++) for (let x = Math.max(0, tx - r); x <= Math.min(W - 1, tx + r); x++) sinkMul[y * W + x] *= m;
  }
  function decayFor(state, day) {
    const yd = day % BSU.params.time.daysPerYear;
    const coldStart = BSU.dateToDay('Dec 10', 1) + 1;   // 'Dec 11' does not parse (10-day months): the day after Dec 10 = yd 110
    const coldEnd = BSU.dateToDay(PM.coldEnd, 1);        // Feb 10 = yd 19
    if (yd >= coldStart || yd <= coldEnd) return PM.decayCold;
    if (heatInfo(state).index > PM.hotIndex) return PM.decayHot;
    return PM.decay;
  }
  /**
   * One daily mosquito step (also the selfTest hook M._mosqStep(state, {decay, sources})).
   * Diffusion is written in exchange form — new[i] = cur[i] + (d/4)·Σ(cur[j] − cur[i]) over the 4-neighbors —
   * which equals the brief's .85·cur + .15·mean in the interior and conserves mass on a closed land block.
   * Returns {sumBefore, sumAfter} of the diffusion pass in double precision.
   */
  function mosqStep(state, opts) {
    opts = opts || {};
    const day = today(state);
    const mosq = state.tiles.mosq, type = state.tiles.type;
    const useSources = opts.sources !== false;
    if (useSources) buildSources(state, day); else srcBuf.fill(0);
    if (opts.sinks === false) sinkMul.fill(1); else buildSinks(state, day);
    const d4 = PM.diffusion / 4;
    let sumBefore = 0, sumAfter = 0;
    for (let i = 0; i < N; i++) {
      const v = mosq[i];
      sumBefore += v;
      if (isWaterType(type[i])) { dblBuf[i] = 0; continue; }
      const tx = i & 63, ty = i >> 6;
      let acc = 0;
      if (ty > 0) acc += mosq[i - W] - v;
      if (tx < W - 1) acc += mosq[i + 1] - v;
      if (ty < H - 1) acc += mosq[i + W] - v;
      if (tx > 0) acc += mosq[i - 1] - v;
      dblBuf[i] = v + d4 * acc;
    }
    for (let i = 0; i < N; i++) sumAfter += dblBuf[i];
    const decay = isNum(opts.decay) ? opts.decay : decayFor(state, day);
    for (let i = 0; i < N; i++) {
      if (isWaterType(type[i])) { mosq[i] = 0; continue; }
      let v = dblBuf[i] + srcBuf[i] - decay;
      if (v < 0) v = 0;
      v *= sinkMul[i];
      if (!(v >= 0)) v = 0;   // NaN guard
      mosq[i] = v > 1 ? 1 : v;
    }
    return { sumBefore: sumBefore, sumAfter: sumAfter };
  }
  M._mosqStep = function (state, opts) { heal(state); return mosqStep(state, opts); };

  /** Campus index, warnings, biblical counter, illness (daily). */
  function mosqIndexStep(state, day) {
    const wl = state.wildlife, mosq = state.tiles.mosq;
    const agents = agentList(state);
    let sum = 0, n = 0;
    for (let k = 0; k < agents.length; k++) {
      const a = agents[k];
      if (!a || a.state === 'GONE' || !isNum(a.tx) || !isNum(a.ty)) continue;
      const tx = Math.floor(a.tx), ty = Math.floor(a.ty);
      if (!BSU.inBounds(tx, ty)) continue;
      sum += mosq[ty * W + tx]; n++;
    }
    const index = n ? sum / n : 0;
    wl.mosqIndex = isNum(index) ? index : 0;
    if (n > 0) {
      if (wl.mosqIndex >= PM.warnIndex && wl.mosqWarnedDay === -1) { wl.mosqWarnedDay = day; emit(BSU.EV.MOSQUITO_WARNING, { index: wl.mosqIndex, worstTile: worstCampusTile(state) }); }
      if (wl.mosqIndex > PM.biblical) { wl.biblicalDays++; if (wl.biblicalDays === 1) emit(BSU.EV.MOSQUITO_WARNING, { index: wl.mosqIndex, worstTile: worstCampusTile(state) }); }
      else wl.biblicalDays = 0;
    } else wl.biblicalDays = 0;
    // illness (GDD §6.4, §6.6): Health Center presence applies to the whole term (decision)
    const students = (state.economy && isNum(state.economy.students)) ? state.economy.students : 0;
    const health = hasBuilding(state, 'health_center');
    const sickMosq = students * wl.mosqIndex * PM.illness * (health ? PM.healthMult : 1);
    const heat = heatInfo(state);
    const sickHeat = heat.advisory ? students * BSU.params.heat.illness * (health ? BSU.params.heat.healthMult : 1) : 0;
    wl.sick = Math.max(0, Math.round(sickMosq + sickHeat));
    if (!isNum(wl.sick)) wl.sick = 0;
  }
  function worstCampusTile(state) {
    const cm = campusOf(state), mosq = state.tiles.mosq;
    let best = -1, bestV = -1;
    for (let i = 0; i < N; i++) if (cm[i] && mosq[i] > bestV) { bestV = mosq[i]; best = i; }
    if (best < 0) for (let i = 0; i < N; i++) if (mosq[i] > bestV) { bestV = mosq[i]; best = i; }
    return best < 0 ? 0 : best;
  }

  // ---------------------------------------------------------------------------
  // Nutria (GDD §6.7; monthly)
  // ---------------------------------------------------------------------------
  /** Pure over state (terrain.gen may call it on a new root before reset, §1): a complete Wildlife Post within 14 of tile i. */
  function nutriaTraps(state, i) {
    if (!isNum(i) || i < 0 || i >= N) return false;
    const day = today(state);
    if (trapDirty || trapRoot !== state || trapDay !== day) {
      trapMask.fill(0);
      const arr = state.buildings || [], r = PN.trapRadius;
      for (let k = 0; k < arr.length; k++) {
        const b = arr[k];
        if (!b || b.type !== 'wildlife_post' || !isComplete(b) || !BSU.inBounds(b.tx, b.ty)) continue;
        for (let y = Math.max(0, b.ty - r); y <= Math.min(H - 1, b.ty + r); y++) for (let x = Math.max(0, b.tx - r); x <= Math.min(W - 1, b.tx + r); x++) trapMask[y * W + x] = 1;
      }
      trapDirty = false; trapRoot = state; trapDay = day;
    }
    return trapMask[i | 0] === 1;
  }
  function nutriaStep(state, day) {
    const wl = state.wildlife;
    densOf(state);
    wl.nutria = PN.base + Math.floor(marshTiles / PN.perMarsh);
    // candidate earthen levee tiles (crest 6) within 10 of any Marsh tile
    const crest = state.tiles.crest, type = state.tiles.type, cand = [];
    for (let i = 0; i < N; i++) {
      if (crest[i] !== 6) continue;
      const tx = i & 63, ty = i >> 6;
      let near = false;
      for (let y = Math.max(0, ty - PN.burrowRadius); y <= Math.min(H - 1, ty + PN.burrowRadius) && !near; y++)
        for (let x = Math.max(0, tx - PN.burrowRadius); x <= Math.min(W - 1, tx + PN.burrowRadius); x++) if (type[y * W + x] === T.MARSH) { near = true; break; }
      if (near) cand.push(i);
    }
    for (let k = 0; k < wl.nutria; k++) {
      if (!R.chance(PN.burrowP)) continue;
      if (!cand.length) continue;
      const i = R.pick(cand);
      if (nutriaTraps(state, i) && R.chance(1 - PN.trapMult)) continue;   // traps: −80%
      burrow(state, i, day);
    }
  }
  function burrow(state, i, day) {
    const integ = state.tiles.integrity;
    integ[i] = Math.max(0, integ[i] - PN.burrowDmg);
    const B = dep('buildings'); const f = fn(B, 'onIntegrityChanged');
    if (f) f(state, i);
    const log = state.wildlife.burrowLog;
    const e = log[i] || (log[i] = { n: 0, day: -1 });
    e.n++; e.day = day;
    emit(BSU.EV.LEVEE_BURROW, { i: i, tx: i & 63, ty: i >> 6, integrity: integ[i] });
  }
  M._burrow = function (state, i) { heal(state); ensureKeys(state); burrow(state, i, today(state)); };

  // ---------------------------------------------------------------------------
  // Ecology (GDD §6.8; daily)
  // ---------------------------------------------------------------------------
  function wetlandLost(state) {
    const flags = state.tiles.flags, crest = state.tiles.crest, surface = state.tiles.surface;
    let drained = 0, other = 0;
    for (let i = 0; i < N; i++) {
      const f = flags[i];
      if (!(f & FLAG.WETLAND_ORIGINAL)) continue;
      if (f & FLAG.DRAINED) drained++;
      else if ((f & FLAG.CANAL) || crest[i] > 0 || (f & FLAG.POND_SINK) || surface[i] === SURF.PATH) other++;
    }
    return PE.drainedMult * drained + other;
  }
  function ecologyTermsOf(state) {
    const wl = state.wildlife, flags = state.tiles.flags, crest = state.tiles.crest, day = today(state);
    let preserve = 0, canalMarsh = 0, leveeMarsh = 0;
    for (let i = 0; i < N; i++) {
      const f = flags[i];
      if (f & FLAG.PRESERVE) preserve++;
      if (f & FLAG.WETLAND_ORIGINAL) { if (f & FLAG.CANAL) canalMarsh++; if (crest[i] > 0) leveeMarsh++; }
    }
    const veg = state.veg || [];
    let cypress = 0, oaks = 0;
    for (let k = 0; k < veg.length; k++) { const v = veg[k]; if (!v) continue; if (v.type === 'cypress') cypress++; else if (v.type === 'oak') oaks++; }
    let quads = 0, posts = 0, ponds = 0, barrier = 0;
    const blds = listBuildings(state);
    for (let k = 0; k < blds.length; k++) {
      const b = blds[k];
      if (!isComplete(b)) continue;
      if (b.type === 'quad') quads++;
      else if (b.type === 'wildlife_post') posts++;
      else if (b.type === 'pond') { const sd = (b.data && isNum(b.data.stockedDay)) ? b.data.stockedDay : -1; if (sd >= 0 && day >= sd) ponds++; }
      else if (b.type === 'surge_barrier') barrier++;
    }
    const B = dep('buildings'); const sf = fn(B, 'stats');
    if (sf) { try { const s = sf(state); if (s) { if (isNum(s.oaks)) oaks = Math.max(oaks + quads, s.oaks), quads = 0; if (isNum(s.cypress)) cypress = Math.max(cypress, s.cypress); if (isNum(s.stockedPonds)) ponds = Math.max(ponds, s.stockedPonds); if (isNum(s.posts)) posts = Math.max(posts, s.posts); } } catch (e) { BSU.error('wildlife', 'stats', e); } }
    const oakCount = oaks + quads;
    const original = Math.max(1, isNum(wl.wetlandOriginal) ? wl.wetlandOriginal : 0);
    const lost = wetlandLost(state);
    const once = isNum(wl.ecologyTerms && wl.ecologyTerms.once) ? wl.ecologyTerms.once : 0;
    const fogger = isNum(wl.foggerPenalty) ? wl.foggerPenalty : 0;
    const terms = {
      wetland: PE.wetlandWeight * (1 - lost / original),
      wetlandLost: lost, wetlandOriginal: original,
      preserve: Math.min(PE.preserveCap, PE.preserve * preserve),
      cypress: Math.min(PE.cypressCap, PE.cypress * cypress),
      oak: Math.min(PE.oakCap, PE.oak * oakCount),
      ponds: Math.min(PE.pondCap, PE.pond * ponds),
      posts: PE.post * posts,
      fogger: -fogger,
      canalMarsh: -PE.canalMarsh * canalMarsh,
      leveeMarsh: -PE.leveeMarsh * leveeMarsh,
      barrier: -PE.barrierPenalty * (barrier > 0 ? 1 : 0),
      once: once
    };
    const raw = terms.wetland + terms.preserve + terms.cypress + terms.oak + terms.ponds + terms.posts + terms.fogger + terms.canalMarsh + terms.leveeMarsh + terms.barrier + terms.once;
    terms.sum = isNum(raw) ? raw : 0;         // unclamped (forceEcology solves for `once` against it)
    terms.raw = clamp(terms.sum, 0, 100);
    return terms;
  }
  /** Daily recompute; the Coastal Institute halves every downward move (decision, GDD §6.8). */
  function ecologyStep(state, first) {
    const wl = state.wildlife;
    const terms = ecologyTermsOf(state);
    const prev = isNum(wl.ecology) ? wl.ecology : terms.raw;
    let next = terms.raw;
    if (!first && next < prev && hasBuilding(state, 'coastal_institute')) next = prev + (next - prev) * PE.instituteMult;
    next = clamp(next, 0, 100);
    wl.ecology = next;
    wl.ecologyTerms = terms;
    if (!first && Math.abs(next - prev) >= 1) emit(BSU.EV.ECOLOGY_CHANGED, { value: next, prev: prev });
    birdsStep(state);
  }
  function foggerStep(state) {
    const wl = state.wildlife;
    const Pr = dep('progress'); const tf = fn(Pr, 'timer');
    const waived = !!(tf && tf(state, 'voiceFoggerWaiver'));   // Tier 2 voice payoff (batHouse)
    let active = 0;
    const abs = listBuildings(state, 'abatement');
    for (let k = 0; k < abs.length; k++) { const b = abs[k]; if (isComplete(b) && !(b.data && b.data.active === false)) active++; }
    const inst = hasBuilding(state, 'coastal_institute') ? PE.instituteMult : 1;
    let fp = isNum(wl.foggerPenalty) ? wl.foggerPenalty : 0;
    if (active > 0 && !waived) fp += PE.fogger * active * inst;
    else fp -= PE.foggerRecover;
    wl.foggerPenalty = clamp(fp, 0, PE.foggerCap);
  }
  function birdsStep(state) {
    const wl = state.wildlife, eco = wl.ecology;
    wl.fireflies = eco >= PE.fireflyMin ? Math.min(PE.fireflyCap, Math.round(eco * PE.fireflyPer)) : 0;
    let preserve = 0; const flags = state.tiles.flags;
    for (let i = 0; i < N; i++) if (flags[i] & FLAG.PRESERVE) preserve++;
    const ponds = wl.ecologyTerms ? Math.round((wl.ecologyTerms.ponds || 0) / PE.pond) : 0;
    wl.birds.egrets = eco >= PE.egretEco ? Math.min(12, 2 + ponds + Math.floor(preserve / 20)) : 0;
    wl.birds.spoonbills = eco >= PE.spoonbillEco || hasBuilding(state, 'rookery');
    const prestige = (state.economy && isNum(state.economy.prestige)) ? state.economy.prestige : 0;
    wl.birds.pelicans = Math.min(6, 2 + Math.floor(Math.max(0, prestige) / 20));
  }

  // ---------------------------------------------------------------------------
  // Post-storm gator wave, beads, Roux (Tier 2)
  // ---------------------------------------------------------------------------
  function waveStep(state, day) {
    const wl = state.wildlife;
    if (wavePending) {
      const w = wavePending; wavePending = null;
      if (!w.nearMiss) {
        wl.waveLeft = BSU.params.storm.gatorWave[0] + R.int(BSU.params.storm.gatorWave[1] - BSU.params.storm.gatorWave[0] + 1);
        wl.waveUntilDay = day + 2;   // this new day is T+1: spawn over T+1 … T+3
        wl.waveEntry = isNum(w.point) ? w.point : -1;
      }
    }
    if (wl.waveLeft <= 0) return;
    if (day > wl.waveUntilDay) { wl.waveLeft = 0; wl.waveUntilDay = -1; return; }
    const daysLeft = Math.max(1, wl.waveUntilDay - day + 1);
    const n = Math.ceil(wl.waveLeft / daysLeft);
    const cm = campusOf(state), depth = state.tiles.depth, grid = gridOf(state), cand = [];
    for (let i = 0; i < N; i++) if (cm[i] && depth[i] >= PG.floodedDepth && isLandTile(state, i) && grid[i]) cand.push(i);
    if (!cand.length && wl.waveEntry >= 0 && wl.waveEntry < N) {
      const ex = wl.waveEntry & 63, ey = wl.waveEntry >> 6;
      for (let y = Math.max(0, ey - 6); y <= Math.min(H - 1, ey + 6); y++) for (let x = Math.max(0, ex - 6); x <= Math.min(W - 1, ex + 6); x++) { const i = y * W + x; if (grid[i]) cand.push(i); }
    }
    for (let k = 0; k < n && wl.waveLeft > 0; k++) {
      wl.waveLeft--;
      if (cand.length) spawnGator(state, R.pick(cand)); else spawnAtRandomDen(state);
    }
    if (wl.waveLeft <= 0) { wl.waveLeft = 0; wl.waveUntilDay = -1; }
  }
  function beadsStep(state, day) {
    const yd = day % BSU.params.time.daysPerYear;
    let on = false;
    for (let k = 0; k < BEADS_WINDOWS.length; k++) {
      const a = BSU.dateToDay(BEADS_WINDOWS[k][0], 1), b = BSU.dateToDay(BEADS_WINDOWS[k][1], 1);
      if (yd >= a && yd <= b) on = true;
    }
    state.wildlife.beadsDay = on ? day : -1;
  }
  /** Tier 2: Roux walks to the Dining Hall while the Tiger Habitat is flooded (ticker line 50). */
  function rouxStep(state) {
    const habs = listBuildings(state, 'tiger_habitat');
    let hab = null;
    for (let k = 0; k < habs.length; k++) if (isComplete(habs[k])) { hab = habs[k]; break; }
    if (!hab) { roux = null; return; }
    const home = BSU.idx(hab.tx + Math.floor(hab.w / 2), hab.ty + Math.floor(hab.h / 2));
    const speed = ROUX_SPEED / BSU.params.time.tps;
    if (hab.flooded) {
      if (!roux) {
        const dining = listBuildings(state, 'dining_hall').filter(isComplete);
        let target = home;
        if (dining.length) { const d = dumpsterOf(state, dining[0]); target = d >= 0 ? d : BSU.idx(dining[0].tx, dining[0].ty + dining[0].h); }
        roux = { tx: (home & 63) + 0.5, ty: (home >> 6) + 0.5, px: 0, py: 0, dir: 1, state: 'LOOSE', home: home, target: target, tickerDone: false };
        roux.px = roux.tx; roux.py = roux.ty;
        const Pr = dep('progress'); const tk = fn(Pr, 'ticker');
        if (tk && !roux.tickerDone) { roux.tickerDone = true; tk(state, 50, {}, 'wildlife', target); }
      }
      roux.px = roux.tx; roux.py = roux.ty;
      if (roux.state === 'LOOSE') { moveStraight(roux, roux.target, speed); if (tileOf(roux.tx, roux.ty) === roux.target) roux.state = 'DINING'; }
    } else if (roux) {
      roux.px = roux.tx; roux.py = roux.ty;
      roux.state = 'HOME';
      moveStraight(roux, roux.home, speed);
      if (tileOf(roux.tx, roux.ty) === roux.home) roux = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Daily / monthly steps and the tick
  // ---------------------------------------------------------------------------
  function daily(state, day) {
    const gs = state.gators, type = state.tiles.type;
    // dens that stopped being water → re-pick
    densOf(state);
    for (let k = 0; k < gs.length; k++) { const g = gs[k]; if (!isNum(g.den) || g.den < 0 || g.den >= N || !isWaterType(type[g.den])) g.den = nearestDen(state, gatorTile(g)); }
    topUp(state);
    waveStep(state, day);
    // incidents: keep the last 10 days
    const inc = state.wildlife.incidents;
    for (let k = inc.length - 1; k >= 0; k--) if (!inc[k] || !isNum(inc[k].day) || inc[k].day <= day - PG.incidentDays) inc.splice(k, 1);
    mosqStep(state, null);
    mosqIndexStep(state, day);
    ecologyStep(state, false);
    beadsStep(state, day);
    reconcileOfficers(state);
  }
  function monthly(state, day) {
    nutriaStep(state, day);
    foggerStep(state);
  }

  M.init = safe('init', function (state) {
    const E = BSU.events;
    E.clear('wildlife');
    const on = (name, f) => E.on(name, function (p) { try { f(p || {}); } catch (e) { BSU.error('wildlife', name, e); } }, 'wildlife');
    on(BSU.EV.TILE_CHANGED, (p) => { campusDirty = true; if (p.what === 'flags' || p.what === 'type' || p.what === 'water') densDirty = true; if (p.what !== 'decor' && p.what !== 'elev') gridDirty = true; });
    on(BSU.EV.BUILDING_PLACED, () => { campusDirty = gridDirty = officersDirty = trapDirty = true; });
    on(BSU.EV.BUILDING_REMOVED, () => { campusDirty = gridDirty = officersDirty = trapDirty = true; });
    on(BSU.EV.BUILDING_COMPLETE, () => { campusDirty = gridDirty = officersDirty = trapDirty = true; });
    on(BSU.EV.STORM_WATCH, () => { retreatFlag = true; });
    on(BSU.EV.STORM_PASSED, (p) => { retreatFlag = false; wavePending = { point: p.point, nearMiss: !!p.nearMiss }; });
    on(BSU.EV.FESTIVAL_START, (p) => { if (p.id === 'mardiGras') { const s = BSU.state || state; trashUntilDay = s ? dayOf(s, PG.trashDays[1]) : -1; } });
    on(BSU.EV.FESTIVAL_END, (p) => { if (p.id === 'mardiGras') { /* trash lingers until Feb 10 by rule */ } });
    on(BSU.EV.GAME_KICKOFF, () => { const s = BSU.state || state; gameDay = s ? today(s) : -1; });
  });

  M.reset = safe('reset', function (state, fresh) {
    if (!state || !state.wildlife || !state.tiles) return;
    ensureKeys(state);
    cacheRoot = null; heal(state);
    priv.clear();
    mudApplied.fill(0);
    retreatFlag = false; wavePending = null; trashUntilDay = -1; gameDay = -1; roux = null;
    prevPhase = skyPhase(state);
    // ids and transient fields
    let maxId = -1;
    for (let k = 0; k < state.gators.length; k++) {
      const g = state.gators[k];
      if (!isNum(g.tx) || !isNum(g.ty)) { g.tx = (g.den & 63) + 0.5; g.ty = (g.den >> 6) + 0.5; }
      g.tx = clamp(g.tx, 0, W - 0.001); g.ty = clamp(g.ty, 0, H - 0.001);
      g.px = g.tx; g.py = g.ty; g.route = []; g.ri = 0;
      if (!isNum(g.lounge)) g.lounge = 0; if (!isNum(g.tag)) g.tag = 0; if (!isNum(g.lastIncidentDay)) g.lastIncidentDay = -1;
      if (!isNum(g.den) || g.den < 0 || g.den >= N) g.den = nearestDen(state, gatorTile(g));
      if (g.state === 'WRANGLED') g.state = 'SUN';
      if (isNum(g.id) && g.id > maxId) maxId = g.id;
    }
    nextGatorId = maxId + 1;
    if (state.wildlife.leGrand) { const g = state.wildlife.leGrand; g.route = []; g.ri = 0; g.px = g.tx; g.py = g.ty; if (!isNum(g.lounge)) g.lounge = 0; }
    reconcileOfficers(state);
    for (let k = 0; k < state.wildlife.officers.length; k++) { const o = state.wildlife.officers[k]; o.route = []; o.ri = 0; o.px = o.tx; o.py = o.ty; if (o.state === 'WRANGLE') { o.state = 'RETURN'; o.target = -1; } }
    if (fresh === true) {
      // the only place the initial population is drawn (D37)
      let orig = 0; const flags = state.tiles.flags;
      for (let i = 0; i < N; i++) if (flags[i] & FLAG.WETLAND_ORIGINAL) orig++;
      state.wildlife.wetlandOriginal = orig;
      densOf(state);
      state.wildlife.nutria = PN.base + Math.floor(marshTiles / PN.perMarsh);
      drawLeGrandDay(state);
      topUp(state);
      ecologyStep(state, true);
      beadsStep(state, today(state));
    } else {
      campusOf(state);
      if (!state.wildlife.ecologyTerms || !isNum(state.wildlife.ecologyTerms.raw)) state.wildlife.ecologyTerms = ecologyTermsOf(state);
    }
  });

  M.tick = safe('tick', function (state, flags) {
    if (!state || !state.wildlife || !state.tiles) return;
    flags = flags || {};
    ensureKeys(state);
    heal(state);
    const day = today(state);
    const newDay = !!flags.newDay;
    if (flags.newYear || (newDay && day % BSU.params.time.daysPerYear === 0)) { if (state.wildlife.leGrandDay === -1 || state.wildlife.leGrandDay < day) drawLeGrandDay(state); }
    if (newDay) daily(state, day);
    if (flags.newMonth) monthly(state, day);
    if (officersDirty) reconcileOfficers(state);
    // sky-phase transitions
    const phase = skyPhase(state);
    if (phase !== prevPhase) { prevPhase = phase; onPhaseChange(state, phase); }
    // gators (index order → deterministic rng use)
    const retreating = stormRetreat(state);
    const gs = state.gators;
    for (let k = 0; k < gs.length; k++) stepGator(state, gs[k], retreating, day);
    const os = state.wildlife.officers;
    for (let k = 0; k < os.length; k++) stepOfficer(state, os[k]);
    leGrandTick(state, day, newDay);
    rouxStep(state);
  });

  // ---------------------------------------------------------------------------
  // Public queries and actions (ARCHITECTURE §5.5 + brief §1)
  // ---------------------------------------------------------------------------
  M.gators = safe('gators', function (state) { return (state && Array.isArray(state.gators)) ? state.gators : []; }, () => []);
  M.officers = safe('officers', function (state) { return (state && state.wildlife && Array.isArray(state.wildlife.officers)) ? state.wildlife.officers : []; }, () => []);
  M.mosqAt = safe('mosqAt', function (state, tx, ty) {
    if (!state || !state.tiles || !BSU.inBounds(tx | 0, ty | 0)) return 0;
    const v = state.tiles.mosq[(ty | 0) * W + (tx | 0)];
    return isNum(v) ? v : 0;
  }, 0);
  M.mosqIndex = safe('mosqIndex', function (state) { const v = state && state.wildlife ? state.wildlife.mosqIndex : 0; return isNum(v) ? v : 0; }, 0);
  M.ecology = safe('ecology', function (state) { const v = state && state.wildlife ? state.wildlife.ecology : 0; return isNum(v) ? clamp(v, 0, 100) : 0; }, 0);
  M.ecologyTerms = safe('ecologyTerms', function (state) { heal(state); ensureKeys(state); return ecologyTermsOf(state); }, () => ({}));
  M.wetlandLost = safe('wetlandLost', function (state) { return state && state.tiles ? wetlandLost(state) : 0; }, 0);
  M.campusMask = safe('campusMask', function (state) { return campusOf(state); }, () => new Uint8Array(N));
  M.onCampus = safe('onCampus', function (state) {
    const cm = campusOf(state), out = [], gs = state.gators || [];
    for (let k = 0; k < gs.length; k++) if (cm[gatorTile(gs[k])]) out.push(gs[k]);
    return out;
  }, () => []);
  M.spawnGator = safe('spawnGator', function (state, i, name) { heal(state); return spawnGator(state, i, name); }, null);
  /** progress: the first Dusk ≥ Feb 9 → a gator walks to the Dining Hall dumpster (or Founders' front tile). */
  M.forceFirstGator = safe('forceFirstGator', function (state) {
    heal(state); ensureKeys(state);
    let target = -1;
    const dining = listBuildings(state, 'dining_hall').filter(isComplete);
    if (dining.length) target = dumpsterOf(state, dining[0]);
    if (target < 0) {
      const f = state.plot && state.plot.founders;
      if (f && BSU.inBounds(f.tx + 1, f.ty + 3)) target = BSU.idx(f.tx + 1, f.ty + 3);
    }
    if (target < 0) return;
    const grid = gridOf(state);
    if (!grid[target]) {   // the front tile is blocked (a footprint): the nearest passable neighbor
      const nb = BSU.nbr8(target); let alt = -1;
      for (let k = 0; k < nb.length; k++) if (grid[nb[k]]) { alt = nb[k]; break; }
      if (alt < 0) return;
      target = alt;
    }
    if (!state.gators.length) spawnAtRandomDen(state);
    const tx = target & 63, ty = target >> 6;
    let best = null, bestD = 1e9;
    for (let k = 0; k < state.gators.length; k++) {
      const g = state.gators[k];
      if (g.state === 'WRANGLED') continue;
      const d = BSU.chebyshev(tx, ty, g.den & 63, g.den >> 6);
      if (d < bestD) { bestD = d; best = g; }
    }
    if (best) startWander(state, best, target);
  });
  M.relocate = safe('relocate', function (state, gatorId) { heal(state); ensureKeys(state); relocate(state, gatorId, false); });
  M.sickToday = safe('sickToday', function (state) { const v = state && state.wildlife ? state.wildlife.sick : 0; return isNum(v) ? v : 0; }, 0);
  M.fireflyTarget = safe('fireflyTarget', function (state) { const v = state && state.wildlife ? state.wildlife.fireflies : 0; return isNum(v) ? v : 0; }, 0);
  M.birds = safe('birds', function (state) { const b = state && state.wildlife && state.wildlife.birds; return b ? { egrets: b.egrets | 0, spoonbills: !!b.spoonbills, pelicans: b.pelicans | 0 } : { egrets: 0, spoonbills: false, pelicans: 0 }; }, () => ({ egrets: 0, spoonbills: false, pelicans: 0 }));
  M.nutriaTraps = safe('nutriaTraps', function (state, i) { return !!(state && state.buildings) && nutriaTraps(state, i); }, false);
  M.gatorGridPassable = safe('gatorGridPassable', function (state, i, gator) {
    if (!state || !isNum(i) || i < 0 || i >= N) return false;
    return gridOf(state)[i | 0] === 1;
  }, false);
  M.forceMosquito = safe('forceMosquito', function (state, i, v) {
    if (!state || !isNum(i) || i < 0 || i >= N || !isNum(v)) return;
    state.tiles.mosq[i | 0] = clamp(v, 0, 1);
  });
  /** debug "Set ecology": writes wildlife.ecology and an `ecologyTerms.once` offset so the daily recompute keeps it. */
  M.forceEcology = safe('forceEcology', function (state, v) {
    if (!state || !state.wildlife || !isNum(v)) return;
    heal(state); ensureKeys(state);
    const target = clamp(v, 0, 100);
    const terms = ecologyTermsOf(state);
    const rawNoOnce = terms.sum - terms.once;
    state.wildlife.ecologyTerms.once = target - rawNoOnce;
    const prev = state.wildlife.ecology;
    state.wildlife.ecology = target;
    state.wildlife.ecologyTerms = ecologyTermsOf(state);
    if (Math.abs(target - prev) >= 1) emit(BSU.EV.ECOLOGY_CHANGED, { value: target, prev: prev });
    birdsStep(state);
  });
  /** min(15, 3 × incidents in the last 10 days) — economy's `gator` happiness term. */
  M.gatorPenalty = safe('gatorPenalty', function (state) {
    if (!state || !state.wildlife || !Array.isArray(state.wildlife.incidents)) return 0;
    const day = today(state); let n = 0;
    const inc = state.wildlife.incidents;
    for (let k = 0; k < inc.length; k++) if (inc[k] && isNum(inc[k].day) && inc[k].day > day - PG.incidentDays) n++;
    return Math.min(PG.incidentCap, PG.incidentPenalty * n);
  }, 0);
  /** ui: +1 prestige once per year via economy.bump. */
  M.photographLeGrand = safe('photographLeGrand', function (state) {
    if (!state || !state.wildlife || !state.wildlife.leGrand) return;
    ensureKeys(state);
    const y = yearOf(state);
    if (state.wildlife.leGrandPhotoYear === y) return;
    state.wildlife.leGrandPhotoYear = y;
    const Ec = dep('economy'); const f = fn(Ec, 'bump');
    if (f) f(state, 'prestige', PG.leGrandPrestige, 'Le Grand photographed');
  });
  /** One-time ecology adjustments (wastewater on Marsh −5, restoration +15×tiles/40): stored in ecologyTerms.once. */
  M.applyEcologyOnce = safe('applyEcologyOnce', function (state, delta) {
    if (!state || !state.wildlife || !isNum(delta)) return;
    heal(state); ensureKeys(state);
    state.wildlife.ecologyTerms.once += delta;
    const prev = state.wildlife.ecology;
    const terms = ecologyTermsOf(state);
    state.wildlife.ecology = terms.raw;
    state.wildlife.ecologyTerms = terms;
    if (Math.abs(terms.raw - prev) >= 1) emit(BSU.EV.ECOLOGY_CHANGED, { value: terms.raw, prev: prev });
  });
  /** Tier 2: transient critter positions for render — pure hashes of state, no rng. */
  M.critters = safe('critters', function (state) {
    const out = [];
    if (!state || !state.tiles) return out;
    const phase = skyPhase(state), tick = isNum(state.tick) ? state.tick : 0, wl = state.wildlife || {};
    const frame = (tick >> 2) & 3;
    const crest = state.tiles.crest, type = state.tiles.type;
    if (phase === SKY.NIGHT) {
      // nutria scurry on earthen levees at Night: one per ~12 levee tiles, drifting along the run
      const levees = []; for (let i = 0; i < N; i++) if (crest[i] === 6) levees.push(i);
      const n = Math.min(12, Math.floor(levees.length / 12));
      for (let k = 0; k < n; k++) { const i = levees[(BSU.rng.hash(k, 7) + (tick >> 4)) % levees.length]; out.push({ kind: 'nutria', tx: (i & 63) + 0.5, ty: (i >> 6) + 0.5, frame: frame }); }
      const hw = state.plot && Array.isArray(state.plot.highway) ? state.plot.highway : [];
      if (hw.length && ((tick >> 6) % 5) === 0) { const i = hw[Math.min(hw.length - 1, (tick >> 3) % hw.length)]; out.push({ kind: 'armadillo', tx: (i & 63) + 0.5, ty: (i >> 6) + 0.5, frame: frame }); }
    }
    if (phase === SKY.DAWN && wl.birds && wl.birds.spoonbills) {
      const flags = state.tiles.flags; let sx = 0, sy = 0, c = 0;
      for (let i = 0; i < N; i++) if (flags[i] & FLAG.PRESERVE) { sx += i & 63; sy += i >> 6; c++; }
      if (!c) { const rk = listBuildings(state, 'rookery'); if (rk.length) { sx = rk[0].tx; sy = rk[0].ty; c = 1; } }
      if (c) { const cx = sx / c, cy = sy / c; for (let k = 0; k < 5; k++) { const a = (tick / 40) + k * (Math.PI * 2 / 5); out.push({ kind: 'spoonbill', tx: cx + Math.cos(a) * 3, ty: cy + Math.sin(a) * 3, frame: frame }); } }
    }
    const pel = wl.birds ? (wl.birds.pelicans | 0) : 0;
    if (pel > 0) {
      let placed = 0;
      for (let k = 0; k < 64 && placed < pel; k++) { const i = (BSU.rng.hash(k, 13) % N); if (type[i] === T.OPEN_WATER) { out.push({ kind: 'pelican', tx: (i & 63) + 0.5, ty: (i >> 6) + 0.5, frame: frame }); placed++; } }
    }
    return out;
  }, () => []);
  /** Tier 2: Roux Is Loose → {tx, ty, state} | null. */
  M.roux = safe('roux', function () { return roux ? { tx: roux.tx, ty: roux.ty, px: roux.px, py: roux.py, dir: roux.dir, state: roux.state } : null; }, null);

  // ---------------------------------------------------------------------------
  // selfTest (§10.6, brief §6): private state, stubbed deps, emit recorder (restored in finally)
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const saved = Object.assign({}, M._deps);
    const rec = [];
    const A = (c, m) => BSU.assert(c, 'wildlife.selfTest: ' + m);
    const savedRng = R.state;
    try {
      M._deps.emit = (name, payload) => { rec.push({ name: name, payload: payload }); };
      const stub = {
        terrain: { isDisturbedMarsh() { return false; }, paradeRoute() { return []; }, touch() {} },
        hydro: { isMud() { return false; }, networks() { return []; } },
        buildings: { list(st, type) { const o = []; for (const b of (st.buildings || [])) if (b && (!type || b.type === type)) o.push(b); return o; }, effective() { return 1; }, dumpsterTile() { return -1; }, onIntegrityChanged() {}, stats() { return null; }, has() { return false; } },
        agents: { list() { return []; } },
        weather: { heat() { return { index: 80, advisory: false, wave: false }; }, storm() { return null; } },
        progress: { timer() { return null; }, timers() { return []; }, ticker() {} },
        economy: { bump() {} }
      };
      Object.assign(M._deps, stub);

      /** synthetic map: marsh everywhere (WETLAND_ORIGINAL), a bayou column at x=32, a 5×5 dry block at (10..14,10..14) with standing water */
      const build = (seed) => {
        const s = BSU.newState(seed);
        const t = s.tiles;
        for (let i = 0; i < N; i++) { t.type[i] = T.MARSH; t.elev[i] = 1; t.flags[i] = FLAG.WETLAND_ORIGINAL; t.depth[i] = 0.25; }
        for (let y = 0; y < H; y++) { const i = y * W + 32; t.type[i] = T.BAYOU; t.flags[i] = FLAG.BAYOU; t.elev[i] = -1; t.depth[i] = 1; }
        for (let y = 10; y < 15; y++) for (let x = 10; x < 15; x++) { const i = y * W + x; t.type[i] = T.DRY; t.elev[i] = 4; t.flags[i] = 0; t.depth[i] = 0; t.stand[i] = 3; }
        s.calendar.day = 20; s.calendar.year = 1; s.calendar.month = 3; s.sky.phase = SKY.DAWN;
        return s;
      };
      const bld = (s, type, tx, ty, w, h, extra) => {
        const id = s.buildings.length;
        const b = Object.assign({ id: id, type: type, tx: tx, ty: ty, w: w, h: h, rot: 0, name: type, hp: 1, built: 1, builtDay: 0, pilings: false, sunk: 0, powered: true, watered: true, provider: { power: -1, water: -1 }, flooded: false, floodedSince: -1, closedUntil: -1, blackout: false, tier: 0, upgradeDoneDay: -1, ruin: false, tarp: false, data: { fuelDays: 0, stockedDay: -1, active: true, policies: { gatorProofDumpsters: false, nutriaBounty: false }, boardedUntil: -1, regradeUntil: -1, dumpsterTile: -1, seed: id } }, extra || {});
        s.buildings.push(b);
        const fp = BSU.footprintTiles(tx, ty, w, h) || [];
        for (let k = 0; k < fp.length; k++) s.tiles.owner[fp[k]] = id;
        invalidateAll();
        return b;
      };

      // 3. population formula
      A(gatorTarget(400, 2500) === 18, 'population 400 water / 2500 students → 18');
      A(gatorTarget(4000, 20000) === 24, 'population cap 24');
      A(gatorTarget(0, 0) === 6, 'population floor 6');

      // 8. wander probability
      A(Math.abs(wanderP(0, 1) - 0.15) < 1e-9, 'wander p 0.15 at attraction 0');
      A(wanderP(4, 4) === 1, 'wander p clamps to 1 in April with attraction 4');

      // 4. dens on the synthetic map
      const s = build(9);
      M.reset(s, true);
      const d = densOf(s);
      let expected = 0;
      for (let i = 0; i < N; i++) { if (!isWaterType(s.tiles.type[i])) continue; let m = 0; const nb = BSU.nbr4(i); for (let k = 0; k < nb.length; k++) if (s.tiles.type[nb[k]] === T.MARSH) m++; if (m >= 2) expected++; }
      A(d.length === expected && expected > 0, 'dens = water tiles with ≥ 2 adjacent Marsh (' + d.length + ')');
      A(d.every(i => { let m = 0; const nb = BSU.nbr4(i); for (let k = 0; k < nb.length; k++) if (s.tiles.type[nb[k]] === T.MARSH) m++; return isWaterType(s.tiles.type[i]) && m >= 2; }), 'every den qualifies');

      // 11. reset(fresh) spawns ≥ 6 and records gator:spawn; reset(load) spawns nothing
      A(s.gators.length >= 6, 'fresh reset spawned ≥ 6 gators (' + s.gators.length + ')');
      A(rec.filter(r => r.name === BSU.EV.GATOR_SPAWN).length === s.gators.length, 'one gator:spawn per gator');
      A(s.gators.every(g => isNum(g.tx) && isNum(g.ty) && g.tx >= 0 && g.tx < W && g.ty >= 0 && g.ty < H && d.indexOf(g.den) >= 0), 'gators finite, in bounds, at dens');
      A(s.wildlife.wetlandOriginal > 0, 'wetlandOriginal counted');
      {
        const s2 = build(10);
        for (let k = 0; k < 8; k++) s2.gators.push({ id: k, name: 'G' + k, tx: 32.5, ty: k + 0.5, px: 0, py: 0, dir: 0, state: 'SUN', size: 'big', den: k * W + 32, target: -1, route: [], lounge: 0, onCampus: false, lastIncidentDay: -1, tag: 0 });
        s2.wildlife.wetlandOriginal = 3000; s2.wildlife.ecology = 66;
        const before = rec.length, rngBefore = R.state;
        M.reset(s2, false);
        A(s2.gators.length === 8, 'reset(load) keeps 8 saved gators');
        A(rec.length === before, 'reset(load) emits nothing');
        A(R.state === rngBefore, 'reset(load) draws no rng.sim');
        A(s2.wildlife.wetlandOriginal === 3000 && s2.wildlife.ecology === 66, 'reset(load) leaves saved fields alone');
      }

      // 5. campus mask: one 3×2 footprint at (20,20)
      {
        const s3 = build(11);
        bld(s3, 'dorm', 20, 20, 3, 2);
        const cm = M.campusMask(s3);
        let okMask = true;
        for (let y = 17; y <= 24 && okMask; y++) for (let x = 17; x <= 25; x++) if (!cm[y * W + x]) { okMask = false; break; }
        A(okMask, 'campus mask covers (17..25, 17..24)');
        A(!cm[20 * W + 26] && !cm[16 * W + 20], 'campus mask stops at Chebyshev 3');
      }

      // 6. gator grid
      {
        const s4 = build(12);
        s4.tiles.surface[BSU.idx(5, 5)] = SURF.FENCE;
        bld(s4, 'dorm', 20, 20, 3, 2);
        bld(s4, 'parking', 30, 20, 3, 2);
        bld(s4, 'tiger_habitat', 50, 50, 3, 3);
        invalidateAll();
        A(!M.gatorGridPassable(s4, BSU.idx(5, 5)), 'fence blocks gators');
        A(!M.gatorGridPassable(s4, BSU.idx(21, 20)), 'dorm footprint blocks gators');
        A(M.gatorGridPassable(s4, BSU.idx(31, 21)), 'parking footprint passable');
        A(!M.gatorGridPassable(s4, BSU.idx(40, 50)), 'tile within 10 of the Tiger Habitat blocked');
        A(M.gatorGridPassable(s4, BSU.idx(39, 50)), 'tile at 11 from the Tiger Habitat passable');
        A(M.gatorGridPassable(s4, BSU.idx(2, 30)), 'marsh passable');
        A(!M.gatorGridPassable(s4, -1) && !M.gatorGridPassable(s4, N), 'grid bounds guarded');
      }

      // 7. ecology composition
      {
        const s5 = BSU.newState(13);
        for (let i = 0; i < N; i++) { s5.tiles.type[i] = T.DRY; s5.tiles.elev[i] = 4; }
        for (let i = 0; i < 100; i++) { s5.tiles.type[i] = T.MARSH; s5.tiles.flags[i] = FLAG.WETLAND_ORIGINAL; }
        M.reset(s5, true);
        A(s5.wildlife.wetlandOriginal === 100, '100 original marsh');
        A(Math.abs(s5.wildlife.ecology - 70) < 1e-6, 'ecology 70 with nothing lost (' + s5.wildlife.ecology + ')');
        for (let i = 0; i < 10; i++) s5.tiles.flags[i] |= FLAG.DRAINED;
        let t5 = M.ecologyTerms(s5);
        A(Math.abs(t5.raw - 49) < 1e-6, '10 drained → 30 lost → 49 (' + t5.raw + ')');
        for (let i = 200; i < 240; i++) s5.tiles.flags[i] |= FLAG.PRESERVE;
        t5 = M.ecologyTerms(s5);
        A(Math.abs(t5.raw - 69) < 1e-6 && t5.preserve === 20, '+40 preserve tiles → +20 cap (' + t5.raw + ')');
        for (let i = 240; i < 300; i++) s5.tiles.flags[i] |= FLAG.PRESERVE;
        t5 = M.ecologyTerms(s5);
        A(t5.preserve === 20, 'preserve term capped at 20');
        bld(s5, 'wildlife_post', 40, 40, 1, 1);
        t5 = M.ecologyTerms(s5);
        A(Math.abs(t5.raw - 72) < 1e-6, '+ a post → 72 (' + t5.raw + ')');
        M.applyEcologyOnce(s5, 500);
        A(s5.wildlife.ecology === 100, 'clamp at 100');
        M.applyEcologyOnce(s5, -1000);
        A(s5.wildlife.ecology === 0, 'clamp at 0');
        M.forceEcology(s5, 55);
        A(Math.abs(s5.wildlife.ecology - 55) < 1e-6 && Math.abs(M.ecologyTerms(s5).raw - 55) < 1e-6, 'forceEcology keeps 55 through the recompute');
      }

      // 10. nutriaTraps
      {
        const s6 = build(14);
        bld(s6, 'wildlife_post', 30, 30, 1, 1);
        A(M.nutriaTraps(s6, BSU.idx(44, 44)) === true, 'post at (30,30) traps at (44,44)');
        A(M.nutriaTraps(s6, BSU.idx(45, 30)) === false, 'post at (30,30) does not trap at (45,30)');
        // a burrow writes −15 and logs
        s6.tiles.crest[BSU.idx(3, 3)] = 6; s6.tiles.integrity[BSU.idx(3, 3)] = 100;
        M._burrow(s6, BSU.idx(3, 3));
        A(s6.tiles.integrity[BSU.idx(3, 3)] === 85 && s6.wildlife.burrowLog[BSU.idx(3, 3)].n === 1, 'burrow −15 and logged');
        A(rec.some(r => r.name === BSU.EV.LEVEE_BURROW && r.payload.i === BSU.idx(3, 3)), 'levee:burrow recorded');
      }

      // 1. mosquito bounds and the M3 spirit
      {
        const s7 = build(15);
        M.reset(s7, true);
        const rr = BSU.rng.make(5);
        for (let i = 0; i < N; i++) s7.tiles.mosq[i] = rr.float();
        for (let k = 0; k < 30; k++) mosqStep(s7, null);
        let okB = true;
        for (let i = 0; i < N; i++) { const v = s7.tiles.mosq[i]; if (!(v >= 0 && v <= 1)) { okB = false; break; } }
        A(okB, 'mosq ∈ [0,1], no NaN after 30 daily steps');
        s7.tiles.mosq.fill(0);
        let prev = 0, mono = true;
        for (let k = 0; k < 10; k++) { mosqStep(s7, null); const v = s7.tiles.mosq[12 * W + 12]; if (v < prev - 1e-9) mono = false; prev = v; }
        A(mono && prev > 0.5, 'standing-water tile rises monotonically to > .5 within 10 days (' + prev.toFixed(3) + ')');
        A(s7.tiles.mosq[40 * W + 5] < 0.05, 'undisturbed marsh stays low (' + s7.tiles.mosq[40 * W + 5].toFixed(3) + ')');
        A(s7.tiles.mosq[20 * W + 32] === 0, 'water holds 0');
        // stocked pond within 4 of the block → stays < .3
        const s8 = build(16);
        bld(s8, 'pond', 15, 10, 2, 2, { data: { stockedDay: 0, active: true, policies: {}, dumpsterTile: -1, seed: 1, fuelDays: 0, boardedUntil: -1, regradeUntil: -1 } });
        M.reset(s8, true);
        let mx = 0;
        for (let k = 0; k < 30; k++) { mosqStep(s8, null); mx = Math.max(mx, s8.tiles.mosq[12 * W + 12]); }
        A(mx < 0.3, 'a stocked pond within 4 keeps the block < .3 (' + mx.toFixed(3) + ')');
      }

      // 2. diffusion conserves on a closed land block
      {
        const s9 = BSU.newState(17);
        for (let i = 0; i < N; i++) { s9.tiles.type[i] = T.DRY; s9.tiles.elev[i] = 4; }
        M.reset(s9, true);
        const rr = BSU.rng.make(8);
        for (let i = 0; i < N; i++) s9.tiles.mosq[i] = rr.float();
        const r2 = M._mosqStep(s9, { decay: 0, sources: false, sinks: false });
        A(Math.abs(r2.sumBefore - r2.sumAfter) < 1e-6, 'diffusion conserves Σ mosq (Δ ' + (r2.sumAfter - r2.sumBefore).toExponential(2) + ')');
      }

      // 9. incident cap and gatorPenalty
      {
        const s10 = build(18);
        bld(s10, 'dorm', 20, 20, 3, 2);
        M.reset(s10, true);
        s10.gators.length = 0;
        for (let k = 0; k < 6; k++) { const g = makeGator(s10, BSU.idx(18, 18)); g.state = 'LOUNGE'; g.lounge = 100000; s10.gators.push(g); }
        for (let dayN = 20; dayN < 23; dayN++) { s10.calendar.day = dayN; M.tick(s10, { newDay: true, newMonth: false, newYear: false, day: dayN }); for (let t = 0; t < 3; t++) M.tick(s10, {}); }
        A(s10.wildlife.incidents.length === 18, '6 gators × 3 days → 18 incident rows (' + s10.wildlife.incidents.length + ')');
        A(M.gatorPenalty(s10) === 15, 'gatorPenalty caps at 15');
        A(rec.filter(r => r.name === BSU.EV.GATOR_INCIDENT).length === 18, 'one gator:incident per gator per day');
        s10.calendar.day = 40;
        M.tick(s10, { newDay: true, day: 40 });
        A(s10.wildlife.incidents.every(r => r.day > 30), 'incidents keep only the last 10 days');
      }

      // movement: a forced wander walks to a target over the gator grid and lounges there; storm watch retreats
      {
        const s11 = build(19);
        bld(s11, 'dining_hall', 36, 20, 3, 2);
        M.reset(s11, true);
        s11.sky.phase = SKY.DAY;
        M.forceFirstGator(s11);
        const g = s11.gators.find(x => x.state === 'WANDER');
        A(!!g && g.target === BSU.idx(39, 21), 'forceFirstGator targets the dumpster tile');
        let arrived = false;
        for (let t = 0; t < 1500 && !arrived; t++) { M.tick(s11, {}); if (g.state === 'LOUNGE') arrived = true; }
        A(arrived && gatorTile(g) === BSU.idx(39, 21), 'the gator reached the dumpster and lounges');
        A(rec.some(r => r.name === BSU.EV.GATOR_CAMPUS && r.payload.id === g.id && r.payload.enter === true), 'gator:campus enter recorded');
        M._deps.weather = { heat() { return { index: 80, advisory: false, wave: false }; }, storm() { return { phase: STORM.WATCH }; } };
        M.tick(s11, {});
        A(g.state === 'RETREAT', 'storm watch sends the lounging gator home');
        M._deps.weather = stub.weather;
        for (let t = 0; t < 2000 && g.state !== 'SUN'; t++) M.tick(s11, {});
        A(g.state === 'SUN' && gatorTile(g) === g.den, 'the gator retreated to its den');
        // an officer relocates an on-campus gator
        const s12 = build(20);
        bld(s12, 'dorm', 20, 20, 3, 2);
        bld(s12, 'wildlife_post', 24, 24, 1, 1);
        s12.tiles.walk.fill(2);
        M.reset(s12, true);
        const g2 = spawnGator(s12, BSU.idx(18, 18));
        g2.state = 'LOUNGE'; g2.lounge = 100000;
        A(s12.wildlife.officers.length === 1 && s12.wildlife.officers[0].state === 'IDLE', 'one officer per complete post');
        let relocated = false;
        for (let t = 0; t < 400 && !relocated; t++) { M.tick(s12, {}); if (rec.some(r => r.name === BSU.EV.GATOR_RELOCATED && r.payload.id === g2.id)) relocated = true; }
        A(relocated && s12.wildlife.relocations === 1 && g2.state === 'SUN', 'officer wrangled and relocated the gator');
        A(s12.wildlife.officers[0].cooldown > 0, 'officer on cooldown after the relocation');
      }
      A(rec.every(r => BSU.events.known(r.name)), 'every recorded event name is registered');
      notes.push('recorded ' + rec.length + ' events privately');
    } catch (e) {
      return { ok: false, notes: (e && e.message) || String(e) };
    } finally {
      // restore the injected deps and the sim stream; drop every cache so the live root re-heals on its next query
      Object.assign(M._deps, saved); R.state = savedRng; cacheRoot = null; trapRoot = null; invalidateAll(); priv.clear(); mudApplied.fill(0);
    }
    return { ok: true, notes: notes.join('; ') };
  };
})();
