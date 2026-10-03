# BAYOU STATE
### *Build the campus. Beat the swamp. Fill the stadium.*

**Candidate GDD — "Spectacle" cut**
Design lens: every system exists to produce a screenshot, a gasp, or a laugh — and then to hold up as a real game underneath.

---

## 1. Title, Tagline, Pitch, Screenshot Moment

**Title:** BAYOU STATE
**Tagline:** *Build the campus. Beat the swamp. Fill the stadium.*

**Pitch.** You are the newly appointed Chancellor of Bayou State University, a purple-and-gold college chartered on the one thing Louisiana has too much of: swamp. The state has given you a natural-levee ridge along the Big Muddy, a starting endowment, a football-obsessed legislature, and a plot of cypress backswamp that is trying, every single day, to take the land back. Build lecture halls on pilings, cut drainage canals, raise levees, fog for mosquitoes, fence out the gators, and — because this is Louisiana — build a night-game stadium so loud it registers on the campus seismograph. Every August the Gulf sends hurricanes; every September the bleachers fill; every February the campus throws Mardi Gras. Grow from 400 freshmen in a trailer to a 20,000-student flagship, or watch the marsh reclaim your quad one wet semester at a time. *Laissez les bons temps rouler.*

**The screenshot moment (the "wait, AI made this?" frame).**
It is 8:41 PM on a Saturday in October. The camera is pulled back over a full isometric campus. Six stadium light masts pour cold white-gold light into a bowl of 75,000 flickering purple-and-gold pixels doing the wave; the glow bleeds out through low ground fog rolling off the bayou. Live oaks drip Spanish moss that sways in the wind. Streetlamps trace the paths; every dorm window is a warm square. Beyond the last levee the swamp is black except for a thousand drifting fireflies and two pairs of red gator eyes on the water. On the horizon, lightning silently backlights a wall of cumulonimbus — the ticker reads *"Tropical Storm Delphine forecast to strengthen. Cone includes Red Stick."* The home team scores; the stadium pulses, the fireworks pop, a brass-band sting plays, and the whole screen shakes for 200 ms.

Every element in that frame is a system the player built, tuned, or is about to lose.

---

## 2. Core Loop and Meta Loop

### Minute-to-minute (the core loop, ~60–90 seconds per cycle)
1. **Read the land.** Toggle the Flood Risk overlay; see where water pools after last night's rain.
2. **Decide and place.** Pick a building from the palette; ghost preview shows footprint, cost, elevation warning ("Wet ground — needs pilings, +$120k"), and connection status (path/power/water).
3. **Watch it land.** Construction scaffolding rises over 1 game-day with dust puffs, then the building "pops" with a small squash-and-stretch and a coin sound; students immediately path to it.
4. **React to the swamp.** A gator wanders onto the quad; mosquito haze thickens over a puddle; the ticker warns of a tropical wave. Build a fence, cut a drain, top up the levee.
5. **Collect the payoff.** Semester tuition drops in with a cash burst; the prestige meter ticks up; a milestone toast slides in.

### Semester-to-semester (meta loop)
- **Summer (build season):** State funding arrives July 1. Rain is heavy, heat index peaks, hurricane season opens. This is when you dig, build, and fortify.
- **Fall (revenue and spectacle):** Enrollment locks in on Aug 15; tuition arrives; the football season runs Sep–Nov with 6 home games; hurricane season continues through Nov. The best and most dangerous quarter.
- **Spring (culture and consolidation):** Mardi Gras (Feb), crawfish season (Mar–Apr), graduation (May 10) with a burst of alumni who fund donations forever. Tuition again. Rain returns.

### Year-to-year
- Prestige compounds: more applicants → higher tuition tolerance → bigger buildings → landmarks → higher prestige.
- The swamp compounds too: every filled marsh tile lowers ecology, which lowers the natural flood buffer and raises mosquito pressure; every building on wet ground subsides. The player is always deciding between **growing fast on cheap wet land** and **growing right on expensive dry land / pilings**.
- Football compounds: stadium tier → attendance → athletics revenue → coaching budget → wins → donations and applicants.

---

## 3. World and Terrain

### Map
- **64 × 64 tiles**, isometric 2:1 diamonds, 64 × 32 px at zoom 1.0. 4,096 tiles. This is the sweet spot: large enough to feel like a river-to-swamp landscape, small enough for the hydrology to run full-map every 250 ms.
- World coordinates: tile (tx, ty). Screen: `sx = (tx - ty) * 32`, `sy = (tx + ty) * 16 - elevPx`, with `elevPx = elevation * 6`.

### Elevation model
- Each tile stores `elev` (float, feet, range −4 … +14) and `ground` (enum derived from elev + water state). Elevation is continuous but rendered in 6 px steps per foot with darker "cliff" side faces where a tile is ≥1 ft above its south or east neighbor.
- Each tile also stores `water` (absolute water surface in feet), `sat` (soil saturation 0–1), `stand` (days of standing water), `mosq` (mosquito density 0–1), `subs` (accumulated subsidence, feet), `eco` (0/1 wetland-original flag).

### Tile types (derived every hydro tick from elev and water)
| Type | Rule | Buildable? | Notes |
|---|---|---|---|
| **Open Water** (river/lake) | elev < 0 and permanent | No | River along east edge; cypress lake in SW. Bridges span channels ≤ 3 tiles. |
| **Bayou Channel** | elev < 0.5, flagged `bayou` (meandering spline) | No (boardwalk/bridge only) | Slow current, gator highway, pirogues drift on it. |
| **Marsh** | 0 ≤ elev < 1.5 | Only with **Pilings** or after **Fill** | Reeds, water hyacinth. Absorbs 2× rain (natural buffer). Fastest subsidence if drained. |
| **Wet Ground** | 1.5 ≤ elev < 3.5 | Yes, buildings cost +20% (foundation) and subside; pilings recommended | Dark mud, cypress knees, standing puddles after rain. |
| **Dry Ground** | 3.5 ≤ elev < 6.5 | Yes, normal | Grass, live oaks. Most of the natural levee's back slope. |
| **High Ground** | elev ≥ 6.5 | Yes, cheaper foundations (−10%) | The natural levee ridge along the river; never floods except by surge > elev. Scarce: ~9% of map. |

Rough distribution at generation: Open Water 10%, Bayou 4%, Marsh 30%, Wet 27%, Dry 20%, High 9%.

### Procedural generation
1. **River:** the Big Muddy runs the full east edge, 4–6 tiles wide, with a gentle sinusoidal bank (`x = 58 + 2*sin(y/9)`).
2. **Natural levee ridge:** elevation falls from +9 ft at the riverbank to +2 ft over 14 tiles westward using `elev = 9 * (1 - d/14)^1.6` — this is real Louisiana geography: the highest ground is next to the river, the backswamp is lowest.
3. **Backswamp basin:** west of the ridge, base elevation 0–2 ft from 2-octave value noise (scale 11 tiles, amplitude 1.8 ft) with a bowl bias toward the southwest corner (cypress lake, elev −2).
4. **Bayou:** a Catmull-Rom spline from the north edge to the SW lake with 5 random control points, carved to elev −1 with 1-tile marsh shoulders; it crosses the mid-map, guaranteeing the player must eventually bridge it.
5. **Islands of dry ground ("chenier" hummocks):** 3–5 noise peaks in the backswamp lifted to 4–5 ft, each 3–6 tiles across — tempting expansion targets that require boardwalks or a causeway.
6. **Vegetation:** live oaks on Dry/High (density 8%), bald cypress on Marsh/Wet/water edges (density 14%), palmetto clumps on Wet (6%), reeds on Marsh (25%). Trees are entities (removable, and count toward ecology).
7. **Start plot:** the 10 × 10 area on the ridge at map center-east is cleared, pre-placed with a Gravel Road stub from the north edge ("Highway 1"), one **Founders' Hall**, one **Trailer Dorm** and the **Chancellor's Trailer**. Seed is stored in the save so the world is reproducible; "New Game" offers *Reroll Map*.

### What terrain means for building
- **Water/Bayou:** nothing but bridges (≤ 3 tiles) and boardwalks.
- **Marsh:** two paths. *Fill* ($60k/tile, raises elev to 2.5 ft, takes 2 days, −1 ecology per tile, tile becomes Wet Ground and subsides 0.25 ft/yr) or *Pilings* (building modifier: +40% cost, building immune to flood depth < 3 ft, no subsidence, keeps ecology).
- **Wet Ground:** buildable; +20% cost; subsides 0.12 ft/yr under a building; floods when water > elev + 0.3 ft.
- **Dry:** default.
- **High:** −10% cost; only floods under surge.
- **Elevation deltas:** roads and buildings require all footprint tiles within 1.5 ft of each other, otherwise the ghost turns red with "Grade the site" (+$15k/tile to level to the mean).

---

## 4. Building Catalog

Conventions: **Footprint** in tiles (w × h). **Cost** one-time; **Upkeep** per month (10 game days). *Cover radius* is in tiles (Chebyshev). All buildings need a path adjacency; those marked ⚡ need Power coverage; 💧 need Water coverage. Wind Rating (WR) 1–5 determines hurricane damage (see §6). "Visual" is the procedural sprite brief: primary color / shape / signature detail. Palette codes in §12.

### 4.1 Paths and roads
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 1 | **Gravel Path** | 1×1, drag | $2k | $0 | Walkable; students move 1.0×. Drag-to-draw. | Start | Tan speckled strip with darker edges; auto-tiles. |
| 2 | **Brick Walk** | 1×1, drag | $6k | $50 | Walkable 1.2×; +1 happiness per 20 tiles within campus; purple-gold tint at edges. | Start | Herringbone rust-red bricks with gold border. |
| 3 | **Boardwalk** | 1×1, drag; may cross Marsh/Bayou | $14k | $150 | Walkable 1.0× over marsh and bayou; no fill, no ecology loss. Ignores flood depth < 2 ft. | Start | Gray-brown planks on visible posts; shadow on water. |
| 4 | **Campus Road** | 1×1, drag | $10k | $100 | Required for Parking, Stadium, service buildings; bus stop every 8 tiles auto-spawns a purple bus. Reduces happiness of adjacent Housing by 1 (noise). | Start | Dark asphalt, gold center dashes, curbs. |
| 5 | **Bridge** | 1×(1–3) span over water | $80k/tile | $300 | Road + walkway over Bayou/Water. | Start | Concrete deck, purple railings, piers into water. |

### 4.2 Utilities
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 6 | **Power Substation** | 2×2 | $250k | $4k | Power cover radius 10; capacity 40 buildings. Summer draw ×1.5 (AC); over capacity → brownouts (−5 happiness, labs stop research). WR 2. | Start | Gray gravel pad, transformer boxes, tall insulators; blue arc spark particle at night. |
| 7 | **Water Tower** | 2×2 | $220k | $2k | Water cover radius 12; capacity 50 buildings. | Start | Classic tower on 4 legs, painted purple with gold "BSU"; blinking red light at night. |
| 8 | **Wastewater Plant** | 3×3 | $400k | $6k | Required once enrollment > 1,500 (else −8 happiness, "campus smells like a boil gone wrong"). Placing on Marsh adjacent to Bayou: −5 ecology once. | 1,000 students | Round concrete clarifier tanks with green-brown water, a low tan office; steam wisps. |
| 9 | **Weather Radar Dome** | 2×2 | $600k | $5k | Hurricane forecast cone appears 8 days out instead of 5; cone width −30%; enables the "Evacuate" action 3 days out. | Prestige 20 | White geodesic sphere on a lattice tower; slow rotating sweep line on the minimap. |

### 4.3 Academic
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 10 | **Founders' Hall** (pre-placed) | 3×3 | — | $8k | 300 seats; 10 faculty; +2 prestige. WR 3. ⚡💧 | Start | Red-tile roof, cream stucco, gold-trimmed clock; the "old campus" look. |
| 11 | **Lecture Hall** | 3×2 | $600k | $10k | 400 seats; 12 faculty. ⚡💧 WR 3 | Start | Rectangular tan brick, tall arched windows, purple awning. |
| 12 | **Science Lab** | 3×3 | $1.4M | $22k | 250 seats; 20 faculty; research $6k/mo × prestige/25; +3 prestige. ⚡💧 WR 3 | 600 students | Glass-and-steel, green-blue glass, rooftop vent stacks with heat shimmer. |
| 13 | **Library** | 4×3 | $1.8M | $14k | +8 prestige; +4 happiness radius 10; unlocks Graduate Apartments. WR 4 | 800 students | Big limestone box, gold dome, columns; warm windows at night. |
| 14 | **Engineering Hall** | 4×3 | $2.6M | $30k | 500 seats; 30 faculty; research $10k/mo; −15% Pump/Levee cost; +4 prestige. ⚡💧 WR 4 | 1,500 students | Gray concrete brutalist, exposed pipes painted gold, rooftop crane model. |
| 15 | **Coastal Studies Institute** | 3×3, must touch Marsh or Bayou | $2.2M | $24k | 150 seats; research $9k/mo × ecology/50; +6 prestige; reveals subsidence overlay; ecology decay −50%. WR 3 (built on pilings by default) | 1,200 students & ecology ≥ 40 | Stilted green-roof building over marsh with a dock, a research airboat. |
| 16 | **Agricultural Center** | 4×4 | $1.5M | $16k | 300 seats; 15 faculty; +4 happiness (farmers' market); grows sugarcane fields on adjacent Wet tiles (visual). WR 2 | 1,000 students | Red barn-style roof, silos, sugarcane rows, purple tractor. |

### 4.4 Housing
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 17 | **Trailer Dorm** (pre-placed / buildable) | 2×1 | $90k | $2k | 60 beds; housing quality 1. WR 1 (blows away in Cat 2+). 💧⚡ | Start | Cream single-wide on cinder blocks, sagging AC unit, gold stripe. |
| 18 | **Freshman Dorm** | 3×2 | $700k | $9k | 300 beds; quality 2. WR 3. 💧⚡ | Start | 4-story brick slab, rows of windows, purple doors, a couch on the roof. |
| 19 | **Residence Tower** | 3×3 | $2.4M | $22k | 900 beds; quality 3; +2 prestige. WR 4 (concrete). 💧⚡ | 1,500 students | 12-story tan concrete tower with vertical gold stripe, rooftop water tank. |
| 20 | **Greek Row House** | 2×2 | $350k | $5k | 80 beds; quality 3; +3 happiness radius 6; +50% tailgate revenue radius 8; +5% gator incidents radius 6 (they leave food out). WR 2. 💧⚡ | 600 students | White antebellum columns, Greek letters in gold, string lights, porch swing. |
| 21 | **Graduate Apartments** | 3×2 | $1.1M | $10k | 240 beds; quality 4; +1 research multiplier for labs within 8. WR 3. 💧⚡ | Library | Modern wood-and-glass, balconies with plants, quiet. |

### 4.5 Dining
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 22 | **Dining Hall** | 3×2 | $500k | $8k | Feeds 1,200; dining cover radius 10; +3 happiness in radius. ⚡💧 WR 3 | Start | Long low building, big windows, steam vents, purple sign "GEAUX EAT". |
| 23 | **Po'boy Shack** | 1×1 | $60k | $1k | Feeds 200; cover radius 5; +2 happiness radius 5; $2k/mo revenue. ⚡ WR 1 | Start | Tiny tin-roof shack, hand-painted sign, a line of students. |
| 24 | **Coffee Kiosk** | 1×1 | $40k | $800 | Attendance +5% radius 6 (energy); $1.5k/mo revenue. ⚡ WR 1 | Start | Purple kiosk with gold umbrella, steam wisp. |
| 25 | **Gumbo Pavilion** | 3×3 | $420k | $6k | Feeds 800; hosts **Crawfish Boil** festival (Mar–Apr: +6 happiness, +$30k); +4 happiness radius 8 on festival days. WR 2 | 800 students | Open-sided timber pavilion, gold roof, giant steaming pot sprite, picnic tables. |

### 4.6 Athletics
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 26 | **Practice Field** | 4×3 | $200k | $3k | Team rating +5; required for football. Doubles as Tailgate field on game days. WR 1 | Start | Striped green turf, gold goalposts, purple blocking sleds. |
| 27 | **Stadium I — "Bayou Field"** | 6×5 | $4M | $30k | 12,000 seats; enables home games; +4 prestige. Adjacent Road required. ⚡💧 WR 3 | 800 students & Practice Field | Single-deck aluminum bleachers on two sides, 4 light poles, gold end zones. |
| 28 | **Stadium II — "The Cauldron"** (upgrade in place) | 6×5 | $14M | $80k | 45,000 seats; +10 prestige; night games unlocked (+8 home win chance); crowd noise shakes screen. WR 4 | Stadium I & 3,000 students | Full bowl, purple upper deck, 6 light masts, "CAULDRON" in gold letters visible from orbit. |
| 29 | **Stadium III — "Cauldron Grand"** (upgrade) | 8×6 | $40M | $180k | 78,000 seats; +18 prestige; fireworks after wins; opponents' win chance −5 ("nobody wins here at night"). WR 5 | Stadium II & 8,000 students & prestige 50 | Three decks, jumbotron with animated tiger, ring of gold light, tailgate city. |
| 30 | **Indoor Practice Facility** | 4×4 | $3M | $18k | Team rating +12; team immune to heat penalty; doubles as hurricane shelter (−50% student injuries). WR 5 | Stadium I | Huge white-and-purple metal barrel roof, tiger silhouette on the side. |
| 31 | **Baseball Diamond** | 4×4 | $900k | $7k | +3 happiness radius 10; $12k/mo Mar–May; +2 prestige. WR 2 | 1,200 students | Red clay diamond, green outfield, small gold bleachers, foul poles. |

### 4.7 Student life
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 32 | **Student Union** | 4×3 | $1.6M | $15k | +8 happiness radius 12; hub for agent idling; hosts Mardi Gras ball. ⚡💧 WR 3 | 600 students | Glass atrium front, purple banners, plaza with fountain. |
| 33 | **Rec Center** | 3×3 | $1.2M | $12k | +6 happiness radius 10; heat penalty −50% radius 10 (pool); "gator in the pool" event possible. ⚡💧 WR 3 | 800 students | Blue lap pool visible from above, climbing wall, gold roof. |
| 34 | **Health Center** | 2×2 | $450k | $6k | Mosquito illness −60% radius 12; hurricane injuries −40%; gator bite recovery instant. ⚡💧 WR 3 | 400 students | White clinic with red cross replaced by a gold fleur-de-lis. |
| 35 | **Quad Lawn** | 2×2 (tileable) | $30k | $300 | +2 happiness radius 6 (stacks to +6); students idle here; live oak auto-planted at center. | Start | Bright green lawn, diagonal paths, blanket picnics. |
| 36 | **Parking Lot** | 3×2 | $150k | $1.5k | Required 1 per 600 students else −4 happiness; generates **parking tickets $4k/mo** (comedy stat); on Wet ground floods first (cars floating = classic screenshot). Road required. | Start | Gray asphalt, white lines, 30 tiny purple/gold/white cars. |
| 37 | **Parking Garage** | 3×3 | $1.1M | $6k | Counts as 4 lots; tickets $12k/mo; rooftop tailgate +$. WR 4 | 2,000 students | 5-level concrete deck, ramps, cars on roof, gold "P". |
| 38 | **Amphitheater** | 3×3 | $700k | $5k | Zydeco concerts every Friday night (+5 happiness radius 12); Mardi Gras parade terminus (+$40k). WR 2 | 1,000 students | Curved stone seating facing a shell stage, string lights, stage glow at night. |

### 4.8 Swamp infrastructure
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 39 | **Earthen Levee** | 1×1, drag | $35k | $400 | Raises tile edge to elev + 6 ft for flow purposes (blocks water below that); walkable on top. Nutria can burrow (integrity). Ecology −0.2 per tile on Marsh. | Start | Grassy trapezoid berm, darker toe, a gravel crown path. |
| 40 | **Concrete Floodwall** | 1×1, drag | $110k | $900 | Blocks water up to elev + 12 ft; immune to nutria; needs Engineering Hall discount to be affordable early. | Engineering Hall or 2,000 students | Gray T-wall panels with purple flood-gauge stripes. |
| 41 | **Drainage Canal** | 1×1, drag | $25k | $500 | Tile becomes channel: water conductance 8× normal; must end at Bayou/Water or a Pump. Standing water on tiles within 2 clears 3× faster. Ecology −0.3/tile on Marsh. | Start | Straight cut with concrete lips, dark water, small culvert pipes at junctions. |
| 42 | **Pump Station** | 2×2, must touch a Canal or Water | $500k | $8k (+$3k while running) | Removes 40,000 "gal-units" (= 1 ft over 40 tiles) per hydro tick from its connected canal network, dumping to Water/Bayou. Needs ⚡; fails in brownout. Loud (−1 happiness radius 4). | Start | Green corrugated pump house, big gold pipes, spinning impeller wheel, discharge foam particle. |
| 43 | **Retention Pond** | 2×2 | $120k | $1k | Absorbs 20,000 gal-units of runoff from tiles within 5 before flooding; mosquito breeding −80% if stocked (auto after 1 month); +2 happiness (fountain). | Start | Blue-green pond, fountain jet, egret standing on the edge. |
| 44 | **Pilings Upgrade** | applied to a building | +40% of that building's cost | +5% upkeep | Building ignores flood depth < 3 ft; no subsidence; allowed on Marsh without fill; keeps ecology. | Start | Building rendered 10 px higher on a grid of dark posts with water/mud visible beneath. |
| 45 | **Gator Fence** | 1×1, drag | $8k | $80 | Gators cannot cross; students can (gates every tile). Blocks nutria too. Breaks in Cat 3+ winds (30% per segment). | Start | Chain-link with gold posts, "GATOR X-ING" sign every 6 tiles. |
| 46 | **Mosquito Abatement Station** | 1×1 | $90k | $2.5k | Fogger truck patrols paths within radius 8 at dusk; mosquito density −70% in radius; ecology −0.5/mo while active (toggleable). | Start | Small purple shed with a fogger truck that visibly drives and emits a white fog trail. |
| 47 | **Cypress Preserve** | 3×3 on Marsh/Wet, no fill | $150k | $1k | +5 ecology; tiles within 6 gain +50% rain absorption; fireflies ×3 at night; dragonflies −30% mosquitoes radius 6; +2 prestige if Coastal Institute exists; gators prefer to live here (−40% campus incursions if ≥ 2 preserves). | Start | Dense bald cypress with knees, moss, a wooden lookout tower, a pirogue tied to a post. |
| 48 | **Wildlife Officer Post** | 1×1 | $140k | $4k | Officer agent relocates gators within radius 14 (walks to gator, 3-s wrestle animation, gator vanishes to nearest preserve); nutria −50% within 14. | Start | Khaki cabin with a purple truck, airboat, wanted-poster board. |
| 49 | **Nutria Bounty Post** | 1×1 | $60k | $1.5k | Nutria population −70% in radius 10; levee integrity decay −80% within 10; $500/mo "pelts" revenue; +1 happiness (students love the bounty board). | Start | Tiny hut with a stack of pelts, a shotgun rack, a hand-painted "$5 A TAIL" sign. |

### 4.9 Landscaping
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 50 | **Live Oak** | 1×1 | $12k | $0 | +1 happiness radius 4; heat penalty −30% radius 3; +0.3 ecology; sways; moss. Grows over 3 years from sapling to giant (canopy 3 tiles wide visually). WR 5 (they survive). | Start | Massive dark trunk, spreading olive-green canopy, gray-green moss strands. |
| 51 | **Bald Cypress** | 1×1 on Wet/Marsh | $8k | $0 | +0.5 ecology; drinks 500 gal-units per tick from its tile (tiny natural pump); cypress knees; turns rust-orange in Nov. | Start | Tall conical, feathery orange-green, flared trunk, knees poking from water. |
| 52 | **Azalea Bed** | 1×1 | $5k | $100 | +1 happiness radius 3; blooms hot pink/purple in Mar–Apr with petal particles. | Start | Low mound of dark green; pink/magenta bloom sprite state. |
| 53 | **Fountain Plaza** | 2×2 | $180k | $1.5k | +3 happiness radius 6; heat −20% radius 4; students toss coins ($200/mo). | Start | Round stone basin, purple-lit water jets at night. |
| 54 | **Crawfish Pond** | 2×2 on Wet | $70k | $500 | $3k/mo Mar–May; feeds Gumbo Pavilion (+2 happiness campus-wide during Crawfish season); attracts 1 gator per month (counterplay: fence). | Start | Flooded rectangular field with white trap buoys in rows, a johnboat. |

### 4.10 Prestige landmarks
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 55 | **The Bell Tower** | 2×2 | $2.5M | $5k | +10 prestige; +3 happiness campus-wide; bells at noon/6 PM (audio); beacon at night. WR 5 | 2,000 students | 175-ft tan limestone tower, gold clock faces, purple flag; gold light halo at night. |
| 56 | **Tiger Habitat — home of "Roux"** | 3×3 | $1.8M | $12k | +8 prestige; +5 happiness radius 15; Roux visible pacing; +5% home win chance; students take selfies (idle animation). WR 4 | 1,000 students | Naturalistic enclosure: rock, pool, live oak, glass wall, an orange-and-black tiger sprite that yawns. |
| 57 | **Mardi Gras Float Barn** | 4×3 | $900k | $6k | Mardi Gras parade rolls through campus (Feb): +12 happiness for the month, +$120k merch, bead particles everywhere; +3 prestige. | 1,500 students | Big purple warehouse with open doors showing a glittering float (papier-mâché tiger head). |
| 58 | **Riverboat Landing** | 3×2 on river bank | $1.4M | $4k | Paddlewheel riverboat docks weekly: +$25k tourism, +2 prestige, donors arrive by boat (donations +10%). | 1,500 students & High Ground riverbank | Wooden pier, white paddlewheeler with red wheel and gold trim, steam. |
| 59 | **Presidential Memorial Oak Alley** | 1×8 strip | $600k | $1k | 8 live oaks in a double row forming a moss tunnel; +6 prestige; +4 happiness radius 8; wedding-photo tourism $5k/mo. | 3,000 students | Two rows of oaks meeting overhead, brick path, lanterns. |
| 60 | **Chancellor's Mansion** | 3×3 on High Ground | $2M | $8k | +5 prestige; donations +15%; unlocks "Gala" event each spring (+$200k, +3 happiness). WR 4 | 4,000 students | White columns, green shutters, gallery porch, magnolia trees, a fountain. |

Sixty entries; the required 25–40 minimum is comfortably exceeded so that the engineering team can cut (§15) without falling below it.

---

## 5. Economy

### Starting state
- **Cash:** $4,000,000. **Debt line:** up to −$2,000,000 at 1%/month interest ("legislative bridge loan").
- **Students:** 400. **Faculty:** 10. **Tuition:** $9,000 per semester (slider $4,000–$20,000, step $500).
- **Prestige:** 10 / 100. **Happiness:** 60 / 100. **Ecology:** 82 / 100 (fraction of pristine wetland).
- **Date:** July 1, Year 1 (summer; hurricane season open).

### Money sources (per year, at start / at 5,000 students)
| Source | Formula | Start | Mid-game |
|---|---|---|---|
| **Tuition** | `students × tuition`, paid Aug 15 and Jan 10 | $7.2M | $90M |
| **State funding** | `students × 3,000 × (0.6 + 0.8 × prestige/100) × ecoPenalty`, July 1. `ecoPenalty = 0.85 if ecology < 30 else 1.0` (the coastal caucus is watching) | $0.8M | $18M |
| **Donations** | monthly: `alumni × 4 × (0.5 + prestige/100) × footballMult × mansionMult`. `alumni` = cumulative graduates (starts 0; +`students × 0.22` each May 10). `footballMult` = 1.0 + 0.1 per win last season, capped 2.0 | $0 | ~$3M |
| **Research grants** | sum of lab research values × `(0.5 + prestige/100)` | $0 | $2–4M |
| **Athletics** | per home game: `attendance × ticket($35 base; $60 Stadium III) + attendance × $12 concessions + tailgateRevenue`. Attendance = `min(capacity, students × 2.5 × hype)`, `hype = 0.6 + winPct × 0.5 + rivalry(0.3)` | $0 | $6–25M |
| **Parking tickets** | $4k per lot, $12k per garage per month | $0 | $0.5M |
| **Festivals & tourism** | Crawfish boil $30k, Mardi Gras $120k, Gala $200k, riverboat $25k/wk, oak alley $5k/mo | $0 | $1.5M |
| **Nutria pelts** | $500/post/mo | — | trivial, funny |

### Costs
| Cost | Rule |
|---|---|
| **Construction** | catalog cost × terrain modifier (Wet +20%, High −10%, Pilings +40%, Fill $60k/tile, Grading $15k/tile). |
| **Upkeep** | sum of monthly upkeep, charged on the 1st. |
| **Salaries** | `faculty × $9,000/mo`. Faculty auto-hires with academic buildings; **Faculty Quality slider** (1–3) multiplies salary and adds +0/+3/+8 to prestige target. |
| **Coaching budget** | slider $0–$3M/yr; adds `budget/100k` to team rating (max +30). |
| **Disaster repair** | damaged building: repair cost = `damage% × catalog cost × 0.6`; unrepaired buildings operate at `(1 − damage%)` and leak −2 prestige/mo each. Auto-repair toggle. |
| **Utilities over capacity** | brownout penalties rather than money. |
| **Interest** | 1%/mo on negative balance. |

### Enrollment model (runs Aug 15 for the year; spring admits 25% of the gap)
- `applicants = (60 + 28 × prestige + 6 × happiness) × tuitionFactor × footballBuzz`
  `tuitionFactor = clamp(1.7 − tuition / 14,000, 0.3, 1.5)` (at $9k → 1.06; at $15k → 0.63; at $5k → 1.34)
  `footballBuzz = 1 + 0.03 × winsLastSeason` (bowl win +0.1)
- `capacity = min(beds × 1.15 (some commute), seats × 1.4 (multiple sections), diningCapacity × 1.6)`
- `newStudents = min(applicants, capacity − currentStudents)`; **admission selectivity** slider (Open / Selective / Elite) accepts 100% / 60% / 35% of applicants and gives 0 / +4 / +10 prestige target.
- **Attrition** each semester end: `students × (0.03 + (100 − happiness)/100 × 0.15)`; at happiness 60 → 9%; at 85 → 5.25%.
- **Graduation** May 10: 22% of students become alumni.
- Starting example: prestige 10, happiness 60 → applicants ≈ (60 + 280 + 360) × 1.06 ≈ 742; if you built 1 Freshman Dorm (360 total beds → cap 414) and a Lecture Hall (700 seats), enrollment is bed-capped: **the tutorial's first lesson is "beds are the bottleneck."**

### Prestige model (0–100)
`target = 0.22 × academicQuality + 0.14 × facultyRatio + 0.16 × happiness + 0.16 × football + 0.12 × landmarks + 0.10 × ecologyBonus + 0.10 × selectivity − blight`
- `academicQuality` = 0–100 from labs/library/engineering/coastal presence and seats per student (≥1.2 seats/student = 100).
- `facultyRatio` = clamp(100 × (faculty × 25 / students), 0, 100) × faculty quality (1/1.15/1.35).
- `football` = 0–100 from last season's win % (60% weight) + stadium tier (40%).
- `landmarks` = sum of landmark prestige values ×2, capped 100.
- `ecologyBonus` = ecology if Coastal Institute exists, else ecology × 0.4.
- `blight` = 3 per unrepaired damaged building + 8 if any tile of the campus core (buildings) is flooded > 3 days + 5 if mosquito density on campus > 0.6.
- Prestige moves toward target at **6% of the gap per month** — slow enough to reward planning, fast enough to see it move each semester. Milestone effects (§10) give instant +2 to +5 bumps.

### Happiness model (0–100, recomputed daily, displayed smoothed)
`happiness = 50 + housing + dining + life + green + spirit − mosquito − flood − gator − heat − tuition − crowd − noise`
- `housing` = avg housing quality × 4 (max +16) − 10 if beds < students.
- `dining` = +8 if ≥ 90% of housing tiles inside a dining radius, scaled down; −10 if none.
- `life` = Union +8, Rec +6, Amphitheater +5, Greek +3, Baseball +3, all as radius coverage % of housing.
- `green` = min(10, quads×2 + oaks×0.3 + fountains×3).
- `spirit` = +2 per home win in season, +6 after beating a rival, +5 during Mardi Gras/Crawfish/Homecoming.
- `mosquito` = avg campus mosquito density × 25.
- `flood` = 4 × (number of flooded buildings) up to 20, +10 if dorms flooded.
- `gator` = 3 per gator incident in last 10 days (max 15).
- `heat` = summer heat index penalty 0–10 (shade/pool/fountain coverage reduces).
- `tuition` = max(0, (tuition − 10,000)/500) (at $15k → −10).
- `crowd` = 10 × max(0, students/seats − 1).
- `noise` = 1 per road-adjacent dorm, 2 per pump within 4 of dorm.

### Key feedback loops
1. **Growth flywheel:** prestige → applicants → tuition → buildings → academic quality/landmarks → prestige.
2. **Football flywheel:** stadium → attendance → athletics revenue → coaching budget → wins → spirit, donations, applicants → bigger stadium.
3. **The swamp tax (the counterweight):** cheap growth means filling marsh → ecology falls → rain absorption falls and mosquitoes rise → flooding and illness → happiness and prestige fall → applicants fall. Preserving marsh and building on pilings is slower and pricier but compounding-safe. **This tension is the game.**
4. **Subsidence time bomb:** buildings on Wet/filled ground sink; after ~6 years a 2 ft drop puts them below the 1-year flood line. Pilings or periodic re-grading ($) are the answer; the Coastal Institute shows the overlay.
5. **Hurricane shock:** a Cat 3 can erase a year of unrepaired progress; levees, pumps, WR, shelters and evacuation convert catastrophe into a manageable bill — and the recovery story ("Cauldron reopens 30 days after Delphine") gives +prestige.

---

## 6. Swamp Survival Systems

### 6.1 Hydrology
**State per tile:** `elev`, `water` (absolute surface ft), `sat` (0–1), `stand` (days). **Hydro tick** every 250 ms game time (every 2.5 ticks at 1×; runs on a fixed accumulator so it's speed-independent).

**Rain input.** Weather sets `rainRate` (ft/day: drizzle 0.05, rain 0.15, storm 0.4, tropical 1.2, hurricane 2.5). Per hydro tick each land tile gains `rainRate × dt`. Marsh tiles first fill `sat` (absorb 2× before surface water forms); Cypress Preserve radius ×1.5; Retention Pond radius pulls runoff into its stored volume.

**Flow.** For each tile, for each of 4 neighbors: `head = water_i − water_j`; if head > 0, move `min(head/2 × k, depth_i)` where `k = 0.35` normally, `k × 8` if either tile is a Canal, `k × 0.1` across a Levee edge until `water > levee crest` (elev + 6 for earthen, +12 for floodwall), and 0 into Open Water/Bayou tiles which act as infinite sinks *unless the river stage is elevated* (surge), in which case they act as sources at the surge height. Two passes per tick (checkerboard) keep it stable. Cost: ~4,096 × 4 = 16k ops per tick — trivial.

**Evaporation/infiltration.** Each tile loses 0.02 ft/day + 0.06 on Dry/High (drains), 0.01 on Marsh. Bald Cypress −0.03 on its tile. Pumps remove volume from their canal network.

**Flood depth** `D = max(0, water − elev)`.
- D > 0.3 ft on a path: students walk 0.5×, splash particles.
- D > 0.5 ft on a building (D > 3 ft if on pilings): **flooded** — closes (no seats/beds/revenue), takes 2% damage/day, mosquito breeding ×2. Parking lots flood at 0.3 ft (cars bob).
- `stand` increments daily when 0 < D < 1.0; drives mosquitoes.

**Overlays:** *Flood Risk* colors tiles by predicted depth under a 0.4 ft/day 3-day storm (fast forward the sim on a copy 12 ticks — cheap); *Water* shows current depth blue gradient; *Drainage* shows canal networks and pump coverage.

**Counterplay summary:** grade, drain (canals to bayou), pump, raise (fill), stilt (pilings), buffer (preserves/ponds), wall (levee/floodwall), and simply *build on the ridge*.

### 6.2 Hurricane season
**Window:** June 1 – Nov 30 each year. **Storm count:** Year 1: exactly 1 (scripted, see §10); later years 1–3, `P(3) = 0.25`. Peak probability Aug 15–Oct 1.

**Lifecycle (game days):**
1. **Tropical wave (T−8):** ticker line only ("A tropical wave off Africa has forecasters mildly interested").
2. **Named storm (T−5, or T−8 with Radar):** the **forecast cone** appears on the minimap and world map: a translucent purple-red fan from the Gulf (south edge) toward a landfall point on the map's south/east edge. Cone width shrinks daily. Category forecast shown with ±1 uncertainty. Newsflash with the storm name.
3. **Watch (T−3):** *Preparation actions* unlock in the Storm panel: **Board Up** ($5k per building, wind damage −40%), **Sandbag** ($10k per 10 tiles, +1.5 ft temporary crest for levees/tiles for 5 days), **Evacuate** (cancel classes: happiness −6, injuries −90%, tuition unaffected), **Pre-drain** (run pumps at 2× cost to lower `water` ahead of time). Skies go greenish-gray; wind picks up; moss streams sideways.
4. **Landfall (T0), the set piece — 90 seconds real time at 1×:** sky darkens to near-night; rain at 2.5 ft/day; wind gusts sweep the map as visible particle sheets; lightning every 3–8 s with screen flash and 6-px shake; **storm surge** raises the river/bayou stage by `surge` over 20 s and it floods inward through the hydrology (so levees visibly hold or overtop); wind damage applied in 4 pulses; trees bend 20°; Trailer Dorms tumble across the map as physics-lite sprites; a stadium light mast sparks out; the soundtrack becomes wind + thunder. Camera can't be paused during landfall but speed can be lowered to 0.5×.
5. **Recovery (T+1…T+30):** rain 0.15/day tapering; damage report modal with itemized bill and one-click "Repair All ($)". Roads with debris (walk 0.5×) auto-clear over 5 days, or instantly with a Wildlife/Facilities post nearby. Ticker celebrates each reopening. **Story beat:** if the stadium reopens within 30 days and a home game is played, +4 prestige "Resilience Bowl."

**Categories:** surge (ft above normal river stage): Cat1 3, Cat2 6, Cat3 9, Cat4 13, Cat5 18. Wind damage per pulse = `baseDmg[cat] × (6 − WR)/5 × boardUp(0.6)`; `baseDmg` = 4%, 9%, 16%, 26%, 40%. Trailer Dorms (WR 1) are destroyed outright at Cat 2+. Trees: live oaks 2% loss at Cat 4+; cypress never; azaleas shredded (regrow). Gator fences 30%/segment broken at Cat 3+. Power substations at Cat 3+ have a 40% chance of a 3-day outage (dark campus at night — spectacular and menacing). Injuries: `students × 0.002 × cat` unless evacuated/sheltered; each injury −0.5 happiness and −$2k medical.

**Storm names (fictional, alphabetical, Louisiana-flavored):** Amélie, Boudreaux, Célestine, Delphine, Étienne, Fontenot, Guidry, Hébert, Isidore, Justine, Kingfish, Landry, Mignon, Narcisse, Odile, Pascal, Quentin, Rémy, Sosthène, Thibodeaux, Ulysse, Violette, Wilhelmina, Xavier, Yvette, Zéphyrine.

**Counterplay:** Levee/Floodwall along river and bayou edges (the *surge* comes from water tiles, so a closed loop around the campus core matters — the game highlights the gap in the loop when the cone appears: "Your levee has a 4-tile gap at the Bayou crossing"), pumps for the rain that falls inside the loop, pilings, high WR buildings, Indoor Practice Facility as shelter, Radar for early warning, Board Up/Sandbag/Evacuate, and cash reserves.

### 6.3 Gators
- **Population:** `gators = 6 + floor(waterTiles / 40)`, capped 30. They live as agents. Spawn in Bayou/Water tiles adjacent to Marsh; they sleep 60% of the day (sunning on a bank sprite), swim along the bayou (1 tile/2 s), and **wander** onto land when (a) it is dusk/dawn, (b) a Crawfish Pond, Greek Row, Dining Hall dumpster, or flooded tile is within 8 tiles (attraction weight 3/2/2/4), or (c) mating season (Apr–May, roam radius ×2).
- **Behavior on campus:** walks 1 tile/1.5 s; students within 2 tiles enter *Flee* (scatter, "!" bubble, happiness incident logged once per gator per day); parks on paths (blocks a tile for 30–120 s — students route around); may enter the Rec Center pool ("Gator in the pool!" newsflash, Rec closed for 1 day) or sun on the 50-yard line on a game day (delay kickoff 1 day, +3 happiness because everyone loves it).
- **Incidents:** `gator` happiness penalty above; a **bite** occurs with P = 0.5% per student-gator contact per second without a Health Center; bite = −$5k, −2 happiness, ticker line. No deaths; this is a comedy.
- **Counterplay:** Gator Fence (impassable), Wildlife Officer (relocates within 14 tiles; 3-s wrestle animation with dust cloud), Cypress Preserves (≥2 → gators prefer preserves; incursions −40%), keeping food attractors fenced, not flooding (flooded tiles are gator highways — a hurricane surge brings a gator wave: 3–8 extra gators spawn in flooded campus tiles for 10 days after landfall; screenshot fuel).
- **Charm:** named gators (the Wildlife Officer's log: "Big Al", "Beignet", "Marie Laveaux", "Chomp Chomp", "Ol' Frontenac", "Tabasco", "Professor Snaps"); one legendary 15-ft gator "Le Grand" appears once a year with a unique ticker line and gives +1 prestige if photographed (click him).

### 6.4 Mosquitoes
- **Breeding:** each hydro day, for tiles with `stand ≥ 2`: `mosq += 0.12 × (1 + flooded building ×1)`; Retention Pond (stocked) −80% on its tiles; Preserve radius 6 −30% (dragonflies); every tile diffuses 15% of its density to neighbors daily; decay 0.06/day, 0.12 in Dec–Feb (cold snap), 0 in Jul–Aug.
- **Visual:** density > 0.3 renders a faint gray drifting "haze" of 1-px dots over the tile at dusk; > 0.6 the haze is dense and audible (whine in ambience mix) and students slap themselves (animation).
- **Effects:** happiness −25 × avg campus density; **illness**: each day `sick = students × density × 0.02` (Health Center within 12: −60%); sick students skip class (attendance → research and academic quality −). A newsflash at campus avg > 0.5: "Mosquito index: BIBLICAL."
- **Counterplay:** drain standing water (canals, grading, pumps), Abatement Stations (fogger drives at dusk: −70% radius 8, ecology cost), Retention Ponds, Preserves, Health Center, Purple Martin Houses (ecology-friendly; treat as a free landscaping variant of Azalea Bed: birdhouse on a pole, −20% radius 4; included in catalog as an option of #52 to keep the count sane).

### 6.5 Subsidence
- Every Jan 1: tile `subs += rate` where rate = 0.25 ft/yr for Filled marsh, 0.12 for Wet Ground under a building, 0.05 for Wet Ground bare, 0.02 for Dry, 0 for High Ground, 0 under Pilings. Drained marsh (canal within 2 and no preserve) +0.1 extra (peat oxidation). `elev −= rate` effectively.
- After 4–6 years, early Wet-ground buildings drop below the rain flood line: the game surfaces this with a **Subsidence overlay** (unlocked by the Coastal Institute, but a coarse "Sinking!" warning icon appears on any building whose elev fell 1 ft regardless).
- **Counterplay:** Pilings (retrofit at +40%), Re-grade ($15k/tile, raises 1 ft, takes 3 days, building closed), build on ridge, preserve marsh instead of draining it.

### 6.6 Heat and humidity
- **Heat index** per day: base by month (Jan 55, Apr 78, Jun 94, Jul 101, Aug 103, Sep 96, Oct 84, Dec 60) + noise ±6; humidity is cosmetic (haze thickness) except it doubles mosquito growth when > 70%.
- Effects when heat index > 92: happiness `heat` penalty = (index − 92)/2 capped 10, reduced by shade coverage (oaks/alley), pool, fountains, and −5 flat during "class in the AC" hours; power draw ×1.5 (brownout risk); team rating −8 for practices unless Indoor Facility; students walk 0.8× and idle under oaks; heat shimmer on roads and roofs.
- **Counterplay:** live oaks (the cheapest happiness in the game — intentionally), Rec Center pool, fountains, substation capacity, Indoor Practice Facility.

### 6.7 Nutria and other wildlife
- **Nutria:** population `4 + marshTiles/60`; each month each nutria has a 20% chance to burrow into a random Earthen Levee tile within 10 of marsh: integrity −15% (a levee at < 50% integrity is treated as 3 ft lower crest; at 0% it breaches under any surge). Visible as orange-toothed brown rodents scurrying at night. Counterplay: Bounty Post, Wildlife Officer, Floodwalls (immune), inspect-and-repair ($5k per tile).
- **Egrets/herons:** purely visual; stand on ponds and marsh, fly off when students or gators approach. Density scales with ecology.
- **Roseate spoonbills:** appear at ecology ≥ 70 in Preserves (pink flock circling at dawn: prestige photo-op +1 the first time).
- **Fireflies:** ecology ≥ 50 → firefly particles at night over Marsh/Wet/Preserves, count scales with ecology (up to 600 on screen).
- **Bullfrogs/cicadas:** audio only, scaled by ecology and season.
- **Pelicans** on the river; **armadillo** crossing the road at 2 AM (ticker gag).

### 6.8 Ecology score (0–100)
`ecology = 100 × (wetlandTilesRemaining / wetlandTilesOriginal) × 0.7 + preserveBonus + cypressBonus − foggerPenalty − wastewaterPenalty`, clamped 0–100; `preserveBonus` +5/preserve (max 20); `cypressBonus` +0.3 per cypress (max 10); active foggers −0.5/mo cumulative (recovers +0.3/mo when off).
- **Costs of destroying swamp:** each filled marsh tile −1 permanent; canal on marsh −0.3; levee on marsh −0.2; below 30: state funding −15%, fireflies vanish, mosquitoes +50% growth, natural rain absorption gone (flooding noticeably worse), ticker turns hostile ("Coastal caucus calls BSU 'a parking lot with a football team'").
- **Benefits of preserving:** rain buffer, mosquito predators, Coastal Institute research × ecology/50, prestige bonus weighted by ecology, the fireflies-and-spoonbills spectacle, "Green Campus" achievement, and the preserves keep gators home.

---

## 7. Student Life (light)

- **Abstracted count:** `students` (int) drives all economics. **Visual agents:** `min(300, 40 + students/25)`; each visual agent represents `students / agentCount` real students. On a 64×64 map with 300 agents at up to 4 buildings each, agent CPU is < 1 ms/frame.
- **Sprite:** 12 × 20 px pixel-art figure: skin tone (6 options), hair (8), shirt color weighted 55% purple, 25% gold, 20% white/other; backpack; occasional props (umbrella when raining, cup from coffee kiosk, foam finger on game day, beads during Mardi Gras). 4-frame walk cycle in 4 isometric directions, 2-frame idle, flee pose, splash pose, cheer pose.
- **Stats (per agent, 0–1):** `mood` (blend of campus happiness + personal events), `energy` (drops through day, restored by dorm/coffee), `wet` (rain/flood exposure; wet agents are miserable and drip), `bitten` (mosquito count today, visible slap animation at ≥3). Mood is displayed as a face icon in the inspect panel and as color of the tiny "thought bubble" when clicked.
- **Schedule (state machine, driven by game clock):** 07:00 wake at dorm → 08:00–16:00 alternate Class (academic building with seats, 45 game-min) → Eat (nearest dining coverage) → Idle (quad/union/oak shade; heat pushes to shade/pool) → 18:00 Amphitheater/Union/Greek Row → 23:00 return to dorm. Fridays: concert. Game days: tailgate from noon, migrate to stadium at kickoff, cheer, exit as fireworks pop. Mardi Gras: parade route following. Hurricane landfall: if evacuated, agents board buses and leave (campus empties — eerie); else shelter in nearest WR ≥ 4 building, a few stragglers get blown around comically.
- **Reactions that make the sim legible:** flee gators ("!" bubble), splash and slow in floods (parking lot wading is a running gag), slap at mosquitoes, wilt under heat (slower, sit under oaks), cheer at touchdowns (crowd wave in stadium is a separate 2-px "crowd shader," not agents), throw beads, drift on pirogues in the bayou near a Preserve (ecology flavor), take selfies at Roux's habitat and the Bell Tower.
- **How they affect the sim:** attendance % (agents that reached class today / agents assigned) modulates academic quality by ±10%; a gator or flood that blocks the only path to the Lecture Hall shows up as an attendance drop — the player *sees* the problem before reading a number. Happiness is campus-wide (not per-agent), but the inspect panel's sample quotes ("Class was underwater again, cher.") are drawn from the agent's current state.
- **Pathfinding:** A* over the walkable grid (paths, boardwalks, quads, roads, any Dry/High tile at 0.6× speed, Wet at 0.4×, Marsh impassable unless boardwalk, flooded > 0.6 ft impassable). Paths cached per (from, to) building pair and invalidated on build/flood change.

---

## 8. Sports (light)

- **Calendar:** 12 games, Saturdays (every 7th day treated as Saturday from Sep 3 → Nov 19), 6 home / 6 away; the **Homecoming** game (5th home) and the **Rivalry Game vs. Magnolia State** (last game, Nov 19, home in even years) are flagged. **Bowl** on Dec 20 if ≥ 7 wins (+$1.5M, +5 prestige if won). No football before Stadium I; the Practice Field lets you "field a team" that plays away games only (small revenue, tiny prestige).
- **Team rating (0–100):** `20 + facilities (Practice 5, Indoor 12) + coaching (budget/100k, max 30) + recruiting (prestige/4, max 25) + morale (happiness/10, max 10) + Roux (+3) − heat (8 if no Indoor and Aug–Sep)`.
- **Opponent rating:** fixed per school + season noise ±8. Schools: Magnolia State (78, arch-rival), Crescent City University (70), Delta A&M (62), Gulf Coast Tech (58), Pineywoods State (52), Sabine River Baptist (45), Arkla Tech (48), Vermilion College (40), Atchafalaya Poly (55), Ozark Mountain U (66), Red Clay State (72), Coastal Carolina-style "Sea Island College" (50).
- **Win probability:** `P = 1 / (1 + 10^((opp − team − home)/25))`, `home = 6` day game, `14` night game (Stadium II+; night games are chosen automatically for rivalry/homecoming and by a toggle otherwise, attendance ×1.15, upkeep +$40k). Stadium III: opponent −5.
- **Game day event (real-time ~40 s at 1×):** Noon: tailgate grid spawns on Practice Field/parking/Greek Row — purple tents, smokers with smoke particles, cornhole, pirogue-as-cooler; agents mill. Kickoff: stadium crowd shader fills to attendance %, light masts on at dusk. The game itself is abstracted into 4 "quarters" of 8 s: score bug in the HUD updates with drives; each score triggers crowd pulse, brass sting, 150-ms shake (home) or groan (away). Final: fireworks (home win), ticker recap, revenue toast, spirit adjustment. Rain shifts crowd to ponchos (attendance −10%); a hurricane within 3 days postpones.
- **Rivalries:** Magnolia State — beating them: +6 spirit, +3 prestige, donations ×1.3 for the month, achievement. Losing 3 straight: "Fire the coach" newsflash offering a $500k buyout that rerolls a hidden coach modifier (−5…+10).
- **Decisions (the "few"):** coaching budget slider; night game toggle; ticket price (3 tiers: $25/$35/$60 with attendance elasticity −15%/0/+0 at Stadium III only); stadium upgrade timing; schedule a home game right after a hurricane (revenue and morale vs. injury risk if repairs incomplete).
- **Revenue and prestige:** in §5. A sold-out Cauldron Grand night game ≈ $6.6M per game — the athletic department funds the labs, exactly as in real life.

---

## 9. Time and Calendar

- **Simulation tick:** 10 ticks/second at 1×. Render is uncoupled (rAF, 60 fps target). Speeds: **Pause, 1×, 2×, 4×** (keys Space, 1, 2, 3). Hurricane landfall caps speed at 1×.
- **Day:** 80 ticks = **8 s** at 1×. Day phases: Dawn 05:00–07:00, Day 07:00–18:00, Dusk 18:00–20:00, Night 20:00–05:00 — so ~37% of the visual day is dark or golden hour, because night is where the game looks best.
- **Month:** 10 days. **Year:** 12 months = 120 days = **16 min at 1×** (4 min at 4×). Target: first major milestone ("First Home Game") by minute 20–25; "Flagship" (10k students) by minute 60–90 at mixed speeds.
- **Academic calendar:** Fall semester Aug 15 – Dec 10 (tuition Aug 15; finals week Dec 1–10, students go to library); Winter break Dec 10 – Jan 10 (campus quiet, cold snap kills mosquitoes); Spring Jan 10 – May 10 (tuition Jan 10; graduation May 10 with caps thrown as particles); Summer May 10 – Aug 15 (fewer agents, build season, heat).
- **Seasons and weather:** Winter: mild, fog mornings (40%), light rain. Spring: azaleas, thunderstorms (30%/day), crawfish. Summer: daily afternoon storms (55%), heat, hurricane season. Fall: clear gold light, football, still hurricane risk through Nov, cypress turns orange in Nov.
- **Hurricane season:** Jun 1 – Nov 30.
- **Festival days:** **Mardi Gras** Feb 20–22 (parade if Float Barn, beads everywhere, classes "cancelled" — agents party; +happiness), **Crawfish Season** Mar 1 – Apr 30 (boils at Gumbo Pavilion each weekend), **Homecoming** 5th home game (bonfire on the quad the night before — fire particles, +3 happiness), **Graduation** May 10, **Fourth of July** fireworks over the river, **First Night Game** (a scripted festival the first time Stadium II hosts a night game), **Zydeco Fridays** (Amphitheater).
- **Autosave:** every game month (every 80 s at 1×) and on tab hide; 3 rotating slots + manual save.

---

## 10. Onboarding and Progression

### The first 2 minutes (guided, by doing; game runs at 1× with a soft spotlight on the target)
The tutor is **"Ms. Thibodeaux, Chancellor's Chief of Staff"** — a portrait in the corner of the objective card, two lines of copy max per step.

| Time | Step | Player action | What they learn |
|---|---|---|---|
| 0:00 | Cinematic pan (skippable): camera sweeps from the black swamp across the bayou to the ridge; a title card, then the tiny campus. | Watch 6 s | The world is big and wet; you are small. |
| 0:06 | **"Welcome to Bayou State, Chancellor. 400 freshmen arrive in six weeks. They need beds."** Objective: *Place a Freshman Dorm on the ridge* (palette opens to Housing; ghost auto-highlights Dry/High tiles green, Wet tiles yellow with "sinks!"). | Click, place | Palette, ghost preview, terrain colors. |
| 0:25 | **"Nobody walks through mud, cher."** Objective: *Connect it with a Brick Walk to Founders' Hall.* | Drag path | Drag-to-draw; connection indicator. |
| 0:40 | **"It rained last night. Press F to see where the water wants to go."** Objective: *Open the Flood Risk overlay.* (the low tile south of the dorm glows.) | Press F | Overlays; the map is a bowl. |
| 0:50 | **"Cut a canal from that low spot to the bayou."** Objective: *Draw a Drainage Canal reaching the Bayou.* Ticker: "Facilities crew reports a gator sunning on the culvert." | Drag canal | Hydrology; canals must reach water. |
| 1:10 | **"Enrollment locks in on August 15. Set tuition."** Objective: *Open the Budget panel and confirm tuition* (slider shows applicants preview live). | Adjust slider | Economy panel; applicants vs capacity. |
| 1:25 | **"Last thing: the Gulf sends storms every August. Build a Levee along the bayou edge — even one tile."** Objective: *Place 3 tiles of Levee.* | Drag levee | Levees; foreshadow the set piece. |
| 1:45 | **"Now build me a university. Press 2 to speed time."** The objective chain continues (below). Cinematic music sting; HUD fully unlocked. | — | Speed controls; they're on their own but guided. |

Every step: a spotlight ring on the target palette button, a pulsing arrow on the suggested tile, and completion fires a chime + gold toast + $50k "Legislature approves" bonus (so the tutorial pays for itself).

### The guided objective chain (always one active card, dismissible, resumable; each gives a cash/prestige bump)
1. Reach 600 students → unlocks Science Lab / Student Union.
2. Build a Dining Hall (happiness lesson).
3. Survive **Hurricane Célestine** (scripted Cat 2 landfall on **Sep 8, Year 1**, cone appears Sep 3: ~11 min into a 1× game, ≤ 20 min total with tutorial and 2× use; it hits *whatever* the player has, and it is tuned so that a 3-tile levee and a canal make it survivable but exciting — surge 6 ft against a ridge at 7–9 ft with the low southern lots taking water).
4. Repair all storm damage (introduces repair UI) → "Storm Chaser" achievement.
5. Build Practice Field + Stadium I; play the first home game.
6. Build a Cypress Preserve (ecology lesson; fireflies appear that night — timed so the first night after placement is clear-skied).
7. Reach 1,500 students; place a Pump Station.
8. Beat Magnolia State (may take seasons).
9. Reach prestige 30 → landmark unlocked; build the Bell Tower.
10. 5,000 students / Stadium II / first night game (the screenshot moment, staged: the game guarantees a clear night and a Sept–Oct home game for the first Stadium II game).
11. Reach ecology ≥ 60 while ≥ 5,000 students ("you can have both").
12. Flagship: 10,000 students, prestige 60, Stadium III → "Geaux Forever" — sandbox continues with the ticker acknowledging the achievement.

### Milestones / achievements (22)
1. **Cher, Welcome** — finish the tutorial.
2. **First Bell** — 600 students.
3. **Bed Head** — 1,000 beds.
4. **Wet Feet** — first flooded building (a consolation, with advice).
5. **High and Dry** — a full levee loop around the core with no gaps.
6. **Storm Chaser** — survive first hurricane with < 20% damage.
7. **Eye of the Storm** — survive a Cat 4+ with zero flooded buildings.
8. **Pump It Up** — 3 pump stations running during a storm.
9. **Gator Wrangler** — Wildlife Officer relocates 10 gators.
10. **Sunbather** — a gator on the 50-yard line on game day.
11. **Skeeter Beater** — campus mosquito index < 0.1 in August.
12. **Bayou Field** — first home game.
13. **Night Falls on the Cauldron** — first night game at Stadium II.
14. **Geaux Beat Magnolia** — beat the rival.
15. **Undefeated** — 12–0 regular season.
16. **The Big Boil** — crawfish boil with 3,000+ attendance.
17. **Throw Me Somethin'** — Mardi Gras parade with Float Barn.
18. **Green and Gold** — ecology ≥ 70 with ≥ 3,000 students.
19. **Lights Are On** — Bell Tower built.
20. **Firefly Nights** — 500 fireflies on screen at once.
21. **Flagship** — 10,000 students, prestige 60.
22. **Laissez les Bons Temps Rouler** — 20,000 students, prestige 85, ecology ≥ 50 (the "you won" that isn't an ending).

### Unlock progression
Gated by **students** (400 → 600 → 800 → 1,000 → 1,200 → 1,500 → 2,000 → 3,000 → 4,000 → 8,000), **prestige** (20: Radar; 50: Stadium III), and **prerequisite buildings** (Library → Grad Apts; Engineering → Floodwall; Stadium chain). Everything swamp-infrastructure is available from the start on purpose: survival tools are never locked.

### Failure states (soft, recoverable, dramatic)
- **Bankruptcy:** cash < −$2M for 3 consecutive months → "Legislative Receivership": a 30-day countdown; the state auto-sells your newest non-academic building each month (with a sad demolition puff) until solvent. Prestige −10. The game continues; the achievement "Rebuilt from the Roux" if you reach prestige 50 afterward.
- **Campus underwater:** > 50% of buildings flooded for 15 days → "Semester Cancelled": no tuition that semester, attrition ×2, prestige −15, a somber ticker; water recedes per the sim; Governor offers a one-time $3M "Coastal Resilience Grant" *earmarked* (only spendable on §4.8 buildings) — the game teaches the fix at the moment of failure.
- **Accreditation lost:** prestige < 5 for a full year → "Probation": applicants ×0.5 until prestige > 15; the ticker roasts you; an "Accreditation Task Force" objective chain appears (build Library, fix seats/student ratio).
- No hard game over. New Game and Reroll are always in the menu.

### Endgame / sandbox
After Flagship, sandbox continues with escalating hurricane odds (P(3 storms) rises to 0.4), new ticker content, and **Legacy Goals** (optional): 20k students, 50-year run, all achievements, "Zero-Fill Campus" (never filled a marsh tile).

---

## 11. UI / UX

### HUD layout (1280×800 reference; scales to any 16:9/16:10 at ≥ 1024 px wide)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ BAYOU STATE   $4.12M ▲  👥 400  ★ Prestige 10  ☺ 60  🌿 82   Jul 3, Y1 ☀ 97°F │ ← top bar (44px)
│                                       ⏸ 1× 2× 4×   [Budget] [Storm] [Menu]   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                    ┌───────┐ │
│                          (isometric world)                         │minimap│ │
│                                                                    │  64²  │ │
│  ┌ Objective ─────────────────────┐                                └───────┘ │
│  │ 👩 Ms. Thibodeaux              │                                ┌───────┐ │
│  │ Place a Freshman Dorm on the   │                                │overlay│ │
│  │ ridge (high ground = green).   │                                │ F W M │ │
│  │ ▓▓▓▓▓░░░ 0/1     [skip]        │                                │ P C E │ │
│  └────────────────────────────────┘                                └───────┘ │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ ≡ NEWS: Facilities crew reports a gator sunning on the culvert · Tropical … │ ← ticker (24px)
├──────────────────────────────────────────────────────────────────────────────┤
│ [Paths][Utility][Academic][Housing][Dining][Sports][Life][Swamp][Green][Land]│ ← palette tabs
│ ▢ Gravel $2k  ▢ Brick $6k  ▢ Boardwalk $14k  ▢ Road $10k  ▢ Bridge $80k  ⌫  │ ← palette items (72px)
└──────────────────────────────────────────────────────────────────────────────┘
```
- **Top bar:** cash (with delta flash green/red on change), students, prestige, happiness, ecology (each a hover-tooltip with the formula's biggest contributors: "Happiness 60: +8 dining, −6 mosquitoes, −4 heat…"), date/time-of-day with a tiny sun/moon, weather icon and heat index, speed buttons, panel buttons.
- **Storm button** pulses red when a cone exists; opens the Storm panel (cone map, category, ETA, four prep actions with costs, levee gap warning).
- **Objective card:** bottom-left, collapsible, portrait + 2 lines + progress bar.
- **Minimap:** 128×128, terrain colors + building dots + water depth blue + the hurricane cone + a viewport rectangle; click to jump.
- **Overlay toggles** (also keys): **F**lood risk, **W**ater depth, **M**osquito, **P**ower/water coverage, **C**overage (dining/happiness), **E**cology/subsidence.
- **Palette:** 10 tabs; items show icon, name, cost; hover → tooltip with footprint, upkeep, effects, unlock and a *why* line ("Pilings: the marsh keeps the marsh, you keep the building"). Locked items are visible and greyed with the unlock condition — the catalog is the roadmap. Bulldoze (⌫ / X). Right-click or Esc cancels.
- **Ghost preview:** footprint tiles tinted green/yellow/red; label with adjusted cost and the reason; when dragging linear objects, a running total.

### Inspect panel (click a building or tile; slides in from the right, 300 px)
```
┌ Freshman Dorm "Boudreaux Hall" ──────── ✕ ┐
│ ▓ sprite ▓  Beds 300 / 300 filled           │
│ Quality ★★☆☆   Wind Rating ▮▮▮░░           │
│ Elev 6.8 ft  Water 0.0 ft  Sinking: 0.1/yr  │
│ Power ✓  Water ✓  Path ✓  Dining ✓ (Hall)   │
│ Status: OK   Damage 0%                      │
│ Mood sample: "The AC works. That's the bar."│
│ [Rename] [Pilings +$280k] [Repair] [Demolish]│
└─────────────────────────────────────────────┘
```
Tiles show type, elevation, water, saturation, mosquito, standing-water days, ecology flag. Agents show name (generated), major, mood face, current activity ("Fleeing: Professor Snaps"). Gators show name, length, mood ("hungry"), home preserve.

### Notifications and news ticker
- **Ticker:** scrolling line at 60 px/s; new items slide in with a color tag (gold = good, purple = campus, red = danger, green = swamp). Clicking an item centers the camera on the related tile if any.
- **Toasts:** top-center stack, 3 max, for milestones/money events; gold-bordered with a 4-s life.
- **Newsflash modal:** only for hurricane naming, landfall report, semester cancellation, achievement unlock (full-width banner over the world for 2.5 s, non-blocking).

### Camera and controls
- Pan: WASD / arrows / edge-drag with middle mouse / two-finger trackpad scroll (this is a laptop game: **trackpad scroll pans**, pinch or Ctrl+scroll zooms). Zoom 0.5×–2× in 4 steps (Q/E or wheel), snapped to integer pixel scales for crisp pixel art. Camera eases (lerp 0.15) and clamps to map bounds with 200 px margin.
- Rotate: none (keeps sprite count sane); the map is designed for one view.
- Click-drag to draw linear items; Shift+click for straight lines; click to place single buildings; R to rotate 3×2-type footprints.
- Keyboard: Space pause; 1/2/3 speeds; B build menu focus; Tab cycles palette tabs; 0–9 palette quick-select within a tab; F/W/M/P/C/E overlays; N cycle notifications; Home centers on Founders' Hall; Esc cancels/closes; Ctrl+S manual save; Ctrl+Z undo last placement (refund 100% within 5 s).
- Tooltips appear after 300 ms hover; all stats in the top bar have tooltips that explain the math in one line each.
- Touch (nice-to-have): tap to place, drag to pan, pinch to zoom, long-press for inspect.

### Other screens
- **Title:** animated live world in the background (a demo save with night, fireflies, rain), gold serif title, Continue / New Game (seed, Reroll, difficulty: Easy "Gentle Rain" (storm damage ×0.6, starting cash $6M), Normal, Hard "Cajun Summer" (2–4 storms/yr, cash $3M)), Achievements, Settings (audio toggle, volume, particles Low/High, screen-shake toggle, colorblind palette for overlays).
- **Budget panel:** income/expense table for last month and projected month, tuition slider with live applicants estimate, faculty quality, coaching budget, admission selectivity, ticket price, auto-repair toggle, loan status.
- **Season panel:** schedule with W/L, next opponent rating vs yours, night-game toggle, rivalry marker.
- **Storm panel:** as above.
- **Almanac:** achievements, year-by-year stats sparkline (students, prestige, cash, ecology), gator log.

---

## 12. Visual Style

- **Projection:** isometric 2:1, 64×32 tile diamonds, elevation 6 px/ft, integer zoom scaling with `imageSmoothingEnabled = false`. Pixel-art sprites drawn at 1× into offscreen canvases at load (sprite atlas built procedurally in ~150 ms), then `drawImage`'d — the only per-frame vector drawing is water, particles, lighting and UI.
- **Palette (hex):**
  - Purple family: `#461D7C` (BSU purple), `#5E2CA5`, `#7F5BC5` (highlights), `#2B1246` (shadows).
  - Gold family: `#FDD023` (BSU gold), `#F5B700`, `#FFE680` (highlight), `#B58500` (shadow).
  - Swamp: water `#1B3A3A` night / `#2E6B5E` day / `#6FA895` shallows; marsh reed `#8A9A4B`; mud `#4A3B2A`; wet ground `#5A6B3A`; dry grass `#6E8F3C`; high ground `#7FA347`; cypress `#3F5E3A` / autumn `#C7692B`; oak canopy `#3B5A2A`; moss `#9BAA8A`; bark `#3A2A1E`.
  - Sky/tint keyframes (applied as a full-screen multiply overlay + additive lights): Dawn `#F7B58A` @0.25, Day none, Golden hour `#FFCB6B` @0.2, Dusk `#6B3F8F` @0.35, Night `#0E1230` @0.62, Storm `#2A3140` @0.5, Fog `#C9CFD1` layered @0.3.
  - UI: panel `#1A1230` @ 92% with 1 px gold border, text `#F4EEE2`, accent gold, danger `#E0443E`, good `#3FBF7F`.
- **Terrain rendering:** per 8×8 chunk (64 chunks), the terrain layer is pre-rendered into a chunk canvas (each 512×~400 px) including tile faces, cliff sides, reeds, cypress knees and path auto-tiles; re-rendered only when a tile in the chunk changes. Viewport draws ≤ 20 chunks. Water is drawn per visible water tile every frame as a diamond with two scrolling 1-px sine-line patterns and a specular sparkle at day, plus reflections of light sources at night (gold vertical smear).
- **Sprites:** every building is a small procedural painter: base box (walls with 3-tone shading by isometric face), roof (flat/gable/hip/dome), window grid (lit at night by swapping to an "emissive" pass: windows are also drawn into a separate lights atlas), signature details from the catalog. Trees: trunk + 3–5 canopy blobs with dithered edges; live oaks get 6–10 hanging moss strands that are drawn per-frame as sinusoidal lines (wind-driven). Agents: 12×20 px, palette-swapped from a base sprite sheet. Gators: 40×12 px, 3 frames, red eye dots at night. Roux: 28×16 px, pacing loop, yawn.
- **Lighting / day-night:** three passes after the world: (1) multiply-tint overlay by time-of-day; (2) additive "lights" canvas: radial gradients for lamps (every 6 path tiles), windows, stadium masts (huge cones), fireflies, lightning; blend `lighter`; (3) fog layer when active. Cost: 3 full-screen composites + N radial gradients — fine on any laptop at 1280×800.
- **Weather effects:** rain as 300–1,200 short diagonal 1-px lines with wind angle, splash rings on water tiles; **lightning** = 1-frame white flash at 0.7 alpha decaying over 250 ms, a jagged bolt polyline drawn once, 6-px shake; **fog** = 8 large soft radial blobs scrolling slowly, denser over water; **wind** = moss/tree sway amplitude driven by `wind` (0–1), storm gusts = amplitude 3× with leaf particles; **heat shimmer** = 2 px vertical wobble on rows of roof pixels over asphalt/roofs when heat > 95; **fireflies** = 1–2 px yellow-green dots with slow Perlin drift and sine blink, drawn on the lights pass.
- **Animation list:** water scroll, moss sway, tree sway, agent walk/idle/flee/cheer/splash/slap, gator swim/walk/sun/wrestle, pump impeller spin + discharge foam, fogger truck + trail, bus loop, riverboat paddle, tiger pace/yawn, egret takeoff, crawfish pot steam, dining vents steam, radar sweep, water tower blink, stadium crowd shader (per-seat pixel noise brightness + wave sweep), fireworks (burst particles), Mardi Gras float roll + bead throws, construction scaffold rise + dust, demolition puff, building "pop" on completion, coin burst on income, cliff-side water overtopping (sheet particles) when a levee is exceeded, trailer tumble, light mast spark-out, graduation cap toss, azalea petals, cypress leaf drop in Nov, spoonbill flock circling.
- **Particles:** single pooled system, max 2,500 live (Low setting: 800); types: rain, splash, dust, smoke, steam, sparks, fireflies, petals, beads, leaves, confetti/fireworks, coin, fog wisps, mosquito haze dots. Each particle: x, y, vx, vy, life, type, size, color index. Rendered as fillRect (no arcs) except fireworks.
- **Juice:** screen shake (toggleable) on landfall, touchdowns, demolitions; hit-stop 60 ms on big money events; toast easing; building placement squash (scaleY 1.15 → 1) over 200 ms; cash counter tweens; cursor tile pulses; overlay fades in over 150 ms; camera drift during cinematic; vignette darkens edges at night; hurricane approach desaturates the palette by 30% via the tint pass.

---

## 13. Audio (synthesized, muted by default)

All via a single `AudioContext` created on first user gesture; master gain 0 until the toggle (top bar 🔇/🔊, key **M**). Every voice is procedural:
- **Ambience bed:** frog chorus (3–6 voices: short filtered sawtooth "chirps" with random pitch 180–420 Hz, rate scales with ecology and night), cicadas (band-passed noise at 5–7 kHz with 20–40 Hz tremolo, summer daytime only, louder with heat), crickets at night, distant owl (sine 400→300 Hz, rare), mosquito whine (sine 600 Hz with vibrato when campus density > 0.5, close to the camera center), bullfrog "jug-o-rum" (low sine 90 Hz burst) near water when zoomed in.
- **Weather:** rain = brown noise through a lowpass whose cutoff and gain follow `rainRate`; wind = filtered noise with slow LFO; thunder = noise burst with 2-s exponential decay + low sine rumble, delayed after the flash by 0.3–2 s depending on distance (a bolt near the camera is loud and instant); levee overtopping = white-water hiss.
- **UI:** place (short square-wave "plunk" 300→200 Hz), invalid (buzz 110 Hz), money in (three ascending sine blips), milestone (gold chime: 3-note major triad), notification (soft tick), hover (tiny click), demolish (noise crunch), pump running (low 60-Hz hum loop when near camera), fogger truck (motor buzz).
- **Bells:** Bell Tower at noon and 18:00: 4 decaying sines (fundamental + partials) as a 4-note motif.
- **Game day:** a tiny procedural **zydeco motif** — accordion (two detuned square waves + vibrato) playing a 2-bar riff in G at 120 BPM, rubboard (short high noise bursts on eighths), bass (triangle on roots), 16 bars looped at tailgates; **brass-band sting** on touchdowns: 3 detuned sawtooth "horns" playing a 5-note fanfare with a snare roll (noise burst); crowd roar = pink noise swell with a slow attack; whistle at kickoff.
- **Mardi Gras:** the zydeco riff with a second-line snare pattern and tambourine (noise + bandpass at 8 kHz).
- **Mix:** ducking (ambience −6 dB during stings), spatialization by distance from camera center (simple gain), hard cap on simultaneous voices (12).

---

## 14. Flavor Content

**Mascot:** **Roux** the tiger (a Bengal named after the base of every gumbo). Fight song: "Geaux Bayou." Student section: "The Marsh Mob." Campus nickname: "The Ridge."

**Rival schools (fictional):** Magnolia State University ("the Magnolias", arch-rival, crimson-and-white), Crescent City University (green-and-black, "Pelicans"), Delta A&M ("Catfish"), Gulf Coast Tech ("Shrimpers"), Pineywoods State ("Loggers"), Sabine River Baptist ("Prophets"), Arkla Tech ("Roughnecks"), Vermilion College ("Cranes"), Atchafalaya Polytechnic ("Bullfrogs"), Ozark Mountain University ("Hogs of the Hills"), Red Clay State ("Kilns"), Sea Island College ("Sandpipers").

**Student name generator** (first + last; 10% get a nickname in quotes):
- First (M): Beau, Remy, Thibault, Jean-Luc, Landry, Boone, Cyprien, Étienne, André, Achille, Tee, Jude, Toussaint, Ambrose, Bastien, Claude, Dupre, Emile, Hollis, Jasper, Jules, Kendrick, Lucien, Marcel, Octave, Placide, Rodrigue, Sébastien, Ulysse, Wade.
- First (F): Cécile, Delphine, Marguerite, Noelie, Odette, Amélie, Josée, Camille, Clothilde, Evangeline, Fleur, Genevieve, Ida, Jolie, Lisette, Magnolia, Mireille, Nadia, Ophelia, Perrine, Renée, Simone, Solange, Tallulah, Vivienne, Yvette, Zoé, Bijou, Coralie, Doucette.
- Last: Boudreaux, Thibodeaux, Fontenot, Guidry, Landry, Hebert, Broussard, LeBlanc, Melancon, Arceneaux, Robichaux, Cormier, Breaux, Trahan, Babineaux, Bourgeois, Dupré, Toussaint, Batiste, Delacroix, Lafleur, Prejean, Mouton, Doucet, Savoie, Chauvin, Gautreaux, Comeaux, Benoit, Domingue, Ledet, Naquin, Picou, Rousseau, Simoneaux, Theriot, Vidrine, Champagne, Duplantis, Falgoust.
- Nicknames: "Tee", "Boo", "Cher", "Peanut", "Catfish", "Coco", "Boo-Boo", "T-Jean", "Sha", "Bébé", "Skeeter", "Crawdad".
- Majors: Coastal Engineering, Petroleum Geology, Mass Comm, Kinesiology, Sugarcane Agronomy, Cajun French, Marine Biology, Hospitality (Gumbo Track), Political Science ("Pre-Governor"), Nursing, Wildlife Management, Music (Accordion Performance).

**Building auto-names** (assigned by type when placed; player can rename): Halls: Boudreaux Hall, Fontenot Hall, Guidry Hall, Prejean Hall, Landry Hall, Broussard Hall, Toussaint Hall, Batiste Hall, Lafitte Hall, Evangeline Hall, Acadiana Hall, Pontchartrain Hall, Atchafalaya Hall, Teche Hall, Sabine Hall, Vermilion Hall, Cane River Hall. Dining: The Roux, Big Easy Eats, Ma Tante's Kitchen, Tiger Boil. Po'boy shacks: Dressed & Pressed, Debris & Gravy, Fried Oyster Hut. Coffee: Café Brûlot, Chicory & Chill, Beignet Bar. Labs: Coastal Resilience Lab, Delta Dynamics Center, Cypress Genome Institute. Stadium: Bayou Field → The Cauldron → Cauldron Grand. Dorms get "Hall"; towers get "Tower"; Greek: Kappa Gumbo Kappa, Delta Pirogue, Sigma Zydeco, Alpha Boudin Beta.

**Festival descriptions (for the Almanac / newsflash):**
- *Mardi Gras (Feb 20–22):* "Classes are technically in session. Nobody is technically in class. The Float Barn rolls the Krewe of Roux down the Brick Walk; beads land on the Bell Tower. +12 happiness, $120k in purple-gold merch, and a campus that glitters for a week."
- *Crawfish Season (Mar–Apr):* "Every weekend the Gumbo Pavilion boils 800 pounds of mudbugs. If your Crawfish Pond is fenced, the gators watch from behind the wire. If it isn't, the gators attend."
- *Homecoming:* "A bonfire on the quad, alumni by the riverboat, and the Marsh Mob louder than the Cauldron's engineers thought was structurally advisable."
- *Graduation (May 10):* "Caps in the air, mosquitoes in the cap. 22% of your students become alumni — and alumni write checks."
- *First Night Game:* "The Cauldron's lights come on for the first time and the swamp goes quiet. Then it doesn't."
- *Fourth of July:* "Fireworks over the Big Muddy; the pump stations get the night off (they do not)."

**News-ticker / event lines (48):**
1. Facilities crew reports a gator sunning on the culvert. Crew reports it back.
2. Tropical wave off Africa has forecasters "mildly interested."
3. Mosquito index: BIBLICAL. Student Health recommends long sleeves and prayer.
4. A 14-foot alligator named Le Grand was spotted near the Rec Center. He has been offered a scholarship.
5. Parking Services issued 412 tickets today. Campus has 300 cars.
6. Levee inspection finds nutria burrow "the size of a sophomore."
7. The Marsh Mob has been asked to stop shaking the seismograph. The Marsh Mob has declined.
8. Zydeco Friday: accordion audible in three parishes.
9. Cypress trees turn orange; students confirm it's "fall, technically."
10. Heat index 103. The quad's live oaks now have a waiting list.
11. Crawfish boil draws 3,000 attendees and one uninvited reptile.
12. Chancellor's office clarifies that "Geaux" is not a typo.
13. Heron nesting season begins in the Preserve. Please do not name them.
14. State legislature praises BSU's ecology. State legislature asks about the football score.
15. Fog advisory: campus visibility reduced to "vibes."
16. Brownout: labs dark, dorms warm, tempers warmer.
17. Pump Station 2 running at full tilt. Engineers describe the sound as "reassuring."
18. Tailgate city population briefly exceeds enrollment.
19. Roux the Tiger yawned during the opponent's fight song. Analysts call it "a statement."
20. Wildlife Officer relocates gator "Professor Snaps" for the fourth time this month. Snaps files appeal.
21. Storm surge overtops the south levee. Boardwalk now technically a dock.
22. Tuition increase announced. Applicants describe reaction as "hmm."
23. Fireflies over the marsh tonight. Astronomy Club cancels stargazing to watch bugs.
24. Riverboat *Belle of the Ridge* docks; donors disembark humming.
25. Mardi Gras: 40,000 beads recovered from Bell Tower. Bell rings anyway.
26. Cold snap kills mosquitoes. Campus throws a parade for the cold snap.
27. Sugarcane harvest at the Ag Center smells "like the future, and syrup."
28. The Cauldron's lights visible from the International Space Station, claims a student who is not an astronaut.
29. Freshman Dorm on wet ground has sunk 1 foot. Residents now "closer to nature."
30. Coastal Studies Institute publishes paper: "The Campus Is Sinking (But So Is Everything)."
31. Gator in the pool. Rec Center closed. Gator awarded lap-swim record.
32. Magnolia State's mascot spotted on campus. Roux unbothered.
33. Homecoming bonfire "larger than permitted, smaller than legendary."
34. Trailer Dorm relocated 300 yards by Hurricane Boudreaux. Residents rate the view.
35. Semester underway: 91% attendance, 9% "checking on the levee."
36. Board of Supervisors approves purple asphalt. Gold asphalt "under review."
37. A pelican has taken up residence on the Water Tower and refuses interviews.
38. Nutria bounty pays out $500. Nutria population reportedly "annoyed."
39. First-year students learn to pronounce "Atchafalaya." Second-year students stop trying.
40. Night game forecast: clear skies, 78°F, 100% chance of goosebumps.
41. Retention pond stocked with bream. Mosquitoes stocked with regret.
42. Faculty Senate requests more parking. Parking Services requests more tickets.
43. Spoonbills circle the Preserve at dawn; the Marketing office cries.
44. Late-night po'boy line reaches the Bell Tower. Bell Tower adds a second window.
45. Hurricane cone narrows. Campus discovers what "gap in the levee" means.
46. Cajun French class oversubscribed; "mais la" now the official campus greeting.
47. Graduation: 22% of students become alumni, 100% of caps become mosquito bait.
48. Coach declines to comment on the loss, comments extensively on the humidity.

---

## 15. Technical Feasibility Notes

**One HTML file.** Build script concatenates `src/*.js` in a defined order into a single `<script>` inside `index.html` with inline CSS; no modules syntax at runtime (plain IIFEs sharing a `BSU` namespace object), so `file://` works in Chrome and Safari. Sprite atlas is generated at load into ~12 offscreen canvases (buildings, trees, agents, gators, UI icons, lights); generation < 200 ms. Total source ~9–12k lines; the built file ~450–600 KB uncompressed. Save = JSON of tile arrays (Int16/Float32 packed to base64), entity list, economy state, RNG seed and calendar (~150 KB) in `localStorage['bsu.save.N']`.

**Performance budget (target 1280×800, zoom 1×):**
- Tiles: 4,096; visible ~700; terrain drawn from ≤ 20 chunk canvases (20 drawImage calls). Water tiles visible ~120 → ~120 path fills per frame.
- Sprites: buildings ≤ 400, trees ≤ 1,200, agents ≤ 300, gators ≤ 30, misc ≤ 100. Depth-sorted draw list for visible entities only, sorted by `tx + ty` (insertion-sorted incremental list; re-sort on movement bucket change). ~600 drawImage/frame typical, 1,200 worst.
- Particles ≤ 2,500 (fillRect). Lights ≤ 250 radial gradients (cached as small sprites, not regenerated per frame).
- Simulation: 10 tps; hydrology 4 tps (~16k neighbor ops); agents 10 tps with A* limited to 8 path requests/tick (queue); mosquito diffusion 1/day; economy monthly; weather 1/tick.
- Expected: 60 fps on a 2019 MacBook Air in Chrome and Safari; the Low particles setting plus no-shake gives headroom on older hardware. Fallback: if frame time > 25 ms for 60 consecutive frames, auto-drop to Low particles and half the firefly count (with a settings notice).

**Module decomposition (13 modules, one shared contract file first):**
0. `contract.js` — namespaces, constants, enums (tile types, building IDs), event bus (`BSU.events.emit/on`), shared RNG (mulberry32), data structures for `World` (typed arrays), `Entity`, `Building`, `Agent`; every other module only touches these. **This is written first and frozen.**
1. `data.js` — building catalog (§4), storm names, ticker lines, name lists, rival schools, calendar constants. Pure data.
2. `terrain.js` — map generation (§3), tile type derivation, elevation utilities, grading/fill ops, pathability grid.
3. `hydro.js` — water flow, rain, evaporation, canals/levees/pumps/ponds, flood state, flood-risk prediction, subsidence yearly step.
4. `weather.js` — day cycle, seasons, heat index, rain/storm scheduler, hurricane lifecycle and cone, wind, damage application (calls into buildings), festival calendar hooks.
5. `wildlife.js` — gators, nutria, mosquitoes, egrets/spoonbills/fireflies spawners, Wildlife Officer behavior, ecology score.
6. `buildings.js` — placement validation, footprints, construction timeline, upkeep/effects aggregation, coverage maps (power/water/dining/happiness), repair/demolish, pilings, auto-naming.
7. `economy.js` — money, tuition, enrollment, prestige, happiness, donations, research, failure states, monthly/semester/yearly ticks.
8. `agents.js` — student agents, schedule state machine, A*, reactions; crowd shader hooks.
9. `sports.js` — season schedule, team rating, game-day event orchestration, tailgates, revenue.
10. `sprites.js` — all procedural pixel-art painters and the atlas builder; exposes `getSprite(id, variant, frame)`.
11. `render.js` — camera, chunk cache, draw list, water, weather effects, lighting passes, particles, overlays, minimap.
12. `ui.js` — HUD, palette, inspect panel, ticker/toasts/modals, panels, keyboard/mouse/trackpad input, tooltips, title screen, settings.
13. `audio.js` — WebAudio synth voices and mixer.
14. `progress.js` — tutorial script, objective chain, achievements, save/load/autosave, difficulty.
Build: `build.js` (Node, 20 lines) concatenates in numeric order into `index.html`. Each module registers `init/update(dt)/render(ctx)` hooks on `BSU`; the main loop in `render.js` (or a tiny `main.js` appended last) drives fixed-step sim + rAF render.

**What to cut first if scope must shrink (in order):**
1. Baseball Diamond, Riverboat Landing, Oak Alley, Chancellor's Mansion, Ag Center (landmark fluff).
2. Touch input; colorblind overlays; difficulty modes (keep Normal).
3. Bowl game and ticket pricing; coach reroll.
4. Nutria as agents (keep as an abstract levee-integrity decay with a ticker line).
5. Fogger truck as a visible vehicle (keep as radius effect).
6. Spoonbills/egrets/pelicans/armadillo cameo animations.
7. Zydeco motif (keep stings and ambience).
8. Subsidence overlay and re-grading (keep subsidence itself, surface via warning icon).
9. Stadium III (stop at The Cauldron; keep the night-game moment).
Never cut: hydrology, hurricane landfall set piece, gators, mosquitoes, day-night lighting, fireflies, the tutorial, autosave.

---

## 16. Scope Risks and the Three "Demo-Killers"

**Scope risks.** (a) Hydrology tuning — a leaky or over-eager sim floods everything or nothing; mitigate with the fixed constants above, a debug overlay, and the Flood Risk predictor built on the same code path. (b) Hurricane choreography touching every module — mitigate by making landfall an event-bus timeline (`storm:phase` events) that each module reacts to independently. (c) Pixel-art painters eating time — mitigate with a single parameterized building painter (box + roof + windows + 1–2 signature decals) so 40 buildings are 40 data rows, not 40 painters. (d) Save format churn — freeze the contract first and version the save.

**The three things most likely to make this feel like a demo — and how the design avoids each:**

1. **A pretty map where nothing pushes back.** Demos let you place buildings forever. Here the swamp is an *adversary with a schedule*: rain daily, mosquitoes weekly, a named storm in the first year on a fixed date, subsidence yearly. The economy is bed-capped and prestige-gated so growth requires decisions, and every shortcut (fill the marsh, skip pilings, skip the levee loop) is cheap now and expensive later. Failure states exist and are recoverable, which is what makes stakes feel real without being punishing.

2. **Numbers changing in a panel instead of things happening on screen.** Every system has a visible embodiment: students physically route around a gator; the parking lot's cars float; the levee visibly overtops with sheet particles; mosquitoes are a haze you can see thicken; the fogger truck drives; the pump discharges foam; prestige shows up as a Bell Tower and a full stadium; ecology shows up as fireflies. The rule for engineers: **if a stat changes, something in the world must move.**

3. **No arc, no moment.** A sandbox with no story feels like a toy. This design has a fixed dramatic spine in the first 20 minutes (tutorial → first semester → Hurricane Célestine → recovery → first home game), a staged second act (Preserve → fireflies; Stadium II → the night-game screenshot), and a defined "you did it" milestone that hands over to sandbox with escalating storms. The ticker, festivals and named gators give the world a voice so that even quiet minutes feel inhabited. When a student screenshots it and sends it to a friend, the friend should ask what happened *next*.

*Geaux Bayou.*
