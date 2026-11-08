// Balance / pacing pass (docs/BALANCE_NOTES.md): the numbers and goal ordering the campaign runner showed were dead ends.
// Boots the built index.html headlessly. Usage: node test/unit/balance.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

const { win } = loadGame();
const BSU = win.BSU;
const H = BSU.headless, E = BSU.economy, PR = BSU.progress, B = BSU.buildings, TR = BSU.terrain;
const P = BSU.params, TPD = P.time.ticksPerDay;
const st = (s, id) => (s.progress.objectives[id] || { state: 'locked' }).state;

// --- 1. subsidence: a hall on drained marsh beside a pump must not reach the flood line inside a 15-year campaign ---
{
  const S = P.subsidence;
  const worst = S.drainedBuilt + S.pumpAdd;
  ok(worst <= 0.25, `drained-and-pumped halls sink ≤ 0.25 ft/yr (${worst.toFixed(2)}; was 0.41: −2 ft by Year 10 and flooded for good)`);
  ok(2.5 - 10 * worst > 0, `a 2.5-ft drained tile is still above sea level after 10 years (${(2.5 - 10 * worst).toFixed(2)} ft; the sinking goal fires at 1 ft, around Year 5)`);
  ok(S.wetBuilt <= 0.08 && S.drainedBare <= 0.15, 'wet-built and drained-bare rates eased with it');
  const s = BSU.session.newGame({ seed: 11, skipTutorial: true, size: 64 });
  const tl = s.tiles; let i = -1;
  for (let k = 0; k < tl.type.length; k++) if (tl.type[k] === BSU.T.DRAINED || tl.type[k] === BSU.T.WET) { i = k; break; }
  if (i >= 0) { const r = TR.subsidenceRate(s, i, true); ok(r <= worst + 1e-9 && r >= 0, `terrain.subsidenceRate under a building on tile type ${tl.type[i]} = ${r.toFixed(2)} ft/yr`); }
}

// --- 2. happiness: pump noise is capped like flooding; prestige: blight is capped so a battered campus keeps some applicants ---
{
  const s = BSU.session.newGame({ seed: 12, skipTutorial: true, size: 64 });
  H.tick(TPD);
  const real = B.stats(s);
  const stub = (patch) => Object.assign(Object.create(B), { stats: () => Object.assign({}, real, patch) });
  const saved = E._deps.buildings;
  try {
    E._deps.buildings = stub({ pumpsNearDorms: 21, roadAdjacentDorms: 0, barriersNearDorms: 0 });
    const hr = E._happinessRaw(s);
    ok(hr.terms.noise === -P.econ.happiness.noiseCap, `21 pumps beside dorms read −${P.econ.happiness.noiseCap} happiness, not −42 (got ${hr.terms.noise})`);
    E._deps.buildings = stub({ unrepaired: 40, floodedCore: true }); H.tick(1);   // economy caches stats per tick
    const pt = E._prestigeTarget(s);
    ok(pt.terms.blight === -P.econ.prestige.blight.cap, `40 unrepaired halls + a flooded core read −${P.econ.prestige.blight.cap} blight, not −128 (got ${pt.terms.blight})`);
    E._deps.buildings = stub({ unrepaired: 2 }); H.tick(1);
    ok(E._prestigeTarget(s).terms.blight === -6, 'two unrepaired halls still read −6 (the cap only bites late)');
  } finally { E._deps.buildings = saved; }
}

// --- 3. goal ordering: growth goals jump the football chain in the single background slot; 21 fires at 3,000 ---
{
  ok(P.progress.goals.students21 === 3000, 'Objective 21 (the bayou choice) triggers at 3,000 students (was 5,000: the card went silent from ~2,000 to 5,000)');
  const s = BSU.session.newGame({ seed: 13, skipTutorial: true, size: 64 });
  H.tick(TPD);
  E.addStudents(s, 200, 'debug');   // '15' (Geaux Bayou, background) triggers at 200
  H.tick(TPD);
  ok(s.progress.background === '15' && st(s, '15') === 'active', `'15' holds the background slot (${s.progress.background})`);
  E.addStudents(s, 900, 'debug');   // '17' (wastewater) triggers at 1,000
  H.tick(TPD);
  ok(s.progress.background === '17' && st(s, '17') === 'active', `'17' took the background slot from the football chain (${s.progress.background})`);
  ok(st(s, '15') === 'queued' && s.progress.backgroundQueue[0] === '15', `'15' went back to the front of the queue (${st(s, '15')}, queue ${JSON.stringify(s.progress.backgroundQueue)})`);
  PR.complete(s, '17');
  H.tick(2);
  ok(s.progress.background === '15' && st(s, '15') === 'active', `'15' is re-offered once '17' completes (${s.progress.background})`);
}

// --- 4. the sinking goal: offered when a hall drops a foot without pilings, done when every sunk hall has pilings, re-armed later ---
{
  const s = BSU.session.newGame({ seed: 14, skipTutorial: true, size: 64 });
  const spot = H.findSpot('dorm'); const r = H.place('dorm', spot.x, spot.y);
  ok(r && r.ok, 'a dorm placed for the sinking test');
  H.fastForwardDays(3);
  const dorm = B.list(s, 'dorm')[0];
  ok(dorm && dorm.built >= 1 && !dorm.pilings, 'the dorm is complete and not on pilings');
  ok(st(s, 'sink1') === 'locked', 'no sinking goal while nothing has sunk');
  E.addStudents(s, 1000, 'debug'); H.tick(TPD); H.tick(TPD);   // '17' (a growth goal) holds the background slot
  ok(s.progress.background === '17', `a growth goal holds the background slot before the hall sinks (${s.progress.background})`);
  dorm.sunk = 1.2;
  H.tick(TPD);
  ok(st(s, 'sink1') === 'active' && s.progress.background === 'sink1', `Halls are sinking takes the slot even from a growth goal once a hall is 1.2 ft down (${st(s, 'sink1')}, background ${s.progress.background})`);
  ok(st(s, '17') === 'queued', `the growth goal waits at the front of the queue (${st(s, '17')})`);
  const o = PR.objective(s);
  ok(o && (o.id === 'sink1' || (o.background && o.background.id === 'sink1')), 'the goal card shows it');
  const sm = PR.showMe(s, 'sink1');
  ok(sm && sm.tx === dorm.tx && sm.ty === dorm.ty, 'Show me pans to the sunk hall');
  ok(BSU.data.guide.sink1 && BSU.data.guide.sink1.build[0] === 'pilings', 'the Build it button arms the Pilings tool');
  s.economy.cash = 5e6;
  const rp = B.retrofitPilings(s, dorm.id, {});
  ok(rp && rp.ok, 'pilings retrofitted');
  H.tick(TPD);
  ok(st(s, 'sink1') === 'done', `done once every sunk hall has pilings (${st(s, 'sink1')})`);
  H.tick(2);
  ok(s.progress.background === '17', `the growth goal is back once the halls are safe (${s.progress.background})`);
  // another hall sinks later: the goal comes back after the re-arm window
  const spot2 = H.findSpot('lecture_hall'); H.place('lecture_hall', spot2.x, spot2.y); H.fastForwardDays(3);
  const hall = B.list(s, 'lecture_hall')[0]; hall.sunk = 1.5;
  s.progress.objectives.sink1.since -= 200;
  H.tick(TPD);
  ok(st(s, 'sink1') === 'active' || st(s, 'sink1') === 'queued', `re-offered when another hall drops a foot (${st(s, 'sink1')})`);
  ok([...BSU.errors.keys()].filter((k) => k.startsWith('progress|')).length === 0, 'no progress errors');
}

// --- 5. save format: a v2 save written now still loads (no new root keys) ---
{
  const json = BSU.session.save('balance');
  const doc = JSON.parse(json);
  ok(doc.v === BSU.SAVE_VERSION, `save version unchanged (${doc.v})`);
  const before = H.snapshot(); BSU.session.load('balance'); const after = H.snapshot();
  ok(JSON.stringify(before) === JSON.stringify(after), 'round trip identical');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
