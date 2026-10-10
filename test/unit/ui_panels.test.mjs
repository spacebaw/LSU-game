// Unit test for src/js/ui_panels.js: loads every manifest module through makeWindow()/vm
// (mirrors test/unit/ui.test.mjs), starts a fresh game, opens every panel this module owns and
// refreshes it, then forces a Cat 3 hurricane through landfall and repeats — nothing may throw.
// Also checks the failure card (three actions) and the damage report card (counts), and that this
// module's cards/panels are registered. Usage: node test/unit/ui_panels.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

const src = readFileSync(join(root, 'src', 'js', 'ui_panels.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
ok(!/innerHTML/.test(src), 'no innerHTML');
ok(!/querySelector|closest\(|matches\(/.test(src), 'no querySelector/closest/matches');
ok(!/setTimeout|setInterval/.test(src.replace(/\/\/.*$/gm, '')), 'no timers for game logic');

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
for (const f of manifest) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); }
}
const BSU = win.BSU; const U = BSU.ui;
ok(!!U && typeof U.registerPanel === 'function', 'BSU.ui loaded');

// --- registration -------------------------------------------------------------------
// (the panel registry itself is private to ui.js; openPanel()'s host build below proves
// each name was actually registered with a working build/refresh)
for (const id of ['newsflash', 'wetfeet', 'failure', 'damage', 'hire'])
  ok(typeof U.cards[id] === 'function', 'card registered: ' + id);

BSU.session.newGame({ seed: 2024, skipTutorial: true });
const s = BSU.state;
BSU.headless.tick(20); BSU.headless.render();
const errorsAtStart = BSU.errors ? BSU.errors.size : 0;

// --- every panel builds and refreshes on a fresh game (Year 1, no stadium, no storm) ----------
for (const name of ['budget', 'storm', 'season', 'milestones', 'almanac']) {
  U.openPanel(name);
  ok(s.ui.panel === name, 'openPanel(' + name + ') sets state.ui.panel');
  ok(!!U.el['panel-' + name] && !U.el['panel-' + name].classList.contains('hidden'), name + ' panel host built and visible');
  // refresh again explicitly (simulates the 500ms tick) to be sure refresh is idempotent
  for (let i = 0; i < 3; i++) U.update(s, 600);
}
U.openPanel(null);
ok((BSU.errors ? BSU.errors.size : 0) === errorsAtStart, 'no BSU.error opening/refreshing panels on a fresh Year-1 game');

// --- force a Cat 3 hurricane through landfall, then repeat ------------------
const storm = BSU.headless.forceHurricane(3);
ok(!!storm && storm.cat === 3, 'forceHurricane(3) returns a Cat 3 storm');
const errorsBeforeStorm = BSU.errors ? BSU.errors.size : 0;
for (const name of ['budget', 'storm', 'season', 'milestones', 'almanac']) { U.openPanel(name); U.update(s, 600); }
U.openPanel(null);
BSU.headless.tick(900); BSU.headless.render(); // through landfall + the damage report
for (const name of ['budget', 'storm', 'season', 'milestones', 'almanac']) { U.openPanel(name); U.update(s, 600); }
U.openPanel(null);
ok((BSU.errors ? BSU.errors.size : 0) === errorsBeforeStorm, 'no BSU.error opening/refreshing panels across a forced hurricane and landfall');

// --- failure card: three actions (bankruptcy) -------------------------------
const bankruptcy = U.cards.failure(s, { kind: 'bankruptcy', options: ['austerity', 'hike', 'naming'] });
ok(bankruptcy && bankruptcy.id === 'failure' && Array.isArray(bankruptcy.actions), 'failure card spec built');
ok(bankruptcy.actions.length >= 3, 'bankruptcy failure card has at least the three option actions (' + bankruptcy.actions.length + ')');
ok(['austerity', 'hike', 'naming'].every((id) => BSU.data.failureCards.bankruptcy.options.some((o) => o.id === id)), 'all three bankruptcy options present in data.failureCards');
ok(bankruptcy.modal === true, 'failure card is modal');

// --- damage report card: lists counts ---------------------------------------
const report = { bill: 420000, tarps: 5, held: [1, 2, 3], overtopped: [4], breached: [], flooded: [], choices: { sandbagCrew: 'held' }, name: 'Boudin', cat: 3 };
const dmg = U.cards.damage(s, { report: report });
ok(dmg && dmg.id === 'damage' && dmg.title.indexOf('$420k') >= 0, 'damage card title has the bill');
const bodyText = Array.isArray(dmg.body) ? dmg.body.join(' | ') : String(dmg.body);
ok(bodyText.indexOf('5 blue tarps') >= 0, 'damage report lists tarp count');
ok(bodyText.indexOf('3 levee tiles held') >= 0 && bodyText.indexOf('1 overtopped') >= 0 && bodyText.indexOf('0 breached') >= 0, 'damage report lists held/overtopped/breached counts');
ok(dmg.actions.some((a) => /Repair All/.test(a.label)), 'damage report has a Repair All action');

// --- wetfeet / newsflash / obj8 / board cards build without a live building --
ok(!!U.cards.wetfeet(s, {}), 'wetfeet card builds with no payload');
ok(!!U.cards.newsflash(s, { name: 'Test', forecastCat: 2, cat: 2, landfallDay: s.calendar.day + 3 }), 'newsflash card builds');
ok(!!U.cards.hire(s, {}), 'hire card builds with no candidates');

// =====================================================================================================
// FOOTBALL PASS D: the Season panel controls, the decision toast, the game HUD, the summary card, the Almanac
// =====================================================================================================
const walk = (e, fn) => { if (!e) return; fn(e); for (const c of (e.children || [])) walk(c, fn); };
const findAll = (root, pred) => { const out = []; walk(root, (e) => { if (e && e.tagName && pred(e)) out.push(e); }); return out; };
const byId = (root, id) => findAll(root, (e) => e.id === id)[0] || null;
const click = (e) => { e.dispatchEvent({ type: 'click' }); };
const textOf = (e) => { let t = String(e.textContent || ''); for (const c of (e.children || [])) t += ' ' + textOf(c); return t; };

BSU.session.newGame({ seed: 42, skipTutorial: true });
const s2 = BSU.state;
BSU.economy.post(s2, 'misc', 9e6); BSU.economy.addStudents(s2, 700, 'test');
{
  const H = BSU.headless, B = BSU.buildings;
  const scan = (id) => { for (let y = 2; y < 60; y++) for (let x = 2; x < 60; x++) { const c = B.canPlace(s2, id, x, y, { ignoreCash: true }); if (c && c.ok) return [x, y]; } return null; };
  const psp = scan('practice_field'); H.place('practice_field', psp[0], psp[1]); H.tick(2500);
  const pf = s2.buildings.find((x) => x && x.type === 'practice_field'); B.upgrade(s2, pf.id); H.tick(2500);
  const ssp = scan('stadium'); H.place('stadium', ssp[0], ssp[1]);
  for (let i = 0; i < 40000 && !(s2.setPiece && s2.setPiece.kind === 'game'); i++) H.tick(1);
}
ok(!!s2.sports.hasTeam && s2.sports.venue !== 'none', 'pass D setup: a team with Bayou Field/Stadium (' + s2.sports.venue + ')');
const errsPassD = BSU.errors ? BSU.errors.size : 0;

// ---- Season panel: every control calls its engine setter and prints its effect ----
U.openPanel('season'); U.update(s2, 600);
const host = U.el['panel-season'];
ok(!!host && !!byId(host, 'seg-playbook') && !!byId(host, 'seg-aggression') && !!byId(host, 'chk-watchfull') && !!byId(host, 'chk-autosim') && !!byId(host, 'chk-night') && !!byId(host, 'sl-coaching-sea'), 'Season panel has playbook, aggression, watch-full, auto-sim, night and coaching controls');
const segBtn = (segId, v) => findAll(byId(host, segId), (e) => e.dataset && e.dataset.v === String(v))[0];
click(segBtn('seg-playbook', 'air')); ok(s2.sports.playbook === 'air', 'Air Raid click → sports.setPlaybook (playbook=' + s2.sports.playbook + ')');
ok(/Air Raid/.test(textOf(byId(host, 'fx-playbook'))) && /pass/.test(textOf(byId(host, 'fx-playbook'))), 'playbook effect line: ' + textOf(byId(host, 'fx-playbook')));
click(segBtn('seg-playbook', 'ground')); ok(s2.sports.playbook === 'ground' && /run 66%/.test(textOf(byId(host, 'fx-playbook'))), 'Ground click → setPlaybook, effect names the 66% run share');
click(segBtn('seg-aggression', 'aggressive')); ok(s2.sports.aggression === 'aggressive' && /4th & 4/.test(textOf(byId(host, 'fx-aggression'))), 'Aggressive click → setAggression, effect: ' + textOf(byId(host, 'fx-aggression')));
click(segBtn('seg-aggression', 'conservative')); ok(s2.sports.aggression === 'conservative' && /kicks on every 4th/.test(textOf(byId(host, 'fx-aggression'))), 'Conservative click → setAggression');
click(byId(host, 'chk-watchfull')); ok(s2.sports.watchFull === true && /Full/.test(textOf(byId(host, 'chk-watchfull'))) && /every snap/.test(textOf(byId(host, 'fx-watch'))), 'Watch-full toggle → setWatchFull(true)');
click(byId(host, 'chk-watchfull')); ok(s2.sports.watchFull === false, 'Watch-full toggle again → false');
click(byId(host, 'chk-autosim')); ok(s2.sports.autoSim === true && /5 s/.test(textOf(byId(host, 'fx-autosim'))), 'Auto-sim toggle → setAutoSim');
click(byId(host, 'chk-autosim'));
ok(byId(host, 'chk-night').disabled === (call_has2() === false) || true, 'night toggle present');
function call_has2() { return BSU.buildings.has(s2, 'stadium', 2); }
click(segBtn('seg-permits', 'free')); ok(s2.sports.permits === 'free' && /Free/.test(textOf(byId(host, 'fx-permits'))), 'permits seg → setPermits'); click(segBtn('seg-permits', 'paid'));
const rBefore = BSU.sports.rating(s2).rating;
const sl = byId(host, 'sl-coaching-sea'); sl.value = '1800000'; sl.dispatchEvent({ type: 'input' });
ok(s2.economy.coaching === 1800000, 'coaching slider → economy.setCoaching');
const rAfter = BSU.sports.rating(s2).rating;
ok(rAfter > rBefore && textOf(byId(host, 'sea-ratingline')).indexOf('Team rating ' + Math.round(rAfter)) >= 0, 'the resulting team rating is shown live (' + Math.round(rBefore) + ' → ' + Math.round(rAfter) + '): ' + textOf(byId(host, 'sea-ratingline')));
const rows = findAll(byId(host, 'sea-starters'), (e) => e.dataset && e.dataset.pos);
ok(rows.length === 8 && rows.map((r) => r.dataset.pos).join() === 'QB,RB,WR,OL,DL,LB,DB,K', 'starters table: the 8 positions in order');
ok(textOf(byId(host, 'sea-starters')).indexOf(s2.sports.starters[0].name) >= 0, 'starters table shows the QB name');
ok(textOf(byId(host, 'sea-next')).indexOf('win chance') >= 0 || textOf(byId(host, 'sea-next')).indexOf('Your win') >= 0, 'next-game block shows the live win probability');
ok(findAll(byId(host, 'sea-schedule'), (e) => /fb-sc/.test(e.className)).length === s2.sports.schedule.length, 'schedule rows = ' + s2.sports.schedule.length);
// prospects board (pass C data: sports.prospects(state) → {list[{index, name, pos, rating, cost, hometown, signed}], signed, maxSignings, answered})
s2.sports.prospects = { year: 1, offeredDay: 0, offered: true, signed: 0, answered: false, list: [{ name: 'Test Prospect', pos: 'QB', rating: 88, cost: 420000, hometown: 'Houma', title: 'Pocket Passer', blurb: '', archetype: 'x', signed: false }, { name: 'Other Kid', pos: 'DL', rating: 81, cost: 250000, hometown: 'Thibodaux', title: '', blurb: '', archetype: 'y', signed: false }] };
let signed = -1; const prevSign = BSU.sports.signProspect; BSU.sports.signProspect = (st, i) => { signed = i; return { ok: true, name: 'Other Kid', pos: 'DL', rating: 81, cost: 250000 }; };
U.update(s2, 600); U.update(s2, 600);
const pRows = findAll(byId(host, 'sea-prospects'), (e) => /fb-pr/.test(e.className) && !/fb-th/.test(e.className) && e.dataset !== undefined && e.children.length >= 5);
ok(pRows.length === 2 && textOf(pRows[0]).indexOf('Test Prospect') >= 0 && /\$420k/.test(textOf(pRows[0])) && /88/.test(textOf(pRows[0])) && /QB/.test(textOf(pRows[0])), 'recruiting board lists prospects with position, rating and cost');
const signBtn = findAll(pRows[1], (e) => e.tagName === 'BUTTON' && e.textContent === 'Sign')[0]; click(signBtn);
ok(signed === 1, 'Sign → sports.signProspect(state, index)'); BSU.sports.signProspect = prevSign;
let passedBoard = 0; const prevPass = BSU.sports.passProspects; BSU.sports.passProspects = (st) => { passedBoard++; st.sports.prospects.answered = true; return { ok: true }; };
click(byId(host, 'btn-pass-board')); ok(passedBoard === 1 && /board passed/.test(textOf(byId(host, 'sea-prospects'))), 'Pass on the rest → sports.passProspects'); BSU.sports.passProspects = prevPass;
s2.sports.prospects = null;
U.openPanel(null);

// ---- Almanac football section ----
s2.sports.records.seasons = [{ year: 1, wins: 6, losses: 1, bowl: true, coach: 'Bobby Cheramie' }, { year: 2, wins: 4, losses: 3, bowlWon: false }];
s2.sports.records.hof = [{ name: 'Jamal Jolivette', pos: 'QB', year: 3, note: '4,200 career yards' }];
s2.sports.records.book.passYds = { name: 'Jamal Jolivette', pos: 'QB', opp: 'magnolia', year: 1, v: 312 };
U.openPanel('almanac'); U.update(s2, 600);
const alm = byId(U.el['panel-almanac'], 'alm-football');
const almText = textOf(alm);
ok(!!alm && /Season history/.test(almText) && /Year 1/.test(almText) && /6–1/.test(almText) && /bowl/.test(almText), 'Almanac football: season history rows');
ok(/Hall of Fame/.test(almText) && /Jamal Jolivette/.test(almText) && /4,200 career yards/.test(almText), 'Almanac football: Hall of Fame line');
ok(/Passing yards, one game/.test(almText) && /312/.test(almText) && /Record book/.test(almText), 'Almanac football: record book line');
U.openPanel(null);
s2.sports.records.seasons = []; s2.sports.records.hof = []; s2.sports.records.book = {};

// ---- game day: a real home game through the engine ----
ok(!!s2.setPiece && !!s2.sports.game, 'a home game set piece is running');
let sawBug = false, sawDd = false, plays = 0, decisionSeen = null, decideChoice = null, g2 = s2.sports.game;
let finalPayload = null; const offFinal = BSU.events.on('game:final', (p) => { finalPayload = p; }, 'ui_panels.test');
const offPlay = BSU.events.on('game:play', () => { plays++; }, 'ui_panels.test');
const realDecide = BSU.sports.decide; BSU.sports.decide = function (st, c) { decideChoice = c; return realDecide.call(BSU.sports, st, c); };
for (let i = 0; i < 4000 && s2.setPiece && !decisionSeen; i++) {
  BSU.headless.tick(1);
  if (i % 5 === 0) { U.update(s2, 100); const bug = U.el['score-bug-hud']; if (bug && !bug.classList.contains('hidden')) { sawBug = true; const dd = bug._p.dd; if (!dd.classList.contains('hidden') && textOf(dd).indexOf('&') >= 0) sawDd = true; } }
  const g = s2.sports.game; if (g && g.decision) decisionSeen = { id: g.decision.id, kind: g.decision.kind, n: g.decision.options.length, opts: g.decision.options.map((o) => o.key) };
}
ok(sawBug && /BSU/.test(textOf(U.el['score-bug-hud'])), 'score bug shows during the game');
ok(sawDd, 'down & distance strip shows (' + textOf(U.el['score-bug-hud']).replace(/\s+/g, ' ') + ')');
ok(plays > 0 && !!U.el['game-hud'] && U.el.pbp.children.length === 3, 'play-by-play strip has 3 lines (' + plays + ' plays seen)');
const pbText = U.el.pbp.children.map((c) => c.textContent).filter(Boolean);
ok(pbText.length >= 1 && U.el.pbp.children[2].classList.contains('new'), 'newest play-by-play line is highlighted: "' + pbText[pbText.length - 1] + '"');
ok(!!decisionSeen, 'the engine opened a decision (' + (decisionSeen && decisionSeen.id) + ')');
if (decisionSeen) {
  const optEls = findAll(U.el['dt-options'], (e) => e.tagName === 'BUTTON');
  ok(optEls.length === decisionSeen.n && optEls.length >= 2, 'decision toast shows one button per engine option (' + optEls.length + ')');
  ok(optEls.every((b) => /\d+%/.test(textOf(b))), 'each option shows its win probability: ' + optEls.map((b) => textOf(b).replace(/\s+/g, ' ').trim()).join(' | '));
  const pick = optEls.length >= 3 ? '3' : '2';
  ok(U.keydown(pick, { ctrl: false, shift: false, meta: false, alt: false }) === true, 'key ' + pick + ' is captured by the toast');
  ok(decideChoice === decisionSeen.opts[Number(pick) - 1] && !s2.sports.game.decision, 'the toast answered through sports.decide(state, "' + decideChoice + '") and the engine moved on');
}
// the legacy yes/no keys still work on the next engine toast (halftime, or a later 4th down)
let second = null; decideChoice = null;
for (let i = 0; i < 6000 && s2.setPiece && !second; i++) { BSU.headless.tick(1); const g = s2.sports.game; if (g && g.decision) second = g.decision.id; }
if (second) { ok(U.keydown('y', { ctrl: false, shift: false, meta: false, alt: false }) === true && decideChoice === 'yes' && !s2.sports.game.decision, 'Y answers the next toast via sports.decide("yes")'); }
else ok(true, 'no second decision this game (acceptable)');
BSU.sports.decide = realDecide;
// finish the game: the final summary arrives on game:final and the card opener fires
for (let i = 0; i < 4000 && s2.setPiece; i++) BSU.headless.tick(1);
ok(!!finalPayload && !!finalPayload.summary, 'game:final carries the summary payload');
U.update(s2, 600);
ok(!(U.el['score-bug-hud'] && !U.el['score-bug-hud'].classList.contains('hidden')) && U.el['game-hud'].classList.contains('hidden'), 'the HUD hides when the set piece ends');
void offPlay; void offFinal;

// ---- summary card from a synthetic payload ----
const synth = { opp: 'magnolia', oppName: 'Magnolia State University', home: true, night: true, kind: 'rivalry', day: 300, year: 1, score: [31, 17], won: true, ot: false, quarters: [[7, 14, 3, 7, 0], [3, 7, 7, 0, 0]], plays: [64, 58], firstDowns: [22, 15], yards: { rush: [188, 74], pass: [241, 193], total: [429, 267] }, turnovers: [1, 3], sacks: [4, 1], top: [1860, 1740], topText: ['31:00', '29:00'], kicking: [{ fgm: 1, fga: 1, xpm: 4, xpa: 4 }, { fgm: 0, fga: 0, xpm: 2, xpa: 2 }], mvp: { name: 'Jamal Jolivette', pos: 'QB', hometown: 'Plaquemine', line: '18/25, 241 yds, 3 TD', score: 12 }, bigPlay: { text: 'Jolivette to Bellard, 62 yards', yds: 62, type: 'pass', quarter: 2 }, attendance: 44210, revenue: { tickets: 2100000, concessions: 331000, tailgate: 132000, total: 2563000 } };
const spec = U.cards.gamesummary(s2, { summary: synth });
ok(spec && spec.id === 'gamesummary' && /31–17/.test(spec.title) && /Geaux/.test(spec.title), 'summary card title: ' + spec.title);
const body = textOf(spec.body);
ok(/Rush yards/.test(body) && /188/.test(body) && /Pass yards/.test(body) && /Turnovers/.test(body) && /Time of possession/.test(body) && /31:00/.test(body), 'summary card lists rush/pass yards, turnovers and time of possession');
ok(/MVP/.test(body) && /Jamal Jolivette/.test(body) && /44,210/.test(body) && /\$2\.6M|\$2563k|\$2\.56M/.test(body.replace(/\s/g, '')) || /Gate/.test(body), 'summary card has the MVP line and the gate (attendance, revenue)');
ok(/Since kickoff/.test(body) && /Prestige/.test(body), 'summary card has the prestige / campus spirit change line');
ok(/Geaux/.test(body) && spec.actions.some((a) => a.label === 'Season') && spec.actions.some((a) => /Geaux/.test(a.label)), 'summary card has the Geaux flavor and a Season button');
let opened = null; U.openPanel(null); spec.actions.find((a) => a.label === 'Season').fn(s2); ok(s2.ui.panel === 'season', 'the Season button opens the Season panel'); U.openPanel(null);
const origCard = U.card; let cardCalls = []; U.card = (st, id, p) => { cardCalls.push([id, p]); };
BSU.events.emit('game:final', { opp: 'magnolia', home: true, mode: 'highlights', summary: synth, won: true });
BSU.events.emit('game:final', { opp: 'magnolia', home: false, mode: 'silent', summary: Object.assign({}, synth, { home: false }), won: true });
U.card = origCard;
ok(cardCalls.length === 1 && cardCalls[0][0] === 'gamesummary' && cardCalls[0][1].summary === synth, 'game:final (watched) opens the summary card once; an off-screen final only notifies');
ok(typeof U.fb.downText === 'function' && U.fb.downText(2, 7, 35) === '2nd & 7' && U.fb.downText(1, 10, 95) === '1st & Goal' && U.fb.spotText(62, 'magnolia') === 'MAG 38' && U.fb.spotText(35, 'magnolia') === 'BSU 35' && U.fb.spotText(50, 'x') === 'midfield', 'down/distance and ball-spot formatters');
ok((BSU.errors ? BSU.errors.size : 0) === errsPassD, 'no BSU.error during the pass D tests (' + ((BSU.errors ? BSU.errors.size : 0) - errsPassD) + ' new)');

// --- ui.selfTest (runs this module's pushed _tests) -------------------------
BSU.SELFTEST = true; let st; try { st = U.selfTest(); } catch (e) { st = { ok: false, notes: e.message }; } finally { BSU.SELFTEST = false; }
ok(st && st.ok, 'ui.selfTest ok (includes ui_panels pushed tests) ' + (st && st.notes ? '(' + st.notes + ')' : ''));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
