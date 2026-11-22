#!/usr/bin/env node
// Campus life and look pass (a student's playtest notes N9 "students never scattered", N8 "football field rotated: posts on the wrong ends",
// N26 "Quad Lawn should be connectable", N29 "night too dark, a glow at the mouse", and entities drawn over the walls they stand behind): real
// Chrome on seed 42 at 96, real pointer input where a student would use the mouse, shots and printed measurements.
//
//   spread   the typical campus (tools/qa/life_campus.mjs: about 1,000 students, four dorms, three halls, two lawns, a union…) at four hours of
//            the day (morning, noon, late afternoon, dusk): a shot and the census each (students outdoors / inside / walking / standing, distinct
//            tiles, the share within 3 tiles of the busiest tile, where the standing ones stand), then the mean over two whole days
//   fields   the Practice Field, Bayou Field and Stadium I / II / III, unrotated and rotated (R), at zoom 2 and zoom 1: gold is looked for where the
//            goalposts belong (the two short ends) and where they must not stand (the long sides); a game on a rotated Bayou Field
//   lawn     a Quad Lawn clicked, a second one hovered beside it (the ghost: joined, or pushed a tile away), a block dragged out with the
//            mouse (the mid-drag label), the card, one undo
//   night    the campus at noon, dusk, midnight and before dawn, zoom 1 and 2, with a tool armed and without, the pointer over the map: the
//            frame's brightness against noon, and the light under the pointer
//   wall     students, a tree and a Dorm right behind an Earthen Levee and a Concrete Floodwall, and students in front of them
//
//   node tools/qa/life_scene.mjs [--strict] [--index path] [--tag before|after] [--only spread,fields,lawn,night,wall] [--out dir]
//
// Run it on tools/qa/out/index-before.html with --tag before for the "before" shots (nothing is asserted there). --strict exits 1 unless the
// pass's promises hold (`must`). Scaffolding, not play: cash, g.unlockAll(), the campus builder, tiers set by hand on the fields, the scripted
// sky of the night shots, students stood beside the walls by hand, fast-forwarded days.
import { openGame, parseArgs, DEFAULT_OUT, resolveIndex, killStrays, sleep } from './lib.mjs';
import { LIFE_LAYOUT, buildLifeCampus, census, censusMean } from './life_campus.mjs';

const ALL = ['spread', 'fields', 'lawn', 'night', 'wall'];
const args = parseArgs(process.argv.slice(2), {
  index: { type: 'str', def: '' }, tag: { type: 'str', def: 'after' }, out: { type: 'str', def: DEFAULT_OUT }, only: { type: 'list', def: ALL },
  strict: { type: 'bool', def: false }, width: { type: 'num', def: 1440 }, height: { type: 'num', def: 900 },
});
const W = 96, I = (x, y) => y * W + x, J = JSON.stringify;
const index = resolveIndex(args.index), TAG = args.tag;
killStrays();
const g = await openGame({ index, width: args.width, height: args.height, size: 96, seed: 42, outDir: args.out, noGuard: true });
let code = 0, problems = 0;
const bad = (m) => { problems++; console.log('  PROBLEM: ' + m); };
const must = (cond, m) => { if (args.strict && !cond) bad(m); return cond; };
const SKY = (phase, t) => `(function () { try { if (!BSU.state.setPiece) BSU.weather.scriptSky(BSU.state, ${phase}, ${t}); } catch (e) {} return true; })()`;
const DAY = SKY(1, 0.4);
const shot = async (name, sky = DAY) => { if (sky) await g.eval(sky); await sleep(200); const p = await g.shot(`life-${TAG}-${name}`); console.log('  shot ' + p.split('/').slice(-1)[0]); };
const pct = (v) => Math.round(v * 100) + ' %';
const r1 = (v) => Math.round(v * 10) / 10;

async function install() {
  await g.eval(`(function () {
    var X = window.__lx = {}, W = BSU.MAP.W;
    X.build = ${buildLifeCampus.toString()};
    X.census = ${census.toString()};
    X.censusMean = ${censusMean.toString()};
    X.ghost = null; var g0 = BSU.render.ghost; BSU.render.ghost = function (spec) { if (spec) X.ghost = spec; return g0.apply(BSU.render, arguments); };
    X.px = function (tx, ty) {   // a canvas point that picks tile (tx, ty)
      var R = BSU.render, p = R.tileToScreen(tx, ty), z = BSU.state.ui.camera.zoom, hit = function (x, y) { var t = R.screenToTile(x, y); return !!t && Math.floor(t.tx) === tx && Math.floor(t.ty) === ty; };
      if (hit(p.x, p.y)) return { x: p.x, y: p.y, moved: 0 };
      for (var r = 1; r <= 10; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; var x = p.x + dx * 4 * z, y = p.y + dy * 2 * z; if (hit(x, y)) return { x: x, y: y, moved: r }; }
      return { x: p.x, y: p.y, moved: -1 };
    };
    X.clearVeg = function (b) { var s = BSU.state; for (var k = s.veg.length - 1; k >= 0; k--) { var v = s.veg[k]; if (v && v.tx >= b[0] && v.tx <= b[2] && v.ty >= b[1] && v.ty <= b[3]) BSU.terrain.removeVeg(s, v.tx, v.ty); } BSU.render.dirtyAll(); return true; };
    X.label = function () { var e = BSU.ui.el['ghost-l1'], f = BSU.ui.el['ghost-l2'], gs = X.ghost || {}; return { l1: e ? e.textContent : '', l2: f ? f.textContent : '', tiles: (gs.tiles || []).length, color: gs.color || '', at: gs.sprite ? [gs.sprite.tx, gs.sprite.ty] : null }; };
    X.card = function () { var c = document.querySelector('#inspect'); if (!c) return null; var rows = Array.from(c.querySelectorAll('.row, .insp-row')).map(function (r) { return (r.innerText || r.textContent || '').replace(/\\s+/g, ' ').trim(); }).filter(Boolean); return { title: (BSU.ui.el['insp-title'] || {}).textContent || '', sub: (BSU.ui.el['insp-sub'] || {}).textContent || '', rows: rows }; };
    /** mean luminance (0–255) of the world canvas in a CSS-px rectangle (the whole frame by default), sampled on a 6-px grid */
    X.lum = function (x0, y0, x1, y1) {
      var c = BSU.render.canvas, k = c.width / c.clientWidth, ctx = c.getContext('2d');
      x0 = Math.max(0, Math.round((x0 || 0) * k)); y0 = Math.max(0, Math.round((y0 || 0) * k)); x1 = Math.min(c.width, Math.round((x1 == null ? c.clientWidth : x1) * k)); y1 = Math.min(c.height, Math.round((y1 == null ? c.clientHeight : y1) * k));
      var d = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data, w = Math.max(1, x1 - x0), sum = 0, n = 0, st = Math.max(1, Math.round(6 * k));
      for (var y = 0; y < y1 - y0; y += st) for (var x = 0; x < w; x += st) { var o = (y * w + x) * 4; sum += 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]; n++; }
      return n ? sum / n : 0;
    };
    /** how many gold pixels (a goalpost) lie within r CSS px of a canvas point */
    X.gold = function (px, py, r) {
      var c = BSU.render.canvas, k = c.width / c.clientWidth, ctx = c.getContext('2d'), R = Math.round(r * k), x0 = Math.round(px * k) - R, y0 = Math.round(py * k) - R;
      if (x0 < 0 || y0 < 0 || x0 + 2 * R > c.width || y0 + 2 * R > c.height) return -1;
      var d = ctx.getImageData(x0, y0, 2 * R, 2 * R).data, n = 0;
      for (var o = 0; o < d.length; o += 4) if (d[o] > 205 && d[o + 1] > 150 && d[o + 1] < 235 && d[o + 2] < 110 && d[o] - d[o + 2] > 120) n++;
      return n;
    };
    return true; })()`);
}
const fresh = async ({ cash = 5e7 } = {}) => {
  await g.newGame(); await g.cash(cash); await g.unlockAll(); await install();
  await g.eval(`(BSU.ui.setHudMode('hidden'), true)`);
  await g.tick(5); await g.eval(DAY);
};
const view = async (z, tx, ty) => { await g.setZoom(z); await g.panToTile(tx, ty); await sleep(120); await g.settleCamera(); await g.waitBake({ timeoutMs: 60000 }); await sleep(150); };
const pev = (type, p, buttons, mods = {}) => g.eval(`(function () { var c = BSU.ui.el.world, r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent(${J(type)}, { clientX: r.left + ${p.x}, clientY: r.top + ${p.y}, button: 0, buttons: ${buttons}, shiftKey: ${!!mods.shift}, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })); return true; })()`);
const tilePx = async (tx, ty) => { const p = await g.eval(`window.__lx.px(${tx}, ${ty})`); if (p.moved < 0) throw new Error(`no screen point picks tile ${tx},${ty}`); return p; };
const hover = async (tx, ty) => { const p = await tilePx(tx, ty); await pev('pointermove', p, 0); await sleep(120); return p; };
const clickTile = async (tx, ty, mods) => { const p = await tilePx(tx, ty); await pev('pointermove', p, 0, mods); await sleep(60); await pev('pointerdown', p, 1, mods); await sleep(40); await pev('pointerup', p, 0, mods); await sleep(260); return p; };
const arm = async (id) => { await g.eval(`(BSU.ui.selectTool(BSU.state, ${J(id)}), window.__lx.ghost = null, true)`); await sleep(80); };
const unarm = async () => { await g.eval(`(BSU.ui.selectTool(BSU.state, null), BSU.ui.closeInspect(), true)`); await g.clearUi(); await g.eval(`(BSU.ui.setHudMode('hidden'), true)`); await sleep(120); };
const frame = async () => { await g.eval(`new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(true); }); }); })`); };
const campus = async (students = 1000) => {
  const log = await g.eval(`window.__lx.build(BSU, { layout: ${J(LIFE_LAYOUT)}, students: ${students} })`);
  const refused = log.filter((l) => /REFUSED/.test(l)); if (refused.length) console.log('  campus: ' + refused.join(' | '));
  await g.eval(`(BSU.ui.setHudMode('hidden'), BSU.ui.closeInspect(), true)`); await g.clearUi(); await g.eval(`(BSU.ui.setHudMode('hidden'), true)`);
  return log;
};

// ---- spread: the typical campus through a day -------------------------------------------------------------------------------------------
async function caseSpread() {
  console.log('\n(spread) the typical campus (about 1,000 students) at four hours of the day, then the mean over two whole days');
  await fresh(); await campus(1000);
  await view(1, 83, 45);
  const info = await g.eval(`(function () { var s = BSU.state, c = window.__lx.census(BSU), name = function (id) { var b = s.buildings[id]; return b ? b.type + '#' + id : 'none'; }; var h = {}, k = {}; Object.keys(c.homes).forEach(function (q) { h[name(q)] = c.homes[q]; }); Object.keys(c.classes).forEach(function (q) { k[name(q)] = c.classes[q]; }); return { students: s.economy.students, agents: c.n, homes: h, classes: k, housing: s.buildings.filter(function (b) { return b && /dorm|greek|tower|suites|bunk/.test(b.type); }).length, halls: s.buildings.filter(function (b) { return b && /founders_hall|lecture_hall|engineering|coastal/.test(b.type); }).length, gators: s.gators.length }; })()`);
  console.log(`  ${info.students} students · ${info.agents} students on the map · ${info.housing} housing buildings, ${info.halls} halls`);
  console.log(`  where they live: ${J(info.homes)}`);
  console.log(`  where their first class is: ${J(info.classes)}`);
  await g.eval(`(function () { BSU.weather.releaseSky(BSU.state); var s = BSU.state, n = 0; while (s.sky.cycleTick !== 0 && n++ < 400) BSU.headless.tick(1); return s.sky.cycleTick; })()`);
  const HOURS = [['morning', 45], ['noon', 90], ['afternoon', 150], ['dusk', 187]];
  const seen = [];
  let at = 0;
  for (const [name, cyc] of HOURS) {
    await g.eval(`(BSU.headless.tick(${cyc - at}), true)`); at = cyc;
    await frame(); await sleep(250);
    const c = await g.eval(`window.__lx.census(BSU)`);
    seen.push(c);
    console.log(`  ${name.padEnd(9)} (cycle tick ${cyc}): ${c.out} outdoors (${c.moving} walking, ${c.standing} standing, ${c.onLawn} on a lawn), ${c.inside} inside · ${c.tiles} tiles, ${c.blocks} blocks · busiest tile ${c.busiest} · ${pct(c.share3)} within 3 tiles of it`);
    console.log(`            standing at: ${Object.entries(c.where).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ') || '(nobody stands)'}`);
    await shot(`spread-${name}-z1`, null);
  }
  await g.eval(`(BSU.headless.tick(${300 - at}), true)`);
  const m = await g.eval(`window.__lx.censusMean(BSU, 2, window.__lx.census)`);
  console.log(`  two whole days, every tick: ${r1(m.out)} outdoors (${r1(m.moving)} walking, ${r1(m.standing)} standing, ${r1(m.onLawn)} on a lawn), ${r1(m.inside)} inside · ${r1(m.tiles)} distinct tiles · ${r1(m.blocks)} blocks · ${pct(m.share3)} within 3 tiles of the busiest tile`);
  for (const p of Object.keys(m.byPhase)) { const q = m.byPhase[p]; console.log(`    ${p.padEnd(6)} ${r1(q.out)} out · ${r1(q.standing)} standing · ${r1(q.tiles)} tiles · ${r1(q.blocks)} blocks · ${pct(q.share3)}`); }
  const homesUsed = Object.values(info.homes).filter((n) => n >= info.agents * 0.04).length, hallsUsed = Object.values(info.classes).filter((n) => n >= info.agents * 0.1).length;
  must(homesUsed >= 4, `(spread) students live in ${homesUsed} housing buildings (of ${info.housing}): every dorm should hold its share`);
  must(hallsUsed >= 3, `(spread) first classes are in ${hallsUsed} halls (of ${info.halls})`);
  must(m.share3 <= 0.6, `(spread) ${pct(m.share3)} of the students outdoors stand within 3 tiles of the busiest tile over two days (at most 60 %)`);
  must(m.tiles >= 26, `(spread) the students hold ${r1(m.tiles)} distinct tiles on average (at least 26)`);
  must(m.blocks >= 7, `(spread) the students hold ${r1(m.blocks)} 5 × 5 blocks on average (at least 7)`);
  must(m.onLawn > 0.3, `(spread) nobody stands on a Quad Lawn (${r1(m.onLawn)} on average)`);
  return m;
}

// ---- fields: goalposts at the short ends in both rotations ----------------------------------------------------------------------------------
async function fieldsScene(name, list, cx, cy) {
  await fresh({ cash: 1e9 });
  const r = await g.eval(`(function () { var s = BSU.state, out = []; window.__lx.clearVeg([70, 28, 95, 62]);
    for (var y = 42; y <= 58; y++) for (var x = 78; x <= 90; x++) { var i = y * 96 + x; if (s.tiles.surface[i] === 1) BSU.buildings.remove(s, { tile: i }, 'qa'); }
    var rd = []; for (var y2 = 39; y2 <= 57; y2++) rd.push(y2 * 96 + 86); BSU.buildings.placeRun(s, 'road', rd, {});
    ${J(list)}.forEach(function (q) { var p = BSU.buildings.place(s, q[0], q[1], q[2], { rot: q[3] }); if (p.ok) { var b = s.buildings[p.id]; b.built = 1; b.tier = q[4]; out.push({ id: p.id, type: q[0], rot: q[3], tier: q[4], tx: b.tx, ty: b.ty, w: b.w, h: b.h }); } else out.push({ type: q[0], rot: q[3], refused: p.reason }); });
    BSU.render.dirtyAll(); return out; })()`);
  await g.tick(3);
  const res = [];
  for (const z of [2, 1]) {
    await view(z, cx, cy); await g.eval(DAY); await sleep(250); await frame();
    for (const b of r) {
      if (b.refused) { console.log(`  ${b.type}${b.rot ? ' rotated' : ''}: REFUSED (${b.refused})`); continue; }
      // the two short ends and the two long sides of the footprint's playing field, in tile coordinates
      const long = b.w >= b.h ? 'x' : 'y', inset = b.type === 'stadium' ? 1.06 : 0.6;
      const ends = long === 'x' ? [[b.tx + inset, b.ty + b.h / 2], [b.tx + b.w - inset, b.ty + b.h / 2]] : [[b.tx + b.w / 2, b.ty + inset], [b.tx + b.w / 2, b.ty + b.h - inset]];
      const sideIn = b.type === 'stadium' ? 1.06 : 0.6;
      const sides = long === 'x' ? [[b.tx + b.w / 2, b.ty + sideIn], [b.tx + b.w / 2, b.ty + b.h - sideIn]] : [[b.tx + sideIn, b.ty + b.h / 2], [b.tx + b.w - sideIn, b.ty + b.h / 2]];
      const probe = async (p) => g.eval(`(function () { var q = BSU.render.tileToScreen(${p[0]} - 0.5, ${p[1]} - 0.5), z = BSU.state.ui.camera.zoom; return window.__lx.gold(q.x, q.y - 9 * z, 7 * z); })()`);
      const ge = [await probe(ends[0]), await probe(ends[1])], gs = [await probe(sides[0]), await probe(sides[1])];
      const label = `${b.type === 'stadium' ? 'Stadium ' + 'I'.repeat(b.tier) : (b.tier ? 'Bayou Field' : 'Practice Field')}${b.rot ? ' rotated' : ''}`;
      console.log(`  z${z} ${label.padEnd(24)} ${b.w} × ${b.h}: gold at the short ends ${ge.join(' / ')} px · at the long sides ${gs.join(' / ')} px`);
      res.push({ label, z, ge, gs, b });
      must(ge[0] > 3 && ge[1] > 3, `(fields) ${label} at zoom ${z}: no goalpost at a short end (gold px ${ge.join(' / ')})`);
      must(gs[0] < Math.max(4, ge[0] / 2) && gs[1] < Math.max(4, ge[1] / 2), `(fields) ${label} at zoom ${z}: a goalpost stands on a long side (gold px ${gs.join(' / ')})`);
    }
    await shot(`fields-${name}-z${z}`);
  }
  return { r, res };
}
async function caseFields() {
  console.log('\n(fields) goalposts, yard lines and stands in both rotations (the game has two: R turns the 4 × 3 footprint to 3 × 4)');
  await fieldsScene('practice', [['practice_field', 81, 43, 0, 0], ['practice_field', 82, 48, 1, 0], ['practice_field', 81, 53, 0, 1], ['practice_field', 87, 46, 1, 1]], 84, 49);
  for (const t of [1, 2, 3]) await fieldsScene('stadium' + t, [['stadium', 79, 33, 0, t], ['stadium', 81, 46, 1, t]], 83, 42);
  // the game itself on a rotated Bayou Field: where the players stand against the field's own long axis
  await fresh({ cash: 1e9 });
  const gm = await g.eval(`(function () { var s = BSU.state; window.__lx.clearVeg([70, 28, 95, 62]);
    for (var y = 42; y <= 58; y++) for (var x = 78; x <= 90; x++) { var i = y * 96 + x; if (s.tiles.surface[i] === 1) BSU.buildings.remove(s, { tile: i }, 'qa'); }
    var p = BSU.buildings.place(s, 'practice_field', 82, 47, { rot: 1 }); if (!p.ok) return { err: p.reason };
    var b = s.buildings[p.id]; b.built = 1; b.tier = 1; BSU.economy.addStudents(s, 600, 'qa'); BSU.headless.fastForwardDays(2);
    var r = BSU.sports.playHome(s); return { ok: !!(r && r.ok), reason: r && r.reason, id: p.id, tx: b.tx, ty: b.ty, w: b.w, h: b.h }; })()`);
  if (!gm.ok) { console.log('  a game on the rotated Bayou Field did not start: ' + J(gm)); must(false, '(fields) the game on a rotated field did not start'); return; }
  await g.eval(`(BSU.render.captureCameraTouch(BSU.state), true)`);
  await view(2, gm.tx + gm.w / 2, gm.ty + gm.h / 2);
  let spanSeen = null;
  await g.run(260, { slice: 20, frameMs: 20, each: async () => { const s = await g.eval(`(function () { var R = BSU.render, f = R.fbInfo(); if (!f.active || f.players < 20) return null; return { minX: f.minX, maxX: f.maxX, minY: f.minY, maxY: f.maxY, players: f.players, fans: f.fans }; })()`); if (s) spanSeen = s; return false; } });
  const geo = await g.eval(`(function () { var R = BSU.render, b = BSU.state.buildings[${gm.id}], a = R.fieldToWorld(b, -10, 26.6, 0), c = R.fieldToWorld(b, 110, 26.6, 0), d = R.fieldToTile(b, 0, 26.6), e = R.fieldToTile(b, 100, 26.6), q = R.fieldQuad(b); return { goal0: [d.tx, d.ty], goal1: [e.tx, e.ty], T: !!q.T }; })()`);
  const alongY = Math.abs(geo.goal1[1] - geo.goal0[1]) > Math.abs(geo.goal1[0] - geo.goal0[0]);
  console.log(`  a game on the rotated Bayou Field (${gm.w} × ${gm.h}): the goal lines are at tiles ${geo.goal0.map(r1).join(',')} and ${geo.goal1.map(r1).join(',')}: the field runs along ${alongY ? 'the long (Y) side' : 'the short (X) side'}${spanSeen ? ` · ${spanSeen.players} players, ${spanSeen.fans} fans drawn` : ''}`);
  must(alongY, '(fields) on a rotated Bayou Field the game is played across the short side');
  await shot('fields-game-rotated-z2', null);
}

// ---- lawn: click, join, drag a block ---------------------------------------------------------------------------------------------------
async function caseLawn() {
  console.log('\n(lawn) Quad Lawns: one clicked, a second one beside it, a block dragged out');
  await fresh({ cash: 5e6 });
  await g.eval(`window.__lx.clearVeg([70, 44, 92, 60])`);
  await g.eval(`(function () { var s = BSU.state; for (var y = 42; y <= 58; y++) for (var x = 78; x <= 90; x++) { var i = y * 96 + x; if (s.tiles.surface[i] === 1) BSU.buildings.remove(s, { tile: i }, 'qa'); } return true; })()`);
  await view(2, 85, 50);
  const count = () => g.eval(`BSU.state.buildings.filter(function (b) { return b && b.type === 'quad'; }).length`);
  // 1. one click, one lawn
  await arm('quad'); await clickTile(83, 46);
  const n1 = await count(), tool1 = await g.eval(`BSU.state.ui.tool ? BSU.state.ui.tool.id : null`);
  console.log(`  a click at (83, 46): ${n1} lawn${n1 === 1 ? '' : 's'} · the tool after the click: ${tool1 || 'dropped'}`);
  must(n1 === 1 && tool1 === null, `(lawn) one click should lay one lawn and drop the tool (lawns ${n1}, tool ${tool1})`);
  // 2. the second lawn hovered right beside the first: where does the ghost stand?
  await arm('quad'); await hover(85, 46); await sleep(150);
  const gh = await g.eval(`window.__lx.label()`);
  console.log(`  the ghost of a second lawn with the pointer on (85, 46), right beside the first: it stands at ${gh.at ? gh.at.join(', ') : '?'} · ${J(gh.l1)} / ${J(gh.l2)}`);
  await shot('lawn-1-ghost-beside-z2');
  must(gh.at && gh.at[0] === 85 && gh.at[1] === 46, `(lawn) the ghost of a lawn beside a lawn is pushed away (it stands at ${gh.at})`);
  await clickTile(85, 46); await unarm();
  await g.days(2); await g.waitBake({ timeoutMs: 60000 });
  const two = await g.eval(`(function () { var s = BSU.state, q = s.buildings.filter(function (b) { return b && b.type === 'quad'; }), L = BSU.buildings.lawnLayout ? BSU.buildings.lawnLayout(s) : null; return { lawns: q.map(function (b) { return [b.tx, b.ty]; }), groups: L ? L.groups.map(function (gq) { return { lawns: gq.ids.length, tiles: gq.tiles }; }) : null }; })()`);
  console.log(`  two clicks: lawns at ${two.lawns.map((p) => p.join(',')).join(' and ')}${two.groups ? ' · groups ' + J(two.groups) : ''}`);
  await shot('lawn-2-two-side-by-side-z2');
  must(two.groups && two.groups.length === 1 && two.groups[0].tiles === 8, `(lawn) two lawns side by side should be one 8-tile quad: ${J(two.groups)}`);
  // 3. a block dragged with the mouse: pressed on (82, 50), dragged to (87, 53): 6 × 4 tiles = six lawns
  await arm('quad');
  const pa = await tilePx(82, 50), pb = await tilePx(87, 53);
  await pev('pointermove', pa, 0); await pev('pointerdown', pa, 1);
  for (let k = 1; k <= 14; k++) { await pev('pointermove', { x: pa.x + (pb.x - pa.x) * k / 14, y: pa.y + (pb.y - pa.y) * k / 14 }, 1); await sleep(20); }
  await sleep(260);
  const lab = await g.eval(`window.__lx.label()`), cash0 = await g.eval(`BSU.state.economy.cash`), before = await count();
  console.log(`  a drag from (82, 50) to (87, 53), mid-drag: ${J(lab.l1)} / ${J(lab.l2)} · ${lab.tiles} tiles in the ghost (${lab.color})`);
  await shot('lawn-3-drag-z2', DAY);
  await pev('pointerup', pb, 0); await sleep(300);
  const after = await count(), spent = cash0 - (await g.eval(`BSU.state.economy.cash`)), tool3 = await g.eval(`BSU.state.ui.tool ? BSU.state.ui.tool.id : null`);
  const undo = await g.eval(`(function () { var i = BSU.buildings.undoInfo(BSU.state); return i ? { n: i.n, name: i.name, cost: i.cost } : null; })()`);
  console.log(`  released: ${after - before} lawns laid for $${spent.toLocaleString('en-US')} ($30,000 a lawn, $7,500 a tile, plus grading where the ground slopes) · the tool after the drag: ${tool3 || 'dropped'} · one undo record: ${J(undo)}`);
  must(after - before === 6 && spent >= 180000 && spent <= 240000, `(lawn) the 6 × 4 drag should lay six lawns for $180,000 plus grading (laid ${after - before} for $${spent})`);
  must(lab.l1.indexOf('24 tiles · $') === 0 && lab.l2.indexOf('6 lawns') >= 0, `(lawn) the drag label should read "24 tiles · $…" / "6 lawns · …": ${J(lab)}`);
  must(undo && undo.n === 6, `(lawn) the dragged block should be one undo record of six lawns: ${J(undo)}`);
  if (after - before !== 6) {   // the build before the pass pans the map on a drag: lay the same block by hand (Shift holds a lawn flush) so the look can be compared
    await g.eval(`(function () { var s = BSU.state; [[82, 50], [84, 50], [86, 50], [82, 52], [84, 52], [86, 52]].forEach(function (p) { BSU.buildings.place(s, 'quad', p[0], p[1], {}); }); return true; })()`);
    console.log('  (the same six lawns placed by hand for the comparison shot)');
  }
  await unarm(); await g.days(2); await view(2, 85, 50); await shot('lawn-4-block-z2');
  await view(1, 85, 50); await shot('lawn-5-block-z1');
  const lay = await g.eval(`(function () { var s = BSU.state, B = BSU.buildings; if (!B.lawnLayout) return null; var L = B.lawnLayout(s), b = B.at(s, 84, 51), gq = b ? B.lawnGroup(s, b.id) : null, seams = 0, kerbs = 0;
    if (gq) for (var y = gq.y0; y <= gq.y1; y++) for (var x = gq.x0; x <= gq.x1; x++) { var v = L.look[y * 96 + x]; if (!v) continue; if (x < gq.x1 && L.look[y * 96 + x + 1] && !(v & 2)) seams++; if (y < gq.y1 && L.look[(y + 1) * 96 + x] && !(v & 4)) seams++; if (!(v & 1)) kerbs++; if (!(v & 2)) kerbs++; if (!(v & 4)) kerbs++; if (!(v & 8)) kerbs++; }
    return { group: gq, seams: seams, kerbEdges: kerbs, oaks: L.oaks.length, groups: L.groups.length }; })()`);
  if (lay) console.log(`  the block: ${lay.group ? lay.group.text : '?'} · kerb on ${lay.kerbEdges} outer tile edges, ${lay.seams} kerbs between lawns · ${lay.oaks} oaks on the map's lawns`);
  must(lay && lay.group && lay.group.tiles === 24 && lay.group.lawns === 6 && lay.seams === 0 && lay.kerbEdges === 20, `(lawn) the dragged block should be one 24-tile quad with a kerb on its 20 outer edges only: ${J(lay)}`);
  // the card of one of its lawns
  await view(2, 85, 50); await g.eval(`(function () { var b = BSU.buildings.at(BSU.state, 84, 51); if (b) BSU.ui.inspect(BSU.state, { kind: 'building', id: b.id }); return !!b; })()`); await sleep(350);
  const card = await g.eval(`window.__lx.card()`);
  console.log('  the card of a lawn in the block: ' + J(card));
  await shot('lawn-6-card');
  must(card && card.rows.some((r) => /24-tile quad/.test(r)), '(lawn) the card does not say "Part of a 24-tile quad": ' + J(card));
  await unarm();
}

// ---- night: how dark, and the light under the pointer -------------------------------------------------------------------------------------
async function caseNight() {
  console.log('\n(night) the campus at noon, dusk, midnight and before dawn, the pointer over the map');
  await fresh(); await campus(1000);
  await g.eval(`(BSU.session.setSpeed(BSU.state, 0, 'user'), true)`);
  const HOURS = [['noon', 1, 0.5], ['dusk', 3, 0.6], ['midnight', 4, 0.4], ['before-dawn', 4, 0.9]];
  const P = { x: 760, y: 470 };   // the pointer, over the middle of the campus
  const out = {};
  for (const z of [1, 2]) {
    await view(z, 84, 45);
    for (const [name, ph, t] of HOURS) {
      for (const armed of [false, true]) {
        if (armed) await arm('dorm'); else await unarm();
        await g.eval(SKY(ph, t)); await pev('pointermove', P, 0); await sleep(260); await frame();
        const m = await g.eval(`(function () { var X = window.__lx, c = { x: ${P.x}, y: ${P.y} }; return { all: X.lum(), far: X.lum(40, 120, 340, 420), near: X.lum(c.x - 45, c.y - 30, c.x + 45, c.y + 30), info: BSU.render.nightInfo ? BSU.render.nightInfo(BSU.state) : null }; })()`);
        out[`${name}-z${z}${armed ? '-armed' : ''}`] = m;
        await shot(`night-${name}-z${z}${armed ? '-armed' : ''}`, null);
      }
    }
  }
  await unarm();
  const L = (k) => out[k];
  for (const z of [1, 2]) {
    const noon = L(`noon-z${z}`);
    for (const [name] of HOURS) {
      const a = L(`${name}-z${z}`), b = L(`${name}-z${z}-armed`);
      console.log(`  z${z} ${name.padEnd(11)} frame brightness ${r1(a.all)} (${pct(a.all / noon.all)} of noon) · away from the pointer ${r1(a.far)} (${pct(a.far / noon.far)} of noon) · under the pointer ${r1(a.near)}, with a tool armed ${r1(b.near)}${a.info ? ` · cursor light ${a.info.cursor.on ? 'r ' + a.info.cursor.r + ' a ' + r1(a.info.cursor.a * 100) / 100 : 'off'} / armed ${b.info.cursor.on ? 'r ' + b.info.cursor.r + ' a ' + r1(b.info.cursor.a * 100) / 100 : 'off'}` : ''}`);
    }
    const mid = L(`midnight-z${z}`), midA = L(`midnight-z${z}-armed`);
    must(mid.all / noon.all >= 0.5 && mid.far / noon.far >= 0.45, `(night) at zoom ${z} the midnight frame is at ${pct(mid.all / noon.all)} of its noon brightness (at least 50 %), its darkest corner away from the pointer at ${pct(mid.far / noon.far)} (at least 45 %)`);
    must(mid.info && mid.info.cursor.on && midA.info.cursor.a > mid.info.cursor.a && !noon.info.cursor.on, `(night) at zoom ${z} the cursor light should be on at midnight, stronger with a tool armed, off at noon: ${J(mid.info && mid.info.cursor)} / ${J(midA.info && midA.info.cursor)} / ${J(noon.info && noon.info.cursor)}`);
  }
  // the three settings at midnight, zoom 1, the pointer parked off the map
  if (await g.eval(`typeof BSU.ui.setNightMode === 'function'`)) {
    await view(1, 84, 45); const modes = {};
    for (const mode of ['dim', 'standard', 'bright']) {
      await g.eval(`(BSU.ui.setNightMode(${J(mode)}), BSU.render.cursor.on = false, true)`); await g.eval(SKY(4, 0.4)); await sleep(260); await frame();
      modes[mode] = await g.eval(`({ all: window.__lx.lum(), floor: BSU.render.nightFloor(${J(mode)}) })`);
      await shot(`night-setting-${mode}-z1`, null);
    }
    await g.eval(`(BSU.ui.setNightMode('standard'), true)`);
    const noon = L('noon-z1');
    console.log(`  Settings → Night brightness at midnight: Dim ${pct(modes.dim.all / noon.all)} of noon (the night as it was) · Standard ${pct(modes.standard.all / noon.all)} · Bright ${pct(modes.bright.all / noon.all)} · the scene is multiplied by ${['dim', 'standard', 'bright'].map((m) => m + ' ' + modes[m].floor.map((v) => r1(v * 100) / 100).join('/')).join(' · ')}`);
    must(modes.dim.all < modes.standard.all && modes.standard.all < modes.bright.all, `(night) the three settings should brighten in order: ${J(modes)}`);
  }
  await g.eval(`(BSU.weather.releaseSky(BSU.state), true)`);
}

// ---- wall: entities behind and in front of a levee and a floodwall ---------------------------------------------------------------------------
async function caseWall() {
  console.log('\n(wall) students, a tree and a Dorm right behind a levee and a floodwall, students in front');
  await fresh({ cash: 1e9 });
  await g.eval(`window.__lx.clearVeg([70, 40, 92, 60])`);
  const r = await g.eval(`(function () { var s = BSU.state, B = BSU.buildings, row = function (y, x0, x1) { var t = []; for (var x = x0; x <= x1; x++) t.push(y * 96 + x); return t; };
    for (var y = 42; y <= 58; y++) for (var x = 78; x <= 90; x++) { var i = y * 96 + x; if (s.tiles.surface[i] === 1) B.remove(s, { tile: i }, 'qa'); }
    var a = B.placeRun(s, 'levee', row(49, 80, 84), {}), b = B.placeRun(s, 'floodwall', row(49, 85, 89), {});
    var d = B.place(s, 'dorm', 85, 46, {}); if (d.ok) s.buildings[d.id].built = 1;
    BSU.terrain.plantVeg(s, 'oak', 81, 48); var v = s.veg[s.veg.length - 1]; if (v) v.stage = 2;
    BSU.economy.addStudents(s, 300, 'qa'); BSU.agents.regenerate(s);
    BSU.session.setSpeed(s, 0, 'user');
    var spots = [[80.5, 48.6], [82.5, 48.6], [83.5, 48.3], [84.6, 48.7], [80.5, 50.5], [83.5, 50.4], [86.5, 50.5], [88.5, 50.4], [82.5, 49.5]], n = 0;
    for (var k = 0; k < s.agents.length && n < spots.length; k++) { var q = s.agents[k]; if (!q || q.state === 'GONE') continue; q.tx = q.px = spots[n][0]; q.ty = q.py = spots[n][1]; q.inside = false; q.state = 'IDLE'; q.goal = 'idle'; q.target = -1; q.route = []; q.anim = 'idle'; q.step = 0; q.rhSet = false; n++; }
    for (; k < s.agents.length; k++) if (s.agents[k]) s.agents[k].inside = true;
    BSU.render.dirtyAll();
    return { levee: a.placed, floodwall: b.placed, dorm: d.ok, stood: n }; })()`);
  console.log(`  ${r.levee} levee tiles and ${r.floodwall} floodwall tiles along row 49 · a Dorm at (85, 46) right behind the floodwall · an oak at (81, 48) · ${r.stood} students stood by hand (four behind, four in front, one on the crown)`);
  for (const z of [2, 1]) {
    await view(z, 84, 49); await g.eval(DAY); await sleep(250); await frame();
    const w = await g.eval(`(function () { var R = BSU.render, wo = R.wallOrder ? R.wallOrder() : null;
      // the pixel at the ankles of the student behind the levee at (82.5, 48.6): wall-coloured when the wall covers it
      var a = BSU.state.agents.filter(function (q) { return q && !q.inside; })[1], sc = R.entityScreen ? R.entityScreen(a) : null;
      return { order: wo, feet: sc ? { x: Math.round(sc.x), y: Math.round(sc.y) } : null }; })()`);
    console.log(`  z${z}: ${w.order ? w.order.pushed + ' wall tiles drawn again in the entity pass (in depth order)' : 'walls are in the ground layer only: every entity is drawn over them'}`);
    await shot(`wall-z${z}`);
    must(w.order && w.order.any && w.order.pushed >= 6, `(wall) at zoom ${z} the wall tiles with something behind them are not drawn in depth order: ${J(w.order)}`);
  }
}

const CASES = { spread: caseSpread, fields: caseFields, lawn: caseLawn, night: caseNight, wall: caseWall };
try {
  console.log(`Campus life scenes on ${index} (tag ${TAG})`);
  const mark = await g.mark();
  for (const k of args.only) {
    if (!CASES[k]) { console.log('unknown case ' + k); code = 2; continue; }
    await CASES[k]();
  }
  const errs = await g.errorsSince(mark);
  if (errs.length) { console.log('\nERRORS:'); for (const e of errs) console.log('  ' + e); if (args.strict) code = 1; }
  if (problems) { console.log(`\n${problems} problem(s)`); code = 1; }
  if (!errs.length && !problems) console.log('\nALL OK');
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); code = 1; }
await g.close();
process.exit(code);
