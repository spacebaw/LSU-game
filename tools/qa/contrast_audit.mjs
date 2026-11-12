#!/usr/bin/env node
// UI refresh U6: WCAG contrast audit of the LIVE DOM (not the token sheet: tools/ui_mock/contrast.mjs does that), on the real game in headless Chrome.
//   node tools/qa/contrast_audit.mjs [--width 1440] [--height 900] [--size 96|64] [--scale 1|1.15|1.3] [--out dir] [--only state,state] [--verbose]
// For each state (title · at rest · goal card · each popover · Menu list / Budget / Settings · Build sheet collapsed / expanded with a greyed card and the
// detail column · Alerts with rows of every severity · a dialog · the coach card · the dimmed title under the sheet · inspect card and pill · snackbars ·
// night · storm · hidden HUD) it walks every visible text node and every `svg.ic` (currentColor icon) and every control border, computes the WCAG ratio
// of the colour against the EFFECTIVE background (the ancestors up to the first opaque or ≥ 94 % background; translucent layers composited over it; a
// surface with nothing opaque beneath it is composited over the world canvas pixel under the element; a translucent overlay hit-tested above the
// element, the dialog scrim, is composited over both colours) and reports every text pair under 4.5 (3.0 for ≥ 24 px, for bold ≥ 19 px, for icons and
// borders) with the element path. Inactive content is reported as info, never a failure (WCAG 1.4.3 "incidental"): disabled / aria-disabled / locked
// controls, text under a ≥ 94 % cover, the inert dimmed title card (pointer-events: none at 14 %), and the bar under a modal scrim.
// Prints the summary table (states × checked × failing), writes tools/qa/out/u6-contrast.txt and exits 1 on any failure. One headless Chrome.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, parseArgs, DEFAULT_OUT, killStrays, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { width: { type: 'num', def: 1440 }, height: { type: 'num', def: 900 }, size: { type: 'num', def: 96 }, scale: { type: 'num', def: 1 }, out: { type: 'str', def: DEFAULT_OUT }, only: { type: 'list', def: [] }, verbose: { type: 'bool', def: false } });
killStrays();
const ev = (g, js) => g.eval(`(function () { ${js}; return true; })()`);
async function rest(g) { await ev(g, `BSU.ui.closePopover(); BSU.ui.goalOpen(false); BSU.ui.openPalette(false); BSU.ui.dismissNotifs(); BSU.ui.closeInspect(); while (BSU.ui.closeCard && BSU.ui.cardOpen && BSU.ui.cardOpen()) BSU.ui.closeCard(); if (BSU.ui.buildMenuOpen()) BSU.ui.closeBuildMenu(); BSU.ui.openPanel(null); if (BSU.ui.hudMode() !== 'full') BSU.ui.setHudMode('full')`); await sleep(350); }

/** the in-page walk: returns { checked, rows: [{kind, fg, bg, ratio, min, size, weight, text, path, note}] } for everything visible right now */
const AUDIT_JS = `(function () {
  var vw = innerWidth, vh = innerHeight, rows = [], checked = 0;
  function parse(c) { var m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null; var p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  function over(top, base) { var a = top.a; return { r: top.r * a + base.r * (1 - a), g: top.g * a + base.g * (1 - a), b: top.b * a + base.b * (1 - a), a: 1 }; }
  function lum(c) { function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); } return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function ratio(a, b) { var la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  function hex(c) { return '#' + [c.r, c.g, c.b].map(function (v) { v = Math.round(v); return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase(); }
  var world = document.getElementById('world'), wctx = null; try { wctx = world && world.getContext('2d'); } catch (e) { wctx = null; }
  function mapPixel(x, y) {
    if (!wctx || !world) return { r: 90, g: 140, b: 70, a: 1 };
    try { var sx = world.width / Math.max(1, world.clientWidth), sy = world.height / Math.max(1, world.clientHeight); var d = wctx.getImageData(Math.max(0, Math.min(world.width - 1, Math.round(x * sx))), Math.max(0, Math.min(world.height - 1, Math.round(y * sy))), 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: 1 }; } catch (e) { return { r: 90, g: 140, b: 70, a: 1 }; }
  }
  function pathOf(el) { var out = []; var e = el, n = 0; while (e && e.nodeType === 1 && n < 5) { var s = e.tagName.toLowerCase(); if (e.id) s = '#' + e.id; else if (e.className && typeof e.className === 'string') { var cl = e.className.trim().split(/\\s+/).filter(function (c) { return c && c !== 'sl' && c !== 'hidden'; }).slice(0, 2); if (cl.length) s += '.' + cl.join('.'); } out.unshift(s); if (e.id) break; e = e.parentElement; n++; } return out.join(' > '); }
  /** the effective background under an element: ancestors up to the first opaque or >= 94 % background, translucent layers composited over it; nothing opaque = the map pixel */
  function bgOf(el, cx, cy) {
    var layers = [], e = el, base = null, baseAlpha = 0;
    while (e && e.nodeType === 1) { var cs = getComputedStyle(e); var c = parse(cs.backgroundColor); if (c && c.a > 0) { if (c.a >= 0.94) { base = c; baseAlpha = c.a; break; } layers.push(c); } e = e.parentElement; }
    var bg = base ? (baseAlpha < 1 ? over(base, mapPixel(cx, cy)) : base) : mapPixel(cx, cy);
    for (var i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return { bg: bg, opaque: !!base };
  }
  function opacityOf(el) { var o = 1, inert = false, e = el; while (e && e.nodeType === 1) { var cs = getComputedStyle(e); o *= parseFloat(cs.opacity); if (cs.pointerEvents === 'none' && parseFloat(cs.opacity) < 0.5) inert = true; e = e.parentElement; } return { o: o, inert: inert }; }
  function disabledOf(el) { var e = el; while (e && e.nodeType === 1) { if (e.disabled || e.getAttribute('aria-disabled') === 'true' || (e.classList && (e.classList.contains('locked') || e.classList.contains('disabled')))) return true; e = e.parentElement; } return false; }
  function visible(el) { var e = el; while (e && e.nodeType === 1) { var cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; e = e.parentElement; } return true; }
  /** what covers the point: null (the element itself or its family), a translucent cover {c}, or 'opaque' */
  function coverAt(el, x, y) {
    var top = document.elementFromPoint(x, y); if (!top) return null;
    if (top === el || el.contains(top) || top.contains(el)) return null;
    var e = top; while (e && e !== document.body) { var c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) return c.a >= 0.94 ? 'opaque' : { c: c }; e = e.parentElement; }
    return null;   // a cover with no paint of its own (the canvas, a pointer layer)
  }
  function push(kind, el, fg, size, weight, text, rect, extra) {
    var cx = Math.max(0, Math.min(vw - 1, rect.left + rect.width / 2)), cy = Math.max(0, Math.min(vh - 1, rect.top + rect.height / 2));
    var op = opacityOf(el), dis = disabledOf(el), b = bgOf(el, cx, cy), bg = b.bg, cover = null, note = '';
    var pe = false; var e = el; while (e && e.nodeType === 1) { if (getComputedStyle(e).pointerEvents === 'none') { pe = true; break; } e = e.parentElement; }
    if (!pe) { cover = coverAt(el, cx, cy); if (cover === 'opaque') { note = 'covered'; } else if (cover) { fg = over(cover.c, fg); bg = over(cover.c, bg); note = 'under scrim ' + Math.round(cover.c.a * 100) + '%'; } }
    if (fg.a < 1) fg = over(fg, bg);
    if (op.o < 1) { fg = over({ r: fg.r, g: fg.g, b: fg.b, a: op.o }, bg); note = (note ? note + '; ' : '') + 'opacity ' + Math.round(op.o * 100) + '%'; }
    var large = kind === 'text' && (size >= 24 || (weight >= 700 && size >= 19));
    var min = kind === 'text' && !large ? 4.5 : 3.0;
    var r = ratio(fg, bg); checked++;
    var info = note === 'covered' || op.inert || dis || /under scrim/.test(note);
    if (dis) note = (note ? note + '; ' : '') + 'disabled'; if (op.inert) note = (note ? note + '; ' : '') + 'inert';
    if (r < min || ${args.verbose}) rows.push({ kind: kind, fg: hex(fg), bg: hex(bg), ratio: Math.round(r * 100) / 100, min: min, size: Math.round(size * 10) / 10, weight: weight, text: text, path: pathOf(el), note: note, info: info, extra: extra || '' });
  }
  // text nodes
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  var tn; while ((tn = walker.nextNode())) {
    var t = (tn.nodeValue || '').replace(/\\s+/g, ' ').trim(); if (!t) continue; var el = tn.parentElement; if (!el || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'TITLE') continue;
    if (!visible(el)) continue; var range = document.createRange(); range.selectNodeContents(tn); var rect = range.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) continue;
    var cs = getComputedStyle(el); var fg = parse(cs.color); if (!fg) continue; var size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400);
    push('text', el, fg, size, weight, t.slice(0, 40), rect);
  }
  // icons (currentColor)
  var icons = document.querySelectorAll('svg.ic');
  for (var i = 0; i < icons.length; i++) { var ic = icons[i]; if (!visible(ic)) continue; var rc = ic.getBoundingClientRect(); if (!rc.width || !rc.height || rc.right <= 0 || rc.bottom <= 0 || rc.left >= vw || rc.top >= vh) continue; var c = parse(getComputedStyle(ic).color); if (!c) continue; push('icon', ic, c, rc.width, 400, 'icon ' + (ic.dataset.icon || ''), rc); }
  // control borders: every 1-2 px border that is not the decorative outline-variant edge (M3: dividers and surface edges carry no requirement)
  var ov = getComputedStyle(document.documentElement).getPropertyValue('--outline-variant').trim().toUpperCase();
  var all = document.querySelectorAll('button, input, select, textarea, .seg-btn, .toggle, .ov-btn, .text-field, .of, .filter-chip, .key, .list-item');
  for (var k = 0; k < all.length; k++) { var el2 = all[k]; if (!visible(el2)) continue; var cs2 = getComputedStyle(el2); var bw = parseFloat(cs2.borderTopWidth); var bc = parse(cs2.borderTopColor); if (!bw || !bc || bc.a === 0) continue; var rr = el2.getBoundingClientRect(); if (!rr.width || !rr.height || rr.right <= 0 || rr.bottom <= 0 || rr.left >= vw || rr.top >= vh) continue; if (hex(bc) === ov) continue; push('border', el2, bc, bw, 400, 'border', rr, cs2.borderTopColor); }
  return { checked: checked, rows: rows };
})()`;

/** the states: name → async (g) that arranges the screen; the audit runs after each; `tidy` resets */
function states(g) {
  const E = (js) => ev(g, js);
  return [
    ['title', async () => { await g.title(true); await sleep(700); }, async () => { await g.title(false); await sleep(300); }],
    ['title-dimmed-under-sheet', async () => { await g.title(true); await sleep(500); await g.clickEl('#btn-title-howto'); await sleep(600); }, async () => { await g.key('Escape'); await sleep(300); await g.title(false); await sleep(300); }],
    ['at-rest', async () => {}, null],
    ['goal-card', async () => { await E(`BSU.ui.goalOpen(true)`); await sleep(500); }, null],
    ['popover-needs', async () => { await E(`BSU.ui.openPopover('needs')`); await sleep(500); }, null],
    ['popover-budget', async () => { await E(`BSU.ui.openPopover('budget')`); await sleep(500); }, null],
    ['popover-alerts', async () => { await E(`BSU.ui.openPopover('alerts')`); await sleep(600); await E(`var tiles = document.querySelectorAll('#issues-list .issue-row .ig'); for (var i = 0; i < tiles.length; i++) tiles[i].dataset.sev = String(3 - (i % 3))`); await sleep(100); }, null],
    ['popover-layers', async () => { await E(`BSU.ui.setOverlay(BSU.state, BSU.OV.FLOOD); BSU.ui.openPopover('layers')`); await sleep(500); }, async () => { await E(`BSU.ui.setOverlay(BSU.state, BSU.OV.NONE)`); }],
    ['popover-map', async () => { await E(`BSU.ui.openPopover('map')`); await sleep(500); }, null],
    ['popover-breakdown', async () => { await E(`BSU.ui.breakdown(BSU.state, 'prestige')`); await sleep(500); }, null],
    ['menu-list', async () => { await E(`BSU.ui.openSheet(true)`); await sleep(500); }, null],
    ['menu-budget', async () => { await E(`BSU.ui.openPanel('budget')`); await sleep(500); }, null],
    ['menu-settings', async () => { await E(`BSU.ui.openPanel('settings')`); await sleep(500); }, null],
    ['build-collapsed', async () => { await E(`window.__unl = BSU.buildings.unlocked; BSU.buildings.unlocked = function (s, id) { if (id === 'lecture_hall') return { ok: false, reason: 'Reach 400 students' }; return window.__unl.apply(this, arguments); }; BSU.ui.openPalette(true); BSU.state.ui.paletteTab = 'essentials'; BSU.ui.refreshPalette(BSU.state)`); await sleep(500); }, async () => { await E(`BSU.buildings.unlocked = window.__unl; BSU.ui.refreshPalette(BSU.state)`); }],
    ['build-expanded', async () => { await E(`window.__unl = BSU.buildings.unlocked; BSU.buildings.unlocked = function (s, id) { if (id === 'lecture_hall') return { ok: false, reason: 'Reach 400 students' }; return window.__unl.apply(this, arguments); }; BSU.ui.openBuildMenu(BSU.state, { tab: 'essentials' })`); await sleep(400); await E(`BSU.ui.focusCard('substation') || BSU.ui.focusCard('water_tower')`); await sleep(400); }, async () => { await E(`BSU.buildings.unlocked = window.__unl; BSU.ui.refreshPalette(BSU.state)`); }],
    ['dialog', async () => { const ids = await g.eval(`(BSU.data.boardCards || []).slice(0, 3).map(function (c) { return c.id; })`); await E(`BSU.ui.card(BSU.state, 'board', { cards: ${JSON.stringify(ids)} })`); await sleep(500); }, null],
    ['coach', async () => { await E(`BSU.ui.settings().coachSeen = false; BSU.ui.startCoach(BSU.state, { now: true })`); await sleep(900); }, async () => { await g.key('Escape'); await sleep(300); await E(`BSU.ui.settings().coachSeen = true`); }],
    ['inspect-card', async () => { await E(`var b = BSU.state.buildings.filter(function (x) { return x && x.type === 'dorm'; })[0]; BSU.ui.inspect(BSU.state, { kind: 'building', id: b.id })`); await sleep(600); }, null],
    ['inspect-pill', async () => { await E(`var b = BSU.state.buildings.filter(function (x) { return x && x.type === 'dorm'; })[0]; BSU.ui.inspect(BSU.state, { kind: 'building', id: b.id }); BSU.ui.collapseInspect(true)`); await sleep(500); }, null],
    ['snackbars', async () => { await E(`BSU.ui.notify(BSU.state, { kind: 'danger', text: 'Tiger Hall has no power.', ttl: 30000, action: { label: 'Fix', fn: function () {} } }); BSU.ui.decision(BSU.state, { id: 'u6audit', text: 'Cove levee at 72 %: send the crew?', yes: 'Send the crew', no: 'Hold', ticks: 4000 })`); await sleep(600); }, async () => { await E(`BSU.ui.answerDecision('u6audit', 'no')`); }],
    ['night', async () => { await E(`BSU.weather.scriptSky(BSU.state, 4, 0.5); BSU.ui.goalOpen(true)`); await sleep(700); }, async () => { await E(`BSU.weather.scriptSky(BSU.state, 1, 0.4)`); await sleep(300); }],
    ['storm', async () => { await E(`BSU.session.setSpeed(BSU.state, 1, 'user'); BSU.state.sky.scripted && BSU.weather.releaseSky(BSU.state); BSU.headless.forceHurricane(3)`); let got = false; await g.run(5200, { slice: 40, frameMs: 25, each: async () => { const r = await g.eval(`(function () { var sp = BSU.state.setPiece; return sp && sp.kind === 'landfall' ? sp.tick : -1; })()`); got = r > 320; return got; } }); if (got) { await E(`BSU.render.captureCameraTouch(BSU.state)`); await g.frameCampus(1, { keepOnMap: false }); await g.key('n'); await sleep(600); } await E(`BSU.session.setSpeed(BSU.state, 0, 'user')`); await sleep(500); if (!got) g.notes.push('storm: the landfall never reached its middle'); }, null],
    ['hud-hidden', async () => { await g.key('h'); await sleep(500); }, async () => { await g.key('h', { shift: true }); await sleep(300); }],
  ];
}

const g = await openGame({ width: args.width, height: args.height, size: args.size, seed: 42, outDir: args.out, noGuard: true });
const summary = []; const failing = []; const infos = []; let total = 0, totalFail = 0;
try {
  await ev(g, `BSU.ui.setUiScale(${args.scale})`); await sleep(150);
  await g.buildCampus({ target: 30, days: 30, students: 1500, stadium: true });
  await g.noGuard();
  // cut the power so the Alerts popover and the needs line have rows
  await ev(g, `var s = BSU.state; s.buildings.filter(function (b) { return b && b.type === 'substation'; }).slice(0, 1).forEach(function (b) { BSU.buildings.remove(s, b.id, 'demolish'); }); BSU.issues.invalidate()`);
  await ev(g, `BSU.session.setSpeed(BSU.state, 0, 'user'); BSU.weather.scriptSky(BSU.state, 1, 0.4)`);
  await g.frameCampus(1, { keepOnMap: false }); await g.waitBake({ timeoutMs: 45000 }); await g.settleCamera(); await rest(g);
  for (const [name, arrange, tidy] of states(g)) {
    if (args.only.length && !args.only.includes(name)) continue;
    await arrange();
    const r = await g.eval(AUDIT_JS);
    const fails = r.rows.filter((x) => !x.info && x.ratio < x.min), inf = r.rows.filter((x) => x.info && x.ratio < x.min);
    summary.push({ state: name, checked: r.checked, failing: fails.length, info: inf.length });
    total += r.checked; totalFail += fails.length;
    for (const f of fails) failing.push(Object.assign({ state: name }, f));
    for (const f of inf) infos.push(Object.assign({ state: name }, f));
    if (args.verbose) for (const x of r.rows) console.log(`  ${name} ${x.kind} ${x.ratio} (min ${x.min}) ${x.fg} on ${x.bg} ${x.path} "${x.text}" ${x.note}`);
    if (tidy) await tidy();
    await rest(g);
  }
  const errs = await g.bsuErrors(); if (errs.length) { console.log('BSU.error: ' + errs.join(' | ')); totalFail++; }
} finally { await g.close(); killStrays(); }

// the summary table
const w = [28, 8, 8, 10];
const line = (c) => c.map((s, i) => String(s).padEnd(w[i])).join('  ');
const out = [];
out.push(`contrast audit · ${args.width} × ${args.height} · ${args.size}-map · scale ${args.scale} · text ≥ 4.5 (≥ 24 px or bold ≥ 19 px: 3.0), icons and borders ≥ 3.0`);
out.push(line(['state', 'checked', 'failing', 'info']));
out.push(line(w.map((n) => '-'.repeat(n))));
for (const s of summary) out.push(line([s.state, s.checked, s.failing, s.info]));
out.push(line(['total', total, totalFail, infos.length]));
if (failing.length) { out.push('', 'FAILING pairs:'); const seen = new Set(); for (const f of failing) { const key = f.state + '|' + f.kind + '|' + f.fg + '|' + f.bg + '|' + f.path; if (seen.has(key)) continue; seen.add(key); out.push(`  ${f.state}: ${f.kind} ${f.ratio} < ${f.min}  ${f.fg} on ${f.bg}  ${f.size}px/${f.weight}  ${f.path}  "${f.text}"${f.note ? '  (' + f.note + ')' : ''}`); } }
if (infos.length) { out.push('', 'info (inactive content under the threshold; not gated):'); const seen = new Set(); for (const f of infos) { const key = f.state + '|' + f.kind + '|' + f.fg + '|' + f.bg + '|' + f.path + '|' + f.note; if (seen.has(key)) continue; seen.add(key); out.push(`  ${f.state}: ${f.kind} ${f.ratio}  ${f.fg} on ${f.bg}  ${f.path}  "${f.text}"  (${f.note})`); } }
mkdirSync(args.out, { recursive: true }); writeFileSync(join(args.out, 'u6-contrast.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
console.log(`\n${total} checks over ${summary.length} states, ${totalFail} failing; report: ${join(args.out, 'u6-contrast.txt')}`);
process.exit(totalFail ? 1 : 0);
