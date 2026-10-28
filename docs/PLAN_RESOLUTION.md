# Art resolution plan (2026-10-27)

## Where resolution comes from today (measured)

- The world canvas already renders at the device pixel ratio (capped at 2) with smoothing off
  (`render.js` ~line 220). On a Retina Mac at 1× zoom every art pixel is drawn as a crisp 2×2 block of
  device pixels. Nothing is blurry; it is simply low-detail: one art pixel per 1/64 of a tile width.
- The 2× zoom atlas is a **pixel-double** of the 1× master (`docs/ART_STYLE.md` §6): zooming in shows
  bigger pixels, not more detail. 0.5× is a smoothed downscale of 1×.
- So "better resolution" means **more art detail per tile**, not a sharper canvas. The lever is HD
  masters: paint at 128×64 per tile (2× units) with real detail, and show them whenever the screen can
  resolve them: at 2× zoom on any display, and at 1× zoom on a Retina display (zoom × dpr ≥ 2).

## Target

| Situation | Today | After |
|---|---|---|
| 1× zoom, Retina | 1× master, pixel-doubled by the DPR | **HD master at 1 art px = 1 device px** (2× the visible detail at the same size) |
| 2× zoom, any display | pixel-doubled 1× master | **HD master** (real detail) |
| 1× zoom, non-Retina | 1× master | 1× master (unchanged; optional downsample of HD for softer edges, off by default to keep the pixel look) |
| 0.5× | smoothed 1× | smoothed 1× (unchanged) |
| Granular zooms (1.25, 1.5, 1.75, 2.5) | n/a | nearest master scaled with smoothing off above 1.5, on below |

## Mechanism (one change in the pipeline, then per-family art)

1. **Pen detail mode** (`sprites.js`): the pen gains `P.detail` (1 or 2). At detail 2 a painter may place
   half-art-pixel features (the pen paints 1×1 device blocks instead of 2×2). Existing painters keep
   working unchanged at detail 1 (they still produce the pixel-double), so families convert one at a time.
2. **Master selection** (`sprites.get` + `render`): request `zoom` and `dpr`; the atlas key becomes
   (id, variant, frame, master ∈ {1, 2}) and the renderer picks master 2 whenever `zoom × dpr ≥ 2` and the
   family has an HD painter, drawing it scaled by `zoom × dpr / 2`. Chunk bake gains an HD mode for the
   same condition (bake visible chunks ± 1 at 2× units, LRU-evict, hard cap on chunk memory).
3. **Memory budget**: HD doubles linear resolution (4× pixels). Keep the atlas under 96 MB and chunks
   under 120 MB on Chrome, 64 / 80 on Safari (feature-detect; fall back to master 1 when the cap is hit).
   Lazy bake per master; evict the unused master on zoom change after a grace period.
4. **Perf gate**: ≥ 55 fps at 1× Retina with a dense campus in headless Chrome at dpr 2; chunk bake time
   ≤ 2× today's per chunk.

## Family passes (each: author HD detail following docs/ART_STYLE.md, before/after crops at 2× and at 1×
Retina, memory and fps numbers, tests for both masters)

| Pass | Family | What HD detail buys | Model |
|---|---|---|---|
| R0 | Pipeline: pen detail mode, master selection, chunk HD mode, memory caps, DPR tests | nothing visible yet; everything else depends on it | strong |
| R1 | Buildings (`sprites_buildings.js`) | brick courses, mullions, roof tiles, railings, signage legible, finer night windows | strong |
| R2 | Terrain + water bake | grass blades and clover, strata lines, finer shoreline foam, wave detail, puddle edges | strong |
| R3 | Vegetation | leaf clusters, moss strands at half width, bark texture, azalea blossoms | cheaper |
| R4 | Characters (students, gators, Roux, football players at 2× cells) | faces, hair, jersey numbers at 1× Retina, cleats and helmets | strong |
| R5 | Paths, decks, bridge, stairs, tees (`render.js` curve stroking) | finer gravel texture, plank gaps, rail balusters | cheaper |
| R6 | Effects and icons | sharper fireworks, splashes, fog wisps; icons from HD masters | cheaper |
| R7 | QA + Safari memory check (Josh opens the link in Safari; agent audits memory and fallbacks) | | strong |

## Order and cost

R0 first (it gates everything), then R1 and R2 (most of the screen), then R4 (students are everywhere),
then R3, R5, R6, R7. About 8 passes, roughly 2.5–3M tokens. Each family pass is shippable on its own:
the game keeps the 1× look for any family not yet converted.

## Out of scope (and why)

- Replacing pixel art with vector or painterly rendering: a different game look; the pixel style is a
  deliberate choice in the design doc and the style guide.
- 4× masters: memory would exceed Safari's canvas limits without a streaming atlas; revisit only after R7
  shows headroom.
