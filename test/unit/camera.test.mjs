// Unit test for the camera pass (Josh, 2026-11-14: "kill all auto camera movement"). The camera moves only when the player moves it
// (drag, keys, wheel, minimap) or clicks a control that says so (Show me, Locate, Fix, Pan to, Follow). The scripted moves are behind
// one switch, params.render.autoCamera → render.autoCamera (false): the charter swoop, the founding follow, the landfall camera cue,
// the football game camera (render.test covers it), the title drift. Screen shake is opt-in (settings.screenShake, off).
// This test spies on render.panTo / panToTile / followVehicle / setZoom and compares the camera before and after whole stretches of play.
// Usage: node build.mjs --check && node test/unit/camera.test.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

const { win } = loadGame();
const BSU = win.BSU, R = BSU.render, H = BSU.headless;
const spy = { panTo: 0, panToTile: 0, followVehicle: 0, setZoom: 0 };
for (const k of Object.keys(spy)) { const f = R[k]; R[k] = function () { if (!(k === 'followVehicle' && arguments[0] == null)) spy[k]++; return f.apply(this, arguments); }; }
const reset = () => { for (const k of Object.keys(spy)) spy[k] = 0; };
const moves = () => spy.panTo + spy.panToTile + spy.followVehicle + spy.setZoom;
const cam = () => { const c = BSU.state.ui.camera; return c.x + '|' + c.y + '|' + c.zoom + '|' + c.follow; };

// --- the switch and the setting ------------------------------------------------------------------------------------------------------
console.log('--- defaults ---');
ok(BSU.params.render.autoCamera === false, 'params.render.autoCamera is false');
ok(R.autoCamera === false, 'render.autoCamera mirrors it');
BSU.session.newGame({ seed: 42, size: 64, skipTutorial: true });
ok(BSU.state.ui.settings.screenShake === false && !('shake' in BSU.state.ui.settings), 'settings.screenShake is off by default and the old opt-out key (shake) is gone');
const rsrc = readFileSync(join(root, 'src', 'js', 'render.js'), 'utf8');
ok(/settings\.screenShake === true/.test(rsrc) && !/settings\.shake\b/.test(rsrc), 'render shakes only on settings.screenShake === true');
ok(/if \(!autoCam\(\)\) return;/.test(rsrc) && /M\.titleDrift && autoCam\(\)/.test(rsrc), 'the football game camera and the title drift sit behind autoCam()');

// --- the tutorial start: no charter swoop -----------------------------------------------------------------------------------------------
console.log('--- charter swoop ---');
BSU.session.newGame({ seed: 42, size: 64 }); H.render();
let s = BSU.state; reset(); let c0 = cam();
H.tick(3); H.render();
ok(moves() === 0, 'the tutorial opens without a camera swoop (' + JSON.stringify(spy) + ')');
ok(cam() === c0, 'and the camera has not moved');
R.autoCamera = true;
BSU.session.newGame({ seed: 42, size: 64 }); H.render(); reset(); H.tick(3);
ok(spy.panToTile >= 2, 'with the switch on the swoop pans (the gate, not dead code): ' + spy.panToTile + ' pans');
R.autoCamera = false;

// --- a stretch of ordinary play: three days, a render every ten ticks --------------------------------------------------------------------
console.log('--- three days of play ---');
BSU.session.newGame({ seed: 42, size: 64, skipTutorial: true }); H.render();
s = BSU.state; reset(); c0 = cam();
const TPD = BSU.params.time.ticksPerDay;
for (let k = 0; k < (3 * TPD) / 10; k++) { H.tick(10); H.render(); }
ok(moves() === 0, 'three days of play: nothing asked the camera to move (' + JSON.stringify(spy) + ')');
ok(cam() === c0, 'three days of play: the camera is where the player left it');

// --- a hurricane through landfall: no camera cue ------------------------------------------------------------------------------------------
console.log('--- landfall ---');
reset(); c0 = cam();
H.forceHurricane(3); let reached = false;
for (let k = 0; k < 400 && !reached; k++) { H.tick(10); H.render(); if (s.setPiece && s.setPiece.kind === 'landfall' && s.setPiece.tick >= 200) reached = true; }
ok(reached, 'the forced Cat 3 reached landfall');
ok(moves() === 0, 'a hurricane through landfall: no camera cue (' + JSON.stringify(spy) + ')');
ok(cam() === c0, 'a hurricane through landfall: the camera stayed put');
ok(!s.setPiece || s.setPiece.cameraTouched === false, 'and the set piece was not told the player touched the camera');

// --- the title drift ---------------------------------------------------------------------------------------------------------------------
console.log('--- title drift ---');
R.titleDrift = true; c0 = cam();
for (let k = 0; k < 40; k++) H.render();
ok(cam() === c0, 'titleDrift set: 40 frames later the camera has not drifted');
R.autoCamera = true; for (let k = 0; k < 40; k++) H.render();
ok(cam() !== c0, 'with the switch on it drifts (the gate, not dead code)');
R.autoCamera = false; R.titleDrift = false;

// --- the player's own moves still work ----------------------------------------------------------------------------------------------------
console.log('--- player moves ---');
c0 = cam(); R.panBy(40, 20, true); for (let k = 0; k < 4; k++) H.render();
ok(cam() !== c0, 'a player pan moves the camera');
c0 = cam(); R.panToTile(10, 10, false); H.render();
ok(cam() !== c0, 'Show me / Locate (render.panToTile) still move it');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
