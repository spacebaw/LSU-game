# Bayou State — art style guide (Track B, written in pass B1)

Every later art pass (B2 vegetation, B3 buildings, B4 characters, B5 effects, B6 icons) follows this file. The
mechanisms it names live in `src/js/sprites.js` (`BSU.sprites.ramp`, `vnoise`, `pnoise`, `toneAt`, `bayer`, the pen)
and `src/js/render.js` (`bakeChunk`, `groundTone`, `waterPass`). Read `docs/INTEGRATION_NOTES.md` "## art pass B1"
for what B1 changed and measured.

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

## 2. Material ramps (5 tones)

Every material is a 5-tone ramp: **0 deep shadow, 1 shadow, 2 base, 3 light, 4 highlight**. `BSU.sprites.ramp(name)`
returns it; `BSU.sprites.makeRamp(baseHex)` builds one for a new material. Shadows lean **cool** (toward `#2B2550`:
deep = `mix(shade(base, .52), cool, .30)`, shadow = `mix(shade(base, .74), cool, .16)`), highlights lean **warm**
(toward `#FFE0A0`: light = `mix(shade(base, 1.16), warm, .12)`, highlight = `mix(shade(base, 1.34), warm, .28)`).
Never hand-pick a fourth green: pick a tone index. The ramps B1 uses (base = the palette colour where one exists):

| material     | 0 deep  | 1 shadow | 2 base  | 3 light | 4 highlight |
|--------------|---------|----------|---------|---------|-------------|
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

(The last seven are B2's vegetation ramps: `oakLeaf`, `cypressLeaf`, `cypressRust`, `palmLeaf`, `azaleaLeaf`, `azaleaBloom`, `moss`.)

Distribution on a flat surface: mostly 2 with islands of 3, threads of 1, a few px of 0 and 4
(`TH_GROUND = [0.14, 0.36, 0.70, 0.90]` over a noise value in [0, 1)).

## 3. Outlines, dither, noise

- **1-px darker outline** on every silhouette that stands against sky or water: tone 0 of its own ramp (not black),
  on the shadow side and the bottom; the lit top edge gets tone 3 or 4 instead. Ground tiles have **no** rims (the old
  per-tile NW/SE facet rims were the tile grid) — height reads from faces, terrace bands, the lit lip on the south
  terrace edge and `groundTone`.
- **Dither, never bands**: flat areas and gradients choose tones through `toneAt(n, x, y, thresholds, amp)`, which
  adds a 4×4 Bayer offset (`bayer(x, y)`, ±0.47 × amp) before thresholding, so adjacent tones interleave over a band
  of ~amp instead of meeting on a hard line. Use amp 0.08–0.12 for ground, 0.15–0.2 for skies and large walls.
- **Noise**: `vnoise(seed, x, y, cell)` is smooth value noise (bilinear + smoothstep); stack two octaves (e.g. cell 13
  at .55 + cell 5 at .30) plus .15 of hash grain. Iso surfaces sample `y × 2` so the blobs come out 2:1. Where tiles
  must join without a seam use `pnoise(seed, x, y, cellX, cellY, perX, perY)` with the sprite's map position
  (`variant` bits 4–9 = `tx & 7 | (ty & 7) << 3`, screen-space origin `((px − py)·32 + 256, (px + py)·16)`, periods
  256 × 128): marsh pools do this and cross tile edges. Ground types without position bits pull the outer 16 % of the
  diamond toward the base tone instead (`ed > 0.84`), which is what makes two random variants meet invisibly.

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
