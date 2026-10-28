// Housing tiers pass (PLAN_V2 P7): rows 45 / 46 on the real, built game in the Node DOM stub.
// Both rows place and finish; room fees post at the semester lock; Magnolia Suites' parking spaces
// shrink the lot requirement; housing quality is the bed-weighted mean of the tiers; the applicant
// mix term (−3 % all economy, +3 % with ≥ 20 % premium beds); the Bunkhouse's negative aura.
// Usage: node build.mjs --check && node test/unit/housing.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { win } = loadGame();
const BSU = win.BSU, H = BSU.headless, TPD = BSU.params.time.ticksPerDay;
const fresh = () => { BSU.session.newGame({ seed: 42, skipTutorial: true }); const s = BSU.state; s.economy.cash = 90e6; s.economy.suppressCoverage = true; return s; };
// --- 1. both rows are in the catalog, unlock gate, placement, construction ----------------------------------
{
  const s = fresh();
  s.economy.students = 120;
  const U = BSU.progress.unlocked;
  ok(U(s, 'bunkhouse') === true, 'Bayou Bunkhouse is available from the start');
  ok(U(s, 'suites') === false, 'Magnolia Suites is locked below 800 students');
  s.economy.students = 800;
  ok(U(s, 'suites') === true, 'Magnolia Suites unlocks at 800 students');
  const sb = H.findSpot('bunkhouse'), ra = H.place('bunkhouse', sb.x, sb.y);
  ok(ra && ra.ok, 'a Bayou Bunkhouse places (' + (ra && ra.reason) + ')');
  const before = s.economy.cash;
  const sa = H.findSpot('suites');
  ok(!!sa, 'a legal Magnolia Suites site exists');
  const r2 = H.place('suites', sa.x, sa.y);
  ok(r2 && r2.ok, 'a Magnolia Suites places (' + (r2 && r2.reason) + ')');
  ok(before - s.economy.cash >= 1400000 && before - s.economy.cash < 1700000, 'the Suites cost $1.4M plus ground work (' + (before - s.economy.cash) + ')');
  const list = BSU.buildings.list(s);
  ok(list.some((b) => b.type === 'bunkhouse' && b.w === 3 && b.h === 2) && list.some((b) => b.type === 'suites' && b.w === 3 && b.h === 3), 'footprints 3×2 and 3×3');
  // construction: not complete at once, complete after the build days
  const bunk = list.find((b) => b.type === 'bunkhouse'), su = list.find((b) => b.type === 'suites');
  ok(bunk.built < 1 && su.built < 1, 'a fresh placement is under construction');
  H.tick(6 * TPD);
  ok(bunk.built >= 1 && su.built >= 1, 'both rows finish after their build days (bunkhouse ' + bunk.built + ', suites ' + su.built + ')');
  ok(typeof bunk.name === 'string' && /Bunks$/.test(bunk.name) && /Suites$/.test(su.name), 'auto names come from the new pools (' + bunk.name + ', ' + su.name + ')');
}

// --- 2. stats: beds by tier, parking spaces, quality = the bed-weighted mean -------------------------------
{
  const s = fresh(); s.economy.students = 900;
  const rows = ['bunkhouse', 'dorm', 'suites'], got = {};
  for (const id of rows) { const sp = H.findSpot(id); const r = H.place(id, sp.x, sp.y); got[id] = r && r.ok; }
  ok(rows.every((id) => got[id]), 'one of each tier places');
  for (const b of BSU.buildings.list(s)) b.built = 1;
  BSU.buildings.recomputeCoverage && BSU.buildings.recomputeCoverage(s);
  H.tick(2);
  const st = BSU.buildings.stats(s);
  eq(st.bedsEconomy, 360, 'economy beds'); eq(st.bedsStandard, 300, 'standard beds'); eq(st.bedsPremium, 240, 'premium beds');
  eq(st.beds, 900, 'the beds gauge counts all three tiers'); eq(st.parkingSpaces, 60, 'the Suites bring 60 parking spaces');
  ok(Math.abs(st.quality - (360 * 1 + 300 * 2 + 240 * 3) / 900) < 1e-9, 'housing quality is the bed-weighted mean of the tiers (' + st.quality.toFixed(4) + ')');
  const cap = BSU.economy.capacity(s); eq(cap.beds, Math.round(900 * BSU.params.econ.capacity.beds), 'capacity counts every tier');
  // --- 3. parking credit -----------------------------------------------------------------------------
  s.economy.students = 660;
  eq(BSU.economy.lotsNeeded(s), 1, '660 students with 60 spaces need 1 lot (660 − 60 = 600)');
  s.economy.students = 661; ok(BSU.economy.lotsNeeded(s) === 2, '661 students need a second lot');
  // the same campus without the Suites: 660 students need 2 lots
  for (const b of BSU.buildings.list(s)) if (b.type === 'suites') BSU.buildings.remove(s, b.id);
  s.economy.students = 660;
  BSU.buildings.recomputeCoverage && BSU.buildings.recomputeCoverage(s);
  s.calendar.day += 1; H.tick(1);
  eq(BSU.buildings.stats(s).parkingSpaces, 0, 'no Suites, no spaces');
  eq(BSU.economy.lotsNeeded(s), 2, '660 students without the Suites need 2 lots');
}

// --- 4. applicant mix: all economy −3 %, ≥ 20 % premium +3 % -----------------------------------------------
{
  const s = fresh(); s.economy.students = 900;
  const mix = () => BSU.economy.housingMix(s), app = () => BSU.economy.applicants(s);
  const settle = () => { for (const b of BSU.buildings.list(s)) b.built = 1; s.calendar.day += 1; H.tick(1); };
  const a0 = app(); eq(mix(), 0, 'no beds: no mix term');
  const sp = H.findSpot('bunkhouse'); H.place('bunkhouse', sp.x, sp.y); settle();
  eq(mix(), -0.03, 'an all-economy campus: −3 % applicants');
  ok(Math.abs(app() / a0 - 0.97) < 0.01, 'applicants fall by 3 % (' + a0 + ' → ' + app() + ')');
  const sd = H.findSpot('dorm'); H.place('dorm', sd.x, sd.y); settle();
  eq(mix(), 0, 'economy + standard (no premium): no term');
  const su = H.findSpot('suites'); const r = H.place('suites', su.x, su.y); ok(r && r.ok, 'suites placed for the mix test'); settle();
  // 240 / (360 + 300 + 240) = 26.7 % premium
  eq(mix(), 0.03, 'premium beds ≥ 20 % of all beds: +3 % applicants');
  ok(app() / a0 > 1.02 && app() / a0 < 1.04, 'applicants rise by 3 % (' + a0 + ' → ' + app() + ')');
  const bf = BSU.economy.breakdown(s, 'applicants'); ok(bf.lines.some((l) => /housing mix/i.test(l.label) && l.value === 3), 'the applicants popover names the mix line');
}

// --- 5. room fees post at the semester lock (Aug 5) ---------------------------------------------------------
{
  const s = fresh(); s.economy.students = 1500;
  for (const id of ['bunkhouse', 'dorm', 'suites']) { const sp = H.findSpot(id); const r = H.place(id, sp.x, sp.y); ok(r && r.ok, id + ' placed for the fee test'); }
  for (const b of BSU.buildings.list(s)) b.built = 1;
  BSU.buildings.recomputeCoverage && BSU.buildings.recomputeCoverage(s);
  H.tick(2);
  const day0 = s.calendar.day, aug5 = BSU.dateToDay('Aug 5', BSU.dayParts(day0).year);
  const f = BSU.economy.roomFees(s);
  eq(f.total, 300 * 150 + 240 * 400, 'fees = 300 standard beds × $150 + 240 premium × $400 (economy $0), students above the beds');
  const tickDays = (n) => { for (let i = 0; i < n; i++) { s.economy.students = 1500; H.tick(TPD); } };
  let guard = 0; while (s.calendar.day < aug5 - 1 && guard++ < 200) tickDays(1);
  const rf0 = s.ledger.month.income.roomFees || 0;
  guard = 0; while (s.calendar.day < aug5 + 1 && guard++ < 10) tickDays(1);
  const posted = (s.ledger.month.income.roomFees || 0) - rf0;
  ok(s.calendar.day >= aug5, 'the clock reached Aug 5 (day ' + s.calendar.day + ' / ' + aug5 + ')');
  eq(posted, 141000, "the Aug 5 lock posts ledger income 'roomFees' (economy $0 + standard $45,000 + premium $96,000)");
}

// --- 6. the Bunkhouse's −1 happiness aura ------------------------------------------------------------------
{
  const s = fresh(); s.economy.students = 900;
  const sp = H.findSpot('suites'); const r = H.place('suites', sp.x, sp.y); ok(r && r.ok, 'suites placed for the aura test');
  for (const b of BSU.buildings.list(s)) b.built = 1;
  BSU.buildings.recomputeCoverage && BSU.buildings.recomputeCoverage(s);
  const su = BSU.buildings.list(s).find((b) => b.type === 'suites');
  const A = BSU.buildings.auras(s), at = (x, y) => A.life[BSU.idx(x, y)];
  eq(at(su.tx + 1, su.ty + 1), 3, 'Suites: +3 happiness on its own tiles');
  // a Bunkhouse right beside it: its −1 radius 4 reaches the Suites' tiles
  let placed = null;
  for (let dx = -8; dx <= 8 && !placed; dx++) for (let dy = -8; dy <= 8 && !placed; dy++) {
    const x = su.tx + dx, y = su.ty + dy, c = BSU.buildings.canPlace(s, 'bunkhouse', x, y, { rot: 0, ignoreCash: true });
    // paths pass: the 12-tile auto-tie makes farther spots legal too, so pick one whose footprint sits within the aura's radius (4) of the Suites tile under test
    const reaches = c && c.ok && c.tiles.some((i) => Math.max(Math.abs((i & 63) - (su.tx + 1)), Math.abs((i >> 6) - (su.ty + 1))) <= 4);
    if (reaches && Math.abs(dx) <= 4 + 3 && Math.abs(dy) <= 4 + 3 && (dx >= 3 || dx <= -3 || dy >= 3 || dy <= -3)) { const q = BSU.buildings.place(s, 'bunkhouse', x, y, { rot: 0, ignoreCash: true }); if (q && q.ok) placed = { x, y }; }
  }
  ok(!!placed, 'a Bunkhouse fits near the Suites');
  if (placed) {
    for (const b of BSU.buildings.list(s)) b.built = 1;
    BSU.buildings.recomputeCoverage && BSU.buildings.recomputeCoverage(s);
    const A2 = BSU.buildings.auras(s);
    ok(A2.life[BSU.idx(su.tx + 1, su.ty + 1)] <= 2, 'the Bunkhouse takes 1 off the Suites tiles it reaches (' + A2.life[BSU.idx(su.tx + 1, su.ty + 1)] + ')');
    ok(Array.from(A2.life).every((v) => v >= 0 && Number.isFinite(v)), 'no aura value goes negative or non-finite');
  }
}

// --- 7. the build menu's 'Needed now' badge: a parking squeeze also points at the premium Suites ----------------------------
{
  const s = fresh(); s.economy.students = 900;
  const real = BSU.economy.capacity;
  BSU.economy.capacity = () => ({ capacity: 5000, beds: 5000, seats: 5000, dining: 5000, wastewater: 5000 });   // every capacity term comfortable, so parking binds
  try {
    BSU.ui.update(s, 100000);
    const nd = BSU.ui._ux.needsOf(s), reco = BSU.ui._ux.recommend(s);
    ok(nd.binding.key === 'parking' && /0 \/ 2 lots/.test(nd.binding.text), 'parking binds with 900 students and no lot (' + nd.binding.text + ')');
    ok(reco.parking === 'Needed' && reco.suites === 'Needed', 'the badge lands on the Parking Lot and on Magnolia Suites');
    s.economy.students = 500; BSU.ui.update(s, 200000);
    ok(!BSU.ui._ux.recommend(s).suites, 'no parking squeeze (and the Suites still locked): no Suites badge');
  } finally { BSU.economy.capacity = real; }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
