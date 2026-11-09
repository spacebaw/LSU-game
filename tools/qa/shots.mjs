#!/usr/bin/env node
// Screenshot matrix for eyeballing after an art pass. Stable file names in the out dir (default tools/qa/out/):
//   title.png  howto.png  about.png
//   day-1280x800.png  day-1440x900.png  day-1920x1080.png          (dense campus, scripted midday sky, camera framed on the campus)
//   hud-full.png  hud-hidden.png                                    (1440x900; H, then Shift+H; U2 folded the compact mode away)
//   zoom-0.5.png  zoom-2.5.png                                      (1440x900)
//   night-lights.png  night-game.png                                (scripted night; a Stadium II night game with masts and fireworks)
//   fog.png  rain.png  hurricane.png                                (dawn mist; a map-wide downpour; a Cat 3 landfall)
//
//   node tools/qa/shots.mjs [--size 96|64] [--dpr 1] [--scale 1|1.15|1.3] [--only title,day,hud,zoom,night,weather,hurricane] [--out dir] [--index path] [--prefix x-] [--buildings 36]
// --scale calls BSU.ui.setUiScale(x) after the page loads (the three Display sizes of the UI refresh; 1.3 is capped by the window, 1.28 at 1440x900).
// Headless Chrome is software raster at deviceScaleFactor 1: --dpr 2 emulates it (the PNG stays CSS-pixel sized).
import { openGame, parseArgs, DEFAULT_OUT, resolveIndex, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), {
  size: { type: 'num', def: 96 }, dpr: { type: 'num', def: 1 }, only: { type: 'list', def: [] }, out: { type: 'str', def: DEFAULT_OUT },
  index: { type: 'str', def: '' }, prefix: { type: 'str', def: '' }, buildings: { type: 'num', def: 40 }, scale: { type: 'num', def: 0 },
});
if (args.scale && ![1, 1.15, 1.3].includes(args.scale)) { console.error('--scale must be 1, 1.15 or 1.3'); process.exit(2); }
if (args.size !== 64 && args.size !== 96) { console.error('--size must be 64 or 96'); process.exit(2); }
const GROUPS = ['title', 'day', 'hud', 'zoom', 'night', 'weather', 'hurricane'];
for (const o of args.only) if (!GROUPS.includes(o)) { console.error(`unknown group "${o}" (known: ${GROUPS.join(', ')})`); process.exit(2); }
const want = (grp) => !args.only.length || args.only.includes(grp);
const index = resolveIndex(args.index);
const written = []; let problems = 0;
const open = async (width, height, extra = {}) => {
  const g = await openGame(Object.assign({ index, width, height, size: args.size, dpr: args.dpr, outDir: args.out, noGuard: true }, extra));
  if (args.scale) { await g.eval(`(BSU.ui.setUiScale(${args.scale}), true)`); await sleep(150); }
  return g;
};
const shot = async (g, name) => { const p = await g.shot(args.prefix + name); written.push(p); return p; };
/** pause the sim so a still frame is a still frame, and hold the sky at (phase, t) */
const still = (g, phase, t) => g.eval(`(function () { BSU.session.setSpeed(BSU.state, 0, 'user'); ${phase === undefined ? '' : `BSU.weather.scriptSky(BSU.state, ${phase}, ${t});`} return true; })()`);
const DAY = 1, DAWN = 0, NIGHT = 4;
const check = async (g, label) => { const errs = await g.errorsSince(); if (errs.length) { problems++; console.log(`  ${label}: ${errs.length} error(s): ${errs[0]}`); } for (const n of g.notes.splice(0)) console.log(`  ${label}: note: ${n}`); };

// ---- title screens (1280x800) ----
if (want('title')) {
  const g = await open(1280, 800, { newGame: true });
  try {
    await g.title(true); await sleep(900);
    await shot(g, 'title');
    for (const [btn, name] of [['#btn-title-howto', 'howto'], ['#btn-title-about', 'about']]) {
      if (!(await g.clickEl(btn))) { problems++; console.log(`  ${btn} not clickable on the title`); continue; }
      await sleep(450); await shot(g, name); await g.key('Escape'); await sleep(200);
    }
    await check(g, 'title');
  } finally { await g.close(); }
}

// ---- the dense-campus day shot at three viewports; the 1440x900 run also takes HUD modes, zoom, night, weather, hurricane ----
const SIZES = [[1280, 800], [1440, 900], [1920, 1080]];
for (const [w, h] of SIZES) {
  const main = w === 1440;
  const groups = ['day'].concat(main ? ['hud', 'zoom', 'night', 'weather', 'hurricane'] : []).filter(want);
  if (!groups.length) continue;
  const g = await open(w, h);
  try {
    const campus = await g.buildCampus({ target: args.buildings });
    await g.noGuard();
    await still(g, DAY, 0.4);
    const view = await g.frameCampus(1, { keepOnMap: false });
    const bake = await g.waitBake({ timeoutMs: 45000 });
    await g.clearUi(); await g.settleCamera(); await sleep(250);
    console.log(`${w}x${h}: ${campus.count} buildings (${view.inView} in view${view.onMap ? '' : ', viewport not fully on map'}); bake ${bake.ok ? 'ok' : 'TIMEOUT'}`);
    if (want('day')) await shot(g, `day-${w}x${h}`);

    if (main && want('hud')) {
      await shot(g, 'hud-full');
      await g.key('h'); await sleep(450); await shot(g, 'hud-hidden');
      await g.key('h', { shift: true }); await sleep(450);
      if ((await g.eval(`BSU.ui.hudMode()`)) !== 'full') { problems++; console.log('  Shift+H did not return to the full HUD'); }
    }
    if (main && want('zoom')) {
      for (const z of [0.5, 2.5]) {
        await g.frameCampus(z, { keepOnMap: false }); await g.waitBake({ timeoutMs: 30000 }); await sleep(250);
        await shot(g, `zoom-${z}`);
      }
      await g.frameCampus(1, { keepOnMap: false }); await g.waitBake({ timeoutMs: 30000 });
    }
    if (main && want('night')) {
      await still(g, NIGHT, 0.5); await sleep(500);
      await shot(g, 'night-lights');
    }
    if (main && want('weather')) {
      await still(g, DAWN, 0.05); await sleep(500);
      await shot(g, 'fog');
      await still(g, DAY, 0.4);
      await g.eval(`(function () { var w = BSU.state.weather; w.event = { kind: 'frontal', total: 1, steps: 1e6, stepsLeft: 1e6, cx: -1, cy: -1, radius: 0, lightning: false, scripted: false }; w.rainRate = 0.85; return true; })()`);
      await sleep(1800);
      await shot(g, 'rain');
      await g.eval(`(BSU.state.weather.event = null, true)`);
    }
    if (main && want('hurricane')) {
      await g.eval(`(BSU.session.setSpeed(BSU.state, 1, 'user'), BSU.state.sky.scripted && BSU.weather.releaseSky(BSU.state), BSU.headless.forceHurricane(3), true)`);
      let got = false;
      await g.run(5200, { slice: 40, frameMs: 25, each: async () => { const r = await g.eval(`(function () { var sp = BSU.state.setPiece; return sp && sp.kind === 'landfall' ? sp.tick : -1; })()`); got = r > 320; return got; } });
      if (got) {   // take the camera from the set piece (it is looking at the bayou) and put it over the campus; answer the shelter toast so it does not cover the frame
        await g.eval(`(BSU.render.captureCameraTouch(BSU.state), true)`); await g.frameCampus(1, { keepOnMap: false }); await g.key('n'); await sleep(900);
      }
      if (got) await shot(g, 'hurricane'); else { problems++; console.log('  hurricane: the landfall set piece never reached its middle'); }
    }
    await check(g, `${w}x${h}`);
  } finally { await g.close(); }
}

// ---- a Stadium II night game: masts, the lit bowl, fireworks ----
if (want('night')) {
  const g = await open(1440, 900);
  try {
    await g.buildCampus({ target: 26, stadium: true });
    await g.noGuard();
    const night = await g.startNightGame();
    // find the stadium and frame it; let the frames draw the lights and any fireworks
    await g.eval(`(function () { var b = BSU.state.buildings.filter(function (b) { return b && b.type === 'stadium'; })[0]; if (b) BSU.render.panToTile(b.tx + b.w / 2, b.ty + b.h / 2, false); return true; })()`);
    await g.settleCamera(); await g.run(120, { slice: 20, frameMs: 40 }); await sleep(300);
    await shot(g, 'night-game');
    if (!night) { problems++; console.log('  night-game: the sky was not night'); }
    await check(g, 'night-game');
  } finally { await g.close(); }
}

killStrays();
console.log(`\n${written.length} screenshot(s) in ${args.out}${problems ? `; ${problems} problem(s)` : ''}`);
for (const p of written) console.log('  ' + p.replace(args.out + '/', ''));
process.exit(problems ? 1 : 0);
