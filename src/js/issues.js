'use strict';
// issues.js — the ISSUE SPOTLIGHT registry (issue spotlight pass). One place that answers "what is
// wrong on campus right now, where exactly, and what fixes it": buildings without power or water, flooded,
// damaged or ruined buildings, buildings whose path never reached campus, weak levees, full beds / seats /
// dining, gators on campus, mosquito hotspots, the boil-water notice, a brownout and unpowered pumps in the
// rain. The list is recomputed at most every `refreshTicks` (25) ticks and at once after a building / hydro /
// wildlife event. Deterministic (state in, plain objects out), no DOM, no timers; render_fx draws the beacons,
// ui.js the tray. Selection, spotlight mode and the gauge hover pulse live here so render_fx and ui share
// them without events (BSU.EV is a closed registry and contract.js is not edited in this pass).
// Owner branch: none (writes nothing in state). Loads right after buildings.js; every lookup is lazy.
(function () {
  const BSU = window.BSU;
  if (!BSU) return;
  const MAP = BSU.MAP, W = MAP.W, H = MAP.H, N = MAP.N, SURF = BSU.SURF, EV = BSU.EV;
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
  const M = BSU.issues = {};
  function ierr(where, e) { BSU.error('issues', where, e); }
  function mod(n) { return BSU[n] || null; }
  function has(n, f) { const m = mod(n); return !!(m && typeof m[f] === 'function'); }
  function call(n, f) { const m = mod(n); if (!m || typeof m[f] !== 'function') return undefined; return m[f].apply(m, Array.prototype.slice.call(arguments, 2)); }
  function rowOf(id) { const c = BSU.data && BSU.data.catalog; return (c && id) ? c[id] || null : null; }
  function nameOf(id) { const r = rowOf(id); return r ? r.name : id; }

  // ---------------------------------------------------------------------------
  // Kinds: colour (unique per family, used nowhere else in the game), glyph, default severity
  // ---------------------------------------------------------------------------
  const KINDS = Object.freeze({
    unpowered:       Object.freeze({ color: '#FFB03B', glyph: 'bolt',     severity: 2, family: 'power',    label: 'No power' }),
    brownout:        Object.freeze({ color: '#FFB03B', glyph: 'bolt',     severity: 2, family: 'power',    label: 'Brownout' }),
    pumpOff:         Object.freeze({ color: '#FFB03B', glyph: 'bolt',     severity: 3, family: 'power',    label: 'Pump off' }),
    unwatered:       Object.freeze({ color: '#4FC3F7', glyph: 'drop',     severity: 2, family: 'water',    label: 'No water' }),
    boilWater:       Object.freeze({ color: '#4FC3F7', glyph: 'drop',     severity: 2, family: 'water',    label: 'Boil water' }),
    flooded:         Object.freeze({ color: '#2BD4C0', glyph: 'wave',     severity: 3, family: 'flood',    label: 'Flooded' }),
    damaged:         Object.freeze({ color: '#FF5A4F', glyph: 'crack',    severity: 2, family: 'damage',   label: 'Damaged' }),
    unlinkedPath:    Object.freeze({ color: '#FDD023', glyph: 'link',     severity: 1, family: 'path',     label: 'Not linked' }),
    weakLevee:       Object.freeze({ color: '#FF8C42', glyph: 'sandbag',  severity: 2, family: 'levee',    label: 'Weak levee' }),
    overCapacity:    Object.freeze({ color: '#FF7AD9', glyph: 'crowd',    severity: 2, family: 'capacity', label: 'Full' }),
    gatorOnCampus:   Object.freeze({ color: '#7CFF6B', glyph: 'gator',    severity: 3, family: 'gator',    label: 'Gator' }),
    mosquitoHotspot: Object.freeze({ color: '#C77DFF', glyph: 'mosquito', severity: 1, family: 'mosquito', label: 'Mosquitoes' })
  });
  const FAMILY_KINDS = Object.freeze({
    power: ['unpowered', 'brownout', 'pumpOff'], water: ['unwatered', 'boilWater'], flood: ['flooded'], damage: ['damaged'], path: ['unlinkedPath'],
    levee: ['weakLevee'], capacity: ['overCapacity'], gator: ['gatorOnCampus'], mosquito: ['mosquitoHotspot']
  });
  const REFRESH_TICKS = 25, MOSQ_HOT = 0.6, MOSQ_SEVERE = 0.8, MOSQ_CLUSTERS = 3, MOSQ_RADIUS = 3, LEVEE_RUN_MAX = 48;
  const ACCESS = [SURF.PATH, SURF.ROAD, SURF.BOARDWALK, SURF.BRIDGE].filter((v) => Number.isFinite(v));

  // ---------------------------------------------------------------------------
  // Cache, selection, modes
  // ---------------------------------------------------------------------------
  const cache = { state: null, tick: -1e9, list: [], dirty: true, version: 0, computes: 0 };
  const sinceMap = new Map();   // issue id → tick first seen (survives recomputes while the issue persists)
  let selectedId = null, spotlightOn = false, pulseKinds = null, subscribed = false;
  const conn = new Uint8Array(N), ring = new Uint8Array(N), queue = new Int32Array(N), visited = new Uint8Array(N);

  function subscribe() {
    if (subscribed || !BSU.events || typeof BSU.events.on !== 'function') return;
    subscribed = true;
    const names = [EV.BUILDING_PLACED, EV.BUILDING_REMOVED, EV.BUILDING_COMPLETE, EV.BUILDING_FLOODED, EV.BUILDING_DRIED, EV.BUILDING_DAMAGED, EV.BUILDING_REPAIRED,
      EV.POWER_BLACKOUT, EV.POWER_RESTORED, EV.COVERAGE_CHANGED, EV.LEVEE_OVERTOP, EV.LEVEE_BREACH, EV.LEVEE_BURROW, EV.GATOR_CAMPUS, EV.GATOR_RELOCATED, EV.MOSQUITO_WARNING, EV.TILE_CHANGED];
    for (const n of names) { if (!n) continue; try { BSU.events.on(n, function () { cache.dirty = true; }, 'issues'); } catch (e) { ierr('subscribe', e); } }
    try { BSU.events.on(EV.SAVE_LOADED, function () { resetAll(); }, 'issues'); } catch (e) { ierr('subscribe:load', e); }
  }
  function resetAll() { cache.state = null; cache.tick = -1e9; cache.list = []; cache.dirty = true; sinceMap.clear(); selectedId = null; spotlightOn = false; pulseKinds = null; cache.version++; }

  // ---------------------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------------------
  function footprintOf(b) { return BSU.footprintTiles(b.tx | 0, b.ty | 0, Math.max(1, b.w | 0), Math.max(1, b.h | 0)); }
  function anchorOf(b) { return { tx: (b.tx | 0) + (Math.max(1, b.w | 0) - 1) / 2, ty: (b.ty | 0) + (Math.max(1, b.h | 0) - 1) / 2 }; }
  function tileAnchor(i) { return { tx: i % W, ty: (i / W) | 0 }; }
  function mk(out, kind, id, o) {
    const K = KINDS[kind]; if (!K) return;
    out.push({
      id: id, kind: kind, severity: clamp(fin(o.severity, K.severity) | 0, 1, 3), title: String(o.title || K.label), fix: String(o.fix || ''),
      tiles: o.tiles || [], rect: o.rect || null, anchor: o.anchor || tileAnchor(o.tiles && o.tiles.length ? o.tiles[0] : 0),
      buildingId: Number.isFinite(o.buildingId) ? o.buildingId : null, action: o.action || null, since: 0, color: K.color, glyph: K.glyph,
      why: String(o.why || '')   // gator pass: the one-line "why it matters" the tray row and the notification carry
    });
  }
  function isAccess(sf) { return ACCESS.indexOf(sf) >= 0; }
  /** the access network, the same walk buildings.js does privately: surface 1–4 tiles 4-connected to the Highway 1 stub or to Founders' ring */
  function rebuildConn(state) {
    conn.fill(0); ring.fill(0);
    const surf = state.tiles.surface; let head = 0, tail = 0;
    const seed = function (i) { if (i >= 0 && i < N && isAccess(surf[i]) && !conn[i]) { conn[i] = 1; queue[tail++] = i; } };
    const plot = state.plot || {};
    for (const i of (plot.highway || [])) seed(i);
    let fx = plot.founders ? plot.founders.tx : -1, fy = plot.founders ? plot.founders.ty : -1, fw = 3, fh = 3;
    for (const b of call('buildings', 'list', state, 'founders_hall') || []) { fx = b.tx; fy = b.ty; fw = b.w; fh = b.h; }
    if (fx >= 0) for (const i of BSU.edgeTiles(fx, fy, fw, fh)) { ring[i] = 1; seed(i); }
    while (head < tail) {
      const i = queue[head++], tx = i % W, ty = (i / W) | 0;
      if (ty > 0) seed(i - W); if (tx < W - 1) seed(i + 1); if (ty < H - 1) seed(i + W); if (tx > 0) seed(i - 1);
    }
  }
  function linked(state, b) {
    const surf = state.tiles.surface;
    for (const e of BSU.edgeTiles(b.tx | 0, b.ty | 0, Math.max(1, b.w | 0), Math.max(1, b.h | 0))) { if (ring[e]) return true; if (isAccess(surf[e]) && conn[e]) return true; }
    return false;
  }
  function raining(state) { const w = state.weather || {}; return fin(w.rainRate, 0) > 0.05 || !!w.event; }

  function compute(state) {
    const out = [];
    const list = call('buildings', 'list', state) || [];
    const econ = state.economy || {}, sup = !!econ.suppressCoverage, rain = raining(state);
    const subR = fin(((rowOf('substation') || {}).effects || {}).power && rowOf('substation').effects.power.radius, 10);
    const towR = fin(((rowOf('water_tower') || {}).effects || {}).water && rowOf('water_tower').effects.water.radius, 12);
    let connBuilt = false, boilAnchor = null;
    for (const b of list) {
      if (!b || !(b.built >= 1)) continue;
      const row = rowOf(b.type); if (!row) continue;
      const name = b.name || row.name || b.type, tiles = footprintOf(b), rect = { tx: b.tx | 0, ty: b.ty | 0, w: Math.max(1, b.w | 0), h: Math.max(1, b.h | 0) }, anchor = anchorOf(b);
      const base = { tiles: tiles, rect: rect, anchor: anchor, buildingId: b.id };
      if (b.ruin) mk(out, 'damaged', 'damaged:' + b.id, Object.assign({ severity: 3, title: name + ' is in ruins', fix: 'Ruined: click Fix to rebuild it (Repair), or bulldoze it', action: { repair: b.id } }, base));
      else if (fin(b.hp, 1) < 1) mk(out, 'damaged', 'damaged:' + b.id, Object.assign({ severity: 2, title: name + ' is storm-damaged', fix: 'Damaged: click Fix to repair it (Repair all is in the Storm panel)', action: { repair: b.id } }, base));
      if (b.flooded) mk(out, 'flooded', 'flooded:' + b.id, Object.assign({ severity: 3, title: name + ' is flooded', fix: 'Flooded: it dries as the water falls; a Pump or Levee beside it keeps it dry next time', action: { openMenuCard: 'pump' } }, base));
      if (!sup && row.needsPower && !b.powered && !b.flooded && !b.ruin) {
        if (b.type === 'pump' && rain) mk(out, 'pumpOff', 'pumpOff:' + b.id, Object.assign({ severity: 3, title: name + ' has no power in the rain', fix: 'Unpowered pump: place a Substation within ' + subR + ' tiles (or a Generator) so it can run', action: { openMenuCard: 'substation' } }, base));
        else mk(out, 'unpowered', 'unpowered:' + b.id, Object.assign({ severity: 2, title: name + ' has no power', fix: 'No power: place a Substation within ' + subR + ' tiles', action: { openMenuCard: 'substation' } }, base));
      }
      if (!sup && row.needsWater && !b.watered && !b.flooded && !b.ruin) mk(out, 'unwatered', 'unwatered:' + b.id, Object.assign({ severity: 2, title: name + ' has no water', fix: 'No water: place a Water Tower within ' + towR + ' tiles', action: { openMenuCard: 'water_tower' } }, base));
      if (row.pathAdjacency && b.type !== 'founders_hall' && state.tiles && state.tiles.surface) {
        if (!connBuilt) { rebuildConn(state); connBuilt = true; }
        if (!linked(state, b)) mk(out, 'unlinkedPath', 'unlinked:' + b.id, Object.assign({ severity: 1, title: name + ' is not linked to campus', fix: 'No path to campus: lay a Path from its door to a campus path or road', action: { tool: 'path' } }, base));
      }
      if (b.type === 'water_tower' && !boilAnchor && (b.flooded || !b.powered)) boilAnchor = b;
    }
    // boil-water notice (buildings.js: a complete water tower flooded or unpowered)
    try {
      if (call('buildings', 'boilWaterTriggered', state) === true) {
        const b = boilAnchor || (call('buildings', 'list', state, 'water_tower') || [])[0] || null;
        const base = b ? { tiles: footprintOf(b), rect: { tx: b.tx | 0, ty: b.ty | 0, w: b.w | 0, h: b.h | 0 }, anchor: anchorOf(b), buildingId: b.id } : founderBase(state);
        mk(out, 'boilWater', 'boilWater', Object.assign({ severity: 2, title: 'Boil-water notice', fix: 'Boil water: the Water Tower is ' + (b && b.flooded ? 'flooded; keep it dry (Pump / Levee)' : 'unpowered; a Substation within ' + subR + ' tiles restores it'), action: { openMenuCard: b && b.flooded ? 'pump' : 'substation' } }, base));
      }
    } catch (e) { ierr('boilWater', e); }
    // brownout (buildings.stats): consumers outside coverage while a plant exists
    try {
      const st = call('buildings', 'stats', state);
      if (st && st.brownout === true) {
        let dark = 0; for (const b of list) { const r = b && rowOf(b.type); if (b && r && b.built >= 1 && ((r.needsPower && !b.powered) || (r.needsWater && !b.watered))) dark++; }
        const sub = (call('buildings', 'list', state, 'substation') || [])[0] || null;
        const base = sub ? { tiles: footprintOf(sub), rect: { tx: sub.tx | 0, ty: sub.ty | 0, w: sub.w | 0, h: sub.h | 0 }, anchor: anchorOf(sub), buildingId: sub.id } : founderBase(state);
        mk(out, 'brownout', 'brownout', Object.assign({ severity: 2, title: 'Brownout: ' + dark + (dark === 1 ? ' building' : ' buildings') + ' outside coverage', fix: 'Brownout: add a Substation (' + subR + '-tile reach) or Water Tower next to the dark buildings', action: { openMenuCard: 'substation' } }, base));
      }
    } catch (e) { ierr('brownout', e); }
    // weak levees: 4-connected runs of crest tiles under the integrity threshold, anchored at the weakest tile
    try {
      const tl = state.tiles; const weak = fin(BSU.params.hydro && BSU.params.hydro.integrityWeak, 70), half = fin(BSU.params.hydro && BSU.params.hydro.integrityHalf, 50);
      if (tl && tl.crest && tl.integrity) {
        visited.fill(0);
        for (let i = 0; i < N; i++) {
          if (!(tl.crest[i] > 0) || !(tl.integrity[i] < weak) || visited[i]) continue;
          const run = []; let head = 0, tail = 0, worst = i; queue[tail++] = i; visited[i] = 1;
          while (head < tail) {
            const j = queue[head++]; run.push(j); if (tl.integrity[j] < tl.integrity[worst]) worst = j;
            const tx = j % W, ty = (j / W) | 0;
            const nb = [ty > 0 ? j - W : -1, tx < W - 1 ? j + 1 : -1, ty < H - 1 ? j + W : -1, tx > 0 ? j - 1 : -1];
            for (const k of nb) if (k >= 0 && !visited[k] && tl.crest[k] > 0 && tl.integrity[k] < weak) { visited[k] = 1; queue[tail++] = k; }
          }
          run.sort((a, b) => a - b);
          const integ = tl.integrity[worst] | 0;
          mk(out, 'weakLevee', 'weakLevee:' + run[0], { severity: integ < half ? 3 : 2, title: 'Levee weak (' + integ + '%)' + (run.length > 1 ? ' · ' + run.length + ' tiles' : ''), fix: 'Weak levee: click Fix to repair this run before the next surge (Storm panel repairs them all)', tiles: run.slice(0, LEVEE_RUN_MAX), anchor: tileAnchor(worst), action: { repairLevee: worst } });
        }
      }
    } catch (e) { ierr('levees', e); }
    // over capacity: beds / seats / dining binding, anchored at the biggest building of that kind
    try {
      const students = fin(econ.students, 0) | 0;
      if (students > 0) {
        const cap = call('economy', 'capacity', state) || econ.capacityTerms || {};
        const terms = [
          { key: 'beds', cap: fin(cap.beds, 0), effect: 'beds', build: 'dorm', label: 'Beds' },
          { key: 'seats', cap: fin(cap.seats, 0), effect: 'seats', build: 'lecture_hall', label: 'Seats' },
          { key: 'dining', cap: fin(cap.dining, 0), effect: 'feeds', build: 'dining_hall', label: 'Dining' }
        ];
        for (const t of terms) {
          if (!(t.cap <= students)) continue;
          let best = null, bestV = -1;
          for (const b of list) { const r = b && rowOf(b.type); const v = r && r.effects ? fin(r.effects[t.effect], 0) : 0; if (b && b.built >= 1 && v > bestV) { bestV = v; best = b; } }
          const base = best ? { tiles: footprintOf(best), rect: { tx: best.tx | 0, ty: best.ty | 0, w: best.w | 0, h: best.h | 0 }, anchor: anchorOf(best), buildingId: best.id } : founderBase(state);
          mk(out, 'overCapacity', 'overCapacity:' + t.key, Object.assign({ severity: 2, title: t.label + ' full (' + students + ' / ' + t.cap + ')', fix: 'Out of ' + t.label.toLowerCase() + ': build a ' + nameOf(t.build) + ' (students leave when it stays full)', action: { openMenuCard: t.build } }, base));
        }
      }
    } catch (e) { ierr('capacity', e); }
    // gators on campus
    try {
      const gs = call('wildlife', 'onCampus', state) || [];
      for (const g of gs) {
        if (!g) continue;
        const i = clamp(Math.floor(fin(g.ty, 0)), 0, H - 1) * W + clamp(Math.floor(fin(g.tx, 0)), 0, W - 1);
        // gator pass: Fix = relocate (free with a Wildlife Officer Post in range, else the Parish call-out); the why-line and the secondary suggestions come from data.gatorText
        const GT = (BSU.data && BSU.data.gatorText) || {}, PG = (BSU.params.wildlife && BSU.params.wildlife.gator) || {};
        const free = !!call('wildlife', 'canWrangle', state, g.id), st = call('wildlife', 'gatorStatus', state, g.id);
        const fee = BSU.formatMoney(fin(PG.callOutFee, 15000)), days = fin(PG.callOutDays, 1) === 1 ? '1 day' : fin(PG.callOutDays, 1) + ' days';
        const fix = free ? (GT.fixFree || 'Fix: the Wildlife Officer relocates it (free)') : String(GT.fixPaid || 'Fix: Parish Wildlife call-out {fee}, arrives in {days}').replace('{fee}', fee).replace('{days}', days);
        const why = st && st.closes >= 0 ? (GT.whyClosed || '') : (GT.why || '');
        mk(out, 'gatorOnCampus', 'gator:' + fin(g.id, i), { severity: 3, title: (g.name || 'A gator') + ' is on campus' + (st && st.closes >= 0 && st.closesName ? ' · ' + st.closesName + ' closed' : (st && st.delayedVisit > 0 ? ' · ' + st.delayedVisit + ' students rerouted' : '')), fix: fix, why: why, tiles: [i], anchor: tileAnchor(i), action: { relocate: g.id, free: free } });
      }
    } catch (e) { ierr('gators', e); }
    // mosquito hotspots: the top campus tiles over the "Biblical" band, clustered
    try {
      const mq = state.tiles && state.tiles.mosq; const cm = has('wildlife', 'campusMask') ? call('wildlife', 'campusMask', state) : null;
      if (mq && mq.length === N) {
        const cand = [];
        for (let i = 0; i < N; i++) if (mq[i] >= MOSQ_HOT && (!cm || cm[i])) cand.push(i);
        cand.sort((a, b) => (mq[b] - mq[a]) || (a - b));
        const taken = new Uint8Array(N); let clusters = 0;
        for (let k = 0; k < cand.length && clusters < MOSQ_CLUSTERS; k++) {
          const p = cand[k]; if (taken[p]) continue;
          const px = p % W, py = (p / W) | 0, tiles = [];
          for (let m = k; m < cand.length && tiles.length < 9; m++) { const q = cand[m]; if (taken[q]) continue; if (BSU.chebyshev(px, py, q % W, (q / W) | 0) <= MOSQ_RADIUS) { taken[q] = 1; tiles.push(q); } }
          tiles.sort((a, b) => a - b); clusters++;
          const peak = fin(mq[p], 0), cell = ((py / 4) | 0) * 16 + ((px / 4) | 0);   // a 4×4 cell id keeps the issue id (and its age) stable while the peak drifts
          mk(out, 'mosquitoHotspot', 'mosq:' + cell, { severity: peak >= MOSQ_SEVERE ? 2 : 1, title: 'Mosquito hotspot' + (tiles.length > 1 ? ' · ' + tiles.length + ' tiles' : ''), fix: 'Mosquitoes: build Abatement or a Bat House here, or drain the standing water (Canal)', tiles: tiles, anchor: tileAnchor(p), action: { openMenuCard: 'abatement' } });
        }
      }
    } catch (e) { ierr('mosquito', e); }
    return out;
  }
  function founderBase(state) {
    const f = (state.plot && state.plot.founders) || null;
    if (!f) return { tiles: [0], rect: null, anchor: { tx: 32, ty: 32 }, buildingId: null };
    return { tiles: BSU.footprintTiles(f.tx | 0, f.ty | 0, 3, 3), rect: { tx: f.tx | 0, ty: f.ty | 0, w: 3, h: 3 }, anchor: { tx: (f.tx | 0) + 1, ty: (f.ty | 0) + 1 }, buildingId: null };
  }
  function finish(state, out) {
    const tick = fin(state.tick, 0) | 0, seen = new Set();
    for (const it of out) { seen.add(it.id); if (!sinceMap.has(it.id)) sinceMap.set(it.id, tick); it.since = sinceMap.get(it.id); }
    for (const id of Array.from(sinceMap.keys())) if (!seen.has(id)) sinceMap.delete(id);
    out.sort((a, b) => (b.severity - a.severity) || (a.since - b.since) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (selectedId !== null && !seen.has(selectedId)) selectedId = null;
    return out;
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  /** list(state) → the current issues, sorted by severity (3 first) then age (oldest first); cached ≤ 25 ticks */
  M.list = function (state) {
    try {
      state = state || BSU.state; if (!state || !state.tiles) return cache.list;
      subscribe();
      const tick = fin(state.tick, 0) | 0;
      if (cache.state !== state) { resetAll(); cache.state = state; }
      if (!cache.dirty && tick >= cache.tick && tick - cache.tick < REFRESH_TICKS && cache.list) return cache.list;
      cache.list = finish(state, compute(state)); cache.tick = tick; cache.dirty = false; cache.version++; cache.computes++;
      return cache.list;
    } catch (e) { ierr('list', e); return cache.list || []; }
  };
  M.invalidate = function () { cache.dirty = true; };
  M.version = function () { return cache.version; };
  M.byId = function (state, id) { const l = M.list(state); for (let k = 0; k < l.length; k++) if (l[k].id === id) return l[k]; return null; };
  M.ofKinds = function (state, kinds) { const l = M.list(state), set = Array.isArray(kinds) ? kinds : [kinds]; return l.filter((it) => set.indexOf(it.kind) >= 0); };
  M.ofFamily = function (state, family) { return M.ofKinds(state, FAMILY_KINDS[family] || []); };
  M.summary = function (state) { const l = M.list(state); const s = { count: l.length, worst: 0, bySeverity: [0, 0, 0, 0] }; for (const it of l) { s.bySeverity[it.severity]++; if (it.severity > s.worst) s.worst = it.severity; } return s; };
  M.select = function (id) { selectedId = (id === undefined || id === null) ? null : String(id); cache.version++; return selectedId; };
  M.selectedId = function () { return selectedId; };
  M.selected = function (state) { return selectedId === null ? null : M.byId(state, selectedId); };
  /** cycle(state, dir) → the next issue after the selected one (wraps; dir −1 goes back) and selects it; null when there are none */
  M.cycle = function (state, dir) {
    const l = M.list(state); if (!l.length) { selectedId = null; return null; }
    dir = dir < 0 ? -1 : 1; let k = -1;
    for (let j = 0; j < l.length; j++) if (l[j].id === selectedId) { k = j; break; }
    const next = l[(k < 0 ? (dir > 0 ? 0 : l.length - 1) : (k + dir + l.length) % l.length)];
    selectedId = next.id; cache.version++;
    return next;
  };
  /** spotlight(on?) → spotlight mode (the map dims except issue tiles); render_fx reads it every frame */
  M.spotlight = function (on) { if (on !== undefined) { spotlightOn = !!on; cache.version++; } return spotlightOn; };
  /** pulse(kinds | family | null): beacons of these kinds pulse hard (the Power / Water gauge hover) */
  M.pulse = function (kinds) { if (kinds === null || kinds === undefined) pulseKinds = null; else if (typeof kinds === 'string') pulseKinds = (FAMILY_KINDS[kinds] || [kinds]).slice(); else pulseKinds = Array.isArray(kinds) ? kinds.slice() : null; return pulseKinds; };
  M.pulsing = function () { return pulseKinds; };
  M.isPulsing = function (kind) { return !!(pulseKinds && pulseKinds.indexOf(kind) >= 0); };
  M.kinds = function () { return KINDS; };
  M.families = function () { return FAMILY_KINDS; };
  M.colorOf = function (kind) { const K = KINDS[kind]; return K ? K.color : '#FDD023'; };
  M.glyphOf = function (kind) { const K = KINDS[kind]; return K ? K.glyph : 'link'; };
  M.familyOf = function (kind) { const K = KINDS[kind]; return K ? K.family : ''; };
  /** age in ticks → '12s', '3m', '2d' at 1× (ticksPerDay from params.time) */
  M.ageText = function (state, it) {
    const tpd = fin(BSU.params.time && BSU.params.time.ticksPerDay, 200), tps = fin(BSU.params.time && BSU.params.time.baseTps, 5);
    const age = Math.max(0, (fin(state && state.tick, 0) | 0) - fin(it && it.since, 0));
    if (age >= tpd) return Math.floor(age / tpd) + 'd';
    const s = Math.round(age / tps); return s >= 60 ? Math.floor(s / 60) + 'm' : s + 's';
  };
  M.refreshTicks = REFRESH_TICKS;
  M.init = function (state) { try { subscribe(); if (state) M.list(state); } catch (e) { ierr('init', e); } };
  M.reset = function (state, fresh) { void fresh; resetAll(); if (state) cache.state = null; };
  M.stats = function () { return { computes: cache.computes, version: cache.version, cached: cache.list.length, tick: cache.tick }; };

  // ---------------------------------------------------------------------------
  // selfTest: synthetic buildings on a fresh state (no terrain/hydro needed), deterministic
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const A = function (c, m) { if (!c) throw new Error('issues.selfTest: ' + m); };
    const s = BSU.newState(7); s.tick = 100; s.economy.suppressCoverage = false; s.economy.students = 0;
    const struct = function (id, type, tx, ty, o) { const r = rowOf(type); const d = r ? { w: r.w, h: r.h } : { w: 1, h: 1 }; const b = Object.assign({ id: id, type: type, tx: tx, ty: ty, w: fin(d.w, 1), h: fin(d.h, 1), rot: 0, name: '', hp: 1, built: 1, builtDay: 0, pilings: false, sunk: 0, powered: true, watered: true, provider: { power: -1, water: -1 }, flooded: false, floodedSince: -1, closedUntil: -1, blackout: false, tier: 0, upgradeDoneDay: -1, ruin: false, tarp: false }, o || {}); s.buildings[id] = b; return b; };
    s.buildings = [];
    const dorm = struct(0, 'dorm', 20, 20, { powered: false, name: 'Tiger Hall' });
    // lay a path from the dorm's edge to the founders ring so it is linked (a reachable network root)
    s.plot = s.plot || {}; s.plot.founders = { tx: 20, ty: 26 }; s.plot.highway = [];
    const surf = s.tiles.surface; for (let y = 20 + dorm.h; y < 26; y++) surf[BSU.idx(20, y)] = SURF.PATH;
    let l = M.list(s);
    const up = l.find((it) => it.kind === 'unpowered');
    A(up && up.buildingId === 0 && up.rect && up.rect.tx === 20 && up.tiles.length === dorm.w * dorm.h, 'a dorm with no substation is an unpowered issue with its footprint');
    A(/No power: place a Substation within 10 tiles/.test(up.fix) && /Tiger Hall/.test(up.title), 'fix text: ' + up.fix);
    A(up.action && up.action.openMenuCard === 'substation' && up.since === 100 && up.severity === 2, 'action opens the Substation card; since = the tick');
    A(!l.some((it) => it.kind === 'unlinkedPath'), 'a path to Founders\' ring links the dorm');
    surf[BSU.idx(20, 25)] = SURF.NONE; M.invalidate(); l = M.list(s);
    A(l.some((it) => it.kind === 'unlinkedPath' && it.action.tool === 'path'), 'breaking the path → unlinkedPath with the path tool');
    // cache: same tick, no invalidation → same array
    const l2 = M.list(s); A(l2 === l, 'cached between refreshes');
    s.tick = 100 + REFRESH_TICKS; const l3 = M.list(s); A(l3 !== l && l3.length === l.length, 'recomputed after refreshTicks');
    A(l3.find((it) => it.kind === 'unpowered').since === 100, 'since survives a recompute');
    // flooded + ruin + hp
    dorm.flooded = true; M.invalidate(); l = M.list(s);
    A(l.some((it) => it.kind === 'flooded' && it.severity === 3) && !l.some((it) => it.kind === 'unpowered'), 'flooded (sev 3) replaces unpowered while under water');
    dorm.flooded = false; dorm.hp = 0.4; M.invalidate(); l = M.list(s);
    A(l.some((it) => it.kind === 'damaged' && it.action.repair === 0 && it.severity === 2), 'hp < 1 → damaged with a repair action');
    dorm.ruin = true; M.invalidate(); l = M.list(s); A(l.find((it) => it.kind === 'damaged').severity === 3, 'ruin → severity 3');
    dorm.ruin = false; dorm.hp = 1; dorm.powered = true;
    // pump in the rain, water tower boil notice is buildings' call (skipped), weak levee run
    struct(1, 'pump', 30, 30, { powered: false }); s.weather.rainRate = 0.5; M.invalidate(); l = M.list(s);
    A(l.some((it) => it.kind === 'pumpOff' && it.severity === 3), 'an unpowered pump in the rain is pumpOff (sev 3)');
    s.weather.rainRate = 0; M.invalidate(); l = M.list(s); A(l.some((it) => it.kind === 'unpowered' && it.buildingId === 1) && !l.some((it) => it.kind === 'pumpOff'), 'dry → plain unpowered');
    s.buildings[1] = null;
    const tl = s.tiles; for (let x = 40; x < 44; x++) { tl.crest[BSU.idx(x, 10)] = 6; tl.integrity[BSU.idx(x, 10)] = x === 42 ? 40 : 65; }
    M.invalidate(); l = M.list(s);
    const lv = l.find((it) => it.kind === 'weakLevee');
    A(lv && lv.tiles.length === 4 && lv.anchor.tx === 42 && lv.severity === 3 && lv.action.repairLevee === BSU.idx(42, 10) && /40%/.test(lv.title), 'weak levee run → one issue anchored at the weakest tile');
    for (let x = 40; x < 44; x++) { tl.crest[BSU.idx(x, 10)] = 0; tl.integrity[BSU.idx(x, 10)] = 100; }
    // sorting: severity desc then age asc; selection cycles and clears
    struct(2, 'lecture_hall', 10, 10, { watered: false }); M.invalidate(); l = M.list(s);
    A(l.some((it) => it.kind === 'unwatered' && /Water Tower within 12 tiles/.test(it.fix)), 'unwatered fix names the tower radius');
    for (let k = 1; k < l.length; k++) A(l[k - 1].severity > l[k].severity || (l[k - 1].severity === l[k].severity && l[k - 1].since <= l[k].since), 'sorted by severity then age');
    A(M.selected(s) === null, 'nothing selected at first');
    const c1 = M.cycle(s, 1); A(c1 && c1.id === l[0].id && M.selectedId() === l[0].id, 'I cycles to the first issue');
    const c2 = M.cycle(s, 1); A(c2 && c2.id === l[1 % l.length].id, 'then the next');
    for (let k = 0; k < l.length; k++) M.cycle(s, 1); A(M.selectedId() === c2.id, 'wraps around');
    M.cycle(s, -1); A(M.selectedId() === l[0].id, 'Shift-direction goes back');
    M.select(null); A(M.selected(s) === null, 'select(null) clears');
    M.select(l[0].id); s.buildings = []; M.invalidate(); l = M.list(s); A(l.length === 0 && M.selected(s) === null, 'selection drops with its issue');
    A(M.spotlight() === false && M.spotlight(true) === true && M.spotlight(false) === false, 'spotlight getter/setter');
    A(M.pulse('power').length === 3 && M.isPulsing('pumpOff') && M.pulse(null) === null && !M.isPulsing('pumpOff'), 'pulse by family');
    A(M.colorOf('flooded') === '#2BD4C0' && M.glyphOf('gatorOnCampus') === 'gator' && M.colorOf('nope') === '#FDD023', 'kind table');
    const cols = Object.keys(KINDS).map((k) => KINDS[k].family + ':' + KINDS[k].color); A(new Set(cols.map((c) => c.split(':')[1])).size === Object.keys(FAMILY_KINDS).length, 'one colour per family');
    A(M.ageText({ tick: 100 }, { since: 100 }) === '0s' && M.ageText({ tick: 100 + 200 * 3 }, { since: 100 }) === '3d', 'ageText');
    resetAll();
    return { ok: true, notes: notes.join('; ') };
  };
})();
