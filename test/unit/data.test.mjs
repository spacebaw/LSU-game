// Unit test for src/js/data.js: loads contract.js (+ any earlier manifest modules that exist)
// and data.js through makeWindow() from test/domstub.mjs with vm.runInContext, runs
// BSU.data.selfTest() and the scenario checks from docs/briefs/data.md §9 "Done means".
// Usage: node test/unit/data.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// --- load ------------------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'data.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(src.length <= 100 * 1024, `file size ${(src.length / 1024).toFixed(1)} KB ≤ 100 KB`);   // UX pass: blurbs + guide/needs/requirements/coach tables (was 80 KB)

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
const upTo = manifest.slice(0, manifest.indexOf('data.js'));   // dependencies that precede data.js
for (const f of upTo) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f });
}
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'data.js' }); } catch (e) { threw = e; }
const loadMs = performance.now() - t0;
ok(!threw, 'data.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(loadMs < 50, `definition time ${loadMs.toFixed(1)} ms < 50 ms`);
const BSU = win.BSU;
const D = BSU.data;
ok(D && typeof D === 'object', 'BSU.data exists');
ok(typeof D.selfTest === 'function', 'BSU.data.selfTest is a function');
ok(!('init' in D) && !('reset' in D) && !('tick' in D), 'data has no init/reset/tick');

// --- selfTest --------------------------------------------------------------
const t1 = performance.now();
const st = D.selfTest();
const stMs = performance.now() - t1;
ok(st && st.ok === true, 'selfTest().ok === true — ' + (st && st.notes));
ok(stMs < 50, `selfTest ran in ${stMs.toFixed(1)} ms < 50 ms`);

// --- scenario 1: 43 rows, ids, order -----------------------------------------
eq(D.catalogList.length, 43, '43 catalog rows');
eq(Object.keys(D.catalog).length, 43, '43 catalog keys');
ok(BSU.B_ORDER.every((id, i) => D.catalogList[i].id === id && D.catalogList[i].n === i + 1), 'catalogList matches B_ORDER and n');
ok(D.catalogList.every(r => BSU.validateCatalogRow(r).ok), 'every row passes BSU.validateCatalogRow');
ok(D.catalogList.every(r => typeof r.blurb === 'string' && r.blurb.length > 0 && r.blurb.split(/\s+/).length <= 18), 'all 43 rows have a plain blurb (≤ 18 words)');
ok(D.catalogList.every(r => typeof r.why === 'string' && r.why.length > 0), 'all 43 rows have a why line');
ok(D.catalog.dorm.blurb === '300 beds for first-years.' && /enrollment ceiling/.test(D.catalog.dorm.why), 'dorm blurb/why read as the brief asks');
ok(BSU.OBJECTIVE_IDS.concat(['p1', 'p2']).every(id => D.guide[id] && D.guide[id].why.length > 0 && Array.isArray(D.guide[id].build)), 'guide covers every objective');
ok(D.guide['3'].build.join(',') === 'dorm,dining_hall' && D.guide['5'].build.join(',') === 'substation,water_tower', 'guide build lists for objectives 3 and 5');
ok(['beds', 'seats', 'dining', 'power', 'water'].every(k => D.needs[k] && D.catalog[D.needs[k].build]), 'needs table maps the five gauges to buildings');
ok(D.coach.length === 6 && D.coach.map(c => c.id).join(',') === 'stats,goals,menu,place,needs,swamp', '6 coach steps in order');
ok(D.keys.some(k => k.key === 'g' && k.action === 'buildMenu') && !D.keys.some(k => k.key === 'q'), 'G opens the build menu; Q unbound');

// --- scenario 2: spot check 10 rows against GDD §0.3 ------------------------
const spot = [
  ['substation', 2, 2, 250000, 4000, 2, r => r.effects.power.radius === 10 && r.effects.power.capacity === 40 && r.needsPower === false],
  ['wastewater', 3, 3, 400000, 6000, 3, r => r.roadWithin === 4 && r.unlock.students === 1000 && r.effects.capacityStudents === 6000 && r.placeRule === BSU.PLACE.NEAR_WATER],
  ['engineering', 4, 3, 2600000, 30000, 4, r => r.effects.seats === 500 && r.effects.research.base === 12000 && r.effects.research.kind === 'engineering' && r.unlock.students === 1500],
  ['coastal_institute', 3, 3, 2200000, 24000, 3, r => r.effects.coneDays === 9 && r.effects.coneNarrow === 0.3 && r.unlock.ecology === 40 && r.alwaysPilings],
  ['greek_house', 2, 2, 350000, 5000, 2, r => r.effects.beds === 80 && r.effects.quality === 3 && r.effects.gatorAttract === 2 && r.effects.happiness.radius === 6],
  ['poboy', 1, 1, 60000, 1000, 1, r => r.effects.feeds === 200 && r.effects.revenueMonthly === 2000 && r.needsPower && !r.needsWater],
  ['stadium', 6, 5, 2000000, 30000, 3, r => r.tiers[2].seats === 80000 && r.tiers[2].landmark === 18 && r.tiers[1].night === true && r.tiers[0].night === false],
  ['pump', 2, 2, 500000, 8000, 3, r => r.effects.pumpTileFt === 15 && r.effects.subsidenceRadius === 8 && r.effects.noise.value === 2 && r.needsPower],
  ['bat_house', 1, 1, 12000, 100, 1, r => r.effects.mosquito.mult === 0.7 && r.effects.mosquito.stacksTo === 0.4 && r.effects.ecology === 0.5 && r.pip === 'mosquito'],
  ['rookery', 2, 2, 1200000, 4000, 3, r => r.effects.landmark === 6 && r.unlock.building === 'marsh_restoration' && r.placeRule === BSU.PLACE.MARSH_OR_PRESERVE && !r.demolishable]
];
for (const [id, w, h, cost, upkeep, wr, extra] of spot) {
  const r = D.catalog[id];
  ok(r && r.w === w && r.h === h && r.cost === cost && r.upkeep === upkeep && r.wr === wr && extra(r), `§0.3 row ${id}: ${w}×${h} $${cost} / $${upkeep} WR ${wr} + effects`);
}
eq(D.catalog.dorm.cost, 700000, 'dorm.cost');
eq(D.catalog.dorm.effects.beds, 300, 'dorm.effects.beds');
eq(D.catalog.levee.effects.crest, 6, 'levee crest');
eq(D.catalog.floodwall.effects.crest, 12, 'floodwall crest');
ok(D.catalog.floodwall.unlock.any.length === 2 && D.catalog.floodwall.unlock.any[0].building === 'engineering' && D.catalog.floodwall.unlock.any[1].students === 2000, 'floodwall unlock any-rule');
ok(D.catalog.path.effects.surfaceId === 1 && D.catalog.road.effects.surfaceId === 2 && D.catalog.boardwalk.effects.surfaceId === 3 && D.catalog.gator_fence.effects.surfaceId === 4, 'drag rows carry surfaceId');
ok(['path', 'road', 'boardwalk', 'levee', 'floodwall', 'canal', 'gator_fence', 'surge_barrier'].every(id => D.catalog[id].kind === 'drag'), 'drag kinds');
ok(D.catalog.preserve.kind === 'paint' && D.catalog.pilings.kind === 'upgrade' && D.catalog.marsh_restoration.kind === 'footprint', 'paint/upgrade/footprint kinds');
ok(D.catalog.dorm.rotatable && !D.catalog.substation.rotatable && D.catalog.dorm.buildDays === 2 && D.catalog.stadium.buildDays === 6 && D.catalog.quad.buildDays === 1, 'rotatable + buildDays');

// --- scenario 3: deep-frozen, no functions or typed arrays ------------------
let mutated = false;
try { D.catalog.dorm.cost = 1; mutated = D.catalog.dorm.cost === 1; } catch (e) { /* strict mode throws */ }
ok(!mutated, 'catalog.dorm.cost cannot be mutated');
let pushed = false;
try { D.ticker.push('x'); pushed = true; } catch (e) { /* frozen */ }
ok(!pushed && D.ticker.length === 62, 'ticker array is frozen');
let badNode = null, nodes = 0;
(function walk(o, path) {
  nodes++;
  if (!Object.isFrozen(o)) badNode = badNode || path;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'function' && !(o === D && k === 'selfTest')) badNode = badNode || path + '.' + k + ' (function)';
    if (ArrayBuffer.isView(v) || v instanceof Map || v instanceof Set) badNode = badNode || path + '.' + k + ' (typed/Map/Set)';
    if (typeof v === 'number' && !Number.isFinite(v)) badNode = badNode || path + '.' + k + ' (non-finite)';
    if (v && typeof v === 'object') walk(v, path + '.' + k);
  }
})(D, 'data');
ok(!badNode, `every node frozen, no functions/typed arrays/NaN (${nodes} nodes)` + (badNode ? ' — bad: ' + badNode : ''));

// --- scenario 4: text tables verbatim ---------------------------------------
eq(D.ticker.length, 62, '62 ticker lines');
eq(D.ticker[0], 'Facilities crew reports a gator sunning on the culvert. Crew reports it back.', 'ticker line 1');
eq(D.ticker[61], 'Tropical Storm Amélie fizzled in the Gulf. The new levee "did not fizzle."', 'ticker line 62');
eq(D.tickerKinds[43], 'sports', 'line 43 is sports');
eq(D.tickerKinds[57], 'wildlife', 'line 57 is wildlife');
eq(D.stormNames.join(','), 'Amélie,Boudin,Célestine,Delphine,Étienne,Fifolet,Gaspard,Hébert,Isidore,Josephine,Kingcake,Landry,Mirliton,Narcisse,Odile,Praline,Quenelle,Rémy,Satsuma,Thibodeaux,Ulysse,Violette,Wilhelmina,Xavier,Yvette,Zéphyrine', '26 storm names verbatim');
eq(D.gatorNames[7], 'Étouffée', 'gator name accent intact');
eq(D.names.institute[0], 'Marsh Lab at Pointe-aux-Chênes', 'institute name verbatim');
eq(D.names.halls.length, 20, '20 hall names');
eq(D.names.halls[19], 'Maurepas Hall', 'last hall name');
eq(D.students.last.length, 55, 'GDD §14.1 lists 55 last names');
ok(D.coachQuotes.includes("We don't rebuild. We re-grade."), 'coach quote present');
ok(D.students.quotes.includes('Class was underwater again.') && D.students.quotes.includes("The AC works. That's the bar."), 'required student quotes present');
ok(D.stormQuotes.includes("We've played in worse.") && D.stormQuotes.includes('You have not.'), 'required storm quotes present');
eq(D.coaches[0].rep, 'has played in worse', 'Cheramie rep');

// --- scenario 5: milestones / objectives / cards keyed by contract constants --
ok(D.milestones.map(m => m.id).join() === BSU.MILESTONES.join(), 'milestones in BSU.MILESTONES order');
eq(D.milestones[2].reward.cash, 50000, 'Cajun Engineer pays $50k');
eq(D.milestones[14].reward.effect, 'undefeatedDonations', 'Undefeated effect');
ok(BSU.OBJECTIVE_IDS.every(id => D.objectives[id]), 'every BSU.OBJECTIVE_IDS entry has an objective');
eq(D.objectives['11'].title, 'Hold the line', 'objective 11 title');
eq(D.objectives['8'].deadlineText, 'by Aug 5', 'objective 8 deadline');
eq(D.objectives['8'].cappedText, 'Capped at {students} — beds are the bottleneck', 'objective 8 capped text');
eq(D.objectives['12'].deadlineText, '6 days', 'objective 12 deadline');
ok(['1', '2', '3', '4', '5', '6', '7', '9', '10', '11'].every(id => D.objectives[id].reward.grant === 50000), 'the ten $50k grants');
ok(BSU.VOICE_CARDS.every((id, i) => D.voiceCards[i].id === id), 'voice cards use BSU.VOICE_CARDS ids');
ok(BSU.BOARD_CARDS.every((id, i) => D.boardCards[i].id === id), 'board cards use BSU.BOARD_CARDS ids');
eq(D.boardCards[4].cost, -300000, 'marsh grant is a +$300k card');

// --- scenario 6: dates and calendar -----------------------------------------
const allDates = [...D.schedule.map(g => g.date), ...Object.keys(D.calendar.dates), ...D.calendar.festivals.flatMap(f => [f.start, f.end]).filter(Boolean)];
// 'Mar 25' and 'Dec 11' are spelled that way by ARCHITECTURE §4.2 and params.weather; the frozen
// BSU.dateToDay (dom 1–10) rejects them, so they are the two documented exceptions.
const unparsable = allDates.filter(d => !Number.isInteger(BSU.dateToDay(d, 1)));
eq(unparsable.sort().join(), 'Dec 11,Mar 25', `all ${allDates.length} date strings parse with BSU.dateToDay except the two ARCH §4.2 keys`);
ok(BSU.params.weather.highWater.tickerDate === 'Mar 25' && BSU.params.weather.semesterDates.break === 'Dec 11', 'those two keys match params.weather spellings');
ok(D.calendar.dates['Jan 1'].join() === 'newYear,subsidence,foundersDay' && D.calendar.dates['Aug 5'].join() === 'fallLock,tuition1,recruit,semester', 'calendar.dates map matches ARCH §4.2');
ok(D.schedule[6].kind === 'rivalry' && D.schedule[6].home && D.schedule[4].kind === 'homecoming' && D.schedule[7].kind === 'bowl', 'schedule kinds');
const PS = BSU.params.sports.schedule;
ok(D.schedule[0].date === PS.opener && D.schedule[4].date === PS.homecoming && D.schedule[6].date === PS.rivalry && D.schedule[7].date === PS.bowl && D.schedule.length - 1 === PS.gamesPerSeason, 'opener/homecoming/rivalry/bowl dates agree with params.sports.schedule');

// --- scenario 7: tabs and keys -----------------------------------------------
eq(D.tabs.map(t => t.id).join(), 'essentials,paths,utilities,academic,housing,dining,sports,life,swamp,grounds', 'tab order');
eq(D.tabs[0].rows.join(), 'path,dorm,dining_hall,lecture_hall,poboy,quad,live_oak', 'essentials rows');
ok(!D.tabs.some(t => t.rows.includes('founders_hall')), 'founders_hall in no tab');
ok(D.tabs.find(t => t.id === 'swamp').rows.includes('surge_barrier') && D.tabs.find(t => t.id === 'grounds').rows.includes('rookery'), 'capstones in swamp/grounds');
const sigs = D.keys.map(k => k.key + '|' + !!k.ctrl + '|' + !!k.shift);
eq(new Set(sigs).size, sigs.length, 'no duplicate {key, ctrl, shift} in keys');
ok(D.keys.some(k => k.key === '`' && k.action === 'debug') && D.keys.some(k => k.key === 's' && k.ctrl && k.action === 'save'), 'debug and save bindings');
ok(D.toastKeys.no.includes('n') && D.panKeys.up.includes('w'), 'toast/pan layers carry the shared keys');

// --- scenario 8: every consumer number lives in data ------------------------
ok(D.catalog.pump.effects.pumpTileFt === BSU.params.hydro.pumpTileFtPerDay && D.catalog.generator.effects.fuelDays === BSU.params.build.generatorFuelDays, 'data agrees with params where both carry a number');
ok(D.catalog.engineering.effects.research.base === BSU.params.econ.research.engineering && D.catalog.coastal_institute.effects.research.base === BSU.params.econ.research.coastal, 'research bases agree with params');
ok(D.rainKinds.shower.total === BSU.params.hydro.rain.shower && D.rainKinds.band.total === BSU.params.hydro.rain.band && D.rainKinds.hurricane.steps === BSU.params.hydro.rain.hurricaneSteps, 'rainKinds agree with params.hydro.rain');
ok(D.catalog.substation.effects.power.radius === 10 && D.catalog.tiger_habitat.effects.gatorAvoidRadius === BSU.params.wildlife.gator.habitatRadius, 'radii agree with params');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
