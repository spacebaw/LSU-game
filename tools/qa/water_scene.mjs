#!/usr/bin/env node
// Water and structures pass (a student's playtest notes N3, N4, N7, N13, N15): real pointer drags on seed 42 at 96, each case on a
// fresh game, with mid-drag shots (the ghost and its label), shots at zoom 2 and zoom 1 and printed measurements.
//
//   canal     a Drainage Canal dragged from the cove's low spot toward the bayou, released TWO TILES SHORT of the water (what a student
//             does), through two rain cells: the cove's standing water against the same rain before the canal, the canal's card
//   nooutlet  a canal dragged where no water is in reach: the ghost and the card say so
//   look      levee rendering: a straight run, a corner, a T, a closed ring, a run across a slope, an end at the water, a levee that
//             runs into a floodwall, a wall beside a building; zoom 2 and zoom 1
//   ring      a levee ring around a Dorm on low ground through a Cat 2 surge (5 ft, the same storm each time): no levee · the ring · the
//             ring with a canal dragged inside it (its outlet tie digs under the wall: a floodgate) · the ring left one tile open
//             (river flooding against a bank levee is measured in test/unit/water.test.mjs)
//   bridge    a road across a reach of 6 water tiles (row 56): the Campus Road is refused, the Road Bridge spans it; a bus crosses
//   heights   a Pedestrian Bridge and a Boardwalk across banks of four shapes (level, one bank 2 ft up, both banks high, marsh fringe)
//   walkers   a Dorm on the far bank whose only way to class is a Pedestrian Bridge: students on the deck, counted over two game days
//
//   node tools/qa/water_scene.mjs [--strict] [--index path] [--tag before|after] [--only canal,nooutlet,look,ring,bridge,heights,walkers] [--out dir]
//
// Run it on tools/qa/out/index-before.html with --tag before for the "before" shots (that build has no Road Bridge: the Campus Road is
// dragged instead, and nothing new is asserted). --strict exits 1 unless the pass's promises hold (see `must` below). Scaffolding, not
// play: cash, g.unlockAll(), the queued rain cells, the forced stage / hurricane, plants cleared off the shot sites, the bank heights of
// the `heights` case (the real map has a marsh fringe on every reach), the Dorm and Lecture Hall of `walkers`, fast-forwarded days.
import { openGame, parseArgs, DEFAULT_OUT, resolveIndex, killStrays, sleep } from './lib.mjs';

const ALL = ['canal', 'nooutlet', 'look', 'ring', 'bridge', 'heights', 'walkers'];
const args = parseArgs(process.argv.slice(2), {
  index: { type: 'str', def: '' }, tag: { type: 'str', def: 'after' }, out: { type: 'str', def: DEFAULT_OUT }, only: { type: 'list', def: ALL },
  strict: { type: 'bool', def: false }, width: { type: 'num', def: 1440 }, height: { type: 'num', def: 900 },
});
const W = 96, I = (x, y) => y * W + x;
const row = (y, x0, x1) => { const t = []; const st = x1 >= x0 ? 1 : -1; for (let x = x0; x !== x1 + st; x += st) t.push(I(x, y)); return t; };
const col = (x, y0, y1) => { const t = []; const st = y1 >= y0 ? 1 : -1; for (let y = y0; y !== y1 + st; y += st) t.push(I(x, y)); return t; };
const index = resolveIndex(args.index), TAG = args.tag;
killStrays();
const g = await openGame({ index, width: args.width, height: args.height, size: 96, seed: 42, outDir: args.out, noGuard: true });
let code = 0, problems = 0;
const bad = (m) => { problems++; console.log('  PROBLEM: ' + m); };
const must = (cond, m) => { if (args.strict && !cond) bad(m); return cond; };
const J = JSON.stringify;
const DAY = `(function () { try { if (!BSU.state.setPiece) BSU.weather.scriptSky(BSU.state, 1, 0.4); } catch (e) {} return true; })()`;   // shots in daylight (the landfall set piece scripts its own sky)
const shot = async (name) => { await g.eval(DAY); await sleep(180); const p = await g.shot(`water-${TAG}-${name}`); console.log('  shot ' + p.split('/').slice(-1)[0]); };

// ---- in-page helpers -------------------------------------------------------------------------------------------------------------
async function install() {
  await g.eval(`(function () {
    var X = window.__wx = {}, W = BSU.MAP.W;
    X.cls = function (i) { var s = BSU.state, t = s.tiles; if (t.flags[i] & (BSU.FLAG.BAYOU | BSU.FLAG.OPEN_WATER)) return 'w'; var ty = t.type[i]; if (ty === BSU.T.OPEN_WATER || ty === BSU.T.BAYOU || ty === BSU.T.POND) return 'w'; if (ty === BSU.T.MARSH && !(t.flags[i] & BSU.FLAG.DRAINED)) return 'm'; return 'd'; };
    X.ghost = null; var g0 = BSU.render.ghost; BSU.render.ghost = function (spec) { if (spec) X.ghost = spec; return g0.apply(BSU.render, arguments); };
    X.px = function (tx, ty) {   // a canvas point that picks tile (tx, ty): its centre, or the nearest point around it that does
      var R = BSU.render, p = R.tileToScreen(tx, ty), z = BSU.state.ui.camera.zoom, hit = function (x, y) { var t = R.screenToTile(x, y); return !!t && Math.floor(t.tx) === tx && Math.floor(t.ty) === ty; };
      if (hit(p.x, p.y)) return { x: p.x, y: p.y, moved: 0 };
      for (var r = 1; r <= 10; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; var x = p.x + dx * 4 * z, y = p.y + dy * 2 * z; if (hit(x, y)) return { x: x, y: y, moved: r }; }
      return { x: p.x, y: p.y, moved: -1 };
    };
    X.clearVeg = function (b) { var s = BSU.state; for (var k = s.veg.length - 1; k >= 0; k--) { var v = s.veg[k]; if (v && v.tx >= b[0] && v.tx <= b[2] && v.ty >= b[1] && v.ty <= b[3]) BSU.terrain.removeVeg(s, v.tx, v.ty); } BSU.render.dirtyAll(); return true; };
    X.label = function () { var e = BSU.ui.el['ghost-l1'], f = BSU.ui.el['ghost-l2'], gs = X.ghost || {}, xy = function (i) { return (i % W) + ',' + ((i / W) | 0); }; return { l1: e ? e.textContent : '', l2: f ? f.textContent : '', run: (gs.line || gs.tiles || []).map(xy).join(' '), red: (gs.skipTiles || []).map(xy).join(' '), color: gs.color || '', tool: BSU.state.ui.tool ? BSU.state.ui.tool.id : null }; };
    X.water = function (tiles) { var t = BSU.state.tiles, sum = 0, mx = 0, wet = 0, sat = 0, n = 0; for (var k = 0; k < tiles.length; k++) { var i = tiles[k]; if (t.flags[i] & BSU.FLAG.CANAL) continue; n++; var d = t.depth[i]; sum += d; if (d > mx) mx = d; if (d >= 0.05) wet++; sat += t.sat[i]; } return { n: n, sum: Math.round(sum * 100) / 100, max: Math.round(mx * 100) / 100, wet: wet, sat: Math.round(sat / Math.max(1, n) * 100) / 100 }; };
    X.card = function () { var c = document.querySelector('#inspect'); if (!c) return null; var rows = Array.from(c.querySelectorAll('.row, .insp-row')).map(function (r) { return (r.innerText || r.textContent || '').replace(/\\s+/g, ' ').trim(); }).filter(Boolean); return { title: (BSU.ui.el['insp-title'] || {}).textContent || '', sub: (BSU.ui.el['insp-sub'] || {}).textContent || '', rows: rows, buttons: Array.from(c.querySelectorAll('button')).map(function (b) { return (b.textContent || '').trim(); }).filter(Boolean) }; };
    return true; })()`);
}
const fresh = async ({ cash = 5e7 } = {}) => {
  await g.newGame(); await g.cash(cash); await g.unlockAll(); await install();
  await g.eval(`(BSU.ui.setHudMode('hidden'), true)`);
  await g.tick(45); await g.eval(DAY);
};
const view = async (z, tx, ty) => { await g.setZoom(z); await g.panToTile(tx, ty); await sleep(120); await g.settleCamera(); await g.waitBake({ timeoutMs: 60000 }); await sleep(150); };
const hasRow = async (id) => g.eval(`!!BSU.data.catalog[${J(id)}]`);
const pev = (type, p, buttons) => g.eval(`(function () { var c = BSU.ui.el.world, r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent(${J(type)}, { clientX: r.left + ${p.x}, clientY: r.top + ${p.y}, button: 0, buttons: ${buttons}, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })); return true; })()`);
/** a real drag with the armed tool: pressed on `from`, glided to `to`, held for the shot `name` (the ghost and its label), released */
async function drag(tool, from, to, name, { hold = true } = {}) {
  await g.eval(`(BSU.ui.selectTool(BSU.state, ${J(tool)}), window.__wx.ghost = null, true)`);
  const pa = await g.eval(`window.__wx.px(${from[0]}, ${from[1]})`), pb = await g.eval(`window.__wx.px(${to[0]}, ${to[1]})`);
  if (pa.moved < 0 || pb.moved < 0) throw new Error(`no screen point picks the drag's end tiles ${from} → ${to}`);
  await pev('pointermove', pa, 0); await pev('pointerdown', pa, 1);
  const steps = 14; for (let k = 1; k <= steps; k++) { await pev('pointermove', { x: pa.x + (pb.x - pa.x) * k / steps, y: pa.y + (pb.y - pa.y) * k / steps }, 1); await sleep(20); }
  await sleep(260);
  const lab = await g.eval(`window.__wx.label()`);
  if (hold && name) await shot(name);
  await pev('pointerup', pb, 0); await sleep(300);
  return lab;
}
const unarm = async () => { await g.eval(`(BSU.ui.selectTool(BSU.state, null), BSU.ui.closeInspect(), true)`); await g.clearUi(); await g.eval(`(BSU.ui.setHudMode('hidden'), true)`); await sleep(120); };
/** a real click on a tile with no tool armed: the inspect card */
const inspect = async (tx, ty) => { await unarm(); const p = await g.eval(`window.__wx.px(${tx}, ${ty})`); await g.click(p.x, p.y); await sleep(350); return g.eval(`window.__wx.card()`); };
/** queue the tutorial's rain cell over (cx, cy) and run the game through it (frames rendered); returns the ticks run */
const rainCell = async (cx, cy, days = 0.75) => {
  await g.eval(`(BSU.weather.queueCell(BSU.state, { cx: ${cx}, cy: ${cy}, inches: 3, scripted: true }), true)`);
  const tpd = await g.eval(`BSU.params.time.ticksPerDay`);
  return g.run(Math.round(tpd * days), { slice: 20, frameMs: 15 });
};

// ---- canal: the cove's low spot → the bayou, released two tiles short -----------------------------------------------------------------
const COVE = { low: [82, 48], centre: [80, 49], clear: [70, 42, 90, 56] };
async function caseCanal() {
  console.log('\n(canal) a Drainage Canal dragged from the low spot toward the bayou, released two tiles short of the water');
  await fresh(); await g.eval(`window.__wx.clearVeg(${J(COVE.clear)})`);
  const cove = await g.eval(`BSU.state.plot.cove.slice()`);
  await view(2, ...COVE.centre);
  // 1. the same rain with no canal (the control, measured on this very campus before the drag)
  let peak0 = { sum: 0 };
  await g.eval(`(BSU.weather.queueCell(BSU.state, { cx: ${COVE.low[0]}, cy: ${COVE.low[1]}, inches: 3, scripted: true }), true)`);
  const tpd = await g.eval(`BSU.params.time.ticksPerDay`);
  await g.run(tpd, { slice: 20, frameMs: 15, each: async () => { const w = await g.eval(`window.__wx.water(${J(cove)})`); if (w.sum > peak0.sum) peak0 = w; return false; } });
  const day1 = await g.eval(`window.__wx.water(${J(cove)})`);
  console.log(`  no canal: 3 in of rain on the cove → peak ${peak0.sum} tile-ft standing on ${peak0.wet}/${peak0.n} cove tiles (deepest ${peak0.max} ft); a day later ${day1.sum} tile-ft on ${day1.wet} tiles`);
  await shot('canal-1-rain-no-canal-z2');
  await g.days(6);   // dry out
  // 2. the drag: pressed on the low spot, released two tiles short of the bank
  const lab = await drag('canal', COVE.low, [80, 48], 'canal-2-drag');
  console.log(`  planned run: ${lab.run}${lab.red ? ' · red: ' + lab.red : ''} (${lab.color})`);
  console.log(`  mid-drag label: ${J(lab.l1)} / ${J(lab.l2)}`);
  const net = await g.eval(`(function () { var s = BSU.state, H = BSU.hydro, n = H.networkAt(s, ${I(...COVE.low)}); var st = H.canalStats ? H.canalStats(s, ${I(...COVE.low)}) : null; return { tiles: n ? n.tiles.length : 0, toWater: !!(n && n.drainsToWater), drainsTo: H.drainsTo(s, ${I(...COVE.low)}), stats: st, tool: s.ui.tool ? s.ui.tool.id : null, canalTiles: Array.from(s.tiles.flags).reduce(function (a, f) { return a + ((f & BSU.FLAG.CANAL) ? 1 : 0); }, 0) }; })()`);
  console.log(`  released: ${net.canalTiles} canal tiles on the map · the low spot's network: ${net.tiles} tiles · reaches open water: ${net.toWater ? 'YES' : 'NO'} · drainsTo "${net.drainsTo}"${net.stats ? ' · ' + J(net.stats) : ''}`);
  must(net.toWater, '(canal) the canal released two tiles short did not connect itself to the bayou');
  must(/drain/i.test(lab.l1 + ' ' + lab.l2), '(canal) the drag label does not say what the run will drain: ' + J(lab));
  must(net.tool === 'canal', '(canal) the run tool was dropped');
  await unarm(); await g.waitBake({ timeoutMs: 60000 }); await shot('canal-3-dug-z2');
  // 3. the same rain again, now with the canal
  let peak1 = { sum: 0 }, flowSeen = 0;
  await g.eval(`(BSU.weather.queueCell(BSU.state, { cx: ${COVE.low[0]}, cy: ${COVE.low[1]}, inches: 3, scripted: true }), true)`);
  let shotDone = false;
  await g.run(tpd, { slice: 20, frameMs: 15, each: async (k) => {
    const w = await g.eval(`window.__wx.water(${J(cove)})`); if (w.sum > peak1.sum) peak1 = w;
    const fl = await g.eval(`(BSU.hydro.canalStats ? BSU.hydro.canalStats(BSU.state, ${I(...COVE.low)}) : null)`); if (fl && fl.flowing) flowSeen++;
    if (!shotDone && (await g.eval(`!!BSU.state.weather.event`)) && k > 6) { shotDone = true; await sleep(200); await shot('canal-4-raining-z2'); const c = await inspect(81, 48); console.log('  card while it rains: ' + J(c)); await shot('canal-5-card-raining'); await unarm(); }
    return false; } });
  const day1c = await g.eval(`window.__wx.water(${J(cove)})`);
  console.log(`  with the canal: the same rain → peak ${peak1.sum} tile-ft on ${peak1.wet}/${peak1.n} cove tiles (deepest ${peak1.max} ft); a day later ${day1c.sum} tile-ft on ${day1c.wet} tiles · samples with water moving in the channel: ${flowSeen}`);
  must(peak1.sum < peak0.sum * 0.35, `(canal) the canal did not cut the cove's standing water to under 35 % of the control (${peak1.sum} against ${peak0.sum})`);
  await g.waitBake({ timeoutMs: 60000 }); await shot('canal-6-after-rain-z2');
  const card = await inspect(81, 48); console.log('  card after the rain: ' + J(card)); await shot('canal-7-card');
  must(card && /Canal/.test(card.title) && card.rows.some((r) => /outlet|Drain/i.test(r) && /\d/.test(r)), '(canal) the canal card states no numbers: ' + J(card));
  await unarm(); await view(1, ...COVE.centre); await shot('canal-8-z1');
  await g.days(2); await view(2, ...COVE.centre); const dry = await g.eval(`(function () { var c = BSU.hydro.canalStats(BSU.state, ${I(...COVE.low)}); return c ? { depth: Math.round(c.depth * 100) / 100, yesterday: Math.round(c.movedYesterday * 10) / 10 } : null; })()`);
  console.log('  two days on: ' + J(dry) + ' · cove ' + J(await g.eval(`window.__wx.water(${J(cove)})`))); await shot('canal-9-two-days-on-z2');
  must(!dry || dry.depth < 0.1, '(canal) water still stands in the channel two days after the rain: ' + J(dry));
  return { peak0, peak1 };
}

// ---- nooutlet: a canal where no water is in reach ----------------------------------------------------------------------------------------
async function caseNoOutlet() {
  console.log('\n(nooutlet) a canal dragged on dry ground far from any water');
  await fresh();
  const site = await g.eval(`(function () {   // a straight 5-tile row of free dry ground with no water or canal within 9 tiles, nearest the founders' plot
    var s = BSU.state, t = s.tiles, W = BSU.MAP.W, H = BSU.MAP.H, f = s.plot.founders, m = BSU.land.mask(s), best = null, bd = 1e9;
    var wet = function (i) { return (t.flags[i] & (BSU.FLAG.BAYOU | BSU.FLAG.OPEN_WATER | BSU.FLAG.CANAL)) !== 0; };
    for (var y = 10; y < H - 10; y++) for (var x = 10; x < W - 14; x++) {
      var ok = true; for (var k = 0; k < 5 && ok; k++) { var i = y * W + x + k; if ((m && m[i] !== 1) || t.owner[i] >= 0 || t.surface[i] || wet(i) || t.type[i] === BSU.T.MARSH) ok = false; }
      if (!ok) continue;
      for (var dy = -9; dy <= 9 && ok; dy++) for (var dx = -9; dx <= 13; dx++) if (wet((y + dy) * W + x + dx)) { ok = false; break; }
      if (!ok) continue; var d = Math.abs(x - f.tx) + Math.abs(y - f.ty); if (d < bd) { bd = d; best = [x, y]; }
    }
    return best; })()`);
  if (!site) { console.log('  no dry row far from water on this map: skipped'); return; }
  await g.eval(`window.__wx.clearVeg([${site[0] - 6}, ${site[1] - 5}, ${site[0] + 10}, ${site[1] + 5}])`);
  await view(2, site[0] + 2, site[1]);
  const lab = await drag('canal', site, [site[0] + 4, site[1]], 'nooutlet-1-drag');
  console.log(`  site ${site} · mid-drag label: ${J(lab.l1)} / ${J(lab.l2)}`);
  must(/No outlet: this canal drains nowhere/.test(lab.l1 + ' ' + lab.l2), '(nooutlet) the ghost does not say "No outlet: this canal drains nowhere": ' + J(lab));
  const card = await inspect(site[0] + 1, site[1]); console.log('  card: ' + J(card)); await shot('nooutlet-2-card');
  must(card && card.rows.some((r) => /No outlet: this canal drains nowhere/.test(r)), '(nooutlet) the card does not say "No outlet: this canal drains nowhere"');
  await unarm();
}

// ---- look: how levees and floodwalls are drawn -------------------------------------------------------------------------------------------
async function caseLook() {
  console.log('\n(look) levee and floodwall rendering');
  await fresh();
  // the flattest free 13 × 9 block of dry ground in the charter (the shapes), and the steepest 8-tile row (the slope run)
  const site = await g.eval(`(function () {
    var s = BSU.state, t = s.tiles, W = BSU.MAP.W, H = BSU.MAP.H, m = BSU.land.mask(s), best = null, bs = 1e9, f = s.plot.founders;
    var free = function (i) { return (!m || m[i] === 1) && t.owner[i] < 0 && !t.surface[i] && !(t.flags[i] & (BSU.FLAG.BAYOU | BSU.FLAG.OPEN_WATER | BSU.FLAG.CANAL | BSU.FLAG.MOUND)) && t.type[i] !== BSU.T.MARSH; };
    for (var y = 4; y < H - 14; y++) for (var x = 4; x < W - 18; x++) {
      var lo = 99, hi = -99, ok = true;
      for (var dy = 0; dy < 9 && ok; dy++) for (var dx = 0; dx < 13; dx++) { var i = (y + dy) * W + x + dx; if (!free(i)) { ok = false; break; } var e = t.elev[i]; if (e < lo) lo = e; if (e > hi) hi = e; }
      if (!ok) continue; var sc = (hi - lo) * 10 + (Math.abs(x - f.tx) + Math.abs(y - f.ty)) * 0.05; if (sc < bs) { bs = sc; best = { x: x, y: y, lo: lo, hi: hi }; }
    }
    var slope = null, sd = 0;
    for (var y2 = 4; y2 < H - 4; y2++) for (var x2 = 4; x2 < W - 12; x2++) { var ok2 = true; for (var k = 0; k < 8; k++) if (!free(y2 * W + x2 + k)) { ok2 = false; break; } if (!ok2) continue; var d = Math.abs(t.elev[y2 * W + x2 + 7] - t.elev[y2 * W + x2]); if (d > sd && d < 5) { sd = d; slope = { x: x2, y: y2, d: d }; } }
    return { flat: best, slope: slope }; })()`);
  if (!site.flat) { console.log('  no flat block: skipped'); return; }
  const fx = site.flat.x, fy = site.flat.y;
  console.log(`  flat block at (${fx}, ${fy}) ${site.flat.lo.toFixed(1)}–${site.flat.hi.toFixed(1)} ft · slope run at (${site.slope.x}, ${site.slope.y}), ${site.slope.d.toFixed(1)} ft over 8 tiles`);
  await g.eval(`window.__wx.clearVeg([${fx - 3}, ${fy - 3}, ${fx + 16}, ${fy + 12}])`);
  await view(2, fx + 6, fy + 4);
  // real drags: a ring (two L drags), a T (two drags), a lone corner; then a floodwall run that meets the levee
  const labRing = await drag('levee', [fx, fy], [fx + 4, fy], null, { hold: false });            // the ring, side by side (a drag is one L: four straight sides)
  await drag('levee', [fx + 4, fy], [fx + 4, fy + 3], null, { hold: false });
  await drag('levee', [fx + 4, fy + 3], [fx, fy + 3], null, { hold: false });
  const labClose = await drag('levee', [fx, fy + 3], [fx, fy], 'look-1-ring-closing-drag');
  console.log(`  ring, first side: ${J(labRing.l1)} / ${J(labRing.l2)}`);
  console.log(`  ring, closing side: ${J(labClose.l1)} / ${J(labClose.l2)}`);
  await drag('levee', [fx + 7, fy], [fx + 12, fy], null, { hold: false });                          // a straight run
  await drag('levee', [fx + 9, fy], [fx + 9, fy + 3], null, { hold: false });                       // its T
  await drag('levee', [fx + 7, fy + 5], [fx + 9, fy + 7], null, { hold: false });                   // a corner
  await drag('floodwall', [fx + 12, fy + 1], [fx + 12, fy + 5], null, { hold: false });             // a floodwall down from the levee's end
  await drag('floodwall', [fx + 10, fy + 7], [fx + 12, fy + 7], null, { hold: false });             // a floodwall on from the corner's end
  await drag('levee', [fx, fy + 6], [fx + 4, fy + 6], null, { hold: false });                       // a run with free ends
  const laid = await g.eval(`(function () { var t = BSU.state.tiles, n6 = 0, n12 = 0; for (var i = 0; i < t.crest.length; i++) { if (t.crest[i] === 6) n6++; else if (t.crest[i] === 12) n12++; } return { levee: n6, floodwall: n12 }; })()`);
  console.log(`  laid ${laid.levee} levee and ${laid.floodwall} floodwall tiles`);
  await unarm(); await g.waitBake({ timeoutMs: 60000 }); await shot('look-2-shapes-z2');
  await view(1, fx + 6, fy + 4); await shot('look-3-shapes-z1');
  const card = await inspect(fx + 2, fy); console.log('  ring card: ' + J(card)); await shot('look-4-ring-card');
  const card2 = await inspect(fx + 2, fy + 6); console.log('  free run card: ' + J(card2)); await shot('look-5-line-card');
  must(card && card.rows.some((r) => /Holds back|Ring closed/i.test(r)), '(look) the closed ring\'s card does not say what it holds back: ' + J(card));
  must(card2 && card2.rows.some((r) => /open|gap|round/i.test(r)), '(look) the open run\'s card does not say what is missing: ' + J(card2));
  await unarm();
  // across a slope, and ending at the water
  const sx = site.slope.x, sy = site.slope.y;
  await g.eval(`window.__wx.clearVeg([${sx - 4}, ${sy - 4}, ${sx + 12}, ${sy + 4}])`);
  await view(2, sx + 4, sy);
  await drag('levee', [sx, sy], [sx + 7, sy], null, { hold: false });
  await unarm(); await g.waitBake({ timeoutMs: 60000 }); await shot('look-6-slope-z2');
  await view(1, sx + 4, sy); await shot('look-7-slope-z1');
  // along the bayou bank by the cove mouth (marsh, a bank, the water beside it) with a building behind it
  await g.eval(`window.__wx.clearVeg([70, 44, 92, 60])`);
  await g.place('dorm', 81, 52);
  await view(2, 81, 52);
  await drag('levee', [80, 51], [80, 55], null, { hold: false });
  await drag('levee', [80, 55], [84, 55], null, { hold: false });
  await unarm(); await g.waitBake({ timeoutMs: 60000 }); await shot('look-8-bank-building-z2');
  await view(1, 81, 52); await shot('look-9-bank-building-z1');
}

// ---- ring: a levee ring around a Dorm on low ground, through a Cat 2 surge ------------------------------------------------------------------
// four campuses, the same storm: no levee · the ring · the ring with a canal dragged from inside toward the bayou (its outlet tie digs on under the
// wall: a floodgate) · the ring with one tile of its bayou side left out
const RING = { box: [80, 51, 85, 55], dorm: [81, 52], out: [79, 53], centre: [82, 53], clear: [68, 42, 94, 62], gap: [80, 53], canal: [[84, 54], [82, 54]], gate: [80, 54] };
const ringInside = () => { const t = []; for (let y = RING.box[1] + 1; y < RING.box[3]; y++) for (let x = RING.box[0] + 1; x < RING.box[2]; x++) t.push(I(x, y)); return t; };
async function ringCampus(mode) {
  await fresh(); await g.eval(`window.__wx.clearVeg(${J(RING.clear)})`);
  const pl = await g.eval(`(function () { var r = BSU.buildings.place(BSU.state, 'dorm', ${RING.dorm[0]}, ${RING.dorm[1]}, { ignoreCash: true, instant: true }); return { ok: !!r.ok, reason: r.reason || '' }; })()`);
  if (!pl.ok) throw new Error('ring: the Dorm did not place: ' + pl.reason);
  await view(2, ...RING.centre);
  const labs = [];
  if (mode !== 'none') {
    const [x0, y0, x1, y1] = RING.box;
    labs.push(await drag('levee', [x0, y0], [x1, y0], null, { hold: false }));                       // four straight sides (a drag is one L)
    labs.push(await drag('levee', [x1, y0], [x1, y1], null, { hold: false }));
    labs.push(await drag('levee', [x1, y1], [x0, y1], null, { hold: false }));
    if (mode === 'open') { labs.push(await drag('levee', [x0, y1], [x0, RING.gap[1] + 1], null, { hold: false })); labs.push(await drag('levee', [x0, RING.gap[1] - 1], [x0, y0], 'ring-open-drag')); }   // the bayou side, one tile left out
    else labs.push(await drag('levee', [x0, y1], [x0, y0], 'ring-1-closing-drag'));
    if (mode === 'gate') labs.push(await drag('canal', RING.canal[0], RING.canal[1], 'ring-gate-canal-drag'));   // a canal inside the ring: its end digs on under the wall to the bayou
    await unarm();
  }
  return labs;
}
async function surge(label) {   // a Cat 2 (5 ft) through the real landfall set piece: the same storm for every campus, coming ashore due south of the ring
  const inside = ringInside();
  await view(2, ...RING.centre);
  await g.eval(`(function () { var s = BSU.state; BSU.weather.spawnStorm(s, { cat: 2, forecastCat: 2, compressed: true, landfallTick: s.tick + BSU.params.storm.coneDays * BSU.params.time.ticksPerDay, point: BSU.idx(${RING.box[0]}, BSU.MAP.H - 1) }); return true; })()`);
  let mxIn = 0, mxOut = 0, peak = 0, shotAt = false, atPeak = null;
  await g.run(12000, { slice: 25, frameMs: 8, each: async () => {
    const r = await g.eval(`(function () { var s = BSU.state, t = s.tiles, sg = s.hydro.surge; try { BSU.ui.closeCard(); BSU.ui.dismissNotifs(); } catch (e) {} var w = window.__wx.water(${J(inside)}); return { i: w.max, sum: w.sum, o: t.depth[${I(...RING.out)}], st: sg ? sg.stage : 0, t: s.setPiece ? s.setPiece.tick : -1, cur: !!s.storms.current, redrawn: 0 }; })()`);
    mxIn = Math.max(mxIn, r.i); mxOut = Math.max(mxOut, r.o); peak = Math.max(peak, r.st);
    if (!shotAt && r.st >= 4.9 && r.o >= 5.5) { shotAt = true; atPeak = r; await g.eval(`(BSU.ui.setHudMode('hidden'), true)`); await sleep(250); await shot(`ring-${label}-surge-peak-z2`); await g.setZoom(1); await g.panToTile(...RING.centre); await sleep(300); await g.settleCamera(); await sleep(300); await shot(`ring-${label}-surge-peak-z1`); await g.setZoom(2); await g.panToTile(...RING.centre); await sleep(200); }
    return shotAt && !r.cur; } });
  await g.eval(`(function () { try { BSU.ui.closeCard(); BSU.ui.dismissNotifs(); BSU.weather.closeReport(BSU.state); } catch (e) {} BSU.ui.setHudMode('hidden'); return true; })()`);
  const tpd = await g.eval(`BSU.params.time.ticksPerDay`);
  await g.run(tpd, { slice: 40, frameMs: 10 });
  const after = await g.eval(`window.__wx.water(${J(inside)})`);
  await g.waitBake({ timeoutMs: 60000 }); await shot(`ring-${label}-day-after-z2`);
  return { in: Math.round(mxIn * 100) / 100, out: Math.round(mxOut * 100) / 100, peak: Math.round(peak * 10) / 10, atPeak: atPeak, after: after };
}
async function caseRing() {
  console.log('\n(ring) a levee ring around a Dorm on 3.1–3.9 ft ground beside the bayou, through a Cat 2 (5 ft surge, about 0.8 ft of rain)');
  const res = {};
  for (const mode of ['none', 'ring', 'gate', 'open']) {
    const labs = await ringCampus(mode);
    if (labs.length) console.log(`  [${mode}] drag labels: ` + labs.map((l) => J(l.l1) + ' / ' + J(l.l2)).join('  ·  '));
    const info = await g.eval(`(function () { var s = BSU.state, B = BSU.buildings, n = 0, gates = 0, t = s.tiles; for (var i = 0; i < t.crest.length; i++) { if (t.crest[i] > 0) n++; if (t.flags[i] & BSU.FLAG.FLOODGATE) gates++; } var st = B.leveeStatus ? B.leveeStatus(s, ${I(RING.box[0], RING.box[1])}) : null; return { levee: n, gates: gates, status: st ? { closed: st.closed, protects: st.protects, gaps: st.gaps.length, text: st.text, missing: st.missing, rain: st.rain } : null }; })()`);
    console.log(`  [${mode}] ${info.levee} levee tiles, ${info.gates} floodgate(s)${info.status ? ' · status ' + J(info.status) : ''}`);
    res[mode + 'Info'] = info; res[mode + 'Labs'] = labs;
    if (mode !== 'none') { await g.waitBake({ timeoutMs: 60000 }); await shot(`ring-${mode}-0-built-z2`); const c = await inspect(RING.box[0] + 2, RING.box[1]); console.log(`  [${mode}] card: ` + J(c)); await shot(`ring-${mode}-0-card`); await unarm(); res[mode + 'Card'] = c; }
    const sg = await surge(mode);
    console.log(`  [${mode}] surge peak ${sg.peak} ft: deepest inside ${sg.in} ft (at the peak ${sg.atPeak ? sg.atPeak.i.toFixed(2) : '?'} ft) · outside the wall ${sg.out} ft · a day after the storm ${sg.after.sum} tile-ft standing inside (deepest ${sg.after.max} ft)`);
    res[mode] = sg;
  }
  if (res.ring && res.none && res.gate && res.open) {
    must(res.none.in > 1.2, `(ring) the control did not flood (${res.none.in} ft): the storm missed the site`);
    must(res.ring.in < res.none.in - 0.3, `(ring) the ring's inside was not clearly shallower than the control (${res.ring.in} against ${res.none.in})`);
    must(res.gate.atPeak && res.gate.atPeak.i < 0.3 && res.gate.out > 5 && res.gate.after.max < 0.1, `(ring) with a floodgate the inside was not dry at the peak and after (${J(res.gate.atPeak)} · after ${res.gate.after.max})`);
    must(res.open.in > res.none.in - 0.3, `(ring) the open ring kept the surge out (${res.open.in})`);
    must(res.ringLabs.some((l) => /^Closes the ring: holds a 5 ft surge off \d+ tiles/.test(l.l2)), '(ring) the closing drag does not say it closes the ring: ' + J(res.ringLabs.map((l) => l.l2)));
    must(res.ringCard && res.ringCard.rows.some((r) => /Ring closed: holds a 5 ft surge off \d+ tiles/.test(r)) && res.ringCard.rows.some((r) => /Rain inside has no way out/.test(r)), '(ring) the closed ring\'s card: ' + J(res.ringCard));
    must(res.gateInfo.gates === 1 && res.gateCard && res.gateCard.rows.some((r) => /Rain inside drains through 1 floodgate/.test(r)), '(ring) the canal dragged inside the ring did not become its floodgate: ' + J(res.gateInfo) + ' ' + J(res.gateCard));
    must(res.openLabs.some((l) => /Ring open: 1 gap/.test(l.l2)), '(ring) the open ring\'s drag does not say it is open: ' + J(res.openLabs.map((l) => l.l2)));
    must(res.openCard && res.openCard.rows.some((r) => /Ring open: 1 gap/.test(r)) && res.openCard.buttons.some((b) => /Show me the gap/.test(b)), '(ring) the open ring\'s card has no "Ring open: 1 gap" row with Show me: ' + J(res.openCard));
  }
}

// ---- bridge: a road across a reach of six water tiles ---------------------------------------------------------------------------------------
const WIDE = { line: row(56, 69, 80), expect: 'dmmwwwwwwmmd', from: [80, 56], to: [69, 56], centre: [75, 56], clear: [60, 48, 90, 64] };
async function caseBridge() {
  console.log('\n(bridge) a road across a reach of six water tiles (row 56: dry · 2 marsh · 6 water · 2 marsh · dry)');
  await fresh(); await g.eval(`window.__wx.clearVeg(${J(WIDE.clear)})`);
  const seen = await g.eval(`${J(WIDE.line)}.map(window.__wx.cls).join('')`);
  if (seen !== WIDE.expect) throw new Error(`bridge site: the map changed (expected ${WIDE.expect}, found ${seen})`);
  const rb = await hasRow('road_bridge');
  // a Campus Road on each bank (the near one reaches the campus network through a gravel tie), ending one tile short of the drag
  const pre = await g.eval(`(function () { var s = BSU.state, a = BSU.buildings.placeRun(s, 'road', ${J(row(56, 81, 86))}, { ignoreCash: true }), b = BSU.buildings.placeRun(s, 'road', ${J(col(68, 53, 56).concat([I(67, 56)]))}, { ignoreCash: true, noTie: true }); return [a.placed, b.placed]; })()`);
  if (pre[0] !== 6 || pre[1] !== 5) throw new Error('bridge site: the bank roads did not lay (' + pre + ')');
  await view(2, ...WIDE.centre);
  const lab0 = await drag('road', WIDE.from, WIDE.to, 'bridge-1-campus-road-drag');
  console.log(`  Campus Road dragged across: ${J(lab0.l1)} / ${J(lab0.l2)}`);
  const laid0 = await g.eval(`${J(row(56, 71, 78))}.filter(function (i) { return BSU.state.tiles.surface[i] === BSU.SURF.ROAD; }).length`);
  console.log(`  Campus Road: ${laid0} of 6 water tiles carry a deck`);
  must(rb ? /Road Bridge/.test(lab0.l1 + ' ' + lab0.l2) : true, '(bridge) the Campus Road refusal does not name the Road Bridge: ' + J(lab0));
  if (rb) {
    await g.eval(`(BSU.buildings.undo(BSU.state), true)`);
    const card = await g.eval(`(function () { BSU.ui.openPalette(true); var t = BSU.data.tabs.find(function (t) { return t.rows.indexOf('road_bridge') >= 0; }); return t ? { tab: t.id, after: t.rows[t.rows.indexOf('road_bridge') - 1] } : null; })()`);
    console.log('  Build sheet: ' + J(card));
    await g.eval(`(BSU.ui.setHudMode('full'), true)`); await sleep(200);
    const picked = await g.pickTool('road_bridge'); await sleep(250);
    const onCard = await g.eval(`(function () { var e = document.querySelector('#palette-items [data-id="road_bridge"]'), r = document.querySelector('#palette-items [data-id="road"]'); return { card: !!e, text: e ? (e.innerText || e.textContent || '').replace(/\\s+/g, ' ').trim() : '', besideRoad: !!(e && r && r.nextElementSibling === e), icon: !!(e && e.querySelector('canvas, svg, img')), armed: BSU.state.ui.tool ? BSU.state.ui.tool.id : null }; })()`);
    console.log('  Build card: ' + J(onCard) + ' · picked by a click: ' + picked);
    await g.eval(`(BSU.ui.openPalette(true), true)`); await sleep(250); await shot('bridge-2-build-card');
    must(onCard.card && onCard.besideRoad && /Road Bridge/.test(onCard.text) && onCard.armed === 'road_bridge', '(bridge) no Road Bridge card beside Campus Road in the Build sheet: ' + J(onCard));
    await g.eval(`(BSU.ui.setHudMode('hidden'), true)`);
    must(card && card.tab === 'paths' && card.after === 'road', '(bridge) the Road Bridge is not beside Campus Road in the Build sheet: ' + J(card));
    const lab = await drag('road_bridge', WIDE.from, WIDE.to, 'bridge-3-road-bridge-drag');
    console.log(`  Road Bridge dragged across: ${J(lab.l1)} / ${J(lab.l2)} · run ${lab.run}`);
    const v = await g.eval(`(function () { var s = BSU.state, t = s.tiles, deck = ${J(row(56, 70, 79))}.filter(function (i) { return t.surface[i] === BSU.SURF.ROAD; }).length; var r = BSU.agents.routeSync(s, ${I(68, 53)}, ${I(85, 56)}, 'road'); return { deck: deck, route: r ? r.length : 0, onRoad: r ? r.every(function (i) { return t.surface[i] === BSU.SURF.ROAD; }) : false, tool: s.ui.tool ? s.ui.tool.id : null, conn: BSU.buildings.connectedMask(s)[${I(68, 53)}] }; })()`);
    console.log(`  Road Bridge: ${v.deck} of 10 deck tiles laid · a vehicle route from the far road to the near road: ${v.route ? v.route + ' tiles' + (v.onRoad ? ' (all on road)' : ' (leaves the road)') : 'NONE'} · far road on the campus network: ${v.conn ? 'YES' : 'NO'}`);
    must(v.deck === 10 && v.route > 0 && v.onRoad, '(bridge) the Road Bridge did not carry a vehicle route across: ' + J(v));
    must(v.tool === 'road_bridge', '(bridge) the run tool was dropped');
  }
  await unarm(); await g.waitBake({ timeoutMs: 60000 }); await shot('bridge-4-built-z2');
  await view(1, ...WIDE.centre); await shot('bridge-5-built-z1');
}

// ---- heights: a Pedestrian Bridge and a Boardwalk across four bank shapes ------------------------------------------------------------------
// each site is a real reach of the seed-42 bayou; `banks` re-shapes the tiles beside the water (scaffolding: every real reach has a marsh
// fringe at 0.5 ft): [west bank ft, east bank ft] or null to leave the marsh
const HSITES = [
  { id: 'level', what: 'level banks (both 1.5 ft over the water)', y: 48, x0: 73, x1: 79, banks: [1.5, 1.5] },
  { id: 'step', what: 'one bank 2 ft up (1.5 ft and 3.5 ft)', y: 48, x0: 73, x1: 79, banks: [1.5, 3.5] },
  { id: 'high', what: 'both banks high (4.5 ft)', y: 48, x0: 73, x1: 79, banks: [4.5, 4.5] },
  { id: 'marsh', what: 'the marsh fringe the map has (0.5 ft)', y: 48, x0: 73, x1: 79, banks: null },
];
async function caseHeights() {
  console.log('\n(heights) a Pedestrian Bridge (row 48) and a Boardwalk (row 49) across four bank shapes');
  for (const S of HSITES) {
    await fresh(); await g.eval(`window.__wx.clearVeg([64, 42, 88, 56])`);
    if (S.banks) await g.eval(`(function () {   // the land tiles within two of the water on rows 47–50 become dry ground at the wanted height
      var s = BSU.state, t = s.tiles, W = BSU.MAP.W, Tn = BSU.terrain, wet = function (i) { return (t.flags[i] & (BSU.FLAG.BAYOU | BSU.FLAG.OPEN_WATER)) !== 0; };
      for (var y = 46; y <= 51; y++) for (var x = 66; x <= 86; x++) { var i = y * W + x; if (wet(i)) continue; var near = 0; for (var d = 1; d <= 3; d++) { if (x - d >= 0 && wet(i - d)) near = 1; if (wet(i + d)) near = -1; } if (!near) continue;
        t.flags[i] &= ~(BSU.FLAG.WETLAND_ORIGINAL | BSU.FLAG.DRAINED); t.depth[i] = 0; Tn.setElev(s, i, near > 0 ? ${S.banks[1]} : ${S.banks[0]}); }
      BSU.hydro.reset(s, false); Tn.rewalk(s); BSU.render.dirtyAll(); return true; })()`);
    const lineP = await g.eval(`${J(row(48, 72, 80))}.map(window.__wx.cls).join('')`), lineB = await g.eval(`${J(row(49, 72, 80))}.map(window.__wx.cls).join('')`);
    await view(2, 76, 48);
    const wetX = (line) => { const a = line.indexOf('w'), b = line.lastIndexOf('w'); let l = a, r = b; while (l > 0 && line[l - 1] === 'm') l--; while (r < line.length - 1 && line[r + 1] === 'm') r++; return [72 + l - 1, 72 + r + 1]; };
    const [pa, pb] = wetX(lineP), [ba, bb] = wetX(lineB);
    const lp = await drag('bridge', [pb, 48], [pa, 48], null, { hold: false });
    const lb = await drag('boardwalk', [bb, 49], [ba, 49], null, { hold: false });
    await unarm(); await g.waitBake({ timeoutMs: 60000 });
    const v = await g.eval(`(function () { var s = BSU.state, t = s.tiles, W = BSU.MAP.W, n5 = 0, n3 = 0; for (var x = 70; x <= 82; x++) { if (t.surface[48 * W + x] === BSU.SURF.BRIDGE) n5++; if (t.surface[49 * W + x] === BSU.SURF.BOARDWALK) n3++; }
      var acc = function (v) { return v === 1 || v === 2 || v === 3 || v === 5; }, ends = function (y) { var a = -1, b = -1; for (var x = 68; x <= 84; x++) if (acc(t.surface[y * W + x])) { if (a < 0) a = x; b = x; } return [a, b]; };
      var eP = ends(48), eB = ends(49), rp = eP[0] >= 0 ? BSU.agents.routeSync(s, 48 * W + eP[0], 48 * W + eP[1], 'walk') : null, rb = eB[0] >= 0 ? BSU.agents.routeSync(s, 49 * W + eB[0], 49 * W + eB[1], 'walk') : null;
      var on = function (r) { return r ? r.every(function (i) { return acc(t.surface[i]); }) : false; };
      return { bridge: n5, boardwalk: n3, walkP: rp ? rp.length : 0, onP: on(rp), walkB: rb ? rb.length : 0, onB: on(rb), elev: [t.elev[48 * W + eP[0]], t.elev[48 * W + eP[1]]] }; })()`);
    console.log(`  [${S.id}] ${S.what}: rows ${lineP} / ${lineB} · bridge ${J(lp.l1)} · boardwalk ${J(lb.l1)}`);
    console.log(`           ${v.bridge} bridge + ${v.boardwalk} boardwalk tiles · end to end on foot: bridge ${v.walkP ? v.walkP + ' tiles' + (v.onP ? '' : ' (LEAVES the deck)') : 'NO ROUTE'}, boardwalk ${v.walkB ? v.walkB + ' tiles' + (v.onB ? '' : ' (LEAVES the deck)') : 'NO ROUTE'}`);
    must(v.bridge >= 3 && v.walkP > 0 && v.onP, `(heights ${S.id}) no walk across the Pedestrian Bridge`);
    must(v.boardwalk >= 3 && v.walkB > 0 && v.onB, `(heights ${S.id}) no walk across the Boardwalk`);
    await shot(`heights-${S.id}-z2`);
    await view(1, 76, 48); await shot(`heights-${S.id}-z1`);
  }
}

// ---- walkers: the bridge is the only way to class ---------------------------------------------------------------------------------------------
async function caseWalkers() {
  console.log('\n(walkers) a Dorm on the far bank: its students\' only way to class is a Pedestrian Bridge');
  await fresh(); await g.eval(`window.__wx.clearVeg([56, 40, 92, 58])`);
  // near bank (campus side): a Lecture Hall and a Dining Hall; far bank: two Dorms; the only link is the bridge on row 48
  const setup = await g.eval(`(function () {
    var s = BSU.state, B = BSU.buildings, W = BSU.MAP.W, out = {};
    var near = function (id, x0, x1, y0, y1) { for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) { var q = B.canPlace(s, id, x, y, { ignoreCash: true, noTie: true }); if (q.ok) { var r = B.place(s, id, x, y, { ignoreCash: true, instant: true, noTie: true }); if (r.ok) return [x, y]; } } return null; };
    out.dorm1 = near('dorm', 66, 71, 46, 51); out.dorm2 = near('dorm', 62, 71, 43, 53);
    out.hall = near('lecture_hall', 82, 88, 44, 47) || near('lecture_hall', 80, 90, 40, 56); out.dining = near('dining_hall', 82, 90, 50, 56) || near('dining_hall', 78, 92, 40, 58);
    return out; })()`);
  console.log('  placed ' + J(setup));
  await view(2, 76, 48);
  const lab = await drag('bridge', [79, 48], [73, 48], null, { hold: false });
  await unarm();
  // gravel from each building's door to the bridge ends (the game's own ties, through linkBuilding)
  const link = await g.eval(`(function () { var s = BSU.state, B = BSU.buildings, out = []; s.buildings.forEach(function (b) { if (!b || b.type === 'founders_hall') return; var q = B.linkQuote(s, b.id); if (q && q.ok) { var r = B.linkBuilding(s, b.id); out.push(b.type + ':' + (r && r.ok ? 'linked' : (r && r.reason))); } else out.push(b.type + ':' + (q ? q.reason || 'ok' : '?')); }); var conn = B.connectedMask(s); return { link: out, bridge: ${J(row(48, 74, 78))}.filter(function (i) { return s.tiles.surface[i] === BSU.SURF.BRIDGE; }).length }; })()`);
  console.log(`  bridge label ${J(lab.l1)} · ${link.bridge} deck tiles · links: ${link.link.join(', ')}`);
  await g.eval(`(BSU.weather.releaseSky(BSU.state), BSU.economy.addStudents(BSU.state, 500, 'qa'), BSU.agents.regenerate(BSU.state), true)`);   // the shots pin the sky to day, and a pinned sky stops the class cycle: released here, so the students commute
  await g.days(1);
  const deck = row(48, 74, 78);
  // every tick of two game days, in the page: who is on the deck, who changed banks, and in what state they walked it
  const res = await g.eval(`(function () {
    var s = BSU.state, W = BSU.MAP.W, tpd = BSU.params.time.ticksPerDay, deck = {}, side = {}, cross = {}, states = {}, peak = 0, sum = 0, n = 0, total = 0;
    ${J(deck)}.forEach(function (i) { if (s.tiles.surface[i] === BSU.SURF.BRIDGE) deck[i] = 1; });
    for (var k = 0; k < tpd * 2; k++) {
      BSU.headless.tick(1);
      var list = BSU.agents.list(s), on = 0;
      for (var q = 0; q < list.length; q++) { var a = list[q]; if (!a || a.state === 'GONE') continue; var tx = Math.floor(a.tx), ty = Math.floor(a.ty), i = ty * W + tx;
        if (deck[i] && !a.inside) { on++; states[a.state] = (states[a.state] || 0) + 1; }
        var sd = tx <= 73 ? 'w' : (tx >= 79 ? 'e' : ''); if (sd) { if (side[q] && side[q] !== sd) { cross[q] = (cross[q] || 0) + 1; total++; } side[q] = sd; } }
      if (on > peak) peak = on; sum += on; n++;
    }
    return { crossers: Object.keys(cross).length, crossings: total, peak: peak, mean: Math.round(sum / n * 100) / 100, ticks: n, agents: list.length, states: states };
  })()`);
  console.log(`  two game days, every tick (${res.ticks} ticks, ${res.agents} agents drawn for 620 students): ${res.crossers} different students crossed, ${res.crossings} crossings in all · on the deck at once: peak ${res.peak}, mean ${res.mean} · their state on the deck: ${J(res.states)}`);
  must(res.crossings >= 40, `(walkers) only ${res.crossings} crossings in two game days`);
  must(!res.states.WADE, `(walkers) students WADE on the deck (${res.states.WADE} agent-ticks)`);
  await g.run(600, { slice: 10, frameMs: 6, each: async () => (await g.eval(`(function () { var s = BSU.state, W = BSU.MAP.W, n = 0; BSU.agents.list(s).forEach(function (a) { if (a && !a.inside && a.state !== 'GONE' && s.tiles.surface[Math.floor(a.ty) * W + Math.floor(a.tx)] === BSU.SURF.BRIDGE) n++; }); return n; })()`)) >= 3 });
  await sleep(150); await shot('walkers-1-on-the-bridge-z2');
}

const CASES = { canal: caseCanal, nooutlet: caseNoOutlet, look: caseLook, ring: caseRing, bridge: caseBridge, heights: caseHeights, walkers: caseWalkers };
try {
  const mark = await g.mark();
  for (const id of args.only) { const fn = CASES[id]; if (!fn) throw new Error('unknown case ' + id + ' (known: ' + ALL.join(', ') + ')'); await fn(); }
  const errs = await g.errorsSince(mark);
  if (errs.length) { code = 1; console.log('ERRORS:'); for (const e of errs) console.log('  ' + e); } else console.log('\nno console errors, exceptions or BSU.errors');
  if (problems) code = 1;
  console.log(args.strict ? (problems ? problems + ' problem(s)' : 'ALL OK') : '(not --strict: measurements are printed, not asserted)');
} catch (e) { code = 2; console.error('scene failed:', e && e.stack || e); }
finally { await g.close(); killStrays(); }
process.exit(code);
