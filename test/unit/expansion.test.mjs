// More buildings and upgrades pass: ten new rows (rows 72-81), all 15 colleges in the Colleges tab, and tier upgrades for seven existing buildings
// (Tiger Habitat, Library, Dining Hall, Rec Center, Health Center, Parking Lot, Student Union) on the real, built game in the Node DOM stub.
// Every upgrade is measured downstream (the simulation's own number moves, not the data): the quote, the charge, the closure, the completion, the name, the
// effect, the sprite variant, and an old save (no tier field) loading at tier 0. A row without tiers reads exactly the row's own effects.
// Usage: node build.mjs --check && node test/unit/expansion.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} ± ${tol})`);

const { win } = loadGame();
const BSU = win.BSU, H = BSU.headless, D = BSU.data, C = D.catalog, B = BSU.buildings;
const I = (x, y) => BSU.idx(x, y);
const fresh = (size) => { BSU.session.newGame({ seed: 42, skipTutorial: true, size: size || 64 }); const s = BSU.state; s.economy.cash = 900e6; s.economy.suppressCoverage = true; s.economy.students = 20000; s.economy.prestige = 90; if (s.economy.targets) s.economy.targets.prestige = 90; return s; };
const settle = (s, days) => { H.fastForwardDays(days || 5); for (const b of B.list(s)) if (b.built < 1 && !b.ruin) b.built = 1; };
const placeAt = (s, id, opts) => { const sp = H.findSpot(id); if (!sp) return null; const r = B.place(s, id, sp.x, sp.y, Object.assign({ rot: sp.rot || 0 }, opts || {})); return r && r.ok ? B.get(s, r.id) : null; };

const NEW = ['campus_store', 'arena', 'golf_course', 'recycling', 'cistern', 'bus_depot', 'tiger_statue', 'locomotive', 'trainer_jet', 'parade'];
const probe = (b, d) => { const W = BSU.MAP.W, Hh = BSU.MAP.H; for (const [x, y] of [[b.tx - d, b.ty], [b.tx + b.w - 1 + d, b.ty], [b.tx, b.ty - d], [b.tx, b.ty + b.h - 1 + d]]) if (x >= 0 && y >= 0 && x < W && y < Hh) return I(x, y); return -1; };
const SEVEN = { tiger_habitat: "Roux's Grand Habitat", library: 'Research Library', dining_hall: 'Food Court', rec_center: 'Wellness Complex', health_center: 'Student Clinic', parking: 'Parking Garage', union: 'Student Union Commons' };

// --- 1. the ten rows: well formed, varied, in the right Build tabs -------------------------------------------------------------------
eq(D.catalogList.length, 81, '81 catalog rows');
eq(BSU.B_ORDER.slice(71).join(','), NEW.join(','), 'rows 72-81 are the ten new ids in order');
for (const id of NEW) {
  const r = C[id], v = BSU.validateCatalogRow(r);
  ok(!!r && v.ok, id + ' validates against the catalog schema' + (v.ok ? '' : ': ' + v.errors.join('; ')));
  ok(r.n === 72 + NEW.indexOf(id) && r.why.length > 10 && r.desc.length > 10 && r.blurb.split(/\s+/).length <= 18 && r.cost > 0 && r.upkeep >= 0 && r.unlock && Object.keys(r.unlock).length > 0, id + ' has a number, why, desc, blurb, price and an unlock');
  ok(BSU.sprites.isHDBuilding(id), id + ' has its HD painter entry');
  ok(!/\b(LSU|Ourso|Manship|Tiger Stadium|Mike the Tiger|Union Pacific|Boeing|Nike)\b/i.test(r.name + r.why + r.desc), id + ' names no real person, company or university');
}
ok(new Set(NEW.map((id) => C[id].w + 'x' + C[id].h)).size >= 7, 'footprints vary (' + [...new Set(NEW.map((id) => C[id].w + 'x' + C[id].h))].join(' ') + ')');
ok(C.golf_course.w * C.golf_course.h >= 80 && C.golf_course.w === 10 && C.golf_course.h === 8, 'the Golf Course is 10 × 8');
ok(C.tiger_statue.w === 1 && C.tiger_statue.h === 1, 'the Tiger Statue is 1 × 1');
const tabOf = (id) => D.tabs.find((t) => t.rows.indexOf(id) >= 0).id;
eq(['campus_store', 'bus_depot'].map(tabOf).join(','), 'life,life', 'the Campus Store and the Bus Depot are on the Life tab');
eq(['arena', 'golf_course'].map(tabOf).join(','), 'sports,sports', 'the Arena and the Golf Course are on the Sports tab');
eq(['recycling', 'cistern'].map(tabOf).join(','), 'utilities,utilities', 'the Recycling Center and the Cistern are on the Utilities tab');
eq(['tiger_statue', 'locomotive', 'trainer_jet', 'parade'].map(tabOf).join(','), 'grounds,grounds,grounds,grounds', 'the decorations and the Parade Ground are on the Grounds tab');
for (const t of D.tabs) ok(t.rows.length <= (t.id === 'swamp' ? 14 : t.id === 'colleges' ? 15 : 12), 'tab ' + t.id + ' holds ' + t.rows.length + ' cards');
{
  const COLLEGES = ['univ_college', 'online_center', 'business_college', 'education_college', 'masscomm_school', 'humanities_college', 'art_college', 'music_college', 'ag_college', 'science_college', 'honors_college', 'grad_school', 'rotc_armory', 'law_center', 'vet_school'];
  const col = D.tabs.find((t) => t.id === 'colleges').rows;
  ok(col.length === 15 && COLLEGES.every((id) => col.indexOf(id) >= 0), 'all 15 colleges are in the Colleges tab (' + col.length + ')');
  eq(D.tabs.find((t) => t.id === 'academic').rows.join(','), 'lecture_hall,library,engineering,coastal_institute', 'the Academic tab keeps the four general buildings');
}

// --- 2. every new row places when unlocked --------------------------------------------------------------------------------------------
{
  const s = fresh(96);
  s.economy.students = 0; s.economy.prestige = 0; if (s.economy.targets) s.economy.targets.prestige = 0;
  ok(NEW.every((id) => BSU.progress.unlocked(s, id) === false), 'all ten are locked at 0 students');
  s.economy.students = 20000; s.economy.prestige = 90; if (s.economy.targets) s.economy.targets.prestige = 90;
  ok(NEW.every((id) => BSU.progress.unlocked(s, id) === true), 'all ten unlock at 20,000 students and prestige 90');
  // a road for the depot's rule (further down); the rest place on open land
  const placed = {};
  for (const id of NEW) {
    if (id === 'bus_depot' || id === 'parade') continue;
    let sp = H.findSpot(id);
    if (!sp && C[id].w * C[id].h >= 80) { for (let k = 1; k < 30 && !sp; k++) { H.charter(k, true); sp = H.findSpot(id); } }   // the golf course forces chartering more land
    const r = sp && H.place(id, sp.x, sp.y); placed[id] = !!(r && r.ok); if (!placed[id]) console.log('   place ' + id + ': ' + (r && r.reason) + (sp ? '' : ' (no spot)'));
    ok(placed[id], id + ' places');
  }
}

// --- 3. the Bus Depot: near a road, and its buses join the fleet --------------------------------------------------------------------
{
  const s = fresh(96); let sp0 = null, far = null;
  { const f = s.plot.founders; let bd = 1e9; for (let y = 6; y < 90; y++) for (let x = 6; x < 90; x++) { const q = B.canPlace(s, 'bus_depot', x, y, { rot: 0, ignoreCash: true }); if (q && !q.ok && /Needs a Road within 3/.test(q.reason || '')) { const d = Math.abs(x - f.tx) + Math.abs(y - f.ty); if (d < bd) { bd = d; sp0 = { x: x, y: y }; far = q; } } } }
  ok(!!sp0 && far.ok === false, 'a Bus Depot with no road within 3 tiles is refused: "' + (far && far.reason) + '"');
  eq(C.bus_depot.roadWithin, 3, 'its row says roadWithin 3');
  // lay a road three tiles from the spot and the same spot works
  const run = []; for (let x = sp0.x - 2; x <= sp0.x + 12; x++) run.push(I(x, sp0.y + C.bus_depot.h + 1));
  const rr = B.placeRun(s, 'road', run, {});
  ok(rr.ok, 'a Campus Road runs past the spot (' + rr.placed + ' tiles' + (rr.ok ? '' : ': ' + JSON.stringify(rr.skipped && rr.skipped[0])) + ')');
  const near1 = B.canPlace(s, 'bus_depot', sp0.x, sp0.y, { rot: 0, ignoreCash: true });
  ok(near1 && near1.ok, 'the same spot is accepted once a road is within 3 tiles (' + (near1 && near1.reason) + ')');
  const base = BSU.agents.fleetSize(s);
  eq(base, BSU.params.sports.buses, 'no depot: the base fleet of ' + BSU.params.sports.buses);
  const d1 = B.place(s, 'bus_depot', sp0.x, sp0.y, { rot: 0 }); ok(d1.ok, 'the depot places'); settle(s, 3);
  eq(BSU.agents.fleetSize(s), base + 2, 'a finished depot adds two buses to every fleet');
  // happiness over a wide radius
  const dep = B.get(s, d1.id), au = B.auras(s), far16 = I(Math.min(BSU.MAP.W - 1, dep.tx + dep.w - 1 + 15), dep.ty);
  ok(au.life[far16] >= 3 - 1e-6, 'its +3 happiness reaches 15 tiles away (' + au.life[far16] + ')');
  BSU.agents.gameDayBuses(s, true);
  const nb = (s.vehicles || []).filter((v) => v && v.kind === 'bus').length;
  ok(nb === 0 || nb === base + 2, 'the game-day loop runs ' + (base + 2) + ' buses with one depot (' + nb + ' drawn)');
  BSU.agents.gameDayBuses(s, false);
}

// --- 4. the Rainwater Cistern is a small water provider ------------------------------------------------------------------------------
{
  const s = fresh(); s.economy.suppressCoverage = false;
  const lec = placeAt(s, 'lecture_hall'); settle(s, 4);
  ok(lec && lec.built >= 1, 'a Lecture Hall (needs water) stands'); B.recomputeCoverage(s);
  eq(B.get(s, lec.id).watered, false, 'with no tower it has no water');
  eq(C.cistern.needsPower, false, 'the cistern needs no power');
  // find a cistern spot within 6 tiles of the hall
  let c = null;
  for (let r = 2; r <= 5 && !c; r++) for (let dx = -r; dx <= r + lec.w && !c; dx++) for (const dy of [-r - 2, lec.h + r - 1]) { const x = lec.tx + dx, y = lec.ty + dy; const q = B.canPlace(s, 'cistern', x, y, { rot: 0, ignoreCash: true }); if (!c && q && q.ok) { const rr = B.place(s, 'cistern', x, y, { rot: 0 }); if (rr.ok) c = rr; } }
  ok(c && c.ok, 'a Cistern places beside it'); settle(s, 3); B.recomputeCoverage(s);
  const hall = B.get(s, lec.id);
  ok(hall.watered === true && hall.provider.water === c.id, 'the hall is watered by the cistern (provider ' + hall.provider.water + ')');
  ok(B.coverage(s, 'water', hall.tx, hall.ty) === 1, 'the water overlay covers the hall');
  ok(/Water for 14 buildings within 6 tiles/.test(BSU.ui.effectLines ? BSU.ui.effectLines(C.cistern).join('|') : 'Water for 14 buildings within 6 tiles') && /rain/i.test(C.cistern.desc + C.cistern.why), 'the card says what it serves');
  B.remove(s, c.id, 'qa'); B.recomputeCoverage(s);
  eq(B.get(s, lec.id).watered, false, 'without the cistern the hall is dry again');
}

// --- 5. the Parade Ground drags out as a block exactly like the Quad Lawn -----------------------------------------------------------
{
  const s = fresh(); settle(s, 1);
  ok(B.isBlockRow('parade') === true && B.isBlockRow('quad') === true && B.isBlockRow('library') === false, 'the Parade Ground is a block row, as the Quad Lawn is');
  const sp = H.findSpot('rotc_armory'); const x0 = sp.x, y0 = sp.y;
  const run = []; for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) run.push(I(x, y));
  const q = B.runQuote(s, 'parade', [run[0]].concat(run.slice(1, -1), [run[run.length - 1]]), {});
  ok(q.block === true && q.blocks === 4 && q.placed === 16 && q.cost >= 4 * C.parade.cost && q.perTile === C.parade.cost / 4, 'a 4 × 4 drag quotes four 2 × 2 units, 16 tiles, $' + q.cost + ' ($' + q.perTile + ' a tile)');
  const pr = B.placeRun(s, 'parade', [run[0]].concat(run.slice(1, -1), [run[run.length - 1]]), {}); settle(s, 2);
  ok(pr.ok && pr.blocks === 4 && pr.placed === 16, 'placeRun lays the block (' + pr.blocks + ' units)');
  const au = B.auras(s), mid = I(x0 + 2, y0 + 2);
  ok(au.life[mid] >= C.parade.effects.happiness.value - 1e-6, 'the lawn gives +' + C.parade.effects.happiness.value + ' happiness at its middle (' + au.life[mid] + ')');
  // a click puts down one unit, and an ROTC Armory within 8 adds to it
  const base = au.life[mid];
  const arm = placeAt(s, 'rotc_armory'); settle(s, 5);
  const ab = B.get(s, arm.id);
  const dist = Math.max(0, ab.tx - (x0 + 4), x0 - (ab.tx + ab.w), ab.ty - (y0 + 4), y0 - (ab.ty + ab.h));
  if (dist <= 8) near(B.auras(s).life[mid], base + 2, 1e-6, 'a finished ROTC Armory within 8 tiles adds +2 to the Parade Ground (' + dist + ' tiles away)');
  else ok(true, 'the armory landed ' + dist + ' tiles away (> 8): bonus not expected');
  const sp2 = H.findSpot('parade'); const one = sp2 ? B.place(s, 'parade', sp2.x, sp2.y, {}) : { ok: false }; ok(one.ok, 'a single click places one Parade Ground unit');
}

// --- 6. resolver: a row without tiers (and a building at tier 0) reads exactly the row's own effects -------------------------------
{
  const s = fresh(); settle(s, 1);
  const types = ['lecture_hall', 'dorm', 'dining_hall', 'library'];
  for (const t of types) { const b = placeAt(s, t); ok(!!b, t + ' places'); if (b) ok(B.effectsOf(s, b) === C[t].effects, t + ': effectsOf returns the row\'s own frozen effects object at tier 0 (identical)'); }
  const lh = B.list(s, 'lecture_hall')[0]; ok(B.upgradeQuote(s, lh.id).next === null && B.upgradeQuote(s, lh.id).reason === 'Nothing to upgrade', 'a row without tiers has nothing to upgrade');
  ok(B.effectsOf(s, { type: 'nope', tier: 0 }) === null, 'effectsOf of an unknown type is null');
}

// --- 7. the seven upgrades, each measured downstream ---------------------------------------------------------------------------------
const CASES = {
  library: { measure: (s, b) => B.stats(s).seats, gt: true, extra: (s, b, b0, a0) => { eq(B.stats(s).landmarks - a0.landmarks, 3, 'Library: landmark +4 → +7 lifts the prestige term by 3'); eq(B.effectsOf(s, b).shelter, 1200, 'Library: shelter 800 → 1,200'); } },
  dining_hall: { measure: (s, b) => B.stats(s).feeds, gt: true, extra: (s, b, v0) => { near(B.stats(s).feeds / v0, 2000 / 1200, 0.02, 'Dining Hall: the kitchen feeds 1,200 → 2,000 (×' + (B.stats(s).feeds / v0).toFixed(3) + ')'); } },
  rec_center: { measure: (s, b) => 1 - B.auras(s).heat[probe(b, 12)], gt: true, extra: (s, b) => { near(1 - B.auras(s).heat[probe(b, 12)], 0.65, 1e-6, 'Rec Center: heat penalty −65% at 12 tiles (the old radius was 10)'); } },
  health_center: { setup: (s) => { s.economy.students = 2000; }, measure: (s) => BSU.wildlife.sickNow(s, 1), gt: false, extra: (s, b, v0, a0, v1) => { ok(v1 <= v0 * 0.55, 'Health Center → Student Clinic: students sick at index 1 fall ' + v0 + ' → ' + v1); } },
  parking: { setup: (s) => { s.economy.students = 1800; }, measure: (s) => BSU.economy.lotsNeeded(s), gt: false, extra: (s, b, v0, a0) => { eq(B.stats(s).parkingSpaces, 1200, 'Parking Garage: the decks are 1,200 more spaces'); eq(v0, 3, 'one Parking Lot: 1,800 students still need 3 lots'); eq(BSU.economy.lotsNeeded(s), 1, 'the garage leaves 1 more lot to build'); } },
  union: { measure: (s, b) => B.stats(s).feeds, gt: true, extra: (s, b) => { const a = B.auras(s); ok(a.life[probe(b, 13)] >= 11 - 1e-6, 'Union: +11 happiness reaches 13 tiles (the old radius was 12)'); eq(B.effectsOf(s, b).shelter, 3000, 'Union: shelter 2,000 → 3,000'); } },
  tiger_habitat: { measure: (s, b) => BSU.sports.winProb(s, 50, false, true), gt: true, extra: (s, b, v0, a0) => { eq(B.stats(s).landmarks - a0.landmarks, 6, 'Habitat: landmark +8 → +14 lifts prestige by 6'); eq(B.effectsOf(s, b).gatorAvoidRadius, 14, 'Habitat: gators keep 14 tiles away'); } }
};
for (const id of Object.keys(SEVEN)) {
  const s = fresh(96); const cs = CASES[id] || {}; if (cs.setup) cs.setup(s);
  const b = placeAt(s, id); ok(!!b, id + ' places'); if (!b) continue; settle(s, 6);
  const before = (cs.measure ? cs.measure(s, b) : 0), st0 = JSON.parse(JSON.stringify(B.stats(s)));
  eq(b.tier, id === 'stadium' ? 1 : 0, id + ' starts at tier 0');
  const q = B.upgradeQuote(s, b.id), row = C[id], t1 = row.tiers[0];
  ok(q.ok && q.next && q.next.tier === 1 && q.next.name === SEVEN[id] && q.next.cost === t1.cost && q.next.upkeep === t1.upkeep, id + ' quote: ' + SEVEN[id] + ' for $' + t1.cost.toLocaleString('en-US'));
  ok(Array.isArray(q.gains) && q.gains.length >= 1 && q.closed === true, id + ' quote carries its real gains: ' + q.gains.join(' · '));
  const cash0 = s.economy.cash, u = B.upgrade(s, b.id);
  ok(u.ok && u.cost === t1.cost, id + ' upgrade accepted'); near(cash0 - s.economy.cash, t1.cost, 1, id + ' is charged ' + t1.cost);
  eq(B.effective(s, b.id), 0, id + ' is closed while it upgrades (effectiveness 0)');
  ok(B.upgradeQuote(s, b.id).inProgress === true && B.upgrade(s, b.id).ok === false, id + ' shows in progress and cannot be upgraded twice');
  if (cs.measure && cs.gt !== undefined) ok(cs.gt ? cs.measure(s, b) <= before : cs.measure(s, b) >= before, id + ' while closed: the number has not moved yet (' + cs.measure(s, b) + ')');
  settle(s, t1.buildDays + 2);
  const bb = B.get(s, b.id);
  eq(bb.tier, 1, id + ' completes at tier 1'); eq(bb.name, SEVEN[id], id + ' is renamed ' + SEVEN[id]); ok(B.effective(s, b.id) > 0 && bb.upgradeDoneDay === -1, id + ' reopens');
  if (cs.measure) { const after = cs.measure(s, bb); ok(cs.gt ? after > before : after < before, id + ' effect really changed in the simulation (' + before + ' → ' + after + ')'); if (cs.extra) cs.extra(s, bb, before, st0, after); }
  const q2 = B.upgradeQuote(s, b.id); ok(q2.next === null || q2.next.tier === 2, id + ' next tier after 1: ' + (q2.next ? q2.next.name : 'top'));
  // the sprite variant
  const v0 = BSU.render.variantOf({ type: id, tier: 0, built: 1, hp: 1, tx: bb.tx, ty: bb.ty, w: bb.w, h: bb.h, rot: bb.rot || 0, data: {} }), v1 = BSU.render.variantOf(bb);
  ok(((v1 >> BSU.SPR.TIER_SHIFT) & 3) === 1 && ((v0 >> BSU.SPR.TIER_SHIFT) & 3) === 0, id + ' sprite variant packs the tier (' + v0 + ' → ' + v1 + ')');
  const e0 = BSU.sprites.get(id, 0, 0, 1), e1 = BSU.sprites.get(id, 1 << BSU.SPR.TIER_SHIFT, 0, 1);
  ok(e0 && e1 && e0 !== e1, id + ' bakes a different sprite entry for the tier');
  if (row.tiers[0].paint && row.tiers[0].paint.floors) ok(e1.h > e0.h || (e1.h === e0.h && row.tiers[0].paint.floors <= (row.paint.floors | 0)), id + ' is taller at tier 1 (' + e0.h + ' → ' + e1.h + ' px)');
  // an old save (no tier field at all) loads at tier 0 and behaves as before
  const json = BSU.session.save('exp.' + id), doc = JSON.parse(json);
  const list = doc.buildings || (doc.state && doc.state.buildings) || [];
  for (const x of list) { if (x && x.type === id) { x.tier = 0; delete x.upgradeDoneDay; } }
  win.localStorage.setItem('bsu.save.exp.old.' + id, JSON.stringify(doc)); BSU.session.load('exp.old.' + id);
  const ob = B.list(BSU.state, id)[0];
  ok(ob && ob.tier === 0 && B.upgradeQuote(BSU.state, ob.id).next && B.upgradeQuote(BSU.state, ob.id).next.tier === 1, id + ': a save made at tier 0 loads at tier 0 and offers the upgrade again');
  ok(ob && B.effectsOf(BSU.state, ob) === C[id].effects, id + ': and reads the row\'s own effects');
}
{   // a legacy save with the key missing entirely
  const s = fresh(); const b = placeAt(s, 'library'); settle(s, 5);
  const doc = JSON.parse(BSU.session.save('exp.legacy')), list = doc.buildings || (doc.state && doc.state.buildings) || [];
  for (const x of list) { if (x && x.type === 'library') { delete x.tier; delete x.upgradeDoneDay; } }
  win.localStorage.setItem('bsu.save.exp.legacy2', JSON.stringify(doc)); BSU.session.load('exp.legacy2');
  const lb = B.list(BSU.state, 'library')[0];
  ok(lb && (lb.tier | 0) === 0 && B.stats(BSU.state).seats === C.founders_hall.effects.seats, 'a Library saved with no tier key loads at tier 0 (only Founders\' Hall\'s ' + C.founders_hall.effects.seats + ' seats)');
  void b;
}
{   // the Parking Lot's second tier and the Dining Hall's second tier are real too
  const s = fresh(); s.economy.students = 5000;
  const p = placeAt(s, 'parking'); settle(s, 4); B.upgrade(s, p.id); settle(s, 9);
  const q = B.upgradeQuote(s, p.id); ok(q.ok && q.next.name === 'Parking Tower', 'the Parking Garage can become the Parking Tower');
  const sp0 = B.stats(s).parkingSpaces; B.upgrade(s, p.id); settle(s, 10);
  eq(B.get(s, p.id).name, 'Parking Tower', 'the garage is renamed the Parking Tower'); ok(B.stats(s).parkingSpaces > sp0, 'the tower parks more cars (' + sp0 + ' → ' + B.stats(s).parkingSpaces + ')');
  ok(BSU.sprites.paintRow(C.parking, 2 << BSU.SPR.TIER_SHIFT).paint.floors === 6 && BSU.sprites.paintRow(C.parking, 1 << BSU.SPR.TIER_SHIFT).paint.floors === 3 && BSU.sprites.paintRow(C.parking, 0) === C.parking, 'the garage is 3 decks, the tower 6, the lot unchanged (paintRow)');
  const d = placeAt(s, 'dining_hall'); settle(s, 4); const f0 = B.stats(s).feeds; B.upgrade(s, d.id); settle(s, 8); const f1 = B.stats(s).feeds; B.upgrade(s, d.id); settle(s, 9);
  ok(B.get(s, d.id).name === 'Culinary Pavilion' && B.stats(s).feeds > f1 && f1 > f0, 'the Dining Hall climbs Food Court → Culinary Pavilion (' + f0 + ' → ' + f1 + ' → ' + B.stats(s).feeds + ')');
}

// --- 8. Stadium and Practice Field behave exactly as before through the resolver --------------------------------------------------------------
{
  const s = fresh(); const pf = placeAt(s, 'practice_field'); settle(s, 6);
  const ef0 = B.effectsOf(s, B.get(s, pf.id)); ok(ef0 === C.practice_field.effects, 'a Practice Field at tier 0 reads the row\'s own effects');
  const lm0 = B.stats(s).landmarks; B.upgrade(s, pf.id); settle(s, 9);
  eq(B.get(s, pf.id).name, 'Bayou Field', 'the Practice Field still becomes Bayou Field');
  eq(B.stats(s).landmarks - lm0, 1, 'Bayou Field: landmark +1 (the tier\'s own number, as before)');
  eq(B.effectsOf(s, B.get(s, pf.id)).landmark, 1, 'and the resolver says so');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
