'use strict';
// ============================================================================
// BAYOU STATE — sports.js (module 9) → BSU.sports
// Owner of: state.sports (hasTeam, venue, the season schedule, record, coach,
//           candidates, starters, recruit, rating + terms, the player toggles,
//           rivalry streak, the in-progress game struct, the first-game days,
//           the scripted night day) plus the lazily-initialized saved keys
//           listed in docs/INTEGRATION_NOTES.md (clubOnly, homeWins,
//           losingSeasons, seasonDone).
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
    bowlOppFallback: 'crescent'               // the bowl opponent when every opponent was on the schedule (never with 7 of 9)
  });
  const TOAST_TICKS = PT.toastTicks;          // 80
  const CONCESSIONS = (P.econ && typeof P.econ.concessions === 'number') ? P.econ.concessions : L.concessionsFallback;
  const NONE = -1;

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
  function oppName(key) { const o = oppInfo(key); return o ? String(o.name).replace(/ University$/, '') : String(key); }
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
        const c = (data().coaches || [])[L.firstCoach] || { name: 'Bobby Cheramie', rep: 'has played in worse' };
        sp.coach = { name: c.name, stars: L.firstCoachStars, hiredYear: yearOf(state), quote: coachQuote(c.name), rep: c.rep };
        emit(EV.COACH_CHANGED, { name: sp.coach.name, stars: sp.coach.stars });
      }
      if (!sp.starters.length) sp.starters = drawStarters(state);
    }
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
  /** One starter at pos (§8): rating clamp(round(55 + prestige/2 + 5 × stars + U(−6, 6)), 60, 99). */
  function drawStarter(state, pos) {
    const e = state.economy || {}, sr = PS.starterRating;
    const stars = num(state.sports.coach && state.sports.coach.stars, L.firstCoachStars);
    const name = drawName();
    const hometown = drawHometown();
    const raw = sr.base + num(e.prestige, 10) / sr.prestigeDiv + sr.perStar * stars + R.range(-6, 6);
    return { name: name, pos: pos, hometown: hometown, rating: clamp(Math.round(raw), sr.min, sr.max) };
  }
  /** The three starters: QB, RB|WR, LB. */
  function drawStarters(state) {
    const out = [drawStarter(state, 'QB')];
    out.push(drawStarter(state, R.chance(0.5) ? 'RB' : 'WR'));
    out.push(drawStarter(state, 'LB'));
    return out;
  }
  function meanStarterRating(state) {
    const st = state.sports.starters;
    if (!st || !st.length) return PS.starterBase;
    let s = 0; for (let i = 0; i < st.length; i++) s += num(st[i].rating, PS.starterBase);
    return s / st.length;
  }
  /** May 5: each starter leaves with seniorLeaveP and is redrawn at the same position. */
  function seniorsLeave(state) {
    const st = state.sports.starters;
    let n = 0;
    for (let i = 0; i < st.length; i++) if (R.chance(PS.seniorLeaveP)) { st[i] = drawStarter(state, st[i].pos); n++; }
    return n;
  }
  /** Dec 9 (and the fire-the-coach path): three candidates not named like the current coach. */
  function drawCandidates(state) {
    const sp = state.sports;
    const pool = (data().coaches || []).filter(function (c) { return c.name !== sp.coach.name; });
    const out = [];
    const prestige = num(state.economy && state.economy.prestige, 10);
    for (let k = 0; k < PS.candidates && pool.length; k++) {
      const c = pool.splice(R.int(pool.length), 1)[0];
      const stars = clamp(Math.round(R.gauss() + prestige / PS.candidateStarDiv + PS.candidateStarAdd), PS.starMin, PS.starMax);
      out.push({ name: c.name, stars: stars, quote: coachQuote(c.name), rep: c.rep });
    }
    sp.candidates = out;
    return out;
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
  // The score model (GDD §8; ONE generator for every game)
  // ---------------------------------------------------------------------------
  /** One quarter for one side with strength s: k ∈ points with weights base + mult × s. */
  function drawQuarter(s) {
    const W = PS.quarterWeights, pts = PS.points;
    const w = [0, 0, 0, 0];
    let total = 0;
    for (let k = 0; k < 4; k++) { w[k] = Math.max(0, W[k][0] + W[k][1] * s); total += w[k]; }
    let u = R.float() * (total > 0 ? total : 1);
    for (let k = 0; k < 4; k++) { u -= w[k]; if (u < 0) return pts[k]; }
    return pts[3];
  }
  /** Draw quarters q0..q0+1 into plan in the fixed order home Q, away Q, home Q, away Q. */
  function drawHalf(plan, P, half) {
    for (let q = half * 2; q < half * 2 + 2; q++) { plan[0][q] = drawQuarter(P); plan[1][q] = drawQuarter(1 - P); }
  }
  /** After Q4: the decided winner gets a walk-off when the score contradicts it or is tied (7 if trailing by > 3, else 3; more plays until it leads). */
  function walkoffFor(plan, decidedHome) {
    const h = sum4(plan[0]), a = sum4(plan[1]);
    if (decidedHome ? h > a : a > h) return null;
    const trail = decidedHome ? a - h : h - a;
    let pts = trail > PS.walkoffTrail ? 7 : 3;
    while (pts <= trail) pts += 7;   // guarantees the final never contradicts `decided` (a multi-play walk-off when the deficit is large)
    return { side: decidedHome ? 0 : 1, pts: pts, revealed: 0 };
  }
  /** The whole generator in one go: {plan, walkoff, homePts, awayPts, homeWon, decided}. */
  M._generate = function (P, P2, r) {
    const plan = [[0, 0, 0, 0], [0, 0, 0, 0]];
    P = clampP(P); P2 = clampP(P2);
    drawHalf(plan, P, 0);
    drawHalf(plan, P2, 1);
    const decided = r < P2;
    const wo = walkoffFor(plan, decided);
    let h = sum4(plan[0]), a = sum4(plan[1]);
    if (wo) { if (wo.side === 0) h += wo.pts; else a += wo.pts; }
    return { plan: plan, walkoff: wo, homePts: h, awayPts: a, homeWon: h > a, decided: decided };
  };
  /** Starter stat line (§8): QB/RB/WR yards & TDs from BSU points; LB tackles from opponent points. */
  function statLine(starter, bsuPts, oppPts) {
    if (starter && starter.pos === 'LB') return (PS.statTackleBase + Math.floor(num(oppPts, 0) / PS.statTackleDiv)) + ' tackles';
    const yards = PS.statYardsBase + PS.statYardsPer * num(bsuPts, 0);
    const tds = Math.floor(PS.statTdMult * num(bsuPts, 0) / 7);
    return yards + ' yds, ' + tds + ' TD';
  }
  M._statLine = statLine;

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
  function makeGame(state, e, idx) {
    const sp = state.sports;
    const home = !!e.home;
    const night = home ? nightFor(state, e) : false;
    const pBsu = probFor(state, sp.rating, e.oppRating, night, home);
    const Pv = home ? pBsu : clampP(1 - pBsu);   // the VENUE home side's chance
    const r = R.float();
    const g = {
      day: today(state), opp: e.opp, r: r, P: Pv, P2: Pv, home: home, night: night, quarter: 0,
      scores: [[0, 0, 0, 0], [0, 0, 0, 0]], homePts: 0, awayPts: 0, decided: r < Pv, wentForIt: false, swing: 0,
      attendance: 0, revenue: 0, playThrough: !!(state.storms && state.storms.playThroughIt), halftimeAnswered: false,
      // extras (documented in INTEGRATION_NOTES): the pre-drawn plan and reveal mask, the walk-off, timeline bookkeeping
      kind: e.kind, origKind: e.origKind || e.kind, gameIndex: idx, oppRating: num(e.oppRating, oppBaseRating(e.opp)), venue: sp.venue,
      plan: [[0, 0, 0, 0], [0, 0, 0, 0]], revealed: [[0, 0, 0, 0], [0, 0, 0, 0]], halves: 0, walkoff: null,
      kickedOff: false, halftimeOpenedTick: NONE, finalized: false, exited: false, tailgate: 0, stats: ''
    };
    g.attendance = home ? attendanceFor(state, g) : 0;
    return g;
  }
  function ptsOf(g) {
    let h = 0, a = 0;
    for (let q = 0; q < 4; q++) { h += num(g.scores[0][q], 0); a += num(g.scores[1][q], 0); }
    if (g.walkoff && g.walkoff.revealed) { if (g.walkoff.side === 0) h += g.walkoff.pts; else a += g.walkoff.pts; }
    g.homePts = h; g.awayPts = a;
  }
  function ensureHalf(g, half) {
    if (g.halves > half) return;
    drawHalf(g.plan, half === 0 ? g.P : g.P2, half);
    g.halves = half + 1;
  }
  function scorePayload(g, extra) {
    const p = { opp: g.opp, home: g.home, night: g.night, homePts: g.homePts, awayPts: g.awayPts, kind: g.kind, day: g.day, venue: g.venue, playThrough: g.playThrough };
    if (extra) for (const k in extra) p[k] = extra[k];
    return p;
  }
  /** Reveal plan[side][q] into scores (emits game:score when it is a scoring play and !silent). */
  function reveal(state, g, side, q, silent) {
    if (g.revealed[side][q]) return;
    g.revealed[side][q] = 1;
    const k = num(g.plan[side][q], 0);
    g.scores[side][q] = k;
    ptsOf(g);
    if (k > 0 && !silent) emit(EV.GAME_SCORE, scorePayload(g, { quarter: q + 1, side: side === 0 ? 'home' : 'away' }));
  }
  function revealWalkoff(state, g, silent) {
    if (!g.walkoff) { g.walkoff = walkoffFor(g.plan, g.decided); if (!g.walkoff) return; }
    if (g.walkoff.revealed) return;
    g.walkoff.revealed = 1;
    ptsOf(g);
    if (!silent) emit(EV.GAME_SCORE, scorePayload(g, { quarter: 5, side: g.walkoff.side === 0 ? 'home' : 'away', walkoff: true }));
  }
  function kickoff(state, g) {
    if (g.kickedOff) return;
    g.kickedOff = true;
    ensureHalf(g, 0);
    g.quarter = 1;
    emit(EV.GAME_KICKOFF, scorePayload(g, { homePts: 0, awayPts: 0 }));
    if (g.home && habitatComplete(state)) ticker(state, 20, { opp: oppName(g.opp) });
  }
  function ticker(state, line, fields) {
    call('progress', 'ticker', state, line, fields || {}, 'sports', venueTile(state));
  }
  /** Open the halftime toast (D43: no onAnswer; the answer arrives only as decision:closed). */
  function openHalftime(state, g, ticks) {
    const bsu = g.home ? g.homePts : g.awayPts, opp = g.home ? g.awayPts : g.homePts;
    const lead = bsu > opp ? 'Up ' + bsu + '–' + opp : (bsu < opp ? 'Down ' + bsu + '–' + opp : 'Tied ' + bsu + '–' + opp);
    const pBsu = g.home ? g.P : 1 - g.P;
    const text = lead + ' · ' + probWord(pBsu) + ' ' + pct(pBsu) + ' · Go for it: second half ±' + PS.swingMax + ' rating (underdogs like it) · −' + Math.abs(num(P.econ.timers.goForIt.value, -2)) + ' spirit if it fails';
    g.halftimeOpenedTick = state.setPiece ? num(state.setPiece.tick, 0) : 0;
    emit(EV.GAME_HALFTIME, scorePayload(g, { quarter: 2 }));
    call('ui', 'decision', state, { id: 'halftime', text: text, yes: 'Go for it', no: 'Play safe', ticks: ticks });
  }
  /** The tick-based timeout (D43): ask ui to default the toast; if no decision:closed came back, resolve locally. */
  function enforceHalftime(state, g) {
    if (g.halftimeAnswered) return;
    call('ui', 'answerDecision', 'halftime', 'default');
    if (!g.halftimeAnswered) M.halftime(state, false);
  }
  /** The final whistle: totals, record, revenue, tickers, rivalry, Play Through It, Resilience Bowl, timers, events. */
  function finalize(state, g, silent) {
    if (g.finalized) return;
    const sp = state.sports;
    ensureHalf(g, 0); ensureHalf(g, 1);
    for (let q = 0; q < 4; q++) { reveal(state, g, 0, q, true); reveal(state, g, 1, q, true); }
    revealWalkoff(state, g, silent);
    ptsOf(g);
    g.finalized = true;
    g.quarter = 4;
    const won = g.home ? g.homePts > g.awayPts : g.awayPts > g.homePts;
    const bsuPts = g.home ? g.homePts : g.awayPts, oppPts = g.home ? g.awayPts : g.homePts;
    const e = sp.schedule[g.gameIndex];
    if (e) { e.played = true; e.result = { home: g.homePts, away: g.awayPts, won: won, bsu: bsuPts, opp: oppPts }; }
    // record
    if (won) sp.record.wins++; else sp.record.losses++;
    sp.record.last4.push(won);
    while (sp.record.last4.length > 4) sp.record.last4.shift();
    if (g.home && won) sp.homeWins++;
    // money
    if (g.kind === 'club') { call('economy', 'post', state, 'athletics', PS.clubPay, { note: 'club game vs ' + oppName(g.opp) }); g.revenue = PS.clubPay; }
    else if (g.home) {
      const ticket = num(state.economy && state.economy.ticket, PS.ticketDefault);
      const athletics = g.attendance * (ticket + CONCESSIONS);
      g.tailgate = tailgateFor(state, g.attendance);
      const vt = venueTile(state);
      if (athletics > 0) call('economy', 'post', state, 'athletics', athletics, { i: vt, note: 'home game vs ' + oppName(g.opp) });
      if (g.tailgate > 0) call('economy', 'post', state, 'tailgate', g.tailgate, { i: vt, note: 'tailgate' });
      g.revenue = athletics + g.tailgate;
      if (sp.firstHomeGameDay < 0) sp.firstHomeGameDay = today(state);
      if (g.night && sp.firstNightGameDay < 0) sp.firstNightGameDay = today(state);
    }
    // ticker lines 43/44 and the recap 60
    const on = oppName(g.opp);
    if (won) ticker(state, 43, { w: bsuPts, opp: on, l: oppPts }); else ticker(state, 44, { opp: on, w: oppPts, l: bsuPts });
    if (sp.starters.length) {
      const st = sp.starters[(g.day + g.gameIndex) % sp.starters.length];
      g.stats = statLine(st, bsuPts, oppPts);
      ticker(state, 60, { pos: st.pos, name: st.name, hometown: st.hometown, stat: g.stats, opp: on });
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
    // a Go-for-it that lost (§5.6)
    if (g.wentForIt && !won) call('progress', 'addTimer', state, 'goForIt', num(P.econ.timers.goForIt.value, -2), num(P.econ.timers.goForIt.days, 10));
    emit(EV.GAME_FINAL, scorePayload(g, { won: won, bsuPts: bsuPts, oppPts: oppPts, attendance: g.attendance, revenue: g.revenue, quarter: 4 }));
    return { home: g.homePts, away: g.awayPts, won: won, bsu: bsuPts, opp: oppPts };
  }
  /** Run the whole generator for entry idx in one tick (away, club, bowl, or a home game with no set piece). */
  function playOffscreen(state, idx) {
    const e = state.sports.schedule[idx];
    if (!e || e.played) return null;
    const g = makeGame(state, e, idx);
    g.halftimeAnswered = true;   // no decision off-screen: play safe
    return finalize(state, g, true);
  }
  function clearGame(state) {
    if (!state.sports.game) return;
    state.sports.game = null;
    call('agents', 'gameDayBuses', state, false);
  }
  /** Start the home game set piece (or the montage) for entry idx; without a session, play it off-screen. */
  function startHome(state, idx) {
    const sp = state.sports;
    const e = sp.schedule[idx];
    if (!e || e.played) { pv.pending = NONE; return { ok: false, reason: 'No such game' }; }
    if (state.setPiece || sp.game) { pv.pending = idx; return { ok: false, reason: 'A set piece is running' }; }
    pv.pending = NONE;
    const seen = call('progress', 'setPieceSeen', state, 'game') === true;
    const montage = !!sp.autoSim && seen;
    const kind = montage ? 'montage' : 'game';
    const len = montage ? PS.autoSimTicks : PT.gameTicks;
    const g = makeGame(state, e, idx);
    sp.game = g;
    call('session', 'startSetPiece', state, kind, { len: len, skippable: montage ? true : seen });
    if (!state.setPiece) {
      // no session (isolation) or it refused: resolve the game off-screen so the season never stalls
      sp.game = null;
      g.halftimeAnswered = true;
      finalize(state, g, true);
      return { ok: true, offscreen: true };
    }
    if (!Number.isFinite(state.setPiece.tick)) state.setPiece.tick = 0;
    call('agents', 'gameDayBuses', state, true);
    if (kind === 'game') scriptSky(state, g, 0);
    return { ok: true, kind: kind };
  }
  /** Golden 0–200 → Dusk 200–300 → Night for night games; Day throughout otherwise. */
  function scriptSky(state, g, t) {
    if (!g.night) { call('weather', 'scriptSky', state, SKY.DAY, clamp(t / PT.gameTicks, 0, 1)); return; }
    if (t < PS.kickoffTick) call('weather', 'scriptSky', state, SKY.GOLDEN, t / PS.kickoffTick);
    else if (t < PS.kickoffTick + PS.quarterTicks) call('weather', 'scriptSky', state, SKY.DUSK, (t - PS.kickoffTick) / PS.quarterTicks);
    else call('weather', 'scriptSky', state, SKY.NIGHT, clamp((t - PS.kickoffTick - PS.quarterTicks) / (PT.gameTicks - PS.kickoffTick - PS.quarterTicks), 0, 1));
  }
  /** The 750-tick timeline (ARCHITECTURE §5.9), a pure function of (game, setPiece.tick). */
  function gameTick(state, g, t) {
    scriptSky(state, g, t);
    if (t >= PS.kickoffTick) kickoff(state, g);
    if (!g.kickedOff) return;
    const qStart = function (q) { return PS.kickoffTick + q * PS.quarterTicks; };
    if (t < PS.finalTick) g.quarter = clamp(Math.floor((t - PS.kickoffTick) / PS.quarterTicks) + 1, 1, 4);
    // halftime (400): open once; enforce the timeout at +80; never past the final
    if (t >= PS.halftimeTick && g.halftimeOpenedTick < 0 && !g.halftimeAnswered) openHalftime(state, g, TOAST_TICKS);
    if (!g.halftimeAnswered && g.halftimeOpenedTick >= 0 && t >= g.halftimeOpenedTick + TOAST_TICKS) enforceHalftime(state, g);
    // scoring plays at fixed offsets; a quarter whose half is not drawn yet (unanswered halftime) catches up when it is
    for (let q = 0; q < 4; q++) {
      const half = q >> 1;
      if (g.halves <= half) continue;
      for (let side = 0; side < 2; side++) if (t >= qStart(q) + L.scoreOffsets[side]) reveal(state, g, side, q, false);
    }
    if (t >= PS.finalTick && !g.finalized) { enforceHalftime(state, g); finalize(state, g, false); }
    if (t >= PS.exitTick && !g.exited) { g.exited = true; call('agents', 'gameDayBuses', state, false); }
  }
  /** The 50-tick montage: kickoff 5, quarters 10/20/30/40, halftime toast at 20 (20 ticks), final 45. */
  function montageTick(state, g, t) {
    const MT = L.montage;
    if (t >= MT.kickoff) kickoff(state, g);
    if (!g.kickedOff) return;
    g.quarter = 1;
    for (let q = 0; q < 4; q++) if (t >= MT.quarters[q]) g.quarter = q + 1;
    if (t >= MT.halftime && g.halftimeOpenedTick < 0 && !g.halftimeAnswered) openHalftime(state, g, MT.halftimeTicks);
    if (!g.halftimeAnswered && g.halftimeOpenedTick >= 0 && t >= g.halftimeOpenedTick + MT.halftimeTicks) enforceHalftime(state, g);
    for (let q = 0; q < 4; q++) {
      if (g.halves <= (q >> 1)) continue;
      if (t >= MT.quarters[q]) { reveal(state, g, 0, q, false); reveal(state, g, 1, q, false); }
    }
    if (t >= MT.final && !g.finalized) { enforceHalftime(state, g); finalize(state, g, false); call('agents', 'gameDayBuses', state, false); g.exited = true; }
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
    let bowl = false, bowlWon = false;
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
      sp.schedule.push(e);
      emit(EV.GAME_SCHEDULED, { day: e.day, opp: e.opp, home: false, kind: 'bowl' });
      const res = playOffscreen(state, sp.schedule.length - 1);
      bowl = true;
      bowlWon = !!(res && res.won);
      if (bowlWon) { call('economy', 'post', state, 'athletics', PS.bowlWin, { note: 'Sugar Cane Bowl (won)' }); call('economy', 'bump', state, 'prestige', PS.bowlPrestige, 'Sugar Cane Bowl'); }
      else call('economy', 'post', state, 'athletics', PS.bowlLose, { note: 'Sugar Cane Bowl' });
    }
    const undefeated = regWins >= PS.undefeatedWins && regLosses === 0;
    sp.lastSeason = { wins: sp.record.wins, losses: sp.record.losses, bowlWon: bowlWon, undefeated: undefeated };
    if (undefeated) call('progress', 'achieve', state, 'undefeated');
    // coach stars drift (§8)
    if (sp.coach && sp.coach.name) {
      if (bowlWon || undefeated) sp.coach.stars = Math.min(PS.starMax, num(sp.coach.stars, 2) + 1);
      if (regLosses > regWins) sp.losingSeasons++; else sp.losingSeasons = 0;
      if (sp.losingSeasons >= PS.starDriftLosing) { sp.coach.stars = Math.max(PS.starMin, num(sp.coach.stars, 2) - 1); sp.losingSeasons = 0; }
    }
    sp.seasonDone = true;
    sp.homeWins = 0;
    sp.record.wins = 0; sp.record.losses = 0;
    emit(EV.SEASON_END, { wins: sp.lastSeason.wins, losses: sp.lastSeason.losses, bowl: bowl, bowlWon: bowlWon, undefeated: undefeated, year: year });
  }
  function seasonActive(state) { const sp = state.sports; return sp.hasTeam && sp.seasonYear === yearOf(state) && !sp.seasonDone && sp.schedule.length > 0; }
  function unplayedRegular(state) { return findEntry(state, function (e) { return !e.played && !e.cancelled && e.kind !== 'bowl'; }) >= 0; }

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
      if (k < 0) k = (pos === 'LB') ? 2 : (pos === 'QB' ? 0 : 1);
      if (sp.starters.length < 3) sp.starters = drawStarters(state);
      sp.starters[k] = { name: rc.name, pos: pos, hometown: rc.hometown, rating: PS.recruitRating };
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
      if (sp.starters.length < 3) sp.starters = drawStarters(state);
      applyRecruit(state);
      if (sp.seasonYear !== year) buildSchedule(state, year);
      if (call('buildings', 'has', state, 'stadium') === true) drawRecruit(state);
    }
    // a team that first exists between Aug 5 and Dec 8: the remaining dates only
    if (sp.hasTeam && sp.seasonYear !== year) {
      const aug5 = dayOfDate(PS.schedule.recruitDate, year), dec8 = dayOfDate(PS.schedule.seasonEnd, year);
      if (day > aug5 && day < dec8) { if (!sp.starters.length) sp.starters = drawStarters(state); buildSchedule(state, year); }
    }
    // May 5: seniors leave
    if (sp.hasTeam && sp.starters.length && day === dayOfDate('May 5', year)) seniorsLeave(state);
    // Dec 9: the offseason hire card
    if (sp.hasTeam && day === dayOfDate(PS.schedule.offseasonStart, year)) drawCandidates(state);
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
    if (g && spc && spc.kind === 'game') { gameTick(state, g, num(spc.tick, 0)); return; }
    if (g && spc && spc.kind === 'montage') { montageTick(state, g, num(spc.tick, 0)); return; }
    if (g && !spc) { if (!g.finalized) { g.halftimeAnswered = true; finalize(state, g, true); } clearGame(state); }
    if (pv.landfallNow) { pv.landfallNow = false; const idx = todaysHomeIndex(state); if (idx >= 0 && !sp.game) M.postpone(state, idx); }
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
    if (p.id === 'halftime') { M.halftime(S, p.answer === 'yes'); }
    else if (p.id === 'playThrough') resolvePlayThrough(S, p.answer === 'yes' ? 'yes' : 'no');
  }
  M._onDecision = onDecision;
  function onBuilding(p) { if (pv && p && (p.type === 'practice_field' || p.type === 'stadium' || p.type === 'tiger_habitat' || p.type === 'rec_center' || p.type === 'greek_house')) pv.venueDirty = true; }
  function onLandfall() { if (pv) pv.landfallNow = true; }
  function onPassed() { if (pv && S) pv.passedDay = today(S); }
  function onSetPieceEnd(p) {
    if (!S || !p || (p.kind !== 'game' && p.kind !== 'montage')) return;
    try {
      const g = S.sports.game;
      if (g && !g.finalized) { g.halftimeAnswered = true; finalize(S, g, true); }
      clearGame(S);
    } catch (e) { BSU.error('sports', 'setpiece:end', e); }
  }

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
  /** the halftime answer (ONLY via decision:closed or the tick timeout); idempotent through game.halftimeAnswered */
  M.halftime = function (state, goForIt) {
    try {
      const sp = state && state.sports;
      const g = sp && sp.game;
      if (!g || g.halftimeAnswered) return;
      g.halftimeAnswered = true;
      if (goForIt) {
        const override = M._deps.halftimeSwing;
        let swing;
        if (typeof override === 'function') swing = num(override(state, g), 0);
        else swing = (R.chance(0.5) ? 1 : -1) * R.range(0, PS.swingMax);
        g.swing = swing;
        g.wentForIt = true;
        const pBsu = probFor(state, num(sp.rating, 0) + swing, g.oppRating, g.night, g.home);
        g.P2 = g.home ? pBsu : clampP(1 - pBsu);
        g.decided = g.r < g.P2;
        ticker(state, 61, { coach: sp.coach && sp.coach.name ? sp.coach.name : 'Cheramie' });
        call('ui', 'notify', state, { text: 'Coach ' + (sp.coach && sp.coach.name ? sp.coach.name : '') + ' is going for it, ' + (swing >= 0 ? '+' : '−') + Math.abs(Math.round(swing)), kind: 'sports', ttl: 6000 });
      } else g.P2 = g.P;
      ensureHalf(g, 1);
    } catch (e) { BSU.error('sports', 'halftime', e); }
  };
  /** at set-piece tick ≥ 200 when the game set piece has been seen: resolve halftime by default, finish, jump to 749 */
  M.skipToFinal = function (state) {
    try {
      const spc = state.setPiece, g = state.sports.game;
      if (!spc || !g || (spc.kind !== 'game' && spc.kind !== 'montage')) return;
      const seen = call('progress', 'setPieceSeen', state, 'game') === true;
      if (spc.kind === 'game' && (num(spc.tick, 0) < PS.kickoffTick || !seen)) return;
      kickoff(state, g);
      enforceHalftime(state, g);
      finalize(state, g, true);
      if (!g.exited) { g.exited = true; call('agents', 'gameDayBuses', state, false); }
      spc.tick = Math.max(num(spc.tick, 0), num(spc.len, PT.gameTicks) - 1);
    } catch (e) { BSU.error('sports', 'skipToFinal', e); }
  };
  M.setNight = function (state, on) { try { state.sports.nightToggle = !!on; refreshNights(state); } catch (e) { BSU.error('sports', 'setNight', e); } };
  M.setAutoSim = function (state, on) { try { state.sports.autoSim = !!on; } catch (e) { BSU.error('sports', 'setAutoSim', e); } };
  M.setPermits = function (state, v) { try { state.sports.permits = v === 'free' ? 'free' : 'paid'; } catch (e) { BSU.error('sports', 'setPermits', e); } };
  /** 0 | 50000 | 150000: charges the tier (boardCards) and adds the homecomingBudget happiness timer */
  M.setHomecomingBudget = function (state, v) {
    try {
      const tier = L.homecomingTiers.indexOf(num(v, 0));
      if (tier < 0) return { ok: false, reason: 'Unknown tier' };
      const cost = L.homecomingTiers[tier];
      if (cost > 0 && call('economy', 'charge', state, cost, 'boardCards', { note: 'Homecoming budget' }) === false) return { ok: false, reason: 'Cannot afford' };
      state.sports.homecomingBudget = cost;
      const hb = P.econ.boardCards.homecomingBudget;
      if (tier > 0) call('progress', 'addTimer', state, 'homecomingBudget', num(hb.happiness[tier], tier * 3), num(hb.days, 10));
      return { ok: true, cost: cost };
    } catch (e) { BSU.error('sports', 'setHomecomingBudget', e); return { ok: false, reason: 'error' }; }
  };
  /** sign candidate idx: needs coaching ≥ 300k × stars and cash ≥ 100k × stars; signing fee charged (coaching) */
  M.hireCoach = function (state, idx) {
    try {
      const sp = state.sports, e = state.economy || {};
      const c = sp.candidates[idx];
      if (!c) return { ok: false, cost: 0, reason: 'No such candidate' };
      const fee = PS.coachFee * c.stars;
      if (num(e.coaching, 0) < PS.coachSign * c.stars) return { ok: false, cost: fee, reason: 'Coaching budget must be at least ' + BSU.formatMoney(PS.coachSign * c.stars) + '/yr' };
      if (num(e.cash, 0) < fee) return { ok: false, cost: fee, reason: 'Signing fee ' + BSU.formatMoney(fee) };
      if (call('economy', 'charge', state, fee, 'coaching', { note: 'signing ' + c.name }) === false) return { ok: false, cost: fee, reason: 'Cannot afford the signing fee' };
      sp.coach = { name: c.name, stars: c.stars, hiredYear: yearOf(state), quote: c.quote || coachQuote(c.name), rep: c.rep || '' };
      sp.candidates = [];
      emit(EV.COACH_CHANGED, { name: sp.coach.name, stars: sp.coach.stars });
      storeRating(state);
      return { ok: true, cost: fee, reason: '' };
    } catch (e) { BSU.error('sports', 'hireCoach', e); return { ok: false, cost: 0, reason: 'error' }; }
  };
  /** $500k buyout (waived after 3 straight rivalry losses); an interim staff holds the clipboard; candidates drawn at once */
  M.fireCoach = function (state) {
    try {
      const sp = state.sports;
      if (!sp.hasTeam || !sp.coach || !sp.coach.name) return { ok: false, cost: 0, reason: 'No coach' };
      const cost = sp.rivalryLossStreak >= PS.rivalryLossFire ? 0 : PS.buyout;
      if (cost > 0 && call('economy', 'charge', state, cost, 'coaching', { note: 'buyout ' + sp.coach.name }) === false) return { ok: false, cost: cost, reason: 'Cannot afford the buyout' };
      sp.coach = { name: L.interimCoach.name, stars: L.interimCoach.stars, hiredYear: yearOf(state), quote: '', rep: L.interimCoach.rep };
      drawCandidates(state);
      emit(EV.COACH_CHANGED, { name: sp.coach.name, stars: sp.coach.stars });
      storeRating(state);
      return { ok: true, cost: cost };
    } catch (e) { BSU.error('sports', 'fireCoach', e); return { ok: false, cost: 0, reason: 'error' }; }
  };
  /** the recruiting card: accept pays the NIL price now (the building prices are checked next Aug 5) */
  M.answerRecruit = function (state, accept) {
    try {
      const rc = state.sports.recruit;
      if (!rc || rc.answered) return;
      rc.answered = true;
      if (!accept) { rc.accepted = false; return; }
      if (rc.price === L.recruitPrices[0]) {
        if (call('economy', 'charge', state, L.recruitNil, 'coaching', { note: 'NIL fund' }) === false) { rc.accepted = false; return; }
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
    setHomecomingBudget: function () { return { ok: false, reason: 'No game state' }; },
    halftime: function () {}, skipToFinal: function () {}, setNight: function () {}, setAutoSim: function () {}, setPermits: function () {},
    answerRecruit: function () {}, postpone: function () {}, scheduleMakeup: function () {}, offerPlayThrough: function () {}, startNightGameScript: function () {}
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
  M._probFor = probFor;
  M._venueInfo = venueInfo;

  // ---------------------------------------------------------------------------
  // selfTest (§10.6; the brief's §6 list) — private state, stubbed deps, recorded emits
  // ---------------------------------------------------------------------------
  M.selfTest = function () {
    const notes = [];
    const A = function (c, m) { BSU.assert(c, 'sports: ' + m); };
    const saved = { emit: M._deps.emit, S: S, pv: pv, sim: R.state, swing: M._deps.halftimeSwing };
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
      delete M._deps.halftimeSwing;

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

      // 2. the score generator
      {
        R.state = 12345;
        let wins = 0;
        const pts = PS.points;
        for (let k = 0; k < 200; k++) {
          const r = R.float();
          const g = M._generate(0.7, 0.7, r);
          A(g.homeWon === (r < 0.7), 'final never contradicts decided');
          A(g.homePts !== g.awayPts, 'no ties after the walk-off');
          for (let q = 0; q < 4; q++) A(pts.indexOf(g.plan[0][q]) >= 0 && pts.indexOf(g.plan[1][q]) >= 0, 'quarter scores ∈ {0,3,7,10}');
          A(g.homePts >= 0 && g.awayPts >= 0 && Number.isInteger(g.homePts) && Number.isInteger(g.awayPts), 'non-negative integer finals');
          if (g.homeWon) wins++;
        }
        A(wins >= 124 && wins <= 156, 'home win share within .62–.78 (' + (wins / 200).toFixed(3) + ')');
        notes.push('gen share ' + (wins / 200).toFixed(2));
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
        A(s.sports.starters.length === 3, 'three starters on the first team day');
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
          for (let t = 0; t < 760 && s.setPiece; t++) {
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

      // 6. halftime go-for-it
      {
        const s = mk(6); s.sports.hasTeam = true; s.sports.venue = 'bayou_field'; s.sports.rating = 60;
        s.sports.schedule = [makeEntry(s.calendar.day, 'crescent', true, 'regular', 0, 70.4)];
        s.setPiece = { kind: 'game', tick: 400, len: 750, skippable: false, choices: {}, speedBefore: 1, cameraTouched: false };
        const g = makeGame(s, s.sports.schedule[0], 0);
        g.r = 0.5; g.P = 0.4; g.P2 = 0.4; g.decided = false; g.kickedOff = true; g.halves = 1;
        s.sports.game = g;
        M._deps.halftimeSwing = function () { return 8; };
        M.halftime(s, true);
        A(g.wentForIt && g.swing === 8 && g.P2 > 0.5 && g.decided === true, 'go for it +8 flips decided to home (P2 ' + g.P2.toFixed(3) + ')');
        delete M._deps.halftimeSwing;
        const g2 = makeGame(s, s.sports.schedule[0], 0); g2.r = 0.5; g2.P = 0.4; g2.P2 = 0.4; g2.kickedOff = true; g2.halves = 1;
        s.sports.game = g2; M.halftime(s, false);
        A(g2.P2 === g2.P && !g2.wentForIt && g2.halves === 2, 'play safe keeps P2 === P');
        s.sports.game = null; s.setPiece = null;
      }

      // 7. starter stat line
      A(statLine({ pos: 'QB' }, 28, 17) === '312 yds, 2 TD', 'QB stat line');
      A(statLine({ pos: 'LB' }, 28, 17) === '11 tackles', 'LB stat line');

      // 8. starters
      {
        const s = mk(9); s.sports.coach = { name: 'x', stars: 2, hiredYear: 1, quote: '', rep: '' };
        const st = drawStarters(s);
        A(st.length === 3 && st[0].pos === 'QB' && (st[1].pos === 'RB' || st[1].pos === 'WR') && st[2].pos === 'LB', 'positions QB / RB|WR / LB');
        A(st.every(function (x) { return x.rating >= 60 && x.rating <= 99 && typeof x.name === 'string' && x.name.length > 2 && typeof x.hometown === 'string'; }), 'ratings 60–99, names, hometowns');
        s.sports.starters = st;
        const n = seniorsLeave(s);
        A(n >= 0 && n <= 3 && s.sports.starters.length === 3, 'May 5 redraw replaces 0–3');
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
        A(M.fireCoach(s).cost === PS.buyout, 'buyout $500k otherwise');
        A(tickers.indexOf(42) >= 0 && tickers.indexOf(44) >= 0, 'ticker lines 42/44 on the losses');
      }

      // 11. halftime idempotence through the decision:closed handler
      {
        const s = mk(12); s.sports.hasTeam = true; s.sports.venue = 'bayou_field'; s.sports.rating = 60;
        s.sports.coach = { name: 'Bobby Cheramie', stars: 2, hiredYear: 1, quote: '', rep: '' };
        s.sports.schedule = [makeEntry(s.calendar.day, 'delta', true, 'regular', 0, 62)];
        s.setPiece = { kind: 'game', tick: 400, len: 750, skippable: false, choices: {}, speedBefore: 1, cameraTouched: false };
        const g = makeGame(s, s.sports.schedule[0], 0); g.kickedOff = true; g.halves = 1;
        s.sports.game = g; S = s;
        const before61 = tickers.filter(function (x) { return x === 61; }).length;
        const r0 = R.state;
        onDecision({ id: 'halftime', answer: 'yes' });
        const r1 = R.state;
        onDecision({ id: 'halftime', answer: 'yes' });
        const r2 = R.state;
        A(r1 !== r0 && r2 === r1, 'rng drawn once across two closes');
        A(g.halftimeAnswered === true && tickers.filter(function (x) { return x === 61; }).length === before61 + 1, 'ticker 61 once; halftimeAnswered');
        // the tick-based timeout resolves an unanswered toast at 480 and the final at 600
        const g3 = makeGame(s, s.sports.schedule[0], 0); s.sports.game = g3;
        for (let t = 0; t <= 600; t++) { s.setPiece.tick = t; M.tick(s, { newDay: false, day: s.calendar.day }); }
        A(g3.halftimeAnswered && !g3.wentForIt && g3.finalized && g3.halftimeOpenedTick === 400, 'timeout at 480 defaults to play safe; final at 600');
        A(log.some(function (x) { return x.name === EV.GAME_KICKOFF; }) && log.some(function (x) { return x.name === EV.GAME_HALFTIME; }), 'kickoff and halftime events');
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
        s.economy.coaching = 0; s.economy.cash = 1e7;
        A(!M.hireCoach(s, 0).ok, 'hire refused without the coaching budget');
        s.economy.coaching = PS.coachSign * c0.stars;
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
            for (let t = 0; t < 760 && s.setPiece; t++) { M.tick(s, { newDay: false, day: day }); if (s.setPiece && ++s.setPiece.tick >= s.setPiece.len) { const k = s.setPiece.kind; s.setPiece = null; onSetPieceEnd({ kind: k, len: 0 }); } s.tick++; }
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
        for (let day = BSU.dateToDay('Aug 5', 1); day <= BSU.dateToDay('Dec 9', 1); day++) { tickDay(s, day); for (let t = 0; t < 760 && s.setPiece; t++) { M.tick(s, { newDay: false, day: day }); if (s.setPiece && ++s.setPiece.tick >= s.setPiece.len) { s.setPiece = null; onSetPieceEnd({ kind: 'game', len: 0 }); } } }
        const bad = scan(s.sports, 'sports');
        A(!bad, 'no NaN/Infinity in state.sports (' + bad + ')');
      }
      return { ok: true, notes: notes.join('; ') };
    } catch (e) {
      return { ok: false, notes: (e && e.message) ? e.message : String(e) };
    } finally {
      M._deps.emit = saved.emit;
      if (saved.swing === undefined) delete M._deps.halftimeSwing; else M._deps.halftimeSwing = saved.swing;
      for (let i = 0; i < stubNames.length; i++) { if (savedStubs[stubNames[i]] === undefined) delete M._deps[stubNames[i]]; else M._deps[stubNames[i]] = savedStubs[stubNames[i]]; }
      S = saved.S; pv = saved.pv; R.state = saved.sim;
    }
  };
})();
