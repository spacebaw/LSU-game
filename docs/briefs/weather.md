# Brief: `src/js/weather.js` → `BSU.weather`

Read first: `docs/ARCHITECTURE.md` §1 (row 4), §2.1 (`setPiece`), §2.4 (`calendar`, `sky`, `weather`), §2.5 (`storms`, the `Storm` struct), §3.1 (`BSU.SKY`, `BSU.SKY_TICKS`, `BSU.STORM`, `BSU.STORM_PHASE`), §3.2 `params.time/storm/weather/heat/hydro.rain`, §3.4 events, §5.1 steps 0–1 and the "Calendar freeze" paragraph, §5.4 (this module's API, the landfall timeline, the Célestine hold rule), §9.3–9.5 (`startSetPiece`, `forceHurricane`), §12.3 (the walkthrough), §5.6/§5.8 (`shelterAssignments` → `agents.shelter`), §5.9 (`offerPlayThrough`), §10.5–10.6, D4, D5, D7, D13, D14, D22, D37, D41, D43, D49, D51; `docs/GDD.md` §0.1, §6.1.2 (rain table), §6.2 (all: lifecycle, prep actions, landfall table, surge heights, wind damage, storm names), §6.6 (heat), §6.9 (Spring High Water), §9 (all), §10.3 (Célestine), §10.4 (scripted night game: the rain suppression half), §14.3 (festival dates).

---

## 1. Purpose and public surface

The clock and the sky. `weather.tick` runs **first** every sim tick: it advances the sky cycle, advances the calendar when it is not frozen (emitting the day/month/semester/year/date events **before returning**), decides `state.weather.dtDay` for this tick's hydro step, and on new days runs the rain scheduler, heat, wind, fog, the river-stage schedule, festival start/end and the storm lifecycle. It owns the landfall and near-miss set-piece timelines (D13) and the four decision toasts, drives `hydro.surgeControl`, and is the **one storm factory** (`spawnStorm`) for the debug panel and `BSU.headless.forceHurricane`.

```js
BSU.weather.init(state)            // subscribe (owner 'weather'): decision:closed (toast answers), setpiece:end (release sky), building:complete (Coastal Institute changes cone lead for FUTURE storms only)
BSU.weather.reset(state, fresh)    // both cases: rebuild private caches (timeline index, lastDay, rainAt cache). ONLY when fresh === true: draw the Year-1 rain days from rng.sim, set calendar.running = false (skipTutorial: session sets true right after). When fresh === false (load): draw NOTHING and leave calendar.running/rainDays/storms untouched (D37 — a draw on load would desync rng.sim after every load)
BSU.weather.tick(state) → {newDay, newMonth, newYear, newSemester, day}
BSU.weather.date(state) → {day, year, month, dom, str, season, semester}
BSU.weather.isDate(state, 'Aug 5') → boolean
BSU.weather.dayOf(state, 'Aug 5', yearOffset = 0) → number     // absolute day of that date in the current year + offset
BSU.weather.sky(state) → {phase, t, phaseTick, scripted}
BSU.weather.scriptSky(state, phase, t) → void
BSU.weather.releaseSky(state) → void
BSU.weather.rainAt(state, tx, ty) → number   // 0–1 local intensity this tick
BSU.weather.raining(state) → boolean
BSU.weather.heat(state) → {index, advisory, wave}
BSU.weather.wind(state) → {speed, angle}
BSU.weather.storm(state) → Storm | null
BSU.weather.cone(state) → null | {track, width, point, landfallDay, cat, forecastCat}
BSU.weather.forecastSurge(state, catOverride?) → number
BSU.weather.spawnStorm(state, {cat, nearMiss = false, coneNowTick, landfallTick, compressed: boolean /*REQUIRED*/, name?}) → Storm   // compressed:true = tick-driven (debug/headless), false = day-driven (Célestine, the schedule); D51
BSU.weather.scheduleNearMiss(state, day, name) → void
BSU.weather.setPlayThrough(state, on) → void
BSU.weather.prepAction(state, action, arg) → {ok, cost, reason}   // 'boardUp'|'sandbags'|'repairAll'|'evacuate'|'preDrain'|'spillway'
BSU.weather.answerToast(state, id, answer) → void
BSU.weather.skipSetPiece(state) → void
BSU.weather.riverStage(state) → {river, bayou, window}
BSU.weather.queueCell(state, {day, cx, cy, inches, scripted}) → void
BSU.weather.suppressRainOn(state, day) → void
BSU.weather.setRunning(state, on) → void
BSU.weather.consumeRainStep(state) → {r, cx, cy, radius, mapWide} | null
BSU.weather.closeReport(state) → void        // ui calls when the damage-report card closes → emits storm:passed (headless: called internally at set-piece tick 900)
BSU.weather.jamGate(state, i) → void         // debug
BSU.weather._openToast(state, id) → void     // debug/progress.fireAllToasts: opens one of the four landfall toasts with its real handler outside a set piece (answerToast still applies the effect)
```

## 2. State fields

**Writes (owner):** `state.calendar` (all), `state.sky` (all), `state.weather` (all), `state.storms` (all, including the live `Storm` struct and `storm.damageReport` which it fills from `buildings.damageReport`). `Storm.rolls` and `jammedGates` are decided here at set-piece tick 150 (buildings applies `rolls`; hydro mirrors `jammedGates` through `setJammed`).

**Reads:** `state.tick`, `state.setPiece` (kind, tick — session owns it), `state.playSeconds`, `buildings.has('coastal_institute')` (cone lead), `buildings.damageReport`, `buildings.boundaryLevees(H)`, `buildings.list('generator'|'water_tower'|…)`, `hydro.networks` (jammable gates), `progress.offered('11')`, `progress.setPieceSeen('landfall')`, `sports.upcoming` (Play Through It offer, Years 2+ scheduling collisions), `economy.students` (evacuate cost), `wildlife.ecology` (nothing here — no).

Private (closure, rebuilt in `reset`): `lastDay`, the landfall timeline hook table, the current set piece's local bookkeeping (`toastsOpened`, `preSetPieceCycleTick`), a per-tick `rainAt` cache (event center/radius). `M._deps = {emit: (n, p) => BSU.events.emit(n, p), …}` — **every emit in this module goes through `M._deps.emit`** so `selfTest` can record instead of broadcasting (§10.6). No state on the module object (D46).

## 3. Events

**Emits:** `calendar:day{day,year,month,dom}` → `calendar:date{date,day}` → `calendar:month{day,year,month}` (dom 1) → `calendar:semester{day,semester}` (Jan 5, May 6, Aug 5, Dec 11) → `calendar:year{year}` (Jan 1) — in that order, all inside `tick` before it returns; `sky:phase{phase,prev}`; `weather:rain{kind,total,start}`; `weather:cell{cx,cy,radius,total,scripted}`; `weather:lightning{tx,ty}`; `weather:heat{index,advisory,wave}` (daily); `storm:wave/named/watch/bands/landfall/passed{name,cat,forecastCat,nearMiss,landfallDay,point}`; `storm:phase{phase,t}`; `storm:pulse{n,share}`; `storm:toast{id,text,yes,no,untilTick}`; `storm:report{report}`; `festival:start/end{id,day}`; `speed:*` are session's (call `session.setSpeed`), `setpiece:*` are session's (call `session.startSetPiece`).

**Listens (owner `'weather'`):** `decision:closed{id, answer}` (for ids `sandbag|shelter|fuel|gate` → `answerToast`; **this is the ONLY delivery of a toast answer** (D43) — weather passes no `onAnswer` (ui opens the toast on `storm:toast`) and `answerToast` is idempotent: it returns at once when `setPiece.choices[id]` is already set), `setpiece:end{kind}` (landfall/nearMiss cleanup if session ended it), `building:complete{type:'coastal_institute'}` (nothing immediate).

## 4. Rules checklist

### Tier 1

**Calendar (GDD §0.1, §9.1; ARCHITECTURE §2.4, D4)**
- [ ] Constants from `params.time`: 100 ticks/day, 10 days/month, 12 months, 120 days/year. `day` is absolute (0 = Jan 1 Y1). `year = floor(day/120)+1`, `month = floor(day/10)%12+1`, `dom = day%10+1`, `season`: months 3–5 spring, 6–8 summer, 9–11 fall, 12/1/2 winter; `semester`: Jan 5–May 5 `'spring'`, May 6–Aug 4 `'summer'`, Aug 5–Dec 10 `'fall'`, Dec 11–Jan 4 `'break'` (compute from `day % 120`: spring 4..44, summer 45..93, fall 94..129? no — Dec 10 is day-of-year 119 (`Dec` = month 12 → days 110–119; Dec 10 = 119); fall = 94..119? Aug 5 = (8−1)×10+4 = 74. So: spring 4–44, summer 45–73, fall 74–119, break 0–3 and 120 wraps to 0. Write the table as `dayOfYear` ranges and test it.)
- [ ] `frozen = !running || state.setPiece !== null` — **session** computes and writes `calendar.frozen` at step 0; weather reads it (do not recompute differently).
- [ ] When not frozen: `dayTick++`; at 100 → `dayTick = 0`, `day++`, recompute year/month/dom/season/semester, emit the day events in order, run the daily steps, return `{newDay:true, newMonth: dom===1, newYear: dayOfYear===0, newSemester, day}`. When frozen: `dayTick` unchanged, return all-false flags with the current `day`.
- [ ] `setRunning(state, on)` writes `calendar.running`. `skipTutorial` → session calls `setRunning(true)` at tick 0.
- [ ] `date().str` = `BSU.formatDate(day)` → `'Sep 3, Y1'`. `dayOf('Aug 5', k)` = `BSU.dateToDay('Aug 5', year + k)`. `isDate(s)` = `day === dayOf(s)`.

**Sky clock (D5; GDD §0.1, §9.1)**
- [ ] `cycleTick` advances every tick that is **not paused** — session only calls `tick` when time passes, so: advance every call unless `sky.scripted`. Phase boundaries from `BSU.SKY_TICKS = [25,130,20,25,100]` (cumulative 25, 155, 175, 200, 300); `phase`, `phaseTick`, `t = phaseTick / SKY_TICKS[phase]`; emit `sky:phase{phase, prev}` on change. Cycle wraps at 300.
- [ ] `scriptSky(phase, t)`: `sky.scripted = true`, write `phase`/`t`/`phaseTick = round(t × SKY_TICKS[phase])`, emit `sky:phase` on a change. `releaseSky`: `scripted = false`, restore `cycleTick` from the value captured when scripting began (`preSetPieceCycleTick`, captured on the first `scriptSky` after a `setpiece:start`), recompute phase.
- [ ] The landfall script: `scriptSky(DAY, 0.5)` at tick 0 with the storm tint driven by render from `storm:phase`; eye phase (Cat 3+, ticks 450–500): `scriptSky(GOLDEN, 0.5)`; clearing (750+): `scriptSky(GOLDEN, 0.2)`. Near-miss: no scripting. Game/parade/graduation are scripted by sports/progress.

**Rain scheduler (GDD §9.3, §6.1.2; `params.weather`, `data.rainKinds`)**
- [ ] On Jan 1 (and in `reset(state, true)` — never in `reset(state, false)`) draw `weather.rainDays` for the year: for each day of the year, rain with `rainP[month−1]`; kind: months Oct–Mar (10,11,12,1,2,3): `'frontal'` with `frontalShare .3` else `'shower'`; months Apr–Sep: `'cell'`. All from `rng.sim`.
- [ ] On a new day: if the day is in `rainDays` and not suppressed (`clearNightDay`) and no event is active: **shower/frontal** → `event = {kind, total (0.04 / 0.125), steps: 40, stepsLeft: 40, cx: −1, cy: −1, radius: 0, lightning: false, scripted: false}`, emit `weather:rain{start:true}`. **cell** → queue the cell for the second half of today's Day phase: push to `cellQueue` `{day, cx, cy, total: rng.range(1,3)/12 ft (1–3 in uniform), scripted:false}` with a random position in the south-west third (`cx ∈ [4, 24]`, `cy ∈ [40, 60]`).
- [ ] Every tick: if a `cellQueue` entry has `day === today` and `sky.phase === DAY && sky.t ≥ cellStartPhaseFrac (0.5)` (or immediately if past Day) and no event is active → `event = {kind:'cell', total, steps: 60, stepsLeft: 60, cx, cy, radius: 14, lightning: rng.chance(.1) (scripted: true once), scripted}`; emit `weather:cell{cx,cy,radius,total,scripted}` and `weather:rain{kind:'cell',total,start:true}`. Drift: every `cellDriftTicks (10)` ticks `cx += 1, cy −= 1` (NE = +tx, −ty on this map; decision, matches "drifts NE"). Lightning: while a cell with `lightning` is active, every 80 ticks emit `weather:lightning{tx,ty}` at a random tile within the radius.
- [ ] `consumeRainStep(state)` (D14): if `event` null → `null`; else `r = event.total / event.steps`; `stepsLeft−−`; if `stepsLeft === 0` → emit `weather:rain{kind,total,start:false}` and `event = null` **after** returning this step's value (return the object first, clear on the next call — simpler: compute the return object, then if `stepsLeft` hit 0 clear `event` and emit, then return the object). Return `{r, cx, cy, radius, mapWide: radius === 0}`. Hurricane/band events are map-wide.
- [ ] `rainRate` written every tick for FX: 0 none; shower .25; frontal .4; cell: 1 at the center falling to 0 at the radius (`rainAt`); band .6; hurricane 1. `rainAt(tx,ty)` = for map-wide events the kind's rate, for a cell `max(0, 1 − dist/radius)`.
- [ ] Cells are timed in calendar days (60 steps = 1.5 days at `dt 1/40`); the event persists across the day boundary; a new rain day cannot start while one is active (skip it).
- [ ] `suppressRainOn(day)`: `clearNightDay = day` — that day draws no rain and its queued cells are dropped.
- [ ] `queueCell(state, {day, cx, cy, inches, scripted})` pushes `{day, cx, cy, total: inches/12, scripted}`; the Apr 5 scripted cell: progress queues it for `dayOf('Apr 5')` centered on `plot.mouth[1]`'s cove center with 3 in; the day before, progress calls `hydro.forceSat(cove tiles, 0.7)`.

**Heat, wind, fog (GDD §6.6, §9.3; `params.heat/weather`)**
- [ ] Daily: `heat = monthBase[month−1] + rng.range(−6, 6) + (rainedYesterday ? 3 : 0)`; `advisory = heat ≥ 100`; `heatWaveDays = advisory ? +1 : 0`; `wave = heatWaveDays ≥ 3`; emit `weather:heat`.
- [ ] Wind: `wind = rng.range(0, .3)` daily; during a storm lifecycle: WATCH `.4`, BANDS `.5`, landfall script `0.6 → 0.9` over ticks 0–150 then `0.9`, back half `.7`, clearing `.3`; near-miss `.5`. `windAngle` = from the storm's entry direction (`'S'` → rain slants from the south: angle `π/2 + rng.range(−.3,.3)`), else random daily.
- [ ] Fog: on 40% of Dawns in months 11,12,1,2: `fog = 1` for `fogTicks (20)` then 0 (fade is render's).

**Spring High Water (GDD §6.9; Year 2+)**
- [ ] Jan 1 of Year ≥ 2: `weather.riverStage = pick(1: .45, 2: .35, 3: .20) + (rainDays in the previous Nov–Jan > 12 ? 1 : 0)`, cap 3. Year 1: 0.
- [ ] Daily from Apr 1 to May 10: stage ramps 0 → `riverStage` over Apr 1–5 (linear by day), holds, ramps back 0 over May 6–10; `hydro.setStages(state, river, 0.5 × river)`. Outside the window `setStages(0, 0)` once (on May 11 and at reset). `riverStage()` → `{river, bayou, window}`.
- [ ] Seepage: daily in the window, `hydro.forceSat(state, hydro.riverAdjacent(state, 6), 0.8)` (sets `sat = max(sat, .8)`).
- [ ] Mar 25 (Year ≥ 2): ticker line via `progress.ticker(state, 'The Big Muddy is at {stage} ft and rising. Levee Board ‘monitoring.’', {stage})` (raw text, kind `water`). Weather chip `"River +N ft"` is ui's (reads `riverStage()`).
- [ ] `spillwayUsedYear`: `prepAction('spillway')` allowed once per year during a 2–3-ft window with an Engineering Hall (Year ≥ 3): charges $250k via `economy.charge`, calls `hydro.spillway` (Tier 2 in hydro; the action returns `{ok:false, reason:'Not yet'}` until hydro implements it).

**Storm lifecycle (GDD §6.2, §10.3; ARCHITECTURE §2.5, §5.4)**
- [ ] `Storm` struct exactly as ARCHITECTURE §2.5. Names from `data.stormNames[storms.nameIndex++]` (wrap at 26); Year 1 is scripted: Amélie (near-miss, index 0), Boudin (ticker-only wave, index 1, Aug 1), Célestine (index 2). Years 2+ continue from index 3 ("Delphine").
- [ ] **Year 1 fixed script:** `Aug 1`: ticker line 2 with the wave text (Boudin) — no Storm struct. Amélie: `scheduleNearMiss` is called by progress (Jul 2 or the day after Objective 11 completes, Jul 20 at the latest); weather then runs the near-miss pass on that day. Célestine: the hold rule.
- [ ] **Célestine hold rule** (`storms.celestine`): `{state:'pending', coneDay:−1}` at start. On each new day in Year 1 from Sep 2 (dayOfYear ≥ 81), and on every new day thereafter while `state !== 'done'`: if `state.playSeconds ≥ params.storm.celestine.minPlaySeconds (540)` **and** `progress.offered('11')` → create the storm now: `spawnStorm({cat: 2, coneNowTick: T, landfallTick: T + 600, compressed: false, name:'Célestine'})` (day-driven: `landfallDay = day + 6`; `tLandfall` is derived when the day arrives, so a game/parade set piece that freezes the calendar between cone and landfall does not drift it — D51), `celestine.state = 'cone'`, `coneDay = day`. If Oct 5 (dayOfYear 94) passes with `state === 'pending'` → `state = 'held'` (ticker: "the Gulf did not check the calendar" when it finally appears). Year-2+ random storms are **suppressed** while `celestine.state !== 'done'`; `done` is set on `storm:passed` of Célestine. `forceHurricane` sets `done` immediately (D22).
- [ ] The landfall point for Célestine: the south-edge tile (`ty = 63`) at `tx = plot.mouth[1] & 63` (below the cove's longitude). Track: 6 points from the point northward toward the cove, for the cone.
- [ ] **Years 2+ schedule (Jan 1, skipped in Year 1 and while Célestine is not done):** count 1/2/3 with weights `.45/.35/.20`; each storm: category from `catWeights [.35,.30,.20,.10,.05]` shifted `catShiftPerYear .05` per year after Year 3 toward severe (move .05 from Cat 1 to Cat 5 per year, Cat 5 capped .20); `nearMiss = chance(.25)`; landfall day uniform in Aug 5–Oct 5 with p .7 else uniform over the rest of Jun 1–Nov 30; constraints: ≥ 15 days apart, never within 6 days of a scheduled set piece (home games from `sports.season().schedule`, Feb 8, May 5) — except the Play-Through-It collision: the first storm after Stadium II exists is placed so its T−1 lands on a home date with forecast cat ≤ 1 (only if such a storm is Cat 1; otherwise skip); redraw a failing draw up to 20 times then drop; landfall point: south edge (70%) or east edge with `ty > 30` (30%). Push `{day, cat, nearMiss, name, point}` to `storms.scheduled` sorted by day. Names assigned at draw time.
- [ ] **Lead times:** `coneDays = buildings.has('coastal_institute') ? 9 : 6` (evaluated when the wave line fires; a storm keeps its lead). Wave at T−(coneDays+2), named/cone at T−coneDays, watch at T−3, bands at T−1, landfall at T0. Each transition happens in the new-day step when `day === landfallDay − k`: `phase` set, event emitted, ticker lines (2 wave; 39 cone-narrowing on T−3), `coneWidth` shrinks linearly 24 → 6 over the cone days (×0.7 with the Institute).
- [ ] `spawnStorm(state, {cat, nearMiss, coneNowTick, landfallTick, compressed, name})`: **`compressed` is a REQUIRED boolean option** (D51; `BSU.error` and treat as `false` if it is not a boolean) stored as `storm.compressed` — nothing else distinguishes the two callers. Builds the struct with `coneDay = day`, `landfallDay = day + ceil((landfallTick − T)/100)` (600 ticks → +6 days), `tLandfall = compressed ? landfallTick : -1` (day-driven storms set it on the bands day), `forecastCat = cat + pick(−1,0,1)` clamped 1–5 (Célestine: forecast 2), `surge = params.storm.surge[cat]`, `point` (random per the edge rule, or the Célestine point), `entry` = the 8 edge tiles centered on `point` along its edge, `track`, `coneWidth 24`; sets `storms.current`, phase NAMED, emits `storm:named`. **`compressed: true`** (debug "Spawn Cat N", `headless.forceHurricane`): transitions are driven by **ticks** (`T ≥ tLandfall − 300` watch, `− 100` bands, `≥ tLandfall` landfall) so the smoke test's `tick(4000)` reliably includes the set piece. **`compressed: false`** (the Célestine hold rule, the Years-2+ schedule): transitions on day boundaries by `landfallDay − k`.
- [ ] Watch (T−3): `storm:watch`; sky greenish is render's; gators' `RETREAT` is wildlife's.
- [ ] Bands (T−1; for a compressed storm at `T === tLandfall − 100`): start `event = {kind:'band', total:.33, steps:40, …}` (map-wide, 1 day); `wind .5`; then `BSU.agents.shelter(state, BSU.buildings.shelterAssignments(state))` (below); then **if `const u = BSU.sports.upcoming(state)` is non-null with `u.home && u.day === day` and `storm.forecastCat ≤ 1` → `BSU.sports.offerPlayThrough(state)`** — weather is the only caller (D51); sports opens the `playThrough` toast, acts on its `decision:closed` and calls `weather.setPlayThrough(state, true)` on 'yes'; weather only exposes `setPlayThrough` and reads `storms.playThroughIt` at landfall.
- [ ] Landfall (T0, on the day boundary tick — or the tick `T === tLandfall` for compressed): `session.startSetPiece(state, 'landfall', {len: 900, skippable: progress.setPieceSeen('landfall')})`; phase LANDFALL; `storm:landfall`; `event = {kind:'hurricane', total: rain.hurricane[cat−1]/12 ft, steps: 360, stepsLeft: 360}`; `lastLandfallDay = day`. Sports postpones any home game on this day (`sports.postpone`).

**Landfall timeline (ARCHITECTURE §5.4 table; GDD §6.2)** — a data table of `{tick, fn}` hooks evaluated each tick while `setPiece.kind === 'landfall'` at `setPiece.tick`:
- [ ] `0`: `storm:phase{OUTER, t:0}`; `scriptSky(DAY, .5)`; wind ramp 0.6→0.9 over 150 ticks; `rainRate` 0.33→1 over 150 ticks; lightning every 80 ticks (emit `weather:lightning`).
- [ ] `150`: `storm:phase{WALL}`; **rolls decided** with `rng.sim`: `rolls.towerTopple = cat ≥ 4 && chance(braced ? .1 : .3)` per Water Tower (store as an array of ids that topple: `rolls.towerTopple` boolean for "any" plus `rolls.toppleIds`), `rolls.substationOutages` = ids of substations not on pilings with `chance(boarded ? .2 : .4)` (Cat 3+), `rolls.fenceBreaks` = 30% of fence tiles (Cat 3+, each tile `chance(.3)`), `jammedGates` = each FLOODGATE tile in any network with `chance(.1)` (Cat 3+) → `hydro.setJammed(i, true)`; **toast qualification decided now** (`toasts.*`): `sandbag` = any tile in `buildings.boundaryLevees(surge)` has `integrity < 85` OR (`sandbag === 0` AND `surge ≥ crestTop − 3`); `shelter` = Year 1 always, else only if no other toast qualifies; `fuel` = any generator with `data.fuelDays ≤ 1` that is running (its radius has a blackout — approximate: any generator with `fuelDays ≤ 1`); `gate` = `jammedGates.length > 0`. `hydro.surgeControl('begin', {stage:0, target: surge, entry, dir})`; camera cue: `render.panToTile(entry center)` if `!setPiece.cameraTouched` (call `BSU.render.panToTile` — a presentation call, no-op headless).
- [ ] `150..350`: `hydro.surgeControl('stage', surge × min(1, (t−150)/200))` each tick.
- [ ] `250`: `storm:pulse{n:1, share:1/3}`.
- [ ] `300`: open `sandbag` toast if qualified; open `shelter` toast if qualified and (`sandbag` not opened or Year ≥ 2); if both qualify in Year 1, `shelter` opens at `330`.
- [ ] `350`: `storm:phase{LANDFALL}`; hold stage at `surge`; camera cue `ring` (pan to the first ring tile the front reached: `buildings.boundaryLevees(surge)` nearest to the entry, else the cove) if not touched.
- [ ] `380`: `storm:pulse{n:2, share:1/3}` (buildings plays the tower roll here).
- [ ] `400`: `fuel` toast if qualified.
- [ ] `450`: if `cat ≥ 3`: `storm:phase{EYE}`, `scriptSky(GOLDEN, .5)`, `rainRate = 0`, wind 0.1; `gate` toast if qualified (Cat 3+ only by construction). At `480`: gate crew resolves (if answered yes: 50% caught → mood joke ticker; `hydro.setJammed(i,false)` for all jammed; `hydro.markLeveeChange`).
- [ ] `500`: `storm:phase{BACK}`; `scriptSky(DAY, .5)`; rain back to 1; wind .7; from here `surgeControl('stage', surge × max(0, 1 − (t−500)/250))` each tick (recession over 250 ticks; hydro also retracts the front at 1 tile/4 ticks).
- [ ] `550`: pulse 3 (`share 1/6`); `680`: pulse 4 (`1/6`).
- [ ] `750`: `storm:phase{CLEARING}`; `hydro.surgeControl('end')`; `scriptSky(GOLDEN, .2)`; rain tapers to 0 over 150 ticks; `storm.damageReport = buildings.damageReport(state, storm)` (+ `choices` from the toasts); `storm:report{report}`; ticker line 47.
- [ ] `899` (last tick): session ends the set piece at `tick + 1 ≥ len`; weather on `setpiece:end{kind:'landfall'}`: phase RECOVERY, `event = null` (hurricane rain done), `storms.log.push({name, cat, year, day, nearMiss:false, damage: report.bill, tarps, held: report.breached.length === 0 && report.overtopped.length === 0})`, schedule the T+1 band (`event` band on the next new day), `celestine.state = 'done'` if this was Célestine, and in **headless mode** call `closeReport` immediately. `closeReport`: phase PASSED, emit `storm:passed`, then `storms.current = null` **after** the T+1 band has been queued and the recovery flags handed off (recovery bookkeeping that needs the struct — gator wave, mosquito bloom, disaster grant — is done by wildlife/economy from `storms.log` and `lastLandfallDay`, not from `current`). Decision: `storms.current` is cleared on `storm:passed`.
- [ ] **Toasts:** emit `storm:toast{id, text, yes, no, untilTick: T + 80}` (ui opens `ui.decision` on it — weather never calls `ui.decision` itself and passes no callback) with the texts from GDD §6.2 (`sandbag`: "Cove levee at {integrity}% — emergency sandbag crew, $50k? (+1.5 ft crest through the peak)"; `shelter`: "Founders' gym is full — open the Dining Hall as overflow shelter? (Dining closed 3 days, −$10k)"; `fuel`: "Generator {n} fuel out — refuel $5k?"; `gate`: "Send a crew out to clear the jammed floodgate? Risk: the back half catches them"). ui opens the decision toast on this event; **weather enforces the timeout itself**: at `untilTick` if unanswered → `BSU.ui.answerDecision(id, 'default')` (idempotent; ui may already have resolved it). `answerToast(state, id, answer)`: `sandbag` yes → `economy.charge(50000, 'prep')` then `buildings.sandbags(state, surge)` for the boundary (`sandbagDay = day + 5`; the crest holds through the peak); `shelter` yes → `economy.charge(10000, 'prep')`, `buildings.shelterOverflow(state)` (Dining Hall `closedUntil = day + 3`, +600 shelter for this storm: `storm.shelterOverflow = true`), no `unsheltered` timer this storm; `shelter` no/default → `progress.addTimer('hurricaneParty', 2, 3)` and `economy.attritionBonus += .02` (economy exposes `economy.addAttrition(state, .02)`); `fuel` yes → `buildings.refuel(id)` (charges $5k); no → nothing (its radius goes dark when the generator's fuel hits 0 in buildings' daily step); `gate` yes → resolved at tick 480 (above); record every answer in `setPiece.choices[id]` **first** and return early when it is already set (the idempotence guard: `ui.answerDecision` may deliver a close twice, D43).
- [ ] `skipSetPiece(state)` (landfall, only if `setPiecesSeen.landfall` and `setPiece.tick ≥ 150`): run every remaining hook from the current tick to 750 in order **synchronously** (rolls, toasts resolved by default, surge begin/peak/end through `surgeControl` with a compressed stage schedule: call `'stage'` with the peak once, run 40 hydro relaxation steps via `hydro.tick` with `dtDay = 1/360`? no — set `weather.dtDay = 1/360` and call `BSU.hydro.tick(state)` 90 times to approximate the surge, then `'end'`), then jump `setPiece.tick = 899` so session ends it next tick. Document the approximation.
- [ ] **Near-miss pass** (Amélie and 25% of later storms): on the scheduled day, `session.startSetPiece(state, 'nearMiss', {len: 150, skippable: true})`, phase BANDS only, `event = {kind:'band', total:.33, steps: 60, stepsLeft: 60}` (60 hydro steps at `dt 1/60` = 4 in over one calendar day), wind .5, `storm:bands` emitted with `nearMiss:true`; no cone (a near-miss storm from the Year-2+ schedule gets only a 3-day watch: `storm:watch` at T−3 with `nearMiss:true` and the alert strip); at the end: `storms.log.push({…nearMiss:true, damage:0, tarps:0, held:true})`, `storm:passed`, `current = null`. Amélie's line 62 goes to the ticker at the end.
- [ ] `dtDay` written every tick: `setPiece.kind ∈ {game, parade, graduation, montage}` → 0; `landfall` → 1/360; `nearMiss` → 1/60; else `T % 10 ∈ {0,2,5,7}` ? 1/40 : 0. (Hydro relaxes at `dt 0` only for the four non-storm set pieces; a paused game never reaches `tick`.)
- [ ] `prepAction(state, action, arg)`: requires `storms.current && phase ∈ {NAMED, WATCH, BANDS}` (`reason: 'No storm'` otherwise) except `spillway`; `boardUp` → `buildings.boardUp(state, arg)` (charges); `sandbags` → `buildings.sandbags(state, forecastSurge())` (charges `ceil(n/10) × 10000`); `repairAll` → `buildings.repairAllLevees`; `evacuate` → cost `20000 × ceil(students/1000)`, `economy.charge(cost,'prep')`, `agents.evacuate(state)`, `storm.evacuated = true`, `progress.addTimer('evacuation', −6, 10)`; `preDrain` → `storm.preDrain = true` (hydro doubles pump rate; buildings doubles running cost); returns `{ok, cost, reason}`.
- [ ] Shelter assignment at T−1 (the bands step): `agents.shelter(state, buildings.shelterAssignments(state))` — `shelterAssignments` returns the `{buildingId: capacity}` map of usable shelters and weather forwards it **unchanged**; agents does the per-agent assignment itself (nearest shelter with remaining capacity, agent index order, rng-free — D41). Weather never builds an `{agentId → buildingId}` map.
- [ ] Recovery bookkeeping owned here: T+1 band; the ticker on T+1 (line 47 already at 750); Célestine `done`; the Storm panel's data (`storm()`/`cone()`) while phase ≤ LANDFALL.

**Festivals (GDD §9.2, §14.3; `data.calendar.festivals`)**
- [ ] On the day of each festival's `start`: `festival:start{id, day}`; on the day after `end`: `festival:end`. Ids: `mardiGras` (Feb 6–8), `crawfish` (Mar 1–Apr 10), `graduation` (May 5), `homecoming` (Oct 7–8), `bonfires` (Dec 9 — GDD id `leveeBonfires`; the **event payload id is `'bonfires'`** per ARCHITECTURE §3.4), `foundersDay` (Jan 1, Year ≥ 2). Progress owns the parade and graduation set pieces; economy owns festival revenue; weather only emits the dates.

**Scripted night game (GDD §10.4)**: sports calls `suppressRainOn(day)`; weather also forces `fog = 0` that day.

### Tier 2

- [ ] Coastal Institute "tomorrow's cell on the minimap": expose `weather.tomorrowCell(state) → {cx,cy}|null` (from `cellQueue`).
- [ ] Bonnet Roux Spillway action (with hydro Tier 2).
- [ ] Century Storm (Cat 5 in a home-game week, 5%/yr after Year 8) and opponent scaling are progress/sports; weather only honors `spawnStorm`.

## 5. Edge cases and invariants

- `tick` must never throw: every daily sub-step wrapped in try/catch → `BSU.error('weather', 'daily:<step>', e)`.
- All randomness via `BSU.rng.sim` in a fixed order: Jan 1 draws (rain days, river stage, storm schedule) happen in that order; daily draws (heat noise, wind, fog, cell position) in that order.
- `stepsLeft` has one writer (this module); hydro only calls `consumeRainStep`. If hydro is skipped a tick (`dt 0`) the event simply waits.
- A rain event never starts on a day the calendar did not roll (frozen). A hurricane event is created inside the set piece even though the calendar is frozen (event steps advance with hydro at `dt 1/360`).
- Headless `forceHurricane` during Year 1 with Célestine `pending` → `spawnStorm` sets `celestine.state = 'done'` so two storms never overlap; if a storm is already `current`, `spawnStorm` returns it unchanged (`{ok:false}` semantics: return the existing storm).
- `setPiece` is session's: weather never writes `state.setPiece` (it reads `setPiece.tick`). Weather asks session to start; session ends by length.
- `storms.log` is written by weather only (on `setpiece:end{kind:'landfall'}` and at the end of a near-miss pass); progress never pushes to it (§12.3 step 8).
- No non-finite value ever: `tLandfall`, `lastLandfallDay`, `coneDay`, `clearNightDay` use `-1`, never `Infinity` (§10.3).
- A save mid-landfall: on load, `reset` recomputes nothing about the timeline; the hooks are evaluated by `setPiece.tick` on the next tick, so ticks already passed do not re-fire (hooks fire only when `setPiece.tick === hook.tick`). Continuous per-tick hooks (`stage`, wind ramps) are functions of `t`, so they resume correctly.
- `landfallDay` for scheduled storms is a day; `tLandfall` is `−1` until the bands day, when it is set to the tick of the next day boundary (informational).
- `coneDays` with the Institute applies only to storms whose wave fires after the Institute is complete.
- `windAngle` finite; `heat` integer-ish finite; `rainRate` ∈ [0,1].
- The title world (session `title:true`): weather runs the sky only (calendar not running).

## 6. selfTest() requirements

Pure; a private `BSU.newState(5)`; **never emit on the live bus** (§10.6): `BSU.events` is one global bus and the live game's progress/render_fx/buildings listeners would receive a fake `calendar:date`. Every emit in weather goes through `M._deps.emit`; `selfTest` replaces it with a recorder `(name, payload) => log.push({name, payload})` for the duration (restored in `finally`) and asserts on the recorded list. Also stub `M._deps.session/hydro/buildings/sports/agents/progress/ui` so `tick` on the private state calls nothing live. Assertions with `BSU.assert` (the harness sets `BSU.SELFTEST`; do not toggle it).

1. Calendar math for 3 years: for `day` in 0…359 the derived `{year, month, dom, season, semester}` matches a brute-force table; `dayOf('Jan 5', 0) === 4`, `dayOf('Aug 5', 0) === 74`, `dayOf('Dec 10', 0) === 119`, `dayOf('Aug 5', 1) === 194`; `BSU.dateToDay(BSU.monthName(m) + ' ' + d, y)` round-trips for all 120 dates.
2. Sky: `BSU.SKY_TICKS` sums to 300; stepping a private sky 300 times returns to phase DAWN/tick 0 and passes through the five phases in order, recording exactly 5 `sky:phase` entries.
3. Rain draw statistics: over the 120 days of a year with seed 5 the number of rain days is between 30 and 60; every rain day in Apr–Sep is `'cell'`; none in Oct–Mar is.
4. `consumeRainStep` on a shower event returns `r = 0.04/40` forty times then clears the event and returns `null`.
5. `dtDay` rule: a table of `(setPiece kind, T%10)` → expected value.
6. Storm schedule for a Year-2 state (seed 5, celestine done): all landfall days within Jun 1–Nov 30, ≥ 15 apart, categories 1–5, count 1–3.
7. Hold rule: a Year-1 state on Sep 2 with `playSeconds 100` → no storm; with `playSeconds 600` but `offered('11') === false` (stub) → no storm; both → `storms.current` non-null, cat 2, name 'Célestine', `landfallDay = day + 6`.
8. `spawnStorm({cat:3, coneNowTick: 0, landfallTick: 600, compressed: true})` → `landfallDay === day + 6`, `forecastCat ∈ [2,4]`, `entry.length === 8`, `surge === 8`, `compressed === true`; the same call with `compressed: false` → `compressed === false` and `tLandfall === -1`; the recorder holds one `storm:named`.
11. `reset(s, false)` on a state with 7 saved `rainDays` leaves them (and `calendar.running`) unchanged and advances `rng.sim` by 0 draws; `reset(s, true)` redraws them.
12. Bands step with a stubbed `sports.upcoming` returning a home entry for today and `forecastCat 1` → the stub `sports.offerPlayThrough` is called once; with `forecastCat 2` → not called.
9. The landfall hook table is sorted by tick, contains ticks 0,150,250,300,350,380,400,450,480,500,550,680,750, and the toast opening ticks are 300/330/400/450.
10. `heat` for Jan is within 49–64 over 100 draws; `advisory` never true in Jan; possible in Aug.

## 7. Testing in isolation

```js
// scratch/test_weather.mjs
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true; const ctx = vm.createContext(win);
const load = f => vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
load('contract.js'); load('data.js');
vm.runInContext(`
  BSU.hydro = { setStages(){}, forceSat(){}, riverAdjacent(){ return []; }, surgeControl(s,c,a){ console.log('surge', c, a && a.target); }, setJammed(){}, networks(){ return []; }, markLeveeChange(){} };
  BSU.buildings = { has(){ return false; }, list(){ return []; }, damageReport(){ return {bill:0,tarps:0,held:[],overtopped:[],breached:[],flooded:[],choices:{}}; }, boundaryLevees(){ return []; }, boardUp(){ return {ok:true,cost:0,queued:0}; }, sandbags(){ return {ok:true,cost:0,tiles:[]}; }, repairAllLevees(){ return {ok:true,cost:0}; }, refuel(){ return {ok:true,cost:5000}; }, shelterOverflow(){}, shelterAssignments(){ return {}; } };
  BSU.progress = { offered(){ return true; }, setPieceSeen(){ return false; }, addTimer(){}, ticker(s,t){ console.log('ticker', t); } };
  BSU.sports = { upcoming(){ return null; }, season(s){ return s.sports; }, postpone(){}, offerPlayThrough(){ console.log('playThrough offered'); } };
  BSU.economy = { charge(){ return true; }, addAttrition(){} };
  BSU.agents = { evacuate(){}, shelter(){} };
  BSU.render = { panToTile(){} }; BSU.ui = { answerDecision(){} };
  BSU.session = { startSetPiece(s,k,o){ s.setPiece = {kind:k, tick:0, len:o.len, skippable:!!o.skippable, choices:{}, speedBefore:1, cameraTouched:false}; console.log('setpiece', k); },
                  setSpeed(){}, restoreSpeed(){} };
`, ctx);
load('weather.js');
const BSU = win.BSU; const s = BSU.newState(3); s.plot.mouth = [1000,1001,1002]; s.plot.bayou = [];
BSU.weather.init(s); BSU.weather.reset(s, true); BSU.weather.setRunning(s, true);
BSU.events.on(BSU.EV.CALENDAR_MONTH, p => console.log('month', p));
BSU.events.on(BSU.EV.STORM_PHASE, p => console.log('phase', p));
// run 60 days
for (let k = 0; k < 6000; k++) { s.calendar.frozen = !s.calendar.running || !!s.setPiece; BSU.weather.tick(s); if (s.setPiece) { if (++s.setPiece.tick >= s.setPiece.len) { s.setPiece = null; BSU.events.emit(BSU.EV.SETPIECE_END, {kind:'landfall', len:900}); } } s.tick++; }
console.log(BSU.weather.date(s));
BSU.weather.spawnStorm(s, { cat: 3, coneNowTick: s.tick, landfallTick: s.tick + 600, compressed: true });
for (let k = 0; k < 1600; k++) { s.calendar.frozen = !s.calendar.running || !!s.setPiece; BSU.weather.tick(s); if (s.setPiece) { if (++s.setPiece.tick >= s.setPiece.len) { s.setPiece = null; BSU.events.emit(BSU.EV.SETPIECE_END, {kind:'landfall', len:900}); } } s.tick++; }
console.log('log', s.storms.log, BSU.weather.selfTest());
```
Expect: month events every 1,000 ticks; after `spawnStorm`, `phase` events at set-piece ticks 0/150/350/450/500/750 and a log entry.

## 8. Performance budget

`tick` ≤ 0.3 ms per tick (the per-tick path is: sky increment, dayTick increment, dtDay write, a cell-queue check, the set-piece hook lookup by index — keep the hook table sorted and track `nextHookIdx`); daily step ≤ 2 ms; Jan 1 ≤ 5 ms (the storm schedule redraw loop is bounded at 20 tries × 3 storms).

## 9. Done means

- `selfTest().ok`; the isolation script shows the calendar advancing, month events, a compressed Cat 3 lifecycle (watch at +300, bands at +500, set piece at +600 with all phase events, a log entry) with no exceptions.
- In the full build: `node test/smoke.mjs` passes — `forceHurricane(3); tick(4000)` runs the set piece (`snapshot().storm` is non-null during it and `null`/RECOVERY after); the Year-1 Célestine cone appears on Sep 2 with `skipTutorial` in headless (`playSeconds = tick/10 ≥ 540` by then) and lands Sep 8; Amélie runs when progress schedules it; Apr 5's scripted cell fires.
- In Chrome (`node test/browser.mjs`): the sky cycles at 30 s per cycle at 1×, days roll at 10 s, a cell visibly drifts NE at ~1 tile per second, the four wind pulses shake and damage, all four toasts can be produced from the debug panel's "Fire every decision toast".
