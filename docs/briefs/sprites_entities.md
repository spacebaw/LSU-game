# Brief: `src/js/sprites_entities.js` → extends `BSU.sprites` (agents, gators, Roux, officer, vehicles, trees, birds, floats, band, tents, bonfire, gates, the §12.3 table)

Read first: `docs/briefs/sprites.md` (cache keys, families, anchors, helpers, `agentLook` packing) and `docs/briefs/agents.md` (the direction convention: **0 = +tx (down-right on screen? no — see below), 1 = +ty, 2 = −tx, 3 = −ty**), `docs/ARCHITECTURE.md` §1 (row 12), §6.1 (the id list: `agent` + anim suffixes, `gator`, `roux`, `officer`, `fogger`, `bus`, `pirogue`, `float`, `band`, `krewe`, `tent`, `smoker`, `cornhole`, `snoball`, `bonfire`, `egret`, `spoonbill`, `pelican`, `armadillo`, `nutria`, `navy`, `gate`, `barrierGate`, `nest`, `mound`, `oak`, `cypress`, `palmetto`), §6.3 pass 4 (2-frame agents at 0.5×; trees atlas-only at 0.5×), §11.2 #3–4 (Tier 2 sprites); `docs/GDD.md` §12.3 (trees, agents, gators, Roux, officer, vehicles, and the table), §7 (agent sprite: 12×20, 6 skin × 8 hair × shirt 55/25/20, backpack, props, anims), §6.3 (gator sizes, eyes), §6.7 (birds), §4.9 (oak/cypress/azalea visuals), §8 (the Bayou Brass), §14.3 (floats, krewe).

---

## 1. Purpose and public surface

Every moving or living thing's sprite, plus trees. All registered on the shared atlas at definition time (plain `registerPainter` calls; no DOM):

```js
registerPainter('agent', …)      // id 'agent' (walk) or 'agent:<anim>'; variant = look; frame = dir*framesPerDir + f
registerPainter('gator', …)      // variant 0 juvenile / 1 big / 2 legend; frame 0 swim, 1 walk, 2 sun  (+3..5 = frame B of each for a 2-frame cycle → frames(gator) = 6)
registerPainter('roux', …)       // frames 0–1 pace, 2 yawn
registerPainter('officer', …)    // frames dir*4 + walk (16) ; 'officer:wrangle' 2 frames
registerPainter('fogger' | 'bus' | 'pirogue' | 'navy' | 'float' | 'band' | 'krewe' | 'tent' | 'smoker' | 'cornhole' | 'snoball' | 'bonfire' | 'egret' | 'spoonbill' | 'pelican' | 'armadillo' | 'nutria' | 'gate' | 'barrierGate' | 'nest' | 'oak' | 'cypress' | 'palmetto' | 'azalea' | 'bubble', …)
BSU.sprites.animFrames         // {agent: {walk:4, idle:2, flee:2, splash:2, slap:2, cheer:2, sit:1, wave:2, tube:2, umbrella:4, cap:1, beads:2, foam:4}, …} per-direction frame counts (4 directions each)
BSU.sprites.agentFrame(anim, dir, f) → number   // dir * animFrames.agent[anim] + (f % animFrames.agent[anim])
BSU.sprites.treeVariant(stage, autumn, bloom) → number   // stage | (autumn ? 4 : 0) | (bloom ? 8 : 0)
```

`frames(id)` (core) must return the totals: `agent` 16, `agent:idle` 8, `agent:flee` 8, `agent:splash` 8, `agent:slap` 8, `agent:cheer` 8, `agent:sit` 4, `agent:wave` 8, `agent:tube` 8, `agent:umbrella` 16, `agent:cap` 4, `agent:beads` 8, `agent:foam` 16; `gator` 6; `roux` 3; `officer` 16; `officer:wrangle` 2; `fogger` 2; `bus` 2; `pirogue` 2; `navy` 2; `float` 2; `band` 4; `krewe` 4; `tent` 1; `smoker` 2; `cornhole` 2; `snoball` 2; `bonfire` 3; `egret` 2; `spoonbill` 2; `pelican` 2; `armadillo` 2; `nutria` 2; `gate` 4; `barrierGate` 4; `nest` 1; `oak/cypress/palmetto/azalea` 1 (variants carry stage/season); `bubble` 3 (`!`, `zzz`, `♥` — pixel glyphs).

**Direction convention (shared with agents.js):** `dir 0` = moving `+tx` (on screen: down-right), `1` = `+ty` (down-left), `2` = `−tx` (up-left), `3` = `−ty` (up-right). Sprites face accordingly: 0 and 1 show the face (front), 2 and 3 show the back; 1 and 2 are the horizontally mirrored versions of 0 and 3 (paint two and mirror with `scale(−1, 1)` at bake time into the other two).

**Anchors:** agents/gators/vehicles/officers/birds/critters: the foot point (bottom center) → `ox = −w/2, oy = −h + 2` (2 px of the sprite sit below the foot line: the shadow ellipse); trees: the trunk base at the tile center → `ox = −w/2, oy = −h + 4`; `float/tent/smoker/cornhole/snoball/bonfire/nest`: bottom center; `gate/barrierGate`: the tile center (`ox −16, oy −20`); `bubble`: bottom center (drawn 2 px above the agent's head by render).

## 2. State fields

None. Reads `BSU.params.palette` and the core helpers.

## 3. Events

None.

## 4. Rules checklist

### Tier 1

**Agents (GDD §7, §12.3)** — 12×20 px, palette-swapped from one procedural base:
- [ ] Base figure (front view, dir 0): head 6×6 at rows 0–5 (skin), hair on rows 0–2 per style (8 styles: short, bob, bun, afro, cap-cut, long, mohawk, curls — each a small pixel pattern), body 8×7 rows 6–12 (shirt color), a 3×5 `#3A2A1E` backpack on the left edge, legs 2×2 px each rows 13–17 (`#2B1246` trousers), shoes 1 px `#1B1B1B`, a 1-px darker outline around the silhouette, a 6×2 `rgba(0,0,0,.25)` shadow ellipse at rows 18–19. Colors from the look (`skin = look & 7`, `hair = (look>>3)&7`, `shirt = look>>6` → skin/hair/shirt tables in the core brief).
- [ ] Walk: 4 frames per direction: legs alternate (frame 0 neutral, 1 left forward, 2 neutral, 3 right forward), arms swing 1 px. Back view (dirs 2,3): no face pixels (hair covers), backpack centered.
- [ ] Anims (per direction): `idle` 2 (breathing: body up 1 px on frame 1); `flee` 2 (arms up, legs wide; render draws `bubble` `!`); `splash` 2 (legs hidden below a 10×3 `shallows` water line, arms out); `slap` 2 (one arm to the head); `cheer` 2 (both arms up, frame 1 jumps 2 px); `sit` 1 (8×14: legs folded); `wave` 2 (one arm up, waving); `tube` 2 (a `#E8E8E8`/`#E0443E` striped 12×6 ring around the waist, legs hidden); `umbrella` 4 (walk + a 10×3 purple umbrella 3 px above the head on a 1-px stick); `cap` 1 (a black 6×2 mortarboard + gold tassel pixel; render throws it as a particle at the toss); `beads` 2 (walk frames 0/2 with 3 colored pixels (purple/green/gold) on the chest); `foam` 4 (walk with a 4×5 gold foam-finger pixel block on the right arm).
- [ ] 0.5× drawing uses frames 0 and 2 only (render's rule); nothing to do here.
- [ ] Cache on demand per `look` (6×8×3 = 144 looks × 13 anims × 16 frames is too many to pre-bake: bake per `(look, anim)` sheet lazily as **one canvas per look+anim** holding all frames in a row — the core's `SpriteRef` has `sx/sw` for exactly this; `get('agent', look, frame)` returns the sub-rect).

**Gators (GDD §6.3, §12.3)** — variant 0 juvenile 28×9, 1 big 40×12, 2 legend (Le Grand) 56×17; frames: swim (body low, a V-wake of 2 `shallows` lines behind), walk (legs out, body 2 px higher), sun (flat, mouth open 1 px); 2-frame cycle each (frames 3–5 are the B frames): tail sways 1 px, legs alternate. Colors `#4A5A3A` back, `#8A9A6A` belly, `#1B1B1B` eye with a red pixel used only by the lights pass (`light:eye` separately); a 1-px outline. Beads (Oct 8–10): render draws `bubble`-style 3 colored pixels on the neck (frame variant not needed — render overlays).
- [ ] `officer:wrangle` (Tier 2 #4 animation; Tier 1 provides frame 0 = officer crouched over a gator silhouette, frame 1 = a 16×10 dust-cloud puff of `#C9B47C` dither) — the puff is what Tier 1 shows.

**Roux** (28×16, 3 frames): orange `#E07020` body with 5 black 1-px stripes, white belly, black nose, tail; frames 0–1 pace (legs alternate), 2 yawn (mouth 3 px open, eyes closed).

**Officer** (12×20, 16 walk frames + wrangle 2): the agent base with a `#C2B280` khaki shirt/hat and a 1-px `bark` catch-pole 14 px long held forward.

**Vehicles**: `fogger` 20×10 (white `#E8E8E8` truck cab + a gray tank; frame 1 wheels rotate; the ribbon is particles); `bus` 24×12 (`purple` with a `gold` stripe, 4 windows `#A0D0FF`, 2 frames wheels); `pirogue` 22×8 (`bark` hull, a seated paddler 4×6 with a 1-px paddle; frame 1 paddle on the other side); `navy` 22×8 (the same hull with 2 paddlers and a `gold` "CN" 3×5 flag).

**Mardi Gras** (§14.3, §12.3): `float` 32×16 (2 frames roll: wheels rotate): a `purple` deck, `green #2E8B57` and `gold` bunting, a 6×8 papier-mâché tiger head; `band` 12×20 ×4 frames: the agent base in `purple` with a 3-px `gold` plume on a shako and a 4×3 brass pixel block (render batches 24); `krewe` 12×20 ×4: agents with a purple sash and a 2-px `gold` mask stripe (12 batched).

**Tailgate/heat/festival props**: `tent` 16×12 (purple canopy, 2 legs, a gold pennant); `smoker` 10×8 (2 frames: a black barrel on legs, frame 1 with a 2-px lid lift; smoke is particles); `cornhole` 12×6 (2 frames: board + a bag in the air on frame 1); `snoball` 14×12 (2 frames: a white cart with a striped awning, flag flutters); `bonfire` 12×16 (3 frames: `bark` logs + a flame of `#FFCB6B`/`#E07020`/`#E0443E` pixels that changes shape per frame; the glow is `light:fire`).

**Birds and critters (§6.7, §12.3)**: `egret` 10×14 (2: standing white with a 1-px yellow beak and black legs; take-off with wings 10 px wide); `spoonbill` 10×14 (2 glide frames, pink `#F4A6C0` with a spatula bill); `pelican` 12×10 (2: brown-gray with a big beak; wings); `armadillo` 10×6 (2 scurry); `nutria` 12×6 (2 scurry: brown with orange 1-px teeth). Tier 2 #3 for `spoonbill/pelican/armadillo/nutria` **spawners** (wildlife); the sprites are cheap — paint them in Tier 1 so nothing blocks later.

**Trees (GDD §4.9, §12.3)**:
- [ ] `oak` variants by `stage` (0–2) | `autumn 4` (unused for oak) — stage 0: 8×14 sapling (trunk 2 px, a 6×6 canopy blob); stage 1: 40×36 (trunk 4×12 `bark`, 3 canopy blobs `oakCanopy` with a `shade(oakCanopy,1.15)` top dither); stage 2: **96×56** (a 3-tile-wide spreading canopy: 5 blobs, trunk 6×16, dithered edges, 6–10 baked moss strands of `moss` 1-px lines hanging 6–12 px from the canopy bottom for the 0.5× atlas-only look). At 1×/2× render draws the strands per frame (see render); the baked strands are in the sprite so 0.5× still shows moss — **decision:** bake them; at 1×/2× render overdraws animated strands on top (slightly denser moss at 1×, acceptable).
- [ ] `cypress` variants `stage | autumn<<2`: stage 0: 6×16 sapling; 1: 16×48; 2: **24×80** tall conical feathery tree (stacked shrinking `cypress`-colored diamonds with a dithered edge), a flared `bark` trunk 6×14, autumn variant recolors the foliage `cypressAutumn`; 2–4 `knees` nubs are baked at the base (the `knees` tile sprite is for chunk decoration at water edges).
- [ ] `palmetto` (variants by stage, 3): 24×20 fan clumps of `#5E8A3A` 1-px rays from a center.
- [ ] `azalea` variants `stage | bloom<<3`: a low 16×10 dark-green `#2E5A2A` mound; bloom: 60% of the surface `azalea` pink pixels (petals are particles). Stage 0 (shredded/regrowing): 10×6.

**Gates**: `gate` 32×24 ×4 frames (the floodgate: a purple 12×10 plate sliding from raised (frame 0) to dropped (frame 3) inside the canal cut — render animates between the `canal` tile variants using this overlay); `barrierGate` 32×24 ×4 (the surge barrier's sector gate: a gold-striped gray plate rotating down).

**Misc**: `nest` 6×4; `bubble` 3 frames 10×8 (`!` gold on purple, `zzz`, `♥`); `mound` is in the core (terrain family).

**Crowd**: not a sprite (render_fx's per-seat noise); nothing here.

### Tier 2

- [ ] `officer:wrangle` full animation (cut #4), fogger truck polish (cut #4), nutria/spoonbill/pelican/armadillo spawners are wildlife's (cut #3).
- [ ] The 2× versions (`zoom = 2` scaling).
- [ ] Extra agent props (selfie phone, binoculars) for voice-card payoffs.

## 5. Edge cases and invariants

- Every id in ARCHITECTURE §6.1's list resolves with the sizes in GDD §12.3 (the smoke of render's draw list depends on `size()`).
- Mirrored directions must be pixel-exact mirrors (bake via `scale(−1,1)` + `drawImage` of the painted frame; in headless it is a no-op, fine).
- Frame indices wrap (core rule); `agentFrame` never returns ≥ `frames(id)`.
- Lazy per-look sheets: at most 144 × 13 canvases could exist; typical play uses < 60 looks × 4 anims. `sprites.gc` may drop sheets unused for 600 frames.
- No `rng.fx` in painters (deterministic); moss sway is render's.

## 6. selfTest() requirements

Registered through `BSU.sprites._tests.push(fn)`:

1. Sizes: `size('agent', 0)` = 12×20; `gator` variants 0/1/2 = 28×9 / 40×12 / 56×17; `roux` 28×16; `officer` 12×20; `fogger` 20×10; `bus` 24×12; `pirogue` 22×8; `float` 32×16; `band` 12×20; `tent` 16×12; `smoker` 10×8; `cornhole` 12×6; `snoball` 14×12; `bonfire` 12×16; `egret` 10×14; `spoonbill` 10×14; `pelican` 12×10; `armadillo` 10×6; `nutria` 12×6; `navy` 22×8; `gate` 32×24; `barrierGate` 32×24; `nest` 6×4; `oak` stage 2 = 96×56; `cypress` stage 2 = 24×80.
2. Frame totals as listed in §1 for every id.
3. `agentFrame('walk', 3, 5)` = `3*4 + 1 = 13`; `agentFrame('sit', 2, 9)` = 2.
4. Anchors: `get('agent',0,0).oy === −18`, `ox === −6`; `get('oak', 2).oy === −52`.
5. Every `agent:<anim>` for `look 0` resolves non-null for all 4 directions × its frames; `agent` with look 511 (max) resolves.
6. `treeVariant(2, true, false) === 6`; `treeVariant(1, false, true) === 9`.

## 7. Testing in isolation

Extend the atlas grid page from `docs/briefs/sprites.md` §7 with a section that draws: the agent base in all 4 directions × 4 walk frames for 6 looks; every anim for look 0 (dir 0); the 3 gator variants × 6 frames; Roux; officer; the vehicles; the float/band/krewe; the props; the birds; trees at all stages incl. autumn cypress and blooming azalea; the two gates × 4 frames. Screenshot via `node test/browser.mjs --shot` and Read it: figures must read as people at 12×20 (head, shirt color, backpack), gators as gators with a visible V-wake in the swim frame, the oak's canopy must be ~3 tiles wide with moss strands, the cypress tall and conical.

## 8. Performance budget

Per-look agent sheets ≤ 0.3 ms each to bake; all other entity sprites ≤ 20 ms total at `init`. No paths, no gradients.

## 9. Done means

- The atlas screenshot's entity section matches GDD §12.3's table row by row (sizes, frame counts, where each appears).
- `sprites.selfTest().ok` with the entity tests registered; `node test/modules.mjs` passes.
- In the running game: students at 12×20 walk with 4-frame legs in all four directions and are mirrored correctly (a student walking `+ty` faces down-left), gators swim with a wake and sun on banks, pirogues paddle in on the bayou, the oak canopy sways (render) over baked moss, cypress turn orange in November.
