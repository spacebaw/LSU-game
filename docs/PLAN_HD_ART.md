# HD art plan: from procedural pixel art to smooth procedural art (2026-10-27)

Prototype (not in the repo, nothing under `src/` touched):
`/private/tmp/claude-502/-Users-joshfleig-Desktop-Claude/fb39c7b3-595d-4955-a705-28fe9ff8fb98/scratchpad/hdstyle/`
— `index.html` (three columns A/B/C, day + night rows, fourth column = live-game 2× screenshot), `hd_common.js`
(colour kit, noise, iso maths, the fixed scene, the composer), `style_a.js`, `style_b.js`, `style_c.js` (one brush each),
`compare.png` (DPR-2 pixels, 3800×1600), `compare_2000x1400.png` (CSS layout), `a.png` `b.png` `c.png` (day cells, 920×680),
`a_night.png` `b_night.png` `c_night.png`, `night.png` (the night row), `shoot.sh` (re-renders through `test/browser.mjs`).
Open `index.html` in Safari/Chrome on the Mac to see it at the real DPR; `?px=1&dpr=2` shows device pixels 1:1.

Everything is vanilla Canvas 2D, resolution-independent (real-valued geometry, antialiasing on, gradients, patterns),
same projection as the game (`BSU.worldToScreen`: 64×32 tiles, 6 px/ft), same key light (upper-left; SW face lit, SE
face shadow), same night pipeline (multiply `#0E1230` @ .62, then an additive lights pass).

## 1. The primitive set (shared by all three styles)

Each style is one object, a *brush*, with the same ten calls. The composer (`HD.draw`) only knows geometry
(tiles, faces, a hip roof as four planes, stairs as step quads, a path polyline, anchors); the brush owns every pixel.

| primitive | signature | used for |
|---|---|---|
| `groundTile(ctx, T, env)` | T = tile centre, kind, elev, `dropS`/`dropE` (terrace faces), neighbours, seed, pool flag | grass, marsh, terrace/cliff faces, slab sides |
| `waterTile(ctx, T, env)` | T.shore = which edges touch land | open water, shoreline, glints (silver at night) |
| `fillQuadShaded(ctx, pts, color, {face:'top'/'sw'/'se', material}, env)` | materials: stucco, stone, wood, cloth, paint, glass, glow | walls, plinths, stairs, doors, banners, windows, lantern |
| `roofPlane(ctx, pts, color, {facing:'nw'/'ne'/'sw'/'se'}, env)` | first edge = eave | hip/gable roofs, tile courses, ridge |
| `column(ctx, x, yBase, h, r, color, env)` | | porch columns, posts, lamp shafts |
| `path(ctx, screenPts, widthPx, env)` | smooth polyline | gravel paths (roads, boardwalks later: same call, other material) |
| `tree(ctx, x, y, kind, {seed, inWater}, env)` | | live oak + moss, bald cypress + knees (palm, azalea later) |
| `figure(ctx, x, y, {facing, walk, shirt, seed}, env)` | | students (gators, Roux, players: same body kit) |
| `shadow(ctx, {x,y,rx,ry} or {poly}, env)` | | contact + cast shadows (down-right) |
| `light(ctx, {x,y,r} or {quad} or {pool}, env)` | additive | window glow, lamp pool, fireflies, beacons |

Shared kit: `HD.tone(base, t)` is the **continuous** form of the 5-tone ramps (ART_STYLE §2): t ∈ [−1, 1], shadows
mix toward `#2B2550`, highlights toward `#FFE0A0`, with the same coefficients at t = −1, −.5, .5, 1 as tones 0, 1, 3, 4.
That keeps every existing palette hex and material valid; only the *mechanism* changes (gradients instead of
dithered tone picks). Noise: `vnoise`/`fbm` in world space (seamless by construction, no position bits needed),
`pnoise` (128-periodic) for tileable textures. Patterns are anchored to the CTM, so adjacent tiles and chunks join.

## 2. The three styles

| | A. clean vector | B. painterly textured | C. soft rendered (diorama) |
|---|---|---|---|
| reads as | Townscaper / Two Point Campus: flat planes, crisp silhouettes, blob foliage with a lit cap | hand-painted strategy map: grain, blade streaks, roof courses, brush dabs, AO, warm/cool key | rendered miniature: gradient lighting, bevelled edges, cool rim light, specular on roof/water/pools |
| extra primitives inside the brush | `plane` (2-stop gradient), `blob` (clipped lit cap), `patches` | 11 tileable 128² luminance textures applied with `overlay` (rotated for roof courses), `dab`, `stroke`, `cluster` (opaque union of dabs + clipped texture) | `plane` with per-edge bevel (edge classified against the key light), `orb` (sphere gradient + rim arc + spec), `softEllipse`, `microGrain`, eave shadow (multiply) |
| scene bake, DPR 2, 36 tiles + hall + 2 trees + 4 figures, headless software raster | **5.5 ms** | **16.7 ms** | **15.3 ms** |
| night | windows/lamp/fireflies as 2-stop additive blobs | warm 3-layer halos | bloom (3 layers + white core) |
| readability at 0.5× | best (flat, high local contrast) | worst (textures become noise; needs an LOD that drops textures below 0.75×) | good (shape-from-shading survives downsampling) |
| authoring cost per catalog row | lowest (planes + course lines) | highest (material texture + dab placement per object) | low-medium (planes + orbs; specular placement is automatic from the bbox) |

## 3. Mapping onto the existing pipeline

- **`sprites.get(id, variant, frame, zoom)`** (`sprites.js` ~397): the cache key `id|variant|frame|z` stays. Painters
  become brush compositions; `bake()` hands the painter a context already scaled to the **master** (1 = today's art
  pixels, 2 = HD) with `imageSmoothingEnabled = true`, instead of the pen. Masters are vector-resolution-independent,
  so a third master (4, for zoom 2.5 on Retina) is a config line, not new art. Anchors (ARCH §6.1: tiles at the
  diamond centre, trees at the trunk base, decals bottom-centre, lights centre) are unchanged: the composer already
  works that way.
- **Variant bits**: bits 0–3 keep their meanings (facing/variant); bits 4–9 (map position) stay for the few painters
  that still want tile-local seeds. Seamless noise no longer needs them: the HD brushes sample world-space noise.
- **Chunk bake** (`render.js bakeChunk`, 8×8 tiles, 512×416 per chunk): gains an HD mode that bakes at the master
  scale (1024×832, 3.4 MB per chunk) with the brush `groundTile`/`waterTile`/`path` calls replacing tile-sprite blits.
  Estimated per chunk (64 tiles, from the scene timings): A ≈ 10 ms, B ≈ 30 ms, C ≈ 27 ms in software raster; GPU
  raster on the Mac is several times faster. Bake must be time-sliced (one chunk per frame, visible ring first) and
  progressive (master 1 first, upgrade to master 2 when the frame has headroom). `evictChunks` stays; add a byte cap.
- **DPR-aware canvas** (`render.js` ~220, dpr capped at 2, smoothing off): smoothing goes **on** for HD; a master
  drawn at `zoom × dpr / master` scale. On Retina at 1× zoom the HD master lands at 1 art px = 1 device px.
- **Zoom tiers** `ZOOMS = [0.5, 1, 2]` (+ granular 1.25–2.5 from PLAN_RESOLUTION): pick master 2 when `zoom × dpr ≥ 1.5`,
  master 1 otherwise, master 4 only at zoom 2.5 on dpr 2 if memory allows. 0.5× stays a smoothed downscale of master 1
  with an `env.lod` that drops textures, moss strands, dabs and specular (B needs this most).
- **Night**: `passTint` (multiply) and the lights pass (`lighter`) are untouched; `light:<kind>` sprites are baked
  from `brush.light`, still additive, still scaled by `nightAmount`; reflections keep their stretched copy.
- **Characters**: `figure` is baked per facing × 8 gait frames into the atlas as today (`sprites_entities`); 300
  agents stay `drawImage` of cached cells, so per-frame cost does not change and memory is 4× a tiny cell.

## 4. Rollout passes

| pass | scope | model | size |
|---|---|---|---|
| H0 pipeline | brush module + continuous ramp in `sprites.js`; master scale in `get`/`bake`; chunk HD mode, time-sliced + progressive bake, byte caps (Chrome 96/120 MB atlas/chunks, Safari 64/80); smoothing switch; tests for both masters | strong | L (~400k) |
| H1 terrain + water | `groundTile`/`waterTile`/faces, cliffs, levees, paths/roads/boardwalks/decks via `path`, shoreline, marsh pools, puddles, snow/flood states | strong | L |
| H2 buildings | all 46 catalog rows through `fillQuadShaded`/`roofPlane`/`column` + decals; `wallTones` → face t; windows + night `glow`; damage/sinking states | strong | XL (two sessions) |
| H3 vegetation | oak, cypress, palm, azalea, reeds, moss, knees, seasonal rust | cheaper | M |
| H4 characters | students (hair/skin/shirt variants), Roux, gators, football players, vehicles; 4 facings × 8 frames | strong | L |
| H5 effects + icons | fireworks, splashes, fog, storm, fireflies, lights; icons re-baked from HD masters | cheaper | M |
| H6 UI harmonisation | panels, buttons, minimap, cursor rings, placement ghosts in the chosen look (A flat / B paper / C glossy) | cheaper | S–M |
| H7 QA + Safari memory | fps at 300 agents on a dense campus at dpr 2, memory audit, 0.5× readability screenshots, fallback to master 1 | strong | M |

Order H0 → H1 → H2 → H4 → H3 → H5 → H6 → H7; each pass shippable alone (unconverted families keep the pixel
painters, which still bake at master 1 through the same `get`). Roughly 3–3.5 M tokens total.

## 5. Risks

- **Bake cost** (B, C ≈ 3× A): mitigated by time-slicing, progressive masters and world-space noise instead of
  per-pixel textures where a gradient does the job; gate: ≥ 55 fps at 1× Retina, bake ≤ 2× today's per chunk.
- **300 agents**: fine while figures are cached cells; the trap is live-drawing gradients per frame (effects, lights).
  Budget the lights pass at ≤ 2 ms by caching halo blobs per radius.
- **Safari**: chunk memory at 1024×832, pattern + `overlay` composite (supported), avoid `ctx.filter` (Safari < 18)
  and `shadowBlur` (slow); feature-detect and fall back to master 1.
- **Readability at 0.5×**: smooth art loses silhouettes faster than dithered pixels; keep ART_STYLE §5's rule
  (silhouette information in tones 2–4), darker contact shadows, the `lod` switch, and test every family at 0.5×.
- **Style drift**: the brush is the only painter API; passes must not add ad-hoc gradients. ART_STYLE §2–3 get
  rewritten for the continuous ramp and brush rules before H1.
- **Seams**: AA hairlines between diamonds are killed by stroking each tile with its own fill (0.8–0.9 px); patterns
  and noise are world-anchored. Verified in the prototype after the first render showed per-tile gradient seams.

## 6. Recommendation: C (soft rendered), with A as the fallback

C delivers the "high-fidelity, smooth" impression Josh asked for at an authoring cost close to A: two primitives
(`plane` with automatic bevel/spec, `orb`) carry walls, roofs, foliage, figures and props, so the 46 catalog rows are
mostly geometry, and its shape-from-shading survives the 0.5× downscale. B is the most atmospheric but is the most
expensive to author (a texture and dab layout per material/object), the noisiest at 0.5×, and the slowest to bake.
A is the cheapest and safest and is the fallback if H7 fails the Safari/perf gate, but it reads flatter than the
brief's "high-fidelity" target. Carry two of B's ideas into C during H1: the base AO under objects and a low-alpha
grain overlay on terrain, so the diorama does not turn plastic across a whole campus.

## Decision (2026-10-27)

Josh chose **C, soft rendered diorama**. A stays the fallback only if the Safari memory or
frame-rate gate in H0/H7 fails. Prototype sources: `style_c.js` and `hd_common.js` from the
scratchpad prototype are the reference brushes for the rollout; H0 (pipeline) is next.
