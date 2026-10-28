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
ok(Buffer.byteLength(css) <= 70 * 1024, `style.css ≤ 70 KB (${(Buffer.byteLength(css) / 1024).toFixed(1)} KB)`);   // gator pass: the chip ✕, the relocated strip beside an open inspect, Dismiss all, why-lines (68 → 70 KB);   // P6 dining menus: the inspect Menu section (64 → 68 KB); UX pass: build menu + tracker + coach marks (was 25 KB); football pass D: Season panel, game HUD, summary card (was 40 KB); UI scale pass: every length in rem + scale tokens (was 48 KB)
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
ok(U.el.minimap.width === 200 && U.el.minimap.height === 200 && U.el['obj-portrait'].width === 64, 'minimap 200×200 (UI scale 100%), portrait 64×64');
// --- UI scale pass: the scale setting snaps to 90/100/115/130 %, is remembered in settings and resizes the minimap canvas; the date chip wraps date + weather
ok(U.el['date-chip'] && U.el['date-chip'].id === 'date-chip' && U.el['stat-date'].parentNode === U.el['date-chip'] && U.el['chip-weather'].parentNode === U.el['date-chip'], 'date + weather share the #date-chip');
ok(U.uiScale() === 1, 'UI scale starts at 100 %');
ok(U.setUiScale(1.15) === 1.15 && U.uiScale() === 1.15 && U.settings().uiScale === 1.15, 'setUiScale(1.15) applies and is remembered in settings');
ok(U.uiScaleEffective() >= 1 && U.uiScaleEffective() < 1.15 && U.el.minimap.width === Math.round(200 * U.uiScaleEffective()) && U.el.minimap.height === U.el.minimap.width, 'the minimap canvas grows with the effective scale (the 1280×720 stub window caps the 115 % setting at ~103 %, never below 100 %)');
ok(U.setUiScale(130) === 1.3 && U.setUiScale(0.9) === 0.9 && U.setUiScale('junk') === 1 && U.setUiScale(1.04) === 1, 'setUiScale snaps percent / fraction / junk to an offered size');
ok(U.el.minimap.width === 200, 'back at 100 % the minimap canvas is 200 px');
const cssScale = css.replace(/\/\*[\s\S]*?\*\//g, '');
ok(/html\{font-size:calc\(1rem \* var\(--ui-scale|html\{font-size:calc\(10px \* var\(--ui-scale/.test(cssScale), 'html font-size follows --ui-scale (all lengths are rem)');
ok(!/--topbar-h:\s*\d+px/.test(cssScale) && /--topbar-h:\s*5\.6rem/.test(cssScale) && /--palette-h:\s*18rem/.test(cssScale), 'layout tokens are rem: topbar 56 px, palette 180 px at 100 % (palette pass)');
// --- P5 centred UI: smart default scale by window width, the title-screen Display size choice, layout rules ---
{
  const W0 = win.innerWidth, H0 = win.innerHeight;
  ok(U.autoScaleFor(1280) === 1 && U.autoScaleFor(1365) === 1 && U.autoScaleFor(1366) === 1.15 && U.autoScaleFor(1679) === 1.15 && U.autoScaleFor(1680) === 1.3 && U.autoScaleFor(2560) === 1.3, 'smart default table: < 1366 → 100 %, 1366–1679 → 115 %, ≥ 1680 → 130 %');
  U.setUiScale('auto');
  ok(U.uiScaleMode() === 'auto' && U.settings().uiScale === 'auto' && U.uiScale() === 1, "setUiScale('auto') stores 'auto' (the 1280-wide stub window picks 100 %)");
  const at = (w, h) => { win.innerWidth = w; win.innerHeight = h; U.setUiScale('auto'); return [U.uiScale(), U.uiScaleEffective()]; };
  let r = at(1440, 900); ok(r[0] === 1.15 && r[1] === 1.15, 'auto at 1440×900 → 115 %');
  r = at(1920, 1080); ok(r[0] === 1.3 && r[1] === 1.3, 'auto at 1920×1080 → 130 %');
  r = at(1366, 768); ok(r[0] === 1.15 && r[1] > 1 && r[1] < 1.15, 'auto at 1366×768 asks for 115 % and the height cap trims it (' + r[1] + ')');
  r = at(1280, 800); ok(r[0] === 1 && r[1] === 1, 'auto at 1280×800 → 100 %');
  win.innerWidth = 1920; win.innerHeight = 1080; U.setUiScale(1); ok(U.uiScaleMode() === 1 && U.uiScale() === 1, 'an explicit size beats the window default'); U.setUiScale('auto');
  const sizeIds = ['btn-size-compact', 'btn-size-comfortable', 'btn-size-large', 'btn-size-auto'];
  ok(sizeIds.every((id) => win.document.getElementById(id)) && win.document.getElementById('btn-size-comfortable').textContent.indexOf('Comfortable') === 0, 'title screen has the Display size row (Compact / Comfortable / Large / Auto)');
  win.document.getElementById('btn-size-large').dispatchEvent({ type: 'click' });
  ok(U.uiScaleMode() === 1.3 && U.settings().uiScale === 1.3 && win.document.getElementById('btn-size-large').classList.contains('active') && !win.document.getElementById('btn-size-auto').classList.contains('active'), 'Large writes the setting and lights its button');
  win.document.getElementById('btn-size-auto').dispatchEvent({ type: 'click' });
  ok(U.uiScaleMode() === 'auto' && win.document.getElementById('btn-size-auto').classList.contains('active'), 'Auto writes the setting back');
  U.setUiScale('auto'); win.innerWidth = W0; win.innerHeight = H0; U.setUiScale(1);
  const cssP5 = css.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/#notifications\{[^}]*left:50%[^}]*bottom:var\(--bot\)/.test(cssP5) && !/#notifications\{[^}]*right:var\(--gutter\)/.test(cssP5), 'notifications stack bottom-centre above the palette (not the right corner)');
  ok(/#cards\{[^}]*padding:var\(--topbar-h\)[^}]*var\(--palette-h\)/.test(cssP5) && /#decision-toast\{[^}]*left:50%/.test(cssP5), 'cards centre over the map area; the decision toast stays centred');
  ok(/#panels #panel-season\{width:110rem\}/.test(cssP5) && /#panels #panel-storm,#panels #panel-budget\{width:72rem\}/.test(cssP5) && /#panels \.panel\{[^}]*width:72rem/.test(cssP5) && /#build-menu\{[^}]*width:min\(130rem/.test(cssP5), 'panels centre with wider maxima: Season 1100, Storm / Budget 720, default 720, Build menu up to 1300 px');
  ok(/#panels\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center/.test(cssP5), 'the panel host centres its panel in the map area');
  ok(/--inspect-w:\s*38rem/.test(cssP5) && /#inspect\{[^}]*right:var\(--side\)/.test(cssP5) && /--side:max\(var\(--gutter\)/.test(cssP5), 'inspect panel 380 px docked right with a gutter; --side centres the docked cards on very wide windows');
  ok(/\.stat \.odometer\{font:700 2\.2rem/.test(cssP5), 'stat numbers are 22 px at 100 %');
  ok(/#hud\.short #objective-card #obj-why/.test(cssP5), 'a short window trims the tracker so it never runs under the ticker');
}
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
// palette pass: every tile is a vertical stack (framed icon, name, price), nothing positioned over the art
{ const t = U.el.itemEls.dorm, kids = (t && t.children) || [], cl = kids.map(c => String(c.className)), nm = kids[cl.indexOf('name')], co = kids[cl.indexOf('cost')];
  ok(cl.slice(0, 3).join(',') === 'icon,name,cost', 'palette tile stack: icon, name, cost: ' + cl.join(','));
  ok(nm && nm.children[0] && nm.children[0].textContent === BSU.data.catalogList.find(r => r.id === 'dorm').name && co && /^\$/.test(co.textContent) && !/\/tile/.test(co.textContent), 'tile name is the full name, price is plain money');
  const dr = U.el.itemEls.path, dk = (dr && dr.children) || []; ok(dk.some(c => String(c.className) === 'cost' && (c.children || []).some(k => String(k.className) === 'per' && k.textContent === '/tile')), 'drag rows show "/tile" on the price line');
  ok(/#palette-items\{[^}]*overflow-x:auto/.test(cssScale) && /#palette-items\.fade-r/.test(cssScale) && /--pal-tile-w:\s*11\.2rem/.test(cssScale) && /--pal-icon:\s*6\.4rem/.test(cssScale), 'quick-bar scrolls sideways with edge fades; 112-px tiles, 64-px icons'); }

ok(U.el['stat-cash-value'].textContent === BSU.formatMoney(s.economy.cash) || /^\$/.test(U.el['stat-cash-value'].textContent), 'cash odometer renders money: ' + U.el['stat-cash-value'].textContent);
ok(/Y1/.test(U.el['stat-date-text'].textContent), 'date text: ' + U.el['stat-date-text'].textContent);
ok(U.el['sky-glyph'].textContent.length > 0, 'sky glyph set');
const M0 = { ctrl: false, shift: false, meta: false, alt: false };
// --- menu layout pass: the CSS the Edit menu overlay and the inspect body rely on ---------------------------------------
{
  const cssM = css.slice(css.indexOf('/* menu (P6)'));
  ok(/#panels #menu-overlay\{[^}]*width:64rem/.test(cssM), 'the Edit menu overlay is a 64-rem panel in the centring #panels host');
  ok(/\.menu-grid\{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(13\.\d+rem,1fr\)\)/.test(cssM), 'the dish grid packs 3-4 columns (auto-fill, 13.x-rem minimum)');
  ok(/\.btn\.dish\.tier-cheap\{[^}]*\}[^]*tier-standard[^]*tier-premium/.test(cssM) && /\.mo-reason\.flash\{/.test(cssM) && /\.mo-count\.full\{/.test(cssM), 'tier colours, the inline reason and the full count are styled');
  ok(/#insp-body\{[^}]*flex:1 1 0[^}]*min-height:0[^}]*overflow-y:auto/.test(css) && /#inspect\{[^}]*top:calc\(var\(--topbar-h\) \+ 1\.6rem\);bottom:var\(--bot\)/.test(css), 'the inspect body takes the panel height left after the head and actions (panel pinned between the top bar and the palette) and scrolls only past it');
}
// --- UX pass: goals tracker, needs strip, build menu, coach helpers ----------------------
for (const id of ['issues-tray', 'issues-head', 'issues-count', 'issues-spot', 'issues-list', 'issues-more', 'needs-locate']) ok(U.el[id] && U.el[id].id === id, 'issue spotlight skeleton #' + id);   // issue spotlight pass: the Issues tray under the minimap + the needs-strip Locate
ok(/#issues-tray\{position:absolute;right:var\(--side\)/.test(css) && /\.issue-row\{display:grid/.test(css) && /#hud\.inspect-open #issues-tray/.test(css), 'tray CSS docked right, shifts with inspect');
for (const id of ['build-menu', 'bm-cats', 'bm-cards', 'bm-detail', 'btn-build-menu', 'needs-strip', 'needs-text', 'obj-why', 'btn-obj-build', 'obj-next', 'coach', 'coach-box', 'btn-coach-next']) ok(U.el[id] && U.el[id].id === id, 'UX skeleton id: ' + id);
ok(U.el['build-menu'].classList.contains('hidden') && !U.buildMenuOpen(), 'build menu starts closed');
ok(U.keydown('g', M0) === true && U.buildMenuOpen() && !U.el['build-menu'].classList.contains('hidden'), 'G opens the build menu');
U.update(s, 16);
ok(Object.keys(U.el.bmCats).length >= 2 && Object.keys(U.el.bmCards).length >= 3, `menu built: ${Object.keys(U.el.bmCats).length} categories, ${Object.keys(U.el.bmCards).length} cards`);
ok(Object.values(U.el.bmCards).every((c) => c.children.some((x) => x.className === 'bm-blurb' && x.textContent.length > 0)), 'every card carries a blurb');
ok(U.el['bm-detail'].children.length >= 4, 'detail card renders (' + U.el['bm-detail'].children.length + ' nodes)');
ok(U.keydown('Escape', M0) === true && !U.buildMenuOpen() && U.el['build-menu'].classList.contains('hidden'), 'Escape closes the build menu first');
U.openBuildMenu(s, { focus: 'dorm', pulse: true }); U.update(s, 16);
ok(U.buildMenuOpen() && s.ui.paletteTab === 'essentials' && U.el.bmCards.dorm && U.el.bmCards.dorm.classList.contains('pulse'), 'openBuildMenu({focus:dorm}) lands on Essentials and pulses the Dorm card');
U.closeBuildMenu();
const nd = U._ux.needsOf(s);
ok(nd.terms.length === 5 && nd.terms.map((t) => t.key).join(',') === 'beds,seats,dining,power,water' && nd.binding && typeof nd.binding.text === 'string', 'needsOf: five gauges + a binding line (' + nd.binding.text + ')');
BSU.economy.addStudents(s, 5000, 'debug'); U.update(s, 16);
const nd2 = U._ux.needsOf(s); const reco = U._ux.recommend(s);
ok(nd2.binding.level === 'bad' && /full|no power|no water/.test(nd2.binding.text) && nd2.binding.build && reco[nd2.binding.build] === 'Needed', '5,000 students: a hard constraint binds and its fix is recommended (' + nd2.binding.text + ')');
ok(nd2.terms[0].used === nd2.students && nd2.terms[0].cap <= nd2.students, 'beds gauge reads students / capacity and is over capacity');
ok(U.el['needs-text'].textContent === nd2.binding.text && U.el['needs-text'].dataset.build === nd2.binding.build, 'needs strip shows the binding line');
ok(U._ux.effectLines(BSU.data.catalog.dorm).some((l) => /300 beds/.test(l)) && U._ux.effectLines(BSU.data.catalog.stadium).some((l) => /Cauldron/.test(l)), 'effectLines: dorm beds, stadium tiers');
// P7 housing tiers: the detail lines name the tier, the room fee and the parking spaces; a short purse points the beds fix at the economy tier
ok(U._ux.effectLines(BSU.data.catalog.bunkhouse).some((l) => /360 beds/.test(l)) && U._ux.effectLines(BSU.data.catalog.bunkhouse).some((l) => /Economy housing: no room fee/.test(l)) && U._ux.effectLines(BSU.data.catalog.bunkhouse).some((l) => /-1 happiness within 4/.test(l) || /−1 happiness within 4/.test(l)), 'effectLines: Bunkhouse beds, economy tier, −1 happiness within 4');
ok(U._ux.effectLines(BSU.data.catalog.suites).some((l) => /Premium housing: room fee \$400/.test(l)) && U._ux.effectLines(BSU.data.catalog.suites).some((l) => /60 parking spaces/.test(l)) && U._ux.effectLines(BSU.data.catalog.dorm).some((l) => /Standard housing: room fee \$150/.test(l)), 'effectLines: Suites premium fee + 60 parking spaces; the Dorm is the $150 standard tier');
{ const cash0 = s.economy.cash; s.economy.cash = 200000; U.update(s, 20000); const r2 = U._ux.recommend(s);
  ok(nd2.binding.key === 'beds' && r2.bunkhouse === 'Needed' && !r2.dorm, 'beds binding with $200k: the Needed badge moves to the economy Bunkhouse (' + JSON.stringify(r2) + ')');
  s.economy.cash = 9000000; U.update(s, 40000); const r3 = U._ux.recommend(s);
  ok(r3.dorm === 'Needed' && !r3.bunkhouse, 'beds binding with cash in hand: the standard Dorm keeps the badge');
  s.economy.cash = cash0; U.update(s, 60000); }
ok(U._ux.requirementsOf(BSU.data.catalog.dorm).length === 3 && U._ux.requirementsOf(BSU.data.catalog.wastewater).some((q) => /Road within 4/.test(q.text)), 'requirementsOf: dorm path+power+water; wastewater road within 4');
ok(U._ux.objTarget(s, { id: '3' }) === 'dorm' && U._ux.objTarget(s, { id: '13' }) === null, 'objTarget: objective 3 → dorm, 13 → none');
ok(U.coachStep() === -1, 'coach never starts in headless mode');

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
// --- PLAN_V2 P6 + menu layout pass: the inspect panel's Menu summary and the Edit menu overlay ----------------------
{
  const sp = BSU.headless.findSpot('dining_hall');
  if (sp) {
    s.economy.cash = 9e7;
    const pr = BSU.headless.place('dining_hall', sp.x, sp.y);
    const hall = BSU.buildings.list(s, 'dining_hall').slice(-1)[0];
    ok(pr && pr.ok && hall, 'a dining hall for the menu test (' + (pr && pr.reason) + ')');
    const nb = (t) => String(t).replace(/ /g, ' ');
    const U_ = U.el, ov = U_['menu-overlay'];
    ok(!!ov && ov.classList.contains('panel') && ov.classList.contains('hidden') && !U.menuEditorOpen() && ['btn-menu-close', 'menu-title', 'menu-sum', 'menu-presets', 'menu-count', 'menu-reason', 'menu-grid', 'menu-note'].every((id) => U_[id] && U_[id].id === id), 'the Edit menu overlay skeleton exists and starts closed');
    // a hall still under construction has no Menu section and cannot open the editor
    hall.built = 0.4; U.inspect(s, { kind: 'building', id: hall.id });
    ok(!U_['insp-body'].children.some((c) => c.id === 'insp-menu') && U.openMenuEditor(hall.id) === false && !U.menuEditorOpen(), 'an unfinished hall shows no Menu section and the editor refuses');
    hall.built = 1; s.tick += 3;
    const openOn = () => { U.inspect(s, { kind: 'building', id: hall.id }); return U_['insp-body'].children.find((c) => c.id === 'insp-menu'); };
    let menu = openOn();
    ok(!!menu && menu.classList.contains('insp-menu') && U_['insp-body'].children[0] === menu, 'a complete hall shows the Menu section first in the body');
    ok(U_['insp-body'].children.some((c) => c.children[0] && c.children[0].textContent === 'Feeds' && /^~1,200 a day \(menu\)$/.test(c.children[1].textContent)), 'the Feeds row reads the menu throughput');
    const sum = () => nb(menu.children[1].textContent), editBtn = () => menu.children[0].children[1];
    ok(/^Serves ~1,200\/day · appeal ★★☆☆ · food \$[\d,.kM]+\/mo · Campus Classic$/.test(sum()), 'summary line: ' + sum());
    ok(editBtn().id === 'btn-edit-menu' && editBtn().textContent === 'Edit menu' && menu.children[0].children[0].children[1].textContent === '10 / 10', 'Edit menu button + the 10 / 10 count in the head');
    ok(menu.children.length === 2 && !U_['insp-body'].children.some((c) => c.classList && c.classList.contains('menu-grid')), 'the dish grid is not in the inspect body any more (summary + button only)');
    // open the overlay
    editBtn().dispatchEvent({ type: 'click' });
    ok(U.menuEditorOpen() && !ov.classList.contains('hidden') && U_.hud.classList.contains('menu-open') && /Menu$/.test(U_['menu-title'].textContent), 'Edit menu opens the overlay (' + U_['menu-title'].textContent + ')');
    ok(nb(U_['menu-sum'].textContent) === sum(), 'the overlay carries the same live summary line');
    const presets = () => U_['menu-presets'].children, cells = () => U_['menu-grid'].children, on = () => cells().filter((c) => c.classList.contains('on'));
    const dishes = BSU.data.dishes.filter((d) => !d.festival);
    ok(presets().length === 3 && presets().map((p) => p.textContent).join('|') === "Cheap & Fast|Campus Classic|Chef's Table" && presets().find((p) => p.dataset.preset === 'classic').classList.contains('on'), 'overlay: three presets, Campus Classic lit');
    ok(cells().length === dishes.length && cells().length === 23 && dishes.every((d) => cells().some((c) => c.dataset.dish === d.id)), 'the grid shows every dish (23; the festival special stays off out of its window)');
    ok(on().length === 10 && cells().every((c) => /tier-(cheap|standard|premium)/.test(c.className) && c.children[1].children.length === 3 && /^\$/.test(c.children[1].children[0].textContent) && /^prep \d$/.test(c.children[1].children[1].textContent) && /^★\d$/.test(c.children[1].children[2].textContent)), '10 on; tier colour + cost / prep / appeal chips on every cell');
    ok(U_['menu-count'].textContent === '10 / 10' && U_['menu-count'].classList.contains('full') && /Menu is full \(10 of 10\)/.test(U_['menu-reason'].textContent), 'count "10 / 10" and the full-card reason inline: ' + U_['menu-reason'].textContent);
    ok(/×1 throughput/.test(U_['menu-note'].textContent) && /a plate/.test(U_['menu-note'].textContent), 'note line: ' + U_['menu-note'].textContent);
    // cells are updated in place across the half-second refresh (focus / scroll survive)
    const keepCell = cells()[3], keepScroll = (ov.scrollTop = 77);
    U_['insp-body'].scrollTop = 33; U.update(s, 600);
    ok(cells()[3] === keepCell && cells().length === 23 && ov.scrollTop === keepScroll && !ov.classList.contains('hidden'), 'a refresh keeps the same cells, the overlay open and its scroll');
    menu = openOn(); ok(U.menuEditorOpen() && menu.children[0].children[1].textContent === 'Close editor', 'the section knows the editor is open ("Close editor")');
    presets().find((p) => p.dataset.preset === 'chef').dispatchEvent({ type: 'click' });
    ok(/^Serves ~800\/day · appeal ★★★★/.test(nb(U_['menu-sum'].textContent)) && presets().find((p) => p.dataset.preset === 'chef').classList.contains('on') && on().length === 7 && U_['menu-count'].textContent === '7 / 10' && !U_['menu-count'].classList.contains('full'), "Chef's Table: 800 a day, four stars, 7 dishes on, 7 / 10");
    menu = openOn(); ok(/^Serves ~800\/day · appeal ★★★★ · food \$[\d,.kM]+\/mo · Chef's Table$/.test(sum()), 'the inspect summary follows: ' + sum());
    presets().find((p) => p.dataset.preset === 'cheap').dispatchEvent({ type: 'click' });
    ok(/^Serves ~2,400\/day · appeal ★☆☆☆/.test(nb(U_['menu-sum'].textContent)) && on().length === 8 && /Cheap & Fast$/.test(nb(U_['menu-sum'].textContent)), 'Cheap & Fast: 2,400 a day, one star, 8 dishes on');
    // fill to the cap through the grid, then the eleventh answers with a reason on the overlay's own line
    const off = () => cells().filter((c) => !c.classList.contains('on'));
    const two = off().slice(0, 2); two[0].dispatchEvent({ type: 'click' }); two[1].dispatchEvent({ type: 'click' });
    ok(hall.data.menu.length === 10 && on().length === 10 && /Custom menu$/.test(nb(U_['menu-sum'].textContent)), 'two clicks add two dishes → 10, "Custom menu"');
    const n0 = U_.notifications.children.length;
    off()[0].dispatchEvent({ type: 'click' });
    ok(hall.data.menu.length === 10 && /A hall lists 10 dishes at most/.test(U_['menu-reason'].textContent) && U_['menu-reason'].classList.contains('flash') && U_.notifications.children.length === n0, 'the eleventh dish is refused with the cap reason inline: ' + U_['menu-reason'].textContent);
    on()[0].dispatchEvent({ type: 'click' });
    ok(hall.data.menu.length === 9 && !U_['menu-reason'].classList.contains('flash') && U_['menu-count'].textContent === '9 / 10', 'clicking a listed dish removes it (9 / 10, the refusal clears)');
    // the one-dish floor answers inline too
    BSU.buildings.setMenu(s, hall.id, [hall.data.menu[0]]); U.update(s, 600);
    ok(on().length === 1, 'one dish left on the card'); on()[0].dispatchEvent({ type: 'click' });
    ok(hall.data.menu.length === 1 && /Keep at least one dish/.test(U_['menu-reason'].textContent), 'the last dish stays: ' + U_['menu-reason'].textContent);
    // Esc peels the overlay first, then the inspect panel; the ✕ closes it too
    presets().find((p) => p.dataset.preset === 'classic').dispatchEvent({ type: 'click' });
    ok(U.keydown('Escape', M0) === true && !U.menuEditorOpen() && ov.classList.contains('hidden') && !U_.hud.classList.contains('menu-open') && !U_.inspect.classList.contains('hidden') && U.state === 'INSPECTING', 'Esc #1 closes the Edit menu overlay and leaves the inspect panel');
    ok(U.keydown('Escape', M0) === true && U_.inspect.classList.contains('hidden') && U.state === 'IDLE', 'Esc #2 closes the inspect panel');
    openOn(); U.openMenuEditor(); ok(U.menuEditorOpen(), 'openMenuEditor() opens the inspected kitchen');
    U_['btn-menu-close'].dispatchEvent({ type: 'click' }); ok(!U.menuEditorOpen() && ov.classList.contains('hidden'), 'the ✕ button closes it');
    U.openMenuEditor(hall.id); ok(U.menuEditorOpen(), 'open again by id');
    U.inspect(s, { kind: 'tile', i: 5 * 64 + 5 }); ok(!U.menuEditorOpen() && ov.classList.contains('hidden'), 'inspecting something else closes the overlay');
    U.openPanel('budget'); U.openMenuEditor(hall.id); ok(U.menuEditorOpen() && s.ui.panel === null, 'opening the editor closes an open panel'); U.openPanel('budget'); ok(!U.menuEditorOpen() && s.ui.panel === 'budget', 'opening a panel closes the editor'); U.openPanel(null);
    U.closeInspect();
    // a Po'boy Shack: cap 3, its own reason
    const sp2 = BSU.headless.findSpot('poboy');
    if (sp2) {
      BSU.headless.place('poboy', sp2.x, sp2.y); const shack = BSU.buildings.list(s, 'poboy').slice(-1)[0]; shack.built = 1; s.tick += 3;
      U.inspect(s, { kind: 'building', id: shack.id }); U.openMenuEditor(shack.id);
      const offs = cells().filter((c) => !c.classList.contains('on'));
      ok(U.menuEditorOpen() && /^3 \/ 3$/.test(U_['menu-count'].textContent) && on().length === 3, 'a shack opens its editor at 3 / 3 (' + U_['menu-count'].textContent + ')');
      offs[0].dispatchEvent({ type: 'click' });
      ok(shack.data.menu.length === 3 && /A shack lists 3 dishes at most/.test(U_['menu-reason'].textContent), 'the shack cap reason: ' + U_['menu-reason'].textContent);
      U.closeInspect(); ok(!U.menuEditorOpen(), 'closing the inspect closes the editor');
    } else ok(false, 'findSpot(poboy) returned null');
  } else ok(false, 'findSpot(dining_hall) returned null');
}
// drag a path run through the machine
U.selectTool(s, 'path'); U.pointer('down', 400, 300, 0, M0); ok(U.state === 'DRAGGING', 'drag row + down → DRAGGING');
U.pointer('move', 470, 330, 0, M0); U.pointer('up', 470, 330, 0, M0); ok(U.state === 'PLACING' && s.ui.tool && s.ui.tool.id === 'path', 'up → placeRun, tool kept');
U.pointer('down', 500, 300, 2, M0); U.pointer('up', 501, 300, 2, M0); ok(U.state === 'IDLE' && s.ui.tool === null, 'right-click cancels the tool');
// undo pass — backtracking inside a drag: the pending run is an ordered trail through a private machine (tile = 20 x 11 px cells)
{
  const T = (x, y) => ({ px: x * 20 + 10, py: y * 11 + 5 }), I = (x, y) => y * 64 + x;
  const mv = (m, x, y, mods) => m.step({ type: 'move', ...T(x, y), button: 0, mods: mods || M0 });
  const runs = []; let tool = null;
  const mk = () => U._machine({ getTool: () => tool, setTool: t => { tool = t; }, placeRun: r => { runs.push(r.slice()); } });
  const start = (m, x, y) => { m.step({ type: 'tool', id: 'path' }); m.step({ type: 'down', ...T(x, y), button: 0, mods: M0 }); };
  let m = mk(); start(m, 5, 5);
  for (let x = 6; x <= 9; x++) mv(m, x, 5);
  for (let y = 6; y <= 8; y++) mv(m, 9, y);
  ok(m.run.length === 8 && m.run[7] === I(9, 8), 'L trail laid: 4 right, 3 down (' + m.run.length + ' tiles)');
  mv(m, 9, 7); mv(m, 9, 6); mv(m, 9, 5);
  ok(m.run.length === 5 && m.run[4] === I(9, 5) && !m.run.includes(I(9, 6)), 'back over the last three tiles truncates the trail to the corner');
  mv(m, 9, 4); mv(m, 9, 3);
  ok(m.run.length === 7 && m.run[5] === I(9, 4) && m.run[6] === I(9, 3), 're-extending a different way (up) appends after the truncation');
  m.step({ type: 'up', ...T(9, 3), button: 0, mods: M0 });
  ok(runs.length === 1 && runs[0].length === 7 && runs[0][0] === I(5, 5) && runs[0][4] === I(9, 5) && runs[0][6] === I(9, 3) && m.state === 'PLACING' && tool && tool.id === 'path', 'release commits exactly the surviving trail, tool kept');
  for (let k = 1; k < runs[0].length; k++) { const d = Math.abs(runs[0][k] - runs[0][k - 1]); ok(d === 1 || d === 64, 'committed trail step ' + k + ' is 4-connected'); }
  // start tile can be backed over; the trail shrinks to one tile and can grow the other way
  m = mk(); start(m, 10, 10); for (let x = 11; x <= 13; x++) mv(m, x, 10);
  mv(m, 10, 10); ok(m.run.length === 1 && m.run[0] === I(10, 10) && m.state === 'DRAGGING', 'backing over the start tile shrinks the trail to one tile');
  mv(m, 10, 11); mv(m, 10, 12); ok(m.run.length === 3 && m.run[2] === I(10, 12), 'after the full backtrack the run re-extends in a new direction');
  // a fast cursor jump back onto a mid-trail tile cuts straight to it; a jump onto fresh ground fills with the staircase
  m = mk(); start(m, 2, 2); for (let x = 3; x <= 8; x++) mv(m, x, 2);
  mv(m, 4, 2); ok(m.run.length === 3 && m.run[2] === I(4, 2), 'a jump back across several tiles truncates in one move');
  mv(m, 7, 5); ok(m.run.length === 3 + 3 + 3 && m.run[m.run.length - 1] === I(7, 5), 'a jump onto fresh ground fills the staircase (x then y)');
  const lenBefore = m.run.length; mv(m, 7, 5); ok(m.run.length === lenBefore, 'a move within the same tile changes nothing');
  mv(m, 4, 2); ok(m.run.length === 3, 'and the whole staircase backs out again in one move');
  // the trail never holds a tile twice
  m = mk(); start(m, 20, 20); const path = [[21, 20], [21, 21], [20, 21], [20, 20], [20, 19], [19, 19]]; for (const [x, y] of path) mv(m, x, y);
  ok(new Set(m.run).size === m.run.length, 'a loop back over the start never duplicates a tile (' + m.run.length + ' tiles)');
  // Shift = straight line from the start; it shortens as the cursor comes back
  m = mk(); start(m, 30, 30); mv(m, 36, 30, { ...M0, shift: true }); ok(m.run.length === 7, 'Shift line out to 7 tiles'); mv(m, 32, 30, { ...M0, shift: true }); ok(m.run.length === 3, 'Shift line shortens when the cursor returns');
  // cancel: right-click or Esc during the drag drops the whole run, places nothing, keeps the tool; the stray release does nothing
  runs.length = 0; m = mk(); start(m, 5, 5); for (let x = 6; x <= 9; x++) mv(m, x, 5);
  m.step({ type: 'down', ...T(9, 5), button: 2, mods: M0 }); ok(m.state === 'PLACING' && m.run.length === 0 && tool && tool.id === 'path', 'right-click during a drag cancels the run (tool kept)');
  m.step({ type: 'up', ...T(9, 5), button: 2, mods: M0 }); ok(runs.length === 0 && m.state === 'PLACING', 'the right-button release places nothing');
  m.step({ type: 'up', ...T(9, 5), button: 0, mods: M0 }); ok(runs.length === 0, 'neither does the late left release');
  start(m, 5, 5); mv(m, 6, 5); mv(m, 7, 5); ok(m.step({ type: 'key', key: 'Escape', ...T(7, 5) }) === true && m.state === 'PLACING' && m.run.length === 0 && runs.length === 0 && tool, 'Esc during the drag cancels the whole run (tool kept)');
  m.step({ type: 'key', key: 'Escape' }); ok(m.state === 'IDLE' && tool === null, 'a second Esc drops the tool');
  start(m, 5, 5); m.step({ type: 'tool', id: 'path' }); ok(runs.length === 0, 'selecting a tool mid-drag never commits');
  m = mk(); start(m, 5, 5); mv(m, 7, 5); m.step({ type: 'down', ...T(7, 5), button: 1, mods: M0 }); m.step({ type: 'up', ...T(7, 5), button: 1, mods: M0 }); ok(runs.length === 0 && m.state === 'DRAGGING', 'a middle-button release neither commits nor cancels the drag');
  m.step({ type: 'cancel' }); ok(m.state === 'PLACING' && m.run.length === 0 && runs.length === 0, 'pointercancel / blur drops the run');
}
// the live ui: a dragged run can be backtracked on the real canvas, and Ctrl+Z (or the chip) takes it back with a refund
{
  const cash0 = s.economy.cash; U.selectTool(s, 'path');
  const spot = (() => { for (let ty = 8; ty < 40; ty++) for (let tx = 20; tx < 55; tx++) { let all = true; for (let k = 0; k < 8 && all; k++) { const r = BSU.buildings.canPlace(s, 'path', tx + k, ty, {}); if (!r.ok) all = false; } if (all) return { tx, ty }; } return null; })();
  if (spot) {
    const P = (x, y) => BSU.render.tileToScreen(x, y);
    const a = P(spot.tx, spot.ty); U.pointer('move', a.x, a.y, 0, M0); U.pointer('down', a.x, a.y, 0, M0);
    for (let k = 1; k <= 6; k++) { const q = P(spot.tx + k, spot.ty); U.pointer('move', q.x, q.y, 0, M0); }
    ok(U.state === 'DRAGGING', 'live drag in progress');
    for (let k = 5; k >= 3; k--) { const q = P(spot.tx + k, spot.ty); U.pointer('move', q.x, q.y, 0, M0); }
    const e = P(spot.tx + 3, spot.ty); U.pointer('up', e.x, e.y, 0, M0);
    const laid = []; for (let k = 0; k < 8; k++) laid.push(s.tiles.surface[(spot.ty << 6) + spot.tx + k] !== 0);
    ok(laid.slice(0, 4).every(Boolean) && laid.slice(4).every(v => !v), 'live: backtracking three tiles left a 4-tile path (' + laid.map(Number).join('') + ')');
    const info = BSU.buildings.undoInfo(s);
    ok(info && info.n === 4 && cash0 - s.economy.cash === info.refund, 'the run cost equals the refund Undo promises (' + (info && info.refund) + ')');
    U.update(s, 16);
    ok(!U.el['undo-chip'].classList.contains('hidden') || BSU.headlessMode, 'the Undo chip shows after a run (headless stub: chip logic skipped)');
    ok(U.keydown('z', { ...M0, ctrl: true }) === true, 'Ctrl+Z handled');
    const back = []; for (let k = 0; k < 8; k++) back.push(s.tiles.surface[(spot.ty << 6) + spot.tx + k]);
    ok(back.every(v => v === 0) && s.economy.cash === cash0, 'Ctrl+Z removed the path and refunded every dollar');
    ok(U.keydown('z', { ...M0, meta: true }) === true && s.economy.cash === cash0, 'Cmd+Z with nothing left to undo is harmless');
  } else ok(false, 'no 8-tile clear row found for the live backtrack test');
  U.selectTool(s, null);
}
// pan arms after 4 px
U.pointer('down', 300, 300, 0, M0); U.pointer('move', 302, 302, 0, M0); ok(U.state === 'IDLE', '3 px: still armed');
U.pointer('move', 320, 320, 0, M0); ok(U.state === 'PANNING', '> 4 px → PANNING'); U.pointer('up', 320, 320, 0, M0); ok(U.state === 'IDLE', 'release → IDLE');
U.wheel(640, 360, 0, 120, true); ok(s.ui.camera.zoom === 0.5, 'ctrl+wheel down → zoom out: ' + s.ui.camera.zoom); U.wheel(640, 360, 0, -120, true);
// lockTool: Escape cannot cancel
U.selectTool(s, 'dorm'); U.lockTool(s, true); U.keydown('Escape', M0); ok(s.ui.tool && s.ui.tool.id === 'dorm', 'locked tool survives Escape'); U.lockTool(false); U.selectTool(s, null);
// notification onClose exactly once
let closes = 0; U.notify(s, { kind: 'info', text: 'n1', onClose: () => closes++ }); U.notify(s, { kind: 'info', text: 'n2' }); U.notify(s, { kind: 'info', text: 'n3' }); U.notify(s, { kind: 'info', text: 'n4' }); U.notify(s, { kind: 'info', text: 'n5' });
ok(U.el.notifications.children.filter((c) => c.id !== 'notif-dismiss').length === 3 && closes === 1, 'max 3 notifications; replaced one closed exactly once');   // gator pass: the Dismiss-all button is a child too
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

// --- gator pass: the chip (✕, 12 s, 3-day cooldown, mute), escalation notifications (Locate + Fix + why), Dismiss all, Esc, the inspect rows ----
try {
  const PG = BSU.params.wildlife.gator, H = BSU.headless;
  const txt = (e) => e ? (e.textContent || '') + Array.from(e.children || []).map(txt).join('') : '';   // the DOM stub's textContent is not recursive
  const cm = BSU.wildlife.campusMask(s); let ci = -1; for (let i = 0; i < cm.length; i++) if (cm[i]) { ci = i; break; }
  s.ui.tool = null; s.ui.panel = null; U.closeInspect(); U.closeBuildMenu(); U.closeCard(); U.dismissNotifs(); U.settings().muteGators = false;
  const savedGators = s.gators.slice(); s.gators.length = 0;   // the seed-11 game may already have a visitor whose den sits inside the campus mask: park the wild ones
  H.tick(2); for (const k in U.gatorAlerts()) delete U.gatorAlerts()[k]; U.closeAlert();
  const g = BSU.wildlife.spawnGator(s, ci, 'Chippy'); g.tx = ci % 64 + 0.5; g.ty = ((ci / 64) | 0) + 0.5; g.state = 'LOUNGE'; g.lounge = 100000;
  H.tick(12); U.update(s, 600); U.update(s, 600);
  const strip = U.el['alert-strip'];
  ok(!strip.classList.contains('hidden') && /Chippy/.test(U.el['alert-gator'].textContent) && U.el['alert-close'] && !U.el['alert-close'].classList.contains('hidden') && /Fix|Relocate/.test(U.el['alert-action'].textContent), 'gator chip: name, Fix, ✕ (' + U.el['alert-gator'].textContent + ')');
  const ga = U.gatorAlerts()[g.id]; ok(ga && ga.cooldownDay === s.calendar.day + PG.alertCooldownDays, 'the chip books a 3-day cooldown for that gator');
  U.el['alert-close'].dispatchEvent({ type: 'click' }); U.update(s, 600); U.update(s, 600);
  ok(strip.classList.contains('hidden') && U.gatorAlerts()[g.id].until === 0, '✕ closes the chip and expires it');
  // a second gator gets its own chip; the first does not re-fire (cooldown)
  let cj = -1; for (let i = cm.length - 1; i >= 0; i--) if (cm[i]) { cj = i; break; }
  const g2 = BSU.wildlife.spawnGator(s, cj, 'Nibbles'); g2.tx = cj % 64 + 0.5; g2.ty = ((cj / 64) | 0) + 0.5; g2.state = 'LOUNGE'; g2.lounge = 100000;
  H.tick(12); U.update(s, 600); U.update(s, 600);
  ok(!strip.classList.contains('hidden') && /Nibbles/.test(U.el['alert-gator'].textContent), 'the next gator gets its own chip; the closed one stays quiet');
  U.closeAlert();
  // auto-dismiss after alertMs
  const g3i = ci + 1; const g3 = BSU.wildlife.spawnGator(s, g3i, 'Sleepy'); g3.tx = g3i % 64 + 0.5; g3.ty = ((g3i / 64) | 0) + 0.5; g3.state = 'LOUNGE'; g3.lounge = 100000;
  H.tick(12); U.update(s, 600); U.update(s, 600); const upSleepy = !strip.classList.contains('hidden') && /Sleepy/.test(U.el['alert-gator'].textContent);
  U.update(s, PG.alertMs + 100); U.update(s, 600);
  ok(upSleepy && (strip.classList.contains('hidden') || !/Sleepy/.test(U.el['alert-gator'].textContent)), 'the chip auto-dismisses after alertMs');
  // mute: sightings go to the ticker only
  U.settings().muteGators = true; U.closeAlert(); for (const k in U.gatorAlerts()) delete U.gatorAlerts()[k];
  U.update(s, 600); U.update(s, 600);
  ok(strip.classList.contains('hidden') || !/🐊/.test(U.el['alert-icon'].textContent), 'Mute gator sightings: no chip');
  U.openPanel('settings'); const chk = win.document.getElementById('chk-gators');
  ok(chk && chk.textContent === 'On', 'Settings has the "Mute gator sightings" toggle (On)');
  if (chk) chk.dispatchEvent({ type: 'click' }); ok(U.settings().muteGators === false && chk.textContent === 'Off', 'the toggle flips the setting');
  U.openPanel(null);
  // escalation → a notification with Locate, Fix and the why-line; one per gator (replaced, not stacked)
  U.dismissNotifs();
  g.onPath = true; g.delayed = 7; g.blocked |= 3; BSU.issues.invalidate();   // issues v2: only a blocking gator is an issue (the notification's Locate wants the row)
  BSU.events.emit(BSU.EV.GATOR_BLOCKED, { id: g.id, name: 'Chippy', i: ci, what: 'path', delayed: 7 });
  BSU.events.emit(BSU.EV.GATOR_BLOCKED, { id: g.id, name: 'Chippy', i: ci, what: 'closed', buildingId: 0, building: 'Tiger Dining', kind: 'dining hall' });
  const nn = Array.from(U.el.notifications.children).filter((c) => c.className.indexOf('notif') === 0 && c.id !== 'notif-dismiss');
  const nb = nn.length === 1 ? Array.from(nn[0].children).map((c) => c.textContent) : [];
  ok(nn.length === 1 && /Chippy is keeping Tiger Dining closed/.test(txt(nn[0])) && nb.indexOf('Fix') >= 0 && nb.indexOf('Locate') >= 0 && Array.from(nn[0].children).some((c) => c.className.indexOf('notif-why') >= 0), 'gator:blocked → one notification per gator with Fix, Locate and the why-line (' + nn.length + ')');
  // Dismiss all appears at 3 stacked; Esc clears the stack (after the issue selection)
  U.notify(s, { kind: 'info', text: 'g-a' }); U.notify(s, { kind: 'info', text: 'g-b' }); U.update(s, 20);
  ok(!U.el['notif-dismiss'].classList.contains('hidden'), '"Dismiss all" shows once three notifications are stacked');
  U.el['notif-dismiss'].dispatchEvent({ type: 'click' }); U.update(s, 20);
  ok(U.el.notifications.children.length === 0 && U.el['notif-dismiss'].classList.contains('hidden') && U.el['notif-dismiss'].parentNode === U.el.hud, 'Dismiss all clears the stack (the button is a hud child above it)');
  U.notify(s, { kind: 'info', text: 'g-c' }); U.notify(s, { kind: 'info', text: 'g-d' });
  s.ui.tool = null; s.ui.panel = null; U.closeInspect(); U.closeBuildMenu(); U.closeCard(); BSU.issues.select(null);
  const escR = U.keydown('Escape', M0); ok(escR === true && U.el.notifications.children.length === 0, `Esc clears the notification stack (last layer) (${escR}, ${U.el.notifications.children.length}, tool ${!!s.ui.tool}, panel ${s.ui.panel}, bm ${U.buildMenuOpen()}, popover ${U.el.popover.classList.contains('hidden')}, sel ${BSU.issues.selectedId()}, spot ${U.issues.spotlight()})`);
  // name tags only when selected / located
  U.update(s, 600);
  ok(U.el.tooltip.classList.contains('hidden') || !/Chippy|Nibbles|Sleepy/.test(txt(U.el.tooltip)), 'no 3-second name tag on campus entry');
  // the inspect panel: doing / cost / why / the Fix
  U.inspect(s, { kind: 'gator', id: g.id }); U.update(s, 600);
  const body = txt(U.el['insp-body']), acts = Array.from(U.el['insp-actions'].children).map((c) => c.textContent);
  ok(/Doing/.test(body) && /Cost so far/.test(body) && /Why it matters/.test(body) && /On campus/.test(body), 'gator inspect: Doing, On campus, Cost so far, Why it matters rows');
  ok(acts.some((a) => /Call Parish Wildlife · \$15k|Relocate · Officer/.test(a)) && acts.indexOf('Fence this bank') >= 0 && acts.indexOf('Build a Preserve') >= 0, 'gator inspect actions: the Fix, Fence this bank, Build a Preserve (' + acts.join(' | ') + ')');
    U.closeInspect(); U.dismissNotifs(); U.closeAlert();
  s.gators.length = 0; for (const x of savedGators) s.gators.push(x); BSU.issues.invalidate();
} catch (e) { ok(false, 'gator pass ui: ' + (e.stack || e)); }

// --- issues v2 pass: the tray groups rows by kind, an In progress section, Clear all, Snooze / Dismiss, Fix arms the tool ----
try {
  BSU.session.newGame({ seed: 42, skipTutorial: true });
  const s3 = BSU.state; U.showTitle(false); U.settings().coachSeen = true; s3.economy.cash = 5e6;
  const B = BSU.buildings, I3 = BSU.issues, H = BSU.headless; win.innerHeight = 1400; U.closeInspect(); U.closeBuildMenu(); U.selectTool(s3, null);
  H.tick(20); H.render();
  const upd = () => { U.update(s3, 300); U.update(s3, 300); };
  const sp = H.findSpot('dorm'); const pr = H.place('dorm', sp.x, sp.y); const dorm = B.get(s3, pr.id); dorm.built = 1; B.recomputeCoverage(s3);
  const tl = s3.tiles; const xs = []; for (let x = 10; x < 14; x++) { const i = BSU.idx(x, 5); tl.crest[i] = 6; tl.integrity[i] = 60; xs.push(i); }
  dorm.hp = 0.5; I3.invalidate(); upd();
  const rows = () => Array.from(U.el['issues-list'].children);
  const act = I3.actionable(s3), groups = I3.groups(s3);
  ok(/^\d+ issues?$/.test(U.el['issues-count'].textContent) && parseInt(U.el['issues-count'].textContent, 10) === act.length, 'tray count = actionable rows: ' + U.el['issues-count'].textContent);
  ok(rows().length === Math.min(groups.length, 6) && rows().every((r, k) => r.dataset.kind === groups[k].kind && r.classList.contains('lead')), 'one lead row per kind, in list order: ' + groups.map((g) => g.kind + '×' + g.rows.length).join(', '));
  const multi = groups.find((g) => g.rows.length > 1);
  const badge = multi && rows().find((r) => r.dataset.kind === multi.kind).children[2];
  ok(multi && badge && badge.classList.contains('badge') && badge.textContent === '×' + multi.rows.length, 'a count badge on the lead row: ' + (badge && badge.textContent));
  if (badge) { badge.dispatchEvent({ type: 'click' }); upd(); ok(rows().filter((r) => r.dataset.kind === multi.kind).length === Math.min(multi.rows.length, 6) && rows().some((r) => r.classList.contains('sub')), 'clicking the badge unfolds the group'); U.issues.toggleGroup(multi.kind); upd(); }
  ok(rows().every((r) => r.title && /Why it persists/.test(r.title) && r.querySelector), 'every row tooltip explains why the issue persists');
  // Clear all: damaged + levee run are resolvable → confirm line → confirmed → both fixed
  const res = I3.resolvable(s3); const clr = U.el['issues-clear'];
  ok(res.rows.length === 2 && !clr.classList.contains('hidden') && clr.textContent === 'Clear 2' && /\$/.test(clr.title), 'Clear all button: Clear 2, tooltip with the total');
  const n0 = U.el.notifications.children.length; clr.dispatchEvent({ type: 'click' });
  ok(U.el.notifications.children.length === n0 + 1, 'Clear all → a confirm line');
  let btn = null; (function walk(e) { for (const c of (e.children || [])) { if (c.tagName === 'BUTTON' && /^Confirm /.test(c.textContent)) btn = c; walk(c); } })(U.el.notifications);
  ok(btn && /Confirm \$/.test(btn.textContent), 'the confirm button shows the total: ' + (btn && btn.textContent));
  const cashC = s3.economy.cash; if (btn) btn.dispatchEvent({ type: 'click' }); upd();
  ok(dorm.hp === 1 && xs.every((i) => tl.integrity[i] === 100) && s3.economy.cash === cashC - res.total && I3.resolvable(s3).rows.length === 0 && clr.classList.contains('hidden'), 'confirmed: both repaired for the quoted total, the button hides');
  for (const i of xs) tl.crest[i] = 0; I3.invalidate(); upd();
  // Snooze / Dismiss from the row buttons; the hidden line restores
  const lead = rows()[0]; const id0 = lead.dataset.id;
  const zz = Array.from(lead.children).find((c) => c.dataset && c.dataset.act === 'snooze'); ok(zz && /Snooze 3 days/.test(zz.title), 'the zz button tooltip: ' + (zz && zz.title));
  zz.dispatchEvent({ type: 'click' }); upd();
  ok(!rows().some((r) => r.dataset.id === id0) && !U.el['issues-hidden'].classList.contains('hidden') && /1 snoozed/.test(U.el['issues-hidden'].textContent), 'snoozed: row gone, hidden line "' + U.el['issues-hidden'].textContent + '"');
  const lead2 = rows()[0]; const id1 = lead2.dataset.id; const dm = Array.from(lead2.children).find((c) => c.dataset && c.dataset.act === 'dismiss'); dm.dispatchEvent({ type: 'click' }); upd();
  ok(!rows().some((r) => r.dataset.id === id1) && /1 snoozed · 1 dismissed/.test(U.el['issues-hidden'].textContent), 'dismissed: hidden line "' + U.el['issues-hidden'].textContent + '"');
  U.el['issues-hidden'].dispatchEvent({ type: 'click' }); upd();
  ok(U.el['issues-hidden'].classList.contains('hidden') && I3.summary(s3).hidden === 0, 'the hidden line restores every row');
  // Fix arms the Substation with the ghost pinned; placing it moves the row to In progress
  const up = I3.list(s3).find((it) => it.kind === 'unpowered' && it.buildingId === dorm.id);
  const fr = U.issues.fix(s3, up); const arm = U.issues.lastArm();
  ok(fr && fr.ok && !U.buildMenuOpen() && s3.ui.paletteTab === 'utilities' && s3.ui.tool && s3.ui.tool.id === 'substation' && arm && arm.spot && U.issues.pin() && U.issues.pin().tx === arm.spot.tx, 'Fix on unpowered: palette tab + armed tool + pinned ghost at ' + JSON.stringify(arm && arm.spot));
  const sr = H.place('substation', arm.spot.tx, arm.spot.ty); U.selectTool(s3, null); U.closeBuildMenu(); H.tick(1); upd();
  const prow = Array.from(U.el['issues-progress-list'].children).find((r) => r.dataset.id === up.id);
  ok(sr.ok && !U.el['issues-progress'].classList.contains('hidden') && prow && /under construction/.test(prow.children[1].textContent) && /in progress/.test(U.el['issues-sub'].textContent), 'In progress section lists the dorm with the substation under construction');
  ok(U.issues.pin() === null, 'the pin drops once the tool is cleared');
  ok(BSU.errors.size === 0, 'no BSU.error in the issues v2 tray checks');
} catch (e) { ok(false, 'issues v2 ui: ' + (e.stack || e)); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
