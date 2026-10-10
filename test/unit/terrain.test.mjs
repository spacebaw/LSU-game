// Unit test for src/js/terrain.js: loads contract.js (+ every earlier manifest module that exists),
// stubs the later modules terrain talks to (hydro, buildings, wildlife) when they are not written yet,
// loads terrain.js through makeWindow() from test/domstub.mjs with vm.runInContext, runs
// BSU.terrain.selfTest() under BSU.SELFTEST and the scenario checks from docs/briefs/terrain.md §9 "Done means".
// Usage: node test/unit/terrain.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import { loadavg } from 'node:os';
const BUSY = loadavg()[0] > 3;   // timing budgets are advisory when the machine is loaded
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

// --- load ------------------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'terrain.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
ok(!/Math\.random/.test(src), 'no Math.random in source');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
const upTo = manifest.slice(0, manifest.indexOf('terrain.js'));
for (const f of upTo) {
  const p = join(root, 'src', 'js', f);
  if (!existsSync(p)) { console.log('skip:', f, '(not written yet)'); continue; }
  vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f });
}
// later modules terrain calls at gen/tick time: load the real ones when they exist, else stub the documented surface
const later = ['hydro.js', 'weather.js', 'wildlife.js', 'buildings.js'];
for (const f of later) {
  const p = join(root, 'src', 'js', f);
  if (existsSync(p)) { try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); console.log('load:', f); } catch (e) { console.log('skip:', f, '(failed to load standalone:', e.message + ')'); } }
}
vm.runInContext(`
  BSU.hydro = BSU.hydro || { seedInitial(s){ const {T}=BSU; for(let i=0;i<4096;i++){ const t=s.tiles.type[i]; s.tiles.depth[i]= t===T.MARSH?0.25: (t===T.OPEN_WATER||t===T.BAYOU)? -s.tiles.elev[i] : 0; s.tiles.sat[i]= t===T.MARSH?0.9:(t===T.OPEN_WATER||t===T.BAYOU)?1:0.5; } },
    surfaceAt(s,i){ return s.tiles.elev[i]+s.tiles.depth[i]; }, stageAt(){ return 0; }, drainsTo(){ return 'ground'; }, markLeveeChange(){ BSU.__leveeCalls = (BSU.__leveeCalls||0)+1; } };
  BSU.buildings = BSU.buildings || { get(s,id){ return s.buildings[id]||null; }, list(){ return []; }, applySubsidence(s,id,ft){ (BSU.__subs ||= []).push([id,ft]); } };
  BSU.wildlife = BSU.wildlife || { nutriaTraps(){ return false; } };
`, ctx);
vm.runInContext(`
  (function(){ const h = BSU.hydro; const orig = h.markLeveeChange; h.markLeveeChange = function(){ BSU.__leveeCalls = (BSU.__leveeCalls||0)+1; return orig ? orig.apply(this, arguments) : undefined; }; })();
`, ctx);
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'terrain.js' }); } catch (e) { threw = e; }
ok(!threw, 'terrain.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(performance.now() - t0 < 50, 'definition time < 50 ms');
const BSU = win.BSU;
const M = BSU.terrain;
const { T, FLAG: F, SURF, EV } = BSU;
ok(M && ['init', 'reset', 'tick', 'selfTest', 'gen', 'classify', 'rewalk', 'touch', 'setSurface', 'setElev', 'setFlag', 'tileAt', 'isLand', 'isWater', 'reachableDryHigh', 'reachableHigh5', 'ridgeFull', 'applySubsidenceYear', 'bank', 'guarantees', 'streetlamps', 'paradeRoute', 'template', 'walkClassOf', 'landRoute', 'subsidenceRate', 'plantVeg', 'removeVeg', 'isDisturbedMarsh'].every(k => typeof M[k] === 'function'), 'public surface present (ARCH §5.2 + brief §1)');

// --- selfTest under the harness flag ------------------------------------------
{
  const errorsBefore = BSU.errors.size;
  BSU.SELFTEST = true;
  let r;
  const t1 = performance.now();
  try { r = M.selfTest(); } catch (e) { r = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
  const ms = performance.now() - t1;
  ok(r && r.ok === true, 'selfTest().ok === true — ' + (r && r.notes));
  ok(BUSY || ms < 200, `selfTest ran in ${ms.toFixed(0)} ms < 200 ms${BUSY ? ' [machine busy: budget advisory]' : ''}`);
  ok(BSU.errors.size === errorsBefore, 'BSU.errors did not grow during selfTest');
}

// --- scenario 1: seeds 1–20 pass the guarantees; the template is used on ≤ 2 of them; gen is fast ----
const states = new Map();
{
  let templates = 0, worst = 0, total = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = BSU.newState(seed);
    BSU.state = s;   // D40: the live root is assigned before gen so rng.derive('reroll', k) mixes the seed
    const tg = performance.now();
    M.gen(s, seed);
    const ms = performance.now() - tg;
    total += ms; if (ms > worst) worst = ms;
    const g = M.guarantees(s);
    if (!g.ok) console.error('  seed', seed, 'failed', g.failed);
    ok(g.ok, `seed ${seed}: guarantees G1–G8 + distribution (${ms.toFixed(1)} ms${s.plot.template ? ', TEMPLATE' : ''})`);
    if (s.plot.template) templates++;
    states.set(seed, s);
  }
  ok(templates <= 2, `template fallback used on ${templates}/20 seeds (≤ 2)`);
  ok(worst < 150, `worst gen ${worst.toFixed(1)} ms < 150 ms (avg ${(total / 20).toFixed(1)} ms)`);
}

// --- scenario 2: the ASCII description of GDD §3.4 ----------------------------------
{
  const s = states.get(1), t = s.tiles, p = s.plot;
  let riverEast = true;
  for (let ty = 0; ty < 64; ty++) if (t.type[ty * 64 + 63] !== T.OPEN_WATER || t.type[ty * 64 + p.bank0 + 1] !== T.OPEN_WATER) riverEast = false;
  ok(riverEast, 'river down the east edge (column 63 and bank0+1 are Open Water)');
  let crown = true;
  for (let ty = 6; ty <= 13; ty++) if (t.elev[ty * 64 + p.bank0] < 8.0) crown = false;
  ok(crown, 'short high crown rows 6–13 (≥ 8 ft at the bank)');
  ok(t.elev[34 * 64 + M.bank(34)] < 3.5 && t.elev[34 * 64 + M.bank(34)] > 2.0, 'Crevasse Reach: the bank is Wet south of row 34');
  ok(p.mouth.length === 3 && p.mouth.every(i => Math.abs(t.elev[i] - 2.2) < 1e-3) && (p.mouth[1] >> 6) > 16 && (p.mouth[1] & 63) < p.bank0 - 8, 'cove mouth: 3 lip tiles at 2.2 ft on the south-west arc');
  ok(p.cove.length >= 12 && p.cove.length <= 20 && p.cove.every(i => t.type[i] === T.WET), 'cove floor 12–20 Wet tiles');
  ok(BSU.chebyshev(p.landing & 63, p.landing >> 6, p.mouth[1] & 63, p.mouth[1] >> 6) <= 2 && t.type[p.landing] === T.BAYOU, 'Pirogue Landing on a bayou tile within 2 of the mouth');
  ok(t.type[p.landingShoulder] === T.MARSH && Math.abs(t.elev[p.landingShoulder] - 0.5) < 1e-6, 'landing shoulder is a 0.5-ft Marsh shoulder');
  ok(p.bayou.length >= 100 && (p.bayou[0] >> 6) === 0 && Math.abs((p.bayou[0] & 63) - 30) <= 5, 'bayou starts on the north edge near tx 30 and is listed upstream-first');
  ok(p.cheniers.length >= 5 && p.cheniers.length <= 7, `${p.cheniers.length} cheniers (5–7)`);
  const bayouX = new Int32Array(64).fill(-1);
  for (const i of p.bayou) { const tx = i & 63, ty = i >> 6; if (bayouX[ty] < 0 || tx < bayouX[ty]) bayouX[ty] = tx; }
  ok(p.cheniers.every(c => c.tiles.every(i => bayouX[i >> 6] >= 0 && (i & 63) <= bayouX[i >> 6] - 3)), 'every chenier tile is ≥ 3 tiles west of the bayou');
  ok(t.type[54 * 64 + 10] === T.OPEN_WATER && p.lake.length > 50 && p.lake.every(i => t.elev[i] === -2), 'cypress lake at (10,54), elev −2, Open Water');
  const biggest = p.cheniers.reduce((a, c) => c.tiles.length > a.tiles.length ? c : a, p.cheniers[0]);
  ok(p.mounds.length === 2 && p.mounds.every(i => biggest.tiles.includes(i) && (t.flags[i] & F.MOUND) && t.type[i] === T.HIGH && t.owner[i] === -1), 'the two Mounds sit on the largest chenier (flag MOUND, High, owner −1)');
  const gap = BSU.chebyshev(p.mounds[0] & 63, p.mounds[0] >> 6, p.mounds[1] & 63, p.mounds[1] >> 6);
  ok(gap >= 3 && gap <= 6, `mounds ${gap} tiles apart`);
  ok(p.highway.length === 7 && p.highway.every((i, k) => t.surface[i] === SURF.ROAD && (i >> 6) === k && (i & 63) === p.bank0 - 5), 'Highway 1 stub: 7 road tiles down column bank0−5, rows 0–6');
  ok(p.oaks.length === 2 && s.veg.filter(v => v.type === 'oak' && !v.planted && p.oaks.includes(v.ty * 64 + v.tx)).length === 2, 'two flanking oaks as veg entities');
  ok(p.founders.tx === p.bank0 - 7 && p.founders.ty === 7 && p.rect.x0 === p.bank0 - 9 && p.rect.x1 === p.bank0 - 1, 'founders origin and G1 rectangle anchored to bank0');
  let wetlandFlag = true;
  for (let i = 0; i < 4096; i++) if ((t.type[i] === T.MARSH) !== ((t.flags[i] & F.WETLAND_ORIGINAL) !== 0)) wetlandFlag = false;
  ok(wetlandFlag, 'WETLAND_ORIGINAL set on exactly the Marsh tiles');
  let finiteAll = true;
  for (const k of Object.keys(BSU.TILE_ARRAYS)) { const a = t[k]; for (let i = 0; i < 4096; i++) if (!Number.isFinite(a[i])) { finiteAll = false; break; } }
  ok(finiteAll && s.veg.every(v => Number.isFinite(v.tx) && Number.isFinite(v.ty)), 'no NaN/Infinity in any tile array or veg');
  const walkOk = Array.from(t.walk).every(w => w >= 0 && w <= 4) && p.bayou.every(i => t.walk[i] === 0) && p.highway.every(i => t.walk[i] === 1);
  ok(walkOk, 'walk grid in 0–4: bayou blocked, highway class 1');
}

// --- scenario 3: determinism and independence from BSU.state -------------------------------
{
  const a = BSU.newState(7), b = BSU.newState(7);
  BSU.state = a; M.gen(a, 7);
  BSU.state = b; M.gen(b, 7);
  let same = true;
  for (let i = 0; i < 4096; i++) if (a.tiles.elev[i] !== b.tiles.elev[i] || a.tiles.flags[i] !== b.tiles.flags[i] || a.tiles.type[i] !== b.tiles.type[i]) { same = false; break; }
  ok(same && a.veg.length === b.veg.length && a.plot.bayou.join() === b.plot.bayou.join(), 'same seed → identical elev/flags/type/veg/bayou');
  const c = BSU.newState(8); BSU.state = c; M.gen(c, 8);
  let diff = false;
  for (let i = 0; i < 4096; i++) if (a.tiles.elev[i] !== c.tiles.elev[i]) { diff = true; break; }
  ok(diff, 'different seed → different map');
}

// --- scenario 4: the template map passes the guarantees ---------------------------------
{
  const s = BSU.newState(0); BSU.state = s;
  const r = M._attempt(s, null, M.template());
  const g = M.guarantees(s);
  ok(r.ok && g.ok && s.plot.template === true, 'template map passes G1–G8 + distribution: ' + g.failed.join(','));
}

// --- scenario 5: the skipTutorial path (landRoute) and a path on Marsh ---------------------
{
  const s = states.get(2), p = s.plot;
  const route = M.landRoute(s, BSU.idx(p.founders.tx + 1, p.founders.ty + 3), p.landingShoulder);
  const crossings = route ? route.filter(i => p.cove.includes(i)).length : 0;
  ok(route && route.length - 1 <= 16 && crossings >= 3 && route.every((i, k) => k === 0 || Math.abs((i & 63) - (route[k - 1] & 63)) + Math.abs((i >> 6) - (route[k - 1] >> 6)) === 1), `landRoute Founders' → landing: ${route && route.length - 1} steps, ${crossings} cove tiles, 4-connected`);
  const events = [];
  const saved = M._deps.emit;
  M._deps.emit = (n, pl) => events.push({ n, pl });
  try {
    const marsh = route.find(i => s.tiles.type[i] === T.MARSH);
    ok(s.tiles.walk[marsh] === 0, 'bare Marsh is blocked before the path');
    M.setSurface(s, marsh, SURF.PATH);
    ok(s.tiles.walk[marsh] === 1 && events.length === 1 && events[0].n === EV.TILE_CHANGED && events[0].pl.what === 'surface' && events[0].pl.i === marsh, 'path on Marsh → walk 1, exactly one tile:changed{surface}');
    events.length = 0;
    for (let k = 0; k < 40; k++) M.setSurface(s, route[Math.min(k, route.length - 1)], SURF.PATH);
    ok(events.length === 40, 'a 40-tile drag emits exactly 40 tile:changed events');
    ok(M.streetlamps(s).length > 0 && M.paradeRoute(s).length >= 7, 'lamps and the parade route see the new run (highway is the road run)');
    const nearMarsh = BSU.nbr8(marsh).find(i => s.tiles.type[i] === T.MARSH && s.tiles.surface[i] === 0 && s.tiles.owner[i] < 0);
    let farMarsh = -1;
    for (let i = 0; i < 4096 && farMarsh < 0; i++) if (s.tiles.type[i] === T.MARSH && BSU.chebyshev(i & 63, i >> 6, marsh & 63, marsh >> 6) > 20) farMarsh = i;
    ok(M.isDisturbedMarsh(s, marsh) === true && (nearMarsh === undefined || M.isDisturbedMarsh(s, nearMarsh) === true) && M.isDisturbedMarsh(s, farMarsh) === false, 'isDisturbedMarsh: within 2 of the new path → true, far marsh → false');
  } finally { M._deps.emit = saved; }
}

// --- scenario 6: robustness on bad input and ungenerated states ------------------------------
{
  const s = BSU.newState(3);
  let threw = false;
  try {
    M.reset(s); M.reset(s, true); M.reset(s, false);
    M.tick(s); M.tick(s, { newDay: true, newYear: true, day: 0 });
    M.touch(s, NaN, 'elev'); M.touch(s, 99999, 'elev'); M.touch(s, 5, 'bogus');
    M.setElev(s, 5, Infinity); M.setElev(s, -1, 3); M.setSurface(s, 5, 9); M.setFlag(s, 5, F.CANAL, true); M.setFlag(s, 5, 3, true);
    M.tileAt(s, -1, 0); M.tileAt(s, 64, 64); M.isLand(s, NaN); M.isWater(s, -5); M.walkClassOf(s, 1e9); M.rewalk(s, -3);
    M.landRoute(s, -1, 5); M.plantVeg(s, 'kudzu', 1, 1); M.plantVeg(s, 'oak', 99, 1); M.removeVeg(s, 99, 99); M.subsidenceRate(s, NaN, true);
    M.ridgeFull(s, 0, 0); M.ridgeFull(s, 3, 2); M.reachableDryHigh(s); M.streetlamps(s); M.paradeRoute(s); M.isDisturbedMarsh(s, 5); M.guarantees(s);
  } catch (e) { threw = true; console.error(e); }
  ok(!threw, 'no exception escapes any public function on bad input or an ungenerated state');
  ok(Array.from(s.tiles.type).every(v => v === 0), 'reset on an ungenerated state leaves it reading as all Open Water');
  ok(M.landRoute(s, 0, 1) === null && M.reachableHigh5(s) === 0 && M.ridgeFull(s, 3, 2) === null, 'queries on an ungenerated state return empty answers');
}

// --- scenario 7: the daily and yearly steps through tick ------------------------------------
{
  const s = states.get(3); BSU.state = s;
  M.reset(s, false);
  const p = s.plot, t = s.tiles;
  const events = [];
  const saved = M._deps.emit;
  M._deps.emit = (n, pl) => events.push(pl);
  try {
    // sandbag expiry + debris + wear + veg growth on one newDay
    const iw = p.landingShoulder, iw2 = p.mouth[0];
    t.sandbag[iw] = 15; t.sandbagDay[iw] = 5;
    t.flags[iw2] |= F.DEBRIS; s.storms.lastLandfallDay = 2;   // clears on day 7
    t.wear[iw] = 41; t.flags[iw2] |= F.DESIRE_WORN; t.wear[iw2] = 10;
    const v = M.plantVeg(s, 'cypress', p.mouth[2] & 63, p.mouth[2] >> 6); v.plantedDay = 0;
    s.calendar.day = 6;
    win.BSU.__leveeCalls = 0;
    M.tick(s, { newDay: true, newMonth: false, newYear: false, day: 6 });
    ok(t.sandbag[iw] === 0 && t.sandbagDay[iw] === 0 && win.BSU.__leveeCalls === 1, 'sandbags expire on day ≥ sandbagDay and hydro.markLeveeChange is called');
    ok((t.flags[iw2] & F.DEBRIS) !== 0, 'debris stays before landfall + 5 days');
    ok((t.flags[iw] & F.DESIRE_WORN) !== 0 && t.wear[iw] === 36 && (t.flags[iw2] & F.DESIRE_WORN) === 0 && t.wear[iw2] === 5, 'wear ≥ 40 sets DESIRE_WORN, < 20 clears it, wear decays by 5');
    s.calendar.day = 6 + 5;
    M.tick(s, { newDay: true, newMonth: false, newYear: false, day: 11 });
    ok((t.flags[iw2] & F.DEBRIS) === 0, 'debris clears 5 days after landfall');
    s.calendar.day = 121;
    M.tick(s, { newDay: true, newMonth: true, newYear: false, day: 121 });
    ok(v.stage === 1, 'planted cypress reaches stage 1 at 120 days');
    // the yearly step: Year 1 Jan 1 must not subside; Year 2 does
    const marshTile = p.landingShoulder;
    const e0 = t.elev[marshTile];
    s.calendar.year = 1;
    M.tick(s, { newDay: true, newMonth: true, newYear: true, day: 0 });
    ok(t.elev[marshTile] === e0 && t.subs[marshTile] === 0, 'no subsidence on Year 1 Jan 1');
    s.calendar.year = 2; s.calendar.day = 120;
    events.length = 0;
    M.tick(s, { newDay: true, newMonth: true, newYear: true, day: 120 });
    ok(Math.abs(t.subs[marshTile] - 0.05) < 1e-6 && Math.abs(t.elev[marshTile] - (e0 - 0.05)) < 1e-6, 'Year 2 Jan 1: bare marsh sinks 0.05 ft (subs mirrors it)');
    const bankTile = BSU.idx(p.bank0, 7);   // 9 ft: High
    const cx2 = p.mouth[2] & 63, cy2 = p.mouth[2] >> 6;
    const coveFar = p.cove.filter(i => BSU.chebyshev(i & 63, i >> 6, cx2, cy2) > 1);
    ok(t.subs[p.mounds[0]] === 0 && t.subs[bankTile] === 0 && t.type[bankTile] === T.HIGH && coveFar.length > 5 && coveFar.every(i => Math.abs(t.subs[i] - 0.05) < 1e-6), 'mounds/high ground do not sink; the Wet cove floor (outside the cypress halo) sinks 0.05');
    const nearCyp = p.cove.find(i => BSU.chebyshev(i & 63, i >> 6, cx2, cy2) <= 1);
    ok(nearCyp === undefined || Math.abs(t.subs[nearCyp] - 0.025) < 1e-6, 'a cove tile within 1 of the planted cypress sinks at half rate');
    ok(Math.abs(t.subs[BSU.idx(p.founders.tx, p.founders.ty)] - 0.02) < 1e-6, 'Dry ground (the 6-ft Founders origin) sinks 0.02');
    ok(events.some(pl => pl.what === 'elev') && events.every(pl => pl.chunk === (((pl.ty >> 3) << 3) + (pl.tx >> 3))), 'subsidence touches tiles with what:elev and correct chunk ids');
    let finiteAll = true;
    for (let i = 0; i < 4096; i++) if (!Number.isFinite(t.elev[i]) || t.elev[i] < -4 || t.elev[i] > 14) finiteAll = false;
    ok(finiteAll, 'elev stays finite and within −4…14 after subsidence');
  } finally { M._deps.emit = saved; }
}

// --- scenario 7b: Tier 2 helpers -----------------------------------------------------------
{
  const s = states.get(5); BSU.state = s;
  const saved = M._deps.emit; const events = [];
  M._deps.emit = (n, pl) => events.push(pl);
  try {
    const wet = s.plot.cove[0];
    s.tiles.flags[wet] |= F.DRAINED; s.tiles.elev[wet] = 2.4; s.tiles.type[wet] = M.typeOf(2.4, s.tiles.flags[wet]);
    { const r = M.restoreToMarsh(s, wet); const parts = { ret: r === true, marsh: s.tiles.type[wet] === T.MARSH, elev: s.tiles.elev[wet] <= 1.0, wo: !!(s.tiles.flags[wet] & F.WETLAND_ORIGINAL), notDrained: !(s.tiles.flags[wet] & F.DRAINED), elevTouch: events.some(e => e.what === 'elev') };
      ok(Object.values(parts).every(Boolean), 'restoreToMarsh: Wet/drained tile → ≤1.0-ft Marsh, WETLAND_ORIGINAL set, DRAINED cleared, elev touch (' + JSON.stringify(parts) + ' elev=' + s.tiles.elev[wet].toFixed(2) + ' events=' + events.length + ')'); }
    events.length = 0;
    const stub = M.addWestStub(s);
    ok(stub.length === 7 && stub.every((i, k) => (i & 63) === k && s.tiles.surface[i] === SURF.ROAD && s.tiles.walk[i] === 1) && s.plot.westHighway === stub && events.length === 7, 'addWestStub: 7 road tiles from the west edge, saved on plot.westHighway, 7 events');
    ok(M.addWestStub(s) === stub && events.length === 7, 'addWestStub is idempotent');
  } finally { M._deps.emit = saved; }
}

// --- scenario 8: performance of the hot paths ---------------------------------------------
{
  const s = states.get(4); BSU.state = s;
  const saved = M._deps.emit; let n = 0;
  M._deps.emit = () => { n++; };
  try {
    let t1 = performance.now();
    for (let k = 0; k < 5; k++) M.rewalk(s);
    const rewalkMs = (performance.now() - t1) / 5;
    ok(rewalkMs < 3, `rewalk(all) ${rewalkMs.toFixed(2)} ms < 3 ms`);
    t1 = performance.now();
    for (let i = 0; i < 4096; i++) M.touch(s, i, 'water');
    const touchMs = performance.now() - t1;
    ok(n === 4096 && touchMs < 20, `4096 touches in ${touchMs.toFixed(1)} ms (one event each)`);
    t1 = performance.now();
    for (let k = 0; k < 5; k++) { M.touch(s, 0, 'decor'); M.reachableDryHigh(s); M.streetlamps(s); M.paradeRoute(s); }
    ok((performance.now() - t1) / 5 < 5, 'reachability + lamps + parade rebuild < 5 ms');
    t1 = performance.now();
    for (let k = 0; k < 5; k++) M.guarantees(s);
    ok((performance.now() - t1) / 5 < 8, 'guarantees < 8 ms');
    const info = M.tileAt(s, s.plot.founders.tx, s.plot.founders.ty);
    ok(info && (info.type === T.DRY || info.type === T.HIGH) && info.drainsTo === 'ground' && info.elev >= 5 && info.i === BSU.idx(s.plot.founders.tx, s.plot.founders.ty), 'tileAt on the Founders origin (≥ 5 ft Dry/High, drainsTo ground)');
  } finally { M._deps.emit = saved; }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
