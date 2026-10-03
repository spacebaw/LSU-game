# BAYOU STATE: HIGH WATER
### A Game Design Document — "The Swamp" candidate

*Lens: environmental simulation and survival tension. The swamp is the antagonist. The campus is the answer.*

---

## 1. Title, Tagline, Pitch, Screenshot Moment

**Title:** **Bayou State: High Water**

**Tagline:** *Build a university. The swamp has other plans.*

**Pitch:** You are the founding Chancellor of Bayou State University, a purple-and-gold college charter dropped onto a wedge of Louisiana swampland between a big brown river and a bayou that does not care about your master plan. Every building you place is a bet against water: the ground sinks under it, the summer rains pool around it, the mosquitoes breed in the puddles, the gators wander up out of the channel to see what's for lunch, and every August the Gulf sends a hurricane to grade your levees. You answer with pumps, canals, pilings, boardwalks, live oaks, and a football stadium loud enough to be heard in the next parish. Enrollment climbs, prestige climbs, the river stays the river. The swamp is never beaten. It is only ever managed — and when it wins a round, it does so with a straight face and a gator on the quad. *Laissez les bons temps rouler.*

**The screenshot moment:** Night game. The stadium is a purple-gold bowl of light in the middle of black water. A Category 3 hurricane's outer rain bands are already lashing the campus (the game scheduled the home opener and the storm on the same weekend, because that is Louisiana). Sixty thousand tiny fans are still in the stands. Lightning silhouettes cypress trees on the horizon. The storm surge is a moving line of dark water creeping across the minimap toward your levee. The ticker reads: *"Athletic Director: 'We've played in worse.' Weather Service: 'You have not.'"* Someone leans over the laptop and says "wait — the AI made this?"

---

## 2. Core Loop and Meta Loop

### Minute-to-minute (core loop)

1. **Read the water.** The Flood Risk overlay (hotkey `F`) is the player's primary lens. Blue-tinted tiles are wet, red-edged tiles are one thunderstorm from flooding. Every build decision starts with "where is the water going to go?"
2. **Shape the land.** Dig canals, raise levees, drop a pump, retrofit pilings, lay boardwalk over marsh instead of draining it.
3. **Place a building.** Academic, housing, dining, athletics — each needs a path connection, power, and (for happiness) AC and shade.
4. **Watch the students respond.** Little purple-and-gold agents walk to class, dodge puddles, flee a gator, slap mosquitoes, tailgate. Their mood is legible at a glance.
5. **React to the swamp.** A thunderstorm cell, a gator sighting, a nutria breach in the levee, a heat advisory, a hurricane cone appearing on the minimap. Each is a 20–90 second micro-crisis with a specific counterplay.
6. **Collect the day's numbers.** Money ticks at midnight. Ticker fires 1–3 lines. Repeat.

A full "beat" (place something → watch it get tested → shore it up) takes 60–120 seconds at 1× speed.

### Semester-to-semester (meta loop)

- **Summer (Jun–Aug):** Heat, humidity, mosquito peak, hurricane season opens. Cheap construction (students gone, no disruption penalty). The strategic build window.
- **Fall (Aug–Dec):** Enrollment locks in. Tuition flows. Football season — game days are money and prestige spikes. Hurricane peak (Aug 15–Oct 15) overlaps the season. This is the tension semester.
- **Spring (Jan–May):** Mardi Gras (happiness spike + cleanup cost), crawfish season (dining boost), spring floods on the river (river-side hydrology test), graduation (prestige from graduates). The recovery-and-growth semester.

### Year-to-year

- Enrollment target vs. capacity drives housing expansion.
- Prestige tiers unlock building tiers (Research Institute, Residence Tower, Stadium upgrades, Campanile).
- Subsidence accumulates: what was dry ground in Year 1 is wet ground by Year 6 unless you built on pilings. The map slowly turns against you and forces re-engineering, not just expansion.
- Ecology score shapes which endgame you get: "Fortress Campus" (walled and pumped, expensive, brittle) vs. "Living With Water" (marsh-buffered, cheaper to defend, harder to build big).
- The hurricane draw each year escalates: Year 1 is scripted (Cat 2), Years 2+ roll with increasing odds of a major.

---

## 3. World & Terrain

### Map

- **Size:** 96 × 96 tiles = 9,216 tiles. Isometric 2:1 diamonds, 64 × 32 px at zoom 1.0.
- **Orientation:** North is screen-up. The **Big River** runs along the west edge (columns 0–5) and the **Gulf approach** is the south edge. Hurricane surge enters from the south; river floods enter from the west.

### Tile types (derived from elevation `e ∈ [0,1]` and channel mask)

| Type | Elevation | Base water depth | Buildable? | Notes |
|---|---|---|---|---|
| **Open Water** | `e < 0.18` | permanent | No (bridges only) | Gulf-side lakes, oxbows. Gator spawner. |
| **Bayou Channel** | channel mask | permanent, flowing | No (Bridge only) | Meanders N→S through the map center-east. Drains the whole map; the outlet to the Gulf. |
| **Big River** | columns 0–5 | permanent | No | West edge. Not crossable. Source of spring river floods. |
| **Marsh** | `0.18 ≤ e < 0.34` | 0.15–0.35 | Boardwalk, Cypress, Retention Pond, Levee; buildings only with Pilings or after Draining | Cypress knees, cattails. Highest ecology value. Absorbs surge. Nutria/gator habitat. Mosquito breeder if disturbed. |
| **Wet Ground** | `0.34 ≤ e < 0.50` | 0 (floods first) | Yes, but subsides 2× and floods in ordinary storms | Muddy, dark green. Cheap land that punishes you. |
| **Dry Ground** | `0.50 ≤ e < 0.72` | 0 | Yes | Standard buildable. |
| **High Ground** | `e ≥ 0.72` | 0 | Yes, 0.5× subsidence | The **natural levee ridge**: a band of high ground hugging the Big River (the river built this land). This is where the starting campus sits. Also a few "chenier" ridges (old beach ridges) running E–W. |

### Elevation model

- Each tile stores: `elev` (float, 0–1, mutable — subsidence and levees change it), `waterDepth` (float, meters-ish, 0 = dry), `soilSat` (0–1, saturation; drives runoff vs. absorption), `terrainType` (recomputed from elev + depth when either changes), `channelFlag`.
- Effective surface height for water flow: `h = elev + waterDepth`.
- 1.0 elevation ≈ 6 m above Gulf mean; scale is stylized, not survey-accurate.

### Procedural generation (seeded; seed shown on the title screen so students can share maps)

1. **Base noise:** 3-octave value noise (hand-rolled, ~25 lines), frequency 1/24, 1/12, 1/6, weights 0.6/0.3/0.1. Normalize to [0,1].
2. **Natural levee:** add `0.35 * exp(-((x-6)/9)^2)` for `x ≥ 6` — a ridge that falls off eastward from the river. Add two chenier ridges: `0.18 * exp(-((y - r)/4)^2)` at `r = 30` and `r = 66`, only for `x > 30`.
3. **Southward tilt:** subtract `0.20 * (y/96)` so the map drains toward the Gulf. The south third is mostly marsh.
4. **Bayou channel:** a random walk from `(70, 0)` to `(58, 95)` with 1-tile lateral drift per row, 30% chance per row of a 2-tile meander; width 2 tiles, plus a 1-tile marsh fringe on each side forced to marsh. Channel tiles set `elev = 0.10`.
5. **Oxbow lake:** one `5×4` open-water blob at a random point east of the channel.
6. **Cypress stands:** 6–9 clusters of 8–20 Bald Cypress on marsh tiles. **Live oak groves:** 3–4 clusters of 3–6 oaks on high ground. These are pre-placed "landscaping" entities (see catalog) that already exist and are worth ecology/shade.
7. **Starting parcel:** the game guarantees a `14×10` contiguous region of Dry/High ground around `(18, 40)` (re-roll seed offset if not found). The Main Gate is placed on its west edge on the ridge road.
8. **Ridge Road:** a pre-placed Paved Road from the Main Gate north to the map edge ("to Baton Rouge") — the campus's external connection and the evacuation route.

### What terrain means for building

- **Open Water / Channel / River:** unbuildable. Bridge segments cross the channel only.
- **Marsh:** three legal choices, each a design statement:
  - **Boardwalk** (cheap, walkable, preserves ecology, no subsidence, 1-tile only).
  - **Pilings** variant of any building (+25% cost, allowed on marsh, immune to subsidence, +1 flood tolerance).
  - **Drain it:** a Drainage Canal adjacent + Pump Station in range converts marsh → wet ground after 20 sim days. −3 Ecology per tile, spawns a mosquito bloom for 15 days ("the mud stage"), and the tile subsides at 3× rate forever. Cheap now, expensive later — the real Louisiana story.
- **Wet Ground:** buildable, floods at `waterDepth ≥ 0.15` from a single heavy thunderstorm unless drained or leveed. Subsidence 2×.
- **Dry Ground:** the default. Floods only in surge or multi-day rain.
- **High Ground:** the safe ridge. Limited quantity (~9% of the map). Running out of ridge is the mid-game pressure that pushes you into the swamp.
- **Slope rule:** buildings need all footprint tiles within `0.06` elev of each other; otherwise "Grade site" is required ($1,500/tile, sets tiles to the footprint mean).
- **Road/path access:** every building needs a road, path, or boardwalk on at least one edge tile, connected to the Main Gate network. Unconnected buildings show a red "No Access" icon and produce nothing.

---

## 4. Building Catalog

All buildings: footprint in tiles (W×H), cost, upkeep per sim day, effects, unlock, visual note. "Pilings" adds +25% cost and is available for any building marked `[P]`. "Flood tol." = waterDepth a building tolerates before it counts as flooded (0.10 default; pilings +0.25; second-story buildings +0.15).

Money is shown as `$`. Upkeep is per sim day. Power draw (`⚡`) is in units; a Substation supplies 40.

### Paths & Roads

| # | Name | Size | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 1 | **Gravel Path** | 1×1 | $200 | $1 | Walkable, access. Floods at 0.10 (becomes impassable). | Start | Tan speckled diamond with darker edge. |
| 2 | **Paved Road** | 1×1 | $600 | $2 | Walkable + vehicle. Impervious: +0.15 runoff to neighbors. Flood 0.20. Autotiles (straight/corner/T/cross). | Start | Dark gray asphalt, yellow center dash, autotile. |
| 3 | **Boardwalk** | 1×1 | $900 | $3 | Walkable on marsh/wet with no draining. Immune to subsidence & flooding ≤ 0.6. +1 Ecology per 5 tiles (it's the eco path). Students love it (+1 mood while walking). | Start | Weathered gray-brown planks on stubby pilings, water visible beneath. |
| 4 | **Bridge Span** | 1×1 | $3,000 | $8 | Crosses Bayou Channel/Open Water. Vehicle + walk. Wind damage vulnerable (Cat 3+: 20% chance out for 5 days). | Start | Steel truss, purple-painted, gold railing. |

### Utilities

| # | Name | Size | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 5 | **Power Substation** [P] | 2×2 | $40,000 | $120 | Supplies ⚡40 to buildings within 18 tiles (road-connected). Floods at 0.10 → **blackout** for its whole service area until dried. The single most important pilings retrofit in the game. | Start | Gray fenced box, transformer coils, red warning light blinking at night. |
| 6 | **Central Plant** [P] | 2×2 | $120,000 | $300 | Chilled water/AC to buildings within 14 tiles. Removes Heat penalty for those buildings. ⚡8. | 400 students | Beige box, three big rooftop fans that spin, steam wisp. |
| 7 | **Water Tower** | 1×1 | $60,000 | $60 | Required for dorms > 2 and any Dining. Serves whole map. Tall = wind vulnerable (Cat 4+: 30% chance topples, $30k repair). | Start | Tall gold-painted tank with purple "BSU" letters. Visible from anywhere; a landmark. |
| 8 | **Parking Lot** | 2×2 | $25,000 | $20 | +80 commuter capacity. Impervious: +0.30 runoff to downhill neighbors. Parking ticket revenue $40/day per 100 commuters. Tailgate zone on game day. | Start | Gray asphalt, white stripes, 6–10 tiny cars in purple/gold/white. |
| 9 | **Parking Garage** [P] | 2×2 | $250,000 | $90 | +320 commuter capacity, no runoff penalty (drains to internal sump). ⚡4. Doubles as **hurricane shelter** (upper decks; holds 800 students). | 1,500 students | Three-story concrete stack with ramps, lit at night. |

### Swamp Infrastructure

| # | Name | Size | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 10 | **Drainage Canal** | 1×1 | $1,500 | $4 | Conductivity 5× base. Pulls `waterDepth` from 4 orthogonal neighbors each hydro tick; carries it along connected canal tiles to a Pump, Retention Pond, or the Bayou Channel. Autotiles. Walkable? No (students detour; add a Gravel Path "culvert" crossing: canal + path on same tile allowed, $400). Breeds mosquitoes if stagnant (no outlet). | Start | Narrow dark-water ditch with concrete lips; ripple animation. |
| 11 | **Earthen Levee** | 1×1 | $4,000 | $10 | `elev += 0.30` for flow purposes (a wall). Integrity 100; loses 1/day per adjacent nutria, 5/day when overtopped, 15 per Cat of surge contact. Below 30 integrity: **breach** (becomes wet ground with 0.5 depth). Autotiles. Walkable on top (students jog it). | Start | Grassy green berm with a worn dirt path on the crest; autotile. |
| 12 | **Concrete Floodwall** | 1×1 | $12,000 | $15 | `elev += 0.55`. Integrity 100, immune to nutria, −10 per Cat of surge contact. Blocks line of sight (students hate walls: −1 mood within 3 tiles unless a Live Oak is adjacent). Requires Engineering Institute research "Floodwall". | Research | Gray concrete T-wall with purple stripe and gold "BSU" stencil every 4 tiles. |
| 13 | **Pump Station** [P] | 2×2 | $90,000 | $200 + $4 per 0.1 depth pumped | Removes 0.08 depth/hydro tick from every tile in radius 10 (radius 16 if connected to a canal network; pumps the whole network). ⚡12. **No power = no pumping.** Accelerates subsidence 1.5× within radius (real-world drainage subsidence). | Start | Brick building with three big green outlet pipes discharging into a canal, water arc animation when active. |
| 14 | **Retention Pond** | 2×2 | $30,000 | $25 | Holds 4.0 depth-units of water from connected canals before overflowing; drains 0.02/tick naturally. +2 Ecology if stocked (auto after 30 days: "mosquito fish"). Mosquito **sink** (−30% density within 6 tiles) when stocked; **source** when it's under 30 days old. Students picnic on its banks (+mood). | Start | Kidney-shaped pond, reeds, a bench, a wood duck. |
| 15 | **Pilings Retrofit** | upgrade | +25% of building cost | +5% upkeep | Raises an existing building: immune to subsidence, +0.25 flood tolerance, allowed on marsh. Construction takes 6 days during which the building is closed. | Start | Building sprite drawn 8 px higher over visible cypress-post stilts; shadow gap. |
| 16 | **Gator Fence** | 1×1 | $800 | $2 | Impassable to gators & nutria; passable to students (gate). Autotiles. Integrity 100, −20 per gator contact of size > 3 m. | Start | Chain-link with gold caps; a "CAUTION: GATORS" sign every 5 tiles. |
| 17 | **Mosquito Abatement Station** | 1×1 | $20,000 | $80 + $150 per fogging | Auto-fogs radius 12 when local density > 40 (max once/3 days). Fogging: −60% density instantly, −4 Ecology per fog. Unlocks manual "Fog Now" button. | Start | Small shed with a white fogging truck parked outside; truck drives a short loop and emits a white cloud when fogging. |
| 18 | **Wildlife & Fisheries Office** | 2×2 | $75,000 | $180 | Spawns 2 Wildlife Officers (agents) who respond to gator sightings within 30 tiles, relocating gators (60 s job) instead of letting them wander. Enables **Nutria Bounty** policy ($5/nutria, culls 50%/season). +3 Ecology (they manage, not exterminate). | 300 students | Green metal building, airboat parked on a trailer, purple stripe. |
| 19 | **Weather Station** | 2×2 | $150,000 | $150 | Hurricane forecast cone appears 5 days out instead of 3, cone width −40%. Unlocks **Evacuation Order** and **Sandbag Drive** actions. Predicts thunderstorm cells 1 day out (shown on minimap). | 600 students | White dome radar on a lattice tower, dish rotates. |
| 20 | **Cypress Restoration Plot** | 2×2 | $12,000 | $10 | Plant 4 Bald Cypress on marsh at once. +8 Ecology. After 60 days, marsh tiles in radius 3 reduce surge depth by 0.05 each (stacking to 0.30 max per path). Fireflies at night. | Start | Four young cypress with knees; grows through 3 sprite stages over 60 days. |

### Academic

| # | Name | Size | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 21 | **Lecture Hall** [P] | 2×2 | $150,000 | $250 | +250 class seats. +1 Prestige/semester if staffed (auto). ⚡5. | Start | Two-story red brick with white columns, purple door, gold "BSU" over the entrance. |
| 22 | **Science Lab** [P] | 2×2 | $300,000 | $500 | +150 seats. Research +$300/day. +2 Prestige/semester. Flooding destroys equipment: $80k repair. ⚡10. | 500 students | Glass-front modern box, green roof, fume hood stacks. |
| 23 | **Library** [P] | 3×3 | $500,000 | $600 | +5 Prestige (one-time) +1/semester. +5 happiness radius 12. Study spot (agents "study"). Basement floods first (flood tol. 0.05 unless pilings): $120k damage. ⚡8. | 800 students | Big limestone block with a colonnade, tall arched windows glowing gold at night, clock over the door. |
| 24 | **Coastal Engineering Institute** [P] | 3×3 | $900,000 | $1,200 | **Research tree** (see §6.9): Floodwall, Smart Pumps, Living Shoreline, Subsidence Survey, Storm Hardening. Research +$800/day. +6 Prestige. ⚡14. | 1,500 students, Prestige 30 | Angular steel-and-glass building on visible pilings, wave-tank annex, purple LED strip. |
| 25 | **Ag & Sugar Research Center** [P] | 3×3 | $600,000 | $700 | State funding +15%. Research +$500/day. Sugarcane plots on adjacent wet tiles (cosmetic, +mood). +3 Prestige. | 1,000 students | Barn-red metal building, silo, sugarcane rows, tractor. |
| 26 | **Fine Arts & Music Hall** [P] | 2×2 | $350,000 | $450 | +120 seats. +8 happiness radius 10. Unlocks Zydeco Night event (spring). +2 Prestige. | 700 students | Cream stucco with a copper-green roof, poster kiosk, a brass horn silhouette on the sign. |

### Housing

| # | Name | Size | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 27 | **Dormitory** [P] | 2×2 | $250,000 | $300 | 200 beds. Ground floor floods (residents evacuate to shelter; −10 happiness campus-wide per flooded dorm). ⚡6. | Start | Three-story brick, purple awnings, AC units, laundry on a line (comic). |
| 28 | **Residence Tower** [P] | 2×2 | $700,000 | $700 | 600 beds. Flood tol. 0.25 (elevated lobby). Wind vulnerable Cat 4+ (windows: $60k). ⚡14. | 1,200 students | Ten-story slab, purple spandrel, gold rooftop sign, lit windows random-pattern at night. |
| 29 | **Greek Row House** [P] | 1×2 | $120,000 | $150 | 60 beds. +3 happiness radius 8. +1 party event/month (noise: −1 happiness to academic buildings within 4). Tailgate multiplier ×1.3 within 10 tiles of stadium. | 400 students | White antebellum-ish house with columns and gold Greek letters (fictional: ΒΣΥ). |
| 30 | **Off-Campus Shuttle Stop** | 1×1 | $15,000 | $40 | +120 commuter capacity. Must be on road. | Start | Purple bus shelter with a gold bench; tiny bus arrives every 2 days. |

### Dining

| # | Name | Size | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 31 | **Dining Hall** [P] | 2×2 | $220,000 | $350 | Feeds 800. Required within 20 tiles of every dorm (else −5 happiness). Gator attractor (grease dumpster): +2 gator interest. ⚡8. Needs Water Tower. | Start | Long brick hall, big windows, rooftop vents, dumpster out back. |
| 32 | **Crawfish Shack** | 1×1 | $35,000 | $60 | Feeds 150. +6 happiness radius 8 in Crawfish Season (Feb–May), +2 otherwise. Revenue $120/day. Game day ×3. **Gator magnet** (+4 interest). | Start | Red tin-roof shack, propane burner, steam, a hand-painted "BOIL TODAY" sign. |
| 33 | **Coffee & Beignet Kiosk** | 1×1 | $18,000 | $30 | +3 happiness radius 6. Revenue $80/day. Study buff for Library within 6 tiles (+1 Prestige/yr). | Start | Green-and-white striped awning, powdered-sugar cloud puff when a student buys. |

### Athletics

| # | Name | Size | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 34 | **Stadium — Tier 1 "Cypress Bowl"** | 5×5 | $1,200,000 | $900 | 25,000 seats. Enables football season. Game day revenue (see §8). Doubles as **hurricane shelter** (upper concourse, 5,000). ⚡20. Upgrades in place to Tier 2 ($2.5M, 60k seats, "Thunder Bowl") and Tier 3 ($5M, 100k, "The Cauldron"). | 600 students | Tier 1: single-deck oval, purple seats, gold end zones, light poles. Tier 2: second deck, video board. Tier 3: full bowl, upper deck ring, "GEAUX" in gold on the seats, night-game light bloom visible from the whole map. |
| 35 | **Practice Field** | 3×3 | $80,000 | $100 | +5% win probability. Floods easily (wet field: −5% until dry). | Stadium | Green turf, hash marks, blocking sled, a lone kicker. |
| 36 | **Recreation Center** [P] | 2×2 | $280,000 | $350 | +8 happiness radius 10. Heat refuge (removes Heat penalty for agents within 8). Pool (mosquito-proof, chlorinated). ⚡10. | 500 students | Glass-front, purple roof, outdoor pool with a tiger stripe lane line. |

### Student Life & Services

| # | Name | Size | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 37 | **Student Union** [P] | 3×3 | $450,000 | $500 | +10 happiness radius 14. Feeds 400. Hosts Mardi Gras ball and Homecoming. Hurricane shelter (2,000). ⚡12. | 300 students | Wide brick building, gold clock face, big steps students sit on, flag poles (purple & gold). |
| 38 | **Health Center** [P] | 2×2 | $180,000 | $280 | Halves sick-day loss from mosquitoes and heat within 20 tiles. Required for enrollment > 2,000. ⚡6. | 800 students | White box, red cross, ambulance bay. |
| 39 | **Campus Police & Emergency Ops** | 1×1 | $60,000 | $120 | Reduces party noise penalties; coordinates evacuation (−50% evacuation time). Spawns 1 patrol cart that escorts stragglers during storms. | 300 students | Small brick station, blue light, golf-cart cruiser. |
| 40 | **Quad Stage / Amphitheater** | 2×2 | $90,000 | $50 | +4 happiness radius 10. Festival venue (Zydeco Night, Homecoming concert). Sits in a bowl: floods first, drains last (comic: "Amphitheater is now a pond"). | Start | Grass bowl with a wooden bandshell, purple curtain, string lights at night. |

### Landscaping

| # | Name | Size | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 41 | **Live Oak** | 1×1 | $2,000 | $0 | Shade: removes Heat penalty within radius 2. +2 happiness radius 4. +2 Ecology. Absorbs 0.02 depth/tick (roots). Grows over 90 days (3 stages). Cat 4+ may drop a limb ($2k). Spanish moss sways. | Start | Fat dark trunk, huge spreading canopy of dark green, gray-green moss strands hanging. Largest tree sprite in the game. |
| 42 | **Bald Cypress** | 1×1 | $1,500 | $0 | Plantable on marsh/wet/water edge. +3 Ecology. Surge reducer (see Cypress Plot). Turns rust-orange in Nov–Dec. | Start | Tall narrow conical tree, feathery foliage, buttressed base, cypress knees poking from water. |
| 43 | **Azalea Bed** | 1×1 | $500 | $0 | +1 happiness radius 3. Blooms Mar–Apr (pink/white/purple burst; +1 more). | Start | Low rounded shrub cluster; green most of the year, explodes into pink and purple in spring. |
| 44 | **Magnolia** | 1×1 | $1,200 | $0 | +1 happiness radius 3, shade radius 1. Big white blooms May–June. | Start | Glossy dark-green dome, saucer-sized white flowers. |
| 45 | **Quad Fountain** | 1×1 | $25,000 | $15 | +3 happiness radius 6. Chlorinated: no mosquitoes. Students throw coins ($5/day). Freezes 1 day/year (comic). | Start | Round stone basin, gold tiger statue center, water arc animation. |

### Prestige Landmarks

| # | Name | Size | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 46 | **The Campanile** [P] | 2×2 | $1,500,000 | $400 | +15 Prestige. +5 happiness map-wide. Bells ring at noon and after wins (audio). Visible everywhere. | Prestige 40 | Tall square limestone bell tower, purple-lit at night, gold clock faces, tiger weathervane. |
| 47 | **Tiger Habitat** | 2×2 | $600,000 | $250 | Mascot "Roux" lives here. +8 Prestige. +5 happiness radius 15. Game-day parade route (Roux in a cage on a trailer). If it floods: **"ROUX IS LOOSE"** event (harmless, hilarious, −0 happiness, +50 ticker lines). | Prestige 25 | Glass-and-rock enclosure, waterfall, a live oak inside, orange-and-black tiger sprite lounging. |
| 48 | **Memorial Oak Allée** | 1×6 | $60,000 | $0 | A double row of oaks. +4 Prestige, +3 happiness radius 6, shade for the whole strip. | Prestige 15 | Six oaks in a line with a brick walk between; moss; gold lamp posts. |
| 49 | **Riverboat Landing** | 2×2 | $400,000 | $200 | On Big River bank only. Donations +10%. Alumni riverboat docks on Homecoming (+$150k event). +4 Prestige. | Prestige 20 | Wooden wharf, a white paddlewheel steamboat with purple trim moored on Homecoming. |

**Count: 49 placeables/upgrades** (the brief asked for 25–40; the extra 9 are the ones to cut first — see §15).

---

## 5. Economy

### Starting state

- **Cash:** $2,500,000 (a state charter grant).
- **Students:** 0 (enrollment opens after onboarding; first cohort 240).
- **Prestige:** 10 / 100.
- **Happiness:** 60 / 100 (campus-wide average; per-agent values vary).
- **Ecology:** computed from the map, typically 55–70 at start.
- **Tuition:** $9,000 per student per semester (slider $3,000–$20,000, step $500).
- **Date:** July 15, Year 1. Hurricane season is already open.

### Money sources (per sim day unless noted)

| Source | Formula | Notes |
|---|---|---|
| **Tuition** | `students × tuition / 120` per day during Fall & Spring (120-day semesters). Zero in summer. | Paid daily for smoothness; the UI shows the semester total on the enrollment screen. |
| **State Funding** | `$4,000/day × (0.5 + prestige/100) × (1 + 0.15 if Ag Center)`. | The legislature notices prestige. Drops 25% for a year after a "campus underwater" headline. |
| **Donations** | `$1,500/day × (prestige/20) × (1 + 0.02 × winsThisSeason) × (1 + 0.10 if Riverboat Landing)` | Alumni give when the team wins. |
| **Research** | Sum of building research values (Lab $300, Institute $800, Ag $500). ×1.5 if Ecology ≥ 70 ("Wetlands Foundation grant"). | The eco reward. |
| **Athletics** | Game-day ticket + concession revenue (see §8). Bowl payout. | Lumpy, big. |
| **Dining/Retail** | Crawfish Shack, Kiosk, fountain coins, parking tickets. | Small, cute. |
| **Disaster relief** | After a hurricane: State Emergency Relief grant = `min($800k, 40% × damage)` arriving 20 days after landfall. | Never covers it. Sets up "rebuild smarter" decisions. |

### Costs

- **Construction:** catalog cost, paid up front. Build time 3–15 days (footprint area × 1.5 days). Scaffolding sprite during build.
- **Upkeep:** catalog, per day. Flooded buildings still cost upkeep (the comedy of bureaucracy).
- **Salaries:** `$12/day × students` (faculty & staff scale with enrollment). Shown as one line.
- **Utilities:** `$3/day × ⚡ units drawn`.
- **Disaster repair:** flooded building = 15% of its cost to repair (auto-queued, 5 days); wind damage per §6.2; levee breach $2,000/tile; debris clearing $300/tile.
- **Mosquito/heat sick days:** not cash — they reduce effective students for tuition by `sickFraction` (see §6.4).
- **Loans:** one Board of Regents line of credit, $1,000,000 at 1%/month simple interest, available once cash < $0. Second bankruptcy = failure state (§10).

### Enrollment model

Computed at the **enrollment lock** (Aug 15 and Jan 10):

```
capacityBeds      = Σ dorm beds
capacityCommute   = Σ parking + shuttle capacity
capacitySeats     = Σ class seats
capacity          = min(capacityBeds + capacityCommute, capacitySeats)

tuitionFactor     = clamp(1.6 - tuition / 15000, 0.25, 1.4)      // $9k → 1.0
applicants        = (200 + prestige × 45 + max(0, happiness - 50) × 12) × tuitionFactor
                    × (1 + 0.05 × winsLastSeason) × (1 - 0.30 if lastYearFloodedHeadline)

newStudents       = min(applicants, capacity - currentStudents + graduatingCohort)
students          = max(0, students - graduating + newStudents)
```

- Each student graduates after 8 semesters (tracked as 8 cohort buckets). Graduates: +0.02 Prestige each (rounded per semester).
- If `students > capacity` (you lost a dorm to flood), the excess "commutes from Baton Rouge" with −15 happiness until fixed.

### Prestige model (0–100)

- Semester tick: `+Σ building prestige/semester` (Lecture +1, Lab +2, Library +1…), `+graduates × 0.02`, `+football`, `+research grants ($100k research = +1)`.
- Instant: landmarks, milestones, bowl win (+5), rivalry win (+3), a Cat 4 survived with < 10% damage (+4, "The campus that held").
- Decay: `−1/semester` flat (reputations fade), `−0.5` per flooded academic building, `−3` for a "campus underwater" headline, `−2` for a student gator injury (rare, see §6.3), `−1` per blackout longer than 3 days.
- Clamp 0–100. Prestige gates unlocks and multiplies state money, donations and applicants.

### Happiness model (0–100, campus average of agent moods)

Each agent's mood (see §7) is a sum; campus happiness is the mean of visible agents, blended 50/50 with an abstract term computed from buildings so that it doesn't jitter:

```
abstractHappiness = 50
  + Σ (building happiness auras covering the average student)        // capped +25
  + (dining coverage ? 0 : -10) + (health coverage ? 0 : -5)
  - heatPenalty (0..15) - mosquitoPenalty (0..20) - floodPenalty (0..25)
  - overcrowding (students > capacity ? 15 : 0)
  + seasonBonus (Mardi Gras +10 for 5 days, crawfish +3, home win +6 for 3 days, home loss -4)
  - tuitionGrumble (max(0, tuition - 9000) / 1000)
```

### Key feedback loops (explicit)

1. **Prestige → applicants → tuition money → buildings → prestige.** The growth spiral. Bounded by capacity (housing/seats), which costs land, which costs swamp engineering.
2. **Draining marsh → cheap land now → subsidence + mosquito bloom + lost surge buffer → bigger levees and pumps later → pumping accelerates subsidence.** The Louisiana loop. Always solvable, never free.
3. **Pumps need power → substation floods → pumps stop → more flooding.** The cascade. Counterplay: pilings on the substation (the tutorial teaches this explicitly at the first flood).
4. **Winning football → donations + applicants → stadium upgrade → bigger crowds → more tailgate trash → gators.** Yes, really.
5. **Happiness → applicants; flooding → happiness.** Every swamp failure is also an enrollment failure next cycle, so hydrology is never a side quest.
6. **Ecology → research grants + surge reduction + fewer mosquitoes (predators) → cheaper defense.** The alternative path.

---

## 6. Swamp Survival Systems

Every system below states: **the rule, the threat, the tell (how the player sees it coming), the counterplay, and the comedy.**

### 6.1 Hydrology

**State per tile:** `elev`, `waterDepth`, `soilSat`, `conductivity` (base 1.0; canal 5.0; road/parking 0.2 sideways but +runoff; levee/floodwall = wall).

**Inputs**

- **Rain.** Weather generates rain intensity `R` (0–1) per hour across the map, with thunderstorm *cells*: circular radius-14 blobs of `R = 0.8–1.0` that drift NE at 1 tile/min in summer afternoons (50% of summer days have a cell 2–5 pm). Rain adds `waterDepth += R × 0.015 × (1 - absorb)` per hydro tick, where `absorb = (1 - soilSat) × 0.6` on natural ground, 0.1 on impervious (road/parking/building), 0.9 on marsh/cypress/retention pond. `soilSat` rises with rain (`+R × 0.02/tick`), falls 0.01/tick when dry, faster in heat.
- **River stage.** Spring (Mar–May) the Big River rises: `riverStage = 0.15 + 0.25 × seasonalCurve + 0.10 × yearNoise`. Tiles in columns 6–12 with `elev < riverStage + 0.20` receive seepage `+0.01/tick`. A "high river" year (`yearNoise > 0.07`, ~30%) adds a **river overtop** of the natural levee for 10 days unless the player's levees along the west run are intact.
- **Storm surge.** See §6.2. Enters from the south edge as a moving front.

**Flow (hydro tick = every 500 ms sim time at 1×, i.e. 12 ticks per sim day)**

Cellular automaton, 4-neighbor:

```
for each tile with waterDepth > 0.01:
  h = elev + waterDepth
  for each neighbor n (skip if wall between; levee/floodwall counts as elev += 0.30/0.55):
    hn = n.elev + n.waterDepth
    if h > hn:
      flow = min(waterDepth, (h - hn) × 0.25 × avgConductivity(tile, n))
      transfer flow
```

Two Jacobi passes per tick (write to a back-buffer) keep it stable. 9,216 tiles × 4 neighbors × 2 passes = ~74k ops per tick, trivial. Only tiles in the "active set" (depth > 0.01 or received flow last tick) are iterated; in dry weather the active set is ~5% of the map.

**Outlets:** Bayou Channel and Open Water tiles clamp `waterDepth` to their base depth (they are infinite sinks unless surge is active, in which case they are infinite *sources* at surge height). Retention Ponds are finite sinks. Pumps move water from the ground to the nearest outlet in one step (no routing needed: pumped water simply disappears, $ per unit charged).

**Flooding thresholds**

- Tile "wet" at depth ≥ 0.05 (puddles drawn, agents slow 30%, mosquito breeding starts a 2-day timer).
- Path impassable at 0.10; road at 0.20; boardwalk 0.60.
- Building "flooded" at depth ≥ its flood tolerance (0.10 default). Effects: closed (no seats/beds/service), upkeep continues, repair bill queued when it dries, occupants evacuate to nearest shelter or off-map.
- Substation flooded → blackout of its service area (pumps and AC and lights off). This is the key cascade and the tutorial's second lesson.

**Drainage designs the player can discover**

- Ring canal around a building cluster → pump → channel: the "polder".
- Retention pond at the low corner of a parking lot: the "cheap fix."
- Boardwalks and pilings in marsh: "live with water."
- Live oaks and cypress everywhere: green infrastructure, small per tree, large in aggregate.

**Tells:** Flood Risk overlay (`F`) colors each tile by `predictedDepth after 1 hour of R=1 rain` — computed cheaply by running 12 hydro ticks on a scratch copy once every 5 sim days or when terrain/buildings change, cached. Weather Station adds a "storm cell in 1 day" marker.

**Comedy:** "Amphitheater is now a pond. Rowing club has petitioned to keep it." Students in puddles do a little splash animation; a few pull out inflatable tubes when depth > 0.3 ("Floatilla on the Quad").

### 6.2 Hurricane Season

**Window:** June 1 – November 30. **Peak:** August 15 – October 15 (75% of storms).

**Generation.** Each season the game rolls storms:

- **Year 1: scripted.** Exactly one storm, **Hurricane Clotilde**, Category 2 at landfall, forecast appears on sim day 68 (Sept 21), landfall day 73. In real time that's ≈ minute 13–16 at 1× including a typical onboarding pause. Its track is fixed to hit the south-center of the map so the tutorial can point at it.
- **Year 2+:** `nStorms = 1 + (rand < 0.5 ? 1 : 0) + (rand < 0.2 ? 1 : 0)`. Category: `P(1)=0.30, P(2)=0.30, P(3)=0.22, P(4)=0.13, P(5)=0.05`, shifted +1 category step in probability weight each year after Year 4 to keep endgame spicy (cap at Cat 5). 25% of storms are **near misses** (track passes 20+ tiles east or west of map center: only rain bands and Cat-1 wind).

**Forecast cone.** Appears 3 days before landfall (5 with Weather Station). Drawn on the minimap and main map as a translucent purple cone from the south edge, apex at the predicted landfall column ± width (width 24 tiles base, 14 with Weather Station), narrowing daily. Ticker names the storm and category. Category may change ±1 up to 24 hours before landfall ("Clotilde rapidly intensifies").

**Landfall sequence (the set piece; ~90 seconds real time at 1×; time cannot be sped past 2× during landfall)**

| Phase | Sim hours | What happens |
|---|---|---|
| Outer bands | −18 to −6 | Sky darkens, rain R = 0.5 in bands that sweep NE, wind particles begin, palms/moss lean. Ticker: evacuation status. |
| Wall arrives | −6 to 0 | R = 1.0 map-wide, lightning every 8–15 s with screen flash, wind gusts shake the camera (amplitude by category), power lines spark. **Storm surge front** starts moving north from the south edge at 1 tile per 20 s. |
| Landfall | 0 | Surge peak. Sound: low roar (if audio on). Every building rolls wind damage. Screen shake peak. |
| Eye (Cat 3+) | 0 to +2 | Rain stops, sky lightens to a sickly yellow, wind particles stop. Students who left shelter get caught in the back half (−mood, ticker joke). |
| Back half | +2 to +10 | Bands from the SW, surge recedes 1 tile per 15 s, wind damage second roll at half strength. |
| Aftermath | +10 to +72 | Debris tiles, standing water, blackout until substations dry, mosquito bloom begins day +3. Relief grant at day +20. |

**Storm surge.** Surge height by category: `Cat1 0.20, Cat2 0.35, Cat3 0.55, Cat4 0.80, Cat5 1.10` (depth units above open-water base). Implemented as: the south-edge tiles and all Open Water/Channel tiles become sources at `surgeHeight` for the duration; the hydro CA does the rest, so levees, marsh absorption, and elevation all matter naturally. **Marsh/cypress attenuation:** each marsh tile the surge front crosses subtracts 0.01 from the front height (max 0.30) — a wide preserved marsh belt south of campus is worth a Cat step. Levees hold until integrity fails (§4 #11). Overtopped levees take damage 5/tick.

**Wind damage.** Per building, at landfall and again at +2h (half strength):

```
p(damage) = clamp((cat - 1) × 0.12 + heightBonus - hardening, 0, 0.85)
  heightBonus: Water Tower/Res Tower/Campanile/Stadium light poles +0.15
  hardening: Storm Hardening research -0.25; Live Oak adjacent -0.05 (windbreak; oaks are tough)
if damaged: cost = building.cost × (0.05 + 0.06 × cat) ; building closed for 3 + 2×cat days
Bridges: Cat3+ 20% out for 5 days. Trees: Cat4+ 15% chance a Live Oak drops a limb ($2k); 30% chance a young cypress is lost.
```

**Power.** Cat 2+: every substation rolls `p(outage) = 0.15 × cat` independent of flooding; outage 2 + cat days.

**Counterplay**

- **Before:** Evacuation Order (Weather Station, or Campus Police): sends 90% of students off-map along Ridge Road over 24 sim hours; no student mood loss from the storm, but −$40k in buses and a week of lost tuition days. Without it, students shelter in the Stadium / Union / Garage (capacity!) — students with no shelter slot take −25 mood and 2% "transfer out" per uncovered 100.
- **Sandbag Drive** (Weather Station): +0.10 to all levees for 5 days, costs $15k and 1 day of student labor (+3 mood, "we did a thing").
- **Levee/floodwall lines** with the surge direction in mind (south first, then the channel banks — the channel carries surge *into* the campus interior; this is the trap the tutorial hints at and the second storm punishes).
- **Pilings** on the substation, dining hall, and dorms.
- **Preserved marsh** belt (ecology path).
- **After:** Repair queue UI with a "Rebuild on pilings?" toggle per building (+25% cost).

**Comedy:** Storm names alternate Cajun/Creole and food: Adélaïde, Boudin, Clotilde, Delacroix, Étienne, Fifolet, Gaspard, Hortense, Isidore, Josephine, Kingcake, Lafitte, Mirliton, Napoléon, Odile, Praline, Quenelle, Remy, Satsuma, Thibodaux, Ulysse, Véronique. Ticker: *"Hurricane Praline downgraded to 'a mess.'"*

### 6.3 Gators

**Population.** Base carrying capacity `K = 4 + (marshTiles + waterTiles) / 120`, typically 8–14. Spawn at Open Water/Channel tiles at night; new gator every 12 days while population < K. Two sizes: **juvenile** (1.5 m, harmless, curious) 60% and **big** (3–4 m, the problem) 40%. A named **legendary** gator, **"Old Boudreaux"** (5 m), spawns once per year in the oxbow.

**Behavior (state machine, evaluated every 2 s of sim time per gator)**

- `BASK`: on a water-edge tile, sunny, 8 am–2 pm. 70% of daytime.
- `WANDER`: random walk on water/marsh/wet tiles; will cross wet paths and flooded ground (**flooding extends gator range into campus** — this is the point).
- `ATTRACTED`: if a Dining Hall (+2), Crawfish Shack (+4), Parking Lot tailgate (+6 on game day), or trash (post-Mardi Gras, +5) is within 20 tiles by wet/land path, walk toward it at 0.5 tile/s. Gators can cross dry ground for up to 12 tiles.
- `LOUNGE`: arrive at attractor, lie there 4–8 hours. Students within 4 tiles enter `FLEE` (see §7). Buildings within 2 tiles are "gator-closed" (no service) until it leaves. Ticker fires.
- `RETREAT`: after lounging, or when a Wildlife Officer arrives (relocation: officer walks to gator, 60 s "wrangle" animation with a pole and tape, gator carried off on a cart to the oxbow).
- `NUTRIA HUNT`: if a nutria is within 6 tiles, chase and eat it (removes a nutria; +1 Ecology, "the system works").

**Danger.** Gators do not attack students by default (they're lazy; the affection rule). Exception: a big gator lounging at a Crawfish Shack on game day with a Greek Row within 8 tiles has a 2% chance per hour of the "Chad Tried To Pet It" event: one student injured (recovers), −2 Prestige, a national-news ticker line, and a new **milestone** (see §10). It's the one genuinely bad gator outcome and it's telegraphed by a "student approaching gator" icon for 10 s first so the player can click "Shoo!" ($0, works 80%).

**Counterplay**

- **Gator Fence** lines along the channel and water edges (and around the Crawfish Shack).
- **Wildlife & Fisheries Office**: officers relocate in ~1 min; without it a gator lounges 4–8 hours.
- **Keep the campus dry**: gators only get deep into campus over flooded ground.
- **Dumpster upgrade** (a $5k "Gator-Proof Dumpsters" policy toggle, unlocked at first gator sighting): halves Dining attraction.
- **Never** a "kill gator" option. This is a purple-and-gold game.

**Comedy:** Gator sunbathing on the practice field with the kicker practicing around it. Old Boudreaux ticker: *"Old Boudreaux spotted at the Union. Ordered nothing. Left a review."* Inspect panel on a gator shows a name (from the name generator) and a mood: "Unbothered."

### 6.4 Mosquitoes

**Field.** `mosq[tile] ∈ [0, 100]`, updated once per sim hour on a 48×48 half-resolution grid (2,304 cells) and bilinearly sampled — it's a smooth cloud, not a per-tile entity.

**Breeding sources per hour (added to the cell):**

- Standing water: any tile wet (depth ≥ 0.05) for ≥ 2 consecutive days: +3/hr. Flooded ground after a hurricane is the big bloom.
- Undisturbed marsh: +0.5/hr (natural baseline, largely eaten by predators — see below).
- Freshly drained marsh (< 15 days): +4/hr.
- Stagnant canal (canal network with no outlet): +2/hr per tile.
- Unstocked retention pond (< 30 days): +3/hr.

**Sinks per hour:**

- Diffusion to neighbors 15%/hr, decay 4%/hr baseline; 10%/hr in heat > 95 °F (they burn out, small mercy); 20%/hr in winter (Dec–Feb, near-zero mosquitoes).
- Stocked Retention Pond: −30% within 6 tiles.
- Cypress/marsh with Ecology ≥ 60: −2/hr (dragonflies, frogs, bats: shown as a firefly/dragonfly particle at dusk).
- Abatement fog: −60% instantly in radius 12.
- Wind (storm days): −50%.

**Effects.** For each agent, local `mosq` at their tile:

- `> 30`: swat animation every few seconds, −0.2 mood/hr.
- `> 60`: −0.6 mood/hr, sickFraction contribution: `students × 0.5% per day` become sick (abstract), reducing tuition-earning and class attendance; Health Center halves it.
- `> 80` map-average: **"Mosquito Emergency"** event, −10 campus happiness for the duration, ticker, and applicants −10% next cycle.

**Counterplay:** drain standing water (canals + pumps), stock ponds, keep canals flowing to an outlet, Abatement Station fogging (eco cost), Health Center, the ecology path (predators), and Central Plant/Rec Center refuges (indoors is mosquito-free). Screens on dorms: a $10k policy, −1 mood loss.

**Comedy:** Mosquito overlay is a pulsing purple haze; the legend reads "Ambient / Annoying / Biblical / State Bird." Ticker: *"Mosquito the size of a Cessna spotted near the Library. Library denies it."*

### 6.5 Subsidence

**Rule.** Each sim day, every tile with a building or road subsides:

```
rate = 0.00006 per day base                      // ≈ 0.022 elev/year ≈ one terrain class per 7–8 years
      × 2.0 if Wet Ground origin, × 3.0 if drained-marsh origin, × 0.5 on High Ground
      × 1.5 if within a Pump Station radius (dewatering compaction)
      × 0 if Pilings
elev -= rate
```

Open ground doesn't subside (it's not loaded). Roads do (they crack: sprite variant at −0.05). Terrain type is recomputed, so a Dry tile under a dorm becomes Wet after ~8 years, and a drained-marsh tile under a dorm becomes Wet in ~2.5 years and Marsh in ~5.

**Tell.** The Subsidence overlay (`S`) shows each built tile's cumulative drop as a heat color, and the inspect panel says "Sinking: 4 cm/yr — est. wet ground in 3.2 years." Cracked-road sprite variant. A ticker line when any building crosses a class.

**Counterplay.** Pilings (before or after). Build on High Ground first. Don't over-pump (Smart Pumps research: pumps only run when depth > 0.05, halving the compaction multiplier). "Subsidence Survey" research reveals per-tile rate before you build.

**Comedy.** *"Boudreaux Hall has technically moved to a lower floor."*

### 6.6 Heat & Humidity

**Rule.** Daily heat index `HI`: base by month (`Jan 60, Feb 65, Mar 72, Apr 78, May 85, Jun 92, Jul 97, Aug 99, Sep 93, Oct 82, Nov 72, Dec 63`) + `randn × 4` + 3 if it rained yesterday (humidity). **Heat advisory** at HI ≥ 100 (about 35% of Jul–Aug days); **heat wave** = 4+ consecutive advisory days (once most summers, 5–9 days).

**Effects.** During 11 am–5 pm on advisory days: agents outdoors and not within shade (Live Oak r2, Magnolia r1, Allée) or AC (Central Plant coverage, Rec Center r8) accrue −0.5 mood/hr, walk 20% slower, and 0.3%/day of students count as heat-sick (Health Center halves). Practice Field closed on heat-wave days (−win prob). Substation output −10% on advisory days (real: transformers derate).

**Counterplay.** Live oaks along every path (cheap, gorgeous, the correct answer), Central Plant coverage, Rec Center pool, the Fountain (r3 cooling), scheduling: a "Summer Session" policy toggle (students on campus in summer for tuition, at a heat cost) is off by default.

**Comedy.** Students sit under oaks in a ring; a "sno-ball stand" cart spawns automatically on heat-wave days at the Union and sells 100 sno-balls/hr (+mood). Ticker: *"Heat index 108. Campus tour guide has stopped walking backwards."*

### 6.7 Nutria & Other Wildlife

**Nutria** (invasive, real, Louisiana's actual levee problem):
- Spawn in marsh at 1 per 40 marsh tiles; population grows 5%/month unchecked, capped at 3× base.
- Behavior: wander marsh/wet; eat vegetation (`soilSat` absorption of that tile −20% while present); **burrow into Earthen Levees** they touch: −1 integrity/day per nutria adjacent. A nutria colony (3+) on a levee segment is a breach in ~30 days.
- Counterplay: Nutria Bounty (Wildlife Office, $5/head, halves population each season), gators eat them (a wet, gator-friendly ecology self-regulates), Floodwalls are immune.
- Comedy: they are drawn as absurdly orange-toothed. *"Nutria have formed a student org. It's a levee-eating club."*

**Other wildlife (cosmetic, ecology-driven, all spawn only where Ecology ≥ thresholds):**
- **Pelicans** (Ecology ≥ 50): fly in a V across the map at dawn.
- **Egrets/herons** (≥ 40): stand in marsh; fly off when a student passes.
- **Fireflies** (≥ 60): night particles in cypress/oak areas.
- **Frogs** (≥ 30): audio at night; a "frog chorus" meter.
- **Crawfish** (spring, wet ground): tiny mud chimneys appear; the Crawfish Shack's revenue +20% if there are 30+ chimneys within 20 tiles ("local sourcing").
- **Armadillo**: one, wanders roads at night, pointless, beloved.

### 6.8 Ecology Score (0–100)

```
eco = clamp( 30
  + marshTiles × 0.05 + cypressCount × 0.4 + liveOakCount × 0.3 + stockedPonds × 2 + boardwalkTiles × 0.1
  + cypressPlots × 8 + WildlifeOffice × 3 + livingShorelineTiles × 0.3
  - drainedMarshTiles × 0.6 - impervious tiles (road/parking/building) × 0.03 - fogEventsThisYear × 4
  - floodwallTiles × 0.1 , 0, 100)
```

**Costs of low ecology (< 40):** research grants ×1.0 (no Wetlands multiplier), surge attenuation reduced (marsh tiles under a low-eco map attenuate only 0.005), mosquito predators absent (+2/hr net), nutria unchecked, no wildlife cosmetics, donations −10% ("alumni saw the drone footage"), and a State Environmental Review event every other year (−$100k fine, 20% chance). **Benefits of high ecology (≥ 70):** research ×1.5, surge attenuation full, mosquito sinks active, +2 Prestige/year "green campus", fireflies, pelicans, the "Living With Water" milestone chain. The design's stance: preserving swamp is not charity; it's cheaper flood defense with a longer payback.

### 6.9 Research (Coastal Engineering Institute)

Each takes 60–120 sim days and $150k–$400k:

| Research | Cost / days | Effect |
|---|---|---|
| Subsidence Survey | $150k / 60 | Subsidence overlay shows *future* rate before building; inspect shows years-to-wet. |
| Floodwall | $200k / 80 | Unlocks Concrete Floodwall. |
| Smart Pumps | $250k / 90 | Pumps only run when needed: −50% pump upkeep, subsidence multiplier 1.5 → 1.2. |
| Storm Hardening | $300k / 100 | −0.25 wind damage probability, all buildings. Retroactive. |
| Living Shoreline | $250k / 90 | Unlocks "Living Shoreline" 1×1 ($2,500): oyster-reef/marsh edge on water tiles; attenuates surge 0.02/tile, +0.3 Ecology, no upkeep. The eco alternative to a floodwall. |
| Elevated Campus | $400k / 120 | Pilings retrofit cost +25% → +15%; new buildings can be placed as pilings for +10%. |

---

## 7. Student Life (light)

**Counts.** Enrollment is an abstract number (up to ~8,000). **Visible agents = `min(300, 20 + students / 12)`.** At 3,600 students that's 300 agents. Each visible agent represents ~12 students. Additional agent types: 2 Wildlife Officers, 1 patrol cart, 0–14 gators, 0–40 nutria (drawn only within camera + margin), 1 armadillo, game-day crowd sprites (batched, not agents). Total simulated entities ≤ 400.

**Per-agent state:** `name` (generator, §14), `major` (one of 8, cosmetic), `year` (1–4), `mood` (0–100), `x, y` (float tile coords), `path` (array of tile steps), `task` (enum), `timer`, `flags` (wet, swatting, tailgating, fleeing, umbrella). Sprite: 12×20 px body in one of 6 skin tones, hair variant, shirt purple/gold/white/gray (70% purple or gold), a backpack, 3-frame walk cycle. Named agents can be clicked.

**Daily schedule (sim hours, agents pick randomly within windows):**

- 7–9: leave dorm → Coffee Kiosk (30%) → class building.
- 9–15: cycle between class buildings every 2 hours ("walk to class" is the main visual: streams of purple dots along paths).
- 12–13: Dining Hall / Crawfish Shack / Union.
- 15–18: Library (20%), Rec Center (20%), Quad (30%: sit under oaks, throw a frisbee — two agents with a tiny arcing disc), Greek Row (10%), wander (20%).
- 18–23: dorms; some to Union/Kiosk; Greek Row parties Fri/Sat (agents cluster, music note particles).
- 23–7: sleep (agents despawn into dorms; a few night owls at the Library).
- **Game day:** from 10 am, 60% of agents go to Parking Lots within 12 tiles of the stadium (tailgate: grills, tents, flags spawn per lot), then to the stadium at kickoff; agents inside the stadium are hidden and replaced by batched crowd sprites.
- **Festival days:** Mardi Gras — parade path along the main road, agents line it, beads particles; Crawfish Fest at the Shack; Homecoming — bonfire on the quad.

**Reactive behaviors (interrupt the schedule):**

- `FLEE`: gator within 4 tiles → run away at 2× speed for 5 s with a "!" bubble; 10% instead pull out a phone and film (they don't move; the icon is a tiny phone).
- `SPLASH`: entering a wet tile → slow, splash particles, mood −0.1; if depth > 0.3, 15% spawn a tube float and mood +1 ("that's college").
- `SWAT`: mosq > 30 → periodic slap frame.
- `SHADE-SEEK`: heat advisory → prefer paths under oaks; sit under oak if outdoors > 10 min.
- `UMBRELLA`: rain > 0.3 → umbrella sprite (purple/gold) appears over the head.
- `SHELTER`: storm warning → walk to assigned shelter; then hidden until all clear.
- `EVACUATE`: leave along Ridge Road; despawn.
- `GAWK`: Roux Is Loose, Old Boudreaux, riverboat arrival → stand and look.

**Mood.** `mood` moves toward a target computed from local conditions (aura buildings, mosq, heat, wet, crowding, festival) at 5 points/hr. Campus happiness = mean agent mood blended with the abstract term (§5). Inspect panel shows a face (5 states) and one line: *"Remy Thibodeaux, Junior, Coastal Engineering. Mood: Damp."* Agents also carry a "mood bubble" occasionally (heart, rain cloud, mosquito, gator, music note, football) so the crowd reads at a glance.

**How agents affect the sim.** Only through mood → happiness (which drives applicants) and through visible location (tailgate lots attract gators; agents inside a flooded building trigger the evacuation event). They do not path-block each other or consume resources. Pathfinding: A* on the walkable grid, with a 512-entry cache of (from-building, to-building) routes invalidated when paths change; agents follow cached routes with a small random offset so streams look organic.

---

## 8. Sports (light)

**Season.** 8 regular-season games, Sept 5 – Nov 21, every ~11 sim days, alternating home/away (4 home). One rivalry game (last game, at home in odd years): **"The Battle for the Boot"** vs **Sabine River State**. Conference championship (Dec 5) if ≥ 6 wins; Bowl (Jan 1) if ≥ 6 wins: the **Sugar Cane Bowl**.

**Team rating** `TR ∈ [30, 95]`, starts 45:
```
TR = 45 + 10 × stadiumTier + 5 × (practiceField ? 1 : 0) + 0.15 × prestige
     + coachBonus (0/6/12 for Coach tiers: $200k/$600k/$1.5M per year, chosen each summer)
     + momentum (±5, from last 2 results) - heatWavePractice (3) - floodedField (5)
```

**Win probability** vs opponent rating `OR`: `p = 1 / (1 + 10^((OR - TR - homeAdv) / 25))`, `homeAdv = 3 + stadiumTier × 2 + (nightGame ? 3 : 0)`. Opponents: 8 fictional schools with ratings 35–85 drawn per season, rival always TR + 5 ± 8.

**Game day event (home).** 10 am: tailgates spawn on parking lots within 12 tiles (grill smoke, tents in purple/gold, cornhole, a boiling pot particle, music notes). Gator attraction +6 on those lots. 6 pm kickoff (night game if Tier ≥ 2 or rivalry: stadium light bloom, the map darkens around it). The game resolves as 4 quarters of 8 sim minutes with a running score in the HUD and 3–4 "play" ticker lines per quarter; the player can watch the score or ignore it. Final at ~8:30 pm. **Win:** fireworks particles over the stadium, Campanile bells, +6 happiness 3 days, agents celebrate (jump frames) on the quad for an hour. **Loss:** −4 happiness 3 days, one grumpy ticker line.

**Revenue per home game:** `seats × attendance × ticketPrice`, where `attendance = clamp(0.55 + prestige/200 + TR/300 + rivalry 0.15 + nightGame 0.05 − rain 0.15, 0.3, 1.0)` and `ticketPrice = $45 (T1) / $60 (T2) / $80 (T3)`. Concessions add 30%. Tier 1 full house ≈ $1.4M; Tier 3 ≈ $10.4M. **This is the biggest single money lever in the game**, and it's why a hurricane on a home weekend hurts: a game in a hurricane warning is cancelled (revenue 0) unless the player toggles "Play Through It" (allowed only Cat ≤ 1 rain bands; +3 Prestige "legend" if won, −10 happiness, gators at the tailgates guaranteed).

**Prestige.** Regular win +0.5, rivalry win +3, conference title +4, bowl win +5, losing season −2, undefeated +8 ("Perfect in the Swamp" milestone).

**Decisions (the "few"):** coach tier each summer; ticket price ±25% slider; stadium upgrade timing; play-through-weather toggle; whether to build the Practice Field on the only flat dry land you have left.

**Rivals (fictional):** Sabine River State (the Boot), Ole Magnolia University, Crimson Delta, Gulf Coast Tech, Pelican A&M, Atchafalaya Baptist, Red Stick Poly, Vieux Carré College.

---

## 9. Time & Calendar

- **Sim tick:** 10 Hz fixed timestep (100 ms sim). Render at display rate with interpolation. Hydro tick every 5 sim ticks. Mosquito grid every sim hour. Economy at midnight. Agents re-plan every 2 s.
- **Speed:** 1 sim day = 6 real seconds at 1× (1 sim hour = 250 ms = 2.5 ticks; agents move at ~1 tile/s so a walk across campus takes a few sim hours, which reads correctly). Speeds: Pause / 1× / 2× / 4× (keys `Space`, `1`, `2`, `3`). Landfall and Mardi Gras cap speed at 2×. 4× skips agent rendering interpolation (they teleport a little; acceptable).
- **Year = 365 days = 36.5 min at 1×.** A "20–60 min to major milestones" session covers Year 1 through Year 2's hurricane season at mixed speeds.
- **Day/night:** 24 sim hours. Sunrise 6, sunset 19 in summer (shifts ±1 h by season). Night tint: multiply layer of deep purple-navy `#1a0f3a` at 55% alpha at midnight; windows glow gold; light poles cast radial gold discs; stadium bloom.
- **Seasons:** Spring Mar–May (azaleas, river high, crawfish), Summer Jun–Aug (heat, storms, mosquitoes, cheap construction: −15%), Fall Sep–Nov (football, hurricane peak, cypress turn orange in Nov), Winter Dec–Feb (mild, one "freeze day" at random in Jan: fountain frozen, students confused, no mosquitoes).
- **Academic:** Fall semester Aug 20 – Dec 15; Spring Jan 12 – May 10; Summer May 11 – Aug 19 (students mostly gone; agents count halves unless Summer Session policy). Enrollment locks Aug 15 and Jan 10. Graduation May 10 (caps-in-air particle on the quad, +Prestige).
- **Hurricane season:** Jun 1 – Nov 30 (peak Aug 15 – Oct 15).
- **Festivals:** **Mardi Gras** (a Tuesday in Feb/Mar, plus the 5 days before: parades, beads, +10 happiness, $30k cleanup, trash → gator interest +5 for 3 days); **Crawfish Season** (Feb–May: Shack bonus; **Crawfish Fest** Apr 15: +5 happiness, $20k revenue); **Homecoming** (the 5th home game: bonfire, riverboat, alumni donations ×3 for the week); **Zydeco Night** (Mar 20, needs Fine Arts: +6 happiness, brass motif plays); **Graduation** (May 10); **Founders' Day** (Jul 15: yearly recap card).
- **Calendar UI:** the HUD date shows `Sep 21, Yr 1 · Fall · Hurricane Season` and a 12-month strip with icons for the next 3 events.

---

## 10. Onboarding & Progression

### The first 2 minutes (guided, by doing; each step is one card in the bottom-left with an arrow to the target; the game runs at 1× and auto-pauses only for the very first card)

| t | Step | What the player does | What the game does |
|---|---|---|---|
| 0:00 | **Title → "New Campus"** | Click. Optional seed. | Map generates, camera pans from the Gulf edge up the bayou to the starting ridge (a 4-second flyover: the screenshot moment's cousin). Card: *"Welcome, Chancellor. This ridge is the only dry land you own. Everything else is swamp. Let's build anyway."* |
| 0:08 | **Place a Lecture Hall** | Build palette opens on Academic; a pulsing highlight shows a 2×2 spot on High Ground next to the Main Gate. | On placement: scaffolding, cash tick, ticker *"BSU breaks ground. Swamp unimpressed."* |
| 0:25 | **Connect it with a path** | Drag a Gravel Path from the gate to the hall (drag-to-lay). | The "No Access" icon on the hall clears with a chime. |
| 0:40 | **Place a Dormitory** | Highlight shows a spot on the ridge. | Card explains beds = capacity. |
| 0:55 | **Set tuition & open enrollment** | The Enrollment panel opens; slider at $9,000; click "Open Enrollment". | 240 students arrive down Ridge Road over 20 s — the first purple stream. Ticker: *"First cohort arrives. Several have already asked where the beach is."* |
| 1:15 | **A thunderstorm cell** (scripted) | Watch: rain, a puddle forms at the low corner by the dorm; the Flood Risk overlay auto-toggles on for 5 s. Card: *"Water goes downhill. Give it somewhere to go."* Objective: drag a Drainage Canal from that corner to the bayou (a highlighted route, 6–9 tiles). | Puddle drains with a satisfying whoosh; card: *"That's hydrology. You'll be doing a lot of it."* |
| 1:45 | **Plant a Live Oak** | Place one on the quad. | Card: *"Shade is life. Oaks also drink. Plant them everywhere."* |
| 2:00 | **Objectives panel unlocks; tutorial cards continue non-blocking.** | | |

### The guided objective chain (Year 1; each grants a small cash reward so early money isn't a wall)

1. Build a Dining Hall within 20 tiles of the dorm (+$50k).
2. Build a Power Substation and a Water Tower (+$50k).
3. **"Something in the water"** (day ~25): a gator lounges by the Dining Hall dumpster. Objective: build a Gator Fence along the water edge *or* a Wildlife Office. (+$40k)
4. **"Standing water"** (day ~35): the mosquito overlay is introduced; objective: get the average density below 30 (stock a retention pond, fix a stagnant canal, or fog). (+$30k)
5. Reach 500 students by the fall lock (requires a 2nd dorm and parking).
6. Build the Cypress Bowl (Tier 1 stadium): the season starts Sept 5. (+first home game revenue)
7. **"Cone of concern"** (day 68): Hurricane Clotilde's cone appears. Objectives with a 5-day timer: (a) put the Substation on pilings, (b) build 12+ tiles of levee on the south side of campus, (c) confirm shelter capacity ≥ students (stadium counts). Cards explain each in one line. The objective checklist glows.
8. **Landfall** (day 73). Whatever the player did, the surge tests it. The tutorial has ensured the ridge campus mostly survives (Cat 2 surge = 0.35, ridge elev ≥ 0.72) but the low corner (where the first dorm's parking lot is) floods unless leveed. That's the lesson delivered by consequence rather than text.
9. **Aftermath** objectives: clear debris, repair, choose "rebuild on pilings", apply for relief grant.
10. Reach Prestige 20 → Tiger Habitat unlocks → Roux arrives in a parade.
11. Survive the Mardi Gras cleanup with a Wildlife Office in place.
12. Reach 1,500 students and Prestige 30 → Coastal Engineering Institute. Onboarding ends; sandbox with milestones from here.

### Milestones / achievements (22)

1. **Ground Broken** — place the first building.
2. **Geaux Time** — first cohort enrolls.
3. **Water Goes Downhill** — first drainage canal connected to the bayou.
4. **Shade Tree Chancellor** — 25 live oaks planted.
5. **Unbothered** — first gator relocated without incident.
6. **Chad Tried To Pet It** — the gator injury event happens (a "bad" achievement, framed as a badge of Louisiana authenticity).
7. **State Bird** — mosquito density hit "Biblical" and you fixed it within 10 days.
8. **The Campus That Held** — survive a Cat 3+ with < 10% of buildings damaged.
9. **High Water Mark** — survive a Cat 5.
10. **Polder Pride** — a fully ringed levee + pump network protecting 20+ buildings.
11. **Living With Water** — Ecology ≥ 75 with 2,000+ students.
12. **Fortress Bayou** — 60+ floodwall tiles (mutually exclusive playstyle badge with #11 in the same year).
13. **On Stilts** — 20 buildings on pilings.
14. **Sinking Feeling** — a building crosses a terrain class from subsidence (a warning achievement).
15. **Cypress Bowl Sold Out** — first 100% attendance.
16. **Battle for the Boot** — beat Sabine River State.
17. **Perfect in the Swamp** — undefeated regular season.
18. **Sugar Cane Bowl Champions** — win the bowl.
19. **Laissez les Bons Temps Rouler** — happiness ≥ 85 during Mardi Gras.
20. **Roux Is Loose** — the Tiger Habitat flooded and the mascot wandered.
21. **Bell Tower** — build the Campanile.
22. **Ten Years in the Swamp** — reach Year 10 without a failure state.

### Unlock progression (student and prestige gates from the catalog)

Start → 300 (Union, Wildlife Office, Police) → 400 (Central Plant, Greek Row) → 500 (Science Lab, Rec Center) → 600 (Stadium, Weather Station) → 700 (Fine Arts) → 800 (Library, Health Center) → 1,000 (Ag Center) → 1,200 (Res Tower) → 1,500 + P30 (Institute) → P15/20/25/40 landmarks. Research gates Floodwall, Living Shoreline, etc.

### Failure states (all soft: the game never deletes a save; each offers a "keep playing" branch)

- **Bankruptcy:** cash < 0 → Board of Regents loan offered once ($1M). If cash < −$500k for 60 days after the loan: **"Receivership"** card: the state takes over, tuition is set to $12k, no building for a year, prestige −15. The player continues, humbled. A second receivership ends the game with a summary card; the sandbox may continue with "Cheat: Legislature Bailout" clearly labeled.
- **Campus Underwater:** ≥ 60% of buildings flooded for 30 consecutive days → **Accreditation Review**: applicants −50% next cycle, state funding −25% for a year. If it happens two years running: **Accreditation Lost** → prestige set to 5, enrollment frozen until Prestige ≥ 15 again. Summary card, sandbox continues.
- **Prestige < 5 for a full year** → Accreditation Lost as above.
- **Abandonment:** students = 0 for a full year → "The swamp took it back" ending card (the ruins remain; you can keep building; nutria have moved into the Union).

### Endgame / sandbox

There is no win screen; there is a **Founders' Day recap** every Jul 15 (a card: enrollment graph, storms survived, ecology, football record, best ticker line of the year) and a **Hall of Fame** at Year 10 with the milestone tally. Sandbox continues with escalating hurricane odds and a "Century Storm" (Cat 5 + high river the same spring) rolling at 5%/year after Year 8 as the ultimate test.

---

## 11. UI/UX

### Main screen (1280×800 reference; scales)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [BSU] $2,431,200 ▲  👥 1,240  ★ Prestige 22  ☺ 71  🌿 Eco 64   Sep 21 Yr1 ·Fall│
│  ⏸ 1× 2× 4×     ⚠ HURRICANE CLOTILDE · CAT 2 · LANDFALL IN 3 DAYS  [Prepare]│
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                              │
│                                                                              │
│                          ( isometric map viewport )                          │
│                                                                              │
│                                                                              │
│                                                        ┌──────────────┐      │
│                                                        │   minimap    │      │
│ ┌──────────────────┐                                   │  ◢ cone ◣    │      │
│ │ OBJECTIVE        │                                   └──────────────┘      │
│ │ ☐ Levee south    │                                   [F][M][P][S][E] ovl   │
│ │ ☑ Substation up  │                                                         │
│ └──────────────────┘                                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ 📰 Hurricane Clotilde rapidly intensifies. Athletic Director: "We've played…" │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Paths][Utility][Swamp][Academic][Housing][Dining][Sports][Life][Trees][Land] │
│  ▢ Gravel $200  ▢ Road $600  ▢ Boardwalk $900  ▢ Bridge $3k   ⟲ Bulldoze  🔍  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** cash (with a daily delta arrow and hover breakdown), students, prestige, happiness, ecology, date/season, speed controls. A **alert strip** below it appears only during a hurricane watch, mosquito emergency, heat wave, blackout, or river flood, with one action button.
- **Objective card:** bottom-left, max 3 lines, collapsible.
- **Minimap:** 96×96 px, terrain colors, buildings as dots, hurricane cone, storm cells, camera rectangle. Click to jump.
- **Overlay buttons** under the minimap: `F` Flood Risk, `M` Mosquito, `P` Power/AC coverage, `S` Subsidence, `E` Ecology/shade. One active at a time.
- **Ticker:** one line, scrolls left; click opens the last 30 lines in a log.
- **Build palette:** 10 category tabs, then items as cards (icon = the sprite, name, cost). Locked items shown dimmed with the unlock reason. Hover = tooltip with the full stat block. Selecting an item enters placement mode with a footprint ghost: green (ok), yellow (needs grading / pilings toggle shown), red (blocked: reason text). `Shift` while placing = repeat. Drag for linear items (paths, canals, levees, fences).

### Inspect panel (click any building/tile/agent; slides in from the right, 300 px)

```
┌────────────────────────────┐
│ BOUDREAUX HALL (Dormitory) │
│ [sprite]   Beds 200/200    │
│ Status: ⚡ Powered ❄ AC     │
│ Ground: Dry (elev 0.61)    │
│ Sinking 3 cm/yr → Wet in 5y│
│ Flood tol 0.10  Water 0.00 │
│ Mosquito: Annoying (38)    │
│ Happiness aura: +0         │
│ Upkeep $300/day            │
│ [Put on Pilings $62,500]   │
│ [Rename] [Bulldoze $12,500]│
└────────────────────────────┘
```

Tiles show terrain, elev, water depth, soil saturation, subsidence, "why can't I build here." Agents show name/major/year/mood line/current task. Gators show name/size/mood/"Last seen: Crawfish Shack."

### Other screens

- **Enrollment & Finance** (`B`): tuition slider, projected applicants vs capacity bar, income/expense table for the last 30 days, loan button.
- **Athletics** (`T`): schedule, record, TR breakdown, coach tier picker, ticket price, stadium upgrade button, next game countdown, live score during games.
- **Research** (`R`): the 6-item tree.
- **Policies** (`Y`): Nutria Bounty, Gator-Proof Dumpsters, Dorm Screens, Summer Session, Play Through Weather, Evacuation Order, Sandbag Drive.
- **Hurricane Prep** (the alert strip's button): shelter capacity vs students, levee integrity list, substations at risk, one-click Evacuation/Sandbags.
- **Pause menu** (`Esc`): Save / Load / New / Seed / Audio toggle / Screen-shake toggle / Reduced-particles toggle / Controls.

### Camera & controls

- Pan: WASD / arrow keys / edge-drag with right mouse or middle mouse / two-finger trackpad scroll (this is the primary trackpad pan: `wheel` events with `deltaX/Y` pan; `ctrl+wheel` / pinch zooms). Zoom: 0.5× / 0.75× / 1× / 1.5× / 2×, stepped, with `+`/`-` and pinch. Click-drag on empty map pans on trackpad too (mousedown + move > 4 px = pan, not click).
- Placement: left click / drag. Right click or `Esc` cancels. `Q`/`E` rotate footprints (only matters for 1×2 and the Allée).
- Hotkeys: `1–0` category tabs, `F M P S E` overlays, `Space` pause, `1 2 3` speeds (when not in a palette; else `Shift+1..3`), `B T R Y` screens, `X` bulldoze, `H` home (Main Gate), `N` next notification, `Tab` cycle recent alerts, `Ctrl+S` save.
- Tooltips: 300 ms hover delay, everywhere. Every number in the HUD has a hover breakdown.
- Touch (nice-to-have): one-finger drag pans, tap places, pinch zooms, palette is tap-friendly at 44 px targets.

---

## 12. Visual Style

- **Projection:** isometric 2:1, tile 64×32 at zoom 1. Map rendered in draw order by `(x + y)` with buildings sorted by their front-most tile. Terrain baked into 16×16-tile chunk canvases (36 chunks); water and rain drawn as dynamic layers on top.
- **Palette (hex, defined once in `palette.js`):**
  - Purple family: `#461D7C` (BSU purple), `#5E2CA5`, `#7B4FC9` (highlights), `#2B1052` (deep), `#1A0F3A` (night tint).
  - Gold family: `#FDD023` (BSU gold), `#E5B80B`, `#B8860B` (shadow gold), `#FFF1A8` (window glow).
  - Swamp: greens `#2F4F2F`, `#3E6B3E`, `#6B8E23` (marsh), `#8FA85A` (dry grass), `#A9B77C` (high ground); browns `#5C4A32` (mud), `#7A6240` (wet ground), `#8B7355` (boardwalk); water `#2E4A5E` (channel), `#3D6B7A` (open), `#6E8FA0` (flood, semi-transparent), `#1E2F3A` (deep/night); tan `#C9B47C` (gravel); asphalt `#3A3A3F`.
  - Moss gray-green `#9BA88C`. Cypress fall orange `#C4652A`. Azalea `#E75480` / `#C86BD6`. Sky tints: day none; dusk `#F2A65A` at 20%; storm `#3B3F52` at 45%.
- **Tiles:** diamond fills with 2–3 px darker edge, plus a per-tile deterministic dither (from a tile hash) so grass isn't flat. Marsh gets 3–6 cattail/knee sprites; wet ground gets mud spots; high ground gets a subtle lighter band. Water tiles: base fill + two moving sine-offset highlight lines (animated by shifting a cached 64×32 pattern by `t`).
- **Buildings:** procedurally drawn with a shared "iso box" routine: `drawIsoBox(w, h, depth, wallColorL, wallColorR, roofColor)` then decorations (windows in a grid, doors, columns as thin lighter rects, awnings as purple trapezoids, roof vents, signs with gold text drawn via `fillText` at 6 px into the sprite). Each catalog entry has a `draw(ctx)` function of 10–30 lines; the visual descriptions in §4 are the spec. Sprites cached to offscreen canvases per (building, tier, damaged?, pilings?, night?) — about 49 × 4 variants ≈ 200 small canvases. Night variant = same sprite with windows filled `#FFF1A8` and a soft radial glow.
- **Trees:** Live Oak = trunk + 5–7 overlapping dark-green ellipses + 8–12 hanging moss lines (drawn per instance from a seed; 3 growth stages). Cypress = narrow triangle stack + knees. Azalea = ellipse cluster with seasonal color swap.
- **Agents:** 12×20 px pixel figures built from rectangles at sprite-generation time: head, torso (shirt color), legs (3 walk frames), backpack. 6 skin tones × 4 hair × 4 shirts cached = 96 × 3 frames. Umbrella and tube are overlays.
- **Lighting / day-night:** a full-screen multiply-ish tint (`globalCompositeOperation = 'multiply'` over the map layer) blended by hour; night adds a `lighter`-composited pass of gold radial gradients at light poles, windows, and the stadium (drawn from a cached glow sprite). Dusk/dawn warm tints.
- **Weather effects:** rain = 300–900 short diagonal line particles in screen space, opacity by intensity, plus tile splash rings on wet tiles; lightning = 1-frame white flash at 35% + a jagged polyline drawn for 2 frames + camera shake; fog = a screen-space perlin-scrolled alpha layer on humid mornings (Oct–Feb, 20% of days, 2 hours); heat shimmer = 1 px horizontal sine displacement of the map layer at HI ≥ 100 (cheap: draw the map canvas in 8-px horizontal bands with offsets); wind = moss and flags lean by a global wind vector, leaves particles; fireflies = 40–120 tiny gold dots with sine drift and blink in eco areas at night; storm = darker tint + bands.
- **Animation list:** water highlight scroll; moss sway; flag wave; fan/dish rotation; pump discharge arc; fogger cloud; scaffolding build (3 stages); agent walk/idle/swat/flee/jump/sit; gator walk/bask (tail flick)/lounge/wrangled; nutria scurry; pelican V; frisbee arc; tailgate grill smoke; fireworks; bead toss; graduation caps; Roux pacing; riverboat paddle; bell swing; car arrivals.
- **Particles:** a single pooled particle system (max 2,000) with types: rain, splash, smoke, spark, firefly, leaf, bead, confetti, firework, steam, sugar-puff, mosquito-swarm-dot, dust (construction), debris (post-storm).
- **Juice:** camera shake (storm, gator lounge stomp: tiny, stadium score: small); placement pop (sprite scales 1.15→1 over 150 ms); cash delta floats (+$ / −$ text rising); building-complete sparkle; hurricane cone pulses; the ticker slides new lines in; win = screen flash gold; HUD numbers tween rather than jump.
- **Screen readability:** all HUD text in a bold sans (system font stack), 13–14 px min, white on purple with 1 px shadow; map labels in gold with dark outline.

---

## 13. Audio (synthesized, muted by default; toggle in the top bar and pause menu)

All via one `AudioContext` created on first user gesture; everything is oscillators, noise buffers, and biquad filters. A master gain at 0 until unmuted.

- **Ambience layers (crossfaded by time/season/weather):**
  - *Frogs* (night, eco ≥ 30): 3 voices of short filtered square-wave blips at random intervals 0.3–2 s, pitch 180–320 Hz, volume by ecology.
  - *Cicadas* (summer day): band-passed white noise with a 40 Hz amplitude tremolo, swelling in 4-s cycles.
  - *Crickets* (spring/fall night): high sine chirps at 4.5 kHz, 3 per second.
  - *Rain*: pink-ish noise (lowpassed white) with volume by `R`; thunder = a 1.5-s noise burst through a lowpass at 120 Hz with a slow decay, 0.2–1.5 s after a lightning flash (distance).
  - *Wind*: band-passed noise, cutoff swept by gust, during storms.
  - *Water*: a subtle filtered noise loop near the channel when the camera is close.
- **UI:** click (short 2 kHz sine blip), place (a low thunk: 90 Hz sine with fast decay + noise click), invalid (two-tone descending buzz), cash in (soft triangle arpeggio C–E–G), alert (a purple-alert "bong": 440 Hz triangle with 0.6-s decay), objective complete (rising 3-note), build complete (a sparkle: 3 fast high sines).
- **Events:** gator (a low growl: 60 Hz sawtooth with random FM, 0.8 s); mosquito (a 600 Hz sine with slow vibrato, only when the mosquito overlay is up, mercifully quiet); Campanile bells (a bell = sum of 4 sines at 1, 2.4, 3.1, 4.7 ratios with staggered decays, struck 12 times at noon); crowd roar (noise swell through a 400 Hz bandpass, 2 s) on kickoff and scores; fireworks (noise pop + descending sine).
- **Game-day motif ("Geaux Tigers Strut"):** a 4-bar procedural brass-band/zydeco vamp at 118 BPM in Bb: a sousaphone bass line (sawtooth through a lowpass, notes Bb–F–G–F on beats), a snare (noise burst 60 ms) on 2 and 4 with a second-line syncopation on the "and of 3," an accordion-ish lead (two detuned square waves through a bandpass) playing a 4-bar riff `Bb D F D | Eb G Bb G | F A C A | Bb D F D` in eighth notes, and a washboard (short high-passed noise ticks on every eighth). Plays at tailgate start and after a win, 16 bars, then fades. A Mardi Gras variant swaps the lead riff to a minor-third figure and adds a trumpet (sawtooth with a slow 6 Hz vibrato).

---

## 14. Flavor Content

**Mascot:** **Roux** the Tiger (a "dark roux" tiger: deep orange with near-black stripes). Lives in the Tiger Habitat. The costumed mascot is "Lil' Roux."

**University:** Bayou State University (BSU). Motto: *"Ex Aqua, Scientia"* ("From water, knowledge"). Colors: purple and gold. Fight cheer: "GEAUX BAYOU!"

**Student name generator.** First names (pick by weighted table): Beau, Remy, Thibault, Émile, Jacques, Landry, Pierre, Alcide, Jean-Luc, Étienne, Boudreaux (as a first name, 1%), Marcel, Claude, Théo, Cyprien, Antoine, Amédée, Célestin, Marie, Clothilde, Adélaïde, Camille, Josette, Evangeline, Delphine, Odile, Margaux, Simone, Colette, Amélie, Mireille, Genevieve, Noémie, Rosalie, Yvette, plus a 25% "modern Louisiana" table: Tyler, Kaitlyn, Jaylen, Brooklyn, DeShawn, Madison, Hunter, Kayla, Trey, Destiny. Surnames: Boudreaux, Thibodeaux, Landry, Guidry, Hebert, Broussard, Fontenot, LeBlanc, Melancon, Arceneaux, Cormier, Robichaux, Trahan, Babineaux, Mouton, Doucet, Bergeron, Dugas, Comeaux, Breaux, Richard, Savoie, Theriot, Prejean, Benoit, Gautreaux, Domingue, Chauvin, Boutte, Batiste, Toussaint, Delacroix, Lafleur, Vidrine, Ardoin, Naquin, Pitre, Champagne, Duplantis, Rousseau. 8% of students get a nickname in quotes: "T-Boy," "Boo," "Tee," "Coco," "Pook," "Beaux," "Nonc," "Cher." Majors: Coastal Engineering, Wetland Ecology, Petroleum Geology, Culinary Arts, Sports Management, Marine Biology, Music (Zydeco Performance), Mass Communication.

**Building names (auto-assigned from a pool; player can rename):** Boudreaux Hall, Pelican Hall, Cypress Commons, Magnolia Court, Atchafalaya Hall, Bienville Library, Roux Rec, The Levee Lounge, Gumbo Hall (dining), The Boil House (crawfish), Café Beignet, Pontchartrain Tower, Sugarcane Science Center, Fifolet Fine Arts, Delacroix Dorm, Tchoupitoulas Commons, The Landing, Old Ridge Gate, Rougarou Row (Greek). Levee segments get names when 20+ tiles: "The Great Wall of Boudreaux."

**Rival schools:** Sabine River State (rival; "the Boot"), Ole Magnolia University, Crimson Delta, Gulf Coast Tech, Pelican A&M, Atchafalaya Baptist, Red Stick Polytechnic, Vieux Carré College.

**Festival descriptions (as shown on the calendar hover):**
- **Mardi Gras** — "Five days of parades down Ridge Road. Beads, king cake, a marching band that is 60% tuba. Happiness soars; so does the trash. The gators have noticed the trash."
- **Crawfish Fest** — "The Boil House runs 24 hours. Forty pounds a table. Someone will bring an unreasonable amount of corn. Mudbugs are locally sourced if your wet ground is wet enough."
- **Homecoming** — "The alumni riverboat docks, the bonfire goes up on the quad, and every donor with a checkbook remembers the night game in '99."
- **Zydeco Night** — "Fine Arts opens the doors, the accordion comes out, and the entire quad learns the two-step whether it wants to or not."
- **Graduation** — "Caps in the air, parents in the stands, a heat index of 96 in May because of course."
- **Founders' Day** — "The Chancellor's annual recap. What flooded, who won, what's sinking."

**News ticker / event lines (48):**

1. "BSU breaks ground. Swamp unimpressed."
2. "First cohort arrives. Several have already asked where the beach is."
3. "Gator spotted at Gumbo Hall dumpster. Reviews: 'Four stars, generous portions.'"
4. "Old Boudreaux spotted at the Union. Ordered nothing. Left a review."
5. "Amphitheater is now a pond. Rowing club has petitioned to keep it."
6. "Heat index 108. Campus tour guide has stopped walking backwards."
7. "Mosquito the size of a Cessna spotted near the Library. Library denies it."
8. "Hurricane Praline downgraded to 'a mess.'"
9. "Athletic Director: 'We've played in worse.' Weather Service: 'You have not.'"
10. "Nutria have formed a student org. It's a levee-eating club."
11. "Boudreaux Hall has technically moved to a lower floor."
12. "Pump Station #2 offline. Reason: the pump station flooded."
13. "Students report 'a vibe' on the boardwalk. Ecologists confirm: it's frogs."
14. "Crawfish season opens. Productivity closes."
15. "Mardi Gras cleanup underway. Beads found in the Chancellor's office. Nobody is explaining."
16. "Freeze warning: 34°F. Classes cancelled. Students confused, then delighted."
17. "Fog delays the 8 a.m. lecture. Professor delivers it anyway to an empty quad."
18. "Live oak on the quad turns 1. Students hold a party. Oak unmoved."
19. "Sabine River State fans spotted on campus. Gator Fence holding."
20. "Roux is loose. Roux is fine. Roux is at the Boil House."
21. "Parking lot flooded. Students report 'lake parking' is 'honestly kind of nice.'"
22. "Cypress knees on the quad path 'a trip hazard,' says student who tripped."
23. "The Campanile rang 13 times. Facilities says that's fine."
24. "Storm surge stopped by marsh belt. Marsh declines comment."
25. "Levee inspection: 'It's a nice levee.' — State engineer, apparently satisfied."
26. "Evacuation order issued. Ridge Road traffic described as 'a parade with no floats.'"
27. "Sandbag drive: 3,000 bags filled. Greek Row filled 40 and posted about it."
28. "Weather Station reports the cone has 'narrowed.' It has not narrowed enough."
29. "Power out in the east dorms. Freshmen have discovered stars."
30. "Blackout day 3. Gumbo Hall serving 'whatever was in the freezer.' Reviews: strong."
31. "Post-storm mosquito bloom: 'Biblical.' Abatement truck seen crying."
32. "Retention pond stocked with mosquito fish. Fish morale reportedly high."
33. "Subsidence survey complete. Findings: 'Yes.'"
34. "Coastal Engineering Institute publishes paper: 'Water: Still Going Downhill.'"
35. "Home opener sold out. Tailgate grills visible from the river."
36. "Night game. Stadium noise registered as a minor seismic event."
37. "Rivalry week. Someone painted the Boot purple. The Boot was already purple."
38. "Sugar Cane Bowl champions! Beignets are free. This is legally binding."
39. "Losing streak continues. Coach describes team as 'building.' Facilities asks what."
40. "Practice field flooded. Kicker practiced anyway. Kicker is wet."
41. "River stage rising. Old-timers say it's nothing. Old-timers have boats."
42. "Armadillo crosses Ridge Road for the fourth time today. Nobody knows why."
43. "Pelicans return. Ecology department 'quietly emotional.'"
44. "Fireflies reported in the cypress grove. Attendance at night labs mysteriously up."
45. "State legislature notes rising prestige, sends slightly larger check."
46. "Alumni riverboat docks. Donor asks if the stadium can be 'louder.'"
47. "Student named Boudreaux Boudreaux enrolls. Registrar files no complaint."
48. "Chancellor's Founders' Day address: 'We are still here. The water is also still here.'"

---

## 15. Technical Feasibility

**One file.** `build.mjs` concatenates `src/*.js` in dependency order into a `<script>` block inside `index.html` with inline CSS. No imports at runtime; each module is an IIFE that assigns to a shared `window.BSU` namespace (the "contract"). Total JS target: 9,000–14,000 lines, < 700 KB unminified. Nothing is fetched.

**Performance budget (ordinary laptop, 60 fps target)**

- Map 96×96 = 9,216 tiles. Terrain baked into 36 chunk canvases (each 16×16 tiles = 1024×512 px + margins), re-baked per chunk only when a tile in it changes. Per frame: draw the ~12–20 visible chunks (drawImage), then dynamic layers.
- Water: a per-tile depth-tinted diamond only for tiles in the active hydro set within the viewport (typically < 600).
- Buildings: ≤ 400 placed, ≤ 150 visible; each a single `drawImage` of a cached sprite. Depth sort by precomputed key; re-sort only on placement.
- Agents ≤ 300 + wildlife ≤ 60, each one `drawImage`. Off-screen agents skip drawing and update at 1/4 rate.
- Particles ≤ 2,000 in one pooled typed array; rain drawn as a single `beginPath` with many `moveTo/lineTo`.
- Hydro: ≤ 74k simple ops per hydro tick (2 Hz sim); worst case whole-map surge ≈ 150k ops: fine.
- Mosquito grid 48×48 per sim hour: negligible.
- Pathfinding: A* on a 9,216-node grid, cached routes; ≤ 20 new A* per second.
- Overlays rendered to their own cached canvas, refreshed on change or every 5 sim days.
- Save: game state (tiles as typed arrays base64'd, buildings, agents summarized, economy) ≈ 150–300 KB JSON; autosave every sim day-end at 1× (every 6 s wall) throttled to every 30 s wall; `localStorage` slot "bsu.save" + "bsu.save.prev". Load restores everything except particles.
- Memory: ~200 sprite canvases × ~16 KB ≈ 3 MB; chunk canvases 36 × 2 MB ≈ 72 MB worst case — acceptable; reduce chunk to 8×8 if Safari memory is an issue.

**Module decomposition (13 modules; each exports onto `BSU.<name>` and consumes only the listed contracts)**

| # | Module | Owns | Public contract |
|---|---|---|---|
| 1 | `core.js` | Game loop, fixed timestep, speed, RNG (seeded mulberry32), event bus, save/load orchestrator | `BSU.core.{start, on, emit, rand, time, speed, save, load}` |
| 2 | `palette.js` + `sprites.js` | Color tokens, offscreen sprite cache, `drawIsoBox`, tree/agent/gator sprite generators | `BSU.sprites.get(key, variant) → canvas` |
| 3 | `terrain.js` | Map gen, tile typed arrays (`elev, depth, sat, type, flags`), terrain queries, chunk baking, subsidence | `BSU.terrain.{gen(seed), tile(x,y), setElev, bakeChunk, classify}` |
| 4 | `hydro.js` | Rain input, CA flow, outlets, pumps/canals/levees integration, flood classification, flood-risk prediction | `BSU.hydro.{tick, addRain, surgeBegin/End, predictedDepth(x,y), isFlooded(building)}` |
| 5 | `weather.js` | Calendar (date/season/day-night), heat index, thunderstorm cells, river stage, hurricane generator/forecast/landfall sequence, wind damage rolls | `BSU.weather.{tick, date, hour, season, HI, rain(x,y), storm, cone}` |
| 6 | `wildlife.js` | Gators, nutria, officers, cosmetic fauna, mosquito grid, ecology score | `BSU.wildlife.{tick, mosq(x,y), eco(), gators[]}` |
| 7 | `buildings.js` | Catalog data + draw fns, placement validation, footprint/access/power/coverage graphs, build/repair queues, pilings, research tree | `BSU.buildings.{catalog, canPlace, place, remove, list, coverage(kind,x,y), research}` |
| 8 | `economy.js` | Cash, income/expense lines, enrollment lock, prestige, happiness abstract term, loans, failure states, milestones | `BSU.economy.{tick, cash, students, prestige, happiness, enroll, milestones}` |
| 9 | `agents.js` | Student agents, schedule, reactive behaviors, A* + route cache, crowd batching | `BSU.agents.{tick, list, spawn, evacuate, shelter}` |
| 10 | `sports.js` | Season schedule, TR, game-day event, tailgates, results, revenue, rivals | `BSU.sports.{tick, schedule, record, gameDay, TR}` |
| 11 | `render.js` | Camera, chunk compositing, depth-sorted entity pass, water/overlay/lighting/weather layers, particles, screen shake | `BSU.render.{frame, camera, particles.emit, shake, overlay}` |
| 12 | `ui.js` | HUD, palette, inspect panel, screens, ticker, objectives/tutorial cards, minimap, input (mouse/keys/trackpad/touch), tooltips | `BSU.ui.{init, notify, ticker, openScreen}` |
| 13 | `audio.js` + `flavor.js` | WebAudio synth ambience/UI/motif; names, ticker lines, storm names, building names, festival text | `BSU.audio.{play(name), setAmbience, mute}` / `BSU.flavor.{studentName, ticker(tag), stormName}` |

Contract rules: modules communicate by the event bus (`'tile:changed'`, `'building:placed'`, `'flood:start'`, `'storm:landfall'`, `'gator:lounge'`, `'game:final'`, `'day:end'`) and direct read-only queries; only the owning module writes its state. Save/load: each module implements `serialize()/deserialize()`.

**What to cut first if scope must shrink (in order):**

1. Research tree → keep only Floodwall as a prestige unlock (saves a screen and 5 effects).
2. Catalog trim from 49 to 36: cut Magnolia, Memorial Allée, Riverboat Landing, Shuttle Stop, Fine Arts, Ag Center, Campus Police, Quad Fountain, Cypress Plot (fold into Cypress), Parking Garage, Living Shoreline, Bridge (make the channel uncrossable), Greek Row.
3. Cosmetic fauna (pelicans, egrets, armadillo, crawfish chimneys) → keep fireflies and frogs (audio).
4. Nutria → fold into "levee decay 1/day in marsh contact" with no agents.
5. Heat shimmer, fog, and the eye-of-the-storm phase.
6. The quarter-by-quarter football broadcast → one roll, one result card.
7. Named legendary gator, the injury event, and Roux Is Loose.
8. Touch input.
9. Audio entirely (it's muted by default anyway) — but the game-day motif is cheap and high-wow; keep it if anything.

Never cut: hydrology CA, hurricane set piece, gators, mosquitoes, subsidence, pilings/levees/pumps/canals/boardwalks, agents walking to class, the stadium and game day, the 2-minute onboarding, the Flood Risk overlay, autosave.

---

## 16. Scope Risks and the Three "Demo" Traps

**The three things most likely to make this feel like a demo instead of a game, and how the design avoids them:**

**1. Systems that exist but never bite.** Many sim demos have "flooding" that is a blue tint and "hurricanes" that are a screen shake. The fix is that every swamp system here is wired to *money and enrollment through a concrete chain*: water → flooded substation → blackout → pumps stop → dorm floods → −10 happiness → applicants drop at the next lock → less tuition. And every chain has a visible tell (overlay, ticker, icon) and a purchasable answer. The Year 1 scripted hurricane guarantees every player experiences the full cascade in the first 20 minutes, on a map engineered so that the tutorial's low corner *will* flood unless they act. Consequence teaches; text doesn't.

**2. A campus that looks placed, not lived in.** Empty SimCity clones feel like dioramas. The design commits budget to 300 agents with a daily rhythm, reactive interrupts (flee, splash, swat, umbrella, shade-seek), mood bubbles, tailgates, a parade, and wildlife that is doing its own thing (basking gators, nutria at the levee, pelicans at dawn). The night pass with gold windows and the stadium bloom makes a screenshot at any hour. Juice is specified per action so placement, cash, and completion all *feel* like something.

**3. A flat difficulty curve with no arc.** Sandboxes drift. Here the arc is built into the world: the ridge runs out (land pressure), subsidence turns Year 1's dry land into Year 6's wet land (re-engineering pressure), hurricane odds escalate (defense pressure), and the two ecological paths (Fortress vs. Living With Water) give a mid-game identity choice with different late-game failure modes (brittle-expensive vs. slow-cheap). Milestones and the Founders' Day recap make progress legible; soft failure states create real stakes without deleting saves.

**Other scope risks and mitigations:**

- **Hydrology tuning is the make-or-break.** If flooding is too rare the swamp is scenery; too common and it's a chore. Mitigation: all rates live in one `hydro.params` object with the numbers in §6.1, plus a debug panel (`~` key, hidden) with sliders and a "rain 1 hour" button so a single engineer can tune in minutes. Target: an unprotected wet-ground building floods in ~40% of summer thunderstorm cells; a leveed and pumped dry-ground campus never floods below Cat 3.
- **Trackpad input is easy to get wrong.** Two-finger scroll must pan (not zoom the page), pinch must zoom, and click-vs-drag needs a 4 px threshold. Mitigation: `ui.js` owns a single input state machine with these rules and `preventDefault` on wheel over the canvas; test in Chrome and Safari specifically (Safari's `gesturestart` for pinch).
- **Safari offline `file://` gotchas:** no `localStorage` restrictions for file:// in Safari by default, but `AudioContext` must be created in a click handler; `OffscreenCanvas` is avoided in favor of `document.createElement('canvas')`; no `import`.
- **Sprite authoring volume.** 49 building draw functions is the single largest content task. Mitigation: `drawIsoBox` + 8 decoration helpers (windows grid, columns, awning, sign, roof vents, stilts, scaffolding, damage overlay) mean most buildings are 10–15 lines; the §4 visual column is the spec, and variants (night/damaged/pilings) are generated, not drawn.
- **Parallel-agent integration.** The event names and typed-array layouts are the contract and are frozen in `core.js` first; each module ships with a `selfTest()` that runs headless (no canvas) so integration failures are caught by the build script.
- **Word-of-mouth moment.** The screenshot moment (night game in a storm) requires weather, sports, lighting, and agents all working together. The design deliberately schedules Year 1's scripted hurricane during football season so that the coincidence is guaranteed at least once per player, and the "Play Through It" toggle exists so students can *choose* the legendary version.

*Ex Aqua, Scientia. Geaux Bayou.*
