# BAYOU STATE — Geaux Build
### Game Design Document, "Player Journey" candidate

*Lens for this candidate: onboarding, pacing, progression. Every system below is complete, but every decision was made by asking "what does the player feel at minute 1, minute 5, minute 15, minute 40?"*

---

## 1. Title, Tagline, Pitch, Screenshot Moment

**Title:** **BAYOU STATE** — *Geaux Build*

**Tagline:** *Build a university. Outlast the swamp. Laissez les bons temps rouler.*

**Pitch:** You are the founding chancellor of Bayou State University, chartered on a single dry hummock in the middle of a Louisiana cypress swamp. Drain marsh, pour pilings, raise levees, and lay boardwalks to carve out a campus. Recruit students who arrive by pirogue, keep them dry, fed, and un-eaten, and turn tuition and tailgate money into lecture halls, labs, a Death-Valley-sized stadium, and a national reputation. Every August the hurricane season forecast cone appears on your minimap and the whole campus holds its breath. Every February the campus throws Mardi Gras. Every fall Saturday night, 100,000 people in purple and gold scream so loud the gators leave. It is SimCity with a water table, and the water table wants your library.

**The screenshot moment:** It is 8:47 PM on a night-game Saturday in November. The isometric campus glows purple under stadium lights; the stadium itself pulses gold with a wave animation running around the stands and a fireworks burst frozen mid-bloom. To the west, the bayou is black glass reflecting the lights, dotted with the lantern glow of tailgate pirogues. Live oaks drip Spanish moss over a boardwalk full of tiny students in purple jerseys. In the top-right corner, the minimap shows a hurricane forecast cone creeping toward campus from the Gulf, and the news ticker reads *"BSU 34, Crimson Delta 31 — FINAL. Also: Tropical Storm Beignet upgraded to Category 2."* And in the corner of the frame, one gator is sitting on the 50-yard line. That's the shot.

---

## 2. Core Loop and Meta Loop

### Minute-to-minute core loop (60–120 seconds per cycle)

1. **Notice a pressure.** A notification, a ticker line, a flood overlay flash, a student thought bubble, or an objective card: *"Dorm A is flooding," "Applicants exceed capacity by 140," "Gator spotted near Dining Hall."*
2. **Inspect.** Click the thing. Inspect panel shows the cause (tile water depth 0.8 ft, drainage none) and the counterplay (build a drainage canal or pump; raise on pilings).
3. **Build or adjust.** Open the palette (or press a hotkey), drag a road/canal/levee, or place a building. Cost deducts, sprite pops in with a dust puff, students reroute.
4. **Watch it work.** Water drains visibly (tile color shifts wet→dry over 3–5 seconds), students walk into the new building, a "+12 happiness" floater, a ticker line.
5. **Get paid or punished.** The semester tick (every 6 minutes at 1x) pays tuition, reports enrollment, and hands out a report card. The game then hands you the *next* pressure.

The loop is designed so that **every 45–90 seconds something visible changes without the player doing anything** (rain starts, a gator wanders in, a student cluster forms for a crawfish boil, the sky turns gold at dusk). The player is never staring at a static screen wondering what to do.

### Meta loop (semester-to-semester, year-to-year)

- **Semester (6 min at 1x):** Enrollment resolves (applicants vs. capacity), tuition lands, happiness/prestige reported, one "Board of Regents" decision card (choose 1 of 3 policies: raise tuition / raise state lobbying / launch a research push, etc.).
- **Fall (Aug–Dec):** Hurricane season Aug 1–Nov 30. Football season Sep–Nov. Tailgate revenue. Homecoming week. Maximum risk, maximum money.
- **Spring (Jan–May):** Mardi Gras (Feb), crawfish season (Mar–May), graduation (May). Recovery, rebuilding, prestige harvest. Mosquito ramp-up in April.
- **Summer (Jun–Jul):** Enrollment dips, heat index peaks, subsidence tick, construction discount ("summer build season" –15% costs). Time to invest.
- **Year:** Prestige tier re-evaluated; new building tier unlocks; rival school rankings update; a named hurricane season with 1–3 storms; a new achievement wave.

The meta loop escalates: Year 1 is one Cat 1 storm and a handful of gators. Year 4 can be a Cat 4 with 8-foot surge into a 12,000-student campus with a pump grid that needs power. The player *grows into* the threat.

---

## 3. World and Terrain

### Map

- **64 × 64 tiles** = 4,096 tiles. Isometric diamond tiles, 64 px wide × 32 px tall on screen, elevation step 6 px per level.
- Player-buildable interior is roughly 56 × 56; the outer 4-tile ring is always deep water/bayou (the world's edge, where pirogues arrive and gators live).
- The **Mississippi-style river** runs along the *east* edge (3–4 tiles wide, "Big Muddy"), with a bayou channel snaking from it through the map in a lazy S. The Gulf is off-screen to the south; storm surge enters from the south and east.

### Tile types (stored per tile as `type`, `elev` (float, feet, 0–12), `water` (float, feet of standing water), `moisture`, `drained` (bool), `piling` (bool))

| Type | Elev range | Buildable? | Notes |
|---|---|---|---|
| **Open Water** (`WATER`) | 0.0 | No (except boardwalk/pier/pump intake) | Permanent. Gator home. Reflects sky. |
| **Bayou Channel** (`BAYOU`) | 0.0–0.5 | No (boardwalk, dock, pier only) | Flowing; drains adjacent tiles fast. Pirogue route. |
| **Marsh** (`MARSH`) | 0.5–2.0 | Only with **pilings** or after **draining** | Cattails, cypress knees. Highest ecology value. Mosquito nursery. |
| **Wet Ground** (`WET`) | 2.0–3.5 | Yes, but floods at 1.0 ft rain; subsides | Dark mud, sparse grass. Needs drainage to be safe. |
| **Dry Ground** (`DRY`) | 3.5–6.0 | Yes | Grass, safe in normal rain. Floods only in surge. |
| **High Ground** (`RIDGE`) | 6.0–12.0 | Yes | Natural levee / chenier. Rare (≈4% of map). Best real estate. |
| **Road/Path/Boardwalk** | inherits | overlay | Player-built. |

Type is *derived* from elevation and drained state each time hydrology settles, so draining a marsh tile (pumping its baseline water out and raising `drained`) converts it to Wet Ground; leaving it un-pumped for 2 years lets it revert.

### Elevation model

- `elev` in feet, 0–12, float.
- Terrain generation: 3-octave value noise (seeded, deterministic from a 32-bit seed shown on the title screen) + a **central hummock bias** (Gaussian bump centered at tile (32,30), radius 6, +5 ft) so the start is always a dry island. A **river trench** along east edge (set elev 0), a **bayou spline** (Catmull-Rom through 5 random control points from south edge to river, carve elev 0 in a 2-tile radius, 1.0 ft in a 3-tile ring = marsh banks).
- After noise, quantize into bands with the table above; run 2 passes of cellular smoothing so marsh forms blobs, not speckle.
- Guarantee: at least 40 contiguous DRY/RIDGE tiles around the spawn hummock; at least 300 MARSH tiles; at least one RIDGE cluster of ≥12 tiles within 15 tiles of spawn (the player's first "oh, I should expand *there*").
- Decorations placed at gen: live oaks on DRY/RIDGE (density 6%), bald cypress on MARSH/BAYOU banks (12%), cypress knees on MARSH (20%), cattails on MARSH (30%), palmettos on WET (8%). Decorations are free to bulldoze (cost: ecology).

### What terrain means for building

- **Water/Bayou:** Only boardwalks, docks, piers, pump intakes, and the "Pirogue Landing." 
- **Marsh:** Two paths. (a) **Pilings** (a per-tile upgrade, $4k/tile) let any building sit above the water — never floods below 3 ft of water, immune to subsidence, but costs upkeep. (b) **Drain it**: a canal or pump within 4 tiles with capacity converts it to Wet Ground over 3 days. Cheaper long-term, but ecology −, subsidence +, and it can re-flood.
- **Wet Ground:** Buildable immediately. But any rain event > 1.0 in/day puts 0.5+ ft of standing water on it unless drained. Player learns this the hard way in minute 4 (deliberately).
- **Dry Ground:** Safe except in storm surge ≥ 3 ft or catastrophic rain.
- **High Ground:** Safe except Cat 4–5 surge. Also gets +5% prestige for buildings placed there ("the Quad on the Ridge").
- **Slope:** Buildings need all footprint tiles within 1.0 ft of each other, else auto-grade cost of $2k per tile of difference.
- **Roads** can cross any land; **boardwalks** cross marsh and water (cheaper than pilings, only 1 tile wide, walking only, no vehicle access — service buildings need road access).

---

## 4. Building Catalog

All costs in dollars. Upkeep per **semester**. Footprint in tiles (W×H). "Unlock" refers to §10 progression. Visual line is what the procedural sprite artist draws.

### Circulation

| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 1 | **Gravel Path** | 1×1 (drag) | $300 | $10 | Walkable; students 1.4× speed on paths. Required adjacent to every building. | Start | Tan-gray dashed diamond with darker edge. |
| 2 | **Paved Road** | 1×1 (drag) | $900 | $30 | Walkable, vehicle access (needed by dining/athletics/emergency). Auto-connects. | Start | Dark asphalt gray, gold center dash on straights. |
| 3 | **Boardwalk** | 1×1 (drag) | $1,200 | $40 | Walkable over MARSH/WATER/BAYOU. Elevated: never floods under 3 ft. | Objective 5 | Brown plank slats with lighter posts at corners. |
| 4 | **Oak Allée** | 1×1 (drag) | $2,500 | $60 | Path + two live oaks. +Shade, +3 prestige per 8 tiles, +happiness. | Prestige 15 | Path with bracketing dark-green oak canopies, moss strands. |
| 5 | **Pirogue Landing** | 2×1 (on BAYOU edge) | $6,000 | $150 | Student arrival point (2nd+ landing: +5% applicants each). Boat visuals. | Start (one free) | Wooden dock, 2 tied pirogues, lantern. |

### Utilities

| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 6 | **Power Substation** | 2×2 | $40,000 | $2,000 | Powers 60 buildings within 14 tiles. Buildings without power run at 50%. Floods at 1 ft water → outage. | Start | Gray box, gold transformer coils, chain-link. |
| 7 | **Water Tower** | 1×1 (tall) | $30,000 | $1,200 | Water for 40 buildings in 16 tiles. | Start | Purple tank on 4 legs with "BSU" in gold. |
| 8 | **Wastewater Plant** | 3×3 | $120,000 | $5,000 | Removes Water Quality penalty; required above 2,000 students. Ecology +5. | 1,000 students | Round concrete tanks, green water, pipes. |
| 9 | **Campus Bus Depot** | 3×2 | $80,000 | $3,000 | Students within 20 tiles reach any building "instantly" (abstracted). Reduces "too far" complaints. | 3,000 students | Purple buses under a gold canopy. |

### Academic

| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 10 | **Founder's Hall** | 3×3 | Free (placed in Objective 1) | $0 | Administration. Capacity 300 students. +5 prestige. Cannot be destroyed (repair only). | Start | White columns, purple roof, gold cupola, live oak on each side. |
| 11 | **Lecture Hall** | 2×2 | $60,000 | $2,500 | +250 class capacity. Prestige +1. | Start | Tan brick, purple awning, big windows. |
| 12 | **Classroom Building** | 3×2 | $150,000 | $6,000 | +700 class capacity. Prestige +2. | 500 students | Long tan building with purple roofline, "Roux Hall" style sign. |
| 13 | **Library** | 3×3 | $260,000 | $8,000 | Study coverage radius 18: −stress. Prestige +6. Required for Accreditation. | 800 students | Big white-stone block, gold dome, clock face. |
| 14 | **Science Lab** | 2×2 | $220,000 | $9,000 | Research +$18k/semester × prestige mult. Prestige +4. | Library | Glass-and-steel, green roof, exhaust stacks, glow at night. |
| 15 | **Coastal Research Station** | 2×2 (on MARSH, pilings included) | $180,000 | $7,000 | Research +$15k; **Ecology +8**; reveals hurricane forecast 2 days earlier; mosquito −15% in 12 tiles. | Prestige 25 | Raised green shed on stilts, radar dish, airboat docked. |
| 16 | **Engineering Quad** | 4×3 | $500,000 | $18,000 | +1,200 capacity, research +$30k, unlocks Pump Station II tier, prestige +8. | 4,000 students | Three joined brick buildings around a gold-fountain courtyard. |
| 17 | **Medical School** | 4×4 | $1,200,000 | $40,000 | +800 capacity, research +$60k, campus sickness −50%, prestige +15. | 8,000 students & Accredited | White tower with red cross in gold circle, helipad. |

### Housing

| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 18 | **Dorm** | 2×2 | $90,000 | $3,500 | Houses 200. Floods at 1 ft: residents evacuate, −happiness. | Start | Boxy tan 3-story, purple doors, gold window lights at night. |
| 19 | **Residence Tower** | 2×2 (tall) | $320,000 | $10,000 | Houses 800. | 2,000 students | 9-story purple-gray tower, gold roof trim. |
| 20 | **Greek Row House** | 2×1 | $70,000 | $2,000 | Houses 60. +Happiness 4 in radius 10, +party events, +tailgate revenue 5%. Max 8. | 1,500 students | White antebellum-style house, columns, Greek letters in gold. |
| 21 | **Stilt Cottages** | 2×2 (MARSH ok) | $110,000 | $3,000 | Houses 120 on pilings. **Never floods below 4 ft.** Ecology neutral. | Objective 7 | Four small pastel cottages on tall stilts with tin roofs. |

### Dining and Student Life

| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 22 | **Dining Hall** | 2×2 | $80,000 | $4,000 | Feeds 900 within radius 16. Attracts gators if adjacent to water (+trash). | Start | Wide low building, big windows, smoke from a boil pot out back. |
| 23 | **Gumbo Shack** | 1×1 | $18,000 | $800 | Feeds 150, +2 happiness radius 8. Cheap and charming. | Start | Tiny red-tin-roof shack, hand-painted "GUMBO" sign, picnic table. |
| 24 | **Student Union** | 3×3 | $300,000 | $9,000 | +8 happiness radius 20; hosts festivals (Mardi Gras ball, crawfish boil become visible events here). Prestige +5. | 1,000 students | Wide modern building, purple glass front, gold tiger silhouette. |
| 25 | **Rec Center** | 3×2 | $200,000 | $7,000 | −stress radius 16; heat relief (pool). | 1,500 students | Blue-glass natatorium roof, gold "REC" lettering. |
| 26 | **Health Center** | 2×2 | $120,000 | $5,000 | Sickness −60% radius 20 (mosquito counterplay). | 800 students | White with a red-cross awning, ambulance bay. |
| 27 | **Zydeco Pavilion** | 2×2 | $60,000 | $1,500 | Open-air stage: +4 happiness radius 14; concerts on festival days; +$5k per festival. | Prestige 10 | Open gazebo, tin roof, string lights, accordion icon on banner. |

### Athletics

| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 28 | **Practice Field** | 3×2 | $50,000 | $1,500 | Enables football program (Tier 0). Team rating +5. | 500 students | Green rectangle with white yard lines, blocking sled. |
| 29 | **Stadium** (tiers, upgraded in place) | 5×4 | T1 $400k / T2 $1.5M / T3 $4M / T4 $10M | $12k / $35k / $90k / $200k | Capacity 12k / 40k / 75k / 102k. Game-day revenue, prestige +5/+12/+25/+45. T4 = "**The Boil**": lights, night games. | Practice Field / 2k / 5k / 10k students | Concrete bowl, purple seats, gold end zones; T3+ adds upper deck and light towers; T4 adds ring of gold light and giant "BSU" on the press box. |
| 30 | **Tailgate Grounds** | 3×3 (adjacent to Stadium) | $60,000 | $1,000 | Game-day revenue +40%; visible tents, boil pots, cornhole. Max 4. | Stadium T1 | Grassy lot; on game day fills with purple/gold tents, RVs, smoke. |
| 31 | **Athletic Complex** | 3×3 | $350,000 | $14,000 | Team rating +15, coach tier unlock, prestige +6. | Stadium T2 | Sleek gray/purple, glass front, weight-room silhouettes. |
| 32 | **Baseball Diamond** | 3×3 | $150,000 | $4,000 | Spring happiness +3 radius 16, +$8k/semester spring revenue. | Stadium T1 | Dirt diamond, green outfield, small gold grandstand. |

### Swamp Infrastructure

| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 33 | **Drainage Canal** | 1×1 (drag) | $2,000 | $60 | Conductance 5× ground; moves water toward BAYOU/WATER. Must connect to a water tile or pump to work. | Objective 4 | Narrow blue-brown channel, riprap edges. |
| 34 | **Pump Station** | 1×1 | $35,000 (II: $90,000) | $2,000 (II: $5,000) | Removes 1.5 ft/day (II: 4 ft/day) of water from tiles within radius 6 (II: 10), discharging to nearest water tile. **Needs power**; floods at 2 ft → fails. | Objective 6 (II: Engineering Quad) | Green pump house, gold intake pipe, spinning impeller when active. |
| 35 | **Levee** | 1×1 (drag) | $5,000 | $100 | Raises tile edge +4 ft against flow; blocks surge up to 4 ft (Levee II: $12k, 8 ft). Nutria chew levees (§6). | Objective 8 | Grassy earthen ridge, darker crest line; II has concrete cap. |
| 36 | **Pilings** (tile upgrade) | 1×1 | $4,000 | $50 | Tile ignores standing water ≤3 ft and subsidence. Applies to any building placed after. | Objective 7 | Building sprite drawn 10 px higher with brown post stubs beneath. |
| 37 | **Gator Fence** | 1×1 (drag) | $800 | $20 | Blocks gator pathing. Students can pass at gates (auto every 6 tiles). | First gator sighting | Chain-link with purple posts; a tiny "GATOR XING" sign every 4 tiles. |
| 38 | **Wildlife Office ("Gator Wranglers")** | 2×1 | $45,000 | $2,500 | Wrangler agent relocates any gator within radius 20 in ~10 s. Also traps nutria in radius 12. | First gator sighting | Green shed, airboat trailer, gold star badge on door. |
| 39 | **Mosquito Abatement Station** | 1×1 | $25,000 | $1,800 | Fog truck reduces mosquito density −70% in radius 14 each evening. Ecology −2. | First mosquito warning | Small garage; a truck sprite drives the roads at dusk trailing white fog. |
| 40 | **Bat House / Purple Martin Tower** | 1×1 | $6,000 | $100 | Mosquito −30% radius 8. Ecology +2. Stackable. | First mosquito warning | Tall pole with a multi-gourd tower (martins) or a dark slab box (bats). |

### Landscaping and Landmarks

| # | Name | Footprint | Cost | Upkeep | Effects | Unlock | Visual |
|---|---|---|---|---|---|---|---|
| 41 | **Live Oak** | 1×1 | $3,000 | $0 | Shade (heat −), +1 happiness radius 4, +0.5 prestige. Ecology +1. Grows over 2 years (3 sprite sizes). | Start | Wide dark-green canopy, gnarled trunk, gray moss strands. |
| 42 | **Bald Cypress Grove** | 1×1 (MARSH/WET) | $2,000 | $0 | Ecology +2, absorbs 0.2 ft/day water on tile and neighbors, reduces subsidence. | Start | Tall conical tree, rust-orange in fall, knees at base. |
| 43 | **Azalea Beds** | 1×1 | $1,000 | $50 | +2 happiness radius 5 in spring (bloom March); prestige +0.3. | Start | Low rounded hedge, pink/purple blossoms Mar–Apr. |
| 44 | **Wetland Preserve** (zone paint) | any MARSH | $500/tile | $0 | Tile protected; ecology +3/tile; gators prefer it (draws them off campus); mosquitoes −20% on preserve tiles with cypress. | Ecology objective | Boundary of small gold markers; cattails denser; egret sprites. |
| 45 | **Memorial Bell Tower** | 2×2 (tall) | $400,000 | $3,000 | Prestige +12. Rings on the hour (audio), at kickoff, and after hurricanes pass. | Prestige 30 | Slim white tower, gold bell, purple flag. |
| 46 | **Tiger Habitat** | 3×3 | $600,000 | $15,000 | Home of **Roux**, the live tiger mascot. Prestige +20, happiness +6 radius 25, game-day revenue +10%. Gators avoid radius 10. | Stadium T3 | Rock enclosure, waterfall, a striped orange sprite that paces and yawns. |
| 47 | **Grand Fountain & Quad** | 3×3 | $250,000 | $4,000 | Prestige +8, happiness +5 radius 16. Students gather here on festival days. | Prestige 20 | Gold-lit fountain in a brick circle, four oaks at corners. |

*(47 entries; the tiered Stadium counts as one.)*

---

## 5. Economy

### Starting state
- **Treasury:** $1,500,000.
- **Students:** 0 (120 arrive after Objective 3).
- **Tuition:** $6,000/semester (slider 2,000–20,000).
- **Prestige:** 10 (0–100 scale).
- **Happiness:** 60 (0–100).
- **Ecology:** 70 (0–100; map starts pristine minus the hummock).
- **State Funding:** $500/student/year baseline.
- **Debt:** 0. Credit line available up to −$500k at 8%/year (see failure states).

### Money sources (per semester unless noted)

| Source | Formula |
|---|---|
| **Tuition** | `students × tuition` |
| **State Funding** | `students × 500 × (0.5 + prestige/100)` — paid per semester as half-year |
| **Donations** | `alumni × 40 × (happiness/100) × (1 + wins_last_season/12)`; `alumni` accumulates +graduates each May (students/8 per year) |
| **Research** | sum of lab research values × `(0.6 + prestige/100)` |
| **Athletics** | per home game: `attendance × ticket_price` where `attendance = min(capacity, fanbase)`, `fanbase = students×2.5 + alumni×0.6 + prestige×300`, `ticket_price = $35`; + Tailgate Grounds +40% each (max +160%); + Tiger Habitat +10%; + rivalry game ×1.5; + night game ×1.2. Away games: $0. Bowl game: flat $2M if ≥9 wins. |
| **Parking Tickets** | `$4 × students` per semester, +$40k on each home game ("Campus Police issued 1,140 citations"). Purely flavor-positive. |
| **Festival Revenue** | Mardi Gras ball $10k + $2/student; Crawfish Boil $5k; Homecoming $30k; each ×1.5 with Student Union, +$5k with Zydeco Pavilion. |
| **Insurance** (optional policy card) | pays 50% of hurricane repair costs; costs 2% of total building value per year. |

### Costs

| Cost | Formula |
|---|---|
| **Construction** | catalog cost; −15% in summer; +20% on MARSH (piling surcharge if not pre-piled); auto-grading $2k/tile |
| **Upkeep** | sum of catalog upkeep per semester |
| **Salaries** | `$1,800 × students` per semester (faculty & staff scale) — the big one |
| **Utilities** | `$300 × buildings` + `$50 × students` in summer (AC), `$25` otherwise |
| **Disaster repair** | damaged building: `cost × damage% × 0.5`; auto-repairs over 10 days if funds available, else stays damaged (runs at 0%) |
| **Debt interest** | 8%/year on negative balance, charged monthly |

### Enrollment model

Resolved at the start of each semester (Aug 15, Jan 10; summer session = 35% of students stay).

```
capacity        = min(housing_capacity, class_capacity + 200) // commuters allow slight overage
demand_index    = (prestige × 1.2 + happiness × 0.8) / 100      // ~0.9–1.5 typical
price_factor    = clamp(1.6 − tuition / 10000, 0.3, 1.5)          // $6k → 1.0; $10k → 0.6; $2k → 1.4
applicants      = round(60 + prestige × 40 × demand_index × price_factor + alumni × 0.2)
retention       = clamp(0.75 + happiness/400 − flood_days_last_sem × 0.01, 0.5, 0.98)
returning       = floor(students × retention)          // minus May graduates
new_students    = min(applicants, capacity − returning)
students        = returning + new_students
```

Year-1 example: prestige 10, happiness 60, tuition 6k → applicants ≈ 60 + 10×40×0.6×1.0 = 300. If housing is 2 dorms (400) and Founder's Hall + 1 Lecture Hall (550 class), capacity = 400 → 300 students. The player immediately sees "Applicants 300 / Capacity 400" and the hook is set: **more prestige → more applicants → need more buildings → need more money → raise tuition? (applicants drop)**. The tension is legible on the HUD from minute 3.

### Prestige model (0–100, evaluated monthly, moves at most ±3/month toward its target)

```
target_prestige = 5
  + Σ building_prestige                       // catalog values
  + min(20, research_income / 10000)
  + min(15, wins_last_season × 1.5)
  + (accredited ? 10 : 0)
  + min(10, ecology / 10)                     // ecology matters!
  + min(10, (happiness − 50) / 5)
  − 15 × (uninsured_damaged_buildings / max(1, buildings))
  − 5 per lost accreditation year
  − 10 if students > class_capacity × 1.3    // overcrowding
```

### Happiness model (0–100, evaluated daily, moves ±2/day toward target)

```
target_happiness = 50
  + coverage(dining) × 10  + coverage(housing) × 10    // coverage = fraction of students served, 0–1
  + coverage(study) × 6    + coverage(rec) × 5
  + Σ radius effects (Gumbo Shack, Union, Greek, oaks, fountain…) averaged over student positions, cap +20
  − flooded_fraction × 40                              // fraction of students whose dorm/class is flooded
  − mosquito_index × 15   − heat_index_excess × 10
  − gator_incidents_this_week × 3
  − (tuition − 6000) / 800                             // $14k tuition = −10
  + festival_active ? +8 : 0
  + won_last_game ? +5 : (lost ? −2 : 0)
```

### Key feedback loops (each is surfaced in a tooltip on the HUD stat)

1. **Prestige → Applicants → Tuition → Buildings → Prestige.** The growth engine. Bottlenecked by housing/class capacity so the player always has a next build.
2. **Salaries scale with students** — growth is not free; a 5,000-student campus costs $9M/semester in salaries; tuition at $6k only nets $30M... so the numbers work but *feel* tight after the first big expansion. The Board card "Raise tuition +$1,000" tempts every semester.
3. **Happiness → Retention & Donations.** Neglecting the swamp threats (flood days, mosquitoes, gators) silently erodes retention. The report card makes it loud.
4. **Ecology → Prestige & Threat.** Bulldoze all the marsh: +buildable land now, −10 prestige cap, more subsidence, more gators wandering (nowhere else to go), fewer cypress absorbing water. Preserve it: fewer tiles, but calmer swamp and research money. Both are viable — the sandbox is about where you land.
5. **Athletics → Money & Happiness → Prestige**, but the stadium is a huge upkeep sink if you don't fill it. The stadium tiers are the clearest "am I ready?" gate in the game.

---

## 6. Swamp Survival Systems

Every system here has three parts: **the rule, the tell (how the player sees it coming), the counterplay**. This is the DEEP pillar and it is what makes this not a reskin.

### 6.1 Hydrology

**State per tile:** `elev`, `water` (standing water depth, ft), `baseWater` (0 for DRY/RIDGE, 0.3 WET, 1.0 MARSH, ∞ WATER/BAYOU — the level the tile wants to return to), `conductance` (ground 1.0, canal 5.0, road 0.8, boardwalk/piling n/a).

**Simulation:** runs every **sim tick (250 ms)** on a 64×64 float array — 4,096 cells, trivially cheap.

```
rain_today (ft)      = weather.rain × 0.083          // inches → ft; typical Louisiana storm 1–3 in
each tick:
  water[t] += rain_today / ticks_per_day
  for each tile t, for each of 4 neighbors n:
     head = (elev[t] + water[t]) − (elev[n] + water[n])
     if head > 0 and !levee_blocks(t→n):
        flow = min(water[t], head × 0.25 × cond[t] × cond[n]) / ticks_per_day × 12
        water[t] −= flow; water[n] += flow
  WATER/BAYOU tiles: water[t] = bayouLevel   // infinite sink/source (bayouLevel rises in surge)
  evaporation: water[t] −= 0.02/day (0.04 in summer)
  absorption: −0.1/day per adjacent cypress; DRY ground absorbs 0.15/day to baseWater
  pumps: for tiles in radius, water[t] −= rate/ticks_per_day, capped at baseWater (or 0 if drained)
  drained flag: MARSH tile with water ≤ 0.2 for 3 consecutive days → drained=true, becomes WET
                WET tile (drained) with water ≥ 1.0 for 30 days and no pump in range → reverts to MARSH
```

**Flood thresholds (per building, using max water across its footprint, minus 3.0 ft if on pilings, minus 0 for boardwalk):**
- ≥ 0.5 ft: "**Wet**" — paths slow students to 0.5×, students splash (fun animation), mosquito spawn ×2.
- ≥ 1.0 ft: "**Flooded**" — building offline (0% output), residents evacuate to nearest dry dorm or the Union, happiness −, utilities offline.
- ≥ 2.0 ft: damage 5%/day. 
- ≥ 4.0 ft (surge only): damage 25%/day; any building at 100% damage becomes a "Ruin" sprite that must be rebuilt at 60% cost.

**Tells:** the **Flood Risk overlay** (key `F`) paints each tile blue-by-depth *and* shows "projected depth after 2 in. of rain" as a hatched outline; the weather widget shows tomorrow's rain; wet tiles darken visibly; a first-time "Your Dorm is Wet" notification links to the counterplay list.

**Counterplay:** canals (cheap, need a route to water), pumps (radius, need power — and a flooded substation kills the pumps: the classic cascading failure, deliberately allowed once and then telegraphed), levees (block, but water that gets *inside* a levee ring can't get out without a pump — the New Orleans lesson, taught by the tutorial in Objective 8), pilings (per-tile immunity), cypress (slow natural absorption), building on RIDGE.

### 6.2 Hurricane Season

**Window:** Aug 1 – Nov 30 each year. Storm count per season: Year 1 exactly one (scripted, see §10); Year 2+: `1 + floor(random × 2)` (1–2 storms), Year 4+: 1–3. Each storm has a category rolled `1 + floor(random² × 5)` (skewed low) with a floor of Cat 2 from Year 3.

**Storm names** (fictional, alphabetical, Louisiana-flavored): Adele, Beignet, Clotilde, Delphine, Étienne, Fifi, Gaston, Hyacinth, Isidore, Josephine, Kermit, Lafitte, Marguerite, Noel, Odile, Pierre, Remy, Sabine, Thibodeaux, Ulysse, Vivienne, Willa.

**Timeline of a storm (all at 1× speed):**
1. **T−5 days (Coastal Research Station: T−7):** "Tropical Storm *Beignet* forms in the Gulf." Minimap draws a **forecast cone** from the south edge; the cone's centerline drifts randomly ±2 tiles/day; the cone width narrows each day. A ticker line and a "Storm Prep" objective card appears (checklist: pumps powered, students sheltered, levees intact).
2. **T−3 days:** Category announced. Sky tints greenish-gray. Wind particle streaks begin. Students walk faster and cluster indoors. Gators head *into* the deep water (they know).
3. **T−1 day:** Evacuation option: "Cancel classes & evacuate ($50k, −3 happiness, zero student casualties/sickness)" vs. "Shelter in place (free, Union & Rec Center shelter 2,000 each; students beyond that get +sickness)." Bell tower rings. Music drops to low drone.
4. **Landfall (lasts 1.5 game days = ~5 min at 1× — the game auto-drops to 1× and locks speed to ≤2×):**
   - **Rain:** 4 / 6 / 9 / 12 / 15 in over the event by category.
   - **Storm surge:** `bayouLevel += 1.5 / 3 / 5 / 8 / 11 ft` ramping up over 6 hours, holding 8 hours, then draining over 1 day. Surge enters from the south and east (river/bayou tiles), so levees on that side matter most.
   - **Wind damage:** each hour, each building rolls `damage_chance = cat × 0.03 × (1 − shelter_factor)`; hit = 5–20% damage. Live oaks reduce wind damage by 30% for buildings within 2 tiles ("windbreak"). Stadium light towers and the water tower are 2× vulnerable (visual: tower sways, then a spark burst).
   - **Power:** substations in ≥1 ft water go dark → their radius loses power → pumps stop → more water. The cascade is visible as lights blinking out across the map.
   - **Visuals:** screen shake on gusts (amplitude by category), horizontal rain, lightning flashes with 200 ms white frame, debris sprites (tin roof panels, a lawn chair, a pirogue) tumbling across, trees bending (sprite skew), the sky at 40% brightness.
5. **Aftermath (10 days):** "Recovery mode" HUD banner. Damaged buildings show blue tarps; repair auto-runs if funded. A recovery objective card: *"Restore power to 100% / Pump out the Quad / Reopen dorms."* FEMA-style **"State Disaster Grant"** card offers $ = 30% of damage if ecology ≥ 50 ("wetland buffer credit") or 15% otherwise. Happiness recovers +2/day once flooding clears. First time: achievement **"Weathered."**

**Counterplay summary:** levees on the south/east, substations on RIDGE or pilings, Pump Station II, the Coastal Research Station for early warning, oaks as windbreaks, evacuation, insurance policy, and just not building your dorms on the bayou bank. **No storm can destroy Founder's Hall or reduce students to zero** — recovery is always possible.

### 6.3 Gators

- **Spawn:** each WATER/BAYOU tile with ≥2 adjacent MARSH tiles is a potential den; the map keeps `gatorPop = 4 + floor(marsh_tiles/60)` (typ. 8–12) abstract gators; up to **6 visible** at once. A visible gator spawns from a den every 3–6 days on average (×2 in April–June mating season, ×0.3 in Dec–Feb, ×0 during the 3 storm days).
- **Behavior (finite state):** `BASK` (on a bank or, hilariously, on a road/field — 30–90 s) → `WANDER` (random walk along wet/marsh/water tiles, 0.4 tiles/s; will cross land if a Dining Hall or trash pile is within 8 tiles; attracted to Wet tiles after floods — flood days = gators on campus) → `LUNGE` (if a student comes within 1.5 tiles: 0.5 s lunge; the student flees with a "!" and gets `scared` +50 for 2 days; no deaths, ever — the campus paper reports "Sophomore outruns gator, cites cardio") → `RETREAT` (after 3–5 min on land, or when a Wrangler arrives, walks/gets carried back to water).
- **Effects:** each gator on campus tile within 6 tiles of students: happiness target −3; blocks path tiles it occupies (students route around, causing visible detours); on the football field on game day: "**Gator Delay**" — kickoff delayed, +1 happiness for the comedy, ticker line.
- **Tells:** ripple V-wake in water when approaching; a ticker "Gator spotted near Dorm B"; the **Wildlife overlay** (`W`) shows dens and gator heat-map.
- **Counterplay:** Gator Fence (pathing block), Wildlife Office (Wranglers), keep Dining Halls ≥3 tiles from water, Wetland Preserve (gators prefer to stay there — preserves within 10 tiles of a den absorb 80% of its wanders), Tiger Habitat (gators avoid Roux). Draining *all* marsh does *not* remove gators — the dens are on water tiles — it just removes their alternatives, so they wander onto campus more. This is the designed "preserve ecology or suffer" lesson.

### 6.4 Mosquitoes

- **Per-tile density `mosq` (0–1):** grows `+0.15/day` on tiles with `water > 0` that has been standing ≥2 days *and* `temperature ≥ 70°F`; `+0.05/day` on MARSH baseline; decays `−0.1/day` when dry or cold; diffuses 20% to neighbors nightly. Peaks Apr–Oct. 
- **`mosquito_index`** = mean `mosq` over tiles with students. 
- **Effects:** happiness `−15 × index`; **sickness**: daily `students × index × 0.02` fall sick (abstract counter; sick students don't attend class → class capacity effective −, tuition unaffected, retention −0.005 per 1% sick). Visible: gray dot-cloud particles over dense tiles at dusk; students slap at themselves (2-frame animation) when walking through `mosq > 0.4`.
- **Tells:** **Mosquito overlay** (`M`), evening ticker "Mosquito index: HIGH", a first-time notification pointing at standing water.
- **Counterplay:** drain standing water (fixes cause), Abatement Station (fog truck drives the roads at dusk, −70% radius 14, ecology −2 per station), Bat House / Martin Tower (−30% radius 8, stackable, ecology +2), Health Center (treats effects), Coastal Research Station (−15%), cypress on preserves (−20%). The design intent: the cheap ecological options handle *most* of it; the fog truck is the "I'm rich and lazy" option with a prestige-limiting ecology cost.

### 6.5 Subsidence

- Any **drained** former-MARSH tile (and WET tiles within radius of an active pump) sinks **−0.15 ft/year**, applied monthly. Tiles on pilings are immune. Cypress on or adjacent: −50%. After roughly 7–10 years, a drained marsh tile at 2.0 ft has become a 0.8 ft bowl that floods in every rain — the long-term cost of the cheap option.
- **Tells:** the Flood Risk overlay shows a "▼ subsiding" glyph; the annual report card lists "Campus sank 0.15 ft this year"; buildings on subsided tiles show a slight tilt (sprite skew 2°) — comedic, and a genuine warning.
- **Counterplay:** pilings (retrofit a built tile for $6k), cypress, restoring adjacent Wetland Preserve (halves rate in radius 3), levees + Pump II (accept it and fight the water forever, like the real city).

### 6.6 Heat and Humidity

- **Temperature** by month (°F): Jan 55, Feb 60, Mar 68, Apr 75, May 82, Jun 89, Jul 92, Aug 93, Sep 88, Oct 78, Nov 68, Dec 58; ±5 daily noise; humidity 60–95%.
- **Heat index excess** = `max(0, (temp + humidity/5 − 95)) / 10` → summer values of 0.5–1.5. Happiness `−10 × excess`. Utilities cost +$50/student in summer (AC). Students walk 20% slower and seek shade: paths under oaks/Oak Allée negate the walking penalty and a student under a canopy gets `−excess` for their tile.
- **Visual:** heat shimmer (sine-wave vertical offset of a few px on distant sprites), students in shorts, a cicada drone in audio. Football practice in August: ticker "Two-a-days moved to 6 AM."
- **Counterplay:** oaks, Oak Allée, Rec Center pool, Student Union, building on RIDGE (breeze: −0.2 excess).

### 6.7 Nutria and Other Wildlife

- **Nutria:** abstract population `nutria = 10 + marsh_tiles/40`. Each month, each Levee tile has `nutria/400` chance of being "chewed" → levee integrity 100% → 60% → 20% (visual: brown holes in the ridge; small orange-toothed rodent sprites scurry at night). A chewed levee at 20% leaks 50% of blocked flow. Repair $1k/tile automatically if funds allow. **Counterplay:** Wildlife Office trapping (radius 12 → 0 chews), Levee II concrete cap (immune). Flavor: "Nutria Rodeo" festival event when a Wildlife Office exists (+$3k, +2 happiness).
- **Egrets/herons:** purely decorative on preserve tiles; take off when a student or gator walks within 2 tiles. Ecology ≥ 60 spawns them; they're the "your swamp is healthy" reward signal.
- **Fireflies:** June–August nights over MARSH and preserve tiles with `mosq < 0.3` (yes, they compete). Pure atmosphere.
- **Crawfish:** March–May, visible crawfish traps on preserve bayou edges if ecology ≥ 50 → "Crawfish Boil" festival is free instead of $5k and yields +3 extra happiness.

### 6.8 Ecology Score (0–100)

```
ecology = clamp( 40
   + marsh_tiles / 8                  // 300 marsh → +37
   + preserve_tiles / 10
   + cypress_count / 5 + oaks / 10
   + (wastewater_plant ? 5 : 0) − (students > 2000 && !wastewater ? 15 : 0)
   − abatement_stations × 2 − drained_tiles / 12 − bulldozed_trees / 20 , 0, 100)
```
- **Costs of low ecology (<40):** prestige cap contribution 0, gator wanders ×1.5, subsidence ×1.3, no disaster grant bonus, no egrets/fireflies/crawfish, ticker mockery from the "Bayou Conservancy."
- **Benefits of high ecology (≥70):** prestige +7 to +10, research +20% (Coastal Research Station), disaster grant 30%, mosquito −20% on preserves, "Green Campus" achievement, egrets.

---

## 7. Student Life (Light)

- **Abstract count** is the real `students` number (up to ~15,000). **Visible agents:** `min(120, 20 + students/60)` sprites, each representing a cohort. A visible student has: `name` (generator §14), `year` (Fr/So/Jr/Sr), `major` (one of 8 flavor majors: Coastal Engineering, Petroleum Geology, Kinesiology, Mass Comm, Business, Nursing, Music (Zydeco), Wildlife Biology), `mood` (derived from campus happiness ± personal noise ±10), `stress` (0–100; rises in exam weeks, falls near Library/Rec), `wet` (bool, when standing in water), `scared` (0–100, gator encounters), and a `wantsTo` intention.
- **Daily schedule (per agent, 1 game day = 3 s so this is loose):** 7–9 AM leave dorm → class building (nearest with capacity) → noon dining → afternoon class or Library/Union → 5 PM Rec/Union/Greek Row → 10 PM dorm. Festival days and game days override: all agents path to the event site (Quad/Union/Stadium/Tailgate). Storm T−1: all path to shelter.
- **Visible behaviors (all cheap, sprite-flag driven):** walk on paths (1.4×) or grass (1×) or wet (0.5× with splash particles); umbrella sprite in rain; slap animation in mosquito clouds; "!" and flee sprint from gators; jersey palette swap on game days; tailgate idle (holding a cup, occasional "Geaux!" speech bubble); Mardi Gras: bead throw particles, purple/green/gold recolor; sit under oaks in heat; a group of 4–8 forms a "boil circle" around any Gumbo Shack at 6 PM; graduation day in May: all seniors wear caps and toss them (particle) at the Quad; night: 30% of agents out, drifting between Greek Row and the Union.
- **Thought bubbles:** clicking a student shows a 1-line thought from a pool keyed to their state: *"My dorm's got a foot of water and a catfish in it."* / *"Boudin for breakfast, boudin for lunch, no regrets."* / *"That gator has been on the 50-yard line for an hour."*
- **How they affect the sim:** they don't decide anything — the abstract model does — but they *report* it: the fraction of visible agents that are wet, scared, or slapping is literally the fraction of the abstract model in those states. The player learns to read the campus by looking at it. The one direct hook: clicking a student and pressing "Follow" (camera lock) is the tutorial's way of teaching pathing problems ("she walked *around* the marsh — build a boardwalk").

---

## 8. Sports (Light)

- **Calendar:** 12-game season, one game per week Sat, first Saturday of September through the Saturday before Thanksgiving; 7 home / 5 away, alternating, with **Homecoming** = home game 4 (October) and the **Rivalry Game vs. Crimson Delta** = final game, always at night, home in even years.
- **Requires:** Practice Field (Tier 0: games "played" at a rival's stadium, no revenue, just a ticker result — so you can *have* a team before you have a stadium, and it hurts).
- **Stadium tiers:** T1 "Bayou Field" 12k → T2 "Roux Stadium" 40k → T3 "Roux Stadium, upper deck" 75k → T4 "**The Boil**" 102k with night-game lights. Upgrades happen in place with a 20-day construction overlay (cranes, scaffolding sprite ring).
- **Team rating (0–100):** `20 + practice_field 5 + athletic_complex 15 + stadium_tier × 5 + coach_tier × 10 (0–3, hired via Board card, $200k/$600k/$1.5M per year) + min(15, prestige/5) + min(10, happiness/10) + momentum (±10, +2 per win, −2 per loss, decays)`.
- **Opponents:** 11 fictional schools with fixed ratings that scale +3/year with the player's prestige tier so they stay relevant: Crimson Delta University (rival, 75), Magnolia A&M (65), Gulf Coast Tech (55), Sabine Polytechnic (45), Atchafalaya State (50), Ouachita Valley (40), Pontchartrain University (60), Red Stick College (35, the crosstown "little brother"), Cane River Baptist (30), Twin Span University (58), Delta Blues State (52).
- **Win probability:** `p = 1 / (1 + 10^((opp − team + home_adv) / 25))` where `home_adv = −4` at home (T4: −7; night game: extra −2), `+4` away. At team 50 vs. rival 75 at home: p ≈ 0.12. At team 78 in The Boil at night: p ≈ 0.62. The player feels the stadium matter.
- **Game day event (home games, Saturday, 8 game hours):** tailgate fill animation from noon (tents, RVs, boil-pot smoke, cornhole, 40 extra "fan" sprites in purple/gold), kickoff at 6 PM (7 PM night games) with the bell ringing; the stadium sprite runs a **crowd-wave shader** (a gold sine band rolling around the seats); a score ticker updates each quarter (`score = 3 × poisson(rating/15)`-ish with a final resolved by the win roll so the drama is consistent); final: fireworks if win (+5 happiness), a sad trombone ticker if loss (−2). A 10% chance per home game of a **Gator Delay** if a gator is within 10 tiles of the stadium.
- **Revenue and prestige:** see §5. A 9+ win season pays a $2M bowl check and a "Bowl Bound" achievement; a rivalry win is +3 prestige and a week of +8 happiness; beating Crimson Delta at night in The Boil unlocks the achievement **"Saturday Night in the Boil"** and permanently adds a ring of gold lights to the stadium sprite.
- **Decisions (few, meaningful):** hire/fire coach tier (Board card each January), stadium upgrade timing, tailgate grounds count, ticket-price slider ($20–$80, attendance elasticity `× clamp(1.8 − price/45, 0.4, 1.3)`), and whether to play the rivalry game as a night game (revenue ×1.2 but happens during hurricane season at 2× storm-week rain — a coin flip the ticker will remember).

---

## 9. Time and Calendar

- **Sim tick:** 250 ms (4 Hz) for hydrology/economy/agents' decisions; **render** at display refresh (rAF) with interpolation; agent movement updated per frame.
- **Game day = 3 s at 1×.** 30-day months, 360-day year → **18 minutes per year at 1×**.
- **Speeds:** `Space` pause, `1` 1×, `2` 2×, `3` 4×. Hurricane landfall caps at 2×. Tutorial objectives pause time on first appearance (dismiss to resume) for objectives 1–4 only.
- **Day/night:** each day: dawn (0–2 h) rose-gold tint, day (2–17 h) neutral, dusk (17–19 h) purple-orange, night (19–24 h) deep blue-purple at 45% brightness with window lights, stadium lights, fireflies. A day is 3 s, so day/night is a fast breathing rhythm — pleasant, not disorienting; at 4× it's a shimmer, so above 2× the tint is averaged to a soft twilight.
- **Seasons:** Spring (Mar–May: azaleas bloom, crawfish traps, green saturates), Summer (Jun–Aug: heat shimmer, high sun, fireflies, thunderstorms 35% of days), Fall (Sep–Nov: cypress turns rust, game days, hurricanes), Winter (Dec–Feb: desaturated greens, fog mornings 40% of days, Mardi Gras).
- **Academic calendar:** Fall semester Aug 15 – Dec 15 (finals week Dec 8–15: stress +); Spring Jan 10 – May 15 (finals May 8–15; **Graduation May 16**); Summer session May 20 – Aug 10 (35% occupancy, construction discount).
- **Hurricane season:** Aug 1 – Nov 30. Minimap shows a small hurricane icon and a "season active" ring.
- **Festival days:** **Mardi Gras** (Feb 20–22, parade along the longest road; beads particles; +8 happiness; classes cancelled 1 day), **Crawfish Season Boil** (first Saturday in April at Union/Quad), **Homecoming** (game 4 week, October; parade + bonfire on the Quad + alumni donations ×2 that week), **Founder's Day** (June 1, anniversary of Objective 1; annual report card and "State of the Campus" summary), **Nutria Rodeo** (Jan, if Wildlife Office), **Zydeco Fest** (Sep, if Pavilion), **Graduation** (May 16).
- **Weather generator:** per day, rain probability by month (Jan .30, Feb .30, Mar .32, Apr .30, May .30, Jun .40, Jul .45, Aug .42, Sep .30, Oct .22, Nov .28, Dec .32); rainfall on rain days: `0.3 + random² × 3.5` inches (heavy tail); 10% of summer rain days are thunderstorms (lightning, 2× rain, brief wind gusts and screen shake). Fog on 40% of winter mornings.

---

## 10. Onboarding and Progression

This is the section that drives the rest of the document.

### The first 120 seconds, step by step

**0:00 – Title.** No menu. Full-screen animated swamp: cypress silhouettes, moss swaying, fireflies, a pirogue drifting, bayou reflecting a purple-gold dusk, frogs (if unmuted). Title card "BAYOU STATE" in gold serif with a tiger-stripe underline. One prompt: **"Click to charter the university."** Below: "Continue" if a save exists; a tiny seed field; a mute toggle. *No tutorial checkbox — the guided objectives are the game.*

**0:03 – The Charter.** Click → the camera swoops from the bayou in over the water to the hummock (1.5 s camera move, clouds parting). A parchment card slides up: *"The State of Louisiana grants you 1,500,000 dollars, one dry hill, and a swamp. Build a university. Geaux."* Auto-dismisses in 3 s or on click. Time is **paused**.

**0:08 – Objective 1: "Place Founder's Hall."** The build palette is hidden. The Founder's Hall ghost is *already attached to the cursor*, glowing gold, snapping to valid tiles on the hummock (invalid tiles flash red with a "too wet" tooltip if the player drifts into marsh — the first lesson, taught by accident). Click to place: dust puff, the columns rise (3-frame build animation over 0.6 s), a bell chime, a gold "+5 Prestige" floater, and the **HUD fades in** stat by stat (Treasury, Students, Prestige, Happiness, Date) — each with a 100 ms stagger so the player's eye is led across it once.

**0:20 – Objective 2: "Connect it: drag a path to the Pirogue Landing."** The Pirogue Landing already exists on the nearest bayou tile (placed by the generator), with a pulsing gold ring. The path tool is auto-selected; the objective card shows a 6-second looping GIF-style canvas animation of a drag. Dragging draws a preview with a running cost. On release: the path lays down tile by tile (60 ms each, a soft tick per tile), and time **starts at 1×**.

**0:35 – The arrival.** Three pirogues glide in along the bayou (pre-scripted spline, 4 s), each unloading 4 tiny students who walk up the path to Founder's Hall waving. Ticker: *"First 120 students arrive at Bayou State. One asks where the parking is."* Students counter rolls up to 120. **This is the 90-second hook**: the world moved because of what the player did, and it was charming.

**0:45 – Objective 3: "Build a Dorm and a Dining Hall."** The palette opens for the first time — only the *Essentials* tab, showing 6 items (Dorm, Dining Hall, Gumbo Shack, Lecture Hall, Path, Live Oak). Each placement pops a floater. When the Dorm is placed, Students begin walking into it at night. When the Dining Hall is placed, a boil-pot smoke plume starts. **Applicants counter appears**: "Applicants: 300 / Capacity: 200 — build more housing." The growth loop is now legible.

**1:15 – Objective 4: "It's raining. Drain it."** The first rain is scripted at 1:15 regardless of the calendar (a 2-inch afternoon storm). If the player put the Dorm anywhere on WET ground (very likely — the hummock is small and the generator guarantees the closest expansion is WET), it goes *Wet* (0.5 ft): students splash, the tile darkens, a "Dorm A is wet" notification appears with a **"Show me"** button that opens the Flood Risk overlay and highlights the Drainage Canal in the palette (now unlocked, *Swamp* tab appears). If the player happened to build entirely on dry ground, the rain still shows the overlay and the objective becomes "Dig a canal from the low ground to the bayou before the next storm." Completing it: water visibly drains toward the bayou over 5 s. Achievement toast: **"Cajun Engineer."**

**2:00 – Free play begins** with Objective 5 on the card. The player has placed 4 things, seen students arrive, seen rain, and drained it. They know: place, drag, inspect, overlay. They have never read more than 12 words at once.

### The guided objective chain (Objectives 5–14; each card: a title, one sentence, a "why," and a reward)

| # | Objective | Trigger | Reward / Unlock |
|---|---|---|---|
| 5 | **Cross the marsh** — build 6 tiles of Boardwalk to reach the ridge to the north. | Obj 4 done | Boardwalk unlocked; ridge tiles highlighted; $20k grant |
| 6 | **Keep the lights on** — place a Power Substation *on dry ground* and a Water Tower. | Obj 5 done | Pump Station unlocked; +50 applicants |
| 7 | **Build up, not out** — place Stilt Cottages or apply Pilings to 4 marsh tiles. | Students ≥ 250 | Pilings & Stilt Cottages unlocked; achievement "High and Dry" |
| 8 | **Hold the line** — build a Levee segment of ≥8 tiles on the south bank *and* a Pump Station inside it. | Aug 1 Y1 (hurricane season banner) | Levee unlocked; the card explains "water inside a levee needs a pump" with a 2-panel canvas illustration |
| 9 | **First semester** — reach Aug 15 with ≥ 300 students. | calendar | Semester report card; Board of Regents cards begin |
| 10 | **Storm prep** — Hurricane Adele forms. Checklist: substation dry, pump powered, Union or shelter built. | Scripted storm (see below) | "Weathered" achievement after landfall; $ disaster grant |
| 11 | **Rebuild & Recruit** — repair all damage, build a Library. | After Adele | Accreditation track begins; Science Lab unlocked |
| 12 | **Geaux Tigers** — build a Practice Field and Stadium T1 before Sep 1 of Year 2. | Jan Y2 | Football season begins; Tailgate Grounds unlocked |
| 13 | **Preserve it** — designate 20 tiles of Wetland Preserve. | First gator on campus OR mosquito index ≥ 0.4 | Ecology mechanics explained; Coastal Research Station path |
| 14 | **Accreditation** — Library + 1,000 students + happiness ≥ 55 + no flooded buildings for 30 days. | Obj 11 | +10 prestige; "Accredited" badge on HUD; Medical School path; the objective card is replaced by the free-form **Milestones** panel |

After Objective 14 (typically minute 25–35), the guided chain ends and the **Milestones** panel takes over: it always shows the *three nearest* un-earned milestones with progress bars so the "what next?" question is always answered without being prescriptive.

### The first hurricane (scripted set-piece, minute 12–16)

- **Trigger:** Year 1, the earlier of **Sep 10** or the day the player reaches 400 students, but never before Objective 8 has been *offered* (so the player has been told what a levee is) and never before real-time minute 10. If the player is dawdling, the storm arrives at Sep 10 regardless; the objective card for 8 remains visible.
- **Hurricane Adele, Category 1, always.** Surge 1.5 ft, rain 4 in, wind minimal. It is scary-looking, not campus-ending: the sky, shake, lightning, debris, and blinking lights are at full theatricality; the actual damage is calibrated to flood 1–3 buildings and knock out power for a day if the player did nothing, or to do almost nothing if they completed Objective 8. Either outcome teaches. 
- **Direction:** the forecast cone always drifts to a landfall on the *south* side, where Objective 8 asked for the levee.
- **Framing:** 3 days out, the ticker and a full-width purple banner ("TROPICAL STORM ADELE — 3 DAYS") and the minimap cone. The bell tower rings if built. Students huddle. Music drones. At landfall the speed locks and the camera gently auto-pans to whatever is flooding (toggle-able). Afterward: the sun comes out with a visible god-ray effect for 10 s, egrets fly, and the ticker says *"Adele has passed. Campus mostly here. Cafeteria serving hurricane gumbo."* The disaster grant card arrives. This is the moment the player decides to keep playing — they've been through something.
- **Year 2+ storms** are unscripted and use the real model; the player has ~18 minutes between Adele and the next season to build for it.

### Milestones and achievements (24)

| # | Name | Condition | Reward |
|---|---|---|---|
| 1 | **Chartered** | Place Founder's Hall | — |
| 2 | **Welcome to the Bayou** | First 120 students arrive | — |
| 3 | **Cajun Engineer** | Drain your first tile | $10k |
| 4 | **High and Dry** | 4 tiles on pilings | — |
| 5 | **Weathered** | Survive first hurricane | $ grant |
| 6 | **Hold the Line** | A levee blocks ≥1 ft of surge | +2 prestige |
| 7 | **Five Hundred Strong** | 500 students | Lecture Hall II palette |
| 8 | **Thousand Tigers** | 1,000 students | +$100k donation |
| 9 | **Accredited** | Obj 14 | +10 prestige |
| 10 | **First Kickoff** | Play first home game | — |
| 11 | **Rivalry Won** | Beat Crimson Delta | +3 prestige |
| 12 | **Bowl Bound** | 9-win season | $2M |
| 13 | **Saturday Night in the Boil** | Win a night game in T4 stadium | Permanent gold light ring |
| 14 | **Laissez les Bons Temps Rouler** | Host Mardi Gras with happiness ≥ 75 | +$50k |
| 15 | **Green Campus** | Ecology ≥ 80 with ≥ 3,000 students | Egrets + research +10% |
| 16 | **Gator Whisperer** | Wranglers relocate 25 gators | Wildlife Office upkeep halved |
| 17 | **Skeeter Beater** | Mosquito index < 0.1 for a full summer | — |
| 18 | **Dry Feet** | Zero flooded buildings through a Cat 3+ | +5 prestige |
| 19 | **Sinking Feeling** | A building tilts from subsidence (yes, it's an achievement) | Pilings −25% cost |
| 20 | **Research Powerhouse** | Research ≥ $200k/semester | — |
| 21 | **Ten Thousand** | 10,000 students | Medical School unlock |
| 22 | **Flagship** | Prestige ≥ 80 | Bell tower rings a special peal; title-screen shows your campus |
| 23 | **Roux's Home** | Build the Tiger Habitat | — |
| 24 | **Decade** | Reach Year 10 | Sandbox "Free Build" toggle (unlimited funds, achievements disabled) |

### Unlock progression (summary of gates)

- **Minute 0–2:** Founder's Hall, Path, Dorm, Dining, Gumbo Shack, Lecture Hall, Oak, Canal.
- **Minute 2–8:** Boardwalk, Substation, Water Tower, Pump, Pilings, Stilt Cottages, Levee, Cypress, Azalea.
- **Minute 8–20:** Gator Fence & Wildlife Office (first gator ~min 6–9), Abatement & Bat House (first mosquito warning ~min 10, always before the storm so the summer isn't silent), Classroom Building (500), Library (800), Health Center (800).
- **Minute 20–40:** Practice Field, Stadium T1, Tailgate, Science Lab, Student Union (1,000), Wastewater (1,000), Greek Row (1,500), Rec (1,500), Zydeco Pavilion (prestige 10), Oak Allée (15), Fountain (20), Coastal Station (25).
- **Minute 40+:** Stadium T2–T4, Residence Tower, Athletic Complex, Bus Depot, Engineering Quad, Bell Tower, Tiger Habitat, Medical School.

The rule: **something new appears in the palette every 3–5 minutes for the first 40 minutes.** A gold "NEW" pip on the tab is the only fanfare needed.

### Failure states and recovery

- **Bankruptcy:** Treasury < −$500k for 60 consecutive days → "The Board has concerns" card: choose **Austerity** (all upkeep −30%, happiness −10 for a year, no new construction for 30 days) or **Emergency Tuition Hike** (+$3,000/semester, applicants −40% for a year) or **Sell Naming Rights** (a random building gets renamed "Boudreaux Petroleum Hall," +$1M, −3 prestige). Never a game over; the game *gives you the out and makes you live with it*. If the player rejects all three and stays negative another 60 days, the state "takes over": a 2-year autopilot where you can only watch (skip-able; it's a soft reset to positive balance with −20 prestige).
- **Campus underwater:** if > 50% of buildings are Flooded for 20 consecutive days → "Campus Closed" card: classes cancelled (tuition 0) until < 25% flooded; a free Pump Station II is airlifted in ("National Guard delivers pumps") on a RIDGE tile. Achievement (ironic) **"Hurricane University."** Recovery is always possible because Founder's Hall never falls and pumps can always be placed.
- **Accreditation lost:** if accredited and (happiness < 30 for a semester, or class capacity < students/2, or flooded > 30 days) → probation year (−5 prestige, applicants −25%); a second year → lost, must re-earn Objective 14 conditions. Ticker: "Accreditor cites 'the catfish in the library.'"
- **Student count can't hit zero:** floor of 60 legacy students.

### Endgame and sandbox

There is no win screen; there are **tiers**. Prestige 80 = **Flagship** (title screen replaced by a live render of the player's campus). Year 10 = **Decade** unlocks Free Build. The sandbox keeps escalating storms (max Cat 5 from Year 6) and rivals keep scaling, so a Year-15 campus is a real infrastructure puzzle: an 8-foot surge into a 15,000-student campus with 30 pumps that all need power is a genuinely hard problem. A **"Campus Report"** screen (key `R`) shows the year-by-year charts; a **postcard** button renders the current view to a PNG download with the BSU logo, which is the shareable payoff.

---

## 11. UI/UX

### Main screen (1440×900 reference; scales to any aspect, min 1024×640)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ▣ BSU  $1,482,300 ▲   👥 120 (Apps 300/Cap 200)   ★ Prestige 15   ☺ 62   🌿 68   │ ← Top bar (stats; hover = formula tooltip)
│ Jun 3, Y1  ☀ 84°F  Rain tmrw 40%   [⏸][1][2][4]     ▲ Hurricane season in 58d    │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                   ┌────────────┐ │
│                                                                   │  MINIMAP   │ │
│                                                                   │  (cone     │ │
│                    ISOMETRIC WORLD VIEW                           │   drawn    │ │
│                                                                   │   here)    │ │
│                                                                   └────────────┘ │
│   ┌────────────────────┐                                         ┌────────────┐ │
│   │ OBJECTIVE           │                                         │ INSPECT    │ │
│   │ ● Cross the marsh   │                                         │ Dorm A     │ │
│   │ Build 6 boardwalk   │                                         │ 200/200    │ │
│   │ tiles → the ridge   │                                         │ Water 0.6ft│ │
│   │ [Show me]  3/6      │                                         │ ⚠ Wet      │ │
│   └────────────────────┘                                         │ [Repair]   │ │
│                                                                   │ [Demolish] │ │
│ ┌────────────────────────┐                                       └────────────┘ │
│ │ ⚠ Dorm A is wet  [Fix] │  ← notification stack (max 3, newest bottom)         │
│ └────────────────────────┘                                                       │
├──────────────────────────────────────────────────────────────────────────────────┤
│ [Essentials][Academic][Housing][Life][Sports][Swamp][Nature][Landmarks]  overlays: [F][M][W][P][C] │
│  ▣Path  ▣Road  ▣Boardwalk  ▣Dorm  ▣Dining  ▣Gumbo  ▣Lecture  ▣Oak       🔨Bulldoze  ⓘ   🔊  ≡  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ▸ First 120 students arrive at Bayou State. One asks where the parking is.  ▸ Mosquito index: LOW │ ← ticker
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** six stats with 200 ms tween on change and a green/red flash; hovering shows the formula breakdown ("Applicants 300 = base 60 + prestige 10 × 40 × demand 0.6…"). Date, weather, speed, and the season countdown. The whole bar is 44 px tall.
- **Build palette (bottom, 96 px):** 8 tabs; tabs appear only when they have an unlocked item (Essentials only at start). Items are 64×64 icon tiles of the actual sprite, name under, cost on hover, locked items shown grayed with the unlock condition ("Reach 500 students"). A gold "NEW" pip on newly unlocked. Selecting an item attaches its ghost to the cursor (green = valid, red = invalid with a one-line reason: "Needs a path," "Too wet — drain or add pilings," "Needs power"). Drag tools (path, road, canal, levee, fence, boardwalk) show running length and cost. `Esc` or right-click cancels. Shift-click keeps the tool.
- **Inspect panel (right, 240 px, appears on click):** name (editable — students will name things "Gumbo Hall 2"), stats, status badges (Wet/Flooded/Unpowered/Damaged/Overcrowded/Gator nearby), effects, and 1–3 contextual action buttons (Repair / Upgrade / Demolish / Add pilings / Follow (students)). For tiles: type, elevation, water, mosquito density, "what can be built here."
- **Objective card (left):** one objective at a time, ≤ 20 words, progress fraction, "Show me" (camera pans to the relevant thing and flashes it). Post-tutorial it becomes the Milestones panel (3 nearest).
- **Notifications:** max 3 stacked, auto-expire 12 s, each with one action button. Categories color-coded: blue water, red wildlife, gold money/sports, purple event.
- **News ticker:** bottom, scrolls right-to-left at 60 px/s, queue of ≤ 6 lines; click a line to pan to its subject.
- **Minimap (top-right, 180×180):** terrain colors, buildings as dots, camera rectangle, storm cone + eye, gator dens as red dots when Wildlife overlay on. Click to jump, drag to pan.
- **Overlays (toggle, one at a time, keys):** `F` Flood risk (depth now + projected), `M` Mosquito density, `W` Wildlife (dens, gator paths, preserve), `P` Prestige/happiness heat (per-tile aggregated radius effects), `C` Coverage (power/water/dining/study — cycles with repeated presses). Overlay renders as a translucent color pass over tiles with a legend chip.
- **Report screen (`R`):** semester history charts (students, treasury, prestige, happiness, ecology), season records, storm log. **Menu (`≡`/Esc):** Save/Load slots (3 + autosave), new seed, mute, keybinds, "Postcard" PNG export, credits.

### Camera and controls

- **Pan:** WASD / arrows / edge-drag with middle or right mouse / two-finger trackpad scroll (mapped to pan — trackpad-first!). **Zoom:** wheel / pinch, 3 levels (0.5×, 1×, 2×) with snapping so pixel art stays crisp. **Rotate:** none (single isometric orientation keeps sprite count sane).
- **Shortcuts:** `Space` pause; `1/2/3` speeds; `B` build palette focus; `Q/E` cycle palette tabs; `P` path, `O` road, `K` boardwalk, `L` levee, `N` canal, `U` pump, `G` gator fence, `X` bulldoze; `F/M/W/P/C` overlays; `Tab` cycle notifications; `Esc` cancel/menu; `R` report; `H` home (center on Founder's Hall); `Ctrl+S` save; `Ctrl+Z` undo last placement (within 5 s, full refund); `.` follow random student; `/` search palette.
- **Tooltips:** 400 ms hover delay; every stat, button, palette item, and status badge has one; max 2 lines.
- **Touch (nice-to-have):** single-finger pan, pinch zoom, tap to inspect, tap-tap to place; drag tools become tap-start/tap-end.

---

## 12. Visual Style

- **Projection:** 2:1 isometric, 64×32 px tiles, elevation step 6 px per foot (so a 6 ft ridge sits 36 px higher). World-to-screen: `sx = (x − y) × 32`, `sy = (x + y) × 16 − elev × 6`. Depth-sort by `(x + y)` then by elevation, buildings sorted by their far corner. Draw order per row: ground tile → water layer → decorations/buildings/agents (sorted) → weather overlay.
- **Rendering:** three cached layers. (1) **Terrain layer**: full 64×64 map pre-rendered to an offscreen canvas (4,096 tiles × ~2 draw calls, ~5 ms once), re-rendered only for dirty tiles (a tile changes type/elev/road) via a dirty-rect list. (2) **Water layer**: per-frame draw of only tiles with `water > 0.05` as translucent blue diamonds with a 2-frame ripple; typically < 400 tiles. (3) **Dynamic layer**: buildings (cached sprites, one `drawImage` each), agents, particles, weather. Camera culling by screen rect. Night = a single `multiply`-blended full-screen rect plus additive light sprites.
- **Palette (hex):** Purple `#461D7C` (primary), Gold `#FDD023` (accent), Deep Purple `#2B1150` (night/shadows), Cream `#F5ECD7` (stone, columns), Swamp Green `#3F6B3A`, Moss `#8BA37A`, Cypress Rust `#B5622C` (fall), Mud `#5C4A32`, Wet Mud `#3E3224`, Bayou `#2F4F4F` (water base), Water Highlight `#6FA8B8`, Sky Dusk `#E58F65`→`#5E3B8C`, Lightning `#FFFFFF`, Storm Sky `#4A5A5A`, Gator `#4E5E32`, Fog `rgba(220,225,230,0.35)`.
- **Sprite generation:** each catalog item has a `draw(ctx, w, h, variant, frame)` function using rects, paths, gradients, and a shared helper set (`box3d(x,y,w,d,h,color)` draws an isometric box with three shaded faces; `roof(...)` hip/gable; `windows(rows,cols,litFraction)`; `tree(canopyR, trunkH, color, mossStrands)`; `text(...)` for signage). Each is rendered once per variant/frame into an offscreen canvas at 1× and 2× (for zoom), stored in a sprite atlas map. Estimated ~140 unique sprite canvases (47 buildings × 1–3 frames, ~15 decoration variants × 3 sizes, agent sprites via palette-swap of a 12×20 base with 4 walk frames × 4 directions, 2 gator frames, vehicles, particles as procedural shapes). Total atlas memory < 40 MB.
- **Lighting / day-night:** a tint layer whose color lerps by hour between dawn `rgba(255,190,140,0.15)`, day none, dusk `rgba(120,60,140,0.25)`, night `rgba(20,10,60,0.55)`. Light sources (windows, street lamps on roads every 4 tiles, stadium towers, boil pots, fireflies) are drawn additively as radial gradients on the light layer; window `litFraction` = 0.7 at night, 0.1 by day. Stadium on a night game emits a 40-tile gold glow and vertical light-beam sprites.
- **Weather effects:** rain = 300 short diagonal lines/frame with a slight parallax by zoom + a ripple on wet tiles; thunderstorm = rain + random 200 ms white flash at 8% opacity + 1-frame full white on strikes + a lightning polyline drawn for 2 frames; hurricane = 900 horizontal lines, debris sprites on bezier arcs, tree skew, shake; fog = 2 scrolling noise-textured translucent bands; heat shimmer = ±2 px vertical sine offset on sprites beyond 20 tiles from camera center in summer afternoons; fireflies = 40 yellow 2 px dots on slow Lissajous paths with 1.5 s fade cycles.
- **Animation list:** build (3-frame rise + dust), demolish (crumble + dust), students walk (4 frames), student splash/slap/flee/wave/cheer/toss-cap, gator crawl (2 frames)/lunge/bask (tail flick), pirogue glide + paddle, pump impeller spin, fog truck drive, boil-pot smoke (particle emitter), Spanish moss sway (sprite sub-offset ±1 px on sine), cypress fall color lerp, azalea bloom, stadium wave, fireworks (particle bursts, 5 colors), Mardi Gras beads (arcing purple/green/gold dots), egret takeoff (3 frames), tiger pace (2 frames) and yawn, water tower sway in wind, levee chew holes, crane/scaffold ring during upgrades, blue tarps on damaged roofs, tilted sprite for subsidence.
- **Particles:** a single pooled system (max 2,000), each `{x,y,vx,vy,life,color,size,gravity}`; emitters for smoke, dust, splash, rain ripple, beads, fireworks, sparks (substation failure), leaves (fall), bugs.
- **Juice:** money floaters (`+$12,400` rising gold text), stat flashes, camera shake (0.5 s @ 3 px on placement of big buildings, 2–8 px continuous in hurricanes scaled by category), placement "thunk" scale-bounce (sprite scale 1.15 → 1.0 over 150 ms), hover highlight (tile outline glow), selection pulse, notification slide-in, the HUD stat rolling odometer, screen vignette darkening in storms, a gold flash + bell on achievements with a toast that slides in from the top-right and a tiny tiger paw stamp.

---

## 13. Audio (Synthesized, Muted by Default)

All via a single `AudioContext` created on first click; a speaker button in the palette bar toggles; a small "🔇 Sound off — press M to enable" hint appears once at 0:35 when the pirogues arrive.

- **Ambience bed (looping, crossfaded by time/season/weather):** *Frogs* (night: 3 detuned square-wave chirps with random intervals, low-pass 800 Hz), *Cicadas* (summer day: band-passed noise at 4–6 kHz with a 12 Hz AM tremolo, swelling in and out over 8 s), *Rain* (filtered pink noise, low-pass tracking intensity), *Thunder* (brown-noise burst with 1.5 s decay and a sub-40 Hz sine thump, delayed 0.3–2 s after the flash), *Wind* (band-passed noise sweeping 200–900 Hz, volume by wind), *Bayou lap* (very slow low sine + noise puffs), *Crowd* (stadium: broadband noise with a slow swell and periodic crowd "roar" envelopes on scoring plays).
- **UI sounds:** click (short 2 kHz sine blip, 30 ms), place (low "thunk" — 90 Hz sine 80 ms + noise click), drag tick per tile (1.2 kHz, 15 ms), cash (two-note ascending triangle 880→1320 Hz), error (200 Hz square 100 ms), achievement (4-note gold arpeggio C-E-G-C on a triangle wave with reverb via a short convolver built from noise), bell (metallic: 3 inharmonic sines 520/1040/1830 Hz with 2 s decay), notification (soft two-tone), gator (low growl: 60 Hz saw with FM wobble, 400 ms; every splash is a filtered noise burst).
- **Game-day motif — "Geaux Brass":** a 4-bar zydeco/brass-band loop at 120 BPM in Bb: a rubboard rhythm (short noise bursts, 16ths with accents), an accordion-style chord stab (3 detuned sawtooths through a low-pass at 1.8 kHz, on beats 2 and 4), a tuba bass line (sine + slight saw, root-fifth pattern I–IV–V–I), and a trumpet melody (square wave with vibrato, 8 notes: Bb D F Bb | C Eb G F over the 4 bars). It plays at kickoff and on touchdowns for 8 bars, and at Mardi Gras continuously at lower volume. It's ~60 lines of scheduling code and it is the single most "wait, it made *music*?" moment in the audio design.
- **Mixing:** master gain 0.6; ambience −12 dB under UI; everything ducks −6 dB during the storm drone (a 55 Hz sine with slow LFO).

---

## 14. Flavor Content

### Mascot
**Roux** — a live tiger who lives in the Tiger Habitat. Costumed version appears at games as a sprite in a jersey with the number 00. The student section's chant: "**GEAUX ROUX**." His annual "Roux's Birthday" is a one-day happiness +3 event (June 12) once the Habitat exists.

### University and naming
**Bayou State University** (BSU), founded on the Hummock in "Red Stick Parish." Colors "Royal Purple and Old Gold." Motto on Founder's Hall: *"Ex Palude, Lux"* (From the swamp, light). Alma mater song line in credits only: "*From the cypress to the levee…*"

### Building names (auto-assigned on placement, cycled; player-editable)
Dorms: Atchafalaya Hall, Pontchartrain Hall, Teche Hall, Lafourche Hall, Calcasieu Hall, Vermilion Hall, Tchefuncte Hall, Bogue Falaya Hall, Maurepas Hall, Cane River Hall. Academic: Boudreaux Hall, Thibodeaux Hall, Landry Hall, Hebert Hall, Fontenot Hall, Guidry Hall, Broussard Hall, Arceneaux Hall, LeBlanc Hall, Cormier Hall, Mouton Hall, Trahan Hall. Dining: "The Roux," "Big Easy Commons," "Étouffée Station," "The Boil House," "Boudin Bros." Gumbo Shacks: "Mama T's," "Tee-Boy's," "Nonc Pierre's," "Sha's." Library: "The Delphine Prudhomme Library." Union: "Laissez Union." Stadium: "Roux Stadium" / "The Boil." Bell Tower: "Cypress Bell Tower." Fountain: "Founders' Fountain." Coastal station: "Marsh Lab at Pointe-aux-Chênes."

### Student name generator
- **First names (mixed pool, 60):** Beau, Remy, Étienne, Jacques, Pierre, Landry, Boudreaux (as a first name, why not), Thibault, Claude, Antoine, Jean-Luc, Gaston, Amédée, Noé, Aurélien, Cyprien, Léon, Théo, Zeke, Tanner, Hunter, Kobe, Darius, Marcus, Jamal, DeShawn, Terrance, Cedric, Marguerite, Delphine, Clotilde, Évangéline, Odile, Josette, Céleste, Amélie, Elodie, Solange, Mireille, Noémie, Rosalie, Vivienne, Aimée, Lulu, Sha, Tee-Tee, Kaylee, Brooklyn, Madison, Kayla, Alyssa, Destiny, Jasmine, Monique, Tiana, Simone, Nadia, Imani, Keisha.
- **Last names (60):** Boudreaux, Thibodeaux, Hebert, Landry, Broussard, Guidry, LeBlanc, Fontenot, Arceneaux, Cormier, Trahan, Mouton, Richard, Robichaux, Prejean, Breaux, Bergeron, Melancon, Theriot, Domingue, Babineaux, Comeaux, Dugas, Doucet, Gautreaux, Naquin, Pitre, Rousseau, Savoie, Bourgeois, Chauvin, Cheramie, Terrebonne, Delahoussaye, Simoneaux, Ledet, Toups, Duplantis, Falgout, Champagne, Batiste, Toussaint, Lafleur, Metoyer, Balthazar, Jolivette, Dupré, Charles, Honoré, Ancelet, Roy, Sonnier, Vidrine, Fuselier, Ardoin, Malveaux, Semien, Chavis, Guillory, Bellard.
- **Rule:** 20% of names get a nickname in quotes: "Boo," "Tee," "Nonc," "Coon," "Sha," "Bubba," "Poo," "Tank," "Cher," "Bébé." Hometowns pulled from: Thibodaux, Houma, Lafayette, Opelousas, Ville Platte, Breaux Bridge, Eunice, Mamou, Golden Meadow, Cut Off, Chalmette, Gretna, Plaquemine, New Roads, Natchitoches, Monroe, Shreveport, and "Somewhere in Texas, don't hold it against her."

### Rival schools
Crimson Delta University (the rival; "elephant-adjacent"), Magnolia A&M, Gulf Coast Tech ("the Pelicans"), Sabine Polytechnic, Atchafalaya State ("the Mudbugs"), Ouachita Valley, Pontchartrain University ("the Brown Pelicans," lakefront snobs), Red Stick College (crosstown; the ticker refers to them as "the school across the tracks"), Cane River Baptist, Twin Span University, Delta Blues State.

### Festivals (descriptions used in the calendar tooltip and event card)
- **Mardi Gras (Feb 20–22):** "The Krewe of Roux rolls down Campus Drive. Beads fly, classes don't. Purple, green, gold, and a marching band that learned its part yesterday."
- **Crawfish Boil (first Sat of April):** "Forty sacks, sixty pounds of corn, a hundred pounds of potatoes, and a suspicious amount of cayenne. Pinch the tail, suck the head."
- **Homecoming (October):** "Alumni return to see what you've done with the place. Parade, bonfire on the Quad, a game under the lights, and donations are doubled if the bonfire doesn't reach the library."
- **Founder's Day (June 1):** "One year older. Annual report, a speech nobody hears, and the Chancellor's gumbo."
- **Zydeco Fest (September):** "Accordions, rubboards, and a dance floor on the Pavilion. Mosquitoes attend free."
- **Nutria Rodeo (January):** "The Wildlife Office's annual trapping competition. Prizes for biggest, most, and 'ugliest, bless its heart.'"
- **Graduation (May 16):** "Caps in the air, tears in the eyes, a gator in the fountain. Every year. Nobody knows how."

### News ticker and event lines (52)

1. First 120 students arrive at Bayou State. One asks where the parking is.
2. Student senate passes resolution: gumbo is a soup. Debate continues.
3. Gator spotted on the 50-yard line. Kickoff delayed. Crowd names him Gerald.
4. Mosquito index: HIGH. Health Center recommends long sleeves, prayer.
5. Sophomore outruns gator near Atchafalaya Hall, credits "cardio and fear."
6. The Bayou Conservancy would like a word about that drainage canal.
7. Hurricane season begins. Campus bookstore sells out of tarps, boudin.
8. Tropical Storm {name} forms in the Gulf. Forecast cone includes "here."
9. {name} upgraded to Category {n}. Chancellor "monitoring the situation," reportedly from a boat.
10. {name} has passed. Campus mostly here. Cafeteria serving hurricane gumbo.
11. Power restored to Roux Stadium. Nobody restored it to the library, apparently.
12. Nutria chewed through the south levee. Wildlife Office "aware," "annoyed."
13. Founder's Day: Chancellor's speech runs 45 minutes. Gumbo runs out in 12.
14. Applicants up {n}% after a viral video of the stadium wave.
15. Crawfish traps report bumper season. Boil moved to the Quad "for safety reasons."
16. Mardi Gras: Krewe of Roux float loses a wheel, gains a legend.
17. Cypress trees turning rust. Freshman photography majors reach critical mass.
18. Campus Police issue {n} parking citations on game day. Lot was "a marsh."
19. Heat index 108. Two-a-days moved to 6 AM. Freshmen moved to the Rec pool.
20. The Boil is loud enough to register on the Coastal Station's seismograph.
21. BSU {w}, {opp} {l} — FINAL. Bell tower rings until someone finds the off switch.
22. {opp} {w}, BSU {l} — FINAL. Sad trombone reported near Greek Row.
23. Homecoming bonfire held safely 40 feet from the library. Library "relieved."
24. Dorm residents report a catfish in the hallway. Catfish declines to comment.
25. Fog delays 8 AM classes. Also delays 9 AM classes. Attendance unaffected (was zero).
26. Fireflies over the preserve tonight. Astronomy club "cancels," attends anyway.
27. Egrets nest on the marsh boardwalk. Boardwalk now "egret walk."
28. Subsidence report: Boudreaux Hall now leans 2°. Engineering dept "taking it as a challenge."
29. Pump Station fails during storm. Campus discovers what "inside the levee" means.
30. Board of Regents suggests a tuition hike. Students suggest otherwise, loudly.
31. Research grant awarded: "Why Do Gators Like Football?" Funding secure through 2031.
32. Coastal Research Station detects storm 2 days early. Everyone panics 2 days early.
33. Roux the Tiger yawned during the alma mater. Students call it "a review."
34. Zydeco Fest ends at 2 AM. Mosquitoes hold after-party.
35. Alumni donations double after rivalry win. Alumni memories of the loss column: none.
36. Greek Row hosts a boil. Fire department hosts Greek Row.
37. Freshman asks what a pirogue is. Freshman now lives on a pirogue.
38. Bald cypress planted along the canal. Sinking slowed. Vibes improved.
39. Student section chant "GEAUX ROUX" heard in Red Stick College's library, allegedly.
40. Accreditation review notes "the catfish in the library." Library denies catfish.
41. State Disaster Grant approved. Check is "in the mail," mail is "flooded."
42. Wildlife Office relocates its 25th gator. Gator #25 relocates itself back.
43. Bat houses installed. Mosquito index falls. Bats decline interview.
44. Azaleas in bloom on the Quad. Campus tour group audibly gasps, enrolls.
45. Emergency tuition hike enacted. Student newspaper prints in red ink "for effect."
46. Naming rights sold: Thibodeaux Hall is now "Boudreaux Petroleum Hall." Thibodeaux family "processing."
47. National Guard delivers pumps by helicopter. Marching band plays them in.
48. Night game announced vs. Crimson Delta. Weather service "would advise against it."
49. King cake in the Union. Baby found by a sophomore, who now owes everyone a cake.
50. Graduation: {n} seniors toss caps. One cap retrieved from a gator. Gator "kept it."
51. Ecology score hits {n}. Conservancy sends a fruit basket and a "we're watching" card.
52. Prestige {n}: BSU now ranked "somewhere on the list." Chancellor frames the list.

---

## 15. Technical Feasibility Notes

### One HTML file
- `build.js` concatenates `src/*.js` in a fixed order into `<script>` in `index.html`, with a `<style>` block for the HUD (DOM overlays for panels/text are allowed and faster to author than canvas text; the world is Canvas 2D). Target ≤ 600 KB uncompressed, zero external references. All fonts: system stack (`Georgia` for the title serif feel, `system-ui` for UI); the gold title uses canvas-drawn text with stroke.
- `file://` constraints: no `fetch`, no modules (`type="module"` has issues on file:// in some Safari configs) — plain concatenated IIFEs with a shared `BSU` namespace object; no Workers (blob workers are fine but unnecessary); `localStorage` works on file:// in both Chrome and Safari (Safari private mode may throw → try/catch, fall back to in-memory and warn).
- Save format: JSON of terrain deltas (only tiles that differ from the seeded generation: type/elev/water/drained/piling/road), building list, agents omitted (regenerated), economy/calendar/objective/achievement state, storm state, RNG state. ~30–80 KB. Autosave every game month and on tab hide; 3 manual slots.

### Performance budget (target 60 fps, floor 30, on an integrated-GPU laptop)
- **Tiles:** 4,096 total; terrain cached; per-frame draws: visible water tiles (< 400) + visible dynamic sprites (< 600 at 1× zoom: ~200 buildings/decos in view, 120 agents, 6 gators, 40 fans on game day, particles).
- **Agents:** 120 visible max; pathfinding A* on a 64×64 walkability grid with path caching per (from,to) building pair — at most a few paths/s, budget 2 ms/frame with a time-sliced queue.
- **Hydrology:** 4,096 cells × 4 neighbors × 4 Hz = 65k ops/s. Negligible.
- **Particles:** 2,000 max, single typed-array pool.
- **Draw calls:** ~1,200 `drawImage` per frame worst case (game-day night in a storm); comfortably < 8 ms on Chrome/Safari. Night light layer uses one offscreen canvas at half resolution with `globalCompositeOperation='lighter'`, then composited — 1 extra full-screen blit.
- **Guardrails:** if measured frame time > 28 ms for 60 frames, auto-reduce: rain lines 300→120, particles cap 800, agents 120→60, half-res light layer→quarter. Show a tiny "performance mode" chip.

### Module decomposition (13 modules, `src/` order = concat order)

| # | File | Owns | Contract (public API on `BSU.*`) |
|---|---|---|---|
| 1 | `00_core.js` | RNG (seeded xorshift), event bus, constants, math helpers, calendar | `BSU.rng`, `BSU.events.on/emit`, `BSU.time` |
| 2 | `01_terrain.js` | map generation, tile arrays (typed), type derivation, decorations | `BSU.map.gen(seed)`, `tiles[]`, `getTile(x,y)`, `isBuildable(x,y,item)` |
| 3 | `02_hydro.js` | water sim, drainage, pumps, levees, subsidence, flood status | `BSU.hydro.tick()`, `floodDepthAt(building)`, `surge(level)` |
| 4 | `03_weather.js` | daily weather, seasons, hurricane lifecycle, forecast cone | `BSU.weather.today`, `storm` state, `events: 'storm:form','storm:landfall','storm:end'` |
| 5 | `04_catalog.js` | building definitions (data), unlock rules, sprite draw fns | `BSU.catalog[id]` with `{footprint,cost,upkeep,effects,unlock,draw}` |
| 6 | `05_buildings.js` | placement, validation, footprint occupancy, power/water coverage, damage/repair, drag tools | `BSU.build.place(id,x,y)`, `canPlace`, `demolish`, `buildings[]` |
| 7 | `06_economy.js` | money, tuition, enrollment, prestige, happiness, ecology, semester reports, Board cards, failure states | `BSU.econ.state`, `semesterTick()`, `monthTick()` |
| 8 | `07_wildlife.js` | gators, nutria, mosquitoes, egrets/fireflies, wranglers, fog truck | `BSU.wild.tick()`, `mosqAt(x,y)`, `gators[]` |
| 9 | `08_agents.js` | student agents, schedules, pathfinding, behaviors, thought bubbles, fans | `BSU.agents.tick(dt)`, `agents[]`, `follow(id)` |
| 10 | `09_sports.js` | season schedule, ratings, game sim, game-day event, tailgates, revenue | `BSU.sports.state`, `playGame()`, events `'game:kickoff','game:final'` |
| 11 | `10_render.js` | camera, iso math, terrain cache, layers, sprite atlas, particles, weather FX, day/night, overlays, minimap | `BSU.render.frame(t)`, `screenToTile`, `atlas.get(id,frame,zoom)`, `particles.emit(...)` |
| 12 | `11_ui.js` | DOM HUD, palette, inspect, notifications, ticker, report, menu, input/shortcuts, tooltips | `BSU.ui.notify(...)`, `ticker.push(...)`, `openInspect(target)` |
| 13 | `12_journey.js` | objectives, tutorial scripting (arrival pirogues, first rain, Adele), milestones/achievements, unlock gating, flavor text pools, name generator | `BSU.journey.tick()`, `unlocked(id)`, `achieve(id)` |
| + | `13_audio.js`, `14_save.js`, `99_main.js` | WebAudio synth; save/load/autosave; boot, loop, resize | `BSU.audio.play(name)`, `BSU.save.write/read`, `BSU.main.start()` |

Parallel authoring contract: modules 2–10 depend only on 1 and the *data shapes* documented above (tile struct, building struct `{id,x,y,w,h,hp,powered,watered,flooded,piling,name}`, agent struct, storm struct). Render and UI read state; they never mutate simulation state except through `BSU.build`/`BSU.econ` calls. The journey module is the only one allowed to script other modules (e.g., force a rain day).

### What to cut first if scope must shrink (in order)
1. Touch support. 2. Baseball Diamond, Bus Depot, Zydeco Pavilion, Nutria Rodeo (keep nutria chewing — it's one line). 3. Heat shimmer and fog visuals (keep the heat *mechanic*). 4. Report charts (keep the numbers as text). 5. The 2× zoom sprite set (render 1× and scale). 6. The crowd-wave shader (keep fireworks). 7. Coach tiers (keep one flat coach). 8. Board of Regents cards (keep the failure-state cards). 9. The game-day brass motif (keep ambience). Never cut: the first 2 minutes, Adele, the flood overlay, gators, the stadium.

---

## 16. Scope Risks and the Three "Demo, Not Game" Traps

### Trap 1: "I placed some buildings and nothing pushed back."
A city builder without a heartbeat is a screensaver. **How the design avoids it:** the swamp is on a clock the player can see. Rain at 1:15 is scripted. The first gator is guaranteed between minutes 6 and 9. Mosquitoes warn at ~10. Adele lands between minutes 12 and 16, telegraphed for 3 days. After that, the real models take over but the calendar (hurricane season ring, applicants vs. capacity, semester payday) keeps producing a visible deadline every 3–6 minutes. Every stat on the HUD has a tooltip showing why it moves, so pressure is always *legible*, never mysterious. The objective card then the Milestones panel mean the "what now?" question is never unanswered.

### Trap 2: "Everything is a blob and nothing feels alive."
Procedural art can read as gray boxes. **How the design avoids it:** (a) a strict palette with purple and gold as *accents on every building* so the campus reads as one place; (b) the world moves constantly — 120 walking students, boil-pot smoke, moss sway, water ripples, day/night breathing every 3 seconds, fireflies, egrets, the fog truck at dusk; (c) *behavioral* charm that costs nothing: gators basking on the football field, students slapping mosquitoes, caps tossed at graduation, tailgate tents; (d) the ticker, which gives the campus a voice in 52 lines that reference what actually happened. The screenshot moment in §1 is a checklist for the render module: if the night-game shot doesn't look like that, the game isn't done.

### Trap 3: "I hit a wall at minute 20 and stopped."
Either the tutorial ends and the player is lost, or the economy plateaus and the palette has nothing new. **How the design avoids it:** the guided chain runs to ~minute 30 and hands off to a Milestones panel that always shows three concrete next targets with progress bars. Palette unlocks are spaced every 3–5 minutes for 40 minutes by gates tied to students, prestige, and *events* (first gator, first mosquito warning), not just money. Football starts in Year 2 (≈minute 20–25) as a second engine with its own weekly rhythm. The stadium tiers give a 40-minute-plus aspirational ladder that is visible on the palette as grayed icons from the start. And storms escalate: the player who's comfortable at minute 40 gets a Cat 3 at minute 55 and discovers their pumps aren't on pilings.

### Other scope risks (and the answer)
- **Hydrology tuning is a rabbit hole.** Ship with the numbers above, clamp everything, and make the flood overlay show *projected* depth so mis-tuning is visible to the player rather than hidden. The scripted first rain and Adele use fixed values, so the first 16 minutes are tuning-proof.
- **Agent pathfinding over a changing map.** Cache paths per building pair, invalidate on any road/water change in that pair's bounding box, time-slice A*. Agents that fail a path teleport at night (nobody sees it).
- **Save-compat across dev iterations.** Version the save; if version mismatches, offer "start fresh with same seed."
- **Safari file:// quirks.** No modules, no `OffscreenCanvas` reliance (use hidden `<canvas>` elements), AudioContext resumes on first user gesture, `localStorage` wrapped in try/catch.
- **The "one shot" itself.** The module contract above is the real deliverable of this GDD. If each agent implements against `BSU.*` shapes and the journey module owns all scripting, integration is concatenation, not negotiation.

---

*End of document. Geaux build.*
