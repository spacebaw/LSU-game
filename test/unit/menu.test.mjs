// Dining menus pass (PLAN_V2 P6) on the real, built game in the Node DOM stub: the three presets' throughput /
// cost / appeal on a 1,200 hall, the Dining gauge (economy.capacity) following the card, the Food ledger line,
// the applicant bonus, the hall's happiness aura, the festival special, and a save / load round trip of menus.
// Usage: node build.mjs --check && node test/unit/menu.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { win } = loadGame();
const BSU = win.BSU, H = BSU.headless, B = BSU.buildings, E = BSU.economy, D = BSU.data, PM = BSU.params.econ.menu, TPD = BSU.params.time.ticksPerDay;
const fresh = () => { BSU.session.newGame({ seed: 42, skipTutorial: true }); const s = BSU.state; s.economy.cash = 90e6; s.economy.suppressCoverage = true; return s; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= (tol == null ? 1e-6 : tol), `${msg} (got ${a}, want ${b})`);

// --- 1. the three presets on a 1,200 hall ---------------------------------------------------------------------
{
  const s = fresh(); s.economy.students = 1200;
  const sp = H.findSpot('dining_hall'); ok(!!sp, 'a legal Dining Hall site exists');
  const r = H.place('dining_hall', sp.x, sp.y); ok(r && r.ok, 'a Dining Hall places (' + (r && r.reason) + ')');
  const hall = B.list(s, 'dining_hall').slice(-1)[0];
  for (const b of B.list(s)) b.built = 1;
  H.tick(2);
  const costOf = (ids) => ids.reduce((a, id) => a + D.dishes.find((d) => d.id === id).cost, 0) / ids.length;
  const expect = { cheap: { tp: 2400, appeal: 1, cost: costOf(D.menuPresets.cheap.dishes) }, classic: { tp: 1200, appeal: 2.3, cost: costOf(D.menuPresets.classic.dishes) }, chef: { tp: 800, appeal: 4, cost: costOf(D.menuPresets.chef.dishes) } };
  const got = {};
  for (const k of ['cheap', 'classic', 'chef']) {
    ok(B.applyMenuPreset(s, hall.id, k).ok, `preset ${k} applies`);
    s.tick++;
    const m = B.menuOf(s, hall.id), cap = E.capacity(s), fc = E.foodCost(s), fo = E.foodCostOf(s, hall.id), bonus = E.menuAppeal(s);
    got[k] = { tp: m.throughput, appeal: m.meanAppeal, cost: m.meanCost, dining: cap.dining, food: fc.total, foodHall: fo.total, bonus: bonus, applicants: E.applicants(s) };
    eq(m.throughput, expect[k].tp, `${D.menuPresets[k].name}: throughput a day`);
    near(m.meanAppeal, expect[k].appeal, 1e-9, `${D.menuPresets[k].name}: mean appeal`);
    near(m.meanCost, expect[k].cost, 1e-9, `${D.menuPresets[k].name}: mean cost a plate`);
    eq(cap.dining, Math.round(expect[k].tp * BSU.params.econ.capacity.dining), `${D.menuPresets[k].name}: the Dining gauge term follows the card`);
    eq(fc.total, Math.round(Math.min(1200, expect[k].tp) * BSU.params.time.daysPerMonth * PM.platesPerStudentDay * expect[k].cost), `${D.menuPresets[k].name}: the month's food bill for 1,200 students`);
    eq(fo.total, fc.total, `${D.menuPresets[k].name}: the only kitchen carries the whole bill`);
  }
  console.log('     numbers on a 1,200 hall with 1,200 students: ' + JSON.stringify(got));
  ok(got.cheap.bonus === 0 && Math.abs(got.classic.bonus - 0.026) < 1e-9 && Math.abs(got.chef.bonus - 0.06) < 1e-9, 'applicant bonus +0 % / +2.6 % / +6 %');
  ok(got.cheap.applicants < got.classic.applicants && got.classic.applicants < got.chef.applicants, `applicants monotone in appeal (${got.cheap.applicants} < ${got.classic.applicants} < ${got.chef.applicants})`);
  ok(got.cheap.dining > got.classic.dining && got.classic.dining > got.chef.dining, 'the Dining gauge squeezes as the card goes premium');
  // the happiness aura inside the dining radius: +3 cheap, +4.3 classic, +6 chef
  const tile = BSU.idx(hall.tx + 1, hall.ty + hall.h + 1);
  const auraOf = (k) => { B.applyMenuPreset(s, hall.id, k); s.tick++; return B.auras(s).life[tile]; };
  near(auraOf('cheap'), 3, 1e-6, 'cheap card: +3 in the dining radius'); near(auraOf('classic'), 4.3, 1e-6, 'Campus Classic: +4.3'); near(auraOf('chef'), 6, 1e-6, "Chef's Table: +6");
  // --- 2. the Food ledger line after a month on the Chef's Table ----------------------------------------------
  s.economy.cash = 90e6;
  // the 1st posts the bill into ledger.month (a hall a gator has closed that day serves and bills nothing); the next 1st closes it into the statement
  let posted = 0, expectedPosted = 0, months = 0;
  while (!posted && months < 8) {
    const d0 = s.calendar.day; while (s.calendar.day < d0 + 10 - (d0 % 10)) H.tick(TPD);   // cross a 1st
    months++;
    const line = s.ledger.month.expense.food, fc = E.foodCost(s), mc = B.menuOf(s, hall.id).meanCost;
    if (fc.total > 0) { posted = line; expectedPosted = Math.round(800 * BSU.params.time.daysPerMonth * PM.platesPerStudentDay * mc); ok(line === fc.total, `${BSU.formatDate(s.calendar.day)}: the Food charge equals foodCost() that day ($${line} vs $${fc.total})`); }
  }
  ok(posted > 0 && posted === expectedPosted, `a month's Food charge posted: 800 plates a day × 10 days × the card's mean cost ($${posted}, want $${expectedPosted}, after ${months} month(s))`);
  { const d0 = s.calendar.day; while (s.calendar.day < d0 + 10 - (d0 % 10)) H.tick(TPD); }
  const st = E.statement(s);
  ok(st.expense.food === posted && Object.keys(st.expense).indexOf('food') === 3, `the Budget statement carries the Food line after utilities ($${st.expense.food}, ${BSU.formatDate(s.calendar.day)})`);
  // --- 3. the festival special joins every hall for its window -------------------------------------------------
  B.applyMenuPreset(s, hall.id, 'cheap');
  s.calendar.day = BSU.dateToDay('Mar 5', BSU.dayParts(s.calendar.day).year + 1); H.tick(2);
  const m = B.menuOf(s, hall.id);
  ok(m.specials.join() === 'crawfish_boil' && m.menu.length === 8 && m.active.length === 9 && m.throughput < 2400, `Mar 5: the crawfish boil joins the cheap card free (8 listed, 9 served, throughput ${m.throughput})`);
  s.calendar.day = BSU.dateToDay('May 1', BSU.dayParts(s.calendar.day).year); H.tick(2);
  ok(B.menuOf(s, hall.id).specials.length === 0 && B.menuOf(s, hall.id).throughput === 2400, 'May 1: the special is gone, 2,400 again');
  // --- 4. save / load round trip of menus ---------------------------------------------------------------------------
  const custom = ['gumbo', 'king_cake', 'sweet_tea', 'gator_sausage'];
  ok(B.setMenu(s, hall.id, custom).ok, 'a custom card');
  const sp2 = H.findSpot('poboy'); const r2 = sp2 && H.place('poboy', sp2.x, sp2.y);
  const shack = B.list(s, 'poboy').slice(-1)[0];
  ok(r2 && r2.ok && shack && B.setMenu(s, shack.id, ['boudin', 'sweet_tea']).ok, 'a shack with a two-dish card');
  const json = BSU.session.save('menu.test');
  ok(typeof json === 'string' && json.length > 1000 && /"menu":\["gumbo","king_cake","sweet_tea","gator_sausage"\]/.test(json), 'the save carries the hall\'s menu verbatim');
  BSU.session.newGame({ seed: 7, skipTutorial: true });
  ok(BSU.session.load('menu.test') !== false, 'the save loads');
  const s2 = BSU.state, hall2 = B.get(s2, hall.id), shack2 = B.get(s2, shack.id);
  ok(hall2 && hall2.data.menu.join() === custom.join() && shack2 && shack2.data.menu.join() === 'boudin,sweet_tea', 'both cards survive the round trip');
  ok(B.menuOf(s2, hall2.id).menu.join() === custom.join(), 'menuOf reads the loaded card');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
