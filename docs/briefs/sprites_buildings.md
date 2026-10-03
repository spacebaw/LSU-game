# Brief: `src/js/sprites_buildings.js` → extends `BSU.sprites` (`paintBuilding`, roof library, decal placement, the 6 variants, tiers, Ms. Thibodeaux)

Read first: `docs/briefs/sprites.md` (the atlas core you extend: cache keys, anchors, helpers, palette), `docs/ARCHITECTURE.md` §1 (row 11), §3.1 (`BSU.SPR` bits: `NIGHT 1, DAMAGED 2, PILINGS 4, SCAFFOLD 8, RUIN 16, TIER_SHIFT 5, TIER_MASK 3<<5, BOARDED 128`), §4.1 (`paint`, `tiers`, `effects.special`), §6.1 (building anchor), §6.3 pass 4 (which variant bits render sets and when), D17; `docs/GDD.md` §12.3 (buildings: "one parameterized painter … 43 rows × ~5 variants ≈ 215 small canvases in ~160 ms"), §4 (intro: house style, the decal library, the Visual column of every row 4–43), §0.3 (footprints), §12.2 (palette), §11.1 (Ms. Thibodeaux 48×48), §4.6 (Bayou Field bleachers, Stadium I–III), §4.8 row 30 (Pilings: +10 px lift over dark posts).

---

## 1. Purpose and public surface

The **one parameterized building painter** and everything it needs: an isometric box from the footprint, three-tone face shading, the roof library, the window grid (with the seeded night pattern), decal placement, the 1-px outline, gold trim on purple faces, the six variant treatments (normal, night, damaged, pilings, scaffold, ruin), the tier looks (Bayou Field, Stadium I/II/III), the special painters for rows that are not boxes, and the Ms. Thibodeaux portrait. Registered on the shared atlas at definition time:

```js
// registered families (definition time, plain objects only):
BSU.sprites.registerPainter('building', (ctx, spec) => BSU.sprites.paintBuilding(ctx, spec.row, spec.variant, spec.frame, spec.zoom, spec.seed));
BSU.sprites.registerPainter('ruin', …);        // id 'ruin:<w>x<h>' — a rubble pile sized to the footprint
BSU.sprites.registerPainter('thibodeaux', …);  // 48×48, frames 0 neutral / 1 speaking
BSU.sprites.registerPainter('icon', …);        // id 'icon:<catalogId>' — the 64×64 palette icon (the sprite scaled to fit with a 2-px margin)

BSU.sprites.paintBuilding(ctx, row, variant, frame, zoom, seed = 0) → {w, h, ox, oy}
BSU.sprites.buildingBox(row, variant, zoom) → {w, h, ox, oy, floors, wallH, roofH, lift, fw, fh}   // pure geometry (no ctx), used by size()/tests
BSU.sprites.roofs   // {flat(ctx, g, color), gable, hip, dome, barrel, bowl, none} — each draws over the box top given the geometry g
BSU.sprites.placeDecal(ctx, g, name, anchor, frame) → void
```

`spec.seed` for buildings = `Building.data.seed` (render passes it through `get(id, variant, frame, zoom)`? The cache key has no seed → **decision:** the night window pattern is seeded from `hash(row.n, variant)` only (same pattern for every dorm; the GDD's "seeded pattern" is satisfied per row); per-building variation is achieved by render choosing `frame` = `data.seed % frames` for the NIGHT variant, where NIGHT has **4 frames** (four different lit-window patterns). No per-building canvases.

## 2. State fields

None. Reads `BSU.data.catalog` rows (`w, h, paint, tiers, effects.special`), `BSU.params.palette`, the helpers from `sprites.js`.

## 3. Events

None.

## 4. Rules checklist

### Tier 1

**Geometry (`buildingBox`)** — footprint `fw × fh` tiles after rotation (`variant` does not encode rotation; **rotation** is encoded in the id request as `frame`? No. Decision: render requests `get(type + (rot ? ':r' : ''), …)`: the family resolver in `sprites.js` maps `dorm:r` → family `building`, sub `'r'` → `spec.rot = 1` and the painter swaps `fw/fh`. Add this rule to the core resolver (this brief owns the change; note it in `sprites.js`'s header).
- [ ] At zoom 1: ground diamond spans `x ∈ [−fw·32, +fh·32]` and `y ∈ [−(fw+fh−1)·16, +16]` relative to the anchor (the south corner tile's center). Wall height `wallH = floors × 14`; roof height by type: flat 4 (parapet), gable `min(fw,fh)·8`, hip `min(fw,fh)·6`, dome `min(fw,fh)·12`, barrel `min(fw,fh)·8`, bowl 10, none 0. `lift = (variant & PILINGS) ? 10 : 0`. Padding 2 px. Canvas `w = (fw+fh)·32 + 4`, `h = (fw+fh)·16 + wallH + roofH + lift + 4`; `ox = −fw·32 − 2`, `oy = −((fw+fh−1)·16 + wallH + roofH + lift) − 2`. Multiply every px by `zoom` (2× is Tier 2; write the code with `S = zoom`).
- [ ] Faces: the **left face** is the SW face (the edge from the W vertex to the S vertex), the **right face** the SE face (S vertex to E vertex). Left face color `paint.wall[0]`, right `paint.wall[1]`; three tones: left `shade(c, .78)`, right `shade(c, .92)`, top/roof `shade(roofColor, 1.0)`; a 1-px `shade(c, .55)` outline around the whole silhouette; a 1-px `shade(c, 1.15)` highlight along the top edge of each face.
- [ ] Build the box from horizontal `fillRect` runs: for each face, for each of the `wallH` rows, the run between the two slanted edges (slope 1:2). Never use paths.
- [ ] Windows: `paint.windows = {cols, rows}` per face (cols along the face, rows = floors); each 2×3 px; day color `shade(wall, .6)`; NIGHT variant: lit `windowGlow` for cells where `hash(row.n × 131 + frame, cellIndex) % 100 < 70`, else dark `#3A3050`; door: a 4×6 purple rectangle at the base of the right face's center.
- [ ] Gold trim: if a wall hex is a purple (`#461D7C`/`#5E2CA5`), draw a 1-px `gold` cornice under the roof.
- [ ] Roof library: **flat** — a `shade(roofColor,.9)` top diamond + a 4-px parapet; **gable** — two sloped planes meeting on a ridge along the longer axis (draw as two shaded diamonds halves); **hip** — a pyramid-ish top: top diamond shrunk by 1/3 with four planes (`shade` .95/.85/.8/.7); **dome** — a gold (`paint.accent`) half-ellipse of radius `min(fw,fh)·12` on the roof center with a 2-tone highlight; **barrel** — a half-cylinder along the longer axis (5 shaded bands); **bowl** — the stadium: an oval ring 10 px tall with `purple` outer, `gold` inner lip, and the crowd field (see stadium). `roofColor` from `paint.roofColor` (terracotta by default).
- [ ] Decals: `paint.decals[]` placed by name with `data.decals[name].anchor`: `roof` → centered on the roof top; `ground` → on the ground diamond in front (S vertex minus 12 px); `side` → on the right face center; special placements for `dumpster` (**not** on the footprint: render draws `decal:dumpster` on `Building.data.dumpsterTile` separately; the painter skips it), `arcade` (along the base of both faces), `columns` (right face), `clock` (right face upper center), `awning` (over the door), `masts` (the six poles around the bowl), `letters` (on the bowl's outer face), `jumbotron` (behind the bowl's N corner), `bleachers` (two banks on the field's W and E sides), `goalposts` (at the N and S ends of the field), `cars` (the lot's surface), `pool` (inside the rec center's top), `stilts` (under the box in the PILINGS variant), `scaffold`, `tarp`, `plywood`.
- [ ] Variants (bitmask; combine in this order): base → `TIER` (bits 5–6 select `tiers[tier−1]` overrides and the tier look) → `PILINGS` (lift 10 px; draw a grid of `bark` 3×10 stilts under the box every 12 px with `mix(waterNight, mud, .5)` visible beneath) → `NIGHT` (lit windows; 4 frames) → `DAMAGED` (whole sprite `shade` .8 + `decal:tarp` tiled over the roof (blue `#3B6FD6` with 1-px `#2B4F9E` creases) + 2 broken-window cells) → `BOARDED` (plywood over every window cell) → `SCAFFOLD` (only the box's outline + `decal:scaffold` lattice over the faces, no roof, no windows, dust is particles; 3 frames for the build rise: frame 0 = foundation slab, 1 = half height, 2 = full height with lattice — render picks `frame = floor(built × 3)`) → `RUIN` (ignore everything: draw `ruin:<fw>x<fh>`: a `shade(wall,.6)` rubble mound with 3 standing wall stubs and a blue tarp corner). Any combination must render (e.g. `NIGHT|PILINGS|BOARDED`).
- [ ] The 2° tilt for sunk ≥ 1.5 ft is render's (a `rotate` around the anchor), not a variant.

**Special painters** (`paint.special`; box rules still apply where noted; sizes at 1×):
- [ ] `substation` (2×2): gray gravel pad (`#8A8A8E` diamond), two `#5A5A60` transformer boxes 12×10, tall 1-px insulators with 2×2 white tips; `decal:beacon` red (blinking is the `light:blink` sprite in the lights pass).
- [ ] `water_tower` (2×2): a `purple` cylinder tank 24×18 with a `gold` "BSU" band (pixel letters 3×5), on four 2-px `#5A5A60` legs 28 px tall, a cone cap; frames: 0 upright, 1–2 sway ±2 px (render uses them in storm wind), 3 toppled (on its side on the pad).
- [ ] `generator` (1×1): a `gold` 16×10 box on a `#5A5A60` skid, a 3-px exhaust stub (puffs are particles).
- [ ] `wastewater` (3×3): two round `#B8B8BC` clarifiers 28 px diameter with `#4A6A4A` water inside, a low `tanStucco` office box (1 floor), `decal:vents`.
- [ ] `founders_hall` (3×3, box 2 floors): house style + `columns`, `clock`, `flag` (purple with gold), the cream stucco; **the origin of the house style**.
- [ ] `lecture_hall` (3×2): tan brick box, `windows {5,2}` arched (draw a 1-px `creamStone` arch pixel above each), `awning`.
- [ ] `library` (4×3): house style + `dome` gold over the arcade; NIGHT: warm windows + 2 lantern pixels at the steps.
- [ ] `engineering` (4×3): gray concrete `#8A8A8E`/`#6E6E72` flat roof, `pipes` (gold), `crane` (4 frames rotating).
- [ ] `coastal_institute` (3×3): always PILINGS; green `#3F5E3A` flat roof, a dock plank strip to the S vertex, `airboat`, `dish` (2 frames).
- [ ] `dorm` (3×2): 4-story brick `#A0522D`/`#8B4513` slab, `windows {6,4}`, purple 4×6 doors, `couch` on the roof.
- [ ] `res_tower` (3×3): 12 floors house style, terracotta cap, a vertical `gold` 1-px stripe, `tank` on the roof; NIGHT: the seeded lit pattern.
- [ ] `greek_house` (2×2): white `#F8F8F8` box with `columns`, gold "ΒΣΥ" as three 3×5 pixel glyphs (draw B, Σ, Y in pixels), `lights` string, a porch step strip.
- [ ] `dining_hall` (3×2): long low 1-floor house-style hall, big 4×3 windows, `vents`, `boilpot` at the S vertex (smoke is particles), the dumpster is drawn by render on its tile.
- [ ] `poboy` (1×1): a 14×12 shack with a `#8A8A8E` tin gable roof, a hand-painted `sign` (gold 10×4), a 3-px door; the queue is agents.
- [ ] `practice_field` (4×3, tier 0): striped turf (alternating `dryGrass`/`shade(dryGrass,.9)` 8-px stripes across the diamond), `goalposts` gold, two `purple` 4×3 sled pixels; tier 1 (Bayou Field): + `bleachers` decal (two banks, scoreboard on poles, gold "BAYOU FIELD" banner).
- [ ] `stadium` (6×5): tier 1 "Red Stick Stadium": single-deck `#B8B8BC` concrete stands on the W and E sides (two 96×24 blocks), 4 light poles (`masts` ×4), gold end zones on the field; tier 2 "The Cauldron": full `bowl` roof type — an oval `purple` upper deck ring 10 px tall, 6 `masts`, `letters` "CAULDRON" on the S face; tier 3 "Cauldron Grand": three decks (three stacked rings, each 8 px, `purple`/`purple2`/`purpleHi`), `jumbotron`, a `gold` ring of 12 pixels around the rim (the permanent gold light ring is the lights pass; the pixel ring is the sprite). The **crowd** is not in the sprite: render_fx draws the per-seat noise field over the bowl interior (the painter exposes `g.bowlRect` in `buildingBox` for tiers ≥ 1: `{x, y, w, h}` of the seating oval relative to the anchor).
- [ ] `union` (4×3): house style, double-height `arcade`, purple `banner`s, a plaza strip with `fountain`, big steps (3 1-px `creamStone` lines).
- [ ] `rec_center` (3×3): house style with a terracotta `barrel` roof over the gym half and a flat half with the `pool` visible (blue with a gold lane line), a 6×10 climbing wall pixel block.
- [ ] `health_center` (2×2): white `#F8F8F8` clinic, a `gold` fleur-de-lis 5×5 pixel glyph where the cross would be, an ambulance bay (a 10×6 opening).
- [ ] `quad` (2×2): bright `#7FBF3C` lawn diamond with two `gravel` diagonal path lines, 2 picnic-blanket 4×3 pixels (purple, gold), and the **auto-planted oak** drawn as the `oak` stage-2 sprite centered on the footprint (the painter calls `BSU.sprites.get('oak', 2)` and draws it — the entities file must be loaded; it is, by manifest order).
- [ ] `parking` (3×2): `asphalt` diamond, white 1-px lines every 8 px, `cars` decal (30 cars); frame 1 = cars bobbing (offset) for the flooded state.
- [ ] `pond` (2×2): a `waterNight`→`shallows` oval filling the 2×2 diamond, `reeds` tufts on the rim, a 6×3 `bark` bench; the egret is an entity.
- [ ] `abatement` (1×1): a small `purple` shed 14×12 with a `gold` door; the truck is a vehicle.
- [ ] `bat_house` (1×1): a 2-px `bark` pole 28 px tall with `gourds` (6 white gourds) at the top; the martins swirl is particles.
- [ ] `wildlife_post` (1×1): a `#C2B280` khaki cabin 16×12, a `truck` (purple), an `airboat` on a trailer, a 6×8 wanted-poster board (3 tiny name lines as 1-px dashes).
- [ ] `bell_tower` (2×2): a `#D9C9A3` limestone tower, 6 floors × 14 = 84 px + a 16-px spire, gold `clock` on two faces, a purple `flag`, the gold halo is the lights pass.
- [ ] `tiger_habitat` (3×3): a `#8A8A8E` rock-wall enclosure, a `waterBlue` pool, an oak (stage 1) inside, a 1-px `#A0D0FF` glass wall on the S faces; Roux is an entity.
- [ ] `surge_barrier` (`w` = run length × 1): two `#B8B8BC` concrete towers 16×40 at the run's ends, a `#6A6A70` steel gate with `gold` 2-px stripes between them; frames 0–3 = the gate dropping (raised → down; render animates over 20 ticks when `gate:closed`); an amber `light:beacon` is the lights pass.
- [ ] `marsh_restoration` (1×1): a `#4A8A4A` green field office 14×10 with a purple "BSU Coastal" `sign`, an `airboat` beside; the saplings on painted tiles are `cypress` stage 0 entities (Tier 2).
- [ ] `rookery` (2×2): PILINGS always; a stilted `boardwalk`-colored platform 40×12 with a `gold` 1-px rail over a cypress island (one `cypress` stage 2 sprite) with 4 `nest` decals and 3 pink `#F4A6C0` 10×14 spoonbill pixels standing.

**Ms. Thibodeaux** (`thibodeaux`, 48×48, 2 frames): a bust on a `panel`-colored disc: `#8D5524` skin, black hair in a bun, a `purple` blazer, `gold` 2×2 earrings, `#C0C0C0` reading glasses on a 1-px `gold` chain; frame 1 opens the mouth 2 px (speaking).

**Palette icons** (`icon:<id>`, 64×64): the `variant 0` sprite drawn scaled (integer factor ≤ 1 or nearest-neighbor downscale via `drawImage` with smoothing off) to fit 60×60, centered; drag/paint rows draw their `surf`/`levee`/`canal`/`preservePost` tile with mask 5 (N+S straight); `pilings` draws a dorm on stilts at 0.5×.

**Timing**: ~215 canvases at load (43 rows × the 6 base variants; tiers 0–1) in ≤ 160 ms (GDD) — the atlas total budget is 400 ms; keep `paintBuilding` under 0.7 ms average (no dither over large areas; windows by `fillRect`).

### Tier 2

- [ ] Stadium III sprite polish, jumbotron animation, the fireworks ring (cut #2) — the tier-3 painter must still produce a plausible box in Tier 1 (three rings + letters).
- [ ] The 2× atlas (`zoom = 2` scaling in every painter).
- [ ] BSU West hall (a founders-style hall recolored `purple2`).

## 5. Edge cases and invariants

- Every catalog id × every combination of variant bits returns a sprite; unknown `special` → the plain box.
- `tiers` beyond the row's list → clamp to the last tier.
- The painter must never read `state`; everything comes from the row, the variant, the frame, the seed.
- Headless: no-op context; sizes still correct.
- Deterministic: the same inputs give the same pixels (hash-seeded, no `rng.fx`).
- No `fillText` (OS fonts differ); letters are pixel glyphs from a tiny 3×5 font table (define `BSU.sprites.glyph(ctx, ch, x, y, color)` for `A–Z, 0–9, Σ, Β, Υ` — the union/greek/stadium letters).

## 6. selfTest() requirements

`sprites_buildings.js` has no separate `selfTest` (the module is `BSU.sprites`; `sprites.js` owns `selfTest`). It **adds** to the core self-test through `BSU.sprites._tests.push(fn)` (the core runs every registered test function):

1. `buildingBox(catalog.dorm, 0, 1)` → `fw 3, fh 2, floors 4, wallH 56, roofH 12 (hip: min(3,2)·6)`, `w === 5·32 + 4`, `ox === −98`, `oy + h === 18` (bottom vertex 16 px below the anchor + 2 pad).
2. `buildingBox(catalog.dorm, PILINGS, 1).lift === 10` and `h` is 10 larger.
3. Rotation: `buildingBox` for `dorm:r` swaps to `fw 2, fh 3`, `ox === −66`.
4. `stadium` tier 3 `bowlRect` non-null; tier 0 (unbuilt row default) null.
5. NIGHT has 4 frames (`frames('dorm') === 4` when variant NIGHT — expose `frames(id, variant)`), SCAFFOLD 3, `water_tower` 4, `surge_barrier` 4, others 1.
6. `thibodeaux` is 48×48 with 2 frames; `icon:dorm` is 64×64.
7. Every row's `paint.decals` names resolve through `placeDecal` without throwing (call the painter for every row with all 6 base variants: no exception, no `BSU.error`).

## 7. Testing in isolation

Use the atlas grid script from `docs/briefs/sprites.md` §7 (it loads all three sprites files). Add a second row of the grid that draws `dorm` in all 8 bit combinations of `NIGHT|DAMAGED|PILINGS` plus `BOARDED`, `SCAFFOLD` frames 0–2 and `RUIN`, and `stadium` tiers 1–3, `practice_field` tiers 0–1, `water_tower` frames 0–3. Screenshot with `node test/browser.mjs` and Read the PNG. Check: faces are two clear tones, the outline is exactly 1 px, windows are 2×3, the house-style rows share the cream/tan/terracotta look, Engineering is visibly gray/brutalist, Founders' has columns and a clock, the pilings variant floats 10 px over dark posts, the ruin is a rubble mound.

## 8. Performance budget

`paintBuilding` ≤ 0.7 ms average, ≤ 3 ms for the stadium tiers; the whole building set ≤ 160 ms at load. No `getImageData`, no gradients (except none here), no paths.

## 9. Done means

- The atlas screenshot matches every row's Visual column in GDD §4 closely enough that a reader can name each building without a label.
- `sprites.selfTest().ok` including the registered building tests; `node test/modules.mjs` passes.
- Render's entity pass draws buildings anchored correctly: a 3×2 dorm's footprint diamond exactly covers its six ground tiles at zoom 1 and 0.5 (check in Chrome with the `W` overlay's tile outlines).
