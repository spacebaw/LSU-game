# Brief: `src/js/data.js` → `BSU.data`

Read first: `docs/ARCHITECTURE.md` §1 (row 1), §3.1 (`BSU.B`, `BSU.B_ORDER`, `BSU.PLACE`), §3.6 (`BSU.catalogRowSchema`), §4 (all of it: this brief is §4 expanded); `docs/GDD.md` §0.3 (the 43-row table), §4 (visual briefs, decal list, house style), §5.9, §6.2 (storm names), §7.1, §8 (opponents, schedule), §9.2 (dates), §10.2 (objectives), §10.5 (milestones), §10.7, §11.2 (tabs), §11.8 (keys), §14 (every flavor table), §14.4 (62 ticker lines).

**Transcription warning.** Every one of the 43 catalog rows and every name/ticker/flavor table in GDD §0.3, §4, §6.2, §7.1, §8, §14.1–14.4 must be transcribed **exactly**: same spelling (including `Étouffée`, `Célestine`, `Zéphyrine`, `Pointe-aux-Chênes`), same numbers, same order. Do not paraphrase the 62 ticker lines, the 26 storm names, the 20 hall names or any card text. `data.selfTest()` checks counts and shapes; a reviewer checks the text against the GDD line by line.

---

## 1. Purpose and public surface

`data.js` is the second file in the manifest. It is one `'use strict'` IIFE that reads `window.BSU` (already created by `contract.js`) and assigns **immutable tables** to `BSU.data`. It has no `init`, `reset` or `tick`. It touches nothing but `BSU` at definition time (no DOM, no timers). After definition, `BSU.data` is **deep-frozen** (`Object.freeze` recursively; freezing a typed array throws, so there must be none in `data`). No table references `state`, and no table contains a function (the debug panel and the save code walk these objects).

```js
BSU.data.catalog        // Object<string, CatalogRow>  keyed by id, all 43 rows
BSU.data.catalogList    // CatalogRow[]  in §0.3 row order (n = 1…43), same objects as catalog[id]
BSU.data.tabs           // [{id, name, rows: string[]}] in §11.2 order
BSU.data.decals         // Object<string, {w, h, anchor: 'roof'|'ground'|'side', frames}>
BSU.data.names          // {halls, towers, dining, poboy, greek, library, union, engineering, institute, stadium, bellTower, leveeRun}
BSU.data.students       // {firstCajun, firstModern, last, nicknames, majors, hometowns, quotes, modernShare: .25, nicknameShare: .12}
BSU.data.coaches        // [{name, rep}] (10)      BSU.data.coachQuotes: string[12]
BSU.data.gatorNames     // string[14]              BSU.data.leGrand: 'Le Grand'
BSU.data.stormNames     // string[26]
BSU.data.opponents      // Object<string, {name, nick, rating, colors: [string,string], rival: boolean, crosstown: boolean}> (9)
BSU.data.schedule       // [{date, home, kind}] (8)
BSU.data.calendar       // {dates: Object<string, string[]>, festivals: [{id, start, end, text}]}
BSU.data.ticker         // string[62]               BSU.data.tickerKinds: Object<number, kind>
BSU.data.objectives     // Object<string, {kind, title, text, reward, teaches, showMe, deadlineText}>
BSU.data.milestones     // [{id, name, text, reward: {cash?, prestige?, effect?}}] (26, in BSU.MILESTONES order)
BSU.data.voiceCards     // [{id, student, major, text, payoff, prereq}] (12)
BSU.data.boardCards     // [{id, name, text, cost, effect}] (8)
BSU.data.failureCards   // {bankruptcy: {title, options: [{id, text}]}, underwater: {...}, probation: {...}}
BSU.data.tutorial       // [{stage, card, hint}] (7 rows, stages 0–6)
BSU.data.thibodeaux     // string[]   speech-bubble variants
BSU.data.stormQuotes    // string[]
BSU.data.overlays       // [{ov, key, name, legend: string[]}] (6)
BSU.data.keys           // [{key, action, ctrl?: boolean, shift?: boolean}]  (the §7.4 map; the single source for the settings sheet)
BSU.data.rainKinds      // {shower: {total: .04, steps: 40}, frontal: {total: .125, steps: 40}, band: {total: .33, steps: 40}, cell: {steps: 60, radius: 14}, hurricane: {inches: [6,8,10,13,16], steps: 360}}
BSU.data.selfTest()     // → {ok, notes}
```

Everything is data; the only function on `BSU.data` is `selfTest`.

## 2. State fields

Owns nothing in `state`. Reads nothing in `state`. Reads `BSU.B`, `BSU.B_ORDER`, `BSU.PLACE`, `BSU.SURF`, `BSU.OBJ`, `BSU.OV`, `BSU.MILESTONES`, `BSU.catalogRowSchema`, `BSU.dateToDay` (in `selfTest` only).

## 3. Events

Emits none. Listens to none.

## 4. Rules checklist (all Tier 1; `data.js` has no Tier 2)

### 4.1 Catalog rows (ARCHITECTURE §4.1; GDD §0.3, §3.6, §4.11)

- [ ] Exactly 43 rows, `n` = 1…43 in §0.3 order, `id` = the `BSU.B` key, `catalogList[n-1] === catalog[id]`.
- [ ] **Every field of `BSU.catalogRowSchema` is present on every row** with the declared type (`selfTest` validates). `effects` has **every** key listed in ARCHITECTURE §4.1 on every row; unused keys are `0`, `false`, `''`, `null` or `{value:0, radius:0}` as the schema says. Missing keys are the #1 cause of `undefined` bugs across 16 implementers.
- [ ] `tab` assignment (decision; record it in a header comment): rows 1–3 `paths`; 4–7 `utilities`; 8–12 `academic`; 13–15 `housing`; 16–17 `dining`; 18–19 `sports`; 20–24 `life`; 25–35 **and 41, 42** `swamp`; 36–40 **and 43** `grounds`. `essentials: true` only for `path, dorm, dining_hall, lecture_hall, poboy, quad, live_oak`.
- [ ] `kind`: `drag` for `path, road, boardwalk, levee, floodwall, canal, gator_fence, surge_barrier`; `paint` for `preserve`; `upgrade` for `pilings`; `footprint` for every other row **including `marsh_restoration`** (its 1×1 office is the footprint; the 10–40-tile paint is a buildings-module Tier 2 feature; `placeRule = BSU.PLACE.RESTORE`).
- [ ] `w, h` from §0.3 (drag/paint/upgrade rows are 1×1; `surge_barrier` row is 1×1, the Building struct's `w` becomes the run length at placement). `rotatable = (w !== h)`.
- [ ] `cost`, `upkeep` exactly as §0.3 (integers; `$2k` = 2000, `$1.8M` = 1800000). `pilings.cost = 0`, `pilings.upkeep = 0`. `stadium.cost = 2000000` and `stadium.upkeep = 30000` (tier 1; tiers 2–3 live in `tiers`). `practice_field.cost = 200000`, `upkeep = 3000` (tier 1 in `tiers`).
- [ ] `wr` from §0.3 (0 for drag/paint/upgrade rows; `boardwalk` is the one drag row with a WR in the GDD (2) — store `wr: 2` on it; nobody applies wind damage to tiles, so it is flavor).
- [ ] `needsPower` / `needsWater`: ⚡ rows = `water_tower, wastewater, founders_hall, lecture_hall, library, engineering, coastal_institute, dorm, res_tower, greek_house, dining_hall, poboy, stadium, union, rec_center, health_center, bell_tower, tiger_habitat, surge_barrier, marsh_restoration`; 💧 rows = `founders_hall, lecture_hall, library, engineering, coastal_institute, dorm, res_tower, greek_house, dining_hall, stadium, union, rec_center, health_center, tiger_habitat`. Note the Substation itself needs neither; the Pump needs ⚡ **by effect** (`effects.pumpTileFt > 0` makes buildings treat it as a power consumer: set `needsPower: true` on `pump` too so the coverage code has one rule — decision, matches "needs ⚡ (stops in blackout)").
- [ ] `pathAdjacency: true` for rows 4–22, 24, 28, 32, 34, 39, 40, 42, 43; false for 1–3, 23, 25–27, 29–31, 33, 35–38, 41.
- [ ] `roadWithin`: 4 for `stadium, parking, wastewater`; 0 otherwise (**not** the substation, GDD C5).
- [ ] `placeRule`: `path→PATH`, `road→ROAD`, `boardwalk→BOARDWALK`, `levee→LEVEE`, `floodwall→LEVEE`, `canal→CANAL`, `gator_fence→FENCE`, `preserve→PRESERVE`, `wastewater→NEAR_WATER`, `coastal_institute→TOUCH_MARSH_BAYOU`, `pump→TOUCH_CANAL_WATER`, `cypress→CYPRESS`, `rookery→MARSH_OR_PRESERVE`, `surge_barrier→BARRIER`, `marsh_restoration→RESTORE`, `pilings→UPGRADE`, everything else `LAND`.
- [ ] `allowMarsh: true` for every footprint row (D9); `alwaysPilings: true` for `coastal_institute` and `rookery` only.
- [ ] `buildDays`: footprint rows `1 + Math.floor(w*h/6)` (1×1→1, 2×2→1, 3×2→2, 3×3→2, 4×3→3, 6×5→6); drag/paint 0; `pilings` 1.
- [ ] `unlock` (empty object = Start): `wastewater {students:1000}`; `library {students:800}`; `engineering {students:1500}`; `coastal_institute {students:1200, ecology:40}`; `res_tower {students:1500}`; `greek_house {students:600}`; `practice_field {students:400}`; `stadium {students:600, building:'practice_field', tier:1}`; `union {students:600}`; `rec_center {students:800}`; `health_center {students:400}`; `floodwall {any:[{building:'engineering'},{students:2000}]}`; `bell_tower {students:2000, prestige:30}`; `tiger_habitat {students:1000, prestige:20}`; `surge_barrier {milestone:'fortressBayou'}`; `marsh_restoration {milestone:'livingWithWater'}`; `rookery {building:'marsh_restoration'}`; all others `{}`. Semantics (progress implements): `building: id` = a **complete** building of that id exists (`tier ≥ unlock.tier` when given); `any` = at least one sub-rule holds.
- [ ] `pip`: `gator_fence, wildlife_post → 'gator'`; `pond, abatement, bat_house → 'mosquito'`; `canal → 'cell'`; `levee, pump → 'season'`; all others `''`.
- [ ] `tiers`: `practice_field.tiers = [{tier:1, name:'Bayou Field', cost:600000, upkeep:4000, seats:6000, landmark:1, shelter:0, wr:1, night:false, unlock:{students:400}, buildDays:6}]`; `stadium.tiers` = the three objects in ARCHITECTURE §4.1 (`Red Stick Stadium 2000000/30000/15000/4/5000/3/false/{students:600, building:'practice_field', tier:1}/6`, `The Cauldron 8000000/80000/45000/10/15000/4/true/{students:1500}/6`, `Cauldron Grand 32000000/180000/80000/18/25000/5/true/{students:8000, prestige:50}/6`); `[]` elsewhere.
- [ ] `demolishable: false` for `founders_hall, library, res_tower, stadium, bell_tower, tiger_habitat, rookery, surge_barrier, marsh_restoration` (D10); true otherwise.
- [ ] `shelterOwn: true` for `dorm` and `res_tower` only.
- [ ] `namePool`: `lecture_hall, engineering→'halls'`? No: `dorm, lecture_hall → 'halls'`; `res_tower → 'towers'`; `dining_hall → 'dining'`; `poboy → 'poboy'`; `greek_house → 'greek'`; `library → 'library'`; `union → 'union'`; `engineering → 'engineering'`; `coastal_institute → 'institute'`; `stadium → 'stadium'`; `bell_tower → 'bellTower'`; `founders_hall` → `''` (its name is "Founders' Hall"); everything else `''` (buildings names those "Substation 2" style: `name + ' ' + count`).
- [ ] `why` (the tooltip why-line) and `desc` (one-line effects in words) for every row; the GDD gives `why` for Pilings ("Pilings: the marsh keeps the marsh, you keep the building"); author the rest in the GDD's voice, ≤ 14 words each.
- [ ] `paint`: house style default for academic/housing/dining/life rows = `{wall:['#F5ECD7','#E8D9B5'], roof:'hip', roofColor:'#B5533C', floors, windows:{cols, rows}, decals:['arcade', …], accent:'#FDD023', lift:0, special:''}`; `floors`: dorm 4, res_tower 12, lecture_hall 2, library 2, engineering 3, coastal_institute 2, founders_hall 2, union 2, rec_center 1, health_center 1, greek_house 2, dining_hall 1, poboy 1, bell_tower 6, tiger_habitat 1; `windows`: lecture_hall {5,2}, dorm {6,4}, res_tower {4,12}, others sensible. Non-house-style rows name their own walls: engineering `['#8A8A8E','#6E6E72']` `roof:'flat'` (the brutalist joke, gold pipes decal), lecture_hall tan brick `['#C9A97A','#B08D5E']`, substation/parking/pump etc. per GDD §4 visual column. `special` names the special painter for non-box rows: `'substation','water_tower','generator','wastewater','practice_field','stadium','quad','parking','pond','abatement','bat_house','wildlife_post','live_oak','cypress','azalea','bell_tower','tiger_habitat','coastal_institute','surge_barrier','marsh_restoration','rookery','poboy','greek_house'`; `''` for plain boxes. `lift` = 0 (pilings lift is a variant, not a row value).

### 4.2 Effects per row (GDD §0.3; the numbers the sim reads)

Transcribe exactly. Percentages are fractions. Radii are Chebyshev tiles. Only non-zero/non-default keys are listed here; the row must still carry every key.

| id | effects (non-zero) |
|---|---|
| path | `surfaceId: 1` |
| road | `surfaceId: 2, noise: {value:1, radius:1}` |
| boardwalk | `surfaceId: 3` |
| substation | `power: {radius:10, capacity:40}` |
| water_tower | `water: {radius:12, capacity:50}` |
| generator | `fuelDays: 3, power: {radius:6, capacity:0}` (capacity 0 = backup only) |
| wastewater | `capacityStudents: 6000, ecology: 0` (the −5 on Marsh is a one-time placement effect; buildings applies it via `wildlife`; flag with `special:['wastewater']`) |
| founders_hall | `seats:300, landmark:2, shelter:300, academic:0` (the emergency 600 is a buildings rule) |
| lecture_hall | `seats:400` |
| library | `academic:20, landmark:4, happiness:{value:4, radius:10}, shelter:800` |
| engineering | `seats:500, academic:20, research:{kind:'engineering', base:12000}, shelter:800, special:['discountSwamp']` |
| coastal_institute | `seats:150, academic:20, research:{kind:'coastal', base:10000}, coneDays:9, coneNarrow:0.3, ecologyDecayMult:0.5, special:['radar']` |
| dorm | `beds:300, quality:2` |
| res_tower | `beds:900, quality:3, landmark:2` |
| greek_house | `beds:80, quality:3, happiness:{value:3, radius:6}, gatorAttract:2, special:['porch','tailgate']` |
| dining_hall | `feeds:1200, diningRadius:10, happiness:{value:3, radius:10}, gatorAttract:2, special:['boilPot','dumpster']` |
| poboy | `feeds:200, diningRadius:5, happiness:{value:2, radius:5}, revenueMonthly:2000` |
| practice_field | `teamRating:5, attendanceSeats:0` (tier 1 seats 6000 via `tiers`) |
| stadium | `landmark:4, shelter:5000, attendanceSeats:15000, tickets:0` (tier values via `tiers`) |
| union | `happiness:{value:8, radius:12}, feeds:400, shelter:2000, special:['festivalHost','idleHub']` |
| rec_center | `happiness:{value:6, radius:10}, heat:{mult:0.5, radius:10}, shelter:1000, special:['pool','teamHeatFix']` |
| health_center | `illness:{mosquito:0.6, heat:0.5, radius:12}` |
| quad | `happiness:{value:2, radius:6}, special:['idleSpot','oakDecal']` (stacks to +6: buildings caps quad aura at 6) |
| parking | `parkingPer:600, tickets:4000, special:['floodsAt03','tailgateLot']` |
| levee | `crest:6, ecologyPerTile:-0.2, surfaceId:0` |
| floodwall | `crest:12, ecologyPerTile:-0.2, happiness:{value:-1, radius:3}, special:['nutriaImmune']` |
| canal | `canal:true, ecologyPerTile:-0.3` |
| pump | `pumpTileFt:15, subsidenceMult:0, subsidenceRadius:8, noise:{value:2, radius:4}` (subsidence +0.06 within 8 lives in `params.subsidence.pumpAdd`) |
| pond | `pondCapacity:20, mosquito:{mult:0.2, radius:4, stacksTo:0}, happiness:{value:2, radius:6}, special:['egret','stockAfter10']` |
| pilings | (all zero) |
| gator_fence | `surfaceId:4, special:['gatorBlock']` |
| abatement | `mosquito:{mult:0.3, radius:8, stacksTo:0}, special:['fogger']` |
| bat_house | `mosquito:{mult:0.7, radius:4, stacksTo:0.4}, ecology:0.5, special:['martins']` |
| wildlife_post | `ecology:3, special:['officer','traps','debris','cajunNavy']` |
| preserve | `ecologyPerTile:0.5, special:['preserve']` |
| live_oak | `happiness:{value:1, radius:4}, heat:{mult:0.7, radius:3}, windShield:{mult:0.7, radius:2}, ecology:0.3` |
| cypress | `ecology:0.5, drainPerDay:0.05, subsidenceMult:0.5, subsidenceRadius:1` |
| azalea | `happiness:{value:1, radius:3}, special:['bloom']` |
| bell_tower | `landmark:10, happiness:{value:3, radius:0}, flatTimer:'bellTower', special:['bells','beacon']` |
| tiger_habitat | `landmark:8, happiness:{value:5, radius:15}, homeWinBonus:0.05, gatorAvoidRadius:10, special:['tank','habitat']` |
| surge_barrier | `gate:true, ecology:-10, happiness:{value:-2, radius:4}, flatTimer:'surgeBarrier', noise:{value:2, radius:4}` |
| marsh_restoration | `special:['restore']` (the +15×tiles/40 is applied by buildings on completion; coastal ×1.25 is read by economy via `buildings.has('marsh_restoration')`) |
| rookery | `landmark:6, happiness:{value:2, radius:8}, special:['spoonbills','postcardFrame']` (+1 prestige target: economy adds 1 to `targets.prestige` while it exists) |

Mosquito `mult` is the **multiplier applied to density** (0.2 = −80%). `heat.mult` likewise (0.7 = −30%). `windShield.mult 0.7` = −30% wind damage.

### 4.3 Other tables (ARCHITECTURE §4.2; GDD §14)

- [ ] `tabs`: `[{id:'essentials', name:'Essentials', rows:[path, dorm, dining_hall, lecture_hall, poboy, quad, live_oak]}, paths, utilities, academic, housing, dining, sports, life, swamp, grounds]` with `rows` in `n` order; `founders_hall` appears in **no** tab (it is placed by Objective 1 / skipTutorial only).
- [ ] `decals` (≥ 36 entries): `clock, columns, arcade, awning, sign, vents, tank, masts, stilts, scaffold, tarp, boilpot, dumpster, cars, pool, dome, dish, pipes, impeller, fountain, reeds, flag, banner, lights, letters, gourds, truck, airboat, bleachers, goalposts, beacon` (the GDD's ~30) plus `plywood, burrow, nest, lookout, couch, crane, jumbotron`. Each `{w, h, anchor, frames}` in 1× px; `anchor` ∈ `roof|ground|side`; `frames` ≥ 1 (e.g. `dish` 2, `impeller` 2, `crane` 4, `boilpot` 1 (smoke is particles)).
- [ ] `names`: `halls` = the 20 in §14.2 in order; `towers` = `['Pontchartrain Tower','Delacroix Tower']`; `dining` = the 5; `poboy` = the 6; `greek` = the 5; `library`, `union`, `engineering`, `institute`, `bellTower` = 1 each; `stadium` = `['Bayou Field','Red Stick Stadium','The Cauldron','Cauldron Grand']`; `leveeRun` = `['The Great Wall of Boudreaux']`.
- [ ] `students`: `firstCajun` (the 56 names of §14.1, first list), `firstModern` (24), `last` (54), `nicknames` (16, without the surrounding quotes), `majors` (14), `hometowns` (18, the last one is the joke string verbatim), `quotes` (author 12 in voice; include "Class was underwater again." and "The AC works. That's the bar."), `modernShare: 0.25`, `nicknameShare: 0.12`.
- [ ] `coaches`: the 10 `{name, rep}` pairs of §14.1 in order (Bobby Cheramie first; `rep` without quotes); `coachQuotes`: 12 lines including "We don't rebuild. We re-grade."
- [ ] `gatorNames`: the 14 of §14 (Big Al … Praline) in order; `leGrand: 'Le Grand'`.
- [ ] `stormNames`: the 26 of §6.2 in order, `Amélie … Zéphyrine`, accents intact.
- [ ] `opponents` keyed `magnolia, crescent, delta, gulfcoast, atchafalaya, pineywoods, sabine, vermilion, redstick` with `name`/`nick`/`rating` from §8 (78, 70, 62, 58, 55, 52, 45, 40, 35); `rival: true` on `magnolia` only; `crosstown: true` on `redstick` only; `colors`: magnolia `['#1E7B3C','#FFFFFF']`, author the rest (two hexes each).
- [ ] `schedule`: the 8 entries of ARCHITECTURE §4.2 with `kind` filled (`regular` unless homecoming/rivalry/bowl). `date` strings are `'Mon D'`.
- [ ] `calendar.dates`: exactly the map in ARCHITECTURE §4.2 (`'Jan 1': ['newYear','subsidence','foundersDay']` … `'Dec 11': ['break']`). `calendar.festivals`: `[{id:'mardiGras', start:'Feb 6', end:'Feb 8', text}, {id:'crawfish', start:'Mar 1', end:'Apr 10', text}, {id:'graduation', start:'May 5', end:'May 5', text}, {id:'homecoming', start:'Oct 7', end:'Oct 8', text}, {id:'firstNightGame', start:'', end:'', text}, {id:'leveeBonfires', start:'Dec 9', end:'Dec 9', text}, {id:'foundersDay', start:'Jan 1', end:'Jan 1', text}]` with `text` = the §14.3 copy verbatim (the Mardi Gras entry's `text` is the first quoted sentence block only; the route rule is code).
- [ ] `ticker`: the 62 lines of §14.4 verbatim, index 0 = line 1, `{}` fields kept as written (`{n}`, `{cars}`, `{hi}`, `{opp}`, `{gator}`, `{hall}`, `{storm}`, `{w}`, `{l}`, `{family}`, `{x}`, `{y}`, `{pos}`, `{name}`, `{hometown}`, `{stat}`, `{coach}`). `tickerKinds`: line number → kind: `water` 17,18,22,26,48; `wildlife` 1,4,6,13,21,24,28,29,32,35,37,50,57; `money` 5,23,36,52,55; `danger` 3,16,39,45,54,58; `sports` 7,19,20,42,43,44,46,49,60,61; `event` 2,8,9,11,12,14,15,25,30,31,33,34,38,40,41,47,53,56,59,62; `info` 10,27,51.
- [ ] `objectives`: ids `'1'…'22'`, `'11a'`, `'18a'`, `'18b'` (25 entries). `kind`: `BSU.OBJ.INTERRUPT` for 1–7, 9–14, 16, `'11a'`; `BACKGROUND` for 8, 15, 17, `'18a'`, `'18b'`, 18, 19–22. `reward`: `{grant:50000}` for 1–7, 9, 10, 11; `{prestige:2}` for every other id. `title` = the bold name in §10.2 (e.g. `'Hold the line'`), `text` ≤ 12 words (e.g. `'Close the cove mouth with a Levee. Put a Pump inside.'`), `teaches` = the last column, `showMe` ∈ `plot|cove|landing|crown|ring|target` (1 `plot`, 2 `landing`, 4 `cove`, 5 `crown`, 8 `crown`, 11–12 `ring`, others `target`), `deadlineText` (`'by Aug 5'` for 8, `'6 days'` for 12, `''` otherwise). Objective 8's alternate text `'Capped at {students} — beds are the bottleneck'` goes in `objectives['8'].cappedText`.
- [ ] `milestones`: 26 entries in `BSU.MILESTONES` order with `id` = the camelCase key (`chartered, welcome, cajunEngineer, firstBell, wetFeet, highAndDry, stormChaser, eyeOfTheStorm, gatorWrangler, sunbather, skeeterBeater, bayouField, nightFalls, geauxBeatMagnolia, undefeated, bigBoil, throwMeSomethin, greenAndGold, fortressBayou, livingWithWater, lightsAreOn, sinkingFeeling, rebuiltFromTheRoux, flagship, laissez, untouched`), `name` = the bold name, `text` = the Condition column, `reward` = `{cash: 50000}` (3), `{prestige: 2}` (4, 6, 11), `{effect: 'pilingsDiscount'}` (5), `{cash: 100000}` (7), `{prestige: 5}` (8), `{effect: 'postUpkeepHalf'}` (9), `{effect: 'sunbather'}` (10), `{}` (12), `{effect: 'goldRing'}` (13), `{prestige: 3}` (14, 19, 20), `{prestige: 5, effect: 'undefeatedDonations'}` (15), `{effect: 'bigBoil'}` (16), `{cash: 50000}` (17), `{effect: 'researchBonus'}` (18), `{}` (21), `{effect: 'pilingsDiscountYear'}` (22), `{cash: 500000}` (23), `{effect: 'titleCampus'}` (24), `{}` (L1, L2).
- [ ] `voiceCards`: the 12 rows of §7.1 in order: `id`, `student` (with nickname in quotes as written), `major`, `text` (the ask, ≤ 12 words), `payoff` (the payoff column in words), `prereq` = the id string (`'boardwalk'`…`'bellSelfie'` — progress implements a check per id).
- [ ] `boardCards`: 8 `{id, name, text, cost, effect}`: `lobby` (−100000, `'stateFunding+10'`), `researchPush` (−200000, `'research×1.5/yr'`), `tuitionFreeze` (0), `recruitingTrip` (−150000), `marshGrant` (+300000 → `cost: -300000`), `summerSession` (0), `insurance` (0, `'2%/yr, pays 50%'`), `homecomingBudget` (0; the $0/$50k/$150k choice is a sub-option). `text` from §5.9 verbatim.
- [ ] `failureCards`: `bankruptcy` `{title: 'The Board has concerns', options: [{id:'austerity', text}, {id:'hike', text}, {id:'naming', text}]}`; `underwater` `{title: 'Semester Cancelled', options: [{id:'ok', text}]}`; `probation` `{title: 'Accreditation Probation', options: [{id:'ok', text}]}` — texts from §10.7.
- [ ] `tutorial`: stages 0–6 `{stage, card, hint}`: 0 title (`card: 'Click to charter the university.'`), 1 charter (`'$4,000,000, one ridge, and a swamp. Build a university. Geaux.'`), 2 Objective 1 (`'Place Founders’ Hall on the ridge.'`, hint `'Cove tiles are too wet.'`), 3 Objective 2 (`'Drag a path from the front door to the Pirogue Landing.'`), 4 arrival + Objective 3 (`'Build a Dorm and a Dining Hall.'`, hint `'Wet ground sinks; +20%.'`), 5 Objectives 4–5 (`'Dig a canal from the low spot to the bayou.'` / `'Keep the lights on: a Substation and a Water Tower.'`), 6 free play (`''`). Every card ≤ 12 words.
- [ ] `thibodeaux`: ≥ 8 speech-bubble lines (one Cajun tic at most per line); `stormQuotes`: ≥ 6 lines including `'We’ve played in worse.'` / `'You have not.'`.
- [ ] `overlays`: `[{ov: BSU.OV.FLOOD, key:'F', name:'Flood Risk', legend:['0 ft','0.3','0.6','1+ ft']}, {WATER,'W','Water',…}, {MOSQUITO,'K','Mosquito', ['Ambient','Annoying','Biblical','State Bird']}, {POWER,'P','Power & Water', …}, {COVERAGE,'C','Coverage', …}, {ECOLOGY,'E','Ecology', …}]`.
- [ ] `keys`: one entry per binding in ARCHITECTURE §7.4 (`' '` pause, `'1'|'2'|'3'` speeds, `b n t l`, `f w k p c e`, `-`, `=`, `Tab`, `Shift+Tab`, `Shift+1…9`, `x r h .`, `Escape`, `Ctrl+s/z/p`, `m`, `y n`, `Backquote`, `w a s d` + arrows for pan). **No key appears twice with the same modifiers** (`ui.selfTest` checks this table). Key names are `KeyboardEvent.key` values (`' '`, `'Escape'`, `'Tab'`, `'ArrowUp'`, `'`'` for Backquote — use `event.code === 'Backquote'` in ui; store `key: '`'`).
- [ ] `rainKinds` exactly as in §1 above.

## 5. Edge cases and invariants

- Deep-freeze must not throw: no typed arrays, no `Map`, no functions inside tables. Freeze after building (`function deepFreeze(o) { for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); } return Object.freeze(o); }`).
- Strings with apostrophes and accents: use `’` or single-quote escaping consistently; the built file is inlined into HTML, so **never** write the string `</script` (write `'<\/script'` if ever needed — it should never be needed here).
- Money is integer dollars. Never store `'$2k'`.
- Every `date` string in `schedule`, `calendar.dates`, `calendar.festivals` (non-empty ones) parses with `BSU.dateToDay(str, 1)`.
- `catalogList.length === 43`, `Object.keys(catalog).length === 43`, every `BSU.B_ORDER[i] === catalogList[i].id`.
- No row may reference a decal that is not in `decals`; no row's `unlock.milestone` may name an id outside `BSU.MILESTONES`; no `unlock.building` may name an id outside `catalog`.
- Headless: nothing special; the file has no environment dependencies.

## 6. selfTest() requirements

`BSU.data.selfTest()` returns `{ok, notes}`; every failure appends to `notes` and sets `ok = false`. It must assert:

1. `catalogList.length === 43` and `catalogList[i].n === i + 1`.
2. For every row and every key in `BSU.catalogRowSchema`: the key exists and `typeof` (or array-ness) matches the schema string; every `effects` key from the schema's effects list exists.
3. Every `id` is in `BSU.B` (`BSU.B[id] === id`) and `BSU.B_ORDER` equals the ids in order.
4. Every decal name in any row's `paint.decals` exists in `decals`.
5. `ticker.length === 62`; every line 1–62 has an entry in `tickerKinds` with a valid kind.
6. Every `date` in `schedule`, `calendar.dates` keys and `festivals[].start/end` (non-empty) satisfies `Number.isInteger(BSU.dateToDay(d, 1))`.
7. `stormNames.length === 26`, `gatorNames.length === 14`, `coaches.length === 10`, `coachQuotes.length === 12`, `names.halls.length === 20`, `voiceCards.length === 12`, `boardCards.length === 8`, `milestones.length === 26` and `milestones.map(m=>m.id)` equals `BSU.MILESTONES`, `objectives` has the 25 ids, `tabs.length === 10`, `Object.keys(opponents).length === 9` with exactly one `rival`.
8. `Object.isFrozen(BSU.data)` and `Object.isFrozen(BSU.data.catalog.dorm.effects)`.
9. `tabs` cover every row except `founders_hall` exactly once outside `essentials`.
10. No duplicate `{key, ctrl, shift}` triple in `keys`.
11. Sanity numbers: `catalog.dorm.cost === 700000`, `catalog.dorm.effects.beds === 300`, `catalog.stadium.tiers.length === 3`, `catalog.levee.effects.crest === 6`, `catalog.floodwall.effects.crest === 12`, `catalog.pump.effects.pumpTileFt === 15`.

Pure, no state, ≤ 50 ms.

## 7. Testing in isolation

```js
// scratch/test_data.mjs — run with: node scratch/test_data.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeWindow } from '../test/domstub.mjs';
const win = makeWindow(); win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
for (const f of ['contract.js', 'data.js'])
  vm.runInContext(readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
const { data } = win.BSU;
console.log(data.selfTest());
console.log(data.catalogList.map(r => `${r.n} ${r.id} ${r.w}x${r.h} $${r.cost}`).join('\n'));
try { data.catalog.dorm.cost = 1; console.log('MUTATION ALLOWED — BAD'); } catch { console.log('frozen ok'); }
```
Also `node --check src/js/data.js` and `node build.mjs --check` (with `contract.js` and `data.js` in `manifest.json`).

## 8. Performance budget

Definition time ≤ 5 ms (object literals only; the deep-freeze walk is a few thousand nodes). File size: the largest text tables are the ticker (62 lines) and names; keep the whole file ≤ 60 KB.

## 9. Done means

- `node --check` passes; loads under `makeWindow()` with only `contract.js` before it; `BSU.data.selfTest().ok === true`.
- All 43 rows, all tables, transcribed exactly; a spot check of 10 random rows against GDD §0.3 finds zero differences.
- `BSU.data` is deep-frozen; no functions or typed arrays inside.
- Every consumer listed in ARCHITECTURE (buildings, economy, sports, progress, ui, sprites) can find every number it needs in `data` without hard-coding: if a later module has to hard-code a §0.3 number, that is a `data.js` bug.
