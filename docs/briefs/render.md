# Brief: `src/js/render.js` → `BSU.render` (camera, chunk cache, draw list, water pass, frame pipeline, shake, screen↔world)

Read first: `docs/ARCHITECTURE.md` §1 (row 13), §2.10 (`ui.camera`, `ui.overlay`, `ui.settings`, `ui.perfMode`), §3.1 (`BSU.MAP`, `BSU.SPR`, `BSU.OV`), §3.2 `params.render` (every constant), §3.5 (`worldToScreen`, `screenToWorld`, `tileDiamond` — use the contract's helpers, do not re-derive), §3.4 events, §6.1 (atlas API and anchors), §6.2 (camera API — copy it), §6.3 (the pass order — this brief is §6.3 expanded), §6.5 (perf guardrail; the measurement is yours, the reaction is render_fx's), §7 (what ui expects: `#world` canvas, `screenToTile`), §9.3 (`frame(state, alpha, dtMs)` from the loop), §9.5 (`headless.render`), §10.1, §10.3 (large finite ms, never `Infinity`), §10.4, §10.5 (read `state.<branch>` fields, never module properties), §11.1, D17–D19, D27, D37, D46, D47, D50; `docs/GDD.md` §12.1 (projection, chunks, water — the whole section), §12.3 (terrain tile variants, trees at 0.5×), §12.4 (lights list — drawn by render_fx, sourced here), §12.7 (juice: shake, hit-stop, squash), §15.3 (the perf budget and the 0.5× rules), §3.2 (`surface` derived visuals: culvert, bridge, lamps), §11.7 (camera behavior), §6.1.6 (puddles ≥ .05), §6.5 (Sinking! icon, 2° tilt).

---

## 1. Purpose and public surface

The world canvas: camera, the 64 baked terrain chunks, the live water diamonds, the depth-sorted entity list, and the frame pipeline that calls render_fx's passes in order. It owns `state.ui.camera` (saved) and the chunk-dirty bitmap (not saved). It never touches HUD DOM (ui does) and never mutates sim state.

Copy the API from ARCHITECTURE §6.2 verbatim (`init, reset, frame, resize, camera, panBy, panTo, panToTile, setZoom, zoomStep, follow, screenToTile, tileToScreen, visibleTiles, shake, hitStop, flashTiles, ghost, dirtyChunk, dirtyAll, postcard (fx), minimap (fx), particles (fx), setOverlay, perf, captureCameraTouch`). Additions:

```js
BSU.render.ctx                       // the #world 2D context (render_fx draws its passes on it)
BSU.render.view → {vw, vh, dpr, x0, y0, x1, y1}   // viewport size in CSS px, device pixel ratio, and the visible tile rect
BSU.render.registerPass(name, fn, order) → void   // render_fx registers 'weather', 'tint', 'lights', 'fog', 'overlays', 'hud' passes at definition time (plain registry)
BSU.render.chunkCanvas(cx, cy) → HTMLCanvasElement|null   // for the minimap/postcard
BSU.render.drawList → Entry[]        // the last frame's sorted entities (render_fx's lights pass reads building positions from it)
// Entry = {ax: number, ay: number /*anchor tile coords, floats for movers*/, elev: number, rank: 0|1|2|3 /*building, tree, entity, particle*/, key: number, draw: (ctx, view, alpha) => void, ref?: Building|Agent|Gator|…}
BSU.render.particles.forEachWorld(fn: (x, y, z, size, colorIdx, type) => void) → void   // IMPLEMENTED BY render_fx (D50): visits every live WORLD-space particle (screen === false) in pool order. render.js calls it exactly once per frame in pass 4 and pushes one rank-3 Entry per particle ({ax: x/32-ish tile coords from the world px, ay, elev: z/6, draw: fillRect(x, y − z, size, size)}); this is the ONLY hook through which world particles reach the depth-sorted pass — render never reads the pool's arrays and render_fx never draws world particles itself
BSU.render.alpha → number            // the last frame's interpolation alpha
BSU.render.frameNo → number
BSU.render.anchorOf(building) → {x, y}   // world px of the south-corner anchor at ground elevation (zoom-1 space)
BSU.render.entityScreen(e) → {x, y}      // interpolated foot point in canvas px
BSU.render.tilePx(i) → {x, y}            // diamond center in canvas px at the tile's elevation
BSU.render.hitStopUntil                  // read by session's loop (ms timestamp; 0 when none)
BSU.render.hoverTile → number|-1         // written by ui on pointermove (the cursor-tile pulse)
BSU.render.squash → Object<number, number>   // building id → squash start time (ms); written by render_fx on placed/complete, read by the entity pass (scaleY 1.15 → 1 over 200 ms)
BSU.render.titleDrift → boolean          // session sets on the title world: a slow sinusoidal camera drift each frame
BSU.render.variantOf(building, info) → number   // the BSU.SPR variant selection rule of pass 4 (pure; tested)
BSU.render._tests = []                   // render_fx pushes test functions; selfTest runs them
// hooks implemented by render_fx.js and called by render.js (render.init calls _fxInit at its end; reset calls _fxReset):
BSU.render._fxInit(state); BSU.render._fxReset(state)
BSU.render.attachMinimap(canvasEl); BSU.render.drawPortrait(canvasEl, frame); BSU.render.drawIcon(canvasEl, id)   // ui calls
BSU.render.renderInto(ctx, w, h, state) // passes 2–9 into another context (postcard)
```

Module shape: `'use strict'` IIFE, `const M = (BSU.render = BSU.render || {})`; `init`, `reset(state, fresh)` (identical for both values: drop the chunk cache, rebind the camera, `_fxReset`, resize), `selfTest`; no `tick`. **No DOM at definition time.** No state on the module object (D46): `camera` is the live `state.ui.camera` reference (rebound in `reset`), everything else on `M` is render-private.

## 2. State fields

**Writes (owner):** `state.ui.camera` (`x, y, zoom, tx, ty, follow`) and `state.ui.perfMode` (the guardrail flag, via render_fx). `state.setPiece.cameraTouched` (through `captureCameraTouch`).

**Reads (state fields are read as `state.<branch>.<field>` — never as properties of a module object, D46):** `tiles.*` (all), `plot`, `veg`, `buildings[]`, `state.agents`, `state.vehicles`, `state.gators`, `state.wildlife.officers/leGrand/beadsDay` and `state.progress.forceFirefliesDay` (state fields), `weather` (`sky`, `rainRate`, `wind`, `fog`, `event`, `heat`), `storms.current` (cone, phase), **`state.sports.game`** (null when no game; there is no `sports.game()` function), `tiles.depth`, **`BSU.hydro.surgeReached(state, i)`** for surge water (never a `surge.front` array — it is not in state, D47) and gate state via `hydro.networks` / flags, `progress.timers` (`cajunNavy`), `ui.overlay/settings/tool`, `state.setPiece`, `BSU.sprites.*`, `BSU.terrain.streetlamps()`, `BSU.buildings.dumpsterTile/effective/protection/gaps/auras`, `BSU.hydro.riskAt/predictRisk`, `BSU.wildlife.mosqAt/birds/fireflyTarget` (queries).

Private (closure, rebuilt in `reset`): `chunks: Array(64)` of `{canvas, ctx, dirty, lastSeen}`, `dirtyBits: Uint8Array(64)`, the draw-list arrays (reused), `shakeUntil/shakePx`, `flash` list, `ghostSpec`, the 60-frame time window, `hitStopUntil`, offscreen canvases (`tint`, `lights`, `fog`) created in `init`.

## 3. Events

**Emits:** `camera:moved{x, y, zoom, byUser}` (on user pans/zooms and on `panTo` completion — at most once per frame).

**Listens (owner `'render'`):** `tile:changed{chunk}` → `dirtyBits[chunk] = 1` (and the chunk to the N/W if the tile is on a chunk edge and `what` is `elev` — cliffs of neighbors); `building:placed/removed/complete/upgraded/damaged/repaired` → nothing to bake (entities are live) except `removed` (the ruin/tarp overlays are live too) → no-op; `storm:*`, `game:*`, `econ:income`, `setpiece:*`, `levee:*`, `surge:front`, `weather:lightning`, `gate:*` → **render_fx** listens (particles/FX); render itself listens only to `tile:changed`, `save:loaded` (→ `reset`), `ui:overlay` (→ `setOverlay`), `speed:changed` (nothing), `setpiece:start{kind:'landfall'}` (auto-camera cues are driven by weather calling `panToTile`).

Listeners set bits; all drawing happens in `frame`.

## 4. Rules checklist

### Tier 1

**Canvas and viewport (`init`, `resize`)**
- [ ] `init`: if not headless-browserless (i.e. `document.getElementById('app')` exists — it does in the stub too), create `canvas#world.world` (`tabindex = 0`) appended to `#app` **before** ui builds `#hud` (render.init runs before ui.init by manifest order), get its `2d` context with `{alpha: false}`, `imageSmoothingEnabled = false`; create the three offscreen composites (`tint`, `lights`, `fog`) via `document.createElement('canvas')` (never `OffscreenCanvas`); allocate the 64 chunk records (canvases created lazily on first bake). Subscribe. In headless mode the stub canvas is 1280×720 (`makeWindow` default); `resize` reads `#app.getBoundingClientRect()`.
- [ ] `resize()`: `dpr = min(2, devicePixelRatio || 1)`; canvas `width = round(rect.width × dpr)`, `height = …`; `style.width/height = rect px`; `vw/vh` in CSS px; `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`; composites resized (lights at half resolution in `perfMode`, quarter in the guardrail's deepest step); called on `init`, on `window.resize` (browser, listener added in `init`), and checked at the top of each frame (rect changed → resize).

**Camera (ARCHITECTURE §6.2; GDD §11.7)**
- [ ] `camera = state.ui.camera` (the same object reference; `reset` rebinds to the new root). `x, y` = world px (zoom-1 space) at the viewport center. World extents at zoom 1: x ∈ [−2016, 2016], y ∈ [−84, 2040] (computed from `worldToScreen` corners: tile (0,63) left vertex, (63,0) right vertex, (0,0) top at +14 ft, (63,63) bottom at −4 ft). Clamp `x ∈ [minX − 200/zoom, maxX + 200/zoom]` (`cameraMargin 200`), likewise y.
- [ ] Easing: when `tx/ty` are set (by `panTo`), each frame `x += (tx − x) × 0.15` (`cameraLerp`); within 0.5 px → snap and clear the target (`tx = ty = NaN` → store `null`; **never leave NaN in the saved camera**: `tx,ty` are in `SAVE_SKIP` but keep them numbers anyway: use `hasTarget: boolean`). User pans write `x,y` directly and clear the target.
- [ ] `panBy(dx, dy, byUser)`: `x += dx / zoom`, `y += dy / zoom` (screen px → world px), clamp, `camera:moved{byUser}`; if `byUser` and `state.setPiece` → `captureCameraTouch`. `panTo(wx, wy, ease)`: set the target (or snap). `panToTile(tx, ty, ease)`: `worldToScreen`'s world part: `wx = (tx − ty) × 32`, `wy = (tx + ty) × 16 − elev × 6`.
- [ ] `setZoom(z, anchorPx)`: `z ∈ {0.5, 1, 2}` (snap to the nearest); keep the world point under `anchorPx` fixed: `wx = (ax − vw/2)/zoomOld + x` → after: `x = wx − (ax − vw/2)/zoomNew`; clamp; `camera:moved`. `zoomStep(dir)`: next step in `[0.5, 1, 2]`.
- [ ] `follow(agentId)`: each frame `panTo(agent foot world px, ease)`; `−1` releases; releases automatically on a user pan.
- [ ] `screenToTile(px, py)`: `BSU.screenToWorld(px, py, camera, vw, vh, (tx, ty) => tiles.elev[idx])` with `px, py` in CSS px (the pointer's `offsetX/Y`); returns `{tx, ty}` or `null`. `tileToScreen(tx, ty, elevOverride)`: `BSU.worldToScreen(tx, ty, elevOverride ?? elev, camera, vw, vh)`.
- [ ] `visibleTiles()`: the conservative tile rect covering the viewport: invert the four screen corners with elevation 14 and −4 (the extremes), take min/max of `tx, ty`, clamp 0–63, pad by 1. Recomputed once per frame; agents read it with +4.
- [ ] Title/charter: session calls `panTo` for the swoop; nothing special here. `H` (home) → `panToTile(plot.founders.tx + 1, plot.founders.ty + 1, true)` is ui's call.

**Frame pipeline (`frame(state, alpha, dtMs)`, ARCHITECTURE §6.3)** — every pass in its own `try/catch` → `BSU.error('render', '<pass>', e)`; measure `frameMs` around the whole frame:
- [ ] 1 Setup: resize check; `view` rect; easing/follow; `alpha` stored; shake offset `(sx, sy)` = `rng.fx`-driven ±`shakePx` while `now < shakeUntil` and `settings.shake`; `ctx.save(); ctx.translate(sx, sy)` for passes 2–9; clear the canvas with `#0E1230` (the page background) — actually with the sky-appropriate ground color? No: clear black-purple; chunks cover the world.
- [ ] 2 Terrain chunks: for each chunk `(cx, cy)` in 0–7 × 0–7 whose world rect intersects the view (≤ 20 visible at 1×; all 64 at 0.5×): if `dirty` and the per-frame re-bake budget (2; the first frame after `reset` may bake every visible chunk once: budget 150 ms) allows → `bakeChunk`; `drawImage(chunk.canvas, dx, dy, 512 × zoom, 416 × zoom)` at `dx = (chunk.ox − camera.x) × zoom + vw/2`, `dy = (chunk.oy − camera.y) × zoom + vh/2`. Chunk origin (D19): `ox = ((cx×8) − (cy×8 + 7)) × 32 − 32`, `oy = (cx×8 + cy×8) × 16 − 16 − 84` (world px; the −84 = 14 ft × 6 px headroom for elevation). Chunk canvas 512×416 at 1× only; at 2× draw it pixel-doubled; at 0.5× halved. Chunks not visible for > 600 frames are released when total canvas memory > 64 MB (`sprites.memoryMB() + chunkCount × 0.85 + composites`), LRU by `lastSeen`.
- [ ] `bakeChunk(cx, cy)`: clear; for each of the 64 tiles in **draw order** (`ty` then `tx` ascending within the chunk — but a chunk's tiles' diamonds overlap neighbors' at elevation: bake with tiles sorted by `tx + ty` ascending; tiles from **neighboring chunks** that overhang into this chunk's rect are NOT drawn (accept 1-px seams at cliffs; the −84 headroom handles vertical overhang within the chunk)): (a) ground: `sprites.get('tile:' + type, sprites.tileVariant(tx, ty))` at the diamond center `(wx − ox, wy − oy)` with `wy` including `−elev × 6`; (b) cliff faces: if `elev − elevS ≥ 1` draw `cliff` frame 0 of height `round((elev − elevS) × 6)` under the S edge; likewise E; (c) Marsh standing-water tint is in the Marsh tile sprite already; a Marsh tile with `depth ≥ 0.5` draws the live water instead (pass 3) — bake nothing extra; (d) decorations: `reeds` on Marsh tiles where `hash(tx,ty) % 100 < 25`, `knees` on water-edge tiles adjacent to a cypress, `palmetto` entities are veg (pass 4), `worn` when `DESIRE_WORN`; (e) surfaces: `surf:<id>` with the 4-bit mask of same-surface neighbors (+16 bridge if the tile has a water flag, +32 fence sign every 6th tile along the run from its lowest index (compute the run index via a BFS within the chunk's neighborhood; simpler: `hash(tx,ty) % 6 === 0` — **use the hash**), +64 culvert if CANAL flag); (f) canal: `canal` with mask (+16 culvert, +32/64 gate present/closed — gate closed-ness is live: bake the **open** variant and let pass 3 overlay the `gate` sprite frame by live state); (g) levee/floodwall: by `crest` (6 → `levee`, 12 → `floodwall`) with mask of same-crest neighbors (+16 cracked when `integrity < 50`), drawn at ground elevation rising 12/18 px; burrow decals: `decal:burrow` × `min(6, wildlife.burrowLog[i]?.n)` at hashed offsets; (h) preserve posts on PRESERVE tiles with a mask of non-preserve neighbors; (i) `mound` on MOUND tiles; (j) at **0.5×** also bake the static water highlight: `water` variant 0 over water-flag tiles (skipped at 1×/2× — the chunk is baked once at 1× and drawn scaled, so bake the highlight always but make pass 3 skip the animated lines at 0.5×; decision: always bake it, it is faint). `dirty = 0`, `lastSeen = frameNo`.
- [ ] 3 Water (live, per visible tile): draw a translucent diamond for every visible tile with a water flag, or (non-Marsh land and `depth ≥ 0.05`), or (Marsh and `depth ≥ 0.5`), or POND: color `mix(shallows, waterDeep, clamp(depth / 4, 0, 1))` at alpha `0.55 + 0.3 × clamp(depth/2, 0, 1)` (water tiles: depth = `stage − elev` ≥ 1 → deep); draw at the **water surface** elevation (`elev + depth`) using `sprites.diamond` with `fillRect` runs (≤ 300 tiles normally, ≤ 700 during a surge); at 1×/2× two 1-px `shallows` sine highlight lines per tile scrolling with `frameNo` (skip at 0.5×: `rainLinesHalf` rule family); Day sparkle: 1 px `#FFFFFF` at alpha .5 at a hashed position when `sky.phase ∈ {DAY, GOLDEN}` every 8th tile; Night light smear: a 2×8 `gold` vertical smear at alpha .25 under any lit window within 3 tiles (approximate: under buildings' anchors); bayou current line: a 1-px `shade(waterDay, 1.2)` line along the spline direction; surge water (`BSU.hydro.surgeReached(state, i) === true` — the only way to know a tile is reached; never read a `front` array): darker (`shade(waterNight,.8)`) with 2 debris fleck pixels; floodgates: `gate` frame by live state (0 open → 3 closed, animated over 20 ticks from the transition — track transitions from `gate:*` events in a small map `{i: {closing, t0}}`); the surge barrier gate: `barrierGate` frames over the barrier tiles.
- [ ] 4 Entities (depth-sorted): build the draw list from visible things: **buildings** (`buildings[]` non-null, anchor = south-corner tile center at that tile's elevation; variant bits: `built < 1 → SCAFFOLD` (frame `floor(built × 3)`), `ruin → RUIN`, `hp < 1 && tarp → DAMAGED`, `pilings → PILINGS`, `NIGHT` when `sky.phase ∈ {DUSK, NIGHT}` and `effective(id) > 0` and not blackout (frame = `data.seed % 4`), `TIER_SHIFT` bits from `tier`, `BOARDED` while `data.boardedUntil ≥ day`; rotated → id `type + ':r'`; water tower storm sway frames when `weather.wind ≥ .6` (frame `1 + (frameNo >> 3) % 2`) and toppled frame 3 when `closedUntil ≥ day && hp < 1 && cause…` — use `storm.rolls.toppleIds` includes id; sunk ≥ 1.5 → `ctx.rotate(2° )` about the anchor; `Sinking!` icon (`decal:sinking`) above the roof when `sunk ≥ 1.0`; the `decal:dumpster` on `data.dumpsterTile`; red `decal:noAccess/power/water` icons above the roof when unconnected/unpowered/unwatered (always shown, even while `suppressCoverage`); the `parking` frame 1 when flooded), **trees** (`veg[]`: `oak/cypress/palmetto/azalea` with `treeVariant(stage, autumn = month === 11 && type === 'cypress', bloom = azalea && date in Mar 1–Apr 10)`, anchor tile center; at 1×/2× draw 6–10 moss strands per oak (stage ≥ 1) as 1-px `moss` lines from hashed canopy points, `x += sin(frameNo/20 + hash) × wind × 3` — one `beginPath/stroke` per oak; skipped at 0.5×), **agents** (`state !== 'GONE' && !inside`; interpolated `p + (cur − p) × alpha` (D27); id `agent` or `agent:<anim>` by state/prop (`FLEE → flee`, `WADE → splash`, `SIT → sit`, `CHEER → cheer`, `IDLE → idle`, walking → `walk` or `umbrella`/`foam`/`beads`/`tube`/`cap` by prop); frame `agentFrame(anim, dir, floor(frameNo / 6))` (2-frame at 0.5×: `f & 2`); the `bubble` above fleeing agents; never draw fewer than 120 agents (if culling for perf, cull by `id % k`)), **gators** (+ Le Grand; hover tag while `tag > 0` or hovered: a 1-line gold label drawn by ui as DOM? **Decision:** name tags are DOM (`#tooltip`-style floating labels are ui's) — render exposes `entityScreen` and ui draws the label), **officers**, **vehicles** (`pirogue/bus/fogger/navy/crew`), **floats/band/krewe** (from `progress` parade state: `progress.parade(state) → {floats:[{tx,ty}], band:[…], krewe:[…]}|null`), **tents/smokers/cornhole/snoball** (from `state.sports.game` tailgate spots and the `weather.heat().wave` flag: place 6 tents around the venue's edge tiles on a game day; a sno-ball cart at the Union on `heat.wave`), **bonfires** (`progress.bonfires(state) → number[]` tiles), **birds** (egrets on stocked ponds/preserve tiles: `wildlife.birds().egrets` positions hashed; spoonbills circling the preserve at Dawn: a circle of 5 around a preserve centroid), **Roux** pacing inside the habitat, **in-world particles** (obtained by calling `render.particles.forEachWorld(fn)` exactly once per frame and pushing one rank-3 entry `{ax, ay, elev: z/6, rank: 3, draw}` per particle — D50; render never touches render_fx's pool arrays). Sort key `key = 100 × (ax + ay) + 2 × (elev + 4) + 0.25 × rank` (rank: building 0, tree 1, entity 2, particle 3) where `(ax, ay)` = the anchor tile coords (floats for movers; `tx + w − 1, ty + h − 1` for buildings); insertion sort into the reused array (mostly sorted frame to frame). Draw each with `drawImage(ref.canvas, ref.sx, ref.sy, ref.sw, ref.sh, round(sx + ref.ox × zoom), round(sy + ref.oy × zoom), ref.sw × zoom, ref.sh × zoom)` where `(sx, sy)` = the anchor's screen px (at 0.5× the 1× ref is drawn at half size; at 2× the 2× ref if present else ×2).
- [ ] 5–9: `registerPass` order: `'weather'` (5), `'tint'` (6), `'lights'` (7), `'fog'` (8), `'overlays'` (9) — all render_fx's; render calls them in order with `(state, ctx, view, alpha, dtMs)`. `ctx.restore()` after pass 9 (shake ends). 10: `'hud'` pass (render_fx: minimap every 6th frame, palette icons on demand, the score bug crowd meter, perf HUD text).
- [ ] Ghost (`ghost(spec)`): stored; drawn in pass 9 by render_fx from `render.ghostSpec` (`{tiles, color, ringTiles?, label, radius, radiusCenter, sprite?: {id, variant, tx, ty}}`): tile diamonds tinted green/yellow/red at alpha .45, the ring fill (reached tiles at alpha .25 red / unreached .15 green) for levee drags, the radius ring (a Chebyshev square outline of `radius` tiles), the sprite at alpha .6. `null` clears.
- [ ] `flashTiles(tiles, ms)`: pushes `{tiles, until: now + ms}`; accepts any large finite `ms` (progress passes `1e9` for "until cleared"); a non-finite `ms` → `BSU.error` and ignore (§10.3); render_fx pulses them gold (alpha `.5 + .3 sin`).
- [ ] `shake(ms, px)`: `shakeUntil = now + ms`, `shakePx = px` (ignored when `!settings.shake`); `hitStop(ms)`: `hitStopUntil = performance.now() + ms` (never in headless: `BSU.headlessMode → no-op`).
- [ ] `setOverlay(ov)`: writes `state.ui.overlay`, `overlayFadeStart = now` (render_fx fades 150 ms).
- [ ] `perf()`: `{frameMs (last), drawCalls (counted per frame), particles, agentsDrawn, hydroActive (hydro exposes active count via hydro.activeCount() — add to hydro; fall back to 0), chunks (live count), memMB}`.
- [ ] Guardrail measurement: keep the 60-frame ring buffer of `frameMs`; when all > 25 → `state.ui.perfMode = true` and call `render_fx.onPerfMode()` (once; the chip is ui's on `ui:notify`? render_fx calls `ui.hint('perfMode', 'Performance mode')`).
- [ ] `captureCameraTouch(state)`: `if (state.setPiece) state.setPiece.cameraTouched = true`.
- [ ] `dirtyChunk(i)`, `dirtyAll()`; `reset` drops every chunk canvas (memory), rebinds the camera, clears particles (fx), resizes.
- [ ] Headless (`headless.render`): `frame(state, 0, 16.67)` must run **every** pass on the stub context; `drawImage` on stub canvases is a no-op proxy; `getBoundingClientRect` on the stub returns 1280×720. Never call `requestAnimationFrame` here (session's loop does).

### Tier 2

- [ ] The 2× atlas use (draw 2× refs at 2× zoom) — until then draw 1× refs scaled.
- [ ] Chunk seam polish for overhanging cliffs (bake neighbor overhangs).
- [ ] Colorblind overlay palette (render_fx + settings).

## 5. Edge cases and invariants

- Never mutate sim state; never call action functions. The only writes are `ui.camera`, `ui.perfMode`, `setPiece.cameraTouched`.
- Camera numbers always finite and clamped; `zoom` ∈ {0.5,1,2} exactly (compare with `===`).
- A missing sprite (`get` → null) is skipped silently (one `BSU.error` from sprites).
- Buildings with `tx+w−1` out of bounds cannot exist; still guard `idx`.
- Entities with NaN positions are skipped (and reported once via `BSU.error`), never drawn at NaN.
- Frame on an ungenerated state (title before `newGame`, or `BSU.newState(0)` at boot): tiles all zero → draws a flat field; must not throw.
- Set pieces: nothing special except `cameraTouched`.
- Load / new game: `reset(state, fresh)` (both values) → `dirtyAll`, camera from the tree (`follow −1`), first frame bakes visible chunks (budget 150 ms once); `save:loaded` also triggers it.
- `resize` when `#app` has zero size (hidden tab): keep the last size; never create a 0×0 canvas.
- The world canvas is the pointer target; render sets `tabindex=0` and `style.touchAction = 'none'`; ui attaches the listeners.

## 6. selfTest() requirements

Pure (no canvas drawing; use the math only).

1. Sort key monotonic: for tiles along a diagonal, `key(ax+1, ay)` > `key(ax, ay)`; a particle at the same tile sorts after a building (`rank`); elevation +1 ft adds 2.
2. Camera clamp: `panBy` far beyond the extents lands at `maxX + 200/zoom` (at zoom 1 and 0.5); `setZoom(2)` keeps the world point under the anchor within 1 px (compute with `worldToScreen`/`screenToWorld`).
3. `screenToTile` inverse: for 20 random tiles at random elevations (write into a private state's `elev`), `screenToTile(tileToScreen(tx,ty))` returns the same tile (using a private camera object, not the live one).
4. Chunk origin formula: chunk (0,0) → `ox −256, oy −100`; chunk (7,7) → `ox = (56 − 63) × 32 − 32 = −256`, `oy = 112 × 16 − 100 = 1692`; every tile of chunk (cx,cy) projects inside `[ox, ox+512] × [oy, oy+416]` at any elevation in [−4, 14] (check the 4 corner tiles at both extremes).
5. `visibleTiles` on a 1280×720 view at zoom 1 centered on tile (32,32) contains (32,32) and spans ≤ 30 × 30 tiles; at 0.5× ≥ 40 × 40.
6. Building variant selection table: `{built:.5} → SCAFFOLD` with frame 1; `{ruin:true} → RUIN`; `{hp:.8, tarp:true} → DAMAGED`; `{pilings:true, sky DUSK, effective 1} → PILINGS|NIGHT`; `{tier:2} → 2 << 5`; `{boardedUntil ≥ day} → BOARDED` — expose `M.variantOf(b, ctxInfo)` and test it.
7. `perf()` returns finite numbers before any frame.

## 7. Testing in isolation

Render needs the atlas and a state; test it in **real Chrome** (the stub cannot show pixels):

```js
// scratch/render_page.mjs — writes scratch/render.html with contract+data+sprites*+render+render_fx and a fake minimal state
import { readFileSync, writeFileSync } from 'node:fs';
const files = ['contract.js','data.js','sprites.js','sprites_buildings.js','sprites_entities.js','render.js','render_fx.js'];
const js = files.map(f => readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8')).join('\n');
writeFileSync(new URL('./render.html', import.meta.url), `<!doctype html><html><body style="margin:0;background:#0E1230"><div id="app" style="position:fixed;inset:0"></div><script>${js}
// minimal stubs for modules render reads
BSU.terrain = { streetlamps(){ return []; } }; BSU.buildings = { effective(){ return 1; }, dumpsterTile(){ return -1; }, protection(){ return new Uint8Array(4096); }, gaps(){ return {gaps:[],weak:[],gates:[],reachedBuildings:[]}; }, auras(){ return null; }, list(){ return []; } };
BSU.hydro = { riskAt(){ return 0; }, predictRisk(){ return new Float32Array(4096); }, networks(){ return []; }, activeCount(){ return 0; }, surgeReached(){ return false; }, surgeFrontDistance(){ return 65535; } }; BSU.wildlife = { mosqAt(){ return 0; }, birds(){ return {egrets:0}; }, fireflyTarget(){ return 0; } };   // officers/leGrand/beadsDay are read from s.wildlife.*
BSU.weather = { sky(s){ return s.sky; }, wind(){ return {speed:.1, angle:1}; }, cone(){ return null; }, storm(){ return null; }, heat(){ return {index:80,advisory:false,wave:false}; }, date(){ return {month:6}; } }; BSU.progress = { timers(){ return []; }, parade(){ return null; }, bonfires(){ return []; } }; BSU.sports = { season(s){ return s.sports; } }; BSU.ui = { hint(){}, settings(){ return BSU.state.ui.settings; } };   // the game struct is s.sports.game (null here)
const s = BSU.state = BSU.newState(1);
for (let i = 0; i < 4096; i++) { const tx = i & 63, ty = i >> 6; const e = 2 + 4 * Math.sin(tx/7) * Math.cos(ty/9); s.tiles.elev[i] = e; s.tiles.type[i] = e < 1.5 ? 2 : e < 3.5 ? 3 : e < 6.5 ? 4 : 5; if (tx > 58) { s.tiles.elev[i] = -4; s.tiles.type[i] = 0; s.tiles.flags[i] = 128; s.tiles.depth[i] = 4; } s.tiles.owner[i] = -1; }
for (let x = 20; x < 40; x++) s.tiles.surface[30*64+x] = 2;
s.buildings.push({ id: 0, type: 'dorm', tx: 24, ty: 24, w: 3, h: 2, rot: 0, name: 'Test', hp: 1, built: 1, builtDay: 0, pilings: false, sunk: 0, powered: true, watered: true, provider: {power:-1,water:-1}, flooded: false, floodedSince: -1, closedUntil: -1, blackout: false, tier: 0, upgradeDoneDay: -1, ruin: false, tarp: false, data: { seed: 5, boardedUntil: -1, dumpsterTile: -1 } });
s.veg.push({ type: 'oak', tx: 28, ty: 22, stage: 2, plantedDay: 0, planted: false });
BSU.sprites.init(s); BSU.render.init(s); BSU.render.reset(s, true); BSU.render.panToTile(28, 26, false);
function loop(){ BSU.render.frame(s, 0, 16.67); s.sky.cycleTick = (s.sky.cycleTick + 1) % 300; requestAnimationFrame(loop); } loop();
window.__perf = () => BSU.render.perf();
<\/script></body></html>`);
```
Then `node test/browser.mjs --file scratch/render.html --wait 2000 --shot /tmp/render.png --eval "__perf()"` (add `--file` support to `browser.mjs` if missing: it only needs to load a different path) and **Read the PNG**: a hilly field with cliff faces, a road, a dorm sitting exactly on its 3×2 tiles, an oak with moss, the river along the right edge. Pan/zoom by evaluating `BSU.render.setZoom(0.5)` and re-shooting: the whole map fits, chunks are pixel-halved, no seams beyond 1 px.

## 8. Performance budget (ARCHITECTURE §10.4; GDD §15.3)

- ≤ 12 ms per frame typical, ≤ 25 ms worst (0.5× full map, game-day Night, rain). Chunk re-bake ≤ 6 ms each, ≤ 2 per frame. ≤ 20 chunk `drawImage`s at 1×; ~600 entity `drawImage` typical, 1,200 worst; water ≤ 300 diamonds normally (≤ 700 in a surge) as `fillRect` runs (32 runs per diamond → cap: at 0.5× draw diamonds with 8 runs (4-px rows)).
- The draw list is built into preallocated arrays (`Float64Array keys`, `Int32Array order`) and insertion-sorted incrementally; no per-frame allocation beyond `SpriteRef` lookups; `get` results for buildings cached per `(id, variant, frame)` on the Building struct's private slot (`b._ref`) — a closure `WeakMap<Building, ref>` keyed by variant.
- Memory: `sprites.memoryMB() + chunks × 0.85 + 3 composites ≤ 64 MB`; evict LRU chunks above it.
- The lights canvas at half resolution in `perfMode`.

## 9. Done means

- `selfTest().ok`; the scratch render page shows correct projection, chunk seams ≤ 1 px, buildings anchored on their tiles at all three zooms, moss swaying, water tinted by depth.
- `node test/smoke.mjs` `render()` calls run every pass on the stub without errors; `node test/browser.mjs --fps` on the full game reports ≥ 30 fps on the perf acceptance list (1× campus Day; game-day Night; landfall at t = 35 s; 0.5× full map at Night in rain; 2× the Cauldron; the title).
- The camera swoop, `H` home, `.` follow, minimap click-to-pan, pinch/ctrl-wheel zoom about the cursor, edge clamping with the 200-px margin all behave as GDD §11.7 says in Chrome and Safari.
