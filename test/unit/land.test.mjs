// Unit test for src/js/land.js (docs/PLAN_PATHS_LAND.md Track L2, the Land Office): section geometry at 96 and 64, the adjacency
// rule, pricing by counts, the prestige gates, buy / ledger / event / ticker / card, the refusal on unchartered tiles for a building
// and a drag, tie routing that avoids unchartered land, the save round-trip and a v2 doc without `charter`, the overlay pass.
// Usage: node test/unit/land.test.mjs   (exit 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
for (const f of manifest) { const p = join(root, 'src', 'js', f); if (existsSync(p)) vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
const BSU = win.BSU;
const S = BSU.session, H = BSU.headless, B = BSU.buildings, L = BSU.land, P = BSU.progress, R = BSU.render, T = BSU.T, SURF = BSU.SURF, PL = BSU.params.land;
const errors = () => (BSU.errors ? BSU.errors.size : 0);
const W = () => BSU.MAP.W;
const idx = (x, y) => y * W() + x;

ok(manifest.indexOf('land.js') === manifest.indexOf('issues.js') + 1 && manifest.indexOf('land.js') > manifest.indexOf('buildings.js'), 'land.js follows buildings.js and issues.js in the manifest (issues.test pins issues.js right after buildings.js)');
ok(L && typeof L.sections === 'function' && typeof L.isChartered === 'function' && typeof L.quote === 'function' && typeof L.buy === 'function' && typeof L.nearestSection === 'function', 'BSU.land API');
ok(BSU.EV.LAND_CHARTERED === 'land:chartered' && BSU.MILESTONES.indexOf('landBaron') >= 0, 'land:chartered registered; landBaron milestone id');
ok(PL && PL.sectionSize === 16 && PL.base === 400000 && PL.perDry === 9000 && PL.perHigh === 20000 && PL.perMarsh === 2000, 'params.land pricing');
eq(L.priceOf({ dry: 100, high: 10, marsh: 50 }), 400000 + 900000 + 200000 + 100000, 'priceOf = base + per-tile');
ok(L.gateFor(1) === 0 && L.gateFor(2) === 0 && L.gateFor(3) === 20 && L.gateFor(5) === 20 && L.gateFor(6) === 40 && L.gateFor(9) === 40, 'prestige gates: 3rd+ needs 20, 6th+ needs 40');

// --- geometry at 96 ---------------------------------------------------------------------------------------------------
const s = S.newGame({ seed: 42, skipTutorial: true, size: 96 }) || BSU.state;
ok(s && s.world && s.world.W === 96 && s.charter && Array.isArray(s.charter.owned) && s.charter.owned.length === 0, 'new 96 game: state.charter = {owned: []}');
const grid = L.grid(s); ok(grid.cols === 6 && grid.rows === 6 && grid.size === 16, 'a 96 world is a 6 × 6 grid of 16 × 16 cells');
const cells = L.cells(s); eq(cells.length, 36, '36 cells'); eq(cells.filter((c) => c.legacy).length, 16, '16 cells are the charter (the legacy rectangle)');
let secs = L.sections(s);
eq(secs.length, 20, '20 sections outside the charter');
ok(secs.every((x, k) => x.id === k + 1), 'section ids 1..20 in row-major order');
ok(secs.every((x) => x.x1 < s.world.legacy.x0 || x.y1 < s.world.legacy.y0), 'every section lies west or north of the legacy rectangle');
ok(secs.every((x) => x.x1 - x.x0 === 15 && x.y1 - x.y0 === 15), 'every section is 16 × 16');
ok(secs.every((x) => x.counts.dry + x.counts.high + x.counts.marsh + x.counts.water === 256), 'counts cover all 256 tiles');
ok(secs.every((x) => x.price === L.priceOf(x.counts)), 'price per section = base + per-tile by counts');
ok(secs.some((x) => x.counts.marsh > 100) && secs.some((x) => x.counts.high > 0), 'the west strip is swampy, the north strip has high ground');
const leg = s.world.legacy;
ok(L.isChartered(s, leg.x0, leg.y0) && L.isChartered(s, leg.x1, leg.y1) && L.isChartered(s, 60, 60), 'the legacy rectangle is chartered');
ok(!L.isChartered(s, 0, 0) && !L.isChartered(s, 31, 60) && !L.isChartered(s, 60, 31) && !L.isChartered(s, -1, 0) && !L.isChartered(s, 96, 0), 'outside the rectangle / off the map is not');
{ let n = 0; const m = L.mask(s); for (let i = 0; i < m.length; i++) if (m[i]) n++; eq(n, 64 * 64, 'the mask holds exactly the 64 × 64 charter'); }
// adjacency: the sections touching the charter's west (cx 1, cy 2..5) and north (cy 1, cx 2..5) edges are for sale, 8 in all
const forSale = secs.filter((x) => x.forSale);
eq(forSale.length, 8, '8 sections for sale at the start (the ones that share an edge with the charter)');
ok(forSale.every((x) => (x.cx === 1 && x.cy >= 2) || (x.cy === 1 && x.cx >= 2)), 'for-sale sections hug the charter');
ok(secs.filter((x) => !x.forSale).every((x) => x.cx === 0 || x.cy === 0 || (x.cx <= 1 && x.cy <= 1)), 'the outer ring and the corner are not for sale yet');
ok(secs.every((x) => x.gate === 0 && !x.locked), 'no gate on the first purchase');
const at = L.sectionAt(s, 20, 40); ok(at && at.cx === 1 && at.cy === 2 && !L.sectionAt(s, 40, 40), 'sectionAt: (20, 40) → cell (1, 2); the charter → null');
const near = L.nearestSection(s, 34, 44); ok(near && near.forSale && near.cx === 1 && near.cy === 2, 'nearestSection from inside the charter prefers the nearest for-sale one (west, 3 tiles, over north, 13)');
ok(L.nearestSection(s, 5, 5).cx === 0 && L.nearestSection(s, 5, 5).cy === 0, 'nearestSection under a far section is that section');

// --- refusal: a building, a drag, a levee, the preserve paint ------------------------------------------------------
const westSec = secs.find((x) => x.cx === 1 && x.cy === 3);
const ux = westSec.x0 + 6, uy = westSec.y0 + 6;
let r = B.canPlace(s, 'dorm', ux, uy, { rot: 0, ignoreCash: true });
ok(!r.ok && r.reason.indexOf(L.CHARTER_REASON) === 0 && /\$/.test(r.reason) && r.charter && r.charter.id === westSec.id && r.charter.price === westSec.price, 'a dorm on state land: "' + r.reason + '" with r.charter');
ok(/^Charter this section at the Land Office \(\$[\d.,]+[kM]?\)$/.test(r.reason), 'the reason reads "Charter this section at the Land Office ($…)"');
r = B.canPlace(s, 'path', ux, uy, {}); ok(!r.ok && r.charter && r.charter.id === westSec.id, 'a path tile on state land is refused with the charter reason');
r = B.canPlace(s, 'levee', ux, uy, {}); ok(!r.ok && r.charter, 'a levee tile on state land is refused');
r = B.canPlace(s, 'canal', ux, uy, {}); ok(!r.ok && r.charter, 'a canal tile on state land is refused');
{ let mi = -1; for (let y = westSec.y0; y <= westSec.y1 && mi < 0; y++) for (let x = westSec.x0; x <= westSec.x1; x++) if (s.tiles.type[idx(x, y)] === T.MARSH) { mi = idx(x, y); break; }
  ok(mi >= 0, 'a marsh tile in the west section');
  if (mi >= 0) { r = B.canPlace(s, 'preserve', mi % W(), (mi / W()) | 0, {}); ok(!r.ok && r.charter, 'the preserve paint on state marsh is refused'); } }
s.economy.cash = 50e6;
const run = []; for (let k = 0; k < 5; k++) run.push(idx(ux + k, uy));
const pr0 = B.placeRun(s, 'path', run, {});
ok(pr0.placed === 0 && pr0.skipped.length && pr0.skipped[0].reason.indexOf(L.CHARTER_REASON) === 0, 'a path drag onto state land lays nothing (' + (pr0.skipped[0] && pr0.skipped[0].reason) + ')');
ok(s.tiles.surface[run[0]] === SURF.NONE, 'no surface laid');
ok(B.canPlace(s, 'dorm', leg.x0 + 10, leg.y0 + 10, { rot: 0, ignoreCash: true }).reason.indexOf(L.CHARTER_REASON) < 0, 'inside the charter the reason is never the charter one');
ok(L.refusal(s, [idx(leg.x0, leg.y0)]) === null && L.refusal(s, [idx(ux, uy)]).id === westSec.id, 'land.refusal: null inside the charter, the section outside');
eq(s.charter.refusedDay, -1, 'no refusal noted yet');
ok(L.noteRefusal(s) === true && s.charter.refusedDay >= 0 && L.noteRefusal(s) === false, 'noteRefusal once');

// --- quotes, gates, buy, ledger, event, ticker, card ------------------------------------------------------------------
const farSec = secs.find((x) => x.cx === 0 && x.cy === 3);
let q = L.quote(s, farSec.id); ok(!q.ok && /next to/.test(q.reason), 'a section away from the charter: ' + q.reason);
q = L.quote(s, 999); ok(!q.ok && /No such/.test(q.reason), 'unknown id');
s.economy.cash = westSec.price - 1; q = L.quote(s, westSec.id); ok(!q.ok && /cash/.test(q.reason), 'short of cash: ' + q.reason);
s.economy.cash = 50e6; q = L.quote(s, westSec.id); ok(q.ok && q.price === westSec.price && q.gate === 0, 'quote ok with cash, no gate on the 1st');
const events = []; BSU.events.on('land:chartered', (p) => events.push(p));
const cash0 = s.economy.cash, exp0 = s.ledger.month.expense.construction || 0, tick0 = s.ticker.length;
const bought = L.buy(s, westSec.id, {});
ok(bought.ok && bought.n === 1 && bought.price === westSec.price, 'buy ok: ' + JSON.stringify(bought));
eq(s.economy.cash, cash0 - westSec.price, 'cash charged');
eq((s.ledger.month.expense.construction || 0) - exp0, westSec.price, 'the ledger line is a construction expense');
ok(events.length === 1 && events[0].id === westSec.id && events[0].n === 1 && events[0].rect && events[0].rect.x0 === westSec.x0, 'land:chartered fired with the section');
ok(s.ticker.length === tick0 + 1 && /Land Office: section \d+ chartered/.test(s.ticker[s.ticker.length - 1].text), 'a ticker line: ' + s.ticker[s.ticker.length - 1].text);
ok(s.charter.cardSeen === true && s.charter.owned.length === 1 && s.charter.owned[0] === westSec.id, 'the first-purchase card flagged; owned = [id]');
ok(L.isChartered(s, ux, uy) && L.section(s, westSec.id).owned && !L.section(s, westSec.id).forSale, 'the section is chartered now');
ok(!L.buy(s, westSec.id, {}).ok && /Already/.test(L.buy(s, westSec.id, {}).reason), 'cannot buy twice');
r = B.canPlace(s, 'dorm', ux, uy, { rot: 0, ignoreCash: true }); ok(r.reason.indexOf(L.CHARTER_REASON) < 0 && !r.charter, 'after the purchase the dorm is no longer refused for the charter (' + r.reason + ')');
secs = L.sections(s);
ok(secs.find((x) => x.cx === 0 && x.cy === 3).forSale && secs.find((x) => x.cx === 1 && x.cy === 2).forSale, 'the neighbours of the bought section are for sale now (west and north)');
eq(secs.filter((x) => x.forSale).length, 8, '8 for sale: 7 of the original 8 + the new west neighbour (north and south were already for sale)');
// the 2nd is free of gates, the 3rd needs prestige 20, the 6th 40
s.economy.prestige = 5;
const second = secs.find((x) => x.forSale);
ok(L.buy(s, second.id, {}).ok, 'the 2nd purchase has no gate');
secs = L.sections(s); const third = secs.find((x) => x.forSale);
ok(third.gate === 20 && third.locked, 'the 3rd is gated at prestige 20');
q = L.quote(s, third.id); ok(!q.ok && /prestige 20/.test(q.reason), 'quote: ' + q.reason);
ok(!L.buy(s, third.id, {}).ok, 'buy refused by the gate');
s.economy.prestige = 20; ok(L.quote(s, third.id).ok && L.buy(s, third.id, {}).ok, 'the gate opens at prestige 20');
ok(H.charter(L.sections(s).find((x) => x.forSale).id).ok && H.charter(L.sections(s).find((x) => x.forSale).id).ok, 'headless.charter buys the 4th and 5th');
eq(L.count(s), 5, 'five sections owned');
{ const sixth = L.sections(s).find((x) => x.forSale); ok(sixth.gate === 40 && sixth.locked && /prestige 40/.test(L.quote(s, sixth.id).reason), 'the 6th is gated at prestige 40'); ok(H.charter(sixth.id, true).ok && L.count(s) === 6, 'headless.charter(id, true) forces past the gate'); }
const mp = P.milestoneProgress(s, 'landBaron'); ok(mp.progress >= 5 && mp.goal === 5, 'Land Baron progress ' + JSON.stringify(mp));
H.tick(BSU.params.time.ticksPerDay * 2);
ok(P.earned(s, 'landBaron'), 'Land Baron earned at 5 sections');
const fs = L.freeShare(s); ok(fs.total > 0 && fs.free > 0 && fs.share > 0 && fs.share <= 1, 'freeShare over the chartered land: ' + JSON.stringify(fs));
const st = L.stats(s); ok(st.sections === 20 && st.owned === 6 && st.forSale > 0 && st.cheapest > 0 && st.nextGate === 40, 'stats: ' + JSON.stringify(st));

// --- the goal "Charter your first section" --------------------------------------------------------------------------
ok(P.offered(s, 'land1'), 'land1 offered after the first refusal');
const o1 = s.progress.objectives.land1; ok(o1 && (o1.state === 'done' || o1.progress >= 1), 'land1 progress 1 / 1 with a section bought (' + JSON.stringify(o1) + ')');
const sm = P.showMe(s, 'land1'); ok(sm && Number.isFinite(sm.tx) && Number.isFinite(sm.ty), 'showMe(land1) → a tile');

// --- tie routing never crosses unchartered land -----------------------------------------------------------------------
{
  const s2 = S.newGame({ seed: 7, skipTutorial: true, size: 96 }) || BSU.state;
  s2.economy.cash = 90e6;
  const hall = B.list(s2, 'founders_hall')[0]; ok(!!hall, 'Founders’ Hall stands');
  const Y = hall.ty, x0 = 32;   // the charter's west edge is x = 32
  // paint a connected path from the hall's west edge to (32, Y), then a hook OUTSIDE the charter: (31, Y), (30, Y), (30, Y+1..Y+3)
  const paint = (x, y) => BSU.terrain.setSurface(s2, idx(x, y), SURF.PATH);
  for (let x = hall.tx - 1; x >= x0; x--) paint(x, Y);
  paint(31, Y); paint(30, Y); paint(30, Y + 1); paint(30, Y + 2); paint(30, Y + 3);
  const conn = B.connectedMask(s2);
  ok(conn[idx(30, Y + 3)] === 1 && conn[idx(32, Y)] === 1, 'the painted path is connected to the hall');
  // box the run tile (32, Y+3) in with occupied tiles so the only way to the network is through (31, Y+3), which is unchartered
  const owners = [[32, Y + 1], [33, Y + 1], [34, Y + 1], [32, Y + 2], [33, Y + 2], [34, Y + 2], [33, Y + 3], [34, Y + 3], [32, Y + 4], [33, Y + 4], [34, Y + 4]];
  for (const o of owners) s2.tiles.owner[idx(o[0], o[1])] = 0;
  const tieBefore = B.runTie(s2, 'path', [idx(32, Y + 3)]);
  ok(tieBefore === null, 'no tie while (31, Y+3) is state land (the route would cross it)');
  const sec = L.sectionAt(s2, 31, Y + 3); ok(sec && sec.forSale, 'the section holding (31, Y+3) is for sale');
  ok(H.charter(sec.id, true).ok, 'buy it');
  const tieAfter = B.runTie(s2, 'path', [idx(32, Y + 3)]);
  ok(tieAfter && tieAfter.tiles.length === 1 && tieAfter.tiles[0] === idx(31, Y + 3), 'after the purchase the tie goes through it: ' + JSON.stringify(tieAfter && tieAfter.tiles));
  for (const o of owners) s2.tiles.owner[idx(o[0], o[1])] = -1;
  // a scripted campus never lays an access surface outside the charter (Highway 1's north extension is a pre-existing road there)
  const surf0 = s2.tiles.surface.slice();
  let placed = 0; const types = ['dorm', 'dining_hall', 'lecture_hall', 'dorm', 'library', 'dorm', 'greek_house', 'dorm'];
  for (const t of types) { const sp = H.findSpot(t); if (!sp) continue; if (H.place(t, sp.x, sp.y).ok) placed++; }
  ok(placed >= 6, placed + ' buildings placed through findSpot (inside the charter)');
  const m2 = L.mask(s2); let outside = 0;
  for (let i = 0; i < m2.length; i++) if (!m2[i] && s2.tiles.surface[i] !== surf0[i]) outside++;
  eq(outside, 0, 'no new surface on unchartered land');
}

// --- save round-trip; a v2 doc without `charter` loads as "legacy only" ------------------------------------------------
{
  const s3 = S.newGame({ seed: 42, skipTutorial: true, size: 96 }) || BSU.state;
  s3.economy.cash = 50e6;
  const first = L.sections(s3).find((x) => x.forSale); ok(L.buy(s3, first.id, {}).ok, 'buy one before saving');
  const json = S.save('_land');
  ok(json.length > 1000 && JSON.parse(json).charter && JSON.parse(json).charter.owned[0] === first.id, 'the doc carries charter.owned');
  const L3 = S.load('_land');
  ok(L3 && L3.charter.owned.length === 1 && L3.charter.owned[0] === first.id && L3.charter.cardSeen === true && L.isChartered(L3, first.x0, first.y0) && !L.isChartered(L3, 0, 0), 'load: the section is still chartered');
  const doc = JSON.parse(json); delete doc.charter;
  win.localStorage.setItem('bsu.save._nocharter', JSON.stringify(doc));
  const L4 = S.load('_nocharter');
  ok(L4 && L4.charter && Array.isArray(L4.charter.owned) && L4.charter.owned.length === 0 && L4.charter.cardSeen === false && L4.charter.refusedDay === -1, 'a v2 doc without charter → owned [] (legacy only)');
  ok(L4 && !L.isChartered(L4, first.x0, first.y0) && L.isChartered(L4, L4.world.legacy.x0, L4.world.legacy.y0) && L.sections(L4).length === 20, 'legacy only: the bought section is state land again');
}

// --- 64 × 64: no sections, everything chartered, the panel says so --------------------------------------------------
{
  const s4 = S.newGame({ seed: 42, skipTutorial: true, size: 64 }) || BSU.state;
  eq(L.sections(s4).length, 0, 'a 64 world has no sections');
  ok(L.cells(s4).length === 16 && L.cells(s4).every((c) => c.legacy), '16 cells, all the charter');
  ok(L.isChartered(s4, 0, 0) && L.isChartered(s4, 63, 63) && L.refusal(s4, [0, 63 * 64 + 63]) === null, 'everything is chartered');
  ok(!L.quote(s4, 1).ok && L.nearestSection(s4, 10, 10) === null && L.stats(s4).sections === 0, 'nothing to buy');
  ok(B.canPlace(s4, 'dorm', 2, 2, { rot: 0, ignoreCash: true }).reason.indexOf(L.CHARTER_REASON) < 0, 'no charter refusal anywhere');
  ok(!H.charter(1).ok, 'headless.charter(1) → not ok');
}

// --- the overlay pass + the minimap ---------------------------------------------------------------------------------
{
  const s5 = S.newGame({ seed: 42, skipTutorial: true, size: 96 }) || BSU.state;
  const passes = R.passes();
  ok(passes.some((p) => p.name === 'charter' && p.order === 6.5), 'charter pass registered at 6.5');
  ok(typeof R.charterStats === 'function' && R._charter && typeof R._charter.pass === 'function', 'R.charterStats / R._charter');
  R.setZoom(1); R.panToTile(34, 50); H.render(); H.render();
  const cs = R.charterStats();
  ok(cs.frames >= 2 && cs.sections >= 1, 'sections drawn over the west boundary at 1×: ' + JSON.stringify(cs));
  ok(cs.labels >= 1, 'labels at zoom 1');
  const polys = R._charter.polys(s5, L.sections(s5));
  ok(polys.length === 20 && polys.every((p) => p.pts.length === 4 * 16 * 2 * 2), '20 polygons of 128 points (two vertices per edge tile per side, x / y pairs)');
  R.setZoom(0.5); H.render();
  ok(R.charterStats().labels === 0, 'no labels at 0.5×');
  s5.economy.cash = 50e6; const first = L.sections(s5).find((x) => x.forSale); L.buy(s5, first.id, {});
  R.setZoom(1); H.render();
  ok(R._charter.polys(s5, L.sections(s5)).length === 19, 'a bought section leaves the overlay');
  R.minimap(s5);
  ok(errors() === 0, 'no BSU.error through the passes and the minimap');
}

// --- source rules (the L1 contract) -----------------------------------------------------------------------------------
{
  const src = readFileSync(join(root, 'src', 'js', 'land.js'), 'utf8');
  ok(!/^  const [^\n]*=\s*BSU\.MAP\.(W|H|N)\b/m.test(src) && /BSU\.onMap\(/.test(src), 'land.js reads the live map through BSU.onMap');
  ok(!/& 63\b|>> 6\b/.test(src), 'no 64-wide bit tricks');
  ok(!/document\.|window\.(setTimeout|requestAnimationFrame)/.test(src), 'no DOM / timers');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
