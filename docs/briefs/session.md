# Brief: `src/js/session.js` → `BSU.session`, `BSU.state`, `BSU.headless`, the boot and the main loop

Read first: `docs/HEADLESS_API.md` and `test/smoke.mjs` (**authoritative** for the headless surface; read `test/domstub.mjs` too — it is the environment you boot in), `docs/TESTING.md`, `docs/ARCHITECTURE.md` §1 (row 19; the load/init/reset/tick order rule), §2 (the whole state tree: you copy it on load), §2.1 (`v, seed, tick, playSeconds, setPiece, saveMeta, rng`), §3.1 (`BSU.SAVE_VERSION`, `BSU.SAVE_SKIP`), §3.3 (`rng.sim` state in/out), §3.4 (`setpiece:*`, `speed:changed`, `save:*`), §3.5 (`b64`, `deepClone`, `headlessMode`, `error`), §5.1 (the tick table — `tick1` is this table), §8 (save/load/migrate/autosave/slots — all of it), §9 (boot, charter, the loop, `skipTutorial`, `BSU.headless`, the API summary — all of it), §10.1 (error policy), §10.2 (determinism), §10.3 (no non-finite value anywhere in the live tree), §10.4, §10.6 (the `session.selfTest` exemption), D2, D3, D7, D13, D16, D20–D23, D37, D39, D40, D42, D48, D49, D51, D56, D57; `docs/GDD.md` §0.1 (timing), §9.1 (event time), §9.4 (speed rules), §15.1–15.2 (one file, the contract, `skipTutorial`, the headless API, `BSU.state`), §10.1 (title/charter), §11.6 (title, Continue).

---

## 1. Purpose and public surface

The root: owns `BSU.state`, boots every module in manifest order, runs the fixed-step loop in a browser, executes one sim tick (`tick1`) in the §5.1 order with per-module try/catch, owns set-piece start/end and the speed setting's effects, saves/loads/migrates/autosaves, implements `newGame` (with `skipTutorial`) and the entire `BSU.headless` API. It is the **last** file in the manifest and runs `boot()` synchronously at the end of its own IIFE.

```js
BSU.session.newGame({seed, skipTutorial = false, title = false}) → state
BSU.session.save(slot) → string            // JSON; also localStorage['bsu.save.' + slot] (try/catch) + the in-memory map + 'bsu.last'
BSU.session.load(slot) → state | null
BSU.session.continue_() → state | null     // loads 'bsu.last'
BSU.session.setSpeed(state, speed, reason: 'user'|'setpiece'|'cone'|'warning'|'restore'|'receiver') → void
BSU.session.restoreSpeed(state, reason) → void
BSU.session.startSetPiece(state, kind, {len, skippable}) → boolean
BSU.session.endSetPiece(state) → void
BSU.session.skipSetPiece(state) → void      // dispatches to the owner: weather (landfall), sports (game/montage), progress (parade/graduation); nearMiss: jump to the end
BSU.session.tick1() → void
BSU.session.skipToDate(state, 'Aug 5', yearOffset = 0) → void   // ticks forward, bounded by 2 years (24,000 ticks), with autosave off
BSU.session.slots() → {slot, savedAt, label}[]
BSU.session.deleteSlot(slot) → void
BSU.session.migrations = { 1: (doc) => doc }
BSU.session.boot() → void                    // called once at the end of the file
BSU.session.loopRunning → boolean
BSU.state                                    // the live root
BSU.headlessMode                             // finalized here: BSU.headlessMode = BSU.headlessMode || !!window.BSU_FORCE_HEADLESS
BSU.headless = { tick(n), render(), snapshot(), findSpot(id), place(id, x, y), forceHurricane(cat), click(px, py), key(name), fastForwardDays(n), state(), autosave: false }
```

Module shape: `'use strict'` IIFE, `const M = (BSU.session = BSU.session || {})`, `selfTest`; `init/reset/tick` are not needed on session itself (it is the caller). **No DOM/timers/RAF at definition time** — `boot()` runs at the end of definition but only reads `document.getElementById('app')` inside a try/catch and calls `requestAnimationFrame` only in a browser.

## 2. State fields

**Writes (owner):** `state.seed`, `state.tick`, `state.playSeconds`, `state.setPiece`, `state.saveMeta`, `state.rng.sim` (copied from `BSU.rng.sim.state` after every tick), `state.calendar.frozen` (step 0), `state.economy.ecology` (the mirror, step 10), `state.ui.speed/speedBefore` (through `setSpeed/restoreSpeed`). Replaces `BSU.state` wholesale on `newGame`/`load`.

**Reads:** everything for `snapshot`; module APIs for `findSpot`/`place`/`forceHurricane`/`click`/`key`.

Private: `modules` (the manifest order list of `BSU.<name>` objects: `['data','terrain','hydro','weather','wildlife','buildings','economy','agents','sports','sprites','render','ui','audio','progress']` — split files share their object, so they are not listed twice), `simOrder = ['weather','terrain','hydro','buildings','wildlife','agents','economy','sports','progress']`, the in-memory slot map `Map<slot, json>`, `acc`, `last`, `hitStopUntil`, `deferredAutosave`, `booted`.

## 3. Events

**Emits:** `setpiece:start/end/skip{kind, len}`; `speed:changed{speed, prev, reason}`; `save:written{slot, bytes}`; `save:loaded{slot, version, migrated}`.

**Listens (owner `'session'`):** `storm:report`? no. `visibilitychange` (DOM, browser only: hidden → autosave); `window.resize` is render's. Nothing else: session drives by direct calls.

## 4. Rules checklist

### Tier 1

**Boot (ARCHITECTURE §9.1)**
- [ ] `BSU.headlessMode = BSU.headlessMode || (typeof window !== 'undefined' && !!window.BSU_FORCE_HEADLESS)`; under `test/domstub.mjs` it is true (D3).
- [ ] `boot()`: 1) `BSU.state = BSU.newState(0)`; 2) for each module in manifest order with `init`: `try { m.init(BSU.state) } catch (e) { BSU.error('session', 'init:' + name, e) }` (data has no `init`); 3) settings: `JSON.parse(localStorage['bsu.settings'])` in try/catch → merge into `BSU.state.ui.settings` defaults → `audio.applySettings`; `BSU.rng.fx.state = (Date.now() ^ 0xF0F0F0F0) >>> 0` in a browser (`0xF0F0F0F0` headless) — reseeded **in place**, the Stream object is never replaced (D39); 4) browser: `newGame({seed: random uint32 (from Date.now() ^ Math.random()*2^32 — the one allowed `Math.random`, for the title seed only), title: true})` → the title world: speed 0? **The title world ticks at 10 tps** (ARCHITECTURE §9.3 "title: 0 unless title world (10)") with `calendar.running = false`, `sky` forced to NIGHT (`weather.scriptSky(NIGHT, .3)`), `progress.tutorialStage = 0`, `render.titleDrift = true`, `ui.showTitle(true)` with Continue enabled if `localStorage['bsu.last']` exists (try/catch); headless: nothing more; 5) `if (typeof requestAnimationFrame === 'function' && !BSU.headlessMode) requestAnimationFrame(loop)`.
- [ ] Any throw inside `boot` is caught per step (`BSU.error`) so `BSU.session`/`BSU.headless` exist even if a module's `init` fails (the smoke test asserts their existence first).

**`newGame(opts)` (ARCHITECTURE §9.1, §9.4)**
- [ ] In exactly this order: `seed = (opts.seed >>> 0) || randomUint32()`; `state = BSU.newState(seed)`; **`BSU.state = state` immediately** (before generation, so `BSU.rng.derive('reroll', k)` inside `terrain.gen` mixes THIS seed and not the previous game's — D40); `BSU.rng.sim.state = state.rng.sim` (reseed **in place**; never `BSU.rng.sim = BSU.rng.make(…)` — D39); `terrain.gen(state, seed)` (it sets `BSU.rng.world.state = seed` itself); every module's `reset(state, true)` in manifest order (try/catch each; `fresh === true` is the only signal that this is a new game — D37); `state.ui.settings` = the persisted settings (settings survive new games); title world: as above (no objectives; `progress.tutorialStage = 0`); normal tutorial: `progress.tutorialStage = 1` and `progress` drives the swoop/charter (speed 1, `calendar.running = false`); `skipTutorial`: see below. Returns `state`. Emits nothing (`save:loaded` is for loads only).
- [ ] **`skipTutorial`** (D28, §9.4; the fixed order): after `reset`s: `buildings.place(state, 'founders_hall', plot.founders.tx, plot.founders.ty, {rot: 0, ignoreCash: true, instant: true})`; the G3 path: `route = BSU.terrain.landRoute(state, frontTile, plot.landingShoulder)` where `frontTile = idx(plot.founders.tx + 1, plot.founders.ty + 3)` — **the only function that lays this path** (the G3 BFS over land tiles of any type, bare Marsh included; `agents.routeSync` is never used here: its walk grid cannot cross bare Marsh, so the route would never be laid and `tiles.surface[plot.landingShoulder]` would stay 0 — D57), then `buildings.placeRun(state, 'path', route, {ignoreCash: true})`; `weather.setRunning(state, true)`; `setSpeed(state, 1, 'user')`; `progress.tutorialStage = 6` **before** `progress.reset`? No — `reset` already ran; set the stage then call `progress.applySkipTutorial(state)` (progress marks 1–5 done without grants, introduces tabs; it queues **no** cell — the Apr 4/5 date handlers are the single source of the scripted cell, D57); `economy.setSuspendCapPenalties(false)`, `economy.setSuppressCoverage(false)`; `economy.addStudents(state, 120, 'founding')` (emits `econ:stat` only, no enroll event — D53) then `agents.regenerate(state)` (44 agents at Founders'; no pirogues, no `agent:arrive`); `state.ui.speed = 1`. Cash stays 4,000,000 (free placements).
- [ ] Two `newGame({seed: 42, skipTutorial: true})` calls produce identical `snapshot()`s after the same `tick(n)` (determinism).

**Main loop (ARCHITECTURE §9.3, D7)** — browser only:
- [ ] ```js
  function loop(now) {
    const dtMs = Math.min(100, (now - last) || 16.67); last = now;
    const s = BSU.state;
    const tps = s.setPiece ? 10 : (titleWorld ? 10 : s.ui.speed * 10);
    if (tps > 0 && now >= hitStopUntil) { acc += dtMs * tps / 1000; if (!titleWorld) s.playSeconds += dtMs / 1000; }
    let n = 0; while (acc >= 1 && n < params.time.maxTicksPerFrame) { tick1(); acc -= 1; n++; }
    if (n === params.time.maxTicksPerFrame) acc = Math.min(acc, 1);
    const alpha = tps > 0 ? Math.min(1, acc) : 0;
    render.frame(s, alpha, dtMs); ui.update(s, dtMs); audio.update(s, dtMs);
    requestAnimationFrame(loop);
  }
  ```
  (each of `render.frame/ui.update/audio.update` in its own try/catch). `hitStopUntil` is read from `render.hitStopUntil`. The debug time-lapse `setSpeed(20)` is capped by `maxTicksPerFrame 8` per frame.
- [ ] `playSeconds`: browser = wall-clock seconds of unpaused play; headless = `tick / 10` (`tick1` adds 0.1 when `BSU.headlessMode`).

**`tick1()` (ARCHITECTURE §5.1 — the order is law)**
- [ ] Step 0: `const s = BSU.state; s.calendar.frozen = !s.calendar.running || s.setPiece !== null;`
- [ ] Step 1: `flags = weather.tick(s)` (try/catch → on throw use `{newDay:false, newMonth:false, newYear:false, newSemester:false, day: s.calendar.day}`).
- [ ] Steps 2–9: `terrain.tick(s, flags)`, `hydro.tick(s, flags)`, `buildings.tick(s, flags)`, `wildlife.tick(s, flags)`, `agents.tick(s, flags)`, `economy.tick(s, flags)`, `sports.tick(s, flags)`, `progress.tick(s, flags)` — each `try { } catch (e) { BSU.error(name, 'tick', e) }`.
- [ ] Step 10: if `s.setPiece`: `if (s.setPiece.tick + 1 >= s.setPiece.len) endSetPiece(s); else s.setPiece.tick++`. If `flags.newMonth` → autosave rules (§8.4): browser always; headless only when `BSU.headless.autosave`; never mid-set-piece (set `deferredAutosave = true`, done in `endSetPiece`). `s.rng.sim = BSU.rng.sim.state`. `s.economy.ecology = s.wildlife.ecology`. `s.tick++`. Headless: `s.playSeconds += 0.1`.
- [ ] Nothing in `tick1` reads the wall clock.

**Speed (D7; GDD §9.4)** — `setSpeed(s, speed, reason)`: `prev = s.ui.speed`; for reasons `'cone'|'warning'|'setpiece'|'receiver'` remember `s.ui.speedBefore = prev` (only if not already remembered for a pending restore of the same reason); write `s.ui.speed = speed` (any non-negative number; the UI offers 0/1/2/4; 20 for the debug time-lapse); emit `speed:changed{speed, prev, reason}`. `restoreSpeed(s, reason)`: `setSpeed(s, s.ui.speedBefore, 'restore')`. The title world ignores `ui.speed`.

**Set pieces (D13; ARCHITECTURE §2.1, §9.3)** — `startSetPiece(s, kind, {len, skippable})`: refuse (`false`) if `s.setPiece` exists; `s.setPiece = {kind, tick: 0, len, skippable: !!skippable, choices: {}, speedBefore: s.ui.speed, cameraTouched: false}`; `setSpeed` is not changed (the loop uses 10 tps during a set piece) but remember `speedBefore` for the restore: `s.ui.speedBefore = s.ui.speed`; emit `setpiece:start{kind, len}`; return true. The owner scripts the sky. `endSetPiece(s)`: `const kind = s.setPiece.kind; s.setPiece = null; weather.releaseSky(s); restoreSpeed(s, 'setpiece')` (→ `speedBefore`); emit `setpiece:end{kind, len}`; run a deferred autosave. `skipSetPiece(s)`: only when `skippable && tick ≥ params.time.skipAfterTick (150)` (games: ≥ 200 per sports; the owner enforces its own threshold): dispatch `weather.skipSetPiece` / `sports.skipToFinal` / `progress.skipSetPiece(s)` (parade/graduation: set `tick = len − 1`) / nearMiss: `tick = len − 1`; emit `setpiece:skip`.
- [ ] `len` values: landfall 900, nearMiss 150, game 750, parade 250, graduation 150, montage 50 (`params.time.*Ticks`).

**Save (§8.1; D20, D23)** — `save(slot)`:
- [ ] Pre-scan: walk the state (skipping `SAVE_SKIP` paths and `agents/vehicles`) for non-finite numbers. **There is no value translation of any kind**: open-ended timers are `untilDay: -1` in the live state already (D23) and `Infinity`/`NaN` must never exist anywhere in `BSU.state` (§10.3 — the smoke test scans the live tree). Any non-finite value found → `BSU.error('session', 'save:nonfinite:' + path)` once and write `0` for it in the doc so `save` still returns a string (never fail the save; the error surfaces under `browser.mjs` and fails `modules.mjs` under `BSU.SELFTEST`).
- [ ] Build `doc` **structurally** (§8.1, D48): header `{v: 1, app: 'bayou-state', savedAt: headless ? 0 : Date.now(), label}` + `seed, tick, playSeconds, setPiece, saveMeta, rng: {sim}` + `BSU.deepClone` of **every** saved branch (`calendar, sky, weather, storms, plot, hydro, veg, buildings (with nulls), runNames, gators, wildlife, economy, ledger, sports, progress, ticker, ui`) with `tiles` written as `{name: BSU.b64.encode(array)}` for the 16 `BSU.TILE_ARRAYS`, then delete every path in `BSU.SAVE_SKIP` (`agents`, `vehicles`, `hydro.networks/risk/active`, `wildlife.campusMask`, `ui.tool/panel/perfMode`, `ui.camera.tx/ty`). **Session never keeps a per-branch key list**: every other enumerable key of every saved branch is written, including keys lazily added by their owners (`hydro.heldStage/spillwayOffset`, `wildlife.sick/beadsDay/burrowLog`, `progress.forceFirefliesDay/drainedEver/failure.pendingKind`, `economy.attritionBonus/pendingDisaster/admittedSinceLock/cancelledSemester`, …) and keys this document does not know yet. Timers are written exactly as live (`untilDay -1` stays `-1`); `gators[].px/py/route` may be stripped (not saved).
- [ ] `json = JSON.stringify(doc)`; in-memory map `slots.set(slot, json)`; `try { localStorage.setItem('bsu.save.' + slot, json); localStorage.setItem('bsu.last', slot) } catch { ui.hint('saveUnavailable', …) once }`; `state.saveMeta = {slot, savedAt, label}` — **after** building the doc? The smoke test compares `snapshot()` before/after load, and `snapshot` does not read `saveMeta`, so writing `saveMeta` after the save is fine; but `save` must not otherwise mutate state (no `rng` draws). Emit `save:written{slot, bytes}`. Return `json`. ≤ 40 ms.
- [ ] Autosave rotation: `auto.((n + 1) % 3)` where `n` = the last auto index (from `saveMeta.slot` or a private counter); `label = formatDate(day)`.

**Load (§8.2–8.3)** — `load(slot)`:
- [ ] `json = localStorage.getItem('bsu.save.' + slot)` (try/catch) `?? slots.get(slot)`; missing/unparsable → `null` (+ `ui.notify` in a browser). `doc = JSON.parse(json)`; `migrate(doc)`: while `doc.v < BSU.SAVE_VERSION` apply `migrations[doc.v]`, `doc.v++`; `doc.v > SAVE_VERSION || doc.app !== 'bayou-state'` → refuse: `null` + `ui.card(BSU.state, 'versionMismatch', {seed: doc.seed})` (browser; the string id resolves through `BSU.ui.cards.versionMismatch`, D45).
- [ ] `state = BSU.newState(doc.seed)`; copy: typed arrays decoded **into the preallocated arrays** (`BSU.b64.decode(str, Ctor)` then `.set`), plain branches replaced wholesale then **missing keys filled from the fresh tree's defaults** (a recursive `fillDefaults(target, defaults)` so a partial/old save has every field) and **keys present in the doc but unknown to `newState` are kept** (lazily-added owner keys survive a round trip); **no value translation** (`timers[].untilDay -1` stays `-1`, D23); `buildings` nulls kept; `agents = []`, `vehicles = []`; `hydro.networks/risk/active = null`; `wildlife.campusMask = null`; `ui.tool = null`, `ui.panel = null`, `ui.perfMode = false`, `ui.camera.tx/ty` cleared; `ui.settings` = the persisted settings (not the save's? The save carries `settings`; the persisted file wins — decision).
- [ ] `BSU.state = state`; `BSU.rng.sim.state = state.rng.sim` (in place, D39); every module `reset(state, false)` in manifest order (`fresh === false`: modules rebuild caches only — weather draws no rain days and leaves `calendar.running` alone, wildlife spawns nothing, hydro rebuilds the surge front from `surge.entry`; agents regenerate inside their reset); `state.saveMeta.slot = slot`; emit `save:loaded{slot, version: doc.v, migrated}`; browser: `ui.showTitle(false)`; return `state`. ≤ 150 ms.
- [ ] **Snapshot identity**: `JSON.stringify(snapshot())` before `save` equals after `load` (the smoke test). `snapshot` reads **only saved fields and pure functions of saved fields**: its `agents` field is `BSU.agents.count(state)` (the D15 formula over `economy.students`), **never `state.agents.length`**, which lags arrivals (agents are created when the vehicle lands), attrition/graduation (economy runs after agents in the tick) and the daily reconcile (§5.8, D42); rounding per D8. An optional `agentsLive: state.agents.length` may be added for debugging only if the smoke comparison is unaffected — it is not, since the smoke test compares the whole object, so **do not add it**.
- [ ] `continue_()` = `load(localStorage['bsu.last'])`; `slots()` = the six named slots with `savedAt/label` parsed from each stored doc's header (read only the first 200 chars? Parse fully — six small parses are fine) plus any in-memory ones; `deleteSlot`.

**`BSU.headless` (§9.5; HEADLESS_API.md)** — always defined, also in browsers:
- [ ] `tick(n)`: `for (k < n) tick1()`; no rendering; set pieces included (they advance at one tick per call).
- [ ] `render()`: `render.frame(state, 0, 16.67); ui.update(state, 16.67)` (each try/catch; `audio.update` too — harmless).
- [ ] `snapshot()`: `{year, month, day: dom, tick, cash, students, prestige: round(prestige×100)/100, happiness: …, ecology: …, buildings: non-null count, agents: BSU.agents.count(state) /*NOT state.agents.length, §8.2*/, gators: gators.length, floodedTiles: hydro.floodedTiles(state), floodedBuildings: hydro.floodedBuildings(state).length, storm: storms.current ? {name, cat, phase} : null, speed: ui.speed}` — plain numbers/strings only.
- [ ] `findSpot(id)` (D21): footprint rows: spiral outward from `plot.founders` over Chebyshev rings 0…40 (ring order, then the ring's tiles in a fixed clockwise order) testing `buildings.canPlace(state, id, tx, ty, {rot: 0, ignoreCash: true}).ok`, then the same spiral with `{rot: 1}` if the row is rotatable; drag/paint rows: the same spiral over single tiles with `canPlace(id, tx, ty, {rot: 0, ignoreCash: true})`; `'pilings'`: the first building (by id) without pilings that `canPlace('pilings', b.tx, b.ty, {target: b.id}).ok` → its origin; return `{x, y}` of the first ok, else `null`. Must find spots for the smoke list on seed 42 (`path, dorm, lecture_hall, dining_hall, substation, water_tower, levee, canal, pump, quad, live_oak, gator_fence`): the crown holds a dorm/lecture hall/dining hall next to the tutorial path; the substation/tower fit on the shoulder; levee/canal/fence single tiles are legal almost anywhere on land; the pump needs a canal edge — `findSpot('pump')` after `place('canal')` finds one adjacent to the placed canal tile (the spiral passes it) — if none, `null` is acceptable (the test only needs ≥ 4 placements).
- [ ] `place(id, x, y)`: `buildings.place(state, id, x, y, {rot: 0})` → `{ok, reason}` (charges cash; drag rows place one tile; `'pilings'` → `buildings.retrofitPilings(buildings.at(x, y).id)`).
- [ ] `forceHurricane(cat)`: `weather.spawnStorm(state, {cat: clamp(cat, 1, 5), coneNowTick: state.tick, landfallTick: state.tick + 600, compressed: true})` (`compressed` is REQUIRED and explicit, D51: tick-driven lifecycle — watch +300, bands +500, set piece at +600 for 900 ticks; Célestine marked done — weather does it); returns the Storm.
- [ ] `click(px, py)`: `const M = {ctrl: false, shift: false, meta: false, alt: false}; ui.pointer('down', px, py, 0, M); ui.pointer('up', px, py, 0, M)` (button 0 = left; the mods object always carries all four booleans, D56). `key(name)`: `ui.keydown(name, {ctrl: false, shift: false, meta: false, alt: false, code: name.length === 1 ? undefined : name})` — so `key('Backquote')` reaches the debug binding (matched on `mods.code === 'Backquote' || key === '`'`) and `key('`')` does too. `fastForwardDays(n)` = `tick(n × 100)`. `state()` = `BSU.state`. `autosave = false`.
- [ ] `skipToDate(state, dateStr, yearOffset)`: target day = `weather.dayOf(dateStr, yearOffset)`; if `≤ today` add a year; tick until `calendar.day === target` or 24,000 ticks; autosave suppressed during; set pieces run through (skippable ones are skipped).

**Charter → first frame (§9.2)**: ui's charter button calls `audio.unlock()`, `ui.showTitle(false)`, `session.newGame({seed})`; session sets `titleWorld = false`; progress runs the swoop and the charter card (stage 1). `visibilitychange` → hidden: autosave (browser only, not during a set piece).

### Tier 2

- [ ] Save compression (not needed: ~300 KB), multiple migrations, the `title:true` world's campus thumbnail after Flagship (`render.thumbnail`).

## 5. Edge cases and invariants

- `BSU.session` and `BSU.headless` must exist even if every other module's `init` throws (wrap everything; define the objects **before** `boot()`).
- `tick1` never throws (every step wrapped); `state.tick` always increments; `rng.sim` state copied every tick so a save mid-play resumes deterministically.
- Never call `requestAnimationFrame`, `setTimeout`, `performance.now()` for game logic in headless mode; `undo`'s wall-clock window is ui's/buildings' (ticks headless).
- `newGame` during a running game replaces `BSU.state`; modules must not keep the old root (their `reset(state, fresh)` handles it; query functions called during `terrain.gen` self-heal on `cacheRoot !== state`, §1/D38); `BSU.events.clear` is **not** called (listeners were registered once in `init` and read `state` from the argument).
- `load` of a save written mid-set-piece resumes at `setPiece.tick`; `speedBefore` restored at its end.
- `save` inside a `tick1` (autosave) happens after `economy.tick` and before `state.tick++`? The table puts autosave in step 10 after the ecology mirror — do it **after** `s.tick++` so the saved tick is the completed one (decision; `snapshot` identity is unaffected).
- `snapshot()` must not mutate state and must not call anything that draws `rng.sim`; it never reads `state.agents`.
- Non-finite guard: after `tick1` in **selfTest only**, a scan like `smoke.mjs`'s `scanNumbers` runs on a private game; in production no scan (cost).
- Headless `newGame` must not touch `localStorage` except through the settings read (in try/catch).
- The title world: `progress` idle, `weather` sky only, agents none (0 students), gators/birds/fireflies alive; `tick1` runs normally with `calendar.running = false`.

## 6. selfTest() requirements

Runs after `test/modules.mjs` has booted a game (so modules exist). **Exemption (ARCHITECTURE §10.6, D49):** `session.selfTest` may take ≤ 3 s and it swaps the live game; `test/modules.mjs` runs it LAST (it sorts `session` to the end — keep `BSU.session` the last selfTest-bearing key assigned). Protocol: `save('__selftest_backup')` (in-memory slot), then **inside `try { … } finally { load('__selftest_backup'); deleteSlot('__selftest_backup'); }`** run the checks on a fresh `newGame` — the `finally` guarantees the live game comes back even when a check throws (the harness sets `BSU.SELFTEST = true`, so `BSU.assert`/`BSU.error` throw). Checks:

1. `newGame({seed: 1234, skipTutorial: true})` → `snapshot().students === 120`, `cash === 4000000`, `buildings === 1` (Founders'), `speed === 1`; the tutorial path exists (`tiles.surface[plot.landingShoulder] === 1`).
2. `tick(300)` → no non-finite number anywhere (a `scanNumbers` copy); `tick === 300`; `calendar.day === 3`.
3. Save → load → `JSON.stringify(snapshot())` identical; `tiles.elev` bit-identical; an open-ended timer round-trips **unchanged**: `progress.addTimer(state, '__t', 1, -1)` before saving → after load `progress.timer(state, '__t').untilDay === -1` (and `Number.isFinite` for every timer's `untilDay`); remove it after. The saved JSON string contains no `Infinity`/`NaN` token.
4. Determinism: two fresh `newGame({seed: 77, skipTutorial: true})` + `tick(500)` runs give identical snapshots and identical `rng.sim` state.
5. `setSpeed(2, 'user')` then `startSetPiece('nearMiss', {len: 150})` then `tick(150)` → the set piece ended, `ui.speed === 2`, `setpiece:start/end` each fired once.
6. `forceHurricane(3)` + `tick(700)` → `snapshot().storm.phase` is LANDFALL (5) during the set piece; after `tick(1000)` more the set piece is over.
7. `findSpot('dorm')` non-null and `place` ok on the fresh game; `findSpot('nope')` → `null` without throwing.
8. `migrate({v: 1, app: 'bayou-state'})` unchanged; `{v: 2}` refused (`load` returns `null`); `{v: 1}` without `app` refused.
9. `slots()` lists `'__selftest_backup'` while it exists; `deleteSlot` removes it.
Budget ≤ 3 s under the §10.6 exemption (three `newGame`s + ~2,600 ticks); if a check cannot fit, reduce the hurricane check to asserting `spawnStorm` returned a Storm with `compressed === true` and `landfallDay === day + 6` — never drop the save/load identity or the `-1` timer round-trip.

## 7. Testing in isolation

Session is the integrator: its isolation test **is** the harness. With every module present:
```sh
node build.mjs --check && node test/smoke.mjs && node test/modules.mjs
node test/smoke.mjs --long
node test/browser.mjs --wait 4000 --eval "JSON.stringify(BSU.headless.snapshot())" --shot /tmp/title.png
node test/browser.mjs --wait 2000 --click 640,400 --wait 6000 --eval "BSU.session.newGame({seed:42, skipTutorial:true}) && BSU.headless.fastForwardDays(30) && JSON.stringify(BSU.headless.snapshot())" --shot /tmp/game.png --fps
```
Before the other modules exist, session can be loaded with stubs to test save/load/migrate/loop math:
```js
// scratch/test_session.mjs — session + contract + data with stub modules
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true; const ctx = vm.createContext(win);
const load = f => vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
load('contract.js'); load('data.js');
vm.runInContext(`
  const stub = (name, extra = {}) => { BSU[name] = Object.assign({ init(){}, reset(){}, tick(s, f){ return f; } }, extra); };
  stub('terrain', { gen(s, seed){ s.plot.founders = {tx: 50, ty: 7}; s.plot.landingShoulder = 40*64+40; s.plot.highway = [52]; }, landRoute(){ return [52, 116]; } });
  stub('hydro', { floodedTiles(){ return 0; }, floodedBuildings(){ return []; } });
  stub('weather', { tick(s){ s.calendar.dayTick++; const nd = s.calendar.dayTick >= 100; if (nd) { s.calendar.dayTick = 0; s.calendar.day++; } return {newDay: nd, newMonth: nd && s.calendar.day % 10 === 0, newYear: false, newSemester: false, day: s.calendar.day}; }, setRunning(s,on){ s.calendar.running = on; }, releaseSky(){}, scriptSky(){}, spawnStorm(s,o){ if (o.compressed !== true) throw new Error('compressed must be explicit'); s.storms.current = {name:'Test', cat:o.cat, phase:2, compressed:true}; return s.storms.current; }, dayOf(){ return 0; } });
  stub('wildlife'); stub('buildings', { place(){ return {ok:true, id:0, cost:0}; }, placeRun(){ return {ok:true, placed:2, cost:0, skipped:[]}; }, canPlace(){ return {ok:true}; }, at(){ return null; }, retrofitPilings(){ return {ok:true}; } });
  stub('economy', { addStudents(s,n){ s.economy.students += n; }, setSuspendCapPenalties(){}, setSuppressCoverage(){} });
  stub('agents', { regenerate(s){ s.agents = Array.from({length: Math.min(300, 40 + Math.floor(s.economy.students/25))}, (_, i) => ({id: i})); }, count(s){ return s.economy.students > 0 ? Math.min(300, 40 + Math.floor(s.economy.students/25)) : 0; } });
  stub('sports'); stub('sprites'); stub('render', { frame(){}, hitStopUntil: 0 }); stub('ui', { update(){}, showTitle(){}, pointer(){}, keydown(){ return false; }, hint(){}, notify(){}, card(){} }); stub('audio', { update(){}, applySettings(){} });
  stub('progress', { applySkipTutorial(){}, addTimer(s,id,v,d){ s.progress.timers.push({id, value:v, untilDay:d}); }, removeTimer(s,id){ s.progress.timers = s.progress.timers.filter(t => t.id !== id); } });
`, ctx);
load('session.js');
const BSU = win.BSU; const H = BSU.headless;
BSU.session.newGame({ seed: 42, skipTutorial: true }); H.tick(1500);
const a = JSON.stringify(H.snapshot()); const json = BSU.session.save('t'); BSU.session.load('t'); const b = JSON.stringify(H.snapshot());
console.log(a === b ? 'roundtrip ok' : 'MISMATCH\n' + a + '\n' + b, json.length, 'bytes', BSU.session.selfTest());
```

## 8. Performance budget

`tick1` overhead ≤ 0.05 ms (the calls + the try/catch frames); `save` ≤ 40 ms (base64 of 16 arrays ≈ 100 KB + a 300-KB stringify); `load` ≤ 150 ms + chunk re-bake amortized; the loop never runs more than 8 ticks per frame and never accumulates a backlog after a stall (`acc` capped at 1).

## 9. Done means

- `node build.mjs --check && node test/smoke.mjs && node test/modules.mjs` all pass (`ALL OK`), and `node test/smoke.mjs --long` too.
- Determinism: two headless runs with the same seed and `place` calls produce identical snapshots.
- In Chrome/Safari from `file://`: the title world animates at Night; Continue loads the last save; the charter click starts the tutorial; `Ctrl/Cmd+S` writes `bsu.save.manual.0`; autosave rotates through `auto.0–2` on the 1st of each month and on tab hide; a save from a newer version is refused with the "start fresh with the same seed" card; a set piece runs at exactly 10 ticks per real second whatever the speed setting; the previous speed comes back afterward; the loop survives a 3-second stall without a backlog burst.
- No `console.error` during boot, a tutorial, a landfall, a game, a save/load cycle under `node test/browser.mjs`.
