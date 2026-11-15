// Unit test for the goal steps pass (Josh, 2026-11-15: stuck on Objective 20, "cant figure out how to build stadium"):
//  (1) progress.goalSteps(state, id): every goal the card can show returns its ordered steps (≥ 1, at most one current, done steps first,
//      capped text, needs / note / action only on the current step), in several game states, without changing the state;
//  (2) progress.unlockReason: a tier is an upgrade ("Upgrade the Practice Field to Bayou Field"), and the Build sheet's locked Stadium card says so;
//  (3) the stadium chain (Practice Field → Bayou Field → Stadium → The Cauldron → a night game) in each of its states: the current step,
//      its needs with live numbers, its action; the "no site on your land" needs (a road, the Land Office);
//  (4) buildings.upgradeQuote (pure) and buildings.upgrade's reasons; the inspect card's priced button, its disabled state and reason,
//      "Upgrading to … · done in N days", nothing at the top tier;
//  (5) the first night game cannot be missed: scripted when the upgrade finishes with no Sep / Oct home game ahead, re-picked when the
//      scripted game is cancelled or postponed, picked up when a new season's schedule arrives; a night game resolved off-screen counts;
//  (6) the card's DOM: the steps list on the foreground (interrupt) card and on the "in the background" card, aria-current, the one button in
//      the current step, the fold ("2 done"), the pill's second line; the button arms the tool / opens the inspect card with the lit, priced
//      upgrade / opens Season on the Night games switch; no camera move except the one the click asks for.
// Usage: node build.mjs --check && node test/unit/goal_steps.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { win } = loadGame();
const BSU = win.BSU, U = BSU.ui, PR = BSU.progress, B = BSU.buildings, H = BSU.headless, SP = BSU.sports, EC = BSU.economy;
const TPD = BSU.params.time.ticksPerDay;
const errs = () => [...BSU.errors.keys()];
const fresh = (size = 96) => { BSU.session.newGame({ seed: 42, skipTutorial: true, size }); U.showTitle(false); U.update(BSU.state, 50); return BSU.state; };
const setStudents = (s, n) => { s.economy.students = n; };
const cur = (st) => st.find((x) => x.current) || null;
const texts = (st) => st.map((x) => x.text);
const deepText = (el) => !el ? '' : (el.children && el.children.length ? el.children.map(deepText).join(' ') : String(el.textContent || ''));
const click = (el) => el.dispatchEvent({ type: 'click' });
const ALL_IDS = () => BSU.OBJECTIVE_IDS.concat(['land1', 'p1', 'p2', 'p3', 'sink1']).concat(BSU.data.voiceCards.map((v) => 'v:' + v.id));
const KINDS = new Set(['build', 'inspect', 'panel', 'show']);
/** place a footprint where the game allows it (the UI's own validation path) and finish it */
const place = (s, id) => { const p = H.findSpot(id); if (!p) return null; const r = H.place(id, p.x, p.y); return r && r.ok ? B.list(s, id)[B.list(s, id).length - 1] : null; };
const finish = (b) => { b.built = 1; b.builtDay = BSU.state.calendar.day; };

/** the invariants every goalSteps result must hold */
function checkSteps(s, id, tag) {
  const st = PR.goalSteps(s, id, { sites: true });
  const bad = [];
  if (!Array.isArray(st) || st.length < 1) return ['no steps'];
  const curs = st.filter((x) => x.current);
  if (curs.length > 1) bad.push(curs.length + ' current steps');
  const firstTodo = st.findIndex((x) => !x.done);
  if (firstTodo >= 0 && !st[firstTodo].current) bad.push('the first step not done is not the current one');
  if (firstTodo < 0 && curs.length) bad.push('a current step although every step is done');
  if (firstTodo >= 0 && st.slice(firstTodo).some((x) => x.done)) bad.push('a done step follows the current one');
  for (const x of st) {
    if (typeof x.id !== 'string' || !x.id) bad.push('a step without an id');
    if (typeof x.text !== 'string' || !x.text || x.text.length > PR.STEP_TEXT_MAX) bad.push('text length ' + (x.text || '').length + ' "' + x.text + '"');
    if (/Stadium II|Stadium III|Tier \d/.test(x.text)) bad.push('a tier number in "' + x.text + '"');
    if (!Array.isArray(x.needs) || x.needs.some((n) => typeof n !== 'string' || !n)) bad.push('needs is not a list of strings');
    if (typeof x.note !== 'string') bad.push('note is not a string');
    if (x.action !== null && !(x.action && KINDS.has(x.action.kind))) bad.push('action kind ' + JSON.stringify(x.action));
    if (!!x.action !== (x.actionLabel !== '')) bad.push('actionLabel "' + x.actionLabel + '" for action ' + JSON.stringify(x.action));
    if (!x.current && (x.needs.length || x.note || x.action)) bad.push('needs / note / action on a step that is not current: ' + x.text);
    if (x.action && x.action.kind === 'build' && !BSU.data.catalog[x.action.tool]) bad.push('build action with an unknown tool ' + x.action.tool);
    if (x.action && x.action.kind === 'inspect' && !B.get(s, x.action.buildingId)) bad.push('inspect action on a missing building');
  }
  if (new Set(st.map((x) => x.id)).size !== st.length) bad.push('duplicate step ids');
  return bad.map((b) => tag + ' ' + id + ': ' + b);
}
const sweep = (s, tag) => { const out = []; for (const id of ALL_IDS()) for (const b of checkSteps(s, id, tag)) out.push(b); return out; };
const snap = (s) => JSON.stringify([s.progress, s.economy, s.sports.scriptedNightDay, s.sports.schedule, s.buildings.map((b) => b && [b.type, b.tier, b.built, b.upgradeDoneDay]), s.ui.tool, s.ui.panel, s.ui.camera, s.calendar, s.ticker.length]);

// --- (1) coverage and invariants ------------------------------------------------------------------------------------------------------
console.log('--- (1) every goal has steps ---');
let s = fresh();
{
  eq(ALL_IDS().length, 25 + 5 + 12, 'the goals a card can show: 25 objectives + land1 / p1 / p2 / p3 / sink1 + 12 Student Voice goals');
  let bad = sweep(s, 'fresh'); ok(bad.length === 0, 'a fresh game: every goal returns ≥ 1 step, ≤ 1 current, done first, capped text' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
  const before = snap(s); for (const id of ALL_IDS()) PR.goalSteps(s, id, { sites: true });
  ok(snap(s) === before, 'goalSteps changes nothing (progress, economy, schedule, buildings, tool, panel, camera, ticker)');
  setStudents(s, 1700); H.tick(5);
  bad = sweep(s, '1,700 students'); ok(bad.length === 0, '1,700 students: the invariants hold' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
  s.economy.cash = -1.9e6;
  bad = sweep(s, 'broke'); ok(bad.length === 0, 'no cash: the invariants hold' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
  ok(PR.goalSteps(s, 'nope').length === 0 && PR.goalSteps(null, '20').length === 0 && PR.goalSteps(s, 20).length === 0 && PR.goalSteps(s, 'v:nobody').length === 0, 'an unknown goal, a missing state, a non-string id → []');
  const t0 = Date.now(); for (let k = 0; k < 200; k++) PR.goalSteps(s, '20', { sites: true }); const ms = (Date.now() - t0) / 200;
  ok(ms < 2, 'goalSteps is cheap: ' + ms.toFixed(3) + ' ms a call for Objective 20 with the site scan cached');
  ok(texts(PR.goalSteps(s, '3')).join('|') === 'Build a Freshman Dorm|Build a Dining Hall' || PR.goalSteps(s, '3').every((x) => /^Build a (Freshman Dorm|Dining Hall)$/.test(x.text)), 'a simple goal lists one step per required building, by its real name: ' + texts(PR.goalSteps(s, '3')).join(' · '));
  ok(/ · 0 of 5$/.test(PR.goalSteps(s, '6')[0].text) && PR.goalSteps(s, '6')[0].action.tool === 'live_oak', 'a counted goal shows its count and arms its tool: ' + PR.goalSteps(s, '6')[0].text);
  ok(/ · 0 of 20$/.test(PR.goalSteps(s, '16')[0].text) && PR.goalSteps(s, '16')[0].action.tool === 'preserve', 'Preserve it: ' + PR.goalSteps(s, '16')[0].text);
  const l1 = cur(PR.goalSteps(s, 'land1')); ok(l1 && l1.action.kind === 'panel' && l1.action.panel === 'land' && l1.actionLabel === 'Open the Land Office', 'the charter goal opens the Land Office');
  const g21 = cur(PR.goalSteps(s, '21')); ok(g21 && g21.action.kind === 'panel' && g21.action.panel === 'milestones' && /Fortress Bayou or the Living With Water milestone/.test(g21.needs.join(' ')) && /12 ft ring with 40 Concrete Floodwall tiles \(you have \d+\)\. Living With Water: ecology 75 \(you have \d+\)/.test(g21.note), 'Choose your bayou: the two milestones, with what each takes: ' + g21.note);
  const g12 = PR.goalSteps(s, '12'); ok(g12.length === 5 && g12.some((x) => /Board Up/.test(x.text)) && g12.some((x) => /Evacuate/.test(x.text)), 'Cone of concern lists its five checks');
  const g14 = PR.goalSteps(s, '14'); ok(g14.length === 1, 'Repair all storm damage is one step');
  eq(errs().filter((e) => /progress|buildings/.test(e)).length, 0, 'no BSU.error from progress / buildings: ' + errs().join(', '));
}

// --- (2) the unlock wording ---------------------------------------------------------------------------------------------------------
console.log('--- (2) unlockReason ---');
s = fresh();
{
  setStudents(s, 150);
  eq(PR.unlockReason(s, 'stadium'), 'Reach 600 students and build a Practice Field, then upgrade it to Bayou Field', 'no field, 150 students');
  setStudents(s, 1700); s.economy.cash = 3e7;
  eq(PR.unlockReason(s, 'stadium'), 'Build a Practice Field, then upgrade it to Bayou Field', 'no field, 1,700 students (it used to say "Build the Bayou Field")');
  eq(PR.unlockNeeds(s, BSU.data.catalog.stadium.unlock).join(' | '), 'Bayou Field (build a Practice Field and upgrade it)', 'unlockNeeds, no field');
  U.openBuildMenu(s, { focus: 'stadium' }); U.update(s, 50);
  const cardText = deepText(U.el.bmCards.stadium);
  ok(/Unlocks: Build a Practice Field, then upgrade it to Bayou Field/.test(cardText), 'the Build sheet\'s locked Stadium card shows it: ' + cardText.replace(/\s+/g, ' ').slice(0, 140));
  ok(U._ux.effectLines(BSU.data.catalog.stadium).some((l) => /^Upgrade to The Cauldron: 45,000 seats, \$8M, night games$/.test(l)) && U._ux.effectLines(BSU.data.catalog.stadium).some((l) => /^Opens as Red Stick Stadium/.test(l)) && !U._ux.effectLines(BSU.data.catalog.stadium).some((l) => /Tier \d/.test(l)), 'the Build sheet names the tiers as upgrades, no "Tier 2"');
  U.closeBuildMenu();
  const pf = place(s, 'practice_field'); ok(!!pf, 'a Practice Field is placed');
  eq(PR.unlockReason(s, 'stadium'), 'Upgrade the Practice Field to Bayou Field', 'a field stands');
  eq(PR.unlockNeeds(s, BSU.data.catalog.stadium.unlock).join(' | '), 'Bayou Field (upgrade the Practice Field)', 'unlockNeeds, a field stands');
  finish(pf); pf.tier = 1;
  eq(PR.unlockReason(s, 'stadium'), '', 'Bayou Field stands: the Stadium is unlocked');
  eq(PR.unlockReason(s, 'library'), '', 'an unlocked row has no reason');
  setStudents(s, 500); eq(PR.unlockReason(s, 'library'), 'Reach 800 students', 'a student lock reads as before');
  eq(BSU.data.objectives['20'].text, 'Upgrade the Stadium to The Cauldron and play a night game.', 'Objective 20 names the building');
  ok(!/Stadium I/.test(BSU.data.milestones.find((m) => m.id === 'nightFalls').text) && !/\bI{1,3}:/.test(BSU.data.catalog.stadium.desc), 'no "Stadium II" in the milestone or the Stadium\'s description');
}

// --- (3) the stadium chain ----------------------------------------------------------------------------------------------------------
console.log('--- (3) the stadium chain ---');
s = fresh();
let pfId = -1, stId = -1;
{
  const G = () => PR.goalSteps(s, '20', { sites: true });
  setStudents(s, 1700); s.economy.cash = 16e6;
  let st = G();
  eq(texts(st).join(' | '), 'Build a Practice Field | Upgrade the Practice Field to Bayou Field | Build a Stadium | Upgrade the Stadium to The Cauldron | Play a night game', 'the five steps, in order, by their real names');
  ok(cur(st).id === 'build:practice_field' && cur(st).action.kind === 'build' && cur(st).action.tool === 'practice_field' && cur(st).actionLabel === 'Build it' && cur(st).needs.length === 0, '1,700 students, no field: the current step is Build a Practice Field, button Build it');
  setStudents(s, 150); st = G();
  ok(cur(st).needs.join() === '200 students (you have 150)' && cur(st).action === null, 'too few students: "200 students (you have 150)", no button');
  setStudents(s, 1700); s.economy.cash = -1.9e6; st = G();
  ok(cur(st).needs.join() === '$200k (you have $0 + $100k loan line)' && cur(st).action === null, 'no cash: "' + cur(st).needs.join() + '", no button');
  s.economy.cash = 16e6;
  const pf = place(s, 'practice_field'); pfId = pf.id; st = G();
  ok(st[0].done && cur(st).id === 'upgrade:practice_field' && cur(st).action.kind === 'inspect' && cur(st).action.buildingId === pf.id && cur(st).action.highlight === 'upgrade', 'the field is placed: step 1 ticked, the current step is the Bayou Field upgrade, its action opens the field\'s card on the upgrade');
  ok(/still under construction/.test(cur(st).note) && cur(st).needs.length === 0, 'while it is being built the step says so: ' + cur(st).note);
  finish(pf); st = G();
  ok(cur(st).needs.length === 0 && cur(st).note === '' && cur(st).actionLabel === 'Take me there', 'the field is finished: nothing missing, button Take me there');
  setStudents(s, 300); st = G(); eq(cur(st).needs.join(), '400 students (you have 300)', 'the upgrade\'s own unlock, live');
  setStudents(s, 1700); s.economy.cash = -1.5e6; st = G(); eq(cur(st).needs.join(), '$600k (you have $0 + $500k loan line)', 'the upgrade\'s price, live');
  s.economy.cash = 16e6;
  const up = B.upgrade(s, pf.id); ok(up.ok && up.tier === 1, 'the upgrade is bought'); st = G();
  ok(cur(st).id === 'upgrade:practice_field' && /^Under way: done in 6 days$/.test(cur(st).note) && cur(st).action.kind === 'inspect', 'during the upgrade: "' + cur(st).note + '"');
  pf.tier = 1; pf.upgradeDoneDay = -1; pf.name = 'Bayou Field';
  // Build a Stadium: the site scan decides the button. First with a road within reach of free ground (the fresh map's Highway 1 stub), then with no road at all
  { const t0 = Date.now(), sc0 = B.siteScan(s, 'stadium'), ms = Date.now() - t0; st = G();
    ok(sc0 && sc0.ok && sc0.rot === 0 && B.canPlace(s, 'stadium', sc0.tx, sc0.ty, { rot: 0, ignoreCash: true }).ok && cur(st).action.kind === 'build' && cur(st).action.tool === 'stadium', 'a fresh map has a Stadium site by the highway: the scan finds it (' + sc0.tx + ',' + sc0.ty + ') and the button is Build it');
    ok(ms < 80, 'an uncached site scan is budgeted: ' + ms + ' ms');
    const t1 = Date.now(); for (let k = 0; k < 500; k++) B.siteScan(s, 'stadium'); ok(Date.now() - t1 < 25 && B.siteScan(s, 'stadium') === sc0, 'and cached until a tile, a building, the charter or the day changes (500 calls in ' + (Date.now() - t1) + ' ms)');
    for (let i = 0; i < s.tiles.surface.length; i++) if (s.tiles.surface[i] === BSU.SURF.ROAD) BSU.terrain.setSurface(s, i, BSU.SURF.NONE);   // no road anywhere
  }
  const sc = B.siteScan(s, 'stadium'); st = G();
  ok(!sc.ok && sc.need === 'road' && sc.at && /^Needs a Road within 4/.test(B.canPlace(s, 'stadium', sc.at.tx, sc.at.ty, { rot: sc.at.rot, ignoreCash: true }).reason), 'with no road on the map the scan says so and names a free site refused only for the road rule');
  ok(st[0].done && st[1].done && cur(st).id === 'build:stadium', 'Bayou Field stands: the current step is Build a Stadium');
  ok(sc && typeof sc.ok === 'boolean' && sc.w === 6 && sc.h === 5, 'siteScan answers for the Stadium: ' + JSON.stringify({ ok: sc.ok, need: sc.need, at: sc.at }));
  if (sc.ok) ok(cur(st).action.kind === 'build' && cur(st).action.tool === 'stadium', 'a site exists: Build it');
  else if (sc.need === 'road') {
    ok(cur(st).needs.join() === 'a Campus Road within 4 tiles of a free 6 × 5 site' && cur(st).action.kind === 'show' && cur(st).action.tiles.length === 30 && cur(st).actionLabel === 'Show me the site' && /Lay a Campus Road/.test(cur(st).note), 'no site by a road: the step says so and shows the free site: ' + cur(st).needs.join() + ' · ' + cur(st).note);
    ok(PR.goalSteps(s, '20', {}).find((x) => x.current).action.kind === 'build', 'without opts.sites (card folded) the scan is not run: Build it');
    // lay a road beside the shown site: the step flips to Build it
    const a = sc.at, W = BSU.MAP.W; let laid = false;
    for (let y = a.ty - 4; y <= a.ty + 8 && !laid; y++) for (let x = a.tx - 4; x <= a.tx + 7 && !laid; x++) {
      if (y >= a.ty - 1 && y <= a.ty + 5 && x + 2 >= a.tx - 1 && x <= a.tx + 6) continue;
      const tiles = [y * W + x, y * W + x + 1, y * W + x + 2], q = B.runQuote(s, 'road', tiles, {});
      if (q && q.placed === 3 && !q.refused) { B.placeRun(s, 'road', tiles, {}); laid = true; }
    }
    ok(laid, 'a 3-tile Campus Road is laid within 4 tiles of the shown site');
    const sc2 = B.siteScan(s, 'stadium'); st = G();
    ok(sc2.ok && cur(st).action.kind === 'build' && cur(st).action.tool === 'stadium' && cur(st).needs.length === 0, 'with the road the scan finds the site at once (the cache follows tile changes) and the button is Build it');
  } else ok(cur(st).action.kind === 'panel' && cur(st).action.panel === 'land', 'no free ground: the Land Office');
  // the two refusals, forced: the scan is the only thing consulted
  const real = B.siteScan;
  B.siteScan = () => ({ ok: false, tx: -1, ty: -1, rot: 0, w: 6, h: 5, need: 'land', at: null });
  st = G(); ok(cur(st).needs.join() === 'a free 6 × 5 site with a Campus Road within 4 tiles' && /buy a section at the Land Office/.test(cur(st).note) && cur(st).action.kind === 'panel' && cur(st).action.panel === 'land' && cur(st).actionLabel === 'Open the Land Office', 'no site left on the land: "' + cur(st).note + '", button Open the Land Office');
  B.siteScan = () => ({ ok: false, tx: -1, ty: -1, rot: 0, w: 6, h: 5, need: 'road', at: { tx: 10, ty: 10, rot: 1 } });
  st = G(); ok(cur(st).action.kind === 'show' && cur(st).action.tiles.length === 30 && /press R/.test(cur(st).note), 'a turned site is said to be turned: ' + cur(st).note);
  B.siteScan = real;
  s.economy.cash = -0.5e6; st = G(); ok(cur(st).needs.join() === '$2M (you have $0 + $1.5M loan line)' && cur(st).action === null, 'the Stadium\'s price, live: ' + cur(st).needs.join());
  s.economy.cash = 16e6;
  const stad = place(s, 'stadium'); ok(!!stad, 'the Stadium is placed' + (stad ? ' at ' + stad.tx + ',' + stad.ty : '')); stId = stad ? stad.id : -1; st = G();
  ok(st.filter((x) => x.done).length === 3 && cur(st).id === 'upgrade:stadium' && /still under construction/.test(cur(st).note) && cur(st).action.buildingId === stId, 'the Stadium is placed: three steps ticked, the current step is the Cauldron upgrade (still under construction)');
  finish(stad); s.economy.cash = 1.2e6; st = G();
  eq(cur(st).needs.join(), '$8M (you have $1.2M + $2M loan line)', 'the Cauldron\'s price, live');
  setStudents(s, 1240); st = G(); eq(cur(st).needs.join(' | '), '1,500 students (you have 1,240) | $8M (you have $1.2M + $2M loan line)', 'the Cauldron\'s unlock and price together');
  setStudents(s, 1700); s.economy.cash = 16e6; st = G();
  ok(cur(st).needs.length === 0 && cur(st).action.kind === 'inspect' && cur(st).action.highlight === 'upgrade' && cur(st).actionLabel === 'Take me there', 'everything is there: Take me there');
  ok(B.upgrade(s, stad.id).ok, 'the Cauldron upgrade is bought'); st = G();
  ok(/^Under way: done in 6 days$/.test(cur(st).note), 'during the upgrade: ' + cur(st).note);
  // the field is demolished: its steps stay ticked (the Stadium no longer needs it)
  const keep = s.buildings[pfId]; s.buildings[pfId] = null; st = G();
  ok(st[0].done && st[1].done && cur(st).id === 'upgrade:stadium', 'with the Practice Field gone its two steps stay ticked'); s.buildings[pfId] = keep;
  stad.tier = 2; stad.upgradeDoneDay = -1; stad.closedUntil = -1; stad.name = 'The Cauldron'; st = G();
  ok(st.filter((x) => x.done).length === 4 && cur(st).id === 'night' && cur(st).text === 'Play a night game', 'The Cauldron stands: the current step is the night game');
  const bad = sweep(s, 'cauldron'); ok(bad.length === 0, 'the invariants hold with The Cauldron standing' + (bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''));
}

// --- (4) upgradeQuote and the inspect card ------------------------------------------------------------------------------------------
console.log('--- (4) upgradeQuote ---');
s = fresh();
{
  setStudents(s, 1700); s.economy.cash = 16e6;
  const dorm = B.list(s, 'dorm')[0] || place(s, 'dorm');
  let q = B.upgradeQuote(s, dorm.id); ok(!q.ok && q.next === null && q.reason === 'Nothing to upgrade' && q.needs.length === 0 && !q.inProgress, 'a building without tiers: nothing to upgrade');
  q = B.upgradeQuote(s, 9999); ok(!q.ok && q.reason === 'Pick a building', 'an unknown id');
  const pf = place(s, 'practice_field');
  q = B.upgradeQuote(s, pf.id); ok(!q.ok && q.reason === 'Still under construction' && q.next && q.next.name === 'Bayou Field', 'under construction: refused, the next tier still named');
  finish(pf);
  const cash0 = s.economy.cash, js0 = JSON.stringify(pf);
  q = B.upgradeQuote(s, pf.id);
  ok(q.ok && q.reason === '' && q.needs.length === 0 && !q.inProgress && q.doneDay === -1, 'a finished field with the students and the cash: ok');
  eq(JSON.stringify(q.next), JSON.stringify({ tier: 1, name: 'Bayou Field', cost: 600000, upkeep: 4000, seats: 6000, night: false, buildDays: 6 }), 'next: the tier, its name, price, upkeep, seats, night, build days');
  ok(s.economy.cash === cash0 && JSON.stringify(pf) === js0, 'the quote charges nothing and changes nothing');
  setStudents(s, 300); q = B.upgradeQuote(s, pf.id);
  ok(!q.ok && q.needs.join() === '400 students (you have 300)' && q.reason === 'Needs 400 students (you have 300)', 'locked: a concrete, live need: ' + q.reason);
  const r = B.upgrade(s, pf.id); ok(!r.ok && r.reason === q.reason && r.reason !== 'Locked' && s.economy.cash === cash0 && pf.upgradeDoneDay === -1, 'upgrade refuses with the same reason, never a bare "Locked", and charges nothing');
  setStudents(s, 1700); s.economy.cash = -1.6e6; q = B.upgradeQuote(s, pf.id);
  ok(!q.ok && q.needs.join() === '$600k (you have $0 + $400k loan line)', 'short of cash: ' + q.reason);
  eq(B.upgrade(s, pf.id).reason, 'Needs $600k (you have $0 + $400k loan line)', 'upgrade says how much is missing, not just "Not enough cash"');
  s.economy.cash = 16e6;
  // the inspect card
  const insp = () => { U.inspect(s, { kind: 'building', id: pf.id }); U.update(s, 600); return { b: win.document.getElementById('btn-insp-upgrade'), up: win.document.getElementById('insp-upgrade') }; };
  const live = (e) => { let p = e; while (p && p !== U.el['insp-actions']) p = p.parentNode; return p === U.el['insp-actions']; };
  let c = insp();
  ok(live(c.b) && c.b.textContent === 'Upgrade to Bayou Field · $600k' && !c.b.disabled, 'the inspect card\'s button: "' + c.b.textContent + '"');
  ok(/6,000 seats/.test(deepText(c.up)) && /6 days to build/.test(deepText(c.up)) && !win.document.getElementById('insp-up-why') || !live(win.document.getElementById('insp-up-why')), 'one line of what it gives, no reason line: ' + deepText(c.up).replace(/\s+/g, ' '));
  ok(!U.el['insp-actions'].children.some((x) => x.textContent === 'Upgrade'), 'the bare "Upgrade" button is gone');
  setStudents(s, 300); c = insp(); const why = win.document.getElementById('insp-up-why');
  ok(live(c.b) && c.b.disabled === true && c.b.getAttribute('aria-disabled') === 'true' && live(why) && why.textContent === 'Needs 400 students (you have 300)', 'it cannot be bought: the button is disabled and the reason is text on the card: ' + (why && why.textContent));
  setStudents(s, 1700); c = insp(); click(c.b); U.update(s, 600);
  ok(pf.upgradeDoneDay === s.calendar.day + 6 && s.economy.cash === 16e6 - 600000, 'the click buys it');
  q = B.upgradeQuote(s, pf.id); ok(!q.ok && q.inProgress && q.doneDay === pf.upgradeDoneDay && q.next.name === 'Bayou Field' && q.reason === 'Upgrade in progress', 'in progress: inProgress, doneDay, the tier being built');
  c = insp(); ok(live(c.up) && !live(c.b) && /^Upgrading to Bayou Field · done in 6 days$/.test(deepText(c.up).trim()), 'the card says "' + deepText(c.up).trim() + '"');
  for (let k = 0; k < 14 && pf.tier < 1; k++) H.tick(TPD);   // the Spring Game's set piece holds the calendar for a while
  U.update(s, 600);
  ok(pf.tier === 1 && pf.name === 'Bayou Field' && s.calendar.day >= pf.builtDay + 6, 'six days later it is Bayou Field');
  q = B.upgradeQuote(s, pf.id); ok(!q.ok && q.next === null && q.reason === 'Top tier', 'the top tier: no next');
  c = insp(); ok(!live(c.up) && !live(c.b), 'the top tier shows nothing');
  ok(/^Pilings · \$/.test((U.el['insp-actions'].children.find((x) => /^Pilings/.test(x.textContent)) || {}).textContent || ''), 'the Pilings button carries its price too');
  U.closeInspect();
}

// --- (5) the night game cannot be missed ----------------------------------------------------------------------------------------------
console.log('--- (5) night-game scripting ---');
s = fresh();
{
  setStudents(s, 1700); s.economy.cash = 5e7;
  const pf = place(s, 'practice_field'); finish(pf); pf.tier = 1;
  const stad = place(s, 'stadium'); ok(!!stad, 'a Stadium stands'); finish(stad);
  H.tick(3);
  const D = (str, y) => BSU.dateToDay(str, y || 1);
  /** jump the calendar to a date, draw that year's remaining schedule, run progress's daily step */
  const at = (str, y) => { s.calendar.day = D(str, y); s.sports.game = null; SP._buildSchedule(s); };
  const daily = () => PR.tick(s, { newDay: true, newMonth: false, newYear: false, day: s.calendar.day });
  const home = () => s.sports.schedule.filter((e) => e.home && !e.played && !e.cancelled).map((e) => BSU.formatDate(e.day).replace(/, Y\d+/, ''));
  const scripted = () => s.sports.scriptedNightDay;
  // tier 1: nothing is scripted
  at('Aug 6'); daily();
  ok(s.sports.hasTeam && home().join() === 'Aug 8,Sep 8,Oct 8,Nov 8', 'a team with four home dates ahead: ' + home().join(' '));
  eq(scripted(), -1, 'Red Stick Stadium (tier 1): no night game is scripted');
  // (a) the upgrade finishes with a Sep / Oct game ahead: the window game, not the nearer Aug 8
  stad.tier = 2; BSU.events.emit('building:upgraded', { id: stad.id, type: 'stadium', tier: 2 }); H.tick(1);
  eq(scripted(), D('Sep 8'), 'The Cauldron completes on Aug 6: the Sep 8 home game is scripted (the first in the Sep / Oct window)');
  ok(s.sports.schedule.find((e) => e.day === D('Sep 8')).night === true && s.sports.schedule.find((e) => e.day === D('Aug 8')).night === false, 'that game is a night game; Aug 8 stays a day game');
  let n = cur(PR.goalSteps(s, '20', {}));
  ok(n.id === 'night' && n.action === null && /^The lights come on Sep 8, Y1 vs /.test(n.note), 'the step waits for it: ' + n.note);
  // (b) the scripted game is cancelled: the next day picks another
  const e9 = s.sports.schedule.find((e) => e.day === D('Sep 8')); e9.played = true; e9.cancelled = true; e9.result = null;
  s.calendar.day += 1; daily();
  eq(scripted(), D('Oct 8'), 'the scripted game is cancelled: Oct 8 is scripted instead');
  // postponed with no makeup date yet: re-picked too
  SP.postpone(s, s.sports.schedule.findIndex((e) => e.day === D('Oct 8'))); s.calendar.day += 1; daily();
  eq(scripted(), D('Aug 8'), 'the scripted game is postponed with no Sep / Oct game left: the next home game of any month (Aug 8, today) is scripted');
  // it passes unplayed (the day is behind): re-picked
  at('Aug 6'); s.sports.scriptedNightDay = D('Aug 2'); daily();
  eq(scripted(), D('Sep 8'), 'a scripted day that is already behind is replaced');
  // (c) the upgrade finishes with no Sep / Oct game ahead (the old code scripted nothing, ever)
  s.sports.scriptedNightDay = -1; at('Oct 9');
  ok(home().join() === 'Nov 8', 'Oct 9: only Nov 8 is ahead');
  BSU.events.emit('building:upgraded', { id: stad.id, type: 'stadium', tier: 2 }); H.tick(1);
  eq(scripted(), D('Nov 8'), 'The Cauldron completes on Oct 9: Nov 8 is scripted');
  // (d) between seasons: nothing to script; the step offers the Night games switch; the new season's schedule is picked up
  s.sports.scriptedNightDay = -1; at('Dec 9'); s.sports.schedule.forEach((e) => { e.played = true; }); daily();
  eq(scripted(), -1, 'Dec 9, every game played: nothing to script yet');
  n = cur(PR.goalSteps(s, '20', {}));
  ok(n.id === 'night' && n.action && n.action.kind === 'panel' && n.action.panel === 'season' && n.action.highlight === 'chk-night' && n.actionLabel === 'Night games switch' && /season opens Aug 8/.test(n.note), 'no home game on the calendar: the fallback is the Night games switch: ' + n.note);
  at('Aug 5', 2); daily();
  eq(scripted(), D('Sep 8', 2), 'the new season\'s schedule arrives on Aug 5, Y2: Sep 8, Y2 is scripted the same day');
  // earned: nothing more is scripted
  PR.achieve(s, 'nightFalls'); s.sports.scriptedNightDay = -1; daily();
  eq(scripted(), -1, 'once Night Falls is earned nothing is scripted');
  ok(PR.goalSteps(s, '20', {}).every((x) => x.done) && !cur(PR.goalSteps(s, '20', {})), 'and every step of Objective 20 is ticked');
  eq(errs().filter((e) => /progress|sports/.test(e)).length, 0, 'no BSU.error from progress / sports: ' + errs().join(', '));
}
// played for real: the scripted night game earns the milestone, with no camera move
s = fresh();
{
  setStudents(s, 1700); s.economy.cash = 5e7;
  const pf = place(s, 'practice_field'); finish(pf); pf.tier = 1;
  const stad = place(s, 'stadium'); finish(stad); stad.tier = 2; H.tick(3);
  PR.complete(s, '6'); H.tick(3); PR.complete(s, '7'); H.tick(3);
  s.calendar.day = BSU.dateToDay('Sep 6', 1); SP._buildSchedule(s);
  const R = BSU.render, calls = []; const real = {};
  for (const fn of ['panTo', 'panToTile', 'followVehicle', 'setZoom']) { real[fn] = R[fn]; R[fn] = function () { calls.push(fn); return real[fn].apply(R, arguments); }; }
  const cam0 = JSON.stringify([s.ui.camera.x, s.ui.camera.y, s.ui.camera.zoom]);
  let days = 0; while (!PR.earned(s, 'nightFalls') && days < 8) { H.tick(TPD); U.update(s, 1200); days++; }
  ok(PR.earned(s, 'nightFalls'), 'the scripted Sep 8 night game is played and Night Falls on the Cauldron is earned (after ' + days + ' days; scripted ' + BSU.formatDate(s.sports.scriptedNightDay) + ')');
  eq(s.progress.objectives['20'].state, 'done', 'Objective 20 is done');
  ok(calls.length === 0 && JSON.stringify([s.ui.camera.x, s.ui.camera.y, s.ui.camera.zoom]) === cam0, 'the script, the game and the card moved the camera 0 times: ' + calls.join(' '));
  for (const fn of Object.keys(real)) R[fn] = real[fn];
  // a night game resolved off-screen (no kickoff event) still counts
  const s2 = fresh(); let got = false; BSU.events.on('milestone:earned', (p) => { if (p.id === 'nightFalls') got = true; }, 'test');
  BSU.events.emit('game:final', { home: true, night: true, venue: 'stadium2', won: true, opp: 'delta' }); H.tick(1);
  ok(got && PR.earned(s2, 'nightFalls'), 'a night home game at The Cauldron that only sends game:final earns it too');
  const s3 = fresh(); BSU.events.emit('game:final', { home: true, night: false, venue: 'stadium2', won: true, opp: 'delta' }); BSU.events.emit('game:final', { home: true, night: true, venue: 'stadium1', won: true, opp: 'delta' }); H.tick(1);
  ok(!PR.earned(s3, 'nightFalls'), 'a day game, or a night flag at a smaller venue, does not');
  BSU.events.clear('test');
}

// --- (6) the card --------------------------------------------------------------------------------------------------------------------
console.log('--- (6) the goal card ---');
s = fresh();
{
  const E = U.el, R = BSU.render;
  const lis = () => E['obj-steps'].children;
  const vis = (e) => { for (let p = e; p; p = p.parentNode) if (p.classList && p.classList.contains('hidden')) return false; return true; };
  const inCard = (e) => { for (let p = e; p; p = p.parentNode) if (p === E['objective-card']) return true; return false; };
  const upd = (ms = 1200) => U.update(s, ms);
  ok(E['obj-steps'] && E['obj-steps'].tagName === 'OL' && E['obj-steps'].getAttribute('aria-label') === 'Steps' && inCard(E['obj-steps']), 'the card holds an ordered list of steps (ol#obj-steps)');
  ok(E['btn-obj-build'] && E['btn-obj-build'].id === 'btn-obj-build' && E['btn-showme'] && E['gp-step'], 'the old button ids stay; the pill has a step line');
  // the foreground (interrupt) card: Objective 6 on a skip-tutorial game
  H.tick(5); U.goalOpen(true); upd();
  const o6 = PR.objective(s);
  ok(o6 && o6.id === '6' && E['objective-card'].dataset.kind === 'interrupt', 'a foreground goal is on the card: ' + (o6 && o6.id));
  ok(lis().length === 1 && lis()[0].getAttribute('aria-current') === 'step' && /Plant Live Oaks beside a path · 0 of 5/.test(deepText(lis()[0])), 'its one step is listed and is the current one: ' + deepText(lis()[0]).replace(/\s+/g, ' '));
  ok(E['btn-obj-build'].parentNode && E['btn-obj-build'].parentNode.parentNode === lis()[0] && vis(E['btn-obj-build']) && E['btn-obj-build'].textContent === 'Build it', 'the step\'s one button sits in the step: "' + E['btn-obj-build'].textContent + '"');
  ok(vis(E['btn-showme']), 'Show me stays beside a Build it step (it pans; the button arms)');
  ok(!E['goal-pill'].classList.contains('has-step') && E['gp-step'].classList.contains('hidden'), 'a one-step goal keeps a one-line pill (its step only repeats the title)');
  click(E['btn-obj-build']); upd(60);
  ok(s.ui.tool && s.ui.tool.id === 'live_oak' && U.buildMenuOpen(), 'clicking it arms the Live Oak with the Build sheet on its card (what Build it did)');
  ok(E['btn-obj-build'].textContent === 'Placing…', 'while the tool is armed the button reads "Placing…"');
  ok(U._ux.goalKeepsTool(s) === true, 'the counted goal still keeps its tool armed (goal pass)');
  U.selectTool(s, null); U.closeBuildMenu(); upd(60);
  // Objective 20 as the "in the background" card
  PR.complete(s, '6'); H.tick(3); PR.complete(s, '7'); H.tick(3); setStudents(s, 1700); s.economy.cash = 16e6; H.tick(5);
  for (let k = 0; k < 6; k++) { const o = PR.objective(s); if (!o || o.id === '20') break; PR.dismiss(s, o.id); H.tick(3); }
  U.goalOpen(true); upd();
  const o20 = PR.objective(s);
  ok(o20 && o20.id === '20' && E['objective-card'].dataset.kind === 'background' && /in the background|New goal/i.test(E['obj-kicker'].textContent), 'Objective 20 is the background goal on the card: ' + E['obj-kicker'].textContent);
  eq(E['obj-text'].textContent, 'Upgrade the Stadium to The Cauldron and play a night game.', 'its text names the building');
  ok(lis().length === 5 && lis().filter((li) => li.getAttribute('aria-current') === 'step').length === 1 && lis()[0].getAttribute('aria-current') === 'step', 'five steps, the first is the current one');
  ok(lis().slice(1).every((li) => !li.classList.contains('cur') && !li.classList.contains('done')) && /Play a night game/.test(deepText(lis()[4])), 'the later steps are plain');
  ok(E['btn-obj-build'].parentNode.parentNode === lis()[0] && E['btn-obj-build'].textContent === 'Build it' && E['btn-obj-build'].getAttribute('aria-label') === 'Build it: Build a Practice Field', 'the button is labelled for its step: ' + E['btn-obj-build'].getAttribute('aria-label'));
  const calls = []; const real = {};
  for (const fn of ['panTo', 'panToTile', 'setZoom', 'followVehicle']) { real[fn] = R[fn]; R[fn] = function () { calls.push(fn); return real[fn].apply(R, arguments); }; }
  click(E['btn-obj-build']); upd(60);
  ok(s.ui.tool && s.ui.tool.id === 'practice_field' && U.buildMenuOpen() && U.focusedCard() === 'practice_field', 'the click arms the Practice Field on the open Build sheet');
  eq(calls.length, 0, 'arming a tool from the step does not move the camera');
  U.selectTool(s, null); U.closeBuildMenu();
  const pf = place(s, 'practice_field'); finish(pf); upd();
  ok(lis()[0].classList.contains('done') && lis()[1].getAttribute('aria-current') === 'step' && /Upgrade the Practice Field to Bayou Field/.test(deepText(lis()[1])), 'the field is built: step 1 is ticked, step 2 is the current one');
  ok(E['btn-obj-build'].textContent === 'Take me there' && !vis(E['btn-showme']), 'its button is Take me there; Show me is folded into it');
  eq(calls.length, 0, 'the steps refreshed on their own without a camera move');
  click(E['btn-obj-build']); upd(60);
  ok(calls.filter((c) => c === 'panToTile').length === 1 && !calls.includes('setZoom') && !calls.includes('followVehicle'), 'the click pans to the field once (the player\'s own click): ' + calls.join(' '));
  const ub = win.document.getElementById('btn-insp-upgrade');
  ok(vis(E.inspect) && ub && ub.textContent === 'Upgrade to Bayou Field · $600k' && !ub.disabled && ub.classList.contains('step-lit'), 'the field\'s inspect card is open with the priced upgrade lit: ' + (ub && ub.textContent));
  ok(U.goalExpanded() === false && vis(E['goal-pill']) && /^Next: Upgrade the Practice Field to Bayou Field$/.test(E['gp-step'].textContent), 'the goal card folds to its pill (one card on the left edge), which still names the step');
  ok(pf.upgradeDoneDay === -1 && pf.tier === 0, 'nothing is bought until the player clicks the upgrade');
  const cashB = s.economy.cash; click(ub); upd(600);
  ok(pf.upgradeDoneDay >= 0 && s.economy.cash === cashB - 600000, 'the player\'s click buys it');
  ok(!win.document.getElementById('btn-insp-upgrade') || !vis(win.document.getElementById('btn-insp-upgrade')) || win.document.getElementById('btn-insp-upgrade').parentNode.parentNode !== E['insp-actions'], 'the lit button is gone once it is bought');
  // one card on the left edge at a time
  U.goalOpen(true); upd(60); ok(U.goalExpanded() && U.inspectCollapsed(), 'opening the goal card folds the inspect card to its pill');
  U.inspect(s, { kind: 'building', id: pf.id }); upd(60); ok(!U.goalExpanded() && !U.inspectCollapsed(), 'opening an inspect card folds the goal card');
  U.closeInspect();
  // the fold: a chain longer than four steps shows its finished steps as one row
  pf.tier = 1; pf.upgradeDoneDay = -1; U.goalOpen(true); upd();
  ok(lis().length === 4 && lis()[0].classList.contains('sum') && /2 done/.test(deepText(lis()[0])) && lis()[1].getAttribute('aria-current') === 'step' && /Build a Stadium/.test(deepText(lis()[1])), 'two steps done of five: they fold to "2 done", the Stadium step is the current one');
  ok(/^3$/.test(deepText(lis()[1].children[0]).trim()), 'the current step keeps its own number (3)');
  // the night game step: no schedule → the Night games switch on the Season panel
  const stad = place(s, 'stadium'); finish(stad); stad.tier = 2; H.tick(3); s.sports.schedule.forEach((e) => { e.played = true; }); s.sports.scriptedNightDay = -1; U.goalOpen(true); upd();
  ok(/4 done/.test(deepText(lis()[0])) && /Play a night game/.test(deepText(lis()[1])) && E['btn-obj-build'].textContent === 'Night games switch', 'The Cauldron stands, nothing on the calendar: the button is the Night games switch');
  ok(win.document.getElementById('obj-step-note') && /Night games On/.test(win.document.getElementById('obj-step-note').textContent), 'with the note that says why');
  calls.length = 0; click(E['btn-obj-build']); upd(60);
  const sw = win.document.getElementById('chk-night');
  ok(U.panel() === 'season' && U.sheetState() === 'panel' && sw && sw.classList.contains('step-lit') && sw.disabled === false, 'the click opens the Menu sheet on Season with the Night games switch lit');
  ok(vis(win.document.getElementById('sea-tab-overview')), 'on the Overview tab, where the switch is');
  eq(calls.length, 0, 'a panel step does not move the camera');
  click(sw); upd(60); ok(s.sports.nightToggle === true, 'the player flips it');
  upd(10000); ok(!sw.classList.contains('step-lit'), 'the light goes out on its own after a few seconds');
  U.openPanel(null);
  // a set piece hides the button; a milestone view has no steps
  for (const fn of Object.keys(real)) R[fn] = real[fn];
  PR.achieve(s, 'nightFalls'); H.tick(5); upd();
  ok(s.progress.objectives['20'].state === 'done', 'Objective 20 completes when the milestone is earned');
  eq(errs().filter((e) => /ui|progress|buildings/.test(e)).length, 0, 'no BSU.error from ui / progress / buildings: ' + errs().join(', '));
}
// the sheet: tokens only, the lit ring honours Reduce motion, a step never touches the camera on its own
{
  const css = readFileSync(join(here, '..', '..', 'src', 'style.css'), 'utf8');
  const mine = css.split('\n').filter((l) => /\.obj-steps|\.st-n|\.st-b|\.st\.|\.st-need|\.step-lit|\.insp-up|\.up-gain|#goal-pill\.has-step|#goal-pill \.step/.test(l)).join('\n');
  ok(mine.length > 400 && !/#[0-9a-fA-F]{3,8}\b/.test(mine) && !/rgba?\(/.test(mine), 'the new rules use the light theme tokens only (no literal colours)');
  ok(/\.step-lit\{[^}]*box-shadow:[^}]*var\(--primary\)[^}]*animation:step-lit/.test(css) && /@media \(prefers-reduced-motion: reduce\)\{body:not\(\.motion-on\) \.step-lit\{animation:none\}\}/.test(css) && /body\.reduce-motion \*[^{]*\{[^}]*animation-iteration-count:1 !important/.test(css), 'a lit control keeps a steady ring under Reduce motion (the setting and the system preference); the pulse is animation only');
  ok(Buffer.byteLength(css) <= 108 * 1024, 'style.css stays under its 108 KB cap (' + (Buffer.byteLength(css) / 1024).toFixed(1) + ' KB)');
  const src = PR.goalSteps.toString() + PR.unlockNeeds.toString() + B.upgradeQuote.toString() + B.siteScan.toString();
  ok(!/render|panTo|camera/.test(src), 'goalSteps, unlockNeeds, upgradeQuote and siteScan never touch the camera');
  ok(U.el['obj-steps'].getAttribute('role') === 'list', 'the steps list keeps its list role');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
