#!/usr/bin/env node
// Scripted play-through QA in real Chrome: named scenarios, each a small function over the shared helpers in lib.mjs.
//
//   node tools/qa/play.mjs [--size 96|64] [--only a,b] [--out dir] [--shots] [--index path] [--strict] [--list]
//
// Exit code 1 on any console error, uncaught exception, BSU.error or failed assertion (--strict: console warnings too).
// One summary line per scenario and size; details (the failing check, the first errors) are indented under it.
import { openGame, parseArgs, sizesOf, DEFAULT_OUT, resolveIndex, FIXTURE_V1, killStrays, sleep } from './lib.mjs';
import { readFileSync } from 'node:fs';

const spec = {
  size: { type: 'str', def: 'both' }, only: { type: 'list', def: [] }, out: { type: 'str', def: DEFAULT_OUT }, shots: { type: 'bool', def: false },
  index: { type: 'str', def: '' }, strict: { type: 'bool', def: false }, list: { type: 'bool', def: false },
  width: { type: 'num', def: 1280 }, height: { type: 'num', def: 800 },
};
const args = parseArgs(process.argv.slice(2), spec);

class NeedFailed extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// scenarios: (ctx) => Promise. ctx.ok(cond, msg) records a check and carries on; ctx.need(cond, msg) records and aborts the scenario.
// ---------------------------------------------------------------------------------------------------------------------
const SCENARIOS = [];
const scenario = (name, desc, run, timeoutMs = 150000) => SCENARIOS.push({ name, desc, run, timeoutMs });

scenario('tutorial', 'tutorial to the first five buildings: auto-tie, Alt opts out, refusal + Show me, then the window closes', async (c) => {
  const { g } = c;
  await c.fresh({ skipTutorial: false });
  // the intro (the swoop, ~35 ticks) is driven by ticks as well as frames, so a slow machine does not stall it
  let intro = false;
  for (let i = 0; i < 60 && !intro; i++) { await g.tick(10); intro = await g.eval(`BSU.state.progress.tutorialStage >= 2 && !!BSU.ui.tool() && BSU.ui.tool().id === 'founders_hall'`); if (!intro) await sleep(100); }
  if (!intro) g.notes.push('intro stalled: ' + JSON.stringify(await g.eval(`({ stage: BSU.state.progress.tutorialStage, tick: BSU.state.tick, speed: BSU.state.ui.speed, sp: BSU.state.setPiece && BSU.state.setPiece.kind, hidden: document.hidden, ui: BSU.ui.state, title: BSU.session.titleWorld, running: BSU.state.calendar.running, frame: BSU.render.perf().frameNo })`)));
  c.need(intro, 'the intro hands over the Founders\' Hall ghost (stage 2)');
  const f = await g.eval(`BSU.state.plot.founders`);
  await g.clickTileCentered(f.tx, f.ty);
  c.need(await g.until(`BSU.state.progress.tutorialStage >= 3`, 6000), 'clicking the ridge places Founders\' Hall (stage 3)');
  c.ok((await g.buildingCount()) === 1, 'one building stands (Founders\' Hall)');
  await c.shot('1-founders');

  // stage 3: drag a path from the front door to the Pirogue Landing (a real mouse drag along the land route)
  const route = await g.eval(`(function () { var s = BSU.state, f = s.plot.founders, W = BSU.MAP.W; return BSU.terrain.landRoute(s, BSU.idx(f.tx + 1, f.ty + 3), s.plot.landingShoulder).map(function (i) { return [i % W, (i / W) | 0]; }); })()`);
  c.need(route && route.length > 3, 'a land route exists from the front door to the landing (' + (route && route.length) + ' tiles)');
  const mid = route[route.length >> 1]; await g.panToTile(mid[0], mid[1]); await sleep(100); await g.settleCamera();   // centre the route so no part of the drag crosses a HUD card
  const pts = []; for (const [x, y] of route) { const p = await g.tilePx(x, y); pts.push([p.x, p.y]); }
  await g.b.dragPath(pts, 3); await sleep(500);
  const laid = await g.eval(`${JSON.stringify(route)}.filter(function (t) { return BSU.state.tiles.surface[BSU.idx(t[0], t[1])] === BSU.SURF.PATH; }).length`);
  c.ok(laid === route.length, `the dragged path covers the route (${laid}/${route.length} tiles)`);
  c.ok(await g.until(`BSU.state.progress.tutorialStage >= 4`, 4000), 'the path to the landing advances the tutorial (stage 4)');
  await g.clearUi();
  await g.days(12);   // Founders' Hall and the path finish
  c.ok(await g.eval(`BSU.buildings.tieEnforced(BSU.state)`), 'before five buildings are done the tie window is enforced');

  // building 2: a Dorm that is off the path but within 12 tiles: auto-tie lays gravel and shows the one-time card
  const dormSpot = await g.scan('dorm', { want: 'tie', minTie: 2, maxTie: 12 });
  c.need(dormSpot, 'a dorm spot with a 2+ tile tie exists');
  await g.clearUi(); c.need(await g.pickTool('dorm'), 'the Freshman Dorm arms from the palette');
  await g.clickTileCentered(dormSpot.tx, dormSpot.ty); await sleep(200);
  c.ok((await g.buildingCount()) === 2, 'the dorm is placed');
  const tied = await g.eval(`(BSU.buildings.undoInfo(BSU.state) || {}).connector | 0`);
  c.ok(tied > 0, `placing off the path lays its own tie (${tied} tile${tied === 1 ? '' : 's'})`);
  c.ok(await g.eval(`!!BSU.ui.settings().tieCardSeen`), 'the one-time "Tied in" card was shown (settings.tieCardSeen)');
  await c.shot('2-tied-dorm'); await g.clearUi({ panel: false });

  // building 3: Alt held = no tie ("Not linked", allowed while the window is open because a tie was possible)
  const diningSpot = await g.scan('dining_hall', { want: 'tie', minTie: 2, maxTie: 12, skip: [[dormSpot.tx, dormSpot.ty]] });
  c.need(diningSpot, 'a dining hall spot with a 2+ tile tie exists');
  await g.clearUi({ panel: false }); c.need(await g.pickTool('dining_hall'), 'the Dining Hall arms from the palette');
  await g.panToTile(diningSpot.tx, diningSpot.ty); await sleep(100); await g.settleCamera();
  const dp = await g.tilePx(diningSpot.tx, diningSpot.ty);
  await g.keyDown('Alt', { alt: true }); await sleep(80);
  await g.clickMods(dp.x, dp.y, { alt: true }); await sleep(200);
  await g.keyUp('Alt');
  c.ok((await g.buildingCount()) === 3, 'Alt + click places the dining hall without a tie');
  const altTie = await g.eval(`(BSU.buildings.undoInfo(BSU.state) || {}).connector | 0`);
  c.ok(altTie === 0, `Alt opts out of the auto-tie (tie tiles: ${altTie})`);
  await g.days(10);   // the hall finishes; the issue scan runs
  c.ok(await g.eval(`BSU.issues.all(BSU.state).some(function (i) { return i.kind === 'unlinkedPath'; })`), 'the untied building shows up as an unlinked-path issue');
  await g.clearUi({ panel: false });

  // the refusal: nothing within 12 tiles of the network, fewer than five buildings done
  const far = await g.scan('dining_hall', { want: 'refuse', rMin: 16 });
  c.need(far, 'a spot with no network within 12 tiles exists');
  const nBefore = await g.buildingCount();
  await g.clearUi({ panel: false }); c.need(await g.pickTool('dining_hall'), 'the Dining Hall arms again');
  const cam0 = await g.eval(`({ x: BSU.state.ui.camera.x, y: BSU.state.ui.camera.y })`);
  await g.clickTileCentered(far.tx, far.ty); await sleep(250);
  c.ok((await g.buildingCount()) === nBefore, 'a placement with no network in reach is refused');
  const refusalText = await g.eval(`document.getElementById('notifications').innerText + ' | ' + document.getElementById('ghost-label').innerText + ' | tool ' + ((BSU.ui.tool() && BSU.ui.tool().id) || 'none')`);
  c.ok(/Can.t reach a path/.test(refusalText), 'the refusal says to draw a path first');
  if (!/Can.t reach a path/.test(refusalText)) g.notes.push('refusal text was: ' + refusalText.replace(/\s+/g, ' ').slice(0, 200));
  const camFar = await g.eval(`({ x: BSU.state.ui.camera.x, y: BSU.state.ui.camera.y })`);
  c.ok(await g.clickButtonText('#notifications', 'Show me'), 'the refusal carries a Show me button');
  await sleep(1200);
  const cam1 = await g.eval(`({ x: BSU.state.ui.camera.x, y: BSU.state.ui.camera.y })`);
  c.ok(Math.hypot(cam1.x - camFar.x, cam1.y - camFar.y) > 80, `Show me pans to the nearest campus path (${Math.round(Math.hypot(cam1.x - camFar.x, cam1.y - camFar.y))} px)`);
  void cam0; await g.key('Escape');

  // buildings 4 and 5, then the window closes: the same far spot is allowed (as "Not linked")
  for (const id of ['lecture_hall', 'poboy', 'quad']) await g.placeAnywhere(id);
  await g.days(25);
  const done = await g.eval(`BSU.buildings.completedCount(BSU.state)`);
  c.ok(done >= 5, `five buildings are complete (${done})`);
  c.ok(!(await g.eval(`BSU.buildings.tieEnforced(BSU.state)`)), 'the tie window is closed after five');
  c.ok(await g.eval(`(function () { var r = BSU.buildings.canPlace(BSU.state, 'dining_hall', ${far.tx}, ${far.ty}, { rot: 0, ignoreCash: true }); return r.ok && !!r.unlinked; })()`), 'the far spot now places as "Not linked"');
});

scenario('network-hold', 'N held = the network view, N tapped = the Season panel', async (c) => {
  const { g } = c;
  await c.fresh({ unlock: true, cash: 1e9 });
  for (const id of ['dorm', 'dining_hall', 'lecture_hall']) await g.placeAnywhere(id);
  await g.days(15); await g.clearUi();
  c.ok(!(await g.eval(`BSU.ui.networkView()`)), 'the network view is off at rest');
  await g.keyDown('n'); await sleep(150);
  await g.keyDown('n', { repeat: true }); await sleep(250);
  c.ok(await g.eval(`BSU.ui.networkView()`), 'holding N turns the network view on');
  await sleep(250); await c.shot('network-held');
  c.ok((await g.eval(`BSU.render.networkStats().sheen`)) >= 0, 'the network pass reports stats');
  await g.keyUp('n'); await sleep(150);
  c.ok(!(await g.eval(`BSU.ui.networkView()`)), 'releasing N turns it off');
  c.ok((await g.eval(`BSU.state.ui.panel`)) !== 'season', 'a hold does not open the Season panel');
  await g.key('n'); await sleep(200);
  c.ok((await g.eval(`BSU.state.ui.panel`)) === 'season', 'tapping N opens the Season panel');
  await g.key('Escape'); await sleep(100);
  c.ok((await g.eval(`BSU.state.ui.panel`)) === null, 'Escape closes it');
});

scenario('land-office', 'Land Office: buy a section through the panel, then the prestige gate refuses', async (c) => {
  const { g } = c;
  await c.fresh({ cash: 50e6 });
  const before = await g.eval(`BSU.land.stats(BSU.state)`);
  await g.key('o'); await sleep(300);
  c.need((await g.eval(`BSU.state.ui.panel`)) === 'land', 'O opens the Land Office');
  if (before.sections === 0) {   // the legacy 64 world: the charter covers the whole map
    c.ok(/no land to sell/i.test(await g.eval(`document.getElementById('panels').innerText`)), 'the 64 world has no state land and the panel says so');
    const r64 = await g.eval(`BSU.headless.charter(1)`);
    c.ok(r64 && r64.ok === false, 'a purchase is refused (' + (r64 && r64.reason) + ')');
    return;
  }
  c.ok(before.owned === 0 && before.forSale > 0, `the Land Office starts with ${before.forSale} sections for sale`);
  c.ok(await g.elVisible('#btn-land-buy'), 'the panel shows a Buy button');
  await c.shot('land-office');
  // Buy is a two-step button (Buy · $X, then Confirm · $X): click until the owned count moves
  const buy = async (expected) => { for (let i = 0; i < 3 && (await g.eval(`BSU.land.stats(BSU.state).owned`)) < expected; i++) { await g.clickEl('#btn-land-buy'); await sleep(300); } return g.eval(`BSU.land.stats(BSU.state).owned`); };
  c.ok((await buy(1)) === 1, 'Buy then Confirm charters the first section');
  await g.clearUi({ panel: false });   // the "Section N is yours" card sits over the panel's Buy button
  // the second section is free of a gate; the third needs prestige
  const second = await g.eval(`(function () { var s = BSU.land.sections(BSU.state).filter(function (x) { return x.forSale && !x.owned; }).sort(function (a, b) { return a.price - b.price; }); return s.length ? s[0].id : -1; })()`);
  c.need(second >= 0, 'another section is for sale');
  await g.eval(`(BSU.ui.openLandOffice(${second}), true)`); await sleep(250);
  c.ok((await buy(2)) === 2, 'the second section buys too');
  await g.clearUi({ panel: false });
  const gated = await g.eval(`(function () { var s = BSU.land.sections(BSU.state).filter(function (x) { return x.forSale && !x.owned; }).sort(function (a, b) { return a.price - b.price; }); return s.length ? s[0].id : -1; })()`);
  const r = await g.eval(`BSU.headless.charter(${gated})`);
  c.ok(r && r.ok === false && /prestige/i.test(r.reason), `the third section is refused on prestige: "${r && r.reason}"`);
  await g.eval(`(BSU.ui.openLandOffice(${gated}), true)`); await sleep(250);
  c.ok(await g.eval(`(function () { var b = document.getElementById('btn-land-buy'); return !!b && b.disabled; })()`), 'the Buy button is disabled behind the gate');
  await c.shot('land-gate');
  const forced = await g.eval(`BSU.headless.charter(${gated}, true)`);
  c.ok(forced && forced.ok === true, 'force skips the gate (QA path)');
  // a placement on state land is refused with the Land Office reason
  await g.clearUi();
  const spot = await g.eval(`(function () { var s = BSU.state, W = BSU.MAP.W; for (var ty = 2; ty < BSU.MAP.H - 4; ty += 2) for (var tx = 2; tx < W - 4; tx += 2) { var q = BSU.buildings.canPlace(s, 'dorm', tx, ty, { rot: 0, ignoreCash: true }); if (!q.ok && q.charter) return [tx, ty]; } return null; })()`);
  c.ok(!!spot, 'a dorm on unchartered land is refused with a charter reason');
});

scenario('dredge', 'Dredge & Fill: a real drag over marsh, ten days later it is dry ground', async (c) => {
  const { g } = c;
  await c.fresh({ unlock: true, cash: 1e9 });
  const run = await g.eval(`(function () { var s = BSU.state, f = s.plot.founders; for (var r = 3; r < 30; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; var tx = f.tx + dx, ty = f.ty + dy, ok = true; for (var k = 0; k < 4; k++) { var q = BSU.buildings.canPlace(s, 'dredge_fill', tx + k, ty, { rot: 0 }); if (!q.ok) { ok = false; break; } } if (ok) return [tx, ty]; } return null; })()`);
  c.need(run, 'a 4-tile marsh run exists near the campus');
  const [x, y] = run;
  await g.panToTile(x + 2, y); await sleep(100); await g.settleCamera();
  await g.clearUi({ panel: false }); c.need(await g.pickTool('dredge_fill'), 'Dredge & Fill arms from the Swamp tab');
  const pts = []; for (let k = 0; k < 4; k++) { const p = await g.tilePx(x + k, y); pts.push([p.x, p.y]); }
  const cash0 = await g.eval(`BSU.state.economy.cash`);
  await g.b.dragPath(pts, 4); await sleep(400);
  const spent = cash0 - (await g.eval(`BSU.state.economy.cash`));
  const unit = await g.eval(`BSU.data.catalog.dredge_fill.cost`);
  c.ok(spent === 4 * unit, `the drag fills 4 tiles for 4 × $${unit} (spent $${spent})`);
  c.ok((await g.eval(`[0, 1, 2, 3].every(function (k) { return BSU.state.tiles.type[BSU.idx(${x} + k, ${y})] === BSU.T.MARSH; })`)), 'the tiles are still marsh while the fill is in progress');
  await c.shot('dredge-filling');
  await g.days(11);
  c.ok((await g.eval(`[0, 1, 2, 3].every(function (k) { return BSU.state.tiles.type[BSU.idx(${x} + k, ${y})] === BSU.T.DRY; })`)), 'ten days later the tiles are Dry');
  // and the headless entry point
  const r = await g.eval(`(function () { var s = BSU.state; for (var ty = ${y} + 2; ty < ${y} + 12; ty++) { var q = BSU.buildings.canPlace(s, 'dredge_fill', ${x}, ty, { rot: 0 }); if (q.ok) { var r = BSU.headless.fill([[${x}, ty], [${x} + 1, ty]], {}); return { ok: r.ok, placed: r.placed }; } } return null; })()`);
  c.ok(!r || (r.ok && r.placed === 2), 'headless.fill commits a 2-tile run');
});

scenario('hurricane', 'a Cat 3 forced landfall with surge, played through with real frames', async (c) => {
  const { g } = c;
  await c.fresh({ unlock: true, cash: 1e9 });
  for (const id of ['dorm', 'dining_hall', 'lecture_hall', 'substation', 'water_tower', 'poboy']) await g.placeAnywhere(id);
  await g.days(10); await g.clearUi();
  const base = (await g.snapshot()).floodedTiles;
  const st = await g.eval(`(function () { var s = BSU.headless.forceHurricane(3); return s ? { name: s.name, cat: s.cat } : null; })()`);
  c.need(st && st.cat === 3, `a Cat 3 storm is spawned (${st && st.name})`);
  let maxFlood = 0, landfallTick = -1, maxPhase = 0, shot = false;
  await g.run(5200, { slice: 40, frameMs: 20, each: async (i, done) => {
    const r = await g.eval(`(function () { var c = BSU.state.storms && BSU.state.storms.current, sp = BSU.state.setPiece; return { phase: c ? c.phase : -1, sp: sp ? sp.kind : null, spTick: sp ? sp.tick : 0, flooded: BSU.headless.snapshot().floodedTiles, gone: !c }; })()`);
    maxFlood = Math.max(maxFlood, r.flooded); maxPhase = Math.max(maxPhase, r.phase);
    if (r.sp === 'landfall' && landfallTick < 0) landfallTick = done;
    if (!shot && r.sp === 'landfall' && r.spTick > 300) { shot = true; await await c.shot('landfall'); }
    return r.gone && done > 3400;   // the storm has passed and been cleared
  } });
  c.ok(landfallTick >= 0, 'the landfall set piece ran');
  c.ok(maxPhase >= 5, `the storm reached landfall (max phase ${maxPhase})`);
  c.ok(maxFlood > base + 100, `surge floods the map (${base} → ${maxFlood} tiles)`);
  c.ok(!(await g.eval(`BSU.session._scanNumbers(BSU.state, 'state')`)), 'no NaN / Infinity in the state after the storm');
  await g.clearUi();
});

scenario('night-game', 'a night home game under the lights, with fireworks', async (c) => {
  const { g } = c;
  await c.fresh({ unlock: true, cash: 1e9 });
  c.need((await g.placeAnywhere('practice_field')).ok && (await g.placeAnywhere('stadium')).ok, 'practice field and stadium place');
  await g.days(30);
  const up = await g.eval(`(function () { var b = BSU.state.buildings.filter(function (b) { return b && b.type === 'stadium'; })[0]; return BSU.buildings.upgrade(BSU.state, b.id); })()`);
  c.need(up && up.ok, 'the stadium upgrades to tier 2 (' + (up && (up.reason || 'ok')) + ')');
  await g.days(40); await g.clearUi();
  c.need((await g.eval(`BSU.state.sports.venue`)) === 'stadium2', 'Stadium II is the venue (night capable)');
  const r = await g.eval(`(BSU.sports.setNight(BSU.state, true), BSU.sports.playHome(BSU.state))`);
  c.need(r && r.ok, 'a home game starts (' + (r && (r.reason || r.mode)) + ')');
  let night = false, nightSky = false, maxShells = 0, maxLights = 0, shot = false, ended = false;
  await g.run(1400, { slice: 25, frameMs: 35, each: async () => {
    const x = await g.eval(`(function () { var s = BSU.state, g = s.sports.game; return { game: !!g, night: !!(g && g.night), sky: BSU.weather.sky(s).phase, shells: BSU.render.fxStats().shells, lights: BSU.render.lightsCount(), sp: !!s.setPiece, home: g ? g.homePts : 0 }; })()`);
    if (x.night) night = true; if (x.sky === 4) nightSky = true; maxShells = Math.max(maxShells, x.shells); maxLights = Math.max(maxLights, x.lights);
    if (!shot && x.sky === 4 && x.shells > 0 && x.lights > 0) { shot = true; await await c.shot('night-fireworks'); }
    if (!x.game && !x.sp) { ended = true; return true; }
    return false;
  } });
  c.ok(night, 'the game is a night game');
  c.ok(nightSky, 'the sky goes to night');
  c.ok(maxLights > 0, `the lights pass draws light sources (${maxLights})`);
  c.ok(maxShells > 0, `fireworks shells fly (${maxShells})`);
  c.ok(ended, 'the game ends and the set piece releases');
  await g.clearUi();
});

scenario('year-rollover', 'run a full game year; the calendar rolls and the state stays finite', async (c) => {
  const { g } = c;
  await c.fresh({ unlock: true, cash: 1e9 });
  for (const id of ['dorm', 'dining_hall', 'lecture_hall', 'substation', 'water_tower']) await g.placeAnywhere(id);
  const y0 = (await g.snapshot()).year;
  const per = await g.eval(`BSU.params.time.ticksPerYear`);
  // the calendar can lag the tick counter (pauses while a set piece or card holds it), so run until the year flips, then a day beyond
  await g.run(Math.round(per * 1.3), { slice: 400, frameMs: 15, each: async () => { await g.clearUi(); return (await g.snapshot()).year > y0; } });
  await g.run(400, { slice: 200, frameMs: 15 });
  const s = await g.snapshot();
  c.ok(s.year === y0 + 1, `the calendar rolls to year ${y0 + 1} (year ${s.year})`);
  c.ok(!(await g.eval(`BSU.session._scanNumbers(BSU.state, 'state')`)), 'no NaN / Infinity in the state');
  c.ok(await g.eval(`!!(BSU.state.progress.recap) || BSU.state.ticker.length > 0`), 'a year recap / ticker entries exist');
  c.ok(Number.isFinite(s.cash) && s.students >= 0, `cash and students are sane ($${Math.round(s.cash)}, ${s.students})`);
  await g.clearUi();
});

scenario('save-load', 'save then load (identical snapshot), then load the v1 fixture', async (c) => {
  const { g } = c;
  await c.fresh({ unlock: true, cash: 1e9 });
  for (const id of ['dorm', 'dining_hall', 'lecture_hall']) await g.placeAnywhere(id);
  await g.days(6); await g.clearUi();
  // save and snapshot in ONE evaluation (the real-time loop must not tick in between), and the same for load
  const sv = await g.eval(`(function () { var json = BSU.session.save('qa'); return { len: json.length, snap: BSU.headless.snapshot() }; })()`);
  c.ok(sv.len > 1000, `save() returns JSON (${sv.len} chars)`);
  await g.days(4); await g.placeAnywhere('poboy');
  const ld = await g.eval(`(function () { var s = BSU.session.load('qa'); return { ok: !!s, snap: BSU.headless.snapshot() }; })()`);
  c.ok(ld.ok, 'load("qa") returns a state');
  c.ok(JSON.stringify(sv.snap) === JSON.stringify(ld.snap), 'the snapshot is identical after load' + (JSON.stringify(sv.snap) === JSON.stringify(ld.snap) ? '' : ` (${JSON.stringify(sv.snap)} vs ${JSON.stringify(ld.snap)})`));
  await g.days(2); await g.sleep(150);
  // the v1 fixture through the migration path
  const fx = readFileSync(FIXTURE_V1, 'utf8');
  await g.eval(`(localStorage.setItem('bsu.save.qafx', ${JSON.stringify(fx)}), true)`);
  const ok = await g.eval(`(function () { try { return !!BSU.session.load('qafx'); } catch (e) { return 'threw ' + e; } })()`);
  c.need(ok === true, 'the v1 fixture loads (' + ok + ')');
  const f = await g.snapshot();
  c.ok(f.tick === 1800 && f.day === 10, `the fixture state is what was saved (tick ${f.tick}, day ${f.day})`);
  await g.days(3); await g.sleep(200);
  c.ok(!(await g.eval(`BSU.session._scanNumbers(BSU.state, 'state')`)), 'the migrated game runs three days with a finite state');
  await g.clearUi();
});

scenario('hud-modes', 'H cycles full > compact > hidden; Shift+H returns to full', async (c) => {
  const { g } = c;
  await c.fresh();
  const mode = () => g.eval(`BSU.ui.hudMode()`), dom = () => g.eval(`document.getElementById('hud').dataset.hud`);
  c.ok((await mode()) === 'full', 'starts in the full HUD');
  const seen = [];
  for (let i = 0; i < 3; i++) { await g.key('h'); await sleep(150); seen.push(await mode()); c.ok((await dom()) === seen[i], `H #${i + 1}: ${seen[i]} (the DOM follows)`); if (seen[i] === 'compact') await c.shot('hud-compact'); if (seen[i] === 'hidden') await c.shot('hud-hidden'); }
  c.ok(seen.join('>') === 'compact>hidden>full', `H cycles ${seen.join(' > ')}`);
  await g.key('h'); await sleep(120);
  c.ok((await mode()) === 'compact', 'compact again');
  await g.key('h', { shift: true }); await sleep(150);
  c.ok((await mode()) === 'full', 'Shift+H returns to full');
  await g.key('h'); await g.key('h'); await sleep(100);
  c.ok((await mode()) === 'hidden' && (await g.eval(`BSU.ui.settings().hudMode`)) === 'hidden', 'the mode is a saved setting (hidden)');
  await g.key('h', { shift: true }); await sleep(100);
  await g.eval(`(BSU.ui.setHudMode('full'), true)`);
});

scenario('zoom-steps', 'every zoom step at dpr 1 and dpr 2, with real frames at each', async (c) => {
  const { g } = c;
  await c.fresh({ unlock: true, cash: 1e9 });
  for (const id of ['dorm', 'dining_hall', 'lecture_hall', 'library', 'union']) await g.placeAnywhere(id);
  await g.days(5); await g.clearUi(); await g.centerCampus();
  const steps = await g.eval(`BSU.render.zoomSteps()`);
  c.ok(steps.length === 9 && steps[0] === 0.5 && steps[8] === 2.5, `nine zoom steps (${steps.join(' ')})`);
  for (const dpr of [1, 2]) {
    await g.setDpr(dpr); await g.noGuard(); await g.centerCampus();
    c.ok((await g.eval(`BSU.render.perf().dpr`)) === dpr, `render picks up dpr ${dpr}`);
    // down to the minimum with '-', then up through every step with '='
    for (let i = 0; i < steps.length; i++) await g.key('-', { settleMs: 20 });
    c.ok((await g.eval(`BSU.render.perf().zoom`)) === 0.5 || (await g.eval(`BSU.state.ui.camera.zoom`)) === 0.5, `dpr ${dpr}: '-' reaches 0.5`);
    for (let i = 0; i < steps.length; i++) {
      const z = await g.eval(`BSU.state.ui.camera.zoom`);
      c.ok(Math.abs(z - steps[i]) < 1e-6, `dpr ${dpr}: step ${i} is ${steps[i]}`);
      const p = await g.sample(8, { settle: 4 });
      c.ok(Number.isFinite(p.frameMs) && p.drawCalls > 0 && p.chunks > 0, `dpr ${dpr} zoom ${steps[i]}: frames draw (${p.drawCalls} calls, ${p.chunks} chunks, ${p.frameMsMean} ms)`);
      if (steps[i] === 0.5 || steps[i] === 2.5) await c.shot(`zoom-${steps[i]}-dpr${dpr}`);
      if (i < steps.length - 1) await g.key('=', { settleMs: 20 });
    }
    await g.key('Home'); await sleep(100);
  }
  await g.setDpr(1);
  await g.eval(`(BSU.render.setZoom(1), true)`);
});

scenario('build-tabs', 'every build tab: click it, count its items; Tab / Shift+Tab; the G menu', async (c) => {
  const { g } = c;
  await c.fresh({ unlock: true, cash: 1e9 });
  const tabs = await g.eval(`BSU.data.tabs.map(function (t) { return { id: t.id, n: t.rows.length }; })`);
  await g.eval(`(BSU.data.tabs.forEach(function (t) { BSU.ui.introduceTab(BSU.state, t.id); }), true)`);
  await sleep(300); await g.clearUi();
  for (const t of tabs) {
    const clicked = await g.clickEl(`#palette-tabs .tab[data-tab="${t.id}"]`); await sleep(120);
    const cur = await g.eval(`BSU.state.ui.paletteTab`);
    const ids = await g.eval(`Array.from(document.querySelectorAll('#palette-items [data-id]')).filter(function (e) { return e.offsetParent !== null; }).map(function (e) { return e.dataset.id; })`);
    const rows = await g.eval(`BSU.data.tabs.find(function (t) { return t.id === ${JSON.stringify(t.id)}; }).rows`);
    const extra = ids.filter((i) => rows.indexOf(i) < 0), missing = rows.filter((i) => ids.indexOf(i) < 0);
    c.ok(clicked && cur === t.id && !missing.length && extra.every((i) => i === 'land'), `tab ${t.id}: ${ids.length - extra.length}/${t.n} items${missing.length ? ', missing ' + missing.join(',') : ''}${extra.length ? ' (+' + extra.join(',') + ')' : ''}`);
    if (t.id === 'swamp' || t.id === 'academic') await c.shot('tab-' + t.id);
  }
  await g.clickEl(`#palette-tabs .tab[data-tab="essentials"]`); await sleep(100);
  await g.key('Tab'); await sleep(100);
  c.ok((await g.eval(`BSU.state.ui.paletteTab`)) === tabs[1].id, 'Tab moves to the next tab');
  await g.key('Tab', { shift: true }); await sleep(100);
  c.ok((await g.eval(`BSU.state.ui.paletteTab`)) === tabs[0].id, 'Shift+Tab moves back');
  c.ok(await g.pickTool('lecture_hall'), 'a palette item arms its tool');
  await g.key('Escape'); await sleep(100);
  c.ok(!(await g.eval(`BSU.ui.tool()`)), 'Escape disarms it');
  await g.key('g'); await sleep(300);
  c.ok(await g.eval(`BSU.ui.buildMenuOpen()`), 'G opens the Build menu'); await c.shot('build-menu');
  await g.key('Escape'); await sleep(150);
  c.ok(!(await g.eval(`BSU.ui.buildMenuOpen()`)), 'Escape closes it');
});

scenario('issues-tray', 'Issues tray: Fix arms the remedy, Link it lays the tie, snooze hides the row', async (c) => {
  const { g } = c;
  await c.fresh({ unlock: true, cash: 1e9 });
  for (const id of ['dorm', 'dining_hall', 'lecture_hall', 'poboy', 'quad']) await g.placeAnywhere(id);
  await g.days(20); await g.clearUi();
  c.need(await g.eval(`BSU.issues.list(BSU.state).length > 0`), 'the new campus has issues (power, water, beds…)');
  await sleep(300);
  // Fix: arms the suggested building
  await g.clearUi({ panel: false });
  c.ok(await g.clickButtonText('#issues-tray', 'Fix'), 'the tray has a Fix button');
  await sleep(250);
  const armed = await g.eval(`(BSU.ui.tool() && BSU.ui.tool().id) || null`);
  c.ok(!!armed, `Fix arms a tool (${armed})`); await c.shot('issue-fix-armed');
  await g.key('Escape'); await sleep(100);
  c.ok(!(await g.eval(`BSU.ui.tool()`)), 'Escape disarms it');
  // Link it: a building placed with no tie (Alt) within reach becomes an unlinked-path suggestion
  const spot = await g.scan('lecture_hall', { want: 'tie', minTie: 2, maxTie: 10, skip: [[0, 0]] });
  c.need(spot, 'a lecture hall spot with a 2+ tile tie exists');
  const placed = await g.eval(`BSU.buildings.place(BSU.state, 'lecture_hall', ${spot.tx}, ${spot.ty}, { rot: 0, noTie: true }).ok`);
  c.need(placed, 'the lecture hall is placed without its tie');
  await g.days(12); await g.clearUi({ panel: false }); await sleep(400);
  c.ok(await g.eval(`BSU.issues.suggestions(BSU.state).some(function (i) { return i.kind === 'unlinkedPath'; })`), 'the untied hall is an unlinked-path suggestion');
  if (!(await g.clickButtonText('#issues-tray', 'Suggestions'))) c.ok(false, 'the Suggestions header can be clicked');
  await sleep(350);
  await c.shot('issue-suggestions');
  c.ok(await g.clickButtonText('#issues-tray', 'Link it'), 'the suggestion row has Link it');
  await sleep(300); await g.tick(80); await sleep(300);
  c.ok(!(await g.eval(`BSU.issues.list(BSU.state).concat(BSU.issues.suggestions(BSU.state)).some(function (i) { return i.kind === 'unlinkedPath'; })`)), 'Link it ties the building in and the row is gone');
  // snooze: the zz button hides a row and the hidden pill appears
  await g.clearUi({ panel: false }); await sleep(200);
  const before = await g.eval(`BSU.issues.hiddenList(BSU.state).length`);
  const zz = await g.eval(`(function () { var b = Array.from(document.querySelectorAll('#issues-tray button')).filter(function (e) { return /^zz/.test(e.textContent) && e.getBoundingClientRect().width > 0; })[0]; if (!b) return null; var q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
  c.need(zz, 'a visible snooze (zz) button exists');
  await g.click(zz.x, zz.y); await sleep(350);
  const after = await g.eval(`BSU.issues.hiddenList(BSU.state).length`);
  c.ok(after === before + 1, `snooze hides one row (hidden ${before} → ${after})`);
  c.ok(await g.elVisible('#issues-hidden'), 'the "hidden" pill shows so the row can come back');
  c.ok(!(await g.eval(`(BSU.ui.tool() && BSU.ui.tool().id) || null`)), 'no tool left armed');
});

scenario('title-panels', 'title screen: How to play and About open and close; the same two from Settings', async (c) => {
  const { g } = c;
  await c.fresh();
  await g.title(true); await sleep(500);
  c.ok(await g.elVisible('#title'), 'the title screen is up');
  await c.shot('title');
  for (const [btn, panel, needle] of [['#btn-title-howto', 'howto', 'How to play'], ['#btn-title-about', 'about', 'About this build']]) {
    c.ok(await g.elVisible(btn), `${btn} is visible on the title`);
    await g.clickEl(btn); await sleep(350);
    c.ok((await g.eval(`BSU.state.ui.panel`)) === panel, `${panel} panel opens from the title`);
    const txt = await g.eval(`document.getElementById('panels').innerText`);
    c.ok(txt.indexOf(needle) >= 0 && txt.length > 200, `${panel} panel has its text (${txt.length} chars)`);
    if (panel === 'howto') c.ok(/BUILD/.test(txt), 'How to play has the BUILD section');
    await c.shot('title-' + panel);
    await g.key('Escape'); await sleep(200);
    c.ok((await g.eval(`BSU.state.ui.panel`)) === null, `Escape closes ${panel} on the title`);
  }
  await g.title(false); await sleep(300);
  await g.clickEl('#btn-menu'); await sleep(350);
  for (const [btn, panel] of [['#btn-set-howto', 'howto'], ['#btn-set-about', 'about']]) {
    if (!(await g.elVisible(btn))) await g.eval(`(BSU.ui.openPanel('settings'), true)`), await sleep(300);
    c.ok(await g.elVisible(btn), `${btn} is in Settings`);
    await g.clickEl(btn); await sleep(300);
    c.ok((await g.eval(`BSU.state.ui.panel`)) === panel, `Settings opens ${panel}`);
    await g.eval(`(BSU.ui.openPanel('settings'), true)`); await sleep(200);
  }
  await g.clearUi();
});

// ---------------------------------------------------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------------------------------------------------
if (args.list) { for (const s of SCENARIOS) console.log(s.name.padEnd(14), s.desc); process.exit(0); }
const wanted = args.only.length ? args.only : SCENARIOS.map((s) => s.name);
for (const n of wanted) if (!SCENARIOS.find((s) => s.name === n)) { console.error(`unknown scenario "${n}" (known: ${SCENARIOS.map((s) => s.name).join(', ')})`); process.exit(2); }
const index = resolveIndex(args.index);
const sizes = sizesOf(args.size);
const lines = []; const details = []; let failed = 0; const t00 = Date.now();

const withTimeout = (p, ms, label) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout after ${ms / 1000}s in ${label}`)), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

for (const size of sizes) {
  let g = null;
  const boot = async () => { if (g) { try { await g.close(); } catch { /* gone */ } } g = await openGame({ index, width: args.width, height: args.height, size, outDir: args.out, newGame: false, evalTimeoutMs: 60000 }); };
  try { await boot(); } catch (e) { console.error(`FAIL ${size} (boot): ${e.message}`); failed++; lines.push(`FAIL  ${size}  boot  ${e.message}`); continue; }
  for (const name of wanted) {
    const sc = SCENARIOS.find((s) => s.name === name);
    // a page that does not answer within 10 s (a stalled or dead Chrome) is replaced before the scenario starts
    const alive = await Promise.race([g.eval('1').then(() => true, () => false), sleep(10000).then(() => false)]);
    if (!alive) { try { await boot(); } catch (e) { lines.push(`FAIL  ${size}  ${name.padEnd(14)} chrome died: ${e.message}`); failed++; continue; } }
    const mark = await g.mark(); const t0 = Date.now();
    const fails = []; let checks = 0, shotTaken = false;
    const ctx = {
      g, size,
      ok(cond, msg) { checks++; if (!cond) fails.push(msg); return !!cond; },
      need(cond, msg) { checks++; if (!cond) { fails.push(msg); throw new NeedFailed(msg); } return true; },
      async shot(label) { if (args.shots) { shotTaken = true; await g.shot(`${size}-${name}-${label}`); } },
      async fresh({ skipTutorial = true, dpr = 1, cash, unlock = false, seed = 42 } = {}) {
        await g.restoreUnlock(); await g.clearUi();
        if ((g.dpr || 1) !== dpr) await g.setDpr(dpr);
        await g.newGame({ seed, skipTutorial, size });
        await g.eval(`(function () { var st = BSU.ui.settings(); st.tieCardSeen = false; st.coachSeen = true; BSU.ui.setHudMode('full'); BSU.ui.saveSettings(); return true; })()`);
        if (unlock) await g.unlockAll();
        if (cash) await g.cash(cash);
        await sleep(100);
      },
    };
    let threw = null, stalled = false;
    try { await withTimeout(sc.run(ctx), sc.timeoutMs, name); }
    catch (e) { if (!(e instanceof NeedFailed)) threw = e; }
    if (threw && /timeout after|timed out/.test(threw.message)) { try { await boot(); } catch { /* the next scenario's health check reports it */ } stalled = true; }   // the old page may still be grinding: never reuse it
    if (args.shots && !shotTaken && !stalled) { try { await g.shot(`${size}-${name}-end`); } catch { /* page gone */ } }
    let errs = [], warns = [];
    if (!stalled) { try { errs = await g.errorsSince(mark); } catch (e) { errs = ['could not read errors: ' + e.message]; } warns = g.warningsSince(mark); }
    const bad = fails.length > 0 || !!threw || errs.length > 0 || (args.strict && warns.length > 0);
    if (bad) failed++;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const why = [fails[0], threw && 'threw: ' + threw.message.split('\n')[0].slice(0, 110), errs.length && `${errs.length} error(s)`, args.strict && warns.length && `${warns.length} warning(s)`].filter(Boolean).join(' | ');
    lines.push(`${bad ? 'FAIL' : 'PASS'}  ${String(size).padEnd(3)} ${name.padEnd(14)} ${secs.padStart(5)}s  ${String(checks).padStart(2)} checks${warns.length ? `  ${warns.length} warn` : ''}${why ? '  ' + why : ''}`);
    if (threw) details.push(`      [${size} ${name}] threw: ${threw.message.slice(0, 900)}`);
    for (const f of fails.slice(1)) details.push(`      [${size} ${name}] ${f}`);
    for (const e of errs.slice(0, 4)) details.push(`      [${size} ${name}] ${e}`);
    for (const w of warns.slice(0, 2)) details.push(`      [${size} ${name}] ${w.slice(0, 200)}`);
    for (const n of g.notes.splice(0)) details.push(`      [${size} ${name}] note: ${n}`);
  }
  try { await g.close(); } catch { /* gone */ }
}
killStrays();
console.log(lines.join('\n'));
if (details.length) console.log('\n' + details.join('\n'));
console.log(`\n${failed ? failed + ' FAILED' : 'ALL OK'}  (${sizes.join(' + ')}; ${wanted.length} scenarios; ${((Date.now() - t00) / 1000).toFixed(0)}s)`);
process.exit(failed ? 1 : 0);
