// Unit test for src/js/session.js: loads contract.js and every manifest module that exists (render/ui/progress
// may be missing — session must boot and run headless without them) through makeWindow() from test/domstub.mjs
// with vm.runInContext, then checks boot, newGame/skipTutorial, tick1, save/load round trip, determinism across
// two separate boots, speed + set pieces, migrate refusals, the title world and skipToDate.
// Usage: node test/unit/session.test.mjs   (exit 1 on any failure)
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

function scanNumbers(obj, path = 'state', seen = new Set(), depth = 0) {
  if (obj == null || depth > 12) return null;
  if (typeof obj === 'number') return Number.isFinite(obj) ? null : path;
  if (typeof obj !== 'object') return null;
  if (seen.has(obj)) return null; seen.add(obj);
  if (ArrayBuffer.isView(obj)) { for (let i = 0; i < obj.length; i++) if (!Number.isFinite(obj[i])) return `${path}[${i}]`; return null; }
  if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) { const r = scanNumbers(obj[i], `${path}[${i}]`, seen, depth + 1); if (r) return r; } return null; }
  for (const k of Object.keys(obj)) { const r = scanNumbers(obj[k], `${path}.${k}`, seen, depth + 1); if (r) return r; }
  return null;
}

// --- source hygiene --------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'session.js'), 'utf8');
ok(/^'use strict';/.test(src), "file starts with 'use strict'");
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/setTimeout|setInterval/.test(src), 'no setTimeout/setInterval (tick-based only)');
eq((src.match(/Math\.random\(/g) || []).length, 1, 'exactly one Math.random() call (the title/new-game seed)');

// --- boot the whole existing bundle in a fresh context -----------------------
function boot() {
  const win = makeWindow();
  win.BSU_FORCE_HEADLESS = true;
  const ctx = vm.createContext(win);
  const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
  const skipped = [];
  for (const f of manifest) {
    const p = join(root, 'src', 'js', f);
    if (!existsSync(p)) { skipped.push(f); continue; }
    vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return { win, BSU: win.BSU, skipped };
}

const { win, BSU, skipped } = boot();
if (skipped.length) console.log('skip:', skipped.join(', '), '(not written yet — session must cope)');
ok(BSU && BSU.session && typeof BSU.session.newGame === 'function', 'BSU.session exists after boot');
ok(BSU.headless && ['tick', 'render', 'snapshot', 'findSpot', 'place', 'forceHurricane', 'click', 'key', 'fastForwardDays', 'state'].every(k => typeof BSU.headless[k] === 'function'), 'BSU.headless has the full API');
eq(BSU.headless.autosave, false, 'headless.autosave defaults to false');
eq(BSU.headlessMode, true, 'headlessMode is true under domstub');
eq(BSU.session.loopRunning, false, 'the main loop is not started headless');
eq(win.__headless.frame(), 0, 'no requestAnimationFrame was queued at boot');
ok(BSU.state && typeof BSU.state.tick === 'number', 'BSU.state exists after boot (the boot root)');
ok(BSU.errors.size === 0, 'no BSU.error during boot: ' + [...BSU.errors.keys()].join(' | '));

const S = BSU.session, H = BSU.headless;

// --- newGame + skipTutorial --------------------------------------------------
const s0 = S.newGame({ seed: 42, skipTutorial: true });
ok(s0 === BSU.state, 'newGame returns the live root');
eq(s0.seed, 42, 'state.seed');
const snap0 = H.snapshot();
eq(snap0.students, 120, 'skipTutorial: 120 founding students');
eq(snap0.buildings, 1, "skipTutorial: Founders' Hall placed");
eq(snap0.cash, 4000000, 'skipTutorial: placements were free');
eq(snap0.agents, 44, 'snapshot.agents = count(120 students)');
eq(s0.tiles.surface[s0.plot.landingShoulder], 1, 'the tutorial path reaches the landing shoulder');
eq(s0.calendar.running, true, 'calendar running');
eq(s0.progress.tutorialStage, 6, 'tutorialStage 6');
H.render(); ok(true, 'headless.render() is a safe no-op without render/ui');

// --- tick1 bookkeeping -------------------------------------------------------
const TPD = BSU.params.time.ticksPerDay;   // time pass: 200 ticks per calendar day
H.tick(Math.round(2.5 * TPD));
eq(s0.tick, 2.5 * TPD, 'tick counts');
eq(s0.calendar.day, 2, 'day 2 after 2.5 days of ticks');
eq(s0.playSeconds, 2.5 * TPD / 10, 'headless playSeconds = tick / 10');
eq(s0.rng.sim, BSU.rng.sim.state, 'rng.sim mirrored after the tick');
eq(s0.economy.ecology, s0.wildlife.ecology, 'economy.ecology mirrors wildlife.ecology');
ok(!scanNumbers(s0), 'no non-finite number in the live tree: ' + scanNumbers(s0));

// --- save / load round trip --------------------------------------------------
const before = JSON.stringify(H.snapshot());
const json = S.save('unit');
ok(typeof json === 'string' && json.length > 10000, `save returns JSON (${json.length} bytes)`);
const doc = JSON.parse(json);
eq(doc.v, BSU.SAVE_VERSION, 'doc.v'); eq(doc.app, 'bayou-state', 'doc.app'); eq(doc.savedAt, 0, 'savedAt 0 headless');
ok(doc.tiles && typeof doc.tiles.elev === 'string' && Object.keys(doc.tiles).length === 16, '16 tiles arrays as b64');
ok(!('agents' in doc) && !('vehicles' in doc) && !('networks' in doc.hydro) && !('campusMask' in doc.wildlife) && !('tool' in doc.ui), 'SAVE_SKIP paths removed');
ok('t1BandDay' in doc.storms, 'lazily added owner keys are saved structurally (storms.t1BandDay)');
ok(win.localStorage.getItem('bsu.save.unit') === json && win.localStorage.getItem('bsu.last') === 'unit', 'localStorage holds the save and bsu.last');
eq(s0.saveMeta.slot, 'unit', 'saveMeta.slot written');
const s1 = S.load('unit');
ok(s1 && s1 !== s0 && s1 === BSU.state, 'load replaces BSU.state with a new root');
eq(JSON.stringify(H.snapshot()), before, 'snapshot identical after load');
ok(s1.tiles.elev.every((v, i) => v === s0.tiles.elev[i]), 'tiles.elev bit-identical');
eq(s1.agents.length, s0.agents.length, 'agents regenerated to the same count');
eq(s1.storms.t1BandDay, s0.storms.t1BandDay, 'lazily added key round-trips');
ok(S.slots().some(x => x.slot === 'unit' && typeof x.label === 'string'), 'slots() lists the slot');
const c = S.continue_();
ok(c && c === BSU.state, 'continue_() loads bsu.last');
S.deleteSlot('unit');
ok(!S.slots().some(x => x.slot === 'unit') && S.load('unit') === null, 'deleteSlot removes it; load → null');
// in-memory fallback when localStorage throws
const realLS = win.localStorage;
win.localStorage = { getItem() { throw new Error('quota'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('quota'); } };
const json2 = S.save('mem');
ok(typeof json2 === 'string' && S.load('mem') && JSON.stringify(H.snapshot()) === before, 'save/load survive a throwing localStorage (in-memory map)');
win.localStorage = realLS;
S.deleteSlot('mem');

// --- determinism across two separate boots ---------------------------------
{
  const a = boot().BSU, b = boot().BSU;
  a.session.newGame({ seed: 99, skipTutorial: true }); a.headless.tick(300);
  b.session.newGame({ seed: 99, skipTutorial: true }); b.headless.tick(300);
  eq(JSON.stringify(b.headless.snapshot()), JSON.stringify(a.headless.snapshot()), 'two boots with seed 99 give identical snapshots');
  eq(b.state.rng.sim, a.state.rng.sim, 'and identical rng.sim');
  ok(a.state.tiles.elev.every((v, i) => v === b.state.tiles.elev[i]), 'and identical terrain');
}

// --- speed + set pieces ------------------------------------------------------
{
  const s = BSU.state;
  const seen = [];
  const rec = (name) => (p) => seen.push(name + ':' + p.kind + ':' + p.len);
  BSU.events.on('setpiece:start', rec('start'), 'unit'); BSU.events.on('setpiece:end', rec('end'), 'unit');
  let speeds = [];
  BSU.events.on('speed:changed', (p) => speeds.push(p.speed + '/' + p.prev + '/' + p.reason), 'unit');
  S.setSpeed(s, 4, 'user');
  eq(s.ui.speed, 4, 'setSpeed writes ui.speed');
  S.setSpeed(s, 1, 'warning');
  eq(s.ui.speedBefore, 4, 'warning remembers speedBefore');
  S.restoreSpeed(s, 'warning');
  eq(s.ui.speed, 4, 'restoreSpeed puts it back');
  ok(S.startSetPiece(s, 'nearMiss', { len: 150, skippable: true }) && !S.startSetPiece(s, 'game', { len: 750 }), 'startSetPiece once; second refused');
  eq(s.calendar.frozen, true, 'frozen during a set piece');
  const day = s.calendar.day;
  H.tick(149);
  ok(s.setPiece && s.setPiece.tick === 149 && s.calendar.day === day, 'set piece tick advances; calendar frozen');
  H.tick(1);
  eq(s.setPiece, null, 'set piece ends at len ticks');
  eq(s.ui.speed, 4, 'speed restored after the set piece');
  eq(seen.join(','), 'start:nearMiss:150,end:nearMiss:150', 'setpiece:start/end emitted once each');
  ok(speeds.some(x => x === '4/4/restore'), 'speed:changed emitted with reason restore');
  // skipSetPiece
  S.startSetPiece(s, 'nearMiss', { len: 150, skippable: true });
  S.skipSetPiece(s); ok(s.setPiece && s.setPiece.tick === 0, 'skip refused before skipAfterTick');
  // graduation (progress-owned; progress absent → jump to the end)
  S.endSetPiece(s);
  S.startSetPiece(s, 'graduation', { len: 150, skippable: true });
  s.setPiece.tick = 150; S.skipSetPiece(s);
  eq(s.setPiece ? s.setPiece.tick : -1, 149, 'skipSetPiece jumps a graduation to len − 1');
  H.tick(1); eq(s.setPiece, null, 'and it ends on the next tick');
  BSU.events.clear('unit');
}

// --- migrate / refusals -----------------------------------------------------
ok(S.migrate({ v: 1, app: 'bayou-state' }) !== null, 'migrate accepts v1');
ok(S.migrate({ v: 2, app: 'bayou-state' }) === null && S.migrate({ v: 1 }) === null, 'refuses a newer version and a missing app');
win.localStorage.setItem('bsu.save.v2', JSON.stringify({ v: 2, app: 'bayou-state', seed: 3 }));
const live = BSU.state;
ok(S.load('v2') === null && BSU.state === live, 'load refuses a v2 doc and keeps the live game');
win.localStorage.setItem('bsu.save.junk', '{not json');
ok(S.load('junk') === null, 'unparsable save → null');

// --- autosave rotation (opt-in headless) ------------------------------------
{
  S.newGame({ seed: 5, skipTutorial: true });
  H.autosave = true;
  const s = BSU.state;
  H.tick(10 * TPD);   // crosses Jan → Feb 1 (day 10)
  H.autosave = false;
  ok(s.saveMeta.slot === 'auto.0' && win.localStorage.getItem('bsu.save.auto.0'), 'autosave wrote auto.0 on the 1st of the month');
  S.deleteSlot('auto.0');
}

// --- title world -------------------------------------------------------------
{
  const t = S.newGame({ seed: 11, title: true });
  eq(t.calendar.running, false, 'title world: calendar not running');
  eq(t.ui.speed, 0, 'title world: ui.speed 0');
  eq(t.progress.tutorialStage, 0, 'title world: tutorialStage 0');
  eq(t.economy.students, 0, 'title world: no students');
  H.tick(50);
  ok(t.tick === 50 && t.calendar.day === 0, 'title world ticks with the calendar frozen');
  ok(S.titleWorld === true, 'session.titleWorld flag set');
}

// --- skipToDate --------------------------------------------------------------
{
  const s = S.newGame({ seed: 8, skipTutorial: true });
  S.skipToDate(s, 'Jan 5', 0);
  eq(s.calendar.day, 4, 'skipToDate reaches Jan 5 (day 4)');
  S.skipToDate(s, 'Jan 3', 0);
  eq(s.calendar.day, 122, 'a past date rolls to next year');
}

// --- headless findSpot/place/forceHurricane ----------------------------------
{
  S.newGame({ seed: 42, skipTutorial: true });
  const spot = H.findSpot('dorm');
  ok(spot && H.place('dorm', spot.x, spot.y).ok === true, 'findSpot + place dorm');
  eq(H.findSpot('nope'), null, 'findSpot unknown id → null');
  const st = H.forceHurricane(9);
  ok(st && st.compressed === true && st.cat === 5, 'forceHurricane clamps to Cat 5 and is compressed');
  H.fastForwardDays(7);
  ok(BSU.state.setPiece && BSU.state.setPiece.kind === 'landfall', 'landfall set piece running at +700');
  H.click(400, 300); H.key('Escape'); ok(true, 'click/key are safe no-ops without ui');
}

ok(BSU.errors.size === 0, 'no BSU.error during the whole run: ' + [...BSU.errors.keys()].join(' | '));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
