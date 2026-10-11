// Unit test for src/js/weather.js: loads contract.js (+ every earlier manifest module that exists),
// stubs the sibling modules weather calls (session/hydro/buildings/sports/agents/progress/ui/economy/render),
// loads weather.js through makeWindow() from test/domstub.mjs with vm.runInContext, runs
// BSU.weather.selfTest() and the scenario checks from docs/briefs/weather.md §9 "Done means".
// Usage: node test/unit/weather.test.mjs   (exit 1 on any failure)
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
const src = readFileSync(join(root, 'src', 'js', 'weather.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src), "file starts with 'use strict'");

function boot() {
  const win = makeWindow();
  win.BSU_FORCE_HEADLESS = true;
  const ctx = vm.createContext(win);
  const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
  const upTo = manifest.slice(0, manifest.indexOf('weather.js'));
  for (const f of upTo) {
    const p = join(root, 'src', 'js', f);
    if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
    // A sibling module that is still being written may not parse yet: that is not weather's failure.
    try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
    catch (e) { console.log('skip:', f, '(does not load yet: ' + String(e && e.message).split('\n')[0] + ')'); }
  }
  // Sibling stubs installed unconditionally: this is a unit test of weather, so the siblings it calls are
  // controlled here (weather resolves them lazily through BSU.<name>, so overriding after load is fine).
  vm.runInContext(`
    BSU.hydro = { setStages(){}, forceSat(){}, riverAdjacent(){ return []; }, surgeControl(s, c, a){ (BSU.__surge = BSU.__surge || []).push([c, a && a.target !== undefined ? a.target : a]); }, setJammed(){}, networks(){ return []; }, markLeveeChange(){}, tick(){} };
    BSU.buildings = { has(){ return false; }, list(){ return []; }, damageReport(){ return { bill: 4200, tarps: 1, held: [], overtopped: [], breached: [], flooded: [], choices: {} }; }, boundaryLevees(){ return []; }, boardUp(){ return { ok: true, cost: 0, queued: 0 }; }, sandbags(){ return { ok: true, cost: 0, tiles: [] }; }, repairAllLevees(){ return { ok: true, cost: 0 }; }, refuel(){ return { ok: true, cost: 5000 }; }, shelterOverflow(){}, shelterAssignments(){ return {}; } };
    BSU.progress = { offered(){ return true; }, setPieceSeen(){ return false; }, addTimer(){}, ticker(s, t, f){ (BSU.__ticker = BSU.__ticker || []).push(String(t)); } };
    BSU.sports = { upcoming(){ return null; }, season(s){ return s.sports; }, postpone(){}, offerPlayThrough(){ BSU.__ptOffered = (BSU.__ptOffered || 0) + 1; } };
    BSU.economy = { charge(){ return true; }, addAttrition(){}, bump(){} };
    BSU.agents = { evacuate(){}, shelter(s, caps){ BSU.__shelter = caps; }, crewSprites(){} };
    BSU.render = { panToTile(){} };
    BSU.ui = { answerDecision(id, a){ BSU.events.emit('decision:closed', { id, answer: a }); } };
    BSU.session = { startSetPiece(s, k, o){ s.setPiece = { kind: k, tick: 0, len: o.len, skippable: !!o.skippable, choices: {}, speedBefore: 1, cameraTouched: false }; BSU.events.emit('setpiece:start', { kind: k, len: o.len }); }, setSpeed(){}, restoreSpeed(){} };
  `, ctx);
  let threw = null;
  const t0 = performance.now();
  try { vm.runInContext(src, ctx, { filename: 'weather.js' }); } catch (e) { threw = e; }
  const loadMs = performance.now() - t0;
  return { win, ctx, threw, loadMs };
}

// The session emulation of the brief's isolation script (§7): frozen flag, tick, set-piece advance/end.
function run(BSU, s, n) {
  for (let k = 0; k < n; k++) {
    s.calendar.frozen = !s.calendar.running || !!s.setPiece;
    BSU.weather.tick(s);
    if (s.setPiece) {
      if (s.setPiece.tick + 1 >= s.setPiece.len) { const kind = s.setPiece.kind, len = s.setPiece.len; s.setPiece = null; BSU.events.emit('setpiece:end', { kind, len }); }
      else s.setPiece.tick++;
    }
    s.rng.sim = BSU.rng.sim.state;
    s.tick++;
    s.playSeconds = s.tick / 10;
  }
}
// Tick until the calendar reaches `day` (set pieces freeze the calendar, so ticks and days do not line up).
function runToDay(BSU, s, day) { let guard = 0; while (s.calendar.day < day && guard++ < 200000) run(BSU, s, 1); }
function newGame(BSU, seed, running = true) {
  const s = BSU.newState(seed);
  BSU.state = s;
  BSU.rng.sim.state = s.rng.sim;
  s.plot.mouth = [BSU.idx(40, 18), BSU.idx(41, 18), BSU.idx(42, 18)];
  BSU.weather.reset(s, true);
  BSU.weather.setRunning(s, running);
  return s;
}

const { win, threw, loadMs } = boot();
ok(!threw, 'weather.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(loadMs < 50, `definition time ${loadMs.toFixed(1)} ms < 50 ms`);
const BSU = win.BSU;
const Wt = BSU.weather;
// time pass: every tick count below derives from params (1 day = ticksPerDay ticks; the cone is storm.coneDays days)
const TPD = BSU.params.time.ticksPerDay, DPY = BSU.params.time.daysPerYear, YEAR = TPD * DPY, CONE = BSU.params.storm.coneDays * TPD, WATCH = CONE - BSU.params.storm.watchLead * TPD, BANDS = CONE - BSU.params.storm.bandsLead * TPD, DTN = BSU.params.hydro.dtDayNormal;
ok(Wt && typeof Wt.init === 'function' && typeof Wt.reset === 'function' && typeof Wt.tick === 'function' && typeof Wt.selfTest === 'function', 'init/reset/tick/selfTest exist');
for (const fn of ['date', 'isDate', 'dayOf', 'sky', 'scriptSky', 'releaseSky', 'rainAt', 'raining', 'heat', 'wind', 'storm', 'cone', 'forecastSurge', 'spawnStorm', 'scheduleNearMiss', 'setPlayThrough', 'prepAction', 'answerToast', 'skipSetPiece', 'riverStage', 'queueCell', 'suppressRainOn', 'setRunning', 'consumeRainStep', 'closeReport', 'jamGate', '_openToast', 'tomorrowCell']) ok(typeof Wt[fn] === 'function', 'public: ' + fn);

Wt.init(BSU.newState(0));

// --- selfTest --------------------------------------------------------------
BSU.SELFTEST = true;
const errorsBefore = BSU.errors.size;
let st;
const t1 = performance.now();
try { st = Wt.selfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t1;
ok(st && st.ok === true, 'selfTest().ok === true — ' + (st && st.notes));
ok(stMs < 200, `selfTest ran in ${stMs.toFixed(1)} ms < 200 ms`);
eq(BSU.errors.size, errorsBefore, 'BSU.errors did not grow during selfTest');

// --- scenario 1: a year of calendar events in order ---------------------------
{
  const s = newGame(BSU, 3);
  s.storms.celestine.state = 'done';   // a pure calendar year: no Year-1 landfall freezing the calendar for 9 days
  const log = [];
  const rec = (name) => BSU.events.on(name, (p) => log.push({ name, p }), 'test');
  ['calendar:day', 'calendar:date', 'calendar:month', 'calendar:semester', 'calendar:year', 'festival:start', 'festival:end', 'weather:heat', 'sky:phase'].forEach(rec);
  run(BSU, s, YEAR);
  BSU.events.clear('test');
  eq(s.calendar.day, 120, 'day 120 after one year of ticks');
  eq(Wt.date(s).str, 'Jan 1, Y2', 'date string Jan 1, Y2');
  const days = log.filter(e => e.name === 'calendar:day');
  eq(days.length, 120, '120 calendar:day events');
  eq(log.filter(e => e.name === 'calendar:month').length, 12, '12 calendar:month events');
  eq(log.filter(e => e.name === 'calendar:year').length, 1, '1 calendar:year event');
  eq(log.filter(e => e.name === 'weather:heat').length, 120, 'weather:heat daily');
  const sems = log.filter(e => e.name === 'calendar:semester').map(e => e.p.semester + '@' + BSU.dayParts(e.p.day).date);
  eq(sems.join(), 'spring@Jan 5,summer@May 6,fall@Aug 5,break@Dec 1', 'semester events (break per BSU.dayParts)');
  // each day: day → date → (month) → (semester) → (year) order
  let orderOk = true;
  for (let i = 0; i < log.length - 1; i++) {
    if (log[i].name === 'calendar:day' && log[i + 1].name !== 'calendar:date') orderOk = false;
    if (log[i].name === 'calendar:month' && log[i - 1].name !== 'calendar:date') orderOk = false;
  }
  ok(orderOk, 'calendar:day → calendar:date → calendar:month order');
  const dates = log.filter(e => e.name === 'calendar:date').map(e => e.p.date);
  eq(dates[0], 'Jan 2', 'first date event is Jan 2');
  eq(dates[dates.length - 1], 'Jan 1', 'last date event is Jan 1 (Y2)');
  const fest = log.filter(e => e.name.startsWith('festival')).map(e => e.name.slice(9) + ':' + e.p.id + '@' + BSU.dayParts(e.p.day).date);
  eq(fest.join(), 'start:mardiGras@Feb 6,end:mardiGras@Feb 9,start:crawfish@Mar 1,end:crawfish@May 1,start:graduation@May 5,end:graduation@May 6,start:homecoming@Oct 7,end:homecoming@Oct 9,start:bonfires@Dec 9,end:bonfires@Dec 10,start:foundersDay@Jan 1', 'festival dates and ids in order (foundersDay only from Year 2)');
  const phases = log.filter(e => e.name === 'sky:phase').length;
  eq(phases, 5 * YEAR / BSU.params.time.skyCycleTicks, YEAR / BSU.params.time.skyCycleTicks + ' sky cycles × 5 phase changes (a cycle is 1.5 days)');
  ok(s.weather.rainDays.length >= 30 && s.weather.rainDays.length <= 60 && s.weather.rainDays[0].day >= 120, 'Year-2 rain days redrawn on Jan 1');
  ok(s.storms.scheduled.length >= 1 && s.storms.scheduled.length <= 3 && s.storms.scheduled.every(e => e.day >= 120 + 50 && e.day <= 120 + 109), 'Year-2 schedule drawn on Jan 1 (Célestine done): ' + s.storms.scheduled.map(e => e.name + '@' + BSU.dayParts(e.day).date).join(','));
  ok(s.weather.riverStage >= 1 && s.weather.riverStage <= 3, 'riverStage drawn on Jan 1 of Year 2: ' + s.weather.riverStage);
  // Célestine pending: the same year with the real hold rule loses exactly the 9 frozen set-piece days.
  const s2 = newGame(BSU, 3);
  run(BSU, s2, YEAR);
  eq(s2.calendar.day, Math.floor((YEAR - 900) / TPD), 'with Célestine (900-tick freeze) the year reaches day ' + Math.floor((YEAR - 900) / TPD) + ' after a year of ticks');
  ok(s2.storms.scheduled.length === 0, 'no Year-2 schedule while Célestine is not done');
}

// --- scenario 2: compressed Cat 3 lifecycle (watch at −3 days, bands at −1 day, set piece at the cone's end, phases, log) -----
{
  const s = newGame(BSU, 7);
  run(BSU, s, 60 * TPD);
  eq(s.calendar.day, 60, 'day 60 after 60 days of ticks');
  const log = [];
  BSU.__surge = []; BSU.__ticker = []; BSU.__shelter = null;
  ['storm:named', 'storm:watch', 'storm:bands', 'storm:landfall', 'storm:phase', 'storm:pulse', 'storm:toast', 'storm:report', 'storm:passed', 'setpiece:start', 'setpiece:end', 'weather:rain', 'weather:lightning'].forEach(name => BSU.events.on(name, (p) => log.push({ name, p, tick: s.tick }), 'test'));
  const T0 = s.tick;
  const storm = Wt.spawnStorm(s, { cat: 3, coneNowTick: T0, landfallTick: T0 + CONE, compressed: true });
  ok(storm && storm.name && storm.cat === 3 && storm.compressed === true && storm.surge === 8, 'spawnStorm returned a Cat 3 struct: ' + (storm && storm.name));
  ok(Wt.cone(s) && Wt.cone(s).track.length === 6 && Wt.cone(s).width === 24, 'cone visible with a 6-point track at width 24');
  run(BSU, s, CONE + 1000);
  BSU.events.clear('test');
  const at = (name) => { const e = log.find(x => x.name === name); return e ? e.tick - T0 : -1; };
  eq(at('storm:watch'), WATCH, 'storm:watch at the cone − 3 days');
  eq(at('storm:bands'), BANDS, 'storm:bands at the cone − 1 day');
  eq(at('storm:landfall'), CONE, 'storm:landfall at the cone end');
  eq(at('setpiece:start'), CONE, 'set piece starts at the cone end');
  eq(at('setpiece:end'), CONE + 899, 'set piece ends 899 ticks later');
  const ph = log.filter(e => e.name === 'storm:phase').map(e => e.p.phase + '@' + e.p.t);
  eq(ph.join(), '0@0,1@150,2@350,3@450,4@500,5@750', 'storm:phase at 0/150/350/450/500/750 (eye at Cat 3)');
  eq(log.filter(e => e.name === 'storm:pulse').map(e => e.p.n).join(), '1,2,3,4', 'four wind pulses');
  const toasts = log.filter(e => e.name === 'storm:toast');
  ok(toasts.length >= 1 && toasts[0].p.id === 'shelter' && toasts[0].tick - T0 === CONE + 300, 'Year-1 shelter toast at set-piece tick 300');
  ok(log.some(e => e.name === 'storm:report') && log.some(e => e.name === 'storm:passed'), 'storm:report then storm:passed (headless closeReport)');
  eq(s.storms.log.length, 1, 'one storms.log entry');
  ok(s.storms.log[0].cat === 3 && s.storms.log[0].nearMiss === false && s.storms.log[0].damage === 4200 && s.storms.log[0].held === true, 'log entry carries the report');
  eq(s.storms.current, null, 'storms.current cleared after storm:passed');
  eq(s.storms.celestine.state, 'done', 'forced storm marks Célestine done (D22)');
  ok(BSU.__surge && BSU.__surge[0][0] === 'begin' && BSU.__surge[0][1] === 8 && BSU.__surge.some(x => x[0] === 'stage' && x[1] === 8) && BSU.__surge[BSU.__surge.length - 1][0] === 'end', 'hydro.surgeControl begin → stage 8 → end');
  ok(log.some(e => e.name === 'weather:rain' && e.p.kind === 'hurricane' && e.p.start), 'hurricane rain event started');
  ok(log.filter(e => e.name === 'weather:lightning').length > 5, 'lightning during the landfall');
  ok(s.sky.scripted === false && s.calendar.frozen === false, 'sky released and calendar running after the set piece');
  ok(BSU.__shelter && typeof BSU.__shelter === 'object', 'agents.shelter received the assignments map at T−1');
  ok(BSU.__ticker.includes('39') && BSU.__ticker.includes('47'), 'ticker lines 39 (watch) and 47 (clearing)');
}

// --- scenario 3: Célestine hold rule (skipTutorial headless: cone Sep 2, landfall Sep 8) --------------
{
  const s = newGame(BSU, 11);
  const named = [];
  BSU.events.on('storm:named', (p) => named.push({ p, day: s.calendar.day }), 'test');
  BSU.events.on('storm:landfall', (p) => named.push({ landfall: true, day: s.calendar.day }), 'test');
  run(BSU, s, 82 * TPD);   // to Sep 3
  ok(named.length >= 1 && named[0].p.name === 'Célestine' && BSU.dayParts(named[0].day).date === 'Sep 2', 'Célestine cone on Sep 2 with playSeconds ≥ 540');
  ok(named[0].p.cat === 2 && named[0].p.forecastCat === 2 && named[0].p.landfallDay === named[0].day + 6, 'Cat 2, forecast 2, landfall = cone + 6');
  eq(s.storms.celestine.state, 'cone', 'celestine.state = cone');
  run(BSU, s, 6 * TPD);
  BSU.events.clear('test');
  const lf = named.find(e => e.landfall) || { day: -99 };
  ok(lf && BSU.dayParts(lf.day).date === 'Sep 8', 'landfall on Sep 8 (day-driven, D51)');
  ok(s.setPiece && s.setPiece.kind === 'landfall', 'landfall set piece running');
  run(BSU, s, 1000);
  ok(!s.setPiece && s.storms.celestine.state === 'done' && s.storms.log.length === 1 && s.storms.log[0].name === 'Célestine', 'Célestine passed and logged');
  ok(s.calendar.day === lf.day + 1 || s.calendar.day === lf.day + 2, 'calendar was frozen during the 900-tick set piece');
}

// --- scenario 4: held Célestine (playSeconds too low) then Year-2 schedule after it passes ----------
{
  const s = newGame(BSU, 13);
  const passedAt = [];
  BSU.events.on('storm:named', (p) => passedAt.push(BSU.dayParts(s.calendar.day).date + ' Y' + s.calendar.year + ' ' + p.name), 'test');
  // Keep playSeconds low until Nov, then let it climb.
  for (let k = 0; k < 101 * TPD; k++) { run(BSU, s, 1); if (s.calendar.day < 101) s.playSeconds = 10; }
  ok(s.storms.celestine.state === 'held', 'cone held past Oct 5 while playSeconds < 540 (state=' + s.storms.celestine.state + ')');
  run(BSU, s, 2 * TPD);
  BSU.events.clear('test');
  ok(passedAt.length === 1 && passedAt[0].endsWith('Célestine') && s.storms.celestine.state === 'cone', 'held cone appears the next day after both conditions hold: ' + passedAt[0]);
  ok(BSU.__ticker.some(t => /did not check the calendar/.test(t)), '"the Gulf did not check the calendar" ticker');
  run(BSU, s, 2000);
  ok(s.storms.celestine.state === 'done', 'off-season Célestine passed');
  // Now cross into Year 2 and check the schedule + river stage.
  runToDay(BSU, s, 120);
  eq(s.calendar.year, 2, 'Year 2');
  ok(s.storms.scheduled.length >= 1 && s.storms.scheduled.length <= 3, 'Year-2 storms scheduled: ' + JSON.stringify(s.storms.scheduled.map(e => [e.name, e.cat, e.nearMiss, BSU.dayParts(e.day).date])));
  ok(s.storms.scheduled.every(e => { const yd = e.day - 120; return yd >= 50 && yd <= 109; }), 'all in Jun 1–Nov 30');
  ok(s.weather.riverStage >= 1 && s.weather.riverStage <= 3, 'riverStage drawn for spring: ' + s.weather.riverStage);
  // Spring High Water window
  const sched2 = s.storms.scheduled.slice();
  runToDay(BSU, s, BSU.dateToDay('Apr 3', 2));
  const rs = Wt.riverStage(s);
  ok(rs.window && Math.abs(rs.river - s.weather.riverStage * 0.6) < 1e-9 && Math.abs(rs.bayou - rs.river * 0.5) < 1e-9, 'Apr 3 stage = 0.6 × riverStage, bayou half: ' + JSON.stringify(rs));
  runToDay(BSU, s, BSU.dateToDay('May 10', 2) + 1);
  ok(!Wt.riverStage(s).window && Wt.riverStage(s).river === 0, 'window closed after May 10');
  // Run through the scheduled storms and make sure every one resolves (log grows, no exception, current cleared).
  const before = s.storms.log.length;
  const waves = [], names = [];
  BSU.events.on('storm:wave', (p) => waves.push(p.name), 'test');
  BSU.events.on('storm:named', (p) => names.push(p.name + '@' + BSU.dayParts(s.calendar.day).date + '→' + BSU.dayParts(p.landfallDay).date), 'test');
  runToDay(BSU, s, BSU.dateToDay('Dec 10', 2));
  BSU.events.clear('test');
  eq(s.storms.log.length - before, sched2.length, 'every scheduled storm resolved into the log: ' + JSON.stringify(s.storms.log.slice(before).map(l => [l.name, l.cat, l.nearMiss])));
  ok(sched2.filter(e => !e.nearMiss).every(e => waves.includes(e.name) && names.some(n => n.startsWith(e.name + '@'))), 'wave and cone for each landfalling storm: ' + names.join(' '));
  ok(names.every(n => { const m = /@(\w+ \d+)→(\w+ \d+)/.exec(n); return m && BSU.dateToDay(m[2], 2) - BSU.dateToDay(m[1], 2) === 6; }), 'cone + 6 days = landfall for every scheduled storm');
  ok(s.storms.scheduled.length === 0 && s.storms.current === null, 'schedule consumed, no dangling storm');
}

// --- scenario 4b: a scheduled landfalling storm (injected): wave T−8, cone T−6, watch T−3, bands T−1, landfall T0 -----
{
  const s = newGame(BSU, 17);
  s.storms.celestine.state = 'done';
  runToDay(BSU, s, 130);   // Jan 11 Y2 (after the Jan 1 draw)
  const T0day = BSU.dateToDay('Aug 8', 2);   // a home date: a Cat 1 here would be the Play-Through-It collision; use Cat 2
  s.storms.scheduled = [{ day: T0day, cat: 2, nearMiss: false, name: 'Praline', point: BSU.idx(30, 63), waved: false, watched: false, coneDays: 0 }];
  const ev = [];
  ['storm:wave', 'storm:named', 'storm:watch', 'storm:bands', 'storm:landfall', 'storm:passed'].forEach(n => BSU.events.on(n, (p) => ev.push(n.slice(6) + '@' + (s.calendar.day - T0day)), 'test'));
  let ptOffered = BSU.__ptOffered || 0;
  runToDay(BSU, s, T0day + 3);
  BSU.events.clear('test');
  eq(ev.join(), 'wave@-8,named@-6,watch@-3,bands@-1,landfall@0,passed@0', 'scheduled storm lifecycle by day (calendar frozen at T0 for the set piece)');
  eq((BSU.__ptOffered || 0) - ptOffered, 0, 'no Play Through It offer at forecast ≥ 2 or off a home date');
  ok(s.storms.log.some(l => l.name === 'Praline' && l.cat === 2 && !l.nearMiss), 'Praline logged');
  ok(s.weather.event === null || s.weather.event.kind !== 'hurricane', 'hurricane event cleared after the set piece');
}

// --- scenario 5: rain scheduler, cells, consumeRainStep, suppression, Apr 5 scripted cell -----------
{
  const s = newGame(BSU, 21);
  const cells = [], rains = [];
  BSU.events.on('weather:cell', (p) => cells.push({ p, day: s.calendar.day, phase: s.sky.phase, t: s.sky.t }), 'test');
  BSU.events.on('weather:rain', (p) => rains.push({ p, day: s.calendar.day }), 'test');
  // hydro consumes steps on ticks 0/2/5/7 of each block, like the real hydro
  const orig = BSU.hydro.tick;
  let steps = 0, badSteps = 0;
  BSU.hydro.tick = () => {};
  const apr5 = Wt.dayOf(s, 'Apr 5', 0);
  Wt.queueCell(s, { day: apr5, cx: 41, cy: 18, inches: 3, scripted: true });
  eq(Wt.tomorrowCell(s), null, 'tomorrowCell null far from Apr 5');
  for (let k = 0; k < YEAR; k++) {
    run(BSU, s, 1);
    if (s.weather.dtDay > 0) { const r = Wt.consumeRainStep(s); if (r) { steps++; if (!(Number.isFinite(r.r) && r.r >= 0)) badSteps++; } }
  }
  BSU.hydro.tick = orig;
  BSU.events.clear('test');
  ok(cells.length >= 5, 'cells spawned over the year: ' + cells.length);
  const scripted = cells.find(c => c.p.scripted);
  ok(scripted && scripted.day === apr5 && scripted.p.cx === 41 && scripted.p.cy === 18 && Math.abs(scripted.p.total - 0.25) < 1e-9, 'Apr 5 scripted 3-in cell fired on Apr 5 at the cove');
  ok(cells.filter(c => !c.p.scripted).every(c => c.p.cx >= 4 && c.p.cx <= 24 && c.p.cy >= 40 && c.p.cy <= 60), 'random cells spawn in the south-west third');
  ok(cells.filter(c => !c.p.scripted).every(c => c.phase > 1 || (c.phase === 1 && c.t >= 0.5) || c.day > c.p.day), 'cells start in the second half of a Day phase or later');
  const starts = rains.filter(r => r.p.start), ends = rains.filter(r => !r.p.start);
  ok(starts.length >= 20 && Math.abs(starts.length - ends.length) <= 1, `rain events start/end paired (${starts.length}/${ends.length})`);
  ok(steps > 500 && badSteps === 0, 'consumeRainStep consumed ' + steps + ' finite steps');
  ok(starts.every(r => ['shower', 'frontal', 'cell', 'band', 'hurricane'].includes(r.p.kind)), 'rain kinds valid');
  const kindsByMonth = starts.filter(r => r.p.kind !== 'band' && r.p.kind !== 'hurricane').map(r => [BSU.dayParts(r.day).month, r.p.kind]);
  ok(kindsByMonth.every(([m, k]) => (m >= 4 && m <= 9) ? k === 'cell' : k !== 'cell'), 'cells Apr–Sep only, showers/frontal Oct–Mar (storm bands excluded)');
  // suppression: the scripted night game day draws nothing
  const s2 = newGame(BSU, 21);
  const rd = s2.weather.rainDays.find(r => r.kind === 'shower');
  Wt.suppressRainOn(s2, rd.day);
  run(BSU, s2, rd.day * TPD + TPD / 2);
  ok(s2.weather.event === null && s2.weather.fog === 0, 'suppressRainOn: no event and no fog on the suppressed day');
}

// --- scenario 6: dtDay, rainAt, sky scripting, prepAction, toasts outside a set piece --------------
{
  const s = newGame(BSU, 5);
  const seen = new Set();
  for (let k = 0; k < 20; k++) { run(BSU, s, 1); seen.add(((s.tick - 1) % 10) + ':' + s.weather.dtDay); }
  ok(seen.has('0:' + DTN) && seen.has('2:' + DTN) && seen.has('5:' + DTN) && seen.has('7:' + DTN) && seen.has('1:0') && seen.has('9:0'), 'dtDay = dtDayNormal (1 / steps-per-day) on ticks 0,2,5,7 else 0');
  Wt.scriptSky(s, BSU.SKY.NIGHT, 0.5);
  const before = s.sky.cycleTick;
  run(BSU, s, 50);
  ok(s.sky.scripted && s.sky.phase === BSU.SKY.NIGHT && s.sky.cycleTick === before, 'scripted sky holds NIGHT and freezes cycleTick');
  Wt.releaseSky(s);
  ok(!s.sky.scripted && s.sky.cycleTick === before, 'releaseSky resumes from the captured cycleTick');
  eq(Wt.prepAction(s, 'boardUp', 'all').reason, 'No storm', 'prepAction refuses without a storm');
  const st = Wt.spawnStorm(s, { cat: 2, coneNowTick: s.tick, landfallTick: s.tick + CONE, compressed: true });
  s.economy.students = 2500;
  const ev = Wt.prepAction(s, 'evacuate');
  ok(ev.ok && ev.cost === 60000 && st.evacuated === true, 'evacuate charges $20k per 1,000 students: ' + JSON.stringify(ev));
  ok(Wt.prepAction(s, 'preDrain').ok && st.preDrain && !Wt.prepAction(s, 'preDrain').ok, 'preDrain once');
  ok(Wt.prepAction(s, 'sandbags').ok && st.sandbagged, 'sandbags via buildings');
  eq(Wt.prepAction(s, 'spillway').ok, false, 'spillway refused in Year 1');
  eq(Wt.forecastSurge(s), BSU.params.storm.surge[st.forecastCat], 'forecastSurge from the forecast cat (' + st.forecastCat + ')');
  eq(Wt.forecastSurge(s, 4), 12, 'forecastSurge override');
  // toasts outside a set piece (debug fireAllToasts path) + timeout enforcement through ui.answerDecision
  const toasts = [];
  BSU.events.on('storm:toast', (p) => toasts.push(p), 'test');
  Wt._openToast(s, 'shelter');
  ok(toasts.length === 1 && toasts[0].id === 'shelter' && toasts[0].untilTick === s.tick + 80 && /Dining Hall/.test(toasts[0].text), 'shelter toast opened outside a set piece');
  run(BSU, s, 81);
  BSU.events.clear('test');
  ok(toasts.length === 1, 'toast timed out once (no reopen)');
  // map-wide rainAt vs cell falloff
  s.weather.event = { kind: 'cell', total: 0.2, steps: 60, stepsLeft: 60, cx: 10, cy: 50, radius: 14, lightning: false, scripted: false };
  ok(Wt.rainAt(s, 10, 50) === 1 && Wt.rainAt(s, 17, 50) === 0.5 && Wt.rainAt(s, 40, 10) === 0, 'rainAt cell falloff 1 → 0.5 → 0');
  s.weather.event = null;
  eq(Wt.rainAt(s, 5, 5), 0, 'rainAt 0 when dry');
}

// --- scenario 7: determinism — two identical runs emit identical event logs ---------------------------
{
  const trace = (seed) => {
    const s = newGame(BSU, seed);
    const out = [];
    ['weather:cell', 'weather:heat', 'storm:named', 'calendar:date'].forEach(n => BSU.events.on(n, (p) => out.push(n + JSON.stringify(p)), 'test'));
    run(BSU, s, 90 * TPD);
    BSU.events.clear('test');
    return out.join('\n') + '|' + s.weather.heat + '|' + s.weather.wind + '|' + BSU.rng.sim.state;
  };
  ok(trace(99) === trace(99), 'same seed → identical weather trace');
  ok(trace(99) !== trace(100), 'different seed → different trace');
}

// --- scenario 8: robustness — bad inputs never throw ----------------------------------------------
{
  const s = newGame(BSU, 2);
  let threw = false;
  try {
    Wt.tick(null); Wt.tick({}); Wt.date({}); Wt.dayOf(s, undefined); Wt.isDate(s, 'zzz'); Wt.rainAt(s, NaN, NaN); Wt.queueCell(s, null);
    Wt.queueCell(s, { day: NaN, cx: 1e9, cy: -5, inches: NaN }); Wt.suppressRainOn(s, NaN); Wt.scriptSky(s, 99, NaN); Wt.releaseSky(s);
    Wt.answerToast(s, 'nope', 'yes'); Wt.answerToast(s, 'gate', 'yes'); Wt.jamGate(s, -1); Wt.jamGate(s, 5000); Wt.skipSetPiece(s); Wt.closeReport(s);
    Wt.prepAction(s, 'bogus'); Wt.consumeRainStep(s); Wt.scheduleNearMiss(s, NaN); Wt.setPlayThrough(s, 1); Wt.cone(s); Wt.storm(s);
    run(BSU, s, 300);
  } catch (e) { threw = e; }
  ok(!threw, 'no exception on bad inputs' + (threw ? ': ' + (threw.stack || threw) : ''));
  const scan = (o, path, depth = 0) => {
    if (o === null || typeof o !== 'object' || depth > 8) return null;
    for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'number' && !Number.isFinite(v)) return path + '.' + k; if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) { const r = scan(v, path + '.' + k, depth + 1); if (r) return r; } }
    return null;
  };
  const bad = scan({ calendar: s.calendar, sky: s.sky, weather: s.weather, storms: s.storms }, 'state');
  ok(!bad, 'no NaN/Infinity in owned branches: ' + bad);
}

// --- scenario 9: reset(false) leaves a loaded state alone ----------------------------------------
{
  const s = newGame(BSU, 8);
  run(BSU, s, 4321);
  const snap = JSON.stringify({ c: s.calendar, w: s.weather, st: s.storms, sky: s.sky });
  const rngBefore = BSU.rng.sim.state;
  Wt.reset(s, false);
  ok(JSON.stringify({ c: s.calendar, w: s.weather, st: s.storms, sky: s.sky }) === snap && BSU.rng.sim.state === rngBefore, 'reset(false) changes nothing and draws nothing (D37)');
  Wt.reset(s, true);
  ok(BSU.rng.sim.state !== rngBefore && s.calendar.running === false, 'reset(true) draws and clears running');
}

// --- performance: the per-tick path -----------------------------------------------------------
{
  const s = newGame(BSU, 31);
  s.storms.celestine.state = 'done';
  const t0 = performance.now();
  run(BSU, s, YEAR);
  const perTick = (performance.now() - t0) / YEAR;
  ok(perTick < 0.3, `weather.tick averages ${(perTick * 1000).toFixed(1)} µs per tick over a year (< 300 µs; includes the test's session emulation)`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
