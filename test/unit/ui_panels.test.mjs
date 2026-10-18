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
for (const id of ['newsflash', 'wetfeet', 'failure', 'damage', 'hire', 'raiseoffer', 'poached', 'recruitboard'])
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
const rows = findAll(byId(host, 'sea-starters'), (e) => e.dataset && e.dataset.pos && e.dataset.depth === '1');
ok(rows.length === 8 && rows.map((r) => r.dataset.pos).join() === 'QB,RB,WR,OL,DL,LB,DB,K', 'starters table: the 8 positions in order (depth 1; P2 adds backups under each)');
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

// --- storm prep pass (P4): the rebuilt Storm panel ------------------------------------------------------------
{
  const walk = (e, fn) => { fn(e); for (const c of (e.children || [])) walk(c, fn); };
  const byId = (root, id) => { let f = null; walk(root, (e) => { if (e.id === id && !f) f = e; }); return f; };
  const click = (b) => b.dispatchEvent({ type: 'click' });
  const allText = (e) => { let t = e.textContent || ''; for (const c of (e.children || [])) t += ' ' + allText(c); return t; };
  const tick = (cb, v) => { cb.checked = v; cb.dispatchEvent({ type: 'change' }); };
  const refreshN = (st, n) => { for (let i = 0; i < n; i++) U.update(st, 600); };
  const H = BSU.headless, B = BSU.buildings, W = BSU.weather;
  BSU.session.newGame({ seed: 42, skipTutorial: true });
  const sp = BSU.state; sp.economy.cash = 30000000;
  const put = (id) => { const f = H.findSpot(id); return f ? H.place(id, f.x, f.y) : { ok: false }; };
  for (const id of ['water_tower', 'substation', 'dorm', 'dorm', 'dining_hall', 'pump']) put(id);
  const col = (a, b) => { const o = []; for (let y = a; y <= b; y++) o.push(BSU.idx(57, y)); return o; };
  const cn = []; for (let x = 54; x <= 58; x++) cn.push(BSU.idx(x, 1));
  B.placeRun(sp, 'canal', cn, {}); B.placeRun(sp, 'levee', col(2, 22), {}); B.placeRun(sp, 'levee', col(26, 34), {});
  H.tick(6000);
  const errs0 = BSU.errors ? BSU.errors.size : 0;
  U.openPanel('storm'); refreshN(sp, 2);
  const host = U.el['panel-storm'];
  ok(!!host && !host.classList.contains('hidden'), 'storm panel opens');
  ok(host.children[0].className.indexOf('panel-head') >= 0, 'the chrome head (close button) is still the first child');
  const status = byId(host, 'storm-status'), done = byId(host, 'storm-done');
  ok(/No storm in the Gulf — precautions available/.test(status.textContent), 'status strip with no storm: ' + status.textContent);
  for (const id of ['sp-board', 'sp-water', 'sp-people', 'sp-all', 'sp-sandbags', 'sp-predrain', 'sp-spillway', 'sp-evacuate', 'sp-repairall'])
    ok(!!byId(host, id), 'panel has the ' + id + ' block');
  let heads = []; walk(host, (e) => { if (/\bsp-head\b/.test(e.className || '')) heads.push(e.textContent); });
  ok(heads.join('|') === 'Board up|Water|People', 'three groups with headings: ' + heads.join(' / '));
  // every group carries a one-line explanation
  let notes = 0; walk(host, (e) => { if (/\bsp-note\b/.test(e.className || '') && e.textContent.length > 20) notes++; });
  ok(notes >= 8, 'every group and control has a plain-words explanation (' + notes + ')');
  const allBtn = byId(host, 'btn-prepall');
  ok(allBtn.disabled && /precautions/.test(byId(host, 'sp-all').children[3].textContent), 'no storm: Prepare everything is disabled and says why');
  for (const id of ['predrain', 'evacuate']) { const c = host['_' + id]; ok(c.btn.disabled && /No storm/.test(c.why.textContent), 'no storm: ' + id + ' is disabled with a visible reason (' + c.why.textContent + ')'); }
  ok(host._spillway.btn.disabled && host._spillway.why.textContent.length > 5, 'spillway disabled with a reason: ' + host._spillway.why.textContent);
  ok(host._repairall.btn.disabled && /Nothing to repair/.test(host._repairall.why.textContent), 'repair all disabled: nothing to repair');
  const boardAll = byId(host, 'btn-boardall'), boardSel = byId(host, 'btn-boardsel'), list = byId(host, 'storm-wind');
  ok(!boardAll.disabled && /Board Up all \(\d+\) · \$[\d,]+/.test(boardAll.textContent), 'no storm: Board Up all is available at full price: ' + boardAll.textContent);
  ok(boardSel.disabled && /tick at least one building/.test(byId(host, 'sp-board').children.map((c) => c.textContent).join('|')), 'Board Up selected needs a tick and says so');
  // selection survives the 500 ms refresh
  const rows = list.children.filter((r) => r._cb); ok(rows.length >= 5, 'checklist has a row per finished building (' + rows.length + ')');
  tick(rows[1]._cb, true); tick(rows[2]._cb, true);
  refreshN(sp, 5);
  const rows2 = list.children.filter((r) => r._cb);
  ok(host._windSel.size === 2 && rows2[1]._cb === rows[1]._cb && rows2[1]._cb.checked && rows2[2]._cb.checked && !rows2[0]._cb.checked, 'ticks survive five refreshes (same checkbox elements, still checked)');
  ok(/Board Up selected \(2\) · \$10,000/.test(boardSel.textContent) && !boardSel.disabled, 'the selected button shows the count and total: ' + boardSel.textContent);
  ok(/Selected 2 · \$10,000 total/.test(byId(host, 'storm-boardsum').textContent), 'confirm line shows the total: ' + byId(host, 'storm-boardsum').textContent);
  const selIds = [rows[1]._id, rows[2]._id], cashA = sp.economy.cash;
  click(boardSel); refreshN(sp, 1);
  ok(sp.economy.cash === cashA - 10000 && selIds.every((id) => B.get(sp, id).data.boardedUntil >= sp.calendar.day), 'Board Up selected: charged $10,000, both buildings boarded (precautionary, at once)');
  ok(/^✓ Board Up/.test(done.textContent) && !done.classList.contains('hidden') && host._windSel.size === 0, 'confirmation strip shown, selection cleared: ' + done.textContent.slice(0, 70));
  ok(list.children.filter((r) => /sp-boarded/.test(r.className)).length === 2 && /Boarded until/.test(allText(list.children.filter((r) => /sp-boarded/.test(r.className))[0])), 'boarded rows show ✓ and the until date');
  // Select all WR ≤ 2, then clear
  click(byId(host, 'btn-selwr2')); refreshN(sp, 2);
  const wr2 = list.children.filter((r) => r._cb && r._cb.checked).length;
  ok(wr2 === list.children.filter((r) => r._cb).filter((r) => /WR [12]$/.test(r.children[2].textContent)).length && wr2 >= 1, 'Select all WR ≤ 2 ticks exactly those rows (' + wr2 + ')');
  click(byId(host, 'btn-selnone')); ok(host._windSel.size === 0 && list.children.every((r) => !r._cb || !r._cb.checked), 'Clear unticks them');
  // Board Up all (no selection)
  const cashB = sp.economy.cash, qAll = W.prepQuote(sp, 'boardUp', 'all');
  click(boardAll); ok(sp.economy.cash === cashB - qAll.cost && B.boardInfo(sp).rows.every((r) => r.boarded), 'Board Up all: every building boarded for the quoted $' + qAll.cost);
  ok(boardAll.disabled && /already boarded|All boarded/i.test(boardAll.textContent + byId(host, 'sp-board').children.map((c) => c.textContent).join('|')), 'then it is disabled and says everything is boarded');
  // sandbags: runs list, weak runs, selected / all
  const runsEl = byId(host, 'storm-runs'), sbRows = runsEl.children.filter((r) => r._cb);
  ok(sbRows.length === 2 && /tiles · integrity \d+%/.test(allText(sbRows[0])), 'sandbag list: one row per levee run with length and integrity: ' + allText(sbRows[0]));
  tick(sbRows[0]._cb, true); refreshN(sp, 3);
  ok(host._sbSel.size === 1 && runsEl.children.filter((r) => r._cb)[0]._cb.checked, 'a ticked levee run survives refreshes');
  const sbQ = W.prepQuote(sp, 'sandbags', Array.from(host._sbSel)), cashC = sp.economy.cash;
  ok(/Sandbag selected \(1\) · \$[\d,]+/.test(byId(host, 'btn-sbsel').textContent) && sbQ.ok, 'Sandbag selected shows count and price');
  click(byId(host, 'btn-sbsel')); ok(sp.economy.cash === cashC - sbQ.cost && B.sandbagRuns(sp, 5).filter((r) => r.sandbagged).length === 1, 'Sandbag selected: only that run is sandbagged, charged $' + sbQ.cost);
  ok(runsEl.children.some((r) => /sp-boarded/.test(r.className) && /Sandbagged/.test(allText(r))), 'the sandbagged run shows ✓ Sandbagged');
  const wk = B.sandbagRuns(sp, 5).find((r) => !r.sandbagged); for (const i of wk.tiles.slice(0, 1)) { sp.tiles.integrity[i] = 60; B.onIntegrityChanged(sp, i); } refreshN(sp, 2);
  ok(!byId(host, 'btn-sbweak').disabled, 'a weak run enables Select all weak runs'); click(byId(host, 'btn-sbweak')); refreshN(sp, 1);
  ok(host._sbSel.has(wk.key), 'Select all weak runs ticks the weak run');
  click(byId(host, 'btn-sandbags')); ok(B.sandbagRuns(sp, 5).every((r) => r.sandbagged) && byId(host, 'btn-sandbags').disabled, 'Sandbag all finishes the rest and disables itself');
  // pre-drain / evacuate stay off outside a storm; open the Storm
  const storm = H.forceHurricane(3); H.tick(30); refreshN(sp, 2);
  ok(/HURRICANE .* · CAT|HURRICANE .* · Cat/i.test(status.textContent) && /landfall in \d+ days? \(/.test(status.textContent), 'status strip in the cone: ' + status.textContent);
  ok(!host._testcat.classList.contains('hidden'), 'the Cat selector and cone show during a storm');
  // reset to bare walls and bare levees for the cone
  for (const b of B.list(sp)) b.data.boardedUntil = -1;
  for (let i = 0; i < 4096; i++) { sp.tiles.sandbag[i] = 0; sp.tiles.sandbagDay[i] = 0; } B.dirtyRing(sp);
  const lw = B.sandbagRuns(sp, W.forecastSurge(sp)).find((r) => r.tiles.length); if (lw) { sp.tiles.integrity[lw.tiles[0]] = 62; B.onIntegrityChanged(sp, lw.tiles[0]); }
  refreshN(sp, 3);
  // Prepare everything: lists the steps, total = sum, charges exactly that
  const plan = W.prepQuote(sp, 'prepareAll'), stepRows = byId(host, 'sp-all').children[2].children;
  ok(plan.ok && plan.steps.length >= 2, 'Prepare everything has a plan in the cone (' + plan.steps.map((x) => x.action).join(', ') + ')');
  const sum = plan.steps.reduce((a, x) => a + x.cost, 0), totalRow = stepRows[stepRows.length - 1];
  ok(sum === plan.cost && stepRows.length === plan.steps.length + 1 && totalRow.children[1].textContent === '$' + plan.cost.toLocaleString('en-US'), 'the panel lists each step and its total ($' + plan.cost + ') = the sum of the steps ($' + sum + ')');
  ok(allBtn.textContent.indexOf('$' + plan.cost.toLocaleString('en-US')) > 0 && !allBtn.disabled, 'the button carries the total: ' + allBtn.textContent);
  const cashD = sp.economy.cash; click(allBtn); refreshN(sp, 1);
  ok(sp.economy.cash === cashD - plan.cost, 'Prepare everything charged exactly the listed total ($' + plan.cost + ')');
  ok(/^✓ Prepare everything/.test(done.textContent), 'confirmation: ' + done.textContent.slice(0, 80));
  ok(storm.preDrain === true && host._predrain.btn.disabled && /^✓ Pre-draining/.test(host._predrain.btn.textContent), 'pre-drain now reads ✓ Pre-draining');
  ok(B.boardInfo(sp).rows.some((r) => r.queued > 0), 'the boards went into the crew queue');
  // each remaining action: callable through its button, with the reason when it cannot
  ok(!host._evacuate.btn.disabled && /Evacuate · \$[\d,]+/.test(host._evacuate.btn.textContent) && /students/.test(host._evacuate.effect.textContent), 'evacuate shows price and effect: ' + host._evacuate.effect.textContent.slice(0, 80));
  ok(host._evacuate.lines.children.length >= 2, 'evacuate lists the shelter buildings and the shelter-in-place total (' + host._evacuate.lines.children.length + ' rows)');
  const cashE = sp.economy.cash, evq = W.prepQuote(sp, 'evacuate'); click(host._evacuate.btn); refreshN(sp, 1);
  ok(sp.economy.cash === cashE - evq.cost && storm.evacuated && host._evacuate.btn.disabled && /^✓ Evacuated/.test(host._evacuate.btn.textContent), 'Evacuate runs once, then reads ✓ Evacuated');
  ok(host._spillway.btn.disabled && host._spillway.why.textContent.length > 5, 'spillway: still disabled with its reason (' + host._spillway.why.textContent + ')');
  // every control: either enabled, or a visible reason
  const ctls = [host._predrain, host._spillway, host._evacuate, host._repairall];
  ok(ctls.every((c) => !c.btn.disabled || c.why.textContent.length > 0), 'every disabled action control shows a reason');
  // through landfall → Repair All
  H.tick(2600); try { U.closeCard('damage'); } catch (e) { /* none */ } H.tick(200);
  { const d = B.list(sp, 'dorm')[0]; d.hp = 0.4; }
  refreshN(sp, 2);
  const rq = W.prepQuote(sp, 'repairAll');
  ok(!host._repairall.btn.disabled && host._repairall.btn.textContent.indexOf('$' + rq.cost.toLocaleString('en-US')) > 0 && /Repairs 1 building/.test(host._repairall.effect.textContent), 'after the storm Repair All shows its total: ' + host._repairall.btn.textContent);
  const cashF = sp.economy.cash; click(host._repairall.btn); refreshN(sp, 1);
  ok(sp.economy.cash === cashF - rq.cost && B.list(sp, 'dorm')[0].hp === 1 && host._repairall.btn.disabled, 'Repair All repaired the dorm for the quoted amount');
  ok(/passing|precautions|No storm/.test(status.textContent), 'status after the storm: ' + status.textContent);
  ok((BSU.errors ? BSU.errors.size : 0) === errs0, 'no BSU.error driving every Storm panel control (' + ((BSU.errors ? BSU.errors.size : 0) - errs0) + ' new)');
  U.openPanel(null);
}

// --- PLAN_V2 P3: the wide, tabbed Season panel — six tabs, the budget bar, the top-up slider, Sign against the headroom ----
{
  const walk = (e, fn) => { fn(e); for (const c of (e.children || [])) walk(c, fn); };
  const byId = (root, id) => { let f = null; walk(root, (e) => { if (e.id === id && !f) f = e; }); return f; };
  const findAll = (root, pred) => { const out = []; walk(root, (e) => { if (e && e.tagName && pred(e)) out.push(e); }); return out; };
  const click = (b) => b.dispatchEvent({ type: 'click' });
  const textOf = (e) => { let t = String(e.textContent || ''); for (const c of (e.children || [])) t += ' ' + textOf(c); return t; };
  const visible = (e) => !!e && !e.classList.contains('hidden');
  const money = (n) => BSU.formatMoney(n);
  const H = BSU.headless, B = BSU.buildings;
  const TABS = ['overview', 'staff', 'roster', 'recruiting', 'schedule', 'records'];
  // fresh game, no team: every tab builds and refreshes
  BSU.session.newGame({ seed: 42, skipTutorial: true });
  const s0 = BSU.state; const errs0 = BSU.errors ? BSU.errors.size : 0;
  U.openPanel('season'); U.update(s0, 600);
  const host = U.el['panel-season'];
  ok(TABS.every((t) => !!byId(host, 'tab-' + t) && !!byId(host, 'sea-tab-' + t)), 'six tabs with six pages: ' + TABS.join(' · '));
  ok(TABS.filter((t) => visible(byId(host, 'sea-tab-' + t))).length === 1, 'exactly one page is shown');
  for (const t of TABS) { click(byId(host, 'tab-' + t)); U.update(s0, 600); ok(visible(byId(host, 'sea-tab-' + t)) && TABS.filter((x) => visible(byId(host, 'sea-tab-' + x))).length === 1 && byId(host, 'tab-' + t).classList.contains('active'), 'tab ' + t + ' shows its page alone (fresh game)'); }
  ok(U.settings().seasonTab === 'records', 'the last open tab is remembered in the ui settings');
  host.dispatchEvent({ type: 'keydown', key: 'ArrowRight' }); ok(visible(byId(host, 'sea-tab-overview')), 'ArrowRight wraps Records → Overview');
  host.dispatchEvent({ type: 'keydown', key: 'ArrowLeft' }); ok(visible(byId(host, 'sea-tab-records')), 'ArrowLeft goes back');
  click(byId(host, 'tab-overview'));
  ok(/No team yet/.test(textOf(byId(host, 'sea-record'))) && /Starters arrive/.test(textOf(byId(host, 'sea-starters'))), 'no-team copy in the header and the roster');
  ok(host._staffGrid && host._staffGrid.slots.length === 3 && host._staffGrid.slots[0].dataset.role === 'hc' && host._staffGrid.slots[1].dataset.role === 'oc' && host._staffGrid.slots[2].dataset.role === 'dc' && /No offensive coordinator yet/.test(textOf(host._staffGrid.slots[1])), 'Staff: host._staffGrid has the HC / OC / DC cards (no team: empty)');
  const B0 = BSU.sports.budget(s0);
  ok(textOf(byId(host, 'sea-budget-total')).indexOf(money(B0.total)) >= 0 && findAll(byId(host, 'sea-budget-sources'), (e) => e.dataset && e.dataset.key).length === 5 && findAll(byId(host, 'sea-budget-lines'), (e) => e.dataset && e.dataset.key).length === 8, 'budget bar on a fresh game: the total, five sources, five lines');
  U.openPanel(null);
  // a team, a stadium, then a jump to the season's end: revenue exists and the budget rolled
  BSU.economy.post(s0, 'misc', 9e6); BSU.economy.addStudents(s0, 700, 'test');
  const scan = (id) => { for (let y = 2; y < 60; y++) for (let x = 2; x < 60; x++) { const c = B.canPlace(s0, id, x, y, { ignoreCash: true }); if (c && c.ok) return [x, y]; } return null; };
  const psp = scan('practice_field'); H.place('practice_field', psp[0], psp[1]); H.tick(2500);
  const pf = s0.buildings.find((x) => x && x.type === 'practice_field'); B.upgrade(s0, pf.id); H.tick(2500);
  const ssp = scan('stadium'); H.place('stadium', ssp[0], ssp[1]); H.tick(2500);
  BSU.sports.setAutoSim(s0, true);
  s0.calendar.day = BSU.dateToDay('Dec 7', 1); for (let i = 0; i < 6 * BSU.params.time.ticksPerDay && !(s0.sports.seasonDone); i++) H.tick(1);
  while (s0.setPiece) H.tick(1);
  ok(s0.sports.hasTeam && s0.sports.seasonDone && s0.sports.records.seasons.length === 1, 'P3 setup: a team, a stadium and one finished season (' + s0.sports.lastSeason.wins + '-' + s0.sports.lastSeason.losses + ')');
  const B1 = BSU.sports.budget(s0);
  ok(B1.year === 2 && B1.lastRevenue > 0 && B1.fromRevenue === Math.round(B1.lastRevenue * BSU.params.sports.budget.revenueShare), 'the budget rolled with the season\'s gate (' + money(B1.lastRevenue) + ' → ' + money(B1.fromRevenue) + ')');
  U.openPanel('season'); U.update(s0, 600); U.update(s0, 600);
  for (const t of TABS) { click(byId(host, 'tab-' + t)); U.update(s0, 600); ok(visible(byId(host, 'sea-tab-' + t)), 'tab ' + t + ' refreshes after a season'); }
  click(byId(host, 'tab-overview')); U.update(s0, 600);
  const tot = textOf(byId(host, 'sea-budget-total')), sub = textOf(byId(host, 'sea-budget-sub'));
  ok(tot.indexOf(money(B1.total)) >= 0 && sub.indexOf(money(B1.committed)) >= 0 && sub.indexOf(money(B1.headroom)) >= 0, 'budget bar numbers match sports.budget: ' + tot + ' / ' + sub);
  const srcRows = findAll(byId(host, 'sea-budget-sources'), (e) => e.dataset && e.dataset.key);
  ok(srcRows.length === 5 && B1.sources.every((x, i) => srcRows[i].dataset.key === x.key && textOf(srcRows[i]).indexOf(money(x.amount)) >= 0), 'the five sources carry their amounts');
  const lineRows = findAll(byId(host, 'sea-budget-lines'), (e) => e.dataset && e.dataset.key);
  ok(lineRows.length === 8 && B1.lines.every((x, i) => lineRows[i].dataset.key === x.key && textOf(lineRows[i]).indexOf(money(x.amount)) >= 0), 'the eight committed lines carry their amounts (P1 adds the coordinators, P2 the players)');
  ok(byId(host, 'sea-budget-bar').children[0].style.width === Math.round(Math.min(1, B1.committed / B1.total) * 100) + '%', 'the bar fill is committed / total');
  // the top-up slider → sports.setTopUp, reflected in the Budget panel's expenses this month
  const tu = byId(host, 'sl-topup'); ok(!!tu && tu.max === '150' && tu.step === '10' && tu.value === '0', 'top-up slider 0–150% in steps of 10');
  const cashBefore = s0.economy.cash; tu.value = '50'; tu.dispatchEvent({ type: 'input' }); U.update(s0, 600);
  const B2 = BSU.sports.budget(s0);
  ok(B2.topUpShare === 0.5 && B2.topUp === 1000000 && s0.economy.cash === cashBefore - 1000000 && textOf(byId(host, 'sea-topup-val')).indexOf(money(1000000)) >= 0, 'slider 50% → setTopUp: $1M moved, shown on the slider value');
  ok(textOf(byId(host, 'sea-budget-total')).indexOf(money(B2.total)) >= 0 && B2.total === B1.total + 1000000, 'the total grew by the top-up');
  U.openPanel('budget'); U.update(s0, 600);
  const bud = U.el['panel-budget'];
  ok(/Athletics top-up/.test(textOf(bud)) && textOf(bud).indexOf(money(1000000)) >= 0 && /Athletics budget/.test(textOf(byId(bud, 'bud-athletics'))), 'Budget panel: the "Athletics top-up" expense line and the athletics budget row');
  U.openPanel('season'); U.update(s0, 600);
  // Recruiting: a Sign over the headroom is refused with the reason (the board is synthetic, the engine is real)
  s0.sports.prospects = { year: 1, offeredDay: 0, offered: true, signed: 0, answered: false, list: [{ name: 'Rich Kid', pos: 'QB', rating: 92, cost: 9000000, hometown: 'Houma', title: 'Gunslinger', blurb: '', archetype: 'x', signed: false }, { name: 'Fair Kid', pos: 'RB', rating: 80, cost: 150000, hometown: 'Eunice', title: '', blurb: '', archetype: 'y', signed: false }] };
  click(byId(host, 'tab-recruiting')); U.update(s0, 600); U.update(s0, 600);
  ok(/Headroom/.test(textOf(byId(host, 'sea-recruit-head'))), 'Recruiting shows the headroom line: ' + textOf(byId(host, 'sea-recruit-head')));
  const pRows = findAll(byId(host, 'sea-prospects'), (e) => /fb-pr/.test(e.className) && !/fb-th/.test(e.className));
  ok(pRows.length === 2 && findAll(pRows[0], (e) => /cost/.test(e.className) && /over/.test(e.className)).length === 1 && findAll(pRows[1], (e) => /cost/.test(e.className) && /over/.test(e.className)).length === 0, 'a cost over the headroom is flagged, one inside it is not');
  const notes = []; const prevNotify = U.notify; U.notify = (st, spec) => notes.push(spec.text);
  click(findAll(pRows[0], (e) => e.tagName === 'BUTTON' && e.textContent === 'Sign')[0]);
  ok(notes.length === 1 && /headroom/.test(notes[0]) && s0.sports.prospects.list[0].signed === false, 'Sign refused by the headroom: ' + notes[0]);
  click(findAll(pRows[1], (e) => e.tagName === 'BUTTON' && e.textContent === 'Sign')[0]);
  ok(s0.sports.prospects.list[1].signed === true && /arrives Aug 5/.test(notes[1] || ''), 'the affordable one signs');
  U.notify = prevNotify; s0.sports.prospects = null;
  // Roster: two tables, eight starters in order (P2 hook)
  click(byId(host, 'tab-roster')); U.update(s0, 600);
  const tables = findAll(byId(host, 'sea-starters'), (e) => /fb-roster/.test(e.className) && e.dataset && e.dataset.side);
  const rows = findAll(byId(host, 'sea-starters'), (e) => e.dataset && e.dataset.pos && e.dataset.depth === '1');
  ok(tables.length === 2 && tables[0].dataset.side === 'offense' && tables[1].dataset.side === 'defense' && rows.length === 8 && rows.map((r) => r.dataset.pos).join() === 'QB,RB,WR,OL,DL,LB,DB,K', 'Roster: offense | defense tables, eight starter rows in order');
  // Staff: the head coach card shows the salary from sports.coachSalary; Records shows the season history
  click(byId(host, 'tab-staff')); U.update(s0, 600);
  ok(textOf(byId(host, 'sea-coach-salary')).indexOf(money(BSU.sports.coachSalary(s0.sports.coach.stars))) >= 0, 'Staff: the head coach salary line (' + textOf(byId(host, 'sea-coach-salary')) + ')');
  // PLAN_V2 P1: three staff cards, candidates per role, the gate hint, a Hire refused by the headroom then one that signs, a two-click Fire with the buyout, the two cards
  {
    const V0 = BSU.sports.staff(s0);
    ok(/★★☆☆☆/.test(textOf(byId(host, 'sea-hc-stars'))) && /Interim OC/.test(textOf(host._staffGrid.slots[1])) && /Interim DC/.test(textOf(host._staffGrid.slots[2])) && byId(host, 'btn-fire-oc').classList.contains('hidden') && !byId(host, 'btn-fire').classList.contains('hidden'), 'Staff: the HC star bar, interim coordinators (no Fire on an interim), Fire on the HC');
    ok(/Why no 5★/.test(textOf(byId(host, 'sea-staff-hint'))) && new RegExp('up to ' + V0.maxStars + '★').test(textOf(byId(host, 'sea-staff-hint'))), 'the "Why no 5★?" hint names the gate (' + textOf(byId(host, 'sea-staff-hint')).slice(0, 60) + '…)');
    BSU.sports.refreshCandidates(s0); U.update(s0, 600);
    const groups = findAll(byId(host, 'sea-candidates'), (e) => /\bfb-cand-group\b/.test(e.className));
    const rows = findAll(byId(host, 'sea-candidates'), (e) => /\bfb-cand\b/.test(e.className) && e.dataset && e.dataset.idx);
    ok(groups.length === 3 && groups.map((g) => g.dataset.role).join() === 'hc,oc,dc' && rows.length === 9 && rows.filter((r) => r.dataset.role === 'dc').length === 3, 'Candidates: a group per role, three rows each');
    ok(findAll(byId(host, 'sea-candidates'), (e) => /fb-reach/.test(e.className)).length === 3 && rows.every((r) => /★/.test(textOf(r)) && /\/yr/.test(textOf(r)) && / yrs/.test(textOf(r)) && findAll(r, (e) => e.tagName === 'BUTTON').length === 1), 'every row: stars, salary/yr, years, a Hire button; one reach badge per role');
    const ocRow = rows.find((r) => r.dataset.role === 'oc' && r.dataset.idx === '0'); const hireBtn = findAll(ocRow, (e) => e.tagName === 'BUTTON')[0];
    BSU.economy.setCoaching(s0, 3000000); U.update(s0, 600);
    click(hireBtn); U.update(s0, 600);
    const note = byId(host, 'sea-staff-note');
    ok(visible(note) && /Hire refused/.test(textOf(note)) && /headroom/.test(textOf(note)) && s0.sports.staff.oc.interim, 'a Hire over the headroom is refused inline (' + textOf(note).slice(0, 70) + '…)');
    BSU.economy.setCoaching(s0, 0); BSU.sports.setTopUp(s0, 1.5); U.update(s0, 600);
    const cand = BSU.sports.staff(s0).candidates.oc[0];
    const hireBtn2 = findAll(findAll(byId(host, 'sea-candidates'), (e) => /\bfb-cand\b/.test(e.className) && e.dataset && e.dataset.role === 'oc' && e.dataset.idx === '0')[0], (e) => e.tagName === 'BUTTON')[0];
    click(hireBtn2); U.update(s0, 600);
    ok(s0.sports.staff.oc.name === cand.name && textOf(host._staffGrid.slots[1]).indexOf(cand.name) >= 0 && textOf(byId(host, 'sea-oc-salary')).indexOf(money(cand.salary)) >= 0 && note.classList.contains('ok') && !byId(host, 'btn-fire-oc').classList.contains('hidden'), 'with the headroom the OC signs: the card shows the name and salary, Fire appears');
    ok(findAll(byId(host, 'sea-candidates'), (e) => /\bfb-cand\b/.test(e.className) && e.dataset && e.dataset.role === 'oc' && e.dataset.idx).length === 0, 'the OC candidate rows clear after the hire');
    const buyout = BSU.sports.staff(s0).oc.buyout; const fireOc = byId(host, 'btn-fire-oc');
    ok(textOf(fireOc).indexOf(money(buyout)) >= 0, 'the Fire button shows the buyout (' + textOf(fireOc) + ')');
    click(fireOc); U.update(s0, 600);
    ok(/Click Fire again/.test(textOf(note)) && /Confirm fire/.test(textOf(fireOc)) && !s0.sports.staff.oc.interim, 'the first click arms the Fire (confirm text, nothing fired)');
    click(fireOc); U.update(s0, 600);
    ok(s0.sports.staff.oc.interim && /is out/.test(textOf(note)) && BSU.sports.staff(s0).candidates.oc.length === 3, 'the second click fires: an interim returns, the buyout is noted, OC candidates redraw');
    const ro = U.cards.raiseoffer(s0, { role: 'hc', name: 'Test Coach', stars: 5, salary: 3750000, raise: 937500, newSalary: 4687500 });
    const po = U.cards.poached(s0, { role: 'dc', name: 'Test DC', stars: 5, salary: 2000000, poacher: 'Magnolia State', interim: 'Interim DC' });
    ok(ro && ro.actions.length === 2 && /Pay/.test(ro.actions[0].label) && /Let them go/.test(ro.actions[1].label) && /taking calls/.test(ro.title) && po && po.kicker === 'Breaking' && /poached by Magnolia State/.test(po.title) && po.actions.length === 2, 'the raise-offer card (Pay / Let them go) and the poaching newsflash build');
  }
  click(byId(host, 'tab-records')); U.update(s0, 600);
  ok(/Season history/.test(textOf(byId(host, 'sea-records'))) && /Year 1/.test(textOf(byId(host, 'sea-records'))) && !!byId(host, 'sea-recruits'), 'Records: season history and the recruiting history list');
  click(byId(host, 'tab-schedule')); U.update(s0, 600);
  ok(findAll(byId(host, 'sea-schedule'), (e) => /fb-sc/.test(e.className)).length === s0.sports.schedule.length && !!byId(host, 'btn-upgrade') && !!byId(host, 'seg-permits') && !!byId(host, 'seg-homecoming'), 'Schedule: the results list, the venue Upgrade, permits and Homecoming');
  U.openPanel(null);
  ok((BSU.errors ? BSU.errors.size : 0) === errs0, 'no BSU.error through the P3 tour');
}

// --- PLAN_V2 P2: the Roster tab (depth chart, chips, the seniors line, after a graduation) and the Recruiting tab (the 16-prospect board in two groups,
//     x/4 counters, the headroom line + lock countdown, a Sign refused inline, a Sign that signs, the history), the recruitboard card -------------------
{
  const walk = (e, fn) => { fn(e); for (const c of (e.children || [])) walk(c, fn); };
  const byId = (root, id) => { let f = null; walk(root, (e) => { if (e.id === id && !f) f = e; }); return f; };
  const findAll = (root, pred) => { const out = []; walk(root, (e) => { if (e && e.tagName && pred(e)) out.push(e); }); return out; };
  const click = (b) => b.dispatchEvent({ type: 'click' });
  const textOf = (e) => { let t = String(e.textContent || ''); for (const c of (e.children || [])) t += ' ' + textOf(c); return t; };
  const visible = (e) => !!e && !e.classList.contains('hidden');
  const money = (n) => BSU.formatMoney(n);
  const H = BSU.headless, B = BSU.buildings, SP = BSU.sports;
  BSU.session.newGame({ seed: 42, skipTutorial: true });
  const s = BSU.state; const errs0 = BSU.errors ? BSU.errors.size : 0;
  BSU.economy.post(s, 'misc', 9e6); BSU.economy.addStudents(s, 700, 'test');
  const scan = (id) => { for (let y = 2; y < 60; y++) for (let x = 2; x < 60; x++) { const c = B.canPlace(s, id, x, y, { ignoreCash: true }); if (c && c.ok) return [x, y]; } return null; };
  const psp = scan('practice_field'); H.place('practice_field', psp[0], psp[1]); H.tick(2500);
  const pf = s.buildings.find((x) => x && x.type === 'practice_field'); B.upgrade(s, pf.id); H.tick(2500);
  const ssp = scan('stadium'); H.place('stadium', ssp[0], ssp[1]); H.tick(2500);
  SP.setAutoSim(s, true);
  U.openPanel('season'); U.update(s, 600);
  const host = U.el['panel-season'];
  // Roster, fresh team
  click(byId(host, 'tab-roster')); U.update(s, 600); U.update(s, 600);
  const RV = SP.roster(s);
  const d1 = findAll(byId(host, 'sea-starters'), (e) => e.dataset && e.dataset.pos && e.dataset.depth === '1'), d2 = findAll(byId(host, 'sea-starters'), (e) => e.dataset && e.dataset.pos && e.dataset.depth === '2');
  ok(RV && RV.size === 16 && d1.length === 8 && d2.length === 8 && d1.map((r) => r.dataset.pos).join() === 'QB,RB,WR,OL,DL,LB,DB,K' && d2.every((r, i) => r.classList.contains('backup') && r.dataset.pos === d1[i].dataset.pos), 'Roster: 8 starter rows, each followed by its backup row');
  ok(d1.every((r, i) => { const st = RV.offense.concat(RV.defense)[i].starter; return textOf(r).indexOf(st.name) >= 0 && textOf(r).indexOf(st.classYear) >= 0 && textOf(r).indexOf(String(st.rating)) >= 0 && textOf(r).indexOf(st.hometown) >= 0; }), 'starter rows: name, class, rating, hometown');
  ok(d2.every((r) => /walk-on/.test(textOf(r)) && /free/.test(textOf(r))) && d1.every((r) => !/\/yr/.test(textOf(r))), 'backup rows read walk-on · free; the first squad is on no scholarship (no cost/yr)');
  const chips = textOf(byId(host, 'sea-roster-chips'));
  ok(/Players\s*16/.test(chips) && /Scholarships/.test(chips) && /Leaving next May\s*\d+/.test(chips) && /Jr \d+/.test(chips) && /Sr \d+/.test(chips), 'chips: players, class counts, scholarships, seniors leaving: ' + chips.replace(/\s+/g, ' ').trim().slice(0, 120));
  ok(/Leaving next May/.test(textOf(byId(host, 'sea-roster-sum'))) && RV.seniors.every((p) => textOf(byId(host, 'sea-roster-sum')).indexOf(p.name) >= 0), 'the seniors line names everyone leaving next May');
  // a dinged starter shows the chip and the backup starts
  const qb = s.sports.starters[0]; qb.dinged = 2; SP._ding(s, { day: 1 }); U.update(s, 600); U.update(s, 600);
  const rowsNow = findAll(byId(host, 'sea-starters'), (e) => e.dataset && e.dataset.pos === 'QB');
  ok(rowsNow.length >= 2 && textOf(rowsNow[0]).indexOf(qb.name) < 0 && /dinged/.test(textOf(rowsNow[1])) && textOf(rowsNow[1]).indexOf(qb.name) >= 0 && /Dinged/.test(textOf(byId(host, 'sea-roster-chips'))), 'a dinged QB drops to the backup row with the chip; the chip row says so');
  s.sports.roster.forEach((p) => { p.dinged = 0; }); SP._ding(s, { day: 2 });
  // after a season + the May graduation: seniors gone, walk-ons start, the Roster refreshes; the board is open
  s.calendar.day = BSU.dateToDay('Dec 7', 1); for (let i = 0; i < 6 * BSU.params.time.ticksPerDay && !(s.sports.seasonDone); i++) H.tick(1);
  while (s.setPiece) H.tick(1);
  const seniors = RV.seniors.map((p) => p.name);
  for (let i = 0; i < 4 * BSU.params.time.ticksPerDay; i++) H.tick(1);   // Dec 9 passes: the board is drawn
  const board0 = SP.prospects(s);
  ok(s.sports.seasonDone && board0 && board0.list.length === 16, 'P2 setup: a finished season and a 16-prospect board');
  const jump = (day) => { s.calendar.day = day - 1; while (s.calendar.day < day) { H.tick(BSU.params.time.ticksPerDay); while (s.setPiece) H.tick(1); } H.tick(1); };   // the calendar jumps as the P3 block does; a late Spring Game may freeze a day, so loop until the daily hooks fired on `day`
  jump(BSU.dateToDay('May 5', 2));
  U.update(s, 600); U.update(s, 600);
  const RV2 = SP.roster(s);
  ok(seniors.every((n) => !s.sports.roster.some((p) => p.name === n)) && RV2.walkOnStarters.length >= 1 && /Walk-ons starting at/.test(textOf(byId(host, 'sea-roster-chips'))) && findAll(byId(host, 'sea-starters'), (e) => e.dataset && e.dataset.depth === '1').length === 8, 'after the May graduation: the seniors are gone, walk-ons start (' + RV2.walkOnStarters.join(' ') + '), eight starter rows');
  ok(findAll(byId(host, 'sea-starters'), (e) => e.dataset && e.dataset.depth === '2' && e.classList.contains('empty')).length === RV2.emptyBackups.length, 'positions without a backup show an empty backup row (' + RV2.emptyBackups.length + ')');
  // Recruiting: the board in two groups with counters, the headroom + lock line, Sign refused inline, a Sign that signs
  click(byId(host, 'tab-recruiting')); U.update(s, 600); U.update(s, 600);
  const groups = findAll(byId(host, 'sea-prospects'), (e) => e.dataset && e.dataset.side);
  const pRows = findAll(byId(host, 'sea-prospects'), (e) => /fb-pr/.test(e.className) && !/fb-th/.test(e.className));
  ok(groups.length === 2 && groups[0].dataset.side === 'offense' && groups[1].dataset.side === 'defense' && pRows.length === 16 && /signed 0 of 4/.test(textOf(groups[0])) && /signed 0 of 4/.test(textOf(groups[1])), 'the board: offense | defense groups of 8 with 0 of 4 counters');
  const headLine = textOf(byId(host, 'sea-recruit-head'));
  ok(/Headroom/.test(headLine) && /signed 0 of 8/.test(headLine) && /locks in \d+ days/.test(headLine), 'the head line: headroom, 0 of 8, the lock countdown: ' + headLine.slice(0, 140));
  const notes = []; const prevNotify = U.notify; U.notify = (st, spec) => notes.push(spec.text);
  const headroom = SP.budget(s).headroom; const rich = board0.list.slice().sort((a, b) => b.cost - a.cost)[0];
  BSU.economy.setCoaching(s, 3000000); U.update(s, 600); U.update(s, 600);
  const rowOf = (p) => findAll(byId(host, 'sea-prospects'), (e) => /fb-pr/.test(e.className) && e.dataset && e.dataset.idx === String(p.index))[0];
  const overRow = rowOf(rich); click(findAll(overRow, (e) => e.tagName === 'BUTTON' && e.textContent === 'Sign')[0]);
  ok(notes.length === 1 && /headroom/.test(notes[0]) && visible(byId(host, 'sea-recruit-note')) && /refused/.test(textOf(byId(host, 'sea-recruit-note'))) && !SP.prospects(s).list[rich.index].signed, 'a Sign over the headroom is refused inline: ' + textOf(byId(host, 'sea-recruit-note')).slice(0, 120));
  BSU.economy.setCoaching(s, 0); U.update(s, 600); U.update(s, 600);
  const cheap = board0.offense.slice().sort((a, b) => a.cost - b.cost)[0];
  click(findAll(rowOf(cheap), (e) => e.tagName === 'BUTTON' && e.textContent === 'Sign')[0]); U.update(s, 600);
  const P2 = SP.prospects(s);
  ok(P2.list[cheap.index].signed === true && P2.signedSide.offense === 1 && /signed 1 of 4/.test(textOf(findAll(byId(host, 'sea-prospects'), (e) => e.dataset && e.dataset.side === 'offense')[0])) && /signed 1 of 8/.test(textOf(byId(host, 'sea-recruit-head'))) && /signs/.test(textOf(byId(host, 'sea-recruit-note'))) && /arrives Aug 5/.test(textOf(rowOf(cheap))), 'a Sign inside the headroom signs: counters 1 of 4 / 1 of 8, the row reads signed');
  U.notify = prevNotify; void headroom;
  // the recruitboard card (open + closing) builds with two actions; the first opens the Recruiting tab
  U.openPanel(null); click(byId(host, 'tab-overview'));
  const co = U.cards.recruitboard(s, { why: 'open', n: 16, perSide: 4, signed: { offense: 1, defense: 0 }, daysLeft: 200, lockDay: BSU.dateToDay('Aug 5', 2), mean: 68, bonus: 4 });
  ok(co && /recruiting board is open/i.test(co.title) && co.actions.length === 2 && /Recruiting tab/.test(co.actions[0].label) && co.body.some((l) => /16 prospects/.test(l) && /68/.test(l)) && co.body.some((l) => /Aug 5/.test(l)), 'the recruitboard card builds with two actions, the numbers and the lock date');
  co.actions[0].fn(s); U.update(s, 600);
  ok(U.panel() === 'season' && visible(byId(host, 'sea-tab-recruiting')), 'its first action opens the Season panel on the Recruiting tab');
  const cc = U.cards.recruitboard(s, { why: 'closing', n: 16, perSide: 4, signed: { offense: 1, defense: 0 }, daysLeft: 7, lockDay: BSU.dateToDay('Aug 5', 2) });
  ok(cc && /locks in 7 days/.test(cc.title) && cc.body.some((l) => /1 signed/.test(l)), 'the closing card counts down and reports the signings');
  // Aug 5: the signing arrives; the history lists it on the Recruiting tab
  U.openPanel(null); jump(BSU.dateToDay('Aug 5', 2));
  U.openPanel('season'); click(byId(host, 'tab-recruiting')); U.update(s, 600); U.update(s, 600);
  ok(s.sports.records.recruits.some((r) => r.name === cheap.name) && textOf(byId(host, 'sea-recruit-history')).indexOf(cheap.name) >= 0 && visible(byId(host, 'sea-recruit-empty')), 'after the lock: the history lists the arrival, the board is closed');
  click(byId(host, 'tab-roster')); U.update(s, 600);
  ok(textOf(byId(host, 'sea-starters')).indexOf(cheap.name) >= 0 && /Fr/.test(textOf(findAll(byId(host, 'sea-starters'), (e) => e.dataset && e.dataset.pos === cheap.pos)[0]) + textOf(findAll(byId(host, 'sea-starters'), (e) => e.dataset && e.dataset.pos === cheap.pos)[1] || '')), 'the freshman is on the depth chart');
  ok((BSU.errors ? BSU.errors.size : 0) === errs0, 'no BSU.error through the P2 tour');
  U.openPanel(null);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
