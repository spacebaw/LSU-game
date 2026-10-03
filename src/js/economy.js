'use strict';
// ============================================================================
// BAYOU STATE — economy.js (module 7) → BSU.economy
// Owner of: state.economy (cash, students, alumni, prestige, happiness, tuition,
//           sliders, loan bookkeeping, insurance/endowment/west flags, applicant
//           pool, capacity, targets, happiness terms, runway) and state.ledger.
// Implements: ARCHITECTURE.md §2.7, §5.1 step 7, §5.7; GDD §5 (5.1–5.9), §4.11
//           (capacity inputs), §6.2 Recovery (disaster grant, insurance), §6.4
//           (biblical applicants), §6.8 (state funding below 30 ecology), §7.1
//           (voice payoffs that are money/applicants), §8 (athletics is booked
//           here, posted by sports), §9.2 (dates), §10.7 (failure states),
//           §10.8 (Endowment, Second Campus), §11.5 (Budget panel lines).
// Rules: 'use strict' IIFE; zero DOM/timer/audio access at definition time;
//        every emit goes through M._deps.emit (§10.6); every cross-module read
//        goes through M._deps.<module> (default BSU.<module>) so selfTest can
//        stub them; no state on the module object (D46); no Infinity/NaN ever
//        written into state (§10.3); economy draws no rng except the one
//        deterministic pick in applyCard('naming').
// ============================================================================
(function () {
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const BSU = root.BSU;
  const M = (BSU.economy = BSU.economy || {});
  const P = BSU.params;
  const PE = P.econ;
  const EV = BSU.EV;
  const INC = BSU.LEDGER_INCOME_KEYS;
  const EXP = BSU.LEDGER_EXPENSE_KEYS;
  const INC_SET = new Set(INC);
  const EXP_SET = new Set(EXP);
  const HAPPY_IDS = BSU.HAPPINESS_TIMERS;
  const HAPPY_SET = new Set(HAPPY_IDS);

  // ---------------------------------------------------------------------------
  // Local constants the GDD states but BSU.params does not carry (listed in
  // docs/INTEGRATION_NOTES.md under "## economy.js"). Every other number below
  // is read from BSU.params.
  // ---------------------------------------------------------------------------
  const L = Object.freeze({
    happinessEmitEveryTicks: 10,                       // econ:stat{happiness} at most once per 10 ticks (brief §3)
    stadiumTier: Object.freeze({ none: 0, bayou_field: 0, stadium1: 1, stadium2: 2, stadium3: 3 }),   // §5.5 football term
    pumpRunPerDay: P.build.pumpRunCost / P.time.daysPerMonth,   // $3k/month running → per day (§0.3 row 28)
    generatorRunPerDay: P.build.generatorRunCost,               // $2k per running day (§0.3 row 6)
    namingHall: 'Boudreaux Petroleum Hall',                     // §10.7
    bankruptcyCardGapDays: PE.bankruptMonths * P.time.daysPerMonth,   // one bankruptcy card per 3 months while unanswered
    probationExit: PE.failure.probationExit                     // 15
  });
  const DAYS_PER_MONTH = P.time.daysPerMonth;
  const DAYS_PER_YEAR = P.time.daysPerYear;
  const TICKS_PER_DAY = P.time.ticksPerDay;
  const EMA_ALPHA = 1 / (PE.happiness.emaDays * TICKS_PER_DAY);   // 1/100 per tick

  // ---------------------------------------------------------------------------
  // Dependencies (injectable, §10.6). selfTest replaces entries for its
  // duration; production leaves them undefined so `dep()` resolves BSU.<name>.
  // ---------------------------------------------------------------------------
  M._deps = {
    emit: function (name, payload) { BSU.events.emit(name, payload); }
  };
  function dep(name) {
    const d = M._deps[name];
    if (d !== undefined && d !== null) return d;
    return BSU[name] || null;
  }
  /** Safe cross-module call: missing module/function → dflt; a throw → BSU.error + dflt. */
  function call(modName, fnName, args, dflt) {
    const mod = dep(modName);
    if (!mod || typeof mod[fnName] !== 'function') return dflt;
    try {
      const r = mod[fnName].apply(mod, args);
      return (r === undefined) ? dflt : r;
    } catch (e) {
      BSU.error('economy', modName + '.' + fnName, e);
      return dflt;
    }
  }
  function emit(name, payload) {
    try { M._deps.emit(name, payload); }
    catch (e) { if (BSU.SELFTEST) throw e; BSU.error('economy', 'emit:' + name, e); }
  }

  // ---------------------------------------------------------------------------
  // Small pure helpers
  // ---------------------------------------------------------------------------
  const clamp = BSU.clamp;
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : (d === undefined ? 0 : d); }
  function int(v, d) { return Math.round(num(v, d)); }
  function clamp100(v) { return clamp(num(v, 0), 0, 100); }
  function parts(state) { return BSU.dayParts(num(state.calendar && state.calendar.day, 0)); }
  function today(state) { return Math.max(0, Math.floor(num(state.calendar && state.calendar.day, 0))); }
  function isDate(state, str) { return parts(state).date === str; }
  function yearDay(str) { const d = BSU.dateToDay(str, 1); return isFinite(d) ? d : -1; }   // day-of-year (0–119)
  function inYearWindow(state, startStr, endStr) {
    const yd = today(state) % DAYS_PER_YEAR;
    const a = yearDay(startStr), b = yearDay(endStr);
    return a >= 0 && b >= 0 && yd >= a && yd <= b;
  }
  /** first absolute day strictly after `day` on which the 'Mon D' date falls (-1 if unparsable) */
  function nextDateAfter(day, str) {
    const y = Math.floor(day / DAYS_PER_YEAR) + 1;
    const d0 = BSU.dateToDay(str, y), d1 = BSU.dateToDay(str, y + 1);
    if (!isFinite(d0)) return -1;
    return d0 > day ? d0 : d1;
  }
  function catalogRow(type) { const D = BSU.data; return (D && D.catalog && D.catalog[type]) || null; }
  function isComplete(b) { return !!b && num(b.built, 0) >= 1 && !b.ruin; }

  // ---------------------------------------------------------------------------
  // Closure caches (rebuilt in reset; never saved; hold no root reference
  // across games except through `cacheRoot` checks)
  // ---------------------------------------------------------------------------
  let lastDay = -1;                 // for the flags-less fallback day detection
  let pendingAttendance = false;    // set by the sky:phase DUSK listener, drained in tick
  let reportQueue = [];             // storm:report payloads (drained in tick)
  let lastHappyShown = -1;          // rounded happiness last emitted
  let lastEcoShown = -1;            // rounded ecology last emitted
  let statsCache = { root: null, tick: -1, day: -1, value: null };

  /** Every saved sub-key contract.js lacks; initialized lazily for BOTH reset cases (§2, D46). */
  function ensureKeys(state) {
    const e = state.economy;
    if (typeof e.attritionBonus !== 'number' || !isFinite(e.attritionBonus)) e.attritionBonus = 0;
    if (e.pendingDisaster === undefined) e.pendingDisaster = null;
    if (typeof e.admittedSinceLock !== 'number' || !isFinite(e.admittedSinceLock)) e.admittedSinceLock = 0;
    if (typeof e.cancelledSemester !== 'boolean') e.cancelledSemester = false;
    if (typeof e.cancelledUntilDay !== 'number' || !isFinite(e.cancelledUntilDay)) e.cancelledUntilDay = -1;
    if (typeof e.runningCost !== 'number' || !isFinite(e.runningCost)) e.runningCost = 0;
    if (typeof e.blackoutDays !== 'number' || !isFinite(e.blackoutDays)) e.blackoutDays = 0;
    if (typeof e.lowPrestigeDays !== 'number' || !isFinite(e.lowPrestigeDays)) e.lowPrestigeDays = 0;
    if (typeof e.probationSemesters !== 'number' || !isFinite(e.probationSemesters)) e.probationSemesters = 0;
    if (typeof e.probationCardDay !== 'number' || !isFinite(e.probationCardDay)) e.probationCardDay = -1;
    if (typeof e.bankruptcyCardDay !== 'number' || !isFinite(e.bankruptcyCardDay)) e.bankruptcyCardDay = -1;
    if (!e.capacityTerms || typeof e.capacityTerms !== 'object') e.capacityTerms = { beds: 0, seats: 0, dining: 0, wastewater: PE.capacity.wastewaterBase };
    if (!e.targets || typeof e.targets !== 'object') e.targets = { prestige: num(e.prestige, PE.startPrestige), terms: {} };
    if (!e.happyTerms || typeof e.happyTerms !== 'object') e.happyTerms = {};
    if (!Array.isArray(e.attendanceCycles)) e.attendanceCycles = [];
    if (!e.runway || typeof e.runway !== 'object') e.runway = { months: 0, nextPayDay: -1, red: false };
    const l = state.ledger;
    if (!l.month) l.month = { income: {}, expense: {} };
    if (!l.last) l.last = { income: {}, expense: {}, net: 0 };
    if (!l.year) l.year = { income: 0, expense: 0, construction: 0 };
    if (!Array.isArray(l.history)) l.history = [];
    for (const k of INC) { if (!isFinite(l.month.income[k])) l.month.income[k] = 0; if (!isFinite(l.last.income[k])) l.last.income[k] = 0; }
    for (const k of EXP) { if (!isFinite(l.month.expense[k])) l.month.expense[k] = 0; if (!isFinite(l.last.expense[k])) l.last.expense[k] = 0; }
  }

  // ---------------------------------------------------------------------------
  // Reads of other modules (all defensive)
  // ---------------------------------------------------------------------------
  const STATS_DEFAULT = Object.freeze({
    beds: 0, seats: 0, feeds: 0, diningCovered: 0, landmarks: 0, oaks: 0, cypress: 0, stockedPonds: 0, posts: 0, quality: 0,
    lots: 0, unrepaired: 0, floodedCore: false, brownout: false, pumpsRunning: 0, generatorsRunning: 0,
    roadAdjacentDorms: 0, pumpsNearDorms: 0, barriersNearDorms: 0, floodwallDormsNoOak: 0, wastewaterPlants: 0, parkingLots: 0, bridges: 0
  });
  /** buildings.stats() with every field defaulted; cached per (root, tick). */
  function stats(state) {
    if (statsCache.root === state && statsCache.tick === state.tick && statsCache.day === today(state) && statsCache.value) return statsCache.value;
    const raw = call('buildings', 'stats', [state], null);
    const out = {};
    for (const k of Object.keys(STATS_DEFAULT)) {
      const v = raw ? raw[k] : undefined;
      out[k] = (typeof STATS_DEFAULT[k] === 'boolean') ? !!v : num(v, STATS_DEFAULT[k]);
    }
    if (raw && raw.academicFlags && typeof raw.academicFlags === 'object') out.academicFlags = raw.academicFlags;
    if (raw && typeof raw.buildingValue === 'number') out.buildingValue = num(raw.buildingValue, 0);
    // lots: `lots` and `parkingLots` are both documented; take whichever is set
    if (!out.lots && out.parkingLots) out.lots = out.parkingLots;
    statsCache = { root: state, tick: state.tick, day: today(state), value: out };
    return out;
  }
  /** Building list, optionally by type: buildings.list or a read of state.buildings. */
  function blist(state, type) {
    const r = call('buildings', 'list', [state, type], null);
    if (Array.isArray(r)) return r;
    const out = [];
    const arr = Array.isArray(state.buildings) ? state.buildings : [];
    for (let i = 0; i < arr.length; i++) { const b = arr[i]; if (b && (!type || b.type === type)) out.push(b); }
    return out;
  }
  function completeList(state, type) { return blist(state, type).filter(isComplete); }
  function effective(state, b) {
    const dflt = (isComplete(b) && !b.flooded) ? 1 : 0;
    return clamp(num(call('buildings', 'effective', [state, b.id], dflt), dflt), 0, 1);
  }
  function hasComplete(state, type) { return completeList(state, type).length > 0; }
  function plantCount(state, st) {
    const n = num(st && st.wastewaterPlants, 0);
    return n > 0 ? n : completeList(state, 'wastewater').length;
  }
  function ecologyNow(state) {
    const w = call('wildlife', 'ecology', [state], null);
    if (typeof w === 'number' && isFinite(w)) return clamp100(w);
    if (state.wildlife && isFinite(state.wildlife.ecology)) return clamp100(state.wildlife.ecology);
    return clamp100(state.economy.ecology);
  }
  function mosqIndexNow(state) {
    const v = call('wildlife', 'mosqIndex', [state], null);
    if (typeof v === 'number' && isFinite(v)) return clamp(v, 0, 1);
    return clamp(num(state.wildlife && state.wildlife.mosqIndex, 0), 0, 1);
  }
  function gatorPenaltyNow(state) {
    const v = call('wildlife', 'gatorPenalty', [state], null);
    if (typeof v === 'number' && isFinite(v)) return clamp(v, 0, P.wildlife.gator.incidentCap);
    const inc = (state.wildlife && Array.isArray(state.wildlife.incidents)) ? state.wildlife.incidents : [];
    const day = today(state);
    let n = 0;
    for (let i = 0; i < inc.length; i++) if (inc[i] && num(inc[i].day, -1e9) > day - P.wildlife.gator.incidentDays) n++;
    return Math.min(P.wildlife.gator.incidentCap, P.wildlife.gator.incidentPenalty * n);
  }
  function sampleNow(state) {
    const s = call('agents', 'sample', [state], null);
    if (!s || typeof s !== 'object') return { life: 0, green: 0, mosq: 0, heat: 0, n: 0 };
    return { life: num(s.life, 0), green: num(s.green, 0), mosq: num(s.mosq, 0), heat: num(s.heat, 0), n: num(s.n, 0) };
  }
  function seasonNow(state) {
    const s = call('sports', 'season', [state], null) || state.sports || {};
    const rec = s.record || { wins: 0, losses: 0 };
    const last = s.lastSeason || { wins: 0, losses: 0, bowlWon: false, undefeated: false };
    return {
      hasTeam: !!s.hasTeam,
      venue: typeof s.venue === 'string' ? s.venue : 'none',
      permits: s.permits === 'free' ? 'free' : 'paid',
      clubOnly: (typeof s.clubOnly === 'boolean') ? s.clubOnly : (!!s.hasTeam && (s.venue === 'none' || !s.venue)),
      wins: int(rec.wins, 0), losses: int(rec.losses, 0),
      lastWins: int(last.wins, 0), lastLosses: int(last.losses, 0), bowlWon: !!last.bowlWon
    };
  }
  function homeWinsNow(state) {
    const v = call('sports', 'homeWinsThisSeason', [state], null);
    if (typeof v === 'number' && isFinite(v)) return Math.max(0, v);
    const rec = state.sports && state.sports.record;
    return rec ? Math.max(0, int(rec.wins, 0)) : 0;
  }
  function timerRows(state) {
    const r = call('progress', 'timers', [state], null);
    if (Array.isArray(r)) return r;
    return (state.progress && Array.isArray(state.progress.timers)) ? state.progress.timers : [];
  }
  function timerRow(state, id) {
    const r = call('progress', 'timer', [state, id], undefined);
    if (r !== undefined) return r || null;
    const rows = timerRows(state);
    for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].id === id) return rows[i];
    return null;
  }
  function timerActive(t, day) { return !!t && (t.untilDay === -1 || num(t.untilDay, -1) > day); }
  function addTimer(state, id, value, days, meta) { call('progress', 'addTimer', [state, id, value, days, meta], undefined); }
  function removeTimer(state, id) { call('progress', 'removeTimer', [state, id], undefined); }
  function leveeTileCount(state) {
    const crest = state.tiles && state.tiles.crest;
    if (!crest) return 0;
    let n = 0;
    for (let i = 0; i < crest.length; i++) if (crest[i] > 0) n++;
    return n;
  }
  /** dorms/res towers within Chebyshev 4 of any Surge Barrier footprint (the surgeBarrier timer) */
  function dormsNearBarriers(state) {
    const barriers = completeList(state, 'surge_barrier');
    if (!barriers.length) return 0;
    const homes = completeList(state, 'dorm').concat(completeList(state, 'res_tower'));
    const R = PE.happiness.noiseBarrierRadius;
    let n = 0;
    for (const d of homes) {
      for (const b of barriers) {
        const dx = Math.max(0, Math.max(num(b.tx) - (num(d.tx) + num(d.w, 1) - 1), num(d.tx) - (num(b.tx) + num(b.w, 1) - 1)));
        const dy = Math.max(0, Math.max(num(b.ty) - (num(d.ty) + num(d.h, 1) - 1), num(d.ty) - (num(b.ty) + num(b.h, 1) - 1)));
        if (Math.max(dx, dy) <= R) { n++; break; }
      }
    }
    return n;
  }

  // ---------------------------------------------------------------------------
  // Stat emission
  // ---------------------------------------------------------------------------
  function emitStat(state, stat, value, delta) {
    emit(EV.ECON_STAT, { stat: stat, value: num(value, 0), delta: num(delta, 0) });
  }
  function setStudents(state, n, why) {
    const e = state.economy;
    let v = Math.max(0, int(n, 0));
    if (e.students > 0 || v > 0) v = Math.max(v, Math.min(PE.minStudents, Math.max(e.students, v)));   // never below 60 once founded
    const delta = v - e.students;
    if (delta === 0) return 0;
    e.students = v;
    emitStat(state, 'students', v, delta);
    return delta;
  }
  function setPrestige(state, v) {
    const e = state.economy;
    const nv = clamp100(v);
    const delta = nv - e.prestige;
    e.prestige = nv;
    if (Math.abs(delta) > 1e-9) emitStat(state, 'prestige', nv, delta);
  }

  // ---------------------------------------------------------------------------
  // Timers (public helpers)
  // ---------------------------------------------------------------------------
  /** 0 if absent/expired, else the timer's value */
  M.timerValue = function (state, id) {
    try {
      const t = timerRow(state, id);
      return timerActive(t, today(state)) ? num(t.value, 0) : 0;
    } catch (e) { BSU.error('economy', 'timerValue', e); return 0; }
  };
  /** returns the value and removes the timer (one-shot: lobby, biblicalApplicants, voiceApplicants) */
  M.consumeTimer = function (state, id) {
    try {
      const t = timerRow(state, id);
      const v = timerActive(t, today(state)) ? num(t.value, 0) : 0;
      if (t) removeTimer(state, id);
      return v;
    } catch (e) { BSU.error('economy', 'consumeTimer', e); return 0; }
  };
  const tv = function (state, id) { return M.timerValue(state, id); };

  // ---------------------------------------------------------------------------
  // Ledger mechanics (§2.7)
  // ---------------------------------------------------------------------------
  /** cash − cost ≥ −loanLimit (construction may dip into the loan line) */
  M.canAfford = function (state, cost) {
    try { return num(state.economy.cash, 0) - num(cost, 0) >= -num(state.economy.loanLimit, PE.loanLimit); }
    catch (e) { return false; }
  };
  /** income (positive, integer) under a fixed §2.7 key; emits econ:income and econ:stat{cash} */
  M.post = function (state, key, amount, meta) {
    try {
      const amt = int(amount, 0);
      if (!(amt > 0)) return;
      let k = key;
      if (!INC_SET.has(k)) { BSU.error('economy', 'post:key', new Error('unknown income key ' + String(key))); k = 'misc'; }
      const e = state.economy, l = state.ledger;
      e.cash = int(e.cash, 0) + amt;
      l.month.income[k] = int(l.month.income[k], 0) + amt;
      l.year.income = int(l.year.income, 0) + amt;
      const p = { key: k, amount: amt };
      if (meta && typeof meta.i === 'number' && isFinite(meta.i)) p.i = meta.i;
      if (meta && meta.note !== undefined) p.note = String(meta.note);
      emit(EV.ECON_INCOME, p);
      emitStat(state, 'cash', e.cash, amt);
    } catch (err) { BSU.error('economy', 'post', err); }
  };
  /** expense; false (and nothing posted) when !canAfford unless meta.force */
  M.charge = function (state, amount, key, meta) {
    try {
      const amt = int(amount, 0);
      if (!(amt > 0)) return true;
      const force = !!(meta && meta.force);
      if (!force && !M.canAfford(state, amt)) return false;
      let k = key;
      if (!EXP_SET.has(k)) { BSU.error('economy', 'charge:key', new Error('unknown expense key ' + String(key))); k = 'misc'; }
      const e = state.economy, l = state.ledger;
      e.cash = int(e.cash, 0) - amt;
      l.month.expense[k] = int(l.month.expense[k], 0) + amt;
      l.year.expense = int(l.year.expense, 0) + amt;
      if (k === 'construction') l.year.construction = int(l.year.construction, 0) + amt;
      const p = { key: k, amount: amt };
      if (meta && typeof meta.i === 'number' && isFinite(meta.i)) p.i = meta.i;
      if (meta && meta.note !== undefined) p.note = String(meta.note);
      emit(EV.ECON_EXPENSE, p);
      emitStat(state, 'cash', e.cash, -amt);
      return true;
    } catch (err) { BSU.error('economy', 'charge', err); return false; }
  };
  /** refunds post as income `misc` with note 'refund' (brief decision) */
  M.refund = function (state, amount, meta) {
    const m = { note: 'refund' };
    if (meta && typeof meta.i === 'number') m.i = meta.i;
    M.post(state, 'misc', amount, m);
  };
  /** close the month: ledger.last = the completed month; ledger.month zeroed with every key present */
  function closeMonth(state) {
    const l = state.ledger;
    const inc = {}, exp = {};
    let ti = 0, te = 0;
    for (const k of INC) { inc[k] = int(l.month.income[k], 0); ti += inc[k]; }
    for (const k of EXP) { exp[k] = int(l.month.expense[k], 0); te += exp[k]; }
    l.last = { income: inc, expense: exp, net: ti - te };
    const mi = {}, me = {};
    for (const k of INC) mi[k] = 0;
    for (const k of EXP) me[k] = 0;
    l.month = { income: mi, expense: me };
  }
  M.statement = function (state) { return state.ledger.last; };

  // ---------------------------------------------------------------------------
  // Σ row.cost (+ tier costs) of complete buildings — the insurance premium base
  // ---------------------------------------------------------------------------
  M.buildingValue = function (state) {
    try {
      const st = stats(state);
      if (typeof st.buildingValue === 'number' && st.buildingValue > 0) return int(st.buildingValue, 0);
      let sum = 0;
      for (const b of completeList(state)) {
        const row = catalogRow(b.type);
        if (!row) continue;
        sum += num(row.cost, 0);
        const tier = int(b.tier, 0);
        if (tier > 0 && Array.isArray(row.tiers)) for (let t = 0; t < tier && t < row.tiers.length; t++) sum += num(row.tiers[t].cost, 0);
      }
      return int(sum, 0);
    } catch (e) { BSU.error('economy', 'buildingValue', e); return 0; }
  };
  /** damage% × cost × 0.6 summed over damaged buildings */
  M.repairBill = function (state) {
    try {
      let sum = 0;
      for (const b of completeList(state)) {
        const hp = clamp(num(b.hp, 1), 0, 1);
        if (hp >= 1) continue;
        const row = catalogRow(b.type);
        if (row) sum += (1 - hp) * num(row.cost, 0) * PE.repairMult;
      }
      return int(sum, 0);
    } catch (e) { BSU.error('economy', 'repairBill', e); return 0; }
  };

  // ---------------------------------------------------------------------------
  // Enrollment inputs (§5.4)
  // ---------------------------------------------------------------------------
  function applicantFactors(state, tuition) {
    const e = state.economy, A = PE.applicants;
    const sn = seasonNow(state);
    const base = A.base + A.prestige * clamp100(e.prestige) + A.happiness * clamp100(e.happiness);
    const tuitionFactor = clamp(A.tuitionA - num(tuition, e.tuition) / A.tuitionDiv, A.tuitionMin, A.tuitionMax);
    const footballBuzz = 1 + A.buzzPerWin * sn.lastWins + (sn.bowlWon ? A.bowlBuzz : 0);
    const applicantsMult = (1 + tv(state, 'tuitionFreezeApplicants')) * (1 + tv(state, 'tuitionHike')) * (1 + tv(state, 'probation')) * (1 + tv(state, 'biblicalApplicants'));
    const core = base * tuitionFactor * footballBuzz;
    const westAdd = e.westCampus ? (PE.west.applicantsMult - 1) * core : 0;
    const voiceAdd = tv(state, 'voiceApplicants');
    const total = Math.max(0, Math.round(core * Math.max(0, applicantsMult) + voiceAdd + westAdd));
    return { base: base, tuitionFactor: tuitionFactor, footballBuzz: footballBuzz, applicantsMult: applicantsMult, applicantsAdd: voiceAdd + westAdd, total: total };
  }
  M.applicants = function (state) { try { return applicantFactors(state, state.economy.tuition).total; } catch (e) { BSU.error('economy', 'applicants', e); return 0; } };
  M.previewApplicants = function (state, tuition) {
    try { return applicantFactors(state, clamp(num(tuition, state.economy.tuition), PE.tuition.min, PE.tuition.max)).total; }
    catch (e) { BSU.error('economy', 'previewApplicants', e); return 0; }
  };
  function acceptedNow(state) {
    const sel = PE.selectivity[state.economy.selectivity];
    return Math.max(0, Math.round(num(state.economy.applicants, 0) * num(sel, 1)));
  }
  /** capacity = min(beds×1.15, seats×1.4, dining×1.6, wastewaterCap) (stats already × effective) */
  M.capacity = function (state) {
    try {
      const st = stats(state), C = PE.capacity;
      const plants = plantCount(state, st);
      const beds = Math.round(num(st.beds) * C.beds), seats = Math.round(num(st.seats) * C.seats), dining = Math.round(num(st.feeds) * C.dining);
      const wastewater = plants === 0 ? C.wastewaterBase : C.wastewaterPer * plants;
      const capacity = Math.max(0, Math.min(beds, seats, dining, wastewater));
      return { capacity: capacity, beds: beds, seats: seats, dining: dining, wastewater: wastewater };
    } catch (e) { BSU.error('economy', 'capacity', e); return { capacity: 0, beds: 0, seats: 0, dining: 0, wastewater: PE.capacity.wastewaterBase }; }
  };
  function recomputeCapacity(state) {
    const c = M.capacity(state);
    state.economy.capacity = c.capacity;
    state.economy.capacityTerms = { beds: c.beds, seats: c.seats, dining: c.dining, wastewater: c.wastewater };
    return c.capacity;
  }
  function gap(state) { return Math.max(0, int(state.economy.capacity, 0) - int(state.economy.students, 0)); }

  /** ONLY changes the count (+ admittedSinceLock) and emits econ:stat{students}; no enroll event, no spawn (D53) */
  M.addStudents = function (state, n, source) {
    try {
      const add = Math.max(0, int(n, 0));
      if (add === 0) return;
      const e = state.economy;
      e.admittedSinceLock = int(e.admittedSinceLock, 0) + add;
      setStudents(state, int(e.students, 0) + add, source || 'debug');
    } catch (err) { BSU.error('economy', 'addStudents', err); }
  };
  function enrollPayload(state, n, kind) {
    const e = state.economy;
    return { day: today(state), admitted: n, students: int(e.students, 0), capacity: int(e.capacity, 0), applicants: int(e.applicants, 0), kind: kind };
  }
  /** the 5th-of-the-month round: 20% of the gap, capped by the pool (emits enroll:round when someone arrived) */
  function rollingRound(state) {
    const e = state.economy;
    const n = Math.max(0, Math.min(int(e.pool, 0), Math.round(PE.gapShare.rolling * gap(state))));
    if (n > 0) {
      M.addStudents(state, n, 'pirogue');
      e.pool = Math.max(0, int(e.pool, 0) - n);
      emit(EV.ENROLL_ROUND, enrollPayload(state, n, 'rolling'));
    }
    return n;
  }
  function springLock(state) {
    const e = state.economy;
    const n = Math.max(0, Math.min(int(e.pool, 0), Math.round(PE.gapShare.spring * gap(state))));
    if (n > 0) {
      M.addStudents(state, n, 'pirogue');
      e.pool = Math.max(0, int(e.pool, 0) - n);
      emit(EV.ENROLL_LOCK, enrollPayload(state, n, 'spring'));
    }
    afterLock(state);
    return n;
  }
  function fallLock(state) {
    const e = state.economy;
    e.admittedSinceLock = 0;
    e.pool = acceptedNow(state);
    const n = Math.max(0, Math.min(int(e.pool, 0), Math.round(PE.gapShare.fall * gap(state))));
    if (n > 0) {
      M.addStudents(state, n, 'bus');
      e.pool = Math.max(0, int(e.pool, 0) - n);
      emit(EV.ENROLL_LOCK, enrollPayload(state, n, 'fall'));
    }
    afterLock(state);
    return n;
  }
  /** the "until the next lock" one-shots are consumed here; the Board is asked to offer */
  function afterLock(state) {
    M.consumeTimer(state, 'voiceApplicants');
    M.consumeTimer(state, 'biblicalApplicants');
    call('progress', 'offerBoard', [state], undefined);
  }
  /** semester-end attrition (Dec 10, May 5): floor at minStudents; ×2 while Semester Cancelled */
  function attrition(state) {
    const e = state.economy;
    const students = int(e.students, 0);
    let n = 0;
    if (students > 0) {
      let rate = PE.attrition.base + (100 - clamp100(e.happiness)) / 100 * PE.attrition.happinessK + Math.max(0, num(e.attritionBonus, 0));
      if (e.cancelledSemester) rate *= PE.failure.cancelledAttritionMult;
      n = Math.round(students * rate);
      n = Math.max(0, Math.min(n, students - PE.minStudents));
      if (n > 0) setStudents(state, students - n, 'attrition');
    }
    e.attritionBonus = 0;
    emit(EV.ENROLL_ATTRITION, { count: n, students: int(e.students, 0) });
    return n;
  }
  /** May 5 from Year 2: 22% graduate → alumni (before attrition) */
  function graduation(state) {
    const e = state.economy;
    const students = int(e.students, 0);
    let g = Math.round(PE.graduation * students);
    g = Math.max(0, Math.min(g, students - PE.minStudents));
    if (g > 0) {
      setStudents(state, students - g, 'graduation');
      e.alumni = int(e.alumni, 0) + g;
    }
    emit(EV.ENROLL_GRADUATION, { count: g, students: int(e.students, 0) });
    return g;
  }
  /** weather: hurricane party / unsheltered add attrition for the current semester */
  M.addAttrition = function (state, frac) {
    try { state.economy.attritionBonus = Math.max(0, num(state.economy.attritionBonus, 0) + Math.max(0, num(frac, 0))); }
    catch (e) { BSU.error('economy', 'addAttrition', e); }
  };

  // ---------------------------------------------------------------------------
  // Prestige (§5.5)
  // ---------------------------------------------------------------------------
  function attendanceMean(state) {
    const arr = state.economy.attendanceCycles;
    if (!Array.isArray(arr) || arr.length === 0) return 1;
    let s = 0, n = 0;
    for (let i = 0; i < arr.length; i++) { const v = num(arr[i], NaN); if (isFinite(v)) { s += clamp(v, 0, 1); n++; } }
    return n ? s / n : 1;
  }
  function academicFlags(state, st) {
    const f = st.academicFlags;
    const flag = function (key, type) {
      if (f && typeof f[key] === 'boolean') return f[key];
      return completeList(state, type).some(function (b) { return effective(state, b) > 0; });
    };
    return { library: flag('library', 'library'), engineering: flag('engineering', 'engineering'), coastal: flag('coastal', 'coastal_institute') };
  }
  /** the structural target and its weighted term breakdown */
  function prestigeTarget(state) {
    const e = state.economy, PP = PE.prestige, W = PP.weights;
    const st = stats(state);
    const students = Math.max(1, int(e.students, 0));
    const flags = academicFlags(state, st);
    let aq = PP.academicSeats * Math.min(1, num(st.seats) / (PP.seatsPerStudent * students))
      + PP.academicPer * (flags.library ? 1 : 0) + PP.academicPer * (flags.engineering ? 1 : 0) + PP.academicPer * (flags.coastal ? 1 : 0);
    aq = clamp100(aq) * (PP.attendanceBase + PP.attendanceK * attendanceMean(state));
    const faculty = Math.min(100, PP.facultyBase * num(PE.qualityMult[e.quality], 1));
    const sn = seasonNow(state);
    let football = 0;
    if (sn.hasTeam) {
      const played = sn.wins + sn.losses, lastPlayed = sn.lastWins + sn.lastLosses;
      const winPct = played > 0 ? sn.wins / played : (lastPlayed > 0 ? sn.lastWins / lastPlayed : 0);
      football = Math.min(100, PP.footballWin * winPct + PP.footballTier * num(L.stadiumTier[sn.venue], 0));
      if (sn.clubOnly) football = Math.min(football, P.sports.clubScoreCap);
    }
    const landmarks = clamp100(PP.landmarkMult * num(st.landmarks));
    const eco = ecologyNow(state);
    const ecologyBonus = eco * (flags.coastal ? 1 : PP.ecologyNoInstitute);
    const selectivity = num(PP.selectivityScore[e.selectivity], 0);
    const blight = PP.blight.damaged * Math.max(0, num(st.unrepaired))
      + (st.floodedCore ? PP.blight.flooded : 0)
      + (mosqIndexNow(state) > P.wildlife.mosq.biblical ? P.wildlife.mosq.biblicalBlight : 0)   // one mosquito term (brief decision)
      + (int(e.blackoutDays, 0) > P.storm.blackoutBlightDays ? P.storm.blackoutBlight : 0);
    const rookery = hasComplete(state, 'rookery') ? 1 : 0;
    const terms = {
      academic: W.academic * aq, faculty: W.faculty * faculty, happiness: W.happiness * clamp100(e.happiness), football: W.football * football,
      landmarks: W.landmarks * landmarks, ecology: W.ecology * ecologyBonus, selectivity: W.selectivity * selectivity, blight: -blight, rookery: rookery
    };
    let target = 0;
    for (const k of Object.keys(terms)) { terms[k] = Math.round(terms[k] * 1000) / 1000; target += terms[k]; }
    return { target: clamp100(target), terms: terms, inputs: { academicQuality: aq, facultyScore: faculty, football: football, landmarks: landmarks, ecologyBonus: ecologyBonus, selectivityScore: selectivity, blight: blight } };
  }
  M._prestigeTarget = prestigeTarget;   // exposed for tests (pure)
  function monthlyPrestige(state) {
    const e = state.economy;
    const t = prestigeTarget(state);
    e.targets = { prestige: t.target, terms: t.terms };
    setPrestige(state, num(e.prestige, 0) + PE.prestige.lerp * (t.target - num(e.prestige, 0)));
    e.attendanceCycles = [];
  }

  // ---------------------------------------------------------------------------
  // Happiness (§5.6)
  // ---------------------------------------------------------------------------
  function festivalSpirit(state) {
    const F = P.weather.festivals, H = PE.happiness;
    let s = 0;
    if (inYearWindow(state, F.mardiGrasStart, F.mardiGrasEnd)) s += H.festival;
    if (inYearWindow(state, F.crawfishStart, F.crawfishEnd)) s += H.festival;
    if (inYearWindow(state, F.homecomingStart, F.homecomingEnd)) s += hasComplete(state, 'quad') ? H.festival : H.festivalNoBonfire;
    if (isDate(state, F.bonfireDate)) s += Math.min(H.bonfireCap, H.bonfirePer10 * Math.floor(leveeTileCount(state) / 10));
    return s;
  }
  /** the instantaneous formula and every named term (signed) */
  function happinessRaw(state) {
    const e = state.economy, H = PE.happiness;
    const st = stats(state);
    const students = int(e.students, 0);
    const suspend = !!e.suspendCapPenalties;
    const housing = Math.min(H.housingCap, num(st.quality) * H.housingPerQuality) - ((num(st.beds) < students && !suspend) ? H.bedsShort : 0);
    const dining = H.dining * clamp(num(st.diningCovered), 0, 1) - ((num(st.feeds) <= 0 && !suspend) ? H.noDining : 0);
    const spirit = H.spiritWin * homeWinsNow(state) + tv(state, 'rivalrySpirit') + festivalSpirit(state);
    const all = completeList(state);
    let flooded = 0, dormFlooded = false;
    for (const b of all) if (b.flooded) { flooded++; if (b.type === 'dorm' || b.type === 'res_tower') dormFlooded = true; }
    const flood = Math.min(H.floodCap, H.floodPer * flooded) + (dormFlooded ? H.dormFlooded : 0);
    const gator = gatorPenaltyNow(state);
    const sample = sampleNow(state);
    const life = Math.min(H.lifeCap, Math.max(0, sample.life));
    const green = Math.min(H.greenCap, Math.max(0, sample.green));
    const mosquito = P.wildlife.mosq.happinessMult * clamp(sample.n > 0 ? sample.mosq : mosqIndexNow(state), 0, 1);
    const heat = clamp(sample.heat, 0, P.heat.penaltyCap);
    const tuition = Math.max(0, (num(e.tuition, PE.tuition.default) - H.tuitionBase) / H.tuitionDiv);
    const crowd = H.crowd * Math.max(0, students / Math.max(1, num(st.seats)) - 1);
    const noise = H.noiseRoad * num(st.roadAdjacentDorms) + H.noisePump * num(st.pumpsNearDorms) + H.noiseBarrier * num(st.barriersNearDorms);
    const terms = {
      housing: housing, dining: dining, life: life, green: green, spirit: spirit,
      mosquito: -mosquito, flood: -flood, gator: -gator, heat: -heat, tuition: -tuition, crowd: -crowd, noise: -noise
    };
    let events = 0;
    const unknown = [];
    const day = today(state);
    const rows = timerRows(state);
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i];
      if (!t || !timerActive(t, day)) continue;
      if (HAPPY_SET.has(t.id)) { const v = num(t.value, 0); events += v; terms[t.id] = v; }
      else if (t.id === 'rivalrySpirit') { /* folded into spirit */ }
      else unknown.push(t.id);
    }
    const raw = clamp100(H.base + housing + dining + life + green + spirit + events - mosquito - flood - gator - heat - tuition - crowd - noise);
    for (const k of Object.keys(terms)) terms[k] = Math.round(num(terms[k], 0) * 100) / 100;
    return { raw: raw, terms: terms, unknown: unknown };
  }
  M._happinessRaw = happinessRaw;   // exposed for tests (pure)
  M.happyTerms = function (state) { return state.economy.happyTerms; };
  /** the active happiness `events` rows */
  M.modifiers = function (state) {
    try {
      const day = today(state), out = [];
      const rows = timerRows(state);
      for (let i = 0; i < rows.length; i++) { const t = rows[i]; if (t && HAPPY_SET.has(t.id) && timerActive(t, day)) out.push({ id: t.id, value: num(t.value, 0), untilDay: num(t.untilDay, -1) }); }
      return out;
    } catch (e) { BSU.error('economy', 'modifiers', e); return []; }
  };
  /** the flat (open-ended) rows of the §5.6 table are maintained by economy daily */
  function maintainFlatTimers(state) {
    const e = state.economy, st = stats(state), T = PE.timers;
    const students = int(e.students, 0);
    const plants = plantCount(state, st);
    const lots = num(st.lots);
    const bell = completeList(state, 'bell_tower').some(function (b) { return effective(state, b) > 0; });
    const bounty = completeList(state, 'wildlife_post').some(function (b) { return !!(b.data && b.data.policies && b.data.policies.nutriaBounty); });
    const fwDorms = Math.min(-T.floodwallView.cap, Math.max(0, int(st.floodwallDormsNoOak, 0)));
    const barrierDorms = dormsNearBarriers(state);
    const flats = [
      ['bellTower', T.bellTower.value, bell],
      ['wastewater', T.wastewater.value, students > PE.capacity.wastewaterBase && plants === 0],
      ['brownout', T.brownout.value, !!st.brownout],
      ['floodwallView', T.floodwallView.value * fwDorms, fwDorms > 0],
      ['noParking', T.noParking.value, students > 0 && lots < Math.ceil(students / PE.parkingPer)],
      ['nutriaBounty', T.nutriaBounty.value, bounty],
      ['freePermits', T.freePermits.value, seasonNow(state).permits === 'free'],
      ['surgeBarrier', T.surgeBarrier.value * barrierDorms, barrierDorms > 0]
    ];
    const day = today(state);
    for (const [id, value, cond] of flats) {
      const t = timerRow(state, id);
      if (cond) { if (!timerActive(t, day) || num(t.value, NaN) !== value) addTimer(state, id, value, -1); }
      else if (t) removeTimer(state, id);
    }
    // wildlife's 20-day biblical streak → applicants −10% at the next lock (economy adds it; the lock consumes it)
    const biblical = int(state.wildlife && state.wildlife.biblicalDays, 0);
    if (biblical >= P.wildlife.mosq.biblicalDays && !timerActive(timerRow(state, 'biblicalApplicants'), day)) addTimer(state, 'biblicalApplicants', -P.wildlife.mosq.biblicalApplicants, -1);
  }
  function dailyHappiness(state) {
    const e = state.economy;
    const r = happinessRaw(state);
    e.happinessRaw = r.raw;
    e.happyTerms = r.terms;
  }
  function tickHappiness(state) {
    const e = state.economy;
    const raw = clamp100(e.happinessRaw);
    const cur = clamp100(e.happiness);
    e.happiness = cur + (raw - cur) * EMA_ALPHA;
    if (num(state.tick, 0) % L.happinessEmitEveryTicks === 0) {
      const shown = Math.round(e.happiness);
      if (shown !== lastHappyShown) { const d = lastHappyShown < 0 ? 0 : shown - lastHappyShown; lastHappyShown = shown; emitStat(state, 'happiness', shown, d); }
    }
  }
  /** instant bumps: prestige direct (clamped); happiness only by the debug cheat (else a nudge of the EMA) */
  M.bump = function (state, stat, delta, why) {
    try {
      const d = num(delta, 0);
      if (!isFinite(d)) return;
      if (stat === 'prestige') { setPrestige(state, num(state.economy.prestige, 0) + d); return; }
      if (stat === 'happiness') {
        const e = state.economy;
        if (why === 'debug') { e.happiness = clamp100(d); e.happinessRaw = e.happiness; }
        else e.happiness = clamp100(num(e.happiness, 0) + d);
        const shown = Math.round(e.happiness);
        emitStat(state, 'happiness', shown, shown - (lastHappyShown < 0 ? shown : lastHappyShown));
        lastHappyShown = shown;
      }
    } catch (e) { BSU.error('economy', 'bump', e); }
  };

  // ---------------------------------------------------------------------------
  // Runway (§5.7, §11.5)
  // ---------------------------------------------------------------------------
  function projectedBurn(state) {
    const e = state.economy, st = stats(state);
    const students = int(e.students, 0);
    const salaries = students * PE.salaryPerStudent * num(PE.qualityMult[e.quality], 1);
    const utilities = PE.utilities.perBuilding * completeList(state).length + PE.utilities.perStudent * students;
    const upkeep = num(call('buildings', 'upkeepTotal', [state], 0), 0);
    return Math.max(0, Math.round(salaries + utilities + upkeep + num(e.coaching, 0) / P.time.monthsPerYear + (num(st.pumpsRunning) * L.pumpRunPerDay + num(st.generatorsRunning) * L.generatorRunPerDay) * DAYS_PER_MONTH));
  }
  M.runway = function (state) {
    try {
      const e = state.economy, l = state.ledger, day = today(state);
      let burn = 0;
      for (const k of EXP) if (k !== 'construction' && k !== 'demolition') burn += int(l.last.expense[k], 0);
      if (burn <= 0) burn = projectedBurn(state);
      let nextPayDay = -1;
      for (const s of PE.installments) { const d = nextDateAfter(day, s); if (d >= 0 && (nextPayDay < 0 || d < nextPayDay)) nextPayDay = d; }
      const cash = int(e.cash, 0);
      const months = cash <= 0 ? 0 : Math.floor(cash / Math.max(1, burn));
      const daysUntilPay = nextPayDay >= 0 ? Math.max(0, nextPayDay - day) : 0;
      const red = cash - burn * (daysUntilPay / DAYS_PER_MONTH) < 0;
      const r = { months: months, nextPayDay: nextPayDay, red: red };
      e.runway = { months: months, nextPayDay: nextPayDay, red: red };
      return r;
    } catch (err) { BSU.error('economy', 'runway', err); return { months: 0, nextPayDay: -1, red: false }; }
  };

  // ---------------------------------------------------------------------------
  // Monthly money (§5.2, §5.3)
  // ---------------------------------------------------------------------------
  function monthlyCharges(state, month) {
    const e = state.economy, st = stats(state);
    const students = int(e.students, 0);
    const force = { force: true };
    // upkeep (+ pump/generator running cost accumulated daily)
    const upkeep = Math.round(num(call('buildings', 'upkeepTotal', [state], 0), 0) * (1 - clamp(tv(state, 'austerityUpkeep'), 0, 1)));
    M.charge(state, upkeep, 'upkeep', force);
    const running = int(e.runningCost, 0);
    if (running > 0) M.charge(state, running, 'upkeep', { force: true, note: 'pumps & generators' });
    e.runningCost = 0;
    // salaries
    M.charge(state, Math.round(students * PE.salaryPerStudent * num(PE.qualityMult[e.quality], 1)), 'salaries', force);
    // utilities (AC months ×1.5)
    const U = PE.utilities;
    const summer = month >= U.summerMonths[0] && month <= U.summerMonths[1];
    M.charge(state, Math.round((U.perBuilding * completeList(state).length + U.perStudent * students) * (summer ? U.summerMult : 1)), 'utilities', force);
    // coaching
    M.charge(state, Math.round(num(e.coaching, 0) / P.time.monthsPerYear), 'coaching', force);
    // interest on a negative balance
    if (e.cash < 0) { const interest = Math.round(-e.cash * PE.interest); M.charge(state, interest, 'interest', force); e.interestPaid = int(e.interestPaid, 0) + interest; }
    // insurance premium while the policy exists
    if (timerActive(timerRow(state, 'insurance'), today(state))) {
      const prem = Math.round(M.buildingValue(state) * PE.boardCards.insurance.premium / P.time.monthsPerYear);
      M.charge(state, prem, 'boardCards', { force: true, note: 'Insurance premium' });
      e.insurance = true;
    } else e.insurance = false;
  }
  function monthlyIncomes(state, month, year) {
    const e = state.economy, st = stats(state);
    const students = int(e.students, 0);
    const prestigeF = PE.donationBase + clamp100(e.prestige) / 100;
    // donations
    const sn = seasonNow(state);
    const homecomingMonth = BSU.dayParts(yearDay(P.weather.festivals.homecomingStart)).month;
    const donations = int(e.alumni, 0) * PE.donationPerAlumnus * prestigeF
      * Math.min(PE.footballMultCap, 1 + PE.footballMultPerWin * sn.lastWins)
      * (month === homecomingMonth ? PE.homecomingDonation : 1)
      * (tv(state, 'undefeatedDonations') || 1) * (tv(state, 'rivalryDonations') || 1);
    if (donations >= 1) M.post(state, 'donations', donations);
    // research
    let research = 0;
    if (!st.brownout) {
      for (const b of completeList(state, 'engineering')) { const eff = effective(state, b); if (eff > 0 && !b.blackout) research += PE.research.engineering * prestigeF * eff; }
      const eco = ecologyNow(state);
      const restoration = hasComplete(state, 'marsh_restoration') ? PE.research.restorationMult : 1;
      for (const b of completeList(state, 'coastal_institute')) { const eff = effective(state, b); if (eff > 0 && !b.blackout) research += PE.research.coastal * (eco / PE.research.coastalEcoDiv) * prestigeF * eff * restoration; }
      research *= (1 + tv(state, 'researchBonus')) * (tv(state, 'researchPush') || 1);
    }
    if (research >= 1) M.post(state, 'research', research);
    // parking tickets
    const lots = num(st.lots) > 0 ? num(st.lots) : completeList(state, 'parking').length;
    const parking = Math.min(lots, Math.ceil(students / PE.parkingPer)) * PE.parkingPay + tv(state, 'voiceParking');
    if (parking >= 1) M.post(state, 'parking', parking);
    // po'boy shacks (misc, note "Po'boy")
    const voicePoboy = timerRow(state, 'voicePoboy');
    const poboyBuilding = (voicePoboy && voicePoboy.meta && typeof voicePoboy.meta.building === 'number') ? voicePoboy.meta.building : -1;
    let poboy = 0;
    for (const b of completeList(state, 'poboy')) {
      const row = catalogRow('poboy');
      const eff = effective(state, b);
      poboy += num(row && row.effects.revenueMonthly, 2000) * eff;
      if (b.id === poboyBuilding && timerActive(voicePoboy, today(state))) poboy += num(voicePoboy.value, 0);
    }
    if (poboy >= 1) M.post(state, 'misc', poboy, { note: "Po'boy" });
    // pelts
    let bountyPosts = 0;
    for (const b of completeList(state, 'wildlife_post')) if (b.data && b.data.policies && b.data.policies.nutriaBounty) bountyPosts++;
    if (bountyPosts > 0) M.post(state, 'pelts', PE.peltPay * bountyPosts);
    // endowment yield (Year 5+)
    if (year >= PE.endowmentFromYear && int(e.endowment, 0) > 0) M.post(state, 'endowment', Math.round(int(e.endowment, 0) * PE.endowmentYield));
  }
  /** the 1st of every month: statement, charges, incomes, applicants/pool, prestige lerp, bankruptcy counter */
  function monthlyStep(state) {
    const e = state.economy;
    const pr = parts(state);
    closeMonth(state);
    monthlyCharges(state, pr.month);
    monthlyIncomes(state, pr.month, pr.year);
    e.applicants = M.applicants(state);
    e.pool = Math.max(0, acceptedNow(state) - int(e.admittedSinceLock, 0));
    monthlyPrestige(state);
    e.negMonths = (e.cash < -num(e.loanLimit, PE.loanLimit)) ? int(e.negMonths, 0) + 1 : 0;
    checkBankruptcy(state);
    emit(EV.ECON_MONTH, { statement: state.ledger.last });
  }

  // ---------------------------------------------------------------------------
  // Failure states (§10.7)
  // ---------------------------------------------------------------------------
  function failure(state) { return (state.progress && state.progress.failure) || {}; }
  function cardPending(state) { const f = failure(state); return !!f.pendingKind; }
  function receiverActive(state) {
    const f = failure(state);
    if (num(f.receiverUntilDay, -1) > today(state)) return true;
    return !!call('progress', 'receiverActive', [state], false);
  }
  function checkBankruptcy(state) {
    const e = state.economy, day = today(state);
    if (int(e.negMonths, 0) < PE.bankruptMonths) return;
    if (cardPending(state) || receiverActive(state)) return;
    if (int(e.bankruptcyCardDay, -1) >= 0 && day - e.bankruptcyCardDay < L.bankruptcyCardGapDays) return;
    e.bankruptcyCardDay = day;
    emit(EV.ECON_CARD, { kind: 'bankruptcy', options: ['austerity', 'hike', 'naming'] });
  }
  function dailyUnderwater(state) {
    const all = completeList(state);
    let flooded = 0;
    for (const b of all) if (b.flooded) flooded++;
    const share = all.length ? flooded / all.length : 0;
    call('progress', 'reportUnderwater', [state, share], undefined);
  }
  function offerProbation(state) {
    const e = state.economy, day = today(state);
    const f = failure(state);
    if (f.probation || cardPending(state)) return;
    if (int(e.probationCardDay, -1) >= 0 && day - e.probationCardDay < PE.failure.probationDays) return;
    e.probationCardDay = day;
    emit(EV.ECON_CARD, { kind: 'probation', options: ['ok'] });
  }
  function dailyProbation(state) {
    const e = state.economy;
    const f = failure(state);
    if (f.probation) {
      // progress removes the timer and clears the flag when prestige > 15; reset our counters when it has
      return;
    }
    if (num(e.prestige, 0) > L.probationExit) { e.lowPrestigeDays = 0; if (int(e.probationCardDay, -1) >= 0 && !cardPending(state)) e.probationCardDay = -1; }
    e.lowPrestigeDays = num(e.prestige, 0) < PE.failure.probationPrestige ? int(e.lowPrestigeDays, 0) + 1 : 0;
    if (e.lowPrestigeDays >= PE.failure.probationDays) { offerProbation(state); e.lowPrestigeDays = 0; }
  }
  function semesterEndProbation(state) {
    const e = state.economy, st = stats(state);
    const students = int(e.students, 0);
    e.probationSemesters = (students > 0 && num(st.seats) < students * PE.failure.probationSeatShare) ? int(e.probationSemesters, 0) + 1 : 0;
    if (e.probationSemesters >= PE.failure.probationSemesters) { offerProbation(state); e.probationSemesters = 0; }
  }

  // ---------------------------------------------------------------------------
  // Dated steps (§9.2)
  // ---------------------------------------------------------------------------
  function tuitionInstallment(state, share, note) {
    const e = state.economy;
    if (e.cancelledSemester) return 0;
    const amt = Math.round(int(e.students, 0) * num(e.tuition, PE.tuition.default) * share);
    if (amt > 0) M.post(state, 'tuition', amt, note ? { note: note } : undefined);
    return amt;
  }
  function stateFunding(state) {
    const e = state.economy;
    const eco = ecologyNow(state);
    const amt = int(e.students, 0) * PE.statePerStudent * (PE.stateBase + PE.statePrestige * clamp100(e.prestige) / 100)
      * (eco < PE.stateEcoMin ? PE.stateEcoMult : 1) * (1 + M.consumeTimer(state, 'lobby'));
    if (amt >= 1) M.post(state, 'state', amt);
    return Math.round(amt);
  }
  function dailyDated(state) {
    const e = state.economy;
    const pr = parts(state);
    const F = P.weather.festivals;
    const day = today(state);
    // Semester Cancelled lapses when the next semester opens
    if (e.cancelledSemester && int(e.cancelledUntilDay, -1) >= 0 && day >= e.cancelledUntilDay) { e.cancelledSemester = false; e.cancelledUntilDay = -1; }
    // Jan 1: nothing dated (history row is handled in the yearly step)
    // May 5: graduation (Year 2+) → attrition → the rolling round (a 5th) → semester-end seat check
    if (isDate(state, PE.graduationDate)) {
      if (pr.year >= PE.graduationFromYear) graduation(state);
      attrition(state);
      semesterEndProbation(state);
    } else if (PE.attritionDates.indexOf(pr.date) >= 0) {
      attrition(state);
      semesterEndProbation(state);
    }
    // locks and rounds
    if (isDate(state, PE.fallLock)) fallLock(state);
    else if (isDate(state, PE.springLock)) springLock(state);
    else if (pr.dom === PE.roundDom && pr.month !== 1 && pr.month !== 8) rollingRound(state);
    // tuition installments (Aug 5 after the lock so the wave pays)
    if (PE.installments.indexOf(pr.date) >= 0) tuitionInstallment(state, PE.installmentShare);
    // summer session: +15% summer tuition on May 6
    if (isDate(state, P.weather.semesterDates.summer) && timerActive(timerRow(state, 'summerSession'), day)) tuitionInstallment(state, PE.boardCards.summerSession.tuitionMult - 1, 'Summer Session');
    // state funding
    if (isDate(state, PE.stateDay)) stateFunding(state);
    // festivals (economy books them by date: Mardi Gras Feb 6, Crawfish Boil Apr 5, Homecoming Oct 7)
    const union = hasComplete(state, 'union');
    if (isDate(state, F.mardiGrasStart)) M.post(state, 'festivals', (PE.festivals.mardiGrasBase + PE.festivals.mardiGrasPer * int(e.students, 0)) * (union ? PE.festivals.unionMult : 1), { note: 'Mardi Gras' });
    if (isDate(state, F.boilDate)) M.post(state, 'festivals', PE.festivals.crawfish + (union ? PE.festivals.crawfishUnion : 0), { note: 'Crawfish Boil' });
    if (isDate(state, F.homecomingStart)) M.post(state, 'festivals', PE.festivals.homecoming, { note: 'Homecoming' });
    // disaster grant (T+20)
    const pd = e.pendingDisaster;
    if (pd && typeof pd === 'object' && int(pd.day, -1) >= 0 && day >= pd.day) {
      const amt = Math.min(PE.disaster.cap, PE.disaster.share * num(pd.bill, 0)) * (ecologyNow(state) >= PE.disaster.ecoMin ? PE.disaster.ecoMult : 1);
      if (amt >= 1) M.post(state, 'disaster', amt, { note: 'State Disaster Grant' });
      e.pendingDisaster = null;
    }
  }
  /** Jan 1 (Year 2+): the Almanac row for the completed year, then a fresh ledger.year */
  function yearlyStep(state) {
    const e = state.economy, pr = parts(state);
    if (today(state) === 0) return;
    const year = pr.year - 1;
    const sn = seasonNow(state);
    let tarps = 0;
    const log = (state.storms && Array.isArray(state.storms.log)) ? state.storms.log : [];
    for (const s of log) if (s && int(s.year, -1) === year) tarps += int(s.tarps, 0);
    state.ledger.history.push({
      year: year, students: int(e.students, 0), cash: int(e.cash, 0), prestige: Math.round(num(e.prestige, 0) * 100) / 100,
      happiness: Math.round(num(e.happiness, 0) * 100) / 100, ecology: Math.round(ecologyNow(state) * 100) / 100,
      wins: sn.lastWins, losses: sn.lastLosses, tarps: tarps
    });
    state.ledger.year = { income: 0, expense: 0, construction: 0 };
  }
  function dailyStep(state) {
    const e = state.economy, st = stats(state);
    recomputeCapacity(state);
    // running costs accumulate daily (posted under upkeep on the 1st)
    const storm = call('weather', 'storm', [state], null) || (state.storms && state.storms.current) || null;
    const preDrain = !!(storm && storm.preDrain);
    e.runningCost = int(e.runningCost, 0) + Math.round(num(st.pumpsRunning) * L.pumpRunPerDay * (preDrain ? P.hydro.preDrainMult : 1) + num(st.generatorsRunning) * L.generatorRunPerDay);
    // blackout streak (a blight point after 3 days)
    let anyBlackout = false;
    for (const b of completeList(state)) if (b.blackout) { anyBlackout = true; break; }
    e.blackoutDays = anyBlackout ? int(e.blackoutDays, 0) + 1 : 0;
    // sick mirror (wildlife's count)
    const sick = (state.wildlife && isFinite(state.wildlife.sick)) ? state.wildlife.sick : call('wildlife', 'sickToday', [state], 0);
    e.sick = Math.max(0, int(sick, 0));
    maintainFlatTimers(state);
    dailyHappiness(state);
    dailyUnderwater(state);
    dailyProbation(state);
    dailyDated(state);
    M.runway(state);
    // ecology stat event (session mirrors the number; economy announces the change)
    const eco = Math.round(ecologyNow(state));
    if (eco !== lastEcoShown) { const d = lastEcoShown < 0 ? 0 : eco - lastEcoShown; lastEcoShown = eco; emitStat(state, 'ecology', eco, d); }
  }

  // ---------------------------------------------------------------------------
  // Sliders and actions (§11.5)
  // ---------------------------------------------------------------------------
  M.setTuition = function (state, v) {
    try {
      const e = state.economy, T = PE.tuition;
      if (timerActive(timerRow(state, 'tuitionLock'), today(state))) return false;
      let nv = clamp(num(v, e.tuition), T.min, T.max);
      nv = Math.round(nv / T.step) * T.step;
      nv = clamp(nv, T.min, T.max);
      const up = nv > num(e.tuition, T.default);
      e.tuition = nv;
      if (up) call('progress', 'ticker', [state, 23], undefined);
      return true;
    } catch (err) { BSU.error('economy', 'setTuition', err); return false; }
  };
  M.setQuality = function (state, q) { if (PE.qualityMult[q] !== undefined) state.economy.quality = q; };
  M.setSelectivity = function (state, s) { if (PE.selectivity[s] !== undefined) state.economy.selectivity = s; };
  M.setCoaching = function (state, v) {
    const S = PE.sliders;
    let nv = clamp(num(v, 0), 0, S.coachingMax);
    nv = Math.round(nv / S.coachingStep) * S.coachingStep;
    state.economy.coaching = clamp(nv, 0, S.coachingMax);
  };
  M.setTicket = function (state, t) { const n = num(t, 0); if (P.sports.tickets[n] !== undefined) state.economy.ticket = n; };
  M.setAutoRepair = function (state, on) { state.economy.autoRepair = !!on; };
  M.setSuspendCapPenalties = function (state, on) { state.economy.suspendCapPenalties = !!on; };
  M.setSuppressCoverage = function (state, on) { state.economy.suppressCoverage = !!on; };
  /** Year 5+: move cash into the Endowment in $1M steps (irreversible) */
  M.endow = function (state, amount) {
    try {
      const e = state.economy, amt = int(amount, 0);
      if (parts(state).year < PE.endowmentFromYear) return { ok: false, reason: 'Endowment opens in Year ' + PE.endowmentFromYear };
      if (amt <= 0 || amt % PE.endowmentStep !== 0) return { ok: false, reason: 'Multiples of ' + BSU.formatMoney(PE.endowmentStep) + ' only' };
      if (int(e.cash, 0) < amt) return { ok: false, reason: 'Not enough cash' };
      if (!M.charge(state, amt, 'misc', { note: 'Endowment' })) return { ok: false, reason: 'Not enough cash' };
      e.endowment = int(e.endowment, 0) + amt;
      return { ok: true, reason: '' };
    } catch (err) { BSU.error('economy', 'endow', err); return { ok: false, reason: 'Error' }; }
  };
  /** x of the bayou at row ty (the west side is tx < this) */
  function bayouX(state, ty) {
    const bayou = (state.plot && Array.isArray(state.plot.bayou)) ? state.plot.bayou : [];
    let best = -1;
    for (let i = 0; i < bayou.length; i++) { const t = bayou[i]; if (BSU.ty(t) === ty) { const x = BSU.tx(t); if (best < 0 || x < best) best = x; } }
    return best >= 0 ? best : P.terrain.bayou.x0;
  }
  /** Second Campus (§10.8): Year 5+, $20M, a Road bridge across the bayou, ≥ 12 complete buildings west of it */
  M.charterWest = function (state) {
    try {
      const e = state.economy, W = PE.west;
      if (e.westCampus) return { ok: false, reason: 'BSU West is already chartered' };
      if (parts(state).year < W.fromYear) return { ok: false, reason: 'The Second Campus opens in Year ' + W.fromYear };
      if (int(e.cash, 0) < W.cost) return { ok: false, reason: 'Needs ' + BSU.formatMoney(W.cost) + ' in cash' };
      if (num(stats(state).bridges) <= 0) return { ok: false, reason: 'Needs a Road bridge across the bayou' };
      let west = 0;
      for (const b of completeList(state)) if (num(b.tx, 99) < bayouX(state, int(b.ty, 0))) west++;
      if (west < W.buildings) return { ok: false, reason: 'Needs ' + W.buildings + ' buildings west of the bayou (' + west + ')' };
      if (!M.charge(state, W.cost, 'construction', { note: 'BSU West' })) return { ok: false, reason: 'Not enough cash' };
      e.westCampus = true;
      call('buildings', 'placeWestHall', [state], undefined);
      e.applicants = M.applicants(state);
      return { ok: true, reason: '' };
    } catch (err) { BSU.error('economy', 'charterWest', err); return { ok: false, reason: 'Error' }; }
  };
  /** a ridge tile near the plot where a free pump can stand (Semester Cancelled delivery) */
  function deliverFreePump(state) {
    const f = state.plot && state.plot.founders;
    if (!f) return false;
    for (let r = 0; r <= 24; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = int(f.tx, 0) + dx, ty = int(f.ty, 0) + dy;
          if (!BSU.inBounds(tx, ty)) continue;
          const can = call('buildings', 'canPlace', [state, 'pump', tx, ty, { rot: 0, ignoreCash: true }], null);
          if (!can || !can.ok) continue;
          const res = call('buildings', 'place', [state, 'pump', tx, ty, { rot: 0, ignoreCash: true, instant: true }], null);
          if (res && res.ok) return true;
        }
      }
    }
    return false;
  }
  /** Board and failure cards: money/tuition effects economy owns (timers are progress's) */
  M.applyCard = function (state, cardId, option) {
    try {
      const e = state.economy, BC = PE.boardCards, FL = PE.failure;
      switch (cardId) {
        case 'lobby': M.charge(state, BC.lobby.cost, 'boardCards', { force: true, note: 'Lobby the Legislature' }); break;
        case 'researchPush': M.charge(state, BC.researchPush.cost, 'boardCards', { force: true, note: 'Research Push' }); break;
        case 'recruitingTrip': M.charge(state, BC.recruitingTrip.cost, 'boardCards', { force: true, note: 'Recruiting Trip' }); break;
        case 'marshGrant': M.post(state, 'grants', BC.marshGrant.cash, { note: 'Marsh Restoration Grant' }); break;
        case 'homecomingBudget': {
          const tier = clamp(int(option, 0), 0, BC.homecomingBudget.costs.length - 1);
          M.charge(state, BC.homecomingBudget.costs[tier], 'boardCards', { force: true, note: 'Homecoming Budget' });
          M.bump(state, 'prestige', BC.homecomingBudget.prestige[tier], 'homecomingBudget');
          break;
        }
        case 'tuitionFreeze': case 'summerSession': case 'insurance': case 'austerity': break;   // timers only (progress)
        case 'hike': e.tuition = clamp(num(e.tuition, PE.tuition.default) + FL.hikeTuition, PE.tuition.min, PE.tuition.max); break;
        case 'naming': {
          M.post(state, 'donations', FL.namingRights, { note: 'Naming rights' });
          M.bump(state, 'prestige', -FL.namingPrestige, 'naming');
          const halls = completeList(state).filter(function (b) { return b.type !== 'founders_hall' && b.name !== L.namingHall && catalogRow(b.type) && catalogRow(b.type).kind === 'footprint'; });
          if (halls.length) { const pick = halls[BSU.rng.sim.int(halls.length)]; call('buildings', 'rename', [state, pick.id, L.namingHall], undefined); }
          break;
        }
        case 'receiver': {
          const delta = -int(e.cash, 0);
          e.cash = 0;
          emitStat(state, 'cash', 0, delta);
          M.bump(state, 'prestige', -FL.receiverPrestige, 'receiver');
          break;
        }
        case 'underwater': {
          e.cancelledSemester = true;
          const day = today(state);
          const nextFall = nextDateAfter(day, P.weather.semesterDates.fall), nextSpring = nextDateAfter(day, P.weather.semesterDates.spring);
          e.cancelledUntilDay = Math.min(nextFall < 0 ? 1e9 : nextFall, nextSpring < 0 ? 1e9 : nextSpring);
          if (e.cancelledUntilDay >= 1e9) e.cancelledUntilDay = day + DAYS_PER_YEAR / 2;
          M.bump(state, 'prestige', -FL.cancelledPrestige, 'underwater');
          M.post(state, 'grants', FL.resilienceGrant, { note: 'Coastal Resilience Grant' });
          deliverFreePump(state);
          break;
        }
        default: break;
      }
    } catch (err) { BSU.error('economy', 'applyCard', err); }
  };

  // ---------------------------------------------------------------------------
  // Breakdown popovers (§11.1) — plain words, no formulas
  // ---------------------------------------------------------------------------
  const LABELS = {
    tuition: 'Tuition', state: 'State funding', donations: 'Donations', research: 'Research', athletics: 'Athletics', tailgate: 'Tailgates', parking: 'Parking tickets',
    festivals: 'Festivals', pelts: 'Nutria pelts', grants: 'Grants', endowment: 'Endowment yield', disaster: 'Disaster grant', insurance: 'Insurance payout', misc: 'Other income',
    salaries: 'Staff salaries', upkeep: 'Upkeep', utilities: 'Utilities', coaching: 'Coaching', interest: 'Loan interest', repair: 'Repairs', prep: 'Storm prep',
    construction: 'Construction', demolition: 'Demolition', boardCards: 'Board cards',
    housing: 'housing quality', dining: 'dining coverage', life: 'student life', green: 'green space', spirit: 'school spirit', mosquito: 'mosquitoes', flood: 'flooding',
    gator: 'gator incidents', heat: 'heat', crowd: 'crowded classes', noise: 'noise',
    academic: 'academic quality', faculty: 'faculty', happiness: 'happiness', football: 'football', landmarks: 'landmarks', ecology: 'ecology', selectivity: 'selectivity', blight: 'blight', rookery: 'the rookery'
  };
  function label(k) { return LABELS[k] || k; }
  function topN(obj, n, sign) {
    const rows = [];
    for (const k of Object.keys(obj)) { const v = num(obj[k], 0); if (sign > 0 ? v > 0 : v < 0) rows.push({ label: label(k), value: v }); }
    rows.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
    return rows.slice(0, n);
  }
  M.breakdown = function (state, stat) {
    try {
      const e = state.economy, l = state.ledger, st = stats(state);
      const students = int(e.students, 0);
      switch (stat) {
        case 'cash': {
          const lines = topN(l.last.income, 3, 1).concat(topN(l.last.expense, 3, 1).map(function (r) { return { label: r.label, value: -r.value }; }));
          const r = M.runway(state);
          return { value: int(e.cash, 0), lines: lines, next: r.nextPayDay >= 0 ? 'Next: tuition ' + BSU.dayParts(r.nextPayDay).date : '' };
        }
        case 'students': {
          const c = e.capacityTerms;
          const lines = [{ label: 'Beds allow', value: int(c.beds, 0) }, { label: 'Seats allow', value: int(c.seats, 0) }, { label: 'Dining allows', value: int(c.dining, 0) }, { label: 'Wastewater allows', value: int(c.wastewater, 0) }];
          const day = today(state);
          let next = '';
          const nextRound = nextRoundDay(day);
          if (nextRound >= 0) next = 'Next: ' + (nextRound === nextDateAfter(day, PE.fallLock) ? 'fall lock ' : nextRound === nextDateAfter(day, PE.springLock) ? 'spring lock ' : 'rolling round ') + BSU.dayParts(nextRound).date + ' (pool ' + int(e.pool, 0) + ')';
          return { value: students, lines: lines, next: next };
        }
        case 'prestige': {
          const terms = e.targets && e.targets.terms ? e.targets.terms : {};
          const lines = [];
          for (const k of Object.keys(terms)) lines.push({ label: label(k), value: Math.round(num(terms[k], 0) * 10) / 10 });
          lines.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
          const W = PE.prestige.weights;
          const maxes = { academic: W.academic * 100 * (PE.prestige.attendanceBase + PE.prestige.attendanceK), faculty: W.faculty * 100, happiness: W.happiness * 100, football: W.football * 100, landmarks: W.landmarks * 100, ecology: W.ecology * 100, selectivity: W.selectivity * 100 };
          let bestK = '', bestGap = 0;
          for (const k of Object.keys(maxes)) { const g = maxes[k] - num(terms[k], 0); if (g > bestGap) { bestGap = g; bestK = k; } }
          return { value: Math.round(num(e.prestige, 0) * 10) / 10, lines: lines.slice(0, 6), next: bestK ? 'Next: ' + label(bestK) + ' has the most room (+' + Math.round(bestGap) + ')' : '' };
        }
        case 'happiness': {
          const t = e.happyTerms || {};
          const lines = topN(t, 3, 1).concat(topN(t, 3, -1));
          let next = '';
          const lots = num(st.lots), plants = plantCount(state, st);
          const parkAt = lots * PE.parkingPer;
          if (students > 0 && students <= parkAt && lots > 0) next = 'Next: −' + Math.abs(PE.timers.noParking.value) + ' no parking at ' + (parkAt + 1) + ' students';
          else if (plants === 0 && students <= PE.capacity.wastewaterBase) next = 'Next: −' + Math.abs(PE.timers.wastewater.value) + ' no wastewater plant at ' + (PE.capacity.wastewaterBase + 1) + ' students';
          else if (num(st.seats) > 0 && students <= num(st.seats)) next = 'Next: crowding above ' + int(st.seats, 0) + ' students';
          return { value: Math.round(num(e.happiness, 0)), lines: lines, next: next };
        }
        case 'ecology': {
          const terms = call('wildlife', 'ecologyTerms', [state], null) || (state.wildlife && state.wildlife.ecologyTerms) || {};
          const lines = [];
          for (const k of Object.keys(terms)) lines.push({ label: label(k), value: Math.round(num(terms[k], 0) * 10) / 10 });
          lines.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
          return { value: Math.round(ecologyNow(state)), lines: lines.slice(0, 6), next: ecologyNow(state) < P.wildlife.ecology.lowThreshold ? 'State funding −15% below ' + P.wildlife.ecology.lowThreshold : '' };
        }
        case 'applicants': {
          const f = applicantFactors(state, e.tuition);
          const lines = [
            { label: 'Prestige and happiness', value: Math.round(f.base) },
            { label: 'Tuition factor', value: Math.round(f.tuitionFactor * 100) / 100 },
            { label: 'Football buzz', value: Math.round(f.footballBuzz * 100) / 100 },
            { label: 'Modifiers', value: Math.round(f.applicantsMult * 100) / 100 }
          ];
          if (f.applicantsAdd) lines.push({ label: 'Extra applicants', value: Math.round(f.applicantsAdd) });
          return { value: f.total, lines: lines, next: 'Recomputed on the 1st' };
        }
        case 'capacity': {
          const c = e.capacityTerms;
          const cap = int(e.capacity, 0);
          const lines = [['beds', 'Beds'], ['seats', 'Seats'], ['dining', 'Dining'], ['wastewater', 'Wastewater']].map(function (p) {
            const v = int(c[p[0]], 0);
            return { label: p[1] + (v === cap ? ' (binding)' : ''), value: v };
          });
          return { value: cap, lines: lines, next: 'Next: raise the binding term' };
        }
        default: return { value: 0, lines: [], next: '' };
      }
    } catch (err) { BSU.error('economy', 'breakdown', err); return { value: 0, lines: [], next: '' }; }
  };
  /** next admissions day strictly after `day` (5th of a non-Jan/Aug month, Jan 10 or Aug 5) */
  function nextRoundDay(day) {
    let best = -1;
    const cand = [nextDateAfter(day, PE.fallLock), nextDateAfter(day, PE.springLock)];
    for (let m = 1; m <= 12; m++) if (m !== 1 && m !== 8) cand.push(nextDateAfter(day, BSU.MONTHS[m - 1] + ' ' + PE.roundDom));
    for (const c of cand) if (c >= 0 && (best < 0 || c < best)) best = c;
    return best;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  function wrapListener(where, fn) {
    return function (payload, name) {
      try { fn(payload, name); }
      catch (e) { if (BSU.SELFTEST) throw e; BSU.error('economy', where, e); }
    };
  }
  M.init = function (state) {
    try {
      BSU.events.clear('economy');
      BSU.events.on(EV.STORM_REPORT, wrapListener('storm:report', function (p) {
        const rep = p && p.report;
        reportQueue.push({ bill: rep ? int(rep.bill, 0) : 0 });
      }), 'economy');
      BSU.events.on(EV.SKY_PHASE, wrapListener('sky:phase', function (p) {
        if (p && p.phase === BSU.SKY.DUSK) pendingAttendance = true;
      }), 'economy');
      // game:final, festival:start, milestone:earned, building:complete: nothing to do here
      // (sports posts revenue itself; festivals are booked by date; progress applies rewards).
    } catch (e) { BSU.error('economy', 'init', e); }
  };
  M.reset = function (state, fresh) {
    try {
      ensureKeys(state);
      lastDay = today(state);
      pendingAttendance = false;
      reportQueue = [];
      lastHappyShown = -1;
      lastEcoShown = -1;
      statsCache = { root: null, tick: -1, day: -1, value: null };
      if (fresh === true) {
        const e = state.economy;
        e.applicants = M.applicants(state);
        e.pool = acceptedNow(state);
        e.admittedSinceLock = 0;
        recomputeCapacity(state);
        const t = prestigeTarget(state);
        e.targets = { prestige: t.target, terms: t.terms };
        M.runway(state);
      }
    } catch (e) { BSU.error('economy', 'reset', e); }
  };
  /** one sim tick: per-tick EMA; daily/monthly/dated work on the flags */
  M.tick = function (state, flags) {
    try {
      if (!state || !state.economy) return;
      ensureKeys(state);
      const day = today(state);
      let newDay, newMonth, newYear;
      if (flags && typeof flags === 'object') { newDay = !!flags.newDay; newMonth = !!flags.newMonth; newYear = !!flags.newYear; }
      else { newDay = day !== lastDay; newMonth = newDay && day % DAYS_PER_MONTH === 0; newYear = newDay && day % DAYS_PER_YEAR === 0; }
      lastDay = day;
      // listener queues (work happens here, not in the listeners)
      if (reportQueue.length) {
        const q = reportQueue; reportQueue = [];
        for (const r of q) {
          if (timerActive(timerRow(state, 'insurance'), day)) M.post(state, 'insurance', Math.round(r.bill * PE.boardCards.insurance.payout), { note: 'Insurance payout' });
          const landfall = int(state.storms && state.storms.lastLandfallDay, -1);
          state.economy.pendingDisaster = { day: (landfall >= 0 ? landfall : day) + PE.disaster.day, bill: int(r.bill, 0) };
        }
      }
      if (pendingAttendance) {
        pendingAttendance = false;
        const a = call('agents', 'classAttendance', [state], 1);
        if (Array.isArray(state.economy.attendanceCycles)) state.economy.attendanceCycles.push(clamp(num(a, 1), 0, 1));
      }
      if (newDay) {
        if (newYear) yearlyStep(state);
        if (newMonth) monthlyStep(state);
        dailyStep(state);
      }
      tickHappiness(state);
    } catch (e) { BSU.error('economy', 'tick', e); }
  };

  // ---------------------------------------------------------------------------
  // selfTest (§10.6): private state, stubbed deps, recorded emits
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const saved = {};
    for (const k of ['emit', 'buildings', 'agents', 'wildlife', 'sports', 'progress', 'weather']) saved[k] = M._deps[k];
    const savedClosure = { lastDay: lastDay, pendingAttendance: pendingAttendance, reportQueue: reportQueue, lastHappyShown: lastHappyShown, lastEcoShown: lastEcoShown, statsCache: statsCache };
    const recorded = [];
    const timers = [];
    const stubStats = { beds: 300, seats: 300, feeds: 1200, diningCovered: 1, landmarks: 2, oaks: 2, cypress: 0, stockedPonds: 0, posts: 0, quality: 2, lots: 0, unrepaired: 0, floodedCore: false, brownout: false, pumpsRunning: 0, generatorsRunning: 0, roadAdjacentDorms: 0, pumpsNearDorms: 0, barriersNearDorms: 0, floodwallDormsNoOak: 0, wastewaterPlants: 0, parkingLots: 0, bridges: 0 };
    const sportsStub = { hasTeam: false, record: { wins: 0, losses: 0 }, lastSeason: { wins: 0, losses: 0, bowlWon: false }, venue: 'none', permits: 'paid', clubOnly: false };
    const eco = { value: 82 };
    const assert = BSU.assert;
    const started = Date.now();
    try {
      M._deps.emit = function (name, payload) { recorded.push({ name: name, payload: payload }); };
      M._deps.progress = {
        timers: function () { return timers; },
        timer: function (s, id) { for (const t of timers) if (t.id === id) return t; return null; },
        addTimer: function (s, id, value, days, meta) {
          const day = today(s);
          const until = (days === Infinity || days < 0) ? -1 : day + days;
          for (const t of timers) if (t.id === id) { t.value = value; t.untilDay = until; t.meta = meta; return; }
          timers.push({ id: id, value: value, untilDay: until, meta: meta });
        },
        removeTimer: function (s, id) { for (let i = timers.length - 1; i >= 0; i--) if (timers[i].id === id) timers.splice(i, 1); },
        offerBoard: function () {}, ticker: function () {}, reportUnderwater: function () {}, receiverActive: function () { return false; }
      };
      M._deps.buildings = {
        stats: function () { return stubStats; }, upkeepTotal: function () { return 17000; }, has: function () { return false; },
        list: function () { return []; }, count: function () { return 0; }, effective: function () { return 1; }, rename: function () {}, place: function () { return { ok: false }; }
      };
      M._deps.agents = { sample: function () { return { life: 0, green: 0, mosq: 0, heat: 0, n: 0 }; }, classAttendance: function () { return 1; } };
      M._deps.wildlife = { mosqIndex: function () { return 0; }, ecology: function () { return eco.value; }, ecologyTerms: function () { return {}; }, sickToday: function () { return 0; }, gatorPenalty: function () { return 0; } };
      M._deps.sports = { season: function () { return sportsStub; }, homeWinsThisSeason: function () { return 0; } };
      M._deps.weather = { storm: function () { return null; } };

      const s = BSU.newState(3);
      s.economy.suspendCapPenalties = false;
      s.economy.suppressCoverage = false;
      M.reset(s, true);
      // 1. §5.4 worked numbers
      assert(M.applicants(s) === 700, 'applicants 700 (got ' + M.applicants(s) + ')');
      assert(M.capacity(s).capacity === 345, 'capacity 345 (got ' + M.capacity(s).capacity + ')');
      M.addStudents(s, 120, 'founding');
      assert(s.economy.students === 120, 'founding 120');
      s.economy.pool = 700;
      s.calendar.day = BSU.dateToDay('Jan 10', 1);
      springLock(s);
      assert(s.economy.students === 176, 'Jan 10 spring lock → 176 (got ' + s.economy.students + ')');
      s.calendar.day = BSU.dateToDay('Feb 5', 1);
      const before = recorded.length;
      rollingRound(s);
      assert(s.economy.students === 210, 'Feb 5 → 210 (got ' + s.economy.students + ')');
      const roundEv = recorded.slice(before).filter(function (r) { return r.name === EV.ENROLL_ROUND; });
      assert(roundEv.length === 1 && roundEv[0].payload.kind === 'rolling' && roundEv[0].payload.students === 210, 'one enroll:round{rolling} after the count changed');
      s.calendar.day = BSU.dateToDay('Mar 5', 1);
      rollingRound(s);
      assert(s.economy.students === 237, 'Mar 5 → 237 (got ' + s.economy.students + ')');
      // 2. tuitionFactor
      const tf = function (t) { return applicantFactors(s, t).tuitionFactor; };
      assert(Math.abs(tf(6500) - 1.0) < 1e-9 && Math.abs(tf(3000) - 1.35) < 1e-9 && Math.abs(tf(12000) - 0.45) < 1e-9, 'tuitionFactor 1.0 / 1.35 / 0.45');
      // 3. prestige target (attendance mean 0.5 ⇒ the neutral ×1.0 factor of the worked number)
      s.economy.students = 120; s.economy.happiness = 60; s.economy.prestige = 10;
      s.economy.attendanceCycles = [0.5];
      const pt = prestigeTarget(s);
      assert(Math.abs(pt.target - 31.96) < 1e-6, 'prestige target 31.96 (got ' + pt.target + ')');
      s.economy.attendanceCycles = [];
      const ptFull = prestigeTarget(s);
      assert(Math.abs(ptFull.target - 32.84) < 1e-6, 'prestige target 32.84 at full attendance (got ' + ptFull.target + ')');
      s.economy.attendanceCycles = [0.5];
      monthlyPrestige(s);
      assert(Math.abs(s.economy.prestige - 11.3176) < 1e-6, 'lerp 10 → 11.3176 (got ' + s.economy.prestige + ')');
      s.economy.prestige = 10;
      // 4. happiness raw (on a date outside every festival window)
      s.calendar.day = BSU.dateToDay('Jan 8', 1);
      s.economy.suspendCapPenalties = true;
      assert(happinessRaw(s).raw === 66, 'happiness raw 66 in the first minute (got ' + happinessRaw(s).raw + ')');
      s.economy.suspendCapPenalties = false;
      stubStats.beds = 100; s.tick++;   // 120 students, 100 beds, 300 seats: the −10 without crowding (tick++ busts the per-tick stats cache)
      assert(happinessRaw(s).raw === 56, 'happiness raw 56 with beds < students (got ' + happinessRaw(s).raw + ')');
      stubStats.beds = 300; s.tick++;
      // 5. attrition
      s.economy.students = 1000; s.economy.happiness = 60;
      assert(attrition(s) === 52 && s.economy.students === 948, 'attrition 1000 → −52');
      s.economy.students = 62;
      attrition(s);
      assert(s.economy.students === 60, 'attrition floor at 60 (got ' + s.economy.students + ')');
      // 6. salaries / utilities
      s.economy.students = 1000; s.economy.quality = 'elite';
      s.ledger.month.expense.salaries = 0; s.ledger.month.expense.utilities = 0;
      const tenBuildings = []; for (let i = 0; i < 10; i++) tenBuildings.push({ id: i, type: 'lecture_hall', built: 1, hp: 1 });
      M._deps.buildings.list = function (st, type) { return type ? [] : tenBuildings; };
      s.calendar.day = BSU.dateToDay('Jul 1', 1);
      monthlyCharges(s, 7);
      assert(s.ledger.month.expense.salaries === 720000, 'salaries 720,000 (got ' + s.ledger.month.expense.salaries + ')');
      assert(s.ledger.month.expense.utilities === 16500, 'utilities July 16,500 (got ' + s.ledger.month.expense.utilities + ')');
      M._deps.buildings.list = function () { return []; };
      s.economy.quality = 'basic';
      // 7. ledger post/charge/close
      const start = s.economy.cash;
      M.post(s, 'tuition', 100);
      M.charge(s, 50, 'upkeep', { force: true });
      assert(s.economy.cash === start + 50 && s.ledger.month.income.tuition === 100, 'post/charge move cash');
      closeMonth(s);
      assert(s.ledger.last.income.tuition === 100 && s.ledger.month.income.tuition === 0 && INC.every(function (k) { return s.ledger.month.income[k] === 0; }) && EXP.every(function (k) { return s.ledger.month.expense[k] === 0; }), 'monthly close moves to last and zeroes every key');
      // 8. canAfford
      s.economy.cash = 0;
      assert(M.canAfford(s, 2000000) === true && M.canAfford(s, 2000001) === false, 'canAfford at the loan line');
      assert(M.charge(s, 2000001, 'construction') === false && s.economy.cash === 0, 'construction cannot cross the loan line');
      // 9. state funding
      s.economy.students = 496; s.economy.prestige = 14; eco.value = 80; s.economy.cash = 0;
      assert(stateFunding(s) === 882880 && s.ledger.month.income.state === 882880, 'state funding 882,880');
      // 10. runway
      s.economy.cash = 1000000;
      for (const k of EXP) s.ledger.last.expense[k] = 0;
      s.ledger.last.expense.salaries = 300000;
      s.calendar.day = BSU.dateToDay('May 6', 1);
      let rw = M.runway(s);
      assert(rw.months === 3 && rw.nextPayDay === BSU.dateToDay('Aug 5', 1) && rw.red === false, 'runway 3 months to Aug 5 (got ' + JSON.stringify(rw) + ')');
      s.economy.cash = 500000;
      rw = M.runway(s);
      assert(rw.red === true, 'runway red when cash < burn × days-to-payday/10');
      // 11. HAPPY_IDS accepted; unknown reported; -1 counted active on day 10,000
      timers.length = 0;
      for (const id of HAPPY_IDS) timers.push({ id: id, value: 1, untilDay: -1 });
      timers.push({ id: 'notARealTimer', value: 99, untilDay: -1 });
      s.calendar.day = 10000;
      const hr = happinessRaw(s);
      assert(hr.unknown.length === 1 && hr.unknown[0] === 'notARealTimer', 'unknown timer id reported, not thrown');
      let sumEvents = 0; for (const id of HAPPY_IDS) sumEvents += num(hr.terms[id], 0);
      assert(sumEvents === HAPPY_IDS.length, 'every HAPPY_IDS timer counted (untilDay -1 active on day 10,000)');
      assert(M.modifiers(s).length === HAPPY_IDS.length, 'modifiers() lists the active happiness rows');
      notes.push('unknown timer ids seen: ' + hr.unknown.join(','));
      timers.length = 0;
      s.calendar.day = 0;
      // 12. addStudents emits exactly one econ:stat{students} and no enroll:*
      const b12 = recorded.length;
      M.addStudents(s, 30, 'pirogue');
      const ev12 = recorded.slice(b12);
      assert(ev12.length === 1 && ev12[0].name === EV.ECON_STAT && ev12[0].payload.stat === 'students' && ev12[0].payload.delta === 30, 'addStudents → one econ:stat{students}, no enroll:*');
      // extra: no NaN anywhere after the exercise; timer helpers; applyCard money
      assert(!/NaN|Infinity/.test(JSON.stringify(s.economy)) && !/NaN|Infinity/.test(JSON.stringify(s.ledger)), 'no NaN/Infinity in economy/ledger');
      M._deps.progress.addTimer(s, 'lobby', 0.10, -1);
      assert(M.timerValue(s, 'lobby') === 0.10 && M.consumeTimer(s, 'lobby') === 0.10 && M.timerValue(s, 'lobby') === 0, 'timerValue/consumeTimer');
      s.economy.cash = 1000000; s.economy.tuition = 6500;
      M.applyCard(s, 'hike');
      assert(s.economy.tuition === 9500, 'hike +3000');
      M.applyCard(s, 'marshGrant');
      assert(s.economy.cash === 1300000, 'marsh grant +300k');
      assert(M.setTuition(s, 7010) === true && s.economy.tuition === 7000, 'setTuition snaps to the step');
      // the §5.7 five-year projection
      const proj = runProjection();
      notes.push(proj.note);
      for (const f of proj.failures) assert(false, f);
      notes.push('selfTest ' + (Date.now() - started) + ' ms');
    } catch (e) {
      return { ok: false, notes: (e && e.message) || String(e) };
    } finally {
      for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete M._deps[k]; else M._deps[k] = saved[k]; }
      lastDay = savedClosure.lastDay; pendingAttendance = savedClosure.pendingAttendance; reportQueue = savedClosure.reportQueue;
      lastHappyShown = savedClosure.lastHappyShown; lastEcoShown = savedClosure.lastEcoShown; statsCache = savedClosure.statsCache;
    }
    return { ok: true, notes: notes.join('; ') };
  };

  // ---------------------------------------------------------------------------
  // The §5.7 five-year projection: a scripted competent build order against a
  // private state, with stubbed buildings/sports/progress. Used by selfTest and
  // exposed as M._projection() for the unit test. Every year's income and
  // operating cost must land within ±30% of the §5.7 table; the ratio band
  // (operating 30–70% of income), monotone income and the loan line are also
  // asserted (see INTEGRATION_NOTES for the numbers the formulas produce).
  // ---------------------------------------------------------------------------
  function runProjection() {
    const failures = [];
    const timers = [];
    const s = BSU.newState(3);
    s.economy.suspendCapPenalties = false;
    s.economy.suppressCoverage = false;
    const built = [];   // scripted fake buildings
    let nextId = 0;
    const D = BSU.data;
    const cat = D && D.catalog;
    const add = function (type, tier) {
      const row = cat ? cat[type] : null;
      const b = { id: nextId++, type: type, tx: 50, ty: 7, w: 2, h: 2, built: 1, builtDay: today(s), hp: 1, ruin: false, flooded: false, blackout: false, tier: tier || 0, data: { policies: {} }, name: type };
      built.push(b);
      return row;
    };
    const sports = { hasTeam: false, record: { wins: 0, losses: 0 }, lastSeason: { wins: 0, losses: 0, bowlWon: false }, venue: 'none', permits: 'paid', clubOnly: false };
    let homeWins = 0;
    const mkStats = function () {
      const st = { beds: 0, seats: 0, feeds: 0, diningCovered: 1, landmarks: 0, oaks: 0, cypress: 0, stockedPonds: 0, posts: 0, quality: 0, lots: 0, unrepaired: 0, floodedCore: false, brownout: false, pumpsRunning: 0, generatorsRunning: 0, roadAdjacentDorms: 0, pumpsNearDorms: 0, barriersNearDorms: 0, floodwallDormsNoOak: 0, wastewaterPlants: 0, parkingLots: 0, bridges: 0, academicFlags: { library: false, engineering: false, coastal: false } };
      let qBeds = 0;
      for (const b of built) {
        const row = cat[b.type]; if (!row) continue;
        const e = row.effects;
        st.beds += e.beds; st.seats += e.seats; st.feeds += e.feeds; st.landmarks += e.landmark;
        if (e.beds) { qBeds += e.beds * e.quality; }
        if (b.tier > 0 && row.tiers[b.tier - 1]) { st.landmarks += row.tiers[b.tier - 1].landmark; }
        if (b.type === 'parking') st.lots++;
        if (b.type === 'wastewater') st.wastewaterPlants++;
        if (b.type === 'pump') st.pumpsRunning++;
        if (b.type === 'quad' || b.type === 'live_oak') st.oaks++;
        if (b.type === 'library') st.academicFlags.library = true;
        if (b.type === 'engineering') st.academicFlags.engineering = true;
        if (b.type === 'coastal_institute') st.academicFlags.coastal = true;
      }
      st.quality = st.beds ? qBeds / st.beds : 0;
      return st;
    };
    const upkeepTotal = function () {
      let u = 0;
      for (const b of built) { const row = cat[b.type]; if (!row) continue; u += (b.tier > 0 && row.tiers[b.tier - 1]) ? row.tiers[b.tier - 1].upkeep : row.upkeep; }
      return u;
    };
    const depsBackup = {};
    for (const k of ['emit', 'buildings', 'agents', 'wildlife', 'sports', 'progress', 'weather']) depsBackup[k] = M._deps[k];
    const closureBackup = { lastDay: lastDay, pendingAttendance: pendingAttendance, reportQueue: reportQueue, lastHappyShown: lastHappyShown, lastEcoShown: lastEcoShown, statsCache: statsCache };
    const yearRows = [];
    let note = '';
    try {
      M._deps.emit = function () {};
      M._deps.progress = {
        timers: function () { return timers; },
        timer: function (st, id) { for (const t of timers) if (t.id === id) return t; return null; },
        addTimer: function (st, id, value, days, meta) { const until = (days === Infinity || days < 0) ? -1 : today(st) + days; for (const t of timers) if (t.id === id) { t.value = value; t.untilDay = until; return; } timers.push({ id: id, value: value, untilDay: until, meta: meta }); },
        removeTimer: function (st, id) { for (let i = timers.length - 1; i >= 0; i--) if (timers[i].id === id) timers.splice(i, 1); },
        offerBoard: function () {}, ticker: function () {}, reportUnderwater: function () {}, receiverActive: function () { return false; }
      };
      M._deps.buildings = {
        stats: mkStats, upkeepTotal: upkeepTotal,
        list: function (st, type) { return type ? built.filter(function (b) { return b.type === type; }) : built.slice(); },
        has: function (st, type) { return built.some(function (b) { return b.type === type; }); },
        count: function (st, type) { return built.filter(function (b) { return b.type === type; }).length; },
        effective: function () { return 1; }, rename: function () {}, place: function () { return { ok: false }; }
      };
      M._deps.agents = { sample: function () { return { life: 4, green: 3, mosq: 0.1, heat: 1, n: 40 }; }, classAttendance: function () { return 0.85; } };
      M._deps.wildlife = { mosqIndex: function () { return 0.1; }, ecology: function () { return 78; }, ecologyTerms: function () { return {}; }, sickToday: function () { return 0; }, gatorPenalty: function () { return 0; } };
      M._deps.sports = { season: function () { return sports; }, homeWinsThisSeason: function () { return homeWins; } };
      M._deps.weather = { storm: function () { return null; } };
      M.reset(s, true);
      M.addStudents(s, 120, 'founding');
      add('founders_hall');
      // scripted build order: [dayOfGame, type, tier?]; charged like buildings.place (construction), retried until affordable
      const script = [
        [3, 'dorm'], [3, 'dining_hall'], [5, 'substation'], [5, 'water_tower'], [12, 'pump'], [12, 'canal8'],
        [25, 'lecture_hall'], [28, 'dorm'], [40, 'quad'], [40, 'oaks5'], [42, 'poboy'], [55, 'levee16'], [58, 'practice_field'],
        [66, 'practice_field', 1], [80, 'parking'], [95, 'gator_fence6'], [100, 'wildlife_post'],
        // Year 2
        [125, 'union'], [140, 'library'], [150, 'res_tower'], [165, 'lecture_hall'], [180, 'pump'], [190, 'dorm'], [200, 'stadium', 1], [215, 'parking'], [225, 'health_center'],
        // Year 3
        [245, 'stadium', 2], [270, 'engineering'], [275, 'wastewater'], [290, 'dorm'], [300, 'res_tower'], [310, 'lecture_hall'], [330, 'dining_hall'], [345, 'floodwall10'],
        // Year 4
        [365, 'coastal_institute'], [380, 'bell_tower'], [395, 'tiger_habitat'], [400, 'res_tower'], [410, 'lecture_hall'], [420, 'floodwall10'], [430, 'res_tower'], [440, 'lecture_hall'], [455, 'dining_hall'], [470, 'parking'],
        // Year 5
        [485, 'res_tower'], [495, 'lecture_hall'], [505, 'res_tower'], [515, 'lecture_hall'], [525, 'dining_hall'], [535, 'rec_center'], [545, 'marsh_restoration'], [560, 'greek_house'], [570, 'lecture_hall'], [580, 'parking']
      ];
      const dragCost = { canal8: ['canal', 8], oaks5: ['live_oak', 5], levee16: ['levee', 16], gator_fence6: ['gator_fence', 6], floodwall10: ['floodwall', 10] };
      const pending = script.slice();
      const homeDates = ['Aug 8', 'Sep 8', 'Oct 8', 'Nov 8'];
      const grantDays = [2, 6, 10, 14, 18, 22, 26, 62, 66, 70];
      const target = { income: [8.3e6, 17.0e6, 25.0e6, 43.5e6, 73.0e6], operating: [3.6e6, 8.3e6, 12.5e6, 20.9e6, 33.5e6], students: [690, 1500, 1900, 3570, 5250] };
      let yearIncome = 0, yearOperating = 0, yearConstruction = 0;
      const ticksPerDay = 10;   // enough for the EMA to move; the sim clock is otherwise irrelevant here
      for (let day = 1; day < 5 * DAYS_PER_YEAR; day++) {   // through Dec 10 of Year 5; the Year-5 row is pushed after the loop
        s.calendar.day = day;
        const pr = BSU.dayParts(day);
        const flags = { newDay: true, newMonth: pr.dom === 1, newYear: day % DAYS_PER_YEAR === 0, day: day };
        const incBefore = s.ledger.year.income, expBefore = s.ledger.year.expense, conBefore = s.ledger.year.construction;
        if (flags.newYear) {
          // capture the completed year (yearlyStep resets ledger.year inside tick)
          yearRows.push({ year: pr.year - 1, income: incBefore, operating: expBefore - conBefore, construction: conBefore, students: s.economy.students, cash: s.economy.cash, prestige: Math.round(s.economy.prestige * 10) / 10, happiness: Math.round(s.economy.happiness) });
        }
        // scripted "progress" grants (Objectives 1–7, 9, 10, 11) and "sports" revenue
        if (grantDays.indexOf(day) >= 0) M.post(s, 'grants', PE.grant, { note: 'Legislature approves' });
        if (sports.hasTeam && sports.venue !== 'none' && homeDates.indexOf(pr.date) >= 0 && pr.date !== 'Sep 8') {
          const seats = sports.venue === 'stadium2' ? 45000 : sports.venue === 'stadium1' ? 15000 : 6000;
          const fanbase = s.economy.students * P.sports.fanbase.students + s.economy.alumni * P.sports.fanbase.alumni + s.economy.prestige * P.sports.fanbase.prestige;
          const won = (homeWins + sports.record.losses) % 3 !== 2;   // ~2 of 3 home games won, deterministic
          const att = Math.floor(Math.min(seats, fanbase * (0.7 + 0.4 * 0.6)));
          M.post(s, 'athletics', att * (s.economy.ticket + PE.concessions));
          M.post(s, 'tailgate', P.sports.tailgatePer * att);
          if (won) { homeWins++; sports.record.wins++; } else sports.record.losses++;
        }
        if (pr.date === 'Dec 9') { sports.lastSeason = { wins: sports.record.wins, losses: sports.record.losses, bowlWon: false }; sports.record = { wins: 0, losses: 0 }; homeWins = 0; }
        if (pr.date === P.sports.schedule.opener && sports.hasTeam) { sports.record.wins += 1; }   // one away win a season for buzz
        // the Célestine repair bill (Year 1 Sep 8 landfall, ~$200k) and its disaster grant
        if (day === BSU.dateToDay('Sep 8', 1)) { M.charge(s, 200000, 'repair', { force: true }); s.storms.lastLandfallDay = day; reportQueue.push({ bill: 200000 }); }
        // scripted placements
        for (let i = 0; i < pending.length; i++) {
          const item = pending[i];
          if (item[0] > day) continue;
          let type = item[1], tier = item[2] || 0, cost = 0;
          if (dragCost[type]) { const dc = dragCost[type]; cost = cat[dc[0]].cost * dc[1]; }
          else if (tier > 0) cost = cat[type].tiers[tier - 1].cost;
          else cost = cat[type].cost;
          if (!M.charge(s, cost, 'construction')) continue;   // wait for cash (a competent player)
          if (dragCost[type]) { /* drag tiles: upkeep only */ }
          else if (tier > 0) { const ex = built.find(function (b) { return b.type === type && b.tier === tier - 1; }); if (ex) ex.tier = tier; else add(type, tier); if (type === 'practice_field') sports.venue = 'bayou_field'; if (type === 'stadium') sports.venue = 'stadium' + tier; }
          else { add(type); if (type === 'practice_field') sports.hasTeam = true; }
          pending.splice(i, 1); i--;
        }
        for (let t = 0; t < ticksPerDay; t++) { M.tick(s, t === 0 ? flags : { newDay: false, newMonth: false, newYear: false, day: day }); s.tick++; }
        if (!(s.economy.students >= 60)) failures.push('students fell below 60 on day ' + day);
        if (!(s.economy.prestige >= 0 && s.economy.prestige <= 100)) failures.push('prestige out of bounds on day ' + day);
        if (!isFinite(s.economy.cash)) { failures.push('cash not finite on day ' + day); break; }
      }
      // the fifth year (no Jan 1 of Year 6 in the loop)
      yearRows.push({ year: 5, income: s.ledger.year.income, operating: s.ledger.year.expense - s.ledger.year.construction, construction: s.ledger.year.construction, students: s.economy.students, cash: s.economy.cash, prestige: Math.round(s.economy.prestige * 10) / 10, happiness: Math.round(s.economy.happiness) });
      const fmt = function (v) { return BSU.formatMoney(v); };
      const lines = yearRows.map(function (r) { return 'Y' + r.year + ' students ' + r.students + ' income ' + fmt(r.income) + ' operating ' + fmt(r.operating) + ' construction ' + fmt(r.construction) + ' cash ' + fmt(r.cash) + ' prestige ' + r.prestige; });
      note = 'projection: ' + lines.join(' | ');
      // documented bands: every year's income and operating cost within ±30% of the §5.7 table
      for (let y = 0; y < target.income.length; y++) {
        const r = yearRows[y];
        if (!r) { failures.push('projection missing year ' + (y + 1)); continue; }
        const ti = target.income[y], to = target.operating[y];
        if (!(r.income >= ti * 0.7 && r.income <= ti * 1.3)) failures.push('Y' + (y + 1) + ' income ' + fmt(r.income) + ' outside ±30% of ' + fmt(ti));
        if (!(r.operating >= to * 0.7 && r.operating <= to * 1.3)) failures.push('Y' + (y + 1) + ' operating ' + fmt(r.operating) + ' outside ±30% of ' + fmt(to));
      }
      // every year: operating cost between 30% and 70% of income (the GDD's 45–55% with headroom), income never shrinks, cash never below the loan line minus one year of forced charges
      for (let y = 0; y < yearRows.length; y++) {
        const r = yearRows[y];
        const ratio = r.income > 0 ? r.operating / r.income : 1;
        if (!(ratio >= 0.3 && ratio <= 0.7)) failures.push('Y' + (y + 1) + ' operating/income ratio ' + ratio.toFixed(2) + ' outside 0.3–0.7');
        if (y > 0 && !(r.income >= yearRows[y - 1].income)) failures.push('Y' + (y + 1) + ' income shrank');
        if (!(r.cash >= -PE.loanLimit - r.operating)) failures.push('Y' + (y + 1) + ' cash ' + fmt(r.cash) + ' below the loan line by more than a year of operating cost');
      }
      if (/NaN|Infinity/.test(JSON.stringify(s.economy)) || /NaN|Infinity/.test(JSON.stringify(s.ledger))) failures.push('NaN/Infinity in economy/ledger after the projection');
    } catch (e) {
      failures.push('projection threw: ' + ((e && e.stack) || e));
    } finally {
      for (const k of Object.keys(depsBackup)) { if (depsBackup[k] === undefined) delete M._deps[k]; else M._deps[k] = depsBackup[k]; }
      lastDay = closureBackup.lastDay; pendingAttendance = closureBackup.pendingAttendance; reportQueue = closureBackup.reportQueue;
      lastHappyShown = closureBackup.lastHappyShown; lastEcoShown = closureBackup.lastEcoShown; statsCache = closureBackup.statsCache;
    }
    return { failures: failures, note: note, years: yearRows };
  }
  M._projection = runProjection;   // for test/unit/economy.test.mjs
})();
