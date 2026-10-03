'use strict';
// ============================================================================
// BAYOU STATE — weather.js (module 4) → BSU.weather
// Owner of: state.calendar, state.sky, state.weather, state.storms.
// Implements: GDD §0.1 (timing), §6.1.2 (rain table), §6.2 (hurricane lifecycle,
// landfall timeline, toasts, surge control hand-off, storm names), §6.6 (heat),
// §6.9 (Spring High Water), §9 (calendar, sky clock, seasons, weather generator),
// §10.3 (Célestine hold rule), §10.4 (rain suppression), §14.3 (festival dates);
// ARCHITECTURE.md §2.4–§2.5, §5.1 steps 0–1, §5.4, D4, D5, D13, D14, D22, D37,
// D41, D43, D51.
//
// weather.tick runs FIRST every sim tick: it advances the sky cycle, rolls the
// calendar when it is not frozen (emitting the day/month/semester/year/date
// events before returning), writes state.weather.dtDay for this tick's hydro
// step, runs the daily steps on a new day (heat, wind, fog, rain scheduler,
// river stage, festivals, storm lifecycle), drives drifting thunderstorm cells,
// the compressed (tick-driven) storm lifecycle, the landfall / near-miss set-piece
// timelines and the four decision-toast timeouts.
//
// Zero DOM / timer / audio access at definition time. All simulation randomness
// goes through BSU.rng.sim. Every emit goes through M._deps.emit (§10.6). No
// state is mirrored on the module object (D46).
// ============================================================================
(function () {
  const BSU = window.BSU;
  const M = (BSU.weather = BSU.weather || {});
  const P = BSU.params;
  const PT = P.time, PW = P.weather, PS = P.storm, PH = P.heat, PR = P.hydro.rain, PHY = P.hydro;
  const SKY = BSU.SKY, SKY_TICKS = BSU.SKY_TICKS, STORM = BSU.STORM, SPH = BSU.STORM_PHASE, EV = BSU.EV;
  const R = BSU.rng.sim;
  const TPD = PT.ticksPerDay;        // 100
  const DPY = PT.daysPerYear;        // 120
  const CYCLE = PT.skyCycleTicks;    // 300
  const W = BSU.MAP.W, H = BSU.MAP.H;

  // Constants the GDD states but BSU.params does not carry (noted in INTEGRATION_NOTES.md).
  const LC = {
    rainRate: { shower: 0.25, frontal: 0.4, cell: 1, band: 0.6, hurricane: 1 },   // FX rate per kind (brief §4 rain scheduler)
    rainOuterStart: 0.33,                       // landfall: rainRate 0.33 → 1 over the outer bands
    cellBox: { x0: 4, x1: 24, y0: 40, y1: 60 }, // random cell spawn box: the south-west third
    lightningEveryBack: 60,                     // back-half lightning cadence (ticks); GDD is silent
    windWatch: 0.4, windEye: 0.1, windBack: 0.7, windClearing: 0.3,   // storm wind schedule (brief §4 wind)
    windAngleSouth: Math.PI / 2, windAngleEast: 0, windAngleJitter: 0.3,
    trackPoints: 6,                             // cone track sample count
    seasonEndYd: 109,                           // 'Nov 30' does not exist in 10-day months: the season closes after Nov 10 (yd 109)
    riverTickerYd: 29,                          // 'Mar 25' does not parse: the ticker fires on Mar 10 (yd 29), the last spring day before Apr 1
    holdText: 'Hurricane Célestine forms off-season. The Gulf did not check the calendar.',
    riverText: 'The Big Muddy is at {stage} ft and rising. Levee Board ‘monitoring.’',
    gateCaughtText: 'Gate crew caught by the back half. Crew describes the floodgate as "cleared" and the walk back as "moist."',
    gateClearText: 'Gate crew clears the jammed floodgate between the bands. Crew requests hazard pay in gumbo.',
    reservedNames: 3,                           // Year-1 script owns stormNames[0..2]; random storms start at index 3
    nearMissSteps: 60,                          // band steps of the near-miss pass (150 ticks at 4 hydro steps per 10 ticks)
    skipHydroTicks: 90                          // skipSetPiece: hydro.tick calls that approximate the surge
  };
  // Cumulative sky phase boundaries (25, 155, 175, 200, 300).
  const SKY_CUM = (function () { const out = []; let a = 0; for (let i = 0; i < SKY_TICKS.length; i++) { a += SKY_TICKS[i]; out.push(a); } return out; })();

  // ---------------------------------------------------------------------------
  // Dependencies (injectable for selfTest, §10.6) and small helpers
  // ---------------------------------------------------------------------------
  M._deps = { emit: function (name, payload) { BSU.events.emit(name, payload); } };
  /** Resolve a sibling module: an explicit stub in M._deps wins; otherwise the live BSU.<name>. */
  function dep(name) { const d = M._deps[name]; return d !== undefined ? d : BSU[name]; }
  function emit(name, payload) { M._deps.emit(name, payload); }
  function data() { return BSU.data || {}; }
  function fin(v, fallback) { return (typeof v === 'number' && isFinite(v)) ? v : fallback; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  /** The tick at which a storm's landfall fires when day-driven and unknown: -1 (never Infinity). */
  const NONE = -1;
  /** Weighted pick over an array of weights (rng.sim); returns the index. */
  function pickWeighted(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
    let r = R.float() * total;
    for (let i = 0; i < weights.length; i++) { r -= Math.max(0, weights[i]); if (r < 0) return i; }
    return weights.length - 1;
  }
  /** progress.ticker wrapper (no-throw). textOrLine: a §14.4 line number or raw text. */
  function ticker(state, textOrLine, fields, kind, subject) {
    const pr = dep('progress');
    if (!pr || typeof pr.ticker !== 'function') return;
    try { pr.ticker(state, textOrLine, fields || {}, kind, subject); } catch (e) { BSU.error('weather', 'ticker', e); }
  }
  /** Guarded call of a sibling module's function: returns undefined when absent, routes throws to BSU.error. */
  function call(modName, fnName) {
    const mod = dep(modName);
    if (!mod || typeof mod[fnName] !== 'function') return undefined;
    const args = Array.prototype.slice.call(arguments, 2);
    try { return mod[fnName].apply(mod, args); } catch (e) { BSU.error('weather', modName + '.' + fnName, e); return undefined; }
  }

  // ---------------------------------------------------------------------------
  // Private per-game bookkeeping (closure; rebuilt in reset; never saved)
  // ---------------------------------------------------------------------------
  let S = null;      // the root this module is bound to
  let pv = null;     // private bookkeeping for that root
  function freshPrivate() {
    return {
      lastDay: -1,               // last calendar day seen by tick
      nextHookIdx: 0,            // landfall timeline cursor (sorted hook table)
      toastsOpened: {},          // id → untilTick of an open toast (timeout enforcement)
      choicesFallback: {},       // toast answers when no set piece exists (debug _openToast)
      fogTicksLeft: 0,           // fog countdown
      fogRoll: false,            // today's fog draw (applies at the next Dawn)
      rainedToday: false,        // an event was active at some tick today
      rainedYesterday: false,    // heat +3 rule
      lastStage: { river: -1, bayou: -1 },   // last stages handed to hydro (setStages once per change)
      surgeBegun: false,         // surgeControl('begin') issued for the current set piece
      novDecRainDays: 0          // previous Nov–Dec rain days (Spring High Water wet bonus, counted before the Jan 1 redraw)
    };
  }
  /** Bind the module to a root (self-healing: a query on a root we have not seen rebuilds the caches). */
  function rebind(state) {
    S = state;
    pv = freshPrivate();
    if (state && state.calendar) pv.lastDay = state.calendar.day;
    if (state && state.storms) {
      if (state.storms.t1BandDay === undefined) state.storms.t1BandDay = NONE;   // lazily initialized (saved)
      if (!Array.isArray(state.storms.scheduled)) state.storms.scheduled = [];
      if (!Array.isArray(state.storms.log)) state.storms.log = [];
      if (!state.storms.celestine) state.storms.celestine = { state: 'pending', coneDay: NONE };
    }
    if (state && state.weather) {
      if (!Array.isArray(state.weather.rainDays)) state.weather.rainDays = [];
      if (!Array.isArray(state.weather.cellQueue)) state.weather.cellQueue = [];
    }
    if (state && state.weather) pv.fogTicksLeft = state.weather.fog > 0 ? PW.fogTicks : 0;
    // A load mid-landfall: hooks already passed must not re-fire (they fire only at their exact tick).
    if (state && state.setPiece && state.setPiece.kind === 'landfall') {
      const t = fin(state.setPiece.tick, 0);
      let k = 0;
      while (k < HOOKS.length && HOOKS[k].tick < t) k++;
      pv.nextHookIdx = k;
      pv.surgeBegun = t >= PS.rollsTick;
    }
  }

  // ---------------------------------------------------------------------------
  // Calendar
  // ---------------------------------------------------------------------------
  /** Absolute day of 'Mon D' in the given 1-based year; -1 when the string does not parse (never NaN). */
  function dayOfDate(str, year) {
    const d = BSU.dateToDay(str, year);
    return Number.isFinite(d) ? d : NONE;
  }
  function yearStartOf(day) { return Math.floor(day / DPY) * DPY; }
  /** Write year/month/dom/season/semester from calendar.day (agrees with BSU.dayParts, §3.7). */
  function deriveCalendar(cal) {
    const p = BSU.dayParts(cal.day);
    cal.year = p.year; cal.month = p.month; cal.dom = p.dom; cal.season = p.season; cal.semester = p.semester;
    return p;
  }

  // ---------------------------------------------------------------------------
  // Sky clock (D5)
  // ---------------------------------------------------------------------------
  function phaseOfCycle(cycleTick) {
    let c = ((cycleTick % CYCLE) + CYCLE) % CYCLE, p = 0;
    while (p < SKY_TICKS.length - 1 && c >= SKY_TICKS[p]) { c -= SKY_TICKS[p]; p++; }
    return { phase: p, phaseTick: c };
  }
  /** Recompute phase/phaseTick/t from cycleTick and emit sky:phase on a change. */
  function applyCycle(state) {
    const sky = state.sky;
    const r = phaseOfCycle(sky.cycleTick);
    const prev = sky.phase;
    sky.phase = r.phase; sky.phaseTick = r.phaseTick; sky.t = r.phaseTick / SKY_TICKS[r.phase];
    if (r.phase !== prev) onPhaseChange(state, r.phase, prev);
  }
  function advanceSky(state) {
    const sky = state.sky;
    if (sky.scripted) return;
    sky.cycleTick = (fin(sky.cycleTick, 0) + 1) % CYCLE;
    applyCycle(state);
  }
  function onPhaseChange(state, phase, prev) {
    emit(EV.SKY_PHASE, { phase: phase, prev: prev });
    // Fog: 40% of Dawns in Nov–Feb (the roll is made in the daily step; it applies at the next Dawn).
    if (phase === SKY.DAWN && pv.fogRoll && state.weather.clearNightDay !== state.calendar.day) {
      state.weather.fog = 1;
      pv.fogTicksLeft = PW.fogTicks;
      pv.fogRoll = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Rain scheduler (GDD §9.3, §6.1.2)
  // ---------------------------------------------------------------------------
  function isCellMonth(month) { return month >= PW.cellMonths[0] && month <= PW.cellMonths[1]; }
  /** Draw the rain days of the year containing `day` (rng.sim). */
  function drawRainDays(state, day) {
    const y0 = yearStartOf(day);
    const out = [];
    for (let yd = 0; yd < DPY; yd++) {
      const month = Math.floor(yd / PT.daysPerMonth) % PT.monthsPerYear + 1;
      if (!R.chance(PW.rainP[month - 1])) continue;
      let kind;
      if (isCellMonth(month)) kind = 'cell';
      else kind = R.chance(PW.frontalShare) ? 'frontal' : 'shower';
      out.push({ day: y0 + yd, kind: kind });
    }
    state.weather.rainDays = out;
  }
  function rainDayFor(state, day) {
    const rd = state.weather.rainDays;
    if (!Array.isArray(rd)) return null;
    for (let i = 0; i < rd.length; i++) if (rd[i] && rd[i].day === day) return rd[i];
    return null;
  }
  /** Start a map-wide event (shower/frontal/band/hurricane). Ends any active event first. */
  function startMapWide(state, kind, total, steps, scripted) {
    endEvent(state);
    state.weather.event = { kind: kind, total: total, steps: steps, stepsLeft: steps, cx: -1, cy: -1, radius: 0, lightning: false, scripted: !!scripted };
    emit(EV.WEATHER_RAIN, { kind: kind, total: total, start: true });
  }
  function startBand(state) { startMapWide(state, 'band', PR.band, PR.mapWideSteps, false); }
  /** End the active event (weather:rain start:false). */
  function endEvent(state) {
    const ev = state.weather.event;
    if (!ev) return;
    state.weather.event = null;
    emit(EV.WEATHER_RAIN, { kind: ev.kind, total: ev.total, start: false });
  }
  /** Start a queued cell now. */
  function startCell(state, q) {
    const lightning = q.scripted ? true : R.chance(PW.lightningP);
    state.weather.event = {
      kind: 'cell', total: q.total, steps: PR.cellSteps, stepsLeft: PR.cellSteps,
      cx: clamp(Math.round(fin(q.cx, W / 2)), 0, W - 1), cy: clamp(Math.round(fin(q.cy, H / 2)), 0, H - 1),
      radius: PR.cellRadius, lightning: lightning, scripted: !!q.scripted
    };
    emit(EV.WEATHER_CELL, { cx: state.weather.event.cx, cy: state.weather.event.cy, radius: PR.cellRadius, total: q.total, scripted: !!q.scripted });
    emit(EV.WEATHER_RAIN, { kind: 'cell', total: q.total, start: true });
  }
  /** Daily: draw today's rain (map-wide event now, or a cell queued for the afternoon). */
  function dailyRain(state) {
    const w = state.weather, day = state.calendar.day;
    // Drop cells queued for the suppressed day.
    if (w.clearNightDay === day) { w.cellQueue = w.cellQueue.filter(function (q) { return q && q.day !== day; }); }
    const rd = rainDayFor(state, day);
    if (!rd || w.clearNightDay === day || w.event) return;
    if (rd.kind === 'shower') startMapWide(state, 'shower', PR.shower, PR.mapWideSteps, false);
    else if (rd.kind === 'frontal') startMapWide(state, 'frontal', PR.frontal, PR.mapWideSteps, false);
    else {
      const cx = LC.cellBox.x0 + R.int(LC.cellBox.x1 - LC.cellBox.x0 + 1);
      const cy = LC.cellBox.y0 + R.int(LC.cellBox.y1 - LC.cellBox.y0 + 1);
      const inches = R.range(PR.cellMin, PR.cellMax);
      w.cellQueue.push({ day: day, cx: cx, cy: cy, total: inches / PHY.inchesPerFoot, scripted: false });
    }
  }
  /** Per tick: fire a due cell, drift the active cell, lightning, rain rate. */
  function tickRain(state) {
    const w = state.weather, sky = state.sky, day = state.calendar.day, T = state.tick;
    // Queued cells: fire when their day arrives in the second half of a Day phase (or later in the cycle),
    // immediately when their day has passed, never while another event is active.
    if (!w.event && w.cellQueue.length) {
      for (let i = 0; i < w.cellQueue.length; i++) {
        const q = w.cellQueue[i];
        if (!q || typeof q.day !== 'number') { w.cellQueue.splice(i, 1); i--; continue; }
        if (q.day === w.clearNightDay) { w.cellQueue.splice(i, 1); i--; continue; }
        if (q.day > day) continue;
        const due = q.day < day || sky.phase > SKY.DAY || (sky.phase === SKY.DAY && sky.t >= PW.cellStartPhaseFrac);
        if (!due) continue;
        w.cellQueue.splice(i, 1);
        startCell(state, q);
        break;
      }
    }
    const ev = w.event;
    if (ev) {
      pv.rainedToday = true;
      if (ev.kind === 'cell') {
        if (T % PR.cellDriftTicks === 0) { ev.cx = clamp(ev.cx + 1, 0, W - 1); ev.cy = clamp(ev.cy - 1, 0, H - 1); }   // drifts NE (+tx, −ty)
        if (ev.lightning && T % PS.lightningEveryOuter === 0) {
          const tx = clamp(ev.cx + R.int(2 * ev.radius + 1) - ev.radius, 0, W - 1);
          const ty = clamp(ev.cy + R.int(2 * ev.radius + 1) - ev.radius, 0, H - 1);
          emit(EV.WEATHER_LIGHTNING, { tx: tx, ty: ty });
        }
      }
    }
    // rainRate for FX (the landfall timeline overrides it for the hurricane event).
    const sp = state.setPiece;
    if (sp && sp.kind === 'landfall' && state.storms.current) w.rainRate = landfallRainRate(state.storms.current, fin(sp.tick, 0));
    else w.rainRate = ev ? (LC.rainRate[ev.kind] || 0) : 0;
    w.rainRate = clamp(fin(w.rainRate, 0), 0, 1);
  }

  // ---------------------------------------------------------------------------
  // Heat, wind, fog (GDD §6.6, §9.3)
  // ---------------------------------------------------------------------------
  /** One heat draw for a month (rng.sim): base + noise ±6 + 3 if it rained yesterday. */
  function drawHeat(month, rainedYesterday) {
    return Math.round(PH.monthBase[month - 1] + R.range(-PH.noise, PH.noise) + (rainedYesterday ? PH.rainAdd : 0));
  }
  function dailyHeat(state) {
    const w = state.weather;
    w.heat = drawHeat(state.calendar.month, pv.rainedYesterday);
    const advisory = w.heat >= PH.advisory;
    w.heatWaveDays = advisory ? fin(w.heatWaveDays, 0) + 1 : 0;
    emit(EV.WEATHER_HEAT, { index: w.heat, advisory: advisory, wave: w.heatWaveDays >= PH.waveDays });
  }
  function dailyWind(state) {
    const w = state.weather;
    w.wind = R.range(PW.windNormal[0], PW.windNormal[1]);
    const st = state.storms.current;
    if (st && !st.nearMiss && st.phase >= STORM.NAMED && st.phase <= STORM.LANDFALL) {
      const base = st.dir === 'E' ? LC.windAngleEast : LC.windAngleSouth;
      w.windAngle = base + R.range(-LC.windAngleJitter, LC.windAngleJitter);
    } else {
      w.windAngle = R.range(0, Math.PI * 2);
    }
  }
  function dailyFog(state) {
    const m = state.calendar.month;
    const fogMonth = m >= PW.fogMonths[0] || m <= PW.fogMonths[1];   // [11, 2] wraps the year
    pv.fogRoll = fogMonth && R.chance(PW.fogP);
    if (state.weather.clearNightDay === state.calendar.day) { pv.fogRoll = false; state.weather.fog = 0; pv.fogTicksLeft = 0; }
  }
  function tickFog(state) {
    const w = state.weather;
    if (w.clearNightDay === state.calendar.day && w.fog !== 0) { w.fog = 0; pv.fogTicksLeft = 0; }
    if (pv.fogTicksLeft > 0) { pv.fogTicksLeft--; if (pv.fogTicksLeft === 0) w.fog = 0; }
    else if (w.fog > 0) w.fog = 0;
  }

  // ---------------------------------------------------------------------------
  // Spring High Water (GDD §6.9)
  // ---------------------------------------------------------------------------
  const HW = PW.highWater;
  /** {river, bayou, window} for a calendar day (pure). */
  function stagesFor(state, day) {
    const rs = fin(state.weather.riverStage, 0);
    const cal = BSU.dayParts(day);
    const y = cal.year;
    const start = dayOfDate(HW.start, y), holdEnd = dayOfDate(HW.holdEnd, y), end = dayOfDate(HW.end, y);
    let river = 0;
    if (rs > 0 && start >= 0 && day >= start && day <= end) {
      if (day < start + HW.rampDays) river = rs * (day - start + 1) / HW.rampDays;          // Apr 1–5: 0.2, 0.4 … 1.0
      else if (day <= holdEnd) river = rs;                                                  // hold to May 5
      else river = rs * Math.max(0, 1 - (day - holdEnd) / HW.rampDays);                    // May 6–10: 0.8 … 0
    }
    river = Math.max(0, fin(river, 0));
    return { river: river, bayou: river * HW.bayouFactor, window: river > 0 };
  }
  /** Hand the day's stages to hydro (only when they changed). */
  function applyStages(state) {
    const s = stagesFor(state, state.calendar.day);
    if (s.river !== pv.lastStage.river || s.bayou !== pv.lastStage.bayou) {
      pv.lastStage.river = s.river; pv.lastStage.bayou = s.bayou;
      call('hydro', 'setStages', state, s.river, s.bayou);
    }
    return s;
  }
  function dailyRiver(state) {
    const cal = state.calendar, w = state.weather, day = cal.day;
    const yd = day % DPY;
    if (yd === 0 && cal.year >= HW.fromYear) {
      // Drawn on Jan 1 AFTER the rain days (the wet-bonus counts the previous Nov–Dec plus this Jan).
      const stage = pickWeighted(HW.stageP) + 1;
      const wet = pv.novDecRainDays + countRainDays(state, day, day + PT.daysPerMonth - 1);
      w.riverStage = Math.min(3, stage + (wet > HW.wetBonusDays ? 1 : 0));
      w.spillwayUsedYear = fin(w.spillwayUsedYear, 0);
    }
    if (cal.year < HW.fromYear) w.riverStage = 0;
    const s = applyStages(state);
    if (s.window) {
      const hy = dep('hydro');
      if (hy && typeof hy.riverAdjacent === 'function' && typeof hy.forceSat === 'function') {
        const tiles = call('hydro', 'riverAdjacent', state, PHY.seepageRadius);
        if (Array.isArray(tiles) && tiles.length) call('hydro', 'forceSat', state, tiles, PHY.seepageSat);
      }
    }
    if (yd === LC.riverTickerYd && cal.year >= HW.fromYear && w.riverStage > 0) {
      ticker(state, LC.riverText.replace('{stage}', String(w.riverStage)), { stage: w.riverStage }, 'water');
    }
  }
  function countRainDays(state, from, to) {
    const rd = state.weather.rainDays; let n = 0;
    if (!Array.isArray(rd)) return 0;
    for (let i = 0; i < rd.length; i++) if (rd[i] && rd[i].day >= from && rd[i].day <= to) n++;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Festivals (GDD §9.2, §14.3)
  // ---------------------------------------------------------------------------
  const FESTIVAL_ID = { leveeBonfires: 'bonfires' };   // ARCHITECTURE §3.4 payload id
  function dailyFestivals(state) {
    const fests = (data().calendar && data().calendar.festivals) || [];
    const day = state.calendar.day, year = state.calendar.year;
    for (let i = 0; i < fests.length; i++) {
      const f = fests[i];
      if (!f || !f.start) continue;
      const id = FESTIVAL_ID[f.id] || f.id;
      if (id === 'foundersDay' && year < 2) continue;
      const start = dayOfDate(f.start, year);
      if (start >= 0 && day === start) emit(EV.FESTIVAL_START, { id: id, day: day });
      // The end fires the day after `end` (a festival ending on Dec 10 ends on Jan 1 of the next year).
      for (let y = year - 1; y <= year; y++) {
        if (id === 'foundersDay' && y < 2) continue;
        const end = dayOfDate(f.end || f.start, y);
        if (end >= 0 && day === end + 1) emit(EV.FESTIVAL_END, { id: id, day: day });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Storms: struct factory, schedule, lifecycle (GDD §6.2, §10.3; ARCH §2.5, §5.4)
  // ---------------------------------------------------------------------------
  function stormNames() { const d = data(); return Array.isArray(d.stormNames) && d.stormNames.length ? d.stormNames : ['Storm']; }
  function nextName(state) {
    const names = stormNames();
    const st = state.storms;
    if (fin(st.nameIndex, 0) < LC.reservedNames) st.nameIndex = LC.reservedNames;   // Amélie/Boudin/Célestine belong to the Year-1 script
    const name = names[st.nameIndex % names.length];
    st.nameIndex = (st.nameIndex + 1) % names.length;
    if (st.nameIndex < LC.reservedNames) st.nameIndex = LC.reservedNames;
    return name;
  }
  /** The Célestine landfall tile: the south-edge tile below the cove's longitude. */
  function celestinePoint(state) {
    const mouth = state.plot && state.plot.mouth;
    const tx = (Array.isArray(mouth) && mouth.length >= 2) ? (mouth[1] & 63) : clamp(fin(state.plot && state.plot.founders && state.plot.founders.tx, 32), 0, W - 1);
    return BSU.idx(tx, H - 1);
  }
  /** A random landfall point per the edge rule: south edge 70%, else east edge with ty > 30 (rng.sim). */
  function randomPoint() {
    if (R.chance(PS.southEdgeP)) return BSU.idx(R.int(W), H - 1);
    return BSU.idx(W - 1, PS.eastEdgeMinRow + 1 + R.int(H - PS.eastEdgeMinRow - 1));
  }
  function dirOf(point) { return (BSU.ty(point) === H - 1) ? 'S' : 'E'; }
  /** The 8 edge tiles centered on the point along its edge (clamped in bounds). */
  function entryOf(point) {
    const tx = BSU.tx(point), ty = BSU.ty(point), n = PS.entryWidth, out = [];
    if (dirOf(point) === 'S') { const s = clamp(tx - Math.floor(n / 2), 0, W - n); for (let k = 0; k < n; k++) out.push(BSU.idx(s + k, H - 1)); }
    else { const s = clamp(ty - Math.floor(n / 2), 0, H - n); for (let k = 0; k < n; k++) out.push(BSU.idx(W - 1, s + k)); }
    return out;
  }
  /** Cone track: 6 points from the landfall point toward the cove (or Founders'). */
  function trackOf(state, point) {
    const mouth = state.plot && state.plot.mouth;
    let ex, ey;
    if (Array.isArray(mouth) && mouth.length >= 2) { ex = BSU.tx(mouth[1]); ey = BSU.ty(mouth[1]); }
    else { ex = clamp(fin(state.plot && state.plot.founders && state.plot.founders.tx, 32), 0, W - 1); ey = clamp(fin(state.plot && state.plot.founders && state.plot.founders.ty, 8), 0, H - 1); }
    const sx = BSU.tx(point), sy = BSU.ty(point), out = [];
    for (let k = 0; k < LC.trackPoints; k++) {
      const t = k / (LC.trackPoints - 1);
      out.push({ tx: Math.round(sx + (ex - sx) * t), ty: Math.round(sy + (ey - sy) * t) });
    }
    return out;
  }
  function hasInstitute(state) { return call('buildings', 'has', state, BSU.B.coastal_institute) === true; }
  /** Build a Storm struct (ARCH §2.5). Draws forecastCat (and the point when not given) from rng.sim. */
  function makeStorm(state, o) {
    const day = state.calendar.day, T = state.tick;
    const cat = clamp(Math.round(fin(o.cat, 1)), 1, 5);
    const compressed = o.compressed === true;
    const landfallTick = fin(o.landfallTick, T + PS.coneDays * TPD);
    const leadDays = Math.max(0, Math.ceil((landfallTick - T) / TPD));
    let forecastCat;
    if (typeof o.forecastCat === 'number') forecastCat = clamp(Math.round(o.forecastCat), 1, 5);
    else forecastCat = clamp(cat + (R.int(2 * PS.forecastSpread + 1) - PS.forecastSpread), 1, 5);
    const point = (typeof o.point === 'number' && o.point >= 0 && o.point < W * H) ? o.point : randomPoint();
    const institute = hasInstitute(state);
    return {
      name: o.name || nextName(state),
      cat: cat, forecastCat: forecastCat, nearMiss: !!o.nearMiss, phase: STORM.NAMED,
      coneDay: day, landfallDay: day + leadDays, tLandfall: compressed ? landfallTick : NONE, coneTick: T,
      coneDays: fin(o.coneDays, leadDays), institute: institute, compressed: compressed,
      point: point, dir: dirOf(point), entry: entryOf(point), track: trackOf(state, point),
      coneWidth: PS.coneWidth[0] * (institute ? (1 - PS.coneNarrowInstitute) : 1),
      surge: PS.surge[cat], jammedGates: [],
      rolls: { towerTopple: false, toppleIds: [], substationOutages: [], fenceBreaks: [] },
      boardQueue: [], boardedCount: 0, evacuated: false, preDrain: false, sandbagged: false, shelterOverflow: false,
      gateCrew: false, fuelGeneratorId: NONE,
      toasts: { shelter: false, sandbag: false, fuel: false, gate: false },
      damageReport: null
    };
  }
  function stormPayload(st) {
    return { name: st.name, cat: st.cat, forecastCat: st.forecastCat, nearMiss: !!st.nearMiss, landfallDay: st.landfallDay, point: st.point };
  }
  function scheduledPayload(e) { return { name: e.name, cat: e.cat, forecastCat: e.cat, nearMiss: !!e.nearMiss, landfallDay: e.day, point: e.point }; }

  /** Daily cone narrowing 24 → 6 over the cone days (×0.7 with the Institute). */
  function updateConeWidth(state, st) {
    if (!st || st.nearMiss) return;
    let frac;
    if (st.compressed && st.tLandfall > st.coneTick) frac = (state.tick - st.coneTick) / (st.tLandfall - st.coneTick);
    else frac = st.coneDays > 0 ? (state.calendar.day - st.coneDay) / st.coneDays : 1;
    frac = clamp(fin(frac, 1), 0, 1);
    st.coneWidth = BSU.lerp(PS.coneWidth[0], PS.coneWidth[1], frac) * (st.institute ? (1 - PS.coneNarrowInstitute) : 1);
  }

  // --- Years-2+ schedule (Jan 1) ------------------------------------------------
  /** Set-piece dates a storm must stay 6 days clear of: home games (below) plus the parade and graduation. */
  function setPieceDays(state, year) {
    const out = homeDays(state, year);
    const pushDate = function (str) { const d = dayOfDate(str, year); if (d >= 0) out.push(d); };
    pushDate(PW.festivals.paradeDate); pushDate(PW.festivals.graduationDate);
    return out;
  }
  /** Home-game days of the year: the live sports schedule when it is this year's, else the fixed data dates. */
  function homeDays(state, year) {
    const out = [];
    const season = call('sports', 'season', state);
    const sched = (season && season.seasonYear === year && Array.isArray(season.schedule) && season.schedule.length) ? season.schedule : null;
    if (sched) { for (let i = 0; i < sched.length; i++) if (sched[i] && sched[i].home && typeof sched[i].day === 'number') out.push(sched[i].day); }
    else { const ds = data().schedule || []; for (let i = 0; i < ds.length; i++) if (ds[i] && ds[i].home && ds[i].date) { const d = dayOfDate(ds[i].date, year); if (d >= 0) out.push(d); } }
    return out;
  }
  function catWeightsFor(year) {
    const w = PS.catWeights.slice();
    const shiftYears = Math.max(0, year - PS.catShiftFromYear);
    const shift = Math.min(shiftYears * PS.catShiftPerYear, PS.cat5Cap - w[4], w[0]);
    w[0] -= shift; w[4] += shift;
    return w;
  }
  function drawSchedule(state) {
    const cal = state.calendar, year = cal.year, y0 = yearStartOf(cal.day);
    const count = pickWeighted(PS.countWeights) + 1;
    const weights = catWeightsFor(year);
    const peakStart = dayOfDate(PS.peak.start, year), peakEnd = dayOfDate(PS.peak.end, year);
    const seasonStart = dayOfDate(PS.season.start, year), seasonEnd = y0 + LC.seasonEndYd;
    const blocked = setPieceDays(state, year);
    const homes = homeDays(state, year);
    const playThrough = call('buildings', 'has', state, BSU.B.stadium, 2) === true;
    const picked = [];
    for (let n = 0; n < count; n++) {
      const cat = pickWeighted(weights) + 1;
      const nearMiss = R.chance(PS.nearMissChance);
      let day = NONE;
      // Play-Through-It collision: the first storm after Stadium II exists lands the day after a home date (Cat 1 only).
      if (playThrough && n === 0 && cat === 1 && !nearMiss && homes.length) {
        const cands = homes.filter(function (h) { return h + 1 >= seasonStart && h + 1 <= seasonEnd; });
        if (cands.length) day = R.pick(cands) + 1;
      }
      if (day < 0) {
        for (let tries = 0; tries < PS.maxRedraws; tries++) {
          let d;
          if (R.chance(PS.peak.p)) d = peakStart + R.int(peakEnd - peakStart + 1);
          else {
            const before = peakStart - seasonStart, after = seasonEnd - peakEnd;
            const k = R.int(before + after);
            d = k < before ? seasonStart + k : peakEnd + 1 + (k - before);
          }
          let ok = true;
          for (let i = 0; i < picked.length && ok; i++) if (Math.abs(picked[i].day - d) < PS.minGapDays) ok = false;
          for (let i = 0; i < blocked.length && ok; i++) if (Math.abs(blocked[i] - d) <= PS.setPieceGapDays) ok = false;
          if (ok) { day = d; break; }
        }
      }
      if (day < 0) continue;   // dropped after 20 redraws
      picked.push({ day: day, cat: cat, nearMiss: nearMiss, name: nextName(state), point: randomPoint(), waved: false, watched: false, coneDays: 0 });
    }
    picked.sort(function (a, b) { return a.day - b.day; });
    state.storms.scheduled = picked;
  }

  // --- lifecycle transitions (shared by the day-driven and tick-driven drivers) --
  function doWatch(state, st) {
    st.phase = STORM.WATCH;
    state.weather.wind = Math.max(state.weather.wind, LC.windWatch);
    emit(EV.STORM_WATCH, stormPayload(st));
    if (!st.nearMiss) ticker(state, 39, { storm: st.name });
  }
  function doBands(state, st) {
    const day = state.calendar.day;
    st.phase = STORM.BANDS;
    if (st.tLandfall < 0) st.tLandfall = state.tick + (TPD - fin(state.calendar.dayTick, 0));   // informational: the next day boundary
    emit(EV.STORM_BANDS, stormPayload(st));
    startBand(state);
    state.weather.wind = PS.windBands;
    const caps = call('buildings', 'shelterAssignments', state);
    call('agents', 'shelter', state, (caps && typeof caps === 'object') ? caps : {});
    const u = call('sports', 'upcoming', state);
    if (u && u.home && u.day === day && st.forecastCat <= P.sports.playThroughMaxCat) call('sports', 'offerPlayThrough', state);
  }
  /** Start the landfall set piece (only when no other set piece runs). Returns true when started. */
  function doLandfall(state, st) {
    if (state.setPiece) return false;
    const seen = call('progress', 'setPieceSeen', state, 'landfall') === true;
    const ses = dep('session');
    if (!ses || typeof ses.startSetPiece !== 'function') {
      BSU.error('weather', 'landfall', new Error('session.startSetPiece unavailable: landfall set piece skipped'));
      st.phase = STORM.RECOVERY;
      return false;
    }
    try { ses.startSetPiece(state, 'landfall', { len: PT.landfallTicks, skippable: seen }); }
    catch (e) { BSU.error('weather', 'session.startSetPiece', e); return false; }
    if (!state.setPiece) { BSU.error('weather', 'landfall', new Error('session did not create the set piece')); return false; }
    st.phase = STORM.LANDFALL;
    if (st.tLandfall < 0) st.tLandfall = state.tick;
    state.storms.lastLandfallDay = state.calendar.day;
    startMapWide(state, 'hurricane', PR.hurricane[st.cat - 1] / PHY.inchesPerFoot, PR.hurricaneSteps, false);
    pv.nextHookIdx = 0; pv.toastsOpened = {}; pv.surgeBegun = false;
    emit(EV.STORM_LANDFALL, stormPayload(st));
    return true;
  }
  /** The near-miss bands pass (Amélie and 25% of later storms). */
  function doNearMissPass(state, st) {
    if (state.setPiece) return false;
    const ses = dep('session');
    if (ses && typeof ses.startSetPiece === 'function') {
      try { ses.startSetPiece(state, 'nearMiss', { len: PT.nearMissTicks, skippable: true }); }
      catch (e) { BSU.error('weather', 'session.startSetPiece', e); }
    }
    st.phase = STORM.BANDS;
    st.tLandfall = state.tick;
    // 60 hydro steps at dt 1/60 (150 ticks × 4 steps per 10) = one calendar day of band rain (4 in).
    startMapWide(state, 'band', PR.band, LC.nearMissSteps, true);
    state.weather.wind = PS.amelie.wind;
    emit(EV.STORM_BANDS, stormPayload(st));
    if (!state.setPiece) finishNearMiss(state);   // no session: finish at once so the storm never hangs
    return true;
  }
  function finishNearMiss(state) {
    const st = state.storms.current;
    if (!st || !st.nearMiss) return;
    endEvent(state);
    state.storms.log.push({ name: st.name, cat: st.cat, year: state.calendar.year, day: state.calendar.day, nearMiss: true, damage: 0, tarps: 0, held: true });
    st.phase = STORM.PASSED;
    emit(EV.STORM_PASSED, stormPayload(st));
    if (st.name === 'Amélie') ticker(state, 62, {});
    else ticker(state, 45, { storm: st.name });
    state.storms.current = null;
    state.storms.playThroughIt = false;
  }

  /** Day-driven storm work (the new-day step). */
  function dailyStorms(state) {
    const cal = state.calendar, st = state.storms, day = cal.day, yd = day % DPY, T = state.tick;
    // T+1 band after a landfall.
    if (st.t1BandDay === day) { st.t1BandDay = NONE; startBand(state); }
    // Boudin: the Aug 1 ticker-only wave (Year 1).
    if (cal.year === 1 && day === dayOfDate(PS.boudin, 1)) ticker(state, 2, {});
    // Célestine hold rule (GDD §10.3).
    const ce = st.celestine;
    if (ce && ce.state !== 'done' && ce.state !== 'cone') {
      const coneYd = dayOfDate(PS.celestine.coneDate, 1), holdYd = dayOfDate(PS.celestine.holdDate, 1);
      const eligible = ce.state === 'held' || cal.year >= 2 || (cal.year === 1 && yd >= coneYd);
      if (eligible && !st.current) {
        const pr = dep('progress');
        const offered = (pr && typeof pr.offered === 'function') ? call('progress', 'offered', state, '11') === true : true;
        if (fin(state.playSeconds, 0) >= PS.celestine.minPlaySeconds && offered) {
          const wasHeld = ce.state === 'held';
          const storm = M.spawnStorm(state, { cat: PS.celestine.cat, nearMiss: false, coneNowTick: T, landfallTick: T + PS.coneDays * TPD, compressed: false, name: 'Célestine', forecastCat: PS.celestine.forecastCat, point: celestinePoint(state) });
          if (storm) { ce.state = 'cone'; ce.coneDay = day; if (wasHeld) ticker(state, LC.holdText, {}, 'danger'); }
        }
      }
      if (ce.state === 'pending' && (cal.year >= 2 || yd > holdYd)) ce.state = 'held';
    }
    // Years-2+ schedule (Jan 1; suppressed until Célestine is done).
    if (yd === 0 && cal.year >= 2 && ce && ce.state === 'done') drawSchedule(state);
    // Scheduled storms (sorted by day): waves, cones, near-miss watches and passes.
    while (st.scheduled.length) {
      const e = st.scheduled[0];
      if (!e || typeof e.day !== 'number') { st.scheduled.shift(); continue; }
      if (e.nearMiss) {
        if (!st.current && !e.watched && day >= e.day - PS.watchLead && day < e.day) {
          e.watched = true;
          const nm = makeStorm(state, { cat: e.cat, nearMiss: true, landfallTick: T + (e.day - day) * TPD, compressed: false, name: e.name, point: e.point, forecastCat: e.cat });
          st.current = nm;
          doWatch(state, nm);
        }
        if (day >= e.day) {
          if (st.current && !st.current.nearMiss) { if (day > e.day + PS.setPieceGapDays) st.scheduled.shift(); break; }   // another storm is live: wait a little, then drop
          if (!st.current) st.current = makeStorm(state, { cat: e.cat, nearMiss: true, landfallTick: T, compressed: false, name: e.name, point: e.point, forecastCat: e.cat });
          if (doNearMissPass(state, st.current)) st.scheduled.shift();
        }
        break;
      }
      if (!e.waved && day >= e.day - (PS.coneDays + PS.waveLead)) {
        e.waved = true;
        e.coneDays = hasInstitute(state) ? PS.coneDaysInstitute : PS.coneDays;
        emit(EV.STORM_WAVE, scheduledPayload(e));
        ticker(state, 2, {});
      }
      const lead = e.coneDays > 0 ? e.coneDays : PS.coneDays;
      if (day >= e.day - lead) {
        if (st.current) { if (day > e.day) st.scheduled.shift(); else break; continue; }   // a live storm blocks the cone; a missed date is dropped
        const storm = M.spawnStorm(state, { cat: e.cat, nearMiss: false, coneNowTick: T, landfallTick: T + Math.max(1, e.day - day) * TPD, compressed: false, name: e.name, point: e.point, coneDays: e.coneDays });
        if (storm) { storm.coneDays = lead; st.scheduled.shift(); continue; }
      }
      break;
    }
    // The live storm's day-driven transitions.
    const cur = st.current;
    if (cur && !cur.compressed) {
      if (cur.nearMiss) {
        if (cur.phase < STORM.BANDS && day >= cur.landfallDay) doNearMissPass(state, cur);
      } else {
        if (cur.phase < STORM.WATCH && day >= cur.landfallDay - PS.watchLead) doWatch(state, cur);
        if (cur.phase < STORM.BANDS && day >= cur.landfallDay - PS.bandsLead) doBands(state, cur);
        if (cur.phase < STORM.LANDFALL && day >= cur.landfallDay) doLandfall(state, cur);
      }
    }
    if (st.current) updateConeWidth(state, st.current);
  }
  /** Tick-driven transitions of a compressed storm (debug / headless.forceHurricane, D51). */
  function tickStorms(state) {
    const st = state.storms.current;
    if (!st) return;
    if (st.compressed && !st.nearMiss && st.tLandfall >= 0) {
      const T = state.tick;
      if (st.phase < STORM.WATCH && T >= st.tLandfall - PS.watchLead * TPD) doWatch(state, st);
      if (st.phase < STORM.BANDS && T >= st.tLandfall - PS.bandsLead * TPD) doBands(state, st);
      if (st.phase < STORM.LANDFALL && T >= st.tLandfall) doLandfall(state, st);
      updateConeWidth(state, st);
    }
  }

  // ---------------------------------------------------------------------------
  // Landfall set-piece timeline (ARCH §5.4 table, GDD §6.2) — a sorted {tick, fn} table
  // ---------------------------------------------------------------------------
  const TT = PS.toastTicks, PHT = PS.phaseTicks;
  function pulse(state, st, n, share) { emit(EV.STORM_PULSE, { n: n, share: share }); }
  function hOuter(state, st, sp) { emit(EV.STORM_PHASE, { phase: SPH.OUTER, t: sp.tick }); M.scriptSky(state, SKY.DAY, 0.5); }
  function hWall(state, st, sp) {
    emit(EV.STORM_PHASE, { phase: SPH.WALL, t: sp.tick });
    decideRolls(state, st);
    qualifyToasts(state, st);
    surgeBegin(state, st);
    cameraCue(state, st, 'entry');
  }
  function hToasts300(state, st) {
    const year = state.calendar.year;
    if (st.toasts.sandbag) openToast(state, 'sandbag');
    if (st.toasts.shelter && (!st.toasts.sandbag || year >= 2)) openToast(state, 'shelter');
  }
  function hToasts330(state, st) { if (st.toasts.shelter && !pv.toastsOpened.shelter && !choicesOf(state).shelter) openToast(state, 'shelter'); }
  function hLandfallPhase(state, st, sp) { emit(EV.STORM_PHASE, { phase: SPH.LANDFALL, t: sp.tick }); cameraCue(state, st, 'ring'); }
  function hFuel(state, st) { if (st.toasts.fuel) openToast(state, 'fuel'); }
  function hEye(state, st, sp) {
    if (st.cat < PS.eyeMinCat) return;
    emit(EV.STORM_PHASE, { phase: SPH.EYE, t: sp.tick });
    M.scriptSky(state, SKY.GOLDEN, 0.5);
    if (st.toasts.gate) openToast(state, 'gate');
  }
  function hGateCrew(state, st) {
    if (choicesOf(state).gate !== 'yes' && !st.gateCrew) return;
    const caught = R.chance(PS.gateCrewCaughtP);
    ticker(state, caught ? LC.gateCaughtText : LC.gateClearText, {}, 'event');
    if (caught) call('economy', 'bump', state, 'happiness', PS.gateCrewMood, 'gateCrew');
    const gates = st.jammedGates.slice();
    for (let i = 0; i < gates.length; i++) { call('hydro', 'setJammed', state, gates[i], false); call('hydro', 'markLeveeChange', state, gates[i]); }
    st.jammedGates = [];
    call('agents', 'crewSprites', state, gates.length ? gates[0] : NONE, 3);
  }
  function hBack(state, st, sp) { emit(EV.STORM_PHASE, { phase: SPH.BACK, t: sp.tick }); M.scriptSky(state, SKY.DAY, 0.5); }
  function hClearing(state, st, sp) {
    emit(EV.STORM_PHASE, { phase: SPH.CLEARING, t: sp.tick });
    call('hydro', 'surgeControl', state, 'end');
    pv.surgeBegun = false;
    M.scriptSky(state, SKY.GOLDEN, 0.2);
    let report = call('buildings', 'damageReport', state, st);
    if (!report || typeof report !== 'object') report = { bill: 0, tarps: 0, held: [], overtopped: [], breached: [], flooded: [], choices: {} };
    report.bill = fin(report.bill, 0); report.tarps = fin(report.tarps, 0);
    if (!Array.isArray(report.held)) report.held = []; if (!Array.isArray(report.overtopped)) report.overtopped = [];
    if (!Array.isArray(report.breached)) report.breached = []; if (!Array.isArray(report.flooded)) report.flooded = [];
    report.choices = Object.assign({}, report.choices || {}, choicesOf(state));
    st.damageReport = report;
    emit(EV.STORM_REPORT, { report: report });
    ticker(state, 47, { storm: st.name });
  }
  const HOOKS = [
    { tick: PHT.outer, fn: hOuter },
    { tick: PHT.wall, fn: hWall },
    { tick: PT.windPulseTicks[0], fn: function (s, st) { pulse(s, st, 1, PT.windPulseShare[0]); } },
    { tick: TT.sandbag, fn: hToasts300 },
    { tick: TT.shelterAlt, fn: hToasts330 },
    { tick: PHT.landfall, fn: hLandfallPhase },
    { tick: PT.windPulseTicks[1], fn: function (s, st) { pulse(s, st, 2, PT.windPulseShare[1]); } },
    { tick: TT.fuel, fn: hFuel },
    { tick: PHT.eye, fn: hEye },
    { tick: PS.gateCrewTick, fn: hGateCrew },
    { tick: PHT.back, fn: hBack },
    { tick: PT.windPulseTicks[2], fn: function (s, st) { pulse(s, st, 3, PT.windPulseShare[2]); } },
    { tick: PT.windPulseTicks[3], fn: function (s, st) { pulse(s, st, 4, PT.windPulseShare[3]); } },
    { tick: PHT.clearing, fn: hClearing }
  ].sort(function (a, b) { return a.tick - b.tick; });
  M.LANDFALL_HOOK_TICKS = Object.freeze(HOOKS.map(function (h) { return h.tick; }));
  M.TOAST_TICKS = Object.freeze([TT.sandbag, TT.shelterAlt, TT.fuel, TT.gate]);

  /** rainRate schedule during the landfall set piece. */
  function landfallRainRate(st, t) {
    if (t < PHT.wall) return LC.rainOuterStart + (1 - LC.rainOuterStart) * (t / PHT.wall);
    if (st.cat >= PS.eyeMinCat && t >= PHT.eye && t < PHT.back) return 0;
    if (t < PHT.clearing) return 1;
    return Math.max(0, 1 - (t - PHT.clearing) / (PHT.end - PHT.clearing));
  }
  function landfallWind(st, t) {
    if (t < PHT.wall) return PS.windOuter[0] + (PS.windOuter[1] - PS.windOuter[0]) * (t / PHT.wall);
    if (st.cat >= PS.eyeMinCat && t >= PHT.eye && t < PHT.back) return LC.windEye;
    if (t < PHT.back) return PS.windOuter[1];
    if (t < PHT.clearing) return LC.windBack;
    return LC.windClearing;
  }
  function surgeBegin(state, st) {
    if (pv.surgeBegun) return;
    pv.surgeBegun = true;
    call('hydro', 'surgeControl', state, 'begin', { stage: 0, target: st.surge, entry: st.entry.slice(), dir: st.dir });
  }
  /** Per-tick continuous parts of the landfall timeline (functions of t; resume correctly after a load). */
  function landfallContinuous(state, st, t) {
    const w = state.weather;
    w.wind = landfallWind(st, t);
    // Surge stage: ramp 150–350, hold 350–500, recede 500–750.
    if (t >= PHT.wall && t < PHT.clearing) {
      if (!pv.surgeBegun) surgeBegin(state, st);
      let stage;
      if (t <= PHT.landfall) stage = st.surge * Math.min(1, (t - PHT.wall) / PS.surgeRampTicks);
      else if (t < PHT.back) stage = st.surge;
      else stage = st.surge * Math.max(0, 1 - (t - PHT.back) / (PHT.clearing - PHT.back));
      call('hydro', 'surgeControl', state, 'stage', Math.max(0, fin(stage, 0)));
    }
    // Lightning cadence: outer every 80, wall/landfall every 40, eye none, back half every 60.
    let every = 0;
    if (t < PHT.wall) every = PS.lightningEveryOuter;
    else if (t < PHT.eye || (st.cat < PS.eyeMinCat && t < PHT.back)) every = Math.round((PS.lightningEveryWall[0] + PS.lightningEveryWall[1]) / 2);
    else if (t >= PHT.back && t < PHT.clearing) every = LC.lightningEveryBack;
    if (every > 0 && t % every === 0) emit(EV.WEATHER_LIGHTNING, { tx: R.int(W), ty: R.int(H) });
  }
  /** Evaluate the hook table at setPiece.tick (hooks fire only at their exact tick). */
  function runLandfallTick(state) {
    const sp = state.setPiece, st = state.storms.current;
    if (!sp || sp.kind !== 'landfall' || !st) return;
    const t = fin(sp.tick, 0);
    if (!sp.choices || typeof sp.choices !== 'object') sp.choices = {};
    while (pv.nextHookIdx < HOOKS.length && HOOKS[pv.nextHookIdx].tick < t) pv.nextHookIdx++;   // missed (load): skip
    while (pv.nextHookIdx < HOOKS.length && HOOKS[pv.nextHookIdx].tick === t) {
      const h = HOOKS[pv.nextHookIdx++];
      try { h.fn(state, st, sp); } catch (e) { BSU.error('weather', 'landfall:' + h.tick, e); }
    }
    landfallContinuous(state, st, t);
  }
  function runNearMissTick(state) {
    const st = state.storms.current;
    if (st) state.weather.wind = PS.amelie.wind;
  }
  function cameraCue(state, st, which) {
    const sp = state.setPiece;
    if (!sp || sp.cameraTouched) return;
    let tx, ty;
    if (which === 'entry') { const c = st.entry[Math.floor(st.entry.length / 2)]; tx = BSU.tx(c); ty = BSU.ty(c); }
    else {
      const ring = call('buildings', 'boundaryLevees', state, st.surge);
      const ex = BSU.tx(st.point), ey = BSU.ty(st.point);
      let best = -1, bestD = 1e9;
      if (Array.isArray(ring)) for (let i = 0; i < ring.length; i++) { const d = BSU.chebyshev(BSU.tx(ring[i]), BSU.ty(ring[i]), ex, ey); if (d < bestD) { bestD = d; best = ring[i]; } }
      if (best < 0) { const mouth = state.plot && state.plot.mouth; best = (Array.isArray(mouth) && mouth.length) ? mouth[Math.floor(mouth.length / 2)] : st.entry[0]; }
      tx = BSU.tx(best); ty = BSU.ty(best);
    }
    call('render', 'panToTile', tx, ty, true);
  }

  // --- rolls and toast qualification (set-piece tick 150) --------------------------
  function footprintNear(b, tx, ty, r) {
    const dx = Math.max(b.tx - tx, tx - (b.tx + b.w - 1), 0), dy = Math.max(b.ty - ty, ty - (b.ty + b.h - 1), 0);
    return Math.max(dx, dy) <= r;
  }
  function oakWithin(state, b, r) {
    const veg = state.veg || [];
    for (let i = 0; i < veg.length; i++) { const v = veg[i]; if (v && v.type === 'oak' && footprintNear(b, v.tx, v.ty, r)) return true; }
    const oaks = call('buildings', 'list', state, BSU.B.live_oak) || [];
    for (let i = 0; i < oaks.length; i++) { const o = oaks[i]; if (o && footprintNear(b, o.tx, o.ty, r)) return true; }
    return false;
  }
  function boarded(b, day) { return !!(b.data && typeof b.data.boardedUntil === 'number' && b.data.boardedUntil >= day); }
  function decideRolls(state, st) {
    const day = state.calendar.day, tiles = state.tiles;
    const rolls = { towerTopple: false, toppleIds: [], substationOutages: [], fenceBreaks: [] };
    if (st.cat >= PS.towerMinCat) {
      const towers = call('buildings', 'list', state, BSU.B.water_tower) || [];
      for (let i = 0; i < towers.length; i++) {
        const b = towers[i]; if (!b || b.ruin || b.built < 1) continue;
        const braced = boarded(b, day) || oakWithin(state, b, PS.oakRadius);
        if (R.chance(braced ? PS.towerToppleBracedP : PS.towerToppleP)) rolls.toppleIds.push(b.id);
      }
      rolls.towerTopple = rolls.toppleIds.length > 0;
    }
    if (st.cat >= PS.outageMinCat) {
      const subs = call('buildings', 'list', state, BSU.B.substation) || [];
      for (let i = 0; i < subs.length; i++) {
        const b = subs[i]; if (!b || b.ruin || b.pilings) continue;
        if (R.chance(boarded(b, day) ? PS.substationOutageBoardedP : PS.substationOutageP)) rolls.substationOutages.push(b.id);
      }
    }
    if (st.cat >= PS.fenceBreakMinCat && tiles && tiles.surface) {
      for (let i = 0; i < tiles.surface.length; i++) if (tiles.surface[i] === BSU.SURF.FENCE && R.chance(PS.fenceBreak)) rolls.fenceBreaks.push(i);
    }
    st.rolls = rolls;
    st.jammedGates = [];
    if (st.cat >= PS.jammedMinCat) {
      const gates = gateTiles(state);
      for (let i = 0; i < gates.length; i++) if (R.chance(PS.jammedGateP)) { st.jammedGates.push(gates[i]); call('hydro', 'setJammed', state, gates[i], true); }
    }
  }
  /** Floodgate tiles: from hydro.networks when available, else every FLOODGATE-flagged tile. */
  function gateTiles(state) {
    const nets = call('hydro', 'networks', state);
    const out = [];
    if (Array.isArray(nets)) { for (let i = 0; i < nets.length; i++) { const g = nets[i] && nets[i].gates; if (Array.isArray(g)) for (let k = 0; k < g.length; k++) out.push(g[k]); } if (out.length || nets.length) return out; }
    const flags = state.tiles && state.tiles.flags;
    if (flags) for (let i = 0; i < flags.length; i++) if (flags[i] & BSU.FLAG.FLOODGATE) out.push(i);
    return out;
  }
  function qualifyToasts(state, st) {
    const tiles = state.tiles, year = state.calendar.year;
    const q = { sandbag: false, shelter: false, fuel: false, gate: false };
    // Sandbag: a boundary levee tile with integrity < 85, or unsandbagged with the surge within 3 ft of its crest.
    const ring = call('buildings', 'boundaryLevees', state, st.surge);
    let minInt = 100;
    if (Array.isArray(ring) && tiles) {
      for (let i = 0; i < ring.length; i++) {
        const t = ring[i]; if (t < 0 || t >= W * H) continue;
        const integ = tiles.integrity[t];
        if (integ < minInt) minInt = integ;
        const crestTop = tiles.elev[t] + tiles.crest[t] + tiles.sandbag[t] / 10;
        if (integ < PS.toast1Integrity || (tiles.sandbag[t] === 0 && st.surge >= crestTop - PS.toast1Margin)) q.sandbag = true;
      }
    }
    st.ringIntegrity = minInt;
    // Fuel: a running generator with ≤ 1 fuel day.
    const gens = call('buildings', 'list', state, BSU.B.generator) || [];
    for (let i = 0; i < gens.length; i++) { const g = gens[i]; if (g && !g.ruin && g.built >= 1 && g.data && fin(g.data.fuelDays, 0) <= 1) { q.fuel = true; st.fuelGeneratorId = g.id; break; } }
    q.gate = st.jammedGates.length > 0;
    q.shelter = year === 1 || !(q.sandbag || q.fuel || q.gate);
    st.toasts = q;
  }

  // --- toasts ----------------------------------------------------------------------
  function choicesOf(state) { return (state.setPiece && state.setPiece.choices) ? state.setPiece.choices : pv.choicesFallback; }
  function toastText(state, id) {
    const st = state.storms.current;
    switch (id) {
      case 'sandbag': return { text: 'Cove levee at ' + Math.round(st ? fin(st.ringIntegrity, 80) : 80) + '% — emergency sandbag crew, ' + BSU.formatMoney(PS.sandbagToastCost) + '? (+' + PS.sandbagFt + ' ft crest through the peak)', yes: 'Send the crew', no: 'Hold' };
      case 'shelter': return { text: "Founders' gym is full — open the Dining Hall as overflow shelter? (Dining closed " + PS.shelterClosedDays + ' days, −' + BSU.formatMoney(PS.shelterToastCost) + ')', yes: 'Open it', no: 'Ride it out' };
      case 'fuel': return { text: 'Generator ' + ((st && st.fuelGeneratorId >= 0) ? st.fuelGeneratorId + 1 : 1) + ' fuel out — refuel ' + BSU.formatMoney(P.build.refuelCost) + '?', yes: 'Refuel', no: 'Let it go dark' };
      default: return { text: 'Send a crew out to clear the jammed floodgate? Risk: the back half catches them', yes: 'Send them', no: 'Leave it' };
    }
  }
  function openToast(state, id) {
    if (pv.toastsOpened[id] !== undefined || choicesOf(state)[id]) return;
    const untilTick = state.tick + PT.toastTicks;
    pv.toastsOpened[id] = untilTick;
    const tt = toastText(state, id);
    emit(EV.STORM_TOAST, { id: id, text: tt.text, yes: tt.yes, no: tt.no, untilTick: untilTick });
  }
  /** Enforce the 80-tick timeouts (ui may already have resolved the toast; both paths are idempotent). */
  function tickToasts(state) {
    const ids = Object.keys(pv.toastsOpened);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (choicesOf(state)[id]) { delete pv.toastsOpened[id]; continue; }
      if (state.tick >= pv.toastsOpened[id]) {
        call('ui', 'answerDecision', id, 'default');
        if (!choicesOf(state)[id]) M.answerToast(state, id, 'default');
        delete pv.toastsOpened[id];
      }
    }
  }

  // --- set-piece end (session emits setpiece:end) ----------------------------------
  function onSetPieceEnd(state, payload) {
    if (!state || !state.storms) return;
    const kind = payload && payload.kind;
    const st = state.storms.current;
    if (kind === 'landfall') {
      if (!st) return;
      if (!st.damageReport) { try { hClearing(state, st, { tick: PHT.clearing }); } catch (e) { BSU.error('weather', 'setpiece:end', e); } }   // ended early (skip without hooks)
      st.phase = STORM.RECOVERY;
      endEvent(state);
      const rep = st.damageReport || { bill: 0, tarps: 0, overtopped: [], breached: [] };
      state.storms.log.push({ name: st.name, cat: st.cat, year: state.calendar.year, day: state.calendar.day, nearMiss: false, damage: fin(rep.bill, 0), tarps: fin(rep.tarps, 0), held: rep.breached.length === 0 && rep.overtopped.length === 0 });
      state.storms.t1BandDay = state.calendar.day + 1;
      if (st.name === 'Célestine') state.storms.celestine.state = 'done';
      pv.toastsOpened = {}; pv.surgeBegun = false; pv.nextHookIdx = HOOKS.length;
      if (BSU.headlessMode) M.closeReport(state);
    } else if (kind === 'nearMiss') {
      finishNearMiss(state);
    }
    if (state.sky.scripted) M.releaseSky(state);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle: init / reset / tick
  // ---------------------------------------------------------------------------
  /** Subscribe (owner 'weather'): decision:closed (toast answers), setpiece:end, building:complete. */
  M.init = function (state) {
    try {
      BSU.events.clear('weather');
      BSU.events.on(EV.DECISION_CLOSED, function (p) {
        if (!p || !S) return;
        if (p.id === 'sandbag' || p.id === 'shelter' || p.id === 'fuel' || p.id === 'gate') M.answerToast(S, p.id, p.answer || 'default');
      }, 'weather');
      BSU.events.on(EV.SETPIECE_END, function (p) { if (S) onSetPieceEnd(S, p); }, 'weather');
      BSU.events.on(EV.BUILDING_COMPLETE, function () { /* Coastal Institute changes the cone lead for FUTURE storms only (read at the wave) */ }, 'weather');
      if (state && state.calendar) rebind(state);
    } catch (e) { BSU.error('weather', 'init', e); }
  };
  /**
   * Rebuild private caches for the new root. fresh === true (newGame): draw the Year-1 rain days from rng.sim and
   * clear calendar.running. fresh === false (load): draw NOTHING and leave everything saved untouched (D37).
   */
  M.reset = function (state, fresh) {
    try {
      if (!state || !state.calendar) return;
      rebind(state);
      deriveCalendar(state.calendar);
      if (fresh === true) {
        drawRainDays(state, state.calendar.day);
        state.calendar.running = false;
      }
      state.calendar.frozen = !state.calendar.running || !!state.setPiece;
      // A scripted sky keeps its scripted phase (cycleTick still holds the pre-set-piece value); otherwise derive silently (no event on load).
      if (!state.sky.scripted) applyCycleSilently(state);
      applyStages(state);
    } catch (e) { BSU.error('weather', 'reset', e); }
  };
  function applyCycleSilently(state) { const r = phaseOfCycle(state.sky.cycleTick); state.sky.phase = r.phase; state.sky.phaseTick = r.phaseTick; state.sky.t = r.phaseTick / SKY_TICKS[r.phase]; }

  /** dtDay for this tick (ARCH §5.1 step 1). */
  function dtDayFor(state) {
    const sp = state.setPiece;
    if (sp) {
      if (sp.kind === 'landfall') return PHY.dtDayLandfall;
      if (sp.kind === 'nearMiss') return PHY.dtDayNearMiss;
      return 0;   // game / parade / graduation / montage
    }
    const m = ((state.tick % 10) + 10) % 10;
    return (m === 0 || m === 2 || m === 5 || m === 7) ? PHY.dtDayNormal : 0;
  }

  /** One sim tick: sky, calendar (events before returning), dtDay, daily steps, cells, storms, set-piece timelines. */
  M.tick = function (state) {
    const flags = { newDay: false, newMonth: false, newYear: false, newSemester: false, day: (state && state.calendar) ? fin(state.calendar.day, 0) : 0 };
    if (!state || !state.calendar || !state.sky || !state.weather || !state.storms) return flags;
    if (S !== state || !pv) rebind(state);
    try {
      const cal = state.calendar;
      if (!Number.isFinite(state.tick)) state.tick = 0;
      advanceSky(state);
      cal.frozen = !cal.running || !!state.setPiece;
      if (!cal.frozen) {
        cal.dayTick = fin(cal.dayTick, 0) + 1;
        if (cal.dayTick >= TPD) {
          cal.dayTick = 0;
          cal.day = fin(cal.day, 0) + 1;
          const prevSemester = cal.semester;
          const p = deriveCalendar(cal);
          flags.newDay = true; flags.day = cal.day;
          flags.newMonth = cal.dom === 1;
          flags.newYear = (cal.day % DPY) === 0;
          flags.newSemester = cal.semester !== prevSemester;
          emit(EV.CALENDAR_DAY, { day: cal.day, year: cal.year, month: cal.month, dom: cal.dom });
          emit(EV.CALENDAR_DATE, { date: p.date, day: cal.day });
          if (flags.newMonth) emit(EV.CALENDAR_MONTH, { day: cal.day, year: cal.year, month: cal.month });
          if (flags.newSemester) emit(EV.CALENDAR_SEMESTER, { day: cal.day, semester: cal.semester });
          if (flags.newYear) emit(EV.CALENDAR_YEAR, { year: cal.year });
          runDaily(state);
        }
      }
      flags.day = cal.day;
      state.weather.dtDay = dtDayFor(state);
      tickFog(state);
      tickRain(state);
      tickStorms(state);
      const sp = state.setPiece;
      if (sp && sp.kind === 'landfall') runLandfallTick(state);
      else if (sp && sp.kind === 'nearMiss') runNearMissTick(state);
      tickToasts(state);
      sanitize(state);
    } catch (e) { BSU.error('weather', 'tick', e); }
    return flags;
  };
  /** The new-day steps, each in its own try/catch → BSU.error('weather', 'daily:<step>'). Order fixes the rng draw order. */
  const DAILY = [
    ['heat', dailyHeat], ['wind', dailyWind], ['fog', dailyFog], ['rain', dailyRain],
    ['river', dailyRiver], ['festivals', dailyFestivals], ['storms', dailyStorms]
  ];
  function runDaily(state) {
    const day = state.calendar.day;
    pv.rainedYesterday = pv.rainedToday || !!rainDayFor(state, day - 1);
    pv.rainedToday = !!state.weather.event;
    if (day % DPY === 0) {
      // Jan 1 draws in a fixed order: rain days (river and the storm schedule follow in their steps).
      pv.novDecRainDays = countRainDays(state, day - 20, day - 1);
      try { drawRainDays(state, day); } catch (e) { BSU.error('weather', 'daily:rainDraw', e); }
      if (state.weather.clearNightDay >= 0 && state.weather.clearNightDay < day) state.weather.clearNightDay = NONE;
    }
    for (let i = 0; i < DAILY.length; i++) {
      try { DAILY[i][1](state); } catch (e) { BSU.error('weather', 'daily:' + DAILY[i][0], e); }
    }
    pv.lastDay = day;
  }
  /** Keep every owned number finite (§10.3). */
  function sanitize(state) {
    const w = state.weather;
    if (!Number.isFinite(w.wind)) w.wind = 0;
    if (!Number.isFinite(w.windAngle)) w.windAngle = 0;
    if (!Number.isFinite(w.heat)) w.heat = PH.monthBase[state.calendar.month - 1] || 55;
    if (!Number.isFinite(w.fog)) w.fog = 0;
    if (!Number.isFinite(w.rainRate)) w.rainRate = 0;
    if (!Number.isFinite(w.dtDay)) w.dtDay = 0;
  }

  // ---------------------------------------------------------------------------
  // Public queries
  // ---------------------------------------------------------------------------
  /** {day, year, month, dom, str, season, semester} */
  M.date = function (state) {
    try {
      const c = state.calendar;
      return { day: c.day, year: c.year, month: c.month, dom: c.dom, str: BSU.formatDate(c.day), season: c.season, semester: c.semester };
    } catch (e) { BSU.error('weather', 'date', e); return { day: 0, year: 1, month: 1, dom: 1, str: 'Jan 1, Y1', season: 'winter', semester: 'break' }; }
  };
  /** Absolute day of 'Mon D' in the current year + yearOffset (-1 when the string does not parse). */
  M.dayOf = function (state, str, yearOffset) {
    try { return dayOfDate(str, state.calendar.year + (fin(yearOffset, 0) | 0)); } catch (e) { BSU.error('weather', 'dayOf', e); return NONE; }
  };
  /** Is today the given 'Mon D'? */
  M.isDate = function (state, str) { try { return state.calendar.day === M.dayOf(state, str, 0); } catch (e) { BSU.error('weather', 'isDate', e); return false; } };
  /** {phase, t, phaseTick, scripted} */
  M.sky = function (state) {
    try { const s = state.sky; return { phase: s.phase, t: s.t, phaseTick: s.phaseTick, scripted: !!s.scripted }; }
    catch (e) { BSU.error('weather', 'sky', e); return { phase: 0, t: 0, phaseTick: 0, scripted: false }; }
  };
  /** Set-piece owners drive the sky; cycleTick keeps the pre-set-piece value until releaseSky. */
  M.scriptSky = function (state, phase, t) {
    try {
      const s = state.sky;
      const ph = clamp(Math.round(fin(phase, SKY.DAY)), 0, SKY_TICKS.length - 1);
      const tt = clamp(fin(t, 0), 0, 1);
      const prev = s.phase;
      s.scripted = true; s.phase = ph; s.t = tt; s.phaseTick = Math.round(tt * SKY_TICKS[ph]);
      if (ph !== prev) emit(EV.SKY_PHASE, { phase: ph, prev: prev });
    } catch (e) { BSU.error('weather', 'scriptSky', e); }
  };
  /** Resume the free-running cycle from the captured cycleTick. */
  M.releaseSky = function (state) {
    try {
      const s = state.sky;
      s.scripted = false;
      s.cycleTick = ((fin(s.cycleTick, 0) % CYCLE) + CYCLE) % CYCLE;
      applyCycle(state);
    } catch (e) { BSU.error('weather', 'releaseSky', e); }
  };
  /** 0–1 local rain intensity at a tile this tick (cell falloff; map-wide events use rainRate). */
  M.rainAt = function (state, tx, ty) {
    try {
      const ev = state.weather.event;
      if (!ev) return 0;
      if (ev.radius > 0) {
        const dx = fin(tx, 0) - ev.cx, dy = fin(ty, 0) - ev.cy;
        return clamp(1 - Math.sqrt(dx * dx + dy * dy) / ev.radius, 0, 1);
      }
      return clamp(fin(state.weather.rainRate, 0), 0, 1);
    } catch (e) { BSU.error('weather', 'rainAt', e); return 0; }
  };
  M.raining = function (state) { try { return !!state.weather.event; } catch (e) { return false; } };
  /** {index, advisory, wave} */
  M.heat = function (state) {
    try { const w = state.weather; return { index: w.heat, advisory: w.heat >= PH.advisory, wave: fin(w.heatWaveDays, 0) >= PH.waveDays }; }
    catch (e) { BSU.error('weather', 'heat', e); return { index: 55, advisory: false, wave: false }; }
  };
  /** {speed, angle} */
  M.wind = function (state) { try { return { speed: fin(state.weather.wind, 0), angle: fin(state.weather.windAngle, 0) }; } catch (e) { return { speed: 0, angle: 0 }; } };
  M.storm = function (state) { try { return state.storms.current || null; } catch (e) { return null; } };
  /** The cone while a named storm (not a near-miss) is between NAMED and LANDFALL. */
  M.cone = function (state) {
    try {
      const st = state.storms.current;
      if (!st || st.nearMiss || st.phase < STORM.NAMED || st.phase > STORM.LANDFALL) return null;
      return { track: st.track, width: st.coneWidth, point: st.point, landfallDay: st.landfallDay, cat: st.cat, forecastCat: st.forecastCat };
    } catch (e) { BSU.error('weather', 'cone', e); return null; }
  };
  /** Forecast surge (ft): params.storm.surge[cat]; 5 ft when no cone exists (the default test height). */
  M.forecastSurge = function (state, catOverride) {
    try {
      if (typeof catOverride === 'number' && isFinite(catOverride)) return PS.surge[clamp(Math.round(catOverride), 0, 5)];
      const st = state.storms.current;
      if (st && !st.nearMiss) return PS.surge[clamp(st.forecastCat, 0, 5)];
      return PS.ringDefaultH;
    } catch (e) { BSU.error('weather', 'forecastSurge', e); return PS.ringDefaultH; }
  };
  /** {river, bayou, window} */
  M.riverStage = function (state) { try { return stagesFor(state, state.calendar.day); } catch (e) { return { river: 0, bayou: 0, window: false }; } };
  /** Tomorrow's queued cell (Coastal Institute minimap mark) or null. */
  M.tomorrowCell = function (state) {
    try {
      const q = state.weather.cellQueue;
      for (let i = 0; i < q.length; i++) if (q[i] && q[i].day === state.calendar.day + 1) return { cx: q[i].cx, cy: q[i].cy };
      return null;
    } catch (e) { return null; }
  };

  // ---------------------------------------------------------------------------
  // Public actions
  // ---------------------------------------------------------------------------
  /**
   * The ONE storm factory. `compressed` is REQUIRED (D51): true → tick-driven lifecycle (watch at tLandfall−300,
   * bands at −100, landfall at tLandfall); false → day-driven (landfallDay = day + ceil((landfallTick − T)/100)).
   * Returns the existing storm unchanged when one is already current.
   */
  M.spawnStorm = function (state, opts) {
    try {
      const o = opts || {};
      if (state.storms.current) return state.storms.current;
      if (typeof o.compressed !== 'boolean') { BSU.error('weather', 'spawnStorm', new Error('compressed must be a boolean (D51); treating as false')); o.compressed = false; }
      const T = state.tick;
      const landfallTick = fin(o.landfallTick, T + PS.coneDays * TPD);
      const st = makeStorm(state, { cat: o.cat, nearMiss: !!o.nearMiss, landfallTick: Math.max(T + 1, landfallTick), compressed: o.compressed, name: o.name, point: o.point, forecastCat: o.forecastCat, coneDays: o.coneDays });
      state.storms.current = st;
      state.storms.playThroughIt = false;
      const ce = state.storms.celestine;
      if (st.name !== 'Célestine' && ce && ce.state !== 'done') ce.state = 'done';   // D22: forced storms never overlap the scripted one
      emit(EV.STORM_NAMED, stormPayload(st));
      return st;
    } catch (e) { BSU.error('weather', 'spawnStorm', e); return state && state.storms ? state.storms.current : null; }
  };
  /** Schedule a scripted near-miss (Amélie) for an absolute day. */
  M.scheduleNearMiss = function (state, day, name) {
    try {
      const d = Math.max(state.calendar.day, Math.floor(fin(day, state.calendar.day + 1)));
      const nm = name || 'Amélie';
      const sched = state.storms.scheduled;
      for (let i = 0; i < sched.length; i++) if (sched[i] && sched[i].nearMiss && sched[i].name === nm) return;   // already scheduled
      if (d === state.calendar.day && !state.storms.current && !state.setPiece) {
        // Today (progress schedules on the date itself): run the pass now rather than a day late.
        state.storms.current = makeStorm(state, { cat: 1, nearMiss: true, landfallTick: state.tick, compressed: false, name: nm, point: celestinePoint(state), forecastCat: 1 });
        doNearMissPass(state, state.storms.current);
        return;
      }
      sched.push({ day: d, cat: 1, nearMiss: true, name: nm, point: celestinePoint(state), waved: true, watched: false, coneDays: 0 });
      sched.sort(function (a, b) { return a.day - b.day; });
    } catch (e) { BSU.error('weather', 'scheduleNearMiss', e); }
  };
  M.setPlayThrough = function (state, on) { try { state.storms.playThroughIt = !!on; } catch (e) { BSU.error('weather', 'setPlayThrough', e); } };
  M.setRunning = function (state, on) { try { state.calendar.running = !!on; state.calendar.frozen = !state.calendar.running || !!state.setPiece; } catch (e) { BSU.error('weather', 'setRunning', e); } };
  M.suppressRainOn = function (state, day) {
    try {
      const d = Math.floor(fin(day, NONE));
      state.weather.clearNightDay = d;
      state.weather.cellQueue = state.weather.cellQueue.filter(function (q) { return q && q.day !== d; });
      if (d === state.calendar.day) { state.weather.fog = 0; pv.fogTicksLeft = 0; pv.fogRoll = false; }
    } catch (e) { BSU.error('weather', 'suppressRainOn', e); }
  };
  /** progress pushes the two scripted cells: {day, cx, cy, inches, scripted}. */
  M.queueCell = function (state, q) {
    try {
      if (!q) return;
      const day = Math.floor(fin(q.day, state.calendar.day));
      const inches = fin(q.inches, PR.cellScripted);
      state.weather.cellQueue.push({ day: day, cx: clamp(Math.round(fin(q.cx, W / 2)), 0, W - 1), cy: clamp(Math.round(fin(q.cy, H / 2)), 0, H - 1), total: inches / PHY.inchesPerFoot, scripted: !!q.scripted });
    } catch (e) { BSU.error('weather', 'queueCell', e); }
  };
  /** hydro calls once per hydro step (D14): the intake for this step; ends the event at 0. */
  M.consumeRainStep = function (state) {
    try {
      const ev = state.weather.event;
      if (!ev) return null;
      const steps = Math.max(1, fin(ev.steps, 1));
      const out = { r: fin(ev.total, 0) / steps, cx: ev.cx, cy: ev.cy, radius: ev.radius, mapWide: !(ev.radius > 0) };
      ev.stepsLeft = fin(ev.stepsLeft, 0) - 1;
      if (ev.stepsLeft <= 0) endEvent(state);
      return out;
    } catch (e) { BSU.error('weather', 'consumeRainStep', e); return null; }
  };
  /** ui calls when the damage-report card closes (headless: at set-piece end): storm:passed, current cleared. */
  M.closeReport = function (state) {
    try {
      const st = state.storms.current;
      if (!st || st.nearMiss) return;
      if (st.phase !== STORM.RECOVERY) return;
      st.phase = STORM.PASSED;
      emit(EV.STORM_PASSED, stormPayload(st));
      state.storms.current = null;
      state.storms.playThroughIt = false;
    } catch (e) { BSU.error('weather', 'closeReport', e); }
  };
  /** Apply a toast answer (idempotent per id: the choice is recorded first, D43). */
  M.answerToast = function (state, id, answer) {
    try {
      const choices = choicesOf(state);
      if (!id || choices[id]) return;
      const a = (answer === 'yes' || answer === 'no') ? answer : 'default';
      choices[id] = a;
      delete pv.toastsOpened[id];
      const st = state.storms.current;
      if (id === 'sandbag') {
        if (a === 'yes' && call('economy', 'charge', state, PS.sandbagToastCost, 'prep') !== false) {
          call('buildings', 'sandbags', state, st ? st.surge : M.forecastSurge(state));
          if (st) st.sandbagged = true;
        }
      } else if (id === 'shelter') {
        if (a === 'yes' && call('economy', 'charge', state, PS.shelterToastCost, 'prep') !== false) {
          call('buildings', 'shelterOverflow', state);
          if (st) st.shelterOverflow = true;
        } else {
          call('progress', 'addTimer', state, 'hurricaneParty', P.econ.timers.hurricaneParty.value, PS.hurricanePartyDays);
          call('economy', 'addAttrition', state, PS.hurricanePartyAttrition);
        }
      } else if (id === 'fuel') {
        if (a === 'yes') {
          let gid = st ? st.fuelGeneratorId : NONE;
          if (gid < 0) { const gens = call('buildings', 'list', state, BSU.B.generator) || []; if (gens.length && gens[0]) gid = gens[0].id; }
          if (gid >= 0) call('buildings', 'refuel', state, gid);
        }
      } else if (id === 'gate') {
        if (a === 'yes' && st) st.gateCrew = true;
      }
    } catch (e) { BSU.error('weather', 'answerToast', e); }
  };
  /** Debug / progress.fireAllToasts: open one of the four landfall toasts with its real handler (outside a set piece too). */
  M._openToast = function (state, id) {
    try {
      if (id !== 'sandbag' && id !== 'shelter' && id !== 'fuel' && id !== 'gate') return;
      delete pv.choicesFallback[id];
      delete pv.toastsOpened[id];
      if (state.setPiece && state.setPiece.choices) delete state.setPiece.choices[id];
      openToast(state, id);
    } catch (e) { BSU.error('weather', '_openToast', e); }
  };
  /**
   * Skip the landfall (only if it was seen before and tick ≥ 150): every remaining hook to 750 runs synchronously with
   * toasts resolved by default; the surge is approximated by one 'stage' call at the peak, 90 calls of hydro.tick with
   * dtDay = 1/360 (hydro's own block gating decides how many of those are steps), then 'end' at the 750 hook; the set
   * piece is then jumped to tick 899 so session ends it next tick.
   */
  M.skipSetPiece = function (state) {
    try {
      const sp = state.setPiece, st = state.storms.current;
      if (!sp || sp.kind !== 'landfall' || !st) return;
      const seen = !!(state.progress && state.progress.setPiecesSeen && state.progress.setPiecesSeen.landfall);
      if (!seen || fin(sp.tick, 0) < PT.skipAfterTick) return;
      const from = fin(sp.tick, 0);
      while (pv.nextHookIdx < HOOKS.length && HOOKS[pv.nextHookIdx].tick < from) pv.nextHookIdx++;
      let peakDone = from > PHT.landfall;
      while (pv.nextHookIdx < HOOKS.length && HOOKS[pv.nextHookIdx].tick <= PHT.clearing) {
        const h = HOOKS[pv.nextHookIdx++];
        sp.tick = h.tick;
        if (h.tick >= PHT.landfall && !peakDone) {
          peakDone = true;
          surgeBegin(state, st);
          call('hydro', 'surgeControl', state, 'stage', st.surge);
          const keep = state.weather.dtDay;
          state.weather.dtDay = PHY.dtDayLandfall;
          for (let k = 0; k < LC.skipHydroTicks; k++) call('hydro', 'tick', state);
          state.weather.dtDay = keep;
        }
        try { h.fn(state, st, sp); } catch (e) { BSU.error('weather', 'skip:' + h.tick, e); }
        const ids = Object.keys(pv.toastsOpened);
        for (let i = 0; i < ids.length; i++) M.answerToast(state, ids[i], 'default');
      }
      sp.tick = PHT.end - 1;
      state.weather.rainRate = 0;
    } catch (e) { BSU.error('weather', 'skipSetPiece', e); }
  };
  /** Storm-panel prep actions: 'boardUp'|'sandbags'|'repairAll'|'evacuate'|'preDrain'|'spillway' → {ok, cost, reason}. */
  M.prepAction = function (state, action, arg) {
    const no = function (reason) { return { ok: false, cost: 0, reason: reason }; };
    try {
      if (action === 'spillway') return spillway(state);
      const st = state.storms.current;
      if (!st || st.nearMiss || st.phase < STORM.NAMED || st.phase > STORM.BANDS) return no('No storm');
      let r;
      switch (action) {
        case 'boardUp':
          r = call('buildings', 'boardUp', state, arg === undefined ? 'all' : arg);
          if (!r) return no('Not yet');
          if (r.ok && Array.isArray(arg)) for (let i = 0; i < arg.length; i++) if (st.boardQueue.indexOf(arg[i]) < 0) st.boardQueue.push(arg[i]);
          return { ok: !!r.ok, cost: fin(r.cost, 0), reason: r.ok ? '' : (r.reason || 'Refused') };
        case 'sandbags':
          r = call('buildings', 'sandbags', state, M.forecastSurge(state));
          if (!r) return no('Not yet');
          if (r.ok) st.sandbagged = true;
          return { ok: !!r.ok, cost: fin(r.cost, 0), reason: r.ok ? '' : (r.reason || 'Refused') };
        case 'repairAll':
          r = call('buildings', 'repairAllLevees', state);
          if (!r) return no('Not yet');
          return { ok: !!r.ok, cost: fin(r.cost, 0), reason: r.ok ? '' : (r.reason || 'Refused') };
        case 'evacuate': {
          if (st.evacuated) return no('Already evacuated');
          const students = fin(state.economy && state.economy.students, 0);
          const cost = PS.evacPer1000 * Math.ceil(students / 1000);
          if (call('economy', 'charge', state, cost, 'prep') === false) return no('Not enough cash');
          call('agents', 'evacuate', state);
          st.evacuated = true;
          call('progress', 'addTimer', state, 'evacuation', P.econ.timers.evacuation.value, PS.evacDays);
          return { ok: true, cost: cost, reason: '' };
        }
        case 'preDrain':
          if (st.preDrain) return no('Already pre-draining');
          st.preDrain = true;
          return { ok: true, cost: 0, reason: '' };
        default:
          return no('Unknown action');
      }
    } catch (e) { BSU.error('weather', 'prepAction', e); return no('Error'); }
  };
  /** Bonnet Roux Spillway (GDD §6.9; Tier 2 with hydro): once per year, 2–3 ft window, Year ≥ 3, Engineering Hall. */
  function spillway(state) {
    const SP = PW.spillway, w = state.weather, cal = state.calendar;
    const no = function (reason) { return { ok: false, cost: 0, reason: reason }; };
    if (cal.year < SP.fromYear) return no('Available from Year ' + SP.fromYear);
    if (call('buildings', 'has', state, BSU.B.engineering) !== true) return no('Needs an Engineering Hall');
    const s = stagesFor(state, cal.day);
    if (!s.window || fin(w.riverStage, 0) < SP.minStage) return no('Only during a 2–3 ft window');
    if (fin(w.spillwayUsedYear, 0) === cal.year) return no('Already opened this year');
    const hy = dep('hydro');
    if (!hy || typeof hy.spillway !== 'function') return no('Not yet');
    if (call('economy', 'charge', state, SP.cost, 'prep') === false) return no('Not enough cash');
    w.spillwayUsedYear = cal.year;
    call('hydro', 'spillway', state);
    return { ok: true, cost: SP.cost, reason: '' };
  }
  /** Debug: jam a floodgate tile for the current storm. */
  M.jamGate = function (state, i) {
    try {
      const t = Math.floor(fin(i, NONE));
      if (t < 0 || t >= W * H) return;
      const st = state.storms.current;
      if (st && st.jammedGates.indexOf(t) < 0) st.jammedGates.push(t);
      call('hydro', 'setJammed', state, t, true);
    } catch (e) { BSU.error('weather', 'jamGate', e); }
  };

  // ---------------------------------------------------------------------------
  // selfTest (§10.6): pure, private state, recorder instead of the live bus, stubbed siblings.
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const log = [];
    const saved = { emit: M._deps.emit, S: S, pv: pv, sim: R.state };
    const stubNames = ['session', 'hydro', 'buildings', 'sports', 'agents', 'progress', 'ui', 'economy', 'render'];
    const savedStubs = {};
    for (let i = 0; i < stubNames.length; i++) savedStubs[stubNames[i]] = M._deps[stubNames[i]];
    const A = BSU.assert;
    const stubs = {
      session: { startSetPiece: function (s, kind, o) { s.setPiece = { kind: kind, tick: 0, len: o.len, skippable: !!o.skippable, choices: {}, speedBefore: 1, cameraTouched: false }; } },
      hydro: { setStages: function () {}, forceSat: function () {}, riverAdjacent: function () { return []; }, surgeControl: function () {}, setJammed: function () {}, networks: function () { return []; }, markLeveeChange: function () {}, tick: function () {} },
      buildings: { has: function () { return false; }, list: function () { return []; }, damageReport: function () { return { bill: 1234, tarps: 2, held: [], overtopped: [], breached: [], flooded: [], choices: {} }; }, boundaryLevees: function () { return []; }, boardUp: function () { return { ok: true, cost: 0, queued: 0 }; }, sandbags: function () { return { ok: true, cost: 0, tiles: [] }; }, repairAllLevees: function () { return { ok: true, cost: 0 }; }, refuel: function () { return { ok: true, cost: 5000 }; }, shelterOverflow: function () {}, shelterAssignments: function () { return {}; } },
      sports: { upcoming: function () { return null; }, season: function (s) { return s.sports; }, postpone: function () {}, offerPlayThrough: function () {} },
      agents: { evacuate: function () {}, shelter: function () {}, crewSprites: function () {} },
      progress: { offered: function () { return true; }, setPieceSeen: function () { return false; }, addTimer: function () {}, ticker: function () {} },
      ui: { answerDecision: function () {} },
      economy: { charge: function () { return true; }, addAttrition: function () {}, bump: function () {} },
      render: { panToTile: function () {} }
    };
    const install = function () { for (const k in stubs) M._deps[k] = stubs[k]; };
    const names = function () { return log.map(function (e) { return e.name; }); };
    // A minimal session emulation: frozen flag, weather.tick, set-piece advance/end through the internal handler.
    const step = function (s, n) {
      for (let k = 0; k < n; k++) {
        s.calendar.frozen = !s.calendar.running || !!s.setPiece;
        M.tick(s);
        if (s.setPiece) {
          if (s.setPiece.tick + 1 >= s.setPiece.len) { const kind = s.setPiece.kind; s.setPiece = null; onSetPieceEnd(s, { kind: kind, len: 0 }); }
          else s.setPiece.tick++;
        }
        s.tick++;
        s.playSeconds = s.tick / 10;
      }
    };
    const fresh = function (seed) { const s = BSU.newState(seed); s.plot.mouth = [BSU.idx(40, 18), BSU.idx(41, 18), BSU.idx(42, 18)]; return s; };
    try {
      M._deps.emit = function (name, payload) { log.push({ name: name, payload: payload }); };
      install();
      // 1. Calendar math for 3 years + dayOf + dateToDay round trip.
      for (let d = 0; d < 360; d++) {
        const p = BSU.dayParts(d), yd = d % 120, m = Math.floor(yd / 10) + 1;
        const season = (m >= 3 && m <= 5) ? 'spring' : (m >= 6 && m <= 8) ? 'summer' : (m >= 9 && m <= 11) ? 'fall' : 'winter';
        const sem = (yd >= 4 && yd <= 44) ? 'spring' : (yd >= 45 && yd <= 73) ? 'summer' : (yd >= 74 && yd <= 109) ? 'fall' : 'break';
        A(p.year === Math.floor(d / 120) + 1 && p.month === m && p.dom === yd % 10 + 1 && p.season === season && p.semester === sem, 'calendar table day ' + d);
      }
      const s1 = fresh(5);
      A(M.dayOf(s1, 'Jan 5', 0) === 4 && M.dayOf(s1, 'Aug 5', 0) === 74 && M.dayOf(s1, 'Dec 10', 0) === 119 && M.dayOf(s1, 'Aug 5', 1) === 194, 'dayOf');
      for (let m = 1; m <= 12; m++) for (let d = 1; d <= 10; d++) { const str = BSU.monthName(m) + ' ' + d; const abs = BSU.dateToDay(str, 2); A(abs === 120 + (m - 1) * 10 + d - 1 && BSU.dayParts(abs).date === str, 'round trip ' + str); }
      A(M.dayOf(s1, 'Mar 25', 0) === -1 && M.isDate(s1, 'Nope 3') === false, 'unparsable dates → -1 / false');
      // 2. Sky cycle.
      A(SKY_TICKS.reduce(function (a, b) { return a + b; }, 0) === 300, 'sky ticks sum to 300');
      const s2 = fresh(5); M.reset(s2, true);
      log.length = 0;
      const seen = [];
      for (let k = 0; k < 300; k++) { M.tick(s2); s2.tick++; }
      for (let i = 0; i < log.length; i++) if (log[i].name === EV.SKY_PHASE) seen.push(log[i].payload.phase);
      A(s2.sky.phase === SKY.DAWN && s2.sky.cycleTick === 0 && s2.sky.phaseTick === 0, 'sky returns to DAWN/0 after 300 ticks');
      A(seen.length === 5 && seen.join() === [SKY.DAY, SKY.GOLDEN, SKY.DUSK, SKY.NIGHT, SKY.DAWN].join(), 'five sky:phase entries in order (' + seen.join() + ')');
      // 3. Rain draw statistics.
      const s3 = fresh(5); M.reset(s3, true);
      const rd = s3.weather.rainDays;
      A(rd.length >= 30 && rd.length <= 60, 'rain days in [30,60]: ' + rd.length);
      for (let i = 0; i < rd.length; i++) { const m = BSU.dayParts(rd[i].day).month; if (m >= 4 && m <= 9) A(rd[i].kind === 'cell', 'Apr–Sep cell'); else A(rd[i].kind !== 'cell', 'Oct–Mar not cell'); }
      notes.push('rainDays ' + rd.length);
      // 4. consumeRainStep on a shower.
      const s4 = fresh(5); M.reset(s4, true);
      startMapWide(s4, 'shower', PR.shower, 40, false);
      let n4 = 0;
      for (let k = 0; k < 40; k++) { const r = M.consumeRainStep(s4); A(r && Math.abs(r.r - 0.04 / 40) < 1e-12 && r.mapWide === true, 'shower step ' + k); n4++; }
      A(n4 === 40 && s4.weather.event === null && M.consumeRainStep(s4) === null, 'shower clears after 40 steps then null');
      // 5. dtDay rule.
      const s5 = fresh(5); M.reset(s5, true);
      const table = [[null, 0, 1 / 40], [null, 2, 1 / 40], [null, 5, 1 / 40], [null, 7, 1 / 40], [null, 1, 0], [null, 3, 0], [null, 9, 0], ['game', 0, 0], ['parade', 2, 0], ['graduation', 5, 0], ['montage', 7, 0], ['landfall', 1, 1 / 360], ['nearMiss', 3, 1 / 60]];
      for (let i = 0; i < table.length; i++) { s5.setPiece = table[i][0] ? { kind: table[i][0], tick: 0, len: 900, skippable: false, choices: {}, speedBefore: 1, cameraTouched: false } : null; s5.tick = 100 + table[i][1]; A(dtDayFor(s5) === table[i][2], 'dtDay ' + table[i][0] + ' T%10=' + table[i][1]); }
      s5.setPiece = null;
      // 6. Storm schedule for a Year-2 state.
      const s6 = fresh(5); M.reset(s6, true); s6.storms.celestine.state = 'done'; s6.calendar.running = true; s6.calendar.day = 119; s6.calendar.dayTick = 99; s6.tick = 11999; deriveCalendar(s6.calendar);
      step(s6, 1);
      A(s6.calendar.day === 120 && s6.calendar.year === 2, 'rolled into Year 2');
      const sched = s6.storms.scheduled;
      A(sched.length >= 1 && sched.length <= 3, 'schedule count 1–3: ' + sched.length);
      for (let i = 0; i < sched.length; i++) {
        const e = sched[i], yd = e.day - 120;
        A(yd >= 50 && yd <= 109, 'landfall in Jun 1–Nov 30: yd ' + yd);
        A(e.cat >= 1 && e.cat <= 5 && typeof e.name === 'string' && e.point >= 0, 'schedule entry shape');
        if (i > 0) A(e.day - sched[i - 1].day >= 15, 'storms ≥ 15 days apart');
      }
      notes.push('Y2 storms ' + sched.map(function (e) { return e.name + ' C' + e.cat + (e.nearMiss ? '(nm)' : '') + '@' + e.day; }).join(','));
      A(s6.weather.riverStage >= 1 && s6.weather.riverStage <= 3, 'riverStage drawn 1–3: ' + s6.weather.riverStage);
      // 7. Hold rule.
      const mk7 = function () { const s = fresh(5); M.reset(s, true); s.calendar.running = true; s.calendar.day = 80; s.calendar.dayTick = 99; s.tick = 8099; deriveCalendar(s.calendar); return s; };
      const s7a = mk7(); s7a.playSeconds = 100; M.tick(s7a); A(s7a.calendar.day === 81 && s7a.storms.current === null, 'no storm with playSeconds 100');
      const s7b = mk7(); s7b.playSeconds = 600; M._deps.progress = { offered: function () { return false; }, setPieceSeen: function () { return false; }, addTimer: function () {}, ticker: function () {} }; M.tick(s7b); A(s7b.storms.current === null, 'no storm when Objective 11 not offered');
      M._deps.progress = stubs.progress;
      const s7c = mk7(); s7c.playSeconds = 600; M.tick(s7c);
      const c7 = s7c.storms.current;
      A(c7 && c7.cat === 2 && c7.name === 'Célestine' && c7.landfallDay === s7c.calendar.day + 6 && c7.compressed === false && c7.tLandfall === -1 && s7c.storms.celestine.state === 'cone', 'Célestine cone on Sep 2');
      A(BSU.ty(c7.point) === 63 && BSU.tx(c7.point) === 41, 'Célestine point below the cove');
      // 8. spawnStorm compressed / day-driven.
      const s8 = fresh(5); M.reset(s8, true); log.length = 0;
      const st8 = M.spawnStorm(s8, { cat: 3, coneNowTick: 0, landfallTick: 600, compressed: true });
      A(st8.landfallDay === s8.calendar.day + 6 && st8.forecastCat >= 2 && st8.forecastCat <= 4 && st8.entry.length === 8 && st8.surge === 8 && st8.compressed === true && st8.tLandfall === 600, 'compressed spawn');
      A(names().filter(function (n) { return n === EV.STORM_NAMED; }).length === 1, 'one storm:named');
      A(M.spawnStorm(s8, { cat: 5, compressed: true, landfallTick: 900 }) === st8, 'a second spawn returns the current storm');
      const s8b = fresh(5); M.reset(s8b, true);
      const st8b = M.spawnStorm(s8b, { cat: 3, coneNowTick: 0, landfallTick: 600, compressed: false });
      A(st8b.compressed === false && st8b.tLandfall === -1 && st8b.landfallDay === 6, 'day-driven spawn');
      A(s8.storms.celestine.state === 'done', 'a forced storm marks Célestine done');
      // 9. Hook table.
      const ticks = M.LANDFALL_HOOK_TICKS;
      for (let i = 1; i < ticks.length; i++) A(ticks[i] >= ticks[i - 1], 'hooks sorted');
      const need = [0, 150, 250, 300, 350, 380, 400, 450, 480, 500, 550, 680, 750];
      for (let i = 0; i < need.length; i++) A(ticks.indexOf(need[i]) >= 0, 'hook ' + need[i]);
      A(M.TOAST_TICKS.join() === '300,330,400,450', 'toast ticks');
      // 10. Heat.
      let lo = 999, hi = -999;
      for (let k = 0; k < 100; k++) { const h = drawHeat(1, k % 2 === 0); lo = Math.min(lo, h); hi = Math.max(hi, h); A(h < PH.advisory, 'no Jan advisory'); }
      A(lo >= 49 && hi <= 64, 'Jan heat within 49–64 (' + lo + '..' + hi + ')');
      let augAdv = false;
      for (let k = 0; k < 100; k++) if (drawHeat(8, false) >= PH.advisory) augAdv = true;
      A(augAdv, 'Aug advisory possible');
      // 11. reset(false) draws nothing.
      const s11 = fresh(5); M.reset(s11, true);
      s11.weather.rainDays = [1, 2, 3, 4, 5, 6, 7].map(function (d) { return { day: d, kind: 'shower' }; });
      s11.calendar.running = true;
      const simBefore = R.state;
      M.reset(s11, false);
      A(R.state === simBefore && s11.weather.rainDays.length === 7 && s11.calendar.running === true, 'reset(false) draws nothing and keeps rainDays/running');
      M.reset(s11, true);
      A(R.state !== simBefore && s11.weather.rainDays.length !== 7 && s11.calendar.running === false, 'reset(true) redraws');
      // 12. Bands step + Play Through It offer.
      let offered = 0;
      M._deps.sports = { upcoming: function (s) { return { day: s.calendar.day, home: true, opp: 'x' }; }, season: function (s) { return s.sports; }, postpone: function () {}, offerPlayThrough: function () { offered++; } };
      const s12 = fresh(5); M.reset(s12, true);
      const st12 = M.spawnStorm(s12, { cat: 1, compressed: true, landfallTick: 600, forecastCat: 1 });
      doBands(s12, st12);
      A(offered === 1 && st12.phase === STORM.BANDS && s12.weather.event && s12.weather.event.kind === 'band', 'offerPlayThrough called once at forecast 1');
      const s12b = fresh(5); M.reset(s12b, true);
      const st12b = M.spawnStorm(s12b, { cat: 2, compressed: true, landfallTick: 600, forecastCat: 2 });
      doBands(s12b, st12b);
      A(offered === 1, 'not offered at forecast 2');
      M._deps.sports = stubs.sports;
      // 13. A forced Cat 3 reaches every phase at the right ticks (compressed lifecycle end to end).
      const s13 = fresh(5); M.reset(s13, true); s13.calendar.running = true; log.length = 0;
      const T0 = s13.tick;
      M.spawnStorm(s13, { cat: 3, coneNowTick: T0, landfallTick: T0 + 600, compressed: true });
      const at = {};
      const watchTick = function (name) { for (let i = 0; i < log.length; i++) if (log[i].name === name) return log[i].payload; return null; };
      for (let k = 0; k < 1600; k++) {
        step(s13, 1);
        if (at.watch === undefined && watchTick(EV.STORM_WATCH)) at.watch = s13.tick - 1;
        if (at.bands === undefined && watchTick(EV.STORM_BANDS)) at.bands = s13.tick - 1;
        if (at.landfall === undefined && watchTick(EV.STORM_LANDFALL)) at.landfall = s13.tick - 1;
      }
      A(at.watch === T0 + 300 && at.bands === T0 + 500 && at.landfall === T0 + 600, 'watch/bands/landfall at +300/+500/+600 (' + at.watch + ',' + at.bands + ',' + at.landfall + ')');
      const phases = log.filter(function (e) { return e.name === EV.STORM_PHASE; }).map(function (e) { return e.payload.phase + '@' + e.payload.t; });
      A(phases.join() === ['0@0', '1@150', '2@350', '3@450', '4@500', '5@750'].join(), 'phase events 0/150/350/450/500/750: ' + phases.join());
      const pulses = log.filter(function (e) { return e.name === EV.STORM_PULSE; }).map(function (e) { return e.payload.n; });
      A(pulses.join() === '1,2,3,4', 'four wind pulses');
      if (s13.storms.current && s13.storms.current.phase === STORM.RECOVERY) M.closeReport(s13);   // a browser (non-headless) waits for the report card
      A(names().indexOf(EV.STORM_REPORT) >= 0 && names().indexOf(EV.STORM_PASSED) >= 0, 'report and passed emitted');
      A(s13.storms.log.length === 1 && s13.storms.log[0].cat === 3 && s13.storms.log[0].damage === 1234 && s13.storms.current === null, 'log entry and current cleared');
      A(s13.storms.t1BandDay === -1 || s13.storms.t1BandDay > s13.calendar.day, 'T+1 band consumed or pending');
      const shelterToast = log.filter(function (e) { return e.name === EV.STORM_TOAST; });
      A(shelterToast.length >= 1 && shelterToast[0].payload.id === 'shelter', 'Year-1 shelter toast fired');
      A(s13.sky.scripted === false, 'sky released after the set piece');
      // finite scan of the private state
      const bad = (function scan(o, path, depth) {
        if (o === null || typeof o !== 'object' || depth > 8) return null;
        if (ArrayBuffer.isView(o)) { for (let i = 0; i < o.length; i++) if (!Number.isFinite(o[i])) return path + '[' + i + ']'; return null; }
        for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'number' && !Number.isFinite(v)) return path + '.' + k; if (v && typeof v === 'object') { const r = scan(v, path + '.' + k, depth + 1); if (r) return r; } }
        return null;
      })({ calendar: s13.calendar, sky: s13.sky, weather: s13.weather, storms: s13.storms }, 'state', 0);
      A(!bad, 'no non-finite value in owned branches: ' + bad);
      notes.push('landfall ok');
    } catch (e) {
      return { ok: false, notes: (e && e.stack) || String(e) };
    } finally {
      M._deps.emit = saved.emit;
      for (let i = 0; i < stubNames.length; i++) { if (savedStubs[stubNames[i]] === undefined) delete M._deps[stubNames[i]]; else M._deps[stubNames[i]] = savedStubs[stubNames[i]]; }
      S = saved.S; pv = saved.pv; R.state = saved.sim;
    }
    return { ok: true, notes: notes.join('; ') };
  };
})();
