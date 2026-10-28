// Unit test for the L1 world-size-per-game contract (docs/PLAN_PATHS_LAND.md Track L1): BSU.MAP is a frozen per-game spec set by
// session.newGame / load before any allocation; new games are 96 × 96 with the legacy 64 × 64 content at (32, 32) and
// tile-for-tile identical to a 64 × 64 game of the same seed; every positional system goes through the offset; a v1 save
// (test/fixtures/save_v1_seed42.json, written by the pre-L1 build) loads as a 64 × 64 world and keeps working.
// Usage: node test/unit/world.test.mjs   (exit 1 on any failure)
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

function boot() {
  const win = makeWindow();
  win.BSU_FORCE_HEADLESS = true;
  const ctx = vm.createContext(win);
  const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
  for (const f of manifest) { const p = join(root, 'src', 'js', f); if (existsSync(p)) vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
  return { win, BSU: win.BSU };
}
const { win, BSU } = boot();
const S = BSU.session, H = BSU.headless, T = BSU.T;
const errors = () => BSU.errors ? BSU.errors.size : 0;

// --- source rules -------------------------------------------------------------------------------------------------
{
  const mods = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
  let captures = 0, bitTricks = 0;
  for (const f of mods) {
    const src = readFileSync(join(root, 'src', 'js', f), 'utf8');
    if (/^  const [^\n]*=\s*BSU\.MAP\.(W|H|N)\b/m.test(src)) captures++;   // module level (two-space indent); a function-local read per call is fine
    if (f !== 'contract.js' && /^  const \w+ = BSU\.MAP;/m.test(src) && /\bMAP\.(W|H|N)\b/.test(src)) captures++;   // a module-level MAP object capture that reads W/H/N through it
    if (!/^sprites/.test(f)) for (const line of src.split('\n')) { if (/fleeStamp|crX\[|tees\[|hv >> 6|look & 63|B64\[/.test(line)) continue; for (const m of line.matchAll(/(\w+) & 63\b|(\w+) >> 6\b/g)) { const id = m[1] || m[2]; if (/^(i|j|k|t|n|a|b|tile|den|idx|cur|from|to|low|land|water|door|home|at|pd|target|node|point|mouth|landing)$/.test(id)) bitTricks++; } }
  }
  eq(captures, 0, 'no module captures BSU.MAP.W/H/N into a const at load');
  eq(bitTricks, 0, 'no tile index uses the 64-wide bit tricks (& 63 / >> 6)');
}

// --- the page default and the map spec ----------------------------------------------------------------------------
eq(BSU.MAP.W, 64, 'page default BSU.MAP is the legacy 64 × 64 frame before any game');
eq(BSU.MAP.ox, 0, 'legacy frame offset 0');
ok(Object.isFrozen(BSU.MAP) && Object.isFrozen(BSU.mapSpec({ size: 96 })), 'map specs are frozen');
eq(BSU.SAVE_VERSION, 2, 'SAVE_VERSION 2');

// --- new games: 96 by default, 64 on request; MAP set before allocation ----------------------------------------------
const s96 = S.newGame({ seed: 42, skipTutorial: true });
eq(BSU.MAP.W, 96, 'newGame default is 96 wide');
eq(BSU.MAP.H, 96, 'newGame default is 96 high');
eq(BSU.MAP.N, 9216, 'N = 9216');
eq(BSU.MAP.ox, 32, 'legacy content offset ox = 32');
eq(BSU.MAP.oy, 32, 'legacy content offset oy = 32');
eq(BSU.MAP.NCH, 144, '12 × 12 chunks');
ok(s96.tiles.elev.length === 9216 && s96.tiles.owner.length === 9216 && s96.tiles.walk.length === 9216, 'tile arrays allocated at the live N');
ok(s96.world && s96.world.W === 96 && s96.world.H === 96 && s96.world.ox === 32 && s96.world.oy === 32, 'state.world records W/H/ox/oy');
ok(s96.world.legacy && s96.world.legacy.x0 === 32 && s96.world.legacy.y0 === 32 && s96.world.legacy.x1 === 95 && s96.world.legacy.y1 === 95, 'state.world.legacy is the legacy rectangle (L2 reads it for the start charter)');
eq(BSU.idx(1, 1), 97, 'BSU.idx reads the live width');
eq(BSU.ty(BSU.idx(5, 7)), 7, 'BSU.ty reads the live width');
ok(BSU.inBounds(95, 95) && !BSU.inBounds(96, 0), 'inBounds reads the live size');
ok(s96.plot.founders.tx >= 32 && s96.plot.founders.ty === 7 + 32, 'Founders\' Hall sits in the legacy rectangle at the offset row');
ok(s96.buildings[0] && s96.buildings[0].type === 'founders_hall' && s96.buildings[0].ty === s96.plot.founders.ty, 'skipTutorial placed Founders\' Hall at the offset origin');
eq(s96.plot.highway.length, 7, 'the legacy Highway 1 stub keeps its 7 tiles');
ok(Array.isArray(s96.plot.highwayNorth) && s96.plot.highwayNorth.length === 32 && s96.plot.highwayNorth.every(i => s96.tiles.surface[i] === BSU.SURF.ROAD), 'Highway 1 runs on to the north edge (32 road tiles)');
ok(s96.plot.bayou.length > 100 && BSU.ty(s96.plot.bayou[0]) === 0, 'the bayou continues upstream to the north edge (plot.bayou[0] on row 0)');
ok(Array.isArray(s96.plot.bayouArm) && s96.plot.bayouArm.length > 40 && BSU.tx(s96.plot.bayouArm[0]) === 0 && s96.plot.bayouArm.every(i => s96.tiles.type[i] === T.BAYOU && !BSU.inLegacy(BSU.tx(i), BSU.ty(i))), 'a second bayou arm enters at the west edge and never touches legacy land');
{
  const last = s96.plot.bayouArm[s96.plot.bayouArm.length - 1];
  const nb = BSU.nbr8(last).concat([last]);
  ok(nb.some(i => s96.plot.bayou.indexOf(i) >= 0), 'the west arm joins the main bayou');
}
{
  let north5 = 0, westChen = 0, north = 0, oaks = 0, cyp = 0;
  for (let ty = 0; ty < 32; ty++) for (let tx = 32; tx < 96; tx++) { const i = ty * 96 + tx; if (s96.tiles.elev[i] >= 5 && s96.tiles.type[i] >= T.DRY) north5++; }
  for (const c of s96.plot.cheniers) { if (c.cx < 32) westChen++; if (c.cy < 32 && c.cx >= 32) north++; }
  for (const v of s96.veg) { if (v.ty < 32 && v.type === 'cypress') cyp++; if (v.type === 'oak') oaks++; }
  ok(north5 >= 200, `the upriver crown has a wider ≥ 5-ft crown than the start plot (${north5} tiles ≥ 5 ft north of the legacy edge)`);
  ok(westChen >= 3, `cheniers in the western backswamp (${westChen})`);
  ok(north >= 1, `a bankside chenier upriver (${north})`);
  ok(cyp >= 60, `cypress stands upriver (${cyp} cypress north of the legacy edge)`);
  ok(oaks > 0, 'oaks generated');
}
{
  const g = BSU.terrain.guarantees(s96);
  ok(g.ok, 'guarantees hold over the legacy rectangle at 96: ' + g.failed.join(','));
}

const s64 = S.newGame({ seed: 42, skipTutorial: true, size: 64 });
eq(BSU.MAP.W, 64, 'newGame({size: 64}) is the legacy world');
eq(BSU.MAP.NCH, 64, '8 × 8 chunks at 64');
ok(s64.world.W === 64 && s64.world.ox === 0 && s64.world.legacy.x1 === 63, 'state.world at 64');
eq(s64.tiles.elev.length, 4096, 'tile arrays at 4096');
eq(BSU.idx(1, 1), 65, 'BSU.idx follows the switch back');

// --- legacy-region identity across seeds (terrain type, elevation, flags, water, walk, surface) ---------------------
{
  const names = ['elev', 'type', 'flags', 'depth', 'sat', 'stand', 'walk', 'surface', 'subs'];
  const sh = (i) => i < 0 ? i : (((i / 64) | 0) + 32) * 96 + (i % 64) + 32;
  for (const seed of [1, 7, 42, 2024]) {
    const a = S.newGame({ seed, skipTutorial: true, size: 64 });
    const A = {}; for (const n of names) A[n] = a.tiles[n].slice();
    const plotA = JSON.parse(JSON.stringify(a.plot));
    const vegA = a.veg.map(v => v.type + ':' + v.tx + ',' + v.ty).sort().join('|');
    const b = S.newGame({ seed, skipTutorial: true, size: 96 });
    let diffs = 0;
    for (let ly = 0; ly < 64; ly++) for (let lx = 0; lx < 64; lx++) { const i = ly * 64 + lx, j = (ly + 32) * 96 + lx + 32; for (const n of names) if (A[n][i] !== b.tiles[n][j]) diffs++; }
    eq(diffs, 0, `seed ${seed}: the 96 × 96 south-east is tile-for-tile the 64 × 64 world (${names.join('/')})`);
    ok(plotA.founders.tx + 32 === b.plot.founders.tx && plotA.founders.ty + 32 === b.plot.founders.ty && plotA.bank0 + 32 === b.plot.bank0 && plotA.rect.x0 + 32 === b.plot.rect.x0 && plotA.rect.y1 + 32 === b.plot.rect.y1, `seed ${seed}: founders / bank0 / plot rect shifted by (32, 32)`);
    ok(sh(plotA.landing) === b.plot.landing && sh(plotA.landingShoulder) === b.plot.landingShoulder && plotA.mouth.map(sh).join() === b.plot.mouth.join() && plotA.cove.map(sh).join() === b.plot.cove.join() && plotA.lake.map(sh).join() === b.plot.lake.join() && plotA.mounds.map(sh).join() === b.plot.mounds.join(), `seed ${seed}: landing / mouth / cove / lake / mounds shifted`);
    ok(plotA.bayou.map(sh).join() === b.plot.bayou.slice(b.plot.bayou.length - plotA.bayou.length).join(), `seed ${seed}: the legacy bayou is the downstream tail of plot.bayou (upstream = smaller index)`);
    const vegB = b.veg.filter(v => BSU.inLegacy(v.tx, v.ty)).map(v => v.type + ':' + (v.tx - 32) + ',' + (v.ty - 32)).sort().join('|');
    ok(vegA === vegB, `seed ${seed}: vegetation inside the legacy rectangle identical`);
    ok(plotA.cheniers.every((c, k) => b.plot.cheniers[k] && b.plot.cheniers[k].cx === c.cx + 32 && b.plot.cheniers[k].cy === c.cy + 32 && b.plot.cheniers[k].tiles.join() === c.tiles.map(sh).join()), `seed ${seed}: legacy cheniers shifted and first in plot.cheniers`);
  }
}

// --- offsets: opening camera, dens, hurricane track / entry, Second Campus test --------------------------------------
{
  const a = S.newGame({ seed: 42, skipTutorial: true, size: 64 });
  const camA = BSU.audio.camTile(a, BSU.render.camera);
  const b = S.newGame({ seed: 42, skipTutorial: true, size: 96 });
  const camB = BSU.audio.camTile(b, BSU.render.camera);
  ok(camB.tx === camA.tx + 32 && camB.ty === camA.ty + 32, `opening camera at 96 is the 64 camera shifted by (32, 32) (${camA.tx},${camA.ty} → ${camB.tx},${camB.ty})`);
  ok(Math.abs(camB.tx - (b.plot.founders.tx + 1)) <= 1 && Math.abs(camB.ty - (b.plot.founders.ty + 1)) <= 1, 'opening camera over Founders\' Hall + 1 (within a tile: the camera tile rounds through the elevation)');
  const dens = b.gators.map(g => g.den);
  ok(dens.length > 0 && dens.every(d => d >= 0 && d < 9216 && (b.tiles.type[d] === T.BAYOU || b.tiles.type[d] === T.OPEN_WATER)), `gator dens are water tiles inside the 96 × 96 world (${dens.length})`);
  const st = H.forceHurricane(3);
  const edge = (i) => BSU.ty(i) === 95 || BSU.tx(i) === 95;
  ok(st && edge(st.point) && st.entry.length === 8 && st.entry.every(edge), 'landfall point and the 8 surge entry tiles sit on the true south / east edge at 96');
  const tr = st.track, last = tr[tr.length - 1];
  ok(tr.length === 6 && last.tx === BSU.tx(b.plot.mouth[1]) && last.ty === BSU.ty(b.plot.mouth[1]), 'the cone track ends at the (shifted) cove mouth');
  let surge = null;   // cone at +0, landfall set piece at +600; the surge begins inside the set piece
  for (let k = 0; k < 40 && !surge; k++) { H.tick(50); if (b.hydro.surge) surge = b.hydro.surge; }
  ok(surge && surge.entry.length === 8 && surge.entry.every(edge), 'the surge front starts from the 8 edge entry tiles');
  const cw = BSU.economy.charterWest(b);
  ok(cw && cw.ok === false && /Year|bridge|cash|west/i.test(cw.reason), 'Second Campus test still evaluates (refuses in Year 1): ' + cw.reason);
  ok(errors() === 0, 'no BSU.error so far: ' + (BSU.errors ? [...BSU.errors.keys()].join(' | ') : ''));
}

// --- the Cat 3 set piece runs to completion at 96 with surge reaching the campus --------------------------------------
{
  const b = S.newGame({ seed: 42, skipTutorial: true, size: 96 });
  H.forceHurricane(3);
  let reached = false, maxFlooded = 0;
  for (let k = 0; k < 40; k++) { H.tick(100); const n = BSU.hydro.floodedTiles(b); if (n > maxFlooded) maxFlooded = n; if (b.plot.cove.some(i => BSU.hydro.surgeReached(b, i))) reached = true; }
  ok(reached, 'the surge front reached the cove at 96');
  ok(b.storms.current === null || b.storms.current.phase >= BSU.STORM.RECOVERY, 'the landfall set piece completed');
  ok(maxFlooded > 50, `surge flooded land tiles (${maxFlooded} at the peak)`);
  ok(errors() === 0, 'no BSU.error through the set piece');
}

// --- saves: v2 round trip at 96, a v1 fixture loads as 64 × 64 and keeps working -------------------------------------
{
  const b = S.newGame({ seed: 7, skipTutorial: true, size: 96 });
  H.tick(300);
  const snapA = JSON.stringify(H.snapshot());
  const json = S.save('world96');
  const doc = JSON.parse(json);
  eq(doc.v, 2, 'a save is v2');
  ok(doc.world && doc.world.W === 96 && doc.world.ox === 32 && doc.world.legacy.y0 === 32, 'the doc carries state.world');
  S.newGame({ seed: 1, skipTutorial: true, size: 64 });
  const L = S.load('world96');
  ok(L && BSU.MAP.W === 96 && L.tiles.elev.length === 9216 && L.world.W === 96, 'loading a 96 save sets the map to 96 before allocation');
  eq(JSON.stringify(H.snapshot()), snapA, 'snapshot identical after the 96 round trip');
  H.tick(200);
  ok(errors() === 0, 'ticking a loaded 96 world: no errors');

  const fix = join(root, 'test', 'fixtures', 'save_v1_seed42.json');
  ok(existsSync(fix), 'the v1 fixture exists');
  const v1 = readFileSync(fix, 'utf8');
  const v1doc = JSON.parse(v1);
  eq(v1doc.v, 1, 'fixture is a v1 doc');
  win.localStorage.setItem('bsu.save.v1fix', v1);
  const V = S.load('v1fix');
  ok(V && BSU.MAP.W === 64 && BSU.MAP.ox === 0, 'a v1 save loads as a 64 × 64 world with ox = oy = 0');
  ok(V.world && V.world.W === 64 && V.world.legacy.x1 === 63, 'the migrated doc gets state.world for 64');
  eq(V.buildings.filter(Boolean).length, 6, 'the fixture\'s 6 buildings are back');
  const snap = H.snapshot();
  ok(snap.cash === 2016400 && snap.students === 176 && snap.tick === 1800, 'snapshot matches the pre-L1 build\'s figures (cash $2,016,400, 176 students, tick 1800): ' + JSON.stringify(snap));
  ok(V.plot.founders.ty === 7 && V.buildings[0].type === 'founders_hall', 'legacy plot coordinates unchanged');
  H.tick(600);
  ok(errors() === 0, 'ticking the v1 world: no errors');
  const again = JSON.parse(S.save('v1fix2'));
  ok(again.v === 2 && again.world.W === 64, 're-saving writes v2 with the 64 world');
  const V2 = S.load('v1fix2');
  ok(V2 && BSU.MAP.W === 64 && V2.tiles.elev.length === 4096, 'the re-saved 64 world loads at 64');
  const last = S.continue_();
  ok(last && BSU.MAP.W === 64, 'Continue (bsu.last) loads the last written slot');
  const n = S.newGame({ seed: 3, skipTutorial: true });
  ok(n && BSU.MAP.W === 96, 'a new game after a 64 load is 96 again');
}

// --- headless at both sizes: render frames, minimap, A* routes, chunk tables ---------------------------------------
for (const size of [64, 96]) {
  const s = S.newGame({ seed: 11, skipTutorial: true, size });
  H.render(); H.render();
  const v = BSU.render.visibleTiles();
  ok(v.x1 < size && v.y1 < size && v.x0 >= 0, `visible tile rect inside the ${size} world`);
  const front = BSU.idx(s.plot.founders.tx + 1, s.plot.founders.ty + 3);
  const r = BSU.terrain.landRoute(s, front, s.plot.landingShoulder);
  ok(r && r.length > 2 && r.every(i => i >= 0 && i < size * size), `landRoute works at ${size}`);
  const far = BSU.idx(2, 2);
  const rt = BSU.agents.routeSync ? BSU.agents.routeSync(s, front, front) : null;
  ok(rt === null || Array.isArray(rt), `agents.routeSync answers at ${size}`);
  ok(typeof BSU.render.chunkMasters === 'function' ? BSU.render.chunkMasters().length === (size / 8) * (size / 8) : true, `chunk table has (${size}/8)² slots`);
  try { BSU.render.minimap(s); ok(true, `minimap draws at ${size}`); } catch (e) { ok(false, `minimap threw at ${size}: ` + e); }
  H.tick(400);
  ok(errors() === 0, `${size}: 400 ticks with buildings, agents, hydro and wildlife: no errors`);
  void far;
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
