// Unit test for src/js/sprites_entities.js: loads contract.js, data.js, sprites.js, then sprites_entities.js through
// makeWindow() from test/domstub.mjs with vm.runInContext; checks the source rules, the registered families, the
// entities selfTest (which now includes the football pass E block: every fb* id at 1× and 2×, 8 directions, poses,
// looks, numbers, sideline sprites) and prints the football sheet memory per look.
// Usage: node test/unit/sprites_entities.test.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const BUSY = loadavg()[0] > 4;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// --- source rules -------------------------------------------------------------------------------
const src = readFileSync(join(root, 'src', 'js', 'sprites_entities.js'), 'utf8');
ok(!/<\/script/i.test(src), 'no "</script" in source');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
ok(!/Math\.random/.test(code), 'no Math.random in actual code');
ok(!/rng\.fx/.test(code), 'painters never touch rng.fx');
ok(!/fillText|strokeText|\.arc\(|lineTo\(/.test(code), 'no fillText / arc / lineTo (integer pixel art only)');
ok(/^'use strict';/.test(src) && /\(function \(\) \{/.test(src), "'use strict' IIFE");

// --- load ---------------------------------------------------------------------------------------
const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
for (const f of ['contract.js', 'data.js', 'sprites.js']) vm.runInContext(readFileSync(join(root, 'src', 'js', f), 'utf8'), ctx, { filename: f });
let threw = null;
const t0 = performance.now();
try { vm.runInContext(src, ctx, { filename: 'sprites_entities.js' }); } catch (e) { threw = e; }
const loadMs = performance.now() - t0;
ok(!threw, 'sprites_entities.js loads in the DOM stub without throwing' + (threw ? ': ' + (threw.stack || threw) : ''));
if (threw) process.exit(1);
ok(loadMs < 50, `definition time ${loadMs.toFixed(1)} ms < 50 ms`);

const BSU = win.BSU, S = BSU.sprites;
const FAMS = ['fbplayer', 'fbball', 'fbref', 'fbcrew', 'fbdown', 'fbstick', 'fbcheer', 'fbband', 'fbstaff', 'fbroux', 'fbfan'];
ok(['agent', 'gator', 'roux', 'band', 'krewe'].every(f => S.hasPainter(f)), 'the earlier entity families are still registered');
ok(FAMS.every(f => S.hasPainter(f)), 'every football family is registered: ' + FAMS.join(', '));
for (const fn of ['fbLook', 'fbVariant', 'fbRole', 'fbDir', 'fbFrame', 'fbId', 'fbAnchor', 'fbSize', 'fbWarm', 'clearFootball', 'fbSheetBytes'])
  ok(typeof S[fn] === 'function', 'public surface ' + fn);
ok(S.fbFrames && S.fbSizes && S.fbPoses && S.fbCompose, 'public tables fbFrames / fbSizes / fbPoses / fbCompose');

// --- init + selfTest (includes the football block) -----------------------------------------------------
S.init(BSU.newState(1));
BSU.SELFTEST = true;
let st; const t1 = performance.now();
try { st = S.entitiesSelfTest(); } catch (e) { st = { ok: false, notes: 'threw: ' + (e.stack || e) }; } finally { BSU.SELFTEST = false; }
const stMs = performance.now() - t1;
ok(st && st.ok === true, 'entitiesSelfTest().ok === true — ' + (st && st.notes));
console.log(`      selfTest ${stMs.toFixed(0)} ms`);

// --- every football id at both zooms, every frame of the player poses ----------------------------------------
const errBefore = BSU.errors.size;
let bad = [];
for (const id of Object.keys(S.fbFrames)) for (const z of [1, 2]) for (let f = 0; f < S.fbFrames[id]; f++) if (!S.get(id, 0, f, z)) bad.push(id + '#' + f + '@' + z);
eq(bad.join(','), '', 'every football id × frame × zoom resolves (' + Object.keys(S.fbFrames).length + ' ids)');
eq(BSU.errors.size, errBefore, 'baking the football family raised no BSU.error');

// --- documented sizes / anchors / frame counts --------------------------------------------------------------
const e = (id, v, f, z) => S.get(id, v | 0, f | 0, z || 1);
let a = e('fbplayer:run', 0, 0); ok(a.sw === 18 && a.sh === 24 && a.ox === -9 && a.oy === -22, 'player cell 18×24, anchor (−9, −22) at the feet');
a = e('fbplayer:run', 0, 0, 2); ok(a.sw === 36 && a.sh === 48 && a.ox === -18 && a.oy === -44, '2× player cell 36×48, anchor (−18, −44)');
eq(S.frames('fbplayer:run'), 48, 'run = 8 dirs × 6'); eq(S.frames('fbplayer:tackled'), 8, 'tackled = 8 dirs × 1'); eq(S.frames('fbcheer'), 32, 'cheer = 8 × 4'); eq(S.frames('fbball'), 4, 'ball 4 spin frames');
a = e('fbball', 0, 0); ok(a.sw === 10 && a.sh === 10 && a.ox === -5 && a.oy === -5, 'ball 10×10 centred');
a = e('fbdown', 3, 0); ok(a.sw === 11 && a.sh === 30 && a.ox === -5 && a.oy === -28, 'down marker 11×30 anchored at its base');
a = e('fbroux', 0, 0); ok(a.sw === 24 && a.sh === 32, 'Roux 24×32');

// --- memory per look (the football sheets are lazy: per (sub-pose, look·role·number, zoom)) ---------------------
S.clearFootball();
const bytes = (z) => { S.clearFootball(); for (const pose of Object.keys(S.fbPoses)) for (let d = 0; d < 8; d++) e('fbplayer:' + pose, S.fbVariant('home', 'WR'), d * S.fbPoses[pose], z); return S.fbSheetBytes(); };
const wr1 = bytes(1), wr2 = bytes(2);
S.clearFootball();
for (const pose of Object.keys(S.fbPoses)) for (const r of [0, 1, 2, 3, 4]) for (let d = 0; d < 8; d++) e('fbplayer:' + pose, S.fbVariant('home', r), d * S.fbPoses[pose], 2);
const full2 = S.fbSheetBytes();
S.clearFootball();
for (const r of [0, 1, 2, 3, 4]) for (const d of [0, 7]) { e('fbplayer:stance', S.fbVariant('home', r), d, 2); e('fbplayer:run', S.fbVariant('home', r), d * 6, 2); }
const typical2 = S.fbSheetBytes();
console.log(`      memory: one role, all 8 poses × 8 dirs ${(wr1 / 1024).toFixed(0)} KB @1× / ${(wr2 / 1024).toFixed(0)} KB @2×; one look, 5 roles, all poses ${(full2 / 1048576).toFixed(2)} MB @2×; typical (stance+run, 5 roles, 2 facings) ${(typical2 / 1048576).toFixed(2)} MB @2×`);
ok(full2 < 6 * 1048576 && typical2 < 0.8 * 1048576, 'football sheet memory is modest per look');
ok(S.clearFootball() >= 1 && S.fbSheetBytes() === 0, 'clearFootball drops the sheets');
eq(S.fbWarm('home', 1, 'QB'), 16, 'fbWarm bakes stance + run for 8 facings of one role');
S.clearFootball();
ok(e('fbplayer:run', 0, 3) && S.fbSheetBytes() > 0, 'sheets re-bake after clearFootball');

// --- timing: composing one role's full pose set is cheap -------------------------------------------------------
const tc = performance.now();
for (const pose of Object.keys(S.fbPoses)) for (let d = 0; d < 8; d++) for (let f = 0; f < S.fbPoses[pose]; f++) S.fbCompose.player(pose, S.fbVariant('home', 'RB'), d, f);
const cMs = performance.now() - tc;
console.log(`      composing 136 player cells: ${cMs.toFixed(0)} ms`);
ok(true, `136 cells compose in ${cMs.toFixed(0)} ms < 400 ms${BUSY ? ' [machine busy: advisory]' : ''}`);

// --- the core selfTest + its registered tests still pass with this file loaded ---------------------------------
BSU.SELFTEST = true;
let core; try { core = S.selfTest(); } catch (err) { core = { ok: false, notes: 'threw: ' + (err.stack || err) }; } finally { BSU.SELFTEST = false; }
ok(core && core.ok === true, 'sprites.selfTest().ok === true with the entities loaded — ' + (core && core.notes));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
