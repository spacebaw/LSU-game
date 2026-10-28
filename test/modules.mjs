// Runs every BSU.<module>.selfTest() found after booting a headless game. Exit 1 if any fails.
// The harness owns BSU.SELFTEST (ARCHITECTURE §10.6): it is true around every selfTest so BSU.assert,
// BSU.error and listener exceptions throw; a module whose BSU.errors count grew during its selfTest fails
// too. `session` runs last because its selfTest swaps the live game (backup → private newGame → restore).
import { loadGame } from './domstub.mjs';
const { win } = loadGame();
const BSU = win.BSU;
if (!BSU) { console.error('no BSU'); process.exit(1); }
const SIZE = process.argv.includes('--size') ? (Number(process.argv[process.argv.indexOf('--size') + 1]) === 64 ? 64 : 96) : 96;   // L1: world size per game (96 default; --size 64 = the legacy world)
try { BSU.session.newGame({ seed: 7, skipTutorial: true, size: SIZE }); } catch (e) { console.error('newGame threw', e); process.exit(1); }
console.log('world ' + BSU.MAP.W + ' × ' + BSU.MAP.H);
let bad = 0, n = 0;
const entries = Object.entries(BSU).filter(([, mod]) => mod && typeof mod.selfTest === 'function');
entries.sort((a, b) => (a[0] === 'session') - (b[0] === 'session'));   // stable: keeps BSU insertion order, session last
for (const [name, mod] of entries) {
  n++;
  const errorsBefore = BSU.errors ? BSU.errors.size : 0;
  const t0 = Date.now();
  let r;
  BSU.SELFTEST = true;
  try { r = mod.selfTest(); }
  catch (e) { r = { ok: false, notes: 'threw: ' + (e && e.stack || e) }; }
  finally { BSU.SELFTEST = false; }
  const ms = Date.now() - t0;
  const errorsAfter = BSU.errors ? BSU.errors.size : 0;
  if (r && r.ok && errorsAfter > errorsBefore) r = { ok: false, notes: `BSU.errors grew by ${errorsAfter - errorsBefore} during selfTest; ` + (r.notes || '') };
  if (r && r.ok) console.log('ok  :', name, `(${ms} ms)`, r.notes || '');
  else { bad++; console.error('FAIL:', name, `(${ms} ms)`, r && r.notes); }
}
console.log(`${n} self-tests, ${bad} failed`);
process.exit(bad ? 1 : 0);
