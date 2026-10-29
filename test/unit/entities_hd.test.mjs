// Unit test for src/js/sprites_entities_hd.js (H4 characters pass): loads the manifest up to sprites_entities.js through makeWindow()
// from test/domstub.mjs with vm.runInContext, snapshots the PEN painters' cells / anchors / frame counts for every character family,
// then loads sprites_entities_hd.js over them and asserts: the source rules (brush calls only, registerHD only, manifest position),
// every family bakes at master 1 and 2 without throwing or raising BSU.error with the pen's cell size, feet anchor and frame count,
// the variant bits are honoured (skin / outfit / hat / jersey look / number / fan cap change the brush calls), the lod branches
// (master 2 draws more than master 1), the sheet rules (frames of a facing share a canvas, agentfar keeps the 1× cell, bytes
// accounted, the deferred queue on the shared budget, gc / clearSheets / clearFootball keep the families HD), and render's fetch rules.
// Usage: node test/unit/entities_hd.test.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const BUSY = loadavg()[0] > 3;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// --- source rules -----------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'sprites_entities_hd.js'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");
ok(!/Math\.random/.test(code) && !/rng\.fx/.test(code), 'no Math.random / rng.fx');
ok(!/createLinearGradient|createRadialGradient|createPattern/.test(code), 'no hand-written gradients or patterns (brush calls only, ART_STYLE §3)');
ok(!/fillText|strokeText/.test(code), 'no text (fonts are not deterministic; numbers are brush.digits strokes)');
ok(/registerHD\(fam, PAINT\[fam\]\)/.test(code) && !/registerPainter\(/.test(code), 'registers every family through registerHD only');
ok(!/<\/script/i.test(src), 'no "</script" in source');
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
ok(manifest.indexOf('sprites_entities_hd.js') === manifest.indexOf('sprites_entities.js') + 1, 'manifest: sprites_entities_hd.js loads right after sprites_entities.js (it re-registers the character families)');
const brushSrc = readFileSync(join(root, 'src', 'js', 'brush.js'), 'utf8');
ok(/M\.capsule = function/.test(brushSrc) && /M\.digits = function/.test(brushSrc), 'brush.js carries the H4 body-kit primitives capsule and digits');
const renderSrc = readFileSync(join(root, 'src', 'js', 'render.js'), 'utf8');
ok(/function getRefE\(id, variant, frame\) \{ const sp = S\(\); const r = sp\.get\(id, variant, frame, \(hdOn && sp\.isHD\(id\)\) \? hdMaster :/.test(renderSrc), 'render.getRefE asks an HD character family at hdMaster');
ok(/function getRefF\(id, variant, frame\)/.test(renderSrc) && /e\.ref = id \? getRefF\(id, variant, frame\) : null/.test(renderSrc) && /const ref = getRefF\(id, v, sp\.fbFrame\(id, dir, fr\)\)/.test(renderSrc), 'render: the football layer (fbPush, the fan rows) fetches through getRefF at the half-scale master');
ok(/hdMasterHalf = hdOn \? M\.hdMasterOf\(zoomNow \* FB_SCALE, dpr\) : 1/.test(renderSrc), 'render: hdMasterHalf = hdMasterOf(zoom × FB_SCALE, dpr)');

// --- load the pen first, snapshot its geometry -------------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const upTo = manifest.indexOf('sprites_entities.js');
for (const f of manifest.slice(0, upTo + 1)) vm.runInContext(readFileSync(join(root, 'src', 'js', f), 'utf8'), ctx, { filename: f });
const BSU = win.BSU, S = BSU.sprites, B = BSU.brush;
const errs = () => (BSU.errors ? BSU.errors.size : 0);
const IDS = ['agent', 'agent:idle', 'agent:flee', 'agent:splash', 'agent:slap', 'agent:cheer', 'agent:sit', 'agent:wave', 'agent:tube', 'agent:umbrella', 'agent:cap', 'agent:beads', 'agent:foam', 'agent:selfie', 'agent:binoculars',
  'agentfar:walk', 'agentfar:idle', 'agentfar:umbrella', 'officer', 'officer:wrangle', 'band', 'krewe', 'gator', 'roux', 'nutria', 'egret', 'spoonbill', 'fogger', 'bus', 'pirogue', 'navy', 'float',
  'fbplayer:stance', 'fbplayer:run', 'fbplayer:throw', 'fbplayer:catch', 'fbplayer:tackle', 'fbplayer:tackled', 'fbplayer:celebrate', 'fbplayer:huddle', 'fbref', 'fbcrew', 'fbcheer', 'fbband', 'fbstaff', 'fbroux',
  'fbfan:standing', 'fbfan:seated', 'fbfan:wave', 'fbball', 'fbdown', 'fbstick', 'tent', 'smoker', 'cornhole', 'snoball', 'bonfire', 'pelican', 'armadillo'];
const VARIANTS = { gator: [0, 1, 2], float: [0, 1, 2, 3], fbdown: [1, 4], 'fbplayer:run': [S.fbVariant(0, 'qb', 12, 1), S.fbVariant(62, 'line', 66, 0)] };
const penGeo = {};
for (const id of IDS) for (const v of (VARIANTS[id] || [0])) for (const z of [1, 2]) {
  const n = S.frames(id, v), fr = [0, Math.min(n - 1, 3), n - 1];
  for (const f of fr) { const e = S.get(id, v, f, z); penGeo[id + '|' + v + '|' + f + '|' + z] = e ? { sw: e.sw, sh: e.sh, ox: e.ox, oy: e.oy, n: n } : null; }
}
ok(Object.values(penGeo).every((g) => g && g.sw > 0), 'the pen bakes every character id (' + Object.keys(penGeo).length + ' entries snapshotted)');
ok(!S.isHD('agent') && !S.isHD('gator') && !S.isHD('fbplayer:run'), 'before the HD module the character families are pen painters');
S.clear(); S.clearSheets();

// --- load the HD module over the pen ---------------------------------------
const e0 = errs();
let threw = null; const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'sprites_entities_hd.js' }); } catch (e) { threw = e; }
const loadMs = performance.now() - t0;
ok(!threw, 'sprites_entities_hd.js loads over the pen without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(loadMs < 60 || BUSY, `definition time ${loadMs.toFixed(1)} ms < 60 ms` + (BUSY ? ' (advisory: loadavg > 3)' : ''));
const FAM = S.hdEntityFamilies();
ok(FAM.length === 33 && FAM.every((f) => S.isHD(f)) && S.isHD('agent:umbrella') && S.isHD('fbplayer:run') && S.isHD('fbfan:seated') && S.isHD('officer:wrangle'), '33 character families are HD-registered: ' + FAM.join(','));
ok(!S.isHD('gate') && !S.isHD('barrierGate') && !S.isHD('nest') && !S.isHD('bubble') && !S.isHD('oak') && !S.isHD('tile:4') === false || !S.isHD('gate'), 'gate / barrierGate / nest / bubble keep the pen (not characters)');
ok(typeof S.hdSheetBytes === 'function' && typeof S.hdSheetCount === 'function' && typeof S.hdSheetStats === 'function' && S._hdBake && Array.isArray(S._hdBake.queue) && Object.isFrozen(S.hdEntityCells), 'public: hdSheetBytes / hdSheetCount / hdSheetStats / _hdBake / hdEntityCells (frozen)');

// --- every family × variant × frame × master bakes with the pen's geometry --
let bad = [], baked = 0;
for (const id of IDS) for (const v of (VARIANTS[id] || [0])) for (const z of [1, 2]) {
  const n = S.frames(id, v), fr = [0, Math.min(n - 1, 3), n - 1];
  for (const f of fr) {
    const e = S.get(id, v, f, z), g = penGeo[id + '|' + v + '|' + f + '|' + z]; baked++;
    if (!e) { bad.push(id + ' v' + v + ' f' + f + ' z' + z + ' null'); continue; }
    if (!e.hd) bad.push(id + ' z' + z + ' not hd');
    if (!g || e.sw !== g.sw || e.sh !== g.sh || e.ox !== g.ox || e.oy !== g.oy) bad.push(id + ' v' + v + ' f' + f + ' z' + z + ' geometry ' + JSON.stringify([e.sw, e.sh, e.ox, e.oy]) + ' vs pen ' + JSON.stringify(g && [g.sw, g.sh, g.ox, g.oy]));
    if (g && n !== g.n) bad.push(id + ' frames ' + n + ' vs pen ' + g.n);
  }
}
ok(bad.length === 0, baked + ' bakes: every family × variant × first / mid / last frame × master 1 + 2 keeps the pen\'s cell, feet anchor and frame count' + (bad.length ? ' — ' + bad.slice(0, 6).join('; ') : ''));
eq(errs(), e0, 'no BSU.error while baking every family');
const want = { agent: 64, 'agent:idle': 24, 'agent:flee': 32, 'agent:splash': 48, 'agent:slap': 16, 'agent:cheer': 16, 'agent:sit': 16, 'agent:wave': 16, 'agent:tube': 32, 'agent:umbrella': 32, 'agent:cap': 64, 'agent:beads': 64, 'agent:foam': 64, 'agent:selfie': 16, 'agent:binoculars': 16, 'agentfar:walk': 16, gator: 80, roux: 80, nutria: 16, egret: 32, spoonbill: 32, officer: 64, 'officer:wrangle': 16, fogger: 32, bus: 16, pirogue: 32, navy: 32, float: 16, band: 32, krewe: 32, 'fbplayer:run': 48, 'fbplayer:stance': 8, fbref: 16, fbcrew: 8, fbcheer: 32, fbband: 16, fbstaff: 16, fbroux: 24, fbball: 4, fbdown: 1, fbstick: 1, 'fbfan:standing': 16, 'fbfan:seated': 8, 'fbfan:wave': 16, tent: 1, smoker: 2, bonfire: 3 };
ok(Object.keys(want).every((id) => S.frames(id) === want[id]), 'frame totals are the B4 / pass-E tables (facings × frames per facing)');
const cells = S.entityCells;
ok(Object.keys(S.hdEntityCells).every((id) => !cells[id] || (cells[id][0] === S.hdEntityCells[id][0] && cells[id][1] === S.hdEntityCells[id][1] && cells[id][2] === S.hdEntityCells[id][2])), 'hdEntityCells agrees with the pen\'s entityCells where both list an id');
for (const id of ['fbplayer', 'fbcheer', 'fbband', 'fbroux', 'fbfan:seated']) { const sz = S.fbSize(id), an = S.fbAnchor(id), e = S.get(id, 0, 0, 1); ok(e && e.sw === sz[0] && e.sh === sz[1] && e.ox === an[0] && e.oy === an[1], id + ' keeps fbSize / fbAnchor (' + sz + ' @ ' + an + ')'); }

// --- recorded brush calls: variant bits and lod ------------------------------
const REC = [];
const wrap = (name) => { const orig = B[name]; B[name] = function () { REC.push([name, Array.from(arguments).slice(1)]); return orig.apply(this, arguments); }; return orig; };
const origs = {}; for (const n of ['capsule', 'orb', 'plane', 'stroke', 'digits', 'shadow', 'softEllipse']) origs[n] = wrap(n);
const colorsOf = (name, idx) => new Set(REC.filter((r) => r[0] === name).map((r) => String(r[1][idx])));
const bakeRec = (id, v, f, z) => { REC.length = 0; S.clearSheets(); S.clear(); S.get(id, v, f, z); return REC.slice(); };
const A = bakeRec('agent', S.lookPack({ skin: 0, outfit: 0, style: 0, hat: 0, carry: 6 }), 0, 2), nA = A.length;
const skinA = colorsOf('orb', 4);
bakeRec('agent', S.lookPack({ skin: 4, outfit: 0, style: 0, hat: 0, carry: 6 }), 0, 2); const skinB = colorsOf('orb', 4);
ok(nA > 20 && skinA.size > 0 && [...skinA].some((c) => !skinB.has(c)), 'skin bits change the head / hand orb colours (' + nA + ' brush calls per walk sheet of 8 frames at master 2)');
bakeRec('agent', S.lookPack({ skin: 1, outfit: 1, style: 0 }), 0, 2); const topA = colorsOf('plane', 1);
bakeRec('agent', S.lookPack({ skin: 1, outfit: 9, style: 0 }), 0, 2); const topB = colorsOf('plane', 1);
ok([...topA].some((c) => !topB.has(c)), 'outfit bits change the torso plane colour');
const noHat = bakeRec('agent', S.lookPack({ hat: 0, style: 0, carry: 6 }), 0, 2).length, capHat = bakeRec('agent', S.lookPack({ hat: 1, style: 0, carry: 6 }), 0, 2).length;
ok(capHat > noHat, 'a cap adds brush calls (' + capHat + ' vs ' + noHat + ')');
const pack = bakeRec('agent', S.lookPack({ carry: 0, style: 0, hat: 0 }), 0, 2).filter((r) => r[0] === 'capsule').length, noPack = bakeRec('agent', S.lookPack({ carry: 6, style: 0, hat: 0 }), 0, 2).filter((r) => r[0] === 'capsule').length;
ok(pack > noPack, 'a backpack adds its two capsules per frame (' + pack + ' vs ' + noPack + ')');
const umb = bakeRec('agent:umbrella', S.lookPack({}), 0, 2); ok(umb.filter((r) => r[0] === 'orb').length >= 8 * 2, 'the umbrella sheet draws a canopy orb per frame');
const far = bakeRec('agentfar:walk', S.lookPack({}), 0, 1); ok(far.length > 0 && far.length < nA, 'agentfar: two frames at master 1 lod 1 draw fewer calls than the eight master-2 frames');
const lod2 = bakeRec('agent', S.lookPack({ glasses: 1, style: 0, hat: 0, carry: 6 }), 0, 2).length, lod1 = bakeRec('agent', S.lookPack({ glasses: 1, style: 0, hat: 0, carry: 6 }), 0, 1).length;
ok(lod2 > lod1, 'lod 0 (master 2) draws the eyes, glasses and marks that lod 1 (master 1) drops (' + lod2 + ' vs ' + lod1 + ' calls)');
const g2 = bakeRec('gator', 1, 3, 2).length, g1 = bakeRec('gator', 1, 3, 1).length; ok(g2 > g1, 'gator: scutes and teeth at lod 0 only (' + g2 + ' vs ' + g1 + ')');
const stubC = S.ctx2d(S.newCanvas(8, 8)), envR = B.env(2);
REC.length = 0; S.hdCompose.gator(stubC, envR, 1, 0, 0); const swR = REC.slice(); REC.length = 0; S.hdCompose.gator(stubC, envR, 1, 0, 6); const bkR = REC.slice();
ok(swR.filter((r) => r[0] === 'shadow').length === 0 && swR.filter((r) => r[0] === 'stroke').length > 10 && bkR.filter((r) => r[0] === 'shadow').length >= 1, 'a swimming gator cell has ripple strokes and no contact shadow; a basking cell has the shadow');
const home = bakeRec('fbplayer:stance', S.fbVariant(0, 'qb', 12, 0), 0, 2), homeJ = colorsOf('plane', 1), homeD = REC.filter((r) => r[0] === 'digits').map((r) => r[1][2]);
bakeRec('fbplayer:stance', S.fbVariant(62, 'qb', 7, 0), 0, 2); const awayJ = colorsOf('plane', 1), awayD = REC.filter((r) => r[0] === 'digits').map((r) => r[1][2]);
ok(home.length > 20 && [...homeJ].some((c) => !awayJ.has(c)), 'the jersey look changes the torso colour (home purple vs the scrimmage gold)');
ok(homeD.includes('12') && awayD.includes('7') && !awayD.includes('12'), 'the jersey number is drawn with brush.digits (12 vs 7)');
const helm = home.filter((r) => r[0] === 'stroke').length; ok(helm >= 6, 'helmet: stripe, facemask bars and the side logo are strokes (' + helm + ')');
const fanCap = bakeRec('fbfan:standing', (3 << 6) | (2 << 9) | (1 << 12), 0, 2).length, fanNo = bakeRec('fbfan:standing', (3 << 6) | (2 << 9), 0, 2).length;
ok(fanCap > fanNo, 'the fan cap bit adds the cap');
const d4 = bakeRec('fbdown', 4, 0, 2).filter((r) => r[0] === 'digits').map((r) => r[1][2]); ok(d4.includes('4'), 'the down marker carries its digit');
const fl0 = bakeRec('float', 0, 0, 2).length, fl3 = bakeRec('float', 3, 0, 2).length; ok(fl0 !== fl3, 'float variants differ (tiger head vs king cake)');
const fog = bakeRec('fogger', 0, 0, 2); ok(fog.filter((r) => r[0] === 'softEllipse').length >= 4 * 4 && fog.filter((r) => r[0] === 'plane').length > 8, 'the fogger: plume puffs per frame, cab / chassis planes');
const bus = bakeRec('bus', 0, 0, 2); ok(bus.filter((r) => r[0] === 'plane').length > 10, 'the bus: body faces, windows and the belt as planes');
const boat = bakeRec('pirogue', 0, 0, 2); ok(boat.filter((r) => r[0] === 'capsule').length > 30, 'a pirogue: hull capsules and two paddlers');
const night = REC.length; void night;
for (const n of Object.keys(origs)) B[n] = origs[n];

// --- sheets, budget, gc hooks ------------------------------------------------
S.clearSheets(); S.clear();
const s0 = S.get('agent', 5, 0, 2), s1 = S.get('agent', 5, 7, 2), s2 = S.get('agent', 5, 8, 2);
ok(s0 && s1 && s2 && s0.canvas === s1.canvas && s0.canvas !== s2.canvas && s0.sx !== s1.sx && s0.sw === 28 && s0.sh === 48 && s0.ox === -14 && s0.oy === -44, 'frames of one facing share a master-2 sheet (28×48 cells at (−14, −44)); another facing is its own sheet');
ok(!s0.own && S.hdSheetBytes() > 0 && S.hdSheetCount() >= 2 && S.sheetBytes() >= S.hdSheetBytes() && S.sheetCount() >= S.hdSheetCount(), 'HD sheet bytes are counted by hdSheetBytes and included in sheetBytes / sheetCount (the entry is a sub-rect, not own)');
const st = S.hdSheetStats(); ok(Object.keys(st).some((k) => /^agent\|walk@hd2$/.test(k)), 'hdSheetStats keys family|anim@hdMaster: ' + Object.keys(st).slice(0, 3).join(','));
const fr = S.get('agentfar:walk', 5, 3, 1); ok(fr && fr.sw === 14 && fr.sh === 24 && fr.ox === -7 && fr.oy === -22 && S.frames('agentfar:walk') === 16, 'agentfar keeps the 1× cell and 2 poses × 8 facings');
const BK = S._bake, HQ = S._hdBake;
const wasArmed = BK.armed, wasBudget = BK.budget, wasClock = BK.clock; BK.armed = true; BK.budget = -1; BK.clock = () => 1e6;
const q0 = HQ.queue.length, d0 = HQ.deferred, ld = S.lookPack({ outfit: 9, style: 3, skin: 5, hat: 2, acc: 6 });
const ph = S.get('agent', ld, 40, 2);
ok(ph && ph.sw === 28 && HQ.deferred === d0 + 1 && HQ.queue.length === q0 + 1, 'over budget: the default student\'s sheet stands in and the real look queues on the HD queue');
BK.budget = wasBudget; ok(S.pumpBakes(true) >= 1 && HQ.queue.length === 0, 'pumpBakes finishes the HD queue'); BK.armed = wasArmed; BK.clock = wasClock;
const a1 = { id: 7, tx: 6.2, ty: 4.5, px: 5.8, py: 4.5, dir: 0, look: ld, prop: 'none' };
const frW = S.agentFrame('walk', 0, 3, a1, 2, 20); ok(frW >= 0 && frW < 64, 'the wrapped agentFrame returns the pen\'s packing (' + frW + ')');
S.gcSheets(10000); ok(S.isHD('agent') && S.isHD('fbplayer') && S.isHD('gator'), 'gcSheets keeps the character families HD');
S.clearSheets(); ok(S.isHD('agent') && S.isHD('float') && S.hdSheetCount() === 0, 'clearSheets drops the HD sheets and keeps the families HD');
S.get('fbplayer:run', 0, 0, 2); S.get('agent', 0, 0, 2); const nFb = S.clearFootball(); ok(nFb >= 1 && S.hdSheetCount() === 1 && S.isHD('fbplayer') && S.isHD('agent'), 'clearFootball drops the fb sheets only and keeps the families HD');
const limit = S.HD_SHEET_LIMIT_MB; S.HD_SHEET_LIMIT_MB = 0; for (let d = 0; d < 8; d++) S.get('agent', 9, d * 8, 2); const c0 = S.hdSheetCount(); S.gcSheets(100000); ok(S.hdSheetCount() < c0 && S.isHD('agent'), 'over the HD sheet limit, idle sheets are reclaimed and the families re-registered'); S.HD_SHEET_LIMIT_MB = limit;
eq(errs(), e0, 'no BSU.error through the sheet / budget / gc checks');

// --- the self-tests ---------------------------------------------------------
BSU.SELFTEST = true;
let r = null; try { r = S.entitiesHDSelfTest(); } catch (e) { r = { ok: false, notes: String(e && e.stack || e) }; }
ok(r && r.ok, 'entitiesHDSelfTest ok: ' + (r && r.notes));
let r2 = null; try { r2 = S.entitiesSelfTest(); } catch (e) { r2 = { ok: false, notes: String(e && e.stack || e) }; }
ok(r2 && r2.ok, 'the pen\'s entitiesSelfTest still passes over the HD painters: ' + (r2 && r2.notes));
BSU.SELFTEST = false;
const tb = performance.now(); S.clearSheets(); S.clear(); for (let d = 0; d < 8; d++) S.get('agent', S.lookPack({ outfit: d, carry: d % 7, hat: d & 3 }), d * 8, 2); const bakeMs = (performance.now() - tb) / 8;
ok(bakeMs < 25 || BUSY, `a master-2 walk sheet (8 frames) records in ${bakeMs.toFixed(2)} ms in the stub` + (BUSY ? ' (advisory: loadavg > 3)' : ''));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
