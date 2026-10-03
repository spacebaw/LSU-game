# Brief: `src/js/agents.js` → `BSU.agents`

Read first: `docs/ARCHITECTURE.md` §1 (row 8), §2.11 (`Agent`, `Vehicle`), §3.2 `params.agents`, §3.3 (`rng.derive('agents', tick)`), §3.4 events, §5.1 step 6, §5.8 (API + movement paragraph), §6.1 (sprite ids/anims you must name), §8.2 (regeneration on load; `snapshot().agents` is `count(state)`), §10.2 (determinism), §10.5–10.6, §12.2 step 7, §12.4 (the founding arrival), D15, D27, D37, D41, D42, D46, D49, D54; `docs/GDD.md` §7 (all), §6.3 (flee, gator on campus), §6.4 (slap ≥ .4, `bitten`), §6.6 (heat: walk 0.8×, seek shade), §6.1.6/§6.1.10 (wade, tube 15%), §5.6 (sampled terms), §5.5 (`classAttendance`), §6.2 (shelter, evacuation, Cajun Navy), §8 (game day: buses, foam fingers, cheering), §9.2 (festival props), §10.1 (the arrival), §14.1 (names).

---

## 1. Purpose and public surface

Visible students (`min(300, 40 + students/25)` agents), their sky-phase schedule, A* with a route cache (also the router for gators, officers and vehicles), reactions, the per-tile sampling that feeds happiness, class attendance, desire lines, arrivals (pirogues/buses), shelter/evacuation and the vehicles (fogger, buses, Cajun Navy, crews). Cosmetic in look, but its **sampling is part of the sim**: all decisions use `rng.sim`, regeneration on load is deterministic.

Copy the API from ARCHITECTURE §5.8 verbatim (`tick, list, sample, classAttendance, evacuate, shelter, spawnArrival, regenerate, route, invalidateRoutes, follow, inspect, vehicles, startFogger, launchCajunNavy, gameDayBuses, crewSprites`). `route(state, fromI, toI, grid = 'walk')` accepts `grid ∈ {'walk', 'gator', 'road'}`: `'walk'` uses `tiles.walk` (0 blocked, cost = class, ×2 with DEBRIS); `'gator'` uses `BSU.wildlife.gatorGridPassable(state, i, gator)` (cost 1 water/marsh, 2 land) — pass the gator as a 4th argument; `'road'` allows only `surface === 2` tiles (buses). Additions:

```js
BSU.agents.count(state) → number                   // target agent count = students > 0 ? min(300, 40 + floor(students/25)) : 0 (D15)
BSU.agents.nearest(state, tx, ty, radius) → Agent|null   // ui picks an agent under the cursor
BSU.agents.routeSync(state, fromI, toI, grid) → number[]|null   // an A* that runs NOW (bypasses the 8/tick queue); used ONLY by selfTest and by this module internally. It is NOT the tutorial/skipTutorial path layer: that is `terrain.landRoute` (the walk grid cannot cross bare Marsh; D57)
BSU.agents.resetDaySamples(state) → void           // called internally at flags.newDay; exposed for tests
```

## 2. State fields

**Writes (owner):** `state.agents[]` (not saved), `state.vehicles[]` (not saved), `tiles.wear` (+1 per off-path crossing; terrain decays). Nothing else in `state`. Private (closure, rebuilt in `reset`): route cache `Map<'from:to:grid', number[]>` with bounding boxes, the A* request queue, the day sample accumulators (`sumLife, sumGreen, sumMosq, sumHeat, n` — kept in the closure **and** their completed-day result kept in the closure; economy reads it once per day), class counters (`assigned`, `reached` per sky cycle), the last completed `classAttendance`, `desireLineDay`, the visible-rect cache from `render.visibleTiles()` (headless: the whole map counts as visible → every agent updates every tick; acceptable, the budget allows it).

**Reads:** `tiles.walk/depth/flags/mosq/surface/owner`, `buildings.list/get/footprint/effective/auras/coverage/dumpsterTile/at` (`shelterAssignments` is passed in by weather, not read here), `wildlife.gators/onCampus/mosqAt`, `weather.sky/raining/rainAt/heat/date/storm`, `hydro.depthAt`, **`state.sports.game`** (the in-progress game struct or null — read directly; there is no `BSU.sports.game` function, D46) and `sports.season()`, `progress.timers` (`summerSession`), `state.plot` (landing, landingShoulder, bayou, highway, founders), `economy.students/sick`, `render.visibleTiles()` (guard: if `BSU.render` or the function is missing → whole map), `data.students`.

## 3. Events

**Emits:** `agent:flee{id, gatorId}` (on entering FLEE; at most once per agent per 30 ticks); `agent:desireLine{tiles}` (≤ 1 per day: the tiles that crossed `wear ≥ 40` today); `agent:arrive{count, kind}` (when the first agent of an arrival reaches Founders'/its dorm).

**Listens (owner `'agents'`):** `tile:changed` → `invalidateRoutes(i)`; `enroll:round/lock{admitted, kind}` → `spawnArrival(admitted, kind === 'fall' ? 'bus' : 'pirogue')` (fall: `admitted × .5` by bus, the rest by pirogue — decision); `enroll:attrition/graduation` → despawn the excess at the next reconcile; `building:placed/removed/complete` → home/class reassignment flags; `storm:bands` → nothing (weather calls `shelter` explicitly); `storm:passed` → release shelter; `game:kickoff/final` → cheer/foam finger flags; `festival:start{id:'mardiGras'}` → beads prop until `festival:end`; `sky:phase` → schedule bucket transitions (the main scheduler trigger; also detectable in `tick` from `weather.sky()`); `gator:campus{enter:true, i}` → nothing (flee is checked by proximity each tick).

Listeners set flags; movement and spawning happen in `tick`. Every emit goes through `M._deps.emit` (default `BSU.events.emit`) so `selfTest` can record instead of broadcasting (§10.6).

## 4. Rules checklist

### Tier 1

**Population (GDD §7, D15)**
- [ ] **Population rule (D42).** Target `count(state)` (a pure function of `economy.students`). The daily reconcile (`flags.newDay`, never during a set piece) counts only agents that are neither `GONE` nor part of an in-flight arrival (private per-agent field `arrival` ≠ 0): it spawns the missing ones at their home dorm (or Founders' if `home === −1`) and marks extras `GONE`. **`GONE` agents stay in the array — `state.agents` is never spliced** (ids stay stable; `regenerate` on load builds exactly `count(state)` entries). Consequently `state.agents.length` may differ from `count(state)` during arrivals and between an attrition/graduation step (economy runs after agents in the same tick) and the next reconcile; **nothing may assume equality** — `headless.snapshot().agents` reports `count(state)`, not `agents.length`. Each agent represents `students / liveAgents` real students (inspect flavor; `liveAgents` = non-`GONE` count).
- [ ] `regenerate(state)` (called from `reset` **on every newGame/load**): `const r = BSU.rng.derive('agents', state.tick)`; create `count` agents in index order with `id = i`, `name` (§14.1: first from `firstModern` with p .25 else `firstCajun`; last; nickname with p .12 as `First "Nick" Last`), `major` pick, `year` 1–4, `look = BSU.sprites.agentLook(r.next())` (if sprites is absent → `r.int(1<<9)`), `home` = the i-th complete dorm/tower/greek house by bed share (round-robin weighted by beds; `−1` if none), `cls` = the nearest academic building with seats (`lecture_hall, founders_hall, library, engineering, coastal_institute`) from home, position at the home's south-corner tile center (`tx + w − 1 + .5, ty + h + .5`? The foot point must be on a walkable tile: use the first edge tile with `walk > 0`, else Founders' front tile `(founders.tx + 1, founders.ty + 3)`), state `IDLE`, all stats: `mood .6, energy 1, wet 0, bitten 0`, `sample` zeros, `prop 'none'`. Two runs with the same `(seed, tick)` produce identical arrays — the smoke test's snapshot never reads `agents.length` (it reports `count(state)`), but a save test may compare names.
- [ ] Summer (May 6–Aug 4) without `summerSession`: only 35% of agents are "present" (`state !== 'GONE'`; pick by `id % 100 < 35`); the rest are `GONE` (not drawn, not sampled).

**Schedule (GDD §7 Schedule; sky-phase buckets)** — on each `sky:phase` transition (detect in `tick` by comparing `weather.sky().phase` to the last seen):
- [ ] Dawn: leave dorms; 30% (`poboyShare .3`) route via the nearest Po'boy Shack (`goal:'poboy'` then class); class counters reset (`assigned = 0, reached = 0`; the previous cycle's ratio becomes `classAttendance` — read at Dusk, see below).
- [ ] Day: `goal:'class'` → the assigned class building (`cls`; reassign if it is not `effective`), `assigned++`; on arrival `reachedClass = true`, `reached++`; then `dining` (nearest effective Dining Hall/Union/Po'boy by cached route length) → `class` again. Each leg ≤ 5 s (50 ticks; if longer, the agent still walks — no teleport).
- [ ] Golden: `idle` at Quads / under oaks (veg oak tiles' neighbors) / Union / Rec; on advisory days prefer shade tiles (`buildings.auras().shade > 0`) and the Rec pool.
- [ ] Dusk: Greek Row porches, the Union plaza (Zydeco Friday on every 5th calendar day when a Union exists: `zydecoFriday` flavor); the class ratio is **read** at Dusk: `classAttendance = assigned ? reached/assigned : 1` (adjusted for sick students: `sick/students` share of agents skip class at Dawn — mark them `IDLE` at home for the cycle).
- [ ] Night: `goal:'home'` (dorm); `nightOwlShare .15` → Library/Union. Agents inside a building are `state:'IDLE'` with `inside = true` (add a private field on the Agent; not saved anyway) and are **not drawn** (render skips `inside`).
- [ ] Storm: `shelter(state, capacities)` where `capacities` is the `{buildingId: capacity}` map from `buildings.shelterAssignments(state)` (weather forwards it unchanged at T−1, D41) — **agents assigns itself, greedily and rng-free**: in agent index order, each present (non-`GONE`, not in-flight) agent takes the nearest shelter building (Chebyshev from its tile to the building's nearest footprint tile; ties by lower building id) with remaining capacity, decrements it and walks there (`goal:'shelter'`, `target` = the building id, `state:'SHELTER'` on arrival, inside); agents left when every capacity is 0 stay outside (`unsheltered`; the count is buildings' `shelter().ok`, not something agents publishes); `evacuate()` → all agents `BUS`: walk to the nearest road tile and despawn over 1 day (`GONE`); on `storm:passed` release. Watch days: huddle at the Union at Dusk.
- [ ] Game day (`state.sports.game` non-null — read the state field, never a module function): `goal:'event'` → the venue's footprint edge tiles (tailgate) then inside; `prop 'foam'`; `CHEER` on `game:score{side:'home'}` for 20 ticks. Parade (Feb 8 Dusk): line the parade route tiles. Graduation (May 5): `prop 'cap'`, gather at Founders'; cap toss at the set piece's tick 100 (progress emits nothing → agents read `state.setPiece.kind === 'graduation' && tick === 100`).
- [ ] Festival props: `beads` during Mardi Gras, `umbrella` while `weather.raining()` and outside, `tube` 15% of agents who enter ≥ .3 ft (`tubeP`), `cap` on May 5.

**Movement (ARCHITECTURE §5.8, GDD §7 Pathfinding)**
- [ ] Speeds per walk class at 1×: path 4, dry 2.4, wet 1.6, wading 1.2 tiles/s → per tick `/10`; ×0.8 on heat advisory days; storm watch days ×1.2 ("students walk faster"). Debris tile: ×0.5. Movement along `route` (tile centers `+ .5`); `px, py` stored before moving (D27); `dir` from the delta (0 N-E… use the 4 isometric facings: `dx > 0 ? (dy > 0 ? 2 : 1) : (dy > 0 ? 3 : 0)` — define the mapping in one place and share it with sprites' `agent` frame convention: **0 = up-right (+tx), 1 = down-right (+ty), 2 = down-left (−tx), 3 = up-left (−ty)**; sprites brief uses the same numbers).
- [ ] Off-screen agents (outside `render.visibleTiles()` + 4) update every 4th tick (`id % 4 === T % 4`) with ×4 displacement; on-screen every tick.
- [ ] A*: 4-connected on the walk grid with cost = class (1/2/3/4) ×2 on DEBRIS, Manhattan heuristic, binary heap; `maxAstarPerTick 8` new searches per tick, the rest queued FIFO; `route()` returns `null` while queued (the caller retries). **The queue is keyed by `(fromI, toI, grid)` (D54): a repeated request for a key that is already queued (or already computed as unreachable this tick) returns `null` WITHOUT enqueuing again; once computed, the cache answers the next call.** Callers (gators, officers, agents) may therefore re-call `route` every tick without flooding the queue. Route cache keyed by `(fromBuildingOrTile, toBuildingOrTile, grid)` with the route's bounding box; `invalidateRoutes(i)` drops every cached route whose bbox contains `i`. An agent whose route fails waits at its building (`waitTicks = 50`) and retries next phase; **no teleporting**.
- [ ] Reactions: FLEE when a gator (from `wildlife.gators()`) is within 2 tiles: run 3 tiles away from it for `gatorFleeTicks 30`, "!" bubble (render reads `state === 'FLEE'`), emit `agent:flee`; WADE when the current tile's `depth ≥ .3` (speed class 4, splash particles via `BSU.render?.particles?.emit('splash', …)` at most every 5 ticks per agent, `wet += .01`/tick), route around `≥ .6` (the walk grid already blocks); slap when `bitten ≥ .3` (anim `slap` for 10 ticks, once per 100 ticks); wilt in heat (SIT under an oak at Golden); cheer; throw beads (parade); selfies at the Habitat/Bell Tower (idle target flavor); Floatilla: `tube` prop with `mood += .1` (ticker line by progress on `agent:*`? no event: skip).
- [ ] Stats: `energy` drains .002/tick through Day, restored at home and by passing a Po'boy; `wet` decays .005/tick when dry; `bitten += mosqAt(tile) × .01` per tick, reset at `flags.newDay`; `mood = .5 × economy.happiness/100 + .5 × personal` (personal: −.2 wet, −.2 bitten ≥ .3, +.1 tube, −.3 fleeing, +.2 cheering), clamped 0–1.

**Sampling (GDD §7 Sampling, §5.6)** — every tick per present, outside-or-inside agent:
- [ ] `auras = buildings.auras()`; at the agent's tile `i`: `life = auras.life[i]`, `green = auras.green[i]`, `mosq = inside && (building is rec_center|union) ? 0 : tiles.mosq[i]`, `heat = advisory ? clamp((index − 92)/2, 0, 10) × (1 − auras.shade[i]) × auras.heat[i] × (inside && (union|library) ? 0 : 1) × (summerSession ? 1.5 : 1) : 0`; accumulate into the **day** accumulators. At `flags.newDay`: the completed day's means → `sample()` result `{life, green, mosq, heat, n}`; reset. `sample()` returns the last completed day (zeros with `n: 0` before the first).
- [ ] `classAttendance()` returns the last completed sky cycle's ratio (1 before the first).

**Desire lines (GDD §7)**
- [ ] When an agent moves onto a tile with `surface === 0` and type DRY/HIGH/WET (grass), `wear[i] = min(255, wear + 1)` (once per tile entry). At `flags.newDay`, tiles that reached ≥ 40 today (compare against a private copy of yesterday's `wear`... simpler: terrain sets DESIRE_WORN; agents emit `agent:desireLine{tiles}` with the tiles whose `wear ≥ 40` and which were not in yesterday's list) — at most one event per day; progress turns it into the "Students want a path here" hint with a Build-it button (path cost = tiles × $2k).

**Arrivals (GDD §10.1, §5.4)**
- [ ] `spawnArrival(state, count, kind)` **creates the new agents itself** (D42; the reconcile does not): `pending = kind === 'founding' ? count : 0` (economy has already added rolling/lock students before it emits `enroll:*`; the founding 120 are added by progress only on `agent:arrive`), `newTarget = min(300, 40 + floor((economy.students + pending) / 25))`, `n = max(0, newTarget − liveAgents)` new agents created at once (same generator as `regenerate`, drawn from `rng.sim`), each marked `arrival = k` (a private per-agent field naming this arrival) and parked **off-map inside the vehicle(s)** (not drawn, not sampled, not counted by the reconcile) until landing; `arrival` is cleared when the agent reaches its goal. `newTarget` is never 0 when `count > 0` — the founding cohort creates 44 agents while `students === 0`, which is exactly what makes `agent:arrive` fire and the tutorial founding terminate. Vehicles: `'pirogue'`: `n = clamp(ceil(count/50), 1, 3)` pirogues glide along `plot.bayou` from the north edge to `plot.landing` over 40 ticks (4 s), unloading their share at `plot.landingShoulder` (the agents walk up the path to Founders'/their dorm with `WAVE` for the first 20 ticks); `'bus'`: 3 buses on the road from `plot.highway[0]` to the tile nearest Founders' (road grid), unloading likewise; `'founding'`: 3 pirogues, the same spline (tutorial) — the skipTutorial path calls `regenerate` instead (session adds the 120 first; agents already at Founders'; no pirogues). Emit `agent:arrive{count, kind}` when the first new agent reaches its goal (the Students odometer rolls then — ui listens; progress calls `economy.addStudents(120, 'founding')` on it).
- [ ] Buses also run on game days (`gameDayBuses(on)`: 3 buses looping the parade route/roads at 5 tiles/s) and during evacuation.

**Vehicles**
- [ ] `Vehicle = {kind, tx, ty, px, py, route, routeIdx, state, payload, ttl}`; pirogues move along `plot.bayou` tiles (not the walk grid); buses on the road grid at 5 tiles/s; fogger (Tier 2 visual) at 3 tiles/s on paths within 8 of the station at Dusk (`startFogger(postId)` is called by wildlife/buildings at Dusk when an active station exists; in Tier 1 create the vehicle anyway with a simple loop — the ribbon is render's); `launchCajunNavy(dormIds)`: 4–8 pirogues (`navy` sprite) shuttling from the bayou to the flooded dorms' nearest water tile for 3 days (`cajunNavy` timer present); `crewSprites(target, n)`: 3 officer-style sprites walking from the nearest Wildlife Post (or Founders') to a target tile and back (gate crew, board-up crews are not drawn — only the gate crew).

**Inspect / follow**: `inspect(id)` → `{name, major, year, mood, activity: 'Walking to class' | 'Fleeing: {gator}' | 'Wading' | 'Sheltering' | …, quote: pick from data.students.quotes by `id`}`; `follow()` → a random present agent (render follows).

### Tier 2

- [ ] Fogger truck as a visible vehicle with the ribbon (cut #4) — Tier 1 creates the vehicle struct; the sprite/ribbon are sprites/render.
- [ ] Study circle / boardwalk idlers for voice-card payoffs (`progress.timer('voice…')` flavor targets).
- [ ] Selfie/bead-catch animations beyond the prop swap.

## 5. Edge cases and invariants

- `tx, ty` finite and inside the map; a route step never moves onto a tile with `walk === 0` (re-plan instead).
- Zero students / title world: no agents (D15); `sample()` returns `n: 0` and economy falls back to `mosqIndex`.
- No dorm: agents live at Founders' (`home −1`).
- No class building with seats: `assigned` stays 0 → attendance 1 (not 0).
- `count` never exceeds 300; never draw fewer than 120 is render's rule, not yours.
- Set pieces: agents keep moving (ticks run); the calendar is frozen so day samples accumulate across the set piece into the current day (fine).
- Load (`reset(state, false)`) and new game (`reset(state, true)`): both call `regenerate` from `(seed, tick)` (a derived stream, never `rng.sim` — so `reset` draws `rng.sim` in neither case); routes empty; vehicles empty (an arrival in flight is lost — acceptable: `count(state)` is what the snapshot reports).
- Headless: `render.visibleTiles` may be missing → treat all as visible; particle calls are guarded (`BSU.render && BSU.render.particles`).
- Determinism: every random draw through `rng.sim` in agent index order; never `Math.random`; no dependence on wall-clock.
- A* budget: 8 per tick; a queue that grows beyond 600 **distinct keys** drops the oldest (log once via `BSU.error`) — with the keyed dedup (D54) a caller re-requesting every tick never grows it.
- No state on the module object (D46): `BSU.agents` carries functions only; consumers read `state.agents`/`state.vehicles` or call `list/vehicles`.

## 6. selfTest() requirements

Private `BSU.newState(4)`; write a synthetic `walk` grid directly (no terrain); `M._deps` stubs for buildings/wildlife/weather/render/sports, and `M._deps.emit` replaced by a recorder for the duration (restored in `finally`) — never emit on the live bus (§10.6). Assertions with `BSU.assert` (the harness sets `BSU.SELFTEST`).

1. A* on a 20×20 open grid from (0,0) to (19,19) returns a path of length 39 (Manhattan) with only 4-connected steps; a wall with one gap is routed through the gap; a fully blocked target returns `null` (sync variant); cost classes: a path corridor (class 1) beside dry grass (2) is preferred.
2. Walk-class speed table: class 1 → 0.4 tiles/tick, 2 → .24, 3 → .16, 4 → .12; heat advisory ×.8.
3. `count`: students 0 → 0; 120 → 44; 5000 → 240; 20000 → 300.
4. `regenerate` twice with the same `(seed, tick)` → identical names/homes/positions; a different tick → different names.
5. Reconcile: after `students = 1000` and a daily tick → 80 live (non-`GONE`) agents; reduce to 500 → 60 live after the next daily tick, the extras marked `GONE` and still present in the array (length unchanged — never spliced).
6. Route cache: a cached route is dropped by `invalidateRoutes(i)` for an `i` inside its bbox and kept for one outside.
7. Sampling: two agents standing on tiles with `life 4` and `life 8` for 100 ticks → `sample().life === 6` after the day rolls; `mosq` mean likewise; `heat` 0 on a non-advisory day.
8. Class attendance: 10 agents assigned, 7 reach the class tile before Dusk → `classAttendance() === 0.7` after the Dusk read.
9. Flee: a gator placed within 2 tiles → the agent's state becomes `FLEE` and `agent:flee` fires once within 30 ticks.
10. Desire line: an agent crossing the same grass tile 40 times in a day → `wear ≥ 40` and one `agent:desireLine` event containing that tile at the day roll.
11. The direction mapping: moving `+tx` → `dir 0`, `+ty` → 1, `−tx` → 2, `−ty` → 3.
12. Founding arrival: with `students === 0` and no agents, `spawnArrival(s, 120, 'founding')` creates exactly 44 agents marked in-flight; a daily tick neither counts nor despawns them; after the pirogues land and the first agent reaches its goal the recorder holds one `agent:arrive{count:120, kind:'founding'}`.
13. Route queue dedup: 30 calls of `route(s, a, b)` for the same key in one tick enqueue one search; the 9th distinct key in a tick returns `null` and is answered next tick.
14. Shelter: `shelter(s, {0: 1, 1: 5})` with 3 agents → the nearest one takes building 0, the next two take building 1, none is assigned a full building.

## 7. Testing in isolation

```js
// scratch/test_agents.mjs
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true; const ctx = vm.createContext(win);
const load = f => vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
load('contract.js'); load('data.js');
vm.runInContext(`
  const life = new Float32Array(4096), green = new Float32Array(4096), shade = new Float32Array(4096), heat = new Float32Array(4096).fill(1);
  const dorm = { id: 0, type: 'dorm', tx: 20, ty: 20, w: 3, h: 2, built: 1, ruin: false, flooded: false };
  const hall = { id: 1, type: 'lecture_hall', tx: 30, ty: 20, w: 3, h: 2, built: 1, ruin: false, flooded: false };
  BSU.buildings = { list(s,t){ return [dorm, hall].filter(b => !t || b.type === t); }, get(s,id){ return [dorm,hall][id]||null; }, footprint(s,id){ const b=[dorm,hall][id]; return BSU.footprintTiles(b.tx,b.ty,b.w,b.h); }, effective(){ return 1; }, auras(){ return {life, green, shade, heat, dining:new Uint8Array(4096)}; }, shelterAssignments(){ return {}; }, at(){ return null; } };
  BSU.wildlife = { gators(){ return []; }, onCampus(){ return []; }, mosqAt(){ return 0; }, gatorGridPassable(){ return true; } };
  BSU.weather = { sky(s){ const c = s.tick % 300; const b=[25,155,175,200,300]; let p=0; while(c>=b[p]) p++; return {phase:p, t:0, phaseTick:0, scripted:false}; }, raining(){ return false; }, rainAt(){ return 0; }, heat(){ return {index:80,advisory:false,wave:false}; }, date(s){ return {day:s.calendar.day, month:1, semester:'spring'}; }, storm(){ return null; } };
  BSU.hydro = { depthAt(){ return 0; } }; BSU.sports = { season(s){ return s.sports; } }; BSU.progress = { timer(){ return null; }, timers(){ return []; } };   // the game struct is read as s.sports.game (null here) — never a module property
  BSU.sprites = { agentLook(n){ return n & 511; } };
`, ctx);
load('agents.js');
const BSU = win.BSU; const s = BSU.newState(4);
s.tiles.walk.fill(2); // open grass everywhere
for (let x = 20; x <= 33; x++) { s.tiles.walk[22*64 + x] = 1; s.tiles.surface[22*64+x] = 1; } // a path row
s.economy.students = 500; s.plot.founders = { tx: 40, ty: 7 };
BSU.agents.init(s); BSU.agents.reset(s, true);
console.log('agents', s.agents.length, s.agents[0].name, s.agents[0].home, s.agents[0].cls);
for (let t = 0; t < 3000; t++) { BSU.agents.tick(s, { newDay: t % 100 === 0 && t > 0, newMonth: false, newYear: false, day: Math.floor(t/100) }); s.tick++; }
console.log('attendance', BSU.agents.classAttendance(s), 'sample', BSU.agents.sample(s));
console.log(BSU.agents.selfTest());
```

## 8. Performance budget

- ≤ 1.5 ms per tick with 300 agents and ≤ 8 A* searches: keep agents in a plain array; per-agent work is a few array reads; the A* uses preallocated `Float32Array g`, `Int32Array parent`, a typed binary heap, and a generation counter instead of clearing arrays; off-screen agents at 1/4 rate.
- No allocation in the movement loop (routes are arrays created only by A*; reuse `sample` objects).
- Route cache bounded (≤ 2,000 entries; LRU by insertion order).

## 9. Done means

- `selfTest().ok`; the isolation script shows agents walking the path row to the hall during Day, home at Night, `classAttendance` between 0.5 and 1, and a non-zero `sample.n`.
- Full build: `node test/smoke.mjs` passes; `snapshot().agents === min(300, 40 + floor(students/25))` and is identical before/after save/load; in Chrome, students visibly walk from the pirogues up the tutorial path at 0:35, wade and splash in the 1:15 cell, flee a gator, sit under oaks at Golden Hour, and their dorm windows light when they go inside at Night; a desire line appears after a few sky cycles across a quad that lacks a path.
