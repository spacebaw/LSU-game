# Brief: `src/js/sports.js` → `BSU.sports`

Read first: `docs/ARCHITECTURE.md` §1 (row 9), §2.1 (`SetPiece`), §2.8 (`state.sports`, every field), §3.2 `params.sports`, §3.4 events (`game:*`, `season:end`, `coach:changed`, `decision:*`), §4.2 (`data.opponents`, `data.schedule`, `data.coaches`, `data.students` for starters), §5.1 step 8, §5.9 (API + the 750-tick timeline), §9.3 (`startSetPiece`), §10.5 (no state on the module object), §10.6, D13, D43, D46, D49, D51; `docs/GDD.md` §8 (all of it — this brief is §8 made executable), §0.3 rows 18–19 (venues, tiers), §5.2 (athletics revenue, festivals are economy's), §5.6 (`spirit`, `playThroughIt`, `goForIt`, `freePermits`), §5.5 (`football` term inputs), §6.2 (postponement, Play Through It offer, Resilience Bowl), §10.2 Objectives 15, 18a/18b/18, 20, §10.4 (the scripted night game), §10.5 milestones 10, 12–15, §14.1 (coaches, hometowns), §14.4 lines 20, 42–44, 46, 60, 61.

---

## 1. Purpose and public surface

Football, light: the team, venues, the season schedule, rating, named coach and starters, win probability, the quarter score model, the 750-tick home-game set piece (with the halftime decision), the 50-tick montage/auto-sim, attendance/revenue/tailgates, rivalry, the bowl, postponement and the Resilience Bowl, Play Through It.

Copy the API from ARCHITECTURE §5.9 verbatim (`tick, season, rating, winProb, playHome, simGame, halftime, skipToFinal, setNight, setAutoSim, setPermits, setHomecomingBudget, hireCoach, fireCoach, answerRecruit, postpone, scheduleMakeup, venueSeats, attendance, upcoming`). Additions:

```js
// NO `BSU.sports.game` accessor exists (D46): the in-progress game is read by every consumer (wildlife, agents, render, render_fx, ui, audio) ONLY as `state.sports.game` (null when none). A function named `game` would always be truthy and make every day a game day.
BSU.sports.homeWinsThisSeason(state) → number         // economy's spirit term
BSU.sports.winPctLast4(state) → number
BSU.sports.offerPlayThrough(state) → void             // called ONLY by weather at its T−1 bands step when `sports.upcoming(state)` is a home entry today and `storm.forecastCat ≤ 1` (D51): opens the `playThrough` decision toast
BSU.sports.startNightGameScript(state, day) → void    // progress/Objective 20: the scripted clear night (§10.4); sports calls weather.suppressRainOn(day)
```

## 2. State fields

**Writes (owner):** `state.sports.*` (all of §2.8). Money only through `economy.post`/`charge`. Timers only through `progress.addTimer` (`playThroughIt`, `goForIt`, `rivalryDonations`, `undefeatedDonations`, `freePermits` is economy's flat timer read from `sports.permits`). Prestige through `economy.bump`. The set piece through `session.startSetPiece(state, 'game'|'montage', {len, skippable})`; the sky through `weather.scriptSky/releaseSky`.

**Reads:** `buildings.has/count/get/list/effective/stats` (practice field, tiers, Rec Center within 10, Greek houses within 8 of the venue, Tiger Habitat), `economy.students/alumni/prestige/happiness/coaching/ticket/cash`, `weather.date/isDate/dayOf/raining/storm/sky`, `progress.timers/timer/setPieceSeen/earned`, `state.setPiece`, `state.storms.playThroughIt/current`, `data.opponents/schedule/coaches/coachQuotes/students`.

## 3. Events

**Emits:** `game:scheduled{day, opp, home, kind}` (per schedule entry when built); `game:kickoff{opp, home, night, homePts:0, awayPts:0}`; `game:score{opp, home, night, homePts, awayPts, quarter, side}`; `game:halftime{…}`; `game:final{…, won}`; `season:end{wins, losses, bowl}`; `coach:changed{name, stars}`; `decision:open` is ui's (you call `ui.decision`).

**Listens (owner `'sports'`):** `decision:closed{id:'halftime', answer}` → `halftime(answer === 'yes')` **guarded by `game.halftimeAnswered`** (set `true` on the first close; a duplicate close is ignored — `decision:closed` is the ONLY delivery of a toast answer, D43; no `onAnswer` callback is ever passed); `decision:closed{id:'playThrough'}` → guarded by a private `playThroughAnsweredDay === day` flag (the toast is not saved, so a load cannot replay it) → `weather.setPlayThrough(answer === 'yes')` / `postpone` (both idempotent anyway); `building:complete{type:'practice_field'|'stadium'}` and `building:upgraded` → `hasTeam`/`venue` recompute + coach on the first field; `storm:landfall` → postpone today's home game; `setpiece:end{kind:'game'|'montage'}` → finalize if not already; `calendar:date` not used (flags).

## 4. Rules checklist

### Tier 1

**Team and venue (§8, §0.3 rows 18–19)**
- [ ] `hasTeam = buildings.has('practice_field')` (complete). On the first `hasTeam` transition: `coach = {name:'Bobby Cheramie', stars: 2, hiredYear: year, quote: data.coachQuotes[0], rep: data.coaches[0].rep}`, emit `coach:changed`, and draw 3 starters (below) immediately if the season has not started.
- [ ] `venue`: `'stadium3'|'stadium2'|'stadium1'` by the stadium's `tier` if a complete stadium exists, else `'bayou_field'` if the practice field's `tier ≥ 1`, else `'none'`. `venueSeats()`: 80000/45000/15000/6000/0. `nightCapable = venue ∈ {stadium2, stadium3}`. Bayou Field: day games only.
- [ ] Without home seating: away-only **club** schedule: every game is `kind:'club'`, `home:false`, played off-screen, `$20k` each (`economy.post('athletics', 20000)`), the `football` prestige term uses `winPct` but is capped at 20 (economy reads `sports.season().clubOnly` — expose `clubOnly: boolean` computed from `venue === 'none'`).

**Schedule (§8 Season calendar; `data.schedule`)**
- [ ] Built on Aug 5 (`flags.newDay && isDate('Aug 5')`) when `hasTeam`, or the day the team first exists if between Aug 5 and Dec 8 (remaining dates only): `seasonYear = year`; 7 opponents drawn from the 9 (`rng.sim`), Magnolia always and always on Nov 8 (rivalry, always home); the other 6 assigned to the remaining dates in `data.schedule` order; `home` per the data (Aug 8, Sep 8, Oct 8 homecoming, Nov 8 rivalry); `kind` from data; `night`: forced true for homecoming and rivalry when `nightCapable`, else `nightToggle && nightCapable`; `played:false, result:null, postponedTo:-1`. The bowl entry (Dec 8, `kind:'bowl'`) is added only if `wins ≥ 5` on Dec 8 (see bowl). Emit `game:scheduled` per entry.
- [ ] Opponent season noise: each opponent's `rating` this season = `data.opponents[k].rating + rng.range(−8, 8)` (stored on the schedule entry as `oppRating`).

**Rating (§8 Team rating; `params.sports`)** — recomputed daily into `sports.rating`/`ratingTerms` (every term is a line):
- [ ] `20 + 5 (practice field) + min(30, coaching/100000) + min(25, prestige/4) + min(10, happiness/10) + 3 × (tiger habitat complete) − 8 × (month ∈ {8,9} && advisory-season heat && no Rec Center within 10 of the field) + 4 × (stars − 2) + clamp((meanStarterRating − 75)/5, −3, 5) + timerValue('recruitingTrip') + timerValue('voiceTeamRating')`, clamped 0–100. The heat term: apply when `month ∈ {8, 9}` (Aug–Sep) unless a complete Rec Center has any footprint tile within Chebyshev 10 of the practice field's footprint (the `recPool` voice card adds +2 on top).

**Coach and starters (§8)**
- [ ] Starters drawn at the fall lock (Aug 5) and on the first team day: 3 `{name (§14.1 generator), pos: 'QB', pick('RB','WR'), 'LB', hometown: pick(data.students.hometowns), rating: clamp(round(55 + prestige/2 + 5 × stars + rng.range(−6, 6)), 60, 99)}`. May 5: each has `seniorLeaveP .4` to leave and be redrawn.
- [ ] Coach stars drift: +1 after a bowl win or an undefeated regular season (cap 5); −1 after two straight losing seasons (floor 1). Offseason (Dec 9 – Aug 7): `candidates` = 3 `{name from data.coaches (not the current), stars: clamp(round(rng.gauss() + prestige/20 + 1), 1, 5), quote, rep}` drawn on Dec 9. `hireCoach(idx)`: requires `coaching ≥ 300000 × stars` and `cash ≥ 100000 × stars` → charge the signing fee (`coaching` key), replace `coach` (`hiredYear`), `coach:changed`. `fireCoach()`: `$500k` buyout (`coaching`), waived when `rivalryLossStreak ≥ 3` ("the boosters pay"); opens the hire card at once (ui). **Tier 2 #6** for the UI; the functions exist in Tier 1 (cheap).

**Win probability (§8)** — `winProb(state, oppKey, night, home)`:
- [ ] `P = 1 / (1 + 10^((opp − team − homeAdv)/25))` where `opp` = the entry's `oppRating` (or the base rating if not on the schedule) `− 5` when `venue === 'stadium3'`; `homeAdv = home ? (night ? 14 : 6) : 0`; `team = sports.rating + (tigerHabitat && home ? 5 × 100 × 0 : 0)`: the Habitat's "home win +5%" is **`P += .05` when home** (clamped ≤ .99; decision). Test: 78 vs 78 at home night → `1/(1+10^(−14/25)) = 0.7834`; day → `0.6355`.
- [ ] Words: `P < .35 'Underdog'`, `< .65 'Even'`, else `'Favored'` (the Season panel prints `Underdog · 12%`).

**Score model (§8; one generator)** — `simGame(state, gameIndex)` and the set piece share `M._generate(P, P2, r)`:
- [ ] At kickoff `r = rng.sim.float()`; `home` wins iff `r < P` (the decided winner, `decided`). Per quarter (4) per side: `k ∈ {0, 3, 7, 10}` with weights `[0.45 − 0.25s, 0.20, 0.25 + 0.15s, 0.10 + 0.10s]`, `s` = `P` for home, `1 − P` for away (after halftime `P2`/`1 − P2`). Draw with `rng.sim` in a fixed order: home Q1, away Q1, home Q2, …
- [ ] After Q4: if the score contradicts the decided winner or is tied, the winner gets one more play: `+7` if it trails by more than 3 (or tied? tied → `+3`), else `+3`; shown as a walk-off (`game:score` with `quarter: 5`).
- [ ] Starter stat line for the recap (ticker line 60): QB/RB/WR → `yards = 60 + 9 × homePts`, `TDs = floor(0.6 × homePts / 7)`; LB → `tackles = 6 + floor(awayPts / 3)`; `stat` string: `'{yards} yds, {TDs} TD'` / `'{tackles} tackles'`.
- [ ] Off-screen games (away, club, auto-sim without the montage? no — auto-sim uses the montage) run the whole generator in one tick on the game day and post the ticker (43/44) and the result; `$20k` for club games only.

**Home game day (§8 set piece; ARCHITECTURE §5.9)** — on a home date (`flags.newDay && entry.day === day && entry.home && !played`):
- [ ] If a storm's landfall is today or tomorrow (`storms.current` with `landfallDay − day ≤ 1` and not `playThroughIt`) → `postpone(gameIndex)`: `postponedTo = −1` pending; a makeup within 5 days after `storm:passed` (`scheduleMakeup(gameIndex, day)` chooses the first day ≥ passed day with no other game; if within 5 days of the original date it is the **Resilience Bowl**: `kind:'makeup'`, `+4 prestige` on completion if the venue's `effective > 0` (`resiliencePrestige 4`)).
- [ ] Else if `sports.autoSim && progress.setPieceSeen('game')` → `session.startSetPiece(state, 'montage', {len: 50, skippable: true})`; else `session.startSetPiece(state, 'game', {len: 750, skippable: progress.setPieceSeen('game')})`. `playHome()` (debug) starts one for the next unplayed home entry (or an ad-hoc game vs `redstick` if none).
- [ ] On start: `game = {day, opp, r, P, P2: P, home: true, night, quarter: 0, scores: [[0,0,0,0],[0,0,0,0]], homePts: 0, awayPts: 0, decided: r < P, wentForIt: false, swing: 0, attendance, revenue: 0, playThrough: storms.playThroughIt, halftimeAnswered: false}`; `agents.gameDayBuses(true)`; scripted sky: `weather.scriptSky(GOLDEN, t/200)` over ticks 0–200, `DUSK` at 200–300, `NIGHT` from 300 (day games: `DAY` throughout; Bayou Field never night).
- [ ] Timeline (ticks of `state.setPiece.tick`): 0–200 tailgate (`wildlife` reads `state.sports.game` for the +6 parking attractor); **200** `game:kickoff`; 200–600 four quarters of 100 ticks: the quarter's scoring plays are pre-drawn at kickoff (the generator returns per-quarter `k` per side); each nonzero `k` fires `game:score` at a fixed offset within the quarter (home at +30, away at +70 ticks; if both score the same quarter, home first) — the generator is called **once** at kickoff for Q1–Q2 and once after the halftime decision for Q3–Q4 (with `P2`); **400** `game:halftime` + `ui.decision(state, {id:'halftime', text: 'Down 14–7 · Favored 38% · Go for it: second half ±8 rating (underdogs like it) · −2 spirit if it fails', yes:'Go for it', no:'Play safe', ticks: 80})` — **no `onAnswer`**: the answer arrives only through `decision:closed{id:'halftime', answer}` (D43), handled once thanks to `game.halftimeAnswered`; text built from the live half score and `P`; **sports enforces the timeout** at tick 480 via `ui.answerDecision('halftime', 'default')` if unanswered (idempotent in ui); **600** final: `game:final{won}`, revenue posted (`economy.post('athletics', attendance × (ticket + 12))`, `economy.post('tailgate', tailgate)`), `record` update, ticker 43/44 and 60, spirit (`homeWinsThisSeason`), fireworks are render's; **700** exit stream; **750** end (session). `skipToFinal()` allowed at `tick ≥ 200` when `setPieceSeen('game')`: resolves halftime by default (if not yet answered), draws the second half, jumps to tick 600 processing, then sets `setPiece.tick = 749`.
- [ ] `halftime(goForIt)`: returns immediately if `game.halftimeAnswered` is already true, else sets it true (one `rng.sim` draw for `swing`, one `P2`, one ticker 61 — never twice); if `goForIt`: `swing = (rng.chance(.5) ? 1 : −1) × rng.range(0, 8)`, `P2 = winProb(team + swing)`, `decided = r < P2` (same `r`), `wentForIt = true`; score bug text "Coach {name} is going for it, +5" (ticker 61); if the game is then lost → `progress.addTimer('goForIt', −2, 10)`. Play safe: `P2 = P`.
- [ ] Montage (`kind:'montage'`, 50 ticks): kickoff at 5, four score ticks at 10/20/30/40, halftime toast compressed to 30 ticks at 20 (default play safe), final at 45; same generator; the previous speed is restored by session at the end.
- [ ] Attendance (§8): `fanbase = students × 2.5 + alumni × .6 + prestige × 300`; `hype = .7 + .4 × winPctLast4 + (rivalry || homecoming ? .3 : 0) + (night ? .15 : 0) − (raining ? .1 : 0)`; `attendance = floor(min(seats, fanbase × hype) × ticketMult[ticket] (25: 1.15, 35: 1, 60: .85) × (1 − damage%)` (the venue's `1 − hp`) `)`; revenue `attendance × (ticket + 12)`; tailgate `3 × attendance × min(3, 1 + .5 × greekWithin8) × (1 + timerValue('voiceTailgate'))` under `permits === 'paid'`, 0 under `'free'`. Rain: ponchos are render's; `−10%` attendance is the `hype` term.
- [ ] Rivalry (§8): beating Magnolia → `economy.bump('prestige', 3)`, `progress.addTimer('rivalryDonations', 1.3, 10)`, spirit +6 for 7 days (economy's `rivalryTimer`: add `progress.addTimer('rivalrySpirit', 6, 7)` — **add `rivalrySpirit` to HAPPY_IDS** (economy reads it as `spirit`, not `events`; economy's brief lists `spirit = … + (rivalryTimer ? 6 : 0)` → implement as `timerValue('rivalrySpirit')`), `rivalryLossStreak = 0`, `progress.achieve('geauxBeatMagnolia')`; losing → `rivalryLossStreak++`; 3 straight → newsflash "Fire the coach" (ui notify) and the buyout waiver.
- [ ] Season end Dec 8: `record` final; bowl if `wins ≥ 5` (Dec 8 neutral site, off-screen or as a home-style set piece? **off-screen** in Tier 1 — Tier 2 #6): won → `economy.post('athletics', 1500000)`, `bump('prestige', 5)`, `bowlWon`; lost → `500000`. `lastSeason = {wins, losses, bowlWon, undefeated: wins === 7 && losses === 0}`; undefeated → `progress.achieve('undefeated')` (progress adds `undefeatedDonations`); emit `season:end`; `record.last4` kept for `winPctLast4` across seasons.
- [ ] Objectives/milestones are progress's: it listens to `game:final`, `season:end` (`bayouField` on the first home game, `nightFalls` at the first Stadium II night kickoff, `undefeated`, `sunbather` via `gator:incident{kind:'field'}` on a game day).
- [ ] Play Through It (§8): `offerPlayThrough(state)` — **weather is the only caller** (its T−1 bands step, when a home entry is today and `forecastCat ≤ 1`; sports does not subscribe to `storm:bands`): `ui.decision(state, {id:'playThrough', text:'Bands tonight. Play through it?', yes:'Play Through It', no:'Postpone', ticks: 80})` (no `onAnswer`) and enforce its own timeout 80 ticks later via `ui.answerDecision('playThrough', 'default')`; the answer arrives only as `decision:closed{id:'playThrough', answer}`: yes → `weather.setPlayThrough(state, true)`, the game runs inside the bands (`game.playThrough = true`; render reads `state.sports.game.playThrough`), `progress.addTimer('playThroughIt', −10, 10)`, gators guaranteed at the tailgates (`wildlife` reads `state.sports.game.playThrough`), `+3 prestige` "legend" on a win; no/default → `postpone`.
- [ ] Scripted night game (§10.4): `startNightGameScript(day)`: `scriptedNightDay = day`, `weather.suppressRainOn(day)`, the entry's `night = true`; progress calls it when Stadium II completes for the first Sep/Oct home entry after completion; at that kickoff `progress.achieve('nightFalls')` (progress listens to `game:kickoff` with `night && stadium2`).

### Tier 2 (cut #6, in order)

- [ ] Sugar Cane Bowl as a watchable game; ticket tier UI (the multiplier is Tier 1 data); coach hire/fire UI (functions are Tier 1); the recruiting card (`recruit` struct: Aug 5 when a stadium exists: `price ∈ {'$200k NIL fund', 'a Greek Row House within 8', 'a Rec Center', 'a Residence Tower'}`, `answerRecruit(accept)` → next season one starter at rating 95 at `pos`); Homecoming budget card (`setHomecomingBudget` → progress adds `homecomingBudget` +3/+6 and economy charges); tailgate-permit toggle (`setPermits`; economy's `freePermits` timer).
- [ ] The Bayou Brass halftime march and the pump-in are sprites/render.

## 5. Edge cases and invariants

- `P, P2 ∈ (0, 1)`; scores are non-negative integers; the final never contradicts `decided`.
- A season with no team: `schedule = []`, `rating = 0`, nothing fires.
- Team created mid-season: schedule the remaining dates only; a team created after Dec 8 waits for next Aug 5.
- Two games cannot overlap: a makeup is scheduled on a free day; if none exists within 5 days, the game is cancelled (`played:true, result:null`).
- Set pieces: the game set piece freezes the calendar; `game` is saved (a save mid-game resumes at `setPiece.tick`; the pre-drawn quarter plays are stored in `game.scores` as **planned** points per quarter with a `revealed` mask — store `game.plan = [[h1,h2,h3,h4],[a1,a2,a3,a4]]` and reveal into `scores`).
- Headless: `ui.decision` exists against the stub; the halftime timeout is enforced by sports at tick 480 so `tick(n)` never stalls.
- Determinism: every draw via `rng.sim` in a fixed order; opponent noise drawn at schedule build.
- Load (`reset(state, false)`): nothing to rebuild; `candidates` saved; never draw `rng.sim` in `reset` (also not when `fresh === true` — the season is drawn on Aug 5 in `tick`).
- No state on the module object (D46): `BSU.sports` carries functions only.

## 6. selfTest() requirements

Private `BSU.newState(8)` with `M._deps` stubs (`buildings`, `economy`, `progress`, `weather`, `session`, `ui`, `agents`); `M._deps.emit` replaced by a recorder for the duration (restored in `finally`) — never emit on the live bus (§10.6); assertions with `BSU.assert` (the harness sets `BSU.SELFTEST`).

1. `winProb`: team 78, opp 78, home night → `0.78 ± 0.01`; home day → `0.64 ± 0.01`; team 50 vs 78 home day → `0.12 ± 0.01`; away → `homeAdv 0`.
2. Score generator: over 200 games with `P = .7` and `rng.sim` seeded, the home side wins exactly the games where `r < P` (never contradicts `decided`); every quarter score ∈ {0,3,7,10}; ties never remain after the walk-off; the home win share is within .62–.78.
3. Rating: field + coaching 1,000,000 + prestige 40 + happiness 70 + coach 2★ + starters mean 75 → `20 + 5 + 10 + 10 + 7 + 0 + 0 = 52`; coaching cap 30 at $3M; starters clamp −3…+5.
4. Attendance: students 690, alumni 0, prestige 16, winPct .5, day, ticket 35, Bayou Field → `fanbase 6525`, `hype .9`, `min(6000, 5872)` = 5872 → revenue `5872 × 47 = 275,984`.
5. Schedule build: 8 entries incl. Magnolia on Nov 8 home; 7 distinct opponents; dates strictly increasing; `night` false when the venue is Bayou Field.
6. Halftime go-for-it: with `r = .5, P = .4` (decided away) and a forced `swing = +8` making `P2 = .6` → `decided` becomes home; play safe keeps `P2 === P`.
7. Starter stat line: homePts 28 → QB `312 yds, 2 TD`; awayPts 17 → LB `11 tackles`.
8. Starters: 3 drawn with positions QB / RB|WR / LB and ratings within 60–99; May 5 redraw leaves 0–3 replaced.
9. Bowl eligibility: wins 5 → bowl entry added on Dec 8; wins 4 → not.
10. Rivalry loss streak: 3 losses → `rivalryLossStreak === 3` and `fireCoach` cost 0.
11. Halftime idempotence: with a game at tick 400, calling the `decision:closed{id:'halftime', answer:'yes'}` handler twice draws `rng.sim` exactly once and records ticker 61 once (`game.halftimeAnswered === true` after the first).
12. `typeof BSU.sports.game === 'undefined'` (no accessor exists).

## 7. Testing in isolation

```js
// scratch/test_sports.mjs
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true; const ctx = vm.createContext(win);
const load = f => vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
load('contract.js'); load('data.js');
vm.runInContext(`
  const field = { id: 0, type: 'practice_field', tx: 10, ty: 10, w: 4, h: 3, built: 1, tier: 1, hp: 1 };
  BSU.buildings = { has(s,t,min=0){ return t==='practice_field' && field.tier>=min; }, count(){ return 0; }, get(){ return field; }, list(s,t){ return t==='practice_field'||!t ? [field] : []; }, effective(){ return 1; }, stats(){ return {}; }, footprint(){ return BSU.footprintTiles(10,10,4,3); } };
  BSU.economy = { post(s,k,a){ console.log('post', k, a); }, charge(){ return true; }, bump(s,st,d){ console.log('bump', st, d); } };
  BSU.progress = { timers(){ return []; }, timer(){ return null; }, addTimer(s,id,v,d){ console.log('timer', id, v, d); }, setPieceSeen(){ return false; }, achieve(s,id){ console.log('achieve', id); }, earned(){ return false; }, ticker(s,l,f){ console.log('ticker', l, JSON.stringify(f)); } };
  BSU.weather = { date(s){ const d=s.calendar.day; return {day:d, year:Math.floor(d/120)+1, month:Math.floor(d/10)%12+1, dom:d%10+1}; }, isDate(s,str){ return BSU.dateToDay(str, Math.floor(s.calendar.day/120)+1)===s.calendar.day; }, dayOf(s,str){ return BSU.dateToDay(str, Math.floor(s.calendar.day/120)+1); }, raining(){ return false; }, storm(){ return null; }, scriptSky(){}, releaseSky(){}, suppressRainOn(){}, setPlayThrough(){}, heat(){ return {advisory:false}; } };
  // halftime answers come back only as decision:closed — the scratch resolves the toast itself: BSU.events.emit(BSU.EV.DECISION_CLOSED, {id:'halftime', answer:'no'}) 80 ticks after the 'toast' log line
  BSU.session = { startSetPiece(s,k,o){ s.setPiece = {kind:k, tick:0, len:o.len, skippable:!!o.skippable, choices:{}, speedBefore:1, cameraTouched:false}; } };
  BSU.ui = { decision(s,spec){ console.log('toast', spec.id, spec.text); }, answerDecision(){}, notify(){} };
  BSU.agents = { gameDayBuses(){} }; BSU.wildlife = {};
`, ctx);
load('sports.js');
const BSU = win.BSU; const s = BSU.newState(8); s.economy.students = 690; s.economy.prestige = 16; s.economy.happiness = 62;
BSU.sports.init(s); BSU.sports.reset(s, true);
BSU.events.on(BSU.EV.GAME_FINAL, p => console.log('FINAL', p));
s.calendar.day = BSU.dateToDay('Aug 5', 1) - 1;
for (let t = 0; t < 13000; t++) {
  const newDay = t % 100 === 0; if (newDay) s.calendar.day++;
  BSU.sports.tick(s, { newDay, newMonth: false, newYear: false, day: s.calendar.day });
  if (s.setPiece) { if (++s.setPiece.tick >= s.setPiece.len) { const k = s.setPiece.kind; s.setPiece = null; BSU.events.emit(BSU.EV.SETPIECE_END, {kind:k, len:0}); } }
  s.tick++;
}
console.log('record', s.sports.record, 'last', s.sports.lastSeason, BSU.sports.selfTest());
```
Expect a schedule built on Aug 5, a set piece per home date with kickoff/score/halftime/final, off-screen away results, a season end on Dec 8.

## 8. Performance budget

`tick` ≤ 0.3 ms (daily work; set-piece ticks are a table lookup); the generator is trivial. No per-tick allocation outside set-piece events.

## 9. Done means

- `selfTest().ok`; the isolation run plays a full season with 4 home set pieces and the bowl decision.
- Full build: a `skipTutorial` game on seed 42 with a Practice Field + Bayou Field placed by June plays a real Aug 8 home game; Célestine postpones Sep 8 and the makeup is the Resilience Bowl; the halftime toast opens in Chrome and defaults after 8 s; the Season panel's rating lines sum to `sports.rating`; `game:score` produces the crowd pulse/brass sting/shake in render/audio.
- `test/smoke.mjs` unaffected by sports (no team) and unaffected by a game set piece when one occurs during `tick(12000)` with a placed field.
