'use strict';
// ============================================================================
// BAYOU STATE — buildings.js (module 6) → BSU.buildings
// Owner of: state.buildings[] (null holes, never spliced), tiles.owner, tiles.crest,
// tiles.integrity (placement 100 / repairs), tiles.sandbag (+sandbagDay, the Sandbags
// action), state.runNames, the coverage maps, the auras, the protection/gap cache.
// Writes tiles.surface / tiles.elev only through terrain.setSurface/setElev and the
// canal / pond / levee hydro flags only through hydro.markCanal/markPond/markLeveeChange.
// Implements: ARCHITECTURE.md §5.6 (API), §5.1 step 4, §2.11 (Building), §7.5 ghost
// semantics, §9.4/§9.5 placement; GDD §0.3 (placement text of every row), §3.6, §4.11,
// §5.3, §6.1.6, §6.2 (prep, wind, rings/protection/gaps), §6.5, §11.2, §11.3, §14.2.
// Zero DOM / timer / audio access at definition time. Every emit goes through
// M._deps.emit; every other module is reached through M._deps.<name>() so selfTest can
// stub them (§10.6). No state lives on the module object (D46): everything per game is
// in state.* or in the closure cache keyed on the root object (self-healing, §1/D38).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.buildings = BSU.buildings || {});
  const P = BSU.params;
  const T = BSU.T, SURF = BSU.SURF, FLAG = BSU.FLAG, PLACE = BSU.PLACE, EV = BSU.EV;
  const W = BSU.MAP.W, H = BSU.MAP.H, N = BSU.MAP.N;
  const PB = P.build, PE = P.econ, PS = P.storm, PSUB = P.subsidence, PH = P.hydro;

  // Local constants for numbers the GDD states but BSU.params does not carry
  // (listed in docs/INTEGRATION_NOTES.md '## buildings.js').
  const LOCAL = {
    substationSummerDraw: PE.utilities.summerMult,      // "summer draw ×1.5" (GDD §0.3 row 4) — reuses utilities.summerMult 1.5
    summerMonths: PE.utilities.summerMonths,            // [6, 9]
    quadStackCap: 6,                                    // Quad Lawn stacks to +6 (GDD §0.3 row 23)
    quadValue: 2,
    azaleaBloomBonus: 1,                                // +1 more in bloom (row 38)
    pondStockDays: PH.pond.stockDays,                   // 10
    floodedCoreDays: PE.prestige.blight.floodedDays,    // 3
    oakStageForEffect: 1,
    landmarkShelterDeclaredPhaseMax: BSU.STORM.LANDFALL, // "from the cone to T+1"
    coreRows: null                                      // computed lazily from data
  };

  // ---------------------------------------------------------------------------
  // Injectable dependencies (§10.6 / D49). selfTest swaps these for stubs.
  // ---------------------------------------------------------------------------
  M._deps = {
    emit: function (name, payload) { BSU.events.emit(name, payload); },
    data: function () { return BSU.data; },
    terrain: function () { return BSU.terrain; },
    hydro: function () { return BSU.hydro; },
    economy: function () { return BSU.economy; },
    progress: function () { return BSU.progress; },
    weather: function () { return BSU.weather; },
    wildlife: function () { return BSU.wildlife; }
  };
  const dep = M._deps;
  function emit(name, payload) { try { dep.emit(name, payload); } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'emit:' + name, e); } }
  /** call fn on module `which` if it exists and has `fn`; else return `fallback` */
  function call(which, fn, args, fallback) {
    const mod = dep[which] ? dep[which]() : null;
    if (mod && typeof mod[fn] === 'function') return mod[fn].apply(mod, args);
    return (typeof fallback === 'function') ? fallback() : fallback;
  }
  function catalog() { const d = dep.data(); return d && d.catalog ? d.catalog : {}; }
  function names() { const d = dep.data(); return d && d.names ? d.names : {}; }
  function rowOf(id) { return (typeof id === 'string') ? (catalog()[id] || null) : null; }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  const fin = function (v, d) { return isNum(v) ? v : (d || 0); };
  const cheb = BSU.chebyshev;
  function dayOf(state) { return (state && state.calendar) ? fin(state.calendar.day, 0) : 0; }
  function dims(row, rot) { const r = rot === 1 && row.rotatable; return { w: r ? row.h : row.w, h: r ? row.w : row.h }; }
  function hasWaterFlag(state, i) { return (state.tiles.flags[i] & (FLAG.BAYOU | FLAG.OPEN_WATER)) !== 0; }
  /** land = not Open Water / Bayou / Pond (by flag or by derived type) */
  function isLand(state, i) {
    const f = state.tiles.flags[i];
    if (f & (FLAG.BAYOU | FLAG.OPEN_WATER | FLAG.POND_SINK)) return false;
    const t = state.tiles.type[i];
    return t !== T.OPEN_WATER && t !== T.BAYOU && t !== T.POND;
  }
  function isMarsh(state, i) { return state.tiles.type[i] === T.MARSH && !(state.tiles.flags[i] & FLAG.DRAINED); }
  function isMound(state, i) { return (state.tiles.flags[i] & FLAG.MOUND) !== 0; }
  function isPreserve(state, i) { return (state.tiles.flags[i] & FLAG.PRESERVE) !== 0; }
  function isCanal(state, i) { return (state.tiles.flags[i] & FLAG.CANAL) !== 0; }
  function semesterOf(state) { return BSU.dayParts(dayOf(state)).semester; }
  function monthOf(state) { return BSU.dayParts(dayOf(state)).month; }
  function isSummerDraw(state) { const m = monthOf(state); return m >= LOCAL.summerMonths[0] && m <= LOCAL.summerMonths[1]; }
  /** Chebyshev distance between the nearest tiles of two footprints (rect vs rect) */
  function rectDist(ax, ay, aw, ah, bx, by, bw, bh) {
    const dx = Math.max(0, bx - (ax + aw - 1), ax - (bx + bw - 1));
    const dy = Math.max(0, by - (ay + ah - 1), ay - (by + bh - 1));
    return Math.max(dx, dy);
  }
  /** Chebyshev distance from a tile to the nearest tile of a footprint */
  function tileDist(tx, ty, b) { return rectDist(tx, ty, 1, 1, b.tx, b.ty, b.w, b.h); }
  function footprintOf(b) { return BSU.footprintTiles(b.tx, b.ty, b.w, b.h) || []; }
  function isComplete(b) { return !!b && b.built >= 1 && !b.ruin; }
  function isClosed(b, day) { return b.closedUntil >= 0 && b.closedUntil >= day; }
  function wrOf(row, b) { return (b && b.tier > 0 && row.tiers[b.tier - 1]) ? row.tiers[b.tier - 1].wr : row.wr; }
  function tierRow(row, b) { return (b && b.tier > 0 && row.tiers[b.tier - 1]) ? row.tiers[b.tier - 1] : null; }
  function coreRows() {
    if (!LOCAL.coreRows) { const c = {}; const cat = catalog(); for (const id of Object.keys(cat)) if (cat[id].needsPower || id === 'founders_hall') c[id] = true; LOCAL.coreRows = c; }
    return LOCAL.coreRows;
  }
  function isCoreRow(id) { return !!coreRows()[id]; }
  function isHousingRow(row) { return row.effects.beds > 0; }

  // ---------------------------------------------------------------------------
  // The per-game closure cache (rebuilt whenever the root object changes: §1 / D38)
  // ---------------------------------------------------------------------------
  let C = null;
  function newCache(state) {
    return {
      root: state,
      coverageDirty: true, aurasDirty: true, ringDirty: true, ringEmitPending: true, connectedDirty: true,
      ringCache: new Map(), gapCache: new Map(), runCache: null,
      connected: new Uint8Array(N), founderRing: new Uint8Array(N),
      auras: {
        life: new Float32Array(N), green: new Float32Array(N), dining: new Uint8Array(N), shade: new Float32Array(N),
        heat: new Float32Array(N), mosq: new Float32Array(N), noise: new Float32Array(N)
      },
      undo: null,
      pendingPulses: [],
      pendingRolls: false, rollsApplied: false, toppled: [],
      boilWindow: false, boilWaterFlag: false,
      gatorClosedTick: -1, gatorClosedIds: new Set(),
      statsCache: null, statsDay: -1, statsTick: -1,
      providerActive: new Map(),     // provider id → true while it served last recompute
      genPowered: new Map(),         // consumer id → generator id
      powerCover: new Uint8Array(N), waterCover: new Uint8Array(N),
      generatorsRunning: 0, brownout: false, uncovered: 0,
      scratchHead: new Float32Array(N), scratchQueue: new Int32Array(N), scratchVisited: new Uint8Array(N)
    };
  }
  /** self-healing accessor: the cache always belongs to the root it was built for */
  function cache(state) {
    if (!C || C.root !== state) C = newCache(state);
    return C;
  }
  function dirtyAll(c) { c.coverageDirty = true; c.aurasDirty = true; c.ringDirty = true; c.ringEmitPending = true; c.ringCache.clear(); c.gapCache.clear(); c.runCache = null; c.statsCache = null; c.connectedDirty = true; }

  // ---------------------------------------------------------------------------
  // Terrain / hydro / economy write-throughs (guarded: the module must work with a
  // partial world during unit tests and never throw across the boundary)
  // ---------------------------------------------------------------------------
  function touch(state, i, what) {
    call('terrain', 'touch', [state, i, what], null);
    const c = cache(state);
    if (what === 'surface') c.connectedDirty = true;
    if (what === 'crest' || what === 'flags' || what === 'elev') { c.ringDirty = true; c.ringEmitPending = true; c.ringCache.clear(); c.gapCache.clear(); c.runCache = null; }
  }
  function setSurface(state, i, v) {
    const tr = dep.terrain();
    if (tr && typeof tr.setSurface === 'function') tr.setSurface(state, i, v);
    else { state.tiles.surface[i] = v; }
    cache(state).connectedDirty = true;
    if (!(tr && typeof tr.setSurface === 'function')) touch(state, i, 'surface');
  }
  function setElev(state, i, v) {
    v = Math.round(fin(v, 0) * 100) / 100;
    const tr = dep.terrain();
    if (tr && typeof tr.setElev === 'function') tr.setElev(state, i, v);
    else { state.tiles.elev[i] = v; touch(state, i, 'elev'); }
  }
  function setFlag(state, i, bit, on) {
    const tr = dep.terrain();
    if (tr && typeof tr.setFlag === 'function') tr.setFlag(state, i, bit, on);
    else { if (on) state.tiles.flags[i] |= bit; else state.tiles.flags[i] &= ~bit; }
    touch(state, i, 'flags');
  }
  function rewalk(state, i) { call('terrain', 'rewalk', [state, i], null); }
  function markCanal(state, i, on) {
    const hy = dep.hydro();
    if (hy && typeof hy.markCanal === 'function') hy.markCanal(state, i, on);
    else { if (on) state.tiles.flags[i] |= FLAG.CANAL; else state.tiles.flags[i] &= ~(FLAG.CANAL | FLAG.FLOODGATE); if (on && state.tiles.crest[i] > 0) state.tiles.flags[i] |= FLAG.FLOODGATE; }
    touch(state, i, 'flags');
  }
  function markLeveeChange(state, i) {
    const hy = dep.hydro();
    if (hy && typeof hy.markLeveeChange === 'function') hy.markLeveeChange(state, i);
    else { if (state.tiles.crest[i] > 0 && (state.tiles.flags[i] & FLAG.CANAL)) state.tiles.flags[i] |= FLAG.FLOODGATE; else state.tiles.flags[i] &= ~FLAG.FLOODGATE; }
    touch(state, i, 'crest');
  }
  function markPond(state, tiles, id, on) {
    const hy = dep.hydro();
    if (hy && typeof hy.markPond === 'function') hy.markPond(state, tiles, id, on);
    else for (const i of tiles) { if (on) state.tiles.flags[i] |= FLAG.POND_SINK; else state.tiles.flags[i] &= ~FLAG.POND_SINK; }
    for (const i of tiles) touch(state, i, 'flags');
  }
  function canAfford(state, cost) {
    return call('economy', 'canAfford', [state, cost], function () { return fin(state.economy.cash, 0) - cost >= -fin(state.economy.loanLimit, PE.loanLimit); });
  }
  function charge(state, cost, key, meta) {
    if (!(cost > 0)) return true;
    const ec = dep.economy();
    if (ec && typeof ec.charge === 'function') return !!ec.charge(state, cost, key, meta);
    if (!canAfford(state, cost)) return false;
    state.economy.cash -= cost; return true;
  }
  function refund(state, amount, meta) {
    if (!(amount > 0)) return;
    const ec = dep.economy();
    if (ec && typeof ec.refund === 'function') ec.refund(state, amount, meta);
    else state.economy.cash += amount;
  }
  function timer(state, id) { return call('progress', 'timer', [state, id], null); }

  // ---------------------------------------------------------------------------
  // Queries (pure over state; self-healing through cache(state))
  // ---------------------------------------------------------------------------
  /** the Building struct or null */
  M.get = function (state, id) {
    if (!state || !Array.isArray(state.buildings) || !Number.isInteger(id)) return null;
    return state.buildings[id] || null;
  };
  /** non-null entries, optionally filtered by catalog id */
  M.list = function (state, type) {
    const out = [];
    if (!state || !Array.isArray(state.buildings)) return out;
    for (const b of state.buildings) if (b && (!type || b.type === type)) out.push(b);
    return out;
  };
  /** the building whose footprint covers (tx, ty), or null */
  M.at = function (state, tx, ty) {
    if (!state || !BSU.inBounds(tx, ty)) return null;
    const id = state.tiles.owner[BSU.idx(tx, ty)];
    return id >= 0 ? (state.buildings[id] || null) : null;
  };
  M.count = function (state, type) { let n = 0; for (const b of M.list(state)) if (!type || b.type === type) n++; return n; };
  /** a COMPLETE building of that type (and at least minTier) exists */
  M.has = function (state, type, minTier) {
    const mt = minTier || 0;
    for (const b of M.list(state, type)) if (isComplete(b) && b.tier >= mt) return true;
    return false;
  };
  M.footprint = function (state, id) { const b = M.get(state, id); return b ? footprintOf(b) : []; };
  /**
   * Design pass — soft spacing. When a footprint at (tx, ty) would share an edge with another footprint
   * building, the nearest legal spot within one tile that leaves a 1-tile gap (pushed away from the
   * neighbour first). Never refuses anything: {tx, ty, snapped, touching}. ui's ghost uses it unless
   * Shift is held (flush placement); canPlace itself is unchanged.
   */
  M.setbackSpot = function (state, id, tx, ty, opts) {
    const out = { tx: tx | 0, ty: ty | 0, snapped: false, touching: false };
    try {
      const row = rowOf(id); if (!state || !state.tiles || !row || row.kind !== 'footprint') return out;
      opts = opts || {};
      const d = dims(row, opts.rot), owner = state.tiles.owner;
      const self = Number.isFinite(opts.target) ? opts.target : -1;
      const contact = function (x, y) {   // the push direction away from touching footprint buildings, or null when free
        if (!BSU.footprintTiles(x, y, d.w, d.h)) return null;
        let px = 0, py = 0, n = 0;
        for (let k = 0; k < d.w; k++) {
          const a = BSU.inBounds(x + k, y - 1) ? owner[(y - 1) * W + x + k] : -1; if (a >= 0 && a !== self) { py += 1; n++; }
          const b = BSU.inBounds(x + k, y + d.h) ? owner[(y + d.h) * W + x + k] : -1; if (b >= 0 && b !== self) { py -= 1; n++; }
        }
        for (let k = 0; k < d.h; k++) {
          const a = BSU.inBounds(x - 1, y + k) ? owner[(y + k) * W + x - 1] : -1; if (a >= 0 && a !== self) { px += 1; n++; }
          const b = BSU.inBounds(x + d.w, y + k) ? owner[(y + k) * W + x + d.w] : -1; if (b >= 0 && b !== self) { px -= 1; n++; }
        }
        return n ? { px: px, py: py } : null;
      };
      const c0 = contact(out.tx, out.ty); if (!c0) return out;
      out.touching = true;
      const sx = Math.sign(c0.px), sy = Math.sign(c0.py);
      const cands = [];
      if (sx) cands.push([sx, 0]); if (sy) cands.push([0, sy]); if (sx && sy) cands.push([sx, sy]);
      for (const c of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (!cands.some(function (q) { return q[0] === c[0] && q[1] === c[1]; })) cands.push(c);
      for (const c of cands) {
        const x = out.tx + c[0], y = out.ty + c[1];
        if (!BSU.footprintTiles(x, y, d.w, d.h) || contact(x, y) !== null) continue;
        const r = M.canPlace(state, id, x, y, opts);
        if (r && r.ok) { out.tx = x; out.ty = y; out.snapped = true; return out; }
      }
      return out;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'setbackSpot', e); return out; }
  };
  M.dumpsterTile = function (state, id) { const b = M.get(state, id); return b && b.data ? fin(b.data.dumpsterTile, -1) : -1; };
  /** {ok, reason}: progress owns the phrasing (D52) */
  M.unlocked = function (state, id) {
    try {
      if (!rowOf(id)) return { ok: false, reason: 'Unknown building' };
      const ok = call('progress', 'unlocked', [state, id], true) !== false;
      return { ok: ok, reason: ok ? '' : String(call('progress', 'unlockReason', [state, id], '') || 'Locked') };
    } catch (e) { BSU.error('buildings', 'unlocked', e); return { ok: false, reason: 'Locked' }; }
  };
  /** summer (May 6–Aug 4) −15% (GDD §5.3) */
  M.constructionMult = function (state) { return semesterOf(state) === 'summer' ? 1 + PE.terrainCost.summer : 1; };

  // ---------------------------------------------------------------------------
  // Access network: `connected` = surface 1–3 tiles 4-connected to the Highway 1 stub
  // or to any tile 4-adjacent to Founders' Hall (GDD §3.6 Access)
  // ---------------------------------------------------------------------------
  function isAccessSurface(s) { return s === SURF.PATH || s === SURF.ROAD || s === SURF.BOARDWALK || s === SURF.BRIDGE; }
  function rebuildConnected(state) {
    const c = cache(state), conn = c.connected, surf = state.tiles.surface, q = c.scratchQueue;
    conn.fill(0); c.founderRing.fill(0);
    let head = 0, tail = 0;
    const seed = function (i) { if (i >= 0 && i < N && isAccessSurface(surf[i]) && !conn[i]) { conn[i] = 1; q[tail++] = i; } };
    const plot = state.plot || {};
    for (const i of (plot.highway || [])) seed(i);
    let fx = plot.founders ? plot.founders.tx : -1, fy = plot.founders ? plot.founders.ty : -1, fw = 3, fh = 3;
    for (const b of M.list(state, 'founders_hall')) { fx = b.tx; fy = b.ty; fw = b.w; fh = b.h; }
    if (fx >= 0) for (const i of BSU.edgeTiles(fx, fy, fw, fh)) { c.founderRing[i] = 1; seed(i); }
    while (head < tail) {
      const i = q[head++], tx = i & 63, ty = i >> 6;
      if (ty > 0) seed(i - W);
      if (tx < W - 1) seed(i + 1);
      if (ty < H - 1) seed(i + W);
      if (tx > 0) seed(i - 1);
    }
    c.connectedDirty = false;
  }
  function connectedMask(state) { const c = cache(state); if (c.connectedDirty) rebuildConnected(state); return c.connected; }

  // ---------------------------------------------------------------------------
  // Auto-names (GDD §14.2, §4.11): pool cursors live in state.runNames['pool:<pool>']
  // ---------------------------------------------------------------------------
  const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
  function roman(n) { return n < ROMAN.length ? ROMAN[n] : (' ' + (n + 1)); }
  function nextFromPool(state, pool, list) {
    if (!Array.isArray(list) || !list.length) return null;
    const key = 'pool:' + pool;
    const k = fin(parseInt(state.runNames[key], 10), 0);
    state.runNames[key] = String(k + 1);
    return list[k % list.length] + roman(Math.floor(k / list.length));
  }
  function autoName(state, row) {
    const nm = names();
    if (row.id === 'founders_hall') return "Founders' Hall";
    if (row.id === 'stadium') return (nm.stadium && nm.stadium[1]) || row.name;
    if (row.id === 'res_tower') {
      const key = 'pool:towers';
      const k = fin(parseInt(state.runNames[key], 10), 0);
      state.runNames[key] = String(k + 1);
      const towers = nm.towers || [], halls = nm.halls || [];
      if (k < towers.length) return towers[k];
      const j = k - towers.length;
      if (halls.length) return halls[j % halls.length].replace(/ Hall$/, '') + ' Tower' + roman(Math.floor(j / halls.length));
      return row.name + ' ' + (k + 1);
    }
    if (row.namePool && Array.isArray(nm[row.namePool])) { const n = nextFromPool(state, row.namePool, nm[row.namePool]); if (n) return n; }
    return row.name + ' ' + (M.count(state, row.id) + 1);
  }
  /** player rename → building:renamed */
  M.rename = function (state, id, name) {
    try {
      const b = M.get(state, id); if (!b) return;
      const s = String(name == null ? '' : name).trim().slice(0, 40);
      if (!s) return;
      b.name = s; emit(EV.BUILDING_RENAMED, { id: id, name: s });
    } catch (e) { BSU.error('buildings', 'rename', e); }
  };

  // ---------------------------------------------------------------------------
  // canPlace — the ghost description (ARCHITECTURE §5.6 order; GDD §3.6, §0.3, §11.2)
  // ---------------------------------------------------------------------------
  function blankResult() {
    return {
      ok: false, color: 'red', reason: '', cost: 0, baseCost: 0, tiles: [],
      needsGrading: false, gradingCost: 0, needsPilings: false, pilingsCost: 0, terrainMod: 0, summer: false,
      access: true, roadOk: true, power: false, water: false, radius: 0, ridgeFull: null, sink: null, ring: null, affordable: true,
      connector: null   // connector pass: {tiles, cost} of the gravel tie this placement would lay (null when the footprint already touches the network)
    };
  }
  // ---------------------------------------------------------------------------
  // Connector pass (GDD §3.6 access): a path-adjacency building that sits up to params.build.connectorMax
  // tiles from the access network lays its own gravel tie — the shortest 4-connected run from a tile beside
  // its edge to the nearest CONNECTED path/road/boardwalk (or onto a Founders' ring tile, the network root),
  // through tiles where the path drag tool could go (dragTileRule PATH), skipping the Founders' reservation.
  // The SE face (east neighbours, the default door of the design pass) is tried first, then the SW face.
  // ---------------------------------------------------------------------------
  function connectorMax() { return Math.max(0, Math.floor(fin(PB.connectorMax, 4))); }
  function connectorInner(state, row, tx, ty, rot) {
    const pathRow = rowOf('path');
    if (!pathRow || !row || row.kind !== 'footprint' || row.id === 'founders_hall') return null;
    const max = connectorMax(); if (max <= 0) return null;
    const d = dims(row, rot), foot = BSU.footprintTiles(tx, ty, d.w, d.h);
    if (!foot) return null;
    const conn = connectedMask(state), ring = cache(state).founderRing, surf = state.tiles.surface;
    const edges = BSU.edgeTiles(tx, ty, d.w, d.h);
    for (const e of edges) if ((isAccessSurface(surf[e]) && conn[e]) || ring[e]) return null;   // already touching: never lay a tie
    const res = reservedTiles(state), scratch = {};
    const legal = function (i) {
      if (foot.indexOf(i) >= 0 || (res && res.indexOf(i) >= 0) || isMound(state, i)) return false;
      return dragTileRule(state, pathRow, i, {}, scratch) === '';
    };
    const goal = function (i) {
      if (ring[i]) return true;
      for (const n of BSU.nbr4(i)) if (conn[n] && foot.indexOf(n) < 0) return true;
      return false;
    };
    const side = function (i) { const x = i & 63, y = i >> 6; return x >= tx + d.w ? 0 : (y >= ty + d.h ? 1 : 2); };
    const starts = edges.filter(legal).sort(function (a, b) { return side(a) - side(b); });
    const parent = new Map(), depth = new Map(), q = [];
    for (const e of starts) { parent.set(e, -1); depth.set(e, 1); q.push(e); }
    let found = -1;
    for (let head = 0; head < q.length && found < 0; head++) {
      const t = q[head];
      if (goal(t)) { found = t; break; }
      const dd = depth.get(t); if (dd >= max) continue;
      for (const n of BSU.nbr4(t)) { if (parent.has(n) || !legal(n)) continue; parent.set(n, t); depth.set(n, dd + 1); q.push(n); }
    }
    if (found < 0) return null;
    const tiles = []; for (let c = found; c !== -1; c = parent.get(c)) tiles.push(c); tiles.reverse();
    const per = M.canPlace(state, 'path', tiles[0] & 63, tiles[0] >> 6, { ignoreCash: true });   // the drag tool's own per-tile price (summer discount included) and its unlock gate
    if (!per || !per.ok) return null;
    return { tiles: tiles, cost: fin(per.cost, pathRow.cost) * tiles.length };
  }
  /** the gravel tie a footprint placement at (tx, ty) would lay to reach the access network: {tiles, cost} or null (already touching, or none within params.build.connectorMax) */
  M.connectorFor = function (state, rowId, tx, ty, rot) {
    try {
      const row = rowOf(rowId); if (!state || !state.tiles || !row) return null;
      return connectorInner(state, row, Math.floor(fin(tx, -1)), Math.floor(fin(ty, -1)), rot);
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'connectorFor', e); return null; }
  };
  function fail(r, reason) { r.ok = false; r.color = 'red'; r.reason = reason; return r; }
  /** true when the run (opts.tiles) contains a legal ≤3-tile water span through tile i (road bridges) */
  function bridgeSpanOk(state, i, run) {
    const surf = state.tiles.surface;
    if (Array.isArray(run) && run.length) {
      const k = run.indexOf(i);
      if (k < 0) return { ok: false, reason: 'Bridges start from land' };
      let a = k, b = k;
      while (a - 1 >= 0 && hasWaterFlag(state, run[a - 1])) a--;
      while (b + 1 < run.length && hasWaterFlag(state, run[b + 1])) b++;
      if (b - a + 1 > PB.bridgeMaxSpan) return { ok: false, reason: 'Bridges span 3 tiles at most' };
      const before = a - 1 >= 0 ? run[a - 1] : -1, after = b + 1 < run.length ? run[b + 1] : -1;
      const landBefore = before >= 0 && isLand(state, before), landAfter = after >= 0 && isLand(state, after);
      // an end may also be an existing bridge tile continuing off the run, or an existing road on land
      if (!landBefore && !landAfter) return { ok: false, reason: 'Bridges start from land' };
      if (!(landBefore && landAfter)) {
        // one end open: allowed only if the open end touches land or an existing road tile
        const openEnd = landBefore ? run[b] : run[a];
        let touches = false;
        for (const n of BSU.nbr4(openEnd)) if (run.indexOf(n) < 0 && (isLand(state, n) || surf[n] === SURF.ROAD)) touches = true;
        if (!touches) return { ok: false, reason: 'Bridges start from land' };
      }
      return { ok: true };
    }
    // single-tile place: extend an existing bridge or start from land, span ≤ 3 along either axis
    let touches = false;
    for (const n of BSU.nbr4(i)) if (isLand(state, n) || (hasWaterFlag(state, n) && surf[n] === SURF.ROAD)) touches = true;
    if (!touches) return { ok: false, reason: 'Bridges start from land' };
    const tx = i & 63, ty = i >> 6;
    let spanX = 1, spanY = 1;
    for (let x = tx - 1; x >= 0 && hasWaterFlag(state, BSU.idx(x, ty)) && surf[BSU.idx(x, ty)] === SURF.ROAD; x--) spanX++;
    for (let x = tx + 1; x < W && hasWaterFlag(state, BSU.idx(x, ty)) && surf[BSU.idx(x, ty)] === SURF.ROAD; x++) spanX++;
    for (let y = ty - 1; y >= 0 && hasWaterFlag(state, BSU.idx(tx, y)) && surf[BSU.idx(tx, y)] === SURF.ROAD; y--) spanY++;
    for (let y = ty + 1; y < H && hasWaterFlag(state, BSU.idx(tx, y)) && surf[BSU.idx(tx, y)] === SURF.ROAD; y++) spanY++;
    if (Math.max(spanX, spanY) > PB.bridgeMaxSpan) return { ok: false, reason: 'Bridges span 3 tiles at most' };
    return { ok: true };
  }
  /** bridge pass — the Pedestrian Bridge: every water segment of the run must reach land at both ends (a land tile in the run,
   *  or an existing bridge / access surface just off the run); a single click extends an existing bridge or starts from land */
  function pedBridgeOk(state, i, run) {
    const surf = state.tiles.surface;
    const anchored = function (j) { return j >= 0 && j < N && (isLand(state, j) || surf[j] === SURF.BRIDGE); };
    if (Array.isArray(run) && run.length) {
      const k = run.indexOf(i);
      if (k < 0) return { ok: false, reason: 'Both ends must reach land' };
      let a = k, b = k;
      while (a - 1 >= 0 && !isLand(state, run[a - 1])) a--;
      while (b + 1 < run.length && !isLand(state, run[b + 1])) b++;
      const ends = [[a - 1 >= 0 ? run[a - 1] : -1, run[a]], [b + 1 < run.length ? run[b + 1] : -1, run[b]]];
      for (const e of ends) {
        if (e[0] >= 0 && isLand(state, e[0])) continue;
        let touches = false;
        for (const n of BSU.nbr4(e[1])) if (run.indexOf(n) < 0 && anchored(n)) touches = true;
        if (!touches) return { ok: false, reason: 'Both ends must reach land' };
      }
      return { ok: true };
    }
    for (const n of BSU.nbr4(i)) if (anchored(n)) return { ok: true };
    return { ok: false, reason: 'Both ends must reach land' };
  }
  /** the per-tile terrain rule of a drag / paint row; returns '' or the reason; sets r.bridge for roads on water */
  function dragTileRule(state, row, i, opts, r) {
    const surf = state.tiles.surface[i], owner = state.tiles.owner[i];
    const water = !isLand(state, i);
    if (isMound(state, i)) return 'The Mounds';
    switch (row.placeRule) {
      case PLACE.PATH:
        if (water) return 'Not on water';
        if (isPreserve(state, i)) return 'Preserve';
        if (owner >= 0) return 'Occupied';
        if (surf === SURF.PATH) return 'Already a path';
        if (surf === SURF.FENCE) return 'Fence in the way';
        if (surf === SURF.ROAD || surf === SURF.BOARDWALK || surf === SURF.BRIDGE) return 'Occupied';
        return '';
      case PLACE.ROAD:
        if (isPreserve(state, i)) return 'Preserve';
        if (owner >= 0) return 'Occupied';
        if (surf === SURF.ROAD) return 'Already a road';
        if (surf === SURF.FENCE) return 'Fence in the way';
        if (surf === SURF.BOARDWALK || surf === SURF.BRIDGE) return 'Occupied';
        if (water) { const b = bridgeSpanOk(state, i, opts.tiles); if (!b.ok) return b.reason; r.bridge = true; return ''; }
        if (isMarsh(state, i)) return 'Use a Boardwalk or a bridge';
        return '';
      case PLACE.BOARDWALK:
        if (owner >= 0) return 'Occupied';
        if (surf === SURF.BOARDWALK) return 'Already a boardwalk';
        if (surf === SURF.FENCE) return 'Fence in the way';
        if (surf === SURF.PATH || surf === SURF.ROAD || surf === SURF.BRIDGE) return 'Occupied';
        return '';
      case PLACE.BRIDGE:   // bridge pass: water only; a land tile inside a drag run is the landing (placed as nothing, see placeRun)
        if (!water) { if (Array.isArray(opts.tiles) && opts.tiles.length > 1 && opts.tiles.indexOf(i) >= 0) { r.landing = true; return ''; } return 'Bridges go over water'; }
        if (owner >= 0) return 'Occupied';
        if (surf === SURF.BRIDGE) return 'Already a bridge';
        if (surf !== SURF.NONE) return 'Occupied';
        { const b = pedBridgeOk(state, i, opts.tiles); if (!b.ok) return b.reason; }
        return '';
      case PLACE.LEVEE:
        if (water) return 'Not on water';
        if (isPreserve(state, i)) return 'Preserve';
        if (owner >= 0) return 'Occupied';
        if (state.tiles.crest[i] > 0) return state.tiles.crest[i] === row.effects.crest ? 'Already a levee' : 'Occupied';
        return '';
      case PLACE.CANAL:
        if (water) return 'Not on water';
        if (isPreserve(state, i)) return 'Preserve';
        if (owner >= 0) return 'Occupied';
        if (isCanal(state, i)) return 'Already a canal';
        return '';
      case PLACE.FENCE:
        if (water) return 'Not on water';
        if (owner >= 0) return 'Occupied';
        if (surf === SURF.FENCE) return 'Already a fence';
        if (isAccessSurface(surf)) return 'Not on a path';
        return '';
      case PLACE.PRESERVE:
        if (!isMarsh(state, i)) return 'Marsh only';
        if (owner >= 0) return 'Occupied';
        if (surf === SURF.PATH || surf === SURF.ROAD) return 'Occupied';
        if (isPreserve(state, i)) return 'Already preserved';
        return '';
      default:
        return '';
    }
  }
  /** footprint rows: the placeRule test over the whole footprint; '' or the reason */
  function footprintRule(state, row, tiles, tx, ty, w, h) {
    const rule = row.placeRule;
    const marshOk = rule !== PLACE.ROAD;
    for (const i of tiles) {
      if (rule === PLACE.MARSH_OR_PRESERVE) { if (!isMarsh(state, i)) return 'Marsh or Preserve only'; continue; }
      if (rule === PLACE.CYPRESS) {
        const t = state.tiles.type[i];
        if (isPreserve(state, i)) return 'Preserve';
        if (t === T.WET || t === T.MARSH || t === T.DRAINED) continue;
        if (!isLand(state, i)) return 'Not on water';
        let wetFeet = false;
        for (const n of BSU.nbr4(i)) if (hasWaterFlag(state, n) || isCanal(state, n)) wetFeet = true;
        if (!wetFeet) return 'Cypress wants wet feet';
        continue;
      }
      if (!isLand(state, i)) return 'Not on water';
      if (!marshOk && isMarsh(state, i)) return 'Use a Boardwalk or a bridge';
    }
    if (rule === PLACE.NEAR_WATER) {
      let near = false;
      const R = PB.nearWater;
      for (let y = ty - R; y <= ty + h - 1 + R && !near; y++) for (let x = tx - R; x <= tx + w - 1 + R; x++) {
        if (!BSU.inBounds(x, y)) continue;
        const j = BSU.idx(x, y);
        if (hasWaterFlag(state, j) || isCanal(state, j)) { near = true; break; }
      }
      if (!near) return 'Needs water within 3';
    }
    if (rule === PLACE.TOUCH_MARSH_BAYOU) {
      let ok = false;
      for (const e of BSU.edgeTiles(tx, ty, w, h)) if (state.tiles.type[e] === T.MARSH || (state.tiles.flags[e] & FLAG.BAYOU) || state.tiles.type[e] === T.BAYOU) ok = true;
      if (!ok) return 'Must touch Marsh or Bayou';
    }
    if (rule === PLACE.TOUCH_CANAL_WATER) {
      let ok = false;
      for (const e of BSU.edgeTiles(tx, ty, w, h)) if (isCanal(state, e) || hasWaterFlag(state, e)) ok = true;
      if (!ok) return 'Must touch a Canal or Water';
    }
    return '';
  }
  /** the Founders' reserved 3×3 (only while no Founders' Hall exists) */
  function reservedTiles(state) {
    if (M.count(state, 'founders_hall') > 0 || !state.plot || !state.plot.founders) return null;
    return BSU.footprintTiles(state.plot.founders.tx, state.plot.founders.ty, 3, 3);
  }
  function largestRadius(row) {
    const e = row.effects;
    return Math.max(e.power.radius, e.water.radius, e.diningRadius, e.happiness.radius, e.mosquito.radius, e.heat.radius, e.illness.radius, 0);
  }
  /** §3.6 "Sinks {rate} ft/yr · below the flood line in Year {n} · Pilings then ≈ ${retrofit}" */
  function sinkLine(state, row, tiles) {
    let low = -1, lowE = Infinity;
    for (const i of tiles) if (state.tiles.elev[i] < lowE) { lowE = state.tiles.elev[i]; low = i; }
    if (low < 0) return null;
    const t = state.tiles.type[low];
    if (t !== T.WET && t !== T.DRAINED) return null;
    let rate = t === T.DRAINED ? PSUB.drainedBuilt : PSUB.wetBuilt;
    const tx = low & 63, ty = low >> 6;
    for (const p of M.list(state, 'pump')) if (tileDist(tx, ty, p) <= PSUB.pumpRadius) { rate += PSUB.pumpAdd; break; }
    const risk = fin(call('hydro', 'riskAt', [state, low], 0), 0);
    const yearNow = BSU.dayParts(dayOf(state)).year;
    let year = -1;
    for (let n = yearNow + 1; n <= yearNow + 50; n++) if (lowE - rate * (n - yearNow) < risk) { year = n; break; }
    const years = year > 0 ? year - yearNow : 50;
    return { rate: Math.round(rate * 100) / 100, year: year, retrofit: Math.round(PB.pilingsMult * row.cost * (1 + rate * years)) };
  }
  /** Placement query (never throws). opts = {rot, pilings, grade, tiles, ignoreCash, instant, target} */
  M.canPlace = function (state, id, tx, ty, opts) {
    const r = blankResult();
    try { return canPlaceInner(state, id, tx, ty, opts || {}, r); }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'canPlace', e); return fail(r, 'Cannot place here'); }
  };
  function canPlaceInner(state, id, tx, ty, opts, r) {
    const row = rowOf(id);
    if (!state || !state.tiles || !row) return fail(r, 'Unknown building');
    tx = Math.floor(fin(tx, -1)); ty = Math.floor(fin(ty, -1));
    // 1. unlock / receivership / austerity
    const u = M.unlocked(state, id);
    if (!u.ok) return fail(r, u.reason || 'Locked');
    if (call('progress', 'receiverActive', [state], false) === true) return fail(r, 'Receivership');
    if (timer(state, 'noConstruction')) return fail(r, 'Austerity: no construction this month');
    const day = dayOf(state);
    r.summer = semesterOf(state) === 'summer';
    // 2. bounds and footprint
    if (row.kind === 'upgrade') return canPlacePilings(state, row, tx, ty, opts, r);
    if (row.placeRule === PLACE.BARRIER) return canPlaceBarrier(state, row, tx, ty, opts, r);
    const isFoot = row.kind === 'footprint';
    const d = isFoot ? dims(row, opts.rot) : { w: 1, h: 1 };
    const tiles = BSU.footprintTiles(tx, ty, d.w, d.h);
    if (!tiles) return fail(r, 'Off the map');
    r.tiles = tiles;
    r.radius = largestRadius(row);
    // 3. terrain rule
    if (!isFoot) {
      const why = dragTileRule(state, row, tiles[0], opts, r);
      if (why) return fail(r, why);
    } else {
      const why = footprintRule(state, row, tiles, tx, ty, d.w, d.h);
      if (why) return fail(r, why);
      // 4. preserve / mound
      for (const i of tiles) {
        if (isMound(state, i)) return fail(r, 'The Mounds');
        if (isPreserve(state, i) && row.id !== 'rookery') return fail(r, 'Preserve');
      }
      // 5. free + the Founders' reservation
      if (row.id === 'founders_hall') {
        const f = state.plot && state.plot.founders;
        if (!f || f.tx !== tx || f.ty !== ty) return fail(r, 'Founders’ Hall goes on the ridge');
        if (M.count(state, 'founders_hall') > 0) return fail(r, 'Occupied');
      } else {
        const res = reservedTiles(state);
        if (res) for (const i of tiles) if (res.indexOf(i) >= 0) return fail(r, 'Occupied');
      }
      for (const i of tiles) {
        if (state.tiles.owner[i] !== -1 || state.tiles.crest[i] > 0 || isCanal(state, i) || state.tiles.surface[i] !== SURF.NONE) return fail(r, 'Occupied');
      }
    }
    // cost base (per tile for drag/paint)
    let base = row.cost;
    let mod = 0;
    let marsh = false;
    if (isFoot) {
      let anyWet = false, allHigh = true, lo = Infinity, hi = -Infinity;
      for (const i of tiles) {
        const t = state.tiles.type[i], e = state.tiles.elev[i];
        if (t === T.WET || t === T.DRAINED) anyWet = true;
        if (t !== T.HIGH) allHigh = false;
        if (t === T.MARSH) marsh = true;
        if (e < lo) lo = e; if (e > hi) hi = e;
      }
      mod = anyWet ? PE.terrainCost.wet : (allHigh ? PE.terrainCost.high : 0);
      // 6. slope
      if (hi - lo > PB.slopeFt + 1e-6) { r.needsGrading = true; r.gradingCost = PB.gradingPerTile * tiles.length; }
      // 7. marsh → pilings
      if (marsh && !row.allowMarsh) return fail(r, 'Too wet: drain it or add Pilings');
      if (marsh || row.alwaysPilings || opts.pilings === true) r.needsPilings = true;
    } else if (r.bridge) {
      base = row.cost * PB.bridgeCostMult;
    } else if (r.landing) {
      base = 0;   // a Pedestrian Bridge run's land tile: nothing is built there
    }
    r.terrainMod = mod;
    const eng = (M.has(state, 'engineering') && (id === 'levee' || id === 'floodwall' || id === 'canal' || id === 'pump')) ? 1 + PE.terrainCost.engineering : 1;
    const afterMods = Math.round(base * (1 + mod) * (r.summer ? 1 + PE.terrainCost.summer : 1) * eng);
    r.baseCost = afterMods;
    if (r.needsPilings) r.pilingsCost = Math.round(PB.pilingsMult * afterMods);
    r.cost = afterMods + r.gradingCost + r.pilingsCost;
    // 8. access
    if (isFoot && row.pathAdjacency && row.id !== 'founders_hall') {
      const conn = connectedMask(state), ring = cache(state).founderRing;
      let ok = false;
      // a connected surface 1–3 edge tile, or an edge tile on Founders' own ring (the network root: the hall's front door)
      for (const e of BSU.edgeTiles(tx, ty, d.w, d.h)) if ((isAccessSurface(state.tiles.surface[e]) && conn[e]) || ring[e]) { ok = true; break; }
      r.access = ok;
      if (!ok) {
        // connector pass: no edge on the network → the building brings its own tie, or says how far the nearest path is
        const cn = connectorInner(state, row, tx, ty, opts.rot);
        if (!cn) return fail(r, 'No path within ' + connectorMax() + ' tiles');
        r.connector = cn; r.access = true;
      }
    }
    // 9. road within N
    if (isFoot && row.roadWithin > 0) {
      const R = row.roadWithin;
      let ok = false;
      for (let y = ty - R; y <= ty + d.h - 1 + R && !ok; y++) for (let x = tx - R; x <= tx + d.w - 1 + R; x++) {
        if (BSU.inBounds(x, y) && state.tiles.surface[BSU.idx(x, y)] === SURF.ROAD) { ok = true; break; }
      }
      r.roadOk = ok;
      if (!ok) return fail(r, 'Needs a Road within ' + R);
    }
    // ghost extras
    if (isFoot) {
      r.power = !!row.needsPower && coverAt(state, 'power', tiles);
      r.water = !!row.needsWater && coverAt(state, 'water', tiles);
      if (tiles.length && state.tiles.elev[tiles[0]] < P.terrain.crownElev) {
        const rf = call('terrain', 'ridgeFull', [state, d.w, d.h], null);
        r.ridgeFull = (rf && typeof rf === 'object') ? rf : null;
      }
      r.sink = sinkLine(state, row, tiles);
    }
    if (row.placeRule === PLACE.LEVEE && Array.isArray(opts.tiles) && opts.tiles.length) r.ring = ringPreview(state, row, opts.tiles);
    // 10. affordability (the building and its connector are one purchase)
    r.affordable = canAfford(state, r.cost + (r.connector ? r.connector.cost : 0));
    r.ok = true;
    r.color = (r.needsGrading || r.needsPilings) ? 'yellow' : 'green';
    if (!r.affordable && !opts.ignoreCash) return fail(r, 'Not enough cash');
    return r;
  }
  /** row 30: the pilings retrofit as a placement (opts.target or the building under the cursor) */
  function canPlacePilings(state, row, tx, ty, opts, r) {
    const b = Number.isInteger(opts.target) ? M.get(state, opts.target) : M.at(state, tx, ty);
    if (!b) return fail(r, 'Pick a building');
    if (b.pilings) return fail(r, 'Already on pilings');
    if (b.type === 'surge_barrier') return fail(r, 'Already on pilings');
    r.tiles = footprintOf(b);
    r.cost = retrofitCost(state, b);
    r.baseCost = r.cost;
    r.needsPilings = true;
    r.affordable = canAfford(state, r.cost);
    r.ok = true; r.color = 'yellow';
    if (!r.affordable && !opts.ignoreCash) return fail(r, 'Not enough cash');
    return r;
  }
  /** row 41: a straight 4–8 tile run across the bayou, land/levee ends, ≥ 2 pumps upstream */
  function canPlaceBarrier(state, row, tx, ty, opts, r) {
    const run = Array.isArray(opts.tiles) && opts.tiles.length ? opts.tiles.slice() : null;
    if (!run) {
      // a single-tile query: describe the ghost from the cursor (a straight run must be supplied to place)
      const i = BSU.inBounds(tx, ty) ? BSU.idx(tx, ty) : -1;
      if (i < 0) return fail(r, 'Off the map');
      r.tiles = [i]; r.cost = row.cost; r.baseCost = row.cost;
      return fail(r, 'Drag 4–8 tiles across the Bayou');
    }
    r.tiles = run; r.cost = row.cost; r.baseCost = row.cost;
    if (run.length < PB.barrierRun[0] || run.length > PB.barrierRun[1]) return fail(r, 'Drag 4–8 tiles across the Bayou');
    for (const i of run) if (!(Number.isInteger(i) && i >= 0 && i < N)) return fail(r, 'Off the map');
    const sameRow = run.every(i => (i >> 6) === (run[0] >> 6)), sameCol = run.every(i => (i & 63) === (run[0] & 63));
    if (!sameRow && !sameCol) return fail(r, 'The barrier must be a straight line');
    for (let k = 1; k < run.length; k++) if (Math.abs(run[k] - run[k - 1]) !== (sameRow ? 1 : W)) return fail(r, 'The barrier must be a straight line');
    const first = run[0], last = run[run.length - 1];
    const endOk = function (i) { return isLand(state, i) && (state.tiles.elev[i] >= PB.barrierEndElev || state.tiles.crest[i] > 0); };
    if (!endOk(first) || !endOk(last)) return fail(r, 'Ends must stand on land ≥ 1.5 ft or a levee');
    for (let k = 1; k < run.length - 1; k++) if (!(state.tiles.flags[run[k]] & FLAG.BAYOU) && state.tiles.type[run[k]] !== T.BAYOU) return fail(r, 'The middle must cross the Bayou');
    for (const i of run) if (state.tiles.owner[i] !== -1 || (state.tiles.surface[i] !== SURF.NONE && state.tiles.surface[i] !== SURF.BOARDWALK && state.tiles.surface[i] !== SURF.BRIDGE)) return fail(r, 'Occupied');
    if (M.count(state, 'surge_barrier') > 0) return fail(r, 'One barrier per bayou');
    // ≥ 2 powered pumps upstream (their network touches a bayou tile with a smaller spline index)
    const bayou = (state.plot && state.plot.bayou) || [];
    let minParam = Infinity;
    for (const i of run) { const k = bayou.indexOf(i); if (k >= 0 && k < minParam) minParam = k; }
    let pumps = 0;
    const nets = call('hydro', 'networks', [state], []) || [];
    const seen = new Set();
    for (const net of nets) {
      let touchesUp = false;
      for (const i of (net.tiles || [])) for (const n of BSU.nbr4(i)) { const k = bayou.indexOf(n); if (k >= 0 && k < minParam) touchesUp = true; }
      if (!touchesUp) continue;
      for (const pid of (net.pumps || [])) { const pb = M.get(state, pid); if (pb && isComplete(pb) && pb.powered && !seen.has(pid)) { seen.add(pid); pumps++; } }
    }
    if (pumps < PH.barrierPumps) return fail(r, 'Needs 2 powered Pumps upstream');
    r.affordable = canAfford(state, r.cost);
    r.ok = true; r.color = 'green';
    if (!r.affordable && !opts.ignoreCash) return fail(r, 'Not enough cash');
    return r;
  }
  /** is any tile of `tiles` inside an active provider's radius (ghost icons) */
  function coverAt(state, kind, tiles) {
    const c = cache(state);   // reads the last recompute (the tick refreshes it; a hover must not emit)
    const map = kind === 'power' ? c.powerCover : c.waterCover;
    for (const i of tiles) if (map[i]) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // place / placeRun / remove / undo (ARCHITECTURE §5.6, §12.1; GDD §4.11)
  // ---------------------------------------------------------------------------
  function newBuilding(state, row, tx, ty, w, h, rot, opts, day) {
    const id = state.buildings.length;
    const instant = opts.instant === true;
    return {
      id: id, type: row.id, tx: tx, ty: ty, w: w, h: h, rot: rot === 1 ? 1 : 0,
      name: autoName(state, row),
      hp: 1, built: instant ? 1 : 0, builtDay: instant ? day : -1,
      pilings: !!opts._pilings, sunk: 0,
      powered: false, watered: false, provider: { power: -1, water: -1 },
      flooded: false, floodedSince: -1, closedUntil: -1, blackout: false,
      tier: row.id === 'stadium' ? 1 : 0, upgradeDoneDay: -1, ruin: false, tarp: false,
      data: {
        fuelDays: fin(row.effects.fuelDays, 0), stockedDay: -1, active: true,
        policies: { gatorProofDumpsters: false, nutriaBounty: false },
        boardedUntil: -1, regradeUntil: -1, dumpsterTile: -1,
        seed: BSU.rng.hash(fin(state.seed, 0), id)
      }
    };
  }
  /** Dining Hall dumpster: (tx + w, ty + h − 1) if land and free, else the first free land edge tile clockwise from there */
  function pickDumpster(state, b) {
    const edges = BSU.edgeTiles(b.tx, b.ty, b.w, b.h);
    const pref = BSU.inBounds(b.tx + b.w, b.ty + b.h - 1) ? BSU.idx(b.tx + b.w, b.ty + b.h - 1) : -1;
    const free = function (i) { return i >= 0 && isLand(state, i) && state.tiles.owner[i] === -1 && state.tiles.surface[i] === SURF.NONE && state.tiles.crest[i] === 0; };
    if (free(pref)) return pref;
    // clockwise from the east column downward: east col, south row (right→left), west col (bottom→top), north row (left→right)
    const order = [];
    for (let y = b.ty; y < b.ty + b.h; y++) order.push([b.tx + b.w, y]);
    for (let x = b.tx + b.w - 1; x >= b.tx; x--) order.push([x, b.ty + b.h]);
    for (let y = b.ty + b.h - 1; y >= b.ty; y--) order.push([b.tx - 1, y]);
    for (let x = b.tx; x < b.tx + b.w; x++) order.push([x, b.ty - 1]);
    for (const [x, y] of order) { if (!BSU.inBounds(x, y)) continue; const i = BSU.idx(x, y); if (edges.indexOf(i) >= 0 && free(i)) return i; }
    return -1;
  }
  /** one undo record per placement or run: entries (reverse-applied by undo), the full cost, and a label for the Undo chip */
  function pushUndo(state, rec, id) {
    const row = rowOf(id); let n = 0, nb = 0;
    for (const e of rec.entries) { if (e.kind === 'tile' || e.kind === 'building' || e.kind === 'veg') n++; if (e.kind === 'building') nb++; }
    rec.id = id; rec.name = row ? row.name : String(id); rec.n = nb > 0 ? nb : n;   // a building's connector tiles ride along (rec.connector), they are not "4 × Dining Hall"
    rec.connector = fin(rec.connector, 0);
    cache(state).undo = rec;
  }
  /** apply one legal drag tile (validation already done); records undo entries; returns the tiles written */
  function applyDragTile(state, row, i, undoRec, day) {
    const tl = state.tiles;
    const prev = { i: i, surface: tl.surface[i], crest: tl.crest[i], integrity: tl.integrity[i], flags: tl.flags[i], elev: tl.elev[i] };
    const ent = { kind: 'tile', prev: prev, post: null, eco: 0 };   // post = what this placement left behind: undo refuses when the tile was changed since
    undoRec.entries.push(ent);
    switch (row.placeRule) {
      case PLACE.PATH: case PLACE.ROAD: case PLACE.BOARDWALK: case PLACE.BRIDGE:
        setSurface(state, i, row.effects.surfaceId); rewalk(state, i); break;
      case PLACE.FENCE:
        setSurface(state, i, SURF.FENCE); rewalk(state, i); break;
      case PLACE.LEVEE:
        tl.crest[i] = row.effects.crest; tl.integrity[i] = 100;
        markLeveeChange(state, i); rewalk(state, i); break;
      case PLACE.CANAL:
        setElev(state, i, Math.max(tl.elev[i] - PH.canalCut, PH.canalBedMin));
        markCanal(state, i, true); rewalk(state, i);
        if (isMarsh(state, i)) { ent.eco = fin(row.effects.ecologyPerTile, 0); call('wildlife', 'applyEcologyOnce', [state, row.effects.ecologyPerTile], null); }
        break;
      case PLACE.PRESERVE:
        setFlag(state, i, FLAG.PRESERVE, true); break;
      default: break;
    }
    ent.post = { surface: tl.surface[i], crest: tl.crest[i], flags: tl.flags[i] & (FLAG.CANAL | FLAG.PRESERVE), owner: tl.owner[i] };
    touch(state, i, 'decor');
  }
  /** Place a footprint row, a drag tile, the pilings upgrade or the surge barrier. Charges economy. */
  M.place = function (state, id, tx, ty, opts) {
    opts = opts || {};
    try { return placeInner(state, id, tx, ty, opts, null); }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'place', e); return { ok: false, reason: 'Cannot place here', cost: 0 }; }
  };
  function placeInner(state, id, tx, ty, opts, sharedUndo) {
    const row = rowOf(id);
    if (!row || !state) return { ok: false, reason: 'Unknown building', cost: 0 };
    if (row.kind === 'upgrade') {
      const target = Number.isInteger(opts.target) ? opts.target : (M.at(state, tx, ty) ? M.at(state, tx, ty).id : -1);
      const rr = M.retrofitPilings(state, target, opts);
      return { ok: rr.ok, reason: rr.reason || '', id: target, tiles: rr.ok ? M.footprint(state, target) : [], cost: rr.cost };
    }
    const r = M.canPlace(state, id, tx, ty, opts);
    if (!r.ok) return { ok: false, reason: r.reason, cost: r.cost };
    const day = dayOf(state);
    const c = cache(state);
    // connector pass: the building and its gravel tie are ONE purchase (one charge, one undo record, one refund)
    const connTiles = (r.connector && Array.isArray(r.connector.tiles)) ? r.connector.tiles : [];
    const connCost = connTiles.length ? fin(r.connector.cost, 0) : 0;
    const total = r.cost + connCost;
    if (!opts.ignoreCash) {
      if (!charge(state, total, 'construction', { i: r.tiles[0] })) return { ok: false, reason: 'Not enough cash', cost: total };
    }
    const undoRec = sharedUndo || { tick: fin(state.tick, 0), entries: [], cost: 0 };
    undoRec.cost += opts.ignoreCash ? 0 : total;
    // ---- drag rows: one tile
    if (row.kind === 'drag' && row.placeRule !== PLACE.BARRIER || row.kind === 'paint') {
      const i = r.tiles[0];
      applyDragTile(state, row, i, undoRec, day);
      if (!sharedUndo) pushUndo(state, undoRec, id);
      c.aurasDirty = true; c.statsCache = null;
      return { ok: true, id: -1, tiles: [i], cost: r.cost };
    }
    // ---- rows 36–38: veg entities, no struct
    if (id === 'live_oak' || id === 'cypress' || id === 'azalea') {
      const i = r.tiles[0];
      const vtype = id === 'live_oak' ? 'oak' : id;
      const tr = dep.terrain();
      if (tr && typeof tr.plantVeg === 'function') tr.plantVeg(state, vtype, tx, ty);
      else state.veg.push({ type: vtype, tx: tx, ty: ty, stage: 0, plantedDay: day, planted: true });
      undoRec.entries.push({ kind: 'veg', tx: tx, ty: ty, type: vtype });
      if (!sharedUndo) pushUndo(state, undoRec, id);
      touch(state, i, 'decor');
      c.aurasDirty = true; c.statsCache = null;
      return { ok: true, id: -1, tiles: [i], cost: r.cost };
    }
    // ---- footprint rows (and the barrier struct)
    const d = row.placeRule === PLACE.BARRIER ? null : dims(row, opts.rot);
    let b;
    if (row.placeRule === PLACE.BARRIER) {
      const run = r.tiles;
      const horiz = (run[0] >> 6) === (run[run.length - 1] >> 6);
      const x0 = Math.min(run[0] & 63, run[run.length - 1] & 63), y0 = Math.min(run[0] >> 6, run[run.length - 1] >> 6);
      b = newBuilding(state, row, x0, y0, horiz ? run.length : 1, horiz ? 1 : run.length, 0, Object.assign({}, opts, { _pilings: true }), day);
    } else {
      b = newBuilding(state, row, tx, ty, d.w, d.h, opts.rot, Object.assign({}, opts, { _pilings: r.needsPilings || row.alwaysPilings || opts.pilings === true }), day);
    }
    // grading: level the footprint to its mean (rounded to 0.01)
    if (r.needsGrading || opts.grade === true) {
      let mean = 0; for (const i of r.tiles) mean += state.tiles.elev[i]; mean /= r.tiles.length;
      for (const i of r.tiles) { undoRec.entries.push({ kind: 'elev', i: i, elev: state.tiles.elev[i] }); setElev(state, i, mean); }
    }
    state.buildings.push(b);
    undoRec.entries.push({ kind: 'building', id: b.id, type: b.type, pilings: b.pilings, tier: b.tier });
    for (const i of r.tiles) { state.tiles.owner[i] = b.id; rewalk(state, i); touch(state, i, 'decor'); }
    if (id === 'dining_hall') b.data.dumpsterTile = pickDumpster(state, b);
    if (id === 'wastewater') { for (const i of r.tiles) if (isMarsh(state, i)) { call('wildlife', 'applyEcologyOnce', [state, -P.wildlife.ecology.wastewaterMarsh], null); break; } }
    if (id === 'pond') {
      for (const i of r.tiles) { undoRec.entries.push({ kind: 'elev', i: i, elev: state.tiles.elev[i] }); setElev(state, i, state.tiles.elev[i] - PH.pond.cut); }
      markPond(state, r.tiles, b.id, true);
    }
    if (id === 'founders_hall') c.connectedDirty = true;
    // connector pass: lay the tie through the drag tool's own code path (surface, walk, chunk, events, tees), on the same undo record
    const laid = [];
    if (connTiles.length) {
      const po = { tiles: connTiles, ignoreCash: true };
      for (const i of connTiles) { const pr = placeInner(state, 'path', i & 63, i >> 6, po, undoRec); if (pr.ok) laid.push(i); }
      if (laid.length < connTiles.length && !opts.ignoreCash) {   // a tile refused under our feet (cannot happen after canPlace, but never keep money for nothing)
        const back = Math.round(connCost * (connTiles.length - laid.length) / connTiles.length);
        if (back > 0) { refund(state, back, { key: 'construction' }); undoRec.cost -= back; }
      }
      undoRec.connector = fin(undoRec.connector, 0) + laid.length;
    }
    if (!sharedUndo) pushUndo(state, undoRec, id);
    dirtyAll(c);
    emit(EV.BUILDING_PLACED, { id: b.id, type: b.type, tx: b.tx, ty: b.ty, w: b.w, h: b.h, cost: r.cost, pilings: b.pilings, connector: laid.length });
    if (b.built >= 1) onComplete(state, b);
    const charged = opts.ignoreCash ? total : (total - (connTiles.length ? Math.round(connCost * (connTiles.length - laid.length) / connTiles.length) : 0));
    return { ok: true, id: b.id, tiles: r.tiles, cost: charged, connector: laid.length ? { tiles: laid, cost: charged - r.cost } : null };
  }
  /** drag release: places every legal tile of the run in order (best effort), one undo record */
  M.placeRun = function (state, id, tiles, opts) {
    opts = opts || {};
    const out = { ok: false, placed: 0, cost: 0, skipped: [] };
    try {
      const row = rowOf(id);
      if (!row || !state || !Array.isArray(tiles)) { out.skipped.push({ i: -1, reason: 'Unknown building' }); return out; }
      const run = [];
      for (const i of tiles) if (Number.isInteger(i) && i >= 0 && i < N && run.indexOf(i) < 0) run.push(i);
      if (!run.length) return out;
      if (id === 'marsh_restoration') return paintRestoration(state, row, run, opts, out);
      if (row.placeRule === PLACE.BARRIER) {
        const r = placeInner(state, id, run[0] & 63, run[0] >> 6, Object.assign({}, opts, { tiles: run }), null);
        if (r.ok) { out.ok = true; out.placed = run.length; out.cost = r.cost; } else out.skipped.push({ i: run[0], reason: r.reason });
        return out;
      }
      if (row.kind !== 'drag' && row.kind !== 'paint') {
        // a footprint row dragged: place once at the first tile
        const r = placeInner(state, id, run[0] & 63, run[0] >> 6, opts, null);
        if (r.ok) { out.ok = true; out.placed = 1; out.cost = r.cost; } else out.skipped.push({ i: run[0], reason: r.reason });
        return out;
      }
      // bridges: validate every water segment of a road run as a whole before placing any tile of it
      const bad = new Map();
      if (row.placeRule === PLACE.ROAD) {
        for (let k = 0; k < run.length; k++) {
          if (!hasWaterFlag(state, run[k])) continue;
          const chk = bridgeSpanOk(state, run[k], run);
          if (!chk.ok) bad.set(run[k], chk.reason);
        }
      }
      // bridge pass: a Pedestrian Bridge run is its water tiles; land tiles are the landings (nothing placed, nothing charged)
      let landings = null;
      if (row.placeRule === PLACE.BRIDGE) {
        landings = new Set();
        for (let k = 0; k < run.length; k++) {
          if (isLand(state, run[k])) { landings.add(run[k]); continue; }
          const chk = pedBridgeOk(state, run[k], run);
          if (!chk.ok) bad.set(run[k], chk.reason);
        }
        if (landings.size === run.length) { out.skipped.push({ i: run[0], reason: 'Bridges go over water' }); return out; }
      }
      const undoRec = { tick: fin(state.tick, 0), entries: [], cost: 0 };
      const o = Object.assign({}, opts, { tiles: run });
      for (const i of run) {
        if (landings && landings.has(i)) {   // a bare landing gets a gravel path (its own price) so the bridge meets the land properly
          if (state.tiles.surface[i] === SURF.NONE && state.tiles.owner[i] === -1) { const lr = placeInner(state, 'path', i & 63, i >> 6, opts, undoRec); if (lr.ok) { out.placed++; out.cost += lr.cost; } }
          continue;
        }
        if (bad.has(i)) { out.skipped.push({ i: i, reason: bad.get(i) }); continue; }
        const r = placeInner(state, id, i & 63, i >> 6, o, undoRec);
        if (r.ok) { out.placed++; out.cost += r.cost; } else out.skipped.push({ i: i, reason: r.reason });
      }
      if (out.placed > 0) { pushUndo(state, undoRec, id); out.ok = true; dirtyAll(cache(state)); }
      return out;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'placeRun', e); out.skipped.push({ i: -1, reason: 'Cannot place here' }); return out; }
  };
  function refundOfTile(state, i) {
    const cat = catalog(), tl = state.tiles;
    let v = 0;
    if (tl.crest[i] === 12 && cat.floodwall) v += cat.floodwall.cost; else if (tl.crest[i] > 0 && cat.levee) v += cat.levee.cost;
    if (isCanal(state, i) && cat.canal) v += cat.canal.cost;
    const s = tl.surface[i];
    if (s === SURF.PATH && cat.path) v += cat.path.cost;
    if (s === SURF.ROAD && cat.road) v += cat.road.cost * (hasWaterFlag(state, i) ? PB.bridgeCostMult : 1);
    if (s === SURF.BOARDWALK && cat.boardwalk) v += cat.boardwalk.cost;
    if (s === SURF.BRIDGE && cat.bridge) v += cat.bridge.cost;
    if (s === SURF.FENCE && cat.gator_fence) v += cat.gator_fence.cost;
    if (isPreserve(state, i) && cat.preserve) v += cat.preserve.cost;
    return v;
  }
  /** clears every drag feature on a tile (levee/floodwall, canal flag — the bed stays —, surface, preserve) */
  function clearDragTile(state, i) {
    const tl = state.tiles;
    let any = false;
    if (tl.crest[i] > 0) { tl.crest[i] = 0; tl.integrity[i] = 0; tl.sandbag[i] = 0; markLeveeChange(state, i); any = true; }
    if (isCanal(state, i)) { markCanal(state, i, false); any = true; }
    if (tl.surface[i] !== SURF.NONE) { setSurface(state, i, SURF.NONE); any = true; }
    if (isPreserve(state, i)) { setFlag(state, i, FLAG.PRESERVE, false); any = true; }
    if (any) { rewalk(state, i); touch(state, i, 'decor'); }
    return any;
  }
  function removeStruct(state, b, reason, refundAmt) {
    const c = cache(state);
    for (const i of footprintOf(b)) if (state.tiles.owner[i] === b.id) state.tiles.owner[i] = -1;
    if (b.type === 'pond') { markPond(state, footprintOf(b), b.id, false); for (const i of footprintOf(b)) setElev(state, i, state.tiles.elev[i] + PH.pond.cut); }
    state.buildings[b.id] = null;
    for (const i of footprintOf(b)) { rewalk(state, i); touch(state, i, 'decor'); }
    if (refundAmt > 0) refund(state, refundAmt, { key: 'demolition', i: BSU.idx(b.tx, b.ty) });
    dirtyAll(c);
    emit(EV.BUILDING_REMOVED, { id: b.id, type: b.type, tx: b.tx, ty: b.ty, w: b.w, h: b.h, refund: refundAmt, reason: reason });
  }
  /** demolish a footprint (id) or a drag tile ({tile: i}); founders/landmarks refuse */
  M.remove = function (state, idOrTile, reason) {
    reason = reason || 'demolish';
    try {
      if (!state) return { ok: false, refund: 0, reason: 'No game' };
      if (idOrTile && typeof idOrTile === 'object' && Number.isInteger(idOrTile.tile)) {
        const i = idOrTile.tile;
        if (i < 0 || i >= N) return { ok: false, refund: 0, reason: 'Off the map' };
        if (state.tiles.owner[i] >= 0) return M.remove(state, state.tiles.owner[i], reason);
        // a planted tree on the tile?
        const tx = i & 63, ty = i >> 6;
        let vegIdx = -1;
        for (let k = 0; k < state.veg.length; k++) if (state.veg[k] && state.veg[k].tx === tx && state.veg[k].ty === ty) { vegIdx = k; break; }
        let amount = reason === 'demolish' ? Math.round(refundOfTile(state, i) * PE.demolishRefund) : 0;
        let any = clearDragTile(state, i);
        if (vegIdx >= 0) {
          const v = state.veg[vegIdx], cat = catalog();
          const rowId = v.type === 'oak' ? 'live_oak' : v.type;
          if (reason === 'demolish' && cat[rowId] && v.planted) amount += Math.round(cat[rowId].cost * PE.demolishRefund);   // only trees the player planted refund; clearing a wild one pays nothing
          const tr = dep.terrain();
          if (tr && typeof tr.removeVeg === 'function') tr.removeVeg(state, v.tx, v.ty); else state.veg.splice(vegIdx, 1);   // terrain.removeVeg takes (state, tx, ty), not an index
          touch(state, i, 'decor'); any = true;
        }
        if (!any) return { ok: false, refund: 0, reason: 'Nothing here' };
        if (amount > 0) refund(state, amount, { key: 'demolition', i: i });
        dirtyAll(cache(state));
        return { ok: true, refund: amount };
      }
      const b = M.get(state, idOrTile);
      if (!b) return { ok: false, refund: 0, reason: 'Nothing here' };
      const row = rowOf(b.type);
      if (reason === 'demolish' && (!row || !row.demolishable)) return { ok: false, refund: 0, reason: 'Landmarks stay' };
      const amount = (reason === 'demolish' && row) ? Math.round(row.cost * PE.demolishRefund) : 0;
      removeStruct(state, b, reason, amount);
      return { ok: true, refund: amount };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'remove', e); return { ok: false, refund: 0, reason: 'Cannot remove' }; }
  };
  /** the undo window in sim ticks: 50 at 1× (5 s of wall-clock), scaled with the speed (paused = frozen, never wider than 1×) */
  function undoWindow(state) { return P.ui.undoTicks * Math.max(1, fin(state.ui && state.ui.speed, 1)); }
  /** what Ctrl+Z / the Undo chip would take back right now: {id, name, n, refund, ticksLeft, windowTicks} or null (nothing, or the window closed) */
  M.undoInfo = function (state) {
    try {
      if (!state) return null;
      const u = cache(state).undo; if (!u) return null;
      const win = undoWindow(state), left = win - (fin(state.tick, 0) - u.tick);
      if (left < 0) return null;
      return { id: u.id || '', name: u.name || '', n: fin(u.n, 0), refund: fin(u.cost, 0), ticksLeft: left, windowTicks: win, connector: fin(u.connector, 0) };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'undoInfo', e); return null; }
  };
  /** why a record can no longer be taken back, or '' when every tile/building/tree is still exactly as the placement left it */
  function undoBlocker(state, u) {
    const tl = state.tiles;
    for (const e of u.entries) {
      if (e.kind === 'tile' && e.post) {
        const i = e.prev.i, q = e.post;
        if (tl.surface[i] !== q.surface || (tl.crest[i] > 0) !== (q.crest > 0) || (tl.flags[i] & (FLAG.CANAL | FLAG.PRESERVE)) !== q.flags || tl.owner[i] !== q.owner) return "Can't undo: that ground has been changed since";
      } else if (e.kind === 'building') {
        const b = state.buildings[e.id];
        if (!b || b.type !== e.type) return "Can't undo: that building is gone or replaced";
        if (b.pilings !== e.pilings || b.tier !== e.tier) return "Can't undo: that building has been upgraded since";
      } else if (e.kind === 'veg') {
        if (!state.veg.some(function (v) { return v && v.tx === e.tx && v.ty === e.ty && v.type === e.type && v.planted; })) return "Can't undo: that tree is gone";
      }
    }
    return '';
  }
  /** take back the last placement or drag run inside the undo window: every touched tile returns to its exact previous surface / flags / crest / canal / elevation through the same hooks placing used, the cost is refunded */
  M.undo = function (state) {
    try {
      const c = cache(state), u = c.undo;
      if (!u) return { ok: false, reason: 'Nothing to undo' };
      const win = undoWindow(state);   // D16: 5 s wall-clock in the browser → the tick window scales with the sim speed (50 ticks headless / at 1×)
      if (fin(state.tick, 0) - u.tick > win) { c.undo = null; return { ok: false, reason: 'Too late to undo (' + P.ui.undoSeconds + ' s window)' }; }
      const why = undoBlocker(state, u);
      if (why) { c.undo = null; return { ok: false, reason: why }; }
      const tl = state.tiles;
      for (let k = u.entries.length - 1; k >= 0; k--) {
        const e = u.entries[k];
        if (e.kind === 'building') {
          const b = state.buildings[e.id];
          if (b) removeStruct(state, b, 'restore', 0);
        } else if (e.kind === 'tile') {
          const p = e.prev, i = p.i;
          const hadCanal = isCanal(state, i), wantCanal = (p.flags & FLAG.CANAL) !== 0;
          if (tl.surface[i] !== p.surface) setSurface(state, i, p.surface);
          if (hadCanal !== wantCanal) markCanal(state, i, wantCanal);
          if (isPreserve(state, i) !== ((p.flags & FLAG.PRESERVE) !== 0)) setFlag(state, i, FLAG.PRESERVE, (p.flags & FLAG.PRESERVE) !== 0);
          if (tl.crest[i] !== p.crest || tl.integrity[i] !== p.integrity) { tl.crest[i] = p.crest; tl.integrity[i] = p.integrity; markLeveeChange(state, i); }
          if (Math.abs(tl.elev[i] - p.elev) > 1e-6) setElev(state, i, p.elev);
          if (e.eco) call('wildlife', 'applyEcologyOnce', [state, -e.eco], null);
          rewalk(state, i); touch(state, i, 'decor');
        } else if (e.kind === 'eco') {
          call('wildlife', 'applyEcologyOnce', [state, -e.amount], null);
        } else if (e.kind === 'elev') {
          setElev(state, e.i, e.elev);
        } else if (e.kind === 'veg') {
          let idx = -1;
          for (let j = state.veg.length - 1; j >= 0; j--) { const v = state.veg[j]; if (v && v.tx === e.tx && v.ty === e.ty && v.type === e.type && v.planted) { idx = j; break; } }
          if (idx >= 0) { const tr = dep.terrain(); if (tr && typeof tr.removeVeg === 'function') tr.removeVeg(state, e.tx, e.ty); else state.veg.splice(idx, 1); touch(state, BSU.idx(e.tx, e.ty), 'decor'); }
        }
      }
      if (u.cost > 0) refund(state, u.cost, { key: 'construction' });
      c.undo = null;
      dirtyAll(c);
      return { ok: true, id: u.id || '', name: u.name || '', n: fin(u.n, 0), refund: fin(u.cost, 0), connector: fin(u.connector, 0) };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'undo', e); return { ok: false, reason: 'Cannot undo' }; }
  };
  /** documented opts of place(): {rot, pilings, grade, tiles, ignoreCash, instant, target} */
  M.placeOpts = Object.freeze({ rot: '0|1', pilings: 'boolean', grade: 'boolean', tiles: 'number[] (drag run)', ignoreCash: 'boolean', instant: 'boolean', target: 'building id (pilings)' });

  // ---------------------------------------------------------------------------
  // Upgrades, retrofit, re-grade, policies, refuel, restoration paint, BSU West
  // ---------------------------------------------------------------------------
  function retrofitCost(state, b) {
    const row = rowOf(b.type); if (!row) return 0;
    let discount = 1;
    const t1 = timer(state, 'pilingsDiscount');
    if (t1 && t1.meta && t1.meta.building === b.id) discount *= 1 - P.progress.milestoneEffects.wetFeetDiscount;
    if (timer(state, 'pilingsDiscountYear')) discount *= 1 - P.progress.milestoneEffects.sinkingDiscount;
    return Math.round(PB.pilingsMult * row.cost * (1 + fin(b.sunk, 0)) * discount);
  }
  /** row 30 retrofit: +40% × cost × (1 + sunk) × discounts; 1 day closed */
  M.retrofitPilings = function (state, id, opts) {
    opts = opts || {};
    try {
      const b = M.get(state, id);
      if (!b) return { ok: false, cost: 0, reason: 'Pick a building' };
      if (b.pilings) return { ok: false, cost: 0, reason: 'Already on pilings' };
      const cost = retrofitCost(state, b);
      if (!opts.ignoreCash && !charge(state, cost, 'construction', { i: BSU.idx(b.tx, b.ty) })) return { ok: false, cost: cost, reason: 'Not enough cash' };
      const day = dayOf(state);
      b.pilings = true; b.closedUntil = Math.max(b.closedUntil, day + PB.pilingsDays);
      const t1 = timer(state, 'pilingsDiscount');
      if (t1 && t1.meta && t1.meta.building === b.id) call('progress', 'removeTimer', [state, 'pilingsDiscount'], null);
      for (const i of footprintOf(b)) touch(state, i, 'decor');
      dirtyAll(cache(state));
      return { ok: true, cost: cost };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'retrofitPilings', e); return { ok: false, cost: 0, reason: 'Cannot retrofit' }; }
  };
  /** $15k × tiles, +1 ft, 3 days closed, sunk −1 (GDD §6.5) */
  M.regrade = function (state, id) {
    try {
      const b = M.get(state, id);
      if (!b) return { ok: false, cost: 0, reason: 'Pick a building' };
      const tiles = footprintOf(b), cost = PSUB.regradeCost * tiles.length;
      if (!charge(state, cost, 'construction', { i: BSU.idx(b.tx, b.ty) })) return { ok: false, cost: cost, reason: 'Not enough cash' };
      const day = dayOf(state);
      for (const i of tiles) setElev(state, i, state.tiles.elev[i] + PSUB.regradeFt);
      b.closedUntil = Math.max(b.closedUntil, day + PSUB.regradeDays);
      b.data.regradeUntil = day + PSUB.regradeDays;
      b.sunk = Math.max(0, fin(b.sunk, 0) - PSUB.regradeFt);
      dirtyAll(cache(state));
      return { ok: true, cost: cost };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'regrade', e); return { ok: false, cost: 0, reason: 'Cannot re-grade' }; }
  };
  /** local evaluation of a tier's unlock when progress.unlockOk is absent */
  function unlockOkLocal(state, u) {
    if (!u) return true;
    const ec = state.economy || {};
    if (u.students != null && fin(ec.students, 0) < u.students) return false;
    if (u.prestige != null && fin(ec.prestige, 0) < u.prestige) return false;
    if (u.ecology != null && fin(ec.ecology, 0) < u.ecology) return false;
    if (u.milestone && !(state.progress && state.progress.milestones && state.progress.milestones[u.milestone] && state.progress.milestones[u.milestone].earned)) return false;
    if (u.building && !M.has(state, u.building, u.tier || 0)) return false;
    if (Array.isArray(u.any) && u.any.length && !u.any.some(function (x) { return unlockOkLocal(state, x); })) return false;
    return true;
  }
  /** stadium tiers / Bayou Field: charges, closes the building until the tier completes */
  M.upgrade = function (state, id) {
    try {
      const b = M.get(state, id);
      if (!b) return { ok: false, cost: 0, tier: 0, reason: 'Pick a building' };
      const row = rowOf(b.type);
      if (!row || !row.tiers.length) return { ok: false, cost: 0, tier: b.tier, reason: 'Nothing to upgrade' };
      if (!isComplete(b)) return { ok: false, cost: 0, tier: b.tier, reason: 'Still under construction' };
      if (b.upgradeDoneDay >= 0) return { ok: false, cost: 0, tier: b.tier, reason: 'Upgrade in progress' };
      const next = row.tiers.find(function (t) { return t.tier === b.tier + 1; });
      if (!next) return { ok: false, cost: 0, tier: b.tier, reason: 'Top tier' };
      const pr = dep.progress();
      const okUnlock = (pr && typeof pr.unlockOk === 'function') ? pr.unlockOk(state, next.unlock) !== false : unlockOkLocal(state, next.unlock);
      if (!okUnlock) return { ok: false, cost: next.cost, tier: b.tier, reason: 'Locked' };
      if (!charge(state, next.cost, 'construction', { i: BSU.idx(b.tx, b.ty) })) return { ok: false, cost: next.cost, tier: b.tier, reason: 'Not enough cash' };
      const day = dayOf(state);
      b.upgradeDoneDay = day + fin(next.buildDays, PB.tierUpgradeDays);
      b.closedUntil = Math.max(b.closedUntil, b.upgradeDoneDay);
      dirtyAll(cache(state));
      return { ok: true, cost: next.cost, tier: next.tier };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'upgrade', e); return { ok: false, cost: 0, tier: 0, reason: 'Cannot upgrade' }; }
  };
  /** 'gatorProofDumpsters' ($5k once, dining hall) | 'nutriaBounty' (post) | 'active' (abatement) */
  M.setPolicy = function (state, id, key, value) {
    try {
      const b = M.get(state, id);
      if (!b) return { ok: false, cost: 0, reason: 'Pick a building' };
      const on = !!value;
      if (key === 'active') { b.data.active = on; cache(state).aurasDirty = true; return { ok: true, cost: 0 }; }
      if (key === 'gatorProofDumpsters') {
        if (b.type !== 'dining_hall') return { ok: false, cost: 0, reason: 'Dining Halls only' };
        let cost = 0;
        if (on && !b.data.policies.gatorProofDumpsters) {
          cost = PB.dumpsterCost;
          if (!charge(state, cost, 'construction', { i: BSU.idx(b.tx, b.ty) })) return { ok: false, cost: cost, reason: 'Not enough cash' };
        }
        b.data.policies.gatorProofDumpsters = on;
        return { ok: true, cost: cost };
      }
      if (key === 'nutriaBounty') {
        if (b.type !== 'wildlife_post') return { ok: false, cost: 0, reason: 'Wildlife Posts only' };
        b.data.policies.nutriaBounty = on;
        return { ok: true, cost: 0 };
      }
      return { ok: false, cost: 0, reason: 'Unknown policy' };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'setPolicy', e); return { ok: false, cost: 0, reason: 'Cannot set policy' }; }
  };
  /** generator: $5k → +3 fuel days */
  M.refuel = function (state, id) {
    try {
      const b = M.get(state, id);
      if (!b || b.type !== 'generator') return { ok: false, cost: 0, reason: 'Pick a generator' };
      if (!charge(state, PB.refuelCost, 'prep', { i: BSU.idx(b.tx, b.ty) })) return { ok: false, cost: PB.refuelCost, reason: 'Not enough cash' };
      b.data.fuelDays = fin(b.data.fuelDays, 0) + PB.refuelDays;
      cache(state).coverageDirty = true;
      return { ok: true, cost: PB.refuelCost };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'refuel', e); return { ok: false, cost: 0, reason: 'Cannot refuel' }; }
  };
  /** Tier 2: Marsh Restoration paint — 10–40 eligible tiles become RESTORING; ecology on completion */
  function paintRestoration(state, row, run, opts, out) {
    const office = M.list(state, 'marsh_restoration').find(isComplete) || M.list(state, 'marsh_restoration')[0];
    if (!office) { out.skipped.push({ i: run[0], reason: 'Build the Program office first' }); return out; }
    if (office.data.restore) { out.skipped.push({ i: run[0], reason: 'Restoration already under way' }); return out; }
    const ok = [];
    for (const i of run) {
      const t = state.tiles.type[i], f = state.tiles.flags[i];
      let eligible = false;
      if (t === T.DRAINED || (f & FLAG.DRAINED)) eligible = true;
      else if (t === T.WET) {
        if (f & FLAG.WETLAND_ORIGINAL) eligible = true;
        else {
          const tx = i & 63, ty = i >> 6, R = PB.restorationNearMarsh;
          for (let y = ty - R; y <= ty + R && !eligible; y++) for (let x = tx - R; x <= tx + R; x++) if (BSU.inBounds(x, y) && isMarsh(state, BSU.idx(x, y))) { eligible = true; break; }
        }
      }
      if (eligible && state.tiles.owner[i] === -1 && state.tiles.surface[i] === SURF.NONE && state.tiles.crest[i] === 0) ok.push(i); else out.skipped.push({ i: i, reason: 'Not restorable' });
    }
    if (ok.length < PB.restorationTiles[0]) { out.skipped.push({ i: run[0], reason: 'Paint at least 10 eligible tiles' }); return out; }
    const tiles = ok.slice(0, PB.restorationTiles[1]);
    const hy = dep.hydro();
    for (const i of tiles) {
      if (hy && typeof hy.markRestoring === 'function') hy.markRestoring(state, i, true);
      else { state.tiles.flags[i] |= FLAG.RESTORING; touch(state, i, 'flags'); }
    }
    office.data.restore = { tiles: tiles, doneDay: dayOf(state) + PB.restorationDays };
    out.ok = true; out.placed = tiles.length; out.cost = 0;
    return out;
  }
  /** Tier 2: the Second Campus hall (economy.charterWest calls this); a free 4×3 hall named BSU West */
  M.placeWestHall = function (state) {
    try {
      const row = rowOf('lecture_hall'); if (!row) return { ok: false, reason: 'No catalog' };
      const chen = (state.plot && state.plot.cheniers) || [];
      let cx = 8, cy = 40;
      if (chen.length) { let best = chen[0]; for (const c of chen) if (c.cx < best.cx) best = c; cx = best.cx; cy = best.cy; }
      for (let ring = 0; ring <= 30; ring++) for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        for (const rot of [0, 1]) {
          const tx = cx + dx, ty = cy + dy;
          const r = M.canPlace(state, 'lecture_hall', tx, ty, { rot: rot, ignoreCash: true });
          if (!r.ok && r.reason !== 'Needs a path' && !/^No path within/.test(r.reason)) continue;   // West Hall is scripted: it needs no tie
          const d = dims(row, rot), tiles = BSU.footprintTiles(tx, ty, d.w, d.h);
          if (!tiles || tiles.some(function (i) { return !isLand(state, i) || state.tiles.owner[i] !== -1 || isMound(state, i) || isPreserve(state, i); })) continue;
          const b = newBuilding(state, row, tx, ty, d.w, d.h, rot, { instant: true, _pilings: r.needsPilings }, dayOf(state));
          b.name = 'BSU West Hall';
          state.buildings.push(b);
          for (const i of tiles) { state.tiles.owner[i] = b.id; rewalk(state, i); touch(state, i, 'decor'); }
          dirtyAll(cache(state));
          emit(EV.BUILDING_PLACED, { id: b.id, type: b.type, tx: b.tx, ty: b.ty, w: b.w, h: b.h, cost: 0, pilings: b.pilings });
          onComplete(state, b);
          return { ok: true, id: b.id };
        }
      }
      return { ok: false, reason: 'No room west of the bayou' };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'placeWestHall', e); return { ok: false, reason: 'Cannot place' }; }
  };
  function onComplete(state, b) {
    const c = cache(state);
    if (b.type === 'pond') b.data.stockedDay = b.builtDay + LOCAL.pondStockDays;
    dirtyAll(c);
    emit(EV.BUILDING_COMPLETE, { id: b.id, type: b.type });
  }

  // ---------------------------------------------------------------------------
  // Coverage (GDD §4.11 assignment; ARCHITECTURE §5.6)
  // ---------------------------------------------------------------------------
  function providerUsable(b, day) { return isComplete(b) && !b.flooded && !isClosed(b, day) && b.hp > 0; }
  function recomputeCoverageInner(state) {
    const c = cache(state), day = dayOf(state), cat = catalog();
    const list = M.list(state);
    const prevPowered = new Map(), prevWater = new Map();
    for (const b of list) { prevPowered.set(b.id, b.powered); prevWater.set(b.id, b.watered); }
    const summer = isSummerDraw(state);
    // providers
    const subs = [], towers = [], gens = [];
    for (const b of list) {
      if (b.type === 'substation' && providerUsable(b, day)) subs.push({ b: b, cap: summer ? Math.floor(cat.substation.effects.power.capacity / LOCAL.substationSummerDraw) : cat.substation.effects.power.capacity, used: 0, r: cat.substation.effects.power.radius });
      if (b.type === 'water_tower' && providerUsable(b, day)) towers.push({ b: b, cap: cat.water_tower.effects.water.capacity, used: 0, r: cat.water_tower.effects.water.radius });
      if (b.type === 'generator' && isComplete(b) && !b.flooded && !isClosed(b, day) && fin(b.data.fuelDays, 0) > 0) gens.push(b);
    }
    subs.sort(function (a, b) { return a.b.id - b.b.id; }); towers.sort(function (a, b) { return a.b.id - b.b.id; });
    const consumers = list.filter(function (b) { const row = cat[b.type]; return row && isComplete(b) && (row.needsPower || row.needsWater); }).sort(function (a, b) { return a.id - b.id; });
    c.genPowered.clear();
    let uncovered = 0;
    const assign = function (b, provs, radiusKey) {
      let best = null, bestD = Infinity;
      for (const p of provs) {
        if (p.used >= p.cap) continue;
        const dd = rectDist(b.tx, b.ty, b.w, b.h, p.b.tx, p.b.ty, p.b.w, p.b.h);
        if (dd <= p.r && (dd < bestD || (dd === bestD && p.b.id < best.b.id))) { best = p; bestD = dd; }
      }
      if (best) best.used++;
      return best;
    };
    // power first (towers need it)
    for (const b of consumers) {
      const row = cat[b.type];
      if (!row.needsPower) { b.powered = false; b.provider.power = -1; continue; }
      const p = assign(b, subs, 'r');
      if (p) { b.powered = true; b.provider.power = p.b.id; b.blackout = false; continue; }
      let g = null;
      for (const gb of gens) if (rectDist(b.tx, b.ty, b.w, b.h, gb.tx, gb.ty, gb.w, gb.h) <= PB.generatorRadius) { g = gb; break; }
      if (g) { b.powered = true; b.provider.power = g.id; c.genPowered.set(b.id, g.id); b.blackout = false; continue; }
      b.powered = false;
      b.blackout = prevPowered.get(b.id) === true || b.blackout === true;
      b.provider.power = -1;
      uncovered++;
    }
    for (const t of towers) if (!t.b.powered) t.cap = PB.waterTowerUnpoweredCap;
    for (const b of consumers) {
      const row = cat[b.type];
      if (!row.needsWater) { b.watered = false; b.provider.water = -1; continue; }
      const p = assign(b, towers, 'r');
      if (p) { b.watered = true; b.provider.water = p.b.id; } else { b.watered = false; b.provider.water = -1; uncovered++; }
    }
    // never-served consumers are not "blackout"
    for (const b of consumers) if (b.powered) b.blackout = false;
    // coverage maps for the ghost/overlays
    c.powerCover.fill(0); c.waterCover.fill(0);
    const paint = function (map, p, r) {
      for (let y = p.ty - r; y <= p.ty + p.h - 1 + r; y++) for (let x = p.tx - r; x <= p.tx + p.w - 1 + r; x++) if (BSU.inBounds(x, y)) map[BSU.idx(x, y)] = 1;
    };
    for (const s of subs) paint(c.powerCover, s.b, s.r);
    for (const g of gens) paint(c.powerCover, g, PB.generatorRadius);
    for (const t of towers) paint(c.waterCover, t.b, t.r);
    // provider transitions → power:blackout / power:restored
    const nowActive = new Set(subs.map(function (s) { return s.b.id; }));
    for (const b of list) {
      if (b.type !== 'substation') continue;
      const was = c.providerActive.get(b.id) === true, now = nowActive.has(b.id);
      if (was && !now) {
        const affected = consumers.filter(function (x) { return prevPowered.get(x.id) && !x.powered; }).map(function (x) { return x.id; });
        const cause = b.flooded ? 'flood' : (isClosed(b, day) ? 'wind' : 'unpowered');
        b.blackout = true;
        emit(EV.POWER_BLACKOUT, { provider: b.id, affected: affected, cause: cause });
      } else if (!was && now && c.providerActive.has(b.id)) {
        const affected = consumers.filter(function (x) { return x.provider.power === b.id; }).map(function (x) { return x.id; });
        b.blackout = false;
        emit(EV.POWER_RESTORED, { provider: b.id, affected: affected, cause: 'flood' });
      }
      c.providerActive.set(b.id, now);
    }
    for (const b of list) {
      if (b.type !== 'generator') continue;
      const was = c.providerActive.get(b.id) === true, now = gens.indexOf(b) >= 0;
      if (was && !now && fin(b.data.fuelDays, 0) <= 0) emit(EV.POWER_BLACKOUT, { provider: b.id, affected: consumers.filter(function (x) { return prevPowered.get(x.id) && !x.powered; }).map(function (x) { return x.id; }), cause: 'fuel' });
      c.providerActive.set(b.id, now);
    }
    c.uncovered = uncovered;
    c.brownout = uncovered > 0 && (subs.length > 0 || towers.length > 0);
    c.coverageDirty = false;
    c.aurasDirty = true; c.statsCache = null;
    emit(EV.COVERAGE_CHANGED, {});
  }
  M.recomputeCoverage = function (state) {
    try { if (state && Array.isArray(state.buildings)) recomputeCoverageInner(state); }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'recomputeCoverage', e); }
  };
  /** gators within 2 of the footprint this tick (transient) */
  M.gatorClosed = function (state, id) {
    try {
      const c = cache(state), b = M.get(state, id);
      if (!b) return false;
      const tick = fin(state.tick, 0);
      if (c.gatorClosedTick !== tick) {
        c.gatorClosedTick = tick; c.gatorClosedIds.clear();
        const gators = call('wildlife', 'onCampus', [state], []) || [];
        if (gators.length) for (const x of M.list(state)) {
          for (const g of gators) { if (g && isNum(g.tx) && isNum(g.ty) && tileDist(Math.floor(g.tx), Math.floor(g.ty), x) <= P.wildlife.gator.closeRadius) { c.gatorClosedIds.add(x.id); break; } }
        }
      }
      return c.gatorClosedIds.has(id);
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'gatorClosed', e); return false; }
  };
  /** §4.11 multiplier: 1 / 0.5 / 0; always 1 while economy.suppressCoverage (D28) */
  M.effective = function (state, id) {
    try {
      const b = M.get(state, id);
      if (!b || !(b.built >= 1) || b.ruin || b.flooded || isClosed(b, dayOf(state)) || M.gatorClosed(state, id)) return 0;
      if (state.economy && state.economy.suppressCoverage) return 1;
      const row = rowOf(b.type); if (!row) return 1;
      const np = row.needsPower && !b.powered, nw = row.needsWater && !b.watered;
      if (b.type === 'pump') return np ? 0 : 1;
      if (np && nw) return 0;
      if (np || nw) return 0.5;
      return 1;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'effective', e); return 0; }
  };

  // ---------------------------------------------------------------------------
  // Auras (the sampled happiness terms: GDD §5.6, §7) and coverage(kind)
  // ---------------------------------------------------------------------------
  function inBloom(state) {
    const d = BSU.dayParts(dayOf(state)), y = d.year;
    const a = BSU.dateToDay(P.weather.azaleaBloom.start, y), b = BSU.dateToDay(P.weather.azaleaBloom.end, y);
    return isNum(a) && isNum(b) && d.day >= a && d.day <= b;
  }
  /** visit every tile within Chebyshev r of a footprint rect */
  function forRadius(tx, ty, w, h, r, fn) {
    for (let y = ty - r; y <= ty + h - 1 + r; y++) { if (y < 0 || y >= H) continue; for (let x = tx - r; x <= tx + w - 1 + r; x++) { if (x < 0 || x >= W) continue; fn(y * W + x); } }
  }
  function rebuildAuras(state) {
    const c = cache(state), A = c.auras, cat = catalog();
    A.life.fill(0); A.green.fill(0); A.dining.fill(0); A.shade.fill(0); A.heat.fill(1); A.mosq.fill(0); A.noise.fill(0);
    const quad = new Float32Array(N);
    const shadeMiss = new Float32Array(N); shadeMiss.fill(1);
    for (const b of M.list(state)) {
      const row = cat[b.type]; if (!row || !isComplete(b)) continue;
      const eff = M.effective(state, b.id); if (eff <= 0) continue;
      const hp = row.effects.happiness;
      if (b.type === 'quad') {
        forRadius(b.tx, b.ty, b.w, b.h, hp.radius, function (i) { quad[i] = Math.min(LOCAL.quadStackCap, quad[i] + LOCAL.quadValue * eff); });
        forRadius(b.tx, b.ty, 1, 1, P.heat.oakRadius, function (i) { shadeMiss[i] *= 1 - P.heat.oakShade; });
      } else if (b.type === 'pond' || b.type === 'rookery') {
        if (hp.radius > 0) forRadius(b.tx, b.ty, b.w, b.h, hp.radius, function (i) { A.green[i] += hp.value * eff; });
      } else if (hp.radius > 0 && hp.value > 0) {
        forRadius(b.tx, b.ty, b.w, b.h, hp.radius, function (i) { const v = hp.value * eff; if (v > A.life[i]) A.life[i] = v; });
      }
      if (row.effects.feeds > 0 && row.effects.diningRadius > 0) forRadius(b.tx, b.ty, b.w, b.h, row.effects.diningRadius, function (i) { A.dining[i] = 1; });
      if (row.effects.heat.radius > 0 && row.effects.heat.mult > 0) forRadius(b.tx, b.ty, b.w, b.h, row.effects.heat.radius, function (i) { A.heat[i] = Math.min(A.heat[i], row.effects.heat.mult); });
    }
    const bloom = inBloom(state);
    for (const v of (state.veg || [])) {
      if (!v || !BSU.inBounds(v.tx, v.ty)) continue;
      if (v.type === 'oak' && v.stage >= LOCAL.oakStageForEffect) {
        forRadius(v.tx, v.ty, 1, 1, cat.live_oak ? cat.live_oak.effects.happiness.radius : 4, function (i) { A.green[i] += 1; });
        forRadius(v.tx, v.ty, 1, 1, P.heat.oakRadius, function (i) { shadeMiss[i] *= 1 - P.heat.oakShade; });
      } else if (v.type === 'azalea') {
        const val = (cat.azalea ? cat.azalea.effects.happiness.value : 1) + (bloom && v.stage > 0 ? LOCAL.azaleaBloomBonus : 0);
        forRadius(v.tx, v.ty, 1, 1, cat.azalea ? cat.azalea.effects.happiness.radius : 3, function (i) { A.green[i] += val; });
      }
    }
    for (let i = 0; i < N; i++) { A.green[i] += quad[i]; A.shade[i] = Math.min(P.heat.shadeCap, 1 - shadeMiss[i]); }
    c.aurasDirty = false;
  }
  /** {life, green, dining, shade, heat, mosq, noise} typed arrays; rebuilt when dirty */
  M.auras = function (state) {
    const c = cache(state);
    try { if (c.aurasDirty) rebuildAuras(state); } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'auras', e); }
    return c.auras;
  };
  /** the aura value at a tile; 'power'/'water' → 0/1 (inside an active provider's radius) */
  M.coverage = function (state, kind, tx, ty) {
    try {
      if (!BSU.inBounds(tx, ty)) return 0;
      const i = BSU.idx(tx, ty), c = cache(state);
      if (kind === 'power') return c.powerCover[i] ? 1 : 0;
      if (kind === 'water') return c.waterCover[i] ? 1 : 0;
      const A = M.auras(state);
      if (kind === 'happiness') return A.life[i];
      if (kind === 'mosquito') return A.mosq[i];
      if (A[kind]) return fin(A[kind][i], 0);
      return 0;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'coverage', e); return 0; }
  };

  // ---------------------------------------------------------------------------
  // stats(), upkeepTotal(), shelter() — economy reads these daily
  // ---------------------------------------------------------------------------
  function oakAdjacentTo(state, i) {
    const tx = i & 63, ty = i >> 6;
    for (const v of (state.veg || [])) if (v && v.type === 'oak' && cheb(v.tx, v.ty, tx, ty) <= 1) return true;
    return false;
  }
  function computeStats(state) {
    const cat = catalog(), day = dayOf(state), c = cache(state), tl = state.tiles;
    const s = {
      beds: 0, seats: 0, feeds: 0, diningCovered: 0, landmarks: 0, oaks: 0, cypress: 0, stockedPonds: 0, posts: 0, quality: 0, lots: 0,
      unrepaired: 0, floodedCore: false, powerRadiusHits: 0, generatorsRunning: c.generatorsRunning, brownout: c.brownout, pumpsRunning: 0,
      shelter: null, academicFlags: { library: false, engineering: false, coastal: false },
      roadAdjacentDorms: 0, pumpsNearDorms: 0, barriersNearDorms: 0, floodwallDormsNoOak: 0, wastewaterPlants: 0, parkingLots: 0,
      bridges: 0, buildingValue: 0, research: 0, landmarkList: []
    };
    const A = M.auras(state);
    let qualW = 0, housingTiles = 0, housingDining = 0;
    const list = M.list(state);
    const pumps = list.filter(function (b) { return b.type === 'pump' && isComplete(b); });
    const barriers = list.filter(function (b) { return b.type === 'surge_barrier'; });
    for (const b of list) {
      const row = cat[b.type]; if (!row) continue;
      if (b.hp < 1 && b.built >= 1) s.unrepaired++;
      if (!isComplete(b)) continue;
      const eff = M.effective(state, b.id);
      const tr = tierRow(row, b);
      s.beds += row.effects.beds * eff;
      s.seats += row.effects.seats * eff;
      s.feeds += row.effects.feeds * eff;
      s.landmarks += tr ? tr.landmark : row.effects.landmark;
      s.buildingValue += row.cost + (row.tiers.slice(0, b.tier).reduce(function (a, t) { return a + t.cost; }, 0));
      if (row.effects.beds > 0) { qualW += row.effects.beds * eff; s.quality += row.effects.quality * row.effects.beds * eff; }
      if (b.type === 'quad') s.oaks++;
      if (b.type === 'pond' && b.data.stockedDay >= 0 && day >= b.data.stockedDay) s.stockedPonds++;
      if (b.type === 'wildlife_post') s.posts++;
      if (b.type === 'parking') s.lots++;
      if (b.type === 'wastewater') s.wastewaterPlants++;
      if (b.type === 'library') s.academicFlags.library = true;
      if (b.type === 'engineering') s.academicFlags.engineering = true;
      if (b.type === 'coastal_institute') s.academicFlags.coastal = true;
      if (row.needsPower && b.powered) s.powerRadiusHits++;
      if (isCoreRow(b.type) && b.flooded && b.floodedSince >= 0 && b.floodedSince <= day - LOCAL.floodedCoreDays) s.floodedCore = true;
      if (b.type === 'pump' && call('hydro', 'pumpRunning', [state, b.id], false) === true) s.pumpsRunning++;
      if (isHousingRow(row)) {
        let road = false, fw = false;
        for (const e of BSU.edgeTiles(b.tx, b.ty, b.w, b.h)) if (tl.surface[e] === SURF.ROAD) road = true;
        if (road) s.roadAdjacentDorms++;
        if (pumps.some(function (p) { return rectDist(b.tx, b.ty, b.w, b.h, p.tx, p.ty, p.w, p.h) <= PE.happiness.noisePumpRadius; })) s.pumpsNearDorms++;
        if (barriers.some(function (p) { return rectDist(b.tx, b.ty, b.w, b.h, p.tx, p.ty, p.w, p.h) <= PE.happiness.noiseBarrierRadius; })) s.barriersNearDorms++;
        forRadius(b.tx, b.ty, b.w, b.h, PE.happiness.floodwallRadius, function (i) { if (!fw && tl.crest[i] === 12 && !oakAdjacentTo(state, i)) fw = true; });
        if (fw) s.floodwallDormsNoOak++;
        for (const i of footprintOf(b)) { housingTiles++; if (A.dining[i]) housingDining++; }
      }
    }
    for (const v of (state.veg || [])) { if (!v) continue; if (v.type === 'oak') s.oaks++; if (v.type === 'cypress') s.cypress++; }
    s.quality = qualW > 0 ? s.quality / qualW : 0;
    s.diningCovered = housingTiles > 0 ? housingDining / housingTiles : 0;
    s.parkingLots = s.lots;
    for (const m of ((state.plot && state.plot.mounds) || [])) { let reached = false; for (const n of BSU.nbr4(m)) if (isAccessSurface(tl.surface[n])) reached = true; if (reached) { s.landmarks += PE.landmarks.mounds; break; } }
    if (state.economy && state.economy.westCampus) s.landmarks += PE.landmarks.west;
    for (let i = 0; i < N; i++) if ((tl.surface[i] === SURF.ROAD && (tl.flags[i] & (FLAG.BAYOU | FLAG.OPEN_WATER))) || tl.surface[i] === SURF.BRIDGE) s.bridges++;
    s.beds = Math.round(s.beds); s.seats = Math.round(s.seats); s.feeds = Math.round(s.feeds);
    s.shelter = M.shelter(state);
    return s;
  }
  /** cached per (root, calendar.day) and invalidated by every write; self-heals on a new root */
  M.stats = function (state) {
    const c = cache(state), day = dayOf(state);
    try { if (!c.statsCache || c.statsDay !== day) { c.statsCache = computeStats(state); c.statsDay = day; } }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'stats', e); if (!c.statsCache) c.statsCache = { beds: 0, seats: 0, feeds: 0, diningCovered: 0, landmarks: 0, oaks: 0, cypress: 0, stockedPonds: 0, posts: 0, quality: 0, lots: 0, unrepaired: 0, floodedCore: false, powerRadiusHits: 0, generatorsRunning: 0, brownout: false, pumpsRunning: 0, shelter: { capacity: 0, students: 0, ok: true, lines: [] }, academicFlags: { library: false, engineering: false, coastal: false }, roadAdjacentDorms: 0, pumpsNearDorms: 0, barriersNearDorms: 0, floodwallDormsNoOak: 0, wastewaterPlants: 0, parkingLots: 0, bridges: 0, buildingValue: 0 }; }
    return c.statsCache;
  };
  /** Σ building upkeep (tier rows; pilings +5%; post ×.5 with postUpkeepHalf) + per-tile drag upkeep + azalea $100 */
  M.upkeepTotal = function (state) {
    try {
      const cat = catalog(); let sum = 0;
      const halfPost = !!timer(state, 'postUpkeepHalf');
      for (const b of M.list(state)) {
        const row = cat[b.type]; if (!row || !isComplete(b)) continue;
        const tr = tierRow(row, b);
        let u = tr ? tr.upkeep : row.upkeep;
        if (b.type === 'practice_field' && tr) u = row.upkeep + tr.upkeep;   // "+$4k with the bleachers"
        if (b.pilings) u *= 1 + PB.pilingsUpkeep;
        if (b.type === 'wildlife_post' && halfPost) u *= P.progress.milestoneEffects.wranglerUpkeep;
        sum += u;
      }
      const tl = state.tiles;
      const per = { road: cat.road ? cat.road.upkeep : 100, boardwalk: cat.boardwalk ? cat.boardwalk.upkeep : 150, bridge: cat.bridge ? cat.bridge.upkeep : 300, fence: cat.gator_fence ? cat.gator_fence.upkeep : 80, levee: cat.levee ? cat.levee.upkeep : 400, floodwall: cat.floodwall ? cat.floodwall.upkeep : 900, canal: cat.canal ? cat.canal.upkeep : 500 };
      for (let i = 0; i < N; i++) {
        const s = tl.surface[i];
        if (s === SURF.ROAD) sum += per.road; else if (s === SURF.BOARDWALK) sum += per.boardwalk; else if (s === SURF.BRIDGE) sum += per.bridge; else if (s === SURF.FENCE) sum += per.fence;
        if (tl.crest[i] === 12) sum += per.floodwall; else if (tl.crest[i] > 0) sum += per.levee;
        if (tl.flags[i] & FLAG.CANAL) sum += per.canal;
      }
      const az = cat.azalea ? cat.azalea.upkeep : 100;
      for (const v of (state.veg || [])) if (v && v.type === 'azalea') sum += az;
      return Math.round(sum);
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'upkeepTotal', e); return 0; }
  };
  /** declared emergency: a storm exists with a cone (phase ≥ NAMED) up to T+1 */
  function emergencyDeclared(state) {
    const st = state.storms && state.storms.current;
    if (!st) return false;
    if (st.phase >= BSU.STORM.NAMED && st.phase <= BSU.STORM.LANDFALL) return true;
    if (st.phase === BSU.STORM.RECOVERY && fin(state.storms.lastLandfallDay, -1) >= 0 && dayOf(state) <= state.storms.lastLandfallDay + 1) return true;
    return false;
  }
  function shelterCapacityOf(state, b, row, emergency) {
    if (!isComplete(b) || b.flooded || M.effective(state, b.id) <= 0) return 0;
    if (b.type === 'founders_hall') return emergency ? PS.foundersEmergency : row.effects.shelter;
    const tr = tierRow(row, b);
    if (tr) return tr.shelter;
    if (row.shelterOwn) {
      const highAndDry = b.pilings || footprintOf(b).every(function (i) { return state.tiles.elev[i] >= P.terrain.crownElev; });
      return highAndDry ? row.effects.beds : 0;
    }
    return row.effects.shelter;
  }
  /** {capacity, students, ok, lines} — the Storm panel's shelter block (GDD §4.11) */
  M.shelter = function (state) {
    try {
      const cat = catalog(), emergency = emergencyDeclared(state);
      let capacity = 0; const lines = [];
      const st = state.storms && state.storms.current;
      for (const b of M.list(state)) {
        const row = cat[b.type]; if (!row) continue;
        let cap = shelterCapacityOf(state, b, row, emergency);
        if (cap <= 0) continue;
        if (row.shelterOwn) cap = Math.min(cap, row.effects.beds);
        capacity += cap;
        lines.push(b.name + ': ' + cap.toLocaleString('en-US') + (row.shelterOwn ? ' residents' : ''));
      }
      if (st && st.shelterOverflow) { capacity += PS.shelterOverflow; lines.push('Dining Hall overflow: ' + PS.shelterOverflow); }
      const students = (st && st.evacuated) ? 0 : Math.round(fin(state.economy && state.economy.students, 0));
      return { capacity: capacity, students: students, ok: capacity >= students, lines: lines };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'shelter', e); return { capacity: 0, students: 0, ok: false, lines: [] }; }
  };
  /** {buildingId: capacity} of every usable shelter (weather forwards this to agents.shelter, D41) */
  M.shelterAssignments = function (state) {
    const out = {};
    try {
      const cat = catalog(), emergency = emergencyDeclared(state);
      for (const b of M.list(state)) {
        const row = cat[b.type]; if (!row) continue;
        let cap = shelterCapacityOf(state, b, row, emergency);
        if (row.shelterOwn) cap = Math.min(cap, row.effects.beds);
        if (cap > 0) out[b.id] = cap;
      }
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'shelterAssignments', e); }
    return out;
  };
  /** landfall shelter toast 'yes': the Dining Hall closes 3 days; storm.shelterOverflow = true */
  M.shelterOverflow = function (state) {
    try {
      const day = dayOf(state);
      const dh = M.list(state, 'dining_hall').find(isComplete);
      if (dh) dh.closedUntil = Math.max(dh.closedUntil, day + PS.shelterClosedDays);
      if (state.storms && state.storms.current) state.storms.current.shelterOverflow = true;
      dirtyAll(cache(state));
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'shelterOverflow', e); }
  };
  /** tracked from landfall to T+1: a Water Tower flooded or unpowered at any check */
  M.boilWaterTriggered = function (state) { return cache(state).boilWaterFlag === true; };
  M.clearBoilWater = function (state) { const c = cache(state); c.boilWaterFlag = false; c.boilWindow = false; };
  function checkBoilWater(state) {
    const c = cache(state);
    if (!c.boilWindow) return;
    for (const b of M.list(state, 'water_tower')) if (isComplete(b) && (b.flooded || !b.powered)) { c.boilWaterFlag = true; break; }
    const last = fin(state.storms && state.storms.lastLandfallDay, -1);
    if (!state.setPiece && last >= 0 && dayOf(state) > last + 1) c.boilWindow = false;
  }

  // ---------------------------------------------------------------------------
  // Rings, protection and gaps (GDD §6.2 "the one definition"; ARCHITECTURE §5.6)
  // ---------------------------------------------------------------------------
  function integrityFactor(integ) { return integ >= PH.integrityHalf ? 1 : (integ > 0 ? 0.5 : 0); }
  /** static effective head of tile i (override: Map<i, {crest, integrity}> for the ghost scratch) */
  function effectiveHead(tl, i, override) {
    let crest = tl.crest[i], integ = tl.integrity[i];
    if (override && override.has(i)) { const o = override.get(i); crest = o.crest; integ = o.integrity; }
    const f = tl.flags[i];
    if (f & FLAG.JAMMED) crest = 0;
    else if ((f & FLAG.FLOODGATE) && integ >= PH.integrityHalf) return tl.elev[i] + crest + tl.sandbag[i] / 10;
    return tl.elev[i] + crest * integrityFactor(integ) + tl.sandbag[i] / 10;
  }
  /** bayou tiles upstream of an existing Surge Barrier (smaller spline index) are not surge sources */
  function upstreamCut(state) {
    const bayou = (state.plot && state.plot.bayou) || [];
    let cut = -1;
    for (const b of M.list(state, 'surge_barrier')) for (const i of footprintOf(b)) { const k = bayou.indexOf(i); if (k >= 0 && (cut < 0 || k < cut)) cut = k; }
    return cut;
  }
  /** one BFS over the map: 1 = reached at test height H */
  function floodFill(state, Hft, override) {
    const tl = state.tiles, c = cache(state), out = new Uint8Array(N), q = c.scratchQueue;
    const cut = upstreamCut(state);
    const bayou = cut >= 0 ? (state.plot.bayou || []) : null;
    let head = 0, tail = 0;
    const seed = function (i) { if (!out[i] && effectiveHead(tl, i, override) <= Hft) { out[i] = 1; q[tail++] = i; } };
    for (let i = 0; i < N; i++) {
      const f = tl.flags[i];
      const water = (f & FLAG.OPEN_WATER) || tl.type[i] === T.OPEN_WATER;
      let bay = (f & FLAG.BAYOU) || tl.type[i] === T.BAYOU;
      if (bay && bayou) { const k = bayou.indexOf(i); if (k >= 0 && k < cut) bay = false; }
      const tx = i & 63, ty = i >> 6;
      const edge = tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1;
      if (water || bay || edge) seed(i);
    }
    while (head < tail) {
      const i = q[head++], tx = i & 63, ty = i >> 6;
      if (ty > 0) seed(i - W);
      if (tx < W - 1) seed(i + 1);
      if (ty < H - 1) seed(i + W);
      if (tx > 0) seed(i - 1);
    }
    return out;
  }
  function protectionInner(state, Hft) {
    const c = cache(state);
    if (c.ringDirty) { c.ringCache.clear(); c.gapCache.clear(); c.ringDirty = false; }
    let m = c.ringCache.get(Hft);
    if (!m) {
      m = floodFill(state, Hft, null);
      c.ringCache.set(Hft, m);
      if (Hft === PS.ringDefaultH && c.ringEmitPending) {
        c.ringEmitPending = false;
        const g = gapsInner(state, Hft, m);
        emit(EV.RING_CHANGED, { H: Hft, closed: ringClosedFrom(state, m), gaps: g.gaps.length });
      }
    }
    return m;
  }
  /** Uint8Array (1 = reached); cached per H until dirtyRing */
  M.protection = function (state, Hft) {
    try { return protectionInner(state, fin(Hft, PS.ringDefaultH)); }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'protection', e); return new Uint8Array(N); }
  };
  function ringClosedFrom(state, m) {
    let core = 0;
    for (const b of M.list(state)) {
      if (!isCoreRow(b.type)) continue;
      core++;
      for (const i of footprintOf(b)) if (m[i]) return false;
    }
    return core > 0;
  }
  /** every core building (Founders' + every ⚡ row) unreached at H */
  M.ringClosed = function (state, Hft) {
    try { return ringClosedFrom(state, protectionInner(state, fin(Hft, PS.ringDefaultH))); }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'ringClosed', e); return false; }
  };
  /** Objective 11: every G2 cove tile unreached */
  M.coveTilesUnreached = function (state, Hft) {
    try {
      const cove = (state.plot && state.plot.cove) || [];
      if (!cove.length) return false;
      const m = protectionInner(state, fin(Hft, PS.ringDefaultH));
      for (const i of cove) if (m[i]) return false;
      return true;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'coveTilesUnreached', e); return false; }
  };
  function boundaryFrom(state, m) {
    const tl = state.tiles, out = [];
    for (let i = 0; i < N; i++) {
      if (tl.crest[i] === 0) continue;
      let r = false, u = false;
      for (const n of BSU.nbr4(i)) { if (m[n]) r = true; else u = true; }
      if ((r && u) || (m[i] && u)) out.push(i);
    }
    return out;
  }
  /** levee/floodwall tiles on the reached/unreached edge at H */
  M.boundaryLevees = function (state, Hft) {
    try { return boundaryFrom(state, protectionInner(state, fin(Hft, PS.ringDefaultH))); }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'boundaryLevees', e); return []; }
  };
  /** name a gap by the nearest landmark (cove mouth, shoulders, bayou bank, river bank, chenier) or '(x, y)' */
  function gapName(state, cx, cy) {
    const plot = state.plot || {};
    const cands = [];
    if (plot.mouth && plot.mouth.length >= 2 && plot.mouth[1] >= 0) cands.push({ n: 'the cove mouth', x: plot.mouth[1] & 63, y: plot.mouth[1] >> 6 });
    if (isNum(plot.bank0)) { cands.push({ n: 'the south shoulder', x: plot.bank0 - 9, y: 14 }); cands.push({ n: 'the north shoulder', x: plot.bank0 - 9, y: 5 }); }
    let bestBay = null;
    for (const i of (plot.bayou || [])) { const d = cheb(i & 63, i >> 6, cx, cy); if (!bestBay || d < bestBay.d) bestBay = { d: d, x: i & 63, y: i >> 6 }; }
    if (bestBay) cands.push({ n: 'the bayou bank', x: bestBay.x, y: bestBay.y });
    cands.push({ n: 'the river bank', x: BSU.bankAt(cy), y: cy });
    for (const ch of (plot.cheniers || [])) cands.push({ n: 'the chenier', x: ch.cx, y: ch.cy });
    let best = null;
    for (const k of cands) { const d = cheb(k.x, k.y, cx, cy); if (!best || d < best.d) best = { d: d, n: k.n }; }
    if (best && best.d <= PS.gapSearchRadius) return best.n;
    return '(' + cx + ', ' + cy + ')';
  }
  /** Gap runs on a reached mask. A gap is where the wall line is open: the continuation tile past a
   *  wall endpoint that the water reaches, an overtopped/halved wall tile (reached crest), and the
   *  straight line of reached open tiles joining two such points within gapSearchRadius. A closed ring
   *  (every endpoint continues into unreached ground) reports none. crestAt(i) lets the drag preview add tiles. */
  function gapRuns(state, m, crestAt) {
    const tl = state.tiles, c = cache(state), R = PS.gapSearchRadius;
    const openTile = function (i) { return m[i] === 1 && !crestAt(i) && isLand(state, i); };
    const cand = new Uint8Array(N);
    const points = [];
    for (let i = 0; i < N; i++) {
      if (!crestAt(i)) continue;
      if (m[i]) { cand[i] = 1; points.push(i); continue; }             // overtopped / halved wall tile
      const tx = i & 63, ty = i >> 6, nb = [];
      for (const n of BSU.nbr4(i)) if (crestAt(n)) nb.push(n);
      if (nb.length > 1) continue;                                      // interior of a wall segment
      const conts = [];
      if (nb.length === 1) { const cx = tx + (tx - (nb[0] & 63)), cy = ty + (ty - (nb[0] >> 6)); if (BSU.inBounds(cx, cy)) conts.push(BSU.idx(cx, cy)); }
      else for (const n of BSU.nbr4(i)) conts.push(n);
      for (const t of conts) if (openTile(t) && !cand[t]) { cand[t] = 1; points.push(t); }
    }
    // join candidate pairs by a straight run of reached open tiles
    for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
      const pa = points[a], pb = points[b];
      const ax = pa & 63, ay = pa >> 6, bx = pb & 63, by = pb >> 6;
      const d = cheb(ax, ay, bx, by);
      if (d < 2 || d > R) continue;
      const line = []; let okLine = true;
      for (let k = 1; k < d; k++) {
        const x = Math.round(ax + (bx - ax) * k / d), y = Math.round(ay + (by - ay) * k / d), t = BSU.idx(x, y);
        if (cand[t]) continue;
        if (!openTile(t)) { okLine = false; break; }
        line.push(t);
      }
      if (okLine) for (const t of line) cand[t] = 1;
    }
    // 8-connected runs
    const gaps = [], seen = new Uint8Array(N), q = c.scratchQueue;
    for (let s0 = 0; s0 < N; s0++) {
      if (!cand[s0] || seen[s0]) continue;
      let head = 0, tail = 0; q[tail++] = s0; seen[s0] = 1;
      const tiles = [];
      while (head < tail) {
        const i = q[head++]; tiles.push(i);
        for (const n of BSU.nbr8(i)) if (cand[n] && !seen[n]) { seen[n] = 1; q[tail++] = n; }
      }
      let sx = 0, sy = 0; for (const i of tiles) { sx += i & 63; sy += i >> 6; }
      const cx = Math.round(sx / tiles.length), cy = Math.round(sy / tiles.length);
      gaps.push({ tiles: tiles, len: tiles.length, cx: cx, cy: cy, name: gapName(state, cx, cy) });
    }
    gaps.sort(function (a, b) { return a.len - b.len || a.tiles[0] - b.tiles[0]; });
    return gaps;
  }
  function gapsInner(state, Hft, m) {
    const c = cache(state);
    const cached = c.gapCache.get(Hft);
    if (cached) return cached;
    const tl = state.tiles;
    const gaps = gapRuns(state, m, function (i) { return tl.crest[i] > 0; });
    const boundary = boundaryFrom(state, m);
    const weak = [], gates = [];
    for (const i of boundary) {
      if (tl.integrity[i] < PS.weakIntegrity) weak.push({ i: i, integrity: tl.integrity[i] });
      if (tl.flags[i] & FLAG.FLOODGATE) gates.push({ i: i, jammed: (tl.flags[i] & FLAG.JAMMED) !== 0 });
    }
    const reachedBuildings = [];
    for (const b of M.list(state)) {
      let hit = false, lo = Infinity;
      for (const i of footprintOf(b)) { if (m[i]) hit = true; if (tl.elev[i] < lo) lo = tl.elev[i]; }
      if (hit) reachedBuildings.push({ id: b.id, depth: Math.round((Hft - lo) * 100) / 100 });
    }
    const res = { gaps: gaps, weak: weak, gates: gates, reachedBuildings: reachedBuildings };
    c.gapCache.set(Hft, res);
    return res;
  }
  /** {gaps, weak, gates, reachedBuildings} at H (GDD §6.2 Rings) */
  M.gaps = function (state, Hft) {
    try { const h = fin(Hft, PS.ringDefaultH); return gapsInner(state, h, protectionInner(state, h)); }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'gaps', e); return { gaps: [], weak: [], gates: [], reachedBuildings: [] }; }
  };
  /** levee/floodwall drag preview: the fill on a scratch with the dragged crests added */
  function ringPreview(state, row, run) {
    const st = state.storms && state.storms.current;
    const Hft = st ? fin(call('weather', 'forecastSurge', [state], PS.surge[Math.min(5, Math.max(0, fin(st.forecastCat, st.cat)))]), PS.ringDefaultH) : PS.ringDefaultH;
    const override = new Map();
    for (const i of run) if (Number.isInteger(i) && i >= 0 && i < N && state.tiles.crest[i] === 0 && isLand(state, i) && state.tiles.owner[i] === -1 && !isPreserve(state, i) && !isMound(state, i)) override.set(i, { crest: row.effects.crest, integrity: 100 });
    const m = floodFill(state, Hft, override);
    const closes = ringClosedFrom(state, m);
    const cove = (state.plot && state.plot.cove) || [];
    const coveOk = cove.length > 0 && !cove.some(function (i) { return m[i]; });
    if (closes || coveOk) return { closes: true, short: 0, where: '' };
    // the smallest remaining gap on the scratch (not cached: a scratch is transient)
    const tl = state.tiles;
    const gaps = gapRuns(state, m, function (i) { return tl.crest[i] > 0 || override.has(i); });
    if (!gaps.length) return { closes: false, short: 0, where: '' };
    return { closes: false, short: gaps[0].len, where: gaps[0].name };
  }
  /** invalidate the protection / gap / run caches (hydro and wildlife call this after integrity or gate changes) */
  M.dirtyRing = function (state) {
    const c = cache(state);
    c.ringDirty = true; c.ringEmitPending = true; c.ringCache.clear(); c.gapCache.clear(); c.runCache = null; c.statsCache = null;
  };
  /** after any integrity write by hydro / wildlife / this module */
  M.onIntegrityChanged = function (state, i) {
    try {
      M.dirtyRing(state);
      if (Number.isInteger(i) && i >= 0 && i < N && state.tiles.integrity[i] < PH.integrityHalf) touch(state, i, 'crest');
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'onIntegrityChanged', e); }
  };
  /** 4-connected runs of crest > 0; runs ≥ 20 tiles are named in state.runNames['levee:' + lowest] */
  M.leveeRuns = function (state) {
    try {
      const c = cache(state);
      if (c.runCache) return c.runCache;
      const tl = state.tiles, seen = new Uint8Array(N), q = c.scratchQueue, runs = [];
      for (let s0 = 0; s0 < N; s0++) {
        if (tl.crest[s0] === 0 || seen[s0]) continue;
        let head = 0, tail = 0; q[tail++] = s0; seen[s0] = 1; const tiles = [];
        while (head < tail) { const i = q[head++]; tiles.push(i); for (const n of BSU.nbr4(i)) if (tl.crest[n] > 0 && !seen[n]) { seen[n] = 1; q[tail++] = n; } }
        tiles.sort(function (a, b) { return a - b; });
        runs.push({ key: 'levee:' + tiles[0], tiles: tiles, name: '' });
      }
      const pool = names().leveeRun || ['The Great Wall of Boudreaux'];
      const used = new Set();
      for (const k of Object.keys(state.runNames)) if (k.indexOf('levee:') === 0) used.add(state.runNames[k]);
      for (const r of runs) {
        if (r.tiles.length >= 20) {
          if (!state.runNames[r.key]) {
            let k = 0, nm;
            do { nm = pool[k % pool.length] + roman(Math.floor(k / pool.length)); k++; } while (used.has(nm) && k < 200);
            state.runNames[r.key] = nm; used.add(nm);
          }
          r.name = state.runNames[r.key];
        } else r.name = state.runNames[r.key] || '';
      }
      c.runCache = runs;
      return runs;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'leveeRuns', e); return []; }
  };
  /** Sandbags: every boundary levee tile at H gets +1.5 ft for 5 days; cost ceil(n/10) × $10k (opts.free from the toast) */
  M.sandbags = function (state, Hft, opts) {
    opts = opts || {};
    try {
      const tiles = M.boundaryLevees(state, fin(Hft, PS.ringDefaultH));
      if (!tiles.length) return { ok: false, cost: 0, tiles: [], reason: 'No levee on the boundary' };
      const cost = opts.free ? 0 : Math.ceil(tiles.length / PS.sandbagPer) * PS.sandbagCost;
      if (cost > 0 && !charge(state, cost, 'prep', { i: tiles[0] })) return { ok: false, cost: cost, tiles: [], reason: 'Not enough cash' };
      const day = dayOf(state);
      for (const i of tiles) { state.tiles.sandbag[i] = PS.sandbagTenths; state.tiles.sandbagDay[i] = Math.min(65535, day + PS.sandbagDays); markLeveeChange(state, i); }
      if (state.storms && state.storms.current) state.storms.current.sandbagged = true;
      M.dirtyRing(state);
      return { ok: true, cost: cost, tiles: tiles };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'sandbags', e); return { ok: false, cost: 0, tiles: [], reason: 'Cannot sandbag' }; }
  };

  // ---------------------------------------------------------------------------
  // Damage, repair, wind, board-up, subsidence, the damage report (GDD §5.3, §6.1.6, §6.2)
  // ---------------------------------------------------------------------------
  function damage(state, b, amount, cause) {
    if (!(amount > 0)) return;
    b.hp = Math.max(0, Math.min(1, fin(b.hp, 1) - amount));
    b.tarp = b.hp < 1;
    if (b.hp <= 0 && !b.ruin) { b.ruin = true; dirtyAll(cache(state)); for (const i of footprintOf(b)) touch(state, i, 'decor'); }
    cache(state).statsCache = null;
    emit(EV.BUILDING_DAMAGED, { id: b.id, type: b.type, hp: b.hp, cause: cause });
  }
  function repairCostOf(b) {
    const row = rowOf(b.type); if (!row) return 0;
    if (b.ruin) return Math.round(row.cost * PB.ruinRebuild);
    return Math.round((1 - fin(b.hp, 1)) * row.cost * PE.repairMult);
  }
  /** (1 − hp) × cost × 0.6; a ruin is rebuilt at 60% */
  M.repair = function (state, id) {
    try {
      const b = M.get(state, id);
      if (!b) return { ok: false, cost: 0, reason: 'Pick a building' };
      if (b.hp >= 1 && !b.ruin) return { ok: false, cost: 0, reason: 'Nothing to repair' };
      const cost = repairCostOf(b);
      if (!charge(state, cost, 'repair', { i: BSU.idx(b.tx, b.ty) })) return { ok: false, cost: cost, reason: 'Not enough cash' };
      b.hp = 1; b.tarp = false;
      if (b.ruin) { b.ruin = false; }
      for (const i of footprintOf(b)) touch(state, i, 'decor');
      dirtyAll(cache(state));
      emit(EV.BUILDING_REPAIRED, { id: b.id, cost: cost });
      return { ok: true, cost: cost };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'repair', e); return { ok: false, cost: 0, reason: 'Cannot repair' }; }
  };
  M.repairAll = function (state) {
    try {
      let total = 0, any = false;
      for (const b of M.list(state)) { if (b.hp < 1 || b.ruin) { const r = M.repair(state, b.id); if (r.ok) { total += r.cost; any = true; } } }
      const c = cache(state);
      if (c.toppled.length) {
        const bill = PS.towerToppleCost * c.toppled.length;
        if (charge(state, bill, 'repair', {})) { total += bill; any = true; for (const id of c.toppled) { const t = M.get(state, id); if (t) { t.blackout = false; t.closedUntil = -1; } } c.toppled = []; c.coverageDirty = true; }
      }
      const lv = M.repairAllLevees(state);
      if (lv.ok) { total += lv.cost; any = true; }
      return { ok: any, cost: total };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'repairAll', e); return { ok: false, cost: 0 }; }
  };
  /** $5k per levee tile below 100 */
  M.repairLevee = function (state, i) {
    try {
      if (!Number.isInteger(i) || i < 0 || i >= N || state.tiles.crest[i] === 0) return { ok: false, cost: 0, reason: 'Not a levee tile' };
      if (state.tiles.integrity[i] >= 100) return { ok: false, cost: 0, reason: 'Nothing to repair' };
      if (!charge(state, PS.repairPerTile, 'repair', { i: i })) return { ok: false, cost: PS.repairPerTile, reason: 'Not enough cash' };
      state.tiles.integrity[i] = 100;
      M.onIntegrityChanged(state, i);
      markLeveeChange(state, i);
      return { ok: true, cost: PS.repairPerTile };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'repairLevee', e); return { ok: false, cost: 0, reason: 'Cannot repair' }; }
  };
  M.repairAllLevees = function (state) {
    try {
      let total = 0, any = false;
      const tl = state.tiles;
      for (let i = 0; i < N; i++) if (tl.crest[i] > 0 && tl.integrity[i] < 100) { const r = M.repairLevee(state, i); if (!r.ok) break; total += r.cost; any = true; }
      return { ok: any, cost: total };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'repairAllLevees', e); return { ok: false, cost: 0 }; }
  };
  function oakWithin(state, b, r) {
    for (const v of (state.veg || [])) if (v && v.type === 'oak' && v.stage >= LOCAL.oakStageForEffect && tileDist(v.tx, v.ty, b) <= r) return true;
    for (const q of M.list(state, 'quad')) if (isComplete(q) && rectDist(b.tx, b.ty, b.w, b.h, q.tx, q.ty, q.w, q.h) <= r) return true;
    return false;
  }
  function stormCat(state) { const st = state.storms && state.storms.current; return st ? Math.max(1, Math.min(5, fin(st.cat, 1))) : 0; }
  /** wind pulse n (1–4) carrying `share` of the storm's total (GDD §6.2 Wind damage) */
  M.applyWindPulse = function (state, n, share) {
    try {
      const cat = stormCat(state); if (!cat) return;
      const day = dayOf(state), c = cache(state);
      const base = PS.baseDmg[cat];
      for (const b of M.list(state)) {
        const row = rowOf(b.type); if (!row || !isComplete(b)) continue;
        const wr = wrOf(row, b);
        const boarded = fin(b.data.boardedUntil, -1) >= day;
        const total = base * (6 - wr) / PS.wrDiv * (boarded ? PS.boardedMult : 1) * (oakWithin(state, b, PS.oakRadius) ? PS.oakMult : 1);
        damage(state, b, total * fin(share, 0), 'wind');
      }
      if (n === 1 && c.pendingRolls) applyRolls(state);
      if (n === 2) playTowerRoll(state);
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'applyWindPulse', e); }
  };
  /** the rolls weather decided at tick 150: substation outages, fence breaks, azaleas, oaks */
  function applyRolls(state) {
    const c = cache(state), st = state.storms && state.storms.current, day = dayOf(state), cat = stormCat(state);
    c.pendingRolls = false;
    if (!st) return;
    const rolls = st.rolls || {};
    for (const id of (rolls.substationOutages || [])) {
      const b = M.get(state, id); if (!b || b.type !== 'substation' || b.pilings) continue;
      b.closedUntil = Math.max(b.closedUntil, day + PS.outageDays); b.blackout = true; c.coverageDirty = true;
    }
    for (const i of (rolls.fenceBreaks || [])) if (Number.isInteger(i) && i >= 0 && i < N && state.tiles.surface[i] === SURF.FENCE) { setSurface(state, i, SURF.NONE); rewalk(state, i); }
    if (cat >= PS.azaleaMinCat) for (const v of (state.veg || [])) if (v && v.type === 'azalea') { v.stage = 0; v.plantedDay = day; }
    if (cat >= PS.oakLossMinCat) {
      const R = BSU.rng.sim;
      for (let k = state.veg.length - 1; k >= 0; k--) {
        const v = state.veg[k];
        if (v && v.type === 'oak' && R.chance(PS.oakLoss)) { const tr = dep.terrain(); if (tr && typeof tr.removeVeg === 'function') tr.removeVeg(state, k); else state.veg.splice(k, 1); }
      }
    }
    c.aurasDirty = true; c.statsCache = null;
  }
  /** pulse 2: the Water Tower roll plays (weather decided rolls.towerTopple / toppleIds) */
  function playTowerRoll(state) {
    const c = cache(state), st = state.storms && state.storms.current, day = dayOf(state);
    if (!st || c.rollsApplied) return;
    c.rollsApplied = true;
    const rolls = st.rolls || {};
    let ids = Array.isArray(rolls.toppleIds) ? rolls.toppleIds : (rolls.towerTopple === true ? M.list(state, 'water_tower').filter(isComplete).map(function (b) { return b.id; }) : []);
    for (const id of ids) {
      const b = M.get(state, id); if (!b || b.type !== 'water_tower') continue;
      b.closedUntil = Math.max(b.closedUntil, day + PS.outageDays); b.blackout = true; b.tarp = true;
      if (c.toppled.indexOf(id) < 0) c.toppled.push(id);
      c.coverageDirty = true;
      emit(EV.BUILDING_DAMAGED, { id: b.id, type: b.type, hp: b.hp, cause: 'topple' });
    }
  }
  /** default board-up order: water towers, substations, then WR ascending, cost descending */
  function boardOrder(state) {
    const cat = catalog(), day = dayOf(state);
    const rank = function (b) { return b.type === 'water_tower' ? 0 : (b.type === 'substation' ? 1 : 2); };
    return M.list(state).filter(function (b) { return isComplete(b) && fin(b.data.boardedUntil, -1) < day && cat[b.type] && cat[b.type].kind === 'footprint'; })
      .sort(function (a, b) { const ra = rank(a), rb = rank(b); if (ra !== rb) return ra - rb; const wa = wrOf(cat[a.type], a), wb = wrOf(cat[b.type], b); if (wa !== wb) return wa - wb; const ca = cat[a.type].cost, cb = cat[b.type].cost; if (ca !== cb) return cb - ca; return a.id - b.id; });
  }
  M.boardOrder = function (state) { try { return boardOrder(state).map(function (b) { return b.id; }); } catch (e) { BSU.error('buildings', 'boardOrder', e); return []; } };
  /** $5k per building; crews board 6/day (12 with a post) from tomorrow, in pick-list order */
  M.boardUp = function (state, ids) {
    try {
      const st = state.storms && state.storms.current;
      if (!st) return { ok: false, cost: 0, queued: 0, reason: 'No storm' };
      if (!Array.isArray(st.boardQueue)) st.boardQueue = [];
      const order = boardOrder(state);
      let pick;
      if (ids === 'all') pick = order;
      else { const want = new Set((Array.isArray(ids) ? ids : [ids]).filter(Number.isInteger)); pick = order.filter(function (b) { return want.has(b.id); }); }
      pick = pick.filter(function (b) { return st.boardQueue.indexOf(b.id) < 0; });
      if (!pick.length) return { ok: false, cost: 0, queued: 0, reason: 'Nothing to board' };
      const cost = PS.boardCost * pick.length;
      if (!charge(state, cost, 'prep', { i: BSU.idx(pick[0].tx, pick[0].ty) })) return { ok: false, cost: cost, queued: 0, reason: 'Not enough cash' };
      for (const b of pick) st.boardQueue.push(b.id);
      return { ok: true, cost: cost, queued: pick.length };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'boardUp', e); return { ok: false, cost: 0, queued: 0, reason: 'Cannot board' }; }
  };
  function boardCrews(state, day) {
    const st = state.storms && state.storms.current;
    if (!st || !Array.isArray(st.boardQueue) || !st.boardQueue.length) return;
    let n = M.has(state, 'wildlife_post') ? PS.boardPerDayPost : PS.boardPerDay;
    const until = fin(st.landfallDay, -1) >= 0 ? st.landfallDay + 1 : day + PS.coneDays + 1;
    while (n > 0 && st.boardQueue.length) {
      const id = st.boardQueue.shift();
      const b = M.get(state, id); if (!b) continue;
      b.data.boardedUntil = Math.max(until, day + 1);
      st.boardedCount = fin(st.boardedCount, 0) + 1;
      n--;
      for (const i of footprintOf(b)) touch(state, i, 'decor');
    }
  }
  /** terrain calls yearly: sunk += ft (render shows Sinking! at ≥ 1.0, tilt at ≥ 1.5) */
  M.applySubsidence = function (state, id, ft) {
    try { const b = M.get(state, id); if (b && isNum(ft) && ft > 0 && !b.pilings) { b.sunk = fin(b.sunk, 0) + ft; cache(state).statsCache = null; } }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'applySubsidence', e); }
  };
  /** the itemized bill after landfall (weather stores it on the storm and emits storm:report) */
  M.damageReport = function (state, storm) {
    try {
      const c = cache(state), tl = state.tiles;
      let bill = 0, tarps = 0;
      for (const b of M.list(state)) if (b.built >= 1 && (b.hp < 1 || b.ruin)) { bill += repairCostOf(b); tarps++; }
      const towerTopple = PS.towerToppleCost * c.toppled.length;
      bill += towerTopple;
      let leveeTiles = 0;
      for (let i = 0; i < N; i++) if (tl.crest[i] > 0 && tl.integrity[i] < 100) leveeTiles++;
      bill += leveeTiles * PS.repairPerTile;
      const log = call('hydro', 'stormLog', [state], null) || { held: [], overtopped: [], breached: [] };
      const flooded = call('hydro', 'floodedBuildings', [state], null) || M.list(state).filter(function (b) { return b.flooded; }).map(function (b) { return b.id; });
      return {
        bill: Math.round(bill), tarps: tarps, towerTopple: towerTopple, leveeTiles: leveeTiles,
        held: (log.held || []).slice(), overtopped: (log.overtopped || []).slice(), breached: (log.breached || []).slice(),
        flooded: flooded.slice(), choices: (state.setPiece && state.setPiece.choices) ? Object.assign({}, state.setPiece.choices) : {},
        name: storm ? storm.name : '', cat: storm ? storm.cat : 0
      };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'damageReport', e); return { bill: 0, tarps: 0, towerTopple: 0, leveeTiles: 0, held: [], overtopped: [], breached: [], flooded: [], choices: {} }; }
  };

  // ---------------------------------------------------------------------------
  // tick (§5.1 step 4): construction, tiers, expiry, flood damage, auto-repair, crews,
  // generator fuel, coverage / ring recompute when dirty, queued wind pulses
  // ---------------------------------------------------------------------------
  function daily(state, day) {
    const c = cache(state), cat = catalog(), nm = names();
    const autoRepair = !!(state.economy && state.economy.autoRepair);
    let genRunning = 0;
    for (const b of M.list(state)) {
      const row = cat[b.type]; if (!row) continue;
      // construction
      if (b.built < 1 && !b.ruin) {
        const days = Math.max(1, fin(row.buildDays, 1));
        b.built = Math.min(1, fin(b.built, 0) + 1 / days);
        if (b.built >= 1 - 1e-9) { b.built = 1; b.builtDay = day; onComplete(state, b); }
      }
      // tier upgrade completion
      if (b.upgradeDoneDay >= 0 && day >= b.upgradeDoneDay) {
        b.tier = fin(b.tier, 0) + 1;
        if (b.type === 'stadium' && nm.stadium && nm.stadium[b.tier]) b.name = nm.stadium[b.tier];
        if (b.type === 'practice_field' && b.tier === 1) b.name = (nm.stadium && nm.stadium[0]) || 'Bayou Field';
        b.upgradeDoneDay = -1;
        if (b.closedUntil >= 0 && b.closedUntil <= day) b.closedUntil = -1;
        dirtyAll(c);
        emit(EV.BUILDING_UPGRADED, { id: b.id, type: b.type, tier: b.tier });
        emit(EV.BUILDING_COMPLETE, { id: b.id, type: b.type, tier: b.tier });
      }
      // closedUntil / regrade / outage expiry
      if (b.closedUntil >= 0 && day > b.closedUntil) {
        b.closedUntil = -1;
        if (b.type === 'substation' || b.type === 'water_tower' || b.type === 'generator') { b.blackout = false; c.coverageDirty = true; }
        c.aurasDirty = true; c.statsCache = null;
      }
      if (b.data.regradeUntil >= 0 && day > b.data.regradeUntil) b.data.regradeUntil = -1;
      if (b.data.boardedUntil >= 0 && day > b.data.boardedUntil) { b.data.boardedUntil = -1; for (const i of footprintOf(b)) touch(state, i, 'decor'); }
      // flood damage (hydro owns the flooded flag, D6)
      if (b.flooded && b.built >= 1 && !b.ruin) {
        const d = fin(call('hydro', 'footprintDepth', [state, b.id], 0), 0);
        const dmg = d >= PH.thresholds.surgeDmg2 ? PH.dmgPerDay.surge2 : (d >= PH.thresholds.surgeDmg ? PH.dmgPerDay.surge : PH.dmgPerDay.flood);
        damage(state, b, dmg, d >= PH.thresholds.surgeDmg ? 'surge' : 'flood');
      }
      // auto-repair: damaged, dry, complete
      if (autoRepair && b.built >= 1 && !b.flooded && (b.hp < 1 || b.ruin) && canAfford(state, repairCostOf(b))) M.repair(state, b.id);
      // generator fuel burn
      if (b.type === 'generator' && isComplete(b) && fin(b.data.fuelDays, 0) > 0) {
        let running = false;
        for (const [cid, gid] of c.genPowered) if (gid === b.id && M.get(state, cid)) { running = true; break; }
        if (running) { genRunning++; b.data.fuelDays = Math.max(0, b.data.fuelDays - 1); if (b.data.fuelDays === 0) c.coverageDirty = true; }
      }
      // Marsh Restoration completion (Tier 2)
      if (b.type === 'marsh_restoration' && b.data.restore && day >= b.data.restore.doneDay) {
        const n = b.data.restore.tiles.length;
        call('wildlife', 'applyEcologyOnce', [state, P.wildlife.ecology.restorationBonus * n / P.wildlife.ecology.restorationTilesDiv], null);
        b.data.restoreDone = true; b.data.restore = null;
        emit(EV.BUILDING_COMPLETE, { id: b.id, type: b.type });
      }
    }
    c.generatorsRunning = genRunning;
    if (autoRepair) M.repairAllLevees(state);
    boardCrews(state, day);
    checkBoilWater(state);
    c.statsCache = null;
  }
  M.tick = function (state, flags) {
    try {
      if (!state || !Array.isArray(state.buildings)) return;
      const c = cache(state);
      flags = flags || {};
      // queued wind pulses (received by the storm:pulse listener)
      while (c.pendingPulses.length) { const p = c.pendingPulses.shift(); M.applyWindPulse(state, p.n, p.share); }
      if (c.boilWindow && state.setPiece) checkBoilWater(state);
      if (flags.newDay) daily(state, fin(flags.day, dayOf(state)));
      if (c.connectedDirty) rebuildConnected(state);
      if (c.coverageDirty) recomputeCoverageInner(state);
      if (c.ringDirty) {
        protectionInner(state, PS.ringDefaultH);
        const st = state.storms && state.storms.current;
        if (st) { const hf = fin(call('weather', 'forecastSurge', [state], PS.surge[Math.min(5, Math.max(0, fin(st.forecastCat, st.cat)))]), PS.ringDefaultH); if (hf !== PS.ringDefaultH) protectionInner(state, hf); }
      }
      if (c.aurasDirty && fin(state.tick, 0) % 10 === 0) rebuildAuras(state);
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'tick', e); }
  };

  // ---------------------------------------------------------------------------
  // Lifecycle: init (listeners, once per page load) / reset (every newGame and load)
  // ---------------------------------------------------------------------------
  function listen(name, fn) {
    BSU.events.on(name, function (p) {
      try { if (C) fn(p || {}, C); }
      catch (e) { if (BSU.SELFTEST) throw e; BSU.error('buildings', 'on:' + name, e); }
    }, 'buildings');
  }
  M.init = function (state) {
    try {
      BSU.events.clear('buildings');
      listen(EV.STORM_PULSE, function (p, c) { c.pendingPulses.push({ n: fin(p.n, 0), share: fin(p.share, 0) }); });
      listen(EV.STORM_PHASE, function (p, c) {
        if (p.phase === BSU.STORM_PHASE.WALL) { c.pendingRolls = true; c.rollsApplied = false; }
        if (c.boilWindow && c.root) checkBoilWater(c.root);
      });
      listen(EV.STORM_LANDFALL, function (p, c) { c.boilWindow = true; c.boilWaterFlag = false; c.toppled = []; c.rollsApplied = false; c.pendingRolls = false; });
      listen(EV.BUILDING_FLOODED, function (p, c) { c.coverageDirty = true; c.aurasDirty = true; c.statsCache = null; if (c.boilWindow && c.root) checkBoilWater(c.root); });
      listen(EV.BUILDING_DRIED, function (p, c) { c.coverageDirty = true; c.aurasDirty = true; c.statsCache = null; });
      listen(EV.LEVEE_OVERTOP, function (p, c) { c.ringDirty = true; c.ringEmitPending = true; c.ringCache.clear(); c.gapCache.clear(); });
      listen(EV.LEVEE_BREACH, function (p, c) { c.ringDirty = true; c.ringEmitPending = true; c.ringCache.clear(); c.gapCache.clear(); c.runCache = null; });
      listen(EV.LEVEE_BURROW, function (p, c) { c.ringDirty = true; c.ringEmitPending = true; c.ringCache.clear(); c.gapCache.clear(); c.runCache = null; });
      listen(EV.TILE_CHANGED, function (p, c) {
        if (p.what === 'surface') c.connectedDirty = true;
        if (p.what === 'crest' || p.what === 'flags' || p.what === 'elev') { c.ringDirty = true; c.ringEmitPending = true; c.ringCache.clear(); c.gapCache.clear(); if (p.what === 'crest') c.runCache = null; }
        c.statsCache = null;
      });
      cache(state);
    } catch (e) { BSU.error('buildings', 'init', e); }
  };
  /** every field of §2.11 present (a partial/old save still has every key) */
  function healStruct(b, id) {
    if (!b || typeof b !== 'object') return;
    const def = { id: id, type: '', tx: 0, ty: 0, w: 1, h: 1, rot: 0, name: '', hp: 1, built: 1, builtDay: -1, pilings: false, sunk: 0, powered: false, watered: false, flooded: false, floodedSince: -1, closedUntil: -1, blackout: false, tier: 0, upgradeDoneDay: -1, ruin: false, tarp: false };
    for (const k of Object.keys(def)) if (b[k] === undefined || (typeof def[k] === 'number' && !isNum(b[k]))) b[k] = def[k];
    b.id = id;
    if (!b.provider || typeof b.provider !== 'object') b.provider = { power: -1, water: -1 };
    if (!b.data || typeof b.data !== 'object') b.data = {};
    const dd = { fuelDays: 0, stockedDay: -1, active: true, boardedUntil: -1, regradeUntil: -1, dumpsterTile: -1, seed: 0 };
    for (const k of Object.keys(dd)) if (b.data[k] === undefined || (typeof dd[k] === 'number' && !isNum(b.data[k]))) b.data[k] = dd[k];
    if (!b.data.policies || typeof b.data.policies !== 'object') b.data.policies = { gatorProofDumpsters: false, nutriaBounty: false };
  }
  /** rebuild every cache from the new root (identical for fresh and load: everything is saved, no rng) */
  M.reset = function (state, fresh) {
    try {
      if (!state) return;
      if (!Array.isArray(state.buildings)) state.buildings = [];
      if (!state.runNames || typeof state.runNames !== 'object') state.runNames = {};
      for (let i = 0; i < state.buildings.length; i++) healStruct(state.buildings[i], i);
      C = newCache(state);
      rebuildConnected(state);
      recomputeCoverageInner(state);
      C.undo = null;
    } catch (e) { BSU.error('buildings', 'reset', e); }
  };

  // ---------------------------------------------------------------------------
  // selfTest (§10.6; brief §6): private states, stubbed deps, recorded emits
  // ---------------------------------------------------------------------------
  function makeStubs(rec) {
    const charges = [], refunds = [];
    const floodgate = function (s, i) { if (s.tiles.crest[i] > 0 && (s.tiles.flags[i] & FLAG.CANAL)) s.tiles.flags[i] |= FLAG.FLOODGATE; else s.tiles.flags[i] &= ~FLAG.FLOODGATE; };
    const terrain = {
      setSurface: function (s, i, v) { s.tiles.surface[i] = v; }, setElev: function (s, i, v) { s.tiles.elev[i] = v; },
      setFlag: function (s, i, b, on) { if (on) s.tiles.flags[i] |= b; else s.tiles.flags[i] &= ~b; },
      touch: function () {}, rewalk: function () {}, classify: function () {}, ridgeFull: function () { return null; },
      plantVeg: function (s, t, x, y) { s.veg.push({ type: t, tx: x, ty: y, stage: 0, plantedDay: s.calendar.day, planted: true }); },
      removeVeg: function (s, k) { s.veg.splice(k, 1); }, bank: function (ty) { return BSU.bankAt(ty); }
    };
    const hydro = {
      footprintDepth: function () { return 0; }, depthAt: function () { return 0; }, riskAt: function () { return 0; },
      markCanal: function (s, i, on) { if (on) s.tiles.flags[i] |= FLAG.CANAL; else s.tiles.flags[i] &= ~FLAG.CANAL; floodgate(s, i); },
      markPond: function (s, tiles, id, on) { for (const i of tiles) { if (on) s.tiles.flags[i] |= FLAG.POND_SINK; else s.tiles.flags[i] &= ~FLAG.POND_SINK; } },
      markLeveeChange: function (s, i) { floodgate(s, i); }, networks: function () { return []; },
      stormLog: function () { return { held: [], overtopped: [], breached: [] }; }, floodedBuildings: function () { return []; }, pumpRunning: function () { return false; }
    };
    const economy = { canAfford: function () { return true; }, charge: function (s, c, k) { charges.push({ c: c, k: k }); return true; }, refund: function (s, a) { refunds.push(a); }, post: function () {} };
    const progress = { unlocked: function () { return true; }, unlockReason: function () { return ''; }, unlockOk: function () { return true; }, earned: function () { return false; }, timer: function () { return null; }, timers: function () { return []; }, removeTimer: function () {}, receiverActive: function () { return false; } };
    const weather = { date: function (s) { return BSU.dayParts(s.calendar.day); }, storm: function (s) { return s.storms.current; }, forecastSurge: function () { return 5; } };
    const wildlife = { onCampus: function () { return []; }, nutriaTraps: function () { return false; }, applyEcologyOnce: function () {} };
    return {
      charges: charges, refunds: refunds,
      deps: { emit: function (n, p) { rec.push({ name: n, p: p }); }, data: function () { return BSU.data; }, terrain: function () { return terrain; }, hydro: function () { return hydro; }, economy: function () { return economy; }, progress: function () { return progress; }, weather: function () { return weather; }, wildlife: function () { return wildlife; } }
    };
  }
  /** the brief §6 synthetic map: crown block, highway stub, cove, marsh, bayou strip, a path network */
  function syntheticMap(seed) {
    const s = BSU.newState(seed), tl = s.tiles;
    for (let i = 0; i < N; i++) { tl.owner[i] = -1; tl.elev[i] = 1.0; tl.type[i] = T.MARSH; tl.flags[i] = FLAG.WETLAND_ORIGINAL; }
    for (let y = 3; y <= 16; y++) for (let x = 44; x <= 56; x++) { const i = BSU.idx(x, y); tl.elev[i] = 6; tl.type[i] = T.DRY; tl.flags[i] = 0; }
    for (let y = 0; y <= 2; y++) for (let x = 44; x <= 56; x++) { const i = BSU.idx(x, y); tl.elev[i] = 6; tl.type[i] = T.DRY; tl.flags[i] = 0; }
    const f = s.plot.founders;                           // (51, 7) from params
    s.plot.highway = []; for (let y = 0; y <= 6; y++) { const i = BSU.idx(f.tx + 1, y); s.plot.highway.push(i); tl.surface[i] = SURF.ROAD; }
    // cove 4×4 at 1.8 ft (46..49, 20..23) with a 2.2-ft lip row at y 19
    s.plot.cove = [];
    for (let y = 20; y <= 23; y++) for (let x = 46; x <= 49; x++) { const i = BSU.idx(x, y); tl.elev[i] = 1.8; tl.type[i] = T.WET; tl.flags[i] = 0; s.plot.cove.push(i); }
    for (let x = 46; x <= 49; x++) { const i = BSU.idx(x, 19); tl.elev[i] = 2.2; tl.type[i] = T.WET; tl.flags[i] = 0; }
    s.plot.mouth = [BSU.idx(46, 19), BSU.idx(47, 19), BSU.idx(48, 19)];
    // bayou strip x 30..31
    s.plot.bayou = [];
    for (let y = 0; y < H; y++) for (let x = 30; x <= 31; x++) { const i = BSU.idx(x, y); tl.elev[i] = -1; tl.type[i] = T.BAYOU; tl.flags[i] = FLAG.BAYOU; s.plot.bayou.push(i); }
    // paths: column x 50 (y 5..24), row y 5 (x 44..49), row y 8 (x 43..49), row y 10 (x 51..53) + column x 53 (y 10..13), spur y 13 (x 48..49)
    const path = function (x, y) { tl.surface[BSU.idx(x, y)] = SURF.PATH; };
    for (let y = 5; y <= 24; y++) path(50, y);
    for (let x = 44; x <= 49; x++) path(x, 5);
    for (let x = 43; x <= 49; x++) path(x, 8);
    for (let x = 51; x <= 53; x++) path(x, 10);
    for (let y = 10; y <= 13; y++) path(53, y);
    path(48, 13); path(49, 13);
    tl.elev[BSU.idx(45, 12)] = 8;                        // the sloped site (span 2 ft)
    for (let x = 44; x <= 52; x++) tl.surface[BSU.idx(x, 1)] = SURF.ROAD;   // a road row joining the highway (road-within-4 sites)
    for (let y = 3; y <= 6; y++) { const i = BSU.idx(42, y); tl.flags[i] |= FLAG.CANAL; tl.elev[i] = 0.5; }   // a canal column on the marsh edge (pump / wastewater sites)
    s.economy.suppressCoverage = false; s.economy.suspendCapPenalties = false;
    return s;
  }
  /** push a synthetic complete struct without placement rules (selfTest only) */
  function pushStruct(s, type, tx, ty, extra) {
    const row = rowOf(type), d = dims(row, 0);
    const b = newBuilding(s, row, tx, ty, d.w, d.h, 0, { instant: true }, s.calendar.day);
    Object.assign(b, extra || {});
    s.buildings.push(b);
    for (const i of footprintOf(b)) s.tiles.owner[i] = b.id;
    return b;
  }
  M.selfTest = function () {
    const notes = [], rec = [];
    const saved = Object.assign({}, M._deps), savedC = C;
    const stubs = makeStubs(rec);
    const A = BSU.assert;
    try {
      Object.assign(M._deps, stubs.deps);
      const s = syntheticMap(21);
      C = newCache(s);
      const f = s.plot.founders;
      // 1. canPlace reasons
      let r = M.canPlace(s, 'founders_hall', f.tx + 3, f.ty, {});
      A(!r.ok && r.reason === 'Founders’ Hall goes on the ridge', 'founders elsewhere refused: ' + r.reason);
      r = M.canPlace(s, 'dorm', f.tx + 1, f.ty + 1, {});
      A(!r.ok && r.reason === 'Occupied', 'reserved footprint is Occupied: ' + r.reason);
      const pf = M.place(s, 'founders_hall', f.tx, f.ty, { ignoreCash: true, instant: true });
      A(pf.ok && s.buildings[0].built === 1 && s.buildings[0].name === "Founders' Hall", 'founders placed instantly');
      r = M.canPlace(s, 'dorm', 53, 3, { rot: 0 });
      A(r.ok && r.color === 'green' && r.cost === 700000 && r.terrainMod === 0, 'dorm on the crown by the highway: green $700k (' + r.reason + ' ' + r.cost + ')');
      r = M.canPlace(s, 'dorm', 44, 14, { rot: 0 });
      // connector pass: off the network → either a ≤ connectorMax gravel tie comes along, or the reason says how far the path is
      A((r.ok && r.connector && r.connector.tiles.length >= 1 && r.connector.tiles.length <= PB.connectorMax && r.connector.cost === 2000 * r.connector.tiles.length) || (!r.ok && /^No path within \d+ tiles$/.test(r.reason)), 'no touching path → connector or "No path within N tiles": ' + r.reason + ' ' + JSON.stringify(r.connector));
      A(M.connectorFor(s, 'dorm', 2, 50, 0) === null && !M.canPlace(s, 'dorm', 2, 50, { rot: 0 }).ok, 'far corner: no connector');
      r = M.canPlace(s, 'dorm', 47, 20, { rot: 0 });
      A(r.ok && Math.abs(r.terrainMod - 0.2) < 1e-9 && r.cost === 840000, 'cove dorm: Wet +20% = $840k (' + r.reason + ' ' + r.cost + ')');
      r = M.canPlace(s, 'dorm', 40, 7, { rot: 0 });
      A(r.ok && r.needsPilings && r.pilingsCost === 280000 && r.color === 'yellow' && r.cost === 980000, 'marsh dorm: pilings $280k yellow (' + r.reason + ' ' + r.cost + ')');
      r = M.canPlace(s, 'dorm', 45, 12, { rot: 0 });
      A(r.ok && r.needsGrading && r.gradingCost === 90000 && r.color === 'yellow', 'sloped site: grading $90k (' + r.reason + ')');
      r = M.canPlace(s, 'dorm', f.tx, f.ty + 2, { rot: 0 });
      A(!r.ok && r.reason === 'Occupied', 'overlapping founders → Occupied: ' + r.reason);
      r = M.canPlace(s, 'road', 40, 30, {});
      A(!r.ok && r.reason === 'Use a Boardwalk or a bridge', 'road on marsh: ' + r.reason);
      r = M.canPlace(s, 'stadium', 38, 9, {});
      A(!r.ok && r.reason === 'Needs a Road within 4', 'stadium without road: ' + r.reason);
      r = M.canPlace(s, 'dorm', 100, 3, {});
      A(!r.ok && r.reason === 'Off the map', 'off the map');
      r = M.canPlace(s, 'nope', 1, 1, {});
      A(!r.ok, 'unknown id refused');
      notes.push('canPlace reasons ok');
      // 2. place charges once, 6 owners, event, names
      const n0 = stubs.charges.length, e0 = rec.length;
      const p1 = M.place(s, 'dorm', 53, 3, { rot: 0 });
      A(p1.ok && stubs.charges.length === n0 + 1 && stubs.charges[n0].c === 700000 && stubs.charges[n0].k === 'construction', 'dorm charged once');
      let owners = 0; for (let i = 0; i < N; i++) if (s.tiles.owner[i] === p1.id) owners++;
      A(owners === 6, '6 owner entries (' + owners + ')');
      A(rec.slice(e0).some(function (e) { return e.name === EV.BUILDING_PLACED && e.p.id === p1.id; }), 'building:placed emitted');
      A(s.buildings[p1.id].name === 'Boudreaux Hall', 'first dorm is Boudreaux Hall: ' + s.buildings[p1.id].name);
      const p2 = M.place(s, 'dorm', 47, 20, { rot: 0 });
      A(p2.ok && s.buildings[p2.id].name === 'Fontenot Hall' && s.buildings[p2.id].tx === 47, 'second dorm is Fontenot Hall');
      // 3. construction: 2 daily ticks
      const e1 = rec.length;
      for (let d = 1; d <= 3; d++) { s.calendar.day = d; M.tick(s, { newDay: true, day: d }); }
      A(s.buildings[p1.id].built === 1 && s.buildings[p1.id].builtDay === 2, 'dorm built in 2 days');
      A(rec.slice(e1).filter(function (e) { return e.name === EV.BUILDING_COMPLETE && e.p.id === p1.id; }).length === 1, 'building:complete once');
      // 12. dumpster tile
      const dh = M.place(s, 'dining_hall', 44, 3, { rot: 0 });
      A(dh.ok, 'dining hall placed: ' + dh.reason);
      const dhB = s.buildings[dh.id];
      A(dhB.data.dumpsterTile === BSU.idx(44 + 3, 3 + 1), 'dumpster tile at (tx+w, ty+h−1)');
      const fake = { id: 99, type: 'dining_hall', tx: 20, ty: 20, w: 3, h: 2 };
      A(pickDumpster(s, fake) === BSU.idx(23, 21), 'dumpster (20,20) 3×2 → (23,21)');
      // 4. coverage
      const sub = M.place(s, 'substation', 54, 10, {}); const tow = M.place(s, 'water_tower', 54, 12, {});
      A(sub.ok && tow.ok, 'substation + tower placed: ' + sub.reason + ' ' + tow.reason);
      for (let d = 4; d <= 5; d++) { s.calendar.day = d; M.tick(s, { newDay: true, day: d }); }
      M.recomputeCoverage(s);
      A(s.buildings[p1.id].powered && s.buildings[p1.id].watered && s.buildings[p2.id].powered && s.buildings[p2.id].watered && s.buildings[dh.id].powered, 'dorms and dining hall powered/watered');
      A(M.effective(s, p1.id) === 1, 'effective 1 when covered');
      // 41 consumers on a second private root
      const s2 = syntheticMap(22); C = newCache(s2);
      const sub2 = pushStruct(s2, 'substation', 20, 40);
      const cons = [];
      for (let k = 0; k < 41; k++) cons.push(pushStruct(s2, 'poboy', 12 + (k % 15), 32 + Math.floor(k / 15), {}));
      M.recomputeCoverage(s2);
      A(cons.slice(0, 40).every(function (b) { return b.powered; }) && !cons[40].powered, '40 powered, the 41st unpowered');
      A(M.stats(s2).brownout === true, 'brownout reported');
      const gen = pushStruct(s2, 'generator', 27, 33);
      C.coverageDirty = true; M.recomputeCoverage(s2);
      A(cons[40].powered && cons[40].provider.power === gen.id, 'generator within 6 covers the 41st');
      const e2 = rec.length;
      sub2.flooded = true; C.coverageDirty = true; M.recomputeCoverage(s2);
      const bo = rec.slice(e2).find(function (e) { return e.name === EV.POWER_BLACKOUT; });
      A(bo && bo.p.provider === sub2.id && bo.p.cause === 'flood' && bo.p.affected.length > 0, 'power:blackout with affected ids');
      A(cons[40].powered === true && cons[40].provider.power === gen.id, 'a consumer within 6 of the fueled generator stays powered');
      const far = cons.find(function (b) { return !b.powered; });
      A(far && far.blackout === true, 'a consumer that lost its substation is in blackout');
      notes.push('coverage ok');
      // 5. effective
      const s3 = syntheticMap(23); C = newCache(s3);
      const d3 = pushStruct(s3, 'dorm', 46, 6);
      d3.powered = true; d3.watered = true; A(M.effective(s3, d3.id) === 1, 'effective 1');
      d3.watered = false; A(M.effective(s3, d3.id) === 0.5, 'one missing .5');
      d3.powered = false; A(M.effective(s3, d3.id) === 0, 'both missing 0');
      d3.powered = true; d3.watered = true; d3.flooded = true; A(M.effective(s3, d3.id) === 0, 'flooded 0');
      d3.flooded = false; d3.watered = false; s3.economy.suppressCoverage = true; A(M.effective(s3, d3.id) === 1, 'suppressed → 1'); s3.economy.suppressCoverage = false;
      // 6. ring fill on a synthetic 10×10 ring
      const s4 = BSU.newState(24); C = newCache(s4);
      for (let i = 0; i < N; i++) { s4.tiles.owner[i] = -1; s4.tiles.elev[i] = 2; s4.tiles.type[i] = T.WET; }
      const ring = [];
      for (let y = 20; y <= 29; y++) for (let x = 20; x <= 29; x++) { const i = BSU.idx(x, y); if (x === 20 || x === 29 || y === 20 || y === 29) { s4.tiles.crest[i] = 6; s4.tiles.integrity[i] = 100; ring.push(i); } else s4.tiles.elev[i] = 4; }
      const core = pushStruct(s4, 'pump', 24, 24);   // a ⚡ row = campus core
      A(M.ringClosed(s4, 5) === true && M.protection(s4, 5)[BSU.idx(24, 24)] === 0 && M.protection(s4, 5)[0] === 1, 'ring closed at H 5');
      A(rec.some(function (e) { return e.name === EV.RING_CHANGED && e.p.H === 5 && e.p.closed === true; }), 'ring:changed emitted');
      const gapTile = BSU.idx(25, 20);
      s4.tiles.crest[gapTile] = 0; M.dirtyRing(s4);
      const g = M.gaps(s4, 5);
      A(M.ringClosed(s4, 5) === false && g.gaps.length >= 1 && g.gaps[0].len >= 1 && g.gaps[0].tiles.indexOf(gapTile) >= 0, 'one gap after removing a tile (' + g.gaps.length + ')');
      s4.tiles.crest[gapTile] = 6; s4.tiles.integrity[gapTile] = 40; M.dirtyRing(s4);
      A(M.protection(s4, 5)[gapTile] === 1 && M.ringClosed(s4, 5) === false, 'integrity 40 halves the crest → reached');
      A(M.gaps(s4, 5).weak.some(function (w) { return w.i === gapTile; }), 'weak tile listed');
      s4.tiles.integrity[gapTile] = 100; s4.tiles.flags[gapTile] |= FLAG.CANAL | FLAG.FLOODGATE; M.dirtyRing(s4);
      A(M.protection(s4, 5)[gapTile] === 0 && M.ringClosed(s4, 5) === true, 'healthy floodgate holds (T7)');
      A(M.gaps(s4, 5).gates.some(function (x) { return x.i === gapTile && !x.jammed; }), 'gate listed as informational');
      s4.tiles.flags[gapTile] |= FLAG.JAMMED; M.dirtyRing(s4);
      A(M.protection(s4, 5)[gapTile] === 1 && M.ringClosed(s4, 5) === false, 'jammed gate is open (T7)');
      s4.tiles.flags[gapTile] &= ~(FLAG.JAMMED | FLAG.CANAL | FLAG.FLOODGATE); M.dirtyRing(s4);
      A(M.boundaryLevees(s4, 5).length === ring.length, 'boundary = the 36 ring tiles');
      // 7. sandbags
      s4.calendar.day = 10;
      const n1 = stubs.charges.length;
      const sb = M.sandbags(s4, 5);
      A(sb.ok && sb.cost === Math.ceil(ring.length / 10) * 10000 && stubs.charges[n1].k === 'prep', 'sandbags cost ceil(n/10)×$10k = ' + sb.cost);
      A(ring.every(function (i) { return s4.tiles.sandbag[i] === 15 && s4.tiles.sandbagDay[i] === 15; }), 'sandbag 15 / day + 5 on every boundary tile');
      A(M.protection(s4, 8)[BSU.idx(24, 24)] === 0, 'sandbagged ring (9.5) holds H 8');
      notes.push('ring ok');
      // 8. wind pulses
      const s5 = syntheticMap(25); C = newCache(s5);
      s5.storms.current = { name: 'Test', cat: 3, forecastCat: 3, phase: BSU.STORM.LANDFALL, rolls: {}, boardQueue: [], landfallDay: 0 };
      const wa = pushStruct(s5, 'dorm', 45, 14), wb = pushStruct(s5, 'dorm', 45, 3), wc = pushStruct(s5, 'dorm', 53, 14);
      wb.data.boardedUntil = 5;
      s5.veg.push({ type: 'oak', tx: 56, ty: 16, stage: 1, plantedDay: 0, planted: true });
      for (const sh of P.time.windPulseShare) M.applyWindPulse(s5, 0, sh);
      A(Math.abs((1 - wa.hp) - 0.096) < 1e-6, 'unboarded WR3 Cat3: 9.6% (' + (1 - wa.hp) + ')');
      A(Math.abs((1 - wb.hp) - 0.0576) < 1e-6, 'boarded: 5.76% (' + (1 - wb.hp) + ')');
      A(Math.abs((1 - wc.hp) - 0.0672) < 1e-6, 'oak within 2: 6.72% (' + (1 - wc.hp) + ')');
      A(wa.tarp === true, 'damaged → tarp');
      // 9. repair cost; 10. retrofit
      wa.hp = 0.8; const rp = M.repair(s5, wa.id);
      A(rp.ok && rp.cost === 84000 && wa.hp === 1 && !wa.tarp, 'repair at hp .8 costs $84k (' + rp.cost + ')');
      wc.sunk = 1.0; const rf = M.retrofitPilings(s5, wc.id);
      A(rf.ok && rf.cost === 560000 && wc.pilings && wc.closedUntil === s5.calendar.day + 1, 'retrofit at sunk 1.0 = $560k (' + rf.cost + ')');
      A(M.retrofitPilings(s5, wc.id).ok === false, 'second retrofit refused');
      // 11. remove / undo
      const lib = pushStruct(s5, 'library', 44, 10);
      A(M.remove(s5, lib.id).ok === false, 'library refuses demolition');
      const n2 = stubs.refunds.length;
      const rm = M.remove(s5, wa.id);
      A(rm.ok && rm.refund === 280000 && stubs.refunds[n2] === 280000 && s5.buildings[wa.id] === null && s5.tiles.owner[BSU.idx(45, 14)] === -1, 'demolishing a dorm refunds $280k and clears owner');
      s5.tick = 100;
      const n3 = stubs.refunds.length;
      const p5 = M.place(s5, 'dorm', 53, 3, {});
      A(p5.ok, 'dorm placed for undo: ' + p5.reason);
      s5.tick = 140;
      const un = M.undo(s5);
      A(un.ok && s5.buildings[p5.id] === null && s5.tiles.owner[BSU.idx(53, 3)] === -1 && stubs.refunds[n3] === 700000, 'undo within 50 ticks restores and refunds');
      const p6 = M.place(s5, 'dorm', 53, 3, {}); s5.tick = 200;
      A(p6.ok && M.undo(s5).ok === false && s5.buildings[p6.id] !== null, 'undo after 50 ticks refused');
      // drag rows + undo of a run
      const runTiles = []; for (let x = 40; x <= 42; x++) runTiles.push(BSU.idx(x, 30));
      const pr = M.placeRun(s5, 'levee', runTiles, {});
      A(pr.ok && pr.placed === 3 && s5.tiles.crest[runTiles[1]] === 6 && s5.tiles.integrity[runTiles[1]] === 100, 'levee run placed');
      const cn = M.place(s5, 'canal', 41, 30, {});
      A(cn.ok && (s5.tiles.flags[BSU.idx(41, 30)] & FLAG.FLOODGATE) !== 0, 'canal on a levee tile → floodgate');
      A(M.remove(s5, { tile: BSU.idx(40, 30) }).ok && s5.tiles.crest[BSU.idx(40, 30)] === 0, 'bulldozed levee tile');
      const fence = M.place(s5, 'gator_fence', 50, 12, {});
      A(!fence.ok && fence.reason === 'Not on a path', 'fence on a path refused');
      A(M.place(s5, 'gator_fence', 40, 40, {}).ok && s5.tiles.surface[BSU.idx(40, 40)] === SURF.FENCE, 'fence on marsh ok');
      A(M.place(s5, 'preserve', 41, 40, {}).ok && isPreserve(s5, BSU.idx(41, 40)), 'preserve paint on marsh');
      A(M.canPlace(s5, 'path', 41, 40, {}).reason === 'Preserve', 'path on preserve refused');
      A(M.place(s5, 'live_oak', 46, 16, {}).ok && s5.veg.some(function (v) { return v.type === 'oak' && v.tx === 46 && v.ty === 16; }), 'live oak is a veg entity');
      A(M.canPlace(s5, 'cypress', 46, 13, {}).reason === 'Cypress wants wet feet', 'cypress on dry crown refused');
      A(M.place(s5, 'cypress', 40, 45, {}).ok, 'cypress on marsh ok');
      // 13. levee runs
      const s6 = BSU.newState(26); C = newCache(s6);
      for (let i = 0; i < N; i++) { s6.tiles.owner[i] = -1; s6.tiles.elev[i] = 4; s6.tiles.type[i] = T.DRY; }
      for (let x = 10; x < 35; x++) { s6.tiles.crest[BSU.idx(x, 30)] = 6; s6.tiles.integrity[BSU.idx(x, 30)] = 100; }
      const runs = M.leveeRuns(s6);
      A(runs.length === 1 && runs[0].tiles.length === 25 && s6.runNames['levee:' + BSU.idx(10, 30)] === 'The Great Wall of Boudreaux' && runs[0].name === 'The Great Wall of Boudreaux', 'levee run named');
      // 14. unlocked wrapper
      const pr0 = M._deps.progress;
      M._deps.progress = function () { return { unlocked: function () { return false; }, unlockReason: function () { return 'Reach 800 students'; }, timer: function () { return null; }, receiverActive: function () { return false; } }; };
      const ul = M.unlocked(s6, 'library');
      A(ul.ok === false && ul.reason === 'Reach 800 students', 'unlocked wraps progress phrasing');
      A(M.canPlace(s6, 'library', 10, 10, {}).reason === 'Reach 800 students', 'locked row ghost reason');
      M._deps.progress = pr0;
      A(M.unlocked(s6, 'library').ok === true && M.unlocked(s6, 'library').reason === '', 'unlocked → empty reason');
      // 15. shelter assignments; 16. stats self-heal
      const s7 = syntheticMap(27); C = newCache(s7);
      const sh1 = pushStruct(s7, 'union', 44, 10, { powered: true, watered: true }), sh2 = pushStruct(s7, 'rec_center', 53, 12, { powered: true, watered: true });
      s7.economy.students = 1000;
      const asg = M.shelterAssignments(s7), shl = M.shelter(s7);
      A(asg[sh1.id] === 2000 && asg[sh2.id] === 1000 && Object.keys(asg).length === 2 && shl.capacity === 3000 && shl.ok === true, 'shelterAssignments {id: capacity} matches shelter()');
      const st7 = M.stats(s7);
      A(st7.beds === 0 && st7.feeds === 400 && st7.shelter.capacity === 3000, 'stats on root 7');
      const s8 = syntheticMap(28);
      pushStruct(s8, 'dorm', 46, 6, { powered: true, watered: true });
      const st8 = M.stats(s8);
      A(st8.beds === 300 && st8 !== st7 && M.stats(s7).beds === 0, 'stats self-heals on a second root');
      A(M.upkeepTotal(s8) === 9000 + 15 * 100 + 4 * 500, 'upkeepTotal: dorm $9k + 15 road tiles × $100 + 4 canal tiles × $500 (' + M.upkeepTotal(s8) + ')');
      // every catalog row places somewhere on the synthetic map (spiral from Founders')
      const s9 = syntheticMap(29); C = newCache(s9);
      M.place(s9, 'founders_hall', f.tx, f.ty, { ignoreCash: true, instant: true });
      const skipRows = { founders_hall: 1, pilings: 1, surge_barrier: 1 };   // the barrier needs a run (tested below); pilings needs a target
      const missing = [];
      for (const id of BSU.B_ORDER) {
        if (skipRows[id]) continue;
        let found = false;
        for (let ring2 = 0; ring2 <= 40 && !found; ring2++) for (let dy = -ring2; dy <= ring2 && !found; dy++) for (let dx = -ring2; dx <= ring2; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring2) continue;
          const rr = M.canPlace(s9, id, f.tx + dx, f.ty + dy, { rot: 0, ignoreCash: true });
          if (rr.ok) { found = true; break; }
        }
        if (!found) missing.push(id);
      }
      A(missing.length === 0, 'every row has a legal spot: missing ' + missing.join(','));
      // the Surge Barrier: a straight run across the bayou with land ends ≥ 1.5 ft, 2 powered pumps upstream
      const bar = []; for (let x = 29; x <= 32; x++) bar.push(BSU.idx(x, 40));
      s9.tiles.elev[BSU.idx(29, 40)] = 2; s9.tiles.elev[BSU.idx(32, 40)] = 2;
      let rb = M.canPlace(s9, 'surge_barrier', 29, 40, { tiles: bar, ignoreCash: true });
      A(!rb.ok && rb.reason === 'Needs 2 powered Pumps upstream', 'barrier needs pumps: ' + rb.reason);
      const hy0 = M._deps.hydro;
      const pumpA = pushStruct(s9, 'pump', 28, 20, { powered: true }), pumpB = pushStruct(s9, 'pump', 33, 22, { powered: true });
      const hyStub = hy0(); const hy1 = Object.assign({}, hyStub, { networks: function () { return [{ id: 0, tiles: [BSU.idx(29, 21), BSU.idx(32, 22)], drainsToWater: true, pumps: [pumpA.id, pumpB.id], gates: [] }]; } });
      M._deps.hydro = function () { return hy1; };
      rb = M.canPlace(s9, 'surge_barrier', 29, 40, { tiles: bar, ignoreCash: true });
      A(rb.ok && rb.cost === 6000000, 'barrier ok with 2 pumps upstream: ' + rb.reason);
      A(M.canPlace(s9, 'surge_barrier', 29, 40, { tiles: bar.slice(0, 3), ignoreCash: true }).reason === 'Drag 4–8 tiles across the Bayou', 'barrier run length');
      const pb = M.placeRun(s9, 'surge_barrier', bar, { ignoreCash: true });
      const barB = M.list(s9, 'surge_barrier')[0];
      A(pb.ok && barB && barB.w === 4 && barB.h === 1 && barB.pilings && s9.tiles.owner[bar[2]] === barB.id, 'barrier struct spans the run on pilings');
      M._deps.hydro = hy0;
      // policies, refuel, upgrade, board-up
      const s10 = syntheticMap(30); C = newCache(s10);
      const dh10 = pushStruct(s10, 'dining_hall', 44, 10), gen10 = pushStruct(s10, 'generator', 48, 3), pf10 = pushStruct(s10, 'practice_field', 44, 12);
      A(M.setPolicy(s10, dh10.id, 'gatorProofDumpsters', true).cost === 5000 && dh10.data.policies.gatorProofDumpsters, 'dumpster policy $5k');
      A(M.refuel(s10, gen10.id).cost === 5000 && gen10.data.fuelDays === 6, 'refuel +3');
      const up = M.upgrade(s10, pf10.id);
      A(up.ok && up.tier === 1 && pf10.upgradeDoneDay === s10.calendar.day + 6, 'Bayou Field upgrade queued');
      for (let d = 1; d <= 7; d++) { s10.calendar.day = d; M.tick(s10, { newDay: true, day: d }); }
      A(pf10.tier === 1 && pf10.name === 'Bayou Field' && pf10.upgradeDoneDay === -1, 'Bayou Field completed and named');
      s10.storms.current = { name: 'T', cat: 2, forecastCat: 2, phase: BSU.STORM.NAMED, rolls: {}, boardQueue: [], landfallDay: 12, boardedCount: 0 };
      const bu = M.boardUp(s10, 'all');
      A(bu.ok && bu.queued === 3 && bu.cost === 15000, 'board up all: 3 × $5k');
      s10.calendar.day = 8; M.tick(s10, { newDay: true, day: 8 });
      A(s10.storms.current.boardedCount === 3 && dh10.data.boardedUntil === 13, 'crews boarded 3 the next day');
      A(M.damageReport(s10, s10.storms.current).bill === 0, 'damage report with nothing damaged');
      notes.push('actions ok');
      // no NaN anywhere in the states touched
      for (const st of [s, s2, s3, s4, s5, s6, s7, s8, s9, s10]) for (const b of st.buildings) if (b) for (const k of ['hp', 'built', 'sunk', 'closedUntil', 'builtDay', 'tier']) A(isNum(b[k]), 'finite ' + k);
      A(rec.every(function (e) { return BSU.events.known(e.name); }), 'every recorded emit is a registered event');
      notes.push(rec.length + ' emits recorded');
    } catch (e) {
      Object.assign(M._deps, saved); C = savedC;
      return { ok: false, notes: (e && e.stack) || String(e) };
    } finally {
      Object.assign(M._deps, saved);
      C = savedC;
    }
    return { ok: true, notes: notes.join('; ') };
  };
})();
