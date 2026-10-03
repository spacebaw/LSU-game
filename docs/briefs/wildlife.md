# Brief: `src/js/wildlife.js` → `BSU.wildlife`

Read first: `docs/ARCHITECTURE.md` §1 (row 5), §2.6 (`gators`, `wildlife`, the `Gator` struct), §3.2 `params.wildlife` (`gator`, `mosq`, `nutria`, `ecology`), §3.4 events, §5.1 step 5, §5.5 (API), §5.3 (the integrity-writer rule), §1 (self-healing queries; `reset(state, fresh)`), §10.5–10.6, D24, D37, D38, D46, D49, D54; `docs/GDD.md` §6.3 (gators, campus set, incidents, Le Grand), §6.4 (mosquitoes + M1–M3), §6.7 (nutria, birds, fireflies), §6.8 (ecology), §6.2 Recovery (gator wave, mosquito bloom), §6.6 (heat illness half), §0.3 rows 29, 31–35, 37, 40 (the effects you apply), §12.8 (what must be visible: you supply the numbers).

---

## 1. Purpose and public surface

Gators (comic, never harmful), the mosquito field, nutria burrows, the ecology score, and the wildlife counts render uses (fireflies, egrets, spoonbills, pelicans). Runs at 10 Hz for gators/officers, daily for mosquitoes/ecology/incidents, monthly for nutria.

```js
BSU.wildlife.init(state)              // subscribe (owner 'wildlife'): tile:changed, building:placed/removed/complete (campus mask + dens dirty), storm:watch (RETREAT), storm:passed (gator wave), festival:start/end (Mardi Gras trash), game:kickoff (parking attractor), calendar:date? no — use flags
BSU.wildlife.reset(state, fresh)      // both cases: rebuild campusMask, dens, gator routes (empty), the gator grid cache, accumulators; lazily initialize the saved keys contract.js lacks (`state.wildlife.sick ??= 0`, `beadsDay ??= -1`, `burrowLog ??= {}`). ONLY when fresh === true: count wetlandOriginal, spawn the initial gator population at dens (rng.sim), compute the first ecology. When fresh === false (load): spawn NOTHING, draw NOTHING — gators, wetlandOriginal and ecology are saved (D37; a reset that spawned on load would double `snapshot().gators` and break save/load identity)
BSU.wildlife.tick(state, flags)
BSU.wildlife.gators(state) → Gator[]
BSU.wildlife.mosqAt(state, tx, ty) → number
BSU.wildlife.mosqIndex(state) → number
BSU.wildlife.ecology(state) → number;  BSU.wildlife.ecologyTerms(state) → Object
BSU.wildlife.onCampus(state) → Gator[]
BSU.wildlife.campusMask(state) → Uint8Array
BSU.wildlife.spawnGator(state, i, name?) → Gator
BSU.wildlife.forceFirstGator(state) → void
BSU.wildlife.relocate(state, gatorId) → void
BSU.wildlife.sickToday(state) → number
BSU.wildlife.fireflyTarget(state) → number;  BSU.wildlife.birds(state) → {egrets, spoonbills, pelicans}
BSU.wildlife.nutriaTraps(state, i) → boolean   // a complete Wildlife Post within 14 of tile i
BSU.wildlife.gatorGridPassable(state, i, gator) → boolean
BSU.wildlife.forceMosquito(state, i, v) → void
BSU.wildlife.forceEcology(state, v) → void             // debug "Set ecology": writes wildlife.ecology (and an `ecologyTerms.once` offset so the daily recompute keeps it)
BSU.wildlife.gatorPenalty(state) → number              // min(15, 3 × incidents in the last 10 days) — economy's `gator` happiness term
BSU.wildlife.photographLeGrand(state) → void           // ui: +1 prestige once per year via economy.bump
BSU.wildlife.officers(state) → Officer[]        // state.wildlife.officers (render reads)
BSU.wildlife.wetlandLost(state) → number        // the §6.8 term (buildings/ui read for the E overlay)
BSU.wildlife.applyEcologyOnce(state, delta) → void   // one-time adjustments (wastewater on Marsh −5, restoration +15×tiles/40): stored in wildlife.ecologyTerms.once and included in the daily recompute
```

## 2. State fields

**Writes (owner):** `state.gators[]` (all fields; `px/py/route` not saved), `state.wildlife.*` (everything in ARCHITECTURE §2.6; `campusMask` unsaved), `tiles.mosq`, `tiles.integrity` **only** for nutria burrows (−15, then `buildings.onIntegrityChanged(state, i)`), `Building.data.stockedDay`? No — buildings owns `data`; wildlife reads `stockedDay` (buildings sets it 10 days after completion).

**Reads:** `tiles.type/flags/depth/stand/owner/surface/crest/elev`, `terrain.isDisturbedMarsh`, `hydro.isMud`, `hydro.networks` (unconnected canal chains), `buildings.list/get/footprint/count/has/effective/dumpsterTile/stats` (`stats()` self-heals when called from `reset` on a new root, §1), `Building.data.active` (abatement), `Building.data.policies.gatorProofDumpsters`, `Building.data.stockedDay`, `agents.list` (positions for `mosqIndex` sampling and illness), `agents.route` (A* on the gator grid: pass `grid = 'gator'` with `gatorGridPassable` as the predicate — agents.route supports `grid: 'walk' | 'gator' | 'road'`), `weather.sky/heat/date/storm`, **`state.sports.game`** (game day, parking attractor — the state field; there is no `BSU.sports.game` function, D46), `progress.timers` (Tier 2 voice payoffs), `state.storms.log/lastLandfallDay`, `state.setPiece`, `economy.students`.

**Naming in this brief:** `wildlife.x` below always means the state field `state.wildlife.x`. The module object `BSU.wildlife` carries functions only — never `relocations`, `biblicalDays`, `leGrand`, `beadsDay`, `sick`, `officers` as properties (D46). Consumers read `state.wildlife.<field>` or call a query. `nutriaTraps/ecology/onCampus/campusMask` are pure over their `state` argument (caches keyed `cacheRoot === state`) because `terrain.gen` calls `nutriaTraps` before `wildlife.reset` has run on the new root (§1).

## 3. Events

**Emits:** `gator:spawn{id,name,den}`; `gator:campus{id,name,i,enter,target}`; `gator:incident{id,name,i,kind}` (one per gator per day); `gator:relocated{id,name,byPost}`; `mosquito:warning{index,worstTile}` (first time `≥ .3`, and again on entering biblical); `ecology:changed{value,prev}` (daily when |Δ| ≥ 1); `levee:burrow{i,tx,ty,integrity}`.

**Listens (owner `'wildlife'`):** `tile:changed` → `campusDirty`, `densDirty` (if `what` ∈ flags/type/water), gator grid cache dirty; `building:placed/removed/complete` → `campusDirty`, attractor list dirty; `storm:watch` → every gator `RETREAT`; `storm:passed` → schedule the gator wave (`waveUntilDay = day + 10`, spawn 3–8 over the next days into flooded campus tiles); `festival:start{id:'mardiGras'}` → `paradeTrashUntilDay = dayOf('Feb 10')`; `game:kickoff` → `gameDay = day`.

Listeners only set flags/day numbers. Every emit goes through `M._deps.emit` (default `BSU.events.emit`) so `selfTest` can record instead of broadcasting (§10.6).

## 4. Rules checklist

### Tier 1

**Campus set (GDD §6.3 Threat; C31)** — `campusMask(state)`:
- [ ] `campus[i] = 1` for every tile within Chebyshev 3 of any tile with `owner ≥ 0` or `surface ∈ {1,2}`. Rebuild when dirty (a 4,096 pass + dilation by 3 = 49 neighbor reads per source tile; keep a source list to stay under 1 ms). This one set drives the alert chip, incidents, the happiness penalty, Objective 16 and `onCampus()`.

**Gator population and dens (§6.3 Rule, `params.wildlife.gator`)**
- [ ] `target = min(24, 6 + floor(waterTiles/40) + floor(students/1000))` where `waterTiles` = OPEN_WATER + BAYOU tiles; always ≥ 6. Recomputed daily; spawn at random dens (`rng.sim`) when below target; when above (never happens: no death) do nothing.
- [ ] Dens: water tiles (OPEN_WATER or BAYOU) with ≥ 2 four-adjacent MARSH tiles; cached list, rebuilt when dirty. If no den exists (degenerate map) use any BAYOU tile.
- [ ] `Gator = {id, name, tx, ty, px, py, dir, state:'SUN', size, den, target:-1, route:[], lounge:0, onCampus:false, lastIncidentDay:-1, tag:0}`; `size`: 60% `'juvenile'`, 40% `'big'`; names from `data.gatorNames` cycling (`nameIndex` private, seeded from the count so reload keeps it deterministic: name = `gatorNames[id % 14]`, with `' II'` appended on the second cycle). A gator named `'Praline'` is renamed `'Mudbug II'` if a storm named Praline exists in `storms.log` (flavor; cheap).
- [ ] `spawnGator(state, i, name?)` places a gator at tile `i` in state `WANDER` if `i` is land else `SUN`, `den` = nearest den; emits `gator:spawn`.
- [ ] Le Grand: on Apr 1 of each year (`wildlife.leGrandDay = dayOf('Apr 1') + rng.int(10)`), when the day arrives create `wildlife.leGrand = Gator{name:'Le Grand', size:'legend', den: a lake tile}` at the cypress lake for 3 days (`SUN`/`SWIM` between lake tiles, never wanders), ticker line 4, alert chip data (`onCampus` false; ui shows the chip from `wildlife.leGrand`); remove after 3 days (`leGrand = null`, `leGrandDay = −1` until next year). Clicking him: ui calls `wildlife.photographLeGrand(state)` → +1 prestige once per year via `economy.bump`.

**Gator state machine (10 Hz)** — per gator per tick:
- [ ] `SUN`: on a bank tile (a land tile adjacent to its den's water) or in the water at the den; 60% of the Day phase is SUN — implement: at each `sky:phase` change to DAY, `chance(.6)` → stay SUN through the day else SWIM. `SWIM`: move along water tiles toward a random water tile within 12 of the den at `swimSpeed 2` tiles/s (0.2 tiles/tick); on arrival pick another or return to `SUN`.
- [ ] Wander roll: at each Dawn and each Dusk (`sky:phase` transitions; store the last phase to detect them inside `tick`), per gator not already wandering: list attractor tiles within `attractRadius 12` of its den with weights: Dining Hall dumpster tile 2 (1 with `gatorProofDumpsters`), each Greek House porch tile 2 (the tile just south of the footprint: `(tx, ty + h)`, decision), each Parking Lot tile 6 on a game day (`state.sports.game` non-null or `gameDay === day`), each Mardi Gras trash tile 5 (`terrain.paradeRoute()` tiles while `day ≤ paradeTrashUntilDay`), any tile with `depth ≥ .3` 4 (sample up to 40 such tiles from the active flood set — use `hydro` depth directly, scanning the 25×25 window), the Rec Center pool tile 1 on advisory days (the footprint's center tile). `attraction = Σ weights`; `p = wanderP .15 × (1 + attraction)`, `× matingMult 3` in months 4–5; `chance(min(1, p))` → wander. Target = weighted pick, or a random bank tile if the list is empty. A den with a PRESERVE tile within `habitatRadius 10`: `chance(preserveShare .8)` → target = a random preserve tile instead.
- [ ] Route: `agents.route(state, denTile, targetTile, 'gator')` (A* on the gator grid; may return `null` = queued; retry next tick — safe: agents' queue is keyed by `(from, to, grid)` so a repeated request never re-enqueues (D54); if still null after 30 ticks cancel the wander). Movement `WANDER` at `walkSpeed .7` tiles/s on land (0.07/tick), `SWIM` speed on water tiles; store `px,py` before moving; `dir` from the movement vector (4 directions).
- [ ] Gator grid (`gatorGridPassable`): passable = OPEN_WATER, BAYOU, MARSH, any land tile incl. paths/roads, flooded tiles; blocked = `owner ≥ 0` unless the building type ∈ {practice_field, stadium, parking}; `surface === 4` (fence); any tile within `gatorAvoidRadius 10` of a complete `tiger_habitat` footprint (cached mask). Debris does not block gators.
- [ ] At the target: `LOUNGE` for `rng.range(300, 1200)` ticks; then `RETREAT` along the reversed route (re-plan if a tile on it became blocked). `WRANGLED` (below) ends with a teleport to the nearest den or preserve tile + `SUN`.
- [ ] On campus: each tick `onCampus = campus[tile]`; on transitions emit `gator:campus{enter}` and set `tag = 30` (3 s tag; render reads `tag` and counts it down? No: wildlife decrements `tag` per tick). One **incident per gator per day** while on campus: `lastIncidentDay !== day` → push `{day, gatorId, tile}` to `wildlife.incidents` (keep the last 10 days), emit `gator:incident{kind}`: `'pool'` if the tile is a Rec Center footprint (also `progress.addTimer('gatorPool', −2, 1)` via… no — progress listens to `gator:incident` and adds the timer; wildlife just emits), `'field'` if a practice_field/stadium footprint on a game day (`sunbather` milestone: progress), `'dumpster'` if the dumpster tile, `'building'` if within 2 of any footprint, else `'tile'`. Agents flee within 2 tiles (agents reads gator positions). "Gator-closes" a building within 2 tiles: buildings reads `wildlife.onCampus()` positions in its daily/tick step (buildings brief: `gatorClosed` is a transient computed each tick, not saved).
- [ ] `RETREAT` on `storm:watch`: every gator heads to its den and stays `SUN` in the water until `storm:passed`.
- [ ] Post-storm gator wave (§6.2 Recovery): after `storm:passed` of a non-near-miss, spawn `rng.range(3, 8)` extra gators over days T+1…T+3 into random **flooded campus** tiles (`campus[i] && depth[i] ≥ .3`; else near the entry edge); they are ordinary gators (counted against no cap; the cap applies only to the daily top-up). Their den = nearest den.
- [ ] Halloween beads (Oct 31 = `'Oct 10'`? The calendar has 10-day months; "Halloween" = Oct 10, decision: gators wear beads on Oct 8–10 and Feb 6–8; write `state.wildlife.beadsDay = day` on those days (else `-1`); render reads `state.wildlife.beadsDay` — a saved field lazily initialized to `-1` in `reset`).

**Officers (§0.3 row 34; `params.wildlife.gator.officerSpeed/officerRadius/wrangleTicks/relocateCooldown`)**
- [ ] One `Officer` per complete Wildlife Post: `wildlife.officers = [{post, tx, ty, state:'IDLE', target:-1, cooldown:0}]` reconciled daily and on building events (remove when the post is gone). `IDLE` at the post's tile.
- [ ] Each tick: an `IDLE` officer with `cooldown === 0` picks the nearest on-campus gator within `officerRadius 14` (of the post) → `WALK` (route on the walk grid via `agents.route(…, 'walk')`, speed `officerSpeed 3` tiles/s); on reaching within 1 tile → `WRANGLE` for `wrangleTicks 30` (gator state `WRANGLED`, frozen); then `relocate(gatorId)`: gator to the nearest den or preserve tile, `SUN`; `wildlife.relocations++`; emit `gator:relocated{byPost:true}`; officer `RETURN` to the post then `IDLE` with `cooldown = relocateCooldown 200`. Debug `relocate` (byPost false) skips the walk.

**Mosquito field (§6.4, `params.wildlife.mosq`; daily on `flags.newDay`)** — compute into a scratch Float32Array then swap:
- [ ] Sources per tile: non-Marsh land with `stand ≥ 2` → `+.12` (`+.24` if the tile is a footprint tile of a flooded building); undisturbed MARSH `+.02`; disturbed MARSH (`terrain.isDisturbedMarsh`) `+.06`; `hydro.isMud(i)` (drained mud stage) `+.3` **once** (apply on the day the tile enters mud: track a private `Uint8Array mudApplied`); tiles of an unconnected canal network (`!drainsToWater && pumps.length === 0`) `+.08`; tiles of an unstocked pond (`stockedDay === −1` or `day < stockedDay`) `+.12`.
- [ ] `stormMult .5`: on a day with a storm event (`weather.storm()` phase BANDS/LANDFALL/RECOVERY within T+1) all sources ×.5.
- [ ] Ecology < 30: source growth ×1.5 (§6.8).
- [ ] Diffusion: `new[i] = .85 × cur[i] + .15 × mean(cur over 4-neighbors)` (`diffusion .15`), water tiles hold 0.
- [ ] Decay: `.06/day`; `.15` for days Dec 11 – Feb 10 (`dayOfYear ≥ 110 || dayOfYear ≤ 19`); `.09` when `weather.heat > 100`. Applied after diffusion: `v = max(0, v − decay)`.
- [ ] Sinks (multiplicative, applied last): stocked pond `×.2` within 4 of its NW tile; Bat House `×.7` within 4, a second bat house in range `×.6` total (`batStack`; i.e. `mult = max(.4, .7^n)`); PRESERVE tile with a cypress on it `×.8`; Abatement Station with `data.active` and `effective > 0` `×.3` within 8 (the fogger's Dusk patrol is agents' visual; the effect is this radius); clamp to [0, 1].
- [ ] Post-storm bloom (§6.2): from `lastLandfallDay + 3` for 7 days, sources ×2.
- [ ] `mosqIndex` = mean `mosq` over the tiles of all agents (`agents.list()`), 0 if no agents; write `wildlife.mosqIndex`. First warning: if `mosqIndex ≥ warnIndex .3` and `mosqWarnedDay === −1` → `mosqWarnedDay = day`, emit `mosquito:warning{index, worstTile}` (`worstTile` = argmax `mosq` among campus tiles). Biblical: `index > .5` → `biblicalDays++` (reset to 0 otherwise), emit `mosquito:warning` again on the first biblical day; economy reads `biblicalDays` (blight −5 while > 0; applicants −10% at the next lock if it reached 20 — economy consumes).
- [ ] Illness: `sickMosq = students × index × .02`, reduced ×.4 for the share of students whose dorms are within 12 of a complete Health Center (approximate by the share of agents whose tile is within 12 — simpler: if any Health Center exists apply `healthMult .4` to the whole term; decision, record it); `sickHeat = advisory ? students × .003 × (healthCenter ? .5 : 1) : 0`; `state.wildlife.sick = round(sickMosq + sickHeat)` (a saved field lazily initialized to 0 in `reset`); `sickToday()` returns it; economy copies it into `economy.sick`; agents skip class for `sick/students` of agents.

**Nutria (§6.7, monthly on `flags.newMonth`)**
- [ ] `nutria = 4 + floor(marshTiles/60)` (type MARSH count).
- [ ] Each nutria: `chance(burrowP .2)` → pick a random **earthen levee** tile (`crest === 6`, not a floodwall) within `burrowRadius 10` of any MARSH tile (build the candidate list once per month); if `nutriaTraps(i)` (a complete Wildlife Post within 14) → `chance(1 − trapMult… )`: traps are −80%: skip the burrow with p .8. Else `integrity = max(0, integrity − 15)`, `buildings.onIntegrityChanged(state, i)`, emit `levee:burrow{i,tx,ty,integrity}` (render stamps the decal, progress prints line 57 with `{x},{y}`), record `wildlife.burrows[i]++` (add `burrows: Object<string, number>` and `lastBurrowDay: Object<string, number>` to `state.wildlife` — the inspect panel reads them; **add these two fields to `newState`'s wildlife branch via contract? contract is frozen** → store them under `state.wildlife.burrowLog = {}` keyed by tile index → `{n, day}`; document that `newState` initializes `wildlife.burrowLog = {}` — if contract did not, initialize lazily in `reset` (`state.wildlife.burrowLog ||= {}`; saved since it lives in the branch).
- [ ] Nutria Bounty: economy pays `$500 × posts` monthly while any post has `data.policies.nutriaBounty` (economy reads buildings; wildlife does nothing).

**Ecology (§6.8, `params.wildlife.ecology`; daily)**
- [ ] `wetlandLost = 3 × drainedOriginal + (canal + levee + floodwall + pond + path tiles on original Marsh)` where "original Marsh" = WETLAND_ORIGINAL flag; a drained tile = DRAINED flag + WETLAND_ORIGINAL; the second group counts tiles with the flag and (CANAL flag, or `crest > 0`, or POND_SINK, or `surface === 1`), excluding tiles already counted as drained. Buildings on pilings, boardwalks, fences, preserve paint: not lost.
- [ ] `ecology = clamp(70 × (1 − wetlandLost / wetlandOriginal) + min(20, .5 × preserveTiles) + min(10, .3 × cypressCount) + min(5, .3 × oakCount) + min(6, 2 × stockedPonds) + 3 × posts − foggerPenalty − 5 × wastewaterOnMarsh − .3 × canalOnMarsh − .2 × leveeOnMarsh + once, 0, 100)`; `oakCount` includes Quad Lawn oaks (`buildings.stats().oaks`); `wastewaterOnMarsh` = count of wastewater plants placed on Marsh (buildings sets `data.onMarsh`? — use `applyEcologyOnce(−5)` at placement instead and drop this term from the daily formula: **decision**: the −5 is applied once through `once`); `canalOnMarsh`/`leveeOnMarsh` = CANAL / `crest>0` tiles on WETLAND_ORIGINAL (these are also in `wetlandLost`; the GDD double-counts by design — keep both); `once` = Σ `applyEcologyOnce` deltas (saved in `ecologyTerms.once`); `foggerPenalty` += `.5/month` per active abatement (monthly step), recovers `.3/month` when none active, cap 15; with a Coastal Institute every negative term's **monthly growth** is halved (`instituteMult .5`: apply to the fogger increment and to the monthly change of `wetlandLost`-driven loss: implement as `ecology = prev + (raw − prev) × (raw < prev && institute ? .5 : 1)` on the daily update — decision).
- [ ] Write `wildlife.ecology`, `ecologyTerms` (each term by name for the popover), emit `ecology:changed` when `|Δ| ≥ 1`. Session copies it into `economy.ecology` (D24).
- [ ] `wetlandOriginal` = WETLAND_ORIGINAL count at generation (computed in `reset(state, true)` only; on load it is saved and `reset(state, false)` leaves it alone).

**Birds and fireflies (§6.7)**
- [ ] `fireflyTarget = ecology ≥ 50 ? min(600, ecology × 6) : 0`; `×3` over preserve tiles is render's per-tile weighting; `birds.egrets = ecology ≥ 40 ? min(12, 2 + stockedPonds + preserveTiles/20) : 0`; `birds.spoonbills = ecology ≥ 70 || buildings.has('rookery')` (first time true → `progress` bumps +1 prestige: emit nothing; progress reads `birds.spoonbills` daily and keeps its own `firsts`); `birds.pelicans = min(6, 2 + floor(prestige/20))`.

### Tier 2

- [ ] Nutria, spoonbill, pelican, armadillo **sprites and spawners** (cut #3): spawn transient positions for render (`wildlife.critters(state) → [{kind, tx, ty, frame}]`).
- [ ] Officer wrangle animation (cut #4) — the relocation with a puff is Tier 1.
- [ ] Roux Is Loose (Tiger Habitat flooded → Roux walks to the Dining Hall; ticker 50) — expose `wildlife.roux(state) → {tx,ty,state}|null`.
- [ ] Voice-card payoffs that touch wildlife (`batHouse` fogger waiver: skip the fogger penalty while `progress.timer('voiceFoggerWaiver')`).

## 5. Edge cases and invariants

- `mosq` ∈ [0,1], finite; `ecology` ∈ [0,100]; `wetlandOriginal > 0` guard (template map may vary; if 0 use 1).
- Gator `tx,ty` finite and in bounds; a gator whose den tile becomes land (subsidence never raises land; canal cut? no) — re-pick the den daily if it is no longer water.
- No gator ever damages anything; no agent is ever hurt.
- `agents.route` may return `null` (queued): never loop; retry next tick with a 30-tick give-up.
- Set pieces: gators keep moving (ticks run); the calendar is frozen so daily/monthly steps do not run; `storm:watch` retreat persists through landfall.
- Load (`reset(state, false)`): `gators[].route = []` (not saved) — replan lazily; `px,py = tx,ty`; officers saved; `campusMask` rebuilt; `leGrand` saved as a Gator; nothing spawned, `rng.sim` not drawn. `reset(state, true)` is the only place the initial population is drawn.
- No non-finite value ever (`leGrandDay`, `mosqWarnedDay`, `beadsDay` use `-1`, never `Infinity`; §10.3).
- Headless: identical.
- All randomness `rng.sim`, in a fixed order per tick (iterate gators by index).
- `mosqIndex` with zero agents (title world, pre-arrival): 0, and no warning can fire before the first agents exist.

## 6. selfTest() requirements

Private `BSU.newState(9)`; synthetic tiles (a 10×10 marsh block, a water strip with dens, a 5×5 dry block); stub buildings/agents/sports through an injectable `M._deps`, and replace `M._deps.emit` with a recorder for the duration (restored in `finally`) — `gator:spawn`, `levee:burrow`, `mosquito:warning` must never reach the live bus (§10.6). Assertions with `BSU.assert` (the harness sets `BSU.SELFTEST`).

1. Mosquito bounds: a field seeded with random values → after 30 daily updates every value ∈ [0,1], no NaN; a tile with `stand ≥ 2` and no sinks converges to `.12/.06 = 2 → clamped 1`? No: with decay .06 and source .12 the fixed point is 1.0 → the test asserts the value rises monotonically to > .5 within 10 days; with a stocked pond within 4 it stays < .3 (M3 spirit).
2. Diffusion conserves: with decay disabled and no sources (test hook `M._mosqStep(state, {decay:0, sources:false})`), Σ mosq before ≈ after (±1e-6) on a closed land block.
3. Gator population formula: `waterTiles 400, students 2500` → `6 + 10 + 2 = 18`; `waterTiles 4000, students 20000` → 24 (cap); `0, 0` → 6.
4. Dens: on the synthetic map, dens are exactly the water tiles with ≥ 2 adjacent Marsh.
5. Campus mask: one 3×2 footprint at (20,20) → tiles (17..25, 17..24) set, (26,20) not.
6. Gator grid: fence tile blocked; building tile blocked; parking footprint passable; tile within 10 of a tiger habitat blocked; marsh passable.
7. Ecology: a map with 100 original marsh, 0 lost, nothing else → 70; 10 drained (→ 30 lost) → 49; +40 preserve tiles → +20 cap; + a post → +3; clamp at 100 and 0.
8. Wander probability: attraction 0 → p .15; attraction 4 in April → min(1, .15×5×3) = 1 (clamped).
9. Incident cap: 6 gators on campus for 3 days → `incidents` holds ≤ 10 days of rows and economy's penalty input `min(15, 3 × count)` — expose `M.gatorPenalty(state)` and assert it caps at 15.
10. `nutriaTraps`: post at (30,30) → true at (44,44) (Chebyshev 14), false at (45,30).
11. `reset(s, false)` on a state holding 8 saved gators leaves `s.gators.length === 8` and records no `gator:spawn`; `reset(s, true)` on the same map spawns ≥ 6.

## 7. Testing in isolation

```js
// scratch/test_wildlife.mjs
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true; const ctx = vm.createContext(win);
const load = f => vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
load('contract.js'); load('data.js');
vm.runInContext(`
  BSU.terrain = { isDisturbedMarsh(){ return false; }, paradeRoute(){ return []; }, touch(){} };
  BSU.hydro = { isMud(){ return false; }, networks(){ return []; } };
  BSU.buildings = { list(){ return []; }, get(){ return null; }, footprint(){ return []; }, count(){ return 0; }, has(){ return false; }, effective(){ return 1; }, dumpsterTile(){ return -1; }, stats(){ return {oaks:0,cypress:0,stockedPonds:0,posts:0}; }, onIntegrityChanged(){} };
  BSU.agents = { list(){ return []; }, route(s,a,b){ return [a,b]; } };
  BSU.weather = { sky(){ return {phase:1,t:0}; }, heat(){ return {index:80,advisory:false,wave:false}; }, date(){ return {day:0,year:1,month:1,dom:1}; }, storm(){ return null; }, dayOf(){ return 0; } };
  BSU.sports = { season(s){ return s.sports; } }; BSU.progress = { timers(){ return []; }, timer(){ return null; } }; BSU.economy = { bump(){} };   // game day is read as s.sports.game (null here)
`, ctx);
load('wildlife.js');
const BSU = win.BSU; const s = BSU.newState(11);
// synthetic: marsh everywhere, a bayou column at x=32 with marsh beside it, dry block at (10..14,10..14)
for (let i = 0; i < 4096; i++) { s.tiles.type[i] = BSU.T.MARSH; s.tiles.elev[i] = 1; s.tiles.flags[i] = BSU.FLAG.WETLAND_ORIGINAL; s.tiles.depth[i] = .25; }
for (let y = 0; y < 64; y++) { const i = y*64+32; s.tiles.type[i] = BSU.T.BAYOU; s.tiles.flags[i] = BSU.FLAG.BAYOU; s.tiles.elev[i] = -1; s.tiles.depth[i] = 1; }
for (let y = 10; y < 15; y++) for (let x = 10; x < 15; x++) { const i = y*64+x; s.tiles.type[i] = BSU.T.DRY; s.tiles.elev[i] = 4; s.tiles.flags[i] = 0; s.tiles.depth[i] = 0; s.tiles.stand[i] = 3; }
s.economy.students = 500;
BSU.wildlife.init(s); BSU.wildlife.reset(s, true);
console.log('gators', s.gators.length, 'ecology', s.wildlife.ecology);
for (let k = 0; k < 3000; k++) { BSU.wildlife.tick(s, { newDay: k % 100 === 0, newMonth: k % 1000 === 0, newYear: false, day: Math.floor(k/100) }); }
console.log('mosq on the dry block', s.tiles.mosq[12*64+12].toFixed(3), 'states', s.gators.map(g => g.state).join(','));
console.log(BSU.wildlife.selfTest());
```

## 8. Performance budget

- ≤ 0.5 ms per tick: ≤ 24 gators × a few ops; officers ≤ posts; the campus mask and den list are cached; attractor lists are rebuilt only at wander rolls (twice per sky cycle per gator).
- Daily mosquito step ≤ 4 ms: two passes over 4,096 with typed arrays; sinks via precomputed per-tile multiplier map rebuilt only when buildings change (`sinkMul: Float32Array`).
- No per-tick allocation in the gator loop (reuse route arrays; `px/py` are numbers).

## 9. Done means

- `selfTest().ok`; the isolation script shows gators spawning at dens (≥ 6), moving between SUN/SWIM/WANDER over 3,000 ticks, and mosquitoes rising on the standing-water block but staying ~.02 on undisturbed marsh.
- Full build: `node test/smoke.mjs` passes; `snapshot().gators ≥ 6`; ecology at a fresh seed is 80–85; GDD M1 holds (campus index < .25 through Year-1 spring with only the tutorial's five buildings) and M2/M3 are reproducible with the debug panel; a gator visibly walks to the Dining Hall dumpster at the first Dusk after Feb 9 when progress calls `forceFirstGator` (target = the dumpster tile, or Founders' if no Dining Hall); a nutria burrow shows a decal and a ticker line the month it happens; `storm:watch` sends every gator to the water.
