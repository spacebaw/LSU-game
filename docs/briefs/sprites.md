# Brief: `src/js/sprites.js` → `BSU.sprites` (atlas core, palette helpers, terrain/decal/water/light painters)

Read first: `docs/ARCHITECTURE.md` §1 (rows 10–12: this file creates the object the two split files extend), §3.1 (`BSU.SPR`, `BSU.MAP`), §3.2 `params.render` and `params.palette`, §6.1 (the atlas API, anchor conventions, the full id list — copy it), §6.3 (what the chunk baker and passes ask you for), §10.4 (`sprites.init ≤ 400 ms`), §10.5, §10.6, §11.2 #9 (the 2× atlas is Tier 2); `docs/GDD.md` §12.1 (projection, chunk baking list, water), §12.2 (palette — every hex), §12.3 (sprite table, terrain tile variants, crowd), §12.4 (lights list), §12.5–12.7 (what particles/FX need from the atlas), §3.2 (`surface` auto-tiling, lamps, culvert, bridge), §4.8 rows 25–27, 31, 35 (levee/floodwall/canal/fence/preserve visuals), §3.4 step 5 (the Mounds).

---

## 1. Purpose and public surface

The procedural sprite atlas: one cache of small canvases painted at load (1×) and on demand, addressed by `(id, variant, frame, zoom)`. This file owns the cache, the painter registry, the palette helpers and the **terrain-side painters** (ground tiles, cliffs, surfaces, levee/floodwall/canal/fence/preserve tiles, decals, water highlights, the Mounds, the light sprites). `sprites_buildings.js` registers the building painter; `sprites_entities.js` registers every moving thing. Nothing here draws to the screen; render does.

Module shape: `'use strict'` IIFE; `const M = (BSU.sprites = BSU.sprites || {})`; `init`, `reset` (keeps the atlas: `reset` only clears per-game lazily-built entries such as `ruin:<w>x<h>` — actually keep everything; `reset` is a no-op that reseeds `rng.fx`-driven variants? No: the atlas is seed-independent; `reset` is a no-op), `selfTest`. **No DOM at definition time**: `registerPainter` calls from split files are allowed at definition time (they touch only a plain object); canvases are created only inside `init` or lazily inside `get`.

```js
BSU.sprites.init(state) → void
BSU.sprites.get(id, variant = 0, frame = 0, zoom = 1) → SpriteRef | null
   // SpriteRef = {canvas, sx, sy, sw, sh, ox, oy}; zoom 0.5 → the 1× entry; zoom 2 → the 2× entry if built (Tier 2) else the 1× entry (render scales)
BSU.sprites.registerPainter(family, fn) → void          // fn(ctx, spec) → {w, h, ox, oy}; spec = {id, family, sub, variant, frame, zoom, row (catalog row for buildings), frames}
BSU.sprites.paintBuilding(ctx, row, variant, frame, zoom) → {w, h, ox, oy}   // defined by sprites_buildings.js
BSU.sprites.agentLook(seed) → number                     // skin (0–5) | hair (0–7) << 3 | shirt (0–2) << 6
BSU.sprites.memoryMB() → number
BSU.sprites.palette → BSU.params.palette
BSU.sprites.frames(id) → number                          // frame count of a family/id (render uses it to wrap animation)
BSU.sprites.size(id, variant, zoom) → {w, h}             // without painting (for the draw-list culling); paints if needed
// palette/pixel helpers (pure; used by the split files and render_fx):
BSU.sprites.hex(h) → [r,g,b];  BSU.sprites.rgb(r,g,b) → '#rrggbb';  BSU.sprites.shade(hex, k) → hex   // multiply each channel by k, clamp
BSU.sprites.mix(hexA, hexB, t) → hex
BSU.sprites.hash(a, b) → number (0..2^32)                // = BSU.rng.hash
BSU.sprites.tileVariant(tx, ty) → 0|1|2                  // hash(tx, ty) % 3
BSU.sprites.diamond(ctx, cx, cy, w, h, fill, stroke?) → void   // draws the 2:1 diamond centered at (cx, cy)
BSU.sprites.dither(ctx, x, y, w, h, c1, c2, seed, density = .5) → void   // 1-px checker/dither fill
BSU.sprites.px(ctx, x, y, color) → void                  // one pixel (fillRect 1×1)
BSU.sprites.newCanvas(w, h) → HTMLCanvasElement          // document.createElement('canvas') sized; headless: the stub element
BSU.sprites.CANVAS_LIMIT_MB = 8                          // atlas budget (render enforces the 64 MB total)
```

**Cache key:** `id + '|' + variant + '|' + frame + '|' + zoom`. **Family resolution:** `family = id.includes(':') ? id.slice(0, id.indexOf(':')) : (BSU.data.catalog[id] ? 'building' : id)`; `sub = the part after ':'` (e.g. `tile:4` → family `tile`, sub `'4'`; `decal:tarp` → `decal`, `'tarp'`; `light:lamp`; `ruin:3x2`; `agent:flee` → family `agent`, sub `'flee'`; bare `agent` → sub `'walk'`). Unknown family → `get` returns `null` and `BSU.error('sprites', 'get', …)` once per id. **Rotation suffix:** a catalog id followed by `:r` (e.g. `dorm:r`) resolves to family `building` with `spec.rot = 1` (the painter swaps `w/h`); this is how render requests rotated footprints (the variant int carries no rotation).

**Split-file hooks:** the core exposes `BSU.sprites._tests = []` (functions the split files push at definition time; `selfTest` runs each and merges failures into `notes`) and `BSU.sprites.frames(id, variant?)` (some building variants have several frames: NIGHT 4, SCAFFOLD 3, `water_tower` 4, `surge_barrier` 4 — the building painter registers per-id frame counts through `registerPainter`'s returned metadata: a painter may set `spec.frames` during its first call, and the core stores it).

**Anchors (ARCHITECTURE §6.1, D17):** `ox, oy` = offset from the anchor point to the sprite's top-left, in px at that zoom. Buildings: anchor = the screen position of the **south corner tile** `(tx+w−1, ty+h−1)` diamond center at ground elevation. Tiles/decals: the tile's diamond center. Agents/gators/vehicles: the entity's foot point. Trees: the tile center (trunk base). Lights: the light's center.

## 2. State fields

Owns nothing in `state`; reads nothing from `state` (painters take everything from `spec`). Reads `BSU.data` (catalog rows, `decals`), `BSU.params.palette/render`, `BSU.rng.fx` (never `rng.sim`) for cosmetic jitter that must not affect the sim — but **sprite variants must be deterministic**: use `BSU.rng.hash(seed, salt)` for anything per-building/per-tile (`row.paint`, `data.seed` passed in `spec.seed`), never `rng.fx`, so a re-bake produces the same pixels.

## 3. Events

Emits none. Listens to none (`init` only builds; render calls `get`).

## 4. Rules checklist

### Tier 1

**Palette (GDD §12.2; `params.palette`)** — expose as `sprites.palette` and use these exact hexes (never hard-code a hex elsewhere; every color in the game comes from this table or from a catalog row's `paint`):
- [ ] Purple `#461D7C`, `#5E2CA5`, highlights `#7F5BC5`, shadows `#2B1246`, panel `#1A1230`. Gold `#FDD023`, `#F5B700`, highlight `#FFE680`, shadow `#B58500`, window glow `#FFF1A8`. Water night `#1B3A3A` / day `#2E6B5E` / shallows `#6FA895`; reed `#8A9A4B`; mud `#4A3B2A`; wet ground `#5A6B3A`; dry grass `#6E8F3C`; high ground `#7FA347`; cypress `#3F5E3A` / autumn `#C7692B`; oak canopy `#3B5A2A`; moss `#9BAA8A`; bark `#3A2A1E`; gravel `#C9B47C`; asphalt `#3A3A40`; boardwalk `#8B7355`; azalea `#E75480`; cream stone `#F5ECD7`; tan stucco `#E8D9B5`; terracotta `#B5533C`; text `#F4EEE2`; danger `#E0443E`; good `#3FBF7F`; water-blue `#4FA3D6`. Sky tints (render's, but keep them here too): dawn `#F7B58A` .25, golden `#FFCB6B` .20, dusk `#6B3F8F` .35, night `#0E1230` .62, storm `#2A3140` .50, fog `#C9CFD1` .30.

**Geometry (GDD §12.1, §3.1)**
- [ ] Tile diamond 64×32 at zoom 1 (`BSU.MAP.TILE_W/TILE_H`); 6 px per foot (`PX_PER_FT`); `imageSmoothingEnabled = false` on every atlas context; integer pixel art only (no anti-aliased strokes: use `fillRect`, `px`, and `diamond` built from horizontal `fillRect` runs — never `arc`/`lineTo` with fractional coordinates).
- [ ] `diamond(ctx, cx, cy, w, h, fill)`: for each row `r` in `0..h−1` (h = 32): half-width `= round((w/2) × (1 − |r − h/2| / (h/2)))`; `fillRect(cx − half, cy − h/2 + r, 2 × half, 1)`. Optional 1-px darker edge.

**Ground tiles — family `tile`, id `tile:<T>`, variant 0–2 (hash), frame 0** (GDD §12.3 "3 dithered variants"; §3.3 colors):
- [ ] 64×32 diamond, `ox −32, oy −16`. Colors by `BSU.T`: OPEN_WATER `waterDay` (the chunk paints water tiles as flat day water under the live water pass), BAYOU `waterDay` shaded .9 with a 1-px lighter current line, MARSH `mud` base with `reed`-colored dither on top (density .35) — the "reeds over dark water" tint: the baked Marsh standing water is `mix(waterNight, mud, .5)` under the reed dither, WET `wetGround` with `mud` speckles (density .15), DRY `dryGrass`, HIGH `highGround`, DRAINED `mix(wetGround, mud, .4)` with cracked 1-px lines, POND `waterNight`. Variants differ by dither seed and ±4% brightness.
- [ ] `cliff` (id `cliff`, variant = face height in px 6…96, frame 0 = south face, 1 = east face): a 32-px-wide strip (half a tile edge) of `bark`-toned earth with horizontal strata lines every 4 px and a darker bottom; anchored at the face's top-left. The chunk baker draws it under the S/E edge of any tile ≥ 1 ft above its S/E neighbor.
- [ ] `reeds` (variants 0–2, frame 0–1 for a 2-frame sway baked as separate sprites): 12×14 tufts of `reed`/`shade(reed,.8)` lines; `knees` (0–2): 2–4 px `bark` nubs; `worn` (0–2): a 64×32 diamond overlay of `gravel` at 40% density (desire lines); `mound` (24×14, GDD §12.3): a grass-covered `highGround` mound with a `gravel` worn top and a 1-px `bark` outline, anchor tile center (`ox −12, oy −20`).

**Surfaces — family `surf`, id `surf:<SURF 1..4>`, variant = neighbor mask** (GDD §3.2, §4.1 visuals):
- [ ] `variant & 15` = 4-bit mask of 4-neighbors carrying the **same surface id** (N = 1 → `ty−1`, E = 2 → `tx+1`, S = 4 → `ty+1`, W = 8 → `tx−1`); this gives straight/corner/T/cross/end/isolated (16 shapes). Bit 16 = bridge (surface 2 on a water-flag tile: concrete piers under the diamond's S/E edges + purple 2-px railings along the run direction), bit 32 = the fence sign ("GATOR X-ING", a 10×6 gold plate on a post), bit 64 = culvert (canal under the surface: two 4-px dark pipe openings at the diamond's lower edges).
- [ ] Path (1): `gravel` strip 20 px wide along the run with `shade(gravel,.8)` edge dots; road (2): `asphalt` 28 px wide, gold center dashes (2×1 px every 6 px), 1-px `shade(asphalt, 1.3)` curbs; boardwalk (3): `boardwalk` planks (2-px planks separated by 1-px `shade(boardwalk,.7)` gaps) 24 px wide on 2×3-px `bark` posts at the diamond's lower edges with a 1-px shadow; fence (4): 1-px `shade(gold,.8)` posts every 8 px along the run with a 1-px `#8A8A8E` chain-link line (dither .5) between, drawn at the tile's center line.
- [ ] Runs: the mask decides which of the four diamond edges the strip connects to; an isolated tile (mask 0) draws a short stub in both directions (the ghost preview needs it).

**Levee / floodwall / canal / preserve — families `levee`, `floodwall`, `canal`, `preservePost`** (GDD §4.8 visuals):
- [ ] `levee` (variant = mask (bits 0–3) + 16 cracked crown (integrity < 50) + 32 bonfire? no — bonfires are entities): a grassy trapezoid berm 6 ft = 36 px high? **No**: crests are not drawn to scale in elevation (the tile's ground elevation already lifts the diamond by `6 px/ft`; render draws the levee tile at `elev + crest`? **Decision (render brief agrees):** levee/floodwall tiles are drawn at ground elevation with the berm/wall sprite rising **12 px** (levee) / **18 px** (floodwall) above the diamond, not 36/72 px, so walls read as walls without hiding what is behind them). Berm: `dryGrass` top strip, `shade(dryGrass,.75)` darker toe band, a `gravel` 6-px crown path along the run, mask-connected; cracked variant adds 3 dark 1-px cracks on the crown. `floodwall`: gray `#8A8A8E` T-wall panels 18 px high with `shade(#8A8A8E,.8)` joints every 8 px and purple 1-px flood-gauge stripes every 6 px (= 1 ft) on the visible face with tiny gold tick marks.
- [ ] `canal` (variant = mask + 16 culvert + 32 gate present + 64 gate closed): a straight cut 24 px wide with 1-px `#B8B8BC` concrete lips, `waterNight` bed, small `#6A6A70` culvert pipe openings at junctions (mask has ≥ 3 bits); gate: a purple 12×10 plate at the tile center, raised (open: drawn 6 px above the bed) or dropped (closed: on the bed with a 1-px `gold` stripe). The floodgate drop animation is render's (it lerps between the two variants).
- [ ] `preservePost` (variant = mask of **non-preserve** neighbors = the boundary edges): small 2×5 `gold` posts with a 1-px `goldShadow` base along each boundary edge; frame 0. The lookout-tower decal is `decal:lookout` on the first painted tile (render/buildings decide which).
- [ ] Sandbags: `decal:sandbags` (a 16×6 row of `#C9B47C` sacks with `bark` outlines) drawn by render on levee tiles with `sandbag > 0`.
- [ ] Burrow: `decal:burrow` 4×3 dark hole with a `mud` rim.

**Water highlights — family `water`** (GDD §12.1): `water` variant 0 = the static highlight for the 0.5× baked layer: a 64×32 diamond with two 1-px `shallows` sine lines (period 16 px, amplitude 2) and 3 sparkle pixels; variant 1 = surge water tint (darker: `shade(waterNight,.8)` with 4 `#5A4A3A` debris flecks). The live per-frame diamonds are render's own `fillRect`-run diamond (render uses `sprites.diamond` on the world canvas directly).

**Decals — family `decal`, id `decal:<name>`, one canvas per `data.decals` entry, size `{w, h}` from data, `frames` from data:** the GDD's ~30 + `plywood`, `burrow`, `nest`, `lookout`, `couch`, `crane`, `jumbotron`, `sandbags`, `sinking` (the Sinking! icon: 12×12 gold `!` on a purple disc), `noAccess` (red 12×12 with a white slash), `power` / `water` (12×12 red ⚡/💧 glyphs drawn as pixel icons, no emoji: a 3-px zigzag / a drop), `tarp` (roof-sized is not fixed: `decal:tarp` is 64×32 and render tiles it over the roof by drawing it once per footprint diamond), `dumpster` (12×8 `#4A6A4A` box, gold lid), `boilpot` (8×8 black pot on a 3-px flame, the smoke is particles), `cars` (a 64×32 diamond-shaped sheet of 30 4×2-px cars in purple/gold/white for the Parking Lot; frame 1 = the same cars offset 1 px down for the "bobbing" flooded state), `goalposts` (gold 8×14 Y), `bleachers` (two 24×10 aluminum banks + a 10×8 scoreboard on 2-px poles + a 24×6 gold "BAYOU FIELD" banner), `pool` (24×12 `waterBlue` rectangle with a gold 1-px lane line), `dome` (gold hemisphere 16 px radius, 3-tone), `dish` (2 frames: an 8×8 gray dish at two angles), `crane` (4 frames: a 14×10 rooftop crane arm rotating), `impeller` (2 frames: a 10×10 wheel with 4 spokes at 0°/45°), `gourds` (a cluster of 6 white 3×4 gourds), `beacon`/`blink`: red 3×3 dot (frame 0 dark, frame 1 lit), `flag` (2 frames: purple 8×6 with a gold F-de-lis pixel), `banner`, `lights` (string lights: 5 gold pixels on a 1-px line), `letters` (gold block letters "CAULDRON" 40×6), `masts` (6 light poles, 2×24 each with a 6×3 head), `stilts` (a 3×10 `bark` post, tiled by the pilings variant), `scaffold` (a 1-px `#8A7A5A` lattice; tiled over the box in the SCAFFOLD variant), `airboat` (14×8 with a 6×6 fan cage), `truck` (12×8 purple), `pipes` (gold 2-px pipes on a gray face), `vents` (3 2×3 gray boxes; steam is particles), `tank` (a 10×8 cylinder), `fountain` (8×8 blue with 2 white pixels), `reeds`, `sign`, `awning` (purple 14×4 striped), `arcade` (a row of 4 arched openings 6×8 in `shade(wall,.7)` with 1-px `creamStone` columns), `columns` (4 white 2×12 columns), `clock` (a 6×6 gold disc with 2 black hands), `plywood` (a `#B08D5E` 8×6 rectangle with 2 dark nails per window cell; the BOARDED variant tiles it over the window grid), `nest` (6×4 twig oval), `lookout` (12×24 `bark` tower with a gold rail), `couch` (8×4 purple), `jumbotron` (16×10 black with an 8×6 orange tiger pixel face, 2 frames).

**Lights — family `light`, id `light:<kind>`** (GDD §12.4): cached radial gradient canvases (the one place a gradient is allowed) for the additive pass: `lamp` (24×24, warm `glow` center → transparent), `window` (8×8, `windowGlow`), `mast` (48×96 cone, `#FFFFFF` → transparent, drawn rotated by render), `beacon` (32×32 gold), `blink` (8×8 red), `arc` (12×12 `waterBlue`), `glow` (16×16 gold, generator), `pot` (12×12 orange), `fire` (24×24 orange, bonfire), `firefly` (4×4 `#D8FF9A`), `eye` (3×3 red). Anchor = center (`ox = −w/2, oy = −h/2`).

**Agent look packing** — `agentLook(seed)`: `skin = hash(seed,1) % 6`, `hair = hash(seed,2) % 8`, `shirtRoll = hash(seed,3) % 100` → `shirt = roll < 55 ? 0 (purple) : roll < 80 ? 1 (gold) : 2 (white-gray)`; `look = skin | hair << 3 | shirt << 6`. Skin tones: `#F1C27D, #E0AC69, #C68642, #8D5524, #5C3A1E, #FFDBAC`; hair: `#1B1B1B, #3A2A1E, #6B4423, #B0723C, #E6C27A, #A8A8A8, #5E2CA5 (dyed purple), #C7692B`; shirts: `purple`, `gold`, `#E8E8E8`.

**Atlas build (`init`)** — ≤ 400 ms:
- [ ] Pre-bake at 1×: every `tile:<T>` × 3 variants; `cliff` for heights 6, 12, 18, 24, 36, 48 (others lazy); `surf:1..4` × 16 masks (bridge/sign/culvert variants lazy); `levee` × 16, `floodwall` × 16, `canal` × 16; `water` × 2; `reeds/knees/worn` × 3; every decal (frame 0); every light; **every catalog row** × the 6 base variants (`0`, `NIGHT`, `DAMAGED`, `PILINGS`, `SCAFFOLD`, `RUIN`) at tier 0 (tiered rows: tiers 0 and 1; higher tiers lazy) via `paintBuilding` (≈ 215 canvases); the agent base sheet for `look 0` (`agent` walk + idle); `gator` × 3 sizes × 3 frames; `roux`, `officer`, `pirogue`, `bus`, `thibodeaux`. Everything else lazily on the first `get`.
- [ ] Every entry is its **own canvas** (simplest; ~400 small canvases ≈ 3–5 MB). `memoryMB()` sums `w × h × 4` over the cache. If `memoryMB() > CANVAS_LIMIT_MB` (8), lazily-built entries not requested in the last 600 frames may be dropped (`sprites.gc(frameNo)`; render calls it every 300 frames).
- [ ] Headless: `document.createElement('canvas')` returns the stub; `getContext('2d')` is the no-op proxy; painters run to completion (all calls are no-ops), sizes are computed from the painter's return, so `get` returns non-null refs with correct `w,h,ox,oy`.
- [ ] Zoom 2 (Tier 2 #9): `get(id, v, f, 2)` builds a 2× entry by running the painter with `spec.zoom = 2` (painters scale their coordinates by `zoom`; the helper `S = zoom` multiplies every px). Until implemented, return the 1× entry (render draws it scaled).

### Tier 2

- [ ] The 2× atlas (all painters take `zoom` from the start; the flag to enable is one line).
- [ ] Autumn/bloom/seasonal recolors as separate variants (cypress autumn is Tier 1 via the tree variant bit; azalea bloom variant Tier 1).
- [ ] The crowd shader lives in render_fx (per-seat noise); nothing here.

## 5. Edge cases and invariants

- `get` never throws: unknown id → `null` + one `BSU.error`; a painter that throws → the id is cached as `null` (so a broken painter fails once, not every frame).
- Canvas sizes ≥ 1×1 (Chrome throws on 0); clamp.
- `frame` wraps modulo `frames(id)`; negative variants are clamped to 0.
- The building family needs the row: `spec.row = data.catalog[id]`; a tier beyond `tiers.length` → tier clamped.
- `memoryMB()` counts only atlas canvases; render adds chunks/composites.
- Deterministic pixels: same `(id, variant, frame, zoom, seed)` → same canvas; painters use `hash`, never `rng.fx`.
- Never `</script` in string literals; no emoji in canvas text (pixel glyphs only); no `fillText` in sprites (fonts differ per OS; the wordmark on the postcard is render_fx's one exception).

## 6. selfTest() requirements

Pure and fast (≤ 200 ms; painting on the stub is cheap, in a browser the entries are already cached by `init`).

1. `get(id, v, 0, 1)` is non-null with `w > 0, h > 0` for **every** catalog id × the 6 base variants (`0, NIGHT, DAMAGED, PILINGS, SCAFFOLD, RUIN`) and for stadium tiers 1–3 (`TIER_SHIFT`), practice_field tier 1, `BOARDED`.
2. Building sprite geometry: for a 3×2 row `w === 5 × 32 + 2 × pad`, `ox === −(3 × 32) − pad`, and `oy + h ≥ 16` (the ground diamond's bottom vertex is 16 px below the anchor) — using the constants in the sprites_buildings brief.
3. `agentLook`: packs and unpacks (`skin = look & 7`, `hair = (look >> 3) & 7`, `shirt = look >> 6`) for 100 seeds with `skin < 6`, `hair < 8`, `shirt < 3`; the shirt distribution over 1,000 seeds is 55/25/20 ± 5.
4. `tileVariant` ∈ {0,1,2} and stable; `hash` equals `BSU.rng.hash`.
5. `shade('#FDD023', .5) === '#7E6811'` (exact rounding rule: `round(c × k)`); `mix('#000000', '#FFFFFF', .5) === '#808080'`.
6. Every `data.decals` name resolves (`get('decal:' + name)` non-null with the data's `w,h`); every light kind resolves; `surf:1..4` × 16 masks resolve; `tile:0..7` × 3 resolve; `cliff` at 6 and 96 resolves.
7. `frames('agent')` = 16 (4 dirs × 4), `frames('agent:idle')` = 8, `frames('gator')` = 3 (see the entities brief's table); `get('agent', look, 17)` wraps to frame 1.
8. `memoryMB()` after `init` ≤ 8 (headless: computed from sizes, so the assertion holds without real canvases).
9. `get('nope:thing')` → `null` without throwing.

## 7. Testing in isolation

```js
// scratch/test_sprites.mjs — Node (stub canvas: sizes/anchors only) 
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true; const ctx = vm.createContext(win);
const load = f => vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
for (const f of ['contract.js', 'data.js', 'sprites.js', 'sprites_buildings.js', 'sprites_entities.js']) load(f);
const { sprites, data, SPR } = win.BSU;
console.time('init'); sprites.init(win.BSU.newState(1)); console.timeEnd('init');
for (const row of data.catalogList) { const r = sprites.get(row.id, SPR.NIGHT, 0, 1); console.log(row.id, r && [r.sw, r.sh, r.ox, r.oy].join(',')); }
console.log(sprites.selfTest(), sprites.memoryMB().toFixed(2), 'MB');
```
To **see** the pixels (the truth for this module), write a scratch HTML that inlines contract+data+the three sprites files and dumps the atlas into a grid, then screenshot it with the real-Chrome harness:
```js
// scratch/atlas.mjs — builds scratch/atlas.html and screenshots it
import { readFileSync, writeFileSync } from 'node:fs';
const js = ['contract.js','data.js','sprites.js','sprites_buildings.js','sprites_entities.js'].map(f => readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8')).join('\n');
writeFileSync(new URL('./atlas.html', import.meta.url), `<!doctype html><body style="background:#223"><canvas id=c width=1600 height=1200></canvas><script>${js}
BSU.sprites.init(BSU.newState(1)); const g = document.getElementById('c').getContext('2d'); g.imageSmoothingEnabled = false; let x = 8, y = 8, rowH = 0;
const ids = BSU.data.catalogList.map(r => r.id); const variants = [0, BSU.SPR.NIGHT, BSU.SPR.DAMAGED, BSU.SPR.PILINGS, BSU.SPR.SCAFFOLD, BSU.SPR.RUIN];
for (const id of ids) for (const v of variants) { const s = BSU.sprites.get(id, v, 0, 1); if (!s) continue; if (x + s.sw > 1600) { x = 8; y += rowH + 8; rowH = 0; } g.drawImage(s.canvas, s.sx, s.sy, s.sw, s.sh, x, y, s.sw, s.sh); x += s.sw + 8; rowH = Math.max(rowH, s.sh); }
<\/script></body>`);
```
Then `node test/browser.mjs --file scratch/atlas.html --wait 1500 --shot /tmp/atlas.png` (if `browser.mjs` lacks `--file`, temporarily build an `index.html` from this scratch page) and **Read the PNG**: every building must be recognizable at 1× per its GDD visual line, the house style must read as one campus, windows must be 2×3 px, the outline 1 px darker.

## 8. Performance budget

- `init` ≤ 400 ms on the 2019 Air for the 1× atlas (≈ 400 canvases; the building painter ≈ 0.5–1 ms each: use `fillRect` runs, avoid `getImageData`; the dither helper writes 1-px rects — cap dither area per sprite).
- `get` on a cache hit is a `Map` lookup (no string concatenation per frame? Render calls `get` ~1,200 times per frame: build the key with a template literal; V8 handles it, but render should cache `SpriteRef`s per entity per frame-variant when it can). Provide `sprites.getCached(id, variant, frame, zoom)` = `get`; optimize later if the profiler says so.
- Atlas memory ≤ 8 MB at 1×; the 2× atlas would add ≤ 24 MB → within the 64 MB total only with chunk eviction; that is why it is Tier 2.

## 9. Done means

- `selfTest().ok` under the stub; the atlas screenshot shows every catalog row × 6 variants, all tiles/surfaces/levee/floodwall/canal masks, all decals and lights, with the palette hexes and 1-px outlines of GDD §12.3.
- The three sprites files load in manifest order with `sprites.js` first; the split files extend `BSU.sprites` and register their painters at definition time without touching the DOM (`node test/domstub.mjs` load must not throw before `init`).
- `render.js` can draw a full campus at 1× and 0.5× from this atlas within its 12 ms budget (≈ 600–1,200 `drawImage` calls of small canvases).
