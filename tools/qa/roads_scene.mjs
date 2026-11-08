#!/usr/bin/env node
// Roads and paths pass: one scripted scene on seed 42 at 96 for before / after screenshots — a road L-turn, a road 4-way cross, a road T,
// a path T into a road, a path crossing a road, a 1-step staircase of each kind, a road over a 3-tile bayou with marsh banks (refused as a
// whole since the pass; a lone bridge before it) and, when the map has one, a 1-tile bayou with a 1-tile marsh bank (a bank deck since the
// pass). Shot at zoom 1 (the whole scene) and zoom 2 (the junction cluster, the staircases, the bayou), plus a mid-drag ghost over the bayou.
//
//   node tools/qa/roads_scene.mjs [--index path] [--tag after] [--out dir] [--dpr 1] [--pen]
//
// --pen also shoots the junction cluster with sprites.isHD patched false (the pen stroke path of strokeLayers; the ground may look odd).
// A student walking the straightened road diagonal is checked by test/unit/roads.test.mjs through render.agentPose (no buildings can be
// placed beside the scene while the tutorial's tie window is open, so no scripted crowd here).
import { openGame, parseArgs, DEFAULT_OUT, resolveIndex, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), {
  index: { type: 'str', def: '' }, tag: { type: 'str', def: 'after' }, out: { type: 'str', def: DEFAULT_OUT }, dpr: { type: 'num', def: 1 },
  pen: { type: 'bool', def: false }, width: { type: 'num', def: 1440 }, height: { type: 'num', def: 900 },
});
const index = resolveIndex(args.index);
const g = await openGame({ index, width: args.width, height: args.height, dpr: args.dpr, size: 96, seed: 42, outDir: args.out, noGuard: true });
let code = 0;
try {
  const mark = await g.mark();
  await g.cash(1e10); await g.unlockAll();
  // charter the whole map (QA scaffolding, as buildCampus does), then find the flattest 22 × 21 patch of dry / high / wet ground (no surface, no owner)
  const sections = await g.eval(`(function () { var n = 0; for (var k = 0; k < 40; k++) { var s = BSU.land.sections(BSU.state).filter(function (x) { return x.forSale && !x.owned; }); if (!s.length) break; BSU.headless.charter(s[0].id, true); n++; } return n; })()`);
  console.log(`chartered ${sections} sections`);
  const block = await g.eval(`(function () {
    var s = BSU.state, W = BSU.MAP.W, H = BSU.MAP.H, t = s.tiles, f = s.plot.founders, L = BSU.land, BW = 22, BH = 21, best = null;
    for (var oy = 1; oy + BH < H - 1; oy++) for (var ox = 1; ox + BW < W - 1; ox++) {
      var lo = Infinity, hi = -Infinity, okb = true;
      for (var y = oy; y < oy + BH && okb; y++) for (var x = ox; x < ox + BW; x++) { var i = y * W + x; var ty = t.type[i]; if ((ty !== BSU.T.DRY && ty !== BSU.T.HIGH && ty !== BSU.T.WET) || t.owner[i] !== -1 || t.surface[i] !== 0 || (t.flags[i] & (BSU.FLAG.MOUND | BSU.FLAG.PRESERVE | BSU.FLAG.CANAL | BSU.FLAG.BAYOU | BSU.FLAG.OPEN_WATER)) || (L && !L.isChartered(s, x, y))) { okb = false; break; } var e = t.elev[i]; if (e < lo) lo = e; if (e > hi) hi = e; }
      if (!okb) continue; var span = hi - lo, d = Math.abs(ox + BW / 2 - f.tx) + Math.abs(oy + BH / 2 - f.ty); if (!best || span < best.span - 0.05 || (span < best.span + 0.05 && d < best.d)) best = { ox: ox, oy: oy, span: span, d: d };
    }
    return best;
  })()`);
  if (!block) throw new Error('no flat 22×21 block on the map');
  console.log(`scene block at (${block.ox}, ${block.oy}), elevation span ${block.span.toFixed(2)} ft`);
  // QA scaffolding: clear the trees off the block (they hide the surfaces at zoom 2), hide the HUD for the shots
  const cleared = await g.eval(`(function () { var s = BSU.state, n = 0, ox = ${block.ox}, oy = ${block.oy}; for (var k = s.veg.length - 1; k >= 0; k--) { var v = s.veg[k]; if (v && v.tx >= ox - 1 && v.tx < ox + 23 && v.ty >= oy - 1 && v.ty < oy + 22) { BSU.terrain.removeVeg(s, v.tx, v.ty); n++; } } BSU.render.dirtyAll(); return n; })()`);
  await g.eval(`(BSU.ui.setHudMode('hidden'), true)`);
  console.log(`cleared ${cleared} plants off the block`);
  // lay the scene: runs through buildings.placeRun (ignoreCash, noTie) — exactly what a drag release does, minus the tie
  const laid = await g.eval(`(function () {
    var s = BSU.state, W = BSU.MAP.W, ox = ${block.ox}, oy = ${block.oy}, B = BSU.buildings, out = {};
    var I = function (x, y) { return (oy + y) * W + ox + x; };
    var row = function (y, x0, x1) { var t = []; for (var x = x0; x <= x1; x++) t.push(I(x, y)); return t; };
    var col = function (x, y0, y1) { var t = []; for (var y = y0; y <= y1; y++) t.push(I(x, y)); return t; };
    var lay = function (name, id, tiles) { var r = B.placeRun(s, id, tiles, { ignoreCash: true, noTie: true }); out[name] = { placed: r.placed, skipped: r.skipped.map(function (k) { return k.reason; }) }; };
    lay('L', 'road', row(1, 1, 6).concat(col(6, 2, 6)));                                   // the L-turn: east then south
    lay('cross-h', 'road', row(4, 9, 19)); lay('cross-v', 'road', col(14, 1, 7));           // the 4-way cross at (14, 4)
    lay('T-h', 'road', row(10, 1, 19)); lay('T-branch', 'road', col(5, 11, 13));            // the road T at (5, 10)
    lay('pathT', 'path', col(10, 11, 14));                                                   // a path T-ing into the road at (10, 10)
    lay('pathX-n', 'path', col(16, 6, 9)); lay('pathX-s', 'path', col(16, 11, 14));         // a path crossing the road at (16, 10)
    var stair = function (x0, y0, n) { var t = []; for (var k = 0; k < n; k++) { t.push(I(x0 + k, y0 + k)); if (k < n - 1) t.push(I(x0 + k + 1, y0 + k)); } return t; };
    lay('stair-road', 'road', stair(1, 15, 6)); lay('stair-path', 'path', stair(12, 15, 6)); // 1-step staircases: 6 steps each (the old drag's diagonal)
    return out;
  })()`);
  console.log('laid:', JSON.stringify(laid));
  // a bayou crossing with marsh banks: scan rows (then columns) for dry, marsh+, water×3, marsh+, dry inside the charter; and the ≤ 3 case: dry, marsh, water, dry
  const xing = await g.eval(`(function () {
    var s = BSU.state, W = BSU.MAP.W, H = BSU.MAP.H, t = s.tiles, L = BSU.land;
    var cls = function (i) { if (t.flags[i] & (BSU.FLAG.BAYOU | BSU.FLAG.OPEN_WATER)) return 'w'; var ty = t.type[i]; if (ty === BSU.T.OPEN_WATER || ty === BSU.T.BAYOU || ty === BSU.T.POND) return 'w'; if (ty === BSU.T.MARSH && !(t.flags[i] & BSU.FLAG.DRAINED)) return 'm'; if (ty === BSU.T.DRY || ty === BSU.T.HIGH || ty === BSU.T.WET || ty === BSU.T.DRAINED) return (t.owner[i] === -1 && t.surface[i] === 0) ? 'd' : 'x'; return 'x'; };
    var found = { long: null, short: null };
    var test = function (tiles) { var str = tiles.map(cls).join(''); if (tiles.some(function (i) { return L && !L.isChartered(s, i % W, (i / W) | 0); })) return; var m;
      if (!found.long && (m = /dm{1,2}w{3}m{1,2}d/.exec(str))) found.long = tiles.slice(m.index, m.index + m[0].length);
      if (!found.short && (m = /ddmwdd/.exec(str))) found.short = tiles.slice(m.index + 1, m.index + 5);
      if (!found.short && (m = /ddwmdd/.exec(str))) found.short = tiles.slice(m.index + 1, m.index + 5); };
    for (var y = 1; y < H - 1 && !(found.long && found.short); y++) { var r = []; for (var x = 1; x < W - 1; x++) r.push(y * W + x); test(r); }
    for (var x = 1; x < W - 1 && !(found.long && found.short); x++) { var c = []; for (var y = 1; y < H - 1; y++) c.push(y * W + x); test(c); }
    return found;
  })()`);
  const xyOf = (i) => [i % 96, Math.floor(i / 96)];
  console.log('bayou crossings:', xing.long ? 'long ' + JSON.stringify(xing.long.map(xyOf)) : 'no long crossing', '|', xing.short ? 'short ' + JSON.stringify(xing.short.map(xyOf)) : 'no short crossing');
  for (const k of ['long', 'short']) if (xing[k]) {
    const r = await g.eval(`(function () { var r = BSU.buildings.placeRun(BSU.state, 'road', ${JSON.stringify(xing[k])}, { ignoreCash: true, noTie: true }); return { placed: r.placed, skipped: r.skipped.map(function (q) { return [q.i, q.reason]; }) }; })()`);
    console.log(`${k} crossing laid: ${r.placed} placed, skipped ${JSON.stringify(r.skipped.map((q) => q[1]))}`);
  }
  const errs0 = await g.errorsSince(mark);
  // shots: the whole scene at zoom 1, the junction cluster and the staircases at zoom 2, the bayou crossings at zoom 2
  const cx = block.ox + 11, cy = block.oy + 11;
  const shot = async (name, tx, ty, zoom) => { await g.setZoom(zoom); await g.panToTile(tx, ty); await sleep(120); await g.settleCamera(); await g.waitBake({ timeoutMs: 60000 }); await sleep(200); const p = await g.shot(`roads-${args.tag}-${name}`); console.log('shot', p); };
  await g.clearUi();
  await shot('z1', cx, cy, 1);
  await shot('z2-cross', block.ox + 9, block.oy + 4, 2);      // the L-turn (left) and the 4-way cross (right)
  await shot('z2-tees', block.ox + 10, block.oy + 10, 2);     // the road T, the path T into the road, the path crossing the road
  await shot('z2-stairs', block.ox + 9, block.oy + 18, 2);    // the road staircase (left) and the path staircase (right)
  if (xing.long) { const [tx, ty] = xyOf(xing.long[Math.floor(xing.long.length / 2)]); await shot('z2-bayou', tx, ty, 2); }
  if (xing.short) { const [tx, ty] = xyOf(xing.short[2]); await shot('z2-bank', tx, ty, 2); }
  // the mid-drag ghost over the long crossing (the road tool armed; pointer down at one dry bank, moved to the other; no release)
  if (xing.long) {
    const a = xyOf(xing.long[0]), b = xyOf(xing.long[xing.long.length - 1]);
    await g.eval(`(function () { for (var k = 0; k < ${xing.long.length}; k++) { var i = ${JSON.stringify(xing.long)}[k]; if (BSU.state.tiles.surface[i] === BSU.SURF.ROAD) BSU.buildings.remove(BSU.state, { tile: i }, 'demolish'); } return true; })()`);
    await g.setZoom(2); await g.panToTile((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1); await sleep(120); await g.settleCamera(); await g.waitBake({ timeoutMs: 60000 });
    await g.eval(`(BSU.ui.selectTool(BSU.state, 'road'), true)`);
    const pa = await g.tilePx(a[0], a[1]), pb = await g.tilePx(b[0] + (b[0] === a[0] ? 2 : 0), b[1] + (b[1] === a[1] ? 2 : 0));
    await g.eval(`(function () {
      var c = BSU.ui.el.world, r = c.getBoundingClientRect(); var ev = function (type, x, y, buttons) { c.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: buttons, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })); };
      ev('pointermove', ${pa.x}, ${pa.y}, 0); ev('pointerdown', ${pa.x}, ${pa.y}, 1); ev('pointermove', ${pb.x}, ${pb.y}, 1); return BSU.ui.state; })()`);
    await sleep(250);
    const label = await g.eval(`(function () { var e = BSU.ui.el['ghost-l1'], f = BSU.ui.el['ghost-l2']; return (e ? e.textContent : '') + ' | ' + (f ? f.textContent : ''); })()`);
    console.log('ghost label:', label);
    const p = await g.shot(`roads-${args.tag}-ghost`); console.log('shot', p);
    await g.key('Escape'); await g.eval(`(BSU.ui.selectTool(BSU.state, null), true)`);
  }
  if (args.pen) {   // the pen stroke path: sprites.isHD patched false, every chunk re-baked
    await g.eval(`(function () { window.__isHD = BSU.sprites.isHD; BSU.sprites.isHD = function () { return false; }; BSU.render.dirtyAll(); return true; })()`);
    await shot('z2-junctions-pen', block.ox + 11, block.oy + 7, 2);
    await g.eval(`(function () { BSU.sprites.isHD = window.__isHD; BSU.render.dirtyAll(); return true; })()`);
  }
  const errs = await g.errorsSince(mark);
  if (errs.length) { code = 1; console.log('ERRORS:'); for (const e of errs) console.log('  ' + e); } else console.log('no console errors, exceptions or BSU.errors' + (errs0.length ? '' : ''));
} catch (e) { code = 2; console.error('scene failed:', e && e.stack || e); }
finally { await g.close(); killStrays(); }
process.exit(code);
