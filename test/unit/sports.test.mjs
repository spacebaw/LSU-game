// Unit test for src/js/sports.js: loads contract.js (+ every earlier manifest module that exists)
// and sports.js through makeWindow() from test/domstub.mjs with vm.runInContext, injects
// deterministic sibling stubs through BSU.sports._deps (the documented injection point, §10.6),
// runs BSU.sports.selfTest() and the scenario checks from docs/briefs/sports.md §9 "Done means":
// a full isolation season with 4 home set pieces and the bowl decision, the Sep 8 postponement →
// Resilience Bowl, the halftime toast defaulting after 80 ticks, rating lines summing to the
// rating, game:score during the set piece, a save/load mid-game resume, determinism, no NaN,
// a team-less year that fires nothing, and the per-tick budget.
// PLAN_FOOTBALL pass B adds the drive/play engine checks: calibration over 1,500+ silent games (win share vs
// rating gap on the elo curve, home field +2–5 pts, 17–38 pts per team, 120–145 snaps, 1–4 turnovers),
// decisions that pause/resume (halftime, 4th down), a deterministic play-by-play replay, live() shape,
// watch-full and montage modes, summary/records.
// Usage: node test/unit/sports.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow, loadGame } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// --- load ------------------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'sports.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src), "file starts with 'use strict'");
ok(!/\bsetTimeout\b|\bsetInterval\b|requestAnimationFrame|document\.|AudioContext/.test(src), 'no DOM/timer/audio access in source');

function boot() {
  const win = makeWindow();
  win.BSU_FORCE_HEADLESS = true;
  const ctx = vm.createContext(win);
  const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
  const upTo = manifest.slice(0, manifest.indexOf('sports.js'));
  for (const f of upTo) {
    const p = join(root, 'src', 'js', f);
    if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
    try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
    catch (e) { console.log('skip:', f, '(failed to load: ' + (e && e.message) + ')'); }
  }
  let threw = null;
  const t0 = performance.now();
  try { vm.runInContext(src, ctx, { filename: 'sports.js' }); } catch (e) { threw = e; }
  return { win, ctx, threw, loadMs: performance.now() - t0 };
}
const { win, threw, loadMs } = boot();
ok(!threw, 'sports.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(loadMs < 50, `definition time ${loadMs.toFixed(1)} ms < 50 ms`);
const BSU = win.BSU;
const SP = BSU.sports;
ok(SP && typeof SP === 'object', 'BSU.sports exists');
for (const fn of ['init', 'reset', 'tick', 'selfTest', 'season', 'rating', 'winProb', 'playHome', 'simGame', 'halftime', 'skipToFinal', 'setNight', 'setAutoSim', 'setPermits', 'setHomecomingBudget', 'hireCoach', 'fireCoach', 'answerRecruit', 'postpone', 'scheduleMakeup', 'venueSeats', 'attendance', 'upcoming', 'homeWinsThisSeason', 'winPctLast4', 'offerPlayThrough', 'startNightGameScript']) {
  ok(typeof SP[fn] === 'function', `BSU.sports.${fn} is a function`);
}
ok(typeof SP.game === 'undefined', 'no BSU.sports.game accessor (D46)');
for (const k of Object.keys(SP)) ok(typeof SP[k] === 'function' || k === '_deps', `no state on the module object: ${k}`);

// --- deterministic sibling stubs through BSU.sports._deps --------------------------------------
function installStubs() {
  const field = { id: 0, type: 'practice_field', tx: 10, ty: 10, w: 4, h: 3, built: 1, tier: 1, hp: 1, ruin: false };
  const extra = [];
  const rec = { posts: [], bumps: [], timers: [], tickers: [], toasts: [], achieved: [], notifies: [], buses: [], field, extra, seen: false, storm: null };
  const all = () => [field].concat(extra);
  const buildings = {
    list: (s, t) => (t ? all().filter(b => b.type === t) : all()),
    has: (s, t, min = 0) => all().some(b => b.type === t && b.built >= 1 && !b.ruin && b.tier >= min),
    count: (s, t) => all().filter(b => !t || b.type === t).length,
    get: (s, id) => all().find(b => b.id === id) || null,
    effective: () => 1, stats: () => ({}),
    footprint: (s, id) => { const b = all().find(x => x.id === id); return b ? BSU.footprintTiles(b.tx, b.ty, b.w, b.h) : []; }
  };
  const economy = { post: (s, k, a) => rec.posts.push({ key: k, amount: a, day: s.calendar.day }), charge: () => true, canAfford: () => true, bump: (s, st, d, why) => rec.bumps.push({ stat: st, delta: d, why }), timerValue: () => 0 };
  const progress = { timers: () => [], timer: () => null, addTimer: (s, id, v, d) => rec.timers.push({ id, value: v, days: d }), setPieceSeen: () => rec.seen, achieve: (s, id) => rec.achieved.push(id), earned: () => false, ticker: (s, l, f) => rec.tickers.push({ line: l, fields: f, day: s.calendar.day }) };
  const weather = { raining: () => false, storm: (s) => s.storms.current, scriptSky: () => {}, releaseSky: () => {}, suppressRainOn: () => {}, setPlayThrough: (s, on) => { s.storms.playThroughIt = !!on; }, heat: () => ({ index: 80, advisory: false, wave: false }) };
  const session = { startSetPiece: (s, k, o) => { s.setPiece = { kind: k, tick: 0, len: o.len, skippable: !!o.skippable, choices: {}, speedBefore: 1, cameraTouched: false }; BSU.events.emit('setpiece:start', { kind: k, len: o.len }); } };
  const ui = { decision: (s, spec) => rec.toasts.push({ id: spec.id, text: spec.text, tick: s.tick, spTick: s.setPiece ? s.setPiece.tick : -1 }), answerDecision: (id, a) => BSU.events.emit('decision:closed', { id, answer: a }), notify: (s, n) => rec.notifies.push(n.text) };
  const agents = { gameDayBuses: (s, on) => rec.buses.push(on) };
  Object.assign(SP._deps, { buildings, economy, progress, weather, session, ui, agents });
  return rec;
}
const rec = installStubs();

// --- selfTest --------------------------------------------------------------
{
  BSU.SELFTEST = true;
  let r;
  const e0 = BSU.errors.size;
  const t0 = performance.now();
  try { r = SP.selfTest(); } catch (e) { r = { ok: false, notes: 'threw: ' + (e && e.stack || e) }; } finally { BSU.SELFTEST = false; }
  const ms = performance.now() - t0;
  ok(r && r.ok === true, 'selfTest().ok ' + (r && r.notes));
  ok(ms < 200, `selfTest ${ms.toFixed(1)} ms < 200 ms`);
  ok(BSU.errors.size === e0, 'selfTest raised no BSU.error');
  ok(SP._deps.buildings && SP._deps.ui && SP._deps.session, 'selfTest restored the injected deps');
}

// --- the session emulation of the brief's isolation script (§7) ----------------------------
const events = [];
for (const name of ['game:scheduled', 'game:kickoff', 'game:score', 'game:halftime', 'game:final', 'season:end', 'coach:changed', 'setpiece:end', 'game:play', 'game:drive', 'game:decision']) {
  BSU.events.on(name, (p) => events.push({ name, p: JSON.parse(JSON.stringify(p)), tick: cur && cur.tick }), 'test');
}
let cur = null;
function newGame(seed) {
  const s = BSU.newState(seed);
  s.economy.students = 690; s.economy.prestige = 16; s.economy.happiness = 62; s.economy.coaching = 200000;
  s.calendar.day = BSU.dateToDay('Aug 4', 1);
  BSU.rng.sim.state = s.rng.sim;   // as session.newGame does (§3.3): reseed the one stream in place
  cur = s;
  SP.init(s); SP.reset(s, true);
  return s;
}
/** one tick of the §5.1 loop for sports only: day roll every 100 ticks when unfrozen, set-piece advance/end at step 10 */
function tick1(s) {
  let newDay = false;
  s.calendar.frozen = !!s.setPiece;
  if (!s.setPiece) { s.calendar.dayTick++; if (s.calendar.dayTick >= 100) { s.calendar.dayTick = 0; s.calendar.day++; newDay = true; } }
  SP.tick(s, { newDay, newMonth: false, newYear: false, day: s.calendar.day });
  if (s.setPiece) { if (s.setPiece.tick + 1 >= s.setPiece.len) { const k = s.setPiece.kind, len = s.setPiece.len; s.setPiece = null; BSU.events.emit('setpiece:end', { kind: k, len }); } else s.setPiece.tick++; }
  s.tick++;
}
function run(s, n) { for (let k = 0; k < n; k++) tick1(s); }
function runUntilDay(s, day) { let guard = 0; while (s.calendar.day < day && guard++ < 200000) tick1(s); }

// --- scenario 1: a full isolation season ------------------------------------------------------
{
  const s = newGame(8);
  events.length = 0; rec.posts.length = 0; rec.toasts.length = 0;
  run(s, 100);   // Aug 5: the team exists → the schedule is drawn
  eq(s.sports.hasTeam, true, 'a Practice Field makes a team');
  eq(s.sports.venue, 'bayou_field', 'Bayou Field is the venue');
  eq(s.sports.coach.name, 'Bobby Cheramie', 'Coach Cheramie comes with the field');
  eq(s.sports.starters.length, 8, 'eight named starters (QB RB WR OL DL LB DB K)');
  ok(s.sports.starters.map(x => x.pos).join() === 'QB,RB,WR,OL,DL,LB,DB,K' && s.sports.starters.every(x => typeof x.class === 'string'), 'starters in slot order with classes');
  ok(s.sports.playbook === 'balanced' && s.sports.aggression === 'normal' && s.sports.watchFull === false && s.sports.records && s.sports.records.allTime, 'engine keys present (playbook, aggression, watchFull, records)');
  eq(s.sports.schedule.length, 7, 'Aug 5 builds 7 games');
  eq(events.filter(e => e.name === 'game:scheduled').length, 7, 'game:scheduled per entry');
  const magnolia = s.sports.schedule.find(e => e.opp === 'magnolia');
  ok(magnolia && magnolia.home && magnolia.day === BSU.dateToDay('Nov 8', 1) && magnolia.kind === 'rivalry', 'Magnolia State on Nov 8 at home');
  eq(s.sports.schedule.filter(e => e.home).length, 4, 'four home games');
  runUntilDay(s, BSU.dateToDay('Dec 10', 1));
  const kick = events.filter(e => e.name === 'game:kickoff'), fin = events.filter(e => e.name === 'game:final'), half = events.filter(e => e.name === 'game:halftime');
  eq(kick.length, 4, '4 home set pieces kicked off');
  eq(half.length, 4, '4 halftimes');
  ok(fin.length === 7 || fin.length === 8, `7 (or 8 with a bowl) finals (${fin.length})`);
  const ends = events.filter(e => e.name === 'setpiece:end' && e.p.kind === 'game');
  eq(ends.length, 4, 'each home game ran its 750-tick set piece to the end');
  ok(events.some(e => e.name === 'game:score' && e.p.quarter >= 1 && e.p.quarter <= 5), 'game:score events during the set pieces (render/audio cues)');
  ok(s.sports.schedule.filter(e => !e.home && e.kind !== 'bowl').every(e => e.played && e.result && Number.isInteger(e.result.bsu)), 'away games resolved off-screen');
  const se = events.find(e => e.name === 'season:end');
  ok(se && se.p.wins + se.p.losses >= 7, `season:end on Dec 8 with a valid record (${se && se.p.wins}-${se && se.p.losses})`);
  const ls = s.sports.lastSeason;
  eq(ls.wins + ls.losses, se.p.wins + se.p.losses, 'lastSeason matches the season:end payload');
  ok(s.sports.record.wins === 0 && s.sports.record.losses === 0 && s.sports.seasonDone === true, 'record reset after the season');
  const bowlEntry = s.sports.schedule.find(e => e.kind === 'bowl');
  ok((ls.wins >= 5) === !!bowlEntry, `the bowl decision follows wins ≥ 5 (${ls.wins} wins → ${bowlEntry ? 'bowl' : 'no bowl'})`);
  ok(rec.posts.filter(p => p.key === 'athletics').length >= 4 && rec.posts.filter(p => p.key === 'tailgate').length === 4, 'athletics + tailgate posted per home game');
  ok(rec.posts.filter(p => p.key === 'athletics' && p.amount === 5872 * 47).length >= 1, 'a Bayou Field day game with winPct .5 grosses 5872 × $47');
  eq(s.sports.candidates.length, 3, 'Dec 9 offers three coaching candidates');
  ok(rec.tickers.some(t => t.line === 43 || t.line === 44) && rec.tickers.some(t => t.line === 60), 'ticker lines 43/44 and the recap 60');
  // halftime toast: opened at set-piece tick 400, defaulted by sports at 480 (headless: nobody answers)
  const ht = rec.toasts.filter(t => t.id === 'halftime');
  eq(ht.length, 4, 'one halftime toast per home game (' + rec.toasts.map(t => t.id + '@' + t.spTick).join(' ') + ')');
  ok(ht.every(t => t.spTick >= 370 && t.spTick <= 400 + 120), 'the toast opens at the end of Q2 (set-piece tick 370–400, later only after a 4th-down pause)');
  ok(ht.every(t => /Favored|Even|Underdog/.test(t.text) && /Open it up/.test(t.text) && /Pound the rock/.test(t.text)), 'toast text carries the live chance and both adjustments');
  ok(events.filter(e => e.name === 'game:kickoff').every(e => e.p.homePts === 0 && e.p.awayPts === 0 && e.p.home === true && e.p.mode === 'highlights'), 'kickoff payload shape (home highlights games only)');
  ok(fin.every(e => typeof e.p.won === 'boolean' && Number.isInteger(e.p.homePts) && Number.isInteger(e.p.awayPts) && e.p.homePts !== e.p.awayPts && e.p.summary && Array.isArray(e.p.summary.score)), 'final payloads: boolean won, integer points, no ties, a summary');
  const plays = events.filter(e => e.name === 'game:play'), drives = events.filter(e => e.name === 'game:drive'), decs = events.filter(e => e.name === 'game:decision');
  ok(plays.length >= 4 * 100 && plays.every(e => typeof e.p.text === 'string' && e.p.text.length > 0 && Number.isInteger(e.p.yds)), 'game:play per resolved play of every watched game (' + plays.length + ')');
  ok(drives.length >= 4 * 12 && drives.every(e => typeof e.p.text === 'string' && e.p.result), 'game:drive at drive ends (' + drives.length + ')');
  ok(decs.filter(e => e.p.kind === 'halftime' && !e.p.closed).length === 4 && decs.every(e => e.p.closed || (Array.isArray(e.p.options) && e.p.options.every(o => o.p > 0 && o.p < 1))), 'game:decision with win-probability options, closed again with the choice');
  ok(s.sports.records.allTime.wins + s.sports.records.allTime.losses === fin.length && (s.sports.records.bestWin === null || s.sports.records.bestWin.margin > 0) && s.sports.lastSummary && s.sports.lastSummary.mvp, 'records and lastSummary updated at every final');
}

// --- scenario 2: the halftime default lands exactly 80 ticks after the toast; the set piece stretches by the pause ---------------------
{
  const s = newGame(9);
  run(s, 100);
  const opener = s.sports.schedule.find(e => e.home);
  runUntilDay(s, opener.day);
  ok(s.setPiece && s.setPiece.kind === 'game' && s.sports.game, 'the Aug 8 opener starts the game set piece');
  const g = s.sports.game;
  eq(g.mode, 'highlights', 'the default watched mode is highlights');
  let answeredAt = -1;
  while (s.setPiece && !g.finalized) { tick1(s); if (answeredAt < 0 && g.halftimeAnswered) { answeredAt = s.setPiece.tick; } }
  ok(g.halftimeOpenedTick >= 370 && g.halftimeOpenedTick <= 520, 'halftime opened at the end of Q2 (' + g.halftimeOpenedTick + ')');
  ok(answeredAt === g.halftimeOpenedTick + 80 || answeredAt === g.halftimeOpenedTick + 81, 'defaulted 80 ticks later (' + answeredAt + ')');
  ok(g.halftimeChoice === 'stay' && !g.wentForIt, 'default = stay the course for a normal, balanced staff');
  ok(g.tOff >= 79 && s.setPiece.len === 750 + g.tOff && g.tOff <= 120, 'the set piece stretched by the paused ticks (' + g.tOff + ', the opening tick is not counted)');
  ok(g.finalized && g.over && g.score[0] !== g.score[1] && (g.homePts > g.awayPts) === (g.score[0] > g.score[1]), 'final from the engine, no tie, home points = BSU points');
  const lastQ2 = g.plays.filter(x => x.q === 2).pop();
  ok(g.plays.length >= 100 && g.plays.filter(p => p.q === 3 || p.q === 4).length >= 40 && lastQ2 && g.plays.filter(p => p.q === 3).every(p => p.n > lastQ2.n), 'the second half played after the halftime answer (no double quarter)');
  ok(s.sports.schedule.indexOf(s.sports.schedule.find(e => e.played && e.home)) >= 0 && s.sports.firstHomeGameDay === opener.day, 'first home game day recorded');
  run(s, 400);
  ok(!s.setPiece && !s.sports.game, 'game cleared at set-piece end');
  ok(rec.buses.length >= 2 && rec.buses[rec.buses.length - 1] === false, 'game-day buses on, then off');
}

// --- scenario 3: "Open it up" answered through decision:closed; a 4th-down decision through sports.decide -----------------------------------
{
  const s = newGame(10);
  run(s, 100);
  const opener = s.sports.schedule.find(e => e.home);
  runUntilDay(s, opener.day);
  const g = s.sports.game;
  while (s.setPiece && !(g.decision && g.decision.kind === 'halftime')) tick1(s);
  ok(g.decision && g.decision.kind === 'halftime' && g.decision.options.length === 3, 'the halftime decision is pending');
  const rng0 = BSU.rng.sim.state, tOff0 = g.tOff;
  tick1(s); tick1(s);
  ok(g.tOff === tOff0 + 2 && BSU.rng.sim.state === rng0, 'the engine pauses while the decision is open (no plays, no draws)');
  BSU.events.emit('decision:closed', { id: 'halftime', answer: 'yes' });
  BSU.events.emit('decision:closed', { id: 'halftime', answer: 'yes' });
  ok(g.halftimeAnswered && g.wentForIt && g.halftimeChoice === 'open' && !g.decision, 'open it up: applied once, decision cleared');
  ok(rec.tickers.filter(t => t.line === 61).length === 1, 'ticker 61 once across a duplicate close');
  const n0 = g.plays.length;
  tick1(s); tick1(s);
  ok(g.plays.length > n0, 'play resumes after the answer');
  while (s.setPiece) tick1(s);
  const e = s.sports.schedule.find(x => x === opener);
  ok(e.played && e.result.won === (e.result.home > e.result.away), 'the open-it-up game resolved');
  if (!e.result.won) ok(rec.timers.some(t => t.id === 'goForIt' && t.value === -2), 'a lost open-it-up adds the goForIt −2 timer');
  else ok(true, 'won after opening it up (no goForIt timer)');
  // a 4th-down decision: answered with sports.decide on a watched game
  const s2 = newGame(21); run(s2, 100);
  const op2 = s2.sports.schedule.find(x => x.home); runUntilDay(s2, op2.day);
  const g2 = s2.sports.game;
  let guard = 0;
  while (s2.setPiece && !(g2.decision && g2.decision.kind === 'fourthDown') && guard++ < 2000) tick1(s2);
  if (g2.decision && g2.decision.kind === 'fourthDown') {
    ok(g2.decision.options.some(o => o.key === 'go') && g2.decision.options.some(o => o.key === 'punt') && /4th & \d+ at/.test(g2.decision.text), '4th-down decision text and options (' + g2.decision.text + ')');
    const before = g2.plays.length, down = g2.down;
    const r = SP.decide(s2, 'go');
    ok(r.ok && r.chosen === 'go' && g2.pendingCall === 'go' && !g2.decision && down === 4, 'decide(go) resumes with the call pending');
    tick1(s2);
    ok(g2.plays.length > before && g2.plays[before].fourth === true && g2.plays[before].down === 4, 'the next play is the 4th-down attempt');
  } else ok(true, 'no 4th-down decision arose in this game (seed-dependent)');
  while (s2.setPiece) tick1(s2);
}

// --- scenario 4: Célestine on Sep 8 → postponed → the Resilience Bowl ---------------------------
{
  const s = newGame(11);
  run(s, 100);
  const sep8 = BSU.dateToDay('Sep 8', 1);
  const entry = s.sports.schedule.find(e => e.home && e.day === sep8);
  ok(entry, 'a Sep 8 home game exists');
  runUntilDay(s, sep8 - 1);
  s.storms.current = { name: 'Célestine', cat: 2, forecastCat: 2, nearMiss: false, phase: BSU.STORM.BANDS, landfallDay: sep8 };
  rec.bumps.length = 0;
  runUntilDay(s, sep8);
  ok(entry.postponed && entry.postponedTo === -1 && !s.sports.game, 'Sep 8 postponed with landfall today');
  ok(rec.notifies.some(n => /postponed/i.test(n)), 'postponement notified');
  s.storms.current.phase = BSU.STORM.LANDFALL;
  BSU.events.emit('storm:landfall', { name: 'Célestine' });
  run(s, 5);
  s.storms.current.phase = BSU.STORM.PASSED;
  BSU.events.emit('storm:passed', { name: 'Célestine' });
  s.storms.current = null;
  runUntilDay(s, sep8 + 1);
  ok(!entry.postponed && entry.postponedTo === sep8 + 2 && entry.day === sep8 + 2 && entry.kind === 'makeup', `makeup scheduled on the first free day (Sep ${(sep8 + 2) % 10 + 1}) as the Resilience Bowl`);
  ok(SP.upcoming(s) === entry, 'upcoming() is the makeup');
  runUntilDay(s, sep8 + 2);
  ok(s.setPiece && s.sports.game && s.sports.game.kind === 'makeup', 'the Resilience Bowl plays as a home set piece');
  while (s.setPiece) tick1(s);
  ok(entry.played && rec.bumps.some(b => b.stat === 'prestige' && b.delta === 4), '+4 prestige on the Resilience Bowl');
}

// --- scenario 5: Play Through It (weather's T−1 offer) ------------------------------------------
{
  const s = newGame(12);
  run(s, 100);
  const opener = s.sports.schedule.find(e => e.home);
  runUntilDay(s, opener.day - 1);
  s.storms.current = { name: 'Amélie', cat: 1, forecastCat: 1, nearMiss: false, phase: BSU.STORM.WATCH, landfallDay: opener.day + 1 };
  // the day boundary tick: weather would call offerPlayThrough at its bands step before sports.tick
  s.calendar.dayTick = 99;
  s.calendar.day++; s.calendar.dayTick = 0;
  s.storms.current.phase = BSU.STORM.BANDS;
  SP.offerPlayThrough(s);
  SP.tick(s, { newDay: true, day: s.calendar.day }); s.tick++;
  ok(rec.toasts.some(t => t.id === 'playThrough'), 'playThrough toast opened');
  ok(!s.sports.game && !opener.postponed, 'the game waits for the answer');
  BSU.events.emit('decision:closed', { id: 'playThrough', answer: 'yes' });
  tick1(s);
  ok(s.sports.game && s.sports.game.playThrough === true && s.storms.playThroughIt === true, 'yes → the game runs inside the bands');
  ok(rec.timers.some(t => t.id === 'playThroughIt' && t.value === -10 && t.days === 10), 'playThroughIt −10 for 10 days');
  ok(rec.tickers.some(t => t.line === 46), 'ticker 46');
  rec.bumps.length = 0;
  while (s.setPiece) tick1(s);
  const won = opener.result && opener.result.won;
  ok(won ? rec.bumps.some(b => b.stat === 'prestige' && b.delta === 3) : !rec.bumps.some(b => b.delta === 3), 'the +3 "legend" prestige only on a win');
  s.storms.current = null;
}

// --- scenario 6: rating lines sum to sports.rating; the Season panel numbers ------------------------
{
  const s = newGame(13);
  run(s, 100);
  const r = SP.rating(s);
  const sum = Object.values(r.terms).reduce((a, b) => a + b, 0);
  ok(Math.abs(sum - r.rating) < 1e-9 && Math.abs(s.sports.rating - r.rating) < 1e-9, `rating terms sum to the stored rating (${r.rating.toFixed(2)})`);
  ok(['base', 'practiceField', 'coaching', 'recruiting', 'morale', 'roux', 'heat', 'coach', 'starters', 'recruitingTrip', 'voice'].every(k => k in r.terms), 'every §8 term is a line');
  ok(r.terms.heat === -8, 'the Aug–Sep heat term applies without a Rec Center');
  const p = SP.winProb(s, 'magnolia', false, true);
  ok(p > 0 && p < 1 && SP.probWord(p) === 'Underdog', `Underdog · ${Math.round(p * 100)}% vs Magnolia at Bayou Field`);
  eq(SP.venueSeats(s), 6000, 'Bayou Field seats 6,000');
  eq(SP.homeWinsThisSeason(s), 0, 'no home wins yet');
  eq(SP.winPctLast4(s), 0.5, 'neutral winPct before any game');
}

// --- scenario 7: save/load mid-game resumes identically --------------------------------------------
{
  const s = newGame(14);
  run(s, 100);
  const opener = s.sports.schedule.find(e => e.home);
  runUntilDay(s, opener.day);
  while (s.setPiece.tick < 300) tick1(s);
  // "save": a structural clone of the tree + the rng state; "load": a fresh root with reset(false)
  const doc = BSU.deepClone({ sports: s.sports, setPiece: s.setPiece, calendar: s.calendar, storms: s.storms, economy: s.economy, tick: s.tick, rng: BSU.rng.sim.state });
  const a = s;
  while (a.setPiece) tick1(a);
  const resA = JSON.stringify(a.sports.schedule[opener === a.sports.schedule[0] ? 0 : a.sports.schedule.indexOf(opener)].result) + '|' + BSU.rng.sim.state;
  const b = BSU.newState(14);
  b.sports = doc.sports; b.setPiece = doc.setPiece; b.calendar = doc.calendar; b.storms = doc.storms; b.economy = doc.economy; b.tick = doc.tick;
  BSU.rng.sim.state = doc.rng;
  cur = b;
  const rngBefore = BSU.rng.sim.state;
  SP.reset(b, false);
  ok(BSU.rng.sim.state === rngBefore && b.sports.game && b.sports.game.kickedOff && b.sports.game.plays.length > 0, 'reset(false) draws nothing and keeps the saved game mid-play');
  while (b.setPiece) tick1(b);
  const resB = JSON.stringify(b.sports.schedule.find(e => e.played && e.home).result) + '|' + BSU.rng.sim.state;
  eq(resB, resA, 'the resumed game reaches the same final and rng state');
}

// --- scenario 8: determinism and a full second season --------------------------------------------
{
  const runTwo = () => { const s = newGame(15); runUntilDay(s, BSU.dateToDay('Dec 9', 2)); return JSON.stringify(s.sports.schedule.map(e => [e.opp, e.day, e.kind, e.result])) + JSON.stringify(s.sports.lastSeason) + s.sports.coach.stars; };
  const r1 = runTwo(), r2 = runTwo();
  eq(r1, r2, 'two runs with the same seed produce identical two-season results');
  const s = newGame(16);
  runUntilDay(s, BSU.dateToDay('Dec 9', 2));
  eq(s.sports.seasonYear, 2, 'a second season is drawn on the next Aug 5');
  ok(s.sports.seasonDone && s.sports.lastSeason.wins + s.sports.lastSeason.losses >= 7, 'the second season ends too');
}

// --- scenario 9: no team → nothing fires (smoke unaffected) --------------------------------------
{
  rec.field.built = 0;
  const s = newGame(17);
  events.length = 0;
  runUntilDay(s, BSU.dateToDay('Jan 2', 2));
  ok(s.sports.hasTeam === false && s.sports.schedule.length === 0 && s.sports.rating === 0, 'no team: empty schedule, rating 0');
  eq(events.length, 0, 'no sports events without a team');
  rec.field.built = 1;
}

// --- scenario 10: no NaN/Infinity in the owned branch after a season -----------------------------
{
  const s = newGame(18);
  runUntilDay(s, BSU.dateToDay('Jan 2', 2));
  const scan = (v, path) => {
    if (typeof v === 'number') return Number.isFinite(v) ? null : path;
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) { const r = scan(v[k], path + '.' + k); if (r) return r; } }
    return null;
  };
  const bad = scan(s.sports, 'sports');
  ok(!bad, 'no NaN/Infinity in state.sports: ' + bad);
  ok(JSON.stringify(s.sports).length > 0 && !/Infinity|NaN/.test(JSON.stringify(s.sports)), 'state.sports is JSON-safe');
}

// --- performance: the per-tick path over a season with a team --------------------------------------
{
  const s = newGame(19);
  const t0 = performance.now();
  run(s, 12000);
  const perTick = (performance.now() - t0) / 12000;
  ok(perTick < 0.3, `sports.tick averages ${(perTick * 1000).toFixed(1)} µs per tick over a year (< 300 µs; includes the test's session emulation)`);
}

// --- PLAN_FOOTBALL pass A hotfix, whole game: setPiecesSeen.game gates Skip ▸ and the auto-sim montage -----------------
// Built index.html + real session/progress/ui: the first home game is a full unskippable 750-tick watch; once it ends the
// next home game is skippable (Skip works at tick 200), and with Auto-sim on the one after that is a 50-tick montage.
if (existsSync(join(root, 'index.html'))) {
  const { win: gw } = loadGame();
  const B = gw.BSU, H = B.headless;
  const s = B.session.newGame({ seed: 42, skipTutorial: true }) || B.state;
  s.economy.cash = 90e6; s.economy.students = 1600; s.economy.prestige = 30; s.economy.alumni = 500;
  const spot = H.findSpot('practice_field'); H.place('practice_field', spot.x, spot.y); H.tick(900);
  B.buildings.upgrade(s, B.buildings.list(s, 'practice_field')[0].id); H.tick(800);
  const nextGame = function (autoSim, trySkip) {
    B.sports.setAutoSim(s, autoSim);
    let guard = 0;
    for (;;) {
      while (!s.setPiece && guard++ < 8000) H.tick(10);
      if (!s.setPiece || s.setPiece.kind === 'game' || s.setPiece.kind === 'montage') break;
      while (s.setPiece) H.tick(5);   // a landfall between games
    }
    const sp = s.setPiece, rec = { kind: sp && sp.kind, len: sp && sp.len, skippableAtStart: sp && sp.skippable, ticks: 0, skippedAt200: null };
    while (s.setPiece === sp && rec.ticks < 900) {   // pass B: a decision pause stretches the 750-tick set piece by ≤ 120
      H.tick(1); rec.ticks++;
      if (trySkip && s.setPiece === sp && sp.tick >= 200 && rec.skippedAt200 === null) { rec.skippedAt200 = sp.skippable; B.session.skipSetPiece(s); }
    }
    return rec;
  };
  const g1 = nextGame(false, false);
  ok(g1.kind === 'game' && g1.len === 750 && g1.skippableAtStart === false, 'first home game: a full 750-tick set piece, not skippable');
  H.tick(2);
  eq(B.progress.setPieceSeen(s, 'game'), true, 'the first home game ending marks the game set piece seen');
  const g2 = nextGame(false, true);
  ok(g2.kind === 'game' && g2.skippableAtStart === true, 'second home game is skippable from the start (Skip ▸ available)');
  ok(g2.skippedAt200 === true && g2.ticks < 260, `Skip at tick 200 ends the game immediately (${g2.ticks} ticks, not 750)`);
  const g3 = nextGame(true, false);
  ok(g3.kind === 'montage' && g3.len === 50 && g3.ticks <= 52, `with Auto-sim the next home game is a ${g3.len}-tick montage (5 s, ran ${g3.ticks} ticks) instead of 75 s`);
  ok(s.sports.schedule.filter(e => e.played).length >= 3, 'all three games were scored and recorded');
}

// --- PLAN_FOOTBALL pass B: engine calibration (silent games through the _playGame hook) -----------------------------
{
  const s = newGame(30); run(s, 100);
  s.sports.coach = { name: 'x', stars: 2, hiredYear: 1, quote: '', rep: '' };   // no scheme → no coach fit (a clean rating comparison)
  s.sports.starters = s.sports.starters.map(x => Object.assign({}, x, { rating: 75 }));
  // a symmetric opponent (balanced, defBias 0) injected through the data dep: a clean rating-gap comparison
  SP._deps.data = Object.assign({}, BSU.data, { opponents: Object.assign({}, BSU.data.opponents, { neutral: { name: 'Neutral University', nick: 'Neutrals', rating: 60, colors: ['#888888', '#ffffff'], rival: false, crosstown: false, style: 'balanced', defBias: 0 } }) });
  BSU.rng.sim.state = 777;
  const play = (n, opts) => { const out = { win: 0, margin: 0, pts: 0, snaps: 0, to: 0, games: n, nan: 0, ot: 0 }; for (let i = 0; i < n; i++) { const g = SP._playGame(s, opts); if (!g.over || g.score[0] === g.score[1]) out.nan++; if (/NaN|Infinity/.test(JSON.stringify(g))) out.nan++; if (g.score[0] > g.score[1]) out.win++; out.margin += g.score[0] - g.score[1]; out.pts += g.score[0] + g.score[1]; out.snaps += g.plays.filter(p => p.type !== 'kickoff' && p.type !== 'xp' && p.type !== 'two').length; out.to += g.box[0].to + g.box[1].to; if (g.ot) out.ot++; } out.win /= n; out.margin /= n; out.pts /= n; out.snaps /= n; out.to /= n; return out; };
  const t0 = performance.now();
  const gaps = [-20, -10, 0, 10, 20], shares = [];
  let ptsAll = 0, snapsAll = 0, toAll = 0, nanAll = 0, games = 0;
  for (const gap of gaps) { const r = play(gap === 20 || gap === 0 ? 400 : 160, { opp: 'neutral', oppRating: 60, rating: 60 + gap, home: false, kind: 'bowl' }); shares.push(r.win); ptsAll += r.pts * r.games; snapsAll += r.snaps * r.games; toAll += r.to * r.games; nanAll += r.nan; games += r.games; }
  const neutral = play(500, { opp: 'neutral', oppRating: 60, rating: 60, home: false, kind: 'bowl' });
  const homeDay = play(500, { opp: 'neutral', oppRating: 60, rating: 60, home: true });
  games += 1000; ptsAll += (neutral.pts + homeDay.pts) * 500; snapsAll += (neutral.snaps + homeDay.snaps) * 500; toAll += (neutral.to + homeDay.to) * 500; nanAll += neutral.nan + homeDay.nan;
  const ms = performance.now() - t0;
  ok(games >= 500 && nanAll === 0, games + ' silent games: no NaN, no ties, every game over (' + ms.toFixed(0) + ' ms)');
  ok(shares.every((w, i) => i === 0 || w > shares[i - 1]), 'win share is monotone in the rating gap (' + shares.map(w => w.toFixed(2)).join(' < ') + ')');
  ok(Math.abs(shares[2] - 0.5) <= 0.08, 'about 50% at equal ratings (' + shares[2].toFixed(3) + ')');
  ok(shares[4] >= 0.85, 'at least 85% at +20 (' + shares[4].toFixed(3) + ', winProb elo gives ' + (1 / (1 + Math.pow(10, -20 / 25))).toFixed(3) + ')');
  ok(shares[0] <= 0.15, 'at most 15% at −20 (' + shares[0].toFixed(3) + ')');
  const perTeam = ptsAll / games / 2;
  ok(perTeam >= 17 && perTeam <= 38, 'average points per team 17–38 (' + perTeam.toFixed(1) + ', total ' + (ptsAll / games).toFixed(1) + ')');
  const hfa = homeDay.margin - neutral.margin;
  ok(hfa >= 2 && hfa <= 5.5, 'a full Bayou Field day crowd is worth about +2 to +5 points (' + hfa.toFixed(1) + '; win ' + homeDay.win.toFixed(3) + ' vs winProb ' + SP.winProb(s, 60, false, true).toFixed(3) + ')');
  const snaps = snapsAll / games;
  ok(snaps >= 120 && snaps <= 145, 'snaps per game (scrimmage + punts + FGs) 120–145 (' + snaps.toFixed(0) + ')');
  ok(toAll / games >= 1 && toAll / games <= 4, 'turnovers per game 1–4 (' + (toAll / games).toFixed(2) + ')');
  // playbook: air passes for ≥ 25% more yards and throws ≥ 20% more picks than ground
  const pb = (style) => { s.sports.playbook = style; let py = 0, ints = 0; BSU.rng.sim.state = 99; for (let i = 0; i < 150; i++) { const g = SP._playGame(s, { opp: 'crescent', oppRating: 60, rating: 60, home: false, kind: 'bowl' }); py += g.box[0].passYds; ints += g.box[0].ints; } return { py: py / 150, ints: ints / 150 }; };
  const ground = pb('ground'), air = pb('air'); s.sports.playbook = 'balanced';
  ok(air.py >= ground.py * 1.25 && air.ints >= ground.ints * 1.2, 'air raises pass yards ≥ 25% (' + ground.py.toFixed(0) + ' → ' + air.py.toFixed(0) + ') and INTs ≥ 20% (' + ground.ints.toFixed(2) + ' → ' + air.ints.toFixed(2) + ') over ground');
  // night at the Cauldron: a bigger edge than a Bayou Field day
  rec.extra.push({ id: 9, type: 'stadium', tx: 20, ty: 20, w: 6, h: 5, built: 1, tier: 2, hp: 1, ruin: false });
  SP.tick(s, { newDay: false, day: s.calendar.day }); s.sports.venue = 'stadium2';
  BSU.rng.sim.state = 5;
  const night = play(300, { opp: 'neutral', oppRating: 60, rating: 60, home: true, night: true, attendance: 45000 });
  ok(night.win > homeDay.win + 0.05 && night.margin > homeDay.margin + 3, 'a Cauldron night game beats a Bayou Field day for home field (' + night.win.toFixed(3) + ' vs ' + homeDay.win.toFixed(3) + ')');
  rec.extra.length = 0; s.sports.nightToggle = false; delete SP._deps.data;
}

// --- PLAN_FOOTBALL pass B: deterministic replay of a watched game, live state, watch-full mode ------------------------------
{
  const watch = (seed, full) => { const s = newGame(seed); run(s, 100); SP.setWatchFull(s, !!full); const op = s.sports.schedule.find(e => e.home); runUntilDay(s, op.day); const g = s.sports.game; const texts = []; let lives = 0, players22 = true, decisions = 0, firstLive = null; const animated = new Set(); while (s.setPiece) { tick1(s); if (g.plays.length > texts.length) texts.push(g.plays[texts.length].text); const lv = SP.live(s); if (g.anim) animated.add(g.anim.n); if (lv.active && g.kickedOff && !g.finalized) { lives++; if (lv.players.length !== 22 || !lv.players.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (p.team === 0 || p.team === 1) && typeof p.pos === 'string' && typeof p.state === 'string') || !Number.isFinite(lv.ball.x) || !Number.isFinite(lv.ball.y)) players22 = false; if (!firstLive && lv.phase === 'live') firstLive = lv; } if (g.decision && (!g.decision._seen)) { g.decision._seen = true; decisions++; } } return { s, g, texts, lives, players22, decisions, firstLive, len: g.len0, tOff: g.tOff, animated: animated.size }; };
  const a = watch(31, false), b = watch(31, false);
  eq(a.texts.join('|'), b.texts.join('|'), 'the same seed replays the identical play-by-play stream (' + a.texts.length + ' plays)');
  eq(a.g.score.join('-'), b.g.score.join('-'), 'and the identical final');
  ok(a.lives > 300 && a.players22, 'sports.live(): 22 finite players and a ball on every tick of the watched game (' + a.lives + ' ticks)');
  ok(a.firstLive && a.firstLive.formation.off && a.firstLive.formation.def && a.firstLive.anim && Number.isFinite(a.firstLive.down) && Number.isFinite(a.firstLive.distance) && Number.isFinite(a.firstLive.spot) && a.firstLive.lastPlay && typeof a.firstLive.clockText === 'string', 'live state carries formation ids, the animated play, down/distance/spot and the last play');
  ok(a.animated >= 18 && a.animated <= 30, 'highlights animated about 20–30 key plays (' + a.animated + ' of ' + a.g.plays.length + '; 24 slots)');

  ok(a.len === 750 && a.tOff <= 120, 'highlights fit the 750-tick set piece (+ pause ' + a.tOff + ' ≤ 120)');
  const f = watch(32, true);
  ok(f.g.mode === 'full' && f.len >= 1900 && f.len <= 2600, 'watch full game: a ~2,200-tick set piece (' + f.len + ')');
  ok(f.g.plays.length >= 120 && f.g.plays.length <= 190 && f.animated === f.g.plays.length && f.g.finalized && f.s.sports.schedule.some(e => e.played && e.home), 'full mode animated every play (' + f.animated + ' of ' + f.g.plays.length + ') to a final');
  ok(!f.s.setPiece && !f.s.sports.game, 'the full-mode set piece ended after the final');
  ok(SP.summary(f.s) && SP.summary(f.s).mvp && SP.summary(f.s).yards.total.length === 2 && SP.summary(f.s).topText.every(x => /^\d+:\d\d$/.test(x)) && Number.isFinite(SP.summary(f.s).revenue.total), 'summary(): yards, time of possession, MVP, revenue after the game');
  const rp = SP.recentPlays(f.s, 5); ok(Array.isArray(rp) && rp.length === 0, 'recentPlays() is empty between games');
  ok(SP.live(f.s).active === false && SP.playState(f.s) === null, 'live()/playState() inactive between games');
  // montage (auto-sim after the first game was seen): resolves at tick 5, quarters reveal 10/20/30/40, final at 45
  const m = f.s; rec.seen = true; SP.setAutoSim(m, true); SP.setWatchFull(m, false);
  const next = m.sports.schedule.find(e => e.home && !e.played); runUntilDay(m, next.day);
  ok(m.setPiece && m.setPiece.kind === 'montage' && m.sports.game.mode === 'montage', 'auto-sim → montage');
  const mg = m.sports.game; let shownAt10 = null;
  while (m.setPiece) { tick1(m); if (m.setPiece && m.setPiece.tick === 12) shownAt10 = mg.homePts + mg.awayPts; }
  ok(mg.over && mg.finalized && next.played && shownAt10 !== null && shownAt10 <= mg.homePts + mg.awayPts, 'the montage resolved the whole game instantly and revealed the score quarter by quarter');
  rec.seen = false;
}

// --- PLAN_FOOTBALL pass C: the Spring Game (3 days after the field, deferred by a busy day), no record, the live state ----------------
{
  const springs = [];
  BSU.events.on('game:spring', (p) => springs.push(JSON.parse(JSON.stringify(p))), 'test');
  const s = newGame(21);
  s.calendar.day = BSU.dateToDay('Feb 10', 1);   // the stub field "completes" on Feb 10 Y1 (inside the Jan 1 – Jul 10 window)
  rec.notifies.length = 0; rec.tickers.length = 0; rec.posts.length = 0; rec.bumps.length = 0; events.length = 0;
  run(s, 1);
  const d0 = BSU.dateToDay('Feb 10', 1);
  eq(s.sports.springDay, d0 + 3, 'the Spring Game is scheduled 3 days after the field completes');
  ok(rec.notifies.some(t => /Spring Game/.test(t)) && rec.tickers.some(t => typeof t.line === 'string' && /Spring Game/.test(t.line)), 'announced by a notify and a ticker line (the card goes through progress.sportsCard)');
  const sp0 = SP.spring(s); ok(sp0.scheduledDay === d0 + 3 && sp0.daysUntil === 3 && sp0.playedYear === 0, 'sports.spring() reports the date');
  // a storm on the board the day it is due → deferred by a day; cleared → it fires at the first tick of the next day
  runUntilDay(s, d0 + 2); s.storms.current = { name: 'Test', cat: 1, forecastCat: 1, nearMiss: false, landfallDay: d0 + 6 };
  runUntilDay(s, d0 + 3); run(s, 3);
  ok(!s.setPiece && !s.sports.game && s.sports.springDay === d0 + 4, 'a storm on the scheduled day defers the Spring Game to the next day (' + s.sports.springDay + ')');
  s.storms.current = null;
  runUntilDay(s, d0 + 4); run(s, 2);
  ok(s.setPiece && s.setPiece.kind === 'spring' && s.setPiece.len === 300 && s.sports.game && s.sports.game.kind === 'spring' && s.sports.game.mode === 'highlights' && s.sports.game.night === false, 'the Spring Game set piece: kind spring, 300 ticks, highlights, a day game');
  const wins0 = s.sports.record.wins + s.sports.record.losses, cash0 = rec.posts.length;
  let lives = 0, players22 = true, maxTick = 0, toasts = 0;
  const g = s.sports.game;
  while (s.setPiece && maxTick < 600) { tick1(s); maxTick++; const lv = SP.live(s); if (lv.active && g.kickedOff && !g.finalized) { lives++; if (lv.players.length !== 22) players22 = false; } if (g.decision && !g.decision._seen) { g.decision._seen = true; toasts++; } }
  ok(!s.setPiece && !s.sports.game && g.finalized && g.over && maxTick >= 300 && maxTick <= 300 + 120, 'the set piece ran its 300 ticks (+ a paused toast) and ended (' + maxTick + ' ticks, ' + toasts + ' toasts)');
  ok(lives > 150 && players22, 'live() carried 22 players through the scrimmage (' + lives + ' ticks)');
  ok(toasts <= 1 + 1, 'at most one 4th-down/two-point toast plus the halftime one in a Spring Game');
  eq(s.sports.record.wins + s.sports.record.losses, wins0, 'no record impact');
  eq(springs.length, 1, 'game:spring emitted once');
  ok(springs[0].kind === 'spring' && springs[0].summary && springs[0].summary.mvp && Array.isArray(springs[0].score) && springs[0].score[0] !== springs[0].score[1], 'game:spring carries the summary, the MVP and a decided score (' + springs[0].score + ')');
  ok(s.sports.lastSpring && s.sports.lastSpring.year === 1 && s.sports.springYear === 1 && s.sports.springDay === -1, 'lastSpring recorded; one per year');
  ok(rec.posts.length === cash0 + 1 && rec.posts[cash0].key === 'athletics' && rec.posts[cash0].amount === BSU.params.sports.engine.spring.concessions, 'the concession line is the only revenue');
  ok(rec.bumps.some(b => b.stat === 'happiness' && b.delta === 1 && /Spring/.test(b.why)) && rec.bumps.some(b => b.stat === 'prestige' && b.delta === 1), '+1 happiness and +1 prestige');
  ok(rec.notifies.some(t => /Spring Game final/.test(t)) && rec.tickers.some(t => typeof t.line === 'string' && /final/.test(t.line)), 'the final is on the ticker and a notify');
  ok(!events.some(e => e.name === 'game:final'), 'no game:final for the scrimmage (progress achievements untouched)');
  ok(s.sports.lastSummary && s.sports.lastSummary.kind === 'spring' && s.sports.lastSummary.revenue.tickets === 0 && s.sports.lastSummary.revenue.concessions > 0, 'summary(): kind spring, no ticket revenue');
  const dr = SP.drill(s); ok(dr && dr.phase === 'drill' && dr.players.length === 11 && dr.players.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.team === 0) && SP.live(s).drill && SP.live(s).active === false, 'the idle practice drill: 11 players on the field between games (live().drill)');
  // a second start the same year is refused by the scheduler but allowed on demand; a later year schedules Apr 8
  run(s, 100); ok(s.sports.springDay === -1, 'nothing rescheduled the same year');
  const s2 = newGame(22); run(s2, 100);   // Aug 5 Y1: outside the window → no Y1 Spring Game; Y2 → Apr 8
  ok(s2.sports.springDay === -1 && s2.sports.springYear === 0, 'a team formed in August has no Spring Game that year');
  runUntilDay(s2, BSU.dateToDay('Jan 2', 2)); while (s2.setPiece) tick1(s2); run(s2, 2);
  eq(s2.sports.springDay, BSU.dateToDay('Apr 8', 2), 'Year 2: the Spring Game is on Apr 8');
  ok(SP.startSpringGame(s2).ok === true && s2.setPiece && s2.setPiece.kind === 'spring', 'startSpringGame() starts it on demand');
  while (s2.setPiece) tick1(s2);
  ok(!s2.sports.game && s2.sports.springYear === 2 && springs.length === 2, 'the on-demand game finished and counted for Year 2');
  BSU.events.clear('test');
  for (const name of ['game:scheduled', 'game:kickoff', 'game:score', 'game:halftime', 'game:final', 'season:end', 'coach:changed', 'setpiece:end', 'game:play', 'game:drive', 'game:decision']) {
    BSU.events.on(name, (p) => events.push({ name, p: JSON.parse(JSON.stringify(p)), tick: cur && cur.tick }), 'test');
  }
}

// --- PLAN_FOOTBALL pass C: season records + Hall of Fame at season:end, the Sugar Cane Bowl, away-game notifies ----------------------
{
  const s = newGame(23); events.length = 0; rec.notifies.length = 0; rec.tickers.length = 0;
  run(s, 100);
  ok(Array.isArray(s.sports.seasonLog) && s.sports.seasonLog.length === 0 && s.sports.seasonLines && s.sports.seasonLines.QB, 'seasonLog/seasonLines reset with the schedule');
  const dec9 = BSU.dateToDay('Dec 9', 1);
  runUntilDay(s, dec9); while (s.setPiece) tick1(s);
  const se = events.find(e => e.name === 'season:end');
  ok(se && Number.isFinite(se.p.pf) && Number.isFinite(se.p.pa) && Array.isArray(se.p.hof) && se.p.seasons === 1, 'season:end carries pf/pa/mvp/hof (' + se.p.wins + '-' + se.p.losses + ', ' + se.p.pf + ':' + se.p.pa + ')');
  const R1 = s.sports.records;
  eq(R1.seasons.length, 1, 'records.seasons appended at season:end');
  const row = R1.seasons[0];
  ok(row.year === 1 && row.wins === se.p.wins && row.losses === se.p.losses && row.pf === se.p.pf && row.pa === se.p.pa && typeof row.coach === 'string' && (row.mvp === null || (row.mvp.name && row.mvp.pos && row.mvp.line)) && row.games >= 7, 'the season row: year, W-L, points for/against, coach, MVP');
  const regular = s.sports.seasonLog.filter(e => e.kind !== 'bowl');
  ok(regular.length >= 7 && row.pf === regular.reduce((a, e) => a + e.score[0], 0) && row.pa === regular.reduce((a, e) => a + e.score[1], 0), 'pf/pa are the regular-season sums of the game log');
  ok(row.bowl === null ? row.wins < 5 : (row.wins >= 5 && row.bowl.opp && row.bowl.score.length === 2 && typeof row.bowl.won === 'boolean'), 'bowl eligibility at 5 wins; the bowl result sits in the row (' + (row.bowl ? row.bowl.opp + ' ' + row.bowl.score : 'no bowl') + ')');
  ok(s.sports.seasonLog.filter(e => !e.home).every(e => rec.notifies.some(t => t.indexOf(e.oppName) >= 0 && /·\s[WL]\s·/.test(t))) , 'every away game left a notify with its line');
  ok(rec.tickers.some(t => typeof t.line === 'string' && /bowl/i.test(t.line)), 'the bowl verdict is on the ticker');
  ok(R1.hof.every(h => h.name && h.pos && h.year === 1 && h.why), 'Hall of Fame entries (' + R1.hof.length + ') are well-formed');
  // the thresholds: a QB season of 2,500 yards enters the Hall
  s.sports.seasonLines.QB.yds = 2600; s.sports.seasonLog.push({ day: 0, opp: 'delta', oppName: 'Delta A&M', home: true, kind: 'regular', score: [20, 10], won: true, mvp: null });
  const hof0 = R1.hof.length; s.sports.seasonDone = false; s.sports.record.wins = 3; s.sports.record.losses = 4;
  s.calendar.day = BSU.dateToDay('Dec 8', 1); SP._buildSchedule(s); s.sports.seasonLines.QB.yds = 2600; for (const e of s.sports.schedule) { e.played = true; e.result = null; e.cancelled = true; }
  run(s, 101);
  ok(R1.seasons.length === 2 && R1.hof.length === hof0 + 1 && R1.hof[R1.hof.length - 1].pos === 'QB' && /2500/.test(R1.hof[R1.hof.length - 1].why), 'a 2,500-yard QB season enters the Hall of Fame');
}

// --- PLAN_FOOTBALL pass C: the prospect board (Dec 9, once), signing, the Aug 5 arrival; hire/fire untouched ----------------------
{
  const s = newGame(24); rec.notifies.length = 0; rec.tickers.length = 0;
  run(s, 100);
  const dec9 = BSU.dateToDay('Dec 9', 1);
  runUntilDay(s, dec9 - 1); while (s.setPiece) tick1(s);
  eq(SP.prospects(s), null, 'no board before Dec 9');
  runUntilDay(s, dec9); run(s, 2);
  const board = SP.prospects(s);
  ok(board && board.list.length === 3 && board.maxSignings === 2 && board.signed === 0 && board.open === true, 'Dec 9: a 3-prospect board at $200k coaching');
  ok(board.list.every(p => ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB', 'K'].indexOf(p.pos) >= 0 && p.rating >= 70 && p.rating <= 95 && p.cost >= 150000 && p.cost <= 900000 && p.cost % 10000 === 0 && p.name && p.hometown && p.title), 'prospects: position, rating 70–95, cost $150k–$900k (rounded to $10k), archetype');
  ok(rec.notifies.filter(t => /Prospect board/.test(t)).length === 1 && s.sports.prospects.offered === true, 'offered once (the notify fallback when progress lacks the card)');
  run(s, 300); ok(rec.notifies.filter(t => /Prospect board/.test(t)).length === 1, 'not re-offered on later days');
  const p0 = board.list[0];
  const r1 = SP.signProspect(s, 0);
  ok(r1.ok === true && r1.cost === p0.cost && SP.prospects(s).list[0].signed === true && SP.prospects(s).signed === 1, 'signProspect charges the cost and marks the prospect (' + p0.pos + ' ' + p0.name + ')');
  ok(SP.signProspect(s, 0).ok === false, 'cannot sign the same prospect twice');
  const same = board.list.findIndex((p, i) => i > 0 && p.pos === p0.pos);
  if (same > 0) ok(SP.signProspect(s, same).ok === false, 'one signing per position');
  ok(SP.signProspect(s, 99).ok === false && SP.passProspects(s).ok === true && SP.prospects(s).answered === true, 'bad index refused; Pass marks the board answered');
  // a bigger coaching budget → a bigger board, better prospects on average
  const s5 = newGame(25); s5.economy.coaching = 1500000; run(s5, 100); runUntilDay(s5, dec9); run(s5, 2);
  const b5 = SP.prospects(s5);
  ok(b5 && b5.list.length === 5, 'a $1.5M coaching budget draws a 5-prospect board');
  const avg = (b) => b.list.reduce((a, p) => a + p.rating, 0) / b.list.length;
  ok(avg(b5) > avg(board) - 4, 'quality follows the coaching budget (' + avg(board).toFixed(1) + ' → ' + avg(b5).toFixed(1) + ')');
  // Aug 5 Y2: the signed prospect replaces the starter at that position
  const before = s.sports.starters.find(x => x.pos === p0.pos);
  runUntilDay(s, BSU.dateToDay('Aug 6', 2)); while (s.setPiece) tick1(s);
  const after = s.sports.starters.find(x => x.pos === p0.pos);
  ok(after && after.name === p0.name && after.rating === p0.rating && after.class === 'Fr' && (!before || before.name !== p0.name), 'Aug 5: ' + p0.pos + ' ' + p0.name + ' replaced ' + (before && before.name) + ' (' + (before && before.rating) + ' → ' + after.rating + ')');
  ok(s.sports.prospects === null && s.sports.starters.length === 8, 'the board closes at the lock; eight starters');
  ok(rec.notifies.some(t => t.indexOf(p0.name) >= 0 && /arrives/.test(t)), 'the arrival is a notify');
  // hire/fire still work with a board open
  const s6 = newGame(26); run(s6, 100); runUntilDay(s6, dec9); run(s6, 2);
  const fired = SP.fireCoach(s6); ok(fired.ok === true && s6.sports.candidates.length === 3, 'fireCoach works in the off-season');
  const hired = SP.hireCoach(s6, 0); ok(hired.ok === true || /budget|fee/i.test(hired.reason), 'hireCoach answers (' + (hired.ok ? 'hired' : hired.reason) + ')');
}

// --- PLAN_FOOTBALL pass C: playbook calibration — air ≈ ground at equal ratings (home field still +2 to +5.5 above) ------------------
{
  const s = newGame(27); run(s, 100);
  s.sports.coach = { name: 'x', stars: 2, hiredYear: 1, quote: '', rep: '' };
  s.sports.starters = s.sports.starters.map(x => Object.assign({}, x, { rating: 75 }));
  SP._deps.data = Object.assign({}, BSU.data, { opponents: Object.assign({}, BSU.data.opponents, { neutral: { name: 'Neutral University', nick: 'Neutrals', rating: 60, colors: ['#888888', '#ffffff'], rival: false, crosstown: false, style: 'balanced', defBias: 0 } }) });
  const pb = (style, n) => { s.sports.playbook = style; BSU.rng.sim.state = 4242; let w = 0, py = 0, ints = 0; for (let i = 0; i < n; i++) { const g = SP._playGame(s, { opp: 'neutral', oppRating: 60, rating: 60, home: false, kind: 'bowl' }); if (g.score[0] > g.score[1]) w++; py += g.box[0].passYds; ints += g.box[0].ints; } return { win: w / n, py: py / n, ints: ints / n }; };
  const N = 500, ground = pb('ground', N), air = pb('air', N), bal = pb('balanced', N); s.sports.playbook = 'balanced';
  ok(Math.abs(air.win - ground.win) <= 0.08 && Math.abs(air.win - bal.win) <= 0.08 && Math.abs(ground.win - bal.win) <= 0.08, 'air ≈ ground ≈ balanced at equal ratings (ground ' + ground.win.toFixed(3) + ', balanced ' + bal.win.toFixed(3) + ', air ' + air.win.toFixed(3) + ')');
  ok(air.py >= ground.py * 1.25 && air.ints >= ground.ints * 1.2, 'air still throws for ≥ 25% more yards and ≥ 20% more picks (' + ground.py.toFixed(0) + ' → ' + air.py.toFixed(0) + ' yds, ' + ground.ints.toFixed(2) + ' → ' + air.ints.toFixed(2) + ' INT)');
  delete SP._deps.data;
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
