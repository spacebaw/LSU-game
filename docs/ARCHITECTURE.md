# BAYOU STATE — ARCHITECTURE.md (the module contract)

**Status:** authoritative technical contract, v1. Read this together with `docs/GDD.md` (design, numbers), `docs/HEADLESS_API.md` and `test/smoke.mjs` (the executable headless contract; they win over the GDD), `docs/TESTING.md` (harnesses), and `src/js/contract.js` (written from §3 of this document; frozen once written). Where this document and the GDD disagree on an *interface* (a name, a signature, an owner, an order), this document wins and the GDD is updated. Where they disagree on a *number*, the GDD wins and `BSU.params` carries it.

Every implementer of a module sees exactly: this file, `contract.js`, `data.js` (if it exists yet), their brief, and the GDD. Two agents will never negotiate; if something here is ambiguous, the ambiguity is a bug in this file. Section 13 records every decision taken where the GDD was silent or self-contradictory.

Conventions used below: `T` = the current sim tick index (`state.tick`), "day" = calendar day (100 ticks), "block" = 10 ticks, `i = ty * 64 + tx`. Types are JSDoc-style. `Int16Array` etc. are the JS typed arrays. Money is dollars (integers); elevation, depth, crest, surge are feet (floats); durations are ticks or calendar days (never seconds, never wall-clock, except `playSeconds`).

---

## 1. Module list, files and manifest order

The GDD §0.2 module list is kept. Three modules are split into files to stay under ~2,000 lines each. **Every file is one `'use strict'` IIFE** that assigns into `window.BSU.<name>`; a split file *extends* the object its first file created (it must not replace it). `src/manifest.json` lists exactly these files in exactly this order:

| # | File | Assigns to | Owns (state branch it is the only writer of) | Depends on (read/call only) |
|---|---|---|---|---|
| 0 | `contract.js` | `BSU` (namespace), `BSU.T/B/SKY/OV/STORM/OBJ/SURF/FLAG/PLACE/SPR/EV`, `BSU.params`, `BSU.rng`, `BSU.events`, `BSU.newState`, `BSU.b64`, helpers, `BSU.contract.selfTest` (its selfTest lives on `BSU.contract` so `test/modules.mjs` finds it like every other module's) | nothing at runtime (creates the empty tree) | — |
| 1 | `data.js` | `BSU.data` | nothing (immutable tables) | contract |
| 2 | `terrain.js` | `BSU.terrain` | `tiles.elev, tiles.subs, tiles.flags` (bits 0,1,6,7,9,10,11), `tiles.surface`, `tiles.type`, `tiles.walk`, `tiles.wear` (decay only; agents increment), `tiles.sandbag/sandbagDay` (expiry only), `plot`, `veg` | data, hydro (read `depth`), buildings (read owner) |
| 3 | `hydro.js` | `BSU.hydro` | `tiles.depth, tiles.sat, tiles.stand`, `tiles.flags` bits 2 (canal, set by buildings via hydro API), 3 (drained), 4 (floodgate), 5 (pondSink); `hydro` branch (stages, surge front, pond capacities, canal networks, risk cache) | terrain, weather (rain events, stages), buildings (footprints, pumps, generators) |
| 4 | `weather.js` | `BSU.weather` | `calendar`, `sky`, `weather`, `storms` | data, buildings (Coastal Institute exists?), progress (Célestine hold: Objective 11 offered?) |
| 5 | `wildlife.js` | `BSU.wildlife` | `gators`, `wildlife` (nutria, officers, ecology, mosquito index, Le Grand, birds/fireflies counts), `tiles.mosq`, `tiles.integrity` (nutria burrows only; hydro also writes integrity on overtop/breach — see §5.4 for the rule), `tiles.flags` bit 8 unused | terrain, hydro, buildings, agents (positions for sampling) |
| 6 | `buildings.js` | `BSU.buildings` | `buildings[]`, `tiles.owner`, `tiles.crest`, `tiles.integrity` (placement, repair), `tiles.surface` (via terrain API), `runNames`, coverage maps, the protection/gap cache | data, terrain, hydro, economy (charge/refund), weather (date for construction) |
| 7 | `economy.js` | `BSU.economy` | `economy` (cash, students, prestige, happiness, tuition, sliders, loan, insurance, endowment, pool, statement, breakdowns), `ledger` | buildings, agents (samples), wildlife (ecology, mosquito index), sports (revenue events), progress (timers, read) |
| 8 | `agents.js` | `BSU.agents` | `agents[]` (not saved), `vehicles[]` (not saved), `tiles.wear` (increment), route cache, sampling accumulators, class-attendance counters | terrain (walk grid), buildings, weather (sky phase), wildlife (gator positions), hydro (depth) |
| 9 | `sports.js` | `BSU.sports` | `sports` (season, schedule, record, coach, starters, venue, game in progress, toggles) | data, buildings, economy (income), weather (dates, storm), progress (achievements via events) |
| 10 | `sprites.js` | `BSU.sprites` (atlas core, cache, `get`, `registerPainter`, palette helpers, terrain tile + decal + water painters) | none (atlas is derived, not state) | contract, data |
| 11 | `sprites_buildings.js` | extends `BSU.sprites` (`paintBuilding`, roof library, decal library, the 6 building variants, Ms. Thibodeaux portrait) | none | sprites |
| 12 | `sprites_entities.js` | extends `BSU.sprites` (agents, gators, Roux, officer, vehicles, trees, birds, floats, band, tents, bonfire, ruin, gates, the §12.3 table) | none | sprites |
| 13 | `render.js` | `BSU.render` (camera, chunk cache, draw list, water pass, frame pipeline, shake, screen↔world) | `ui.camera` (the camera is UI state, saved) | sprites, terrain, hydro, buildings, agents, wildlife, weather |
| 14 | `render_fx.js` | extends `BSU.render` (`particles`, weather FX, tint/lights/fog passes, overlays, minimap, postcard, perf guardrail) | none | render |
| 15 | `ui.js` | `BSU.ui` (DOM skeleton, HUD, palette, ghost, inspect, ticker, notifications, decision toasts, cards, title screen, settings, input state machine, keyboard, headless click/key) | `ui` branch except `ui.camera` (overlay, open panel, selected tool, settings mirror) | everything (read); writes only through `buildings.place/remove/…`, `economy.set*`, `weather/sports/progress` action functions |
| 16 | `ui_panels.js` | extends `BSU.ui` (Budget, Storm, Season, Milestones, Almanac, Founders' Day recap, damage report, debug panel, breakdown popovers) | none | ui |
| 17 | `audio.js` | `BSU.audio` | none (audio graph; settings mirror in `ui.settings`) | events only |
| 18 | `progress.js` | `BSU.progress` | `progress` (objectives, queues, milestones, timers, voice cards, tutorial stage, set-pieces-seen, Board/failure cards, recap data), `ticker[]` | everything (it is the only module allowed to *script* other modules through their action functions) |
| 19 | `session.js` | `BSU.session`, `BSU.state`, `BSU.headless`, `BSU.headlessMode` (finalizes), the main loop | `seed`, `tick`, `playSeconds`, `setPiece`, `saveMeta` | everything |

Load order = manifest order = `init` order = `reset` order = tick order (for the sim modules, see §5.1). A file may reference a *later* module only inside functions that run after boot (never at definition time, never inside `init`).

**Module shape (mandatory, identical for every module except `contract.js` and `data.js`):**

```js
'use strict';
(function () {
  const BSU = window.BSU;
  const M = (BSU.<name> = BSU.<name> || {});       // split files: `const M = BSU.<name>;`
  M.init = function (state) { /* once per page load: DOM, listeners, atlas, subscriptions */ };
  M.reset = function (state, fresh) { /* every newGame (fresh === true) and every load (fresh === false): rebuild caches from the new root; never keep the old root; rng.sim may be drawn here ONLY when fresh === true */ };
  M.tick = function (state) { /* one 100 ms sim tick; rate-gate internally on state.tick */ };
  M.selfTest = function () { return { ok: true, notes: '' }; };   // pure; no canvas; ≤ 200 ms
})();
```

`init(state)` is called exactly once per page load, in manifest order, by `session.boot()`. `reset(state, fresh)` is called on every `newGame` (`fresh === true`) and every `load` (`fresh === false`), in manifest order, after `BSU.state` has been replaced; a module must rebuild every cache it keeps (chunk cache, route cache, coverage, ring cache, sampling accumulators, atlas is *kept*). **`fresh` is the only way a module may tell the two cases apart** (never `tick === 0`, an empty array, a zero count or any other heuristic): when `fresh === true` the tree came straight from `terrain.gen` and the module initializes its per-game state (weather draws the Year-1 rain days and clears `calendar.running`; wildlife counts `wetlandOriginal` and spawns the initial gators; economy computes `applicants`/`capacity`); when `fresh === false` every saved field is already in the tree and the module rebuilds caches only — it must not draw `BSU.rng.sim`, spawn, schedule, clear or overwrite anything saved. **Rule: `BSU.rng.sim` may be drawn inside `reset` only when `fresh === true`.** `tick(state)` is called by `session.js` only for the sim modules in the order of §5.1; presentation modules (`sprites`, `render`, `render_fx`, `ui`, `ui_panels`, `audio`) have no `tick` and are driven by `render.frame`, `ui.update` and events. `contract.js` and `data.js` have neither `init` nor `tick` (they are pure definitions) but do have `selfTest`.

**Queries during `gen`/`reset` — self-healing caches.** `newGame` runs `terrain.gen` before any `reset`, and the `reset`s run in manifest order, so a module's `gen`/`reset` may call a *later* module (terrain 2 → hydro 3 `seedInitial/surfaceAt/stageAt/drainsTo`; terrain → wildlife `nutriaTraps`; wildlife 5 → buildings 6 `stats`; ui 15 → progress 18 `unlocked`) whose closures still point at the previous root (or, on the first game, at the boot dummy). Every query function in the following list must therefore be **pure over its `state` argument** or **self-heal** with `if (cacheRoot !== state || cacheDay !== state.calendar.day) rebuild(state)` before answering: `hydro.seedInitial/surfaceAt/stageAt/depthAt/drainsTo/networks/networkAt/riverAdjacent`, `buildings.get/list/at/count/has/footprint/stats/unlocked/effective/shelterAssignments`, `wildlife.nutriaTraps/ecology/onCampus/campusMask`, `progress.unlocked/unlockOk/unlockReason/earned/timer/timers/offered`, `terrain.isLand/isWater/walkClassOf/landRoute`. A cache keyed on the root object (`cacheRoot === state`, and on `calendar.day` for per-day caches such as `buildings.stats`) is the required idiom; a cache keyed on nothing is a bug. `terrain.gen` keeps calling `classify` + `rewalk` at the end of generation (no two-pass reset).

---

## 2. The global state: `BSU.state`

`BSU.newState(seed)` (in `contract.js`) returns the complete tree below with every field present at its initial value, every typed array allocated at length 4,096, and no module-private objects. Modules never add top-level keys; a module that needs private per-game data puts it under its own branch (e.g. `state.hydro.*`) or keeps it in a closure and rebuilds it in `reset`. `contract.js` is frozen, so a branch owner that needs a **new saved sub-key** initializes it lazily in its own `reset` (both `fresh` cases: `state.hydro.heldStage ??= 0`) and lists it in this section under "lazily initialized"; the structural save rule of §8.1 saves it automatically and `load` keeps it (unknown keys in a doc are copied, never dropped). The tree is plain data: no classes, no functions, no cycles, no `Map`/`Set` (JSON-able except the typed arrays, which the save encodes as base64). Every branch is listed with **owner** (the only writer), **saved** (yes/no) and **initial** value.

### 2.1 Root

| Field | Type | Owner | Initial | Saved |
|---|---|---|---|---|
| `v` | `1` | contract | 1 | yes (schema version) |
| `seed` | `number` (uint32) | session | argument | yes |
| `tick` | `number` | session | 0 | yes (ticks since founding; incremented at the end of every sim tick) |
| `playSeconds` | `number` | session | 0 | yes (browser: wall-clock seconds of unpaused play; headless: `tick / 10`) |
| `setPiece` | `null \| SetPiece` | session | null | yes (a save written mid-set-piece resumes at its tick) |
| `saveMeta` | `{slot: string, savedAt: number, label: string}` | session | `{slot:'', savedAt:0, label:''}` | yes |
| `calendar` | §2.4 | weather | — | yes |
| `sky` | §2.4 | weather | — | yes |
| `weather` | §2.4 | weather | — | yes |
| `storms` | §2.5 | weather | — | yes |
| `tiles` | §2.2 | (per array) | — | yes (all arrays) |
| `plot` | §2.3 | terrain | — | yes |
| `veg` | `Veg[]` | terrain | `[]` | yes |
| `buildings` | `Building[]` | buildings | `[]` | yes |
| `runNames` | `Object<string,string>` | buildings | `{}` | yes |
| `hydro` | §2.3 | hydro | — | yes |
| `agents` | `Agent[]` | agents | `[]` | **no** (regenerated) |
| `vehicles` | `Vehicle[]` | agents | `[]` | **no** |
| `gators` | `Gator[]` | wildlife | `[]` | yes |
| `wildlife` | §2.6 | wildlife | — | yes |
| `economy` | §2.7 | economy | — | yes |
| `ledger` | §2.7 | economy | — | yes |
| `sports` | §2.8 | sports | — | yes |
| `progress` | §2.9 | progress | — | yes |
| `ticker` | `TickerLine[]` | progress | `[]` | yes (last 30) |
| `ui` | §2.10 | ui / render | — | yes (`camera`, `overlay`, `speed` live here) |
| `rng` | `{sim: number}` | contract/session | `{sim: seed ^ 0x9E3779B9}` | yes |

`SetPiece = {kind: 'landfall'|'nearMiss'|'game'|'parade'|'graduation'|'montage', tick: number (0-based within the set piece), len: number (900/150/750/250/150/50), skippable: boolean, choices: Object<string, string> (decision toast id → 'yes'|'no'|'default'), speedBefore: 0|1|2|4, cameraTouched: boolean}`.

### 2.2 `state.tiles` (index `i = ty * 64 + tx`; all length 4,096; all saved)

| Array | Ctor | Owner (writer) | Initial (land / marsh / water) | Meaning |
|---|---|---|---|---|
| `elev` | Float32Array | terrain (gen, subsidence, grading, pond cut, canal is **not** elev) | generated | ground elevation ft, −4…+14 |
| `depth` | Float32Array | hydro | 0 / 0.15–0.40 / stage−elev | standing water ft ≥ 0 |
| `sat` | Float32Array | hydro | 0.5 / 0.9 / 1 | soil saturation 0–1 |
| `stand` | Uint8Array | hydro | 0 | consecutive days with depth ≥ 0.05 (saturates at 255) |
| `mosq` | Float32Array | wildlife | 0 | mosquito density 0–1 |
| `subs` | Float32Array | terrain | 0 | cumulative subsidence ft |
| `crest` | Uint8Array | buildings | 0 | 0 / 6 / 12 ft (levee / floodwall) |
| `integrity` | Uint8Array | buildings (place=100, repair), hydro (overtop −10/day, surge contact, breach→0), wildlife (burrow −15) | 0 (100 when a crest is placed) | levee integrity |
| `sandbag` | Uint8Array | buildings (Sandbags action writes 15), terrain (daily expiry writes 0) | 0 | tenths of a foot |
| `sandbagDay` | Uint16Array | buildings / terrain | 0 | absolute day of expiry |
| `wear` | Uint8Array | agents (+1 per crossing), terrain (−5/day) | 0 | desire-line wear |
| `flags` | Uint16Array | see `BSU.FLAG` (§3.1) for the per-bit owner | generated | bit flags |
| `surface` | Uint8Array | terrain (`setSurface` API; called by buildings) | 0 (Highway 1 stub = 2) | `BSU.SURF` |
| `owner` | Int16Array | buildings | −1 | index into `buildings[]` or −1 |
| `type` | Uint8Array | terrain (`classify`) | derived | `BSU.T` |
| `walk` | Uint8Array | terrain (`rewalk`) | derived | 0 blocked, 1 path class, 2 dry, 3 wet, 4 wading |

The brief's `tileType`, `walkCost` and `buildingAt` are these `type`, `walk` and `owner` arrays (the GDD's names are kept; `tiles.owner` is the only footprint index). Two derived arrays are **not** in the tree (rebuilt by their owner in `reset`): the hydro back buffer and the chunk-dirty bitmap (render).

### 2.3 Terrain and hydro branches

```js
state.plot = {                     // terrain; saved
  bank0: number,                   // bank(7)
  rect: {x0, y0, x1, y1},          // G1 rectangle, inclusive
  founders: {tx, ty},              // reserved 3×3 origin (bank0−7, 7)
  highway: number[],               // tile indices of the Highway 1 stub, north to south
  oaks: number[],                  // the two flanking oak tile indices
  cove: number[],                  // G2 cove tile indices (floor tiles, 1.6–2.5 ft)
  mouth: number[],                 // the 3 lip tiles; mouth[1] is the middle lip
  landing: number,                 // Pirogue Landing bayou tile index
  landingShoulder: number,         // the Marsh shoulder tile the Objective-2 path ends on
  mounds: number[],                // 2 tile indices
  cheniers: {cx, cy, tiles: number[]}[],
  bayou: number[],                 // spline tiles in order from the north edge (parameter order; "upstream" = smaller index)
  lake: number[],                  // cypress lake tiles
  template: boolean                // true if the hand-authored fallback map was used
};
state.hydro = {                    // hydro; saved
  riverStage: number,              // current boundary stage of Open Water river tiles (ft), 0 normally
  bayouStage: number,              // current Bayou stage (ft)
  surge: null | {stage: number, target: number, entry: number[] /*the 8 entry tiles weather passed to surgeControl('begin')*/, dir: 'S'|'E', reached: number /*front distance activated so far*/, t0: number /*state.tick at 'begin'*/},
                                   // the BFS front (a Uint16Array of distances from `entry`, 65535 = unreachable) is NOT in state: hydro keeps it in a closure and rebuilds it in reset
                                   // from `entry` (the BFS is a pure function of entry, so a save mid-landfall restores the identical front); readers call hydro.surgeReached(state, i)
  barrierClosed: boolean,
  pondCap: Object<string, number>, // key = building index → remaining tile-ft (≤ 20)
  networks: null,                  // NOT saved; rebuilt in reset (canal chains)
  risk: null,                      // NOT saved; the F-overlay cache {depth: Float32Array, validUntilDay, dirty}
  active: null,                    // NOT saved; Uint8Array active-set mask
  heldStage: number,               // lazily initialized by hydro.reset (0): the bayou stage frozen upstream of a closed Surge Barrier; saved
  spillwayOffset: number           // lazily initialized by hydro.reset (0): Bonnet Roux Spillway effect (Tier 2); saved
};
```
(`networks`, `risk`, `active` are listed so implementers know they exist; `session.save` strips every path in `BSU.SAVE_SKIP` and saves every other enumerable key of the branch — see §8.1.)

`Veg = {type: 'oak'|'cypress'|'palmetto', tx: number, ty: number, stage: 0|1|2, plantedDay: number, planted: boolean}` (`planted` = player-placed; generated trees are `false`).

### 2.4 Calendar, sky, weather (owner: weather; all saved)

```js
state.calendar = {
  day: number,        // absolute calendar day since founding, 0 = Jan 1 Y1
  dayTick: number,    // 0–99 within the day
  running: boolean,   // false until the tutorial's first path (skipTutorial: true from tick 0)
  frozen: boolean,    // derived each tick: !running || state.setPiece !== null; written by weather for readers
  year: number,       // 1-based, = floor(day/120)+1
  month: number,      // 1–12, = floor(day/10) % 12 + 1
  dom: number,        // 1–10, = day % 10 + 1
  season: 'spring'|'summer'|'fall'|'winter',   // Mar–May, Jun–Aug, Sep–Nov, Dec–Feb (Dec 11–Jan 4 is still 'winter')
  semester: 'spring'|'summer'|'fall'|'break'   // Jan 5–May 5, May 6–Aug 4, Aug 5–Dec 10, Dec 11–Jan 4
};
state.sky = {
  phase: number,      // BSU.SKY.DAWN..NIGHT
  phaseTick: number,  // ticks into the phase
  cycleTick: number,  // 0–299 within the 300-tick cycle (advances every unpaused tick; scripted during set pieces)
  scripted: boolean,  // true while a set piece drives the sky
  t: number           // 0–1 progress within the phase (for tint blending), written for renderers
};
state.weather = {
  rainDays: {day: number, kind: 'shower'|'frontal'|'cell'}[],   // this year's draw (Jan 1)
  event: null | {kind: 'shower'|'frontal'|'cell'|'band'|'hurricane', total: number /*ft*/, stepsLeft: number, steps: number, cx: number, cy: number, radius: number, lightning: boolean, scripted: boolean},
  cellQueue: {day: number, cx: number, cy: number, total: number, scripted: boolean}[],   // scheduled cells (the 1:15 and Apr 5 cells are pushed here by progress)
  heat: number,       // today's heat index °F
  heatWaveDays: number,
  wind: number,       // 0–1 (0.6+ in storms; drives sway)
  windAngle: number,  // radians, for rain slant
  fog: number,        // 0–1
  rainRate: number,   // 0–1 for FX: 0 dry, 1 hurricane (render maps to line counts)
  riverStage: number, // this spring's drawn stage (1–3 ft), Year 2+; 0 in Year 1
  spillwayUsedYear: number,
  clearNightDay: number,   // −1 or the absolute day whose rain is suppressed (scripted first night game)
  dtDay: number       // the hydro dt for THIS tick's hydro step (0, 1/40, 1/60, 1/360); written every tick
};
```

### 2.5 Storms (owner: weather; saved)

```js
state.storms = {
  current: null | Storm,
  scheduled: {day: number, cat: number, nearMiss: boolean, name: string, point: number /*edge tile index*/}[],  // Years 2+, drawn Jan 1
  log: {name: string, cat: number, year: number, day: number, nearMiss: boolean, damage: number, tarps: number, held: boolean}[],
  nameIndex: number,                 // next name from data.stormNames
  celestine: {state: 'pending'|'held'|'cone'|'done', coneDay: number},
  playThroughIt: boolean,            // toggle for the current storm
  lastLandfallDay: number            // −1 if none
};
// Storm (the live struct):
// {name, cat (1–5, actual), forecastCat, nearMiss, phase: BSU.STORM.*, coneDay (absolute day the cone appeared),
//  landfallDay (absolute day; T0), tLandfall (absolute tick at which the set piece starts, or −1 until known),
//  point (edge tile index), entry: number[] (the 8-wide entry segment tile indices), track: {tx,ty}[] (for the cone),
//  coneWidth (tiles, shrinks daily), surge (ft, forecast = BSU.params.storm.surge[cat]),
//  jammedGates: number[] (tile indices), rolls: {towerTopple: boolean, substationOutages: number[] (building indices), fenceBreaks: number[] (tile indices)} (decided at set-piece tick 150),
//  boardQueue: number[] (building indices in crew order), boardedCount, evacuated: boolean, preDrain: boolean, sandbagged: boolean,
//  toasts: {shelter: boolean, sandbag: boolean, fuel: boolean, gate: boolean},
//  damageReport: null | {bill, tarps, held: number[], overtopped: number[], breached: number[], flooded: number[], choices: Object}}
```

### 2.6 Wildlife (owner: wildlife; saved unless noted)

```js
state.gators = Gator[];   // Gator = {id, name, tx, ty (float), px, py (prev, not saved), dir, state: 'SUN'|'SWIM'|'WANDER'|'LOUNGE'|'RETREAT'|'WRANGLED',
                          //          size: 'juvenile'|'big'|'legend', den: number (tile index), target: number|−1, route: number[] (not saved; replanned), lounge: number (ticks left),
                          //          onCampus: boolean, lastIncidentDay: number, tag: number (ticks the name tag stays shown)}
state.wildlife = {
  nutria: number,                    // abstract population
  leGrandDay: number,                // absolute day Le Grand appears this year, −1 when gone
  leGrand: null | Gator,             // present only Apr for 3 days
  officers: {post: number /*building index*/, tx, ty, state: 'IDLE'|'WALK'|'WRANGLE'|'RETURN', target: number /*gator id*/, cooldown: number}[],
  relocations: number,               // lifetime count (Gator Wrangler)
  incidents: {day: number, gatorId: number, tile: number}[],   // last 10 days
  ecology: number,                   // 0–100, recomputed daily
  ecologyTerms: Object<string, number>,   // breakdown for the popover
  foggerPenalty: number,             // 0–15
  mosqIndex: number,                 // mean mosq over agent tiles (daily)
  mosqWarnedDay: number,             // −1 until the first warning
  biblicalDays: number,
  campusMask: null,                  // NOT saved: Uint8Array "campus" set (§6.3)
  fireflies: number,                 // target count for FX
  birds: {egrets: number, spoonbills: boolean, pelicans: number},
  wetlandOriginal: number,           // count of bit0 tiles at generation
  // lazily initialized by wildlife.reset when absent (contract.js is frozen); all saved:
  sick: number,                      // students out sick today (mosquito + heat); economy copies it into economy.sick; readers use state.wildlife.sick
  beadsDay: number,                  // −1, or the absolute day gators wear Mardi Gras/Halloween beads (render reads state.wildlife.beadsDay)
  burrowLog: Object<string, {n: number, day: number}>   // keyed by tile index: nutria burrow count and last day (inspect panel, render decals)
};
```

### 2.7 Economy and ledger (owner: economy; saved)

```js
state.economy = {
  cash: number,                 // 4_000_000
  students: number,             // 0 (120 after the arrival; skipTutorial: 120 at tick 0)
  alumni: number,               // 0
  prestige: number,             // 10 (displayed and used; the monthly lerp target is in `targets`)
  happiness: number,            // 60 (the displayed EMA)
  happinessRaw: number,         // last computed instantaneous value
  ecology: number,              // mirror of wildlife.ecology, copied daily AFTER wildlife.tick (read-only mirror for the HUD)
  tuition: number,              // 6500
  quality: 'basic'|'good'|'elite',
  selectivity: 'open'|'selective'|'elite',
  coaching: number,             // $/yr, 0
  ticket: 25|35|60,
  autoRepair: boolean,          // true
  interestPaid: number,         // lifetime interest paid; the loan balance itself is derived: max(0, −cash)
  loanLimit: number,            // 2_000_000
  negMonths: number,            // consecutive months below −loanLimit
  insurance: boolean,           // Board card
  endowment: number,            // 0
  westCampus: boolean,
  pool: number,                 // applicants remaining this cycle (since the last Aug 5)
  applicants: number,           // recomputed on the 1st
  capacity: number,             // recomputed daily (beds/seats/dining/wastewater)
  capacityTerms: {beds, seats, dining, wastewater},
  targets: {prestige: number, terms: Object<string, number>},   // structural target and its term breakdown
  happyTerms: Object<string, number>,   // every §5.6 term by name (abstract + sampled + events), for the popover
  attendanceCycles: number[],   // classAttendance per completed sky cycle since the last 1st
  sick: number,                 // students out sick today
  suspendCapPenalties: boolean, // true until Objective 3 completes (skipTutorial: false)
  suppressCoverage: boolean,    // true until Objective 5 completes (skipTutorial: false)
  runway: {months: number, nextPayDay: number, red: boolean}
};
state.ledger = {
  month: {income: Object<string, number>, expense: Object<string, number>},   // accumulating this month
  last:  {income: Object<string, number>, expense: Object<string, number>, net: number},   // last completed month (Budget panel)
  year:  {income: number, expense: number, construction: number},
  history: {year: number, students: number, cash: number, prestige: number, happiness: number, ecology: number, wins: number, losses: number, tarps: number}[]   // one row per completed year (Almanac sparklines)
};
```
Income/expense keys (fixed strings; the Budget panel prints them in this order): income `tuition, state, donations, research, athletics, tailgate, parking, festivals, pelts, grants, endowment, disaster, insurance, misc`; expense `salaries, upkeep, utilities, coaching, interest, repair, prep, construction, demolition, boardCards, misc`.

### 2.8 Sports (owner: sports; saved)

```js
state.sports = {
  hasTeam: boolean,                 // Practice Field exists
  venue: 'none'|'bayou_field'|'stadium1'|'stadium2'|'stadium3',   // largest existing home venue
  seasonYear: number,               // the year of the schedule below
  schedule: {day: number, opp: string /*data.opponents key*/, home: boolean, kind: 'regular'|'homecoming'|'rivalry'|'bowl'|'club'|'makeup', night: boolean, played: boolean, result: null|{home: number, away: number, won: boolean}, postponedTo: number|-1}[],
  record: {wins: number, losses: number, last4: boolean[]},
  lastSeason: {wins: number, losses: number, bowlWon: boolean, undefeated: boolean},
  coach: {name: string, stars: number, hiredYear: number, quote: string, rep: string},
  candidates: {name, stars, quote, rep}[],   // offseason hire card
  starters: {name: string, pos: 'QB'|'RB'|'WR'|'LB', hometown: string, rating: number}[],   // 3
  recruit: null | {price: string, pos: string, name: string, offeredDay: number, accepted: boolean},
  rating: number,                   // recomputed daily
  ratingTerms: Object<string, number>,
  nightToggle: boolean,             // player toggle for non-forced night games (Stadium II+)
  autoSim: boolean,
  permits: 'paid'|'free',
  homecomingBudget: 0|50000|150000,
  rivalryLossStreak: number,
  game: null | {day: number, opp: string, r: number, P: number, P2: number, home: boolean, night: boolean, quarter: number, scores: number[][] /*[home[q], away[q]]*/, homePts: number, awayPts: number, decided: boolean, wentForIt: boolean, swing: number, attendance: number, revenue: number, playThrough: boolean, halftimeAnswered: boolean},
  firstHomeGameDay: number,         // −1 until played
  firstNightGameDay: number,        // −1 until played
  scriptedNightDay: number          // −1 or the absolute day forced clear (§10.4)
};
```

### 2.9 Progress (owner: progress; saved)

```js
state.progress = {
  tutorialStage: number,            // 0 title/charter … 6 free play; skipTutorial → 6
  objectives: Object<string, {state: 'locked'|'queued'|'active'|'done'|'dismissed', progress: number, goal: number, since: number, deadlineDay: number, text: string}>,   // keyed by objective id ('1'…'5','6','7','8','9','10','11','11a','12','13','14','15','16','17','18a','18b','18','19','20','21','22')
  card: string|null,                // objective id currently on the card (interrupt, or background when no interrupt)
  background: string|null,          // active background objective id
  interruptQueue: string[],
  backgroundQueue: string[],
  milestones: Object<string, {earned: boolean, day: number}>,   // keyed by milestone id (§3.6 list)
  timers: {id: string, untilDay: number, value: number, meta?: Object}[],   // EVERY timed modifier in the game (§5.6 table + insurance, Board effects, boil water, cajunNavy, playThroughIt, austerity, festival buffs). untilDay = -1 means open-ended ("while the source exists"; the owner removes it) in the LIVE state and in the save alike; it is NEVER Infinity (§10.3, D23). A timer is active while untilDay === -1 || untilDay > day; it expires when untilDay >= 0 && untilDay <= day.
  voiceCards: {id: string, state: 'unseen'|'active'|'done'|'declined', offeredDay: number}[],
  boardCards: {offeredDay: number, cards: string[], chosen: string|null}[],
  failure: {bankruptcy: number /*card count*/, receiverUntilDay: number, probation: boolean, underwaterDays: number, pendingKind?: string|null /*lazily initialized: the failure card kind awaiting an answer (ui opened it on econ:card)*/},
  setPiecesSeen: {landfall: boolean, game: boolean, parade: boolean, graduation: boolean},
  firsts: {gatorDay: number, mosquitoDay: number, floodDay: number, cellDay: number},   // −1 until seen
  recap: null | {year: number, lines: string[], best: string, sparks: Object},
  achievementsWhileDebug: boolean,  // true while the debug panel is open (no achievements)
  hints: Object<string, boolean>,   // one-time hints shown ('mute', 'saveUnavailable', 'pauseToPlan', 'desireLine'); readers use state.progress.hints (never a module property)
  // lazily initialized by progress.reset when absent (contract.js is frozen); all saved:
  forceFirefliesDay: number,        // −1, or the absolute day render must draw at least the ecology-50 firefly count (Objective 16 night, the scripted night game)
  drainedEver: boolean              // any marsh:drained ever (milestone `untouched`)
};
state.ticker = {day: number, tick: number, text: string, subject: number|-1 /*tile index to pan to*/, kind: 'water'|'wildlife'|'money'|'event'|'danger'|'sports'|'info'}[];   // newest last, ≤ 30
```

### 2.10 UI (owner: ui, except `camera` which render owns; saved)

```js
state.ui = {
  camera: {x: number, y: number, zoom: 0.5|1|2, tx: number, ty: number /*target for easing; not saved*/, follow: number|-1 /*agent id*/},   // x,y = world px (zoom-1 space) at the viewport center
  overlay: number,                  // BSU.OV.NONE..ECOLOGY
  speed: 0|1|2|4,                   // the SETTING (0 = paused); the effective rate is computed by session (§9.3)
  speedBefore: 0|1|2|4,             // restored after a set piece / hold / first-warning drop
  tool: null | {id: string, rot: 0|1, shift: boolean},   // NOT saved
  panel: null | 'budget'|'storm'|'season'|'almanac'|'milestones'|'settings'|'debug',   // NOT saved
  paletteTab: string,               // last open tab; saved
  tabsSeen: Object<string, boolean>, newPips: Object<string, boolean>, tabsIntroduced: Object<string, boolean>,   // saved
  settings: {volume: number, muted: boolean, particles: 'low'|'high', shake: boolean, colorblind: boolean, autoSimHint: boolean},   // mirrored to localStorage 'bsu.settings'
  perfMode: boolean                 // NOT saved
};
```

### 2.11 Entity structs

```js
// Building (footprint rows only; drag tiles live in state.tiles). Index in state.buildings[] is its stable id for the life of the save
// (removed buildings become `null` entries — never splice — so tiles.owner and cross-references stay valid; save writes nulls).
Building = {
  id: number,                 // == its index in buildings[]
  type: string,               // BSU.B key / catalog id
  tx: number, ty: number,     // footprint origin (north-west tile)
  w: number, h: number,       // footprint after rotation
  rot: 0|1,
  name: string,               // auto-name, player-renamable
  hp: number,                 // 1 − damage fraction, 0–1 (1 = undamaged; 0 = ruin)
  built: number,              // 0–1 construction progress (1 = complete)
  builtDay: number,           // absolute day completed (−1 while building)
  pilings: boolean,
  sunk: number,               // ft the building has sunk (for the retrofit price)
  powered: boolean, watered: boolean,   // coverage results (written by buildings.recomputeCoverage)
  provider: {power: number|-1, water: number|-1},   // assigned provider building ids
  flooded: boolean,           // ≥ 0.5 ft (≥ 3.0 on pilings) at the deepest footprint tile
  floodedSince: number,       // absolute day, −1 if dry
  closedUntil: number,        // absolute day; −1 none (shelter overflow, retrofit, re-grade)
  blackout: boolean,          // provider is out (substation flooded / wind outage / generator dry)
  tier: number,               // Stadium 1–3; Practice Field 0–1 (Bayou Field); others 0
  upgradeDoneDay: number,     // −1 or the day an in-place tier upgrade completes
  ruin: boolean,
  tarp: boolean,              // damaged and unrepaired → tarp decal
  data: {                     // saved verbatim; only the keys below are defined
    fuelDays: number,         // generator
    stockedDay: number,       // pond (−1 until stocked)
    active: boolean,          // abatement on/off
    policies: {gatorProofDumpsters: boolean, nutriaBounty: boolean},
    boardedUntil: number,     // absolute day; −1 none
    regradeUntil: number,
    dumpsterTile: number,     // dining hall (−1 none)
    seed: number              // per-building sprite seed (window pattern, name)
  }
};
Agent = {                     // NOT saved
  id: number, tx: number, ty: number,   // float tile coords (center of tile = integer + 0.5)
  px: number, py: number,     // previous tick position (render interpolation)
  dir: 0|1|2|3, anim: string, frame: number,
  state: 'IDLE'|'WALK'|'FLEE'|'WADE'|'SIT'|'CHEER'|'SHELTER'|'BUS'|'GONE',
  goal: string,               // 'class'|'dining'|'idle'|'home'|'shelter'|'event'|'poboy'|'library'
  target: number|-1,          // building id or tile index
  route: number[], routeIdx: number, waitTicks: number,
  home: number|-1, cls: number|-1,   // dorm id, class building id
  mood: number, energy: number, wet: number, bitten: number,
  name: string, major: string, year: 1|2|3|4, look: number /*sprite variant int*/,
  prop: 'none'|'umbrella'|'foam'|'beads'|'cap'|'tube',
  sample: {life: number, green: number, mosq: number, heat: number, n: number},   // per-day accumulators
  reachedClass: boolean
};
Vehicle = {kind: 'fogger'|'bus'|'pirogue'|'cajunNavy'|'crew', tx, ty, px, py, route: number[], routeIdx, state, payload: number, ttl: number};
```

---

## 3. `contract.js` public surface (frozen)

`contract.js` creates `window.BSU = {}` and everything below. It reads `window.__headless`, `requestAnimationFrame`, `document` and `navigator` **only** to compute `BSU.headlessMode` (inside a try/catch) and touches nothing else at load.

### 3.1 Enums (plain frozen objects; values are small integers unless stated)

```js
BSU.T    = { OPEN_WATER: 0, BAYOU: 1, MARSH: 2, WET: 3, DRY: 4, HIGH: 5, DRAINED: 6, POND: 7 };   // tiles.type
BSU.SURF = { NONE: 0, PATH: 1, ROAD: 2, BOARDWALK: 3, FENCE: 4 };                                  // tiles.surface
BSU.FLAG = { WETLAND_ORIGINAL: 1<<0 /*terrain*/, PRESERVE: 1<<1 /*terrain*/, CANAL: 1<<2 /*hydro*/, DRAINED: 1<<3 /*hydro*/,
             FLOODGATE: 1<<4 /*hydro*/, POND_SINK: 1<<5 /*hydro*/, BAYOU: 1<<6 /*terrain*/, OPEN_WATER: 1<<7 /*terrain*/,
             DIRTY_CHUNK: 1<<8 /*unused: render keeps its own bitmap*/, DESIRE_WORN: 1<<9 /*terrain*/, DEBRIS: 1<<10 /*terrain*/,
             MOUND: 1<<11 /*terrain*/, RESTORING: 1<<12 /*hydro: Marsh Restoration in progress*/, JAMMED: 1<<13 /*hydro: mirrors storm.jammedGates via hydro.setJammed*/ };
BSU.SKY  = { DAWN: 0, DAY: 1, GOLDEN: 2, DUSK: 3, NIGHT: 4 };
BSU.SKY_TICKS = [25, 130, 20, 25, 100];   // per phase; sum 300 (§0 sky clock, 30 s at 1×)
BSU.OV   = { NONE: 0, FLOOD: 1, WATER: 2, MOSQUITO: 3, POWER: 4, COVERAGE: 5, ECOLOGY: 6 };
BSU.STORM = { NONE: 0, WAVE: 1, NAMED: 2, WATCH: 3, BANDS: 4, LANDFALL: 5, RECOVERY: 6, PASSED: 7 };
BSU.STORM_PHASE = { OUTER: 0, WALL: 1, LANDFALL: 2, EYE: 3, BACK: 4, CLEARING: 5 };   // set-piece phases (storm:phase payload)
BSU.OBJ  = { INTERRUPT: 0, BACKGROUND: 1 };
BSU.PLACE = { LAND: 0, PATH: 1, ROAD: 2, BOARDWALK: 3, LEVEE: 4, CANAL: 5, FENCE: 6, PRESERVE: 7, NEAR_WATER: 8, TOUCH_MARSH_BAYOU: 9,
              TOUCH_CANAL_WATER: 10, CYPRESS: 11, MARSH_OR_PRESERVE: 12, BARRIER: 13, RESTORE: 14, UPGRADE: 15 };   // catalog placeRule
BSU.SPR  = { NIGHT: 1, DAMAGED: 2, PILINGS: 4, SCAFFOLD: 8, RUIN: 16, TIER_SHIFT: 5, TIER_MASK: 3<<5, BOARDED: 128 };  // building sprite variant bits
BSU.B    = { /* the 43 catalog ids as string constants, id → id: */ path:'path', road:'road', boardwalk:'boardwalk', substation:'substation',
             water_tower:'water_tower', generator:'generator', wastewater:'wastewater', founders_hall:'founders_hall', lecture_hall:'lecture_hall',
             library:'library', engineering:'engineering', coastal_institute:'coastal_institute', dorm:'dorm', res_tower:'res_tower',
             greek_house:'greek_house', dining_hall:'dining_hall', poboy:'poboy', practice_field:'practice_field', stadium:'stadium', union:'union',
             rec_center:'rec_center', health_center:'health_center', quad:'quad', parking:'parking', levee:'levee', floodwall:'floodwall',
             canal:'canal', pump:'pump', pond:'pond', pilings:'pilings', gator_fence:'gator_fence', abatement:'abatement', bat_house:'bat_house',
             wildlife_post:'wildlife_post', preserve:'preserve', live_oak:'live_oak', cypress:'cypress', azalea:'azalea', bell_tower:'bell_tower',
             tiger_habitat:'tiger_habitat', surge_barrier:'surge_barrier', marsh_restoration:'marsh_restoration', rookery:'rookery' };
BSU.B_ORDER = [ /* the 43 ids in §0.3 row order */ ];
BSU.SAVE_VERSION = 1;
BSU.MAP = { W: 64, H: 64, N: 4096, TILE_W: 64, TILE_H: 32, PX_PER_FT: 6, CHUNK: 8, CHUNK_W: 512, CHUNK_H: 416 };
BSU.SAVE_SKIP = ['agents', 'vehicles', 'hydro.networks', 'hydro.risk', 'hydro.active', 'wildlife.campusMask', 'ui.tool', 'ui.panel', 'ui.perfMode', 'ui.camera.tx', 'ui.camera.ty'];
```
Building ids are **strings** (the catalog key); `BSU.B` exists so a typo is a `undefined` at the call site instead of a silent string. Milestone ids (strings, `progress.milestones` keys): `chartered, welcome, cajunEngineer, firstBell, wetFeet, highAndDry, stormChaser, eyeOfTheStorm, gatorWrangler, sunbather, skeeterBeater, bayouField, nightFalls, geauxBeatMagnolia, undefeated, bigBoil, throwMeSomethin, greenAndGold, fortressBayou, livingWithWater, lightsAreOn, sinkingFeeling, rebuiltFromTheRoux, flagship, laissez, untouched` (in §10.5 order; `BSU.MILESTONES` is that array).

### 3.2 `BSU.params` (every tuning constant; each carries its GDD section in a comment; the debug panel enumerates the leaves)

Names only (values are the GDD's). Grouped by sub-object; leaves are numbers or arrays of numbers.

- `params.time` (§0.1): `tps 10, ticksPerDay 100, daysPerMonth 10, monthsPerYear 12, daysPerYear 120, skyCycleTicks 300, skyPhaseTicks [25,130,20,25,100], landfallTicks 900, nearMissTicks 150, gameTicks 750, paradeTicks 250, graduationTicks 150, montageTicks 50, toastTicks 80, windPulseTicks [250,380,550,680], windPulseShare [1/3,1/3,1/6,1/6], firstWarningDropTicks 100, maxTicksPerFrame 8, speeds [0,1,2,4], skipAfterTick 150`.
- `params.terrain` (§3.3–3.5): `bankBase 58, bankAmp 2, bankPeriod 9, ridgeD 22, ridgeExp 1.3, ridgeAmp 7, crownRows [6,13], crownFactors {crown 1.0, shoulder 0.7, flank 0.42, reachEnd 0.25}, reachRow 34, baseNorth 2.0, baseSouth 1.0, noiseAmp 0.5, noiseAmpPlot 0.3, noiseScale 5, basinBase 1.0, basinAmp 1.8, basinClamp 3.4, basinScale 11, southBeltRow 50, southBeltBias 0.8, lake {cx 10, cy 54, rx 6, ry 4, elev -2}, cove {dx -8, ty 16, rx 2.5, ry 2, floor 1.6, rimAdd 0.9, rimMin 2.6, mouthElev 2.2}, bayou {x0 30, spread 4, elev -1, shoulderElev 0.5, width 2}, chenierCount [5,7], chenierAxes {ax [5,7], ay [3,4], rim 2.0, crest [6.5,7.5]}, moundGap [4,6], moundLift 2, veg {oak 0.08, cypress 0.14, palmetto 0.06, reed 0.25}, distribution {water 0.11, bayou 0.03, marsh 0.40, wet 0.30, dry 0.12, high 0.04, tol 0.03}, g1b [72,110], g7 [300,400], maxRerolls 50, typeBounds {marsh 1.5, wet 3.5, high 6.5}, highwayTiles 7, founders {dx -7, ty 7}, oaks [[-8,8],[-4,8]]`.
- `params.hydro` (§6.1): `stepsPerBlock [0,2,5,7], dtDayNormal 1/40, dtDayLandfall 1/360, dtDayNearMiss 1/60, jacobiPasses 2, k 0.35, kCanal 8, maxGiveFrac 0.5, activeDepth 0.01, absorb {high .7, dry .6, wet .3, marsh .9, preserve .95, drained .2, paved .05, canal 0, levee .6}, satFill 0.5, satDecay 0.12, satDecayHot 0.20, drain {high .6, dry .4, wet .15, marsh .05, drained .15, paved .02, levee .4}, evap 0.03, evapSummer 0.06, cypressDrain 0.05, loss {marsh .08, preserve .12, cypress .02}, pond {cut 3, cap 20, rate 0.5, perTileStep 0.1, radius 5, recover 2, stockDays 10}, pumpTileFtPerDay 15, pumpRadius 8, canalCut 2, canalBedMin 0.5, gateCloseStage 1, barrierCloseStage 2, thresholds {puddle .05, wading .3, flood .5, floodPilings 3, impassable .6, surgeDmg 2, surgeDmg2 4, bridgeSurge 2}, dmgPerDay {flood .02, surge .05, surge2 .25}, drain {daysToDrain 5, drainDepth .1, revertDepth .5, revertDays 20, mudDays 15, mudMosq .3}, rain {shower .04, frontal .125, cellMin 1, cellMax 3, cellScripted 3, cellRadius 14, cellSteps 60, cellDriftTicks 10, band .33, hurricane [6,8,10,13,16] /*inches*/}, riskSteps 40, riskInches 2, riskCacheDays 5, seepageRadius 6, seepageSat 0.8`.
- `params.storm` (§6.2, §10.3): `surge [0,3,5,8,12,16], coneDays 6, coneDaysInstitute 9, waveLead 2, watchLead 3, coneWidth [24,6], coneNarrowInstitute 0.3, nearMissChance 0.25, countWeights [.45,.35,.20], catWeights [.35,.30,.20,.10,.05], catShiftPerYear 0.05, cat5Cap 0.20, peak {start 'Aug 5', end 'Oct 5', p 0.7}, season {start 'Jun 1', end 'Nov 30'}, minGapDays 15, setPieceGapDays 6, maxRedraws 20, southEdgeP 0.7, entryWidth 8, frontTicksPerTile 5, recedeTicksPerTile 4, surgeRampTicks 200, baseDmg [0,.04,.09,.16,.26,.40], boardedMult 0.6, oakMult 0.7, substationOutageP 0.4, substationOutageBoardedP 0.2, outageDays 3, fenceBreak 0.3, azaleaRegrowDays 30, oakLoss 0.02, towerToppleP 0.3, towerToppleBracedP 0.1, towerToppleCost 60000, jammedGateP 0.1, debrisDays 5, gatorWaveDays 10, gatorWave [3,8], mosqBloomDay 3, grantDay 20, grantCap 800000, grantShare 0.4, grantEcoMult 1.25, grantEcoMin 50, boardCost 5000, boardPerDay 6, boardPerDayPost 12, sandbagCost 10000, sandbagPer 10, sandbagFt 1.5, sandbagDays 5, sandbagToastCost 50000, repairPerTile 5000, evacPer1000 20000, evacDays 10, shelterToastCost 10000, shelterOverflow 600, hurricanePartyDays 3, unshelteredDays 10, cajunNavyDay 4, toastTicks {sandbag 300, shelter 300, shelterAlt 330, fuel 400, gate 450}, cameraTicks {entry 150, ring 350}, celestine {cat 2, coneDate 'Sep 2', holdDate 'Oct 5', minPlaySeconds 540}, amelie {date 'Jul 2', latest 'Jul 20'}, boudin 'Aug 1', ringDefaultH 5, ringHighDryH 8, ringFortressH 12, weakIntegrity 70, halfIntegrity 50, gapSearchRadius 12`.
- `params.wildlife` (§6.3, §6.4, §6.7, §6.8): `gator {base 6, perWaterTiles 40, perStudents 1000, cap 24, wanderP 0.15, matingMult 3, sunShare .6, swimSpeed 2, walkSpeed .7, loungeTicks [300,1200], attractRadius 12, weights {dumpster 2, dumpsterProof 1, porch 2, parkingGameDay 6, trash 5, flooded 4, pool 1}, preserveShare .8, campusRadius 3, incidentPenalty 3, incidentCap 15, incidentDays 10, habitatRadius 10, wrangleTicks 30, relocateCooldown 200, officerSpeed 3, officerRadius 14, leGrandDays 3, bigShare .4}, mosq {standDays 2, stand .12, standFlooded .24, marsh .02, marshDisturbed .06, disturbRadius 2, mud .3, canalUnconnected .08, pondUnstocked .12, diffusion .15, decay .06, decayCold .15, decayHot .09, stormMult .5, pondSink .8, batSink .3, batStack .6, batRadius 4, preserveCypress .2, fogSink .7, fogRadius 8, happinessMult 25, illness .02, healthMult .4, healthRadius 12, warnIndex .3, biblical .5, biblicalBlight 5, biblicalDays 20, biblicalApplicants .10}, nutria {base 4, perMarsh 60, burrowP .2, burrowDmg 15, burrowRadius 10, trapMult .2, trapRadius 14, peltPay 500}, ecology {wetlandWeight 70, drainedMult 3, preserve .5, preserveCap 20, cypress .3, cypressCap 10, oak .3, oakCap 5, pond 2, pondCap 6, post 3, fogger .5, foggerRecover .3, foggerCap 15, wastewaterMarsh 5, canalMarsh .3, leveeMarsh .2, instituteMult .5, lowThreshold 30, highThreshold 60, fireflyMin 50, fireflyPer 6, fireflyCap 600, fireflyPreserve 3, spoonbillEco 70, egretEco 40}`.
- `params.subsidence` (§6.5): `drainedBuilt .35, drainedBare .25, wetBuilt .12, wetBare .05, dry .02, high 0, pumpAdd .06, pumpRadius 8, cypressMult .5, cypressRadius 1, levee .06, sinkingIcon 1.0, tiltAt 1.5, regradeCost 15000, regradeDays 3, regradeFt 1`.
- `params.heat` (§6.6): `monthBase [55,60,70,78,86,94,101,103,96,84,72,60], noise 6, rainAdd 3, advisory 100, waveDays 3, penaltyBase 92, penaltyDiv 2, penaltyCap 10, oakShade .3, oakRadius 3, shadeCap .9, poolMult .5, poolRadius 10, powerMult 1.5, teamPenalty 8, walkMult .8, illness .003, healthMult .5, shimmer 95`.
- `params.weather` (§9.3): `rainP [.30,.30,.35,.35,.40,.55,.55,.50,.40,.25,.25,.30], frontalShare .3, cellMonths [4,9], lightningP .1, fogP .4, fogMonths [11,2], fogTicks 20, windNormal [0,.3], windStorm .6, cellStartPhaseFrac .5`.
- `params.econ` (§5): `startCash 4000000, loanLimit 2000000, interest .01, bankruptMonths 3, startPrestige 10, startHappiness 60, tuition {default 6500, min 3000, max 15000, step 250}, installments ['Aug 5','Oct 5','Jan 5','Mar 5'], statePerStudent 2500, stateBase .6, statePrestige .8, stateEcoMult .85, stateEcoMin 30, stateDay 'Jul 1', donationPerAlumnus 8, donationBase .5, footballMultPerWin .1, footballMultCap 2, homecomingDonation 3, research {engineering 12000, coastal 10000, base .5}, concessions 12, parkingPer 600, parkingPay 4000, festivals {mardiGrasBase 50000, mardiGrasPer 5, unionMult 2, crawfish 20000, crawfishUnion 10000, homecoming 30000}, peltPay 500, grant 50000, grantObjectives ['1','2','3','4','5','6','7','9','10','11'], endowmentYield .004, endowmentStep 1000000, disaster {day 20, cap 800000, share .4}, salaryPerStudent 450, qualityMult {basic 1, good 1.25, elite 1.6}, utilities {perBuilding 300, perStudent 8, summerMult 1.5}, terrainCost {wet .2, high -.1, pilings .4, grading 15000, bridge 4, summer -.15, engineering -.15}, repairMult .6, blightPerDamaged 3, demolishRefund .4, upkeepPilings .05, applicants {base 60, prestige 28, happiness 6, tuitionA 1.65, tuitionDiv 10000, tuitionMin .3, tuitionMax 1.5, buzzPerWin .03, bowlBuzz .10}, capacity {beds 1.15, seats 1.4, dining 1.6, wastewaterBase 1500, wastewaterPer 6000}, selectivity {open 1, selective .6, elite .35}, gapShare {rolling .2, spring .25, fall 1}, attrition {base .02, happinessK .08}, graduation .22, graduationFromYear 2, minStudents 60, prestige {weights {academic .22, faculty .14, happiness .16, football .16, landmarks .12, ecology .10, selectivity .10}, lerp .06, seatsPerStudent 1.2, facultyBase 70, ecologyNoInstitute .4, blight {damaged 3, flooded 8, floodedDays 3, mosquito 5, mosqIndex .6}, landmarkMult 2, selectivityScore {open 0, selective 40, elite 100}}, happiness {base 50, housingPerQuality 4, housingCap 12, bedsShort 10, dining 8, noDining 10, spiritWin 2, rivalry 6, rivalryDays 7, festival 5, festivalNoBonfire 2, bonfirePer10 2, bonfireCap 10, floodPer 4, floodCap 20, dormFlooded 10, tuitionBase 7000, tuitionDiv 400, crowd 10, noiseRoad 1, noisePump 2, noiseBarrier 2, lifeCap 12, greenCap 10, emaDays 1}, timers {…the §5.6 table values by id…}, boardCards {…§5.9 values…}, failure {austerityUpkeep .3, austerityHappiness 10, hikeTuition 3000, hikeApplicants .4, namingRights 1000000, namingPrestige 3, receiverDays 60, receiverPrestige 20, underwaterShare .5, underwaterDays 15, cancelledPrestige 15, resilienceGrant 3000000, probationPrestige 5, probationApplicants .5, probationExit 15}, sliders {coachingMax 3000000}`.
- `params.sports` (§8): `ratingBase 20, practiceField 5, coachingPer100k 1, coachingCap 30, recruitingDiv 4, recruitingCap 25, moraleDiv 10, moraleCap 10, roux 3, heatPenalty 8, coachPerStar 4, starterDiv 5, homeDay 6, homeNight 14, stadium3Opp 5, elo 25, fanbase {students 2.5, alumni .6, prestige 300}, hype {base .7, winPct .4, rivalry .3, night .15, rain -.1}, tickets {25: 1.15, 35: 1, 60: .85}, tailgatePer 3, greekBonus .5, greekCap 2, greekRadius 8, clubPay 20000, bowlWin 1500000, bowlLose 500000, bowlPrestige 5, bowlWins 5, quarterWeights [[.45,-.25],[.20,0],[.25,.15],[.10,.10]], points [0,3,7,10], swingMax 8, opponents (data), schedule (data), coachSign 300000, coachFee 100000, buyout 500000, starterGrad .4, recruitRating 95, seniorLeaveP .4, playThroughHappiness 10, playThroughPrestige 3, resiliencePrestige 4, rivalryPrestige 3, rivalryDonation 1.3, undefeatedDonation 1.5, autoSimTicks 50, halftimeTick 400, kickoffTick 200, quarterTicks 100, finalTick 600, exitTick 700`.
- `params.agents` (§7): `cap 300, base 40, perStudents 25, speed {path 4, dry 2.4, wet 1.6, wading 1.2}, offscreenRate 4, maxAstarPerTick 8, summerShare .35, poboyShare .3, nightOwlShare .15, fleeRadius 2, legTicks 50, wearThreshold 40, wearDecay 5, energyDrain, tubeP .15, slapAt .3, gatorFleeTicks 30`.
- `params.build` (§0.1, §3.6): `daysFormulaDiv 6, pilingsDays 1, slopeFt 1.5, gradingPerTile 15000, bridgeMaxSpan 3, roadWithin 4, nearWater 3, accessSurfaces [1,2,3]`.
- `params.render` (§12): `tileW 64, tileH 32, pxPerFt 6, zooms [0.5,1,2], chunk 8, chunkW 512, chunkH 416, cameraLerp .15, cameraMargin 200, dragThreshold 4, rainLines [300,1200], rainLinesHalf 400, particlesMax 2500, particlesLow 800, lightsMax 250, lampEveryRoad 4, lampEveryPath 6, shakeMs {landfall 400, score 150, demolish 120, lightning 80}, shakePx 6, tint {dawn ['#F7B58A',.25], golden ['#FFCB6B',.20], dusk ['#6B3F8F',.35], night ['#0E1230',.62], storm ['#2A3140',.50], fog ['#C9CFD1',.30]}, waterShallow '#6FA895', waterDeep '#1B3A3A', marshLiveDepth .5, perfFrameMs 25, perfFrames 60, minAgentsDrawn 120, fireflyHalfCap 300, canvasBudgetMB 64, postcard [1600,1000], overlayFadeMs 150, tooltipMs 300, tickerPxPerSec 60, notifMs 12000, notifMax 3, bubbleIdleMs 8000, bubbleMs 6000, squashMs 200, hitStopMs 60`.
- `params.audio` (§13): `voices 12, ambienceDb -12, duckDb -6, thunderDelay [0.3,2], zydecoBpm 120`.
- `params.palette` (§12.2): every named hex (`purple, purple2, purpleHi, purpleShadow, panel, gold, gold2, goldHi, goldShadow, windowGlow, waterNight, waterDay, shallows, reed, mud, wetGround, dryGrass, highGround, cypress, cypressAutumn, oakCanopy, moss, bark, gravel, asphalt, boardwalk, azalea, creamStone, tanStucco, terracotta, text, danger, good, waterBlue`).
- `params.progress` (§10): `grant 50000, objectivePrestige 2, milestonePrestige {…}, voiceCardDay 3, voiceDeadlineDays 30, showMeFlashMs 1200, cadence…`.

The debug panel walks `BSU.params` recursively; **every leaf must be a number, a boolean, a string or an array of numbers** (no functions, no nested tables from `data`).

### 3.3 `BSU.rng`

```js
BSU.rng.make(seed: number) → Stream          // mulberry32
Stream = { next(): number /*uint32*/, float(): number /*[0,1)*/, int(n): number /*[0,n)*/, range(a,b): number /*[a,b)*/,
           pick(arr), chance(p): boolean, gauss(): number /*Box-Muller, N(0,1)*/, get state(): number, set state(v) }
BSU.rng.world: Stream   // reseeded IN PLACE by terrain.gen: `BSU.rng.world.state = seed`; map generation only
BSU.rng.sim:   Stream   // ALL simulation randomness; its state is state.rng.sim (session copies it in on newGame/load with `.state = …` and out after every tick)
BSU.rng.fx:    Stream   // render/audio/particles only; session sets `BSU.rng.fx.state` once at boot; never saved; never read by sim modules
BSU.rng.hash(a: number, b: number) → number   // 32-bit mix (for per-building/per-tile seeds and the agent regeneration seed)
BSU.rng.derive(name: string, n: number) → Stream   // = make(hash(state.seed, hash(strHash(name), n))); used for agent regeneration and generator re-rolls
```
Rule: a sim module calls `BSU.rng.sim.*` and nothing else random (`Math.random` is forbidden everywhere except `rng.fx`'s own seeding fallback). Session writes `state.rng.sim = BSU.rng.sim.state` at the end of every tick. **The three `Stream` objects are created once by `contract.js` and are never replaced**: `newGame` and `load` reseed with `BSU.rng.sim.state = state.rng.sim` (never `BSU.rng.sim = rng.make(…)`), `terrain.gen` with `BSU.rng.world.state = seed`, boot with `BSU.rng.fx.state = …`. A module may therefore cache `const R = BSU.rng.sim` in its closure; it must never create a stream of its own except through `BSU.rng.derive` (which returns a fresh throw-away stream for regeneration/re-rolls).

### 3.4 `BSU.events` and the complete event list

```js
BSU.events.on(name: string, fn: (payload: Object, name: string) => void, owner?: string) → fn
BSU.events.off(name: string, fn) → void
BSU.events.emit(name: string, payload?: Object) → void   // synchronous, in subscription order; each listener wrapped in try/catch (§10.1); unknown names throw in selfTest, warn once at runtime
BSU.events.clear(owner: string) → void                    // remove every listener registered with that owner tag (used by reset of modules that re-subscribe)
BSU.EV = { /* every name below as a constant, e.g. BSU.EV.TILE_CHANGED = 'tile:changed' */ };
```
Listeners run synchronously inside the emitter's tick, so a listener must never mutate state it does not own; it may read and it may call the owner's action functions. **Emit is never re-entrant into the sim**: a listener that needs sim work queues it (e.g. `progress` pushes to a queue drained in its own `tick`). Payload shapes (all fields required unless marked `?`):

| Event | Emitter | Payload | When |
|---|---|---|---|
| `tile:changed` | terrain (also relayed for hydro/buildings writes through `terrain.touch`) | `{i, tx, ty, what: 'elev'\|'surface'\|'crest'\|'flags'\|'type'\|'water'\|'decor', chunk: number}` | any change that requires a chunk re-bake or invalidates walk/ring/route caches; `what:'water'` only when a Marsh tile crosses 0.5 ft or a water flag changes |
| `building:placed` | buildings | `{id, type, tx, ty, w, h, cost, pilings}` | after the struct exists and `owner` is written (construction may still be in progress) |
| `building:removed` | buildings | `{id, type, tx, ty, w, h, refund, reason: 'demolish'\|'ruin'\|'restore'}` | after `owner` cleared |
| `building:complete` | buildings | `{id, type}` | `built` reaches 1 (also for tier upgrades, with `tier`) |
| `building:upgraded` | buildings | `{id, type, tier}` | in-place tier change complete |
| `building:flooded` / `building:dried` | hydro | `{id, type, depth}` | flood state transition (daily) |
| `building:damaged` | buildings | `{id, type, hp, cause: 'flood'\|'surge'\|'wind'\|'topple'}` | any hp decrease |
| `building:repaired` | buildings | `{id, cost}` | |
| `building:renamed` | buildings | `{id, name}` | |
| `power:blackout` / `power:restored` | buildings | `{provider: number, affected: number[], cause: 'flood'\|'wind'\|'fuel'\|'unpowered'}` | coverage state change |
| `coverage:changed` | buildings | `{}` | after any coverage recompute (ui/render refresh icons) |
| `ring:changed` | buildings | `{H, closed: boolean, gaps: number}` | the default-H ring cache was invalidated and recomputed |
| `weather:rain` | weather | `{kind, total, start: boolean}` | a map-wide rain event starts (`start:true`) or ends (`start:false`) |
| `weather:cell` | weather | `{cx, cy, radius, total, scripted}` | a thunderstorm cell spawns |
| `weather:lightning` | weather | `{tx, ty}` | flash (render/audio) |
| `weather:heat` | weather | `{index, advisory: boolean, wave: boolean}` | daily |
| `sky:phase` | weather | `{phase, prev}` | phase change |
| `calendar:day` | weather | `{day, year, month, dom}` | day boundary (before any daily step runs) |
| `calendar:month` | weather | `{day, year, month}` | dom == 1 (after `calendar:day`) |
| `calendar:semester` | weather | `{day, semester}` | Jan 5, May 6, Aug 5, Dec 11 |
| `calendar:year` | weather | `{year}` | Jan 1 |
| `calendar:date` | weather | `{date: 'Feb 8', day}` | every day, with the `Mon D` string (progress/sports/economy match dates) |
| `storm:wave` / `storm:named` / `storm:watch` / `storm:bands` / `storm:landfall` / `storm:passed` | weather | `{name, cat, forecastCat, nearMiss, landfallDay, point}` | lifecycle transitions (`storm:landfall` is the set-piece start; `storm:passed` follows the damage report) |
| `storm:phase` | weather | `{phase: BSU.STORM_PHASE.*, t: number /*set-piece tick*/}` | at ticks 0, 150, 350, 450, 500, 750 of the landfall set piece |
| `storm:pulse` | weather | `{n: 1\|2\|3\|4, share}` | wind pulses (buildings applies damage on this) |
| `storm:toast` | weather | `{id: 'sandbag'\|'shelter'\|'fuel'\|'gate', text, yes, no, untilTick}` | a decision toast opens |
| `storm:report` | weather | `{report: Storm.damageReport}` | the damage report is ready (ui shows the modal) |
| `surge:start` / `surge:peak` / `surge:end` | hydro | `{stage}` | front begins / stage reaches target / stage back at 0 |
| `surge:front` | hydro | `{i}` | a tile is activated by the front (render debris/foam) |
| `levee:overtop` | hydro | `{i, tx, ty}` | once per tile per day |
| `levee:breach` | hydro | `{i, tx, ty}` | integrity hit 0 |
| `levee:burrow` | wildlife | `{i, tx, ty, integrity}` | nutria event |
| `gate:closed` / `gate:opened` | hydro | `{i}` | floodgate / barrier state change |
| `marsh:drained` / `marsh:reverted` / `marsh:restored` | hydro | `{i}` | |
| `gator:spawn` | wildlife | `{id, name, den}` | |
| `gator:campus` | wildlife | `{id, name, i, enter: boolean, target: number}` | enters/leaves the campus set |
| `gator:incident` | wildlife | `{id, name, i, kind: 'pool'\|'field'\|'dumpster'\|'building'\|'tile'}` | one per gator per day |
| `gator:relocated` | wildlife | `{id, name, byPost}` | |
| `mosquito:warning` | wildlife | `{index, worstTile}` | first time ≥ warnIndex, and again when biblical |
| `ecology:changed` | wildlife | `{value, prev}` | daily if changed by ≥ 1 |
| `festival:start` / `festival:end` | weather | `{id: 'mardiGras'\|'crawfish'\|'graduation'\|'homecoming'\|'bonfires'\|'foundersDay', day}` | |
| `game:scheduled` | sports | `{day, opp, home, kind}` | |
| `game:kickoff` / `game:score` / `game:halftime` / `game:final` | sports | `{opp, home, night, homePts, awayPts, quarter?, side?: 'home'\|'away', won?}` | |
| `season:end` | sports | `{wins, losses, bowl}` | |
| `coach:changed` | sports | `{name, stars}` | |
| `econ:income` / `econ:expense` | economy | `{key, amount, i?: number /*tile for the coin burst*/, note?}` | every ledger post |
| `econ:month` | economy | `{statement: ledger.last}` | after the monthly step |
| `econ:stat` | economy | `{stat: 'cash'\|'students'\|'prestige'\|'happiness'\|'ecology', value, delta}` | any displayed stat change |
| `econ:card` | economy (`bankruptcy`, `probation`, `receiver`); progress (`underwater` only — it owns that counter) | `{kind: 'bankruptcy'\|'underwater'\|'probation'\|'receiver', options: string[]}` | failure card: **ui_panels is the ONLY opener** of the `failure` card (on this event); its buttons call `progress.answerFailure`; progress's listener only records `failure.pendingKind` |
| `enroll:round` / `enroll:lock` | economy | `{day, admitted, students, capacity, applicants, kind: 'rolling'\|'spring'\|'fall'}` | emitted by economy's round/lock steps only — never by `addStudents` (§5.7); agents spawn pirogues/buses on this |
| `enroll:attrition` / `enroll:graduation` | economy | `{count, students}` | |
| `board:offered` / `board:resolved` | progress | `{cards: string[]} / {chosen: string\|null}` | Board of Regents |
| `voice:offered` / `voice:resolved` | progress | `{id, student, text} / {id, state}` | Student Voice |
| `milestone:earned` | progress | `{id, name, reward}` | |
| `objective:offered` / `objective:complete` / `objective:dismissed` / `objective:progress` | progress | `{id, kind, text, progress?, goal?}` | |
| `timer:added` / `timer:expired` | progress | `{id, value, untilDay}` | |
| `unlock:changed` | progress | `{ids: string[]}` | palette rows newly unlocked |
| `setpiece:start` / `setpiece:end` / `setpiece:skip` | session | `{kind, len}` | |
| `speed:changed` | session | `{speed, prev, reason: 'user'\|'setpiece'\|'cone'\|'warning'\|'restore'\|'receiver'}` | |
| `decision:open` / `decision:closed` | ui | `{id, answer?: 'yes'\|'no'\|'default'}` | the toast lifecycle; **`decision:closed{id, answer}` is the ONLY delivery of an answer to its owner** (weather `sandbag/shelter/fuel/gate`, sports `halftime/playThrough`, progress its own ids); owners subscribe and guard with a per-id answered flag (`game.halftimeAnswered`, `setPiece.choices[id]`) because `answerDecision` may be called twice |
| `agent:flee` | agents | `{id, gatorId}` | |
| `agent:desireLine` | agents | `{tiles: number[]}` | one per day at most |
| `agent:arrive` | agents | `{count, kind: 'pirogue'\|'bus'\|'founding'}` | students have walked in (Students counter rolls on this) |
| `ui:notify` | any (via `ui.notify`) | `{text, kind, action?: {label, fn\|event}, showMe?: number \|{tx,ty}, ttl?}` | |
| `ui:ticker` | any (via `progress.ticker`) | `{text, kind, subject}` | |
| `ui:panel` / `ui:overlay` / `ui:tool` | ui | `{panel\|overlay\|tool}` | |
| `camera:moved` | render | `{x, y, zoom, byUser: boolean}` | |
| `save:written` / `save:loaded` | session | `{slot, bytes} / {slot, version, migrated: boolean}` | |
| `error` | any (via `BSU.error`) | `{module, where, message, first: boolean}` | see §10.1 |

**Name every event once**: this table is the registry. A module emitting a name not in `BSU.EV` fails `selfTest` of `contract`. Presentation modules subscribe in `init`; sim modules subscribe in `init` too and read payloads only (they act in their own `tick`).

### 3.5 Helpers (all pure; on `BSU`)

```js
BSU.idx(tx, ty) → number                       // ty*64+tx (no bounds check)
BSU.tx(i) → number; BSU.ty(i) → number          // i & 63; i >> 6
BSU.inBounds(tx, ty) → boolean
BSU.nbr4(i) → number[]                          // N,E,S,W neighbors that exist (order: ty−1, tx+1, ty+1, tx−1)
BSU.nbr8(i) → number[]
BSU.chebyshev(ax, ay, bx, by) → number
BSU.footprintTiles(tx, ty, w, h) → number[]     // row-major; null if any tile is out of bounds
BSU.edgeTiles(tx, ty, w, h) → number[]          // the 4-adjacent ring (no corners), in bounds only
BSU.clamp(v, lo, hi); BSU.lerp(a, b, t); BSU.smoothstep(t)
BSU.formatMoney(n) → string                     // '$4.12M', '$340k', '$2,000', '−$1.4M' (≥1M one decimal; ≥10k 'k' no decimal; else commas)
BSU.formatDate(day) → string                    // 'Sep 3, Y1'
BSU.monthName(m) → 'Jan'…'Dec'; BSU.dateToDay(str, year) → number   // 'Aug 5' + year → absolute day
BSU.worldToScreen(tx, ty, elev, cam, vw, vh) → {x, y}   // tile CENTER in canvas px: x = ((tx−ty)*32 − cam.x)*cam.zoom + vw/2 ; y = (((tx+ty)*16 − elev*6) − cam.y)*cam.zoom + vh/2
BSU.screenToWorld(px, py, cam, vw, vh, elevAt: (tx,ty)=>number) → {tx, ty} | null
   // inverse: wx = (px − vw/2)/zoom + cam.x ; wy = (py − vh/2)/zoom + cam.y ; flat guess tx0 = (wx/32 + wy/16)/2 , ty0 = (wy/16 − wx/32)/2 ;
   // then for k = 0..3 test the tiles (round(tx0)+k, round(ty0)+k) and their 8 neighbors against the diamond
   // |dx|/32 + |dy|/16 ≤ 1 using each tile's own elevation; return the hit with the LARGEST tx+ty (the one drawn last). null if none.
BSU.tileDiamond(tx, ty, elev) → {x0,y0,x1,y1,x2,y2,x3,y3}   // world px corners: top, right, bottom, left (zoom-1 space)
BSU.b64.encode(typedArray) → string; BSU.b64.decode(str, Ctor) → typedArray   // little-endian bytes of the underlying buffer
BSU.error(module, where, err) → void            // §10.1: logs once per signature, emits 'error', never throws
BSU.assert(cond, msg) → void                    // throws only while BSU.SELFTEST === true (test/modules.mjs sets it around every selfTest, §10.6), otherwise BSU.error
BSU.strHash(s) → number
BSU.deepClone(plain) → plain                    // JSON-safe clone that preserves typed arrays
BSU.headlessMode: boolean
```
`BSU.headlessMode` is computed at load exactly as: `(typeof window.__headless === 'object') || typeof requestAnimationFrame !== 'function' || !document.getElementById('app')?.getBoundingClientRect || navigator.userAgent === 'node-headless'`, wrapped in try/catch (any throw → `true`); a harness may set `window.BSU_FORCE_HEADLESS = true` before the script runs to force it.

### 3.6 `BSU.catalogRowSchema` and `BSU.validateCatalogRow`

A frozen object describing every field of a catalog row (name → type string), used by `data.selfTest` to validate all 43 rows and by the debug panel. The row shape itself is defined in §4.1. Exact shape as written:

```js
BSU.catalogRowSchema = { row: {...}, unlock: {...}, effects: {...}, valueRadius, radiusCapacity, multRadius, multRadiusStacks, research, illness, tier, paint, colsRows }
// type strings: 'string' | 'number' | 'int' | 'boolean' | 'enum:a|b|c' ('' allowed as an empty alternative) | 'array:string' | 'array:number'
//               | 'object:<subSchema>' | 'array:object:<subSchema>' | 'optional:<type>' | 'placeRule' (a BSU.PLACE value)
BSU.validateCatalogRow(row) → {ok: boolean, errors: string[]}   // every key of the schema must be present (except 'optional:' ones), NO extra keys anywhere
                                                                  // (row.effects must carry every Effects key, 0/false/''/[] when unused), row.id ∈ BSU.B,
                                                                  // BSU.B_ORDER[row.n − 1] === row.id, and for footprint rows rotatable === (w !== h)
```
`effects.happiness`/`noise` are `{value, radius}`; `power`/`water` are `{radius, capacity}`; `mosquito` is `{mult, radius, stacksTo}`; `heat`/`windShield` are `{mult, radius}`; `research` is `{kind: ''|'engineering'|'coastal', base}`; `illness` is `{mosquito, heat, radius}`; `paint.windows` is `{cols, rows}`; `special` and `paint.decals` are string arrays; `paint.wall` is `[left, right]`.

### 3.7 Decisions recorded by `contract.js` (the file is frozen; this section is its reference)

Everything below is what `contract.js` actually exports beyond §3.1–§3.6, or a rule it fixed where this document was silent. An implementer may rely on all of it.

- **Extra frozen constants:** `BSU.EV_LIST` (the event names in registry order; `BSU.EV` keys are derived as `name → UPPER_SNAKE`, e.g. `agent:desireLine → AGENT_DESIRE_LINE`, `error → ERROR`); `BSU.OBJECTIVE_IDS` (the 25 objective ids in §10.2 order); `BSU.VOICE_CARDS` (the 12 §7.1 ids: `boardwalk, recPool, zydeco, poboyRoute, quadOak, batHouse, parking, healthShade, greekPorch, cypressLine, lookout, bellSelfie`; `data.voiceCards[].id` must use them); `BSU.BOARD_CARDS` (`lobby, researchPush, tuitionFreeze, recruitingTrip, marshGrant, summerSession, insurance, homecomingBudget`; `data.boardCards[].id` must use them and `progress.boardCards[].cards` holds them); `BSU.HAPPINESS_TIMERS` (the 22 §5.6 ids); `BSU.LEDGER_INCOME_KEYS` / `BSU.LEDGER_EXPENSE_KEYS` (§2.7 order); `BSU.MONTHS` (`'Jan'…'Dec'`), `BSU.SEASONS`, `BSU.SEMESTERS`; `BSU.SET_PIECES` (`{landfall: 900, nearMiss: 150, game: 750, parade: 250, graduation: 150, montage: 50}`); `BSU.TILE_ARRAYS` (name → constructor for the 16 `tiles.*` arrays; save/load iterate it).
- **Extra helpers:** `BSU.dayParts(day) → {day, year, month, dom, season, semester, date: 'Sep 3'}` (the §2.4 calendar rules; `weather` must agree with it); `BSU.bankAt(ty)` (the §3.4 `bank(ty)` formula; `terrain.bank` must equal it); `BSU.events.once(name, fn, owner)`, `BSU.events.count(name)`, `BSU.events.known(name)`; `BSU.contract.selfTest()`.
- **`BSU.params` leaf rule (amends §3.2):** a leaf is a finite number, a boolean, a string, an array of numbers, an array of strings (dates, ids) or an array of number pairs (`sports.quarterWeights`). The debug panel enumerates only numeric leaves. `render.tint.*` is `{color, alpha}` (not a mixed tuple). The §3.2 list's second `hydro.drain` is named **`hydro.marshDrain`** (`daysToDrain, drainDepth, canalRadius, revertDepth, revertDays, mudDays, mudMosq`). `params.econ.timers[id] = {value, days}` for every §5.6 id with `days: -1` meaning "while the source exists" (`progress.addTimer(…, -1)` → `untilDay -1`, D23; never `Infinity`), plus `cap`/`per` where the table has them and `homecomingBudget.value = [0, 3, 6]` by budget tier. `params.econ.boardCards` is keyed by `BSU.BOARD_CARDS`. `params.sports.opponents` and the schedule rows live in `data` (only the schedule *dates* are in `params.sports.schedule`). Added groups with no §3.2 line: `params.ui` (undo window, layout sizes, ticker cap), `params.weather.highWater/spillway/festivals/azaleaBloom`, `params.progress.goals/milestoneGoals/milestonePrestige/milestoneCash/milestoneEffects/parade/tutorial`, `params.econ.landmarks` (points not carried by a row: mounds 1, west 10), `params.econ.west`, `params.build.*` (per-row constants the ghost needs: pilings 0.4, generator fuel, refuel, dumpster cost, barrier/restoration limits), `params.storm.phaseTicks/toastTicks/cameraTicks` (the §6.2 timeline in ticks), `params.hydro.initial` (§3.3 generation state). `params.agents.energyDrain = 1` means the whole energy bar drains across one Day phase.
- **`BSU.newState` initial values where §2 says "—" or "generated":** `calendar` = Jan 1 Y1 (`season 'winter'`, `semester 'break'`, `running false`, `frozen true`); `sky.phase = DAWN`, all sky counters 0; `weather.heat = 55` (Jan base), everything else 0/null/[]; `tiles.elev/type/walk/flags/surface` are all 0 and `tiles.owner` is all −1 until `terrain.gen` (a state that never ran the generator reads as all Open Water); `plot.bank0`, `plot.rect` and `plot.founders` are **prefilled from `params.terrain`** (bank₀ = 58 → founders (51, 7), rect (49, 6)–(57, 13)) and every tile list is `[]`, `landing/landingShoulder −1`, `template false`; `economy.ticket = 35` (the ×1.0 tier), `economy.capacityTerms.wastewater = 1500`, `economy.runway.nextPayDay = dateToDay('Jan 5')`, `economy.targets.prestige = 10`; `ledger.month/last` income and expense objects are **pre-keyed with every §2.7 key at 0**; `progress.objectives` is pre-keyed with every `BSU.OBJECTIVE_IDS` entry as `{state:'locked', progress:0, goal:0, since:-1, deadlineDay:-1, text:''}` and `progress.milestones` with every `BSU.MILESTONES` id as `{earned:false, day:-1}`; `progress.voiceCards = []` (progress fills the deck from `data.voiceCards` in `reset`); `ui.speed = 1`, `ui.speedBefore = 1` (session sets 0 for the title world / tutorial start); `ui.camera` = the Founders' tile in world px (`x = (tx−ty)·32`, `y = (tx+ty)·16`, `tx/ty` = the same, `zoom 1`, `follow −1`); `ui.paletteTab = 'essentials'`; `ui.settings = {volume 0.5, muted false, particles 'high', shake true, colorblind false, autoSimHint false}`; `rng.sim = (seed ^ 0x9E3779B9) >>> 0`.
- **`BSU.rng`:** `world` starts at `make(0)`, `sim` at `make(0 ^ 0x9E3779B9)`, `fx` at `make(0xF0F0F0F0)` until session/terrain reseed them **in place** (`.state = …`; the Stream objects are never replaced, §3.3); `gauss()` consumes two floats and caches nothing, so a stream's `state` is always one uint32; `derive(name, n)` reads `BSU.state.seed` (0 when no game exists); `hash` is a 32-bit integer mix (not symmetric); `strHash` is FNV-1a.
- **`BSU.events.emit` of an unregistered name:** throws under `BSU.SELFTEST`; otherwise `console.warn`s once per name and **still dispatches**. Listeners are called from a snapshot, so `off` inside a listener is safe. A listener's exception goes to `BSU.error(owner || 'events', name, e)` (rethrown under `BSU.SELFTEST`).
- **`BSU.error`:** never re-enters (an `error` listener that throws is logged but does not emit again); `BSU.errors` is the `Map<signature, count>`; `BSU.SELFTEST` defaults to `false`; `test/modules.mjs` sets it to `true` around every `selfTest` call (and `contract.selfTest` also toggles it for itself, harmlessly) — see §10.6.
- **`BSU.formatMoney`:** `|n| ≥ 1M` → `n/1M` with 2 decimals below 10M and 1 decimal from 10M, trailing zeros trimmed, `'M'` (`$4.12M`, `$1.4M`, `$32M`); `|n| ≥ 10k` → `round(n/1k) + 'k'` (`$340k`); else comma-grouped integer (`$2,000`); negative → leading `−` (U+2212): `−$1.4M`; non-finite → `$—`.
- **`BSU.dateToDay(str, year = 1)`** parses `'Mon D'` (case-insensitive month, D 1–10) and returns `NaN` otherwise; `BSU.formatDate(day)` → `'Sep 3, Y1'`.
- **`BSU.nbr8` order:** clockwise from N (N, NE, E, SE, S, SW, W, NW). **`BSU.edgeTiles` order:** north row, south row, west column, east column.
- **`BSU.screenToWorld`** rounds the flat guess first (`tx0 = round(...)`, `ty0 = round(...)`) and then tests `(tx0+k, ty0+k)` and their 8 neighbors for `k = 0..3`; `elevAt` may be omitted (flat).
- **`BSU.b64`** is implemented without `btoa`/`Buffer`; `decode` throws when the byte length is not a multiple of the constructor's `BYTES_PER_ELEMENT`; `encode` honours `byteOffset` (subarrays encode only their view).
- **`BSU.deepClone`** copies typed arrays with `.slice()`, keeps `Infinity`/`NaN`, drops functions.
- **`BSU.headlessMode`** checks `window.BSU_FORCE_HEADLESS === true` first, then the §3.5 formula.

---

## 4. `data.js`

Immutable tables only. `BSU.data` is deep-frozen after definition. No table references `state`.

### 4.1 Catalog row (exactly this shape for all 43 rows; `BSU.data.catalog[id]`, plus `BSU.data.catalogList` in §0.3 order)

```js
/** @typedef {Object} CatalogRow
 * @property {string}  id            catalog id (BSU.B key), e.g. 'dorm'
 * @property {number}  n             §0.3 row number 1–43
 * @property {string}  name          display name
 * @property {string}  tab           'paths'|'utilities'|'academic'|'housing'|'dining'|'sports'|'life'|'swamp'|'grounds'
 * @property {boolean} essentials    also listed in the Essentials tab (path, dorm, dining_hall, lecture_hall, poboy, quad, live_oak)
 * @property {'footprint'|'drag'|'paint'|'upgrade'} kind   drag = linear tool writing tiles; paint = per-tile zone (preserve, marsh_restoration's paint); upgrade = pilings
 * @property {number}  w  @property {number} h   footprint (drag/paint/upgrade: 1×1); barrier: w = run length (4–8) at placement
 * @property {boolean} rotatable     w !== h
 * @property {number}  cost          $ one-time; per tile for drag/paint; pilings: 0 (computed as +40% of the target)
 * @property {number}  upkeep        $/month; per tile for drag; 0 for paint/upgrade
 * @property {number}  wr            wind rating 1–5 (0 for drag/paint/upgrade)
 * @property {boolean} needsPower  @property {boolean} needsWater
 * @property {boolean} pathAdjacency  rows 4–22,24,28,32,34,39,40,42,43 → true
 * @property {number}  roadWithin    0, or 4 (stadium, parking, wastewater)
 * @property {number}  placeRule     BSU.PLACE.*
 * @property {boolean} allowMarsh    footprint may sit on Marsh (pilings auto-applied); true for every footprint row (D9)
 * @property {boolean} alwaysPilings   coastal_institute and rookery: pilings are mandatory everywhere
 * @property {number}  buildDays     footprint: 1 + floor(w*h/6); drag/paint: 0; Bayou Field upgrade: 6; pilings: 1
 * @property {Unlock}  unlock        {students?: number, prestige?: number, ecology?: number, milestone?: string, building?: string, any?: Unlock[], tier?: number} — empty object = Start
 * @property {string}  pip           '' | 'gator' | 'mosquito' | 'cell' | 'season'   (event that pips the row; pips never gate)
 * @property {Effects} effects       see below
 * @property {Tier[]}  tiers         [] or [{tier, name, cost, upkeep, seats, landmark, shelter, wr, night: boolean, unlock: Unlock, buildDays}] (stadium: tiers 1–3; practice_field: tier 1 = Bayou Field)
 * @property {Paint}   paint         {wall: [string,string], roof: 'flat'|'gable'|'hip'|'dome'|'barrel'|'bowl'|'none', roofColor: string, floors: number, windows: {cols, rows}, decals: string[], accent: string, lift: number, special: string}
 * @property {string}  namePool      key into data.names (auto-name pool) or ''
 * @property {string}  why           tooltip why-line
 * @property {string}  desc          one-line effects in words (tooltip)
 * @property {boolean} demolishable  false for founders_hall, library, res_tower, stadium, bell_tower, tiger_habitat, rookery, surge_barrier, marsh_restoration (D10); true otherwise
 * @property {boolean} shelterOwn    dorm/res_tower: shelters residents only on ≥ 5 ft or pilings
 */
/** @typedef {Object} Effects   (every key present; 0/false/null when unused)
 * seats, beds, quality (0–3), feeds, diningRadius, happiness: {value, radius} (sampled aura; radius 0 = campus-wide flat → timer id in `flatTimer`), flatTimer: string|'',
 * landmark, shelter, power: {radius, capacity}, water: {radius, capacity}, mosquito: {mult, radius, stacksTo}, heat: {mult, radius},
 * ecology (flat while built), ecologyPerTile (preserve .5, levee −.2, canal −.3), gatorAttract, research: {kind: ''|'engineering'|'coastal', base},
 * academic (+20), teamRating, noise: {value, radius}, windShield: {mult, radius}, illness: {mosquito, heat, radius}, drainPerDay, subsidenceMult, subsidenceRadius,
 * pumpTileFt, pondCapacity, fuelDays, crest (6|12), surfaceId (BSU.SURF for drag rows), canal: boolean, gate: boolean, capacityStudents (wastewater 6000),
 * parkingPer (600), tickets (4000), revenueMonthly (poboy 2000), coneDays (institute 9), coneNarrow (.3), ecologyDecayMult (.5), gatorAvoidRadius (10),
 * homeWinBonus (.05), attendanceSeats (per tier), special: string[]   // free-form tags: 'boilPot','dumpster','beacon','bells','fogger','officer','bats','egret','martins','spoonbills','radar','tank','habitat'
 */
```
`BSU.data.catalog` values are numbers as written in §0.3 (e.g. `dorm.cost = 700000`, `dorm.effects.beds = 300`, `dorm.effects.quality = 2`). Tier data: `practice_field.tiers = [{tier:1, name:'Bayou Field', cost:600000, upkeep:4000, seats:6000, landmark:1, shelter:0, wr:1, night:false, unlock:{students:400}, buildDays:6}]`; `stadium.tiers = [{tier:1,'Red Stick Stadium',2000000,30000,15000,4,5000,3,false,{students:600,building:'practice_field',tier:1},6},{tier:2,'The Cauldron',8000000,80000,45000,10,15000,4,true,{students:1500},6},{tier:3,'Cauldron Grand',32000000,180000,80000,18,25000,5,true,{students:8000,prestige:50},6}]` (object form; the tuple here is shorthand).

### 4.2 Other tables (shapes)

| Table | Shape |
|---|---|
| `data.tabs` | `[{id, name, rows: string[]}]` in §11.2 order (`essentials, paths, utilities, academic, housing, dining, sports, life, swamp, grounds`) |
| `data.decals` | `Object<string, {w, h, anchor: 'roof'\|'ground'\|'side', frames}>` for the ~30 decal names in §4 |
| `data.names` | `{halls: string[], towers, dining, poboy, greek, library, union, engineering, institute, stadium: string[4], bellTower, leveeRun}` |
| `data.students` | `{firstCajun: string[], firstModern: string[], last: string[], nicknames: string[], majors: string[], hometowns: string[], quotes: string[], modernShare .25, nicknameShare .12}` |
| `data.coaches` | `[{name, rep}]` (10); `data.coachQuotes: string[12]` |
| `data.gatorNames` | `string[]` (14 + 'Le Grand' as `data.leGrand`) |
| `data.stormNames` | `string[26]` (Amélie … Zéphyrine) |
| `data.opponents` | `Object<string, {name, nick, rating, colors: [string,string], rival: boolean, crosstown: boolean}>` (9) |
| `data.schedule` | `[{date: 'Aug 8', home: true, kind: 'regular'}, {date:'Sep 3', home:false}, {'Sep 8', true}, {'Oct 3', false}, {'Oct 8', true, 'homecoming'}, {'Nov 3', false}, {'Nov 8', true, 'rivalry'}, {'Dec 8', false, 'bowl'}]` |
| `data.calendar` | `{dates: Object<string, string[]>}` — every named date → list of event ids (`'Jan 1': ['newYear','subsidence','foundersDay']`, `'Jan 5': ['semester','tuition1']`, `'Jan 10': ['springLock']`, `'Feb 6': ['mardiGrasStart']`, `'Feb 8': ['parade']`, `'Feb 9': ['firstGator']`, `'Mar 1': ['crawfishStart','azaleas']`, `'Mar 5': ['tuition2']`, `'Mar 25': ['riverTicker']`, `'Apr 1': ['highWaterStart']`, `'Apr 5': ['crawfishBoil','scriptedCell']`, `'May 5': ['graduation','attrition']`, `'May 6': ['summer']`, `'Jun 1': ['hurricaneSeason','obj11']`, `'Jul 1': ['stateFunding']`, `'Jul 2': ['amelie']`, `'Aug 1': ['boudin']`, `'Aug 5': ['fallLock','tuition1','recruit','semester']`, `'Oct 5': ['tuition2']`, `'Oct 7': ['bonfire']`, `'Oct 8': ['homecoming']`, `'Dec 1': ['finals']`, `'Dec 9': ['leveeBonfires']`, `'Dec 10': ['attrition']`, `'Dec 11': ['break']`), plus `festivals: [{id, start: 'Feb 6', end: 'Feb 8', text}]` (§14.3 copy) |
| `data.ticker` | `string[62]` (§14.4, with `{}` fields); `data.tickerKinds: Object<number, kind>` |
| `data.objectives` | `Object<string, {kind: BSU.OBJ.*, title, text (≤ 12 words), reward: {grant?: 50000, prestige?: 2}, teaches, showMe: 'plot'\|'cove'\|'landing'\|'crown'\|'ring'\|'target', deadlineText}>` for ids `'1'…'22'` incl. `'11a'`, `'18a'`, `'18b'` |
| `data.milestones` | `[{id, name, text, reward: {cash?, prestige?, effect?}}]` (26) |
| `data.voiceCards` | `[{id, student, major, text, payoff, prereq: string /*a check id the progress module implements*/}]` (12) |
| `data.boardCards` | `[{id, name, text, cost, effect: string}]` (8) |
| `data.failureCards` | `{bankruptcy: {title, options: [{id, text}]}, underwater: {...}, probation: {...}}` |
| `data.tutorial` | `[{stage, card, hint}]` (§10.1 copy) |
| `data.thibodeaux` | `string[]` speech-bubble variants; `data.stormQuotes`, `data.coachQuotes` |
| `data.overlays` | `[{ov, key, name, legend: string[]}]` (`K` legend: Ambient/Annoying/Biblical/State Bird) |
| `data.keys` | the §7.4 keyboard map as `[{key, action, ctrl?: boolean, shift?: boolean}]` (single source for the settings keybind sheet) |
| `data.rainKinds` | `{shower: {total: .04, steps: 40}, frontal: {total: .125, steps: 40}, band: {total: .33, steps: 40}, cell: {steps: 60, radius: 14}, hurricane: {inches: [6,8,10,13,16], steps: 360}}` |

`data.selfTest()` validates every catalog row against `BSU.catalogRowSchema`, that all 43 ids are in `BSU.B` and `BSU.B_ORDER`, that every decal named by a row exists in `data.decals`, that `data.ticker.length === 62`, and that every `date` string parses with `BSU.dateToDay`.

---

## 5. Simulation modules: exact APIs and the tick order

### 5.1 One sim tick (100 ms of sim time), executed by `session.tick1()`

All steps run every tick in this order; each is wrapped in try/catch (§10.1). "Daily" steps run only on the tick in which `calendar.day` advanced (`weather.tick` returns flags); rate-gated steps check `T % 10`.

| # | Call | Rate | What it does (owner writes only its branch) |
|---|---|---|---|
| 0 | `session`: `const T = state.tick;` compute `state.calendar.frozen = !state.calendar.running || !!state.setPiece`; if `state.setPiece` → `state.setPiece.tick` is the current set-piece tick (0-based) | every | bookkeeping |
| 1 | `flags = BSU.weather.tick(state)` → `{newDay, newMonth, newYear, day}` | every | advances `sky` (300-tick cycle; scripted during set pieces), advances `calendar.dayTick` and rolls the day when not frozen (emits `calendar:day`, `calendar:date`, `calendar:month`, `calendar:semester`, `calendar:year` in that order, **before** returning); on a new day: draws/starts rain events, heat, wind, fog, river/bayou stage schedule (§6.9), storm lifecycle transitions (wave→named→watch→bands→landfall), Célestine hold rule, Years-2+ schedule (Jan 1), festival start/end; during a landfall/near-miss set piece runs the tick timeline (`storm:phase`, `storm:pulse`, `storm:toast`, camera cues) and calls `BSU.hydro.surgeControl`; writes `state.weather.dtDay` for this tick (0 when `setPiece.kind` ∈ {game, parade, graduation, montage}; 1/360 landfall; 1/60 nearMiss; else 1/40 if `T % 10 ∈ {0,2,5,7}` else 0) |
| 2 | `BSU.terrain.tick(state, flags)` | every (daily work inside) | daily: sandbag expiry (`sandbag = 0` when `day ≥ sandbagDay`), debris clearing (5 days after `storms.lastLandfallDay`, or instantly within 14 of a Wildlife Post — the post check is a query to buildings), `wear −= 5`, `DESIRE_WORN` re-evaluation; yearly (Jan 1): subsidence step (writes `elev`, `subs`, `Building.sunk` via `buildings.applySubsidence(id, ft)`), then `classify` + `rewalk` for every changed tile |
| 3 | `BSU.hydro.tick(state)` | hydro step when `dtDay > 0` or a set piece needs relaxation (`dtDay === 0` still runs the flow passes with no intake/drain when `state.setPiece` is a game/parade/graduation); daily work on `flags.newDay` | rain intake for this step; canal-network refresh if dirty; 2 Jacobi passes; pumps and pond sinks; boundary reset; surge front advance (during landfall); floodgate/barrier open-close; daily: `stand`, `sat` decay, drained-marsh flip/revert, Marsh Restoration progress, building flood transitions (`building:flooded/dried`), levee overtop/breach bookkeeping, risk-cache expiry |
| 4 | `BSU.buildings.tick(state, flags)` | every (mostly daily) | construction progress (daily, using `built += 1/buildDays`), tier upgrades, retrofit/regrade completion, `closedUntil`, flood damage (daily 2%/5%/25%), auto-repair, board-up crews (daily), generator fuel burn (daily), blackout/outage expiry, coverage recompute when dirty (`coverage:changed`), ring cache recompute when dirty (`ring:changed`), wind damage on `storm:pulse` (queued, applied here), Water Tower topple / substation outage rolls applied at the set-piece ticks weather announces |
| 5 | `BSU.wildlife.tick(state, flags)` | 10 Hz gators/officers; daily mosquito, ecology, incidents; monthly nutria | gator state machines and movement; officer wrangles; Le Grand; campus mask recompute when dirty; daily: mosquito field update, `mosqIndex`, illness count (`wildlife.sick`), ecology recompute (`ecology:changed`), egret/firefly targets; monthly (1st): nutria burrows (`levee:burrow`), fogger penalty |
| 6 | `BSU.agents.tick(state, flags)` | 10 Hz (off-screen agents every 4th tick) | daily reconcile (`flags.newDay`) toward `agents.count(state)` (§5.8: agents belonging to an in-flight arrival are excluded; extras become `GONE` and stay in the array, never spliced), schedule by sky phase, A* queue (≤ 8/tick), movement with walk classes, reactions (flee, wade, slap, sit, cheer), per-agent sampling accumulation, `wear` increments, class-attendance counters (reset at Dawn, read at Dusk), vehicles (pirogues on `enroll:*`, buses, fogger at Dusk, Cajun Navy, board-up crew sprites) |
| 7 | `BSU.economy.tick(state, flags)` | every tick: happiness EMA accumulation; daily: capacity, sampled terms roll-up, timers effects, runway; dated: installments, rolling rounds (5th), locks (Jan 10 / Aug 5), state funding (Jul 1), attrition/graduation (May 5, Dec 10), Board offer request (Jan 10 / Aug 5 → asks progress), monthly (1st): statement, upkeep, salaries, utilities, interest, donations, research, parking, pelts, endowment, prestige lerp, applicants, bankruptcy counter | all money and the five displayed stats; emits `econ:*`, `enroll:*` |
| 8 | `BSU.sports.tick(state, flags)` | daily + set-piece ticks | schedule build (Aug 5 / when a team first exists), game days (start set piece or off-screen sim), the 750-tick game timeline when `setPiece.kind === 'game'`, the montage, halftime toast, revenue posting via `economy.post`, season end (Dec 8), offseason candidates (Dec 9), starters redraw (May 5, Aug 5), recruit card |
| 9 | `BSU.progress.tick(state, flags)` | every | tutorial script (stage machine), objective triggers/progress/completion, queue promotion (**one offer per tick**), milestones, timers expiry (daily), Student Voice (3rd), Board cards (resolve), failure states (monthly checks), receiver autopilot, Founders' Day recap (Jan 1, Year 2+), set-piece starts it owns (parade Feb 8 Dusk, graduation May 5) via `session.startSetPiece`, the parade/graduation timelines, scripted cells (push to `weather.cellQueue`), the first-warning speed drops, Célestine "offered" flag |
| 10 | `session`: if `state.setPiece` and `setPiece.tick + 1 ≥ setPiece.len` → `endSetPiece()`; else `setPiece.tick++`. If `flags.newMonth` → autosave per the §8.4 rules (after economy; never mid-set-piece; headless only when opted in). `state.rng.sim = BSU.rng.sim.state`. `state.economy.ecology = state.wildlife.ecology`. `state.tick++`. `playSeconds` += 0.1 in headless mode (browser: wall-clock in the main loop). | every | |

Order rationale: weather first so every module sees the same date/sky/dtDay; terrain before hydro so `type`/`walk`/`elev` are settled; hydro before buildings so flood transitions precede damage; wildlife before agents so agents flee current gator positions; agents before economy so today's samples are complete; sports before progress so game results precede achievement checks; progress last so it can react to everything emitted this tick and offer at most one objective per tick.

**Speed.** `state.ui.speed` is the setting. `session` computes ticks-per-real-second = `setPiece ? 10 : speed * 10` (0 when paused; the title screen and the charter card run 0 ticks but still render). See §9.3.

**Calendar freeze during set pieces.** `weather.tick` does not advance `dayTick` while `calendar.frozen`; `sky` is driven by the set piece's script (`weather.scriptSky(phase, t)` called by the owning module) with `sky.scripted = true`; on `setpiece:end` the sky resumes from its pre-set-piece `cycleTick`. Agents, gators, particles, hydro relaxation and the set piece's own timeline still advance per tick.

### 5.2 `terrain.js`

```js
BSU.terrain.gen(state, seed) → void            // fills tiles.elev/flags/surface/type/walk, tiles.depth/sat initial (via hydro.seedInitial), state.plot, state.veg; re-rolls up to 50 derived seeds, then loads the template map (state.plot.template = true)
BSU.terrain.classify(state, i?) → void         // recompute tiles.type for one tile or all (§3.3 rules; Marsh = elev < 1.5 && no water flag && !POND_SINK; POND = POND_SINK)
BSU.terrain.rewalk(state, i?) → void           // recompute tiles.walk for one tile (and, for 'all', every tile) from surface/type/depth/flags/owner (§7 Pathfinding rules; owner ≥ 0 → 0)
BSU.terrain.touch(state, i, what) → void       // the ONLY way any module reports a tile change: sets dirty (walk, chunk, ring, routes), emits tile:changed
BSU.terrain.setSurface(state, i, surf) → void  // writes tiles.surface (validated: surf 0–4), then touch(i,'surface')
BSU.terrain.setElev(state, i, ft) → void       // writes elev, classify, rewalk, touch(i,'elev')
BSU.terrain.setFlag(state, i, bit, on) → void  // for terrain-owned bits; other owners write their bits directly then call touch(i,'flags')
BSU.terrain.tileAt(state, tx, ty) → TileInfo   // {i, tx, ty, type, elev, depth, sat, stand, mosq, subs, crest, integrity, sandbag, surface, owner, flags, walk, drainsTo: string} for the inspect panel
BSU.terrain.isLand(state, i) → boolean         // not OPEN_WATER/BAYOU/POND
BSU.terrain.isWater(state, i) → boolean        // OPEN_WATER or BAYOU flag
BSU.terrain.reachableDryHigh(state) → Uint8Array   // tiles ≥ 3.5 ft reachable from the plot over land not crossing Water/Bayou/Marsh (G7; cached until tile:changed)
BSU.terrain.ridgeFull(state, w, h) → null | {tx, ty, elev, floodsAt: 'Cat 2'|'rain'}   // §3.6 "Ridge full" second line: null when a ≥ 5-ft flat w×h remains
BSU.terrain.applySubsidenceYear(state) → void   // Jan 1 step (§6.5); calls buildings.applySubsidence(id, ft) for each affected footprint
BSU.terrain.bank(ty) → number; BSU.terrain.gen guarantees(state) → {ok, failed: string[]}   // G1–G8 asserts (also used by selfTest)
BSU.terrain.streetlamps(state) → number[]      // tile indices with a lamp (every 4th road / 6th path tile along each 4-connected run from its lowest index); cached
BSU.terrain.paradeRoute(state) → number[]      // longest 4-connected run of surface 2 (≥ 4 tiles), else longest path run, else [] (krewe circles Founders')
```
Generation writes through `hydro.seedInitial(state)` for `depth`/`sat` so the initial state of §3.3 has one owner. `terrain.reset` rebuilds the reachability cache, the lamp cache and the parade route.

### 5.3 `hydro.js`

```js
BSU.hydro.seedInitial(state) → void            // §3.3 initial depth/sat/stand
BSU.hydro.tick(state) → void                   // §5.1 step 3
BSU.hydro.depthAt(state, tx, ty) → number
BSU.hydro.surfaceAt(state, i) → number         // H(i) live head (§6.1.4), for the inspect panel and bridge rules
BSU.hydro.stageAt(state, i) → number           // boundary stage for water tiles (river/bayou/barrier-held)
BSU.hydro.floodedBuildings(state) → number[]   // building ids with flooded === true
BSU.hydro.floodedTiles(state) → number         // land tiles with depth ≥ 0.5 (snapshot)
BSU.hydro.predictRisk(state) → Float32Array    // the F overlay: 40 CA steps on a scratch copy with 2 in map-wide rain at current sat (+ river stage while the window is open); cached until tile:changed or 5 days
BSU.hydro.riskAt(state, i) → number            // predicted ft (from the cache)
BSU.hydro.footprintDepth(state, id) → number   // deepest tile of a building's footprint
BSU.hydro.markCanal(state, i, on) → void       // buildings calls this for canal placement/removal: flag bit2, bed cut (elev handled by terrain.setElev), FLOODGATE bit when crest > 0, networks dirty
BSU.hydro.markPond(state, tiles, id, on) → void
BSU.hydro.markLeveeChange(state, i) → void     // after crest/integrity/sandbag writes: floodgate bit re-evaluation, ring dirty (via terrain.touch(i,'crest'))
BSU.hydro.setJammed(state, i, on) → void       // weather calls at set-piece tick 150 / gate-crew resolution: FLAG.JAMMED mirror of storm.jammedGates, k = 0 rule off, ring dirty
BSU.hydro.networks(state) → Network[]          // {id, tiles: number[], drainsToWater: boolean, pumps: number[] (building ids), gates: number[]}; rebuilt lazily
BSU.hydro.networkAt(state, i) → Network | null
BSU.hydro.surgeControl(state, cmd, arg) → void // called by weather: ('begin', {stage, entry: number[], dir}) at set-piece tick 150; ('stage', ft) each tick while ramping/holding/receding; ('end') at tick 750; near-miss: never (bands only)
BSU.hydro.forceRain(state, {cx, cy, inches, radius, steps}) → void   // debug/progress: immediate cell (scripted 1:15 / Apr 5 cells go through weather.cellQueue instead)
BSU.hydro.forceSat(state, tiles, sat) → void   // Apr 5 script: cove sat ≥ 0.7 the day before
BSU.hydro.setStages(state, river, bayou) → void   // weather writes the schedule; hydro applies to boundary tiles each pass
BSU.hydro.conservationCheck(state) → {total, leak}   // T5; selfTest
BSU.hydro.drainsTo(state, i) → string          // 'Canal → Bayou' | 'Pump 2 → Bayou' | 'Pond' | 'nowhere (standing)' | 'ground'
BSU.hydro.surgeReached(state, i) → boolean     // true while state.hydro.surge is non-null and the front has reached tile i (front[i] <= surge.reached); false otherwise. Render (pass 3 surge water), render_fx (foam) and ui read this — never a `front` array
BSU.hydro.surgeFrontDistance(state, i) → number   // the BFS distance from surge.entry (65535 when unreachable or no surge); render_fx gradients
```
`surgeControl('begin', {stage, target, entry, dir})` stores `state.hydro.surge = {stage, target, entry, dir, reached: 0, t0: state.tick}` and builds the front in a closure; `hydro.reset` rebuilds the same front from `surge.entry` when `surge` is non-null (a load mid-landfall resumes correctly). Both query functions are pure over `state` plus that closure (self-healing per §1).
Integrity writes: hydro writes `tiles.integrity` for overtopping (−10/day), surge contact (−5×cat once per storm) and breach (0) and then calls `buildings.onIntegrityChanged(i)`; wildlife writes the burrow −15 the same way; buildings writes placement (100) and repairs. `buildings.onIntegrityChanged` invalidates the ring cache and the run-name cache. Nobody else touches `integrity`.

Flood state (daily): a building is `flooded` when `footprintDepth ≥ (pilings ? 3.0 : 0.5)`; hydro sets `Building.flooded/floodedSince` (the one exception to "only the owner writes": documented here and in D6) and emits the event; buildings applies the consequences.

### 5.4 `weather.js`

```js
BSU.weather.tick(state) → {newDay: boolean, newMonth: boolean, newYear: boolean, newSemester: boolean, day: number}
BSU.weather.date(state) → {day, year, month, dom, str: 'Sep 3, Y1', season, semester}
BSU.weather.isDate(state, 'Aug 5') → boolean           // today?
BSU.weather.dayOf(state, 'Aug 5', yearOffset = 0) → number
BSU.weather.sky(state) → {phase, t, phaseTick, scripted}
BSU.weather.scriptSky(state, phase, t) → void         // set-piece owners drive the sky; sky.scripted = true until releaseSky
BSU.weather.releaseSky(state) → void
BSU.weather.rainAt(state, tx, ty) → number             // 0–1 local rain intensity this tick (cell falloff), for FX and agents
BSU.weather.raining(state) → boolean
BSU.weather.heat(state) → {index, advisory, wave}
BSU.weather.wind(state) → {speed, angle}
BSU.weather.storm(state) → Storm | null                // storms.current
BSU.weather.cone(state) → null | {track: {tx,ty}[], width, point, landfallDay, cat, forecastCat}
BSU.weather.forecastSurge(state, catOverride?) → number   // ft; params.storm.surge[cat]
BSU.weather.spawnStorm(state, {cat, nearMiss = false, coneNowTick: number, landfallTick: number, compressed: boolean, name?}) → Storm   // the ONE storm factory. `compressed` (REQUIRED, stored as storm.compressed): true → the lifecycle is TICK-driven (watch at tLandfall−300, bands at −100, landfall at tLandfall) — debug "Spawn Cat N" and headless.forceHurricane pass true with landfallTick = T + 600; false → DAY-driven (landfallDay = day + ceil((landfallTick − T)/100); transitions on day boundaries) — the Célestine hold rule passes false. Nothing else distinguishes the two callers
BSU.weather.scheduleNearMiss(state, day, name) → void   // Amélie
BSU.weather.setPlayThrough(state, on) → void
BSU.weather.prepAction(state, action, arg) → {ok, cost, reason}   // 'boardUp' (arg: building ids[] or 'all'), 'sandbags', 'repairAll', 'evacuate', 'preDrain', 'spillway'; validates the cone exists, charges via economy.charge, applies via buildings/hydro action functions
BSU.weather.answerToast(state, id, answer) → void      // ui/decision → applies the toast's effect (sandbag crew, shelter overflow, refuel, gate crew)
BSU.weather.skipSetPiece(state) → void                 // landfall: jump to tick 750 with defaults (only if setPiecesSeen.landfall)
BSU.weather.riverStage(state) → {river, bayou, window: boolean}
BSU.weather.queueCell(state, {day, cx, cy, inches, scripted}) → void   // progress pushes the two scripted cells
BSU.weather.suppressRainOn(state, day) → void          // scripted night game
BSU.weather.setRunning(state, on) → void               // calendar.running (tutorial's first path; skipTutorial sets true at newGame)
BSU.weather.consumeRainStep(state) → {r: number /*ft this step*/, cx, cy, radius, mapWide: boolean} | null   // hydro calls this once per hydro step: returns the intake and footprint, decrements event.stepsLeft, ends the event at 0 (weather:rain start:false) — D14
```
The landfall timeline is data in `weather.js` (an array of `{tick, fn}` hooks, §6.2 table): tick 0 `storm:phase OUTER`; 150 `WALL` + rolls decided (`storm.rolls`, `jammedGates`) + `hydro.surgeControl('begin')` + camera cue `entry`; 250 pulse 1; 300 toast `sandbag` and/or `shelter` (shelter at 330 when both qualify in Year 1); 350 `LANDFALL` + surge peak + camera cue `ring`; 380 pulse 2 (tower roll plays); 400 toast `fuel`; 450 `EYE` (Cat 3+ only; otherwise phase BACK begins at 500 with no eye); 450 toast `gate`; 480 gate crew resolves; 500 `BACK` (recede); 550 pulse 3; 680 pulse 4; 750 `CLEARING` + `hydro.surgeControl('end')` + damage report assembled (`buildings.damageReport`) + `storm:report`; 900 end (session ends the set piece; `storm:passed` when the report modal closes, or immediately in headless mode). The near-miss is 150 ticks of a band (4 in, wind 0.5) with `dtDay = 1/60`, no surge, no toasts, phase `BANDS` only.

**Bands step (T−1, in the new-day step; for a compressed storm at `tLandfall − 100`):** phase BANDS, `storm:bands`, the band rain event, `wind .5`; then `BSU.agents.shelter(state, BSU.buildings.shelterAssignments(state))` (the `{buildingId: capacity}` map, §5.6/§5.8); then **if `BSU.sports.upcoming(state)` is a home entry with `day === today` and `storm.forecastCat ≤ 1` → `BSU.sports.offerPlayThrough(state)`** (sports opens the `playThrough` decision toast and acts on its `decision:closed`; weather only exposes `setPlayThrough`, which sports calls on 'yes'). Weather is the only caller of `offerPlayThrough`.

**Célestine hold rule** (`storms.celestine`): on each new day in Year 1 from Sep 2 (or any day after a hold), if `playSeconds ≥ 540` and `progress.offered('11')` → `spawnStorm(state, {cat: 2, coneNowTick: T, landfallTick: T + 600, compressed: false, name: 'Célestine'})`: cone today, `landfallDay = day + 6` (day-driven, so a game/parade set piece that freezes the calendar between cone and landfall does not drift it); if Oct 5 passes without both, `state = 'held'` and Year-2 random storms are suppressed until `state === 'done'`. In headless mode `playSeconds = tick/10`, so with `skipTutorial` at 10 tps the cone appears Sep 2 of Year 1 (tick ≥ 5,400 is minute 9, i.e. day 54 = Feb 25, long before Sep 2).

### 5.5 `wildlife.js`

```js
BSU.wildlife.tick(state, flags) → void
BSU.wildlife.gators(state) → Gator[]                   // state.gators (read-only for others)
BSU.wildlife.mosqAt(state, tx, ty) → number
BSU.wildlife.mosqIndex(state) → number                 // campus index (daily)
BSU.wildlife.ecology(state) → number; BSU.wildlife.ecologyTerms(state) → Object
BSU.wildlife.onCampus(state) → Gator[]                 // gators whose tile is in the campus mask
BSU.wildlife.campusMask(state) → Uint8Array            // Chebyshev-3 of footprints and surface 1–2 tiles; cached; rebuilt on tile:changed/building:placed/removed
BSU.wildlife.spawnGator(state, i, name?) → Gator       // debug "Spawn gator here"; also the post-storm wave
BSU.wildlife.forceFirstGator(state) → void             // progress: first Dusk ≥ Feb 9, target = the Dining Hall dumpster (or Founders' if none)
BSU.wildlife.relocate(state, gatorId) → void
BSU.wildlife.sickToday(state) → number                 // mosquito + heat illness (students)
BSU.wildlife.fireflyTarget(state) → number; BSU.wildlife.birds(state) → {egrets, spoonbills, pelicans}
BSU.wildlife.nutriaTraps(state, i) → boolean           // a Wildlife Post within 14 of tile i (query used by terrain for debris and by itself for burrows)
BSU.wildlife.gatorGridPassable(state, i, gator) → boolean   // §6.3 gator grid rule (own A*, cached)
BSU.wildlife.forceMosquito(state, i, v) → void         // debug
```
Ecology is recomputed daily and copied by session into `economy.ecology` (step 10) so the HUD reads one number; its change event is `econ:stat{stat:'ecology'}`.

### 5.6 `buildings.js`

```js
/** Placement query. opts = {rot: 0|1, pilings: boolean, grade: boolean, tiles?: number[] (drag: the whole run for the ring preview), ignoreCash: boolean}
 *  Returns a full ghost description; ok === false never throws. reason strings are the §11.2 one-liners. */
BSU.buildings.canPlace(state, id, tx, ty, opts) → PlaceResult
PlaceResult = { ok: boolean, color: 'green'|'yellow'|'red', reason: string, cost: number, baseCost: number, tiles: number[] /*footprint or run*/,
                needsGrading: boolean, gradingCost: number, needsPilings: boolean, pilingsCost: number, terrainMod: number, summer: boolean,
                access: boolean, roadOk: boolean, power: boolean, water: boolean, radius: number /*coverage ring for the ghost*/,
                ridgeFull: null|{tx,ty,elev,floodsAt}, sink: null|{rate, year, retrofit} /*§3.6 second line*/,
                ring: null|{closes: boolean, short: number, where: string} /*levee/floodwall drags*/, affordable: boolean }
BSU.buildings.place(state, id, tx, ty, opts) → {ok, reason, id?: number /*building*/, tiles?: number[], cost}   // charges economy; emits building:placed / tile:changed; drag rows place ONE tile
BSU.buildings.placeRun(state, id, tiles: number[], opts) → {ok, placed: number, cost, skipped: {i, reason}[]}   // drag release: places every legal tile of the run in order (best effort), one undo record
BSU.buildings.remove(state, idOrTile, reason = 'demolish') → {ok, refund}   // footprint id (number) or a drag tile index ({tile: i}); founders/landmarks refuse
BSU.buildings.undo(state) → {ok}                        // the last placement within 5 s wall-clock (50 ticks headless), full refund
BSU.buildings.list(state, type?) → Building[]           // non-null entries, optionally filtered by catalog id
BSU.buildings.get(state, id) → Building | null
BSU.buildings.at(state, tx, ty) → Building | null
BSU.buildings.count(state, type) → number; BSU.buildings.has(state, type, minTier = 0) → boolean
BSU.buildings.footprint(state, id) → number[]
BSU.buildings.coverage(state, kind, tx, ty) → number    // kind: 'power'|'water'|'dining'|'happiness'|'mosquito'|'heat'|'shade'|'green'|'life'|'noise' → the aura value at the tile (0 if none); 'power'/'water' → 0/1
BSU.buildings.auras(state) → AuraMaps                   // {life: Float32Array, green: Float32Array, dining: Uint8Array, shade: Float32Array, heat: Float32Array, mosq: Float32Array, noise: Float32Array}; rebuilt when dirty; agents sample these (the sampled happiness terms)
BSU.buildings.recomputeCoverage(state) → void           // §4.11 assignment; sets powered/watered/provider/blackout; emits coverage:changed and power:*
BSU.buildings.protection(state, H) → Uint8Array         // 1 = reached; cached per H until invalidated
BSU.buildings.gaps(state, H) → {gaps: {tiles: number[], len, cx, cy, name}[], weak: {i, integrity}[], gates: {i, jammed}[], reachedBuildings: {id, depth}[]}
BSU.buildings.ringClosed(state, H) → boolean            // every core building protected (core = founders + every needsPower row)
BSU.buildings.coveTilesUnreached(state, H) → boolean    // Objective 11 test
BSU.buildings.boundaryLevees(state, H) → number[]       // levee/floodwall tiles on the reached/unreached edge (Sandbags target, bonfires, Fortress test)
BSU.buildings.repair(state, id) → {ok, cost}; repairAll(state) → {ok, cost}; repairLevee(state, i) → {ok, cost}; repairAllLevees(state) → {ok, cost}
BSU.buildings.retrofitPilings(state, id) → {ok, cost}; regrade(state, id) → {ok, cost}; rename(state, id, name) → void
BSU.buildings.upgrade(state, id) → {ok, cost, tier}     // stadium tiers / Bayou Field
BSU.buildings.setPolicy(state, id, key, value) → {ok, cost}   // 'gatorProofDumpsters'|'nutriaBounty'|'active'
BSU.buildings.refuel(state, id) → {ok, cost}
BSU.buildings.boardUp(state, ids: number[] | 'all') → {ok, cost, queued}   // crews board 6/day (12 with a post) from tomorrow
BSU.buildings.sandbags(state, H) → {ok, cost, tiles}    // boundary levee tiles at H
BSU.buildings.applyWindPulse(state, n, share) → void    // on storm:pulse (buildings subscribes and applies in its tick)
BSU.buildings.applySubsidence(state, id, ft) → void     // terrain calls yearly
BSU.buildings.onIntegrityChanged(state, i) → void
BSU.buildings.damageReport(state, storm) → Storm.damageReport
BSU.buildings.shelter(state) → {capacity, students, ok, lines: string[]}
BSU.buildings.shelterAssignments(state) → Object<number, number>   // {buildingId: capacity} of every usable shelter (complete, unflooded, effective > 0; capacities as in shelter()); weather passes this straight to agents.shelter(state, capacities) at T−1 — agents does the per-agent assignment (§5.8)
BSU.buildings.stats(state) → {beds, seats, feeds, diningCovered: number /*share of housing tiles*/, landmarks, oaks, cypress, stockedPonds, posts, quality: number /*avg housing quality*/, lots, unrepaired, floodedCore: boolean, powerRadiusHits}   // economy reads this daily; cached per (root, calendar.day): the cache self-heals when `cacheRoot !== state` (§1), so wildlife.reset may call it on a new root
BSU.buildings.upkeepTotal(state) → number               // Σ building upkeep (pilings +5%) + per-tile drag upkeep
BSU.buildings.leveeRuns(state) → {key: string, tiles: number[], name: string}[]   // 4-connected runs of crest > 0; names in state.runNames for runs ≥ 20
BSU.buildings.dumpsterTile(state, id) → number
BSU.buildings.unlocked(state, id) → {ok, reason}        // = {ok: BSU.progress.unlocked(state, id), reason: ok ? '' : BSU.progress.unlockReason(state, id)} — progress is the single owner of the condition phrasing (§5.10); ui reads buildings.unlocked(...).reason for the palette `.cond` and the red ghost line
BSU.buildings.constructionMult(state) → number          // summer −15%
BSU.buildings.effective(state, id) → 0 | 0.5 | 1               // §4.11 multiplier: both coverages 1; one missing 0.5; both missing, flooded, closed, under construction or ruin 0; always 1 while economy.suppressCoverage (D28)
BSU.buildings.dirtyRing(state) → void                   // called by hydro/wildlife after integrity or gate changes
```
Validation order inside `canPlace` (the reason string is the first failure): unlocked → in bounds → terrain rule (placeRule) → preserve/mound → owner/footprint free (drag tiles may overlay per row rules) → slope (grading option) → marsh (pilings option) → access/path adjacency (needs `built` network) → road-within-4 → special rules (touch canal/water, near water, bayou span) → affordability (`economy.canAfford(cost)` unless `ignoreCash`). Cost = `round(baseCost × (1 + Σ terrain mods) × summer × engineering) + grading + pilings`. Charging is one `economy.charge(cost, 'construction', {i})` inside `place`.

Coverage assignment (§4.11): providers = complete, unflooded, non-blackout substations / water towers; consumer rows = `needsPower`/`needsWater`; nearest in-range provider (Chebyshev between nearest footprint tiles) with spare capacity, ties by provider id ascending; recompute on `building:placed/removed/complete`, `building:flooded/dried` of a provider, generator fuel changes and outage expiry. A Water Tower that is unpowered serves 25. While `economy.suppressCoverage` the penalty is not applied but icons still show (`Building.powered` is computed; `buildings.effective(state, id)` returns the multiplier 1 / 0.5 / 0 that every consumer of seats/beds/feeds/auras uses).

The protection flood-fill is one BFS (§6.2), cached per H in a `Map<H, Uint8Array>` cleared by `dirtyRing`; `gaps` names each gap by the nearest of: cove mouth, south shoulder, north shoulder, bayou bank, river bank, chenier, or `(x, y)`.

### 5.7 `economy.js`

```js
BSU.economy.tick(state, flags) → void
BSU.economy.canAfford(state, cost) → boolean            // cash − cost ≥ −loanLimit (construction may dip into the loan line)
BSU.economy.charge(state, amount, key, meta?) → boolean // posts an expense (ledger key, §2.7); returns false and posts nothing when !canAfford (unless meta.force: upkeep/salaries/interest always post)
BSU.economy.post(state, key, amount, meta?) → void      // income (positive) — used by sports (athletics, tailgate), progress (grants, festivals, cards), buildings (refunds)
BSU.economy.refund(state, amount, meta?) → void
BSU.economy.setTuition(state, v); setQuality(state, 'basic'|'good'|'elite'); setSelectivity(state, ...); setCoaching(state, $/yr); setTicket(state, 25|35|60); setAutoRepair(state, bool); endow(state, amount); charterWest(state) → {ok, reason}
BSU.economy.applyCard(state, cardId, option) → void     // Board and failure cards (progress resolves the UI; economy applies money/timers effects it owns; timers themselves are added through progress.addTimer)
BSU.economy.breakdown(state, stat) → {value, lines: {label, value}[], next: string}   // the click-to-breakdown popover; stat ∈ cash|students|prestige|happiness|ecology|applicants|capacity
BSU.economy.statement(state) → ledger.last
BSU.economy.runway(state) → {months, nextPayDay, red}
BSU.economy.capacity(state) → {capacity, beds, seats, dining, wastewater}
BSU.economy.applicants(state) → number; BSU.economy.previewApplicants(state, tuition) → number   // the slider preview
BSU.economy.addStudents(state, n, source: 'pirogue'|'bus'|'founding'|'debug') → void   // ONLY changes the count (`students += n`, `admittedSinceLock += n`) and emits econ:stat{students}; it emits NO enroll event and spawns nothing. `enroll:round/lock{kind:'rolling'|'spring'|'fall'}` are emitted by the rolling-round and lock steps themselves (after they called addStudents); agents react to those. The founding 120 are added by progress on `agent:arrive{kind:'founding'}` (browser) or by session before `agents.regenerate` (skipTutorial); the debug "Fill dorms" cheat relies on the daily reconcile (§5.8) for the visible agents
BSU.economy.bump(state, stat, delta, why) → void        // instant prestige/happiness bumps (milestones, objectives); happiness bumps go through timers, prestige bumps are direct
BSU.economy.modifiers(state) → {id, value, untilDay}[]  // the active happiness `events` rows (from progress.timers filtered to happiness ids)
BSU.economy.repairBill(state) → number                  // damage% × cost × 0.6 summed
```
Happiness is computed daily from `buildings.stats`, `agents.sample()` (yesterday's completed day), `wildlife.mosqIndex`, `progress.timers`, `sports` spirit and the flood/gator/heat inputs, then `happiness` (the EMA with a 1-day constant, seeded 60) moves toward it each tick: `happiness += (raw − happiness) × (1/100)` per tick. Prestige: the structural target on the 1st and `prestige += 0.06 × (target − prestige)`; instant bumps add directly. Students never fall below 60.

### 5.8 `agents.js`

```js
BSU.agents.tick(state, flags) → void
BSU.agents.list(state) → Agent[]                         // state.agents
BSU.agents.sample(state) → {life, green, mosq, heat, n}  // the completed calendar day's mean over agents (economy reads once per day)
BSU.agents.classAttendance(state) → number               // fraction for the last completed sky cycle
BSU.agents.count(state) → number                          // the D15 target: students > 0 ? min(300, 40 + floor(students/25)) : 0 — a PURE function of state.economy.students (headless.snapshot reports this, §9.5)
BSU.agents.evacuate(state) → void; BSU.agents.shelter(state, capacities: Object<buildingId, capacity>) → void   // weather calls shelter at T−1 with buildings.shelterAssignments(state) (§5.6); agents assigns ITSELF greedily: in agent index order, each present agent takes the nearest shelter building (Chebyshev from its tile) with remaining capacity and walks there (goal 'shelter'); agents left without capacity are `unsheltered` (progress reads via buildings.shelter().ok / storm flags). rng-free
BSU.agents.spawnArrival(state, count, kind: 'pirogue'|'bus'|'founding') → void   // CREATES the new agents itself (see the arrival rule below), keeps them off-map inside the vehicle(s) until landing, then they walk to Founders'/their dorm; `agent:arrive{count, kind}` when the first one reaches its goal. Called by agents' own enroll:round/lock listener (pirogue/bus) and by progress for the founding cohort
BSU.agents.regenerate(state) → void                      // deterministic from rng.derive('agents', state.tick): creates exactly count(state) agents (homes, names, positions at their dorms, or Founders' if none); called from reset (both fresh and load) and by session's skipTutorial after addStudents(120)
BSU.agents.route(state, fromI, toI, grid = 'walk') → number[] | null   // A* (also used by wildlife officers/vehicles); ≤ 8 new searches per tick, others queued (returns null → caller retries next tick). The queue is KEYED by (fromI, toI, grid): a repeated request for a key already queued or in the cache-miss list returns null WITHOUT enqueuing again; once computed the cache answers the next call. Callers may therefore re-call every tick
BSU.agents.invalidateRoutes(state, i) → void             // on tile:changed (bounding-box rule)
BSU.agents.follow(state) → Agent | null                  // '.' key picks a random agent (render camera follow)
BSU.agents.inspect(state, id) → {name, major, year, mood, activity, quote}
BSU.agents.vehicles(state) → Vehicle[]
BSU.agents.startFogger(state, postId) → void; BSU.agents.launchCajunNavy(state, dormIds) → void; BSU.agents.gameDayBuses(state, on) → void; BSU.agents.crewSprites(state, target, n) → void
```
Movement per tick: `speedTilesPerTick = params.agents.speed[class] / 10` at 1× (the tick is 100 ms of sim time regardless of the speed setting, so 4 tiles/s = 0.4 tiles per tick). Off-screen agents (outside the camera's visible tile rect + 4) update every 4th tick with ×4 displacement. Each agent stores `px, py` before moving (render interpolates `p + (cur − p) × alpha`).

**Population rule (D42).** `state.agents` is reconciled toward `count(state)` once per calendar day (`flags.newDay`) and by `spawnArrival`: (1) `spawnArrival(state, count, kind)` computes `pending = kind === 'founding' ? count : 0` (economy has already added rolling/lock students before emitting `enroll:*`; the founding 120 are added only on `agent:arrive`), `newTarget = min(300, 40 + floor((economy.students + pending) / 25))`, creates `max(0, newTarget − liveAgents)` new agents (`liveAgents` = agents whose state is not `GONE`), marks them `arrival = k` (a private per-agent field naming the in-flight arrival) and parks them inside the vehicle(s); they become visible on landing and `arrival` is cleared when they reach their goal. `newTarget` is never 0 when `count > 0` (the founding cohort creates 44 agents while `students === 0`, which is what makes `agent:arrive` fire and progress add the 120). (2) The daily reconcile ignores agents with a non-cleared `arrival` (neither counts nor despawns them), spawns missing ones at their homes and marks extras `GONE`; never during a set piece. (3) **`GONE` agents stay in the array — `state.agents` is never spliced** (`regenerate` on load builds exactly `count(state)` entries). Consequently `state.agents.length` may differ from `count(state)` during arrivals and between an attrition/graduation step and the next reconcile; nothing may assume equality — `headless.snapshot()` reports `count(state)`.

The in-progress home game is read as `state.sports.game` (there is no accessor); the `event` goal and the foam-finger prop apply while it is non-null.

### 5.9 `sports.js`

```js
BSU.sports.tick(state, flags) → void
BSU.sports.season(state) → state.sports (read-only)
BSU.sports.rating(state) → {rating, terms}
BSU.sports.winProb(state, opp: string, night: boolean, home: boolean) → number
BSU.sports.playHome(state) → {ok, reason}                // starts the game set piece (session.startSetPiece('game')) or the montage; debug "Trigger home game"
BSU.sports.simGame(state, gameIndex) → result            // off-screen: the §8 score model in one tick
BSU.sports.halftime(state, goForIt: boolean) → void      // decision toast answer (default false)
BSU.sports.skipToFinal(state) → void
BSU.sports.setNight(state, on); setAutoSim(state, on); setPermits(state, 'paid'|'free'); setHomecomingBudget(state, v); hireCoach(state, idx) → {ok, cost, reason}; fireCoach(state) → {ok, cost}; answerRecruit(state, accept) → void; postpone(state, gameIndex) → void; scheduleMakeup(state, gameIndex, day) → void
BSU.sports.venueSeats(state) → number; BSU.sports.attendance(state, game) → number
BSU.sports.upcoming(state) → schedule entry | null
BSU.sports.offerPlayThrough(state) → void               // called ONLY by weather at T−1 (§5.4) when a home entry falls on the bands day and forecastCat ≤ 1: opens ui.decision({id:'playThrough', …}); sports acts on decision:closed{id:'playThrough'} (yes → weather.setPlayThrough(true) + the playThroughIt timer; no → postpone)
```
**No `game` accessor.** The in-progress game struct is `state.sports.game` (null when none) and every consumer (wildlife's parking attractor, agents' `event` goal, render/render_fx crowd fill, ui's score bug, audio) reads it **only** as `state.sports.game`. A function named `BSU.sports.game` must not exist (a function is always truthy, which would make every day a game day).
The game set piece timeline (750 ticks): 0–200 tailgate (Golden scripted; `agents.gameDayBuses(true)`; gator attraction via `wildlife` reading `state.sports.game`), 200 kickoff (`game:kickoff`, sky Dusk), 200–600 four quarters of 100 ticks (sky Night from 300; `game:score` per scoring play at fixed offsets within the quarter drawn from `rng.sim`), 400 halftime toast (`ui.decision` id `halftime`, 80 ticks, default play safe; the answer arrives ONLY through `decision:closed{id:'halftime'}` → `sports.halftime(answer === 'yes')`, guarded by `game.halftimeAnswered` so a duplicate close is ignored; sports also enforces the timeout at tick 480 via `ui.answerDecision('halftime','default')`), 600 final (`game:final`, revenue `economy.post('athletics'|'tailgate')`, fireworks on a win), 700 exit stream, 750 end. Skip-to-final at ≥ 200 when `setPiecesSeen.game`. The montage (`kind:'montage'`, 50 ticks) is the same generator with compressed cues.

### 5.10 `progress.js`

```js
BSU.progress.tick(state, flags) → void
BSU.progress.objective(state) → {id, kind, title, text, progress, goal, showMe, background: {id, text, progress, goal, deadline} | null} | null   // what the card shows
BSU.progress.offered(state, id) → boolean                // triggered at least once (on card, queued, done or dismissed)
BSU.progress.complete(state, id) → void; dismiss(state, id) → void; reopen(state, id) → void
BSU.progress.unlocked(state, id) → boolean               // catalog row unlock (students/prestige/ecology/milestone/building) — the single source for palette state and buildings.unlocked; pure over state (self-healing cache, §1)
BSU.progress.unlockReason(state, id) → string            // the human condition for a LOCKED row, the single owner of the phrasings: 'Reach 800 students', 'Prestige 30', 'Ecology 40', 'Earn Fortress Bayou', 'Build the Engineering Hall or reach 2,000 students'; '' when unlocked. buildings.unlocked wraps both (§5.6); ui never composes this text itself
BSU.progress.earned(state, milestoneId) → boolean; BSU.progress.achieve(state, milestoneId) → void   // idempotent; no-op while the debug panel is open
BSU.progress.addTimer(state, id, value, days, meta?) → void   // untilDay = (days === Infinity || days < 0) ? -1 : day + days. -1 = open-ended (while the source exists; the owner must call removeTimer) and is what the LIVE state holds — Infinity is never stored (§10.3, D23). Daily expiry test: t.untilDay >= 0 && t.untilDay <= day → remove + timer:expired. Same id → replace (value/untilDay/meta); `voiceApplicants` adds the value
BSU.progress.removeTimer(state, id) → void; BSU.progress.timer(state, id) → Timer | null; BSU.progress.timers(state) → Timer[]
BSU.progress.ticker(state, textOrLineNo, fields?, kind?, subject?) → void   // formats a §14.4 line (number) or raw text; pushes state.ticker (≤ 30); emits ui:ticker
BSU.progress.offerBoard(state) → void; answerBoard(state, cardId | null) → void
BSU.progress.offerVoice(state) → void; answerVoice(state, id, accept) → void
BSU.progress.failureCard(state, kind) → void           // does NOT open a card: records state.progress.failure.pendingKind = kind; for kind 'underwater' (progress owns that counter) it also emits econ:card{kind:'underwater', options} — ui_panels is the only opener of the failure card (§7.7)
BSU.progress.answerFailure(state, kind, optionId | null) → void   // called by the failure card's buttons (ui_panels); idempotent per pendingKind (a second call with the same kind is ignored); clears pendingKind
BSU.progress.showMe(state, id) → {tx, ty, tiles?: number[]}   // target for the camera flash
BSU.progress.tutorialStage(state) → number; BSU.progress.advanceTutorial(state, stage) → void
BSU.progress.nearestMilestones(state, n = 3) → {id, name, progress, goal}[]
BSU.progress.recap(state) → recap | null; BSU.progress.setPieceSeen(state, kind) → boolean
BSU.progress.debugOpen(state, open) → void               // achievements suppressed while open
BSU.progress.fireAllToasts(state) → void                 // debug: opens every decision toast once with its real handler
```
Scripting authority: `progress.js` is the only module that calls `weather.queueCell/suppressRainOn/scheduleNearMiss/setRunning`, `wildlife.forceFirstGator`, `session.startSetPiece('parade'|'graduation')`, `session.setSpeed(…, 'cone'|'warning')` / `session.restoreSpeed(…, reason)`, `economy.addStudents(120, 'founding')`, `hydro.forceSat`. Objective triggers are evaluated in its `tick` from state and from events it subscribed to in `init` (queued, not acted on inside the listener). Offer rule: at most one `objective:offered` per tick; the next queued offer waits for the next tick.

### 5.11 `audio.js`

```js
BSU.audio.init(state) → void                    // registers event listeners only; no AudioContext yet
BSU.audio.unlock() → void                       // creates the AudioContext on the first user gesture (the charter click; ui also calls it on the first pointerdown); no-op when AudioContext is undefined
BSU.audio.play(name, opts?) → void              // one-shots: 'place','tick','invalid','money','milestone','notify','hover','demolish','growl','splash','sting','whistle','roar','trombone','bells','peal','thunder','chime','coin' (opts: {tile: i} distance gain, {delayMs})
BSU.audio.setAmbience(state) → void             // crossfades the bed by sky/season/weather/ecology (called from update)
BSU.audio.update(state, dtMs) → void            // per frame: rain/wind/drone/pump-hum/mosquito-whine levels from state; ducking; distance from the camera center
BSU.audio.mute(on) → void; BSU.audio.muted() → boolean; BSU.audio.setVolume(v) → void; BSU.audio.applySettings(settings) → void
BSU.audio.motif(name: 'zydeco'|'mardiGras', on) → void   // Tier 2
```
Every function returns immediately when there is no context (headless, or before the first gesture). Voice cap 12; ambience −12 dB; ducks −6 dB under stings; the mute choice lives in `ui.settings.muted` (persisted). Listens to: `building:placed/complete/removed`, `econ:income`, `milestone:earned`, `ui:notify`, `gator:campus`, `weather:lightning` (thunder delayed 0.3–2 s by distance), `levee:overtop`, `game:kickoff/score/final`, `storm:phase`, `festival:start`, `objective:complete`, `decision:open`.

---

## 6. Rendering: `sprites*.js`, `render.js`, `render_fx.js`

### 6.1 Sprite atlas API

```js
BSU.sprites.init(state) → void                  // builds the 1× atlas (and the 2× atlas lazily on first zoom-2 frame); ~215 building canvases at load; in headless mode canvases are stub elements and painting is a no-op
BSU.sprites.get(id, variant, frame, zoom) → SpriteRef | null
SpriteRef = { canvas: HTMLCanvasElement, sx, sy, sw, sh /*source rect in that canvas*/, ox, oy /*offset from the anchor point to the top-left, in px at that zoom*/ }
BSU.sprites.registerPainter(family: string, fn: (ctx, spec) => {w, h, ox, oy}) → void   // split files register at definition time (allowed: no DOM)
BSU.sprites.paintBuilding(ctx, row, variant, frame, zoom) → {w, h, ox, oy}   // the one parameterized painter (sprites_buildings.js)
BSU.sprites.agentLook(seed) → number            // packs skin (0–5), hair (0–7), shirt (0–2) into the variant int
BSU.sprites.memoryMB() → number                 // live canvas bytes / 2^20 (render enforces the 64 MB cap)
BSU.sprites.palette → BSU.params.palette
```
`zoom` ∈ {0.5, 1, 2}; requests at 0.5 return the 1× entry (the renderer draws it at half size). Anchor point conventions: **buildings** — the screen position of the *south corner tile* (tx+w−1, ty+h−1) diamond center at ground elevation, the sprite drawn so its footprint's bottom vertex sits there; **tiles/decals** — the tile's diamond center; **agents/gators/vehicles** — the entity's foot point (its float tile coordinate projected); **trees** — the tile center (trunk base). `frame` wraps modulo the sprite's frame count. Ids: catalog ids for buildings (variant = `BSU.SPR` bitmask + tier bits); `tile:<T>` (variant 0–2 hash variant); `water`, `reeds`, `knees`, `worn`, `cliff`; `decal:<name>`; `oak`, `cypress`, `palmetto` (variant = stage | autumn<<2); `agent` (variant = look; frame = dir*4 + walkFrame; anims by id suffix: `agent:idle`, `agent:flee`, `agent:splash`, `agent:slap`, `agent:cheer`, `agent:sit`, `agent:wave`, `agent:tube`, `agent:umbrella`, `agent:cap`, `agent:beads`, `agent:foam`); `gator` (variant 0 juvenile / 1 big / 2 legend; frames swim/walk/sun ×2), `roux`, `officer`, `fogger`, `bus`, `pirogue`, `float`, `band`, `krewe`, `tent`, `smoker`, `cornhole`, `snoball`, `bonfire`, `egret`, `spoonbill`, `pelican`, `armadillo`, `nutria`, `navy`, `ruin:<w>x<h>`, `gate`, `barrierGate`, `nest`, `mound`, `thibodeaux`, `light:<kind>` (cached radial gradients for the lights pass: `lamp`, `window`, `mast`, `beacon`, `blink`, `arc`, `glow`, `pot`, `fire`, `firefly`, `eye`).

### 6.2 Camera and projection (`render.js`)

`state.ui.camera = {x, y, zoom}` in world px (zoom-1 space) at the viewport center. `render.camera` is the live object (the same reference). API:

```js
BSU.render.init(state) → void                   // creates the world canvas (#world) if in a browser, offscreen tint/lights/fog canvases, subscribes to tile:changed (chunk dirty), building:*, storm:*, game:*, econ:income (coin burst), setpiece:*
BSU.render.reset(state) → void                  // drops the chunk cache, resets particles, resizes
BSU.render.frame(state, alpha, dtMs) → void     // one full frame (§6.3); alpha = interpolation 0–1 toward the next tick
BSU.render.resize() → void                      // reads #app's rect; canvas = rect × devicePixelRatio (capped at 2); sets vw/vh
BSU.render.camera → {x, y, zoom}
BSU.render.panBy(dxPx, dyPx, byUser = true) → void; panTo(wx, wy, ease = true, byUser = false) → void; panToTile(tx, ty, ease) → void
BSU.render.setZoom(z: 0.5|1|2, anchorPx?: {x,y}) → void   // zoom about a screen point (pinch/ctrl-wheel), snapped; clamps
BSU.render.zoomStep(dir: -1|1) → void
BSU.render.follow(agentId | -1) → void
BSU.render.screenToTile(px, py) → {tx, ty} | null   // BSU.screenToWorld with the live camera and terrain elev
BSU.render.tileToScreen(tx, ty, elevOverride?) → {x, y}
BSU.render.visibleTiles() → {x0, y0, x1, y1}    // tile rect conservatively covering the viewport (agents use +4 margin)
BSU.render.shake(ms, px = 6) → void             // ignored when settings.shake is false
BSU.render.hitStop(ms) → void                   // session pauses ticks for ms (UI juice; never in headless)
BSU.render.flashTiles(tiles: number[], ms) → void   // Show-me highlight
BSU.render.ghost(spec | null) → void            // {tiles, color, ringTiles?, label, radius, radiusCenter, sprite?: {id, variant, tx, ty}} drawn in the overlays pass
BSU.render.dirtyChunk(i) → void; dirtyAll() → void
BSU.render.postcard(state, caption) → string    // data: URL PNG 1600×1000 with wordmark + date; temporary canvas released after (render_fx.js)
BSU.render.minimap(state) → void                // draws the 160×160 minimap canvas (#minimap) every 6th frame (render_fx.js)
BSU.render.particles.emit(type, wx, wy, n = 1, opts = {}) → void   // world px (zoom-1), opts {vx, vy, vz, life, size, color, z, spread, screen: boolean}
BSU.render.particles.count() → number; clear() → void
BSU.render.particles.forEachWorld(fn: (x, y, z, size, colorIdx, type) => void) → void   // implemented by render_fx: visits every live WORLD-space particle (screen === false) in pool order; render.js calls it exactly once per frame in pass 4 and inserts each as a rank-3 draw-list entry {ax, ay, elev, draw} (§6.3); screen-space particles are drawn by render_fx's own 'weather' pass. This is the ONLY hook through which world particles reach the depth-sorted pass
BSU.render.setOverlay(ov) → void                // fades over 150 ms
BSU.render.perf() → {frameMs, drawCalls, particles, agentsDrawn, hydroActive, chunks, memMB}
BSU.render.captureCameraTouch(state) → void     // sets state.setPiece.cameraTouched = true (ui calls on any user pan/zoom/click during a set piece)
```
Clamp: `x ∈ [minX − 200/zoom, maxX + 200/zoom]` where min/max are the world extents (x: −2016…2016, y: −84…2040 at zoom 1). Easing: every frame `x += (tx − x) × 0.15` when a target is set by `panTo`; user pans write `x` directly. Zoom steps 0.5/1/2 only. `imageSmoothingEnabled = false` always.

### 6.3 Frame pipeline (`render.frame`) — pass order, each pass in its own try/catch

1. **Setup**: resize check; compute view rect; camera easing/follow; `alpha`.
2. **Terrain chunks**: for each visible chunk (≤ 20) `drawImage(chunkCanvas, ...)` at zoom (2× = pixel-doubled 1× chunk). Dirty chunks re-bake first (budget: ≤ 2 re-bakes per frame; the rest next frame). A chunk bakes: ground diamonds (3 hash variants per type, dithered), cliff faces (tile ≥ 1 ft above its S or E neighbor), Marsh standing-water tint (reeds over dark water), reeds/knees/palmettos/worn grass, `surface` 1–4 (auto-tiled: straight/corner/T/cross from the 4-neighbors' surfaces of the same id; road bridge segments with piers; boardwalk posts; fence posts and the sign every 6 tiles), canal cuts and culvert pipes, levee berms and floodwall panels with burrow decals and gauge stripes, preserve posts, the pond, the mounds, and — at 0.5× only — the static water highlight. Chunk canvas: 512×416 at 1×; origin `ox = ((cx*8) − (cy*8 + 7))*32 − 32`, `oy = (cx*8 + cy*8)*16 − 16 − 84` (world px).
3. **Water**: per visible tile with a water flag or (non-Marsh and depth ≥ 0.05) or (Marsh and depth ≥ 0.5): translucent diamond tinted shallow→deep by depth, two scrolling 1-px sine highlight lines (skipped at 0.5×), day sparkle, night light smear; bayou current line; surge water darker with debris flecks on tiles where `BSU.hydro.surgeReached(state, i)` is true (never a `surge.front` array — it is not in state, §2.3); floodgates/barrier gates drawn here.
4. **Entities (depth-sorted)**: buildings (variant from `built < 1 → SCAFFOLD`, `ruin → RUIN`, `hp < 1 && tarp → DAMAGED`, `pilings → PILINGS`, night when `sky.phase ∈ {DUSK, NIGHT}` and powered/effective > 0, tier bits, `BOARDED` while `boardedUntil ≥ day`), trees (moss strands per frame at 1×/2×, atlas-only at 0.5×; growth stage; autumn cypress in Nov), agents (interpolated; 2-frame at 0.5×; props), gators (+ hover tags), officers, vehicles, pirogues, floats/band/krewe, tents/smokers/cornhole/snoball, bonfires, birds, in-world particles (splash, dust, foam, steam, debris, beads, petals, leaves, sparks, confetti, coin — obtained by calling `render.particles.forEachWorld(fn)` once and pushing one rank-3 entry `{ax: x/32…, ay, elev: z, draw}` per particle, §6.2). Sort key `key = 100*(ax+ay) + 2*(elev+4) + 0.25*rank` (rank: building 0, tree 1, entity 2, particle 3), insertion-sorted incrementally; buildings anchor at (tx+w−1, ty+h−1).
5. **Weather (screen space)**: rain lines (300–1,200 by `weather.rainRate`; 400 cap at 0.5×; **one** `beginPath`/`stroke`), the cell disc, lightning polyline + flash, fog blobs (8), heat shimmer rows, wind leaves/debris on bezier arcs, god rays.
6. **Tint pass**: full-screen multiply with the sky/storm color and alpha (blend between phases by `sky.t`); hurricane approach desaturation (a gray multiply at 0.3 from `storm:watch` to `storm:passed`).
7. **Lights pass** (`globalCompositeOperation = 'lighter'`, an offscreen canvas at half resolution in perf mode): lamps on `terrain.streetlamps()`, lit windows from the building night variant, masts (6 cones at Stadium II+), beacons, blinks, arcs, generator glow, boil pots, bonfires, fireflies (count from `wildlife.fireflyTarget`), lightning bloom, gator eyes at Night; skipped entirely by Day; blackout providers' consumers omitted.
8. **Fog** (when `weather.fog > 0`) and the Night vignette.
9. **Overlays**: the active `BSU.OV` tint per tile (F predicted ft, W current ft, K density with the 4-band legend, P coverage with pulsing icons, C dining radius and auras, E ecology/subsidence), the ghost preview (tiles + ring fill + radius ring + label anchor), Show-me flashes, cursor tile pulse, debug hydro numbers, the cone (also on the minimap).
10. **HUD-canvas bits**: minimap (every 6th frame), Ms. Thibodeaux portrait (48×48, on demand), palette icons (once, on `unlock:changed`), the score bug crowd meter, the perf HUD text. DOM updates are `ui.update(state, dtMs)`, called by `session` after `render.frame` (§9.3), never from inside a render pass.

Screen shake offsets the world canvas transform for passes 2–9. Chunk memory: 64 chunks × 512×416×4 ≈ 54.5 MB worst case at 1×; the renderer tracks `sprites.memoryMB() + chunks + 3 composites` and, above 64 MB, evicts the least-recently-visible chunks (they re-bake when seen again).

### 6.4 Particles (`render_fx.js`)

Pool of 2,500 (`settings.particles === 'low'` → 800) `{x, y, z, vx, vy, vz, life, maxLife, type, size, color, screen}`; `fillRect` per particle (fireworks use cached 3×3/5×5 sprites). Types: `rain, splash, dust, smoke, steam, sparks, firefly, petal, bead, leaf, confetti, coin, fogWisp, mosqDot, debris, foam, sheet, gush, lightningBloom`. Emit sources are event listeners in `render_fx.init` (e.g. `econ:income` → coin burst at the tile in `payload.i` or the top bar; `levee:overtop` → sheet; `levee:breach` → gush; `building:complete` → dust + squash; `building:removed` → puff; `game:score` → fireworks + shake; `storm:pulse` → debris arcs) plus per-frame emitters (rain splashes on water tiles, boil-pot smoke, pump foam, fogger ribbon, azalea petals in bloom, cypress leaves in Nov, mosquito haze over tiles ≥ 0.3 at Dusk/Night). In headless mode the pool still updates (cheap) but nothing is drawn. World-space particles enter render's depth-sorted pass only through `render.particles.forEachWorld` (§6.2); render_fx does not draw them itself and render does not read the pool's arrays.

### 6.5 Perf guardrail

`render` keeps a 60-frame window of frame times; if all > 25 ms: `state.ui.perfMode = true` (Low particles, fireflies ÷ 2, rain lines ÷ 2, lights canvas at quarter resolution, "performance mode" chip once). Agents are never drawn fewer than 120 (drawing skips, not sim). `test/browser.mjs --fps` is the acceptance harness.

---

## 7. UI: `ui.js` and `ui_panels.js`

`ui.js` owns the DOM. It builds everything below inside `#app` in `init` (once; guarded by `#hud` already existing), and `ui.update(state, dtMs)` refreshes text/visibility each frame (diffing: a DOM write only when a value changed). Nothing outside `ui*.js` creates or queries DOM nodes except `render.js` (its canvases: `#world`, `#minimap`, offscreen ones) and `session.js` (`#app` lookup). In headless mode the same code runs against the stub (the stub tolerates every call used here: `createElement`, `appendChild`, `classList`, `addEventListener`, `style`, `textContent`, `innerHTML`, `dataset`, `getBoundingClientRect`); `querySelector` on elements returns null in the stub, so **ui keeps references to every node it creates** (never re-queries the DOM) and reads `document.getElementById` only for `#app`.

**Stub-safe DOM subset (what `test/domstub.mjs` provides — the complete list; anything absent is forbidden in `ui*.js`, `render*.js`, `session.js` and `audio.js`).**

| Area | Provided by the stub | Forbidden (throws, returns null, or silently lies in Node) |
|---|---|---|
| Elements | `document.createElement/createElementNS/createTextNode/createDocumentFragment`, `getElementById` (only `#app` and ids assigned through `el.id =` / `setAttribute('id')`), `document.querySelector('#id')` (same ids), `body/head/documentElement`, `readyState`, `visibilityState`, `activeElement` is **undefined** | `document.querySelectorAll`, `getElementsBy*` (empty), `el.querySelector*` (null), `el.closest/matches` (null/false — never use them for logic), `instanceof Node/HTMLInputElement/HTMLCanvasElement/Text` (`Node`, `HTMLInputElement`, `Text` are not defined → ReferenceError; `HTMLCanvasElement`/`HTMLElement`/`Element` exist as aliases) |
| Element API | `appendChild/append/prepend/insertBefore/removeChild/remove/replaceChildren`, `children/childNodes/firstChild/lastChild/parentNode`, `classList` (`add/remove/toggle/contains`), `className`, `id`, `dataset` (plain object), `setAttribute/getAttribute/removeAttribute/hasAttribute`, `textContent/innerText/innerHTML` (**plain strings: `innerHTML` creates no child nodes**), `value/checked/disabled/hidden/title`, `style` (**a plain object: `el.style.width = '3px'` works; `setProperty/removeProperty/getPropertyValue` do not exist**), `addEventListener/removeEventListener/dispatchEvent`, `getBoundingClientRect` (`{0,0,width,height}` from `el.width/height`), `clientWidth/offsetWidth/scrollHeight…`, `focus/blur/click` (no-ops), `cloneNode` (shallow, empty) | `input.select()`, `setSelectionRange`, `scrollIntoView` (no-op is fine), `insertAdjacentHTML` (no-op), `contains` across nested nodes beyond one level of `children` recursion is fine — but never rely on `innerHTML`-built children (none exist) |
| Canvas | `getContext('2d')` → a Proxy: every method is a no-op function, **any property not yet assigned reads back as a function** (`ctx.globalAlpha * 2` is NaN before the first assignment — always assign before reading), `getImageData/createImageData` (zeroed), `measureText` (6 px per char), gradients/patterns (inert), `toDataURL` (`'data:image/png;base64,'`), `width/height` writable, `OffscreenCanvas` exists but is forbidden by §10.5 | `ImageData`, `Path2D`, `DOMMatrix`, `createImageBitmap`, `ctx.filter` semantics, reading pixels back for logic |
| Window | `innerWidth/innerHeight` (1280×720), `devicePixelRatio` 1, `localStorage/sessionStorage` (in-memory), `performance.now()` (**frozen at 0 unless the harness advances it**), `requestAnimationFrame` (queued, never fires on its own), `setTimeout` (never fires unless `__headless.advance`), `setInterval` (returns 0, never fires), `addEventListener` (inert), `matchMedia` (`matches:false`), `getComputedStyle` (`getPropertyValue → ''`), `Image`, `Blob`, `URL.createObjectURL`, `crypto.getRandomValues` (deterministic), `TextEncoder/Decoder`, `structuredClone`, `KeyboardEvent/MouseEvent/PointerEvent/Event/CustomEvent` (plain classes) | `AudioContext/webkitAudioContext` (absent by design), `btoa/atob` (absent — `BSU.b64` is the only base64), `fetch`, `Worker`, `navigator.clipboard.writeText` exists but resolves without effect, `history` navigation, any reliance on `performance.now()` advancing or timers firing for game logic (§10.3) |

Consequences: every element that is later read, diffed, listened to or updated is created with `document.createElement` and stored in `BSU.ui.el` (`innerHTML` only for leaf content that is never referenced again); cosmetic wall-clock timers carry a tick fallback; `ui.selfTest` verifies after `init` on the stub that every `#id` of §7.1 resolves through `BSU.ui.el`, not the DOM.

### 7.1 DOM skeleton (ids are unique; classes are reusable)

```
#app
├─ canvas#world.world                      (render.js; pointer/wheel/key target; tabindex=0)
├─ #hud (pointer-events: none; children re-enable)
│  ├─ #topbar
│  │  ├─ #brand "▣ BAYOU STATE"
│  │  ├─ .stat#stat-cash .odometer  ▸ .delta (green/red flash)         data-stat="cash"   (click → #popover)
│  │  ├─ .stat#stat-students ▸ #chip-capacity "Apps 880 / Cap 690"    data-stat="students"
│  │  ├─ .stat#stat-prestige · .stat#stat-happiness · .stat#stat-ecology
│  │  ├─ #stat-date "Sep 3, Y1 · Fall" ▸ #sky-glyph
│  │  ├─ #chip-weather (orange on advisory; "River +2 ft" in the window)
│  │  ├─ #speed  .speed-btn[data-speed="0|1|2|4"] (aria-pressed)
│  │  ├─ .btn#btn-budget · #btn-season · #btn-storm (.dot when a cone exists) · #btn-almanac · #btn-menu · #btn-mute
│  │  └─ #chip-endowed (gold, Year 5+)
│  ├─ #alert-strip.hidden  ▸ #alert-icon #alert-text #alert-action(.btn) #alert-gator(.chip, click-to-pan)
│  ├─ #minimap-wrap ▸ canvas#minimap(160×160) ▸ #minimap-viewport(div)
│  ├─ #overlay-buttons ▸ .ov-btn[data-ov="1..6"] (F W K P C E)  ▸ #legend.chip (bottom-right)
│  ├─ #objective-card ▸ canvas#obj-portrait(48×48) #obj-title #obj-text #obj-progress(.bar ▸ .fill) #obj-count #btn-showme #btn-obj-dismiss(✕) #obj-background(.row) #speech-bubble
│  ├─ #voice-card.hidden ▸ #voice-text #voice-payoff #btn-voice-accept #btn-voice-decline
│  ├─ #milestones-card.hidden ▸ .ms-row×3 (.bar)
│  ├─ #notifications ▸ .notif[data-kind="water|wildlife|money|event|danger|sports|info"] ▸ .notif-text .notif-action .notif-close
│  ├─ #decision-toast.hidden ▸ #dt-text #dt-countdown(.bar) #btn-dt-yes(Y) #btn-dt-no(N)
│  ├─ #inspect.panel.side.hidden ▸ #insp-title #insp-sub #btn-insp-close canvas#insp-sprite #insp-body(.rows) #insp-actions(.btn*)  [data-kind="building|tile|levee|agent|gator|storm|coach|veg"]
│  ├─ #ghost-label.hidden (follows the cursor: cost line, second line reason/ring/ridge/sink)
│  ├─ #tooltip.hidden
│  ├─ #popover.hidden (stat breakdown: #pop-title, .pop-line×N, #pop-next)
│  ├─ #ticker ▸ #ticker-track (translateX animation at 60 px/s) ▸ #btn-ticker-log ▸ #ticker-log.hidden (last 30)
│  ├─ #palette ▸ #palette-tabs ▸ .tab[data-tab] (.pip when new) ; #palette-items ▸ .item[data-id] (canvas.icon 64×64, .name, .cost; .locked with .cond) ; #btn-bulldoze(🔨, .active) #btn-palette-info
│  ├─ #cards (modal stack) ▸ .card#card-charter · #card-wetfeet · #card-board · #card-failure · #card-damage · #card-recap · #card-obj8 · #card-shelter … each with .card-title .card-body .card-actions(.btn*) and an optional canvas
│  └─ #perf-chip.hidden · #perfmode-chip.hidden · #hint.hidden (one-time hints, e.g. "🔊 on · M to mute")
├─ #panels (modal-ish, one open at a time)
│  ├─ #panel-budget.panel ▸ #bud-income(.table) #bud-expense #bud-runway #sl-tuition(input[type=range]) #bud-apps #seg-quality(.seg ▸ .seg-btn×3) #seg-selectivity #sl-coaching #seg-ticket #chk-autorepair #bud-loan #bud-insurance #btn-endow #btn-west
│  ├─ #panel-storm.panel ▸ #storm-title #seg-testcat(.seg) canvas#storm-cone(200×200) #storm-ring(.line) #storm-reached(.list) #storm-wind(.pick-list ▸ .row ▸ input[type=checkbox]) #storm-shelter #storm-actions ▸ #btn-boardall #btn-sandbags #btn-repairall #btn-evacuate #btn-predrain #btn-playthrough #btn-spillway
│  ├─ #panel-season.panel ▸ #sea-schedule(.table) #sea-next #sea-rating(.table) #sea-coach ▸ #btn-hire #btn-fire ; #sea-starters ; #chk-night #chk-autosim #seg-permits #seg-homecoming #btn-upgrade #score-bug
│  ├─ #panel-almanac.panel ▸ #alm-achievements(.grid) canvas#alm-sparks(600×160) #alm-storms #alm-gators #alm-recaps #btn-postcard
│  ├─ #panel-milestones.panel ▸ .ms-row×N
│  ├─ #panel-settings.panel ▸ #chk-audio #sl-volume #seg-particles #chk-shake #chk-colorblind #keys(.table) #btn-save-manual[data-slot] #btn-load[data-slot] #btn-newgame #txt-seed
│  └─ #panel-debug.panel.hidden ▸ #dbg-params(.tree ▸ .param ▸ label input[type=range] input[type=number]) #dbg-cheats(.btn*: skipdate, cash, spawncat, rain, seteco, setprestige, sethappy, spawngator, filldorms, homegame, nearmiss, testring, firetoasts, timelapse, hydronumbers, perfhud)
└─ #title (full-screen overlay; the live world renders beneath at Night)
   ├─ #title-name "BAYOU STATE" (Georgia serif, gold) #title-tag
   ├─ #btn-charter "Click to charter the university." · #btn-continue (if a save exists) · input#title-seed · #btn-title-settings · #btn-title-mute
   └─ #title-campus (canvas thumbnail after Flagship)
```
Panels open with `ui.openPanel(name)` (closes any other; `Esc` closes). Cards are queued (`ui.card(state, idOrSpec, payload?)`, §7.2) and shown one at a time; a card never opens during another card; each card id has exactly ONE opener (§7.7). Notifications: max 3, newest at the bottom, 12 s, each with ≤ 1 action; a `showMe` payload adds the Show-me button (camera pan + `render.flashTiles`).

### 7.2 `ui.js` API

```js
BSU.ui.init(state); BSU.ui.reset(state); BSU.ui.update(state, dtMs)
BSU.ui.notify(state, {text, kind, action?: {label, fn}, showMe?: number|{tx,ty,tiles?}, ttl?, onClose?: () => void}) → void   // also emitted as ui:notify (without onClose); onClose is called exactly once when the notification closes for ANY reason (the ✕, its action, ttl expiry, or replacement by a newer one beyond notifMax) — progress uses it for the first-warning speed restore
BSU.ui.ticker(state) → void                      // re-reads state.ticker (progress owns the lines)
BSU.ui.openPanel(name | null) → void; BSU.ui.panel() → name | null
BSU.ui.inspect(state, target: {kind, id?: number, i?: number}) → void; BSU.ui.closeInspect()
BSU.ui.card(state, idOrSpec: string | CardSpec, payload?: Object) → void   // THE one card entry point. A string id resolves through BSU.ui.cards[id](state, payload) → CardSpec (builders registered by ui_panels via registerCard); an object is the spec itself. CardSpec = {id, title, body: string|HTMLElement, actions: {label, fn, primary?}[], canvas?: (ctx)=>void, autoMs?, modal?: boolean}. Queued; one card at a time. Call forms: ui.card(state, 'charter'), ui.card(state, 'versionMismatch', {seed}), ui.card(state, 'damage', {report}), ui.card(state, {id:'x', title, body, actions})
BSU.ui.decision(state, {id, text, yes, no, ticks = 80, onAnswer?: (answer)=>void}) → void   // the decision toast; default 'default' on timeout (tick-based); emits decision:open then, on resolution, decision:closed{id, answer} EXACTLY ONCE per id. **decision:closed is the only delivery owners act on** (weather, sports, progress subscribe to it); onAnswer is optional, meant for ui's own tests, and no sim module passes it. ui.answerDecision(id, answer) is idempotent (a resolved id ignores further answers)
BSU.ui.selectTool(state, id | null) → void; BSU.ui.tool() → state.ui.tool
BSU.ui.setOverlay(state, ov) → void
BSU.ui.setSpeed(state, speed) → void             // user intent → session.setSpeed(state, speed, 'user')
BSU.ui.showTitle(state, on) → void
BSU.ui.hint(state, id, text, opts?: {action?: {label, fn}}) → void   // one-time: shows only if !state.progress.hints[id], then progress.markHint(state, id) (the flag lives in state.progress.hints — never on the progress module object)
BSU.ui.pointer(type: 'down'|'move'|'up'|'cancel', px: number, py: number, button: 0|1|2, mods: {ctrl: boolean, shift: boolean, meta: boolean, alt: boolean}) → void   // the input state machine entry (also used by headless.click); px/py are canvas CSS px (offsetX/Y on #world); button 0 left, 1 middle, 2 right; 'cancel' = pointercancel / pointer leaving the window (drops any drag/pan without placing)
BSU.ui.keydown(key: string /*KeyboardEvent.key*/, mods: {ctrl: boolean, shift: boolean, meta: boolean, alt: boolean, code?: string /*KeyboardEvent.code*/}) → boolean   // returns true if handled (also used by headless.key). The debug panel binding is matched as `mods.code === 'Backquote' || key === '`'`; every other binding is matched on `key` (+ ctrl/meta/shift per data.keys)
BSU.ui.wheel(px, py, dx, dy, ctrl) → void
BSU.ui.breakdown(state, stat) → void             // popover
BSU.ui.refreshPalette(state) → void              // on unlock:changed / tab change
BSU.ui.settings() → state.ui.settings; BSU.ui.saveSettings() → void   // localStorage 'bsu.settings' under try/catch
```

### 7.3 Input state machine (the only translator of pointer events)

States: `IDLE`, `PANNING`, `PLACING` (a footprint/paint/upgrade tool on the cursor), `DRAGGING` (a drag tool with the button held), `INSPECTING` (the inspect panel open; otherwise like IDLE). Inputs: `pointerdown/move/up`, `wheel`, `keydown`, Safari `gesturestart/change/end`, `touchstart/move/end` (Tier 2), `contextmenu` (prevented on the canvas).

| State | Event | Guard | Action → next |
|---|---|---|---|
| IDLE/INSPECTING | pointerdown left on canvas | — | record `down = {px, py, tile, t}` → **IDLE (armed)** |
| armed | pointermove | moved > 4 px | `render.panBy` per move → **PANNING** |
| armed | pointerup | moved ≤ 4 px | tile hit? `ui.inspect(kind by priority: gator/agent (radius 1 tile, nearest) → building → levee tile → tile)` → **INSPECTING**; miss → close inspect → IDLE |
| PANNING | pointerup | — | → previous (IDLE/INSPECTING) |
| any | pointerdown middle/right | — | pan-drag → PANNING; on release, if moved ≤ 4 px and right button: cancel tool / close inspect |
| IDLE/INSPECTING | palette item click, `Shift+1–9`, `X` | unlocked | `selectTool(id)` (bulldoze id `'bulldoze'`) → **PLACING** (footprint/paint/upgrade/bulldoze) or **PLACING** awaiting drag (drag rows) |
| PLACING | pointermove | — | `buildings.canPlace(id, tile, {rot, pilings: auto when Marsh, grade: auto when yellow})` → `render.ghost(...)` + `#ghost-label` |
| PLACING (footprint) | pointerup ≤ 4 px | canPlace.ok | `buildings.place` → squash/plunk; keep tool if Shift held, else → IDLE; `undo` window opens (5 s) |
| PLACING (footprint) | pointerup ≤ 4 px | !ok | `audio.play('invalid')`, label shakes; stay |
| PLACING (drag row) | pointerdown left | — | start run at tile → **DRAGGING**; Shift = straight line (axis chosen by the larger delta) |
| DRAGGING | pointermove | — | extend run (4-connected staircase, or straight with Shift); per-tile `canPlace` for color; running length/total in the label; levee/floodwall: ring preview via `canPlace(..., {tiles: run})` |
| DRAGGING | pointerup | — | `buildings.placeRun(id, run)`; tick sound per tile (60 ms stagger); → PLACING (tool kept) |
| PLACING (bulldoze) | pointerup on a building/drag tile | — | `buildings.remove` (confirm card for landmarks: refused) |
| PLACING/DRAGGING | `Esc` / right-click / `R` (rotate) / palette click | — | cancel → IDLE (or rotate in place) |
| any | wheel (no ctrl) | on canvas | `render.panBy(dx, dy)` (trackpad two-finger; mouse wheel: vertical pans y) |
| any | ctrl+wheel / pinch (`gesturechange` scale or touch) | — | `render.setZoom(step, {x, y})` |
| any | minimap pointerdown/move | — | `render.panTo(tile from minimap px)` |
| any | pointer over a gator/agent/building 300 ms | — | tooltip / name tag |

Every user pan/zoom/click during a set piece calls `render.captureCameraTouch(state)`.

### 7.4 Keyboard map and precedence

Precedence (first match wins): (1) an open decision toast captures `Y`/`N`/`Enter`/`Esc`; (2) a focused text field (`#title-seed`, rename input) takes every key; (3) an open modal card takes `Enter`/`Esc`; (4) the world/HUD map below. `preventDefault` on `Tab`, `Space`, arrows, `Ctrl/Cmd+S/P/Z` whenever the canvas or a palette item has focus.

`Space` pause/resume · `1` `2` `3` = 1×/2×/4× · `B` Budget · `N` Season · `T` Storm (only when a cone exists) · `L` Milestones/Almanac · `F` `W` `K` `P` `C` `E` overlays (toggle; same key again = off) · `-` `=` zoom out/in · `Tab` next palette tab (`Shift+Tab` previous) · `Shift+1…9` nth item in the open tab · `X` bulldoze · `R` rotate · `H` home (pan to Founders') · `.` follow a random student (again = release) · `Esc` cancel tool → close inspect → close panel → close card (one per press) · `Ctrl/Cmd+S` manual save (slot `manual.0`) · `Ctrl/Cmd+Z` undo · `Ctrl/Cmd+P` postcard · `M` mute · `Y`/`N` answer toast · `~` (Backquote) debug panel · `W A S D` and arrows pan (held; 12 px/frame at zoom 1). `Q` unbound. No key is bound twice; `data.keys` is the table the settings sheet prints.

### 7.5 Ghost preview, tabs, pips, undo

Ghost colors: green ok; yellow needs grading or pilings (the label shows the option that will be applied, e.g. "Grade the site +$15k/tile" or "Pilings +$280k"; there is no toggle: pilings are auto-applied on Marsh and grading for slope, D12); red blocked with the reason. Second line: `ridgeFull` text or `sink` text (§3.6). Tabs appear when `tabsIntroduced[tab]` (progress sets during the tutorial; skipTutorial = all) and the tab has ≥ 1 unlocked row; `newPips[tab]` set on `unlock:changed`, cleared when the tab opens. Undo: `Ctrl/Cmd+Z` within 5 s (wall-clock; `buildings.undo` stores the placement tick and ui checks `performance.now()`).

### 7.6 CSS conventions (`src/style.css`)

- Tokens on `:root`: `--purple:#461D7C; --purple-2:#5E2CA5; --purple-hi:#7F5BC5; --purple-shadow:#2B1246; --panel:#1A1230; --gold:#FDD023; --gold-2:#F5B700; --gold-hi:#FFE680; --gold-shadow:#B58500; --glow:#FFF1A8; --text:#F4EEE2; --danger:#E0443E; --good:#3FBF7F; --water:#4FA3D6; --panel-alpha:.92; --radius:6px; --topbar-h:44px; --ticker-h:24px; --palette-h:112px; --font-ui:system-ui,-apple-system,"Segoe UI",sans-serif; --font-title:Georgia,"Times New Roman",serif`.
- Panels: `background: rgba(26,18,48,var(--panel-alpha)); border: 1px solid var(--gold); color: var(--text)`. Buttons `.btn` gold on purple; `.btn.primary` purple text on gold; `.btn.danger`.
- `#app` is `position:fixed; inset:0; overflow:hidden; background:#0E1230`; `#world` fills it; `#hud` is absolutely positioned with `pointer-events:none` and each interactive child sets `pointer-events:auto`.
- Layout at ≥ 1024 px wide; below 1180 px the palette shows icons only (`.compact`). Notification colors by `data-kind`. `.hidden { display:none !important }`. No external fonts, images or `@import`.
- Transitions: overlays fade 150 ms (canvas side), notifications slide 200 ms, panel slide 200 ms, cash delta flash 600 ms, toast countdown bar linear.

### 7.7 `ui_panels.js`

Owns the Budget, Storm, Season, Milestones, Almanac and Settings panels, the debug panel, the breakdown popover, the damage report card, the Founders' Day recap card, the Board/failure/Wet Feet/Objective-8 cards. **One opener per card** (D44): ui_panels opens `damage` on `storm:report`, `newsflash` on `storm:named`, `board` on `board:offered`, `failure` on `econ:card` (its buttons call `progress.answerFailure(state, kind, optionId)`), `wetfeet` on `milestone:earned{id:'wetFeet'}`, `obj8` on `objective:progress{id:'8', capped:true}`, `recap` on `calendar:year` when `progress.recap()` is non-null, `hire` on the rivalry-streak newsflash or the offseason button; progress opens `charter` (stage 1) and session opens `versionMismatch`. Nobody else calls `ui.card` for those ids. Each panel has `build()` (once) and `refresh(state)` (on open and every 500 ms while open, plus on the events it lists). The Storm panel reads `buildings.gaps(H)`, `buildings.protection(H)`, `buildings.shelter`, `storm.boardQueue`, and calls `weather.prepAction`. The debug panel walks `BSU.params` (sliders write the leaf live) and its cheats call: `session.skipToDate`, `economy.post('misc', 1e6)`, `weather.spawnStorm(state, {cat, coneNowTick: T, landfallTick: T+600, compressed: true})`, `hydro.forceRain` at the cursor, `wildlife.forceMosquito/spawnGator`, `economy.bump`, `economy.addStudents(state, n, 'debug')` (Fill dorms: the visible agents follow at the next daily reconcile), `sports.playHome`, `weather.scheduleNearMiss(today+1)`, `buildings.gaps(H)` paint, `progress.fireAllToasts`, `session.setSpeed(20,'user')` (time-lapse; capped by maxTicksPerFrame), render debug flags.

---

## 8. Save / load schema v1

### 8.1 JSON shape

`BSU.session.save(slot)` returns `JSON.stringify(doc)` where `doc` is:

```js
{
  v: 1, app: 'bayou-state', savedAt: number /*Date.now(), 0 headless*/, label: string,
  seed, tick, playSeconds, setPiece, saveMeta,
  calendar, sky, weather, storms, plot, hydro /* every enumerable key minus SAVE_SKIP: riverStage, bayouStage, surge, barrierClosed, pondCap, heldStage, spillwayOffset, … */,
  tiles: { elev: b64, depth: b64, sat: b64, stand: b64, mosq: b64, subs: b64, crest: b64, integrity: b64, sandbag: b64, sandbagDay: b64, wear: b64, flags: b64, surface: b64, owner: b64, type: b64, walk: b64 },
  veg, buildings /* array with null holes */, runNames,
  gators, wildlife /* minus campusMask */, economy, ledger, sports, progress /* timers exactly as live: untilDay −1 = open-ended */, ticker,
  ui: { camera: {x, y, zoom, follow: -1}, overlay, speed, speedBefore, paletteTab, tabsSeen, newPips, tabsIntroduced, settings },
  rng: { sim: number }
}
```
`b64` = `BSU.b64.encode(array)` (the raw little-endian bytes of the typed array; Float32 arrays are written as-is, so the round trip is bit-exact). **The save rule is structural, not enumerated (D48):** `doc` = `BSU.deepClone` of every branch listed above, then every path in `BSU.SAVE_SKIP` is deleted (`agents`, `vehicles`, `hydro.networks/risk/active`, `wildlife.campusMask`, `ui.tool/panel/perfMode`, `ui.camera.tx/ty`); **every other enumerable key of every saved branch is written**, including lazily-initialized keys (§2: `hydro.heldStage/spillwayOffset`, `wildlife.sick/beadsDay/burrowLog`, `progress.forceFirefliesDay/drainedEver/failure.pendingKind`, `economy.attritionBonus/pendingDisaster/admittedSinceLock/cancelledSemester`, …) and keys this document does not know yet. Session never keeps a per-branch key list. Size ≈ 240–380 KB. `Infinity`/`NaN` are never written because they never exist in the live tree (§10.3): `session.save` does no translation; its pre-save scan reports any non-finite value once through `BSU.error('session','save:nonfinite:'+path)` and writes `0` for it so `save` still returns a string.

### 8.2 Load and regeneration

`BSU.session.load(slot)`: read `localStorage['bsu.save.' + slot]` (try/catch) or the in-memory slot map (always written alongside); `JSON.parse`; `migrate(doc)` (§8.3); `state = BSU.newState(doc.seed)`; copy every saved branch over the fresh tree (typed arrays decoded into the pre-allocated arrays; plain branches replaced wholesale, then missing keys filled from the defaults so a partial/old save still has every field, and **keys present in the doc but unknown to `newState` are kept**); `BSU.state = state`; `BSU.rng.sim.state = state.rng.sim` (the Stream object is never replaced, §3.3); call `reset(state, false)` on every module in manifest order (terrain rebuilds caches; hydro rebuilds networks/active/risk and the surge front from `surge.entry` when `surge` is non-null; buildings rebuilds coverage + ring + auras; wildlife rebuilds the campus mask and spawns nothing; weather draws nothing and leaves `calendar.running` alone; **agents regenerated** by `agents.regenerate(state)` inside `agents.reset`; render drops the chunk cache; ui refreshes the palette and closes panels; audio reapplies settings); emit `save:loaded`; return `state`. A load never touches the atlas. If the slot is missing or unparsable → return `null` and `ui.notify` (headless: return null silently).

`snapshot()` must be byte-identical before and after a save/load pair (smoke test): therefore `snapshot()` reads **only saved fields and pure functions of saved fields** — its `agents` field is `BSU.agents.count(state)` (the D15 formula over `economy.students`), never `state.agents.length`, which lags arrivals, attrition and the daily reconcile (§5.8) — and `session.save` must not mutate state or draw `rng.sim`.

### 8.3 Migration hook

`session.migrations = { 1: (doc) => doc }` — a map from schema version to a function upgrading `doc` from that version to the next; `migrate` applies them in order until `doc.v === BSU.SAVE_VERSION`. A `doc.v` greater than the current version, or a missing `app` field, is refused: the title screen offers **"start fresh with the same seed"** (`newGame({seed: doc.seed})`).

### 8.4 Autosave and slots

- Keys: `bsu.save.auto.0|1|2` (rotating; `saveMeta.slot`), `bsu.save.manual.0|1|2`, any other string for tests (`'smoke'` → `bsu.save.smoke`), `bsu.settings` (JSON of `ui.settings`), `bsu.last` (the slot name last written, for Continue).
- Autosave: on the 1st of each calendar month **after** the economy step (session step 10, `flags.newMonth`), and on `visibilitychange` → hidden (browser only). Never during a set piece (deferred to the end) and never in headless mode unless `BSU.headless.autosave = true`. Rotation: `auto.((n+1) % 3)`.
- `localStorage` failure (quota, private mode, `file://` in some Safari configs): the in-memory map still holds the save, `ui.hint('saveUnavailable', …)` shows once, `save()` still returns the JSON string.
- Continue on the title screen loads `bsu.last`; the Settings panel exposes the six slots with their `savedAt`/label.

---

## 9. Boot, main loop and headless mode (`session.js`)

### 9.1 Boot sequence

```
script executes top to bottom (contract → data → … → session; only definitions, plus BSU.headlessMode)
session.js (last IIFE) runs `boot()` synchronously at the end of its own definition:
  1. BSU.state = BSU.newState(0)                    // an empty root so init() calls have something to bind
  2. for each module in manifest order with init: try { m.init(BSU.state) } catch → BSU.error
       (ui.init builds the DOM; render.init creates canvases; sprites.init builds the 1× atlas; audio.init only registers listeners)
  3. read settings (bsu.settings) → state.ui.settings; audio.applySettings; BSU.rng.fx.state = (Date.now() ^ 0xF0F0F0F0) >>> 0 in a browser (0xF0F0F0F0 headless) — reseeded in place, never replaced
  4. if (!BSU.headlessMode): show the title screen over a title world: newGame({seed: random, title: true}) generates a map and sets speed 0, sky Night, tutorialStage 0; Continue enabled if bsu.last exists
     if (BSU.headlessMode): do nothing more (no game exists until the harness calls newGame/load)
  5. if (typeof requestAnimationFrame === 'function' && !BSU.headlessMode) requestAnimationFrame(loop)
```
`session.newGame({seed, skipTutorial = false, title = false})`, in exactly this order: `seed = (seed >>> 0) || random`; `state = BSU.newState(seed)`; **`BSU.state = state` immediately** (before generation, so `BSU.rng.derive('reroll', k)` mixes THIS seed and not the previous game's — D40); `BSU.rng.sim.state = state.rng.sim` (in place; never `rng.make`); `terrain.gen(state, seed)` (sets `BSU.rng.world.state = seed` itself); modules `reset(state, true)` in manifest order; then either the tutorial start (`progress.tutorialStage = 0`, speed 0, `calendar.running = false`, the Founders' ghost on the cursor after the charter card) or `skipTutorial` (§9.4); emits nothing special (`save:loaded` is not emitted for a new game). Returns `state`.

### 9.2 Charter → first frame (browser)

Click `#btn-charter` → `audio.unlock()` (creates the `AudioContext`, starts ambience at −12 dB unless muted) → `ui.showTitle(false)` → `newGame({seed: seedField || random})` → camera swoop (`render.panTo` from the Gulf edge to the plot over 4 s; skippable) → charter card (auto-dismiss 3 s) → `progress` puts the Founders' ghost on the cursor (`ui.selectTool('founders_hall')`, tool locked until placed). The sky clock and agents tick from the charter click (speed is 1× but `calendar.running` is false until Objective 2), so the world is alive while the calendar waits.

### 9.3 Main loop (fixed-step accumulator)

```js
let last = 0, acc = 0;
function loop(now) {
  const dtMs = Math.min(100, now - last || 16.67); last = now;
  const tps = state.setPiece ? 10 : state.ui.speed * 10;          // ticks per real second; 0 when paused; title: 0 unless title world (10)
  if (tps > 0 && !hitStopUntil) { acc += dtMs * tps / 1000; state.playSeconds += dtMs / 1000; }
  let n = 0;
  while (acc >= 1 && n < params.time.maxTicksPerFrame) { tick1(); acc -= 1; n++; }
  if (n === params.time.maxTicksPerFrame) acc = Math.min(acc, 1);  // never accumulate a backlog after a stall
  const alpha = tps > 0 ? Math.min(1, acc) : 0;
  render.frame(state, alpha, dtMs); ui.update(state, dtMs); audio.update(state, dtMs);
  requestAnimationFrame(loop);
}
```
`tick1()` is §5.1. Speed changes go through `session.setSpeed(state, speed, reason)`: writes `ui.speed`, remembers `speedBefore` for `'cone'|'warning'|'setpiece'` reasons, emits `speed:changed`; `restoreSpeed(reason)` puts `speedBefore` back. `startSetPiece(kind, {len, skippable})` → `state.setPiece`, `speedBefore`, `setpiece:start`, `weather.scriptSky` handed to the owner; `endSetPiece()` → `setpiece:end`, `weather.releaseSky`, `restoreSpeed('setpiece')`, deferred autosave. Hit-stop: `render.hitStop(ms)` sets `hitStopUntil = now + ms` (ticks pause, rendering continues).

### 9.4 `skipTutorial`

`newGame({skipTutorial: true})` after the world is generated: `buildings.place('founders_hall', plot.founders.tx, plot.founders.ty, {ignoreCash: true, instant: true})` (built = 1, free); `route = BSU.terrain.landRoute(state, BSU.idx(plot.founders.tx + 1, plot.founders.ty + 3), plot.landingShoulder)` (the G3 BFS over land tiles of any type, bare Marsh included — **the only function that lays this path; never `agents.routeSync`**, whose walk grid cannot cross bare Marsh) then `buildings.placeRun(state, 'path', route, {ignoreCash: true})`; `economy.addStudents(state, 120, 'founding')` then `agents.regenerate(state)` (44 agents at Founders'; no pirogues, no `agent:arrive`); `calendar.running = true`, speed 1; `progress.tutorialStage = 6`; Objectives 1–5 `done` without grants; every tab introduced; `economy.suspendCapPenalties = false`, `suppressCoverage = false`; no scripted beats (the 1:15 cell is not queued; the Apr 5 cell **is** — by progress's ordinary `calendar:date` 'Apr 4'/'Apr 5' handlers, which run in Year 1 regardless of the tutorial, so `progress.applySkipTutorial` itself queues nothing; Amélie and Célestine follow their rules with `playSeconds = tick/10` in headless mode).

### 9.5 `BSU.headless` (always defined, in browsers too)

```js
BSU.headless.tick(n) → void          // for (let k = 0; k < n; k++) session.tick1(); no rendering; set pieces included
BSU.headless.render() → void         // render.frame(state, 0, 16.67); ui.update(state, 16.67)  (on the stub canvas in Node)
BSU.headless.snapshot() → { year, month, day /*dom*/, tick, cash, students, prestige: round(prestige*100)/100, happiness: round(happiness*100)/100, ecology: round(ecology*100)/100, buildings: count of non-null, agents: BSU.agents.count(state) /*NOT state.agents.length, §8.2*/, gators: gators.length, floodedTiles: hydro.floodedTiles(), floodedBuildings: hydro.floodedBuildings().length, storm: storms.current ? {name, cat, phase} : null, speed: ui.speed }
BSU.headless.findSpot(id) → {x, y} | null
   // footprint rows: spiral outward from plot.founders (Chebyshev rings 0..40) over origins (tx, ty) testing buildings.canPlace(id, tx, ty, {rot: 0, ignoreCash: true}).ok, and, if none, {rot: 1}; drag rows and paints: the same spiral over single tiles; 'pilings': the first building without pilings that can take them; returns the first ok
BSU.headless.place(id, x, y) → {ok, reason}   // = buildings.place(state, id, x, y, {rot: 0}) (charges cash; a drag row places one tile; 'pilings' retrofits the building at (x, y))
BSU.headless.forceHurricane(cat) → Storm       // weather.spawnStorm(state, {cat: clamp(cat,1,5), coneNowTick: T, landfallTick: T + 600, compressed: true}) — cone now (tick-driven: watch at +300, bands at +500, landfall set piece at +600 for 900 ticks), season/schedule/hold ignored, Year-1 Célestine marked done
BSU.headless.click(px, py) → void              // const M = {ctrl:false, shift:false, meta:false, alt:false}; ui.pointer('down', px, py, 0, M); ui.pointer('up', px, py, 0, M) at the same point (a click), against the stub canvas size (1280×720 in domstub)
BSU.headless.key(name) → void                  // ui.keydown(name, {ctrl:false, shift:false, meta:false, alt:false, code: name.length === 1 ? undefined : name}) — so key('Backquote') reaches the debug binding and key('`') too
BSU.headless.fastForwardDays(n) → void         // tick(n * 100)
BSU.headless.state() → BSU.state
BSU.headless.autosave = false                  // opt-in for tests
```
In headless mode, `session` never calls `requestAnimationFrame`, never uses timers, never reads `performance.now()` for game logic (`undo` uses ticks), and `audio` has no context. `render.frame` on the stub must run every pass (the stub's 2D context is a no-op proxy) so the smoke test exercises the code paths.

### 9.6 `session` API summary

```js
BSU.session.newGame(opts) → state; save(slot) → string; load(slot) → state | null; continue_() → state | null
BSU.session.setSpeed(state, speed, reason); restoreSpeed(state, reason); startSetPiece(state, kind, opts); endSetPiece(state); skipSetPiece(state)
BSU.session.tick1() → void; BSU.session.skipToDate(state, 'Aug 5', yearOffset) → void   // debug: ticks forward (bounded by 2 years)
BSU.session.slots() → {slot, savedAt, label}[]; deleteSlot(slot)
```

---

## 10. Cross-cutting rules

### 10.1 Error policy

- `session.tick1` wraps **each** module's `tick` in `try { … } catch (e) { BSU.error('<module>', 'tick', e) }`; `render.frame` wraps each pass; `ui.update` wraps each section; `BSU.events.emit` wraps each listener. One module's exception never stops the loop, the frame or the other listeners.
- `BSU.error(module, where, err)` builds a signature `module|where|err.message` and `console.error`s the first occurrence (with stack), counts repeats silently (`BSU.errors: Map<signature, count>`), emits `error` with `first: true|false`. The debug panel's Perf HUD shows the count. In `selfTest` (`BSU.SELFTEST === true`) `BSU.error` throws instead, so tests fail loudly. Under `test/browser.mjs`, any `console.error` fails the run: an implementer must fix errors, not rely on the wrappers.
- Never `throw` across a module boundary in normal play; action functions return `{ok:false, reason}`.

### 10.2 Determinism

All simulation randomness comes from `BSU.rng.sim` (a single stream, advanced in the fixed tick order). Presentation randomness (particles, moss phase, window flicker, ambience) uses `BSU.rng.fx`. Map generation uses `BSU.rng.world`, reseeded from `seed` (and `rng.derive('reroll', n)` for re-rolls) so the same seed gives the same map. Agents are cosmetic but their **sampling** feeds happiness; therefore agent regeneration on load is deterministic from `(seed, tick)` and agent decisions use `rng.sim` too (they are part of the tick). Two headless runs with the same seed and the same `place` calls at the same ticks produce identical snapshots. Wall-clock enters the sim only through `playSeconds` (browser) and the undo window.

### 10.3 Units and conventions

Feet (elev, depth, crest, surge, stage), dollars (integers; format with `BSU.formatMoney`), ticks (durations; 100 per day), calendar days (schedules), tiles (radii, Chebyshev unless stated), tile-ft (water volume), tiles/s at 1× (speeds; convert with `/10` per tick). Percentages in the GDD are fractions in code (`0.2`, not `20`). Absolute days start at 0 = Jan 1 Y1. A "month" is 10 days. Never `setTimeout`/`setInterval` for game logic; tick-based counters only. DOM text uses the GDD's wording. **No field of `BSU.state` may ever be `NaN` or `±Infinity`** — `test/smoke.mjs` scans the LIVE tree with `Number.isFinite` (depth ≤ 12, typed arrays included) after 3 months, after a year and after the hurricane, with no exemptions; open-ended durations are `-1` (timers, `closedUntil`, `*Day` fields), unknown numbers are `-1` or `0`, never `Infinity`. Function arguments that are not stored may be large finite numbers (e.g. `render.flashTiles(tiles, 1e9)` for "until cleared"), never `Infinity` either — every module rejects non-finite arguments with `BSU.error`.

### 10.4 Performance budget per module (1280×800, zoom 1, 2019 MacBook Air, per sim tick unless stated)

| Module | Budget | Notes |
|---|---|---|
| hydro | ≤ 3 ms per hydro step (≤ 1.2 ms/tick averaged); full-map rain worst case ≤ 8 ms | active set, typed arrays, no allocation in the step |
| agents | ≤ 1.5 ms (300 agents, ≤ 8 A*) | route cache; off-screen 1/4 rate |
| wildlife | ≤ 0.5 ms (daily mosquito ≤ 4 ms once per day) | |
| buildings | ≤ 0.3 ms; coverage recompute ≤ 2 ms; ring BFS ≤ 3 ms (cached) | |
| economy/sports/progress/weather/terrain | ≤ 0.3 ms each; daily/monthly steps ≤ 5 ms | |
| render | ≤ 12 ms per frame typical, ≤ 25 ms worst (§15.3 perf list) | chunk re-bake ≤ 6 ms each, ≤ 2 per frame |
| ui.update | ≤ 1 ms per frame | diff before writing DOM |
| sprites.init | ≤ 400 ms at load (1× atlas) | 2× atlas lazily |
| terrain.gen | ≤ 300 ms incl. re-rolls | |
| session.save | ≤ 40 ms; load ≤ 150 ms (+ chunk re-bake amortized) | |

### 10.5 Coding conventions

`'use strict'` IIFE per file; no globals other than `window.BSU`; no DOM/timers/`AudioContext`/`requestAnimationFrame` at definition time (only inside `init`/action functions); no `import`/`export`/`fetch`/Workers/`OffscreenCanvas`/fonts/images/CDNs; no string `</script` anywhere in source (write `'<\/script'` if ever needed); ES2020 syntax that Safari 14 and Chrome 90 parse (optional chaining and `??` are fine; no class fields with `#`, no top-level await, no regex lookbehind); no `Math.random` (except `rng.fx` seeding fallback); no `console.log` in hot paths (`console.warn/error` only via `BSU.error`); typed arrays for anything per-tile; no per-tick allocation in hydro/agents/render inner loops; every public function documented with a JSDoc line; every module ≤ ~2,000 lines; file header comment names the module, its owner branch and the GDD sections it implements. **A module never mirrors state on its own object** (D46): `BSU.progress.hints`, `BSU.wildlife.relocations`, `BSU.hydro.barrierClosed` and the like must not exist — a module property cannot follow the `BSU.state` replacement on `newGame`/`load`; consumers read `state.<branch>.<field>` (`state.progress.hints`, `state.wildlife.relocations/biblicalDays/leGrand/beadsDay/sick`, `state.hydro.barrierClosed`, `state.progress.forceFirefliesDay`, `state.sports.game`) or call a query function that takes `state`. Modules may cache `BSU.rng.sim` but never create their own stream except via `BSU.rng.derive` (§3.3). Every sim module routes its emits through an injectable `M._deps.emit` (default `BSU.events.emit`) so its `selfTest` can record instead of broadcasting (§10.6).

### 10.6 `selfTest()` expectations

Each module returns `{ok, notes}` in ≤ 200 ms, pure (no canvas drawing, no DOM writes, no state mutation of the live game: build a private `BSU.newState(1234)` when a state is needed). **Assertions use `BSU.assert`; the harness owns the flag:** `test/modules.mjs` wraps every call as `BSU.SELFTEST = true; try { r = mod.selfTest(); } finally { BSU.SELFTEST = false; }` and also fails the module if `BSU.errors.size` grew during the call — so inside a selfTest `BSU.assert`, `BSU.error` and any listener exception throw; a selfTest that builds a private game must expect any `BSU.error` inside it to abort the test (a module must not toggle the flag itself; `contract.selfTest`'s own toggle is harmless). **A selfTest never emits on the live bus:** `BSU.events` is one global bus and `test/modules.mjs` runs after a live game exists, so a real `calendar:date` or `levee:overtop` would reach progress/render_fx/buildings; every sim module calls `M._deps.emit(name, payload)` (default `BSU.events.emit`) for all its emits and its selfTest replaces `M._deps.emit` with a recorder for the duration (restored in `finally`), asserting on the recorded list. **Exemption for `session.selfTest`:** it may take ≤ 3 s and it swaps the live game (backup save → private `newGame` → checks → `load` of the backup in a `finally`); `test/modules.mjs` runs it LAST (it sorts `session` to the end; `BSU.session` must also stay the last selfTest-bearing key assigned). Minimum content: contract — enums frozen, event names unique, helpers round-trip (`worldToScreen`/`screenToWorld` on 50 random tiles), `b64` round-trip; data — schema validation (§4.2); terrain — `gen` on seeds 1–3 passes G1–G8 and the distribution; hydro — T5 conservation on a private state after 200 steps of a 2-inch rain, T6 levee shedding; weather — the calendar math for 3 years, the sky cycle sums to 300, `dateToDay` round trip; wildlife — mosquito decay/diffusion bounds, gator population formula; buildings — `canPlace` reasons on a private map (founders' footprint, cove, marsh with/without pilings, access), the ring fill on a synthetic 10×10 ring; economy — applicants/capacity/prestige/happiness formulas against the §5.4 worked numbers (700 applicants, 345 capacity); agents — A* on a synthetic grid, walk-class table; sports — `winProb(78 vs 78, night) ≈ 0.78`, the score model never contradicts the decided winner; sprites — `get` returns non-null for every catalog id × 6 variants (headless: stub canvases) and `agentLook` packing; render — sort key monotonicity, camera clamp, `screenToTile` inverse on 20 tiles; ui — the key map has no duplicates, the state machine transitions table on synthetic events; audio — no throw without `AudioContext`; progress — objective graph has no orphan triggers, every timer id in §5.6 is known, every catalog unlock resolves; session — save→load→snapshot identity on a private game ticked 300 ticks, a `-1` (open-ended) timer round-tripping unchanged, determinism of two `newGame({seed:77, skipTutorial:true})` runs, `forceHurricane` reaching the set piece, migrate/slots (under the exemption above).

---

## 11. Feature tiers

Implementers finish **all Tier 1 items of their module before any Tier 2 item**. Tier 2 items are listed in the GDD §15.5 cut order (first cut first).

### 11.1 Tier 1 (first integration; the §15.5 never-cut list + the 20-minute arc + the harness)

- contract/data: everything in §3–§4.
- terrain: generation with G1–G8, the template fallback, `classify`/`rewalk`, subsidence, desire-line wear decay, debris, sandbag expiry, Highway 1 stub, the Mounds (flag + landmark), veg entities.
- hydro: the CA with the one head function, rain events (all kinds), canals/culverts/floodgates/pumps/ponds, marsh draining (reversion is Tier 2 #10), surge front and stages, flood thresholds and building flood state, Spring High Water stages, the F/W overlay data, T1–T8.
- weather: calendar + sky clock, rain scheduler and cells, heat, wind, fog flag, the full storm lifecycle and landfall timeline with all four toasts, the near-miss pass, Célestine hold rule, Years-2+ scheduling, festival dates, `spawnStorm` (debug/headless), Play Through It flag.
- wildlife: gators (dens, states, A*, attractors, campus mask, incidents, relocation, Le Grand), mosquito field and index, nutria mechanic + burrow decals (sprites Tier 2 #3), ecology score, fireflies count, egret/spoonbill flags (sprites Tier 2 #3).
- buildings: all 43 rows placeable per rules (Stadium III row exists; its sprite is Tier 2 #2), construction timeline, coverage/blackout/brownout, generator, boil-water trigger inputs, damage/repair/ruin/tarps, pilings + retrofit, regrade, tiers (Bayou Field, Stadium I–II), policies, protection/gaps/ring, sandbags/board-up/evacuate/pre-drain, wind pulses, shelter, auto-names + levee runs, undo, demolish.
- economy: every income/cost line, rolling enrollment and locks, prestige target, happiness (abstract + sampled + the timer table), runway, bankruptcy/underwater/probation cards, endowment + second campus (functional; UI minimal), Board card **Insurance** (the others Tier 2 #7), tutorial grants, disaster grant.
- agents: agents with schedule buckets, A* + route cache, reactions (flee, wade, slap, sit, cheer, caps), sampling, class attendance, desire lines, pirogue/bus arrivals, shelter/evacuation, fogger (as a radius effect; the visible truck Tier 2 #4), Cajun Navy sprites.
- sports: team, venue rules, schedule, rating (all terms), named coach + stars (hire/fire Tier 2 #6), three starters, win prob, score model, home game set piece with halftime toast, montage/auto-sim, attendance/revenue/tailgate, rivalry, Resilience Bowl, Play Through It, postponement. Sugar Cane Bowl, ticket tiers, recruiting card, Homecoming budget, permits cards: Tier 2 #6.
- sprites: the one building painter with the 6 variants at 1× (2× atlas Tier 2 #9), terrain tiles, surfaces, water, trees (3 stages, moss), agents (all anims + props), gators, Roux, officer, pirogue, bus, float, band, tents/smoker/cornhole, bonfire, tarp/plywood/burrow/ruin decals, Ms. Thibodeaux, the lights sprites, the Mounds, gates. Tier 2 #3: nutria, spoonbill, pelican, armadillo sprites (egret stays Tier 1: it is the pond tell).
- render: full pipeline, chunk cache, water, depth sort, weather FX (rain, cell, lightning, wind debris; fog/heat shimmer/god rays are Tier 2 #8 but the **eye phase** sky lightening is cheap and stays Tier 1 for the timeline), tint + lights + vignette, overlays (all 6), ghost + ring preview, minimap with cone, particles, shake, postcard, perf guardrail, 0.5× budget rules.
- ui: the whole DOM skeleton, HUD with breakdown popovers, alert strip, objective card + speech bubble + Milestones handoff, notifications, ticker + log, decision toasts, inspect panel (all kinds), palette with tabs/pips/tooltips/locked items, ghost label, input state machine (mouse + trackpad + keyboard; touch Tier 2 #1), keyboard map, Budget/Storm/Season/Milestones/Almanac/Settings panels, title screen (seed, Continue), damage report, Founders' Day recap, Wet Feet / Objective-8 / Board / failure cards, debug panel with every cheat, postcard download, colorblind palette (Tier 2 #1).
- audio: context on gesture, mute persistence, ambience bed (frogs, cicadas, crickets, lap), rain/wind/thunder/drone, UI sounds, brass sting, crowd, whistle, bells, sad trombone. Zydeco motif: Tier 2 #5.
- progress: tutorial script (§10.1 exactly), the objective chain 1–22 with interrupt/background scheduling, milestones 1–24 + L1–L2, timers, Student Voice cards, Insurance Board card, failure cards + receiver autopilot, recap, unlock rules, first-warning speed drops, scripted cells, Amélie, Célestine gating, first gator, scripted night game.
- session: boot, loop, speeds, set pieces, save/load/autosave/migration, headless API (all functions), `skipTutorial`.

### 11.2 Tier 2 (in cut order; each item names the owning module)

1. Touch input (ui); colorblind overlay palette (render_fx + ui settings).
2. Stadium III sprite, jumbotron, fireworks ring (sprites_buildings, render_fx); the row and tier logic stay Tier 1.
3. Nutria, spoonbill, pelican, armadillo sprites and spawners (sprites_entities, wildlife).
4. Fogger truck vehicle and ribbon (agents, sprites_entities); officer wrangle animation (wildlife, sprites_entities) — relocation with a puff is Tier 1.
5. Zydeco motif and Mardi Gras variant (audio).
6. Sugar Cane Bowl, ticket tiers, coach hire/fire, recruiting card, Homecoming budget card, tailgate-permit toggle (sports, ui_panels).
7. Board of Regents cards other than Insurance (progress, economy, ui_panels).
8. Heat shimmer, fog blobs, god rays (render_fx); the eye phase FX beyond the sky lightening.
9. The 2× sprite atlas (sprites): draw the 1× atlas scaled until then.
10. Drained-marsh reversion (hydro).

Also Tier 2 (not on the GDD cut list but not needed for the first integration): the Second Campus charter UI and BSU West hall, the Bonnet Roux Spillway, the Marsh Restoration paint UI (row 42 placement may initially accept a fixed 10-tile paint around the office), Le Grand's inspect quotes, the Almanac sparkline canvas, the title-screen campus thumbnail, `#title-campus`.

---

## 12. Worked walkthroughs through the interfaces

### 12.1 The player places a dorm

1. `ui`: palette item `.item[data-id="dorm"]` click → `ui.selectTool(state, 'dorm')` → state machine **PLACING**; `ui:tool` emitted.
2. Each `pointermove`: `render.screenToTile(px, py)` → `{tx, ty}`; `buildings.canPlace(state, 'dorm', tx, ty, {rot})` → `PlaceResult`; `render.ghost({tiles, color, radius: 0, label})`; `#ghost-label` shows `formatMoney(cost)` + the second line (`ridgeFull`/`sink`).
3. `pointerup` (≤ 4 px): `buildings.place(state, 'dorm', tx, ty, {rot, pilings: r.needsPilings, grade: r.needsGrading})`:
   - re-validates (`canPlace`), computes `cost`; `economy.charge(state, cost, 'construction', {i})` → posts expense, emits `econ:expense` and `econ:stat{cash}`;
   - grading: `terrain.setElev` on each footprint tile to the mean (emits `tile:changed` ×6); pushes `Building{type:'dorm', built:0, buildDays: 1+floor(6/6)=2, name: next from data.names.halls, data.seed}` into `state.buildings` (index = id); writes `tiles.owner[i] = id` for the 6 tiles; `terrain.rewalk(i)` each (blocked); `terrain.touch(i,'decor')`; marks coverage/auras/ring dirty; emits `building:placed{id,…}`; records the undo entry.
4. Listeners: `render_fx` → dust + squash on `building:placed`; `audio` → 'place' plunk; `progress` → objective progress (Objective 3/8), `unlock:changed` if the count crosses a threshold (via economy students, not here); `wildlife` → campus mask dirty; `agents` → routes invalidated (`agents.invalidateRoutes` in its `tile:changed` listener).
5. Next ticks: `buildings.tick` daily `built += 0.5`; at 1 → `building:complete{id}` → `render_fx` pop, `audio` coin, `buildings.recomputeCoverage` (dorm needs ⚡💧 → `powered/watered` from the nearest providers; while `suppressCoverage` the penalty is off), `economy` reads `buildings.stats()` the next day (beds +300 → capacity). Agents whose `home === -1` get this dorm; at Night they walk into it (`agent` anim), windows light (sprite `NIGHT` bit).

### 12.2 One sim tick during rain (T % 10 === 2, a shower day, 1×)

1. `session.tick1`: `frozen = false`; T.
2. `weather.tick`: sky `cycleTick++` (phase unchanged → no event); `dayTick++` (no new day); `event = {kind:'shower', total: 0.04, steps: 40, stepsLeft: 17}`; `dtDay = 1/40` (T%10 = 2 is a hydro tick); `rainRate = 0.25`; returns `{newDay:false,…}`.
3. `terrain.tick`: nothing (no new day).
4. `hydro.tick`: intake `r = 0.04/40` on every land tile (event map-wide): `absorbed = r × absorbFrac(type/surface/preserve) × (1 − sat)`, `depth += r − absorbed`, `sat += absorbed/0.5`, the intake `r` and footprint come from one `weather.consumeRainStep(state)` call per hydro step (weather decrements `stepsLeft`, D14); active set = all tiles (raining); two Jacobi passes with the head function (canals ×8, closed gates 0, levee crests in H); pumps: for each powered pump's network remove `15/40` tile-ft spread over its canal tiles; ponds: sink step; boundary tiles reset to stage; no surge. Emits nothing unless a levee tile is overtopped by a puddle (it is not: the crest is in H on both sides).
5. `buildings.tick`: nothing daily; `dirty` flags unchanged.
6. `wildlife.tick`: gators advance (a `SUN` gator in rain stays; a `WANDER` moves 0.07 tiles); officers idle.
7. `agents.tick`: 300 agents: on-screen ones move `0.4 × classMult` tiles toward their route node; those on a tile with `depth ≥ 0.3` switch to `WADE` (speed 0.12/tick, splash particles via `render.particles.emit('splash', …)` — allowed: it is a presentation call, no-op headless), `wet += 0.01`; `prop = 'umbrella'` while `weather.raining()`; each samples `buildings.auras()` at its tile, `wildlife.mosqAt`, heat (0 in rain) into `sample`.
8. `economy.tick`: `happiness += (raw − happiness)/100` toward yesterday's raw.
9. `sports.tick`, `progress.tick`: no dated work; progress checks Objective 4's live progress (`hydro.networks()` reaching the bayou?) only on `tile:changed`, so nothing.
10. `session`: no set piece, no new month; `state.rng.sim = rng.sim.state`; `tick++`. The frame later draws 300 rain lines in one stroke, puddles (depth ≥ 0.05) as water diamonds, umbrellas.

### 12.3 The landfall set piece, cone to damage report (Célestine, Year 1, 1×)

1. **Sep 2** (`weather.tick`, new day): the hold rule passes (`playSeconds ≥ 540`, `progress.offered('11')`) → `storms.current = Storm{name:'Célestine', cat:2, forecastCat:2, phase:NAMED, coneDay: day, landfallDay: day+6, point (south edge below the cove), coneWidth 24}`; emits `storm:named`. Listeners: `ui` → alert strip + `#btn-storm` dot + newsflash card; `progress` → `session.setSpeed(state, 1, 'cone')` (Year 1) + Objective 12 offered next tick; `render_fx` → cone on world/minimap; `audio` → sting; `buildings.shelter` counted by the Storm panel; `buildings.gaps(5)` listed.
2. **Sep 5** `storm:watch` (sky greenish via the tint pass; gators `RETREAT` to deep water: `wildlife` listens); **Sep 7** `storm:bands`: `weather.event = {kind:'band', total: .33, steps: 40}`; `agents.shelter(state, buildings.shelterAssignments(state))` (weather hands over the `{buildingId: capacity}` map; agents assigns each agent to the nearest shelter with room, §5.8); `sports.offerPlayThrough(state)` only if a home game is scheduled today and `forecastCat ≤ 1` (not here: Cat 2); board-up crews have been boarding 6/day since purchase (`buildings.tick`).
3. **Sep 8, tick of the day boundary**: `weather.tick` sees `day === landfallDay` → `session.startSetPiece(state, 'landfall', {len: 900, skippable: progress.setPieceSeen('landfall')})` → `state.setPiece = {kind:'landfall', tick:0, …}`, `speedBefore = 1`, `calendar.frozen = true`, `setpiece:start`; `weather` emits `storm:phase{OUTER, t:0}`, `weather.event = hurricane (8 in over 360 steps)`, `dtDay = 1/360` each tick, `scriptSky(STORM)`; `render_fx` rain → 900 lines over 150 ticks, lightning every 80 ticks; `audio` wind bed.
4. **Tick 150** `storm:phase{WALL}`: `weather` decides `storm.rolls` and `jammedGates` with `rng.sim`; `hydro.surgeControl('begin', {stage: 0, target: 5, entry: storm.entry, dir:'S'})` → hydro BFS-distances every tile from the entry segment, sets `surge = {front, reached:0}`; each subsequent tick `stage += 5/200`, front activates 1 tile per 5 ticks (`surge:front{i}` → foam/debris), boundary tiles at `stage`; `render` auto-pans to the entry (if `!cameraTouched`).
5. **Tick 250** `storm:pulse{n:1, share:1/3}` → `buildings.applyWindPulse`: per building `dmg = baseDmg[2]=.09 × (6−WR)/5 × boarded × oak × share` → `hp −=`, `building:damaged` (tarps at the report). **Tick 300** toasts: `storm:toast{id:'shelter'}` (Year 1 always; `sandbag` too if a boundary levee qualifies, shelter then at 330) → `ui.decision(...)` (80 ticks, `Y`/`N`); the answer arrives ONLY as `decision:closed{id, answer}` → weather's listener → `weather.answerToast` (idempotent: `setPiece.choices[id]` already set → ignored) → `buildings` overflow shelter / `progress.addTimer('hurricaneParty', 2, 3)`.
6. **Tick 350** `storm:phase{LANDFALL}`, `surge:peak{stage:5}`: the fill of reached tiles at H = 5 ft is what the live CA now reproduces: cove (1.6–2.5 ft) with no levee → water pours through the mouth and the bayou; a ring at crest 8+ holds (no `levee:overtop`); the Dry shoulder (3.5–5) floods 0.5–1.5 ft; any Substation there hits 0.3 ft → `hydro` marks it, `buildings.recomputeCoverage` → `power:blackout{provider, affected, cause:'flood'}` → pumps stop (`hydro` reads `buildings.effective(pump) === 0`), lights off in that coverage (render), `progress` ticker line 18. **Tick 380** pulse 2: the Water Tower roll plays (`rolls.towerTopple`, Cat 4+ only — false here). **Tick 400** fuel toast if a generator is at ≤ 1 fuel day.
7. **Tick 500** `storm:phase{BACK}`: `hydro.surgeControl('stage', …)` recedes 1 tile per 4 ticks, stage ramps down; pulses 3–4 at half strength (550, 680); azaleas shredded (`buildings` flags), leaves (particles).
8. **Tick 750** `storm:phase{CLEARING}`: `hydro.surgeControl('end')` (boundary stages back to 0; `surge:end`); `weather` builds `storm.damageReport = buildings.damageReport(state, storm)` (bill = Σ damage% × cost × 0.6, tarps = damaged count, held/overtopped/breached levee tiles from hydro's per-storm log, flooded buildings, toast outcomes) → `storm:report` → `ui.card(damage report)` with Repair All (`buildings.repairAll` → `economy.charge`), Board card Insurance pays 50% if held; god rays and Golden tint. `progress` offers Objective 14 next tick, marks 13 complete (+2 prestige via `economy.bump`), `setPiecesSeen.landfall = true`, `stormChaser` check at Objective 14 completion. **`weather`** (not progress) pushes the `storms.log` entry on `setpiece:end{kind:'landfall'}` (§1 ownership: `storms` is weather's).
9. **Tick 900**: `session.endSetPiece` → `setpiece:end`, `releaseSky`, `restoreSpeed('setpiece')` (back to 1×), calendar resumes with `storms.current.phase = RECOVERY` (`storm:passed` fires when the report card closes; headless: at tick 900). Recovery days: T+1 band (`weather.event`), `boilWater` timer if the tower was flooded/unpowered at any tick 150–900 (`buildings` tracked it), debris flags (`terrain`), gator wave (`wildlife.spawnGator` ×3–8 in flooded campus tiles), mosquito bloom from T+3 (`wildlife`), disaster grant on T+20 (`economy.post('disaster', …)`), the Sep 8 home game postponed by `sports` (`postpone` → makeup within 5 days = Resilience Bowl).

Headless: `BSU.headless.forceHurricane(3)` → `weather.spawnStorm({cat:3, coneNowTick:T, landfallTick:T+600})` → the same chain compressed (watch at +300, bands at +500, set piece at +600 for 900 ticks, eye phase at ticks 450–500 because Cat 3), all under `tick(4000)`.

### 12.4 `newGame` → first frame (browser, tutorial)

`#btn-charter` click → `audio.unlock()` → `ui.showTitle(false)` → `session.newGame({seed})`: `newState(seed)` → `BSU.state = state` → `rng.sim.state = state.rng.sim` → `terrain.gen` (hydro.seedInitial inside — hydro's tables self-heal onto the new root; veg; plot; Highway stub `surface = 2` on 7 tiles; Mounds) → `reset(state, true)` on every module (terrain caches; hydro networks (none) + active set; weather draws Year-1 rain days and sets `calendar.running=false`, speed 1; wildlife computes `wetlandOriginal`, spawns gators at dens (`gator:spawn` ×6+); buildings empty; economy cash 4M, students 0, happiness 60; agents none (0 students → target 40, but agents spawn only when `students > 0` — D15); sports none; render drops chunks, camera to the Gulf edge; ui palette hidden (tabsIntroduced empty), objective card hidden; progress `tutorialStage = 1` → charter swoop `render.panTo(plot)` over 4 s then the charter card (`ui.card(state, 'charter')`, autoMs 3000) → stage 2: `ui.selectTool('founders_hall')` with the tool locked and cove tiles flashing red on hover). First `loop` frame: `tps = 10` (speed 1, no set piece) but `calendar.running=false` so days do not advance; `render.frame` bakes ≤ 2 chunks per frame (the visible 12–20 chunks fill in over ~8 frames; a first-frame full bake of the visible set is allowed once, budget 150 ms); `ui.update` fades the HUD stats in after Objective 1 (progress sets `hints`). Objective 2's drag end calls `weather.setRunning(state, true)` → `calendar:day` events begin; progress calls `agents.spawnArrival(state, 120, 'founding')`, which itself creates `min(300, 40 + floor((0 + 120)/25)) = 44` agents inside three pirogues (§5.8 population rule — `students` is still 0, so nothing else would create them); when the first one reaches Founders' → `agent:arrive{kind:'founding'}` → progress calls `economy.addStudents(state, 120, 'founding')` → `count(state)` becomes 44 → the Students odometer rolls.

### 12.5 Save → reload

`Ctrl/Cmd+S` → `ui` → `session.save('manual.0')`: pre-scan for non-finite numbers (none exist, §10.3); build `doc` (deepClone of every saved branch; typed arrays via `b64.encode`; `SAVE_SKIP` paths removed; no translation of any value); `JSON.stringify`; `localStorage.setItem('bsu.save.manual.0', json)` in try/catch + the in-memory map + `bsu.last`; `save:written{slot, bytes}` → `ui.notify('Saved')`. Later, title **Continue** → `session.load('manual.0')`: parse → `migrate` (v1 → no-op) → `newState(doc.seed)` → copy branches (typed arrays decoded in place; timers copied as-is, `untilDay -1` stays `-1`; `buildings` nulls kept; unknown keys kept) → `BSU.state = state` → `rng.sim.state = doc.rng.sim` → `reset(state, false)` on every module in order: terrain (reachability, lamps, parade route from `surface`), hydro (`networks` from `FLAG.CANAL`, `active` from `depth`, `risk` null, the surge front from `surge.entry` if non-null), weather (nothing: all saved; no rain draw, `calendar.running` untouched), wildlife (campus mask; gators' `route = []`, replanned on their next tick), buildings (coverage, auras, ring cache, undo cleared), economy (nothing), agents (**`regenerate`**: `rng.derive('agents', tick)` → the same count/homes/names as the pre-save run would produce for that tick; positions at their dorms), sports (nothing), render (chunk cache dropped, camera from `ui.camera`), ui (palette refresh, panels closed, inspect closed, tool null), audio (settings), progress (nothing) → `save:loaded` → `ui.showTitle(false)`. If `doc.setPiece` is non-null the set piece resumes at its `tick` (weather/sports read `state.setPiece` on their next tick; hydro's surge state is saved in `hydro.surge`). `headless.snapshot()` before and after is byte-identical because every field it reads is saved or a pure function of saved fields (`agents` is `agents.count(state)`; `state.agents.length` is never read by it).

---

## 13. Decisions (where the GDD was silent or self-contradictory)

- **D1 Files.** Sprites split into `sprites.js` / `sprites_buildings.js` / `sprites_entities.js`; render into `render.js` / `render_fx.js`; ui into `ui.js` / `ui_panels.js`; 20 files total (§1). Split files extend the object their first file created.
- **D2 Module lifecycle.** Every module has `init(state)` (once per page load) and `reset(state)` (every newGame/load), plus `tick(state)` for sim modules only; session drives the tick order of §5.1 by direct calls, not by listeners, so cross-module ordering (e.g. May 5 graduation → attrition → round) is explicit.
- **D3 `BSU.headlessMode`.** The task's formula is used verbatim, OR-ed with the GDD's `typeof window.__headless === 'object'`, in a try/catch; `window.BSU_FORCE_HEADLESS` forces it. Both are true under `test/domstub.mjs`.
- **D4 Calendar `running`.** Ticks advance from the charter click but calendar days start with the tutorial's first path (`weather.setRunning`); `calendar.frozen` is derived per tick from `running` and `setPiece`. skipTutorial runs from tick 0.
- **D5 Sky in ticks.** The 30-s sky cycle is 300 ticks (`BSU.SKY_TICKS = [25,130,20,25,100]`), so it scales with speed exactly as the GDD's table says and set pieces script it via `weather.scriptSky`.
- **D6 Flood-state writer.** `hydro` writes `Building.flooded/floodedSince` (it owns depth and the daily threshold check) and emits `building:flooded/dried`; `buildings` applies every consequence. Integrity has three writers (buildings/hydro/wildlife) with the rule in §5.3; every write is followed by `buildings.onIntegrityChanged`.
- **D7 Speed representation.** `ui.speed` is the setting (0/1/2/4); ticks per real second = `setPiece ? 10 : speed × 10`; accumulator capped at 8 ticks per frame with backlog discard (the GDD's "max ticks per frame" was unspecified).
- **D8 `snapshot()` rounding.** prestige/happiness/ecology are rounded to 2 decimals in the snapshot so the JSON comparison is stable; cash and students are exact.
- **D9 Marsh placement.** Every footprint row may sit on Marsh with pilings (auto-applied), except rows whose placeRule forbids it (parking lots allowed; wastewater allowed with the −5 ecology). `coastal_institute` and `rookery` are `alwaysPilings`. Pilings/grading are auto-applied by the ghost (no separate toggle; the label states which) — D12.
- **D10 Demolishable.** `founders_hall`, `bell_tower`, `tiger_habitat`, `rookery`, `library`, `res_tower`, `stadium` (any tier) and the capstones (`surge_barrier`, `marsh_restoration`) cannot be demolished ("landmarks and Founders' Hall"); everything else can.
- **D11 Building ids are strings**, buildings are stored in an array with null holes (index = id, never spliced), and `tiles.owner` is the GDD's `buildingAt`.
- **D12 Ghost options.** No pilings/grading toggle in the UI: the cheaper legal option is chosen automatically and printed; a Marsh footprint always gets pilings; a sloped footprint always gets grading.
- **D13 Set-piece ownership.** `session` owns `state.setPiece` and its start/end; the timeline logic lives with the owning module (weather: landfall/nearMiss; sports: game/montage; progress: parade/graduation) and reads `setPiece.tick`.
- **D14 Rain steps.** `weather` owns `event.stepsLeft`; `hydro` calls `weather.consumeRainStep(state)` once per hydro step so the counter has one writer and the intake and the schedule cannot drift.
- **D15 Agents at 0 students.** The visible-agent formula is applied only when `students > 0`; before the founding cohort there are no student agents (the tutorial's world is alive through gators, birds and weather).
- **D16 Undo window.** 5 s wall-clock in the browser, 50 ticks in headless mode; one entry (the last placement or run); refund in full.
- **D17 Sprite variants** are integer bitmasks (`BSU.SPR`) with the tier in bits 5–6 and `BOARDED` at 128; non-building families define their own integer variant packing (§6.1). Sprite anchors are fixed per family (§6.1).
- **D18 Depth-sort key** `100·(ax+ay) + 2·(elev+4) + 0.25·rank` with buildings anchored at their south corner tile.
- **D19 Chunk geometry** 512×416 px at 1× with the origin formula in §6.3; re-bake budget 2 per frame; LRU eviction above 64 MB.
- **D20 Save slot naming** `bsu.save.<slot>` with slots `auto.0–2`, `manual.0–2` and free-form strings for tests; `bsu.last` holds the Continue slot; autosave never runs in headless mode unless `BSU.headless.autosave = true`.
- **D21 `headless.findSpot`** spirals outward from `plot.founders` (Chebyshev rings 0–40) testing `canPlace` with `ignoreCash`, rotation 0 then 1; drag rows/paints test single tiles; `'pilings'` finds a building to retrofit.
- **D22 `headless.forceHurricane`** = `weather.spawnStorm` with `coneNowTick = T`, `landfallTick = T + 600`, watch at +300, bands at +500; the Year-1 Célestine is marked done so it does not double.
- **D23 Open-ended timers are `untilDay: -1` everywhere.** `progress.addTimer(id, value, days)` with `days === Infinity || days < 0` stores `untilDay = -1` in the LIVE state; the expiry test is `untilDay >= 0 && untilDay <= day`; economy/buildings readers treat `-1` as active; `session.save/load` do no translation; `Infinity` never appears in `BSU.state` (§10.3 — the smoke test scans the live tree). Every timed modifier in the game lives in `progress.timers` (economy reads them; nothing else adds happiness terms).
- **D24 Ecology mirror.** `wildlife.ecology` is the source; `session` copies it to `economy.ecology` at the end of each tick so the HUD and `breakdown` read one branch.
- **D25 Errors.** Per-module/per-pass/per-listener try/catch with once-per-signature logging (`BSU.error`); under `BSU.SELFTEST` errors throw.
- **D26 Keyboard.** `~` is `Backquote`; `Esc` closes one layer per press (tool → inspect → panel → card); overlay keys toggle; `Shift+P` is not bound (D12 removed the pilings toggle).
- **D27 Interpolation.** Movers keep `px, py` (previous tick) and render draws `p + (cur − p)·alpha`; buildings and tiles never interpolate.
- **D28 Coverage suppression** (`economy.suppressCoverage`) and capacity-penalty suspension (`suspendCapPenalties`) are economy flags set by progress at Objectives 5 and 3 (false under skipTutorial); `buildings.effective(id)` returns 1 while suppressed.
- **D29 Tier 1/2 assignment** follows §11: the row/logic of every catalog item is Tier 1; only sprites/animations/cards named in §15.5 slip to Tier 2.
- **D30 Event registry is closed.** A module emitting an unregistered name fails `contract.selfTest`; new events require editing §3.4 first.
- **D31 `contract.js` selfTest location.** `BSU.contract.selfTest()` (not `BSU.selfTest`), because `test/modules.mjs` discovers self-tests as `BSU.<module>.selfTest`.
- **D32 Card and timer ids are contract constants.** `BSU.BOARD_CARDS`, `BSU.VOICE_CARDS`, `BSU.HAPPINESS_TIMERS`, `BSU.OBJECTIVE_IDS` and `BSU.MILESTONES` are the only ids `data.js` and `progress.js` may use for those things (§3.7), so two agents cannot spell them two ways.
- **D33 Pre-keyed state.** `newState` pre-keys `ledger.*.income/expense` (every §2.7 key at 0), `progress.objectives` (every id `locked`) and `progress.milestones` (every id unearned), and prefills `plot.bank0/rect/founders` from `params.terrain` (§3.7). `terrain.gen` overwrites the plot; economy/progress never need to check for a missing key.
- **D34 Ticket default $35, speed default 1, volume 0.5, particles 'high'** (§3.7) — the GDD names the tiers and the ranges but not the defaults; $35 is the ×1.0 attendance tier and 1× is the speed the tutorial runs at from the first path.
- **D35 `hydro.marshDrain`.** The §3.2 list named two `hydro.drain` sub-objects; the drained-marsh rule set is `params.hydro.marshDrain`.
- **D36 Params leaf types.** Arrays of strings (dates, objective ids) and arrays of number pairs are legal leaves; `render.tint.*` is `{color, alpha}`; the debug panel enumerates numeric leaves only (§3.7).
- **D37 `reset(state, fresh)`.** Session passes `true` from `newGame` and `false` from `load`; it is the only signal a module may use to tell a new game from a load; `rng.sim` may be drawn in `reset` only when `fresh === true` (§1).
- **D38 Self-healing query caches.** Because `terrain.gen` runs before any `reset` and `reset`s run in manifest order, the query functions listed in §1 are pure over `state` or rebuild when `cacheRoot !== state` (per-day caches also on `calendar.day`); `terrain.gen` still ends with `classify` + `rewalk` (no two-pass reset).
- **D39 Streams are never replaced.** `BSU.rng.world/sim/fx` are created once by `contract.js` and reseeded in place (`.state = …`) by terrain/session; modules may hoist `const R = BSU.rng.sim`.
- **D40 `BSU.state` is assigned before `terrain.gen`** so `rng.derive('reroll', k)` mixes the new seed; a title-world → charter game and a headless `newGame` with the same seed generate the same map.
- **D41 Shelter assignment.** `buildings.shelterAssignments(state) → {buildingId: capacity}`; `agents.shelter(state, capacities)` assigns greedily (nearest shelter with remaining capacity, agent index order, rng-free). Weather forwards one to the other unchanged.
- **D42 Arrivals create their own agents.** `agents.spawnArrival` creates `min(300, 40 + floor((students + pending)/25)) − liveAgents` agents (pending = the count for `'founding'` only), parks them in the vehicle, and the daily reconcile excludes in-flight arrivals; `GONE` agents are never spliced; `headless.snapshot().agents` is `agents.count(state)`. This is what makes the tutorial founding (students 0 → `agent:arrive` → `addStudents(120)`) terminate.
- **D43 One delivery for decision toasts.** `decision:closed{id, answer}` is the only path an owner acts on; `onAnswer` is ui-internal; owners guard with a per-id answered flag; weather/sports enforce their own tick-based timeouts through `ui.answerDecision(id, 'default')`.
- **D44 One opener per card** (§7.7). ui_panels opens `failure` (on `econ:card`) and `wetfeet` (on `milestone:earned`); progress only records `failure.pendingKind` and emits `econ:card{kind:'underwater'}` for the counter it owns.
- **D45 `ui.card(state, idOrSpec, payload?)`** is the one card signature; string ids resolve through `BSU.ui.cards[id](state, payload)`.
- **D46 No state on module objects.** Consumers read `state.<branch>.<field>` or call a query; `state.wildlife.sick/beadsDay/burrowLog`, `state.progress.forceFirefliesDay/drainedEver`, `state.hydro.heldStage/spillwayOffset` are lazily-initialized documented keys (§2).
- **D47 `hydro.surge` = `{stage, target, entry, dir, reached, t0}`**; the BFS front lives in hydro's closure and is rebuilt from `entry`; readers use `hydro.surgeReached(state, i)` / `surgeFrontDistance`.
- **D48 Structural save.** Every enumerable key of every saved branch minus `BSU.SAVE_SKIP`; no per-branch key lists; `load` keeps unknown keys; no value translation.
- **D49 Harness-owned `BSU.SELFTEST`** and injectable `M._deps.emit` (§10.6); `session.selfTest` is exempt from the 200 ms/no-swap rule and runs last.
- **D50 World particles** reach render's depth-sorted pass only through `render.particles.forEachWorld(fn)` (render_fx implements, render calls once per frame); screen-space particles are render_fx's weather pass.
- **D51 `spawnStorm.compressed`** is an explicit required option (true = tick-driven lifecycle for debug/headless; false = day-driven for Célestine and the schedule); weather calls `sports.offerPlayThrough(state)` at T−1 when a home entry falls on that day with `forecastCat ≤ 1`.
- **D52 `progress.unlockReason(state, id)`** owns every unlock-condition phrasing; `buildings.unlocked` returns `{ok, reason}` from `progress.unlocked` + `unlockReason`.
- **D53 `economy.addStudents` emits no enroll events**; the round/lock steps emit `enroll:round/lock`; agents' listener calls `spawnArrival`.
- **D54 A* queue keyed by `(from, to, grid)`**: repeated requests return `null` without enqueuing; the cache answers the next call.
- **D55 Build joins modules with `;\n`** and `node build.mjs --check` also `node --check`s the concatenated script, so a missing trailing semicolon in one file cannot turn the next IIFE into a call.
- **D56 Input signatures** (§7.2): `pointer(type: 'down'|'move'|'up'|'cancel', px, py, button: 0|1|2, mods: {ctrl, shift, meta, alt})`, `keydown(key, mods: {ctrl, shift, meta, alt, code?})`, Backquote matched on `mods.code === 'Backquote' || key === '`'`; the stub-safe DOM subset table in §7 is the complete list of what `ui*.js`/`render*.js`/`session.js` may touch.
- **D57 `ui.notify` `onClose`** callback (any close reason) for the first-warning speed restore; `applySkipTutorial` queues no cell (the Apr 4/5 date handlers are the single source); the skipTutorial path is laid by `terrain.landRoute` only.

*End of ARCHITECTURE.md.*
