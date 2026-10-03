# BAYOU STATE
### *Build the campus. Beat the swamp. Fill the stadium.*

**FINAL GAME DESIGN DOCUMENT — authoritative build spec, v1.2** (v1.2 = the critic review of §17; the fixed project facts in `docs/HEADLESS_API.md` and `docs/TESTING.md` are authoritative for the harness)
Spine: the "Spectacle" candidate. Grafts: the Journey opening and pacing, the Swamp cascade/attenuation/format, the Systems economy brakes, debug panel and bonfires. Every number in this document is the number; where a candidate disagreed, this document wins.

---

## 0. Engineering-Ready Summary

| Item | Value |
|---|---|
| **Title** | BAYOU STATE (Bayou State University, "BSU", the Tigers, mascot **Roux**) |
| **Deliverable** | One self-contained `index.html`, vanilla JS + Canvas 2D, no network, works from `file://` in Chrome and Safari |
| **Map** | 64 × 64 tiles = 4,096 tiles. Big Muddy river along the east edge, Gulf off the south edge, bayou spline through the middle, cypress lake in the south-west. The natural-levee ridge is high only along a short northern crown (the start plot, ~70–100 tiles at ≥ 5 ft); south of it the bank subsides into the Crevasse Reach (§3.4) and the rest of the dry land is on cheniers across the bayou |
| **Projection** | Isometric 2:1, fixed orientation (no rotation). Tile diamond 64 × 32 px at zoom 1. Elevation drawn at **6 px per foot**. Zoom steps 0.5× / 1× / 2× |
| **Units** | Elevation, water depth, surge and crest heights in **feet** everywhere (sim, inspect panel, overlays, tooltips). Money in dollars, shown as $1.2M / $340k. Upkeep always **per month** |
| **Sim tick** | 10 Hz fixed step (100 ms). Hydrology 4 Hz. Agents 10 Hz. Mosquito field once per calendar day. Economy on the 1st of each month. Render on `requestAnimationFrame`, interpolated |
| **Calendar** | 10-day months, 120-day year. **1 calendar day = 10 s at 1×**; month = 100 s; **year = 20 min at 1×**. Speeds: Pause / 1× / 2× / 4× |
| **Sky clock** | A separate 30 s cycle (= 3 calendar days at 1×): Dawn 2.5 s → Day 13 s → Golden Hour 2 s → Dusk 2.5 s → **Night 10 s**. Drives lighting, agent schedule buckets, gators, fireflies, mosquito haze |
| **Event time** | Set pieces run in **sim ticks** with the calendar frozen and the speed setting ignored: event time advances 100 ms per tick (10 ticks = 1 s of event time; the main loop runs exactly 10 ticks per real second during a set piece, and `BSU.headless.tick(n)` advances a set piece the same way). Landfall 90 s = **900 ticks**, Home game 75 s = **750 ticks**, Mardi Gras parade 25 s = **250 ticks**, Graduation 15 s = **150 ticks**. **Every set piece is skippable after its first instance** (Skip → damage report / final score / recap); near-miss storms are a 15-s (150-tick) bands pass, never the 90-s timeline; the previous speed is restored when any set piece ends (§9.4) |
| **Agents** | `min(300, 40 + students / 25)` visible student agents, 4 tiles/s on paths (a 20-tile crossing = 5 s ≈ 1/6 of a sky cycle) |
| **Start** | Jan 1, Year 1. $4,000,000 cash, 0 students (120 arrive by pirogue at ~0:35), prestige 10, happiness 60, tuition $6,500/semester |
| **Save** | `localStorage` (try/catch, in-memory fallback), autosave on the 1st of each calendar month (after the economy step) and on `visibilitychange`, 3 rotating autosave slots + 3 manual, save schema version 1 |
| **Modules** | `contract.js` (frozen first) + 15 modules, concatenated by `build.mjs` from `src/manifest.json` |

### 0.1 Timing table (the one clock; everything else derives from it)

| Quantity | At 1× | At 2× | At 4× |
|---|---|---|---|
| Sim ticks per second | 10 | 20 | 40 |
| Calendar day | 10 s (100 ticks) | 5 s | 2.5 s |
| Month (10 days) | 100 s | 50 s | 25 s |
| Year (120 days) | 20 min | 10 min | 5 min |
| Sky cycle (dawn→night→dawn) | 30 s | 15 s | 7.5 s |
| Night phase (lingerable, lights on) | 10 s | 5 s | 2.5 s |
| Agent walk speed, path / dry grass / wet ground / wading (0.3–0.6 ft) | 4 / 2.4 / 1.6 / 1.2 tiles per real second | ×2 | ×4 (reads as time-lapse) |
| Hurricane cone warning (T−6 days; T−9 with Coastal Institute) | 60 s (90 s) | 30 s (45 s) | 15 s (22.5 s). Landfall is always cone + 6 calendar days (cone + 9 with the Institute) **at whatever speed the player chooses**. In Year 1 the cone drops speed to 1× (the player may raise it again); from Year 2 a cone is a notification plus the alert strip and does not touch speed |
| Landfall set piece | 90 s = 900 ticks, calendar frozen, 10 ticks per real second; 8-s (80-tick) decision toasts at t = 30 / 40 / 45 s, at least one guaranteed (§6.2) | same | same. Skippable after the first landfall of the save (Skip → damage report). A near-miss is a 15-s bands pass, never this timeline |
| Home game set piece | 75 s = 750 ticks, calendar frozen (Skip-to-final after Q1; the halftime decision toast still fires) | same | same. Skippable after the first home game; the Season panel's **Auto-sim home games** toggle plays later games as a 5-s score-bug montage |
| Mardi Gras parade / Graduation | 25 s (250 ticks) / 15 s (150 ticks), calendar frozen | same | same; skippable after the first of each |
| Speed after a set piece | the speed in force before the set piece is restored | same | same |
| Construction: building | `1 + floor(footprintArea / 6)` calendar days (Dorm 2 d = 20 s; Stadium 6 d = 60 s) | | |
| Construction: paths, canals, levees, fences | instant | | |
| Pilings retrofit | 1 calendar day, building closed | | |
| Autosave | on the 1st of each calendar month, after the economy step, and on `visibilitychange` | same rule (every 50 s of play) | same rule (every 25 s of play) |

Hydrology rates are written **per calendar day**; the hydro step (4 steps per 10-tick block, on ticks 0, 2, 5 and 7 of the block) converts with `dtDay = 1/40` in normal play. During the landfall set piece the calendar is frozen but the hydro sim keeps stepping (360 steps over the 900 ticks) with `dtDay = 1/360` (the 90-second event represents one calendar day of weather), so an 8-inch hurricane is 8 inches, not 27 feet. During a game day, the Mardi Gras parade and Graduation `dtDay = 0` (flows still relax; no rain, no drainage, no evaporation). A near-miss bands pass (150 ticks = 60 hydro steps) runs at `dtDay = 1/60`, so it represents **one calendar day** of rain (4 in). Thunderstorm cells are timed in calendar days, not seconds (§6.1.2).

**Event time is tick time.** Nothing in a set piece reads the wall clock: every "t = 30 s" in this document is tick 300 of that set piece, decision-toast countdowns are 80 ticks, wind pulses are ticks 250 / 380 / 550 / 680, and the render loop only interpolates between ticks. This is what lets `test/smoke.mjs` run a whole landfall with `BSU.headless.tick(n)` and no timers.

### 0.2 Module list (build order = `src/manifest.json` order)

| # | File | Owns | Public surface on `BSU.*` |
|---|---|---|---|
| 0 | `contract.js` | Namespace, enums, typed-array layouts, event names, `params` (every tuning constant), mulberry32 RNG, event bus, save schema version. **Written first, frozen.** | `BSU.T` (tile types), `BSU.B` (building ids), `BSU.EV` (event names), `BSU.params`, `BSU.events.on/emit`, `BSU.rng` |
| 1 | `data.js` | Catalog rows (§4), storm names, ticker lines, name tables, rivals, festival text, calendar constants | `BSU.data.catalog[id]`, `BSU.data.*` |
| 2 | `terrain.js` | Map generation (including the initial `depth`/`sat` of §3.3, the pre-placed Highway 1 stub in the `surface` layer and the Mounds), the generator guarantees G1–G8 (§3.5), tile-type derivation, walk-cost grid, chunk dirty flags, subsidence step | `BSU.terrain.gen(seed)`, `tileAt(x,y)`, `classify()`, `markDirty(x,y)`, `plot` (the start-plot rectangle, cove tile list, `bank0`, `mounds`) |
| 3 | `hydro.js` | Rain intake, flow CA, canals/levees/floodgates/pumps/ponds, surge, flood state, drained-marsh conversion, flood-risk prediction | `BSU.hydro.tick(dtDay)`, `depthAt`, `floodedBuildings()`, `predictRisk()`, `surge.begin/end` |
| 4 | `weather.js` | Calendar + sky clock, seasons, heat index, rain scheduler and thunderstorm cells, hurricane lifecycle/cone/wind pulses, Years-2+ landfall scheduling (dates, spacing, landfall point), the near-miss bands pass, set-piece timelines (in ticks) and their decision toasts, the Célestine hold rule, Spring High Water (the river-stage schedule, §6.9), festival dates | `BSU.weather.date`, `sky`, `heat`, `rainAt(x,y)`, `storm`, `cone`, `scheduled[]`, `riverStage` |
| 5 | `wildlife.js` | Gators, nutria, mosquito field, egrets/spoonbills/fireflies spawners, Wildlife Officer behavior, ecology score | `BSU.wildlife.gators[]`, `mosqAt`, `ecology()` |
| 6 | `buildings.js` | Placement validation, footprints, construction timeline, effects and coverage maps, repair/demolish, pilings, levee integrity, the **protection flood-fill and gap detector** (§6.2 "Rings, protection and gaps"), auto-naming, policy toggles, per-building `data` | `BSU.buildings.canPlace`, `place`, `remove`, `list`, `coverage(kind,x,y)`, `protection(H)`, `gaps(H)`, `ringClosed(H)` |
| 7 | `economy.js` | Cash, tuition, state, donations, research, athletics ledger, rolling enrollment, prestige, happiness (with the timed-modifier table), Board cards, failure-state cards, Endowment, Second Campus charter, monthly statement | `BSU.economy.state`, `statement()`, `enroll()`, `breakdown(stat)`, `modifiers()` |
| 8 | `agents.js` | Student agents, phase-bucket schedule, A* + route cache, reactions, radius-effect sampling, desire lines (the `wear` array) | `BSU.agents.list`, `sample()`, `evacuate()`, `shelter()` |
| 9 | `sports.js` | Season schedule, named coach (stars, hire/fire), three named starters, recruiting card, team rating, win roll and the quarter score model (§8), halftime decision, attendance, game-day set piece and auto-sim montage, tailgates, Play Through It | `BSU.sports.season`, `record`, `coach`, `starters`, `playHome()`, `rating()`, `winProb(opp, night)` |
| 10 | `sprites.js` | All procedural painters and the atlas; one parameterized building painter driven by catalog rows | `BSU.sprites.get(id, variant, frame, zoom)` |
| 11 | `render.js` | Camera, chunk cache, depth-sorted draw list, water, weather FX, lighting passes, particle pool, overlays, minimap, postcard export | `BSU.render.frame(t)`, `camera`, `particles.emit`, `shake()`, `postcard()` |
| 12 | `ui.js` | DOM HUD, palette, inspect panel, ticker/toasts/cards, Budget/Storm/Season/Milestones/Almanac panels, input state machine (mouse, keys, trackpad, touch), tooltips, title screen, settings, debug panel | `BSU.ui.notify`, `ticker`, `openPanel`, `inspect` |
| 13 | `audio.js` | WebAudio synth voices, ambience mixer, stings, zydeco motif; created on first gesture; guards for a missing `AudioContext` | `BSU.audio.play(name)`, `setAmbience`, `mute` |
| 14 | `progress.js` | Tutorial script, objective chain with the interrupt/background scheduler and FIFO queues (§10.2), the Amélie and Célestine scripts, milestones/achievements, event-triggered unlocks, Board of Regents cards, Student Voice cards (§7.1), the timed-modifier table (`timers[]`), Founders' Day recap | `BSU.progress.tick`, `unlocked(id)`, `achieve(id)`, `timers`, `objective()` |
| 15 | `session.js` | Save/load/autosave, version migration, new game / continue (`skipTutorial`), boot, fixed-step main loop, the live state root `BSU.state`, the headless API of `docs/HEADLESS_API.md` (§15.2) | `BSU.session.save/load/newGame`, `BSU.state`, `BSU.headlessMode`, `BSU.headless.tick/render/snapshot/findSpot/place/forceHurricane/click/key/fastForwardDays/state` |

### 0.3 Building table (43 placeables: 40 core rows plus the three Year-5+ capstone rows 41–43; every one is a data row in `data.js`)

Footprint w×h in tiles; "drag" = linear tool. Cost is one-time; terrain modifiers apply (Wet +20%, High −10%, Pilings +40%, grading $15k per tile, road over water ×4, summer May 6–Aug 4 −15%). Upkeep per month. Radius = Chebyshev tiles. WR = wind rating 1–5. ⚡ needs power coverage, 💧 needs water coverage; an unpowered or unwatered building runs at 50% (§4.11). **Path adjacency** (a Gravel Path, Road or Boardwalk on at least one edge tile, connected to the network as defined in §3.6 Access) is required for rows 4–22, 24, 28, 32, 34, 39, 40, 42 and 43; rows 23, 29, 30, 31, 33, 35–38, 41 and every drag tool (1–3, 25–27, 31, 35) are exempt. Drag tools write **tiles** (`surface`, `crest`, `flags`, §3.2), never Building structs.

| # | id | Name | Footprint | Cost | Upkeep | Effects | Unlock |
|---|---|---|---|---|---|---|---|
| 1 | `path` | Gravel Path | 1×1 drag (`surface` = 1) on any land tile including Marsh (a gravel path on Marsh disturbs it, §6.4, and counts as one lost wetland tile, §6.8); not on Preserve | $2k | $0 | Walkable at 4 tiles/s; the required adjacency for every building in the path-adjacency list above. Wading at ≥ 0.3 ft depth, impassable ≥ 0.6 ft | Start |
| 2 | `road` | Campus Road | 1×1 drag (`surface` = 2); spans water ≤ 3 tiles as a bridge at ×4; not on Marsh or Preserve (ghost: "Use a Boardwalk or a bridge") | $10k | $100 | Walkable + vehicles; required within 4 tiles of Stadium, Parking Lot and Wastewater Plant (not the Substation); parade route; −1 happiness to adjacent dorms. A bridge tile is impassable only when the local water surface exceeds normal stage + 2 ft (surge ≥ 2 ft); otherwise walk class 1 regardless of the depth beneath it | Start |
| 3 | `boardwalk` | Boardwalk | 1×1 drag (`surface` = 3) over Marsh, Preserve, Bayou or Water, or any land tile | $14k | $150 | Walkable at 4 tiles/s; no draining, no ecology loss; impassable only when the local surface exceeds normal stage + 2 ft (surge ≥ 2 ft), otherwise walk class 1 whatever the depth beneath. WR 2 | Start |
| 4 | `substation` | Power Substation | 2×2 | $250k | $4k | Power radius 10, 40 buildings; summer draw ×1.5; over capacity → brownout (−5 happiness, research 0). **Blackout when its tiles reach 0.3 ft of water** (immune < 3 ft on Pilings): everything it powers goes dark, pumps stop. WR 2 | Start |
| 5 | `water_tower` | Water Tower | 2×2 | $220k | $2k | Water radius 12, 50 buildings. Cat 4+: 30% topple ($60k), 10% if Boarded Up or with a Live Oak within 2 (the roll plays on screen in wind pulse 2). A flooded (≥ 0.3 ft) or unpowered tower (its pump is ⚡; the tutorial suppression of §4.11 applies) triggers a **Boil-Water Advisory** (§6.2 Recovery): Dining −50% and −4 happiness for 3 days; counterplay is Pilings on the tower or a Generator within 6. WR 2 ⚡ | Start |
| 6 | `generator` | Backup Generator | 1×1 | $60k | $500 (+$2k/day running) | Ships with `data.fuelDays = 3`; keeps buildings within radius 6 powered through a blackout, burning 1 fuel day per calendar day on which a blackout is active in its radius; refuel +3 days for $5k (inspect panel, or Toast 2 during landfall); the $2k/day running cost accrues only on those blackout days. WR 3 | Start |
| 7 | `wastewater` | Wastewater Plant | 3×3, within 3 of Water/Bayou/Canal | $400k | $6k | Each plant serves 6,000 students. Above 1,500 students without one: capacity growth stops and −8 happiness. −5 ecology once if placed on Marsh. WR 3 ⚡ | 1,000 students |
| 8 | `founders_hall` | Founders' Hall | 3×3 | free (Objective 1) | $8k | 300 seats; landmark +2; shelter 300 (600 during a declared emergency, i.e. from the cone to T+1: "everyone in the gym"); cannot be demolished; the root of the access network (§3.6). WR 4 ⚡💧 | Footprint reserved; placed by the player in Objective 1 (pre-placed with `skipTutorial`, §15.2) |
| 9 | `lecture_hall` | Lecture Hall | 3×2 | $600k | $10k | 400 seats. WR 3 ⚡💧 | Start |
| 10 | `library` | Library | 4×3 | $1.8M | $14k | Academic +20; landmark +4; +4 happiness radius 10 (sampled); finals-week study hub; shelter 800. WR 4 ⚡💧 | 800 students |
| 11 | `engineering` | Engineering Hall | 4×3 | $2.6M | $30k | 500 seats; academic +20; research $12k/mo × (0.5 + prestige/100); levees, floodwalls, canals, pumps −15% cost; unlocks Floodwall; shelter 800. WR 4 ⚡💧 | 1,500 students |
| 12 | `coastal_institute` | Coastal Studies Institute | 3×3, must touch Marsh or Bayou; built on pilings | $2.2M | $24k | 150 seats; academic +20; research $10k/mo × (ecology/50) × (0.5 + prestige/100); hurricane cone at T−9 and 30% narrower; subsidence detail overlay; ecology decay −50%. WR 3 ⚡💧 | 1,200 students & ecology ≥ 40 |
| 13 | `dorm` | Freshman Dorm | 3×2 | $700k | $9k | 300 beds; quality 2; shelters its own 300 residents when every footprint tile is ≥ 5.0 ft or it is on Pilings (§4.11). WR 3 ⚡💧 | Start |
| 14 | `res_tower` | Residence Tower | 3×3 | $2.4M | $22k | 900 beds; quality 3; landmark +2; shelter 900 (its own residents; counts only on ≥ 5.0-ft ground or Pilings). WR 4 ⚡💧 | 1,500 students |
| 15 | `greek_house` | Greek Row House | 2×2 | $350k | $5k | 80 beds; quality 3; +3 happiness radius 6 (sampled); tailgate revenue +50% within 8 of the home venue (Bayou Field or the Stadium); gator attraction +2. WR 2 ⚡💧 | 600 students |
| 16 | `dining_hall` | Dining Hall | 3×2 | $500k | $8k | Feeds 1,200; dining radius 10; +3 happiness radius 10 (sampled); boil-pot smoke; gator attraction +2 (dumpster; the "Gator-Proof Dumpsters" toggle in its inspect panel, $5k once, halves it). WR 3 ⚡💧 | Start |
| 17 | `poboy` | Po'boy Shack | 1×1 | $60k | $1k | Feeds 200; dining radius 5; +2 happiness radius 5 (sampled: only students who walk past count); +$2k/mo. WR 1 ⚡ | Start |
| 18 | `practice_field` | Practice Field (tiered in place: tier 1 adds the **Bayou Field** bleachers) | 4×3 | $200k; Bayou Field +$600k | $3k; +$4k with the bleachers | Team rating +5; enables a team (away-only "club" schedule until Bayou Field or a Stadium exists); tailgate field. **Bayou Field** (tier 1, an upgrade button in the inspect panel, 400 students, 6 calendar days to build): 6,000 seats, **day games only**, landmark +1, shelter 0, no Road needed; home games move to the largest venue that exists. The Aug 8 opener is a real home game in Year 1 for a player who builds it by then. WR 1 | 400 students |
| 19 | `stadium` | Stadium (tiered in place) | 6×5, Road within 4 | I $2M / II $8M / III $32M | $30k / $80k / $180k | I "Red Stick Stadium" 15,000 seats, landmark +4, shelter 5,000, WR 3. II "The Cauldron" 45,000, landmark +10, **night games**, shelter 15,000, WR 4. III "Cauldron Grand" 80,000, landmark +18, fireworks, opponent −5, shelter 25,000, WR 5 ⚡💧 | I: 600 students & Bayou Field. II: I & 1,500. III: II & 8,000 & prestige 50 |
| 20 | `union` | Student Union | 4×3 | $1.6M | $15k | +8 happiness radius 12 (sampled); idle hub; feeds 400; hosts Mardi Gras ball and the Crawfish Boil (festival revenue ×2); shelter 2,000. WR 3 ⚡💧 | 600 students |
| 21 | `rec_center` | Rec Center | 3×3 | $1.2M | $12k | +6 happiness radius 10 (sampled); heat penalty −50% radius 10 (pool); removes the team's heat penalty if within 10 of the Practice Field; "gator in the pool" event; shelter 1,000. WR 3 ⚡💧 | 800 students |
| 22 | `health_center` | Health Center | 2×2 | $450k | $6k | Mosquito illness −60% radius 12; heat illness −50% radius 12. WR 3 ⚡💧 | 400 students |
| 23 | `quad` | Quad Lawn | 2×2 tileable | $30k | $300 | +2 happiness radius 6 (sampled, stacks to +6); idle spot; auto-plants one Live Oak drawn as a decal on the shared corner of the four tiles (screen center of the footprint); it counts as one oak for ecology and casts shade radius 3 measured from the NW tile. No path adjacency needed | Start |
| 24 | `parking` | Parking Lot | 3×2, Road within 4 | $150k | $1.5k | 1 required per 600 students (else −4 happiness); tickets +$4k/mo; tailgate lot; **floods at 0.3 ft (cars bob)**. WR 1 | Start |
| 25 | `levee` | Earthen Levee | 1×1 drag | $35k | $400 | Tile crest = elev + 6 ft; integrity 100 (nutria −15/burrow, overtopping −10/day, surge contact −5/category; < 70% → flagged "weak" by the gap detector; < 50% → crest halved; 0 → breach); one burrow-hole decal per burrow event and a ticker line naming the tile; repair $5k/tile (Repair All on the Storm panel); walkable (class 2 berm; a Path or Road may be laid on a levee tile); rain on the tile absorbs 0.6 and drains 0.4 ft/day (High class); ecology −0.2/tile on Marsh; canal on a levee tile = Floodgate | Start |
| 26 | `floodwall` | Concrete Floodwall | 1×1 drag | $110k | $900 | Crest = elev + 12 ft; nutria-immune; −1 happiness within 3 unless a Live Oak is adjacent | Engineering Hall or 2,000 students |
| 27 | `canal` | Drainage Canal | 1×1 drag | $25k | $500 | Tile bed cut to `max(elev − 2, 0.5)` ft; conductance ×8; drains by gravity if the chain reaches Bayou/Water, otherwise needs a Pump; an unconnected chain is standing water (mosquitoes); ecology −0.3/tile on Marsh; crossing a levee tile becomes a Floodgate (auto-closes when the bayou stage > 1 ft); a bare canal tile is walk class 0 (blocked); a canal tile under a Path/Road/Boardwalk is a **culvert**: walkable at that surface's class and still conducts at ×8 | Start |
| 28 | `pump` | Pump Station | 2×2, must touch a Canal or Water | $500k | $8k (+$3k while running) | Removes **15 tile-ft of water per calendar day** from its connected canal network, discharging to Bayou/Water; needs ⚡ (stops in blackout); subsidence +0.06 ft/yr within 8; −1 happiness within 4 (noise). WR 3 | Start |
| 29 | `pond` | Retention Pond | 2×2 | $120k | $1k | Its tiles are cut −3 ft and are ordinary CA tiles; in addition it is a sink with 20 tile-ft of capacity: each hydro step it removes `min(0.5 × dtDay × 40, remaining)` tile-ft from the deepest tiles within radius 5 (deepest first, ≤ 0.1 ft per tile per step), and capacity recovers at 2 tile-ft/day by evaporation; stocked with bream after 1 month → mosquito −80% within 4; +2 happiness radius 6; egret. No path adjacency needed | Start |
| 30 | `pilings` | Pilings (building upgrade) | applies to a building | +40% of its cost at placement; a retrofit costs +40% × (1 + feet the building has sunk, `Building.sunk`) | +5% of its upkeep | Building ignores depth < 3 ft; no subsidence; allowed on Marsh without draining; 1-day retrofit (building closed) | Start |
| 31 | `gator_fence` | Gator Fence | 1×1 drag (`surface` = 4); not on a Path/Road/Boardwalk tile; allowed on Marsh and Preserve | $8k | $80 | Gators and nutria cannot cross; students pass (gates: the tile keeps its ground walk class); Cat 3+ breaks 30% of segments | Start (pip on first gator) |
| 32 | `abatement` | Mosquito Abatement Station | 1×1 | $90k | $2.5k | Fogger truck (3 tiles/s) patrols paths within 8 at dusk: mosquito −70% in radius 8; ecology −0.5/mo while active (on/off toggle in the station's inspect panel, default on). WR 2 | Start (pip on first mosquito warning) |
| 33 | `bat_house` | Bat House / Purple Martin Tower | 1×1 | $12k | $100 | Mosquito −30% radius 4, stacks to −60%; +0.5 ecology; martins swirl at dusk. WR 1 | Start (pip on first mosquito warning) |
| 34 | `wildlife_post` | Wildlife Officer Post | 1×1 | $140k | $4k | One Officer agent per post (3 tiles/s) relocates gators within 14 (3-s wrangle); nutria traps: levee burrowing −80% within 14; "Nutria Bounty" policy toggle in the post's inspect panel (+$500/mo pelts, +1 happiness; default off); debris clears instantly within 14 after a storm; after a Cat 3+ the post launches the **Cajun Navy** (§6.2 Recovery). WR 2 | Start (pip on first gator) |
| 35 | `preserve` | Wetland Preserve (zone paint) | per Marsh tile | $5k/tile | $0 | Tile protected (no building, draining, canal, path or road; the only things placeable on it are a Boardwalk, a Gator Fence and the Spoonbill Rookery, row 43); +0.5 ecology/tile; gator dens within 10 send 80% of wanders here; surge head loss 0.12 ft/tile (Marsh alone 0.08); mosquito −20% on preserve tiles with a cypress; fireflies ×3 | Start |
| 36 | `live_oak` | Live Oak | 1×1 | $12k | $0 | +1 happiness radius 4 (sampled); heat penalty −30% radius 3 (shade); wind damage −30% for buildings within 2; +0.3 ecology; 3 growth stages over 2 years; moss. WR 5 | Start |
| 37 | `cypress` | Bald Cypress | 1×1 on Wet/Marsh/water edge | $8k | $0 | +0.5 ecology; drains 0.05 ft/day on its tile and 4 neighbors; subsidence −50% within 1; surge head loss +0.02 on its tile; rust-orange in November; knees. WR 5 | Start |
| 38 | `azalea` | Azalea Bed | 1×1 | $5k | $100 | +1 happiness radius 3; blooms hot pink Mar 1–Apr 10 (+1 more, petal particles); shredded by Cat 3+, regrows. WR 1 | Start |
| 39 | `bell_tower` | The Bell Tower | 2×2 | $2.5M | $5k | Landmark +10; +3 happiness campus-wide; bells at midday and dusk; beacon at night. WR 5 ⚡ | 2,000 students & prestige 30 |
| 40 | `tiger_habitat` | Tiger Habitat (home of Roux) | 3×3 | $1.8M | $12k | Landmark +8; +5 happiness radius 15 (sampled); home win +5%; gators avoid radius 10; floods → "Roux Is Loose" event. WR 4 ⚡💧 | 1,000 students & prestige 20 |
| 41 | `surge_barrier` | Bayou Surge Barrier (Fortress capstone) | drag 4–8 tiles across the Bayou channel, perpendicular to it; the two end tiles must be land (elev ≥ 1.5 ft) or levee/floodwall tiles; the tower ends stand on auto-pilings | $6M | $40k | A gate across the bayou: closes when the bayou stage > 2 ft; while closed, every Bayou tile upstream (a smaller spline parameter than the barrier's, i.e. toward the north edge) stops being a boundary tile and holds its last stage, so surge cannot ride the bayou into the interior and must come overland through the marsh (attenuated). Requires ≥ 2 powered Pump Stations upstream (rain that the closed bayou can no longer drain); ecology −10 while it exists; −2 happiness within 4 (it is loud). WR 5 ⚡ | **Fortress Bayou** milestone |
| 42 | `marsh_restoration` | Marsh Restoration Program (Living With Water capstone) | 1×1 office on land, plus a paint of 10–40 tiles that are Drained Marsh, Wet Ground with `wetlandOriginal`, or Wet Ground within 3 of a Marsh tile | $4M | $10k | Converts the painted tiles to Marsh over 30 days (buildings on them must be gone; Wet tiles are lowered to 1.0 ft), sets `wetlandOriginal` on them, +15 × (tiles / 40) ecology once, and unlocks row 43. Coastal research ×1.25. WR 2 ⚡ | **Living With Water** milestone |
| 43 | `rookery` | Spoonbill Rookery (landmark) | 2×2 on Marsh or Preserve, on pilings | $1.2M | $4k | Landmark +6; +2 happiness radius 8 (sampled); spoonbills circle every Dawn regardless of ecology; +1 prestige target; the Almanac postcard frame. WR 3 | Marsh Restoration Program complete |

Landmark points feed the prestige composite (§5.5); they are not prestige directly. Rows 41–43 are the two identity-path capstones of §10.8: each is a money sink that also changes a system, and either one completes Objective 21.

### 0.4 Consolidation record (what came from where, and the contradictions resolved)

| Topic | Decision | Source |
|---|---|---|
| Opening 2 minutes | Founders' Hall ghost on the cursor, HUD fades in stat by stat, path to the Pirogue Landing, three pirogues, Essentials-only palette, scripted thunderstorm cell at 1:15 with a **Show me** button | Journey + Swamp cell |
| Clock | 10 s calendar day, 120-day year, separate 30 s sky cycle with a 10 s night, set pieces in event time | Judges' must-avoid; replaces every candidate's clock |
| Elevation and water | Feet everywhere | Spectacle |
| Hydrology | Head-difference CA with canals ×8, levees as raised crests, pumps in tile-ft/day, rain as per-event totals, marsh head loss as surge attenuation, surge as a watchable front entering through water tiles | Spectacle + Swamp |
| Substation cascade | Flood → blackout → pumps stop; pilings or Backup Generator as the answers; taught by the Year-1 storm objective | Swamp + Systems |
| Economy | Per-student staff cost, metered utilities, wastewater brake, bed-capped enrollment, structural prestige target with monthly lerp, sanity-checked 5-year curve | Spectacle + Systems |
| Catalog | 40 core rows plus three capstone rows (41–43), stadium tiered in place, one parameterized painter, no variant hacks (Bat House is its own row) | Judges' must-avoid |
| Terrain (v1.1 review) | Ridge widened to d = 0–22 so G1 is satisfiable, but the ≥ 5-ft crown is deliberately short (ty 6–13) so the start plot fits the tutorial's five buildings and not Objective 8's two; the south bank subsides into the Crevasse Reach; the cove is carved, not asserted; the bayou is forced past the cove mouth; distribution and G7 re-derived from the profile. Where the review's two terrain notes disagreed (wide ridge vs. capped ridge), the capped ridge wins because the storm must test something the player paid for | Lead-designer review |
| Rings, protection, gaps | One flood-fill definition (§6.2) used by Objective 11–12, the Storm panel, the ghost preview and milestones 6 and 19; the head function is the same on both sides of every flow | Lead-designer review |
| Pacing | Rolling admissions, interrupt/background objectives, an Amélie near-miss at minute ~10.5, skippable set pieces after the first, decision toasts inside landfall, a named coach and starters, capstones and an Endowment after Year 5 | Lead-designer review |
| Gators | Comic, never harmful; dens on water tiles; preserve absorbs wanders; draining marsh increases incursions | Journey + Spectacle |
| Failure states | Three-choice cards, never a game over | Journey |
| Sports collision | First Stadium II night game scripted clear on a Sep/Oct home date; **Play Through It** opt-in for storm bands | Judges' must-avoid + Swamp |
| Debug panel, bonfires, sampled happiness, desire lines | Included | Systems |
| Removed | Fill tool (marsh is drained or piled, per the brief), Trailer Dorm, Riverboat, Oak Alley, Mansion, Float Barn, Ag Center, Baseball, Garage, Coffee Kiosk, research tree, Policies screen, real-school digs, injuries and settlements, "Chad", the "Coon"/"Poo" nicknames, "Geaux Tigers" (real cheer) → **"Geaux Bayou"** | Judges' must-avoid |
| v1.2 review (§17) | 49 critic issues applied: event time in ticks, the `surface` tile layer, the floodgate rule that makes Objective 11 satisfiable, `skipTutorial` and the headless contract, Bayou Field bleachers, Spring High Water, Student Voice cards, the guaranteed landfall toast, wind as a per-storm total, drained marsh as a triple loss | Lead-designer review |

---
## 1. Title, Tagline, Pitch, Screenshot Moment

**Title:** BAYOU STATE
**Tagline:** *Build the campus. Beat the swamp. Fill the stadium.*

**Pitch.** You are the founding Chancellor of Bayou State University, a purple-and-gold college chartered on the one thing Louisiana has too much of: swamp. The state gives you a natural-levee ridge along the Big Muddy, a $4 million charter grant, a football-obsessed legislature, and several thousand acres of cypress backswamp that is trying, every single day, to take the land back. Build lecture halls on pilings, cut drainage canals, close a levee ring and remember to put a pump inside it, fog for mosquitoes, fence out the gators, and, because this is Louisiana, build a night-game stadium so loud it registers on the campus seismograph. Every June the Gulf opens hurricane season; on the 5th of every month the pirogues bring a few more freshmen and every August they bring the wave; every February the campus throws Mardi Gras. Grow from 120 students in one hall to a 20,000-student flagship, or watch the marsh reclaim your quad one wet semester at a time. *Laissez les bons temps rouler.*

**The screenshot moment (the "wait, AI made this?" frame).**
A Saturday night in October. The camera is pulled back over a full isometric campus. Six stadium light masts pour cold white-gold light into a bowl of 45,000 flickering purple-and-gold pixels doing the wave; the glow bleeds through low ground fog rolling off the bayou. Live oaks drip Spanish moss that sways in the wind. Streetlamps trace every path; every dorm window is a warm square. Beyond the last levee the swamp is black except for a thousand drifting fireflies and two pairs of red gator eyes on the water. On the minimap, a purple forecast cone is creeping in from the Gulf; the ticker reads *"Hurricane Praline forecast to strengthen. Cone includes Red Stick."* The home team scores: the stadium pulses, a brass sting plays, fireworks pop, and the whole screen shakes for 200 ms.

Every element in that frame is a system the player built, tuned, or is about to lose, and the game guarantees the frame: the first Stadium II night game is scripted onto a clear Sep–Oct night, and the **Play Through It** toggle lets a player stage the storm version on purpose.

---

## 2. Core Loop and Meta Loop

### 2.1 Minute-to-minute (60–90 s per cycle at 1×)
1. **Read the land.** Press `F`: the Flood Risk overlay shows where the next two inches of rain will pool, in feet.
2. **Decide and place.** Pick a building; the ghost shows footprint, terrain-adjusted cost, elevation warning ("Wet ground, 2.1 ft: floods in ordinary storms; +$140k or add Pilings") and connection status (path / power / water).
3. **Watch it land.** Scaffolding rises over 1–6 calendar days with dust puffs; the building pops with a squash-and-stretch and a coin sound; students immediately path to it.
4. **React to the swamp.** A gator parks on the quad; mosquito haze thickens over a puddle; the ticker names a tropical wave; a Sinking! icon appears on a dorm. Fence, drain, pump, retrofit.
5. **Collect the payoff.** Pirogues bring a new round of students on the 5th of every month (§5.4); tuition drops in with a cash burst on Aug 5 / Oct 5 / Jan 5 / Mar 5; prestige ticks toward its target; a milestone toast slides in; the palette grows a gold NEW pip.

Rule for engineers, an acceptance criterion rather than a slogan: **if a stat changes, something on screen must move.**

### 2.2 Semester-to-semester
- **Spring (Jan 5 – May 5):** Mardi Gras (Feb 6–8), the first gator (Feb 9), crawfish season (Mar 1 – Apr 10), azaleas, spring thunderstorms (the scripted Apr 5 cell), **Spring High Water** on the Big Muddy from Year 2 (Apr 1 – May 10, §6.9), Graduation (May 5) turning 22% of students into alumni who donate forever.
- **Summer (May 6 – Aug 4):** build season (construction −15%), heat index over 100, daily afternoon thunderstorm cells, hurricane season opens Jun 1, state funding arrives Jul 1.
- **Fall (Aug 5 – Dec 10):** enrollment locks Aug 5, tuition flows, football Aug 8 – Nov 8 with four home games, hurricane peak Aug 5 – Oct 5, cypress turn orange in November, finals Dec 1–10.
- **Winter break (Dec 11 – Jan 4):** campus quiet, cold snap kills mosquitoes, Levee Bonfires on Dec 9, Founders' Day recap on Jan 1.

### 2.3 Year-to-year
- **Growth flywheel:** prestige → applicants → tuition → buildings → academic quality and landmarks → prestige.
- **Swamp tax:** cheap growth means draining marsh → ecology falls → less surge attenuation, more mosquitoes, faster subsidence → flooding and illness → happiness and prestige fall → applicants fall. Building on pilings and preserving the marsh belt is slower and pricier but compounding-safe. **This tension is the game.**
- **Football flywheel:** stadium → attendance → athletics revenue → coaching budget → wins → spirit, donations, applicants → bigger stadium.
- **Subsidence time bomb:** buildings on wet or drained ground sink 0.2–0.4 ft/yr; by Year 3–5 the first cheap dorms are below the rain flood line.
- **Identity choice:** by Year 3 the player is on a path toward **Fortress Bayou** (floodwalls, pumps, brittle and expensive) or **Living With Water** (preserves, pilings, boardwalks, slower to build big). Both are viable; the badges are mutually exclusive in a given year, and each unlocks its own capstone (the Bayou Surge Barrier or the Marsh Restoration Program, rows 41–43) that changes how the surge reaches the campus. Either capstone completes Objective 21.
- **Where the money goes after Year 5:** the capstones ($4–6M), the Endowment (cash converted to a permanent donation yield) and the Second Campus charter across the bayou ($20M, needs the bridge) are the late sinks, so a $72M income never idles (§10.8).

---

## 3. World and Terrain

### 3.1 Map and coordinates
- 64 × 64 tiles; tile (tx, ty) with tx increasing south-east on screen and ty south-west; screen `sx = (tx − ty) × 32`, `sy = (tx + ty) × 16 − elev × 6` at zoom 1.
- North is screen-up. The **Big Muddy** runs down the east edge; the **Gulf** is off the south edge; **Highway 1** enters from the north edge as a pre-placed road stub.

### 3.2 Per-tile state (typed arrays, 4,096 entries, defined in `contract.js`)

| Array | Type | Meaning |
|---|---|---|
| `elev` | Float32 | Ground elevation in feet, −4 … +14. Levee/floodwall crest is separate |
| `depth` | Float32 | Standing water depth in feet ≥ 0 (water surface = elev + depth) |
| `sat` | Float32 | Soil saturation 0–1 |
| `stand` | Uint8 | Consecutive calendar days with depth ≥ 0.05 ft |
| `mosq` | Float32 | Mosquito density 0–1 |
| `subs` | Float32 | Cumulative subsidence in feet |
| `crest` | Uint8 | 0, 6 (earthen levee) or 12 (floodwall) feet. In the **live** head function (§6.1.4) it counts as 0 while the tile is an open Floodgate; in the **static** protection test (§6.2 Rings) a healthy Floodgate counts its full crest |
| `integrity` | Uint8 | Levee integrity 0–100 |
| `sandbag` | Uint8 | Temporary crest addition in tenths of a foot (Sandbags = 15 → +1.5 ft; 0 = none); enters the head function like crest |
| `sandbagDay` | Uint16 | Absolute calendar day (days since founding) on which `sandbag` expires; the daily step zeroes `sandbag` when `today ≥ sandbagDay` |
| `wear` | Uint8 | Desire-line wear count (agents cutting across grass); ≥ 40 in a day renders worn grass (§7); decays 5/day |
| `flags` | Uint16 | bit0 wetlandOriginal, bit1 preserve, bit2 canal, bit3 drained, bit4 floodgate, bit5 pondSink, bit6 bayou, bit7 openWater, bit8 dirtyChunk, bit9 desireWorn, bit10 **debris** (storm debris: walk cost ×2, cleared by the daily step 5 days after the storm or instantly within 14 of a Wildlife Post), bit11 **mound** (§3.4 step 5: unbuildable, undrainable) |
| `surface` | Uint8 | The linear surface on the tile (`BSU.SURF`): 0 none, 1 Gravel Path, 2 Campus Road, 3 Boardwalk, 4 Gator Fence. Every drag tool except Levee/Floodwall (which write `crest` and `integrity`), Canal (flag bit2) and the Preserve paint (flag bit1) writes this array, and drag tiles are **never** Building structs. Derived from it: a tile with `surface` 1–3 and the canal flag is a **culvert**; `surface` 2 on a bayou/openWater tile is a **bridge**; a **streetlamp** stands on every 4th road tile and every 6th path tile, counted along each 4-connected run from its lowest tile index; the parade route is the longest 4-connected run of `surface` 2; path adjacency and access (§3.6) are tests on `surface` 1–3. Per-tile monthly upkeep (Road $100, Boardwalk $150, Fence $80, Levee $400, Floodwall $900, Canal $500) is summed from these arrays. Bulldoze on a drag tile clears it with a 40% refund |
| `owner` | Int16 | Index into `buildings[]` of the footprint building occupying the tile, or −1 (drag tiles are −1) |
| `type` | Uint8 | Derived tile type (below), recomputed when elev/depth/flags change |
| `walk` | Uint8 | Walk-cost class for A*, derived from `surface`, type, depth and flags (§7 Pathfinding): 0 blocked, 1 path/road/boardwalk/bridge/culvert, 2 dry grass (also a bare levee berm), 3 wet, 4 wading; debris doubles the cost |

### 3.3 Tile types (derived from elevation, feet)

| Type | Rule | Buildable? | Rain behavior | Notes |
|---|---|---|---|---|
| **Open Water** | flag openWater (elev −2 … −4) | Boardwalk only | Boundary tile: surface = bayou stage (0 ft normally) | River and cypress lake. Gator dens. Surge source |
| **Bayou Channel** | flag bayou (elev −1) | Boardwalk, Road bridge ≤ 3 tiles | Boundary tile at stage | Meandering spline; pirogue route; carries surge inland |
| **Marsh** | elev < 1.5 and no water flag (elevation may fall below 0 through subsidence; it is still Marsh) | Only with **Pilings**, or after **draining** (§6.1.7); Gravel Path, Boardwalk, Fence, Levee, Floodwall, Canal and the Preserve paint are allowed | Absorbs 90% of rain until saturated; **generated with** `depth = 0.15 + 0.25 × noise` (0.15–0.40 ft standing) and `sat = 0.9` (this standing water is *not* a mosquito source on undisturbed Marsh, §6.4, and is baked into the chunk rather than drawn per frame, §12.1) | Reeds, knees; surge head loss 0.08 ft/tile; highest ecology value; mosquito nursery only when disturbed (within 2 tiles of a building or path) |
| **Wet Ground** | 1.5 ≤ elev < 3.5 | Yes, +20% cost, subsides | Absorbs 30%; floods in a 2-inch cell if it is a low tile | Dark mud, puddles; the cheap land that punishes you |
| **Dry Ground** | 3.5 ≤ elev < 6.5 | Yes | Absorbs 60% | Grass, live oaks |
| **High Ground** | elev ≥ 6.5 | Yes, −10% cost, no subsidence | Absorbs 70% | The natural levee ridge crown and the chenier cores; floods only under Cat 3+ surge. Scarce (~4%) |
| **Drained Marsh** | Marsh with flag drained | Yes, as Wet Ground (+20%) | Absorbs 20% | Subsides 0.35 ft/yr; reverts if it re-floods for 20 days |
| **Pond** | flag pondSink (a Retention Pond's four tiles, cut −3 ft, so elev may be < 0) | No | An ordinary CA tile (collects by gravity) plus the sink rule of §6.1.3; rain class Wet | `BSU.T.POND`; drawn as water; walk class 0; `classify()` must never see an elev < 0 tile without a water or pondSink flag as anything but Marsh |

Levee and floodwall tiles keep the type of the ground under them for building rules but use the High class for rain (absorb 0.6, drain 0.4 ft/day).

**Initial state at generation (Jan 1):** every land tile has `depth = 0`, `sat = 0.5`, `stand = 0`, `mosq = 0`, except Marsh (above: `depth` 0.15–0.40, `sat` 0.9) and water-flag tiles (`depth = stage − elev`, stage 0). This is the initial state of the T5 conservation test (§6.1.11) and of `test/hydro.mjs`.

Target distribution at generation, derived from the §3.4 profile and asserted by the generator to within ±3 points each: **Open Water 11%, Bayou 3%, Marsh 40%, Wet 30%, Dry 12%, High 4%, Drained 0%** (≈ 450 / 120 / 1,640 / 1,230 / 490 / 165 tiles). Dry and High are deliberately scarce: about 350 of the ~650 Dry/High tiles are reachable from the start plot without crossing water or Marsh (the crown and its Dry shoulders); the rest sit on cheniers west of the bayou (G7).

### 3.4 Procedural generation (seeded mulberry32; seed shown on the title screen and stored in the save)
All coordinates below use `bank(ty) = floor(58 + 2·sin(ty/9)) − 1`, the last land column beside the river, and `d = bank(ty) − tx`, the distance west of the bank. The start plot is anchored to the bank at rows `ty = 6–13`, so every pre-placed feature has a definite position. Because `bank(ty)` varies by row, **`bank₀ = bank(7)`** is the single column used for everything pre-placed (the Highway 1 stub, the Founders' Hall footprint, the flanking oaks and the G1 rectangle); `terrain.plot.bank0` exposes it.
1. **River:** columns `tx ≥ 58 + 2·sin(ty/9)` are Open Water at elev −4. Column `bank(ty)` is the crest of the natural levee; its tiles are the **batture** (buildable, but the Pirogue Landing and any Boardwalk may touch the river here).
2. **Natural levee ridge:** for `0 ≤ d ≤ 22`, `elev = base(ty) + 7 × crown(ty) × (1 − d/22)^1.3 + n`, where `n` is value noise in ±0.5 ft (scale 5 tiles; ±0.3 ft inside the G1 rectangle) and:
   - `crown(ty)` = **1.0 for ty 6–13** (the crown: 9.0 ft at the bank, 7.0 at d = 5, 5.9 at d = 8, 5.5 at d = 9, 4.8 at d = 11, 3.6 at d = 15, 2.0 at d = 22); **0.7 at ty 5 and 14** (6.9 ft at the bank, ≥ 5 ft to d = 6, Dry to d = 13); **0.42 for ty ≤ 4 and 15–26** (4.9 ft at the bank, Dry to d = 8, Wet beyond: buildable, but under Célestine's 5-ft surge line); then linear from 0.42 at ty 26 to **0.25 at ty 34** and 0.25 south of it.
   - `base(ty)` = 2.0 for ty ≤ 26, linear to 1.0 at ty 34, 1.0 south of it.
   - The result is real Louisiana geography with one authored exception: the highest ground is beside the river and the backswamp is lowest, but the high crown is short. South of ty 26 the bank subsides into the **Crevasse Reach** (2.75 ft at the bank, Wet for d ≤ 13, Marsh beyond), an old breach where the river once poured into the swamp: it is why the south bank cannot be leveed cheaply and why the Gulf gets in.
3. **Backswamp basin:** west of the ridge (`d > 22`), `elev = clamp(1.0 + 1.8 × noise2(tx, ty), 0, 3.4)` from 2-octave value noise (scale 11 tiles), minus a south-belt bias of 0.8 ft for `ty ≥ 50` (clamped at 0), minus a bowl toward the south-west cypress lake (ellipse at (10, 54), radii 6 × 4, elev −2, Open Water). The clamp at 3.4 ft means the backswamp holds no Dry ground except the cheniers of step 5.
   - **3b. The Cove (carved, not asserted):** an ellipse centered at `(bank(16) − 8, 16)` with semi-axes 2.5 (x) × 2 (y): every tile with `((tx − cx)/2.5)² + ((ty − cy)/2)² ≤ 1` (≈ 16 tiles) is set to `elev = 1.6 + 0.9 × r²` (1.6 ft at the center, 2.5 ft at the rim). The ring of tiles just outside the ellipse is raised to `max(elev, 2.6)` except the **mouth**: the three rim tiles on the south-west arc, centered on `(cx − 2, cy + 2)`, are set to exactly **2.2 ft** (the lip, 0.6 ft above the floor's low point, so the scripted 3-inch cell of 1:15 pools ~0.4 ft at the center over January soil (sat 0.5) and the scripted 3-inch Apr 5 cell over spring soil (sat ≥ 0.7) tops the lip at ≥ 0.6 ft; an ordinary 2-inch cell pools 0.3–0.5). The cove's north-east rim is the plot's SW corner at ≥ 5.0 ft. The cove is where the tutorial's rain pools, where the levee ring goes, and where the Year-1 surge is stopped or isn't.
4. **Bayou:** Catmull-Rom spline from the north edge at `tx = 30 ± 4` to the lake, carved to −1 ft (flag bayou) 2 tiles wide with 1-tile Marsh shoulders forced to 0.5 ft. It crosses mid-map, so the player must eventually bridge or boardwalk it.
   - **4a. Forced control point:** the second control point is `(mouthX − 2, mouthY + 2)` where `(mouthX, mouthY)` is the middle lip tile of the cove mouth, so the bayou passes within 2 tiles of the mouth by construction (G2/G3/G4 hold without re-rolling). Three further random control points follow, all with `tx ≤ bank − 12`; the spline may never enter a tile with `elev ≥ 5.0` (asserted, re-roll otherwise).
5. **Cheniers:** 5–7 elliptical ridges in the backswamp **west of the bayou** (`tx ≤ bayouX(ty) − 3`), semi-axes 5–7 (long axis E–W ± 30°) × 3–4, with a cosine profile from 2.0 ft at the rim to a crest of 6.5–7.5 ft: each 50–80 tiles, of which ~10 are High, ~35 Dry, the rest a Wet rim. They are the expansion targets reached by boardwalk or a road bridge; together they hold more Dry/High ground than the ridge. **The Mounds:** on the largest chenier the generator places two 1×1 ancient earthen mounds 4–6 tiles apart on its crest line (`elev` = chenier crest + 2 ft, flag bit11 `mound`, `owner` −1, unbuildable, undrainable, not counted as Dry/High for G5/G7, drawn from the §12.3 sprite table with a "The Mounds" hover tag). They are +1 landmark (§5.5) from the day any `surface` 1–3 tile is 4-adjacent to either mound: the oldest thing on the map, and the students found it.
6. **Vegetation entities** (removable; count toward ecology; every one is written to the save as `veg[]`, never re-derived): live oaks on Dry/High at 8% density, bald cypress on Marsh/Wet/water edges at 14%, palmetto clumps on Wet at 6%, reed tufts on Marsh at 25% (reeds are chunk decoration, not entities).
7. **Start plot and pre-placed entities:** the Founders' Hall footprint is reserved at `tx = bank₀ − 7 … bank₀ − 5, ty = 7–9` (placed by the player in Objective 1; pre-placed by `skipTutorial`); the **Highway 1** road stub is `surface = 2` down column `tx = bank₀ − 5` from the north edge, `ty = 0–6` (**7 tiles**), so its last tile (bank₀ − 5, 6) touches the footprint's top edge and Founders' Hall has access the moment it is placed; two Live Oaks flank Founders' Hall at `(bank₀ − 8, 8)` and `(bank₀ − 4, 8)`; the **Pirogue Landing** dock decoration sits on the Bayou tile nearest the cove mouth, and the Marsh shoulder tile between it and the cove is where the Objective 2 path ends (Gravel Path is legal on Marsh).

### 3.5 Generator guarantees (asserted; the generator re-rolls a derived seed up to 50 times, then falls back to a hand-authored template map)
- **G1 Start plot:** the 9 (x) × 8 (y) rectangle `tx = bank₀ − 9 … bank₀ − 1, ty = 6–13` is entirely Dry/High at **≥ 5.0 ft**, and every 3 × 3 window inside it spans ≤ 1.5 ft (no grading needed). It holds Founders' Hall (3×3), a Freshman Dorm (3×2), a Dining Hall (3×2), a Substation (2×2), a Water Tower (2×2), five oaks and the paths between them — about 50 of its 72 tiles — with room for at most one more 3×2. It does **not** hold Objective 8's second Dorm *and* Lecture Hall: that is the point.
- **G1b Ridge full:** the total number of ≥ 5.0-ft tiles reachable from the plot over land is **72–110**. If noise produces more, the generator lowers stray ≥ 5-ft tiles outside rows 5–14, then ≥ 5-ft tiles at d ≥ 9 in rows 5 and 14, to 4.9 ft (the profile alone gives ~102, so the window must hold it). Ground at 3.5–5.0 ft (the ridge shoulders) is plentiful, buildable and looks safe; it is under Célestine's 5-ft surge line, and the Substation ghost says so ("Ridge full — nearest flat 2×2 is 4.6 ft: floods at Cat 2").
- **G2 The Cove:** the carved basin of step 3b: 12–20 contiguous tiles at **1.6–2.5 ft**, rim ≥ 2.6 ft except a 3-tile mouth at 2.2 ft on the south-west arc facing the Bayou, the cove's north-east rim on the plot at ≥ 5.0 ft. Closing it means a levee from ≥ 5-ft ground around the cove and its Dry shoulder back to ≥ 5-ft ground: 8–16 tiles.
- **G3 Pirogue Landing:** on the Bayou tile nearest the cove mouth (within 2 tiles of it by step 4a); the shortest walkable route from Founders' Hall to it is ≤ 16 tiles and crosses ≥ 3 cove tiles (so the tutorial path gets wet).
- **G4 Canal route:** the cove's lowest tile is ≤ 5 tiles (4-connected over land ≤ 3.5 ft) from a Bayou tile (true by construction of 3b + 4a; asserted anyway).
- **G5 Expansion chenier:** at least one chenier of ≥ 40 contiguous Dry/High tiles within 18 tiles of the plot, separated from it by the Bayou.
- **G6 South marsh belt:** ≥ 12 consecutive Marsh tiles between ty 20 and the south edge along at least 70% of the columns `tx ≤ bank − 14` (so preserves can attenuate surge coming overland from the Gulf).
- **G7 Totals:** Dry/High tiles reachable from the plot without crossing Water, Bayou or Marsh: **300–400** (target 350; a 5,000-student campus needs ~400, so growth past Year 3 means the cove, pilings or the cheniers); Dry/High tiles map-wide ≥ 600, of which ≥ 250 on cheniers; Marsh ≥ 1,400.
- **G8 Bayou clearance:** the bayou spline never enters a tile ≥ 5.0 ft and passes within 2 tiles of the cove mouth.

### 3.6 What terrain means for building
- **Water/Bayou:** nothing but Boardwalk (walking) and Campus Road bridges (≤ 3-tile spans, ×4 cost).
- **Marsh:** two legal paths, each a design statement. **Pilings** (+40% cost): the building stands over the marsh, the tile still counts as wetland in §6.8, immune below 3 ft, no subsidence. **Drain it:** a canal within 2 tiles (or pump network) that holds the tile below 0.1 ft for 5 consecutive days flips the tile to Drained Marsh (buildable as Wet, counts as **three** lost wetland tiles in §6.8, a 15-day mosquito bloom, subsidence 0.35 ft/yr, reverts to Marsh if it sits under ≥ 0.5 ft for 20 days). Cheap now, expensive later: the real Louisiana story, and the ghost prints it (below). Marsh painted as Wetland Preserve cannot be drained or built. Gravel Path is allowed on Marsh (one lost wetland tile, and it disturbs the marsh for mosquitoes); Campus Road is not (ghost: "Use a Boardwalk or a bridge"); Levee, Floodwall, Canal, Gator Fence and the Preserve paint are allowed on Marsh; on **Preserve** tiles only a Boardwalk, a Gator Fence and the Spoonbill Rookery (row 43) may be placed.
- **Wet Ground:** buildable at +20%; subsides 0.12 ft/yr under a building (+0.06 inside a pump radius); floods when depth ≥ 0.5 ft. On Wet or Drained ground the ghost's second line states the bomb before the click: "Sinks {rate} ft/yr · below the flood line in Year {n} · Pilings then ≈ ${retrofit}", where `n` is the year the footprint's lowest tile drops under the `F` overlay's predicted 2-inch pool and `retrofit` is the §6.5 price at that year's sinkage.
- **Dry Ground:** default.
- **High Ground:** −10%; surge-only flooding.
- **Slope rule:** all footprint tiles must be within 1.5 ft of each other, otherwise the ghost turns yellow with "Grade the site +$15k/tile" and placement levels the footprint to its mean elevation.
- **Access:** every building in §0.3 rows 4–22, 24, 28, 32, 34, 39, 40, 42 and 43 needs a Gravel Path, Road or Boardwalk (`surface` 1–3, culvert and bridge tiles included) on at least one **edge tile** (a tile 4-adjacent to the footprint), and that tile must be **connected**: 4-connected through `surface` 1–3 tiles to any Highway 1 stub tile **or** to any tile 4-adjacent to Founders' Hall's footprint (the hall is the network root, so a campus that never touches the highway is still connected, and Founders' Hall itself is always connected because the stub touches it). Unconnected buildings show a red No Access icon and produce nothing. Exempt (no path needed): Quad Lawn (23), Retention Pond (29), Gator Fence (31), Bat House (33), Wetland Preserve (35), Live Oak (36), Bald Cypress (37), Azalea (38), the Surge Barrier (41), Pilings (30, an upgrade) and every drag tool (Path, Road, Boardwalk, Levee, Floodwall, Canal, Fence, Preserve paint).
- **Ridge full:** when the item on the cursor has no legal footprint left on ≥ 5.0-ft ground reachable from the plot, the ghost label adds a second line: "Ridge full — nearest flat {w}×{h} is {elev} ft ({floods at Cat 2 | floods in ordinary rain})". This is the moment the game asks the cove-or-pilings question, usually during Objective 5 or 8 (§10.1).

---
## 4. Building Catalog

Numbers are identical to §0.3; this section adds the visual brief and design intent. Every building is drawn by **one parameterized painter** from its data row: `paint = { wall: [leftFace, rightFace], roof: flat|gable|hip|dome|barrel|bowl, floors, windows: {cols, rows}, decals: [...], accent }`. Decals are named 1–2 signature details from a shared library of ~30 (`clock`, `columns`, `arcade`, `awning`, `sign`, `vents`, `tank`, `masts`, `stilts`, `scaffold`, `tarp`, `boilpot`, `dumpster`, `cars`, `pool`, `dome`, `dish`, `pipes`, `impeller`, `fountain`, `reeds`, `flag`, `banner`, `lights`, `letters`, `gourds`, `truck`, `airboat`, `bleachers`, `goalposts`, `beacon`). Palette codes are in §12. WR = wind rating; ⚡💧 = needs power/water coverage. **House style:** every academic, housing, dining and student-life row defaults to `wall: [cream stucco #F5ECD7, tan stucco #E8D9B5]`, `roof: hip` in terracotta `#B5533C` and the `arcade` decal (a ground-floor colonnade), so the campus reads as one Italianate Louisiana place rather than a generic campus builder; a row's Visual column names only what differs from that default, and **Engineering Hall is the one brutalist joke**.

### 4.1 Paths and roads
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 1 | **Gravel Path** | 1×1 drag on any land tile incl. Marsh (not Preserve) | $2k | $0 | Walkable at 4 tiles/s; required adjacency; wading ≥ 0.3 ft, impassable ≥ 0.6 ft | Start | Tan speckled strip `#C9B47C` with darker edge dots; auto-tiles straight/corner/T/cross |
| 2 | **Campus Road** | 1×1 drag; bridges water ≤ 3 tiles at ×4; not on Marsh or Preserve | $10k | $100 | Walkable + vehicles; required within 4 of Stadium, Parking, Wastewater; parade route; −1 happiness to adjacent dorms; a bridge tile is impassable only when the local surface exceeds normal stage + 2 ft | Start | Dark asphalt `#3A3A40`, gold center dashes, curbs; bridge segments show concrete piers and purple railings; a streetlamp every 4 tiles (lights pass) |
| 3 | **Boardwalk** | 1×1 drag over Marsh, Preserve, Bayou, Water or any land | $14k | $150 | Walkable at 4 tiles/s; no draining; impassable only when the local surface exceeds normal stage + 2 ft (surge ≥ 2 ft), otherwise walk class 1 whatever the depth beneath; WR 2 | Start | Gray-brown planks `#8B7355` on visible posts, shadow and ripple on the water beneath |

### 4.2 Utilities
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 4 | **Power Substation** | 2×2 | $250k | $4k | Power radius 10, 40 buildings; summer ×1.5 draw; brownout over capacity (−5 happiness, research 0); **blackout at 0.3 ft of water** unless on Pilings or covered by a Generator; WR 2 | Start | Gray gravel pad, two transformer boxes, tall insulators; blue arc spark particle at night; red blinking beacon |
| 5 | **Water Tower** | 2×2 | $220k | $2k | Water radius 12, 50 buildings; Cat 4+: 30% topple ($60k), 10% if Boarded Up or with a Live Oak within 2 (rolled on screen in wind pulse 2: sway, then topple or hold); flooded (≥ 0.3 ft) or unpowered → Boil-Water Advisory (§6.2); WR 2 ⚡ | Start | Classic tank on 4 legs, purple with gold "BSU" band; red light blinks at night; sways in storm wind |
| 6 | **Backup Generator** | 1×1 | $60k | $500 (+$2k/day running) | Ships with 3 fuel days; burns 1 per blackout day in its radius; refuel +3 for $5k; WR 3 | Start | Yellow-gold box on a skid, exhaust puffs when running |
| 7 | **Wastewater Plant** | 3×3 within 3 of Water/Bayou/Canal | $400k | $6k | Serves 6,000 students; above 1,500 students without one: capacity growth stops, −8 happiness ("campus smells like a boil gone wrong"); −5 ecology once on Marsh; WR 3 ⚡ | 1,000 students | Round concrete clarifiers with green-brown water, low tan office, steam wisps |

### 4.3 Academic
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 8 | **Founders' Hall** | 3×3 | free (Objective 1) | $8k | 300 seats; landmark +2; shelter 300 (600 during a declared emergency, cone → T+1); indestructible (repair only); WR 4 ⚡💧 | Objective 1 (pre-placed with `skipTutorial`) | Cream stucco `#F5ECD7`, terracotta hip roof, white columns, gold clock, purple flag; the origin of the house style; a live oak on each side |
| 9 | **Lecture Hall** | 3×2 | $600k | $10k | 400 seats; WR 3 ⚡💧 | Start | Tan brick, tall arched window grid 5×2, purple awning over the door |
| 10 | **Library** | 4×3 | $1.8M | $14k | Academic +20; landmark +4; +4 happiness r10 (sampled); finals hub; shelter 800; WR 4 ⚡💧 | 800 students | House style with a gold dome over the arcade, warm windows at night, lanterns at the steps |
| 11 | **Engineering Hall** | 4×3 | $2.6M | $30k | 500 seats; academic +20; research $12k/mo × (0.5 + prestige/100); levee/floodwall/canal/pump −15%; unlocks Floodwall; shelter 800; WR 4 ⚡💧 | 1,500 students | The one brutalist building on campus: gray concrete, exposed pipes painted gold, rooftop crane model that rotates ("the engineers designed it themselves") |
| 12 | **Coastal Studies Institute** | 3×3 touching Marsh/Bayou, on pilings | $2.2M | $24k | 150 seats; academic +20; research $10k/mo × (ecology/50) × (0.5 + prestige/100); cone at T−9, 30% narrower; subsidence detail overlay; ecology decay −50%; WR 3 ⚡💧 | 1,200 students & ecology ≥ 40 | Stilted green-roof lab over water, dock, research airboat, small radar dish that sweeps |

### 4.4 Housing
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 13 | **Freshman Dorm** | 3×2 | $700k | $9k | 300 beds; quality 2; shelters its own residents (300) when every footprint tile is ≥ 5.0 ft or it is on Pilings; WR 3 ⚡💧 | Start | 4-story brick slab, window grid 6×4, purple doors, a couch on the roof (decal) |
| 14 | **Residence Tower** | 3×3 | $2.4M | $22k | 900 beds; quality 3; landmark +2; shelter 900 (its own residents; only on ≥ 5.0-ft ground or Pilings); WR 4 ⚡💧 | 1,500 students | 12-story stucco tower in the house style with a terracotta cap, vertical gold stripe, rooftop water tank, random lit-window pattern at night |
| 15 | **Greek Row House** | 2×2 | $350k | $5k | 80 beds; quality 3; +3 happiness r6 (sampled); tailgate +50% within 8 of the home venue; gator attraction +2; WR 2 ⚡💧 | 600 students | White antebellum columns, gold Greek letters (ΒΣΥ), string lights, porch swing |

### 4.5 Dining
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 16 | **Dining Hall** | 3×2 | $500k | $8k | Feeds 1,200; dining r10; +3 happiness r10 (sampled); gator attraction +2 (Gator-Proof Dumpsters toggle in its inspect panel, $5k once, halves it); WR 3 ⚡💧 | Start | Long low hall, big windows, rooftop vents with steam, a boil pot out back with smoke, a dumpster (decal) |
| 17 | **Po'boy Shack** | 1×1 | $60k | $1k | Feeds 200; dining r5; +2 happiness r5 (only students who walk past count); +$2k/mo; WR 1 ⚡ | Start | Tiny tin-roof shack, hand-painted sign, a queue of 3 students at Day phase |

### 4.6 Athletics
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 18 | **Practice Field** (tier 1: the **Bayou Field** bleachers) | 4×3 | $200k; Bayou Field +$600k | $3k; +$4k | Team rating +5; enables a team (away-only club schedule until Bayou Field or a Stadium); tailgate field. **Bayou Field** (400 students, inspect-panel upgrade, 6 calendar days): 6,000 seats, day games only, landmark +1, no Road needed; WR 1 | 400 students | Striped green turf, gold goalposts, purple blocking sleds, a lone kicker; Bayou Field adds two low aluminum bleacher banks, a scoreboard on poles and a gold "BAYOU FIELD" banner |
| 19 | **Stadium** (tiered in place) | 6×5, Road within 4 | I $2M / II $8M / III $32M | $30k / $80k / $180k | I 15,000 seats, landmark +4, shelter 5,000, WR 3. II 45,000, landmark +10, night games, shelter 15,000, WR 4. III 80,000, landmark +18, fireworks, opponent −5, shelter 25,000, WR 5 ⚡💧 | I: 600 & Bayou Field; II: I & 1,500; III: II & 8,000 & prestige 50 | I "Red Stick Stadium": single-deck concrete stands on two sides, 4 light poles, gold end zones. II "The Cauldron": full bowl, purple upper deck, 6 light masts, CAULDRON in gold letters. III "Cauldron Grand": three decks, jumbotron with an animated tiger, ring of gold light. The crowd is a per-seat pixel-noise shader with a wave sweep |

### 4.7 Student life
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 20 | **Student Union** | 4×3 | $1.6M | $15k | +8 happiness r12 (sampled); idle hub; feeds 400; Mardi Gras ball and Crawfish Boil host (festival revenue ×2); shelter 2,000; WR 3 ⚡💧 | 600 students | House style with a double-height arcade and purple banners, plaza with a small fountain, big steps students sit on |
| 21 | **Rec Center** | 3×3 | $1.2M | $12k | +6 happiness r10 (sampled); heat −50% r10; removes the team heat penalty within 10 of the Practice Field; "gator in the pool"; shelter 1,000; WR 3 ⚡💧 | 800 students | House style with a terracotta barrel roof over the gym; blue lap pool visible from above with a gold lane line, climbing wall |
| 22 | **Health Center** | 2×2 | $450k | $6k | Mosquito illness −60% r12; heat illness −50% r12; WR 3 ⚡💧 | 400 students | White clinic; the red cross is a gold fleur-de-lis; ambulance bay |
| 23 | **Quad Lawn** | 2×2 tileable | $30k | $300 | +2 happiness r6 (sampled, stacks to +6); idle spot; auto-plants a Live Oak as a decal on the shared corner (one oak for ecology; shade r3 from the NW tile); no path needed | Start | Bright green lawn, diagonal paths, picnic blankets, frisbee arc between two idlers |
| 24 | **Parking Lot** | 3×2, Road within 4 | $150k | $1.5k | 1 per 600 students (else −4 happiness); tickets +$4k/mo; tailgate lot; floods at 0.3 ft (cars bob); WR 1 | Start | Gray asphalt, white lines, 30 tiny purple/gold/white cars; bobbing cars when flooded is a signature screenshot |

### 4.8 Swamp infrastructure (everything here is available from the start; pips only draw attention)
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 25 | **Earthen Levee** | 1×1 drag | $35k | $400 | Crest = elev + 6 ft; integrity 100 (nutria −15/burrow, overtopping −10/day, surge contact −5/category); < 70% → "weak" in the gap list; < 50% → crest halved; 0 → breach; repair $5k/tile, Repair All on the Storm panel; walkable; High rain class; ecology −0.2 on Marsh; canal on a levee tile = Floodgate | Start | Grassy trapezoid berm with a darker toe and a gravel crown path; **one brown burrow-hole decal per burrow event** (so a 100 → 55 ring looks chewed, not new); a cracked crown at < 50%; bonfires on Dec 9 |
| 26 | **Concrete Floodwall** | 1×1 drag | $110k | $900 | Crest = elev + 12 ft; nutria-immune; −1 happiness within 3 unless an oak is adjacent | Engineering Hall or 2,000 students | Gray T-wall panels with purple flood-gauge stripes marked in feet |
| 27 | **Drainage Canal** | 1×1 drag | $25k | $500 | Bed = max(elev − 2, 0.5) ft; conductance ×8; gravity drain if the chain reaches Bayou/Water, else needs a Pump; unconnected chain = standing water; ecology −0.3 on Marsh; Floodgate where it crosses a levee (closes when the stage > 1 ft); bare canal = walk class 0; under a Path/Road/Boardwalk = culvert (walkable, still ×8) | Start | Straight cut with concrete lips, dark water, small culvert pipes at junctions; a floodgate shows a purple gate that visibly drops when the surge comes |
| 28 | **Pump Station** | 2×2 touching a Canal or Water | $500k | $8k (+$3k while running) | 15 tile-ft/day from its canal network to Bayou/Water; needs ⚡; subsidence +0.06 ft/yr within 8; −1 happiness within 4; WR 3 | Start | Green corrugated pump house, big gold pipes, spinning impeller wheel, discharge foam particle while running |
| 29 | **Retention Pond** | 2×2 | $120k | $1k | Tiles cut −3 ft (ordinary CA tiles); a 20-tile-ft sink that pulls `min(0.5 × dtDay × 40, remaining)` tile-ft per hydro step from the deepest tiles within 5 (≤ 0.1 ft per tile per step), recovering 2 tile-ft/day by evaporation; stocked after 1 month → mosquito −80% within 4; +2 happiness r6; no path needed | Start | Blue-green pond, reeds, a bench, an egret that flies off when students pass |
| 30 | **Pilings** (upgrade) | on a building | +40% of its cost; retrofit +40% × (1 + ft sunk) | +5% of its upkeep | Ignores depth < 3 ft; no subsidence; allowed on Marsh; 1-day retrofit (closed) | Start | The building sprite drawn 10 px higher over a grid of dark posts with water/mud visible beneath |
| 31 | **Gator Fence** | 1×1 drag; not on a Path/Road/Boardwalk tile | $8k | $80 | Blocks gators and nutria; students pass (the tile keeps its ground walk class); Cat 3+ breaks 30% of segments | Start (pip on first gator) | Chain-link with gold posts, a "GATOR X-ING" sign every 6 tiles |
| 32 | **Mosquito Abatement Station** | 1×1 | $90k | $2.5k | Fogger truck (3 tiles/s) patrols paths within 8 at Dusk: mosquito −70% r8; ecology −0.5/mo while on (on/off toggle in its inspect panel, default on); WR 2 | Start (pip on first mosquito warning) | Small purple shed; a white fogger truck sprite drives the path loop trailing a white fog ribbon |
| 33 | **Bat House / Purple Martin Tower** | 1×1 | $12k | $100 | Mosquito −30% r4, stacks to −60%; +0.5 ecology; WR 1 | Start (pip on first mosquito warning) | Tall pole with a cluster of white gourds; a swirl of 8 tiny birds at Dusk |
| 34 | **Wildlife Officer Post** | 1×1 | $140k | $4k | One Officer per post (3 tiles/s) relocates gators within 14 (3-s wrangle animation); nutria traps −80% burrowing within 14; Nutria Bounty toggle in its inspect panel (+$500/mo, +1 happiness; default off); instant debris clearing within 14; launches the Cajun Navy after a Cat 3+ (§6.2); WR 2 | Start (pip on first gator) | Khaki cabin, purple truck, airboat on a trailer, a wanted-poster board with gator names |
| 35 | **Wetland Preserve** (zone paint) | per Marsh tile | $5k/tile | $0 | Protected (only a Boardwalk, a Fence and the Rookery may be placed on it); +0.5 ecology/tile; absorbs 80% of wanders from dens within 10; surge head loss 0.12 ft/tile; mosquito −20% with a cypress; fireflies ×3 | Start | Boundary of small gold marker posts; denser reeds; egret and heron sprites; lookout tower decal at the first painted tile |

### 4.9 Landscaping
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 36 | **Live Oak** | 1×1 | $12k | $0 | +1 happiness r4 (sampled); heat −30% r3; wind damage −30% for buildings within 2; +0.3 ecology; 3 growth stages over 2 years; WR 5 | Start | Massive dark trunk, spreading olive-green canopy (3 tiles wide at stage 3), 6–10 gray-green moss strands drawn per frame as wind-driven sine lines |
| 37 | **Bald Cypress** | 1×1 on Wet/Marsh/water edge | $8k | $0 | +0.5 ecology; drains 0.05 ft/day on its tile and 4 neighbors; subsidence −50% within 1; surge head loss +0.02; orange in November; WR 5 | Start | Tall conical feathery tree, flared trunk, knees poking from water |
| 38 | **Azalea Bed** | 1×1 | $5k | $100 | +1 happiness r3; blooms Mar 1–Apr 10 (+1 more, petals); WR 1 | Start | Low dark-green mound; hot-pink/magenta bloom state |

### 4.10 Prestige landmarks
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 39 | **The Bell Tower** | 2×2 | $2.5M | $5k | Landmark +10; +3 happiness campus-wide; bells at midday and Dusk; beacon; WR 5 ⚡ | 2,000 students & prestige 30 | 175-ft tan limestone tower, gold clock faces, purple flag, gold light halo at night |
| 40 | **Tiger Habitat** (home of Roux) | 3×3 | $1.8M | $12k | Landmark +8; +5 happiness r15 (sampled); home win +5%; gators avoid r10; floods → "Roux Is Loose"; WR 4 ⚡💧 | 1,000 students & prestige 20 | Naturalistic enclosure: rock, pool, live oak, glass wall; an orange-and-black tiger sprite that paces and yawns; students take selfies |

### 4.10b Capstones (Year 5+; each is the money sink of one identity path, §10.8)
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 41 | **Bayou Surge Barrier** | drag 4–8 tiles across the Bayou channel; end tiles on land (elev ≥ 1.5 ft) or levee/floodwall tiles; towers on auto-pilings | $6M | $40k | Closes when the stage > 2 ft; while closed, Bayou tiles upstream stop being boundary tiles (they hold their last stage), so surge must come overland through the marsh; needs ≥ 2 powered Pumps upstream; ecology −10 while it exists; −2 happiness within 4; WR 5 ⚡ | Fortress Bayou | Two concrete towers with a gold-striped steel gate that visibly drops (sector gate animation, 2 s) when the stage crosses 2 ft; amber beacon while closed |
| 42 | **Marsh Restoration Program** | 1×1 office + a paint of 10–40 eligible tiles (Drained Marsh; Wet Ground with `wetlandOriginal`; Wet Ground within 3 of Marsh) | $4M | $10k | Painted tiles become Marsh over 30 days (buildings on them must be gone; Wet tiles lowered to 1.0 ft); `wetlandOriginal` set; +15 × (tiles/40) ecology once; Coastal research ×1.25; unlocks the Rookery; WR 2 ⚡ | Living With Water | Green field office with a purple "BSU Coastal" sign; painted tiles show planted cypress saplings that grow over the 30 days; an airboat parked beside |
| 43 | **Spoonbill Rookery** | 2×2 on Marsh or Preserve, on pilings | $1.2M | $4k | Landmark +6; +2 happiness r8 (sampled); spoonbills circle every Dawn regardless of ecology; +1 prestige target; postcard frame; WR 3 | Marsh Restoration complete | A stilted viewing platform with a gold rail over a cypress island full of pink 10 × 14 px spoonbill sprites; nest decals; students with binoculars |

### 4.11 Interaction rules that are not rows
- **Floodgate:** a Canal tile that is also a Levee/Floodwall tile (either order of placement; flag bit4). Conducts normally; when the bayou stage exceeds +1 ft it closes (k = 0 across it) so the canal cannot carry surge into the ring, and it reopens when the stage falls back to ≤ 1 ft. In the **live** head function (§6.1.4) its `crest` counts as 0 while it is open, which only matters at stage ≤ 1 ft (rain drains out through it, which is the point of a gate). In the **static** protection test (§6.2 Rings) a Floodgate with integrity ≥ 50 counts its **full crest**, because that is what it will be when the surge arrives; only a gate flagged **jammed** (`storm.jammedGates[]`, the 10% roll per gate at Cat 3+, decided at landfall tick 150) counts as open. The gap list never reports a healthy gate as a gap; it lists it as an informational line, "canal crossing at (x, y): will auto-close". There is no manual close. This is what makes Objective 11 satisfiable with the tutorial canal running through the ring.
- **Power and water coverage (⚡💧):** a building that lacks power coverage *or* water coverage runs at **50%**: half its seats, beds, feeds, research and happiness aura, no lit windows at Night, and a red ⚡ or 💧 icon over it (the `P` overlay pulses it). A building lacking **both** counts 0 (closed, as if flooded, without damage). A **blackout** (flooded substation, wind outage or a Generator running dry) is exactly this 50% state applied to every ⚡ building in that substation's coverage at once, with three things that go to zero rather than half: Pump Stations stop, research is 0 and lights are off (§6.2 Power); a **brownout** (over capacity) is −5 happiness and research 0 without the 50% rule. Buildings that do not carry ⚡/💧 in their row are unaffected. **Assignment:** only rows carrying ⚡ (or 💧) count toward a provider's capacity; each such building is assigned to the nearest in-range provider (radius = Chebyshev distance between the nearest footprint tiles of each) with spare capacity, ties broken by the provider's placement order, recomputed on `building:placed`, `building:removed`, `building:complete` and any power-state change; a building for which no in-range provider has spare capacity is uncovered. A Water Tower that is itself unpowered (its pump is ⚡) serves 25 buildings instead of 50 and triggers the Boil-Water Advisory (§6.2 Recovery). **Tutorial suppression:** until Objective 5 completes, the penalty is not applied (the Dorm, Dining Hall and Founders' Hall exist for ~65 s before the Substation and Water Tower), so the Applicants/Capacity chip at 0:45 reads 700 / 345 as written; the icons still show, which is the hint.
- **Shelter:** each building's shelter capacity (Founders' 300, or 600 during a declared emergency, i.e. from the cone to T+1: "everyone in the gym"; Library 800; Engineering 800; Union 2,000; Rec 1,000; Stadium 5k/15k/25k). **Dorms and Residence Towers shelter their own residents** (300 / 900) when every footprint tile is ≥ 5.0 ft or the building is on Pilings; the Storm panel's shelter line counts them. Evacuation (§6.2 prep) removes everyone from the count. At landfall, students without a shelter slot are "wet and miserable": −8 happiness for 10 days and +2% attrition that semester. Nobody is ever hurt.
- **Policy toggles** live in the owning building's inspect panel, never in a separate screen: Gator-Proof Dumpsters (Dining Hall, $5k once, off by default), Nutria Bounty (Wildlife Post, default off), Abatement on/off (Abatement Station, default on), tailgate permits (Season panel, default **Paid**), auto-repair (Budget panel, default on). Each is saved in the building's `data` object (§15.2).
- **Auto-names:** halls, dorms and dining spots draw from the name pools in §14; the player can rename anything in the inspect panel.
- **Demolish:** refund 40% of cost (per tile for drag tiles); landmarks and Founders' Hall cannot be demolished; a demolished levee tile leaves a gap the detector reports.

---

## 5. Economy

### 5.1 Starting state
- **Cash** $4,000,000. **Loan line** to −$2,000,000 at 1% per month ("Legislative bridge loan"). Below −$2M for 3 consecutive months triggers the bankruptcy card (§10.7).
- **Students** 0 → 120 (Objective 2). **Alumni** 0. **Prestige** 10. **Happiness** 60. **Ecology** computed from the map, typically 80–85.
- **Tuition** $6,500 per semester (slider $3,000–$15,000, step $250). **Faculty quality** Basic. **Selectivity** Open. **Coaching budget** $0 (slider appears with the Practice Field).
- **Date** Jan 1, Year 1 (spring semester opens Jan 5; the founding cohort pays on arrival).

### 5.2 Money sources

| Source | When | Formula | Year 1 | ~5,000 students (Y5) |
|---|---|---|---|---|
| **Tuition** | Two installments per semester: Aug 5 & Oct 5, Jan 5 & Mar 5 | `students × tuition × 0.5` per installment, on the students enrolled that day (rolling admissions, §5.4, raise the Mar 5 installment) | $1.2M spring (120 on Jan 5, ~237 on Mar 5), $4.5M fall | ~$65M/yr |
| **State funding** | Jul 1 | `students × $2,500 × (0.6 + 0.8 × prestige/100) × ecoFactor`; `ecoFactor = 0.85 if ecology < 30 else 1.0` | $0.9M (496 students, prestige ~14) | $10M |
| **Donations** | Monthly | `alumni × $8 × (0.5 + prestige/100) × footballMult`; `footballMult = 1 + 0.1 × winsLastSeason` (cap 2.0); Homecoming month ×3 | $0 | $15–40k/mo (~1,700 alumni by Year 5) |
| **Research** | Monthly | Engineering `$12k × (0.5 + prestige/100)`; Coastal `$10k × (ecology/50) × (0.5 + prestige/100)` | $0 | $30–40k/mo |
| **Athletics** | Per home game (4/yr) | `attendance × (ticket + $12 concessions) + tailgate` (§8) | ~$1.0M (three or four sold-out Bayou Field day games, 6,000 seats) | $2–3M/game at Stadium II |
| **Parking tickets** | Monthly | `min(lots, ceil(students/600)) × $4k` | $4k/mo | $36k/mo |
| **Festivals** | Mardi Gras Feb 8; Crawfish Boil Apr 5; Homecoming Oct 8 | Mardi Gras `$50k + $5 × students` (×2 with Union); Crawfish Boil `$20k` (+$10k with Union); Homecoming `$30k` | $50k | $0.2M/yr |
| **Nutria pelts** | Monthly with the bounty on | `$500 × Wildlife Posts` | — | trivial, funny |
| **Tutorial grants** | On completing Objectives 1–7, 9, 10 and 11 (§10.2 reward column) | $50k "Legislature approves" ×10 | $500k | — |
| **Endowment yield** | Monthly, Year 5+ | `endowment × 0.4% / month` (4.8%/yr) on cash the player has moved into the Endowment (§10.8); irreversible | — | $0.2–0.4M/mo at $50–100M |
| **State Disaster Grant** | 20 days after landfall | `min($800k, 40% of repair bill) × (1.25 if ecology ≥ 50)` | ~$150k | — |

### 5.3 Costs

| Cost | Rule |
|---|---|
| **Construction** | catalog cost × terrain modifiers: Wet +20%, High −10%, Pilings +40%, grading $15k/tile, road over water ×4, summer (May 6–Aug 4) −15%, Engineering discount −15% on levee/floodwall/canal/pump |
| **Upkeep** | Σ catalog upkeep over footprint buildings + per-tile upkeep over `surface`, `crest` and canal tiles (§3.2), charged on the 1st |
| **Staff salaries** | `students × $450 × qualityMult` per month; Faculty Quality slider Basic 1.0 / Good 1.25 / Elite 1.6 (it raises `facultyScore` in §5.5; there is no separate flat prestige bonus) |
| **Utilities** | `$300 × buildings + $8 × students` per month, ×1.5 in Jun–Sep (AC) |
| **Coaching budget** | slider $0–$3M/yr, charged monthly; adds `budget/100k` to team rating (max +30) |
| **Disaster repair** | `damage% × catalog cost × 0.6`; unrepaired buildings run at `(1 − damage%)` and leak −3 blight each (§5.5); Repair All button; auto-repair toggle |
| **Prep actions** | Board Up $5k/building (crews board 6 per calendar day, §6.2); Sandbags $10k per 10 levee tiles on the protected boundary (§6.2 Prep); Evacuate $20k per 1,000 students; Pre-drain doubles pump running cost for the window |
| **Interest** | 1% per month on a negative balance |
| **Demolition** | refunds 40% |

### 5.4 Enrollment model (rolling admissions)
Students arrive **every month**, not twice a year, so the Students stat moves in every 100 s of play and the pirogues keep coming. Three kinds of round:

- **Rolling round, the 5th of every month except Aug and Jan:** admit `round(0.20 × max(0, capacity − students))`, capped by the remaining applicant pool. Delivered by a **pirogue arrival** (1–3 pirogues by count, the same 4-s spline as the founding cohort): this is the on-screen "something moves" for Students.
- **Spring lock, Jan 10** (moved from Jan 5 so the first Dorm, finished at ~1:25, counts): admit 25% of the gap, same cap. Year 1's founding cohort (120) arrives at ~0:35 outside any round.
- **Fall lock, Aug 5:** the big wave: `newStudents = min(accepted, capacity − students)` fills the remaining gap in one arrival (buses on the road plus pirogues).

```
applicants   = (60 + 28 × prestige + 6 × happiness) × tuitionFactor × footballBuzz     // recomputed on the 1st of each month
tuitionFactor = clamp(1.65 − tuition / 10000, 0.3, 1.5)      // $6,500 → 1.0; $3,000 → 1.35; $12,000 → 0.45
footballBuzz  = 1 + 0.03 × winsLastSeason (+0.10 for a bowl win)
capacity     = min(beds × 1.15, seats × 1.4, dining × 1.6, wastewaterCap)              // 50%-rate buildings (§4.11) count half
wastewaterCap = 1,500 without a Wastewater Plant, else 6,000 × plants
accepted     = applicants × selectivity          // Open 100% / Selective 60% / Elite 35%; the "+0 / +4 / +10 prestige target" is 0.10 × selectivityScore (§5.5), not a separate term
pool         = accepted − admitted since the last Aug 5                                   // the applicant pool the rounds draw from
newStudents  = min(pool, gapShare)              // gapShare = 20% (rolling) / 25% (Jan 10) / 100% (Aug 5) of (capacity − students)
attrition    = students × (0.02 + (100 − happiness)/100 × 0.08)   // at semester ends Dec 10 and May 5; happiness 60 → 5.2%
graduation   = 22% of students on May 5 from Year 2 onward → alumni
```
**Order on May 5:** graduation (Year 2+) → attrition → the rolling round, then the 150-tick Graduation set piece; Dec 10 is attrition only. Worked Year 1 at 1×: Jan 1 prestige 10, happiness 60 → applicants ≈ 700; the chip at 0:45 reads "Applicants 700 / Capacity 345" (one Dorm: 300 × 1.15). Jan 10 (1:50): 25% of (345 − 120) → +56 → 176. Feb 5: +34 → 210; Mar 5: +27 → 237. If the second Dorm and the Lecture Hall (Objective 8) are up by April, capacity is 690 (600 beds × 1.15; 700 seats → 980; dining 1,920) and the rounds grow: Apr 5 +91 → 328; May 5 attrition −17, +76 → 387; Jun 5 +61 → 448; Jul 5 +48 → 496; Aug 5, prestige 16, happiness 62 → applicants ≈ (60 + 448 + 372) ≈ 880, and the wave fills to **690**, bed-capped. The HUD reads "Applicants 880 / Capacity 690": the first lesson is that beds are the bottleneck, and the game says so in the tooltip. A player who never builds the second Dorm stays capped at 345 and watches the rounds shrink toward it, which is the tell.

### 5.5 Prestige model (0–100; structural target, monthly lerp)
```
target = 0.22 × academicQuality + 0.14 × facultyScore + 0.16 × happiness + 0.16 × football
       + 0.12 × landmarks + 0.10 × ecologyBonus + 0.10 × selectivityScore − blight
prestige += 0.06 × (target − prestige) each month (1st)
```
- `academicQuality` = clamp(40 × min(1, seats/(1.2 × students)) + 20·Library + 20·Engineering + 20·Coastal, 0, 100), then ×(0.9 + 0.2 × classAttendance) where `classAttendance` is the fraction of agents that reached class during the last completed **sky cycle** (reset at Dawn; §7), averaged over the calendar days since the last 1st.
- `facultyScore` = 70 × qualityMult (Basic 70, Good 87.5, Elite 100 cap).
- `football` = 0 without a team; with a team `40 × winPct + 20 × stadiumTier` (cap 100).
- `landmarks` = clamp(2 × Σ landmark points, 0, 100) (Founders' 2, Library 4, Residence Tower 2, Bayou Field 1, Stadium 4/10/18, Bell Tower 10, Tiger Habitat 8, Spoonbill Rookery 6, the Mounds 1 once reached (§3.4), BSU West 10).
- `ecologyBonus` = ecology × (1.0 if Coastal Institute else 0.4).
- `selectivityScore` = 0 / 40 / 100 (Open / Selective / Elite); its 0.10 weight is the "+0 / +4 / +10" quoted in §5.4. Faculty quality enters the target only through `facultyScore`; there is no flat faculty bonus.
- `blight` = 3 per unrepaired damaged building + 8 if any core building has been flooded > 3 days + 5 if the campus mosquito index > 0.6.
- Milestones give instant bumps of +2 to +5. Lecture-hall spam cannot reach 100: seats saturate at 1.2 per student and everything else is a ratio.

### 5.6 Happiness model (0–100)
```
happiness = 50 + housing + dining + life + green + spirit + events − mosquito − flood − gator − heat − tuition − crowd − noise
```
- **Abstract terms** (from the ledger): `housing` = avg quality × 4 (max +12) − 10 if beds < students; `dining` = +8 × (share of housing tiles inside a dining radius) − 10 if none; `spirit` = +2 per home win this season, +6 for 7 calendar days after beating Magnolia State, +5 during Mardi Gras / Crawfish / Homecoming (Homecoming's +5 needs the bonfire, and the bonfire needs a Quad Lawn; without one it is +2 and the card says "No quad, no bonfire"), +2 per 10 levee tiles on Dec 9; `flood` = 4 per flooded building (cap 20) + 10 if any dorm is flooded; `gator` = 3 per gator incident in the last 10 days (cap 15); `tuition` = max(0, (tuition − 7,000)/400) ($12k → −12.5); `crowd` = 10 × max(0, students/seats − 1); `noise` = 1 per road-adjacent dorm + 2 per pump within 4 of a dorm + 2 per Surge Barrier within 4 of a dorm.
- **`events`** = Σ of the active timed and flat modifiers below. Each is a row in `progress.timers[]` (`{id, untilDay, value}`; flat modifiers use `untilDay = ∞` while their source exists) and each appears by name in the Happiness breakdown popover. This is the one table; nothing elsewhere may add a happiness modifier that is not in it.

| id | Value | Duration | Source |
|---|---|---|---|
| `bellTower` | +3 | while built | The Bell Tower (§0.3 row 39) |
| `wastewater` | −8 | while > 1,500 students and no Wastewater Plant | §0.3 row 7 |
| `brownout` | −5 | while over capacity | §4.11 |
| `floodwallView` | −1 per dorm within 3 of a floodwall with no adjacent oak (cap −5) | while true | §0.3 row 26 |
| `evacuation` | −6 | 10 days from the Evacuate purchase | §6.2 prep |
| `unsheltered` | −8 | 10 days from landfall | §4.11 Shelter |
| `boilWater` | −4 | 3 days | Boil-Water Advisory (§6.2 Recovery) |
| `playThroughIt` | −10 | 10 days | §8 |
| `austerity` | −10 | 1 year | Bankruptcy card (§10.7) |
| `sunbather` | +1 | one season | Achievement 10 |
| `tuitionFreeze` | +5 | 1 year | Board card |
| `homecomingBudget` | +3 / +6 | 10 days | Board card |
| `bigBoil` | +3 | 1 month | Achievement 16 |
| `noParking` | −4 | while lots < ceil(students/600) | §0.3 row 24 |
| `nutriaBounty` | +1 | while on | §0.3 row 34 |
| `freePermits` | +3 | while tailgate permits are Free | §8 |
| `surgeBarrier` | −2 per dorm within 4 | while built | §0.3 row 41 |
| `gatorPool` | −2 | 1 day | "Gator in the pool" |
| `beads` | +1 per 10 bead catches in the parade (cap +3) | 10 days | Mardi Gras parade, "Throw me somethin'" (§14.3) |
| `hurricaneParty` | +2 | 3 days | Landfall shelter toast declined (§6.2) |
| `goForIt` | −2 | 10 days | A halftime "Go for it" that lost (§8) |
| `studentVoice` | +2 | 1 month | A fulfilled Student Voice card whose payoff is happiness (§7.1) |
| `roux` | (in `life`, not here) | | |

- **Sampled terms** (from where agents actually stand, §7 Sampling): `life` = mean over agents of the strongest Union/Rec/Greek/Po'boy/Dining/Habitat aura at their tile (cap +12) — a Po'boy Shack nobody walks past does nothing; `green` = mean Quad/Oak/Azalea/Pond/Rookery aura (cap +10); `mosquito` = 25 × mean mosquito density at agent tiles; `heat` = heat penalty at agent tiles (0–10, reduced by shade and pool coverage).
- **Smoothing and seeding:** the sampled terms are accumulated per tick and averaged over one **calendar day** (10 s at 1×; the per-agent daily mean of §7); the displayed happiness is an EMA with a 1-day time constant, **seeded at 60** at the charter. The "beds < students −10" and "no dining −10" terms are suspended until Objective 3 completes, so the formula gives ~58–62 during the first minute instead of ~30. The HUD never jitters.

### 5.7 The five-year money curve (projection with a competent build order; `test/econ.mjs` re-runs it headless through `test/domstub.mjs`)

| Year | Students (fall) | Income | Operating cost | Construction | Notes |
|---|---|---|---|---|---|
| 1 | 690 | $8.3M | $3.6M | $5.7M | Rolling admissions add ~$0.4M of spring tuition, the ten $50k grants $0.5M, state funding $0.9M on Jul 1 and three or four sold-out Bayou Field day games ~$1.0M; the Practice Field and bleachers ($0.8M) and the cove levee ring and pump (~$1.0M) are in Construction; cash bottoms near $0.3M in July before the Aug 5 payday; the Célestine repair bill is ~$200k (more if the second Dorm went on the 4-ft shoulder) |
| 2 | 1,500 | $17.0M | $8.3M | $8.6M | Union, Library, second pump, Red Stick Stadium ($2M) in the fall; wastewater cap bites at 1,500 |
| 3 | 1,500 → 1,900 | $25.0M | $12.5M | $17.2M | Stadium II ($8M) in January (1,500 students reached at the Year-2 fall lock): the first night game is the scripted Sep/Oct frame (§10.4), at minute ~45 at 1× or ~25 at mixed speeds; Engineering, Wastewater; cash dips to −$1.4M in May |
| 4 | 3,570 | $43.5M | $20.9M | $13.8M | Coastal Institute, Bell Tower, Tiger Habitat, first floodwalls |
| 5 | 5,250 | $73.0M | $33.5M | $16.0M | The first capstone ($4–6M) and the Endowment take the surplus; Stadium III ($32M) is a Year 6–7 decision |

Operating cost stays at 45–55% of income, so growth funds growth without ever detaching from expenses; the May troughs (graduation plus attrition before the fall payday) are why the Budget panel shows **Runway: 3 months to Aug 5** in red when cash cannot cover the projected months.

### 5.8 Key feedback loops
1. **Growth flywheel** — prestige → applicants → tuition → buildings → academic quality and landmarks → prestige. Brakes: bed/seat/dining/wastewater capacity, salaries scaling with students, crowd penalty.
2. **Football flywheel** — stadium → attendance (fanbase-driven, §8) → revenue → coaching → wins → spirit, donations, applicants → bigger stadium. Brake: a stadium the fanbase cannot fill is a $30k–$180k/month hole; attendance is derived from students, alumni and prestige, never from seats.
3. **The swamp tax** — draining marsh → ecology ↓ → surge attenuation ↓, mosquitoes ↑, subsidence ↑ → flooding, illness → happiness and prestige ↓ → applicants ↓. Preserves and pilings cost more now and less forever.
4. **The substation cascade** — substation floods → blackout → pumps and AC stop → dorms flood → −10 happiness → attrition. Answers: pilings on the substation, a Backup Generator, a levee ring with a floodgate.
5. **Subsidence time bomb** — drained-marsh buildings sink 0.35–0.41 ft/yr; a 1-ft drop puts a Year-1 dorm under the 2-inch-cell flood line by Year 3. Answers: pilings, re-grade, build on the ridge, keep the marsh.
6. **Hurricane shock** — a Cat 3 can erase a year of unrepaired progress; levees, floodgates, pumps, WR, shelters, evacuation and cash reserves convert catastrophe into a bill, and the recovery story ("The Cauldron reopens 4 days after Praline") gives +4 prestige.

### 5.9 Board of Regents cards (at each semester lock, Jan 10 and Aug 5, the Board offers **two** cards drawn without replacement; the player picks one or dismisses both)
Drawn from: **Lobby the Legislature** (−$100k; state funding +10% next Jul 1) · **Research Push** (−$200k; research ×1.5 for a year) · **Tuition Freeze** (+5 happiness, applicants +10%; tuition locked for a year) · **Recruiting Trip** (−$150k; team rating +3 next season; distinct from the fall-lock recruiting card of §8, which names a player) · **Marsh Restoration Grant** (+$300k earmarked for Preserve/Cypress/Pond) · **Summer Session** (students stay in summer: +15% summer tuition, heat penalty ×1.5, agents present in summer) · **Insurance Policy** (2% of building value per year; pays 50% of hurricane repairs; persists until cancelled) · **Homecoming Budget** ($0/$50k/$150k → +0/+3/+6 happiness, +0/+1/+3 prestige for 10 days, the `homecomingBudget` timer).

---
## 6. Swamp Survival Systems

Every system is written as **rule / threat / tell / counterplay / comedy**. Every constant lives in `BSU.params` and has a slider in the debug panel (§11.9). Nothing here is gated behind unlocks: every defense and every storm-prep action is available from the first minute.

### 6.1 Hydrology

**6.1.1 State and step.** Per-tile `elev`, `depth`, `sat`, `stand`, `crest`, `integrity`, flags (§3.2). The hydro step runs 4 times per 10 sim ticks (ticks 0, 2, 5 and 7 of each 10-tick block) with `dtDay` = calendar days per step (1/40 normally; 1/360 during the landfall set piece; 1/60 during a near-miss bands pass; 0 during a game day, the Mardi Gras parade and Graduation). The initial state at generation is defined in §3.3. Two Jacobi passes per step over a checkerboard write to a back buffer. The active set is the tiles with `depth > 0.01` or that received flow last step, plus every tile while it is raining; in dry weather that is ~5% of the map.

**6.1.2 Rain intake (per-event totals, never per-hour rates).**

| Event | Total | Extent | Duration | When |
|---|---|---|---|---|
| Shower | 0.5 in (0.04 ft) | map-wide | 1 calendar day | any season, 25–40% of days by month |
| Frontal rain | 1.5 in (0.125 ft) | map-wide | 1 day | Nov–Mar, 30% of rain days |
| Thunderstorm cell | 1–3 in uniform (median 2 in = 0.167 ft); the two scripted Year-1 cells (1:15, §10.1, and Apr 5, §9.2) are exactly 3 in | radius 14 blob, drifts NE 1 tile per 0.1 calendar day (10 ticks at any speed) | 1.5 calendar days (150 ticks; 15 s at 1×) | Apr–Sep afternoons (starts in the second half of a Day phase), 55% of summer days |
| Tropical band | 4 in (0.33 ft) | map-wide | 1 day | T−1 before landfall and T+1 after |
| Hurricane | 6 / 8 / 10 / 13 / 16 in by category | map-wide | the 900-tick landfall event (`dtDay` = 1/360) | landfall |

Per step, each land tile under rain receives `r = total / durationSteps`. On impact, `absorbed = r × absorbFrac × (1 − sat)`; `depth += r − absorbed`; `sat += absorbed / 0.5`.
`absorbFrac`: High 0.7, Dry 0.6, Wet 0.3, Marsh 0.9, Preserve 0.95, Drained 0.2, paved/building/parking 0.05, canal 0.
`sat` decays 0.12/day in dry weather (0.20 when the heat index > 95). A wet spring leaves `sat` near 0.7, so the same 2-inch cell pools twice as much in April as in October: the water table without a water table.

**6.1.3 Standing-water drain (ft per day):** High 0.6, Dry 0.4, Wet 0.15, Marsh 0.05, Drained 0.15, paved 0.02, levee/floodwall tiles 0.4 (High class; their `absorbFrac` is 0.6); plus evaporation 0.03 (0.06 Jun–Sep); plus Bald Cypress 0.05 on its tile and 4 neighbors. **Retention Pond:** its four tiles are cut −3 ft and are ordinary CA tiles (they collect water by gravity like any low tile). In addition the pond is a sink with `capacity` = 20 tile-ft: each hydro step it removes `min(0.5 × dtDay × 40, capacity)` tile-ft from the tiles within radius 5, taking from the deepest tile first and never more than 0.1 ft from one tile in one step; `capacity` recovers by evaporation at 2 tile-ft per day up to 20. The removed water leaves the system (it is counted in the T5 conservation test as a sink term).

**6.1.4 Flow.** One head function, used on **both** sides of every exchange:
```
crestTop_t = elev_t + crest_t × integrityFactor_t + sandbag_t / 10   (crest_t counts as 0 while t is an OPEN Floodgate)
H(t)       = crestTop_t + depth_t                                      (depth sits on top of a crest; sandbag is in tenths of a foot)
loss_j     = 0.08 if j is Marsh, 0.12 if j is Preserve, +0.02 if j has a Bald Cypress, else 0
for tile i and each 4-neighbor j:
  H_j' = H_j                                    // the receiving head
  if crest_j > 0 and H_i ≥ crestTop_j:          // j is a levee/floodwall tile that i OVERTOPS this step
      H_j' = elev_j + depth_j                   // the crest is not counted on the receiving side while it is overtopped
      test = (H_i ≥ H_j' + loss_j)              // ≥, so an 8-ft surface pours over an 8-ft crest
  else
      test = (H_i > H_j' + loss_j)
  if test:  flow(i→j) = min(depth_i / 2, (H_i − H_j' − loss_j) / 2 × k)
k = 0.35; k × 8 if either tile is an open Canal (or a culvert); k = 0 across a closed Floodgate
```
Because the crest is in `H` on the receiving side too, water on a neighbor cannot enter a levee tile until the neighbor's surface reaches the crest; at and above it (the overtopping branch) the water pours onto the crown, and from there the levee tile's own outflow, computed with its full `H`, sheds it to whichever side is lower, so water really crosses an overtopped wall instead of stalling at equality. Rain that lands on a levee tile likewise sits on top of the crest and sheds off. Demanded outflows are scaled so a tile never gives more than half its depth per pass. Open Water and Bayou tiles are boundary conditions: after every pass `depth = stage − elev`, so they are infinite sinks in normal play and infinite sources during surge (except Bayou tiles upstream of a closed Surge Barrier, which hold their last stage). `integrityFactor` = 1.0 at ≥ 50%, 0.5 below, 0 at breach.

Two events are defined on this rule and nowhere else:
- **Overtopping** of a levee/floodwall tile i: during a step, any 4-neighbor j has `H_j ≥ crestTop_i` (surface **≥** crest; 8 ≥ 8 overtops), which is exactly the condition that takes the overtopping branch above, so the event, the flow and the protection test (§6.2, `≤ H`) can never disagree. Fires `levee:overtop` once per tile per calendar day; integrity −10 per day while it persists; the sheet particle pours over the crest.
- **Surge contact** of a levee tile: an adjacent boundary tile (Open Water/Bayou) has `stage > 1 ft`. Integrity −5 × category once per storm.

The head loss is what makes marsh a flood defense: the water surface drops 0.08 ft for every marsh tile it crosses, 0.12 per preserve tile, so a 20-tile preserved belt knocks ~2.4 ft (half a category) off an overland surge, while the bayou carries surge undiminished, which is why levees along the banks still matter.

**6.1.5 Pumps, canals, floodgates.** A canal chain is a network; a network touching Bayou/Water drains by gravity (its bed is 0.5–2 ft below grade, so it collects and conducts at ×8). A Pump Station touching the network removes **15 tile-ft per calendar day** spread across the network's canal tiles (0.375 per step) and discharges to the nearest water; pumps stop without power. A canal tile that is also a levee is a **Floodgate**: it conducts until the bayou stage exceeds +1 ft, then closes (k = 0 across it, and its crest re-enters the head function) and reopens when the stage falls back to ≤ 1 ft; while open its crest counts as 0 in the **live** sim only. The static protection test treats a healthy gate as closed, because it will be when the surge comes (§4.11, §6.2 "Rings, protection and gaps"). During Spring High Water (§6.9) the bayou stage can sit above 1 ft for the whole window, so a gate stays shut for days and spring rain inside the ring needs its pump. A canal tile under a Path, Road or Boardwalk is a **culvert**: it conducts at ×8 exactly like a canal and is walkable at the surface's class; a bare canal tile is walk class 0. Rule of thumb the tutorial states out loud: **one pump per 10 tiles of enclosed low ground.**

**6.1.6 Flood thresholds (feet of standing water, from the deepest tile in a footprint).**
- ≥ 0.05: puddle rendered; `stand` counts up (mosquitoes).
- ≥ 0.3: paths become wading (agents 1.2 tiles/s, splash particles); Parking Lots flood (cars bob); Substations black out.
- ≥ 0.5: a building is **flooded** (≥ 3.0 on Pilings): closed (no seats, beds, service, coverage), takes 2% damage per day, mosquito breeding ×2, residents move to shelter; upkeep continues (the comedy of bureaucracy).
- ≥ 0.6: paths impassable; agents route around. **Exception:** Boardwalk tiles and Road bridge tiles ignore the depth beneath them and are impassable only when the local water surface exceeds the normal stage + 2 ft (i.e. a surge ≥ 2 ft); a culvert (canal under a path/road/boardwalk) uses its surface's class.
- ≥ 2.0 (surge): 5% damage per day; ≥ 4.0: 25% per day; 100% damage = a Ruin sprite rebuilt at 60% of cost.

**6.1.7 Draining marsh.** A Marsh tile with `depth < 0.1` for 5 consecutive days and a canal within 2 tiles (or inside a pump network's radius 8) flips `drained`: it is now buildable as Wet Ground, counts as three lost wetland tiles in §6.8 (there is no separate one-time penalty), `mosq += 0.3` for 15 days ("the mud stage"), subsidence 0.35 ft/yr under a building. If it sits at ≥ 0.5 ft for 20 consecutive days with no canal or pump in range, it reverts to Marsh (and any building on it is flooded). Preserve tiles never drain.

**6.1.8 Tells.** `F` **Flood Risk** overlay: the CA is run 40 steps on a scratch copy with a 2-inch map-wide rain and the current `sat`, cached until a tile changes or 5 days pass; tiles are tinted by predicted depth with the number in feet on hover. `W` **Water** overlay: current depth. Inspect panel on any tile: "Elev 2.1 ft · Water 0.4 ft · Saturation 70% · Standing 3 days · Drains to: Canal → Bayou". A first-time "Students are wading to class" notification carries a **Show me** button.

**6.1.9 Counterplay summary.** Build on the ridge; grade; cut canals to the bayou; floodgate the crossing; pump inside rings; raise on pilings; buffer with ponds, cypress and preserves; wall with levees/floodwalls; sandbag before a storm.

**6.1.10 Comedy.** "Pump Station 2 offline. Reason: the pump station flooded." Students in ≥ 0.3 ft pull out inner tubes 15% of the time (+1 mood, "Floatilla on the Quad"). A flooded parking lot with bobbing cars is the screenshot every player takes first.

**6.1.11 Acceptance tests (run headless in `test/hydro.mjs` through `test/domstub.mjs` with the debug cheats, from the §3.3 initial state).**
- T1: a Freshman Dorm on the cove floor (center tile 1.6 ft, lip 2.2 ft), no canal, floods (≥ 0.5 ft) in 40–55% of 2-inch summer cells with `sat` = 0.6.
- T2: the start plot (≥ 5 ft) never exceeds 0.1 ft from any rain event; it floods from surge only at Cat 3+ without a levee. The Dry shoulder (3.5–5.0 ft, crown factor 0.42 rows) floods at Cat 2 (5-ft surge) without a levee.
- T3: a closed levee ring around the cove (§6.2 "Rings", H = 5 ft) with one powered Pump holds every enclosed building below 0.5 ft in Cat 1–2; with zero pumps the cove reaches ≥ 1.5 ft; Cat 3 (8-ft surge) **overtops** an earthen levee on a ≤ 2-ft tile (crest 8; surface ≥ crest): the cove behind it reaches ≥ 0.5 ft even with the pump running; sandbagged (+1.5 ft → crest 9.5) it holds with 1.5 ft of margin and the cove stays < 0.5 ft.
- T4: a 20-tile preserved marsh belt south of a building reduces the overland surge reaching it by 2.2–2.6 ft; the same belt does nothing for a building on the bayou bank.
- T5: total water is conserved to within 1% per step outside boundary tiles and the pond sink term (no leaks, no NaNs).
- T6: a levee tile with 0.3 ft of rain on its crown sheds it to its lower side within 2 calendar days and never passes water from a 0.4-ft neighbor puddle across itself (the crest is in `H` on both sides).
- T7: with a healthy Floodgate (integrity ≥ 50, not jammed) where the tutorial canal crosses the ring, the protection flood-fill at H = 5 ft **stops at the gate** (every cove tile is unreached, so Objective 11 can complete); flagging the same gate jammed makes the fill pass through it and the cove is reached. In the live sim the same gate conducts the cove's rain out to the bayou at stage 0 and stops conducting (k = 0) within one hydro step of the stage crossing 1 ft.
- T8 (Spring High Water, §6.9): with `riverStage` = 3 ft, a Wet bank tile in the Crevasse Reach (2.75 ft) floods, the crown (≥ 5 ft) does not, a Floodgate on a bayou canal closes and stays closed for the window, and `sat` within 6 tiles of the river is ≥ 0.8 by day 5.

### 6.2 Hurricane season

**Rule.** Season Jun 1 – Nov 30, peak Aug 5 – Oct 5. **Year 1: one scripted near-miss (Tropical Storm Amélie, §10.2 Objective 11a) and exactly one hurricane, Célestine, Category 2, scripted** (timing rule in §10.3); Boudin is a ticker-only wave on Aug 1. Years 2+: number of storms 1 / 2 / 3 with probability 45% / 35% / 20%; category weights Cat 1–5 = 35 / 30 / 20 / 10 / 5%, shifting 5 points per year toward severe after Year 3 (Cat 5 capped at 20%); 25% of storms are near-misses (bands only, Cat-1 wind, a **15-s bands pass** instead of the 90-s timeline, no cone: a 3-day watch and the alert strip only). **Landfall dates (Years 2+):** drawn on Jan 1 for the year: each storm's landfall day is uniform in Aug 5 – Oct 5 with probability 70%, otherwise uniform over the rest of Jun 1 – Nov 30; storms are ≥ 15 calendar days apart and never within 6 days of a set piece already scheduled (home game, Mardi Gras, Graduation), with one deliberate exception: the scripted Play-Through-It collision below, whose T−1 bands land on a home date by design; a draw that fails is re-drawn up to 20 times, then dropped. The first unscripted storm after Stadium II exists is timed so its T−1 bands fall on a home-game date, which is when **Play Through It** appears. The **landfall point** is a tile on the south edge (70%) or the east edge south of ty 30 (30%); the track ends there and the surge front enters from it (set piece below).

**Lifecycle (calendar days; the cone appears at T−6, T−9 with the Coastal Institute).**
1. **T−8 Tropical wave** (T−11 with the Coastal Institute, so the wave line still precedes the cone) — ticker only ("A tropical wave off Africa has forecasters mildly interested").
2. **T−6 Named storm** (T−9 with the Coastal Institute; landfall is always cone + 6 calendar days, or cone + 9 with the Institute) — the cone: a translucent purple-red fan from the south edge toward a landfall point on the south/east edge, drawn on the minimap and the world; width shrinks daily (24 tiles → 6; 30% narrower with the Institute); category forecast shown ±1. Newsflash with the name. In Year 1 speed drops to 1× with a "Pause to plan" hint (the player may raise it again; landfall is cone + 6 calendar days at whatever speed is chosen); from Year 2 the cone is a notification plus the alert strip and leaves speed alone. The **Storm panel** opens with all prep actions live immediately, and the **gap detector** (§ "Rings, protection and gaps", run at H = the forecast surge) lists every gap in the ring around the campus core: "Your levee has a 4-tile gap at the cove mouth and 2 weak tiles at (44, 19); the canal crossing at (41, 33) will auto-close."
3. **T−3 Watch** — sky goes greenish-gray, moss streams sideways, gators head for deep water (they know), students walk faster.
4. **T−1 Bands** — a tropical band (4 in), wind 0.5; a scheduled home game on this date offers Postpone or Play Through It (only if the forecast category is ≤ 1).
5. **T0 Landfall** — the 90-second set piece (below).
6. **T+1 … T+30 Recovery** — a band on T+1, then drying; damage report modal with an itemized bill, a **blue-tarp count** (one tarp decal per damaged building; the Founders' Day recap says "{n} blue tarps") and Repair All; debris tiles (flag bit10, walk cost ×2) auto-clear in 5 days or instantly within 14 of a Wildlife Post; **Boil-Water Advisory:** if the Water Tower was flooded (≥ 0.3 ft) or unpowered at any point from landfall to T+1, three days of Dining at −50% and −4 happiness (`boilWater` in §5.6), ticker "Boil-water advisory. Dining Hall boils everything anyway."; counterplay: the tower on Pilings or a Generator within 6; **the Cajun Navy:** after a Cat 3+, if a Wildlife Officer Post exists, volunteer pirogues (4–8 sprites) ferry students out of flooded dorms from T+1, ending the `unsheltered` penalty at T+4 instead of T+10 and adding a ticker line ("The Cajun Navy has arrived. It brought sandwiches."); mosquito bloom from T+3; a gator wave (3–8 extra gators spawn in flooded campus tiles for 10 days); State Disaster Grant at T+20; a makeup home game within 5 days of a postponement is the **Resilience Bowl** (+4 prestige if the stadium reopened in time).

**Prep actions (Storm panel, instant purchases, available from the first cone of the game):** Board Up ($5k per building, wind damage −40%; also covers the Water Tower: topple 30% → 10%). **Boarding is triage, not a button:** crews board **6 buildings per calendar day** (12 with a Wildlife Officer Post), starting the day after purchase, so a 40-building campus at T−6 protects ~36 and at T−9 all of them; the Storm panel's Wind exposure line is a ranked pick-list (default order: Water Tower, Substations, then WR ascending and cost descending) with a checkbox per building and a "Board Up all" that queues the whole list in that order; `data.boardedUntil` is set when the crew reaches the building and the tarp-colored plywood decal appears. Sandbags ($10k per 10 levee tiles, `cost = ceil(n / 10) × $10k` where n is every levee tile on the **protected boundary** at the panel's current test height, §6.2 Rings; writes `sandbag = 15` (+1.5 ft) and `sandbagDay = today + 5` on each of those tiles; the levee inspect panel shows "crest 8.0 ft + 1.5 sandbags, 4 days left"); Repair All (every levee tile to 100 at $5k per tile below 100); Evacuate ($20k per 1,000 students; buses leave over 1 day; happiness −6; nobody is unsheltered); Pre-drain (pumps run at 2× rate and 2× running cost until landfall); Pilings retrofit (1 day, from the inspect panel); Backup Generator placement; and the Play Through It toggle. Nothing in this list takes longer than the warning.

**Landfall set piece (900 ticks of event time, calendar frozen at T0, the speed setting ignored, camera free; not skippable the first time in a save, then a Skip button at t ≥ 15 s (tick 150) jumps to the damage report with every roll and prompt resolved by its default).** Every `t` below is a tick count ÷ 10 from the set piece's first tick. The player has levers during it: **decision toasts** (80-tick countdown, default = do nothing, keyboard `Y`/`N` or `Enter`/`Esc`) fire from the `storm:phase` timeline and reuse existing Storm-panel actions, so each costs a toast and a timeline hook. **At least one toast fires in every landfall:** the shelter toast (t = 30) always fires in Year 1, and in any later landfall in which no other toast qualifies (every qualification is decided at tick 150). Skip resolves any toast still open by its default. **Camera direction:** unless the player has touched the camera since the set piece began, it auto-pans to the entry segment at t = 15 and to the first ring tile the front reaches at t = 35 (the "will it hold" shot); any pan, zoom or click releases it for the rest of the set piece.

| t | Phase | What happens |
|---|---|---|
| 0–15 s | Outer bands | Sky tint to Storm; rain 300 → 900 lines; wind 0.6 → 0.9; moss and trees lean 20°; lightning every 8 s; ticker: evacuation status; audio: wind bed rises |
| 15–35 s | The wall | Rain at full rate; lightning every 3–5 s with white flash and 6-px shake; **surge begins**: the stage ramps 0 → surge(cat) over 20 s; the front is drawn crossing the map at 1 tile per 5 ticks by BFS distance from the **entry segment**: the 8-tile-wide stretch of map edge centered on the landfall point (south edge, or the east edge via the river), over water and land, activating water tiles as sources as it passes; wind pulse 1 at t = 25 (§ wind damage). **Toast 1 at t = 30** if any levee tile on the protected boundary has (integrity < 85%) OR (is unsandbagged AND the forecast surge ≥ its crest − 3 ft): *"Cove levee at {integrity}% — emergency sandbag crew, $50k? (+1.5 ft crest through the peak)"* → applies Sandbags to every boundary tile for the rest of the event. **Shelter toast at t = 30** (Year 1 always; later only when no other toast qualifies; if Toast 1 also qualifies in Year 1 the shelter toast fires at t = 33 instead): *"Founders' gym is full — open the Dining Hall as overflow shelter? (Dining closed 3 days, −$10k)"* → shelter +600 and no `unsheltered` penalty this storm, the Dining Hall's `closedUntil` = T+3; decline (the default) = *"They ride it out in the dorms. Hurricane party."* → `hurricaneParty` +2 happiness for 3 days and +2% attrition this semester |
| 35–45 s | Landfall | Surge peak held; every levee it reaches visibly holds, overtops (sheet particles pouring over the crest) or breaches (tile collapses, gush); wind pulse 2 at t = 38: the **Water Tower roll plays on screen** (sway 2 s, then topple with a crash or hold with a creak) at Cat 4+; a Stadium light mast sparks out (cosmetic); audio roar. **Toast 2 at t = 40** if any Generator is running with ≤ 1 fuel day: *"Generator {n} fuel out — refuel $5k?"* → +3 fuel days; on decline its radius goes dark at t = 42 |
| 45–50 s | Eye (Cat 3+ only) | Rain stops, sky lightens to sickly yellow, wind particles stop; students who leave shelter get caught (mood −5, ticker joke). **Toast 3 at t = 45** if any Floodgate is jammed open (10% per gate at Cat 3+, decided at tick 150 and listed in `storm.jammedGates[]`; a jammed gate counts as open in both the live sim and the protection test until cleared or until the storm passes): *"Send a crew out to clear the jammed floodgate? Risk: the back half catches them (−5 mood, ticker joke)"* → the gate closes at t = 48; the crew (3 officer-style sprites) is caught 50% of the time |
| 50–75 s | Back half | Bands from the south-west; surge recedes 1 tile per 4 ticks; wind pulses 3 and 4 at t = 55 and t = 68 at half strength; trees and azaleas lose leaves; the Water Tower sways |
| 75–90 s | Clearing | Rain tapers; tint to Golden; god-ray effect for 10 s; egrets fly; the damage report slides in (bill, tarps, what held, what overtopped, which toast choices paid off); ticker: "{stormName} has passed. Campus mostly here. Dining Hall serving hurricane gumbo." The pre-storm speed is restored when the report closes |

**Surge heights (feet above the normal 0-ft stage):** Cat 1 3 · Cat 2 5 · Cat 3 8 · Cat 4 12 · Cat 5 16. Overtopping is surface **≥** crest (§6.1.4), so a surge equal to a crest overtops it. Against the map: the start plot (≥ 5 ft) is safe at Cat 1–2; the Dry shoulder (3.5–5 ft) floods at Cat 2; the whole ridge below 8 ft floods at Cat 3 unless leveed; **an earthen levee on a 2-ft tile (crest 8) is overtopped by Cat 3 without sandbags** (8 ≥ 8) and holds with them (9.5); a floodwall on a 3-ft tile (crest 15) holds Cat 4; only floodwalls on high tiles plus pilings plus a preserved belt survive Cat 5. Levees built on the crown itself (7 ft + 6 = 13) hold Cat 4: "build your wall on the highest line you own."

**Wind damage.** Four pulses per storm at ticks 250, 380, 550 and 680, carrying 1/3, 1/3, 1/6 and 1/6 of the storm's total. Per building **per storm**: `dmgTotal = baseDmg[cat] × (6 − WR)/5 × (boardedUp ? 0.6 : 1) × (oakWithin2 ? 0.7 : 1)`, `baseDmg` = 4 / 9 / 16 / 26 / 40% for the whole storm, so a Cat 3 does ~10% to an unboarded WR-3 dorm (~6% boarded) and even a Cat 5 leaves a boarded WR-1 shack standing: water, not wind, is the big bill, and the levee/pump/pilings thesis holds. Cat 3+: each Substation not on pilings has a 40% chance of a 3-day outage regardless of water (20% if Boarded Up; Generators cover); Gator Fences lose 30% of segments; Azaleas are shredded and regrow in 30 days; Live Oaks lose 2% of their number at Cat 4+; cypress never. Cat 4+: Water Tower topple 30%, **10% if Boarded Up or with a Live Oak within 2** ($60k); the roll is decided at t = 15 and *played* in wind pulse 2 (sway, then topple or hold), never reported as a line the player did not see. **The tell before the storm:** the Storm panel's "Wind exposure" line lists every unboarded building with WR ≤ 2, whether the Water Tower is braced (boarded or oak-shaded), and the Substation outage odds, so the first Cat 4 bill contains nothing the player could not have planned for. Buildings at 100% damage become Ruins.

**Power.** A blackout (flooded substation, wind outage, or a Generator running dry) blacks out that substation's coverage: every ⚡ building in it runs at the 50% rule of §4.11 (Dining at 50%, not closed), plus lights off at night (the campus visibly goes dark in patches), pumps stop, research stops and AC is off (heat penalty ×2). Over-capacity is a **brownout** (−5 happiness, research 0), never a blackout. Generators keep their radius 6 lit. Blackout > 3 days: −1 prestige target blight and the ticker.

**Storm names (alternating Cajun/Creole and food; Year 1 uses Célestine because "Amélie and Boudin fizzled in the Gulf": Amélie is the scripted near-miss of Objective 11a and Boudin the Aug 1 ticker wave, so the line is literally true):** Amélie, Boudin, Célestine, Delphine, Étienne, Fifolet, Gaspard, Hébert, Isidore, Josephine, Kingcake, Landry, Mirliton, Narcisse, Odile, Praline, Quenelle, Rémy, Satsuma, Thibodeaux, Ulysse, Violette, Wilhelmina, Xavier, Yvette, Zéphyrine. Ticker: "Hurricane Praline downgraded to 'a mess.'"

**Counterplay.** Levee/floodwall lines with the surge direction in mind (the cove mouth and the bayou banks first; the bayou carries surge into the interior — this is the trap Célestine demonstrates on any campus that leveed the south side but not the bank), floodgates on canal crossings, pumps inside rings, pilings on the substation and dorms, high-WR buildings, shelters, evacuation, the Institute's longer warning, preserved marsh south of campus, cash reserves, insurance.

**Comedy.** Trailers are gone, so the tumbling debris is a lawn chair, a pirogue and a tailgate tent crossing the map on bezier arcs; the Water Tower sways like it is thinking about it; "Athletic Director: 'We've played in worse.' Weather Service: 'You have not.'"

**Rings, protection and gaps (the one definition; `buildings.protection(H)`, `gaps(H)`, `ringClosed(H)`).** Nothing in this document may test "is the levee closed" any other way, because the ridge closes rings by terrain on its own and a naive "levee tiles form a loop" test is wrong on this map.
- **Test height H:** the forecast surge in feet for the storm being inspected (the Storm panel lets the player flip between the forecast category ± 1); **5 ft by default** when no cone exists (the Objective 11 card, the ghost preview and the `P`-less idle Storm panel all use 5 ft), 8 ft for the High and Dry milestone, 12 ft for Fortress Bayou.
- **Effective head of a tile for the test:** `elev + crest × integrityFactor + sandbag / 10` (the static part of §6.1.4's `H`, its `crestTop`), with `crest` counted **in full** for a Floodgate of integrity ≥ 50 (it will be closed when the surge comes) and `crest = 0` only for a gate in `storm.jammedGates[]`.
- **Flood-fill:** 4-connected, seeded from every Open Water tile, every Bayou tile (except Bayou tiles upstream of a closed Surge Barrier) and every map-edge tile; it passes through any tile whose effective head is `≤ H` (a crest equal to the test height is overtopped, matching §6.1.4). Tiles it reaches are **reached**; the rest are **unreached** (the surge cannot get there at that height).
- **Protected building:** none of its footprint tiles is reached. **Campus core:** Founders' Hall plus every building carrying ⚡ in its row (the ones a blackout hurts). **Ring closed at H:** every core building is protected.
- **Gap:** each 4-connected run of reached tiles that are (a) adjacent to an unreached tile and (b) within 12 tiles of any levee/floodwall tile. Reported with its length and centroid, named by the nearest landmark ("cove mouth, 4 tiles"; "south shoulder, 7 tiles at (44, 21)"). **Floodgates** on the boundary are listed as an informational line, "canal crossing at (x, y): will auto-close", never as a gap; a jammed gate is a gap. **Weak tiles:** levee tiles with integrity < 70% on the boundary between reached and unreached are listed as "2 weak tiles at (44, 19)" (they are not gaps yet; at < 50% their halved crest usually makes them one).
- **Where it runs:** the Objective 11 card (live, at 5 ft: "the cove is inside the ring" means every G2 cove tile is unreached), the Objective 12 checklist, the Storm panel gap list at the forecast height, the ghost preview during a levee/floodwall drag (the fill is recomputed on the scratch copy with the dragged tiles added and the card says "closes the ring" / "still 3 tiles short at the south shoulder"), the alert strip's one-line summary, and milestones 6 and 19. Cost: one BFS over 4,096 tiles, cached until any `tile:changed`, `levee:overtop`, `levee:breach` or integrity change.

### 6.3 Gators (comic; never harmful)

**Rule.** Population `6 + floor(waterTiles / 40) + floor(students / 1,000)`, cap 24, always at least 6 (a 5,000-student campus with dumpsters is a bigger target than a 300-student one). **Dens** are Open Water/Bayou tiles with ≥ 2 adjacent Marsh tiles; the population is distributed across dens. Each gator is an agent with states `SUN` (on a bank sprite; 60% of Day), `SWIM` (along the bayou at 2 tiles/s), `WANDER` (onto land at 0.7 tiles/s), `LOUNGE` (parked 30–120 s), `RETREAT`, `WRANGLED`. A wander starts at Dawn/Dusk (×3 in Apr–May mating season) with probability `0.15 × (1 + attraction)` per sky cycle. **Attractors and targets:** at the wander roll the gator lists every *attractor tile* within 12 tiles of its den and its weight: the Dining Hall's **dumpster tile** (the tile at `(tx + w, ty + h − 1)`, just east of the footprint's last row; if that tile is not land or is occupied, the first free land tile 4-adjacent to the footprint scanning clockwise from there; the `dumpster` decal is drawn on it) weight 2 (1 with Gator-Proof Dumpsters), each Greek Row House's porch tile 2, each Parking Lot tile on a game day 6, each Mardi Gras trash tile (the parade route, Feb 8–10) 5, any tile with `depth ≥ 0.3 ft` 4, the Rec Center pool tile 1 on heat-advisory days. `attraction` = the sum of those weights. If the roll succeeds the gator picks its **target** by weighted random among those tiles, or a random bank tile (a land tile adjacent to its den's water) when there are none. **Movement:** gators path with A* on their own **gator grid**: passable = Open Water, Bayou, Marsh, any land tile including paths and roads, and flooded tiles; blocked = building footprints (except Practice Field and Stadium turf and Parking Lots, which are the joke), Gator Fence tiles, and every tile within radius 10 of the Tiger Habitat. `SWIM` at 2 tiles/s on water, `WANDER` at 0.7 tiles/s on land; if no route exists the wander is cancelled. At the target the gator `LOUNGE`s 30–120 s, then `RETREAT`s to its den along the same route (reversed; re-planned if a fence appeared). Flooded ground extends gator range because every ≥ 0.3-ft tile is a weight-4 attractor: a surge is a gator highway, which is why the post-storm wave happens. A den with a Preserve within 10 tiles sends 80% of its wanders into the preserve instead. Draining every marsh tile does not remove gators (dens are water tiles); it removes their alternatives, so campus incursions rise. Two sizes: juvenile (1.5 m, 60%) and big (3–4 m, 40%). One legendary 5-m gator, **Le Grand**, appears once a year (Apr) at the cypress lake for 3 days, announced through the alert-strip gator chip with click-to-pan ("🐊 Le Grand at the cypress lake · 3 days") and ticker line 4, so the player who never looks south-west still finds him; clicking him is +1 prestige ("photographed") and his inspect mood is always "Unbothered."

**Threat.** *Campus* is the tile set within Chebyshev distance 3 of any building footprint tile or any path/road tile (`surface` 1–2), recomputed on `tile:changed` and `building:placed`/`removed`; a gator is "on campus" while its tile is in that set, and this one set drives the alert chip, incident logging, the happiness penalty and Objective 16. A gator on campus: students within 2 tiles `FLEE` (scatter, "!" bubble); it blocks its path tile (agents route around: visible detours); a gator within 2 tiles of a building "gator-closes" it until it leaves; the Rec Center pool ("Gator in the pool! Rec closed for 1 day"); the 50-yard line on game day (kickoff delayed 1 day; the **Sunbather** achievement and its +1 happiness for a season, §5.6, because everyone loves it). Each distinct gator on campus logs one incident per day: `gator` happiness penalty 3 per incident (cap 15). **No bites, no injuries, no settlements, no deaths.**

**Tell.** A V-wake ripple when a gator swims toward the bank; the ticker names the gator ("Beignet spotted near the Dining Hall dumpster. Reviews: four stars, generous portions."); **hover name tags** on every gator, on Le Grand and on Roux (a 1-line gold label, 300 ms hover, also shown for 3 s when the gator enters campus); a **"🐊 Professor Snaps at the Dining Hall" chip in the alert strip** with click-to-pan while any gator is on campus (the comedy is not hidden behind a 40-px sprite); the Wildlife Post's log lists every gator by name; red eye dots at night.

**Counterplay.** Gator Fence (impassable to gators; students pass); Wildlife Officer Post (officer walks to the gator, 3-s wrestle animation with a dust cloud, gator vanishes to the nearest den or preserve; 1 relocation per 20 s per post); Wetland Preserve (absorbs wanders); Tiger Habitat (gators avoid radius 10: Roux is the apex predator, apparently); keep dumpsters fenced (the "Gator-Proof Dumpsters" policy toggle, $5k, halves Dining attraction); keep the campus dry.

**Comedy.** Named gators from the pool (Big Al, Beignet, Marie, Chomp Chomp, Ol' Frontenac, Tabasco, Professor Snaps, Étouffée, Tante Lou, Boudreaux Jr.). "Wildlife Officer relocates Professor Snaps for the fourth time this month. Snaps files appeal." Halloween: gators wear beads.

### 6.4 Mosquitoes

**Rule.** `mosq` per tile 0–1, updated once per calendar day. Sources: **non-Marsh** tiles (Wet, Dry, High, Drained, paved, canal, levee) with `stand ≥ 2` days `+0.12` (`+0.24` if a flooded building); **undisturbed Marsh** `+0.02` baseline only, whatever its standing water (marsh water has predators; this is why the ~1,600 marsh tiles do not saturate the map after every shower); **disturbed Marsh** (within 2 tiles of any building footprint, path, road or boardwalk) `+0.06`; Drained Marsh in its 15-day mud stage `+0.3` once, unconnected canal chains `+0.08`, unstocked Retention Pond (first month) `+0.12`. Diffusion 15% to 4-neighbors. Decay 0.06/day; 0.15/day Dec 11 – Feb 10 (cold snap, "campus throws a parade for the cold snap"); 0.09/day when the heat index > 100 (they burn out, small mercy); −50% on storm days (wind). Sinks: stocked Retention Pond −80% within 4; Bat House −30% within 4 (stacks to −60%); Preserve tiles with a cypress −20%; Abatement fog −70% within 8 at Dusk; Rec Center/Union interiors count as 0 for agents inside.

**Threat.** Campus index = mean `mosq` over agent tiles. Happiness −25 × index. Illness: `sick = students × index × 0.02` per day (Health Center within 12: −60%); sick students skip class, which lowers `classAttendance` and therefore academic quality and research. Index > 0.5: newsflash "Mosquito index: BIBLICAL" and −5 blight while it lasts; applicants −10% at the next lock if it lasted 20 days.

**Tell.** `K` overlay (sKeeters; `M` is mute) with a legend reading Ambient / Annoying / Biblical / State Bird; a gray drifting haze of 1-px dots over tiles ≥ 0.3 at Dusk and Night, dense and audible (whine in the mix) at ≥ 0.6; agents slap themselves at ≥ 0.4; the first warning (index ≥ 0.3, always before Jun 1 in Year 1) pins a **Show me** notification on the worst standing-water tile and pips Pond/Abatement/Bat House.

**Counterplay.** Drain standing water (the cause), stock ponds, connect canals, bat houses (cheap, ecological, the intended answer), abatement (rich and lazy, ecology cost), Health Center, preserves with cypress.

**Comedy.** "Mosquito the size of a Cessna spotted near the Library. Library denies it." "Retention pond stocked with bream. Mosquitoes stocked with regret."

**Acceptance tests (`test/mosquito.mjs`, headless through `test/domstub.mjs`).** M1: with no player action after the tutorial's five placements, the campus index on the start plot stays **< 0.25** through Year 1 spring (Jan 1 – May 5) under the §9.3 weather generator, over 20 seeds. M2: a 3×2 building placed in the cove with no canal reaches index ≥ 0.3 within 15 days of the first 2-inch cell (the first warning fires before Jun 1). M3: one Bat House within 4 of that building brings it below 0.3 within 10 days; a stocked pond within 4 does so within 5.

### 6.5 Subsidence

**Rule.** Every Jan 1: `subs += rate`, `elev −= rate`. Rates per year: Drained Marsh 0.35 under a building (0.25 bare), Wet Ground 0.12 under a building (0.05 bare), Dry 0.02, High 0, Pilings 0, +0.06 inside a Pump radius 8 (dewatering), −50% within 1 of a Bald Cypress, ×0 on Preserve tiles. Levees sink 0.06 ft/yr on Wet/Marsh (their crest follows the tile) unless a Floodwall.

**Threat.** A drained-marsh dorm loses 1 ft in 2.5 years and is below the 2-inch flood line by Year 3; a Wet-ground dorm inside a pump radius loses 1 ft in 5.5 years. Sunk levees stop holding the category they were built for.

**Tell.** A **Sinking!** icon on any building whose tile has dropped 1.0 ft (always available); the `E` overlay's subsidence detail (per-tile rate and "wet ground in N years", with the Coastal Institute); a 2° sprite tilt on buildings that have sunk ≥ 1.5 ft; a yearly ticker line ("Surveyors report the campus has sunk 4 inches since founding. Chancellor: 'It's fine.'"). The Founders' Day recap lists what is sinking.

**Counterplay.** Pilings (retrofit at `+40% × cost × (1 + Building.sunk)`, so the cheap-now dorm costs its own price again by the time it needs saving, and the ghost said so at placement, §3.6; the Wet Feet and Sinking Feeling −25% discounts multiply this), Re-grade from the inspect panel ($15k per tile, +1 ft, 3 days closed), build on the ridge, preserves and cypress, don't over-pump.

**Comedy.** "Boudreaux Hall has technically moved to a lower floor." The **Sinking Feeling** achievement.

### 6.6 Heat and humidity

**Rule.** Daily heat index = month base (Jan 55, Feb 60, Mar 70, Apr 78, May 86, Jun 94, Jul 101, Aug 103, Sep 96, Oct 84, Nov 72, Dec 60) + noise ±6 + 3 if it rained yesterday. Heat advisory ≥ 100 (about 35% of Jul–Aug days); a heat wave is 3+ consecutive advisory days.

**Threat.** On advisory days: `heat` happiness penalty `(index − 92)/2` capped 10, reduced by shade (Live Oak radius 3 −30%, stacking to −90%), Rec Center pool (−50% radius 10), Union/Library interiors; power draw ×1.5 (brownout risk); team rating −8 in Aug–Sep unless a Rec Center is within 10 of the Practice Field; agents walk 0.8× and seek shade; heat illness `students × 0.003` per day (Health Center −50%).

**Tell.** Heat shimmer over roofs and asphalt; students sitting in rings under oaks; the HUD weather chip turns orange; cicadas louder.

**Counterplay.** Live oaks along every path (the cheapest happiness in the game, on purpose), Rec Center, Union, substation capacity, Summer Session off.

**Comedy.** A sno-ball cart spawns at the Union on heat-wave days. "Heat index 103. The quad's live oaks now have a waiting list."

### 6.7 Nutria and other wildlife

**Nutria.** Abstract population `4 + marshTiles / 60`; each month each nutria has a 20% chance to burrow into a random Earthen Levee tile within 10 tiles of Marsh: integrity −15. **Every burrow is visible the day it happens:** one brown burrow-hole decal is stamped on the tile per event (they accumulate, so a ring that went 100 → 55 looks chewed, not new), a ticker line names the tile ("Levee inspection finds a nutria burrow at (44, 19) 'the size of a sophomore'"), the gap detector flags tiles < 70% as *weak* in the Storm panel and on the Objective 11 card, and the levee inspect panel shows "last burrow: Mar 4". Nutria sprites: orange-toothed brown 12 × 6 px, scurrying on levees at Night (cut-list item; the mechanic and the decals stay). Counterplay: Wildlife Officer Post traps (−80% within 14), Floodwalls (immune), the Nutria Bounty toggle, auto-repair ($5k/tile), **Repair All** on the Storm panel. Every decay has a purchasable counter. Comedy: "Nutria have formed a student org. It's a levee-eating club."

**Egrets and herons** stand on ponds, preserves and marsh (density scales with ecology ≥ 40), fly off when a student or gator comes within 2 tiles. **Roseate spoonbills** circle a preserve at Dawn once ecology ≥ 70 (+1 prestige the first time; "the Marketing office cries"). **Fireflies**: ecology ≥ 50 → firefly particles at Night over Marsh/Wet/Preserve, count = `ecology × 6` up to 600 on screen, ×3 over preserves. **Pelicans** on the river; **an armadillo** crosses Highway 1 at Night (ticker gag). **Frogs and cicadas** are audio only.

### 6.8 Ecology score (0–100)
```
ecology = clamp( 70 × (1 − wetlandLost / wetlandTilesOriginal)
               + 0.5 × preserveTiles (cap 20) + 0.3 × cypressCount (cap 10) + 0.3 × oakCount (cap 5)
               + 2 × stockedPonds (cap 6) + 3 × WildlifePost
               − foggerPenalty (0.5/mo per active Abatement, recovers 0.3/mo when off, cap 15)
               − 5 × wastewaterOnMarsh − 0.3 × canalTilesOnMarsh − 0.2 × leveeTilesOnMarsh, 0, 100 )
```
`wetlandLost = 3 × drainedOriginalMarshTiles + (canal + levee + floodwall + pond + gravel-path tiles on original Marsh)`: a drained tile counts three times (itself and the halo it dries out), so 100 drained tiles are ~−13 ecology, while a building on **Pilings**, a Boardwalk, a Fence or the Preserve paint leaves its tile counting as wetland (the marsh is still under it). That is the whole drain-versus-pilings tension in one term: draining is cheaper today, and the ghost of §3.6 shows the retrofit bill that pilings would have avoided. The Coastal Institute halves every negative term's monthly growth.

**Costs of destroying it (< 30):** state funding −15% ("the coastal caucus is watching"), fireflies gone, mosquito growth +50%, surge head loss on remaining marsh halved, no research multiplier, the ticker turns hostile ("Coastal caucus calls BSU 'a parking lot with a football team'"). **Benefits of preserving it (≥ 60):** full surge attenuation, mosquito predators, Coastal research × ecology/50, prestige weight, fireflies and spoonbills, the **Green and Gold** and **Living With Water** achievements, gators that stay home. The design's stance: preserving swamp is not charity; it is cheaper flood defense with a longer payback.

### 6.9 Spring High Water (the Big Muddy, Year 2+)

**Rule.** On Jan 1 of every year from Year 2, `weather.riverStage` for the coming spring is drawn: 1 ft (45%), 2 ft (35%) or 3 ft (20%), +1 ft (cap 3) if the previous Nov–Jan had more than 12 rain days. From **Apr 1 to May 10** the river's boundary stage ramps 0 → `riverStage` over Apr 1–5, holds, and ramps back to 0 over May 6–10; the bayou's stage rises to **0.5 × riverStage** (backwater) on the same schedule. Both are ordinary boundary stages in §6.1.4, so nothing else in hydro changes: the batture column and the Crevasse Reach bank (2.75 ft) flood in a 3-ft year, bank-side levees take **surge contact** (−5 integrity, once per window), a Floodgate on a bayou canal stays **closed** for the whole window in a 3-ft year (bayou stage 1.5 > 1), so spring rain inside a ring needs its pump, and **seepage** sets `sat = max(sat, 0.8)` daily on every land tile within 6 of a river tile. The crown (≥ 5 ft) never floods from it, and Year 1 has no high water (the tutorial year is fixed).

**Threat.** The south-bank expansions (Wet ground below 3.5 ft beside the river) sit under water for ~7 calendar days in a 3-ft year; a canal that drains to the bayou backs up; the ring's pump runs for ten days on the player's dime; the mosquito bloom that follows a wet April is the game's first non-storm swamp pushback in Years 2+.

**Tell.** Ticker on Mar 25 ("The Big Muddy is at {stage} ft and rising. Levee Board 'monitoring.'"); the weather chip shows "River +2 ft" through the window; with the Coastal Institute the stage is shown on Jan 1 in the Founders' Day card and as a blue band on the river in the minimap; the `F` overlay includes the raised stage while the window is open.

**Counterplay.** Levees along the bank (the Crevasse Reach is where they are cheap to need and expensive to build), pumps on bayou canals, pilings on the batture, and, from Year 3 with an Engineering Hall, the **Bonnet Roux Spillway**: a Storm-panel button that appears during a 2- or 3-ft window ($250k, once per year): it lowers the river stage felt by every tile north of ty 40 by 1 ft for the rest of the window and dumps that foot onto the backswamp south of ty 44 (every Marsh/Wet tile there gets `depth += 1.0` on the day it opens; −3 ecology that year, +1 ecology the next: "nutrient pulse"). It is the Fortress path's answer, and the ticker calls it "the Bonnet Carré's little cousin."

**Comedy.** "River at 41 feet. Batture residents describe it as 'seasonal.'" A pirogue is parked on the Highway 1 shoulder for the duration.

---
## 7. Student Life (light)

- **Counts.** `students` is the number that drives economics (up to 20,000+). Visible agents = `min(300, 40 + students / 25)`; each represents `students / agentCount` real students. Plus: one Wildlife Officer per post, 6–24 gators, the fogger truck, 3 buses on game day, the Bayou Brass and crowd sprites in the stadium (batched, not agents). Off-screen agents update at 1/4 rate and skip drawing.
- **Sprite.** 12 × 20 px pixel figure palette-swapped from a base sheet: 6 skin tones, 8 hair styles, shirt 55% purple / 25% gold / 20% white-gray, backpack; props: umbrella (rain), foam finger (game day), beads (Mardi Gras), cap and gown (May 5), inner tube (deep water). 4-frame walk in 4 isometric directions, 2-frame idle, flee, splash, slap, cheer, sit, wave.
- **Stats (0–1 each):** `mood` (blend of campus happiness and personal events, face icon in the inspect panel), `energy` (drains through the Day phase, restored at dorm and by passing a Po'boy Shack), `wet` (rain and flood exposure; wet agents drip and are miserable), `bitten` (mosquito exposure over the current **calendar day**, reset at the day tick; slap animation at ≥ 0.3). Inspect shows name, major, year, mood face, activity ("Fleeing: Professor Snaps") and one quote drawn from the state pool ("Class was underwater again.").
- **Schedule (sky-phase buckets, never clock hours).** *Dawn:* leave dorms, 30% via a Po'boy Shack. *Day:* Class → Dining → Class (each leg ≤ 5 s; class = nearest academic building with seats, weighted by cached route length). *Golden Hour:* idle at Quads, under oaks, the Union, the Rec (heat pushes to shade and pool). *Dusk:* Greek Row, the Union plaza (Zydeco Friday on every 5th calendar day when a Union exists). *Night:* dorms; 15% night owls at the Library and Union. Summer (May 6–Aug 4): 35% of agents present unless Summer Session. Game day and festival days override (§8, §9). Storm: assigned shelters, or buses if evacuated (the campus empties, eerie).
- **Reactions that make the sim legible:** flee a gator within 2 tiles ("!"); wade and slow in 0.3–0.6 ft (splash), avoid ≥ 0.6; slap mosquitoes; wilt in heat (sit under oaks); cheer at scores; throw beads; drift on pirogues near a preserve at Golden Hour (ecology flavor); take selfies at Roux's habitat and the Bell Tower; toss caps at Graduation; huddle at the Union at Dusk on storm watch days.
- **Sampling: the map is the source of truth.** Every tick each agent samples the radius effects at its tile (Union, Rec, Greek, Po'boy, Dining, Habitat, Quad, Oak, Azalea, Pond auras; mosquito density; heat with shade). The per-agent mean over each **calendar day** (10 s at 1×, reset at the `calendar:day` tick) feeds the sampled happiness, mosquito and heat terms (§5.6); "today" for those three terms always means the calendar day, never the sky cycle. A building nobody walks past contributes nothing; a Po'boy Shack on the path between the dorms and the Lecture Hall is worth more than a bigger one behind the stadium.
- **Class attendance.** `classAttendance` = agents that reached a class building during the Day phase ÷ agents assigned, computed **per sky cycle** (the counter resets at Dawn and is read at Dusk; a sky cycle is 3 calendar days, so "today" here means the cycle, not the date). It modulates academic quality by ±10% (§5.5) as the mean of the cycles since the last 1st. A gator or a flood blocking the only path to the Lecture Hall shows up as students milling at the edge of the water before it shows up as a number.
- **Desire lines.** Agents that cut across grass increment the `wear` Uint8 tile array (§3.2; saved, decays 5/day); a tile that crosses 40 in a calendar day renders as worn grass (bit9 `desireWorn`, baked into the chunk) and fires one hint per day: "Students want a path here" with the tiles highlighted and a **Build it ($)** button. Free charm, free tutorial.
- **Pathfinding.** A* on the walk grid (path 1, dry grass 2, wet 3, wading 4, blocked 0, all derived into the `walk` array of §3.2 by `terrain.js` whenever `surface`, type, depth or flags change; bare Marsh blocked, Marsh carrying a Gravel Path or Boardwalk `surface` class 1; flooded ≥ 0.6 blocked; a bare Canal tile blocked, a culvert at its surface's class; Boardwalk and bridge tiles class 1 unless the local surface exceeds normal stage + 2 ft; a bare levee tile class 2; a Fence tile at its ground class (students use the gates); debris (flag bit10) doubles the tile's cost). Routes cached per (from building, to building), invalidated when any tile in the route's bounding box changes; ≤ 8 new A* requests per tick, queued; an agent whose path fails waits at its building and retries next phase (no teleporting on screen; at 4× it simply reads as time-lapse). Gators use their own grid (§6.3); the Officer, fogger truck and buses use the walk grid at 3 tiles/s (officer, fogger) and 5 tiles/s on roads (buses, 3 of them on game day and during an evacuation).

### 7.1 Student Voice cards (the life pillar as a loop)

Once a month, on the 3rd, from the first month after Objective 7 is complete, and only while no interrupt objective is on the card, one **Student Voice** card slides in under the objective card in the Ms. Thibodeaux slot: a named student from the §14.1 generator, with a major, asks for one concrete build with a stated payoff (≤ 12 words plus the payoff line). **Accept** turns it into a background objective (a one-line progress row with a 30-day deadline) that pays the listed payoff on completion; **Decline** is free and the card goes back in the deck. Twelve cards, each offered at most once per save, drawn in table order from the ones whose prerequisite is met; the deck is `progress.voiceCards[]` (`{id, state: unseen | active | done | declined, offeredDay}`) in the save. Every payoff is visible on screen (the student and their friends do the thing), and a happiness payoff is always the `studentVoice` timer row of §5.6, never a hidden term.

| id | Prerequisite | Card (student, major: ask) | Payoff on completion |
|---|---|---|---|
| `boardwalk` | a Preserve, or ≥ 20 Marsh tiles within 12 of campus | Marguerite "Sha" Guidry, Wetland Ecology: a 6-tile Boardwalk into the marsh and I bring 20 friends | applicants +40 at the next lock; 6 agents idle on the boardwalk at Golden Hour |
| `recPool` | Practice Field, Rec Center unlocked | Jaylen Batiste, Kinesiology: a Rec Center within 10 of the field or the starters practice in the heat | team rating +2 for the season, on top of the heat fix |
| `zydeco` | Student Union | Odette Fontenot, Music (Accordion Performance): Zydeco Friday needs the plaza lit: 4 Live Oaks within 3 of the Union | `studentVoice` +2 happiness for a month; the zydeco motif plays every 5th Dusk |
| `poboyRoute` | ≥ 2 Dorms and a Lecture Hall | Trey Landry, Hospitality (Gumbo Track): a Po'boy Shack on the path between the dorms and the Lecture Hall | +$3k/mo on that shack (it is on the route) |
| `quadOak` | 300 students | Cécile Broussard, Cajun French: a Quad Lawn with an oak we can sit under, within 6 of Founders' | `studentVoice` +2 for a month; a study-circle sprite under the oak at Golden Hour |
| `batHouse` | first mosquito warning | Jules "Skeeter" Robichaux, Marine Biology: three Bat Houses by the water, not the fogger | ecology +1; any Abatement Station's fogger penalty is waived for one month |
| `parking` | 600 students | Kaitlyn Melancon, Mass Comm: a Parking Lot within 4 of the road; the walk from Highway 1 is a podcast | the `noParking` timer cleared and +$2k/mo tickets |
| `healthShade` | Health Center | Darius Metoyer, Nursing: Live Oaks on every path tile within 6 of the Health Center | heat illness −20% campus-wide that summer |
| `greekPorch` | Greek Row House unlocked, Bayou Field | Beau "T-Boy" Thibodeaux, Political Science (Pre-Governor): a Greek Row House within 8 of the field for the tailgate | tailgate revenue +25% that season |
| `cypressLine` | ecology < 60 and ≥ 10 levee tiles | Solange Ancelet, Coastal Engineering: 10 Bald Cypress within 1 of the levee: roots hold the wall | levee subsidence ×0 on those tiles; ecology +2 |
| `lookout` | a Preserve | Achille Prejean, Wildlife Management: a Boardwalk to the lookout tower; I'll count the spoonbills | +1 prestige when spoonbills next circle |
| `bellSelfie` | Bell Tower | Tiana Vidrine, Sports Management: a Quad Lawn at the foot of the Bell Tower for the selfies | applicants +60 at the next lock |

---

## 8. Sports (light)

- **Requires** a Practice Field (400 students) for a team; without home seating the team plays an away-only "club" schedule (results in the ticker, $20k per game, football score capped at 20). **Bayou Field** (the bleachers tier of the Practice Field, $600k at 400 students, 6,000 seats, day games only) enables home games in Year 1; **Red Stick Stadium** (Stadium I, $2M at 600 students, 15,000 seats) and **The Cauldron** (Stadium II, $8M at 1,500, night games) are the upgrades, and home games always play in the largest venue that exists.
- **Season calendar (7 games + bowl).** Aug 8 **H** opener · Sep 3 A · Sep 8 **H** · Oct 3 A · Oct 8 **H Homecoming** (bonfire on the quad the night before) · Nov 3 A · Nov 8 **H The Golden Pirogue vs Magnolia State** (always at home: "Magnolia State declines to host. Cites humidity.") · Dec 8 **Sugar Cane Bowl** at a neutral site if ≥ 5 wins (+$1.5M and +5 prestige if won, +$500k if lost). Four home games a year; the scripted Year-1 storm lands on Sep 8 and postpones that game for anyone who built Bayou Field by then (most players: it is affordable by June, §5.7).
- **Team rating (0–100).** `20 + 5·PracticeField + coaching(budget/$100k, max 30) + recruiting(prestige/4, max 25) + morale(happiness/10, max 10) + 3·Roux − 8·(Aug–Sep heat without a Rec Center within 10 of the field) + coach(4 × (stars − 2): −4…+12) + starters((mean starter rating − 75)/5: −3…+5)`. Nothing in the rating is hidden; every term is a line in the Season panel's rating breakdown.
- **The coach (named, visible, hireable).** The team always has a **named head coach** drawn from the §14.1 coach table with a visible **1–5 star** rating shown on the Season panel and in the ticker ("Coach Cheramie declines to comment on the loss"). The Practice Field comes with **Coach Bobby Cheramie, 2★**, for free. In any offseason (Dec 9 – Aug 7) the Season panel offers three candidates (stars drawn 1–5 weighted toward prestige/20 + 1); signing one requires a coaching budget of at least `$300k × stars` per year (the slider must be there first) and a signing fee of `$100k × stars`; firing the current coach costs a **buyout of $500k** (waived after three straight rivalry losses: "the boosters pay"). Stars drift: +1 after a bowl win or an undefeated season (cap 5), −1 after two straight losing seasons (floor 1).
- **Starters (three named players a season).** At the fall lock the team generates **three named starters** (QB, RB or WR, LB; §14.1 names, a hometown from the §14.1 table, a rating 60–99 drawn around `55 + prestige/2 + 5 × stars`, capped 99). They appear on the Season panel with position, hometown and rating, the ticker recaps name them ("QB Beau Thibodeaux, 4 TDs; Magnolia State 'had questions'"), and their mean drives the `starters` term. Seniors graduate: each starter has a 40% chance to leave on May 5 and be re-drawn.
- **The recruiting card (fall lock, when a Stadium exists).** One card per year at Aug 5, e.g. *"5-star QB from Houma wants in: fund $200k NIL, or have a Greek Row House within 8 of the Stadium"*; the price is drawn from {$200k NIL fund, a Greek Row House within 8, a Rec Center, a Residence Tower} and the prize is a 95-rated starter at a named position next season (+4 rating from the `starters` term) plus a ticker arc. Decline = nothing. The Board of Regents' Recruiting Trip card (§5.9) is separate and gives +3 flat.
- **Opponents (all fictional; fixed rating ± 8 season noise; 7 drawn each year from 9, the rival always).** Magnolia State University "Magnolias" 78 (arch-rival, green and white), Crescent City University "Pelicans" 70, Delta A&M "Catfish" 62, Gulf Coast Tech "Shrimpers" 58, Atchafalaya Polytechnic "Bullfrogs" 55, Pineywoods State "Loggers" 52, Sabine River Baptist "Prophets" 45, Vermilion College "Cranes" 40, Red Stick College "Ferrymen" 35 (crosstown; talks a big game, affectionately).
- **Win probability.** `P = 1 / (1 + 10^((opp − team − home)/25))`; `home` = 6 for a day game, 14 for a night game (Stadium II+, automatic for Homecoming and the rivalry, a toggle otherwise); Stadium III applies opponent −5. Team 50 vs Magnolia 78 at home by day: 12%. Team 78 vs Magnolia 78 in the Cauldron: **78% at night, 63% by day** ((78 − 78 − 14)/25 → 10^−0.56; (78 − 78 − 6)/25 → 10^−0.24). The player feels the stadium matter, and the Season panel prints the number next to the word: "Underdog · 12%", "Even · 52%", "Favored · 78%", so a long chase like Objective 18 is legible rather than a bug.
- **Attendance and revenue.** `fanbase = students × 2.5 + alumni × 0.6 + prestige × 300`; `hype = 0.7 + 0.4 × winPct(last 4) + 0.3 (rivalry or homecoming) + 0.15 (night) − 0.1 (rain)`; `attendance = min(seats, fanbase × hype)`; revenue = `attendance × (ticket + $12)` with ticket tiers $25 / $35 / $60 (attendance ×1.15 / ×1.0 / ×0.85), plus tailgate `$3 × attendance × (1 + 0.5 per Greek Row within 8, cap +2)` under Paid permits (Free permits: $0 and +3 happiness). At 690 students and prestige 16 the fanbase is ~6,500, so the 6,000-seat Bayou Field sells out (~$300k a game) while a 15,000-seat Red Stick Stadium would be 43% full and lose money on upkeep: stadium timing is a real "am I ready?" decision. A sold-out Cauldron night game is ~$2.6M; a sold-out Cauldron Grand ~$5.8M, about a tenth of tuition at that size.
- **Home game set piece (750 ticks of event time; calendar frozen; Skip to final after Q1; the whole set piece is skippable at 0 s from the second home game of the save onward).** 0–20 s Golden Hour tailgate: tents, smokers with smoke particles, cornhole, a pirogue as a cooler, 40 extra fan sprites, 3 buses on the road, the zydeco motif; gator attraction +6 on the lots. 20 s kickoff at Dusk: whistle, crowd shader fills to attendance %, masts on. 20–60 s four quarters of 10 s at Night: score bug in the HUD, each score = crowd pulse, brass sting, 150-ms shake (home) or groan (away). **Halftime decision at t = 40 s** (80-tick toast, default Play safe; Skip-to-final still routes through it, so the choice is always the player's). The toast shows the half score, the live win chance and the rule in words: *"Down 14–7 · Favored 38% · Go for it: second half ±8 rating (underdogs like it) · −2 spirit if it fails"*. **Go for it** draws `swing = ± uniform(0, 8)` (sign 50/50, shown on the score bug as "Coach {name} is going for it, +5"), recomputes `P₂ = winProb` with `team + swing`, and re-decides the winner with the **same** kickoff roll `r` (home wins if `r < P₂`): the dice do not move, the threshold does, which is a fair swing an underdog wants and a favorite does not; a loss after going for it adds the `goForIt` −2 timer (§5.6). **Play safe** keeps `P₂ = P`. 60–70 s final: fireworks on a win, ticker recap naming a starter, revenue toast, spirit adjustment. 70–75 s exit stream to Greek Row and the Union. Rain: ponchos, −10% attendance. A hurricane whose landfall is within 1 day postpones; the makeup within 5 days is the Resilience Bowl. **Auto-sim home games** (Season panel toggle, off by default, offered after the first home game): later home games play as a **5-s score-bug montage** (crowd fill, four score ticks, the halftime toast compressed to 3 s, final, fireworks) with the calendar frozen for those 5 s only; the previous speed is restored afterward.
- **Score model (one generator for every game, on screen or off).** At kickoff roll `r ∈ [0, 1)`; the home side is the decided winner if `r < P`. Each quarter each side scores `k ∈ {0, 3, 7, 10}` with weights `[0.45 − 0.25 s, 0.20, 0.25 + 0.15 s, 0.10 + 0.10 s]`, where `s` is that side's strength (`P` for home, `1 − P` for away; `P₂` and `1 − P₂` after halftime). After Q4, if the score contradicts the decided winner or is tied, the winner gets one more scoring play, 7 if it trails by more than 3 and 3 otherwise, shown as a walk-off ("{name} from 41 yards. Bells."). The score bug, the four quarter ticks, the final (ticker lines 43/44) and the recap (line 60) all read from this generator. **Starter stat line:** for the QB/RB/WR starter named in the recap, `yards = 60 + 9 × homePoints` and `TDs = floor(0.6 × homePoints / 7)`; for the LB, `tackles = 6 + floor(awayPoints / 3)`. Club and away games run the generator off-screen in one tick.
- **Play Through It.** Offered when a home date falls on a storm's T−1 bands with forecast category ≤ 1: the game runs inside the rain bands (rain 900 lines, lightning, moss sideways, the crowd in ponchos), −10 happiness, gators guaranteed at the tailgates, +3 prestige "legend" and the **Night Falls on the Cauldron** frame in its storm variant if you win. The first Stadium II night game is always the scripted clear-sky version (§10.4) so the guaranteed frame never depends on weather luck.
- **Rivalry.** Beating Magnolia State: +6 spirit for 7 calendar days, +3 prestige, donations ×1.3 for the month, the **Geaux Beat Magnolia** achievement. Three straight rivalry losses: "Fire the coach" newsflash; the $500k buyout is waived ("the boosters pay") and the three-candidate hire card opens immediately, in season.
- **Decisions (the "few").** Coaching budget slider; hire/fire the coach in the offseason; the fall-lock recruiting card; the halftime Go-for-it toast; ticket tier; night-game toggle; Auto-sim home games; stadium upgrade timing; Homecoming budget card; tailgate permit policy (default Paid); Play Through It; schedule the makeup game before repairs finish (revenue and morale vs. a half-open stadium: attendance ×(1 − damage%)).
- **The band.** The marching band is **the Bayou Brass**: 24 batched sprites (12 × 20 px, purple with gold plumes) that march the halftime field at t = 40 s, lead the Mardi Gras parade, and play the Coastal Resilience pump in (§10.7). Its name appears in the ticker and the Almanac; the brass sting is its sound.

---

## 9. Time and Calendar

### 9.1 The two clocks
- **Calendar clock:** 10-day months, 120-day year, 1 day = 10 s at 1× (§0.1). Drives economy, enrollment, weather events, hurricanes, festivals, construction, subsidence, autosave.
- **Sky clock:** a 30-s cycle at 1× (3 calendar days): Dawn 2.5 s (peach tint) → Day 13 s → Golden Hour 2 s → Dusk 2.5 s (purple) → Night 10 s (deep indigo, lights on). Drives lighting, agent schedule buckets, gator wanders, fireflies, mosquito haze, stadium masts, bell tower bells (midday and Dusk). Player-facing time is a date plus a sky glyph ("Sep 3, Y1 · Fall · 🌙"); there are no clock hours anywhere in the UI.
- **Event time:** set pieces freeze the calendar, run exactly 10 ticks per real second whatever the speed setting says (the setting is remembered and restored afterward), and script the sky (a game day forces Golden → Dusk → Night across its 750 ticks; landfall forces the Storm tint). Every set-piece timestamp in this document is a tick count from the set piece's first tick (t = 30 s → tick 300); `BSU.headless.tick(n)` advances a set piece exactly as the browser loop does, with no timers involved. At 2× and 4× both clocks scale; set pieces do not.

### 9.2 Academic and civic calendar (Year 1 dates; real time at 1×)

| Date | Event | 1× |
|---|---|---|
| Jan 1 | New Year; subsidence tick; Founders' Day recap card (Year 2+) | 0:20 (the calendar starts with the first path) |
| Jan 5 | Spring semester; tuition installment 1 (the founding cohort) | 1:00 |
| Jan 10 | **Spring lock** (25% of the gap; the first Dorm, done at ~1:25, counts); first pirogue return | 1:50 |
| 5th of every month (Feb–Jul, Sep–Dec) | **Rolling admissions round** (20% of the gap, §5.4): pirogues arrive | every 100 s from 2:40 |
| Feb 6–8 | **Mardi Gras** (parade set piece on Feb 8 at Dusk: 25 s, interactive, §14.3) | 2:50–3:10 |
| Feb 9 | **The first gator** (Objective 9): guaranteed at the first Dusk on or after Feb 9, drawn by the Mardi Gras trash tiles to the dumpster | ~3:15 |
| Mar 1 – Apr 10 | Crawfish season; azaleas bloom; **Crawfish Boil** Apr 5 with the **scripted wet-spring cell** (3 in, centered on the cove, over `sat` forced to ≥ 0.7 on cove tiles the day before): it tops the lip, so a second Dorm in the cove floods once before June and the Wet Feet card fires early | 3:40–6:50 |
| Mar 5 | Tuition installment 2 | 4:20 |
| Apr | Gator mating season (wanders ×3); Le Grand appears (alert chip, §6.3) | 5:20–6:50 |
| Apr 1 – May 10 (Year 2+) | **Spring High Water** on the Big Muddy (§6.9); ticker on Mar 25 | 5:20–7:50 |
| May 5 | **Graduation** (15 s set piece; 22% → alumni from Year 2); semester-end attrition | 7:40 |
| May 6 – Aug 4 | Summer: construction −15%, heat, afternoon cells, 35% of agents present | |
| Jun 1 | **Hurricane season opens** (banner; Objective 11 "Hold the line") | 8:40 |
| Jul 1 | State funding | 10:20 |
| Jul 2 (or the first day after Objective 11 completes, Jul 20 at the latest) | **Tropical Storm Amélie** (Objective 11a): a scripted near-miss, bands only, 15-s pass, no cone; the new ring visibly fills and drains | 10:30 |
| Aug 1 | "Boudin" tropical wave, ticker only ("Boudin fizzled in the Gulf") | 12:00 |
| Aug 5 | Fall semester; **fall enrollment lock** (fills the gap: the big wave, buses and pirogues); tuition installment 1; the recruiting card if a Stadium exists | 12:40 |
| Aug 8 | Football opener (home at Bayou Field if built by then; otherwise a club game in the ticker) | 13:10 |
| Sep 2 | Célestine's cone appears (subject to the §10.3 rule) | 13:50 |
| Sep 8 | **Célestine landfall** (90-s set piece); the Sep 8 home game is postponed | 14:50 |
| Oct 5 | Tuition installment 2 | 16:00 |
| Oct 7–8 | Homecoming (bonfire on a Quad Lawn the night before, home game) | 16:20 |
| Nov 8 | The Golden Pirogue vs Magnolia State | 18:10 |
| Nov | Cypress turn orange; hurricane season closes Nov 30 | |
| Dec 1–10 | Finals (agents at the Library); Dec 8 bowl; Dec 10 semester-end attrition | 18:40–20:10 |
| Dec 9 | **Levee Bonfires** (bonfire sprites on every levee run at Night; +2 happiness per 10 levee tiles, cap +10) | 20:00 |

At 1× the Year-1 hurricane lands at minute 15; at 2× the §10.3 rule holds the cone until minute 9 so landfall is at minute 9.5–10 (cone + 6 days at 2× = 30 s, or 60 s if the player leaves the auto-dropped 1× in place); at sustained 4× the hold pushes the cone into Year 2's June and landfall to minute ~9.3; at mixed speeds a year is 8–12 minutes. Amélie is calendar-triggered, so it lands between minutes 6 and 10.5 depending on speed.

### 9.3 Seasons and weather generator
- **Rain-day probability by month:** Jan 30%, Feb 30%, Mar 35%, Apr 35%, May 40%, Jun 55%, Jul 55%, Aug 50%, Sep 40%, Oct 25%, Nov 25%, Dec 30%. Winter/spring rain days are Showers (70%) or Frontal (30%); Apr–Sep rain days are Thunderstorm cells (drifting NE, spawned at a random south-west position so the rain visibly arrives from a direction) with 10% lightning; the Coastal Institute marks tomorrow's cell on the minimap.
- **Fog:** 40% of Nov–Feb Dawns, 2 s of fog. **Wind:** 0–0.3 normally, 0.6+ in storms; drives moss, flags, leaves.
- **Seasons:** Spring (Mar–May: azaleas, saturated greens, river high), Summer (Jun–Aug: heat shimmer, cells, fireflies), Fall (Sep–Nov: clear gold light, orange cypress, football, storms through Nov 30), Winter (Dec–Feb: desaturated, fog, no mosquitoes, Mardi Gras).

### 9.4 Speed controls and rules
- Space pause; `1` `2` `3` = 1× 2× 4×; the HUD buttons. Building and painting are allowed while paused (the tutorial says so once).
- The game auto-drops to 1× when the **Year-1** cone appears (the player may raise it again at once; landfall is cone + 6 calendar days at whatever speed is chosen), when a set piece starts (the set piece itself runs in event time), and on the first gator or mosquito warning; a first-warning drop lasts 10 s (100 ticks) or until its notification is dismissed, whichever is first. From Year 2 a cone is a notification plus the alert strip and does not touch speed.
- **The previous speed is restored** when any set piece, the Year-1 cone hold or a first-warning drop ends: the game never leaves a 4× player silently at 1×.
- Every set piece is skippable after its first instance in the save (§0.1); near-miss storms are a 15-s bands pass; the Season panel's Auto-sim toggle turns home games into a 5-s montage. Budget from Year 2 at sustained 4× (a 5-minute year): 4 montages (20 s) + 1–3 storms × (0 s cone + 90 s landfall, or 15 s near-miss, all skippable) + Mardi Gras and Graduation (skippable) ≈ 1–2 minutes of watching per 5-minute year, all of it optional after Year 1.
- Autosave on the 1st of each calendar month (after the economy step) and on `visibilitychange`; 3 rotating autosave slots, 3 manual slots, Continue on the title screen.

---
## 10. Onboarding and Progression

### 10.1 The first two minutes (by doing; every card ≤ 12 words; the game runs at 1× from the first path)

| Time | Beat | What the player does | What the game does |
|---|---|---|---|
| 0:00 | **Title** | Sees a live animated swamp (cypress silhouettes, moss, fireflies, a drifting pirogue, dusk on the bayou). One prompt: **"Click to charter the university."** Continue if a save exists; a seed field; a mute toggle. | The title world is a real generated map at Night. |
| 0:03 | **Charter** | Click. | Camera swoops 4 s from the Gulf edge up the bayou to the ridge (skippable). Parchment card: *"$4,000,000, one ridge, and a swamp. Build a university. Geaux."* Auto-dismisses in 3 s. Time paused. |
| 0:08 | **Objective 1 — Place Founders' Hall** | The Founders' Hall ghost is **already on the cursor**, gold, snapping to the start plot; cove tiles flash red "too wet" if the cursor drifts. Click. | Dust puff, columns rise (3-frame build over 0.6 s), a bell chime, "+2 landmark" floater. The **HUD fades in stat by stat** with a 100-ms stagger: Cash, Students, Prestige, Happiness, Ecology, Date. |
| 0:20 | **Objective 2 — Drag a path to the Pirogue Landing** | Path tool auto-selected; the landing pulses gold on the bayou; the card shows a 6-s looping drag animation. Drag; release. The drag's start snaps to a tile adjacent to Founders' Hall (the card says "from the front door"), so the path is connected from its first tile. | Path lays tile by tile (60 ms each, soft tick); **time starts at 1×**. The path necessarily crosses the cove (G3) and ends on the Marsh shoulder beside the landing. |
| 0:35 | **The arrival** | Watch. | Three pirogues glide in along the bayou (4-s spline), each unloading tiny students who walk up the path to Founders' Hall waving; the Students counter rolls to 120; ticker: *"First 120 students arrive at Bayou State. One asks where the parking is."* The ambience has been playing since the charter click (§13); a "🔊 on · M to mute" hint appears once. |
| 0:45 | **Objective 3 — Build a Dorm and a Dining Hall** | The palette appears for the first time with a single **Essentials** tab (Path, Freshman Dorm, Dining Hall, Lecture Hall, Po'boy Shack, Quad Lawn, Live Oak). Ridge tiles glow green; cove tiles yellow "Wet ground, sinks; +20%". Place both. | Dorm: agents walk into it at Night. Dining: boil-pot smoke starts. The **Applicants / Capacity** chip appears: "Applicants 700 / Capacity 345" (the ⚡/💧 penalty is suppressed until Objective 5, §4.11, so the number is what it says). Completing the objective pays one $50k "Legislature approves" toast (one per objective, ten in all, §10.2). |
| 1:15 | **The cell** | Watch, then act. | A scripted 3-inch thunderstorm cell (§6.1.2) drifts in from the south-west over the cove (visible rain blob, lightning once). The path across the cove pools to 0.4 ft: students wade, splash and slow. Notification: **"Students are wading to class." [Show me]** → the Flood Risk overlay opens, the pooled tiles glow, and the **Swamp** tab appears with a gold NEW pip. **Objective 4 — Dig a canal from the low spot to the bayou** (route ≤ 8 tiles, G4). On completion the water drains over 5 s with a whoosh; toast **Cajun Engineer**. |
| 1:50 | **Objective 5 — Keep the lights on: a Substation and a Water Tower** | The **Utilities** tab appears with a pip. Place both (the ghost shows Dry/High/Wet costs; the choice is the player's; the Substation needs path adjacency only, never a Road). On most maps the crown is now nearly full: the Substation ghost's second line reads **"Ridge full — nearest flat 2×2 is 4.6 ft: floods at Cat 2"** (§3.6), so the cascade Célestine demonstrates is real for most first plays; a player who squeezes it onto the crown has earned that. | Windows light at Night for the first time; the ⚡/💧 penalty of §4.11 switches on when this objective completes. |
| 2:00 | **Free play** | The remaining tabs appear (all start-available items are now visible; NEW pips mark them). The objective card continues, non-blocking. | The player has placed five things, seen students arrive, seen rain, drained it, and lit the campus. They have never read more than twelve words at once. The crown has room for at most one more 3×2 (G1), so the next objective forces the game's real question. |

Every beat has an on-screen cause; nothing is narrated that the sim can show.

### 10.2 The guided objective chain (one card; **Show me** on every card; every objective has an exact reward)

**Scheduling rule (so `progress.js` can be written).** Every objective is either an **interrupt** or a **background** objective.
- **Interrupt** objectives (1–7, 9–14, 16) take the card the moment they trigger. If an interrupt is already on the card, the new one queues **FIFO** (`progress.interruptQueue`) and takes the card when the current one completes or is dismissed. A "watch" interrupt (7's parade, 11a, 13) auto-completes when its set piece or pass ends.
- **Background** objectives (8, 15, 17, 18a, 18b, 18, 19–22) never take the card while an interrupt is active: they are shown as a **one-line progress row under the card** ("Reach 500 students · 328 / 500 · by Aug 5"); when no interrupt is active the background objective moves up onto the card. At most one background objective is active; others queue FIFO by trigger order.
- Dismissing an objective (the ✕ on the card) skips it without reward; it can be re-opened from the Milestones panel. Completion pays the reward in the table, fires `objective:complete`, and the next queued objective is offered on the next tick, never in the same frame (so two toasts never overlap).
- Rewards: **$50k "Legislature approves"** for Objectives 1–7, 9, 10 and 11 (ten grants, $500k, the figure in §5.2); **+2 prestige** for every other objective (an instant bump, §5.5).

| # | Objective | Trigger | Kind | Reward | Teaches / unlocks |
|---|---|---|---|---|---|
| 1–5 | The first two minutes (§10.1) | Scripted | Interrupt | $50k each | Place, path, house, feed, drain, light |
| 6 | **Plant 5 Live Oaks along a path** | Obj 5 complete | Interrupt | $50k | Shade is life; oaks are the cheapest happiness |
| 7 | **Lay a 10-tile Campus Road: the parade route** (the Krewe of Roux needs a road; Highway 1's stub is 7 tiles) | Obj 6 complete (~2:10) | Interrupt; on Feb 8 the card becomes "watch the parade" with a **Postcard** button | $50k | Roads and their −1 to adjacent dorms; festivals; the Postcard; the parade is the reward for an action, not a wait |
| 8 | **Reach 500 students by the fall lock** (needs a second Dorm and a Lecture Hall: beds ≥ 435 and seats ≥ 358, §5.4) | Obj 7 complete | Background | +2 prestige | Beds are the bottleneck; **the ridge is full** (G1): the second Dorm goes in the cove (floods in rain), on the 3.5–5 ft shoulder (floods at Cat 2) or on Pilings over marsh (+40%). This is the cove-or-pilings choice, made before Célestine so the storm tests something the player paid for; Practice Field, Bayou Field and Health Center unlock at 400. **If Aug 5 passes short**, the card becomes "Capped at {students} — beds are the bottleneck" with a Show me on the empty crown and the Pilings tooltip, its deadline text becomes "by Jan 10", and it completes whenever 500 is reached; it never vanishes silently |
| 9 | **Something in the water** — fence the water edge near the Dining Hall or place a Wildlife Officer Post | First gator on campus: guaranteed at the first Dusk on or after Feb 9 (~3:15 at 1×), drawn by the Mardi Gras trash tiles to the dumpster ("the gators have noticed the trash") | Interrupt | $50k | Gator counterplay; Fence and Post pips; the gator chip in the alert strip |
| 10 | **Standing water** — get the campus mosquito index below 0.3 | First mosquito warning (guaranteed before Jun 1; §6.4 M2) | Interrupt | $50k | Pond / Abatement / Bat House pips; `K` overlay |
| 11 | **Hold the line** — levee from ≥ 5-ft ground around the cove and its shoulder back to ≥ 5-ft ground until **every cove tile is unreached at H = 5 ft** (§6.2 Rings; the tutorial canal's crossing becomes a Floodgate, which counts as closed in that test), and place a Pump Station inside the ring touching a canal | Jun 1 banner (minute 8–9 at 1×) | Interrupt | $50k | A 2-panel illustration: water inside a levee needs a pump; the gap detector runs live on the card ("still 3 tiles short at the south shoulder"); 8–16 levee tiles |
| 11a | **Amélie** — watch: Tropical Storm Amélie's bands fill the new ring and the pump drains it | Jul 2, or the first day after Obj 11 completes, Jul 20 at the latest (~10:30 at 1×) | Interrupt (watch; a 15-s bands pass, 4 in of rain, wind 0.5, no cone, no set piece, `dtDay` = 1/60) | +2 prestige | The ring works, or the gap shows; "Amélie fizzled in the Gulf" becomes true; if Obj 11 was dismissed, the cove simply floods and the card says so |
| 12 | **Cone of concern** — checklist with a 6-day timer: Substation on Pilings or a Generator · ring closed at the forecast height (no gaps, no weak tiles) · a Floodgate present on every canal crossing of the ring (it auto-closes at stage > 1 ft; the tutorial canal already has one) · **Shelter or evacuate everyone** (ticks when shelter ≥ students, counting Founders' emergency 600 and ridge dorms, or when Evacuate is purchased) · Board Up | Célestine's cone | Interrupt | +2 prestige | The Storm panel; every prep action; the substation cascade explained in one line each; nothing on the checklist is impossible in Year 1 |
| 13 | **Landfall** — no action; watch (decision toasts inside it, at least one guaranteed, §6.2) | Sep 8 (§10.3) | Interrupt (watch) | +2 prestige ("Campus mostly here") | Consequence: the cove floods unless leveed; the shoulder floods at 5 ft; an unprotected substation below 5 ft goes dark and the pump stops; the crown holds |
| 14 | **Repair all storm damage** | T+1 | Interrupt | +2 prestige; **Storm Chaser** if damage < 20% | Repair UI, tarps, Disaster Grant, Boil-Water Advisory if the tower went under |
| 15 | **Geaux Bayou** — build a Practice Field, add the Bayou Field bleachers; play the first home game | 400 students (~6:00 at 1×; affordable by June) | Background | +2 prestige | Football in Year 1; the Season panel; Coach Cheramie and the first three starters; the Aug 8 opener is a real home game |
| 16 | **Preserve it** — paint 20 tiles of Wetland Preserve south of campus | First gator on campus after Obj 9, or ecology < 75 | Interrupt | +2 prestige | Ecology as flood defense; fireflies that Night (the sky is scripted clear) |
| 17 | **Reach 1,500 students; build a Wastewater Plant** | 1,000 students | Background | +2 prestige | The wastewater brake |
| 18a | **Win four games in a season** | Bayou Field | Background | +2 prestige | The rating breakdown; coaching budget; "Underdog 12%" is a number, not a bug |
| 18b | **Make the Sugar Cane Bowl** (≥ 5 wins) | Obj 18a complete | Background | +2 prestige | The bowl; hire a better coach in the offseason |
| 18 | **Beat Magnolia State** | Obj 18b complete | Background | +2 prestige (plus the achievement's +3) | Rivalry; the recruiting card; a five-year chase that is legible all the way |
| 19 | **Reach prestige 30; build the Bell Tower** | 2,000 students | Background | +2 prestige | Landmarks |
| 20 | **Night Falls on the Cauldron** — upgrade to Stadium II; the first night game | 1,500 students | Background | +2 prestige | The screenshot moment, scripted clear (§10.4) |
| 21 | **Choose your bayou** — build the Bayou Surge Barrier *or* the Marsh Restoration Program (either completes it) | 5,000 students | Background | +2 prestige | Fortress vs Living With Water, each with a capstone that changes the surge; a Fortress player is never handed an ecology target they are designed to fail |
| 22 | **Flagship** — 10,000 students, prestige 60 | Obj 21 complete | Background | +2 prestige | Hands off to the Milestones panel with the ticker's blessing |

When the chain ends, or whenever the player dismisses it, the objective card becomes the **Milestones panel**: the three nearest un-earned milestones with progress bars, re-sorted daily.

### 10.3 The Year-1 hurricane (scripted set piece)
- **Célestine, Category 2 at landfall (forecast "Cat 2 ± 1"), surge 5 ft, 8 in of rain, four wind pulses.** Landfall point fixed on the south edge below the cove's longitude, so the cove mouth and the bayou bank are tested and the front enters through the bayou.
- **Timing rule:** the cone appears on the first calendar day ≥ Sep 2 such that (a) `playSeconds` since the charter ≥ 540 (9 minutes; wall-clock in a browser, 0.1 s per tick in headless mode, §15.2) and (b) Objective 11 has been offered (its Jun 1 trigger has fired, whether it is on the card or in the interrupt queue). If Oct 5 arrives before both hold, the cone is **held** (the calendar keeps running; hurricane season may close; Year 2 may begin) and appears on the **next calendar day after both conditions hold**, whatever the date, with the ticker explaining an off-season storm as "the Gulf did not check the calendar"; Year 2's random storms are suppressed until Célestine has passed. Landfall is cone + 6 calendar days at whatever speed the player chooses (the cone drops speed to 1×; raising it is allowed; the Institute's cone + 9 cannot apply in Year 1). At 1× the cone appears Sep 2 (~13:50) and landfall Sep 8 (~14:50); at sustained 2× the hold releases the cone at minute 9 and landfall follows 30 s later (60 s if the player leaves the auto-dropped 1× alone); at sustained 4× the hold releases at minute 9 in Year 2's June and landfall follows 15 s later. **The storm is never earlier than minute 9 at any speed** and, at 1× or mixed speeds, never later than minute 17: always inside the first 20 minutes.
- **Tuned outcome:** the crown (≥ 5 ft) stays dry; the Dry shoulder (3.5–5 ft) floods 0.5–1.5 ft, so a second Dorm or Lecture Hall placed there is *flooded* and takes the visible 2%/day damage of §6.1.6 until it dries (typically 3–5 days: a $40–80k repair and a lesson); the cove (1.6–2.5 ft) floods to 2.5+ ft without a levee, **≥ 1.5 ft with a levee and no pump**, < 0.5 ft with a levee and one powered pump; a Substation below 5 ft without pilings blacks out and the pump stops (the cascade); the path and any Parking Lot in the cove flood; a Water Tower on the shoulder triggers the Boil-Water Advisory. The lesson is delivered by consequence; the damage bill is $150k–$400k; the Sep 8 home game (if Bayou Field exists) is postponed to the Resilience Bowl.
- **The promise:** no pre-placed building can be destroyed by Célestine, and nothing the tutorial *nudged* the player to place (Objectives 1–5 on the crown) is below the surge line. What the player chose to put in the cove or on the shoulder for Objective 8 is exactly what the storm tests, and it is damaged, never destroyed (Cat 2 water never reaches the 25%/day tier on this map).

### 10.4 The scripted screenshot
The first Sep or Oct home game after Stadium II completes is the scripted clear night game (any earlier home game after completion, e.g. a Nov 8 or Aug 8 date, plays normally, by day or by night per the toggle): the night-game flag is forced on and the weather scheduler suppresses rain and cells for that calendar day; the sky script runs Golden → Dusk → Night; fireflies are forced to the ecology-50 count minimum; the camera offers a one-time "Frame it" button that pulls back to the §1 composition; the **Postcard** button pulses. The achievement **Night Falls on the Cauldron** fires at kickoff.

### 10.5 Milestones and achievements (24, plus 2 legacy goals)

| # | Name | Condition | Reward |
|---|---|---|---|
| 1 | **Chartered** | Place Founders' Hall | — |
| 2 | **Welcome to the Bayou** | The first 120 students arrive | — |
| 3 | **Cajun Engineer** | A canal reaches the bayou | $50k |
| 4 | **First Bell** | 600 students | +2 prestige |
| 5 | **Wet Feet** | First flooded building (a consolation card with the three fixes) | Pilings −25% for that building |
| 6 | **High and Dry** | Ring closed at H = 8 ft (§6.2 Rings: every core building unreached, no gaps) with ≥ 1 powered Pump Station inside the unreached region | +2 prestige |
| 7 | **Storm Chaser** | Survive a hurricane with < 20% damage | $100k |
| 8 | **Eye of the Storm** | Survive Cat 4+ with zero flooded buildings | +5 prestige |
| 9 | **Gator Wrangler** | 10 relocations | Wildlife Post upkeep halved |
| 10 | **Sunbather** | A gator on the 50-yard line on game day | +1 happiness for a season |
| 11 | **Skeeter Beater** | Campus mosquito index < 0.1 through August | +2 prestige |
| 12 | **Bayou Field** | First home game | — |
| 13 | **Night Falls on the Cauldron** | First Stadium II night game | Permanent gold light ring on the stadium sprite |
| 14 | **Geaux Beat Magnolia** | Beat the rival | +3 prestige |
| 15 | **Undefeated** | 7–0 regular season | +5 prestige, donations ×1.5 for a year |
| 16 | **The Big Boil** | A Crawfish Boil with ≥ 3,000 attendance, where `attendance = (students × 0.6 + alumni × 0.1) × (Union ? 1.5 : 1)` (ticker line 11 prints it) | +3 happiness for a month |
| 17 | **Throw Me Somethin'** | Mardi Gras with the Union and happiness ≥ 75 | $50k merch |
| 18 | **Green and Gold** | Ecology ≥ 70 with ≥ 3,000 students | Research +10% |
| 19 | **Fortress Bayou** | Ring closed at H = 12 ft (§6.2 Rings) whose boundary wall tiles (levee/floodwall tiles on the reached/unreached edge) include ≥ 40 floodwalls | +3 prestige (exclusive with 20 in the same year: the first of the two earned in a calendar year wins, the other is re-tested on the next Jan 1); unlocks the **Bayou Surge Barrier** (row 41) |
| 20 | **Living With Water** | Ecology ≥ 75 with ≥ 2,000 students and ≤ 10 floodwall tiles | +3 prestige (exclusive with 19); unlocks the **Marsh Restoration Program** (row 42) |
| 21 | **Lights Are On** | Build the Bell Tower | — |
| 22 | **Sinking Feeling** | A building drops 1 ft (warning achievement) | Pilings −25% for a year |
| 23 | **Rebuilt from the Roux** | Reach prestige 50 after a bankruptcy card | +$500k donation |
| 24 | **Flagship** | 10,000 students and prestige 60 | Title screen shows the player's campus |
| L1 | **Laissez les Bons Temps Rouler** | 20,000 students, prestige 85, ecology ≥ 50 | The "you won" that isn't an ending |
| L2 | **Untouched** | Reach Flagship without draining a single marsh tile | — |

### 10.6 Unlock progression
- **By students:** 400 Practice Field, Bayou Field bleachers, Health Center · 600 Stadium I (Red Stick Stadium), Union, Greek Row · 800 Library, Rec Center · 1,000 Wastewater, Tiger Habitat (and prestige 20) · 1,200 Coastal Institute (and ecology 40) · 1,500 Engineering, Residence Tower, Stadium II · 2,000 Floodwall (or Engineering), Bell Tower (and prestige 30) · 8,000 Stadium III (and prestige 50).
- **By event (pips, not gates):** Swamp tab at the 1:15 cell; Fence and Wildlife Post at the first gator; Pond, Abatement and Bat House at the first mosquito warning; Levee, Pump and the Floodgate rule at Jun 1. Every swamp tool is purchasable from 2:00.
- **By milestone (the only true late gates):** Bayou Surge Barrier (row 41) by **Fortress Bayou**; Marsh Restoration Program (row 42) by **Living With Water**; Spoonbill Rookery (row 43) by a completed Restoration; the Endowment and the Second Campus charter (§10.8) by Year 5 and 5,000 students.
- **Cadence rule:** something new appears in the palette every 3–5 minutes for the first 40 minutes. Tabs appear only when they contain an unlocked item; a gold NEW pip is the only fanfare; locked items are visible, greyed, with the condition ("Reach 800 students"), so the catalog is the roadmap.

### 10.7 Failure states (soft, recoverable, never a game over)
- **Bankruptcy** — cash below −$2M for 3 consecutive months → "The Board has concerns" card with three choices: **Austerity** (upkeep −30% and happiness −10 for a year; no construction for a month) · **Emergency Tuition Hike** (+$3,000/semester, applicants −40% for a year) · **Sell Naming Rights** (a random hall becomes **Boudreaux Petroleum Hall**, +$1M, −3 prestige; the ticker never forgets). Rejecting all three keeps the loan accruing; after 60 more days the state names a receiver: the Chancellor watches for one year (**autopilot**: the game runs at 4× with construction and the palette disabled, auto-repair on, every card and toast auto-dismissed by its default, set pieces auto-skipped; a Skip Year button ends it) and returns at $0 with −20 prestige. **Rebuilt from the Roux** waits on the far side.
- **Campus underwater** — > 50% of buildings flooded for 15 days → "Semester Cancelled": no tuition installment that semester, attrition ×2, prestige −15, somber ticker; the Governor's **Coastal Resilience Grant** ($3M earmarked for §4.8 items) arrives with the card, and a free Pump Station is delivered to a ridge tile ("the marching band plays it in"). The game teaches the fix at the moment of failure.
- **Accreditation** — prestige < 5 for a year, or seats < students/2 for two semesters → Probation: applicants ×0.5 until prestige > 15, an "Accreditation Task Force" objective chain (Library, seat ratio, no flooded buildings for 30 days), and the ticker cites "the catfish in the library."
- Students never fall below 60; Founders' Hall never falls.

### 10.8 Endgame and sandbox
No win screen. **Founders' Day** (Jan 1) shows a recap card (enrollment chart, storms survived and their categories, blue tarps, ecology, football record with the coach's name and stars, what is sinking, best ticker line of the year) with a Postcard button. After Flagship: storm odds escalate, the "Century Storm" (Cat 5 during a home-game week) rolls at 5%/yr after Year 8, opponents scale +3/yr, and the two legacy goals remain.

**Where the money goes after Year 5** (income ~$72M against ~$33M operating at 5,000 students, and every core row is unlocked by 2,000 students, so the late game needs sinks that are also systems):
- **Capstones (rows 41–43).** The **Bayou Surge Barrier** ($6M, Fortress path) closes the bayou to surge and moves the fight overland, where marsh attenuation and the Crevasse Reach matter; it needs two powered pumps and costs 10 ecology. The **Marsh Restoration Program** ($4M, Living With Water path) hands up to 40 drained or low tiles back to the swamp for up to +15 ecology and the Spoonbill Rookery. Either completes **Objective 21**, so a Fortress player is not handed an objective they are designed to fail.
- **The Endowment** (Budget panel, Year 5+): move cash into the Endowment in $1M steps; it is irreversible and yields 0.4% per month (§5.2) forever, shown as its own income line and a gold "Endowed" chip on the top bar. At $50M it out-earns Stadium II.
- **The Second Campus** (Budget panel, Year 5+, $20M): requires a Road bridge across the bayou and ≥ 12 buildings west of it; charters them as **BSU West** with its own auto-name, applicants ×1.25, landmark +10, a second Founders'-style hall placed free on a chenier, and a second Highway 1 stub from the west edge. It is the Stadium-III-scale sink that makes the cheniers, the bridge and the surge on the far side of the bayou the Year-6+ puzzle.
- A Year-10 campus is a real infrastructure puzzle: a 16-ft surge into 15,000 students on both sides of the bayou, a barrier that must close in time, thirty pumps that all need power, and a marsh belt that either still attenuates or does not.

---
## 11. UI / UX

The HUD is DOM (fast to author, crisp text, accessible); the world is Canvas 2D. Reference layout 1280 × 800; scales to any aspect at ≥ 1024 px wide; the palette collapses to icons-only below 1180 px.

### 11.1 Main screen
```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ▣ BAYOU STATE  $4.12M ▲  👥 690 (Apps 880 / Cap 690)  ★ 16  ☺ 62  🌿 81   Sep 3, Y1 · Fall · 🌙 │  top bar 44 px
│ ⏸ [1×] 2× 4×   ☀ 96° · Rain tmrw   [Budget] [Season] [Storm ●] [Almanac] [≡] [🔇]                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ⚠ HURRICANE CÉLESTINE · CAT 2 · LANDFALL IN 6 DAYS · levee gap at the cove mouth   [Prepare]      │  alert strip (only during a watch/emergency)
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                        ┌────────────┐            │
│                                                                        │  MINIMAP   │            │
│                    ( isometric world )                                 │  ◢ cone ◣  │            │
│                                                                        └────────────┘            │
│  ┌ OBJECTIVE ─────────────────────────┐                                [F][W][K][P][C][E] overlays │
│  │ Hold the line                      │                                                            │
│  │ Close the cove mouth with a Levee. │              ┌ INSPECT ────────────────────┐              │
│  │ ▓▓▓▓▓░░░░ 6 / 9   [Show me]        │              │ Boudreaux Hall · Freshman Dorm│              │
│  └────────────────────────────────────┘              │ ...                          │              │
│  ┌ ⚠ Students are wading to class  [Show me] ┐       └──────────────────────────────┘              │
│  └───────────────────────────────────────────┘  notifications (max 3, 12 s)                       │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ≡ NEWS: Facilities crew reports a gator sunning on the culvert. Crew reports it back. · Tropical … │  ticker 24 px
├──────────────────────────────────────────────────────────────────────────────────┤
│ [Essentials][Paths][Utilities][Academic][Housing][Dining][Sports][Life][Swamp ●][Grounds]  🔨 ⓘ    │  palette tabs
│ ▢ Path $2k   ▢ Freshman Dorm $700k   ▢ Dining Hall $500k   ▢ Lecture Hall $600k   ▢ Po'boy $60k  … │  items 72 px
└──────────────────────────────────────────────────────────────────────────────────┘
```
- **Top bar.** Cash with a green/red delta flash and a rolling odometer; Students with the Applicants/Capacity chip after Objective 3; Prestige; Happiness; Ecology; date with the sky glyph; weather chip; speed buttons; panel buttons; mute. **Every stat is click-to-breakdown**: a popover in plain words with the top three contributors ("Happiness 62: +8 dining coverage, +6 Union, −6 mosquitoes. Next: −4 no parking"). No formulas in tooltips.
- **Alert strip** appears only during a hurricane watch, mosquito emergency, heat wave, blackout, flood, boil-water advisory or a **gator on campus** ("🐊 Professor Snaps at the Dining Hall", click-to-pan), with one action button.
- **Objective card** (bottom-left): portrait of Ms. Thibodeaux, Chief of Staff (48 × 48 procedural: purple blazer, gold earrings, reading glasses on a chain), ≤ 12 words, progress, **Show me** (camera pans and flashes the target). The card shows the current **interrupt** objective; the current **background** objective (§10.2) sits under it as a one-line progress row ("Reach 500 students · 328 / 500 · Aug 5"). When no interrupt is active the background objective takes the card. **When the card is idle for 8 s, the last ticker line surfaces as a speech bubble from the portrait** for 6 s, so the game's voice is on the player's side of the screen, not only in the 24-px strip. After the chain, the **Milestones panel** (three nearest, progress bars).
- **Notifications** stack (max 3, newest at the bottom, 12 s), each with one action; color-coded: blue water, green wildlife, gold money/sports, purple events, red danger.
- **Ticker**: one scrolling line at 60 px/s; clicking a line pans to its subject; a click on the ≡ opens the last 30 lines. Rule: no three calendar days without a line.
- **Minimap** 160 × 160: terrain colors, buildings as dots, water depth blue, the cone, tomorrow's cell (with the Institute), the viewport rectangle; click to jump, drag to pan.
- **Overlay buttons** under the minimap; keys `F` Flood Risk (predicted feet), `W` Water (current feet), `K` Mosquito (sKeeters: Ambient/Annoying/Biblical/State Bird; `M` is mute), `P` Power and water coverage (unpowered and unwatered buildings pulse red with their ⚡/💧 icon), `C` Coverage (dining radius and happiness auras), `E` Ecology and subsidence (feet sunk; rate with the Institute). One at a time; a legend chip appears bottom-right; overlays fade in over 150 ms.

### 11.2 Palette
- Ten tabs: **Essentials** (Path, Freshman Dorm, Dining Hall, Lecture Hall, Po'boy Shack, Quad Lawn, Live Oak; a permanent quick tab), Paths, Utilities, Academic, Housing, Dining, Sports, Life, Swamp, Grounds (landscaping + landmarks). Tabs appear only when they contain an unlocked item and have been introduced (§10.1); a gold **NEW** pip marks a tab with something new since the player last opened it.
- Items are 64 × 64 icons of the actual sprite with the name and cost; hover after 300 ms → tooltip: footprint, upkeep, effects in words, unlock, and a *why* line ("Pilings: the marsh keeps the marsh, you keep the building"). Locked items are greyed with their condition.
- **Ghost preview**: footprint tiles tinted green (ok) / yellow (needs grading or pilings; shows both options) / red (blocked, with the one-line reason: "Needs a path", "Too wet: drain it or add Pilings", "Needs a Road within 4"); a label with the terrain-adjusted cost; a coverage ring for radius buildings; a running length and total for drag tools; during a Levee/Floodwall drag the protection flood-fill (§6.2 Rings, at H = 5 ft, or the forecast surge when a cone exists) is re-run on a scratch copy with the dragged tiles added and the label says "closes the ring" or "still 3 tiles short at the south shoulder"; the "Ridge full" second line of §3.6 when no ≥ 5-ft site remains.
- Drag tools: Path, Road, Boardwalk, Levee, Floodwall, Canal, Fence, and the Preserve paint. Shift+click = straight line. Shift held after placement keeps the tool. Right-click or Esc cancels. `R` rotates 3×2 / 4×3 footprints. Bulldoze 🔨 / `X`.
- **Undo**: `Ctrl/Cmd+Z` undoes the last placement within 5 s with a full refund.

### 11.3 Inspect panel (slides in from the right, 300 px)
```
┌ BOUDREAUX HALL · Freshman Dorm ──────────── ✕ ┐
│ [sprite]   Beds 300 / 300      Quality ★★☆☆   │
│ Ground: Wet 2.1 ft   Water 0.0 ft   Sat 70%   │
│ Sinking: 0.18 ft/yr · dropped 0.4 ft so far   │
│ Wind rating ▮▮▮░░   Damage 0%   Shelter —     │
│ Power ✓  Water ✓  Path ✓  Dining ✓ (The Roux) │
│ Flood risk: 0.6 ft after 2 in of rain  ⚠      │
│ Mood sample: "The AC works. That's the bar."  │
│ [Rename] [Pilings +$280k] [Repair] [Demolish] │
└───────────────────────────────────────────────┘
```
- **Tile:** type, elevation ft, water ft, saturation, standing days, mosquito, subsidence, wetland-original flag, "drains to", and "what can be built here."
- **Levee tile:** crest ft ("8.0 ft + 1.5 sandbags, 4 days left"), integrity % with the weak (< 70%) / halved (< 50%) state in words, burrow count and last burrow date, whether the tile is on the protected boundary at the current test height, Repair. Levee runs ≥ 20 tiles carry their auto-name ("The Great Wall of Boudreaux", stored in `state.runNames["levee:" + lowestTileIndexOfTheRun]`, since drag tiles have no Building struct; recomputed on `tile:changed`).
- **Agent:** name, major, year, mood face, activity, one quote; a **Follow** button locks the camera.
- **Gator:** name, length, mood ("Unbothered", "Peckish", "Sunning"), home den, current target ("headed for: the Dining Hall dumpster"), last seen. **Roux:** mood and a yawn count. Gators, Le Grand and Roux also carry hover name tags in the world (§6.3 Tell), so the panel is the second click, not the first.
- **Coach / starter (from the Season panel):** name, stars or rating, hometown, seasons at BSU, one quote.
- **Storm (click the cone):** name, category ± 1, ETA, forecast surge in feet, the gap list.

### 11.4 Storm panel (opens from the alert strip or `T` when a cone exists)
```
┌ HURRICANE CÉLESTINE · Cat 2 (±1) · landfall in 6 days · surge 5 ft  [test at: Cat 1 | Cat 2 | Cat 3] ┐
│ Cone map   │ Ring at 5 ft: 1 gap (cove mouth, 4 tiles) · 2 weak tiles (44, 19) · crossing (41, 33) closes │
│  ◢ ◣       │ Reached buildings: Substation (4.6 ft) ⚠, Parking Lot (1.9 ft)                             │
│            │ Wind exposure: 2 unboarded buildings WR ≤ 2 · Water Tower unbraced · Substation outage 40% │
│            │ Shelter 900 / 690 students ✓  (Founders' 600 in emergency + Fontenot Hall 300 on the crown)  │
│ [Board Up all $35k · 6/day] [Sandbags $10k] [Repair All $15k] [Evacuate $14k] [Pre-drain] [Play Through It] │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
The ring line, the reached-building list and the wind line are the three things a player can act on before landfall; each is computed by one function (`buildings.gaps(H)`, `buildings.protection(H)`, the wind roll odds) and nothing in the damage report may surprise a player who read this panel.

### 11.5 Budget panel (`B`)
```
┌ BUDGET · September Y1 ───────────────────────────────────────────────┐
│ INCOME (last month)     │ EXPENSES (last month)     │ RUNWAY          │
│ Tuition       2,242,000 │ Staff salaries    310,500 │ 3 months to      │
│ Parking           4,000 │ Upkeep             41,700 │ Oct 5 payday  ●  │
│ Po'boy            2,000 │ Utilities          12,300 │                  │
│ Total         2,248,000 │ Total             364,500 │ NET  +1,883,500  │
│ Tuition  [──────o──────] $6,500 / sem   Applicants next lock ≈ 880    │
│ Faculty  ( Basic | Good | Elite )   Selectivity ( Open | Selective | Elite ) │
│ Coaching [o──────────] $0/yr    Ticket ( $25 | $35 | $60 )   Auto-repair ☑   │
│ Loan: $0 of $2.0M line    Insurance: none                              │
└────────────────────────────────────────────────────────────────────────┘
```
The tuition slider previews applicants live. Runway turns red when projected monthly costs exhaust cash before the next installment.

### 11.6 Other panels and screens
- **Season** (`N`): schedule with W/L, next opponent rating vs yours in words and a number ("Underdog · 12%"), the rating breakdown (every term of §8, none hidden), **Coach {name} ★★☆☆☆** with Hire/Fire in the offseason, the three named starters with position, hometown and rating, night-game toggle, tailgate permits (default Paid), **Auto-sim home games** toggle, Homecoming budget, upgrade button, live score bug during a game.
- **Almanac**: achievements, year-by-year sparklines (students, cash, prestige, happiness, ecology), storm log, gator log, the Founders' Day recap cards, **Postcard** button.
- **Title**: live world at Night behind a gold serif title; Click to charter; Continue; seed field; Settings (audio toggle and volume, particles Low/High, screen shake, colorblind overlay palette, keybind sheet).
- **Founders' Day recap** (Jan 1): a card with five sparklines, "what flooded, who won, what's sinking", the best ticker line of the year, Postcard.
- **Postcard** (`Almanac`, `Ctrl/Cmd+P`, and the card buttons): renders the current view to a 1600 × 1000 PNG via `canvas.toDataURL` with the BSU wordmark, the date and an optional caption, offered as a download link (works on `file://`).

### 11.7 Camera and input
- **Pan:** two-finger trackpad scroll (primary; `wheel` deltas pan, `preventDefault` on the canvas), WASD/arrows, middle- or right-drag, edge scroll off by default. Left-drag on empty ground pans once the pointer moves > 4 px (so a click is a click). **Zoom:** pinch / `Ctrl+wheel` / `-` `=`, snapped to 0.5×, 1×, 2× (`Q`/`E` are not bound; `E` is the Ecology overlay). Camera eases (lerp 0.15) and clamps to the map with a 200-px margin. No rotation.
- **Placement:** click; drag for linear tools; Shift for straight lines and tool-hold; `R` rotate; Esc/right-click cancel.
- **Touch (nice-to-have):** one-finger pan, pinch zoom, tap to inspect, tap-tap to place, palette targets ≥ 44 px.
- The input state machine lives in `ui.js` (idle / panning / placing / dragging / inspecting) and is the only thing that translates pointer events; Safari `gesturestart/gesturechange` is handled for pinch.

### 11.8 Keyboard shortcuts
`Space` pause · `1` `2` `3` speeds (and nothing else) · `B` Budget · `N` Season · `T` Storm · `L` Milestones/Almanac · `F` `W` `K` `P` `C` `E` overlays (Flood, Water, sKeeters, Power, Coverage, Ecology) · `-` `=` zoom out/in · `Tab` cycle palette tabs · `Shift+1–9` pick the nth item in the open tab · `X` bulldoze · `R` rotate · `H` home (Founders' Hall) · `.` follow a random student · `Esc` cancel/close · `Ctrl/Cmd+S` save · `Ctrl/Cmd+Z` undo · `Ctrl/Cmd+P` postcard · `M` mute (the 0:35 hint depends on it) · `Y`/`N` (also `Enter`/`Esc`) answer an open decision toast · `~` debug panel. **No key is bound twice** (`M` is mute only, `E` is Ecology only, `Q` is unbound, the bare digits are speeds only). **Precedence** for the keys that can still mean two things: an open decision toast captures `Y`/`N`/`Enter`/`Esc` first; then a focused text field (rename, seed) takes every key; then the world. `ui.js` calls `preventDefault()` on `Tab`, `Space`, the arrows and `Ctrl/Cmd+S/P/Z` whenever the canvas or a palette item has focus, so the browser never scrolls, moves focus or opens its own dialogs.

### 11.9 Debug panel (`~`, hidden, no achievements while open)
Sliders for every key in `BSU.params` (hydro rates, surge heights, economy constants, prestige weights, mosquito rates, gator population) with live apply; cheats: **Skip to date**, **+$1M**, **Spawn Cat N** (cone now, landfall 600 ticks later: the same code path as `BSU.headless.forceHurricane`), **Rain 2 in now** (cell at the cursor), **Set ecology / prestige / happiness**, **Spawn gator here**, **Fill dorms**, **Trigger home game**, **Spawn near-miss**, **Test ring at H** (paints reached/unreached tiles and prints the gap list at a chosen height), **Fire every decision toast**, **Time-lapse 20×**, **Show hydro numbers on tiles**, **Perf HUD** (frame ms, draw calls, particles, agents, active hydro set). Every acceptance test in this document is reachable from this panel in under a minute.

---

## 12. Visual Style

### 12.1 Projection and layers
- Isometric 2:1, 64 × 32 px diamonds, 6 px per foot of elevation, integer zoom scaling with `imageSmoothingEnabled = false`. The **sprite atlas** exists at 1× and 2× (0.5× draws the 1× atlas at half size); **terrain chunks are baked at 1× only** and drawn through a 2× transform (pixel-doubled) at 2× zoom, never re-baked per zoom, so canvas memory does not scale with zoom.
- Draw order per frame: (1) visible terrain chunks (≤ 20 `drawImage`), (2) water tiles, (3) depth-sorted entities (buildings, trees, agents, gators, vehicles, particles that sit in-world) by `tx + ty` then elevation, (4) weather particles in screen space, (5) tint pass, (6) additive lights pass, (7) fog, (8) overlays, (9) DOM HUD.
- **Terrain chunks:** 8 × 8 tiles → 64 chunk canvases of 512 × ~400 px at 1× (~0.8 MB each, ~50 MB total worst case). **Total live canvas memory is capped at 64 MB** (chunks + atlases + the lights/tint/fog canvases + the postcard canvas, which is created for the export and released): Safari blanks or kills a page whose canvas backing stores exceed its per-page budget (roughly 200–300 MB, lower on iOS), which is why chunks never bake at 2×. A chunk is re-baked only when a tile in it changes (type, elevation, path, canal, levee, decoration). Cliff side faces are drawn where a tile is ≥ 1 ft above its south or east neighbor. Reeds, knees, palmettos and worn desire lines are baked into chunks.
- **Water:** every visible tile with a water flag, and every visible **non-Marsh** tile with `depth ≥ 0.05`, is a translucent diamond drawn per frame with two scrolling 1-px sine highlight lines and a day sparkle; at Night it reflects nearby lights as a gold vertical smear. **Marsh standing water** (the generated 0.15–0.40 ft, §3.3) is baked into the chunk as a reeds-over-dark-water tint, so the ~1,640 marsh tiles cost nothing per frame; a Marsh tile draws a live diamond only while its depth is ≥ 0.5 ft (surge), and the chunk is re-baked when it crosses that line in either direction. **At 0.5× zoom** (~2,000 visible tiles) the per-frame highlight lines are skipped and a static highlight is baked into the chunk's water layer instead; the diamonds themselves still draw per frame so depth changes stay live. Depth tints from `#6FA895` (shallow) to `#1B3A3A` (deep). Bayou tiles carry a slow current line; surge water is darker and carries debris flecks.

### 12.2 Palette (hex; defined once in `contract.js`)
- **Purple:** `#461D7C` (BSU purple), `#5E2CA5`, `#7F5BC5` (highlights), `#2B1246` (shadows), `#1A1230` (UI panel).
- **Gold:** `#FDD023` (BSU gold), `#F5B700`, `#FFE680` (highlight), `#B58500` (shadow), `#FFF1A8` (window glow).
- **Swamp:** water `#1B3A3A` night / `#2E6B5E` day / `#6FA895` shallows; marsh reed `#8A9A4B`; mud `#4A3B2A`; wet ground `#5A6B3A`; dry grass `#6E8F3C`; high ground `#7FA347`; cypress `#3F5E3A` / autumn `#C7692B`; oak canopy `#3B5A2A`; moss `#9BAA8A`; bark `#3A2A1E`; gravel `#C9B47C`; asphalt `#3A3A40`; boardwalk `#8B7355`; azalea `#E75480`; cream stone `#F5ECD7`.
- **Sky tints** (full-screen multiply, alpha in brackets): Dawn `#F7B58A` [0.25], Day none, Golden `#FFCB6B` [0.20], Dusk `#6B3F8F` [0.35], Night `#0E1230` [0.62], Storm `#2A3140` [0.50], Fog `#C9CFD1` layered [0.30]. Hurricane approach desaturates the palette 30% via the tint pass.
- **UI:** panel `#1A1230` at 92% with a 1-px gold border, text `#F4EEE2`, accent gold, danger `#E0443E`, good `#3FBF7F`, water-blue `#4FA3D6`.

### 12.3 Sprites and the one painter
- **Buildings** come from `paintBuilding(row, variant, frame)`: an isometric box (`w × h` footprint × `floors × 14 px`) with three-tone face shading from `row.paint.wall`, a roof from the roof library (flat with parapet, gable, hip, dome, barrel, bowl), a window grid (`cols × rows`, 2 × 3 px, randomly lit at Night from a seeded pattern, drawn again into the lights atlas), 1–2 decals from the shared decal library, a 1-px darker outline, gold trim on purple faces. Variants: normal, night (emissive windows), damaged (tarp decal + darker), pilings (+10 px lift, posts), scaffold (construction), ruin. 43 rows × ~5 variants ≈ 215 small canvases built at load in ~160 ms.
- **Trees:** trunk + 3–5 canopy blobs with dithered edges; Live Oak moss strands (6–10) are drawn per frame as sinusoidal lines driven by wind at 1× and 2×; **at 0.5× trees are drawn from the atlas only** (a baked moss frame, no per-frame strands, no sway); 3 growth stages; cypress knees as 2–4 px nubs on the water line.
- **Agents:** 12 × 20 px, palette-swapped from one base sheet (4 directions × 4 walk frames + idle, flee, splash, slap, cheer, sit, wave); 6 skin × 8 hair × 3 shirt = cached on demand.
- **Gators:** 40 × 12 px, 3 frames (swim, walk, sun), red eye dots on the lights pass at Night; Le Grand is 56 px. **Roux:** 28 × 16 px, pacing and yawn. **Officer:** khaki 12 × 20 with a pole. **Vehicles:** fogger truck 20 × 10 with a fog ribbon, buses 24 × 12 purple, pirogues 22 × 8 with a paddler.
- **Everything else that is referenced anywhere in this document** (all procedural, all in the atlas; px are at zoom 1):

| Sprite | Size | Frames | Where it appears |
|---|---|---|---|
| Ms. Thibodeaux portrait | 48 × 48 | 2 (neutral, speaking) | Objective card, speech bubble; purple blazer, gold earrings, glasses on a chain |
| Mardi Gras float | 32 × 16 | 2 (roll) | Parade: 1 float, or 3 with a Union; purple/green/gold, bead-throw particles |
| Marching band (the Bayou Brass) | 12 × 20 each, batched 24 | 4 (march) | Parade, halftime, the pump-in |
| Walking krewe | 12 × 20 each, batched 12 | 4 | Parade fallback when no float can roll (§14.3) |
| Tailgate tent | 16 × 12 | 1 | Game-day lots and the Practice Field |
| Smoker / grill | 10 × 8 | 2 (smoke puff) | Tailgates |
| Cornhole set | 12 × 6 | 2 (toss) | Tailgates |
| Sno-ball cart | 14 × 12 | 2 (flag flutter) | Union plaza on heat-wave days |
| Bonfire | 12 × 16 | 3 (flicker) | Homecoming quad, levee runs on Dec 9 |
| Blue tarp (decal) | roof-sized | 1 | Damaged buildings until repaired |
| Burrow hole (decal) | 4 × 3 | 1 | Levee tiles, one per burrow |
| Lookout tower (decal) | 12 × 24 | 1 | First Preserve tile |
| Egret / heron | 10 × 14 | 2 (stand, take-off) | Ponds, preserves, marsh |
| Roseate spoonbill | 10 × 14 | 2 (glide) | Preserve at Dawn, the Rookery |
| Pelican | 12 × 10 | 2 | River, Water Tower |
| Armadillo | 10 × 6 | 2 | Highway 1 at Night |
| Nutria | 12 × 6 | 2 (scurry) | Levees at Night |
| Cajun Navy pirogue | 22 × 8 | 2 (paddle) | Flooded dorms after a Cat 3+ |
| Ruin | footprint-sized | 1 | 100% damage |
| Surge Barrier gate | 32 × 24 | 4 (drop) | Row 41 |
| Spoonbill nest (decal) | 6 × 4 | 1 | Row 43 |
| The Mounds | 24 × 14 each | 1 | Two on the largest chenier (§3.4 step 5), grass-covered with a worn top |
| Bayou Field bleachers (decal) | footprint-sized | 1 | Practice Field tier 1: two bleacher banks, scoreboard, banner |
| Plywood (decal) | window-grid-sized | 1 | Boarded-up buildings until the storm passes |
- **Crowd:** the stadium seats are a per-seat pixel-noise brightness field with a sine wave sweep; fills to attendance %.
- **Terrain tiles:** each type has 3 dithered variants from a tile hash so ground never visibly repeats.

### 12.4 Lighting and day/night
Three passes after the world: (1) the sky tint multiply overlay; (2) an additive lights canvas (`globalCompositeOperation = 'lighter'`) of cached radial-gradient sprites for streetlamps (every 4 road tiles, every 6 path tiles), windows, stadium masts (six huge cones at Stadium II+), the Bell Tower beacon, the Water Tower blink, the substation arc, the generator glow, boil pots, bonfires, fireflies, lightning; (3) fog blobs when active. Vignette darkens edges at Night. Blackouts remove a substation's window and lamp lights in one pass (the patchy dark campus is the tell).

### 12.5 Weather effects
Rain: 300–1,200 short diagonal 1-px lines in screen space with a wind angle, **batched into a single `beginPath` / `stroke` per frame** (never one stroke per line), capped at **400 lines at 0.5× zoom**, splash rings on water tiles and puddles on paths. **Thunderstorm cell:** a soft radius-14 rain disc that visibly drifts. **Lightning:** a 1-frame white flash at 0.7 alpha decaying over 250 ms, one jagged polyline for 2 frames, 6-px shake; thunder delayed 0.3–2 s by distance. **Fog:** 8 large soft radial blobs scrolling slowly, denser over water. **Wind:** moss, flag and tree sway amplitude from `wind`; storm gusts ×3 with leaf particles and debris on bezier arcs. **Heat shimmer:** a 2-px vertical wobble on roof and asphalt rows when the heat index > 95. **Surge:** the front is a darker translucent band advancing tile by tile; overtopping is a sheet particle pouring over a crest; breach is a gush with foam.

### 12.6 Animation list
Water highlight scroll · moss and tree sway · flag wave · agent walk/idle/flee/splash/slap/cheer/sit/wave/cap toss · gator swim/walk/sun/wrangle · officer walk and pole · pump impeller and discharge foam · fogger truck and ribbon · bus loop on game day · pirogue glide and paddle · tiger pace and yawn · egret takeoff · spoonbill circle · boil-pot and vent steam · radar sweep (Institute) · water-tower blink and storm sway · substation arc · crowd shader and wave · fireworks · Mardi Gras float roll and bead throws · construction scaffold rise with dust · completion pop · demolition puff · coin burst on income · overtopping sheet · breach gush · floodgate drop · surge-barrier gate drop · water-tower topple · band march · Cajun Navy paddle · levee bonfires · graduation caps · azalea petals · cypress leaf drop · firefly drift and blink · heat shimmer · god rays after a storm.

### 12.7 Particles and juice
One pooled system, max 2,500 live (Low 800), each `{x, y, vx, vy, life, type, size, colorIndex}` drawn as `fillRect` (fireworks use small cached sprites). Types: rain, splash, dust, smoke, steam, sparks, fireflies, petals, beads, leaves, confetti, coin, fog wisp, mosquito haze dot, debris, foam.
Juice: screen shake (toggleable) on landfall, scores, demolition; hit-stop 60 ms on big money events; placement squash (scaleY 1.15 → 1 over 200 ms); cash odometer and stat tweens; cursor tile pulse; overlay fade; toast easing with a tiny tiger-paw stamp on achievements; gold flash on a win; the camera drifts during the title and the charter swoop.

### 12.8 "If a stat changes, something moves" (acceptance table)
| Stat or state | On-screen embodiment |
|---|---|
| Cash up / down | coin burst / red flash on the top bar; construction scaffolds |
| Students | pirogues arrive on the 5th of every month (§5.4), buses on Aug 5; agents spawn from them; dorm windows light |
| Coach / starters | the coach on the sideline in the set piece; starters named on the score bug and in the ticker recap; the halftime toast |
| Prestige | Bell Tower beacon brightness, crowd size, alumni riverbank picnics at Homecoming |
| Happiness | agents idle in groups vs. trudge; mood bubbles |
| Ecology | fireflies, egrets, spoonbills, frog chorus, reed density |
| Water depth | puddles, wading, bobbing cars, floodgate drop, overtopping sheets |
| Mosquito density | haze dots, slap animation, the fogger truck |
| Heat | shimmer, oak-shade rings, sno-ball cart |
| Blackout | dark windows and lamps in that radius, stopped impellers |
| Subsidence | Sinking! icon, 2° tilt, cracked-road variant |
| Levee integrity | one burrow-hole decal per burrow event, a cracked crown below 50%, "weak" tiles in the gap list, a ticker line naming the tile, bonfires on Dec 9, gauge stripes on floodwalls |
| Ring closed / gap | the Objective 11 card's live gap line, the Storm panel gap list, the ghost preview's "closes the ring", the floodgate dropping |
| Team rating / wins | crowd shader fill, fireworks, the gold light ring |

---
## 13. Audio (synthesized, on by default at low volume)

One `AudioContext` created on the first user gesture (the charter click), which also **starts the ambience at −12 dB with the top-bar 🔊 lit** (the click is the gesture browsers require, so the swamp is audible from the first pirogue); `M` or the toggle mutes in one key, and the choice is remembered in `bsu.settings` (a returning muted player stays muted); `audio.js` guards for a missing `AudioContext` (the headless test stub omits it on purpose). Every voice is procedural: oscillators, noise buffers, biquad filters, gain envelopes. Hard cap 12 simultaneous voices; ambience ducks −6 dB under stings; simple distance gain from the camera center.

- **Ambience bed (crossfaded by sky phase, season, weather, ecology):** frog chorus (3–6 voices of short filtered sawtooth chirps at 180–420 Hz, rate ∝ ecology, Night only), cicadas (band-passed noise 5–7 kHz with 20–40 Hz tremolo, summer Day, louder with heat), crickets at Night in spring and fall, distant owl (sine 400 → 300 Hz, rare), bullfrog "jug-o-rum" (90-Hz sine burst near water when zoomed in), mosquito whine (600-Hz sine with vibrato when the local density > 0.5, mercifully quiet), bayou lap (slow low sine + noise puffs near the channel).
- **Weather:** rain = brown noise through a lowpass whose cutoff and gain follow the rain rate; wind = filtered noise with a slow LFO, rising with category; thunder = a noise burst with 2-s exponential decay plus a sub-40 Hz sine thump, delayed 0.3–2 s after the flash; overtopping = white-water hiss; the storm drone = a 55-Hz sine with a slow LFO under everything from the wall to the back half.
- **UI:** place (square-wave plunk 300 → 200 Hz), drag tick per tile (1.2 kHz, 15 ms), invalid (buzz 110 Hz), money in (three ascending sine blips), milestone (gold chime: a major triad on triangle waves with a short noise-convolver reverb), notification (soft two-tone), hover (tiny click), demolish (noise crunch), pump hum (60-Hz loop when near the camera), fogger motor buzz, gator growl (60-Hz sawtooth with random FM, 0.8 s), splash (filtered noise burst).
- **Bells:** the Bell Tower at midday and Dusk: 4 decaying sines (fundamental + inharmonic partials at 2.4, 3.1, 4.7) in a 4-note motif; a special peal on Flagship and after a rivalry win.
- **Game day:** a procedural **zydeco motif** in G at 120 BPM: accordion (two detuned square waves through a bandpass, with vibrato) on a 2-bar riff, rubboard (short high-passed noise ticks on eighths with second-line accents), bass (triangle on roots, I–IV–V–I), 16 bars at the tailgate and after a win; a **brass-band sting** on scores: three detuned sawtooth "horns" playing a 5-note fanfare over a snare roll (noise burst); crowd roar = pink noise swell through a 400-Hz bandpass with a slow attack; whistle at kickoff; sad trombone (descending sawtooth glide) after a loss, once.
- **Mardi Gras:** the zydeco riff with a second-line snare pattern and tambourine (noise + 8-kHz bandpass), continuously at low volume during the parade.

---

## 14. Flavor Content

**University:** Bayou State University ("BSU"), on The Ridge in Red Stick Parish, beside the Big Muddy. Colors: Royal Purple and Old Gold. Motto over Founders' Hall: *"Ex Aqua, Scientia."* Fight cheer: **"Geaux Bayou!"** Student section: **the Marsh Mob.** Campus nickname: The Ridge.
**Mascot:** **Roux**, a Bengal tiger named after the base of every gumbo, who lives in the Tiger Habitat, paces, yawns during opponents' fight songs and, if his habitat floods, is briefly Loose (harmless; he goes to the Dining Hall). The costumed version is **Lil' Roux** in a number 00 jersey.
**Chief of Staff (tutorial voice):** Ms. Thibodeaux. One Cajun tic per screen at most; never one per sentence.
**The band:** **the Bayou Brass** (halftime, the parade, the pump-in). **The first coach:** **Coach Bobby Cheramie, 2★**, who comes free with the Practice Field and "has played in worse"; later coaches are drawn from the §14.1 coach table. Every dorm, gator and storm has a name, so the band and the coach do too.

**Rival schools (all fictional):** Magnolia State University "Magnolias" (arch-rival; green and white; the Golden Pirogue trophy), Crescent City University "Pelicans", Delta A&M "Catfish", Gulf Coast Tech "Shrimpers", Atchafalaya Polytechnic "Bullfrogs", Pineywoods State "Loggers", Sabine River Baptist "Prophets", Vermilion College "Cranes", Red Stick College "Ferrymen" (crosstown).

**Storm names:** §6.2. **Gator names:** Big Al, Beignet, Marie, Chomp Chomp, Ol' Frontenac, Tabasco, Professor Snaps, Étouffée, Tante Lou, Boudreaux Jr., Mudbug, Sazerac, Gumbo, Praline (retired when a storm uses it), and the legendary **Le Grand**.

### 14.1 Student name generator
First name + last name; 12% get a nickname in quotes; 25% of first names come from the modern-Louisiana table so the campus reads as today's Louisiana, not a costume drama.
- **First (Cajun/Creole):** Beau, Remy, Thibault, Jean-Luc, Landry, Boone, Cyprien, Étienne, André, Achille, Jude, Toussaint, Ambrose, Bastien, Claude, Emile, Hollis, Jasper, Jules, Lucien, Marcel, Octave, Placide, Sébastien, Ulysse, Wade, Cécile, Delphine, Marguerite, Noelie, Odette, Amélie, Josée, Camille, Clothilde, Evangeline, Fleur, Geneviève, Ida, Jolie, Lisette, Magnolia, Mireille, Nadia, Ophelia, Perrine, Renée, Simone, Solange, Tallulah, Vivienne, Yvette, Zoé, Bijou, Coralie, Rosalie.
- **First (modern Louisiana):** Tyler, Kaitlyn, Jaylen, Brooklyn, DeShawn, Madison, Hunter, Kayla, Trey, Destiny, Marcus, Jasmine, Darius, Alyssa, Cedric, Monique, Kobe, Imani, Terrance, Keisha, Tanner, Tiana, Jamal, Aaliyah.
- **Last:** Boudreaux, Thibodeaux, Fontenot, Guidry, Landry, Hebert, Broussard, LeBlanc, Melancon, Arceneaux, Robichaux, Cormier, Breaux, Trahan, Babineaux, Bourgeois, Dupré, Toussaint, Batiste, Delacroix, Lafleur, Prejean, Mouton, Doucet, Savoie, Chauvin, Gautreaux, Comeaux, Benoit, Domingue, Ledet, Naquin, Picou, Rousseau, Simoneaux, Theriot, Vidrine, Champagne, Duplantis, Falgoust, Metoyer, Balthazar, Jolivette, Honoré, Ancelet, Sonnier, Fuselier, Ardoin, Malveaux, Guillory, Bellard, Cheramie, Terrebonne, Delahoussaye, Toups.
- **Nicknames:** "Tee", "Boo", "Peanut", "Catfish", "Coco", "T-Jean", "Sha", "Bébé", "Skeeter", "Crawdad", "Nonc", "T-Boy", "Beaux", "Tank", "Pook", "Boudin".
- **Majors:** Coastal Engineering, Petroleum Geology, Mass Comm, Kinesiology, Sugarcane Agronomy, Cajun French, Marine Biology, Hospitality (Gumbo Track), Political Science ("Pre-Governor"), Nursing, Wildlife Management, Music (Accordion Performance), Wetland Ecology, Sports Management.
- **Hometowns (inspect flavor, starters and the recruiting card):** Thibodaux, Houma, Lafayette, Opelousas, Ville Platte, Breaux Bridge, Eunice, Mamou, Golden Meadow, Cut Off, Chalmette, Gretna, Plaquemine, New Roads, Natchitoches, Monroe, Shreveport, and "somewhere in Texas, don't hold it against her."
- **Coaches (name + one-line reputation; stars are rolled, §8):** Bobby Cheramie ("has played in worse"; the free 2★ starter), Delphine Arceneaux ("runs the option and the boosters"), T-Boy Guidry ("recruits the bayou by pirogue"), Marcus Batiste ("defense, gumbo, in that order"), Hollis Duplantis ("a clipboard and a grudge"), Renée Fontenot ("won a bowl somewhere dry"), Cedric Malveaux ("special teams evangelist"), Octave Robichaux ("older than the levee"), Imani Sonnier ("the analytics one"), Wade Terrebonne ("yells in two languages"). A coach's quote in the inspect panel comes from a 12-line pool ("We don't rebuild. We re-grade.").
- **Starter positions and first-name tables** reuse §14.1; the ticker recap template is "{pos} {name} ({hometown}): {stat}. {opp} 'had questions.'"

### 14.2 Building auto-names (cycled per type; player-renamable)
- **Halls (academic and dorms):** Boudreaux Hall, Fontenot Hall, Guidry Hall, Prejean Hall, Landry Hall, Broussard Hall, Toussaint Hall, Batiste Hall, Evangeline Hall, Acadiana Hall, Pontchartrain Hall, Atchafalaya Hall, Teche Hall, Sabine Hall, Vermilion Hall, Cane River Hall, Lafourche Hall, Calcasieu Hall, Tchefuncte Hall, Maurepas Hall. Towers get "Tower" (Pontchartrain Tower, Delacroix Tower).
- **Dining Halls:** The Roux, Big Easy Eats, Ma Tante's Kitchen, Tiger Boil, Étouffée Station. **Po'boy Shacks:** Dressed & Pressed, Debris & Gravy, Fried Oyster Hut, Tee-Boy's, Nonc Pierre's, Mama T's.
- **Greek Row:** Kappa Gumbo Kappa, Delta Pirogue, Sigma Zydeco, Alpha Boudin Beta, Rougarou Row. **Library:** The Delphine Prudhomme Library. **Union:** Laissez Union. **Engineering:** Delta Dynamics Center. **Coastal Institute:** Marsh Lab at Pointe-aux-Chênes. **Stadium:** Bayou Field (the bleachers) → Red Stick Stadium → The Cauldron → Cauldron Grand. **Bell Tower:** Cypress Bell Tower. **Levee runs ≥ 20 tiles:** "The Great Wall of Boudreaux."

### 14.3 Festival descriptions (Almanac and card copy)
- **Mardi Gras (Feb 6–8):** "Classes are technically in session. Nobody is technically in class. The Krewe of Roux rolls down the longest road at Dusk on the 8th; with a Student Union it's three floats and the Bayou Brass, who learned their part yesterday. Beads land on the Bell Tower. The gators have noticed the trash." **Route rule:** the parade uses the longest 4-connected run of Campus Road tiles (Highway 1 counts, so the 7-tile stub is legal but short; Objective 7 asks for 10); if no road run ≥ 4 tiles exists it uses the longest connected Gravel Path as a **walking krewe** (12 batched marchers, beads, no floats, the same 25 s); if neither exists, the krewe circles Founders' Hall. Trash tiles (gator attractor weight 5, §6.3) are the route's tiles for Feb 8–10. `dtDay = 0` during the parade. **Throw me somethin':** the parade is 250 ticks and interactive: clicking (or tapping) a float lobs a bead volley (8 bead particles on bezier arcs toward the nearest 3 agents), each volley is a "catch", and every 10 catches is +1 on the `beads` happiness timer (cap +3, 10 days, §5.6); the card counts them ("Catches: 23"). The first set piece the player sees has a lever, before the hurricane does.
- **Crawfish Season (Mar 1 – Apr 10) and the Crawfish Boil (Apr 5):** "Forty sacks, sixty pounds of corn, a hundred pounds of potatoes, and a suspicious amount of cayenne. If your Dining Hall dumpster is fenced, the gators watch from behind the wire. If it isn't, the gators attend."
- **Graduation (May 5):** "Caps in the air, mosquitoes in the cap. 22% of your students become alumni, and alumni write checks."
- **Homecoming (Oct 7–8):** "A bonfire on the quad, alumni on the riverbank, and the Marsh Mob louder than the Cauldron's engineers thought was structurally advisable."
- **First Night Game:** "The Cauldron's lights come on for the first time and the swamp goes quiet. Then it doesn't."
- **Levee Bonfires (Dec 9):** "Bonfires on every levee run to light the way for Papa Noël. Your flood defense is also your best party. Happiness scales with the length of the wall you built."
- **Founders' Day (Jan 1):** "The Chancellor's annual recap. What flooded, who won, what's sinking."

### 14.4 News-ticker and event lines (62; `{}` fields are filled from game state)
1. Facilities crew reports a gator sunning on the culvert. Crew reports it back.
2. Tropical wave off Africa has forecasters "mildly interested."
3. Mosquito index: BIBLICAL. Student Health recommends long sleeves and prayer.
4. Le Grand spotted at the cypress lake. He has been offered a scholarship.
5. Parking Services issued {n} tickets today. Campus has {cars} cars.
6. Levee inspection finds a nutria burrow "the size of a sophomore."
7. The Marsh Mob has been asked to stop shaking the seismograph. The Marsh Mob has declined.
8. Zydeco Friday: accordion audible in three parishes.
9. Cypress trees turn orange; students confirm it's "fall, technically."
10. Heat index {hi}. The quad's live oaks now have a waiting list.
11. Crawfish boil draws {n} attendees and one uninvited reptile.
12. Chancellor's office clarifies that "Geaux" is not a typo.
13. Heron nesting season begins in the Preserve. Please do not name them.
14. State legislature praises BSU's ecology. State legislature asks about the football score.
15. Fog advisory: campus visibility reduced to "vibes."
16. Brownout: labs dark, dorms warm, tempers warmer.
17. Pump Station {n} running at full tilt. Engineers describe the sound as "reassuring."
18. Pump Station {n} offline. Reason: the pump station flooded.
19. Tailgate city population briefly exceeds enrollment.
20. Roux yawned during {opp}'s fight song. Analysts call it "a statement."
21. Wildlife Officer relocates {gator} for the fourth time this month. {gator} files appeal.
22. Storm surge overtops the south levee. Boardwalk now technically a dock.
23. Tuition increase announced. Applicants describe reaction as "hmm."
24. Fireflies over the marsh tonight. Astronomy Club cancels stargazing to watch bugs.
25. Cold snap kills mosquitoes. Campus throws a parade for the cold snap.
26. {hall} on wet ground has sunk a foot. Residents now "closer to nature."
27. Coastal Studies Institute publishes paper: "The Campus Is Sinking (But So Is Everything)."
28. Gator in the pool. Rec Center closed. Gator awarded the lap-swim record.
29. Magnolia State's mascot spotted on campus. Roux unbothered.
30. Homecoming bonfire "larger than permitted, smaller than legendary."
31. Semester underway: 91% attendance, 9% "checking on the levee."
32. A pelican has taken up residence on the Water Tower and refuses interviews.
33. First-year students learn to pronounce "Atchafalaya." Second-year students stop trying.
34. Night game forecast: clear skies, 78°F, 100% chance of goosebumps.
35. Retention pond stocked with bream. Mosquitoes stocked with regret.
36. Faculty Senate requests more parking. Parking Services requests more tickets.
37. Spoonbills circle the Preserve at dawn; the Marketing office cries.
38. Late-night po'boy line reaches the Bell Tower. Bell Tower adds a second window.
39. Hurricane {storm} cone narrows. Campus discovers what "gap in the levee" means.
40. Cajun French class oversubscribed; "mais la" now the official campus greeting.
41. Graduation: {n} seniors toss caps. One cap retrieved from a gator. Gator "kept it."
42. Coach declines to comment on the loss, comments extensively on the humidity.
43. BSU {w}, {opp} {l} — FINAL. Bells ring until someone finds the off switch.
44. {opp} {w}, BSU {l} — FINAL. Sad trombone reported near Greek Row.
45. Hurricane {storm} downgraded to "a mess."
46. Athletic Director: "We've played in worse." Weather Service: "You have not."
47. {storm} has passed. Campus mostly here. Dining Hall serving hurricane gumbo.
48. Subsidence survey complete. Findings: "Yes."
49. Someone painted the Golden Pirogue purple. The Golden Pirogue was already purple.
50. Roux is loose. Roux is fine. Roux is at the Dining Hall.
51. Students cut a desire path across the quad. Facilities calls it "a suggestion."
52. Naming rights sold: {hall} is now Boudreaux Petroleum Hall. The {family} family is "processing."
53. Levee bonfires lit for Papa Noël. Pump Station {n} "feels seen."
54. Blackout day 3. Freshmen have discovered stars.
55. State Disaster Grant approved. Check is "in the mail." Mail is "flooded."
56. Chancellor's Founders' Day address: "We are still here. The water is also still here."
57. Levee inspection finds a nutria burrow at ({x}, {y}). Facilities describes it as "a sophomore-sized problem."
58. Boil-water advisory. Dining Hall boils everything anyway.
59. The Cajun Navy has arrived. It brought sandwiches.
60. {pos} {name} ({hometown}): {stat}. {opp} "had questions."
61. Coach {coach} is going for it. The Marsh Mob approves. The Athletic Director is "watching."
62. Tropical Storm Amélie fizzled in the Gulf. The new levee "did not fizzle."

---
## 15. Technical Feasibility Notes

### 15.1 One HTML file (matches the repository scaffold)
- `build.mjs` reads `src/manifest.json` (ordered module list), inlines `src/style.css` and every `src/js/<module>.js` into `src/index.template.html` at the `/*__CSS__*/` and `/*__JS__*/` markers, refuses any external `<script src>`, `<link href>` or `@import`, and refuses a module containing `</script`. `node build.mjs --check` syntax-checks every module first. Output: `index.html`, target ≤ 700 KB uncompressed.
- No `import`/`export`, no `type="module"`, no `fetch`, no Workers, no `OffscreenCanvas` (use `document.createElement('canvas')`), no fonts beyond the system stack (`Georgia` for the title, `system-ui` for the HUD), no images: the atlas is generated at load. `AudioContext` only inside the first gesture handler. `localStorage` wrapped in try/catch with an in-memory fallback and a one-time "saves unavailable in this browser mode" notice. `canvas.toDataURL` for the postcard works on `file://`.
- Each module is an IIFE that assigns to `window.BSU.<name>`; nothing touches the DOM or `window` at definition time except reading `BSU`; all setup happens in `init()` called by `session.js` at boot. This is what lets `test/domstub.mjs` load `index.html` in Node and tick it. `docs/ARCHITECTURE.md` (the per-module contract summary the parallel authors read alongside `contract.js` and this document) is written from §0.2 and §15.2 before any module is started.

### 15.2 The contract (`contract.js`, written first, frozen)
- **Enums:** `BSU.T` tile types (`OPEN_WATER, BAYOU, MARSH, WET, DRY, HIGH, DRAINED, POND`); `BSU.SURF` surfaces (`NONE 0, PATH 1, ROAD 2, BOARDWALK 3, FENCE 4`); `BSU.B` building ids (the 43 in §0.3; tiers, Bayou Field and Pilings are fields, not ids); `BSU.SKY` phases; `BSU.OV` overlays; `BSU.STORM` phases; `BSU.OBJ` objective kinds (interrupt / background).
- **World layout:** the typed arrays of §3.2 with index `i = ty × 64 + tx`; helpers `idx(tx, ty)`, `nbr4(i)`.
- **Structs:** `Building {id, type, tx, ty, w, h, name, hp (0–1), built (0–1), pilings, sunk (ft, for the retrofit price), powered, watered, flooded, closedUntil, tier (Stadium 1–3; Practice Field 0–1 for Bayou Field), data}` (footprint buildings only; drag tiles live in the tile arrays of §3.2) where `data` is a generic per-building object saved verbatim: `{fuelDays, stockedDay, active (abatement on/off), policies: {gatorProofDumpsters, nutriaBounty}, boardedUntil, tarps}` (levee-run names live in `state.runNames`, §11.3); `Veg {type (oak|cypress|palmetto), tx, ty, stage (0–2), plantedDay}`; `Agent {id, tx, ty (float), dir, state, target, route, mood, energy, wet, bitten, home, name, major}`; `Gator {id, tx, ty, state, size, name, den, target}`; `Storm {name, cat, forecastCat, tLandfall (absolute tick), landfallPoint, track, phase, surge, nearMiss, jammedGates[] (tile indices), rolls {towerTopple, substationOutages[]} decided at tick 150}`; `VoiceCard {id, state, offeredDay}` (§7.1); `Coach {name, stars, hiredYear, quote}`; `Starter {name, pos, hometown, rating}`; `Timer {id, untilDay, value}` (every timed modifier in the game: happiness `events` of §5.6, insurance, Board-card effects, sandbag expiry summaries, Boil-Water, Cajun Navy, Play Through It, Austerity, festival buffs); `Economy {cash, students, alumni, prestige, happiness, ecology, tuition, quality, selectivity, coaching, loan, insurance, endowment, pool (applicants remaining this cycle), westCampus}`.
- **Events** (`BSU.EV`): `tile:changed`, `building:placed`, `building:removed`, `building:complete`, `building:flooded`, `building:dried`, `building:damaged`, `power:blackout`, `power:restored`, `weather:rain`, `weather:cell`, `sky:phase`, `calendar:day`, `calendar:month`, `calendar:semester`, `calendar:year`, `storm:wave`, `storm:named`, `storm:watch`, `storm:bands`, `storm:landfall`, `storm:phase`, `storm:passed`, `surge:start`, `surge:peak`, `surge:end`, `levee:overtop`, `levee:breach`, `gator:spawn`, `gator:campus`, `gator:relocated`, `mosquito:warning`, `festival:start`, `festival:end`, `game:kickoff`, `game:score`, `game:final`, `econ:income`, `econ:expense`, `econ:card`, `enroll:lock`, `milestone:earned`, `objective:offered`, `objective:complete`, `agent:flee`, `agent:desireLine`, `ui:notify`, `ui:ticker`, `save:written`, `save:loaded`. Payloads are documented inline; modules communicate only through events and read-only queries; only the owning module writes its state.
- **Params:** every constant in this document lives in `BSU.params` with the section number in a comment; the debug panel enumerates it.
- **Save schema v1:** `{v: 1, seed, tick, calendar (absolute day, year, speed setting, and the speed in force before any set piece), sky, playSeconds, tiles: {elev, depth, sat, stand, mosq, subs, crest, integrity, sandbag, sandbagDay, wear, flags, surface} as base64 typed arrays, veg[] (every tree entity, generated or planted: {type, tx, ty, stage, plantedDay}; the generator's trees are written out and never re-derived, so removed and grown trees survive a reload), buildings[] (each with its data object), gators[] (with states and targets), wildlife: {nutria, leGrandDay}, economy, weather: {rainDays[] (the year's drawn rain days and kinds), event (the active rain event or null), cellX, cellY, stepsLeft, heat, wind, riverStage}, sports: {coach, starters[], record, schedule, autoSim, permits, game (the in-progress game's r, P, P₂ and quarter scores, or null)}, storms: {current (the live Storm struct or null), scheduled[], log[]}, progress: {objectives, interruptQueue[], milestones, timers[] ({id, untilDay, value} for every timed modifier), voiceCards[], tutorialStage, setPiecesSeen}, ticker[] (the last 30 lines), runNames, setPiece (null, or {kind, tick, choices} for a save written during a set piece, which resumes at that tick on load), ui: {camera, overlay}, rng}`; only agents are regenerated on load, deterministically from `seed` and `tick` (same count, same order). Size ~240–380 KB. Slots `bsu.save.auto.0–2`, `bsu.save.manual.0–2`, settings `bsu.settings`. A version mismatch offers "start fresh with the same seed." **Round-trip test:** `test/save.mjs` saves, reloads and asserts identical ecology, tree count, running costs, active timers and the gap list; `test/smoke.mjs` additionally asserts that `JSON.stringify(BSU.headless.snapshot())` is byte-identical before and after `load`, which is why gators, storms, the speed setting, timers, weather and the tick counter are all in the schema.
- **Headless API:** **`docs/HEADLESS_API.md` is the authoritative surface and `test/smoke.mjs` is its executable contract; where this document and those files disagree, this document is wrong and must change.** In brief: `BSU.session.newGame({seed, skipTutorial})` (returns the state and sets `BSU.state`), `BSU.session.save(slot)` → JSON string (also written to `localStorage` under try/catch), `BSU.session.load(slot)` → state (from `localStorage` or the in-memory slot map); `BSU.headless.tick(n)` (n fixed 100-ms sim ticks, no rendering, set pieces included), `render()` (exactly one frame, all passes and the HUD update, on the stub canvas), `snapshot()` → `{year, month, day, tick, cash, students, prestige, happiness, ecology, buildings, agents, gators, floodedTiles, floodedBuildings, storm: null | {name, cat, phase}, speed}` (`floodedTiles` = land tiles with depth ≥ 0.5; `floodedBuildings` = Building structs with `flooded`; `tick` = ticks since founding; `speed` = the setting, 0 paused / 1 / 2 / 4), `findSpot(id)` → `{x, y}` or null (a legal footprint origin searched outward from the start plot, or a legal start tile for a drag tool), `place(id, x, y)` → `{ok, reason}` through the same validation and cost path as the UI (a drag tool places one tile), `forceHurricane(category)` (creates a named storm of that category with the cone at the current tick and **landfall at the current tick + 600**, ignoring the season, the drawn schedule and the §10.3 hold; the normal T−3 / T−1 / T0 timeline then runs and the 900-tick set piece plays under `tick`), `click(px, py)` and `key(name)` (synthesize input through `ui.js`'s state machine), `fastForwardDays(n)` = `tick(100 n)`, `state()` = `BSU.state`. Timing constants: 10 ticks per second at 1×, 100 ticks per calendar day, 12,000 per year (§0.1).
- **`BSU.state`** is the single live state root, owned by `session.js`: `{seed, tick, playSeconds, calendar, sky, tiles, veg, buildings, agents, gators, wildlife, economy, weather, storms, sports, progress, ui, rng, runNames, ticker, setPiece}` (the save schema above, plus `agents`). Each module owns exactly one branch and reads the others through the owning module's query functions; no module caches a branch across `save:loaded`, because a load replaces the root.
- **`BSU.headlessMode`** is computed by `contract.js` at load as `typeof window.__headless === 'object'` (the object `test/domstub.mjs` installs on its window) and may be forced true by a harness before boot. `session.js` starts the `requestAnimationFrame` loop only when `typeof requestAnimationFrame === 'function'` and `!BSU.headlessMode`; in headless mode the only way time passes is `BSU.headless.tick`. `render.js` and `audio.js` must be callable in headless mode (the canvas context is a no-op stub; `AudioContext` is undefined) without throwing, and no module may touch the DOM, timers, `AudioContext` or `requestAnimationFrame` at definition time.
- **`skipTutorial`** (`newGame({skipTutorial: true})`, used by every test): the world is generated exactly as for a normal game (same seed → same map), then: Founders' Hall is placed on its reserved footprint; a straight Gravel Path is laid from the tile in front of Founders' Hall to the Marsh shoulder beside the Pirogue Landing (the G3 route); the 120 founding students are present from tick 0 (no pirogue arrival); the calendar runs from Jan 1 at 1× immediately; the palette is fully unlocked **per the normal unlock rules** (every start-available row visible from tick 0, gated rows still gated by students, prestige and milestones; every tab introduced); Objectives 1–5 are marked complete with **no** grants and the objective card starts at Objective 6 (§10.2); the ⚡💧 penalty applies from tick 0 (no tutorial suppression); **no scripted tutorial beat runs** (no charter card, no ghost on the cursor, no 1:15 cell, no Show-me notifications, no first-warning speed drops); the scripted Year-1 storm still happens on the §10.3 schedule (`playSeconds` counts 0.1 s per tick in headless mode), Amélie still follows Objective 11, the Apr 5 cell still fires, and set pieces are still not skippable the first time (they simply run in ticks). `playSeconds` in a browser is wall-clock; in headless mode it is `tick / 10`.

### 15.3 Performance budget (1280 × 800, zoom 1, 2019 MacBook Air class, Chrome and Safari)
- Tiles 4,096; visible ~700; terrain from ≤ 20 chunk canvases (20 `drawImage`). Water tiles visible ≤ 300 path fills in normal play (Marsh standing water is baked, §12.1); up to ~700 during a surge, which is the "landfall at t = 35 s" case of the perf list.
- Entities: footprint buildings ≤ 400 (drag tiles are tile data, not entities, and are bounded only by the 4,096 tiles), trees ≤ 1,200, agents ≤ 300, gators ≤ 24, misc ≤ 100; a depth-sorted visible list (insertion sort maintained incrementally; re-bucket on tile change) → ~600 `drawImage` typical, 1,200 worst (game-day Night in a storm).
- Particles ≤ 2,500 `fillRect`. Lights ≤ 250 cached radial sprites. Three full-screen composites (tint, lights, fog).
- Simulation: 10 tps; hydro 4 tps over the active set (worst case full map during rain: 4,096 × 4 × 2 ≈ 33k neighbor ops per step); agents 10 tps with ≤ 8 A* per tick; mosquito grid daily; economy monthly.
- Memory: chunk canvases ≤ ~50 MB (baked at 1× only), atlases ≤ 8 MB, particles and tiles < 1 MB; total live canvas memory ≤ 64 MB (§12.1, the Safari limit).
- **0.5× zoom budget** (~2,000 visible tiles on a 1280 × 800 viewport, the full map): water highlight lines skipped (static highlight baked into the chunk), trees from the atlas only (no moss strands, no sway), rain capped at 400 lines and always one `beginPath`/`stroke` per frame, fireflies capped at 300, agents drawn as 2-frame sprites. Target: ≤ 25 ms per frame on the 2019 Air in the worst case.
- Guardrail: if frame time > 25 ms for 60 consecutive frames, drop to Low particles, halve fireflies and rain lines, quarter-res lights canvas, and show a "performance mode" chip once; never reduce the agent count below 120.
- **Perf acceptance list** (run by hand on the target laptop with `node test/browser.mjs --fps`, harness 3 of `docs/TESTING.md`, 30 fps floor everywhere): 1× campus Day; 1× game-day Night with fireworks; 1× landfall at t = 35 s (rain 900, surge front, lightning); **0.5× full-map, game-day Night, rain**; 2× the Cauldron at Night; the title screen.

### 15.4 Module decomposition and parallel authoring (§0.2)
- Integration order: `contract.js` (day 0, frozen; `docs/ARCHITECTURE.md` summarizes it per module for the parallel authors) → `data.js` → simulation modules in parallel (`terrain`, `hydro`, `weather`, `wildlife`, `buildings`, `economy`, `agents`, `sports`) → presentation in parallel (`sprites`, `render`, `ui`, `audio`) → `progress` and `session` last. Each module ships `selfTest()` returning `{ok, notes}` (pure, no canvas), which `test/modules.mjs` runs after booting a `skipTutorial` game through `test/domstub.mjs`; `test/smoke.mjs` is the integration run (boot, tick, place, hurricane, save/load, §15.2), and the deeper suites are `test/hydro.mjs` (§6.1.11), `test/mosquito.mjs` (§6.4), `test/econ.mjs` (§5.7) and `test/save.mjs` (§15.2). Between them they: generate a seed, assert guarantees G1–G8 and the §3.3 distribution, tick one year at 4× with no NaN, run the §6.1.11 hydro tests and the §6.4 mosquito tests, run the §5.7 projection, spawn a Cat 3 and assert the levee cases and the gap list, play a season with the halftime toast defaulted, save and reload (§15.2 round-trip).
- Presentation modules never mutate simulation state except through `BSU.buildings.place/remove`, `BSU.economy.set*`, and the Storm/Season panel actions; `progress.js` is the only module allowed to script other modules (force a cell, force a clear night, freeze the calendar).

### 15.5 What to cut first if scope must shrink (in order)
1. Touch input; colorblind overlay palette.
2. Stadium III (stop at the Cauldron; the night-game moment survives).
3. Nutria as visible sprites (keep the integrity mechanic and the ticker line); spoonbills, pelicans, the armadillo.
4. The fogger truck as a visible vehicle (keep the radius effect); the officer's wrangle animation (keep relocation with a puff).
5. The zydeco motif (keep stings and ambience).
6. The Sugar Cane Bowl, ticket tiers, coach hire/fire (keep the named coach and stars as flavor), the recruiting card, Homecoming budget and tailgate-permit cards (keep the coaching slider, the named starters, the halftime toast and the night-game toggle).
7. Board of Regents cards other than Insurance.
8. Heat shimmer, fog, god rays, the eye phase.
9. The 2× atlas (draw the 1× atlas scaled).
10. Drained-marsh reversion (keep draining).

**Never cut:** the hydrology CA and surge front, the landfall set piece, the substation cascade, gators, mosquitoes, subsidence, the first two minutes and the pirogues, the Flood Risk overlay, the scripted first night game, agents walking to class, day/night lighting and fireflies, the Milestones panel, the failure-state cards, autosave, the debug panel.

---

## 16. Scope Risks and the Three Demo-Killers

**Scope risks and mitigations.**
- **Hydrology tuning** is the make-or-break: too rare and the swamp is scenery, too common and it is a chore. Mitigation: per-event rain totals, one `params` object with debug sliders, the eight acceptance tests in §6.1.11 and the three in §6.4 as the definition of done, and a Flood Risk overlay built on the same code path so mis-tuning is visible to the player instead of hidden.
- **Hurricane choreography touches every module.** Mitigation: landfall is an event-bus timeline (`storm:phase` events at fixed ticks) that each module reacts to independently; the storm can be spawned from the debug panel in under a minute.
- **Sprite authoring volume.** Mitigation: one parameterized building painter, a 30-decal library, generated variants (night, damaged, pilings, scaffold, ruin), and a catalog capped at 40 core rows plus the three capstones, with every other sprite listed once in the §12.3 table.
- **Trackpad input.** Two-finger scroll must pan, pinch must zoom, click-vs-drag needs a 4-px threshold; one input state machine in `ui.js`, tested in Chrome and Safari.
- **Integration.** The contract is frozen before anyone writes a module; every module has `selfTest()`; the build refuses external references; the headless harness (`node build.mjs --check && node test/smoke.mjs && node test/modules.mjs`, §15.4) ticks a full year in CI. Every interface that two agents could implement two ways is spelled out (§3.2 `surface`, §3.6 Access, §4.11 Floodgate and coverage, §6.2 Rings, §8 score model, §15.2 `BSU.state` and the headless surface).
- **The clock.** Every duration in this document derives from §0.1; any module that needs "an hour" is wrong and should use a sky phase or a calendar day.

**The three things most likely to make this feel like a demo, and how the design avoids each.**

1. **A pretty map where nothing pushes back.** Demos let you place buildings forever. Here the swamp is an adversary with a schedule the player can see: a cell at 1:15, a ridge that is full by minute 2 so the second dorm must go somewhere wet, a gator at minute ~3 following the Mardi Gras trash, a wet-spring cell on Apr 5 that floods a cove dorm, a mosquito warning before June, a home opener on the bleachers in August, a near-miss at minute ~10.5 that tests the ring, a named Category 2 storm in the first 15 minutes that damages whatever the player put below 5 ft, subsidence every January, a bed-capped rolling enrollment that makes every month a capacity problem. Every shortcut (drain the marsh, skip pilings, leave a gap in the ring, skip the pump) is cheap now and expensive later, and every failure has a card with three ways out.

2. **Numbers changing in a panel instead of things happening on screen.** Every system has a visible embodiment (§12.8): students route around a gator, cars bob in the lot, a floodgate drops when the surge arrives, a levee overtops with a sheet of water, mosquitoes are a haze, the fogger drives, the pump foams, prestige is a Bell Tower and a full bowl, ecology is fireflies. Happiness is sampled from where students actually walk. The acceptance criterion for engineers is literal: if a stat changes, something on screen must move.

3. **No arc, no moment.** A sandbox with no story is a toy. This design has a fixed dramatic spine in the first 20 minutes (pirogues → the cell → the parade route → the ridge-full choice → the gator → the levee ring → Amélie fills and drains it → the cone → Célestine, with at least one decision inside it → the repair → Homecoming on the bleachers), a monthly Student Voice card that turns the named students into asks, a Spring High Water from Year 2 so the river is a hazard and not scenery, a scripted second act (the preserve and its fireflies; the Cauldron and the guaranteed night-game frame; Fortress vs Living With Water), a chain that hands off to a Milestones panel so "what now?" is always answered, festivals every few minutes, a ticker that names the storm and the score, and a Postcard button so that when a student sends the frame to a friend, the friend asks what happened next.

---
## 17. Change log (v1.2 review: 35 completeness issues + 14 fun issues)

Each line: source (C = completeness critic, F = fun critic), section, resolution. Nothing was already applied when this pass began (the previous fixer never wrote to disk; no half-applied edit was found by the column-count / duplicate-line / dangling-sentence scan).

**Blockers**
- C1 §6.2 Rings / §4.11 / §10.2 Obj 11–12 / T7: static protection test counts a healthy Floodgate's full crest; only `storm.jammedGates[]` count as open; gates listed as "will auto-close", never a gap; T7 rewritten (fill stops at a healthy gate, passes a jammed one); Obj 12 item is "a Floodgate on every canal crossing"; milestone 6 drops "no open crossings". Objective 11 is now satisfiable with the tutorial canal.
- C2 §15.2 / §0.2 / §5.7 / §6.1.11 / §6.4 / §15.3 / §15.4 / §16: headless paragraph replaced by a pointer to `docs/HEADLESS_API.md` + the exact surface, `BSU.state`, `BSU.headlessMode` (detected via the domstub's `window.__headless`), `skipTutorial` semantics, snapshot byte-identical across save/load; test files renamed to `smoke.mjs`, `modules.mjs`, `hydro.mjs`, `mosquito.mjs`, `econ.mjs`, `save.mjs`; `perf.md` replaced by harness 3 of `docs/TESTING.md`; `docs/ARCHITECTURE.md` declared as the per-module summary written from §0.2/§15.2 (so README's reference stands).
- C3 §3.2 / §0.3 / §15.2 / §15.3: `surface` Uint8 layer (0 none, 1 path, 2 road, 3 boardwalk, 4 fence) + `BSU.SURF`; flags bit10 debris, bit11 mound; drag tools write tiles never Building structs; culvert/bridge/streetlamp/parade route derived from it; per-tile upkeep; `surface` in the save; `buildings ≤ 400` counts footprint buildings only; levee-run names in `runNames`.
- F1 §6.8 / §3.6 / §6.1.7 / §6.5 / §0.3 row 30: pilings tiles count as wetland; a drained tile counts as three lost tiles (`wetlandLost`); the orphan "−1 once" deleted; retrofit priced `+40% × (1 + ft sunk)` with `Building.sunk`; the ghost prints "sinks / below the flood line in Year n / Pilings then ≈ $".

**Majors**
- C4 §3.4 step 7 / §3.6 / §10.1: Highway 1 stub is ty 0–6 (7 tiles) touching Founders' Hall; "connected" = 4-connected through `surface` 1–3 to the stub or to a tile adjacent to Founders' Hall (network root); the Obj 2 drag snaps its start beside the hall; Obj 7 and §14.3 say 7 tiles.
- C5 §0.3 rows 2/4 / §4.1 / §10.1: Road-within-4 dropped from the Substation (kept for Stadium, Parking, Wastewater).
- C6 §6.1.4 / §6.2 / T3: flow uses `≥` and drops the receiving crest while a levee tile is overtopped (`crestTop`, overtopping branch); protection fill passes `≤ H`; T3 expects ≥ 0.5 ft behind an unsandbagged 2-ft-tile levee at Cat 3.
- C7 §0.3 row 41 / §4.10b: barrier is a 4–8-tile drag, end tiles land ≥ 1.5 ft or levee/floodwall, towers on auto-pilings; upstream = smaller spline parameter.
- C8 §0.3 row 42 / §4.10b: Marsh Restoration paints 10–40 tiles that are Drained, Wet with `wetlandOriginal`, or Wet within 3 of Marsh; Wet tiles lowered to 1.0 ft; ecology +15 × tiles/40.
- C9 §8: quarter score model (weights from side strength, pre-rolled winner, walk-off correction), starter stat line, club/away games off-screen.
- C10 §0 / §0.1 / §9.1 / §6.2 / §8: event time is tick time (100 ms per tick, 10 ticks per real second in a set piece); landfall 900, home game 750, parade 250, graduation 150 ticks; toasts 80 ticks; pulses at ticks 250/380/550/680; `forceHurricane(cat)` = cone now, landfall at tick + 600.
- C11 §12.1 / §15.3: chunks baked at 1× only and pixel-doubled at 2×; only the sprite atlas has a 2× variant; 64 MB live-canvas cap with the Safari note.
- C12 §3.3 / §3.4 / §6.1.2 / §12.1 / §15.3: generator initial state (Marsh depth 0.15 + 0.25 × noise, sat 0.9; others depth 0, sat 0.5); Marsh standing water baked, live diamonds only for water-flag and non-Marsh tiles (Marsh above 0.5 ft); the 1:15 cell is 3 in.
- C13 §15.2 / §0.3 row 8 / §4.3 / §10.3: `skipTutorial` fully defined per the fixed project facts (Founders' Hall, the path, 120 students pre-placed; calendar runs; palette unlocked per normal rules; no scripted beats; Objectives 1–5 complete without grants; Year-1 storm on schedule; `playSeconds` = tick/10 headless); row 8 reads "footprint reserved; placed in Obj 1 (pre-placed with skipTutorial)".
- F2 §6.2 Wind / Prep / §5.3: `baseDmg` is the per-storm total split 1/3, 1/3, 1/6, 1/6 across the pulses; Board Up is triage at 6 buildings per calendar day (12 with a Wildlife Post) with a ranked pick-list.
- F3 §0.3 rows 18–19 / §4.6 / §5.2 / §5.7 / §8 / §9.2 / §10.2 Obj 15, 18a, 20 / §10.3 / §10.6 / §14.2: Bayou Field bleachers as Practice Field tier 1 ($600k, 6,000 seats, day games, 400 students); Stadium I is Red Stick Stadium $2M/15k at 600; Stadium II $8M at 1,500; the money curve re-run.
- F4 §6.2 landfall: a guaranteed shelter toast at t = 30 (Year 1 always; later when nothing else qualifies); Toast 1 loosened to (integrity < 85%) OR (unsandbagged AND surge ≥ crest − 3 ft), which also resolves C23's precedence; camera direction at t = 15 and t = 35.
- F5 §9.2 / §10.2 Obj 9 / §5.6 / §16: first gator at the first Dusk on or after Feb 9 (Mardi Gras trash); scripted 3-in wet-spring cell on Apr 5 over sat ≥ 0.7; Homecoming's +5 spirit needs a bonfire, which needs a Quad Lawn; the Bayou Field opener fills the fall.
- F6 new §6.9 / §2.2 / §0.2 / §6.1.5 / §6.1.11 T8 / §9.2 / §15.2: Spring High Water (river stage 1–3 ft drawn Jan 1, Apr 1 – May 10, bayou backwater 0.5×, seepage, floodgates shut, the Bonnet Roux Spillway); gator population +floor(students/1,000).
- F7 new §7.1 / §0.2 / §5.6 / §15.2: twelve Student Voice cards, monthly, accept/decline, `progress.voiceCards[]`, `studentVoice` timer.

**Minors**
- C14 §0.3 header / §3.6: adjacency list is rows 4–22, 24, 28, 32, 34, 39, 40, 42, 43; row 30 added to the exempt list.
- C15 §3.4 / §3.5: `bank₀ = bank(7)` for the stub, the footprint, the oaks and G1; `plot.bank0`.
- C16 §3.5 G1b: window 72–110, and rows 5/14 at d ≥ 9 may be lowered.
- C17 §3.3 / §15.2: Marsh is `elev < 1.5` without a water flag; a `Pond` type for pondSink tiles; `BSU.T.POND`.
- C18 §0.1 / §6.1.2: the bands pass represents one calendar day (dtDay 1/60 kept); cells are 1.5 calendar days drifting 1 tile per 0.1 day.
- C19 §4.11: coverage assignment (nearest in-range provider with spare capacity, ties by placement order, Chebyshev from nearest footprint tiles); an unpowered Water Tower serves 25.
- C20 §0.3 row 6 / §4.2: `fuelDays = 3` at placement, +3 per $5k, running cost only on blackout days.
- C21 §4.11 / §6.2 Power: one blackout definition (50% rule; pumps stop, research 0, lights off; Dining at 50%); over-capacity is a brownout only.
- C22 §0.1 / §6.2 lifecycle / §10.3: landfall = cone + 6 (cone + 9 with the Institute); the wave line at T−11 with the Institute.
- C23 §6.2 Toast 1: precedence written as OR/AND (merged with F4's threshold); pulse times 25/38/55/68 s.
- C24 §5.3 / §5.4 / §5.5: flat faculty bonus dropped; selectivity's +0/+4/+10 is 0.10 × selectivityScore; Rookery 6, Mounds 1, BSU West 10 and Bayou Field 1 added to landmarks.
- C25 §6.3: game-day gator is +1 for a season (timers table authoritative), not +3.
- C26 §5.6 / §8 / §5.9: "a week" → 7 calendar days for the rivalry, 10 days for Homecoming Budget.
- C27 §5.2: Year-1 state funding $0.9M; donations $15–40k/mo at Year 5; §5.7 re-run.
- C28 §10.4: "the first Sep or Oct home game after Stadium II completes".
- C29 §15.2: `weather`, `wildlife`, `ticker[]`, `runNames`, `setPiece`, `sports.game`, `storms.current`, `surface` added to the schema.
- C30 §3.3 / §3.6 / §0.3 rows 1–3 / §7: Gravel Path allowed on Marsh (the tutorial path must reach the landing's Marsh shoulder), Road not on Marsh or Preserve, Boardwalk anywhere; Levee/Floodwall/Canal/Fence/Preserve on Marsh; only Boardwalk, Fence and Rookery on Preserve. Deviates from the critic's "no paths on Marsh" because G3's landing is on the bayou shoulder.
- C31 §6.3: campus = tiles within Chebyshev 3 of a footprint or path/road tile; the dumpster tile defined by coordinates.
- C32 §9.4 / §10.5 / §5.9 / §5.4 / §10.2: first-warning drop 10 s or dismissal; first milestone earned in a year wins (19 vs 20); two Board cards per lock; May 5 order graduation → attrition → round; Obj 8 re-arms on a missed deadline (with F13); Obj 22 triggers on Obj 21.
- C33 + F10 §11.8: digits are speeds only; toasts answered with `Y`/`N` (`Enter`/`Esc`); palette items `Shift+1–9`; precedence and `preventDefault` stated. F10's remap adopted in full, C33's precedence kept for the residual cases.
- C34 §0.3 rows 35/43 / §4.8: Boardwalk, Fence and the Rookery are the Preserve's explicit exceptions.
- C35 §6.2 Prep / §10.5 #16: Sandbags cover every levee tile on the protected boundary at the panel's test height, cost ceil(n/10) × $10k; Boil attendance = (students × 0.6 + alumni × 0.1) × 1.5 with a Union.
- F8 §0.1 / §9.2 / §14.3 / §12.3: parade is 25 s (250 ticks) and interactive (click a float to throw beads; `beads` timer).
- F9 §8: the halftime toast shows the half score, live win% and the rule; Go for it moves the threshold with the same roll and costs `goForIt` −2 on a loss.
- F11 §4 intro / §4.3 / §4.4 / §4.7 / §3.4 / §12.3: house style (stucco, terracotta hip roof, `arcade` decal) for academic/housing/dining/life rows; Engineering is the brutalist joke; the Mounds on the largest chenier (+1 landmark once reached).
- F12 §13 / §10.1 / §11.8: ambience starts at −12 dB on the charter click, 🔊 lit, remembered in settings; `M` still mutes.
- F13 §10.2 Obj 8: defined together with C32 ("Capped at {students} — beds are the bottleneck", re-arms for Jan 10).
- F14 §6.3 / §14.4 line 4: Le Grand runs through the gator alert chip with click-to-pan; the ticker names the lake.

**Rejected or reshaped (with reasons)**
- C2's suggestion to drop `docs/ARCHITECTURE.md` from README: not taken; the parallel-authoring plan requires that file, so §15.1/§15.4 now specify it instead.
- C30's "Path not placeable on Marsh": reshaped (see above) because the pre-placed Pirogue Landing sits on the bayou and G3's route must end on its Marsh shoulder; the ecology cost is carried by `wetlandLost` instead.
- F1's "halo of 0.5 per neighbor": replaced by a flat ×3 per drained tile, which gives the intended ~−13 for 100 tiles without a geometry pass; the critic's own arithmetic ignored overlapping halos.
- F6's "Spillway drag tool": made a once-a-year Storm-panel action rather than a 44th catalog row, to keep the 43-row cap and the one painter.
- F4/F10 keyboard: toasts use `Y`/`N`, not `1`/`2`, everywhere (§6.2, §11.8), so the digits stay speeds.

*Geaux Bayou.*
