# BAYOU STATE — Game Design Document (Systems Candidate)

*Working title:* **BAYOU STATE: Geaux Build**
*Tagline:* **Build a university. Out-build the swamp.**

---

## 1. Title, Pitch, Screenshot Moment

**Pitch.** You are the founding Chancellor of Bayou State University, a purple-and-gold college chartered on 4,000 acres of cypress swamp outside Red Stick, Louisiana, on the wrong side of the river levee. You lay paths, drain marsh, raise levees, place lecture halls and dorms, set tuition, chase prestige, and grow enrollment from 600 kids in a trailer to a 40,000-student powerhouse with a 100,000-seat stadium nicknamed The Boil. The swamp fights back every single semester: hurricane season, gators in the Quad, mosquitoes breeding in every puddle you forgot to drain, ground that sinks under everything you build, nutria eating your levees, and August heat that melts the freshmen. Every system feeds another: pumps dry the land but accelerate subsidence; canals drain floods but kill the marsh that was absorbing them; a winning football team buys prestige that buys enrollment that overloads your sewer plant. It is SimCity's interlocking budget-versus-growth pressure, crossbred with a survival game, wrapped in a crawfish boil.

**Screenshot moment.** Night game at The Boil, third quarter, stadium lights blazing gold over a purple-tinted isometric campus; a hundred pixel students in a lit student section; RVs and tents flickering with grill smoke on the tailgate lots; fireflies over the live oaks; a Category 3 forecast cone sliding in from the Gulf on the minimap; and one gator, lit by the scoreboard, waddling calmly across the 50-yard line while a news ticker reads *"Wildlife Office: 'He's a fan.'"* Someone looks at that and says "wait, AI made this, in one file, with no assets?"

---

## 2. Core Loop and Meta Loop

### Minute-to-minute (core loop)
1. **Read pressure.** HUD shows cash, monthly net, enrollment/capacity, prestige, happiness, ecology, flood risk, and a forecast.
2. **Decide.** Pick one of ~6 pressure releases: place a building (capacity), place infrastructure (utilities coverage), place swamp defense (levee/pump/canal/abatement), adjust a slider (tuition, coach tier, ticket price), respond to an event card (gator relocation, storm prep), or wait and bank cash.
3. **Place.** Choose a tile; validity depends on terrain, coverage, adjacency to path, and budget. Placement feedback is immediate: coverage rings, flood-risk tint, cost preview.
4. **Watch the sim answer.** Students walk to the new building, happiness ticks up, water pools where you didn't drain, a mosquito overlay blooms, cash drains in the monthly statement.
5. **Reacts to a spike.** Every 2–4 minutes something interrupts: rainstorm, gator sighting, game day, a donor offer, a hurricane cone. Each spike has a 1–3 click answer.

### Semester-to-semester and year-to-year (meta loop)
- **Fall (Aug 15–Dec 15):** enrollment lands, tuition income starts, football season with 6 home games, hurricane peak. Cash-rich, crisis-rich.
- **Spring (Jan 10–May 10):** Mardi Gras, crawfish season, spring rains and flood, commencement (graduates become alumni → donation base). Cash-steadier, building season.
- **Summer (May 10–Aug 15):** low tuition income, heat, early hurricane season, construction is 25% cheaper (labor is idle). The classic "build in summer, pay in fall" rhythm.
- **Year-scale progression:** prestige unlocks the building tree (Tier 1 trailer campus → Tier 4 research flagship), enrollment forces utility and housing expansion, subsidence slowly lowers everything you built so early cheap choices come due in year 4–6, and alumni donations compound from wins and happiness. Milestones (Section 10) mark the arc; the sandbox never ends.

---

## 3. World and Terrain

**Map size:** 72 × 72 tiles = 5,184 tiles (isometric diamond, 64×32 px per tile at zoom 1). Fits comfortably in a typed-array simulation and renders in one pass.

**Elevation model.** Each tile has `elev` in feet, float, range −3.0 to +14.0. The map is a gentle bowl: a natural levee ridge along the river (east edge) at 8–12 ft, a high ground shoulder in the northwest at 6–10 ft, sloping to the backswamp basin at 0–2 ft in the south-center, with a bayou channel meandering through at −2 ft and an open lake (Lake Roux) in the southwest at −3 ft. Tile terrain type is derived from elevation plus a moisture noise channel, and is recomputed when elevation changes (subsidence, levees, fill).

**Tile types**

| Type | Elev rule | Buildable? | Notes |
|---|---|---|---|
| Open water (lake) | elev < −1.5 and lake mask | No (boardwalk/bridge only) | Gator spawn, absorbs unlimited runoff |
| Bayou channel | river/bayou spline mask | No (bridge only) | Drains to river; gator highway |
| River (east edge, 3 tiles wide) | edge mask | No | Storm surge source; canal outlet |
| Marsh | −1.5 ≤ elev < 1.0 | Only with Pilings or Fill; boardwalk OK | +ecology, absorbs 2 in/hr, mosquito breeding |
| Wet ground | 1.0 ≤ elev < 3.0 | Yes, but floods at +6 in standing water; 20% higher subsidence | Cypress grows here |
| Dry ground | 3.0 ≤ elev < 7.0 | Yes | Baseline |
| High ground | elev ≥ 7.0 | Yes, −50% subsidence | Rare (~9% of map): the natural river levee and NW shoulder |
| Levee (built) | any + `levee` flag | No buildings; path OK | Raises effective elevation +5 ft for flow purposes |

**Procedural generation**
1. Seeded `mulberry32` RNG; 2-octave value noise for base height (frequency 1/18 tiles, amplitude 5 ft) plus a radial "bowl" term and a linear ramp rising toward the east edge (river levee ridge).
2. Bayou spline: 5–7 control points wandering from the north edge to Lake Roux, carved to −2 ft with a 1-tile wide channel; branches (2) carved to −1.5 ft.
3. Lake Roux: ellipse at (14, 56) radius 7×5 carved to −3 ft.
4. River: columns 69–71 set to −4 ft (never buildable); column 68 forced to 9 ft (the natural levee).
5. Starting site: a 10×8 rectangle centered at (36, 30) is flattened to ≥ 4.5 ft dry ground, guaranteeing a buildable core. The pre-placed Admin Trailer, one Path, one Power Pole substation, and a road stub to the off-map highway (north edge, column 36) sit here.
6. Vegetation pass: cypress stands on 35% of marsh tiles, live oaks on 12% of dry/high tiles, Spanish moss is a render flag on any tree adjacent to water.
7. Guarantee: at least 900 dry+high tiles reachable from the start; regenerate seed otherwise.

**Terrain means:** water can't be built on; marsh needs Fill ($) or Pilings ($$, flood-proof); wet ground floods early and sinks fast; high ground is the safe, scarce real estate you fight over; every marsh tile you fill reduces ecology and flood absorption for everything downhill of it. Distance from the river ridge is safety from surge but distance from the canal outlet. The "interesting decision" is on the map from minute one.

---

## 4. Building Catalog

Costs in dollars. Upkeep is per month. "Path-adjacent" means at least one footprint edge touches a Path, Road, or Boardwalk; all buildings require it. Power/water usage in units (PU/WU). Unlock gates use Prestige (P), Enrollment (N), or a milestone.

### Paths and transport
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 1 | Path | 1×1 | 2,000 | 0 | Walkable; students need paths; dry/wet ground only | Start | Warm sand-gray strip, gold edge dots |
| 2 | Road | 1×1 | 8,000 | 60 | Vehicles; required within 4 tiles of Stadium, Parking, Sewer Plant; connects to highway stub | Start | Dark asphalt, dashed gold centerline |
| 3 | Boardwalk | 1×1 | 6,000 | 30 | Walkable over marsh/wet/lake edge; immune to flooding; gators can cross | Start | Weathered cypress planks on stilts |
| 4 | Bridge | 1×1 | 25,000 | 100 | Path over bayou channel; also road if adjacent roads | Start | Purple steel truss, gold railing |

### Utilities
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 5 | Power Substation | 2×2 | 150,000 | 3,000 | +60 PU, coverage radius 14 tiles; buildings outside any radius are unpowered (−50% effect, 0 happiness) | Start | Gray box, transformer coils, red blinking light |
| 6 | Water Tower | 2×2 | 120,000 | 2,000 | +50 WU, radius 12 | Start | Purple tank on gold legs, "BSU" band |
| 7 | Wastewater Plant | 3×3 | 400,000 | 8,000 | Required when N > 1,500 (else −15 happiness, ecology −2/mo); must be within 3 tiles of water or canal; −4 ecology while active | N ≥ 1,000 | Round tan clarifiers, green catwalks |
| 8 | Backup Generator | 1×1 | 40,000 | 500 | Keeps buildings in radius 6 powered during outages (hurricane, grid failure) | Start | Yellow box, exhaust puffs |

### Swamp infrastructure
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 9 | Drainage Canal | 1×1 (chain) | 10,000 | 100 | Drains 6 in/hr from itself and 2 in/hr from 8 neighbors; must chain to river, lake, or bayou to function; −1 ecology per 5 tiles; mosquito breeding if stagnant (not connected) | Start | Straight channel, brown water, concrete edge |
| 10 | Levee | 1×1 (chain) | 15,000 | 150 | +5 ft flow elevation; blocks surge and flood spread; subsides 0.06 ft/mo; nutria damage | Start | Grassy berm, darker crest |
| 11 | Pump Station | 2×2 | 200,000 | 4,000 | Removes 4 in/hr from all tiles in radius 8, needs 8 PU; +0.03 ft/mo subsidence in radius | Start | Purple shed, big gold pipe, spinning wheel |
| 12 | Fill (tile upgrade) | 1×1 | 12,000 | 0 | Raises tile +2 ft; marsh → wet ground; −2 ecology; normal subsidence | Start | Tile becomes tan dirt, then grass |
| 13 | Pilings (tile upgrade) | 1×1 | 25,000 | 0 | Any building placed here ignores flooding ≤ 24 in and subsidence; marsh stays marsh (ecology kept) | Start | Row of dark pilings visible under building |
| 14 | Gator Fence | 1×1 (chain) | 3,000 | 20 | Blocks gator pathing; students unhappy if fully enclosed (−1) | Start | Chain link, gold warning sign |
| 15 | Mosquito Abatement Station | 1×1 | 60,000 | 2,000 | −70% mosquito density in radius 10 | Start | White shed, fogger truck parked, mist puffs at dusk |
| 16 | Retention Pond | 2×2 | 80,000 | 300 | Absorbs 40 in of runoff from radius 6 before overflowing; +2 ecology; mosquito breeder unless "Stock with Bream" upgrade ($15k) | Start | Blue-green pool, reeds, occasional heron |
| 17 | Wildlife Office | 2×2 | 180,000 | 3,500 | Enables gator relocation (auto, radius 20, 2/day), nutria bounty (halves levee erosion), +3 ecology | N ≥ 800 | Green ranger cabin, airboat on trailer |
| 18 | Cypress Stand | 1×1 | 3,000 | 0 | +3 ecology, absorbs 1.5 in/hr, −40% subsidence in radius 2, mosquito predator bonus (−10%) | Start | Tall knobby cypress, knees, moss |

### Academic
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 19 | Admin Trailer (pre-placed) | 2×1 | — | 1,000 | +200 seats, HQ; replaced by Admin Hall | Start | Double-wide, purple awning, flag |
| 20 | Lecture Hall | 2×2 | 400,000 | 6,000 | +500 seats, +2 prestige, 6 PU, 3 WU | Start | Tan stucco, red tile roof, columns |
| 21 | Library | 3×3 | 900,000 | 10,000 | +8 prestige, +4 happiness campus-wide, +300 seats | P ≥ 15 | Big brick with gold dome, warm windows at night |
| 22 | Science Lab | 2×2 | 700,000 | 9,000 | +4 prestige, research $12k/mo × (P/40) | P ≥ 20 | Glass block, green chemistry glow |
| 23 | Engineering Complex | 3×3 | 1,500,000 | 15,000 | +8 prestige, +600 seats, research $30k/mo × (P/40), −10% construction cost campus-wide | P ≥ 35 | Steel and glass, rooftop crane |
| 24 | Coastal Research Institute | 3×3 | 1,200,000 | 12,000 | +6 prestige, research $20k/mo × (E/50), reveals subsidence overlay, unlocks levee armor upgrade | P ≥ 30 and E ≥ 50 | Raised lab on stilts over marsh, weather mast |
| 25 | Admin Hall | 2×2 | 600,000 | 5,000 | +5 prestige, +2 happiness, replaces trailer; state funding +10% | N ≥ 2,000 | Grand white columns, purple flags |

### Housing
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 26 | Dorm | 2×2 | 500,000 | 5,000 | +400 beds, 5 PU, 5 WU | Start | Brick 3-story, purple doors |
| 27 | Residence Tower | 2×3 | 1,400,000 | 12,000 | +1,200 beds, 12 PU, 12 WU, −1 happiness (cramped) | N ≥ 3,000 | 8-story beige tower, gold roofline |
| 28 | Greek Row House | 1×2 | 200,000 | 2,000 | +60 beds, +2 happiness in radius 6, monthly 5% chance "party" event (+3 happiness, −$5k) | N ≥ 1,500 | White columns, big Greek letters, porch |

### Dining
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 29 | Dining Hall | 2×2 | 350,000 | 4,000 | Feeds 1,500 (radius 12), +1 happiness | Start | Long low hall, steam vents |
| 30 | Po'boy Shack | 1×1 | 60,000 | 800 | Feeds 300 (radius 8), +2 happiness in radius | Start | Tin-roof shack, hand-painted sign |
| 31 | Café Beignet | 1×1 | 40,000 | 600 | +2 happiness radius 6, +5% class attendance nearby | Start | Green-striped awning, powdered-sugar cloud |

### Athletics
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 32 | Practice Field | 3×3 | 150,000 | 1,500 | Team rating +5 | Start | Striped green field, blocking sleds |
| 33 | Stadium "The Boil" | 5×5 | 2M / 5M / 12M / 25M (Tier 1–4) | 15k / 40k / 90k / 180k | Capacity 20k / 45k / 70k / 100k; +5/+12/+20/+30 prestige; needs Road within 4; 30/60/100/160 PU on game day | Start / P≥25 / P≥45 / P≥65 | Purple bowl, gold lights on masts; each tier adds a deck |
| 34 | Parking Lot | 2×2 | 100,000 | 800 | Each lot serves 10k stadium seats; tailgate host; parking ticket revenue $6k/mo × N/1000 | Start | Gray with gold lines, RVs on game day |
| 35 | Rec Center | 2×2 | 600,000 | 6,000 | +5 happiness campus-wide, retention +2% | N ≥ 1,500 | Glass front, purple climbing wall visible |

### Student life
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 36 | Student Union | 3×3 | 1,200,000 | 10,000 | +8 happiness campus-wide, +3 prestige, festival venue | N ≥ 2,500 | Brick and glass, clock, gold banners |
| 37 | The Quad (lawn) | 2×2 | 30,000 | 200 | +3 happiness radius 8, agents idle here; +1 ecology | Start | Green lawn, diagonal paths, benches |
| 38 | Bandstand | 2×2 | 150,000 | 1,500 | Hosts festivals (+4 happiness on festival days), zydeco audio source | Start | White gazebo, purple/gold bunting |
| 39 | Health Clinic | 2×2 | 300,000 | 4,000 | −60% mosquito illness in radius 14, heat illness −50% | N ≥ 1,000 | White with red cross, ambulance |
| 40 | Live Oak | 1×1 | 5,000 | 0 | +1 happiness radius 3 (grows to +3 over 10 years), shade −heat, +2 ecology, +1 prestige per 20 mature oaks | Start | Wide sprawling canopy, moss when near water |
| 41 | Azalea Beds | 1×1 | 1,000 | 0 | +1 happiness radius 2, blooms pink/white in March (+1 more) | Start | Low bush, seasonal blossom sprites |
| 42 | Crawfish Pond | 2×2 | 50,000 | 500 | Crawfish Boil festival revenue $40k/yr, +2 happiness in April; mosquito breeder (mitigated by abatement) | Start | Muddy rectangle, traps, pirogue |

### Landmarks
| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 43 | Carillon Tower | 2×2 | 3,000,000 | 8,000 | +25 prestige, +3 happiness campus-wide, bells on the hour | P ≥ 50 | Tall Italianate tower, gold clock, bells |
| 44 | Tiger Habitat (home of Roux) | 2×2 | 1,500,000 | 6,000 | +10 prestige, +6 happiness, game-day win prob +3% | Milestone "Geaux Time" | Glass-front rockwork, waterfall, a tiger sprite pacing |
| 45 | Alumni Center | 2×2 | 800,000 | 4,000 | Donations ×1.5 | Alumni ≥ 2,000 | Mansion-style brick, gold porch lights |

*(45 entries; if trimmed to spec range, cut 8, 25, 31, 41, 45 first — see Section 15.)*

---

## 5. Economy

### Starting state
- Cash **$3,000,000**. Debt limit −$1,000,000 at 8%/yr interest (bankruptcy trigger below).
- Enrollment **600**, Alumni 0, Prestige **12**, Happiness **55**, Ecology **80**.
- Tuition slider **$8,000/yr** (range $2,000–$20,000, step $500). Pre-placed: Admin Trailer (200 seats), 1 Substation, 1 Water Tower, a 6-tile road stub, a 4-tile path.
- Coach tier 1 ("Coach Boudreaux, part-time"), ticket price $30, no stadium.

### Monthly income sources (computed on the 1st of each month)
- **Tuition:** `N × tuition / 12` during semester months only (Aug–Dec, Jan–May); summer collects 25% (summer school).
- **State funding:** `150,000 + N × 80 × clamp(P/40, 0.5, 1.5)`; +10% with Admin Hall. Cut 25% during any year the state has a "budget shortfall" random event (12%/yr chance).
- **Research:** sum of lab outputs (Section 4). Multiplied by 1.25 if E ≥ 70 (Coastal Institute grant bonus).
- **Donations:** annual, paid Dec 31: `Alumni × 40 × (0.5 + H/100) × (1 + wins/12) × (Alumni Center ? 1.5 : 1)`. Plus event-driven donor offers.
- **Athletics:** per home game `attendance × ticketPrice + attendance × 8 (concessions) + tailgate permits (parkingLots × 4,000)`. Attendance formula in Section 8. Plus TV money at season end: `$200k × teamRating/50`.
- **Parking tickets:** `parkingLots × 6,000 × N/1000` per month (news ticker complains).
- **Festival revenue:** Crawfish Boil $40k per pond, Mardi Gras ball $30k if Bandstand or Union exists.

### Monthly costs
- **Building upkeep:** sum of catalog upkeep (Section 4).
- **Faculty salaries:** `N × 250` per month (faculty scale with students); prestige investment slider "Faculty Quality" adds 0/+50/+120 per student per month for +0/+2/+5 monthly prestige.
- **Utilities:** `$400 × PU used + $200 × WU used`.
- **Coach salary:** Tier 1 $15k/mo, Tier 2 $60k/mo, Tier 3 $200k/mo.
- **Disaster repair:** damaged buildings display repair cost = `damage% × buildCost × 0.6`; unrepaired buildings work at `1 − damage%` efficiency.
- **Construction:** paid at placement; 25% discount in summer; −10% with Engineering Complex.

Rough year-1 balance: income ≈ $400k tuition + $200k state ≈ $600k/mo in semester; costs ≈ $150k salaries + $40k upkeep + $20k utilities ≈ $210k/mo. Net ≈ +$390k/mo in fall, +$50k in summer. A Dorm every ~6 weeks feels right; a stadium is a 2-year decision.

### Enrollment model
Twice a year (Aug 15, Jan 10):
- `applicants = (300 + 60 × P) × fTuition × fHappy × fRep`
  - `fTuition = clamp(1.6 − tuition / 13,333, 0.3, 1.5)` (→ $8k: 1.0, $4k: 1.3, $12k: 0.7, $16k: 0.4)
  - `fHappy = 0.5 + H / 100`
  - `fRep = 1 + 0.02 × wins last season − 0.15 × (major floods last year)`
- `capacity = min(seats, beds + 300 commuters + 0.15 × N if road-connected)`; every 1,000 students over the Wastewater threshold without a plant caps capacity growth to 0.
- `admits = min(applicants × 0.5, capacity − N)`; spring intake is 40% of fall.
- **Retention** each semester end: `keep = 0.90 + 0.10 × (H − 50)/50 − 0.05 × floodedDaysThisSemester/10 − 0.02 × unpoweredShare`; dropouts leave. Every May, 22% of the body graduates → Alumni.

### Prestige model (0–100)
`P` moves toward a **structural target** `Pt` at 4%/month:
`Pt = 10 + Σ buildingPrestige + facultySlider×(0/8/16) + 0.5 × min(researchK, 40) + 0.3 × matureOaks(cap 20) + winsBonus − overcrowd`
- `winsBonus = 2 × wins last season, +6 for a Boot Bowl win, +10 for conference title`
- `overcrowd = 15 × max(0, N/seats − 1)`
- Landmarks are the big jumps. Prestige also takes instant hits: −5 per building destroyed, −8 "Campus Underwater" headline, −3 gator injury event.

### Happiness model (0–100)
Recomputed daily as a weighted campus mean:
`H = 50 + housing(±12) + dining(±8) + amenities(0..+20) + walkability(±6) + football(0..+8) + festivals(0..+5) − mosquito(0..15) − flood(0..20) − heat(0..8) − tuition(0..12) − outage(0..10) − gator(0..6)`
- housing: `+12 × min(1, beds/N) − 12 × max(0, 1 − beds/N)`
- dining: `+8` if fed ≥ 100%, linear down to −8 at 50%
- amenities: sum of campus-wide and radius effects (radius effects weighted by share of students within radius)
- walkability: −6 if mean path distance housing→class > 25 tiles, +6 if < 10
- mosquito: `15 × mean mosquito density over occupied tiles`
- flood: `20 × share of occupied tiles with ≥ 6 in standing water`
- heat: summer only, `8 × (1 − shadeCoverage)`
- tuition: `12 × clamp((tuition − 8,000)/8,000, 0, 1)`

### Key feedback loops (the reason the numbers above exist)
1. **Growth treadmill:** prestige → applicants → enrollment → tuition → cash → buildings → prestige. Brakes: seats/beds capacity, wastewater threshold, overcrowd penalty, salaries scale linearly with N so margin per student is thin at high N.
2. **Tuition tension:** raising tuition lifts income per head but cuts applicants and happiness; the optimum drifts upward with prestige (a P=70 school can charge $14k).
3. **Drain-vs-sink:** pumps and fill dry land now, subsidence lowers it later, which raises flood exposure, which demands more pumps. Cypress and pilings are the slow, expensive exits.
4. **Ecology-vs-space:** every marsh tile filled is −2 ecology and −2 in/hr absorption downhill; ecology ≥ 70 pays research bonus and dampens mosquitoes; ecology < 30 doubles mosquito growth and triggers "EPA" fines ($100k/yr).
5. **Football flywheel:** stadium + coach → wins → prestige + donations + attendance → cash → bigger stadium; costs: coach salary, game-day power spikes, rowdiness happiness dips on losses, and the stadium is the single most surge-exposed asset if placed low.
6. **Happiness-retention:** unhappy students leave in December, which drops tuition in January right when spring floods hit.

---

## 6. Swamp Survival Systems

All hydrology runs once per **game hour** on a `Float32Array` of standing water `S` (inches) per tile.

### Hydrology
- **Rain:** weather state provides `rainRate` in in/hr: drizzle 0.1, shower 0.4, storm 1.2, tropical 3.0, hurricane 5.0. Rain is seasonal: monthly rain-day probability Jan 30%, Feb 30%, Mar 35%, Apr 35%, May 40%, Jun 45%, Jul 50%, Aug 45%, Sep 40%, Oct 25%, Nov 25%, Dec 30%. Rain events last 3–18 hours.
- **Per tile per hour:** `S += rain − absorb(type) − drain(structures)`; `absorb`: marsh 2.0, cypress +1.5, wet 0.6, dry 0.4, high 0.4, paved (road/lot/building) 0.05, water tiles infinite.
- **Flow:** for each tile, if `S > 1` and a 4-neighbor has lower `effElev` (`elev + S/12 + leveeBonus`), move `min(S × 0.35, (Δ effElev) × 12 / 2)` inches to it. Levee tiles never receive flow from lower tiles and have +5 ft. Water tiles are sinks. Process in a checkerboard order to avoid bias.
- **Flood states:** `S ≥ 6` = "flooded" (tile tint, buildings on it −50% effect, agents splash), `S ≥ 24` = "underwater" (building takes 2% damage/hour, agents avoid), pilings ignore up to 24.
- **Canals:** connected chain (BFS from any canal tile to river/lake/bayou) drains 6 in/hr on itself and 2 in/hr on 8 neighbors; an unconnected chain drains nothing and counts as standing water for mosquitoes.
- **Pumps:** −4 in/hr in radius 8 if powered; during outages they stop, which is the hurricane trap.
- **Retention pond:** stores up to 40 in aggregated from radius 6 before acting as a normal tile.
- **Water table:** a global `wt` 0..1 rises 0.02 per rain day and falls 0.01 per dry day; `absorb` is multiplied by `(1 − 0.6 × wt)` so wet springs flood more from less rain.

### Hurricane season (Jun 1 – Nov 30, peak Aug 15 – Oct 15)
- **Spawn:** each day in season, chance `0.6% × peakMult` (peak 3×) → roughly 1.1 storms/yr. Year 1 is scripted: a storm spawns the first day after the tutorial completes *and* the calendar reads ≥ Sep 10, capped at Cat 2 in year 1. Years 2+: category weights Cat1 35%, Cat2 30%, Cat3 20%, Cat4 10%, Cat5 5%.
- **Forecast:** at spawn, storm is 6 days out. Minimap shows a cone from the Gulf (south edge) toward a target tile; cone half-width shrinks 40 → 8 tiles as the storm nears. Track wobbles ±6 tiles at landfall. Daily "NHC-style" advisory in the ticker. HUD shows a purple-gold hurricane badge with countdown.
- **Prep decisions (each is one click during the 6 days):** sandbag campaign ($50k, +1 ft levee bonus for 10 days on all levees), cancel classes (−$ tuition day, +retention), evacuate dorms ($20k/1,000 students, zero casualties), fuel generators ($10k, keeps generators running 72 h instead of 24), board up ($30 per building, −30% wind damage).
- **Landfall (12–36 game hours):** wind `W = 75/95/115/140/160 mph` by category. Per building per hour: `damage += (W − 60)/100 × 1.5% × (boardedUp ? 0.7 : 1) × (leeOfHighGround ? 0.8 : 1)`. Trees: 5%/20%/40%/60%/80% chance to fall (live oaks half that; fallen trees block paths until cleared $2k). Power: grid outage probability 30/60/85/100/100%, lasting 2–10 days; generators cover their radius.
- **Storm surge:** `surge = 3/6/10/14/18 ft` entering from river and lake edges; any tile whose `effElev < surge` and that is connected to the source through tiles also below surge (BFS honoring levees) gets `S = (surge − elev) × 12` inches instantly. Levees that are ≥ 2 ft below the surge height *overtop* and act as normal tiles. This is the set piece: a wall of blue crossing the map, with the levees you built holding or not.
- **Recovery:** damaged buildings show scaffolding; repair queue costs money and 3 days each; FEMA-style "State Disaster Aid" event pays 40% of repairs if P ≥ 25; enrollment `fRep` penalty if > 30% of tiles flooded ("Campus Underwater" headline). Debris tiles (fallen trees, wrecked RVs) auto-clear in 10 days or $2k each.

### Gators
- **Population:** `target = waterTiles/40 × (0.6 + E/100)`, cap 40. Spawn at random water tiles until target. Sprite: 1 tile long, dark green, gold eyes at night.
- **Behavior (per 2 s tick):** state machine BASK (on bank, 30–90 s) → WANDER (random walk up to 8 tiles from water, avoids fenced tiles, prefers wet/marsh/crawfish pond/retention pond, 20–60 s) → RETURN. In April–June (mating season) wander range is 14 and speed +50%. Gators on a tile with a student within 2 tiles make the student flee (Section 7). A gator standing on a building footprint tile for > 10 s triggers "Gator in the [building]" news and −2 happiness in radius 6 for a day; on the stadium during a game −5 happiness but +1 prestige ("that's a vibe").
- **Injury event:** 0.2%/day per gator within 3 tiles of ≥ 5 students → "student bitten" (−3 prestige, −$50k settlement). Rare, loud, memorable.
- **Counterplay:** Gator Fence (chains block pathing; enclosing your core costs ~40 tiles = $120k), Wildlife Office (relocates 2/day within 20 tiles; each relocation costs $1k and produces a ticker line), keeping crawfish/retention ponds away from dorms, boardwalks rather than filled land (gators cross under, students above: no encounter).
- **Charm:** gators sun on the Quad, on parking lots on game day, and in the Carillon fountain. Halloween: "the gators wear beads".

### Mosquitoes
- **Density grid** `M` (0–1) per tile. Each day: `M += 0.15` on tiles with `S ≥ 1` for ≥ 3 consecutive days, crawfish ponds, unstocked retention ponds, unconnected canals; `M += 0.05 × meanNeighborM` (spread); `M −= 0.04` baseline decay, `−0.10` if temp < 55°F (Dec–Feb effectively zero), `−0.7 × abatementCoverage`, `−0.10` if within 2 of cypress, `−0.10 × (E/100)` (dragonflies, bats, healthy marsh).
- **Effects:** happiness −15 × mean M (Section 5); illness events: daily chance `2% × meanM × N/1000` of "West Bayou fever outbreak" (−$30k clinic bill, class attendance −20% for a week, −2 prestige) halved by Health Clinic; agents on `M > 0.5` tiles show a slap animation.
- **Counterplay:** drain standing water (canals/pumps), Abatement Stations, Stock ponds, cypress, Health Clinic, or accept it and hand out citronella (event: $10k, −0.2 M for a month).

### Subsidence
- Monthly, per tile: `elev −= base(type) + Σ modifiers`: dry 0.010 ft, wet 0.015, filled marsh 0.025, high 0.005; +0.030 inside any pump radius; +0.010 per building tile weight (footprint ≥ 3×3); ×0.6 within 2 of cypress; levee tiles 0.06 (nutria ×2); pilings tiles 0.
- Effects are invisible for two years then bite: wet ground becomes marsh, levees drop below surge height, the campus core slowly moves from dry to wet. The Coastal Institute unlocks the **Subsidence overlay** and "Levee Armor" upgrade ($8k/tile, halves levee sink). A ticker line every year: "Surveyors report campus has sunk X inches since founding."

### Heat and humidity
- Daily temperature from a seasonal curve (Jan mean 52°F, Jul 92°F, ±8 noise) + humidity 60–95%. Heat index ≥ 100 flags a **heat day** (Jun–Sep ~40% of days).
- Heat days: power demand ×1.3 (AC), unshaded happiness −8 × (1 − shade), practice field team rating −1/day if no Rec Center (hydration), agents walk slower and cluster under oaks. Live oaks and covered walkways (paths adjacent to a building) provide shade. Fog mornings in Oct–Mar (visual).

### Nutria and other wildlife
- **Nutria:** population 5–30, live in marsh. Each nutria adjacent to a levee tile adds +0.06 ft/mo erosion there and gnaws azaleas (−1 bloom). Wildlife Office bounty halves it. Comedy: "Nutria elected homecoming court write-in."
- **Herons, egrets, pelicans:** purely visual, spawn on water edges when E ≥ 50; count is a soft ecology readout players learn to read.
- **Fireflies:** particle effect at dusk on tiles with E ≥ 60 nearby.
- **Roux the Tiger:** mascot in the Habitat; paces, roars on touchdowns (audio).

### Ecology score (0–100, start 80)
- Monthly: `E → target` at 5%/mo, `target = 40 + 0.06 × marshTiles + 0.4 × cypress + 0.2 × liveOaks + 2 × retentionPonds + 3 × wildlifeOffice − 1 × canalTiles/5 − 4 × wastewaterPlants − 0.02 × pavedTiles − 10 × (levee tiles/50)`.
- **Benefits:** E ≥ 70: research ×1.25, mosquitoes −0.1/day, donations "Green Campus" +10%, birds and fireflies. E ≥ 50: Coastal Institute unlock; gator population healthy (which is both a benefit and a hazard).
- **Costs of destroying it:** E < 30: mosquitoes ×2 growth, EPA fine $100k/yr, −5 prestige, marsh absorption gone so floods peak 30% higher; E < 15: "Dead Swamp" headline, applicants −20%.

---

## 7. Student Life (light)

- **Visualized agents:** up to 320 sprites; each represents `ceil(N / 320)` real students. Abstracted students exist only as numbers. Agent count scales from 60 at N=600 to 320 at N ≥ 4,000.
- **Stats per agent:** `mood` (0–100, follows campus H with ±15 personal offset and short-term events), `energy` (drains walking, restores at dorm/dining), `spirit` (0–100, rises with wins, festivals, Greek row; drives cheering/tailgating animations), `home` (dorm or "commuter" at road stub), `major` (Engineering/Ag/Science/Arts/Business — decides which lecture hall they prefer and the color of their backpack).
- **Schedule (game hours):** 07 wake, walk to class (nearest seat building by BFS on the path graph), 12 walk to dining, 14 class, 17 amenities (Quad, Union, Rec, Café), 20 back home; weekends: Quad/Greek row/Union; game day: tailgate lot from 10:00, stadium at kickoff, streets after (win: parade line to the Quad, loss: shuffle home).
- **Visible behaviors:** walking on paths (pathfinding cached per source/destination pair, recomputed on build), umbrellas in rain, splashing in ≤ 12 in flooding (+mood briefly, "Bayou State Beach Day" ticker), avoiding ≥ 24 in water, fleeing 6 tiles from a gator with an exclamation bubble, slapping at mosquitoes on high-M tiles, sitting under live oaks on heat days, dancing near the Bandstand during festivals, throwing beads at Mardi Gras, cheering in purple/gold in the student section, sleeping on the Quad after a night game.
- **Effects on the sim:** agents are the *sampling* mechanism for radius effects (happiness is computed from where agents actually are, so a Po'boy Shack nobody walks past does nothing); agent flee events fire gator ticker lines; agent traffic on an unpaved desire line (agents cutting across grass repeatedly) prompts a "Students want a path here" hint. Click any student for a name (Section 14), major, mood, and a one-line thought.

---

## 8. Sports (light)

- **Season:** 12 games, Saturdays from the first Saturday after Sep 1 through the Saturday after Thanksgiving; 6 home, 6 away. Game 8 is **Homecoming**. The final game is the **Boot Bowl** vs Sabine Tech (rivalry). Every 4th home game is a **night game** if the stadium is Tier 2+ (attendance ×1.15, revenue ×1.15, happiness +2, rowdiness event chance 10%).
- **Stadium tiers:** see catalog (20k/45k/70k/100k). No stadium = no home games (the team plays "at the high school in Red Stick": revenue $20k, prestige 0).
- **Team rating:** `R = 20 + coachTier × 12 + practiceFields × 5 (cap 2) + stadiumTier × 3 + P × 0.3 + recCenter × 3 + tigerHabitat × 3 − heatPenalty`. Opponent ratings 30–85 from a fixed schedule table with yearly ±8 drift.
- **Win probability:** `p = 1 / (1 + e^(−(R − Ropp + homeAdv)/12))`, home advantage +6 (+9 night game, +12 Boot Bowl at home). Resolved at 19:00 game day with a 20-second in-world sequence: score ticker, crowd noise, fireworks on a win.
- **Attendance:** `min(capacity, 3,000 + N × 2.5 + Alumni × 0.5 + P × 300) × ticketFactor × (winning streak ≥ 3 ? 1.2 : 1)`, `ticketFactor = clamp(1.4 − ticketPrice/100, 0.3, 1.2)`.
- **Revenue and prestige:** Section 5. Each win +2 structural prestige for the year; Boot Bowl win +6, a 10+ win season +10 and a donor "statue" event. Each loss −1 happiness for 3 days; a losing season (< 5 wins) −3 prestige and coach-firing prompt.
- **Decisions:** coach tier (3 levels, salary in Section 5), ticket price ($10–$120), tailgate permit policy (Free: +3 happiness, −revenue; Paid: +revenue), night game opt-in, Homecoming budget ($0/$50k/$150k → +0/+3/+6 happiness, +0/+1/+3 prestige).
- **Rivalries:** Sabine Tech (Boot Bowl, west), Magnolia A&M (north, "The Delta Brawl"), Gulf Coast State (south, the "Hurricane Hat" trophy), Ozark University (upstart), Red Stick Baptist (crosstown, always loses, always talks).
- **Tailgate visuals:** parking lots fill with RVs, tents, smoke particles, a rotating pig, purple-and-gold flags, a brass band sprite group at the stadium gate, students in body paint. After the game: trash sprites on lots for 2 days (−1 happiness unless a cleanup crew $5k).

---

## 9. Time and Calendar

- **Sim tick:** fixed 10 Hz (100 ms) logic step, decoupled from render (requestAnimationFrame). Agents update every tick; hydrology every game hour; economy on the 1st of the month; enrollment on Aug 15 and Jan 10.
- **Game time:** 1 game day = 3 real seconds at 1×; 1 game hour = 125 ms. A year ≈ 18 minutes at 1×. Speeds: pause (space), 1×, 2×, 4× (keys 1/2/3); hurricane landfall and game day auto-drop to 1× unless the player overrides.
- **Day/night:** 24-hour cycle, sunrise 06:00, sunset 19:30 (summer) / 17:30 (winter). Night tint deep purple-blue; windows and stadium lights glow.
- **Seasons:** Fall (Aug 15–Dec 15, orange-brown foliage on oaks late Nov), Winter (Dec 16–Feb 28, muted, fog), Spring (Mar 1–May 10, azaleas bloom, brightest greens), Summer (May 11–Aug 14, saturated, heat haze).
- **Academic calendar:** Fall semester Aug 15–Dec 15; Finals Dec 8–15 (Library +5 happiness effect); Winter break; Spring Jan 10–May 10; Commencement May 10 (graduation ceremony on the Quad, caps thrown); Summer session.
- **Hurricane season:** Jun 1–Nov 30, peak Aug 15–Oct 15.
- **Festival days:** Zydeco Fest (Sep 20), Homecoming (game 8), Halloween (Oct 31, fog, gators with beads), Levee Bonfires (Dec 24, bonfire sprites on levee tiles, +2 happiness per 10 levee tiles), Mardi Gras (Feb 24, parade route along roads, beads particles, classes cancelled, +6 happiness, −1 day tuition), Crawfish Season (Mar 15–May 15) with the Crawfish Boil (Apr 15, +4 happiness, pond revenue), Commencement (May 10).

---

## 10. Onboarding and Progression

### First two minutes (guided, by doing)
The game opens on Aug 1, Year 1, paused, camera on the Admin Trailer. A single objective card sits bottom-center with a pulsing target on the map. No modal text longer than two sentences.

1. (0:00) *"Welcome, Chancellor. Drag to pan, scroll to zoom. Find the trailer."* Camera nudge; completes on any pan.
2. (0:10) *"Students need somewhere to sleep. Place a Dorm on the highlighted dry ground."* Palette opens to Housing, valid tiles glow gold. Completes on placement.
3. (0:25) *"Connect it with a Path to the trailer."* Path tool auto-selected; a ghost line hints the route.
4. (0:40) *"Class is in session. Place a Lecture Hall."* Then *"Feed them: a Po'boy Shack."*
5. (1:00) *"Unpause (space). Watch them walk."* Time starts at 1×. Six agents leave the dorm. First ticker line fires.
6. (1:15) *"That low ground floods. Toggle the Flood Risk overlay (F)."* Blue tint appears on wet tiles near the dorm.
7. (1:30) *"Dig a Drainage Canal from that puddle to the bayou."* Canal tool; completion when connected (the chain lights up green).
8. (1:50) *"Open the Budget (B) and set tuition. $8,000 is fine for now."* Completes on closing the panel.
9. (2:00) *"You're on your own, Chancellor. Aug 15: enrollment day."* Objective chain continues, un-forced.

### Guided objective chain (after the tutorial; each shows a target and a reward)
- Build a Substation so coverage reaches your Dorm (reward $50k)
- Reach 1,000 students
- Place a Practice Field and set a ticket price → first away game plays
- Place 10 Live Oaks (reward +2 prestige)
- **Hurricane Warning** (scripted, ≥ Sep 10): "Build 8 levee tiles between the bayou and your dorms, and a Generator" → landfall set piece → "Repair all damage"
- Build a Stadium (Tier 1) → first home game
- Reach Prestige 25 → Library
- Build a Wildlife Office after the first "Gator in the Quad" event
- Reach Ecology 70 or build a Coastal Research Institute
- Win the Boot Bowl

### Milestones / achievements (22)
1. **Groundbreaking** — place first building. 2. **Laissez les bons temps rouler** — 1,000 students. 3. **Geaux Time** — first home win (unlocks Tiger Habitat). 4. **Levee Board** — 30 levee tiles. 5. **High and Dry** — survive a hurricane with zero flooded buildings. 6. **Cat 5 Survivor** — survive a Category 5. 7. **Boot Bowl Champions** — beat Sabine Tech. 8. **The Boil** — Tier 4 stadium. 9. **Ten-Win Season**. 10. **Bookworms** — Library + 2 labs. 11. **Research One** — $100k/mo research. 12. **Ivory Tower** — Prestige 75. 13. **Swamp Steward** — Ecology 85 with N ≥ 5,000. 14. **Skeeter Free** — mean mosquito density < 0.05 for a full summer. 15. **Gator Whisperer** — 100 relocations. 16. **Nutria Bounty** — 50 nutria removed. 17. **King Cake** — host 5 Mardi Gras. 18. **Mudbug Millionaire** — $1M from crawfish. 19. **Sinking Feeling** — campus has subsided 2 ft (ironic achievement, teaches the system). 20. **Chancellor Emeritus** — 25,000 students. 21. **Flagship** — Carillon + Habitat + Tier 3 stadium + Prestige 80. 22. **Immortal** — play 20 game years.

### Unlock progression
Tier 0 (start): paths, roads, dorm, lecture hall, dining, shacks, all swamp infrastructure, practice field, stadium T1, oaks, quad. Tier 1 (P 15–25 / N 1,000–1,500): Library, Science Lab, Clinic, Greek Row, Rec Center, Wastewater, stadium T2. Tier 2 (P 30–45 / N 2,500–3,000): Coastal Institute, Engineering, Union, Residence Tower, stadium T3. Tier 3 (P 50–65): Carillon, stadium T4, Alumni Center (by alumni count).

### Failure states
- **Bankruptcy:** cash < −$1,000,000 for 3 consecutive months → "State takeover": the state pays off debt, sets tuition to $6k, freezes construction for 12 months, prestige −20. Not game over; a humiliating reset. Second takeover → game over screen with stats and a "keep playing in sandbox" button.
- **Campus underwater:** > 50% of occupied tiles ≥ 24 in for 5 days → students evacuate (N −40%), applicants penalty for 2 years. Recoverable.
- **Accreditation lost:** seats/N < 0.5 or P < 5 for two semesters → warning, then loss: state funding 0 until P ≥ 15 and ratio ≥ 0.8.
All three surface as full-width news alerts with a "What now?" hint listing two concrete fixes.

### Endgame / sandbox
No forced end. "Flagship" milestone triggers a ceremony (fireworks, Carillon bells, donor list scroll) and the sandbox continues with escalating storms (category weights shift +5% per 5 years toward severe) and subsidence as the long-run antagonist. Optional "Scenario" seeds on the title screen: **Big Muddy** (start on the river ridge, high surge), **Backswamp** (start in marsh, cheap land), **Hard Mode** (half cash, storms every year).

---

## 11. UI / UX

### HUD layout (1280×800 reference; scales)
```
+----------------------------------------------------------------------------------+
| $2,410,300 (+$212k/mo) | 1,240/1,600 students | P 21 | H 63 | E 74 | Aug 22 Y1  |
| [||] [1x] [2x] [4x]   [cone icon: TROPICAL STORM "Antoine" 4d]      [Menu] [Snd] |
+----------------------------------------------------------------------------------+
|                                                                      +---------+ |
|                                                                      | minimap | |
|        ISOMETRIC MAP VIEWPORT                                        |  cone   | |
|                                                                      +---------+ |
|                                                                      [overlays] |
|                                                                      F M P C S E |
|                                                                                  |
|  +-----------------------------+                                                 |
|  | OBJECTIVE: Dig a canal to   |                     +-------------------------+ |
|  | the bayou (0/1)   reward $  |                     | INSPECT: Dorm "Acadian" | |
|  +-----------------------------+                     | 400 beds  98% occupied  | |
|                                                      | Power OK  Water OK      | |
|                                                      | Flood risk: HIGH        | |
|                                                      | [Repair] [Demolish]     | |
|                                                      +-------------------------+ |
+----------------------------------------------------------------------------------+
| BUILD: [Paths] [Utilities] [Swamp] [Academic] [Housing] [Dining] [Athletics] [Life] [Trees] [Landmarks] |
|        tiles for the open category, name + cost on hover, greyed if locked (tooltip says why)         |
+----------------------------------------------------------------------------------+
| >>> Gator spotted sunning on the Quad. Wildlife Office: "He's a fan."  ▸ Coach Boudreaux ... |
+----------------------------------------------------------------------------------+
```
- **Top bar:** cash (green/red), monthly net in parentheses, enrollment/capacity, P/H/E as small colored pills (click any for a breakdown popover listing contributing terms, which is how the systems become legible), date, speed buttons, hurricane badge when active, menu, sound toggle.
- **Build palette (bottom):** 10 category tabs, each a horizontal strip of icon tiles; hover shows name, footprint, cost, upkeep, one-line effect; locked items greyed with "Prestige 25 needed". Right-click or Esc cancels; Shift holds the tool for chain placement (paths, levees, canals, fences default to drag-to-draw).
- **Inspect panel (right):** appears on click; shows building stats, coverage status, flood risk from the hydro grid, damage, occupancy, agents inside, buttons: Repair, Upgrade (stadium, pond stocking, levee armor), Demolish (refund 40%). Clicking a tile shows terrain, elevation, standing water, mosquito density, subsidence to date.
- **Objectives card (bottom-left):** one active objective plus a "3 more" expander.
- **News ticker:** scrolling, click a line to jump camera to its location; important alerts (hurricane, bankruptcy) also raise a centered banner.
- **Minimap:** 144×144 px, terrain colors, building dots, forecast cone, click to jump.
- **Overlays (toggle keys):** F Flood risk (blue gradient of `S` plus predicted surge shading), M Mosquito density (green-yellow-red), P Prestige radius contributions, C Coverage (power/water rings, unpowered buildings pulse red), S Subsidence (once unlocked), E Ecology (marsh health). Only one overlay at a time; overlay legend appears bottom-right.
- **Panels (keys):** B Budget (income/expense table, tuition slider, faculty slider, debt), T Team (coach, tickets, schedule, record), K Calendar (upcoming festivals, storms), L Milestones.
- **Camera:** drag to pan (left-drag on empty ground, or middle/right drag), WASD/arrows, scroll to zoom (0.5×–2×, 4 steps), trackpad pinch supported, Home key centers on campus. Edge-of-map clamped.
- **Shortcuts:** Space pause; 1/2/3 speed; Esc cancel/close; Tab cycles overlays; R rotate not needed (fixed isometric); Del demolish tool; Ctrl/Cmd+S save; U undo last placement (within 5 s, full refund).
- **Tooltips:** every number in the HUD has a hover tooltip naming its formula terms in plain words ("Applicants: 1,860 = base 300 + prestige 1,260, ×1.0 tuition, ×1.13 happiness").
- **Touch (nice-to-have):** single-finger pan, pinch zoom, tap to inspect, long-press to place.

### Budget panel sketch
```
+------------------ BUDGET (monthly) -----------------+
| INCOME              |  EXPENSES                     |
| Tuition     412,000 |  Salaries        155,000      |
| State       198,000 |  Upkeep           44,500      |
| Research     14,000 |  Utilities        21,000      |
| Athletics    36,000 |  Coach            15,000      |
| Parking       7,200 |  Debt interest         0      |
| Total       667,200 |  Total           235,500      |
|                     NET  +431,700                   |
| Tuition  [----o------]  $8,000   applicants x1.00   |
| Faculty  [ Basic | Good | Elite ]   +0 prestige/mo  |
+-----------------------------------------------------+
```

---

## 12. Visual Style

- **Projection:** 2:1 isometric, fixed orientation (no rotation, which keeps sprite work manageable). Tile 64×32 px at zoom 1; elevation drawn as vertical offset `−elev × 6 px` with a darker "cliff" side wall where a tile is ≥ 1.5 ft above its south/east neighbor. Buildings are drawn as extruded boxes with roofs and window grids, sorted by `x + y` then footprint.
- **Palette:** Purple `#461D7C` (deep), `#6B3FA0` (mid), Gold `#FDD023`, `#C99700` (dark gold); Swamp greens `#2F5D3A`, `#4E8A4F`, `#8FBF6A`; marsh brown `#6E5A3A`; mud `#4B3A2A`; water `#2C5F73` (bayou), `#3E7A8C` (lake), `#7A6B4F` (river, muddy); sky/night tint `#1A1030` at 55% multiply; sand path `#D8C8A8`; asphalt `#3A3A40`. UI is dark purple panels with gold borders and cream text.
- **Day/night tint:** a full-screen overlay color lerped by hour: dawn peach (#FFB88C, 20%), noon none, dusk orange-purple (#B05A7A, 25%), night (#1A1030, 55%). Emissive layer drawn after the tint: windows (warm), stadium lights (gold cones), fireflies, generator glow, street lamps on roads.
- **Weather:** rain as 2-px diagonal streaks in a pooled particle array (max 600), puddle shimmer on flooded tiles, lightning as a 2-frame white flash with a 40 ms screen-shake, hurricane as rain ×3, horizontal debris particles, tree sway (sprite skew ±6°), fog as 3 drifting semi-transparent noise blobs Oct–Mar mornings, heat haze as a 1-px sinusoidal row offset on the horizon band on heat days.
- **Animation list:** students walk (4-frame), umbrella variant, flee (fast, exclamation bubble), splash, mosquito-slap, sit, cheer (arms up), bead-throw, graduation-cap toss; gators walk/bask/mouth-open; nutria scurry; herons stand/fly; water surface 3-frame shimmer; azalea bloom fade; cypress moss sway; stadium light flicker on; fireworks bursts; RV smoke; pump wheel spin; fogger mist; abatement truck drive-by; flag wave; Roux pacing; bells swing on the hour; crane on the Engineering roof rotates.
- **Particles:** pooled 2,000 max: rain, smoke, sparks/fireworks, fireflies, beads, powdered sugar, leaves in Nov, mosquito clouds (tiny dots over high-M tiles), splash droplets, construction dust on placement.
- **Juice:** placement thunk with a 6-px squash-and-stretch pop, cash delta floats up from the top bar, HUD numbers tween, level-up ribbon for milestones, screen shake on landfall (amplitude scales with category), slow-mo 0.5× for the first 2 seconds of the surge, chromatic-free but with a vignette during hurricanes, camera auto-pan to a first-time event.
- **Procedural sprites:** every sprite is drawn once by a function `drawX(ctx, variant, frame)` into an offscreen canvas atlas at zoom 1 and 2 (about 200 sprites × 2 = ~4 MB VRAM). Buildings: base box in palette color, side shade −25%, roof shape (flat/gable/dome/tower), window grid drawn as 2×3 px rects with random lit state at night, a 1-px darker outline, gold trim on purple buildings. Trees: layered circles with jitter; Spanish moss as 1-px pale gray dangling lines. Students: 6×10 px body (shirt color by major, purple/gold on game day), 4×4 head with skin tone from a 6-value list, 2-px legs alternating. Gators: 22×8 px lozenge, two bumps, eyes. Terrain: each tile type has 3 variants with dithered noise so the ground doesn't tile visibly.

---

## 13. Audio (synthesized, muted by default)

Single `AudioContext` created on first user gesture; master gain 0 until the toggle is on.
- **Ambience:** frog chorus (bandpass-filtered noise bursts at 2–4 Hz, louder at night and near marsh), cicadas (high-pitched sawtooth tremolo, summer daytime, volume ∝ heat), rain (pink noise lowpass, volume ∝ rainRate), thunder (low noise burst with 1.5 s decay, panned), wind (filtered noise rising with hurricane category), bells (Carillon: sine partials with inharmonic overtones on the hour).
- **UI:** place (short square blip with pitch drop), invalid (buzz), cash (coin tick sequence), milestone (three-note gold fanfare), alert (two-tone siren for hurricane).
- **Game day:** procedural brass-band/zydeco motif: 8-bar loop at 120 bpm in Bb, sawtooth "trumpet" lead on a fixed melody array, square-wave "tuba" on roots, a noise-burst snare on 2 and 4, and a rubboard (short high noise tick, 16ths) plus an accordion pad (two detuned squares) when the Bandstand exists. Crowd roar on touchdowns (noise swell); Roux's roar on wins (low sawtooth growl with pitch sweep).

---

## 14. Flavor Content

**Mascot:** Roux the Tiger (a Bengal in a purple bandana). **School:** Bayou State University, "BSU". **Town:** Red Stick. **River:** the Big Muddy. **Lake:** Lake Roux. **Stadium:** The Boil. **Team:** the Bayou State Tigers. **Fight cry:** "Geaux Tigers!" **Motto:** "Laissez les bons temps rouler."

**Rival schools:** Sabine Tech Timberwolves (Boot Bowl), Magnolia A&M Rebels-turned-Herons, Gulf Coast State Pelicans, Ozark University Razorhogs, Red Stick Baptist Saints-in-Training, Atchafalaya Community College (scrimmage).

**Building names generator:** Halls draw from `[Acadian, Pontchartrain, Evangeline, Atchafalaya, Boudreaux, Thibodaux, Fontenot, Landry, Broussard, Guidry, Hebert, Arceneaux, Cypress, Magnolia, Tchoupitoulas, Bienville, Iberville, Plaquemine, Terrebonne, Lafourche]` + `[Hall, House, Commons, Center, Annex, Pavilion]`; dining spots from `[Mama Lou's, Boudin Barn, Gumbo Shack, Roux's Café, Po'boy Palace, Crawdad Corner, The Beignet Box]`.

**Student names generator:** first names `[Beau, Remy, Celeste, Thibault, Marie, Jolie, Aurelie, Claude, Etienne, Odile, Pierre, Simone, Landry, Delphine, Jacques, Camille, Antoine, Noelle, Luc, Josette, Bastien, Adele, Marcel, Fleur, Theo, Yvette, Rene, Colette, Emile, Desiree]`, surnames `[Boudreaux, Thibodeaux, Fontenot, Landry, Broussard, Guidry, Hebert, Arceneaux, LeBlanc, Robichaux, Breaux, Cormier, Dupuis, Melancon, Trahan, Babineaux, Comeaux, Doucet, Richard, Savoie, Batiste, Toussaint, Delacroix, Prejean, Bergeron]`; 10% get a nickname in quotes: `"Boo", "T-Boy", "Tee", "Coco", "Bubba", "Pistol"`.

**News ticker / event lines (48):**
1. Gator spotted sunning on the Quad. Wildlife Office: "He's a fan."
2. Surveyors report campus has sunk 3 inches since founding. Chancellor: "It's fine."
3. Freshman confuses cypress knee for a small student.
4. Mosquitoes declared unofficial state bird again.
5. Coach Boudreaux: "We're gonna run the ball. Also there's a gator on the field."
6. Tropical storm strengthens in the Gulf. Levee Board meeting moved to the levee.
7. Dining Hall introduces gumbo Fridays. Attendance up 40%.
8. Nutria elected homecoming court write-in.
9. Student section sets noise record; seismograph in the Science Lab registers 2.1.
10. King cake baby found in the Wastewater Plant. Investigation ongoing.
11. Levee bonfires lit on Christmas Eve to light the way for Papa Noel.
12. Parking tickets fund a new azalea bed. Students unimpressed.
13. Heat index 108. Roux the Tiger issued a kiddie pool.
14. Airboat rescue of six students from a flooded parking lot. Students: "10/10 would flood again."
15. Alumni donor offers $500k if you name a building after his boat.
16. Zydeco Fest tonight at the Bandstand. Bring a rubboard.
17. Crawfish Boil: 4,000 pounds purged, boiled, and gone by 3 p.m.
18. Mardi Gras parade rerouted around the pump station. Beads recovered from impeller.
19. Sabine Tech fans spotted stealing a boardwalk plank. Boot Bowl is Saturday.
20. Library announces 24-hour finals week. Also announces coffee shortage.
21. Fog so thick this morning the Carillon rang for nobody.
22. Herons return to campus marsh. Ecology students weep openly.
23. Pump Station 2 "sounds like it's chewing something."
24. Fireflies over the Quad tonight. Physics club calls it "bioluminescent extra credit."
25. Storm surge topped the south levee by 18 inches. Sandbag brigade forming at the Union.
26. Power outage day 3. Generator at the Dorm now the most popular building on campus.
27. Students cut a desire path across the marsh. Facilities calls it "a suggestion."
28. Study finds students walking under live oaks are 12% calmer. Study conducted under a live oak.
29. Red Stick Baptist trash-talks BSU. Loses by 40. Trash-talks again.
30. Greek Row party runs until dawn. Gator attends. Gator relocated. Party continues.
31. Chancellor raises tuition. Applications drop. Chancellor "reviewing feedback."
32. State budget shortfall: funding cut 25%. Legislature blames the swamp.
33. Nutria gnawed a 2-foot hole in the levee. Bounty doubled.
34. First cold front! Mosquito season officially over. Cicadas file for unemployment.
35. Homecoming court crowned. Roux ate the sash.
36. Stadium lights visible from the interstate. Truckers honk in support.
37. Night game against Gulf Coast State. Forecast: 70% chance of pandemonium.
38. Subsidence study: "The dorm is now technically a houseboat."
39. Retention pond stocked with bream. Mosquito larvae "devastated."
40. Boudin sold out at the Po'boy Shack by 10 a.m. Riot narrowly averted.
41. Coastal Institute publishes paper. Titled "Please Stop Filling the Marsh."
42. Gator in the Carillon fountain. Bells rang. Gator unbothered.
43. Commencement: 1,100 graduates toss caps. Three caps recovered from the bayou.
44. Category 4 hurricane "Beatrice" forming. Chancellor seen buying plywood.
45. Engineering students build a pirogue out of textbook covers. It floats better than the dorm.
46. Alumni Center opens. Donations up. Open bar suspected.
47. Rec Center climbing wall painted purple. Gold holds "for the elite."
48. The Boil sells out. Red Stick police: "Tailgates from here to the river."

**Festival descriptions:** *Zydeco Fest* (Sep 20): accordion and rubboard at the Bandstand, dancing agents, +3 happiness. *Homecoming*: parade of floats along roads, bonfire on the Quad, extra donations. *Halloween*: fog, gators wear beads, students in costumes (random hue shirts). *Levee Bonfires* (Dec 24): bonfire sprites on each levee run, +happiness proportional to levee length: your flood defense doubles as your best party. *Mardi Gras* (Feb 24): purple-green-gold bead particles on every road, krewe floats, classes cancelled, king cake event. *Crawfish Boil* (Apr 15): every crawfish pond hosts a boil; tables, steam, agents eating; revenue paid. *Commencement* (May 10): caps thrown on the Quad, alumni count ticks up, donations begin.

---

## 15. Technical Feasibility Notes

**One HTML file.** A build script concatenates `src/*.js` in dependency order into a `<script>` in `index.html`; CSS inline in `<style>`. No modules at runtime; each file wraps its exports in a namespace object (`BSU.hydro`, `BSU.render`, …) defined against a shared `contract.js` that declares typed-array layouts, enums, and event names. Target size ≤ 600 KB uncompressed.

**Performance budget (60 fps target, 30 floor, 2019 MacBook Air class):**
- Map 72×72 = 5,184 tiles; visible at zoom 1 ≈ 900 tiles; render only the visible diamond plus a 2-tile margin. Terrain is pre-rendered into 8 chunk canvases (18×18 tiles each) that are invalidated only when a chunk's tiles change; per-frame draw is chunks + dynamic sprites.
- Dynamic sprites per frame ≤ 320 agents + 40 gators + 30 nutria/birds + ≤ 120 building animations + ≤ 2,000 particles. All `drawImage` from a cached atlas; no per-frame path drawing except overlays.
- Hydrology: 5,184 tiles × ~10 ops per game hour × 8 hours/s at 1× (32/s at 4×) → < 2 ms/s. Mosquito grid daily. Agent pathfinding: BFS on a path-graph of ≤ 1,500 nodes, cached by (origin, destination), invalidated on path edits; ≤ 20 path requests per tick.
- Save: gzip-free JSON of tile arrays (Base64 of typed arrays) + entity lists ≈ 200 KB; autosave every game month and on tab hide; three slots in `localStorage` (key `bsu.save.N`), settings in `bsu.settings`.

**Module decomposition (13 modules, each buildable against `contract.js`):**
1. `core.js` — RNG (mulberry32), value noise, math, event bus, typed-array helpers.
2. `contract.js` — enums (tile types, building ids, overlays), constants (all numbers in this GDD), catalog table, event names, save schema version.
3. `terrain.js` — generation, elevation, tile type derivation, chunk invalidation.
4. `hydro.js` — standing water, flow, canals/levees/pumps, surge BFS, water table, subsidence.
5. `buildings.js` — placement validation, footprints, coverage (power/water), upgrades, damage/repair, demolish.
6. `economy.js` — monthly statement, tuition/enrollment/retention, prestige, happiness, ecology, debt/failure states.
7. `agents.js` — students, schedule state machine, pathfinding cache, flee/splash behaviors.
8. `wildlife.js` — gators, nutria, birds, mosquito grid, relocation, illness events.
9. `weather.js` — seasons, temperature/heat, rain scheduling, hurricane spawn/forecast/landfall/outage.
10. `sports.js` — calendar, ratings, win prob, attendance, revenue, tailgate/game-day scene triggers.
11. `render.js` — isometric projection, sprite atlas generation (`sprites.js` may split out: all `drawX` functions), chunk rendering, day/night, weather FX, particles, juice.
12. `ui.js` — HUD, palette, inspect, budget/team/calendar panels, overlays, minimap, tooltips, input/camera.
13. `game.js` — main loop, fixed-step scheduler, calendar, objectives/tutorial, milestones, news/flavor tables, save/load, audio (`audio.js` splits out if a separate agent takes it).

**Cut order if scope must shrink:** (1) touch support; (2) audio beyond ambience + UI blips; (3) nutria and birds (keep the ticker lines); (4) subsidence overlay and levee armor (keep subsidence itself); (5) Coastal Institute, Alumni Center, Admin Hall, Café Beignet, Azaleas; (6) spring intake (fall only); (7) night games and homecoming budget; (8) reduce agents to 160; (9) zoom to 2 steps; (10) fog and heat haze. Never cut: hydrology + surge, hurricane set piece, gators, mosquitoes, enrollment/prestige/happiness loop, stadium + game day, tutorial chain, autosave.

---

## 16. Scope Risks and the Three Demo-Killers

**Risk 1 — "Nothing pushes back" (a sandbox with no antagonist).** Demos let you place buildings and watch numbers rise. The design answer is that the swamp is a scheduled, escalating opponent: rain is frequent and seasonal, the year-1 hurricane is *guaranteed* within the first 20 minutes, mosquitoes and gators are continuous low-grade pressure, and subsidence is a slow fuse that makes early cheap choices come due. Every pressure has a legible counter in the Swamp tab and a visible readout (overlays), so pushback creates decisions instead of frustration.

**Risk 2 — "Numbers without meaning" (opaque stats, no feedback).** If prestige is a bar that goes up, it's a demo. Here every top-bar stat has a click-to-breakdown listing its terms, tooltips speak the formulas in words, radius effects are sampled from where students actually walk (so the map, not a spreadsheet, is the source of truth), and each loop has a brake (capacity, wastewater, overcrowd, salaries scaling with N) so the "right" move changes over time. The applicant/tuition curve and the drain-vs-sink loop are the two systems most likely to make a player say "oh, *that's* why."

**Risk 3 — "Static world" (nothing happens unless you click).** Agents with schedules, gators wandering, weather cycling, day/night, festivals on a calendar, a football season resolving on Saturdays, a ticker every 30–60 seconds, and 8 auto-camera set pieces (first walk, first rain, first gator, forecast cone, landfall, first home game, Mardi Gras, commencement) guarantee the screen changes even at pause-and-watch pace. The rule for the engineering team: no game-minute may pass without something animated on screen, and no 3 game-days without a ticker line.

**Other scope risks and mitigations:** sprite volume (~200 procedural sprites) → shared `drawBox/drawRoof/drawWindows` helpers and 3-variant recoloring; pathfinding cost → cached BFS on a small path graph, agents teleport if a path is > 200 nodes; hurricane surge BFS on a 5k grid → runs once per landfall hour, trivial; localStorage size → typed arrays Base64, under 1 MB per slot; Safari `file://` audio → gesture-gated context, muted default; balance drift → all constants in `contract.js` with a debug panel (`~` key) exposing sliders and a "skip to Sep 10 / add $1M / spawn Cat 3" cheat set so testers can reach every set piece in under a minute.
