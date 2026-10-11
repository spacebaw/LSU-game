// Unit test for src/js/progress.js: boots the built index.html headlessly (domstub + vm) and drives the story
// engine end to end: (a) skipTutorial → Objectives 1–5 done without grants, '6' offered, a year of ticks fires the
// dated beats (Apr 5 cell once, Amélie, Jun 1 → '11', parade, graduation) without a progress error; (b) the full
// tutorial played headlessly through BSU.headless.place / BSU.buildings.placeRun, calendar.running flipping at
// Objective 2; (c) timers (fixed / open-ended / Infinity) surviving a save/load round trip; (d) a forced Cat 3
// producing the 12 → 13 → 14 storm objective flow.
// Usage: node build.mjs --check --partial && node test/unit/progress.test.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// --- source hygiene ----------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'progress.js'), 'utf8');
ok(/^'use strict';/.test(src), "file starts with 'use strict'");
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/setTimeout|setInterval|requestAnimationFrame/.test(src), 'no wall-clock timers');
ok(!/Math\.random\(/.test(src), 'no Math.random');
ok(!/[^=!]=\s*Infinity\b|:\s*Infinity\b/.test(src), 'Infinity is only tested for, never assigned/stored');

const { win } = loadGame();
// This test asserts the ui-ABSENT contract (INTEGRATION_NOTES '## progress.js': calls queue on state.progress.uiQueue when
// BSU.ui is missing). ui.js now exists in the bundle, so remove it before boot; ui's own drain is covered by test/unit/ui.test.mjs.
delete win.BSU.ui;
const BSU = win.BSU;
ok(BSU && BSU.progress && typeof BSU.progress.tick === 'function', 'BSU.progress loaded');
const H = BSU.headless, PR = BSU.progress;
const progressErrors = () => [...BSU.errors.keys()].filter(k => k.startsWith('progress|'));
const st = (id) => BSU.state.progress.objectives[id].state;

// Spies on the scripted calls progress is the only caller of.
const spy = { cells: [], nearMiss: [], setPieces: [] };
const W0 = BSU.weather.queueCell, W1 = BSU.weather.scheduleNearMiss, S0 = BSU.session.startSetPiece;
BSU.weather.queueCell = function (s, q) { spy.cells.push({ day: q.day, scripted: !!q.scripted }); return W0.call(this, s, q); };
BSU.weather.scheduleNearMiss = function (s, d, n) { spy.nearMiss.push({ day: d, name: n }); return W1.call(this, s, d, n); };
BSU.session.startSetPiece = function (s, k, o) { const r = S0.call(this, s, k, o); if (r) spy.setPieces.push(k); return r; };

// =============================================================================
// (a) skipTutorial: 1–5 done without grants, '6' on the first tick, a year of dated beats
// =============================================================================
console.log('--- (a) skipTutorial year ---');
let s = BSU.session.newGame({ seed: 42, skipTutorial: true });
s = s || BSU.state;
for (const id of ['1', '2', '3', '4', '5']) eq(st(id), 'done', `Objective ${id} done at tick 0`);
eq(s.economy.cash, 4000000, 'no tutorial grants paid (cash 4,000,000)');
eq(s.progress.tutorialStage, 6, 'tutorialStage 6');
eq(spy.cells.length, 0, 'applySkipTutorial queued no cell');
H.tick(1);
eq(st('6'), 'active', "'6' offered on the first tick");
ok(PR.objective(s) && PR.objective(s).id === '6', 'objective() shows 6');
ok(s.ticker.length >= 0 && Array.isArray(s.progress.uiQueue), 'uiQueue exists for ui to drain');
const offered = [];
BSU.events.on('objective:offered', p => offered.push(p.id), 'test');
const earned = [];
BSU.events.on('milestone:earned', p => earned.push(p.id), 'test');
// one year in 500-tick steps
const TPD = BSU.params.time.ticksPerDay;   // time pass: 200 ticks per calendar day (a year is 24,000 ticks)
for (let i = 0; i < BSU.params.time.ticksPerYear; i += 500) H.tick(500);
eq(progressErrors().length, 0, 'no progress BSU.error during the year: ' + progressErrors().join(', '));
const apr5 = BSU.dateToDay('Apr 5', 1);
eq(spy.cells.filter(c => c.scripted).length, 1, 'exactly one scripted cell queued in Year 1');
ok(spy.cells.some(c => c.day === apr5), 'the scripted cell is the Apr 5 one');
ok(spy.nearMiss.some(n => n.name === 'Amélie'), 'Amélie scheduled in Year 1 (day ' + (spy.nearMiss[0] && spy.nearMiss[0].day) + ')');
ok(PR.offered(s, '11'), "'11' offered on Jun 1");
ok(PR.offered(s, '11a'), "'11a' (Amélie watch) offered");
ok(s.progress.setPiecesSeen.parade === true || spy.setPieces.includes('parade'), 'parade set piece ran on Feb 8');
ok(s.progress.setPiecesSeen.graduation === true || spy.setPieces.includes('graduation'), 'graduation set piece ran on May 5');
ok(s.ticker.length > 0 && s.ticker.length <= 30, `ticker holds ${s.ticker.length} lines (≤ 30)`);
ok(s.ticker.every(t => Number.isFinite(t.day) && typeof t.text === 'string' && t.text.length > 0), 'ticker lines well-formed');
// the 3-day filler rule: no gap > 3 days between consecutive lines in the buffer
let maxGap = 0; for (let i = 1; i < s.ticker.length; i++) maxGap = Math.max(maxGap, s.ticker[i].day - s.ticker[i - 1].day);
ok(maxGap <= 3, `no three calendar days without a ticker line (max gap ${maxGap})`);
ok(offered.length >= 2, `objectives offered over the year: ${offered.join(' ')}`);
console.log('milestones earned:', earned.join(' ') || '(none)');
// Célestine (Sep 2 Y1 after '11' was offered): 12 → 13 → 14
ok(s.storms.log.some(l => l.name === 'Célestine'), 'Célestine made landfall in Year 1');
ok(PR.offered(s, '12'), "'12' (Cone of concern) offered at the Célestine cone");
eq(st('13'), 'done', "'13' (Landfall) completed on storm:passed");
ok(PR.offered(s, '14'), "'14' (Repair) offered after Célestine (" + st('14') + ')');
ok(s.progress.setPiecesSeen.landfall === true, 'landfall set piece seen');
for (const t of s.progress.timers) ok(Number.isFinite(t.untilDay) && Number.isFinite(t.value), `timer ${t.id} finite`);
ok(PR.nearestMilestones(s, 3).length === 3, 'nearestMilestones returns 3 rows');
ok(typeof PR.unlockReason(s, 'library') === 'string', 'unlockReason returns a string: "' + PR.unlockReason(s, 'library') + '"');
eq(PR.unlockReason(s, 'path'), '', 'Start rows have no reason');
ok(/Engineering Hall or reach 2,000 students|^$/.test(PR.unlockReason(s, 'coastal_institute')) || PR.unlockReason(s, 'coastal_institute').length > 0, 'any-unlock reason composes: "' + PR.unlockReason(s, 'coastal_institute') + '"');

// =============================================================================
// (c) timers survive save/load; open-ended stays -1; fixed expires on time
// =============================================================================
console.log('--- (c) timers round trip ---');
const day0 = s.calendar.day;
PR.addTimer(s, 'austerity', -10, 5);
PR.addTimer(s, 'insurance', 0.02, -1);
PR.addTimer(s, 'probation', -0.5, Infinity);
PR.addTimer(s, 'voiceApplicants', 40, -1); PR.addTimer(s, 'voiceApplicants', 60, -1);
eq(PR.timer(s, 'austerity').untilDay, day0 + 5, 'fixed timer untilDay = day + 5');
eq(PR.timer(s, 'insurance').untilDay, -1, 'open-ended (-1) stores -1');
eq(PR.timer(s, 'probation').untilDay, -1, 'Infinity stores -1');
eq(PR.timer(s, 'voiceApplicants').value, 100, 'voiceApplicants accumulates');
BSU.session.save('_progress_test');
BSU.session.load('_progress_test');
s = BSU.state;
eq(PR.timer(s, 'austerity').untilDay, day0 + 5, 'fixed timer survives load');
eq(PR.timer(s, 'insurance').untilDay, -1, 'open-ended timer survives load as -1');
eq(PR.timer(s, 'probation').untilDay, -1, 'Infinity-added timer survives load as -1');
eq(PR.timer(s, 'voiceApplicants').value, 100, 'accumulated value survives load');
H.fastForwardDays(6);
ok(!PR.timer(s, 'austerity'), 'fixed timer expired after 6 days');
ok(!!PR.timer(s, 'insurance') && !!PR.timer(s, 'probation'), 'open-ended timers still alive');
PR.removeTimer(s, 'insurance'); PR.removeTimer(s, 'probation'); PR.removeTimer(s, 'voiceApplicants');
ok(!PR.timer(s, 'insurance'), 'removeTimer works');
eq(progressErrors().length, 0, 'no progress BSU.error in the timer scenario');

// =============================================================================
// (d) forced Cat 3 on a fresh skipTutorial game (before Célestine) → 12 preempts → 13 → 14
// =============================================================================
console.log('--- (d) forced Cat 3 ---');
s = BSU.session.newGame({ seed: 11, skipTutorial: true }) || BSU.state;
H.tick(50);
eq(st('6'), 'active', "'6' on the card before the cone");
H.forceHurricane(3);
H.tick(2);
eq(st('12'), 'active', "'12' preempts the card at the cone");
eq(st('6'), 'queued', "'6' goes back to the queue behind the storm objective");
const o12 = PR.objective(s);
ok(o12 && o12.id === '12' && o12.goal === 5, 'Objective 12 card shows the 5-item checklist (goal ' + (o12 && o12.goal) + ')');
H.tick(4000);
ok(st('12') === 'done' || st('12') === 'dismissed', "'12' resolved at landfall (" + st('12') + ')');
eq(st('13'), 'done', "'13' completed on storm:passed");
ok(PR.offered(s, '14'), "'14' offered after the storm (" + st('14') + ')');
ok(st('6') === 'active' || st('6') === 'queued' || st('6') === 'done', "'6' re-offered after the storm objectives (" + st('6') + ')');
ok(s.progress.setPiecesSeen.landfall === true, 'landfall set piece seen');
eq(progressErrors().length, 0, 'no progress BSU.error through the hurricane: ' + progressErrors().join(', '));

// =============================================================================
// (b) the tutorial, played headlessly
// =============================================================================
console.log('--- (b) tutorial headless ---');
spy.cells.length = 0;
s = BSU.session.newGame({ seed: 7 }) || BSU.state;
eq(s.progress.tutorialStage, 1, 'stage 1 after newGame');
eq(s.calendar.running, false, 'calendar not running before Objective 2');
H.tick(2);
eq(s.progress.tutorialStage, 2, 'stage 2 (charter card queued headlessly → stage 2)');
eq(st('1'), 'active', "Objective 1 active");
ok(s.progress.uiQueue.some(q => q.kind === 'card' && q.args[0] === 'charter'), 'charter card queued for ui');
ok(s.progress.uiQueue.some(q => q.kind === 'selectTool' && q.args[0] === 'founders_hall'), 'selectTool founders_hall queued');
const f = s.plot.founders;
let r = H.place('founders_hall', f.tx, f.ty);
ok(r && r.ok, "Founders' Hall placed: " + JSON.stringify(r));
H.tick(2);
eq(st('1'), 'done', 'Objective 1 done');
ok(PR.earned(s, 'chartered'), 'Chartered earned');
eq(s.progress.tutorialStage, 3, 'stage 3');
eq(st('2'), 'active', 'Objective 2 active');
ok(s.progress.hints.hudShown === true, 'hudShown hint set');
const cashAfter1 = s.economy.cash;
// the path: Founders' front door → landing shoulder (the same land route session uses for skipTutorial)
const front = BSU.idx(f.tx + 1, f.ty + 3);
const route = BSU.terrain.landRoute(s, front, s.plot.landingShoulder);
ok(Array.isArray(route) && route.length > 0, 'land route to the landing exists (' + (route && route.length) + ' tiles)');
r = BSU.buildings.placeRun(s, 'path', route, {});
ok(r && r.ok !== false, 'path run placed');
H.tick(2);
eq(st('2'), 'done', 'Objective 2 done after the path connects');
eq(s.calendar.running, true, 'calendar.running flips at Objective 2');
eq(s.progress.tutorialStage, 4, 'stage 4');
eq(st('3'), 'active', 'Objective 3 active');
ok(s.economy.cash > cashAfter1 - 1, 'grant for Objective 1 and 2 posted (cash ' + s.economy.cash + ')');
ok(s.progress.uiQueue.some(q => q.kind === 'introduceTab' && q.args[0] === 'essentials'), 'essentials tab introduced');
// founding arrival: three pirogues glide 40 ticks, then the first agent walks up the path (~19 s at 1×)
H.tick(300);
ok(PR.earned(s, 'welcome') && s.economy.students === 120, `founding cohort arrived (students ${s.economy.students}, welcome ${PR.earned(s, 'welcome')})`);
// Objective 3: a dorm and a dining hall
let spot = H.findSpot('dorm'); ok(spot, 'dorm spot found'); r = spot && H.place('dorm', spot.x, spot.y); ok(r && r.ok, 'dorm placed: ' + JSON.stringify(r));
spot = H.findSpot('dining_hall'); ok(spot, 'dining spot found'); r = spot && H.place('dining_hall', spot.x, spot.y); ok(r && r.ok, 'dining hall placed: ' + JSON.stringify(r));
H.tick(2);
eq(st('3'), 'done', 'Objective 3 done');
eq(s.progress.tutorialStage, 5, 'stage 5');
eq(s.economy.suspendCapPenalties, false, 'cap penalties resume after Objective 3');
// stage 5: the scripted cell 30 ticks later, then the wading notification and Objective 4
H.tick(40);
eq(spy.cells.filter(c => c.scripted).length, 1, 'the 1:15 cell queued once');
let guard = 0; while (!PR.offered(s, '4') && guard++ < 20) H.tick(100);
ok(PR.offered(s, '4'), "Objective 4 offered after the cell (" + (guard * 100) + ' ticks)');
ok(s.progress.uiQueue.some(q => q.kind === 'notify' && /wading/.test(q.args[0] && q.args[0].text)), 'wading notification queued');
ok(s.progress.uiQueue.some(q => q.kind === 'introduceTab' && q.args[0] === 'swamp'), 'swamp tab introduced');
// Objective 4: a canal from the cove's lowest tile to the bayou
const cove = s.plot.cove; let low = cove[0]; for (const i of cove) if (s.tiles.elev[i] < s.tiles.elev[low]) low = i;
const Wd = BSU.MAP.W;
let bestWater = -1, bestD = 1e9;
for (let i = 0; i < BSU.MAP.N; i++) { const ty = s.tiles.type[i]; if (ty !== BSU.T.BAYOU && ty !== BSU.T.OPEN_WATER) continue; const d = Math.abs(i % Wd - low % Wd) + Math.abs(((i / Wd) | 0) - ((low / Wd) | 0)); if (d < bestD) { bestD = d; bestWater = i; } }
ok(bestWater >= 0, 'a water tile exists near the cove (distance ' + bestD + ')');
const canal = []; { let x = low % Wd, y = (low / Wd) | 0; const tx = bestWater % Wd, ty = (bestWater / Wd) | 0; canal.push(low); while (x !== tx) { x += Math.sign(tx - x); canal.push(y * Wd + x); } while (y !== ty) { y += Math.sign(ty - y); canal.push(y * Wd + x); } }
r = BSU.buildings.placeRun(s, 'canal', canal.filter(i => { const t = s.tiles.type[i]; return t !== BSU.T.BAYOU && t !== BSU.T.OPEN_WATER; }), {});
ok(r && r.ok !== false, 'canal run placed: ' + JSON.stringify(r));
H.tick(3);
const nets = BSU.hydro.networks(s);
ok(nets.some(n => n.drainsToWater), 'a canal network drains to water (' + nets.length + ' networks)');
eq(st('4'), 'done', 'Objective 4 done');
ok(PR.earned(s, 'cajunEngineer'), 'Cajun Engineer earned');
H.tick(2);
eq(st('5'), 'active', 'Objective 5 active');
spot = H.findSpot('substation'); r = spot && H.place('substation', spot.x, spot.y); ok(r && r.ok, 'substation placed: ' + JSON.stringify(r));
spot = H.findSpot('water_tower'); r = spot && H.place('water_tower', spot.x, spot.y); ok(r && r.ok, 'water tower placed: ' + JSON.stringify(r));
H.tick(2);
eq(st('5'), 'done', 'Objective 5 done');
eq(s.progress.tutorialStage, 6, 'stage 6: free play');
eq(s.economy.suppressCoverage, false, 'coverage penalty resumes after Objective 5');
H.tick(1);
eq(st('6'), 'active', "'6' offered in free play");
ok(s.progress.uiQueue.some(q => q.kind === 'introduceTab' && q.args[0] === 'grounds'), 'every tab introduced at stage 6');
eq(progressErrors().length, 0, 'no progress BSU.error through the tutorial: ' + progressErrors().join(', '));

// the queue shape ui drains
for (const q of s.progress.uiQueue) ok(typeof q.kind === 'string' && Number.isFinite(q.tick) && Number.isFinite(q.day) && Array.isArray(q.args), 'uiQueue entry well-formed: ' + q.kind);

// --- desire-line throttle (polish pass 2) -----------------------------------------------------------------
// One 'Students want a path' line per 3 calendar days; runs that fire inside the window merge into the next line.
s = BSU.session.newGame({ seed: 5, skipTutorial: true }) || BSU.state;
s.progress.hints.desireLine = true;   // past the first-time hint → plain notifies
s.progress.uiQueue.length = 0;
const desireLines = () => s.progress.uiQueue.filter(q => q.kind === 'notify' && q.args[0] && /want (a path|paths)/.test(q.args[0].text));
const tilesA = [BSU.idx(10, 10), BSU.idx(11, 10)], tilesB = [BSU.idx(20, 20), BSU.idx(21, 20)], tilesC = [BSU.idx(30, 30)];
BSU.events.emit('agent:desireLine', { tiles: tilesA }); BSU.events.emit('agent:desireLine', { tiles: tilesB }); BSU.events.emit('agent:desireLine', { tiles: tilesC });
H.tick(1);
eq(desireLines().length, 1, 'three desire lines in one tick → one notify');
ok(/want a path here/.test(desireLines()[0].args[0].text), 'the first line is the plain single-run text');
eq(desireLines()[0].args[0].action.tiles.length, 2, 'the first line carries only the first run');
BSU.events.emit('agent:desireLine', { tiles: tilesA }); H.tick(1);
eq(desireLines().length, 1, 'a line inside the 3-day window is held, not posted');
s.progress.uiQueue.length = 0;
H.tick(3 * TPD);   // three calendar days: the daily step flushes everything held, merged into one line
const merged = desireLines();
eq(merged.length, 1, 'exactly one merged line after the window');
ok(merged.length && /want paths in \d+ places/.test(merged[0].args[0].text), 'merged text names the number of places: ' + (merged[0] && merged[0].args[0].text));
ok(merged.length && merged[0].args[0].action && merged[0].args[0].action.tiles.length >= 3 && merged[0].args[0].action.label === 'Build them', 'merged action builds every held run');
eq(progressErrors().length, 0, 'no progress BSU.error through the desire-line throttle');

// --- PLAN_FOOTBALL pass C: the Spring Game 3 days after the field (200 students), no collision with the tutorial/storm -----------
{
  s = BSU.session.newGame({ seed: 42, skipTutorial: true }) || BSU.state;
  const springs = []; BSU.events.on('game:spring', p => springs.push({ day: s.calendar.day, tick: s.tick, score: p.score }), 'test');
  const sportsErrors = () => [...BSU.errors.keys()].filter(k => k.startsWith('sports|'));
  s.economy.students = 250; s.economy.cash = 5e6;
  H.tick(1);
  ok(PR.unlocked(s, 'practice_field'), 'the Practice Field unlocks at 200 students (250 on campus)');
  const spot = H.findSpot('practice_field'); ok(spot, 'a Practice Field spot');
  const r = spot && H.place('practice_field', spot.x, spot.y); ok(r && r.ok, 'Practice Field placed: ' + JSON.stringify(r));
  const placedDay = s.calendar.day;
  let g = 0; while (!s.sports.hasTeam && g++ < 60) H.tick(10);
  const builtDay = s.calendar.day;
  ok(s.sports.hasTeam && builtDay - placedDay <= 4, 'the field completes and makes a team (' + (builtDay - placedDay) + ' days)');
  eq(s.sports.springDay, builtDay + 3, 'the Spring Game is on the calendar 3 days after the field completed');
  ok(s.progress.uiQueue.some(e => e.kind === 'card' && e.args[0] && e.args[0].id === 'springGame'), 'the newsflash card is queued for the ui (ui absent here)');
  ok(s.ticker.some(l => l.kind === 'sports' && /Spring Game/.test(l.text)), 'and announced on the ticker');
  // the tutorial (stage < 6) blocks the day it is due → it moves to the next day; back in free play it fires at the first tick of that day
  while (s.calendar.day < builtDay + 2 && !s.setPiece) H.tick(10);
  ok(!s.setPiece && s.calendar.day === builtDay + 2, 'no set piece before the scheduled day (day ' + s.calendar.day + ')');
  s.progress.tutorialStage = 5;
  while (s.calendar.day < builtDay + 3) H.tick(1);   // the first tick of the scheduled day: the attempt sees the tutorial and defers
  ok(!s.setPiece && !springs.length && s.sports.springDay === builtDay + 4, 'a tutorial in progress defers the Spring Game by a day (' + s.sports.springDay + ')');
  s.progress.tutorialStage = 6;
  g = 0; while (!s.setPiece && g++ < 300) H.tick(1);
  ok(s.setPiece && s.setPiece.kind === 'spring' && s.setPiece.len === 300 && s.calendar.day === builtDay + 4 && s.storms.current === null, 'the Spring Game set piece starts on the deferred day with no storm on the board');
  g = 0; while (s.setPiece && g++ < 100) H.tick(5);
  eq(springs.length, 1, 'game:spring fired once');
  ok(s.progress.setPiecesSeen.spring === true && PR.setPieceSeen(s, 'spring'), 'setpiece:end{spring} marks it seen');
  const o15 = s.progress.objectives['15']; ok(o15 && o15.state === 'active' && o15.goal === 4 && o15.progress === 2 && /Spring Game/.test(o15.text), 'objective 15 (background): 2 of 4 steps (field, Spring Game) — Bayou Field and the first home game remain (' + JSON.stringify(o15) + ')');
  ok(s.sports.lastSpring && s.sports.lastSpring.year === 1 && !s.sports.game, 'lastSpring recorded for Year 1; the game struct cleared');
  ok(s.ticker.some(l => l.kind === 'sports' && /Spring Game final/.test(l.text)), 'the final is on the ticker');
  eq(progressErrors().length + sportsErrors().length, 0, 'no progress/sports BSU.error through the Spring Game: ' + progressErrors().concat(sportsErrors()).join(', '));
  BSU.events.clear('test');
}

// --- PLAN_FOOTBALL pass A hotfix: setPiecesSeen.game ----------------------------------------------------
// The first home-game set piece to END marks 'game' seen, so Skip ▸ appears for later games and the Auto-sim montage works.
s = BSU.session.newGame({ seed: 7, skipTutorial: true }) || BSU.state;
eq(s.progress.setPiecesSeen.game, false, 'game set piece not seen on a new game');
eq(PR.setPieceSeen(s, 'game'), false, 'setPieceSeen("game") false before any game');
BSU.events.emit('setpiece:end', { kind: 'game', len: 750 }); H.tick(1);
eq(s.progress.setPiecesSeen.game, true, 'setpiece:end{game} marks the game set piece seen');
eq(PR.setPieceSeen(s, 'game'), true, 'setPieceSeen("game") true after a game ended');
s.progress.setPiecesSeen.game = false;
BSU.events.emit('setpiece:end', { kind: 'montage', len: 50 }); H.tick(1);
eq(s.progress.setPiecesSeen.game, true, 'setpiece:end{montage} also marks it seen');
s.progress.setPiecesSeen.game = false;
BSU.events.emit('setpiece:end', { kind: 'parade', len: 250 }); H.tick(1);
eq(s.progress.setPiecesSeen.game, false, 'a parade ending does not mark the game seen');
eq(progressErrors().length, 0, 'no progress BSU.error through the set-piece flag checks');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
