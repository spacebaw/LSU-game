# Brief: `src/js/hydro.js` → `BSU.hydro`

Read first: `docs/ARCHITECTURE.md` §1 (row 3), §2.2, §2.3 (`state.hydro`), §3.1 (`BSU.FLAG` bits 2,3,4,5,12,13), §3.2 `params.hydro`, `params.storm.surge/frontTicksPerTile/recedeTicksPerTile/surgeRampTicks`, §3.4 events, §5.1 step 3, §5.3 (this module's API, the integrity-writer rule, D6; `surgeReached/surgeFrontDistance`), §1 (self-healing queries; `reset(state, fresh)`), §8.1–8.2 (structural save; the surge front is rebuilt from `entry`), §10.5–10.6, §12.2, §12.3 steps 4–8, D37, D38, D47, D48, D49; `docs/GDD.md` §3.3 (initial state, Pond), §6.1 (all: 6.1.1–6.1.11), §6.2 "Surge heights", "Rings" (only to know what buildings computes from your arrays), §4.11 Floodgate, §6.9 Spring High Water, §0.1 (the `dtDay` table).

---

## 1. Purpose and public surface

The water. One cellular automaton over `tiles.depth` with **one head function** used on both sides of every exchange (§6.1.4), rain intake, standing-water drain, canals ×8, floodgates, pumps, pond sinks, boundary stages, the surge front, the daily flood/stand bookkeeping, drained-marsh conversion, the F-overlay prediction and the T5 conservation check.

```js
BSU.hydro.init(state)                          // subscribe (owner 'hydro'): tile:changed (networks dirty when flags/surface/elev change; risk dirty), building:placed/removed/complete (pumps, networks), power:blackout/restored (pump status), gate:* (own)
BSU.hydro.reset(state, fresh)                  // both cases: rebuild networks, active mask, back buffer, per-tile tables, per-storm logs, lastDay; risk = null; the surge front from state.hydro.surge.entry when surge is non-null; lazily initialize `state.hydro.heldStage ??= 0` and `state.hydro.spillwayOffset ??= 0` (saved keys contract.js lacks). fresh makes no difference here (hydro draws no rng and derives everything from the tree)
BSU.hydro.tick(state, flags)                   // §5.1 step 3 (session passes flags; if flags is undefined, detect a new day by comparing calendar.day to the last seen day)
BSU.hydro.seedInitial(state) → void            // §3.3 initial depth/sat/stand (called by terrain.gen)
BSU.hydro.depthAt(state, tx, ty) → number
BSU.hydro.surfaceAt(state, i) → number         // live H(i) = crestTop + depth
BSU.hydro.stageAt(state, i) → number           // boundary stage for water tiles (river/bayou; barrier-held)
BSU.hydro.floodedBuildings(state) → number[]   // ids with Building.flooded
BSU.hydro.floodedTiles(state) → number         // land tiles with depth ≥ 0.5
BSU.hydro.predictRisk(state) → Float32Array    // F overlay (cached)
BSU.hydro.riskAt(state, i) → number
BSU.hydro.footprintDepth(state, id) → number   // deepest footprint tile
BSU.hydro.markCanal(state, i, on) → void       // buildings calls on canal place/remove
BSU.hydro.markPond(state, tiles, id, on) → void
BSU.hydro.markLeveeChange(state, i) → void     // after crest/integrity/sandbag writes
BSU.hydro.setJammed(state, i, on) → void       // weather calls (tick 150 / gate crew)
BSU.hydro.networks(state) → Network[]          // {id, tiles, drainsToWater, pumps, gates}; lazily rebuilt
BSU.hydro.networkAt(state, i) → Network | null
BSU.hydro.surgeControl(state, cmd, arg) → void // 'begin' {stage, target, entry, dir} | 'stage' ft | 'end'
BSU.hydro.surgeReached(state, i) → boolean     // true while state.hydro.surge is non-null and front[i] <= surge.reached; render (surge water), render_fx (foam) and ui read THIS — never a `front` array (it is not in state, D47)
BSU.hydro.surgeFrontDistance(state, i) → number   // the BFS distance from surge.entry (65535 when unreachable or no surge); render_fx gradients
BSU.hydro.forceRain(state, {cx, cy, inches, radius, steps}) → void   // debug: immediate cell (bypasses weather; see §4)
BSU.hydro.forceSat(state, tiles, sat) → void
BSU.hydro.setStages(state, river, bayou) → void
BSU.hydro.conservationCheck(state) → {total, leak}
BSU.hydro.drainsTo(state, i) → string          // 'Canal → Bayou' | 'Pump 2 → Bayou' | 'Pond' | 'nowhere (standing)' | 'ground'
BSU.hydro.markRestored(state, i) → void        // Marsh Restoration (Tier 2): clears DRAINED/RESTORING bits, resets stand; terrain then re-classifies
BSU.hydro.stormLog(state) → {held: number[], overtopped: number[], breached: number[]}   // per-storm levee outcome (reset at surge 'begin'); buildings.damageReport reads it
BSU.hydro.stepCount() → number                 // hydro steps run since reset (tests)
BSU.hydro.activeCount() → number               // tiles in the active set (render's perf HUD)
BSU.hydro.markRestoring(state, tiles, on) → void   // Marsh Restoration paint (Tier 2): sets/clears FLAG.RESTORING; the daily step counts 30 days then calls markRestored + terrain.restoreToMarsh
```

## 2. State fields

**Writes (owner):** `tiles.depth`, `tiles.sat`, `tiles.stand`; `tiles.flags` bits 2 CANAL (via `markCanal`), 3 DRAINED, 4 FLOODGATE, 5 POND_SINK (via `markPond`), 12 RESTORING, 13 JAMMED; `state.hydro.*` (`riverStage`, `bayouStage`, `surge`, `barrierClosed`, `pondCap`, the lazily-initialized saved keys `heldStage` and `spillwayOffset`, and the three unsaved caches `networks`, `risk`, `active`); consumers read `state.hydro.barrierClosed` (buildings' static ring test) — it is never mirrored on `BSU.hydro` (D46); `tiles.integrity` **only** for overtopping (−10/day), surge contact (−5×cat once per storm) and breach (write 0), each followed by `BSU.buildings.onIntegrityChanged(state, i)`; `Building.flooded` and `Building.floodedSince` (D6, the one cross-owner write).

**Reads:** `tiles.elev`, `tiles.type`, `tiles.crest`, `tiles.sandbag`, `tiles.owner`, `tiles.surface`, `tiles.flags` (all bits), `state.plot.bayou` (order = upstream), `state.weather.dtDay`, `state.weather.event` (through `weather.consumeRainStep`), `state.weather.heat` (sat decay 0.20 when > 95), `calendar` (season for evaporation), `state.setPiece`, `state.storms.current` (category for surge contact), `state.veg` (cypress drain/loss — build a `Uint8Array cypressMask` in `reset`, refresh on `tile:changed{what:'decor'}`), buildings: `list('pump')`, `list('pond')`, `effective(id)`, `get(id)`, `footprint(id)`, `has('surge_barrier')`, barrier building struct (its tiles), `Building.pilings`.

Private (closure, rebuilt in `reset`): `back: Float32Array(4096)` (Jacobi back buffer), `active: Uint8Array`, `nextActive: Uint8Array`, `absorbFrac: Float32Array` and `drainRate: Float32Array` per tile (recomputed on `tile:changed`/building events, not per step), `lossTable: Float32Array` (per tile head loss 0/0.08/0.12 + 0.02 cypress), `kMul: Uint8Array` (1 or 8), `overtoppedToday: Uint8Array`, `surgeContacted: Uint8Array` (per storm), `lastDay`, `stormLog`, the surge `front: Uint16Array(4096)`. **Self-healing rule (§1, D38):** `terrain.gen` calls `seedInitial`, and `terrain.rewalk` calls `surfaceAt/stageAt`, **before** `hydro.reset` has run on the new root (and, on the first game, after only `init` ran). Every query (`seedInitial/surfaceAt/stageAt/depthAt/drainsTo/networks/networkAt/riverAdjacent/surgeReached/surgeFrontDistance/footprintDepth`) therefore keeps `cacheRoot` and runs `if (cacheRoot !== state) rebuildTables(state)` before answering — a table keyed on nothing is a bug. `M._deps = {emit: (n, p) => BSU.events.emit(n, p), buildings: …}`: every emit goes through `M._deps.emit` (§10.6).

## 3. Events

**Emits:** `building:flooded` / `building:dried` `{id, type, depth}` (daily transitions); `surge:start` / `surge:peak` / `surge:end` `{stage}`; `surge:front` `{i}` per activated tile; `levee:overtop` `{i, tx, ty}` once per tile per calendar day; `levee:breach` `{i, tx, ty}` when integrity hits 0; `gate:closed` / `gate:opened` `{i}` (floodgates and the barrier; for the barrier `i` = the barrier's first tile); `marsh:drained` / `marsh:reverted` / `marsh:restored` `{i}`. Relayed through `terrain.touch(state, i, 'water')` when a Marsh tile crosses 0.5 ft (either direction) so the chunk re-bakes, and `terrain.touch(i,'flags')` after any flag write.

**Listens (owner `'hydro'`):** `tile:changed` (networks dirty if `what ∈ {flags, surface, elev, crest}`; risk dirty always; recompute the per-tile constant tables for that tile), `building:placed/removed/complete` (pumps/ponds/barrier; `absorbFrac` of footprint tiles = paved 0.05), `power:blackout/restored` (no state; pumps are checked live via `buildings.effective`), `calendar:day` is **not** used — use the `flags` argument.

Listeners set dirty flags only.

## 4. Rules checklist

### Tier 1

**Initial state (GDD §3.3)** — `seedInitial(state)`:
- [ ] Land: `depth 0`, `sat 0.5`, `stand 0`. Marsh: `depth = 0.15 + 0.25 × noise` (value noise from `BSU.rng.world`-seeded hash so it is deterministic per seed; range 0.15–0.40), `sat 0.9`. Water-flag tiles (OPEN_WATER, BAYOU): `depth = stage − elev` with stage 0 (so 4 and 1 ft). Pond tiles do not exist at generation.
- [ ] `hydro.riverStage = 0`, `bayouStage = 0`, `surge = null`, `barrierClosed = false`, `pondCap = {}`.

**When a step runs (§0.1, §5.1 step 3, `params.hydro`)** — in `tick`:
- [ ] Read `dt = state.weather.dtDay` (weather wrote it this tick). If `dt > 0`: run one full step with intake/drain scaled by `dt`. If `dt === 0` and `state.setPiece` is `game|parade|graduation|montage`: run the **flow passes only** (no intake, no drain, no evaporation, no pump/pond sink) every tick where `T % 10 ∈ {0,2,5,7}`. Otherwise no step this tick.
- [ ] `dt` values are weather's business: 1/40 normal (ticks 0,2,5,7 of each block), 1/360 landfall, 1/60 near-miss, 0 elsewhere. Hydro never computes `dt` itself.

**Rain intake (§6.1.2, D14)** — once per step with `dt > 0`:
- [ ] `const r = BSU.weather.consumeRainStep(state)`; if non-null: for each land tile in the footprint (`mapWide` → every land tile; else every land tile with Chebyshev distance ≤ `radius` from `(cx, cy)` — decision: Chebyshev, cheaper than Euclid and matches the rest of the game), `absorbed = r.r × absorbFrac[i] × (1 − sat[i])`; `depth[i] += r.r − absorbed`; `sat[i] = min(1, sat[i] + absorbed / 0.5)`. Water tiles ignore rain (boundary).
- [ ] `absorbFrac` per tile: HIGH .7, DRY .6, WET .3, MARSH .9, PRESERVE flag .95, DRAINED .2, paved (owner ≥ 0, or surface 1–3, or POND? no: pond tiles are ordinary "Wet" class .3) .05, CANAL flag 0, levee/floodwall (`crest > 0`) .6. Precedence: canal 0 > paved > preserve > levee > type.
- [ ] While raining, the active set is **every tile**.

**Standing-water drain and saturation (§6.1.3, §6.1.2)** — per step, land tiles in the active set:
- [ ] `drainRate` ft/day: HIGH .6, DRY .4, WET .15, MARSH .05, DRAINED .15, paved .02, levee/floodwall .4 (crest > 0), CANAL 0 (canals don't drain into the ground — they conduct). Plus evaporation `.03` (`.06` in months 6–9). Plus cypress `.05` on a cypress tile and its 4 neighbors (`cypressMask`). `depth = max(0, depth − rate × dt)`; the drained amount is ground/evap loss (leaves the system; counted as a sink term in T5).
- [ ] `sat` decays `.12/day` (`.20/day` when `weather.heat > 95`) only on tiles with `depth === 0`; applied per step × `dt`.
- [ ] Marsh tiles below their generated baseline: undisturbed Marsh should hover at 0.15–0.40; the drain .05 and evaporation would dry it out over ~6 days. Decision: Marsh `drainRate` applies only to the part of `depth` **above 0.15** (`depth = max(0.15, depth − rate×dt)` for MARSH with WETLAND_ORIGINAL and not DRAINED; a drained/canal-adjacent Marsh tile drains normally to 0). This keeps the baked Marsh look stable and makes the 5-day drained flip need a canal. Record this in the file header.

**Flow (§6.1.4)** — two Jacobi passes per step, checkerboard-free formulation: compute every active tile's outflows from the **current** `depth` into `back` (accumulate ± amounts), then apply `back` after the pass; repeat once. Per pass, for each active tile `i` (land or water) and each 4-neighbor `j`:
- [ ] `crestTop(t) = elev[t] + crest[t] × integrityFactor(t) + sandbag[t] / 10`, with `crest[t] = 0` while `t` is an **open** floodgate (FLOODGATE flag set and not closed) and while `t` is JAMMED. `integrityFactor` = 1.0 at integrity ≥ 50, 0.5 below 50, 0 at 0. `H(t) = crestTop(t) + depth[t]`.
- [ ] `loss(j)` = 0.08 if `type[j] === MARSH` (undrained), 0.12 if PRESERVE flag, +0.02 if `cypressMask[j]`; else 0. When `wildlife.ecology < 30` the marsh/preserve loss is halved (§6.8 "surge head loss on remaining marsh halved"): read `state.wildlife.ecology` once per step.
- [ ] Overtopping branch: if `crest[j] > 0 && H(i) ≥ crestTop(j)`: `Hj' = elev[j] + depth[j]`, `test = H(i) ≥ Hj' + loss(j)`; else `Hj' = H(j)`, `test = H(i) > Hj' + loss(j)`.
- [ ] If `test`: `flow = min(depth[i] / 2, (H(i) − Hj' − loss(j)) / 2 × k)`, `k = 0.35 × (kMul[i] === 8 || kMul[j] === 8 ? 8 : 1)`; `k = 0` across a **closed** floodgate (either tile is a closed gate) and across a closed barrier tile. Sum demanded outflows of `i`; if the sum exceeds `depth[i] / 2` scale all of `i`'s outflows by `(depth[i]/2) / sum` (`maxGiveFrac 0.5`).
- [ ] `kMul[t] = 8` for a CANAL-flag tile (bare canal **or** culvert = canal + surface 1–3); 1 otherwise.
- [ ] After each pass: boundary reset — every OPEN_WATER tile `depth = riverStage − elev`; every BAYOU tile `depth = bayouStageAt(i) − elev` (below); pond tiles are ordinary CA tiles (no reset). Depth on water tiles is therefore always ≥ 1 (bayou) or ≥ 4 (river) + stage.
- [ ] Water tiles are boundaries **except** Bayou tiles upstream of a closed Surge Barrier: they "hold their last stage" — implement `bayouStageAt(i)`: if `barrierClosed` and `bayouIndex[i] < barrierIndex` (index into `plot.bayou`; the barrier's index = the smallest `plot.bayou` index among its tiles) → the stage frozen at closing (`hydro.surge ? heldStage : bayouStage` stored in `state.hydro.heldStage` — a saved key lazily initialized to 0 in `reset` (contract.js is frozen; the structural save writes it automatically, D48)), else the live `bayouStage` (+ surge stage when `surge` is active and the tile is `reached` by the front).
- [ ] Overtopping event: during a step, for a levee/floodwall tile `i` (`crest > 0`), if any 4-neighbor `j` has `H(j) ≥ crestTop(i)` **and** `j` is not itself a levee tile whose `H` is only its crest (i.e. `depth[j] > 0` or `j` is water): mark `overtoppedToday[i] = 1`; on the first mark of the calendar day emit `levee:overtop{i,tx,ty}` and record the tile in `stormLog.overtopped` when a surge is active. Daily: every tile with `overtoppedToday` → `integrity −= 10` (floor 0; if it hits 0 → breach, below) then `buildings.onIntegrityChanged(i)`; clear the mask.
- [ ] Surge contact: a levee tile 4-adjacent to a water tile whose stage `> 1 ft` → once per storm (`surgeContacted[i]`): `integrity −= 5 × cat` (`cat = storms.current.cat`, or 1 in Spring High Water with no storm — §6.9 says −5 once per window), `onIntegrityChanged`.
- [ ] Breach: `integrity` reaching 0 → `levee:breach{i,tx,ty}`, `stormLog.breached.push(i)`; the crest now counts 0 through `integrityFactor`. A breached tile stays breached until `buildings.repairLevee` writes 100.
- [ ] `stormLog.held`: at `surgeControl('end')`, every levee/floodwall tile that was surge-contacted or was adjacent to a `reached` front tile and was neither overtopped nor breached.

**Active set (§6.1.1):**
- [ ] `active[i] = 1` if `depth[i] > 0.01` or the tile received or gave flow last pass, plus its 4 neighbors; every tile while a rain event is active; boundary tiles always. Rebuild `nextActive` during the pass; swap after. `reset` seeds it from `depth`.
- [ ] Also rewalk: when a land tile's `depth` crosses 0.3 or 0.6 (either direction) call `BSU.terrain.rewalk(state, i)` (no `tile:changed` — walk-only change; agents re-plan on failure). When a Marsh tile crosses 0.5 (either direction) call `terrain.touch(state, i, 'water')`. Track with a `Uint8Array depthClass` (0: <0.05, 1: <0.3, 2: <0.5, 3: <0.6, 4: ≥0.6) compared after each step.

**Pumps, canals, floodgates (§6.1.5, §4.11)**:
- [ ] Networks: 4-connected components of CANAL-flag tiles (`networks()` rebuilds when dirty): `{id, tiles, drainsToWater: any tile 4-adjacent to an OPEN_WATER/BAYOU tile, pumps: ids of pump buildings whose footprint is 4-adjacent to a network tile (or which touch water directly — a pump touching only water has an empty network and does nothing), gates: FLOODGATE tiles in it}`.
- [ ] `markCanal(state, i, true)`: set CANAL; if `crest[i] > 0` also set FLOODGATE; bed cut is done by **buildings** through `terrain.setElev(i, max(elev − 2, 0.5))` before calling `markCanal` (buildings brief); networks dirty; `terrain.touch(i,'flags')`. `false`: clear CANAL and FLOODGATE (buildings restores elev).
- [ ] `markLeveeChange(state, i)`: if CANAL flag and `crest > 0` → set FLOODGATE; if `crest === 0` → clear FLOODGATE; `buildings.dirtyRing(state)`; `terrain.touch(i,'crest')`.
- [ ] Floodgate open/close: each step, a FLOODGATE tile is **closed** when the stage of its network's nearest water (use `bayouStage` for a network that drains to bayou, `riverStage` for river; pick the larger if both) `> params.hydro.gateCloseStage (1)`, open otherwise; store closed-ness in a private `Uint8Array gateClosed`; emit `gate:closed`/`gate:opened` on transitions. A JAMMED gate is always open (`setJammed` sets/clears FLAG.JAMMED and dirties the ring). Closed gate: `k = 0` across it and its crest re-enters `crestTop`.
- [ ] Pumps: for each network, for each pump id in `network.pumps` with `buildings.effective(state, id) === 1` (unpowered/flooded/blackout → 0 → stopped): remove `params.hydro.pumpTileFtPerDay (15) × dt` tile-ft (×2 while `storms.current?.preDrain`) from the network's canal tiles, taking from the deepest tile first (depth above the bed = `depth`), never below 0; the removed water leaves the system (discharged to water). Also allow a pump to drain **non-canal** tiles within `pumpRadius 8`? No — GDD: "removes 15 tile-ft from its connected canal network"; the radius-8 only matters for marsh draining (below) and subsidence. Pump running cost: buildings/economy handle (`+$3k` while running: hydro exposes `hydro.pumpRunning(state, id) → boolean` = removed > 0 this day; add this query).
- [ ] Ponds (§6.1.3): `markPond(state, tiles, id, true)`: set POND_SINK on the 4 tiles, `pondCap[id] = 20`; buildings cut the elev (−3) before calling. Per step with `dt > 0` (and also `dt === 0` relaxation? no, only `dt > 0`): `take = min(0.5 × dt × 40, pondCap[id])`; remove from tiles within Chebyshev 5 of the pond's NW tile (include the pond's own tiles), deepest first, ≤ 0.1 ft per tile per step, until `take` is spent; `pondCap[id] −= taken`; recovery `pondCap[id] = min(20, pondCap[id] + 2 × dt)` every step. The pond's own tiles are ordinary CA tiles (type POND, absorb .3, drain .15).
- [ ] Surge Barrier (§0.3 row 41, Tier 1 logic, Tier 2 UI): a `surge_barrier` building whose tiles cross the bayou: `barrierClosed = bayouStage > params.hydro.barrierCloseStage (2)` (evaluated per step; hysteresis: reopen at ≤ 2); on close, `heldStage = current bayouStage` for upstream tiles; `k = 0` across barrier tiles; emit `gate:closed/opened` with `i` = barrier tile 0.

**Surge (§6.2 landfall, §5.3 `surgeControl`, D13)** — weather drives it:
- [ ] `'begin' {stage: 0, target, entry: number[], dir}`: `state.hydro.surge = {stage: 0, target, entry, dir, reached: 0, t0: state.tick}` — exactly ARCHITECTURE §2.3 (D47): **`front` is NOT in state.** The closure's `front: Uint16Array(4096)` is filled 65535 then BFS distances (4-connected, over **all** tiles: water and land) from the entry tiles — a pure function of `entry`, so `reset` rebuilds the identical front from `surge.entry` when `surge` is non-null (a save mid-landfall resumes correctly). Readers never touch `front`: `surgeReached(state, i)` (`surge !== null && front[i] <= surge.reached`) and `surgeFrontDistance(state, i)` are the only ways out. Emit `surge:start{stage:0}`; reset `stormLog`, `surgeContacted`.
- [ ] `'stage' ft`: `surge.stage = ft`; the effective boundary stage of every water tile with `front[i] ≤ reached` is `max(base stage, surge.stage)`; the front advances: every `params.storm.frontTicksPerTile (5)` ticks since `t0`, `reached++` and every tile with `front[i] === reached` fires `surge:front{i}` (both land and water tiles — render draws foam/debris on land tiles too). Land tiles are not sources; they flood through the CA from the raised water tiles. Emit `surge:peak{stage}` the first tick `stage ≥ target`.
- [ ] Recede (weather sends decreasing `'stage'` values from set-piece tick 500): `reached` decreases 1 per `recedeTicksPerTile (4)` ticks toward 0 (weather signals recession by passing a stage lower than the previous call — track `surge.receding = true` from the first decrease).
- [ ] `'end'`: `surge = null`, all boundary stages back to `riverStage`/`bayouStage` (which weather may have set to 0), `surge:end{stage:0}`; compute `stormLog.held`.
- [ ] Between `begin` and `end` the CA runs with `dt = 1/360` from weather, so the whole 900-tick set piece is one calendar day of intake/drain while the surge floods by head difference through the raised boundary tiles. The cove behind an 8-ft crest must reach ≥ 0.5 ft at Cat 3 (T3) — this falls out of the `≥` overtopping rule; do not special-case.

**Stages (§6.9)**: `setStages(state, river, bayou)` writes `hydro.riverStage/bayouStage`; boundary reset uses them. Seepage (Spring High Water): weather owns the schedule and calls `hydro.forceSat(state, tilesWithin6OfRiver, 0.8)` daily during the window — hydro exposes `hydro.riverAdjacent(state, radius) → number[]` (cached) for it.

**Daily work (`flags.newDay`)** — in this order:
- [ ] `stand[i] = depth[i] ≥ 0.05 ? min(255, stand + 1) : 0` for land tiles.
- [ ] Overtopping integrity hits (above); clear `overtoppedToday`.
- [ ] Building flood transitions: for each non-null building: `d = footprintDepth(id)`; `threshold = pilings ? 3.0 : 0.5`; if `!flooded && d ≥ threshold` → `flooded = true`, `floodedSince = day`, emit `building:flooded{id,type,depth:d}`; if `flooded && d < threshold` → `flooded = false`, `floodedSince = −1`, `building:dried`. Buildings applies damage/closure in its own tick (which runs after hydro the same tick, so damage starts the same day).
- [ ] Drained marsh (§6.1.7): for each MARSH tile (WETLAND_ORIGINAL or not, not PRESERVE, not DRAINED): keep a private `Uint8Array dryDays` (`depth < 0.1` → ++ else 0); if `dryDays ≥ 5` and (a CANAL tile within Chebyshev 2 **or** a powered pump within 8) → set DRAINED, set RESTORING? no — set DRAINED, `mudUntilDay = day + 15` (private `Uint16Array mudDay`; wildlife reads `hydro.isMud(state, i)` — add this query), `terrain.classify(i)` (terrain sees DRAINED → type DRAINED), `terrain.touch(i,'flags')`, emit `marsh:drained{i}`, `dryDays = 0`.
- [ ] Reversion (**Tier 2 #10**, see below).
- [ ] Marsh Restoration progress (Tier 2): RESTORING tiles count 30 days then `markRestored` + `terrain.restoreToMarsh`.
- [ ] Risk cache expiry: `risk.validUntilDay ≤ day` → `risk = null`.

**Prediction (§6.1.8)** — `predictRisk(state)`:
- [ ] If `risk` is valid return it. Else: copy `depth`, `sat` into scratch Float32Arrays (allocated once in `reset`), run `params.hydro.riskSteps (40)` steps of the same CA code (parameterized to operate on the scratch buffers: write the step as a function of `(depthArr, satArr, dt, rainStep)`), with a map-wide rain of `riskInches 2` in = 0.167 ft spread over the 40 steps (`r = 0.167/40` each), `dt = 1/40`, current river/bayou stages (so the window shows), no pumps? **Include pumps and ponds** (the overlay should show what the drains do; decision) but no surge. Result `risk.depth` = the scratch depth; `validUntilDay = day + 5`; invalidated by `tile:changed`. ≤ 40 × 3 ms = 120 ms; run synchronously when requested (the overlay toggle or the ghost's "sink" line) — acceptable once per 5 days.
- [ ] `riskAt(i)` → `predictRisk()[i]`.

**Conservation (T5)** — `conservationCheck(state)`: `total = Σ depth over non-boundary tiles`; the step accumulates `leak = |Σ(depth after) − Σ(depth before) − intake + groundLoss + evap + pumped + pondTaken + boundaryExchange|`; exposed for tests. Must be < 1% of the step's moved volume.

**Queries:** `drainsTo(i)`: CANAL tile in a network that drains to water → `'Canal → Bayou'` (or `'Canal → River'`); network with a pump and no water → `'Pump {n} → Bayou'` (`n` = pump's building index order among pumps); no pump, no water → `'nowhere (standing)'`; non-canal tile within 5 of a pond → `'Pond'`; else `'ground'`. `footprintDepth(id)` = max `depth` over `buildings.footprint(id)`.

### Tier 2

- [ ] **Drained-marsh reversion** (cut #10): a DRAINED tile with `depth ≥ 0.5` for 20 consecutive days and no canal within 2 / no powered pump within 8 → clear DRAINED, `classify`, `marsh:reverted{i}`; buildings on it become flooded by the ordinary threshold.
- [ ] Marsh Restoration progress and `markRestored`.
- [ ] Bonnet Roux Spillway (§6.9): `hydro.spillway(state)`: river stage felt north of ty 40 reduced by 1 ft for the rest of the window (`state.hydro.spillwayOffset = 1`, a saved key lazily initialized to 0 in `reset`), and every Marsh/Wet tile south of ty 44 gets `depth += 1.0` once.
- [ ] Surge Barrier gate animation hooks are render's; hydro only emits `gate:*`.

## 5. Edge cases and invariants

- **No NaN, ever.** Guard: `depth` clamped ≥ 0 after every apply; `sat` ∈ [0,1]; `integrityFactor` from an integer; `loss` finite; never divide by a sum that can be 0 (scale only when `sum > 0`). `smoke.mjs` scans every typed array after a hurricane.
- No allocation in the step: all scratch arrays allocated in `reset`; the `surge:front`/`levee:overtop` payloads are the only per-event objects.
- Map edges: `nbr4` handles bounds; edge tiles are seeded into the surge BFS only through `entry` (weather passes the 8-wide edge segment tiles, which may include water and land).
- Pond tiles with `elev < 0` are type POND (terrain); the CA treats them as land (they are not boundaries).
- `owner ≥ 0` tiles are paved for absorb/drain but still hold and pass water (buildings flood).
- A Marsh tile carrying a path (`surface 1`) is *disturbed* but still Marsh for `loss`; a culvert is CANAL + surface: `kMul 8`, absorb 0.
- On load (`reset(state, false)`) and on a new game (`reset(state, true)`) alike: `reset` rebuilds `networks`, `active` (from depth), `cypressMask`, `absorbFrac/drainRate/lossTable/kMul` tables, `gateClosed` (re-evaluate from stages), the surge `front` from `surge.entry` if `surge` is non-null (a save mid-landfall), lazily initializes `heldStage/spillwayOffset`; `pondCap` is saved; `stormLog` empty (acceptable: the report of a storm saved mid-set-piece loses `held`). Hydro never draws `rng.sim`.
- No non-finite value ever in `tiles.depth/sat` or `state.hydro.*` (§10.3): `front` distances use 65535, not `Infinity`; `-1` for "no day".
- Set pieces: game/parade/graduation/montage → relaxation only; landfall → `dt = 1/360` from weather; near-miss → `dt = 1/60`. Calendar frozen → no daily work.
- Headless: identical; nothing browser-specific.
- Integrity writes: **only** the three cases above; never write `crest`, `owner`, `sandbag`.
- `Building.flooded` is written only in the daily step; `buildings.place` initializes it `false`.

## 6. selfTest() requirements

Private state via `BSU.newState(1234)`; do not call `terrain.gen` (too slow and it needs the whole module set) — build a synthetic map by writing `elev/type/flags` directly (flat 4-ft Dry land, a 2-tile-wide "bayou" strip at `elev −1` with BAYOU flag, a 3×3 basin at 1.6 ft with a 2.2 lip, a levee ring, a canal). Use a private `dt = 1/40` and call the internal `step(state, dt, rain)` function directly (export it as `BSU.hydro._step` for tests). Stub `BSU.weather.consumeRainStep` by passing `rain` explicitly to `_step`; stub `buildings` lookups by an injectable `M._deps` object defaulting to `BSU.buildings` (keep the production code path the same), and **replace `M._deps.emit` with a recorder for the duration (restored in `finally`)** — a real `levee:overtop`, `gate:closed` or `building:flooded` on the live bus would reach the live game's render_fx/buildings/progress (§10.6). "Fired" below means "present in the recorded list". Assertions with `BSU.assert` (the harness sets `BSU.SELFTEST`).

1. **T5 conservation**: 200 steps of a 2-inch map-wide rain (0.167/40 per step, then dry); after each step `conservationCheck().leak < 0.01 × moved`; no NaN.
2. **T6 levee shedding**: a levee tile (`crest 6`, `integrity 100`) with 0.3 ft on its crown between a 3.0-ft tile and a 4.0-ft tile: after ≤ 80 steps (2 days) crown depth < 0.01 and the water went to the 3.0 side; a 0.4-ft puddle on a neighbor never raises the levee tile's depth (`depth[levee] === 0` throughout).
3. **Overtopping**: a water tile at stage 8 next to a levee on a 2-ft tile (crest 8): after 20 steps the levee tile has depth > 0 and the land tile behind it has depth > 0.1; `levee:overtop` fired once; with `sandbag = 15` (crest 9.5) nothing crosses.
4. **Floodgate (T7 live half)**: a canal crossing a levee tile with the bayou at stage 0 conducts (basin water falls over 40 steps); set the stage to 1.5 → within one step `gate:closed` fired and flow across it is 0 (basin depth unchanged over 10 steps).
5. **Pump**: a 10-tile canal network with a stubbed powered pump removes 15 tile-ft over 40 steps (± 5%); with `effective → 0` it removes nothing.
6. **Pond**: 20 tile-ft capacity drains a 5-tile 0.4-ft pool within 5 (≤ 0.1 per tile per step); capacity recovers 2/day.
7. **Flood transitions**: a fake building (2×1) at 0.6 ft → daily step emits `building:flooded`; on pilings threshold 3.0 → not flooded.
8. **Drained flip**: a Marsh tile with a canal within 2 held at depth 0 → DRAINED after 5 daily steps, `marsh:drained` emitted; a PRESERVE Marsh tile never flips.
9. **Surge front**: `surgeControl('begin', {stage:0, target:5, entry:[edge tiles], dir:'S'})` then 200 `'stage'` calls ramping to 5 → `surge:start`, `surge:peak` recorded; `reached` advanced ≈ ticks/5; boundary tiles with `surgeReached(s, i)` have `depth = 5 − elev`; `state.hydro.surge` has exactly the keys `{stage, target, entry, dir, reached, t0}` (no `front`); `reset(s, false)` on a deepClone of that state rebuilds a front with `surgeFrontDistance` identical on every tile; `'end'` → `surge === null`, stages 0.
10. `predictRisk` on the basin returns depth > 0.2 at the center and 0 on the 4-ft land; cached object identity on a second call.
11. `drainsTo` strings for: canal→bayou, canal+pump no water, canal alone, tile near pond, plain tile.

≤ 200 ms: the synthetic map is small but the arrays are 4,096 — 200 steps × ~0.3 ms with an active set of ~100 tiles is fine.

## 7. Testing in isolation

```js
// scratch/test_hydro.mjs
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true; const ctx = vm.createContext(win);
const load = f => vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
load('contract.js'); load('data.js');
vm.runInContext(`
  BSU.terrain = BSU.terrain || { touch(s,i,w){ BSU.events.emit(BSU.EV.TILE_CHANGED,{i,tx:i&63,ty:i>>6,what:w,chunk:0}); }, rewalk(){}, classify(){}, setElev(s,i,v){ s.tiles.elev[i]=v; } };
  BSU.buildings = BSU.buildings || { list(){ return []; }, get(){ return null; }, footprint(){ return []; }, effective(){ return 1; }, onIntegrityChanged(){}, dirtyRing(){}, has(){ return false; } };
  BSU.weather = BSU.weather || { consumeRainStep(){ return null; } };
  BSU.wildlife = BSU.wildlife || {};
`, ctx);
load('hydro.js');
const BSU = win.BSU; const s = BSU.newState(7);
// flat 4-ft land, a 3x3 basin at 1.6 ft, bayou strip at x=10
for (let i = 0; i < 4096; i++) { s.tiles.elev[i] = 4; s.tiles.type[i] = BSU.T.DRY; }
for (let y = 30; y < 33; y++) for (let x = 30; x < 33; x++) { s.tiles.elev[y*64+x] = 1.6; s.tiles.type[y*64+x] = BSU.T.WET; }
for (let y = 0; y < 64; y++) { const i = y*64+10; s.tiles.elev[i] = -1; s.tiles.flags[i] |= BSU.FLAG.BAYOU; s.tiles.type[i] = BSU.T.BAYOU; }
BSU.hydro.seedInitial(s); BSU.hydro.reset(s, true);
BSU.events.on(BSU.EV.LEVEE_OVERTOP, p => console.log('overtop', p));
s.weather.dtDay = 1/40;
for (let k = 0; k < 40; k++) BSU.hydro._step(s, 1/40, { r: 0.167/40, mapWide: true });
console.log('basin center depth', s.tiles.depth[31*64+31].toFixed(3), BSU.hydro.conservationCheck(s));
console.log(BSU.hydro.selfTest());
```

With terrain and weather present, run `node test/smoke.mjs` and watch `floodedTiles` in the snapshots: it should be 0 before the hurricane and > 0 right after `forceHurricane(3)`, then fall over the following weeks.

## 8. Performance budget

- ≤ 3 ms per step (≤ 1.2 ms/tick averaged at 4 steps per 10 ticks); full-map rain worst case ≤ 8 ms (4,096 × 4 neighbors × 2 passes ≈ 33k neighbor ops: keep the inner loop on typed arrays with precomputed `crestTop` per tile per step — compute `crestTopArr[i]` once per step in a first pass, then the two flow passes read it).
- Zero allocation inside `_step`. Active set as a `Uint8Array` mask plus a `Uint16Array` list rebuilt per pass.
- Daily step ≤ 2 ms (building transitions are O(buildings × footprint)).
- `predictRisk` ≤ 150 ms, at most once per 5 days or per tile change when the overlay is open (ui debounces the overlay to one recompute per 500 ms).

## 9. Done means

- `selfTest().ok`; the isolation script shows the basin filling to ~0.3–0.4 ft after a 2-inch rain on `sat 0.5` land and conservation leak < 1%.
- With the full build: `node test/smoke.mjs` passes (no NaN after a Cat 3; save/load identical); `floodedTiles` rises during the set piece and the cove floods without a levee; the tutorial canal (Objective 4) drains the cove within ~5 calendar days.
- GDD §6.1.11 T1–T8 are reproducible with the debug panel: T2 (crown dry in any rain; shoulder floods at Cat 2), T3 (ring + pump holds at Cat 2; overtopped at Cat 3 without sandbags; holds with them), T7 (a healthy gate conducts at stage 0 and closes at > 1).
- Per-tick cost within budget under `node test/browser.mjs --fps` during a landfall.
