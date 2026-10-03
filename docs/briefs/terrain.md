# Brief: `src/js/terrain.js` → `BSU.terrain`

Read first: `docs/ARCHITECTURE.md` §1 (row 2), §2.2 (`tiles`), §2.3 (`plot`, `Veg`), §3.1 (`BSU.T`, `BSU.SURF`, `BSU.FLAG`), §3.2 `params.terrain`/`params.subsidence`, §3.4 (`tile:changed`), §5.1 step 2, §5.2 (this module's API), §1 (`reset(state, fresh)`; self-healing queries), §3.3 (streams are reseeded in place), §9.1 (`BSU.state` is assigned before `gen`), §10.4, §10.5–10.6, D37–D40, D49, D57; `docs/GDD.md` §3 (all of it), §6.5 (subsidence), §7 Pathfinding (the `walk` table), §3.2 (`surface`, flags bit10 debris, bit11 mound, `wear`), §6.2 Recovery (debris), §12.1 (what chunks bake — terrain supplies the data, not the pixels).

---

## 1. Purpose and public surface

`terrain.js` generates the 64×64 map from the seed, keeps the derived per-tile arrays (`type`, `walk`) correct whenever anything changes, is the **single relay** through which every module reports a tile change (`terrain.touch`), and runs the small daily/yearly ground processes (sandbag expiry, debris clearing, desire-line wear decay, subsidence). It never draws.

Module shape (mandatory): `'use strict'` IIFE, `const M = (BSU.terrain = BSU.terrain || {})`, with `init`, `reset`, `tick`, `selfTest`. No DOM, timers or canvas anywhere.

```js
BSU.terrain.init(state)                        // once per page load: subscribe (owner 'terrain') to building:placed/removed (for the reachability + lamp caches)
BSU.terrain.reset(state, fresh)                // every newGame (fresh === true) and load (fresh === false): drop and lazily rebuild the reachability cache, lamp cache, parade route, dirty sets; classify + rewalk all; identical for both values (generation happened in gen, not here; terrain never draws rng.sim)
BSU.terrain.tick(state, flags)                 // §5.1 step 2 (daily and yearly work only; see §4.3 below)
BSU.terrain.gen(state, seed) → void            // fills tiles.elev/flags/surface/type/walk, tiles.depth/sat via hydro.seedInitial, state.plot, state.veg; re-rolls up to 50 derived seeds, then the template map
BSU.terrain.classify(state, i?) → void         // tiles.type for one tile or all
BSU.terrain.rewalk(state, i?) → void           // tiles.walk for one tile or all
BSU.terrain.touch(state, i, what) → void       // THE only tile-change relay: marks walk/chunk/ring/route dirty, emits tile:changed
BSU.terrain.setSurface(state, i, surf) → void  // validated 0–4, then touch(i,'surface')
BSU.terrain.setElev(state, i, ft) → void       // writes elev, classify(i), rewalk(i), touch(i,'elev')
BSU.terrain.setFlag(state, i, bit, on) → void  // terrain-owned bits only (0,1,6,7,9,10,11); then touch(i,'flags')
BSU.terrain.tileAt(state, tx, ty) → TileInfo   // {i, tx, ty, type, elev, depth, sat, stand, mosq, subs, crest, integrity, sandbag, surface, owner, flags, walk, drainsTo}
BSU.terrain.isLand(state, i) → boolean         // type not OPEN_WATER / BAYOU / POND
BSU.terrain.isWater(state, i) → boolean        // flags has OPEN_WATER or BAYOU
BSU.terrain.reachableDryHigh(state) → Uint8Array   // 1 = tile ≥ 3.5 ft reachable from the plot over land not crossing Water/Bayou/Marsh (G7); cached
BSU.terrain.ridgeFull(state, w, h) → null | {tx, ty, elev, floodsAt: 'Cat 2'|'rain'}
BSU.terrain.applySubsidenceYear(state) → void  // Jan 1
BSU.terrain.bank(ty) → number                  // floor(58 + 2·sin(ty/9)) − 1
BSU.terrain.guarantees(state) → {ok, failed: string[]}   // G1–G8 + distribution (ARCHITECTURE writes this as "gen guarantees"; the function name is `guarantees`)
BSU.terrain.streetlamps(state) → number[]      // cached tile indices
BSU.terrain.paradeRoute(state) → number[]      // cached
```

Extra (internal but exported for tests): `BSU.terrain.template()` returns the hand-authored fallback map description; `BSU.terrain.walkClassOf(state, i) → 0..4` (the pure rule used by `rewalk`); `BSU.terrain.landRoute(state, fromI, toI) → number[]|null` (the G3 BFS over land tiles of any type — bare Marsh included — used by `guarantees` for G3 and by `session`'s `skipTutorial` to lay the tutorial path); `BSU.terrain.subsidenceRate(state, i, underBuilding: boolean) → number` (the §6.5 ft/yr rate for one tile; the inspect panel and the ghost's sink line read it); `BSU.terrain.plantVeg(state, type, tx, ty) → Veg` and `BSU.terrain.removeVeg(state, tx, ty) → boolean` (buildings calls these for rows 36–38; `Veg.type` is `'oak'|'cypress'|'palmetto'|'azalea'`); `BSU.terrain.isDisturbedMarsh(state, i) → boolean` (wildlife).

## 2. State fields

**Writes (owner):** `tiles.elev` (generation, subsidence, grading via `setElev`, pond cut via `setElev` called by buildings), `tiles.subs`, `tiles.flags` bits 0 (WETLAND_ORIGINAL), 1 (PRESERVE), 6 (BAYOU), 7 (OPEN_WATER), 9 (DESIRE_WORN), 10 (DEBRIS), 11 (MOUND); `tiles.surface` (only through `setSurface`, which buildings calls); `tiles.type`; `tiles.walk`; `tiles.wear` (decay −5/day only; agents increment); `tiles.sandbag` / `tiles.sandbagDay` (expiry write of 0 only; buildings writes 15/day); `state.plot`; `state.veg` (generation writes; buildings pushes/removes planted trees — allowed because `veg` growth stage and `planted` are terrain-owned but the Live Oak / Cypress rows are placed through buildings; buildings calls `terrain.plantVeg(state, type, tx, ty)` and `terrain.removeVeg(state, tx, ty)` — **add these two functions**). Growth (checked daily): `stage` advances 0→1 and 1→2 at `plantedDay + days` per type: `oak [120, 240]`, `cypress [120, 240]`, `palmetto [60, 120]`, `azalea [30, 60]` (azaleas are shredded to stage 0 by a Cat 3+ storm — buildings resets `stage`/`plantedDay` — and regrow in 30 days). Generated trees are created at stage 2.

**Reads:** `tiles.depth` (walk classes, drained check for `tileAt`), `tiles.owner` (walk 0 on footprints), `tiles.crest` (bare levee berm class), `hydro.bayouStage`/`hydro.riverStage` via `BSU.hydro.stageAt` (bridge/boardwalk impassable rule), `storms.lastLandfallDay` (debris), `buildings` for the Wildlife Post debris query (`BSU.wildlife.nutriaTraps(state, i)` is the query, per ARCHITECTURE §5.5), `calendar.day`.

Never writes: `depth`, `sat`, `stand`, `mosq`, `crest`, `integrity`, `owner`, flags 2–5, 8, 12, 13.

## 3. Events

**Emits:** `tile:changed` `{i, tx, ty, what: 'elev'|'surface'|'crest'|'flags'|'type'|'water'|'decor', chunk}` — from `touch` only. `chunk = ((ty >> 3) << 3) + (tx >> 3)` (chunk index 0–63, row-major by 8×8). `what:'water'` is emitted by hydro through `touch` when a Marsh tile crosses 0.5 ft or a water flag changes; terrain itself emits `elev|surface|flags|type|decor` (`decor` for veg plant/remove, wear/debris/mound visual changes).

**Listens (in `init`, owner tag `'terrain'`):** `building:placed`, `building:removed` → invalidate `reachableDryHigh`, lamps, parade route (they depend on `surface`, which changes through `setSurface` anyway, but footprints also block reachability paths — recompute lazily on next query).

Rule: listeners only set dirty flags; all work happens in `tick` or lazily in the query.

## 4. Rules checklist

### Tier 1

**Generation (GDD §3.4, §3.5, `params.terrain`)** — `gen(state, seed)`:

- [ ] Reseed **in place**: `BSU.rng.world.state = seed` (never `BSU.rng.world = BSU.rng.make(seed)` — the Stream objects are created once by contract.js and never replaced, D39); every random draw in generation uses `rng.world` (never `rng.sim`). On re-roll `k` (1…50) use the throw-away stream `BSU.rng.derive('reroll', k)` (= `make(hash(BSU.state.seed, hash(strHash('reroll'), k)))`) — this is correct only because session assigns `BSU.state = state` **before** calling `gen` (D40), so the derived seed mixes THIS game's seed; `gen` may `BSU.assert(BSU.state === state && state.seed === seed)` at entry.
- [ ] `bank(ty) = floor(58 + 2·sin(ty/9)) − 1`; `d = bank(ty) − tx`; `bank0 = bank(7)`; store `plot.bank0`.
- [ ] Step 1 River: columns `tx ≥ 58 + 2·sin(ty/9)` → `elev = −4`, flag OPEN_WATER. Column `bank(ty)` is land (batture).
- [ ] Step 2 Ridge: for `0 ≤ d ≤ 22`: `elev = base(ty) + 7·crown(ty)·(1 − d/22)^1.3 + n`; `crown(ty)` = 1.0 for ty 6–13; 0.7 for ty 5 and 14; 0.42 for ty ≤ 4 and 15–26; linear 0.42 (ty 26) → 0.25 (ty 34); 0.25 south of 34. `base(ty)` = 2.0 for ty ≤ 26, linear to 1.0 at ty 34, 1.0 south. `n` = value noise ±0.5 ft (scale 5 tiles), ±0.3 inside the G1 rectangle.
- [ ] Step 3 Basin: `d > 22`: `elev = clamp(1.0 + 1.8·noise2(tx,ty), 0, 3.4)` (2-octave value noise, scale 11) minus 0.8 for `ty ≥ 50` (clamp ≥ 0), minus a bowl toward the lake ellipse at (10, 54), radii 6×4, elev −2, flag OPEN_WATER.
- [ ] Step 3b Cove: ellipse center `(bank(16) − 8, 16)`, semi-axes 2.5×2; inside: `elev = 1.6 + 0.9·r²` (`r² = ((tx−cx)/2.5)² + ((ty−cy)/2)²`); the ring just outside → `max(elev, 2.6)` except the **mouth**: the three rim tiles on the SW arc centered on `(cx−2, cy+2)` set to exactly 2.2. Store `plot.cove` (floor tiles), `plot.mouth` (3 tiles, `mouth[1]` = the center lip). The NE rim must touch the plot at ≥ 5.0 ft (it does by the profile: rows 14–16 at d ≈ 5–8; verify, re-roll if not).
- [ ] Step 4 Bayou: Catmull-Rom spline from the north edge at `tx = 30 ± 4` to the lake; **second control point forced** to `(mouthX − 2, mouthY + 2)`; three further random control points with `tx ≤ bank − 12`; spline may never enter a tile with `elev ≥ 5.0` (assert; re-roll). Carve 2 tiles wide to `elev = −1`, flag BAYOU; 1-tile Marsh shoulders forced to 0.5 ft. Store `plot.bayou` = spline tiles in parameter order from the north edge (upstream = smaller index). `plot.landing` = the Bayou tile nearest `plot.mouth[1]`; `plot.landingShoulder` = the Marsh shoulder tile between the landing and the cove (the shoulder tile adjacent to the landing with the smallest Chebyshev distance to `mouth[1]`).
- [ ] Step 5 Cheniers: 5–7 ellipses west of the bayou (`tx ≤ bayouX(ty) − 3`), semi-axes 5–7 (long axis E–W ± 30°) × 3–4, cosine profile from 2.0 at the rim to a crest 6.5–7.5. Store `plot.cheniers = [{cx, cy, tiles}]`. **The Mounds:** on the largest chenier, two tiles 4–6 apart on its crest line: `elev = crest + 2`, flag MOUND, `owner = −1`; store `plot.mounds` (2). Mounds are excluded from G5/G7 counts.
- [ ] Step 6 Vegetation: entities `{type, tx, ty, stage, plantedDay: 0, planted: false}` — oak on Dry/High 8%, cypress on Marsh/Wet/water-edge 14%, palmetto on Wet 6% (never on the G1 rectangle, the Founders' footprint, the highway stub, the cove floor, the mounds, or water). Generated trees start at `stage: 2`. Reeds (25% of Marsh) are **not** entities: they are a chunk decoration derived from a tile hash by sprites/render.
- [ ] Step 7 Pre-placed: reserve the Founders' footprint at `tx = bank0−7…bank0−5, ty = 7–9` (store `plot.founders = {tx: bank0−7, ty: 7}`); Highway 1 stub `surface = 2` at `tx = bank0−5, ty = 0…6` (store `plot.highway`, north to south, 7 tiles); two Live Oaks at `(bank0−8, 8)` and `(bank0−4, 8)` (`stage 2`, `planted:false`; store `plot.oaks`). `plot.rect = {x0: bank0−9, y0: 6, x1: bank0−1, y1: 13}`. `plot.lake` = lake tiles.
- [ ] After elevation: `classify(state)` for all tiles; write `flags` bit0 WETLAND_ORIGINAL on every Marsh tile; `hydro.seedInitial(state)` (depth/sat/stand); `rewalk(state)` for all. `gen` runs **before any module's `reset`** on the new root (ARCHITECTURE §1), so the hydro (`seedInitial/surfaceAt/stageAt`), buildings (`get`) and wildlife (`nutriaTraps`) queries it uses are specified to self-heal on `cacheRoot !== state` (D38) — terrain relies on that and does no two-pass reset.
- [ ] **Guarantees G1–G8 and the distribution** (`guarantees(state)`): G1 rectangle entirely ≥ 5.0 ft and every 3×3 window inside spans ≤ 1.5 ft; G1b ≥ 5-ft tiles reachable from the plot over land = 72–110 (if more: lower stray ≥ 5-ft tiles outside rows 5–14 to 4.9, then rows 5/14 at d ≥ 9); G2 cove 12–20 contiguous tiles at 1.6–2.5, rim ≥ 2.6 except the 3-tile mouth at 2.2; G3 shortest walkable route Founders'→landing ≤ 16 tiles crossing ≥ 3 cove tiles (compute with a BFS over land tiles where bare Marsh counts as walkable for this test because the path will be laid on it); G4 cove's lowest tile ≤ 5 tiles (4-connected over land ≤ 3.5 ft) from a Bayou tile; G5 a chenier of ≥ 40 contiguous Dry/High within 18 tiles of the plot, separated by the Bayou; G6 ≥ 12 consecutive Marsh tiles between ty 20 and the south edge along ≥ 70% of columns `tx ≤ bank − 14`; G7 Dry/High reachable from the plot without crossing Water/Bayou/Marsh = 300–400, map-wide Dry/High ≥ 600 with ≥ 250 on cheniers, Marsh ≥ 1,400; G8 spline never enters ≥ 5.0 ft and passes within 2 tiles of the mouth. Distribution ±3 points: Water 11%, Bayou 3%, Marsh 40%, Wet 30%, Dry 12%, High 4%.
- [ ] Re-roll up to `params.terrain.maxRerolls` (50) derived seeds; if all fail, load the **template map** (a hand-authored description embedded in this file: the same steps with fixed control points and no noise, tuned once so it passes; `plot.template = true`). The template must pass `guarantees`.
- [ ] `gen` runs ≤ 300 ms including re-rolls (ARCHITECTURE §10.4). Noise functions must be cheap (value noise with a small permutation table seeded from `rng.world`).

**Classification (GDD §3.3)** — `classify`:

- [ ] `OPEN_WATER` if flag bit7; `BAYOU` if bit6; `POND` if bit5 (POND_SINK); `MARSH` if `elev < 1.5` and none of those flags (even if `elev < 0` after subsidence); `DRAINED` if Marsh-elevation and flag bit3 (DRAINED); `WET` 1.5 ≤ elev < 3.5; `DRY` 3.5 ≤ elev < 6.5; `HIGH` elev ≥ 6.5. Levee/floodwall tiles keep the ground type. Invariant: an `elev < 0` tile without a water/pondSink flag is Marsh, never anything else.
- [ ] `classify(state, i)` emits `tile:changed{what:'type'}` **only if the type changed** (through `touch`).

**Walk grid (GDD §7 Pathfinding, §0.3 rows 1–3, 25, 27, 31)** — `rewalk` / `walkClassOf`:

- [ ] `owner[i] ≥ 0` → 0 (blocked), **except** footprints of `practice_field`, `stadium`, `parking` (agents may cross turf/lots: class 2) — query `BSU.buildings.get(state, owner).type`.
- [ ] `surface` 1–3 (path/road/boardwalk), including culverts (canal flag + surface 1–3) and bridges (surface 2 on a water-flag tile): class 1, **unless** the local water surface exceeds normal stage + 2 ft: for boardwalk/bridge tiles `BSU.hydro.surfaceAt(state,i) − (BSU.hydro.stageAt(state,i)) > 2` → 0; for a path/road on land: `depth ≥ 0.6` → 0, `depth ≥ 0.3` → 4 (wading), else 1.
- [ ] Bare canal (flag CANAL, surface 0) → 0. Bare Marsh (type MARSH, surface 0) → 0. Water/Bayou/Pond without surface → 0. Mound → 2 (walkable, unbuildable).
- [ ] Bare levee/floodwall tile (`crest > 0`, surface 0) → 2 (berm). Fence (surface 4) → the ground class (students use gates).
- [ ] Land by type: `depth ≥ 0.6` → 0; `depth ≥ 0.3` → 4; else HIGH/DRY/DRAINED → 2, WET → 3.
- [ ] Debris (flag bit10) doubles cost: encode as **the same class**; agents read the flag and double the step cost (walk stays 0–4; document this in the file header). 
- [ ] `rewalk(state)` (all) runs in ≤ 3 ms; `rewalk(state, i)` is O(1). Hydro calls `terrain.rewalk(state, i)` for tiles whose depth crosses 0.3/0.6 (hydro brief) — terrain must accept those calls at 4 Hz without allocation.

**Change relay** — `touch(state, i, what)`:

- [ ] Sets `walkDirty` (rewalk that tile now — `touch` itself calls `rewalk(state, i)` for `what ∈ {elev, surface, flags, type, water}`), marks the chunk dirty (render listens to the event; terrain keeps no bitmap), invalidates its own caches (reachability, lamps, parade route, `ridgeFull`), then `BSU.events.emit(BSU.EV.TILE_CHANGED, {i, tx, ty, what, chunk})`. It must be safe to call thousands of times in one tick (surge): no allocation beyond the payload object; consider a per-tick coalescing set only if profiling shows a need (the event is required per tile by render's chunk-dirty logic, so do not drop events).

**Daily work (§5.1 step 2; GDD §3.2, §6.2 Recovery, §7 Desire lines)** — in `tick(state, flags)` when `flags.newDay`:

- [ ] Sandbag expiry: for every tile with `sandbag > 0` and `calendar.day ≥ sandbagDay` → `sandbag = 0`, `sandbagDay = 0`, then `BSU.hydro.markLeveeChange(state, i)` (hydro re-evaluates and dirties the ring).
- [ ] Debris: tiles with flag DEBRIS clear (flag off + `touch(i,'flags')`) when `calendar.day ≥ storms.lastLandfallDay + params.storm.debrisDays (5)`, or immediately on any day when `BSU.wildlife.nutriaTraps(state, i)` is true (a Wildlife Post within 14). **Progress** sets the DEBRIS flag after landfall (at `storm:report`) via `terrain.setFlag(state, i, BSU.FLAG.DEBRIS, true)` on 5% of campus tiles plus every flooded land tile (it calls terrain because the bit is terrain-owned).
- [ ] Wear decay: `wear = max(0, wear − 5)` on every tile with `wear > 0`; DESIRE_WORN re-evaluation: set the flag when `wear ≥ params.agents.wearThreshold (40)`, clear it when `wear < 20` (hysteresis; decision), `touch(i,'decor')` on each transition.
- [ ] Veg growth stage (see §2) — `touch(i,'decor')` on a stage change.

**Yearly (Jan 1; GDD §6.5)** — `applySubsidenceYear(state)` called from `tick` when `flags.newYear` (and Year ≥ 2; Year 1's Jan 1 is tick 0 and must not subside):

- [ ] Per land tile `rate` (ft/yr): DRAINED 0.35 under a building (0.25 bare); WET 0.12 under a building (0.05 bare); DRY 0.02; HIGH 0; MARSH (undrained) 0.05 bare / 0.12 under a building (treat as Wet — decision: Marsh with a piled building is "Pilings 0"); Pilings → 0; `+0.06` if inside any powered Pump Station's radius 8 (`buildings.list('pump')`, Chebyshev to nearest footprint tile ≤ 8); `×0.5` if within 1 of a cypress (`veg`); `×0` on PRESERVE tiles. Levee tiles (`crest > 0`, not floodwall i.e. `crest === 6`) on WET/MARSH: 0.06 (the crest follows the tile). Then `subs[i] += rate`, `elev[i] −= rate`; `classify(i)`; and for each building whose footprint touched: `BSU.buildings.applySubsidence(state, id, maxRateOverFootprint)` once per building; `touch(i,'elev')` per changed tile. The `E` overlay reads `subs`.
- [ ] Buildings on Pilings: the *tile* still sinks? No: "Pilings: no subsidence" — treat the whole footprint as rate 0.

**Queries:**

- [ ] `reachableDryHigh`: BFS 4-connected from every tile of `plot.rect` over tiles whose type ∉ {OPEN_WATER, BAYOU, MARSH, POND}; mark reached tiles with `elev ≥ 3.5` (Dry/High). Cached until `touch`. Also expose `reachableHigh5(state) → number` (count of reached tiles ≥ 5.0 — G1b, and the "Ridge full" test).
- [ ] `ridgeFull(state, w, h)`: scan every origin where a w×h footprint is entirely on reached tiles ≥ 5.0 with `owner === −1` and span ≤ 1.5 ft; if any → `null`. Else find the flattest w×h on reached tiles ≥ 3.5 (`owner === −1`), return `{tx, ty, elev: min elev of that footprint (1 decimal), floodsAt: elev ≥ 3.5 ? 'Cat 2' : 'rain'}`; `null` if no site at all (buildings then says "No site").
- [ ] `streetlamps`: for each 4-connected run of the same surface id (2 or 1), walk from its lowest tile index along the run (BFS order from the lowest index; for branching runs use the BFS visitation order): every 4th road tile / every 6th path tile (indices 0, 4, 8… / 0, 6, 12… in that order) gets a lamp. Cached.
- [ ] `paradeRoute`: the longest 4-connected run of `surface === 2` if ≥ 4 tiles (as an ordered path: the longest simple path within the run found by two BFS passes — diameter), else the longest connected `surface === 1` run, else `[]`.
- [ ] `tileAt`: `drainsTo = BSU.hydro.drainsTo(state, i)`.
- [ ] `tick` also provides `terrain.isDisturbedMarsh(state, i)` for wildlife: Marsh within Chebyshev 2 of any footprint tile (`owner ≥ 0`) or `surface` 1–3 tile; cached mask rebuilt on `touch`/building events (cheap 4,096 scan with a dilation).

### Tier 2

- [ ] Template map polish (the fallback must exist in Tier 1, but its aesthetics are Tier 2).
- [ ] Marsh Restoration support: `terrain.restoreToMarsh(state, i)` — sets `elev = min(elev, 1.0)` for Wet tiles, clears DRAINED (hydro owns bit3 — call `BSU.hydro.markRestored(state, i)`), sets WETLAND_ORIGINAL, `classify`, `touch`. Called by hydro when the 30-day progress completes.
- [ ] The Second Campus: a second Highway 1 stub from the west edge (`terrain.addWestStub(state)`), Tier 2 per ARCHITECTURE §11.2.

## 5. Edge cases and invariants

- `elev` ∈ [−4, +14] always; clamp after noise and after subsidence (`elev` never NaN: guard every noise call).
- Map edges: `nbr4`/`nbr8` from contract already omit out-of-bounds; `bank(ty)` ≤ 62 so column 63 is always river; row 0 highway stub tiles are valid.
- `gen` must be deterministic for a seed (same seed → identical `elev` bit-for-bit) — no `Math.random`, no iteration over object keys whose order could differ.
- `gen` on `newState(0)` at boot (session step 1 creates an empty root but does not generate) — `reset` on an ungenerated state must not throw (all arrays zero; queries return empty).
- `reset(state, fresh)` never keeps the old root: caches are closures keyed on the root (`cacheRoot === state`); `isLand/isWater/walkClassOf/landRoute/reachableDryHigh/streetlamps/paradeRoute` self-heal when called with a different root than the cached one (§1).
- Loading a save: `type`/`walk` are saved, but `reset` should still run `classify(state)` and `rewalk(state)` for all to heal any stale save (cheap, deterministic).
- During set pieces `tick` receives `flags.newDay === false` (calendar frozen) so nothing daily runs; subsidence cannot happen mid-set-piece.
- Headless: identical behavior; nothing here is browser-specific.
- `touch` may be called re-entrantly from a `tile:changed` listener? Forbid: listeners must not call `touch` synchronously (document; the bus wraps listeners in try/catch but a recursion would explode). Render/agents/wildlife only set dirty flags in listeners.
- The Founders' footprint is **reserved** (not `owner`-marked) until placed: `plot.founders` is advisory; buildings enforces it in `canPlace` (only `founders_hall` may be placed there and it may only be placed there).

## 6. selfTest() requirements

Pure; build private states with `BSU.newState(seed)`; no canvas, no DOM, no mutation of `BSU.state`; ≤ 200 ms total (so use seeds 1–3 only and accept that `gen` ≤ 60 ms each after warm-up; if the first `gen` is slower, run seeds 1–2).

1. For seeds 1, 2, 3: `gen(s, seed)` then `guarantees(s).ok === true` and `failed.length === 0`; distribution within ±3 points; `plot.template === false` for at least one of them.
2. Determinism: `gen` twice with seed 2 → `elev` arrays equal element-wise.
3. `classify`: synthetic tiles — elev −0.5 no flags → MARSH; elev 1.49 → MARSH; 1.5 → WET; 3.49 → WET; 3.5 → DRY; 6.5 → HIGH; POND_SINK flag → POND; DRAINED flag at 1.0 → DRAINED.
4. `walkClassOf` table: path on dry land → 1; path with depth 0.35 → 4; depth 0.6 → 0; bare marsh → 0; marsh + path → 1; bare canal → 0; canal + road → 1; boardwalk over bayou at stage 0 → 1; boardwalk with surface 2.5 ft above stage → 0; bare levee → 2; fence on Wet → 3; owner ≥ 0 → 0.
5. `touch` emits exactly one `tile:changed` with the correct `chunk` for tiles (0,0)→0, (63,63)→63, (8,0)→1, (0,8)→8.
6. Subsidence: a private state with one Drained tile under a fake building → after `applySubsidenceYear` the tile dropped by 0.35 ± 1e-6 and `subs` rose the same; a High tile unchanged; a Preserve tile unchanged.
7. `streetlamps` on a synthetic 12-tile straight road → 3 lamps at run indices 0, 4, 8; a 13-tile path → indices 0, 6, 12.
8. `paradeRoute` on a synthetic L-shaped 10-tile road returns 10 tiles in path order; with no roads and a 5-tile path returns the path; with neither returns `[]`.
9. `ridgeFull` after generating seed 1 and marking the whole G1 rectangle as owned → non-null with `floodsAt` ∈ {'Cat 2','rain'}; before marking → `null` for a 3×2.
10. `bank(7)` equals the value used for `plot.bank0`; `plot.highway.length === 7`; `plot.mouth.length === 3`; `plot.mounds.length === 2`; `plot.oaks.length === 2`.

Assertions use `BSU.assert`; **the harness sets `BSU.SELFTEST = true` around the call (never toggle it yourself, §10.6)**, so any `BSU.error` inside aborts the test. `touch` emits through `M._deps.emit` (default `BSU.events.emit`); `selfTest` replaces it with a recorder for the duration (restored in `finally`) so test 5's `tile:changed` — and the thousands from `gen` — never reach the live game's render/agents/wildlife listeners. For tests 1–2 and 9 set `BSU.state` to the private state around each `gen` call and restore it in `finally` (D40: `derive('reroll', k)` reads `BSU.state.seed`).

## 7. Testing in isolation

`terrain.gen` calls `BSU.hydro.seedInitial` and `walkClassOf` calls `BSU.hydro.surfaceAt/stageAt`, `BSU.buildings.get`, `BSU.wildlife.nutriaTraps`. Before those modules exist, stub them in the scratch script:

```js
// scratch/test_terrain.mjs — node scratch/test_terrain.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const load = f => vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
load('contract.js'); load('data.js');
// stubs for later modules (remove as they land)
vm.runInContext(`
  BSU.hydro = BSU.hydro || { seedInitial(s){ const {T}=BSU; for(let i=0;i<4096;i++){ const t=s.tiles.type[i]; s.tiles.depth[i]= t===T.MARSH?0.25: (t===T.OPEN_WATER||t===T.BAYOU)? -s.tiles.elev[i] : 0; s.tiles.sat[i]= t===T.MARSH?0.9:(t===T.OPEN_WATER||t===T.BAYOU)?1:0.5; } },
    surfaceAt(s,i){ return s.tiles.elev[i]+s.tiles.depth[i]; }, stageAt(){ return 0; }, drainsTo(){ return 'ground'; }, markLeveeChange(){} };
  BSU.buildings = BSU.buildings || { get(){ return null; }, list(){ return []; }, applySubsidence(){} };
  BSU.wildlife = BSU.wildlife || { nutriaTraps(){ return false; } };
`, ctx);
load('terrain.js');
const BSU = win.BSU;
const s = BSU.newState(42);
console.time('gen'); BSU.terrain.gen(s, 42); console.timeEnd('gen');
console.log(BSU.terrain.guarantees(s));
const counts = {}; for (let i = 0; i < 4096; i++) counts[s.tiles.type[i]] = (counts[s.tiles.type[i]] || 0) + 1;
console.log('distribution', counts, 'plot', s.plot.bank0, s.plot.founders, s.plot.mouth);
// ASCII dump: one char per tile so you can look at the map
const ch = ['~','=','m','w','.','#','d','o'];
for (let ty = 0; ty < 64; ty++) console.log(Array.from({length:64}, (_, tx) => ch[s.tiles.type[ty*64+tx]]).join(''));
console.log(BSU.terrain.selfTest());
```

Look at the ASCII dump: river down the east edge, a short high crown near the top-right, the cove notch just SW of it, the bayou snaking from the top-middle to the SW lake, cheniers as `#`/`.` islands in the `m` sea.

## 8. Performance budget

- `gen` ≤ 300 ms total including up to 50 re-rolls (so one attempt ≈ 5 ms: precompute the noise permutation once; the spline rasterization and ellipse fills are O(tiles)); `guarantees` ≤ 2 ms (a few BFS passes over a Uint8Array scratch).
- `tick` daily work ≤ 0.3 ms typical (iterate only tiles in small "hot" index lists: keep a `Uint16Array`/plain array of tiles with `wear > 0`, `sandbag > 0`, DEBRIS set — rebuilt in `reset` and maintained on writes); the yearly subsidence pass ≤ 5 ms.
- `rewalk(all)` ≤ 3 ms; `rewalk(i)` allocation-free.
- No per-tick allocation except the `tile:changed` payload.

## 9. Done means

- Loads in the isolation harness with stubs; `selfTest().ok`; `gen` passes `guarantees` on seeds 1–20 without falling back to the template on more than 2 of them (if the template is used more often, the profile constants are mis-transcribed — check `crown`, `base`, the cove and `bank`).
- The ASCII dump matches GDD §3.4's description (river east, short crown rows 6–13, cove at row 16 with a 3-tile mouth facing the bayou, bayou within 2 of the mouth, 5–7 cheniers west of the bayou, lake SW, mounds on the largest chenier).
- With hydro, buildings and wildlife present: `node build.mjs --check && node test/smoke.mjs && node test/modules.mjs` pass; `findSpot('dorm')` finds a spot on the crown; `place('path', …)` on Marsh succeeds and `walk` becomes 1.
- No `tile:changed` storms: placing one dorm emits ≤ 6 (grading) + 6 (owner) events; a 40-tile levee drag emits ≤ 40.
