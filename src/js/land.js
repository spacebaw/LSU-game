'use strict';
// ============================================================================
// BAYOU STATE — land.js (module 7b, after issues.js) → BSU.land
// The Land Office (docs/PLAN_PATHS_LAND.md Track L2). The start charter is the
// legacy rectangle of state.world; the land outside it is divided into
// params.land.sectionSize (16 × 16) sections the state sells one at a time:
// only a section that shares an edge with chartered land is for sale, the
// price follows the land (base + per Dry / High / Marsh tile, water free) and
// the 3rd / 6th purchase need prestige. A 64 × 64 world has no sections.
// Owner of: state.charter {owned: [section ids], cardSeen, refusedDay}.
// Reads tiles.type / owner / surface / crest / flags; writes nothing else.
// buildings.canPlace refuses every tool on an unchartered tile through
// M.refusal; tieSearch avoids unchartered land through M.mask; render_fx
// draws the overlay from M.sections; ui_panels builds the panel on it.
// Zero DOM / timer access. Every emit goes through M._deps.emit, every other
// module through M._deps.<name>() so selfTest can stub them. No state on the
// module object: everything per game is in state.charter or in a WeakMap
// cache keyed on the root object (self-healing, like buildings).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.land = BSU.land || {});
  const P = BSU.params, PL = P.land || {};
  const T = BSU.T, SURF = BSU.SURF, FLAG = BSU.FLAG, EV = BSU.EV;
  let W = 64, H = 64, N = 4096;
  BSU.onMap(function (m) { W = m.W; H = m.H; N = m.N; });   // L1: the live map size (refreshed inside BSU.setMap, before any allocation)
  const fin = function (v, d) { return Number.isFinite(v) ? v : d; };
  const NONE = -1;

  M._deps = {
    emit: function (name, payload) { BSU.events.emit(name, payload); },
    economy: function () { return BSU.economy; },
    progress: function () { return BSU.progress; },
    ui: function () { return BSU.ui; }
  };
  const dep = M._deps;
  function emit(name, payload) { try { dep.emit(name, payload); } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'emit:' + name, e); } }
  function call(which, fn, args, fallback) {
    const mod = dep[which] ? dep[which]() : null;
    if (mod && typeof mod[fn] === 'function') return mod[fn].apply(mod, args);
    return (typeof fallback === 'function') ? fallback() : fallback;
  }
  function money(n) { return BSU.formatMoney(fin(n, 0)); }
  function today(state) { return fin(state && state.calendar && state.calendar.day, 0); }
  function size() { return Math.max(4, Math.floor(fin(PL.sectionSize, 16))); }

  const CHARTER_REASON = 'Charter this section at the Land Office';
  M.CHARTER_REASON = CHARTER_REASON;

  // ---------------------------------------------------------------------------
  // state.charter (lazy for saves written before L2: "legacy only")
  // ---------------------------------------------------------------------------
  function charter(state) {
    if (!state) return { owned: [], cardSeen: false, refusedDay: NONE };
    let c = state.charter;
    if (!c || typeof c !== 'object') c = state.charter = { owned: [], cardSeen: false, refusedDay: NONE };
    if (!Array.isArray(c.owned)) c.owned = [];
    if (typeof c.cardSeen !== 'boolean') c.cardSeen = false;
    if (!Number.isFinite(c.refusedDay)) c.refusedDay = NONE;
    return c;
  }
  function legacyRect(state) {
    const l = state && state.world && state.world.legacy;
    if (l && Number.isFinite(l.x0)) return l;
    const m = BSU.MAP; return m.legacy || { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
  }

  // ---------------------------------------------------------------------------
  // The cache (WeakMap on the root): the grid, the sections, the mask, the counts
  // ---------------------------------------------------------------------------
  const CACHE = new WeakMap();
  function cache(state) {
    let c = CACHE.get(state);
    const key = W + 'x' + H + '|' + charter(state).owned.join(',');
    if (!c || c.key !== key) {
      c = { key: key, cells: null, sections: null, mask: null, countsTick: -1e9, free: null, freeTick: -1e9 };
      CACHE.set(state, c);
      buildGrid(state, c);
    }
    return c;
  }
  function buildGrid(state, c) {
    const SZ = size(), L = legacyRect(state), cols = Math.ceil(W / SZ), rows = Math.ceil(H / SZ);
    const cells = [], sections = [];
    let id = 0;
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * SZ, y0 = cy * SZ, x1 = Math.min(W - 1, x0 + SZ - 1), y1 = Math.min(H - 1, y0 + SZ - 1);
      const legacy = !(x1 < L.x0 || x0 > L.x1 || y1 < L.y0 || y0 > L.y1);
      const cell = { cx: cx, cy: cy, x0: x0, y0: y0, x1: x1, y1: y1, legacy: legacy, id: 0 };
      if (!legacy) { cell.id = ++id; sections.push({ id: id, cx: cx, cy: cy, x0: x0, y0: y0, x1: x1, y1: y1, owned: false, forSale: false, price: 0, counts: null, gate: 0, locked: false }); }
      cells.push(cell);
    }
    c.cols = cols; c.rows = rows; c.cells = cells; c.sections = sections;
    const owned = new Set(charter(state).owned);
    const at = function (cx, cy) { return (cx < 0 || cy < 0 || cx >= cols || cy >= rows) ? null : cells[cy * cols + cx]; };
    const chartered = function (cell) { return !!cell && (cell.legacy || owned.has(cell.id)); };
    for (const s of sections) {
      s.owned = owned.has(s.id);
      s.forSale = !s.owned && (chartered(at(s.cx - 1, s.cy)) || chartered(at(s.cx + 1, s.cy)) || chartered(at(s.cx, s.cy - 1)) || chartered(at(s.cx, s.cy + 1)));
    }
    // the mask: 1 = chartered (the legacy rectangle + owned sections)
    const mask = new Uint8Array(N);
    for (const cell of cells) {
      if (!chartered(cell)) continue;
      for (let y = cell.y0; y <= cell.y1; y++) { const row = y * W; for (let x = cell.x0; x <= cell.x1; x++) mask[row + x] = 1; }
    }
    c.mask = mask;
  }
  function isWaterType(t) { return t === T.OPEN_WATER || t === T.BAYOU || t === T.POND; }
  function countsOf(state, s) {
    const type = state.tiles.type; let dry = 0, high = 0, marsh = 0, water = 0;
    for (let y = s.y0; y <= s.y1; y++) { const row = y * W; for (let x = s.x0; x <= s.x1; x++) { const t = type[row + x]; if (t === T.HIGH) high++; else if (t === T.MARSH) marsh++; else if (isWaterType(t)) water++; else dry++; } }
    return { dry: dry, high: high, marsh: marsh, water: water };
  }
  function priceOf(counts) { return Math.round(fin(PL.base, 400000) + fin(PL.perDry, 9000) * counts.dry + fin(PL.perHigh, 20000) * counts.high + fin(PL.perMarsh, 2000) * counts.marsh); }
  /** prestige needed to buy the nth section (1-based), per params.land.gates */
  function gateFor(nth) {
    let need = 0;
    for (const g of (Array.isArray(PL.gates) ? PL.gates : [])) if (Array.isArray(g) && nth >= fin(g[0], Infinity)) need = Math.max(need, fin(g[1], 0));
    return need;
  }
  function prestige(state) { return fin(state && state.economy && state.economy.prestige, 0); }
  function cash(state) { return fin(state && state.economy && state.economy.cash, 0); }
  /** the sections with live counts / price / gate (counts re-read once a day: only subsidence or a later Dredge can change a type outside the charter) */
  function live(state) {
    const c = cache(state);
    const tick = fin(state.tick, 0), TPD = fin(P.time && P.time.ticksPerDay, 600);
    if (tick < c.countsTick || tick - c.countsTick >= TPD) {
      for (const s of c.sections) { s.counts = countsOf(state, s); s.price = priceOf(s.counts); }
      c.countsTick = tick;
    }
    const nth = charter(state).owned.length + 1, gate = gateFor(nth), pres = prestige(state);
    for (const s of c.sections) { s.gate = s.owned ? 0 : gate; s.locked = !s.owned && pres < gate; }
    return c;
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  /** every 16 × 16 cell of the world: {cx, cy, x0, y0, x1, y1, legacy, id (0 for the charter)} — the panel's map */
  M.cells = function (state) { try { if (!state || !state.tiles) return []; return cache(state).cells.map(function (c) { return Object.assign({}, c); }); } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'cells', e); return []; } };
  M.grid = function (state) { try { const c = cache(state); return { cols: c.cols, rows: c.rows, size: size() }; } catch (e) { return { cols: 0, rows: 0, size: size() }; } };
  /** [{id, cx, cy, x0, y0, x1, y1, owned, forSale, price, counts: {dry, high, marsh, water}, gate, locked}] — [] in a world the charter covers */
  M.sections = function (state) {
    try { if (!state || !state.tiles) return []; return live(state).sections.map(function (s) { return Object.assign({}, s, { counts: Object.assign({}, s.counts) }); }); }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'sections', e); return []; }
  };
  M.section = function (state, id) { try { if (!state || !state.tiles) return null; const s = live(state).sections.find(function (x) { return x.id === (id | 0); }); return s ? Object.assign({}, s, { counts: Object.assign({}, s.counts) }) : null; } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'section', e); return null; } };
  M.owned = function (state) { return charter(state).owned.slice(); };
  M.count = function (state) { return charter(state).owned.length; };
  /** the live chartered mask (read-only Uint8Array of N; 1 = chartered); null without tiles */
  M.mask = function (state) { try { if (!state || !state.tiles) return null; return cache(state).mask; } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'mask', e); return null; } };
  M.isChartered = function (state, tx, ty) {
    try { if (!state || !state.tiles || !BSU.inBounds(tx, ty)) return false; return cache(state).mask[(ty | 0) * W + (tx | 0)] === 1; }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'isChartered', e); return false; }
  };
  /** the section holding (tx, ty), or null (the charter, off the map) */
  M.sectionAt = function (state, tx, ty) {
    try {
      if (!state || !state.tiles || !BSU.inBounds(tx, ty)) return null;
      const c = live(state), SZ = size(), cell = c.cells[Math.floor((ty | 0) / SZ) * c.cols + Math.floor((tx | 0) / SZ)];
      if (!cell || cell.legacy) return null;
      const s = c.sections[cell.id - 1]; return s ? Object.assign({}, s, { counts: Object.assign({}, s.counts) }) : null;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'sectionAt', e); return null; }
  };
  /** the section nearest (tx, ty) (Chebyshev distance to its rectangle): the one under the tile, else the nearest UNOWNED one (for-sale first), else the nearest */
  M.nearestSection = function (state, tx, ty) {
    try {
      if (!state || !state.tiles) return null;
      const here = M.sectionAt(state, tx, ty); if (here) return here;
      const c = live(state); let best = null, bd = Infinity, bestRank = 9;
      for (const s of c.sections) {
        const dx = tx < s.x0 ? s.x0 - tx : (tx > s.x1 ? tx - s.x1 : 0), dy = ty < s.y0 ? s.y0 - ty : (ty > s.y1 ? ty - s.y1 : 0), d = Math.max(dx, dy);
        const rank = s.forSale ? 0 : (s.owned ? 2 : 1);
        if (rank < bestRank || (rank === bestRank && d < bd)) { best = s; bd = d; bestRank = rank; }
      }
      return best ? Object.assign({}, best, { counts: Object.assign({}, best.counts) }) : null;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'nearestSection', e); return null; }
  };
  /** the ghost reason for a tool on `tiles` (indices): null when every tile is chartered (or the charter covers the world), else
   *  {id, price, forSale, locked, gate, tx, ty, reason: "Charter this section at the Land Office ($2.4M)"} for the first unchartered tile */
  M.refusal = function (state, tiles) {
    try {
      if (!state || !state.tiles || !Array.isArray(tiles) || !tiles.length) return null;
      const c = cache(state); if (!c.sections.length) return null;
      const mask = c.mask;
      for (const i of tiles) {
        if (!(Number.isInteger(i) && i >= 0 && i < N) || mask[i] === 1) continue;
        const tx = i % W, ty = (i / W) | 0, s = M.sectionAt(state, tx, ty);
        if (!s) continue;
        return { id: s.id, price: s.price, forSale: s.forSale, locked: s.locked, gate: s.gate, tx: tx, ty: ty, i: i, reason: CHARTER_REASON + ' (' + money(s.price) + ')' };
      }
      return null;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'refusal', e); return null; }
  };
  /** record the first charter refusal (the goal's trigger); true the first time */
  M.noteRefusal = function (state) { try { const c = charter(state); if (c.refusedDay >= 0) return false; c.refusedDay = today(state); return true; } catch (e) { return false; } };
  /** {ok, reason, price, id, gate, prestige, section} — why a Buy would or would not go through */
  M.quote = function (state, id) {
    try {
      const out = { ok: false, reason: '', price: 0, id: id | 0, gate: 0, prestige: prestige(state), section: null };
      if (!state || !state.tiles) { out.reason = 'No game'; return out; }
      const s = M.section(state, id); if (!s) { out.reason = 'No such section'; return out; }
      out.section = s; out.price = s.price; out.gate = s.gate;
      if (s.owned) { out.reason = 'Already chartered'; return out; }
      if (!s.forSale) { out.reason = 'Not next to your land yet'; return out; }
      if (s.locked) { out.reason = 'Needs prestige ' + s.gate + ' (you have ' + Math.floor(out.prestige) + ')'; return out; }
      if (cash(state) < s.price) { out.reason = 'Needs ' + money(s.price) + ' in cash'; return out; }
      out.ok = true; return out;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'quote', e); return { ok: false, reason: 'Error', price: 0, id: id | 0, gate: 0, prestige: 0, section: null }; }
  };
  /** buy section `id`: the cash check and the prestige gate (opts.force skips both, headless / tests), the ledger line "Land charter: section N",
   *  the land:chartered event, the ticker line and the one-time first-purchase card. {ok, reason, price, id, n} */
  M.buy = function (state, id, opts) {
    opts = opts || {};
    try {
      const q = M.quote(state, id);
      if (!q.ok && !(opts.force && q.section && !q.section.owned)) return { ok: false, reason: q.reason, price: q.price, id: id | 0, n: M.count(state) };
      const s = q.section, price = s.price;
      if (!opts.force) { if (!call('economy', 'charge', [state, price, 'construction', { note: 'Land charter: section ' + s.id, i: s.y0 * W + s.x0 }], false)) return { ok: false, reason: 'Not enough cash', price: price, id: s.id, n: M.count(state) }; }
      const c = charter(state); c.owned.push(s.id);
      const n = c.owned.length;
      cache(state);   // the key changed: rebuild the grid + mask
      emit(EV.LAND_CHARTERED || 'land:chartered', { id: s.id, price: price, n: n, rect: { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 }, counts: s.counts });
      call('progress', 'ticker', [state, 'Land Office: section {n} chartered for {price}. The surveyors are already lost.', { n: s.id, price: money(price) }, 'money', s.y0 * W + s.x0], undefined);
      if (!c.cardSeen) { c.cardSeen = true; call('ui', 'card', [state, 'landFirst', { id: s.id, price: price, n: n, counts: s.counts }], undefined); }
      return { ok: true, reason: '', price: price, id: s.id, n: n };
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'buy', e); return { ok: false, reason: 'Error', price: 0, id: id | 0, n: 0 }; }
  };
  /** the charter's buildable land: {total: Dry + High (+ Wet / Drained) tiles inside chartered land, free: of those, untouched, share} (cached 100 ticks) */
  M.freeShare = function (state) {
    try {
      if (!state || !state.tiles) return { total: 0, free: 0, share: 1 };
      const c = cache(state), tick = fin(state.tick, 0);
      if (c.free && tick >= c.freeTick && tick - c.freeTick < 100) return c.free;
      const t = state.tiles, mask = c.mask; let total = 0, free = 0;
      for (let i = 0; i < N; i++) {
        if (mask[i] !== 1) continue;
        const ty = t.type[i]; if (ty === T.MARSH || isWaterType(ty)) continue;
        total++;
        if (t.owner[i] === -1 && t.surface[i] === SURF.NONE && t.crest[i] === 0 && !(t.flags[i] & (FLAG.MOUND | FLAG.PRESERVE | FLAG.CANAL))) free++;
      }
      c.free = { total: total, free: free, share: total ? free / total : 1 }; c.freeTick = tick;
      return c.free;
    } catch (e) { if (BSU.SELFTEST) throw e; BSU.error('land', 'freeShare', e); return { total: 0, free: 0, share: 1 }; }
  };
  M.stats = function (state) {
    try {
      const secs = M.sections(state); let owned = 0, forSale = 0, cheapest = 0;
      for (const s of secs) { if (s.owned) owned++; else if (s.forSale) { forSale++; if (!cheapest || s.price < cheapest) cheapest = s.price; } }
      return { sections: secs.length, owned: owned, forSale: forSale, cheapest: cheapest, nextGate: gateFor(owned + 1), prestige: prestige(state) };
    } catch (e) { return { sections: 0, owned: 0, forSale: 0, cheapest: 0, nextGate: 0, prestige: 0 }; }
  };
  M.gateFor = gateFor;
  M.priceOf = function (counts) { return priceOf({ dry: fin(counts && counts.dry, 0), high: fin(counts && counts.high, 0), marsh: fin(counts && counts.marsh, 0), water: 0 }); };

  // ---------------------------------------------------------------------------
  // selfTest (§10.6): a synthetic state on the live map, deps stubbed
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = []; let fails = 0;
    const A = function (cond, msg) { if (!cond) { fails++; notes.push('FAIL ' + msg); } };
    const saved = Object.assign({}, M._deps);
    try {
      const events = [], cards = [], lines = [];
      let cashNow = 50e6;
      Object.assign(M._deps, {
        emit: function (name, p) { events.push({ name: name, p: p }); },
        economy: function () { return { charge: function (s, amt) { if (cashNow < amt) return false; cashNow -= amt; s.economy.cash = cashNow; return true; } }; },
        progress: function () { return { ticker: function (s, text, fields) { lines.push(String(text)); } }; },
        ui: function () { return { card: function (s, id, p) { cards.push(id); } }; }
      });
      const s = BSU.newState(7); s.economy.cash = cashNow; s.economy.prestige = 0;
      const L = legacyRect(s), secs = M.sections(s), SZ = size();
      const cols = Math.ceil(W / SZ), rows = Math.ceil(H / SZ);
      let expect = 0; for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) { const x0 = cx * SZ, y0 = cy * SZ, x1 = Math.min(W - 1, x0 + SZ - 1), y1 = Math.min(H - 1, y0 + SZ - 1); if (x1 < L.x0 || x0 > L.x1 || y1 < L.y0 || y0 > L.y1) expect++; }
      A(secs.length === expect, 'sections = the cells outside the legacy rectangle (' + secs.length + ' vs ' + expect + ')');
      A(M.isChartered(s, L.x0, L.y0) && M.isChartered(s, L.x1, L.y1), 'the legacy rectangle is chartered');
      A(!M.isChartered(s, -1, 0) && !M.isChartered(s, W, 0), 'off the map is not chartered');
      if (secs.length) {
        const forSale = secs.filter(function (x) { return x.forSale; }), far = secs.filter(function (x) { return !x.forSale; });
        A(forSale.length > 0, 'some sections are for sale at the start');
        A(secs.every(function (x) { return x.counts.dry + x.counts.high + x.counts.marsh + x.counts.water === (x.x1 - x.x0 + 1) * (x.y1 - x.y0 + 1); }), 'counts cover every tile');
        A(secs.every(function (x) { return x.price === priceOf(x.counts) && x.price >= fin(PL.base, 400000); }), 'price = base + per-tile');
        A(!M.isChartered(s, secs[0].x0, secs[0].y0), 'an unowned section is not chartered');
        const ref = M.refusal(s, [secs[0].y0 * W + secs[0].x0]); A(!!ref && ref.id === secs[0].id && ref.reason.indexOf(CHARTER_REASON) === 0 && /\$/.test(ref.reason), 'refusal names the section and its price');
        A(M.refusal(s, [L.y0 * W + L.x0]) === null, 'no refusal inside the charter');
        if (far.length) { const q = M.quote(s, far[0].id); A(!q.ok && /next to/.test(q.reason), 'a section away from the charter is not for sale: ' + q.reason); }
        const first = forSale[0];
        s.economy.cash = cashNow = first.price - 1; let q = M.quote(s, first.id); A(!q.ok && /cash/.test(q.reason), 'cash check: ' + q.reason);
        s.economy.cash = cashNow = 50e6; q = M.quote(s, first.id); A(q.ok && q.price === first.price, 'quote ok with cash');
        const r = M.buy(s, first.id, {}); A(r.ok && r.n === 1 && cashNow === 50e6 - first.price, 'buy charges the price (' + JSON.stringify(r) + ')');
        A(M.isChartered(s, first.x0, first.y0) && M.section(s, first.id).owned, 'bought → chartered');
        A(events.length === 1 && events[0].name === 'land:chartered' && events[0].p.id === first.id && cards.length === 1 && cards[0] === 'landFirst' && lines.length === 1, 'event + first-purchase card + ticker once');
        A(!M.buy(s, first.id, {}).ok, 'cannot buy twice');
        // the prestige gate: the 3rd section needs params.land.gates[0][1]
        const g3 = gateFor(3); if (g3 > 0 && secs.length >= 3) {
          const next = M.sections(s).filter(function (x) { return x.forSale; });
          if (next.length >= 2) {
            M.buy(s, next[0].id, { force: true });
            const third = M.sections(s).filter(function (x) { return x.forSale; })[0];
            s.economy.prestige = g3 - 1; q = M.quote(s, third.id); A(!q.ok && /prestige/.test(q.reason) && third.locked && third.gate === g3, 'third section gated by prestige: ' + q.reason);
            s.economy.prestige = g3; q = M.quote(s, third.id); A(q.ok, 'gate opens at prestige ' + g3);
          }
        }
        A(cards.length === 1, 'the first-purchase card shows once');
        // freeShare over a synthetic charter: 4 × 4 dry tiles, one owned → 15 of 16 free
        for (let y = L.y0; y < L.y0 + 4; y++) for (let x = L.x0; x < L.x0 + 4; x++) s.tiles.type[y * W + x] = T.DRY;
        s.tiles.owner[L.y0 * W + L.x0] = 0; s.tick = fin(s.tick, 0) + 1000;
        const fs = M.freeShare(s); A(fs.total === 16 && fs.free === 15 && Math.abs(fs.share - 15 / 16) < 1e-9, 'freeShare counts the charter\'s free dry tiles (' + JSON.stringify(fs) + ')');
      } else {
        A(M.refusal(s, [0]) === null && M.nearestSection(s, 0, 0) === null && !M.quote(s, 1).ok, 'a world the charter covers: no sections, no refusal');
      }
    } catch (e) { fails++; notes.push('threw: ' + (e && e.message)); }
    finally { Object.assign(M._deps, saved); }
    return { ok: fails === 0, notes: notes.join('; ') || 'ok' };
  };
})();
