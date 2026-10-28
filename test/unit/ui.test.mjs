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
ok(Buffer.byteLength(css) <= 76 * 1024, `style.css ≤ 76 KB (${(Buffer.byteLength(css) / 1024).toFixed(1)} KB)`);   // hud + zoom pass: the hud modes block (70 → 76 KB);   // gator pass: the chip ✕, the relocated strip beside an open inspect, Dismiss all, why-lines (68 → 70 KB);   // P6 dining menus: the inspect Menu section (64 → 68 KB); UX pass: build menu + tracker + coach marks (was 25 KB); football pass D: Season panel, game HUD, summary card (was 40 KB); UI scale pass: every length in rem + scale tokens (was 48 KB)
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
U.wheel(640, 360, 0, 120, true); ok(s.ui.camera.zoom === 0.8, 'ctrl+wheel down → zoom out one step: ' + s.ui.camera.zoom); U.update(s, 100); U.wheel(640, 360, 0, -120, true); U.update(s, 100); ok(s.ui.camera.zoom === 1, 'ctrl+wheel up → back to 1×');   // hud + zoom pass: nine steps, one per notch, ≥ 90 ms apart
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

// --- calm alerts + ambient gators pass: no gator chip / notification / fix; Alerts Normal / Quiet / Off; the mute bell; the Suggestions group; toast gating ----
try {
  const H = BSU.headless, I = BSU.issues;
  const txt = (e) => e ? (e.textContent || '') + Array.from(e.children || []).map(txt).join('') : '';   // the DOM stub's textContent is not recursive
  const cm = BSU.wildlife.campusMask(s); let ci = -1; for (let i = 0; i < cm.length; i++) if (cm[i]) { ci = i; break; }
  s.ui.tool = null; s.ui.panel = null; U.closeInspect(); U.closeBuildMenu(); U.closeCard(); U.dismissNotifs(); U.closeAlert(); U.setAlertMode('normal');
  const savedGators = s.gators.slice(); s.gators.length = 0;
  H.tick(2);
  // (a) a gator lounging on campus: no chip, no notification, no row, no fix; the inspect panel is a location
  const g = BSU.wildlife.spawnGator(s, ci, 'Chippy'); g.tx = ci % 64 + 0.5; g.ty = ((ci / 64) | 0) + 0.5; g.state = 'LOUNGE'; g.lounge = 100000;
  const n0 = U.el.notifications.children.length;
  H.tick(12); U.update(s, 600); U.update(s, 600);
  const strip = U.el['alert-strip'];
  ok(g.onCampus === true && (strip.classList.contains('hidden') || !/Chippy/.test(txt(strip))) && U.el.notifications.children.length === n0, 'a gator on campus raises no chip and no notification');
  ok(!I.all(s).some((it) => /^gator:/.test(it.id)) && typeof U.gatorAlerts !== 'function', 'no gator row, no gatorAlerts API');
  BSU.events.emit(BSU.EV.GATOR_BLOCKED, { id: g.id, name: 'Chippy', i: ci, what: 'closed', buildingId: 0, building: 'Tiger Dining', kind: 'dining hall' });
  BSU.events.emit(BSU.EV.GATOR_CALLOUT, { id: g.id, name: 'Chippy', arrived: true, fee: 15000 });
  U.update(s, 20); ok(U.el.notifications.children.length === n0, 'stray gator:blocked / gator:callout events (old listeners) produce nothing');
  U.inspect(s, { kind: 'gator', id: g.id }); U.update(s, 600);
  const body = txt(U.el['insp-body']), acts = Array.from(U.el['insp-actions'].children).map((c) => c.textContent);
  ok(/Doing/.test(body) && /On campus/.test(body) && !/Cost so far|Why it matters|Parish/.test(body), 'gator inspect: Doing + On campus, no cost / why rows');
  ok(acts.indexOf('Pan to') >= 0 && !acts.some((a) => /Parish|Relocate|Fence|Preserve/.test(a)), 'gator inspect actions: Pan to only');
  U.closeInspect(); U.update(s, 600);
  ok(U.el.tooltip.classList.contains('hidden') || !/Chippy/.test(txt(U.el.tooltip)), 'no name tag on campus entry');
  // (b) Settings → Alerts: three buttons, persisted; Off folds the tray to its pill; Quiet raises the beacon floor
  U.openPanel('settings'); U.update(s, 300);
  const bN = win.document.getElementById('btn-alerts-normal'), bQ = win.document.getElementById('btn-alerts-quiet'), bO = win.document.getElementById('btn-alerts-off');
  ok(bN && bQ && bO && bN.classList.contains('active') && U.alertMode() === 'normal' && U.issues.alertMode() === 'normal', 'Settings has Alerts Normal / Quiet / Off, Normal active');
  if (bO) bO.dispatchEvent({ type: 'click' }); U.update(s, 300);
  ok(U.settings().alerts === 'off' && U.alertMode() === 'off' && I.alertMode(s) === 'off' && I.beaconMin(s) === 4 && /"alerts":"off"/.test(win.localStorage.getItem('bsu.settings') || ''), 'Off: the setting is written and persisted');
  U.openPanel(null); U.update(s, 600); U.update(s, 600);
  ok(U.hudPill('issues') === true && U.el['issues-tray'].classList.contains('pill'), 'Off: the Issues tray is its count pill');
  ok(U.setAlertMode('quiet') === 'quiet' && I.beaconMin(s) === 3 && I.beacons(s, 32, 32).every((it) => it.severity >= 3), 'Quiet: beacons only from severity 3');
  U.update(s, 600); ok(U.hudPill('issues') === false, 'Quiet: the tray unfolds again');
  ok(U.setAlertMode('bogus') === 'quiet' && U.setAlertMode('normal') === 'normal' && I.beaconMin(s) === 2 && I.beacons(s, 32, 32).length <= 6, 'unknown modes refused; Normal: ≤ 6 beacons from severity 2');
  // (c) toasts: a confirm line always; an issue toast once per kind per week; never for a severity-1 kind (its onClose still runs); never under Off
  U.dismissNotifs(); const cnt = () => Array.from(U.el.notifications.children).filter((c) => c.id !== 'notif-dismiss').length;
  U.notify(s, { kind: 'money', confirm: true, text: 'Clear 2 issues for $5k total?', action: { label: 'Confirm', fn: function () {} } }); ok(cnt() === 1, 'a confirm line shows');
  U.dismissNotifs(); U.notify(s, { kind: 'water', text: 'Tiger Hall is flooded', locate: 'flood' }); const one = cnt(); U.notify(s, { kind: 'water', text: 'Roux Hall is flooded', locate: 'flood' });
  ok(one === 1 && cnt() === 1, 'one flood toast, the second (same kind, same week) is swallowed');
  let closedWhy = ''; U.dismissNotifs(); U.notify(s, { kind: 'wildlife', text: 'Mosquito warning: standing water on campus.', locate: 'mosquito', onClose: function (why) { closedWhy = why; } });
  ok(cnt() === 0 && closedWhy === 'gated', 'a mosquito (severity-1 kind) toast never shows; its onClose ran (' + closedWhy + ')');
  U.setAlertMode('off'); U.notify(s, { kind: 'danger', text: 'Blackout at Tiger Hall', locate: 'power' }); ok(cnt() === 0, 'Off: no issue toasts');
  U.notify(s, { kind: 'info', text: 'Saved' }); ok(cnt() === 1, '… plain feedback still shows'); U.dismissNotifs(); U.setAlertMode('normal');
  // (d) the mute bell on a lead row: the kind moves under Suggestions (collapsed), leaves Clear N and the beacons; persisted; the bell under Suggestions unmutes
  s.ui.tool = null; s.ui.panel = null; U.closeInspect(); U.closeBuildMenu(); U.closeCard(); U.closeAlert(); win.innerHeight = 1400;
  const cat = BSU.data.catalog; const pb = (s.buildings || []).find((b) => b && b.built >= 1 && !b.ruin && cat[b.type] && cat[b.type].needsPower);
  if (pb) pb.powered = false; I.invalidate(); U.update(s, 600); U.update(s, 600);
  const lead = U.el['issues-list'].children[0];
  const bell = lead ? Array.from(lead.children).find((c) => /bell/.test(c.className)) : null;
  ok(!!lead && !!bell && bell.textContent === '🔔', 'a lead row carries the mute bell (' + (lead && lead.dataset.kind) + ')');
  const mk = lead ? lead.dataset.kind : 'unpowered';
  if (bell) bell.dispatchEvent({ type: 'click' }); U.update(s, 600); U.update(s, 600);
  ok(U.settings().mutedIssues && U.settings().mutedIssues[mk] === true && I.muted(s, mk) && /"mutedIssues":\{[^}]*"[a-zA-Z]+":true/.test(win.localStorage.getItem('bsu.settings') || ''), 'the bell writes settings.mutedIssues (persisted)');
  ok(I.suggestions(s).some((it) => it.kind === mk) && !I.main(s).some((it) => it.kind === mk) && !I.beacons(s, 32, 32).some((it) => it.kind === mk) && I.resolvable(s).rows.every((it) => it.kind !== mk && !it.suggestion), 'a muted kind: a suggestion, no beacon, never in Clear N');
  ok(Array.from(U.el['issues-list'].children).every((r) => r.dataset.kind !== mk) && !U.el['issues-suggest'].classList.contains('hidden') && /Suggestions · \d+/.test(U.el['issues-suggest-head'].textContent) && U.el['issues-suggest-list'].children.length === 0, 'the row left the main list; the Suggestions group is collapsed with a count');
  U.issues.toggleSuggestions(true); U.update(s, 600); U.update(s, 600);
  const srow = Array.from(U.el['issues-suggest-list'].children).find((r) => r.dataset.kind === mk);
  const sbell = srow ? Array.from(srow.children).find((c) => /bell/.test(c.className)) : null;
  ok(!!srow && srow.classList.contains('suggest') && !!sbell && sbell.textContent === '🔕', 'unfolded: the muted row sits under Suggestions with an unmute bell');
  if (sbell) sbell.dispatchEvent({ type: 'click' }); U.update(s, 600); U.update(s, 600);
  ok(!I.muted(s, mk) && !U.settings().mutedIssues[mk] && I.main(s).some((it) => it.kind === mk), 'the unmute bell restores the kind');
  U.issues.toggleSuggestions(false); if (pb) pb.powered = true; I.invalidate(); U.dismissNotifs(); win.innerHeight = 800;
  // (e) severity-1 kinds are suggestions whatever happens; "Clear N" never counts them
  ok(I.suggestions(s).every((it) => it.suggestion && (I.kinds()[it.kind].severity <= 1 || I.muted(s, it.kind))) && I.resolvable(s).rows.every((it) => !it.suggestion), 'suggestions = severity-1 kinds + muted kinds; Clear N excludes them');
  s.gators.length = 0; for (const x of savedGators) s.gators.push(x); I.invalidate(); U.closeAlert();
} catch (e) { ok(false, 'calm alerts ui: ' + (e.stack || e)); }

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

// --- hud + zoom pass: HUD modes (H / Shift+H), per-element pills, the tutorial opening what it points at, the wheel ----------
try {
  const sH = BSU.state; U.showTitle(false); U.settings().coachSeen = true; U.openPanel(null); if (U.buildMenuOpen()) U.closeBuildMenu();
  const MH = { ctrl: false, shift: false, meta: false, alt: false };
  const lsHud = () => { try { return JSON.parse(win.localStorage.getItem('bsu.settings')); } catch (e) { return null; } };
  U.setHudMode('full'); for (const k of ['goals', 'needs', 'minimap', 'issues', 'palette']) U.hudCollapse(k, false);
  U.update(sH, 300);
  ok(U.hudMode() === 'full' && U.el.hud.dataset.hud === 'full' && U.hudModes().join(',') === 'full,compact,hidden', 'HUD starts full; the three modes come from params.ui.hudModes');
  ok(['hud-chip', 'hud-chev-goals', 'hud-chev-needs', 'hud-chev-minimap', 'hud-chev-palette', 'hud-pill-goals', 'hud-pill-needs', 'hud-pill-minimap', 'hud-pill-palette'].every((id) => U.el[id] && U.el[id].id === id) && U.el['hud-chip'].parentNode === U.el.hud, 'hud modes skeleton: the chip, four chevrons, four pills (the issues tray keeps its caret)');
  ok(U.keydown('h', MH) === true && U.hudMode() === 'compact', 'H → compact');
  U.update(sH, 300);
  ok(U.el.hud.dataset.hud === 'compact' && ['goals', 'needs', 'minimap', 'issues', 'palette'].every((k) => U.hudPill(k)) && U.el.hud.classList.contains('pal-pill'), 'compact: every part is a pill (and the palette pill lowers --palette-h)');
  ok(lsHud() && lsHud().hudMode === 'compact' && U.settings().hudMode === 'compact', 'the mode persists in settings + localStorage');
  ok(U.keydown('h', MH) === true && U.hudMode() === 'hidden', 'H → hidden');
  U.update(sH, 300);
  ok(U.el.hud.dataset.hud === 'hidden' && !U.el['hud-chip'].classList.contains('hidden') && !U.hudPill('goals'), 'hidden: the "HUD hidden · H" chip shows (the CSS hides the rest; no pill classes)');
  U.decision(sH, { id: 'hudq', text: 'Still answerable?', ticks: 80 }); U.update(sH, 50);
  ok(!U.el['decision-toast'].classList.contains('hidden') && U.keydown('y', MH) === true && U.el['decision-toast'].classList.contains('hidden'), 'a decision toast still shows and answers in hidden mode');
  ok(U.keydown('h', MH) === true && U.hudMode() === 'full', 'H → full again (the cycle closes)');
  U.keydown('h', MH); U.keydown('h', MH); ok(U.hudMode() === 'hidden' && U.keydown('H', { ctrl: false, shift: true, meta: false, alt: false }) === true && U.hudMode() === 'full', 'Shift+H jumps straight back to full');
  U.el['hud-chip'].dispatchEvent({ type: 'click' }); ok(U.hudMode() === 'full', 'the chip click is a no-op in full; ');
  U.setHudMode('hidden'); U.el['hud-chip'].dispatchEvent({ type: 'click' }); ok(U.hudMode() === 'full', 'clicking the chip restores the full HUD');
  ok(U.setHudMode('junk') === 'full' && U.hudMode() === 'full', 'an unknown mode is refused');
  ok(U.keydown('Home', MH) === true, 'Home pans to Founders\' Hall (H is the HUD now)');
  // per-element collapse in full mode
  ok(U.hudCollapse('goals', true) === true && U.hudPill('goals') && U.el['objective-card'].classList.contains('pill') && U.settings().hudCollapsed.goals === true && lsHud().hudCollapsed.goals === true, 'hudCollapse(goals) folds the tracker to its pill and remembers it');
  U.update(sH, 300);
  ok(/^Goal/.test(U.el['hud-pill-goals-text'].textContent), 'the goals pill reads "Goal …" (' + U.el['hud-pill-goals-text'].textContent + ')');
  U.el['hud-pill-goals'].dispatchEvent({ type: 'click' }); ok(!U.hudPill('goals') && U.settings().hudCollapsed.goals === false, 'clicking the pill expands it again');
  U.el['hud-chev-goals'].dispatchEvent({ type: 'click' }); ok(U.hudPill('goals') && U.settings().hudCollapsed.goals === true, 'the chevron folds it');
  U.el['objective-card'].dispatchEvent({ type: 'mouseenter' }); ok(!U.hudPill('goals') && U.el['objective-card'].classList.contains('peek'), 'hovering a pill peeks it open');
  U.el['objective-card'].dispatchEvent({ type: 'mouseleave' }); ok(U.hudPill('goals'), 'leaving closes the peek (still collapsed)');
  U.hudCollapse('goals', false);
  U.el['hud-chev-minimap'].dispatchEvent({ type: 'click' }); ok(U.hudPill('minimap') && U.settings().hudCollapsed.minimap === true, 'minimap chevron'); U.hudCollapse('minimap', false);
  U.el['issues-toggle'].dispatchEvent({ type: 'click' }); ok(U.hudPill('issues') && U.settings().hudCollapsed.issues === true, 'the issues caret is the tray\'s collapse (remembered)'); U.hudCollapse('issues', false);
  U.el['hud-chev-palette'].dispatchEvent({ type: 'click' }); U.update(sH, 50); ok(U.hudPill('palette') && U.el.hud.classList.contains('pal-pill') && U.settings().hudCollapsed.palette === true, 'palette chevron folds the quick-bar to the Build pill');
  ok(U.keydown('g', MH) === true && U.buildMenuOpen(), 'G still opens the build menu with the palette folded'); U.closeBuildMenu(); U.hudCollapse('palette', false); U.update(sH, 50);
  ok(!U.el.hud.classList.contains('pal-pill'), 'pal-pill clears when the palette is back');
  const st = U.hudState(); ok(st.mode === 'full' && st.effective === 'full' && Object.keys(st.collapsed).length === 5 && Object.values(st.pill).every((v) => v === false), 'hudState() summarises mode / collapsed / pills');
  // the coach-mark tour opens what it points at and restores afterwards
  U.setHudMode('hidden'); U.hudCollapse('goals', true); U.hudCollapse('needs', true); U.update(sH, 300);
  U.startCoach(sH, { now: true }); U.update(sH, 50);
  ok(U.coachStep() === 0 && U.hudState().effective === 'full' && U.el.hud.dataset.hud === 'full' && U.settings().hudMode === 'hidden', 'the tour runs in the full HUD without touching the hidden setting');
  ok(U.hudPill('goals') === true, 'step 0 (stats) leaves the collapsed tracker folded');
  U.keydown('Enter', MH); U.update(sH, 50);
  ok(U.coachStep() === 1 && U.hudPill('goals') === false && U.settings().hudCollapsed.goals === true, 'the goals step opens the folded tracker for the step (setting untouched)');
  U.keydown('Enter', MH); U.keydown('Enter', MH); U.keydown('Enter', MH); U.update(sH, 50);
  ok(U.coachStep() === 4 && U.hudPill('goals') === false && U.hudPill('needs') === false, 'the needs step opens both the tracker and the needs strip');
  U.keydown('ArrowLeft', MH); U.update(sH, 50);
  ok(U.coachStep() === 3 && U.hudPill('goals') === true && U.hudPill('needs') === true, 'back on the place step both fold again');
  U.keydown('Escape', MH); U.update(sH, 300); if (U.buildMenuOpen()) U.closeBuildMenu(); U.update(sH, 50);
  ok(U.coachStep() === -1 && U.hudState().effective === 'hidden' && U.el.hud.dataset.hud === 'hidden' && U.settings().hudCollapsed.goals === true && U.settings().hudCollapsed.needs === true, 'after the tour the hidden mode and both folds are back');
  U.setHudMode('full'); U.update(sH, 50); ok(U.hudPill('goals') && U.hudPill('needs'), 'back in full the remembered folds apply');
  U.hudCollapse('goals', false); U.hudCollapse('needs', false); U.settings().coachSeen = true; U.saveSettings();
  // Settings → HUD row
  U.openPanel('settings'); const bh = win.document.getElementById('btn-hud-compact');
  ok(bh && win.document.getElementById('btn-hud-full') && win.document.getElementById('btn-hud-hidden'), 'Settings has the HUD row (Full / Compact / Hidden)');
  bh.dispatchEvent({ type: 'click' }); ok(U.hudMode() === 'compact' && bh.classList.contains('active') && !win.document.getElementById('btn-hud-full').classList.contains('active'), 'the Compact button writes the mode and goes active');
  win.document.getElementById('btn-hud-full').dispatchEvent({ type: 'click' }); U.openPanel(null); ok(U.hudMode() === 'full', 'Full restores');
  // the wheel: one step per notch at the cursor, coalesced; sideways scroll pans; + zooms in
  const R2 = BSU.render; const cam = sH.ui.camera; R2.setZoom(1); R2.panTo(0, 1024, false); U.update(sH, 300);
  const vw = R2.view.vw, vh = R2.view.vh, ax = 900, ay = 200;
  const under = () => ({ x: (ax - vw / 2) / cam.zoom + cam.x, y: (ay - vh / 2) / cam.zoom + cam.y });
  const w0 = under(); U.wheel(ax, ay, 0, -100, false); const w1 = under();
  ok(cam.zoom === 1.25 && Math.abs(w1.x - w0.x) * cam.zoom < 0.5 && Math.abs(w1.y - w0.y) * cam.zoom < 0.5, 'a plain wheel notch up zooms in one step AT THE CURSOR (world point fixed within 0.5 px)');
  U.wheel(ax, ay, 0, -100, false); ok(cam.zoom === 1.25, 'a second notch inside 90 ms is coalesced');
  U.update(sH, 100); U.wheel(ax, ay, 0, -100, false); ok(cam.zoom === 1.5, 'after 100 ms the next notch steps again');
  U.update(sH, 100); U.wheel(ax, ay, 0, 10, false); ok(cam.zoom === 1.5, 'a 10-px trackpad tick accumulates (no step yet)');
  U.wheel(ax, ay, 0, 15, false); U.wheel(ax, ay, 0, 20, false); ok(cam.zoom === 1.25, '45 px of ticks make one notch down');
  U.update(sH, 300); const cx0 = cam.x; U.wheel(ax, ay, 80, 10, false); ok(cam.zoom === 1.25 && cam.x !== cx0, 'a sideways two-finger scroll still pans');
  U.update(sH, 300); ok(U.keydown('+', { ctrl: false, shift: true, meta: false, alt: false }) === true && cam.zoom === 1.5 && U.keydown('-', MH) === true && cam.zoom === 1.25 && U.keydown('=', MH) === true && cam.zoom === 1.5, '+ / = / − step the zoom');
  R2.setZoom(1); U.update(sH, 300);
  ok(BSU.errors.size === 0, 'no BSU.error in the hud + zoom checks');
} catch (e) { ok(false, 'hud + zoom ui: ' + (e.stack || e)); }

// --- paths pass (Track P): the ghost's tie + status lines, Alt = no tie, the first-tie card once, the tie refusal's Show me, the inspect pill + Link it, N hold / tap, the drag end's tie ----
try {
  BSU.session.newGame({ seed: 42, skipTutorial: true });
  const s = BSU.state; U.showTitle(false); U.settings().coachSeen = true; U.settings().tieCardSeen = false; s.economy.cash = 50e6;
  const B = BSU.buildings, R = BSU.render, H = BSU.headless; win.innerHeight = 1400;
  s.ui.tool = null; s.ui.panel = null; U.closeInspect(); U.closeBuildMenu(); U.closeCard(); U.dismissNotifs(); U.closeAlert();
  H.tick(5); H.render(); U.update(s, 300);
  const TIE = B.TIE_REASON, MS = { ctrl: false, shift: true, meta: false, alt: false }, MA = { ctrl: false, shift: true, meta: false, alt: true };
  const l1 = () => U.el['ghost-l1'].textContent, l2 = () => U.el['ghost-l2'].textContent;
  ok(typeof U.networkView === 'function' && typeof U.keyup === 'function' && typeof R.tiePreview === 'function' && typeof R.tiePreviewSpec === 'function', 'API: ui.networkView / ui.keyup / render.tiePreview');
  ok(U.settings().tieCardSeen === false && 'tieCardSeen' in BSU.newState(1).ui.settings, 'settings.tieCardSeen defaults false');
  // a dining hall spot with a 2–8 tile tie
  const f = s.plot.founders; let spot = null;
  for (let ty = f.ty - 14; ty <= f.ty + 14 && !spot; ty++) for (let tx = f.tx - 14; tx <= f.tx + 14; tx++) { const r = B.canPlace(s, 'dining_hall', tx, ty, { rot: 0 }); if (r.ok && r.connector && r.connector.tiles.length >= 2 && r.connector.tiles.length <= 8 && r.color === 'green') { spot = { tx, ty, r }; break; } }
  ok(!!spot, 'a dining hall spot with a tie exists near the plot' + (spot ? ' (' + spot.tx + ',' + spot.ty + ': ' + spot.r.connector.tiles.length + ' tiles)' : ''));
  if (spot) {
    U.selectTool(s, 'dining_hall');
    const px = R.tileToScreen(spot.tx, spot.ty);
    U.pointer('move', px.x, px.y, 0, MS);   // Shift: flush, no setback snap
    const tp = R.tiePreviewSpec();
    ok(tp && tp.tiles.join() === spot.r.connector.tiles.join() && Array.isArray(tp.surfaces), 'the ghost hands render_fx the tie preview (dashed gold): ' + JSON.stringify(tp && tp.tiles));
    ok(/\+ \$[\d,.]+k? tie$/.test(l1()) || / \+ \$.* tie/.test(l1()), 'price line "$500k + $6k tie": ' + l1());
    ok(/^Ties in \(\+\$[\d,.]+k?, \d+ tiles?\)/.test(l2()), 'status line "Ties in (+$6k, 3 tiles)": ' + l2());
    ok(R.ghostSpec && R.ghostSpec.connectorTiles === null, 'render.ghost no longer fills the tie green (render_fx draws it)');
    // Alt = no tie
    ok(U.keydown('Alt', M0) === false && R.tiePreviewSpec() === null && /^No tie \(Alt held\)/.test(l2()) && !/tie/.test(l1()), 'Alt held: no tie preview, the status says what is skipped: ' + l2());
    U.keyup('Alt'); ok(R.tiePreviewSpec() !== null && /^Ties in/.test(l2()), 'Alt released: the tie is back');
    // place: the tie is laid, the first-time card shows once
    const n0 = s.buildings.filter(Boolean).length, cash0 = s.economy.cash;
    U.pointer('down', px.x, px.y, 0, MS); U.pointer('up', px.x, px.y, 0, MS);
    const b1 = s.buildings[s.buildings.length - 1];
    ok(s.buildings.filter(Boolean).length === n0 + 1 && b1 && b1.type === 'dining_hall' && s.economy.cash === cash0 - spot.r.cost - spot.r.connector.cost, 'placed with the tie in one purchase (' + (cash0 - s.economy.cash) + ')');
    ok(spot.r.connector.tiles.every((t) => s.tiles.surface[t] !== BSU.SURF.NONE), 'the tie is on the ground');
    ok(l1() === 'Occupied', 'Shift kept the tool: the ghost re-reads the taken spot (the placed label is covered by the drag flow below)');
    ok(!U.el.cards.classList.contains('hidden') && U.el.cards.children[0] && U.el.cards.children[0].id === 'card-firstTie' && /^Tied in: \d+ tiles? of gravel, \$/.test(U.el.cards.children[0].children[1].textContent) && U.settings().tieCardSeen === true, 'the first auto-tie opens the one-time card (flag persisted): ' + (U.el.cards.children[0] && U.el.cards.children[0].children[1].textContent));
    U.keydown('Enter', M0); ok(U.el.cards.classList.contains('hidden'), 'Got it closes it');
    U.selectTool(s, null); U.closeInspect();
    // a second tie: no card
    let spot2 = null;
    for (let ty = f.ty - 14; ty <= f.ty + 14 && !spot2; ty++) for (let tx = f.tx - 14; tx <= f.tx + 14; tx++) { const r = B.canPlace(s, 'dorm', tx, ty, { rot: 0 }); if (r.ok && r.connector && r.connector.tiles.length >= 2 && r.color === 'green') { spot2 = { tx, ty, r }; break; } }
    if (spot2) { U.selectTool(s, 'dorm'); const p2 = R.tileToScreen(spot2.tx, spot2.ty); U.pointer('move', p2.x, p2.y, 0, MS); U.pointer('down', p2.x, p2.y, 0, MS); U.pointer('up', p2.x, p2.y, 0, MS); ok(U.el.cards.classList.contains('hidden'), 'the second tie shows no card'); U.selectTool(s, null); U.closeInspect(); }
    else ok(true, 'no second tie spot (skipped)');
    // Alt-placed building: unlinked → the inspect pill + Link it
    let spot3 = null;
    for (let ty = f.ty - 14; ty <= f.ty + 14 && !spot3; ty++) for (let tx = f.tx - 14; tx <= f.tx + 14; tx++) { const r = B.canPlace(s, 'dorm', tx, ty, { rot: 0, noTie: true }); if (r.ok && r.tieSkipped && r.tieSkipped.tiles.length >= 2 && r.color === 'green') { spot3 = { tx, ty, r }; break; } }
    ok(!!spot3, 'a dorm spot with a skippable tie exists');
    if (spot3) {
      U.selectTool(s, 'dorm'); const p3 = R.tileToScreen(spot3.tx, spot3.ty);
      U.pointer('move', p3.x, p3.y, 0, MA); ok(/^No tie \(Alt held\)/.test(l2()) && R.tiePreviewSpec() === null, 'pointer mods.alt → no tie');
      const paths0 = (() => { let n = 0; for (let i = 0; i < 4096; i++) if (s.tiles.surface[i] === BSU.SURF.PATH) n++; return n; })();
      U.pointer('down', p3.x, p3.y, 0, MA); U.pointer('up', p3.x, p3.y, 0, MA);
      const b3 = s.buildings[s.buildings.length - 1];
      const paths1 = (() => { let n = 0; for (let i = 0; i < 4096; i++) if (s.tiles.surface[i] === BSU.SURF.PATH) n++; return n; })();
      ok(b3 && b3.type === 'dorm' && paths1 === paths0 && B.linkQuote(s, b3.id).ok, 'Alt-click placed the dorm with no gravel: it is unlinked');
      U.selectTool(s, null); U.pointer('move', p3.x, p3.y, 0, M0);
      U.inspect(s, { kind: 'building', id: b3.id });
      const pill = U.el['insp-body'].children.find((c) => c.id === 'insp-netpill');
      ok(!!pill && pill.textContent === 'Not connected' && pill.classList.contains('grey') && U.el['insp-body'].children[0] === pill, 'inspect card: a grey "Not connected" pill first in the body');
      const linkBtn = U.el['insp-actions'].children.find((c) => /^Link it/.test(c.textContent));
      ok(!!linkBtn && /^Link it · \$/.test(linkBtn.textContent) && !U.el['insp-actions'].children.some((c) => /Link to campus/.test(c.textContent)), 'the action reads "Link it · $N": ' + (linkBtn && linkBtn.textContent));
      const cashL = s.economy.cash; linkBtn.dispatchEvent({ type: 'click' });
      ok(B.linkQuote(s, b3.id).reason === 'Already linked' && s.economy.cash < cashL, 'Link it lays the tie from the inspect card');
      U.inspect(s, { kind: 'building', id: b3.id });
      ok(!U.el['insp-body'].children.some((c) => c.id === 'insp-netpill') && !U.el['insp-actions'].children.some((c) => /^Link it/.test(c.textContent)), 'linked: the pill and the button are gone');
      U.closeInspect();
    }
  }
  // the tie refusal: a dorm far from every path → the P2 reason on the ghost, a Show me toast on the click
  s.ui.tool = null; U.closeInspect(); U.dismissNotifs();
  let farSpot = null;
  for (let ty = 2; ty < 62 && !farSpot; ty++) for (let tx = 2; tx < 62; tx++) { const r = B.canPlace(s, 'dorm', tx, ty, { rot: 0 }); if (!r.ok && r.reason === TIE && r.nearest && !(s.plot.cove || []).includes(ty * 64 + tx)) { farSpot = { tx, ty, r }; break; } }
  ok(!!farSpot && B.tieEnforced(s), 'a refused far spot exists while the window is open' + (farSpot ? ' (' + farSpot.tx + ',' + farSpot.ty + ')' : ''));
  if (farSpot) {
    U.selectTool(s, 'dorm'); const pf = R.tileToScreen(farSpot.tx, farSpot.ty); U.pointer('move', pf.x, pf.y, 0, MS);
    ok(l1() === TIE && /Hold N/.test(l2()) && U.el['ghost-label'].dataset.color === 'red', 'ghost: "' + l1() + '" / ' + l2());
    const nb = U.el.notifications.children.length;
    U.pointer('down', pf.x, pf.y, 0, MS); U.pointer('up', pf.x, pf.y, 0, MS);
    const deepText = (el) => !el ? '' : ((el.textContent || '') + ' ' + (Array.isArray(el.children) ? el.children.map(deepText).join(' ') : ''));
    const toast = Array.from(U.el.notifications.children).find((c) => /Can't reach a path/.test(deepText(c)));
    const hasShowMe = (el) => !!el && (el.textContent === 'Show me' || (Array.isArray(el.children) && el.children.some(hasShowMe)));
    ok(U.el.notifications.children.length > nb && !!toast && hasShowMe(toast), 'the refused click raises a toast with Show me: ' + deepText(toast).trim());
    U.selectTool(s, null); U.dismissNotifs();
  }
  // N: hold = the network view, a tap opens the Season panel on release
  s.ui.panel = null;
  ok(U.networkView() === false, 'no network view at rest');
  ok(U.keydown('n', M0) === true && U.networkView() === true && s.ui.panel === null, 'N down: network view on, no panel yet');
  U.update(s, 16); U.update(s, 16);
  U.keyup('n'); ok(U.networkView() === false && s.ui.panel === 'season', 'a quick release: the Season panel (tap)');
  U.openPanel(null);
  U.keydown('n', M0); U.update(s, 300); U.update(s, 300); U.keyup('n'); ok(U.networkView() === false && s.ui.panel === null, 'a long hold: no panel');
  U.keydown('n', M0); U.keydown('n', { ctrl: false, shift: false, meta: false, alt: false, repeat: true }); U.update(s, 16); U.keyup('n'); ok(s.ui.panel === null, 'a key repeat marks the hold: no panel'); U.openPanel(null);
  U.selectTool(s, 'path'); ok(U.networkView() === true, 'the path tool armed: network view'); U.selectTool(s, 'dorm'); ok(U.networkView() === false, 'a footprint tool: not'); U.selectTool(s, null);
  // the tray's Not linked suggestion reads Link it
  ok(/unlinkedPath' \? 'Link it' : 'Fix'/.test(src), "the tray's unlinkedPath row button reads Link it");
  // a path drag ending short of the network: the tie preview during the drag, laid with the run on one undo record
  // (a straight lane of nine free tiles off a connected path tile, cleared to dry ground at that tile's height so the run and its tie are legal)
  let drag = null;
  const conn = B.connectedMask(s);
  const freeTile = (x, y) => BSU.inBounds(x, y) && s.tiles.owner[y * 64 + x] === -1 && s.tiles.crest[y * 64 + x] === 0 && !conn[y * 64 + x] && !(s.plot.cove || []).includes(y * 64 + x);
  for (let i = 0; i < 4096 && !drag; i++) {
    if (!conn[i]) continue; const cx = i & 63, cy = i >> 6;
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      let good = true; for (let k = 1; k <= 9; k++) { const x = cx + dx * k, y = cy + dy * k; if (!freeTile(x, y) || BSU.nbr4(y * 64 + x).some((n) => conn[n] && n !== i && k > 1)) { good = false; break; } }
      if (!good) continue;
      for (let k = 1; k <= 9; k++) { const j = (cy + dy * k) * 64 + cx + dx * k; s.tiles.type[j] = BSU.T.DRY; s.tiles.elev[j] = s.tiles.elev[i]; s.tiles.flags[j] = 0; if (s.tiles.surface[j] !== BSU.SURF.NONE) BSU.terrain.setSurface(s, j, BSU.SURF.NONE); }
      BSU.terrain.rewalk(s); B.tick(s, {});
      let legal = true; for (let k = 1; k <= 9; k++) if (!B.canPlace(s, 'path', cx + dx * k, cy + dy * k, { ignoreCash: true }).ok) { legal = false; break; }
      const run = [4, 5, 6, 7, 8, 9].map((k) => (cy + dy * k) * 64 + cx + dx * k);
      const rt = legal ? B.runTie(s, 'path', run) : null;
      if (rt && rt.tiles.length === 3 && !B.runTouches(s, run)) { drag = { from: { x: cx + dx * 4, y: cy + dy * 4 }, to: { x: cx + dx * 9, y: cy + dy * 9 }, tie: 3, run: run }; break; }
    }
  }
  ok(!!drag, 'a straight 9-tile lane off a connected tile exists' + (drag ? ' from (' + drag.from.x + ',' + drag.from.y + ') to (' + drag.to.x + ',' + drag.to.y + ')' : ''));
  if (drag) { const rtd = B.runTie(s, 'path', drag.run); ok(rtd && rtd.tiles.length === 3 && !rtd.snap, 'buildings.runTie on the lane run: a 3-tile tie (' + JSON.stringify(rtd) + ')'); }
  if (drag) {
    U.selectTool(s, 'path');
    const a = R.tileToScreen(drag.from.x, drag.from.y), b = R.tileToScreen(drag.to.x, drag.to.y);
    U.pointer('move', a.x, a.y, 0, M0); U.pointer('down', a.x, a.y, 0, M0); U.pointer('move', b.x, b.y, 0, M0);
    ok(U.state === 'DRAGGING' && U.el['ghost-l1'] && / tiles · \$[\d,.]+k? \+ \$[\d,.]+k? tie$/.test(l1()) && /^Ties in \(\+\$[\d,.]+k?, 3 tiles\)/.test(l2()), 'dragging: "' + l1() + '" / "' + l2() + '"');
    const tp = R.tiePreviewSpec(); ok(tp && tp.tiles.length === 3 && tp.snap === false, 'a 3-tile tie preview during the drag');
    const cashD = s.economy.cash;
    U.pointer('up', b.x, b.y, 0, M0);
    const info = B.undoInfo(s);
    ok(info && info.n === 6 && info.connector === 3 && /Gravel/.test(info.name) && s.economy.cash === cashD - 9 * 2000, 'released: 6 tiles + a 3-tile tie on one record, $18k: ' + JSON.stringify(info));
    ok(l1() === 'Already a path', 'after the release the ghost re-reads the tile under the cursor (the placed label is transient, as before)');
    ok(tp.tiles.every((t) => s.tiles.surface[t] === BSU.SURF.PATH) && B.connectedMask(s)[drag.to.y * 64 + drag.to.x] === 1, 'the tie is laid and the run is connected');
    ok(U.keydown('z', { ctrl: true, shift: false, meta: false, alt: false }) === true && s.economy.cash === cashD && tp.tiles.every((t) => s.tiles.surface[t] === BSU.SURF.NONE), 'Ctrl+Z takes the run and the tie back');
    // the snap: the same lane dragged from 2 tiles short of the network
    const snapRun = drag.run.slice(); const step = drag.run[1] - drag.run[0]; const s0 = drag.run[0] - 2 * step, s1 = drag.run[0] - step;
    const rtS = B.runTie(s, 'path', [s0, s1].concat(snapRun));
    ok(rtS === null || (rtS.snap === true && rtS.tiles.length <= 2), 'a run starting 2 short: a snap (' + JSON.stringify(rtS && rtS.tiles) + ')');
    const sa = R.tileToScreen(s0 & 63, s0 >> 6);
    U.pointer('move', sa.x, sa.y, 0, M0); U.pointer('down', sa.x, sa.y, 0, M0); U.pointer('move', b.x, b.y, 0, M0);
    ok(U.state === 'DRAGGING' && (/snap$/.test(l1()) || /^Connected/.test(l2())) && (/^Snaps onto the network/.test(l2()) || /^Connected/.test(l2())), 'dragging from 2 short: "' + l1() + '" / "' + l2() + '"');
    U.pointer('up', b.x, b.y, 0, M0);
    ok(B.connectedMask(s)[drag.to.y * 64 + drag.to.x] === 1, 'released: the run is connected');
    U.keydown('z', { ctrl: true, shift: false, meta: false, alt: false });
    U.selectTool(s, null);
  }
  s.ui.tool = null; U.closeInspect(); U.closeCard(); U.dismissNotifs();
} catch (e) { ok(false, 'paths pass ui: ' + (e.stack || e)); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
