#!/usr/bin/env node
// More buildings and upgrades pass: one campus with the ten new buildings and decorations at zoom 1 and zoom 2, each of the seven upgradeable buildings
// before and after its upgrade side by side at zoom 2, the Colleges tab with all 15 cards, and one inspect card showing an upgrade's gains line.
// About twelve shots into tools/qa/out.
//
//   node tools/qa/expansion_scene.mjs [--strict] [--index path] [--tag after] [--out dir]
//
// --strict exits 1 unless: all ten new buildings place (the Parade Ground as a dragged block), no BSU error or console error, every new row bakes at both
// masters in four rotations to a sprite of its own, each of the seven upgraded buildings bakes a tier sprite that differs from its base, the Colleges tab
// holds all 15 cards with thumbnails, and the inspect card carries "Upgrade to X · $price", a gains line with arrows, "closed while it upgrades".
// Scaffolding, not play: cash, g.unlockAll(), the campus packer, constructions finished by fast-forwarded days.
import { openGame, parseArgs, DEFAULT_OUT, resolveIndex, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), {
  index: { type: 'str', def: '' }, tag: { type: 'str', def: 'after' }, out: { type: 'str', def: DEFAULT_OUT },
  strict: { type: 'bool', def: false }, width: { type: 'num', def: 1440 }, height: { type: 'num', def: 900 },
});
const NEW = ['campus_store', 'arena', 'golf_course', 'recycling', 'cistern', 'bus_depot', 'tiger_statue', 'locomotive', 'trainer_jet', 'parade'];
const SEVEN = ['tiger_habitat', 'library', 'dining_hall', 'rec_center', 'health_center', 'parking', 'union'];
const TAG = args.tag;
killStrays();
const g = await openGame({ index: resolveIndex(args.index), width: args.width, height: args.height, size: 96, seed: 42, outDir: args.out, noGuard: true });
let problems = 0;
const bad = (m) => { problems++; console.log('  PROBLEM: ' + m); };
const must = (cond, m) => { if (args.strict && !cond) bad(m); else if (!cond) console.log('  note: ' + m); return cond; };
const shot = async (name) => { await sleep(250); const p = await g.shot(`expansion-${TAG}-${name}`); console.log('  shot ' + p.split('/').slice(-1)[0]); };
const mark = await g.mark();

// a contact sheet from the sprite atlas at master 2 (zoom 2): cells of [id, variant, label] drawn scaled to fit; rows x cols given
const sheet = async (cells, cols, rows, name) => {
  const r = await g.eval(`(function () {
    var S = BSU.sprites, cells = ${JSON.stringify(cells)}, cols = ${cols}, rows = ${rows}, empty = 0;
    var cv = document.createElement('canvas'); cv.id = 'qa-sheet'; cv.width = 1440; cv.height = 900;
    cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
    var c = cv.getContext('2d'); c.fillStyle = '#7FA347'; c.fillRect(0, 0, cv.width, cv.height);
    var cw = cv.width / cols, ch = cv.height / rows;
    cells.forEach(function (cell, k) {
      var e = S.get(cell[0], cell[1], 0, 2), x0 = (k % cols) * cw, y0 = Math.floor(k / cols) * ch;
      c.strokeStyle = 'rgba(255,255,255,.35)'; c.strokeRect(x0 + 2, y0 + 2, cw - 4, ch - 4);
      if (!e || !e.canvas) { empty++; return; }
      var w = e.canvas.width, h = e.canvas.height, sc = Math.min((cw - 24) / w, (ch - 44) / h, 1);
      c.drawImage(e.canvas, x0 + (cw - w * sc) / 2, y0 + 30 + (ch - 44 - h * sc) / 2, w * sc, h * sc);
      c.fillStyle = '#fff'; c.font = 'bold 15px sans-serif'; c.fillText(cell[2], x0 + 12, y0 + 22);
    });
    document.body.appendChild(cv); return { empty: empty, n: cells.length };
  })()`);
  must(r.empty === 0, 'every cell of the ' + name + ' sheet bakes');
  await shot(name);
  await g.eval(`(function () { var e = document.getElementById('qa-sheet'); if (e) e.remove(); return true; })()`);
};

console.log('== the campus: the ten new buildings, then the Parade Ground as a dragged block');
await g.cash(1e10); await g.unlockAll();
const built = await g.buildCampus({ target: 24, core: ['dorm', 'dorm', 'dining_hall', 'rotc_armory'].concat(NEW.filter((id) => id !== 'parade')), fill: [], days: 60, students: 3000 });
const parade = await g.eval(`(function () {
  var s = BSU.state, B = BSU.buildings, H = BSU.headless, sp = H.findSpot('rotc_armory'); if (!sp) return { ok: false, reason: 'no 4x4 spot' };
  var run = []; for (var y = sp.y; y < sp.y + 4; y++) for (var x = sp.x; x < sp.x + 6; x++) run.push(BSU.idx(x, y));
  var r = B.placeRun(s, 'parade', run, {}); return { ok: !!r.ok, blocks: r.blocks, placed: r.placed, reason: r.reason || '' };
})()`);
console.log('  Parade Ground block: ' + JSON.stringify(parade));
const have = await g.eval(`(function () { var c = {}; BSU.state.buildings.filter(Boolean).forEach(function (b) { c[b.type] = (c[b.type] || 0) + 1; }); return c; })()`);
const missing = NEW.filter((id) => !have[id]);
console.log('  placed ' + (NEW.length - missing.length) + ' of 10' + (missing.length ? ' (missing ' + missing.join(', ') + '; ' + missing.map((m) => built.refused[m]).join(' | ') + ')' : ''));
must(missing.length === 0, 'all ten new buildings place (missing: ' + missing.join(', ') + ')');
must(parade.ok && parade.blocks >= 4, 'the Parade Ground drags out as a block of 2 × 2 units');
await g.eval(`(function () { BSU.state.buildings.filter(Boolean).forEach(function (b) { if (b.built < 1) b.built = 1; }); BSU.headless.fastForwardDays(3); return true; })()`);

const centroid = (ids) => g.eval(`(function () { var ids = ${JSON.stringify(ids)}, n = 0, x = 0, y = 0; BSU.state.buildings.filter(Boolean).forEach(function (b) { if (ids.indexOf(b.type) >= 0) { n++; x += b.tx + b.w / 2; y += b.ty + b.h / 2; } }); return { x: n ? x / n : 48, y: n ? y / n : 48, n: n }; })()`);
await g.clearUi();
await g.frameCampus(1, { keepOnMap: false }); await g.waitBake(); await shot('1-campus-z1');
for (const [name, ids] of [['2-new-buildings-z2', ['campus_store', 'arena', 'recycling', 'cistern', 'bus_depot']], ['3-decorations-z2', ['tiger_statue', 'locomotive', 'trainer_jet', 'parade']], ['4-golf-z1', ['golf_course']]]) {
  const c = await centroid(ids);
  await g.setZoom(name.endsWith('z1') ? 1 : 2); await g.panToTile(c.x, c.y); await g.settleCamera(); await g.waitBake(); await shot(name);
}

await sheet(NEW.map((id) => [id, 0, id.replace(/_/g, ' ') + ' (' + 'zoom 2' + ')']), 5, 2, '3b-sheet-new-z2');
await sheet([['locomotive', 0, 'locomotive'], ['locomotive:r', 0, 'locomotive rotated'], ['tiger_statue', 0, 'tiger statue'], ['trainer_jet', 0, 'trainer jet'], ['bus_depot', 0, 'bus depot'], ['bus_depot', 256, 'bus depot, door SW'], ['cistern', 0, 'cistern'], ['golf_course:r', 0, 'golf course rotated'], ['parade', 0, 'parade ground unit'], ['arena', 256, 'arena, door SW']], 5, 2, '3c-sheet-new-rotations');
console.log('== the seven upgradeable buildings, before and after, side by side');
await g.eval(`(function () { for (var k = 0; k < 8; k++) { var s = BSU.land.sections(BSU.state).filter(function (x) { return x.forSale && !x.owned; }); if (!s.length) break; BSU.headless.charter(s[0].id, true); } return true; })()`);   // more ground for the pairs
const pairs = await g.eval(`(function () {
  var s = BSU.state, B = BSU.buildings, out = {}, ids = ${JSON.stringify(SEVEN)}, W = BSU.MAP.W, Hh = BSU.MAP.H, F = s.plot.founders;
  function near(id, cx, cy, maxD) {   // the legal anchor nearest (cx, cy) within maxD tiles
    var best = null, bd = 1e9;
    for (var y = 3; y < Hh - 3; y++) for (var x = 3; x < W - 3; x++) {
      var d = Math.abs(x - cx) + Math.abs(y - cy); if (d >= bd || d > maxD) continue;
      var q = B.canPlace(s, id, x, y, { rot: 0, ignoreCash: true }); if (q && q.ok) { best = { x: x, y: y }; bd = d; }
    }
    return best;
  }
  ids.forEach(function (id) {
    var sp = near(id, F.tx, F.ty, 200); if (!sp) { out[id] = { ok: false, reason: 'no spot' }; return; }
    var a = B.place(s, id, sp.x, sp.y, { rot: 0 }); if (!a.ok) { out[id] = { ok: false, reason: a.reason }; return; }
    var A = B.get(s, a.id), sp2 = near(id, A.tx + A.w + 3, A.ty, 26);
    var got = sp2 ? B.place(s, id, sp2.x, sp2.y, { rot: 0 }) : null;
    out[id] = got && got.ok ? { ok: true, a: a.id, b: got.id } : { ok: false, reason: 'no neighbour spot' };
  });
  return out;
})()`);
await g.eval(`(function () { BSU.state.buildings.filter(Boolean).forEach(function (b) { if (b.built < 1) b.built = 1; }); BSU.headless.fastForwardDays(6); BSU.state.buildings.filter(Boolean).forEach(function (b) { if (b.built < 1) b.built = 1; }); return true; })()`);
let n = 0;
for (const id of SEVEN) {
  const p = pairs[id];
  if (!must(p && p.ok, id + ' pair places (' + (p && p.reason) + ')')) continue;
  const up = await g.eval(`(function () { var r = BSU.buildings.upgrade(BSU.state, ${p.b}); return { ok: r.ok, cost: r.cost, reason: r.reason || '' }; })()`);
  must(up.ok, id + ' upgrade is accepted (' + up.reason + ')');
}
await g.eval(`(function () { BSU.headless.fastForwardDays(12); BSU.state.buildings.filter(Boolean).forEach(function (b) { if (b.built < 1) b.built = 1; }); return true; })()`);
await g.setZoom(2);
for (const id of SEVEN) {
  const p = pairs[id]; if (!p || !p.ok) continue;
  const info = await g.eval(`(function () { var A = BSU.buildings.get(BSU.state, ${p.a}), Bb = BSU.buildings.get(BSU.state, ${p.b}); return { x: (A.tx + A.w / 2 + Bb.tx + Bb.w / 2) / 2, y: (A.ty + A.h / 2 + Bb.ty + Bb.h / 2) / 2, ta: A.tier, tb: Bb.tier, nb: Bb.name }; })()`);
  must(info.ta === 0 && info.tb === 1, id + ': left stays tier 0, right is tier 1 (' + info.nb + ')');
  await g.clearUi(); await g.panToTile(info.x, info.y); await g.settleCamera(); await g.waitBake(); await g.clearUi(); await shot(`${5 + n++}-${id}-before-after`);
}

const T1 = 1 << 5;
await sheet([['tiger_habitat', 0, 'Tiger Habitat'], ['tiger_habitat', T1, "Roux's Grand Habitat"], ['library', 0, 'Library'], ['library', T1, 'Research Library'], ['dining_hall', 0, 'Dining Hall'], ['dining_hall', T1, 'Food Court'], ['dining_hall', 2 << 5, 'Culinary Pavilion'], ['union', 0, 'Student Union']], 4, 2, '11a-sheet-tiers-1');
await sheet([['union', T1, 'Student Union Commons'], ['rec_center', 0, 'Rec Center'], ['rec_center', T1, 'Wellness Complex'], ['health_center', 0, 'Health Center'], ['health_center', T1, 'Student Clinic'], ['parking', 0, 'Parking Lot'], ['parking', T1, 'Parking Garage'], ['parking', 2 << 5, 'Parking Tower']], 4, 2, '11b-sheet-tiers-2');
console.log('== every new row bakes at both masters, in four rotations; the tiers draw differently');
const bake = await g.eval(`(function () {
  var SPR = BSU.SPR, S = BSU.sprites, ids = ${JSON.stringify(NEW)}, bad = [], digests = {}, dup = [];
  ids.forEach(function (id) { [1, 2].forEach(function (z) { [0, 1].forEach(function (r) { [0, SPR.FRONT_L].forEach(function (v) {
    var e = S.get(id + (r ? ':r' : ''), v, 0, z); if (!e || !e.canvas || !(e.sw > 0)) bad.push(id + ' z' + z + ' r' + r + ' v' + v);
    else if (z === 2 && !r && !v) { var d = e.canvas.toDataURL(); var k = d.length + d.slice(-80); if (digests[k]) dup.push(id + '=' + digests[k]); digests[k] = id; }
  }); }); }); });
  var same = [];
  ${JSON.stringify(SEVEN)}.forEach(function (id) { var a = S.get(id, 0, 0, 2), b = S.get(id, 1 << SPR.TIER_SHIFT, 0, 2); if (!a || !b || !a.canvas || !b.canvas) { same.push(id + ' (no bake)'); return; } if (a.canvas.toDataURL() === b.canvas.toDataURL()) same.push(id); });
  return { bad: bad, dup: dup, same: same };
})()`);
console.log('  failed bakes ' + bake.bad.length + '; identical pairs ' + bake.dup.length + (bake.dup.length ? ' ' + bake.dup.join(', ') : '') + '; tier sprites equal to their base: ' + (bake.same.join(', ') || 'none'));
must(bake.bad.length === 0, 'every new row bakes at both masters in four rotations');
must(bake.dup.length === 0, 'no two new buildings bake to the same sprite');
must(bake.same.length === 0, 'each upgraded building draws differently from its base');

console.log('== the Build sheet: the Colleges tab with all 15 cards');
await g.eval(`(function () { var s = BSU.state; for (var t of BSU.data.tabs) s.ui.tabsIntroduced[t.id] = true; return true; })()`);
await g.eval(`(BSU.ui.openBuildMenu(BSU.state, { tab: 'colleges', focus: 'vet_school' }), true)`); await sleep(800);
const info = await g.eval(`(function () {
  var cards = document.querySelectorAll('.bm-card').length, thumbs = Array.from(document.querySelectorAll('.bm-card canvas')).filter(function (c) { return c.width > 0; }).length;
  return { cards: cards, thumbs: thumbs, tab: BSU.state.ui.paletteTab, rows: BSU.data.tabs.find(function (t) { return t.id === 'colleges'; }).rows.length };
})()`);
console.log('  colleges: tab ' + info.tab + ', ' + info.cards + ' cards, ' + info.thumbs + ' thumbnails (data rows ' + info.rows + ')');
must(info.tab === 'colleges' && info.rows === 15 && info.cards === 15, 'the Colleges tab shows all 15 cards (' + info.cards + ')');
must(info.thumbs >= info.cards, 'every card has its thumbnail (' + info.thumbs + ' of ' + info.cards + ')');
await shot('12-sheet-colleges');
await g.eval(`(BSU.ui.openBuildMenu(BSU.state, { tab: 'grounds', focus: 'locomotive' }), true)`); await sleep(700);
await shot('13-sheet-grounds');
await g.eval(`(BSU.ui.closeBuildMenu && BSU.ui.closeBuildMenu(), true)`); await g.clearUi();

console.log('== the inspect card of an upgradeable building: the gains line');
const dh = await g.eval(`(function () { var b = BSU.state.buildings.filter(Boolean).filter(function (b) { return b.type === 'dining_hall' && b.tier === 0; })[0]; if (!b) { b = BSU.state.buildings.filter(Boolean).filter(function (b) { return b.type === 'dining_hall'; })[0]; } return b ? { id: b.id, x: b.tx + b.w / 2, y: b.ty + b.h / 2, tier: b.tier } : null; })()`);
if (dh) {
  await g.panToTile(dh.x, dh.y); await g.settleCamera();
  await g.eval(`(BSU.ui.inspect(BSU.state, { kind: 'building', id: ${dh.id} }), true)`); await sleep(600);
  const card = await g.eval(`(function () { var b = document.getElementById('btn-insp-upgrade'), up = document.getElementById('insp-upgrade'); return { btn: b ? b.textContent : null, text: up ? up.textContent : null, gain: (document.querySelector('#insp-upgrade .up-gain') || {}).textContent || null }; })()`);
  console.log('  button: ' + card.btn + '\n  gains: ' + card.gain);
  must(!!card.btn && /^Upgrade to /.test(card.btn) && /\$/.test(card.btn), 'the card has "Upgrade to X · $price" (' + card.btn + ')');
  must(!!card.gain && /→/.test(card.gain) && /closed while it upgrades/.test(card.gain) && /days? to build/.test(card.gain), 'the gains line states the real gains, the days and that it closes (' + card.gain + ')');
  await shot('14-inspect-gains');
} else must(false, 'a Dining Hall stands to inspect');

const errs = await g.errorsSince(mark);
console.log('  console errors ' + JSON.stringify(errs).slice(0, 300));
must(errs.length === 0, 'no BSU error and no console error');
await g.close();
console.log(problems ? `\n${problems} problem(s)` : '\nOK');
process.exit(args.strict && problems ? 1 : 0);
