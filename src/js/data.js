'use strict';
// ============================================================================
// BAYOU STATE — data.js (module 1; immutable tables)
// Owner: nothing at runtime. Assigns BSU.data: the 43-row building catalog,
// tabs, decals, name pools, students/coaches/gators/storms, opponents and the
// schedule, the calendar, the 62 ticker lines, objectives, milestones, Student
// Voice and Board cards, failure cards, the tutorial script, overlays, the key
// map and the rain kinds. Deep-frozen after definition. No init/reset/tick.
// Implements: ARCHITECTURE.md §4 (all); GDD §0.3, §4, §5.9, §6.2, §7.1, §8,
// §9.2, §10.1–§10.7, §11.2, §11.8, §14 (transcribed verbatim).
// Zero DOM / timer / audio access at definition time. Reads only BSU.
//
// Decisions recorded here (see docs/INTEGRATION_NOTES.md '## data.js'):
//  - tab assignment: rows 1–3 paths; 4–7 utilities; 8–12 academic; 13–15
//    housing; 16–17 dining; 18–19 sports; 20–24 life; 25–35 + 41, 42 swamp;
//    36–40 + 43 grounds. founders_hall is in no tab (Objective 1 places it).
//  - unused effect keys are 0 / false / '' / [] / {…:0} exactly as ARCH §4.1
//    says; consumers gate on `radius > 0` (mult 0 is "unused", not "×0").
//  - allowMarsh is true for every row except `road` (GDD: "not on Marsh").
//  - surge_barrier keeps its §0.3 WR 5 although it is a drag row (it produces
//    a Building struct and takes wind damage); other drag rows are 0 except
//    boardwalk (2, flavor).
//  - keys: one entry per {key, ctrl, shift} triple (ui.selfTest checks this);
//    the toast-capture layer (Y/N/Enter/Esc) and the held pan keys (WASD +
//    arrows) that would collide with `n` (Season) and `w` (Water overlay) are
//    in data.toastKeys / data.panKeys; the arrows and a/s/d are also in keys.
// ============================================================================
(function () {
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const BSU = root.BSU;
  const PLACE = BSU.PLACE, SURF = BSU.SURF, OV = BSU.OV, OBJ = BSU.OBJ;

  // ---------------------------------------------------------------------------
  // Row builders: every schema key present on every row (ARCH §3.6, §4.1)
  // ---------------------------------------------------------------------------
  /** Effects with every key of BSU.catalogRowSchema.effects, defaults = unused. */
  function E(o) {
    const e = {
      seats: 0, beds: 0, quality: 0, feeds: 0, diningRadius: 0,
      happiness: { value: 0, radius: 0 }, flatTimer: '', landmark: 0, shelter: 0,
      power: { radius: 0, capacity: 0 }, water: { radius: 0, capacity: 0 },
      mosquito: { mult: 0, radius: 0, stacksTo: 0 }, heat: { mult: 0, radius: 0 },
      ecology: 0, ecologyPerTile: 0, gatorAttract: 0, research: { kind: '', base: 0 }, academic: 0,
      teamRating: 0, noise: { value: 0, radius: 0 }, windShield: { mult: 0, radius: 0 },
      illness: { mosquito: 0, heat: 0, radius: 0 }, drainPerDay: 0, subsidenceMult: 0, subsidenceRadius: 0,
      pumpTileFt: 0, pondCapacity: 0, fuelDays: 0, crest: 0, surfaceId: 0, canal: false, gate: false,
      capacityStudents: 0, parkingPer: 0, tickets: 0, revenueMonthly: 0, coneDays: 0, coneNarrow: 0,
      ecologyDecayMult: 0, gatorAvoidRadius: 0, homeWinBonus: 0, attendanceSeats: 0, special: []
    };
    if (o) for (const k of Object.keys(o)) e[k] = o[k];
    return e;
  }
  // GDD §4 house style: cream/tan stucco, terracotta hip roof, arcade decal, gold accent.
  const CREAM = '#F5ECD7', TAN = '#E8D9B5', TERRACOTTA = '#B5533C', GOLD = '#FDD023', PURPLE = '#461D7C';
  const HOUSE_WALL = [CREAM, TAN];
  /** Paint descriptor with every key of BSU.catalogRowSchema.paint. */
  function P(o) {
    const p = {
      wall: HOUSE_WALL, roof: 'hip', roofColor: TERRACOTTA, floors: 1, windows: { cols: 0, rows: 0 },
      decals: ['arcade'], accent: GOLD, lift: 0, special: ''
    };
    if (o) for (const k of Object.keys(o)) p[k] = o[k];
    return p;
  }
  /** A non-building paint (drag tools, lawns, trees): no roof, no windows, no arcade. */
  function flat(wall, decals, special) {
    return P({ wall: wall, roof: 'none', roofColor: '', floors: 0, decals: decals || [], special: special || '' });
  }
  const NEEDS_POWER = {
    water_tower: 1, wastewater: 1, founders_hall: 1, lecture_hall: 1, library: 1, engineering: 1, coastal_institute: 1,
    dorm: 1, res_tower: 1, greek_house: 1, dining_hall: 1, poboy: 1, stadium: 1, union: 1, rec_center: 1, health_center: 1,
    bell_tower: 1, tiger_habitat: 1, surge_barrier: 1, marsh_restoration: 1,
    pump: 1   // decision: the Pump "needs ⚡ (stops in blackout)"; one coverage rule for buildings
  };
  const NEEDS_WATER = {
    founders_hall: 1, lecture_hall: 1, library: 1, engineering: 1, coastal_institute: 1, dorm: 1, res_tower: 1,
    greek_house: 1, dining_hall: 1, stadium: 1, union: 1, rec_center: 1, health_center: 1, tiger_habitat: 1
  };
  const PATH_ADJ_ROWS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 28, 32, 34, 39, 40, 42, 43];
  const ESSENTIALS = { path: 1, dorm: 1, dining_hall: 1, lecture_hall: 1, poboy: 1, quad: 1, live_oak: 1 };
  const NOT_DEMOLISHABLE = { founders_hall: 1, library: 1, res_tower: 1, stadium: 1, bell_tower: 1, tiger_habitat: 1, rookery: 1, surge_barrier: 1, marsh_restoration: 1 };
  const TAB_OF_ROW = function (n) {
    if (n <= 3) return 'paths';
    if (n <= 7) return 'utilities';
    if (n <= 12) return 'academic';
    if (n <= 15) return 'housing';
    if (n <= 17) return 'dining';
    if (n <= 19) return 'sports';
    if (n <= 24) return 'life';
    if (n <= 35 || n === 41 || n === 42) return 'swamp';
    return 'grounds';
  };

  /** One plain line per row: what it does (the build menu's first line; GDD §11.2 "say it in one breath"). */
  const BLURB = {
    path: 'A gravel walkway. Every building needs one on its edge.',
    road: 'A paved road for buses, parades and the Stadium; bridges up to 3 water tiles.',
    boardwalk: 'A raised walk over marsh and water that leaves the wetland alone.',
    substation: 'Powers up to 40 buildings within 10 tiles.',
    water_tower: 'Water for 50 buildings within 12 tiles. Needs power itself.',
    generator: 'Three days of backup power for everything within 6 tiles.',
    wastewater: 'Sewage for 6,000 students. Needs a road within 4 and water nearby.',
    founders_hall: '300 seats, shelter for 300, and the root of every path on campus.',
    lecture_hall: '400 lecture seats.',
    library: 'Academic +20, landmark +4, +4 happiness within 10 tiles; shelters 800.',
    engineering: '500 seats, academic +20, $12k/mo research grants; swamp works cost 15% less.',
    coastal_institute: '150 seats, academic +20, coastal research, and a 9-day storm cone.',
    dorm: '300 beds for first-years.',
    res_tower: '900 beds on one 3×3 footprint; landmark +2.',
    greek_house: '80 beds, +3 happiness within 6 tiles, and a tailgate scene.',
    dining_hall: 'Feeds 1,200 students within 10 tiles; +3 happiness nearby.',
    poboy: 'Feeds 200 on the walk to class; +2 happiness within 5; earns $2k/mo.',
    practice_field: 'Fields a football team (rating +5). Upgrade to Bayou Field for 6,000 seats and home games.',
    stadium: '15,000 seats and ticket money. Grows to 45,000 under the lights, then 80,000.',
    union: '+8 happiness within 12 tiles, feeds 400, hosts the Crawfish Boil; shelters 2,000.',
    rec_center: '+6 happiness within 10 tiles; a pool that halves the heat penalty nearby.',
    health_center: 'Mosquito illness −60% and heat illness −50% within 12 tiles.',
    quad: '+2 happiness within 6 tiles and a free Live Oak. No path needed.',
    parking: 'Parks 600 students’ cars; +$4k/mo in tickets. Needs a road within 4.',
    levee: 'A 6-foot earthen wall against rising water. Walkable.',
    floodwall: 'A 12-foot concrete wall. Nutria-proof; −1 happiness within 3.',
    canal: 'A ditch that carries rainwater downhill to the bayou.',
    pump: 'Pumps 15 tile-ft a day out of its canal network. Needs power.',
    pond: 'Holds 20 tile-ft of runoff; once stocked, mosquitoes −80% within 4.',
    pilings: 'Lifts one building 3 ft above the flood line (+40% of its cost).',
    gator_fence: 'A fence gators cannot cross. Students walk right through.',
    abatement: 'A fogger truck: mosquitoes −70% along paths within 8. Costs ecology.',
    bat_house: 'Bats and martins: mosquitoes −30% within 4 (stacks to −60%); +0.5 ecology.',
    wildlife_post: 'An officer who relocates gators within 14, stops nutria and clears debris; +3 ecology.',
    preserve: 'Protects a tile as wetland: +0.5 ecology each, and it slows the surge.',
    live_oak: '+1 happiness within 4; shade cuts heat −30%; wind damage −30% within 2.',
    cypress: 'Roots drink 0.05 ft of water a day and halve sinking next door; +0.5 ecology.',
    azalea: '+1 happiness within 3; +1 more while it blooms in March.',
    bell_tower: 'Landmark +10 and +3 happiness campus-wide; bells at midday and dusk.',
    tiger_habitat: 'Landmark +8, +5 happiness within 15, home win +5%; gators stay 10 tiles away.',
    surge_barrier: 'A gate that closes the bayou when the stage passes 2 ft. Needs 2 powered Pumps.',
    marsh_restoration: 'Turns 10–40 tiles back into marsh over 30 days; up to +15 ecology.',
    rookery: 'Landmark +6, +2 happiness within 8, and spoonbills every dawn.'
  };

  /** One catalog row; fills every §4.1 field from the row-number rules, then applies overrides. */
  function row(o) {
    const n = o.n, id = BSU.B_ORDER[n - 1];
    const kind = o.kind || 'footprint';
    const w = o.w === undefined ? 1 : o.w, h = o.h === undefined ? 1 : o.h;
    const r = {
      id: id, n: n, name: o.name, tab: TAB_OF_ROW(n), essentials: !!ESSENTIALS[id], kind: kind,
      w: w, h: h, rotatable: w !== h, cost: o.cost, upkeep: o.upkeep, wr: o.wr || 0,
      needsPower: !!NEEDS_POWER[id], needsWater: !!NEEDS_WATER[id],
      pathAdjacency: PATH_ADJ_ROWS.indexOf(n) >= 0, roadWithin: o.roadWithin || 0,
      placeRule: o.placeRule === undefined ? PLACE.LAND : o.placeRule,
      allowMarsh: id !== 'road', alwaysPilings: !!o.alwaysPilings,
      buildDays: kind === 'footprint' ? 1 + Math.floor(w * h / 6) : (kind === 'upgrade' ? 1 : 0),
      unlock: o.unlock || {}, pip: o.pip || '', effects: E(o.effects), tiers: o.tiers || [], paint: o.paint,
      namePool: o.namePool || '', why: o.why, desc: o.desc, blurb: BLURB[id] || '',
      demolishable: !NOT_DEMOLISHABLE[id], shelterOwn: id === 'dorm' || id === 'res_tower'
    };
    return r;
  }

  // ---------------------------------------------------------------------------
  // The 43 rows (GDD §0.3; visuals GDD §4; unlock/pip GDD §10.6)
  // ---------------------------------------------------------------------------
  const catalogList = [
    row({ n: 1, name: 'Gravel Path', kind: 'drag', cost: 2000, upkeep: 0, placeRule: PLACE.PATH,
      effects: { surfaceId: SURF.PATH },
      paint: flat(['#C9B47C', '#B8A36B']),
      why: 'Students walk on paths. A building with no path on its edge is unreachable.',
      desc: 'Walkable at 4 tiles/s; the required adjacency; wading at 0.3 ft, impassable at 0.6 ft.' }),
    row({ n: 2, name: 'Campus Road', kind: 'drag', cost: 10000, upkeep: 100, placeRule: PLACE.ROAD,
      effects: { surfaceId: SURF.ROAD, noise: { value: 1, radius: 1 } },
      paint: flat(['#3A3A40', '#2E2E34'], ['lights']),
      why: 'Roads carry buses, parades and the Stadium. Dorms next door hear them.',
      desc: 'Walkable + vehicles; bridges water up to 3 tiles at ×4; −1 happiness to adjacent dorms.' }),
    row({ n: 3, name: 'Boardwalk', kind: 'drag', cost: 14000, upkeep: 150, wr: 2, placeRule: PLACE.BOARDWALK,
      effects: { surfaceId: SURF.BOARDWALK },
      paint: flat(['#8B7355', '#6F5A42'], ['stilts']),
      why: 'The marsh stays marsh under a boardwalk. Nothing drains, nothing drowns.',
      desc: 'Walkable over Marsh, Preserve or water; no draining, no ecology loss; WR 2.' }),
    row({ n: 4, name: 'Power Substation', w: 2, h: 2, cost: 250000, upkeep: 4000, wr: 2,
      effects: { power: { radius: 10, capacity: 40 } },
      paint: P({ wall: ['#9A9A9E', '#7E7E82'], roof: 'flat', roofColor: '#8A8A8E', decals: ['pipes', 'beacon'], special: 'substation' }),
      why: 'Unpowered buildings run at half. Keep it above the water line.',
      desc: 'Power radius 10 for 40 buildings; summer draw ×1.5; blackout at 0.3 ft of water.' }),
    row({ n: 5, name: 'Water Tower', w: 2, h: 2, cost: 220000, upkeep: 2000, wr: 2,
      effects: { water: { radius: 12, capacity: 50 } },
      paint: P({ wall: ['#5E2CA5', PURPLE], roof: 'dome', roofColor: PURPLE, floors: 0, decals: ['beacon'], special: 'water_tower' }),   // the special painter letters the tank itself; DECALS.letters spells the stadium's CAULDRON
      why: 'No water, no showers, no students. Brace it before a Cat 4.',
      desc: 'Water radius 12 for 50 buildings; flooded or unpowered → Boil-Water Advisory.' }),
    row({ n: 6, name: 'Backup Generator', cost: 60000, upkeep: 500, wr: 3,
      effects: { fuelDays: 3, power: { radius: 6, capacity: 0 } },
      paint: P({ wall: ['#F5B700', '#B58500'], roof: 'flat', roofColor: '#B58500', decals: ['vents'], special: 'generator' }),
      why: 'Three fuel days between you and a dark campus.',
      desc: 'Keeps radius 6 powered through a blackout; 3 fuel days; refuel +3 for $5k; +$2k/day running.' }),
    row({ n: 7, name: 'Wastewater Plant', w: 3, h: 3, cost: 400000, upkeep: 6000, wr: 3, roadWithin: 4, placeRule: PLACE.NEAR_WATER,
      unlock: { students: 1000 },
      effects: { capacityStudents: 6000, ecology: 0, special: ['wastewater'] },
      paint: P({ wall: ['#B8B0A0', '#9A9284'], roof: 'flat', roofColor: '#8A8A8E', windows: { cols: 2, rows: 1 }, decals: ['tank', 'vents'], special: 'wastewater' }),
      why: 'Past 1,500 students the campus smells like a boil gone wrong.',
      desc: 'Serves 6,000 students; within 3 of water and a Road within 4; −5 ecology once on Marsh.' }),
    row({ n: 8, name: "Founders' Hall", w: 3, h: 3, cost: 0, upkeep: 8000, wr: 4,
      effects: { seats: 300, landmark: 2, shelter: 300, academic: 0 },
      paint: P({ floors: 2, windows: { cols: 5, rows: 2 }, decals: ['columns', 'clock', 'flag'] }),
      why: 'Where it started. It cannot fall, and it cannot be demolished.',
      desc: '300 seats; landmark +2; shelter 300 (600 in a declared emergency); root of the access network.' }),
    row({ n: 9, name: 'Lecture Hall', w: 3, h: 2, cost: 600000, upkeep: 10000, wr: 3,
      effects: { seats: 400 },
      paint: P({ wall: ['#C9A97A', '#B08D5E'], floors: 2, windows: { cols: 5, rows: 2 }, decals: ['awning'], accent: PURPLE }),
      namePool: 'halls',
      why: 'Seats cap enrollment just like beds do. More seats, more tuition.',
      desc: '400 seats.' }),
    row({ n: 10, name: 'Library', w: 4, h: 3, cost: 1800000, upkeep: 14000, wr: 4,
      unlock: { students: 800 },
      effects: { academic: 20, landmark: 4, happiness: { value: 4, radius: 10 }, shelter: 800 },
      paint: P({ floors: 2, windows: { cols: 6, rows: 2 }, decals: ['arcade', 'dome', 'lights'] }),
      namePool: 'library',
      why: 'Prestige lives here, and so do the finals-week crowds.',
      desc: 'Academic +20; landmark +4; +4 happiness radius 10; finals hub; shelter 800.' }),
    row({ n: 11, name: 'Engineering Hall', w: 4, h: 3, cost: 2600000, upkeep: 30000, wr: 4,
      unlock: { students: 1500 },
      effects: { seats: 500, academic: 20, research: { kind: 'engineering', base: 12000 }, shelter: 800, special: ['discountSwamp'] },
      paint: P({ wall: ['#8A8A8E', '#6E6E72'], roof: 'flat', roofColor: '#6E6E72', floors: 3, windows: { cols: 6, rows: 3 }, decals: ['pipes', 'crane'] }),
      namePool: 'engineering',
      why: 'The engineers designed it themselves. Levees get cheaper the day it opens.',
      desc: '500 seats; academic +20; research $12k/mo; levees, floodwalls, canals, pumps −15%; shelter 800.' }),
    row({ n: 12, name: 'Coastal Studies Institute', w: 3, h: 3, cost: 2200000, upkeep: 24000, wr: 3, placeRule: PLACE.TOUCH_MARSH_BAYOU, alwaysPilings: true,
      unlock: { students: 1200, ecology: 40 },
      effects: { seats: 150, academic: 20, research: { kind: 'coastal', base: 10000 }, coneDays: 9, coneNarrow: 0.3, ecologyDecayMult: 0.5, special: ['radar'] },
      paint: P({ roof: 'gable', roofColor: '#3F5E3A', floors: 2, windows: { cols: 4, rows: 2 }, decals: ['stilts', 'dish', 'airboat'], special: 'coastal_institute' }),
      namePool: 'institute',
      why: 'A longer warning and a narrower cone, paid for by keeping the marsh.',
      desc: '150 seats; academic +20; research scales with ecology; cone at T−9, 30% narrower; ecology decay −50%.' }),
    row({ n: 13, name: 'Freshman Dorm', w: 3, h: 2, cost: 700000, upkeep: 9000, wr: 3,
      effects: { beds: 300, quality: 2 },
      paint: P({ wall: ['#B87A5A', '#96604A'], floors: 4, windows: { cols: 6, rows: 4 }, decals: ['couch'], accent: PURPLE }),
      namePool: 'halls',
      why: 'Nobody enrolls without a bed. Beds are your enrollment ceiling.',
      desc: '300 beds; quality 2; shelters its own residents on ≥ 5-ft ground or Pilings.' }),
    row({ n: 14, name: 'Residence Tower', w: 3, h: 3, cost: 2400000, upkeep: 22000, wr: 4,
      unlock: { students: 1500 },
      effects: { beds: 900, quality: 3, landmark: 2 },
      paint: P({ floors: 12, windows: { cols: 4, rows: 12 }, decals: ['tank', 'lights'] }),
      namePool: 'towers',
      why: 'Nine hundred beds on one footprint. The ridge is small.',
      desc: '900 beds; quality 3; landmark +2; shelters its own residents on ≥ 5 ft or Pilings.' }),
    row({ n: 15, name: 'Greek Row House', w: 2, h: 2, cost: 350000, upkeep: 5000, wr: 2,
      unlock: { students: 600 },
      effects: { beds: 80, quality: 3, happiness: { value: 3, radius: 6 }, gatorAttract: 2, special: ['porch', 'tailgate'] },
      paint: P({ wall: ['#FFFFFF', '#EDEDED'], floors: 2, windows: { cols: 3, rows: 2 }, decals: ['columns', 'letters', 'lights'], special: 'greek_house' }),
      namePool: 'greek',
      why: 'Tailgates, porches, and the gators that love both.',
      desc: '80 beds; quality 3; +3 happiness radius 6; tailgate +50% within 8 of the venue; gator attraction +2.' }),
    row({ n: 16, name: 'Dining Hall', w: 3, h: 2, cost: 500000, upkeep: 8000, wr: 3,
      effects: { feeds: 1200, diningRadius: 10, happiness: { value: 3, radius: 10 }, gatorAttract: 2, special: ['boilPot', 'dumpster'] },
      paint: P({ floors: 1, windows: { cols: 6, rows: 1 }, decals: ['vents', 'boilpot', 'dumpster'] }),
      namePool: 'dining',
      why: 'Hungry students leave. Dining is the third enrollment ceiling.',
      desc: 'Feeds 1,200; dining radius 10; +3 happiness radius 10; gator attraction +2 (dumpster).' }),
    row({ n: 17, name: "Po'boy Shack", cost: 60000, upkeep: 1000, wr: 1,
      effects: { feeds: 200, diningRadius: 5, happiness: { value: 2, radius: 5 }, revenueMonthly: 2000 },
      paint: P({ wall: ['#C9B47C', '#A8925C'], roof: 'gable', roofColor: '#8A8A8E', windows: { cols: 1, rows: 1 }, decals: ['sign'], special: 'poboy' }),
      namePool: 'poboy',
      why: 'Dressed, pressed, and on the way to class.',
      desc: 'Feeds 200; dining radius 5; +2 happiness radius 5 (walk-by only); +$2k/mo.' }),
    row({ n: 18, name: 'Practice Field', w: 4, h: 3, cost: 200000, upkeep: 3000, wr: 1,
      unlock: { students: 400 },
      effects: { teamRating: 5, attendanceSeats: 0 },
      tiers: [{ tier: 1, name: 'Bayou Field', cost: 600000, upkeep: 4000, seats: 6000, landmark: 1, shelter: 0, wr: 1, night: false, unlock: { students: 400 }, buildDays: 6 }],
      paint: flat(['#6E8F3C', '#5A7A2E'], ['goalposts', 'bleachers', 'banner'], 'practice_field'),
      why: 'A team needs a field. A home game needs the bleachers.',
      desc: 'Team rating +5; enables a team; Bayou Field tier adds 6,000 seats and home games.' }),
    row({ n: 19, name: 'Stadium', w: 6, h: 5, cost: 2000000, upkeep: 30000, wr: 3, roadWithin: 4,
      unlock: { students: 600, building: 'practice_field', tier: 1 },
      effects: { landmark: 4, shelter: 5000, attendanceSeats: 15000, tickets: 0 },
      tiers: [
        { tier: 1, name: 'Red Stick Stadium', cost: 2000000, upkeep: 30000, seats: 15000, landmark: 4, shelter: 5000, wr: 3, night: false, unlock: { students: 600, building: 'practice_field', tier: 1 }, buildDays: 6 },
        { tier: 2, name: 'The Cauldron', cost: 8000000, upkeep: 80000, seats: 45000, landmark: 10, shelter: 15000, wr: 4, night: true, unlock: { students: 1500 }, buildDays: 6 },
        { tier: 3, name: 'Cauldron Grand', cost: 32000000, upkeep: 180000, seats: 80000, landmark: 18, shelter: 25000, wr: 5, night: true, unlock: { students: 8000, prestige: 50 }, buildDays: 6 }
      ],
      paint: P({ wall: ['#B8B0A0', '#8A8A8E'], roof: 'bowl', roofColor: PURPLE, floors: 3, decals: ['masts', 'letters', 'jumbotron'], special: 'stadium' }),
      namePool: 'stadium',
      why: 'Fifteen thousand seats, then forty-five, then eighty. Fill them.',
      desc: 'I: 15,000 seats, landmark +4, shelter 5,000. II: 45,000, night games. III: 80,000, fireworks, opponent −5.' }),
    row({ n: 20, name: 'Student Union', w: 4, h: 3, cost: 1600000, upkeep: 15000, wr: 3,
      unlock: { students: 600 },
      effects: { happiness: { value: 8, radius: 12 }, feeds: 400, shelter: 2000, special: ['festivalHost', 'idleHub'] },
      paint: P({ floors: 2, windows: { cols: 6, rows: 2 }, decals: ['arcade', 'banner', 'fountain'] }),
      namePool: 'union',
      why: 'Where the campus idles, eats, and throws the Crawfish Boil.',
      desc: '+8 happiness radius 12; idle hub; feeds 400; festival revenue ×2; shelter 2,000.' }),
    row({ n: 21, name: 'Rec Center', w: 3, h: 3, cost: 1200000, upkeep: 12000, wr: 3,
      unlock: { students: 800 },
      effects: { happiness: { value: 6, radius: 10 }, heat: { mult: 0.5, radius: 10 }, shelter: 1000, special: ['pool', 'teamHeatFix'] },
      paint: P({ roof: 'barrel', floors: 1, windows: { cols: 4, rows: 1 }, decals: ['arcade', 'pool'] }),
      why: 'A pool in August is the difference between a team and a heat stroke.',
      desc: '+6 happiness radius 10; heat penalty −50% radius 10; fixes the team heat penalty; shelter 1,000.' }),
    row({ n: 22, name: 'Health Center', w: 2, h: 2, cost: 450000, upkeep: 6000, wr: 3,
      unlock: { students: 400 },
      effects: { illness: { mosquito: 0.6, heat: 0.5, radius: 12 } },
      paint: P({ wall: ['#FFFFFF', '#EDEDED'], floors: 1, windows: { cols: 3, rows: 1 }, decals: ['arcade', 'sign'] }),
      why: 'Sick students skip class. Skipped class is lost tuition.',
      desc: 'Mosquito illness −60% and heat illness −50% within 12.' }),
    row({ n: 23, name: 'Quad Lawn', w: 2, h: 2, cost: 30000, upkeep: 300,
      effects: { happiness: { value: 2, radius: 6 }, special: ['idleSpot', 'oakDecal'] },
      paint: flat(['#6E8F3C', '#7FA347'], [], 'quad'),
      why: 'A lawn, an oak, and somewhere to sit between classes.',
      desc: '+2 happiness radius 6 (stacks to +6); idle spot; plants one Live Oak; no path needed.' }),
    row({ n: 24, name: 'Parking Lot', w: 3, h: 2, cost: 150000, upkeep: 1500, wr: 1, roadWithin: 4,
      effects: { parkingPer: 600, tickets: 4000, special: ['floodsAt03', 'tailgateLot'] },
      paint: flat(['#3A3A40', '#2E2E34'], ['cars'], 'parking'),
      why: 'One lot per 600 students, or they complain. Floods at 0.3 ft.',
      desc: '1 per 600 students (else −4 happiness); tickets +$4k/mo; tailgate lot; floods at 0.3 ft.' }),
    row({ n: 25, name: 'Earthen Levee', kind: 'drag', cost: 35000, upkeep: 400, placeRule: PLACE.LEVEE, pip: 'season',
      effects: { crest: 6, ecologyPerTile: -0.2, surfaceId: 0 },
      paint: flat(['#6E8F3C', '#4A3B2A'], ['burrow']),
      why: 'Six feet of dirt between the cove and the Gulf.',
      desc: 'Crest = elev + 6 ft; integrity 100; repair $5k/tile; walkable; −0.2 ecology/tile on Marsh.' }),
    row({ n: 26, name: 'Concrete Floodwall', kind: 'drag', cost: 110000, upkeep: 900, placeRule: PLACE.LEVEE,
      unlock: { any: [{ building: 'engineering' }, { students: 2000 }] },
      effects: { crest: 12, ecologyPerTile: -0.2, happiness: { value: -1, radius: 3 }, special: ['nutriaImmune'] },
      paint: flat(['#9A9A9E', '#7E7E82']),
      why: 'Twelve feet of concrete. Nutria-proof, and nobody likes the view.',
      desc: 'Crest = elev + 12 ft; nutria-immune; −1 happiness within 3 unless a Live Oak is adjacent.' }),
    row({ n: 27, name: 'Drainage Canal', kind: 'drag', cost: 25000, upkeep: 500, placeRule: PLACE.CANAL, pip: 'cell',
      effects: { canal: true, ecologyPerTile: -0.3 },
      paint: flat(['#8A8A8E', '#1B3A3A'], ['pipes']),
      why: 'Rain pools in the low spots. A canal sends it to the bayou.',
      desc: 'Bed cut 2 ft; conductance ×8; drains by gravity to Bayou or Water, else needs a Pump.' }),
    row({ n: 28, name: 'Pump Station', w: 2, h: 2, cost: 500000, upkeep: 8000, wr: 3, placeRule: PLACE.TOUCH_CANAL_WATER, pip: 'season',
      effects: { pumpTileFt: 15, subsidenceMult: 0, subsidenceRadius: 8, noise: { value: 2, radius: 4 } },
      paint: P({ wall: ['#3F7A3A', '#2E5C2A'], roof: 'gable', roofColor: '#2E5C2A', windows: { cols: 1, rows: 1 }, decals: ['pipes', 'impeller'] }),
      why: 'A levee keeps water out. A pump gets it out. You need both.',
      desc: 'Removes 15 tile-ft/day from its canal network; needs power; +$3k while running; subsidence +0.06/yr within 8.' }),
    row({ n: 29, name: 'Retention Pond', w: 2, h: 2, cost: 120000, upkeep: 1000, pip: 'mosquito',
      effects: { pondCapacity: 20, mosquito: { mult: 0.2, radius: 4, stacksTo: 0 }, happiness: { value: 2, radius: 6 }, special: ['egret', 'stockAfter10'] },
      paint: flat(['#6FA895', '#2E6B5E'], ['reeds'], 'pond'),
      why: 'Standing water that works for you, once the bream move in.',
      desc: 'Tiles cut −3 ft; 20 tile-ft sink; stocked after a month → mosquito −80% within 4; +2 happiness radius 6.' }),
    row({ n: 30, name: 'Pilings', kind: 'upgrade', cost: 0, upkeep: 0, placeRule: PLACE.UPGRADE,
      effects: {},
      paint: flat(['#3A2A1E', '#2A1E14'], ['stilts']),
      why: 'Pilings: the marsh keeps the marsh, you keep the building',
      desc: 'Building ignores depth < 3 ft; no subsidence; allowed on Marsh; +40% cost, +5% upkeep; 1-day retrofit.' }),
    row({ n: 31, name: 'Gator Fence', kind: 'drag', cost: 8000, upkeep: 80, placeRule: PLACE.FENCE, pip: 'gator',
      effects: { surfaceId: SURF.FENCE, special: ['gatorBlock'] },
      paint: flat(['#9A9A9E', GOLD], ['sign']),
      why: 'Gators cannot cross it. Students can. Everyone is happier.',
      desc: 'Blocks gators and nutria; students pass; Cat 3+ breaks 30% of segments.' }),
    row({ n: 32, name: 'Mosquito Abatement Station', cost: 90000, upkeep: 2500, wr: 2, pip: 'mosquito',
      effects: { mosquito: { mult: 0.3, radius: 8, stacksTo: 0 }, special: ['fogger'] },
      paint: P({ wall: ['#5E2CA5', PURPLE], roof: 'gable', roofColor: PURPLE, windows: { cols: 1, rows: 1 }, decals: ['truck'], special: 'abatement' }),
      why: 'Rich and lazy: the fogger works, and the marsh pays for it.',
      desc: 'Fogger patrols paths within 8 at Dusk: mosquito −70%; ecology −0.5/mo while on.' }),
    row({ n: 33, name: 'Bat House / Purple Martin Tower', cost: 12000, upkeep: 100, wr: 1, pip: 'mosquito',
      effects: { mosquito: { mult: 0.7, radius: 4, stacksTo: 0.4 }, ecology: 0.5, special: ['martins'] },
      paint: flat(['#3A2A1E', '#2A1E14'], ['gourds'], 'bat_house'),
      why: 'Cheap, ecological, and the bats do the work.',
      desc: 'Mosquito −30% radius 4 (stacks to −60%); +0.5 ecology; martins swirl at Dusk.' }),
    row({ n: 34, name: 'Wildlife Officer Post', cost: 140000, upkeep: 4000, wr: 2, pip: 'gator',
      effects: { ecology: 3, special: ['officer', 'traps', 'debris', 'cajunNavy'] },
      paint: P({ wall: ['#C9B47C', '#A8925C'], roof: 'gable', roofColor: '#4A3B2A', windows: { cols: 2, rows: 1 }, decals: ['truck', 'airboat', 'sign'], special: 'wildlife_post' }),
      why: 'One officer, a truck, and an airboat. The gators know the truck.',
      desc: 'Relocates gators within 14; nutria burrowing −80% within 14; clears debris; Cajun Navy; +3 ecology.' }),
    row({ n: 35, name: 'Wetland Preserve', kind: 'paint', cost: 5000, upkeep: 0, placeRule: PLACE.PRESERVE,
      effects: { ecologyPerTile: 0.5, special: ['preserve'] },
      paint: flat(['#8A9A4B', '#6E8F3C'], ['reeds', 'lookout']),
      why: 'Preserving swamp is cheaper flood defense with a longer payback.',
      desc: 'Protected tile; +0.5 ecology/tile; absorbs gator wanders; surge head loss 0.12 ft/tile; fireflies ×3.' }),
    row({ n: 36, name: 'Live Oak', cost: 12000, upkeep: 0, wr: 5,
      effects: { happiness: { value: 1, radius: 4 }, heat: { mult: 0.7, radius: 3 }, windShield: { mult: 0.7, radius: 2 }, ecology: 0.3 },
      paint: flat(['#3A2A1E', '#3B5A2A'], [], 'live_oak'),
      why: 'The cheapest happiness in the game, on purpose.',
      desc: '+1 happiness radius 4; shade: heat −30% radius 3; wind damage −30% within 2; +0.3 ecology.' }),
    row({ n: 37, name: 'Bald Cypress', cost: 8000, upkeep: 0, wr: 5, placeRule: PLACE.CYPRESS,
      effects: { ecology: 0.5, drainPerDay: 0.05, subsidenceMult: 0.5, subsidenceRadius: 1 },
      paint: flat(['#3A2A1E', '#3F5E3A'], [], 'cypress'),
      why: 'Roots hold the ground and drink the water. Orange in November.',
      desc: '+0.5 ecology; drains 0.05 ft/day on its tile and neighbors; subsidence −50% within 1.' }),
    row({ n: 38, name: 'Azalea Bed', cost: 5000, upkeep: 100, wr: 1,
      effects: { happiness: { value: 1, radius: 3 }, special: ['bloom'] },
      paint: flat(['#3F5E3A', '#E75480'], [], 'azalea'),
      why: 'Hot pink for six weeks a year. Worth it.',
      desc: '+1 happiness radius 3; blooms Mar 1–Apr 10 for +1 more; shredded by Cat 3+, regrows.' }),
    row({ n: 39, name: 'The Bell Tower', w: 2, h: 2, cost: 2500000, upkeep: 5000, wr: 5,
      unlock: { students: 2000, prestige: 30 },
      effects: { landmark: 10, happiness: { value: 3, radius: 0 }, flatTimer: 'bellTower', special: ['bells', 'beacon'] },
      paint: P({ wall: ['#D9C9A3', '#B8A57E'], floors: 6, windows: { cols: 1, rows: 6 }, decals: ['clock', 'flag', 'beacon'], special: 'bell_tower' }),
      namePool: 'bellTower',
      why: 'Bells at midday and dusk. The whole campus hears them.',
      desc: 'Landmark +10; +3 happiness campus-wide; bells at midday and Dusk; beacon at night.' }),
    row({ n: 40, name: 'Tiger Habitat', w: 3, h: 3, cost: 1800000, upkeep: 12000, wr: 4,
      unlock: { students: 1000, prestige: 20 },
      effects: { landmark: 8, happiness: { value: 5, radius: 15 }, homeWinBonus: 0.05, gatorAvoidRadius: 10, special: ['tank', 'habitat'] },
      paint: P({ wall: ['#8A8A8E', '#6E6E72'], roof: 'none', roofColor: '', decals: ['pool'], special: 'tiger_habitat' }),
      why: 'Roux lives here. The gators keep their distance. So do opponents.',
      desc: 'Landmark +8; +5 happiness radius 15; home win +5%; gators avoid radius 10; floods → Roux Is Loose.' }),
    row({ n: 41, name: 'Bayou Surge Barrier', kind: 'drag', cost: 6000000, upkeep: 40000, wr: 5, placeRule: PLACE.BARRIER,
      unlock: { milestone: 'fortressBayou' },
      effects: { gate: true, ecology: -10, happiness: { value: -2, radius: 4 }, flatTimer: 'surgeBarrier', noise: { value: 2, radius: 4 } },
      paint: flat(['#B8B0A0', '#8A8A8E'], ['beacon'], 'surge_barrier'),
      why: 'Close the bayou and the surge comes overland, through the marsh.',
      desc: 'Gate closes at stage > 2 ft; needs 2 powered Pumps upstream; ecology −10; −2 happiness within 4.' }),
    row({ n: 42, name: 'Marsh Restoration Program', cost: 4000000, upkeep: 10000, wr: 2, placeRule: PLACE.RESTORE,
      unlock: { milestone: 'livingWithWater' },
      effects: { special: ['restore'] },
      paint: P({ wall: ['#8FBF8A', '#5E8F5A'], roof: 'gable', roofColor: '#3F5E3A', windows: { cols: 2, rows: 1 }, decals: ['sign', 'airboat'], special: 'marsh_restoration' }),
      why: 'Give the swamp back some ground and it gives you spoonbills.',
      desc: 'Paint 10–40 tiles back to Marsh over 30 days; up to +15 ecology; coastal research ×1.25; unlocks the Rookery.' }),
    row({ n: 43, name: 'Spoonbill Rookery', w: 2, h: 2, cost: 1200000, upkeep: 4000, wr: 3, placeRule: PLACE.MARSH_OR_PRESERVE, alwaysPilings: true,
      unlock: { building: 'marsh_restoration' },
      effects: { landmark: 6, happiness: { value: 2, radius: 8 }, special: ['spoonbills', 'postcardFrame'] },
      paint: flat(['#8B7355', '#6F5A42'], ['stilts', 'nest'], 'rookery'),
      why: 'Spoonbills at dawn, whatever the ecology. The Marketing office cries.',
      desc: 'Landmark +6; +2 happiness radius 8; spoonbills every Dawn; +1 prestige target; the postcard frame.' })
  ];
  const catalog = {};
  for (const r of catalogList) catalog[r.id] = r;

  // ---------------------------------------------------------------------------
  // Tabs (GDD §11.2): Essentials first, then the nine tabs in n order
  // ---------------------------------------------------------------------------
  const TAB_NAMES = [['paths', 'Paths'], ['utilities', 'Utilities'], ['academic', 'Academic'], ['housing', 'Housing'], ['dining', 'Dining'], ['sports', 'Sports'], ['life', 'Life'], ['swamp', 'Swamp'], ['grounds', 'Grounds']];
  const tabs = [{ id: 'essentials', name: 'Essentials', rows: ['path', 'dorm', 'dining_hall', 'lecture_hall', 'poboy', 'quad', 'live_oak'] }];
  for (const t of TAB_NAMES) {
    tabs.push({ id: t[0], name: t[1], rows: catalogList.filter(r => r.tab === t[0] && r.id !== 'founders_hall').map(r => r.id) });
  }

  // ---------------------------------------------------------------------------
  // Decal library (GDD §4 header + the extras the painter needs); 1× px
  // ---------------------------------------------------------------------------
  const decals = {
    clock: { w: 10, h: 10, anchor: 'side', frames: 1 },
    columns: { w: 40, h: 22, anchor: 'ground', frames: 1 },
    arcade: { w: 48, h: 16, anchor: 'ground', frames: 1 },
    awning: { w: 18, h: 6, anchor: 'side', frames: 1 },
    sign: { w: 14, h: 8, anchor: 'side', frames: 1 },
    vents: { w: 12, h: 6, anchor: 'roof', frames: 2 },
    tank: { w: 12, h: 14, anchor: 'roof', frames: 1 },
    masts: { w: 6, h: 40, anchor: 'ground', frames: 2 },
    stilts: { w: 48, h: 12, anchor: 'ground', frames: 1 },
    scaffold: { w: 48, h: 32, anchor: 'ground', frames: 1 },
    tarp: { w: 24, h: 12, anchor: 'roof', frames: 1 },
    boilpot: { w: 10, h: 10, anchor: 'ground', frames: 1 },
    dumpster: { w: 14, h: 8, anchor: 'ground', frames: 1 },
    cars: { w: 8, h: 5, anchor: 'ground', frames: 3 },
    pool: { w: 40, h: 20, anchor: 'ground', frames: 2 },
    dome: { w: 24, h: 14, anchor: 'roof', frames: 1 },
    dish: { w: 12, h: 10, anchor: 'roof', frames: 2 },
    pipes: { w: 32, h: 8, anchor: 'side', frames: 1 },
    impeller: { w: 12, h: 12, anchor: 'side', frames: 2 },
    fountain: { w: 16, h: 12, anchor: 'ground', frames: 3 },
    reeds: { w: 12, h: 10, anchor: 'ground', frames: 2 },
    flag: { w: 8, h: 14, anchor: 'roof', frames: 3 },
    banner: { w: 28, h: 8, anchor: 'side', frames: 1 },
    lights: { w: 4, h: 4, anchor: 'side', frames: 2 },
    letters: { w: 32, h: 8, anchor: 'side', frames: 1 },
    gourds: { w: 10, h: 12, anchor: 'roof', frames: 1 },
    truck: { w: 16, h: 8, anchor: 'ground', frames: 1 },
    airboat: { w: 16, h: 10, anchor: 'ground', frames: 1 },
    bleachers: { w: 48, h: 14, anchor: 'ground', frames: 1 },
    goalposts: { w: 8, h: 16, anchor: 'ground', frames: 1 },
    beacon: { w: 4, h: 6, anchor: 'roof', frames: 2 },
    plywood: { w: 12, h: 10, anchor: 'side', frames: 1 },
    burrow: { w: 6, h: 4, anchor: 'ground', frames: 1 },
    nest: { w: 8, h: 6, anchor: 'roof', frames: 1 },
    lookout: { w: 12, h: 24, anchor: 'ground', frames: 1 },
    couch: { w: 10, h: 6, anchor: 'roof', frames: 1 },
    crane: { w: 20, h: 16, anchor: 'roof', frames: 4 },
    jumbotron: { w: 24, h: 16, anchor: 'roof', frames: 4 }
  };

  // ---------------------------------------------------------------------------
  // Name pools (GDD §14.2)
  // ---------------------------------------------------------------------------
  const names = {
    halls: ['Boudreaux Hall', 'Fontenot Hall', 'Guidry Hall', 'Prejean Hall', 'Landry Hall', 'Broussard Hall', 'Toussaint Hall', 'Batiste Hall', 'Evangeline Hall', 'Acadiana Hall', 'Pontchartrain Hall', 'Atchafalaya Hall', 'Teche Hall', 'Sabine Hall', 'Vermilion Hall', 'Cane River Hall', 'Lafourche Hall', 'Calcasieu Hall', 'Tchefuncte Hall', 'Maurepas Hall'],
    towers: ['Pontchartrain Tower', 'Delacroix Tower'],
    dining: ['The Roux', 'Big Easy Eats', "Ma Tante's Kitchen", 'Tiger Boil', 'Étouffée Station'],
    poboy: ['Dressed & Pressed', 'Debris & Gravy', 'Fried Oyster Hut', "Tee-Boy's", "Nonc Pierre's", "Mama T's"],
    greek: ['Kappa Gumbo Kappa', 'Delta Pirogue', 'Sigma Zydeco', 'Alpha Boudin Beta', 'Rougarou Row'],
    library: ['The Delphine Prudhomme Library'],
    union: ['Laissez Union'],
    engineering: ['Delta Dynamics Center'],
    institute: ['Marsh Lab at Pointe-aux-Chênes'],
    stadium: ['Bayou Field', 'Red Stick Stadium', 'The Cauldron', 'Cauldron Grand'],
    bellTower: ['Cypress Bell Tower'],
    leveeRun: ['The Great Wall of Boudreaux']
  };

  // ---------------------------------------------------------------------------
  // Students (GDD §14.1)
  // ---------------------------------------------------------------------------
  const students = {
    firstCajun: ['Beau', 'Remy', 'Thibault', 'Jean-Luc', 'Landry', 'Boone', 'Cyprien', 'Étienne', 'André', 'Achille', 'Jude', 'Toussaint', 'Ambrose', 'Bastien', 'Claude', 'Emile', 'Hollis', 'Jasper', 'Jules', 'Lucien', 'Marcel', 'Octave', 'Placide', 'Sébastien', 'Ulysse', 'Wade', 'Cécile', 'Delphine', 'Marguerite', 'Noelie', 'Odette', 'Amélie', 'Josée', 'Camille', 'Clothilde', 'Evangeline', 'Fleur', 'Geneviève', 'Ida', 'Jolie', 'Lisette', 'Magnolia', 'Mireille', 'Nadia', 'Ophelia', 'Perrine', 'Renée', 'Simone', 'Solange', 'Tallulah', 'Vivienne', 'Yvette', 'Zoé', 'Bijou', 'Coralie', 'Rosalie'],
    firstModern: ['Tyler', 'Kaitlyn', 'Jaylen', 'Brooklyn', 'DeShawn', 'Madison', 'Hunter', 'Kayla', 'Trey', 'Destiny', 'Marcus', 'Jasmine', 'Darius', 'Alyssa', 'Cedric', 'Monique', 'Kobe', 'Imani', 'Terrance', 'Keisha', 'Tanner', 'Tiana', 'Jamal', 'Aaliyah'],
    last: ['Boudreaux', 'Thibodeaux', 'Fontenot', 'Guidry', 'Landry', 'Hebert', 'Broussard', 'LeBlanc', 'Melancon', 'Arceneaux', 'Robichaux', 'Cormier', 'Breaux', 'Trahan', 'Babineaux', 'Bourgeois', 'Dupré', 'Toussaint', 'Batiste', 'Delacroix', 'Lafleur', 'Prejean', 'Mouton', 'Doucet', 'Savoie', 'Chauvin', 'Gautreaux', 'Comeaux', 'Benoit', 'Domingue', 'Ledet', 'Naquin', 'Picou', 'Rousseau', 'Simoneaux', 'Theriot', 'Vidrine', 'Champagne', 'Duplantis', 'Falgoust', 'Metoyer', 'Balthazar', 'Jolivette', 'Honoré', 'Ancelet', 'Sonnier', 'Fuselier', 'Ardoin', 'Malveaux', 'Guillory', 'Bellard', 'Cheramie', 'Terrebonne', 'Delahoussaye', 'Toups'],
    nicknames: ['Tee', 'Boo', 'Peanut', 'Catfish', 'Coco', 'T-Jean', 'Sha', 'Bébé', 'Skeeter', 'Crawdad', 'Nonc', 'T-Boy', 'Beaux', 'Tank', 'Pook', 'Boudin'],
    majors: ['Coastal Engineering', 'Petroleum Geology', 'Mass Comm', 'Kinesiology', 'Sugarcane Agronomy', 'Cajun French', 'Marine Biology', 'Hospitality (Gumbo Track)', 'Political Science ("Pre-Governor")', 'Nursing', 'Wildlife Management', 'Music (Accordion Performance)', 'Wetland Ecology', 'Sports Management'],
    hometowns: ['Thibodaux', 'Houma', 'Lafayette', 'Opelousas', 'Ville Platte', 'Breaux Bridge', 'Eunice', 'Mamou', 'Golden Meadow', 'Cut Off', 'Chalmette', 'Gretna', 'Plaquemine', 'New Roads', 'Natchitoches', 'Monroe', 'Shreveport', "somewhere in Texas, don't hold it against her."],
    quotes: [
      'Class was underwater again.',
      "The AC works. That's the bar.",
      'Saw a gator by the dumpster. He was polite about it.',
      'The mosquitoes have a syllabus.',
      "My dorm is sinking. Slowly. That's the good news.",
      'Zydeco Friday is the only reason I stayed.',
      'They put the parking lot in the cove. Again.',
      "Roux yawned at me. I think we're friends.",
      "The po'boy line is longer than the levee.",
      'Boil-water advisory day three. Coffee still fine.',
      'The Bell Tower rings at dusk. The frogs answer.',
      'Fireflies over the marsh tonight. Nobody went to the library.'
    ],
    modernShare: 0.25,
    nicknameShare: 0.12
  };

  // ---------------------------------------------------------------------------
  // Coaches (GDD §14.1), gators (§14), storms (§6.2)
  // ---------------------------------------------------------------------------
  const coaches = [
    { name: 'Bobby Cheramie', rep: 'has played in worse' },
    { name: 'Delphine Arceneaux', rep: 'runs the option and the boosters' },
    { name: 'T-Boy Guidry', rep: 'recruits the bayou by pirogue' },
    { name: 'Marcus Batiste', rep: 'defense, gumbo, in that order' },
    { name: 'Hollis Duplantis', rep: 'a clipboard and a grudge' },
    { name: 'Renée Fontenot', rep: 'won a bowl somewhere dry' },
    { name: 'Cedric Malveaux', rep: 'special teams evangelist' },
    { name: 'Octave Robichaux', rep: 'older than the levee' },
    { name: 'Imani Sonnier', rep: 'the analytics one' },
    { name: 'Wade Terrebonne', rep: 'yells in two languages' }
  ];
  const coachQuotes = [
    "We don't rebuild. We re-grade.",
    "We've played in worse.",
    'The humidity is undefeated. We are not the humidity.',
    'Special teams is a mindset. So is the levee.',
    "Magnolia State declines to host. We'll host.",
    'Our kicker practices on a boardwalk. Explains a lot.',
    'Defense wins championships. Pumps win Septembers.',
    "The field is dry. That's the game plan.",
    'I recruit by pirogue. The good ones live on the water.',
    'We go for it on fourth. The Marsh Mob insists.',
    'A gator on the fifty is a home-field advantage.',
    "Night game. Lights on. Swamp quiet. Then it isn't."
  ];
  const gatorNames = ['Big Al', 'Beignet', 'Marie', 'Chomp Chomp', "Ol' Frontenac", 'Tabasco', 'Professor Snaps', 'Étouffée', 'Tante Lou', 'Boudreaux Jr.', 'Mudbug', 'Sazerac', 'Gumbo', 'Praline'];
  const leGrand = 'Le Grand';
  const stormNames = ['Amélie', 'Boudin', 'Célestine', 'Delphine', 'Étienne', 'Fifolet', 'Gaspard', 'Hébert', 'Isidore', 'Josephine', 'Kingcake', 'Landry', 'Mirliton', 'Narcisse', 'Odile', 'Praline', 'Quenelle', 'Rémy', 'Satsuma', 'Thibodeaux', 'Ulysse', 'Violette', 'Wilhelmina', 'Xavier', 'Yvette', 'Zéphyrine'];

  // ---------------------------------------------------------------------------
  // Opponents and the season schedule (GDD §8, ARCH §4.2)
  // ---------------------------------------------------------------------------
  const opponents = {
    magnolia: { name: 'Magnolia State University', nick: 'Magnolias', rating: 78, colors: ['#1E7B3C', '#FFFFFF'], rival: true, crosstown: false },
    crescent: { name: 'Crescent City University', nick: 'Pelicans', rating: 70, colors: ['#1B3A6B', '#F4EEE2'], rival: false, crosstown: false },
    delta: { name: 'Delta A&M', nick: 'Catfish', rating: 62, colors: ['#5A4632', '#FDD023'], rival: false, crosstown: false },
    gulfcoast: { name: 'Gulf Coast Tech', nick: 'Shrimpers', rating: 58, colors: ['#E0443E', '#FFFFFF'], rival: false, crosstown: false },
    atchafalaya: { name: 'Atchafalaya Polytechnic', nick: 'Bullfrogs', rating: 55, colors: ['#3F5E3A', '#9BAA8A'], rival: false, crosstown: false },
    pineywoods: { name: 'Pineywoods State', nick: 'Loggers', rating: 52, colors: ['#7A4A1E', '#C9B47C'], rival: false, crosstown: false },
    sabine: { name: 'Sabine River Baptist', nick: 'Prophets', rating: 45, colors: ['#8A1C2B', '#FFFFFF'], rival: false, crosstown: false },
    vermilion: { name: 'Vermilion College', nick: 'Cranes', rating: 40, colors: ['#B22222', '#F4EEE2'], rival: false, crosstown: false },
    redstick: { name: 'Red Stick College', nick: 'Ferrymen', rating: 35, colors: ['#2E6B5E', '#F5B700'], rival: false, crosstown: true }
  };
  const schedule = [
    { date: 'Aug 8', home: true, kind: 'regular' },
    { date: 'Sep 3', home: false, kind: 'regular' },
    { date: 'Sep 8', home: true, kind: 'regular' },
    { date: 'Oct 3', home: false, kind: 'regular' },
    { date: 'Oct 8', home: true, kind: 'homecoming' },
    { date: 'Nov 3', home: false, kind: 'regular' },
    { date: 'Nov 8', home: true, kind: 'rivalry' },
    { date: 'Dec 8', home: false, kind: 'bowl' }
  ];

  // ---------------------------------------------------------------------------
  // Calendar (ARCH §4.2 map; festival copy GDD §14.3 verbatim)
  // ---------------------------------------------------------------------------
  const calendar = {
    dates: {
      'Jan 1': ['newYear', 'subsidence', 'foundersDay'],
      'Jan 5': ['semester', 'tuition1'],
      'Jan 10': ['springLock'],
      'Feb 6': ['mardiGrasStart'],
      'Feb 8': ['parade'],
      'Feb 9': ['firstGator'],
      'Mar 1': ['crawfishStart', 'azaleas'],
      'Mar 5': ['tuition2'],
      'Mar 25': ['riverTicker'],
      'Apr 1': ['highWaterStart'],
      'Apr 5': ['crawfishBoil', 'scriptedCell'],
      'May 5': ['graduation', 'attrition'],
      'May 6': ['summer'],
      'Jun 1': ['hurricaneSeason', 'obj11'],
      'Jul 1': ['stateFunding'],
      'Jul 2': ['amelie'],
      'Aug 1': ['boudin'],
      'Aug 5': ['fallLock', 'tuition1', 'recruit', 'semester'],
      'Oct 5': ['tuition2'],
      'Oct 7': ['bonfire'],
      'Oct 8': ['homecoming'],
      'Dec 1': ['finals'],
      'Dec 9': ['leveeBonfires'],
      'Dec 10': ['attrition'],
      'Dec 11': ['break']
    },
    festivals: [
      { id: 'mardiGras', start: 'Feb 6', end: 'Feb 8', text: "Classes are technically in session. Nobody is technically in class. The Krewe of Roux rolls down the longest road at Dusk on the 8th; with a Student Union it's three floats and the Bayou Brass, who learned their part yesterday. Beads land on the Bell Tower. The gators have noticed the trash." },
      { id: 'crawfish', start: 'Mar 1', end: 'Apr 10', text: "Forty sacks, sixty pounds of corn, a hundred pounds of potatoes, and a suspicious amount of cayenne. If your Dining Hall dumpster is fenced, the gators watch from behind the wire. If it isn't, the gators attend." },
      { id: 'graduation', start: 'May 5', end: 'May 5', text: 'Caps in the air, mosquitoes in the cap. 22% of your students become alumni, and alumni write checks.' },
      { id: 'homecoming', start: 'Oct 7', end: 'Oct 8', text: "A bonfire on the quad, alumni on the riverbank, and the Marsh Mob louder than the Cauldron's engineers thought was structurally advisable." },
      { id: 'firstNightGame', start: '', end: '', text: "The Cauldron's lights come on for the first time and the swamp goes quiet. Then it doesn't." },
      { id: 'leveeBonfires', start: 'Dec 9', end: 'Dec 9', text: 'Bonfires on every levee run to light the way for Papa Noël. Your flood defense is also your best party. Happiness scales with the length of the wall you built.' },
      { id: 'foundersDay', start: 'Jan 1', end: 'Jan 1', text: "The Chancellor's annual recap. What flooded, who won, what's sinking." }
    ]
  };

  // ---------------------------------------------------------------------------
  // The 62 ticker lines (GDD §14.4 verbatim; index 0 = line 1) and their kinds
  // ---------------------------------------------------------------------------
  const ticker = [
    'Facilities crew reports a gator sunning on the culvert. Crew reports it back.',
    'Tropical wave off Africa has forecasters "mildly interested."',
    'Mosquito index: BIBLICAL. Student Health recommends long sleeves and prayer.',
    'Le Grand spotted at the cypress lake. He has been offered a scholarship.',
    'Parking Services issued {n} tickets today. Campus has {cars} cars.',
    'Levee inspection finds a nutria burrow "the size of a sophomore."',
    'The Marsh Mob has been asked to stop shaking the seismograph. The Marsh Mob has declined.',
    'Zydeco Friday: accordion audible in three parishes.',
    'Cypress trees turn orange; students confirm it\'s "fall, technically."',
    'Heat index {hi}. The quad\'s live oaks now have a waiting list.',
    'Crawfish boil draws {n} attendees and one uninvited reptile.',
    'Chancellor\'s office clarifies that "Geaux" is not a typo.',
    'Heron nesting season begins in the Preserve. Please do not name them.',
    'State legislature praises BSU\'s ecology. State legislature asks about the football score.',
    'Fog advisory: campus visibility reduced to "vibes."',
    'Brownout: labs dark, dorms warm, tempers warmer.',
    'Pump Station {n} running at full tilt. Engineers describe the sound as "reassuring."',
    'Pump Station {n} offline. Reason: the pump station flooded.',
    'Tailgate city population briefly exceeds enrollment.',
    'Roux yawned during {opp}\'s fight song. Analysts call it "a statement."',
    'Wildlife Officer relocates {gator} for the fourth time this month. {gator} files appeal.',
    'Storm surge overtops the south levee. Boardwalk now technically a dock.',
    'Tuition increase announced. Applicants describe reaction as "hmm."',
    'Fireflies over the marsh tonight. Astronomy Club cancels stargazing to watch bugs.',
    'Cold snap kills mosquitoes. Campus throws a parade for the cold snap.',
    '{hall} on wet ground has sunk a foot. Residents now "closer to nature."',
    'Coastal Studies Institute publishes paper: "The Campus Is Sinking (But So Is Everything)."',
    'Gator in the pool. Rec Center closed. Gator awarded the lap-swim record.',
    'Magnolia State\'s mascot spotted on campus. Roux unbothered.',
    'Homecoming bonfire "larger than permitted, smaller than legendary."',
    'Semester underway: 91% attendance, 9% "checking on the levee."',
    'A pelican has taken up residence on the Water Tower and refuses interviews.',
    'First-year students learn to pronounce "Atchafalaya." Second-year students stop trying.',
    'Night game forecast: clear skies, 78°F, 100% chance of goosebumps.',
    'Retention pond stocked with bream. Mosquitoes stocked with regret.',
    'Faculty Senate requests more parking. Parking Services requests more tickets.',
    'Spoonbills circle the Preserve at dawn; the Marketing office cries.',
    'Late-night po\'boy line reaches the Bell Tower. Bell Tower adds a second window.',
    'Hurricane {storm} cone narrows. Campus discovers what "gap in the levee" means.',
    'Cajun French class oversubscribed; "mais la" now the official campus greeting.',
    'Graduation: {n} seniors toss caps. One cap retrieved from a gator. Gator "kept it."',
    'Coach declines to comment on the loss, comments extensively on the humidity.',
    'BSU {w}, {opp} {l} — FINAL. Bells ring until someone finds the off switch.',
    '{opp} {w}, BSU {l} — FINAL. Sad trombone reported near Greek Row.',
    'Hurricane {storm} downgraded to "a mess."',
    'Athletic Director: "We\'ve played in worse." Weather Service: "You have not."',
    '{storm} has passed. Campus mostly here. Dining Hall serving hurricane gumbo.',
    'Subsidence survey complete. Findings: "Yes."',
    'Someone painted the Golden Pirogue purple. The Golden Pirogue was already purple.',
    'Roux is loose. Roux is fine. Roux is at the Dining Hall.',
    'Students cut a desire path across the quad. Facilities calls it "a suggestion."',
    'Naming rights sold: {hall} is now Boudreaux Petroleum Hall. The {family} family is "processing."',
    'Levee bonfires lit for Papa Noël. Pump Station {n} "feels seen."',
    'Blackout day 3. Freshmen have discovered stars.',
    'State Disaster Grant approved. Check is "in the mail." Mail is "flooded."',
    'Chancellor\'s Founders\' Day address: "We are still here. The water is also still here."',
    'Levee inspection finds a nutria burrow at ({x}, {y}). Facilities describes it as "a sophomore-sized problem."',
    'Boil-water advisory. Dining Hall boils everything anyway.',
    'The Cajun Navy has arrived. It brought sandwiches.',
    '{pos} {name} ({hometown}): {stat}. {opp} "had questions."',
    'Coach {coach} is going for it. The Marsh Mob approves. The Athletic Director is "watching."',
    'Tropical Storm Amélie fizzled in the Gulf. The new levee "did not fizzle."'
  ];
  const TICKER_KIND_SETS = {
    water: [17, 18, 22, 26, 48],
    wildlife: [1, 4, 6, 13, 21, 24, 28, 29, 32, 35, 37, 50, 57],
    money: [5, 23, 36, 52, 55],
    danger: [3, 16, 39, 45, 54, 58],
    sports: [7, 19, 20, 42, 43, 44, 46, 49, 60, 61],
    event: [2, 8, 9, 11, 12, 14, 15, 25, 30, 31, 33, 34, 38, 40, 41, 47, 53, 56, 59, 62],
    info: [10, 27, 51]
  };
  const tickerKinds = {};
  for (const kind of Object.keys(TICKER_KIND_SETS)) for (const n of TICKER_KIND_SETS[kind]) tickerKinds[n] = kind;
  const TICKER_KIND_LIST = Object.keys(TICKER_KIND_SETS);

  // ---------------------------------------------------------------------------
  // Objectives (GDD §10.1–10.2); every card text ≤ 12 words
  // ---------------------------------------------------------------------------
  const GRANT = { grant: 50000 }, PRESTIGE2 = { prestige: 2 };
  function obj(kind, title, text, teaches, showMe, reward, deadlineText) {
    return { kind: kind, title: title, text: text, reward: reward, teaches: teaches, showMe: showMe || 'target', deadlineText: deadlineText || '' };
  }
  const I = OBJ.INTERRUPT, BG = OBJ.BACKGROUND;
  const objectives = {
    '1': obj(I, "Place Founders' Hall", "Place Founders' Hall on the ridge.", 'Place', 'plot', GRANT),
    '2': obj(I, 'Drag a path to the Pirogue Landing', 'Drag a path from the front door to the Pirogue Landing.', 'Path', 'landing', GRANT),
    '3': obj(I, 'Build a Dorm and a Dining Hall', 'Build a Dorm and a Dining Hall.', 'House, feed', 'target', GRANT),
    '4': obj(I, 'Dig a canal from the low spot to the bayou', 'Dig a canal from the low spot to the bayou.', 'Drain', 'cove', GRANT),
    '5': obj(I, 'Keep the lights on', 'Keep the lights on: a Substation and a Water Tower.', 'Light', 'crown', GRANT),
    '6': obj(I, 'Plant 5 Live Oaks along a path', 'Plant 5 Live Oaks along a path.', 'Shade is life; oaks are the cheapest happiness', 'target', GRANT),
    '7': obj(I, 'Lay a 10-tile Campus Road: the parade route', 'Lay a 10-tile Campus Road. The Krewe of Roux needs it.', 'Roads and their −1 to adjacent dorms; festivals; the Postcard; the parade is the reward for an action, not a wait', 'target', GRANT),
    '8': obj(BG, 'Reach 500 students by the fall lock', 'Reach 500 students by the fall lock.', 'Beds are the bottleneck; the ridge is full: the cove-or-pilings choice, made before Célestine', 'crown', PRESTIGE2, 'by Aug 5'),
    '9': obj(I, 'Something in the water', "Fence the Dining Hall's water edge, or place a Wildlife Post.", 'Gator counterplay; Fence and Post pips; the gator chip in the alert strip', 'target', GRANT),
    '10': obj(I, 'Standing water', 'Get the campus mosquito index below 0.3.', 'Pond / Abatement / Bat House pips; K overlay', 'target', GRANT),
    '11': obj(I, 'Hold the line', 'Close the cove mouth with a Levee. Put a Pump inside.', 'Water inside a levee needs a pump; the gap detector runs live on the card; 8–16 levee tiles', 'ring', GRANT),
    '11a': obj(I, 'Amélie', 'Watch: Tropical Storm Amélie fills the ring. The pump drains it.', 'The ring works, or the gap shows; "Amélie fizzled in the Gulf" becomes true', 'ring', PRESTIGE2),
    '12': obj(I, 'Cone of concern', 'Six days: pilings or a Generator, ring closed, shelter everyone, Board Up.', 'The Storm panel; every prep action; the substation cascade explained in one line each', 'ring', PRESTIGE2, '6 days'),
    '13': obj(I, 'Landfall', 'Watch. Célestine makes landfall. Answer the toasts.', 'Consequence: the cove floods unless leveed; the shoulder floods at 5 ft; the crown holds', 'target', PRESTIGE2),
    '14': obj(I, 'Repair all storm damage', 'Repair all storm damage.', 'Repair UI, tarps, Disaster Grant, Boil-Water Advisory if the tower went under', 'target', PRESTIGE2),
    '15': obj(BG, 'Geaux Bayou', 'Build a Practice Field, add Bayou Field, play the first home game.', 'Football in Year 1; the Season panel; Coach Cheramie and the first three starters', 'target', PRESTIGE2),
    '16': obj(I, 'Preserve it', 'Paint 20 tiles of Wetland Preserve south of campus.', 'Ecology as flood defense; fireflies that Night', 'target', PRESTIGE2),
    '17': obj(BG, 'Reach 1,500 students; build a Wastewater Plant', 'Reach 1,500 students and build a Wastewater Plant.', 'The wastewater brake', 'target', PRESTIGE2),
    '18a': obj(BG, 'Win four games in a season', 'Win four games in a season.', 'The rating breakdown; coaching budget; "Underdog 12%" is a number, not a bug', 'target', PRESTIGE2),
    '18b': obj(BG, 'Make the Sugar Cane Bowl', 'Win five games and make the Sugar Cane Bowl.', 'The bowl; hire a better coach in the offseason', 'target', PRESTIGE2),
    '18': obj(BG, 'Beat Magnolia State', 'Beat Magnolia State for the Golden Pirogue.', 'Rivalry; the recruiting card; a five-year chase that is legible all the way', 'target', PRESTIGE2),
    '19': obj(BG, 'Reach prestige 30; build the Bell Tower', 'Reach prestige 30 and build the Bell Tower.', 'Landmarks', 'target', PRESTIGE2),
    '20': obj(BG, 'Night Falls on the Cauldron', 'Upgrade to Stadium II and play the first night game.', 'The screenshot moment, scripted clear', 'target', PRESTIGE2),
    '21': obj(BG, 'Choose your bayou', 'Build the Surge Barrier or the Marsh Restoration Program.', 'Fortress vs Living With Water, each with a capstone that changes the surge', 'target', PRESTIGE2),
    '22': obj(BG, 'Flagship', 'Reach 10,000 students and prestige 60.', "Hands off to the Milestones panel with the ticker's blessing", 'target', PRESTIGE2)
  };
  objectives['8'].cappedText = 'Capped at {students} — beds are the bottleneck';

  // ---------------------------------------------------------------------------
  // Milestones (GDD §10.5; BSU.MILESTONES order)
  // ---------------------------------------------------------------------------
  const MILESTONE_ROWS = [
    ['Chartered', "Place Founders' Hall", {}],
    ['Welcome to the Bayou', 'The first 120 students arrive', {}],
    ['Cajun Engineer', 'A canal reaches the bayou', { cash: 50000 }],
    ['First Bell', '600 students', { prestige: 2 }],
    ['Wet Feet', 'First flooded building (a consolation card with the three fixes)', { effect: 'pilingsDiscount' }],
    ['High and Dry', 'Ring closed at H = 8 ft (every core building unreached, no gaps) with ≥ 1 powered Pump Station inside the unreached region', { prestige: 2 }],
    ['Storm Chaser', 'Survive a hurricane with < 20% damage', { cash: 100000 }],
    ['Eye of the Storm', 'Survive Cat 4+ with zero flooded buildings', { prestige: 5 }],
    ['Gator Wrangler', '10 relocations', { effect: 'postUpkeepHalf' }],
    ['Sunbather', 'A gator on the 50-yard line on game day', { effect: 'sunbather' }],
    ['Skeeter Beater', 'Campus mosquito index < 0.1 through August', { prestige: 2 }],
    ['Bayou Field', 'First home game', {}],
    ['Night Falls on the Cauldron', 'First Stadium II night game', { effect: 'goldRing' }],
    ['Geaux Beat Magnolia', 'Beat the rival', { prestige: 3 }],
    ['Undefeated', '7–0 regular season', { prestige: 5, effect: 'undefeatedDonations' }],
    ['The Big Boil', 'A Crawfish Boil with ≥ 3,000 attendance, where attendance = (students × 0.6 + alumni × 0.1) × (Union ? 1.5 : 1)', { effect: 'bigBoil' }],
    ["Throw Me Somethin'", 'Mardi Gras with the Union and happiness ≥ 75', { cash: 50000 }],
    ['Green and Gold', 'Ecology ≥ 70 with ≥ 3,000 students', { effect: 'researchBonus' }],
    ['Fortress Bayou', 'Ring closed at H = 12 ft whose boundary wall tiles include ≥ 40 floodwalls', { prestige: 3 }],
    ['Living With Water', 'Ecology ≥ 75 with ≥ 2,000 students and ≤ 10 floodwall tiles', { prestige: 3 }],
    ['Lights Are On', 'Build the Bell Tower', {}],
    ['Sinking Feeling', 'A building drops 1 ft (warning achievement)', { effect: 'pilingsDiscountYear' }],
    ['Rebuilt from the Roux', 'Reach prestige 50 after a bankruptcy card', { cash: 500000 }],
    ['Flagship', '10,000 students and prestige 60', { effect: 'titleCampus' }],
    ['Laissez les Bons Temps Rouler', '20,000 students, prestige 85, ecology ≥ 50', {}],
    ['Untouched', 'Reach Flagship without draining a single marsh tile', {}]
  ];
  const milestones = BSU.MILESTONES.map(function (id, i) {
    const m = MILESTONE_ROWS[i] || ['', '', {}];
    return { id: id, name: m[0], text: m[1], reward: m[2] };
  });

  // ---------------------------------------------------------------------------
  // Student Voice cards (GDD §7.1; BSU.VOICE_CARDS order)
  // ---------------------------------------------------------------------------
  const voiceCards = [
    { id: 'boardwalk', student: 'Marguerite "Sha" Guidry', major: 'Wetland Ecology', text: 'A 6-tile Boardwalk into the marsh and I bring 20 friends.', payoff: 'Applicants +40 at the next lock; 6 agents idle on the boardwalk at Golden Hour.', prereq: 'boardwalk' },
    { id: 'recPool', student: 'Jaylen Batiste', major: 'Kinesiology', text: 'A Rec Center within 10 of the field, or the starters practice in the heat.', payoff: 'Team rating +2 for the season, on top of the heat fix.', prereq: 'recPool' },
    { id: 'zydeco', student: 'Odette Fontenot', major: 'Music (Accordion Performance)', text: 'Zydeco Friday needs the plaza lit: 4 Live Oaks within 3 of the Union.', payoff: '+2 happiness for a month; the zydeco motif plays every 5th Dusk.', prereq: 'zydeco' },
    { id: 'poboyRoute', student: 'Trey Landry', major: 'Hospitality (Gumbo Track)', text: "A Po'boy Shack on the path between the dorms and the Lecture Hall.", payoff: '+$3k/mo on that shack (it is on the route).', prereq: 'poboyRoute' },
    { id: 'quadOak', student: 'Cécile Broussard', major: 'Cajun French', text: "A Quad Lawn with an oak we can sit under, within 6 of Founders'.", payoff: '+2 happiness for a month; a study-circle sprite under the oak at Golden Hour.', prereq: 'quadOak' },
    { id: 'batHouse', student: 'Jules "Skeeter" Robichaux', major: 'Marine Biology', text: 'Three Bat Houses by the water, not the fogger.', payoff: "Ecology +1; any Abatement Station's fogger penalty is waived for one month.", prereq: 'batHouse' },
    { id: 'parking', student: 'Kaitlyn Melancon', major: 'Mass Comm', text: 'A Parking Lot within 4 of the road; the walk from Highway 1 is a podcast.', payoff: 'The noParking timer cleared and +$2k/mo tickets.', prereq: 'parking' },
    { id: 'healthShade', student: 'Darius Metoyer', major: 'Nursing', text: 'Live Oaks on every path tile within 6 of the Health Center.', payoff: 'Heat illness −20% campus-wide that summer.', prereq: 'healthShade' },
    { id: 'greekPorch', student: 'Beau "T-Boy" Thibodeaux', major: 'Political Science (Pre-Governor)', text: 'A Greek Row House within 8 of the field for the tailgate.', payoff: 'Tailgate revenue +25% that season.', prereq: 'greekPorch' },
    { id: 'cypressLine', student: 'Solange Ancelet', major: 'Coastal Engineering', text: '10 Bald Cypress within 1 of the levee: roots hold the wall.', payoff: 'Levee subsidence ×0 on those tiles; ecology +2.', prereq: 'cypressLine' },
    { id: 'lookout', student: 'Achille Prejean', major: 'Wildlife Management', text: "A Boardwalk to the lookout tower; I'll count the spoonbills.", payoff: '+1 prestige when spoonbills next circle.', prereq: 'lookout' },
    { id: 'bellSelfie', student: 'Tiana Vidrine', major: 'Sports Management', text: 'A Quad Lawn at the foot of the Bell Tower for the selfies.', payoff: 'Applicants +60 at the next lock.', prereq: 'bellSelfie' }
  ];

  // ---------------------------------------------------------------------------
  // Board of Regents cards (GDD §5.9; BSU.BOARD_CARDS order); cost > 0 = spend
  // ---------------------------------------------------------------------------
  const boardCards = [
    { id: 'lobby', name: 'Lobby the Legislature', text: '−$100k; state funding +10% next Jul 1', cost: 100000, effect: 'stateFunding+10' },
    { id: 'researchPush', name: 'Research Push', text: '−$200k; research ×1.5 for a year', cost: 200000, effect: 'research×1.5/yr' },
    { id: 'tuitionFreeze', name: 'Tuition Freeze', text: '+5 happiness, applicants +10%; tuition locked for a year', cost: 0, effect: 'happiness+5, applicants+10%, tuition locked/yr' },
    { id: 'recruitingTrip', name: 'Recruiting Trip', text: '−$150k; team rating +3 next season', cost: 150000, effect: 'teamRating+3' },
    { id: 'marshGrant', name: 'Marsh Restoration Grant', text: '+$300k earmarked for Preserve/Cypress/Pond', cost: -300000, effect: 'earmarked+300k' },
    { id: 'summerSession', name: 'Summer Session', text: 'students stay in summer: +15% summer tuition, heat penalty ×1.5, agents present in summer', cost: 0, effect: 'summerTuition+15%, heat×1.5' },
    { id: 'insurance', name: 'Insurance Policy', text: '2% of building value per year; pays 50% of hurricane repairs; persists until cancelled', cost: 0, effect: '2%/yr, pays 50%' },
    { id: 'homecomingBudget', name: 'Homecoming Budget', text: '$0/$50k/$150k → +0/+3/+6 happiness, +0/+1/+3 prestige for 10 days', cost: 0, effect: 'homecomingBudget' }
  ];

  // ---------------------------------------------------------------------------
  // Failure cards (GDD §10.7)
  // ---------------------------------------------------------------------------
  const failureCards = {
    bankruptcy: {
      title: 'The Board has concerns',
      options: [
        { id: 'austerity', text: 'Austerity: upkeep −30% and happiness −10 for a year; no construction for a month' },
        { id: 'hike', text: 'Emergency Tuition Hike: +$3,000/semester, applicants −40% for a year' },
        { id: 'naming', text: 'Sell Naming Rights: a random hall becomes Boudreaux Petroleum Hall, +$1M, −3 prestige; the ticker never forgets' }
      ]
    },
    underwater: {
      title: 'Semester Cancelled',
      options: [{ id: 'ok', text: "No tuition installment this semester, attrition ×2, prestige −15. The Governor's Coastal Resilience Grant ($3M, earmarked for swamp infrastructure) arrives with this card, and a free Pump Station is delivered to a ridge tile. The marching band plays it in." }]
    },
    probation: {
      title: 'Accreditation Probation',
      options: [{ id: 'ok', text: 'Applicants ×0.5 until prestige > 15. The Accreditation Task Force: a Library, the seat ratio, no flooded buildings for 30 days. The ticker cites "the catfish in the library."' }]
    }
  };

  // ---------------------------------------------------------------------------
  // Tutorial script (GDD §10.1); every card ≤ 12 words
  // ---------------------------------------------------------------------------
  const tutorial = [
    { stage: 0, card: 'Click to charter the university.', hint: '' },
    { stage: 1, card: '$4,000,000, one ridge, and a swamp. Build a university. Geaux.', hint: '' },
    { stage: 2, card: "Place Founders' Hall on the ridge.", hint: 'Cove tiles are too wet.' },
    { stage: 3, card: 'Drag a path from the front door to the Pirogue Landing.', hint: '' },
    { stage: 4, card: 'Build a Dorm and a Dining Hall.', hint: 'Wet ground sinks; +20%.' },
    { stage: 5, card: 'Dig a canal from the low spot to the bayou.', hint: 'Keep the lights on: a Substation and a Water Tower.' },
    { stage: 6, card: '', hint: '' }
  ];

  // ---------------------------------------------------------------------------
  // Ms. Thibodeaux (GDD §14: one Cajun tic per line at most) and storm quotes
  // ---------------------------------------------------------------------------
  const thibodeaux = [
    'Cher, the ridge is the only dry ground you own. Build there first.',
    'That cove fills every time it rains. Ask me how I know.',
    'Mais, a path on the marsh is still a path. The marsh disagrees.',
    'Pilings cost more today and less every year after.',
    'The gators have noticed the trash. They will notice the dumpster next.',
    'A levee without a pump is a bathtub with a nice rim.',
    'Board up before the cone narrows, not after.',
    'The Legislature approves. Spend it before they change their minds, yeah.',
    'Live oaks along every path. Cheapest happiness in the parish.',
    'Hurricane season opens June 1. The Gulf did not check the calendar.',
    'Beds are the bottleneck. They are always the bottleneck.',
    'Ecology is flood defense with a longer payback. Write that down.'
  ];
  const stormQuotes = [
    "We've played in worse.",
    'You have not.',
    'The Water Tower is thinking about it.',
    'Everyone in the gym. Yes, everyone.',
    'The cove levee is holding. The cove levee is 55%.',
    'Pump Station 1 feels seen.',
    'Amélie fizzled in the Gulf. Boudin fizzled in the Gulf. Célestine did not.',
    'Cat 2 ± 1. The plus is the part to plan for.'
  ];

  // ---------------------------------------------------------------------------
  // Overlays (GDD §11.1, §6.4), keys (ARCH §7.4 / GDD §11.8), rain kinds
  // ---------------------------------------------------------------------------
  const overlays = [
    { ov: OV.FLOOD, key: 'F', name: 'Flood Risk', legend: ['0 ft', '0.3', '0.6', '1+ ft'] },
    { ov: OV.WATER, key: 'W', name: 'Water', legend: ['Dry', 'Puddle', 'Wading', 'Flooded'] },
    { ov: OV.MOSQUITO, key: 'K', name: 'Mosquito', legend: ['Ambient', 'Annoying', 'Biblical', 'State Bird'] },
    { ov: OV.POWER, key: 'P', name: 'Power & Water', legend: ['Covered', 'No power', 'No water', 'Dark'] },
    { ov: OV.COVERAGE, key: 'C', name: 'Coverage', legend: ['Dining', 'Happiness', 'Shade', 'Uncovered'] },
    { ov: OV.ECOLOGY, key: 'E', name: 'Ecology', legend: ['Wetland', 'Drained', 'Preserve', 'Sinking'] }
  ];
  const keys = [
    { key: ' ', action: 'pause' },
    { key: '1', action: 'speed1' }, { key: '2', action: 'speed2' }, { key: '3', action: 'speed4' }, { key: '4', action: 'speed8' },
    { key: 'b', action: 'budget' }, { key: 'n', action: 'season' }, { key: 't', action: 'storm' }, { key: 'l', action: 'milestones' },
    { key: 'f', action: 'overlayFlood' }, { key: 'w', action: 'overlayWater' }, { key: 'k', action: 'overlayMosquito' },
    { key: 'p', action: 'overlayPower' }, { key: 'c', action: 'overlayCoverage' }, { key: 'e', action: 'overlayEcology' },
    { key: '-', action: 'zoomOut' }, { key: '=', action: 'zoomIn' },
    { key: 'Tab', action: 'nextTab' }, { key: 'Tab', action: 'prevTab', shift: true },
    { key: '1', action: 'pick1', shift: true }, { key: '2', action: 'pick2', shift: true }, { key: '3', action: 'pick3', shift: true },
    { key: '4', action: 'pick4', shift: true }, { key: '5', action: 'pick5', shift: true }, { key: '6', action: 'pick6', shift: true },
    { key: '7', action: 'pick7', shift: true }, { key: '8', action: 'pick8', shift: true }, { key: '9', action: 'pick9', shift: true },
    { key: 'g', action: 'buildMenu' }, { key: 'x', action: 'bulldoze' }, { key: 'r', action: 'rotate' }, { key: 'h', action: 'home' }, { key: '.', action: 'follow' },
    { key: 'Escape', action: 'escape' },
    { key: 's', action: 'save', ctrl: true }, { key: 'z', action: 'undo', ctrl: true }, { key: 'p', action: 'postcard', ctrl: true },
    { key: 'm', action: 'mute' },
    { key: 'y', action: 'toastYes' },
    { key: '`', action: 'debug' },
    { key: 'a', action: 'panLeft' }, { key: 's', action: 'panDown' }, { key: 'd', action: 'panRight' },
    { key: 'ArrowUp', action: 'panUp' }, { key: 'ArrowDown', action: 'panDown' }, { key: 'ArrowLeft', action: 'panLeft' }, { key: 'ArrowRight', action: 'panRight' }
  ];
  // Layers that sit above the map (ARCH §7.4 precedence 1) or are held keys; they share
  // `n`/`w`/`Escape` with map bindings, so they live here rather than as duplicate rows.
  const toastKeys = { yes: ['y', 'Enter'], no: ['n', 'Escape'] };
  const panKeys = { up: ['w', 'ArrowUp'], down: ['s', 'ArrowDown'], left: ['a', 'ArrowLeft'], right: ['d', 'ArrowRight'] };
  const rainKinds = {
    shower: { total: 0.04, steps: 40 },
    frontal: { total: 0.125, steps: 40 },
    band: { total: 0.33, steps: 40 },
    cell: { steps: 60, radius: 14 },
    hurricane: { inches: [6, 8, 10, 13, 16], steps: 360 }
  };

  // ---------------------------------------------------------------------------
  // UX pass: the goals tracker, needs strip, build-menu requirement glyphs and the coach-mark tour (ui.js reads these)
  // ---------------------------------------------------------------------------
  /** per objective: one line on WHY it matters + the buildings its "Build it" button offers (first not-yet-built, unlocked one wins) */
  const guide = {
    '1': { why: 'Everything starts here: the hall anchors the ridge and roots the path network.', build: ['founders_hall'] },
    '2': { why: 'Your first students arrive by pirogue. No path to the water, no way to class.', build: ['path'] },
    '3': { why: 'Beds and meals are the enrollment ceiling, and 120 founders are already on the water.', build: ['dorm', 'dining_hall'] },
    '4': { why: 'The low spot floods every rain. A canal drains it to the bayou.', build: ['canal'] },
    '5': { why: 'Buildings without power and water run at half capacity.', build: ['substation', 'water_tower'] },
    '6': { why: 'Shade cuts the August heat penalty, and oaks are the cheapest happiness in the game.', build: ['live_oak'] },
    '7': { why: 'Roads carry buses and the Mardi Gras parade, and the Stadium will need one.', build: ['road'] },
    '8': { why: 'Tuition pays the bills. Beds, seats and dining set the cap on how many pay it.', build: ['dorm', 'lecture_hall', 'dining_hall'] },
    '9': { why: 'A gator at the dumpster closes the Dining Hall until it leaves.', build: ['gator_fence', 'wildlife_post'] },
    '10': { why: 'Mosquitoes make students sick, and sick students skip class.', build: ['pond', 'bat_house', 'abatement'] },
    '11': { why: 'A closed levee ring keeps the surge out; the pump gets the rain back out.', build: ['levee', 'pump'] },
    '11a': { why: 'Watch the ring hold, or find the gap before the real storm.', build: ['levee'] },
    '12': { why: 'Six days to harden the campus before landfall.', build: ['generator', 'levee'] },
    '13': { why: 'The storm is here. Answer the toasts; the prep you did decides the rest.', build: [] },
    '14': { why: 'Damaged buildings do nothing until they are repaired.', build: [] },
    '15': { why: 'Football brings applicants, ticket money and buzz.', build: ['practice_field'] },
    '16': { why: 'Preserved wetland soaks up surge and lifts ecology.', build: ['preserve'] },
    '17': { why: 'Past 1,500 students the campus needs real sewage or enrollment stalls.', build: ['wastewater'] },
    '18a': { why: 'Wins fill the stands and the application pool.', build: ['stadium'] },
    '18b': { why: 'A bowl berth is prestige you cannot buy.', build: [] },
    '18': { why: 'The Golden Pirogue: a rivalry worth a five-year chase.', build: [] },
    '19': { why: 'Landmarks lift prestige, and the Bell Tower is the biggest one.', build: ['bell_tower'] },
    '20': { why: 'Night games under the lights: the Cauldron.', build: ['stadium'] },
    '21': { why: 'Fortress or living with water: pick the future of the bayou.', build: ['surge_barrier', 'marsh_restoration'] },
    '22': { why: 'The flagship: 10,000 students and prestige 60.', build: ['res_tower', 'library'] },
    'p1': { why: 'Accreditation wants a Library.', build: ['library'] },
    'p2': { why: 'Accreditation wants lecture seats for 5 of every 6 students.', build: ['lecture_hall'] }
  };
  /** the needs strip (GDD §5.4 capacity terms + utilities + parking): label, the fix, how the gauge reads */
  const needs = {
    beds: { label: 'Beds', build: 'dorm', unit: 'students' },
    seats: { label: 'Seats', build: 'lecture_hall', unit: 'students' },
    dining: { label: 'Dining', build: 'dining_hall', unit: 'students' },
    power: { label: 'Power', build: 'substation', unit: 'buildings' },
    water: { label: 'Water', build: 'water_tower', unit: 'buildings' },
    wastewater: { label: 'Sewage', build: 'wastewater', unit: 'students' },
    parking: { label: 'Parking', build: 'parking', unit: 'lots' }
  };
  /** build-menu requirement glyphs and their hover text ({n} = roadWithin) */
  const requirements = {
    power: { glyph: '⚡', text: 'Needs power: a Power Substation within 10 tiles' },
    water: { glyph: '💧', text: 'Needs water: a Water Tower within 12 tiles' },
    path: { glyph: '🚶', text: 'Must touch a path or road on one edge' },
    road: { glyph: '🛣', text: 'Needs a Campus Road within {n} tiles' },
    marsh: { glyph: '🪵', text: 'On marsh it goes up on Pilings (+40% cost)' },
    place: {}
  };
  requirements.place[PLACE.PATH] = { glyph: '↔', text: 'Drag a run across land' };
  requirements.place[PLACE.ROAD] = { glyph: '↔', text: 'Drag a run; bridges up to 3 water tiles; not on marsh' };
  requirements.place[PLACE.BOARDWALK] = { glyph: '↔', text: 'Drag a run over marsh, preserve or water' };
  requirements.place[PLACE.LEVEE] = { glyph: '↔', text: 'Drag a run along the ground; close the ring' };
  requirements.place[PLACE.CANAL] = { glyph: '↔', text: 'Drag a run downhill to the bayou or open water' };
  requirements.place[PLACE.FENCE] = { glyph: '↔', text: 'Drag a run along a water edge' };
  requirements.place[PLACE.PRESERVE] = { glyph: '🖌', text: 'Paint marsh tiles' };
  requirements.place[PLACE.NEAR_WATER] = { glyph: '🌊', text: 'Within 3 tiles of water' };
  requirements.place[PLACE.TOUCH_MARSH_BAYOU] = { glyph: '🌊', text: 'Must touch marsh or the bayou' };
  requirements.place[PLACE.TOUCH_CANAL_WATER] = { glyph: '🌊', text: 'Must touch a canal or water' };
  requirements.place[PLACE.CYPRESS] = { glyph: '🌊', text: 'Wet ground or marsh only' };
  requirements.place[PLACE.MARSH_OR_PRESERVE] = { glyph: '🌊', text: 'Marsh or Wetland Preserve only' };
  requirements.place[PLACE.BARRIER] = { glyph: '↔', text: 'Drag across the mouth of the bayou' };
  requirements.place[PLACE.RESTORE] = { glyph: '🖌', text: 'Paint drained land back to marsh' };
  requirements.place[PLACE.UPGRADE] = { glyph: '⤴', text: 'Click a standing building to lift it' };
  /** the 60-second coach-mark tour (ui.js; first game only, replayable from Settings); target = a BSU.ui.el key, '' = none */
  const coach = [
    { id: 'stats', target: 'stats', title: 'Your money and your campus', text: 'Cash pays for buildings and upkeep; students pay tuition. Prestige, Happiness and Ecology grow next year’s applicant pool. Click any number for the breakdown.' },
    { id: 'goals', target: 'objective-card', title: 'Your current goal', text: 'Ms. Thibodeaux keeps the goal here, with why it matters. “Build it” opens the right building; “Show me” pans the camera there. Click the card to see every milestone.' },
    { id: 'menu', target: 'build-menu', title: 'The build menu', text: 'Press G, or the gold Build button, any time. Pick a category on the left, then a building. Gold ★ marks what the campus needs right now; greyed cards tell you what unlocks them.' },
    { id: 'place', target: '', title: 'Placing things', text: 'Click a tile to place a building. Paths, roads, levees and canals are dragged. Esc or right-click cancels. The label beside the cursor says why a spot will not work.' },
    { id: 'needs', target: 'needs-strip', title: 'What the campus needs', text: 'Beds, seats, dining, power and water: used against capacity. Whichever is full is the brake on enrollment; click the line under the gauges to build the fix.' },
    { id: 'swamp', target: 'overlay-buttons', title: 'Mind the water', text: 'This is a swamp. F shows flood risk. Levees keep the surge out; canals and pumps move the rain to the bayou. Célestine comes in Year 1.' }
  ];

  // ---------------------------------------------------------------------------
  // Assemble, deep-freeze, self-test
  // ---------------------------------------------------------------------------
  const data = {
    catalog: catalog, catalogList: catalogList, tabs: tabs, decals: decals, names: names, students: students,
    coaches: coaches, coachQuotes: coachQuotes, gatorNames: gatorNames, leGrand: leGrand, stormNames: stormNames,
    opponents: opponents, schedule: schedule, calendar: calendar, ticker: ticker, tickerKinds: tickerKinds,
    tickerKindList: TICKER_KIND_LIST, objectives: objectives, milestones: milestones, voiceCards: voiceCards,
    boardCards: boardCards, failureCards: failureCards, tutorial: tutorial, thibodeaux: thibodeaux,
    stormQuotes: stormQuotes, overlays: overlays, keys: keys, toastKeys: toastKeys, panKeys: panKeys, rainKinds: rainKinds,
    guide: guide, needs: needs, requirements: requirements, coach: coach
  };

  /** Recursive Object.freeze; no typed arrays, Maps or functions exist in the tables. */
  function deepFreeze(o) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
    }
    return Object.freeze(o);
  }

  /** Pure; validates every table's shape and count (ARCH §4.2, brief §6) → {ok, notes}. */
  data.selfTest = function () {
    const fails = [], notes = [];
    const check = function (cond, msg) { if (!cond) fails.push(msg); };
    try {
      const D = BSU.data, L = D.catalogList, C = D.catalog;
      // 1. row count and numbering
      check(L.length === 43, 'catalogList.length === 43 (got ' + L.length + ')');
      check(Object.keys(C).length === 43, 'catalog has 43 keys');
      for (let i = 0; i < L.length; i++) {
        check(L[i].n === i + 1, 'row ' + (i + 1) + ' has n ' + L[i].n);
        check(C[L[i].id] === L[i], 'catalog[' + L[i].id + '] is the same object as catalogList[' + i + ']');
      }
      // 2. schema validation (every key, every effects key, no extras)
      let schemaErrors = 0;
      for (const r of L) {
        const v = BSU.validateCatalogRow(r);
        if (!v.ok) { schemaErrors += v.errors.length; fails.push(r.id + ': ' + v.errors.slice(0, 3).join('; ')); }
        for (const k of Object.keys(BSU.catalogRowSchema.effects)) check(k in r.effects, r.id + '.effects.' + k + ' present');
        check(r.kind !== 'footprint' || r.buildDays === 1 + Math.floor(r.w * r.h / 6), r.id + ' buildDays formula');
        check(typeof r.why === 'string' && r.why.length > 0 && typeof r.desc === 'string' && r.desc.length > 0, r.id + ' why/desc');
        check(r.why.split(/\s+/).length <= 14, r.id + ' why ≤ 14 words');
        check(typeof r.blurb === 'string' && r.blurb.length > 0 && r.blurb.split(/\s+/).length <= 18, r.id + ' blurb present, ≤ 18 words');
        for (const t of r.tiers) check(t.name.length > 0 && t.cost > 0 && t.seats > 0, r.id + ' tier ' + t.tier + ' sane');
        if (r.unlock.milestone) check(BSU.MILESTONES.indexOf(r.unlock.milestone) >= 0, r.id + ' unlock.milestone known');
        if (r.unlock.building) check(!!C[r.unlock.building], r.id + ' unlock.building known');
        if (r.unlock.any) for (const u of r.unlock.any) if (u.building) check(!!C[u.building], r.id + ' unlock.any building known');
        if (r.namePool) check(Array.isArray(D.names[r.namePool]), r.id + ' namePool ' + r.namePool + ' exists');
        check(r.needsPower === !!NEEDS_POWER[r.id] && r.needsWater === !!NEEDS_WATER[r.id], r.id + ' power/water flags');
        check(Number.isInteger(r.cost) && Number.isInteger(r.upkeep) && r.cost >= 0 && r.upkeep >= 0, r.id + ' money is integer $');
      }
      notes.push('43 rows validated' + (schemaErrors ? ' (' + schemaErrors + ' schema errors)' : ''));
      // 3. ids
      for (const r of L) check(BSU.B[r.id] === r.id, r.id + ' in BSU.B');
      check(BSU.B_ORDER.every((id, i) => L[i] && L[i].id === id), 'B_ORDER equals catalogList ids');
      // 4. decals
      let decalRefs = 0;
      for (const r of L) for (const d of r.paint.decals) { decalRefs++; check(!!D.decals[d], r.id + ' decal ' + d + ' exists'); }
      for (const k of Object.keys(D.decals)) {
        const d = D.decals[k];
        check(d.w > 0 && d.h > 0 && d.frames >= 1 && ['roof', 'ground', 'side'].indexOf(d.anchor) >= 0, 'decal ' + k + ' shape');
      }
      check(Object.keys(D.decals).length >= 36, '≥ 36 decals');
      notes.push(Object.keys(D.decals).length + ' decals, ' + decalRefs + ' refs');
      // 5. ticker
      check(D.ticker.length === 62, 'ticker.length === 62 (got ' + D.ticker.length + ')');
      for (let n = 1; n <= 62; n++) check(D.tickerKindList.indexOf(D.tickerKinds[n]) >= 0, 'tickerKinds[' + n + '] valid');
      check(Object.keys(D.tickerKinds).length === 62, 'tickerKinds has 62 entries');
      for (const line of D.ticker) check(typeof line === 'string' && line.length > 0 && line.indexOf('<\/script') < 0, 'ticker line non-empty');
      // 6. dates. Two keys that ARCH §4.2 (and params.weather) spell outside the 10-day month
      // ('Mar 25' riverTicker, 'Dec 11' break) are kept verbatim; the frozen dateToDay rejects
      // them, so they are the only tolerated exceptions (see INTEGRATION_NOTES '## data.js').
      const dateOk = function (d, where) {
        check(Number.isInteger(BSU.dateToDay(d, 1)) || d === 'Mar 25' || d === 'Dec 11', where + ' date "' + d + '" parses');
      };
      for (const g of D.schedule) dateOk(g.date, 'schedule');
      for (const d of Object.keys(D.calendar.dates)) { dateOk(d, 'calendar.dates'); check(Array.isArray(D.calendar.dates[d]) && D.calendar.dates[d].length > 0, 'calendar.dates[' + d + '] non-empty'); }
      for (const f of D.calendar.festivals) { if (f.start) dateOk(f.start, 'festival ' + f.id); if (f.end) dateOk(f.end, 'festival ' + f.id); check(f.text.length > 0, 'festival ' + f.id + ' text'); }
      check(D.calendar.festivals.length === 7, '7 festivals');
      check(D.schedule.length === 8 && D.schedule.filter(g => g.home).length === 4, '8 games, 4 at home');
      // 7. counts
      check(D.stormNames.length === 26, '26 storm names');
      check(D.stormNames[0] === 'Amélie' && D.stormNames[2] === 'Célestine' && D.stormNames[25] === 'Zéphyrine', 'storm names with accents intact');
      check(D.gatorNames.length === 14 && D.leGrand === 'Le Grand', '14 gator names + Le Grand');
      check(D.coaches.length === 10 && D.coaches[0].name === 'Bobby Cheramie', '10 coaches, Cheramie first');
      check(D.coachQuotes.length === 12, '12 coach quotes');
      check(D.names.halls.length === 20 && D.names.towers.length === 2 && D.names.dining.length === 5 && D.names.poboy.length === 6 && D.names.greek.length === 5 && D.names.stadium.length === 4, 'name pool sizes');
      check(D.students.firstCajun.length === 56 && D.students.firstModern.length === 24 && D.students.last.length === 55 && D.students.nicknames.length === 16 && D.students.majors.length === 14 && D.students.hometowns.length === 18 && D.students.quotes.length >= 12, 'student table sizes');
      check(D.students.modernShare === 0.25 && D.students.nicknameShare === 0.12, 'student shares');
      check(D.voiceCards.length === 12 && D.voiceCards.every((c, i) => c.id === BSU.VOICE_CARDS[i]), '12 voice cards in BSU.VOICE_CARDS order');
      check(D.boardCards.length === 8 && D.boardCards.every((c, i) => c.id === BSU.BOARD_CARDS[i]), '8 board cards in BSU.BOARD_CARDS order');
      check(D.milestones.length === 26 && D.milestones.every((m, i) => m.id === BSU.MILESTONES[i] && m.name.length > 0 && m.text.length > 0), '26 milestones in BSU.MILESTONES order');
      const objIds = Object.keys(D.objectives);
      check(objIds.length === 25 && BSU.OBJECTIVE_IDS.every(id => !!D.objectives[id]), '25 objectives keyed by BSU.OBJECTIVE_IDS');
      for (const id of objIds) {
        const o = D.objectives[id];
        check(o.kind === OBJ.INTERRUPT || o.kind === OBJ.BACKGROUND, 'objective ' + id + ' kind');
        check(o.text.split(/\s+/).length <= 12, 'objective ' + id + ' text ≤ 12 words');
        check(['plot', 'cove', 'landing', 'crown', 'ring', 'target'].indexOf(o.showMe) >= 0, 'objective ' + id + ' showMe');
        check((o.reward.grant === 50000) !== (o.reward.prestige === 2), 'objective ' + id + ' has exactly one reward');
      }
      check(D.tabs.length === 10 && D.tabs[0].id === 'essentials', '10 tabs, essentials first');
      const opp = Object.keys(D.opponents);
      check(opp.length === 9 && opp.filter(k => D.opponents[k].rival).length === 1 && opp.filter(k => D.opponents[k].crosstown).length === 1, '9 opponents, one rival, one crosstown');
      check(D.tutorial.length === 7 && D.tutorial.every((t, i) => t.stage === i && t.card.split(/\s+/).filter(Boolean).length <= 12), '7 tutorial stages, cards ≤ 12 words');
      check(D.thibodeaux.length >= 8 && D.stormQuotes.length >= 6, 'thibodeaux ≥ 8, stormQuotes ≥ 6');
      // 7b. UX tables: a guide line for every objective (+ the accreditation pair), needs/requirements/coach shapes
      for (const id of BSU.OBJECTIVE_IDS.concat(['p1', 'p2'])) { const g = D.guide[id]; check(!!g && g.why.length > 0 && Array.isArray(g.build) && g.build.every(b => !!C[b]), 'guide ' + id); }
      check(['beds', 'seats', 'dining', 'power', 'water', 'wastewater', 'parking'].every(k => D.needs[k] && !!C[D.needs[k].build] && D.needs[k].label.length > 0), 'needs table');
      check(['power', 'water', 'path', 'road', 'marsh'].every(k => D.requirements[k].glyph && D.requirements[k].text) && Object.keys(D.requirements.place).length === 15, 'requirements table');
      check(D.coach.length === 6 && D.coach.every(c => c.id && c.title && c.text.length > 0 && typeof c.target === 'string'), '6 coach steps');
      check(D.keys.some(k => k.key === 'g' && k.action === 'buildMenu' && !k.ctrl && !k.shift) && !D.keys.some(k => k.key === 'q'), 'G opens the build menu; Q stays unbound');
      check(D.overlays.length === 6 && D.overlays[2].legend.join() === 'Ambient,Annoying,Biblical,State Bird', '6 overlays, K legend');
      check(D.failureCards.bankruptcy.options.length === 3 && D.failureCards.underwater.options.length === 1 && D.failureCards.probation.options.length === 1, 'failure cards');
      // 8. frozen
      check(Object.isFrozen(D) && Object.isFrozen(D.catalog.dorm.effects) && Object.isFrozen(D.ticker) && Object.isFrozen(D.catalog.stadium.tiers[0].unlock), 'data deep-frozen');
      // 9. tabs cover every row except founders_hall exactly once outside essentials
      const seen = {};
      for (const t of D.tabs) if (t.id !== 'essentials') for (const id of t.rows) { seen[id] = (seen[id] || 0) + 1; check(!!C[id], 'tab row ' + id + ' exists'); }
      for (const r of L) check(r.id === 'founders_hall' ? !seen[r.id] : seen[r.id] === 1, r.id + ' in exactly one non-essentials tab');
      check(D.tabs[0].rows.every(id => C[id] && C[id].essentials) && L.filter(r => r.essentials).length === 7, 'essentials flags match the tab');
      // 10. keys unique per {key, ctrl, shift}
      const triples = new Set();
      for (const k of D.keys) {
        const sig = k.key + '|' + !!k.ctrl + '|' + !!k.shift;
        check(!triples.has(sig), 'duplicate key binding ' + sig);
        triples.add(sig);
        check(typeof k.action === 'string' && k.action.length > 0, 'key ' + k.key + ' has an action');
      }
      // 11. sanity numbers
      check(C.dorm.cost === 700000 && C.dorm.effects.beds === 300 && C.dorm.effects.quality === 2, 'dorm numbers');
      check(C.stadium.tiers.length === 3 && C.stadium.tiers[1].name === 'The Cauldron' && C.stadium.tiers[2].cost === 32000000, 'stadium tiers');
      check(C.practice_field.tiers.length === 1 && C.practice_field.tiers[0].seats === 6000, 'Bayou Field tier');
      check(C.levee.effects.crest === 6 && C.floodwall.effects.crest === 12 && C.pump.effects.pumpTileFt === 15, 'levee/floodwall/pump numbers');
      check(C.substation.effects.power.radius === 10 && C.substation.effects.power.capacity === 40 && C.water_tower.effects.water.radius === 12, 'utility radii');
      check(C.library.cost === 1800000 && C.engineering.cost === 2600000 && C.surge_barrier.cost === 6000000 && C.marsh_restoration.cost === 4000000, 'big-ticket costs');
      check(C.pilings.cost === 0 && C.pilings.upkeep === 0 && C.pilings.kind === 'upgrade', 'pilings row');
      check(C.rookery.alwaysPilings && C.coastal_institute.alwaysPilings && !C.dorm.alwaysPilings, 'alwaysPilings');
      check(!C.founders_hall.demolishable && !C.stadium.demolishable && C.dorm.demolishable, 'demolishable');
      check(C.dorm.shelterOwn && C.res_tower.shelterOwn && !C.library.shelterOwn, 'shelterOwn');
      check(D.rainKinds.hurricane.inches.length === 5 && D.rainKinds.cell.steps === 60 && D.rainKinds.shower.total === 0.04, 'rainKinds');
      notes.push('ticker 62, storms 26, gators 14, milestones 26, objectives 25, keys ' + D.keys.length);
    } catch (e) {
      fails.push('threw: ' + ((e && e.message) || String(e)));
    }
    if (fails.length) notes.unshift(fails.length + ' failures: ' + fails.slice(0, 12).join(' | '));
    return { ok: fails.length === 0, notes: notes.join('; ') };
  };

  BSU.data = deepFreeze(data);
})();
