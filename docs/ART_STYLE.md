# Bayou State — art style guide (Track B, written in pass B1)

Every later art pass (B2 vegetation, B3 buildings, B4 characters, B5 effects, B6 icons) follows this file. The
mechanisms it names live in `src/js/sprites.js` (`BSU.sprites.ramp`, `vnoise`, `pnoise`, `toneAt`, `bayer`, the pen),
`src/js/brush.js` (`BSU.brush`, the HD brush of passes H0–H6: §2–§3 and "## Brush API" below) and `src/js/render.js`
(`bakeChunk`, `groundTone`, `waterPass`). Read `docs/INTEGRATION_NOTES.md` "## art pass B1" for what B1 changed and measured
and "## H0 pipeline pass" for the HD pipeline (masters, `registerHD`, chunk HD mode, caps).

## 1. Light

- **Key light from the upper-left of the screen** (the sun stands in the world's south-west, high). Surfaces that face
  south or west are lit; surfaces that face east are in shadow; the top of anything flat is the base tone.
  - Iso faces: the **SW face (left) is the lit face, the SE face (right) the shadow face**. Buildings' `wallTones`
    (`sprites_buildings.js`) now do this (`left` 0.92, `right` 0.78); the `cliff` sprite's south face is one ramp
    step lighter than its east face; `stepFace` puts the shadow tone on the south band, the deep tone on the east band.
  - **Ground shadows fall down-right** (`render.js gatherInfo`: `shX > 0`), long at dawn/golden/dusk, short at noon.
  - Slopes: ground falling toward the west or south is tinted warm/light, toward the east cool/dark
    (`render.js groundTone`, ±0.05 per ft of neighbour difference).
- Canopies already shade from the upper-left (`sprites.js canopy`). B2 keeps that; B3 keeps the wall swap; B4 lights
  faces from the viewer's left.

## 2. Material ramps (continuous, five knots) — rewritten in pass H0

Every material is one base colour and a **continuous ramp** `BSU.brush.tone(base, t, alpha)` with t ∈ [−1, 1]:
**−1 deep shadow, −.5 shadow, 0 base, .5 light, 1 highlight.** The five knots carry exactly `makeRamp`'s coefficients
(shadows lean **cool** toward `#2B2550`: deep = `mix(shade(base, .52), cool, .30)`, shadow = `mix(shade(base, .74), cool, .16)`;
highlights lean **warm** toward `#FFE0A0`: light = `mix(shade(base, 1.16), warm, .12)`, highlight = `mix(shade(base, 1.34), warm, .28)`),
so `tone(c, −1 | −.5 | 0 | .5 | 1)` equals tones 0–4 of `BSU.sprites.ramp(name)` (≤ 2/255) and every hex in the table below stays
valid; between the knots the shade factor and the tint amount interpolate linearly. Only the *mechanism* changed: gradients and
orbs sample the ramp continuously instead of picking a dithered tone index. Style C saturates the base by 1.12 before ramping
(`brush.tone`); `brush.toneArr` is the raw ramp. Pen painters not yet converted keep reading `ramp(name)[k]` (unchanged).

Base colours (`BSU.sprites.RAMP_BASES`, `BSU.brush.ramp(name)`; the knots below are what `tone` returns at −1 … 1):

| material     | −1 deep | −.5 shadow | 0 base  | .5 light | 1 highlight |
|--------------|---------|------------|---------|----------|-------------|
| grass (Dry)  | #353F2E | #4B5E32  | #6E8F3C | #8EAC50 | #B1C866 |
| highGrass    | #3B4631 | #556B38  | #7FA347 | #A0C15B | #C2DC71 |
| wet ground   | #2D322D | #3E4830  | #5A6B3A | #7A884E | #9EA664 |
| dirt         | #392B2C | #523D2F  | #7A5A38 | #9B764C | #BD9563 |
| clay         | #453231 | #664737  | #9A6A44 | #BB8658 | #DCA56E |
| limestone    | #504A4D | #797168  | #B9AE93 | #DBCCA9 | #F9E6BA |
| cypress bark | #221A23 | #2A201F  | #3A2A1E | #5A4531 | #7F674A |
| marsh mud    | #282429 | #36312A  | #4C4530 | #6C6144 | #90815B |
| water deep   | #17202D | #172930  | #1B3A3A | #3A564E | #617664 |
| water shallow| #35484E | #4C6E69  | #6FA895 | #8FC6AB | #B2E1BC |
| sand / shell | #5B5452 | #8D8271  | #D9C9A1 | #FBE8B7 | #FFF6C8 |
| reed         | #3F4333 | #5D653B  | #8A9A4B | #ABB860 | #CCD375 |
| mud          | #282027 | #342A27  | #4A3B2A | #69573D | #8F7855 |
| oak leaf     | #222B27 | #2B3D27  | #3B5A2A | #5A763D | #809555 |
| cypress leaf | #232D2D | #2E4030  | #3F5E3A | #5F7B4E | #849964 |
| cypress rust | #553127 | #824727  | #C7692B | #E9853E | #FFA456 |
| palm leaf    | #2F3D2D | #415C30  | #5E8A3A | #7FA84E | #A1C364 |
| azalea leaf  | #1D2B27 | #233D27  | #2E5A2A | #4D763D | #739555 |
| azalea bloom | #612946 | #963A5C  | #E75480 | #FF7095 | #FF8FA8 |
| moss         | #45494A | #676F62  | #9BAA8A | #BCC8A0 | #DCE2B1 |

Rules for every HD painter (H1–H6):

- **Never hand-pick a colour**: pick a base (a ramp name, a palette key or the catalog hex) and a t. Faces carry fixed t
  offsets in the brush (`top` +.05, `sw` −.10 lit, `se` −.48 shadow, roofs `nw` +.30 / `ne` −.18 / `sw` +.08 / `se` −.50) so a
  building's `wallTones` become one base colour per material, not three hexes. Add `o.t` for a material-level nudge only.
- **Light is a gradient, not a tone pick**: `plane` runs base+amp → base−amp across the quad (amp .14 stucco/stone/wood, .22
  cloth, .30 metal); `orb` runs t+.75 at the upper-left to t−.65 at the rim; roofs run eave (t−.2) → ridge (t+.45). Pass t, never a
  second colour.
- **Silhouette information lives at t ≥ 0** on lit tops and crowns (the night tint still multiplies the frame; a shape whose
  only contrast is at t ≤ −.5 vanishes at night, §5).
- The accent pair (§4) is unchanged: purple / gold are decal and cloth materials, never terrain, water, bark or stone.

## 3. Shading, bevels, seams and noise (no outlines, no dither) — rewritten in pass H0

- **Bevel instead of outline.** HD shapes have no 1-px outline. A `plane` classifies each edge against the key light
  (upper-left): edges facing it get a light inner line (t+.7 at .55 alpha, 1.6 px), the others a cool rim `#B8C8FF` (.28 alpha,
  1.1 px). `orb` adds a rim arc on its lower-right and an optional specular dot (`spec` = alpha) at the upper-left; roofs get
  course lines (7, or 4 at lod 1), a specular band near the ridge on the lit planes and an eave shadow (multiply) on the walls
  below. Contact comes from **AO**, not lines: every non-top face fades to `rgba(30,25,70,.25)` over its bottom 10 px, columns
  over their bottom 8, trees sit in a soft `#1E1946` ellipse, and `shadow` (multiply, `rgba(40,34,90)`) casts the long shape.
- **Gradients instead of dither.** Flat areas are a diagonal gradient (`groundTile`: t +.22 → −.10 plus a ±.13 world-noise
  drift per tile) with `softEllipse` patches and small `orb` tufts; never `toneAt` / `bayer` in an HD painter, and never a
  hand-written `createLinearGradient` in a painter — every gradient is one of the brush calls (PLAN_HD_ART §5 "Style drift").
  Banding cannot occur because the ramp is continuous; if a surface reads flat, raise `amp`, do not add tones.
- **Noise is world-anchored.** `brush.vnoise / fbm(seed, x, y, cell)` are sampled at `cx + env.originX`, `cy + env.originY`
  (the context's world origin: the chunk origin for the chunk bake, 0 for a standalone sprite), so two tiles or two chunks
  never show a seam or a repeat. `microGrain` (a 64² periodic luminance texture at `overlay`, .18–.35 alpha) is the fine texture,
  applied to stucco, stone, ground and faces, and it is skipped at lod 1; `macroGrain` (H1: a 256×128 periodic field at `overlay`,
  .3–.5) is the coarse one — the light / dark drift of the ground over several tiles — and stays at lod 1. `pnoise(seed, x, y, cell, per)`
  builds any new tileable texture.
- **Cached tiles anchor through their block position (H1).** A tile sprite cannot know the chunk origin, so the chunk bake hands every
  ground / water tile its block position in `variant` bits 4–9 (`tx & 7 | (ty & 7) << 3`, the pen marsh painter's rule, now for every type)
  and the painter builds its env with `brush.posEnv(env, pv, cx, cy)`: the context origin becomes the 8×8-tile block's screen offset and
  `field` / `marshField` / `sites` / `macroGrain` / `microGrain` repeat every 256×128 px, so the 64 variants of a family join across tile
  and chunk borders. Decorations come from `sites` (one jittered site per grid cell, world-anchored): a patch cut by a tile edge is drawn
  again by the neighbour, clipped to `diamondGrown(cx, cy, .7)`, so the two halves meet with no hairline. Bits 0–2 (the old hash variant)
  are ignored by an HD tile; water adds bit 3 (shallow, < 1.5 ft) and bit 10 (deep, ≥ 3 ft). The `tile` and `cliff` families are pinned
  (`registerHD(family, fn, {pin: true})`): their variants are fetched only by chunk bakes, so gc must not drop them between bakes.
- **Seams.** Antialiased diamonds leave a hairline between neighbours; every ground and water diamond is stroked with its own
  fill at `brush.seamWidth(env)` = **0.9 device px** (0.9 art px at master 1, 0.45 at master 2), round joins. Any new tiled
  primitive must do the same (`brush.seamStroke`). Elevations stay whole pixels (`round(elev·6)`).
- **Masters and LOD.** A painter draws once in 1× art units; the context is pre-scaled to the master (1 = today's art pixels,
  2 = HD, 1 art px = 2 device px of detail) with image smoothing on. `env.lod` is 0 at master 2 (everything) and 1 at master
  1 (no grain, half the dabs / glints / moss strands, 4 roof courses): 0.5× is a smoothed downscale of master 1, so keep the
  shape-from-shading (bevel + AO) strong enough to survive it, and darker contact shadows under small objects.
- **Night** is unchanged (§5): paint day materials; `material: 'glow'` only for a lit pane in the base pass; everything that
  glows registers a `light:` sprite baked from `brush.light` (additive) — still scaled by `nightAmount`, reflections still
  the stretched copy. Water glints switch to silver `#C9D8FF` through `env.night`.
- **Pen painters** not yet converted keep the B1 rules (1-px tone-0 outline, `toneAt` dither, `pnoise` with position bits);
  they bake at master 1 through the pen and are pixel-doubled at 2, exactly as before H0.

## Brush API

`BSU.brush` (src/js/brush.js, style C "soft rendered diorama") is the only painter API for HD families. All coordinates are
1× art px on a context already scaled to the master; `env` comes from `spec.env` (sprites.bake) or `brush.env(master, o)`.
An HD painter: `BSU.sprites.registerHD(family, (ctx, spec) => { const g = BSU.brush.begin(ctx, w, h, spec); …draw with
brush calls using g.env…; return { w, h, ox, oy }; })`. Anchors are unchanged (ARCH §6.1: tiles at the diamond centre, trees
at the trunk base, decals bottom-centre, lights centre).

| call | signature | use it for |
|---|---|---|
| `begin` | `begin(ctx, w, h, spec) → {w, h, S, env}` | first line of every HD painter: sizes the canvas w×h art px × master, pre-scales, smoothing on |
| `env` | `env(master, {night, dpr, lod, originX, originY}) → env` | a hand-built env (chunk bake, tests); `master` 1 or 2, `lod` 0 full / 1 reduced |
| `tone` | `tone(base, t, alpha?) → 'rgba()'` | every colour: base = ramp name, palette key or hex; t ∈ [−1, 1] (style C saturation applied) |
| `toneArr` | `toneArr(base, t) → [r, g, b]` | the raw continuous ramp (no saturation), for mixing |
| `css` / `mix` / `sat` / `ramp` | `css(c, a)`, `mix(a, b, t)`, `sat(c, k)`, `ramp(name) → hex` | colour plumbing; `ramp` resolves a material name, a palette key or a hex |
| `rng` / `vnoise` / `fbm` / `pnoise` | `rng(seed) → () ⇒ [0, 1)`, `vnoise(seed, x, y, cell)`, `fbm(seed, x, y, cell, oct)`, `pnoise(seed, x, y, cell, per)` | deterministic jitter and world-space noise (sample at `x + env.originX`) |
| `poly` / `bbox` / `centroid` / `diamond` / `smoothPath` / `ellipse` / `lerp` | `poly(ctx, pts)`, `bbox(pts) → {x0, y0, x1, y1, w, h}`, `diamond(cx, cy) → 4 pts`, `smoothPath(ctx, pts)` (Catmull-Rom) | geometry helpers; `pts` are `[[x, y], …]` |
| `seamWidth` / `seamStroke` | `seamWidth(env) → px`, `seamStroke(ctx, pts, fillStyle, env)` | close the AA hairline of every tiled diamond with its own fill (0.9 device px) |
| `plane` | `plane(ctx, pts, color, t, {vert, amp, rim, spec})` | the lit, bevelled quad behind every face; prefer `fillQuadShaded` unless you need the raw knobs |
| `orb` | `orb(ctx, x, y, rx, ry, color, t, {spec, noRim})` | spheres: foliage clusters, heads, tufts, gravel, lamp heads |
| `softEllipse` | `softEllipse(ctx, x, y, rx, ry, color, alpha, plateau)` | radial fades: AO, patches, specular bands, halos |
| `microGrain` | `microGrain(ctx, pts, alpha, env)` | the one surface texture (overlay), world-anchored, skipped at lod 1 |
| `fillQuadShaded` | `fillQuadShaded(ctx, pts, color, {face: top/sw/se, material: stucco/stone/wood/cloth/paint/metal/glass/glow, t, noAO}, env)` | walls, plinths, stairs, doors, banners, windows, lantern panes (the building primitive) |
| `roofPlane` | `roofPlane(ctx, pts, color, {facing: nw/ne/sw/se, noShadow}, env)` | hip / gable planes; `pts[0]→pts[1]` is the eave; courses, ridge specular, eave shadow |
| `column` | `column(ctx, x, yBase, h, r, color, env)` | porch columns, posts, lamp shafts, piers |
| `groundTile` | `groundTile(ctx, {cx, cy, kind: grass/high/marsh/wet/dirt, seed, dropS, dropE, pool}, env)` | one land diamond with its S / E terrace faces (drops in ft) |
| `waterTile` | `waterTile(ctx, {cx, cy, seed, shore: {n, e, s, w}, deep, dropS, dropE}, env)` | one water diamond: shallows at the shore edges, caustic rings, glints (silver at night) |
| `path` | `path(ctx, screenPts, widthPx, env, {material: gravel/asphalt/boardwalk})` | smooth polylines: paths, roads, boardwalk decks (same call, other material) |
| `tree` | `tree(ctx, x, y, kind: liveOak/cypress, {seed, inWater, stage, autumn}, env)` | trees at the trunk base; stage scales 0.55 / 0.8 / 1 |
| `figure` | `figure(ctx, x, y, {facing, walk, shirt, trim, skin, hair, pants, seed}, env)` | the body kit (students, Roux, gators, players): bake per facing × gait frame |
| `shadow` | `shadow(ctx, {x, y, rx, ry, a} or {poly, soft, a}, env)` | contact + cast shadows (multiply, down-right) |
| `light` | `light(ctx, {x, y, r, color, a, firefly} or {quad, color, halo} or {x, y, rx, ry, pool, color, a}, env)` | additive glow for `light:` sprites: lamps, windows, pools, fireflies, beacons |
| `glow` | `glow(ctx, pts, color, env)` | a lit pane in the BASE pass (window at night, lantern): `fillQuadShaded` with `glow` |
| `decal` | `decal(ctx, {x, y, w, h, color, trim, shape: rect/disc/diamond, face}, env)` | emblems on faces: banners, signs, stripes, crests (bottom-centre anchored) |
| `cube` | `cube(ctx, x, y, size, color, env)` | the H0 proof shape (three faces + decal + shadow); a reference composition, not for art |
| `posEnv` (H1) | `posEnv(env, pv, cx, cy) → env` | the env of a CACHED tile variant at block position `pv = tx & 7 \| (ty & 7) << 4`: the context origin is anchored to the 8×8-tile block's screen offset, `periodic: true` (256×128 px) |
| `field` / `marshField` (H1) | `field(env, seed, x, y, cell)`, `marshField(env, x, y)` | world-anchored noise at local px (periodic under a posEnv, free `vnoise` under a chunk env); the marsh pool field shared by the marsh tile and the knees overlay |
| `sites` (H1) | `sites(env, seed, cx, cy, cw, ch, pad, cb(x, y, r1, r2, r3, h)) → n` | world-anchored decoration sites (one jittered site per cw × ch cell, 256×128-periodic): a patch cut by a tile edge is finished by the neighbour |
| `macroGrain` (H1) | `macroGrain(ctx, pts, a, env)` | the LOW-frequency texture: a 256×128 periodic luminance field at `overlay` (the ground's light / dark drift across several tiles, no per-tile step); kept at lod 1 |
| `edgeFade` (H1) | `edgeFade(ctx, pts, a, b, depth, color, t, alpha)` | a band from edge a→b inward: shore sand / mud, shallows, the AO under a cliff lip or at its foot |
| `stroke` / `blade` / `puddle` (H1) | `stroke(ctx, pts, w, color, t, a, {smooth, cap, close})`, `blade(ctx, x, y, h, lean, color, t, w)`, `puddle(ctx, x, y, rx, ry, env, {t, spec, rim})` | toned polylines (strata, cracks, roots, lips), lit reed / grass blades (no gradient), standing water with a specular bar and cool rim |
| `strokePath` (H1) | `strokePath(ctx, w, env, {material: gravel \| asphalt \| boardwalk \| concrete, stub, seed, unit})` | the layered stroke of the CURRENT path under any CTM (`unit` = px per unit, 32 under render's iso ground transform): edge AO → curb / edge → body → lit crown → up-left highlight thread → the material's marks (lod 0) |
| `diamondGrown` (H1) | `diamondGrown(cx, cy, g) → 4 pts` | the clip for tile decorations: every edge pushed g px out so a site drawn by two neighbours leaves no AA hairline |

## 4. Accent colours

- **Purple `#461D7C` / gold `#FDD023`** are the school's marks, not materials: use them for banners, awnings, rails on
  bridges and road decks, lamp heads, signage, football and parade props, UI. Never tint terrain, water, bark or
  stone with them. Keep the pair together where possible (purple field, gold trim; gold centre dashes on purple
  rails). Their ramps: purple `#2B1246 / #461D7C / #5E2CA5 / #7F5BC5`, gold `#B58500 / #F5B700 / #FDD023 / #FFE680`.
- Warm night window glow `#FFD27A` (B3 windows under `SPR.NIGHT`; the lights pass adds the halo).
- Cool shadow tint `#2B2550` at 20 % is the ground-shadow and ramp-shadow colour; warm highlight tint `#FFE0A0`.

## 5. Night, the tint pass and the lights pass

- The sky tint (`render_fx passTint`, order 6) **multiplies** the whole frame: night `#0E1230` at .62, dusk `#6B3F8F`
  .35, dawn `#F7B58A` .25, golden `#FFCB6B` .20, storm `#2A3140`. Under multiply the ramps collapse toward the tint:
  tones 0–1 go nearly black, 2–3 stay readable, 4 keeps a little colour. So: **put silhouette information in tones
  2–4**, never only in 0–1, or it vanishes at night. Do not pre-darken sprites for night; the pass does it.
- The lights pass (order 7) draws additive (`lighter`) sprites from `light:<kind>` scaled by `nightAmount`: lamps,
  windows, beacons, canal sheen, fireflies, and since B1 **reflections** (`L.refl`: a lamp with water to its S or E,
  every deck lamp, a pilings building's windows) as a vertically stretched, 60 % pool below the source. Anything that
  should glow at night registers a light; it does not paint its own glow at full brightness in the sprite.
- Water at night: the live pass keeps its wave bands and switches glints to moon-silver `#C9D8FF` (golden hour gold
  `#FFE38A` 2 px, day white, dawn `#FFD9C0`, dusk `#FFB488`) — `GLINT_COL` / `GLINT_A` in `render.js`.

## 6. Resolution: how 2× and 0.5× are derived (the mechanism)

**Paint per zoom with shared ramps**, through the pen. A painter authors in 1× units (64×32 per tile) with
`P = BSU.sprites.pen(ctx, spec.zoom)`; the same code yields the 2× entry because every pen call paints an S×S block
(S = 2). So the 2× atlas is a crisp pixel-double of the 1× master (one art pixel = 2 screen pixels, the classic
pixel-art zoom), identical in silhouette and ramp. 0.5× draws the 1× entry at half size; the chunk pass draws the
ground with `imageSmoothingEnabled = true` at 0.5× (box-filtered, no sparkle), off under perf mode; sprites blitted
by the entity pass stay nearest-neighbour. The ground chunk canvas is 1× at every zoom (512×416, 0.85 MB each).

Consequences for later passes: detail you want visible at 2× must exist in the 1× master; do not paint sub-pixel
detail with `ctx` directly. Memory: `BSU.sprites.CANVAS_LIMIT_MB` = 8 is the GC trigger (lazily built, idle-600-frame
entries are dropped above it); 2× entries are built lazily on the first `get(id, v, f, 2)`; the 64 MB total
(`params.render.canvasBudgetMB`) is enforced by `render.evictChunks`. After a seed-42 start the atlas sits at ~23 MB
with 2× entries and the whole budget at ~90 MB counted with chunks and the compositing canvases (that number was
89 MB before B1). A future "true 2×" option would bake chunks at scale 2 (3.4 MB per chunk, ~8 visible at 2×); it was
not done in B1 because the deck windows, clip hexes and curve transforms are all in 1× chunk px.

## 7. Terrain and water conventions (B1 reference for B2/B5)

- Ground families: `tile:<T>` variant `0–7 | 8 shallow bed | pos << 4 (marsh)`, `tuft[:high]` 0–3, `patch:clover|dirt|lime`
  0–3, `shore:sand|mud|ripple` (mask) and `shore:beach` (the cove floor), `tone:warm|cool` (a 64×32 diamond the bake
  draws at ≤ .28 alpha), `worn` with bit 4 = dirt tones. `cliff` variant = face px, frame 0 south / 1 east.
- The bake (`render.js bakeChunk`): ground → tone diamond → faces/terrace bands → static water sheen → shore → reeds,
  knees, tufts, patches, path-side wear → canal → curves/stamps → crests → posts, mounds, debris → decks.
- Plant anchors for B2: a tree's shadow ellipse is `shadowPass`'s; trunks sit on the tile's diamond centre; tufts and
  patches avoid tiles with a surface or an owner, so plantings on open grass may assume those decorations exist.
- Water: beds stay teal (the live pass covers them at 55–85 % alpha, a brown bed only greys the water); deep (river,
  depth 4 ft) is the waterDeep ramp, bayou (1 ft) the lighter BED_MUD, shallow (< 1.5 ft) BED_SAND with sand ripples.
  Live: band A swells drift right (alpha .42), band B ripples drift left (.30, whiter); foam dashes along edges that
  meet land or marsh (.16–.32, blinking); flecks around deck stilts; current streaks on the bayou (toward the next
  bayou tile) and the river (south, east of `terrain.bank(ty)`); surge = `shade(waterNight, .72)` at .86 with debris
  and chop. Per-frame caps: 300 water tiles at 0.5×, 420 at 1×/2×, 700 in a surge (`C.waterCap*`).

## 8. Checklist for every art pass

1. **Contact sheet at each zoom**: screenshot the same camera at 0.5×, 1×, 2× (test/browser.mjs `launch()`,
   `BSU.render.setZoom`, `panToTile`); the 2× must be a clean pixel-double, the 0.5× must not sparkle.
2. **Seams**: a 2× crop across tile edges on flat ground and across a chunk border (`(tx & 7) === 7`); no rims, no
   repeating 1-tile pattern, no hairline between chunks (whole-pixel elevations, `round(elev·6)`).
3. **Night check**: `BSU.weather.scriptSky(state, BSU.SKY.NIGHT, .5)`; silhouettes still read (tones 2–4), lights
   registered through `render_fx gatherLights`, reflections where water meets a lamp.
4. **Golden hour and storm**: `SKY.GOLDEN` (warm multiply) and a landfall (`BSU.headless.forceHurricane(3)` then
   ticks) — surge water darker and choppier, debris visible.
5. **Overlays stay legible**: F (flood) and W (water) over the new ground; they draw after the bake and tint.
6. **Perf** in headless Chrome: `b.fps(2000)` ≥ 55 at 1× and 0.5×; chunk bake ≤ 2× the previous pass (`dirtyAll()`
   then 40 `headless.render()` calls, minus the clean frame cost, over `perf().chunks`); `BSU.sprites.memoryMB()`
   and `render.perf().memMB` reported; nothing allocated per frame in a live pass (scan for `new`, `[]`, `{}`,
   string concatenation inside the per-tile loops).
7. **Tests**: `node build.mjs --check && node test/smoke.mjs && node test/modules.mjs && node test/contract.test.mjs`
   and every `test/unit/*.test.mjs`; sprite tests assert sizes/anchors and ramp order, not pixel values.
8. **Notes**: add a `## art pass Bn` section to `docs/INTEGRATION_NOTES.md` with the before/after pairs and numbers.

## 9. Vegetation conventions (written in pass B2)

- **Variant packing for trees** (`sprites.treeVariant(stage, autumn, bloom, sil, water)`): `stage 0–2 | autumn 4 | bloom 8 |
  silhouette (0–3) << 4 | water 64`. The entity pass picks the silhouette from `hash(tx, ty) & 3`, so a row of oaks shows four
  shapes that never move; the icon and the Quad Lawn's oak (`get('oak', 2)`) are silhouette 0, the symmetric full crown. Trees
  are entities, so they do **not** carry the 64 positional variants of marsh tiles — four silhouettes keep the atlas small
  (12 oak entries, 48 cypress). Bit 64 is set by render for a cypress on a marsh / water tile: the sprite gets a tone-0
  waterline ring and a dithered trunk reflection in the 4 rows under the anchor instead of a ground shadow.
- **Canopies** come from `sprites.canopy(P, blobs, w, h, ramp, seed, opts)`: ellipse clusters lit from the upper-left of each
  cluster, leaf texture from `vnoise` (cell 5–6) through `toneAt` (amp .12), the lower `opts.under` of the height pulled to
  tones 0–1 with sun holes, a tone-0 outline on the right and bottom only (the lit top edge is painted in tones 3–4 inside
  the silhouette). It returns the bottom-edge points for moss and `.inside` (the mask) so `limb()` can draw branches only
  where no foliage covers them. Live oaks: a broad crown of 6–8 clusters, 2-px limbs from the trunk top to the side clusters,
  a 6-px trunk with a 4-px buttress over the bottom 6 rows (`trunk(P, x, top, w, h, flare, flareH)`: lit left column, tone-0
  right edge and bottom, flutes in the flare).
- **Bald cypress** is a spindle, not a cone: widest at 65 % of the crown height, each spray's reach from the seed (0.8–1.2),
  a tuck row between sprays with the trunk showing, tone 3 on the left third, 2 in the middle, 1 at the right rim, a ragged
  tone-0 underside with drips. Silhouette 3 at stage 2 is the flat-topped old cypress. November swaps the ramp
  (`cypressRust`), nothing else.
- **Spanish moss** is two-layered: baked strands from the canopy's bottom points (`mossStrands`, three length classes, tones
  1–2 with a tone-3 tip, long ones in two threads) and the live swaying strokes in `render.drawTree` (`MOSS_LIVE` = moss ramp
  tone 3, three length classes, wind × `C.mossSway`). Keep both: the baked strands survive 0.5× and perf mode.
- **Cypress knees** are not part of the tree: `knees` is a 64×32 tile overlay whose variant is the tile's position bits
  (`tx & 7 | (ty & 7) << 3`), baked on marsh / wet tiles under or 4-adjacent to a cypress. It samples the marsh painter's
  periodic field (same seed, cells 16×8 + 8×4, periods 256×128, plus the grain's mean .075) and plants 1–6 knees where
  `0.37 < n < 0.49` — the mud rim of the standing-water pools — clustered within 14×7 px of the first one. 64 variants at
  1× only (the chunk is 1× at every zoom) cost 0.5 MB.
- **Understory shrubs** (`shrub`, 22×12, 4 variants) are baked on open marsh tiles with dry / wet ground on a 4-side
  (`C.shrubPct` 38): a mound from the azalea-leaf ramp draped with moss. Azaleas bloom from the `azaleaBloom` ramp as plus-shaped
  clusters with a tone-4 petal highlight on the upper-left and a tone-1 centre; palmettos are fan fronds (petiole + 5–7 rays),
  two silhouettes (spreading / upright), back row in tone 1, front row lit in tone 3 with tone-4 tips.
- **Checklist additions:** a contact sheet of every vegetation entry on flat ramp bases (`veg_sheet.mjs` in the B2 scratchpad)
  is the fastest way to judge tones — judge silhouettes in the 2× atlas, then confirm in the marsh at 1× and the whole map at
  0.5×. Crowns must keep tones 2–4 on their lit tops so they still read at night.

## 10. Character conventions (written in pass B4)

- **One rig for everything that walks.** Students, the Wildlife Officer, the Bayou Brass, the krewe, boat crews and the parade riders are
  drawn by the football skeleton rig (`sprites_entities.js`: joints → two-bone IK → yaw → projection → depth buffer), re-skinned with
  `BSU.sprites.makeRamp` (5 tones), a Bayer-dithered tone pick (`tone5(u)` across a limb or torso, `sph5` on spheres, light from the upper
  left) and a **ramp-aware outline**: every empty pixel next to the figure takes the neighbour's tone 0 (tone 1 where the empty pixel lies
  above or left of it, the lit side). Animals and vehicles use the same capsule/orb/box primitives on a ground-plane projection
  (`scrC`: a point 1 px toward the viewer is 0.5 px lower, the 2:1 iso ground). Silhouette information lives in tones 2–4 (night multiplies
  tones 0–1 to black); purple tops use `#5E2CA5` or `#6B3FB5` more often than the dark brand `#461D7C` for that reason.
- **Facings and frames.** Every directional sprite is `frame = facing × per + k` with the football `fbDir` octant (0 SE, 1 S, 2 SW, 3 W,
  4 NW, 5 N, 6 NE, 7 E); agents.js's 0–3 `dir` maps to 0, 2, 4, 6. Sheets are one lazy canvas per (anim, look, facing, zoom).
- **Looks** are packed ints (skin, hair colour, purple/gold/other family, glasses, outfit, hair style, carried item, hat, build, accent) from a
  stratified pool of 112 (55 / 25 / 20 purple / gold / other tops), so the atlas is bounded; a saved game's old 9-bit look is upgraded from its
  own hash. Outfits mix the school colours with everyday ones; bottoms, shoes and the purple/gold shade vary per look.
- **0.5× has its own art.** The 1× entry is drawn at half size by the entity pass, so students get `agentfar:<anim>` sheets: the 1× frame
  reduced 2×2 (box filter) and re-expanded to 2×2 blocks, which lands exactly on screen pixels at 0.5× (no sparkle, the shirt colour survives).
  Everything bigger than a student (gators, vehicles, floats) is simply drawn at half size.
- **Bake budget.** Compose is cheap (≈ 0.06 ms a frame in Chrome) but a whole crowd of new looks is not: over a 3.2 ms per-frame budget
  `stuSheet` hands out the default student's sheet of that pose and queues the real one (`M.pumpBakes`), so there is no hitch; a sheet
  is updated in place, the SpriteRef stays valid.

## 11. Icon conventions (written in pass B6)

- **One frame, one ground.** `icon:<id>` is composed in a 64-unit frame (zoom 1 = 64×64, zoom 2 = 128×128 master, variant 1 = locked): a rounded Bayer-dithered purple backdrop lit from the
  upper left, a 1-px gold-tinted rim, a slab under everything (purple under buildings, grass / marsh / water under runs, plants and stilts) with the SW side lit and a lit rim on the upper edges.
  Do not add a new icon style: add a row to `buildIconPlan` (items in world px around the slab centre, a polygon, a ground, an optional target size).
- **What each kind shows.** Footprint rows: the building with `FRONT_L` (entrance, sign, arcade on the lit SW face), painted on a scratch canvas and freed (never cache extra atlas variants for
  an icon). Drag rows: a three-tile run along the SE axis (mask 10) so the lit SW side faces the viewer; decks (boardwalk, bridge) are drawn by `iconDeck` from the same materials as the map's
  decks. Plants: the mature tree. Paint rows: the patch they paint.
- **Scale.** Drawn size follows extent^0.22 between 42 and 60 px so a po'boy never vanishes beside the stadium; rows drawn ≥ 2.6× their true size carry a footprint badge ("1×1"). Sprites are
  scaled with smoothing; frame, slab, deck and padlock are integer pixel art on the pen.
- **Delivery.** `render.drawIcon(el, id, locked)` draws the 128 master at the element's device pixels (CSS size × dpr) so thumbnails stay 1:1 under `image-rendering: pixelated`; locked rows grey out
  with a padlock (`.locked` ancestor detected after attach, or the `locked` argument).

## Style C palette (settled in pass H1 — H2–H5 match these knots)

Every HD terrain / water surface is one ramp base and a `t`; nothing is hand-picked. Faces keep the brush offsets (`sw` lit −.08 … −.10,
`se` shadow −.42 … −.48). Masters: the same knots at 1 and 2; lod 1 (master 1, the 0.5× source) keeps the base, the seam stroke and the
macro drift and halves the sites (no micro grain, a quarter of the glints).

| surface | base (ramp / palette) | t and layers |
|---|---|---|
| grass (DRY) | `grass` #6E8F3C | base t 0; macro drift `overlay` .5; micro grain .18 (lod 0); light patches `highGrass` +.3 @ .24; dark patches base −.35 @ .2; tufts = orbs `grass` +.1 spec .3 |
| high ground | `highGrass` #7FA347 | base +.05; the grass layers; sandy patches `sand` +.2 @ .22 |
| wet ground | `wet` #5A6B3A | base t 0; mud patches `marshMud` −.2 @ .4; puddles `puddle` t −.25 spec .3 rim .2 |
| marsh | `wet` −.12 | pools where `marshField` < .42: `puddle` t −.4 (deep → `waterShallow`), AO ring `marshMud` −.9 @ .55; mud rim; reed clumps = `blade` `reed` +.1 (3–6 per clump) |
| drained / sinking | mix(`dirt`, `sand`, .22) +.08 | macro .45, grain .25; dark patches `dirt` −.3 @ .3; cracks = `stroke` `dirt` −.85 @ .7 |
| cliff / terrace face | `dirt` | plane t −.08 (S, lit) / −.42 (E, shadow), vert amp .22; topsoil +.12; strata `clay` −.05 with a `limestone` seam −.1 on faces ≥ 24 px; lip AO .38 over 9 px; foot AO .3; grass overhang orbs (`highGrass` +.15 S / `grass` −.2 E); 1–5 px steps: the band t −.23 / −.57 + a `grass` +.35 lip on the south edge |
| water deep (≥ 3 ft) | `waterDeep` #1B3A3A | base −.05; macro .3; rings base +.6 @ .28; glints `#FFFBEA` @ .5 (night `#C9D8FF` @ .45) |
| water mid | mix(`waterDeep`, `waterDay` #2E6B5E, .55) | base +.05 |
| water shallow (< 1.5 ft) | mix(`waterDay`, `waterShallow`, .22) | base +.12; sand ripples `waterShallow` +.35 @ .32 (lod 1 .22) |
| pond | mix(`waterDeep`, `reed`, .12) | base +.05; algae `reed` −.3 @ .55 |
| shore sand (land side) | `sand` #D9C9A1 | `edgeFade` +.2 @ .92 over 13 px, wet line −.35 @ .5 over 4.5 px, waterline stroke −.6 @ .45; shell flecks `limestone` +.6 |
| shore mud | `mud` #4A3B2A | `edgeFade` −.45 @ .9 over 9 px, −.95 @ .6 over 3 px; sheen `waterShallow` +.3 @ .4 |
| shallows (water side) | `waterShallow` #6FA895 | `edgeFade` +.55 @ .6 over 11 px; foam thread `#F2FFF8` @ .55; a second ripple +.5 @ .35 (lod 0) |
| cove beach | `sand` +.08 | macro .4, grain .2; damp toward the S / E edges −.4 @ .55 / −.3 @ .35 |
| gravel path | `gravel` #C9B47C | `strokePath`: edge −.6 @ .5 (w + 2.4 px), body 0, crown +.3 @ .5 (.55 w), thread +.85 @ .5, specks −.45 / +.9 (lod 0) |
| road | `asphalt` #3A3A40 | curb +.6 (w + 1.2 px), body 0, crown +.3 @ .3, gold centre dashes `gold` +.2 |
| boardwalk / deck | `deckWood` #9B6A48 | edge −.75, body 0, crown +.3 @ .5, plank gaps −.7 @ .6, weathered planks +.45 @ .4; posts `bark` −.1, rails `deckWood` −.85 |
| pedestrian bridge | `concrete` #B8B8BC | kerb −.35, body +.1, joints −.4 @ .5, centre line +.5 @ .6; piers −.1 / −.65 |
| stairs | `creamStone` / `deckWood` | tread −.25 / 0, riser −.8 / −.75, nosing +.5 / +.45 |
| levee | `grass` | crown plane +.12 (amp .1) with a gravel `strokePath` path; slope plane −.2 (vert, amp .22) + toe AO .35; back edge +.75 @ .6, lip −.7 @ .55; cracks `bark` −.6 when weak |
| floodwall | `steel` #8A8A8E / `concrete` | cap metal top +.25, face metal sw/se +.05, footing stone −.25; gauge stripes `purple`, ticks `gold` +.2 |
| canal | `waterDeep` | cut plane −.1 (vert amp .22), bank AO .45 over 4 px, mid line +.65 @ .45, lips `concrete` +.1 / −.3; gate `purple` metal, caps `gold` |
| ground tint (render) | `tone:warm` / `tone:cool` | the per-tile height / slope / noise diamond at HALF the pen strength (≤ .14) over the smooth ground |
| live water (render) | `waterShallow` → `waterDeep` by depth | fill alpha .2 over a baked HD water tile (`C.hdWaterLiveA`); flood water over land keeps .55–.85; surge .86 as before |

AO is always `#1E1946` (`edgeFade` / `softEllipse`), the specular `#FFFBEA`, the cool rim `#B8C8FF`; night glints `#C9D8FF` through `env.night`.

**Buildings (settled in pass H2a — `src/js/sprites_buildings_hd.js`, the 14 rows of tabs utilities / academic / housing; part 2 matches these).**
A row has ONE wall base (`paint.wall[0]`; `wall[1]` is ignored) and the brush face offsets do the rest (`sw` −.10 lit, `se` −.48 shadow, `top` +.05);
the trim is `paint.trim`, else limestone `#D9C9A3` (gold `#F5B700` on purple walls). Masters: the same knots at 1 and 2; lod 1 (master 1) keeps the
planes, the grain-free faces, the belt courses / cornice / plinth, 4 roof courses and the rail lines, and drops brick / stone courses, metal seams,
battens, mullions, balusters, awning stripes, gravel orbs and tin seams.

| surface | base (ramp / palette) | t and layers |
|---|---|---|
| stucco / brick / stone wall | `wall[0]` (cream `#F5ECD7`, brick `#B87A5A`, tan `#C9A97A`, white, limestone) | `fillQuadShaded` sw / se (brick = `stucco` + courses every 3 px at −.55 @ .3 with staggered joints; stone 5-px courses −.5 @ .35); belt courses trim +.5 / −.4 @ .75; cornice trim +.9 / 0 (1.4 px) over +.4 / −.5; plinth trim −.1 / −.6; front corner rim `#B8C8FF` @ .35; eave shadow `edgeFade` `#2B2550` −.6 @ .4 over 9 px |
| metal / wood / glass wall | `wall[0]` (`#8A8A8E`, `#B9A57C`, `#F5ECD7`) | `metal` seams every 7 px −.45 @ .4 + verticals every 12; `wood` battens every 4 px −.4 @ .35; `glass` mullions `iron` every 6 px |
| window (day) | `glass` `#A0D0FF` | `fillQuadShaded` glass; sill trim +.3 / −.3, lintel −.2 below that; mullion cross trim (lod 0); arched head = trim ellipse; shutters `accent` plane −.2 (amp .18) |
| window (night) | `#FFD27A` / `#FFE9A8` / `#F2B860` / `#FFDC8E` | 70 % lit: `brush.glow` pane (+ a `windowDark` curtain on a quarter @ .55); dark: `plane` `#3A3050` −.2 (amp .15); mullions `iron` 0 |
| door | `purple` (`gold` on purple walls) / `#2E5C2A` suites | surround trim +.2 / −.35 (amp .12); leaf `wood` sw / se; split −.6; transom glass (night `glow` #FFD27A); knob `gold` +.2 |
| clay tile roof | `roofColor` `#B5533C` | `roofPlane` nw / ne / sw / se (brush: eave −.2 → ridge +.45, courses −.5 @ .35 / +.6 @ .3, ridge specular on nw / sw); ridge cap +.6 (2 px); hips −.7 @ .45; fascia trim `wood` sw / se |
| tin / slate roof (sat < .12) | `#9AA3AC` bunkhouse, `#4C5566` suites, `#3F5E3A` institute (green: tile) | as tile + standing seams +.5 @ .35 every 6 px (lod 0) |
| flat roof | `roofColor` `#6E6E72` / `#8A8A8E` | parapet = wall faces −.12; top `stone` −.1, inner plane −.25 (amp .1), gravel orbs ±.4 (lod 0); coping trim +.5 / −.1 (1.2 px) |
| portico / arcade | trim (`#D9C9A3`) | columns `column` `#F3EBD8` r 1.7 in a band at face t −.32; entablature trim `stone`; pediment trim +.15 / −.3 with a `gold` disc (or the clock `white` +.3); arcade band face t −.55, piers `column` trim r 1.1, arch heads base −.75, keystone trim +.5, lit floor trim +.2 @ .5 (night `#FFD27A` +.4 @ .8) |
| gallery | trim slab / `iron` `#4A4C55` | slab `stone` top +.1 / −.25 (3 px out); rail `iron` +.3; balusters `iron` 0 every 2.5 px (lod 0); posts `column` `iron` r .7 every 12 px |
| awning / banner / sign | `accent` cloth / `purple` cloth / `purple` paint | awning `cloth` + `#E8E8E8` +.3 stripes (lod 0), edge −.6; Roux banner gold +.2 / −.2 border, gold diamond, `#E07020` stripe; sign gold +.1 edge, gold +.2 bars (night +.6 / +.7) |
| cupola / dome | `wall[0]` box, `gold` dome | louvers `iron` −.1 (night `#FFE9A8` +.5); cap trim +.8 / +.2; gold `orb` +.1 spec .5, finial gold +.5, `white` +.5 tip; library dome `orb` accent +.05 spec .55 on a `column` drum in the wall base |
| roof gear | `steel` `#8A8A8E`, `tin` `#9AA3AC`, `brick` stack | hvac three `metal` faces + an `iron` vent orb; tank `column` steel r 4 on `iron` legs, cap orb +.15; vents `column` tin r 1; stack `column` brick r 1.5, cap −.3 |
| apron: brick paving | `#A8604A` | `stone` top +.05, macro .3; joints every 6 px −.45 @ .4 / .25 (lod 0); curbs −.6 @ .8 (1.6 px) on the SW / SE edges, rims +.5 @ .7 on the back edges |
| apron: lawn | `#7FBF3C` | `wood` top 0 (no spec); mowing stripes `#74AD36` @ .55 per half tile; tufts `orb` +.25 (lod 0); hedges `orb` `#3F6B2E` ±.1 spec .15 every 3 px, 5.5 px inside the edge |
| apron: gravel / sand / pave | `#8A8A8E` / `#B3A27C` / `#D8D2C2` | `stone` top +.05, macro .3, specks `orb` ±.4; chain fence `#9A9AA0` posts `column` r .7 every 12 px, chain +.2 @ .7; pavers joints every 8 px −.4 @ .4 |
| walk / steps / planters / lamps | `#D5CBAE` / trim / `#9A6A44` + `#2E8B57` / `#2A2A32` | walk `stone` +.05 with −.55 edges; treads trim +.35 / +.1; pots `orb` clay +.1 spec .3, foliage green +.1, `azalea` dots +.3; lamp `column` r .8, head glass `#D8D8E0` (night `glow` #FFD27A + pool `softEllipse` #FFD27A @ .35) |
| tees | `gravel` `#C9B47C` / `asphalt` / `boardwalk` `#8B7355` | `stone` / `wood` strip +.05 with −.55 edges, plank gaps −.6 @ .6, `bark` posts + rail +.2; doorway base −.9 with a +.4 lintel (night transom `glow`) |
| pilings | `waterNight` `#1B3A3A` / `bark` | water `paint` −.15, macro .3, ripples `shallows` +.4 @ .5 (night `#C9D8FF`); stilts `column` bark r 1.4 every 12 px, braces −.2 @ .9, waterline ripple `shallows` +.3 |
| construction | `concrete` `#B0ADA6`, `block` `#9A9A9E`, `steel`, `plywood` `#B08D5E`, `wood` `#8B7355`, `crane` `#D9B33A` | slab `stone` +.1 / plane +.25; block walls `stone` raw; scaffold `column` steel r .6 every 8 px, ledgers −.2 @ .9 + plywood planks; crane `column` r 1.4, jib 0 (2 px), pendants `iron` +.2; openings base −.95; deck `wood` +.1, rafters +.5 / −.1 / +.2 |
| damage / boards / flood / ruin | `#2B2550` tint, `#B59A6A` sheathing, `tarp` `#3B6FD6`, `plywood`, `sandbag` `#C9B47C`, `stain` `#5A4A3A`, `rubble` `#6B625A` | DAMAGED `source-atop` cool @ .2; sheathing planes −.3; tarp `cloth` top + `tarpCrease` lines; boards `wood` + `iron` −.5 nails; cracked panes `#1B1B1B` + `white` @ .7; wall crack base −.95; FLOODED stain `edgeFade` −.3 @ .75, mineral line sandbag +.5 @ .6, sandbag orbs +.05 / −.35; wet apron `waterNight` −.2 @ .4 over 12 px; RUIN rubble `stone` −.15 + orbs ±.3 spec .1, stubs `column` r 1.2 |
| light companion `bldlight:<id>` | `#FFD27A` | lit panes `light({quad})` @ .9 halo 5; transom @ .7 halo 4; lamp heads `light` r 4 @ .8 + pools rx 8 ry 3.5 @ .45 (additive; same canvas and anchor as the building) |

**Buildings, part 2 (settled in pass H2b — the remaining 18 rows: dining / life / swamp / grounds / sports; the three vegetation rows stay the pen until H3).**

| surface | base (ramp / palette) | t and layers |
|---|---|---|
| apron: terrace (dining) | `#E3D7BE` | `stone` top 0, pavers joints every 8 px −.4 @ .4; café umbrellas: `column` `#2A2A32` r .45, canopy `orb` rim −.1 + `plane` cone +.25 in `gold` / `purple2`, chairs `#D8D2C2` −.5 |
| apron: plain lawn (grounds / sports / own-ground rows) | `#7FBF3C` | the lawn apron without hedges |
| barrel roof | `roofColor` `#5E8F5A` | five `plane` bands t −.05 / +.22 / +.32 / +.06 / −.3 (amp .08), seams −.45 / −.6 @ .55, ribs +.35 @ .3 (lod 0); the near end wall in the wall base with a fan window (night `glow`); crown specular +.6 @ .6 |
| belfry / spire / cross / impeller | trim / `roofColor` / `white` + `#E0443E` / `steel` | arched openings base −.9 under a trim arch, bells `gold` +.1 (night +.5) spec .5; spire planes +.15 / −.35 (amp .2) with a `gold` finial, the beacon on its tip; a white disc +.3 with a red cross; a steel disc +.1 in an `iron` −.2 rim, `gold` spokes +.2 |
| pool deck (rec centre) | `#D8D2C2` / `concrete` / `waterBlue` `#4FA3D6` | deck `stone` +.12, coping +.3, water `paint` +.12 (night −.05 with `#FFE9A8` pools @ .35), shallows `edgeFade` +.5, lane rope `gold` +.2, loungers `cloth` purple / gold |
| boil pot / dumpster / fountain / truck / airboat / lookout | `iron` / `#2E8B57` / `concrete` / `purple` / `steel` / `bark` | burner ring −.3, embers `#E07020` +.2, flame `#FFB347` +.4 / +.6, pot `column` `#1B1B1B` r 4.2, steam `softEllipse` `white` @ .22 (lod 0); dumpster `metal` sw + lid top +.1, `gold` bands +.2 / +.5; fountain basin `orb` +.05 + `puddle` +.05 spec .35, jets `white` +.2 @ .75 (phase by frame); pickup `paint` purple / purple2, `gold` stripe +.2; hull `metal`, cage `iron` −.1 / `steel` +.1; tower `bark` legs, plank deck `wood`, rail `gold` +.2, roof `tin` +.2 |
| turf (fields) | `#3F8F3B` | `wood` top in 8 stripes +.04 / −.18, macro .25; end zones `gold` `paint` +.05; yard lines `white` @ .75–.95 (0.8 px), hash marks @ .5 (lod 0); midfield disc `purple` +.05 with a `gold` diamond decal; practice field boundary at render.fieldQuad (0.6 / 0.3 in) |
| stands (stadium, Bayou Field) | `purple` / `purple2` / `concrete` | treads `paint` top +.12 / −.08 alternating with a +.45 seat lip (lod 0); risers `paint` sw / se −.25; end faces `stone` se (along X) / sw (along Y); back walls `stone` with the concourse band +.3 / −.1, vomitory slits −.7 (night `#FFE9A8` glow); rims `gold` +.2 (1.2 px), the field edge −.5 |
| bands / press box / boards | `concrete` / `glass` / `#1B1B1B` | concourse ledge `stone` top +.15 with slits (night glow); luxury boxes `stone` −.15 with `glass` panes (4 / 5 lit at night in the B3 glows); press box three `stone` faces, window band glass / glow, `gold` line +.2; scoreboard `paint` +.1 in a `gold` +.1 frame, marks +.2 (night +.5), clock bar −.7 / +.2; jumbotron `steel` frame, tiger crest `#E07020` +.1, ticker `purple2` / `gold` |
| masts / crown | `steel` / `gold` | `column` r 1.3 (1.6 on Cauldron Grand), cross-bracing −.3 @ .8 (lod 0), footing −.3; lamp bank `metal` +.1 with `#D8D8E0` lamps by day, `glow` white + `softEllipse` `#FFE9A8` @ .35 halo at night; crown lamps `orb` `gold` +.55 (dark 0) chasing with the frame, white tips +.5 |
| stadium site | `#8B6B4A` / `concrete` / `steel` / `#D9B33A` | graded dirt `stone` 0 macro .4, dozer tracks −.4 @ .5, sand piles `sandbag` +.2; footings `concrete` +.1; cranes `column` r 1.4; stand frames `steel` +.2 / −.3; fencing `steel` posts r .5, chain `#9A9AA0` +.1 / −.2, the orange gate `#E07020` |
| parking | `asphalt` `#3A3A40` | `stone` top 0, macro .3, bay stripes +.75 @ .85, lane +.6 @ .7, patches ±.3 (lod 0); cars `paint` sw + cabin `orb` +.1 spec .5; a `#2A2A32` light pole |
| pond | `mud` / `waterShallow` / `waterDeep` | mud rim `stone` −.1, shallows `paint` +.1 with `sand` +.3 `edgeFade` shores, deep `puddle` −.35 spec .3 rim .2; lily pads `#2E8B57` +.15, algae `reed` −.3, glints `#FFFBEA` @ .5 (night `#C9D8FF`); reed `blade`s +.1, pier `boardwalk` +.1 on `bark` posts |
| quad / rookery / bat house | `grass` / `mud` / `bark` | `brush.path` gravel 6 px; benches `wood` purple / gold on `iron` legs; `brush.tree` liveOak stage 1 — rookery: `puddle` −.1 round a `mud` −.05 island with `reed` blades, `brush.tree` cypress (in water) at .7, nests `bark` +.2 / −.45 with an `offWhite` egg, spoonbills `#F2A3B3` +.2; bat house `column` `bark` r 1.1 (36 px), gourds `orb` `offWhite` +.2 spec .35 |
| Tiger Habitat (sprites.HABITAT) | `#9C978E` stone, `#8A7D70` rock, `brick`, `limestone` | plaza `stone` +.05 with joints (lod 0), curbs +.15, the wall's shadow `edgeFade` cool −.2 @ .5; floor `#6E8F3C` `wood` 0 macro .45, worn tracks `#8B6B4A` +.1, nap spot `#7FA347` @ .6; pool metaballs: `sand` +.15 → `waterShallow` +.1 → `waterDeep` +.3, oak reflection `#2E5A2A` @ .35, glints; back rock `plane` −.1 / −.42 (vert amp .22) with strata −.55 (lod 0), moss `#7A8B4E` +.1, crest blades; waterfall `plane` shallows +.45 + `white` streaks @ .55, foam orbs; den `limestone` surround + arch, room `#1B1424` with a `#FFB45A` glow at night; sign `purple` paint, `gold` border + bars; walls `stone` sw / se with +.45 coping and a `limestone` +.5 line; railing `purple` posts r .5, `gold` / `purple2` finials, rails +.3 / −.2; glass `#CFE8FF` @ .22 with `white` sheens @ .45, `iron` mullions, `gold` caps; benches `wood` on `iron`; lamps as the margins'; flood `#7C9A92` @ .82 |
| companion hooks `bldlight:` | `#FFE9A8` / `#FFD27A` / `#FFB45A` | stadium: mast heads `light` r 5 (7 on Cauldron Grand) @ .85, press box band @ .6 halo 4, board `gold` @ .35, luxury boxes @ .4; habitat: the den @ .5 halo 4, pier lamps r 3 @ .6; parking: the pole r 4 @ .8 + pool; Bayou Field: the booth r 3 @ .5 |
