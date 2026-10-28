'use strict';
// issues.js — the ISSUE SPOTLIGHT registry (issue spotlight pass; issues v2 pass). One place that answers "what is
// wrong on campus right now, where exactly, what fixes it, and is a fix already underway": buildings without power
// or water, flooded, damaged or ruined buildings, buildings whose path never reached campus, weak levees, full beds /
// seats / dining, mosquito hotspots, the boil-water notice, a brownout and unpowered pumps in the rain (gators are
// wildlife, never an issue: calm alerts + ambient gators pass). The list is recomputed at most every
// `params.issues.refreshTicks` (25) ticks and at once after any building / power / coverage / levee / flood / repair
// event. Deterministic (state in, plain objects out), no DOM, no timers; render_fx draws the beacons, ui.js the tray.
// Selection, spotlight mode and the gauge hover pulse live here so render_fx and ui share them without events;
// snoozes / dismissals are saved with the game (state.ui.issues), mutes and the Alerts mode in the settings.
// Calm alerts pass: `beacons(state, camTx, camTy)` is the capped, severity-gated list the map draws (≤ beaconMax,
// most severe then nearest; severity-1 KINDS and muted kinds never beacon and are "suggestions" in the tray);
// `toastGate(state, kinds)` says whether an issue notification may show right now (mode, severity, once per kind per week).
// Every issue: {id, kind, severity 1–3, title, fix, why, persist, tiles, rect, anchor, buildingId, action, cost,
// resolvable, progress {text, days} | null, hidden '' | 'snoozed' | 'dismissed', sig, since, color, glyph}.
// `list()` = the rows the tray and the beacons show (hidden ones left out); `actionable()` = those with no fix
// underway (the count, I-cycling); `all()` = everything. Owner branch: none (writes nothing in state).
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
  function PI() { return (BSU.params && BSU.params.issues) || {}; }
  function money(v) { return BSU.formatMoney ? BSU.formatMoney(v) : '$' + v; }

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
    mosquitoHotspot: Object.freeze({ color: '#C77DFF', glyph: 'mosquito', severity: 1, family: 'mosquito', label: 'Mosquitoes' })
  });
  const FAMILY_KINDS = Object.freeze({
    power: ['unpowered', 'brownout', 'pumpOff'], water: ['unwatered', 'boilWater'], flood: ['flooded'], damage: ['damaged'], path: ['unlinkedPath'],
    levee: ['weakLevee'], capacity: ['overCapacity'], mosquito: ['mosquitoHotspot']
  });
  const ALERT_MODES = (Array.isArray(PI().alertModes) && PI().alertModes.length === 3) ? PI().alertModes.slice() : ['normal', 'quiet', 'off'];
  const REFRESH_TICKS = Math.max(1, fin(PI().refreshTicks, 25) | 0), MOSQ_HOT = 0.6, MOSQ_SEVERE = 0.8, MOSQ_CLUSTERS = 3, MOSQ_RADIUS = 3, LEVEE_RUN_MAX = 48;
  const ACCESS = [SURF.PATH, SURF.ROAD, SURF.BOARDWALK, SURF.BRIDGE].filter((v) => Number.isFinite(v));

  // ---------------------------------------------------------------------------
  // Cache, selection, modes; snoozes / dismissals live in state.ui.issues (saved), mutes + the Alerts mode in the settings
  // ---------------------------------------------------------------------------
  const cache = { state: null, tick: -1e9, list: [], all: [], active: [], main: [], suggest: [], dirty: true, version: 0, computes: 0 };
  const sinceMap = new Map();   // issue id → tick first seen (survives recomputes while the issue persists)
  const depthMemo = new Map();  // flooded id → last depth (ft): "receding" when it drops between refreshes
  const toastStamp = {};        // kind / family → day of the last issue toast of that key (one per toastPerKindDays)
  let selectedId = null, spotlightOn = false, pulseKinds = null, subscribed = false;
  const conn = new Uint8Array(N), ring = new Uint8Array(N), queue = new Int32Array(N), visited = new Uint8Array(N);
  /** the saved snooze / dismissal store on state.ui (created lazily for saves from before this pass) */
  function store(state) {
    const u = state && state.ui; if (!u) return { snoozed: {}, dismissed: {} };
    if (!u.issues || typeof u.issues !== 'object') u.issues = { snoozed: {}, dismissed: {} };
    if (!u.issues.snoozed || typeof u.issues.snoozed !== 'object') u.issues.snoozed = {};
    if (!u.issues.dismissed || typeof u.issues.dismissed !== 'object') u.issues.dismissed = {};
    return u.issues;
  }
  function settingsOf(state) { const u = state && state.ui; if (!u) return {}; if (!u.settings || typeof u.settings !== 'object') u.settings = {}; return u.settings; }
  function mutedMap(state) { const s = settingsOf(state); if (!s.mutedIssues || typeof s.mutedIssues !== 'object') s.mutedIssues = {}; return s.mutedIssues; }

  function subscribe() {
    if (subscribed || !BSU.events || typeof BSU.events.on !== 'function') return;
    subscribed = true;
    const names = [EV.BUILDING_PLACED, EV.BUILDING_REMOVED, EV.BUILDING_COMPLETE, EV.BUILDING_UPGRADED, EV.BUILDING_FLOODED, EV.BUILDING_DRIED, EV.BUILDING_DAMAGED, EV.BUILDING_REPAIRED,
      EV.POWER_BLACKOUT, EV.POWER_RESTORED, EV.COVERAGE_CHANGED, EV.LEVEE_OVERTOP, EV.LEVEE_BREACH, EV.LEVEE_BURROW,
      EV.MOSQUITO_WARNING, EV.TILE_CHANGED, EV.STORM_LANDFALL, EV.STORM_PHASE];
    for (const n of names) { if (!n) continue; try { BSU.events.on(n, function () { cache.dirty = true; }, 'issues'); } catch (e) { ierr('subscribe', e); } }
    try { BSU.events.on(EV.SAVE_LOADED, function () { resetAll(); }, 'issues'); } catch (e) { ierr('subscribe:load', e); }
  }
  function resetAll() { cache.state = null; cache.tick = -1e9; cache.list = []; cache.all = []; cache.active = []; cache.main = []; cache.suggest = []; cache.dirty = true; sinceMap.clear(); depthMemo.clear(); for (const k in toastStamp) delete toastStamp[k]; selectedId = null; spotlightOn = false; pulseKinds = null; cache.version++; }

  // ---------------------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------------------
  function footprintOf(b) { return BSU.footprintTiles(b.tx | 0, b.ty | 0, Math.max(1, b.w | 0), Math.max(1, b.h | 0)); }
  function anchorOf(b) { return { tx: (b.tx | 0) + (Math.max(1, b.w | 0) - 1) / 2, ty: (b.ty | 0) + (Math.max(1, b.h | 0) - 1) / 2 }; }
  function tileAnchor(i) { return { tx: i % W, ty: (i / W) | 0 }; }
  function rectDist(a, b) {   // buildings.js's rectDist: the Chebyshev gap between two footprints (0 when they touch)
    const dx = Math.max(0, (b.tx | 0) - ((a.tx | 0) + Math.max(1, a.w | 0) - 1), (a.tx | 0) - ((b.tx | 0) + Math.max(1, b.w | 0) - 1));
    const dy = Math.max(0, (b.ty | 0) - ((a.ty | 0) + Math.max(1, a.h | 0) - 1), (a.ty | 0) - ((b.ty | 0) + Math.max(1, b.h | 0) - 1));
    return Math.max(dx, dy);
  }
  function mk(out, kind, id, o) {
    const K = KINDS[kind]; if (!K) return;
    out.push({
      id: id, kind: kind, severity: clamp(fin(o.severity, K.severity) | 0, 1, 3), title: String(o.title || K.label), fix: String(o.fix || ''),
      tiles: o.tiles || [], rect: o.rect || null, anchor: o.anchor || tileAnchor(o.tiles && o.tiles.length ? o.tiles[0] : 0),
      buildingId: Number.isFinite(o.buildingId) ? o.buildingId : null, action: o.action || null, since: 0, color: K.color, glyph: K.glyph,
      why: String(o.why || ''),               // gator pass: the one-line "why it matters" the tray row and the notification carry
      persist: String(o.persist || ''),       // issues v2: why the row is still here (the row tooltip)
      cost: Math.max(0, fin(o.cost, 0)),      // issues v2: what the one-click fix costs (0 = free / not a one-click fix)
      resolvable: !!o.resolvable,             // issues v2: a zero-click fix exists right now (repair within cash, link within cash, free wrangle)
      progress: o.progress || null,           // issues v2: {text, days} when a fix is underway (a provider under construction, the truck booked, water receding)
      stage: String(o.stage || ''),           // issues v2: the condition's stage; a dismissal lasts while kind + severity + stage hold
      hidden: '', sig: ''
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
  function cashOf(state) { return fin(state.economy && state.economy.cash, 0); }
  function afford(state, cost) { const E = mod('economy'); if (E && typeof E.canAfford === 'function') { try { return !!E.canAfford(state, cost); } catch (e) { /* fall through */ } } return cashOf(state) >= cost; }
  function daysLeft(b) { const r = rowOf(b.type); const days = Math.max(1, fin(r && r.buildDays, 1)); return Math.max(1, Math.ceil((1 - fin(b.built, 0)) * days - 1e-9)); }
  function dayText(n) { return n === 1 ? '1 day' : n + ' days'; }
  /** a building of one of `types` under construction whose footprint sits within `reach` of `near` (a building or a {tx, ty, w, h} rect): the "in progress" line */
  function building(list, types, near, reach) {
    let best = null, bestD = Infinity;
    for (const b of list) {
      if (!b || b.ruin || !(fin(b.built, 0) < 1) || types.indexOf(b.type) < 0) continue;
      const d = near ? rectDist(near, b) : 0;
      if (d <= reach && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }
  function progressOf(b, extra) { return b ? { text: nameOf(b.type) + ' under construction' + (extra ? ' ' + extra : '') + ' (' + dayText(daysLeft(b)) + ')', days: daysLeft(b), buildingId: b.id } : null; }
  function tutorialBeforeHousing(state) {
    const p = state.progress || {}, intro = (state.ui && state.ui.tabsIntroduced) || {};
    return fin(p.tutorialStage, 6) < 6 && !intro.housing;
  }

  function compute(state) {
    const out = [];
    const list = call('buildings', 'list', state) || [];
    const econ = state.economy || {}, sup = !!econ.suppressCoverage, rain = raining(state);
    const subR = fin(((rowOf('substation') || {}).effects || {}).power && rowOf('substation').effects.power.radius, 10);
    const genR = fin(((rowOf('generator') || {}).effects || {}).power && rowOf('generator').effects.power.radius, 6);
    const towR = fin(((rowOf('water_tower') || {}).effects || {}).water && rowOf('water_tower').effects.water.radius, 12);
    let connBuilt = false, boilAnchor = null;
    const powerProgress = function (b) { return progressOf(building(list, ['substation'], b, subR) || building(list, ['generator'], b, genR)); };
    const waterProgress = function (b) { return progressOf(building(list, ['water_tower'], b, towR)); };
    for (const b of list) {
      if (!b || !(b.built >= 1)) continue;
      const row = rowOf(b.type); if (!row) continue;
      const name = b.name || row.name || b.type, tiles = footprintOf(b), rect = { tx: b.tx | 0, ty: b.ty | 0, w: Math.max(1, b.w | 0), h: Math.max(1, b.h | 0) }, anchor = anchorOf(b);
      const base = { tiles: tiles, rect: rect, anchor: anchor, buildingId: b.id };
      if (b.ruin || fin(b.hp, 1) < 1) {
        const cost = fin(call('buildings', 'repairCost', state, b.id), 0), can = afford(state, cost);
        mk(out, 'damaged', 'damaged:' + b.id, Object.assign({
          severity: b.ruin ? 3 : 2, title: name + (b.ruin ? ' is in ruins' : ' is storm-damaged'),
          fix: (b.ruin ? 'Ruined: Fix rebuilds it' : 'Damaged: Fix repairs it') + ' for ' + money(cost) + (can ? '' : ' (not enough cash)') + ' · Repair all is in the Storm panel',
          persist: can ? 'Repair ' + money(cost) + ' · one click' : 'Not enough cash: the repair costs ' + money(cost) + ' (you have ' + money(cashOf(state)) + ')',
          action: { repair: b.id }, cost: cost, resolvable: can, stage: b.ruin ? 'ruin' : 'hp'
        }, base));
      }
      if (b.flooded) {
        const depth = fin(call('hydro', 'footprintDepth', state, b.id), 0), last = depthMemo.get(b.id), receding = Number.isFinite(last) && depth < last - 0.005;
        depthMemo.set(b.id, depth);
        const thr = fin(BSU.params.hydro && BSU.params.hydro.thresholds && BSU.params.hydro.thresholds.flood, 0.5);
        mk(out, 'flooded', 'flooded:' + b.id, Object.assign({
          severity: 3, title: name + ' is flooded' + (depth > 0 ? ' · ' + depth.toFixed(1) + ' ft' : ''),
          fix: 'Flooded: it dries once the water drops under ' + thr + ' ft; Fix arms a Pump beside it (a Levee keeps it dry next time)',
          persist: receding ? 'Water receding: ' + depth.toFixed(1) + ' ft now, dry under ' + thr + ' ft' : 'Standing water ' + depth.toFixed(1) + ' ft: a powered Pump on a canal drains it, a Levee keeps the surge out',
          action: { openMenuCard: 'pump', arm: 'pump', near: b.id, reach: 6 }, progress: receding ? { text: 'Water receding · ' + depth.toFixed(1) + ' ft', days: 0 } : null, stage: 'wet'
        }, base));
      } else depthMemo.delete(b.id);
      if (!sup && row.needsPower && !b.powered && !b.flooded && !b.ruin) {
        const pr = powerProgress(b), act = { openMenuCard: 'substation', arm: 'substation', near: b.id, reach: subR };
        if (b.type === 'pump' && rain) mk(out, 'pumpOff', 'pumpOff:' + b.id, Object.assign({ severity: 3, title: name + ' has no power in the rain', fix: 'Unpowered pump: Fix arms a Substation within ' + subR + ' tiles (or a Generator) so it can run', persist: 'No Substation (' + subR + '-tile reach) or Generator covers it yet', action: act, progress: pr }, base));
        else mk(out, 'unpowered', 'unpowered:' + b.id, Object.assign({ severity: 2, title: name + ' has no power', fix: 'No power: place a Substation within ' + subR + ' tiles', persist: 'No Substation (' + subR + '-tile reach) covers it yet, or the nearest one is full', action: act, progress: pr }, base));
      }
      if (!sup && row.needsWater && !b.watered && !b.flooded && !b.ruin) mk(out, 'unwatered', 'unwatered:' + b.id, Object.assign({ severity: 2, title: name + ' has no water', fix: 'No water: place a Water Tower within ' + towR + ' tiles', persist: 'No Water Tower (' + towR + '-tile reach) covers it yet; a tower needs power itself', action: { openMenuCard: 'water_tower', arm: 'water_tower', near: b.id, reach: towR }, progress: waterProgress(b) }, base));
      if (row.pathAdjacency && b.type !== 'founders_hall' && state.tiles && state.tiles.surface) {
        if (!connBuilt) { rebuildConn(state); connBuilt = true; }
        if (!linked(state, b)) {
          const q = call('buildings', 'linkQuote', state, b.id) || { ok: false, tiles: [], cost: 0, reason: '' };
          const n = q.tiles ? q.tiles.length : 0;
          mk(out, 'unlinkedPath', 'unlinked:' + b.id, Object.assign({
            severity: 1, title: name + ' is not linked to campus',
            fix: q.ok ? 'No path to campus: Fix lays a ' + n + '-tile gravel tie for ' + money(q.cost) : 'No path to campus: ' + (q.reason || 'lay a Path from its door to a campus path or road'),
            persist: q.ok ? 'Link it: ' + n + (n === 1 ? ' tile' : ' tiles') + ' of path for ' + money(q.cost) : (q.reason || 'No route found'),
            action: { link: b.id, tool: 'path' }, cost: fin(q.cost, 0), resolvable: !!q.ok, stage: q.ok ? 'route' : 'noroute'
          }, base));
        }
      }
      if (b.type === 'water_tower' && !boilAnchor && (b.flooded || !b.powered)) boilAnchor = b;
    }
    // boil-water notice (buildings.js: a complete water tower flooded or unpowered)
    try {
      if (call('buildings', 'boilWaterTriggered', state) === true) {
        const b = boilAnchor || (call('buildings', 'list', state, 'water_tower') || [])[0] || null;
        const base = b ? { tiles: footprintOf(b), rect: { tx: b.tx | 0, ty: b.ty | 0, w: b.w | 0, h: b.h | 0 }, anchor: anchorOf(b), buildingId: b.id } : founderBase(state);
        const wet = !!(b && b.flooded);
        mk(out, 'boilWater', 'boilWater', Object.assign({ severity: 2, title: 'Boil-water notice', fix: 'Boil water: the Water Tower is ' + (wet ? 'flooded; keep it dry (Pump / Levee)' : 'unpowered; a Substation within ' + subR + ' tiles restores it'),
          persist: wet ? 'The tower stands in water: the notice lifts once it dries and runs for a day' : 'The tower has no power: the notice lifts a day after power is restored',
          action: wet ? { openMenuCard: 'pump', arm: 'pump', near: b.id, reach: 6 } : { openMenuCard: 'substation', arm: 'substation', near: b ? b.id : null, reach: subR }, progress: b ? (wet ? null : powerProgress(b)) : null }, base));
      }
    } catch (e) { ierr('boilWater', e); }
    // brownout (buildings.stats): consumers outside coverage while a plant exists
    try {
      const st = call('buildings', 'stats', state);
      if (st && st.brownout === true) {
        let dark = 0, first = null; for (const b of list) { const r = b && rowOf(b.type); if (b && r && b.built >= 1 && ((r.needsPower && !b.powered) || (r.needsWater && !b.watered))) { dark++; if (!first) first = b; } }
        const sub = (call('buildings', 'list', state, 'substation') || [])[0] || null;
        const base = sub ? { tiles: footprintOf(sub), rect: { tx: sub.tx | 0, ty: sub.ty | 0, w: sub.w | 0, h: sub.h | 0 }, anchor: anchorOf(sub), buildingId: sub.id } : founderBase(state);
        mk(out, 'brownout', 'brownout', Object.assign({ severity: 2, title: 'Brownout: ' + dark + (dark === 1 ? ' building' : ' buildings') + ' outside coverage', fix: 'Brownout: add a Substation (' + subR + '-tile reach) or Water Tower next to the dark buildings',
          persist: dark + ' building' + (dark === 1 ? '' : 's') + ' still outside a provider\'s reach (each has its own row)', action: { openMenuCard: 'substation', arm: 'substation', near: first ? first.id : null, reach: subR }, progress: first ? powerProgress(first) : null }, base));
      }
    } catch (e) { ierr('brownout', e); }
    // weak levees: 4-connected runs of crest tiles under the integrity threshold, anchored at the weakest tile; Fix repairs the whole run
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
          const integ = tl.integrity[worst] | 0, tiles = run.slice(0, LEVEE_RUN_MAX);
          const q = call('buildings', 'leveeRunQuote', state, tiles) || { ok: false, cost: 0, count: tiles.length, reason: '' };
          mk(out, 'weakLevee', 'weakLevee:' + run[0], { severity: integ < half ? 3 : 2, title: 'Levee weak (' + integ + '%)' + (run.length > 1 ? ' · ' + run.length + ' tiles' : ''),
            fix: 'Weak levee: Fix repairs the whole run (' + q.count + (q.count === 1 ? ' tile' : ' tiles') + ', ' + money(q.cost) + ')' + (q.ok ? '' : ' — ' + q.reason) + ' · the Storm panel repairs them all',
            persist: q.ok ? 'Repair the run: ' + money(q.cost) + ' · one click' : (q.reason || 'Cannot repair'), tiles: tiles, anchor: tileAnchor(worst), action: { repairLevee: worst, run: tiles }, cost: fin(q.cost, 0), resolvable: !!q.ok, stage: integ < half ? 'half' : 'weak' });
        }
      }
    } catch (e) { ierr('levees', e); }
    // over capacity: beds / seats / dining binding, anchored at the biggest building of that kind (suppressed while the cap penalties are suspended / the tutorial has not introduced housing)
    try {
      const students = fin(econ.students, 0) | 0;
      if (students > 0 && !econ.suspendCapPenalties && !tutorialBeforeHousing(state)) {
        const cap = call('economy', 'capacity', state) || econ.capacityTerms || {};
        const terms = [
          { key: 'beds', cap: fin(cap.beds, 0), effect: 'beds', build: 'dorm', label: 'Beds', unit: 'beds' },
          { key: 'seats', cap: fin(cap.seats, 0), effect: 'seats', build: 'lecture_hall', label: 'Seats', unit: 'seats' },
          { key: 'dining', cap: fin(cap.dining, 0), effect: 'feeds', build: 'dining_hall', label: 'Dining', unit: 'meals' }
        ];
        for (const t of terms) {
          if (!(t.cap <= students)) continue;
          let best = null, bestV = -1;
          for (const b of list) { const r = b && rowOf(b.type); const v = r && r.effects ? fin(r.effects[t.effect], 0) : 0; if (b && b.built >= 1 && v > bestV) { bestV = v; best = b; } }
          const base = best ? { tiles: footprintOf(best), rect: { tx: best.tx | 0, ty: best.ty | 0, w: best.w | 0, h: best.h | 0 }, anchor: anchorOf(best), buildingId: best.id } : founderBase(state);
          const adds = fin(((rowOf(t.build) || {}).effects || {})[t.effect], 0);
          let uc = null; for (const b of list) { const r = b && rowOf(b.type); if (b && !b.ruin && fin(b.built, 0) < 1 && r && r.effects && fin(r.effects[t.effect], 0) > 0) { uc = b; break; } }
          const pr = uc ? progressOf(uc, '(+' + fin(((rowOf(uc.type) || {}).effects || {})[t.effect], 0) + ' ' + t.unit + ')') : null;
          mk(out, 'overCapacity', 'overCapacity:' + t.key, Object.assign({ severity: 2, title: t.label + ' full (' + students + ' / ' + t.cap + ')', fix: 'Out of ' + t.label.toLowerCase() + ': Fix arms a ' + nameOf(t.build) + ' (+' + adds + ' ' + t.unit + '); students leave when it stays full',
            persist: students + ' students, ' + t.cap + ' ' + t.unit + ': a ' + nameOf(t.build) + ' adds ' + adds, action: { openMenuCard: t.build, arm: t.build, near: best ? best.id : null, reach: 12 }, progress: pr, stage: t.key }, base));
        }
      }
    } catch (e) { ierr('capacity', e); }
    // (gators: never an issue — calm alerts + ambient gators pass)
    // mosquito hotspots: the top campus tiles over the "Biblical" band, clustered
    try {
      const mq = state.tiles && state.tiles.mosq; const cm = has('wildlife', 'campusMask') ? call('wildlife', 'campusMask', state) : null;
      if (mq && mq.length === N) {
        const cand = [];
        for (let i = 0; i < N; i++) if (mq[i] >= MOSQ_HOT && (!cm || cm[i])) cand.push(i);
        cand.sort((a, b) => (mq[b] - mq[a]) || (a - b));
        const taken = new Uint8Array(N); let clusters = 0;
        const abR = fin((((rowOf('abatement') || {}).effects || {}).mosquito || {}).radius, 8), bhR = fin((((rowOf('bat_house') || {}).effects || {}).mosquito || {}).radius, 4);
        for (let k = 0; k < cand.length && clusters < MOSQ_CLUSTERS; k++) {
          const p = cand[k]; if (taken[p]) continue;
          const px = p % W, py = (p / W) | 0, tiles = [];
          for (let m = k; m < cand.length && tiles.length < 9; m++) { const q = cand[m]; if (taken[q]) continue; if (BSU.chebyshev(px, py, q % W, (q / W) | 0) <= MOSQ_RADIUS) { taken[q] = 1; tiles.push(q); } }
          tiles.sort((a, b) => a - b); clusters++;
          const peak = fin(mq[p], 0), cell = ((py / 4) | 0) * 16 + ((px / 4) | 0);   // a 4×4 cell id keeps the issue id (and its age) stable while the peak drifts
          const spot = { tx: px, ty: py, w: 1, h: 1 };
          const pr = progressOf(building(list, ['abatement'], spot, abR) || building(list, ['bat_house'], spot, bhR));
          mk(out, 'mosquitoHotspot', 'mosq:' + cell, { severity: peak >= MOSQ_SEVERE ? 2 : 1, title: 'Mosquito hotspot' + (tiles.length > 1 ? ' · ' + tiles.length + ' tiles' : ''), fix: 'Mosquitoes: Fix arms Abatement here (' + abR + '-tile reach); a Bat House (' + bhR + ') or a Canal that drains the standing water also works',
            persist: 'Peak ' + peak.toFixed(2) + ' (hotspot from ' + MOSQ_HOT + '): Abatement within ' + abR + ' or a Bat House within ' + bhR + ' tiles brings it down over a few days', tiles: tiles, anchor: tileAnchor(p), action: { openMenuCard: 'abatement', arm: 'abatement', nearTile: p, reach: abR }, progress: pr, stage: peak >= MOSQ_SEVERE ? 'severe' : 'hot' });
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
    const tick = fin(state.tick, 0) | 0, seen = new Set(), st = store(state), snoozed = st.snoozed, dismissed = st.dismissed;
    for (const it of out) {
      seen.add(it.id); if (!sinceMap.has(it.id)) sinceMap.set(it.id, tick); it.since = sinceMap.get(it.id);
      it.sig = it.kind + '|' + it.severity + '|' + it.stage;
      const sn = snoozed[it.id];
      if (sn && tick < fin(sn.until, 0) && it.severity <= fin(sn.severity, 3)) it.hidden = 'snoozed'; else if (sn) delete snoozed[it.id];
      if (!it.hidden) { const ds = dismissed[it.id]; if (ds === it.sig) it.hidden = 'dismissed'; else if (ds !== undefined) delete dismissed[it.id]; }
      it.suggestion = isSuggestion(state, it);
    }
    for (const id of Array.from(sinceMap.keys())) if (!seen.has(id)) sinceMap.delete(id);
    for (const id in snoozed) if (!seen.has(id)) delete snoozed[id];
    for (const id in dismissed) if (!seen.has(id)) delete dismissed[id];
    out.sort((a, b) => (b.severity - a.severity) || (a.since - b.since) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    cache.all = out; cache.list = out.filter((it) => !it.hidden); cache.active = cache.list.filter((it) => !it.progress);
    cache.main = cache.active.filter((it) => !it.suggestion); cache.suggest = cache.active.filter((it) => it.suggestion);
    if (selectedId !== null && !cache.list.some((it) => it.id === selectedId)) selectedId = null;
    return cache.list;
  }
  /** calm alerts pass: a suggestion = a severity-1 KIND (unlinkedPath, mosquitoHotspot: the kind's base severity, whatever the row's) or a muted kind */
  function isSuggestion(state, it) { const K = KINDS[it.kind]; return !K || K.severity <= 1 || !!mutedMap(state)[it.kind]; }
  function alertModeOf(state) { const m = settingsOf(state).alerts; return ALERT_MODES.indexOf(m) >= 0 ? m : ALERT_MODES[0]; }
  /** the least severity that earns a map beacon in the current Alerts mode: Normal params.issues.beaconMin (2), Quiet 3, Off never (4) */
  function beaconMinOf(state) { const m = alertModeOf(state); return m === ALERT_MODES[2] ? 4 : m === ALERT_MODES[1] ? 3 : clamp(fin(PI().beaconMin, 2) | 0, 1, 3); }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  function refresh(state) {
    state = state || BSU.state; if (!state || !state.tiles) return cache.list;
    subscribe();
    const tick = fin(state.tick, 0) | 0;
    if (cache.state !== state) { resetAll(); cache.state = state; store(state); }
    if (!cache.dirty && tick >= cache.tick && tick - cache.tick < REFRESH_TICKS && cache.list) return cache.list;
    finish(state, compute(state)); cache.tick = tick; cache.dirty = false; cache.version++; cache.computes++;
    return cache.list;
  }
  /** list(state) → the visible issues (snoozed / dismissed left out; fixes underway included), sorted by severity (3 first) then age (oldest first); cached ≤ refreshTicks */
  M.list = function (state) { try { return refresh(state); } catch (e) { ierr('list', e); return cache.list || []; } };
  /** all(state) → every issue, hidden ones too (`hidden` = 'snoozed' | 'dismissed' | '') */
  M.all = function (state) { try { refresh(state); return cache.all; } catch (e) { ierr('all', e); return cache.all || []; } };
  /** actionable(state) → visible issues with no fix underway (main rows + suggestions) */
  M.actionable = function (state) { try { refresh(state); return cache.active; } catch (e) { ierr('actionable', e); return cache.active || []; } };
  /** main(state) → the actionable rows that are not suggestions: the tray's count, the groups, I-cycling, Clear N */
  M.main = function (state) { try { refresh(state); return cache.main; } catch (e) { ierr('main', e); return cache.main || []; } };
  /** suggestions(state) → the actionable rows of severity-1 kinds and muted kinds: the tray's collapsed Suggestions group (never a beacon, never a toast) */
  M.suggestions = function (state) { try { refresh(state); return cache.suggest; } catch (e) { ierr('suggestions', e); return cache.suggest || []; } };
  M.isSuggestion = function (state, it) { return !!(it && isSuggestion(state || cache.state, it)); };
  /** alertMode(state) → 'normal' | 'quiet' | 'off' (settings.alerts; ui.setAlertMode writes it) */
  M.alertMode = function (state) { return alertModeOf(state || cache.state || BSU.state); };
  M.alertModes = function () { return ALERT_MODES.slice(); };
  M.beaconMin = function (state) { return beaconMinOf(state || cache.state || BSU.state); };
  M.beaconMax = function () { return Math.max(0, fin(PI().beaconMax, 6) | 0); };
  /** muted(state, kind) → the kind's rows are suggestions only (settings.mutedIssues[kind]); mute(state, kind, on?) sets / toggles it (ui saves the settings) */
  M.muted = function (state, kind) { return !!mutedMap(state || cache.state || BSU.state)[kind]; };
  M.mute = function (state, kind, on) {
    state = state || cache.state || BSU.state; if (!KINDS[kind]) return false;
    const m = mutedMap(state); const v = on === undefined ? !m[kind] : !!on;
    if (v) m[kind] = true; else delete m[kind];
    cache.dirty = true; cache.version++; return v;
  };
  M.mutedKinds = function (state) { const m = mutedMap(state || cache.state || BSU.state); return Object.keys(m).filter((k) => !!m[k] && !!KINDS[k]); };
  /** beacons(state, camTx?, camTy?, {all}) → the rows the map may draw: the selected one always; otherwise severity ≥ beaconMin for the
   *  Alerts mode, no suggestions (severity-1 kinds, muted kinds); sorted most severe first then nearest the camera; ≤ beaconMax unless `all` (spotlight) */
  M.beacons = function (state, camTx, camTy, opts) {
    try {
      state = state || cache.state || BSU.state; const l = M.list(state), min = beaconMinOf(state), sel = selectedId, cx = fin(camTx, 32), cy = fin(camTy, 32);
      const out = [];
      for (const it of l) { if (it.id === sel) { out.push(it); continue; } if (min > 3 || it.suggestion || it.severity < min) continue; out.push(it); }
      const d = (it) => { const a = it.anchor || { tx: 32, ty: 32 }; return Math.max(Math.abs(fin(a.tx, 32) - cx), Math.abs(fin(a.ty, 32) - cy)); };
      out.sort((a, b) => ((b.id === sel) - (a.id === sel)) || (b.severity - a.severity) || (d(a) - d(b)) || (a.since - b.since) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const cap = opts && opts.all ? Infinity : M.beaconMax();
      return out.length > cap ? out.slice(0, cap) : out;
    } catch (e) { ierr('beacons', e); return []; }
  };
  /** toastGate(state, kinds | family) → may an issue notification about these kinds show now? Off / Quiet: never; a severity below
   *  toastMinSeverity (the rows' worst, else the kinds' base) or every kind muted: never; otherwise once per kind per toastPerKindDays
   *  (every kind named is stamped with the day; a toast naming any kind stamped within the gap is refused) */
  M.toastGate = function (state, kinds) {
    try {
      state = state || cache.state || BSU.state; if (!state) return false;
      const mode = alertModeOf(state); if (mode !== ALERT_MODES[0]) return false;
      let ks = typeof kinds === 'string' ? (FAMILY_KINDS[kinds] || [kinds]) : (Array.isArray(kinds) ? kinds : []); ks = ks.filter((k) => !!KINDS[k]); if (!ks.length) return false;
      const m = mutedMap(state); ks = ks.filter((k) => !m[k]); if (!ks.length) return false;
      const rows = M.ofKinds(state, ks); let sev = 0;
      if (rows.length) { for (const it of rows) if (it.severity > sev) sev = it.severity; } else { for (const k of ks) if (KINDS[k].severity > sev) sev = KINDS[k].severity; }
      if (sev < clamp(fin(PI().toastMinSeverity, 2) | 0, 1, 3)) return false;
      const day = fin(state.calendar && state.calendar.day, 0), gap = Math.max(0, fin(PI().toastPerKindDays, 7));
      for (const k of ks) if (Number.isFinite(toastStamp[k]) && day - toastStamp[k] < gap) return false;
      for (const k of ks) toastStamp[k] = day;
      return true;
    } catch (e) { ierr('toastGate', e); return false; }
  };
  M.toastStamps = function () { return Object.assign({}, toastStamp); };
  M.inProgress = function (state) { return M.list(state).filter((it) => !!it.progress); };
  M.hiddenList = function (state) { return M.all(state).filter((it) => !!it.hidden); };
  M.invalidate = function () { cache.dirty = true; };
  M.version = function () { return cache.version; };
  M.byId = function (state, id) { const l = M.all(state); for (let k = 0; k < l.length; k++) if (l[k].id === id) return l[k]; return null; };
  M.ofKinds = function (state, kinds) { const l = M.list(state), set = Array.isArray(kinds) ? kinds : [kinds]; return l.filter((it) => set.indexOf(it.kind) >= 0); };
  M.ofFamily = function (state, family) { return M.ofKinds(state, FAMILY_KINDS[family] || []); };
  /** summary(state) → {count (main rows), suggestions, worst, bySeverity, inProgress, hidden, total (visible)} */
  M.summary = function (state) {
    const l = M.main(state); const s = { count: l.length, suggestions: cache.suggest.length, worst: 0, bySeverity: [0, 0, 0, 0], inProgress: cache.list.length - cache.active.length, hidden: cache.all.length - cache.list.length, total: cache.list.length };
    for (const it of l) { s.bySeverity[it.severity]++; if (it.severity > s.worst) s.worst = it.severity; }
    return s;
  };
  function groupRows(state, l) {
    const out = [], by = new Map();
    for (const it of l) { let g = by.get(it.kind); if (!g) { g = { kind: it.kind, label: KINDS[it.kind].label, color: it.color, glyph: it.glyph, muted: !!mutedMap(state)[it.kind], rows: [] }; by.set(it.kind, g); out.push(g); } g.rows.push(it); }
    return out;
  }
  /** groups(state) → [{kind, label, color, glyph, muted, rows}] over the MAIN rows in list order (the tray's grouping); suggestionGroups(state) the same over the suggestions */
  M.groups = function (state) { return groupRows(state, M.main(state)); };
  M.suggestionGroups = function (state) { return groupRows(state, M.suggestions(state)); };
  /** resolvable(state) → {rows, total, free, paid}: every MAIN row with a zero-click fix right now (repairs within cash, link-its within cash); never a suggestion or a muted kind */
  M.resolvable = function (state) {
    const rows = M.main(state).filter((it) => it.resolvable); let total = 0, free = 0;
    for (const it of rows) { total += it.cost; if (!(it.cost > 0)) free++; }
    return { rows: rows, total: total, free: free, paid: rows.length - free };
  };
  /** snooze(state, id, days?) → hides the row for params.issues.snoozeDays (3) days (saved with the game); it returns sooner if the severity rises */
  M.snooze = function (state, id, days) {
    const it = M.byId(state, id); if (!it) return false;
    const st = store(state), tpd = fin(BSU.params.time && BSU.params.time.ticksPerDay, 200), d = Math.max(1, fin(days, fin(PI().snoozeDays, 3)));
    st.snoozed[it.id] = { until: (fin(state && state.tick, 0) | 0) + Math.round(d * tpd), severity: it.severity, days: d };
    delete st.dismissed[it.id]; if (selectedId === it.id) selectedId = null; cache.dirty = true; cache.version++; return true;
  };
  /** dismiss(state, id) → hides the row until the condition changes (its kind / severity / stage); saved with the game */
  M.dismiss = function (state, id) { const it = M.byId(state, id); if (!it) return false; const st = store(state); st.dismissed[it.id] = it.sig; delete st.snoozed[it.id]; if (selectedId === it.id) selectedId = null; cache.dirty = true; cache.version++; return true; };
  M.restore = function (id, state) { const st = store(state || cache.state); const had = (id in st.snoozed) || (id in st.dismissed); delete st.snoozed[id]; delete st.dismissed[id]; if (had) { cache.dirty = true; cache.version++; } return !!had; };
  M.restoreAll = function (state) { const st = store(state || cache.state); const n = Object.keys(st.snoozed).length + Object.keys(st.dismissed).length; st.snoozed = {}; st.dismissed = {}; if (n) { cache.dirty = true; cache.version++; } return n; };
  M.snoozeInfo = function (id, state) { const sn = store(state || cache.state).snoozed[id]; return sn ? { until: sn.until, days: sn.days, severity: sn.severity } : null; };
  M.select = function (id) { selectedId = (id === undefined || id === null) ? null : String(id); cache.version++; return selectedId; };
  M.selectedId = function () { return selectedId; };
  M.selected = function (state) { return selectedId === null ? null : M.byId(state, selectedId); };
  /** cycle(state, dir) → the next MAIN issue after the selected one (wraps; dir −1 goes back) and selects it; null when there are none (suggestions are reached from the tray) */
  M.cycle = function (state, dir) {
    const l = M.main(state); if (!l.length) { selectedId = null; return null; }
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
  M.labelOf = function (kind) { const K = KINDS[kind]; return K ? K.label : kind; };
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
  M.stats = function () { const st = store(cache.state); return { computes: cache.computes, version: cache.version, cached: cache.list.length, tick: cache.tick, snoozed: Object.keys(st.snoozed).length, dismissed: Object.keys(st.dismissed).length }; };

  // ---------------------------------------------------------------------------
  // selfTest: synthetic buildings on a fresh state (no terrain/hydro needed), deterministic
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const A = function (c, m) { if (!c) throw new Error('issues.selfTest: ' + m); };
    const s = BSU.newState(7); s.tick = 100; s.economy.suppressCoverage = false; s.economy.suspendCapPenalties = false; s.economy.students = 0; s.economy.cash = 1e7;
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
    A(up.action && up.action.openMenuCard === 'substation' && up.action.arm === 'substation' && up.action.near === 0 && up.action.reach === 10 && up.since === 100 && up.severity === 2 && up.progress === null, 'action opens + arms the Substation card near the dorm; since = the tick; nothing in progress');
    A(!l.some((it) => it.kind === 'unlinkedPath'), 'a path to Founders\' ring links the dorm');
    // a substation under construction within reach → in progress (and out of the actionable list)
    const sub = struct(1, 'substation', 20, 16, { built: 0.5 }); M.invalidate(); l = M.list(s);
    const up2 = l.find((it) => it.kind === 'unpowered'); A(up2 && up2.progress && /Substation under construction \(1 day\)/.test(up2.progress.text) && !M.actionable(s).some((it) => it.kind === 'unpowered'), 'a substation under construction → progress line, not actionable: ' + (up2 && up2.progress && up2.progress.text));
    s.buildings[1] = null; void sub;
    surf[BSU.idx(20, 25)] = SURF.NONE; M.invalidate(); l = M.list(s);
    A(l.some((it) => it.kind === 'unlinkedPath' && it.action.tool === 'path' && it.action.link === 0), 'breaking the path → unlinkedPath with the link action');
    // cache: same tick, no invalidation → same array
    const l2 = M.list(s); A(l2 === l, 'cached between refreshes');
    s.tick = 100 + REFRESH_TICKS; const l3 = M.list(s); A(l3 !== l && l3.length === l.length, 'recomputed after refreshTicks');
    A(l3.find((it) => it.kind === 'unpowered').since === 100, 'since survives a recompute');
    // snooze / dismiss
    const uid = l3.find((it) => it.kind === 'unpowered').id;
    A(M.snooze(s, uid) === true && !M.list(s).some((it) => it.id === uid) && M.all(s).find((it) => it.id === uid).hidden === 'snoozed' && M.summary(s).hidden === 1, 'snooze hides the row (all() keeps it as snoozed)');
    s.tick += 3 * 200 + 1; A(M.list(s).some((it) => it.id === uid), 'the snooze expires after 3 days');
    A(M.dismiss(s, uid) === true && !M.list(s).some((it) => it.id === uid) && M.summary(s).hidden === 1, 'dismiss hides the row');
    s.tick += 50; A(!M.list(s).some((it) => it.id === uid) && M.restore(uid) === true && M.list(s).some((it) => it.id === uid), 'the dismissal holds while the condition is the same; restore brings it back');
    dorm.hp = 0.4; M.invalidate(); const did = M.list(s).find((it) => it.kind === 'damaged').id; M.dismiss(s, did); A(!M.list(s).some((it) => it.id === did), 'dismiss the damaged row');
    dorm.ruin = true; M.invalidate(); A(M.list(s).some((it) => it.id === did && it.severity === 3), 'it comes back when the condition changes (ruin)'); dorm.ruin = false; dorm.hp = 1;
    // flooded + ruin + hp
    dorm.flooded = true; M.invalidate(); l = M.list(s);
    A(l.some((it) => it.kind === 'flooded' && it.severity === 3 && it.action.arm === 'pump') && !l.some((it) => it.kind === 'unpowered'), 'flooded (sev 3, arms a Pump) replaces unpowered while under water');
    dorm.flooded = false; dorm.hp = 0.4; M.invalidate(); l = M.list(s);
    const dm = l.find((it) => it.kind === 'damaged'); A(dm && dm.action.repair === 0 && dm.severity === 2 && dm.cost > 0 && dm.resolvable === true, 'hp < 1 → damaged with a priced, resolvable repair action');
    s.economy.cash = -1e9; M.invalidate(); A(M.list(s).find((it) => it.kind === 'damaged').resolvable === false && /Not enough cash/.test(M.list(s).find((it) => it.kind === 'damaged').persist), 'no cash → not resolvable, the tooltip says so'); s.economy.cash = 1e7;
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
    A(lv && lv.tiles.length === 4 && lv.anchor.tx === 42 && lv.severity === 3 && lv.action.repairLevee === BSU.idx(42, 10) && lv.action.run.length === 4 && /40%/.test(lv.title), 'weak levee run → one issue anchored at the weakest tile, the whole run in the action');
    for (let x = 40; x < 44; x++) { tl.crest[BSU.idx(x, 10)] = 0; tl.integrity[BSU.idx(x, 10)] = 100; }
    // sorting: severity desc then age asc; selection cycles and clears
    struct(2, 'lecture_hall', 10, 10, { watered: false }); M.invalidate(); l = M.list(s);
    A(l.some((it) => it.kind === 'unwatered' && /Water Tower within 12 tiles/.test(it.fix)), 'unwatered fix names the tower radius');
    for (let k = 1; k < l.length; k++) A(l[k - 1].severity > l[k].severity || (l[k - 1].severity === l[k].severity && l[k - 1].since <= l[k].since), 'sorted by severity then age');
    A(M.selected(s) === null, 'nothing selected at first');
    const ml = M.main(s); A(ml.length >= 1 && ml.length < l.length && l.some((it) => it.kind === 'unlinkedPath') && !ml.some((it) => it.kind === 'unlinkedPath'), 'I cycles the main rows, not the suggestions (' + ml.length + ' of ' + l.length + ')');
    const c1 = M.cycle(s, 1); A(c1 && c1.id === ml[0].id && M.selectedId() === ml[0].id, 'I cycles to the first issue');
    const c2 = M.cycle(s, 1); A(c2 && c2.id === ml[1 % ml.length].id, 'then the next');
    for (let k = 0; k < ml.length; k++) M.cycle(s, 1); A(M.selectedId() === c2.id, 'wraps around');
    M.cycle(s, -1); A(M.selectedId() === ml[0].id, 'Shift-direction goes back');
    M.select(null); A(M.selected(s) === null, 'select(null) clears');
    // groups + over capacity suppression during the tutorial
    A(M.groups(s).length >= 1 && M.groups(s).every((g) => g.rows.length >= 1 && !g.muted && g.rows.every((it) => it.kind === g.kind)) && M.suggestionGroups(s).length === 1 && M.suggestionGroups(s)[0].kind === 'unlinkedPath', 'groups by kind (main) + suggestion groups');
    s.economy.students = 500; s.progress = s.progress || {}; s.progress.tutorialStage = 3; s.ui.tabsIntroduced = {}; M.invalidate(); A(!M.list(s).some((it) => it.kind === 'overCapacity'), 'over capacity rows are suppressed before housing is introduced');
    s.progress.tutorialStage = 6; M.invalidate(); A(M.list(s).some((it) => it.kind === 'overCapacity' && it.action.arm), 'and shown (armed) in free play');
    s.economy.suspendCapPenalties = true; M.invalidate(); A(!M.list(s).some((it) => it.kind === 'overCapacity'), 'and while the cap penalties are suspended'); s.economy.suspendCapPenalties = false; s.economy.students = 0;
    M.select(l[0].id); s.buildings = []; M.invalidate(); l = M.list(s); A(l.length === 0 && M.selected(s) === null, 'selection drops with its issue');
    A(M.spotlight() === false && M.spotlight(true) === true && M.spotlight(false) === false, 'spotlight getter/setter');
    A(M.pulse('power').length === 3 && M.isPulsing('pumpOff') && M.pulse(null) === null && !M.isPulsing('pumpOff'), 'pulse by family');
    A(M.colorOf('flooded') === '#2BD4C0' && M.glyphOf('mosquitoHotspot') === 'mosquito' && !KINDS.gatorOnCampus && M.colorOf('nope') === '#FDD023', 'kind table (no gator kind)');
    const cols = Object.keys(KINDS).map((k) => KINDS[k].family + ':' + KINDS[k].color); A(new Set(cols.map((c) => c.split(':')[1])).size === Object.keys(FAMILY_KINDS).length, 'one colour per family');
    A(M.ageText({ tick: 100 }, { since: 100 }) === '0s' && M.ageText({ tick: 100 + 200 * 3 }, { since: 100 }) === '3d', 'ageText');
    // calm alerts pass: suggestions, beacons (mode + severity gate, cap, nearest first), mutes, saved snoozes, the toast gate
    {
      const s2 = BSU.newState(9); s2.tick = 50; s2.economy.suppressCoverage = false; s2.economy.suspendCapPenalties = false; s2.economy.students = 0; s2.economy.cash = 1e7; s2.buildings = [];
      s2.plot = s2.plot || {}; s2.plot.founders = { tx: 30, ty: 30 }; s2.plot.highway = [];
      const mkb = function (id, type, tx, ty, o) { const r = rowOf(type); s2.buildings[id] = Object.assign({ id: id, type: type, tx: tx, ty: ty, w: fin(r && r.w, 1), h: fin(r && r.h, 1), rot: 0, name: 'B' + id, hp: 1, built: 1, builtDay: 0, pilings: false, sunk: 0, powered: false, watered: true, provider: { power: -1, water: -1 }, flooded: false, floodedSince: -1, closedUntil: -1, blackout: false, tier: 0, upgradeDoneDay: -1, ruin: false, tarp: false }, o || {}); return s2.buildings[id]; };
      for (let k = 0; k < 9; k++) mkb(k, 'dorm', 4 + k * 6, 4, {});   // nine unpowered, unlinked dorms along the top: 9 severity-2 rows + 9 suggestions
      let L2 = M.list(s2);
      A(L2.filter((it) => it.kind === 'unpowered').length === 9 && L2.filter((it) => it.kind === 'unlinkedPath').length === 9, 'nine unpowered + nine unlinked rows (' + L2.length + ')');
      A(M.main(s2).length === 9 && M.suggestions(s2).length === 9 && M.suggestions(s2).every((it) => it.kind === 'unlinkedPath' && it.suggestion), 'unlinkedPath rows are suggestions, not main rows');
      A(M.summary(s2).count === 9 && M.summary(s2).suggestions === 9 && M.groups(s2).length === 1 && M.suggestionGroups(s2).length === 1, 'summary counts main rows; groups / suggestionGroups split by kind');
      A(M.alertMode(s2) === 'normal' && M.beaconMin(s2) === 2 && M.beaconMax() === 6, 'Normal: beacons from severity 2, at most 6');
      let bc = M.beacons(s2, 4, 4);
      A(bc.length === 6 && bc.every((it) => it.kind === 'unpowered') && bc[0].buildingId === 0 && bc[5].buildingId === 5, 'six beacons, none a suggestion, nearest the camera first: ' + bc.map((it) => it.buildingId).join(','));
      bc = M.beacons(s2, 52, 4); A(bc[0].buildingId === 8 && bc.length === 6, 'the camera at the far end flips the order');
      A(M.beacons(s2, 4, 4, { all: true }).length === 9, 'spotlight (all) is uncapped but still skips suggestions');
      M.select('unlinked:3'); bc = M.beacons(s2, 4, 4); A(bc.length === 6 && bc[0].id === 'unlinked:3', 'the selected row always beacons, first'); M.select(null);
      s2.ui.settings.alerts = 'quiet'; A(M.alertMode(s2) === 'quiet' && M.beaconMin(s2) === 3 && M.beacons(s2, 4, 4).length === 0, 'Quiet: only severity 3 beacons');
      s2.buildings[0].flooded = true; M.invalidate(); A(M.beacons(s2, 4, 4).length === 1 && M.beacons(s2, 4, 4)[0].kind === 'flooded', '… a flooded dorm (sev 3) does');
      s2.ui.settings.alerts = 'off'; A(M.beaconMin(s2) === 4 && M.beacons(s2, 4, 4).length === 0, 'Off: no beacons at all');
      s2.ui.settings.alerts = 'normal'; s2.buildings[0].flooded = false; M.invalidate();
      // mutes live in the settings: a muted kind is a suggestion, never a beacon, never in Clear N
      s2.buildings[1].hp = 0.5; M.invalidate(); A(M.resolvable(s2).rows.length === 1 && M.resolvable(s2).rows[0].kind === 'damaged', 'Clear N counts the repair');
      A(M.mute(s2, 'damaged') === true && M.muted(s2, 'damaged') && s2.ui.settings.mutedIssues.damaged === true && M.mutedKinds(s2).join() === 'damaged', 'mute writes settings.mutedIssues');
      A(M.resolvable(s2).rows.length === 0 && M.suggestions(s2).some((it) => it.kind === 'damaged') && !M.beacons(s2, 4, 4).some((it) => it.kind === 'damaged') && M.groups(s2).every((g) => g.kind !== 'damaged'), 'a muted kind is a suggestion: no Clear, no beacon, no main group');
      A(M.mute(s2, 'damaged', false) === false && M.resolvable(s2).rows.length === 1 && M.mute(s2, 'nope') === false, 'unmute restores it; unknown kinds refuse');
      s2.buildings[1].hp = 1; M.invalidate();
      // snoozes / dismissals are on state.ui.issues and survive a JSON round trip
      const sid = M.main(s2)[0].id; A(M.snooze(s2, sid) && s2.ui.issues.snoozed[sid] && s2.ui.issues.snoozed[sid].until === 50 + 600, 'snooze is saved on state.ui.issues');
      const did = M.main(s2)[0].id; A(did !== sid && M.dismiss(s2, did) && s2.ui.issues.dismissed[did] === 'unpowered|2|', 'dismiss is saved with its signature');
      const copy = JSON.parse(JSON.stringify(s2.ui.issues)); resetAll(); s2.ui.issues = copy;
      A(!M.list(s2).some((it) => it.id === sid || it.id === did) && M.hiddenList(s2).length === 2 && M.stats().snoozed === 1 && M.stats().dismissed === 1, 'a reloaded store still hides both rows');
      A(M.restore(sid, s2) && M.restoreAll(s2) === 1 && M.list(s2).some((it) => it.id === did), 'restore / restoreAll clear the saved store');
      // the toast gate: severity-1 kinds never, Quiet / Off never, once per key per week
      s2.calendar.day = 100;
      A(M.toastGate(s2, 'path') === false && M.toastGate(s2, ['unlinkedPath']) === false, 'no toast for a severity-1 kind');
      A(M.toastGate(s2, 'power') === true && M.toastGate(s2, 'power') === false, 'one power toast, then quiet for the week');
      s2.calendar.day = 107; A(M.toastGate(s2, 'power') === true, '… and again a week later');
      A(M.toastGate(s2, 'flood') === true && M.toastGate(s2, ['flooded']) === false && M.toastGate(s2, ['unwatered', 'flooded']) === false, 'a family toast stamps its kinds (rows absent → base severity): any toast naming a stamped kind waits');
      M.mute(s2, 'unpowered'); M.mute(s2, 'brownout'); M.mute(s2, 'pumpOff'); s2.calendar.day = 200; A(M.toastGate(s2, 'power') === false, 'every kind muted → no toast'); M.mute(s2, 'unpowered', false); M.mute(s2, 'brownout', false); M.mute(s2, 'pumpOff', false);
      s2.ui.settings.alerts = 'quiet'; s2.calendar.day = 300; A(M.toastGate(s2, 'power') === false, 'Quiet: no toasts'); s2.ui.settings.alerts = 'off'; A(M.toastGate(s2, 'power') === false, 'Off: no toasts'); s2.ui.settings.alerts = 'normal';
      A(M.toastGate(s2, 'nope') === false && M.toastGate(s2, []) === false, 'unknown kinds → no toast');
    }
    resetAll();
    return { ok: true, notes: notes.join('; ') };
  };
})();
