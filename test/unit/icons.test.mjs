// Unit test for src/js/icons.js (UI refresh U5): the one inline-SVG registry behind every glyph of the DOM chrome (BSU.icons).
// The contract: every name the UI asks for exists; every registry SVG is a 24 × 24 viewBox of parseable paths whose only paint is `currentColor` / `none`
// (so it recolours with the state layers and the colour-blind palette); get() returns a fresh element; no emoji or text glyph is left in the DOM-building code.
// Usage: node test/unit/icons.test.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWindow } from '../domstub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };

const win = makeWindow();
win.BSU_FORCE_HEADLESS = true;
const ctx = vm.createContext(win);
const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8')).modules;
for (const f of manifest) {
  try { vm.runInContext(readFileSync(join(root, 'src', 'js', f), 'utf8'), ctx, { filename: f }); }
  catch (e) { ok(false, f + ' failed to load: ' + (e && e.stack || e)); process.exit(1); }
}
const BSU = win.BSU, I = BSU.icons, U = BSU.ui;
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const src = { ui: readFileSync(join(root, 'src', 'js', 'ui.js'), 'utf8'), panels: readFileSync(join(root, 'src', 'js', 'ui_panels.js'), 'utf8'), icons: readFileSync(join(root, 'src', 'js', 'icons.js'), 'utf8') };

// --- the module ---------------------------------------------------------------------------------------------------
ok(manifest.indexOf('icons.js') >= 0 && manifest.indexOf('icons.js') < manifest.indexOf('ui.js') && manifest.indexOf('icons.js') < manifest.indexOf('ui_panels.js'), 'icons.js is in the manifest before ui.js and ui_panels.js');
ok(I && typeof I.get === 'function' && typeof I.names === 'function' && typeof I.has === 'function' && typeof I.paths === 'function' && typeof I.fromGlyph === 'function' && typeof I.selfTest === 'function', 'BSU.icons: get / names / has / paths / fromGlyph / selfTest');
ok(/^'use strict';/.test(src.icons) && !/innerHTML|Math\.random|setTimeout|setInterval|<\/script/.test(src.icons), 'icons.js: strict, no innerHTML, no randomness, no timers');
const names = I.names();
ok(names.length >= 60 && names.length === new Set(names).size && names.join() === names.slice().sort().join(), 'names(): ' + names.length + ' unique, sorted names');
const st = I.selfTest(); ok(st.ok, 'icons.selfTest: ' + st.notes);

// --- every registry SVG -------------------------------------------------------------------------------------------
const PAINT = (v) => v === undefined || v === null || v === 'none' || v === 'currentColor';
let badShell = 0, badPaint = 0, badPath = 0, emptyN = 0;
for (const n of names) {
  const s = I.get(n);
  if (!(s.tagName === 'SVG' || s.tagName === 'svg') || s.getAttribute('viewBox') !== '0 0 24 24' || s.dataset.icon !== n || !s.classList.contains('ic') || s.getAttribute('aria-hidden') !== 'true') badShell++;
  if (!PAINT(s.getAttribute('fill')) || !PAINT(s.getAttribute('stroke')) || s.getAttribute('style') || s.style && Object.keys(s.style).length) badPaint++;
  if (!s.children.length) emptyN++;
  for (const p of s.children) { if (!PAINT(p.getAttribute('fill')) || !PAINT(p.getAttribute('stroke')) || p.getAttribute('style') || p.getAttribute('stop-color') || !p.getAttribute('d') || !I.pathValid(p.getAttribute('d'))) { badPath++; console.error('  bad path in', n); } }
}
ok(badShell === 0, 'every svg is class "ic" with viewBox 0 0 24 24, aria-hidden and its data-icon (' + badShell + ' bad)');
ok(badPaint === 0 && badPath === 0, 'every svg and path paints only in currentColor or none, with a parseable d and no inline style (' + badPaint + ' shells, ' + badPath + ' paths bad)');
ok(emptyN === 0, 'no registry icon is empty');
{ const filled = names.filter((n) => I.isFilled(n)); ok(filled.length >= 3 && filled.every((n) => I.get(n).children.every((p) => p.getAttribute('fill') === 'currentColor' && p.getAttribute('stroke') === 'none')), 'the filled icons (' + filled.join(', ') + ') fill with currentColor and carry no stroke'); }
{ const outline = names.filter((n) => !I.isFilled(n)); ok(outline.every((n) => I.get(n).getAttribute('fill') === 'none' && I.get(n).getAttribute('stroke') === 'currentColor' && I.get(n).children.every((p) => p.getAttribute('fill') === null)), 'the outline icons inherit fill none / stroke currentColor from the svg'); }
{ const bad = ['M0', 'L1 2', 'M1', 'M1 2 3', 'M1 2 Q 1', 'x', '', 'M1 2 Zq', 'M1,2 L3 4 H', 'M1 2 A1 1 0 0 1 3']; ok(bad.every((d) => !I.pathValid(d)) && ['M1 2', 'M12 3 2 21h20z', 'M4 7h16', 'M1 2l3 4-1.5 2z', 'M5 12l4 4L19 7'].every((d) => I.pathValid(d)), 'pathValid refuses a malformed path and accepts the registry\'s dialect'); }
{ const a = I.get('close'), b = I.get('close'); ok(a !== b && a.children[0] !== b.children[0], 'get() returns a fresh element each call'); }
{ const s = I.get('star', 'sm hidden s20'); ok(s.classList.contains('sm') && s.classList.contains('hidden') && s.classList.contains('s20') && !I.get('star').classList.contains('sm') && I.get('star').classList.contains('ic'), 'get(name, cls) adds the classes (sm 18 px, s20 20 px, hidden …) and nothing else'); }
{ const p = I.paths('close'); p.push('M0 0'); ok(I.paths('close').length === 2 && I.paths('nope').length === 0, 'paths() hands out a copy'); }
// the CSS sizes the classes the registry hands out
{ const css = readFileSync(join(root, 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); ok(/svg\.ic\{width:var\(--icon\);height:var\(--icon\);[^}]*fill:none;stroke:currentColor/.test(css) && /svg\.ic\.s20\{width:2rem;height:2rem\}/.test(css) && /svg\.ic\.sm\{width:1\.8rem;height:1\.8rem\}/.test(css), 'CSS: svg.ic is 24 px (var(--icon)), .s20 20 px, .sm 18 px, stroke currentColor'); }

// --- every name the UI asks for exists ------------------------------------------------------------------------------
{
  const code = strip(src.ui) + '\n' + strip(src.panels);
  const asked = new Set();
  for (const m of code.matchAll(/\b(?:icon|iconBtn|iconBtn\([^,]+,|icons\.get|BSU\.icons\.get|M\.icon|U\.icon)\(\s*'([a-z_0-9]+)'/g)) asked.add(m[1]);
  for (const m of code.matchAll(/\biconBtn\(\s*'[^']*'\s*,\s*'([a-z_0-9]+)'/g)) asked.add(m[1]);
  for (const m of code.matchAll(/\bmenuItem\([^)]*?,\s*'[A-Z]?'\s*,\s*'([a-z_]+)'\s*,/g)) asked.add(m[1]);
  for (const m of code.matchAll(/\bstatEl\('[^']*',\s*'[^']*',\s*'[^']*',\s*'([a-z_]+)'/g)) asked.add(m[1]);
  for (const m of code.matchAll(/\blead\([^,()]+(?:\([^)]*\))?[^,()]*,\s*'([a-z_]+)'/g)) asked.add(m[1]);
  for (const m of code.matchAll(/\bmeter\([^,]+,[^,]+,\s*'([a-z_]+)'/g)) asked.add(m[1]);
  for (const m of code.matchAll(/\bicon: '([a-z_]+)'/g)) asked.add(m[1]);
  for (const m of code.matchAll(/'([a-z_]+)'\s*:\s*'([a-z_]+)'/g)) void m;
  const tables = {};
  for (const t of ['SKY_GLYPH', 'MOOD_FACES']) { const m = code.match(new RegExp('const ' + t + " = \\[([^\\]]*)\\]")); tables[t] = m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : []; for (const n of tables[t]) asked.add(n); }
  for (const t of ['OV_ICON', 'SNACK_ICON']) { const m = code.match(new RegExp('const ' + t + ' = \\{([^}]*)\\}')); tables[t] = m ? [...m[1].matchAll(/:\s*'([a-z_]+)'/g)].map((x) => x[1]) : []; for (const n of tables[t]) asked.add(n); }
  ok(tables.SKY_GLYPH.length === 5 && tables.MOOD_FACES.length === 5 && tables.OV_ICON.length === 6 && tables.SNACK_ICON.length >= 8, 'the UI\'s icon tables parse (sky 5, mood 5, overlays 6, snackbar kinds ' + tables.SNACK_ICON.length + ')');
  const missing = [...asked].filter((n) => !I.has(n));
  ok(asked.size >= 40 && missing.length === 0, 'every icon name literal in ui.js / ui_panels.js exists in the registry (' + asked.size + ' names' + (missing.length ? '; missing: ' + missing.join(', ') : '') + ')');
  // the data the UI maps by glyph: the requirement glyphs, the issue kinds' glyph names, the alert strip's emoji
  const RQ = BSU.data.requirements, rqg = [RQ.power, RQ.water, RQ.path, RQ.road, RQ.marsh, RQ.place[BSU.PLACE.PATH], RQ.place[BSU.PLACE.ROAD], RQ.place[BSU.PLACE.BOARDWALK]].map((r) => r.glyph);
  ok(rqg.every((g) => I.fromGlyph(g) && I.has(I.fromGlyph(g))), 'every requirement glyph in data.js maps to a registry icon (' + rqg.map((g) => I.fromGlyph(g)).join(' ') + ')');
  const kinds = BSU.issues.kinds(); const glyphs = [...new Set(Object.keys(kinds).map((k) => kinds[k].glyph))];
  ok(glyphs.length >= 8 && glyphs.every((g) => I.has(g)), 'every issue kind\'s glyph is a registry icon (' + glyphs.join(' ') + ')');
  ok(['🌀', '🦟', '🌡', '⚡', '🌊', '🚱', '🐊'].every((g) => I.fromGlyph(g) && I.has(I.fromGlyph(g))), 'the alert strip\'s old emoji still map (callers of ui.alert)');
  ok(BSU.data.overlays.every((o) => tables.OV_ICON.length === 6) && BSU.data.overlays.map((o) => o.key).join('') === 'FWKPCE', 'the overlay chips F W K P C E each have a glyph');
}

// --- the UI really asks only for known names ------------------------------------------------------------------------
{
  BSU.session.newGame({ seed: 3, skipTutorial: true, size: 64 }); const s = BSU.state; U.showTitle(true, { canContinue: true }); U.update(s, 50); U.showTitle(false);
  for (const p of ['budget', 'season', 'storm', 'land', 'almanac', 'milestones', 'log', 'settings', 'howto', 'about']) { try { U.openPanel(p); U.update(s, 50); } catch (e) { ok(false, 'opening ' + p + ' threw ' + e.message); } }
  U.openPanel(null); U.openSheet(true); U.openSheet(false); for (const p of ['needs', 'budget', 'alerts', 'layers', 'map']) { U.openPopover(p); U.update(s, 50); } U.closePopover();
  U.openBuildMenu(s, { tab: 'essentials' }); U.update(s, 600); U.closeBuildMenu(); U.openPalette(true); U.update(s, 50); U.openPalette(false);
  U.notify(s, { kind: 'danger', text: 'a' }); U.notify(s, { kind: 'wildlife', text: 'b', milestone: true }); U.dismissNotifs();
  ok(I.requested().length >= 45 && I.missing().length === 0, 'after the title, the Menu, every panel, every popover and both Build sheets ran: ' + I.requested().length + ' icons asked for, none missing' + (I.missing().length ? ' (' + I.missing().join(', ') + ')' : ''));
}

// --- no emoji or text glyph is left in the DOM-building code --------------------------------------------------------------
{
  const allowedLine = (l) => /const REQ_LABEL = /.test(l) || /\bk: '← →'|\bk: '[↑↓←→ ]+'/.test(l);   // the requirement glyphs are data.js keys (mapped by icons.fromGlyph); the key table's arrows are key caps
  const GLYPHS = /[\u2713\u2717\u2715\u25B8\u25C2\u25A3\u25AE\u25AF\u2316\u21B6\u25B6\u25C0\u23F3\u26A0\u25CF\u2726\u22EF\u2630\u2922\u2921\u2714\u2716]|\p{Extended_Pictographic}/u;
  for (const [name, text] of [['ui.js', src.ui], ['ui_panels.js', src.panels]]) {
    const code = strip(text).split('\n'); const hits = [];
    code.forEach((l, i) => { const t = l.replace(/^\s+/, ''); if (GLYPHS.test(l.replace(/[\u2605\u2606]/g, '')) && !allowedLine(l)) hits.push((i + 1) + ': ' + t.slice(0, 80)); });
    ok(hits.length === 0, name + ': no emoji or text glyph (✕ ✓ ✗ ▸ ◂ ▣ ▮ ⌖ ↶ ▶ ⚠ ● ✦ ☰ ⋯ or a pictograph) outside comments except the data glyph keys' + (hits.length ? ' — ' + hits.slice(0, 5).join(' | ') : ''));
  }
  // the one ★ left in a UI string is prose ("Gold ★ marks …" in data.js); the DOM icons are svg
  ok(!/'★'|"★"/.test(strip(src.ui)), 'ui.js builds no "★" element (the star is the star icon)');
}

{ const x = I.get('no_such_icon'); ok(x.children.length === 0 && I.missing().join() === 'no_such_icon' && I.requested().indexOf('no_such_icon') >= 0, 'an unknown name returns an empty svg and is recorded as missing (the only miss of the whole run)'); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
