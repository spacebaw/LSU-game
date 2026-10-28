// Unit test for src/js/issues.js (issue spotlight pass): loads every manifest module through makeWindow()
// from test/domstub.mjs (session.js boots the game), starts a real game, places a dorm with no substation
// (→ an unpowered issue with the right fix text), forces a hurricane (→ flooded issues), checks selection
// cycling, the beacon / arrow / label passes and their caps at 1× and 2×, spotlight mode, perf mode, the
// minimap pips and the Issues tray in ui.js. Usage: node test/unit/issues.test.mjs   (exit 1 on any failure)
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
const src = readFileSync(join(root, 'src', 'js', 'issues.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
ok(!/document\.|window\.addEventListener|innerHTML|performance\.now|Date\.now/.test(src), 'no DOM, no clocks (deterministic: state in, objects out)');
ok(!/setTimeout|setInterval|requestAnimationFrame/.test(src.replace(/\/\/.*$/gm, '')), 'no timers');
ok(Buffer.byteLength(src) <= 40 * 1024, `issues.js ≤ 40 KB (${(Buffer.byteLength(src) / 1024).toFixed(1)} KB)`);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
ok(manifest.indexOf('issues.js') === manifest.indexOf('buildings.js') + 1 && manifest.indexOf('issues.js') < manifest.indexOf('render.js') && manifest.indexOf('issues.js') < manifest.indexOf('ui.js'), 'manifest: issues.js right after buildings.js, before render/ui');

// --- load every existing module in manifest order ----------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
for (const f of manifest) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); } catch (e) { ok(false, `load ${f}: ${e.message}`); }
}
const BSU = win.BSU;
const I = BSU.issues, R = BSU.render, U = BSU.ui, H = BSU.headless;
ok(I && typeof I.list === 'function' && typeof I.cycle === 'function' && typeof I.spotlight === 'function' && typeof I.selfTest === 'function', 'BSU.issues API present');
const K = I.kinds();
const KIND_NAMES = ['unpowered', 'unwatered', 'flooded', 'damaged', 'unlinkedPath', 'weakLevee', 'overCapacity', 'gatorOnCampus', 'mosquitoHotspot', 'boilWater', 'brownout', 'pumpOff'];
ok(KIND_NAMES.every((k) => K[k] && /^#[0-9A-F]{6}$/.test(K[k].color) && K[k].glyph && K[k].severity >= 1 && K[k].severity <= 3), 'all 12 kinds with colour / glyph / severity');
ok(K.unpowered.color === '#FFB03B' && K.unwatered.color === '#4FC3F7' && K.flooded.color === '#2BD4C0' && K.damaged.color === '#FF5A4F' && K.gatorOnCampus.color === '#7CFF6B' && K.unlinkedPath.color === '#FDD023' && K.mosquitoHotspot.color === '#C77DFF' && K.weakLevee.color === '#FF8C42', 'the brief\'s colours per kind');
// the beacon colours are used nowhere else in the game (gold is the brand colour: allowed for the path kind)
const allSrc = manifest.filter((f) => f !== 'issues.js').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n') + readFileSync(join(root, 'src', 'style.css'), 'utf8');
for (const k of ['unpowered', 'unwatered', 'flooded', 'damaged', 'gatorOnCampus', 'mosquitoHotspot', 'weakLevee', 'overCapacity']) ok(allSrc.toUpperCase().indexOf(K[k].color.toUpperCase()) < 0, `${K[k].color} (${k}) appears in no other module or the CSS`);

// --- a real game: a dorm with no substation ------------------------------------
const errors0 = BSU.errors.size;
BSU.session.newGame({ seed: 42, skipTutorial: true });
const s = BSU.state; U.showTitle(false); U.settings().coachSeen = true;
H.tick(20); H.render();
const base = I.list(s);
ok(Array.isArray(base), `fresh campus lists ${base.length} issue(s): ${base.map((it) => it.kind).join(',') || 'none'}`);
const spot = H.findSpot('dorm');
ok(!!spot, 'findSpot(dorm)');
let dormId = -1;
if (spot) {
  const r = H.place('dorm', spot.x, spot.y); ok(r && r.ok !== false && Number.isFinite(r.id), 'dorm placed');
  dormId = r && Number.isFinite(r.id) ? r.id : (s.buildings.length - 1);
  const b = BSU.buildings.get(s, dormId); if (b) { b.built = 1; b.powered = false; b.watered = false; }
  try { BSU.buildings.recomputeCoverage(s); } catch (e) { /* */ }
  const b2 = BSU.buildings.get(s, dormId);
  I.invalidate(); const l = I.list(s);
  const up = l.find((it) => it.kind === 'unpowered' && it.buildingId === dormId);
  ok(!!up, 'the dorm with no substation is an unpowered issue (powered=' + (b2 && b2.powered) + ')');
  if (up) {
    ok(up.fix === 'No power: place a Substation within 10 tiles', 'fix text: ' + up.fix);
    ok(up.action && up.action.openMenuCard === 'substation', 'action: open the build menu on the Substation card');
    ok(up.rect && up.rect.tx === b2.tx && up.rect.ty === b2.ty && up.rect.w === b2.w && up.rect.h === b2.h && up.tiles.length === b2.w * b2.h, 'tiles = the footprint; rect = the building');
    ok(Math.abs(up.anchor.tx - (b2.tx + (b2.w - 1) / 2)) < 1e-9 && Math.abs(up.anchor.ty - (b2.ty + (b2.h - 1) / 2)) < 1e-9, 'anchor at the footprint centre');
    ok(up.since === s.tick || up.since <= s.tick, 'since is a tick (' + up.since + ')');
    ok(up.color === '#FFB03B' && up.glyph === 'bolt' && up.severity === 2, 'colour / glyph / severity on the issue');
  }
  const uw = l.find((it) => it.kind === 'unwatered' && it.buildingId === dormId);
  ok(!!uw && /Water Tower within 12 tiles/.test(uw.fix), 'and an unwatered issue with the tower radius');
  // deterministic + cached
  const l2 = I.list(s); ok(l2 === l, 'cached within 25 ticks');
  H.tick(I.refreshTicks + 1); const l3 = I.list(s);
  ok(l3 !== l && JSON.stringify(l3.map((it) => [it.id, it.severity, it.since])) === JSON.stringify(l.map((it) => [it.id, it.severity, it.since])), 'recompute after 25 ticks is identical (ids, severity, since)');
  // sorted
  ok(l3.every((it, k) => k === 0 || l3[k - 1].severity > it.severity || (l3[k - 1].severity === it.severity && l3[k - 1].since <= it.since)), 'sorted by severity then age');
  // events invalidate at once
  const n0 = I.stats().computes; BSU.events.emit(BSU.EV.BUILDING_PLACED, { id: dormId }); I.list(s); ok(I.stats().computes === n0 + 1, 'building:placed recomputes at once');
}

// --- selection cycling, keys, tray --------------------------------------------
const M0 = { ctrl: false, shift: false, meta: false, alt: false };
I.select(null);
const list = I.list(s);
if (list.length >= 2) {
  const c1 = I.cycle(s, 1); ok(c1 && c1.id === list[0].id, 'cycle → first (most severe / oldest)');
  const c2 = I.cycle(s, 1); ok(c2 && c2.id === list[1].id && I.selected(s) === c2, 'cycle → second');
  let last = c2; for (let k = 0; k < list.length; k++) last = I.cycle(s, 1); ok(last.id === c2.id, 'wraps around the list');
  ok(I.cycle(s, -1).id === list[0].id, 'cycle(-1) goes back');
  I.select(null); ok(I.selected(s) === null, 'select(null)');
  const cam0 = { x: s.ui.camera.x, y: s.ui.camera.y };
  ok(U.keydown('i', M0) === true && I.selectedId() === list[0].id, 'I key selects the first issue');
  ok(s.ui.camera.hasTarget === true || (s.ui.camera.x !== cam0.x || s.ui.camera.y !== cam0.y), 'and eases the camera toward it');
  ok(I.spotlight() === true, 'spotlight while I is held');
  U.keydown('i', M0); ok(I.selectedId() === list[1].id, 'I again → next issue');
  ok(U.keydown('I', { ctrl: false, shift: true, meta: false, alt: false }) === true && U.issues.spotlight() === true, 'Shift+I toggles spotlight on');
  s.ui.tool = null; s.ui.panel = null; U.closeInspect(); U.closeBuildMenu();
  ok(U.keydown('Escape', M0) === true && I.selectedId() === null && U.issues.spotlight() === false, 'Esc clears the selection and spotlight');
  // tray
  U.update(s, 300); U.update(s, 300);
  const tray = U.el['issues-tray'];
  ok(tray && !tray.classList.contains('hidden') && /\d+ issues?/.test(U.el['issues-count'].textContent), 'tray shown: ' + U.el['issues-count'].textContent);
  const rows = U.el['issues-list'].children;
  ok(rows.length >= 1 && rows.length <= 6 && rows[0].dataset.id === list[0].id, `tray rows (${rows.length}) start with the top issue`);
  ok((rows[0].children.length === 4 || (rows[0].children.length === 5 && rows[0].children[4].className === 'why')) && rows[0].children[2].textContent === 'Fix' && rows[0].children[3].textContent === 'Locate', 'row = glyph, title, Fix, Locate (+ a why-line for gators)');   // gator pass
  ok(U.issues.locate(s, list[0].id) === true && I.selectedId() === list[0].id, 'ui.issues.locate selects + pans');
  if (s.setPiece) H.tick(700);   // the arrival set piece keeps the build menu shut
  const upIt = list.find((it) => it.kind === 'unpowered');
  const fr = upIt ? U.issues.fix(s, upIt.id) : null; ok(fr && fr.ok !== false && U.buildMenuOpen() === true && I.selectedId() === upIt.id, 'ui.issues.fix(unpowered) opens the build menu on the Substation card and selects the issue'); U.closeBuildMenu();
  const gIt = list.find((it) => it.kind === 'gatorOnCampus');
  if (gIt) {   // gator pass: Fix = the Parish call-out confirm line (no Wildlife Officer Post in range), then the truck relocates it the next day
    const PG = BSU.params.wildlife.gator, fee = BSU.formatMoney(PG.callOutFee);
    ok(/why|attendance|happiness/i.test(gIt.why) && /Parish Wildlife call-out/.test(gIt.fix) && gIt.fix.indexOf(fee) >= 0 && /Preserve/.test(gIt.fix) && gIt.action.free === false, 'gator issue: why-line, paid fix text with the fee, the fence / Preserve suggestions');
    const rl0 = (s.wildlife && s.wildlife.relocations) | 0, cash0 = s.economy.cash;
    const gr = U.issues.fix(s, gIt.id);
    const txt = (e) => e ? (e.textContent || '') + Array.from(e.children || []).map(txt).join('') : '';   // the DOM stub's textContent is not recursive
    const cn = Array.from(U.el.notifications.children).find((c) => /Parish Wildlife call-out/.test(txt(c)));
    ok(gr && gr.ok === true && gr.pending === true && cn && s.economy.cash === cash0, 'ui.issues.fix(gator) opens a confirm line and charges nothing yet');
    const cb = cn ? Array.from(cn.children).find((c) => c.textContent === 'Confirm ' + fee) : null;
    ok(!!cb && Array.from(cn.children).some((c) => c.className.indexOf('notif-why') >= 0), 'the confirm notification has a Confirm button and a why-line');
    if (cb) cb.dispatchEvent({ type: 'click' });
    const pend = BSU.wildlife.callOutPending(s, gIt.action.relocate);
    ok(s.economy.cash === cash0 - PG.callOutFee && pend && pend.day === s.calendar.day + PG.callOutDays, 'Confirm charges the fee and books the truck for tomorrow');
    H.tick(220);
    ok(((s.wildlife && s.wildlife.relocations) | 0) === rl0 + 1 && BSU.wildlife.callOutPending(s, gIt.action.relocate) === null, 'the truck relocates the gator the next day (wildlife.relocations +1)');
    ok(U.el['issues-list'].children.length === 0 || Array.from(U.el['issues-list'].children).every((r) => r.dataset.kind !== 'gatorOnCampus' || (r.children.length === 5 && r.children[4].className === 'why')), 'tray rows for gators carry the why-line as a fifth, full-width child');
  }
  // needs strip Locate button follows the binding line
  U.update(s, 600); const nl = U.el['needs-locate']; ok(!!nl, '#needs-locate exists (hidden=' + (nl && nl.classList.contains('hidden')) + ')');
  // a notification about power gains Locate
  U.notify(s, { kind: 'info', text: 'Tiger Hall has no power', ttl: 3000 });
  const notes = U.el.notifications.children; const lastN = notes[notes.length - 1];
  ok(lastN && Array.from(lastN.children).some((c) => c.textContent === 'Locate'), 'a notification about an issue gets a Locate button');
  I.select(null);
} else ok(false, 'expected ≥ 2 issues to cycle (got ' + list.length + ')');

// --- beacons: passes, caps, labels, arrows, spotlight, perf ---------------------
const P = R.passes().map((p) => p.name + '@' + p.order);
ok(P.indexOf('beacons@7.5') >= 0 && P.indexOf('spotlight@9.5') >= 0 && P.indexOf('lights@7') < P.indexOf('beacons@7.5') && P.indexOf('overlays@9') < P.indexOf('spotlight@9.5') && P.indexOf('spotlight@9.5') < P.indexOf('hud@10'), 'passes: beacons above lights, spotlight above overlays, below hud');
R.setZoom(1, null); I.select(list.length ? list[0].id : null); if (list.length) R.panToTile(list[0].anchor.tx, list[0].anchor.ty, false); H.render(); H.render();
let st = R.issueStats();
ok(st.drawn >= 1 && st.drawn <= st.max, `beacons drawn at 1×: ${st.drawn} (≤ ${st.max})`);
ok(st.labels === 1, 'the selected issue has a floating label');
// more issues than the cap: synthetic unpowered dorms around the camera
const centre = R.screenToTile(R.view.vw / 2, R.view.vh / 2); const ct = centre && Number.isFinite(centre.tx) ? centre : { tx: 32, ty: 32 };
const n0 = s.buildings.length; const dr = BSU.data.catalog.dorm;
for (let k = 0; k < 60; k++) {
  const id = n0 + k; s.buildings[id] = { id: id, type: 'dorm', tx: Math.max(0, Math.min(60, (ct.tx | 0) - 6 + (k % 12))), ty: Math.max(0, Math.min(60, (ct.ty | 0) - 2 + ((k / 12) | 0))), w: dr.w, h: dr.h, rot: 0, name: 'Fake ' + k, hp: 1, built: 1, builtDay: 0, pilings: false, sunk: 0, powered: false, watered: true, provider: { power: -1, water: -1 }, flooded: false, floodedSince: -1, closedUntil: -1, blackout: false, tier: 0, upgradeDoneDay: -1, ruin: false, tarp: false };
}
I.invalidate(); const big = I.list(s); ok(big.length >= 60, `synthetic campus lists ${big.length} issues`);
H.render(); st = R.issueStats();
ok(st.drawn <= st.max && st.drawn >= 1, `beacon cap holds: ${st.drawn} drawn of ${big.length} (max ${st.max}, capped=${st.capped})`);
ok(st.arrows <= st.arrowsMax, `edge arrows ≤ ${st.arrowsMax} (${st.arrows})`);
let worst = 0; for (let k = 0; k < 30; k++) { H.render(); worst = Math.max(worst, R.issueStats().ms); }
ok(Number.isFinite(worst), `beacon pass cost on the stub: worst ${worst.toFixed(2)} ms over 30 frames (budget 1.0 ms in Chrome; the pass stops early past it)`);
R.setZoom(2, null); H.render(); st = R.issueStats(); ok(st.drawn >= 1 && st.drawn <= st.max, `2×: ${st.drawn} beacons`);
R.setZoom(0.5, null); H.render(); st = R.issueStats(); ok(st.drawn >= 1 && st.drawn <= st.max, `0.5×: ${st.drawn} beacons`);
R.setZoom(1, null);
// spotlight mode draws the dim + beacons in the spotlight pass (beacons pass skips)
U.issues.spotlight(true); H.render(); st = R.issueStats(); ok(I.spotlight() === true && st.drawn >= 1, `spotlight mode still draws the beacons (${st.drawn})`); U.issues.spotlight(false);
// off-screen: pan far away → arrows, no rings
R.panToTile(2, 2, false); H.render(); H.render(); st = R.issueStats();
ok(st.arrows >= 1, `off-screen issues get edge arrows (${st.arrows})`);
R.panToTile(ct.tx, ct.ty, false);
// perf mode: no exception, still ≤ cap
s.ui.perfMode = true; H.render(); st = R.issueStats(); ok(st.drawn <= st.max, 'perf mode frame ok'); s.ui.perfMode = false;
// hover pulse
I.pulse('power'); ok(I.isPulsing('unpowered') && I.isPulsing('pumpOff') && !I.isPulsing('flooded'), 'pulse(power) covers the power family'); H.render(); I.pulse(null);
// minimap pips draw without error
R.minimap(s); ok(true, 'minimap with pips drew');
// night: beacons still drawn after the tint/lights
const sky0 = s.sky ? Object.assign({}, s.sky) : null;
try { if (s.sky) { s.sky.phase = BSU.SKY.NIGHT; s.sky.t = 0.5; } H.render(); st = R.issueStats(); ok(st.drawn >= 1, `night frame draws ${st.drawn} beacons`); } finally { if (sky0) Object.assign(s.sky, sky0); }
// clean the synthetic buildings
s.buildings.length = n0; I.invalidate(); I.select(null);

// --- flood: a Cat-3 hurricane floods buildings → flooded issues -----------------
const floodedBefore = I.list(s).filter((it) => it.kind === 'flooded').length;
H.forceHurricane(3); H.tick(4000); H.render();
const fl = I.list(s).filter((it) => it.kind === 'flooded');
const hydroFl = BSU.hydro.floodedBuildings(s);
ok(fl.length === hydroFl.length && fl.every((it) => hydroFl.indexOf(it.buildingId) >= 0), `flooded issues (${fl.length}) match hydro.floodedBuildings (${hydroFl.length}); before: ${floodedBefore}`);
if (fl.length) ok(fl[0].severity === 3 && fl[0].glyph === 'wave' && fl[0].color === '#2BD4C0' && /flooded/i.test(fl[0].title) && fl[0].action.openMenuCard === 'pump', 'flooded: severity 3, wave glyph, teal, pump card');
const sv = I.summary(s); ok(sv.count === I.list(s).length && sv.bySeverity[3] >= fl.length, `summary: ${sv.count} issues, ${sv.bySeverity[3]} urgent`);
// damaged after the storm (if any) carry a repair action
const dm = I.list(s).filter((it) => it.kind === 'damaged'); ok(dm.every((it) => Number.isFinite(it.action.repair)), `damaged issues (${dm.length}) carry a repair action`);

// --- gator on campus (cheat) ----------------------------------------------------
try {
  const gs0 = I.list(s).filter((it) => it.kind === 'gatorOnCampus').length;
  const cm = BSU.wildlife.campusMask(s); let ci = -1; for (let i = 0; i < cm.length; i++) if (cm[i]) { ci = i; break; }
  if (ci >= 0) {
    const g = BSU.wildlife.spawnGator(s, ci, 'Testy'); if (g) { g.tx = ci % 64 + 0.5; g.ty = ((ci / 64) | 0) + 0.5; }
    I.invalidate(); const gi = I.list(s).filter((it) => it.kind === 'gatorOnCampus');
    ok(gi.length >= gs0 + 1 && gi.some((it) => /Testy/.test(it.title) && Number.isFinite(it.action.relocate)), `a spawned gator on a campus tile is a gatorOnCampus issue (${gi.length})`);
  } else ok(true, 'no campus mask tile yet (gator check skipped)');
} catch (e) { ok(false, 'gator check: ' + e.message); }

// --- all clear: the tray says so briefly then hides --------------------------------
s.buildings.length = 0; s.gators = []; s.economy.students = 0; I.invalidate(); I.select(null);
U.update(s, 300); const trayEl = U.el['issues-tray'];
ok(I.list(s).length === 0 && !trayEl.classList.contains('hidden') && /All clear/.test(U.el['issues-count'].textContent), 'no issues → "All clear ✓" chip');
for (let k = 0; k < 14; k++) U.update(s, 300);
ok(trayEl.classList.contains('hidden'), 'then the tray hides');

ok(BSU.errors.size === errors0, 'no BSU.error during the unit run' + (BSU.errors.size !== errors0 ? ': ' + [...BSU.errors.keys()].join(' | ') : ''));
BSU.SELFTEST = true; let stt; try { stt = I.selfTest(); } catch (e) { stt = { ok: false, notes: e.message }; } finally { BSU.SELFTEST = false; }
ok(stt && stt.ok, 'issues.selfTest ok ' + (stt && stt.notes ? '(' + stt.notes + ')' : ''));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
