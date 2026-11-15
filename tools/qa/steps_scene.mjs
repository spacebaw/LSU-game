// Goal steps pass scene (Josh, 2026-11-15: "im stuck here. cant figure out how to build stadium"): Objective 20, "Night Falls on the Cauldron",
// played from "1,700 students, no field" to the milestone using only the goal card's step buttons, the controls they light and map clicks
// through BSU.ui.pointer. Each stage is shot at 1440 x 900 (steps-<tag>-<n>-<stage>.png); a second Chrome shoots the card at 1280 x 720 with
// Display size 130 % and measures that it stays inside the window. Exit 1 on a problem (--strict: warnings too).
//   node tools/qa/steps_scene.mjs [--strict] [--index path] [--tag before|after] [--out dir] [--size 96]
// --tag before (run it on tools/qa/out/index-before.html): the previous build has no steps, so only what a player saw is shot: the goal card,
// the Build sheet's locked Stadium card and the inspect card's bare Upgrade button.
// Scaffolding, not play: the dense campus (g.buildCampus, then the real unlock rules are restored from window.__qaUnlock), the cash and the
// head count, completing the two tutorial-chain goals in front of Objective 20, panning the camera to a free site (a player drags the map),
// fast-forwarding days, and answering the storm / halftime toasts with their defaults.
import { openGame, parseArgs, DEFAULT_OUT, killStrays, sleep, resolveIndex } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { strict: { type: 'bool', def: false }, index: { type: 'str', def: '' }, tag: { type: 'str', def: 'after' }, out: { type: 'str', def: DEFAULT_OUT }, size: { type: 'num', def: 96 } });
const before = args.tag === 'before';
killStrays();
let problems = 0, warnings = 0;
const bad = (m) => { problems++; console.log('  PROBLEM: ' + m); };
const warn = (m) => { warnings++; console.log('  warning: ' + m); };
const M0 = `{ ctrl: false, shift: false, meta: false, alt: false }`;

/** the campus Josh was on, by scaffolding: a built-up start charter, 1,700 students, real unlock rules, Objective 20 on the card */
async function setup(g, { cash = 16e6 } = {}) {
  await g.buildCampus({ target: 24, days: 30, students: 0 });
  await g.restoreUnlock();
  await g.eval(`(function () { var s = BSU.state; BSU.economy.addStudents(s, Math.max(0, 1700 - s.economy.students), 'qa'); s.economy.cash = ${cash}; BSU.headless.tick(3);
    for (var k = 0; k < 12; k++) { var o = BSU.progress.objective(s); if (!o || o.id === '20') break; BSU.progress.complete(s, o.id); BSU.headless.tick(3); }
    BSU.ui.dismissNotifs(); while (BSU.ui.cardOpen && BSU.ui.cardOpen()) BSU.ui.closeCard(); return true; })()`);
  await g.noGuard();
  await g.frameCampus(1, { keepOnMap: false }); await g.waitBake({ timeoutMs: 45000 }); await g.settleCamera();
  const o = await g.eval(`(function () { var o = BSU.progress.objective(BSU.state); return o ? { id: o.id, kind: o.kind, title: o.title } : null; })()`);
  if (!o || o.id !== '20') bad('setup: Objective 20 is not on the card (' + JSON.stringify(o) + ')');
  return o;
}
/** what the goal card says right now */
const card = (g) => g.eval(`(function () {
  var c = document.getElementById('objective-card'), q = c.getBoundingClientRect(), vis = function (e) { if (!e) return false; var r = e.getBoundingClientRect(); for (var p = e; p; p = p.parentElement) if (p.classList && p.classList.contains('hidden')) return false; return r.width > 0 && r.height > 0; };
  var txt = function (id) { var e = document.getElementById(id); return e && vis(e) ? (e.innerText || e.textContent || '').trim() : ''; };
  var steps = Array.from(document.querySelectorAll('#obj-steps > li')).map(function (li) { var t = li.querySelector('.st-t'); return { text: t ? t.textContent : '', done: li.classList.contains('done'), cur: li.getAttribute('aria-current') === 'step' }; });
  var b = document.getElementById('btn-obj-build'), sm = document.getElementById('btn-showme');
  return { open: vis(c), kicker: txt('obj-kicker'), title: txt('obj-title'), text: txt('obj-text'), count: txt('obj-count'), steps: steps, needs: txt('obj-step-needs'), note: txt('obj-step-note'), button: vis(b) ? b.textContent : '', showme: vis(sm), rect: [Math.round(q.left), Math.round(q.top), Math.round(q.right), Math.round(q.bottom)], vw: innerWidth, vh: innerHeight, pill: txt('goal-pill') };
})()`);
const say = (label, c) => console.log('  ' + label + ': ' + c.kicker + ' | ' + c.title + ' | ' + (c.text || '(no text line)') + ' | ' + c.count + '\n    steps: ' + (c.steps.length ? c.steps.map((s, i) => (s.done ? '[x] ' : s.cur ? '[>] ' : '[ ] ') + s.text).join(' · ') : '(none)') + '\n    needs: ' + (c.needs || '(none)') + ' · note: ' + (c.note || '(none)') + ' · button: ' + (c.button || '(none)') + (c.showme ? ' · Show me' : '') + ' · card ' + JSON.stringify(c.rect));
/** scaffolding: close what came up on its own (newsflash cards, a Student Voice dialog, decision toasts, snackbars) and dismiss any interrupt goal that took the card, so Objective 20 is the goal on it */
const calm = async (g) => { const did = await g.eval(`(function () { var s = BSU.state, did = false;
  try { while (BSU.ui.cardOpen && BSU.ui.cardOpen()) { BSU.ui.closeCard(); did = true; } } catch (e) {}
  try { if (BSU.ui.voiceOpen && BSU.ui.voiceOpen()) { document.getElementById('btn-voice-decline').click(); did = true; } } catch (e) {}
  try { BSU.ui.dismissNotifs(); } catch (e) {}
  for (var k = 0; k < 8; k++) { var o = BSU.progress.objective(s); if (!o || o.id === '20' || s.progress.objectives['20'].state === 'done') break; BSU.progress.dismiss(s, o.id); BSU.headless.tick(2); did = true; }
  return did; })()`); if (did) await sleep(400); };
const openCard = async (g) => { await calm(g); await g.eval(`(BSU.ui.closePopover(), BSU.ui.goalOpen(true), true)`); await sleep(450); return card(g); };
const curStep = (g) => g.eval(`(function () { var st = BSU.progress.goalSteps(BSU.state, '20', { sites: true }).find(function (x) { return x.current; }); return st ? { id: st.id, text: st.text, needs: st.needs, action: st.action, label: st.actionLabel } : null; })()`);
/** the step's button, clicked the way a player clicks it */
async function clickStep(g, want) {
  const c = await openCard(g);
  if (want && c.button !== want) bad('the step button reads ' + JSON.stringify(c.button) + ', expected ' + JSON.stringify(want));
  if (!(await g.clickEl('#btn-obj-build'))) { bad('the step button is not clickable'); return false; }
  await sleep(500); return true;
}
/** a free site for a footprint with a tile of margin all round (no soft-spacing snap), nearest the campus: pan there (a player drags the map), then one click through ui.pointer */
async function placeOnMap(g, id) {
  const site = await g.eval(`(function () {
    var s = BSU.state, B = BSU.buildings, W = BSU.MAP.W, H = BSU.MAP.H, r = BSU.data.catalog[${JSON.stringify(id)}], f = s.plot.founders, best = null;
    for (var y = 2; y + r.h < H - 2; y++) for (var x = 2; x + r.w < W - 2; x++) {
      var q = B.canPlace(s, r.id, x, y, { rot: 0 }); if (!q || !q.ok) continue;
      var clear = true; for (var yy = y - 1; yy <= y + r.h && clear; yy++) for (var xx = x - 1; xx <= x + r.w; xx++) if (s.tiles.owner[yy * W + xx] !== -1) { clear = false; break; }
      if (!clear) continue;
      var d = Math.abs(x - f.tx) + Math.abs(y - f.ty); if (!best || d < best.d) best = { tx: x, ty: y, d: d };
    }
    return best; })()`);
  if (!site) { bad('no free site for ' + id + ' with a tile of margin'); return null; }
  await g.eval(`(BSU.render.panToTile(${site.tx + 1}, ${site.ty + 1}, false), true)`); await g.settleCamera();
  const n0 = await g.eval(`BSU.buildings.count(BSU.state, ${JSON.stringify(id)})`);
  const p = await g.eval(`(function () { var p = BSU.render.tileToScreen(${site.tx} + 0.5, ${site.ty} + 0.5), t = BSU.render.screenToTile(p.x, p.y); return { x: Math.round(p.x), y: Math.round(p.y), tx: Math.floor(t.tx), ty: Math.floor(t.ty) }; })()`);
  await g.eval(`(BSU.ui.pointer('move', ${p.x}, ${p.y}, 0, ${M0}), true)`); await sleep(250);
  return { site, p, n0 };
}
const clickMap = async (g, p) => { await g.eval(`(BSU.ui.pointer('down', ${p.x}, ${p.y}, 0, ${M0}), BSU.ui.pointer('up', ${p.x}, ${p.y}, 0, ${M0}), true)`); await sleep(350); };
/** fast-forward `n` days, a day at a time, answering whatever toast is up with its default and closing cards (scaffolding) */
async function days(g, n, until) {
  for (let k = 0; k < n; k++) {
    await g.eval(`(BSU.headless.fastForwardDays(1), true)`); await calm(g);
    if (until && (await g.eval(until))) return k + 1;
  }
  return n;
}
const inspect = (g) => g.eval(`(function () {
  var e = document.getElementById('inspect'), open = e && !e.classList.contains('hidden'), b = document.getElementById('btn-insp-upgrade'), up = document.getElementById('insp-upgrade');
  var acts = Array.from(document.querySelectorAll('#insp-actions button')).map(function (x) { return x.textContent; });
  return { open: !!open, title: (document.getElementById('insp-title') || {}).textContent || '', actions: acts, upgrade: b ? { text: b.textContent, disabled: !!b.disabled, lit: b.classList.contains('step-lit') } : null, block: up ? up.innerText.replace(/\\n+/g, ' | ') : '' };
})()`);

const index = resolveIndex(args.index);
const shot = async (g, name) => console.log('shot', await g.shot('steps-' + args.tag + '-' + name));
let g = await openGame({ width: 1440, height: 900, size: args.size, seed: 42, outDir: args.out, noGuard: true, index });
try {
  await setup(g);
  let c = await openCard(g); say('goal card', c); await shot(g, '1-goal-card');
  if (before) {
    // what a player saw before the pass
    await g.eval(`(BSU.ui.openBuildMenu(BSU.state, { focus: 'stadium', pulse: true }), true)`); await sleep(700); await shot(g, '2-stadium-locked');
    console.log('  Build sheet, Stadium: ' + JSON.stringify(await g.eval(`(function () { var c = document.querySelector('#bm-cards [data-id="stadium"]'), d = document.getElementById('bm-dbody'); return { card: c ? c.innerText.replace(/\\n+/g, ' | ') : null, detail: d ? d.innerText.replace(/\\n+/g, ' | ').slice(0, 400) : null, reason: BSU.progress.unlockReason(BSU.state, 'stadium') }; })()`)));
    await g.eval(`(BSU.ui.closeBuildMenu(), true)`);
    const pf = await g.placeAnywhere('practice_field'); await g.days(8);
    if (pf.ok) { await g.eval(`(function () { var b = BSU.buildings.list(BSU.state, 'practice_field')[0]; BSU.render.panToTile(b.tx + 2, b.ty + 1, false); BSU.ui.goalOpen(false); while (BSU.ui.cardOpen && BSU.ui.cardOpen()) BSU.ui.closeCard(); BSU.ui.dismissNotifs(); BSU.ui.inspect(BSU.state, { kind: 'building', id: b.id }); return true; })()`); await sleep(700); await shot(g, '3-inspect-upgrade'); console.log('  inspect card: ' + JSON.stringify(await inspect(g))); }
    else bad('before: the Practice Field did not place (' + pf.reason + ')');
  } else {
    // ---- 1. Build a Practice Field ----
    if (c.steps.length !== 5) bad('the card shows ' + c.steps.length + ' steps, expected 5');
    if (!c.steps[0] || !c.steps[0].cur || !/Practice Field/.test(c.steps[0].text)) bad('the current step is not "Build a Practice Field"');
    if ((await g.eval(`document.getElementById('objective-card').dataset.kind`)) !== 'background') bad('the card is not the "in the background" card');
    if (c.rect[3] > c.vh || c.rect[2] > c.vw) bad('the card runs outside the window ' + JSON.stringify(c.rect));
    await clickStep(g, 'Build it');
    let st = await g.eval(`({ sheet: BSU.ui.buildSheetState(), tool: (BSU.ui.tool() && BSU.ui.tool().id) || null, focus: BSU.ui.focusedCard() })`);
    console.log('  Build it → ' + JSON.stringify(st)); await shot(g, '2-build-it-practice-field');
    if (st.tool !== 'practice_field' || st.sheet !== 'expanded') bad('Build it did not arm the Practice Field on the open Build sheet');
    await g.clickEl('#btn-bm-place'); await sleep(400);
    let pl = await placeOnMap(g, 'practice_field');
    if (pl) { await clickMap(g, pl.p); if ((await g.eval(`BSU.buildings.count(BSU.state, 'practice_field')`)) !== pl.n0 + 1) bad('the map click did not place the Practice Field'); }
    await days(g, 20, `(function () { var b = BSU.buildings.list(BSU.state, 'practice_field')[0]; return !!b && b.built >= 1; })()`);
    // ---- 2. Upgrade the Practice Field to Bayou Field ----
    c = await openCard(g); say('after the field', c); await shot(g, '3-step-upgrade-field');
    if (!c.steps.some((s) => s.cur && /Upgrade the Practice Field to Bayou Field/.test(s.text))) bad('the current step is not the Bayou Field upgrade');
    await clickStep(g, 'Take me there'); await g.settleCamera(); await sleep(400); await calm(g);
    let ins = await inspect(g); console.log('  inspect: ' + JSON.stringify(ins)); await shot(g, '4-inspect-bayou-field');
    if (!ins.open || !ins.upgrade || !/^Upgrade to Bayou Field · \$600k$/.test(ins.upgrade.text) || ins.upgrade.disabled || !ins.upgrade.lit) bad('the inspect card does not offer the lit, priced Bayou Field upgrade');
    await calm(g); await g.clickEl('#btn-insp-upgrade'); await sleep(500);
    ins = await inspect(g); console.log('  after the click: ' + ins.block); await shot(g, '5-inspect-upgrading');
    if (!/Upgrading to Bayou Field · done in \d+ days?/.test(ins.block)) bad('the inspect card does not say the upgrade is under way');
    await days(g, 30, `BSU.buildings.has(BSU.state, 'practice_field', 1)`);
    // ---- 3. Build a Stadium ----
    c = await openCard(g); say('after Bayou Field', c); await shot(g, '6-step-stadium');
    if (!c.steps.some((s) => s.cur && /Build a Stadium/.test(s.text))) bad('the current step is not "Build a Stadium"');
    let cs = await curStep(g); console.log('  step: ' + JSON.stringify(cs));
    if (cs && cs.action && cs.action.kind !== 'build') {
      // no site on the campus's own land: the step says what is missing; do what it says (a road beside the site it shows, or a section at the Land Office)
      await clickStep(g, cs.label); await g.settleCamera(); await sleep(500); await shot(g, '6b-no-site');
      if (cs.action.kind === 'show') {
        const at = cs.action; console.log('  the step shows the site at ' + at.tx + ',' + at.ty + ': laying a Campus Road beside it (a player drags it)');
        await g.pickTool('road');
        const run = await g.eval(`(function () { var s = BSU.state, B = BSU.buildings, W = BSU.MAP.W, H = BSU.MAP.H, sc = B.siteScan(s, 'stadium'), a = sc.at, w = a.rot ? sc.h : sc.w, h = a.rot ? sc.w : sc.h, best = null;
          // any 3-tile straight run inside the rule's box (4 tiles round the site) that keeps a tile of margin from the site itself and takes a road whole
          for (var y = a.ty - 4; y <= a.ty + h + 3 && !best; y++) for (var x = a.tx - 4; x <= a.tx + w + 1 && !best; x++) {
            if (y < 1 || x < 1 || x + 2 >= W - 1 || y >= H - 1) continue;
            if (y >= a.ty - 1 && y <= a.ty + h && x + 2 >= a.tx - 1 && x <= a.tx + w) continue;
            var tiles = [y * W + x, y * W + x + 1, y * W + x + 2], q = B.runQuote(s, 'road', tiles, {});
            if (q && q.placed === 3 && !q.refused) best = { y: y, x0: x, x1: x + 2, rot: a.rot, quote: q.placed + ' tiles $' + q.cost };
          }
          return best; })()`);
        console.log('  road run: ' + JSON.stringify(run) + ' · tool ' + (await g.eval(`(BSU.ui.tool() && BSU.ui.tool().id) || null`)));
        if (!run) bad('no row beside the shown site takes a road');
        else {
          await g.eval(`(BSU.ui.goalOpen(false), BSU.ui.collapseBuildSheet && BSU.ui.collapseBuildSheet(), true)`); await sleep(200);
          const a = await g.tilePx(run.x0 + 0.5, run.y + 0.5), b2 = await g.tilePx(run.x1 + 0.5, run.y + 0.5);
          await g.eval(`(BSU.ui.pointer('move', ${Math.round(a.x)}, ${Math.round(a.y)}, 0, ${M0}), BSU.ui.pointer('down', ${Math.round(a.x)}, ${Math.round(a.y)}, 0, ${M0}), BSU.ui.pointer('move', ${Math.round((a.x + b2.x) / 2)}, ${Math.round((a.y + b2.y) / 2)}, 0, ${M0}), BSU.ui.pointer('move', ${Math.round(b2.x)}, ${Math.round(b2.y)}, 0, ${M0}), true)`); await sleep(300); await shot(g, '6c-road-drag');
          await g.eval(`(BSU.ui.pointer('up', ${Math.round(b2.x)}, ${Math.round(b2.y)}, 0, ${M0}), true)`); await sleep(300); await g.key('Escape');
          console.log('  after the road: ' + JSON.stringify(await g.eval(`(function () { var sc = BSU.buildings.siteScan(BSU.state, 'stadium'); return { ok: sc.ok, need: sc.need, rot: sc.rot }; })()`)));
        }
      } else if (cs.action.kind === 'panel') { await sleep(300); const ok = await g.clickButtonText('#menu-sheet', 'Buy'); console.log('  Land Office: bought a section: ' + ok); await g.eval(`(BSU.ui.openPanel(null), true)`); }
      c = await openCard(g); say('after the fix', c); cs = await curStep(g);
    }
    await clickStep(g, 'Build it'); await shot(g, '7-build-it-stadium');
    await g.clickEl('#btn-bm-place'); await sleep(400);
    pl = await placeOnMap(g, 'stadium');
    if (pl) { await shot(g, '8-stadium-ghost'); await clickMap(g, pl.p); if ((await g.eval(`BSU.buildings.count(BSU.state, 'stadium')`)) !== pl.n0 + 1) bad('the map click did not place the Stadium'); }
    // ---- 4. Upgrade the Stadium to The Cauldron ----
    c = await openCard(g); say('Stadium under construction', c);
    if (!/under construction/i.test(c.note)) warn('the upgrade step does not say the Stadium is still being built (' + c.note + ')');
    await days(g, 30, `BSU.buildings.has(BSU.state, 'stadium', 1)`);
    await g.eval(`(BSU.state.economy.cash = 1.2e6, true)`);   // scaffolding: short of the price, to show the disabled button and its reason
    await openCard(g); await sleep(1300);   // the open card re-reads its steps once a second
    c = await openCard(g); say('short of cash', c); await shot(g, '9-step-cauldron-needs');
    if (!/\$8M \(you have \$1\.2M/.test(c.needs)) bad('the step does not state the missing cash with live numbers (' + c.needs + ')');
    await clickStep(g, 'Take me there'); await g.settleCamera(); await sleep(400); await calm(g);
    ins = await inspect(g); console.log('  inspect (short): ' + JSON.stringify(ins)); await shot(g, '10-inspect-cauldron-disabled');
    if (!ins.upgrade || !ins.upgrade.disabled || !/Needs \$8M/.test(ins.block)) bad('the upgrade button is not disabled with its reason on the card');
    await g.eval(`(BSU.state.economy.cash = 16e6, BSU.ui.closeInspect(), true)`);
    await clickStep(g, 'Take me there'); await g.settleCamera(); await sleep(400); await calm(g);
    ins = await inspect(g); console.log('  inspect: ' + JSON.stringify(ins)); await shot(g, '11-inspect-cauldron');
    if (!ins.upgrade || !/^Upgrade to The Cauldron · \$8M$/.test(ins.upgrade.text) || ins.upgrade.disabled || !ins.upgrade.lit || !/45,000 seats · night games/.test(ins.block)) bad('the inspect card does not offer the lit, priced Cauldron upgrade with what it gives');
    await calm(g); await g.clickEl('#btn-insp-upgrade'); await sleep(400);
    await days(g, 30, `BSU.buildings.has(BSU.state, 'stadium', 2)`);
    if (!(await g.eval(`BSU.buildings.has(BSU.state, 'stadium', 2)`))) bad('The Cauldron did not complete');
    // ---- 5. Play a night game ----
    await g.eval(`(BSU.ui.closeInspect(), true)`);
    c = await openCard(g); say('The Cauldron stands', c); await shot(g, '12-step-night-game');
    cs = await curStep(g); console.log('  step: ' + JSON.stringify(cs) + ' · scripted day ' + (await g.eval(`BSU.state.sports.scriptedNightDay`)) + ' · today ' + (await g.eval(`BSU.formatDate(BSU.state.calendar.day)`)));
    if (!cs || cs.id !== 'night') bad('the current step is not the night game');
    if (cs && cs.action && cs.action.kind === 'panel') {
      // nothing on the calendar yet: the fallback button opens Season on the Night games switch
      await clickStep(g, 'Night games switch'); await sleep(600);
      const sw = await g.eval(`(function () { var e = document.getElementById('chk-night'), q = e ? e.getBoundingClientRect() : null; return { panel: BSU.ui.panel(), lit: !!e && e.classList.contains('step-lit'), visible: !!q && q.width > 0 && q.top >= 0 && q.bottom <= innerHeight, disabled: !!e && e.disabled, text: e ? e.textContent : '' }; })()`);
      console.log('  Season: ' + JSON.stringify(sw)); await shot(g, '13-season-night-switch');
      if (sw.panel !== 'season' || !sw.lit || !sw.visible || sw.disabled) bad('the step did not open Season with the Night games switch lit');
      await g.clickEl('#chk-night'); await sleep(300); await g.eval(`(BSU.ui.openPanel(null), true)`);
    }
    // the season arrives, the game is played
    const waited = await days(g, 260, `BSU.progress.earned(BSU.state, 'nightFalls')`);
    const end = await g.eval(`(function () { var s = BSU.state, o = s.progress.objectives['20']; return { earned: BSU.progress.earned(s, 'nightFalls'), goal: o.state, day: BSU.formatDate(s.calendar.day), firstNight: s.sports.firstNightGameDay >= 0 ? BSU.formatDate(s.sports.firstNightGameDay) : null, scripted: s.sports.scriptedNightDay >= 0 ? BSU.formatDate(s.sports.scriptedNightDay) : null }; })()`);
    console.log('  after ' + waited + ' days: ' + JSON.stringify(end));
    if (!end.earned) bad('Night Falls on the Cauldron was not earned within 260 days'); if (end.goal !== 'done') bad('Objective 20 is ' + end.goal + ', not done');
    await g.eval(`(function () { var b = BSU.buildings.list(BSU.state, 'stadium')[0]; if (b) BSU.render.panToTile(b.tx + 3, b.ty + 2, false); BSU.ui.dismissNotifs(); return true; })()`); await sleep(600); await shot(g, '14-night-falls');
  }
  const errs = await g.errorsSince(); if (errs.length) bad(errs.length + ' error(s): ' + errs.slice(0, 3).join(' | '));
  for (const n of g.notes.splice(0)) console.log('  note: ' + n);
} finally { await g.close(); }

// ---- the card at 1280 x 720, Display size 130 %: every step still to do, then the longest row (a needs line and its button) ----
killStrays();
g = await openGame({ width: 1280, height: 720, size: args.size, seed: 42, outDir: args.out, noGuard: true, index });
try {
  await setup(g, { cash: 16e6 });
  await g.eval(`(BSU.ui.setUiScale(1.3), true)`); await sleep(400);
  let c = await openCard(g); say('1280 x 720 @ 130 % (effective ' + (await g.eval(`BSU.ui.uiScaleEffective()`)) + ')', c); await shot(g, '15-card-1280x720-130');
  if (c.rect[3] > c.vh + 0.5 || c.rect[2] > c.vw + 0.5 || c.rect[0] < 0 || c.rect[1] < 0) bad('1280 x 720 @ 130 %: the card runs outside the window ' + JSON.stringify(c.rect) + ' in ' + c.vw + ' x ' + c.vh);
  if (!before) {
    for (const sc of [1.15, 1.3]) {
      await g.eval(`(function () { var s = BSU.state; BSU.ui.setUiScale(${sc}); if (!BSU.buildings.count(s, 'practice_field')) { var p = BSU.headless.findSpot('practice_field'); if (p) BSU.headless.place('practice_field', p.x, p.y); BSU.headless.fastForwardDays(8); } s.economy.cash = -1.9e6; return true; })()`); await sleep(400);
      c = await openCard(g); say('1280 x 720 @ ' + Math.round(sc * 100) + ' %, a needs line', c);
      if (c.rect[3] > c.vh + 0.5 || c.rect[2] > c.vw + 0.5) bad('1280 x 720 @ ' + Math.round(sc * 100) + ' %: the card with a needs line runs outside the window ' + JSON.stringify(c.rect));
      if (!c.needs) warn('1280 x 720: the needs line is empty');
    }
    await shot(g, '16-card-1280x720-130-needs');
    // the tallest row: the Stadium step with a needs line, a three-line note and its button (Bayou Field by scaffolding)
    await g.eval(`(function () { var s = BSU.state, b = BSU.buildings.list(s, 'practice_field')[0]; if (b) { b.built = 1; b.tier = 1; b.upgradeDoneDay = -1; } s.economy.cash = 16e6; BSU.headless.tick(2); return true; })()`);
    for (const sc of [1.15, 1.3]) {
      await g.eval(`(BSU.ui.setUiScale(${sc}), BSU.ui.goalOpen(false), true)`); await sleep(300);
      c = await openCard(g); await sleep(1300); c = await card(g); say('1280 x 720 @ ' + Math.round(sc * 100) + ' %, the Stadium step', c);
      if (c.rect[3] > c.vh + 0.5 || c.rect[2] > c.vw + 0.5) bad('1280 x 720 @ ' + Math.round(sc * 100) + ' %: the card with the Stadium step runs outside the window ' + JSON.stringify(c.rect));
    }
    await shot(g, '16b-card-1280x720-130-stadium-step');
    await g.eval(`(BSU.ui.goalOpen(false), true)`); await sleep(400);
    const pill = await g.eval(`(function () { var p = document.getElementById('goal-pill'), q = p.getBoundingClientRect(), st = document.getElementById('gp-step'); return { text: p.innerText.replace(/\\n+/g, ' | '), w: Math.round(q.width), h: Math.round(q.height), step: st && !st.classList.contains('hidden') ? st.textContent : '', clipped: st ? st.scrollWidth > st.clientWidth + 1 : false }; })()`);
    console.log('  pill: ' + JSON.stringify(pill)); await shot(g, '17-pill-1280x720-130');
  }
  const errs = await g.errorsSince(); if (errs.length) bad(errs.length + ' error(s): ' + errs.slice(0, 3).join(' | '));
} finally { await g.close(); }
killStrays();
console.log(problems || (args.strict && warnings) ? problems + ' problem(s), ' + warnings + ' warning(s)' : 'ALL OK' + (warnings ? ' (' + warnings + ' warning(s))' : ''));
process.exit(problems || (args.strict && warnings) ? 1 : 0);
