'use strict';
// =============================================================================
// BAYOU STATE — progress.js (module 18) → BSU.progress
// Owner of: state.progress.* (tutorial stage, objectives + queues, milestones, timers, voice/board/failure
//           cards, set-pieces-seen, firsts, recap, hints, uiQueue) and state.ticker[] (≤ 30).
// Implements GDD §10 (tutorial §10.1, objective chain §10.2, scripted weather §10.3–10.4, milestones §10.5,
// unlocks §10.6, failure states §10.7, Founders' Day §10.8), §7.1 (Student Voice), §5.9 (Board of Regents),
// §5.6 (the timer table), §6.2 (recovery duties), §9.2/§9.4 (dates, first-warning drops), §14.3 (parade),
// §14.4 (ticker). ARCHITECTURE §5.10 API; §1 row 18: the ONLY module that scripts other modules.
// Every listener only queues; everything acts inside tick (at most one objective:offered per tick).
// Every emit goes through M._deps.emit; every sibling call is guarded (ui/render may not exist: ui calls that
// cannot be delivered are queued on state.progress.uiQueue — see docs/INTEGRATION_NOTES.md '## progress.js').
// =============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.progress = BSU.progress || {});
  const EV = BSU.EV, P = BSU.params, PP = P.progress, PT = P.time, PE = P.econ, PS = P.storm;
  const W = BSU.MAP.W, HGT = BSU.MAP.H, N = BSU.MAP.N;
  const SKY = BSU.SKY, SURF = BSU.SURF, FLAG = BSU.FLAG, T = BSU.T, OBJ = BSU.OBJ, OV = BSU.OV;
  const NONE = -1;
  const TICKER_MAX = 30, UI_QUEUE_MAX = 40, DAYS_PER_YEAR = PT.daysPerYear || 120, TPD = PT.ticksPerDay || 100;

  M._deps = { emit: function (name, payload) { return BSU.events.emit(name, payload); } };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function fin(v, d) { return (typeof v === 'number' && Number.isFinite(v)) ? v : d; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function emit(name, payload) { try { M._deps.emit(name, payload); } catch (e) { BSU.error('progress', 'emit:' + name, e); } }
  function mod(name) { const d = M._deps[name]; return d !== undefined ? d : BSU[name]; }
  function has(name, fn) { const m = mod(name); return !!(m && typeof m[fn] === 'function'); }
  function call(name, fn) {
    const m = mod(name);
    if (!m || typeof m[fn] !== 'function') return undefined;
    const args = Array.prototype.slice.call(arguments, 2);
    try { return m[fn].apply(m, args); } catch (e) { BSU.error('progress', name + '.' + fn, e); return undefined; }
  }
  function data() { return mod('data') || BSU.data || {}; }
  function catalog() { return data().catalog || {}; }
  function today(state) { return fin(state && state.calendar && state.calendar.day, 0) | 0; }
  function yearOf(day) { return Math.floor(Math.max(0, day) / DAYS_PER_YEAR) + 1; }
  function parts(day) { return BSU.dayParts(day); }
  /** absolute day of 'Mon D' in the given year (-1 when unparsable) */
  function dateDay(str, year) { const d = BSU.dateToDay(str, year); return Number.isFinite(d) ? d : NONE; }
  /** the next absolute day ≥ day on which 'Mon D' falls */
  function nextDate(str, day) { let d = dateDay(str, yearOf(day)); if (d < 0) return NONE; if (d < day) d = dateDay(str, yearOf(day) + 1); return d; }
  function students(state) { return fin(state.economy && state.economy.students, 0); }
  function prestige(state) { return fin(state.economy && state.economy.prestige, 0); }
  function happiness(state) { return fin(state.economy && state.economy.happiness, 0); }
  function ecology(state) { const v = call('wildlife', 'ecology', state); return fin(v, fin(state.wildlife && state.wildlife.ecology, 0)); }
  function blist(state, type) { const r = call('buildings', 'list', state, type); if (Array.isArray(r)) return r; const out = []; for (const b of (state.buildings || [])) if (b && (!type || b.type === type)) out.push(b); return out; }
  function bhas(state, type, minTier) { const r = call('buildings', 'has', state, type, minTier); if (typeof r === 'boolean') return r; for (const b of blist(state, type)) if (b.built >= 1 && !b.ruin && (b.tier || 0) >= (minTier || 0)) return true; return false; }
  function bcount(state, type) { return blist(state, type).length; }
  function complete(b) { return !!b && b.built >= 1 && !b.ruin; }
  function footTiles(b) { return BSU.footprintTiles(b.tx, b.ty, b.w, b.h); }
  function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
  function tileCheb(i, j) { return cheb(i % W, (i / W) | 0, j % W, (j / W) | 0); }
  function fmt(text, fields) {
    if (!fields) return text;
    return String(text).replace(/\{(\w+)\}/g, function (m, k) { return (k in fields) ? String(fields[k]) : m; });
  }
  function money(n) { return typeof BSU.formatMoney === 'function' ? BSU.formatMoney(n) : '$' + n; }
  function num(n) { return (Math.round(fin(n, 0))).toLocaleString('en-US'); }
  function isWater(state, i) { const ty = state.tiles.type[i]; return ty === T.OPEN_WATER || ty === T.BAYOU; }
  function coveLowest(state) {
    const cove = (state.plot && state.plot.cove) || [];
    if (!cove.length) return NONE;
    let best = cove[0]; for (const i of cove) if (state.tiles.elev[i] < state.tiles.elev[best]) best = i;
    return best;
  }
  function coveCenter(state) {
    const cove = (state.plot && state.plot.cove) || [];
    if (!cove.length) { const f = state.plot && state.plot.founders; return f ? { tx: f.tx, ty: f.ty + 6 } : { tx: W >> 1, ty: HGT >> 1 }; }
    let sx = 0, sy = 0; for (const i of cove) { sx += i % W; sy += (i / W) | 0; }
    return { tx: Math.round(sx / cove.length), ty: Math.round(sy / cove.length) };
  }
  function foundersFront(state) { const f = state.plot && state.plot.founders; return f ? { tx: f.tx + 1, ty: f.ty + 3 } : { tx: W >> 1, ty: HGT >> 1 }; }

  // ---------------------------------------------------------------------------
  // Timer registry (canonical; identical to economy.md / GDD §5.6)
  // ---------------------------------------------------------------------------
  const EFFECT_TIMERS = ['rivalrySpirit', 'insurance', 'lobby', 'researchPush', 'recruitingTrip', 'summerSession', 'tuitionLock', 'tuitionFreezeApplicants',
    'tuitionHike', 'austerityUpkeep', 'noConstruction', 'probation', 'biblicalApplicants', 'voiceApplicants', 'pilingsDiscount', 'pilingsDiscountYear',
    'postUpkeepHalf', 'researchBonus', 'undefeatedDonations', 'rivalryDonations', 'cajunNavy', 'voiceTeamRating', 'voiceTailgate', 'voicePoboy',
    'voiceHeatIllness', 'voiceFoggerWaiver', 'voiceCypressLine', 'zydecoFriday', 'voiceParking'];
  M.TIMER_IDS = Object.freeze(BSU.HAPPINESS_TIMERS.concat(EFFECT_TIMERS));
  const TIMER_SET = new Set(M.TIMER_IDS);
  const GRANT_IDS = new Set(['1', '2', '3', '4', '5', '6', '7', '9', '10', '11']);
  const TUTORIAL_IDS = ['1', '2', '3', '4', '5'];
  const FILLER_LINES = [12, 40, 33];

  // ---------------------------------------------------------------------------
  // Private context (closure; rebuilt in reset; self-heals on a foreign root)
  // ---------------------------------------------------------------------------
  let C = null;
  function freshCtx(state) {
    return {
      root: state, pendingEvents: [], tileDirty: false, ringDirty: false, dirty: true, unlockDirty: true,
      stageEntered: -1, swoop: null, charterShown: false, cellTick: NONE, cellQueuedTick: NONE, cellEndTick: NONE, pooledNotified: false,
      awaitFounding: false, parade: null, paradeWanted: NONE, gradWanted: NONE, gradStartTick: NONE, lastGraduates: 0,
      lastSky: NONE, trig: {}, warning: null, unlockSet: null, unlockDay: NONE, nearest: null, nearestDay: NONE,
      relocCount: {}, relocMonth: NONE, burrowAlt: false, shelterOk: true, lastReport: null, lastStormCat: 0, lastStormName: '',
      stockedSeen: 0, offeredThisTick: false, zydecoDay: NONE, heatDay: NONE, desireDay: NONE, desirePending: null, desireRuns: 0, obj11Text: '', firstGatorTile: NONE, worstMosqTile: NONE,
      foundingIds: null, foundingAdded: 0,
      lastGatorEnterDay: NONE, receiverTick: NONE
    };
  }
  function ctx(state) { if (!C || C.root !== state) C = freshCtx(state); return C; }
  function pr(state) { return state.progress; }
  function lazyKeys(state) {
    const p = pr(state);
    if (!p.objectives || typeof p.objectives !== 'object') p.objectives = {};
    for (const id of BSU.OBJECTIVE_IDS) if (!p.objectives[id]) p.objectives[id] = { state: 'locked', progress: 0, goal: 0, since: NONE, deadlineDay: NONE, text: '' };
    if (!p.milestones || typeof p.milestones !== 'object') p.milestones = {};
    for (const id of BSU.MILESTONES) if (!p.milestones[id]) p.milestones[id] = { earned: false, day: NONE };
    if (!Array.isArray(p.timers)) p.timers = [];
    if (!Array.isArray(p.voiceCards)) p.voiceCards = [];
    if (!Array.isArray(p.boardCards)) p.boardCards = [];
    if (!Array.isArray(p.interruptQueue)) p.interruptQueue = [];
    if (!Array.isArray(p.backgroundQueue)) p.backgroundQueue = [];
    if (!p.failure || typeof p.failure !== 'object') p.failure = { bankruptcy: 0, receiverUntilDay: NONE, probation: false, underwaterDays: 0 };
    if (p.failure.pendingKind === undefined) p.failure.pendingKind = null;
    if (typeof p.failure.receiver !== 'boolean') p.failure.receiver = false;
    if (!p.setPiecesSeen) p.setPiecesSeen = { landfall: false, game: false, parade: false, graduation: false };
    if (!p.firsts) p.firsts = { gatorDay: NONE, mosquitoDay: NONE, floodDay: NONE, cellDay: NONE };
    if (!p.hints || typeof p.hints !== 'object') p.hints = {};
    if (!Number.isFinite(p.forceFirefliesDay)) p.forceFirefliesDay = NONE;
    if (typeof p.drainedEver !== 'boolean') p.drainedEver = false;
    if (!Array.isArray(p.uiQueue)) p.uiQueue = [];
    if (!Number.isFinite(p.skeeterStreak)) p.skeeterStreak = 0;
    if (!Number.isFinite(p.paradeYear)) p.paradeYear = NONE;
    if (typeof p.achievementsWhileDebug !== 'boolean') p.achievementsWhileDebug = false;
    if (p.card === undefined) p.card = null;
    if (p.background === undefined) p.background = null;
    if (p.recap === undefined) p.recap = null;
    if (!Array.isArray(state.ticker)) state.ticker = [];
  }

  // ---------------------------------------------------------------------------
  // UI routing: call BSU.ui when present, else queue on state.progress.uiQueue (plain data only)
  // ---------------------------------------------------------------------------
  function plain(v, depth) {
    depth = depth || 0;
    if (v === null || v === undefined) return null;
    if (typeof v === 'function') return undefined;
    if (typeof v !== 'object') return (typeof v === 'number' && !Number.isFinite(v)) ? 0 : v;
    if (depth > 4) return null;
    if (Array.isArray(v)) { const a = []; for (const x of v) { const y = plain(x, depth + 1); if (y !== undefined) a.push(y); } return a; }
    const o = {};
    for (const k of Object.keys(v)) { const y = plain(v[k], depth + 1); if (y !== undefined) o[k] = y; }
    return o;
  }
  function uiQueue(state, kind, args) {
    const q = pr(state).uiQueue;
    if (kind === 'introduceTab') { for (const e of q) if (e.kind === kind && e.args[0] === args[0]) return; }
    q.push({ kind: kind, tick: fin(state.tick, 0), day: today(state), args: plain(args) || [] });
    while (q.length > UI_QUEUE_MAX) {   // evict the oldest notify first; introduceTab/card/hint/selectTool entries survive
      let k = -1; for (let i = 0; i < q.length; i++) if (q[i].kind === 'notify') { k = i; break; }
      q.splice(k >= 0 ? k : 0, 1);
    }
  }
  /** ui.<fn>(state, ...args) when ui has it, else queued for ui to drain (INTEGRATION_NOTES '## progress.js') */
  function ui(state, fn) {
    const args = Array.prototype.slice.call(arguments, 2);
    if (has('ui', fn)) { const r = call.apply(null, ['ui', fn, state].concat(args)); return r === undefined ? true : r; }
    uiQueue(state, fn, args);
    return false;
  }
  function notify(state, spec) { ui(state, 'notify', spec); }
  function audio(id) { call('audio', 'play', id); }

  // ---------------------------------------------------------------------------
  // Ticker (§14.4)
  // ---------------------------------------------------------------------------
  function lastTickerDay(state) { const t = state.ticker; return t.length ? fin(t[t.length - 1].day, NONE) : NONE; }
  /** push a ticker line: a §14.4 line number (1-based) with {fields}, or raw text */
  M.ticker = function (state, textOrLineNo, fields, kind, subject) {
    try {
      lazyKeys(state);
      let text, k = kind;
      if (typeof textOrLineNo === 'number') {
        const lines = data().ticker || [];
        const n = textOrLineNo | 0;
        text = fmt(lines[n - 1] || '', fields);
        if (!k) k = (data().tickerKinds || {})[n] || 'info';
      } else text = fmt(String(textOrLineNo), fields);
      if (!text) return;
      if (!k) k = 'info';
      const line = { day: today(state), tick: fin(state.tick, 0), text: text, subject: Number.isFinite(subject) ? subject | 0 : NONE, kind: k };
      state.ticker.push(line);
      while (state.ticker.length > TICKER_MAX) state.ticker.shift();
      emit(EV.UI_TICKER, { text: text, kind: k, subject: line.subject });
    } catch (e) { BSU.error('progress', 'ticker', e); }
  };
  function tick1Filler(state) {
    const r = BSU.rng.sim;
    const pool = FILLER_LINES.slice();
    if (bhas(state, 'water_tower')) pool.push(32);
    if (bhas(state, 'bell_tower') && state.sky && state.sky.phase === SKY.NIGHT) pool.push(38);
    if (fin(state.weather && state.weather.fog, 0) > 0 && state.sky && state.sky.phase === SKY.DAWN) pool.push(15);
    M.ticker(state, pool[r.int(pool.length)]);
  }

  // ---------------------------------------------------------------------------
  // Timers (D23)
  // ---------------------------------------------------------------------------
  /** add/replace a timer; untilDay = -1 when days is Infinity or < 0 (open-ended); voiceApplicants accumulates */
  M.addTimer = function (state, id, value, days, meta) {
    try {
      lazyKeys(state);
      id = String(id);   // any id is accepted (callers' test ids included); the registry rule covers the ids THIS module adds (selfTest scans them)
      const v = fin(value, 0);
      const day = today(state);
      const d = (days === Infinity || days === undefined || days === null || !Number.isFinite(days) || days < 0) ? NONE : Math.floor(days);
      const untilDay = d < 0 ? NONE : day + d;
      const list = pr(state).timers;
      let t = null;
      for (const x of list) if (x && x.id === id) { t = x; break; }
      if (t) {
        t.value = (id === 'voiceApplicants') ? fin(t.value, 0) + v : v;
        t.untilDay = untilDay;
        if (meta !== undefined) t.meta = plain(meta);
      } else {
        t = { id: id, untilDay: untilDay, value: v };
        if (meta !== undefined && meta !== null) t.meta = plain(meta);
        list.push(t);
      }
      if (id === 'brownout') M.ticker(state, 16);
      if (id === 'noParking') M.ticker(state, 36);
      emit(EV.TIMER_ADDED, { id: id, value: t.value, untilDay: untilDay });
    } catch (e) { BSU.error('progress', 'addTimer', e); }
  };
  M.removeTimer = function (state, id) {
    try {
      const list = pr(state).timers;
      for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].id === id) list.splice(i, 1);
    } catch (e) { BSU.error('progress', 'removeTimer', e); }
  };
  M.timer = function (state, id) {
    const list = state && state.progress && state.progress.timers;
    if (!Array.isArray(list)) return null;
    for (const t of list) if (t && t.id === id) return t;
    return null;
  };
  M.timers = function (state) { const list = state && state.progress && state.progress.timers; return Array.isArray(list) ? list : []; };
  function timerActive(state, id) { const t = M.timer(state, id); return !!t && (t.untilDay === NONE || t.untilDay > today(state)); }
  function expireTimers(state) {
    const day = today(state), list = pr(state).timers;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      if (!t) { list.splice(i, 1); continue; }
      if (!Number.isFinite(t.untilDay)) t.untilDay = NONE;
      if (t.untilDay >= 0 && t.untilDay <= day) { list.splice(i, 1); emit(EV.TIMER_EXPIRED, { id: t.id, value: t.value, untilDay: t.untilDay }); }
    }
  }
  function daysUntil(state, dateStr) { const d = nextDate(dateStr, today(state)); return d < 0 ? NONE : Math.max(1, d - today(state)); }

  // ---------------------------------------------------------------------------
  // Unlocks (§10.6; the single owner of the condition phrasing, D52)
  // ---------------------------------------------------------------------------
  /** evaluate an Unlock object ({students, prestige, ecology, milestone, building, tier, any}) against state */
  M.unlockOk = function (state, u) {
    try {
      if (!u || typeof u !== 'object' || !state) return true;
      if (Array.isArray(u.any)) { let ok = false; for (const alt of u.any) if (M.unlockOk(state, alt)) { ok = true; break; } if (!ok) return false; }
      if (Number.isFinite(u.students) && students(state) < u.students) return false;
      if (Number.isFinite(u.prestige) && prestige(state) < u.prestige) return false;
      if (Number.isFinite(u.ecology) && ecology(state) < u.ecology) return false;
      if (typeof u.milestone === 'string' && u.milestone && !M.earned(state, u.milestone)) return false;
      if (typeof u.building === 'string' && u.building && !bhas(state, u.building, fin(u.tier, 0))) return false;
      return true;
    } catch (e) { BSU.error('progress', 'unlockOk', e); return false; }
  };
  M.unlocked = function (state, id) {
    const row = catalog()[id];
    if (!row) return false;
    return M.unlockOk(state, row.unlock);
  };
  function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function reasonParts(state, u) {
    const out = [];
    if (!u) return out;
    if (Number.isFinite(u.students) && students(state) < u.students) out.push('Reach ' + num(u.students) + ' students');
    if (Number.isFinite(u.prestige) && prestige(state) < u.prestige) out.push('Prestige ' + num(u.prestige));
    if (Number.isFinite(u.ecology) && ecology(state) < u.ecology) out.push('Ecology ' + num(u.ecology));
    if (u.milestone && !M.earned(state, u.milestone)) { const m = (data().milestones || []).find(function (x) { return x.id === u.milestone; }); out.push('Earn ' + (m ? m.name : u.milestone)); }
    if (u.building && !bhas(state, u.building, fin(u.tier, 0))) {
      const row = catalog()[u.building]; let name = row ? row.name : u.building;
      if (fin(u.tier, 0) > 0 && row && Array.isArray(row.tiers)) { const tr = row.tiers.find(function (t) { return t.tier === u.tier; }); if (tr) name = tr.name; }
      out.push('Build the ' + name);
    }
    if (Array.isArray(u.any) && !u.any.some(function (alt) { return M.unlockOk(state, alt); })) {
      const alts = [];
      for (const alt of u.any) { const ps = reasonParts(state, alt); if (ps.length) alts.push(ps.join(' and ')); }
      if (alts.length) out.push(alts.map(function (s, i) { return i ? lowerFirst(s) : s; }).join(' or '));
    }
    return out;
  }
  /** human condition text for a LOCKED row ('' when unlocked) */
  M.unlockReason = function (state, id) {
    try {
      const row = catalog()[id];
      if (!row) return 'Unknown building';
      if (M.unlockOk(state, row.unlock)) return '';
      const ps = reasonParts(state, row.unlock);
      return ps.length ? ps.map(function (s, i) { return i ? lowerFirst(s) : s; }).join(' and ') : 'Locked';
    } catch (e) { BSU.error('progress', 'unlockReason', e); return 'Locked'; }
  };
  function unlockedIds(state) {
    const ids = [];
    const list = data().catalogList || [];
    for (const row of list) if (M.unlockOk(state, row.unlock)) ids.push(row.id);
    return ids;
  }
  function refreshUnlocks(state, c, emitChanges) {
    const now = unlockedIds(state);
    const prev = c.unlockSet;
    c.unlockSet = new Set(now);
    c.unlockDirty = false;
    if (!prev || !emitChanges) return;
    const fresh = now.filter(function (id) { return !prev.has(id); });
    if (fresh.length) emit(EV.UNLOCK_CHANGED, { ids: fresh });
  }

  // ---------------------------------------------------------------------------
  // Milestones (§10.5)
  // ---------------------------------------------------------------------------
  const MG = PP.milestoneGoals || {};
  function floodwallTiles(state, boundaryOnly, H) {
    let n = 0;
    if (boundaryOnly) { const b = call('buildings', 'boundaryLevees', state, H); if (Array.isArray(b)) for (const i of b) if (state.tiles.crest[i] === 12) n++; return n; }
    const crest = state.tiles.crest; for (let i = 0; i < N; i++) if (crest[i] === 12) n++;
    return n;
  }
  function pumpInsideRing(state, H) {
    const gaps = call('buildings', 'gaps', state, H) || { reachedBuildings: [] };
    const reached = new Set(gaps.reachedBuildings || []);
    for (const b of blist(state, 'pump')) if (complete(b) && !reached.has(b.id) && fin(call('buildings', 'effective', state, b.id), 1) > 0) return true;
    return false;
  }
  function otherExclusiveThisYear(state, otherId) {
    const m = pr(state).milestones[otherId];
    return !!(m && m.earned && yearOf(m.day) === yearOf(today(state)));
  }
  const MILESTONE_COND = {
    chartered: null, welcome: null, cajunEngineer: null, wetFeet: null, stormChaser: null, eyeOfTheStorm: null, sunbather: null,
    bayouField: null, nightFalls: null, geauxBeatMagnolia: null, undefeated: null, bigBoil: null, throwMeSomethin: null, skeeterBeater: null,
    firstBell: function (s) { return students(s) >= fin(MG.firstBell, 600); },
    highAndDry: function (s) { const H = fin(MG.highAndDryH, 8); if (!call('buildings', 'ringClosed', s, H)) return false; const g = call('buildings', 'gaps', s, H); if (g && g.gaps && g.gaps.length) return false; return pumpInsideRing(s, H); },
    gatorWrangler: function (s) { return fin(s.wildlife && s.wildlife.relocations, 0) >= fin(MG.gatorWrangler, 10); },
    greenAndGold: function (s) { const g = MG.greenAndGold || {}; return ecology(s) >= fin(g.ecology, 70) && students(s) >= fin(g.students, 3000); },
    fortressBayou: function (s) { const g = MG.fortressBayou || {}; if (otherExclusiveThisYear(s, 'livingWithWater')) return false; return !!call('buildings', 'ringClosed', s, fin(g.H, 12)) && floodwallTiles(s, true, fin(g.H, 12)) >= fin(g.floodwalls, 40); },
    livingWithWater: function (s) { const g = MG.livingWithWater || {}; if (otherExclusiveThisYear(s, 'fortressBayou')) return false; return ecology(s) >= fin(g.ecology, 75) && students(s) >= fin(g.students, 2000) && floodwallTiles(s, false) <= fin(g.floodwallMax, 10); },
    lightsAreOn: function (s) { return bhas(s, 'bell_tower'); },
    sinkingFeeling: function (s) { for (const b of blist(s)) if (fin(b.sunk, 0) >= fin(MG.sinkingFeeling, 1)) return true; return false; },
    rebuiltFromTheRoux: function (s) { return fin(pr(s).failure.bankruptcy, 0) > 0 && prestige(s) >= fin(MG.rebuiltFromTheRoux, 50); },
    flagship: function (s) { const g = MG.flagship || {}; return students(s) >= fin(g.students, 10000) && prestige(s) >= fin(g.prestige, 60); },
    laissez: function (s) { const g = MG.laissez || {}; return students(s) >= fin(g.students, 20000) && prestige(s) >= fin(g.prestige, 85) && ecology(s) >= fin(g.ecology, 50); },
    untouched: function (s) { return M.earned(s, 'flagship') && !pr(s).drainedEver; }
  };
  const MILESTONE_PROGRESS = {
    firstBell: function (s) { return { progress: students(s), goal: fin(MG.firstBell, 600) }; },
    gatorWrangler: function (s) { return { progress: fin(s.wildlife && s.wildlife.relocations, 0), goal: fin(MG.gatorWrangler, 10) }; },
    greenAndGold: function (s) { const g = MG.greenAndGold || {}; return { progress: Math.min(ecology(s) / fin(g.ecology, 70), students(s) / fin(g.students, 3000)), goal: 1 }; },
    fortressBayou: function (s) { const g = MG.fortressBayou || {}; return { progress: floodwallTiles(s, false), goal: fin(g.floodwalls, 40) }; },
    livingWithWater: function (s) { const g = MG.livingWithWater || {}; return { progress: Math.min(ecology(s) / fin(g.ecology, 75), students(s) / fin(g.students, 2000)), goal: 1 }; },
    flagship: function (s) { const g = MG.flagship || {}; return { progress: Math.min(students(s) / fin(g.students, 10000), prestige(s) / fin(g.prestige, 60)), goal: 1 }; },
    laissez: function (s) { const g = MG.laissez || {}; return { progress: Math.min(students(s) / fin(g.students, 20000), prestige(s) / fin(g.prestige, 85)), goal: 1 }; },
    rebuiltFromTheRoux: function (s) { return { progress: fin(pr(s).failure.bankruptcy, 0) > 0 ? prestige(s) : 0, goal: fin(MG.rebuiltFromTheRoux, 50) }; },
    skeeterBeater: function (s) { return { progress: fin(pr(s).skeeterStreak, 0), goal: 10 }; },
    highAndDry: function (s) { return { progress: call('buildings', 'ringClosed', s, fin(MG.highAndDryH, 8)) ? (pumpInsideRing(s, fin(MG.highAndDryH, 8)) ? 2 : 1) : 0, goal: 2 }; },
    untouched: function (s) { return { progress: pr(s).drainedEver ? 0 : (M.earned(s, 'flagship') ? 1 : 0.5), goal: 1 }; }
  };
  function milestoneRow(id) { return (data().milestones || []).find(function (m) { return m.id === id; }) || { id: id, name: id, text: '', reward: {} }; }
  /** {progress, goal, text} for the Milestones panel and nearestMilestones */
  M.milestoneProgress = function (state, id) {
    try {
      const row = milestoneRow(id);
      if (M.earned(state, id)) return { progress: 1, goal: 1, text: row.text };
      const f = MILESTONE_PROGRESS[id];
      if (f) { const r = f(state); return { progress: clamp(fin(r.progress, 0), 0, fin(r.goal, 1)), goal: fin(r.goal, 1), text: row.text }; }
      return { progress: 0, goal: 1, text: row.text };
    } catch (e) { BSU.error('progress', 'milestoneProgress', e); return { progress: 0, goal: 1, text: '' }; }
  };
  M.earned = function (state, id) { const m = state && state.progress && state.progress.milestones && state.progress.milestones[id]; return !!(m && m.earned); };
  function applyMilestoneReward(state, id, reward, meta) {
    const cash = fin(reward.cash, fin((PP.milestoneCash || {})[id], 0));
    const pres = fin(reward.prestige, fin((PP.milestonePrestige || {})[id], 0));
    if (cash > 0) call('economy', 'post', state, 'grants', cash, { note: milestoneRow(id).name });
    if (pres !== 0) call('economy', 'bump', state, 'prestige', pres, 'milestone:' + id);
    const ME = PP.milestoneEffects || {};
    switch (reward.effect) {
      case 'pilingsDiscount': M.addTimer(state, 'pilingsDiscount', fin(ME.wetFeetDiscount, 0.25), NONE, meta || null); break;
      case 'postUpkeepHalf': M.addTimer(state, 'postUpkeepHalf', fin(ME.wranglerUpkeep, 0.5), NONE); break;
      case 'sunbather': M.addTimer(state, 'sunbather', fin((PE.timers || {}).sunbather && PE.timers.sunbather.value, 1), fin(ME.sunbatherDays, 30)); break;
      case 'undefeatedDonations': M.addTimer(state, 'undefeatedDonations', 1.5, fin(ME.undefeatedDonationDays, 120)); break;
      case 'bigBoil': M.addTimer(state, 'bigBoil', fin((PE.timers || {}).bigBoil && PE.timers.bigBoil.value, 3), fin(ME.bigBoilDays, 10)); break;
      case 'researchBonus': M.addTimer(state, 'researchBonus', 0.10, NONE); break;
      case 'pilingsDiscountYear': M.addTimer(state, 'pilingsDiscountYear', fin(ME.sinkingDiscount, 0.25), fin(ME.sinkingDays, 120)); break;
      default: break;   // goldRing / titleCampus: render reads earned()
    }
  }
  /** award a milestone once (no-op while the debug panel is open) */
  M.achieve = function (state, id, meta) {
    try {
      lazyKeys(state);
      const p = pr(state);
      if (p.achievementsWhileDebug) return;
      const m = p.milestones[id];
      if (!m) { BSU.error('progress', 'achieve', new Error('unknown milestone ' + id)); return; }
      if (m.earned) return;
      m.earned = true; m.day = today(state);
      const row = milestoneRow(id);
      applyMilestoneReward(state, id, row.reward || {}, meta);
      emit(EV.MILESTONE_EARNED, { id: id, name: row.name, reward: row.reward || {} });
      notify(state, { kind: 'event', text: 'Milestone: ' + row.name, stamp: 'paw', milestone: id });
      audio('milestone');
      ctx(state).unlockDirty = true; ctx(state).nearestDay = NONE;
    } catch (e) { BSU.error('progress', 'achieve', e); }
  };
  M.nearestMilestones = function (state, n) {
    try {
      const c = ctx(state), day = today(state);
      n = fin(n, 3);
      if (!c.nearest || c.nearestDay !== day) {
        const rows = [];
        for (const id of BSU.MILESTONES) {
          if (M.earned(state, id)) continue;
          const mp = M.milestoneProgress(state, id);
          rows.push({ id: id, name: milestoneRow(id).name, progress: mp.progress, goal: mp.goal, ratio: mp.goal > 0 ? mp.progress / mp.goal : 0 });
        }
        rows.sort(function (a, b) { return b.ratio - a.ratio; });
        c.nearest = rows; c.nearestDay = day;
      }
      return c.nearest.slice(0, n).map(function (r) { return { id: r.id, name: r.name, progress: r.progress, goal: r.goal }; });
    } catch (e) { BSU.error('progress', 'nearestMilestones', e); return []; }
  };
  function pollMilestones(state) {
    for (const id of BSU.MILESTONES) {
      const f = MILESTONE_COND[id];
      if (!f || M.earned(state, id)) continue;
      let ok = false;
      try { ok = !!f(state); } catch (e) { BSU.error('progress', 'milestone:' + id, e); }
      if (ok) {
        if (id === 'sinkingFeeling') { const b = blist(state).find(function (x) { return fin(x.sunk, 0) >= 1; }); M.ticker(state, 26, { hall: b ? b.name : 'A hall' }, null, b ? BSU.idx(b.tx, b.ty) : NONE); }
        if (id === 'fortressBayou' || id === 'livingWithWater') ctx(state).unlockDirty = true;
        M.achieve(state, id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Objectives (§10.2): table, scheduler, goals
  // ---------------------------------------------------------------------------
  const G = PP.goals || {};
  function od(id) { return (data().objectives || {})[id] || null; }
  function kindOf(id) {
    if (id.indexOf('v:') === 0 || id.indexOf('p') === 0) return OBJ.BACKGROUND;
    const d = od(id); return d ? d.kind : OBJ.INTERRUPT;
  }
  function ost(state, id) { const o = pr(state).objectives; if (!o[id]) o[id] = { state: 'locked', progress: 0, goal: 0, since: NONE, deadlineDay: NONE, text: '' }; return o[id]; }
  function done(state, id) { const o = pr(state).objectives[id]; return !!o && o.state === 'done'; }
  function closed(state, id) { const o = pr(state).objectives[id]; return !!o && (o.state === 'done' || o.state === 'dismissed'); }
  M.offered = function (state, id) { const o = state && state.progress && state.progress.objectives && state.progress.objectives[id]; return !!o && o.state !== 'locked'; };
  const EXTRA_OBJ = {
    p1: { kind: OBJ.BACKGROUND, title: 'Accreditation Task Force: a Library', text: 'Build a Library.', showMe: 'target' },
    p2: { kind: OBJ.BACKGROUND, title: 'Accreditation Task Force: seats', text: 'Lecture seats for 5 of every 6 students.', showMe: 'target' },
    p3: { kind: OBJ.BACKGROUND, title: 'Accreditation Task Force: dry feet', text: 'No flooded buildings for 30 days.', showMe: 'ring' }
  };
  function objDef(id) {
    if (EXTRA_OBJ[id]) return EXTRA_OBJ[id];
    if (id.indexOf('v:') === 0) { const vc = (data().voiceCards || []).find(function (v) { return 'v:' + v.id === id; }); return vc ? { kind: OBJ.BACKGROUND, title: vc.student.split(' ')[0] + ' asks', text: vc.text, showMe: 'target', payoff: vc.payoff } : null; }
    return od(id);
  }
  /** a counted geometry: how many of `tiles` lie within r (Chebyshev) of any tile for which pred(i) holds */
  function near(i, r, pred) { const x0 = i % W, y0 = (i / W) | 0; for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) if (BSU.inBounds(x, y) && pred(y * W + x)) return true; return false; }
  function surfaceRoute(state) {
    // BFS over surface 1–3 from the Founders' ring to plot.landingShoulder (Objective 2)
    const f = state.plot && state.plot.founders, target = fin(state.plot && state.plot.landingShoulder, NONE);
    if (!f || target < 0) return false;
    const fb = blist(state, 'founders_hall')[0];
    const ring = fb ? BSU.edgeTiles(fb.tx, fb.ty, fb.w, fb.h) : BSU.edgeTiles(f.tx, f.ty, 3, 3);
    const surf = state.tiles.surface, seen = new Uint8Array(N), q = [];
    const passable = function (i) { return surf[i] >= SURF.PATH && surf[i] <= SURF.BOARDWALK; };
    for (const i of ring) if (i >= 0 && i < N && passable(i) && !seen[i]) { seen[i] = 1; q.push(i); }
    if (target < N && passable(target) === false) { /* the shoulder itself may be bare: accept adjacency */ }
    let head = 0;
    while (head < q.length) {
      const i = q[head++];
      if (i === target || tileCheb(i, target) <= 1) return true;
      for (const n of BSU.nbr4(i)) if (!seen[n] && passable(n)) { seen[n] = 1; q.push(n); }
    }
    return false;
  }
  function canalReachesBayou(state) {
    const nets = call('hydro', 'networks', state) || [];
    const low = coveLowest(state); if (low < 0) return false;
    for (const net of nets) {
      if (!net || !net.drainsToWater) continue;
      for (const i of (net.tiles || [])) if (tileCheb(i, low) <= 2) return true;
    }
    return false;
  }
  function oaksAlongPaths(state) {
    const surf = state.tiles.surface; let n = 0;
    for (const v of (state.veg || [])) if (v && v.type === 'oak' && v.planted && near(BSU.idx(v.tx, v.ty), 1, function (i) { return surf[i] >= SURF.PATH && surf[i] <= SURF.BOARDWALK; })) n++;
    return n;
  }
  function longestRoadRun(state) {
    const surf = state.tiles.surface, seen = new Uint8Array(N); let best = 0;
    for (let s0 = 0; s0 < N; s0++) {
      if (surf[s0] !== SURF.ROAD || seen[s0]) continue;
      const q = [s0]; seen[s0] = 1; let head = 0;
      while (head < q.length) { const i = q[head++]; for (const n of BSU.nbr4(i)) if (surf[n] === SURF.ROAD && !seen[n]) { seen[n] = 1; q.push(n); } }
      if (q.length > best) best = q.length;
    }
    return best;
  }
  function fenceGuardsDining(state) {
    if (bcount(state, 'wildlife_post') > 0) return true;
    const dining = blist(state, 'dining_hall'); if (!dining.length) return false;
    const surf = state.tiles.surface;
    for (let i = 0; i < N; i++) {
      if (surf[i] !== SURF.FENCE) continue;
      if (!near(i, 3, function (j) { return isWater(state, j); })) continue;
      const x = i % W, y = (i / W) | 0;
      for (const d of dining) if (cheb(x, y, d.tx + (d.w >> 1), d.ty + (d.h >> 1)) <= 8) return true;
    }
    return false;
  }
  function coveLeveed(state) {
    const H = fin(G.ringH11, 5);
    if (!call('buildings', 'coveTilesUnreached', state, H)) return false;
    const gaps = call('buildings', 'gaps', state, H) || { reachedBuildings: [] };
    const reached = new Set(gaps.reachedBuildings || []);
    for (const b of blist(state, 'pump')) {
      if (!complete(b) || reached.has(b.id)) continue;
      for (const e of BSU.edgeTiles(b.tx, b.ty, b.w, b.h)) if (call('hydro', 'networkAt', state, e)) return true;
    }
    return false;
  }
  function stormChecklist(state) {
    const st = state.storms && state.storms.current;
    let n = 0;
    const subs = blist(state, 'substation').filter(complete), gens = blist(state, 'generator').filter(complete);
    let subsOk = subs.length > 0;
    for (const s of subs) if (!s.pilings && !gens.some(function (g) { return cheb(g.tx, g.ty, s.tx, s.ty) <= 6; })) { subsOk = false; break; }
    if (subsOk) n++;
    const H = fin(call('weather', 'forecastSurge', state), fin(PS.ringDefaultH, 5));
    const gaps = call('buildings', 'gaps', state, H) || { gaps: [], weak: [], gates: [] };
    const ring = !!call('buildings', 'ringClosed', state, H) && !(gaps.weak && gaps.weak.length);
    if (ring) n++;
    let gatesOk = true;
    for (const g of (gaps.gaps || [])) for (const i of (g.tiles || [])) if (state.tiles.flags[i] & FLAG.CANAL) { gatesOk = false; break; }
    if (gatesOk) n++;
    const sh = call('buildings', 'shelter', state) || { ok: false };
    if (sh.ok || (st && st.evacuated)) n++;
    if (st && ((st.boardQueue && st.boardQueue.length > 0) || fin(st.boardedCount, 0) > 0)) n++;
    return { progress: n, goal: 5 };
  }
  function preserveSouth(state) {
    const rect = state.plot && state.plot.rect; const y1 = rect ? rect.y1 : (HGT >> 1);
    let n = 0; const fl = state.tiles.flags;
    for (let i = 0; i < N; i++) if ((fl[i] & FLAG.PRESERVE) && ((i / W) | 0) > y1) n++;
    return n;
  }
  // Triggers: id → (state, c) → boolean (locked objectives only)
  const TRIGGERS = {
    '6': function (s) { return done(s, '5'); },
    '7': function (s) { return done(s, '6'); },
    '8': function (s) { return done(s, '7'); },
    '9': function (s, c) { return !!c.trig['9']; },
    '10': function (s, c) { return !!c.trig['10']; },
    '11': function (s, c) { return !!c.trig['11']; },
    '11a': function (s, c) { return !!c.trig['11a']; },
    '12': function (s, c) { return !!c.trig['12']; },
    '13': function (s, c) { return !!c.trig['13']; },
    '14': function (s, c) { return !!c.trig['14']; },
    '15': function (s) { return students(s) >= fin(G.students15, 400); },
    '16': function (s, c) { return (!!c.trig['16'] && done(s, '9')) || ecology(s) < fin(G.ecology16, 75); },
    '17': function (s) { return students(s) >= fin(G.students17, 1000); },
    '18a': function (s) { return bhas(s, 'practice_field', 1); },
    '18b': function (s) { return done(s, '18a'); },
    '18': function (s) { return done(s, '18b'); },
    '19': function (s) { return students(s) >= fin(G.students19, 2000); },
    '20': function (s) { return students(s) >= fin(G.students20, 1500); },
    '21': function (s) { return students(s) >= fin(G.students21, 5000); },
    '22': function (s) { return done(s, '21'); },
    p2: function (s) { return done(s, 'p1'); },
    p3: function (s) { return done(s, 'p2'); }
  };
  // Goals: id → (state, c) → {progress, goal, text?}
  const GOALS = {
    '1': function (s) { return { progress: bcount(s, 'founders_hall') ? 1 : 0, goal: 1 }; },
    '2': function (s, c) { if (c.tileDirty || c.obj2 === undefined) c.obj2 = surfaceRoute(s); return { progress: c.obj2 ? 1 : 0, goal: 1 }; },
    '3': function (s) { return { progress: (bcount(s, 'dorm') ? 1 : 0) + (bcount(s, 'dining_hall') ? 1 : 0), goal: 2 }; },
    '4': function (s) { return { progress: canalReachesBayou(s) ? 1 : 0, goal: 1 }; },
    '5': function (s) { return { progress: (bcount(s, 'substation') ? 1 : 0) + (bcount(s, 'water_tower') ? 1 : 0), goal: 2 }; },
    '6': function (s) { return { progress: Math.min(oaksAlongPaths(s), fin(G.oaks6, 5)), goal: fin(G.oaks6, 5) }; },
    '7': function (s) { return { progress: Math.min(longestRoadRun(s), fin(G.roadTiles7, 10)), goal: fin(G.roadTiles7, 10) }; },
    '8': function (s) { return { progress: Math.min(students(s), fin(G.students8, 500)), goal: fin(G.students8, 500) }; },
    '9': function (s) { return { progress: fenceGuardsDining(s) ? 1 : 0, goal: 1 }; },
    '10': function (s) { const idx = fin(call('wildlife', 'mosqIndex', s), fin(s.wildlife && s.wildlife.mosqIndex, 0)); const o = ost(s, '10'); const okDays = idx < fin(G.mosq10, 0.3) ? fin(o.progress, 0) : 0; return { progress: okDays, goal: 1, daily: true }; },
    '11': function (s, c) { const ok = coveLeveed(s); if (!ok) { const g = call('buildings', 'gaps', s, fin(G.ringH11, 5)); const first = g && g.gaps && g.gaps[0]; c.obj11Text = first ? ('still ' + first.len + ' tile' + (first.len === 1 ? '' : 's') + ' short at ' + first.name) : (call('buildings', 'coveTilesUnreached', s, fin(G.ringH11, 5)) ? 'ring closed: a Pump inside, touching a canal' : 'close the cove mouth'); } return { progress: ok ? 1 : 0, goal: 1, text: c.obj11Text }; },
    '11a': function () { return { progress: 0, goal: 1 }; },
    '12': function (s) { return stormChecklist(s); },
    '13': function () { return { progress: 0, goal: 1 }; },
    '14': function (s) { const st = call('buildings', 'stats', s) || {}; return { progress: fin(st.unrepaired, 0) === 0 ? 1 : 0, goal: 1 }; },
    '15': function (s) { let n = 0; if (bcount(s, 'practice_field')) n++; if (bhas(s, 'practice_field', 1)) n++; if (fin(s.sports && s.sports.firstHomeGameDay, NONE) >= 0) n++; return { progress: n, goal: 3 }; },
    '16': function (s) { return { progress: Math.min(preserveSouth(s), fin(G.preserve16, 20)), goal: fin(G.preserve16, 20) }; },
    '17': function (s) { return { progress: (students(s) >= fin(G.target17, 1500) ? 1 : 0) + (bhas(s, 'wastewater') ? 1 : 0), goal: 2 }; },
    '18a': function (s) { const r = s.sports && s.sports.record; return { progress: Math.min(fin(r && r.wins, 0), fin(G.wins18a, 4)), goal: fin(G.wins18a, 4) }; },
    '18b': function (s) { const r = s.sports && s.sports.record, ls = s.sports && s.sports.lastSeason; const w = Math.max(fin(r && r.wins, 0), fin(ls && ls.wins, 0)); return { progress: Math.min(w, fin(G.wins18b, 5)), goal: fin(G.wins18b, 5) }; },
    '18': function (s) { return { progress: M.earned(s, 'geauxBeatMagnolia') ? 1 : 0, goal: 1 }; },
    '19': function (s) { return { progress: (prestige(s) >= fin(G.prestige19, 30) ? 1 : 0) + (bhas(s, 'bell_tower') ? 1 : 0), goal: 2 }; },
    '20': function (s) { return { progress: (bhas(s, 'stadium', 2) ? 1 : 0) + (M.earned(s, 'nightFalls') ? 1 : 0), goal: 2 }; },
    '21': function (s) { return { progress: (bhas(s, 'surge_barrier') || bhas(s, 'marsh_restoration')) ? 1 : 0, goal: 1 }; },
    '22': function (s) { return { progress: (students(s) >= fin(G.students22, 10000) ? 1 : 0) + (prestige(s) >= fin(G.prestige22, 60) ? 1 : 0), goal: 2 }; },
    p1: function (s) { return { progress: bhas(s, 'library') ? 1 : 0, goal: 1 }; },
    p2: function (s) { const st = call('buildings', 'stats', s) || {}; return { progress: fin(st.seats, 0) >= students(s) / 1.2 ? 1 : 0, goal: 1 }; },
    p3: function (s) { const o = ost(s, 'p3'); return { progress: Math.min(fin(o.progress, 0), 30), goal: 30, daily: true }; }
  };
  // Voice-card goals (background objectives 'v:<id>')
  function unionTiles(s) { return blist(s, 'union').filter(complete); }
  function oaksWithin(s, r, pred) { let n = 0; for (const v of (s.veg || [])) if (v && v.type === 'oak' && v.planted && pred(v)) n++; return n; }
  function withinOf(b, r, tx, ty) { return !!b && cheb(b.tx + (b.w >> 1), b.ty + (b.h >> 1), tx, ty) <= r; }
  const VOICE_GOALS = {
    boardwalk: function (s) { let n = 0; const surf = s.tiles.surface, ty = s.tiles.type, fl = s.tiles.flags; for (let i = 0; i < N; i++) if (surf[i] === SURF.BOARDWALK && (ty[i] === T.MARSH || (fl[i] & FLAG.PRESERVE))) n++; return { progress: Math.min(n, 6), goal: 6 }; },
    recPool: function (s) { const f = blist(s, 'practice_field')[0]; const ok = !!f && blist(s, 'rec_center').some(function (r) { return withinOf(r, 10, f.tx, f.ty); }); return { progress: ok ? 1 : 0, goal: 1 }; },
    zydeco: function (s) { const u = unionTiles(s)[0]; const n = u ? oaksWithin(s, 3, function (v) { return withinOf(u, 3, v.tx, v.ty); }) : 0; return { progress: Math.min(n, 4), goal: 4 }; },
    poboyRoute: function (s) {
      const dorms = blist(s, 'dorm'), hall = blist(s, 'lecture_hall')[0];
      if (!hall || !dorms.length) return { progress: 0, goal: 1 };
      const surf = s.tiles.surface, passable = function (i) { return surf[i] >= SURF.PATH && surf[i] <= SURF.BOARDWALK; };
      const shacks = blist(s, 'poboy').filter(complete); if (!shacks.length) return { progress: 0, goal: 1 };
      const shackEdges = new Set(); for (const sh of shacks) for (const e of BSU.edgeTiles(sh.tx, sh.ty, sh.w, sh.h)) shackEdges.add(e);
      // BFS from any dorm edge over surfaces; the path to the hall must touch a shack edge: approximate by reachability of both from a shack edge
      const seen = new Uint8Array(N), q = [];
      for (const e of shackEdges) if (passable(e)) { seen[e] = 1; q.push(e); }
      let head = 0, dormHit = false, hallHit = false;
      const hallEdges = new Set(BSU.edgeTiles(hall.tx, hall.ty, hall.w, hall.h)); const dormEdges = new Set(); for (const d of dorms) for (const e of BSU.edgeTiles(d.tx, d.ty, d.w, d.h)) dormEdges.add(e);
      while (head < q.length) { const i = q[head++]; if (hallEdges.has(i)) hallHit = true; if (dormEdges.has(i)) dormHit = true; if (hallHit && dormHit) break; for (const n of BSU.nbr4(i)) if (!seen[n] && passable(n)) { seen[n] = 1; q.push(n); } }
      return { progress: hallHit && dormHit ? 1 : 0, goal: 1 };
    },
    quadOak: function (s) { const f = s.plot && s.plot.founders; const ok = !!f && blist(s, 'quad').some(function (q) { return withinOf(q, 6, f.tx, f.ty); }); return { progress: ok ? 1 : 0, goal: 1 }; },
    batHouse: function (s) { const n = blist(s, 'bat_house').filter(function (b) { return near(BSU.idx(b.tx, b.ty), 4, function (i) { return isWater(s, i) || s.tiles.type[i] === T.MARSH; }); }).length; return { progress: Math.min(n, 3), goal: 3 }; },
    parking: function (s) { return { progress: bcount(s, 'parking') ? 1 : 0, goal: 1 }; },
    healthShade: function (s) {
      const hc = blist(s, 'health_center')[0]; if (!hc) return { progress: 0, goal: 1 };
      const surf = s.tiles.surface; let paths = 0, shaded = 0;
      for (let y = hc.ty - 6; y <= hc.ty + hc.h + 5; y++) for (let x = hc.tx - 6; x <= hc.tx + hc.w + 5; x++) {
        if (!BSU.inBounds(x, y) || surf[y * W + x] !== SURF.PATH) continue; paths++;
        if ((s.veg || []).some(function (v) { return v && v.type === 'oak' && cheb(v.tx, v.ty, x, y) <= 1; })) shaded++;
      }
      return { progress: paths > 0 && shaded === paths ? 1 : 0, goal: 1 };
    },
    greekPorch: function (s) { const f = blist(s, 'practice_field')[0]; const ok = !!f && blist(s, 'greek_house').some(function (g) { return withinOf(g, 8, f.tx, f.ty); }); return { progress: ok ? 1 : 0, goal: 1 }; },
    cypressLine: function (s) { const crest = s.tiles.crest; const n = blist(s, 'cypress').filter(function (b) { return near(BSU.idx(b.tx, b.ty), 1, function (i) { return crest[i] > 0; }); }).length + (s.veg || []).filter(function (v) { return v && v.type === 'cypress' && v.planted && near(BSU.idx(v.tx, v.ty), 1, function (i) { return crest[i] > 0; }); }).length; return { progress: Math.min(n, 10), goal: 10 }; },
    lookout: function (s) { const fl = s.tiles.flags, surf = s.tiles.surface; let ok = false; for (let i = 0; i < N && !ok; i++) if (surf[i] === SURF.BOARDWALK && near(i, 1, function (j) { return !!(fl[j] & FLAG.PRESERVE); })) ok = true; return { progress: ok ? 1 : 0, goal: 1 }; },
    bellSelfie: function (s) { const bt = blist(s, 'bell_tower')[0]; const ok = !!bt && blist(s, 'quad').some(function (q) { return withinOf(q, 2, bt.tx, bt.ty); }); return { progress: ok ? 1 : 0, goal: 1 }; }
  };
  const VOICE_PREREQ = {
    boardwalk: function (s) { if (bcount(s, 'preserve')) return true; const f = s.plot && s.plot.founders; if (!f) return false; let n = 0; for (let y = f.ty - 12; y <= f.ty + 12; y++) for (let x = f.tx - 12; x <= f.tx + 12; x++) if (BSU.inBounds(x, y) && (s.tiles.type[y * W + x] === T.MARSH || (s.tiles.flags[y * W + x] & FLAG.PRESERVE))) n++; return n >= 20; },
    recPool: function (s) { return bcount(s, 'practice_field') > 0 && M.unlocked(s, 'rec_center'); },
    zydeco: function (s) { return bhas(s, 'union'); },
    poboyRoute: function (s) { return bcount(s, 'dorm') >= 2 && bcount(s, 'lecture_hall') > 0; },
    quadOak: function (s) { return students(s) >= 300; },
    batHouse: function (s) { return pr(s).firsts.mosquitoDay >= 0; },
    parking: function (s) { return students(s) >= 600; },
    healthShade: function (s) { return bhas(s, 'health_center'); },
    greekPorch: function (s) { return M.unlocked(s, 'greek_house') && bhas(s, 'practice_field', 1); },
    cypressLine: function (s) { let n = 0; const crest = s.tiles.crest; for (let i = 0; i < N; i++) if (crest[i] > 0) n++; return ecology(s) < 60 && n >= 10; },
    lookout: function (s) { return bcount(s, 'preserve') > 0 || preserveSouth(s) > 0 || anyPreserve(s); },
    bellSelfie: function (s) { return bhas(s, 'bell_tower'); }
  };
  function anyPreserve(s) { const fl = s.tiles.flags; for (let i = 0; i < N; i++) if (fl[i] & FLAG.PRESERVE) return true; return false; }
  function goalFor(id) { if (id.indexOf('v:') === 0) return VOICE_GOALS[id.slice(2)] || null; return GOALS[id] || null; }

  function queueFor(state, id) { return kindOf(id) === OBJ.INTERRUPT ? pr(state).interruptQueue : pr(state).backgroundQueue; }
  /** trigger fired: locked → queued */
  function offerObjective(state, id) {
    const def = objDef(id);
    if (!def) { BSU.error('progress', 'offer', new Error('unknown objective ' + id)); return; }
    const o = ost(state, id);
    if (o.state !== 'locked') return;
    o.state = 'queued';
    const q = queueFor(state, id);
    if (PREEMPT.has(id)) {
      // storm interrupts jump the queue and push the active interrupt back to the front behind them (it is re-offered after)
      if (q.indexOf(id) < 0) q.unshift(id);
      const p = pr(state);
      if (interruptActive(state)) { const cur = p.card; ost(state, cur).state = 'queued'; if (q.indexOf(cur) < 0) q.splice(1, 0, cur); p.card = p.background; }
    } else if (q.indexOf(id) < 0) q.push(id);
    ctx(state).dirty = true;
  }
  const PREEMPT = new Set(['12', '13', '14']);
  function deadlineFor(state, id) {
    const day = today(state);
    if (id === '8') return nextDate(G.deadline8 || 'Aug 5', day);
    if (id === '12') { const st = state.storms && state.storms.current; return st && Number.isFinite(st.landfallDay) ? st.landfallDay : day + fin(G.coneDays12, 6); }
    if (id.indexOf('v:') === 0) return day + fin(PP.voiceDeadlineDays, 30);
    return NONE;
  }
  function activate(state, id, asBackground) {
    const o = ost(state, id), def = objDef(id) || {};
    o.state = 'active'; o.since = today(state); o.deadlineDay = deadlineFor(state, id);
    o.text = def.text || '';
    const g = goalFor(id); if (g) { try { const r = g(state, ctx(state)); o.goal = fin(r.goal, 1); o.progress = r.daily ? fin(o.progress, 0) : fin(r.progress, 0); } catch (e) { BSU.error('progress', 'goal:' + id, e); } }
    if (asBackground) pr(state).background = id; else pr(state).card = id;
    if (!asBackground && id === '2') { const l = fin(state.plot && state.plot.landing, NONE); if (l >= 0) call('render', 'flashTiles', [l], 1e9); }
    emit(EV.OBJECTIVE_OFFERED, { id: id, kind: kindOf(id), text: o.text, progress: o.progress, goal: o.goal });
    if (id === '11') audio('sting');
  }
  function interruptActive(state) { const p = pr(state); return p.card !== null && p.card !== p.background; }
  /** one promotion per tick (interrupt first, then background) */
  function promote(state, c) {
    if (c.offeredThisTick) return;
    const p = pr(state);
    while (p.interruptQueue.length && !objDef(p.interruptQueue[0])) { BSU.error('progress', 'queue', new Error('dropping unknown objective ' + p.interruptQueue[0])); p.interruptQueue.shift(); }
    while (p.backgroundQueue.length && !objDef(p.backgroundQueue[0])) { BSU.error('progress', 'queue', new Error('dropping unknown objective ' + p.backgroundQueue[0])); p.backgroundQueue.shift(); }
    if (!interruptActive(state) && p.interruptQueue.length) {
      const id = p.interruptQueue.shift();
      if (ost(state, id).state !== 'queued') return;
      activate(state, id, false); c.offeredThisTick = true; return;
    }
    if (!p.background && p.backgroundQueue.length) {
      const id = p.backgroundQueue.shift();
      if (ost(state, id).state !== 'queued') return;
      activate(state, id, true); c.offeredThisTick = true;
      if (p.card === null) p.card = id;
    }
  }
  function clearActive(state, id) {
    const p = pr(state);
    if (p.background === id) p.background = null;
    if (p.card === id) p.card = p.background;
    if (p.card === null && p.background) p.card = p.background;
    const qi = p.interruptQueue.indexOf(id); if (qi >= 0) p.interruptQueue.splice(qi, 1);
    const qb = p.backgroundQueue.indexOf(id); if (qb >= 0) p.backgroundQueue.splice(qb, 1);
  }
  function voicePayoff(state, vid) {
    const dayStr = function (d) { return daysUntil(state, d); };
    switch (vid) {
      case 'boardwalk': M.addTimer(state, 'voiceApplicants', 40, NONE); break;
      case 'recPool': M.addTimer(state, 'voiceTeamRating', 2, dayStr('Dec 9')); break;
      case 'zydeco': M.addTimer(state, 'studentVoice', fin(PE.timers && PE.timers.studentVoice && PE.timers.studentVoice.value, 2), 30); M.addTimer(state, 'zydecoFriday', 1, NONE); break;
      case 'poboyRoute': { const sh = blist(state, 'poboy').filter(complete)[0]; M.addTimer(state, 'voicePoboy', 3000, NONE, { building: sh ? sh.id : NONE }); break; }
      case 'quadOak': M.addTimer(state, 'studentVoice', fin(PE.timers && PE.timers.studentVoice && PE.timers.studentVoice.value, 2), 30); break;
      case 'batHouse': call('wildlife', 'applyEcologyOnce', state, 1); M.addTimer(state, 'voiceFoggerWaiver', 1, 30); break;
      case 'parking': M.removeTimer(state, 'noParking'); M.addTimer(state, 'voiceParking', 2000, NONE); break;
      case 'healthShade': M.addTimer(state, 'voiceHeatIllness', 0.2, dayStr('Aug 4')); break;
      case 'greekPorch': M.addTimer(state, 'voiceTailgate', 0.25, dayStr('Dec 9')); break;
      case 'cypressLine': { const tiles = []; const crest = state.tiles.crest; for (const b of blist(state, 'cypress')) { const i = BSU.idx(b.tx, b.ty); if (near(i, 1, function (j) { return crest[j] > 0; })) tiles.push(i); } M.addTimer(state, 'voiceCypressLine', 1, NONE, { tiles: tiles }); call('wildlife', 'applyEcologyOnce', state, 2); break; }
      case 'lookout': pr(state).hints.lookoutPending = true; break;
      case 'bellSelfie': M.addTimer(state, 'voiceApplicants', 60, NONE); break;
      default: break;
    }
    const vc = pr(state).voiceCards.find(function (v) { return v.id === vid; }); if (vc) vc.state = 'done';
    emit(EV.VOICE_RESOLVED, { id: vid, state: 'done' });
  }
  /** mark done, pay the reward once, emit objective:complete; the next offer happens next tick */
  M.complete = function (state, id) {
    try {
      lazyKeys(state);
      const o = ost(state, id);
      if (o.state === 'done') return;
      const wasActive = o.state === 'active' || o.state === 'queued';
      o.state = 'done'; o.progress = Math.max(o.progress, o.goal);
      clearActive(state, id);
      if (id.indexOf('v:') === 0) voicePayoff(state, id.slice(2));
      else if (id.indexOf('p') === 0) { /* Accreditation chain: no reward */ }
      else if (GRANT_IDS.has(id)) {
        const grant = fin(PP.grant, 50000);
        call('economy', 'post', state, 'grants', grant, { note: 'Legislature approves' });
        notify(state, { kind: 'money', text: 'Legislature approves: +' + money(grant) });
      } else call('economy', 'bump', state, 'prestige', fin(PP.objectivePrestige, 2), 'objective:' + id);
      emit(EV.OBJECTIVE_COMPLETE, { id: id, kind: kindOf(id), text: o.text });
      if (wasActive) audio('chime');
      if (id === '2') call('render', 'clearFlashes');
      if (TUTORIAL_IDS.indexOf(id) >= 0 && pr(state).tutorialStage < 6) onTutorialComplete(state, id);
      if (id === '14' && !M.earned(state, 'stormChaser')) {
        const log = (state.storms && state.storms.log) || []; let last = null;
        for (let i = log.length - 1; i >= 0; i--) if (log[i] && !log[i].nearMiss) { last = log[i]; break; }
        const value = fin(call('economy', 'buildingValue', state), 0);
        if (last && value > 0 && fin(last.damage, 0) < fin(MG.stormChaser, 0.2) * value) M.achieve(state, 'stormChaser');
      }
      if (id === '16') { pr(state).forceFirefliesDay = today(state); call('weather', 'suppressRainOn', state, today(state)); }
      ctx(state).dirty = true;
    } catch (e) { BSU.error('progress', 'complete', e); }
  };
  M.dismiss = function (state, id) {
    try {
      const o = ost(state, id);
      if (o.state === 'done' || o.state === 'dismissed') return;
      o.state = 'dismissed';
      clearActive(state, id);
      if (id.indexOf('v:') === 0) { const vc = pr(state).voiceCards.find(function (v) { return v.id === id.slice(2); }); if (vc) vc.state = 'declined'; emit(EV.VOICE_RESOLVED, { id: id.slice(2), state: 'declined' }); }
      emit(EV.OBJECTIVE_DISMISSED, { id: id, kind: kindOf(id), text: o.text });
      ctx(state).dirty = true;
    } catch (e) { BSU.error('progress', 'dismiss', e); }
  };
  M.reopen = function (state, id) {
    try {
      const o = ost(state, id);
      if (o.state !== 'dismissed') return;
      o.state = 'locked';
      offerObjective(state, id);
    } catch (e) { BSU.error('progress', 'reopen', e); }
  };
  function evalGoals(state, c, newDay) {
    const p = pr(state);
    const ids = [];
    if (p.card && p.card !== p.background) ids.push(p.card);
    if (p.background) ids.push(p.background);
    for (const id of ids) {
      const o = ost(state, id); if (o.state !== 'active') continue;
      const g = goalFor(id); if (!g) continue;
      let r; try { r = g(state, c); } catch (e) { BSU.error('progress', 'goal:' + id, e); continue; }
      if (r.daily) {
        if (!newDay) continue;
        if (id === '10') { const idx = fin(call('wildlife', 'mosqIndex', state), fin(state.wildlife && state.wildlife.mosqIndex, 0)); o.progress = idx < fin(G.mosq10, 0.3) ? fin(o.progress, 0) + 1 : 0; }
        else if (id === 'p3') { const flooded = blist(state).some(function (b) { return b.flooded; }); o.progress = flooded ? 0 : fin(o.progress, 0) + 1; }
        r = { progress: o.progress, goal: r.goal, text: r.text };
      }
      const goal = fin(r.goal, 1), prog = fin(r.progress, 0);
      if (prog !== o.progress || goal !== o.goal || (r.text && r.text !== c['txt:' + id])) {
        o.progress = prog; o.goal = goal; c['txt:' + id] = r.text || '';
        emit(EV.OBJECTIVE_PROGRESS, { id: id, kind: kindOf(id), text: r.text || o.text, progress: prog, goal: goal });
      }
      if (id === '11a' || id === '13') continue;   // watch objectives complete on their events
      if (prog >= goal && goal > 0) M.complete(state, id);
    }
  }
  function evalTriggers(state, c) {
    const p = pr(state);
    if (p.tutorialStage < 6) {
      // tutorial objectives are offered by the stage machine; later chain triggers still wait
      return;
    }
    for (const id of Object.keys(TRIGGERS)) {
      const o = ost(state, id);
      if (o.state !== 'locked') continue;
      if (id.indexOf('p') === 0 && !p.failure.probation) continue;
      let fire = false;
      try { fire = !!TRIGGERS[id](state, c); } catch (e) { BSU.error('progress', 'trigger:' + id, e); }
      if (fire) offerObjective(state, id);
    }
    for (const k of Object.keys(c.trig)) c.trig[k] = false;
  }
  function checkDeadlines(state, c) {
    const p = pr(state), day = today(state);
    const ids = [p.card, p.background];
    for (const id of ids) {
      if (!id) continue;
      const o = ost(state, id); if (o.state !== 'active' || o.deadlineDay < 0 || day < o.deadlineDay) continue;
      if (id === '8') {
        const d = od('8');
        o.text = fmt((d && d.cappedText) || 'Capped at {students}', { students: num(students(state)) });
        o.deadlineDay = nextDate(G.deadline8b || 'Jan 10', day + 1);
        emit(EV.OBJECTIVE_PROGRESS, { id: '8', kind: kindOf('8'), text: o.text, progress: o.progress, goal: o.goal, capped: true, deadlineText: 'by ' + (G.deadline8b || 'Jan 10') });
        ui(state, 'card', 'obj8', { students: students(state), text: o.text });
      } else if (id === '12') { /* resolved at landfall */ }
      else if (id.indexOf('v:') === 0) M.dismiss(state, id);
    }
  }
  /** what the card shows (interrupt first, else the background); null → ui shows the Milestones card */
  M.objective = function (state) {
    try {
      if (!state || !state.progress) return null;
      const p = state.progress;
      const bg = p.background ? ost(state, p.background) : null;
      const bgDef = p.background ? objDef(p.background) : null;
      const background = (bg && bg.state === 'active') ? { id: p.background, text: bg.text || (bgDef && bgDef.text) || '', title: bgDef ? bgDef.title : '', progress: bg.progress, goal: bg.goal, deadline: bg.deadlineDay } : null;
      let id = p.card || p.background;
      if (!id) return null;
      const o = ost(state, id);
      if (o.state !== 'active') { id = p.background; if (!id || ost(state, id).state !== 'active') return null; }
      const def = objDef(id) || {};
      const c = ctx(state);
      return { id: id, kind: kindOf(id), title: def.title || '', text: (id === '11' && c.obj11Text) ? (o.text + ' ' + c.obj11Text) : o.text || def.text || '', progress: o.progress, goal: o.goal, showMe: def.showMe || 'target', deadline: o.deadlineDay, deadlineText: def.deadlineText || '', background: (background && background.id !== id) ? background : null };
    } catch (e) { BSU.error('progress', 'objective', e); return null; }
  };
  /** camera target for an objective id or a showMe key */
  M.showMe = function (state, id) {
    try {
      const f = state.plot && state.plot.founders; const fb = f || { tx: W >> 1, ty: HGT >> 1 };
      const key = (od(id) || EXTRA_OBJ[id]) ? ((od(id) || EXTRA_OBJ[id]).showMe || 'target') : String(id);
      const tilesOf = function (arr) { return arr.filter(function (i) { return Number.isFinite(i) && i >= 0 && i < N; }); };
      const center = function (tiles, fallback) { if (!tiles.length) return fallback; let sx = 0, sy = 0; for (const i of tiles) { sx += i % W; sy += (i / W) | 0; } return { tx: Math.round(sx / tiles.length), ty: Math.round(sy / tiles.length) }; };
      if (key === 'plot') { const r = state.plot && state.plot.rect; if (r) { const tiles = []; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (BSU.inBounds(x, y)) tiles.push(y * W + x); return { tx: (r.x0 + r.x1) >> 1, ty: (r.y0 + r.y1) >> 1, tiles: tiles }; } return { tx: fb.tx, ty: fb.ty }; }
      if (key === 'cove') { const t = tilesOf((state.plot && state.plot.cove) || []); const cc = center(t, coveCenter(state)); return { tx: cc.tx, ty: cc.ty, tiles: t }; }
      if (key === 'landing') { const l = fin(state.plot && state.plot.landing, NONE); if (l >= 0) return { tx: l % W, ty: (l / W) | 0, tiles: [l] }; return { tx: fb.tx, ty: fb.ty }; }
      if (key === 'crown') { const r = call('terrain', 'reachableHigh5', state); const t = Array.isArray(r) ? tilesOf(r).filter(function (i) { return state.tiles.owner[i] < 0; }) : []; const cc = center(t, fb); return { tx: cc.tx, ty: cc.ty, tiles: t }; }
      if (key === 'ring') { const g = call('buildings', 'gaps', state, fin(G.ringH11, 5)); let t = []; if (g && g.gaps) for (const gap of g.gaps) t = t.concat(gap.tiles || []); if (!t.length) t = tilesOf((state.plot && state.plot.mouth) || []); const cc = center(t, coveCenter(state)); return { tx: cc.tx, ty: cc.ty, tiles: t }; }
      // target: per objective
      const c = ctx(state);
      if (id === '9') { const g = (call('wildlife', 'onCampus', state) || [])[0]; const i = g ? BSU.idx(g.tx | 0, g.ty | 0) : (c.firstGatorTile >= 0 ? c.firstGatorTile : NONE); if (i >= 0) return { tx: i % W, ty: (i / W) | 0, tiles: [i] }; const d = blist(state, 'dining_hall')[0]; if (d) { const dt = fin(call('buildings', 'dumpsterTile', state, d.id), NONE); if (dt >= 0) return { tx: dt % W, ty: (dt / W) | 0, tiles: [dt] }; return { tx: d.tx, ty: d.ty }; } }
      if (id === '10') { let best = c.worstMosqTile; if (best < 0) { best = 0; const mq = state.tiles.mosq; for (let i = 1; i < N; i++) if (mq[i] > mq[best]) best = i; } return { tx: best % W, ty: (best / W) | 0, tiles: [best] }; }
      if (id === '14') { const b = blist(state).find(function (x) { return fin(x.hp, 1) < 1 || x.flooded; }); if (b) return { tx: b.tx, ty: b.ty }; }
      if (id === '15' || id === '18a' || id === '18b' || id === '18' || id === '20') { const v = blist(state, 'stadium')[0] || blist(state, 'practice_field')[0]; if (v) return { tx: v.tx, ty: v.ty }; }
      if (id === '16') { const r = state.plot && state.plot.rect; if (r) return { tx: (r.x0 + r.x1) >> 1, ty: Math.min(HGT - 1, r.y1 + 4) }; }
      return { tx: fb.tx, ty: fb.ty };
    } catch (e) { BSU.error('progress', 'showMe', e); return { tx: W >> 1, ty: HGT >> 1 }; }
  };

  // ---------------------------------------------------------------------------
  // Tutorial (§10.1; stages 0–6)
  // ---------------------------------------------------------------------------
  M.tutorialStage = function (state) { return fin(state && state.progress && state.progress.tutorialStage, 0); };
  function introduceAllTabs(state) { for (const t of (data().tabs || [])) ui(state, 'introduceTab', t.id); }
  function enterStage(state, stage) {
    const c = ctx(state), p = pr(state);
    p.tutorialStage = stage;
    if (c.stageEntered === stage) return;
    c.stageEntered = stage;
    switch (stage) {
      case 1: {
        const f = state.plot && state.plot.founders;
        const swoopTicks = BSU.headlessMode ? 0 : Math.round(fin(PT.charterSwoopMs, 4000) / 1000 * fin(PT.baseTps, 5));   // sim ticks at 1× (was ms/100: 8 s once the base clock halved)
        if (f) { call('render', 'panToTile', f.tx, HGT - 1, false); call('render', 'panToTile', f.tx, f.ty, true); }
        c.swoop = { until: fin(state.tick, 0) + swoopTicks };
        c.charterShown = false;
        break;
      }
      case 2: offerObjective(state, '1'); ui(state, 'selectTool', 'founders_hall'); ui(state, 'lockTool', true); break;
      case 3: offerObjective(state, '2'); ui(state, 'selectTool', 'path'); c.tileDirty = true; c.obj2 = undefined; break;
      case 4: ui(state, 'introduceTab', 'essentials'); offerObjective(state, '3'); break;
      case 5:
        c.cellQueuedTick = NONE; c.pooledNotified = false; c.cellEndTick = NONE;
        if (p.firsts.cellDay >= 0) { c.cellTick = NONE; c.cellQueuedTick = fin(state.tick, 0); }   // loaded after the cell was queued: never queue a second one
        else c.cellTick = (fin(state.playSeconds, 0) >= fin(PP.tutorial && PP.tutorial.cellPlaySeconds, 75)) ? fin(state.tick, 0) : fin(state.tick, 0) + 30;
        break;
      case 6: if (!p.hints.freePlay) { p.hints.freePlay = true; introduceAllTabs(state); } if (c.boardDeferred) { c.boardDeferred = false; M.offerBoard(state); } break;
      default: break;
    }
  }
  /** ui/debug: jump the tutorial to a stage (runs that stage's entry script once) */
  M.advanceTutorial = function (state, stage) { try { lazyKeys(state); enterStage(state, clamp(fin(stage, 6) | 0, 0, 6)); } catch (e) { BSU.error('progress', 'advanceTutorial', e); } };
  /** ui: any input during the charter swoop ends it (camera snaps to the plot, the charter card shows) */
  M.skipSwoop = function (state) { try { const c = ctx(state); if (c.swoop) c.swoop.until = fin(state.tick, 0); } catch (e) { BSU.error('progress', 'skipSwoop', e); } };
  function showCharter(state, c) {
    c.charterShown = true; c.swoop = null;
    const f = state.plot && state.plot.founders; if (f) call('render', 'panToTile', f.tx, f.ty, false);
    const delivered = ui(state, 'card', 'charter', { autoMs: fin(PT.charterCardMs, 3000) });
    if (!delivered) enterStage(state, 2);   // no ui: nothing will close the card → stage 2 now
  }
  function tutorialTick(state, c) {
    const p = pr(state);
    const stage = p.tutorialStage;
    if (stage <= 0 || stage >= 6) return;
    if (c.stageEntered !== stage) enterStage(state, stage);
    if (stage === 1 && c.swoop && fin(state.tick, 0) >= c.swoop.until && !c.charterShown) showCharter(state, c);
    if (stage === 3 && c.tileDirty) { /* polled by evalGoals via GOALS['2'] */ }
    if (stage === 5) {
      if (c.cellQueuedTick < 0 && c.cellTick >= 0 && fin(state.tick, 0) >= c.cellTick) {
        const cc = coveCenter(state);
        call('weather', 'queueCell', state, { day: today(state), cx: cc.tx - 4, cy: cc.ty + 4, inches: fin(PP.tutorial && PP.tutorial.cellInches, 3), scripted: true });
        c.cellQueuedTick = fin(state.tick, 0);
        if (p.firsts.cellDay < 0) p.firsts.cellDay = today(state);
      }
      if (c.cellQueuedTick >= 0 && !c.pooledNotified) {
        const cove = (state.plot && state.plot.cove) || [];
        const pooled = [];
        for (const i of cove) if (state.tiles.surface[i] === SURF.PATH && fin(call('hydro', 'depthAt', state, i % W, (i / W) | 0), 0) >= 0.3) pooled.push(i);
        const ev = state.weather && state.weather.event;
        const cellPending = (state.weather && state.weather.cellQueue || []).some(function (q) { return q && q.scripted; });
        if (!ev && !cellPending && c.cellEndTick < 0 && fin(state.tick, 0) > c.cellQueuedTick + 5) c.cellEndTick = fin(state.tick, 0);
        const timeout = (c.cellEndTick >= 0 && fin(state.tick, 0) >= c.cellEndTick + 60) || fin(state.tick, 0) >= c.cellQueuedTick + 600;
        if (pooled.length || timeout) {
          c.pooledNotified = true;
          const at = pooled.length ? pooled[0] : coveLowest(state);
          notify(state, { text: 'Students are wading to class.', kind: 'water', showMe: { tx: at % W, ty: (at / W) | 0, tiles: pooled }, action: { label: 'Flood map', overlay: OV.FLOOD } });   // the showMe button already reads 'Show me'
          ui(state, 'introduceTab', 'swamp');
          offerObjective(state, '4');
        }
      }
    }
  }
  function onTutorialComplete(state, id) {
    const p = pr(state);
    if (p.tutorialStage >= 6 && TUTORIAL_IDS.indexOf(id) >= 0) return;
    switch (id) {
      case '1': ui(state, 'lockTool', false); M.achieve(state, 'chartered'); if (!p.hints.hudShown) { p.hints.hudShown = true; ui(state, 'hint', 'hudShown'); } enterStage(state, 3); break;
      case '2': {
        call('weather', 'setRunning', state, true);
        if (has('agents', 'spawnArrival')) { const c2 = ctx(state); c2.awaitFounding = true; c2.foundingDeadline = fin(state.tick, 0) + 600; call('agents', 'spawnArrival', state, FOUNDING, 'founding'); foundingLaunched(state, c2); }
        else foundingArrived(state);
        enterStage(state, 4);
        break;
      }
      case '3': call('economy', 'setSuspendCapPenalties', state, false); enterStage(state, 5); break;
      case '4': M.achieve(state, 'cajunEngineer'); audio('splash'); ui(state, 'introduceTab', 'utilities'); offerObjective(state, '5'); break;
      case '5': call('economy', 'setSuppressCoverage', state, false); enterStage(state, 6); break;
      default: break;
    }
  }
  const FOUNDING = 120;   // the founding cohort (GDD §2.4)
  /** the pirogues are away: remember who is aboard (the Students stat counts up as they step ashore), pan to the Landing and follow the lead pirogue */
  function foundingLaunched(state, c) {
    c.foundingIds = (state.agents || []).filter(function (a) { return a && a.aboard && a.arrival; }).map(function (a) { return a.id; });
    c.foundingAdded = 0;
    const L = fin(state.plot && state.plot.landing, NONE);
    if (L >= 0) call('render', 'panToTile', L % W, (L / W) | 0, true);
    call('render', 'followVehicle', function (v) { return !!(v && v.kind === 'pirogue' && v.arrival && v.state === 'GO'); });
  }
  /** ≤ 4 students per tick toward the share of the cohort already ashore (the rest lands with agent:arrive) */
  function foundingCountUp(state, c) {
    const A = state.agents || []; let ashore = 0;
    for (let k = 0; k < c.foundingIds.length; k++) { const a = A[c.foundingIds[k]]; if (a && !a.aboard) ashore++; }
    const target = Math.round(FOUNDING * ashore / c.foundingIds.length);
    const step = Math.min(4, target - c.foundingAdded);
    if (step > 0) { c.foundingAdded += step; call('economy', 'addStudents', state, step, 'founding'); }
  }
  const DESIRE_DAYS = 3;
  /** post the merged desire-line hint/notify for everything pending (one Build-it action over all the tiles) */
  function flushDesire(state, c, day) {
    const p = pr(state), tiles = c.desirePending || [];
    if (!tiles.length) return;
    const runs = Math.max(1, c.desireRuns | 0);
    c.desireDay = day; c.desirePending = null; c.desireRuns = 0;
    const cost = tiles.length * fin(catalog().path && catalog().path.cost, 2000);
    const what = runs > 1 ? 'Students want paths in ' + runs + ' places' : 'Students want a path here';
    const verb = runs > 1 ? 'Build them' : 'Build it';
    if (!p.hints.desireLine) { p.hints.desireLine = true; ui(state, 'hint', 'desireLine', what + '. ' + verb + ' for ' + money(cost) + '?', { action: 'buildPath', tiles: tiles }); }
    else notify(state, { kind: 'info', text: what + ' (' + money(cost) + ').', showMe: { tx: tiles[0] % W, ty: (tiles[0] / W) | 0, tiles: tiles }, action: { label: verb, fn: 'buildPath', tiles: tiles } });
    M.ticker(state, 51, null, null, tiles[0]);
  }
  function foundingArrived(state) {
    const c = ctx(state), p = pr(state);
    c.awaitFounding = false;
    call('render', 'followVehicle', null);
    if (M.earned(state, 'welcome')) return;
    const rest = FOUNDING - fin(c.foundingAdded, 0); c.foundingIds = null; c.foundingAdded = 0;
    if (rest > 0) call('economy', 'addStudents', state, rest, 'founding');
    M.achieve(state, 'welcome');
    M.ticker(state, 'First 120 students arrive at Bayou State. One asks where the parking is.', null, 'event', fin(state.plot && state.plot.landing, NONE));
    if (!p.hints.mute) { p.hints.mute = true; ui(state, 'hint', 'mute', '🔊 on · M to mute'); }
  }
  /** session (skipTutorial): stage 6, Objectives 1–5 done without grants, every tab introduced, hints set, first-warning drops off; queues NO cell (D57) */
  M.applySkipTutorial = function (state) {
    try {
      lazyKeys(state);
      const p = pr(state), c = ctx(state);
      p.tutorialStage = 6; c.stageEntered = 6;
      for (const id of TUTORIAL_IDS) { const o = ost(state, id); o.state = 'done'; o.since = today(state); o.goal = 1; o.progress = 1; o.text = (od(id) || {}).text || ''; }
      p.card = null; p.background = null; p.interruptQueue.length = 0; p.backgroundQueue.length = 0;
      p.hints.hudShown = true; p.hints.mute = true; p.hints.noFirstWarnings = true;
      if (!p.hints.freePlay) { p.hints.freePlay = true; introduceAllTabs(state); }
      c.dirty = true;
    } catch (e) { BSU.error('progress', 'applySkipTutorial', e); }
  };
  M.markHint = function (state, id) { try { lazyKeys(state); pr(state).hints[String(id)] = true; } catch (e) { BSU.error('progress', 'markHint', e); } };

  // ---------------------------------------------------------------------------
  // Student Voice (§7.1)
  // ---------------------------------------------------------------------------
  function fillVoiceDeck(state) {
    const p = pr(state);
    if (p.voiceCards.length) return;
    for (const v of (data().voiceCards || [])) p.voiceCards.push({ id: v.id, state: 'unseen', offeredDay: NONE });
  }
  /** draw the first unseen card whose prereq holds (no interrupt on the card, no voice card active) */
  M.offerVoice = function (state) {
    try {
      lazyKeys(state); fillVoiceDeck(state);
      const p = pr(state);
      if (interruptActive(state)) return;
      if (p.voiceCards.some(function (v) { return v.state === 'active'; })) return;
      for (const v of p.voiceCards) {
        if (v.state !== 'unseen') continue;
        const pre = VOICE_PREREQ[v.id];
        let ok = false; try { ok = !pre || !!pre(state); } catch (e) { BSU.error('progress', 'voice:' + v.id, e); }
        if (!ok) continue;
        const row = (data().voiceCards || []).find(function (x) { return x.id === v.id; }) || { student: '', text: '' };
        v.state = 'active'; v.offeredDay = today(state);
        emit(EV.VOICE_OFFERED, { id: v.id, student: row.student, text: row.text });
        ui(state, 'card', 'voice', { id: v.id, student: row.student, major: row.major, text: row.text, payoff: row.payoff });
        return;
      }
    } catch (e) { BSU.error('progress', 'offerVoice', e); }
  };
  M.answerVoice = function (state, id, accept) {
    try {
      const p = pr(state);
      const v = p.voiceCards.find(function (x) { return x.id === id; });
      if (!v || v.state !== 'active') return;
      if (accept) { ost(state, 'v:' + id); offerObjective(state, 'v:' + id); }
      else { v.state = 'declined'; emit(EV.VOICE_RESOLVED, { id: id, state: 'declined' }); }
    } catch (e) { BSU.error('progress', 'answerVoice', e); }
  };

  // ---------------------------------------------------------------------------
  // Board of Regents (§5.9; Tier 1 offers Insurance alone)
  // ---------------------------------------------------------------------------
  M.offerBoard = function (state) {
    try {
      lazyKeys(state);
      const p = pr(state);
      if (p.boardCards.some(function (b) { return b.chosen === null && b.pending; })) M.answerBoard(state, null);   // an unanswered offer lapses when the next one arrives
      const cards = [];
      if (!M.timer(state, 'insurance')) cards.push('insurance');
      if (!cards.length) return;
      if (p.tutorialStage < 6) { ctx(state).boardDeferred = true; return; }   // the Jan 10 lock lands mid-tutorial at 1×: the Board waits for free play (offered again at stage 6)
      p.boardCards.push({ offeredDay: today(state), cards: cards, chosen: null, pending: true });
      emit(EV.BOARD_OFFERED, { cards: cards });
      if (M.receiverActive(state)) { M.answerBoard(state, null); return; }   // receiver autopilot: every card answered by default
      ui(state, 'card', 'board', { cards: cards });
    } catch (e) { BSU.error('progress', 'offerBoard', e); }
  };
  M.answerBoard = function (state, cardId, option) {
    try {
      const p = pr(state);
      let entry = null;
      for (let i = p.boardCards.length - 1; i >= 0; i--) if (p.boardCards[i] && p.boardCards[i].pending) { entry = p.boardCards[i]; break; }
      if (!entry) return;
      entry.pending = false; entry.chosen = cardId || null;
      if (cardId && entry.cards.indexOf(cardId) >= 0) {
        const BC = PE.boardCards || {};
        switch (cardId) {
          case 'insurance': M.addTimer(state, 'insurance', fin(BC.insurance && BC.insurance.premium, 0.02), NONE); break;
          case 'lobby': M.addTimer(state, 'lobby', 0.10, NONE); break;
          case 'researchPush': M.addTimer(state, 'researchPush', fin(BC.researchPush && BC.researchPush.researchMult, 1.5), fin(BC.researchPush && BC.researchPush.days, 120)); break;
          case 'tuitionFreeze': { const d = fin(BC.tuitionFreeze && BC.tuitionFreeze.days, 120); M.addTimer(state, 'tuitionFreeze', fin(BC.tuitionFreeze && BC.tuitionFreeze.happiness, 5), d); M.addTimer(state, 'tuitionLock', 1, d); M.addTimer(state, 'tuitionFreezeApplicants', 0.10, d); break; }
          case 'recruitingTrip': M.addTimer(state, 'recruitingTrip', fin(BC.recruitingTrip && BC.recruitingTrip.rating, 3), daysUntil(state, 'Dec 9')); break;
          case 'summerSession': M.addTimer(state, 'summerSession', 1, 120); break;
          case 'homecomingBudget': { const tier = clamp(fin(option, 0) | 0, 0, 2); const hv = (PE.timers && PE.timers.homecomingBudget && PE.timers.homecomingBudget.value) || [0, 3, 6]; if (hv[tier]) M.addTimer(state, 'homecomingBudget', hv[tier], 10); break; }
          default: break;
        }
        call('economy', 'applyCard', state, cardId, option);
      }
      emit(EV.BOARD_RESOLVED, { chosen: entry.chosen });
    } catch (e) { BSU.error('progress', 'answerBoard', e); }
  };
  M.cancelInsurance = function (state) { try { M.removeTimer(state, 'insurance'); } catch (e) { BSU.error('progress', 'cancelInsurance', e); } };

  // ---------------------------------------------------------------------------
  // Failure states (§10.7): ui_panels opens the card on econ:card; progress records and answers
  // ---------------------------------------------------------------------------
  const FL = PE.failure || {};
  /** record the pending failure card kind (never opens a card); 'underwater' also emits econ:card (progress owns that counter) */
  M.failureCard = function (state, kind) {
    try {
      lazyKeys(state);
      const f = pr(state).failure;
      if (f.pendingKind === kind) return;
      f.pendingKind = kind;
      if (kind === 'underwater') emit(EV.ECON_CARD, { kind: 'underwater', options: ['ok'] });
    } catch (e) { BSU.error('progress', 'failureCard', e); }
  };
  /** the card's buttons; idempotent per pendingKind */
  M.answerFailure = function (state, kind, optionId) {
    try {
      lazyKeys(state);
      const f = pr(state).failure, day = today(state);
      if (f.pendingKind !== kind) return;
      f.pendingKind = null;
      if (kind === 'bankruptcy') {
        f.bankruptcy = fin(f.bankruptcy, 0) + 1;
        if (optionId === 'austerity') {
          M.addTimer(state, 'austerity', -fin(FL.austerityHappiness, 10), fin(FL.austerityDays, 120));
          M.addTimer(state, 'austerityUpkeep', fin(FL.austerityUpkeep, 0.3), fin(FL.austerityDays, 120));
          M.addTimer(state, 'noConstruction', 1, 30);
          call('economy', 'applyCard', state, 'austerity', optionId);
        } else if (optionId === 'hike') {
          call('economy', 'applyCard', state, 'hike', optionId);
          M.addTimer(state, 'tuitionHike', -fin(FL.hikeApplicants, 0.4), fin(FL.hikeDays, 120));
        } else if (optionId === 'naming') {
          const before = {}; for (const b of blist(state)) before[b.id] = b.name;
          call('economy', 'applyCard', state, 'naming', optionId);
          const hall = blist(state).find(function (b) { return before[b.id] !== undefined && before[b.id] !== b.name; });
          const oldName = hall ? before[hall.id] : 'A hall';
          M.ticker(state, 52, { hall: oldName, family: String(oldName).split(' ')[0] }, null, hall ? BSU.idx(hall.tx, hall.ty) : NONE);
        } else {
          f.receiverUntilDay = day + fin(FL.receiverDays, 60); f.receiver = false;
          notify(state, { kind: 'danger', text: 'The Board gives you ' + fin(FL.receiverDays, 60) + ' days to get above the line.' });
        }
      } else if (kind === 'underwater') {
        call('economy', 'applyCard', state, 'underwater', optionId);
        f.underwaterDays = 0;
        M.ticker(state, 'Semester cancelled. The marching band plays the Coastal Resilience Grant in.', null, 'danger');
      } else if (kind === 'probation') { /* set up on the econ:card event */ }
    } catch (e) { BSU.error('progress', 'answerFailure', e); }
  };
  M.receiverActive = function (state) { const f = state && state.progress && state.progress.failure; return !!(f && f.receiver && f.receiverUntilDay > today(state)); };
  /** economy reports the daily flooded share; 15 consecutive days > 50% → the Semester Cancelled card */
  M.reportUnderwater = function (state, share) {
    try {
      lazyKeys(state);
      const f = pr(state).failure;
      f.underwaterDays = fin(share, 0) > fin(FL.underwaterShare, 0.5) ? fin(f.underwaterDays, 0) + 1 : 0;
      if (f.underwaterDays >= fin(FL.underwaterDays, 15) && !f.pendingKind && !(state.economy && state.economy.cancelledSemester)) M.failureCard(state, 'underwater');
    } catch (e) { BSU.error('progress', 'reportUnderwater', e); }
  };
  function enterReceivership(state) {
    const f = pr(state).failure, day = today(state);
    f.receiver = true; f.receiverUntilDay = day + fin(FL.receiverYearDays, 120);
    call('session', 'setSpeed', state, fin(FL.receiverSpeed, 4), 'receiver');
    call('economy', 'setAutoRepair', state, true);
    ui(state, 'closeCard');
    notify(state, { kind: 'danger', text: 'Receivership. The Board runs the university for a year.' });
    M.ticker(state, 'The Board of Regents appoints a receiver. The receiver asks where the parking is.', null, 'money');
  }
  function exitReceivership(state) {
    const f = pr(state).failure;
    f.receiver = false; f.receiverUntilDay = NONE;
    call('economy', 'applyCard', state, 'receiver', null);
    call('economy', 'setAutoRepair', state, false);
    call('session', 'restoreSpeed', state, 'receiver');
    M.ticker(state, 'The receiver departs. Cash: zero. Prestige: less. The swamp: unchanged.', null, 'money');
  }
  function failureDaily(state, c) {
    const f = pr(state).failure, day = today(state);
    if (f.receiverUntilDay >= 0 && day >= f.receiverUntilDay) {
      if (f.receiver) exitReceivership(state);
      else if (fin(state.economy && state.economy.cash, 0) < 0) enterReceivership(state);
      else { f.receiverUntilDay = NONE; }
    }
    if (f.probation && prestige(state) > fin(FL.probationExit, 15)) {
      f.probation = false; M.removeTimer(state, 'probation');
      M.ticker(state, 'Accreditation restored. The catfish in the library has been asked to leave.', null, 'event');
      for (const id of ['p1', 'p2', 'p3']) { const o = pr(state).objectives[id]; if (o && (o.state === 'active' || o.state === 'queued')) M.dismiss(state, id); }
    }
    if (M.receiverActive(state) && state.setPiece && state.setPiece.skippable && state.setPiece.tick >= fin(PT.skipAfterTick, 150)) call('session', 'skipSetPiece', state);
  }
  function onProbation(state) {
    const f = pr(state).failure;
    if (f.probation) return;
    f.probation = true;
    M.addTimer(state, 'probation', -0.5, NONE);
    ost(state, 'p1'); ost(state, 'p2'); ost(state, 'p3');
    offerObjective(state, 'p1');
  }

  // ---------------------------------------------------------------------------
  // Set pieces progress owns (D13): Mardi Gras parade, Graduation, bonfires
  // ---------------------------------------------------------------------------
  function buildParade(state) {
    const route = call('terrain', 'paradeRoute', state);
    let tiles = Array.isArray(route) ? route.slice() : [];
    const surf = state.tiles.surface;
    const roadRun = tiles.length >= fin(PP.parade && PP.parade.minRoadRun, 4) && tiles.every(function (i) { return surf[i] === SURF.ROAD; });
    let floats = 0, krewe = 0, band = 0;
    if (roadRun) { floats = bhas(state, 'union') ? fin(PP.parade && PP.parade.floatsUnion, 3) : fin(PP.parade && PP.parade.floats, 1); band = 1; }
    else if (tiles.length >= 2) krewe = fin(PP.parade && PP.parade.krewe, 12);
    else {
      const f = blist(state, 'founders_hall')[0] || (state.plot && state.plot.founders ? { tx: state.plot.founders.tx, ty: state.plot.founders.ty, w: 3, h: 3 } : null);
      tiles = f ? BSU.edgeTiles(f.tx, f.ty, f.w || 3, f.h || 3) : [];
      krewe = fin(PP.parade && PP.parade.krewe, 12);
    }
    return { route: tiles, floats: floats, band: band, krewe: krewe, catches: 0 };
  }
  function startParade(state, c) {
    if (state.setPiece) return false;
    const ok = call('session', 'startSetPiece', state, 'parade', { len: fin(PT.paradeTicks, 250), skippable: !!pr(state).setPiecesSeen.parade });
    if (!ok) return false;
    c.parade = buildParade(state);
    c.paradeWanted = NONE; c.paradeStart = false;
    pr(state).paradeYear = yearOf(today(state));
    return true;
  }
  /** render reads during the parade: positions along the route (1 tile per 10 ticks) */
  M.parade = function (state) {
    try {
      const sp = state && state.setPiece;
      if (!sp || sp.kind !== 'parade') return null;
      const c = ctx(state);
      if (!c.parade) c.parade = buildParade(state);
      const pd = c.parade, L = pd.route.length;
      if (!L) return { floats: [], band: [], krewe: [], catches: pd.catches };
      const at = function (k) { const i = pd.route[((Math.floor(sp.tick / 10) + k) % L + L) % L]; return { tx: i % W, ty: (i / W) | 0 }; };
      const floats = [], band = [], krewe = [];
      for (let k = 0; k < pd.floats; k++) floats.push(at(-k * 3));
      for (let k = 0; k < pd.band * 4; k++) band.push(at(-pd.floats * 3 - 1 - k));
      for (let k = 0; k < pd.krewe; k++) krewe.push(at(-k));
      return { floats: floats, band: band, krewe: krewe, catches: pd.catches };
    } catch (e) { BSU.error('progress', 'parade', e); return null; }
  };
  /** ui forwards clicks during the parade: a bead volley from the float under the cursor */
  M.paradeClick = function (state, px, py) {
    try {
      const pd = M.parade(state); if (!pd || !has('render', 'entityScreen')) return false;
      for (const f of pd.floats) {
        const sc = call('render', 'entityScreen', { tx: f.tx + 0.5, ty: f.ty + 0.5, px: f.tx + 0.5, py: f.ty + 0.5 });
        if (!sc || Math.hypot(fin(sc.x, 1e9) - px, fin(sc.y, 1e9) - py) > 24) continue;
        const c = ctx(state); c.parade.catches++;
        const agents = (state.agents || []).filter(function (a) { return a && a.state !== 'GONE'; }).map(function (a) { return { a: a, d: cheb(a.tx, a.ty, f.tx, f.ty) }; }).sort(function (x, y) { return x.d - y.d; }).slice(0, fin(PP.parade && PP.parade.beadTargets, 3));
        const R = mod('render');
        if (R && R.particles && typeof R.particles.emit === 'function') { for (let k = 0; k < fin(PP.parade && PP.parade.beadsPerVolley, 8); k++) { const tgt = agents.length ? agents[k % agents.length].a : f; try { R.particles.emit('bead', (f.tx - f.ty) * 32, (f.tx + f.ty) * 16, 1, { toX: (tgt.tx - tgt.ty) * 32, toY: (tgt.tx + tgt.ty) * 16 }); } catch (e) { /* presentation */ } } }
        audio('beads');
        return true;
      }
      return false;
    } catch (e) { BSU.error('progress', 'paradeClick', e); return false; }
  };
  function endParade(state, c) {
    const p = pr(state);
    const catches = c.parade ? c.parade.catches : 0;
    const per = fin(PP.parade && PP.parade.catchesPerPoint, 10), cap = fin(PP.parade && PP.parade.beadsCap, 3);
    const beads = Math.min(cap, Math.floor(catches / per));
    if (beads > 0) M.addTimer(state, 'beads', beads, fin(PE.timers && PE.timers.beads && PE.timers.beads.days, 10));
    p.setPiecesSeen.parade = true;
    if (ost(state, '7').state === 'active') M.complete(state, '7');
    if (bhas(state, 'union') && happiness(state) >= fin(MG.throwMeSomethin, 75)) M.achieve(state, 'throwMeSomethin');
    c.parade = null;
  }
  function startGraduation(state, c) {
    if (state.setPiece) return false;
    const ok = call('session', 'startSetPiece', state, 'graduation', { len: fin(PT.graduationTicks, 150), skippable: !!pr(state).setPiecesSeen.graduation });
    if (!ok) return false;
    c.gradWanted = NONE;
    return true;
  }
  /** session dispatch for parade/graduation: nothing left to resolve mid-script; jump to the last tick */
  M.skipSetPiece = function (state) { try { const sp = state && state.setPiece; if (sp && (sp.kind === 'parade' || sp.kind === 'graduation')) sp.tick = sp.len - 1; } catch (e) { BSU.error('progress', 'skipSetPiece', e); } };
  M.setPieceSeen = function (state, kind) { const s = state && state.progress && state.progress.setPiecesSeen; return !!(s && s[kind]); };
  /** tiles with a bonfire tonight (Oct 7 quad; Dec 9 every 5th levee tile) */
  M.bonfires = function (state) {
    try {
      if (!state || !state.sky || state.sky.phase !== SKY.NIGHT) return [];
      const pt = parts(today(state)), date = pt.date;
      if (date === 'Oct 7') return blist(state, 'quad').filter(complete).map(function (q) { return BSU.idx(q.tx, q.ty); });
      if (date === 'Dec 9') { const runs = call('buildings', 'leveeRuns', state) || []; const out = []; for (const r of runs) for (let k = 0; k < (r.tiles || []).length; k += 5) out.push(r.tiles[k]); return out; }
      return [];
    } catch (e) { BSU.error('progress', 'bonfires', e); return []; }
  };

  // ---------------------------------------------------------------------------
  // Recovery duties (§6.2), storms, first warnings, first gator, scripted night game
  // ---------------------------------------------------------------------------
  function warningsOn(state) { return !pr(state).hints.noFirstWarnings && yearOf(today(state)) === 1 && !BSU.headlessMode; }
  function firstWarningDrop(state, c, text, kind, tile) {
    const speed = fin(state.ui && state.ui.speed, 1);
    if (speed > 1) { call('session', 'setSpeed', state, 1, 'warning'); c.warning = { until: fin(state.tick, 0) + fin(PT.firstWarningDropTicks, 100), restored: false }; }
    notify(state, { kind: kind, text: text, showMe: tile >= 0 ? { tx: tile % W, ty: (tile / W) | 0, tiles: [tile] } : null, onClose: 'restoreWarning' });
  }
  function restoreWarning(state, c) { if (c.warning && !c.warning.restored) { c.warning.restored = true; call('session', 'restoreSpeed', state, 'warning'); } c.warning = null; }
  function debrisAfterStorm(state, report) {
    if (!has('terrain', 'setFlag')) return;
    const r = BSU.rng.sim;
    const mask = call('wildlife', 'campusMask', state);
    const rect = state.plot && state.plot.rect;
    for (let i = 0; i < N; i++) {
      const onCampus = mask && mask.length === N ? !!mask[i] : (rect ? (i % W >= rect.x0 && i % W <= rect.x1 && ((i / W) | 0) >= rect.y0 && ((i / W) | 0) <= rect.y1) : false);
      if (onCampus && state.tiles.type[i] >= T.MARSH && r.float() < 0.05) call('terrain', 'setFlag', state, i, FLAG.DEBRIS, true);
    }
    const flooded = call('hydro', 'floodedTiles', state);
    if (Array.isArray(flooded)) for (const i of flooded) if (state.tiles.type[i] >= T.MARSH) call('terrain', 'setFlag', state, i, FLAG.DEBRIS, true);
  }
  function onStormPassed(state, c, payload) {
    const p = pr(state), day = today(state);
    if (payload && payload.nearMiss) {
      if (M.offered(state, '11a') && !closed(state, '11a')) M.complete(state, '11a');
      return;
    }
    if (M.offered(state, '13') && !closed(state, '13')) M.complete(state, '13');
    const sh = call('buildings', 'shelter', state) || { ok: false };
    if (!(c.shelterOk || sh.ok || (payload && payload.evacuated))) M.addTimer(state, 'unsheltered', fin(PE.timers && PE.timers.unsheltered && PE.timers.unsheltered.value, -8), fin(PE.timers && PE.timers.unsheltered && PE.timers.unsheltered.days, 10));
    if (call('buildings', 'boilWaterTriggered', state)) { M.addTimer(state, 'boilWater', fin(PE.timers && PE.timers.boilWater && PE.timers.boilWater.value, -4), fin(PE.timers && PE.timers.boilWater && PE.timers.boilWater.days, 3)); M.ticker(state, 58); call('buildings', 'clearBoilWater', state); }
    const cat = fin(payload && payload.cat, c.lastStormCat);
    if (cat >= fin(PS.cajunNavyMinCat, 3) && bhas(state, 'wildlife_post')) {
      const dorms = blist(state, 'dorm').filter(function (b) { return b.flooded; }).map(function (b) { return b.id; });
      call('agents', 'launchCajunNavy', state, dorms);
      M.addTimer(state, 'cajunNavy', 1, 3);
      const un = M.timer(state, 'unsheltered'); if (un) un.untilDay = day + 4;
      M.ticker(state, 59);
    }
    if (p.firsts.floodDay < 0 && blist(state).some(function (b) { return b.flooded; })) p.firsts.floodDay = day;
    c.trig['14'] = true;
  }
  function onStormReport(state, c, payload) {
    const report = payload && payload.report;
    c.lastReport = report || null;
    pr(state).setPiecesSeen.landfall = true;
    const st = state.storms && state.storms.current;
    if (st) { c.lastStormCat = fin(st.cat, 0); c.lastStormName = st.name || ''; }
    debrisAfterStorm(state, report);
    if (st && fin(st.cat, 0) >= fin(MG.eyeOfTheStormCat, 4) && report && Array.isArray(report.flooded) && report.flooded.length === 0) M.achieve(state, 'eyeOfTheStorm');
    if (ost(state, '12').state === 'active') M.dismiss(state, '12');
  }
  function scheduleAmelie(state) {
    const day = today(state);
    if (yearOf(day) !== 1) return false;
    const st = state.storms || {};
    const seen = function (x) { return x && x.name === 'Amélie'; };
    if ((st.log || []).some(seen) || (st.scheduled || []).some(seen) || seen(st.current)) return false;
    call('weather', 'scheduleNearMiss', state, day, 'Amélie');
    ctx(state).trig['11a'] = true;
    return true;
  }
  function amelieDaily(state) {
    const day = today(state), pt = parts(day);
    if (pt.year !== 1) return;
    const start = dateDay(PS.amelie && PS.amelie.date || 'Jul 2', 1);
    let latest = dateDay(PS.amelie && PS.amelie.latest || 'Jul 20', 1);
    if (latest < 0) latest = dateDay('Jul 10', 1);   // 'Jul 20' does not exist in 10-day months: the end of July is the latest
    if (day < start || day > latest) return;
    if (day === latest || closed(state, '11')) scheduleAmelie(state);
  }
  function nightGameScript(state) {
    if (fin(state.sports && state.sports.scriptedNightDay, NONE) >= 0 || M.earned(state, 'nightFalls')) return;
    const day = today(state);
    const sched = (state.sports && state.sports.schedule) || [];
    let pick = null;
    for (const e of sched) { if (!e || !e.home || e.played || e.cancelled || e.day < day) continue; const m = parts(e.day).month; if (m === 9 || m === 10) { if (!pick || e.day < pick.day) pick = e; } }
    if (pick) call('sports', 'startNightGameScript', state, pick.day);
  }

  // ---------------------------------------------------------------------------
  // Founders' Day recap (§10.8)
  // ---------------------------------------------------------------------------
  function buildRecap(state) {
    const day = today(state), year = yearOf(day) - 1;
    const lines = [];
    const log = ((state.storms && state.storms.log) || []).filter(function (l) { return l && l.year === year; });
    const flooded = blist(state).filter(function (b) { return b.flooded || (b.floodedSince >= 0 && yearOf(b.floodedSince) === year); }).map(function (b) { return b.name; });
    lines.push(flooded.length ? 'Flooded: ' + flooded.slice(0, 4).join(', ') + (flooded.length > 4 ? ' and ' + (flooded.length - 4) + ' more' : '') : 'Nothing flooded. The water is still here.');
    const ls = (state.sports && state.sports.lastSeason) || { wins: 0, losses: 0 };
    const coach = state.sports && state.sports.coach && state.sports.coach.name;
    lines.push(state.sports && state.sports.hasTeam ? ('Football: ' + fin(ls.wins, 0) + '–' + fin(ls.losses, 0) + (coach ? ' under Coach ' + coach : '')) : 'No football yet. The Marsh Mob waits.');
    const sinking = blist(state).filter(function (b) { return fin(b.sunk, 0) >= 0.5; }).map(function (b) { return b.name; });
    lines.push(sinking.length ? 'Sinking: ' + sinking.slice(0, 3).join(', ') : 'Nothing is sinking. Yet.');
    lines.push(log.length ? 'Storms: ' + log.map(function (l) { return l.name + (l.nearMiss ? ' (missed)' : ' (Cat ' + l.cat + ')'); }).join(', ') : 'No storms. The Gulf was elsewhere.');
    let tarps = 0; for (const l of log) tarps += fin(l.tarps, 0);
    lines.push('Blue tarps: ' + tarps);
    lines.push('Ecology: ' + Math.round(ecology(state)));
    const candidates = state.ticker.filter(function (t) { return t && (t.kind === 'danger' || t.kind === 'sports') && yearOf(t.day) === year; });
    let best = '';
    if (candidates.length) { let b = candidates[0]; for (const t of candidates) if (t.text.length > b.text.length) b = t; best = b.text; }
    else if (state.ticker.length) best = state.ticker[BSU.rng.sim.int(state.ticker.length)].text;
    const hist = (state.ledger && Array.isArray(state.ledger.history)) ? state.ledger.history.filter(function (h) { return h && h.year === year; }) : [];
    const sparks = { students: hist.map(function (h) { return fin(h.students, 0); }), cash: hist.map(function (h) { return fin(h.cash, 0); }), prestige: hist.map(function (h) { return fin(h.prestige, 0); }) };
    return { year: year, lines: lines, best: best, sparks: sparks };
  }
  M.recap = function (state) { return (state && state.progress && state.progress.recap) || null; };

  // ---------------------------------------------------------------------------
  // Date handler (also the selfTest entry point): calendar:date → scripted beats
  // ---------------------------------------------------------------------------
  M._onDate = function (state, date, day) {
    const c = ctx(state), p = pr(state), year = yearOf(fin(day, today(state)));
    switch (date) {
      case 'Jan 1':
        if (year >= fin(PP.recapFromYear, 2)) { p.recap = buildRecap(state); M.ticker(state, 56); M.ticker(state, 48); ui(state, 'card', 'recap', p.recap); }
        c.relocCount = {};
        break;
      case 'Feb 8': break;   // the parade starts at the first Dusk on/after Feb 8 (sky:phase handler; p.paradeYear guards once per year)
      case 'Feb 9': break;   // the first gator is handled at Dusk (sky:phase) from state, not from a closure flag
      case 'Mar 1': if (anyPreserve(state)) M.ticker(state, 13); break;
      case 'Apr 4': if (year === 1) call('hydro', 'forceSat', state, (state.plot && state.plot.cove) || [], 0.7); break;
      case 'Apr 5': {
        if (year === 1) { const cc = coveCenter(state); call('weather', 'queueCell', state, { day: day, cx: cc.tx - 3, cy: cc.ty + 3, inches: fin(PP.tutorial && PP.tutorial.cellInches, 3), scripted: true }); if (p.firsts.cellDay < 0) p.firsts.cellDay = day; }
        const bb = MG.bigBoil || {};
        const att = Math.round((students(state) * fin(bb.studentShare, 0.6) + fin(state.economy && state.economy.alumni, 0) * fin(bb.alumniShare, 0.1)) * (bhas(state, 'union') ? fin(bb.unionMult, 1.5) : 1));
        M.ticker(state, 11, { n: num(att) });
        if (att >= fin(bb.attendance, 3000)) M.achieve(state, 'bigBoil');
        break;
      }
      case 'May 5': c.gradWanted = day; c.gradStartTick = fin(state.tick, 0) + 1; break;
      case 'Jun 1': if (!closed(state, '11') && p.tutorialStage >= 6) c.trig['11'] = true; break;
      case 'Jul 1': if (ecology(state) >= 60) M.ticker(state, 14); break;
      case 'Aug 6': M.ticker(state, year % 2 ? 31 : 33); break;
      case 'Oct 7': if (bhas(state, 'quad')) M.ticker(state, 30); else if (year === 1) notify(state, { kind: 'info', text: 'No quad, no bonfire.' }); break;
      case 'Nov 1': M.ticker(state, 9); break;
      case 'Nov 7': M.ticker(state, 29); break;
      case 'Nov 8': M.ticker(state, 49); break;
      case 'Dec 8': if (ost(state, '18b').state === 'active' && fin(state.sports && state.sports.record && state.sports.record.wins, 0) >= fin(G.wins18b, 5)) M.complete(state, '18b'); break;
      case 'Dec 9': { const pumps = blist(state, 'pump').filter(complete); if (pumps.length) M.ticker(state, 53, { n: pumps[0].id + 1 }); break; }
      case 'Dec 10': M.ticker(state, 25); break;
      default: break;
    }
  };

  // ---------------------------------------------------------------------------
  // Event drain (every listener only queued; this runs inside tick)
  // ---------------------------------------------------------------------------
  function handleEvent(state, c, name, e) {
    const p = pr(state), day = today(state);
    switch (name) {
      case EV.BUILDING_PLACED:
        if (e && e.type === 'founders_hall' && p.tutorialStage === 2) M.complete(state, '1');
        c.unlockDirty = true; break;
      case EV.BUILDING_COMPLETE:
        c.unlockDirty = true;
        if (e && e.type === 'coastal_institute') M.ticker(state, 27);
        break;
      case EV.BUILDING_UPGRADED:
        if (e && e.type === 'stadium' && fin(e.tier, 0) >= 2) nightGameScript(state);
        c.unlockDirty = true; break;
      case EV.BUILDING_FLOODED:
        if (!M.earned(state, 'wetFeet')) M.achieve(state, 'wetFeet', { building: e ? e.id : NONE });
        if (p.firsts.floodDay < 0) p.firsts.floodDay = day;
        break;
      case EV.BUILDING_REMOVED: case EV.BUILDING_DRIED: case EV.BUILDING_DAMAGED: break;
      case EV.RING_CHANGED: c.ringDirty = true; break;
      case EV.ENROLL_GRADUATION: c.lastGraduates = fin(e && e.count, 0); break;
      case EV.ENROLL_ROUND: case EV.ENROLL_LOCK: break;
      case EV.AGENT_ARRIVE: if (e && e.kind === 'founding') foundingArrived(state); break;
      case EV.AGENT_DESIRE_LINE: {
        // throttled: one line per DESIRE_DAYS calendar days; runs that fire inside the window merge into the next line
        const tiles = (e && Array.isArray(e.tiles)) ? e.tiles : [];
        if (!tiles.length) break;
        if (!c.desirePending) c.desirePending = [];
        for (let k = 0; k < tiles.length; k++) if (c.desirePending.indexOf(tiles[k]) < 0) c.desirePending.push(tiles[k]);
        c.desireRuns = (c.desireRuns | 0) + 1;
        if (c.desireDay === NONE || day - c.desireDay >= DESIRE_DAYS) flushDesire(state, c, day);
        break;
      }
      case EV.GATOR_CAMPUS: {
        if (!e || !e.enter) break;
        const i = fin(e.i, NONE);
        if (p.firsts.gatorDay < 0) {
          p.firsts.gatorDay = day; c.firstGatorTile = i;
          if (warningsOn(state)) firstWarningDrop(state, c, (e.name || 'A gator') + ' is on campus.', 'wildlife', i);
        }
        c.trig['9'] = true; c.trig['16'] = true;
        if (i >= 0 && (state.tiles.flags[i] & FLAG.CANAL) && state.tiles.surface[i] >= SURF.PATH && c.lastGatorEnterDay !== day) { c.lastGatorEnterDay = day; M.ticker(state, 1, null, null, i); }
        break;
      }
      case EV.GATOR_INCIDENT:
        if (e && e.kind === 'pool') M.ticker(state, 28, null, null, fin(e.i, NONE));
        if (e && e.kind === 'field' && state.sports && state.sports.game) M.achieve(state, 'sunbather');
        break;
      case EV.GATOR_RELOCATED: {
        const m = parts(day).month;
        if (c.relocMonth !== m) { c.relocMonth = m; c.relocCount = {}; }
        const key = String(e && e.id);
        c.relocCount[key] = (c.relocCount[key] || 0) + 1;
        if (c.relocCount[key] === 4) M.ticker(state, 21, { gator: (e && e.name) || 'the gator' });
        break;
      }
      case EV.MOSQUITO_WARNING:
        if (p.firsts.mosquitoDay < 0) { p.firsts.mosquitoDay = day; if (warningsOn(state)) firstWarningDrop(state, c, 'Mosquito warning: standing water on campus.', 'wildlife', fin(e && e.worstTile, NONE)); }
        if (e && Number.isFinite(e.worstTile)) c.worstMosqTile = e.worstTile;
        if (e && fin(e.index, 0) > fin(P.wildlife && P.wildlife.mosq && P.wildlife.mosq.biblical, 0.5)) M.ticker(state, 3);
        c.trig['10'] = true;
        break;
      case EV.ECOLOGY_CHANGED: c.unlockDirty = true; break;
      case EV.WEATHER_HEAT: if (c.heatDay !== day && e && (e.advisory || fin(e.index, 0) >= 92)) { c.heatDay = day; M.ticker(state, 10, { hi: Math.round(fin(e.index, fin(state.weather && state.weather.heat, 0))) }); } break;
      case EV.STORM_NAMED:
        if (e && e.nearMiss) break;
        c.trig['12'] = true;
        if (warningsOn(state) || (yearOf(day) === 1 && !p.hints.noFirstWarnings)) { call('session', 'setSpeed', state, 1, 'cone'); if (!p.hints.pauseToPlan) { p.hints.pauseToPlan = true; ui(state, 'hint', 'pauseToPlan', 'Pause to plan'); } }
        break;
      case EV.STORM_WATCH: break;
      case EV.STORM_BANDS: if (!(e && e.nearMiss)) M.ticker(state, 46); break;
      case EV.STORM_LANDFALL: {
        if (e && e.nearMiss) break;
        const sh = call('buildings', 'shelter', state) || { ok: false };
        const st = state.storms && state.storms.current;
        c.shelterOk = !!(sh.ok || (st && (st.evacuated || st.shelterOverflow)));
        if (st) { c.lastStormCat = fin(st.cat, 0); c.lastStormName = st.name || ''; }
        const o12 = ost(state, '12');
        if (o12.state === 'active') { const r = stormChecklist(state); if (r.progress >= r.goal) M.complete(state, '12'); else M.dismiss(state, '12'); }
        else if (o12.state === 'queued') M.dismiss(state, '12');
        c.trig['13'] = true;
        for (const b of blist(state, 'pump')) if (complete(b) && call('hydro', 'pumpRunning', state, b.id)) { M.ticker(state, 17, { n: b.id + 1 }, null, BSU.idx(b.tx, b.ty)); break; }
        break;
      }
      case EV.STORM_REPORT: onStormReport(state, c, e); break;
      case EV.STORM_PASSED: onStormPassed(state, c, e); break;
      case EV.LEVEE_BURROW: c.burrowAlt = !c.burrowAlt; if (c.burrowAlt) M.ticker(state, 6, null, null, fin(e && e.i, NONE)); else M.ticker(state, 57, { x: fin(e && e.tx, fin(e && e.i, 0) % W), y: fin(e && e.ty, (fin(e && e.i, 0) / W) | 0) }, null, fin(e && e.i, NONE)); break;
      case EV.LEVEE_OVERTOP: if (state.hydro && state.hydro.surge && c.overtopDay !== day) { c.overtopDay = day; M.ticker(state, 22, null, null, fin(e && e.i, NONE)); } break;
      case EV.LEVEE_BREACH: break;
      case EV.GAME_KICKOFF:
        if (!e) break;
        if (e.home) { if (e.venue === 'stadium2' || e.venue === 'stadium3') M.ticker(state, 7); else M.ticker(state, 19); }
        if (e.night && (e.venue === 'stadium2' || e.venue === 'stadium3') && !M.earned(state, 'nightFalls')) { M.achieve(state, 'nightFalls'); p.forceFirefliesDay = day; }
        break;
      case EV.GAME_FINAL:
        if (!e) break;
        if (e.home && !M.earned(state, 'bayouField')) M.achieve(state, 'bayouField');
        if (e.won && String(e.opp).toLowerCase().indexOf('magnolia') === 0) M.achieve(state, 'geauxBeatMagnolia');
        break;
      case EV.SEASON_END:
        if (e && e.undefeated) M.achieve(state, 'undefeated');
        if (e && fin(e.wins, 0) >= fin(G.wins18b, 5) && ost(state, '18b').state === 'active') M.complete(state, '18b');
        break;
      case EV.ECON_CARD:
        if (!e) break;
        if (e.kind === 'probation') { M.failureCard(state, 'probation'); onProbation(state); }
        else if (e.kind === 'bankruptcy') M.failureCard(state, 'bankruptcy');
        break;
      case EV.ECON_INCOME: if (e && e.key === 'disaster') M.ticker(state, 55); break;
      case EV.ECON_MONTH: { const st = call('buildings', 'stats', state) || {}; const lots = fin(st.lots, fin(st.parkingLots, 0)); if (lots > 0) M.ticker(state, 5, { n: lots * 40, cars: lots * 30 }); break; }
      case EV.ECON_STAT: if (e && (e.stat === 'students' || e.stat === 'prestige' || e.stat === 'ecology')) c.unlockDirty = true; break;
      case EV.FESTIVAL_START: case EV.FESTIVAL_END: break;
      case EV.CALENDAR_DATE: if (e && typeof e.date === 'string') M._onDate(state, e.date, fin(e.day, day)); break;
      case EV.CALENDAR_DAY: case EV.CALENDAR_MONTH: case EV.CALENDAR_YEAR: break;
      case EV.DECISION_OPEN: if (M.receiverActive(state) && e && e.id) call('ui', 'answerDecision', e.id, 'default'); break;
      case EV.DECISION_CLOSED: break;
      case EV.SETPIECE_END:
        if (e && e.kind === 'parade') endParade(state, c);
        else if (e && e.kind === 'graduation') { p.setPiecesSeen.graduation = true; M.ticker(state, 41, { n: num(c.lastGraduates) }); }
        else if (e && e.kind === 'landfall') { /* storm:report / storm:passed carry the bookkeeping */ }
        else if (e && (e.kind === 'game' || e.kind === 'montage')) p.setPiecesSeen.game = true;   // PLAN_FOOTBALL §1.1 finding 2: unlocks Skip ▸ and the auto-sim montage for later home games
        break;
      case EV.POWER_BLACKOUT: {
        const ids = (e && Array.isArray(e.affected)) ? e.affected : [];
        for (const id of ids) { const b = state.buildings[id]; if (b && b.type === 'pump') { M.ticker(state, 18, { n: id + 1 }, null, BSU.idx(b.tx, b.ty)); break; } }
        break;
      }
      case EV.MARSH_DRAINED: p.drainedEver = true; break;
      case EV.SKY_PHASE: {
        const ph = e ? e.phase : NONE;
        if (ph === SKY.DUSK) {
          // Mardi Gras parade (§14.3): the first Dusk on or after Feb 8 (the sky cycle is 3 calendar days, so Feb 8 itself may have none), once per year
          { const yr = yearOf(day), feb8 = dateDay('Feb 8', yr); if (p.tutorialStage >= 6 && feb8 >= 0 && day >= feb8 && day <= feb8 + 4 && p.paradeYear !== yr) { c.paradeWanted = day; c.paradeStart = true; } }
          // first gator (§9.2): the first Dusk on or after Feb 9 Y1, any year until Objective 9 has been offered; once per day
          if (!M.offered(state, '9') && p.tutorialStage >= 6 && day >= dateDay('Feb 9', 1) && c.firstGatorDay !== day) { c.firstGatorDay = day; call('wildlife', 'forceFirstGator', state); }
          if (day % 5 === 0 && bhas(state, 'union') && c.zydecoDay !== day) { c.zydecoDay = day; M.ticker(state, 8); }
        }
        if (ph === SKY.NIGHT && !p.hints.ticker24 && fin(state.wildlife && state.wildlife.fireflies, 0) >= 50) { p.hints.ticker24 = true; M.ticker(state, 24); }
        break;
      }
      case EV.SAVE_LOADED: break;
      default: break;
    }
  }
  const LISTEN = ['building:placed', 'building:complete', 'building:upgraded', 'building:removed', 'building:flooded', 'building:dried', 'building:damaged',
    'ring:changed', 'enroll:round', 'enroll:lock', 'enroll:graduation', 'agent:arrive', 'agent:desireLine', 'gator:campus', 'gator:incident', 'gator:relocated',
    'mosquito:warning', 'ecology:changed', 'weather:cell', 'weather:heat', 'storm:named', 'storm:watch', 'storm:bands', 'storm:landfall', 'storm:report', 'storm:passed',
    'levee:burrow', 'levee:overtop', 'levee:breach', 'game:kickoff', 'game:final', 'season:end', 'econ:card', 'econ:income', 'econ:month', 'econ:stat',
    'festival:start', 'festival:end', 'calendar:date', 'calendar:day', 'calendar:month', 'calendar:year', 'decision:open', 'decision:closed', 'setpiece:end',
    'power:blackout', 'save:loaded', 'marsh:drained', 'sky:phase'];
  function drain(state, c) {
    if (!c.pendingEvents.length) return;
    const list = c.pendingEvents; c.pendingEvents = [];
    c.dirty = true;
    for (const ev of list) { try { handleEvent(state, c, ev.name, ev.payload); } catch (e) { BSU.error('progress', 'event:' + ev.name, e); } }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  M.init = function (state) {
    try {
      const push = function (name) { return function (payload) { const s = BSU.state; if (!s || !s.progress) return; ctx(s).pendingEvents.push({ name: name, payload: payload }); }; };
      for (const name of LISTEN) BSU.events.on(name, push(name), 'progress');
      BSU.events.on('tile:changed', function () { const s = BSU.state; if (s && s.progress) { const c = ctx(s); c.tileDirty = true; c.dirty = true; } }, 'progress');
      if (state) ctx(state);
    } catch (e) { BSU.error('progress', 'init', e); }
  };
  /** newGame (fresh) / load (!fresh): rebuild the closure; lazily initialize the saved keys; fresh fills the voice deck */
  M.reset = function (state, fresh) {
    try {
      C = freshCtx(state);
      lazyKeys(state);
      if (fresh === true) fillVoiceDeck(state);
      const p = pr(state);
      if (p.tutorialStage >= 6) C.stageEntered = 6;
      refreshUnlocks(state, C, false);
    } catch (e) { BSU.error('progress', 'reset', e); }
  };
  M.tick = function (state, flags) {
    if (!state || !state.progress || !state.calendar) return;
    const c = ctx(state), p = pr(state);
    flags = flags || { newDay: false, newMonth: false, newYear: false, day: today(state) };
    const day = today(state);
    c.offeredThisTick = false;
    drain(state, c);
    tutorialTick(state, c);
    if (p.tutorialStage >= 4 && p.tutorialStage < 6 && !M.earned(state, 'welcome') && !c.awaitFounding) { c.awaitFounding = true; c.foundingDeadline = fin(state.tick, 0) + 600; }   // loaded mid-arrival: the pirogues are gone (agents are not saved)
    if (c.awaitFounding && (!has('agents', 'spawnArrival') || fin(state.tick, 0) >= fin(c.foundingDeadline, 1e12))) foundingArrived(state);
    else if (c.awaitFounding && c.foundingIds && c.foundingIds.length) foundingCountUp(state, c);
    // Daily work
    if (flags.newDay) {
      c.dirty = true;
      expireTimers(state);
      if (c.desirePending && c.desirePending.length && day - c.desireDay >= DESIRE_DAYS) flushDesire(state, c, day);
      const pt = parts(day);
      if (pt.date === 'Aug 1') p.skeeterStreak = 0;
      if (pt.month === fin(MG.skeeterMonth, 8)) { const idx = fin(call('wildlife', 'mosqIndex', state), fin(state.wildlife && state.wildlife.mosqIndex, 0)); if (idx < fin(MG.skeeterBeater, 0.1)) p.skeeterStreak = fin(p.skeeterStreak, 0) + 1; else p.skeeterStreak = -100; if (pt.dom === 10 && p.skeeterStreak >= 10) M.achieve(state, 'skeeterBeater'); }
      if (pt.dom === fin(PP.voiceCardDom, 3) && done(state, PP.voiceAfterObjective || '7')) { const o7 = ost(state, PP.voiceAfterObjective || '7'); if (o7.since < 0 || parts(o7.since).month !== pt.month || parts(o7.since).year !== pt.year) M.offerVoice(state); }
      amelieDaily(state);
      pollMilestones(state);
      checkDeadlines(state, c);
      failureDaily(state, c);
      if (fin(state.sports && state.sports.scriptedNightDay, NONE) === day) M.ticker(state, 34);
      if (fin(state.economy && state.economy.blackoutDays, 0) === 3) M.ticker(state, 54);
      { const stocked = blist(state, 'pond').filter(function (b) { return b.data && fin(b.data.stockedDay, NONE) >= 0 && b.data.stockedDay <= day; }).length; if (stocked > c.stockedSeen && c.stockedSeen >= 0 && day > 0) M.ticker(state, 35); c.stockedSeen = stocked; }
      { const birds = call('wildlife', 'birds', state); if (birds && birds.spoonbills && !p.hints.spoonbills) { p.hints.spoonbills = true; M.ticker(state, 37); if (p.hints.lookoutPending) { p.hints.lookoutPending = false; call('economy', 'bump', state, 'prestige', 1, 'voice:lookout'); } } }
      if (lastTickerDay(state) <= day - 3) tick1Filler(state);
      c.unlockDirty = true; c.nearestDay = NONE;
    }
    // Objective machinery
    evalTriggers(state, c);
    if (c.dirty || flags.newDay) evalGoals(state, c, !!flags.newDay);
    promote(state, c);
    if (c.unlockDirty) refreshUnlocks(state, c, true);
    // Set pieces
    if (c.paradeStart) { if (!startParade(state, c) && day > c.paradeWanted + 1) { c.paradeWanted = NONE; c.paradeStart = false; } }   // another set piece running: retry until the day after
    if (c.gradWanted >= 0 && fin(state.tick, 0) >= c.gradStartTick) { if (startGraduation(state, c) || c.gradWanted !== day) c.gradWanted = NONE; }
    if (state.setPiece && state.setPiece.kind === 'parade') { call('weather', 'scriptSky', state, SKY.DUSK, state.setPiece.tick / Math.max(1, state.setPiece.len)); if (!c.parade) c.parade = buildParade(state); }
    // First-warning restore
    if (c.warning && !c.warning.restored && fin(state.tick, 0) >= c.warning.until) restoreWarning(state, c);
    c.dirty = false; c.tileDirty = false; c.ringDirty = false;
  };
  /** ui: the first-warning notification closed */
  M.warningClosed = function (state) { try { restoreWarning(state, ctx(state)); } catch (e) { BSU.error('progress', 'warningClosed', e); } };

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------
  M.debugOpen = function (state, open) { try { lazyKeys(state); pr(state).achievementsWhileDebug = !!open; } catch (e) { BSU.error('progress', 'debugOpen', e); } };
  M.fireAllToasts = function (state) {
    try {
      for (const id of ['sandbag', 'shelter', 'fuel', 'gate']) call('weather', '_openToast', state, id);
      call('sports', 'halftime', state);
      call('sports', 'offerPlayThrough', state);
    } catch (e) { BSU.error('progress', 'fireAllToasts', e); }
  };

  // ---------------------------------------------------------------------------
  // selfTest (§10.6; private state, recorder emit, stubbed deps)
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const A = function (cond, msg) { BSU.assert(cond, 'progress: ' + msg); };
    const saved = {}; for (const k of Object.keys(M._deps)) saved[k] = M._deps[k];
    const savedC = C;
    const rec = [];
    const liveState = BSU.state;
    try {
      M._deps.emit = function (name, payload) { rec.push({ name: name, payload: payload }); };
      const names = function (n) { return rec.filter(function (r) { return r.name === n; }); };
      const s = BSU.newState(1234);
      s.plot.founders = { tx: 30, ty: 10 }; s.plot.rect = { x0: 26, y0: 8, x1: 36, y1: 16 }; s.plot.cove = [BSU.idx(30, 20), BSU.idx(31, 20)]; s.plot.landing = BSU.idx(30, 30); s.plot.landingShoulder = BSU.idx(30, 29); s.plot.mouth = [BSU.idx(30, 22)];
      s.tiles.type.fill(T.DRY);
      const stubs = {
        economy: { post: function () {}, bump: function () {}, addStudents: function (st, n) { st.economy.students += n; }, applyCard: function () {}, setAutoRepair: function () {}, setSuspendCapPenalties: function () {}, setSuppressCoverage: function () {}, buildingValue: function () { return 4e6; } },
        weather: { queueCell: function () {}, suppressRainOn: function () {}, scheduleNearMiss: function () {}, setRunning: function (st, on) { st.calendar.running = !!on; }, forecastSurge: function () { return 5; }, scriptSky: function () {}, _openToast: function () {} },
        wildlife: { forceFirstGator: function () {}, ecology: function () { return 80; }, mosqIndex: function () { return 0; }, birds: function () { return { spoonbills: false }; }, applyEcologyOnce: function () {}, onCampus: function () { return []; }, campusMask: function () { return null; } },
        hydro: { forceSat: function () {}, networks: function () { return []; }, networkAt: function () { return null; }, depthAt: function () { return 0; }, floodedTiles: function () { return []; }, pumpRunning: function () { return false; } },
        buildings: { list: function (st, t) { return (st.buildings || []).filter(function (b) { return b && (!t || b.type === t); }); }, has: function (st, t, mt) { return (st.buildings || []).some(function (b) { return b && b.type === t && b.built >= 1 && (b.tier || 0) >= (mt || 0); }); }, count: function (st, t) { return (st.buildings || []).filter(function (b) { return b && (!t || b.type === t); }).length; }, coveTilesUnreached: function () { return false; }, ringClosed: function () { return false; }, gaps: function () { return { gaps: [], weak: [], gates: [], reachedBuildings: [] }; }, shelter: function () { return { ok: false }; }, stats: function () { return { unrepaired: 0, seats: 0, lots: 0 }; }, boilWaterTriggered: function () { return false; }, clearBoilWater: function () {}, leveeRuns: function () { return []; }, placeRun: function () { return { ok: true }; }, effective: function () { return 1; }, dumpsterTile: function () { return -1; }, boundaryLevees: function () { return []; } },
        session: { startSetPiece: function (st, k, o) { if (st.setPiece) return false; st.setPiece = { kind: k, tick: 0, len: o.len, skippable: !!o.skippable, choices: {}, speedBefore: 1, cameraTouched: false }; return true; }, setSpeed: function () {}, restoreSpeed: function () {}, skipSetPiece: function () {} },
        ui: { card: function () { stubs.uiCards++; }, notify: function () {}, hint: function () {}, selectTool: function () {}, lockTool: function () {}, introduceTab: function () {}, answerDecision: function () {}, closeCard: function () {} },
        render: { panToTile: function () {}, flashTiles: function () {}, particles: { emit: function () {} } },
        sports: { startNightGameScript: function () {}, halftime: function () {}, offerPlayThrough: function () {} },
        agents: { spawnArrival: function () {}, launchCajunNavy: function () {} }, terrain: { paradeRoute: function () { return []; }, setFlag: function () {}, reachableHigh5: function () { return []; } }, audio: { play: function () {} },
        uiCards: 0
      };
      for (const k of Object.keys(stubs)) if (k !== 'uiCards') M._deps[k] = stubs[k];
      M.reset(s, true);
      const flags = function (newDay) { return { newDay: !!newDay, newMonth: false, newYear: false, day: s.calendar.day }; };
      const step = function (n) { for (let i = 0; i < (n || 1); i++) { M.tick(s, flags(false)); s.tick++; } };
      const nextDay = function () { s.calendar.day++; M._onDate(s, parts(s.calendar.day).date, s.calendar.day); M.tick(s, flags(true)); s.tick++; };

      // 1. objective graph
      const allIds = BSU.OBJECTIVE_IDS;
      for (const id of allIds) A(!!od(id), 'data.objectives has ' + id);
      for (const id of allIds) if (TUTORIAL_IDS.indexOf(id) < 0) A(typeof TRIGGERS[id] === 'function', 'objective ' + id + ' has a trigger');
      for (const id of allIds) A(typeof GOALS[id] === 'function', 'objective ' + id + ' has a goal');
      for (const id of allIds) A(kindOf(id) === od(id).kind, 'kind matches data for ' + id);
      for (const id of allIds) A(GRANT_IDS.has(id) === !!(od(id).reward && od(id).reward.grant), 'grant reward set matches data for ' + id);

      // 2. scheduler: three interrupts in one tick → one offer per tick, FIFO; background waits; promotes after completion
      s.progress.tutorialStage = 6; C.stageEntered = 6;
      offerObjective(s, '9'); offerObjective(s, '10'); offerObjective(s, '16'); offerObjective(s, '8');
      step(1); A(names(EV.OBJECTIVE_OFFERED).length === 1 && names(EV.OBJECTIVE_OFFERED)[0].payload.id === '9', 'tick 1 offers 9 only');
      A(s.progress.background === null, 'background waits while the interrupt is on the card');
      step(1); A(names(EV.OBJECTIVE_OFFERED).length === 2 && s.progress.background === '8', 'tick 2 promotes the background row');
      M.complete(s, '9'); step(1); A(s.progress.card === '10', 'completing the interrupt promotes the next interrupt (FIFO)');
      offerObjective(s, '12'); step(1); A(s.progress.card === '12' && ost(s, '10').state === 'queued' && s.progress.interruptQueue[0] === '10', 'a storm interrupt preempts the card; the active one returns to the queue front');
      M.dismiss(s, '12'); step(1); A(s.progress.card === '10', 'the preempted interrupt is re-offered');
      M.complete(s, '10'); step(1); A(s.progress.card === '16', '16 after 10');
      M.dismiss(s, '16'); M.dismiss(s, '8'); step(1);
      A(names(EV.OBJECTIVE_COMPLETE).length === 2, 'two completions recorded');

      // 3. timers
      rec.length = 0;
      M.addTimer(s, 'austerity', 1, 5); const d0 = s.calendar.day;
      for (let k = 0; k < 4; k++) nextDay(); A(!!M.timer(s, 'austerity'), 'timer alive before day + 5');
      nextDay(); A(!M.timer(s, 'austerity') && names(EV.TIMER_EXPIRED).some(function (r) { return r.payload.id === 'austerity'; }) && s.calendar.day === d0 + 5, 'timer expires exactly on day + 5');
      M.addTimer(s, 'insurance', 1, -1); M.addTimer(s, 'probation', 1, Infinity);
      A(M.timer(s, 'insurance').untilDay === -1 && M.timer(s, 'probation').untilDay === -1, 'open-ended timers store -1');
      for (let k = 0; k < 1000; k++) { s.calendar.day++; expireTimers(s); }
      A(!!M.timer(s, 'insurance') && !!M.timer(s, 'probation'), 'open-ended timers never expire');
      for (const t of s.progress.timers) A(Number.isFinite(t.untilDay) && Number.isFinite(t.value), 'timer fields finite');
      M.addTimer(s, 'insurance', 0.5, 10); A(s.progress.timers.filter(function (t) { return t.id === 'insurance'; }).length === 1 && M.timer(s, 'insurance').value === 0.5, 're-adding replaces');
      M.addTimer(s, 'voiceApplicants', 40, -1); M.addTimer(s, 'voiceApplicants', 60, -1); A(M.timer(s, 'voiceApplicants').value === 100, 'voiceApplicants accumulates');
      for (const id of M.TIMER_IDS) M.addTimer(s, id, 1, 1);
      A(s.progress.timers.every(function (t) { return TIMER_SET.has(t.id); }), 'every timer id in the registry');
      const src = String(M.addTimer) + String(applyMilestoneReward) + String(voicePayoff) + String(M.answerBoard) + String(M.answerFailure) + String(onStormPassed) + String(endParade) + String(onProbation);
      const re = /addTimer\((?:state|s|st),\s*'([A-Za-z]+)'/g; let mm; while ((mm = re.exec(src))) A(TIMER_SET.has(mm[1]), 'module adds a registered timer id: ' + mm[1]);
      s.progress.timers.length = 0;

      // 4. unlocks
      const rich = BSU.newState(99); rich.economy.students = 20000; rich.economy.prestige = 100; rich.wildlife.ecology = 100;
      for (const id of BSU.MILESTONES) rich.progress.milestones[id] = { earned: true, day: 0 };
      let bid = 0; for (const row of data().catalogList) { rich.buildings.push({ id: bid++, type: row.id, tx: 1, ty: 1, w: 1, h: 1, built: 1, tier: 3, ruin: false }); }
      const richWl = M._deps.wildlife; M._deps.wildlife = { ecology: function (st) { return st.wildlife.ecology; } };
      for (const row of data().catalogList) A(M.unlockOk(rich, row.unlock) && M.unlocked(rich, row.id), 'row unlocks on the rich state: ' + row.id);
      for (const row of data().catalogList) for (const tr of (row.tiers || [])) A(M.unlockOk(rich, tr.unlock), 'tier unlocks on the rich state: ' + row.id + ' ' + tr.tier);
      const empty = BSU.newState(98);
      for (const row of data().catalogList) { const start = !row.unlock || Object.keys(row.unlock).length === 0; A(M.unlocked(empty, row.id) === start, 'empty state: only Start rows unlocked (' + row.id + ')'); if (!start) A(M.unlockReason(empty, row.id).length > 0, 'locked row has a reason: ' + row.id); }
      A(M.unlockReason(empty, 'engineering') === '' || typeof M.unlockReason(empty, 'engineering') === 'string', 'unlockReason is a string');
      M._deps.wildlife = richWl;

      // 5. milestones
      for (const id of BSU.MILESTONES) A(id in MILESTONE_COND, 'milestone has a condition entry: ' + id);
      rec.length = 0; M.achieve(s, 'firstBell'); M.achieve(s, 'firstBell'); A(names(EV.MILESTONE_EARNED).length === 1, 'achieve twice → one event');
      s.progress.achievementsWhileDebug = true; M.achieve(s, 'lightsAreOn'); A(names(EV.MILESTONE_EARNED).length === 1 && !M.earned(s, 'lightsAreOn'), 'no achievements while the debug panel is open'); s.progress.achievementsWhileDebug = false;

      // 6. ticker
      s.ticker.length = 0;
      M.ticker(s, 43, { w: 28, l: 17, opp: 'Magnolia State' });
      A(s.ticker[0].text === 'BSU 28, Magnolia State 17 — FINAL. Bells ring until someone finds the off switch.', 'line 43 formats (got ' + s.ticker[0].text + ')');
      A(s.ticker[0].kind === 'sports', 'line 43 kind sports');
      for (let k = 0; k < 40; k++) M.ticker(s, 'x' + k); A(s.ticker.length === 30, 'ticker buffer ≤ 30');
      s.ticker.length = 0; M.ticker(s, 'quiet'); const d1 = s.calendar.day;
      nextDay(); nextDay(); A(s.ticker.length === 1, 'no filler on days 1–2');
      nextDay(); A(s.ticker.length === 2 && s.ticker[1].day === d1 + 3, 'filler on the silent day 3');

      // 7. showMe
      for (const id of allIds.concat(['plot', 'cove', 'landing', 'crown', 'ring', 'target'])) { const r = M.showMe(s, id); A(r && Number.isFinite(r.tx) && Number.isFinite(r.ty), 'showMe finite for ' + id); }

      // 8. voice deck
      for (const v of data().voiceCards) { A(typeof VOICE_PREREQ[v.id] === 'function', 'voice prereq exists: ' + v.id); A(typeof VOICE_GOALS[v.id] === 'function', 'voice goal exists: ' + v.id); }
      A(s.progress.voiceCards.length === data().voiceCards.length, 'voice deck filled on fresh reset');
      s.economy.students = 300; s.progress.objectives['7'].state = 'done';
      rec.length = 0; M.offerVoice(s); A(names(EV.VOICE_OFFERED).length === 1 && names(EV.VOICE_OFFERED)[0].payload.id === 'quadOak', 'first eligible card offered (quadOak at 300 students)');
      M.answerVoice(s, 'quadOak', false); A(s.progress.voiceCards.find(function (v) { return v.id === 'quadOak'; }).state === 'declined', 'declined card recorded');
      rec.length = 0; M.offerVoice(s); A(names(EV.VOICE_OFFERED).length === 0, 'a declined card is never re-offered');
      s.economy.students = 700; offerObjective(s, '14'); step(1); A(interruptActive(s) && s.progress.card === '14', 'interrupt on the card');
      rec.length = 0; M.offerVoice(s); A(names(EV.VOICE_OFFERED).length === 0, 'voice skipped while an interrupt is active'); M.dismiss(s, '14');

      // 9. Célestine gate
      const s9 = BSU.newState(55); s9.plot.founders = { tx: 30, ty: 10 }; s9.plot.cove = []; s9.progress.tutorialStage = 6;
      M.reset(s9, true); C.stageEntered = 6;
      A(!M.offered(s9, '11'), "'11' not offered before Jun 1");
      s9.calendar.day = dateDay('Jun 1', 1); M._onDate(s9, 'Jun 1', s9.calendar.day); M.tick(s9, { newDay: true, newMonth: false, newYear: false, day: s9.calendar.day });
      A(M.offered(s9, '11'), "'11' offered after Jun 1 + one tick");
      A(rec.every(function (r) { return typeof r.name === 'string'; }), 'all emits went to the recorder');

      // 10. failure cards
      stubs.uiCards = 0;
      M.failureCard(s, 'bankruptcy'); A(s.progress.failure.pendingKind === 'bankruptcy' && stubs.uiCards === 0, 'failureCard records pendingKind and opens no card');
      const t0 = s.progress.timers.length; M.answerFailure(s, 'bankruptcy', 'austerity'); M.answerFailure(s, 'bankruptcy', 'austerity');
      A(s.progress.failure.pendingKind === null && s.progress.failure.bankruptcy === 1 && s.progress.timers.length === t0 + 3, 'answerFailure applies once (' + (s.progress.timers.length - t0) + ' timers)');

      // 11. set pieces start on their dates (parade needs a Dusk, graduation starts next tick)
      s.setPiece = null; s.calendar.day = dateDay('Feb 8', 2); M._onDate(s, 'Feb 8', s.calendar.day); C.pendingEvents.push({ name: EV.SKY_PHASE, payload: { phase: SKY.DUSK, prev: SKY.GOLDEN } }); step(1);
      A(!!s.setPiece && s.setPiece.kind === 'parade', 'parade starts at the first Dusk of Feb 8');
      A(M.parade(s) !== null, 'parade() returns positions during the parade');
      s.setPiece = null; C.pendingEvents.push({ name: EV.SETPIECE_END, payload: { kind: 'parade' } }); step(1); A(s.progress.setPiecesSeen.parade === true, 'parade seen after setpiece:end');
      A(s.progress.setPiecesSeen.game === false, 'game not seen before a game set piece ends');
      C.pendingEvents.push({ name: EV.SETPIECE_END, payload: { kind: 'game' } }); step(1); A(s.progress.setPiecesSeen.game === true && M.setPieceSeen(s, 'game'), 'game seen after setpiece:end{game} (PLAN_FOOTBALL hotfix)');
      s.progress.setPiecesSeen.game = false; C.pendingEvents.push({ name: EV.SETPIECE_END, payload: { kind: 'montage' } }); step(1); A(s.progress.setPiecesSeen.game === true, 'game seen after setpiece:end{montage}');
      s.calendar.day = dateDay('May 5', 2); M._onDate(s, 'May 5', s.calendar.day); step(2); A(!!s.setPiece && s.setPiece.kind === 'graduation', 'graduation starts after May 5');
      s.setPiece = null;

      // finite scan of the private tree's progress branch
      const scan = function (o, path) { if (o == null) return null; if (typeof o === 'number') return Number.isFinite(o) ? null : path; if (typeof o !== 'object') return null; for (const k of Object.keys(o)) { const r = scan(o[k], path + '.' + k); if (r) return r; } return null; };
      A(scan(s.progress, 'progress') === null && scan(s.ticker, 'ticker') === null, 'no non-finite number in progress/ticker');
      notes.push('objective graph, scheduler, timers, unlocks, milestones, ticker, showMe, voice, Célestine gate, failure cards, set pieces');
      return { ok: true, notes: notes.join('; ') };
    } catch (e) {
      return { ok: false, notes: 'progress.selfTest: ' + (e && e.stack || e) };
    } finally {
      for (const k of Object.keys(M._deps)) delete M._deps[k];
      for (const k of Object.keys(saved)) M._deps[k] = saved[k];
      C = savedC;
      if (liveState !== BSU.state) BSU.state = liveState;
    }
  };
})();
