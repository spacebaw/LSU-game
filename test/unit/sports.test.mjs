// Unit test for src/js/sports.js: loads contract.js (+ every earlier manifest module that exists)
// and sports.js through makeWindow() from test/domstub.mjs with vm.runInContext, injects
// deterministic sibling stubs through BSU.sports._deps (the documented injection point, §10.6),
// runs BSU.sports.selfTest() and the scenario checks from docs/briefs/sports.md §9 "Done means":
// a full isolation season with 4 home set pieces and the bowl decision, the Sep 8 postponement →
// Resilience Bowl, the halftime toast defaulting after 80 ticks, rating lines summing to the
// rating, game:score during the set piece, a save/load mid-game resume, determinism, no NaN,
// a team-less year that fires nothing, and the per-tick budget.
// Usage: node test/unit/sports.test.mjs   (exit 1 on any failure)
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
for (const name of ['game:scheduled', 'game:kickoff', 'game:score', 'game:halftime', 'game:final', 'season:end', 'coach:changed', 'setpiece:end']) {
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
  eq(s.sports.starters.length, 3, 'three named starters');
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
  eq(ht.length, 4, 'one halftime toast per home game');
  ok(ht.every(t => t.spTick === 400), 'the toast opens at set-piece tick 400');
  ok(ht.every(t => /Favored|Even|Underdog/.test(t.text) && /Go for it/.test(t.text)), 'toast text carries the live chance and the rule');
  ok(events.filter(e => e.name === 'game:kickoff').every(e => e.p.homePts === 0 && e.p.awayPts === 0 && e.p.home === true), 'kickoff payload shape');
  ok(fin.every(e => typeof e.p.won === 'boolean' && Number.isInteger(e.p.homePts) && Number.isInteger(e.p.awayPts) && e.p.homePts !== e.p.awayPts), 'final payloads: boolean won, integer points, no ties');
}

// --- scenario 2: the halftime default lands exactly 80 ticks after the toast ---------------------
{
  const s = newGame(9);
  run(s, 100);
  const opener = s.sports.schedule.find(e => e.home);
  runUntilDay(s, opener.day);
  ok(s.setPiece && s.setPiece.kind === 'game' && s.sports.game, 'the Aug 8 opener starts the game set piece');
  const g = s.sports.game;
  let answeredAt = -1;
  while (s.setPiece && s.setPiece.tick <= 600) { tick1(s); if (answeredAt < 0 && g.halftimeAnswered) answeredAt = s.setPiece.tick; }
  eq(g.halftimeOpenedTick, 400, 'halftime opened at 400');
  ok(answeredAt >= 480 && answeredAt <= 481, `defaulted at 480 (${answeredAt})`);
  ok(g.wentForIt === false && g.P2 === g.P, 'default = play safe');
  ok(g.halves === 2 && g.revealed[0].every(x => x === 1) && g.revealed[1].every(x => x === 1), 'both halves drawn and revealed by 600');
  ok(g.finalized && (g.homePts > g.awayPts) === g.decided, 'final agrees with the decided winner');
  ok(s.sports.schedule.indexOf(s.sports.schedule.find(e => e.played && e.home)) >= 0 && s.sports.firstHomeGameDay === opener.day, 'first home game day recorded');
  run(s, 200);
  ok(!s.setPiece && !s.sports.game, 'game cleared at set-piece end');
  ok(rec.buses.length >= 2 && rec.buses[rec.buses.length - 1] === false, 'game-day buses on, then off');
}

// --- scenario 3: a "Go for it" answered through decision:closed -----------------------------------
{
  const s = newGame(10);
  run(s, 100);
  const opener = s.sports.schedule.find(e => e.home);
  runUntilDay(s, opener.day);
  while (s.setPiece && s.setPiece.tick < 405) tick1(s);
  const g = s.sports.game;
  const rng0 = BSU.rng.sim.state;
  BSU.events.emit('decision:closed', { id: 'halftime', answer: 'yes' });
  BSU.events.emit('decision:closed', { id: 'halftime', answer: 'yes' });
  ok(g.halftimeAnswered && g.wentForIt && Math.abs(g.swing) <= 8 && BSU.rng.sim.state !== rng0, 'go for it: swing within ±8, drawn once');
  ok(rec.tickers.filter(t => t.line === 61).length === 1, 'ticker 61 once across a duplicate close');
  ok(g.decided === (g.r < g.P2), 'decided re-evaluated against the same r');
  while (s.setPiece) tick1(s);
  const e = s.sports.schedule.find(x => x === opener);
  ok(e.played && e.result.won === (e.result.home > e.result.away), 'the go-for-it game resolved');
  if (!e.result.won) ok(rec.timers.some(t => t.id === 'goForIt' && t.value === -2), 'a lost Go-for-it adds the goForIt −2 timer');
  else ok(true, 'won after going for it (no goForIt timer)');
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
  ok(BSU.rng.sim.state === rngBefore && b.sports.game && b.sports.game.halves === 1, 'reset(false) draws nothing and keeps the saved game');
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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
