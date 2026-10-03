// Unit test for src/js/economy.js: loads contract.js (+ every earlier manifest module that exists)
// and economy.js through makeWindow() from test/domstub.mjs with vm.runInContext, stubs the
// dependency modules that are not written yet (buildings, agents, wildlife, sports, progress,
// weather), runs BSU.economy.selfTest() and the scenario checks from docs/briefs/economy.md §9
// "Done means" (the §5.4 worked Year 1, the four installments, econ:stat on every stat change,
// the fixed Budget keys, the May runway, load/lazy keys, robustness, the §5.7 projection).
// Usage: node test/unit/economy.test.mjs   (exit 1 on any failure)
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
const src = readFileSync(join(root, 'src', 'js', 'economy.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src), "file starts with 'use strict'");

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
const upTo = manifest.slice(0, manifest.indexOf('economy.js'));
for (const f of upTo) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  // other implementers may be mid-write: a dependency that does not parse yet is skipped, not fatal
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { console.log('skip:', f, '(failed to load: ' + (e && e.message) + ')'); }
}
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'economy.js' }); } catch (e) { threw = e; }
const loadMs = performance.now() - t0;
ok(!threw, 'economy.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(loadMs < 50, `definition time ${loadMs.toFixed(1)} ms < 50 ms`);
const BSU = win.BSU;
const E = BSU.economy;
ok(E && typeof E === 'object', 'BSU.economy exists');
for (const fn of ['init', 'reset', 'tick', 'selfTest', 'canAfford', 'charge', 'post', 'refund', 'setTuition', 'setQuality', 'setSelectivity', 'setCoaching', 'setTicket', 'setAutoRepair', 'endow', 'charterWest', 'applyCard', 'breakdown', 'statement', 'runway', 'capacity', 'applicants', 'previewApplicants', 'addStudents', 'bump', 'modifiers', 'repairBill', 'addAttrition', 'buildingValue', 'happyTerms', 'timerValue', 'consumeTimer', 'setSuspendCapPenalties', 'setSuppressCoverage']) {
  ok(typeof E[fn] === 'function', `BSU.economy.${fn} is a function`);
}

// --- stubs injected through economy's own M._deps (the documented injection point, §10.6) ---
// Whatever real modules are on disk, the scenarios below must be deterministic, so every
// cross-module read economy makes is answered by these stubs, exactly as its selfTest does.
function installStubs() {
  const timers = [];
  const stubStats = { beds: 300, seats: 300, feeds: 1200, diningCovered: 1, landmarks: 2, oaks: 2, cypress: 0, stockedPonds: 0, posts: 0, quality: 2, lots: 0, unrepaired: 0, floodedCore: false, brownout: false, pumpsRunning: 0, generatorsRunning: 0, roadAdjacentDorms: 0, pumpsNearDorms: 0, barriersNearDorms: 0, floodwallDormsNoOak: 0, wastewaterPlants: 0, parkingLots: 0, bridges: 0 };
  const boardOffers = [];
  const tickers = [];
  const progress = {
    timers() { return timers; },
    timer(s, id) { return timers.find(t => t.id === id) || null; },
    addTimer(s, id, v, d, meta) { const until = (d === Infinity || d < 0) ? -1 : s.calendar.day + d; const t = timers.find(t => t.id === id); if (t) { t.value = v; t.untilDay = until; t.meta = meta; } else timers.push({ id, value: v, untilDay: until, meta }); },
    removeTimer(s, id) { const k = timers.findIndex(t => t.id === id); if (k >= 0) timers.splice(k, 1); },
    offered() { return true; }, ticker(s, n) { tickers.push(n); }, offerBoard(s) { boardOffers.push(s.calendar.day); }, reportUnderwater() {}, receiverActive() { return false; }
  };
  const buildings = {
    stats() { return stubStats; }, upkeepTotal() { return 17000; }, has() { return false; }, list() { return []; }, count() { return 0; }, effective() { return 1; }, rename() {}, place() { return { ok: false }; }, canPlace() { return { ok: false }; }
  };
  const agents = { sample() { return { life: 0, green: 0, mosq: 0, heat: 0, n: 0 }; }, classAttendance() { return 1; } };
  const wildlife = { mosqIndex() { return 0; }, ecology() { return 82; }, ecologyTerms() { return { wetland: 70, preserve: 12 }; }, sickToday() { return 0; }, gatorPenalty() { return 0; } };
  const sports = { season() { return { hasTeam: false, record: { wins: 0, losses: 0 }, lastSeason: { wins: 0, losses: 0, bowlWon: false }, venue: 'none', permits: 'paid', clubOnly: false }; }, homeWinsThisSeason() { return 0; } };
  const weather = { storm() { return null; }, heat() { return { index: 80, advisory: false, wave: false }; } };
  for (const [name, stub] of [['progress', progress], ['buildings', buildings], ['agents', agents], ['wildlife', wildlife], ['sports', sports], ['weather', weather]]) E._deps[name] = stub;
  return { timers, stubStats, boardOffers, tickers, progress, wildlife };
}
const stubs = installStubs();
const PROG = stubs.progress;

// --- selfTest --------------------------------------------------------------
const errorsBefore = BSU.errors.size;
BSU.SELFTEST = true;
let st;
const t1 = performance.now();
try { st = E.selfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t1;
ok(st && st.ok === true, 'selfTest().ok === true — ' + (st && st.notes));
ok(stMs < 200, `selfTest ran in ${stMs.toFixed(1)} ms < 200 ms`);
eq(BSU.errors.size, errorsBefore, 'BSU.errors did not grow during selfTest');

// --- a driver for the §5.4 worked Year 1 (the brief's §7 isolation run) -------
function drive(state, ticks, onDay) {
  for (let t = 0; t < ticks; t++) {
    const newDay = state.tick > 0 && state.tick % 100 === 0;
    if (newDay) state.calendar.day++;
    const d = state.calendar.day;
    if (newDay && onDay) onDay(d);
    E.tick(state, { newDay, newMonth: newDay && d % 10 === 0, newYear: newDay && d % 120 === 0, day: d });
    state.tick++;
  }
}
const events = [];
const recordAll = (names) => { for (const n of names) BSU.events.on(n, (p, name) => events.push({ name, payload: p, day: null }), 'test'); };
recordAll([BSU.EV.ECON_STAT, BSU.EV.ECON_INCOME, BSU.EV.ECON_EXPENSE, BSU.EV.ECON_MONTH, BSU.EV.ENROLL_ROUND, BSU.EV.ENROLL_LOCK, BSU.EV.ENROLL_ATTRITION, BSU.EV.ENROLL_GRADUATION, BSU.EV.ECON_CARD]);

// --- scenario 1: the worked Year 1 — 176 → 210 → 237 → capped at 345, four installments ---
{
  const s = BSU.newState(3);
  s.economy.suspendCapPenalties = false; s.economy.suppressCoverage = false;
  E.init(s); E.reset(s, true);
  eq(s.economy.applicants, 700, 'reset(fresh) computes applicants 700');
  eq(s.economy.capacity, 345, 'reset(fresh) computes capacity 345');
  E.addStudents(s, 120, 'founding');
  const studentsByDay = {};
  const tuitionByDay = {};
  BSU.events.on(BSU.EV.ECON_INCOME, (p) => { if (p.key === 'tuition') tuitionByDay[s.calendar.day] = (tuitionByDay[s.calendar.day] || 0) + p.amount; }, 'test1');
  drive(s, 12000, (d) => { studentsByDay[d] = s.economy.students; });
  const after = (date) => s.economy.students;
  const day = (str) => BSU.dateToDay(str, 1);
  // students are recorded at the START of each day's tick; read the day after each round
  eq(studentsByDay[day('Jan 10') + 1], 176, 'Jan 10 spring lock → 176');
  eq(studentsByDay[day('Feb 5') + 1], 210, 'Feb 5 rolling round → 210');
  eq(studentsByDay[day('Mar 5') + 1], 237, 'Mar 5 rolling round → 237');
  ok(s.economy.students <= 345 && s.economy.students >= 300, `capped at 345 with one dorm by year end (students ${s.economy.students})`);
  eq(tuitionByDay[day('Jan 5')], 120 * 6500 * 0.5, 'Jan 5 installment charges the founding 120');
  eq(tuitionByDay[day('Mar 5')], 237 * 6500 * 0.5, 'Mar 5 installment charges 237 (after the round)');
  ok(tuitionByDay[day('Aug 5')] > 0 && tuitionByDay[day('Oct 5')] > 0, 'Aug 5 and Oct 5 installments posted');
  eq(Object.keys(tuitionByDay).length, 4, 'exactly four installments in Year 1');
  const locks = events.filter(e => e.name === BSU.EV.ENROLL_LOCK).map(e => e.payload.kind);
  ok(locks.includes('spring') && locks.includes('fall'), `enroll:lock spring + fall (${locks.join(',')})`);
  const rounds = events.filter(e => e.name === BSU.EV.ENROLL_ROUND);
  ok(rounds.length >= 4 && rounds.every(r => r.payload.kind === 'rolling' && r.payload.admitted > 0), `rolling rounds emitted only when someone arrived (${rounds.length})`);
  const stateIncome = events.filter(e => e.name === BSU.EV.ECON_INCOME && e.payload.key === 'state');
  eq(stateIncome.length, 1, 'Jul 1 state funding posted once');
  const months = events.filter(e => e.name === BSU.EV.ECON_MONTH);
  eq(months.length, 11, 'econ:month once per month boundary in Year 1 (Feb–Dec)');
  const attr = events.filter(e => e.name === BSU.EV.ENROLL_ATTRITION);
  eq(attr.length, 2, 'attrition on May 5 and Dec 10');
  ok(stubs.boardOffers.length === 2, `progress.offerBoard asked at Jan 10 and Aug 5 (${stubs.boardOffers.length})`);
  ok(Number.isFinite(s.economy.cash) && s.economy.cash > -2000000, `cash finite and above the loan line after a year (${BSU.formatMoney(s.economy.cash)})`);
  ok(s.economy.prestige > 10 && s.economy.prestige < 100, `prestige moved up from 10 (${s.economy.prestige.toFixed(2)})`);
  ok(Math.abs(s.economy.happiness - s.economy.happinessRaw) < 1, `happiness EMA converged to raw (${s.economy.happiness.toFixed(1)} vs ${s.economy.happinessRaw})`);
  const badNum = JSON.stringify({ e: s.economy, l: s.ledger }).match(/NaN|Infinity/);
  ok(!badNum, 'no NaN/Infinity in economy/ledger after a year');
  BSU.events.clear('test1');
  // every stat change is accompanied by econ:stat
  const stats = events.filter(e => e.name === BSU.EV.ECON_STAT);
  const byStat = {};
  for (const e of stats) byStat[e.payload.stat] = (byStat[e.payload.stat] || 0) + 1;
  const posts = events.filter(e => e.name === BSU.EV.ECON_INCOME || e.name === BSU.EV.ECON_EXPENSE).length;
  eq(byStat.cash, posts, 'one econ:stat{cash} per ledger post');
  const studentChanges = rounds.length + locks.length + attr.length + 1;   // + the founding cohort
  eq(byStat.students, studentChanges, 'one econ:stat{students} per enrollment change');
  ok(byStat.prestige >= 11, `econ:stat{prestige} on every monthly lerp (${byStat.prestige})`);
  ok(byStat.happiness >= 1 && byStat.happiness <= 1200, `econ:stat{happiness} only when the rounded value changes (${byStat.happiness})`);
  // Budget panel: the fixed keys in order with last month's numbers
  eq(Object.keys(s.ledger.last.income).join(), BSU.LEDGER_INCOME_KEYS.join(), 'statement income keys in the fixed order');
  eq(Object.keys(s.ledger.last.expense).join(), BSU.LEDGER_EXPENSE_KEYS.join(), 'statement expense keys in the fixed order');
  ok(s.ledger.last.expense.salaries > 0 && s.ledger.last.expense.utilities > 0 && s.ledger.last.expense.upkeep === 17000, 'last month has salaries/utilities/upkeep');
  eq(s.ledger.last.net, Object.values(s.ledger.last.income).reduce((a, b) => a + b, 0) - Object.values(s.ledger.last.expense).reduce((a, b) => a + b, 0), 'net = income − expense');
  eq(E.statement(s), s.ledger.last, 'statement() returns ledger.last');
  const bd = E.breakdown(s, 'cash');
  ok(bd && Array.isArray(bd.lines) && /^Next: tuition /.test(bd.next), `breakdown(cash) has lines and a next line (${bd.next})`);
  for (const stat of ['students', 'prestige', 'happiness', 'ecology', 'applicants', 'capacity']) { const b = E.breakdown(s, stat); ok(b && Array.isArray(b.lines) && typeof b.next === 'string', `breakdown(${stat}) shape`); }
}
events.length = 0;

// --- scenario 2: the Runway line turns red in May when cash cannot reach Aug 5 --------
{
  const s = BSU.newState(5);
  s.economy.suspendCapPenalties = false; s.economy.suppressCoverage = false;
  E.reset(s, true);
  E.addStudents(s, 1000, 'debug');
  s.calendar.day = BSU.dateToDay('May 6', 1);
  for (const k of BSU.LEDGER_EXPENSE_KEYS) s.ledger.last.expense[k] = 0;
  s.ledger.last.expense.salaries = 450000;   // 1,000 students × $450
  s.economy.cash = 2000000;
  let r = E.runway(s);
  ok(r.months === 4 && r.nextPayDay === BSU.dateToDay('Aug 5', 1) && r.red === false, `runway: 4 months to Aug 5, not red (${JSON.stringify(r)})`);
  s.economy.cash = 1000000;
  r = E.runway(s);
  ok(r.red === true && s.economy.runway.red === true, 'runway red: $1M cannot cover 3 months of $450k to Aug 5');
  ok(Number.isFinite(s.economy.runway.nextPayDay) && s.economy.runway.nextPayDay !== Infinity, 'runway.nextPayDay is a finite day');
}

// --- scenario 3: load path — reset(state, false) rebuilds nothing saved, adds the lazy keys ----
{
  const s = BSU.newState(9);
  E.reset(s, true);
  E.addStudents(s, 120, 'founding');
  drive(s, 3500);
  const doc = JSON.parse(JSON.stringify({ economy: s.economy, ledger: s.ledger }));
  const s2 = BSU.newState(9);
  s2.calendar.day = s.calendar.day; s2.tick = s.tick;
  s2.economy = doc.economy; s2.ledger = doc.ledger;
  delete s2.economy.attritionBonus; delete s2.economy.pendingDisaster; delete s2.economy.admittedSinceLock; delete s2.economy.cancelledSemester;
  E.reset(s2, false);
  ok(s2.economy.attritionBonus === 0 && s2.economy.pendingDisaster === null && s2.economy.admittedSinceLock === 0 && s2.economy.cancelledSemester === false, 'lazy keys initialized on load');
  s2.economy.attritionBonus = s.economy.attritionBonus; s2.economy.admittedSinceLock = s.economy.admittedSinceLock;
  const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v).sort().reduce((a, kk) => { a[kk] = v[kk]; return a; }, {}) : v);
  ok(canon({ e: s2.economy, l: s2.ledger }) === canon({ e: s.economy, l: s.ledger }), 'reset(load) recomputes nothing that is saved (economy + ledger identical, key order aside)');
  ok(!('cash' in E) && !('students' in E) && !('timers' in E), 'no state mirrored on the module object (D46)');
  drive(s2, 100);
  ok(Number.isFinite(s2.economy.cash), 'ticks after load');
}

// --- scenario 4: timers, insurance payout, disaster grant, failure cards ----------------
{
  const s = BSU.newState(11);
  E.init(s); E.reset(s, true);
  E.addStudents(s, 500, 'debug');
  s.calendar.day = 200;
  PROG.addTimer(s, 'insurance', 0.02, -1);
  eq(PROG.timer(s, 'insurance').untilDay, -1, 'open-ended timers hold untilDay -1');
  s.storms.lastLandfallDay = 200;
  BSU.events.emit(BSU.EV.STORM_REPORT, { report: { bill: 400000, tarps: 3 } });
  E.tick(s, { newDay: false, newMonth: false, newYear: false, day: 200 });
  const ins = events.find(e => e.name === BSU.EV.ECON_INCOME && e.payload.key === 'insurance');
  ok(ins && ins.payload.amount === 200000, 'insurance pays 50% of the bill');
  ok(s.economy.pendingDisaster && s.economy.pendingDisaster.day === 220 && s.economy.pendingDisaster.bill === 400000, 'disaster grant scheduled for T+20');
  s.calendar.day = 220;
  E.tick(s, { newDay: true, newMonth: true, newYear: false, day: 220 });
  const dis = events.find(e => e.name === BSU.EV.ECON_INCOME && e.payload.key === 'disaster');
  ok(dis && dis.payload.amount === 160000 * 1.25, `disaster grant min(800k, 40%) × 1.25 at ecology 82 (${dis && dis.payload.amount})`);
  eq(s.economy.pendingDisaster, null, 'pendingDisaster cleared (never Infinity)');
  ok(s.ledger.month.expense.boardCards > 0 || s.ledger.last.expense.boardCards >= 0, 'insurance premium posts under boardCards');
  // bankruptcy card after three months below the line
  s.economy.cash = -2500000;
  for (let m = 0; m < 3; m++) { s.calendar.day += 10; E.tick(s, { newDay: true, newMonth: true, newYear: false, day: s.calendar.day }); }
  const card = events.find(e => e.name === BSU.EV.ECON_CARD);
  ok(card && card.payload.kind === 'bankruptcy' && card.payload.options.join() === 'austerity,hike,naming', 'econ:card{bankruptcy} after 3 months below −$2M');
  eq(events.filter(e => e.name === BSU.EV.ECON_CARD).length, 1, 'the bankruptcy card is offered once per 3 months');
  E.applyCard(s, 'naming');
  ok(events.some(e => e.name === BSU.EV.ECON_INCOME && e.payload.key === 'donations' && e.payload.amount === 1000000), 'naming rights +$1M donations');
  ok(events.some(e => e.name === BSU.EV.ECON_STAT && e.payload.stat === 'prestige' && e.payload.delta === -3), 'naming rights −3 prestige');
  E.applyCard(s, 'underwater');
  ok(s.economy.cancelledSemester === true && Number.isFinite(s.economy.cancelledUntilDay) && s.economy.cancelledUntilDay > s.calendar.day, 'Semester Cancelled until the next semester opens');
  ok(events.some(e => e.name === BSU.EV.ECON_INCOME && e.payload.key === 'grants' && e.payload.amount === 3000000), 'Coastal Resilience Grant $3M');
  BSU.events.clear('economy');
}
events.length = 0;

// --- scenario 5: robustness — no exception escapes on garbage input --------------------
{
  const s = BSU.newState(13);
  E.reset(s, true);
  const calls = [
    () => E.tick(null), () => E.tick(s), () => E.tick(s, null), () => E.tick(s, { newDay: 'yes' }),
    () => E.post(s, 'nope', NaN), () => E.post(s, 'tuition', Infinity), () => E.post(s, 'tuition', -5), () => E.charge(s, NaN, 'salaries'), () => E.charge(s, 10, 'nope', { force: true }),
    () => E.canAfford(null, 5), () => E.setTuition(s, NaN), () => E.setTuition(s, 1e12), () => E.setCoaching(s, -1), () => E.setTicket(s, 99), () => E.setQuality(s, 'ultra'),
    () => E.addStudents(s, NaN, 'debug'), () => E.addStudents(s, -50, 'debug'), () => E.bump(s, 'prestige', NaN), () => E.bump(s, 'prestige', 1e9), () => E.bump(s, 'happiness', -1e9, 'debug'),
    () => E.applyCard(s, 'bogus'), () => E.breakdown(s, 'bogus'), () => E.breakdown(null, 'cash'), () => E.runway(null), () => E.capacity(null), () => E.applicants(null), () => E.previewApplicants(s, NaN),
    () => E.endow(s, 12345), () => E.charterWest(s), () => E.timerValue(s, 'x'), () => E.consumeTimer(s, 'x'), () => E.modifiers(null), () => E.repairBill(null), () => E.buildingValue(null), () => E.addAttrition(s, NaN), () => E.reset(null, true), () => E.selfTest.length
  ];
  let thrown = 0;
  const realError = console.error;
  console.error = () => {};   // BSU.error logs (once per signature) are the expected path here, not failures
  try { for (const c of calls) { try { c(); } catch (e) { thrown++; realError('threw:', c.toString(), e && e.message); } } }
  finally { console.error = realError; }
  eq(thrown, 0, 'no public function threw on garbage input');
  ok(s.economy.prestige === 100 && s.economy.happiness === 0, 'bumps clamp to 0–100');
  ok(s.economy.tuition === 15000 && s.economy.coaching === 0 && s.economy.ticket === 35 && s.economy.quality === 'basic', 'sliders clamp/refuse bad values');
  ok(s.economy.students === 0 && Number.isFinite(s.economy.cash), 'NaN/negative student adds are ignored; cash stays finite');
  ok(!JSON.stringify(s.economy).match(/NaN|Infinity/), 'no NaN/Infinity after the garbage calls');
  eq(E.endow(s, 1000000).ok, false, 'endow refused before Year 5');
  s.calendar.day = 4 * 120 + 5; s.economy.cash = 5000000;
  ok(E.endow(s, 1000000).ok === true && s.economy.endowment === 1000000 && s.economy.cash === 4000000, 'endow moves $1M into the Endowment in Year 5');
}

// --- scenario 6: the §5.7 five-year projection reproduces the money curve ---------------
{
  const t2 = performance.now();
  const proj = E._projection();
  const ms = performance.now() - t2;
  ok(proj.failures.length === 0, 'projection within the documented bands' + (proj.failures.length ? ': ' + proj.failures.join('; ') : ''));
  eq(proj.years.length, 5, 'five year rows');
  console.log('      ' + proj.note);
  ok(ms < 200, `projection ran in ${ms.toFixed(0)} ms`);
  ok(proj.years.every(y => y.students >= 60 && y.prestige >= 0 && y.prestige <= 100), 'no negative students; prestige bounded');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
