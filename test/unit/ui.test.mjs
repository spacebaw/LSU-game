// Unit test for src/js/ui.js: loads every existing manifest module (in order) through makeWindow()
// from test/domstub.mjs with vm.runInContext (session.js boots the game at the end of its file), then
// checks the DOM skeleton ids through BSU.ui.el, keydown precedence, the uiQueue drain, palette state,
// the ghost spec from buildings.canPlace, the machine on synthetic pointer events, and selfTest.
// Usage: node test/unit/ui.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

// --- source rules -----------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'ui.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
ok(!/innerHTML/.test(src), 'no innerHTML (every node is created and kept in M.el)');
ok(!/querySelector|closest\(|matches\(|instanceof\s+(Node|HTMLInputElement|HTMLCanvasElement|Text)/.test(src), 'no querySelector/closest/matches/instanceof Node');
ok(!/setTimeout|setInterval/.test(src.replace(/\/\/.*$/gm, '')), 'no timers for game logic');
const css = readFileSync(join(root, 'src', 'style.css'), 'utf8');
ok(Buffer.byteLength(css) <= 25 * 1024, `style.css ≤ 25 KB (${(Buffer.byteLength(css) / 1024).toFixed(1)} KB)`);
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/@import|url\(/.test(cssNoComments) && /--purple:\s*#461D7C/.test(css) && /--gold:\s*#FDD023/.test(css), 'css tokens present, no @import/url()');

// --- load every existing module in manifest order ----------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
let loadMs = 0;
for (const f of manifest) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  const t0 = performance.now();
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); }
  if (f === 'ui.js') loadMs = performance.now() - t0;
}
ok(loadMs < 30, `ui.js definition time ${loadMs.toFixed(1)} ms < 30 ms`);
const BSU = win.BSU; const U = BSU.ui;
for (const fn of ['init', 'reset', 'update', 'notify', 'ticker', 'openPanel', 'panel', 'inspect', 'closeInspect', 'card', 'decision', 'answerDecision', 'closeCard', 'selectTool', 'tool', 'setOverlay', 'setSpeed', 'showTitle', 'hint', 'pointer', 'keydown', 'wheel', 'breakdown', 'refreshPalette', 'settings', 'saveSettings', 'registerPanel', 'registerCard', 'alert', 'introduceTab', 'lockTool', 'selfTest', '_machine'])
  ok(typeof U[fn] === 'function', 'public function ' + fn);
ok(!('tick' in U), 'no tick on a presentation module');
ok(U.el && typeof U.el === 'object' && U.debug && typeof U.debug.open === 'boolean' && typeof U.state === 'string' && Array.isArray(U._tests) && U.cards && U.fmt && typeof U.fmt.money === 'function', 'hook surface: el, debug, state, _tests, cards, fmt');

// --- init happened at boot (session.boot → ui.init) ------------------------------
const app = win.document.getElementById('app');
const hud = app.children.find((c) => c.id === 'hud');
ok(!!hud && U.el.hud === hud, 'init built #hud under #app and kept it in M.el');
const ids = ['topbar', 'brand', 'stat-cash', 'stat-students', 'chip-capacity', 'stat-prestige', 'stat-happiness', 'stat-ecology', 'stat-date', 'sky-glyph', 'chip-weather', 'speed', 'btn-budget', 'btn-season', 'btn-storm', 'btn-almanac', 'btn-menu', 'btn-mute', 'chip-endowed', 'alert-strip', 'minimap-wrap', 'minimap', 'minimap-viewport', 'overlay-buttons', 'legend', 'objective-card', 'obj-portrait', 'obj-title', 'obj-text', 'obj-progress', 'obj-count', 'btn-showme', 'btn-obj-dismiss', 'obj-background', 'speech-bubble', 'voice-card', 'milestones-card', 'notifications', 'decision-toast', 'dt-text', 'dt-countdown', 'btn-dt-yes', 'btn-dt-no', 'inspect', 'insp-title', 'insp-sub', 'btn-insp-close', 'insp-sprite', 'insp-body', 'insp-actions', 'ghost-label', 'tooltip', 'popover', 'pop-title', 'pop-next', 'ticker', 'ticker-track', 'btn-ticker-log', 'ticker-log', 'palette', 'palette-tabs', 'palette-items', 'btn-bulldoze', 'btn-palette-info', 'cards', 'perf-chip', 'perfmode-chip', 'hint', 'panels', 'title', 'title-name', 'btn-charter', 'btn-continue', 'title-seed', 'btn-title-settings', 'btn-title-mute'];
let missing = ids.filter((id) => !U.el[id] || U.el[id].id !== id);
ok(missing.length === 0, 'every §7.1 id resolves through M.el' + (missing.length ? ' (missing: ' + missing.join(',') + ')' : ''));
ok(win.document.getElementById('hud') === hud && win.document.getElementById('btn-charter') === U.el['btn-charter'], 'ids are also assigned on the elements (stub byId)');
ok(U.el.minimap.width === 160 && U.el.minimap.height === 160 && U.el['obj-portrait'].width === 48, 'minimap 160×160, portrait 48×48');
ok(U.el['title-name'].textContent === 'BAYOU STATE', '#title-name text');
ok(U.el.title.classList.contains('hidden') === !!BSU.headlessMode, 'title hidden headless (session shows it only in a browser)');

// --- new game, update, palette ----------------------------------------------------
const errors0 = BSU.errors.size;
BSU.session.newGame({ seed: 11, skipTutorial: true });
const s = BSU.state;
U.showTitle(false);
BSU.headless.tick(20); BSU.headless.render();
ok(U.el.title.classList.contains('hidden') && !U.el.hud.classList.contains('hidden'), 'showTitle(false) hides the title and shows the HUD');
ok(U.state === 'IDLE' && s.ui.tool === null, 'reset: IDLE, no tool');
ok(Object.keys(U.el.tabEls).length >= 2 && Object.keys(U.el.itemEls).length >= 3, `palette built: ${Object.keys(U.el.tabEls).length} tabs, ${Object.keys(U.el.itemEls).length} items`);
ok(!('founders_hall' in U.el.itemEls), "founders_hall never appears in the palette");
ok(U.el['stat-cash-value'].textContent === BSU.formatMoney(s.economy.cash) || /^\$/.test(U.el['stat-cash-value'].textContent), 'cash odometer renders money: ' + U.el['stat-cash-value'].textContent);
ok(/Y1/.test(U.el['stat-date-text'].textContent), 'date text: ' + U.el['stat-date-text'].textContent);
ok(U.el['sky-glyph'].textContent.length > 0, 'sky glyph set');
const M0 = { ctrl: false, shift: false, meta: false, alt: false };

// palette state: a hidden tab stays hidden even when introduced if nothing is unlocked
const s2 = BSU.newState(5); s2.ui.tabsIntroduced = { essentials: true, sports: true };
const savedUnlocked = BSU.buildings.unlocked;
BSU.buildings.unlocked = function (st, id) { return { ok: id === 'path' || id === 'dorm', reason: id === 'stadium' ? 'Needs 500 students' : '' }; };
U.reset(s2, true); U.update(s2, 16);
ok(Object.keys(U.el.tabEls).join(',') === 'essentials', 'tab with zero unlocked rows hidden; essentials shown: ' + Object.keys(U.el.tabEls).join(','));
ok(U.el.itemEls.dining_hall && U.el.itemEls.dining_hall.classList.contains('locked'), 'locked items are visible and greyed');
U.introduceTab(s2, 'sports'); U.update(s2, 16);
ok(!U.el.tabEls.sports, 'introduced sports tab still hidden with zero unlocked rows');
BSU.buildings.unlocked = savedUnlocked;
U.reset(s, false); U.update(s, 16);

// --- keydown precedence ------------------------------------------------------------
const rec = []; const liveEmit = U._deps.emit; U._deps.emit = (n, p) => rec.push({ n, p });
ok(U.keydown('b', M0) === true, 'b handled (budget panel or soft notify)');
U.keydown('Escape', M0);
U.decision(s, { id: 'k1', text: 'q', ticks: 50 });
ok(U.keydown('n', M0) === true && rec.some((e) => e.n === 'decision:closed' && e.p.id === 'k1' && e.p.answer === 'no'), 'open toast captures n → decision:closed{no}');
U.card(s, { id: 'c1', title: 't', body: 'b', actions: [{ label: 'ok', primary: true }] });
ok(!U.el.cards.classList.contains('hidden') && U.el.cards.children.length === 1 && U.el.cards.children[0].id === 'card-c1', 'spec card opens as .card#card-c1');
ok(U.keydown('Enter', M0) === true && U.el.cards.classList.contains('hidden'), 'Enter fires the primary action and closes the card');
ok(U.keydown('`', M0) === true && U.debug.open === true && s.ui.panel === 'debug', 'backquote opens the debug panel');
ok(U.keydown('Dead', { ...M0, code: 'Backquote' }) === true && U.debug.open === false && s.ui.panel === null, 'Dead+Backquote closes it');
ok(U.keydown('f', M0) === true && s.ui.overlay === BSU.OV.FLOOD, 'f → flood overlay');
ok(U.keydown('f', M0) === true && s.ui.overlay === BSU.OV.NONE, 'f again → overlay off');
const sp0 = s.ui.speed; ok(U.keydown(' ', M0) === true && s.ui.speed === 0, 'Space pauses'); ok(U.keydown(' ', M0) === true && s.ui.speed === (sp0 || 1), 'Space resumes the last speed');
ok(U.keydown('3', M0) === true && s.ui.speed === 4, '3 → 4×'); U.keydown('1', M0);
ok(U.keydown('q', M0) === false, 'q is unbound');
ok(U.keydown('x', M0) === true && s.ui.tool && s.ui.tool.id === 'bulldoze' && U.state === 'PLACING', 'x → bulldoze PLACING');
ok(U.keydown('Escape', M0) === true && s.ui.tool === null && U.state === 'IDLE', 'Escape cancels the tool');
U._deps.emit = liveEmit;

// --- uiQueue drain --------------------------------------------------------------
s.progress.uiQueue.push({ kind: 'notify', tick: s.tick, day: s.calendar.day, args: [{ kind: 'info', text: 'queued hello' }] });
s.progress.uiQueue.push({ kind: 'introduceTab', tick: s.tick, day: s.calendar.day, args: ['grounds'] });
s.progress.uiQueue.push({ kind: 'hint', tick: s.tick, day: s.calendar.day, args: ['unitTestHint', 'a hint'] });
U.update(s, 16);
ok(s.progress.uiQueue.length === 0, 'uiQueue drained');
ok(U.el.notifications.children.some((c) => c.children.some((x) => x.textContent === 'queued hello')), 'queued notify shown');
ok(s.ui.tabsIntroduced.grounds === true, 'queued introduceTab applied');
ok(s.progress.hints.unitTestHint === true && !U.el.hint.classList.contains('hidden') && U.el['hint-text'].textContent === 'a hint', 'queued hint shown once and marked');
U.hint(s, 'unitTestHint', 'again'); ok(U.el['hint-text'].textContent === 'a hint', 'a seen hint does not show again');

// --- ghost spec from canPlace -----------------------------------------------------------
U.selectTool(s, 'dorm');
ok(U.state === 'PLACING' && s.ui.tool.id === 'dorm' && U.el.itemEls.dorm && U.el.itemEls.dorm.classList.contains('active'), 'selectTool(dorm): PLACING + active item');
U.pointer('move', 640, 360, 0, M0);
const g = BSU.render.ghostSpec;
ok(g && Array.isArray(g.tiles) && g.tiles.length >= 1 && ['green', 'yellow', 'red'].indexOf(g.color) >= 0 && g.sprite && g.sprite.id === 'dorm', 'ghost spec from canPlace: ' + (g && g.color) + ' ' + (g && g.tiles.length) + ' tiles');
ok(!U.el['ghost-label'].classList.contains('hidden') && U.el['ghost-l1'].textContent.length > 0, 'ghost label shown: ' + U.el['ghost-l1'].textContent);
U.keydown('r', M0); ok(s.ui.tool.rot === 1, 'r rotates the dorm');
const spot = BSU.headless.findSpot('dorm');
if (spot) {
  const px = BSU.render.tileToScreen(spot.x, spot.y);
  const n0 = s.buildings.filter(Boolean).length;
  U.keydown('r', M0); U.pointer('move', px.x, px.y, 0, M0); U.pointer('down', px.x, px.y, 0, M0); U.pointer('up', px.x, px.y, 0, M0);
  ok(s.buildings.filter(Boolean).length === n0 + 1 && U.state === 'IDLE' && s.ui.tool === null, 'click on a legal tile places the dorm and returns to IDLE');
  // inspect it
  U.pointer('down', px.x, px.y, 0, M0); U.pointer('up', px.x, px.y, 0, M0);
  ok(U.state === 'INSPECTING' && !U.el.inspect.classList.contains('hidden') && U.el.inspect.dataset.kind === 'building' && U.el['insp-body'].children.length >= 4, 'click → building inspect with rows (' + U.el['insp-title'].textContent + ')');
  ok(U.el['insp-actions'].children.length >= 2, 'inspect actions present');
  U.closeInspect(); ok(U.state === 'IDLE' && U.el.inspect.classList.contains('hidden'), 'closeInspect');
} else ok(false, 'findSpot(dorm) returned null');
// drag a path run through the machine
U.selectTool(s, 'path'); U.pointer('down', 400, 300, 0, M0); ok(U.state === 'DRAGGING', 'drag row + down → DRAGGING');
U.pointer('move', 470, 330, 0, M0); U.pointer('up', 470, 330, 0, M0); ok(U.state === 'PLACING' && s.ui.tool && s.ui.tool.id === 'path', 'up → placeRun, tool kept');
U.pointer('down', 500, 300, 2, M0); U.pointer('up', 501, 300, 2, M0); ok(U.state === 'IDLE' && s.ui.tool === null, 'right-click cancels the tool');
// pan arms after 4 px
U.pointer('down', 300, 300, 0, M0); U.pointer('move', 302, 302, 0, M0); ok(U.state === 'IDLE', '3 px: still armed');
U.pointer('move', 320, 320, 0, M0); ok(U.state === 'PANNING', '> 4 px → PANNING'); U.pointer('up', 320, 320, 0, M0); ok(U.state === 'IDLE', 'release → IDLE');
U.wheel(640, 360, 0, 120, true); ok(s.ui.camera.zoom === 0.5, 'ctrl+wheel down → zoom out: ' + s.ui.camera.zoom); U.wheel(640, 360, 0, -120, true);
// lockTool: Escape cannot cancel
U.selectTool(s, 'dorm'); U.lockTool(s, true); U.keydown('Escape', M0); ok(s.ui.tool && s.ui.tool.id === 'dorm', 'locked tool survives Escape'); U.lockTool(false); U.selectTool(s, null);
// notification onClose exactly once
let closes = 0; U.notify(s, { kind: 'info', text: 'n1', onClose: () => closes++ }); U.notify(s, { kind: 'info', text: 'n2' }); U.notify(s, { kind: 'info', text: 'n3' }); U.notify(s, { kind: 'info', text: 'n4' }); U.notify(s, { kind: 'info', text: 'n5' });
ok(U.el.notifications.children.length === 3 && closes === 1, 'max 3 notifications; replaced one closed exactly once');
// decision default on timeout (tick-based)
U.decision(s, { id: 'd2', text: 'x', ticks: 10 }); BSU.headless.tick(12); BSU.headless.render();
ok(U.el['decision-toast'].classList.contains('hidden'), 'toast defaults after its ticks');
// settings persist
U.settings().muted = true; U.saveSettings(); ok(JSON.parse(win.localStorage.getItem('bsu.settings')).muted === true, 'saveSettings mirrors to localStorage'); U.settings().muted = false; U.saveSettings();
// update budget
BSU.headless.tick(300); const t0 = performance.now(); for (let i = 0; i < 200; i++) U.update(s, 16.67); const per = (performance.now() - t0) / 200;
ok(per < 1.5, `update ≈ ${per.toFixed(3)} ms per frame (< 1.5 ms on the stub)`);
ok(BSU.errors.size === errors0, 'no BSU.error during the unit run' + (BSU.errors.size !== errors0 ? ': ' + [...BSU.errors.keys()].join(' | ') : ''));
BSU.SELFTEST = true; let st; try { st = U.selfTest(); } catch (e) { st = { ok: false, notes: e.message }; } finally { BSU.SELFTEST = false; }
ok(st && st.ok, 'ui.selfTest ok ' + (st && st.notes ? '(' + st.notes + ')' : ''));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
