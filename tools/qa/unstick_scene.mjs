// Unstick pass scene (the playtester's "Stuck / soft-locks" notes, docs/CONTENT_BACKLOG.md §1): real Chrome, 1440 x 900.
//  (a) Receivership: a campus that spends more than it earns is driven into receivership and through it with real clicks. Shot along the
//      way: the Board's card, the deadline warning and its dialog, the receivership dialog, the chip, a refused build, a path that is still
//      allowed, the exit. Then the same campus is left alone for three more years (the player answers every Board card "Not now") to show
//      what a loop looks like.
//  (b) A fresh game (no save, default settings, the tutorial on), at 96 and at 64: the first three goals played with only what a new player
//      has: the goal card's step button, the Build FAB and sheet, and map clicks through BSU.ui.pointer. The awkward cases a student hits
//      are played too: an illegal click with Founders' Hall, Esc mid-placement, the path clicked on water, a path that reaches neither end,
//      the goal card closed, the Build sheet opened early, the coach card dismissed.
//   node tools/qa/unstick_scene.mjs [--strict] [--index path] [--tag before|after] [--out dir] [--only a|b] [--size 96|64]
// --tag before (run it on tools/qa/out/index-before.html): nothing is asserted about the new surfaces; what a player saw is logged and shot.
// Exit 1 on a problem (--strict: warnings too). Scaffolding, not play: the campus that loses money (placed through BSU.headless, the real
// unlock rules restored), the starting cash, fast-forwarding days, closing the cards and toasts that are not part of the scene.
import { openGame, parseArgs, DEFAULT_OUT, killStrays, sleep, resolveIndex, sizesOf } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { strict: { type: 'bool', def: false }, index: { type: 'str', def: '' }, tag: { type: 'str', def: 'after' }, out: { type: 'str', def: DEFAULT_OUT }, only: { type: 'str', def: '' }, size: { type: 'str', def: 'both' } });
const before = args.tag === 'before';
killStrays();
let problems = 0, warnings = 0;
const bad = (m) => { problems++; console.log('  PROBLEM: ' + m); };
const warn = (m) => { warnings++; console.log('  warning: ' + m); };
const need = (cond, m) => { if (!cond) bad(m); return !!cond; };
const M0 = `{ ctrl: false, shift: false, meta: false, alt: false }`;
const index = resolveIndex(args.index);
const shotOf = (g, part) => async (name) => console.log('shot', await g.shot('unstick-' + args.tag + '-' + part + '-' + name));

// ---- shared: what is on screen ----
const vis = `function (e) { if (!e) return false; for (var p = e; p; p = p.parentElement) if (p.classList && p.classList.contains('hidden')) return false; var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && Number(getComputedStyle(e).opacity) > 0.2; }`;
/** the HUD as a player reads it: goal card / pill, tool, Build FAB, sheet, coach card, snackbars, ghost label, the open dialog */
const hud = (g) => g.eval(`(function () {
  var vis = ${vis}, $ = function (id) { return document.getElementById(id); }, txt = function (id) { var e = $(id); return e && vis(e) ? (e.innerText || e.textContent || '').replace(/\\s*\\n+\\s*/g, ' | ').trim() : ''; };
  var s = BSU.state, steps = Array.from(document.querySelectorAll('#obj-steps > li')).map(function (li) { var t = li.querySelector('.st-t'); return (li.classList.contains('done') ? '[x] ' : li.getAttribute('aria-current') === 'step' ? '[>] ' : '[ ] ') + (t ? t.textContent : li.textContent); });
  var o = BSU.progress.objective(s), b = $('btn-obj-build'), chip = $('board-chip');
  return { stage: BSU.progress.tutorialStage(s), goal: o ? o.id : null, cardOpen: vis($('objective-card')), pill: txt('goal-pill'), title: txt('obj-title'), text: txt('obj-text'), count: txt('obj-count'), steps: vis($('objective-card')) ? steps : [],
    stepButton: vis(b) ? b.textContent : '', showMe: vis($('btn-showme')), tool: s.ui.tool ? s.ui.tool.id : null, fab: vis($('fab-build')), sheet: BSU.ui.buildSheetState ? BSU.ui.buildSheetState() : '', tabs: Object.keys(s.ui.tabsIntroduced || {}).filter(function (k) { return s.ui.tabsIntroduced[k]; }),
    coach: vis($('coach')) ? txt('coach-title') : '', x: vis($('btn-obj-dismiss')), paused: txt('obj-paused'), card: BSU.ui.cardOpen(), dialog: txt('cards').slice(0, 900), snacks: BSU.ui._snacks().visible.map(function (x) { return x.text; }), ghost: txt('ghost-label'), chip: chip && vis(chip) ? chip.textContent : '', speed: s.ui.speed, cash: Math.round(s.economy.cash), day: s.calendar.day, date: BSU.formatDate(s.calendar.day) };
})()`);
const line = (h) => `stage ${h.stage} · goal ${h.goal} · ${h.cardOpen ? 'card "' + h.title + '" ' + (h.count ? '(' + h.count + ') ' : '') + JSON.stringify(h.steps) + (h.stepButton ? ' [' + h.stepButton + ']' : '') + (h.showMe ? ' [Show me]' : '') : 'pill "' + h.pill + '"'} · tool ${h.tool} · FAB ${h.fab ? 'shown' : 'hidden'} · sheet ${h.sheet}${h.paused ? ' · PAUSED ROW "' + h.paused + '"' : ''}${h.coach ? ' · coach "' + h.coach + '"' : ''}${h.card ? ' · dialog ' + h.card : ''}${h.chip ? ' · chip "' + h.chip + '"' : ''}${h.ghost ? ' · ghost "' + h.ghost + '"' : ''}${h.snacks.length ? ' · snack ' + JSON.stringify(h.snacks) : ''}`;
const px = (g, tx, ty) => g.eval(`(function () { var p = BSU.render.tileToScreen(${tx} + 0.5, ${ty} + 0.5); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
const move = async (g, p) => { await g.eval(`(BSU.ui.pointer('move', ${p.x}, ${p.y}, 0, ${M0}), true)`); await sleep(220); };
const clickAt = async (g, p) => { await g.eval(`(BSU.ui.pointer('move', ${p.x}, ${p.y}, 0, ${M0}), BSU.ui.pointer('down', ${p.x}, ${p.y}, 0, ${M0}), BSU.ui.pointer('up', ${p.x}, ${p.y}, 0, ${M0}), true)`); await sleep(300); };
/** one drag of the armed run tool from tile a to tile b (the machine plans one L) */
const dragTiles = async (g, a, b) => { const p = await px(g, a[0], a[1]), q = await px(g, b[0], b[1]); await g.eval(`(BSU.ui.pointer('move', ${p.x}, ${p.y}, 0, ${M0}), BSU.ui.pointer('down', ${p.x}, ${p.y}, 0, ${M0}), BSU.ui.pointer('move', ${Math.round((p.x + q.x) / 2)}, ${Math.round((p.y + q.y) / 2)}, 0, ${M0}), BSU.ui.pointer('move', ${q.x}, ${q.y}, 0, ${M0}), true)`); await sleep(250); const lab = await g.elText('#ghost-label'); await g.eval(`(BSU.ui.pointer('up', ${q.x}, ${q.y}, 0, ${M0}), true)`); await sleep(300); return (lab || '').replace(/\s*\n+\s*/g, ' | '); };
/** the player reads a dialog and clicks its one main button (logs which dialog it was); returns the ids dismissed */
const gotIt = async (g, label = '') => { const out = []; for (let k = 0; k < 4; k++) { const c = await g.eval(`BSU.ui.cardOpen()`); if (!c) break; const t = await g.eval(`(function () { var e = document.querySelector('#cards .card-title'); return e ? e.textContent : ''; })()`); const ok = await g.eval(`(function () { var b = document.querySelector('#cards .card-actions button.primary') || document.querySelector('#cards .card-actions button'); if (!b) return false; b.click(); return true; })()`); out.push(c); console.log('  ' + (label ? label + ': ' : '') + 'dialog "' + t + '" (' + c + ') ' + (ok ? 'dismissed with its button' : 'has no button')); await sleep(350); if (!ok) break; } return out; };
/** a free site for a footprint on dry ground with a tile of margin all round, nearest the founders' plot */
const freeSite = (g, id) => g.eval(`(function () { var s = BSU.state, B = BSU.buildings, f = s.plot.founders, W = BSU.MAP.W, id = ${JSON.stringify(id)}, r0 = BSU.data.catalog[id];
  for (var m = 2; m >= 1; m--) for (var r = 2; r < 26; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; var x = f.tx + dx, y = f.ty + dy; var q = B.canPlace(s, id, x, y, { rot: 0 }); if (!q || !q.ok) continue;
    var clear = true; for (var yy = y - m; yy <= y + r0.h - 1 + m && clear; yy++) for (var xx = x - m; xx <= x + r0.w - 1 + m; xx++) { var i = yy * W + xx; if (s.tiles.owner[i] !== -1 || s.tiles.surface[i] !== 0 || s.tiles.type[i] < 4) { clear = false; break; } } if (clear) return { tx: x, ty: y, w: r0.w, h: r0.h, margin: m }; }
  return null; })()`);
/** the player moves the mouse over the site until the ghost is not red (the footprint is anchored on the cursor tile; a ridge shifts the picking), then holds there */
const aim = async (g, site) => {
  const c = await g.eval(`(function () { var p = BSU.render.tileToScreen(${site.tx} + ${(site.w - 1) / 2}, ${site.ty} + ${(site.h - 1) / 2}); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
  for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const p = { x: c.x + dx * 22, y: c.y + dy * 12 }; await g.eval(`(BSU.ui.pointer('move', ${p.x}, ${p.y}, 0, ${M0}), true)`); await sleep(90);
    const lab = await g.eval(`(function () { var e = document.getElementById('ghost-label'); return e && !e.classList.contains('hidden') ? { color: e.dataset.color || '', text: e.innerText.replace(/\\s*\\n+\\s*/g, ' | ') } : null; })()`);
    if (lab && lab.color !== 'red') return Object.assign(p, { label: lab.text });
  }
  return null;
};
const camera = (g) => g.eval(`(function () { var c = BSU.state.ui.camera; return [Math.round(c.x), Math.round(c.y), c.zoom].join(','); })()`);
/** the player drags the map (scaffolding for "scroll there"): centre a tile */
const lookAt = async (g, tx, ty) => { await g.eval(`(BSU.render.panToTile(${tx}, ${ty}, false), true)`); await g.settleCamera(); };

// =====================================================================================================================================
// (b) a fresh game cannot stick at the start
// =====================================================================================================================================
async function freshGame(size) {
  console.log(`\n=== (b) a fresh game, ${size} x ${size}, the tutorial on, default settings ===`);
  killStrays();
  const g = await openGame({ width: 1440, height: 900, size, seed: 42, outDir: args.out, noGuard: true, index, newGame: false });
  const shot = shotOf(g, 'b' + size);
  const stuck = async (what) => { const h = await hud(g); const way = h.tool || h.stepButton || h.fab || (h.cardOpen && h.showMe) || /\S/.test(h.pill); if (!way) bad(`${size}: ${what}: no visible next action (${line(h)})`); return h; };
  try {
    // the title screen, then the game the Charter button starts (seed and size fixed so the scene is repeatable; the button itself passes neither)
    const title = await g.eval(`(function () { var vis = ${vis}; return { title: vis(document.getElementById('title')), charter: vis(document.getElementById('btn-charter')), saves: Object.keys(localStorage).filter(function (k) { return /^bsu\\.save/.test(k); }).length, coachSeen: !!BSU.ui.settings().coachSeen }; })()`);
    console.log('  title: ' + JSON.stringify(title));
    need(title.title && title.charter, size + ': the title screen offers "Charter the university"');
    await g.eval(`(BSU.session.newGame({ seed: 42, size: ${size} }), BSU.ui.showTitle(false), true)`); g.size = size; await g.noGuard();
    await sleep(600); let h = await hud(g); console.log('  0.0 s: ' + line(h)); await shot('1-charter-card');
    // the charter card closes on its own (3 s); the player may also click it
    await g.until(`BSU.progress.tutorialStage(BSU.state) >= 2`, 8000); await sleep(500);
    const cam0 = await camera(g);
    h = await stuck('goal 1'); console.log('  goal 1: ' + line(h)); await shot('2-goal1');
    need(h.goal === '1' && h.tool === 'founders_hall', size + ": goal 1 is on screen with Founders' Hall armed (" + h.goal + ', ' + h.tool + ')');
    // -- awkward: the X in the card's corner. It reads as "close", and it used to DISMISS the goal: the tutorial then never moved on --
    console.log('  the goal card\'s X ("' + (await g.eval(`document.getElementById('btn-obj-dismiss').title`)) + '") is ' + (h.x ? 'shown' : 'not shown') + ' on goal 1');
    if (!before) need(!h.x, size + ': a tutorial goal has no dismiss X');
    const plot = await g.eval(`(function () { var s = BSU.state, f = s.plot.founders, W = BSU.MAP.W, l = s.plot.landing, sh = s.plot.landingShoulder; return { f: [f.tx, f.ty], landing: [l % W, (l / W) | 0], shoulder: [sh % W, (sh / W) | 0], rect: s.plot.rect }; })()`);
    console.log('  plot: ' + JSON.stringify(plot));
    // -- awkward: Esc with the locked hall tool, the Build sheet before the tutorial asks, a click on water --
    await g.key('Escape'); h = await stuck('Esc on goal 1'); console.log('  Esc: ' + line(h));
    need(h.tool === 'founders_hall', size + ": Esc does not take Founders' Hall away during goal 1 (tool " + h.tool + ')');
    await g.key('g'); await sleep(250); h = await hud(g); console.log('  G (Build sheet before any tab exists): ' + line(h));
    const water = await g.eval(`(function () { var s = BSU.state, W = BSU.MAP.W, H = BSU.MAP.H, f = s.plot.founders, best = null; for (var i = 0; i < W * H; i++) { if (s.tiles.type[i] > 1) continue; var x = i % W, y = (i / W) | 0, d = Math.abs(x - f.tx) + Math.abs(y - f.ty); if (!best || d < best.d) best = { tx: x, ty: y, d: d }; } return best; })()`);
    await lookAt(g, (water.tx + plot.f[0]) >> 1, (water.ty + plot.f[1]) >> 1);
    let p = await px(g, water.tx, water.ty); await move(g, p); h = await hud(g); console.log('  hover the hall over water: ghost "' + h.ghost + '"'); await shot('3-hall-on-water');
    await clickAt(g, p); h = await stuck('the hall clicked on water'); console.log('  click on water: ' + line(h));
    // the hall's ghost is pinned to the founders' site whatever the cursor is over, so any map click places it: goal 1 cannot be clicked wrong
    if (h.stage < 3) {
      need(h.tool === 'founders_hall' && h.goal === '1', size + ': a refused hall click leaves goal 1 playable (tool ' + h.tool + ')');
      const site = await g.eval(`(function () { var s = BSU.state, f = s.plot.founders, B = BSU.buildings; for (var r = 0; r < 8; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) { var q = B.canPlace(s, 'founders_hall', f.tx + dx, f.ty + dy, { rot: 0 }); if (q && q.ok) return { tx: f.tx + dx, ty: f.ty + dy }; } return null; })()`);
      if (!need(!!site, size + ": a legal site for Founders' Hall exists")) return;
      await lookAt(g, site.tx + 1, site.ty + 1); p = await px(g, site.tx, site.ty); await move(g, p); await shot('4-hall-ghost'); await clickAt(g, p);
    } else console.log("  (the hall's ghost is pinned to the founders' site: the click on water placed it there)");
    await g.until(`BSU.progress.tutorialStage(BSU.state) >= 3`, 4000); await sleep(600);
    // -- awkward: Ctrl+Z straight after the hall (the Undo chip used to offer "Undo Founders' Hall" for 10 s) --
    const undo = await g.eval(`(function () { var u = BSU.buildings.undoInfo(BSU.state); return u ? u.name : null; })()`);
    if (size === 64) { await g.key('z', { ctrl: true }); await sleep(300); }
    const halls = await g.eval(`BSU.buildings.count(BSU.state, 'founders_hall')`);
    console.log('  after the hall: the Undo chip offers ' + JSON.stringify(undo) + (size === 64 ? ' · Ctrl+Z pressed' : '') + ' · Founders\' Halls on the map: ' + halls);
    if (!before) { need(undo === null, size + ": Founders' Hall is not offered for undo"); need(halls === 1, size + ": Founders' Hall stands after Ctrl+Z"); }
    h = await stuck('goal 2'); console.log('  goal 2: ' + line(h)); await shot('5-goal2');
    if (!before) need(!h.x, size + ': goal 2 has no dismiss X');
    else if (size === 64 && h.x) console.log('  (before: clicking that X on goal 2 dismisses it: see docs/INTEGRATION_NOTES.md, the tutorial never reaches goal 3)');
    need(h.goal === '2' && h.tool === 'path', size + ': goal 2 is on screen with the Gravel Path armed (' + h.goal + ', ' + h.tool + ')');
    if (before && halls === 0) console.log("  (before: Ctrl+Z took Founders' Hall away for good: it is in no Build tab. The scene goes on from the founders' site)");
    const hall = await g.eval(`(function () { var b = BSU.buildings.list(BSU.state, 'founders_hall')[0] || { tx: BSU.state.plot.founders.tx, ty: BSU.state.plot.founders.ty, w: 3, h: 3 }; return { tx: b.tx, ty: b.ty, w: b.w, h: b.h }; })()`);
    // -- awkward: the path clicked on water (one click), then a short path that touches neither end --
    p = await px(g, water.tx, water.ty); await lookAt(g, (water.tx + hall.tx) >> 1, (water.ty + hall.ty) >> 1); p = await px(g, water.tx, water.ty);
    await move(g, p); h = await hud(g); console.log('  hover the path over water: ghost "' + h.ghost + '"'); await clickAt(g, p);
    h = await stuck('the path clicked on water'); console.log('  path clicked on water: ' + line(h)); await shot('6-path-on-water');
    const stray = await g.eval(`(function () { var s = BSU.state, B = BSU.buildings, W = BSU.MAP.W, f = s.plot.founders, sh = s.plot.landingShoulder; for (var r = 5; r < 14; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r - 2; dx++) { var x = f.tx + dx, y = f.ty + dy; var q = B.runQuote(s, 'path', [y * W + x, y * W + x + 1, y * W + x + 2], { noTie: true }); if (q && q.placed === 3 && !q.refused && Math.abs(x - (sh % W)) + Math.abs(y - ((sh / W) | 0)) > 5) return { tx: x, ty: y }; } return null; })()`);
    if (stray) {
      if (!h.tool) { await reArm(g, size, 'path'); }
      await lookAt(g, stray.tx + 1, stray.ty); const lab = await dragTiles(g, [stray.tx, stray.ty], [stray.tx + 2, stray.ty]);
      h = await stuck('a path that reaches neither end'); console.log('  a 3-tile path off on its own (label "' + lab + '"): ' + line(h)); await shot('7-path-nowhere');
      await gotIt(g, 'after the stray path'); h = await hud(g);
      need(h.goal === '2', size + ': a stray path leaves goal 2 on the card');
    } else warn(size + ': no free spot for the stray path');
    // -- awkward: Esc drops the path tool, the goal card is closed; the way back is the pill, then the step's button --
    await g.key('Escape'); await sleep(200); await g.eval(`(BSU.ui.goalOpen(false), true)`); await sleep(300);
    h = await stuck('Esc, goal card closed'); console.log('  Esc + the card closed: ' + line(h)); await shot('8-esc-card-closed');
    need(!h.tool, size + ': Esc drops the path tool (tool ' + h.tool + ')');
    await reArm(g, size, 'path'); await shot('9-path-rearmed');
    // -- the path, hall to landing, as a player draws it: one drag per straight leg along a walkable route --
    const cam1 = await camera(g);
    const route = await g.eval(`(function () {
      var s = BSU.state, B = BSU.buildings, W = BSU.MAP.W, N = W * BSU.MAP.H, b = B.list(s, 'founders_hall')[0] || { tx: s.plot.founders.tx, ty: s.plot.founders.ty, w: 3, h: 3 }, sh = s.plot.landingShoulder, seen = new Int32Array(N).fill(-2), q = [];
      var ok = function (i) { var c = B.canPlace(s, 'path', i % W, (i / W) | 0, { noTie: true, ignoreCash: true }); return !!(c && c.ok) || s.tiles.surface[i] === BSU.SURF.PATH; };
      BSU.edgeTiles(b.tx, b.ty, b.w, b.h).forEach(function (i) { if (i >= 0 && i < N && ok(i)) { seen[i] = -1; q.push(i); } });
      for (var h = 0; h < q.length; h++) { var i = q[h]; if (i === sh) { var out = []; for (var k = i; k >= 0; k = seen[k]) out.push([k % W, (k / W) | 0]); return out.reverse(); } BSU.nbr4(i).forEach(function (n) { if (seen[n] === -2 && ok(n)) { seen[n] = i; q.push(n); } }); }
      return null; })()`);
    if (!need(!!route, size + ': a walkable path route from the hall to the landing exists')) return;
    console.log('  route: ' + route.length + ' tiles from ' + route[0] + ' to ' + route[route.length - 1]);
    await lookAt(g, (route[0][0] + route[route.length - 1][0]) >> 1, (route[0][1] + route[route.length - 1][1]) >> 1);
    const legs = []; for (let k = 0; k < route.length - 1;) { let e = k + 1; const ax = route[k][0] === route[e][0] ? 0 : 1; while (e + 1 < route.length && (route[e][0] === route[e + 1][0] ? 0 : 1) === ax) e++; legs.push([route[k], route[e]]); k = e; }
    // -- awkward: the game is paused (Space) while the path is drawn: nothing ticks, so the goal cannot complete until the clock runs again --
    await g.key(' '); await sleep(250); console.log('  Space: speed ' + (await g.eval(`BSU.state.ui.speed`)) + '× (paused) before the path is drawn');
    for (let k = 0; k < legs.length; k++) { const lab = await dragTiles(g, legs[k][0], legs[k][1]); await gotIt(g, 'leg ' + (k + 1)); if (k === 0) { console.log('  first leg label: "' + lab + '"'); } if (!(await g.eval(`BSU.ui.tool() && BSU.ui.tool().id`))) { warn(size + ': the path tool dropped after leg ' + (k + 1) + ' of ' + legs.length); await reArm(g, size, 'path'); } }
    await g.eval(`(BSU.ui.goalOpen(true), true)`); await sleep(1800);
    h = await hud(g); console.log('  the path is drawn, the game still paused: ' + line(h)); await shot('10-path-drawn-paused');
    need(h.stage === 3, size + ': paused, the goal waits (stage ' + h.stage + ')');
    if (!before) {
      need(/Done\. The game is paused: press Play to go on\./.test(h.paused) && /Resume/.test(h.paused), size + ': the card says the game is paused and offers Resume (' + h.paused + ')');
      await g.eval(`(BSU.ui.goalOpen(false), true)`); await sleep(400); const pl = (await hud(g)).pill; need(/Paused: press Play to go on/.test(pl), size + ': the pill says so too (' + pl + ')'); await shot('10b-pill-paused');
      await g.eval(`(BSU.ui.goalOpen(true), true)`); await sleep(300); need(await g.clickEl('#btn-obj-resume'), size + ': Resume is clickable');
    } else { console.log('  (before: the step is ticked, nothing says the game is paused; Space again)'); await g.key(' '); }
    await g.until(`BSU.progress.tutorialStage(BSU.state) >= 4`, 5000); await sleep(800); await gotIt(g, 'after the path');
    h = await stuck('goal 3'); console.log('  goal 3: ' + line(h)); await shot('11-goal3');
    need(h.goal === '3', size + ': the path completes goal 2 and goal 3 is on the card (goal ' + h.goal + ')');
    if (!before) { need(!h.x, size + ': goal 3 has no dismiss X'); need(/Step 1 of 2/.test(h.cardOpen ? h.count : h.pill), size + ': goal 3 counts its steps ("Step 1 of 2": ' + (h.cardOpen ? h.count : h.pill) + ')'); }
    need(h.fab || h.sheet !== 'closed', size + ': the Build FAB (or the open sheet) is on screen once goal 3 asks for buildings');
    need(h.tabs.indexOf('essentials') >= 0, size + ': the Essentials tab exists at goal 3');
    // -- awkward: the coach card (first game) is dismissed with Skip tour; the goal is still playable --
    const coachUp = await g.until(`(function () { var c = document.getElementById('coach'); return !!c && !c.classList.contains('hidden'); })()`, 30000, 250);
    if (coachUp) { h = await hud(g); console.log('  coach: ' + line(h)); await shot('12-coach'); await g.clickEl('#btn-coach-skip'); await sleep(400); h = await stuck('the coach card skipped'); console.log('  Skip tour: ' + line(h)); }
    else console.log('  the coach card did not come up within 30 s');
    // -- goal 3 with the step button, the sheet's Place button and one map click each; the second building through the FAB --
    for (const [n, id] of [[0, 'dorm'], [1, 'dining_hall']]) {
      await g.eval(`(BSU.ui.closePopover(), true)`);
      if (n === 0) {
        await g.eval(`(BSU.ui.goalOpen(true), true)`); await sleep(400); h = await hud(g); console.log('  goal card: ' + line(h));
        need(/Build it/.test(h.stepButton), size + ': the current step offers "Build it" (' + h.stepButton + ')');
        await g.clickEl('#btn-obj-build'); await sleep(500); await shot('13-build-it');
        if (await g.elVisible('#btn-bm-place')) { await g.clickEl('#btn-bm-place'); await sleep(350); }
      } else {
        // the Build sheet closed with its own X: the FAB is back; the FAB, the Essentials quick bar, the card
        if ((await g.eval(`BSU.ui.buildSheetState()`)) !== 'closed') { await g.clickEl('#btn-palette-close'); await sleep(350); }
        h = await stuck('the Build sheet closed'); console.log('  the sheet closed: ' + line(h));
        need(h.fab, size + ': the Build FAB shows when the sheet is closed at goal 3');
        need(await g.clickEl('#fab-build'), size + ': the Build FAB is clickable'); await sleep(400); await shot('15-fab-sheet');
        need(await g.clickEl(`#palette-items [data-id="${id}"]`), size + ': the ' + id + ' card is in the Build sheet'); await sleep(350);
      }
      const armed = await g.eval(`(BSU.ui.tool() && BSU.ui.tool().id) || null`);
      const want = n === 0 ? await g.eval(`(function () { var st = BSU.progress.goalSteps(BSU.state, '3').find(function (x) { return x.current; }); return st && st.action ? st.action.tool : null; })()`) : id;
      need(armed === (n === 0 ? want : id), size + ': the tool is armed (' + armed + ', wanted ' + (n === 0 ? want : id) + ')');
      const sp = await freeSite(g, armed || id);
      if (!need(!!sp, size + ': a free site for ' + (armed || id))) continue;
      await lookAt(g, sp.tx + 1, sp.ty - 4); p = await aim(g, sp);   // the site sits above the open Build sheet
      if (!need(!!p, size + ': the ' + (armed || id) + ' ghost turns placeable over its site')) continue;
      console.log('  ghost over the site: "' + p.label + '"'); if (n === 0) await shot('14-dorm-ghost'); const n0 = await g.buildingCount(); await clickAt(g, p); await gotIt(g, 'after ' + (armed || id));
      need((await g.buildingCount()) === n0 + 1, size + ': one map click places the ' + (armed || id));
      h = await hud(g); console.log('  placed ' + (armed || id) + ': ' + line(h));
    }
    await g.until(`BSU.state.progress.objectives['3'].state === 'done'`, 4000); await sleep(500);
    h = await hud(g); console.log('  after goal 3: ' + line(h)); await shot('16-goal3-done');
    need(await g.eval(`BSU.state.progress.objectives['3'].state === 'done'`), size + ': goal 3 is done');
    // -- the gap before goal 4 (it comes with the first rain): what the card says meanwhile, and how long it lasts at 1× --
    const shown = h.cardOpen ? h.title : h.pill;
    console.log('  between goals 3 and 4 the goal ' + (h.cardOpen ? 'card' : 'pill') + ' reads: ' + JSON.stringify(shown));
    if (!before) need(/The next goal is on its way/.test(shown) && !/Build a Dorm/.test(shown), size + ': the finished goal is not left on the card (' + shown + ')');
    else if (/Build a Dorm/.test(shown)) console.log('  (before: the finished goal 3 stays on screen, still asking for the Dining Hall)');
    const t0 = Date.now(); const got4 = await g.until(`(function () { var o = BSU.progress.objective(BSU.state); return !!o && o.id === '4'; })()`, 90000, 500);
    h = await hud(g); console.log('  goal 4 after ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s at 1×: ' + line(h)); await shot('17-goal4');
    need(!!got4, size + ': goal 4 arrives on its own');
    console.log('  camera: ' + cam0 + ' at goal 1; every move in between was the scene\'s own lookAt (a player dragging the map)'); void cam1;
    const errs = await g.errorsSince(); if (errs.length) bad(size + ': ' + errs.length + ' error(s): ' + errs.slice(0, 3).join(' | '));
    for (const n of g.notes.splice(0)) console.log('  note: ' + n);
  } finally { await g.close(); }
}
/** the path tool was dropped: get it back with what is on screen (the goal pill → the card → the step's button; else the FAB) */
async function reArm(g, size, id) {
  let h = await hud(g);
  if (!h.cardOpen) { if (!(await g.clickEl('#goal-pill'))) bad(size + ': the goal pill is not clickable'); await sleep(450); h = await hud(g); }
  console.log('  re-arm: ' + line(h));
  if (h.stepButton) { await g.clickEl('#btn-obj-build'); await sleep(450); if (await g.elVisible('#btn-bm-place')) { await g.clickEl('#btn-bm-place'); await sleep(350); } }
  else if (h.fab) { await g.clickEl('#fab-build'); await sleep(350); await g.clickEl(`#palette-items [data-id="${id}"]`); await sleep(300); }
  h = await hud(g); console.log('  re-armed: ' + line(h));
  if (h.tool !== id) bad(size + ': the ' + id + ' tool could not be re-armed from what is on screen (tool ' + h.tool + ', step button "' + h.stepButton + '", FAB ' + h.fab + ')');
  if (h.sheet === 'expanded') { await g.eval(`(BSU.ui.collapseBuildSheet(), true)`); await sleep(200); }
  await g.eval(`(BSU.ui.goalOpen(false), true)`); await sleep(200);
  return h;
}

// =====================================================================================================================================
// (a) receivership
// =====================================================================================================================================
const DEFICIT = ['dining_hall', 'lecture_hall', 'library', 'engineering', 'union', 'rec_center', 'health_center', 'coastal_institute', 'bell_tower', 'tiger_habitat', 'practice_field'];
const fst = (g) => g.eval(`(function () { var s = BSU.state, f = s.progress.failure, e = s.economy, r = BSU.progress.receivership ? BSU.progress.receivership(s) : null; return { day: s.calendar.day, date: BSU.formatDate(s.calendar.day), cash: Math.round(e.cash), prestige: Math.round(e.prestige), receiver: !!f.receiver, until: f.receiverUntilDay, pending: f.pendingKind || null, speed: s.ui.speed, auto: !!e.autoRepair, quality: e.quality, coaching: e.coaching, negMonths: e.negMonths, phase: r ? r.phase : null, net: r ? r.net : null, card: BSU.ui.cardOpen() }; })()`);
const dialogText = (g) => g.eval(`(function () { var c = document.querySelector('#cards .card'); if (!c) return ''; var q = c.getBoundingClientRect(); return c.innerText.replace(/\\s*\\n+\\s*/g, ' | ') + ' [box ' + Math.round(q.left) + ',' + Math.round(q.top) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height) + ' in ' + innerWidth + 'x' + innerHeight + (c.scrollHeight > c.clientHeight + 1 ? ', scrolls' : '') + ']'; })()`);
const dialogButtons = (g) => g.eval(`Array.from(document.querySelectorAll('#cards .card-actions button')).map(function (b) { return b.textContent; })`);
/** close what comes up on its own and is not part of the scene (season recaps, recruiting, Board proposals, probation, the Student Voice); the Board's own dialogs are left for the scene */
const calmA = async (g) => { for (let k = 0; k < 6; k++) { const c = await g.eval(`BSU.ui.cardOpen()`); if (!c || c === 'receiver' || (c === 'failure' && (await g.eval(`BSU.state.progress.failure.pendingKind`)) === 'bankruptcy')) break; await g.eval(`(function () { var b = document.querySelector('#cards .card-actions button'); if (BSU.ui.cardOpen() === 'failure' && b) b.click(); else BSU.ui.closeCard(); return true; })()`); await sleep(120); } await g.eval(`(function () { try { if (BSU.ui.voiceOpen && BSU.ui.voiceOpen()) document.getElementById('btn-voice-decline').click(); } catch (e) {} try { BSU.ui.closeInspect(); } catch (e) {} return true; })()`); };
/** fast-forward a day at a time until `cond` (a page expression) holds; returns the days run, or -1 */
const runUntil = async (g, cond, max) => { for (let d = 1; d <= max; d++) { await g.eval(`(BSU.headless.fastForwardDays(1), true)`); await calmA(g); if (await g.eval(cond)) return d; } return -1; };

async function receivership() {
  console.log('\n=== (a) receivership: a campus that spends more than it earns (' + args.tag + ') ===');
  killStrays();
  const g = await openGame({ width: 1440, height: 900, size: 96, seed: 42, outDir: args.out, noGuard: true, index });
  const shot = shotOf(g, 'a');
  /** the chip's text once it shows something matching `re` (headless frames are slow: the chip is re-read twice a second of frame time) */
  const chip = async (re) => { if (re) await g.until(`(function () { var c = document.getElementById('board-chip'); return !!c && !c.classList.contains('hidden') && ${re}.test(c.textContent); })()`, 6000, 150); return (await hud(g)).chip; };
  try {
    // scaffolding: eleven costly buildings, no dorm (so 120 students), the cash just inside the loan line, Faculty on Elite and a coaching budget
    await g.cash(1e9); await g.unlockAll();
    for (const id of DEFICIT) { const r = await g.placeAnywhere(id); if (!r.ok) warn('scaffold: ' + id + ' refused (' + r.reason + ')'); }
    await g.days(20); await g.restoreUnlock();
    await g.eval(`(function () { var s = BSU.state; s.economy.cash = -1900000; BSU.economy.setQuality(s, 'elite'); BSU.economy.setCoaching(s, 600000); BSU.ui.dismissNotifs(); while (BSU.ui.cardOpen()) BSU.ui.closeCard(); return true; })()`);
    await runUntil(g, `!BSU.state.setPiece`, 6);   // the Mardi Gras parade (Feb 8) is on the day the scaffolding ends
    await g.eval(`(function () { BSU.state.economy.cash = -1900000; BSU.ui.dismissNotifs(); return true; })()`);
    await g.frameCampus(1, { keepOnMap: false }); await g.waitBake({ timeoutMs: 45000 }); await g.settleCamera(); await sleep(700);
    const cam0 = await camera(g);
    let f = await fst(g); console.log('  start: ' + JSON.stringify(f));
    console.log('  budget: ' + JSON.stringify(await g.eval(`BSU.economy.budget ? BSU.economy.budget(BSU.state) : BSU.economy.statement(BSU.state)`)));
    // ---- 1. in debt and losing money: what warns the player ----
    let c = await chip(before ? null : /Losing/); console.log('  chip: ' + JSON.stringify(c)); await shot('1-in-debt');
    if (!before) {
      need(/^Losing \$\d+k a month$/.test(c), 'in debt and losing money: the chip says "Losing $Nk a month" (' + c + ')');
      need(await g.clickEl('#board-chip'), 'the chip is clickable'); await sleep(450);
      console.log('  dialog: ' + await dialogText(g)); await shot('2-deficit-dialog');
      need((await g.eval(`BSU.ui.cardOpen()`)) === 'receiver', 'the chip opens the explanation'); await gotIt(g);
    }
    // ---- 2. the Board's card ----
    const d1 = await runUntil(g, `BSU.ui.cardOpen() === 'failure' && BSU.state.progress.failure.pendingKind === 'bankruptcy'`, 60); await sleep(400);
    f = await fst(g); console.log('  the Board\'s card after ' + d1 + ' days: ' + JSON.stringify(f)); console.log('  card: ' + await dialogText(g)); console.log('  buttons: ' + JSON.stringify(await dialogButtons(g))); await shot('3-board-card');
    need(d1 > 0, 'the Board\'s card comes after three months past the loan line');
    if (!before) need(/\$2M loan line for 3 months/.test(await dialogText(g)) && /Not now: the Board checks your cash in 60 days/.test(await dialogText(g)), 'the card says why it came and what Not now starts');
    need(await g.clickButtonText('#cards', 'Not now'), 'Not now is clickable'); await sleep(500);
    if (!before) await chip(/Board deadline/);
    f = await fst(g); let h = await hud(g); console.log('  after Not now: ' + JSON.stringify(f) + ' · chip ' + JSON.stringify(h.chip) + ' · snack ' + JSON.stringify(h.snacks)); await shot('4-deadline-warning');
    if (!before) {
      need(/^Board deadline · 60 days$/.test(h.chip), 'the deadline is on the chip with its countdown (' + h.chip + ')');
      await g.eval(`(BSU.headless.fastForwardDays(7), true)`); await calmA(g); await sleep(600);
      f = await fst(g); const left = f.until - f.day;   // (a set piece in those days freezes the calendar, so it is read, not assumed)
      c = await chip(new RegExp(' ' + left + ' days')); need(left < 60 && c === 'Board deadline · ' + left + ' days', 'the countdown follows the calendar (' + c + ', ' + left + ' days to the deadline)');
      await g.clickEl('#board-chip'); await sleep(450); console.log('  dialog: ' + await dialogText(g)); console.log('  buttons: ' + JSON.stringify(await dialogButtons(g))); await shot('5-deadline-dialog');
      const dt = await dialogText(g);
      need(dt.indexOf(left + ' days to get cash back to $0') >= 0 && /Bulldozer/.test(dt) && /The Board's offers still stand/.test(dt), 'the deadline dialog has the countdown and the levers');
      need(!/scrolls\]$/.test(dt), 'the deadline dialog fits the window without scrolling');
      need(await g.clickButtonText('#cards', 'The Board\'s offers'), 'The Board\'s offers is clickable'); await sleep(500);
      console.log('  offers: ' + JSON.stringify(await dialogButtons(g))); await shot('6-offers-again');
      need(await g.clickButtonText('#cards', 'Keep my deadline'), 'the reopened card has "Keep my deadline"'); await sleep(400);
      f = await fst(g); need(f.until > f.day && !f.pending && !f.card, 'keeping the deadline changes nothing (' + JSON.stringify(f) + ')');
    }
    // ---- 3. the deadline passes with cash below $0 ----
    const d2 = await runUntil(g, `BSU.state.progress.failure.receiver === true`, 70); await sleep(600); if (!before) await chip(/Receivership/);
    f = await fst(g); h = await hud(g); console.log('  receivership after ' + d2 + ' more days: ' + JSON.stringify(f)); console.log('  on screen: dialog ' + h.card + ' · chip ' + JSON.stringify(h.chip) + ' · snack ' + JSON.stringify(h.snacks)); console.log('  dialog: ' + await dialogText(g)); console.log('  buttons: ' + JSON.stringify(await dialogButtons(g))); await shot('7-receivership-starts');
    need(d2 > 0, 'receivership starts on the deadline');
    const lenDays = f.until - f.day, secs = Math.round(lenDays * (await g.eval(`BSU.params.time.ticksPerDay / BSU.params.time.baseTps`)) / Math.max(1, f.speed));
    console.log('  it lasts ' + lenDays + ' days: ' + secs + ' s (' + (secs / 60).toFixed(1) + ' min) at the forced ' + f.speed + '×, ' + Math.round(secs * f.speed / 60) + ' min at 1×');
    if (before) { await g.clickButtonText('#cards', 'Austerity'); await sleep(400); console.log('  (before: the Board\'s card came back on top; Austerity clicked so the receivership stands) ' + JSON.stringify(await fst(g))); }
    else {
      const dt = await dialogText(g), bs = await dialogButtons(g);
      need(h.card === 'receiver' && /^Board of Regents \| Receivership: 30 days left/i.test(dt), 'the dialog opens on its own, once');
      need(/Cash on Nov 1, Y1 \| −\u2060?\$[\d.]+M \| Income, an average month \| \$\d+k \| Costs, an average month \| \$\d+k/.test(dt), 'why: the real numbers (cash on the deadline, the average month\'s income against its costs)');
      need(/Faculty set to Basic: saves \$\d+k a month/.test(dt) && /Coaching spend cut to \$0: saves \$\d+k a month/.test(dt), 'what the Board cut, with the saving');
      need(/Frozen until it leaves \| New buildings, upgrades, pilings and land/i.test(dt) && /Still yours \| The bulldozer/i.test(dt) && /Gravel Path and Boardwalk/.test(dt), 'what is frozen and what still works');
      need(/time set to 4×/i.test(dt) && /When it ends \| Every tool comes back/i.test(dt), 'the forced speed and what is true at the end');
      need(bs.length === 1 && bs[0] === 'Got it', 'one button: Got it (' + JSON.stringify(bs) + ')');
      need(!/scrolls\]$/.test(dt), 'the receivership dialog fits 1440 x 900 without scrolling');
      need(f.cash === 0 && f.quality === 'basic' && f.coaching === 0 && f.speed === 4, 'the debt is written off, Faculty Basic, Coaching $0, 4× (' + JSON.stringify(f) + ')');
      await gotIt(g); await sleep(300);
      h = await hud(g); console.log('  after Got it: chip ' + JSON.stringify(h.chip)); await shot('8-chip');
      need(/^Receivership · \d+ days left$/.test(h.chip) && !h.card, 'the chip stays with the days left (' + h.chip + ')');
      await g.clickEl('#board-chip'); await sleep(450); need((await g.eval(`BSU.ui.cardOpen()`)) === 'receiver', 'the chip reopens the explanation'); await gotIt(g);
    }
    // ---- 4. a refused build: the Build FAB, the Dining Hall, one map click ----
    await g.eval(`(BSU.ui.dismissNotifs(), true)`);
    if (!(await g.clickEl('#fab-build'))) await g.eval(`(BSU.ui.openPalette(true), true)`); await sleep(350);
    need(await g.clickEl('#palette-items [data-id="dining_hall"]'), 'the Dining Hall card is in the Build sheet'); await sleep(300);
    const site = await freeSite(g, 'dining_hall');
    let p = site ? await g.eval(`(function () { var p = BSU.render.tileToScreen(${site.tx} + 1, ${site.ty}); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`) : { x: 700, y: 330 };
    await move(g, p); h = await hud(g); const ghost = h.ghost; console.log('  the Dining Hall over free ground: ghost ' + JSON.stringify(h.ghost)); await shot('9-refused-ghost');
    const n0 = await g.buildingCount(); await clickAt(g, p); h = await hud(g); console.log('  after the click: tool ' + h.tool + ' · snack ' + JSON.stringify(h.snacks)); await shot('10-refused-click');
    need((await g.buildingCount()) === n0, 'the Dining Hall is not built');
    if (!before) {
      need(/^Receivership: \d+ days left/.test(ghost), 'the ghost says "Receivership: N days left" (' + ghost + ')');
      need(h.snacks.some((x) => /^Dining Hall: Receivership: \d+ days left$/.test(x)) && !h.tool, 'the snackbar repeats it and the tool is dropped (one click ends a placement)');
      need(await g.clickButtonText('#notifications', 'Why?'), 'the refusal snackbar has "Why?"'); await sleep(400); need((await g.eval(`BSU.ui.cardOpen()`)) === 'receiver', '"Why?" opens the explanation'); await gotIt(g);
    }
    // ---- 5. what still works: a Gravel Path, the bulldozer, Budget ----
    await g.eval(`(BSU.ui.dismissNotifs(), true)`);
    if ((await g.eval(`BSU.ui.buildSheetState()`)) === 'closed') { await g.clickEl('#fab-build'); await sleep(300); }
    await g.clickEl('#palette-items [data-id="path"]'); await sleep(300);
    // a free, dry 3-tile strip near the campus where each tile takes a path (or is refused only by the Board)
    const run = await g.eval(`(function () { var s = BSU.state, B = BSU.buildings, W = BSU.MAP.W, f = s.plot.founders; for (var r = 3; r < 24; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r - 2; dx++) { var x = f.tx + dx, y = f.ty + dy, t = [y * W + x, y * W + x + 1, y * W + x + 2]; if (x < 2 || y < 2 || x > W - 5 || y > BSU.MAP.H - 3) continue; if (t.some(function (i) { return s.tiles.surface[i] !== 0 || s.tiles.owner[i] !== -1 || s.tiles.type[i] < 4; })) continue; var why = t.map(function (i) { var q = B.canPlace(s, 'path', i % W, (i / W) | 0, { noTie: true }); return q.ok ? '' : q.reason; }); if (why.every(function (w) { return w === '' || /^Receivership/.test(w); })) return { tx: x, ty: y, why: why[0] }; } return null; })()`);
    if (need(!!run, 'a free 3-tile strip for a path')) {
      const cashA = (await fst(g)).cash, lab = await dragTiles(g, [run.tx, run.ty], [run.tx + 2, run.ty]); const cashB = (await fst(g)).cash; h = await hud(g);
      console.log('  a 3-tile Gravel Path' + (run.why ? ' (canPlace: "' + run.why + '")' : '') + ': label "' + lab + '" · cash ' + cashA + ' → ' + cashB + ' · snack ' + JSON.stringify(h.snacks)); await shot('11-path-during');
      if (!before) need(cashB < cashA, 'a Gravel Path is still laid during receivership (cash ' + cashA + ' → ' + cashB + ')');
    }
    await g.key('Escape'); await g.eval(`(BSU.ui.dismissNotifs(), true)`);
    const lever = await g.eval(`(function () { var s = BSU.state, best = null; BSU.buildings.list(s).forEach(function (b) { var r = BSU.data.catalog[b.type]; if (r && r.demolishable && b.built >= 1 && (!best || r.upkeep > best.up)) best = { id: b.id, type: b.type, name: r.name, up: r.upkeep, tx: b.tx, ty: b.ty, w: b.w, h: b.h }; }); return best; })()`);
    if (need(!!lever, 'a building the bulldozer takes')) {
      if ((await g.eval(`BSU.ui.buildSheetState()`)) === 'closed') { await g.clickEl('#fab-build'); await sleep(300); }
      need(await g.clickEl('#btn-bulldoze'), 'the bulldozer is in the Build sheet'); await sleep(250);
      const st0 = await fst(g); await lookAt(g, lever.tx + 1, lever.ty - 3);
      p = await g.eval(`(function () { var p = BSU.render.tileToScreen(${lever.tx} + ${(lever.w - 1) / 2}, ${lever.ty} + ${(lever.h - 1) / 2}); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
      await clickAt(g, p); await sleep(300); const st1 = await fst(g); h = await hud(g);
      console.log('  the bulldozer on ' + lever.name + ' ($' + lever.up + ' a month): cash ' + st0.cash + ' → ' + st1.cash + ' · net ' + st0.net + ' → ' + st1.net + ' · ghost ' + JSON.stringify(h.ghost)); await shot('12-bulldozer-during');
      need(st1.cash > st0.cash, 'the bulldozer works during receivership and pays back (cash ' + st0.cash + ' → ' + st1.cash + ')');
      if (!before) need(st1.net > st0.net, 'the average month improves at once (net ' + st0.net + ' → ' + st1.net + ')');
      await g.key('Escape');
    }
    await g.eval(`(BSU.ui.openPanel('budget'), true)`); await sleep(500);
    const bud = await g.eval(`(function () { var t = document.getElementById('sl-tuition'), q = document.querySelector('#seg-quality .seg-btn.active'); return { tuition: t ? { value: t.value, disabled: !!t.disabled } : null, faculty: q ? q.textContent : null }; })()`);
    console.log('  Budget during receivership: ' + JSON.stringify(bud)); await shot('13-budget-during');
    need(bud.tuition && !bud.tuition.disabled, 'the tuition slider works during receivership'); await g.eval(`(BSU.ui.openPanel(null), true)`);
    need((await camera(g)) !== '' , 'camera read');
    // ---- 6. the end ----
    await g.eval(`(function () { var f = BSU.state.plot.founders; BSU.render.panToTile(f.tx + 1, f.ty + 1, false); return true; })()`); await g.settleCamera();
    const camA = await camera(g);
    const d3 = await runUntil(g, `BSU.state.progress.failure.receiver === false`, 130); await sleep(600);
    if (!before) await g.until(`BSU.ui.cardOpen() === 'receiver'`, 3000); if (!before && (await fst(g)).net < 0) await chip(/Losing/);
    f = await fst(g); h = await hud(g); console.log('  the end after ' + d3 + ' days: ' + JSON.stringify(f)); console.log('  on screen: dialog ' + h.card + ' · chip ' + JSON.stringify(h.chip) + ' · snack ' + JSON.stringify(h.snacks)); console.log('  dialog: ' + await dialogText(g)); await shot('14-exit');
    need(d3 > 0, 'receivership ends');
    need((await camera(g)) === camA, 'the camera did not move through receivership and its end (' + camA + ' → ' + (await camera(g)) + ')');
    if (!before) {
      const dt = await dialogText(g);
      need(h.card === 'receiver' && /The Board has left/.test(dt), 'the exit dialog');
      need(f.cash >= 0 && f.speed === 1 && f.until === -1, 'cash $0 or better, the speed back to 1× (' + JSON.stringify(f) + ')');
      if (f.net < 0) need(/Costs still exceed income by \$\d+k a month/.test(dt) && /Losing \$\d+k a month/.test(h.chip), 'still short: the dialog and the chip say by how much (' + h.chip + ')');
      await gotIt(g);
    } else await calmA(g);
    // ---- 7. three more years left alone: every Board card answered "Not now" ----
    console.log('  --- three more years, every Board card answered "Not now" ---');
    const log = []; let last = (await fst(g)).receiver, exitDay = (await fst(g)).day, entries = 0, minGap = Infinity, uncovered = 0, noticeSeen = false, badEntry = 0;
    for (let d = 0; d < 360; d++) {
      await g.eval(`(BSU.headless.fastForwardDays(1), true)`); await calmA(g);
      let x = await fst(g);
      if (x.card === 'failure') { log.push(x.date + ': the Board\'s card (cash ' + x.cash + ') → Not now'); await g.clickButtonText('#cards', 'Not now'); await sleep(150); x = await fst(g); }
      if (x.card === 'receiver') { await gotIt(g); x = await fst(g); }
      if (x.phase === 'notice') noticeSeen = true;
      if (!before && x.net < 0 && x.cash < 0 && x.phase === 'none') uncovered++;
      if (x.receiver !== last) {
        if (x.receiver) { entries++; minGap = Math.min(minGap, x.day - exitDay); if (!noticeSeen) badEntry++; log.push(x.date + ': RECEIVERSHIP starts, ' + (x.day - exitDay) + ' days after the last one ended (cash ' + x.cash + ', prestige ' + x.prestige + ')'); }
        else { exitDay = x.day; noticeSeen = false; log.push(x.date + ': receivership ends (cash ' + x.cash + ', prestige ' + x.prestige + ', speed ' + x.speed + '×)'); }
        last = x.receiver;
      }
    }
    for (const l of log) console.log('    ' + l);
    f = await fst(g); console.log('  after three years: ' + JSON.stringify(f) + ' · ' + entries + ' more receivership(s), the shortest gap ' + (entries ? minGap + ' days' : 'n/a'));
    await g.eval(`(BSU.ui.dismissNotifs(), true)`); await sleep(500); await shot('15-three-years-on');
    if (!before) {
      need(minGap >= 90, 'never back to back: at least 90 days (3 months past the line + the 60-day deadline) between an end and the next start (' + minGap + ')');
      need(badEntry === 0, 'every later receivership came after a Board card and its 60-day countdown');
      need(uncovered === 0, 'in debt and losing money is never without the chip (' + uncovered + ' days without)');
    }
    console.log('  camera at the start ' + cam0);
    const errs = await g.errorsSince(); if (errs.length) bad(errs.length + ' error(s): ' + errs.slice(0, 3).join(' | '));
    for (const n of g.notes.splice(0)) console.log('  note: ' + n);
  } finally { await g.close(); }
}

if (args.only !== 'b') await receivership();
if (args.only !== 'a') for (const size of sizesOf(args.size === 'both' ? undefined : args.size)) await freshGame(size);
killStrays();
console.log(problems || (args.strict && warnings) ? problems + ' problem(s), ' + warnings + ' warning(s)' : 'ALL OK' + (warnings ? ' (' + warnings + ' warning(s))' : ''));
process.exit(problems || (args.strict && warnings) ? 1 : 0);
