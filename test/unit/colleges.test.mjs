// Colleges and venues pass: the 15 colleges and 8 signature venues (rows 49-71) on the real, built game in the Node DOM stub.
// Every row is well formed and places when unlocked; a venue is locked until its college stands (the reason names it); every department of
// docs/CONTENT_BACKLOG.md section 2 is in exactly one row's programs; programs offered raise applications 0.4 % each, capped at +25 %;
// the generic research / revenue income; the two milestones; the Build sheet tabs stay within 12 cards; no person or donor names.
// Usage: node build.mjs --check && node test/unit/colleges.test.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../domstub.mjs';

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} ± ${tol})`);

const { win } = loadGame();
const BSU = win.BSU, H = BSU.headless, D = BSU.data, C = D.catalog, TPD = BSU.params.time.ticksPerDay;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fresh = () => { BSU.session.newGame({ seed: 42, skipTutorial: true, size: 64 }); const s = BSU.state; s.economy.cash = 900e6; s.economy.suppressCoverage = true; return s; };

const COLLEGES = ['univ_college', 'online_center', 'business_college', 'education_college', 'humanities_college', 'masscomm_school', 'art_college', 'music_college', 'ag_college', 'science_college', 'honors_college', 'grad_school', 'rotc_armory', 'law_center', 'vet_school'];
const VENUES = { concert_hall: 'music_college', theatre: 'music_college', band_hall: 'music_college', art_gallery: 'art_college', vet_hospital: 'vet_school', nat_museum: 'science_college', computer_lab: 'engineering', ag_greenhouses: 'ag_college' };
const NEW = COLLEGES.concat(Object.keys(VENUES));

// --- 1. rows: well formed, sized, priced, unlocked on a ladder ---------------------------------------------------------------------
eq(NEW.length, 23, '23 new rows (15 colleges + 8 venues)');
eq(D.catalogList.length, 71, '71 catalog rows in all');
for (const id of NEW) {
  const r = C[id], v = BSU.validateCatalogRow(r);
  ok(!!r && v.ok, id + ' validates against the catalog schema' + (v.ok ? '' : ': ' + v.errors.join('; ')));
  ok(r.kind === 'footprint' && r.w >= 2 && r.h >= 2 && r.w <= 5 && r.h <= 4, id + ' footprint ' + r.w + '×' + r.h + ' is within 2×2 … 5×4');
  ok(r.cost >= 500000 && r.cost <= 4000000 && r.upkeep > 0, id + ' cost $' + r.cost + ' sits between a Greenhouse and the Vet School');
  ok(r.why.length > 0 && r.desc.length > 0 && r.blurb.length > 0, id + ' has why, desc and blurb');
  ok(r.pathAdjacency && r.needsPower && r.needsWater, id + ' needs a path, power and water like the other halls');
}
ok(new Set(NEW.map((id) => C[id].w + 'x' + C[id].h)).size >= 6, 'footprints vary (' + [...new Set(NEW.map((id) => C[id].w + 'x' + C[id].h))].join(' ') + ')');
const ladder = COLLEGES.map((id) => C[id].unlock.students || 0);
ok(Math.min(...ladder) <= 400 && Math.max(...ladder) >= 5000 && new Set(ladder).size >= 12, 'the colleges unlock from ~300 to ~6,000 students, nearly one rung each (' + ladder.join(',') + ')');
ok(COLLEGES.filter((id) => C[id].unlock.prestige).length >= 3, 'a few colleges are gated by prestige');
// the paint is varied and legal (the HD layer knows every row)
const looks = new Set(NEW.map((id) => { const p = C[id].paint; return [p.wall[0], p.roof, p.floors, p.material].join('|'); }));
ok(looks.size === 23, 'no two new buildings share wall, roof, height and material (' + looks.size + ' looks)');
ok(NEW.every((id) => BSU.sprites.isHDBuilding(id)), 'every new row has its HD building painter entry');

// --- 2. a college places when unlocked; a venue waits for its college ----------------------------------------------------------------
{
  const s = fresh(); const U = BSU.progress.unlocked;
  s.economy.students = 0;
  ok(U(s, 'univ_college') === false, 'University College is locked at 0 students');
  s.economy.students = 300; ok(U(s, 'univ_college') === true, 'University College opens at 300 students');
  for (const id of Object.keys(VENUES)) ok(U(s, id) === false, id + ' is locked while its college is not built');
  for (const [id, col] of Object.entries(VENUES)) { const rs = BSU.progress.unlockReason(s, id); ok(rs.indexOf(C[col].name) >= 0, id + ' lock reason names the college (' + rs + ')'); }
  // unlock everything by state, then place every college and every venue in turn
  s.economy.students = 20000; s.economy.prestige = 90; if (s.economy.targets) s.economy.targets.prestige = 90;
  for (const id of COLLEGES) ok(U(s, id) === true, id + ' unlocks at 20,000 students and prestige 90');
  for (const id of Object.keys(VENUES)) ok(U(s, id) === false, id + ' still waits for its college even at 20,000 students');
  const placed = {};
  for (const id of COLLEGES) { const sp = H.findSpot(id); const r = sp && H.place(id, sp.x, sp.y); placed[id] = !!(r && r.ok); if (!placed[id]) console.log('   place ' + id + ': ' + (r && r.reason) + (sp ? '' : ' (no spot)')); }
  ok(COLLEGES.every((id) => placed[id]), 'all 15 colleges place on a 64 × 64 map');
  for (const b of BSU.buildings.list(s)) b.built = 1;
  BSU.buildings.invalidate && BSU.buildings.invalidate(s);
  for (const [id, col] of Object.entries(VENUES)) {
    if (id === 'computer_lab') { ok(U(s, id) === false, 'the Computer Lab still waits for Engineering Hall'); continue; }
    ok(U(s, id) === true, id + ' unlocks once ' + col + ' stands');
  }
  { const sp = H.findSpot('engineering'); const r = H.place('engineering', sp.x, sp.y); ok(r && r.ok, 'Engineering Hall places'); for (const b of BSU.buildings.list(s)) b.built = 1; ok(U(s, 'computer_lab') === true, 'the Computer Lab unlocks once Engineering Hall stands'); }
  const vplaced = {};
  for (const id of Object.keys(VENUES)) { const sp = H.findSpot(id); const r = sp && H.place(id, sp.x, sp.y); vplaced[id] = !!(r && r.ok); if (!vplaced[id]) console.log('   place ' + id + ': ' + (r && r.reason) + (sp ? '' : ' (no spot)')); }
  ok(Object.keys(VENUES).every((id) => vplaced[id]), 'all 8 venues place');
  // rotations: a rotatable row places rotated too
  ok(NEW.filter((id) => C[id].rotatable).length >= 12, 'most rows are rotatable (' + NEW.filter((id) => C[id].rotatable).length + ')');
}

// --- 3. programs: every catalog department in exactly one row ------------------------------------------------------------------------
{
  const md = readFileSync(join(root, 'docs', 'CONTENT_BACKLOG.md'), 'utf8');
  const sec = md.slice(md.indexOf('## 2. Academic unit catalog'));
  const depts = [];
  for (const line of sec.split('\n')) {
    if (!/^\| /.test(line) || /^\| Unit|^\|---/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    const list = cells[2].replace(/\.\s*Programs:\s*/g, '; ').replace(/Programs:\s*/g, '');
    for (const d of list.split(';').map((x) => x.trim()).filter((x) => x && /^[A-Z]/.test(x))) depts.push(d);   // lower-case cells ("first-year and undeclared students") describe a unit with no department list
  }
  ok(depts.length >= 70, 'parsed ' + depts.length + ' departments from CONTENT_BACKLOG.md section 2');
  const where = {};
  for (const r of D.catalogList) for (const p of r.programs) (where[p] = where[p] || []).push(r.id);
  const missing = depts.filter((d) => !where[d]), dup = depts.filter((d) => where[d] && where[d].length > 1);
  ok(missing.length === 0, 'every department is on a card' + (missing.length ? ' (missing: ' + missing.join(' | ') + ')' : ''));
  ok(dup.length === 0, 'no department is on two cards' + (dup.length ? ' (' + dup.join(' | ') + ')' : ''));
  for (const id of ['honors_college', 'law_center', 'grad_school', 'online_center', 'univ_college', 'library']) ok(C[id].programs.length === 1, id + ' (no listed departments) stands for itself as one program');
  ok(Object.values(where).every((a) => a.length === 1), 'no program name repeats across rows');
  ok(VENUES && Object.keys(VENUES).every((id) => C[id].programs.length === 0), 'a venue lists no programs of its own (its college does)');
  const total = D.catalogList.reduce((a, r) => a + r.programs.length, 0);
  ok(total >= 75 && total * BSU.params.econ.programs.perProgram > BSU.params.econ.programs.cap, 'with every college built the programs reach the cap (' + total + ' programs)');
  eq(C.engineering.programs.length, 8, 'Engineering Hall lists its 8 departments'); eq(C.coastal_institute.programs.length, 2, 'the Coastal Studies Institute lists its 2 departments');
  eq(C.humanities_college.programs.length, 23, 'Humanities & Social Sciences lists 12 departments + 11 programs');
}

// --- 4. the programs-offered mechanic --------------------------------------------------------------------------------------------------
{
  const s = fresh(); s.economy.students = 20000; s.economy.prestige = 90;
  const E = BSU.economy, PG = BSU.params.econ.programs;
  eq(PG.perProgram, 0.004, 'params.econ.programs.perProgram is 0.4 %'); eq(PG.cap, 0.25, 'params.econ.programs.cap is +25 %');
  eq(E.programCount(s), 0, 'no college, no programs'); eq(E.programsBonus(s), 0, 'no bonus at the start');
  const base = E.explain ? null : null;
  const mk = (id) => { const sp = H.findSpot(id); const r = H.place(id, sp.x, sp.y); for (const b of BSU.buildings.list(s)) b.built = 1; return r && r.ok; };
  const a0 = E.applicants(s);
  ok(mk('business_college'), 'a College of Business places');
  eq(E.programCount(s), 8, 'Business adds 8 programs'); near(E.programsBonus(s), 0.032, 1e-9, '8 programs = +3.2 %');
  BSU.buildings.invalidate && BSU.buildings.invalidate(s);
  const a1 = E.applicants(s);
  ok(a1 > a0, 'applications rise with the first college (' + a0 + ' → ' + a1 + ')');
  near(a1 / a0, 1.032, 0.01, 'by about 3.2 % (×' + (a1 / a0).toFixed(4) + ')');
  ok(mk('science_college'), 'a College of Science places'); eq(E.programCount(s), 14, '8 + 6 programs');
  { const sp = H.findSpot('business_college'); const r = H.place('business_college', sp.x, sp.y); for (const b of BSU.buildings.list(s)) b.built = 1; eq(E.programCount(s), 14, 'a second Business building does not count its programs twice'); }
  // an under-construction college counts nothing
  { const before = E.programCount(s); const sp = H.findSpot('law_center'); H.place('law_center', sp.x, sp.y); const lb = BSU.buildings.list(s).find((b) => b.type === 'law_center'); lb.built = 0.4; eq(E.programCount(s), before, 'a college under construction offers no programs yet'); lb.built = 1; eq(E.programCount(s), before + 1, 'the Law Center adds its one program when it opens'); }
  // the cap: every college and the three existing halls
  for (const id of COLLEGES.concat(['engineering', 'coastal_institute', 'library'])) { if (BSU.buildings.list(s).some((b) => b.type === id)) continue; const sp = H.findSpot(id); if (sp) H.place(id, sp.x, sp.y); }
  for (const b of BSU.buildings.list(s)) b.built = 1;
  ok(E.programCount(s) * PG.perProgram > PG.cap, 'the full campus offers more programs than the cap needs (' + E.programCount(s) + ')');
  near(E.programsBonus(s), 0.25, 1e-9, 'the bonus is capped at +25 %');
  const ex = E.breakdown(s, 'applicants'); const line = ex && ex.lines.find((l) => /Programs offered/.test(l.label));
  ok(!!line && line.value === 25, 'the Students chip popover shows one "Programs offered" line (' + (line && line.label + ' ' + line.value) + ')');
  // card text
  const ui = BSU.ui;
}

// --- 5. generic research and revenue --------------------------------------------------------------------------------------------------
{
  const s = fresh(); s.economy.students = 20000; s.economy.prestige = 60; s.economy.cash = 900e6;
  const E = BSU.economy;
  const b0 = E.budget(s);
  const mk = (id) => { const sp = H.findSpot(id); const r = H.place(id, sp.x, sp.y); for (const b of BSU.buildings.list(s)) b.built = 1; return r && r.ok; };
  ok(mk('online_center') && mk('science_college'), 'Continuing Education and Science place');
  BSU.buildings.invalidate && BSU.buildings.invalidate(s);
  const b1 = E.budget(s);
  ok(b1.lines.income.misc - b0.lines.income.misc >= 19999, 'the Continuing Education Center adds $20k a month of tuition-like income (misc +' + (b1.lines.income.misc - b0.lines.income.misc) + ')');
  ok(b1.lines.income.research > b0.lines.income.research, 'the College of Science adds research (+' + Math.round(b1.lines.income.research - b0.lines.income.research) + ')');
  ok(b1.lines.costs.upkeep > b0.lines.costs.upkeep, 'and both add upkeep');
}

// --- 6. milestones ---------------------------------------------------------------------------------------------------------------------
{
  const s = fresh(); s.economy.students = 20000; s.economy.prestige = 90;
  const P = BSU.progress;
  const mk = (id) => { const sp = H.findSpot(id); if (!sp) return false; const r = H.place(id, sp.x, sp.y); for (const b of BSU.buildings.list(s)) b.built = 1; return !!(r && r.ok); };
  eq(BSU.MILESTONES.indexOf('fiveColleges'), 28, 'fiveColleges is milestone 29'); eq(BSU.MILESTONES.indexOf('fullCurriculum'), 29, 'fullCurriculum is milestone 30');
  ok(D.milestones[28].name === 'Five Colleges' && D.milestones[29].name === 'Flagship Curriculum', 'names: Five Colleges, Flagship Curriculum');
  ok(D.milestones[28].reward.cash > 0 && D.milestones[29].reward.prestige > 0, 'each pays a small reward of an existing kind (cash; prestige)');
  ok(!P.earned(s, 'fiveColleges') && !P.earned(s, 'fullCurriculum'), 'neither is earned at the start');
  for (const id of COLLEGES.slice(0, 4)) mk(id);
  H.tick(TPD * 2);
  ok(!P.earned(s, 'fiveColleges'), 'four colleges do not earn Five Colleges');
  mk(COLLEGES[4]); H.tick(TPD * 2);
  ok(P.earned(s, 'fiveColleges'), 'the fifth college earns Five Colleges');
  ok(!P.earned(s, 'fullCurriculum'), 'five colleges do not earn Flagship Curriculum');
  { const mp = P.milestoneProgress(s, 'fullCurriculum'); ok(mp.goal === 17 && mp.progress === 5, 'its progress reads 5 of 17 (' + mp.progress + '/' + mp.goal + ')'); }
  for (const id of COLLEGES.concat(['engineering', 'coastal_institute'])) if (!BSU.buildings.list(s).some((b) => b.type === id)) mk(id);
  for (const b of BSU.buildings.list(s)) b.built = 1;
  H.tick(TPD * 2);
  ok(COLLEGES.concat(['engineering', 'coastal_institute']).every((id) => BSU.buildings.list(s).some((b) => b.type === id)), 'every college stands');
  ok(P.earned(s, 'fullCurriculum'), 'every college built earns Flagship Curriculum');
}

// --- 7. Build sheet tabs ------------------------------------------------------------------------------------------------------------------
{
  const ids = D.tabs.map((t) => t.id).join();
  eq(ids, 'essentials,paths,utilities,academic,colleges,arts,housing,dining,sports,life,swamp,grounds', 'tab order: Colleges and Arts & Venues follow Academic');
  for (const t of D.tabs) ok(t.rows.length <= (t.id === 'swamp' ? 14 : 12), 'tab ' + t.id + ' holds ' + t.rows.length + ' cards (≤ 12; Swamp keeps its 14)');
  eq(D.tabs.find((t) => t.id === 'arts').name, 'Arts & Venues', 'the arts tab is named Arts & Venues');
  ok(D.tabs.find((t) => t.id === 'colleges').rows.length === 12 && D.tabs.find((t) => t.id === 'arts').rows.length === 8 && D.tabs.find((t) => t.id === 'academic').rows.length === 7, 'Academic 7, Colleges 12, Arts & Venues 8');
  const seen = {}; for (const t of D.tabs) if (t.id !== 'essentials') for (const id of t.rows) seen[id] = (seen[id] || 0) + 1;
  ok(NEW.every((id) => seen[id] === 1), 'every new row is in exactly one tab');
  // the sheet shows a tab only once it has an unlocked row: Colleges and Arts & Venues appear with University College / the first college
  const s = fresh(); s.economy.students = 0;
  const U = BSU.progress.unlocked;
  ok(!D.tabs.find((t) => t.id === 'arts').rows.some((id) => U(s, id)), 'Arts & Venues has nothing unlocked at the start (the tab stays hidden)');
  s.economy.students = 400; ok(D.tabs.find((t) => t.id === 'colleges').rows.some((id) => U(s, id)), 'Colleges has University College at 300 students');
  for (const id of NEW) { const r = C[id]; ok(r.tab === (D.tabs.find((t) => t.rows.includes(id)) || {}).id, id + ' row.tab matches its tab'); }
}

// --- 8. names: the discipline only -------------------------------------------------------------------------------------------------------
{
  const BANNED = ['Ourso', 'Manship', 'Ogden', 'Hebert', 'Reich', 'Rucks', 'Stephenson', 'Flores', 'Swine Palace', 'LSU'];
  const text = NEW.map((id) => [C[id].name, C[id].why, C[id].desc, C[id].blurb, C[id].paint.features.join(' '), C[id].programs.join(' ')].join(' ')).join(' ');
  for (const w of BANNED) ok(!new RegExp('\\b' + w + '\\b', 'i').test(text), 'no "' + w + '" in any new row');
  ok(NEW.every((id) => !/\b(Hall of|Memorial|Center for)\b/.test(C[id].name)), 'no donor-style names');
  const names = NEW.map((id) => C[id].name); eq(new Set(names).size, 23, 'the 23 names are distinct');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
