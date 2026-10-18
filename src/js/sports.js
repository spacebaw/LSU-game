'use strict';
// ============================================================================
// BAYOU STATE — sports.js (module 9) → BSU.sports
// Owner of: state.sports (hasTeam, venue, the season schedule, record, coach,
//           candidates, starters, recruit, rating + terms, the player toggles,
//           rivalry streak, the in-progress game struct, the first-game days,
//           the scripted night day) plus the lazily-initialized saved keys
//           listed in docs/INTEGRATION_NOTES.md (clubOnly, homeWins,
//           losingSeasons, seasonDone, playbook, aggression, watchFull,
//           records, lastSummary — PLAN_FOOTBALL pass B; springDay,
//           springYear, lastSpring, prospects, seasonLog, seasonLines —
//           pass C: the Spring Game, the prospect board, season records).
// Engine:   PLAN_FOOTBALL §2.1 drive/play engine (pass B): eight position
//           ratings → four units → a per-play edge; run/pass/kick/clock tables
//           from params.sports.engine; highlights / full / montage / silent
//           modes; decisions (4th down, two-point, halftime) that pause the
//           set piece; live state for the renderer; summary, MVP, record book.
// Implements: ARCHITECTURE.md §1 row 9, §2.8, §3.2 params.sports, §3.4
//           (game:*, season:end, coach:changed, decision:closed), §5.1 step 8,
//           §5.9 (the API and the 750-tick timeline), D13, D43, D46, D49, D51;
//           GDD §8 (all of it), §0.3 rows 18–19 (venues), §5.2 (athletics
//           revenue), §5.6 (spirit / playThroughIt / goForIt timers), §6.2
//           (postponement, Play Through It, the Resilience Bowl), §10.4 (the
//           scripted night game), §10.5 milestones 12–15 (progress awards
//           them on our events; we call achieve for the rivalry/undefeated
//           ones the brief assigns to us), §14.1 (coaches, starters, hometowns),
//           §14.4 ticker lines 20, 42–44, 46, 60, 61.
// Rules: 'use strict' IIFE; zero DOM/timer/audio access at definition time;
//        every emit goes through M._deps.emit (§10.6); every cross-module call
//        goes through M._deps.<module> (default BSU.<module>) so selfTest can
//        stub them; all sim randomness through BSU.rng.sim in a fixed order;
//        reset draws nothing (the season is drawn on Aug 5 in tick); no state
//        on the module object (D46) — there is NO BSU.sports.game accessor, the
//        in-progress game is read as state.sports.game; no NaN/Infinity is
//        ever written into state (§10.3); no exception escapes a public
//        function (every one is wrapped → BSU.error('sports', where, e)).
// Local constants the GDD states but BSU.params does not carry are in `L`
// below and listed in docs/INTEGRATION_NOTES.md under "## sports.js".
// ============================================================================
(function () {
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const BSU = root.BSU;
  const M = (BSU.sports = BSU.sports || {});
  const P = BSU.params;
  const PS = P.sports;
  const PT = P.time;
  const EV = BSU.EV;
  const SKY = BSU.SKY;
  const STORM = BSU.STORM;
  const R = BSU.rng.sim;   // the one sim stream (never replaced, §3.3)

  // ---------------------------------------------------------------------------
  // Local constants (GDD numbers that BSU.params does not carry)
  // ---------------------------------------------------------------------------
  const L = Object.freeze({
    heatMonths: Object.freeze([8, 9]),        // §8: the −8 heat term applies in Aug–Sep
    recRadius: 10,                            // §8 / §0.3 row 21: a Rec Center within 10 of the field lifts the heat term
    seatsFallback: Object.freeze({ none: 0, bayou_field: 6000, stadium1: 15000, stadium2: 45000, stadium3: 80000 }),   // §0.3 rows 18–19 (data tiers win)
    nightVenues: Object.freeze({ stadium2: true, stadium3: true }),   // §8: night games from Stadium II
    scoreOffsets: Object.freeze([30, 70]),    // brief §4: home scores at +30, away at +70 within a 100-tick quarter
    montage: Object.freeze({ kickoff: 5, quarters: Object.freeze([10, 20, 30, 40]), halftime: 20, halftimeTicks: 20, final: 45 }),   // brief §4 (the toast's 30 ticks are cut to 20 so it resolves before Q3/Q4 and the 45 final)
    makeupDays: 5,                            // §6.2: a makeup within 5 days is the Resilience Bowl; none within 5 → cancelled
    wordUnderdog: 0.35, wordFavored: 0.65,    // brief §4: 'Underdog' < .35, 'Even' < .65, else 'Favored'
    firstCoach: 0, firstCoachStars: 2,        // §8: Coach Bobby Cheramie, 2★, comes with the field
    interimCoach: Object.freeze({ name: 'Interim Staff', stars: 1, rep: 'holding the clipboard' }),   // after fireCoach until a hire
    recruitPrices: Object.freeze(['$200k NIL fund', 'a Greek Row House within 8', 'a Rec Center', 'a Residence Tower']),   // §8 recruiting card
    recruitNil: 200000,                       // §8
    recruitPositions: Object.freeze(['QB', 'RB', 'WR', 'LB']),
    homecomingTiers: Object.freeze([0, 50000, 150000]),   // §5.9 (also params.econ.boardCards.homecomingBudget.costs)
    concessionsFallback: 12,                  // §5.2 (params.econ.concessions when present)
    pClamp: Object.freeze([0.001, 0.99]),     // P ∈ (0, 1); the Habitat's +.05 is clamped ≤ .99 (brief §4)
    neutralWinPct: 0.5,                       // winPctLast4 with no history: neutral hype (documented)
    bowlOppFallback: 'crescent',              // the bowl opponent when every opponent was on the schedule (never with 7 of 9)
    // --- pass B engine gaps (PLAN_FOOTBALL §2.1 gave no numbers) ---
    bsuNick: 'Tigers',                        // {off}/{def} phrase nickname for BSU (Roux is a tiger)
    oppStyle: Object.freeze({ ground: Object.freeze({ RB: 5, OL: 3, QB: -4, WR: -3 }), balanced: Object.freeze({}), air: Object.freeze({ QB: 5, WR: 4, RB: -4 }) }),   // opponent position shape around starterBase
    noAdj: Object.freeze({ runShare: 0, big: 1, to: 1, clockAdd: 0 }),   // the opponent never adjusts at halftime
    venueTier: Object.freeze({ none: 0, bayou_field: 0, stadium1: 1, stadium2: 2, stadium3: 3 }),   // index into engine.homeField arrays
    habitatAdv: 2, awayFill: 0.5,             // the Habitat's +.05 win chance as home-advantage points; crowd fill assumed at the opponent's place
    otSpot: 25, otMaxRounds: 8, otTwoFrom: 3, otRemSec: 30,   // overtime: possessions from the opponent's 25, two-point tries from round 3, live-estimate time left
    intAirYds: 8, timeoutSec: 5, playGuard: 2000,   // interception depth, a timeout's stoppage, the per-game play cap (never reached)
    convBase: 0.78, convPerYd: 0.07, convEdge: 0.05, convMin: 0.15, convMax: 0.9,   // 4th-down conversion estimate for the toast odds
    epDiv: 14, epBase: 1.3,                   // expected points of a possession ≈ own/14 − 1.3 (the live estimate's field-position term)
    fullPlaysEstimate: 135,                   // watch-full-game set-piece length: baseTicks + 135 × perPlayTicks + tailTicks
    // --- pass C: the Spring Game, prospects, records ---
    springOpp: 'gold', springNames: Object.freeze(['Purple', 'Gold']), springAbbr: 'GLD', springTitle: 'Purple & Gold Spring Game',
    drillCycleTicks: 60, drillLos: 50,        // the idle practice drill: a two-formation loop every 60 ticks at midfield
    recruitClass: 'Fr', seasonLogMax: 12, hofMax: 60   // a signed prospect arrives as a freshman; per-season game log cap; Hall of Fame cap
  });
  const TOAST_TICKS = PT.toastTicks;          // 80
  const CONCESSIONS = (P.econ && typeof P.econ.concessions === 'number') ? P.econ.concessions : L.concessionsFallback;
  const NONE = -1;
  const PE = PS.engine;                       // PLAN_FOOTBALL §2.1 engine tables (pass A)
  const POS = PE.positions;                   // the eight rated positions in slot order
  const BSU_T = 0, OPP_T = 1;                 // engine team index (0 = BSU, 1 = the opponent)
  // PLAN_V2 P1: the coaching staff (the head coach is state.sports.coach, mirrored as staff.hc; coordinators in state.sports.staff)
  const PF = PS.staff || { perRole: 3, starsPerPrestige: 20, reachStars: 1, reachSalary: 1.6, yearsMin: 2, yearsMax: 4, renewYears: 2, buyoutShare: 0.5, interimStarsMax: 2, ocCompositePerStar: 3, ocFit: 4, dcCompositePerStar: 3, dcTurnoverPerStar: 0.04, hcGoDist: { ground: -1, balanced: 0, air: 1 }, hcHalftimePerStar: 0.1, poach: { stars: 4, prestige: 40, p: 0.35, raise: 0.25, offerDate: 'Nov 8' } };
  const ROLES = Object.freeze(['hc', 'oc', 'dc']);
  // PLAN_V2 P2: the roster (state.sports.roster), the depth chart, walk-ons, development, dinged starters, the prospect board
  const PR = PS.roster || { classes: ['Fr', 'So', 'Jr', 'Sr'], eligibilityYears: 4, maxPerPos: 4, maxPerSideClass: 4, walkOn: { min: 50, max: 58 }, prospect: { perPos: 2, base: 60, perPrestige: 0.35, bonusMax: 10, sd: 8, min: 50, max: 95 }, cost: { base: 20000, perPoint: 6000, from: 60, round: 1000 }, dev: { min: 2, max: 5, perStar: 1, floor: 1, cap: 99 }, dinged: { p: 0.05, games: 1 }, gradDate: 'May 5', reminderDays: 7 };
  const CLASSES = PR.classes;

  // ---------------------------------------------------------------------------
  // Dependencies (injectable, §10.6). selfTest replaces entries for its duration.
  // ---------------------------------------------------------------------------
  M._deps = {
    emit: function (name, payload) { BSU.events.emit(name, payload); }
  };
  /** Resolve a sibling module: an explicit stub in M._deps wins; otherwise the live BSU.<name>. */
  function dep(name) { const d = M._deps[name]; return d !== undefined ? d : BSU[name]; }
  /** Call dep(name).fn(...args) if it exists; missing module/function → fallback (undefined); a throw → BSU.error. */
  function call(name, fn) {
    const mod = dep(name);
    if (!mod || typeof mod[fn] !== 'function') return undefined;
    const args = Array.prototype.slice.call(arguments, 2);
    try { return mod[fn].apply(mod, args); }
    catch (e) { BSU.error('sports', name + '.' + fn, e); return undefined; }
  }
  function emit(name, payload) { M._deps.emit(name, payload); }
  function data() { return dep('data') || BSU.data || {}; }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function num(v, d) { return (typeof v === 'number' && Number.isFinite(v)) ? v : d; }
  function int(v, d) { return Number.isFinite(v) ? Math.round(v) : d; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function today(state) { return num(state.calendar && state.calendar.day, 0); }
  function parts(state) { return BSU.dayParts(today(state)); }
  function yearOf(state) { return parts(state).year; }
  function dayOfDate(str, year) { const d = BSU.dateToDay(str, year); return Number.isFinite(d) ? d : NONE; }
  function isDate(state, str) { return today(state) === dayOfDate(str, yearOf(state)); }
  function sum4(a) { let s = 0; for (let i = 0; i < a.length; i++) s += num(a[i], 0); return s; }
  function complete(b) { return !!b && num(b.built, 0) >= 1 && !b.ruin; }
  /** Chebyshev distance between two footprint rectangles (0 when they touch/overlap). */
  function rectDist(a, b) {
    const dx = Math.max(0, b.tx - (a.tx + a.w - 1), a.tx - (b.tx + b.w - 1));
    const dy = Math.max(0, b.ty - (a.ty + a.h - 1), a.ty - (b.ty + b.h - 1));
    return Math.max(dx, dy);
  }
  function oppInfo(key) { const o = data().opponents; return (o && o[key]) ? o[key] : null; }
  function oppName(key) { if (key === L.springOpp) return L.springNames[1] + ' squad'; const o = oppInfo(key); return o ? String(o.name).replace(/ University$/, '') : String(key); }
  function oppBaseRating(key) { const o = oppInfo(key); return o ? num(o.rating, 50) : 50; }
  function isRival(key) { const o = oppInfo(key); return !!(o && o.rival); }
  function probWord(p) { return p < L.wordUnderdog ? 'Underdog' : (p < L.wordFavored ? 'Even' : 'Favored'); }
  function pct(p) { return Math.round(p * 100) + '%'; }

  // ---------------------------------------------------------------------------
  // Private per-game closure state (rebuilt in reset; nothing here is saved)
  // ---------------------------------------------------------------------------
  let S = null;    // the bound root
  let pv = null;   // private volatile flags
  function rebind(state) {
    S = state;
    pv = {
      lastDay: today(state),
      venueDirty: true,
      pending: NONE,                 // schedule index of a home game waiting for a free set-piece slot
      awaiting: NONE,                // schedule index of a home game waiting on the playThrough toast
      playThrough: null,             // {day, tick, answered} — the open Play Through It toast (not saved)
      playThroughAnsweredDay: NONE,  // D43 guard: one answer per day
      springTriedDay: NONE,          // pass C: one Spring Game start attempt per day (a busy day defers to tomorrow)
      landfallNow: false,            // storm:landfall seen this tick → postpone in tick
      passedDay: NONE                // storm:passed seen → schedule makeups from this day
    };
  }
  /** Lazily-initialized saved keys (contract.js is frozen) and finite-guarding of the saved branch. */
  function ensureKeys(state) {
    const sp = state.sports;
    if (typeof sp.clubOnly !== 'boolean') sp.clubOnly = sp.venue === 'none';
    if (!Number.isFinite(sp.homeWins)) sp.homeWins = 0;
    if (!Number.isFinite(sp.losingSeasons)) sp.losingSeasons = 0;
    if (typeof sp.seasonDone !== 'boolean') sp.seasonDone = false;
    if (!sp.record || typeof sp.record !== 'object') sp.record = { wins: 0, losses: 0, last4: [] };
    if (!Array.isArray(sp.record.last4)) sp.record.last4 = [];
    sp.record.wins = int(sp.record.wins, 0); sp.record.losses = int(sp.record.losses, 0);
    if (!Array.isArray(sp.schedule)) sp.schedule = [];
    if (!Array.isArray(sp.starters)) sp.starters = [];
    if (!Array.isArray(sp.candidates)) sp.candidates = [];
    if (!sp.coach || typeof sp.coach !== 'object') sp.coach = { name: '', stars: 0, hiredYear: 0, quote: '', rep: '' };
    ensureStaff(state);   // PLAN_V2 P1: staff.hc IS sp.coach; a pre-P1 save gets interim coordinators and its candidates under staff.candidates.hc
    if (!sp.lastSeason || typeof sp.lastSeason !== 'object') sp.lastSeason = { wins: 0, losses: 0, bowlWon: false, undefeated: false };
    if (!sp.ratingTerms || typeof sp.ratingTerms !== 'object') sp.ratingTerms = {};
    sp.rating = num(sp.rating, 0);
    sp.rivalryLossStreak = int(sp.rivalryLossStreak, 0);
    sp.seasonYear = int(sp.seasonYear, 0);
    sp.firstHomeGameDay = int(sp.firstHomeGameDay, NONE);
    sp.firstNightGameDay = int(sp.firstNightGameDay, NONE);
    sp.scriptedNightDay = int(sp.scriptedNightDay, NONE);
    if (sp.permits !== 'free') sp.permits = 'paid';
    if (L.homecomingTiers.indexOf(sp.homecomingBudget) < 0) sp.homecomingBudget = 0;
    // PLAN_FOOTBALL pass B: the player's engine controls, the summary and the record book
    if (sp.playbook !== 'ground' && sp.playbook !== 'air') sp.playbook = 'balanced';
    if (sp.aggression !== 'conservative' && sp.aggression !== 'aggressive') sp.aggression = 'normal';
    if (typeof sp.watchFull !== 'boolean') sp.watchFull = false;
    if (sp.lastSummary === undefined || (sp.lastSummary !== null && typeof sp.lastSummary !== 'object')) sp.lastSummary = null;
    if (!sp.records || typeof sp.records !== 'object') sp.records = {};
    ensureRecords(sp.records);
    if (sp.hasTeam && sp.starters.length > 0 && sp.starters.length < POS.length) fillStarters(state);   // a pre-engine save: 3 starters → 8 (the originals stay)
    // PLAN_FOOTBALL pass C: the Spring Game, the prospect board, the season log / stat lines
    sp.springDay = int(sp.springDay, NONE);
    sp.springYear = int(sp.springYear, 0);
    if (sp.lastSpring === undefined || (sp.lastSpring !== null && typeof sp.lastSpring !== 'object')) sp.lastSpring = null;
    if (sp.prospects === undefined || (sp.prospects !== null && typeof sp.prospects !== 'object')) sp.prospects = null;
    if (sp.prospects && !Array.isArray(sp.prospects.list)) sp.prospects = null;
    if (!Array.isArray(sp.seasonLog)) sp.seasonLog = [];
    if (!sp.seasonLines || typeof sp.seasonLines !== 'object') sp.seasonLines = newLines();
    // PLAN_V2 P3: the athletics budget (a pre-P3 save gets one from its prestige and last season; revenue starts at 0)
    if (!sp.budget || typeof sp.budget !== 'object') initBudget(state); else budgetOf(state);
    ensureRoster(state);   // PLAN_V2 P2: the roster behind the starters (a pre-P2 save adopts its eight; backups come with the next tick)
  }

  // ---------------------------------------------------------------------------
  // Venue and team queries
  // ---------------------------------------------------------------------------
  /** The largest complete home venue: {venue, building|null, seats, nightCapable, hp} (pure over state). */
  function venueInfo(state) {
    let best = null, tier = 0;
    const stadiums = call('buildings', 'list', state, 'stadium') || [];
    for (let i = 0; i < stadiums.length; i++) {
      const b = stadiums[i];
      if (complete(b) && num(b.tier, 0) >= 1 && num(b.tier, 0) > tier) { best = b; tier = num(b.tier, 0); }
    }
    let venue = 'none';
    if (best) venue = 'stadium' + clamp(tier, 1, 3);
    else {
      const fields = call('buildings', 'list', state, 'practice_field') || [];
      for (let i = 0; i < fields.length; i++) { const b = fields[i]; if (complete(b) && num(b.tier, 0) >= 1) { best = b; venue = 'bayou_field'; break; } }
    }
    return { venue: venue, building: best, seats: seatsFor(venue), nightCapable: !!L.nightVenues[venue], hp: best ? clamp(num(best.hp, 1), 0, 1) : 1 };
  }
  /** Seats per venue from the data tiers (fallback: the GDD numbers). */
  function seatsFor(venue) {
    try {
      const cat = data().catalog;
      if (cat) {
        if (venue === 'bayou_field' && cat.practice_field && cat.practice_field.tiers[0]) return num(cat.practice_field.tiers[0].seats, L.seatsFallback.bayou_field);
        if (venue.indexOf('stadium') === 0 && cat.stadium) { const t = parseInt(venue.slice(7), 10); const row = cat.stadium.tiers[t - 1]; if (row) return num(row.seats, L.seatsFallback[venue]); }
      }
    } catch (e) { /* fall through to the fallback */ }
    return num(L.seatsFallback[venue], 0);
  }
  function hasField(state) { return call('buildings', 'has', state, 'practice_field') === true; }
  function habitatComplete(state) { return call('buildings', 'has', state, 'tiger_habitat') === true; }
  function habitatBonus() {
    try { const row = data().catalog && data().catalog.tiger_habitat; const v = row && row.effects && row.effects.homeWinBonus; return num(v, 0.05); } catch (e) { return 0.05; }
  }
  /** A complete Rec Center within L.recRadius (Chebyshev between footprints) of any complete practice field. */
  function recCenterNearField(state) {
    const recs = (call('buildings', 'list', state, 'rec_center') || []).filter(complete);
    if (!recs.length) return false;
    const fields = (call('buildings', 'list', state, 'practice_field') || []).filter(complete);
    for (let i = 0; i < fields.length; i++) for (let j = 0; j < recs.length; j++) if (rectDist(fields[i], recs[j]) <= L.recRadius) return true;
    return false;
  }
  /** Complete Greek Row houses within params greekRadius of the venue footprint. */
  function greekNearVenue(state, vb) {
    if (!vb) return 0;
    const houses = (call('buildings', 'list', state, 'greek_house') || []).filter(complete);
    let n = 0;
    for (let i = 0; i < houses.length; i++) if (rectDist(vb, houses[i]) <= PS.greekRadius) n++;
    return n;
  }
  function venueTile(state) {
    const v = venueInfo(state);
    return v.building ? BSU.idx(clamp(v.building.tx + v.building.w - 1, 0, 63), clamp(v.building.ty + v.building.h - 1, 0, 63)) : NONE;
  }
  /** Recompute hasTeam / venue / clubOnly; the first-team coach + starters; venue transitions mid-season. */
  function refreshTeam(state) {
    pv.venueDirty = false;
    const sp = state.sports;
    const hadTeam = sp.hasTeam;
    const prevVenue = sp.venue;
    sp.hasTeam = hasField(state);
    const v = venueInfo(state);
    sp.venue = v.venue;
    sp.clubOnly = sp.venue === 'none';
    if (sp.hasTeam && !hadTeam) {
      if (!sp.coach || !sp.coach.name) {
        const c = (data().coaches || [])[L.firstCoach] || { name: 'Bobby Cheramie', rep: 'has played in worse', style: 'balanced' };
        sp.coach = { name: c.name, role: 'hc', stars: L.firstCoachStars, style: c.style || 'balanced', salary: coachSalary(L.firstCoachStars, 'hc'), years: Math.max(1, int(PF.yearsMax, 4) - 1), hiredYear: yearOf(state), quote: coachQuote(c.name), rep: c.rep, reach: false, interim: false };
        ensureStaff(state);
        emit(EV.COACH_CHANGED, { role: 'hc', name: sp.coach.name, stars: sp.coach.stars });
      } else ensureStaff(state);   // PLAN_V2 P1: interim coordinators arrive with the team
      if (!sp.starters.length) sp.starters = drawStarters(state);
      initRoster(state);   // PLAN_V2 P2: the eight become juniors and seniors, walk-ons back them up
      scheduleSpring(state, true);   // PLAN_FOOTBALL §2.4: the Spring Game three days after the field completes (Jan 1 – Jul 10)
    }
    if (sp.hasTeam && !sp.rosterInit && sp.starters.length) initRoster(state);   // P2: a pre-P2 save with a team gets its backups on the first tick
    if (!sp.hasTeam && hadTeam) {
      // the field is gone (ruin/demolition): remaining games are cancelled, the rating collapses
      for (let i = 0; i < sp.schedule.length; i++) { const e = sp.schedule[i]; if (e && !e.played) { e.played = true; e.result = null; e.cancelled = true; } }
      sp.rating = 0; sp.ratingTerms = {};
    }
    if (prevVenue === 'none' && sp.venue !== 'none' && sp.schedule.length && !sp.seasonDone) {
      // Bayou Field/stadium completed mid-season: unplayed club entries revert to the data's home dates
      const ds = data().schedule || [];
      for (let i = 0; i < sp.schedule.length; i++) {
        const e = sp.schedule[i];
        if (!e || e.played || e.kind !== 'club') continue;
        const row = ds[num(e.slot, NONE)];
        if (row && row.home) { e.home = true; e.kind = row.kind || 'regular'; e.night = nightFor(state, e); }
        else if (row) e.kind = row.kind || 'regular';
      }
    }
    refreshNights(state);
    if (sp.hasTeam && (!hadTeam || prevVenue !== sp.venue)) storeRating(state);   // the Season panel never sees a stale 0 on the team's first day
  }
  function refreshNights(state) {
    const sp = state.sports;
    for (let i = 0; i < sp.schedule.length; i++) { const e = sp.schedule[i]; if (e && !e.played && e.home) e.night = nightFor(state, e); }
  }
  /** GDD §8: night is forced for Homecoming/rivalry and the scripted night day at a night-capable venue; otherwise the toggle. Bayou Field: never. */
  function nightFor(state, e) {
    const sp = state.sports;
    if (!e.home) return false;
    const v = venueInfo(state);
    if (!v.nightCapable) return false;
    if (sp.scriptedNightDay >= 0 && sp.scriptedNightDay === e.day) return true;
    const k = e.origKind || e.kind;
    if (k === 'homecoming' || k === 'rivalry') return true;
    return !!sp.nightToggle;
  }

  // ---------------------------------------------------------------------------
  // Names, coaches, starters (GDD §14.1)
  // ---------------------------------------------------------------------------
  /** §14.1 name generator (fixed rng order: modern?, first, last, nickname?, nick). */
  function drawName() {
    const D = data().students || {};
    const modern = D.firstModern || ['Tyler'], cajun = D.firstCajun || ['Beau'], last = D.last || ['Boudreaux'], nicks = D.nicknames || ['Tee'];
    const first = R.chance(num(D.modernShare, 0.25)) ? R.pick(modern) : R.pick(cajun);
    const ln = R.pick(last);
    const nick = R.chance(num(D.nicknameShare, 0.12)) ? R.pick(nicks) : null;
    return nick ? first + ' "' + nick + '" ' + ln : first + ' ' + ln;
  }
  function drawHometown() { const h = (data().students || {}).hometowns; return (h && h.length) ? R.pick(h) : 'Houma'; }
  function coachQuote(name) { const q = data().coachQuotes || []; return q.length ? q[BSU.strHash(name) % q.length] : ''; }
  /** PLAN_FOOTBALL pass A roster pools: men of firstCajun / firstModern, last names, nicknames (fixed draw order: modern?, first, last, nick?, nick). */
  function fbName() {
    const F = (data().football || {}).roster, N = F && F.names;
    if (!N) return drawName();
    const first = R.chance(num(N.modernShare, 0.3)) ? R.pick(N.modern && N.modern.length ? N.modern : ['Tyler']) : R.pick(N.first && N.first.length ? N.first : ['Beau']);
    const ln = R.pick(N.last && N.last.length ? N.last : ['Boudreaux']);
    const nick = R.chance(num(N.nickShare, 0.25)) ? R.pick(N.nick && N.nick.length ? N.nick : ['Tee']) : null;
    return nick ? first + ' "' + nick + '" ' + ln : first + ' ' + ln;
  }
  function drawClass() {
    const F = (data().football || {}).roster; const cls = (F && F.classes) || ['Fr', 'So', 'Jr', 'Sr'], w = (F && F.classWeights) || [0.25, 0.25, 0.25, 0.25];
    let u = R.float(), tot = 0; for (let i = 0; i < w.length; i++) tot += w[i]; u *= tot > 0 ? tot : 1;
    for (let i = 0; i < cls.length; i++) { u -= num(w[i], 0); if (u < 0) return cls[i]; }
    return cls[cls.length - 1];
  }
  /** One starter at pos (§8): rating clamp(round(55 + prestige/2 + 5 × stars + U(−6, 6)), 60, 99), plus a class (PLAN_FOOTBALL §2.1). */
  function drawStarter(state, pos) {
    const e = state.economy || {}, sr = PS.starterRating;
    const stars = num(state.sports.coach && state.sports.coach.stars, L.firstCoachStars);
    const name = fbName();
    const hometown = drawHometown();
    const raw = sr.base + num(e.prestige, 10) / sr.prestigeDiv + sr.perStar * stars + R.range(-6, 6);
    return { name: name, pos: pos, hometown: hometown, rating: clamp(Math.round(raw), sr.min, sr.max), class: drawClass() };
  }
  /** The eight starters in slot order (PLAN_FOOTBALL §2.1). */
  function drawStarters(state) {
    const out = [];
    for (let i = 0; i < POS.length; i++) out.push(drawStarter(state, POS[i]));
    return out;
  }
  /** Draw only the positions missing from state.sports.starters (migration and the Aug 5 lock); keeps slot order. */
  function fillStarters(state) {
    const sp = state.sports, m = starterMap(sp), out = [];
    for (let i = 0; i < POS.length; i++) out.push(m[POS[i]] || drawStarter(state, POS[i]));
    sp.starters = out;
  }
  function meanStarterRating(state) {
    const st = state.sports.starters;
    if (!st || !st.length) return PS.starterBase;
    let s = 0; for (let i = 0; i < st.length; i++) s += num(st[i].rating, PS.starterBase);
    return s / st.length;
  }
  /** May 5 (pre-P2 name, kept for the hook): the P2 graduation — classes advance, seniors leave, walk-ons fill the empty slots → the number who left */
  function seniorsLeave(state) { return graduate(state).left.length; }

  // ---------------------------------------------------------------------------
  // PLAN_V2 P2: the roster you build. state.sports.roster holds every player {name, pos, rating, classYear, class,
  // hometown, signedYear, cost (per year), dinged (games), walkOn}; state.sports.starters stays the eight-slot view
  // the engine, the records and the UI read (the same objects, re-derived by pickStarters after every roster change;
  // an outside write to sp.starters — a load's copies, a test's override — is adopted by reconcile).
  // ---------------------------------------------------------------------------
  function unitSide(pos) { return POS.indexOf(pos) < POS.length / 2 ? 'offense' : 'defense'; }
  function classIdx(c) { return CLASSES.indexOf(c); }
  function rosterOf(sp) { if (!Array.isArray(sp.roster)) sp.roster = []; return sp.roster; }
  function byRating(a, b) { return (b.rating - a.rating) || (classIdx(b.classYear) - classIdx(a.classYear)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
  /** finite-guard a player record in place (classYear canonical; `class` mirrors it for the pre-P2 readers) */
  function normPlayer(p, year, i) {
    if (!p || typeof p !== 'object') return null;
    p.name = String(p.name || 'Walk-on'); if (POS.indexOf(p.pos) < 0) p.pos = POS[0];
    p.hometown = String(p.hometown || 'Houma');
    p.rating = clamp(int(p.rating, PS.starterBase), 1, int(PR.dev.cap, 99));
    let c = p.classYear || p.class; if (classIdx(c) < 0) c = CLASSES[2 + (int(i, 0) % 2)];
    p.classYear = c; p.class = c;
    p.signedYear = int(p.signedYear, year); p.cost = Math.max(0, int(p.cost, 0)); p.dinged = Math.max(0, int(p.dinged, 0)); p.walkOn = !!p.walkOn;
    if (p.title !== undefined && typeof p.title !== 'string') delete p.title;
    return p;
  }
  function playersAt(sp, pos) { const out = [], r = rosterOf(sp); for (let i = 0; i < r.length; i++) if (r[i] && r[i].pos === pos) out.push(r[i]); out.sort(byRating); return out; }
  /** the roster array exists and is sane; outside writes to sp.starters are adopted */
  function ensureRoster(state) {
    const sp = state.sports, year = yearOf(state);
    if (!Array.isArray(sp.roster)) { sp.roster = []; sp.rosterInit = false; }
    const r = sp.roster;
    for (let i = r.length - 1; i >= 0; i--) if (!normPlayer(r[i], year, i)) r.splice(i, 1);
    if (typeof sp.rosterInit !== 'boolean') sp.rosterInit = r.length > 0;
    reconcile(state);
  }
  /** relink sp.starters to the roster: a copy (a load) by name + position, a new object (a test, pre-P2 code) joins as that position's starter */
  function reconcile(state) {
    const sp = state.sports, r = rosterOf(sp), st = sp.starters, year = yearOf(state);
    if (!Array.isArray(st)) { sp.starters = []; return; }
    for (let i = 0; i < st.length; i++) {
      const x = st[i]; if (!x || typeof x !== 'object' || r.indexOf(x) >= 0) continue;
      normPlayer(x, year, i);
      let twin = null; for (let j = 0; j < r.length; j++) if (r[j].name === x.name && r[j].pos === x.pos) { twin = r[j]; break; }
      if (twin) { twin.rating = x.rating; twin.classYear = x.classYear; twin.class = x.classYear; twin.hometown = x.hometown; twin.dinged = x.dinged; st[i] = twin; }
      else { r.push(x); cutToCap(state, x.pos, x); }
    }
  }
  /** a free walk-on at pos (fixed draw order: name, hometown, rating, class) */
  function addWalkOn(state, pos) {
    const w = PR.walkOn, lo = int(w.min, 50), hi = int(w.max, 58);
    const p = { name: fbName(), pos: pos, hometown: drawHometown(), rating: lo + R.int(Math.max(1, hi - lo + 1)), classYear: drawClass(), signedYear: yearOf(state), cost: 0, dinged: 0, walkOn: true };
    normPlayer(p, yearOf(state), 0); rosterOf(state.sports).push(p);
    return p;
  }
  /** at most maxPerPos bodies at pos: the weakest other than `keep` are released (→ the cut players) */
  function cutToCap(state, pos, keep) {
    const sp = state.sports, out = [];
    let ps = playersAt(sp, pos);
    while (ps.length > int(PR.maxPerPos, 4)) {
      let k = ps.length - 1; while (k >= 0 && ps[k] === keep) k--; if (k < 0) break;
      const p = ps[k]; removePlayer(sp, p); out.push(p); ps = playersAt(sp, pos);
    }
    return out;
  }
  function removePlayer(sp, p) { const r = rosterOf(sp), i = r.indexOf(p); if (i >= 0) r.splice(i, 1); const k = sp.starters.indexOf(p); if (k >= 0) sp.starters.splice(k, 1); }
  /** the eight starters from the roster: the best healthy body per position (a dinged starter sits; all dinged → the best plays); an empty slot gets a walk-on */
  function pickStarters(state) {
    const sp = state.sports, out = [];
    const bodies = rosterOf(sp).length > 0 || sp.hasTeam;
    for (let i = 0; i < POS.length; i++) {
      const ps = playersAt(sp, POS[i]);
      if (!ps.length) { if (!bodies) continue; ps.push(addWalkOn(state, POS[i])); }
      let k = 0; for (let j = 0; j < ps.length; j++) if (!ps[j].dinged) { k = j; break; }
      out.push(ps[k]);
    }
    sp.starters = out;
    return out;
  }
  /** the first team / a pre-P2 save: the eight starters become juniors and seniors, every position gets a walk-on backup */
  function initRoster(state) {
    const sp = state.sports; reconcile(state);
    const r = rosterOf(sp);
    for (let i = 0; i < r.length; i++) if (!r[i].walkOn) { r[i].classYear = CLASSES[2 + (i % 2)]; r[i].class = r[i].classYear; }
    for (let i = 0; i < POS.length; i++) while (playersAt(sp, POS[i]).length < 2) addWalkOn(state, POS[i]);
    sp.rosterInit = true;
    pickStarters(state);
  }
  function addPlayer(state, p) {
    const sp = state.sports; normPlayer(p, yearOf(state), 0); rosterOf(sp).push(p);
    const cut = cutToCap(state, p.pos, p); pickStarters(state);
    return { player: p, cut: cut };
  }
  function nameList(ps) { return ps.map(function (p) { return p.pos + ' ' + p.name; }).join(', '); }
  /** gradDate: every class advances, seniors leave (a ticker line names them), a walk-on fills any starter slot left empty → {left[], walkOns} */
  function graduate(state) {
    const sp = state.sports; reconcile(state);
    const r = rosterOf(sp), left = [];
    for (let i = r.length - 1; i >= 0; i--) {
      const p = r[i], k = classIdx(p.classYear);
      if (k >= CLASSES.length - 1) { left.push(p); r.splice(i, 1); }
      else { p.classYear = CLASSES[k + 1]; p.class = p.classYear; }
    }
    left.reverse();
    const before = r.length;
    sp.starters = [];
    pickStarters(state);
    const walkOns = r.length - before;
    if (left.length) ticker(state, 'Graduation: ' + nameList(left) + (left.length > 1 ? ' leave' : ' leaves') + ' the ' + L.bsuNick + (walkOns ? '; ' + walkOns + ' walk-on' + (walkOns > 1 ? 's' : '') + ' step' + (walkOns > 1 ? '' : 's') + ' in' : '') + '.', {});
    return { left: left, walkOns: walkOns };
  }
  function coordinatorStars(state, side) { const st = state.sports.staff, c = st && st[side === 'offense' ? 'oc' : 'dc']; return num(c && c.stars, PS.coachStarBase); }
  /** season end: every underclassman gains dev.min..dev.max (by name hash, no draws) + dev.perStar per coordinator star over base, never below dev.floor */
  function develop(state) {
    const sp = state.sports, r = rosterOf(sp), year = yearOf(state), D = PR.dev;
    let total = 0, n = 0, best = null;
    for (let i = 0; i < r.length; i++) {
      const p = r[i]; if (classIdx(p.classYear) >= CLASSES.length - 1) { p.dinged = 0; continue; }
      const span = Math.max(1, int(D.max, 5) - int(D.min, 2) + 1), base = int(D.min, 2) + (BSU.strHash(p.name + '|' + p.pos + '|' + year) % span);
      const gain = Math.max(int(D.floor, 1), Math.round(base + num(D.perStar, 1) * (coordinatorStars(state, unitSide(p.pos)) - PS.coachStarBase)));
      const b0 = p.rating; p.rating = clamp(p.rating + gain, 1, int(D.cap, 99)); p.dinged = 0;
      total += p.rating - b0; n++;
      if (!best || p.rating - b0 > best.gain) best = { name: p.name, pos: p.pos, gain: p.rating - b0, rating: p.rating };
    }
    pickStarters(state);
    if (n) ticker(state, 'Off-season workouts: ' + n + ' underclassmen gain +' + (total / n).toFixed(1) + ' on average' + (best ? '; ' + best.pos + ' ' + best.name + ' +' + best.gain + ' to ' + best.rating : '') + '.', {});
    return { players: n, avg: n ? total / n : 0, best: best };
  }
  /** after a real game: last week's dinged starters return; each starter who played is dinged with dinged.p (by hash: no draws) and sits dinged.games */
  function dingAfterGame(state, g) {
    const sp = state.sports, r = rosterOf(sp), D = PR.dinged, year = yearOf(state), key = int(g && g.day, today(state));
    for (let i = 0; i < r.length; i++) if (r[i].dinged > 0) r[i].dinged--;
    const st = sp.starters, out = [];
    for (let i = 0; i < st.length; i++) {
      const p = st[i]; if (!p || r.indexOf(p) < 0) continue;
      if ((BSU.strHash(p.name + '|' + p.pos + '|' + year + '|' + key) % 1000) < num(D.p, 0.05) * 1000) { p.dinged = Math.max(1, int(D.games, 1)); out.push(p); }
    }
    pickStarters(state);
    if (out.length) {
      const subs = out.map(function (p) { const b = sp.starters[POS.indexOf(p.pos)]; return p.pos + ' ' + p.name + (b && b !== p ? ' (' + b.name + ' starts)' : ''); }).join(', ');
      ticker(state, 'Dinged: ' + subs + '. Back after a week.', {});
    }
    return out;
  }
  function costPerYear(rating) { const C = PR.cost, rnd = Math.max(1, int(C.round, 1000)); return Math.round((int(C.base, 20000) + int(C.perPoint, 6000) * Math.max(0, rating - int(C.from, 60))) / rnd) * rnd; }
  function headroomShare(state) { const b = refreshBudget(state, null); return b.total > 0 ? clamp((b.total - b.committed) / b.total, 0, 1) : 0; }
  function prospectMean(state, bonus) { const Q = PR.prospect; return num(Q.base, 60) + num(state.economy && state.economy.prestige, 10) * num(Q.perPrestige, 0.35) + num(bonus, 0); }
  /** the player-facing roster: depth per position (starter · backup · others), seniors leaving, empty backups, walk-on starters, scholarships */
  function rosterView(state) {
    const sp = state.sports, r = rosterOf(sp), year = yearOf(state), tpl = ((data().football || {}).roster || {}).template || {};
    const view = function (p, depth) { return { name: p.name, pos: p.pos, side: unitSide(p.pos), rating: p.rating, classYear: p.classYear, hometown: p.hometown, cost: p.cost, dinged: p.dinged, walkOn: p.walkOn, signedYear: p.signedYear, title: p.title || '', depth: depth, starter: depth === 1 }; };
    const rows = function (side) {
      return POS.filter(function (p) { return unitSide(p) === side; }).map(function (pos) {
        const ps = playersAt(sp, pos); let starter = null;
        for (let i = 0; i < sp.starters.length; i++) if (sp.starters[i] && sp.starters[i].pos === pos && ps.indexOf(sp.starters[i]) >= 0) { starter = sp.starters[i]; break; }
        if (!starter) starter = ps[0] || null;
        const rest = ps.filter(function (x) { return x !== starter; });
        return { pos: pos, label: (tpl[pos] && tpl[pos].label) || pos, starter: starter ? view(starter, 1) : null, backup: rest[0] ? view(rest[0], 2) : null, others: rest.slice(1).map(function (x) { return view(x, 3); }), count: ps.length };
      });
    };
    const off = rows('offense'), def = rows('defense'), all = off.concat(def);
    const counts = {}; for (let i = 0; i < CLASSES.length; i++) counts[CLASSES[i]] = 0;
    let scholarships = 0; const seniors = [], dinged = [];
    for (let i = 0; i < r.length; i++) { const p = r[i]; counts[p.classYear] = int(counts[p.classYear], 0) + 1; scholarships += p.cost; if (classIdx(p.classYear) === CLASSES.length - 1) seniors.push(view(p, 0)); if (p.dinged > 0) dinged.push(view(p, 0)); }
    seniors.sort(function (a, b) { return POS.indexOf(a.pos) - POS.indexOf(b.pos); });
    const grad = dayOfDate(PR.gradDate || 'May 5', year), nextGrad = grad >= today(state) ? grad : dayOfDate(PR.gradDate || 'May 5', year + 1);
    return { players: r.map(function (p) { return view(p, 0); }), offense: off, defense: def, seniors: seniors, emptyBackups: all.filter(function (x) { return x.count < 2; }).map(function (x) { return x.pos; }),
      walkOnStarters: all.filter(function (x) { return x.starter && x.starter.walkOn; }).map(function (x) { return x.pos; }), dinged: dinged, scholarships: scholarships, counts: counts, size: r.length,
      maxPerPos: int(PR.maxPerPos, 4), classes: CLASSES.slice(), nextGrad: nextGrad, daysToGrad: nextGrad - today(state) };
  }
  // ---------------------------------------------------------------------------
  // PLAN_V2 P1: the coaching staff — head coach (state.sports.coach, the same object as staff.hc), offensive
  // and defensive coordinators (staff.oc / staff.dc), prestige-gated candidates per role (staff.candidates,
  // sp.candidates IS staff.candidates.hc), contracts, buyouts, the Nov 8 raise offer and the off-season poaching
  // roll. A record: {name, role, stars, style, salary, years, hiredYear, quote, rep, reach, interim}; interim
  // staff have no scheme (style null), no contract (years 0) and cannot be fired. Read through M.staff(state).
  // ---------------------------------------------------------------------------
  function fmtMoney(n) { return BSU.formatMoney ? BSU.formatMoney(n) : '$' + n; }
  function staffData() { return data().staff || {}; }
  function roleStyles(role) { const rs = staffData().roleStyles || {}; return rs[role] || (role === 'dc' ? ['stout', 'aggressive', 'bend'] : ['ground', 'balanced', 'air']); }
  function roleLabel(role) { return (staffData().roleNames || {})[role] || role; }
  function pickBy(list, key) { return (list && list.length) ? list[BSU.strHash(String(key)) % list.length] : ''; }
  function roleQuote(role, name) { const q = (staffData().quotes || {})[role]; return q && q.length ? pickBy(q, name) : (role === 'hc' ? coachQuote(name) : ''); }
  function roleRep(role, name) { if (role === 'hc') { const cs = data().coaches || []; for (let i = 0; i < cs.length; i++) if (cs[i] && cs[i].name === name) return cs[i].rep || ''; } return pickBy((staffData().reps || {})[role], name); }
  /** a coach's scheme: the record's style, else (pre-P1 saves) data.coaches by name, else null (interim / unknown: no fit either way) */
  function styleOf(role, c) {
    if (!c || !c.name || c.interim) return null;
    if (c.style && roleStyles(role).indexOf(c.style) >= 0) return c.style;
    if (role === 'hc') { const cs = data().coaches || []; for (let i = 0; i < cs.length; i++) if (cs[i] && cs[i].name === c.name) return cs[i].style || 'balanced'; }
    return null;
  }
  function hireFee(role, stars) { return Math.round(PS.coachFee * clamp(int(stars, 0), 0, PS.starMax) * (role === 'hc' ? 1 : PB.coordinatorShare)); }
  function interimRecord(role, year) {
    const nm = (staffData().interim || {})[role] || (role === 'hc' ? L.interimCoach.name : 'Interim ' + role.toUpperCase());
    const stars = role === 'hc' ? L.interimCoach.stars : 1 + (BSU.strHash(role + ':' + year) % Math.max(1, int(PF.interimStarsMax, 2)));
    return { name: nm, role: role, stars: stars, style: null, salary: coachSalary(1, role), years: 0, hiredYear: year, quote: '', rep: role === 'hc' ? L.interimCoach.rep : 'holding the clipboard', reach: false, interim: true };
  }
  /** finite-guard one record in place (a pre-P1 head coach lacks style / salary / years) */
  function fixRecord(role, c, year) {
    c.role = role;
    c.name = String(c.name || '');
    c.stars = clamp(int(c.stars, 0), 0, PS.starMax);
    if (typeof c.interim !== 'boolean') c.interim = !!c.name && (c.name === L.interimCoach.name || /^Interim /.test(c.name));
    if (c.style !== null && roleStyles(role).indexOf(c.style) < 0) c.style = c.interim ? null : styleOf(role, { name: c.name, stars: c.stars });
    c.salary = c.name ? Math.max(0, int(c.salary, c.interim ? coachSalary(1, role) : coachSalary(c.stars, role))) : 0;
    c.years = Math.max(0, int(c.years, c.interim || !c.name ? 0 : int(PF.renewYears, 2)));
    c.hiredYear = int(c.hiredYear, year);
    c.quote = String(c.quote || ''); c.rep = String(c.rep || '');
    c.reach = !!c.reach;
    return c;
  }
  function fixCandidate(role, c) {
    if (!c || typeof c !== 'object') return null;
    c.role = role; c.name = String(c.name || ''); c.stars = clamp(int(c.stars, 1), PS.starMin, PS.starMax);
    if (roleStyles(role).indexOf(c.style) < 0) c.style = roleStyles(role)[1];
    c.reach = !!c.reach;
    c.salary = Math.max(0, int(c.salary, Math.round(coachSalary(c.stars, role) * (c.reach ? num(PF.reachSalary, 1.6) : 1))));
    c.years = clamp(int(c.years, int(PF.yearsMin, 2)), 1, int(PF.yearsMax, 4));
    c.quote = String(c.quote || ''); c.rep = String(c.rep || '');
    return c;
  }
  /** build / relink / finite-guard state.sports.staff (every reset, and whenever a link is found broken) */
  function ensureStaff(state) {
    const sp = state.sports, year = yearOf(state);
    if (!sp.staff || typeof sp.staff !== 'object') sp.staff = { hc: null, oc: null, dc: null, candidates: { hc: [], oc: [], dc: [] }, lastRefreshYear: 0, offers: {} };
    const st = sp.staff;
    if (!sp.coach || typeof sp.coach !== 'object') sp.coach = { name: '', stars: 0, hiredYear: 0, quote: '', rep: '' };
    fixRecord('hc', sp.coach, year);
    st.hc = sp.coach;
    for (let i = 1; i < ROLES.length; i++) { const r = ROLES[i]; if (st[r] && typeof st[r] === 'object') fixRecord(r, st[r], year); else st[r] = sp.hasTeam ? interimRecord(r, year) : null; }
    if (!st.candidates || typeof st.candidates !== 'object') st.candidates = { hc: [], oc: [], dc: [] };
    for (let i = 0; i < ROLES.length; i++) { const r = ROLES[i]; if (!Array.isArray(st.candidates[r])) st.candidates[r] = []; }
    if (!Array.isArray(sp.candidates)) sp.candidates = [];
    if (sp.candidates !== st.candidates.hc) { if (sp.candidates.length && !st.candidates.hc.length) st.candidates.hc = sp.candidates; sp.candidates = st.candidates.hc; }
    for (let i = 0; i < ROLES.length; i++) { const r = ROLES[i], list = st.candidates[r]; for (let k = list.length - 1; k >= 0; k--) if (!fixCandidate(r, list[k])) list.splice(k, 1); }
    st.lastRefreshYear = int(st.lastRefreshYear, 0);
    if (!st.offers || typeof st.offers !== 'object') st.offers = {};
    return st;
  }
  function staffOf(state) { const sp = state.sports; if (!sp.staff || sp.staff.hc !== sp.coach || sp.candidates !== sp.staff.candidates.hc) ensureStaff(state); return sp.staff; }
  function recordOf(state, role) { const st = staffOf(state); return role === 'hc' ? state.sports.coach : st[role]; }
  function maxStarsFor(prestige) { return clamp(1 + Math.floor(num(prestige, 0) / Math.max(1, num(PF.starsPerPrestige, 20))), PS.starMin, PS.starMax); }
  function candidatePool(state, role) {
    const names = (staffData().names || {})[role] || (role === 'hc' ? (data().coaches || []).map(function (c) { return c.name; }) : []);
    const used = {}, st = staffOf(state);
    for (let i = 0; i < ROLES.length; i++) {
      const c = recordOf(state, ROLES[i]); if (c && c.name) used[c.name] = true;
      if (ROLES[i] !== role) { const cl = st.candidates[ROLES[i]]; for (let k = 0; k < cl.length; k++) used[cl[k].name] = true; }
    }
    return names.filter(function (n) { return !used[n]; });
  }
  /** perRole candidates for one role (fixed draw order per candidate: name, stars (regular ones), style, years); the last is the reach */
  function drawRoleCandidates(state, role) {
    const st = staffOf(state), pool = candidatePool(state, role), out = st.candidates[role];
    const max = maxStarsFor(num(state.economy && state.economy.prestige, 10));
    out.length = 0;
    const n = Math.max(1, int(PF.perRole, 3));
    for (let k = 0; k < n && pool.length; k++) {
      const name = pool.splice(R.int(pool.length), 1)[0];
      let stars, reach = false;
      if (k === n - 1) { stars = Math.min(PS.starMax, max + int(PF.reachStars, 1)); reach = stars > max; }
      else stars = clamp(max - R.int(2), PS.starMin, PS.starMax);
      const style = R.pick(roleStyles(role));
      const years = int(PF.yearsMin, 2) + R.int(Math.max(1, int(PF.yearsMax, 4) - int(PF.yearsMin, 2) + 1));
      out.push({ name: name, role: role, stars: stars, style: style, salary: Math.round(coachSalary(stars, role) * (reach ? num(PF.reachSalary, 1.6) : 1)), years: years, reach: reach, rep: roleRep(role, name), quote: roleQuote(role, name) });
    }
    return out;
  }
  /** Dec 9 (and after a firing / a poaching): fresh candidates for one role, or all three in order hc, oc, dc */
  function drawCandidates(state, role) {
    const st = staffOf(state);
    if (role) drawRoleCandidates(state, role); else for (let i = 0; i < ROLES.length; i++) drawRoleCandidates(state, ROLES[i]);
    st.lastRefreshYear = yearOf(state);
    return st.candidates;
  }
  /** 50 % of the remaining contract (salary × years left); the head coach's is waived after three straight rivalry losses (§8) */
  function buyoutOf(state, role, c) {
    if (!c || !c.name || c.interim) return 0;
    if (role === 'hc' && state.sports.rivalryLossStreak >= PS.rivalryLossFire) return 0;
    return Math.round(Math.max(0, int(c.salary, 0)) * Math.max(0, int(c.years, 0)) * num(PF.buyoutShare, 0.5));
  }
  function staffSalaryYear(state) { const sp = state.sports; if (!sp.hasTeam) return 0; let t = 0; for (let i = 0; i < ROLES.length; i++) { const c = recordOf(state, ROLES[i]); if (c && c.name) t += Math.max(0, int(c.salary, 0)); } return t; }
  /** the engine's staff terms (0 / 1 at coachStarBase; the opponent has none): offense/defense composite adds, the opponent's turnover multiplier, the HC's 4th-down nudge and halftime magnitude */
  function staffTerms(state) {
    const sp = state.sports, base = PS.coachStarBase;
    const hc = recordOf(state, 'hc'), oc = recordOf(state, 'oc'), dc = recordOf(state, 'dc');
    const hcStars = hc && hc.name ? hc.stars : base, ocStars = oc && oc.name ? oc.stars : base, dcStars = dc && dc.name ? dc.stars : base;
    const ocStyle = styleOf('oc', oc), hcStyle = styleOf('hc', hc);
    const ocFit = !!(ocStyle && ocStyle === sp.playbook);
    return {
      off: num(PF.ocCompositePerStar, 3) * (ocStars - base) + (ocFit ? num(PF.ocFit, 4) : 0),
      def: num(PF.dcCompositePerStar, 3) * (dcStars - base),
      toMult: Math.max(0.5, 1 + num(PF.dcTurnoverPerStar, 0.04) * (dcStars - base)),
      goDist: hcStyle ? int((PF.hcGoDist || {})[hcStyle], 0) : 0,
      halftime: Math.max(0.5, 1 + num(PF.hcHalftimePerStar, 0.1) * (hcStars - base)),
      ocFit: ocFit, hcStars: hcStars, ocStars: ocStars, dcStars: dcStars
    };
  }
  function qualifiesPoach(state, c) { const e = state.economy || {}; return !!(c && c.name && !c.interim && c.stars > int(PF.poach.stars, 4) && num(e.prestige, 0) < num(PF.poach.prestige, 40)); }
  /** Nov 8: a raise offer for every coach other programs are circling (staff:offer → the decision card; unanswered = declined); force = a role to offer regardless */
  function offerRaises(state, force) {
    const st = staffOf(state), year = yearOf(state), out = [];
    for (let i = 0; i < ROLES.length; i++) {
      const r = ROLES[i], c = recordOf(state, r);
      if (!c || !c.name || c.interim || !(force === r || qualifiesPoach(state, c))) continue;
      const o = st.offers[r]; if (o && o.year === year) continue;
      const raise = Math.round(int(c.salary, 0) * num(PF.poach.raise, 0.25));
      st.offers[r] = { year: year, answered: false, accepted: false, raise: raise };
      const p = { role: r, label: roleLabel(r), name: c.name, stars: c.stars, salary: c.salary, raise: raise, newSalary: c.salary + raise, years: c.years, year: year };
      ticker(state, c.name + ' (' + c.stars + '★) is taking calls: a ' + Math.round(num(PF.poach.raise, 0.25) * 100) + '% raise keeps them (Season panel → Staff).', {});
      emit(EV.STAFF_OFFER, p);
      out.push(p);
    }
    return out;
  }
  /** the poaching: the coach leaves for another program, an interim takes over, that role's candidates draw at once (staff:poached → the newsflash card) */
  function poachCoach(state, role, why) {
    const sp = state.sports, st = staffOf(state), c = recordOf(state, role), year = yearOf(state);
    if (!c || !c.name || c.interim) return null;
    const poachers = staffData().poachers || ['Magnolia State'];
    const by = poachers[BSU.strHash(c.name + ':' + year) % poachers.length];
    const interim = interimRecord(role, year);
    if (role === 'hc') { sp.coach = interim; st.hc = interim; } else st[role] = interim;
    delete st.offers[role];
    drawCandidates(state, role);
    const p = { role: role, label: roleLabel(role), name: c.name, stars: c.stars, salary: c.salary, poacher: by, why: why || 'poached', year: year, interim: interim.name };
    ticker(state, 'Poached: ' + c.name + ' (' + c.stars + '★ ' + roleLabel(role).toLowerCase() + ') leaves for ' + by + '.', {});
    emit(EV.STAFF_POACHED, p);
    emit(EV.COACH_CHANGED, { role: role, name: interim.name, stars: interim.stars });
    storeRating(state);
    return p;
  }
  /** season end (after the star drift, before the budget roll): contracts tick down (an expired one renews at the market rate), then the poaching roll per role (hc, oc, dc) */
  function offseasonStaff(state) {
    const st = staffOf(state), year = yearOf(state), poached = [];
    for (let i = 0; i < ROLES.length; i++) {
      const r = ROLES[i], c = recordOf(state, r);
      if (!c || !c.name || c.interim) continue;
      c.years = Math.max(0, int(c.years, 0) - 1);
      if (c.years <= 0) { c.years = Math.max(1, int(PF.renewYears, 2)); c.salary = coachSalary(c.stars, r); c.reach = false; ticker(state, c.name + ' re-ups for ' + c.years + ' years at ' + fmtMoney(c.salary) + '.', {}); }
    }
    for (let i = 0; i < ROLES.length; i++) {
      const r = ROLES[i], c = recordOf(state, r);
      if (!qualifiesPoach(state, c)) continue;
      const o = st.offers[r];
      if (o && o.year === year && o.accepted) continue;
      if (R.chance(num(PF.poach.p, 0.35))) { const p = poachCoach(state, r); if (p) poached.push(p); }
    }
    return poached;
  }

  // ---------------------------------------------------------------------------
  // Rating (GDD §8; every term is a line)
  // ---------------------------------------------------------------------------
  function timerValue(state, id) {
    const v = call('economy', 'timerValue', state, id);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const t = call('progress', 'timer', state, id);
    if (t && typeof t === 'object') { const until = num(t.untilDay, NONE); if (until < 0 || until > today(state)) return num(t.value, 0); }
    return 0;
  }
  /** Pure: {rating, terms} for the given state (0 / {} without a team). */
  function computeRating(state) {
    const sp = state.sports, e = state.economy || {};
    if (!sp.hasTeam) return { rating: 0, terms: {} };
    const p = parts(state);
    const terms = {};
    terms.base = PS.ratingBase;
    terms.practiceField = PS.practiceField;
    terms.coaching = Math.min(PS.coachingCap, num(e.coaching, 0) / 100000 * PS.coachingPer100k);
    terms.recruiting = Math.min(PS.recruitingCap, num(e.prestige, 0) / PS.recruitingDiv);
    terms.morale = Math.min(PS.moraleCap, num(e.happiness, 0) / PS.moraleDiv);
    terms.roux = habitatComplete(state) ? PS.roux : 0;
    terms.heat = (L.heatMonths.indexOf(p.month) >= 0 && !recCenterNearField(state)) ? -PS.heatPenalty : 0;
    terms.coach = PS.coachPerStar * (num(sp.coach && sp.coach.stars, PS.coachStarBase) - PS.coachStarBase);
    terms.starters = clamp((meanStarterRating(state) - PS.starterBase) / PS.starterDiv, -3, 5);
    terms.recruitingTrip = timerValue(state, 'recruitingTrip');
    terms.voice = timerValue(state, 'voiceTeamRating');
    let total = 0;
    for (const k in terms) { terms[k] = num(terms[k], 0); total += terms[k]; }
    return { rating: clamp(total, 0, 100), terms: terms };
  }
  function storeRating(state) { const r = computeRating(state); state.sports.rating = r.rating; state.sports.ratingTerms = r.terms; }

  // ---------------------------------------------------------------------------
  // Win probability (GDD §8)
  // ---------------------------------------------------------------------------
  function clampP(p) { return clamp(num(p, 0.5), L.pClamp[0], L.pClamp[1]); }
  /** P(BSU wins) for team rating `team` against `oppRating` (venue rules from state). */
  function probFor(state, team, oppRating, night, home) {
    let opp = num(oppRating, 50);
    if (state.sports.venue === 'stadium3') opp -= PS.stadium3Opp;
    const adv = home ? (night ? PS.homeNight : PS.homeDay) : 0;
    let p = 1 / (1 + Math.pow(10, (opp - num(team, 0) - adv) / PS.elo));
    if (home && habitatComplete(state)) p += habitatBonus();
    return clampP(p);
  }
  /** The season's noisy rating for an opponent key (an unplayed entry first, any entry next, else the base). */
  function oppRatingFor(state, key) {
    const sched = state.sports.schedule;
    let any = NONE;
    for (let i = 0; i < sched.length; i++) {
      const e = sched[i];
      if (!e || e.opp !== key) continue;
      if (!e.played) return num(e.oppRating, oppBaseRating(key));
      if (any < 0) any = num(e.oppRating, oppBaseRating(key));
    }
    return any >= 0 ? any : oppBaseRating(key);
  }
  function winPctLast4(state) {
    const l4 = state.sports.record.last4;
    if (!l4 || !l4.length) return L.neutralWinPct;
    let w = 0; for (let i = 0; i < l4.length; i++) if (l4[i]) w++;
    return w / l4.length;
  }

  // ---------------------------------------------------------------------------
  // The drive/play engine (PLAN_FOOTBALL §2.1, pass B): ONE engine for every game.
  // Coordinates: spot = yards from BSU's own goal line (0) toward the opponent's (100); BSU attacks +x,
  // the opponent −x. Team index: 0 = BSU, 1 = the opponent. Every draw goes through R in a fixed
  // per-play order (call → outcome → yards → clock); phrase choice never draws (hash of the play index).
  // ---------------------------------------------------------------------------
  function starterMap(sp) { const m = {}; const st = sp.starters || []; for (let i = 0; i < st.length; i++) { const s = st[i]; if (s && s.pos && !m[s.pos]) m[s.pos] = s; } return m; }
  function bsuPositions(sp) { const m = starterMap(sp), r = {}; for (let i = 0; i < POS.length; i++) { const p = POS[i]; r[p] = m[p] ? num(m[p].rating, PS.starterBase) : PS.starterBase; } return r; }
  /** The opponent's eight positions: starterBase shaped by its style (L.oppStyle) and defBias on the defensive three. */
  function oppPositions(key) {
    const o = oppInfo(key) || {}; const off = L.oppStyle[o.style] || L.oppStyle.balanced; const db = num(o.defBias, 0);
    const r = {};
    for (let i = 0; i < POS.length; i++) { const p = POS[i]; r[p] = PS.starterBase + num(off[p], 0) + ((p === 'DL' || p === 'LB' || p === 'DB') ? db : 0); }
    return r;
  }
  function composite(pr, w) { let s = 0; for (const p in w) s += w[p] * num(pr[p], PS.starterBase); return s; }
  /** unit = clamp(composite + (strength − 50)/teamModDiv, unitMin, unitMax) for the four units (+ raw K/QB). */
  function unitsFor(pr, strength, stf) {
    const mod = (num(strength, 50) - 50) / PE.teamModDiv, C = PE.composite, off = stf ? num(stf.off, 0) : 0, def = stf ? num(stf.def, 0) : 0;   // P1: the coordinators' adds
    const u = function (w, add) { return clamp(composite(pr, w) + mod + add, PE.unitMin, PE.unitMax); };
    return { offRun: u(C.offRun, off), offPass: u(C.offPass, off), defRun: u(C.defRun, def), defPass: u(C.defPass, def), K: num(pr.K, PS.starterBase), QB: num(pr.QB, PS.starterBase) };
  }
  function coachStyle(sp) { return styleOf('hc', sp.coach); }   // null: an interim/unknown staff has no scheme (no coach fit either way)
  function lastName(n) { const s = String(n || '').replace(/"[^"]*"\s*/, '').trim().split(' '); return s[s.length - 1] || 'Tiger'; }
  /** Per-game engine inputs (plain JSON on the game): units per side, home advantage, styles, coach fit, weather, the elo-scale edge. */
  function engineFor(state, g) {
    const sp = state.sports, o = oppInfo(g.opp) || {};
    const tier = num(L.venueTier[sp.venue], 0);
    let sBsu = num(sp.rating, 0), sOpp = num(g.oppRating, 50);
    let advB = 0, advO = 0;
    const k = g.origKind || g.kind;
    const boosts = { marshMob: 0, homecoming: 0, homeField: 0 };
    const stf = staffTerms(state);   // PLAN_V2 P1: OC/DC composite adds, the DC's turnover multiplier on the opponent, the HC's 4th-down nudge and halftime magnitude
    if (g.kind === 'spring') {
      // PLAN_FOOTBALL §2.1 Spring Game: intrasquad — Gold = the starters − goldHandicap with the same scheme, no home field, no weather
      const pb = sp.playbook, pos = bsuPositions(sp), gold = {};
      for (let i = 0; i < POS.length; i++) gold[POS[i]] = pos[POS[i]] - num(PE.spring.goldHandicap, 6);
      return { units: [unitsFor(pos, sBsu, stf), unitsFor(gold, sBsu, stf)], adv: [0, 0], strength: [sBsu, sBsu], style: [pb, pb], aggression: [sp.aggression, 'normal'], coachStyle: coachStyle(sp), fit: { comp: 0, runYds: 0 }, toMult: [stf.toMult, stf.toMult], goDist: [stf.goDist, stf.goDist], halftime: stf.halftime, staff: stf, rain: false, wind: false, edge: 0, boosts: boosts };
    }
    if (g.home) {
      const seats = venueInfo(state).seats; const fill = seats > 0 ? clamp(num(g.attendance, 0) / seats, 0, 1) : 0;
      advB = num((g.night ? PE.homeField.night : PE.homeField.day)[tier], PS.homeDay) * (PE.homeField.fillBase + PE.homeField.fillSpan * fill);
      sOpp -= num(PE.homeField.oppPenalty[tier], 0);
      if (habitatComplete(state)) advB += L.habitatAdv;
      // PLAN_FOOTBALL §2.3 rivalry week / Homecoming: rating-scale boosts through the engine's strength input (no separate roll)
      if (k === 'rivalry' || isRival(g.opp)) { boosts.marshMob = num(PE.homeField.marshMob, 0); sBsu += boosts.marshMob; }
      if (k === 'homecoming') { boosts.homecoming = num(PE.homeField.homecomingRating[L.homecomingTiers.indexOf(sp.homecomingBudget)], 0); sBsu += boosts.homecoming; }
      boosts.homeField = advB;
    } else if (g.kind !== 'bowl' && g.kind !== 'club') advO = PS.homeDay * (PE.homeField.fillBase + PE.homeField.fillSpan * L.awayFill);
    const pb = sp.playbook, cst = coachStyle(sp), pos = bsuPositions(sp);
    const fit = { comp: 0, runYds: 0 };
    if (cst === pb) { fit.comp += PE.coachFit.completion; fit.runYds += PE.coachFit.runYds; }
    if (pb === 'air' && pos.QB < PE.coachFit.mismatchQb) fit.comp += PE.coachFit.mismatchCompletion;
    const wind = g.home ? call('weather', 'wind', state) : null;
    // home advantage is on the rating scale (as in winProb's elo term): it enters the units through teamMod, not the edge directly
    sBsu += advB; sOpp += advO;
    return {
      units: [unitsFor(pos, sBsu, stf), unitsFor(oppPositions(g.opp), sOpp)],
      adv: [advB, advO], strength: [sBsu, sOpp],
      style: [pb, o.style || 'balanced'], aggression: [sp.aggression, 'normal'], coachStyle: cst, fit: fit,
      toMult: [1, stf.toMult], goDist: [stf.goDist, 0], halftime: stf.halftime, staff: stf,
      rain: !!(g.home && raining(state)), wind: !!(wind && num(wind.speed, 0) >= PE.weather.windThreshold),
      edge: (sBsu - sOpp) / PE.edgeDiv, boosts: boosts
    };
  }
  function newBox() { return { plays: 0, rushAtt: 0, rushYds: 0, passAtt: 0, passComp: 0, passYds: 0, sacks: 0, ints: 0, fumbles: 0, to: 0, firstDowns: 0, top: 0, pts: 0, fgm: 0, fga: 0, xpm: 0, xpa: 0, twoM: 0, twoA: 0, tdRush: 0, tdPass: 0, downs: 0, long: 0, longType: '' }; }
  function newLines() { return { QB: { att: 0, comp: 0, yds: 0, td: 0, int: 0 }, RB: { car: 0, yds: 0, td: 0 }, WR: { rec: 0, yds: 0, td: 0 }, OL: { plays: 0 }, DL: { sacks: 0 }, LB: { tackles: 0 }, DB: { ints: 0 }, K: { fgm: 0, fga: 0, xpm: 0, long: 0 } }; }
  /** the opponent's play-by-play names (per game): one draw per position; a name already on the BSU side or earlier in this roster walks the last-name pool instead (no extra draw), so "{rb} stuffed by {dl}" never names a Tiger on both sides (qa pass 3) */
  function drawOppNames(used) {
    const F = (data().football || {}).roster, pool = F && F.names && Array.isArray(F.names.last) ? F.names.last : null;
    const r = {}, taken = {}; for (const k in (used || {})) taken[String(used[k])] = 1;
    for (let i = 0; i < POS.length; i++) {
      if (POS[i] === 'OL') continue;
      let ln = lastName(fbName());
      if (taken[ln] && pool && pool.length > 1) { const j = pool.indexOf(ln); for (let s = 1; s <= pool.length && taken[ln]; s++) ln = lastName(pool[(j + s) % pool.length]); }
      taken[ln] = 1; r[POS[i]] = ln;
    }
    r.OL = 'line'; return r;
  }
  function noAdj() { return { runShare: 0, big: 1, to: 1, clockAdd: 0 }; }

  // --- field helpers ---------------------------------------------------------
  function toGoal(g) { return g.poss === BSU_T ? 100 - g.spot : g.spot; }
  function ownYd(g) { return 100 - toGoal(g); }
  function setOwn(g, own) { own = clamp(own, 1, 99); g.spot = g.poss === BSU_T ? own : 100 - own; }
  function advance(g, yds) { g.spot = clamp(g.spot + (g.poss === BSU_T ? yds : -yds), 0, 100); }
  function margin(g, t) { return g.score[t] - g.score[1 - t]; }
  function twoMinute(g) { return !g.ot && (g.quarter === 2 || g.quarter === 4) && g.clock <= PE.clock.twoMinSec; }
  function remainingSec(g) { return g.ot ? L.otRemSec : Math.max(0, (PE.clock.quarters - g.quarter) * PE.clock.quarterSec + g.clock); }
  function watched(g) { return !g.quiet && (g.mode === 'highlights' || g.mode === 'full'); }
  function silentMode(g) { return !!g.quiet || g.mode === 'silent' || g.mode === 'montage'; }
  function sideOf(g, t) { return ((t === BSU_T) === !!g.home) ? 'home' : 'away'; }
  function syncPts(g) {
    if (g.mode === 'montage' && !g.revealDone) return;   // the montage reveals quarter by quarter
    if (g.home) { g.homePts = g.score[0]; g.awayPts = g.score[1]; } else { g.homePts = g.score[1]; g.awayPts = g.score[0]; }
  }
  function edgeFor(g, kind) {
    const t = g.poss, A = g.eng.units[t], D = g.eng.units[1 - t];
    const att = kind === 'run' ? A.offRun : A.offPass, def = kind === 'run' ? D.defRun : D.defPass;
    return (att - def) / PE.edgeDiv;
  }
  function adjOf(g, t) { return t === BSU_T ? g.adj : L.noAdj; }
  function toMultOf(g, t) { const m = g.eng && g.eng.toMult; return m ? Math.max(0.5, num(m[t], 1)) : 1; }   // P1: the defending DC's turnover rate (a pre-P1 game in a save: 1)
  function firstAndTen(g) { g.down = 1; g.dist = Math.min(PE.clock.firstDownYds, toGoal(g)); }
  function newDrive(g) { g.drive = { team: g.poss, start: ownYd(g), plays: 0, yds: 0, q: g.quarter, secs: 0, pts: 0 }; }
  function driveText(g, d) {
    const who = teamNick(g, d.team);
    const where = d.end !== undefined ? ' at ' + spotWords(g, d.team, d.end) : '';
    switch (d.result) {
      case 'td': return who + ' drive: ' + d.plays + ' plays, ' + d.yds + ' yards, touchdown.';
      case 'fg': return who + ' drive stalls' + where + '. Field goal good.';
      case 'fgMiss': return who + ' drive stalls' + where + '. Field goal no good.';
      case 'punt': return d.plays <= 3 ? who + ' three-and-out. Punt.' : who + ' drive stalls' + where + '. Punt.';
      case 'int': return who + ' drive ends on an interception.';
      case 'fumble': return who + ' drive ends on a fumble.';
      case 'downs': return who + ' turned over on downs' + where + '.';
      case 'safety': return who + ' tackled in the end zone. Safety.';
      case 'half': return who + ' run out the clock. Halftime.';
      case 'end': return who + ' drive ends with the clock.';
      default: return who + ' drive: ' + d.plays + ' plays, ' + d.yds + ' yards.';
    }
  }
  function closeDrive(g, result) {
    const d = g.drive; if (!d) return;
    g.drive = null;
    d.result = result; d.end = ownYd(g);
    const rec = { team: d.team, start: d.start, end: d.end, plays: d.plays, yds: d.yds, result: result, q: d.q, secs: d.secs, pts: d.pts, n: g.n };
    rec.text = driveText(g, rec);
    g.drives.push(rec);
    if (!silentMode(g)) emit(EV.GAME_DRIVE, { team: rec.team, result: rec.result, plays: rec.plays, yds: rec.yds, start: rec.start, end: rec.end, quarter: rec.q, text: rec.text, score: g.score.slice(), homePts: g.homePts, awayPts: g.awayPts });
  }
  function changePoss(g, reason) { closeDrive(g, reason); g.poss = 1 - g.poss; }
  function addPoints(state, g, t, pts, play) {
    g.score[t] += pts; syncPts(g);
    const qi = clamp(g.quarter, 1, 5) - 1;
    g.qpts[t][qi] += pts; g.box[t].pts += pts;
    if (g.drive && g.drive.team === t) g.drive.pts += pts;
    if (!silentMode(g)) emit(EV.GAME_SCORE, scorePayload(g, { quarter: clamp(g.quarter, 1, 5), side: sideOf(g, t), team: t, pts: pts, play: play ? play.type : null, score: g.score.slice() }));
  }
  function teamNick(g, t) { if (g.kind === 'spring') return L.springNames[t === BSU_T ? 0 : 1]; if (t === BSU_T) return L.bsuNick; const o = oppInfo(g.opp); return (o && o.nick) ? String(o.nick) : oppName(g.opp); }
  function oppAbbr(g) { return g.kind === 'spring' ? L.springAbbr : String(g.opp || 'OPP').slice(0, 3).toUpperCase(); }
  /** "the MAG 38" / "the BSU 20" / "midfield" for an absolute spot (0 = BSU goal line). */
  function spotWordsAbs(g, spot) { spot = Math.round(spot); if (spot === 50) return 'midfield'; return spot < 50 ? 'the BSU ' + spot : 'the ' + oppAbbr(g) + ' ' + (100 - spot); }
  function spotWords(g, t, own) { return spotWordsAbs(g, t === BSU_T ? own : 100 - own); }
  function fillPhrase(text, vars) { return String(text).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? String(vars[k]) : m; }); }
  function phraseKey(e) {
    switch (e.type) {
      case 'run': case 'kneel': case 'two':
        if (e.type === 'two') return e.res === 'good' ? 'twoPointGood' : 'twoPointFail';
        if (e.res === 'fumble') return 'fumble';
        if (e.res === 'td') return 'touchdownRun';
        if (e.type === 'kneel') return null;
        return e.yds >= 15 ? 'runBig' : (e.yds < 0 ? 'runLoss' : (e.yds <= 1 ? 'runStuff' : 'run'));
      case 'pass': if (e.res === 'inc') return 'passIncomplete'; if (e.res === 'td') return 'touchdownPass'; if (e.res === 'fumble') return 'fumble'; return e.yds >= 20 ? 'passBig' : (e.yds < 0 ? 'passLoss' : (e.yds === 0 ? 'passZero' : 'passComplete'));
      case 'sack': return e.res === 'fumble' ? 'fumble' : 'sack';
      case 'int': return 'interception';
      case 'punt': return 'punt';
      case 'fg': return e.res === 'good' ? 'fgGood' : 'fgMiss';
      default: return null;
    }
  }
  function playText(g, e, p) {
    const F = data().football || {}, PH = F.phrases || {};
    const t = e.poss, on = g.names[t] || {}, dn = g.names[1 - t] || {};
    const vars = { off: teamNick(g, t), def: teamNick(g, 1 - t), qb: on.QB, rb: on.RB, wr: on.WR, k: on.K, dl: dn.DL, lb: dn.LB, db: dn.DB, yds: Math.abs(e.yds), d: Math.abs(num(p.dist, e.yds)), spot: spotWordsAbs(g, e.end) };
    let key = phraseKey(e);
    if (key && !(PH[key] && PH[key].length)) key = key === 'runLoss' ? 'runStuff' : (key === 'passLoss' || key === 'passZero' ? 'passComplete' : key);   // older phrase tables
    let text = null;
    const list = key ? PH[key] : null;
    if (list && list.length) {
      let idx = (e.n * 7 + Math.abs(e.yds)) % list.length;
      if (list.length > 1 && g.lastTpl === key + ':' + idx) idx = (idx + 1) % list.length;   // qa pass 3: never the same template twice running ("bounces outside for 5" / "bounces outside for 6")
      if (key === 'punt') { const d = g.drives[g.drives.length - 1]; if (d && d.result === 'punt' && d.plays !== 3) for (let s = 0; s < list.length && /three and out/i.test(list[idx]); s++) idx = (idx + 1) % list.length; }   // "Three and out" only after a real one
      g.lastTpl = key + ':' + idx;
      text = fillPhrase(list[idx], vars).replace(/\b1 yards\b/g, '1 yard');
    } else {
      switch (e.type) {
        case 'kickoff': text = e.res === 'touchback' ? vars.off + ' kick off. Touchback.' : (e.res === 'onsideGood' ? 'Onside kick… and the ' + vars.off + ' recover!' : (e.res === 'onsideFail' ? 'Onside kick recovered by the ' + vars.def + '.' : vars.off + ' kick off. Returned to ' + vars.spot + '.')); break;
        case 'xp': text = e.res === 'good' ? vars.k + ' adds the extra point.' : vars.k + ' pushes the extra point wide.'; break;
        case 'kneel': text = vars.qb + ' takes a knee.'; break;
        case 'safety': text = 'Safety! ' + vars.off + ' tackled in their own end zone.'; break;
        default: text = vars.off + ' ' + e.type + ' for ' + e.yds + '.'; break;
      }
    }
    if (e.res === 'safety') text += ' Safety.';
    else if (e.res === 'first' && e.type !== 'kickoff') text += ' First down.';
    else if (e.res === 'downs') text += ' Turnover on downs.';
    if (PH.reaction && e.n % 3 === 0 && e.type !== 'kickoff' && e.type !== 'xp' && e.type !== 'punt') {
      // the crowd's side: a score / first down / made kick is good for the offense whatever the yardage (a 1-yard touchdown is not a hush), a turnover / miss / sack / incompletion bad
      const won = e.res === 'td' || e.res === 'first' || e.res === 'good', lost = e.res === 'int' || e.res === 'fumble' || e.res === 'miss' || e.res === 'inc' || e.res === 'downs' || e.res === 'safety' || e.type === 'sack';
      const notable = won || lost || Math.abs(e.yds) >= 8;   // a 2-yard carry earns no hush and no eruption
      const offGood = won || (!lost && e.yds >= 4), offBad = lost || (!won && e.yds <= 2);
      const bsuGood = (t === BSU_T) ? offGood : offBad;
      const rl = bsuGood ? PH.reaction.good : PH.reaction.bad;
      if (notable && rl && rl.length) text += ' ' + rl[Math.floor(e.n / 3) % rl.length];
    }
    return text;
  }
  /** Append the resolved play to the log (and emit game:play unless silent). `pre` is the snapshot taken before the play. */
  function record(g, p, res, yds) {
    const pre = g.pre, t = pre.poss;
    g.n++;
    const e = { n: g.n, q: pre.q, clk: g.clock, poss: p.poss !== undefined ? p.poss : t, down: pre.down, dist: pre.dist, spot: pre.spot, end: g.spot, type: p.type, res: res, yds: int(yds, 0), fourth: !!p.fourth, key: false, text: '' };
    e.key = res === 'td' || res === 'int' || res === 'fumble' || res === 'safety' || res === 'downs' || e.fourth || e.type === 'fg' || e.type === 'two' || (e.type === 'sack') || (e.yds >= PE.highlights.keyGain && e.type !== 'punt' && e.type !== 'kickoff') || (pre.twoMin && e.type !== 'kickoff' && e.type !== 'xp');
    e.text = playText(g, e, p);
    if (p.timeout !== undefined) e.timeout = p.timeout;
    g.plays.push(e);
    g.lastPlay = e;
    if (!silentMode(g)) emit(EV.GAME_PLAY, { n: e.n, type: e.type, res: e.res, yds: e.yds, text: e.text, poss: e.poss, quarter: e.q, clock: e.clk, spot: e.spot, end: e.end, down: e.down, dist: e.dist, key: e.key, fourth: e.fourth, score: g.score.slice(), homePts: g.homePts, awayPts: g.awayPts, mode: g.mode });
    return e;
  }
  /** Burn `sec` off the clock (timeouts and the quarter floor), credit possession time. */
  function runClock(g, sec, p, res) {
    const t = g.poss;
    let used = sec;
    if (!g.ot) {
      if (twoMinute(g) && res !== 'td' && res !== 'safety' && (p.type === 'run' || p.type === 'sack' || (p.type === 'pass' && !p.inc))) {
        const off = g.pre.poss;
        const want = margin(g, off) <= 0 ? off : (margin(g, 1 - off) < 0 ? 1 - off : -1);
        if (want >= 0 && g.timeouts[want] > 0) { g.timeouts[want]--; used = L.timeoutSec; p.timeout = want; }
      }
      used = Math.min(used, g.clock);
      g.clock -= used;
    } else used = 0;
    g.box[g.pre.poss].top += used;
    if (g.drive) g.drive.secs += used;
    return used;
  }

  // --- play calling and resolution ----------------------------------------------
  function callPlay(g) {
    const t = g.poss, pb = PE.playbook[g.eng.style[t]] || PE.playbook.balanced, S = PE.situational, m = margin(g, t);
    if (!g.ot && g.quarter === PE.clock.quarters && m > 0 && g.clock <= PE.clock.twoMinSec && g.timeouts[1 - t] === 0 && g.clock <= PE.clock.kneelSec * (5 - g.down)) return 'kneel';
    let share = pb.runShare + adjOf(g, t).runShare;
    if (g.down === 3 && g.dist >= S.longPassDist) share = 1 - S.longPassShare;
    else if (twoMinute(g) && m <= 0) share = 1 - S.twoMinPassShare;
    else if (!g.ot && g.quarter >= S.leadRunQuarter && m >= S.leadRunMargin) share = S.leadRunShare;
    return R.chance(clamp(share, 0.05, 0.95)) ? 'run' : 'pass';
  }
  function playRun(g) {
    const t = g.poss, e = edgeFor(g, 'run'), pb = PE.playbook[g.eng.style[t]] || PE.playbook.balanced, Rn = PE.run, adj = adjOf(g, t);
    let yds = Math.round(R.gauss() * Rn.ydsSd + Rn.ydsBase + Rn.ydsEdge * e + pb.runYdsAdd + (t === BSU_T ? g.eng.fit.runYds : 0));
    if (yds < Rn.ydsFloor) yds = Rn.ydsFloor;
    if (R.chance(clamp(Rn.breakawayP * (1 + Rn.breakawayEdge * e) * adj.big, 0, 0.5))) yds += Rn.breakawayAdd + R.int(Rn.breakawayRand);
    const fumble = R.chance(clamp(Rn.fumbleP * (1 - Rn.fumbleEdge * e) * pb.fumbleMult * (g.eng.rain ? PE.weather.rainFumbleMult : 1) * adj.to * toMultOf(g, t), 0, 0.5));
    return { type: 'run', yds: yds, fumble: fumble };
  }
  function playPass(g) {
    const t = g.poss, e = edgeFor(g, 'pass'), pb = PE.playbook[g.eng.style[t]] || PE.playbook.balanced, Pp = PE.pass, W = PE.weather, adj = adjOf(g, t);
    if (R.chance(clamp(Pp.sackP * (1 - Pp.sackEdge * e), 0, 0.5))) return { type: 'sack', yds: Pp.sackYds };
    if (R.chance(clamp(Pp.intP * (1 - Pp.intEdge * e) * pb.intMult * adj.to * toMultOf(g, t), 0, 0.5))) { const ret = Math.max(0, Math.round(Pp.intReturnMean + R.gauss() * Pp.intReturnSd)); return { type: 'int', yds: 0, ret: ret }; }
    let comp = Pp.compBase + Pp.compEdge * e + pb.compAdj + (t === BSU_T ? g.eng.fit.comp : 0) + (g.eng.rain ? W.rainComp : 0) + (g.eng.wind ? W.windComp : 0);
    comp = clamp(comp, Pp.compMin, Pp.compMax);
    if (!R.chance(comp)) return { type: 'pass', yds: 0, inc: true };
    let yds = Math.round(R.gauss() * Pp.ydsSd * pb.passVar + Pp.ydsBase + Pp.ydsEdge * e + (g.eng.rain ? W.rainPassYds : 0));
    if (yds < Pp.ydsFloor) yds = Pp.ydsFloor;
    if (R.chance(clamp(Pp.bigP * adj.big, 0, 0.5))) yds += Pp.bigAdd + R.int(Pp.bigRand);
    return { type: 'pass', yds: yds };
  }
  function lineOf(g, t) { return t === BSU_T ? g.lines : null; }
  /** Apply a scrimmage result (run/pass/sack/kneel/int) to the field, the box score and the clock. */
  function applyScrimmage(state, g, p) {
    const t = g.poss, C = PE.clock, pb = PE.playbook[g.eng.style[t]] || PE.playbook.balanced, adj = adjOf(g, t), box = g.box[t], ln = g.lines;
    const tg = toGoal(g), own = ownYd(g), dist0 = g.dist;
    let yds = int(p.yds, 0), res = 'gain', sec = C.runSec;
    box.plays++;
    if (g.drive) g.drive.plays++;
    if (p.type === 'int') {
      box.passAtt++; box.ints++; box.to++;
      if (t === BSU_T) { ln.QB.att++; ln.QB.int++; } else ln.DB.ints++;
      const depth = Math.min(L.intAirYds, tg);
      advance(g, depth);
      changePoss(g, 'int');
      if (ownYd(g) <= 0) { setOwn(g, PE.kick.puntTouchbackSpot); res = 'int'; p.ret = 0; }   // picked in the end zone: touchback
      else {
        const ret = Math.min(int(p.ret, 0), toGoal(g)); advance(g, ret);
        if (toGoal(g) <= 0) { res = 'td'; }
        else res = 'int';
      }
      sec = C.turnoverSec;
      if (res === 'td') { scoreTd(state, g, g.poss, p, 'ret'); runClock(g, sec, p, res); return record(g, p, 'int', 0); }
      newDrive(g); firstAndTen(g);
      runClock(g, sec, p, res);
      return record(g, p, 'int', 0);
    }
    if (p.inc) {
      yds = 0; res = 'inc'; sec = C.incompleteSec; box.passAtt++; if (t === BSU_T) ln.QB.att++;
    } else {
      if (yds >= tg) { yds = tg; res = 'td'; }
      else if (own + yds <= 0) { res = 'safety'; }
      if (p.type === 'run' || p.type === 'kneel') {
        box.rushAtt++; box.rushYds += yds; sec = (p.type === 'kneel' ? C.kneelSec : C.runSec) + pb.clockAdd + adj.clockAdd;
        if (t === BSU_T) { ln.RB.car++; ln.RB.yds += yds; if (res === 'td') { ln.RB.td++; } }
        else if (yds <= 3 && res !== 'td') ln.LB.tackles++;
      } else if (p.type === 'sack') {
        box.sacks++; box.rushYds += yds; sec = C.sackSec;
        if (t !== BSU_T) ln.DL.sacks++;
      } else {
        box.passAtt++; box.passComp++; box.passYds += yds; sec = (twoMinute(g) && margin(g, t) <= 0) ? C.twoMinCompleteSec : C.completeSec;
        if (t === BSU_T) { ln.QB.att++; ln.QB.comp++; ln.QB.yds += yds; ln.WR.rec++; ln.WR.yds += yds; if (res === 'td') { ln.QB.td++; ln.WR.td++; } }
      }
      if (res === 'safety') yds = -own;
      advance(g, yds);
      if (yds > box.long) { box.long = yds; box.longType = p.type; }
      if (g.drive) g.drive.yds += yds;
    }
    if (res === 'gain' && p.fumble) { box.fumbles++; box.to++; res = 'fumble'; sec = C.turnoverSec; }
    if (res === 'td') {
      if (p.type === 'run' || p.type === 'kneel') box.tdRush++; else box.tdPass++;
      scoreTd(state, g, t, p, p.type);
    } else if (res === 'safety') {
      closeDrive(g, 'safety');
      addPoints(state, g, 1 - t, 2, p);
      if (g.ot) otNext(state, g); else { g.phase = 'kickoff'; g.kickTeam = t; g.freeKick = true; }
    } else if (res === 'fumble') {
      changePoss(g, 'fumble');
      if (g.ot) otNext(state, g); else { newDrive(g); firstAndTen(g); }
    } else if (yds >= dist0) {
      g.down = 1; g.dist = Math.min(C.firstDownYds, toGoal(g)); box.firstDowns++;
      if (res === 'gain') res = 'first';
    } else {
      g.down++; g.dist = dist0 - yds;
      if (g.down > 4) { res = 'downs'; box.downs++; changePoss(g, 'downs'); if (g.ot) otNext(state, g); else { newDrive(g); firstAndTen(g); } }
    }
    runClock(g, sec, p, res);
    return record(g, p, res, yds);
  }
  function scoreTd(state, g, t, p, how) {
    closeDrive(g, 'td');
    addPoints(state, g, t, 6, p);
    g.poss = t;
    setOwn(g, 97);
    g.phase = 'try'; g.down = 1; g.dist = 3;
  }
  function doScrimmage(state, g) {
    const t = g.poss;
    let fourth = false;
    if (g.down === 4) {
      let choice = g.pendingCall;
      if (!choice) {
        if (wantsDecision(g, 'fourthDown')) { openDecision(state, g, 'fourthDown'); return null; }
        choice = fourthDefault(g, t);
      }
      g.pendingCall = null;
      if (choice === 'fg') return doFieldGoal(state, g);
      if (choice === 'punt') return doPunt(state, g);
      fourth = true;
    }
    const call = callPlay(g);
    const p = call === 'kneel' ? { type: 'kneel', yds: -1 } : (call === 'run' ? playRun(g) : playPass(g));
    p.fourth = fourth;
    return applyScrimmage(state, g, p);
  }
  function doTry(state, g) {
    const t = g.poss, K = PE.kick, box = g.box[t], ln = g.lines;
    let choice = g.pendingTry;
    if (!choice) {
      if (g.ot && g.ot.round >= L.otTwoFrom) choice = 'two';
      else if (wantsDecision(g, 'twoPoint')) { openDecision(state, g, 'twoPoint'); return null; }
      else choice = twoDefault(g, t);
    }
    g.pendingTry = null;
    let p;
    if (choice === 'two') {
      const e = (edgeFor(g, 'run') + edgeFor(g, 'pass')) / 2;
      const good = R.chance(clamp(K.twoPointP + K.twoPointEdge * e, 0.05, 0.95));
      box.twoA++; if (good) { box.twoM++; addPoints(state, g, t, 2, { type: 'two' }); }
      p = { type: 'two', yds: good ? 3 : 0, res: good ? 'good' : 'miss' };
    } else {
      const good = R.chance(clamp(K.xpP + (g.eng.wind ? PE.weather.windFg / 2 : 0), 0.5, 0.995));
      box.xpa++; if (good) { box.xpm++; addPoints(state, g, t, 1, { type: 'xp' }); if (t === BSU_T) ln.K.xpm++; }
      p = { type: 'xp', yds: 0, res: good ? 'good' : 'miss' };
    }
    if (g.ot) otNext(state, g); else { g.phase = 'kickoff'; g.kickTeam = t; }
    return record(g, p, p.res, p.yds);
  }
  function doKickoff(state, g) {
    const t = g.kickTeam, K = PE.kick, C = PE.clock;
    const recv = 1 - t;
    const p = { type: 'kickoff', yds: 0, poss: t };
    const onside = !g.ot && g.quarter === C.quarters && g.clock <= K.onsideSec && margin(g, t) < 0 && margin(g, t) >= -K.onsideTrailMax && !g.freeKick;
    g.poss = recv;
    if (onside) {
      if (R.chance(K.onsideRecover)) { g.poss = t; setOwn(g, 45); p.res = 'onsideGood'; }
      else { setOwn(g, 52); p.res = 'onsideFail'; }
    } else if (R.chance(K.koTouchbackP)) { setOwn(g, K.koTouchbackSpot); p.res = 'touchback'; }
    else { const ret = clamp(Math.round(K.koReturnMean + R.gauss() * K.koReturnSd), 3, 60); setOwn(g, ret); p.res = 'return'; p.yds = ret; }
    g.freeKick = false;
    g.phase = 'play';
    newDrive(g); firstAndTen(g);
    runClock(g, C.kickSec, p, 'kick');
    return record(g, p, p.res, p.yds);
  }
  function doPunt(state, g) {
    const t = g.poss, K = PE.kick, W = PE.weather, tg = toGoal(g);
    let net = Math.round(K.puntNet + R.gauss() * K.puntSd + (g.eng.rain ? W.rainPuntNet : 0) + (g.eng.wind ? W.windPuntNet : 0));
    const fair = R.chance(K.fairCatchP);
    const p = { type: 'punt', yds: net, fair: fair, dist: net };
    closeDrive(g, 'punt');
    if (net >= tg) { g.poss = 1 - t; setOwn(g, K.puntTouchbackSpot); p.res = 'touchback'; p.yds = tg; }
    else { advance(g, net); g.poss = 1 - t; p.res = fair ? 'fair' : 'punt'; }
    newDrive(g); firstAndTen(g);
    runClock(g, PE.clock.kickSec, p, 'kick');
    return record(g, p, p.res, p.yds);
  }
  function fgProb(g, tg) {
    const F = PE.fg, W = PE.weather, K = g.eng.units[g.poss].K, d = tg + F.snapDist;
    let p = F.base - F.perYd * Math.max(0, d - F.freeDist) * (1 - F.kFactor * (K - F.kBase) / F.kRange) + (g.eng.rain ? W.rainFg : 0) + (g.eng.wind ? W.windFg : 0);
    return clamp(p, F.pMin, F.pMax);
  }
  function doFieldGoal(state, g) {
    const t = g.poss, F = PE.fg, tg = toGoal(g), d = tg + F.snapDist, box = g.box[t], ln = g.lines;
    const good = R.chance(fgProb(g, tg));
    box.fga++; if (t === BSU_T) ln.K.fga++;
    const p = { type: 'fg', yds: d, dist: d };
    closeDrive(g, good ? 'fg' : 'fgMiss');
    if (good) {
      box.fgm++; if (t === BSU_T) { ln.K.fgm++; if (d > ln.K.long) ln.K.long = d; }
      addPoints(state, g, t, 3, p); p.res = 'good';
      if (g.ot) otNext(state, g); else { g.phase = 'kickoff'; g.kickTeam = t; }
    } else {
      p.res = 'miss';
      if (g.ot) otNext(state, g); else { g.poss = 1 - t; setOwn(g, Math.max(F.missSpotMin, tg)); newDrive(g); firstAndTen(g); }
    }
    runClock(g, PE.clock.kickSec, p, 'kick');
    return record(g, p, p.res, p.yds);
  }
  /** The coach's 4th-down call by aggression (PLAN_FOOTBALL §2.1), the game situation and the kicker's range. */
  function fourthDefault(g, t) {
    const A = PE.aggression[g.eng.aggression[t]] || PE.aggression.normal, C = PE.clock;
    const tg = toGoal(g), own = 100 - tg, m = margin(g, t);
    const fgOk = tg + PE.fg.snapDist <= PE.fg.maxDist;
    if (!g.ot && g.clock <= 20 && (g.quarter === 2 || g.quarter === C.quarters) && fgOk && (g.quarter === 2 || m >= -3)) return 'fg';
    const goDist = A.goDist > 0 ? Math.max(1, A.goDist + (g.eng.goDist ? int(g.eng.goDist[t], 0) : 0)) : 0;   // P1: an air HC goes a yard longer, a ground HC a yard shorter
    let go = goDist > 0 && g.dist <= goDist && own >= A.goSpot;
    if (g.ot) { if (m < -3 || (m < 0 && !fgOk)) go = true; else if (!fgOk && g.dist <= 4) go = true; }
    else if (g.quarter === C.quarters) {
      const late = g.clock <= PE.decision.fourthTrailSec;
      if (A.trailLateGo && m < 0 && late && (m < -3 || !fgOk)) go = true;
      if (m < 0 && g.clock <= PE.kick.onsideSec && own >= 40 && (!fgOk || m < -3)) go = true;
      if (m < 0 && g.clock <= 60 && !fgOk) go = true;
    }
    if (go) return 'go';
    if (fgOk) return 'fg';
    if (A.goDist > 0 && own >= 60 && g.dist <= 2) return 'go';
    return 'punt';
  }
  function twoDefault(g, t) {
    const after = margin(g, t) + 1, lvl = g.eng.aggression[t], D = PE.decision;
    if (g.ot) return (g.ot.round >= L.otTwoFrom) ? 'two' : 'kick';
    if (lvl === 'conservative') return 'kick';
    if (g.quarter >= D.twoPointQuarter) {
      if (after === -1 && g.clock <= 300) return 'two';
      if (lvl === 'aggressive' && D.twoPointMargins.indexOf(after) >= 0) return 'two';
    }
    return 'kick';
  }
  function halftimeDefault(g) {
    const a = g.eng.aggression[0], m = margin(g, BSU_T), cs = g.eng.coachStyle;
    if (a === 'aggressive' && m < 0) return 'open';
    if (a === 'conservative' && m > 0) return 'pound';
    if (m < 0 && cs === 'air') return 'open';
    if (m > 0 && cs === 'ground') return 'pound';
    return 'stay';
  }
  function applyHalftime(state, g, choice) {
    const sp = state.sports, D = PE.decision;
    g.halftimeAnswered = true; g.halftimeChoice = choice;
    const hm = Math.max(0.5, num(g.eng && g.eng.halftime, 1));   // P1: the HC's halftime adjustment magnitude (1 at 2★)
    if (choice === 'open') {
      g.adj = { runShare: -D.openPass * hm, big: 1 + (D.openBigPlay - 1) * hm, to: D.openTurnover, clockAdd: 0 };
      g.wentForIt = true;
      ticker(state, 61, { coach: sp.coach && sp.coach.name ? sp.coach.name : 'Cheramie' });
      if (watched(g)) call('ui', 'notify', state, { text: 'Coach ' + (sp.coach && sp.coach.name ? sp.coach.name : '') + ' opens it up: more passes, more big plays, more risk.', kind: 'sports', ttl: 6000 });
    } else if (choice === 'pound') {
      g.adj = { runShare: D.poundRun * hm, big: 1, to: 1, clockAdd: Math.round(D.poundClockAdd * hm) };
      if (watched(g)) call('ui', 'notify', state, { text: 'Coach ' + (sp.coach && sp.coach.name ? sp.coach.name : '') + ' pounds the rock: the clock bleeds.', kind: 'sports', ttl: 6000 });
    } else g.adj = noAdj();
  }
  function halftimeStep(state, g) {
    if (!g.halftimeAnswered) {
      if (watched(g)) { openDecision(state, g, 'halftime'); return null; }
      applyHalftime(state, g, halftimeDefault(g));
    }
    g.quarter = 3; g.clock = PE.clock.quarterSec; g.timeouts = [PE.clock.timeoutsPerHalf, PE.clock.timeoutsPerHalf];
    g.phase = 'kickoff'; g.kickTeam = g.openingReceiver; g.halfDone = true;
    return doKickoff(state, g);
  }
  function startOT(state, g) {
    closeDrive(g, 'end');
    g.ot = { round: 1, poss: 0, first: R.chance(0.5) ? BSU_T : OPP_T };
    g.quarter = PE.clock.quarters + 1; g.clock = 0;
    otPossession(g, g.ot.first);
  }
  function otPossession(g, t) { g.poss = t; setOwn(g, 100 - L.otSpot); g.phase = 'play'; newDrive(g); firstAndTen(g); }
  /** The end of an overtime possession: alternate, compare after two, start a new round or end the game. */
  function otNext(state, g) {
    if (g.drive) closeDrive(g, 'end');
    g.ot.poss++;
    if (g.ot.poss >= 2) {
      if (g.score[0] !== g.score[1]) { g.over = true; g.phase = 'over'; return; }
      g.ot.round++; g.quarter++; g.ot.poss = 0; g.ot.first = 1 - g.ot.first;
      if (g.ot.round > L.otMaxRounds) { addPoints(state, g, g.eng.edge >= 0 ? BSU_T : OPP_T, 3, null); g.over = true; g.phase = 'over'; return; }
      otPossession(g, g.ot.first);
    } else {
      // the second possession is moot when the first team cannot be caught (a TD vs. no answer is still played; a lead > 8 ends it)
      if (Math.abs(g.score[0] - g.score[1]) > 8) { g.over = true; g.phase = 'over'; return; }
      otPossession(g, 1 - g.ot.first);
    }
  }
  function endQuarter(state, g) {
    if (g.quarter === 2) { closeDrive(g, 'half'); g.phase = 'half'; if (!silentMode(g) || g.mode === 'montage') emit(EV.GAME_HALFTIME, scorePayload(g, { quarter: 2 })); return; }
    if (g.quarter >= PE.clock.quarters) { if (g.score[0] === g.score[1]) startOT(state, g); else { closeDrive(g, 'end'); g.over = true; g.phase = 'over'; } return; }
    g.quarter++; g.clock = PE.clock.quarterSec;
  }
  /** Resolve exactly one play (kickoff, try, scrimmage, punt, FG). null = paused on a decision, or the game is over. */
  function step(state, g) {
    if (g.over || g.decision) return null;
    if (g.clock <= 0 && !g.ot && g.phase !== 'try' && g.phase !== 'half') { endQuarter(state, g); if (g.over) return null; }
    g.pre = { down: g.down, dist: g.dist, spot: g.spot, q: g.quarter, clock: g.clock, poss: g.phase === 'kickoff' ? g.kickTeam : g.poss, twoMin: twoMinute(g) };
    switch (g.phase) {
      case 'half': return halftimeStep(state, g);
      case 'kickoff': return doKickoff(state, g);
      case 'try': return doTry(state, g);
      case 'play': return doScrimmage(state, g);
      default: return null;
    }
  }
  /** Play the rest of the game in one go with the coach's defaults for every decision (off-screen, montage, skip, finalize). */
  function runSilent(state, g) {
    g.quiet = true;
    let guard = 0;
    while (!g.over && guard++ < L.playGuard) {
      if (g.decision) { const id = g.decision.id; call('ui', 'answerDecision', id, 'default'); if (g.decision) applyDecision(state, g, g.decision.def); }
      const p = step(state, g);
      if (!p && !g.decision && !g.over) break;
    }
    if (!g.over) { g.over = true; g.phase = 'over'; closeDrive(g, 'end'); }
  }
  /** Run plays until pred(g) holds, a decision pauses, or the game ends (highlights catch-up). */
  function runUntil(state, g, pred) {
    let guard = 0;
    while (!g.over && !g.decision && !pred(g) && guard++ < L.playGuard) { const p = step(state, g); if (!p && !g.decision) break; }
  }

  // --- decisions (PLAN_FOOTBALL §2.1; the UI answers through decision:closed or sports.decide) ------------
  function wantsDecision(g, kind) {
    if (!watched(g) || g.poss !== BSU_T) return false;
    const D = PE.decision;
    if (g.mode === 'highlights' && g.toasts >= (g.kind === 'spring' ? num(PE.spring.toastCap, 1) : D.highlightsCap)) return false;   // the Spring Game shows one 4th-down/two-point toast (the tutorial for the mechanic)
    if (g.tOff >= D.pauseCap) return false;
    const own = ownYd(g), m = margin(g, BSU_T);
    if (kind === 'fourthDown') return (g.dist <= D.fourthDist && own >= D.fourthSpot) || own >= D.fourthRedZoneSpot || (!g.ot && m < -D.fourthTrailMargin && g.quarter === PE.clock.quarters && g.clock <= D.fourthTrailSec && own >= D.fourthTrailSpot);
    if (kind === 'twoPoint') return !g.ot && g.quarter >= D.twoPointQuarter && D.twoPointMargins.indexOf(m + 1) >= 0;
    return false;
  }
  /** P(team wins) from the margin, the possession's field position and the elo-scale edge (PLAN_FOOTBALL §2.1 P_live). */
  function liveProb(g, team, o) {
    const D = PE.decision; o = o || {};
    const rem = Number.isFinite(o.remSec) ? o.remSec : remainingSec(g);
    const remFrac = clamp(rem / (PE.clock.quarterSec * PE.clock.quarters), 0, 1);
    const m = Number.isFinite(o.margin) ? o.margin : margin(g, team);
    const poss = o.poss !== undefined ? o.poss : g.poss, own = Number.isFinite(o.own) ? o.own : ownYd(g);
    const ep = clamp(own / L.epDiv - L.epBase, -1.5, 6) * (0.5 + 0.5 * remFrac);
    const edge = team === BSU_T ? g.eng.edge : -g.eng.edge;
    const x = (m + (poss === team ? ep : -ep) + D.liveEdgeMult * remFrac * edge) / (D.liveScaleBase + D.liveScaleRem * remFrac);
    return clampP(1 / (1 + Math.pow(10, -x)));
  }
  function decisionSpec(g, kind) {
    const D = PE.decision, t = BSU_T, m = margin(g, t), rem = remainingSec(g);
    const bsu = g.score[0], opp = g.score[1];
    const lead = bsu > opp ? 'Up ' + bsu + '–' + opp : (bsu < opp ? 'Down ' + bsu + '–' + opp : 'Tied ' + bsu + '–' + opp);
    if (kind === 'halftime') {
      const stay = liveProb(g, t, { remSec: rem, poss: g.openingReceiver, own: 25 });
      const open = liveProb(g, t, { remSec: rem, poss: g.openingReceiver, own: 25, margin: m + (m < 0 ? 1.5 : -1.5) });
      const pound = liveProb(g, t, { remSec: rem, poss: g.openingReceiver, own: 25, margin: m + (m > 0 ? 1 : -1) });
      return { id: 'halftime', kind: kind, text: lead + ' · ' + probWord(stay) + ' ' + pct(stay) + ' · Open it up: pass +' + Math.round(D.openPass * 100) + '%, big plays ×' + D.openBigPlay + ', turnovers ×' + D.openTurnover + ' · Pound the rock: run +' + Math.round(D.poundRun * 100) + '%, clock bleeds',
        yes: 'Open it up', no: 'Pound the rock', def: halftimeDefault(g), options: [{ key: 'open', label: 'Open it up', p: open }, { key: 'pound', label: 'Pound the rock', p: pound }, { key: 'stay', label: 'Stay the course', p: stay }] };
    }
    if (kind === 'twoPoint') {
      const e = (edgeFor(g, 'run') + edgeFor(g, 'pass')) / 2, p2 = clamp(PE.kick.twoPointP + PE.kick.twoPointEdge * e, 0.05, 0.95), px = PE.kick.xpP;
      const after = function (pts) { return liveProb(g, t, { margin: m + pts, poss: OPP_T, own: 25, remSec: rem }); };
      const two = p2 * after(2) + (1 - p2) * after(0), kick = px * after(1) + (1 - px) * after(0);
      return { id: 'twoPoint', kind: kind, text: lead + ' · Two-point try ' + pct(p2) + ' (win ' + pct(two) + ') · or kick ' + pct(px) + ' (win ' + pct(kick) + ')', yes: 'Go for two', no: 'Kick', def: twoDefault(g, t),
        options: [{ key: 'two', label: 'Go for two', p: two }, { key: 'kick', label: 'Kick the point', p: kick }] };
    }
    const tg = toGoal(g), own = 100 - tg, d = tg + PE.fg.snapDist, fgOk = d <= PE.fg.maxDist;
    const e = (edgeFor(g, 'run') + edgeFor(g, 'pass')) / 2;
    const pConv = clamp(L.convBase - L.convPerYd * g.dist + L.convEdge * e, L.convMin, L.convMax);
    const pFg = fgOk ? fgProb(g, tg) : 0;
    const go = pConv * liveProb(g, t, { poss: t, own: Math.min(99, own + g.dist), remSec: rem }) + (1 - pConv) * liveProb(g, t, { poss: OPP_T, own: tg, remSec: rem });
    const fg = fgOk ? pFg * liveProb(g, t, { margin: m + 3, poss: OPP_T, own: PE.kick.koTouchbackSpot, remSec: rem }) + (1 - pFg) * liveProb(g, t, { poss: OPP_T, own: Math.max(PE.fg.missSpotMin, tg), remSec: rem }) : 0;
    const punt = liveProb(g, t, { poss: OPP_T, own: Math.max(PE.kick.puntTouchbackSpot, tg - PE.kick.puntNet), remSec: rem });
    const options = [{ key: 'go', label: 'Go for it', p: go }];
    if (fgOk) options.push({ key: 'fg', label: 'Field goal (' + d + ' yds)', p: fg });
    options.push({ key: 'punt', label: 'Punt', p: punt });
    const text = '4th & ' + g.dist + ' at ' + spotWordsAbs(g, g.spot) + ' · Go: ' + pct(go) + (fgOk ? ' · FG from ' + d + ': ' + pct(fg) : '') + ' · Punt: ' + pct(punt);
    return { id: 'fourthDown', kind: kind, text: text, yes: 'Go for it', no: 'Kick it', def: fourthDefault(g, t), fgOk: fgOk, options: options };
  }
  function openDecision(state, g, kind) {
    const D = PE.decision, spec = decisionSpec(g, kind);
    const t = state.setPiece ? num(state.setPiece.tick, 0) : 0;
    let ticks = kind === 'halftime' ? D.halftimeTicks : (kind === 'twoPoint' ? D.twoPointTicks : D.fourthTicks);
    ticks = Math.min(ticks, Math.max(0, D.pauseCap - g.tOff));
    if (kind !== 'halftime') g.toasts++;
    g.decision = { id: spec.id, kind: kind, options: spec.options, def: spec.def, text: spec.text, yes: spec.yes, no: spec.no, fgOk: !!spec.fgOk, ticks: ticks, openedAt: t, n: g.decisionN + 1 };
    g.decisionN++;
    if (kind === 'halftime') g.halftimeOpenedTick = t;
    emit(EV.GAME_DECISION, { id: spec.id, kind: kind, text: spec.text, options: spec.options, deadlineTicks: ticks, def: spec.def, quarter: g.quarter, clock: g.clock, down: g.down, dist: g.dist, spot: g.spot, score: g.score.slice() });
    if (ticks <= 0) { applyDecision(state, g, spec.def); return; }
    showDecision(state, g);
  }
  /** Hand the pending decision to the UI once (re-issued after a load; the countdown is the remaining ticks). */
  function showDecision(state, g) {
    const d = g.decision; if (!d || !pv) return;
    const key = num(g.day, 0) + '/' + g.opp + '/' + d.n;
    if (pv.shownDecision === key) return;
    pv.shownDecision = key;
    const t = state.setPiece ? num(state.setPiece.tick, 0) : d.openedAt;
    call('ui', 'decision', state, { id: d.id, text: d.text, yes: d.yes, no: d.no, ticks: Math.max(1, d.openedAt + d.ticks - t) });
  }
  function normalizeChoice(d, raw) {
    const yesMap = { halftime: 'open', fourthDown: 'go', twoPoint: 'two' }, noMap = { halftime: 'pound', fourthDown: 'kick', twoPoint: 'kick' };
    let c = raw === 'yes' || raw === true ? yesMap[d.kind] : (raw === 'no' || raw === false ? noMap[d.kind] : ((raw === 'default' || raw === undefined || raw === null) ? d.def : String(raw)));
    if (d.kind === 'fourthDown') { if (c === 'kick') c = d.fgOk ? 'fg' : 'punt'; if (c !== 'go' && c !== 'fg' && c !== 'punt') c = d.def; if (c === 'fg' && !d.fgOk) c = 'punt'; }
    else if (d.kind === 'twoPoint') { if (c !== 'two' && c !== 'kick') c = d.def; }
    else if (c !== 'open' && c !== 'pound' && c !== 'stay') c = d.def;
    return c;
  }
  function applyDecision(state, g, choice) {
    const d = g.decision; if (!d) return false;
    choice = normalizeChoice(d, choice);
    g.decision = null;
    if (d.kind === 'halftime') applyHalftime(state, g, choice);
    else if (d.kind === 'fourthDown') g.pendingCall = choice;
    else g.pendingTry = choice;
    emit(EV.GAME_DECISION, { id: d.id, kind: d.kind, chosen: choice, closed: true, quarter: g.quarter, clock: g.clock, score: g.score.slice() });
    return true;
  }

  // --- summary, MVP, records (PLAN_FOOTBALL §2.1 post-game summary / season records) ---------------------
  function mmss(sec) { sec = Math.max(0, Math.round(num(sec, 0))); return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60); }
  function lineText(pos, l) {
    switch (pos) {
      case 'QB': return l.comp + '/' + l.att + ', ' + l.yds + ' yds, ' + l.td + ' TD' + (l.int ? ', ' + l.int + ' INT' : '');
      case 'RB': return l.car + ' car, ' + l.yds + ' yds, ' + l.td + ' TD';
      case 'WR': return l.rec + ' rec, ' + l.yds + ' yds, ' + l.td + ' TD';
      case 'DL': return l.sacks + (l.sacks === 1 ? ' sack' : ' sacks');
      case 'LB': return l.tackles + ' tackles';
      case 'DB': return l.ints + ' INT';
      case 'K': return l.fgm + '/' + l.fga + ' FG' + (l.long ? ', long ' + l.long : '');
      default: return l.plays + ' snaps';
    }
  }
  function lineScore(pos, l) {
    switch (pos) {
      case 'QB': return l.yds / 25 + 3 * l.td - 2 * l.int;
      case 'RB': return l.yds / 15 + 3 * l.td;
      case 'WR': return l.yds / 15 + 3 * l.td;
      case 'DL': return 3 * l.sacks;
      case 'LB': return l.tackles / 3;
      case 'DB': return 4 * l.ints;
      case 'K': return 2 * l.fgm + 0.3 * l.xpm;
      default: return 0;
    }
  }
  function pickMvp(sp, g) {
    const m = starterMap(sp);
    let best = null, bs = -Infinity;
    for (let i = 0; i < POS.length; i++) {
      const p = POS[i], st = m[p]; if (!st || p === 'OL') continue;
      const sc = lineScore(p, g.lines[p]);
      if (sc > bs) { bs = sc; best = { name: st.name, pos: p, hometown: st.hometown, line: lineText(p, g.lines[p]), score: sc }; }
    }
    return best;
  }
  function buildSummary(state, g) {
    const b = g.box[0], o = g.box[1], sp = state.sports;
    let big = null;
    for (let i = 0; i < g.plays.length; i++) { const e = g.plays[i]; if (e.poss === BSU_T && (e.type === 'run' || e.type === 'pass') && e.yds > 0 && (!big || e.yds > big.yds)) big = e; }
    const ticket = num(state.economy && state.economy.ticket, PS.ticketDefault);
    const att = num(g.attendance, 0);
    const lines = {};
    for (let i = 0; i < POS.length; i++) lines[POS[i]] = lineText(POS[i], g.lines[POS[i]]);
    return {
      opp: g.opp, oppName: oppName(g.opp), home: !!g.home, night: !!g.night, kind: g.kind, day: g.day, year: BSU.dayParts(num(g.day, 0)).year,
      score: g.score.slice(), won: g.score[0] > g.score[1], ot: !!g.ot, quarters: g.qpts.map(function (q) { return q.slice(); }),
      plays: [b.plays, o.plays], firstDowns: [b.firstDowns, o.firstDowns],
      yards: { rush: [b.rushYds, o.rushYds], pass: [b.passYds, o.passYds], total: [b.rushYds + b.passYds, o.rushYds + o.passYds] },
      turnovers: [b.to, o.to], sacks: [g.lines.DL.sacks, b.sacks], top: [b.top, o.top], topText: [mmss(b.top), mmss(o.top)],
      kicking: [{ fgm: b.fgm, fga: b.fga, xpm: b.xpm, xpa: b.xpa }, { fgm: o.fgm, fga: o.fga, xpm: o.xpm, xpa: o.xpa }],
      mvp: pickMvp(sp, g), lines: lines, bigPlay: big ? { text: big.text, yds: big.yds, type: big.type, quarter: big.q } : null,
      drives: g.drives.length, attendance: att,
      revenue: g.kind === 'spring' ? { tickets: 0, concessions: num(PE.spring.concessions, 0), tailgate: 0, total: num(PE.spring.concessions, 0) }
        : g.home && g.kind !== 'club' ? { tickets: att * ticket, concessions: att * CONCESSIONS, tailgate: num(g.tailgate, 0), total: att * (ticket + CONCESSIONS) + num(g.tailgate, 0) } : { tickets: 0, concessions: 0, tailgate: 0, total: num(g.revenue, 0) },
      halftime: g.halftimeChoice, decisions: g.decisionN,
      boosts: g.eng && g.eng.boosts ? g.eng.boosts : { marshMob: 0, homecoming: 0, homeField: 0 }, neutral: g.kind === 'bowl'   // pass C: the rating-line boosts of this game (Season panel / summary card)
    };
  }
  function ensureRecords(r) {
    if (!r.allTime || typeof r.allTime !== 'object') r.allTime = { wins: 0, losses: 0 };
    r.allTime.wins = int(r.allTime.wins, 0); r.allTime.losses = int(r.allTime.losses, 0);
    if (r.bestWin !== null && typeof r.bestWin !== 'object') r.bestWin = null; if (r.bestWin === undefined) r.bestWin = null;
    if (r.longestPlay !== null && typeof r.longestPlay !== 'object') r.longestPlay = null; if (r.longestPlay === undefined) r.longestPlay = null;
    if (!r.seasonBests || typeof r.seasonBests !== 'object') r.seasonBests = {};
    if (!r.book || typeof r.book !== 'object') r.book = {};
    if (!Array.isArray(r.seasons)) r.seasons = [];
    if (!Array.isArray(r.hof)) r.hof = [];
    if (!Array.isArray(r.recruits)) r.recruits = [];   // PLAN_V2 P3: signed prospects that arrived (the Records tab's recruiting history)
  }
  function updateRecords(state, g, sum) {
    const sp = state.sports; if (!sp.records) sp.records = {}; const r = sp.records; ensureRecords(r);
    const year = sum.year, m = g.score[0] - g.score[1], won = m > 0;
    if (won) r.allTime.wins++; else r.allTime.losses++;
    if (won && (!r.bestWin || m > num(r.bestWin.margin, -Infinity))) r.bestWin = { opp: g.opp, oppName: sum.oppName, year: year, day: g.day, score: g.score.slice(), margin: m, kind: g.kind, home: !!g.home };
    const b = g.box[0], mp = starterMap(sp);
    if (b.long > 0 && (!r.longestPlay || b.long > num(r.longestPlay.yds, 0))) {
      const who = b.longType === 'pass' ? (mp.WR || mp.QB) : mp.RB;
      r.longestPlay = { yds: b.long, type: b.longType, name: who ? who.name : '', pos: who ? who.pos : '', opp: g.opp, year: year };
    }
    if (r.seasonBests.year !== year) r.seasonBests = { year: year, pts: 0, margin: -Infinity, passYds: 0, rushYds: 0, totalYds: 0 };
    const sb = r.seasonBests;
    sb.pts = Math.max(sb.pts, g.score[0]); sb.margin = Math.max(num(sb.margin, -999), m); sb.passYds = Math.max(sb.passYds, b.passYds); sb.rushYds = Math.max(sb.rushYds, b.rushYds); sb.totalYds = Math.max(sb.totalYds, b.passYds + b.rushYds);
    if (!Number.isFinite(sb.margin)) sb.margin = m;
    const book = function (key, v, st) { if (v > 0 && (!r.book[key] || v > num(r.book[key].v, 0))) r.book[key] = { name: st ? st.name : '', pos: st ? st.pos : '', opp: g.opp, year: year, v: v }; };
    book('passYds', g.lines.QB.yds, mp.QB); book('rushYds', g.lines.RB.yds, mp.RB); book('recYds', g.lines.WR.yds, mp.WR);
    book('sacks', g.lines.DL.sacks, mp.DL); book('ints', g.lines.DB.ints, mp.DB); book('pts', g.score[0], null); book('margin', m, null);
  }

  // --- live state for the renderer (pass F) ---------------------------------------------------------
  function formationsFor(play) {
    switch (play.type) {
      case 'pass': case 'sack': case 'int': return { off: 'shotgun', def: 'nickel' };
      case 'punt': return { off: 'punt', def: 'puntReturn' };
      case 'fg': case 'xp': return { off: 'fieldGoal', def: 'fgBlock' };
      case 'kickoff': return { off: 'kickoff', def: 'kickoffReturn' };
      case 'kneel': return { off: 'victory', def: 'd43' };
      default: return { off: 'iform', def: 'd43' };
    }
  }
  function livePlayers(g, play, f, phase) {
    const F = (data().football || {}).formations || {}, ROLES = (data().football || {}).roles || {};
    const fm = formationsFor(play);
    const off = F[fm.off], def = F[fm.def];
    const t = play.poss, dir = t === BSU_T ? 1 : -1;
    const los = play.type === 'kickoff' ? (t === BSU_T ? 35 : 65) : num(play.los, 50);
    const yds = num(play.yds, 0);
    const live = phase === 'live' ? f : (phase === 'huddle' ? 1 : 0);
    const endX = clamp(los + dir * yds, 0, 100);
    const out = [];
    let ball = { x: los, y: 0 };
    const role = function (r) { return ROLES[r] || r; };
    const push = function (team, r, x, y, st) { out.push({ team: team, pos: role(r), role: r, x: clamp(x, -5, 105), y: clamp(y, -26.6, 26.6), state: st }); };
    if (!off || !def) return { players: out, ball: ball, formation: fm };
    const isRun = play.type === 'run' || play.type === 'two' || play.type === 'kneel';
    const isPass = play.type === 'pass' || play.type === 'sack' || play.type === 'int';
    let carrierIdx = -1;
    for (let i = 0; i < off.pos.length; i++) {
      const r = off.pos[i], fx = off.xy[i][0], fy = off.xy[i][1];
      let x = los + dir * fx, y = fy, st = 'set';
      if (live > 0) {
        if (isRun) {
          if (carrierIdx < 0 && (r === 'RB' || (play.type === 'kneel' && r === 'QB'))) { carrierIdx = i; x = los + dir * (fx + (yds - fx) * live); st = 'carry'; ball = { x: x, y: y }; }
          else if (r === 'QB') { x = los + dir * (fx - 2 * Math.min(live, 0.3)); st = 'handoff'; }
          else if (r === 'WR' || r === 'TE') { x = los + dir * (fx + 8 * live); st = 'block'; }
          else { x = los + dir * (fx + 2 * live); st = 'block'; }
        } else if (isPass) {
          if (r === 'QB') {
            if (play.type === 'sack') { x = los + dir * (fx - 6 * live); st = 'sacked'; ball = { x: x, y: y }; }
            else { x = los + dir * (fx - 3 * Math.min(live, 0.4) / 0.4); st = live < 0.45 ? 'dropback' : 'throw'; if (live < 0.45) ball = { x: x, y: y }; }
          } else if (carrierIdx < 0 && r === 'WR') {
            carrierIdx = i; const depth = Math.max(yds, play.res === 'inc' ? 10 : 6);
            x = los + dir * (fx + depth * live); y = fy * (1 - 0.3 * live); st = live >= 0.75 && play.res !== 'inc' && play.type !== 'int' ? 'carry' : 'route';
            if (play.type === 'pass' && live >= 0.45) { const fl = clamp((live - 0.45) / 0.3, 0, 1); const qx = los - dir * 4; ball = { x: qx + (x - qx) * fl, y: fy * fl }; if (play.res === 'inc' && live >= 0.75) ball = { x: x + dir * 2, y: y }; }
          } else if (r === 'WR' || r === 'TE' || r === 'RB') { x = los + dir * (fx + 10 * live); y = fy * (1 - 0.2 * live); st = 'route'; }
          else { x = los + dir * (fx - 1.5 * live); st = 'block'; }
        } else if (play.type === 'punt' || play.type === 'fg' || play.type === 'xp') {
          const kicker = r === 'P' || r === 'K';
          if (kicker) { st = live < 0.25 ? 'kick' : 'watch'; }
          else if (r === 'GN' || r === 'BLK') { x = los + dir * (fx + 25 * live); st = 'cover'; }
          else st = 'block';
          const land = play.type === 'punt' ? endX : clamp(100 * (t === BSU_T ? 1 : 0) + dir * 8, -5, 105);
          const kx = los + dir * (play.type === 'punt' ? -14 : -7);
          const fl = clamp((live - 0.2) / 0.6, 0, 1);
          ball = { x: kx + (land - kx) * fl, y: 0 };
        } else if (play.type === 'kickoff') {
          if (r === 'K') st = live < 0.2 ? 'kick' : 'watch'; else { x = los + dir * (fx + 40 * live); st = 'cover'; }
          const fl = clamp((live - 0.1) / 0.6, 0, 1); const landX = t === BSU_T ? 100 - num(play.end, 75) : num(play.end, 25);
          ball = { x: los + (landX - los) * fl, y: 0 };
        }
      }
      push(t, r, x, y, st);
    }
    const carrier = carrierIdx >= 0 ? out[carrierIdx] : null;
    for (let i = 0; i < def.pos.length; i++) {
      const r = def.pos[i], fx = def.xy[i][0], fy = def.xy[i][1];
      let x = los + dir * fx, y = fy, st = 'set';
      if (live > 0) {
        if (play.type === 'kickoff') { const rx = t === BSU_T ? 100 - num(play.end, 75) : num(play.end, 25); if (r === 'KR') { x = x + (rx - x) * Math.min(1, live * 1.3); st = 'return'; } else { x = x - dir * 6 * live; st = 'block'; } }
        else if (play.type === 'punt') { if (r === 'PR') { x = endX; st = 'return'; } else { x = x - dir * 4 * live; st = 'rush'; } }
        else if (carrier) { const k = (r === 'DE' || r === 'DT' || r === 'RSH') ? 0.5 * live : 0.75 * live; x = x + (carrier.x - x) * k; y = y + (carrier.y - y) * k; st = (r === 'DE' || r === 'DT' || r === 'RSH') ? 'rush' : 'pursue'; }
        else { x = x - dir * 2 * live; st = 'rush'; }
      }
      push(1 - t, r, x, y, st);
    }
    return { players: out, ball: ball, formation: fm };
  }
  /** PLAN_FOOTBALL §2.1 the idle practice drill (pass C): with a Practice Field and no game, 11 players loop between two formations at midfield (no sim cost, no draws). */
  function drillState(state) {
    const sp = state.sports;
    if (!sp.hasTeam || sp.game) return null;
    const F = (data().football || {}).formations || {}, ROLES = (data().football || {}).roles || {};
    const a = F.iform, b = F.shotgun;
    if (!a || !b) return null;
    const cyc = L.drillCycleTicks, t = num(state.tick, 0) % cyc, half = cyc / 2;
    const f = t < half ? t / half : 1 - (t - half) / half;   // 0 → 1 → 0: iform → shotgun → iform
    const k = f < 0.5 ? f * 2 : (1 - f) * 2;                // ease both ways
    const players = [];
    for (let i = 0; i < a.pos.length; i++) {
      const r = f < 0.5 ? a.pos[i] : b.pos[i];
      const x = L.drillLos + a.xy[i][0] + (b.xy[i][0] - a.xy[i][0]) * f, y = a.xy[i][1] + (b.xy[i][1] - a.xy[i][1]) * f;
      players.push({ team: BSU_T, pos: ROLES[r] || r, role: r, x: x, y: y, state: k > 0.1 ? 'route' : 'set' });
    }
    return { phase: 'drill', frac: f, formation: { off: f < 0.5 ? 'iform' : 'shotgun', def: null }, players: players, ball: { x: L.drillLos, y: 0 }, los: L.drillLos };
  }
  function liveState(state) {
    const sp = state.sports, g = sp.game;
    if (!g || g.mode === 'silent') return { active: false, mode: g ? g.mode : null, drill: drillState(state) };
    const spc = state.setPiece;
    const t = spc ? num(spc.tick, 0) : 0, tg = t - num(g.tOff, 0);
    const a = g.anim;
    let f = 0, phase = g.kickedOff ? 'huddle' : 'pregame';
    if (a) { f = clamp((tg - a.t0) / Math.max(1, a.dur), 0, 1); phase = f >= 1 ? 'huddle' : (f < 0.15 ? 'snap' : 'live'); }
    if (g.decision) phase = 'decision';
    if (g.finalized) phase = 'final';
    else if (g.phase === 'half' && !g.halfDone) phase = 'halftime';
    const play = a || { type: g.phase === 'kickoff' ? 'kickoff' : (g.phase === 'try' ? 'xp' : 'run'), poss: g.phase === 'kickoff' ? g.kickTeam : g.poss, los: g.spot, yds: 0, res: '', end: g.spot };
    const lp = livePlayers(g, play, f, phase === 'live' || phase === 'snap' ? 'live' : (phase === 'huddle' ? 'huddle' : 'set'));
    const last = g.lastPlay;
    return {
      active: true, mode: g.mode, home: !!g.home, opp: g.opp, oppAbbr: oppAbbr(g), night: !!g.night, quarter: g.quarter, clock: g.clock, clockText: g.ot ? 'OT' + (g.ot.round > 1 ? g.ot.round : '') : mmss(g.clock),
      down: g.down, distance: g.dist, spot: g.spot, possession: g.poss, score: g.score.slice(), homePts: g.homePts, awayPts: g.awayPts, timeouts: g.timeouts.slice(),
      phase: phase, frac: f, over: !!g.over, finalized: !!g.finalized, ot: !!g.ot,
      lastPlay: last ? { n: last.n, type: last.type, res: last.res, yards: last.yds, text: last.text, poss: last.poss, key: last.key } : null,
      anim: a ? { type: a.type, res: a.res, yds: a.yds, poss: a.poss, los: a.los, end: a.end, t0: a.t0, dur: a.dur } : null,
      formation: lp.formation, players: lp.players, ball: lp.ball,
      drive: g.drive ? { team: g.drive.team, plays: g.drive.plays, yds: g.drive.yds, start: g.drive.start } : null,
      decision: g.decision ? { id: g.decision.id, kind: g.decision.kind, text: g.decision.text, options: g.decision.options, ticksLeft: Math.max(0, g.decision.openedAt + g.decision.ticks - t), def: g.decision.def } : null
    };
  }
  function animFor(g, e, tg, dur) { return { t0: tg, dur: dur, n: e.n, type: e.type, res: e.res, yds: e.yds, poss: e.poss, los: e.spot, end: e.end, phase: 'live' }; }

  // ---------------------------------------------------------------------------
  // Schedule (GDD §8 season calendar; data.schedule)
  // ---------------------------------------------------------------------------
  function seasonEndDay(state) { return dayOfDate(PS.schedule.seasonEnd, yearOf(state)); }
  function makeEntry(day, opp, home, kind, slot, oppRating) {
    return { day: day, opp: opp, home: !!home, kind: kind, night: false, played: false, result: null, postponedTo: NONE,
      oppRating: oppRating, slot: slot, origDay: day, origKind: kind, postponed: false, cancelled: false };
  }
  /** Build the season for `year` from today on (remaining dates only). Draws rng.sim: the 6 opponents, then the 7 noises. */
  function buildSchedule(state, year) {
    const sp = state.sports;
    const ds = data().schedule || [];
    const opps = data().opponents || {};
    const keys = Object.keys(opps);
    const rival = keys.filter(function (k) { return opps[k].rival; })[0] || 'magnolia';
    const others = keys.filter(function (k) { return k !== rival; });
    // shuffle the non-rivals (Fisher–Yates, rng.sim) and take the games the calendar needs
    for (let i = others.length - 1; i > 0; i--) { const j = R.int(i + 1); const t = others[i]; others[i] = others[j]; others[j] = t; }
    const clubOnly = sp.venue === 'none';
    const day0 = today(state);
    const out = [];
    let k = 0;
    for (let slot = 0; slot < ds.length; slot++) {
      const row = ds[slot];
      if (!row || row.kind === 'bowl') continue;   // the bowl is added on Dec 8 when wins ≥ 5
      const d = dayOfDate(row.date, year);
      if (d < 0 || d < day0) continue;
      let opp, kind = row.kind || 'regular', home = !!row.home;
      if (kind === 'rivalry') opp = rival; else { opp = others[k % others.length]; k++; }
      if (clubOnly) { kind = 'club'; home = false; }
      const noise = R.range(-PS.oppNoise, PS.oppNoise);
      out.push(makeEntry(d, opp, home, kind, slot, oppBaseRating(opp) + noise));
    }
    out.sort(function (a, b) { return a.day - b.day; });
    sp.schedule = out;
    sp.seasonYear = year;
    sp.seasonDone = false;
    sp.homeWins = 0;
    sp.record.wins = 0; sp.record.losses = 0;
    sp.seasonLog = []; sp.seasonLines = newLines();   // pass C: the season's game log and the starters' season stat lines start over
    for (let i = 0; i < out.length; i++) { out[i].night = nightFor(state, out[i]); emit(EV.GAME_SCHEDULED, { day: out[i].day, opp: out[i].opp, home: out[i].home, kind: out[i].kind }); }
    return out;
  }
  M._buildSchedule = function (state) { try { return buildSchedule(state, yearOf(state)); } catch (e) { BSU.error('sports', '_buildSchedule', e); return []; } };
  function findEntry(state, pred) {
    const s = state.sports.schedule;
    for (let i = 0; i < s.length; i++) if (s[i] && pred(s[i], i)) return i;
    return NONE;
  }
  function gameOnDay(state, day, exceptIdx) {
    return findEntry(state, function (e, i) { return i !== exceptIdx && !e.cancelled && (!e.played || e.day === day) && e.day === day && !(e.postponed && e.postponedTo < 0); }) >= 0;
  }

  // ---------------------------------------------------------------------------
  // Attendance and revenue (GDD §8, §5.2)
  // ---------------------------------------------------------------------------
  function raining(state) { const r = call('weather', 'raining', state); return typeof r === 'boolean' ? r : !!(state.weather && state.weather.event); }
  function attendanceFor(state, g) {
    const e = state.economy || {};
    const v = venueInfo(state);
    if (!g || !g.home || v.seats <= 0) return 0;
    const fanbase = num(e.students, 0) * PS.fanbase.students + num(e.alumni, 0) * PS.fanbase.alumni + num(e.prestige, 0) * PS.fanbase.prestige;
    const k = g.origKind || g.kind;
    const hype = PS.hype.base + PS.hype.winPct * winPctLast4(state) + ((k === 'rivalry' || k === 'homecoming' || isRival(g.opp)) ? PS.hype.rivalry : 0)
      + (g.night ? PS.hype.night : 0) + (raining(state) ? PS.hype.rain : 0);
    const mult = num(PS.tickets[num(e.ticket, PS.ticketDefault)], 1);
    const damage = 1 - v.hp;
    // brief: floor(min(seats, fanbase × hype) × ticketMult × (1 − damage)); the seat cap is re-applied after the
    // ticket multiplier because a $25 crowd cannot exceed the venue (documented deviation)
    return Math.max(0, Math.floor(Math.min(v.seats, Math.min(v.seats, fanbase * hype) * mult) * (1 - damage)));
  }
  function tailgateFor(state, attendance) {
    const sp = state.sports;
    if (sp.permits !== 'paid') return 0;
    const v = venueInfo(state);
    const greek = Math.min(PS.greekCap, PS.greekBonus * greekNearVenue(state, v.building));
    return Math.round(PS.tailgatePer * attendance * (1 + greek) * (1 + timerValue(state, 'voiceTailgate')));
  }

  // ---------------------------------------------------------------------------
  // The game struct and its life cycle
  // ---------------------------------------------------------------------------
  function stormNow(state) { const st = call('weather', 'storm', state); return st !== undefined ? st : (state.storms ? state.storms.current : null); }
  /** A landfall today or tomorrow (day-driven), or the bands/landfall phase (tick-driven): the home game is postponed unless Play Through It. */
  function stormImminent(state, st) {
    if (!st || st.nearMiss) return false;
    if (st.phase === STORM.BANDS || st.phase === STORM.LANDFALL) return true;
    if (st.phase >= STORM.RECOVERY) return false;
    const lead = num(st.landfallDay, NONE) - today(state);
    return lead >= 0 && lead <= 1;
  }
  function fullLen() { const F = PE.full; return F.baseTicks + L.fullPlaysEstimate * F.perPlayTicks + F.tailTicks; }
  /** The game struct: the public fields the score bug reads, plus the engine's whole state (plain JSON, saved with the game). */
  function makeGame(state, e, idx, mode) {
    const sp = state.sports;
    const home = !!e.home;
    const night = home ? nightFor(state, e) : false;
    const C = PE.clock;
    const g = {
      day: today(state), opp: e.opp, home: home, night: night, quarter: 0, homePts: 0, awayPts: 0, wentForIt: false,
      attendance: 0, revenue: 0, playThrough: !!(state.storms && state.storms.playThroughIt), halftimeAnswered: false,
      kind: e.kind, origKind: e.origKind || e.kind, gameIndex: idx, oppRating: num(e.oppRating, oppBaseRating(e.opp)), venue: sp.venue,
      kickedOff: false, halftimeOpenedTick: NONE, finalized: false, exited: false, tailgate: 0, stats: '',
      mode: mode || 'silent', len0: 0, tOff: 0, quiet: false,
      // engine state (PLAN_FOOTBALL §2.1): 0 = BSU, 1 = the opponent; spot 0 = BSU's own goal line
      score: [0, 0], qpts: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], clock: C.quarterSec, poss: BSU_T, down: 1, dist: C.firstDownYds, spot: C.driveStartSpot,
      timeouts: [C.timeoutsPerHalf, C.timeoutsPerHalf], phase: 'kickoff', kickTeam: OPP_T, openingReceiver: BSU_T, freeKick: false, ot: null, over: false,
      eng: null, adj: noAdj(), halftimeChoice: null, halfDone: false, revealDone: false, revealed: 0,
      n: 0, plays: [], drives: [], drive: null, box: [newBox(), newBox()], lines: newLines(), names: [{}, {}], lastPlay: null, pre: null,
      decision: null, decisionN: 0, toasts: 0, pendingCall: null, pendingTry: null, anim: null, hl: { next: 0, budget: 0, target: null }, finalAt: NONE, summary: null
    };
    g.attendance = home ? attendanceFor(state, g) : 0;
    g.eng = engineFor(state, g);
    const mp = starterMap(sp), bn = {};
    for (let i = 0; i < POS.length; i++) bn[POS[i]] = mp[POS[i]] ? lastName(mp[POS[i]].name) : POS[i];
    g.names = [bn, drawOppNames(bn)];
    return g;
  }
  function scorePayload(g, extra) {
    const p = { opp: g.opp, home: g.home, night: g.night, homePts: g.homePts, awayPts: g.awayPts, kind: g.kind, day: g.day, venue: g.venue, playThrough: g.playThrough };
    if (extra) for (const k in extra) p[k] = extra[k];
    return p;
  }
  /** The opening kickoff: the coin toss (one draw), game:kickoff, Roux's ticker line. */
  function kickoff(state, g) {
    if (g.kickedOff) return;
    g.kickedOff = true;
    g.quarter = 1;
    g.openingReceiver = R.chance(0.5) ? BSU_T : OPP_T;
    g.kickTeam = 1 - g.openingReceiver;
    g.phase = 'kickoff';
    if (g.mode !== 'silent') emit(EV.GAME_KICKOFF, scorePayload(g, { homePts: 0, awayPts: 0, mode: g.mode }));
    if (g.home && habitatComplete(state)) ticker(state, 20, { opp: oppName(g.opp) });
  }
  function ticker(state, line, fields) {
    call('progress', 'ticker', state, line, fields || {}, 'sports', venueTile(state));
  }
  /** The final whistle: the engine finishes if needed, then totals, record, revenue, tickers, rivalry, timers, summary, records, events. */
  function finalize(state, g, silent) {
    if (g.finalized) return;
    if (g.kind === 'spring') return finalizeSpring(state, g);
    const sp = state.sports;
    if (!g.kickedOff) kickoff(state, g);
    if (!g.over) runSilent(state, g);
    g.revealDone = true; syncPts(g);
    g.finalized = true;
    g.anim = null;
    const won = g.score[0] > g.score[1];
    const bsuPts = g.score[0], oppPts = g.score[1];
    const e = sp.schedule[g.gameIndex];
    if (e) { e.played = true; e.result = { home: g.homePts, away: g.awayPts, won: won, bsu: bsuPts, opp: oppPts, ot: !!g.ot }; }
    // record
    if (won) sp.record.wins++; else sp.record.losses++;
    sp.record.last4.push(won);
    while (sp.record.last4.length > 4) sp.record.last4.shift();
    if (g.home && won) sp.homeWins++;
    // money
    if (g.kind === 'club') { call('economy', 'post', state, 'athletics', PS.clubPay, { note: 'club game vs ' + oppName(g.opp) }); g.revenue = PS.clubPay; addRevenue(state, PS.clubPay); }
    else if (g.home) {
      const ticket = num(state.economy && state.economy.ticket, PS.ticketDefault);
      const athletics = g.attendance * (ticket + CONCESSIONS);
      g.tailgate = tailgateFor(state, g.attendance);
      const vt = venueTile(state);
      if (athletics > 0) call('economy', 'post', state, 'athletics', athletics, { i: vt, note: 'home game vs ' + oppName(g.opp) });
      if (g.tailgate > 0) call('economy', 'post', state, 'tailgate', g.tailgate, { i: vt, note: 'tailgate' });
      g.revenue = athletics + g.tailgate;
      addRevenue(state, g.revenue);   // P3: the athletics budget's revenue share
      if (sp.firstHomeGameDay < 0) sp.firstHomeGameDay = today(state);
      if (g.night && sp.firstNightGameDay < 0) sp.firstNightGameDay = today(state);
    }
    // summary + records (PLAN_FOOTBALL §2.1)
    const sum = buildSummary(state, g);
    g.summary = sum;
    sp.lastSummary = sum;
    updateRecords(state, g, sum);
    addSeasonLines(sp, g.lines);
    logSeasonGame(sp, g, sum);
    dingAfterGame(state, g);   // P2: last week's dinged return, this week's starters roll (the backup starts next game)
    // ticker lines 43/44 and the recap 60 (the MVP's real stat line)
    const on = oppName(g.opp);
    if (won) ticker(state, 43, { w: bsuPts, opp: on, l: oppPts }); else ticker(state, 44, { opp: on, w: oppPts, l: bsuPts });
    if (sum.mvp) {
      g.stats = sum.mvp.line;
      ticker(state, 60, { pos: sum.mvp.pos, name: sum.mvp.name, hometown: sum.mvp.hometown, stat: g.stats, opp: on });
    }
    // pass C: an off-screen game (away, club, bowl) is reported through a notify with the line that matters
    if (g.mode === 'silent' && !g.home) {
      const where = g.kind === 'bowl' ? 'Sugar Cane Bowl' : (g.kind === 'club' ? 'Club game at ' + on : 'At ' + on);
      call('ui', 'notify', state, { text: where + ': ' + L.bsuNick + ' ' + bsuPts + '–' + oppPts + (g.ot ? ' (OT)' : '') + ' · ' + (won ? 'W' : 'L') + (sum.mvp ? ' · ' + sum.mvp.pos + ' ' + sum.mvp.name + ' ' + sum.mvp.line : '') + ' · ' + (sp.record.wins) + '–' + (sp.record.losses), kind: 'sports', ttl: 9000 });
    }
    // rivalry (§8)
    if (isRival(g.opp) && g.kind !== 'bowl') {
      if (won) {
        call('economy', 'bump', state, 'prestige', PS.rivalryPrestige, 'Geaux Beat Magnolia');
        call('progress', 'addTimer', state, 'rivalryDonations', PS.rivalryDonation, P.time.daysPerMonth);
        call('progress', 'addTimer', state, 'rivalrySpirit', P.econ.happiness.rivalry, P.econ.happiness.rivalryDays);
        call('progress', 'achieve', state, 'geauxBeatMagnolia');
        sp.rivalryLossStreak = 0;
      } else {
        sp.rivalryLossStreak++;
        ticker(state, 42, {});
        if (sp.rivalryLossStreak >= PS.rivalryLossFire) {
          if (!sp.candidates.length) drawCandidates(state);
          call('ui', 'notify', state, { text: 'Fire the coach? Three straight losses to ' + on + '. The boosters will pay the buyout.', kind: 'sports', ttl: 20000 });
        }
      }
    }
    // Play Through It (§8): +3 prestige "legend" on a win
    if (g.home && g.playThrough && won) { call('economy', 'bump', state, 'prestige', PS.playThroughPrestige, 'Played through it'); }
    // Resilience Bowl (§6.2)
    if (g.home && g.kind === 'makeup') {
      const v = venueInfo(state);
      const eff = v.building ? call('buildings', 'effective', state, v.building.id) : 1;
      if (num(eff, 1) > 0) call('economy', 'bump', state, 'prestige', PS.resiliencePrestige, 'Resilience Bowl');
    }
    // an "open it up" that lost (§5.6)
    if (g.wentForIt && !won) call('progress', 'addTimer', state, 'goForIt', num(P.econ.timers.goForIt.value, -2), num(P.econ.timers.goForIt.days, 10));
    emit(EV.GAME_FINAL, scorePayload(g, { won: won, bsuPts: bsuPts, oppPts: oppPts, attendance: g.attendance, revenue: g.revenue, quarter: 4, ot: !!g.ot, summary: sum, mode: g.mode }));
    return { home: g.homePts, away: g.awayPts, won: won, bsu: bsuPts, opp: oppPts };
  }
  /** Run the whole engine for entry idx in one tick (away, club, bowl, or a home game with no set piece). */
  function playOffscreen(state, idx) {
    const e = state.sports.schedule[idx];
    if (!e || e.played) return null;
    const g = makeGame(state, e, idx, 'silent');
    kickoff(state, g);
    runSilent(state, g);
    return finalize(state, g, true);
  }
  function clearGame(state) {
    if (!state.sports.game) return;
    state.sports.game = null;
    call('agents', 'gameDayBuses', state, false);
  }
  /** Start the home game set piece (highlights / full / montage) for entry idx; without a session, play it off-screen. */
  function startHome(state, idx) {
    const sp = state.sports;
    const e = sp.schedule[idx];
    if (!e || e.played) { pv.pending = NONE; return { ok: false, reason: 'No such game' }; }
    if (state.setPiece || sp.game) { pv.pending = idx; return { ok: false, reason: 'A set piece is running' }; }
    pv.pending = NONE;
    const seen = call('progress', 'setPieceSeen', state, 'game') === true;
    const montage = !!sp.autoSim && seen;
    const mode = montage ? 'montage' : (sp.watchFull ? 'full' : 'highlights');
    const kind = montage ? 'montage' : 'game';
    const len = montage ? PS.autoSimTicks : (mode === 'full' ? fullLen() : PT.gameTicks);
    const g = makeGame(state, e, idx, mode);
    g.len0 = len;
    sp.game = g;
    call('session', 'startSetPiece', state, kind, { len: len, skippable: montage ? true : seen });
    if (!state.setPiece) {
      // no session (isolation) or it refused: resolve the game off-screen so the season never stalls
      sp.game = null;
      g.mode = 'silent';
      kickoff(state, g);
      runSilent(state, g);
      finalize(state, g, true);
      return { ok: true, offscreen: true };
    }
    if (!Number.isFinite(state.setPiece.tick)) state.setPiece.tick = 0;
    call('agents', 'gameDayBuses', state, true);
    if (kind === 'game') scriptSky(state, g, 0);
    return { ok: true, kind: kind, mode: mode };
  }
  /** Golden 0–200 → Dusk 200–300 → Night for night games; Day throughout otherwise (t = game time, frozen while a decision is open). */
  function scriptSky(state, g, t) {
    if (!g.night) { call('weather', 'scriptSky', state, SKY.DAY, clamp(t / (g.len0 > 0 ? g.len0 : PT.gameTicks), 0, 1)); return; }
    if (t < PS.kickoffTick) call('weather', 'scriptSky', state, SKY.GOLDEN, t / PS.kickoffTick);
    else if (t < PS.kickoffTick + PS.quarterTicks) call('weather', 'scriptSky', state, SKY.DUSK, (t - PS.kickoffTick) / PS.quarterTicks);
    else call('weather', 'scriptSky', state, SKY.NIGHT, clamp((t - PS.kickoffTick - PS.quarterTicks) / (PT.gameTicks - PS.kickoffTick - PS.quarterTicks), 0, 1));
  }
  function busesOff(state, g) { if (!g.exited) { g.exited = true; call('agents', 'gameDayBuses', state, false); } }
  /** The watched game set piece: a pending decision freezes game time (tOff grows, the set piece stretches ≤ pauseCap); then the mode's scheduler. */
  function gameTick(state, g, t) {
    const spc = state.setPiece;
    if (g.decision) {
      showDecision(state, g);
      if (t - g.decision.openedAt >= g.decision.ticks) {
        const id = g.decision.id;
        call('ui', 'answerDecision', id, 'default');
        if (g.decision) applyDecision(state, g, g.decision.def);
      } else {
        g.tOff++;
        if (spc) spc.len = g.len0 + g.tOff;
        return;
      }
    }
    const tg = t - g.tOff;
    scriptSky(state, g, tg);
    if (g.mode === 'full') fullTick(state, g, tg, t);
    else highlightsTick(state, g, tg, hlTable(g));
  }
  /** The highlights tick table: the 750-tick home game (PS.kickoffTick…exitTick, 24 slots) or the 300-tick Spring Game (PE.spring: 40 → 140 → 240 → 280, 12 slots). */
  function hlTable(g) {
    const H = PE.highlights;
    if (g.kind === 'spring') {
      const Sg = PE.spring, k = num(Sg.kickoffTick, 40), h = num(Sg.halfTicks, 100), slots = Math.max(4, int(Sg.slots, 12));
      return { kickoff: k, halftime: k + h, final: k + 2 * h, exit: num(Sg.exitTick, k + 2 * h + 40), firstSlot: k, slots: slots, spq: Math.max(1, Math.floor(slots / 4)), slotTicks: num(Sg.slotTicks, 16) };
    }
    return { kickoff: PS.kickoffTick, halftime: PS.halftimeTick, final: PS.finalTick, exit: PS.exitTick, firstSlot: H.firstSlotTick, slots: H.slots, spq: H.slotsPerQuarter, slotTicks: H.slotTicks };
  }
  function catchUp(state, g, q, clk) {
    runUntil(state, g, function (x) { return x.quarter > q || (x.quarter === q && x.clock <= clk) || (x.phase === 'half' && q <= 2); });
  }
  /** Highlights: 24 slots of 16 ticks (6 per quarter) from tick 200; each slot catches the game up to its clock, then animates the next key play. */
  function highlightsTick(state, g, tg, T) {
    const H = PE.highlights;
    if (!T) T = hlTable(g);
    if (tg >= T.kickoff) kickoff(state, g);
    if (!g.kickedOff) return;
    if (tg >= T.final) {
      if (!g.finalized) { runSilent(state, g); finalize(state, g, false); }
      if (tg >= T.exit) busesOff(state, g);
      return;
    }
    if (g.anim) {
      if (tg < g.anim.t0 + g.anim.dur + H.huddleTicks) { if (tg >= g.anim.t0 + g.anim.dur) g.anim.phase = 'huddle'; return; }
      g.anim = null;
    }
    if (g.over) return;
    let s;
    const half = T.slots / 2;
    if (tg < T.halftime) s = Math.min(half - 1, Math.floor((tg - T.firstSlot) / T.slotTicks));
    else {
      if (!g.halfDone) {
        runUntil(state, g, function (x) { return x.phase === 'half'; });
        if (g.decision || g.over) return;
        if (g.phase === 'half') step(state, g);   // the halftime step: opens the decision (pauses) or applies the default and kicks off
        if (g.decision) return;
      }
      s = half + Math.min(half - 1, Math.floor((tg - T.halftime) / T.slotTicks));
    }
    if (s < 0) return;
    if (s >= g.hl.next) {
      g.hl.next = s + 1; g.hl.budget = H.maxPlaysPerSlot;
      g.hl.target = { q: Math.floor(s / T.spq) + 1, clk: PE.clock.quarterSec * (1 - (s % T.spq) / T.spq) };
    }
    if (g.hl.target) { catchUp(state, g, g.hl.target.q, g.hl.target.clk); if (g.decision) return; g.hl.target = null; }
    // scan up to maxPlaysPerSlot plays: the first key play is animated, else the last one of the scan (one animated play per slot)
    while (g.hl.budget > 0 && !g.over) {
      const p = step(state, g);
      if (!p) break;
      g.hl.budget--;
      if (p.key || g.hl.budget === 0) { g.anim = animFor(g, p, tg, H.animTicks); g.hl.budget = 0; break; }
    }
  }
  /** Watch full game: every play animates for animTicks; halftime pauses on the decision; the final waits exitTick − finalTick ticks, then the set piece ends. */
  function fullTick(state, g, tg, t) {
    const F = PE.full, spc = state.setPiece;
    if (tg >= PS.kickoffTick) kickoff(state, g);
    if (!g.kickedOff) return;
    if (g.over) {
      if (!g.finalized) { finalize(state, g, false); g.finalAt = tg; }
      if (tg >= g.finalAt + (PS.exitTick - PS.finalTick)) { busesOff(state, g); if (spc) spc.tick = Math.max(num(spc.tick, 0), num(spc.len, 0) - 1); }
      return;
    }
    if (spc && t >= num(spc.len, 0) - F.tailTicks) { g.len0 += F.tailTicks; spc.len = g.len0 + g.tOff; }   // overtime / a slow game: stretch the set piece
    if (g.anim && tg < g.anim.t0 + g.anim.dur) return;
    g.anim = null;
    const p = step(state, g);
    if (p) g.anim = animFor(g, p, tg, F.animTicks);
  }
  /** The 50-tick montage (auto-sim): the engine resolves the whole game at tick 5; quarters reveal at 10/20/30/40; final 45. */
  function montageTick(state, g, t) {
    const MT = L.montage;
    if (t >= MT.kickoff && !g.kickedOff) { kickoff(state, g); runSilent(state, g); }
    if (!g.kickedOff) return;
    for (let q = 0; q < 4; q++) {
      if (t >= MT.quarters[q] && g.revealed <= q) {
        g.revealed = q + 1; g.quarter = q + 1;
        for (let side = 0; side < 2; side++) {
          let pts = g.qpts[side][q]; if (q === 3) pts += g.qpts[side][4];
          if (pts <= 0) continue;
          if (g.home) { if (side === BSU_T) g.homePts += pts; else g.awayPts += pts; } else { if (side === BSU_T) g.awayPts += pts; else g.homePts += pts; }
          emit(EV.GAME_SCORE, scorePayload(g, { quarter: q + 1, side: sideOf(g, side), team: side, pts: pts, montage: true }));
        }
      }
    }
    if (t >= MT.final && !g.finalized) { finalize(state, g, false); busesOff(state, g); }
  }

  // ---------------------------------------------------------------------------
  // Postponement, makeups (GDD §6.2), Play Through It (§8)
  // ---------------------------------------------------------------------------
  function scheduleMakeups(state) {
    const sp = state.sports;
    const from = Math.max(today(state), pv.passedDay);
    for (let i = 0; i < sp.schedule.length; i++) {
      const e = sp.schedule[i];
      if (!e || e.played || !e.postponed || e.postponedTo >= 0) continue;
      let chosen = NONE;
      for (let d = from + 1; d <= from + L.makeupDays; d++) { if (!gameOnDay(state, d, i)) { chosen = d; break; } }
      if (chosen >= 0) M.scheduleMakeup(state, i, chosen);
      else { e.played = true; e.result = null; e.cancelled = true; call('ui', 'notify', state, { text: 'No date for the ' + oppName(e.opp) + ' makeup within ' + L.makeupDays + ' days. Game cancelled.', kind: 'sports' }); }
    }
    pv.passedDay = NONE;
  }
  function todaysHomeIndex(state) {
    const day = today(state);
    return findEntry(state, function (e) { return !e.played && !e.cancelled && e.home && e.day === day && !(e.postponed && e.postponedTo < 0); });
  }
  /** A home date: storm rule → Play Through It wait / postpone; else start the set piece. */
  function tryStartHome(state, idx) {
    const st = stormNow(state);
    if (stormImminent(state, st) && !(state.storms && state.storms.playThroughIt)) {
      if (pv.playThrough && pv.playThrough.day === today(state) && !pv.playThrough.answered) { pv.awaiting = idx; return; }
      M.postpone(state, idx);
      return;
    }
    startHome(state, idx);
  }
  function resolvePlayThrough(state, answer) {
    const day = today(state);
    if (pv.playThroughAnsweredDay === day) return;   // D43: one delivery per offer
    pv.playThroughAnsweredDay = day;
    if (pv.playThrough) pv.playThrough.answered = true;
    const idx = pv.awaiting >= 0 ? pv.awaiting : todaysHomeIndex(state);
    pv.awaiting = NONE;
    if (answer === 'yes') {
      call('weather', 'setPlayThrough', state, true);
      if (state.storms) state.storms.playThroughIt = true;
      const t = P.econ.timers.playThroughIt;
      call('progress', 'addTimer', state, 'playThroughIt', num(t && t.value, -PS.playThroughHappiness), num(t && t.days, 10));
      ticker(state, 46, {});
      if (idx >= 0) pv.pending = idx;   // starts on the next tick (never inside the listener)
    } else if (idx >= 0) M.postpone(state, idx);
  }

  // ---------------------------------------------------------------------------
  // Season end (Dec 8), the bowl, coach drift, candidates
  // ---------------------------------------------------------------------------
  function endSeason(state) {
    const sp = state.sports;
    const year = yearOf(state);
    const regWins = sp.record.wins, regLosses = sp.record.losses;
    let bowl = false, bowlWon = false, bowlOpp = null, bowlScore = null;
    if (regWins >= PS.bowlWins) {
      // the Sugar Cane Bowl: a neutral-site game vs the strongest opponent not on the schedule (off-screen in Tier 1)
      const used = {};
      for (let i = 0; i < sp.schedule.length; i++) if (sp.schedule[i]) used[sp.schedule[i].opp] = true;
      const opps = data().opponents || {};
      let opp = null, best = -Infinity;
      for (const k in opps) if (!used[k] && num(opps[k].rating, 0) > best) { best = num(opps[k].rating, 0); opp = k; }
      if (!opp) opp = L.bowlOppFallback;
      const day = dayOfDate(PS.schedule.bowl, year);
      const e = makeEntry(day >= 0 ? day : today(state), opp, false, 'bowl', (data().schedule || []).length - 1, oppBaseRating(opp) + R.range(-PS.oppNoise, PS.oppNoise));
      e.neutral = true;   // PLAN_FOOTBALL §2.3: a neutral-site game (no home field either way; engineFor gives a bowl no advantage)
      sp.schedule.push(e);
      emit(EV.GAME_SCHEDULED, { day: e.day, opp: e.opp, home: false, kind: 'bowl' });
      ticker(state, 'Bowl eligible at ' + regWins + ' wins: the Sugar Cane Bowl vs ' + oppName(opp) + '.', {});
      const res = playOffscreen(state, sp.schedule.length - 1);
      bowl = true; bowlOpp = opp;
      bowlWon = !!(res && res.won);
      bowlScore = res ? [res.bsu, res.opp] : null;
      if (bowlWon) { call('economy', 'post', state, 'athletics', PS.bowlWin, { note: 'Sugar Cane Bowl (won)' }); call('economy', 'bump', state, 'prestige', PS.bowlPrestige, 'Sugar Cane Bowl'); }
      else call('economy', 'post', state, 'athletics', PS.bowlLose, { note: 'Sugar Cane Bowl' });
      addRevenue(state, bowlWon ? PS.bowlWin : PS.bowlLose);
    } else ticker(state, 'No bowl this year: ' + regWins + ' wins, ' + PS.bowlWins + ' needed for the Sugar Cane Bowl.', {});
    const undefeated = regWins >= PS.undefeatedWins && regLosses === 0;
    sp.lastSeason = { wins: sp.record.wins, losses: sp.record.losses, bowlWon: bowlWon, undefeated: undefeated };
    if (undefeated) call('progress', 'achieve', state, 'undefeated');
    // PLAN_FOOTBALL §2.1 season records + Hall of Fame (pass C), then the season recap card
    const rs = recordSeason(state, { year: year, wins: regWins, losses: regLosses, bowl: bowl, bowlOpp: bowlOpp, bowlScore: bowlScore, bowlWon: bowlWon, undefeated: undefeated });
    const money = function (n) { return BSU.formatMoney ? BSU.formatMoney(n) : '$' + n; };
    const body = [regWins + '–' + regLosses + ' regular season · ' + rs.row.pf + ' points for, ' + rs.row.pa + ' against · ' + (sp.coach ? sp.coach.name : '') + ' (' + num(sp.coach && sp.coach.stars, 0) + '★)'];
    if (bowl) body.push('Sugar Cane Bowl vs ' + oppName(bowlOpp) + ': ' + (bowlScore ? bowlScore[0] + '–' + bowlScore[1] : '') + (bowlWon ? ' · won · ' + money(PS.bowlWin) + ' and +' + PS.bowlPrestige + ' prestige' : ' · lost · ' + money(PS.bowlLose)));
    else body.push('No bowl: ' + PS.bowlWins + ' wins are needed for the Sugar Cane Bowl.');
    if (rs.mvp) body.push('Season MVP: ' + rs.mvp.pos + ' ' + rs.mvp.name + ' (' + rs.mvp.hometown + ') · ' + rs.mvp.line);
    if (rs.hof.length) body.push('Hall of Fame: ' + rs.hof.map(function (h) { return h.pos + ' ' + h.name + ' (' + h.why + ')'; }).join('; '));
    body.push('Off-season: the recruiting board opens tomorrow — two prospects per position, up to 4 offense and 4 defense on four-year scholarships (P2).');
    call('progress', 'sportsCard', state, { id: 'seasonRecap', kicker: 'Season ' + year + ' · final', title: (undefeated ? 'Undefeated. ' : '') + L.bsuNick + ' ' + regWins + '–' + regLosses + (bowlWon ? ' · bowl champions' : ''), body: body });
    if (rs.mvp) ticker(state, 'Season MVP: ' + rs.mvp.pos + ' ' + rs.mvp.name + ', ' + rs.mvp.line + '.', {});
    for (let i = 0; i < rs.hof.length; i++) { const h = rs.hof[i]; ticker(state, h.pos + ' ' + h.name + ' enters the Hall of Fame: ' + h.why + '.', {}); call('ui', 'notify', state, { text: 'Hall of Fame: ' + h.pos + ' ' + h.name + ' (' + h.line + ').', kind: 'sports', ttl: 9000 }); }
    // coach stars drift (§8)
    if (sp.coach && sp.coach.name) {
      if (bowlWon || undefeated) sp.coach.stars = Math.min(PS.starMax, num(sp.coach.stars, 2) + 1);
      if (regLosses > regWins) sp.losingSeasons++; else sp.losingSeasons = 0;
      if (sp.losingSeasons >= PS.starDriftLosing) { sp.coach.stars = Math.max(PS.starMin, num(sp.coach.stars, 2) - 1); sp.losingSeasons = 0; }
    }
    develop(state);   // PLAN_V2 P2: the underclassmen's off-season growth (this season's coordinators, before any poaching)
    offseasonStaff(state);   // PLAN_V2 P1: contracts tick down / renew, then the poaching roll (a newsflash per coach lost)
    rollBudget(state);   // PLAN_V2 P3: next year's athletics budget from this season's gate, wins and prestige
    sp.seasonDone = true;
    sp.homeWins = 0;
    sp.record.wins = 0; sp.record.losses = 0;
    emit(EV.SEASON_END, { wins: sp.lastSeason.wins, losses: sp.lastSeason.losses, bowl: bowl, bowlWon: bowlWon, undefeated: undefeated, year: year,
      bowlOpp: bowlOpp, bowlScore: bowlScore, pf: rs.row.pf, pa: rs.row.pa, mvp: rs.row.mvp, hof: rs.hof.map(function (h) { return { name: h.name, pos: h.pos, why: h.why }; }), seasons: sp.records.seasons.length });
  }
  function seasonActive(state) { const sp = state.sports; return sp.hasTeam && sp.seasonYear === yearOf(state) && !sp.seasonDone && sp.schedule.length > 0; }
  function unplayedRegular(state) { return findEntry(state, function (e) { return !e.played && !e.cancelled && e.kind !== 'bowl'; }) >= 0; }

  // ---------------------------------------------------------------------------
  // PLAN_FOOTBALL pass C: season log / stat lines, records.seasons + Hall of Fame, the Spring Game, the prospect board
  // ---------------------------------------------------------------------------
  /** Accumulate a game's BSU starter lines into the season's (max for `long`, sums otherwise). */
  function addSeasonLines(sp, lines) {
    if (!sp.seasonLines || typeof sp.seasonLines !== 'object') sp.seasonLines = newLines();
    const T = sp.seasonLines;
    for (const pos in lines) {
      const src = lines[pos]; if (!src || typeof src !== 'object') continue;
      if (!T[pos] || typeof T[pos] !== 'object') T[pos] = {};
      for (const k in src) T[pos][k] = k === 'long' ? Math.max(num(T[pos].long, 0), num(src.long, 0)) : num(T[pos][k], 0) + num(src[k], 0);
    }
  }
  /** One compact row per game of the season (the Season panel's results list; pass D). */
  function logSeasonGame(sp, g, sum) {
    if (!Array.isArray(sp.seasonLog)) sp.seasonLog = [];
    sp.seasonLog.push({ day: g.day, opp: g.opp, oppName: sum.oppName, home: !!g.home, kind: g.kind, night: !!g.night, score: g.score.slice(), won: !!sum.won, ot: !!g.ot,
      mvp: sum.mvp ? { name: sum.mvp.name, pos: sum.mvp.pos, line: sum.mvp.line } : null, attendance: num(g.attendance, 0), revenue: num(g.revenue, 0), mode: g.mode });
    while (sp.seasonLog.length > L.seasonLogMax) sp.seasonLog.shift();
  }
  /** The season's MVP: the current starter whose accumulated line scores best (lineScore over seasonLines). */
  function seasonMvp(sp) {
    const T = sp.seasonLines || {}, mp = starterMap(sp);
    let best = null;
    for (let i = 0; i < POS.length; i++) {
      const pos = POS[i]; if (!T[pos] || !mp[pos]) continue;
      const sc = lineScore(pos, T[pos]);
      if (!best || sc > best.score) best = { name: mp[pos].name, pos: pos, hometown: mp[pos].hometown, line: lineText(pos, T[pos]), score: sc };
    }
    return best;
  }
  /** season:end: records.seasons gets {year, wins, losses, pf, pa, bowl, mvp, coach}; records.hof the plan's thresholds (QB 2,500 yds, RB 1,000, WR 900, DB 5 INT, or the MVP of a rivalry-win + bowl-win season). */
  function recordSeason(state, info) {
    const sp = state.sports; if (!sp.records) sp.records = {}; const r = sp.records; ensureRecords(r);
    const RC = PE.records, T = sp.seasonLines || {}, mp = starterMap(sp);
    let pf = 0, pa = 0, rivalryWon = false;
    for (let i = 0; i < sp.seasonLog.length; i++) { const e = sp.seasonLog[i]; if (e.kind === 'bowl') continue; pf += num(e.score[0], 0); pa += num(e.score[1], 0); if (e.won && isRival(e.opp)) rivalryWon = true; }
    const mvp = seasonMvp(sp);
    const row = { year: info.year, wins: info.wins, losses: info.losses, pf: pf, pa: pa,
      bowl: info.bowl ? { opp: info.bowlOpp, oppName: oppName(info.bowlOpp), score: info.bowlScore, won: !!info.bowlWon } : null, bowlWon: !!info.bowlWon, undefeated: !!info.undefeated,
      coach: sp.coach ? String(sp.coach.name || '') : '', stars: num(sp.coach && sp.coach.stars, 0), oc: sp.staff && sp.staff.oc ? String(sp.staff.oc.name || '') : '', dc: sp.staff && sp.staff.dc ? String(sp.staff.dc.name || '') : '', playbook: sp.playbook, mvp: mvp ? { name: mvp.name, pos: mvp.pos, hometown: mvp.hometown, line: mvp.line } : null, games: sp.seasonLog.length };
    r.seasons.push(row);
    while (r.seasons.length > num(RC.seasonsMax, 50)) r.seasons.shift();
    const hof = [];
    const add = function (pos, line, why) { const st = mp[pos]; if (!st) return; hof.push({ name: st.name, pos: pos, hometown: st.hometown, year: info.year, line: line, why: why }); };
    if (T.QB && num(T.QB.yds, 0) >= RC.hofQbYds) add('QB', lineText('QB', T.QB), RC.hofQbYds + ' passing yards');
    if (T.RB && num(T.RB.yds, 0) >= RC.hofRbYds) add('RB', lineText('RB', T.RB), RC.hofRbYds + ' rushing yards');
    if (T.WR && num(T.WR.yds, 0) >= RC.hofWrYds) add('WR', lineText('WR', T.WR), RC.hofWrYds + ' receiving yards');
    if (T.DB && num(T.DB.ints, 0) >= RC.hofDbInts) add('DB', lineText('DB', T.DB), RC.hofDbInts + ' interceptions');
    if (rivalryWon && info.bowlWon && mvp && !hof.some(function (h) { return h.pos === mvp.pos; })) add(mvp.pos, mvp.line, 'the rivalry win and the Sugar Cane Bowl');
    for (let i = 0; i < hof.length; i++) r.hof.push(hof[i]);
    while (r.hof.length > L.hofMax) r.hof.shift();
    return { row: row, hof: hof, mvp: mvp };
  }

  // --- the Purple & Gold Spring Game (PLAN_FOOTBALL §2.1 / §2.4) -----------------------------------------------------
  function springYd(day) { const dpy = Math.max(1, int(P.time.daysPerYear, 120)); return ((day % dpy) + dpy) % dpy; }
  function inSpringWindow(day) { const w = PE.spring.windowDays || [0, 69], yd = springYd(day); return yd >= num(w[0], 0) && yd <= num(w[1], 69); }
  /** Put the Spring Game on the calendar once per year: `fieldJustBuilt` → offsetDays after today inside the Jan 1 – Jul 10 window; later years → PE.spring.date (Apr 8) while it is still ahead. */
  function scheduleSpring(state, fieldJustBuilt) {
    const sp = state.sports, day = today(state), year = yearOf(state);
    if (!sp.hasTeam || sp.springYear === year || sp.springDay >= 0) return false;
    let d = NONE;
    if (fieldJustBuilt) { if (inSpringWindow(day)) d = day + num(PE.spring.offsetDays, 3); }
    else { const pd = dayOfDate(PE.spring.date, year); if (pd >= day && inSpringWindow(pd)) d = pd; }
    if (d < 0 || !inSpringWindow(d)) return false;
    sp.springDay = d;
    announceSpring(state, d);
    return true;
  }
  /** The newsflash: ticker + notify + a card through progress (held while a set piece runs; queued when ui is absent). */
  function announceSpring(state, d) {
    const sp = state.sports, n = d - today(state);
    const when = n <= 0 ? 'today' : (n === 1 ? 'tomorrow' : 'in ' + n + ' days');
    ticker(state, L.springTitle + ' ' + when + ' on the Practice Field: ' + L.springNames[0] + ' (the starters) vs ' + L.springNames[1] + '.', {});
    call('ui', 'notify', state, { text: L.springTitle + ' ' + when + '. ' + L.springNames[0] + ' vs ' + L.springNames[1] + ' on the Practice Field.', kind: 'sports', ttl: 9000 });
    call('progress', 'sportsCard', state, { id: 'springGame', kicker: 'Newsflash · Athletics', title: L.springTitle,
      body: ['The first look at the ' + L.bsuNick + ': ' + L.springNames[0] + ' (the starters) against the ' + L.springNames[1] + ' scrimmage squad on the Practice Field, ' + when + '.',
        'No gate and no record: a concession line, +' + num(PE.spring.happiness, 1) + ' happiness, and your first 4th-down call.',
        'Coach ' + ((sp.coach && sp.coach.name) || 'Cheramie') + ' runs the ' + sp.playbook + ' playbook. Change it in the Season panel before kickoff.'] });
  }
  /** The scheduled day: start the set piece unless the day is busy (tutorial, a storm on the board, a set piece, a game today) → the next day. */
  function trySpring(state) {
    const sp = state.sports, day = today(state);
    if (sp.springDay < 0 || day < sp.springDay) return false;
    if (!sp.hasTeam) { sp.springDay = NONE; return false; }
    if (!inSpringWindow(day)) { sp.springDay = NONE; call('ui', 'notify', state, { text: 'The Spring Game window closed; the next one is in the spring.', kind: 'sports' }); return false; }
    const tut = call('progress', 'tutorialStage', state);
    const busy = !!state.setPiece || !!sp.game || (typeof tut === 'number' && tut < 6) || !!stormNow(state) || !!pv.landfallNow || todaysHomeIndex(state) >= 0;
    if (busy) { sp.springDay = day + Math.max(1, int(PE.spring.deferDays, 1)); return false; }
    return startSpring(state).ok === true;
  }
  /** Start the 300-tick Spring Game set piece now (highlights mode, kind 'spring'); without a session it resolves off-screen. */
  function startSpring(state) {
    const sp = state.sports;
    if (!sp.hasTeam) return { ok: false, reason: 'No team' };
    if (state.setPiece || sp.game) return { ok: false, reason: 'A set piece is running' };
    const Sg = PE.spring, year = yearOf(state);
    if (sp.starters.length < POS.length) fillStarters(state);
    storeRating(state);
    const e = { day: today(state), opp: L.springOpp, home: true, kind: 'spring', origKind: 'spring', oppRating: num(sp.rating, 0), slot: NONE, night: false };
    const g = makeGame(state, e, NONE, 'highlights');
    g.night = false;
    g.attendance = Math.round(num(state.economy && state.economy.students, 0) * num(Sg.attendanceShare, 0.25));
    g.len0 = Math.max(60, int(Sg.ticks, 300));
    sp.game = g;
    sp.springYear = year; sp.springDay = NONE;
    const seen = call('progress', 'setPieceSeen', state, 'spring') === true;
    call('session', 'startSetPiece', state, 'spring', { len: g.len0, skippable: seen });
    if (!state.setPiece) { sp.game = null; g.mode = 'silent'; kickoff(state, g); runSilent(state, g); finalizeSpring(state, g); return { ok: true, offscreen: true }; }
    if (!Number.isFinite(state.setPiece.tick)) state.setPiece.tick = 0;
    ticker(state, 'Kickoff on the Practice Field: the ' + L.springTitle + '. ' + L.springNames[0] + ' vs ' + L.springNames[1] + '.', {});
    call('ui', 'notify', state, { text: L.springTitle + ': kickoff. ' + L.springNames[0] + ' vs ' + L.springNames[1] + '.', kind: 'sports', ttl: 6000 });
    scriptSky(state, g, 0);
    return { ok: true, kind: 'spring', mode: 'highlights', len: g.len0 };
  }
  /** The Spring Game final: no record, no gate; the concession line, +happiness/+prestige, lastSpring, game:spring. */
  function finalizeSpring(state, g) {
    if (g.finalized) return;
    const sp = state.sports, Sg = PE.spring;
    if (!g.kickedOff) kickoff(state, g);
    if (!g.over) runSilent(state, g);
    g.revealDone = true; syncPts(g); g.finalized = true; g.anim = null;
    const sum = buildSummary(state, g);
    g.summary = sum; sp.lastSummary = sum;
    const purple = g.score[0], gold = g.score[1], won = purple > gold;
    sp.lastSpring = { year: yearOf(state), day: g.day, score: g.score.slice(), won: won, ot: !!g.ot, mvp: sum.mvp ? { name: sum.mvp.name, pos: sum.mvp.pos, line: sum.mvp.line } : null, bigPlay: sum.bigPlay, attendance: num(g.attendance, 0) };
    const cons = num(Sg.concessions, 0);
    if (cons > 0) { call('economy', 'post', state, 'athletics', cons, { i: venueTile(state), note: 'Spring Game concessions' }); g.revenue = cons; addRevenue(state, cons); }
    if (num(Sg.happiness, 0) > 0) call('economy', 'bump', state, 'happiness', num(Sg.happiness, 0), 'Spring Game');
    if (num(Sg.prestige, 0) > 0) call('economy', 'bump', state, 'prestige', num(Sg.prestige, 0), 'Spring Game');
    const mvpText = sum.mvp ? ' ' + sum.mvp.pos + ' ' + sum.mvp.name + ': ' + sum.mvp.line + '.' : '';
    ticker(state, L.springTitle + ' final: ' + L.springNames[0] + ' ' + purple + ', ' + L.springNames[1] + ' ' + gold + '.' + mvpText, {});
    call('ui', 'notify', state, { text: 'Spring Game final: ' + L.springNames[0] + ' ' + purple + '–' + gold + ' ' + L.springNames[1] + '.' + mvpText + ' +' + num(Sg.happiness, 0) + ' happiness.', kind: 'sports', ttl: 9000 });
    emit(EV.GAME_SPRING, scorePayload(g, { score: g.score.slice(), won: won, ot: !!g.ot, summary: sum, mode: g.mode, year: yearOf(state), attendance: num(g.attendance, 0), revenue: cons }));
    return { home: g.homePts, away: g.awayPts, won: won, bsu: purple, opp: gold };
  }

  // --- the off-season prospect board (PLAN_FOOTBALL §2.3 recruiting) ---------------------------------------------------
  function boardSize(state) {
    const RC = PE.recruit, c = num(state.economy && state.economy.coaching, 0), tiers = RC.boardCoachingTiers || [], sizes = RC.boardSizes || [3];
    let k = 0; for (let i = 0; i < tiers.length; i++) if (c >= tiers[i]) k = i + 1;
    return Math.max(1, int(sizes[Math.min(k, sizes.length - 1)], 3));
  }
  /** P2: one prospect at pos (fixed draw order: archetype, rating noise, name, hometown); rating ~ N(mean + archetype bias, sd) clamped; cost per year for eligibilityYears */
  function drawProspect(state, pos, mean) {
    const Q = PR.prospect, arch = ((data().football || {}).prospects || {}).archetypes || [];
    const cands = arch.filter(function (a) { return a && a.pos === pos; });
    const a = cands.length ? R.pick(cands) : { id: '', title: '', blurb: '', ratingBias: 0 };
    const rating = clamp(Math.round(num(mean, 60) + num(a.ratingBias, 0) + R.gauss() * num(Q.sd, 8)), int(Q.min, 50), int(Q.max, 95));
    return { name: fbName(), pos: pos, side: unitSide(pos), hometown: drawHometown(), rating: rating, cost: costPerYear(rating), years: int(PR.eligibilityYears, 4), archetype: String(a.id || ''), title: String(a.title || ''), blurb: String(a.blurb || ''), signed: false };
  }
  /** Dec 9: the board — prospect.perPos at every position; the mean follows prestige and the athletics headroom share (the recruiting bonus) */
  function drawProspects(state) {
    const sp = state.sports, year = yearOf(state);
    const bonus = Math.round(num(PR.prospect.bonusMax, 10) * headroomShare(state) * 10) / 10, mean = prospectMean(state, bonus), list = [];
    for (let i = 0; i < POS.length; i++) for (let k = 0; k < int(PR.prospect.perPos, 2); k++) list.push(drawProspect(state, POS[i], mean));
    sp.prospects = { year: year, offeredDay: today(state), lockDay: dayOfDate(PS.schedule.recruitDate, year + 1), list: list, signed: 0, answered: false, offered: false, reminded: false, bonus: bonus, mean: Math.round(mean) };
    return sp.prospects;
  }
  function signedOn(b, side) { let n = 0; if (b && Array.isArray(b.list)) for (let i = 0; i < b.list.length; i++) { const p = b.list[i]; if (p && p.signed && unitSide(p.pos) === side) n++; } return n; }
  function lockDayOf(state, b) { return int(b && b.lockDay, dayOfDate(PS.schedule.recruitDate, int(b && b.year, yearOf(state)) + 1)); }
  /** the board card (ui_panels' 'recruitboard' when the ui has it, a notify otherwise); why = 'open' | 'closing' */
  function boardCard(state, why, daysLeft) {
    const b = state.sports.prospects; if (!b) return false;
    const payload = { why: why, year: b.year, n: b.list.length, perSide: int(PR.maxPerSideClass, 4), signed: { offense: signedOn(b, 'offense'), defense: signedOn(b, 'defense') }, daysLeft: int(daysLeft, 0), lockDay: lockDayOf(state, b), mean: int(b.mean, 0), bonus: num(b.bonus, 0) };
    const ui = dep('ui');
    if (ui && typeof ui.card === 'function' && ui.cards && typeof ui.cards.recruitboard === 'function') { call('ui', 'card', state, 'recruitboard', payload); return true; }
    call('ui', 'notify', state, { text: why === 'open' ? 'Recruiting board: ' + b.list.length + ' prospects, 2 per position. Sign up to ' + payload.perSide + ' offense and ' + payload.perSide + ' defense on the Recruiting tab before Aug 5.' : 'The recruiting board locks in ' + payload.daysLeft + ' days (Aug 5): ' + (payload.signed.offense + payload.signed.defense) + ' signed.', kind: 'sports', ttl: 12000 });
    return false;
  }
  /** Dec 9: the board is offered once — a ticker line and the board card */
  function offerProspects(state) {
    const sp = state.sports, b = sp.prospects;
    if (!b || b.offered) return false;
    b.offered = true;
    ticker(state, 'Recruiting season: ' + b.list.length + ' prospects on the board, 2 per position. Sign up to ' + int(PR.maxPerSideClass, 4) + ' offense and ' + int(PR.maxPerSideClass, 4) + ' defense before Aug 5.', {});
    boardCard(state, 'open', lockDayOf(state, b) - today(state));
    return true;
  }
  /** reminderDays before the lock: one reminder card while the board is open */
  function remindBoard(state, day) {
    const b = state.sports.prospects; if (!b || b.reminded) return;
    const lock = lockDayOf(state, b), left = lock - day;
    if (left > int(PR.reminderDays, 7) || left <= 0) return;
    b.reminded = true;
    boardCard(state, 'closing', left);
  }
  /** Aug 5: every signed prospect joins the roster as a freshman (the first year's scholarship was paid at signing); a full position releases its weakest; the board closes */
  function applyProspects(state) {
    const sp = state.sports, b = sp.prospects;
    if (!b) return;
    const year = yearOf(state);
    for (let i = 0; i < b.list.length; i++) {
      const p = b.list[i]; if (!p || !p.signed) continue;
      const added = addPlayer(state, { name: p.name, pos: p.pos, hometown: p.hometown, rating: p.rating, classYear: L.recruitClass, class: L.recruitClass, signedYear: year, cost: int(p.cost, 0), dinged: 0, walkOn: false, title: String(p.title || '') });
      if (sp.records && Array.isArray(sp.records.recruits)) { sp.records.recruits.push({ year: year, name: p.name, pos: p.pos, hometown: p.hometown, rating: p.rating, cost: int(p.cost, 0), title: String(p.title || '') }); while (sp.records.recruits.length > PB.recruitsMax) sp.records.recruits.shift(); }   // P3: the Records tab's recruiting history
      const cut = added.cut.length ? ', ' + nameList(added.cut) + ' released' : '';
      call('ui', 'notify', state, { text: p.pos + ' ' + p.name + ' (' + p.hometown + ') arrives rated ' + p.rating + cut + '.', kind: 'sports', ttl: 9000 });
      ticker(state, p.pos + ' ' + p.name + ' reports for fall camp.' + (p.blurb ? ' ' + p.blurb : '') + cut + '.', {});
    }
    sp.prospects = null;
  }
  /** Aug 5: the returning scholarship players' year (fund first, then cash — a commitment, so it posts even when cash is short) */
  function chargeScholarships(state, year) {
    const r = rosterOf(state.sports); let due = 0, n = 0;
    for (let i = 0; i < r.length; i++) if (r[i].cost > 0 && r[i].signedYear < year) { due += r[i].cost; n++; }
    if (due > 0) { athleticsCharge(state, due, 'coaching', { note: 'Scholarships ' + year + ' (' + n + ' players)', force: true }); refreshBudget(state, 'scholarships'); }
    return due;
  }

  // ---------------------------------------------------------------------------
  // Recruiting card (Tier 2 #6; cheap)
  // ---------------------------------------------------------------------------
  function drawRecruit(state) {
    const sp = state.sports;
    sp.recruit = { price: R.pick(L.recruitPrices), pos: R.pick(L.recruitPositions), name: drawName(), hometown: drawHometown(), offeredDay: today(state), accepted: false, answered: false };
  }
  function recruitConditionMet(state, rc) {
    if (!rc) return false;
    switch (rc.price) {
      case L.recruitPrices[0]: return !!rc.paid;
      case L.recruitPrices[1]: return greekNearVenue(state, venueInfo(state).building) > 0;
      case L.recruitPrices[2]: return call('buildings', 'has', state, 'rec_center') === true;
      case L.recruitPrices[3]: return call('buildings', 'has', state, 'res_tower') === true;
      default: return false;
    }
  }
  /** Aug 5: an accepted, fulfilled recruit replaces the starter at their position with a 95. */
  function applyRecruit(state) {
    const sp = state.sports, rc = sp.recruit;
    if (rc && rc.accepted && recruitConditionMet(state, rc)) {
      const pos = rc.pos;
      let k = NONE;
      for (let i = 0; i < sp.starters.length; i++) if (sp.starters[i].pos === pos) { k = i; break; }
      if (sp.starters.length < POS.length) { fillStarters(state); k = NONE; for (let i = 0; i < sp.starters.length; i++) if (sp.starters[i].pos === pos) { k = i; break; } }
      if (k < 0) k = Math.max(0, POS.indexOf(pos));
      addPlayer(state, { name: rc.name, pos: pos, hometown: rc.hometown, rating: PS.recruitRating, classYear: 'Fr', class: 'Fr', signedYear: yearOf(state), cost: 0, dinged: 0, walkOn: false });   // P2: joins the roster (the NIL price was the whole fee)
      call('ui', 'notify', state, { text: pos + ' ' + rc.name + ' (' + rc.hometown + ') signs. Rated ' + PS.recruitRating + '.', kind: 'sports' });
    }
    sp.recruit = null;
  }

  // ---------------------------------------------------------------------------
  // Daily work (§5.1 step 8) and the per-tick work
  // ---------------------------------------------------------------------------
  function daily(state, day) {
    const sp = state.sports;
    const p = BSU.dayParts(day);
    const year = p.year;
    // Aug 5: the fall lock — starters, recruit, schedule
    if (sp.hasTeam && day === dayOfDate(PS.schedule.recruitDate, year)) {
      // the roster: three starters (drawn here the first time; May 5 turns seniors over), then the recruit lands
      if (sp.starters.length < POS.length) fillStarters(state);
      applyRecruit(state);
      applyProspects(state);   // P2: signed prospects join the roster as freshmen at the lock; the board closes
      chargeScholarships(state, year);   // P2: the returning scholarship players' year
      if (sp.seasonYear !== year) buildSchedule(state, year);
      if (call('buildings', 'has', state, 'stadium') === true) drawRecruit(state);
    }
    // pass C: the Spring Game in later years (Apr 8) — one per year; Year 1's comes from the field completing (refreshTeam)
    if (sp.hasTeam && sp.springYear !== year && sp.springDay < 0) scheduleSpring(state, false);
    // a team that first exists between Aug 5 and Dec 8: the remaining dates only
    if (sp.hasTeam && sp.seasonYear !== year) {
      const aug5 = dayOfDate(PS.schedule.recruitDate, year), dec8 = dayOfDate(PS.schedule.seasonEnd, year);
      if (day > aug5 && day < dec8) { if (!sp.starters.length) sp.starters = drawStarters(state); buildSchedule(state, year); }
    }
    // May 5 (P2 gradDate): classes advance, seniors leave, walk-ons fill the empty starter slots
    if (sp.hasTeam && sp.starters.length && day === dayOfDate(PR.gradDate || 'May 5', year)) graduate(state);
    // P2: the board's lock reminder, reminderDays before Aug 5
    if (sp.hasTeam && sp.prospects) remindBoard(state, day);
    // PLAN_V2 P1: Nov 8 — raise offers for coaches other programs are circling (above 4★ at prestige < 40)
    if (sp.hasTeam && day === dayOfDate(PF.poach.offerDate, year)) offerRaises(state);
    // Dec 9: the offseason hire card and the prospect board (pass C: offered once per off-season); P1: candidates for all three roles
    if (sp.hasTeam && day === dayOfDate(PS.schedule.offseasonStart, year)) { drawCandidates(state); drawProspects(state); offerProspects(state); }
    // PLAN_V2 P3: Jan 1 — the university's top-up moves into the athletics fund (once per year, with a team)
    if (sp.hasTeam && day > 0 && day === dayOfDate(PB.transferDate, year)) yearlyTopUp(state, year);
    storeRating(state);
    if (!sp.hasTeam) return;
    // catch-up: an unplayed game whose date passed (a set piece blocked it) resolves off-screen
    for (let i = 0; i < sp.schedule.length; i++) {
      const e = sp.schedule[i];
      if (e && !e.played && !e.cancelled && e.day < day && !(e.postponed && e.postponedTo < 0) && e.kind !== 'bowl') playOffscreen(state, i);
    }
    if (pv.passedDay >= 0 || (!stormNow(state) && findEntry(state, function (e) { return !e.played && e.postponed && e.postponedTo < 0; }) >= 0)) {
      if (pv.passedDay < 0) pv.passedDay = day;
      scheduleMakeups(state);
    }
    // today's games
    if (!state.setPiece && !sp.game) {
      const away = findEntry(state, function (e) { return !e.played && !e.cancelled && !e.home && e.day === day && e.kind !== 'bowl'; });
      if (away >= 0) playOffscreen(state, away);
      const home = todaysHomeIndex(state);
      if (home >= 0) tryStartHome(state, home);
    }
    // Dec 8 (or later): season end once nothing is left on the calendar
    if (seasonActive(state) && day >= seasonEndDay(state) && !sp.game && !state.setPiece) {
      const pending = findEntry(state, function (e) { return !e.played && !e.cancelled && e.kind !== 'bowl' && (e.day >= day || (e.postponed && e.postponedTo < 0)); });
      if (pending < 0 || day > seasonEndDay(state) + L.makeupDays) {
        if (pending >= 0) { for (let i = 0; i < sp.schedule.length; i++) { const e = sp.schedule[i]; if (e && !e.played) { e.played = true; e.result = null; e.cancelled = true; } } }
        endSeason(state);
      }
    } else if (sp.hasTeam && sp.seasonYear === year && !sp.seasonDone && day >= seasonEndDay(state) && !unplayedRegular(state) && !sp.game && !state.setPiece) endSeason(state);
  }
  function everyTick(state) {
    const sp = state.sports;
    const spc = state.setPiece;
    const g = sp.game;
    if (g && spc && (spc.kind === 'game' || spc.kind === 'spring')) { gameTick(state, g, num(spc.tick, 0)); return; }
    if (g && spc && spc.kind === 'montage') { montageTick(state, g, num(spc.tick, 0)); return; }
    if (g && !spc) { if (!g.finalized) { g.halftimeAnswered = true; finalize(state, g, true); } clearGame(state); }
    if (pv.landfallNow) { pv.landfallNow = false; const idx = todaysHomeIndex(state); if (idx >= 0 && !sp.game) M.postpone(state, idx); }
    if (sp.springDay >= 0 && !spc && !sp.game && pv.pending < 0 && today(state) >= sp.springDay && pv.springTriedDay !== today(state)) { pv.springTriedDay = today(state); trySpring(state); }
    if (pv.playThrough && !pv.playThrough.answered && state.tick >= pv.playThrough.tick + TOAST_TICKS) {
      call('ui', 'answerDecision', 'playThrough', 'default');
      if (!pv.playThrough.answered) resolvePlayThrough(state, 'default');
    }
    if (pv.pending >= 0 && !spc && !sp.game) startHome(state, pv.pending);
  }

  // ---------------------------------------------------------------------------
  // Event listeners (owner 'sports'): flags only; the work happens in tick
  // ---------------------------------------------------------------------------
  function onDecision(p) {
    if (!S || !pv || !p) return;
    if (p.id === 'halftime' || p.id === 'fourthDown' || p.id === 'twoPoint') { const g = S.sports && S.sports.game; if (g && g.decision && g.decision.id === p.id) M.decide(S, p.answer); }
    else if (p.id === 'playThrough') resolvePlayThrough(S, p.answer === 'yes' ? 'yes' : 'no');
  }
  M._onDecision = onDecision;
  function onBuilding(p) { if (pv && p && (p.type === 'practice_field' || p.type === 'stadium' || p.type === 'tiger_habitat' || p.type === 'rec_center' || p.type === 'greek_house')) pv.venueDirty = true; }
  function onLandfall() { if (pv) pv.landfallNow = true; }
  function onPassed() { if (pv && S) pv.passedDay = today(S); }
  function onSetPieceEnd(p) {
    if (!S || !p || (p.kind !== 'game' && p.kind !== 'montage' && p.kind !== 'spring')) return;
    try {
      const g = S.sports.game;
      if (g && !g.finalized) { g.halftimeAnswered = true; finalize(S, g, true); }
      clearGame(S);
    } catch (e) { BSU.error('sports', 'setpiece:end', e); }
  }

  // ---------------------------------------------------------------------------
  // PLAN_V2 P3: the athletics budget — a salary cap that grows with success
  //   total     = base + revenueShare × last season's athletics revenue (gate, concessions, tailgates, club pay,
  //               bowl purse, Spring Game concessions) + prestigePer10 × prestige/10 + boosters (a season of
  //               ≥ boosterWins) + the university top-up (topUpShare × base, 0–150 %)
  //   committed = head coach + coordinator salaries (coachSalary: $150k × stars², ×0.55 for OC/DC; P1) + signed prospects + upkeepShare × the venue's
  //               annual upkeep + the coaching spend + the Homecoming tier
  //   headroom  = total − committed; every sports spend asks canAfford(state, amount) before cash.
  //   The top-up is real money: it moves each Jan 1 (ledger expense 'athletics' → "Athletics top-up"; raising
  //   the slider mid-year moves the difference at once), sits in budget.fund, and athletics spends (fees,
  //   buyouts, signings, the NIL fund, the monthly coaching charge via drawFund) draw on it before cash.
  // ---------------------------------------------------------------------------
  const PB = PS.budget || { base: 2000000, revenueShare: 0.35, prestigePer10: 50000, boosters: 500000, boosterWins: 7, topUpMax: 1.5, topUpStep: 0.1, salaryPerStar2: 150000, coordinatorShare: 0.55, upkeepShare: 0.1, transferDate: 'Jan 1', recruitsMax: 40 };
  /** $150k × stars² a year for the head coach ('hc'); coordinators ('oc' | 'dc', P1) at coordinatorShare of that. Pure. */
  function coachSalary(stars, role) {
    const st = clamp(int(stars, 0), 0, num(PS.starMax, 5));
    const hc = PB.salaryPerStar2 * st * st;
    return Math.round(role === 'oc' || role === 'dc' ? hc * PB.coordinatorShare : hc);
  }
  function budgetText() { const f = data().football; return (f && f.budget) || {}; }
  function newBudget() { return { year: 0, base: PB.base, fromRevenue: 0, fromPrestige: 0, boosters: 0, topUpShare: 0, topUp: 0, total: PB.base, committed: 0, lines: [], fund: 0, revenueYear: 0, lastRevenue: 0, lastWins: 0, topUpPaid: 0, topUpYear: 0 }; }
  /** the stored budget, every field finite (lazy on old saves) */
  function budgetOf(state) {
    const sp = state.sports;
    if (!sp.budget || typeof sp.budget !== 'object') sp.budget = newBudget();
    const b = sp.budget;
    b.year = int(b.year, 0); b.base = Math.max(0, int(b.base, PB.base)); b.fromRevenue = Math.max(0, int(b.fromRevenue, 0)); b.fromPrestige = Math.max(0, int(b.fromPrestige, 0)); b.boosters = Math.max(0, int(b.boosters, 0));
    b.topUpShare = clamp(num(b.topUpShare, 0), 0, PB.topUpMax); b.topUp = Math.max(0, int(b.topUp, 0)); b.total = int(b.total, b.base); b.committed = int(b.committed, 0);
    b.fund = Math.max(0, int(b.fund, 0)); b.revenueYear = Math.max(0, int(b.revenueYear, 0)); b.lastRevenue = Math.max(0, int(b.lastRevenue, 0));
    b.lastWins = int(b.lastWins, 0); b.topUpPaid = Math.max(0, int(b.topUpPaid, 0)); b.topUpYear = int(b.topUpYear, 0);
    if (!Array.isArray(b.lines)) b.lines = [];
    return b;
  }
  /** the top-up the cap counts: the planned share × base, never below what already moved this year */
  function topUpOf(state, b) { const planned = Math.round(b.topUpShare * b.base); const paid = b.topUpYear === yearOf(state) ? b.topUpPaid : 0; return Math.max(planned, paid); }
  /** the venue's annual upkeep (practice field + bleachers tier + stadium tier) from the catalog, as buildings.upkeepTotal counts it */
  function venueUpkeepYear(state) {
    const cat = data().catalog || {}; let monthly = 0;
    const types = ['practice_field', 'stadium'];
    for (let t = 0; t < types.length; t++) {
      const row = cat[types[t]]; const list = call('buildings', 'list', state, types[t]) || [];
      for (let i = 0; i < list.length; i++) {
        const bld = list[i]; if (!bld || !row) continue;
        const tier = int(bld.tier, 0); const tr = tier > 0 ? (row.tiers || []).filter(function (x) { return x && x.tier === tier; })[0] : null;
        let u = tr ? num(tr.upkeep, 0) : num(row.upkeep, 0);
        if (types[t] === 'practice_field' && tr) u = num(row.upkeep, 0) + num(tr.upkeep, 0);
        monthly += u;
      }
    }
    return Math.round(monthly * num(PT.monthsPerYear, 12));
  }
  /** the committed lines, live: [{key, label, amount}] (P2 adds the roster's per-year costs under 'signings') */
  function committedLines(state) {
    const sp = state.sports, e = state.economy || {}, T = budgetText().lines || {};
    const lines = [];
    const hc = sp.coach;
    lines.push({ key: 'coach', label: T.coach || 'Head coach salary', amount: hc && hc.name ? Math.max(0, int(hc.salary, coachSalary(hc.stars, 'hc'))) : 0 });
    for (let i = 1; i < ROLES.length; i++) { const r = ROLES[i], c = sp.staff && sp.staff[r]; lines.push({ key: r, label: T[r] || roleLabel(r), amount: c && c.name ? Math.max(0, int(c.salary, 0)) : 0 }); }   // P1: the coordinators
    lines.push({ key: 'coaching', label: T.coaching || 'Coaching spend', amount: Math.max(0, int(e.coaching, 0)) });
    let sign = 0; const b = sp.prospects; if (b && Array.isArray(b.list)) for (let i = 0; i < b.list.length; i++) if (b.list[i] && b.list[i].signed) sign += Math.max(0, int(b.list[i].cost, 0));
    lines.push({ key: 'signings', label: T.signings || 'Signed prospects', amount: sign });
    let players = 0; const ro = sp.roster; if (Array.isArray(ro)) for (let i = 0; i < ro.length; i++) if (ro[i]) players += Math.max(0, int(ro[i].cost, 0));   // P2: the roster's scholarships per year
    lines.push({ key: 'players', label: T.players || 'Player scholarships', amount: players });
    lines.push({ key: 'upkeep', label: T.upkeep || 'Venue upkeep share', amount: sp.hasTeam ? Math.round(venueUpkeepYear(state) * PB.upkeepShare) : 0 });
    lines.push({ key: 'homecoming', label: T.homecoming || 'Homecoming', amount: Math.max(0, int(sp.homecomingBudget, 0)) });
    return lines;
  }
  /** recompute the stored total / committed / lines; emits budget:changed{why} when why is given */
  function refreshBudget(state, why) {
    const b = budgetOf(state);
    b.topUp = topUpOf(state, b);
    b.total = Math.round(b.base + b.fromRevenue + b.fromPrestige + b.boosters + b.topUp);
    b.lines = committedLines(state);
    let c = 0; for (let i = 0; i < b.lines.length; i++) c += b.lines[i].amount;
    b.committed = c;
    if (why) emit(EV.BUDGET_CHANGED, { why: why, year: b.year, total: b.total, committed: b.committed, headroom: b.total - b.committed, fund: b.fund });
    return b;
  }
  /** season end: next year's sources from this season's revenue, wins and the prestige of the day */
  function rollBudget(state) {
    const b = budgetOf(state), e = state.economy || {};
    b.lastRevenue = b.revenueYear; b.revenueYear = 0;
    b.lastWins = int(state.sports.lastSeason && state.sports.lastSeason.wins, 0);
    b.fromRevenue = Math.round(b.lastRevenue * PB.revenueShare);
    b.fromPrestige = Math.round(PB.prestigePer10 * num(e.prestige, 0) / 10);
    b.boosters = b.lastWins >= PB.boosterWins ? PB.boosters : 0;
    b.year = yearOf(state) + 1;
    refreshBudget(state, 'season');
  }
  /** a new game or a pre-P3 save: prestige and last season are known, the revenue share starts at 0 */
  function initBudget(state) {
    const b = budgetOf(state), e = state.economy || {};
    b.year = yearOf(state);
    b.fromPrestige = Math.round(PB.prestigePer10 * num(e.prestige, 0) / 10);
    b.lastWins = int(state.sports.lastSeason && state.sports.lastSeason.wins, 0);
    b.boosters = b.lastWins >= PB.boosterWins ? PB.boosters : 0;
    refreshBudget(state, null);
  }
  function addRevenue(state, amount) { const b = budgetOf(state); b.revenueYear += Math.max(0, int(amount, 0)); }
  /** move cash into the athletics fund: a forced ledger 'athletics' expense ("Athletics top-up") */
  function transferTopUp(state, amount) {
    const b = budgetOf(state), amt = Math.max(0, int(amount, 0));
    if (amt <= 0) return true;
    if (call('economy', 'charge', state, amt, 'athletics', { force: true, note: budgetText().ledgerLabel || 'Athletics top-up' }) === false) return false;
    b.fund += amt; b.topUpPaid += amt; b.topUpYear = yearOf(state);
    return true;
  }
  /** Jan 1 (with a team): the year's planned top-up moves, once */
  function yearlyTopUp(state, year) {
    const b = budgetOf(state);
    if (b.topUpYear === year) return;
    b.topUpPaid = 0; b.topUpYear = year;
    const planned = Math.round(b.topUpShare * b.base);
    if (planned > 0) transferTopUp(state, planned);
    refreshBudget(state, 'topup');
  }
  /** an athletics spend: the fund first, then cash through economy.charge; false (nothing moved) when neither covers it */
  function athleticsCharge(state, amount, key, meta) {
    const b = budgetOf(state), amt = Math.max(0, int(amount, 0));
    if (amt <= 0) return true;
    const fromFund = Math.min(b.fund, amt), rest = amt - fromFund;
    if (rest > 0 && call('economy', 'charge', state, rest, key, meta) === false) return false;
    b.fund -= fromFund;
    return true;
  }
  /** {ok, reason, headroom, total, committed, amount}: amount ≤ headroom, and the cash (after the fund) covers it */
  function canAffordAthletics(state, amount) {
    const b = refreshBudget(state, null), amt = int(amount, 0), headroom = b.total - b.committed;
    const money = function (n) { return BSU.formatMoney ? BSU.formatMoney(n) : '$' + n; };
    const out = { ok: true, reason: '', headroom: headroom, total: b.total, committed: b.committed, amount: amt };
    if (amt <= 0) return out;
    if (amt > headroom) { out.ok = false; out.reason = 'Athletics budget: ' + money(amt) + ' needed, ' + money(Math.max(0, headroom)) + ' headroom (' + money(b.committed) + ' of ' + money(b.total) + ' committed)'; return out; }
    const rest = amt - Math.min(b.fund, amt);
    if (rest > 0 && call('economy', 'canAfford', state, rest) === false) { out.ok = false; out.reason = 'Not enough cash for ' + money(amt) + ' (athletics fund ' + money(b.fund) + ')'; }
    return out;
  }
  /** the player-facing view: the stored budget plus headroom and the five sources, committed recomputed live */
  M.budget = function (state) {
    try {
      const b = refreshBudget(state, null), T = budgetText().sources || {};
      const money = function (n) { return BSU.formatMoney ? BSU.formatMoney(n) : '$' + n; };
      return {
        year: b.year, base: b.base, fromRevenue: b.fromRevenue, fromPrestige: b.fromPrestige, boosters: b.boosters, topUpShare: b.topUpShare, topUp: b.topUp,
        total: b.total, committed: b.committed, headroom: b.total - b.committed, fund: b.fund, lastRevenue: b.lastRevenue, revenueYear: b.revenueYear, lastWins: b.lastWins,
        topUpPaid: b.topUpYear === yearOf(state) ? b.topUpPaid : 0, topUpMax: PB.topUpMax, topUpStep: PB.topUpStep, boosterWins: PB.boosterWins,
        sources: [
          { key: 'base', label: T.base || 'Base allocation', amount: b.base, note: '' },
          { key: 'revenue', label: T.revenue || 'Share of last season\'s gate', amount: b.fromRevenue, note: Math.round(PB.revenueShare * 100) + '% of ' + money(b.lastRevenue) },
          { key: 'prestige', label: T.prestige || 'Prestige', amount: b.fromPrestige, note: money(PB.prestigePer10) + ' per 10 prestige' },
          { key: 'boosters', label: T.boosters || 'Booster donations', amount: b.boosters, note: b.lastWins >= PB.boosterWins ? b.lastWins + ' wins last season' : 'after ' + PB.boosterWins + ' wins (' + b.lastWins + ' last season)' },
          { key: 'topUp', label: T.topUp || 'University top-up', amount: b.topUp, note: Math.round(b.topUpShare * 100) + '% of base' }
        ],
        lines: b.lines.map(function (l) { return { key: l.key, label: l.label, amount: l.amount }; })
      };
    } catch (e) { BSU.error('sports', 'budget', e); return null; }
  };
  /** the top-up slider: share of base (0–topUpMax, snapped to topUpStep); with a team, a raise above this year's paid amount moves now → {ok, share, topUp, moved} */
  M.setTopUp = function (state, share) {
    try {
      const b = budgetOf(state), sp = state.sports;
      const step = num(PB.topUpStep, 0.1);
      const v = clamp(Math.round(num(share, 0) / step) * step, 0, PB.topUpMax);
      b.topUpShare = Math.round(v * 1000) / 1000;
      let moved = 0;
      if (sp.hasTeam) {
        const year = yearOf(state);
        if (b.topUpYear !== year) { b.topUpYear = year; b.topUpPaid = 0; }
        const planned = Math.round(b.topUpShare * b.base), raise = planned - b.topUpPaid;
        if (raise > 0 && transferTopUp(state, raise)) moved = raise;
      }
      refreshBudget(state, 'topup');
      return { ok: true, share: b.topUpShare, topUp: b.topUp, moved: moved };
    } catch (e) { BSU.error('sports', 'setTopUp', e); return { ok: false, reason: 'error' }; }
  };
  /** {ok, reason, headroom, total, committed}: can athletics commit `amount` now? (every sports spend asks this first) */
  M.canAfford = function (state, amount) { try { return canAffordAthletics(state, amount); } catch (e) { BSU.error('sports', 'canAfford', e); return { ok: false, reason: 'error', headroom: 0, total: 0, committed: 0, amount: int(amount, 0) }; } };
  /** economy's monthly coaching charge draws on the athletics fund first: returns the amount the fund covered */
  M.drawFund = function (state, amount) { try { const b = budgetOf(state); const d = Math.min(b.fund, Math.max(0, int(amount, 0))); b.fund -= d; return d; } catch (e) { BSU.error('sports', 'drawFund', e); return 0; } };
  M.coachSalary = function (stars, role) { return coachSalary(stars, role); };

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  /** once per page load: subscriptions only */
  M.init = function (state) {
    try {
      BSU.events.clear('sports');
      BSU.events.on(EV.DECISION_CLOSED, onDecision, 'sports');
      BSU.events.on(EV.BUILDING_COMPLETE, onBuilding, 'sports');
      BSU.events.on(EV.BUILDING_UPGRADED, onBuilding, 'sports');
      BSU.events.on(EV.BUILDING_REMOVED, onBuilding, 'sports');
      BSU.events.on(EV.STORM_LANDFALL, onLandfall, 'sports');
      BSU.events.on(EV.STORM_PASSED, onPassed, 'sports');
      BSU.events.on(EV.SETPIECE_END, onSetPieceEnd, 'sports');
      if (state && state.sports) { rebind(state); ensureKeys(state); }
    } catch (e) { BSU.error('sports', 'init', e); }
  };
  /** every newGame/load: rebind the closure; never draws rng.sim (the season is drawn on Aug 5) */
  M.reset = function (state, fresh) {
    try {
      if (!state || !state.sports) return;
      rebind(state);
      ensureKeys(state);
      if (fresh === true) {
        // a fresh tree: nothing to draw; the first field creates the coach and starters
        state.sports.game = null;
      }
    } catch (e) { BSU.error('sports', 'reset', e); }
  };
  /** §5.1 step 8 */
  M.tick = function (state, flags) {
    try {
      if (!state || !state.sports || !state.calendar) return;
      if (S !== state || !pv) { rebind(state); ensureKeys(state); }
      const day = today(state);
      const newDay = !!(flags && flags.newDay) || pv.lastDay !== day;
      pv.lastDay = day;
      if (pv.venueDirty || newDay) refreshTeam(state);
      if (newDay) daily(state, day);
      everyTick(state);
    } catch (e) { BSU.error('sports', 'tick', e); }
  };

  // ---------------------------------------------------------------------------
  // Public queries (ARCHITECTURE §5.9 + brief §1)
  // ---------------------------------------------------------------------------
  /** state.sports (read-only for others; carries clubOnly) */
  M.season = function (state) { try { if (state && state.sports) ensureKeys(state); return state ? state.sports : null; } catch (e) { BSU.error('sports', 'season', e); return state ? state.sports : null; } };
  /** {rating, terms} — pure (the daily step stores the same into state.sports) */
  M.rating = function (state) { try { return computeRating(state); } catch (e) { BSU.error('sports', 'rating', e); return { rating: 0, terms: {} }; } };
  /** P(BSU wins) vs an opponent key (or a numeric rating) at night/home; 0.5 for an unknown opponent */
  M.winProb = function (state, opp, night, home) {
    try {
      const oppRating = (typeof opp === 'number') ? opp : (oppInfo(opp) ? oppRatingFor(state, opp) : null);
      if (oppRating === null) return 0.5;
      return probFor(state, state.sports.rating, oppRating, !!night, !!home);
    } catch (e) { BSU.error('sports', 'winProb', e); return 0.5; }
  };
  /** 'Underdog' | 'Even' | 'Favored' for a probability (the Season panel prints "Underdog · 12%") */
  M.probWord = function (p) { return probWord(num(p, 0.5)); };
  M.venueSeats = function (state) { try { return venueInfo(state).seats; } catch (e) { BSU.error('sports', 'venueSeats', e); return 0; } };
  /** attendance for a game-like {opp, night, kind, home} (defaults: the next home entry) */
  M.attendance = function (state, game) {
    try {
      let g = game;
      if (!g) { const i = findEntry(state, function (e) { return !e.played && e.home; }); g = i >= 0 ? state.sports.schedule[i] : { opp: 'redstick', night: false, kind: 'regular', home: true }; }
      if (g.home === undefined) g = { opp: g.opp, night: !!g.night, kind: g.kind || 'regular', origKind: g.origKind, home: true };
      return attendanceFor(state, g);
    } catch (e) { BSU.error('sports', 'attendance', e); return 0; }
  };
  /** the next unplayed, uncancelled entry dated today or later (postponed-pending ones excluded), or null */
  M.upcoming = function (state) {
    try {
      const day = today(state);
      let best = null;
      const s = state.sports.schedule;
      for (let i = 0; i < s.length; i++) { const e = s[i]; if (e && !e.played && !e.cancelled && e.day >= day && !(e.postponed && e.postponedTo < 0) && (!best || e.day < best.day)) best = e; }
      return best;
    } catch (e) { BSU.error('sports', 'upcoming', e); return null; }
  };
  /** economy's spirit term: home wins this season (0 after Dec 8) */
  M.homeWinsThisSeason = function (state) { try { return state.sports.seasonDone ? 0 : int(state.sports.homeWins, 0); } catch (e) { return 0; } };
  M.winPctLast4 = function (state) { try { return winPctLast4(state); } catch (e) { return L.neutralWinPct; } };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  /** debug "Trigger home game": the next unplayed home entry, or an ad-hoc game vs Red Stick today */
  M.playHome = function (state) {
    try {
      const sp = state.sports;
      if (S !== state || !pv) { rebind(state); ensureKeys(state); }
      refreshTeam(state);
      if (!sp.hasTeam) return { ok: false, reason: 'No team: build a Practice Field' };
      if (sp.venue === 'none') return { ok: false, reason: 'No home venue: add the Bayou Field bleachers' };
      if (state.setPiece || sp.game) return { ok: false, reason: 'A set piece is already running' };
      storeRating(state);
      let idx = findEntry(state, function (e) { return !e.played && !e.cancelled && e.home; });
      if (idx < 0) {
        const opp = 'redstick';
        const e = makeEntry(today(state), opp, true, 'regular', 0, oppBaseRating(opp) + R.range(-PS.oppNoise, PS.oppNoise));
        e.adhoc = true;
        sp.schedule.push(e);
        idx = sp.schedule.length - 1;
        emit(EV.GAME_SCHEDULED, { day: e.day, opp: opp, home: true, kind: 'regular' });
      }
      return startHome(state, idx);
    } catch (e) { BSU.error('sports', 'playHome', e); return { ok: false, reason: 'error' }; }
  };
  /** off-screen: the whole score model in one tick for schedule entry gameIndex → result or null */
  M.simGame = function (state, gameIndex) {
    try {
      if (S !== state || !pv) { rebind(state); ensureKeys(state); }
      if (!Number.isInteger(gameIndex)) return null;
      return playOffscreen(state, gameIndex);
    } catch (e) { BSU.error('sports', 'simGame', e); return null; }
  };
  /** Legacy halftime answer: resolves a pending halftime decision ('open it up' when goForIt, else 'stay'); no-op otherwise. */
  M.halftime = function (state, goForIt) {
    try {
      const g = state && state.sports && state.sports.game;
      if (!g || !g.decision || g.decision.kind !== 'halftime') return;
      M.decide(state, goForIt ? 'open' : 'stay');
    } catch (e) { BSU.error('sports', 'halftime', e); }
  };
  /** Answer the pending game decision (halftime: open|pound|stay; fourthDown: go|fg|punt|kick; twoPoint: two|kick; also yes|no|default). */
  M.decide = function (state, choice) {
    try {
      const g = state && state.sports && state.sports.game;
      if (!g || !g.decision) return { ok: false, reason: 'No decision pending' };
      const id = g.decision.id, kind = g.decision.kind;
      applyDecision(state, g, choice);
      call('ui', 'answerDecision', id, 'default');   // closes a still-open toast; the re-entrant decision:closed finds nothing pending
      return { ok: true, id: id, kind: kind, chosen: kind === 'halftime' ? g.halftimeChoice : (kind === 'fourthDown' ? g.pendingCall : g.pendingTry) };
    } catch (e) { BSU.error('sports', 'decide', e); return { ok: false, reason: 'error' }; }
  };
  /** at set-piece tick ≥ 200 when the game set piece has been seen: the engine finishes silently, the final posts, the set piece jumps to its last tick */
  M.skipToFinal = function (state) {
    try {
      const spc = state.setPiece, g = state.sports.game;
      if (!spc || !g || (spc.kind !== 'game' && spc.kind !== 'montage' && spc.kind !== 'spring')) return;
      const seen = call('progress', 'setPieceSeen', state, spc.kind === 'spring' ? 'spring' : 'game') === true;
      if (spc.kind === 'game' && (num(spc.tick, 0) < PS.kickoffTick || !seen)) return;
      if (spc.kind === 'spring' && (num(spc.tick, 0) < hlTable(g).kickoff || !seen)) return;
      kickoff(state, g);
      if (g.decision) { const id = g.decision.id; call('ui', 'answerDecision', id, 'default'); if (g.decision) applyDecision(state, g, g.decision.def); }
      runSilent(state, g);
      finalize(state, g, true);
      busesOff(state, g);
      spc.tick = Math.max(num(spc.tick, 0), num(spc.len, PT.gameTicks) - 1);
    } catch (e) { BSU.error('sports', 'skipToFinal', e); }
  };
  /** PLAN_V2 P2: the prospect board {year, offeredDay, lockDay, daysLeft, maxPerSide, maxSignings, signed, signedSide{offense, defense}, open, answered, bonus, mean, list[{index, side, name, pos, hometown, rating, cost (per year), years, title, blurb, signed}], offense[], defense[]} or null outside the off-season */
  M.prospects = function (state) {
    try {
      if (!state || !state.sports) return null;
      const b = state.sports.prospects; if (!b || !Array.isArray(b.list)) return null;
      const per = int(PR.maxPerSideClass, 4), so = signedOn(b, 'offense'), sd = signedOn(b, 'defense'), lock = lockDayOf(state, b);
      const list = b.list.map(function (p, i) { return { index: i, side: unitSide(p.pos), name: p.name, pos: p.pos, hometown: p.hometown, rating: p.rating, cost: p.cost, years: int(p.years, PR.eligibilityYears), title: p.title, blurb: p.blurb, archetype: p.archetype, signed: !!p.signed }; });
      return { year: b.year, offeredDay: b.offeredDay, lockDay: lock, daysLeft: lock - today(state), maxPerSide: per, maxSignings: per * 2, signed: so + sd, signedSide: { offense: so, defense: sd }, open: so < per || sd < per, answered: !!b.answered, bonus: num(b.bonus, 0), mean: int(b.mean, 0),
        list: list, offense: list.filter(function (p) { return p.side === 'offense'; }), defense: list.filter(function (p) { return p.side === 'defense'; }) };
    } catch (e) { BSU.error('sports', 'prospects', e); return null; }
  };
  /** Sign prospect idx: up to maxPerSideClass per side per class, the first year's scholarship now (fund first); the player arrives at the Aug 5 lock → {ok, cost, name, pos, rating, side, signed, reason} */
  M.signProspect = function (state, idx) {
    try {
      const sp = state.sports, b = sp.prospects;
      if (!b || !Array.isArray(b.list)) return { ok: false, cost: 0, reason: 'No prospect board' };
      const p = b.list[int(idx, NONE)];
      if (!p) return { ok: false, cost: 0, reason: 'No such prospect' };
      if (p.signed) return { ok: false, cost: 0, reason: p.name + ' already signed' };
      const side = unitSide(p.pos), per = int(PR.maxPerSideClass, 4);
      if (signedOn(b, side) >= per) return { ok: false, cost: p.cost, reason: per + ' ' + side + ' signings already in this class' };
      const ca = canAffordAthletics(state, p.cost);   // P3: the athletics budget's headroom, then cash (the fund first)
      if (!ca.ok) return { ok: false, cost: p.cost, reason: ca.reason };
      if (!athleticsCharge(state, p.cost, 'coaching', { note: 'signing ' + p.name })) return { ok: false, cost: p.cost, reason: 'Cannot afford the signing' };
      p.signed = true; b.signed = signedOn(b, 'offense') + signedOn(b, 'defense');
      ticker(state, p.pos + ' ' + p.name + ' (' + p.hometown + ') signs with the ' + L.bsuNick + '. Rated ' + p.rating + ', ' + (BSU.formatMoney ? BSU.formatMoney(p.cost) : '$' + p.cost) + ' a year; arrives Aug 5.', {});
      refreshBudget(state, 'sign');
      return { ok: true, cost: p.cost, name: p.name, pos: p.pos, rating: p.rating, side: side, signed: { offense: signedOn(b, 'offense'), defense: signedOn(b, 'defense') }, reason: '' };
    } catch (e) { BSU.error('sports', 'signProspect', e); return { ok: false, cost: 0, reason: 'error' }; }
  };
  /** PLAN_V2 P2: the roster view {players[], offense[{pos, label, starter, backup, others[], count}], defense[], seniors[], emptyBackups[], walkOnStarters[], dinged[], scholarships, counts{Fr..Sr}, size, nextGrad, daysToGrad} */
  M.roster = function (state) {
    try { if (!state || !state.sports) return null; if (S !== state || !pv) { rebind(state); } ensureKeys(state); return rosterView(state); }
    catch (e) { BSU.error('sports', 'roster', e); return null; }
  };
  /** Pass on the board (it stays readable in the Season panel until Aug 5). */
  M.passProspects = function (state) { try { const b = state.sports.prospects; if (b) b.answered = true; return { ok: !!b }; } catch (e) { BSU.error('sports', 'passProspects', e); return { ok: false }; } };
  /** The Spring Game's calendar: {scheduledDay, daysUntil, playedYear, last} (pass C). */
  M.spring = function (state) {
    try {
      const sp = state.sports, d = int(sp.springDay, NONE);
      return { scheduledDay: d, daysUntil: d >= 0 ? d - today(state) : NONE, playedYear: int(sp.springYear, 0), last: sp.lastSpring || null, title: L.springTitle, window: PE.spring.windowDays };
    } catch (e) { BSU.error('sports', 'spring', e); return { scheduledDay: NONE, daysUntil: NONE, playedYear: 0, last: null }; }
  };
  /** Start the Spring Game now (the Season panel button / debug): needs a team and no running set piece → {ok, reason, len}. */
  M.startSpringGame = function (state) {
    try {
      if (S !== state || !pv) { rebind(state); ensureKeys(state); }
      if (!state.sports.hasTeam) return { ok: false, reason: 'No team: build a Practice Field' };
      return startSpring(state);
    } catch (e) { BSU.error('sports', 'startSpringGame', e); return { ok: false, reason: 'error' }; }
  };
  /** The idle practice drill for the renderer (pass F): {phase:'drill', frac, formation, players[11], ball, los} or null (no field / a game runs). */
  M.drill = function (state) { try { return drillState(state); } catch (e) { BSU.error('sports', 'drill', e); return null; } };
  /** PLAN_FOOTBALL §2.1 player controls (D46: functions only) */
  M.setPlaybook = function (state, style) { try { state.sports.playbook = (style === 'ground' || style === 'air') ? style : 'balanced'; } catch (e) { BSU.error('sports', 'setPlaybook', e); } };
  M.setAggression = function (state, level) { try { state.sports.aggression = (level === 'conservative' || level === 'aggressive') ? level : 'normal'; } catch (e) { BSU.error('sports', 'setAggression', e); } };
  M.setWatchFull = function (state, on) { try { state.sports.watchFull = !!on; } catch (e) { BSU.error('sports', 'setWatchFull', e); } };
  /** The renderer's view of the game in progress (pass F): 22 players, the ball, down & distance, the last play, a pending decision. */
  M.live = function (state) { try { return liveState(state); } catch (e) { BSU.error('sports', 'live', e); return { active: false }; } };
  /** The field core (down, dist, spot, poss, quarter, clock, lastPlay, drive, box) or null when no game runs. */
  M.playState = function (state) {
    try {
      const g = state.sports.game; if (!g) return null;
      return { down: g.down, dist: g.dist, spot: g.spot, poss: g.poss, quarter: g.quarter, clock: g.clock, phase: g.phase, over: !!g.over, ot: !!g.ot, score: g.score.slice(), lastPlay: g.lastPlay, drive: g.drive, box: g.box, timeouts: g.timeouts.slice(), decision: g.decision ? { id: g.decision.id, kind: g.decision.kind, options: g.decision.options, text: g.decision.text } : null, mode: g.mode };
    } catch (e) { BSU.error('sports', 'playState', e); return null; }
  };
  /** The last n plays of the running game (newest last). */
  M.recentPlays = function (state, n) { try { const g = state.sports.game; if (!g) return []; const k = Math.max(0, int(n, 8)); return g.plays.slice(Math.max(0, g.plays.length - k)); } catch (e) { BSU.error('sports', 'recentPlays', e); return []; } };
  /** The post-game summary of the running game (live totals) or of the last game played (state.sports.lastSummary). */
  M.summary = function (state) { try { const g = state.sports.game; if (g) return g.summary || buildSummary(state, g); return state.sports.lastSummary || null; } catch (e) { BSU.error('sports', 'summary', e); return null; } };
  M.setNight = function (state, on) { try { state.sports.nightToggle = !!on; refreshNights(state); } catch (e) { BSU.error('sports', 'setNight', e); } };
  M.setAutoSim = function (state, on) { try { state.sports.autoSim = !!on; } catch (e) { BSU.error('sports', 'setAutoSim', e); } };
  M.setPermits = function (state, v) { try { const ca = canAffordAthletics(state, 0); state.sports.permits = v === 'free' ? 'free' : 'paid'; return ca; } catch (e) { BSU.error('sports', 'setPermits', e); return { ok: false, reason: 'error' }; } };
  /** 0 | 50000 | 150000: charges the tier (boardCards) and adds the homecomingBudget happiness timer */
  M.setHomecomingBudget = function (state, v) {
    try {
      const tier = L.homecomingTiers.indexOf(num(v, 0));
      if (tier < 0) return { ok: false, reason: 'Unknown tier' };
      const cost = L.homecomingTiers[tier];
      const cur = int(state.sports.homecomingBudget, 0);
      const ca = canAffordAthletics(state, cost - cur);   // P3: the tier's step up against the athletics headroom (a lower tier costs nothing more)
      if (!ca.ok) return { ok: false, cost: cost, reason: ca.reason };
      if (cost > cur && !athleticsCharge(state, cost - cur, 'boardCards', { note: 'Homecoming budget' })) return { ok: false, cost: cost, reason: 'Cannot afford' };
      state.sports.homecomingBudget = cost;
      refreshBudget(state, 'homecoming');
      const hb = P.econ.boardCards.homecomingBudget;
      if (tier > 0) call('progress', 'addTimer', state, 'homecomingBudget', num(hb.happiness[tier], tier * 3), num(hb.days, 10));
      return { ok: true, cost: cost };
    } catch (e) { BSU.error('sports', 'setHomecomingBudget', e); return { ok: false, reason: 'error' }; }
  };
  /** PLAN_V2 P1: sign candidate idx for a role against the athletics budget (the fee plus the salary step up must fit the headroom; the fund pays first) */
  M.hireStaff = function (state, role, idx) {
    try {
      if (ROLES.indexOf(role) < 0) return { ok: false, cost: 0, reason: 'No such role' };
      const sp = state.sports, st = staffOf(state);
      const c = st.candidates[role][int(idx, -1)];
      if (!c) return { ok: false, cost: 0, reason: 'No such candidate' };
      if (!sp.hasTeam) return { ok: false, cost: 0, reason: 'No team yet' };
      const cur = recordOf(state, role), fee = hireFee(role, c.stars);
      const ca = canAffordAthletics(state, fee + Math.max(0, int(c.salary, 0) - (cur && cur.name ? int(cur.salary, 0) : 0)));
      if (!ca.ok) return { ok: false, cost: fee, reason: ca.reason };
      if (!athleticsCharge(state, fee, 'coaching', { note: 'signing ' + c.name })) return { ok: false, cost: fee, reason: 'Cannot afford the signing fee' };
      const rec = { name: c.name, role: role, stars: c.stars, style: c.style, salary: Math.max(0, int(c.salary, coachSalary(c.stars, role))), years: Math.max(1, int(c.years, int(PF.yearsMin, 2))), hiredYear: yearOf(state), quote: c.quote || roleQuote(role, c.name), rep: c.rep || roleRep(role, c.name), reach: !!c.reach, interim: false };
      if (role === 'hc') { sp.coach = rec; st.hc = rec; } else st[role] = rec;
      st.candidates[role].length = 0;
      delete st.offers[role];
      emit(EV.COACH_CHANGED, { role: role, name: rec.name, stars: rec.stars });
      storeRating(state);
      refreshBudget(state, 'hire');
      return { ok: true, cost: fee, reason: '', role: role, name: rec.name };
    } catch (e) { BSU.error('sports', 'hireStaff', e); return { ok: false, cost: 0, reason: 'error' }; }
  };
  /** the head-coach shorthand (the hire card, pass C callers) */
  M.hireCoach = function (state, idx) { return M.hireStaff(state, 'hc', idx); };
  /** PLAN_V2 P1: fire a role's coach — the buyout (50 % of the remaining contract; waived for the HC after three straight rivalry losses) against the headroom net of the salary it frees; an interim holds the clipboard; candidates draw if none are listed */
  M.fireStaff = function (state, role) {
    try {
      if (ROLES.indexOf(role) < 0) return { ok: false, cost: 0, reason: 'No such role' };
      const sp = state.sports, st = staffOf(state), c = recordOf(state, role);
      if (!sp.hasTeam || !c || !c.name) return { ok: false, cost: 0, reason: 'No coach' };
      if (c.interim) return { ok: false, cost: 0, reason: 'Interim staff cannot be fired: hire a replacement instead' };
      const cost = buyoutOf(state, role, c), interim = interimRecord(role, yearOf(state));
      if (cost > 0) {
        const ca = canAffordAthletics(state, cost - Math.max(0, int(c.salary, 0) - interim.salary));
        if (!ca.ok) return { ok: false, cost: cost, reason: ca.reason };
        if (!athleticsCharge(state, cost, 'coaching', { note: 'buyout ' + c.name })) return { ok: false, cost: cost, reason: 'Cannot afford the buyout' };
      }
      if (role === 'hc') { sp.coach = interim; st.hc = interim; } else st[role] = interim;
      delete st.offers[role];
      if (!st.candidates[role].length) drawCandidates(state, role);
      emit(EV.COACH_CHANGED, { role: role, name: interim.name, stars: interim.stars });
      storeRating(state);
      refreshBudget(state, 'fire');
      return { ok: true, cost: cost, role: role, name: c.name };
    } catch (e) { BSU.error('sports', 'fireStaff', e); return { ok: false, cost: 0, reason: 'error' }; }
  };
  M.fireCoach = function (state) { return M.fireStaff(state, 'hc'); };
  /** the Nov 8 raise offer: accept pays +25 % a year (against the headroom) and keeps the coach through the poaching roll; decline / unanswered leaves it to the dice */
  M.answerRaise = function (state, role, accept) {
    try {
      const st = staffOf(state), c = recordOf(state, role), o = st.offers[role], year = yearOf(state);
      if (!c || !c.name || !o || o.year !== year) return { ok: false, reason: 'No raise offer on the table' };
      if (o.answered) return { ok: false, reason: 'Already answered' };
      if (accept) {
        const ca = canAffordAthletics(state, o.raise);
        if (!ca.ok) return { ok: false, reason: ca.reason, raise: o.raise };
        c.salary = int(c.salary, 0) + o.raise; o.accepted = true;
        ticker(state, c.name + ' stays: ' + fmtMoney(c.salary) + ' a year.', {});
      } else ticker(state, c.name + ' turned down the raise talk. Expect calls in December.', {});
      o.answered = true;
      refreshBudget(state, 'raise');
      return { ok: true, accepted: !!accept, raise: o.raise, salary: c.salary };
    } catch (e) { BSU.error('sports', 'answerRaise', e); return { ok: false, reason: 'error' }; }
  };
  /** the player-facing staff view: records per role (with scheme, buyout, fit), candidates per role (with idx and fee), the prestige gate, this year's offers, the engine terms */
  M.staff = function (state) {
    try {
      const sp = state.sports, st = staffOf(state), e = state.economy || {}, year = yearOf(state);
      const prestige = num(e.prestige, 0), max = maxStarsFor(prestige), per = Math.max(1, num(PF.starsPerPrestige, 20));
      const view = { year: st.lastRefreshYear, prestige: prestige, maxStars: max, reachStars: Math.min(PS.starMax, max + int(PF.reachStars, 1)), nextPrestige: max >= PS.starMax ? 0 : Math.max(0, Math.ceil(max * per - prestige - 1e-9)),   // qa pass 4: whole points (prestige is a float; the hint printed 4.6484960003)
        perStar: per, reachSalary: num(PF.reachSalary, 1.6), buyoutShare: num(PF.buyoutShare, 0.5), raiseShare: num(PF.poach.raise, 0.25), terms: staffTerms(state), candidates: {}, offers: {}, hasTeam: !!sp.hasTeam };
      for (let i = 0; i < ROLES.length; i++) {
        const r = ROLES[i], c = recordOf(state, r), sty = styleOf(r, c);
        view[r] = c && c.name ? { name: c.name, role: r, stars: c.stars, style: sty, salary: int(c.salary, 0), years: int(c.years, 0), hiredYear: int(c.hiredYear, 0), quote: c.quote, rep: c.rep, reach: !!c.reach, interim: !!c.interim,
          buyout: buyoutOf(state, r, c), fit: r === 'oc' ? view.terms.ocFit : (r === 'hc' ? !!(sty && sty === sp.playbook) : false), poachable: qualifiesPoach(state, c) } : null;
        view.candidates[r] = st.candidates[r].map(function (cd, idx) { return { idx: idx, role: r, name: cd.name, stars: cd.stars, style: cd.style, salary: cd.salary, years: cd.years, reach: !!cd.reach, rep: cd.rep, quote: cd.quote, fee: hireFee(r, cd.stars), fit: r !== 'dc' && cd.style === sp.playbook }; });
        const o = st.offers[r]; view.offers[r] = o && o.year === year ? { year: o.year, answered: !!o.answered, accepted: !!o.accepted, raise: int(o.raise, 0) } : null;
      }
      return view;
    } catch (e) { BSU.error('sports', 'staff', e); return null; }
  };
  /** redraw the candidates (Dec 9 does this on its own; a role, or all three) */
  M.refreshCandidates = function (state, role) { try { return drawCandidates(state, ROLES.indexOf(role) >= 0 ? role : undefined); } catch (e) { BSU.error('sports', 'refreshCandidates', e); return null; } };
  /** economy's monthly staff charge: the three salaries / 12 while a team exists (fund first through drawFund, then cash) */
  M.staffSalaryMonthly = function (state) { try { return Math.round(staffSalaryYear(state) / Math.max(1, num(PT.monthsPerYear, 12))); } catch (e) { BSU.error('sports', 'staffSalaryMonthly', e); return 0; } };
  /** the recruiting card: accept pays the NIL price now (the building prices are checked next Aug 5) */
  M.answerRecruit = function (state, accept) {
    try {
      const rc = state.sports.recruit;
      if (!rc || rc.answered) return;
      rc.answered = true;
      if (!accept) { rc.accepted = false; return; }
      if (rc.price === L.recruitPrices[0]) {
        const ca = canAffordAthletics(state, L.recruitNil);   // P3
        if (!ca.ok) { rc.accepted = false; call('ui', 'notify', state, { text: ca.reason, kind: 'sports', ttl: 6000 }); return; }
        if (!athleticsCharge(state, L.recruitNil, 'coaching', { note: 'NIL fund' })) { rc.accepted = false; return; }
        rc.paid = true;
      }
      rc.accepted = true;
    } catch (e) { BSU.error('sports', 'answerRecruit', e); }
  };
  /** postpone a home entry (pending a makeup after storm:passed); idempotent */
  M.postpone = function (state, gameIndex) {
    try {
      const e = state.sports.schedule[gameIndex];
      if (!e || e.played || e.postponed) return;
      e.postponed = true;
      e.postponedTo = NONE;
      if (!Number.isFinite(e.origDay)) e.origDay = e.day;
      if (pv && pv.pending === gameIndex) pv.pending = NONE;
      if (pv && pv.awaiting === gameIndex) pv.awaiting = NONE;
      const st = stormNow(state);
      call('ui', 'notify', state, { text: oppName(e.opp) + ' postponed' + (st && st.name ? ' for ' + st.name : '') + '. Makeup within ' + L.makeupDays + ' days of the all-clear.', kind: 'sports' });
    } catch (e) { BSU.error('sports', 'postpone', e); }
  };
  /** move a postponed entry to `day`; within 5 days of its original date it becomes the Resilience Bowl (kind 'makeup') */
  M.scheduleMakeup = function (state, gameIndex, day) {
    try {
      const e = state.sports.schedule[gameIndex];
      if (!e || e.played || !Number.isFinite(day)) return;
      day = Math.round(day);
      if (day < today(state) || gameOnDay(state, day, gameIndex)) return;
      if (!Number.isFinite(e.origDay)) e.origDay = e.day;
      e.day = day;
      e.postponedTo = day;
      e.postponed = false;
      if (day - e.origDay <= L.makeupDays) { if (!e.origKind) e.origKind = e.kind; e.kind = 'makeup'; }
      e.night = nightFor(state, e);
      emit(EV.GAME_SCHEDULED, { day: e.day, opp: e.opp, home: e.home, kind: e.kind });
      if (day === today(state) && pv && !state.setPiece && !state.sports.game) pv.pending = gameIndex;
    } catch (e) { BSU.error('sports', 'scheduleMakeup', e); }
  };
  /** weather is the ONLY caller (its T−1 bands step, D51): opens the playThrough toast; the answer arrives as decision:closed */
  M.offerPlayThrough = function (state) {
    try {
      if (S !== state || !pv) { rebind(state); ensureKeys(state); }
      const day = today(state);
      if (pv.playThroughAnsweredDay === day || (pv.playThrough && pv.playThrough.day === day)) return;
      pv.playThrough = { day: day, tick: num(state.tick, 0), answered: false };
      const idx = todaysHomeIndex(state);
      if (idx >= 0) pv.awaiting = idx;
      call('ui', 'decision', state, { id: 'playThrough', text: 'Bands tonight. Play through it?', yes: 'Play Through It', no: 'Postpone', ticks: TOAST_TICKS });
    } catch (e) { BSU.error('sports', 'offerPlayThrough', e); }
  };
  /** progress / Objective 20: the scripted clear night (§10.4) — the entry on `day` is a night game and weather suppresses rain */
  M.startNightGameScript = function (state, day) {
    try {
      if (!Number.isFinite(day)) return;
      state.sports.scriptedNightDay = Math.round(day);
      call('weather', 'suppressRainOn', state, Math.round(day));
      refreshNights(state);
    } catch (e) { BSU.error('sports', 'startNightGameScript', e); }
  };
  // ---------------------------------------------------------------------------
  // Input guard: every public function that takes `state` answers a missing or
  // malformed root with its documented fallback, silently (no BSU.error — a
  // null root is a caller's boot-order quirk, not a sim error), so nothing
  // escapes and selfTests of other modules can probe us with garbage.
  // ---------------------------------------------------------------------------
  function validRoot(state) { return !!(state && typeof state === 'object' && state.sports && state.calendar); }
  const FALLBACKS = {
    season: function () { return null; }, rating: function () { return { rating: 0, terms: {} }; }, winProb: function () { return 0.5; },
    venueSeats: function () { return 0; }, attendance: function () { return 0; }, upcoming: function () { return null; },
    homeWinsThisSeason: function () { return 0; }, winPctLast4: function () { return L.neutralWinPct; },
    playHome: function () { return { ok: false, reason: 'No game state' }; }, simGame: function () { return null; },
    hireCoach: function () { return { ok: false, cost: 0, reason: 'No game state' }; }, fireCoach: function () { return { ok: false, cost: 0, reason: 'No game state' }; },
    hireStaff: function () { return { ok: false, cost: 0, reason: 'No game state' }; }, fireStaff: function () { return { ok: false, cost: 0, reason: 'No game state' }; }, answerRaise: function () { return { ok: false, reason: 'No game state' }; },
    staff: function () { return null; }, refreshCandidates: function () { return null; }, staffSalaryMonthly: function () { return 0; },
    setHomecomingBudget: function () { return { ok: false, reason: 'No game state' }; },
    halftime: function () {}, skipToFinal: function () {}, setNight: function () {}, setAutoSim: function () {}, setPermits: function () {},
    decide: function () { return { ok: false, reason: 'No game state' }; }, setPlaybook: function () {}, setAggression: function () {}, setWatchFull: function () {},
    live: function () { return { active: false }; }, playState: function () { return null; }, recentPlays: function () { return []; }, summary: function () { return null; },
    answerRecruit: function () {}, postpone: function () {}, scheduleMakeup: function () {}, offerPlayThrough: function () {}, startNightGameScript: function () {},
    budget: function () { return null; }, setTopUp: function () { return { ok: false, reason: 'No game state' }; }, canAfford: function () { return { ok: false, reason: 'No game state', headroom: 0, total: 0, committed: 0, amount: 0 }; }, drawFund: function () { return 0; }   // P3
  };
  for (const name in FALLBACKS) {
    (function (fnName, inner, fallback) {
      M[fnName] = function (state) { return validRoot(state) ? inner.apply(M, arguments) : fallback(); };
    })(name, M[name], FALLBACKS[name]);
  }

  // test hooks (underscore; pure over their arguments)
  M._computeRating = computeRating;
  M._drawStarters = function (state) { return drawStarters(state); };
  M._seniorsLeave = function (state) { return seniorsLeave(state); };
  M._graduate = function (state) { return graduate(state); };
  M._develop = function (state) { return develop(state); };
  M._ding = function (state, g) { return dingAfterGame(state, g || state.sports.game || { day: today(state) }); };
  M._drawBoard = function (state) { return drawProspects(state); };
  M._costPerYear = costPerYear;
  M._addPlayer = function (state, p) { return addPlayer(state, p); };
  M._probFor = probFor;
  M._venueInfo = venueInfo;
  // PLAN_V2 P1 hooks: force a raise offer / a poaching / the off-season staff step; the engine inputs and staff terms for a synthetic game
  M._offerRaise = function (state, role) { return offerRaises(state, role); };
  M._poach = function (state, role) { return poachCoach(state, role, 'forced'); };
  M._offseasonStaff = function (state) { return offseasonStaff(state); };
  M._staffTerms = function (state) { return staffTerms(state); };
  M._engineFor = function (state, g) { if (S !== state || !pv) { rebind(state); ensureKeys(state); } return engineFor(state, g); };
  M._liveProb = function (state, team, o) { const g = state && state.sports && state.sports.game; return g ? liveProb(g, team === undefined ? BSU_T : team, o) : 0.5; };
  /** Calibration hook: play one silent game with explicit ratings/venue (no finalize side effects). opts: {opp, oppRating, rating, home, night, kind, attendance, mode} → the game struct. */
  M._playGame = function (state, opts) {
    opts = opts || {};
    if (S !== state || !pv) { rebind(state); ensureKeys(state); }
    const sp = state.sports;
    if (Number.isFinite(opts.rating)) sp.rating = opts.rating;
    const opp = opts.opp || 'crescent';
    const e = makeEntry(today(state), opp, opts.home !== false, opts.kind || 'regular', 0, Number.isFinite(opts.oppRating) ? opts.oppRating : oppBaseRating(opp));
    if (opts.night !== undefined) sp.nightToggle = !!opts.night;
    const g = makeGame(state, e, NONE, opts.mode || 'silent');
    if (Number.isFinite(opts.attendance)) { g.attendance = opts.attendance; g.eng = engineFor(state, g); }
    if (opts.mode && opts.mode !== 'silent') return g;
    kickoff(state, g);
    runSilent(state, g);
    g.summary = buildSummary(state, g);
    return g;
  };

  // ---------------------------------------------------------------------------
  // selfTest (§10.6; the brief's §6 list) — private state, stubbed deps, recorded emits
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const A = function (c, m) { BSU.assert(c, 'sports: ' + m); };
    const saved = { emit: M._deps.emit, S: S, pv: pv, sim: R.state };
    const stubNames = ['buildings', 'economy', 'progress', 'weather', 'session', 'ui', 'agents', 'data'];
    const savedStubs = {};
    for (let i = 0; i < stubNames.length; i++) savedStubs[stubNames[i]] = M._deps[stubNames[i]];
    const log = [];
    const posts = [], bumps = [], timers = [], tickers = [], achieved = [], toasts = [];
    const bld = { field: { id: 0, type: 'practice_field', tx: 10, ty: 10, w: 4, h: 3, built: 1, tier: 1, hp: 1, ruin: false }, habitat: null, rec: null, greek: [], stadium: null };
    const buildings = {
      list: function (s, t) { const all = [bld.field, bld.habitat, bld.rec, bld.stadium].concat(bld.greek).filter(Boolean); return t ? all.filter(function (b) { return b.type === t; }) : all; },
      has: function (s, t, min) { return buildings.list(s, t).some(function (b) { return b.built >= 1 && !b.ruin && b.tier >= (min || 0); }); },
      count: function (s, t) { return buildings.list(s, t).length; },
      get: function (s, id) { return buildings.list(s).filter(function (b) { return b.id === id; })[0] || null; },
      effective: function () { return 1; }, stats: function () { return {}; },
      footprint: function (s, id) { const b = buildings.get(s, id); return b ? BSU.footprintTiles(b.tx, b.ty, b.w, b.h) : []; }
    };
    const economy = { post: function (s, k, a, m) { posts.push({ key: k, amount: a }); }, charge: function () { return true; }, canAfford: function () { return true; }, bump: function (s, st, d) { bumps.push({ stat: st, delta: d }); }, timerValue: function () { return 0; } };
    const progress = { timers: function () { return []; }, timer: function () { return null; }, addTimer: function (s, id, v, d) { timers.push({ id: id, value: v, days: d }); }, setPieceSeen: function () { return false; }, achieve: function (s, id) { achieved.push(id); }, earned: function () { return false; }, ticker: function (s, l) { tickers.push(l); } };
    const weather = { raining: function () { return false; }, storm: function (s) { return (s && s.storms) ? s.storms.current : null; }, scriptSky: function () {}, releaseSky: function () {}, suppressRainOn: function () {}, setPlayThrough: function () {}, heat: function () { return { index: 80, advisory: false, wave: false }; } };
    const session = { startSetPiece: function (s, k, o) { s.setPiece = { kind: k, tick: 0, len: o.len, skippable: !!o.skippable, choices: {}, speedBefore: 1, cameraTouched: false }; } };
    const ui = { decision: function (s, spec) { toasts.push(spec.id); }, answerDecision: function () {}, notify: function () {} };
    const agents = { gameDayBuses: function () {} };
    const mk = function (seed) {
      const s = BSU.newState(seed);
      s.economy.students = 690; s.economy.prestige = 16; s.economy.happiness = 62; s.economy.ticket = 35;
      rebind(s); ensureKeys(s);
      return s;
    };
    const tickDay = function (s, day) { s.calendar.day = day; M.tick(s, { newDay: true, newMonth: false, newYear: false, day: day }); };
    try {
      M._deps.emit = function (name, payload) { log.push({ name: name, payload: payload }); };
      M._deps.buildings = buildings; M._deps.economy = economy; M._deps.progress = progress; M._deps.weather = weather;
      M._deps.session = session; M._deps.ui = ui; M._deps.agents = agents;

      // 12. no accessor
      A(typeof M.game === 'undefined', 'no BSU.sports.game accessor (D46)');

      // 1. winProb
      {
        const s = mk(8); s.sports.hasTeam = true; s.sports.venue = 'stadium2'; s.sports.rating = 78;
        const pn = M.winProb(s, 78, true, true), pd = M.winProb(s, 78, false, true), pa = M.winProb(s, 78, false, false);
        A(Math.abs(pn - 0.7834) < 0.01, 'winProb 78 vs 78 home night ≈ .78 (' + pn.toFixed(4) + ')');
        A(Math.abs(pd - 0.6355) < 0.01, 'winProb 78 vs 78 home day ≈ .64 (' + pd.toFixed(4) + ')');
        A(Math.abs(pa - 0.5) < 1e-9, 'away: homeAdv 0');
        s.sports.rating = 50;
        const pu = M.winProb(s, 78, false, true);
        A(Math.abs(pu - 0.1165) < 0.01, 'winProb 50 vs 78 home day ≈ .12 (' + pu.toFixed(4) + ')');
        A(M.probWord(pu) === 'Underdog' && M.probWord(pd) === 'Even' && M.probWord(pn) === 'Favored', 'probability words');
        A(M.winProb(s, 'magnolia', false, true) > 0 && M.winProb(s, 'magnolia', false, true) < 1, 'winProb by key bounded');
        notes.push('winProb night ' + pn.toFixed(3) + ' day ' + pd.toFixed(3));
      }

      // 2. the drive/play engine: field invariants, no ties, plays per game, the win share tracks the rating gap
      {
        const s = mk(8); s.sports.hasTeam = true; s.sports.venue = 'bayou_field'; s.sports.coach = { name: 'Bobby Cheramie', stars: 2, hiredYear: 1, quote: '', rep: '' };
        s.sports.starters = POS.map(function (p) { return { name: 'A ' + p, pos: p, hometown: 'Houma', rating: 75, class: 'Jr' }; });
        R.state = 12345;
        let wins = 0, plays = 0, pts = 0, winsUp = 0;
        const N = 16;
        const scan = function (v) { if (typeof v === 'number') return Number.isFinite(v); if (v && typeof v === 'object') { for (const k in v) if (!scan(v[k])) return false; } return true; };
        for (let k = 0; k < N; k++) {
          const g = M._playGame(s, { opp: 'crescent', oppRating: 60, rating: 60, home: false });
          A(g.over && g.score[0] !== g.score[1], 'the engine finishes without a tie');
          A(g.plays.length >= 90 && g.plays.length <= 220, 'plays per game plausible (' + g.plays.length + ')');
          A(g.plays.every(function (e) { return e.spot >= 0 && e.spot <= 100 && e.down >= 1 && e.down <= 4 && e.dist >= 1 && e.q >= 1 && typeof e.text === 'string' && e.text.length > 0; }), 'every play has a legal spot/down/distance and text');
          A(scan(g), 'no NaN in the game struct');
          A(g.box[0].rushYds + g.box[0].passYds > 0 && g.drives.length >= 8 && g.summary && g.summary.mvp && g.summary.topText.length === 2, 'box score, drives, summary and MVP');
          if (g.score[0] > g.score[1]) wins++; plays += g.plays.length; pts += g.score[0] + g.score[1];
          const g2 = M._playGame(s, { opp: 'crescent', oppRating: 55, rating: 80, home: false });
          if (g2.score[0] > g2.score[1]) winsUp++;
        }
        A(winsUp >= N * 0.7, 'a +25 rating gap wins most games (' + winsUp + '/' + N + ')');
        A(pts / N >= 20 && pts / N <= 90, 'total points per game plausible (' + (pts / N).toFixed(1) + ')');
        notes.push('engine share ' + (wins / N).toFixed(2) + ', plays ' + Math.round(plays / N) + ', pts ' + (pts / N).toFixed(0));
      }

      // 3. rating
      {
        const s = mk(3); s.calendar.day = BSU.dateToDay('Mar 5', 1);
        s.sports.hasTeam = true; s.economy.coaching = 1000000; s.economy.prestige = 40; s.economy.happiness = 70;
        s.sports.coach = { name: 'Bobby Cheramie', stars: 2, hiredYear: 1, quote: '', rep: '' };
        s.sports.starters = [{ name: 'a', pos: 'QB', hometown: 'Houma', rating: 75 }, { name: 'b', pos: 'RB', hometown: 'Houma', rating: 75 }, { name: 'c', pos: 'LB', hometown: 'Houma', rating: 75 }];
        const r = M.rating(s);
        A(Math.abs(r.rating - 52) < 1e-9, 'rating 52 (' + r.rating + ')');
        let sum = 0; for (const k in r.terms) sum += r.terms[k];
        A(Math.abs(sum - r.rating) < 1e-9, 'terms sum to the rating');
        s.economy.coaching = 3000000;
        A(M.rating(s).terms.coaching === 30, 'coaching cap 30 at $3M');
        s.sports.starters.forEach(function (x) { x.rating = 99; }); A(Math.abs(M.rating(s).terms.starters - 4.8) < 1e-9, 'starters mean 99 → +4.8 (within the +5 clamp)');
        s.sports.starters.forEach(function (x) { x.rating = 99; }); s.sports.starters.push({ name: 'd', pos: 'WR', hometown: 'Houma', rating: 200 });
        A(M.rating(s).terms.starters === 5, 'starters clamp +5'); s.sports.starters.pop();
        s.sports.starters.forEach(function (x) { x.rating = 60; }); A(M.rating(s).terms.starters === -3, 'starters clamp −3');
        s.calendar.day = BSU.dateToDay('Aug 5', 1);
        A(M.rating(s).terms.heat === -PS.heatPenalty, 'Aug heat term −8 without a Rec Center');
        bld.rec = { id: 5, type: 'rec_center', tx: 15, ty: 12, w: 3, h: 3, built: 1, tier: 0, hp: 1, ruin: false };
        A(M.rating(s).terms.heat === 0, 'Rec Center within 10 lifts the heat term');
        bld.rec = null;
        s.sports.hasTeam = false; A(M.rating(s).rating === 0, 'no team → 0');
      }

      // 4. attendance
      {
        const s = mk(4); s.sports.hasTeam = true; s.sports.venue = 'bayou_field'; s.sports.record.last4 = [true, false];
        const att = M.attendance(s, { opp: 'delta', night: false, kind: 'regular', home: true });
        A(att === 5872, 'attendance 5872 (' + att + ')');
        A(att * (35 + CONCESSIONS) === 275984, 'revenue 275,984');
        s.sports.permits = 'paid';
        A(tailgateFor(s, att) === 3 * att, 'tailgate $3 × attendance with no Greek Row');
        s.sports.permits = 'free'; A(tailgateFor(s, att) === 0, 'free permits → $0 tailgate'); s.sports.permits = 'paid';
        s.economy.ticket = 25; A(M.attendance(s, { opp: 'delta', night: false, kind: 'regular', home: true }) === 6000, '$25 tier sells out Bayou Field');
      }

      // 5. schedule build (Aug 5)
      {
        const s = mk(5);
        s.calendar.day = BSU.dateToDay('Aug 4', 1); M.tick(s, { newDay: true, day: s.calendar.day });
        A(s.sports.hasTeam && s.sports.venue === 'bayou_field' && s.sports.coach.name === 'Bobby Cheramie' && s.sports.coach.stars === 2, 'first field → Coach Cheramie 2★');
        A(s.sports.starters.length === 8 && s.sports.starters.map(function (x) { return x.pos; }).join() === POS.join(), 'eight starters in slot order on the first team day');
        tickDay(s, BSU.dateToDay('Aug 5', 1));
        const sc = s.sports.schedule;
        A(sc.length === 7, '7 entries built on Aug 5 (bowl added Dec 8)');
        const riv = sc.filter(function (e) { return e.kind === 'rivalry'; })[0];
        A(riv && riv.opp === 'magnolia' && riv.home && riv.day === BSU.dateToDay('Nov 8', 1), 'Magnolia on Nov 8 at home');
        A(new Set(sc.map(function (e) { return e.opp; })).size === 7, '7 distinct opponents');
        for (let i = 1; i < sc.length; i++) A(sc[i].day > sc[i - 1].day, 'dates strictly increasing');
        A(sc.every(function (e) { return e.night === false; }), 'no night games at Bayou Field');
        A(sc.every(function (e) { return Number.isFinite(e.oppRating) && Math.abs(e.oppRating - oppBaseRating(e.opp)) <= PS.oppNoise; }), 'opponent noise within ±8');
        A(log.filter(function (x) { return x.name === EV.GAME_SCHEDULED; }).length === 7, 'game:scheduled per entry');
        A(sc.filter(function (e) { return e.home; }).length === 4, '4 home games');
        // a full season: 4 home set pieces resolve through the timeline, away games off-screen, Dec 8 ends it
        let homes = 0, finals = 0;
        for (let day = BSU.dateToDay('Aug 6', 1); day <= BSU.dateToDay('Dec 9', 1); day++) {
          tickDay(s, day);
          for (let t = 0; t < 1000 && s.setPiece; t++) {
            M.tick(s, { newDay: false, day: day });
            if (s.setPiece && ++s.setPiece.tick >= s.setPiece.len) { const k = s.setPiece.kind; s.setPiece = null; onSetPieceEnd({ kind: k, len: 0 }); homes++; }
            s.tick++;
          }
        }
        finals = log.filter(function (x) { return x.name === EV.GAME_FINAL; }).length;
        const ls = s.sports.lastSeason;
        A(homes === 4, '4 home set pieces (' + homes + ')');
        A(ls.wins + ls.losses >= 7 && ls.wins + ls.losses <= 8, 'season record valid (' + ls.wins + '-' + ls.losses + ')');
        A(finals === ls.wins + ls.losses, 'one game:final per game');
        A(s.sports.seasonDone && s.sports.record.wins === 0 && log.some(function (x) { return x.name === EV.SEASON_END; }), 'season:end on Dec 8');
        A(s.sports.schedule.every(function (e) { return e.played && (e.result === null || (Number.isInteger(e.result.home) && Number.isInteger(e.result.away))); }), 'every entry played with integer results');
        A(toasts.filter(function (x) { return x === 'halftime'; }).length === 4, 'one halftime toast per home game');
        A(posts.filter(function (x) { return x.key === 'athletics'; }).length >= 4, 'athletics revenue posted per home game');
        A(s.sports.candidates.length === 3, 'Dec 9 draws 3 candidates');
        notes.push('season ' + ls.wins + '-' + ls.losses + (ls.bowlWon ? ' bowl W' : ''));
      }

      // 6. halftime decision: open it up / pound the rock / stay (through the pending decision)
      {
        const s = mk(6); s.sports.hasTeam = true; s.sports.venue = 'bayou_field'; s.sports.rating = 60;
        s.sports.schedule = [makeEntry(s.calendar.day, 'crescent', true, 'regular', 0, 70.4)];
        s.setPiece = { kind: 'game', tick: 400, len: 750, skippable: false, choices: {}, speedBefore: 1, cameraTouched: false };
        const mkHalf = function () { const g = makeGame(s, s.sports.schedule[0], 0, 'highlights'); g.len0 = 750; kickoff(s, g); g.quarter = 2; g.clock = 0; g.phase = 'half'; g.score = [7, 13]; syncPts(g); s.sports.game = g; S = s; return g; };
        const g = mkHalf();
        A(step(s, g) === null && g.decision && g.decision.kind === 'halftime' && g.decision.options.length === 3 && g.halftimeOpenedTick === 400, 'the half opens the halftime decision with three options');
        A(/Down 7–13/.test(g.decision.text) && /Open it up/.test(g.decision.text) && toasts[toasts.length - 1] === 'halftime', 'toast text and the ui.decision call');
        M.decide(s, 'open');
        A(g.halftimeAnswered && g.wentForIt && g.halftimeChoice === 'open' && g.adj.runShare < 0 && g.adj.big > 1 && g.adj.to > 1 && !g.decision, 'open it up: pass share up, big plays and turnovers up');
        const g2 = mkHalf(); step(s, g2); M.decide(s, 'no');
        A(g2.halftimeChoice === 'pound' && g2.adj.runShare > 0 && g2.adj.clockAdd > 0 && !g2.wentForIt, 'no → pound the rock');
        const g3 = mkHalf(); step(s, g3); M.decide(s, 'default'); const ko = step(s, g3);
        A(g3.halftimeChoice === 'stay' && g3.adj.runShare === 0 && ko && ko.type === 'kickoff' && g3.quarter === 3 && g3.phase === 'play' && g3.kickTeam === g3.openingReceiver, 'default → stay the course; the opening receiver kicks off the second half');
        s.sports.game = null; s.setPiece = null;
      }

      // 7. stat lines
      A(lineText('QB', { att: 30, comp: 20, yds: 250, td: 2, int: 1 }) === '20/30, 250 yds, 2 TD, 1 INT', 'QB stat line');
      A(lineText('LB', { tackles: 11 }) === '11 tackles', 'LB stat line');

      // 8. starters (eight positions, migration from three)
      {
        const s = mk(9); s.sports.coach = { name: 'x', stars: 2, hiredYear: 1, quote: '', rep: '' };
        const st = drawStarters(s);
        A(st.length === 8 && st.map(function (x) { return x.pos; }).join() === POS.join(), 'positions QB RB WR OL DL LB DB K');
        A(st.every(function (x) { return x.rating >= 60 && x.rating <= 99 && typeof x.name === 'string' && x.name.length > 2 && typeof x.hometown === 'string' && typeof x.class === 'string'; }), 'ratings 60–99, names, hometowns, classes');
        s.sports.starters = st;
        const n = seniorsLeave(s);
        A(n >= 0 && n <= 8 && s.sports.starters.length === 8, 'May 5 redraw replaces 0–8');
        s.sports.hasTeam = true; s.sports.starters = [st[0], st[1], st[5]]; ensureKeys(s);
        A(s.sports.starters.length === 8 && s.sports.starters[0] === st[0] && s.sports.starters[1] === st[1] && s.sports.starters[5] === st[5] && s.sports.starters.map(function (x) { return x.pos; }).join() === POS.join(), 'a 3-starter save migrates to 8 with the originals intact');
      }

      // 9. bowl eligibility
      {
        const mkSeason = function (wins) {
          const s = mk(10 + wins);
          s.calendar.day = BSU.dateToDay('Aug 4', 1); M.tick(s, { newDay: true, day: s.calendar.day });
          tickDay(s, BSU.dateToDay('Aug 5', 1));
          s.sports.schedule.forEach(function (e) { e.played = true; e.result = { home: 0, away: 0, won: false }; });
          s.sports.record.wins = wins; s.sports.record.losses = 7 - wins;
          tickDay(s, BSU.dateToDay('Dec 8', 1));
          return s;
        };
        const s5 = mkSeason(5), s4 = mkSeason(4);
        A(s5.sports.schedule.some(function (e) { return e.kind === 'bowl' && e.played; }) && s5.sports.seasonDone, 'wins 5 → bowl entry played on Dec 8');
        A(!s4.sports.schedule.some(function (e) { return e.kind === 'bowl'; }) && s4.sports.seasonDone, 'wins 4 → no bowl');
        A(s5.sports.lastSeason.wins >= 5 && posts.some(function (p) { return p.key === 'athletics' && (p.amount === PS.bowlWin || p.amount === PS.bowlLose); }), 'bowl purse posted');
      }

      // 10. rivalry loss streak and the buyout waiver
      {
        const s = mk(11); s.sports.hasTeam = true; s.sports.venue = 'bayou_field'; s.sports.rating = 0;
        s.sports.coach = { name: 'Bobby Cheramie', stars: 2, hiredYear: 1, quote: '', rep: '' };
        for (let k = 0; k < 3; k++) { s.sports.schedule.push(makeEntry(s.calendar.day, 'magnolia', true, 'rivalry', 6, 86)); M.simGame(s, s.sports.schedule.length - 1); }
        A(s.sports.rivalryLossStreak === 3, 'three rivalry losses → streak 3 (' + s.sports.rivalryLossStreak + ')');
        A(s.sports.candidates.length === 3, 'the hire card is ready');
        const f = M.fireCoach(s);
        A(f.ok && f.cost === 0, 'fireCoach cost 0 after the streak');
        s.sports.rivalryLossStreak = 0; s.sports.coach = { name: 'Bobby Cheramie', stars: 2, hiredYear: 1, quote: '', rep: '' };
        A(M.fireCoach(s).cost === Math.round(600000 * 2 * PF.buyoutShare), 'buyout = 50% of the remaining contract otherwise (2★ at $600k × 2 years → $600k)');
        A(tickers.indexOf(42) >= 0 && tickers.indexOf(44) >= 0, 'ticker lines 42/44 on the losses');
      }

      // 11. decision idempotence through decision:closed; the tick timeout; the highlights timeline
      {
        const s = mk(12); s.sports.hasTeam = true; s.sports.venue = 'bayou_field'; s.sports.rating = 60;
        s.sports.coach = { name: 'Bobby Cheramie', stars: 2, hiredYear: 1, quote: '', rep: '' };
        s.sports.schedule = [makeEntry(s.calendar.day, 'delta', true, 'regular', 0, 62)];
        s.setPiece = { kind: 'game', tick: 400, len: 750, skippable: false, choices: {}, speedBefore: 1, cameraTouched: false };
        const g = makeGame(s, s.sports.schedule[0], 0, 'highlights'); g.len0 = 750; kickoff(s, g); g.quarter = 2; g.clock = 0; g.phase = 'half';
        s.sports.game = g; S = s;
        step(s, g);
        const before61 = tickers.filter(function (x) { return x === 61; }).length;
        const r0 = R.state;
        onDecision({ id: 'halftime', answer: 'yes' });
        const r1 = R.state;
        onDecision({ id: 'halftime', answer: 'yes' });
        A(r1 === r0 && R.state === r1, 'the halftime answer draws nothing (the engine draws per play)');
        A(g.halftimeAnswered === true && g.halftimeChoice === 'open' && tickers.filter(function (x) { return x === 61; }).length === before61 + 1, 'ticker 61 once; halftimeAnswered');
        // the tick-based timeline: the halftime toast opens at the end of Q2 (set-piece tick 376–400), times out 80 ticks later, the final at game-time 600
        const g3 = makeGame(s, s.sports.schedule[0], 0, 'highlights'); g3.len0 = 750; s.sports.game = g3;
        let openedAt = -1, answeredAt = -1, plays = 0, pausedBefore = 0;
        for (let t = 0; t <= 760 && !g3.finalized; t++) { s.setPiece.tick = t; M.tick(s, { newDay: false, day: s.calendar.day }); if (openedAt < 0 && g3.halftimeOpenedTick >= 0) { openedAt = g3.halftimeOpenedTick; pausedBefore = g3.tOff; } if (answeredAt < 0 && g3.halftimeAnswered) answeredAt = t; }
        plays = g3.plays.length;
        // in game time (set-piece tick minus the ticks a first-half 4th-down toast paused): the stream depends on the shared rng, so the pause is not fixed
        A(openedAt - pausedBefore >= 370 && openedAt - pausedBefore <= 400, 'halftime opens at the end of Q2 (' + openedAt + ', paused ' + pausedBefore + ')');
        // the toast length is capped by what is left of pauseCap after earlier 4th-down pauses (openDecision)
        A(answeredAt === openedAt + Math.min(PE.decision.halftimeTicks, PE.decision.pauseCap - pausedBefore), 'the timeout answers 80 ticks later, less any pauseCap already spent (opened ' + openedAt + ', answered ' + answeredAt + ', paused before ' + pausedBefore + ')');
        A(g3.finalized && g3.over && g3.tOff >= PE.decision.halftimeTicks - 1 && s.setPiece.len === 750 + g3.tOff && g3.tOff <= PE.decision.pauseCap, 'the set piece stretched by the paused ticks (' + g3.tOff + ')');
        A(plays >= 90 && g3.plays.filter(function (e) { return e.key; }).length >= 10 && g3.score[0] !== g3.score[1], 'the highlights game played every play (' + plays + ') with key plays animated');
        A(log.some(function (x) { return x.name === EV.GAME_KICKOFF; }) && log.some(function (x) { return x.name === EV.GAME_HALFTIME; }) && log.some(function (x) { return x.name === EV.GAME_PLAY; }) && log.some(function (x) { return x.name === EV.GAME_DRIVE; }) && log.some(function (x) { return x.name === EV.GAME_DECISION; }), 'kickoff, halftime, play, drive and decision events');
        s.sports.game = null; s.setPiece = null;
      }

      // Play Through It: offer → default → postpone; offer → yes → the game starts
      {
        const s = mk(13);
        s.calendar.day = BSU.dateToDay('Aug 4', 1); M.tick(s, { newDay: true, day: s.calendar.day });
        tickDay(s, BSU.dateToDay('Aug 5', 1));
        const opener = findEntry(s, function (e) { return e.home; });
        const day = s.sports.schedule[opener].day;
        s.storms.current = { name: 'Test', cat: 1, forecastCat: 1, nearMiss: false, phase: STORM.BANDS, landfallDay: day + 1 };
        s.calendar.day = day;
        M.offerPlayThrough(s);
        A(toasts.indexOf('playThrough') >= 0, 'playThrough toast opened');
        M.tick(s, { newDay: true, day: day });
        A(!s.sports.game && !s.sports.schedule[opener].postponed, 'the game waits for the answer');
        for (let t = 0; t <= TOAST_TICKS; t++) { s.tick++; M.tick(s, { newDay: false, day: day }); }
        A(s.sports.schedule[opener].postponed && s.sports.schedule[opener].postponedTo === -1, 'default → postponed');
        s.storms.current = null;
        tickDay(s, day + 1);
        const e = s.sports.schedule[opener];
        A(!e.postponed && e.postponedTo === day + 2 && e.kind === 'makeup' && e.day === day + 2, 'makeup on the first free day → Resilience Bowl');
        // yes path on the makeup day with another storm
        s.storms.current = { name: 'Test2', cat: 1, forecastCat: 1, nearMiss: false, phase: STORM.BANDS, landfallDay: day + 3 };
        s.calendar.day = day + 2;
        M.offerPlayThrough(s);
        M.tick(s, { newDay: true, day: day + 2 });
        onDecision({ id: 'playThrough', answer: 'yes' });
        M.tick(s, { newDay: false, day: day + 2 });
        A(s.sports.game && s.sports.game.playThrough === true && s.setPiece && s.setPiece.kind === 'game', 'yes → the game runs inside the bands');
        A(timers.some(function (t) { return t.id === 'playThroughIt'; }) && tickers.indexOf(46) >= 0, 'playThroughIt timer + ticker 46');
        s.sports.game = null; s.setPiece = null; s.storms.current = null;
      }

      // skipToFinal + montage + club schedule
      {
        const s = mk(14); s.sports.hasTeam = true; s.sports.venue = 'bayou_field'; s.sports.rating = 60;
        s.sports.schedule = [makeEntry(s.calendar.day, 'delta', true, 'regular', 0, 62)];
        s.sports.game = makeGame(s, s.sports.schedule[0], 0);
        s.setPiece = { kind: 'game', tick: 250, len: 750, skippable: true, choices: {}, speedBefore: 1, cameraTouched: false };
        M._deps.progress = Object.assign({}, progress, { setPieceSeen: function () { return true; } });
        M.skipToFinal(s);
        A(s.setPiece.tick === 749 && s.sports.game.finalized && s.sports.schedule[0].played, 'skipToFinal jumps to 749 with the entry played');
        s.sports.game = null; s.setPiece = null;
        s.sports.autoSim = true;
        s.sports.schedule.push(makeEntry(s.calendar.day, 'sabine', true, 'regular', 2, 45));
        const st = startHome(s, 1);
        A(st.ok && s.setPiece.kind === 'montage' && s.setPiece.len === PS.autoSimTicks, 'auto-sim + seen → montage');
        for (let t = 0; t < 50; t++) { s.setPiece.tick = t; M.tick(s, { newDay: false, day: s.calendar.day }); }
        A(s.sports.game.finalized && s.sports.schedule[1].played, 'montage resolves by tick 45');
        s.sports.game = null; s.setPiece = null;
        M._deps.progress = progress;
        // club-only: no venue → away club schedule, $20k each
        const c = mk(15); bld.field.tier = 0;
        c.calendar.day = BSU.dateToDay('Aug 4', 1); M.tick(c, { newDay: true, day: c.calendar.day });
        A(c.sports.hasTeam && c.sports.venue === 'none' && c.sports.clubOnly === true, 'club only without seating');
        tickDay(c, BSU.dateToDay('Aug 5', 1));
        A(c.sports.schedule.length === 7 && c.sports.schedule.every(function (e) { return e.kind === 'club' && !e.home; }), 'club schedule: every game away');
        const before = posts.length;
        tickDay(c, c.sports.schedule[0].day);
        A(c.sports.schedule[0].played && posts.length === before + 1 && posts[before].key === 'athletics' && posts[before].amount === PS.clubPay, 'club game pays $20k');
        bld.field.tier = 1;
        // Bayou Field completing mid-season restores the home dates
        pv.venueDirty = true; M.tick(c, { newDay: false, day: c.calendar.day });
        A(c.sports.venue === 'bayou_field' && c.sports.schedule.filter(function (e) { return e.home && !e.played; }).length === 3 && c.sports.schedule.every(function (e) { return e.played || e.kind !== 'club'; }), 'venue mid-season → the 3 remaining home dates restored');
      }

      // hire / recruit / night script / no-team quiet
      {
        const s = mk(16); s.sports.hasTeam = true; s.sports.venue = 'stadium2';
        s.sports.coach = { name: 'Bobby Cheramie', stars: 2, hiredYear: 1, quote: '', rep: '' };
        drawCandidates(s);
        const c0 = s.sports.candidates[0];
        s.economy.coaching = 3000000; s.economy.cash = 1e7;
        A(!M.hireCoach(s, 0).ok, 'hire refused over the athletics budget (a $3M coaching spend eats the headroom)');
        s.economy.coaching = 0;
        M.setTopUp(s, PB.topUpMax);   // P3: a 3★ hire needs the headroom the max top-up gives (the fee plus the salary step)
        const h = M.hireCoach(s, 0);
        A(h.ok && h.cost === PS.coachFee * c0.stars && s.sports.coach.name === c0.name && log.some(function (x) { return x.name === EV.COACH_CHANGED; }), 'hire signs the candidate');
        s.sports.schedule = [makeEntry(BSU.dateToDay('Sep 8', 1), 'delta', true, 'regular', 2, 62)];
        bld.stadium = { id: 7, type: 'stadium', tx: 20, ty: 20, w: 6, h: 5, built: 1, tier: 2, hp: 1, ruin: false };
        A(nightFor(s, s.sports.schedule[0]) === false, 'a regular game is a day game while the toggle is off');
        M.startNightGameScript(s, BSU.dateToDay('Sep 8', 1));
        A(s.sports.scriptedNightDay === BSU.dateToDay('Sep 8', 1) && s.sports.schedule[0].night === true, 'scripted night game forces night');
        s.sports.setNightDummy = undefined; delete s.sports.setNightDummy;
        M.setNight(s, false); A(s.sports.schedule[0].night === true, 'the scripted night survives the toggle');
        s.sports.schedule[0].kind = 'homecoming'; A(nightFor(s, s.sports.schedule[0]), 'homecoming is a night game at Stadium II');
        drawRecruit(s); A(s.sports.recruit && L.recruitPrices.indexOf(s.sports.recruit.price) >= 0, 'recruit card drawn');
        s.sports.recruit.price = L.recruitPrices[2]; M.answerRecruit(s, true); bld.rec = { id: 5, type: 'rec_center', tx: 40, ty: 40, w: 3, h: 3, built: 1, tier: 0, hp: 1, ruin: false };
        s.sports.starters = drawStarters(s); applyRecruit(s);
        A(s.sports.starters.some(function (x) { return x.rating === PS.recruitRating; }) && s.sports.recruit === null, 'accepted recruit becomes a 95 next Aug 5');
        bld.stadium = null; bld.rec = null;
        // no team: nothing fires
        const q = mk(17); bld.field.built = 0;
        const n0 = log.length;
        for (let d = 0; d < 130; d++) tickDay(q, d);
        A(q.sports.schedule.length === 0 && q.sports.rating === 0 && log.length === n0, 'no team: empty schedule, rating 0, no events');
        bld.field.built = 1;
        // robustness: garbage arguments never throw
        M.winProb(null, 'x', 1, 1); M.attendance(null); M.simGame(q, 99); M.postpone(q, -3); M.scheduleMakeup(q, 0, NaN); M.halftime(q, true); M.skipToFinal(q); M.hireCoach(q, 4);
        A(true, 'robust to bad arguments');
      }
      // determinism: two identical seasons draw identical results
      {
        const runSeason = function () {
          const s = mk(21); R.state = 777;
          s.calendar.day = BSU.dateToDay('Aug 4', 1); M.tick(s, { newDay: true, day: s.calendar.day });
          for (let day = BSU.dateToDay('Aug 5', 1); day <= BSU.dateToDay('Dec 8', 1); day++) {
            tickDay(s, day);
            for (let t = 0; t < 1000 && s.setPiece; t++) { M.tick(s, { newDay: false, day: day }); if (s.setPiece && ++s.setPiece.tick >= s.setPiece.len) { const k = s.setPiece.kind; s.setPiece = null; onSetPieceEnd({ kind: k, len: 0 }); } s.tick++; }
          }
          return JSON.stringify(s.sports.schedule.map(function (e) { return [e.opp, e.result]; })) + s.sports.lastSeason.wins;
        };
        A(runSeason() === runSeason(), 'deterministic season for a fixed rng state');
      }
      // finite scan of a played season's branch
      {
        const scan = function (v, path) {
          if (typeof v === 'number') return Number.isFinite(v) ? null : path;
          if (v && typeof v === 'object') { for (const k in v) { const r = scan(v[k], path + '.' + k); if (r) return r; } }
          return null;
        };
        const s = mk(22); s.calendar.day = BSU.dateToDay('Aug 4', 1); M.tick(s, { newDay: true, day: s.calendar.day });
        for (let day = BSU.dateToDay('Aug 5', 1); day <= BSU.dateToDay('Dec 9', 1); day++) { tickDay(s, day); for (let t = 0; t < 1000 && s.setPiece; t++) { M.tick(s, { newDay: false, day: day }); if (s.setPiece && ++s.setPiece.tick >= s.setPiece.len) { s.setPiece = null; onSetPieceEnd({ kind: 'game', len: 0 }); } } }
        const bad = scan(s.sports, 'sports');
        A(!bad, 'no NaN/Infinity in state.sports (' + bad + ')');
      }
      return { ok: true, notes: notes.join('; ') };
    } catch (e) {
      return { ok: false, notes: (e && e.message) ? e.message : String(e) };
    } finally {
      M._deps.emit = saved.emit;
      for (let i = 0; i < stubNames.length; i++) { if (savedStubs[stubNames[i]] === undefined) delete M._deps[stubNames[i]]; else M._deps[stubNames[i]] = savedStubs[stubNames[i]]; }
      S = saved.S; pv = saved.pv; R.state = saved.sim;
    }
  };
})();
