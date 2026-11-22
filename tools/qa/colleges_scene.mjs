#!/usr/bin/env node
// Colleges and venues pass: every one of the 23 new buildings on one campus in real Chrome (seed 42 at 96), shot at zoom 1 and zoom 2, the four
// rotations of the three yard-prop rows (a contact sheet), the two new Build tabs with a college's card (its Programs list), and one built college's
// inspect card. About eight shots into tools/qa/out.
//
//   node tools/qa/colleges_scene.mjs [--strict] [--index path] [--tag after] [--out dir]
//
// --strict exits 1 unless: all 23 place, no BSU error or console error, every new row has its Build card thumbnail, the Colleges and Arts & Venues tabs
// show with at most 12 cards each, the Programs list names every department of the card's row (Build card and built card), every row bakes at both
// masters in all four rotations, and the buildings read apart (no two baked sprites identical). Scaffolding, not play: cash, g.unlockAll(), the campus
// packer (g.buildCampus), constructions finished by fast-forwarded days.
import { openGame, parseArgs, DEFAULT_OUT, resolveIndex, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), {
  index: { type: 'str', def: '' }, tag: { type: 'str', def: 'after' }, out: { type: 'str', def: DEFAULT_OUT },
  strict: { type: 'bool', def: false }, width: { type: 'num', def: 1440 }, height: { type: 'num', def: 900 },
});
const COLLEGES = ['univ_college', 'online_center', 'business_college', 'education_college', 'masscomm_school', 'humanities_college', 'art_college', 'music_college', 'ag_college', 'science_college', 'honors_college', 'grad_school', 'rotc_armory', 'law_center', 'vet_school'];
const VENUES = ['concert_hall', 'theatre', 'band_hall', 'art_gallery', 'vet_hospital', 'nat_museum', 'computer_lab', 'ag_greenhouses'];
const NEW = COLLEGES.concat(VENUES), SPECIAL = ['rotc_armory', 'vet_hospital', 'ag_greenhouses'];
const TAG = args.tag;
killStrays();
const g = await openGame({ index: resolveIndex(args.index), width: args.width, height: args.height, size: 96, seed: 42, outDir: args.out, noGuard: true });
let problems = 0;
const bad = (m) => { problems++; console.log('  PROBLEM: ' + m); };
const must = (cond, m) => { if (args.strict && !cond) bad(m); else if (!cond) console.log('  note: ' + m); return cond; };
const shot = async (name) => { await sleep(250); const p = await g.shot(`colleges-${TAG}-${name}`); console.log('  shot ' + p.split('/').slice(-1)[0]); };
const mark = await g.mark();

console.log('== the campus: 23 new buildings plus three dorms');
await g.cash(1e10); await g.unlockAll();
const built = await g.buildCampus({ target: 30, core: ['dorm', 'dorm', 'dining_hall'].concat(COLLEGES, VENUES), fill: [], days: 60, students: 3000 });
const have = await g.eval(`(function () { var c = {}; BSU.state.buildings.filter(Boolean).forEach(function (b) { c[b.type] = (c[b.type] || 0) + 1; }); return c; })()`);
const missing = NEW.filter((id) => !have[id]);
console.log('  placed ' + (NEW.length - missing.length) + ' of 23' + (missing.length ? ' (missing ' + missing.join(', ') + '; ' + missing.map((m) => built.refused[m]).join(' | ') + ')' : ''));
must(missing.length === 0, 'all 23 new buildings place on the campus (missing: ' + missing.join(', ') + ')');
await g.eval(`(function () { BSU.state.buildings.filter(Boolean).forEach(function (b) { if (b.built < 1) b.built = 1; }); BSU.headless.fastForwardDays(3); return true; })()`);

// frame on the colleges (z2), the venues (z2), then everything (z1)
const centroid = (ids) => g.eval(`(function () { var ids = ${JSON.stringify(ids)}, n = 0, x = 0, y = 0; BSU.state.buildings.filter(Boolean).forEach(function (b) { if (ids.indexOf(b.type) >= 0) { n++; x += b.tx + b.w / 2; y += b.ty + b.h / 2; } }); return { x: x / Math.max(1, n), y: y / Math.max(1, n), n: n }; })()`);
await g.clearUi();
await g.frameCampus(1, { keepOnMap: false }); await g.waitBake(); await shot('1-campus-z1');
for (const [name, ids] of [['2-colleges-z2', COLLEGES], ['3-venues-z2', VENUES]]) {
  const c = await centroid(ids);
  await g.setZoom(2); await g.panToTile(c.x, c.y); await g.settleCamera(); await g.waitBake(); await shot(name);
}

console.log('== the four rotations of the three yard-prop rows (a contact sheet from the sprite atlas at master 2)');
const sheet = await g.eval(`(function () {
  var SPR = BSU.SPR, S = BSU.sprites, ids = ${JSON.stringify(SPECIAL)}, out = { cells: 0, empty: 0, same: 0 }, seen = {};
  var cv = document.createElement('canvas'); cv.id = 'qa-sheet'; cv.width = 1400; cv.height = 900;
  cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#7FBF3C';
  var c = cv.getContext('2d'); c.fillStyle = '#6E9A38'; c.fillRect(0, 0, cv.width, cv.height);
  ids.forEach(function (id, r) {
    [[false, false], [false, true], [true, false], [true, true]].forEach(function (rf, k) {
      var spec = id + (rf[0] ? ':r' : ''), v = rf[1] ? SPR.FRONT_L : 0, e = S.get(spec, v, 0, 2);
      out.cells++;
      if (!e || !e.canvas) { out.empty++; return; }
      var x = 20 + k * 345, y = 20 + r * 290; c.drawImage(e.canvas, x, y);
      c.fillStyle = '#fff'; c.font = '14px sans-serif'; c.fillText(id + (rf[0] ? ' rot' : '') + (rf[1] ? ' door SW' : ''), x, y + 12);
      var key = e.canvas.toDataURL ? e.canvas.toDataURL().length + ':' + (e.canvas.toDataURL().slice(-60)) : spec + v;
      if (seen[key]) out.same++; seen[key] = 1;
    });
  });
  document.body.appendChild(cv); return out;
})()`);
console.log('  cells ' + sheet.cells + ', empty ' + sheet.empty + ', identical to another ' + sheet.same);
must(sheet.empty === 0, 'every rotation of the three yard-prop rows bakes');
must(sheet.same === 0, 'the four rotations of each yard-prop row are four different sprites');
await shot('4-rotations');
await g.eval(`(function () { var e = document.getElementById('qa-sheet'); if (e) e.remove(); return true; })()`);

console.log('== every new row bakes at both masters, in four rotations; the sprites differ');
const bake = await g.eval(`(function () {
  var SPR = BSU.SPR, S = BSU.sprites, ids = ${JSON.stringify(NEW)}, bad = [], digests = {}, dup = [];
  ids.forEach(function (id) { [1, 2].forEach(function (z) { [0, 1].forEach(function (r) { [0, SPR.FRONT_L].forEach(function (v) {
    var e = S.get(id + (r ? ':r' : ''), v, 0, z); if (!e || !e.canvas || !(e.sw > 0)) bad.push(id + ' z' + z + ' r' + r + ' v' + v);
    else if (z === 2 && !r && !v) { var d = e.canvas.toDataURL(); var k = d.length + d.slice(-80); if (digests[k]) dup.push(id + '=' + digests[k]); digests[k] = id; }
  }); }); }); });
  return { bad: bad, dup: dup };
})()`);
console.log('  failed bakes ' + bake.bad.length + (bake.bad.length ? ' ' + bake.bad.slice(0, 5).join(', ') : '') + '; identical pairs ' + bake.dup.length + (bake.dup.length ? ' ' + bake.dup.join(', ') : ''));
must(bake.bad.length === 0, 'every new row bakes at both masters in four rotations');
must(bake.dup.length === 0, 'no two new buildings bake to the same sprite');

console.log('== the Build sheet: the two new tabs, the Programs list on a college card');
await g.eval(`(function () { var s = BSU.state; for (var t of BSU.data.tabs) s.ui.tabsIntroduced[t.id] = true; return true; })()`);
const tabs = await g.eval(`BSU.data.tabs.map(function (t) { return [t.id, t.rows.length]; })`);
const big = tabs.filter((t) => t[1] > (t[0] === 'swamp' ? 14 : 12));
must(big.length === 0, 'no tab holds more than 12 cards (Swamp 14 as before): ' + JSON.stringify(big));
for (const [tab, focus, name] of [['colleges', 'humanities_college', '5-sheet-colleges'], ['arts', 'nat_museum', '6-sheet-arts-venues']]) {
  await g.eval(`(BSU.ui.openBuildMenu(BSU.state, { tab: ${JSON.stringify(tab)}, focus: ${JSON.stringify(focus)} }), true)`); await sleep(700);
  const info = await g.eval(`(function () {
    var tabs = Array.from(document.querySelectorAll('.bm-tab, #bm-tabs .tab, .bm-tabs .tab')).map(function (e) { return e.textContent.trim(); });
    var cards = document.querySelectorAll('.bm-card').length, p = document.getElementById('bm-programs');
    var thumbs = Array.from(document.querySelectorAll('.bm-card canvas')).filter(function (c) { return c.width > 0; }).length;
    var locked = Array.from(document.querySelectorAll('.bm-card.locked')).length;
    return { tabs: tabs, cards: cards, thumbs: thumbs, locked: locked, programs: p ? p.textContent : null, tab: BSU.state.ui.paletteTab };
  })()`);
  console.log('  ' + tab + ': tab ' + info.tab + ', ' + info.cards + ' cards, ' + info.thumbs + ' thumbnails' + (info.programs ? ', programs: ' + info.programs.split(' · ').length : ''));
  must(info.tab === tab, 'the sheet opens on the ' + tab + ' tab');
  must(info.cards > 0 && info.cards <= 12, 'the ' + tab + ' tab shows 1 to 12 cards (' + info.cards + ')');
  must(info.thumbs >= info.cards, 'every ' + tab + ' card has its thumbnail (' + info.thumbs + ' of ' + info.cards + ')');
  if (tab === 'colleges') must(!!info.programs && info.programs.split(' · ').length === 23, 'the Humanities card lists its 23 programs by name');
  await shot(name);
}
await g.eval(`(BSU.ui.closeBuildMenu && BSU.ui.closeBuildMenu(), true)`);
await g.clearUi();

console.log('== a built college\'s card');
const hid = await g.eval(`(function () { var b = BSU.state.buildings.filter(Boolean).filter(function (b) { return b.type === 'business_college'; })[0]; return b ? b.id : -1; })()`);
if (hid >= 0) {
  const c = await centroid(['business_college']);
  await g.panToTile(c.x, c.y); await g.settleCamera();
  await g.eval(`(BSU.ui.inspect(BSU.state, { kind: 'building', id: ${hid} }), true)`); await sleep(500);
  const card = await g.eval(`(function () { var p = document.getElementById('insp-programs'); return p ? p.textContent : null; })()`);
  console.log('  Programs on the card: ' + (card ? card.split(' · ').length + ' (' + card.slice(0, 60) + '...)' : 'none'));
  must(!!card && card.split(' · ').length === 8, 'the College of Business card lists its 8 programs');
  await shot('7-built-card');
} else must(false, 'a College of Business stands to inspect');

const errs = await g.errorsSince(mark);
console.log('  console errors ' + JSON.stringify(errs).slice(0, 300));
must(errs.length === 0, 'no BSU error and no console error');
await g.close();
console.log(problems ? `\n${problems} problem(s)` : '\nOK');
process.exit(args.strict && problems ? 1 : 0);
