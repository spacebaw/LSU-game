# Brief: `src/js/render_fx.js` → extends `BSU.render` (particles, weather FX, tint/lights/fog passes, overlays, minimap, postcard, perf guardrail)

Read first: `docs/briefs/render.md` (the pipeline you plug into: `registerPass`, `drawList`, `view`, `ghostSpec`, `flash`, `perfMode`), `docs/ARCHITECTURE.md` §1 (row 14), §3.2 `params.render` (`rainLines [300,1200]`, `rainLinesHalf 400`, `particlesMax 2500`, `particlesLow 800`, `lightsMax 250`, `lampEveryRoad 4`, `lampEveryPath 6`, `shakeMs {…}`, `shakePx 6`, `tint {…}`, `fireflyHalfCap 300`, `postcard [1600,1000]`, `overlayFadeMs 150`, `perfFrameMs 25`, `perfFrames 60`, `minAgentsDrawn 120`), §3.4 (every event you emit FX for), §6.3 passes 5–10, §6.4 (particles — copy the pool spec), §6.5 (guardrail reaction), §7.1 (`#minimap` canvas, `#obj-portrait`, palette `canvas.icon`), §11.2 #1, #2, #8; `docs/GDD.md` §12.4 (lights), §12.5 (weather effects — every number), §12.6 (animation list), §12.7 (particles and juice), §12.8 (the acceptance table), §11.1 (minimap, overlays, legend), §11.6 (postcard 1600×1000 with wordmark), §6.2 (cone, surge front look, sheet/gush, tumbling debris), §6.4 (haze dots ≥ .3, dense ≥ .6), §6.7 (fireflies count, egrets), §1 (the screenshot moment: what the frame must contain), §13 (nothing; audio is separate), §15.3 (0.5× rules, guardrail).

---

## 1. Purpose and public surface

Everything drawn after the entities: screen-space weather, the sky/storm tint, the additive lights, fog, the six overlays, the ghost/flash/cursor/cone, the minimap, the postcard export, the particle pool and its event-driven emitters, the crowd shader, and the guardrail's reaction. Registered on `BSU.render` at definition time (plain functions), created in `render.init` (render calls `BSU.render._fxInit(state)` at the end of its own `init` — **decision**: render_fx exposes `_fxInit/_fxReset` and render calls them; this keeps one `init` per module).

```js
BSU.render.particles = { emit(type, wx, wy, n = 1, opts = {}), count(), clear(), forEachWorld(fn) }   // opts {vx, vy, vz, life, size, color, z, spread, screen}. forEachWorld(fn: (x, y, z, size, colorIdx, type) => void) visits every live WORLD-space particle (screen === false) in pool order — render.js calls it once per frame in pass 4 and inserts each as a rank-3 draw-list entry (D50). The pool arrays are private (no `pool` export; render never reads them)
BSU.render.postcard(state, caption) → string        // data: URL PNG 1600×1000
BSU.render.minimap(state) → void                    // draws #minimap (every 6th frame from the 'hud' pass; also callable)
BSU.render.setOverlay is render's; the fade is here
BSU.render.onPerfMode() → void                       // the guardrail reaction
BSU.render.crowd(ctx, rect, fill, wave) → void      // the per-seat noise field (score bug + stadium)
BSU.render.cone(state) → {points: {x,y}[]}|null     // the cone polygon in world px (minimap + overlays share it)
BSU.render.lightsList → {kind, x, y, r, a}[]         // the last frame's lights (debug)
BSU.render._fxInit(state); BSU.render._fxReset(state)
```

Passes registered: `weather` (5), `tint` (6), `lights` (7), `fog` (8), `overlays` (9), `hud` (10). Signature `(state, ctx, view, alpha, dtMs)`.

## 2. State fields

Owns none. Writes `state.ui.perfMode` only through `onPerfMode` (render measured it). Reads what render reads plus `state.ui.overlay/settings/tool`, `weather` (`rainRate`, `wind`, `windAngle`, `fog`, `event` for the cell disc, `heat`), `sky`, `storms.current` (cone, phase), **`hydro.surgeReached(state, i)` / `hydro.surgeFrontDistance(state, i)`** (never `state.hydro.surge.front` — it does not exist, D47), `progress.timers` and `state.progress.hints` / `state.progress.forceFirefliesDay` (state fields, D46), `wildlife.fireflyTarget/birds` (queries), `buildings.protection/gaps/coverage/auras/list/effective`, `hydro.predictRisk/riskAt`, `wildlife.mosqAt`, `terrain.streetlamps`, **`state.sports.game`** (crowd fill; the state field), `data.overlays` (legend text is ui's).

Private: the particle pool (typed arrays of length 2,500: `x, y, z, vx, vy, vz, life, maxLife, size` as `Float32Array`, `type, colorIdx, screen` as `Uint8Array`, `alive` count with swap-remove), the rain line state (a `Float32Array` of 1,200 × 2 positions), lightning `{flashUntil, poly, t0}`, fog blobs (8 × `{x, y, r, vx}`), cached firework sprites (3×3, 5×5), the minimap canvas/context (created in `_fxInit`: `canvas#minimap` 160×160 appended to `#minimap-wrap` **by ui** — render_fx looks it up via a registration: ui calls `BSU.render.attachMinimap(canvasEl)` after building the HUD; until then the minimap pass is skipped), overlay fade timing, the perf chip flag.

## 3. Events

**Emits:** none.

**Listens (owner `'renderfx'`; all set flags or emit particles; never touch sim state):**
`econ:income{key, amount, i}` → coin burst: 6–12 `coin` particles at tile `i` (or at the top bar: `screen: true` at (120, 24)) with `vz` up and gold color; `hitStop(60)` when `amount ≥ 500000`; `building:placed` → `dust` ×12 at the footprint + a squash record (`{id, t0}`: scaleY 1.15 → 1 over 200 ms — render's entity pass reads `render.squash[id]`); `building:complete` → `dust` ×20 + `sparks` ×6 + squash; `building:removed` → `smoke` puff ×20; `building:damaged{cause:'wind'}` → `debris` ×4 from the roof; `game:score{side:'home'}` → fireworks (30 `confetti` + 20 `sparks` above the stadium, `shake(150)`), `side:'away'` → nothing (audio groans); `game:final{won}` → fireworks ×3 bursts; `storm:pulse` → 20 `debris` on bezier arcs across the view (a lawn chair, a pirogue, a tent: `debris` with `size 3–6`), `shake(400)` on `storm:phase{LANDFALL}`; `weather:lightning{tx, ty}` → `flashUntil = now + 250`, a jagged polyline from the top of the screen to the tile, `shake(80)`, `lightningBloom` particle; `levee:overtop{i}` → `sheet` particles pouring over the crest (8 per event + 2 per frame while the tile stays overtopped this day — keep a set); `levee:breach{i}` → `gush` ×30 + `foam`; `surge:front{i}` → `foam` ×3 + `debris` ×1 at the tile; `gator:campus{enter:true}` → nothing (audio); `festival:start{id:'mardiGras'}` → beads are the parade's (progress calls `particles.emit('bead', …)` on float clicks); `milestone:earned` → 20 `confetti` at the top bar (`screen: true`) + the tiger-paw stamp is ui's; `enroll:round/lock` → nothing; `objective:complete` → 8 `sparks` at the objective card (`screen`); `ui:overlay` → `overlayFadeStart`; `setpiece:start{kind:'landfall'}` → reset the rain ramp; `speed:changed` → nothing; `save:loaded` → `_fxReset`.

## 4. Rules checklist

### Tier 1

**Particles (ARCHITECTURE §6.4; GDD §12.7)**
- [ ] Pool of `particlesMax 2500` (`particlesLow 800` when `settings.particles === 'low'` or `perfMode`): struct-of-arrays; `emit` fails silently when full (or replaces the oldest `rain`/`mosqDot` first). Types: `rain, splash, dust, smoke, steam, sparks, firefly, petal, bead, leaf, confetti, coin, fogWisp, mosqDot, debris, foam, sheet, gush, lightningBloom`. Each has default `life` (ticks-ish in ms: dust 400, smoke 900, steam 700, sparks 500, firefly 3000, petal 1500, bead 800, leaf 1500, confetti 1200, coin 700, fogWisp 4000, mosqDot 2000, debris 1500, foam 600, sheet 300, gush 500, lightningBloom 250), gravity (`vz −= g × dt` for `sparks, coin, bead, confetti, debris, gush`), drift (`vx += wind × k` for `smoke, steam, leaf, petal, fogWisp, mosqDot`), and a color (palette index) and size (1–2 px; fireworks use cached 3×3/5×5 sprites).
- [ ] Update per frame with `dtMs` (presentation time; independent of sim speed — but emission **rates** for per-frame emitters scale with sim speed? No: constant per frame; at 4× the world just moves faster). In headless the pool updates (cheap) but nothing is drawn.
- [ ] Draw (D50 — one mechanism, no alternative): render_fx implements **`render.particles.forEachWorld(fn)`**, which iterates the pool and calls `fn(x, y, z, size, colorIdx, type)` for every live particle with `screen === false` (world px, zoom-1 space). **render.js** calls it exactly once per frame in pass 4 and pushes one rank-3 draw-list entry per particle whose `draw` does `fillRect(sx, sy − z × zoom, size × zoom, size × zoom)` at the projected point — render_fx never draws world particles and there is no `drawWorld` function. Screen-space ones (`screen: true`) are drawn by render_fx's own `weather` pass.
- [ ] Per-frame emitters (only when the source is visible): rain splashes on water/puddle tiles (≤ 40 per frame at rain ≥ .3), boil-pot smoke at each effective Dining Hall (1 per 6 frames), pump discharge `foam` at running pumps (1 per 4 frames), the fogger ribbon (`fogWisp` behind the fogger vehicle each frame), azalea `petal` in bloom (1 per 30 frames per bed, wind-drifted), cypress `leaf` in November (1 per 40 frames per tree), mosquito `mosqDot` haze over tiles with `mosq ≥ .3` at Dusk/Night (1 per 10 frames per visible tile, dense (1 per 4) at ≥ .6), fireflies (see lights), generator exhaust `smoke` while running, vent `steam` on the Dining Hall and Wastewater, heat `steam` shimmer is a separate effect.

**Weather pass (GDD §12.5)** — screen space, after entities:
- [ ] Rain: `n = round(lerp(300, 1200, weather.rainRate))` lines when `rainRate > 0` (0 → none), capped at `rainLinesHalf 400` at 0.5× and halved in `perfMode`; each line 1 px wide, 8–14 px long, slanted by `windAngle` (`dx = cos × len`, `dy = sin × len` with the slant leaning by `wind × 6` px); positions advance `vy = 900 px/s × dtMs` and wrap; **one** `beginPath()` … `moveTo/lineTo` per line … one `stroke()` with `strokeStyle = rgba(200,220,255,.5)`. Local intensity: for a cell event skip lines whose screen position maps to a tile with `weather.rainAt < .05` (sample every 4th line). Puddle splash rings: 3–5 px expanding 1-px circles are **not** allowed (paths); use the `splash` particle.
- [ ] The cell disc: while `weather.event.kind === 'cell'`, a soft radius-14-tile disc: draw a translucent ellipse in screen space (world radius `14 × 32` px wide, `14 × 16` tall) as 12 stacked `fillRect` bands with alpha falling to 0 at the edge (`rgba(60,70,90,.25)` center).
- [ ] Lightning: while `now < flashUntil`: a full-screen white `fillRect` at alpha `0.7 × (flashUntil − now)/250`; the polyline (6–9 segments, jitter ±20 px) for 2 frames in `#FFFFFF` 2-px width (one path — allowed for the bolt, it is 1 per 80 ticks).
- [ ] Wind leaves/debris: `leaf` particles emitted at the screen's windward edge when `wind ≥ .3` (4 per frame at storm wind); `debris` from `storm:pulse` follow bezier arcs (store `p0,p1,p2` per particle in extra arrays; `t` from life).
- [ ] Surge front: tiles with `hydro.surgeReached(state, i)` get a darker band — drawn in the water pass by render (variant); `foam` particles at the advancing edge (on `surge:front{i}`), and an optional gradient toward the front from `hydro.surgeFrontDistance(state, i)`; never read a `front` array.
- [ ] Ponchos/umbrellas are agents' props; the crowd's ponchos: the crowd shader tints `#5A6B7A` when raining.

**Tint pass (GDD §12.2, §12.4)**
- [ ] Full-screen multiply (`globalCompositeOperation = 'multiply'`, `fillRect`) with the blend between the current phase's tint and the next by `sky.t` near boundaries: tints `dawn #F7B58A .25, day none, golden #FFCB6B .20, dusk #6B3F8F .35, night #0E1230 .62`; a storm tint `#2A3140 .50` while `storms.current.phase ∈ {LANDFALL}` set-piece phases OUTER…BACK (blend in over the first 150 ticks; the eye phase lightens to `#C9B86B .2` sickly yellow), replaced by golden at CLEARING; hurricane approach desaturation: from `storm:watch` to `storm:passed` draw a gray `#8A8A8A` multiply at alpha .3 → implemented as a second multiply.
- [ ] Reset `globalCompositeOperation` to `source-over` after.

**Lights pass (GDD §12.4; `lightsMax 250`)** — skipped by Day; alpha ramps in through Dusk (`sky.t`) and out through Dawn:
- [ ] Clear the offscreen `lights` canvas (half resolution in `perfMode`, quarter in the deepest guardrail step); draw light sprites (`sprites.get('light:<kind>')`) with `globalCompositeOperation = 'lighter'` at their screen positions; then composite the canvas onto the world with `'lighter'` (or `'screen'`), scaled up.
- [ ] Sources (≤ 250; nearest to the camera center first): streetlamps on `terrain.streetlamps()` tiles (`lamp`), lit windows from every building drawn with the NIGHT variant this frame (one `window` glow per building at the roof center, alpha by `effective`) — blackout providers' consumers omitted (the patchy dark campus), stadium masts (6 cones at Stadium II+ during a night game or from Dusk on game day; `mast` rotated toward the field), the Bell Tower `beacon` (brightness by prestige/100), the Water Tower `blink` (on 1 s / off 1 s by `frameNo`), the substation `arc` (flicker every ~3 s), generator `glow` while running, boil pots `pot`, bonfires `fire` (3-frame flicker via alpha), fireflies: `n = wildlife.fireflyTarget()` (÷2 in `perfMode`, cap `fireflyHalfCap 300` at 0.5×) `firefly` particles drifting over Marsh/Wet/Preserve tiles in view (×3 density over Preserve) with a blink (alpha `sin`); lightning bloom; gator `eye` dots (2 per gator on water at Night) — the "two pairs of red gator eyes".
- [ ] Night vignette: 4 edge gradients as stacked translucent `fillRect` bands (no gradients on the world canvas) darkening the borders by up to .35 at Night.

**Fog pass (Tier 2 #8 for the blobs; Tier 1 = the flat layer)**: when `weather.fog > 0`: a flat `#C9CFD1` layer at alpha `.3 × fog` (Tier 1); Tier 2: 8 large soft radial blobs (`fogWisp` clusters) scrolling slowly, denser over water.

**Overlays pass (GDD §11.1 overlays; ARCHITECTURE §6.3 pass 9)** — the active `BSU.OV` tint per visible tile, fading in over `overlayFadeMs 150` from `overlayFadeStart`:
- [ ] `FLOOD` (F): `hydro.predictRisk()` depth → tint `waterBlue` at alpha `clamp(risk / 2, .1, .7)` for `risk ≥ .05`; the number in feet on hover is ui's tooltip (ui reads `hydro.riskAt`). `WATER` (W): current `depth` likewise. `MOSQUITO` (K): `mosq` → four bands: `< .15` none, `< .3` yellow `#E8D44A` .25 (Ambient), `< .6` orange `#E8A03A` .4 (Annoying), `< .8` red `#E0443E` .5 (Biblical), else purple `#5E2CA5` .6 (State Bird). `POWER` (P): powered/watered buildings get a faint green diamond ring; unpowered/unwatered pulse red (alpha `.4 + .3 sin(frameNo/8)`) with the `decal:power/water` icon; provider radii as square outlines. `COVERAGE` (C): dining radii as filled squares (`gold` .15) and the `auras().life/green` values as a green tint. `ECOLOGY` (E): `subs` (feet sunk) as a brown tint `mud` alpha `min(.6, subs/2)` + per-tile rate text? (with the Institute: the number is ui's tooltip); Preserve tiles green, original wetland outline.
- [ ] Ghost: from `render.ghostSpec` (see render brief). Show-me flashes: `render.flash` entries pulse gold. Cursor tile pulse: the tile under the pointer (`render.hoverTile`, written by ui) gets a 1-px gold diamond outline pulsing alpha .4–.8. Debug hydro numbers: when `ui.debug.hydroNumbers`, draw `depth.toFixed(2)` per visible tile with `fillText` (debug only; fonts allowed here). The cone (`cone(state)`): a translucent purple-red (`#8E2A5E` .25) fan from the storm's `point` to the map's south/east edge along `track`, width `coneWidth` tiles, drawn as a polygon of 6 stacked `fillRect` bands (no path) — acceptable approximation: a filled polygon via `beginPath` is allowed here (one path per frame).
- [ ] Legend chip text is ui's (`#legend`).

**HUD-canvas bits (pass 10)**
- [ ] Minimap every 6th frame (`minimap(state)`): 160×160 = 2.5 px per tile: terrain colors by type (palette), buildings as 2×2 dots (`gold`), water depth blue tint, the cone, tomorrow's cell (Institute: `weather.tomorrowCell`), the river stage band during Spring High Water (blue along the east edge), Le Grand as a red dot; the viewport rectangle is the DOM `#minimap-viewport` positioned by ui from `render.visibleTiles()`.
- [ ] Ms. Thibodeaux portrait: ui asks `render.drawPortrait(canvasEl, frame)` (draws `thibodeaux` frame into the 48×48 canvas). Palette icons: `render.drawIcon(canvasEl, id)` draws `icon:<id>` at 64×64 (ui calls once per item on `unlock:changed`). The score bug crowd meter: `crowd(ctx, rect, fill, wave)` into `#score-bug`'s canvas (ui provides). Perf HUD text when `ui.debug.perfHud`: `fillText` of `perf()` in the top-left.
- [ ] The **stadium crowd** in the world: during a home game (and from Dusk on a game day), over the stadium's `bowlRect` (from `sprites.buildingBox`), a per-seat pixel-noise brightness field: `fill = attendance / seats`; for each 2×2 cell in the rect, lit if `hash(cell, frameNo >> 4) % 100 < fill × 100`, color purple/gold alternating; a sine wave sweep (`x + frameNo × 2`) brightens a moving column; ponchos gray in rain. ≤ 2,000 cells (draw with `fillRect`).

**Juice (GDD §12.7)**: squash on placement/complete (render reads `render.squash`), hit-stop on ≥ $500k income (`render.hitStop(60)`), gold flash on a win (a full-screen `gold` .15 `fillRect` for 6 frames), the camera drift on the title (`render.titleDrift = true` → a slow sinusoidal `panBy` each frame; session sets it).

**Postcard (`postcard(state, caption)`; GDD §11.6)**: create a temporary 1600×1000 canvas, render one frame of the current view into it at the current zoom with a wider viewport (temporarily set `view` to 1600×1000 and call `render.frame`'s passes 2–9 onto that context — expose `render.renderInto(ctx, w, h, state)`), draw the BSU wordmark ("BAYOU STATE" in `Georgia` 48 px `gold` with a 2-px `purpleShadow` shadow — the one place text is drawn on the world), the date (`formatDate`) and the caption in `system-ui` 20 px, a `gold` 4-px frame (the Rookery's postcard frame adds a second inner line); return `canvas.toDataURL('image/png')`; release the canvas (`width = height = 0`). Never keep it.

**Perf guardrail reaction (`onPerfMode`)**: `particlesMax → 800`, fireflies ÷ 2, rain lines ÷ 2, lights canvas at quarter resolution, `ui.hint('perfMode', 'Performance mode')` once; agents drawn never < 120 (render's rule).

### Tier 2

- [ ] Colorblind overlay palette (settings.colorblind → alternate band colors for K/F/W).
- [ ] Fireworks ring / jumbotron animation at Stadium III; heat shimmer (2-px vertical wobble on roof/asphalt rows when `heat.index > 95`: draw those rows again offset by `sin`), fog blobs, god rays after a storm (6 translucent `gold` wedges from the top-right for 100 ticks after CLEARING) — cut #8.
- [ ] The title-screen campus thumbnail after Flagship (`render.thumbnail(state) → canvas`).

## 5. Edge cases and invariants

- Never allocate per particle per frame; the pool is fixed typed arrays.
- Every pass in try/catch (render wraps; still guard inside loops).
- `rainRate` NaN → treat as 0; `fireflyTarget` undefined → 0.
- Headless: every pass runs; `fillText` on the stub is a no-op; `toDataURL` returns a placeholder (`postcard` returns it).
- `perfMode` never reduces the sim; only visuals.
- The minimap pass is skipped until ui attaches the canvas; `drawPortrait/drawIcon` accept null canvases (no-op).
- `globalCompositeOperation` is always restored to `source-over` at the end of each pass.

## 6. selfTest() requirements

`render_fx` has no separate `selfTest`; register tests on `BSU.render._tests.push(fn)` (render's `selfTest` runs them):

1. Particle pool: `emit('dust', 0, 0, 10)` → `count() === 10` and `forEachWorld` visits exactly 10; `emit('confetti', 0, 0, 3, {screen: true})` adds 3 to `count()` but 0 to `forEachWorld`; after updating with `dtMs` beyond `life` → 0; emitting 3,000 never exceeds the cap; `clear()` → 0.
2. Rain line count: `rainRate 0 → 0`, `.5 → 750`, `1 → 1200`, at 0.5× `≤ 400`, in `perfMode` `≤ 600`.
3. Overlay band function: `mosqBand(.1) === 0`, `(.2) === 1`, `(.5) === 2`, `(.7) === 3`, `(.9) === 4`.
4. Tint blend: at `phase DAY` alpha 0; at `NIGHT t 0.5` `#0E1230` .62; the storm tint overrides during landfall.
5. `cone(state)` with a synthetic storm (point on the south edge, width 24) returns ≥ 4 points inside the world extents; `null` without a storm.
6. Lights source list on a synthetic state with 3 lamps + 2 buildings at Night ≤ 250 and sorted by distance to the camera center.

## 7. Testing in isolation

Use `scratch/render_page.mjs` from `docs/briefs/render.md` §7 (it already includes `render_fx.js`) and extend the fake state: set `s.weather.rainRate = .6`, `s.weather.windAngle = 1.2`, `s.sky.phase = 4` (Night), add 3 road tiles for lamps (stub `BSU.terrain.streetlamps` to return them), `s.wildlife.fireflies = 200`, `s.ui.overlay = 3` with some `mosq` values; call `BSU.render.particles.emit('confetti', wx, wy, 50)` and `BSU.events.emit(BSU.EV.WEATHER_LIGHTNING, {tx: 30, ty: 30})` from `--eval`. Screenshot at 1× and 0.5× and Read the PNGs: rain slants with the wind, lamps glow additively over a dark campus, the K overlay shows four band colors, the particles fall with gravity. Then run `node test/browser.mjs --fps` on the page for 5 s: ≥ 30 fps with rain 1,200 lines + 2,500 particles + 250 lights.

## 8. Performance budget

Within render's 12/25 ms: weather ≤ 2 ms (one stroke for rain), tint ≤ 0.5 ms (two full-screen fills), lights ≤ 3 ms (≤ 250 small `drawImage`s on a half-res canvas + one composite), fog ≤ 0.5 ms, overlays ≤ 2 ms (≤ 700 tinted diamonds as 8-run fills), particles ≤ 2 ms (≤ 2,500 `fillRect`), minimap ≤ 1 ms every 6th frame, crowd ≤ 1 ms. Three full-screen composites total (tint, lights, fog).

## 9. Done means

- `render.selfTest().ok` with the fx tests; `node test/smoke.mjs` `render()` runs all passes on the stub.
- In Chrome the GDD §12.8 acceptance table holds: coin bursts on income, dust and squash on placement, rain/cell/lightning as specified, the night lights with a patchy blackout, fireflies at ecology ≥ 50, the K/F/W/P/C/E overlays with their tints, the cone on the world and the minimap, sheet/gush on overtop/breach, fireworks and a 150-ms shake on a home score, the postcard PNG downloads from `file://` with the wordmark and date.
- The §1 screenshot moment renders: six masts pouring light over a filled Cauldron at Night with fog off the bayou, moss swaying, streetlamps along every path, fireflies over the marsh, two pairs of red eyes on the water, the cone on the minimap.
