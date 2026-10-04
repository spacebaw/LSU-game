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

// --- ui.selfTest (runs this module's pushed _tests) -------------------------
BSU.SELFTEST = true; let st; try { st = U.selfTest(); } catch (e) { st = { ok: false, notes: e.message }; } finally { BSU.SELFTEST = false; }
ok(st && st.ok, 'ui.selfTest ok (includes ui_panels pushed tests) ' + (st && st.notes ? '(' + st.notes + ')' : ''));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
