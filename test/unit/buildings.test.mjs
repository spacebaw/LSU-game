// Unit test for src/js/buildings.js: loads contract.js + the manifest modules that exist before
// buildings.js (missing ones are stubbed per docs/briefs/buildings.md §7), then buildings.js,
// through makeWindow() from test/domstub.mjs with vm.runInContext; runs BSU.buildings.selfTest()
// and the scenario checks from the brief's "Done means" list.
// Usage: node test/unit/buildings.test.mjs   (exit 1 on any failure)
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

// --- load ------------------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'buildings.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
const upTo = manifest.slice(0, manifest.indexOf('buildings.js'));
const loaded = new Set();
for (const f of upTo) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f });
  loaded.add(f);
}
// brief §7 stubs for the modules that do not exist yet
vm.runInContext(`
  BSU.terrain = BSU.terrain || { setSurface(s,i,v){ s.tiles.surface[i]=v; BSU.terrain.touch(s,i,'surface'); }, setElev(s,i,v){ s.tiles.elev[i]=v; }, setFlag(s,i,b,on){ on? s.tiles.flags[i]|=b : s.tiles.flags[i]&=~b; }, touch(s,i,w){ BSU.events.emit(BSU.EV.TILE_CHANGED,{i,tx:i&63,ty:i>>6,what:w,chunk:0}); }, rewalk(){}, classify(){}, ridgeFull(){ return null; }, plantVeg(s,t,x,y){ s.veg.push({type:t,tx:x,ty:y,stage:0,plantedDay:0,planted:true}); }, removeVeg(s,k){ s.veg.splice(k,1); }, bank(ty){ return 57; } };
  BSU.hydro = BSU.hydro || { footprintDepth(){ return 0; }, depthAt(){ return 0; }, riskAt(){ return 0; }, markCanal(s,i,on){ on? s.tiles.flags[i]|=BSU.FLAG.CANAL : s.tiles.flags[i]&=~BSU.FLAG.CANAL; }, markPond(){}, markLeveeChange(){}, networks(){ return []; }, stormLog(){ return {held:[],overtopped:[],breached:[]}; }, floodedBuildings(){ return []; }, pumpRunning(){ return false; } };
  BSU.economy = BSU.economy || { canAfford(s,c){ return s.economy.cash - c >= -s.economy.loanLimit; }, charge(s,c,k){ if (!this.canAfford(s,c)) return false; s.economy.cash -= c; return true; }, refund(s,a){ s.economy.cash += a; }, post(){} };
  BSU.progress = BSU.progress || { unlocked(){ return true; }, unlockReason(){ return ''; }, unlockOk(){ return true; }, earned(){ return false; }, timer(){ return null; }, timers(){ return []; }, removeTimer(){}, receiverActive(){ return false; } };
  BSU.weather = BSU.weather || { date(s){ return BSU.dayParts(s.calendar.day); }, storm(s){ return s.storms.current; }, forecastSurge(){ return 5; } };
  BSU.wildlife = BSU.wildlife || { onCampus(){ return []; }, nutriaTraps(){ return false; }, applyEcologyOnce(){} };
`, ctx);
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'buildings.js' }); } catch (e) { threw = e; }
const loadMs = performance.now() - t0;
ok(!threw, 'buildings.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(loadMs < 50, `definition time ${loadMs.toFixed(1)} ms < 50 ms`);
const BSU = win.BSU;
const B = BSU.buildings;
ok(B && typeof B === 'object', 'BSU.buildings exists');
for (const fn of ['init', 'reset', 'tick', 'selfTest', 'canPlace', 'place', 'placeRun', 'remove', 'undo', 'list', 'get', 'at', 'count', 'has', 'footprint', 'coverage', 'auras', 'recomputeCoverage', 'protection', 'gaps', 'ringClosed', 'coveTilesUnreached', 'boundaryLevees', 'repair', 'repairAll', 'repairLevee', 'repairAllLevees', 'retrofitPilings', 'regrade', 'rename', 'upgrade', 'setPolicy', 'refuel', 'boardUp', 'sandbags', 'applyWindPulse', 'applySubsidence', 'onIntegrityChanged', 'damageReport', 'shelter', 'shelterAssignments', 'stats', 'upkeepTotal', 'leveeRuns', 'dumpsterTile', 'unlocked', 'constructionMult', 'effective', 'dirtyRing', 'shelterOverflow', 'gatorClosed', 'boilWaterTriggered', 'clearBoilWater']) {
  ok(typeof B[fn] === 'function', 'BSU.buildings.' + fn + ' is a function');
}
ok(B.placeOpts && typeof B.placeOpts === 'object', 'placeOpts documented');

// --- init on a dummy root, then selfTest (harness-owned flag) --------------
const dummy = BSU.newState(0);
BSU.state = dummy;
B.init(dummy); B.reset(dummy, true);
const errorsBefore = BSU.errors.size;
BSU.SELFTEST = true;
let st;
const t1 = performance.now();
try { st = B.selfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t1;
ok(st && st.ok === true, 'selfTest().ok === true — ' + (st && st.notes));
ok(BSU.errors.size === errorsBefore, 'BSU.errors did not grow during selfTest');
ok(stMs < 200, `selfTest ran in ${stMs.toFixed(1)} ms < 200 ms`);

// --- scenario: the brief §7 isolation script (Founders' + a dorm, 2 days → Boudreaux Hall) -----
const s = BSU.newState(21);
for (let i = 0; i < 4096; i++) { s.tiles.owner[i] = -1; s.tiles.elev[i] = 6; s.tiles.type[i] = BSU.T.DRY; }
s.plot.bank0 = 57; s.plot.founders = { tx: 50, ty: 7 }; s.plot.highway = [52, 116, 180, 244, 308, 372, 436]; s.plot.cove = []; s.plot.mouth = [0, 0, 0]; s.plot.bayou = []; s.plot.cheniers = []; s.plot.mounds = [];
for (const i of s.plot.highway) s.tiles.surface[i] = 2;
s.economy.suppressCoverage = false;
BSU.state = s;
B.reset(s, true);
const pf = B.place(s, 'founders_hall', 50, 7, { ignoreCash: true, instant: true });
ok(pf.ok && pf.id === 0 && s.buildings[0].built === 1, "Founders' Hall placed instantly and free");
eq(s.economy.cash, 4000000, 'founders was free');
const cp = B.canPlace(s, 'dorm', 46, 7, { rot: 0 });
ok(cp.ok && cp.color === 'green' && cp.cost === 700000 && cp.access, 'dorm next to Founders\' edge tile: ' + cp.reason);
const lay = (x, y, v = 1) => BSU.terrain.setSurface(s, BSU.idx(x, y), v);   // through the terrain API → tile:changed
const events = [];
for (const n of ['building:placed', 'building:complete', 'coverage:changed', 'ring:changed', 'power:blackout']) BSU.events.on(n, (p) => events.push({ n, p }), 'test');
const pd = B.place(s, 'dorm', 46, 7, { rot: 0 });
ok(pd.ok && pd.id === 1, 'dorm placed');
eq(s.economy.cash, 3300000, 'place charges cash (economy stub)');
eq(s.buildings[1].name, 'Boudreaux Hall', 'auto-name Boudreaux Hall');
eq(s.buildings[1].built, 0, 'built starts at 0');
ok(events.some(e => e.n === 'building:placed' && e.p.id === 1 && e.p.type === 'dorm' && e.p.cost === 700000), 'building:placed reached the live bus with cost');
for (let d = 1; d <= 3; d++) { s.calendar.day = d; B.tick(s, { newDay: true, newMonth: false, newYear: false, day: d }); }
eq(s.buildings[1].built, 1, 'dorm complete after 2 days');
eq(s.buildings[1].builtDay, 2, 'builtDay 2');
eq(events.filter(e => e.n === 'building:complete' && e.p.id === 1).length, 1, 'building:complete exactly once');
const pd2 = B.place(s, 'dorm', 46, 9, { rot: 0 });
ok(pd2.ok && s.buildings[pd2.id].name === 'Fontenot Hall', 'second dorm is Fontenot Hall (' + (pd2.ok ? s.buildings[pd2.id].name : pd2.reason) + ')');

// --- scenario: illegal placements carry the documented reasons ----------------
eq(B.canPlace(s, 'dorm', 20, 40, {}).reason, 'Needs a path', 'no path reason');
eq(B.canPlace(s, 'stadium', 40, 20, {}).reason, 'Needs a path', 'stadium: access checked before road (order)');
eq(B.canPlace(s, 'dorm', 50, 8, {}).reason, 'Occupied', 'occupied reason');
eq(B.canPlace(s, 'founders_hall', 10, 10, {}).reason, 'Founders’ Hall goes on the ridge', 'founders elsewhere');
for (let y = 10; y <= 16; y++) lay(50, y);
s.economy.cash = -1900000;
eq(B.canPlace(s, 'dorm', 47, 11, {}).reason, 'Not enough cash', 'cash reason');
ok(B.canPlace(s, 'dorm', 47, 11, { ignoreCash: true }).ok, 'ignoreCash still validates and passes');
s.economy.cash = 4000000;
// preserve refused for a dorm; marsh gives pilings
for (let x = 20; x <= 25; x++) for (let y = 20; y <= 25; y++) { const i = BSU.idx(x, y); s.tiles.elev[i] = 1; s.tiles.type[i] = BSU.T.MARSH; }
for (let x = 26; x <= 40; x++) lay(x, 22);   // a path (unconnected)
eq(B.canPlace(s, 'dorm', 23, 21, {}).reason, 'Needs a path', 'unconnected path does not count');
for (let y = 8; y <= 22; y++) lay(40, y);    // connect it to the Founders' ring
for (let x = 40; x <= 49; x++) lay(x, 8);    // (49,8) is a Founders' west edge tile
B.tick(s, {});
const mp = B.canPlace(s, 'dorm', 23, 21, {});
ok(mp.ok && mp.needsPilings && mp.pilingsCost === 280000 && mp.color === 'yellow' && mp.cost === 980000, 'marsh dorm: pilings auto-applied (' + mp.reason + ' ' + mp.cost + ')');
s.tiles.flags[BSU.idx(23, 21)] |= BSU.FLAG.PRESERVE;
eq(B.canPlace(s, 'dorm', 23, 21, {}).reason, 'Preserve', 'preserve reason');
s.tiles.flags[BSU.idx(23, 21)] &= ~BSU.FLAG.PRESERVE;
eq(B.canPlace(s, 'road', 23, 23, {}).reason, 'Use a Boardwalk or a bridge', 'road on marsh');
ok(B.canPlace(s, 'boardwalk', 23, 23, {}).ok, 'boardwalk on marsh');

// --- scenario: cost math (§0.3 examples) --------------------------------------
for (let x = 30; x <= 32; x++) for (let y = 12; y <= 13; y++) { const i = BSU.idx(x, y); s.tiles.elev[i] = 2.5; s.tiles.type[i] = BSU.T.WET; }
for (let x = 30; x <= 33; x++) lay(x, 14); for (let y = 8; y <= 14; y++) lay(33, y); for (let x = 34; x <= 40; x++) lay(x, 8);
B.tick(s, {});
const wet = B.canPlace(s, 'dorm', 30, 12, {});
ok(wet.ok && Math.abs(wet.terrainMod - 0.2) < 1e-9 && wet.cost === 840000, 'Wet +20% → $840k (' + wet.reason + ' ' + wet.cost + ')');
s.calendar.day = BSU.dateToDay('Jun 1', 1);
const sum = B.canPlace(s, 'dorm', 30, 12, {});
ok(sum.summer && sum.cost === Math.round(700000 * 1.2 * 0.85), 'summer −15% on top: ' + sum.cost);
eq(B.constructionMult(s), 0.85, 'constructionMult in summer');
s.calendar.day = 3;
s.tiles.elev[BSU.idx(30, 12)] = 4.5;
const gr = B.canPlace(s, 'dorm', 30, 12, {});
ok(gr.needsGrading && gr.gradingCost === 90000 && gr.cost === 840000 + 90000, 'grading $15k × 6 (' + gr.cost + ')');
const pg = B.place(s, 'dorm', 30, 12, {});
ok(pg.ok && Math.abs(s.tiles.elev[BSU.idx(30, 12)] - s.tiles.elev[BSU.idx(31, 12)]) < 1e-6, 'grading levelled the footprint');

// --- scenario: coverage + effective + undo/demolish on the live bus ---------------
const ps = B.place(s, 'substation', 44, 3, {}), pt = B.place(s, 'water_tower', 44, 5, {});
ok(!ps.ok && ps.reason === 'Needs a path', 'substation needs a path too: ' + ps.reason);
for (let x = 41; x <= 46; x++) lay(x, 9);
for (let y = 3; y <= 9; y++) lay(43, y);
B.tick(s, {});
const ps2 = B.place(s, 'substation', 44, 3, {}), pt2 = B.place(s, 'water_tower', 44, 5, {});
ok(ps2.ok && pt2.ok, 'substation + tower placed (' + ps2.reason + ' / ' + pt2.reason + ')');
for (let d = 4; d <= 6; d++) { s.calendar.day = d; B.tick(s, { newDay: true, day: d }); }
ok(s.buildings[1].powered && s.buildings[1].watered && s.buildings[0].powered, 'dorm and Founders\' covered');
eq(B.effective(s, 1), 1, 'effective 1');
ok(B.coverage(s, 'power', 46, 7) === 1 && B.coverage(s, 'water', 46, 7) === 1, 'coverage(power/water) at the dorm');
ok(B.stats(s).beds === 750 && B.stats(s).seats === 300, 'stats beds 300 + 300 + 150 (half-covered) / seats 300 (' + JSON.stringify([B.stats(s).beds, B.stats(s).seats]) + ')');
s.buildings[ps2.id].flooded = true; BSU.events.emit('building:flooded', { id: ps2.id, type: 'substation', depth: 0.4 }); B.tick(s, {});
ok(events.some(e => e.n === 'power:blackout' && e.p.provider === ps2.id && e.p.cause === 'flood'), 'flooded substation → power:blackout on the bus');
eq(B.effective(s, 1), 0.5, 'dorm at 0.5 without power');
s.buildings[ps2.id].flooded = false; BSU.events.emit('building:dried', { id: ps2.id, type: 'substation', depth: 0 }); B.tick(s, {});
eq(B.effective(s, 1), 1, 'restored');
const cashBefore = s.economy.cash;
const rm = B.remove(s, pg.id);
ok(rm.ok && rm.refund === 280000 && s.economy.cash === cashBefore + 280000 && s.buildings[pg.id] === null, 'demolish refunds 40% and leaves a null hole');
ok(B.remove(s, 0).ok === false, "Founders' refuses demolition");
s.tick = 500;
const cash2 = s.economy.cash;
const p3 = B.place(s, 'poboy', 49, 12, {});
ok(p3.ok, 'poboy placed for undo: ' + p3.reason);
s.tick = 530;
ok(B.undo(s).ok && s.buildings[p3.id] === null && s.economy.cash === cash2, 'undo refunds the full cost');
ok(B.list(s).every(b => b.id === s.buildings.indexOf(b)), 'id === index for every building');

// --- scenario: ring / gaps / sandbags on a levee square with a pump inside ---------
const s2 = BSU.newState(5);
for (let i = 0; i < 4096; i++) { s2.tiles.owner[i] = -1; s2.tiles.elev[i] = 2; s2.tiles.type[i] = BSU.T.WET; }
BSU.state = s2; B.reset(s2, true);
for (let x = 10; x <= 19; x++) for (let y = 10; y <= 19; y++) { const i = BSU.idx(x, y); if (x === 10 || x === 19 || y === 10 || y === 19) { s2.tiles.crest[i] = 6; s2.tiles.integrity[i] = 100; } else s2.tiles.elev[i] = 3; }
s2.buildings.push({ id: 0, type: 'pump', tx: 14, ty: 14, w: 2, h: 2, rot: 0, name: 'Pump Station 1', hp: 1, built: 1, builtDay: 0, pilings: false, sunk: 0, powered: true, watered: false, provider: { power: -1, water: -1 }, flooded: false, floodedSince: -1, closedUntil: -1, blackout: false, tier: 0, upgradeDoneDay: -1, ruin: false, tarp: false, data: { fuelDays: 0, stockedDay: -1, active: true, policies: { gatorProofDumpsters: false, nutriaBounty: false }, boardedUntil: -1, regradeUntil: -1, dumpsterTile: -1, seed: 1 } });
for (const i of BSU.footprintTiles(14, 14, 2, 2)) s2.tiles.owner[i] = 0;
B.dirtyRing(s2);
ok(B.ringClosed(s2, 5) === true && B.gaps(s2, 5).gaps.length === 0, 'closed levee square at H 5');
ok(B.ringClosed(s2, 8) === false, 'the same square is overtopped at H 8 (crest 8 ≥ 8)');
s2.tiles.crest[BSU.idx(15, 10)] = 0; B.dirtyRing(s2);
const gp = B.gaps(s2, 5);
ok(!B.ringClosed(s2, 5) && gp.gaps.length === 1 && gp.gaps[0].len >= 1 && typeof gp.gaps[0].name === 'string', 'one gap reported: ' + (gp.gaps[0] && gp.gaps[0].name));
s2.tiles.crest[BSU.idx(15, 10)] = 6; s2.tiles.integrity[BSU.idx(15, 10)] = 100; B.onIntegrityChanged(s2, BSU.idx(15, 10));
const sb = B.sandbags(s2, 5);
ok(sb.ok && sb.cost === 40000 && sb.tiles.length === 36 && s2.tiles.sandbag[BSU.idx(10, 10)] === 15, 'sandbags on 36 boundary tiles for $40k');
ok(B.ringClosed(s2, 8) === true, 'sandbagged square (9.5 ft) holds H 8');
const lr = B.leveeRuns(s2);
ok(lr.length === 1 && lr[0].tiles.length === 36 && lr[0].name === 'The Great Wall of Boudreaux', 'levee run auto-named');

// --- design pass: setbackSpot (soft spacing) ---------------------------------------
{
  const sd = BSU.newState(23); Object.assign(sd, JSON.parse(JSON.stringify({ plot: s.plot })));
  B.reset(sd, true);
  for (const k of ['type', 'elev', 'flags', 'surface', 'owner', 'crest', 'depth']) if (s.tiles[k] && sd.tiles[k]) sd.tiles[k].set(s.tiles[k]);
  sd.economy.cash = 1e9;
  let spot = null;
  for (let ty = 2; ty < 40 && !spot; ty++) for (let tx = 30; tx < 62; tx++) { const r = B.canPlace(sd, 'lecture_hall', tx, ty, { rot: 0 }); if (r && r.ok) { spot = { tx, ty }; break; } }
  if (spot) {
    const free = B.setbackSpot(sd, 'lecture_hall', spot.tx, spot.ty, { rot: 0 });
    ok(free && free.tx === spot.tx && free.ty === spot.ty && free.snapped === false && free.touching === false, 'setbackSpot leaves a free spot alone');
    const pr = B.place(sd, 'lecture_hall', spot.tx, spot.ty, { rot: 0 }); ok(pr.ok, 'lecture hall placed for the setback scenario');
    // a lecture hall flush against the first one's east side
    const sb = B.setbackSpot(sd, 'lecture_hall', spot.tx + 3, spot.ty, { rot: 0 });
    ok(sb && sb.touching === true, 'a flush footprint is reported as touching');
    if (sb.snapped) {
      let touch = false; for (const e of BSU.edgeTiles(sb.tx, sb.ty, 3, 2)) if (sd.tiles.owner[e] >= 0) touch = true;
      ok(!touch && Math.abs(sb.tx - spot.tx - 3) <= 1 && Math.abs(sb.ty - spot.ty) <= 1 && B.canPlace(sd, 'lecture_hall', sb.tx, sb.ty, { rot: 0 }).ok, `snapped within one tile to a legal gap spot (${sb.tx}, ${sb.ty})`);
    } else ok(sb.tx === spot.tx + 3 && sb.ty === spot.ty, 'no legal gap spot within one tile → the flush position is kept (never refuses)');
  } else ok(true, 'setbackSpot scenario skipped: no lecture hall spot on the synthetic plot');
  const junk = B.setbackSpot(sd, 'path', 5, 5, {}); ok(junk.snapped === false && junk.tx === 5, 'drag rows are never snapped');
  ok(B.setbackSpot(null, 'dorm', 1, 1).tx === 1 && B.setbackSpot(sd, 'nope', 1, 1).snapped === false, 'setbackSpot tolerates garbage');
}

// --- scenario: undo pass — a drag run is undone EXACTLY (surface, flags, crest, integrity, elevation, walk class, cash) --------
{
  const su = BSU.newState(31);
  for (let i = 0; i < 4096; i++) { su.tiles.owner[i] = -1; su.tiles.elev[i] = 6; su.tiles.type[i] = BSU.T.DRY; su.tiles.surface[i] = 0; su.tiles.crest[i] = 0; su.tiles.flags[i] = 0; }
  su.plot.bank0 = 57; su.plot.founders = { tx: 50, ty: 7 }; su.plot.highway = []; su.plot.cove = []; su.plot.mouth = [0, 0, 0]; su.plot.bayou = []; su.plot.cheniers = []; su.plot.mounds = [];
  su.economy.suppressCoverage = true; su.economy.cash = 50000000;
  BSU.state = su; B.reset(su, true);
  BSU.terrain.rewalk(su);
  const A = ['surface', 'crest', 'integrity', 'flags', 'elev', 'walk', 'owner', 'type'];
  const snap = () => { const o = {}; for (const k of A) o[k] = su.tiles[k].slice(); o.cash = su.economy.cash; o.veg = su.veg.length; return o; };
  const same = (a, b) => { for (const k of A) for (let i = 0; i < a[k].length; i++) if (a[k][i] !== b[k][i]) return k + '[' + i + '] ' + a[k][i] + ' != ' + b[k][i]; return a.cash === b.cash && a.veg === b.veg ? '' : 'cash/veg ' + a.cash + '/' + b.cash; };
  const Lrun = [], tx0 = 12, ty0 = 30;
  for (let x = tx0; x <= tx0 + 4; x++) Lrun.push(BSU.idx(x, ty0));
  for (let y = ty0 + 1; y <= ty0 + 3; y++) Lrun.push(BSU.idx(tx0 + 4, y));
  // 1. an L-shaped gravel path
  su.tick = 1000; const before = snap();
  const pr = B.placeRun(su, 'path', Lrun, {});
  ok(pr.ok && pr.placed === Lrun.length && pr.cost === 2000 * Lrun.length, 'path run placed: ' + pr.placed + ' tiles for ' + pr.cost);
  ok(su.tiles.surface[Lrun[3]] === BSU.SURF.PATH && su.economy.cash === before.cash - pr.cost, 'path surface laid, cash charged');
  const inf = B.undoInfo(su);
  ok(inf && inf.n === Lrun.length && inf.refund === pr.cost && /path/i.test(inf.name) && inf.ticksLeft > 0, 'undoInfo reports what Undo will take back: ' + JSON.stringify(inf));
  su.tick = 1020;
  const un = B.undo(su);
  ok(un.ok && un.refund === pr.cost && un.n === Lrun.length, 'run undo ok, refund ' + un.refund);
  eq(same(before, snap()), '', 'path run undone: every tile array and the cash are exactly as before');
  ok(B.undoInfo(su) === null && B.undo(su).ok === false, 'a second undo has nothing to take');
  // 2. a road run over an existing path (prev surface PATH must come back, not NONE)
  B.placeRun(su, 'path', Lrun, {}); su.tick = 1100; const b2 = snap();
  const fr = B.placeRun(su, 'road', Lrun.slice(0, 4), {});
  ok(fr.ok && su.tiles.surface[Lrun[1]] === BSU.SURF.ROAD, 'road laid over the path: ' + JSON.stringify(fr));
  ok(B.undo(su).ok, 'road run undone'); eq(same(b2, snap()), '', 'road undo restores the PATH surface under it');
  const fz = [BSU.idx(60, 50), BSU.idx(61, 50), BSU.idx(62, 50)]; const bf = snap();
  const fnr = B.placeRun(su, 'gator_fence', fz, {});
  if (fnr.ok) { ok(B.undo(su).ok, 'fence run undone'); eq(same(bf, snap()), '', 'fence undo exact'); } else ok(true, 'fence run skipped on bare ground: ' + (fnr.skipped[0] && fnr.skipped[0].reason));
  const cRun = []; for (let x = 20; x <= 26; x++) cRun.push(BSU.idx(x, 40));
  su.tick = 1200; const b3 = snap();
  const cr = B.placeRun(su, 'canal', cRun, {});
  ok(cr.ok && cr.placed === cRun.length && (su.tiles.flags[cRun[2]] & BSU.FLAG.CANAL) !== 0 && su.tiles.elev[cRun[2]] < 6, 'canal dug: flag set and bed cut');
  const eco0 = su.wildlife && su.wildlife.ecologyTerms ? su.wildlife.ecologyTerms.once : 0;
  ok(B.undo(su).ok, 'canal run undone'); eq(same(b3, snap()), '', 'canal undo restores flags, elevation, walk class and cash exactly');
  const lRun = []; for (let x = 30; x <= 36; x++) lRun.push(BSU.idx(x, 44));
  su.tick = 1300; const b4 = snap();
  const lr = B.placeRun(su, 'levee', lRun, {});
  ok(lr.ok && su.tiles.crest[lRun[3]] > 0, 'levee raised');
  ok(B.undo(su).ok, 'levee run undone'); eq(same(b4, snap()), '', 'levee undo restores crest, integrity, flags and cash exactly');
  // levee over a canal tile = a floodgate; its undo must clear the floodgate and leave the canal
  B.placeRun(su, 'canal', cRun, {}); su.tick = 1400; const b5 = snap();
  B.placeRun(su, 'levee', cRun.slice(2, 4), {}); ok((su.tiles.flags[cRun[2]] & BSU.FLAG.FLOODGATE) !== 0, 'levee across the canal makes a floodgate');
  ok(B.undo(su).ok, 'floodgate levee undone'); eq(same(b5, snap()), '', 'floodgate undo leaves the plain canal');
  B.undo(su);
  // 3. the window: refused once it has closed, nothing changes, no money appears
  B.remove(su, { tile: Lrun[0] }); for (const i of Lrun) B.remove(su, { tile: i }); const Mrun = Lrun.map(i => i + 64 * 8); su.tick = 2000; const b6pre = snap(); B.placeRun(su, 'path', Mrun, {}); const b6 = snap();
  su.tick = 2000 + 51;
  ok(B.undoInfo(su) === null, 'undoInfo is null once the window has closed');
  const late = B.undo(su);
  ok(late.ok === false && /Too late/.test(late.reason) && same(b6, snap()) === '', 'undo refused after the window: ' + late.reason);
  void b6pre;
  // 4. something changed since: refused with a reason, and the refund cannot be farmed
  su.tick = 3000; B.remove(su, { tile: Mrun[0] }); for (const i of Mrun) B.remove(su, { tile: i }); const Nrun = Lrun.map(i => i + 64 * 14); B.placeRun(su, 'path', Nrun, {}); const cashRun = su.economy.cash;
  ok(B.remove(su, { tile: Nrun[2] }).ok, 'one tile of the run bulldozed afterwards');
  const cashMid = su.economy.cash; su.tick = 3010;
  const blocked = B.undo(su);
  ok(blocked.ok === false && /changed since/.test(blocked.reason) && su.economy.cash === cashMid && su.tiles.surface[Nrun[1]] === BSU.SURF.PATH, 'undo refused when a tile was changed since: ' + blocked.reason);
  ok(B.undo(su).ok === false, 'the blocked record is dropped');
  // 5. demolished since: refused, and the refund cannot be farmed (tree and building)
  su.tick = 4000; const oak = B.place(su, 'live_oak', 46, 16, {}); ok(oak.ok, 'live oak planted: ' + oak.reason);
  const oi = B.undoInfo(su); ok(oi && oi.n === 1 && oi.refund === oak.cost && /oak/i.test(oi.name), 'tree undoInfo: ' + JSON.stringify(oi));
  B.remove(su, { tile: BSU.idx(46, 16) }); su.tick = 4005; const cashOak = su.economy.cash;
  const goneT = B.undo(su); ok(goneT.ok === false && /tree is gone/.test(goneT.reason) && su.economy.cash === cashOak, 'undo of a removed tree refused: ' + goneT.reason);
  su.tick = 4010; const oak2 = B.place(su, 'live_oak', 47, 16, {}); ok(oak2.ok && su.veg.some(v => v.tx === 47 && v.ty === 16), 'second oak planted');
  ok(B.undo(su).ok && !su.veg.some(v => v.tx === 47 && v.ty === 16), 'undo removes the planted tree (terrain.removeVeg takes tx,ty)');
  su.tick = 4020; B.place(su, 'live_oak', 48, 16, {}); su.tick = 4030; B.undo(su); su.tick = 4040; B.place(su, 'live_oak', 48, 16, {}); B.remove(su, { tile: BSU.idx(48, 16) }); ok(!su.veg.some(v => v.tx === 48 && v.ty === 16), 'bulldozing a tree removes it');
  su.veg.push({ type: 'oak', tx: 49, ty: 20, stage: 3, plantedDay: 0 }); const wild = B.remove(su, { tile: BSU.idx(49, 20) });
  ok(wild.ok && wild.refund === 0 && !su.veg.some(v => v.tx === 49 && v.ty === 20), 'bulldozing a wild tree clears it for no refund');
  let bid = null, bp = null;
  for (const cand of ['pond', 'water_tower', 'substation', 'gazebo', 'bandstand']) { su.tick = 4100; bp = B.place(su, cand, 50, 22, {}); if (bp.ok) { bid = cand; break; } }
  if (bid) {
    const bi = B.undoInfo(su); ok(bi && bi.n === 1 && bi.refund === bp.cost, 'building undoInfo (' + bid + '): ' + JSON.stringify(bi));
    B.remove(su, bp.id); su.tick = 4105; const cashB = su.economy.cash;
    const goneB = B.undo(su); ok(goneB.ok === false && /gone|replaced/.test(goneB.reason) && su.economy.cash === cashB, 'undo of a demolished building refused: ' + goneB.reason);
    su.tick = 4200; const bp2 = B.place(su, bid, 50, 22, {}); ok(bp2.ok && B.undo(su).ok && su.buildings[bp2.id] === null, bid + ' placed and undone');
  } else ok(true, 'no no-path building placeable on the synthetic plot; building undo covered by the selfTest');
}

// --- scenario: no exceptions on garbage input -------------------------------------
let threwAny = false;
try {
  B.canPlace(null, 'dorm', 1, 1); B.canPlace(s2, undefined, NaN, Infinity); B.place(s2, 'dorm', 'a', {}); B.remove(s2, { tile: 99999 }); B.remove(s2, 'x');
  B.undo(null); B.repair(s2, 77); B.upgrade(s2, -1); B.sandbags(s2, NaN); B.gaps(s2, undefined); B.effective(s2, 'q'); B.stats(BSU.newState(9)); B.shelter(BSU.newState(9));
  B.tick(null); B.tick(s2, null); B.applyWindPulse(s2, 1, 1 / 3); B.damageReport(s2, null); B.coverage(s2, 'life', -1, 400); B.placeRun(s2, 'levee', [1, 'x', -5, 99999]);
} catch (e) { threwAny = true; console.error(e); }
ok(!threwAny, 'public functions never throw on bad input');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
