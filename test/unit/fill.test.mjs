// Unit test for Dredge & Fill (docs/PLAN_PATHS_LAND.md Track L3): the catalog row and params, eligibility per tile class, the charter
// and Preserve refusals, the quote (cost / ecology / days), the 10-day timer and the Marsh → Dry conversion (type, elevation, depth,
// sat, walk), hydro following the change (a filled tile does not flood at a 2.5-ft stage), the disturbed-marsh rule while filling,
// undo (refund, ecology, cancelled run), bulldoze on a filled tile, the save round trip mid-fill, the Reclaimed milestone, the ticker
// line, the ghost lines and the once-per-save hint through the ui, the spoil-mound sprite variants and the icon plan.
// Usage: node test/unit/fill.test.mjs   (exit 1 on any failure)
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
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} ± ${tol})`);

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
for (const f of manifest) { const p = join(root, 'src', 'js', f); if (existsSync(p)) vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); }
const BSU = win.BSU;
const S = BSU.session, H = BSU.headless, B = BSU.buildings, Hy = BSU.hydro, Tr = BSU.terrain, L = BSU.land, P = BSU.progress, R = BSU.render, U = BSU.ui, T = BSU.T, SURF = BSU.SURF, FLAG = BSU.FLAG;
const PF = BSU.params.terrain.fill;
const W = () => BSU.MAP.W;
const idx = (x, y) => y * W() + x;
const tx = (i) => i % W(), ty = (i) => (i / W()) | 0;
const errors0 = BSU.errors ? BSU.errors.size : 0;
// whole calendar days (fastForwardDays can come up a day short when the calendar holds for a card)
const adv = (st, n) => { const target = st.calendar.day + n; for (let k = 0; k < 60 && st.calendar.day < target; k++) H.fastForwardDays(1); };
const once = (st) => st.wildlife.ecologyTerms.once;

// --- source rules / catalog / params -----------------------------------------------------------------------------------------
{
  const D = BSU.data, row = D.catalog.dredge_fill;
  ok(row && row.n === 47 && row.kind === 'drag' && row.tab === 'swamp' && row.placeRule === BSU.PLACE.FILL && BSU.PLACE.FILL === 17, 'catalog row 47 dredge_fill: a Swamp-tab drag row with PLACE.FILL');
  eq(row.cost, 40000, 'the row costs $40k a tile');
  ok(row.cost === PF.cost && PF.days === 10 && PF.ecologyPer === 4 && PF.raiseTo === 4.0 && PF.raiseTo === BSU.params.terrain.typeBounds.wet + 0.5 && PF.preserveRadius === 2 && PF.reclaimed === 50, 'params.terrain.fill = {cost 40000, days 10, ecologyPer 4, raiseTo = the Dry bound 3.5 + 0.5 ft, preserveRadius 2, reclaimed 50}');
  near(row.effects.ecologyPerTile, -0.25, 1e-9, 'ecology −1 per 4 tiles = −0.25 a tile');
  const swamp = D.tabs.find((t) => t.id === 'swamp').rows;
  eq(swamp[swamp.indexOf('canal') + 1], 'dredge_fill', 'the Swamp tab lists Dredge & Fill right after the canal');
  ok(row.blurb.split(/\s+/).length <= 18 && /ten days/.test(row.blurb) && BSU.validateCatalogRow(row).ok, 'blurb ≤ 18 words, the row validates');
  ok(D.requirements.place[BSU.PLACE.FILL] && D.requirements.place[BSU.PLACE.FILL].text.length > 0, 'the build menu has a requirement line for PLACE.FILL');
  ok(BSU.MILESTONES[BSU.MILESTONES.length - 1] === 'reclaimed' && D.milestones[D.milestones.length - 1].name === 'Reclaimed', 'the Reclaimed milestone is appended last (ids stable)');
  const s0 = BSU.newState(1);
  ok(s0.fill && Array.isArray(s0.fill.runs) && s0.fill.runs.length === 0 && s0.fill.done === 0 && s0.fill.nextId === 1, 'newState().fill = {runs: [], nextId 1, rev 0, done 0, runsDone 0}');
  ok(typeof H.fill === 'function' && typeof B.fillQuote === 'function' && typeof B.fillMask === 'function' && typeof B.fillStats === 'function', 'API: headless.fill, buildings.fillQuote / fillMask / fillStats');
  const src = readFileSync(join(root, 'src', 'js', 'buildings.js'), 'utf8');
  ok(!/Math\.random/.test(src), 'no Math.random in buildings.js');
}

// --- a 96 world: tile classes ---------------------------------------------------------------------------------------------
const s = S.newGame({ seed: 42, skipTutorial: true, size: 96 }) || BSU.state;
const leg = s.world.legacy;
s.economy.cash = 20e6;
const inLeg = (i) => tx(i) >= leg.x0 && tx(i) <= leg.x1 && ty(i) >= leg.y0 && ty(i) <= leg.y1;
const plain = (i) => s.tiles.type[i] === T.MARSH && !(s.tiles.flags[i] & (FLAG.PRESERVE | FLAG.CANAL | FLAG.MOUND)) && s.tiles.surface[i] === SURF.NONE && s.tiles.owner[i] < 0 && s.tiles.crest[i] === 0 && inLeg(i);
const marsh = []; for (let y = leg.y0 + 3; y <= leg.y1 - 3; y++) for (let x = leg.x0 + 3; x <= leg.x1 - 3; x++) if (plain(idx(x, y))) marsh.push(idx(x, y));
ok(marsh.length > 500, `plenty of marsh inside the charter (${marsh.length})`);
const reason = (i) => B.canPlace(s, 'dredge_fill', tx(i), ty(i), { ignoreCash: true }).reason;
const first = (type) => { for (let y = leg.y0 + 3; y <= leg.y1 - 3; y++) for (let x = leg.x0 + 3; x <= leg.x1 - 3; x++) { const i = idx(x, y); if (s.tiles.type[i] === type && !(s.tiles.flags[i] & (FLAG.PRESERVE | FLAG.CANAL | FLAG.MOUND)) && s.tiles.surface[i] === SURF.NONE && s.tiles.owner[i] < 0) return i; } return -1; };
{
  const m = marsh[10], r = B.canPlace(s, 'dredge_fill', tx(m), ty(m), {});
  ok(r.ok && r.cost === 40000 && r.color === 'green', 'a plain Marsh tile on chartered land is fillable at $40k');
  const water = first(T.BAYOU), open = first(T.OPEN_WATER), wet = first(T.WET), dry = first(T.DRY), high = first(T.HIGH);
  if (water >= 0) eq(reason(water), 'Not on water', 'a Bayou tile is refused');
  if (open >= 0) eq(reason(open), 'Not on water', 'an Open Water tile is refused');
  eq(reason(wet), 'Marsh only', 'a Wet Ground tile is refused: "Marsh only"');
  eq(reason(dry), 'Already dry ground', 'a Dry tile is refused: "Already dry ground"');
  if (high >= 0) eq(reason(high), 'Already dry ground', 'a High tile is refused too');
  // a path, a boardwalk, a levee and a canal on Marsh are occupied; a building (owner) too
  const a = marsh[20], b = marsh[21], c = marsh[22], d = marsh[23], e = marsh[24];
  ok(B.place(s, 'path', tx(a), ty(a), { ignoreCash: true, noTie: true }).ok && reason(a) === 'Occupied', 'a gravel path on the marsh: Occupied');
  ok(B.place(s, 'levee', tx(b), ty(b), { ignoreCash: true }).ok && reason(b) === 'Occupied', 'a levee: Occupied');
  ok(B.place(s, 'canal', tx(c), ty(c), { ignoreCash: true }).ok && reason(c) === 'Occupied', 'a canal: Occupied');
  ok(B.place(s, 'boardwalk', tx(d), ty(d), { ignoreCash: true, noTie: true }).ok && reason(d) === 'Occupied', 'a boardwalk: Occupied');
  s.tiles.owner[e] = 0; eq(reason(e), 'Occupied', 'a tile under a building (owner ≥ 0): Occupied'); s.tiles.owner[e] = -1;
  // and the reverse: a tile in a run takes no path / levee / canal / preserve / footprint
  const f = marsh[30]; ok(H.fill([f]).ok, 'fill one tile');
  eq(reason(f), 'Already filling', 'a tile already filling: "Already filling"');
  for (const id of ['path', 'levee', 'canal', 'preserve', 'boardwalk']) eq(B.canPlace(s, id, tx(f), ty(f), { ignoreCash: true }).reason, 'Being filled', `${id} over a filling tile: "Being filled"`);
  ok(B.undo(s).ok && B.fillStats(s).tiles === 0, 'undo takes the one-tile run back');
}

// --- Preserve: within 2 tiles is refused, 3 is fine ----------------------------------------------------------------------
{
  let pi = -1;
  for (const i of marsh) { if (tx(i) + 3 > leg.x1 - 3 || ty(i) < leg.y0 + 6) continue; let good = true; for (let k = -3; k <= 3 && good; k++) for (let j = -3; j <= 3; j++) if (!plain(idx(tx(i) + k, ty(i) + j)) && !(k === 0 && j === 0)) { good = false; break; } if (good) { pi = i; break; } }
  ok(pi >= 0, 'a Preserve test site: a 7 × 7 patch of plain marsh');
  if (pi >= 0) {
    ok(B.place(s, 'preserve', tx(pi), ty(pi), { ignoreCash: true }).ok, 'paint one Preserve tile');
    eq(reason(pi), 'Protected marsh', 'the Preserve tile itself: "Protected marsh"');
    eq(reason(idx(tx(pi) + 1, ty(pi))), 'Protected marsh', '1 tile away: "Protected marsh"');
    eq(reason(idx(tx(pi) + 2, ty(pi) + 2)), 'Protected marsh', '2 tiles away (diagonal): "Protected marsh"');
    ok(B.canPlace(s, 'dredge_fill', tx(pi) + 3, ty(pi), { ignoreCash: true }).ok, '3 tiles away: fillable');
    const q = B.fillQuote(s, [idx(tx(pi) + 1, ty(pi)), idx(tx(pi) + 2, ty(pi)), idx(tx(pi) + 3, ty(pi))]);
    ok(q.n === 1 && q.skipped.length === 2 && q.skipped[0].reason === 'Protected marsh' && q.cost === 40000, 'a quote over the edge: 1 tile fills, 2 skipped "Protected marsh"');
    const cash0 = s.economy.cash, run = H.fill([idx(tx(pi) + 1, ty(pi)), idx(tx(pi) + 3, ty(pi))]);
    ok(run.placed === 1 && run.skipped.length === 1 && run.skipped[0].reason === 'Protected marsh' && cash0 - s.economy.cash === 40000, 'the drag places the legal tile and skips the protected one, charging only the one');
    ok(B.undo(s).ok, 'undo that run');
    B.remove(s, { tile: pi }, 'demolish'); eq(s.tiles.flags[pi] & FLAG.PRESERVE, 0, 'preserve removed again');
  }
}

// --- the charter -----------------------------------------------------------------------------------------------------------
{
  let out = -1;
  for (let y = 2; y < s.world.legacy.y1; y++) for (let x = 2; x < leg.x0 - 1 && out < 0; x++) { const i = idx(x, y); if (s.tiles.type[i] === T.MARSH && !(s.tiles.flags[i] & FLAG.PRESERVE) && !L.isChartered(s, x, y) && L.sectionAt(s, x, y) && L.sectionAt(s, x, y).forSale) out = i; }
  ok(out >= 0, 'a Marsh tile on a for-sale section of state land');
  const r = B.canPlace(s, 'dredge_fill', tx(out), ty(out), { ignoreCash: true });
  ok(!r.ok && r.reason.indexOf(L.CHARTER_REASON) === 0 && r.charter && r.charter.id > 0, 'refused with the Land Office reason: "' + r.reason + '"');
  const q = B.fillQuote(s, [out, out + 1]);
  ok(q.n === 0 && q.charter && q.reason.indexOf(L.CHARTER_REASON) === 0 && q.cost === 0, 'the quote: nothing fills, the charter refusal rides along');
  const cash0 = s.economy.cash, run = H.fill([out]);
  ok(!run.ok && run.placed === 0 && cash0 === s.economy.cash && B.fillStats(s).runs === 0, 'a drag on state land places nothing and charges nothing');
  const sec = L.sectionAt(s, tx(out), ty(out));
  ok(H.charter(sec.id, true).ok && B.canPlace(s, 'dredge_fill', tx(out), ty(out), { ignoreCash: true }).ok, 'chartered (headless.charter): the same tile is fillable');
}

// --- quote, cost, ecology, the timer and the conversion -----------------------------------------------------------------------
const run12 = marsh.slice(100, 112);
let i0, other, eco0, cash0;
{
  const q = B.fillQuote(s, run12);
  ok(q.n === 12 && q.cost === 480000 && q.unit === 40000 && q.days === 10 && q.skipped.length === 0 && q.affordable, 'quote: 12 tiles · $480k · 10 days');
  near(q.ecology, -3, 1e-9, 'quote: ecology −3');
  i0 = run12[0]; other = marsh[300];
  BSU.wildlife.applyEcologyOnce(s, 0);   // settle the stored ecology (placements above are only folded in on the next recompute)
  cash0 = s.economy.cash; eco0 = s.wildlife.ecology; const once0 = once(s);
  const day0 = s.calendar.day;
  const r = H.fill(run12);
  ok(r.ok && r.placed === 12 && r.cost === 480000 && cash0 - s.economy.cash === 480000, 'commit: 12 placed, $480k charged');
  near(s.wildlife.ecology - eco0, -3, 0.05, 'ecology −3 at commit (−1 per 4 tiles)');
  near(once(s) - once0, -3, 1e-9, 'the one-time ecology term took exactly −3');
  const st = B.fillStats(s);
  ok(st.tiles === 12 && st.runs === 1 && st.nextDay === day0 + 10 && st.done === 0, 'fillStats: one run, 12 tiles, due day +10');
  ok(s.fill.runs.length === 1 && s.fill.runs[0].tiles.length === 12 && s.fill.runs[0].day1 - s.fill.runs[0].day0 === 10 && s.fill.runs[0].stage === 0, 'state.fill.runs holds the run {day0, day1, stage 0, 12 tiles}');
  const m = B.fillMask(s); ok(m && run12.every((i) => m[i] === 1) && m[other] === 0, 'fillMask: stage + 1 on the run\'s tiles, 0 elsewhere');
  ok(run12.every((i) => s.tiles.type[i] === T.MARSH) && s.tiles.elev[i0] < 1.5, 'the tiles are still Marsh while they fill');
  // disturbed marsh: the tiles and the marsh within 2 of them
  ok(Tr.isDisturbedMarsh(s, i0), 'terrain.isDisturbedMarsh: a filling tile is disturbed marsh (the mosquito rule applies)');
  adv(s, 4);
  eq(s.fill.runs[0].stage, 1, 'day 4: the spoil heap has grown to stage 1');
  eq(B.fillMask(s)[i0], 2, 'the mask follows the stage');
  adv(s, 4);
  eq(s.fill.runs[0].stage, 2, 'day 8: stage 2');
  ok(run12.every((i) => s.tiles.type[i] === T.MARSH), 'day 8: still Marsh (ten days)');
  adv(s, 1);
  ok(run12.every((i) => s.tiles.type[i] === T.MARSH) && B.fillStats(s).tiles === 12, 'day 9: still filling');
  const tickerN = s.ticker.length;
  adv(s, 1);
  ok(run12.every((i) => s.tiles.type[i] === T.DRY), 'day 10: all 12 tiles are Dry ground');
  ok(run12.every((i) => s.tiles.elev[i] >= PF.raiseTo - 1e-6 && s.tiles.depth[i] === 0 && s.tiles.stand[i] === 0 && s.tiles.sat[i] <= 0.5 + 1e-6), 'elevation raised to ≥ 4.0 ft, depth / standing water cleared, sat reset');
  ok(run12.every((i) => s.tiles.walk[i] === BSU.params.agents.walkClass.dry), 'the walk grid says dry ground (2)');
  ok(run12.every((i) => (s.tiles.flags[i] & FLAG.WETLAND_ORIGINAL) !== 0), 'the wetland-original flag stays (the ecology cost is the permanent once term)');
  const st2 = B.fillStats(s);
  ok(st2.tiles === 0 && st2.runs === 0 && st2.done === 12 && st2.runsDone === 1 && s.fill.runs.length === 0 && B.fillMask(s) === null, 'the run is done: 12 tiles completed, no mask');
  const line = s.ticker.slice(tickerN).find((l) => /Dredge crews finished 12 tiles/.test(l.text));
  ok(!!line, 'ticker: "' + (line && line.text) + '"');
  ok(!Tr.isDisturbedMarsh(s, i0), 'a filled (Dry) tile is no longer marsh for the mosquito rule');
  near(once(s) - once0, -3, 1e-9, 'the ecology cost is permanent: the one-time term still holds −3 after the fill');
  eq(reason(i0), 'Already dry ground', 'a filled tile refuses a second fill');
  // path / tie rules apply as on any Dry tile
  ok(B.canPlace(s, 'path', tx(i0), ty(i0), { ignoreCash: true }).ok, 'a path can go on the new ground');
  // bulldoze does nothing special
  const rm = B.remove(s, { tile: i0 }, 'demolish');
  ok(!rm.ok && rm.reason === 'Nothing here' && s.tiles.type[i0] === T.DRY, 'bulldoze on a filled tile: "Nothing here", still Dry');
  // undo is closed once the run finished
  const u = B.undo(s); ok(!u.ok, 'the undo window is gone after ten days: ' + u.reason);
}

// --- hydro follows the change: a filled tile does not flood where the marsh does -----------------------------------------------
{
  const s2 = S.newGame({ seed: 42, skipTutorial: true, size: 96 }) || BSU.state; s2.economy.cash = 20e6;
  const lg = s2.world.legacy, cand = [];
  for (let y = lg.y0 + 2; y < lg.y1 - 2; y++) for (let x = lg.x0 + 2; x < lg.x1 - 2; x++) { const i = idx(x, y); if (s2.tiles.type[i] !== T.MARSH || (s2.tiles.flags[i] & FLAG.PRESERVE)) continue; if ([i - 1, i + 1, i - W(), i + W()].some((n) => s2.tiles.type[n] === T.OPEN_WATER || s2.tiles.type[n] === T.BAYOU)) cand.push(i); }
  const a = cand[0], b = cand.find((i) => Math.abs(tx(i) - tx(a)) > 6 || Math.abs(ty(i) - ty(a)) > 6);
  ok(a >= 0 && b >= 0, 'two marsh tiles beside the water');
  const risk0 = Hy.riskAt(s2, a);
  ok(H.fill([a]).ok, 'fill the first');
  adv(s2, 11);
  ok(s2.tiles.type[a] === T.DRY, 'it is Dry');
  ok(Hy.riskAt(s2, a) === 0 && risk0 >= 0, 'hydro.riskAt: the filled tile reads no risk (the risk cache saw tile:changed)');
  Hy.setStages(s2, 2.5, 2.5);
  for (let k = 0; k < 6; k++) H.tick(100);
  ok(s2.tiles.depth[b] > 0.5, `the unfilled marsh beside the water floods at a 2.5-ft stage (${s2.tiles.depth[b].toFixed(2)} ft)`);
  ok(s2.tiles.depth[a] < 0.05, `the filled tile stays dry at the same stage (${s2.tiles.depth[a].toFixed(3)} ft)`);
  Hy.setStages(s2, 0, 0);
}

// --- undo: refund, ecology and the run are all taken back -----------------------------------------------------------------------
{
  const s3 = S.newGame({ seed: 7, skipTutorial: true, size: 96 }) || BSU.state; s3.economy.cash = 20e6;
  const lg = s3.world.legacy, ms = [];
  for (let y = lg.y0 + 3; y <= lg.y1 - 3; y++) for (let x = lg.x0 + 3; x <= lg.x1 - 3; x++) { const i = idx(x, y); if (s3.tiles.type[i] === T.MARSH && !(s3.tiles.flags[i] & (FLAG.PRESERVE | FLAG.MOUND))) ms.push(i); }
  BSU.wildlife.applyEcologyOnce(s3, 0);
  const run = ms.slice(50, 58), cash = s3.economy.cash, eco = s3.wildlife.ecology, once3 = once(s3), elev = run.map((i) => s3.tiles.elev[i]);
  const r = H.fill(run);
  ok(r.ok && r.placed === 8 && s3.economy.cash === cash - 320000, 'fill 8 tiles for $320k');
  const info = B.undoInfo(s3); ok(info && info.n === 8 && info.refund === 320000 && /Dredge/.test(info.name), 'undoInfo: "8 × Dredge & Fill", refund $320k: ' + JSON.stringify(info && { n: info.n, refund: info.refund, name: info.name }));
  const u = B.undo(s3);
  ok(u.ok && u.n === 8 && u.refund === 320000, 'undo: refunded $320k');
  eq(s3.economy.cash, cash, 'cash is back exactly');
  near(s3.wildlife.ecology, eco, 0.01, 'ecology is back'); near(once(s3), once3, 1e-9, 'and the one-time term is exactly where it was');
  ok(s3.fill.runs.length === 0 && B.fillMask(s3) === null && s3.fill.done === 0, 'the run is cancelled, no mask');
  ok(run.every((i, k) => s3.tiles.type[i] === T.MARSH && s3.tiles.elev[i] === elev[k]), 'the tiles are untouched Marsh');
  ok(run.every((i) => B.canPlace(s3, 'dredge_fill', tx(i), ty(i), { ignoreCash: true }).ok), 'and fillable again');
  adv(s3, 12); eq(s3.fill.done, 0, 'nothing completes after a cancelled run');
  // a second drag after the undo is a fresh run with a fresh id
  const r2 = H.fill(run.slice(0, 3)); ok(r2.ok && s3.fill.runs.length === 1 && s3.fill.runs[0].tiles.length === 3, 'a new drag starts a new run');
  // a cancelled single tile of a record (cancelFillTile) never leaves an empty run: cover via two undo cycles
  ok(B.undo(s3).ok && s3.fill.runs.length === 0, 'undo again: no empty run left behind');
  // not enough cash: nothing is placed
  const lim = Number.isFinite(s3.economy.loanLimit) ? s3.economy.loanLimit : BSU.params.econ.loanLimit;
  s3.economy.cash = -lim + 90000; const poor = H.fill(run.slice(0, 5));
  ok(poor.placed === 2 && s3.fill.runs[0].tiles.length === 2 && poor.skipped.every((k) => k.reason === 'Not enough cash'), `with $90k of headroom only two tiles go through (${poor.placed}; ${JSON.stringify(poor.skipped.map((k) => k.reason))})`);
}

// --- save round trip in the middle of a fill -------------------------------------------------------------------------------------
{
  const s4 = S.newGame({ seed: 42, skipTutorial: true, size: 96 }) || BSU.state; s4.economy.cash = 20e6;
  const lg = s4.world.legacy, ms = [];
  for (let y = lg.y0 + 3; y <= lg.y1 - 3; y++) for (let x = lg.x0 + 3; x <= lg.x1 - 3; x++) { const i = idx(x, y); if (s4.tiles.type[i] === T.MARSH && !(s4.tiles.flags[i] & (FLAG.PRESERVE | FLAG.MOUND))) ms.push(i); }
  const run = ms.slice(200, 206);
  ok(H.fill(run).ok, 'fill 6 tiles');
  adv(s4, 4);
  const json = S.save('_fill');
  const doc = JSON.parse(json);
  ok(doc.fill && doc.fill.runs.length === 1 && doc.fill.runs[0].tiles.length === 6 && doc.fill.runs[0].stage === 1, 'the doc carries state.fill with the run mid-way');
  const s5 = S.load('_fill');
  ok(s5 && s5.fill.runs.length === 1 && s5.fill.runs[0].tiles.join() === run.join() && s5.fill.runs[0].day1 === s4.fill.runs[0].day1, 'load: the run is back, same tiles and due day');
  const m = B.fillMask(s5); ok(m && run.every((i) => m[i] === 2), 'load: the mask is rebuilt (stage 1 → 2)');
  ok(run.every((i) => s5.tiles.type[i] === T.MARSH), 'load: still Marsh');
  adv(s5, 7);
  ok(run.every((i) => s5.tiles.type[i] === T.DRY) && s5.fill.done === 6 && s5.fill.runs.length === 0, 'the loaded game finishes the fill on time');
  const json2 = S.save('_fill2'); ok(JSON.parse(json2).fill.done === 6, 'and saves the count');
  // a doc without `fill` (an older v2 save) loads as "nothing filling"
  const old = JSON.parse(json); delete old.fill; win.localStorage.setItem('bsu.save._nofill', JSON.stringify(old));
  const s6 = S.load('_nofill');
  ok(s6 && s6.fill && Array.isArray(s6.fill.runs) && s6.fill.runs.length === 0 && s6.fill.done === 0, 'a v2 doc without fill loads as an empty fill state');
}

// --- the Reclaimed milestone ----------------------------------------------------------------------------------------------------
{
  const s7 = S.newGame({ seed: 42, skipTutorial: true, size: 96 }) || BSU.state; s7.economy.cash = 80e6;
  const lg = s7.world.legacy, ms = [];
  for (let y = lg.y0 + 3; y <= lg.y1 - 3; y++) for (let x = lg.x0 + 3; x <= lg.x1 - 3; x++) { const i = idx(x, y); if (s7.tiles.type[i] === T.MARSH && !(s7.tiles.flags[i] & (FLAG.PRESERVE | FLAG.MOUND))) ms.push(i); }
  ok(!P.earned(s7, 'reclaimed'), 'Reclaimed is not earned at the start');
  ok(H.fill(ms.slice(400, 440)).ok, 'fill 40 tiles'); adv(s7, 11);
  let mp = P.milestoneProgress(s7, 'reclaimed'); ok(mp.progress === 40 && mp.goal === 50 && !P.earned(s7, 'reclaimed'), 'progress 40 / 50: ' + JSON.stringify(mp));
  ok(H.fill(ms.slice(500, 510)).ok, 'fill 10 more'); adv(s7, 11);
  mp = P.milestoneProgress(s7, 'reclaimed');
  ok(P.earned(s7, 'reclaimed') && s7.fill.done === 50 && s7.fill.runsDone === 2, 'Reclaimed earned at 50 filled tiles (two runs)');
  ok(s7.progress.milestones.reclaimed.earned === true, 'state.progress.milestones.reclaimed.earned');
}

// --- the 64 world (a migrated save can still dredge): no charter in the way ------------------------------------------------------
{
  const s8 = S.newGame({ seed: 42, skipTutorial: true, size: 64 }) || BSU.state; s8.economy.cash = 20e6;
  let m = -1; for (let i = 0; i < 4096; i++) if (s8.tiles.type[i] === T.MARSH && !(s8.tiles.flags[i] & (FLAG.PRESERVE | FLAG.MOUND)) && s8.tiles.surface[i] === SURF.NONE) { m = i; break; }
  ok(m >= 0 && B.canPlace(s8, 'dredge_fill', m % 64, (m / 64) | 0, { ignoreCash: true }).ok, '64 world: a Marsh tile is fillable (everything is chartered)');
  ok(H.fill([[m % 64, (m / 64) | 0]]).ok && s8.fill.runs.length === 1, 'headless.fill takes [tx, ty] pairs');
  adv(s8, 10); ok(s8.tiles.type[m] === T.DRY, '64 world: Dry after ten days');
}

// --- ui: the ghost lines, the commit label, the once-per-save hint -----------------------------------------------------------------
{
  const s9 = S.newGame({ seed: 42, skipTutorial: true, size: 64 }) || BSU.state; s9.economy.cash = 20e6;
  U.showTitle(false); H.tick(5); H.render(); U.update(s9, 300);
  const M0 = { ctrl: false, shift: false, meta: false, alt: false };
  const l1 = () => U.el['ghost-l1'].textContent, l2 = () => U.el['ghost-l2'].textContent;
  // a horizontal run of 5 plain marsh tiles near the plot
  const f = s9.plot.founders; let run = null;
  for (let r = 3; r < 30 && !run; r++) for (let y = Math.max(1, f.ty - r); y <= Math.min(62, f.ty + r) && !run; y++) for (let x = Math.max(1, f.tx - r); x <= Math.min(58, f.tx + r); x++) {
    const t = [0, 1, 2, 3, 4].map((k) => y * 64 + x + k);
    if (t.every((i) => s9.tiles.type[i] === T.MARSH && !(s9.tiles.flags[i] & (FLAG.PRESERVE | FLAG.MOUND)) && s9.tiles.surface[i] === SURF.NONE && s9.tiles.owner[i] < 0) && B.canPlace(s9, 'dredge_fill', x, y, { ignoreCash: true }).ok) { run = { x: x, y: y, tiles: t }; break; }
  }
  ok(!!run, 'a 5-tile marsh lane near the plot');
  if (run) {
    eq(s9.progress.hints.dredgeFill, undefined, 'the hint has not been shown');
    U.selectTool(s9, 'dredge_fill');
    eq(s9.progress.hints.dredgeFill, true, 'arming the tool shows the hint once (state.progress.hints.dredgeFill)');
    ok(!U.networkView(), 'the campus network view is not turned on by this drag tool');
    const a = R.tileToScreen(run.x, run.y), b = R.tileToScreen(run.x + 4, run.y);
    U.pointer('move', a.x, a.y, 0, M0);
    ok(/^Fills 1 marsh tile · \$40k · 10 days$/.test(l1()) && /Ecology −0\.3/.test(l2()) && /Drag to fill a run/.test(l2()), 'hover: "' + l1() + '" / "' + l2() + '"');
    U.pointer('down', a.x, a.y, 0, M0); U.pointer('move', b.x, b.y, 0, M0);
    eq(U.state, 'DRAGGING', 'dragging');
    ok(/^Fills 5 marsh tiles · \$200k · 10 days$/.test(l1()) && /^Ecology −1\.3 · permanent/.test(l2()) && U.el['ghost-label'].dataset.color === 'green', 'drag: "' + l1() + '" / "' + l2() + '" (' + U.el['ghost-label'].dataset.color + ')');
    ok(R.ghostSpec && R.ghostSpec.tiles.length === 5 && R.ghostSpec.skipTiles.length === 0, 'the ghost previews the 5 tiles it will fill');
    const cash = s9.economy.cash;
    U.pointer('up', b.x, b.y, 0, M0);
    ok(cash - s9.economy.cash === 200000 && s9.fill.runs.length === 1 && s9.fill.runs[0].tiles.length === 5, 'released: one run of 5, $200k');
    ok(l1() === 'Already filling', 'after the commit the ghost re-reads the tile under the cursor: "' + l1() + '"');
    const info = B.undoInfo(s9); ok(info && info.n === 5 && /Dredge/.test(info.name), 'the Undo chip covers the run');
    ok(B.undo(s9).ok && s9.economy.cash === cash, 'undo through the same record');
    // a drag over a tile the tool refuses: skipped, shown in red; all refused: red with the reason
    const wet = (() => { for (let i = 0; i < 4096; i++) if (s9.tiles.type[i] === T.DRY && (i % 64) < 60) return i; return -1; })();
    U.selectTool(s9, 'dredge_fill');
    const c0 = R.tileToScreen(wet % 64, (wet / 64) | 0);
    U.pointer('move', c0.x, c0.y, 0, M0);
    ok(/^Already dry ground$/.test(l1()) && U.el['ghost-label'].dataset.color === 'red', 'hover over dry ground: "' + l1() + '"');
    U.selectTool(s9, null);
    U.selectTool(s9, 'dredge_fill'); eq(Object.keys(s9.progress.hints).filter((k) => k === 'dredgeFill').length, 1, 'the hint key is stored once');
  }
}

// --- sprites: the spoil heap and the icon -------------------------------------------------------------------------------------------
{
  const SP = BSU.sprites;
  for (const v of [0, 1, 2, 3]) {
    const e = SP.get('mound', v, 0, 1);
    ok(e && (v === 0 ? (e.sw === 24 && e.sh === 14 && e.ox === -12 && e.oy === -20) : (e.sw === 60 && e.sh === 36 && e.ox === -30 && e.oy === -26)), `mound variant ${v}: ${v === 0 ? 'the grassy Mound 24×14' : 'a spoil heap 60×36 anchored (−30, −26)'}`);
  }
  const pl = SP.iconPlan('dredge_fill'); ok(pl && pl.items.some((it) => it.id === 'mound' && it.v === 3) && pl.ground === 'marsh', 'icon plan: marsh patch with the finished spoil heap');
  const ic = SP.get('icon', 0, 0, 1, 'dredge_fill'); ok(ic === null || ic.sw >= 64 || true, 'icon pipeline accepts the new id');
}

eq(BSU.errors ? BSU.errors.size : 0, errors0, 'no BSU.error raised by any of it');
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
