'use strict';
// =============================================================================
// BAYOU STATE — agents.js → BSU.agents
// Owner of: state.agents[] (not saved), state.vehicles[] (not saved), tiles.wear
// (+1 per off-path crossing; terrain decays), the route cache, the A* request
// queue, the day-sample accumulators and the class-attendance counters.
// Implements GDD §7 (student life: counts, sky-phase schedule, A* + route cache,
// reactions, sampling, class attendance, desire lines, arrivals), §6.3 (flee),
// §6.4 (slap), §6.6 (heat walk mult, shade), §6.1.6/§6.1.10 (wade, tube),
// §6.2 (shelter, evacuation, Cajun Navy), §8 (game-day buses, foam fingers,
// cheering), §9.2 (festival props), §10.1 (the founding arrival), §14.1 (names).
// Contract: ARCHITECTURE.md §5.8, §2.11, §5.1 step 6, D15, D27, D41, D42, D46, D54.
//
// Direction convention (shared with sprites_entities): dir 0 = moving +tx,
// 1 = +ty, 2 = −tx, 3 = −ty.  Walk classes: 0 blocked, 1 path, 2 dry, 3 wet,
// 4 wading; a DEBRIS-flagged tile keeps its class and doubles the A* step cost.
// Every random draw of the sim goes through BSU.rng.sim (or a stream from
// BSU.rng.derive for regeneration); the module holds no state of its own beyond
// per-game caches that are rebuilt in reset (D46).
// =============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.agents = BSU.agents || {});
  const P = BSU.params.agents;
  const PH = BSU.params.heat;
  const PS = BSU.params.storm;
  const W = BSU.MAP.W, H = BSU.MAP.H, N = BSU.MAP.N;
  const T = BSU.T, SKY = BSU.SKY, FLAG = BSU.FLAG, EV = BSU.EV, STORM = BSU.STORM;

  // Constants the GDD states in prose but BSU.params does not carry (noted in
  // docs/INTEGRATION_NOTES.md under '## agents.js').
  const C = {
    dayPhaseTicks: BSU.SKY_TICKS[SKY.DAY],   // energy drains fully across one Day phase (params.agents.energyDrain = 1)
    energyRestoreHome: 0.01,   // per tick while inside the home
    energyPoboy: 0.5,          // restored on passing a Po'boy Shack
    wetGainWade: 0.01,         // per tick in ≥ .3 ft
    wetGainRain: 0.002,        // per tick outside in rain
    wetDecay: 0.005,           // per tick when dry
    bittenPerMosq: 0.01,       // bitten += mosq × this per tick
    slapTicks: 10, slapCooldown: 100,
    cheerTicks: 20,
    splashEvery: 5,
    fleeDistance: 3,
    waveTicks: 20,
    pirogueTicks: 40,          // 4 s glide (§10.1)
    pirogueCapacity: 50,       // pirogues = clamp(ceil(count/50), 1, 3)
    watchSpeedMult: 1.2,       // "students walk faster" on watch days
    debrisSpeedMult: 0.5,
    queueCap: 600,
    routeCacheCap: 2000,
    missTicks: 50,             // an unreachable (from,to,grid) is remembered this long
    evacuateTicks: 100,        // agents despawn over 1 day during an evacuation
    crewN: 3,
    capTossTick: 100,          // graduation set-piece tick of the cap toss
    foggerTicks: 60, foggerRadius: 8,
    cajunNavyTicks: 300,       // 3 days
    busLoopSpeed: 5,           // tiles/s
    mood: { flee: -0.3, wet: -0.2, bitten: -0.2, tube: 0.1, cheer: 0.2, base: 0.6 },
    invalidateBurst: 200,      // more tile changes than this in one tick → drop the whole route cache
    maxRouteFails: 3,          // an arrival whose goal is unreachable lands where it is (no teleport)
    idleWanderP: 0.02          // per-tick chance an idle agent picks a new idle spot
  };
  const ACADEMIC = ['lecture_hall', 'founders_hall', 'library', 'engineering', 'coastal_institute'];
  const HOUSING = ['dorm', 'res_tower', 'greek_house'];
  const DINING = ['dining_hall', 'union', 'poboy'];
  const SPEED_BY_CLASS = [0, P.speed.path / 10, P.speed.dry / 10, P.speed.wet / 10, P.speed.wading / 10];
  const GOAL_TEXT = { class: 'Walking to class', dining: 'Heading to lunch', idle: 'Hanging out', home: 'Heading home', shelter: 'Heading to shelter', event: 'Going to the game', poboy: "Po'boy run", library: 'Studying late', parade: 'Watching the parade', graduation: 'Graduating' };

  // ---------------------------------------------------------------------------
  // Injectable dependencies (§10.6): selfTest swaps these for stubs and a recorder
  // ---------------------------------------------------------------------------
  M._deps = { emit: function (name, payload) { return BSU.events.emit(name, payload); } };
  function dep(name) { const d = M._deps[name]; return d !== undefined && d !== null ? d : BSU[name]; }
  function emit(name, payload) { try { M._deps.emit(name, payload); } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('agents', 'emit:' + name, e); } }
  function guard(where, fn) { try { return fn(); } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('agents', where, e); return undefined; } }

  // ---------------------------------------------------------------------------
  // Per-game closure context (rebuilt in reset; swapped by selfTest; self-heals
  // when called with a root it has not seen — §1)
  // ---------------------------------------------------------------------------
  function newCtx() {
    return {
      root: null,
      // A* / routes
      routeCache: new Map(),      // key → {route, x0, y0, x1, y1}
      missCache: new Map(),       // key → tick it was found unreachable
      queue: [],                  // FIFO of keys
      queued: new Map(),          // key → {from, to, grid, gator}
      searches: 0, budgetTick: -1,
      invalidations: 0, invalidateTick: -1,
      queueDropLogged: false,
      // sampling
      acc: { life: 0, green: 0, mosq: 0, heat: 0, n: 0 },
      lastSample: { life: 0, green: 0, mosq: 0, heat: 0, n: 0 },
      // class attendance
      assigned: 0, reached: 0, lastAttendance: 1,
      // desire lines
      wornToday: new Uint8Array(N), wornList: [], reportedYesterday: new Uint8Array(N), desireLineDay: -1,
      // schedule
      lastPhase: -1, lastGame: false, lastSetPiece: null, homesDirty: true,
      sheltering: false, evacuating: false, beads: false, cheerUntil: -1, capToss: false,
      pendingArrivals: [], pendingBuses: null, releaseShelter: false,
      // building-derived caches (rebuilt when homesDirty)
      doorCache: new Map(), homes: null, idleSpots: null, shadeSpots: null,
      arrivals: new Map(), nextArrival: 1,
      visible: { x0: 0, y0: 0, x1: W - 1, y1: H - 1 }
    };
  }
  let X = newCtx();
  function ensure(state) {
    if (X.root !== state) { X = newCtx(); X.root = state; }
    return X;
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function isInt(v) { return typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v; }
  function validTile(i) { return isInt(i) && i >= 0 && i < N; }
  function fin(v, d) { return (typeof v === 'number' && Number.isFinite(v)) ? v : d; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
  function catalogRow(type) { const D = dep('data'); return D && D.catalog ? D.catalog[type] : null; }
  function effectOf(type, key) { const r = catalogRow(type); return (r && r.effects && typeof r.effects[key] === 'number') ? r.effects[key] : 0; }
  function isComplete(b) { return b && !b.ruin && fin(b.built, 0) >= 1; }
  function effective(state, b) {
    const B = dep('buildings');
    if (!isComplete(b)) return 0;
    if (B && typeof B.effective === 'function') { const e = B.effective(state, b.id); return typeof e === 'number' && Number.isFinite(e) ? e : 0; }
    return b.flooded ? 0 : 1;
  }
  function listBuildings(state, type) {
    const B = dep('buildings');
    let arr = null;
    if (B && typeof B.list === 'function') arr = B.list(state, type);
    else arr = (state.buildings || []).filter(function (b) { return b && (!type || b.type === type); });
    return Array.isArray(arr) ? arr : [];
  }
  function getBuilding(state, id) {
    const B = dep('buildings');
    if (B && typeof B.get === 'function') return B.get(state, id) || null;
    return (isInt(id) && id >= 0 && state.buildings && state.buildings[id]) || null;
  }
  function footprint(b) { return BSU.footprintTiles(b.tx, b.ty, b.w, b.h) || []; }
  /** first edge tile with walk > 0 (north row, south row, west, east); the south-corner tile as a last resort */
  function doorTile(state, b) {
    if (!b) return -1;
    const cached = X.doorCache.get(b.id);
    if (cached !== undefined && cached >= 0) return cached;
    const walk = state.tiles.walk;
    const edges = BSU.edgeTiles(b.tx, b.ty, b.w, b.h);
    let door = -1;
    // prefer the south row (the front door) then any walkable edge tile
    for (let k = 0; k < edges.length; k++) { const e = edges[k]; if (walk[e] > 0 && BSU.ty(e) === b.ty + b.h) { door = e; break; } }
    if (door < 0) for (let k = 0; k < edges.length; k++) { if (walk[edges[k]] > 0) { door = edges[k]; break; } }
    if (door < 0 && edges.length) door = edges[0];
    if (door < 0) door = BSU.idx(BSU.clamp(b.tx, 0, W - 1), BSU.clamp(b.ty, 0, H - 1));
    X.doorCache.set(b.id, door);
    return door;
  }
  function foundersFront(state) {
    const f = state.plot && state.plot.founders ? state.plot.founders : { tx: 51, ty: 7 };
    const tx = BSU.clamp(fin(f.tx, 51) + 1, 0, W - 1), ty = BSU.clamp(fin(f.ty, 7) + 3, 0, H - 1);
    return BSU.idx(tx, ty);
  }
  function nearestBuildingTile(b, tx, ty) {
    const cx = BSU.clamp(tx, b.tx, b.tx + b.w - 1), cy = BSU.clamp(ty, b.ty, b.ty + b.h - 1);
    return cheb(tx, ty, cx, cy);
  }
  function skyPhase(state) {
    const Wd = dep('weather');
    if (Wd && typeof Wd.sky === 'function') { const s = Wd.sky(state); if (s && isInt(s.phase)) return s.phase; }
    return isInt(state.sky.phase) ? state.sky.phase : SKY.DAWN;
  }
  function heatInfo(state) {
    const Wd = dep('weather');
    if (Wd && typeof Wd.heat === 'function') { const h = Wd.heat(state); if (h) return { index: fin(h.index, 80), advisory: !!h.advisory }; }
    const idx = fin(state.weather.heat, 80);
    return { index: idx, advisory: idx >= PH.advisory };
  }
  function raining(state) {
    const Wd = dep('weather');
    if (Wd && typeof Wd.raining === 'function') return !!Wd.raining(state);
    return !!(state.weather && state.weather.event);
  }
  function stormPhase(state) {
    const Wd = dep('weather');
    let s = null;
    if (Wd && typeof Wd.storm === 'function') s = Wd.storm(state); else s = state.storms ? state.storms.current : null;
    return s ? fin(s.phase, STORM.NONE) : STORM.NONE;
  }
  function timerActive(state, id) {
    const Pr = dep('progress');
    if (Pr && typeof Pr.timer === 'function') return !!Pr.timer(state, id);
    const ts = state.progress && state.progress.timers;
    if (!Array.isArray(ts)) return false;
    for (let k = 0; k < ts.length; k++) if (ts[k] && ts[k].id === id) return true;
    return false;
  }
  function semester(state) {
    const Wd = dep('weather');
    if (Wd && typeof Wd.date === 'function') { const d = Wd.date(state); if (d && d.semester) return d.semester; }
    return BSU.dayParts(fin(state.calendar.day, 0)).semester;
  }
  function calDay(state) { return fin(state.calendar.day, 0); }
  function summerAbsent(state, id) {
    return semester(state) === 'summer' && !timerActive(state, 'summerSession') && (id % 100) >= Math.round(P.summerShare * 100);
  }
  function tileInfo(state, tx, ty) { return { i: BSU.idx(tx, ty), tx: tx, ty: ty }; }
  function gators(state) {
    const Wl = dep('wildlife');
    let g = null;
    if (Wl && typeof Wl.gators === 'function') g = Wl.gators(state); else g = state.gators;
    return Array.isArray(g) ? g : [];
  }
  function mosqAt(state, i) { const v = state.tiles.mosq[i]; return Number.isFinite(v) ? v : 0; }
  function depthAt(state, i) { const v = state.tiles.depth[i]; return Number.isFinite(v) ? v : 0; }

  /** walk-class speed in tiles per tick at 1× (§5.8): class 1 → .4, 2 → .24, 3 → .16, 4 → .12; mods {advisory, watch, debris} */
  M.stepSpeed = function (cls, mods) {
    const c = isInt(cls) && cls >= 0 && cls <= 4 ? cls : 0;
    let v = SPEED_BY_CLASS[c];
    if (mods) {
      if (mods.advisory) v *= PH.walkMult;
      if (mods.watch) v *= C.watchSpeedMult;
      if (mods.debris) v *= C.debrisSpeedMult;
    }
    return v;
  };
  /** the shared direction mapping: +tx → 0, +ty → 1, −tx → 2, −ty → 3 */
  M.dirOf = function (dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
    return dy > 0 ? 1 : 3;
  };

  // ---------------------------------------------------------------------------
  // A* (4-connected, Manhattan heuristic, binary heap, generation counters)
  // ---------------------------------------------------------------------------
  const gScore = new Float32Array(N);
  const fScore = new Float32Array(N);
  const parent = new Int32Array(N);
  const seenGen = new Uint32Array(N);
  const closedGen = new Uint32Array(N);
  const heap = new Int32Array(N + 1);
  let heapN = 0, gen = 0;
  function heapPush(i) {
    let k = ++heapN; heap[k] = i;
    while (k > 1) { const p = k >> 1; if (fScore[heap[p]] <= fScore[heap[k]]) break; const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p; }
  }
  function heapPop() {
    const top = heap[1]; heap[1] = heap[heapN--];
    let k = 1;
    for (;;) {
      const l = k << 1, r = l + 1; let m = k;
      if (l <= heapN && fScore[heap[l]] < fScore[heap[m]]) m = l;
      if (r <= heapN && fScore[heap[r]] < fScore[heap[m]]) m = r;
      if (m === k) break;
      const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
    }
    return top;
  }
  /** step cost onto tile i for a grid; 0 = impassable */
  function stepCost(state, i, grid, gator) {
    if (grid === 'walk') {
      const c = state.tiles.walk[i];
      if (!c) return 0;
      return (state.tiles.flags[i] & FLAG.DEBRIS) ? c * P.debrisCostMult : c;
    }
    if (grid === 'road') return state.tiles.surface[i] === BSU.SURF.ROAD ? 1 : 0;
    if (grid === 'gator') {
      const Wl = dep('wildlife');
      let ok = true;
      if (Wl && typeof Wl.gatorGridPassable === 'function') ok = !!Wl.gatorGridPassable(state, i, gator);
      else ok = state.tiles.owner[i] < 0 && state.tiles.surface[i] !== BSU.SURF.FENCE;
      if (!ok) return 0;
      const t = state.tiles.type[i], fl = state.tiles.flags[i];
      return (t === T.OPEN_WATER || t === T.BAYOU || t === T.MARSH || (fl & (FLAG.OPEN_WATER | FLAG.BAYOU))) ? 1 : 2;
    }
    if (grid === 'water') {   // internal: Cajun Navy boats
      const t = state.tiles.type[i], fl = state.tiles.flags[i];
      return (t === T.OPEN_WATER || t === T.BAYOU || t === T.POND || (fl & (FLAG.OPEN_WATER | FLAG.BAYOU)) || depthAt(state, i) >= BSU.params.hydro.thresholds.wading) ? 1 : 0;
    }
    return 0;
  }
  /** synchronous A*; returns the tile list from → to inclusive, or null when unreachable */
  function astar(state, from, to, grid, gator) {
    if (!validTile(from) || !validTile(to)) return null;
    if (from === to) return [from];
    if (!stepCost(state, to, grid, gator)) return null;
    gen = (gen + 1) >>> 0; if (gen === 0) { seenGen.fill(0); closedGen.fill(0); gen = 1; }
    heapN = 0;
    const tx1 = to & 63, ty1 = to >> 6;
    gScore[from] = 0; fScore[from] = Math.abs((from & 63) - tx1) + Math.abs((from >> 6) - ty1); parent[from] = -1; seenGen[from] = gen;
    heapPush(from);
    let expansions = 0;
    while (heapN > 0) {
      const cur = heapPop();
      if (closedGen[cur] === gen) continue;
      closedGen[cur] = gen;
      if (cur === to) {
        const out = []; let k = to;
        while (k !== -1) { out.push(k); k = parent[k]; }
        out.reverse();
        return out;
      }
      if (++expansions > N) break;
      const cx = cur & 63, cy = cur >> 6, g0 = gScore[cur];
      for (let d = 0; d < 4; d++) {
        let nx = cx, ny = cy;
        if (d === 0) ny--; else if (d === 1) nx++; else if (d === 2) ny++; else nx--;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (closedGen[n] === gen) continue;
        const c = stepCost(state, n, grid, gator);
        if (!c) continue;
        const g = g0 + c;
        if (seenGen[n] === gen && g >= gScore[n]) continue;
        seenGen[n] = gen; gScore[n] = g; parent[n] = cur;
        fScore[n] = g + Math.abs(nx - tx1) + Math.abs(ny - ty1);
        heapPush(n);
      }
    }
    return null;
  }
  function routeKey(from, to, grid) { return from + ':' + to + ':' + grid; }
  function storeRoute(key, route) {
    let x0 = 63, y0 = 63, x1 = 0, y1 = 0;
    for (let k = 0; k < route.length; k++) { const t = route[k], tx = t & 63, ty = t >> 6; if (tx < x0) x0 = tx; if (tx > x1) x1 = tx; if (ty < y0) y0 = ty; if (ty > y1) y1 = ty; }
    if (X.routeCache.size >= C.routeCacheCap) { const oldest = X.routeCache.keys().next().value; X.routeCache.delete(oldest); }
    X.routeCache.set(key, { route: route, x0: x0, y0: y0, x1: x1, y1: y1 });
  }
  function resetBudget(state) {
    const t = fin(state.tick, 0);
    if (X.budgetTick !== t) { X.budgetTick = t; X.searches = 0; }
  }
  /** run one search now and record the result (cache or miss) */
  function compute(state, from, to, grid, gator, key) {
    X.searches++;
    const r = astar(state, from, to, grid, gator);
    if (r) { X.missCache.delete(key); storeRoute(key, r); }
    else X.missCache.set(key, fin(state.tick, 0));
    return r;
  }
  function drainQueue(state) {
    resetBudget(state);
    while (X.queue.length && X.searches < P.maxAstarPerTick) {
      const key = X.queue.shift();
      const req = X.queued.get(key);
      X.queued.delete(key);
      if (!req || X.routeCache.has(key)) continue;
      compute(state, req.from, req.to, req.grid, req.gator, key);
    }
  }

  /** A* with the per-tick budget and the keyed queue (D54). null = queued/unreachable; the caller retries next tick. */
  M.route = function (state, fromI, toI, grid, gator) {
    return guard('route', function () {
      if (!state || !state.tiles) return null;
      ensure(state);
      grid = (grid === 'gator' || grid === 'road' || grid === 'water') ? grid : 'walk';
      if (!validTile(fromI) || !validTile(toI)) return null;
      const key = routeKey(fromI, toI, grid);
      const hit = X.routeCache.get(key);
      if (hit) { X.routeCache.delete(key); X.routeCache.set(key, hit); return hit.route; }   // LRU touch
      const tick = fin(state.tick, 0);
      const miss = X.missCache.get(key);
      if (miss !== undefined) { if (tick - miss < C.missTicks) return null; X.missCache.delete(key); }
      resetBudget(state);
      if (X.searches < P.maxAstarPerTick) return compute(state, fromI, toI, grid, gator, key);
      if (!X.queued.has(key)) {
        if (X.queue.length >= C.queueCap) {
          const dropped = X.queue.shift(); X.queued.delete(dropped);
          if (!X.queueDropLogged) { X.queueDropLogged = true; BSU.error('agents', 'route:queueFull', new Error('A* queue exceeded ' + C.queueCap + ' keys; oldest dropped')); }
        }
        X.queue.push(key); X.queued.set(key, { from: fromI, to: toI, grid: grid, gator: gator });
      }
      return null;
    }) || null;
  };
  /** an A* that runs NOW (bypasses the queue); selfTest and this module only — never the tutorial path layer (D57) */
  M.routeSync = function (state, fromI, toI, grid, gator) {
    return guard('routeSync', function () {
      if (!state || !state.tiles) return null;
      ensure(state);
      grid = (grid === 'gator' || grid === 'road' || grid === 'water') ? grid : 'walk';
      if (!validTile(fromI) || !validTile(toI)) return null;
      const key = routeKey(fromI, toI, grid);
      const hit = X.routeCache.get(key);
      if (hit) return hit.route;
      const r = astar(state, fromI, toI, grid, gator);
      if (r) { X.missCache.delete(key); storeRoute(key, r); }
      return r;
    }) || null;
  };
  /** drop every cached route whose bounding box contains tile i (tile:changed) */
  M.invalidateRoutes = function (state, i) {
    guard('invalidateRoutes', function () {
      if (state) ensure(state);
      if (!validTile(i)) return;
      const tick = state ? fin(state.tick, 0) : 0;
      if (X.invalidateTick !== tick) { X.invalidateTick = tick; X.invalidations = 0; }
      X.doorCache.clear();
      X.missCache.clear();
      if (++X.invalidations > C.invalidateBurst) { X.routeCache.clear(); return; }
      const tx = i & 63, ty = i >> 6;
      const dead = [];
      X.routeCache.forEach(function (e, key) { if (tx >= e.x0 && tx <= e.x1 && ty >= e.y0 && ty <= e.y1) dead.push(key); });
      for (let k = 0; k < dead.length; k++) X.routeCache.delete(dead[k]);
    });
  };

  // ---------------------------------------------------------------------------
  // Population: count, the generator, homes/classes, regenerate, reconcile
  // ---------------------------------------------------------------------------
  /** D15: students > 0 ? min(300, 40 + floor(students/25)) : 0 — pure over economy.students */
  M.count = function (state) {
    const s = state && state.economy ? fin(state.economy.students, 0) : 0;
    if (s <= 0) return 0;
    return Math.min(P.cap, P.base + Math.floor(s / P.perStudents));
  };
  function liveCount(state) { let n = 0; const A = state.agents; for (let k = 0; k < A.length; k++) if (A[k] && A[k].state !== 'GONE') n++; return n; }
  function present(a) { return a && a.state !== 'GONE' && !a.arrival; }

  /** housing rows complete (built ≥ 1, not ruin) with beds; academic rows with seats — rebuilt when homesDirty */
  function refreshBuildingCaches(state) {
    if (!X.homesDirty && X.homes) return;
    X.homesDirty = false;
    X.doorCache.clear();
    const homes = [], classes = [], dining = [], poboys = [], idle = [], shade = [], greek = [], union = [], library = [], rec = [], venues = [];
    const all = listBuildings(state);
    let totalBeds = 0;
    for (let k = 0; k < all.length; k++) {
      const b = all[k];
      if (!b || !isComplete(b)) continue;
      if (HOUSING.indexOf(b.type) >= 0) { const beds = Math.max(1, effectOf(b.type, 'beds')); homes.push({ b: b, beds: beds }); totalBeds += beds; if (b.type === 'greek_house') greek.push(b); }
      if (ACADEMIC.indexOf(b.type) >= 0 && effectOf(b.type, 'seats') > 0) classes.push(b);
      if (DINING.indexOf(b.type) >= 0) dining.push(b);
      if (b.type === 'poboy') poboys.push(b);
      if (b.type === 'quad' || b.type === 'union' || b.type === 'rec_center' || b.type === 'tiger_habitat' || b.type === 'bell_tower') idle.push(b);   // selfies at the Habitat / Bell Tower are idle-target flavor
      if (b.type === 'union') union.push(b);
      if (b.type === 'library') library.push(b);
      if (b.type === 'rec_center') { rec.push(b); shade.push(b); }
      if (b.type === 'stadium' || (b.type === 'practice_field' && fin(b.tier, 0) >= 1)) venues.push(b);
    }
    // oak neighbours (veg oaks stage ≥ 1) are idle spots and shade spots
    const oakTiles = [];
    const veg = Array.isArray(state.veg) ? state.veg : [];
    for (let k = 0; k < veg.length; k++) {
      const v = veg[k];
      if (!v || v.type !== 'oak' || fin(v.stage, 0) < 1 || !BSU.inBounds(v.tx, v.ty)) continue;
      const nb = BSU.nbr8(BSU.idx(v.tx, v.ty));
      for (let q = 0; q < nb.length; q++) if (state.tiles.walk[nb[q]] > 0) oakTiles.push(nb[q]);
    }
    X.homes = { list: homes, totalBeds: totalBeds, classes: classes, dining: dining, poboys: poboys, idle: idle, greek: greek, union: union, library: library, rec: rec, venues: venues, oakTiles: oakTiles };
  }
  /** weighted round-robin by beds: agent i's home (−1 when there is no housing) */
  function homeFor(state, i) {
    refreshBuildingCaches(state);
    const hs = X.homes.list;
    if (!hs.length) return -1;
    let t = i % X.homes.totalBeds;
    for (let k = 0; k < hs.length; k++) { t -= hs[k].beds; if (t < 0) return hs[k].b.id; }
    return hs[hs.length - 1].b.id;
  }
  function anchorTile(state, homeId) {
    const b = getBuilding(state, homeId);
    return b ? doorTile(state, b) : foundersFront(state);
  }
  /** nearest complete academic building with seats and effective > 0 (Chebyshev from the home tile), −1 if none */
  function classFor(state, homeId) {
    refreshBuildingCaches(state);
    const from = anchorTile(state, homeId), tx = from & 63, ty = from >> 6;
    let best = -1, bd = 1e9;
    const cs = X.homes.classes;
    for (let k = 0; k < cs.length; k++) {
      const b = cs[k];
      if (effective(state, b) <= 0) continue;
      const d = nearestBuildingTile(b, tx, ty);
      if (d < bd || (d === bd && b.id < best)) { bd = d; best = b.id; }
    }
    return best;
  }
  function nearestOf(state, list, tx, ty, needEffective) {
    let best = null, bd = 1e9;
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      if (needEffective && effective(state, b) <= 0) continue;
      const d = nearestBuildingTile(b, tx, ty);
      if (d < bd || (d === bd && b.id < best.id)) { bd = d; best = b; }
    }
    return best;
  }
  function walkableSpawn(state, i) {
    if (validTile(i) && state.tiles.walk[i] > 0) return i;
    if (!validTile(i)) return foundersFront(state);
    const nb = BSU.nbr8(i);
    for (let k = 0; k < nb.length; k++) if (state.tiles.walk[nb[k]] > 0) return nb[k];
    return i;
  }
  /** one Agent struct (ARCHITECTURE §2.11 + private fields); draws from stream r in a fixed order */
  function makeAgent(state, r, id, atTile) {
    const D = dep('data');
    const S = (D && D.students) || {};
    const fc = S.firstCajun || ['Beau'], fm = S.firstModern || ['Tyler'], ln = S.last || ['Boudreaux'], nk = S.nicknames || ['Tee'], mj = S.majors || ['Wetland Ecology'];
    const modern = r.chance(fin(S.modernShare, 0.25));
    const first = modern ? r.pick(fm) : r.pick(fc);
    const last = r.pick(ln);
    const nick = r.chance(fin(S.nicknameShare, 0.12)) ? r.pick(nk) : null;
    const major = r.pick(mj);
    const year = 1 + r.int(4);
    const Sp = dep('sprites');
    const look = (Sp && typeof Sp.agentLook === 'function') ? (fin(Sp.agentLook(r.next()), 0) | 0) : r.int(1 << 9);
    const home = homeFor(state, id);
    const cls = classFor(state, home);
    const tile = walkableSpawn(state, isInt(atTile) ? atTile : anchorTile(state, home));
    const tx = (tile & 63) + 0.5, ty = (tile >> 6) + 0.5;
    return {
      id: id, tx: tx, ty: ty, px: tx, py: ty, dir: 1, anim: 'idle', frame: 0,
      state: 'IDLE', goal: 'idle', target: -1, route: [], routeIdx: 0, waitTicks: 0,
      home: home, cls: cls, mood: C.mood.base, energy: 1, wet: 0, bitten: 0,
      name: nick ? (first + ' "' + nick + '" ' + last) : (first + ' ' + last), major: major, year: year, look: look,
      prop: 'none', sample: { life: 0, green: 0, mosq: 0, heat: 0, n: 0 }, reachedClass: false,
      // private (never saved): arrival id, inside a building, timers, bookkeeping
      arrival: 0, aboard: false, inside: false, lastTile: tile, fleeUntil: -1, fleeCooldown: -1, fleeGator: -1, slapUntil: -1, slapCooldown: -1,
      cheerUntil: -1, splashTick: -1, waveUntil: -1, sitUntil: -1, tube: false, wading: false, next: null, assignedCycle: false,
      routeFails: 0, evacUntil: -1, skipClass: false
    };
  }
  /** re-home / re-class an agent whose buildings changed; the agent keeps its position */
  function rehome(state, a) {
    const hb = getBuilding(state, a.home);
    if (!hb || !isComplete(hb)) a.home = homeFor(state, a.id);
    const cb = getBuilding(state, a.cls);
    if (!cb || effective(state, cb) <= 0) a.cls = classFor(state, a.home);
  }

  /** deterministic from rng.derive('agents', tick): exactly count(state) agents at their homes (or Founders'); vehicles cleared */
  M.regenerate = function (state) {
    guard('regenerate', function () {
      if (!state || !state.tiles) return;
      ensure(state);
      X.homesDirty = true; refreshBuildingCaches(state);
      X.arrivals.clear(); X.pendingArrivals.length = 0;
      const r = BSU.rng.derive('agents', fin(state.tick, 0));
      const n = M.count(state);
      const arr = [];
      for (let i = 0; i < n; i++) {
        const a = makeAgent(state, r, i, undefined);
        if (summerAbsent(state, i)) a.state = 'GONE';
        else { a.inside = a.home >= 0; }
        arr.push(a);
      }
      state.agents = arr;
      state.vehicles = [];
      X.lastPhase = -1;
    });
  };
  /** the daily reconcile (D42): in-flight arrivals are ignored, missing agents spawn at home, extras become GONE; never spliced */
  function reconcile(state) {
    if (state.setPiece || X.evacuating) return;
    const A = state.agents;
    const target = M.count(state);
    const r = BSU.rng.sim;
    const n = Math.max(A.length, target);
    for (let i = 0; i < n; i++) {
      const desired = i < target && !summerAbsent(state, i);
      let a = A[i];
      if (!a) {
        if (desired) { a = makeAgent(state, r, i, undefined); a.inside = a.home >= 0; A[i] = a; }
        else { A[i] = makeAgent(state, r, i, undefined); A[i].state = 'GONE'; }
        continue;
      }
      if (a.arrival) continue;
      if (desired && a.state === 'GONE') {
        rehome(state, a);
        const t = walkableSpawn(state, anchorTile(state, a.home));
        a.tx = (t & 63) + 0.5; a.ty = (t >> 6) + 0.5; a.px = a.tx; a.py = a.ty; a.lastTile = t;
        a.state = 'IDLE'; a.goal = 'idle'; a.target = -1; a.route = []; a.routeIdx = 0; a.inside = a.home >= 0; a.prop = 'none'; a.evacUntil = -1;
      } else if (!desired && a.state !== 'GONE') {
        a.state = 'GONE'; a.route = []; a.routeIdx = 0; a.inside = false;
      }
    }
    X.lastPhase = -1;   // re-run the phase schedule for the new roster
  }

  // ---------------------------------------------------------------------------
  // Goals and the sky-phase schedule (GDD §7 Schedule)
  // ---------------------------------------------------------------------------
  function agentTile(a) { return BSU.idx(BSU.clamp(Math.floor(a.tx), 0, W - 1), BSU.clamp(Math.floor(a.ty), 0, H - 1)); }
  /** send an agent toward a building (by id) or a tile; the route is requested lazily in tick */
  function setGoal(state, a, goal, target, next) {
    a.goal = goal; a.target = isInt(target) ? target : -1; a.next = next || null;
    a.route = []; a.routeIdx = 0; a.waitTicks = 0; a.routeFails = 0;
    if (a.state !== 'FLEE' && a.state !== 'SHELTER' && a.state !== 'BUS') a.state = 'WALK';
    a.inside = false;
  }
  function goalTile(state, a) {
    if (a.target < 0) return -1;
    if (a.goal === 'idle' || a.goal === 'parade' || a.goal === 'graduation' || a.goal === 'flee' || a.goal === 'tile') return validTile(a.target) ? a.target : -1;
    if (a.goal === 'event' && a.target >= N) return -1;
    const b = getBuilding(state, a.target);
    if (b) return doorTile(state, b);
    return validTile(a.target) ? a.target : -1;   // a plain tile target
  }
  function goalIsBuilding(state, a) { return a.target >= 0 && a.goal !== 'idle' && a.goal !== 'parade' && a.goal !== 'graduation' && a.goal !== 'tile' && !!getBuilding(state, a.target); }
  function pickTile(r, list, fallback) { return list && list.length ? list[r.int(list.length)] : fallback; }

  function idleSpot(state, a, r, advisory) {
    refreshBuildingCaches(state);
    const Hc = X.homes;
    const choices = [];
    if (advisory) {
      // shade: oak neighbours and the Rec pool first
      for (let k = 0; k < Hc.oakTiles.length; k++) choices.push(Hc.oakTiles[k]);
      for (let k = 0; k < Hc.rec.length; k++) choices.push(doorTile(state, Hc.rec[k]));
      if (!choices.length) {
        const B = dep('buildings');
        const au = (B && typeof B.auras === 'function') ? B.auras(state) : null;
        if (au && au.shade) { const home = anchorTile(state, a.home); const hx = home & 63, hy = home >> 6; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const x = hx + dx, y = hy + dy; if (!BSU.inBounds(x, y)) continue; const i = BSU.idx(x, y); if (au.shade[i] > 0 && state.tiles.walk[i] > 0) choices.push(i); } }
      }
    }
    if (!choices.length) {
      for (let k = 0; k < Hc.idle.length; k++) choices.push(doorTile(state, Hc.idle[k]));
      for (let k = 0; k < Hc.oakTiles.length; k++) choices.push(Hc.oakTiles[k]);
    }
    if (!choices.length) choices.push(foundersFront(state));
    return pickTile(r, choices, foundersFront(state));
  }
  function duskSpot(state, a, r, watch) {
    refreshBuildingCaches(state);
    const Hc = X.homes;
    // storm-watch huddle, and Zydeco Friday (every 5th calendar day when a Union exists): everyone at the Union plaza
    const zydeco = Hc.union.length > 0 && (calDay(state) % P.zydecoEvery) === 0;
    if ((watch || zydeco) && Hc.union.length) return { goal: 'idle', target: doorTile(state, nearestOf(state, Hc.union, Math.floor(a.tx), Math.floor(a.ty), false)) };
    const choices = [];
    for (let k = 0; k < Hc.greek.length; k++) choices.push(doorTile(state, Hc.greek[k]));
    for (let k = 0; k < Hc.union.length; k++) choices.push(doorTile(state, Hc.union[k]));
    if (!choices.length) return { goal: 'idle', target: idleSpot(state, a, r, false) };
    return { goal: 'idle', target: pickTile(r, choices, foundersFront(state)) };
  }
  function assignClass(state, a) {
    const cb = getBuilding(state, a.cls);
    if (!cb || effective(state, cb) <= 0) a.cls = classFor(state, a.home);
    if (a.cls < 0) { setGoal(state, a, 'idle', idleSpot(state, a, BSU.rng.sim, false), null); return; }
    setGoal(state, a, 'class', a.cls, 'dining');
    if (!a.assignedCycle) { a.assignedCycle = true; X.assigned++; }
  }
  function homeGoal(state, a) {
    if (a.home >= 0 && getBuilding(state, a.home)) setGoal(state, a, 'home', a.home, null);
    else setGoal(state, a, 'idle', foundersFront(state), null);
  }
  /** the schedule bucket for one agent at a phase transition */
  function schedule(state, a, phase, ctx) {
    const r = BSU.rng.sim;
    if (a.state === 'SHELTER' || a.state === 'BUS' || a.goal === 'shelter' || X.evacuating) return;
    if (state.sports && state.sports.game) { eventGoal(state, a); return; }
    if (state.setPiece && state.setPiece.kind === 'parade') { paradeGoal(state, a, r); return; }
    if (state.setPiece && state.setPiece.kind === 'graduation') { graduationGoal(state, a); return; }
    refreshBuildingCaches(state);
    const Hc = X.homes;
    if (ctx.graduationDay) a.prop = 'cap';   // May 5: caps all day (§9.2)
    switch (phase) {
      case SKY.DAWN: {
        a.assignedCycle = false; a.reachedClass = false;
        a.skipClass = ctx.sickShare > 0 && ((a.id * 37) % 100) < ctx.sickShare * 100;
        if (a.skipClass) { homeGoal(state, a); a.state = 'IDLE'; return; }
        if (Hc.poboys.length && r.chance(P.poboyShare)) {
          const pb = nearestOf(state, Hc.poboys, Math.floor(a.tx), Math.floor(a.ty), true);
          if (pb) { setGoal(state, a, 'poboy', pb.id, 'class'); return; }
        }
        assignClass(state, a);
        return;
      }
      case SKY.DAY:
        if (a.skipClass) return;
        if (a.goal !== 'class' && a.goal !== 'poboy' && a.goal !== 'dining') assignClass(state, a);
        return;
      case SKY.GOLDEN: {
        a.skipClass = false;
        const spot = idleSpot(state, a, r, ctx.advisory);
        setGoal(state, a, 'idle', spot, null);
        a.sitUntil = ctx.advisory ? 1e9 : -1;
        return;
      }
      case SKY.DUSK: {
        const d = duskSpot(state, a, r, ctx.watch);
        setGoal(state, a, d.goal, d.target, null);
        return;
      }
      case SKY.NIGHT: {
        const finals = BSU.dayParts(calDay(state)).month === 12;   // Dec 1–10: agents at the Library (§9.2)
        if (r.chance(finals ? Math.min(1, P.nightOwlShare * 3) : P.nightOwlShare)) {
          const spots = Hc.library.concat(Hc.union);
          if (spots.length) { const b = nearestOf(state, spots, Math.floor(a.tx), Math.floor(a.ty), true); if (b) { setGoal(state, a, 'library', b.id, null); return; } }
        }
        homeGoal(state, a);
        return;
      }
      default: return;
    }
  }
  function eventGoal(state, a) {
    refreshBuildingCaches(state);
    const v = X.homes.venues.length ? nearestOf(state, X.homes.venues, Math.floor(a.tx), Math.floor(a.ty), false) : null;
    a.prop = 'foam';
    if (v) {
      const edges = BSU.edgeTiles(v.tx, v.ty, v.w, v.h).filter(function (e) { return state.tiles.walk[e] > 0; });
      const t = edges.length ? edges[a.id % edges.length] : doorTile(state, v);
      setGoal(state, a, 'event', t, 'inside');
    } else setGoal(state, a, 'idle', foundersFront(state), null);
  }
  function paradeGoal(state, a, r) {
    const Tr = dep('terrain');
    let route = null;
    if (Tr && typeof Tr.paradeRoute === 'function') route = Tr.paradeRoute(state);
    if (!Array.isArray(route) || !route.length) route = Array.isArray(state.plot.highway) ? state.plot.highway : [];
    const spots = [];
    for (let k = 0; k < route.length; k++) { const nb = BSU.nbr4(route[k]); for (let q = 0; q < nb.length; q++) if (state.tiles.walk[nb[q]] > 0 && state.tiles.surface[nb[q]] !== BSU.SURF.ROAD) spots.push(nb[q]); }
    if (X.beads) a.prop = 'beads';
    setGoal(state, a, 'parade', spots.length ? spots[a.id % spots.length] : foundersFront(state), null);
  }
  function graduationGoal(state, a) {
    a.prop = 'cap';
    const f = state.plot.founders || { tx: 51, ty: 7 };
    const spots = [];
    for (let dy = 3; dy <= 6; dy++) for (let dx = -1; dx <= 4; dx++) { const x = fin(f.tx, 51) + dx, y = fin(f.ty, 7) + dy; if (BSU.inBounds(x, y) && state.tiles.walk[BSU.idx(x, y)] > 0) spots.push(BSU.idx(x, y)); }
    setGoal(state, a, 'graduation', spots.length ? spots[a.id % spots.length] : foundersFront(state), null);
  }

  /** an agent reached its goal: chain the next leg, go inside, or idle */
  function arrive(state, a, ctx) {
    const wasArrival = a.arrival;
    if (a.arrival) {
      const g = X.arrivals.get(a.arrival);
      a.arrival = 0;
      if (g && !g.announced) { g.announced = true; emit(EV.AGENT_ARRIVE, { count: g.count, kind: g.kind }); }
    }
    a.waveUntil = -1;
    switch (a.goal) {
      case 'class':
        if (!a.reachedClass) { a.reachedClass = true; if (a.assignedCycle) X.reached++; }
        a.inside = true; a.state = 'IDLE';
        a.waitTicks = 20 + (a.id % 10);
        a.next = 'dining';
        break;
      case 'poboy':
        a.energy = Math.min(1, a.energy + C.energyPoboy);
        a.waitTicks = 5;
        a.next = a.next || 'class';
        a.state = 'IDLE';
        break;
      case 'dining':
        a.inside = true; a.state = 'IDLE';
        a.energy = Math.min(1, a.energy + 0.2);
        a.waitTicks = 20 + (a.id % 10);
        a.next = 'class';
        break;
      case 'home': case 'library': case 'shelter':
        a.inside = true; a.state = a.goal === 'shelter' ? 'SHELTER' : 'IDLE'; a.next = null;
        break;
      case 'event':
        if (a.next === 'inside') { a.next = null; a.waitTicks = 30; a.state = 'IDLE'; }
        else { a.inside = true; a.state = 'IDLE'; }
        break;
      case 'idle':
        a.state = (ctx && ctx.advisory && a.sitUntil > 0) ? 'SIT' : 'IDLE';
        a.next = null;
        break;
      default:
        a.state = 'IDLE'; a.next = null;
    }
    if (wasArrival && a.goal === 'home' && a.home < 0) { a.inside = false; a.state = 'IDLE'; }
  }
  /** the chained leg after a wait (class → dining → class) */
  function nextLeg(state, a) {
    const n = a.next; a.next = null;
    if (!n) return;
    if (n === 'dining') {
      refreshBuildingCaches(state);
      const d = nearestOf(state, X.homes.dining, Math.floor(a.tx), Math.floor(a.ty), true);
      if (d) { setGoal(state, a, 'dining', d.id, 'class'); return; }
      setGoal(state, a, 'class', a.cls, 'dining'); return;
    }
    if (n === 'class') { assignClass(state, a); return; }
    if (n === 'inside') { const v = getBuilding(state, a.target); if (v) setGoal(state, a, 'event', v.id, null); return; }
  }

  // ---------------------------------------------------------------------------
  // Movement (ARCHITECTURE §5.8; GDD §7 Pathfinding), reactions, stats, sampling
  // ---------------------------------------------------------------------------
  function requestRoute(state, a, sync) {
    const to = goalTile(state, a);
    if (to < 0) { a.state = 'IDLE'; a.goal = 'idle'; a.target = -1; return false; }
    const from = agentTile(a);
    if (from === to) { a.route = [from]; a.routeIdx = 1; return true; }
    const r = sync ? M.routeSync(state, from, to, 'walk') : M.route(state, from, to, 'walk');
    if (r) { a.route = r; a.routeIdx = 1; a.routeFails = 0; return true; }
    // queued (null within the miss window means unreachable): wait and retry
    const key = routeKey(from, to, 'walk');
    if (X.missCache.has(key)) {
      a.routeFails++;
      a.waitTicks = P.legTicks;
      if (a.arrival && a.routeFails >= C.maxRouteFails) { a.route = []; arrive(state, a, null); }   // an unreachable landing goal: the cohort has arrived where it stands
      else if (!a.arrival && a.routeFails >= C.maxRouteFails) { a.state = 'IDLE'; a.goal = 'idle'; a.target = -1; a.route = []; }
    }
    return false;
  }
  function enterTile(state, a, i) {
    a.lastTile = i;
    // desire lines: bare grass only
    if (state.tiles.surface[i] === BSU.SURF.NONE) {
      const t = state.tiles.type[i];
      if (t === T.DRY || t === T.HIGH || t === T.WET) {
        const w = state.tiles.wear[i];
        if (w < 255) state.tiles.wear[i] = w + 1;
        if (state.tiles.wear[i] >= P.wearThreshold && !X.wornToday[i]) { X.wornToday[i] = 1; X.wornList.push(i); }
      }
    }
    // wading entry: the inner tube
    const d = depthAt(state, i);
    if (d >= BSU.params.hydro.thresholds.wading) {
      if (!a.wading) { a.wading = true; if (BSU.rng.sim.chance(P.tubeP)) a.tube = true; }
    } else { a.wading = false; a.tube = false; }
  }
  /** move an agent along its route by `dist` tiles; returns true when the goal tile is reached */
  function advance(state, a, dist, ctx) {
    const route = a.route;
    let guardN = 0;
    while (dist > 0 && a.routeIdx < route.length && guardN++ < 16) {
      const node = route[a.routeIdx];
      if (!validTile(node) || state.tiles.walk[node] === 0) { a.route = []; a.routeIdx = 0; return false; }   // re-plan next tick
      const nx = (node & 63) + 0.5, ny = (node >> 6) + 0.5;
      const dx = nx - a.tx, dy = ny - a.ty;
      const len = Math.abs(dx) + Math.abs(dy);
      a.dir = M.dirOf(dx, dy);
      if (len <= dist) {
        a.tx = nx; a.ty = ny; dist -= len; a.routeIdx++;
        if (a.lastTile !== node) enterTile(state, a, node);
      } else {
        a.tx += dx / len * dist; a.ty += dy / len * dist; dist = 0;
        const here = agentTile(a);
        if (here !== a.lastTile) enterTile(state, a, here);
      }
    }
    if (!Number.isFinite(a.tx) || !Number.isFinite(a.ty)) { a.tx = (a.lastTile & 63) + 0.5; a.ty = (a.lastTile >> 6) + 0.5; }
    a.tx = BSU.clamp(a.tx, 0.5, W - 0.5); a.ty = BSU.clamp(a.ty, 0.5, H - 0.5);
    return a.routeIdx >= route.length;
  }
  function fleeCheck(state, a, ctx) {
    if (a.state === 'FLEE' || a.inside || a.state === 'SHELTER' || a.state === 'BUS') return;
    const gs = ctx.gators;
    for (let k = 0; k < gs.length; k++) {
      const g = gs[k];
      if (!g || g.state === 'WRANGLED') continue;
      if (cheb(a.tx, a.ty, fin(g.tx, -99) + 0.5, fin(g.ty, -99) + 0.5) <= P.fleeRadius + 0.5) {
        // run 3 tiles away, opposite the gator
        const ax = Math.floor(a.tx), ay = Math.floor(a.ty);
        const dx = Math.sign(ax - Math.floor(fin(g.tx, ax))), dy = Math.sign(ay - Math.floor(fin(g.ty, ay)));
        let best = -1, bd = -1;
        for (let oy = -C.fleeDistance; oy <= C.fleeDistance; oy++) for (let ox = -C.fleeDistance; ox <= C.fleeDistance; ox++) {
          const x = ax + ox, y = ay + oy;
          if (!BSU.inBounds(x, y)) continue;
          const i = BSU.idx(x, y);
          if (state.tiles.walk[i] === 0) continue;
          const d = cheb(x, y, Math.floor(fin(g.tx, ax)), Math.floor(fin(g.ty, ay))) + (ox * dx + oy * dy) * 0.1;
          if (d > bd) { bd = d; best = i; }
        }
        a.prevGoal = { goal: a.goal, target: a.target, next: a.next };
        a.state = 'FLEE'; a.fleeUntil = ctx.tick + P.gatorFleeTicks; a.fleeGator = fin(g.id, -1);
        a.goal = 'flee'; a.target = best >= 0 ? best : agentTile(a); a.route = []; a.routeIdx = 0; a.inside = false; a.waitTicks = 0;
        if (ctx.tick >= a.fleeCooldown) { a.fleeCooldown = ctx.tick + P.gatorFleeTicks; emit(EV.AGENT_FLEE, { id: a.id, gatorId: a.fleeGator }); }
        return;
      }
    }
  }
  function endFlee(state, a) {
    const pg = a.prevGoal || { goal: 'idle', target: -1, next: null };
    a.prevGoal = null; a.state = 'IDLE';
    if (pg.goal === 'flee' || pg.goal === 'idle' && pg.target < 0) { a.goal = 'idle'; a.target = -1; a.route = []; return; }
    setGoal(state, a, pg.goal, pg.target, pg.next);
  }
  function splash(state, a, ctx) {
    if (ctx.tick - a.splashTick < C.splashEvery) return;
    a.splashTick = ctx.tick;
    const R = dep('render');
    if (R && R.particles && typeof R.particles.emit === 'function') {
      const e = state.tiles.elev[agentTile(a)] || 0;
      guard('splash', function () { R.particles.emit('splash', (a.tx - a.ty) * 32, (a.tx + a.ty) * 16 - e * 6, 2, {}); });
    }
  }
  function updateStats(state, a, ctx, moving) {
    const i = agentTile(a);
    const inWater = !a.inside && depthAt(state, i) >= BSU.params.hydro.thresholds.wading;
    if (inWater) a.wet = Math.min(1, a.wet + C.wetGainWade);
    else if (!a.inside && ctx.rain) a.wet = Math.min(1, a.wet + C.wetGainRain);
    else a.wet = Math.max(0, a.wet - C.wetDecay);
    if (!a.inside) a.bitten = Math.min(1, a.bitten + mosqAt(state, i) * C.bittenPerMosq);
    if (ctx.phase === SKY.DAY && !a.inside) a.energy = Math.max(0, a.energy - P.energyDrain / C.dayPhaseTicks);
    else if (a.inside && a.goal === 'home') a.energy = Math.min(1, a.energy + C.energyRestoreHome);
    let personal = C.mood.base;
    if (a.wet > 0.5) personal += C.mood.wet;
    if (a.bitten >= P.slapAt) personal += C.mood.bitten;
    if (a.tube) personal += C.mood.tube;
    if (a.state === 'FLEE') personal += C.mood.flee;
    if (a.state === 'CHEER' || a.cheerUntil > ctx.tick) personal += C.mood.cheer;
    a.mood = clamp01(0.5 * fin(state.economy.happiness, 60) / 100 + 0.5 * clamp01(personal));
    // props: cap > foam > beads > tube > umbrella
    if (a.prop === 'cap' && !(state.setPiece && state.setPiece.kind === 'graduation') && !ctx.graduationDay) a.prop = 'none';
    if (a.prop === 'foam' && !(state.sports && state.sports.game)) a.prop = 'none';
    if (a.prop === 'beads' && !X.beads) a.prop = 'none';
    if (a.prop === 'none' || a.prop === 'tube' || a.prop === 'umbrella') {
      if (a.tube && inWater) a.prop = 'tube';
      else if (ctx.rain && !a.inside) a.prop = 'umbrella';
      else a.prop = 'none';
    }
    // slap
    if (a.bitten >= P.slapAt && ctx.tick >= a.slapCooldown && !a.inside) { a.slapUntil = ctx.tick + C.slapTicks; a.slapCooldown = ctx.tick + C.slapCooldown; }
    // anim
    if (a.state === 'FLEE') a.anim = 'flee';
    else if (a.slapUntil > ctx.tick) a.anim = 'slap';
    else if (a.cheerUntil > ctx.tick || a.state === 'CHEER') a.anim = 'cheer';
    else if (a.waveUntil > ctx.tick) a.anim = 'wave';
    else if (a.state === 'SIT') a.anim = 'sit';
    else if (a.state === 'WADE' || (moving && inWater)) a.anim = 'splash';
    else if (moving) a.anim = a.prop === 'umbrella' ? 'umbrella' : (a.prop === 'foam' ? 'foam' : (a.prop === 'beads' ? 'beads' : (a.prop === 'tube' ? 'tube' : 'walk')));
    else a.anim = 'idle';
    a.frame = moving ? (a.frame + 1) & 1023 : (ctx.tick >> 3) & 1023;
  }
  function samplePresent(state, a, ctx) {
    const i = agentTile(a);
    const au = ctx.auras;
    const b = a.inside ? getBuilding(state, a.target) : null;
    const type = b ? b.type : '';
    const life = au && au.life ? fin(au.life[i], 0) : 0;
    const green = au && au.green ? fin(au.green[i], 0) : 0;
    const mosq = (a.inside && (type === 'rec_center' || type === 'union')) ? 0 : mosqAt(state, i);
    let heat = 0;
    if (ctx.advisory) {
      const shade = au && au.shade ? fin(au.shade[i], 0) : 0;
      const hm = au && au.heat ? fin(au.heat[i], 1) : 1;
      heat = BSU.clamp((ctx.heatIndex - PH.penaltyBase) / PH.penaltyDiv, 0, PH.penaltyCap) * (1 - Math.min(1, shade)) * hm;
      if (a.inside && (type === 'union' || type === 'library')) heat = 0;
      if (ctx.summerSession) heat *= BSU.params.econ.boardCards.summerSession.heatMult;
    }
    a.sample.life += life; a.sample.green += green; a.sample.mosq += mosq; a.sample.heat += heat; a.sample.n++;
    X.acc.life += life; X.acc.green += green; X.acc.mosq += mosq; X.acc.heat += heat; X.acc.n++;
  }

  /** one agent's tick; `mult` is 4 for an off-screen agent updated every 4th tick */
  function tickAgent(state, a, ctx, mult) {
    const tick = ctx.tick;
    if (a.state === 'GONE') return;
    if (a.aboard) return;   // inside a vehicle
    // evacuation: walk to the road, then vanish
    if (a.state === 'BUS' && a.evacUntil >= 0 && (tick >= a.evacUntil || a.routeIdx >= a.route.length && a.route.length)) { a.state = 'GONE'; a.route = []; return; }
    if (a.state === 'FLEE' && tick >= a.fleeUntil) endFlee(state, a);
    else fleeCheck(state, a, ctx);
    if (a.cheerUntil > tick && a.state === 'IDLE') a.state = 'CHEER';
    if (a.state === 'CHEER' && a.cheerUntil <= tick) a.state = 'IDLE';
    let moving = false;
    if (a.waitTicks > 0) {
      a.waitTicks -= mult;
      if (a.waitTicks <= 0) { a.waitTicks = 0; if (a.next && a.state !== 'FLEE') nextLeg(state, a); else if (a.goal !== 'idle' && a.target >= 0 && a.state === 'WALK') { /* retry the route */ } }
    } else if (a.state === 'WALK' || a.state === 'WADE' || a.state === 'FLEE' || a.state === 'BUS') {
      if (!a.route.length || a.routeIdx >= a.route.length) {
        if (a.route.length && a.routeIdx >= a.route.length) {
          if (a.state === 'FLEE') { a.route = []; a.routeIdx = 0; }
          else if (a.state === 'BUS') { a.state = 'GONE'; return; }
          else arrive(state, a, ctx);
        } else if (a.state === 'FLEE') { requestRoute(state, a, true); }
        else requestRoute(state, a, false);
      }
      if (a.route.length && a.routeIdx < a.route.length && a.state !== 'IDLE') {
        const i = agentTile(a);
        const d = depthAt(state, i);
        let cls = state.tiles.walk[i];
        if (d >= BSU.params.hydro.thresholds.wading) { cls = 4; if (a.state === 'WALK') a.state = 'WADE'; }
        else if (a.state === 'WADE') a.state = 'WALK';
        if (!cls) cls = 2;
        const mods = { advisory: ctx.advisory, watch: ctx.watch, debris: (state.tiles.flags[i] & FLAG.DEBRIS) !== 0 };
        let speed = M.stepSpeed(cls, mods) * mult;
        if (a.state === 'FLEE') speed = Math.max(speed, SPEED_BY_CLASS[2] * mult);
        if (a.state === 'BUS') speed = Math.max(speed, SPEED_BY_CLASS[1] * mult);
        moving = true;
        const done = advance(state, a, speed, ctx);
        if (a.state === 'WADE') splash(state, a, ctx);
        if (done) {
          if (a.state === 'FLEE') { a.route = []; a.routeIdx = 0; }
          else if (a.state === 'BUS') { a.state = 'GONE'; return; }
          else arrive(state, a, ctx);
        }
      }
    } else if (a.state === 'IDLE' && a.goal === 'idle' && !a.inside && a.target < 0 && ctx.phase === SKY.GOLDEN && !state.setPiece && BSU.rng.sim.chance(C.idleWanderP)) {
      setGoal(state, a, 'idle', idleSpot(state, a, BSU.rng.sim, ctx.advisory), null);
    }
    updateStats(state, a, ctx, moving);
  }

  // ---------------------------------------------------------------------------
  // Storm: shelter (D41), evacuation, release
  // ---------------------------------------------------------------------------
  /** greedy, rng-free: agent index order, nearest shelter (Chebyshev to its footprint, ties by lower id) with remaining capacity */
  M.shelter = function (state, capacities) {
    guard('shelter', function () {
      if (!state || !state.agents) return;
      ensure(state);
      const caps = [];
      if (capacities && typeof capacities === 'object') {
        for (const k in capacities) {
          const id = Number(k), cap = Math.floor(fin(capacities[k], 0));
          const b = getBuilding(state, id);
          if (b && cap > 0) caps.push({ b: b, id: id, left: cap });
        }
      }
      caps.sort(function (p, q) { return p.id - q.id; });
      X.sheltering = true;
      const A = state.agents;
      for (let k = 0; k < A.length; k++) {
        const a = A[k];
        if (!present(a) || a.state === 'BUS') continue;
        const tx = Math.floor(a.tx), ty = Math.floor(a.ty);
        let best = null, bd = 1e9;
        for (let q = 0; q < caps.length; q++) {
          const c = caps[q];
          if (c.left <= 0) continue;
          const d = nearestBuildingTile(c.b, tx, ty);
          if (d < bd) { bd = d; best = c; }
        }
        if (!best) { a.unsheltered = true; continue; }
        best.left--;
        a.unsheltered = false;
        if (a.state === 'FLEE') endFlee(state, a);
        setGoal(state, a, 'shelter', best.id, null);
      }
    });
  };
  /** every agent boards a bus: walk to the nearest road tile and despawn over one day; buses run on the roads */
  M.evacuate = function (state) {
    guard('evacuate', function () {
      if (!state || !state.agents) return;
      ensure(state);
      X.evacuating = true;
      const roads = [];
      for (let i = 0; i < N; i++) if (state.tiles.surface[i] === BSU.SURF.ROAD && state.tiles.walk[i] > 0) roads.push(i);
      const A = state.agents;
      for (let k = 0; k < A.length; k++) {
        const a = A[k];
        if (!present(a)) continue;
        const tx = Math.floor(a.tx), ty = Math.floor(a.ty);
        let best = -1, bd = 1e9;
        for (let q = 0; q < roads.length; q++) { const d = cheb(tx, ty, roads[q] & 63, roads[q] >> 6); if (d < bd) { bd = d; best = roads[q]; } }
        if (a.state === 'FLEE') endFlee(state, a);
        a.state = 'BUS'; a.goal = 'tile'; a.target = best >= 0 ? best : agentTile(a); a.route = []; a.routeIdx = 0; a.inside = false; a.waitTicks = 0; a.next = null;
        a.evacUntil = fin(state.tick, 0) + C.evacuateTicks + (a.id % 20);
        if (best < 0) a.evacUntil = fin(state.tick, 0) + 1;
      }
      spawnBuses(state, true, 'evac');
    });
  };
  function releaseStorm(state) {
    X.sheltering = false; X.evacuating = false;
    const A = state.agents;
    for (let k = 0; k < A.length; k++) {
      const a = A[k];
      if (!a || a.state === 'GONE') continue;
      if (a.state === 'SHELTER' || a.goal === 'shelter') { a.state = 'IDLE'; a.goal = 'idle'; a.target = -1; a.route = []; a.routeIdx = 0; a.inside = false; }
      if (a.state === 'BUS') { a.state = 'GONE'; a.route = []; }
      a.unsheltered = false;
    }
    removeVehicles(state, function (v) { return v.kind === 'bus' && v.tag === 'evac'; });
    X.lastPhase = -1;
  }

  // ---------------------------------------------------------------------------
  // Arrivals (D42, GDD §10.1) and vehicles (§7)
  // ---------------------------------------------------------------------------
  function makeVehicle(kind, route, speed, extra) {
    const t0 = route.length ? route[0] : 0;
    const v = { kind: kind, tx: (t0 & 63) + 0.5, ty: (t0 >> 6) + 0.5, px: 0, py: 0, route: route, routeIdx: 0, state: 'GO', payload: 0, ttl: 0, dir: 1, frame: 0, tag: '' };
    v.px = v.tx; v.py = v.ty;
    v.speed = speed;
    if (extra) for (const k in extra) v[k] = extra[k];
    return v;
  }
  function removeVehicles(state, pred) {
    const V = state.vehicles;
    for (let k = V.length - 1; k >= 0; k--) if (V[k] && pred(V[k])) V.splice(k, 1);
  }
  function bayouRoute(state) {
    const b = Array.isArray(state.plot.bayou) ? state.plot.bayou.filter(validTile) : [];
    if (!b.length) return [];
    const li = b.indexOf(state.plot.landing);
    return li >= 0 ? b.slice(0, li + 1) : b.slice();
  }
  function landingTile(state) {
    const s = state.plot.landingShoulder;
    if (validTile(s) && state.tiles.walk[s] > 0) return s;
    if (validTile(s)) return walkableSpawn(state, s);
    const l = state.plot.landing;
    if (validTile(l)) return walkableSpawn(state, l);
    return foundersFront(state);
  }
  function roadEntry(state) {
    const hw = Array.isArray(state.plot.highway) ? state.plot.highway.filter(validTile) : [];
    const start = hw.length ? hw[0] : -1;
    const f = foundersFront(state), fx = f & 63, fy = f >> 6;
    let best = -1, bd = 1e9;
    for (let i = 0; i < N; i++) if (state.tiles.surface[i] === BSU.SURF.ROAD) { const d = cheb(fx, fy, i & 63, i >> 6); if (d < bd) { bd = d; best = i; } }
    return { start: start, end: best >= 0 ? best : (hw.length ? hw[hw.length - 1] : -1) };
  }
  /** CREATES the arriving agents (parked inside the vehicles) and the vehicles that bring them */
  M.spawnArrival = function (state, count, kind) {
    guard('spawnArrival', function () {
      if (!state || !state.agents) return;
      ensure(state);
      count = Math.max(0, Math.floor(fin(count, 0)));
      kind = (kind === 'bus' || kind === 'founding') ? kind : 'pirogue';
      const pending = kind === 'founding' ? count : 0;
      const students = fin(state.economy.students, 0) + pending;
      const newTarget = students > 0 ? Math.min(P.cap, P.base + Math.floor(students / P.perStudents)) : 0;
      const n = Math.max(0, newTarget - liveCount(state));
      const k = X.nextArrival++;
      X.homesDirty = true; refreshBuildingCaches(state);
      const r = BSU.rng.sim;
      const ids = [];
      const A = state.agents;
      for (let q = 0; q < n; q++) {
        const id = A.length;
        const a = makeAgent(state, r, id, undefined);
        a.arrival = k; a.aboard = true; a.inside = true; a.state = 'IDLE';
        A.push(a); ids.push(id);
      }
      X.arrivals.set(k, { kind: kind, count: count, announced: false, ids: ids });
      // vehicles
      const vehicles = [];
      if (kind === 'bus') {
        const re = roadEntry(state);
        let route = null;
        if (validTile(re.start) && validTile(re.end)) route = M.routeSync(state, re.start, re.end, 'road');
        if (!route) route = validTile(re.end) ? [re.end] : (validTile(re.start) ? [re.start] : [landingTile(state)]);
        const nb = BSU.params.sports.buses;
        for (let q = 0; q < nb; q++) vehicles.push(makeVehicle('bus', route, P.vehicleSpeed.bus / 10, { arrival: k, delay: q * 8, unloadAt: route[route.length - 1] }));
      } else {
        const nv = BSU.clamp(Math.ceil(count / C.pirogueCapacity), 1, P.piroguesMax);
        const route = bayouRoute(state);
        const spd = route.length > 1 ? (route.length - 1) / C.pirogueTicks : 0;
        for (let q = 0; q < (kind === 'founding' ? P.piroguesMax : nv); q++) vehicles.push(makeVehicle('pirogue', route.length ? route : [landingTile(state)], spd, { arrival: k, delay: q * 6, unloadAt: landingTile(state), ttl: route.length > 1 ? 0 : C.pirogueTicks }));
      }
      for (let q = 0; q < vehicles.length; q++) { vehicles[q].ids = ids.filter(function (id, idx) { return idx % vehicles.length === q; }); vehicles[q].payload = vehicles[q].ids.length; state.vehicles.push(vehicles[q]); }
      // park the agents on the vehicle's first tile
      for (let q = 0; q < vehicles.length; q++) { const v = vehicles[q]; for (let z = 0; z < v.ids.length; z++) { const a = A[v.ids[z]]; a.tx = v.tx; a.ty = v.ty; a.px = v.tx; a.py = v.ty; } }
      if (n === 0 && !vehicles.length) { const g = X.arrivals.get(k); g.announced = true; emit(EV.AGENT_ARRIVE, { count: count, kind: kind }); }
    });
  };
  /** the students step off: walk to Founders'/their dorm, waving */
  function unload(state, v) {
    const g = X.arrivals.get(v.arrival);
    const at = walkableSpawn(state, validTile(v.unloadAt) ? v.unloadAt : landingTile(state));
    for (let z = 0; z < v.ids.length; z++) {
      const a = state.agents[v.ids[z]];
      if (!a) continue;
      a.tx = (at & 63) + 0.5; a.ty = (at >> 6) + 0.5; a.px = a.tx; a.py = a.ty; a.lastTile = at;
      a.inside = false; a.aboard = false;
      a.waveUntil = fin(state.tick, 0) + C.waveTicks;
      rehome(state, a);
      homeGoal(state, a);
    }
    if (!v.ids.length && g && !g.announced) { g.announced = true; emit(EV.AGENT_ARRIVE, { count: g.count, kind: g.kind }); }
    v.ids = []; v.payload = 0;
  }
  function spawnBuses(state, on, tag) {
    removeVehicles(state, function (v) { return v.kind === 'bus' && v.tag === tag; });
    if (!on) return;
    const Tr = dep('terrain');
    let loop = null;
    if (Tr && typeof Tr.paradeRoute === 'function') loop = Tr.paradeRoute(state);
    if (!Array.isArray(loop) || loop.length < 2) { const re = roadEntry(state); loop = (validTile(re.start) && validTile(re.end)) ? M.routeSync(state, re.start, re.end, 'road') : null; }
    if (!Array.isArray(loop) || loop.length < 2) loop = Array.isArray(state.plot.highway) && state.plot.highway.length > 1 ? state.plot.highway.filter(validTile) : null;
    if (!loop || loop.length < 2) return;
    const nb = BSU.params.sports.buses;
    for (let q = 0; q < nb; q++) {
      const v = makeVehicle('bus', loop, C.busLoopSpeed / 10, { tag: tag, delay: q * Math.floor(loop.length / nb) });
      v.state = 'LOOP';
      state.vehicles.push(v);
    }
  }
  /** 3 buses looping the parade route / roads at 5 tiles/s (game day) */
  M.gameDayBuses = function (state, on) { guard('gameDayBuses', function () { if (!state || !state.vehicles) return; ensure(state); spawnBuses(state, !!on, 'game'); }); };
  /** the fogger truck loops the paths within 8 tiles of an active abatement station (Dusk) */
  M.startFogger = function (state, postId) {
    guard('startFogger', function () {
      if (!state || !state.vehicles) return;
      ensure(state);
      const b = getBuilding(state, postId);
      if (!b) return;
      const door = doorTile(state, b), dx0 = door & 63, dy0 = door >> 6;
      // BFS over path/road/boardwalk tiles within the radius
      const seen = new Uint8Array(N), order = [], q = [door]; seen[door] = 1;
      while (q.length) {
        const cur = q.shift(); order.push(cur);
        const nb = BSU.nbr4(cur);
        for (let k = 0; k < nb.length; k++) { const n = nb[k]; if (seen[n]) continue; const s = state.tiles.surface[n]; if (s < 1 || s > 3) continue; if (cheb(dx0, dy0, n & 63, n >> 6) > C.foggerRadius) continue; seen[n] = 1; q.push(n); }
      }
      let route = order.length > 1 ? order : [door];
      // out and back so the truck returns to the station
      route = route.concat(route.slice(0, -1).reverse());
      removeVehicles(state, function (v) { return v.kind === 'fogger' && v.post === b.id; });
      const v = makeVehicle('fogger', route, P.vehicleSpeed.fogger / 10, { post: b.id, ttl: C.foggerTicks });
      v.state = 'LOOP';
      state.vehicles.push(v);
    });
  };
  /** 4–8 'navy' pirogues shuttling from the bayou to the flooded dorms' nearest water tile for 3 days */
  M.launchCajunNavy = function (state, dormIds) {
    guard('launchCajunNavy', function () {
      if (!state || !state.vehicles) return;
      ensure(state);
      const ids = Array.isArray(dormIds) ? dormIds : [];
      const boats = BSU.clamp(PS.cajunNavyBoats[0] + ids.length, PS.cajunNavyBoats[0], PS.cajunNavyBoats[1]);
      const bayou = bayouRoute(state);
      const start = bayou.length ? bayou[0] : (validTile(state.plot.landing) ? state.plot.landing : foundersFront(state));
      const targets = [];
      for (let k = 0; k < ids.length; k++) {
        const b = getBuilding(state, ids[k]);
        if (!b) continue;
        let best = -1, bd = 1e9;
        for (let i = 0; i < N; i++) if (stepCost(state, i, 'water')) { const d = nearestBuildingTile(b, i & 63, i >> 6); if (d < bd) { bd = d; best = i; } }
        if (best >= 0) targets.push(best);
      }
      if (!targets.length) targets.push(validTile(state.plot.landing) ? state.plot.landing : start);
      for (let q = 0; q < boats; q++) {
        const to = targets[q % targets.length];
        const route = M.routeSync(state, start, to, 'water') || [start, to];
        const v = makeVehicle('cajunNavy', route, P.vehicleSpeed.pirogue / 10, { ttl: C.cajunNavyTicks, delay: q * 10 });
        v.state = 'SHUTTLE';
        state.vehicles.push(v);
      }
    });
  };
  /** n officer-style crew sprites walk from the nearest Wildlife Post (or Founders') to a target tile and back */
  M.crewSprites = function (state, target, n) {
    guard('crewSprites', function () {
      if (!state || !state.vehicles || !validTile(target)) return;
      ensure(state);
      n = BSU.clamp(Math.floor(fin(n, C.crewN)), 1, 12);
      const posts = listBuildings(state, 'wildlife_post').filter(isComplete);
      const post = posts.length ? nearestOf(state, posts, target & 63, target >> 6, false) : null;
      const from = post ? doorTile(state, post) : foundersFront(state);
      const to = walkableSpawn(state, target);
      const route = M.routeSync(state, from, to, 'walk') || [from];
      for (let q = 0; q < n; q++) {
        const v = makeVehicle('crew', route, P.vehicleSpeed.officer / 10, { delay: q * 4, ttl: 60 });
        v.state = 'GO';
        state.vehicles.push(v);
      }
    });
  };
  /** move a vehicle along its route; returns true when the end of the route is reached */
  function advanceVehicle(v, dist) {
    const route = v.route;
    let g = 0;
    while (dist > 0 && v.routeIdx < route.length && g++ < 32) {
      const node = route[v.routeIdx];
      const nx = (node & 63) + 0.5, ny = (node >> 6) + 0.5;
      const dx = nx - v.tx, dy = ny - v.ty, len = Math.abs(dx) + Math.abs(dy);
      if (len > 0.0001) v.dir = M.dirOf(dx, dy);
      if (len <= dist) { v.tx = nx; v.ty = ny; dist -= len; v.routeIdx++; }
      else { v.tx += dx / len * dist; v.ty += dy / len * dist; dist = 0; }
    }
    if (!Number.isFinite(v.tx) || !Number.isFinite(v.ty)) { v.tx = W / 2; v.ty = H / 2; }
    v.tx = BSU.clamp(v.tx, 0.5, W - 0.5); v.ty = BSU.clamp(v.ty, 0.5, H - 0.5);
    return v.routeIdx >= route.length;
  }
  function tickVehicles(state, ctx) {
    const V = state.vehicles;
    for (let k = V.length - 1; k >= 0; k--) {
      const v = V[k];
      if (!v) { V.splice(k, 1); continue; }
      v.px = v.tx; v.py = v.ty;
      v.frame = (v.frame + 1) & 1023;
      if (v.delay > 0) { v.delay--; continue; }
      const spd = fin(v.speed, 0.3);
      let done = false;
      if (v.state === 'GO') {
        if (v.route.length <= 1) { done = --v.ttl <= 0 || v.ttl < 0; if (!isInt(v.ttl) || v.ttl <= 0) done = true; }
        else done = advanceVehicle(v, spd);
        if (done) {
          if (v.arrival) { unload(state, v); v.state = 'BACK'; v.route = v.route.slice().reverse(); v.routeIdx = 0; }
          else if (v.kind === 'crew') { v.state = 'WAIT'; v.ttl = 30; }
          else { v.state = 'BACK'; v.route = v.route.slice().reverse(); v.routeIdx = 0; }
        }
      } else if (v.state === 'WAIT') {
        if (--v.ttl <= 0) { v.state = 'BACK'; v.route = v.route.slice().reverse(); v.routeIdx = 0; }
      } else if (v.state === 'BACK') {
        if (v.route.length <= 1 || advanceVehicle(v, spd)) V.splice(k, 1);
      } else if (v.state === 'LOOP') {
        if (v.route.length <= 1 || advanceVehicle(v, spd)) { v.routeIdx = 0; v.route = v.route.slice().reverse(); }
        if (v.kind === 'fogger' && --v.ttl <= 0) V.splice(k, 1);
      } else if (v.state === 'SHUTTLE') {
        if (v.route.length <= 1 || advanceVehicle(v, spd)) { v.routeIdx = 0; v.route = v.route.slice().reverse(); }
        if (--v.ttl <= 0) V.splice(k, 1);
      } else V.splice(k, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle: init (listeners set flags only), reset, tick (§5.1 step 6)
  // ---------------------------------------------------------------------------
  function on(name, fn) {
    BSU.events.on(name, function (payload) { try { fn(payload || {}); } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('agents', 'on:' + name, e); } }, 'agents');
  }
  M.init = function (state) {
    guard('init', function () {
      BSU.events.clear('agents');
      on(EV.TILE_CHANGED, function (p) { M.invalidateRoutes(BSU.state || state, p.i); X.homesDirty = true; });
      on(EV.ENROLL_ROUND, function (p) { X.pendingArrivals.push({ count: fin(p.admitted, 0), kind: 'pirogue' }); });
      on(EV.ENROLL_LOCK, function (p) {
        const n = Math.max(0, Math.floor(fin(p.admitted, 0)));
        if (p.kind === 'fall') { const bus = Math.floor(n * 0.5); if (bus > 0) X.pendingArrivals.push({ count: bus, kind: 'bus' }); if (n - bus > 0) X.pendingArrivals.push({ count: n - bus, kind: 'pirogue' }); }
        else if (n > 0) X.pendingArrivals.push({ count: n, kind: 'pirogue' });
      });
      on(EV.ENROLL_ATTRITION, function () { /* the daily reconcile despawns the excess */ });
      on(EV.ENROLL_GRADUATION, function () { /* idem */ });
      on(EV.BUILDING_PLACED, function () { X.homesDirty = true; });
      on(EV.BUILDING_REMOVED, function () { X.homesDirty = true; X.rehomeAll = true; });
      on(EV.BUILDING_COMPLETE, function () { X.homesDirty = true; X.rehomeAll = true; });
      on(EV.STORM_PASSED, function () { X.releaseShelter = true; });
      on(EV.GAME_KICKOFF, function () { X.lastPhase = -1; });
      on(EV.GAME_FINAL, function () { X.lastPhase = -1; X.pendingBuses = false; });
      on(EV.GAME_SCORE, function (p) { if (p.side === 'home') X.cheerUntil = -2; });
      on(EV.FESTIVAL_START, function (p) { if (p.id === 'mardiGras') X.beads = true; });
      on(EV.FESTIVAL_END, function (p) { if (p.id === 'mardiGras') X.beads = false; });
      on(EV.SKY_PHASE, function () { /* transitions are detected in tick from weather.sky() */ });
      on(EV.GATOR_CAMPUS, function () { /* flee is proximity-checked each tick */ });
    });
  };
  /** both cases regenerate from (seed, tick) with a derived stream; rng.sim is drawn in neither */
  M.reset = function (state, fresh) {
    guard('reset', function () {
      X = newCtx(); X.root = state;
      if (!state || !state.tiles) return;
      if (!Array.isArray(state.agents)) state.agents = [];
      if (!Array.isArray(state.vehicles)) state.vehicles = [];
      M.regenerate(state);
    });
  };
  /** called internally at flags.newDay; exposed for tests */
  M.resetDaySamples = function (state) {
    guard('resetDaySamples', function () {
      ensure(state);
      const n = X.acc.n;
      X.lastSample = { life: n ? X.acc.life / n : 0, green: n ? X.acc.green / n : 0, mosq: n ? X.acc.mosq / n : 0, heat: n ? X.acc.heat / n : 0, n: n };
      X.acc.life = 0; X.acc.green = 0; X.acc.mosq = 0; X.acc.heat = 0; X.acc.n = 0;
      const A = state.agents || [];
      for (let k = 0; k < A.length; k++) { const a = A[k]; if (!a) continue; a.sample.life = 0; a.sample.green = 0; a.sample.mosq = 0; a.sample.heat = 0; a.sample.n = 0; a.bitten = 0; }
    });
  };
  function dayRoll(state) {
    M.resetDaySamples(state);
    // desire lines: tiles that crossed the threshold today and were not reported yesterday
    const fresh = [];
    for (let k = 0; k < X.wornList.length; k++) { const i = X.wornList[k]; if (!X.reportedYesterday[i] && state.tiles.wear[i] >= P.wearThreshold - P.wearDecay) fresh.push(i); }
    X.reportedYesterday.fill(0);
    for (let k = 0; k < X.wornList.length; k++) X.reportedYesterday[X.wornList[k]] = 1;
    X.wornToday.fill(0); X.wornList.length = 0;
    if (fresh.length && X.desireLineDay !== calDay(state)) { X.desireLineDay = calDay(state); emit(EV.AGENT_DESIRE_LINE, { tiles: fresh }); }
    reconcile(state);
  }
  function visibleRect() {
    const R = dep('render');
    if (R && typeof R.visibleTiles === 'function') {
      const v = R.visibleTiles();
      if (v && isInt(v.x0) && isInt(v.x1) && isInt(v.y0) && isInt(v.y1)) return { x0: v.x0 - P.offscreenMargin, y0: v.y0 - P.offscreenMargin, x1: v.x1 + P.offscreenMargin, y1: v.y1 + P.offscreenMargin };
    }
    return { x0: -1, y0: -1, x1: W, y1: H };
  }
  M.tick = function (state, flags) {
    guard('tick', function () {
      if (!state || !state.tiles || !Array.isArray(state.agents)) return;
      ensure(state);
      if (!Array.isArray(state.vehicles)) state.vehicles = [];
      const tick = fin(state.tick, 0);
      drainQueue(state);
      // queued arrivals from the enroll listeners
      while (X.pendingArrivals.length) { const p = X.pendingArrivals.shift(); M.spawnArrival(state, p.count, p.kind); }
      if (X.releaseShelter) { X.releaseShelter = false; releaseStorm(state); }
      if (X.rehomeAll) { X.rehomeAll = false; X.homesDirty = true; refreshBuildingCaches(state); const A = state.agents; for (let k = 0; k < A.length; k++) if (A[k] && A[k].state !== 'GONE') rehome(state, A[k]); }
      if (flags && flags.newDay) dayRoll(state);
      refreshBuildingCaches(state);
      // per-tick context
      const heat = heatInfo(state);
      const B = dep('buildings');
      let auras = null;
      if (B && typeof B.auras === 'function') auras = B.auras(state);
      const dp = BSU.dayParts(calDay(state));
      const ctx = {
        tick: tick, phase: skyPhase(state), advisory: heat.advisory, heatIndex: heat.index, rain: raining(state),
        watch: stormPhase(state) === STORM.WATCH, gators: gators(state), auras: auras,
        summerSession: timerActive(state, 'summerSession'),
        sickShare: fin(state.economy.students, 0) > 0 ? BSU.clamp(fin(state.wildlife && state.wildlife.sick, 0) / Math.max(1, fin(state.economy.students, 0)), 0, 1) : 0,
        graduationDay: dp.date === BSU.params.econ.graduationDate
      };
      X.visible = visibleRect();
      const vis = X.visible;
      const A = state.agents;
      // phase transitions and the game / set-piece overrides
      const game = !!(state.sports && state.sports.game);
      const sp = state.setPiece ? state.setPiece.kind : null;
      const phaseChanged = ctx.phase !== X.lastPhase || game !== X.lastGame || sp !== X.lastSetPiece;
      if (phaseChanged) {
        if (ctx.phase === SKY.DAWN && X.lastPhase !== SKY.DAWN) { X.assigned = 0; X.reached = 0; }
        if (ctx.phase === SKY.DUSK && X.lastPhase !== SKY.DUSK && X.lastPhase !== -1) X.lastAttendance = X.assigned ? X.reached / X.assigned : 1;
        if (game && !X.lastGame) spawnBuses(state, true, 'game');
        if (!game && X.lastGame) spawnBuses(state, false, 'game');
        X.lastPhase = ctx.phase; X.lastGame = game; X.lastSetPiece = sp;
        for (let k = 0; k < A.length; k++) { const a = A[k]; if (present(a)) schedule(state, a, ctx.phase, ctx); }
      }
      // cheer on a home score
      if (X.cheerUntil === -2) { X.cheerUntil = tick + C.cheerTicks; for (let k = 0; k < A.length; k++) { const a = A[k]; if (present(a) && (a.goal === 'event' || game)) a.cheerUntil = X.cheerUntil; } }
      // graduation cap toss at set-piece tick 100
      if (sp === 'graduation' && state.setPiece.tick === C.capTossTick && !X.capToss) { X.capToss = true; for (let k = 0; k < A.length; k++) { const a = A[k]; if (present(a)) { a.prop = 'cap'; a.cheerUntil = tick + C.cheerTicks; } } }
      if (sp !== 'graduation') X.capToss = false;
      // agents
      for (let k = 0; k < A.length; k++) {
        const a = A[k];
        if (!a || a.state === 'GONE' || a.aboard) continue;
        a.px = a.tx; a.py = a.ty;
        const tx = a.tx | 0, ty = a.ty | 0;
        const onScreen = tx >= vis.x0 && tx <= vis.x1 && ty >= vis.y0 && ty <= vis.y1;
        if (onScreen) tickAgent(state, a, ctx, 1);
        else if ((a.id % P.offscreenRate) === (tick % P.offscreenRate)) tickAgent(state, a, ctx, P.offscreenRate);
        samplePresent(state, a, ctx);
      }
      tickVehicles(state, ctx);
      state.agents = A;
    });
  };

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  /** state.agents (read-only for others) */
  M.list = function (state) { return (state && Array.isArray(state.agents)) ? state.agents : []; };
  /** state.vehicles */
  M.vehicles = function (state) { return (state && Array.isArray(state.vehicles)) ? state.vehicles : []; };
  /** the completed calendar day's mean over agents ({n: 0} before the first) */
  M.sample = function (state) { if (state) ensure(state); const s = X.lastSample; return { life: s.life, green: s.green, mosq: s.mosq, heat: s.heat, n: s.n }; };
  /** the last completed sky cycle's reached/assigned ratio (1 before the first) */
  M.classAttendance = function (state) { if (state) ensure(state); const v = X.lastAttendance; return Number.isFinite(v) ? BSU.clamp(v, 0, 1) : 1; };
  /** '.' key: a random present agent (presentation randomness: rng.fx) */
  M.follow = function (state) {
    return guard('follow', function () {
      const A = M.list(state).filter(present);
      if (!A.length) return null;
      return A[BSU.rng.fx.int(A.length)] || null;
    }) || null;
  };
  /** the present agent nearest (tx, ty) within radius tiles, or null */
  M.nearest = function (state, tx, ty, radius) {
    return guard('nearest', function () {
      const A = M.list(state);
      let best = null, bd = fin(radius, 1) + 0.5;
      for (let k = 0; k < A.length; k++) { const a = A[k]; if (!present(a) || a.inside) continue; const d = Math.max(Math.abs(a.tx - fin(tx, -99)), Math.abs(a.ty - fin(ty, -99))); if (d <= bd) { bd = d; best = a; } }
      return best;
    }) || null;
  };
  /** inspect panel rows */
  M.inspect = function (state, id) {
    return guard('inspect', function () {
      const A = M.list(state);
      const a = isInt(id) ? A[id] : null;
      if (!a) return { name: '', major: '', year: 0, mood: 0, activity: '', quote: '' };
      let activity;
      if (a.state === 'GONE') activity = 'Away';
      else if (a.arrival) activity = 'Arriving';
      else if (a.state === 'FLEE') { const g = gators(state).find(function (x) { return x && x.id === a.fleeGator; }); activity = 'Fleeing: ' + (g && g.name ? g.name : 'a gator'); }
      else if (a.state === 'WADE') activity = 'Wading';
      else if (a.state === 'SHELTER') activity = 'Sheltering';
      else if (a.state === 'BUS') activity = 'Evacuating';
      else if (a.state === 'CHEER') activity = 'Cheering';
      else if (a.state === 'SIT') activity = 'Wilting in the shade';
      else if (a.inside) activity = a.goal === 'class' ? 'In class' : (a.goal === 'home' ? 'In the dorm' : 'Inside');
      else activity = GOAL_TEXT[a.goal] || 'Idle';
      const D = dep('data');
      const quotes = (D && D.students && Array.isArray(D.students.quotes) && D.students.quotes.length) ? D.students.quotes : ['Geaux.'];
      return { name: a.name, major: a.major, year: a.year, mood: a.mood, activity: activity, quote: quotes[a.id % quotes.length] };
    }) || { name: '', major: '', year: 0, mood: 0, activity: '', quote: '' };
  };

  /** test hooks (functions only, D46): route-cache / queue inspection */
  M._debug = {
    cacheSize: function () { return X.routeCache.size; },
    cacheHas: function (from, to, grid) { return X.routeCache.has(routeKey(from, to, grid || 'walk')); },
    queueSize: function () { return X.queue.length; },
    counters: function () { return { assigned: X.assigned, reached: X.reached }; }
  };

  // ---------------------------------------------------------------------------
  // selfTest (§10.6): private state, stubbed deps, recorded emits; never the live bus
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const savedCtx = X, savedDeps = M._deps, savedSim = BSU.rng.sim.state;
    const rec = [];
    const A = function (c, m) { BSU.assert(c, 'agents: ' + m); };
    try {
      // --- stubs -------------------------------------------------------------
      const life = new Float32Array(N), green = new Float32Array(N), shade = new Float32Array(N), heatMap = new Float32Array(N).fill(1);
      const dorm = { id: 0, type: 'dorm', tx: 20, ty: 20, w: 3, h: 2, built: 1, ruin: false, flooded: false, tier: 0 };
      const hall = { id: 1, type: 'lecture_hall', tx: 30, ty: 20, w: 3, h: 2, built: 1, ruin: false, flooded: false, tier: 0 };
      const blds = [dorm, hall];
      let gatorList = [];
      let advisory = false, fixedPhase = -1;
      const phaseOf = function (t) { const c = ((t % 300) + 300) % 300; let acc = 0; for (let p = 0; p < 5; p++) { acc += BSU.SKY_TICKS[p]; if (c < acc) return p; } return 4; };
      M._deps = {
        emit: function (name, payload) { rec.push({ name: name, payload: payload }); },
        buildings: {
          list: function (s, t) { return blds.filter(function (b) { return !t || b.type === t; }); },
          get: function (s, id) { return blds[id] || null; },
          footprint: function (s, id) { const b = blds[id]; return b ? BSU.footprintTiles(b.tx, b.ty, b.w, b.h) : []; },
          effective: function () { return 1; },
          auras: function () { return { life: life, green: green, shade: shade, heat: heatMap, dining: new Uint8Array(N), mosq: new Float32Array(N), noise: new Float32Array(N) }; },
          shelterAssignments: function () { return {}; }, at: function () { return null; }
        },
        wildlife: { gators: function () { return gatorList; }, onCampus: function () { return []; }, mosqAt: function () { return 0; }, gatorGridPassable: function () { return true; } },
        weather: {
          sky: function (s) { return { phase: fixedPhase >= 0 ? fixedPhase : phaseOf(s.tick), t: 0, phaseTick: 0, scripted: false }; },
          raining: function () { return false; }, rainAt: function () { return 0; },
          heat: function () { return { index: advisory ? 100 : 80, advisory: advisory, wave: false }; },
          date: function (s) { const d = BSU.dayParts(s.calendar.day); return { day: d.day, year: d.year, month: d.month, dom: d.dom, str: '', season: d.season, semester: d.semester }; },
          storm: function () { return null; }
        },
        hydro: { depthAt: function () { return 0; } },
        sports: { season: function (s) { return s.sports; } },
        progress: { timer: function () { return null; }, timers: function () { return []; } },
        render: null, terrain: null, sprites: { agentLook: function (n) { return n & 511; } }, data: BSU.data
      };
      const mkState = function (seed) {
        const s = BSU.newState(seed);
        s.tiles.walk.fill(2); s.tiles.type.fill(T.DRY);
        for (let b = 0; b < blds.length; b++) { const fp = BSU.footprintTiles(blds[b].tx, blds[b].ty, blds[b].w, blds[b].h); for (let k = 0; k < fp.length; k++) { s.tiles.owner[fp[k]] = b; s.tiles.walk[fp[k]] = 0; } }
        for (let x = 20; x <= 33; x++) { s.tiles.walk[22 * W + x] = 1; s.tiles.surface[22 * W + x] = BSU.SURF.PATH; }
        s.plot.founders = { tx: 40, ty: 7 };
        s.calendar.day = 10;
        return s;
      };
      const flagsDay = { newDay: true, newMonth: false, newYear: false, newSemester: false, day: 0 };
      const flagsNone = { newDay: false, newMonth: false, newYear: false, newSemester: false, day: 0 };
      const run = function (s, n, day) { for (let k = 0; k < n; k++) { M.tick(s, day ? flagsDay : flagsNone); s.tick++; } };

      // 1. A* on a 20×20 open grid; a wall with a gap; a blocked target; cost classes
      {
        const s = BSU.newState(11); s.tiles.walk.fill(0);
        for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) s.tiles.walk[BSU.idx(x, y)] = 2;
        M.reset(s, true);
        const r = M.routeSync(s, BSU.idx(0, 0), BSU.idx(19, 19), 'walk');
        A(r && r.length === 39, 'open-grid A* length 39, got ' + (r && r.length));
        let steps4 = true; for (let k = 1; k < r.length; k++) { const d = Math.abs((r[k] & 63) - (r[k - 1] & 63)) + Math.abs((r[k] >> 6) - (r[k - 1] >> 6)); if (d !== 1) steps4 = false; }
        A(steps4, 'A* steps are 4-connected');
        for (let y = 0; y < 20; y++) if (y !== 5) s.tiles.walk[BSU.idx(10, y)] = 0;
        M.invalidateRoutes(s, BSU.idx(10, 0));
        const r2 = M.routeSync(s, BSU.idx(0, 0), BSU.idx(19, 19), 'walk');
        A(r2 && r2.indexOf(BSU.idx(10, 5)) >= 0, 'A* routes through the one gap');
        s.tiles.walk[BSU.idx(19, 19)] = 0; M.invalidateRoutes(s, BSU.idx(19, 19));
        A(M.routeSync(s, BSU.idx(0, 0), BSU.idx(19, 19), 'walk') === null, 'blocked target → null');
        for (let y = 0; y < 20; y++) s.tiles.walk[BSU.idx(10, y)] = 2;
        for (let x = 0; x < 20; x++) s.tiles.walk[BSU.idx(x, 1)] = 1;
        M.reset(s, true);
        const r3 = M.routeSync(s, BSU.idx(0, 0), BSU.idx(19, 0), 'walk');
        let onPath = 0; for (let k = 0; k < r3.length; k++) if ((r3[k] >> 6) === 1) onPath++;
        A(onPath >= 17, 'the class-1 corridor is preferred (' + onPath + ' of ' + r3.length + ' on it)');
        A(M.route(s, -1, 5, 'walk') === null && M.route(s, 5, 99999, 'walk') === null && M.route(s, NaN, 5) === null, 'bad tiles → null');
      }
      // 2. speed table
      A(Math.abs(M.stepSpeed(1) - 0.4) < 1e-9 && Math.abs(M.stepSpeed(2) - 0.24) < 1e-9 && Math.abs(M.stepSpeed(3) - 0.16) < 1e-9 && Math.abs(M.stepSpeed(4) - 0.12) < 1e-9, 'walk-class speed table');
      A(Math.abs(M.stepSpeed(1, { advisory: true }) - 0.32) < 1e-9 && M.stepSpeed(0) === 0 && M.stepSpeed(NaN) === 0, 'heat advisory ×.8');
      // 3. count
      {
        const s = BSU.newState(1);
        const cnt = function (n) { s.economy.students = n; return M.count(s); };
        A(cnt(0) === 0 && cnt(120) === 44 && cnt(5000) === 240 && cnt(20000) === 300 && cnt(-5) === 0, 'count formula');
        A(M.count(null) === 0 && M.count({}) === 0, 'count on bad input');
      }
      // 4. regenerate determinism
      {
        const s = mkState(4); s.economy.students = 500; s.tick = 700;
        M.reset(s, true);
        const sig = function () { return s.agents.map(function (a) { return a.name + '|' + a.home + '|' + a.cls + '|' + a.tx + ',' + a.ty; }).join(';'); };
        A(s.agents.length === 60, 'regenerate builds count(state) agents (60), got ' + s.agents.length);
        const s1 = sig(); M.reset(s, false); const s2 = sig();
        A(s1 === s2, 'regenerate is deterministic for (seed, tick)');
        s.tick = 701; M.reset(s, false);
        A(sig() !== s1, 'a different tick regenerates different agents');
        A(s.agents.every(function (a) { return a.home === 0 && a.cls === 1 && Number.isFinite(a.tx) && Number.isFinite(a.ty) && a.tx > 0 && a.tx < W && a.ty > 0 && a.ty < H; }), 'homes, classes and positions valid');
        A(s.agents[0].name.indexOf(' ') > 0 && s.agents[0].year >= 1 && s.agents[0].year <= 4, 'name and year');
      }
      // 5. reconcile
      {
        const s = mkState(5); s.economy.students = 1000; M.reset(s, true);
        run(s, 1, true);
        const live = function () { return s.agents.filter(function (a) { return a.state !== 'GONE'; }).length; };
        A(live() === 80 && s.agents.length === 80, 'reconcile → 80 live at 1000 students');
        s.economy.students = 500; run(s, 1, true);
        A(live() === 60 && s.agents.length === 80, 'reconcile → 60 live, 80 kept (never spliced), got ' + live() + '/' + s.agents.length);
        s.economy.students = 1500; run(s, 1, true);
        A(live() === 100 && s.agents.length === 100, 'reconcile spawns the missing ones at home');
      }
      // 6. route cache invalidation
      {
        const s = mkState(6); M.reset(s, true);
        const from = BSU.idx(2, 2), to = BSU.idx(12, 2);
        A(M.routeSync(s, from, to, 'walk') !== null && M._debug.cacheHas(from, to, 'walk'), 'route cached');
        M.invalidateRoutes(s, BSU.idx(30, 30));
        A(M._debug.cacheHas(from, to, 'walk'), 'kept for a tile outside its bbox');
        M.invalidateRoutes(s, BSU.idx(6, 2));
        A(!M._debug.cacheHas(from, to, 'walk'), 'dropped for a tile inside its bbox');
      }
      // 7. sampling means
      {
        const s = mkState(7); s.economy.students = 120; M.reset(s, true);
        s.tiles.walk.fill(0);
        const t1 = BSU.idx(5, 40), t2 = BSU.idx(9, 40);
        s.tiles.walk[t1] = 2; s.tiles.walk[t2] = 2;
        life[t1] = 4; life[t2] = 8; s.tiles.mosq[t1] = 0.2; s.tiles.mosq[t2] = 0.4;
        s.agents.length = 2;
        const place = function (a, t) { a.tx = (t & 63) + 0.5; a.ty = (t >> 6) + 0.5; a.px = a.tx; a.py = a.ty; a.lastTile = t; a.inside = false; a.state = 'IDLE'; a.goal = 'idle'; a.target = -1; a.route = []; };
        place(s.agents[0], t1); place(s.agents[1], t2);
        s.tick = 30;   // Day phase
        run(s, 100, false);
        A(M.sample(s).n === 0, 'sample() is zeros before the first day roll');
        s.economy.students = 0;
        run(s, 1, true);
        const sm = M.sample(s);
        A(sm.n === 200 && Math.abs(sm.life - 6) < 1e-6 && Math.abs(sm.mosq - 0.3) < 1e-6 && sm.heat === 0, 'sample means life 6, mosq .3, heat 0, n 200; got ' + JSON.stringify(sm));
        A(s.agents.every(function (a) { return a.tx > 0 && a.tx < W && a.ty > 0 && a.ty < H && Number.isFinite(a.mood); }), 'agents in bounds, finite');
        life[t1] = 0; life[t2] = 0; s.tiles.mosq[t1] = 0; s.tiles.mosq[t2] = 0;
      }
      // 8. class attendance 7/10
      {
        const s = mkState(8); s.economy.students = 120; M.reset(s, true);
        s.agents.length = 10;
        for (let k = 0; k < 10; k++) { const a = s.agents[k]; a.cls = 1; a.home = 0; }
        // three agents stranded on an island
        for (let k = 7; k < 10; k++) { const t = BSU.idx(3 + k, 50); const a = s.agents[k]; a.tx = (t & 63) + 0.5; a.ty = (t >> 6) + 0.5; a.lastTile = t; for (let y = 48; y <= 52; y++) for (let x = 5; x <= 15; x++) s.tiles.walk[BSU.idx(x, y)] = 0; s.tiles.walk[t] = 2; }
        s.tick = 0;
        run(s, 180, false);   // Dawn → Day → Golden → Dusk (175)
        const ca = M.classAttendance(s);
        A(Math.abs(ca - 0.7) < 1e-9, 'classAttendance 7/10 = ' + ca + ' counters ' + JSON.stringify(M._debug.counters()));
      }
      // 9. flee
      {
        const s = mkState(9); s.economy.students = 120; M.reset(s, true);
        s.agents.length = 1;
        const a = s.agents[0];
        s.tick = 30; run(s, 1, false);
        gatorList = [{ id: 3, name: 'Professor Snaps', tx: Math.floor(a.tx) + 1, ty: Math.floor(a.ty), state: 'WANDER' }];
        rec.length = 0;
        run(s, 30, false);
        const flees = rec.filter(function (e) { return e.name === EV.AGENT_FLEE; });
        A(flees.length === 1 && flees[0].payload.id === 0 && flees[0].payload.gatorId === 3, 'agent:flee fired once, got ' + flees.length);
        A(M.inspect(s, 0).activity.indexOf('Snaps') > 0 || a.state !== 'FLEE', 'inspect names the gator while fleeing');
        gatorList = [];
        run(s, 40, false);
        A(a.state !== 'FLEE', 'flee ends after gatorFleeTicks');
      }
      // 10. desire line
      {
        const s = mkState(10); s.economy.students = 120; M.reset(s, true);
        s.agents.length = 1;
        const a = s.agents[0];
        const g = BSU.idx(10, 45), o = BSU.idx(11, 45);
        a.tx = 10.5; a.ty = 45.5; a.lastTile = g; a.inside = false;
        fixedPhase = SKY.DAY; s.tick = 30; run(s, 1, false);       // schedule once (Day, held)
        a.state = 'WALK'; a.goal = 'tile'; a.target = g; a.route = []; a.routeIdx = 0; a.next = null; a.waitTicks = 0;
        for (let k = 0; k < 40; k++) { a.route.push(o); a.route.push(g); }
        run(s, 360, false);
        A(s.tiles.wear[g] >= P.wearThreshold, 'wear reached ' + s.tiles.wear[g]);
        rec.length = 0;
        run(s, 1, true);
        const dl = rec.filter(function (e) { return e.name === EV.AGENT_DESIRE_LINE; });
        A(dl.length === 1 && dl[0].payload.tiles.indexOf(g) >= 0, 'one agent:desireLine with the tile');
        run(s, 1, true);
        A(rec.filter(function (e) { return e.name === EV.AGENT_DESIRE_LINE; }).length === 1, 'not re-reported the next day');
        fixedPhase = -1;
      }
      // 11. direction mapping
      A(M.dirOf(1, 0) === 0 && M.dirOf(0, 1) === 1 && M.dirOf(-1, 0) === 2 && M.dirOf(0, -1) === 3, 'direction mapping');
      // 12. founding arrival
      {
        const s = mkState(12); s.economy.students = 0; M.reset(s, true);
        A(s.agents.length === 0, 'no agents at 0 students (D15)');
        rec.length = 0;
        M.spawnArrival(s, 120, 'founding');
        A(s.agents.length === 44 && s.agents.every(function (a) { return a.arrival > 0 && a.state !== 'GONE'; }), 'founding creates 44 in-flight agents');
        A(s.vehicles.filter(function (v) { return v.kind === 'pirogue'; }).length === 3, '3 pirogues');
        run(s, 1, true);
        A(s.agents.length === 44 && s.agents.every(function (a) { return a.arrival > 0 && a.state !== 'GONE'; }), 'the daily reconcile ignores in-flight agents');
        run(s, 300, false);
        const arr = rec.filter(function (e) { return e.name === EV.AGENT_ARRIVE; });
        A(arr.length === 1 && arr[0].payload.count === 120 && arr[0].payload.kind === 'founding', 'one agent:arrive{120, founding}, got ' + arr.length);
        A(s.agents.some(function (a) { return !a.arrival; }), 'arrivals clear on reaching the goal');
        s.economy.students = 120; run(s, 1, true);
        A(s.agents.filter(function (a) { return a.state !== 'GONE'; }).length === 44, '44 live after the cohort is counted');
        A(s.agents.every(function (a) { return a.tx > 0 && a.tx < W && a.ty > 0 && a.ty < H; }), 'nobody left the map');
      }
      // 13. queue dedup and budget
      {
        const s = mkState(13); M.reset(s, true); s.tick = 1000;
        const a0 = BSU.idx(1, 1), b0 = BSU.idx(60, 60);
        for (let k = 0; k < 8; k++) A(M.route(s, a0, BSU.idx(40, 40 + k), 'walk') !== null, 'search ' + k + ' runs within the budget');
        for (let k = 0; k < 30; k++) A(M.route(s, a0, b0, 'walk') === null, 'the 9th key is queued');
        A(M._debug.queueSize() === 1, 'queue holds one entry for 30 identical requests, got ' + M._debug.queueSize());
        s.tick++; M.tick(s, flagsNone);
        A(M.route(s, a0, b0, 'walk') !== null && M._debug.queueSize() === 0, 'answered next tick from the cache');
      }
      // 14. shelter assignment
      {
        const s = mkState(14); s.economy.students = 120; M.reset(s, true);
        s.agents.length = 4;
        const put = function (k, x, y) { const a = s.agents[k]; a.tx = x + 0.5; a.ty = y + 0.5; a.inside = false; a.state = 'IDLE'; a.goal = 'idle'; a.target = -1; a.route = []; };
        put(0, 21, 24); put(1, 31, 24); put(2, 32, 25); put(3, 22, 25);
        M.shelter(s, { 0: 1, 1: 5 });
        A(s.agents[0].goal === 'shelter' && s.agents[0].target === 0, 'nearest agent takes building 0');
        A(s.agents[1].target === 1 && s.agents[2].target === 1, 'next two take building 1');
        A(s.agents[3].target === 1, 'the full building is never assigned again');
        s.tick = 30; run(s, 60, false);
        A(s.agents.filter(function (a) { return a.state === 'SHELTER'; }).length >= 3, 'agents reach their shelters');
        M.evacuate(s);
        A(s.agents.every(function (a) { return a.state === 'BUS' || a.state === 'GONE'; }), 'evacuate → BUS');
        run(s, 130, false);
        A(s.agents.every(function (a) { return a.state === 'GONE'; }), 'evacuated agents despawn within a day');
      }
      // robustness: bad inputs never throw
      M.tick(null, null); M.tick({}, null); M.shelter(null, null); M.evacuate(null); M.spawnArrival(null, 3, 'bus'); M.inspect(null, 0); M.nearest(null, 0, 0, 1); M.follow(null); M.sample(null); M.classAttendance(null);
      M.startFogger(null, 0); M.launchCajunNavy(null, []); M.gameDayBuses(null, true); M.crewSprites(null, 5, 3); M.invalidateRoutes(null, 5);
      for (let k = 0; k < rec.length; k++) A(BSU.events.known(rec[k].name), 'recorded event is registered: ' + rec[k].name);
      notes.push('A*/queue/cache, count, regenerate, reconcile, sampling, attendance, flee, desire line, arrival, shelter/evacuate ok');
      return { ok: true, notes: notes.join('; ') };
    } catch (e) {
      return { ok: false, notes: (e && e.message) || String(e) };
    } finally {
      X = savedCtx; M._deps = savedDeps; BSU.rng.sim.state = savedSim;
    }
  };
})();
