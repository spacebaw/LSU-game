#!/usr/bin/env node
// Crossings pass (Josh: "smoother snap-to connections for bridges or anything that goes over bodies of water with nearby paths or roads"):
// six real pointer drags on seed 42 at 96, each on a fresh game, with a mid-drag shot (ghost + label), after shots at zoom 2 and zoom 1,
// and a printed verdict: tiles laid, cost, is the far-shore path on the campus network (buildings.connectedMask), can an agent walk
// from it to campus (agents.routeSync), orphan stubs, trees left standing on the new surface.
//
//   (a) Pedestrian Bridge dragged bank to bank                         site A: row 48, marsh · 3 water · marsh, a path 1–2 tiles short of each bank
//   (b) Pedestrian Bridge dragged from the near path's end to the far path's end (not in line: the far path ends two rows south)
//   (c) Campus Road dragged across from beside the near path's end
//   (d) Boardwalk across a marsh-fringed reach                         site D: row 53, 2 marsh · 2 water · marsh
//   (e) Campus Road over a reach one tile too wide for a road bridge   site E: column 72, 2 marsh · 4 water · 2 marsh
//   (f) Campus Road dragged through trees (a surface clears its tile)  site F: row 34, four trees on the run
//
//   node tools/qa/crossings_scene.mjs [--index path] [--tag after] [--out dir] [--only a,b,c,d,e,f] [--strict]
//
// Run it on tools/qa/out/index-before.html (a copy of the previous build) with --tag before and on index.html for the pair
// cross-<tag>-<case>-drag.png / -z2.png / -z1.png. --strict exits 1 unless (a)–(d) connect the far shore, (e) leaves no orphan stub and (f)
// leaves no tree on the road (the crossings pass's promises; the previous build fails them, which is the point of the "before" run).
// The sites are fixed tiles of the seed-42 map and are verified before use; plants are cleared off sites A, D and E (QA scaffolding: they
// hide the surfaces at zoom 2), never off site F. The Pedestrian Bridge is unlocked by g.unlockAll() (it needs 800 students in play).
import { openGame, parseArgs, DEFAULT_OUT, resolveIndex, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), {
  index: { type: 'str', def: '' }, tag: { type: 'str', def: 'after' }, out: { type: 'str', def: DEFAULT_OUT }, only: { type: 'list', def: ['a', 'b', 'c', 'd', 'e', 'f'] },
  strict: { type: 'bool', def: false }, width: { type: 'num', def: 1440 }, height: { type: 'num', def: 900 },
});
const W = 96, I = (x, y) => y * W + x, row = (y, x0, x1) => { const t = []; const st = x1 >= x0 ? 1 : -1; for (let x = x0; x !== x1 + st; x += st) t.push(I(x, y)); return t; }, col = (x, y0, y1) => { const t = []; const st = y1 >= y0 ? 1 : -1; for (let y = y0; y !== y1 + st; y += st) t.push(I(x, y)); return t; };
// the sites: `expect` is the terrain along `line` (d dry / wet ground, m marsh, w water, s a surface); `clear` the block cleared of plants;
// `near` / `far` the gravel laid before the drag (placeRun, no tie); `nearNet` a tile of the campus network; `farEnd` the far path's end
const SITES = {
  A: { line: row(48, 73, 80), expect: 'dmwwwmds', clear: [64, 44, 84, 53], near: [], far: [row(50, 69, 72)], nearNet: [80, 48], farEnd: [72, 50], centre: [76, 49] },
  D: { line: row(53, 75, 81), expect: 'dmmwwmd', clear: [66, 47, 87, 58], near: [col(83, 48, 52)], far: [row(54, 70, 73)], nearNet: [83, 52], farEnd: [73, 54], centre: [78, 53] },
  E: { line: col(72, 38, 47), expect: 'dmmwwwwmmd', clear: [64, 34, 84, 51], near: [row(38, 83, 74)], far: [row(49, 68, 70)], nearNet: [74, 38], farEnd: [70, 49], centre: [73, 43] },
  F: { line: row(34, 69, 84), expect: 'dddddddddddddddd', clear: null, near: [], far: [], nearNet: [85, 34], farEnd: null, centre: [77, 35] },
};
const CASES = {
  a: { site: 'A', tool: 'bridge', from: [78, 48], to: [74, 48], what: 'Pedestrian Bridge dragged bank to bank', connects: true },
  b: { site: 'A', tool: 'bridge', from: [80, 48], to: [72, 50], what: "Pedestrian Bridge dragged from the near path's end to the far path's end", connects: true },
  c: { site: 'A', tool: 'road', from: [79, 48], to: [73, 48], what: "Campus Road dragged across from beside the near path's end", connects: true },
  d: { site: 'D', tool: 'boardwalk', from: [81, 53], to: [75, 53], what: 'Boardwalk across a marsh-fringed reach', connects: true },
  e: { site: 'E', tool: 'road', from: [72, 38], to: [72, 47], what: 'Campus Road over a reach one tile too wide for a road bridge (4 water tiles)', connects: false },
  f: { site: 'F', tool: 'road', from: [84, 34], to: [69, 34], what: 'Campus Road dragged through trees', connects: false },
};
const index = resolveIndex(args.index);
killStrays();
const g = await openGame({ index, width: args.width, height: args.height, size: 96, seed: 42, outDir: args.out, noGuard: true });
let code = 0, problems = 0;
const bad = (m) => { problems++; console.log('  PROBLEM: ' + m); };
try {
  const mark = await g.mark();
  // in-page helpers: terrain class, the access-surface snapshot / diff, the verdict
  await g.eval(`(function () {
    var X = window.__cx = {};
    X.cls = function (i) { var s = BSU.state, t = s.tiles; if (t.flags[i] & (BSU.FLAG.BAYOU | BSU.FLAG.OPEN_WATER)) return 'w'; var ty = t.type[i]; if (ty === BSU.T.OPEN_WATER || ty === BSU.T.BAYOU || ty === BSU.T.POND) return 'w'; if (ty === BSU.T.MARSH && !(t.flags[i] & BSU.FLAG.DRAINED)) return 'm'; return t.surface[i] ? 's' : 'd'; };
    X.access = function (v) { return v === BSU.SURF.PATH || v === BSU.SURF.ROAD || v === BSU.SURF.BOARDWALK || v === BSU.SURF.BRIDGE; };
    X.snap = function () { X.before = Array.from(BSU.state.tiles.surface); X.cash0 = BSU.state.economy.cash; X.veg0 = BSU.state.veg.length; };
    X.ghost = null; if (!X.wrapped) { X.wrapped = true; var g0 = BSU.render.ghost; BSU.render.ghost = function (spec) { if (spec) X.ghost = spec; return g0.apply(BSU.render, arguments); }; }   // the last ghost spec the ui sent (the planned run, its red tiles)
    X.px = function (tx, ty) {   // a canvas point that picks tile (tx, ty): its centre, or the nearest point around it that does (a taller neighbour can cover the centre)
      var R = BSU.render, p = R.tileToScreen(tx, ty), z = BSU.state.ui.camera.zoom, hit = function (x, y) { var t = R.screenToTile(x, y); return !!t && Math.floor(t.tx) === tx && Math.floor(t.ty) === ty; };
      if (hit(p.x, p.y)) return { x: p.x, y: p.y, moved: 0 };
      for (var r = 1; r <= 8; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; var x = p.x + dx * 4 * z, y = p.y + dy * 2 * z; if (hit(x, y)) return { x: x, y: y, moved: r }; }
      return { x: p.x, y: p.y, moved: -1 };
    };
    X.nbr = function (i) { var W = BSU.MAP.W, H = BSU.MAP.H, x = i % W, y = (i / W) | 0, o = []; if (y > 0) o.push(i - W); if (x < W - 1) o.push(i + 1); if (y < H - 1) o.push(i + W); if (x > 0) o.push(i - 1); return o; };
    X.verdict = function (farEnd, nearNet) {
      var s = BSU.state, t = s.tiles, W = BSU.MAP.W, names = ['none', 'path', 'road', 'boardwalk', 'fence', 'bridge'], laid = [], by = {}, isNew = {};
      for (var i = 0; i < t.surface.length; i++) if (t.surface[i] !== X.before[i] && t.surface[i] !== 0) { laid.push(i); isNew[i] = 1; var n = names[t.surface[i]] || String(t.surface[i]); by[n] = (by[n] || 0) + 1; }
      var conn = BSU.buildings.connectedMask(s), seen = {}, orphans = [];
      for (var k = 0; k < laid.length; k++) {   // components of the new tiles; an orphan touches no access surface that was there before the drag
        var a = laid[k]; if (seen[a]) continue; var q = [a], comp = [], touches = false; seen[a] = 1;
        while (q.length) { var c = q.pop(); comp.push(c); var nb = X.nbr(c); for (var j = 0; j < nb.length; j++) { var m = nb[j]; if (isNew[m]) { if (!seen[m]) { seen[m] = 1; q.push(m); } } else if (X.access(X.before[m])) touches = true; } }
        if (!touches) orphans.push(comp.map(function (i) { return [i % W, (i / W) | 0]; }));
      }
      var trees = 0; for (var v = 0; v < s.veg.length; v++) { var e = s.veg[v]; if (e && isNew[e.ty * W + e.tx]) trees++; }
      var out = { laid: laid.length, by: by, cost: Math.round(X.cash0 - s.economy.cash), orphans: orphans, unconnectedNew: laid.filter(function (i) { return !conn[i]; }).length, treesOnSurface: trees, vegRemoved: X.veg0 - s.veg.length, tool: s.ui.tool ? s.ui.tool.id : null };
      if (farEnd != null) { out.farConnected = conn[farEnd] === 1; var r = BSU.agents.routeSync(s, farEnd, nearNet, 'walk'); out.walk = r ? r.length : 0; out.walkOnSurface = r ? r.every(function (i) { return X.access(t.surface[i]); }) : false; }
      return out;
    };
    return true; })()`);
  for (const id of args.only) {
    const c = CASES[id]; if (!c) throw new Error('unknown case ' + id);
    const S = SITES[c.site];
    console.log(`\n(${id}) ${c.what}`);
    await g.newGame(); await g.cash(1e7); await g.unlockAll();
    await g.eval(`(BSU.ui.setHudMode('hidden'), true)`);
    await g.tick(45);   // into daylight
    const seen = await g.eval(`${JSON.stringify(S.line)}.map(window.__cx.cls).join('')`);
    if (seen !== S.expect) throw new Error(`site ${c.site}: the map changed (expected ${S.expect}, found ${seen})`);
    if (S.clear) await g.eval(`(function () { var s = BSU.state, b = ${JSON.stringify(S.clear)}; for (var k = s.veg.length - 1; k >= 0; k--) { var v = s.veg[k]; if (v && v.tx >= b[0] && v.tx <= b[2] && v.ty >= b[1] && v.ty <= b[3]) BSU.terrain.removeVeg(s, v.tx, v.ty); } BSU.render.dirtyAll(); return true; })()`);
    const pre = await g.eval(`(function () { var s = BSU.state, out = [], runs = ${JSON.stringify(S.near.concat(S.far))}; for (var k = 0; k < runs.length; k++) { var r = BSU.buildings.placeRun(s, 'path', runs[k], { ignoreCash: true, noTie: true }); out.push(r.placed + '/' + runs[k].length); } var conn = BSU.buildings.connectedMask(s); return { laid: out, near: conn[${I(...S.nearNet)}], far: ${S.farEnd ? `conn[${I(...S.farEnd)}]` : 'null'} }; })()`);
    if (pre.near !== 1) throw new Error(`site ${c.site}: the near path (${S.nearNet}) is not on the campus network`);
    if (S.farEnd && pre.far !== 0) throw new Error(`site ${c.site}: the far path is already connected before the drag`);
    console.log(`  setup: gravel laid ${JSON.stringify(pre.laid)} · near path on the network · far path ${S.farEnd ? 'not connected' : 'n/a'}`);
    await g.setZoom(2); await g.panToTile(S.centre[0], S.centre[1]); await sleep(120); await g.settleCamera(); await g.waitBake({ timeoutMs: 60000 });
    await g.eval(`(BSU.ui.selectTool(BSU.state, ${JSON.stringify(c.tool)}), window.__cx.snap(), true)`);
    // the drag: real PointerEvents on the world canvas (the listeners the mouse reaches), pressed on the first tile, glided to the last, held for the shot
    const pa = await g.eval(`window.__cx.px(${c.from[0]}, ${c.from[1]})`), pb = await g.eval(`window.__cx.px(${c.to[0]}, ${c.to[1]})`);
    if (pa.moved < 0 || pb.moved < 0) throw new Error(`(${id}) no screen point picks the drag's end tiles`);
    const ev = (type, p, buttons) => g.eval(`(function () { var c = BSU.ui.el.world, r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { clientX: r.left + ${p.x}, clientY: r.top + ${p.y}, button: 0, buttons: ${buttons}, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })); return true; })()`);
    await ev('pointermove', pa, 0); await ev('pointerdown', pa, 1);
    const steps = 14; for (let k = 1; k <= steps; k++) { await ev('pointermove', { x: pa.x + (pb.x - pa.x) * k / steps, y: pa.y + (pb.y - pa.y) * k / steps }, 1); await sleep(25); }
    await sleep(300);
    const ghost = await g.eval(`(function () { var e = BSU.ui.el['ghost-l1'], f = BSU.ui.el['ghost-l2'], tp = BSU.render.tiePreviewSpec && BSU.render.tiePreviewSpec(); var ties = tp ? (Array.isArray(tp.ties) ? tp.ties.map(function (q) { return q.tiles.length; }) : [tp.tiles.length]) : []; var gs = window.__cx.ghost || {}, W = BSU.MAP.W, xy = function (i) { return (i % W) + ',' + ((i / W) | 0); }; return { l1: e ? e.textContent : '', l2: f ? f.textContent : '', ties: ties, state: BSU.ui.state, run: (gs.line || gs.tiles || []).map(xy).join(' '), red: (gs.skipTiles || []).map(xy).join(' '), color: gs.color || '' }; })()`);
    console.log(`  planned run: ${ghost.run}${ghost.red ? ' · red: ' + ghost.red : ''} (${ghost.color})`);
    console.log(`  mid-drag label: ${JSON.stringify(ghost.l1)} / ${JSON.stringify(ghost.l2)} · tie previews (tiles): ${JSON.stringify(ghost.ties)}`);
    console.log('  shot', await g.shot(`cross-${args.tag}-${id}-drag`));
    await ev('pointerup', pb, 0);
    await sleep(350); await g.waitBake({ timeoutMs: 60000 });
    const v = await g.eval(`window.__cx.verdict(${S.farEnd ? I(...S.farEnd) : 'null'}, ${I(...S.nearNet)})`);
    await g.eval(`(BSU.ui.selectTool(BSU.state, null), true)`); await g.clearUi(); await g.eval(`(BSU.ui.setHudMode('hidden'), true)`);
    await sleep(250);
    console.log('  shot', await g.shot(`cross-${args.tag}-${id}-z2`));
    await g.setZoom(1); await g.panToTile(S.centre[0], S.centre[1]); await sleep(120); await g.settleCamera(); await g.waitBake({ timeoutMs: 60000 }); await sleep(200);
    console.log('  shot', await g.shot(`cross-${args.tag}-${id}-z1`));
    const kinds = Object.keys(v.by).map((k) => v.by[k] + ' ' + k).join(', ') || 'nothing';
    console.log(`  VERDICT: laid ${v.laid} tiles (${kinds}) · cost $${v.cost.toLocaleString('en-US')} · tool after: ${v.tool}`);
    if (S.farEnd) console.log(`           far-shore path on the campus network: ${v.farConnected ? 'YES' : 'NO'} · agent route far path → campus: ${v.walk ? v.walk + ' tiles' + (v.walkOnSurface ? ' (all on surfaces)' : ' (leaves the surfaces)') : 'NONE'}`);
    console.log(`           orphan stubs: ${v.orphans.length ? v.orphans.map((o) => JSON.stringify(o)).join(' ') : 'none'} · new tiles off the network: ${v.unconnectedNew} · plants still standing on new surface: ${v.treesOnSurface} (removed ${v.vegRemoved})`);
    if (args.strict) {
      if (c.connects && !(v.farConnected && v.walk > 0 && v.walkOnSurface)) bad(`(${id}) one drag did not connect the far-shore path`);
      if (v.orphans.length) bad(`(${id}) orphan stubs ${JSON.stringify(v.orphans)}`);
      if (v.treesOnSurface) bad(`(${id}) ${v.treesOnSurface} plants still standing on the new surface`);
      if (v.tool !== c.tool) bad(`(${id}) the run tool was dropped (${v.tool})`);
    }
  }
  const errs = await g.errorsSince(mark);
  if (errs.length) { code = 1; console.log('ERRORS:'); for (const e of errs) console.log('  ' + e); } else console.log('\nno console errors, exceptions or BSU.errors');
  if (problems) code = 1;
  console.log(args.strict ? (problems ? problems + ' problem(s)' : 'ALL OK') : '(not --strict: verdicts are printed, not asserted)');
} catch (e) { code = 2; console.error('scene failed:', e && e.stack || e); }
finally { await g.close(); killStrays(); }
process.exit(code);
