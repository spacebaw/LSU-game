// The "typical campus" of the campus life and look pass: a mid-size campus the way a student lays one out on seed 42 at 96 (about 1,000 students:
// four dorms and a Greek house, Founders' Hall and two Lecture Halls, a Dining Hall and a Po'boy Shack, two Quad Lawns, the Union, the Rec Center,
// the Library, a Health Center, live oaks, everything tied by gravel paths). Shared by test/unit/life.test.mjs (Node, through test/domstub.mjs)
// and tools/qa/life_scene.mjs (real Chrome: the functions are sent to the page as source), so both measure the same campus.
//
// buildLifeCampus(BSU, opts) and census(BSU) take the page's BSU and use nothing else: they run on any build, the one before the pass included.

/** [id, tx, ty, rot?] or ['path', x0, y0, x1, y1] (an L from the first point: x first, then y) */
export const LIFE_LAYOUT = [
  ['path', 84, 42, 84, 50], ['path', 80, 44, 88, 44], ['path', 80, 36, 80, 50], ['path', 80, 50, 88, 50], ['path', 88, 36, 88, 56], ['path', 80, 36, 88, 36],
  ['substation', 89, 40], ['water_tower', 89, 42],
  ['dorm', 76, 37], ['dorm', 76, 40], ['dorm', 81, 33], ['lecture_hall', 85, 45], ['dining_hall', 81, 45], ['lecture_hall', 86, 34],
  ['quad', 85, 47], ['quad', 82, 37], ['union', 84, 51], ['rec_center', 77, 42], ['library', 81, 54], ['dorm', 89, 51, 1], ['greek_house', 86, 32], ['poboy', 82, 42],
  ['health_center', 81, 51], ['live_oak', 83, 43], ['live_oak', 86, 43], ['live_oak', 82, 48], ['live_oak', 87, 48], ['live_oak', 89, 54], ['azalea', 85, 43]
];

/**
 * Build the campus on the current game (a fresh seed-42 game at 96): every catalog row unlocked, cash set, the layout placed through
 * buildings.place / placeRun (the UI's own validation), `days` days run so everything finishes, enrolment raised to `students`, the agents
 * regenerated. Returns the placement log (a line per row; "REFUSED" marks one that did not fit).
 */
export function buildLifeCampus(BSU, opts) {
  opts = opts || {};
  var s = BSU.state, B = BSU.buildings, W = BSU.MAP.W, log = [], layout = opts.layout;
  BSU.progress.unlocked = function () { return true; }; BSU.progress.unlockOk = function () { return true; };
  s.economy.cash = 1e9;
  function near(id, x, y, rot) {
    for (var r = 0; r <= 6; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      var c = B.canPlace(s, id, x + dx, y + dy, { rot: rot || 0, ignoreCash: true });
      if (c && c.ok) { var p = B.place(s, id, x + dx, y + dy, { rot: rot || 0 }); if (p && p.ok) { log.push(id + '@' + (x + dx) + ',' + (y + dy)); return p; } }
    }
    log.push(id + ' REFUSED near ' + x + ',' + y); return null;
  }
  function line(x0, y0, x1, y1) { var t = [], dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0), x = x0, y = y0; t.push(y * W + x); while (x !== x1 || y !== y1) { if (x !== x1) x += dx; else y += dy; t.push(y * W + x); } return t; }
  layout.forEach(function (q) { if (q[0] === 'path' || q[0] === 'road') { var r = B.placeRun(s, q[0], line(q[1], q[2], q[3], q[4]), {}); if (!r || !r.ok) log.push(q[0] + ' run REFUSED'); } else near(q[0], q[1], q[2], q[3]); });
  BSU.headless.fastForwardDays(opts.days || 30);
  var want = opts.students || 1000;
  if (s.economy.students < want) BSU.economy.addStudents(s, want - s.economy.students, 'qa');
  BSU.agents.regenerate(s);
  return log;
}

/**
 * Where the students are right now: {n (present), out (outdoors), inside, moving, standing, tiles (distinct tiles holding a student outdoors),
 * blocks (distinct 5 × 5-tile blocks), busiest "tx,ty xN", near3 / share3 (the outdoor students within 3 tiles of the single busiest tile, and
 * their share), onLawn (standing on a Quad Lawn tile), where {building#id | 'lawn' | 'open': standing students}, homes / classes {building id: agents}}.
 */
export function census(BSU) {
  var s = BSU.state, W = BSU.MAP.W, A = [], k, a;
  for (k = 0; k < s.agents.length; k++) { a = s.agents[k]; if (a && a.state !== 'GONE' && !a.arrival) A.push(a); }
  var out = A.filter(function (q) { return !q.inside && !q.aboard; });
  var tiles = {}, blocks = {}, nT = 0, nB = 0, busy = -1, bn = 0;
  out.forEach(function (q) { var i = (q.ty | 0) * W + (q.tx | 0); if (!tiles[i]) { tiles[i] = 0; nT++; } tiles[i]++; if (tiles[i] > bn) { bn = tiles[i]; busy = i; } var bk = ((q.ty / 5) | 0) * 100 + ((q.tx / 5) | 0); if (!blocks[bk]) { blocks[bk] = 1; nB++; } });
  var bx = busy % W, by = (busy / W) | 0;
  var near3 = out.filter(function (q) { return Math.max(Math.abs((q.tx | 0) - bx), Math.abs((q.ty | 0) - by)) <= 3; }).length;
  var moving = out.filter(function (q) { return q.step > 0.001; }).length, still = out.filter(function (q) { return !(q.step > 0.001); });
  var where = {}, onLawn = 0;
  still.forEach(function (q) {
    var i = (q.ty | 0) * W + (q.tx | 0), o = s.tiles.owner[i], ob = o >= 0 ? s.buildings[o] : null, key;
    if (ob && ob.type === 'quad') { key = 'lawn'; onLawn++; }
    else {
      var best = null, bd = 1e9;
      s.buildings.forEach(function (b) { if (!b) return; var dx = Math.max(b.tx - q.tx, 0, q.tx - (b.tx + b.w)), dy = Math.max(b.ty - q.ty, 0, q.ty - (b.ty + b.h)), d = Math.max(dx, dy); if (d < bd) { bd = d; best = b; } });
      key = best && bd <= 2.5 ? best.type + '#' + best.id : 'open';
    }
    where[key] = (where[key] || 0) + 1;
  });
  var homes = {}, classes = {};
  A.forEach(function (q) { homes[q.home] = (homes[q.home] || 0) + 1; classes[q.cls] = (classes[q.cls] || 0) + 1; });
  return { n: A.length, out: out.length, inside: A.length - out.length, moving: moving, standing: still.length, tiles: nT, blocks: nB, busiest: bx + ',' + by + ' x' + bn, near3: near3, share3: out.length ? near3 / out.length : 0, onLawn: onLawn, where: where, homes: homes, classes: classes };
}

/** run `cycles` whole sky days tick by tick and average the census over every tick → {out, inside, moving, standing, tiles, blocks, share3, onLawn, byPhase: {DAWN: {…}, …}, ticks} */
export function censusMean(BSU, cycles, censusFn) {
  var s = BSU.state, N = ['DAWN', 'DAY', 'GOLDEN', 'DUSK', 'NIGHT'], acc = {}, all = { k: 0, out: 0, inside: 0, moving: 0, standing: 0, tiles: 0, blocks: 0, share3: 0, k3: 0, onLawn: 0 };
  var add = function (q, m) { q.k++; q.out += m.out; q.inside += m.inside; q.moving += m.moving; q.standing += m.standing; q.tiles += m.tiles; q.blocks += m.blocks; q.onLawn += m.onLawn; if (m.out >= 5) { q.share3 += m.share3; q.k3++; } };
  for (var t = 0; t < 300 * cycles; t++) {
    var m = censusFn(BSU), p = N[s.sky.phase];
    if (!acc[p]) acc[p] = { k: 0, out: 0, inside: 0, moving: 0, standing: 0, tiles: 0, blocks: 0, share3: 0, k3: 0, onLawn: 0 };
    add(acc[p], m); add(all, m);
    BSU.headless.tick(1);
  }
  var fin = function (q) { return { out: q.out / q.k, inside: q.inside / q.k, moving: q.moving / q.k, standing: q.standing / q.k, tiles: q.tiles / q.k, blocks: q.blocks / q.k, share3: q.k3 ? q.share3 / q.k3 : 0, onLawn: q.onLawn / q.k }; };
  var res = fin(all); res.byPhase = {}; res.ticks = all.k;
  N.forEach(function (p) { if (acc[p]) res.byPhase[p] = fin(acc[p]); });
  return res;
}
