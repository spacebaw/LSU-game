#!/usr/bin/env node
// WCAG contrast gate for the UI token sheet (plain node, no deps). Parses the :root block of tools/ui_mock/index.html,
// computes the contrast ratio of every text / icon / border pair the tokens produce, prints a table and exits 1 on any failure.
//   node tools/ui_mock/contrast.mjs            (AA: 4.5 for text, 3.0 for icons and borders; "info" rows are decorative, never gated)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const root = (html.match(/:root\s*\{([^}]*)\}/) || [])[1];
if (!root) { console.error('no :root block found'); process.exit(2); }
const tokens = {};
for (const m of root.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();

function hex(v) { const m = /^#([0-9a-f]{6})$/i.exec(v); if (!m) throw new Error('not a hex colour: ' + v); const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function lum([r, g, b]) { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function ratio(a, b) { const la = lum(hex(a)), lb = lum(hex(b)); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }

// [foreground token, background token, kind, where it is used]; kind: text (4.5) | icon (3.0, icons, borders, fills) | info (decorative, reported only)
const PAIRS = [
  ['on-surface', 'surface', 'text', 'body, titles on every floating surface and the app bar'],
  ['on-surface', 'surface-container-low', 'text', 'item / grid card names'],
  ['on-surface', 'surface-container', 'text', 'stat chip values'],
  ['on-surface', 'surface-container-high', 'text', 'dialog title, filter-chip key cap'],
  ['on-surface-variant', 'surface', 'text', 'labels, kickers, secondary lines, placeholders'],
  ['on-surface-variant', 'surface-container', 'text', 'stat chip labels'],
  ['on-surface-variant', 'surface-container-low', 'text', 'card prices'],
  ['on-surface-variant', 'surface-container-high', 'text', 'dialog body, req chips'],
  ['on-surface-variant', 'secondary-container', 'text', 'label inside a selected stat chip'],
  ['primary', 'surface', 'text', 'text buttons, goal kicker, selected tab, wordmark'],
  ['primary', 'surface-container', 'icon', 'stat chip icons'],
  ['primary', 'surface-container-low', 'text', 'text button on a card'],
  ['on-primary', 'primary', 'text', 'filled button, brand mark'],
  ['on-primary-container', 'primary-container', 'text', 'primary container text'],
  ['primary', 'primary-container', 'icon', 'info issue glyph'],
  ['secondary', 'surface', 'text', 'links, selected filter chip key'],
  ['on-secondary', 'secondary', 'text', 'selected filter-chip key cap'],
  ['on-secondary-container', 'secondary-container', 'text', 'selected chip / segment / list item / tonal button'],
  ['on-tertiary', 'tertiary', 'text', 'Build FAB, Build it, Charter (gold)'],
  ['on-tertiary-container', 'tertiary-container', 'text', 'goal banner, ★ badge'],
  ['warn', 'tertiary-container', 'icon', 'warn issue glyph'],
  ['warn-text', 'surface-container', 'text', 'U6: the heat-advisory weather line (warn is a fill / icon colour only)'],
  ['warn-text', 'surface', 'text', 'U6: an interrupt goal kicker, the detail lock line, the Land Office why line'],
  ['error', 'surface', 'text', 'Demolish text button, bad gauge value'],
  ['on-error', 'error', 'text', 'alerts badge'],
  ['on-error-container', 'error-container', 'text', 'alert row'],
  ['error', 'error-container', 'icon', 'alert row icon, bad issue glyph'],
  ['success', 'surface', 'text', '+$88k net, On · On'],
  ['on-success-container', 'success-container', 'text', 'all-clear row'],
  ['success', 'success-container', 'icon', 'all-clear icon'],
  ['outline', 'surface', 'icon', 'segmented / text field / filter chip borders'],
  ['outline', 'surface-container-high', 'icon', 'switch off border'],
  ['primary', 'surface-container-high', 'icon', 'progress fill on its track, slider'],
  ['success', 'surface-container-high', 'icon', 'gauge fill (ok) on its track'],
  ['warn', 'surface-container-high', 'icon', 'gauge fill (warn) on its track'],
  ['error', 'surface-container-high', 'icon', 'gauge fill (bad) on its track'],
  ['water', 'surface', 'icon', 'water chip / gauge accent'],
  ['water', 'surface-container-high', 'icon', 'water gauge fill on its track'],
  ['moss', 'surface', 'icon', 'ecology / moss accent'],
  ['moss', 'surface-container-high', 'icon', 'moss gauge fill on its track'],
  ['tertiary', 'surface', 'info', 'gold underline under the wordmark (decorative; gold is never text or a required border)'],
  ['outline-variant', 'surface', 'info', 'dividers and the 1 px edge of floating surfaces (decorative)'],
  ['surface-container-high', 'surface', 'info', 'gauge / progress tracks (decorative)'],
];

const MIN = { text: 4.5, icon: 3.0, info: 0 };
const rows = []; let failed = 0;
for (const [fg, bg, kind, note] of PAIRS) {
  if (!tokens[fg] || !tokens[bg]) { console.error('missing token: ' + (tokens[fg] ? bg : fg)); process.exit(2); }
  const r = ratio(tokens[fg], tokens[bg]);
  const ok = kind === 'info' ? null : r >= MIN[kind];
  if (ok === false) failed++;
  rows.push({ fg, bg, kind, r: r.toFixed(2), ok: ok === null ? 'info' : ok ? 'pass' : 'FAIL', note });
}
const w = [22, 24, 5, 6, 5];
const line = (c) => c.map((s, i) => String(s).padEnd(w[i])).join('  ');
console.log(line(['foreground', 'background', 'kind', 'ratio', 'AA']) + '  where');
console.log(line(w.map((n) => '-'.repeat(n))) + '  ' + '-'.repeat(40));
for (const x of rows) console.log(line([`${x.fg} ${tokens[x.fg]}`, `${x.bg} ${tokens[x.bg]}`, x.kind, x.r, x.ok]) + '  ' + x.note);
console.log(`\n${rows.length} pairs, ${failed} failing (text ≥ 4.5, icons / borders ≥ 3.0; info rows are decorative)`);
process.exit(failed ? 1 : 0);
