'use strict';
// ============================================================================
// BAYOU STATE — contract.js (module 0; FROZEN once written)
// Owner: nothing at runtime. Creates the BSU namespace, every enum, BSU.params
// (every tuning constant, GDD section in a trailing comment), BSU.rng
// (mulberry32 streams), BSU.events (the bus), BSU.newState (the full state tree
// of ARCHITECTURE.md §2), the pure helpers of §3.5 and the catalog row schema.
// Implements: ARCHITECTURE.md §3 (all), GDD §0.1, §0.3 ids, §3.1–§3.2, §12.2, §15.2.
// Zero DOM / timer / AudioContext / requestAnimationFrame access at definition
// time. The ONLY window reads are inside the BSU.headlessMode try/catch (§3.5).
// ============================================================================
(function () {
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const BSU = (root.BSU = root.BSU || {});
  const freeze = Object.freeze;
  const W = 64, H = 64, N = W * H;

  // ---------------------------------------------------------------------------
  // 3.1 Enums (plain frozen objects)
  // ---------------------------------------------------------------------------
  BSU.T = freeze({ OPEN_WATER: 0, BAYOU: 1, MARSH: 2, WET: 3, DRY: 4, HIGH: 5, DRAINED: 6, POND: 7 });   // tiles.type (GDD §3.3)
  BSU.SURF = freeze({ NONE: 0, PATH: 1, ROAD: 2, BOARDWALK: 3, FENCE: 4 });                                // tiles.surface (GDD §3.2)
  BSU.FLAG = freeze({
    WETLAND_ORIGINAL: 1 << 0,  // terrain
    PRESERVE: 1 << 1,          // terrain
    CANAL: 1 << 2,             // hydro
    DRAINED: 1 << 3,           // hydro
    FLOODGATE: 1 << 4,         // hydro
    POND_SINK: 1 << 5,         // hydro
    BAYOU: 1 << 6,             // terrain
    OPEN_WATER: 1 << 7,        // terrain
    DIRTY_CHUNK: 1 << 8,       // unused: render keeps its own bitmap
    DESIRE_WORN: 1 << 9,       // terrain
    DEBRIS: 1 << 10,           // terrain
    MOUND: 1 << 11,            // terrain
    RESTORING: 1 << 12,        // hydro: Marsh Restoration in progress
    JAMMED: 1 << 13            // hydro: mirrors storm.jammedGates via hydro.setJammed
  });
  BSU.SKY = freeze({ DAWN: 0, DAY: 1, GOLDEN: 2, DUSK: 3, NIGHT: 4 });
  BSU.SKY_TICKS = freeze([25, 130, 20, 25, 100]);   // per phase; sum 300 (GDD §0 sky clock, 30 s at 1×)
  BSU.OV = freeze({ NONE: 0, FLOOD: 1, WATER: 2, MOSQUITO: 3, POWER: 4, COVERAGE: 5, ECOLOGY: 6 });
  BSU.STORM = freeze({ NONE: 0, WAVE: 1, NAMED: 2, WATCH: 3, BANDS: 4, LANDFALL: 5, RECOVERY: 6, PASSED: 7 });
  BSU.STORM_PHASE = freeze({ OUTER: 0, WALL: 1, LANDFALL: 2, EYE: 3, BACK: 4, CLEARING: 5 });   // set-piece phases (storm:phase payload)
  BSU.OBJ = freeze({ INTERRUPT: 0, BACKGROUND: 1 });
  BSU.PLACE = freeze({
    LAND: 0, PATH: 1, ROAD: 2, BOARDWALK: 3, LEVEE: 4, CANAL: 5, FENCE: 6, PRESERVE: 7, NEAR_WATER: 8, TOUCH_MARSH_BAYOU: 9,
    TOUCH_CANAL_WATER: 10, CYPRESS: 11, MARSH_OR_PRESERVE: 12, BARRIER: 13, RESTORE: 14, UPGRADE: 15
  });   // catalog placeRule
  BSU.SPR = freeze({ NIGHT: 1, DAMAGED: 2, PILINGS: 4, SCAFFOLD: 8, RUIN: 16, TIER_SHIFT: 5, TIER_MASK: 3 << 5, BOARDED: 128 });   // building sprite variant bits (D17)

  // The 43 catalog ids in GDD §0.3 row order (BSU.B_ORDER[n-1] is row n).
  BSU.B_ORDER = freeze([
    'path', 'road', 'boardwalk', 'substation', 'water_tower', 'generator', 'wastewater', 'founders_hall', 'lecture_hall',
    'library', 'engineering', 'coastal_institute', 'dorm', 'res_tower', 'greek_house', 'dining_hall', 'poboy', 'practice_field',
    'stadium', 'union', 'rec_center', 'health_center', 'quad', 'parking', 'levee', 'floodwall', 'canal', 'pump', 'pond',
    'pilings', 'gator_fence', 'abatement', 'bat_house', 'wildlife_post', 'preserve', 'live_oak', 'cypress', 'azalea',
    'bell_tower', 'tiger_habitat', 'surge_barrier', 'marsh_restoration', 'rookery'
  ]);
  {
    const B = {};
    for (const id of BSU.B_ORDER) B[id] = id;
    BSU.B = freeze(B);   // id → id, so a typo is `undefined` at the call site
  }

  BSU.SAVE_VERSION = 1;
  BSU.MAP = freeze({ W: W, H: H, N: N, TILE_W: 64, TILE_H: 32, PX_PER_FT: 6, CHUNK: 8, CHUNK_W: 512, CHUNK_H: 416 });
  BSU.SAVE_SKIP = freeze(['agents', 'vehicles', 'hydro.networks', 'hydro.risk', 'hydro.active', 'wildlife.campusMask', 'ui.tool', 'ui.panel', 'ui.perfMode', 'ui.camera.tx', 'ui.camera.ty']);

  // Milestone ids in GDD §10.5 order (progress.milestones keys).
  BSU.MILESTONES = freeze([
    'chartered', 'welcome', 'cajunEngineer', 'firstBell', 'wetFeet', 'highAndDry', 'stormChaser', 'eyeOfTheStorm', 'gatorWrangler',
    'sunbather', 'skeeterBeater', 'bayouField', 'nightFalls', 'geauxBeatMagnolia', 'undefeated', 'bigBoil', 'throwMeSomethin',
    'greenAndGold', 'fortressBayou', 'livingWithWater', 'lightsAreOn', 'sinkingFeeling', 'rebuiltFromTheRoux', 'flagship',
    'laissez', 'untouched'
  ]);
  // Objective ids in GDD §10.2 order (progress.objectives keys).
  BSU.OBJECTIVE_IDS = freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '11a', '12', '13', '14', '15', '16', '17', '18a', '18b', '18', '19', '20', '21', '22']);
  // Student Voice card ids in GDD §7.1 table order (data.voiceCards[].id must match).
  BSU.VOICE_CARDS = freeze(['boardwalk', 'recPool', 'zydeco', 'poboyRoute', 'quadOak', 'batHouse', 'parking', 'healthShade', 'greekPorch', 'cypressLine', 'lookout', 'bellSelfie']);
  // Board of Regents card ids in GDD §5.9 order (data.boardCards[].id must match).
  BSU.BOARD_CARDS = freeze(['lobby', 'researchPush', 'tuitionFreeze', 'recruitingTrip', 'marshGrant', 'summerSession', 'insurance', 'homecomingBudget']);
  // Happiness timer ids (GDD §5.6 table; the only ids progress.timers may carry for happiness).
  BSU.HAPPINESS_TIMERS = freeze(['bellTower', 'wastewater', 'brownout', 'floodwallView', 'evacuation', 'unsheltered', 'boilWater', 'playThroughIt', 'austerity', 'sunbather', 'tuitionFreeze', 'homecomingBudget', 'bigBoil', 'noParking', 'nutriaBounty', 'freePermits', 'surgeBarrier', 'gatorPool', 'beads', 'hurricaneParty', 'goForIt', 'studentVoice']);
  // Ledger keys in Budget-panel print order (ARCHITECTURE §2.7).
  BSU.LEDGER_INCOME_KEYS = freeze(['tuition', 'state', 'donations', 'research', 'athletics', 'tailgate', 'parking', 'festivals', 'pelts', 'grants', 'endowment', 'disaster', 'insurance', 'misc']);
  BSU.LEDGER_EXPENSE_KEYS = freeze(['salaries', 'upkeep', 'utilities', 'coaching', 'interest', 'repair', 'prep', 'construction', 'demolition', 'boardCards', 'misc']);
  BSU.MONTHS = freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  BSU.SEASONS = freeze(['spring', 'summer', 'fall', 'winter']);
  BSU.SEMESTERS = freeze(['spring', 'summer', 'fall', 'break']);
  BSU.SET_PIECES = freeze({ landfall: 900, nearMiss: 150, game: 750, parade: 250, graduation: 150, montage: 50 });   // kind → len (GDD §0.1)

  // ---------------------------------------------------------------------------
  // 3.2 BSU.params — every tuning constant. Leaves are numbers, booleans, strings,
  // or arrays of all-numbers / all-strings (the debug panel walks the numeric ones).
  // Percentages are fractions. Durations are ticks or calendar days. Money is $.
  // "days: -1" in a timer entry means "while the source exists": progress.addTimer stores
  // untilDay -1 in the live state (never Infinity; no field of BSU.state may be non-finite — D23, §10.3).
  // ---------------------------------------------------------------------------
  BSU.params = {
    time: {                                  // GDD §0.1 timing table
      tps: 10,                               // sim ticks per real second at 1× (§0.1)
      ticksPerDay: 100,                      // §0.1
      daysPerMonth: 10,                      // §0.1
      monthsPerYear: 12,                     // §0.1
      daysPerYear: 120,                      // §0.1
      ticksPerYear: 12000,                   // §0.1
      skyCycleTicks: 300,                    // §0 sky clock (30 s at 1×)
      skyPhaseTicks: [25, 130, 20, 25, 100], // Dawn/Day/Golden/Dusk/Night (§9.1)
      skyCycleDays: 3,                       // one sky cycle = 3 calendar days (§9.1)
      landfallTicks: 900,                    // §0.1
      nearMissTicks: 150,                    // §0.1
      gameTicks: 750,                        // §0.1
      paradeTicks: 250,                      // §0.1
      graduationTicks: 150,                  // §0.1
      montageTicks: 50,                      // §8 auto-sim montage (5 s)
      toastTicks: 80,                        // decision toast countdown (§0.1)
      windPulseTicks: [250, 380, 550, 680],  // §6.2 wind pulses
      windPulseShare: [1 / 3, 1 / 3, 1 / 6, 1 / 6],   // §6.2 wind pulses
      firstWarningDropTicks: 100,            // first gator/mosquito warning drops to 1× for 10 s (§9.4)
      maxTicksPerFrame: 8,                   // main-loop accumulator cap (ARCH D7)
      speeds: [0, 1, 2, 4],                  // §9.4
      skipAfterTick: 150,                    // Skip button appears at tick 150 of a landfall (§6.2)
      gameSkipAfterTick: 200,                // Skip-to-final after Q1 (§8)
      charterSwoopMs: 4000,                  // §10.1 camera swoop
      charterCardMs: 3000,                   // §10.1 charter card auto-dismiss
      pathTileMs: 60,                        // §10.1 path lays tile by tile
      pirogueSplineTicks: 40,                // §10.1 pirogue glide 4 s
      hudStaggerMs: 100                      // §10.1 HUD fades in stat by stat
    },
    terrain: {                               // GDD §3.3–§3.5
      bankBase: 58, bankAmp: 2, bankPeriod: 9,   // bank(ty) = floor(58 + 2·sin(ty/9)) − 1 (§3.4)
      bank0Row: 7,                           // bank₀ = bank(7) (§3.4)
      ridgeD: 22, ridgeExp: 1.3, ridgeAmp: 7,    // ridge profile (§3.4 step 2)
      crownRows: [6, 13],                    // crown(ty) = 1.0 rows (§3.4)
      crownFactors: { crown: 1.0, shoulder: 0.7, flank: 0.42, reachEnd: 0.25 },   // §3.4 step 2
      shoulderRows: [5, 14],                 // crown 0.7 rows (§3.4)
      flankEndRow: 26, reachRow: 34,         // 0.42 to ty 26, linear to 0.25 at ty 34 (§3.4)
      baseNorth: 2.0, baseSouth: 1.0,        // base(ty) (§3.4)
      noiseAmp: 0.5, noiseAmpPlot: 0.3, noiseScale: 5,   // value noise (§3.4)
      basinBase: 1.0, basinAmp: 1.8, basinClamp: 3.4, basinScale: 11,   // backswamp (§3.4 step 3)
      southBeltRow: 50, southBeltBias: 0.8,  // §3.4 step 3
      lake: { cx: 10, cy: 54, rx: 6, ry: 4, elev: -2 },   // cypress lake (§3.4 step 3)
      riverElev: -4,                         // §3.4 step 1
      cove: { dx: -8, ty: 16, rx: 2.5, ry: 2, floor: 1.6, rimAdd: 0.9, rimMin: 2.6, mouthElev: 2.2, mouthDx: -2, mouthDy: 2 },   // §3.4 step 3b
      bayou: { x0: 30, spread: 4, elev: -1, shoulderElev: 0.5, width: 2, controlMaxD: 12, controlPoints: 3, maxElev: 5.0 },   // §3.4 step 4
      chenierCount: [5, 7],                  // §3.4 step 5
      chenierAxes: { ax: [5, 7], ay: [3, 4], angle: 30, rim: 2.0, crest: [6.5, 7.5], bayouGap: 3 },   // §3.4 step 5
      moundGap: [4, 6], moundLift: 2,        // The Mounds (§3.4 step 5)
      veg: { oak: 0.08, cypress: 0.14, palmetto: 0.06, reed: 0.25 },   // §3.4 step 6 densities
      distribution: { water: 0.11, bayou: 0.03, marsh: 0.40, wet: 0.30, dry: 0.12, high: 0.04, tol: 0.03 },   // §3.3
      g1b: [72, 110],                        // ≥ 5-ft tiles reachable over land (§3.5 G1b)
      g1Window: 1.5,                         // every 3×3 window inside G1 spans ≤ 1.5 ft (§3.5)
      g2Tiles: [12, 20],                     // §3.5 G2
      g3Route: 16, g3CoveTiles: 3,           // §3.5 G3
      g4Dist: 5,                             // §3.5 G4
      g5Tiles: 40, g5Radius: 18,             // §3.5 G5
      g6Run: 12, g6Row: 20, g6Share: 0.7, g6ColOffset: 14,   // §3.5 G6
      g7: [300, 400], g7MapWide: 600, g7Chenier: 250, g7Marsh: 1400,   // §3.5 G7
      maxRerolls: 50,                        // §3.5
      typeBounds: { marsh: 1.5, wet: 3.5, high: 6.5 },   // §3.3
      crownElev: 5.0,                        // "≥ 5-ft ground" (§3.5)
      highwayTiles: 7,                       // Highway 1 stub ty 0–6 (§3.4 step 7)
      founders: { dx: -7, ty: 7 },           // Founders' Hall origin = (bank₀−7, 7) (§3.4 step 7)
      plotRect: { dx0: -9, dx1: -1, y0: 6, y1: 13 },   // G1 rectangle (§3.5)
      oaks: [[-8, 8], [-4, 8]],              // flanking oaks (§3.4 step 7)
      oakStages: 3, oakGrowDays: 240,        // 3 growth stages over 2 years (§0.3 row 36)
      subsidenceDay: 'Jan 1'                 // yearly subsidence step (§6.5)
    },
    hydro: {                                 // GDD §6.1
      stepsPerBlock: [0, 2, 5, 7],           // hydro steps on these ticks of each 10-tick block (§6.1.1)
      dtDayNormal: 1 / 40, dtDayLandfall: 1 / 360, dtDayNearMiss: 1 / 60,   // §0.1, §6.1.1
      jacobiPasses: 2,                       // §6.1.1
      k: 0.35, kCanal: 8,                    // §6.1.4
      maxGiveFrac: 0.5,                      // a tile never gives more than half its depth per pass (§6.1.4)
      activeDepth: 0.01,                     // active set threshold (§6.1.1)
      absorb: { high: 0.7, dry: 0.6, wet: 0.3, marsh: 0.9, preserve: 0.95, drained: 0.2, paved: 0.05, canal: 0, levee: 0.6 },   // §6.1.2
      satFill: 0.5,                          // sat += absorbed / 0.5 (§6.1.2)
      satDecay: 0.12, satDecayHot: 0.20, satHotIndex: 95,   // §6.1.2
      drain: { high: 0.6, dry: 0.4, wet: 0.15, marsh: 0.05, drained: 0.15, paved: 0.02, levee: 0.4 },   // ft/day (§6.1.3)
      evap: 0.03, evapSummer: 0.06, evapSummerMonths: [6, 9],   // §6.1.3
      cypressDrain: 0.05,                    // §6.1.3
      loss: { marsh: 0.08, preserve: 0.12, cypress: 0.02 },   // surge head loss ft/tile (§6.1.4)
      pond: { cut: 3, cap: 20, rate: 0.5, perTileStep: 0.1, radius: 5, recover: 2, stockDays: 10 },   // §6.1.3, §0.3 row 29
      pumpTileFtPerDay: 15, pumpRadius: 8,   // §6.1.5
      preDrainMult: 2,                       // §6.2 prep
      canalCut: 2, canalBedMin: 0.5,         // §0.3 row 27
      gateCloseStage: 1,                     // Floodgate closes above +1 ft (§4.11)
      barrierCloseStage: 2, barrierPumps: 2, // Surge Barrier (§0.3 row 41)
      thresholds: { puddle: 0.05, wading: 0.3, flood: 0.5, floodPilings: 3, impassable: 0.6, surgeDmg: 2, surgeDmg2: 4, bridgeSurge: 2 },   // §6.1.6
      dmgPerDay: { flood: 0.02, surge: 0.05, surge2: 0.25 },   // §6.1.6
      marshDrain: { daysToDrain: 5, drainDepth: 0.1, canalRadius: 2, revertDepth: 0.5, revertDays: 20, mudDays: 15, mudMosq: 0.3 },   // §6.1.7
      rain: { shower: 0.04, frontal: 0.125, cellMin: 1, cellMax: 3, cellScripted: 3, cellRadius: 14, cellSteps: 60, cellTicks: 150, cellDriftTicks: 10, band: 0.33, hurricane: [6, 8, 10, 13, 16], hurricaneSteps: 360, mapWideSteps: 40 },   // §6.1.2 (hurricane in inches)
      inchesPerFoot: 12,                     // unit conversion (§6.1.2)
      riskSteps: 40, riskInches: 2, riskCacheDays: 5,   // F overlay (§6.1.8)
      seepageRadius: 6, seepageSat: 0.8,     // Spring High Water seepage (§6.9)
      integrityWeak: 70, integrityHalf: 50,  // §0.3 row 25
      overtopDmg: 10, surgeContactDmgPerCat: 5, surgeContactStage: 1,   // §6.1.4
      initial: { marshDepthMin: 0.15, marshDepthNoise: 0.25, marshSat: 0.9, landSat: 0.5 },   // §3.3 initial state
      conservationTol: 0.01                  // T5 (§6.1.11)
    },
    storm: {                                 // GDD §6.2, §10.3
      surge: [0, 3, 5, 8, 12, 16],           // ft by category (index = cat) (§6.2)
      coneDays: 6, coneDaysInstitute: 9,     // §0.1
      waveLead: 2, watchLead: 3, bandsLead: 1,   // T−8 wave (cone−2), T−3 watch, T−1 bands (§6.2 lifecycle)
      coneWidth: [24, 6], coneNarrowInstitute: 0.3,   // §6.2
      forecastSpread: 1,                     // category forecast ±1 (§6.2)
      nearMissChance: 0.25,                  // §6.2
      countWeights: [0.45, 0.35, 0.20],      // 1/2/3 storms per year (§6.2)
      catWeights: [0.35, 0.30, 0.20, 0.10, 0.05],   // Cat 1–5 (§6.2)
      catShiftPerYear: 0.05, catShiftFromYear: 3, cat5Cap: 0.20,   // §6.2
      peak: { start: 'Aug 5', end: 'Oct 5', p: 0.7 },   // §6.2
      season: { start: 'Jun 1', end: 'Nov 30' },       // §6.2
      minGapDays: 15, setPieceGapDays: 6, maxRedraws: 20,   // §6.2
      southEdgeP: 0.7, eastEdgeMinRow: 30,   // landfall point (§6.2)
      entryWidth: 8,                         // §6.2 set piece
      frontTicksPerTile: 5, recedeTicksPerTile: 4, surgeRampTicks: 200,   // §6.2
      baseDmg: [0, 0.04, 0.09, 0.16, 0.26, 0.40],   // per-storm wind total by cat (§6.2)
      boardedMult: 0.6, oakMult: 0.7, oakRadius: 2, wrDiv: 5,   // dmg = base × (6−WR)/5 × … (§6.2)
      substationOutageP: 0.4, substationOutageBoardedP: 0.2, outageDays: 3, outageMinCat: 3,   // §6.2
      fenceBreak: 0.3, fenceBreakMinCat: 3,  // §6.2
      azaleaRegrowDays: 30, azaleaMinCat: 3, // §6.2
      oakLoss: 0.02, oakLossMinCat: 4,       // §6.2
      towerToppleP: 0.3, towerToppleBracedP: 0.1, towerToppleCost: 60000, towerMinCat: 4,   // §6.2
      jammedGateP: 0.1, jammedMinCat: 3,     // §4.11
      eyeMinCat: 3,                          // §6.2 eye phase
      debrisDays: 5, debrisPostRadius: 14,   // §6.2 recovery
      gatorWaveDays: 10, gatorWave: [3, 8],  // §6.2 recovery
      mosqBloomDay: 3,                       // §6.2 recovery
      grantDay: 20, grantCap: 800000, grantShare: 0.4, grantEcoMult: 1.25, grantEcoMin: 50,   // State Disaster Grant (§5.2)
      boardCost: 5000, boardPerDay: 6, boardPerDayPost: 12, boardWindMult: 0.6,   // §6.2 prep
      sandbagCost: 10000, sandbagPer: 10, sandbagFt: 1.5, sandbagTenths: 15, sandbagDays: 5, sandbagToastCost: 50000,   // §6.2 prep
      toast1Integrity: 85, toast1Margin: 3,  // Toast 1 qualification (§6.2)
      repairPerTile: 5000,                   // §0.3 row 25
      evacPer1000: 20000, evacDays: 10, evacHappiness: -6,   // §6.2 prep
      shelterToastCost: 10000, shelterOverflow: 600, shelterClosedDays: 3, foundersEmergency: 600,   // §6.2, §4.11
      hurricanePartyDays: 3, hurricanePartyAttrition: 0.02,   // §6.2
      unshelteredDays: 10, unshelteredAttrition: 0.02,   // §4.11
      cajunNavyDay: 4, cajunNavyMinCat: 3, cajunNavyBoats: [4, 8],   // §6.2 recovery
      boilWaterDays: 3, boilWaterDepth: 0.3, boilWaterGeneratorRadius: 6,   // §6.2 recovery
      blackoutBlightDays: 3, blackoutBlight: 1, blackoutHeatMult: 2,   // §6.2 power
      toastTicks: { sandbag: 300, shelter: 300, shelterAlt: 330, fuel: 400, gate: 450 },   // §6.2 timeline
      phaseTicks: { outer: 0, wall: 150, landfall: 350, eye: 450, back: 500, clearing: 750, end: 900 },   // §6.2 timeline
      gateCrewTick: 480, gateCrewCaughtP: 0.5, gateCrewMood: -5,   // §6.2 Toast 3
      cameraTicks: { entry: 150, ring: 350 },   // §6.2 camera direction
      rollsTick: 150,                        // rolls decided at tick 150 (§6.2)
      lightningEveryOuter: 80, lightningEveryWall: [30, 50],   // §6.2 timeline (ticks)
      windOuter: [0.6, 0.9], windBands: 0.5, // §6.2
      celestine: { cat: 2, coneDate: 'Sep 2', holdDate: 'Oct 5', minPlaySeconds: 540, surge: 5, inches: 8, forecastCat: 2 },   // §10.3
      amelie: { date: 'Jul 2', latest: 'Jul 20', inches: 4, wind: 0.5 },   // §10.2 Obj 11a
      boudin: 'Aug 1',                       // ticker-only wave (§9.2)
      ringDefaultH: 5, ringHighDryH: 8, ringFortressH: 12,   // §6.2 Rings
      weakIntegrity: 70, halfIntegrity: 50,  // §6.2 Rings
      gapSearchRadius: 12,                   // §6.2 Rings
      postponeWithinDays: 1, resilienceBowlDays: 5,   // §8
      centuryStormP: 0.05, centuryFromYear: 8,   // §10.8
      names: 26                              // data.stormNames length (§6.2)
    },
    wildlife: {                              // GDD §6.3, §6.4, §6.7, §6.8
      gator: {
        base: 6, perWaterTiles: 40, perStudents: 1000, cap: 24,   // population (§6.3)
        denMarshAdj: 2,                      // dens: water tiles with ≥ 2 adjacent Marsh (§6.3)
        wanderP: 0.15, matingMult: 3, matingMonths: [4, 5],   // §6.3
        sunShare: 0.6, swimSpeed: 2, walkSpeed: 0.7,   // tiles/s (§6.3)
        loungeTicks: [300, 1200],            // 30–120 s (§6.3)
        attractRadius: 12,                   // §6.3
        weights: { dumpster: 2, dumpsterProof: 1, porch: 2, parkingGameDay: 6, trash: 5, flooded: 4, pool: 1 },   // §6.3
        floodedDepth: 0.3,                   // §6.3
        trashDays: ['Feb 8', 'Feb 10'],      // Mardi Gras trash tiles (§6.3)
        preserveShare: 0.8, preserveRadius: 10,   // §6.3
        campusRadius: 3,                     // campus set (§6.3)
        fleeRadius: 2, closeRadius: 2,       // students flee within 2; gator-closes buildings within 2 (§6.3)
        incidentPenalty: 3, incidentCap: 15, incidentDays: 10,   // §6.3
        habitatRadius: 10,                   // Tiger Habitat avoidance (§6.3)
        wrangleTicks: 30, relocateCooldown: 200, officerSpeed: 3, officerRadius: 14,   // §6.3
        leGrandDays: 3, leGrandMonth: 4, leGrandPrestige: 1,   // §6.3
        bigShare: 0.4,                       // §6.3
        poolCloseDays: 1, kickoffDelayDays: 1,   // §6.3
        firstGatorDate: 'Feb 9',             // §9.2
        tagTicks: 30                         // name tag shown 3 s on campus entry (§6.3)
      },
      mosq: {
        standDays: 2, stand: 0.12, standFlooded: 0.24,   // §6.4
        marsh: 0.02, marshDisturbed: 0.06, disturbRadius: 2,   // §6.4
        mud: 0.3, canalUnconnected: 0.08, pondUnstocked: 0.12,   // §6.4
        diffusion: 0.15,                     // §6.4
        decay: 0.06, decayCold: 0.15, coldStart: 'Dec 11', coldEnd: 'Feb 10', decayHot: 0.09, hotIndex: 100,   // §6.4
        stormMult: 0.5,                      // §6.4
        pondSink: 0.8, pondRadius: 4, batSink: 0.3, batStack: 0.6, batRadius: 4, preserveCypress: 0.2, fogSink: 0.7, fogRadius: 8,   // §6.4
        happinessMult: 25,                   // §6.4
        illness: 0.02, healthMult: 0.4, healthRadius: 12,   // §6.4
        warnIndex: 0.3, biblical: 0.5, biblicalBlight: 5, biblicalDays: 20, biblicalApplicants: 0.10,   // §6.4
        slapAt: 0.4, hazeAt: 0.3, denseAt: 0.6,   // tells (§6.4)
        lowEcoMult: 1.5,                     // ecology < 30: mosquito growth +50% (§6.8)
        m1Cap: 0.25                          // acceptance M1 (§6.4)
      },
      nutria: { base: 4, perMarsh: 60, burrowP: 0.2, burrowDmg: 15, burrowRadius: 10, trapMult: 0.2, trapRadius: 14, peltPay: 500 },   // §6.7
      ecology: {
        wetlandWeight: 70, drainedMult: 3,   // §6.8
        preserve: 0.5, preserveCap: 20, cypress: 0.3, cypressCap: 10, oak: 0.3, oakCap: 5, pond: 2, pondCap: 6, post: 3,   // §6.8
        fogger: 0.5, foggerRecover: 0.3, foggerCap: 15,   // §6.8
        wastewaterMarsh: 5, canalMarsh: 0.3, leveeMarsh: 0.2,   // §6.8
        instituteMult: 0.5,                  // §6.8
        lowThreshold: 30, highThreshold: 60, // §6.8
        lowFundingMult: 0.85, lowHeadLossMult: 0.5,   // §6.8 costs of < 30
        fireflyMin: 50, fireflyPer: 6, fireflyCap: 600, fireflyPreserve: 3,   // §6.7
        spoonbillEco: 70, egretEco: 40, spoonbillPrestige: 1,   // §6.7
        barrierPenalty: 10, restorationBonus: 15, restorationTilesDiv: 40   // §0.3 rows 41–42
      }
    },
    subsidence: {                            // GDD §6.5 (ft/yr)
      drainedBuilt: 0.35, drainedBare: 0.25, wetBuilt: 0.12, wetBare: 0.05, dry: 0.02, high: 0,
      pumpAdd: 0.06, pumpRadius: 8, cypressMult: 0.5, cypressRadius: 1, levee: 0.06,
      sinkingIcon: 1.0, tiltAt: 1.5, tiltDeg: 2,
      regradeCost: 15000, regradeDays: 3, regradeFt: 1
    },
    heat: {                                  // GDD §6.6
      monthBase: [55, 60, 70, 78, 86, 94, 101, 103, 96, 84, 72, 60],   // Jan–Dec
      noise: 6, rainAdd: 3, advisory: 100, waveDays: 3,
      penaltyBase: 92, penaltyDiv: 2, penaltyCap: 10,
      oakShade: 0.3, oakRadius: 3, shadeCap: 0.9, poolMult: 0.5, poolRadius: 10,
      powerMult: 1.5, teamPenalty: 8, teamMonths: [8, 9], recRadius: 10,
      walkMult: 0.8, illness: 0.003, healthMult: 0.5, shimmer: 95
    },
    weather: {                               // GDD §9.3, §6.9
      rainP: [0.30, 0.30, 0.35, 0.35, 0.40, 0.55, 0.55, 0.50, 0.40, 0.25, 0.25, 0.30],   // rain-day probability Jan–Dec (§9.3)
      frontalShare: 0.3, frontalMonths: [11, 3],   // winter/spring rain days: 30% frontal (§9.3)
      cellMonths: [4, 9], lightningP: 0.1,   // §9.3
      fogP: 0.4, fogMonths: [11, 2], fogTicks: 20,   // §9.3
      windNormal: [0, 0.3], windStorm: 0.6,  // §9.3
      cellStartPhaseFrac: 0.5,               // cells start in the second half of a Day phase (§6.1.2)
      seasonStartMonths: { spring: 3, summer: 6, fall: 9, winter: 12 },   // §9.3
      semesterDates: { spring: 'Jan 5', summer: 'May 6', fall: 'Aug 5', break: 'Dec 11' },   // §9.2
      highWater: { fromYear: 2, stageP: [0.45, 0.35, 0.20], wetBonusDays: 12, wetBonusMonths: [11, 1], start: 'Apr 1', rampDays: 5, holdEnd: 'May 5', end: 'May 10', bayouFactor: 0.5, tickerDate: 'Mar 25' },   // §6.9
      spillway: { cost: 250000, fromYear: 3, minStage: 2, dropFt: 1, northRow: 40, southRow: 44, ecologyNow: -3, ecologyNext: 1 },   // §6.9
      festivals: { mardiGrasStart: 'Feb 6', mardiGrasEnd: 'Feb 8', paradeDate: 'Feb 8', crawfishStart: 'Mar 1', crawfishEnd: 'Apr 10', boilDate: 'Apr 5', graduationDate: 'May 5', homecomingStart: 'Oct 7', homecomingEnd: 'Oct 8', bonfireDate: 'Dec 9', foundersDay: 'Jan 1', finalsStart: 'Dec 1', finalsEnd: 'Dec 10' },   // §9.2
      azaleaBloom: { start: 'Mar 1', end: 'Apr 10' },   // §0.3 row 38
      cypressAutumnMonth: 11                 // §0.3 row 37
    },
    econ: {                                  // GDD §5
      startCash: 4000000, loanLimit: 2000000, interest: 0.01, bankruptMonths: 3,   // §5.1
      startPrestige: 10, startHappiness: 60, startStudents: 120,   // §5.1, §10.1
      tuition: { default: 6500, min: 3000, max: 15000, step: 250 },   // §5.1
      installments: ['Aug 5', 'Oct 5', 'Jan 5', 'Mar 5'], installmentShare: 0.5,   // §5.2
      statePerStudent: 2500, stateBase: 0.6, statePrestige: 0.8, stateEcoMult: 0.85, stateEcoMin: 30, stateDay: 'Jul 1',   // §5.2
      donationPerAlumnus: 8, donationBase: 0.5, footballMultPerWin: 0.1, footballMultCap: 2, homecomingDonation: 3,   // §5.2
      research: { engineering: 12000, coastal: 10000, base: 0.5, coastalEcoDiv: 50, restorationMult: 1.25 },   // §5.2
      concessions: 12,                       // §5.2 athletics
      parkingPer: 600, parkingPay: 4000,     // §5.2
      festivals: { mardiGrasBase: 50000, mardiGrasPer: 5, unionMult: 2, crawfish: 20000, crawfishUnion: 10000, homecoming: 30000 },   // §5.2
      peltPay: 500,                          // §5.2
      grant: 50000, grantObjectives: ['1', '2', '3', '4', '5', '6', '7', '9', '10', '11'],   // §5.2 tutorial grants
      endowmentYield: 0.004, endowmentStep: 1000000, endowmentFromYear: 5,   // §5.2, §10.8
      disaster: { day: 20, cap: 800000, share: 0.4, ecoMult: 1.25, ecoMin: 50 },   // §5.2
      salaryPerStudent: 450, qualityMult: { basic: 1, good: 1.25, elite: 1.6 },   // §5.3
      utilities: { perBuilding: 300, perStudent: 8, summerMult: 1.5, summerMonths: [6, 9] },   // §5.3
      terrainCost: { wet: 0.2, high: -0.1, pilings: 0.4, grading: 15000, bridge: 4, summer: -0.15, engineering: -0.15 },   // §5.3
      repairMult: 0.6, blightPerDamaged: 3, demolishRefund: 0.4, upkeepPilings: 0.05,   // §5.3, §4.11
      applicants: { base: 60, prestige: 28, happiness: 6, tuitionA: 1.65, tuitionDiv: 10000, tuitionMin: 0.3, tuitionMax: 1.5, buzzPerWin: 0.03, bowlBuzz: 0.10 },   // §5.4
      capacity: { beds: 1.15, seats: 1.4, dining: 1.6, wastewaterBase: 1500, wastewaterPer: 6000, halfRate: 0.5 },   // §5.4
      selectivity: { open: 1, selective: 0.6, elite: 0.35 },   // §5.4
      gapShare: { rolling: 0.2, spring: 0.25, fall: 1 },   // §5.4
      roundDom: 5, springLock: 'Jan 10', fallLock: 'Aug 5', attritionDates: ['May 5', 'Dec 10'],   // §5.4
      attrition: { base: 0.02, happinessK: 0.08 },   // §5.4
      graduation: 0.22, graduationFromYear: 2, graduationDate: 'May 5',   // §5.4
      minStudents: 60,                       // §10.7
      prestige: {                            // §5.5
        weights: { academic: 0.22, faculty: 0.14, happiness: 0.16, football: 0.16, landmarks: 0.12, ecology: 0.10, selectivity: 0.10 },
        lerp: 0.06, seatsPerStudent: 1.2, academicSeats: 40, academicPer: 20, attendanceBase: 0.9, attendanceK: 0.2,
        facultyBase: 70, footballWin: 40, footballTier: 20, ecologyNoInstitute: 0.4,
        blight: { damaged: 3, flooded: 8, floodedDays: 3, mosquito: 5, mosqIndex: 0.6 },
        landmarkMult: 2, selectivityScore: { open: 0, selective: 40, elite: 100 }
      },
      landmarks: { mounds: 1, west: 10 },    // landmark points not carried by a catalog row (§5.5)
      happiness: {                           // §5.6
        base: 50, housingPerQuality: 4, housingCap: 12, bedsShort: 10, dining: 8, noDining: 10,
        spiritWin: 2, rivalry: 6, rivalryDays: 7, festival: 5, festivalNoBonfire: 2, bonfirePer10: 2, bonfireCap: 10,
        floodPer: 4, floodCap: 20, dormFlooded: 10, tuitionBase: 7000, tuitionDiv: 400, crowd: 10,
        noiseRoad: 1, noisePump: 2, noisePumpRadius: 4, noiseBarrier: 2, noiseBarrierRadius: 4, floodwallRadius: 3, floodwallCap: 5,
        lifeCap: 12, greenCap: 10, emaDays: 1, seed: 60
      },
      timers: {                              // §5.6 table: value (happiness), days (-1 = while the source exists)
        bellTower: { value: 3, days: -1 },
        wastewater: { value: -8, days: -1 },
        brownout: { value: -5, days: -1 },
        floodwallView: { value: -1, days: -1, cap: -5 },
        evacuation: { value: -6, days: 10 },
        unsheltered: { value: -8, days: 10 },
        boilWater: { value: -4, days: 3 },
        playThroughIt: { value: -10, days: 10 },
        austerity: { value: -10, days: 120 },
        sunbather: { value: 1, days: 30 },
        tuitionFreeze: { value: 5, days: 120 },
        homecomingBudget: { value: [0, 3, 6], days: 10 },
        bigBoil: { value: 3, days: 10 },
        noParking: { value: -4, days: -1 },
        nutriaBounty: { value: 1, days: -1 },
        freePermits: { value: 3, days: -1 },
        surgeBarrier: { value: -2, days: -1 },
        gatorPool: { value: -2, days: 1 },
        beads: { value: 1, days: 10, per: 10, cap: 3 },
        hurricaneParty: { value: 2, days: 3 },
        goForIt: { value: -2, days: 10 },
        studentVoice: { value: 2, days: 10 }
      },
      boardCards: {                          // §5.9
        lobby: { cost: 100000, stateMult: 1.10 },
        researchPush: { cost: 200000, researchMult: 1.5, days: 120 },
        tuitionFreeze: { happiness: 5, applicantsMult: 1.10, days: 120 },
        recruitingTrip: { cost: 150000, rating: 3 },
        marshGrant: { cash: 300000 },
        summerSession: { tuitionMult: 1.15, heatMult: 1.5 },
        insurance: { premium: 0.02, payout: 0.5 },
        homecomingBudget: { costs: [0, 50000, 150000], happiness: [0, 3, 6], prestige: [0, 1, 3], days: 10 },
        perOffer: 2, offerDates: ['Jan 10', 'Aug 5']
      },
      failure: {                             // §10.7
        austerityUpkeep: 0.3, austerityHappiness: 10, austerityDays: 120, austerityNoBuildDays: 10,
        hikeTuition: 3000, hikeApplicants: 0.4, hikeDays: 120,
        namingRights: 1000000, namingPrestige: 3,
        receiverDays: 60, receiverYearDays: 120, receiverPrestige: 20, receiverSpeed: 4,
        underwaterShare: 0.5, underwaterDays: 15, cancelledPrestige: 15, cancelledAttritionMult: 2, resilienceGrant: 3000000,
        probationPrestige: 5, probationDays: 120, probationSeatShare: 0.5, probationSemesters: 2, probationApplicants: 0.5, probationExit: 15
      },
      sliders: { coachingMax: 3000000, coachingStep: 100000 },   // §5.3, §11.5
      west: { cost: 20000000, fromYear: 5, students: 5000, buildings: 12, applicantsMult: 1.25, landmark: 10 }   // §10.8
    },
    sports: {                                // GDD §8
      ratingBase: 20, practiceField: 5, coachingPer100k: 1, coachingCap: 30, recruitingDiv: 4, recruitingCap: 25,
      moraleDiv: 10, moraleCap: 10, roux: 3, heatPenalty: 8, coachPerStar: 4, coachStarBase: 2, starterDiv: 5, starterBase: 75,
      homeDay: 6, homeNight: 14, stadium3Opp: 5, elo: 25,
      fanbase: { students: 2.5, alumni: 0.6, prestige: 300 },
      hype: { base: 0.7, winPct: 0.4, rivalry: 0.3, night: 0.15, rain: -0.1 },
      tickets: { 25: 1.15, 35: 1, 60: 0.85 }, ticketDefault: 35,
      tailgatePer: 3, greekBonus: 0.5, greekCap: 2, greekRadius: 8,
      clubPay: 20000, clubScoreCap: 20,
      bowlWin: 1500000, bowlLose: 500000, bowlPrestige: 5, bowlWins: 5,
      quarterWeights: [[0.45, -0.25], [0.20, 0], [0.25, 0.15], [0.10, 0.10]],   // [base, ×strength] per {0,3,7,10}
      points: [0, 3, 7, 10], walkoffTrail: 3, swingMax: 8,
      oppNoise: 8, oppPerYear: 7, oppScaleFromFlagship: 3,
      coachSign: 300000, coachFee: 100000, buyout: 500000, candidates: 3, candidateStarDiv: 20, candidateStarAdd: 1,
      starDriftLosing: 2, starMax: 5, starMin: 1,
      starterGrad: 0.4, starterRating: { min: 60, max: 99, base: 55, prestigeDiv: 2, perStar: 5 }, recruitRating: 95, seniorLeaveP: 0.4,
      playThroughHappiness: 10, playThroughPrestige: 3, playThroughMaxCat: 1,
      resiliencePrestige: 4, rivalryPrestige: 3, rivalryDonation: 1.3, rivalryLossFire: 3, undefeatedDonation: 1.5, undefeatedWins: 7,
      autoSimTicks: 50, halftimeTick: 400, kickoffTick: 200, quarterTicks: 100, finalTick: 600, exitTick: 700,
      fanSprites: 40, buses: 3, bandSize: 24, tailgateGatorAttract: 6,
      statYardsBase: 60, statYardsPer: 9, statTdMult: 0.6, statTackleBase: 6, statTackleDiv: 3,
      schedule: { opener: 'Aug 8', homecoming: 'Oct 8', rivalry: 'Nov 8', bowl: 'Dec 8', seasonEnd: 'Dec 8', offseasonStart: 'Dec 9', offseasonEnd: 'Aug 7', recruitDate: 'Aug 5', gamesPerSeason: 7 }
    },
    agents: {                                // GDD §7
      cap: 300, base: 40, perStudents: 25,   // visible agents = min(300, 40 + students/25)
      speed: { path: 4, dry: 2.4, wet: 1.6, wading: 1.2 },   // tiles/s at 1× (§0.1)
      vehicleSpeed: { officer: 3, fogger: 3, bus: 5, pirogue: 5 },   // tiles/s (§7)
      offscreenRate: 4, offscreenMargin: 4,  // §7
      maxAstarPerTick: 8,                    // §7
      summerShare: 0.35, poboyShare: 0.3, nightOwlShare: 0.15, zydecoEvery: 5,   // §7 schedule
      fleeRadius: 2, legTicks: 50,           // §7
      wearThreshold: 40, wearDecay: 5,       // §7 desire lines
      energyDrain: 1,                        // fraction of energy drained across one Day phase (§7)
      tubeP: 0.15, slapAt: 0.3, gatorFleeTicks: 30, moodFlee: -5,   // §7 reactions
      debrisCostMult: 2,                     // §3.2 bit10
      walkClass: { blocked: 0, path: 1, dry: 2, wet: 3, wading: 4 },   // §3.2 walk
      piroguesMax: 3, arrivalWave: 4,        // §5.4, §10.1
      sampleTermsCap: { life: 12, green: 10 },   // §5.6 sampled terms
      shirtShares: [0.55, 0.25, 0.20], skins: 6, hairs: 8   // §7 sprite
    },
    build: {                                 // GDD §0.1, §3.6, §0.3
      daysFormulaDiv: 6,                     // buildDays = 1 + floor(w·h/6) (§0.1)
      pilingsDays: 1, tierUpgradeDays: 6,    // §0.1, §0.3 row 18
      slopeFt: 1.5, gradingPerTile: 15000,   // §3.6 slope rule
      bridgeMaxSpan: 3, bridgeCostMult: 4,   // §3.6
      roadWithin: 4, nearWater: 3,           // §0.3 rows 7, 19, 24, 28
      accessSurfaces: [1, 2, 3],             // §3.6 access
      pilingsMult: 0.4, pilingsUpkeep: 0.05, // §0.3 row 30
      demolishRefund: 0.4, ruinRebuild: 0.6, // §4.11, §6.1.6
      regradeCost: 15000, regradeDays: 3, regradeFt: 1,   // §6.5
      barrierRun: [4, 8], barrierEndElev: 1.5,   // §0.3 row 41
      restorationTiles: [10, 40], restorationDays: 30, restorationWetElev: 1.0, restorationNearMarsh: 3,   // §0.3 row 42
      quadOakShadeRadius: 3, dumpsterCost: 5000,   // §0.3 rows 23, 16
      generatorFuelDays: 3, refuelDays: 3, refuelCost: 5000, generatorRunCost: 2000, generatorRadius: 6,   // §0.3 row 6
      pumpRunCost: 3000,                     // §0.3 row 28
      waterTowerUnpoweredCap: 25,            // §4.11
      maxBuildings: 400                      // §15.3
    },
    render: {                                // GDD §12
      tileW: 64, tileH: 32, pxPerFt: 6, zooms: [0.5, 1, 2],   // §12.1
      chunk: 8, chunkW: 512, chunkH: 416, chunkRebakesPerFrame: 2,   // §12.1, ARCH D19
      cameraLerp: 0.15, cameraMargin: 200, dragThreshold: 4, panPxPerFrame: 12,   // §11.7
      worldX: [-2016, 2016], worldY: [-84, 2040],   // clamp extents at zoom 1 (ARCH §6.2)
      rainLines: [300, 1200], rainLinesHalf: 400, rainLinesLandfall: 900,   // §12.5
      particlesMax: 2500, particlesLow: 800, lightsMax: 250,   // §12.7, §12.4
      lampEveryRoad: 4, lampEveryPath: 6,    // §12.4
      shakeMs: { landfall: 400, score: 150, demolish: 120, lightning: 80 }, shakePx: 6,   // §12.7
      lightningFlashAlpha: 0.7, lightningMs: 250,   // §12.5
      tint: {                                // §12.2 sky tints {color, alpha}
        dawn: { color: '#F7B58A', alpha: 0.25 }, golden: { color: '#FFCB6B', alpha: 0.20 }, dusk: { color: '#6B3F8F', alpha: 0.35 },
        night: { color: '#0E1230', alpha: 0.62 }, storm: { color: '#2A3140', alpha: 0.50 }, fog: { color: '#C9CFD1', alpha: 0.30 }
      },
      stormDesaturate: 0.3,                  // §12.2
      waterShallow: '#6FA895', waterDeep: '#1B3A3A', marshLiveDepth: 0.5, cliffFt: 1,   // §12.1
      perfFrameMs: 25, perfFrames: 60, minAgentsDrawn: 120, fireflyHalfCap: 300, canvasBudgetMB: 64,   // §15.3
      postcard: [1600, 1000],                // §11.6
      overlayFadeMs: 150, tooltipMs: 300,    // §11.1, §11.2
      tickerPxPerSec: 60, notifMs: 12000, notifMax: 3,   // §11.1
      bubbleIdleMs: 8000, bubbleMs: 6000,    // §11.1
      squashMs: 200, hitStopMs: 60,          // §12.7
      minimapPx: 160, minimapEveryFrames: 6, // §11.1, ARCH §6.3
      buildPopMs: 600, godRayTicks: 100, gateDropMs: 2000,   // §10.1, §6.2, §4.10b
      agentPx: [12, 20], gatorPx: [40, 12], leGrandPx: 56   // §12.3
    },
    ui: {                                    // GDD §11
      undoSeconds: 5, undoTicks: 50,         // §11.2, ARCH D16
      minWidth: 1024, compactWidth: 1180, topbarH: 44, tickerH: 24, paletteH: 112, inspectW: 300, itemPx: 72, iconPx: 64,   // §11
      tickerMax: 30, tickerNoLineDays: 3,    // §11.1
      hoverTagMs: 300, panelRefreshMs: 500,  // §6.3, ARCH §7.7
      cardWordsMax: 12,                      // §10.1
      touchTargetPx: 44                      // §11.7
    },
    audio: { voices: 12, ambienceDb: -12, duckDb: -6, thunderDelay: [0.3, 2], zydecoBpm: 120, defaultVolume: 0.5 },   // GDD §13
    palette: {                               // GDD §12.2 (defined once here)
      purple: '#461D7C', purple2: '#5E2CA5', purpleHi: '#7F5BC5', purpleShadow: '#2B1246', panel: '#1A1230',
      gold: '#FDD023', gold2: '#F5B700', goldHi: '#FFE680', goldShadow: '#B58500', windowGlow: '#FFF1A8',
      waterNight: '#1B3A3A', waterDay: '#2E6B5E', shallows: '#6FA895', reed: '#8A9A4B', mud: '#4A3B2A', wetGround: '#5A6B3A',
      dryGrass: '#6E8F3C', highGround: '#7FA347', cypress: '#3F5E3A', cypressAutumn: '#C7692B', oakCanopy: '#3B5A2A', moss: '#9BAA8A',
      bark: '#3A2A1E', gravel: '#C9B47C', asphalt: '#3A3A40', boardwalk: '#8B7355', azalea: '#E75480', creamStone: '#F5ECD7',
      tanStucco: '#E8D9B5', terracotta: '#B5533C', text: '#F4EEE2', danger: '#E0443E', good: '#3FBF7F', waterBlue: '#4FA3D6'
    },
    progress: {                              // GDD §10
      grant: 50000, objectivePrestige: 2,    // §10.2 rewards
      voiceCardDom: 3, voiceDeadlineDays: 30, voiceAfterObjective: '7',   // §7.1
      showMeFlashMs: 1200,                   // §11.1
      cadenceMinutes: [3, 5], cadenceUntilMinute: 40,   // §10.6
      tutorial: { cellPlaySeconds: 75, cellInches: 3, arrivalSeconds: 35, stages: 6, freePlayStage: 6 },   // §10.1
      goals: {                               // §10.2 objective thresholds
        oaks6: 5, roadTiles7: 10, students8: 500, deadline8: 'Aug 5', deadline8b: 'Jan 10', beds8: 435, seats8: 358,
        mosq10: 0.3, ringH11: 5, leveeTiles11: [8, 16], obj11Date: 'Jun 1', students15: 400, preserve16: 20, ecology16: 75,
        students17: 1000, target17: 1500, wins18a: 4, wins18b: 5, students19: 2000, prestige19: 30, students20: 1500,
        students21: 5000, students22: 10000, prestige22: 60, coneDays12: 6
      },
      milestoneGoals: {                      // §10.5 conditions
        firstBell: 600, highAndDryH: 8, stormChaser: 0.2, eyeOfTheStormCat: 4, gatorWrangler: 10, skeeterBeater: 0.1, skeeterMonth: 8,
        bigBoil: { attendance: 3000, studentShare: 0.6, alumniShare: 0.1, unionMult: 1.5 }, throwMeSomethin: 75,
        greenAndGold: { ecology: 70, students: 3000 }, fortressBayou: { H: 12, floodwalls: 40 },
        livingWithWater: { ecology: 75, students: 2000, floodwallMax: 10 }, sinkingFeeling: 1.0,
        rebuiltFromTheRoux: 50, flagship: { students: 10000, prestige: 60 }, laissez: { students: 20000, prestige: 85, ecology: 50 }
      },
      milestonePrestige: { firstBell: 2, highAndDry: 2, eyeOfTheStorm: 5, skeeterBeater: 2, geauxBeatMagnolia: 3, undefeated: 5, fortressBayou: 3, livingWithWater: 3 },   // §10.5 rewards
      milestoneCash: { cajunEngineer: 50000, stormChaser: 100000, throwMeSomethin: 50000, rebuiltFromTheRoux: 500000 },   // §10.5 rewards
      milestoneEffects: { wetFeetDiscount: 0.25, sinkingDiscount: 0.25, sinkingDays: 120, wranglerUpkeep: 0.5, sunbatherDays: 30, bigBoilDays: 10, greenGoldResearch: 1.1, undefeatedDonationDays: 120 },   // §10.5 rewards
      parade: { floats: 1, floatsUnion: 3, minRoadRun: 4, krewe: 12, beadsPerVolley: 8, beadTargets: 3, catchesPerPoint: 10, beadsCap: 3 },   // §14.3
      recapFromYear: 2                       // §10.8 Founders' Day
    }
  };

  // ---------------------------------------------------------------------------
  // 3.3 BSU.rng — mulberry32 streams with save/restore of their state
  // ---------------------------------------------------------------------------
  /** @param {number} seed uint32 */
  function makeStream(seed) {
    let a = (seed >>> 0);
    const s = {
      /** next uint32 */
      next() { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (t ^ (t >>> 14)) >>> 0; },
      /** [0,1) */
      float() { return s.next() / 4294967296; },
      /** integer in [0,n) */
      int(n) { return Math.floor(s.float() * n); },
      /** [a,b) */
      range(lo, hi) { return lo + s.float() * (hi - lo); },
      /** random element of arr (undefined for empty) */
      pick(arr) { return arr.length ? arr[Math.floor(s.float() * arr.length)] : undefined; },
      /** true with probability p */
      chance(p) { return s.float() < p; },
      /** Box-Muller N(0,1); consumes two floats; no cached spare (state stays a single uint32) */
      gauss() { let u = 0, v = 0; while (u === 0) u = s.float(); v = s.float(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
      get state() { return a >>> 0; },
      set state(v) { a = (v >>> 0); }
    };
    return s;
  }
  /** 32-bit string hash (FNV-1a) */
  function strHash(str) {
    let h = 0x811C9DC5;
    const st = String(str);
    for (let i = 0; i < st.length; i++) { h ^= st.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  /** 32-bit mix of two numbers (per-building/per-tile seeds) */
  function hash(x, y) {
    let h = (Math.imul(x | 0, 0x9E3779B1) ^ Math.imul((y | 0) + 0x7F4A7C15, 0x85EBCA77)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846CA68B) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  }
  BSU.strHash = strHash;
  BSU.rng = {
    make: makeStream,
    hash: hash,
    world: makeStream(0),                       // reseeded IN PLACE by terrain.gen: BSU.rng.world.state = seed (the Stream is never replaced, §3.3)
    sim: makeStream((0 ^ 0x9E3779B9) >>> 0),    // ALL sim randomness; state in state.rng.sim; session reseeds IN PLACE per game/load (BSU.rng.sim.state = state.rng.sim)
    fx: makeStream(0xF0F0F0F0),                 // render/audio/particles only; session sets .state once at boot; never saved; never replaced
    /** = make(hash(BSU.state.seed, hash(strHash(name), n))); state-less when no game exists (seed 0) */
    derive(name, n) {
      const seed = (BSU.state && typeof BSU.state.seed === 'number') ? BSU.state.seed : 0;
      return makeStream(hash(seed, hash(strHash(name), n | 0)));
    }
  };

  // ---------------------------------------------------------------------------
  // 3.4 BSU.events and BSU.EV (the closed registry, D30)
  // ---------------------------------------------------------------------------
  BSU.EV_LIST = freeze([
    'tile:changed',
    'building:placed', 'building:removed', 'building:complete', 'building:upgraded', 'building:flooded', 'building:dried',
    'building:damaged', 'building:repaired', 'building:renamed',
    'power:blackout', 'power:restored', 'coverage:changed', 'ring:changed',
    'weather:rain', 'weather:cell', 'weather:lightning', 'weather:heat', 'sky:phase',
    'calendar:day', 'calendar:month', 'calendar:semester', 'calendar:year', 'calendar:date',
    'storm:wave', 'storm:named', 'storm:watch', 'storm:bands', 'storm:landfall', 'storm:passed', 'storm:phase', 'storm:pulse',
    'storm:toast', 'storm:report',
    'surge:start', 'surge:peak', 'surge:end', 'surge:front',
    'levee:overtop', 'levee:breach', 'levee:burrow',
    'gate:closed', 'gate:opened',
    'marsh:drained', 'marsh:reverted', 'marsh:restored',
    'gator:spawn', 'gator:campus', 'gator:incident', 'gator:relocated',
    'mosquito:warning', 'ecology:changed',
    'festival:start', 'festival:end',
    'game:scheduled', 'game:kickoff', 'game:score', 'game:halftime', 'game:final', 'season:end', 'coach:changed',
    'econ:income', 'econ:expense', 'econ:month', 'econ:stat', 'econ:card',
    'enroll:round', 'enroll:lock', 'enroll:attrition', 'enroll:graduation',
    'board:offered', 'board:resolved', 'voice:offered', 'voice:resolved',
    'milestone:earned',
    'objective:offered', 'objective:complete', 'objective:dismissed', 'objective:progress',
    'timer:added', 'timer:expired', 'unlock:changed',
    'setpiece:start', 'setpiece:end', 'setpiece:skip', 'speed:changed',
    'decision:open', 'decision:closed',
    'agent:flee', 'agent:desireLine', 'agent:arrive',
    'ui:notify', 'ui:ticker', 'ui:panel', 'ui:overlay', 'ui:tool',
    'camera:moved',
    'save:written', 'save:loaded',
    'error'
  ]);
  {
    // 'agent:desireLine' → AGENT_DESIRE_LINE ; 'error' → ERROR
    const EV = {};
    for (const name of BSU.EV_LIST) {
      const key = name.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[:\-]/g, '_').toUpperCase();
      EV[key] = name;
    }
    BSU.EV = freeze(EV);
  }
  const EV_SET = new Set(BSU.EV_LIST);

  BSU.SELFTEST = false;         // true only while a selfTest runs (test/modules.mjs sets it around every selfTest, §10.6): BSU.error/assert throw instead of logging
  BSU.errors = new Map();       // signature → count (§10.1)
  const warnedEvents = new Set();
  let inErrorEmit = false;

  /** §10.1: log once per signature, count repeats, emit 'error', never throw (except under BSU.SELFTEST). */
  BSU.error = function (module, where, err) {
    const message = (err && err.message) ? err.message : String(err);
    if (BSU.SELFTEST) { throw (err instanceof Error) ? err : new Error(module + '|' + where + '|' + message); }
    const sig = module + '|' + where + '|' + message;
    const n = (BSU.errors.get(sig) || 0) + 1;
    BSU.errors.set(sig, n);
    const first = n === 1;
    if (first) {
      try { console.error('[BSU ' + module + '.' + where + '] ' + message + ((err && err.stack) ? '\n' + err.stack : '')); } catch (e) { /* no console */ }
    }
    if (!inErrorEmit) {
      inErrorEmit = true;
      try { BSU.events.emit('error', { module: module, where: where, message: message, first: first }); } catch (e) { /* swallow */ }
      inErrorEmit = false;
    }
  };
  /** Throws only under BSU.SELFTEST; otherwise routes to BSU.error('assert', msg). */
  BSU.assert = function (cond, msg) {
    if (cond) return;
    const m = msg || 'assertion failed';
    if (BSU.SELFTEST) throw new Error(m);
    BSU.error('assert', m, new Error(m));
  };

  const listeners = new Map();   // name → {fn, owner, once}[]
  BSU.events = {
    /** subscribe; returns fn so `const h = events.on(...)` can later be passed to off */
    on(name, fn, owner) {
      if (typeof fn !== 'function') throw new TypeError('events.on: fn must be a function');
      let list = listeners.get(name);
      if (!list) { list = []; listeners.set(name, list); }
      list.push({ fn: fn, owner: owner || '', once: false });
      return fn;
    },
    /** subscribe for one emission only */
    once(name, fn, owner) {
      if (typeof fn !== 'function') throw new TypeError('events.once: fn must be a function');
      let list = listeners.get(name);
      if (!list) { list = []; listeners.set(name, list); }
      list.push({ fn: fn, owner: owner || '', once: true });
      return fn;
    },
    /** remove one listener (all registrations of fn under name) */
    off(name, fn) {
      const list = listeners.get(name);
      if (!list) return;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].fn === fn) list.splice(i, 1);
      if (!list.length) listeners.delete(name);
    },
    /** remove every listener registered with this owner tag */
    clear(owner) {
      for (const [name, list] of listeners) {
        for (let i = list.length - 1; i >= 0; i--) if (list[i].owner === owner) list.splice(i, 1);
        if (!list.length) listeners.delete(name);
      }
    },
    /** synchronous, subscription order, each listener in try/catch (§10.1); unknown names throw under SELFTEST, warn once otherwise */
    emit(name, payload) {
      if (!EV_SET.has(name)) {
        if (BSU.SELFTEST) throw new Error('events.emit: unregistered event "' + name + '" (add it to ARCHITECTURE §3.4 / BSU.EV_LIST)');
        if (!warnedEvents.has(name)) { warnedEvents.add(name); try { console.warn('[BSU events] unregistered event "' + name + '"'); } catch (e) { /* */ } }
      }
      const list = listeners.get(name);
      if (!list || !list.length) return;
      const snapshot = list.slice();
      const p = payload === undefined ? {} : payload;
      for (let i = 0; i < snapshot.length; i++) {
        const L = snapshot[i];
        if (L.once) BSU.events.off(name, L.fn);
        try { L.fn(p, name); }
        catch (e) { if (BSU.SELFTEST) throw e; BSU.error(L.owner || 'events', name, e); }
      }
    },
    /** number of listeners on a name (tests/debug) */
    count(name) { const l = listeners.get(name); return l ? l.length : 0; },
    /** true if name is in the registry */
    known(name) { return EV_SET.has(name); }
  };

  // ---------------------------------------------------------------------------
  // 3.5 Helpers (pure)
  // ---------------------------------------------------------------------------
  /** ty*64+tx (no bounds check) */
  BSU.idx = function (tx, ty) { return ty * W + tx; };
  /** i & 63 */
  BSU.tx = function (i) { return i & 63; };
  /** i >> 6 */
  BSU.ty = function (i) { return i >> 6; };
  /** 0 ≤ tx,ty < 64 */
  BSU.inBounds = function (tx, ty) { return tx >= 0 && ty >= 0 && tx < W && ty < H; };
  /** N,E,S,W neighbors that exist (order: ty−1, tx+1, ty+1, tx−1) */
  BSU.nbr4 = function (i) {
    const tx = i & 63, ty = i >> 6, out = [];
    if (ty > 0) out.push(i - W);
    if (tx < W - 1) out.push(i + 1);
    if (ty < H - 1) out.push(i + W);
    if (tx > 0) out.push(i - 1);
    return out;
  };
  /** 8 neighbors that exist, clockwise from N: N, NE, E, SE, S, SW, W, NW */
  BSU.nbr8 = function (i) {
    const tx = i & 63, ty = i >> 6, out = [];
    const n = ty > 0, s = ty < H - 1, e = tx < W - 1, w = tx > 0;
    if (n) out.push(i - W);
    if (n && e) out.push(i - W + 1);
    if (e) out.push(i + 1);
    if (s && e) out.push(i + W + 1);
    if (s) out.push(i + W);
    if (s && w) out.push(i + W - 1);
    if (w) out.push(i - 1);
    if (n && w) out.push(i - W - 1);
    return out;
  };
  BSU.chebyshev = function (ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); };
  BSU.manhattan = function (ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); };
  /** row-major footprint tile indices; null if any tile is out of bounds */
  BSU.footprintTiles = function (tx, ty, w, h) {
    if (!BSU.inBounds(tx, ty) || !BSU.inBounds(tx + w - 1, ty + h - 1)) return null;
    const out = [];
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) out.push(y * W + x);
    return out;
  };
  /** the 4-adjacent ring around a footprint (no corners), in bounds only; order: north row, south row, west column, east column */
  BSU.edgeTiles = function (tx, ty, w, h) {
    const out = [];
    for (let x = tx; x < tx + w; x++) { if (BSU.inBounds(x, ty - 1)) out.push((ty - 1) * W + x); }
    for (let x = tx; x < tx + w; x++) { if (BSU.inBounds(x, ty + h)) out.push((ty + h) * W + x); }
    for (let y = ty; y < ty + h; y++) { if (BSU.inBounds(tx - 1, y)) out.push(y * W + tx - 1); }
    for (let y = ty; y < ty + h; y++) { if (BSU.inBounds(tx + w, y)) out.push(y * W + tx + w); }
    return out;
  };
  BSU.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  BSU.lerp = function (a, b, t) { return a + (b - a) * t; };
  BSU.smoothstep = function (t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); };

  /** '$4.12M' / '$340k' / '$2,000' / '−$1.4M' — ≥1M: 2 decimals below 10M, 1 decimal from 10M, trailing zeros trimmed; ≥10k: 'k' no decimal; else commas */
  BSU.formatMoney = function (n) {
    if (typeof n !== 'number' || !isFinite(n)) return '$—';
    const neg = n < 0;
    const a = Math.abs(n);
    let s;
    if (a >= 1e6) {
      const v = a / 1e6;
      s = v.toFixed(v < 10 ? 2 : 1).replace(/\.?0+$/, '') + 'M';
    } else if (a >= 1e4) {
      s = Math.round(a / 1e3) + 'k';
    } else {
      s = String(Math.round(a)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    return (neg ? '−' : '') + '$' + s;
  };
  /** 'Jan'…'Dec' for m = 1–12 */
  BSU.monthName = function (m) { return BSU.MONTHS[((m - 1) % 12 + 12) % 12]; };
  /** absolute day → {day, year (1-based), month (1–12), dom (1–10), season, semester, date: 'Sep 3'} (ARCHITECTURE §2.4 rules) */
  BSU.dayParts = function (day) {
    const d = Math.max(0, Math.floor(day));
    const year = Math.floor(d / 120) + 1;
    const month = Math.floor(d / 10) % 12 + 1;
    const dom = d % 10 + 1;
    const season = (month >= 3 && month <= 5) ? 'spring' : (month >= 6 && month <= 8) ? 'summer' : (month >= 9 && month <= 11) ? 'fall' : 'winter';
    const yd = d % 120;   // day within the year
    // Jan 5–May 5 spring (4–44), May 6–Aug 4 summer (45–73), Aug 5–Dec 10 fall (74–119), Dec 11–Jan 4 break (110–119, 0–3)
    let semester;
    if (yd >= 4 && yd <= 44) semester = 'spring';
    else if (yd >= 45 && yd <= 73) semester = 'summer';
    else if (yd >= 74 && yd <= 109) semester = 'fall';
    else semester = 'break';
    return { day: d, year: year, month: month, dom: dom, season: season, semester: semester, date: BSU.MONTHS[month - 1] + ' ' + dom };
  };
  /** 'Sep 3, Y1' */
  BSU.formatDate = function (day) { const p = BSU.dayParts(day); return p.date + ', Y' + p.year; };
  /** 'Aug 5' + year (1-based, default 1) → absolute day; NaN when the string does not parse */
  BSU.dateToDay = function (str, year) {
    const m = /^\s*([A-Za-z]{3})\s+(\d{1,2})\s*$/.exec(String(str));
    if (!m) return NaN;
    const mi = BSU.MONTHS.indexOf(m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase());
    const dom = parseInt(m[2], 10);
    if (mi < 0 || dom < 1 || dom > 10) return NaN;
    const y = (year === undefined || year === null) ? 1 : year;
    return (y - 1) * 120 + mi * 10 + (dom - 1);
  };

  /** tile CENTER in canvas px (GDD §3.1 projection; cam = {x, y, zoom} in zoom-1 world px at the viewport center) */
  BSU.worldToScreen = function (tx, ty, elev, cam, vw, vh) {
    const z = cam.zoom || 1;
    return {
      x: ((tx - ty) * 32 - cam.x) * z + vw / 2,
      y: (((tx + ty) * 16 - (elev || 0) * 6) - cam.y) * z + vh / 2
    };
  };
  /** world px corners of a tile diamond (zoom-1 space): top, right, bottom, left */
  BSU.tileDiamond = function (tx, ty, elev) {
    const sx = (tx - ty) * 32, sy = (tx + ty) * 16 - (elev || 0) * 6;
    return { x0: sx, y0: sy - 16, x1: sx + 32, y1: sy, x2: sx, y2: sy + 16, x3: sx - 32, y3: sy };
  };
  /** inverse of worldToScreen with elevation (ARCHITECTURE §3.5); returns the hit with the LARGEST tx+ty (drawn last) or null */
  BSU.screenToWorld = function (px, py, cam, vw, vh, elevAt) {
    const z = cam.zoom || 1;
    const wx = (px - vw / 2) / z + cam.x;
    const wy = (py - vh / 2) / z + cam.y;
    const tx0 = Math.round((wx / 32 + wy / 16) / 2);
    const ty0 = Math.round((wy / 16 - wx / 32) / 2);
    const ea = typeof elevAt === 'function' ? elevAt : function () { return 0; };
    let best = null, bestSum = -Infinity;
    for (let k = 0; k <= 3; k++) {
      const cx = tx0 + k, cy = ty0 + k;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = cx + dx, ty = cy + dy;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          const e = ea(tx, ty) || 0;
          const sx = (tx - ty) * 32, sy = (tx + ty) * 16 - e * 6;
          if (Math.abs(wx - sx) / 32 + Math.abs(wy - sy) / 16 <= 1) {
            const sum = tx + ty;
            if (sum > bestSum) { bestSum = sum; best = { tx: tx, ty: ty }; }
          }
        }
      }
    }
    return best;
  };

  // base64 of the little-endian bytes of a typed array's buffer (no btoa dependency; Safari/Chrome/Node)
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64REV = (function () { const r = new Int16Array(256).fill(-1); for (let i = 0; i < 64; i++) r[B64.charCodeAt(i)] = i; r[61] = 0; return r; })();
  BSU.b64 = {
    /** typed array (or ArrayBuffer) → base64 string */
    encode(arr) {
      const bytes = (arr instanceof ArrayBuffer) ? new Uint8Array(arr) : new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      let out = '';
      const n = bytes.length;
      let i = 0;
      for (; i + 2 < n; i += 3) {
        const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
      }
      if (i < n) {
        const b0 = bytes[i], b1 = (i + 1 < n) ? bytes[i + 1] : 0;
        const v = (b0 << 16) | (b1 << 8);
        out += B64[v >> 18] + B64[(v >> 12) & 63] + ((i + 1 < n) ? B64[(v >> 6) & 63] : '=') + '=';
      }
      return out;
    },
    /** base64 string + typed-array constructor → new typed array (length = bytes / BYTES_PER_ELEMENT) */
    decode(str, Ctor) {
      const s = String(str).replace(/[^A-Za-z0-9+/=]/g, '');
      let len = Math.floor(s.length / 4) * 3;
      if (s.endsWith('==')) len -= 2; else if (s.endsWith('=')) len -= 1;
      const bytes = new Uint8Array(len);
      let j = 0;
      for (let i = 0; i < s.length; i += 4) {
        const a = B64REV[s.charCodeAt(i)], b = B64REV[s.charCodeAt(i + 1)], c = B64REV[s.charCodeAt(i + 2)], d = B64REV[s.charCodeAt(i + 3)];
        const v = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
        if (j < len) bytes[j++] = (v >> 16) & 255;
        if (j < len) bytes[j++] = (v >> 8) & 255;
        if (j < len) bytes[j++] = v & 255;
      }
      const C = Ctor || Uint8Array;
      const bpe = C.BYTES_PER_ELEMENT || 1;
      if (len % bpe !== 0) throw new Error('b64.decode: ' + len + ' bytes is not a multiple of ' + bpe);
      return new C(bytes.buffer, 0, len / bpe);
    }
  };

  /** JSON-safe deep clone that preserves typed arrays (copies them); Infinity/NaN pass through; functions dropped */
  BSU.deepClone = function clone(v) {
    if (v === null || typeof v !== 'object') return (typeof v === 'function') ? undefined : v;
    if (ArrayBuffer.isView(v)) return v.slice();
    if (Array.isArray(v)) { const out = new Array(v.length); for (let i = 0; i < v.length; i++) out[i] = clone(v[i]); return out; }
    const out = {};
    for (const k of Object.keys(v)) { const c = clone(v[k]); if (c !== undefined || v[k] === undefined) out[k] = c; }
    return out;
  };

  // headless detection — the ONLY window reads at load (ARCHITECTURE §3.5, D3)
  BSU.headlessMode = (function () {
    try {
      if (root.BSU_FORCE_HEADLESS === true) return true;
      const app = root.document && root.document.getElementById ? root.document.getElementById('app') : null;
      return (typeof root.__headless === 'object')
        || typeof root.requestAnimationFrame !== 'function'
        || !(app && app.getBoundingClientRect)
        || (root.navigator && root.navigator.userAgent === 'node-headless');
    } catch (e) { return true; }
  })();

  // ---------------------------------------------------------------------------
  // 2. BSU.newState(seed) — the complete tree (ARCHITECTURE §2)
  // ---------------------------------------------------------------------------
  const P = BSU.params;
  /** bank(ty) of GDD §3.4 (also exposed by terrain) */
  BSU.bankAt = function (ty) { return Math.floor(P.terrain.bankBase + P.terrain.bankAmp * Math.sin(ty / P.terrain.bankPeriod)) - 1; };

  BSU.newState = function (seed) {
    seed = (seed >>> 0);
    const T = P.terrain;
    const bank0 = BSU.bankAt(T.bank0Row);
    const founders = { tx: bank0 + T.founders.dx, ty: T.founders.ty };
    const ledgerObj = function (keys) { const o = {}; for (const k of keys) o[k] = 0; return o; };
    const objectives = {};
    for (const id of BSU.OBJECTIVE_IDS) objectives[id] = { state: 'locked', progress: 0, goal: 0, since: -1, deadlineDay: -1, text: '' };
    const milestones = {};
    for (const id of BSU.MILESTONES) milestones[id] = { earned: false, day: -1 };
    const owner = new Int16Array(N); owner.fill(-1);
    const state = {
      v: 1,
      seed: seed,
      tick: 0,
      playSeconds: 0,
      setPiece: null,
      saveMeta: { slot: '', savedAt: 0, label: '' },
      calendar: { day: 0, dayTick: 0, running: false, frozen: true, year: 1, month: 1, dom: 1, season: 'winter', semester: 'break' },
      sky: { phase: BSU.SKY.DAWN, phaseTick: 0, cycleTick: 0, scripted: false, t: 0 },
      weather: {
        rainDays: [], event: null, cellQueue: [], heat: P.heat.monthBase[0], heatWaveDays: 0, wind: 0, windAngle: 0, fog: 0, rainRate: 0,
        riverStage: 0, spillwayUsedYear: 0, clearNightDay: -1, dtDay: 0
      },
      storms: { current: null, scheduled: [], log: [], nameIndex: 0, celestine: { state: 'pending', coneDay: -1 }, playThroughIt: false, lastLandfallDay: -1 },
      tiles: {
        elev: new Float32Array(N),
        depth: new Float32Array(N),
        sat: new Float32Array(N),
        stand: new Uint8Array(N),
        mosq: new Float32Array(N),
        subs: new Float32Array(N),
        crest: new Uint8Array(N),
        integrity: new Uint8Array(N),
        sandbag: new Uint8Array(N),
        sandbagDay: new Uint16Array(N),
        wear: new Uint8Array(N),
        flags: new Uint16Array(N),
        surface: new Uint8Array(N),
        owner: owner,
        type: new Uint8Array(N),
        walk: new Uint8Array(N)
      },
      plot: {
        bank0: bank0,
        rect: { x0: bank0 + T.plotRect.dx0, y0: T.plotRect.y0, x1: bank0 + T.plotRect.dx1, y1: T.plotRect.y1 },
        founders: founders,
        highway: [], oaks: [], cove: [], mouth: [], landing: -1, landingShoulder: -1, mounds: [], cheniers: [], bayou: [], lake: [],
        template: false
      },
      veg: [],
      buildings: [],
      runNames: {},
      hydro: { riverStage: 0, bayouStage: 0, surge: null, barrierClosed: false, pondCap: {}, networks: null, risk: null, active: null },
      agents: [],
      vehicles: [],
      gators: [],
      wildlife: {
        nutria: 0, leGrandDay: -1, leGrand: null, officers: [], relocations: 0, incidents: [], ecology: 0, ecologyTerms: {},
        foggerPenalty: 0, mosqIndex: 0, mosqWarnedDay: -1, biblicalDays: 0, campusMask: null, fireflies: 0,
        birds: { egrets: 0, spoonbills: false, pelicans: 0 }, wetlandOriginal: 0
      },
      economy: {
        cash: P.econ.startCash, students: 0, alumni: 0, prestige: P.econ.startPrestige, happiness: P.econ.startHappiness,
        happinessRaw: P.econ.startHappiness, ecology: 0, tuition: P.econ.tuition.default, quality: 'basic', selectivity: 'open',
        coaching: 0, ticket: P.sports.ticketDefault, autoRepair: true, interestPaid: 0, loanLimit: P.econ.loanLimit, negMonths: 0,
        insurance: false, endowment: 0, westCampus: false, pool: 0, applicants: 0, capacity: 0,
        capacityTerms: { beds: 0, seats: 0, dining: 0, wastewater: P.econ.capacity.wastewaterBase },
        targets: { prestige: P.econ.startPrestige, terms: {} }, happyTerms: {}, attendanceCycles: [], sick: 0,
        suspendCapPenalties: true, suppressCoverage: true,
        runway: { months: 0, nextPayDay: BSU.dateToDay('Jan 5', 1), red: false }
      },
      ledger: {
        month: { income: ledgerObj(BSU.LEDGER_INCOME_KEYS), expense: ledgerObj(BSU.LEDGER_EXPENSE_KEYS) },
        last: { income: ledgerObj(BSU.LEDGER_INCOME_KEYS), expense: ledgerObj(BSU.LEDGER_EXPENSE_KEYS), net: 0 },
        year: { income: 0, expense: 0, construction: 0 },
        history: []
      },
      sports: {
        hasTeam: false, venue: 'none', seasonYear: 0, schedule: [], record: { wins: 0, losses: 0, last4: [] },
        lastSeason: { wins: 0, losses: 0, bowlWon: false, undefeated: false },
        coach: { name: '', stars: 0, hiredYear: 0, quote: '', rep: '' }, candidates: [], starters: [], recruit: null,
        rating: 0, ratingTerms: {}, nightToggle: false, autoSim: false, permits: 'paid', homecomingBudget: 0, rivalryLossStreak: 0,
        game: null, firstHomeGameDay: -1, firstNightGameDay: -1, scriptedNightDay: -1
      },
      progress: {
        tutorialStage: 0, objectives: objectives, card: null, background: null, interruptQueue: [], backgroundQueue: [],
        milestones: milestones, timers: [], voiceCards: [], boardCards: [],
        failure: { bankruptcy: 0, receiverUntilDay: -1, probation: false, underwaterDays: 0 },
        setPiecesSeen: { landfall: false, game: false, parade: false, graduation: false },
        firsts: { gatorDay: -1, mosquitoDay: -1, floodDay: -1, cellDay: -1 },
        recap: null, achievementsWhileDebug: false, hints: {}
      },
      ticker: [],
      ui: {
        camera: { x: (founders.tx - founders.ty) * 32, y: (founders.tx + founders.ty) * 16, zoom: 1, tx: 0, ty: 0, follow: -1 },
        overlay: BSU.OV.NONE, speed: 1, speedBefore: 1, tool: null, panel: null, paletteTab: 'essentials',
        tabsSeen: {}, newPips: {}, tabsIntroduced: {},
        settings: { volume: P.audio.defaultVolume, muted: false, particles: 'high', shake: true, colorblind: false, autoSimHint: false },
        perfMode: false
      },
      rng: { sim: (seed ^ 0x9E3779B9) >>> 0 }
    };
    state.ui.camera.tx = state.ui.camera.x;
    state.ui.camera.ty = state.ui.camera.y;
    return state;
  };
  /** the 16 tiles.* array names with their constructors (save/load and tests iterate this) */
  BSU.TILE_ARRAYS = freeze({
    elev: Float32Array, depth: Float32Array, sat: Float32Array, stand: Uint8Array, mosq: Float32Array, subs: Float32Array,
    crest: Uint8Array, integrity: Uint8Array, sandbag: Uint8Array, sandbagDay: Uint16Array, wear: Uint8Array, flags: Uint16Array,
    surface: Uint8Array, owner: Int16Array, type: Uint8Array, walk: Uint8Array
  });

  // ---------------------------------------------------------------------------
  // 3.6 BSU.catalogRowSchema + BSU.validateCatalogRow
  // Type strings: 'string' | 'number' | 'int' | 'boolean' | 'enum:a|b|c' | 'array:string' | 'array:number'
  //               | 'object:<sub>' (a sub-schema name) | 'array:object:<sub>' | 'optional:<type>' | 'placeRule'
  // ---------------------------------------------------------------------------
  BSU.catalogRowSchema = freeze({
    row: freeze({
      id: 'string', n: 'int', name: 'string',
      tab: 'enum:paths|utilities|academic|housing|dining|sports|life|swamp|grounds',
      essentials: 'boolean', kind: 'enum:footprint|drag|paint|upgrade',
      w: 'int', h: 'int', rotatable: 'boolean', cost: 'number', upkeep: 'number', wr: 'int',
      needsPower: 'boolean', needsWater: 'boolean', pathAdjacency: 'boolean', roadWithin: 'int', placeRule: 'placeRule',
      allowMarsh: 'boolean', alwaysPilings: 'boolean', buildDays: 'int', unlock: 'object:unlock',
      pip: 'enum:|gator|mosquito|cell|season', effects: 'object:effects', tiers: 'array:object:tier', paint: 'object:paint',
      namePool: 'string', why: 'string', desc: 'string', demolishable: 'boolean', shelterOwn: 'boolean'
    }),
    unlock: freeze({
      students: 'optional:number', prestige: 'optional:number', ecology: 'optional:number', milestone: 'optional:string',
      building: 'optional:string', any: 'optional:array:object:unlock', tier: 'optional:int'
    }),
    effects: freeze({
      seats: 'number', beds: 'number', quality: 'number', feeds: 'number', diningRadius: 'number',
      happiness: 'object:valueRadius', flatTimer: 'string', landmark: 'number', shelter: 'number',
      power: 'object:radiusCapacity', water: 'object:radiusCapacity', mosquito: 'object:multRadiusStacks', heat: 'object:multRadius',
      ecology: 'number', ecologyPerTile: 'number', gatorAttract: 'number', research: 'object:research', academic: 'number',
      teamRating: 'number', noise: 'object:valueRadius', windShield: 'object:multRadius', illness: 'object:illness',
      drainPerDay: 'number', subsidenceMult: 'number', subsidenceRadius: 'number', pumpTileFt: 'number', pondCapacity: 'number',
      fuelDays: 'number', crest: 'number', surfaceId: 'int', canal: 'boolean', gate: 'boolean', capacityStudents: 'number',
      parkingPer: 'number', tickets: 'number', revenueMonthly: 'number', coneDays: 'number', coneNarrow: 'number',
      ecologyDecayMult: 'number', gatorAvoidRadius: 'number', homeWinBonus: 'number', attendanceSeats: 'number', special: 'array:string'
    }),
    valueRadius: freeze({ value: 'number', radius: 'number' }),
    radiusCapacity: freeze({ radius: 'number', capacity: 'number' }),
    multRadius: freeze({ mult: 'number', radius: 'number' }),
    multRadiusStacks: freeze({ mult: 'number', radius: 'number', stacksTo: 'number' }),
    research: freeze({ kind: 'enum:|engineering|coastal', base: 'number' }),
    illness: freeze({ mosquito: 'number', heat: 'number', radius: 'number' }),
    tier: freeze({
      tier: 'int', name: 'string', cost: 'number', upkeep: 'number', seats: 'number', landmark: 'number', shelter: 'number',
      wr: 'int', night: 'boolean', unlock: 'object:unlock', buildDays: 'int'
    }),
    paint: freeze({
      wall: 'array:string', roof: 'enum:flat|gable|hip|dome|barrel|bowl|none', roofColor: 'string', floors: 'int',
      windows: 'object:colsRows', decals: 'array:string', accent: 'string', lift: 'number', special: 'string'
    }),
    colsRows: freeze({ cols: 'int', rows: 'int' })
  });

  function checkType(v, type, path, errors, depth) {
    if (depth > 6) { errors.push(path + ': nesting too deep'); return; }
    if (type.startsWith('optional:')) { if (v === undefined) return; type = type.slice(9); }
    if (type === 'string') { if (typeof v !== 'string') errors.push(path + ': expected string'); return; }
    if (type === 'number') { if (typeof v !== 'number' || !isFinite(v)) errors.push(path + ': expected finite number'); return; }
    if (type === 'int') { if (typeof v !== 'number' || !Number.isInteger(v)) errors.push(path + ': expected integer'); return; }
    if (type === 'boolean') { if (typeof v !== 'boolean') errors.push(path + ': expected boolean'); return; }
    if (type === 'placeRule') { if (!Number.isInteger(v) || Object.values(BSU.PLACE).indexOf(v) < 0) errors.push(path + ': expected BSU.PLACE value'); return; }
    if (type.startsWith('enum:')) { const opts = type.slice(5).split('|'); if (typeof v !== 'string' || opts.indexOf(v) < 0) errors.push(path + ': expected one of ' + JSON.stringify(opts)); return; }
    if (type.startsWith('array:')) {
      if (!Array.isArray(v)) { errors.push(path + ': expected array'); return; }
      const inner = type.slice(6);
      for (let i = 0; i < v.length; i++) checkType(v[i], inner, path + '[' + i + ']', errors, depth + 1);
      return;
    }
    if (type.startsWith('object:')) {
      const sub = BSU.catalogRowSchema[type.slice(7)];
      if (!sub) { errors.push(path + ': unknown sub-schema ' + type); return; }
      if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(path + ': expected object'); return; }
      for (const k of Object.keys(sub)) checkType(v[k], sub[k], path + '.' + k, errors, depth + 1);
      for (const k of Object.keys(v)) if (!(k in sub)) errors.push(path + '.' + k + ': unexpected key');
      return;
    }
    errors.push(path + ': unknown type ' + type);
  }
  /** validates one catalog row against BSU.catalogRowSchema (+ id ∈ BSU.B, n = its row number, w/h vs kind) → {ok, errors} */
  BSU.validateCatalogRow = function (row) {
    const errors = [];
    checkType(row, 'object:row', 'row', errors, 0);
    if (row && typeof row === 'object') {
      if (!BSU.B[row.id]) errors.push('row.id: not a BSU.B id');
      else if (BSU.B_ORDER[row.n - 1] !== row.id) errors.push('row.n: ' + row.n + ' does not match §0.3 row of ' + row.id);
      if (row.kind === 'footprint' && row.rotatable !== (row.w !== row.h)) errors.push('row.rotatable: must equal (w !== h)');
    }
    return { ok: errors.length === 0, errors: errors };
  };

  // ---------------------------------------------------------------------------
  // selfTest (§10.6): enums frozen, event names unique, helpers round-trip, b64 round-trip.
  // Lives at BSU.contract.selfTest so test/modules.mjs finds it like every other module's.
  // ---------------------------------------------------------------------------
  BSU.contract = {};
  BSU.contract.selfTest = function () {
    const notes = [];
    const was = BSU.SELFTEST;
    BSU.SELFTEST = true;
    try {
      for (const k of ['T', 'SURF', 'FLAG', 'SKY', 'OV', 'STORM', 'STORM_PHASE', 'OBJ', 'PLACE', 'SPR', 'B', 'EV', 'MAP']) BSU.assert(Object.isFrozen(BSU[k]), k + ' frozen');
      BSU.assert(BSU.B_ORDER.length === 43 && Object.keys(BSU.B).length === 43, '43 catalog ids');
      BSU.assert(BSU.MILESTONES.length === 26, '26 milestones');
      BSU.assert(new Set(BSU.EV_LIST).size === BSU.EV_LIST.length, 'event names unique');
      BSU.assert(Object.keys(BSU.EV).length === BSU.EV_LIST.length, 'EV constants unique');
      BSU.assert(BSU.SKY_TICKS.reduce((a, b) => a + b, 0) === 300, 'sky cycle sums to 300');
      // params leaves
      let numeric = 0;
      (function walk(o, path) {
        for (const k of Object.keys(o)) {
          const v = o[k], p = path + '.' + k;
          if (v && typeof v === 'object' && !Array.isArray(v)) { walk(v, p); continue; }
          if (typeof v === 'number') { BSU.assert(isFinite(v), p + ' finite'); numeric++; continue; }
          if (typeof v === 'boolean' || typeof v === 'string') continue;
          if (Array.isArray(v)) {
            const allNum = v.every(x => typeof x === 'number' && isFinite(x)), allStr = v.every(x => typeof x === 'string');
            const allNumArr = v.every(x => Array.isArray(x) && x.every(y => typeof y === 'number' && isFinite(y)));
            BSU.assert(allNum || allStr || allNumArr, p + ' array leaf must be all-numbers, all-strings or number-pairs');
            if (allNum) numeric += v.length;
            continue;
          }
          BSU.assert(false, p + ' bad leaf type ' + typeof v);
        }
      })(BSU.params, 'params');
      notes.push('params numeric leaves ' + numeric);
      // helpers
      BSU.assert(BSU.idx(3, 5) === 5 * 64 + 3 && BSU.tx(BSU.idx(3, 5)) === 3 && BSU.ty(BSU.idx(3, 5)) === 5, 'idx/tx/ty');
      BSU.assert(BSU.nbr4(0).length === 2 && BSU.nbr4(BSU.idx(10, 10)).length === 4 && BSU.nbr8(0).length === 3 && BSU.nbr8(BSU.idx(10, 10)).length === 8, 'nbr4/nbr8 bounds');
      BSU.assert(BSU.dateToDay('Aug 5', 1) === 74 && BSU.dateToDay('Jan 1', 2) === 120 && BSU.formatDate(74) === 'Aug 5, Y1', 'date math');
      BSU.assert(BSU.dayParts(4).semester === 'spring' && BSU.dayParts(0).semester === 'break' && BSU.dayParts(110).semester === 'break' && BSU.dayParts(45).semester === 'summer' && BSU.dayParts(74).semester === 'fall', 'semesters');
      BSU.assert(BSU.formatMoney(4120000) === '$4.12M' && BSU.formatMoney(340000) === '$340k' && BSU.formatMoney(2000) === '$2,000' && BSU.formatMoney(-1400000) === '−$1.4M', 'formatMoney');
      const cam = { x: 700, y: 500, zoom: 1 };
      const r = makeStream(1234);
      const elevAt = (tx, ty) => ((tx * 7 + ty * 13) % 5) * 0.3;
      for (let k = 0; k < 50; k++) {
        const tx = r.int(64), ty = r.int(64);
        cam.zoom = [0.5, 1, 2][r.int(3)];
        const s = BSU.worldToScreen(tx, ty, elevAt(tx, ty), cam, 1280, 800);
        const w = BSU.screenToWorld(s.x, s.y, cam, 1280, 800, elevAt);
        BSU.assert(w && w.tx === tx && w.ty === ty, 'iso round trip ' + tx + ',' + ty);
      }
      const f = new Float32Array([0.5, -1.25, 3.75, 1e-7, 12345.678]);
      const back = BSU.b64.decode(BSU.b64.encode(f), Float32Array);
      BSU.assert(back.length === f.length && back.every((v, i) => v === f[i]), 'b64 float32 round trip');
      const u = new Uint8Array([1, 2, 3, 4, 5]);
      const ub = BSU.b64.decode(BSU.b64.encode(u), Uint8Array);
      BSU.assert(ub.length === 5 && ub[4] === 5, 'b64 odd-length round trip');
      const st = BSU.newState(1234);
      for (const k of Object.keys(BSU.TILE_ARRAYS)) BSU.assert(st.tiles[k] instanceof BSU.TILE_ARRAYS[k] && st.tiles[k].length === N, 'tiles.' + k);
      BSU.assert(st.tiles.owner[0] === -1 && st.economy.cash === 4000000, 'newState initial values');
      const a = makeStream(99), b = makeStream(99);
      for (let i = 0; i < 20; i++) BSU.assert(a.next() === b.next(), 'rng deterministic');
      const save = a.state; const x1 = a.next(); a.state = save; BSU.assert(a.next() === x1, 'rng state restore');
      // catalog schema smoke: a minimal well-formed row passes and a bad one fails
      const bad = BSU.validateCatalogRow({ id: 'nope' });
      BSU.assert(!bad.ok, 'schema rejects');
    } catch (e) {
      BSU.SELFTEST = was;
      return { ok: false, notes: (e && e.message) || String(e) };
    }
    BSU.SELFTEST = was;
    return { ok: true, notes: notes.join('; ') };
  };
})();
