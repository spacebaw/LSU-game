// Headless integration smoke test. Boots the built index.html in Node with the DOM stub,
// starts a new game, runs the simulation for game-years, places buildings, renders frames,
// saves and reloads. Fails on any exception, NaN/Infinity in state, or broken invariants.
// Usage: node build.mjs --check && node test/smoke.mjs [--long]
import { loadGame } from './domstub.mjs';

const LONG = process.argv.includes('--long');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };

// Recursively scan for NaN / Infinity (typed arrays included). Returns first bad path or null.
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

const { win } = loadGame();
const BSU = win.BSU;
ok(BSU, 'window.BSU namespace exists');
ok(BSU && BSU.session && typeof BSU.session.newGame === 'function', 'BSU.session.newGame exists');
ok(BSU && BSU.headless && typeof BSU.headless.tick === 'function', 'BSU.headless.tick exists');
if (failures) process.exit(1);

const H = BSU.headless;
let state;
try { state = BSU.session.newGame({ seed: 42, skipTutorial: true }); ok(true, 'newGame(seed 42) returned'); }
catch (e) { ok(false, 'newGame threw: ' + (e.stack || e)); process.exit(1); }
state = state || BSU.state;
ok(state && typeof state === 'object', 'game state object available (return value or BSU.state)');

const snap0 = H.snapshot();
ok(snap0 && typeof snap0.cash === 'number' && typeof snap0.students === 'number', 'snapshot() has cash and students');
console.log('start:', JSON.stringify(snap0));

// One frame of rendering against the stub canvas must not throw.
try { H.render(); ok(true, 'render() one frame'); } catch (e) { ok(false, 'render() threw: ' + (e.stack || e)); }

// Run 3 months (10-day months, params.time.ticksPerDay ticks per day: 200 → 6000 ticks)
try { H.tick(3 * BSU.params.time.daysPerMonth * BSU.params.time.ticksPerDay); ok(true, 'ticked 3 months'); } catch (e) { ok(false, 'tick threw: ' + (e.stack || e)); }
ok(!scanNumbers(state), 'no NaN/Infinity after 3 months: ' + scanNumbers(state));

// Placements: the headless API must offer a way to find a legal spot for a building id.
const placeOrder = ['path', 'dorm', 'lecture_hall', 'dining_hall', 'substation', 'water_tower', 'levee', 'canal', 'pump', 'quad', 'live_oak', 'gator_fence'];
let placed = 0;
for (const id of placeOrder) {
  try {
    const spot = H.findSpot(id);           // {x,y} or null; for drag tools a start tile is fine
    if (!spot) { console.log('skip:', id, '(no legal spot found)'); continue; }
    const r = H.place(id, spot.x, spot.y);  // {ok:boolean, reason?:string}
    if (r && r.ok) placed++; else console.log('skip:', id, 'rejected:', r && r.reason);
  } catch (e) { ok(false, `place(${id}) threw: ` + (e.stack || e)); }
}
ok(placed >= 4, `placed at least 4 buildings (${placed})`);

// Run one full year with a render every so often
const yearTicks = BSU.params.time.ticksPerYear;   // 24,000 (time pass: 200 ticks per calendar day)
try { for (let i = 0; i < yearTicks; i += 500) { H.tick(500); H.render(); } ok(true, 'ticked 1 year with periodic renders'); }
catch (e) { ok(false, 'year tick/render threw: ' + (e.stack || e)); }
const bad = scanNumbers(state); ok(!bad, 'no NaN/Infinity after 1 year: ' + bad);
const snap1 = H.snapshot();
console.log('year 1:', JSON.stringify(snap1));
ok(snap1.year > snap0.year || snap1.day !== snap0.day, 'calendar advanced');
ok(Number.isFinite(snap1.cash), 'cash is finite');
ok(snap1.students >= 0, 'students non-negative');

// Force a hurricane landfall set piece and run through it
try {
  if (typeof H.forceHurricane === 'function') { H.forceHurricane(3); H.tick(4000); H.render(); ok(true, 'forced Cat 3 hurricane and survived 4000 ticks'); }
  else ok(false, 'headless.forceHurricane missing');
} catch (e) { ok(false, 'hurricane threw: ' + (e.stack || e)); }
ok(!scanNumbers(state), 'no NaN/Infinity after hurricane: ' + scanNumbers(state));

// Save / load round trip
try {
  const json = BSU.session.save('smoke');
  ok(typeof json === 'string' && json.length > 100, 'save() returned JSON string');
  const before = H.snapshot();
  BSU.session.load('smoke');
  const after = H.snapshot();
  ok(JSON.stringify(before) === JSON.stringify(after), 'snapshot identical after load');
  H.tick(1000); H.render(); ok(true, 'ticked after load');
} catch (e) { ok(false, 'save/load threw: ' + (e.stack || e)); }

if (LONG) {
  try { for (let i = 0; i < 4; i++) { H.tick(BSU.params.time.ticksPerYear); H.render(); console.log(`year ${i + 2}:`, JSON.stringify(H.snapshot())); } ok(true, 'ticked 4 more years'); }
  catch (e) { ok(false, 'long run threw: ' + (e.stack || e)); }
  ok(!scanNumbers(state), 'no NaN/Infinity after long run');
}

// Input simulation hooks (optional but recommended): clicking the palette and map via ui.
if (typeof H.click === 'function') {
  try { H.click(400, 300); H.key('Escape'); H.render(); ok(true, 'headless click/key hooks work'); }
  catch (e) { ok(false, 'click/key threw: ' + (e.stack || e)); }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL OK');
process.exit(failures ? 1 : 0);
